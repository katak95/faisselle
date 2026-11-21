import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MARK, WORD } from '../src/shared/logo'

const svg = (name: string) => readFileSync(join(import.meta.dirname, '../build', name), 'utf8')
const paths = (text: string) => [...text.matchAll(/ d="([^"]+)"/g)].map((m) => m[1])

// The app draws the logo from shared/logo.ts; the icons are rendered from build/*.svg. They must stay one drawing.
describe('logo', () => {
  it('keeps the f that scripts/brand.py drew (run it again after a design change, and update this)', () => {
    expect(createHash('sha256').update(MARK).digest('hex')).toBe('0afc32a5abd87013639619a23fe3be165c89e4463179d054ccbc4bea4192e4de')
  })
  it('matches build/logo.svg', () => {
    expect(paths(svg('logo.svg'))).toEqual([MARK])
  })
  it('matches build/wordmark.svg', () => {
    expect(paths(svg('wordmark.svg'))).toEqual([MARK, WORD])
  })
  it('matches the mark in build/icon.svg', () => {
    expect(paths(svg('icon.svg')).join('')).toBe(MARK)
  })
  it('centres the 100-unit mark on the 824-wide Mac tile, at about 60% of it', () => {
    const icon = svg('icon.svg')
    const mark = icon.match(/<path[^>]*transform="translate\(([^ ]+) ([^)]+)\) scale\(([^)]+)\)"/)!
    expect(mark).not.toBeNull()
    const [, x, y, scale] = mark.map(Number)
    expect(100 * scale / 824).toBeCloseTo(.607, 3)
    expect(x + 50 * scale).toBeCloseTo(512, 6)
    expect(y + 50 * scale).toBeCloseTo(512, 6)
  })
})
