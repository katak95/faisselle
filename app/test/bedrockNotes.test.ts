import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BEDROCK_CONTEXT, bedrockClient, bedrockEndpoint, createBedrockNotesModel, estimateTokens, modelTakesEffort, type MessagesClient } from '../src/main/notes/bedrock'
import { createSwitchingNotesModel } from '../src/main/notes/provider'
import { createSso, PendingError, SignInNeededError, type SsoApi } from '../src/main/aws/sso'

type Sent = { model: string; max_tokens: number; messages: Array<{ role: string; content: Array<{ text: string; cache_control?: unknown }> }>; output_config?: { effort?: string; format?: unknown }; temperature?: number }

function fakeClient(answer = 'Hello there', stop = 'end_turn', fail?: unknown) {
  const sent: Sent[] = []
  const client = { messages: { stream: (p: Sent) => {
    sent.push(p)
    const fns: Array<(t: string) => void> = []
    const s = {
      on: (_: string, fn: (t: string) => void) => { fns.push(fn); return s },
      finalMessage: async () => {
        if (fail) throw fail
        for (const w of answer.split(' ')) for (const f of fns) f(w + ' ')
        return { stop_reason: stop, content: [{ type: 'text', text: answer }], usage: { input_tokens: 10, output_tokens: 2 } }
      },
    }
    return s
  } } } as unknown as MessagesClient
  return { client, sent }
}
const config = { region: 'eu-west-1', modelId: 'anthropic.claude-haiku-5-5', accountId: '123456789012', roleName: 'BedrockUser' }

describe('the notes model on Bedrock', () => {
  it('streams the answer, and turns earlier prompts into turns', async () => {
    const { client, sent } = fakeClient()
    const llm = await createBedrockNotesModel({ config: () => config, client: () => client }).llm()
    const tokens: string[] = []
    const out = await llm.chat('Follow-up', (t) => tokens.push(t), { before: ['First prompt', 'First answer'], maxTokens: 300, temperature: 0.3 })
    expect(out).toBe('Hello there')
    expect(tokens.join('')).toBe('Hello there ')
    expect(sent[0].messages.map((m) => [m.role, m.content[0].text])).toEqual([['user', 'First prompt'], ['assistant', 'First answer'], ['user', 'Follow-up']])
    // Haiku 5.5 refuses a temperature: never sent
    expect(sent[0].temperature).toBeUndefined()
    expect(sent[0].model).toBe('anthropic.claude-haiku-5-5')
    expect(llm.contextSize).toBe(BEDROCK_CONTEXT)
    expect(llm.readAhead).toBeUndefined()
  })

  it('caches a long first prompt and asks for JSON when a schema is given', async () => {
    const { client, sent } = fakeClient('[]')
    const llm = await createBedrockNotesModel({ config: () => config, client: () => client }).llm()
    await llm.chat('x'.repeat(9000), () => {}, { json: { type: 'array' } })
    expect(sent[0].messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(sent[0].output_config?.format).toEqual({ type: 'json_schema', schema: { type: 'array' } })
  })

  it('says what is missing when not set up, and explains AWS errors', async () => {
    await expect(createBedrockNotesModel({ config: () => undefined, client: () => fakeClient().client }).llm()).rejects.toMatchObject({ kind: 'sign-in' })
    const llm = await createBedrockNotesModel({ config: () => config, client: () => fakeClient('', 'end_turn', Object.assign(new Error('no'), { status: 403 })).client }).llm()
    await expect(llm.chat('Hi', () => {})).rejects.toMatchObject({ kind: 'access' })
    const refused = await createBedrockNotesModel({ config: () => config, client: () => fakeClient('', 'refusal').client }).llm()
    await expect(refused.chat('Hi', () => {})).rejects.toMatchObject({ kind: 'refused' })
  })

  it('goes through InvokeModel for the model IDs and inference profiles other AWS projects use', () => {
    expect(bedrockEndpoint('anthropic.claude-haiku-5-5')).toBe('mantle')
    expect(bedrockEndpoint('anthropic.claude-haiku-4-5')).toBe('mantle')
    for (const id of ['eu.anthropic.claude-haiku-4-5-20251001-v1:0', 'anthropic.claude-haiku-4-5-20251001-v1:0', 'global.anthropic.claude-sonnet-4-6', 'us.anthropic.claude-opus-4-5-20251101-v1:0',
      'arn:aws:bedrock:eu-west-1:123456789012:inference-profile/eu.anthropic.claude-haiku-4-5-20251001-v1:0'])
      expect(bedrockEndpoint(id), id).toBe('runtime')
  })

  it('sends the effort level only to the models that take it', () => {
    for (const id of ['anthropic.claude-haiku-5-5', 'anthropic.claude-opus-4-5', 'eu.anthropic.claude-sonnet-4-6', 'anthropic.claude-fable-5-1', 'something-else'])
      expect(modelTakesEffort(id), id).toBe(true)
    for (const id of ['eu.anthropic.claude-haiku-4-5-20251001-v1:0', 'anthropic.claude-sonnet-4-5-20250929-v1:0', 'anthropic.claude-sonnet-4-20250514-v1:0'])
      expect(modelTakesEffort(id), id).toBe(false)
  })

  it('writes with Claude Haiku 4.5 on InvokeModel: no effort level, the JSON format kept', async () => {
    const { client, sent } = fakeClient('[]')
    const haiku45 = { ...config, modelId: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0' }
    const llm = await createBedrockNotesModel({ config: () => haiku45, client: () => client }).llm()
    await llm.chat('Hi', () => {})
    expect(sent[0].output_config).toBeUndefined()
    await llm.chat('Hi', () => {}, { json: { type: 'array' } })
    expect(sent[1].output_config).toEqual({ format: { type: 'json_schema', schema: { type: 'array' } } })
    expect(sent[1].model).toBe(haiku45.modelId)
  })

  it('names the permission the role lacks, for the door in use', async () => {
    const denied = (modelId: string) => createBedrockNotesModel({ config: () => ({ ...config, modelId }), client: () => fakeClient('', 'end_turn', Object.assign(new Error('no'), { status: 403 })).client }).llm()
    await expect((await denied('anthropic.claude-haiku-5-5')).chat('Hi', () => {})).rejects.toThrow(/bedrock-mantle:CreateInference.*eu\.anthropic\.claude-haiku-4-5/)
    await expect((await denied('eu.anthropic.claude-haiku-4-5-20251001-v1:0')).chat('Hi', () => {})).rejects.toThrow(/bedrock:InvokeModelWithResponseStream/)
  })

  it('signs InvokeModel requests for bedrock-runtime, with the API version every Claude model takes there', async () => {
    const seen: Array<{ url: string; body: string; auth: string }> = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      seen.push({ url: String(url), body: String(init.body), auth: new Headers(init.headers).get('authorization') ?? '' })
      return new Response('{"message":"denied"}', { status: 403, headers: { 'content-type': 'application/json' } })
    })
    try {
      const keys = async () => ({ accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 's', sessionToken: 't', expiration: Date.now() + 3_600_000 })
      for (const [endpoint, model] of [['runtime', 'eu.anthropic.claude-haiku-4-5-20251001-v1:0'], ['mantle', 'anthropic.claude-haiku-5-5']] as const)
        await bedrockClient('eu-west-1', keys, endpoint).messages.stream({ model, max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }).finalMessage().catch(() => {})
    } finally { vi.unstubAllGlobals() }
    expect(seen[0].url).toBe('https://bedrock-runtime.eu-west-1.amazonaws.com/model/eu.anthropic.claude-haiku-4-5-20251001-v1:0/invoke-with-response-stream')
    expect(JSON.parse(seen[0].body)).toMatchObject({ anthropic_version: 'bedrock-2023-05-31' })
    expect(seen[1].url).toBe('https://bedrock-mantle.eu-west-1.api.aws/anthropic/v1/messages')
    for (const s of seen) expect(s.auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\//)
  })

  it('never thinks a text smaller than it is', () => {
    expect(estimateTokens('a'.repeat(300))).toBe(100)
  })

  it('switches between the local model and Bedrock as Settings say', async () => {
    let provider: 'local' | 'bedrock' = 'local'
    const local = { llm: vi.fn(async () => ({ contextSize: 1 }) as never), unload: vi.fn(async () => {}), loaded: () => 'x', needsLoad: () => true }
    const bedrock = { llm: vi.fn(async () => ({ contextSize: 2 }) as never), unload: vi.fn(async () => {}), loaded: () => undefined, needsLoad: () => false }
    const m = createSwitchingNotesModel({ local, bedrock, provider: () => provider })
    expect(m.needsLoad()).toBe(true)
    provider = 'bedrock'
    await m.llm()
    expect(bedrock.llm).toHaveBeenCalled()
    expect(m.needsLoad()).toBe(false)
    await m.switched()
    expect(local.unload).toHaveBeenCalled()
  })
})

describe('signing in to AWS', () => {
  const api = (over: Partial<SsoApi> = {}): SsoApi => ({
    register: async (region) => ({ clientId: 'c', clientSecret: 's', expiresAt: Date.now() + 90 * 86_400_000, region }),
    startDevice: async () => ({ deviceCode: 'd', userCode: 'WXYZ-1234', url: 'https://x.awsapps.com/start/#/device?user_code=WXYZ-1234', intervalSec: 1, expiresInSec: 60 }),
    createToken: async () => ({ accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600_000 }),
    listAccounts: async () => [{ id: '123456789012', name: 'Dev' }],
    listRoles: async () => ['BedrockUser'],
    roleCredentials: async () => ({ accessKeyId: 'AK', secretAccessKey: 'SK', sessionToken: 'ST', expiration: Date.now() + 3600_000 }),
    ...over,
  })
  const file = () => join(mkdtempSync(join(tmpdir(), 'sso-')), 'aws-sso.json')
  const seal = (s: string) => `x${s}`, open = (s: string) => s.slice(1)

  it('opens the browser, waits for approval, and keeps the sign-in sealed for the next launch', async () => {
    let tries = 0
    const opened: string[] = []
    const f = file()
    const sso = createSso({ file: f, seal, open, openExternal: (u) => opened.push(u), sleep: async () => {},
      api: api({ createToken: async () => { if (tries++ < 2) throw new PendingError('wait'); return { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600_000 } } }) })
    expect((await sso.signIn({ startUrl: 'https://x.awsapps.com/start', ssoRegion: 'eu-west-1' })).state).toBe('pending')
    expect(opened[0]).toContain('user_code=WXYZ-1234')
    await vi.waitFor(() => expect(sso.status().state).toBe('signed-in'))
    expect(await sso.credentials('123456789012', 'BedrockUser')).toMatchObject({ accessKeyId: 'AK' })
    const later = createSso({ file: f, seal, open, openExternal: () => {}, api: api() })
    expect(later.status().state).toBe('signed-in')
    later.signOut()
    expect(createSso({ file: f, seal, open, openExternal: () => {}, api: api() }).status().state).toBe('signed-out')
  })

  it('asks to sign in again when the token ran out and cannot be refreshed', async () => {
    const f = file()
    let now = Date.now()
    const sso = createSso({ file: f, seal, open, openExternal: () => {}, sleep: async () => {}, now: () => now,
      api: api({ createToken: async (_c, g) => { if ('refreshToken' in g) throw new Error('expired'); return { accessToken: 'a', expiresAt: now + 3600_000 } } }) })
    await sso.signIn({ startUrl: 'https://x.awsapps.com/start', ssoRegion: 'eu-west-1' })
    await vi.waitFor(() => expect(sso.status().state).toBe('signed-in'))
    now += 2 * 3600_000
    await expect(sso.credentials('123456789012', 'BedrockUser')).rejects.toBeInstanceOf(SignInNeededError)
    expect(sso.status().state).toBe('expired')
  })

  it('refuses a start URL that is not https', async () => {
    const sso = createSso({ file: file(), seal, open, openExternal: () => {}, api: api() })
    expect((await sso.signIn({ startUrl: 'http://x', ssoRegion: 'eu-west-1' })).state).toBe('error')
  })
})
