// A stand-in for Nova Sonic (fake mode, tests): it greets, then answers each stretch of sound from the microphone
// with a scripted exchange, in the events Nova Sonic sends. FAISSELLE_FAKE_SONIC=access|model|busy|drop makes it fail.
import { randomUUID } from 'node:crypto'
import type { SonicEvent, SonicTransport } from './sonic'

const EXPERT = [
  'We close the books on the fifth working day of the month.',
  'First I reconcile the bank accounts, then the supplier invoices.',
  'If an invoice is missing, I ask purchasing before the third day.',
]
const AGENT = [
  'Hello! Thanks for your time. What does a typical month-end close look like for you?',
  'Why the fifth working day, and what happens before it?',
  'What do you check first, and how do you know it is right?',
  'Let me check: you ask purchasing before the third working day. Is that right?',
]

/** a burst of the microphone this long (frames of 32 ms) is taken as one turn of the expert */
const FRAMES_PER_TURN = 30

export function fakeSonicTransport(o: { failure?: string; framesPerTurn?: number; audioMs?: number } = {}): SonicTransport {
  const failure = o.failure ?? process.env.FAISSELLE_FAKE_SONIC
  const framesPerTurn = o.framesPerTurn ?? FRAMES_PER_TURN
  const audioBytes = Math.round(((o.audioMs ?? 200) / 1000) * 24_000) * 2
  let turns = 0
  return async function* ({ input, signal }) {
    if (failure === 'access') throw Object.assign(new Error('User is not authorized to perform: bedrock:InvokeModel'), { name: 'AccessDeniedException', $metadata: { httpStatusCode: 403 } })
    if (failure === 'model') throw Object.assign(new Error('The provided model identifier is invalid.'), { name: 'ValidationException', $metadata: { httpStatusCode: 400 } })
    if (failure === 'busy') throw Object.assign(new Error('Too many requests'), { name: 'ThrottlingException', $metadata: { httpStatusCode: 429 } })
    const out: SonicEvent[] = []
    let wake: (() => void) | undefined, done = false
    const emit = (...e: SonicEvent[]) => { out.push(...e); wake?.() }
    const content = (role: string, type: string, extra: Record<string, unknown> = {}) => {
      const contentId = randomUUID()
      emit({ event: { contentStart: { contentId, role, type, ...extra } } })
      return contentId
    }
    const say = (role: 'USER' | 'ASSISTANT', text: string, stage: 'FINAL' | 'SPECULATIVE') => {
      const id = content(role, 'TEXT', { additionalModelFields: JSON.stringify({ generationStage: stage }) })
      emit({ event: { textOutput: { contentId: id, role, content: text } } }, { event: { contentEnd: { contentId: id, stopReason: 'END_TURN' } } })
    }
    const answer = () => {
      const text = AGENT[Math.min(turns, AGENT.length - 1)]
      turns++
      emit({ event: { completionStart: { completionId: randomUUID() } } })
      say('ASSISTANT', text, 'SPECULATIVE')
      const audio = content('ASSISTANT', 'AUDIO')
      emit({ event: { audioOutput: { contentId: audio, content: Buffer.alloc(audioBytes).toString('base64') } } }, { event: { contentEnd: { contentId: audio, stopReason: 'END_TURN' } } })
      say('ASSISTANT', text, 'FINAL')
      emit({ event: { completionEnd: { stopReason: 'END_TURN' } } })
    }
    void (async () => {
      let frames = 0, spoken = 0
      for await (const e of input) {
        const ev = (e.event ?? {}) as Record<string, Record<string, unknown>>
        if (ev.textInput && String(ev.textInput.content).startsWith('[Faisselle:')) answer()
        if (ev.audioInput) {
          frames++
          if (failure === 'drop' && frames === framesPerTurn) { done = true; wake?.(); return }
          if (frames % framesPerTurn === 0) {
            say('USER', EXPERT[spoken % EXPERT.length], 'FINAL')
            spoken++
            answer()
          }
        }
      }
      done = true; wake?.()
    })()
    while (!signal.aborted) {
      while (out.length) yield out.shift()!
      if (done) {
        if (failure === 'drop') throw Object.assign(new Error('socket hang up'), { name: 'Error', code: 'ECONNRESET' })
        return
      }
      await new Promise<void>((r) => { wake = r; signal.addEventListener('abort', () => r(), { once: true }) })
    }
  }
}
