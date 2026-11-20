import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BEDROCK_CONTEXT, createBedrockNotesModel, estimateTokens, type MessagesClient } from '../src/main/notes/bedrock'
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
