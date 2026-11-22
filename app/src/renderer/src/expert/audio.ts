// The voice interview's sound in the window: the microphone to main, and the agent's voice from it.
// Both go through the browser's audio, so its echo cancellation keeps the agent's voice out of the microphone
// (the agent would otherwise hear itself and stop talking).
import workletUrl from './capture.worklet.js?url&no-inline'
import { INPUT_RATE, OUTPUT_RATE } from '../../../shared/expert/voice'

export type MicError = 'denied' | 'none' | 'failed'

/**
 * The microphone, sent in frames as they come. It follows the system's default input: a headset plugged in or
 * taken out is picked up again. onError: it can't be used (refused, missing).
 */
export async function startMicrophone(o: { onFrame(pcm: ArrayBuffer): void; onLevel?(peak: number): void; onError(e: MicError): void }) {
  const ctx = new AudioContext({ sampleRate: INPUT_RATE })
  await ctx.audioWorklet.addModule(workletUrl)
  const node = new AudioWorkletNode(ctx, 'faisselle-capture')
  node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; peak: number }>) => { o.onFrame(e.data.pcm); o.onLevel?.(e.data.peak) }
  let stream: MediaStream | undefined, source: MediaStreamAudioSourceNode | undefined, stopped = false
  const open = async () => {
    try {
      const next = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
      if (stopped) { for (const t of next.getTracks()) t.stop(); return }
      source?.disconnect(); for (const t of stream?.getTracks() ?? []) t.stop()
      stream = next
      source = ctx.createMediaStreamSource(stream)
      source.connect(node)
      for (const t of stream.getAudioTracks()) t.onended = () => { if (!stopped) void open() }
    } catch (e) {
      const name = (e as DOMException)?.name
      o.onError(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' ? 'none' : 'failed')
    }
  }
  const changed = () => { if (!stopped) void open() }
  navigator.mediaDevices.addEventListener('devicechange', changed)
  await open()
  return {
    stop() {
      stopped = true
      navigator.mediaDevices.removeEventListener('devicechange', changed)
      source?.disconnect(); node.port.onmessage = null
      for (const t of stream?.getTracks() ?? []) t.stop()
      void ctx.close()
    },
  }
}

/** the agent's voice, played in order as it comes; flush drops what is still to play (the expert spoke over it) */
export function createPlayer() {
  const ctx = new AudioContext({ sampleRate: OUTPUT_RATE })
  let next = 0
  const playing = new Set<AudioBufferSourceNode>()
  return {
    play(pcm: Uint8Array) {
      const bytes = pcm.byteOffset % 2 ? pcm.slice() : pcm
      const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2))
      if (!samples.length) return
      const buffer = ctx.createBuffer(1, samples.length, OUTPUT_RATE)
      const ch = buffer.getChannelData(0)
      for (let i = 0; i < samples.length; i++) ch[i] = samples[i] / 0x8000
      const src = ctx.createBufferSource()
      src.buffer = buffer
      src.connect(ctx.destination)
      next = Math.max(next, ctx.currentTime + 0.05)
      src.start(next)
      next += buffer.duration
      playing.add(src)
      src.onended = () => playing.delete(src)
    },
    flush() {
      for (const s of playing) { try { s.stop() } catch { /* already ended */ } }
      playing.clear(); next = 0
    },
    /** something is still to be heard */
    busy: () => playing.size > 0,
    close() { this.flush(); void ctx.close() },
  }
}
