import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
// @ts-expect-error plain script, no types
import { DEV_ID, fingerprint, pickIdentity, usageDescriptions } from '../scripts/dev-identity.mjs'

it("pnpm dev gives Electron every usage text the app ships with, so the Mac asks for each permission in Faisselle's words", () => {
  const texts = usageDescriptions(readFileSync(join(import.meta.dirname, '../electron-builder.yml'), 'utf8'))
  for (const key of ['NSMicrophoneUsageDescription', 'NSAudioCaptureUsageDescription', 'NSCalendarsFullAccessUsageDescription', 'NSCalendarsUsageDescription', 'NSAppleEventsUsageDescription']) {
    expect(texts[key], key).toMatch(/^Faisselle /)
  }
})

it('reads a usage text whether it is quoted or not, and leaves other keys alone', () => {
  expect(usageDescriptions('mac:\n  extendInfo:\n    NSCameraUsageDescription: "No camera."\n    NSMicrophoneUsageDescription: Your voice.\n    LSUIElement: true\n'))
    .toEqual({ NSCameraUsageDescription: 'No camera.', NSMicrophoneUsageDescription: 'Your voice.' })
})

it("signs with this Mac's Apple Development certificate, never a Developer ID one, and ad hoc without one", () => {
  const a = 'A'.repeat(40), d = 'D'.repeat(40)
  expect(pickIdentity(`  1) ${d} "Developer ID Application: Someone (TEAM1)"\n  2) ${a} "Apple Development: Someone (TEAM2)"\n     2 valid identities found`)).toBe(a)
  expect(pickIdentity(`  1) ${d} "Developer ID Application: Someone (TEAM1)"\n     1 valid identities found`)).toBeNull()
  expect(pickIdentity('     0 valid identities found')).toBeNull()
})

it("is set up again only when the texts or the certificate change, under its own app id, apart from the installed app's", () => {
  expect(DEV_ID).toBe('com.katak95.faisselle.dev')
  expect(fingerprint({ a: 'x' }, null)).toBe(fingerprint({ a: 'x' }, null))
  expect(fingerprint({ a: 'x' }, null)).not.toBe(fingerprint({ a: 'y' }, null))
  expect(fingerprint({ a: 'x' }, null)).not.toBe(fingerprint({ a: 'x' }, 'A'.repeat(40)))
})
