/* rebrand: keep-file (it is about Yogurt) */
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { figoluVersion, nextFigoluVersion } from '../scripts/version.mjs'

// sync-yogurt.yml renames every new Yogurt with this script before merging it: Figolu itself must already be what it
// makes, or each sync would undo or redo part of the rename
it('leaves Figolu as it is: the rename it does is already done here', () => {
  const root = join(import.meta.dirname, '../..')
  expect(execFileSync('python3', [join(root, 'app/scripts/rebrand.py'), '--check', root], { encoding: 'utf8' }).trim()).toBe('')
})

it("follows Yogurt's version: X.Y.Z is X.Y.(Z×100), then one more for each Figolu release in between", () => {
  expect(figoluVersion('0.3.59')).toBe('0.3.5900')
  expect(figoluVersion('0.3.60')).toBe('0.3.6000')
  expect(nextFigoluVersion('0.3.60', [])).toBe('0.3.6000')
  expect(nextFigoluVersion('0.3.60', ['v0.3.5900', 'v0.3.6000'])).toBe('0.3.6001')
  expect(nextFigoluVersion('0.3.60', ['v0.3.6000', 'v0.3.6001', 'v0.3.5999'])).toBe('0.3.6002')
  // a new Yogurt starts its own hundred again
  expect(nextFigoluVersion('0.3.61', ['v0.3.6003'])).toBe('0.3.6100')
  expect(nextFigoluVersion('0.4.0', ['v0.3.6100'])).toBe('0.4.0')
  expect(() => nextFigoluVersion('0.3.60', ['v0.3.6099'])).toThrow()
})
