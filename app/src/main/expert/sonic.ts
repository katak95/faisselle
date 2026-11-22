// Amazon Nova Sonic's event protocol over Bedrock's bidirectional stream (InvokeModelWithBidirectionalStream):
// the events sent, in their order, and what comes back, read into a few plain kinds. Nothing here keeps any audio or text.
//   sessionStart → promptStart → SYSTEM text → history (USER/ASSISTANT texts) → USER audio (interactive) ⇄ answers
//   … → contentEnd (audio) → promptEnd → sessionEnd
import { randomUUID } from 'node:crypto'
import { INPUT_RATE, OUTPUT_RATE } from '../../shared/expert/voice'
import type { BedrockAuth } from '../notes/bedrock'

export type SonicEvent = Record<string, unknown>
export type HistoryTurn = { role: 'USER' | 'ASSISTANT'; text: string }
export type SonicSetup = { voiceId: string; system: string; history: HistoryTurn[] }

/** Nova Sonic's limit for one text content, kept under with room to spare */
export const TEXT_MAX = 10_000
/** what is replayed of an interview when a new connection starts: the latest turns, up to this many characters */
export const HISTORY_CHARS = 40_000

const text = (promptName: string, role: 'SYSTEM' | 'USER' | 'ASSISTANT', content: string, interactive: boolean): SonicEvent[] => {
  const contentName = randomUUID()
  return [
    { event: { contentStart: { promptName, contentName, type: 'TEXT', interactive, role, textInputConfiguration: { mediaType: 'text/plain' } } } },
    { event: { textInput: { promptName, contentName, content: content.slice(0, TEXT_MAX) } } },
    { event: { contentEnd: { promptName, contentName } } },
  ]
}

/**
 * History as Nova Sonic takes it: the latest turns within HISTORY_CHARS, each role's lines run together, starting
 * with the user's (the model refuses history that starts with its own turn).
 */
export function historyFor(turns: HistoryTurn[]): HistoryTurn[] {
  const merged: HistoryTurn[] = []
  for (const t of turns) {
    const s = t.text.trim()
    if (!s) continue
    const last = merged[merged.length - 1]
    if (last?.role === t.role) last.text = `${last.text} ${s}`
    else merged.push({ role: t.role, text: s })
  }
  const kept: HistoryTurn[] = []
  let chars = 0
  for (let i = merged.length - 1; i >= 0; i--) {
    const turn = { ...merged[i], text: merged[i].text.slice(-TEXT_MAX) }
    if (chars + turn.text.length > HISTORY_CHARS && kept.length) break
    kept.unshift(turn); chars += turn.text.length
  }
  while (kept[0]?.role === 'ASSISTANT') kept.shift()
  return kept
}

/** the events that open a connection, up to the microphone's content (opened by audioStart) */
export function openingEvents(promptName: string, s: SonicSetup): SonicEvent[] {
  return [
    { event: { sessionStart: { inferenceConfiguration: { maxTokens: 1024, topP: 0.9, temperature: 0.7 } } } },
    { event: { promptStart: { promptName,
      textOutputConfiguration: { mediaType: 'text/plain' },
      audioOutputConfiguration: { mediaType: 'audio/lpcm', sampleRateHertz: OUTPUT_RATE, sampleSizeBits: 16, channelCount: 1, voiceId: s.voiceId, encoding: 'base64', audioType: 'SPEECH' } } } },
    ...text(promptName, 'SYSTEM', s.system, false),
    ...historyFor(s.history).flatMap((t) => text(promptName, t.role, t.text, false)),
  ]
}

export const audioStart = (promptName: string, contentName: string): SonicEvent => ({ event: { contentStart: { promptName, contentName, type: 'AUDIO', interactive: true, role: 'USER',
  audioInputConfiguration: { mediaType: 'audio/lpcm', sampleRateHertz: INPUT_RATE, sampleSizeBits: 16, channelCount: 1, audioType: 'SPEECH', encoding: 'base64' } } } })
export const audioInput = (promptName: string, contentName: string, pcm: Buffer): SonicEvent => ({ event: { audioInput: { promptName, contentName, content: pcm.toString('base64') } } })
/** a turn typed rather than spoken (the interview's guidance, between two of the expert's turns) */
export const userText = (promptName: string, content: string): SonicEvent[] => text(promptName, 'USER', content, true)
export const closingEvents = (promptName: string, audioContentName: string | null): SonicEvent[] => [
  ...(audioContentName ? [{ event: { contentEnd: { promptName, contentName: audioContentName } } }] : []),
  { event: { promptEnd: { promptName } } },
  { event: { sessionEnd: {} } },
]

export type SonicOutput =
  | { kind: 'expert'; text: string }
  | { kind: 'agent'; text: string }
  /** the agent's planned words, before it speaks them: shown, never kept */
  | { kind: 'agent-preview'; text: string }
  | { kind: 'audio'; pcm: Buffer }
  | { kind: 'interrupted' }
  | { kind: 'turn-end' }

const INTERRUPTED = /^\s*\{\s*"interrupted"\s*:\s*true\s*\}\s*$/

/** reads Nova Sonic's events: each text belongs to the content started before it (its role and stage) */
export function createOutputReader() {
  const contents = new Map<string, { role?: string; type?: string; stage?: string }>()
  return (raw: SonicEvent): SonicOutput[] => {
    const e = (raw.event ?? {}) as Record<string, Record<string, unknown> | undefined>
    if (e.contentStart) {
      const c = e.contentStart
      let stage: string | undefined
      try { stage = (JSON.parse(String(c.additionalModelFields ?? '{}')) as { generationStage?: string }).generationStage } catch { /* none */ }
      contents.set(String(c.contentId ?? c.contentName ?? ''), { role: c.role as string, type: c.type as string, stage })
      return []
    }
    if (e.textOutput) {
      const c = contents.get(String(e.textOutput.contentId ?? e.textOutput.contentName ?? ''))
      const s = String(e.textOutput.content ?? '')
      const role = (e.textOutput.role as string | undefined) ?? c?.role
      if (INTERRUPTED.test(s)) return [{ kind: 'interrupted' }]
      if (!s.trim()) return []
      if (role === 'USER') return [{ kind: 'expert', text: s.trim() }]
      if (role === 'ASSISTANT') return [{ kind: c?.stage === 'SPECULATIVE' ? 'agent-preview' : 'agent', text: s.trim() }]
      return []
    }
    if (e.audioOutput) return [{ kind: 'audio', pcm: Buffer.from(String(e.audioOutput.content ?? ''), 'base64') }]
    if (e.contentEnd) {
      const id = String(e.contentEnd.contentId ?? e.contentEnd.contentName ?? '')
      contents.delete(id)
      return e.contentEnd.stopReason === 'INTERRUPTED' ? [{ kind: 'interrupted' }] : []
    }
    if (e.completionEnd) return [{ kind: 'turn-end' }]
    return []
  }
}

/** Bedrock's answer as an error the expert can act on: where it came from, and what kind it is */
export class SonicError extends Error {
  constructor(message: string, readonly kind: 'sign-in' | 'access' | 'model' | 'busy' | 'network' | 'timeout' | 'other') { super(message) }
}

/** an AWS SDK error (or a stream's error event) as a SonicError */
export function sonicError(e: unknown): SonicError {
  if (e instanceof SonicError) return e
  const err = e as { name?: string; message?: string; $metadata?: { httpStatusCode?: number }; code?: string }
  const name = err?.name ?? '', status = err?.$metadata?.httpStatusCode
  const message = String(err?.message ?? e).slice(0, 300)
  if (name === 'SignInNeededError') return new SonicError(message, 'sign-in')
  if (name === 'AccessDeniedException' || status === 403) return new SonicError(message, 'access')
  if (name === 'ResourceNotFoundException' || status === 404 || (name === 'ValidationException' && /model/i.test(message))) return new SonicError(message, 'model')
  if (name === 'ThrottlingException' || name === 'ServiceQuotaExceededException' || name === 'serviceQuotaExceeded' || status === 429) return new SonicError(message, 'busy')
  if (name === 'ModelTimeoutException' || name === 'modelTimeoutException' || status === 408) return new SonicError(message, 'timeout')
  if (/ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network|GOAWAY|ERR_HTTP2/i.test(`${name} ${err?.code ?? ''} ${message}`) || name === 'ModelStreamErrorException' || name === 'modelStreamErrorException'
    || name === 'InternalServerException' || name === 'internalServerException' || name === 'ServiceUnavailableException' || status === 500 || status === 503) return new SonicError(message, 'network')
  return new SonicError(message, 'other')
}

/** one connection: the events sent, and what comes back; ends when the input ends or the signal aborts */
export type SonicTransport = (o: { region: string; modelId: string; input: AsyncIterable<SonicEvent>; signal: AbortSignal }) => AsyncIterable<SonicEvent>

/**
 * The real one: Bedrock Runtime in the region, signed like the notes: with the SSO role's keys (aws/sso.ts), or a
 * Bedrock API key sent as a bearer token (aws/apiKey.ts). auth is read again for each connection.
 */
export function bedrockSonicTransport(auth: () => BedrockAuth): SonicTransport {
  return async function* ({ region, modelId, input, signal }) {
    const { BedrockRuntimeClient, InvokeModelWithBidirectionalStreamCommand } = await import('@aws-sdk/client-bedrock-runtime')
    let a: BedrockAuth
    try { a = auth() } catch (e) { throw sonicError(e) }
    const client = 'apiKey' in a
      ? new BedrockRuntimeClient({ region, maxAttempts: 1, token: async () => ({ token: a.apiKey }), authSchemePreference: ['httpBearerAuth'] })
      : new BedrockRuntimeClient({ region, maxAttempts: 1, credentials: async () => {
        const k = await a.keys()
        return { accessKeyId: k.accessKeyId, secretAccessKey: k.secretAccessKey, sessionToken: k.sessionToken, expiration: new Date(k.expiration) }
      } })
    const encoder = new TextEncoder(), decoder = new TextDecoder()
    async function* body() { for await (const e of input) yield { chunk: { bytes: encoder.encode(JSON.stringify(e)) } } }
    try {
      const r = await client.send(new InvokeModelWithBidirectionalStreamCommand({ modelId, body: body() }), { abortSignal: signal })
      for await (const part of r.body ?? []) {
        const p = part as unknown as Record<string, { bytes?: Uint8Array; message?: string } | undefined>
        if (p.chunk?.bytes) { yield JSON.parse(decoder.decode(p.chunk.bytes)) as SonicEvent; continue }
        const [name, value] = Object.entries(p)[0] ?? []
        if (name) throw sonicError(Object.assign(new Error(value?.message ?? name), { name }))
      }
    } catch (e) {
      if (signal.aborted) return
      throw sonicError(e)
    } finally { client.destroy() }
  }
}
