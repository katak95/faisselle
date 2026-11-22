import { AnthropicBedrock, AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk'
import type { Llm } from './enhance'
import type { AwsKeys } from '../aws/sso'

/**
 * The notes model on Amazon Bedrock (Claude, by default Claude Haiku 5.5), as an `Llm` like the local one: the same
 * prompts, streamed back the same way. Nothing is loaded: a request goes out when a note is written.
 * The person signs in with AWS IAM Identity Center (aws/sso.ts); the role's keys sign each request.
 *
 * Two doors into Bedrock, chosen from the model ID (bedrockEndpoint):
 * - Claude in Amazon Bedrock, the Messages API on bedrock-mantle (`anthropic.claude-haiku-5-5`): the role needs
 *   `bedrock-mantle:CreateInference`;
 * - InvokeModel on bedrock-runtime, with a model ID or an inference profile as other AWS projects use them
 *   (`eu.anthropic.claude-haiku-4-5-20251001-v1:0`, an ARN): the role needs `bedrock:InvokeModelWithResponseStream`.
 * @anthropic-ai/bedrock-sdk stays on 0.x: its 1.x sends API version 2026-10-21, which Bedrock takes only for
 * Claude 4.7 and later, and these roles often use Claude Haiku 4.5.
 */

export type BedrockConfig = { region: string; modelId: string; accountId: string; roleName: string }

/** Claude Haiku 4.5 through the EU inference profile, which eu-west-1 needs (the bare model ID is refused there) */
export const BEDROCK_DEFAULTS = { region: 'eu-west-1', modelId: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0' } as const

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

export type BedrockEndpoint = 'mantle' | 'runtime'
/**
 * Which door a model ID goes through: the Messages API's own IDs (`anthropic.claude-haiku-5-5`) on bedrock-mantle;
 * InvokeModel's versioned IDs (`anthropic.claude-haiku-4-5-20251001-v1:0`), inference profiles (`eu.`, `us.`,
 * `global.`...) and ARNs on bedrock-runtime.
 */
export function bedrockEndpoint(modelId: string): BedrockEndpoint {
  const id = modelId.trim()
  if (/^arn:/i.test(id)) return 'runtime'
  if (/^(us|eu|apac|ap|jp|au|ca|global|us-gov)\./i.test(id)) return 'runtime'
  if (/-v\d+(:\d+)?$/i.test(id)) return 'runtime'
  return 'mantle'
}

/**
 * What a model takes: the effort level came with Claude Opus 4.5, the Sonnet 4.6 and Haiku 5 generations, and is
 * refused before (Claude Haiku 4.5, Sonnet 4.5). An ID Faisselle can't read is taken as a current model.
 */
export function modelTakesEffort(modelId: string): boolean {
  const m = /claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?/i.exec(modelId)
  if (!m) return true
  const family = m[1].toLowerCase(), major = Number(m[2]), minor = m[3] && m[3].length <= 2 ? Number(m[3]) : 0
  const v = major + minor / 10
  if (family === 'fable' || family === 'mythos') return true
  if (family === 'opus') return v >= 4.5
  if (family === 'sonnet') return v >= 4.6
  return v >= 5
}
export const validAccountId = (v: unknown): v is string => typeof v === 'string' && /^\d{12}$/.test(v)
export const validRoleName = (v: unknown): v is string => typeof v === 'string' && /^[\w+=,.@-]{1,64}$/.test(v)

/**
 * Tokens in a text, without asking AWS: about 3 characters each (French and German run longer than English's 4),
 * so a meeting is never thought smaller than it is.
 */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 3)

/** The part of the Anthropic client the notes use: a stand-in in tests */
export type MessagesClient = { messages: Pick<AnthropicBedrockMantle['messages'], 'stream'> }

/** what went wrong, in words the notes can log and Settings can show */
export class BedrockError extends Error {
  name = 'BedrockError'
  constructor(message: string, readonly kind: 'sign-in' | 'access' | 'model' | 'refused' | 'other') { super(message) }
}

export function bedrockClient(region: string, keys: () => Promise<AwsKeys>, endpoint: BedrockEndpoint = 'mantle'): MessagesClient {
  const options = {
    awsRegion: region,
    // the SSO role's keys, fetched again before they run out (aws/sso.ts)
    providerChainResolver: async () => async () => {
      const k = await keys()
      return { accessKeyId: k.accessKeyId, secretAccessKey: k.secretAccessKey, sessionToken: k.sessionToken, expiration: new Date(k.expiration) }
    },
    maxRetries: 3,
  }
  return endpoint === 'runtime' ? new AnthropicBedrock(options) : new AnthropicBedrockMantle(options)
}

const explain = (e: unknown, c: BedrockConfig): Error => {
  if (e instanceof BedrockError) return e
  const err = e as { status?: number; name?: string; message?: string }
  const endpoint = bedrockEndpoint(c.modelId)
  if (err?.name === 'SignInNeededError') return new BedrockError(err.message ?? 'Sign in to AWS', 'sign-in')
  if (err?.status === 401) return new BedrockError('AWS refused the sign-in: sign in again', 'sign-in')
  // the permission differs with the door: say which one this role lacks
  if (err?.status === 403) return new BedrockError(endpoint === 'runtime'
    ? `This AWS role may not call ${c.modelId} with bedrock:InvokeModelWithResponseStream in ${c.region}, or the model is not enabled there`
    : `This AWS role may not call ${c.modelId} with bedrock-mantle:CreateInference in ${c.region}, or the model is not enabled there. A role that works elsewhere with InvokeModel: use its model ID or inference profile (for example eu.anthropic.claude-haiku-4-5-20251001-v1:0)`, 'access')
  if (err?.status === 404) return new BedrockError(`${c.modelId} is not available in ${c.region}${endpoint === 'mantle' ? ' (Claude in Amazon Bedrock takes IDs like anthropic.claude-haiku-5-5)' : ''}`, 'model')
  return e instanceof Error ? e : new Error(String(e))
}

/**
 * One `Llm` on Bedrock. Each call reads the settings again, so a model or region changed in Settings applies to
 * the next note.
 */
export function createBedrockNotesModel(o: { config: () => BedrockConfig | undefined; client: (c: BedrockConfig) => MessagesClient }) {
  let cached: { key: string; client: MessagesClient } | undefined
  const clientFor = (c: BedrockConfig) => {
    const key = `${c.region}|${c.accountId}|${c.roleName}|${bedrockEndpoint(c.modelId)}`
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
        // Claude Haiku 4.5 and older refuse the effort level: only the JSON format then, if any
        const effort = modelTakesEffort(c.modelId) ? { effort: small ? 'low' as const : 'medium' as const } : {}
        const format = opts?.json ? { format: { type: 'json_schema' as const, schema: opts.json } } : undefined
        const output = effort.effort || format ? { output_config: { ...effort, ...format } } : {}
        try {
          const stream = client.messages.stream({
            model: c.modelId,
            max_tokens: opts?.maxTokens ?? DEFAULT_MAX_TOKENS,
            messages,
            // thinking would spend the answer's tokens: these prompts say exactly what to write
            thinking: { type: 'disabled' },
            ...output,
          }, { signal })
          stream.on('text', (t) => { if (!signal?.aborted) onToken(t) })
          const m = await stream.finalMessage()
          if (m.stop_reason === 'refusal') throw new BedrockError('The model declined to write this', 'refused')
          const u = m.usage
          console.info('TIMING', `bedrock ${c.modelId}: read ${u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)} tok (${u.cache_read_input_tokens ?? 0} cached), wrote ${u.output_tokens} tok`)
          return m.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
        } catch (e) {
          if (signal?.aborted) return ''
          throw explain(e, c)
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
