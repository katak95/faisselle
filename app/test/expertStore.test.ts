import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { EXPERT_DB_VERSION, ExpertStore } from '../src/main/expert/store'
import { readSource } from '../src/main/expert/sources'
import { cleanSettingsPatch } from '../src/main/expert/ipc'
import { cleanDraft, cleanDraftPatch, consentHolds, EXPERT_DEFAULTS, GOAL_MAX, interviewLanguageFor, isExpertRoute, TITLE_MAX } from '../src/shared/expert/types'
import { isAppRoute } from '../src/shared/routes'

const dir = () => mkdtempSync(join(tmpdir(), 'faisselle-expert-'))
const draft = { title: 'Month-end close', domain: 'Accounting', goal: 'Close the books', language: 'fr-FR' as const, minutes: 30 }

describe('the expert interviews database', () => {
  it('creates, changes, reopens and deletes an interview with its sources and folder', () => {
    const d = dir()
    let at = 1000
    const s = new ExpertStore(d, () => at)
    const i = s.create(draft)
    expect(i).toMatchObject({ ...draft, state: 'draft', consent: null, createdAt: 1000 })
    at = 2000
    s.addSource(i.id, 'procedure.md', '# Steps', 7)
    expect(s.update(i.id, { goal: 'Close the books in five days' })).toMatchObject({ goal: 'Close the books in five days', updatedAt: 2000 })
    s.close()

    const again = new ExpertStore(d)
    expect(again.list()).toEqual([expect.objectContaining({ id: i.id, sources: 1 })])
    expect(again.sources(i.id)).toEqual([expect.objectContaining({ name: 'procedure.md', bytes: 7 })])
    expect(again.sourceTexts(i.id)).toEqual([{ name: 'procedure.md', content: '# Steps' }])
    mkdirSync(again.folder(i.id))
    writeFileSync(join(again.folder(i.id), 'audio.wav'), 'x')
    expect(again.delete(i.id)).toBe(true)
    expect(existsSync(again.folder(i.id))).toBe(false)
    expect(again.list()).toEqual([])
    // sources go with their interview
    expect(again.db.prepare('SELECT COUNT(*) AS n FROM sources').get()).toEqual({ n: 0 })
    expect(again.delete(i.id)).toBe(false)
  })

  it('records the consent with the regions and models of now, and readies a draft', () => {
    const s = new ExpertStore(dir(), () => 5)
    const i = s.create(draft)
    const now = { voiceRegion: 'eu-north-1', voiceModelId: 'amazon.nova-2-5-sonic', region: 'eu-west-1', modelId: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0' }
    const ready = s.consent(i.id, now)!
    expect(ready.state).toBe('ready')
    expect(ready.consent).toEqual({ ...now, at: 5 })
    expect(consentHolds(ready.consent, now)).toBe(true)
    expect(consentHolds(ready.consent, { ...now, voiceRegion: 'us-east-1' })).toBe(false)
    expect(consentHolds(null, now)).toBe(false)
  })

  it('keeps its settings, with the defaults for what was never set', () => {
    const d = dir()
    const s = new ExpertStore(d)
    expect(s.settings()).toEqual(EXPERT_DEFAULTS)
    s.setSettings({ voiceRegion: 'us-east-1', keepAudio: false })
    s.close()
    expect(new ExpertStore(d).settings()).toEqual({ ...EXPERT_DEFAULTS, voiceRegion: 'us-east-1', keepAudio: false })
  })

  it('is a database of its own, at the latest version', () => {
    const d = dir()
    new ExpertStore(d).close()
    const db = new DatabaseSync(join(d, 'expert.db'))
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: EXPERT_DB_VERSION })
    db.close()
  })
})

describe('what a page sends about an interview', () => {
  it('needs a title, and keeps each field within its limits', () => {
    expect(cleanDraft({ domain: 'x' })).toBeUndefined()
    expect(cleanDraft('nope')).toBeUndefined()
    expect(cleanDraft({ title: '  Close\nthe books  ' })).toEqual({ title: 'Close the books', domain: '', goal: '', language: 'en-US', minutes: 30 })
    const long = cleanDraft({ title: 'x'.repeat(500), goal: 'y'.repeat(5000), minutes: 9999, language: 'xx-XX' }, 'fr-FR')!
    expect(long.title).toHaveLength(TITLE_MAX)
    expect(long.goal).toHaveLength(GOAL_MAX)
    expect(long.minutes).toBe(180)
    expect(long.language).toBe('fr-FR')
    expect(cleanDraftPatch({ minutes: 1, title: '' })).toEqual({ minutes: 5 })
    expect(cleanDraftPatch({ goal: 'line one\nline two' })).toEqual({ goal: 'line one\nline two' })
  })

  it('picks the interview language closest to the app’s', () => {
    expect(interviewLanguageFor('fr')).toBe('fr-FR')
    expect(interviewLanguageFor('pt-BR')).toBe('pt-BR')
    expect(interviewLanguageFor('ja')).toBe('en-US')
  })

  it('changes only valid settings', () => {
    expect(cleanSettingsPatch({ voiceRegion: 'eu-north-1', voiceModelId: 'amazon.nova-2-5-sonic', analysisModelId: '', keepAudio: false }))
      .toEqual({ voiceRegion: 'eu-north-1', voiceModelId: 'amazon.nova-2-5-sonic', analysisModelId: '', keepAudio: false })
    expect(cleanSettingsPatch({ voiceRegion: 'stockholm', voiceModelId: '../x y', keepAudio: 'yes' })).toEqual({})
    expect(cleanSettingsPatch(null)).toEqual({})
  })

  it('opens the interview routes, and no others', () => {
    expect(isExpertRoute('/interviews')).toBe(true)
    expect(isExpertRoute('/interview/1b2c-3d')).toBe(true)
    expect(isExpertRoute('/interview/../x')).toBe(false)
    expect(isAppRoute('/interview/abc')).toBe(true)
    expect(isAppRoute('/interviews/x')).toBe(false)
  })
})

describe('a local source', () => {
  it('is read as text, and refused when too big, binary or not UTF-8', () => {
    const d = dir()
    const file = (name: string, data: string | Buffer) => { const p = join(d, name); writeFileSync(p, data); return p }
    expect(readSource(file('notes.md', '﻿# Close'))).toEqual({ ok: true, name: 'notes.md', content: '# Close', bytes: 10 })
    expect(readSource(file('photo.png', 'x'))).toMatchObject({ ok: false, reason: 'not-text' })
    expect(readSource(file('nul.txt', Buffer.from([65, 0, 66])))).toMatchObject({ ok: false, reason: 'not-text' })
    expect(readSource(file('latin1.txt', Buffer.from([0xe9, 0x74, 0xe9])))).toMatchObject({ ok: false, reason: 'not-text' })
    expect(readSource(file('big.txt', 'x'.repeat(1_000_001)))).toMatchObject({ ok: false, reason: 'too-big' })
    expect(readSource(join(d, 'gone.txt'))).toMatchObject({ ok: false, reason: 'unreadable' })
  })
})
