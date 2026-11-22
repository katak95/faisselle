import { closeSync, openSync, writeSync } from 'node:fs'

/** a WAV header for 16-bit mono PCM of `bytes` bytes */
export function wavHeader(rate: number, bytes: number): Buffer {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + bytes, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(bytes, 40)
  return h
}

/**
 * 16-bit mono PCM written as it comes; the header's sizes are set again every few seconds and at the end, so a file
 * cut short by a crash still plays up to there.
 */
export function wavWriter(path: string, rate: number) {
  const fd = openSync(path, 'w')
  let bytes = 0, lastHeader = 0
  writeSync(fd, wavHeader(rate, 0), 0, 44, 0)
  const header = () => { writeSync(fd, wavHeader(rate, bytes), 0, 44, 0); lastHeader = bytes }
  let open = true
  return {
    write(pcm: Buffer) {
      if (!open || !pcm.length) return
      writeSync(fd, pcm, 0, pcm.length, 44 + bytes)
      bytes += pcm.length
      if (bytes - lastHeader > rate * 2 * 5) header()
    },
    close() { if (!open) return; open = false; header(); closeSync(fd) },
    get bytes() { return bytes },
  }
}
export type WavWriter = ReturnType<typeof wavWriter>
