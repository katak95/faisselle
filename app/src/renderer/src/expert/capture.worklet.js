// The microphone, in frames of 512 samples (32 ms at 16 kHz) of 16-bit PCM, for the voice interview (audio.ts).
// It runs in an AudioContext at 16 kHz: the browser resamples the microphone to it.
class Capture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.frame = new Int16Array(512)
    this.n = 0
    this.peak = 0
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch) return true
    for (let i = 0; i < ch.length; i++) {
      const v = Math.max(-1, Math.min(1, ch[i]))
      this.peak = Math.max(this.peak, Math.abs(v))
      this.frame[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff
      if (this.n === this.frame.length) {
        const out = this.frame.buffer
        this.port.postMessage({ pcm: out, peak: this.peak }, [out])
        this.frame = new Int16Array(512)
        this.n = 0
        this.peak = 0
      }
    }
    return true
  }
}
registerProcessor('faisselle-capture', Capture)
