/* rebrand: keep-file (it is about Yogurt) */
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { faisselleVersion, nextFaisselleVersion } from '../scripts/version.mjs'

// sync-yogurt.yml renames every new Yogurt with this script before merging it: Faisselle itself must already be what it
// makes, or each sync would undo or redo part of the rename
it('leaves Faisselle as it is: the rename it does is already done here', () => {
  const root = join(import.meta.dirname, '../..')
  expect(execFileSync('python3', [join(root, 'app/scripts/rebrand.py'), '--check', root], { encoding: 'utf8' }).trim()).toBe('')
// it reads the whole repository: a few seconds alone, more while every other test runs beside it
}, 30_000)

it("follows Yogurt's version: X.Y.Z is X.Y.(Z×100), then one more for each Faisselle release in between", () => {
  expect(faisselleVersion('0.3.59')).toBe('0.3.5900')
  expect(faisselleVersion('0.3.60')).toBe('0.3.6000')
  expect(nextFaisselleVersion('0.3.60', [])).toBe('0.3.6000')
  expect(nextFaisselleVersion('0.3.60', ['v0.3.5900', 'v0.3.6000'])).toBe('0.3.6001')
  expect(nextFaisselleVersion('0.3.60', ['v0.3.6000', 'v0.3.6001', 'v0.3.5999'])).toBe('0.3.6002')
  // a new Yogurt starts its own hundred again
  expect(nextFaisselleVersion('0.3.61', ['v0.3.6003'])).toBe('0.3.6100')
  expect(nextFaisselleVersion('0.4.0', ['v0.3.6100'])).toBe('0.4.0')
  expect(() => nextFaisselleVersion('0.3.60', ['v0.3.6099'])).toThrow()
})
