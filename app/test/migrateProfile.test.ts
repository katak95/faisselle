/* rebrand: keep-file (names the Yogurt folder on purpose) */
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
describe('the Yogurt folder becomes Faisselle\'s', () => {
  it('moves the profile once, never over meetings already there', async () => {
    const { mkdirSync, writeFileSync, existsSync, readFileSync } = await import('node:fs')
    const { migrateProfile } = await import('../src/main/paths')
    const appData = mkdtempSync(join(tmpdir(), 'appdata-'))
    mkdirSync(join(appData, 'Yogurt', 'meetings'), { recursive: true })
    writeFileSync(join(appData, 'Yogurt', 'yogurt.db'), 'db')
    // Electron already made a Faisselle folder at a first launch: it holds no meetings, so it gives way
    mkdirSync(join(appData, 'Faisselle', 'Cache'), { recursive: true })
    expect(migrateProfile(appData)).toBe('moved')
    expect(readFileSync(join(appData, 'Faisselle', 'yogurt.db'), 'utf8')).toBe('db')
    expect(existsSync(join(appData, 'Yogurt'))).toBe(false)
    // later launches: nothing to do, and a Faisselle with meetings is never replaced
    mkdirSync(join(appData, 'Yogurt'), { recursive: true }); writeFileSync(join(appData, 'Yogurt', 'yogurt.db'), 'other')
    expect(migrateProfile(appData)).toBe('none')
    expect(readFileSync(join(appData, 'Faisselle', 'yogurt.db'), 'utf8')).toBe('db')
  })
})
