// The voice interview: the expert's microphone in the window, Amazon Nova Sonic on Bedrock in main
// (main/expert/voice.ts), and what the window sees of the conversation.
import type { InterviewLanguage } from './types'

/** what Nova Sonic takes and gives: 16-bit mono PCM, 16 kHz from the microphone, 24 kHz back */
export const INPUT_RATE = 16_000
export const OUTPUT_RATE = 24_000
/** the window sends the microphone in frames of 32 ms */
export const FRAME_SAMPLES = 512
/** a frame main accepts: at most this many bytes, an even number */
export const FRAME_BYTES_MAX = 8192

/**
 * connecting: the first connection. listening, thinking, speaking: the conversation. paused: the expert paused (the
 * connection to Bedrock is closed meanwhile). reconnecting: a new connection after a drop or the 8-minute limit.
 */
export type VoiceState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'paused' | 'reconnecting' | 'ended' | 'failed'

/** why the voice stopped, for a message the expert can act on */
export type VoiceErrorKind = 'sign-in' | 'access' | 'model' | 'busy' | 'network' | 'microphone' | 'not-ready' | 'other'

export type VoiceView = {
  interviewId: string | null
  state: VoiceState
  muted: boolean
  /** the interview's length so far: earlier sessions, and this one up to now */
  elapsedMs: number
  /** when this view was made, for a clock that runs between views */
  at: number
  /** views are numbered: one answering a call can arrive after a later one sent by itself */
  seq: number
  region: string; modelId: string
  error?: { kind: VoiceErrorKind; detail?: string }
}

export type Speaker = 'expert' | 'agent'

/** a line of the interview, final as Nova Sonic gave it, or corrected by the expert */
export type TranscriptSegment = {
  id: string; interviewId: string; sessionId: string; speaker: Speaker; text: string
  /** where it is in the interview, across its sessions */
  atMs: number
  /** the expert corrected it; original is what was heard */
  edited: boolean; original: string | null
}
export const SEGMENT_MAX = 4000

export type VoiceApi = {
  state(): Promise<VoiceView>
  start(interviewId: string): Promise<VoiceView>
  pause(): Promise<VoiceView>
  resume(): Promise<VoiceView>
  stop(): Promise<VoiceView>
  mute(on: boolean): Promise<VoiceView>
  /** a frame of the microphone: 16-bit mono PCM at INPUT_RATE */
  audio(frame: ArrayBuffer): void
  onState(fn: (v: VoiceView) => void): () => void
  /** the agent's voice: 16-bit mono PCM at OUTPUT_RATE */
  onAudio(fn: (pcm: Uint8Array) => void): () => void
  /** the expert spoke over the agent: what is still queued is dropped */
  onInterrupted(fn: () => void): () => void
  onSegment(fn: (s: TranscriptSegment) => void): () => void
}

/** Nova Sonic's voice for a language (Nova 2 voices); tiffany speaks them all */
export function voiceFor(language: InterviewLanguage): string {
  return ({ 'fr-FR': 'ambre', 'en-US': 'tiffany', 'en-GB': 'amy', 'de-DE': 'tina', 'es-ES': 'lupe', 'it-IT': 'beatrice', 'pt-BR': 'carolina', 'hi-IN': 'kiara' } as const)[language] ?? 'tiffany'
}

