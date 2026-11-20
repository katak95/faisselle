import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk'
import type { Llm } from './enhance'
import type { AwsKeys } from '../aws/sso'

/**
 * The notes model on Amazon Bedrock (Claude, by default Claude Haiku 5.5), as an `Llm` like the local one: the same
 * prompts, streamed back the same way. Nothing is loaded: a request goes out when a note is written.
 * The person signs in with AWS IAM Identity Center (aws/sso.ts); the role's keys sign each request.
 */

export type BedrockConfig = { region: string; modelId: string; accountId: string; roleName: string }

export const BEDROCK_DEFAULTS = { region: 'eu-west-1', modelId: 'anthropic.claude-haiku-5-5' } as const

/**
 * What the notes may read at once. Haiku 5.5 costs more above 100K input tokens: staying under it keeps a long
 * meeting at the low price (the notes split a longer one into parts, as they do for the local model).
 */
export const BEDROCK_CONTEXT = 96_000
/** an answer with no limit given (the local model has its own): long enough for any summary */
const DEFAULT_MAX_TOKENS = 8192
/** a prompt this long is worth caching: a follow-up (next steps, actions) that starts with it reads it from the cache */
const CACHE_FROM_CHARS = 8000

export const validModelId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9][a-z0-9.:_/-]{2,199}$/i.test(v)
export const validAccountId = (v: unknown): v is string => typeof v === 'string' && /^\d{12}$/.test(v)
export const validRoleName = (v: unknown): v is string => typeof v === 'string' && /^[\w+=,.@-]{1,64}$/.test(v)

/**
 * Tokens in a text, without asking AWS: about 3 characters each (French and German run longer than English's 4),
 * so a meeting is never thought smaller than it is.
 */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 3)

/** The part of the Anthropic client the notes use: a stand-in in tests */
export type MessagesClient = Pick<AnthropicBedrockMantle, 'messages'>

/** what went wrong, in words the notes can log and Settings can show */
export class BedrockError extends Error {
  name = 'BedrockError'
  constructor(message: string, readonly kind: 'sign-in' | 'access' | 'model' | 'refused' | 'other') { super(message) }
}

export function bedrockClient(region: string, keys: () => Promise<AwsKeys>): MessagesClient {
  return new AnthropicBedrockMantle({
    awsRegion: region,
    // the SSO role's keys, fetched again before they run out (aws/sso.ts)
    providerChainResolver: async () => async () => {
      const k = await keys()
      return { accessKeyId: k.accessKeyId, secretAccessKey: k.secretAccessKey, sessionToken: k.sessionToken, expiration: new Date(k.expiration) }
    },
    maxRetries: 3,
  })
}

const explain = (e: unknown): Error => {
  if (e instanceof BedrockError) return e
  const err = e as { status?: number; name?: string; message?: string }
  if (err?.name === 'SignInNeededError') return new BedrockError(err.message ?? 'Sign in to AWS', 'sign-in')
  if (err?.status === 401) return new BedrockError('AWS refused the sign-in: sign in again', 'sign-in')
  if (err?.status === 403) return new BedrockError('This AWS role may not use Bedrock, or the model is not enabled in this region', 'access')
  if (err?.status === 404) return new BedrockError('This model is not available in this region', 'model')
  return e instanceof Error ? e : new Error(String(e))
}

/**
 * One `Llm` on Bedrock. Each call reads the settings again, so a model or region changed in Settings applies to
 * the next note.
 */
export function createBedrockNotesModel(o: { config: () => BedrockConfig | undefined; client: (c: BedrockConfig) => MessagesClient }) {
  let cached: { key: string; client: MessagesClient } | undefined
  const clientFor = (c: BedrockConfig) => {
    const key = `${c.region}|${c.accountId}|${c.roleName}`
    if (cached?.key !== key) cached = { key, client: o.client(c) }
    return cached.client
  }

  const llm = async (signal?: AbortSignal): Promise<Llm> => {
    const c = o.config()
    if (!c) throw new BedrockError('Bedrock is not set up: sign in to AWS and choose an account and role in Settings', 'sign-in')
    const client = clientFor(c)
    return {
      contextSize: BEDROCK_CONTEXT,
      count: async (texts) => texts.map(estimateTokens),
      async chat(prompt, onToken, opts) {
        const pairs = opts?.before ?? []
        const turns = [...pairs, prompt]
        const messages = turns.map((text, i) => ({
          role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
          content: [{ type: 'text' as const, text, ...(i === 0 && text.length >= CACHE_FROM_CHARS ? { cache_control: { type: 'ephemeral' as const } } : {}) }],
        }))
        // short answers (titles, folders, one JSON list) need little effort; the notes themselves a bit more
        const small = (opts?.maxTokens ?? DEFAULT_MAX_TOKENS) <= 256 || !!opts?.summary
        try {
          const stream = client.messages.stream({
            model: c.modelId,
            max_tokens: opts?.maxTokens ?? DEFAULT_MAX_TOKENS,
            messages,
            // thinking would spend the answer's tokens: these prompts say exactly what to write
            thinking: { type: 'disabled' },
            output_config: { effort: small ? 'low' : 'medium', ...(opts?.json ? { format: { type: 'json_schema' as const, schema: opts.json } } : {}) },
          }, { signal })
          stream.on('text', (t) => { if (!signal?.aborted) onToken(t) })
          const m = await stream.finalMessage()
          if (m.stop_reason === 'refusal') throw new BedrockError('The model declined to write this', 'refused')
          const u = m.usage
          console.info('TIMING', `bedrock ${c.modelId}: read ${u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)} tok (${u.cache_read_input_tokens ?? 0} cached), wrote ${u.output_tokens} tok`)
          return m.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
        } catch (e) {
          if (signal?.aborted) return ''
          throw explain(e)
        }
      },
    }
  }

  return {
    llm,
    async unload() {},
    loaded: () => undefined as string | undefined,
    needsLoad: () => false,
  }
}
