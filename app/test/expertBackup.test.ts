import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openStore, type Store } from '../src/main/store'
import { exportBackup, importBackup } from '../src/main/backup'
import { ExpertStore } from '../src/main/expert/store'
import { INTERVIEW_TABLES, mergeExpert } from '../src/main/expert/backup'
import { cleanAnalysis } from '../src/shared/expert/analysis'

const dirs: string[] = []
const closers: Array<{ close(): void }> = []
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'faisselle-expert-backup-')); dirs.push(d); return d }
afterEach(() => { closers.splice(0).forEach((c) => c.close()); dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })) })
const meetings = (): Store => { const s = openStore(join(tmp(), 'yogurt.db')); closers.push(s); return s }
const expert = (): ExpertStore => { const s = new ExpertStore(join(tmp(), 'expert')); closers.push(s); return s }
const draft = { title: 'Month-end close', domain: 'Accounting', goal: 'Close the books', language: 'fr-FR' as const, minutes: 30 }

/** an interview with something in every table, and its audio */
function fill(s: ExpertStore, title = draft.title) {
  const i = s.create({ ...draft, title })
  s.addSource(i.id, 'steps.md', '# Steps', 7)
  const ses = s.startSession(i.id, 'eu-north-1', 'amazon.nova-2-5-sonic')
  s.addSegment({ interviewId: i.id, sessionId: ses.id, speaker: 'expert', text: 'We close on the fifth working day.', atMs: 10 })
  s.setAnalysis(i.id, cleanAnalysis(JSON.stringify({ summary: 'Closes on day five.', coverage: 'partial', gaps: '', items: [], followUps: [{ question: 'Who approves?', why: '' }] }),
    { at: 1, modelId: 'm', segments: 1, id: () => 'q-1' })!)
  s.replaceDrafts(i.id, [{ name: 'month-end-close', description: 'Closes the month.', body: '## Steps' }])
  mkdirSync(s.folder(i.id), { recursive: true })
  writeFileSync(join(s.folder(i.id), `${ses.id}-expert.wav`), 'RIFF')
  return i
}

describe('expert interviews in the backup', () => {
  it('go out and come back with everything of theirs, once', async () => {
    const m1 = meetings(), e1 = expert()
    const i = fill(e1)
    e1.setState(i.id, 'in-progress')
    const zip = join(tmp(), 'backup.zip')
    expect(await exportBackup({ db: m1.db, meetingsDir: tmp(), out: zip, appVersion: 'x', expert: { db: e1.db, dir: e1.dir } })).toEqual({ meetings: 0, interviews: 1 })

    const m2 = meetings(), e2 = expert()
    const mine = fill(e2, 'Already here')
    const r = await importBackup({ db: m2.db, meetingsDir: tmp(), zip, expert: { db: e2.db, dir: e2.dir } })
    expect(r).toMatchObject({ ok: true, added: 0, interviews: 1 })
    // talked in when the backup was made: it comes in paused
    expect(e2.get(i.id)).toMatchObject({ title: 'Month-end close', state: 'paused' })
    expect(e2.sourceTexts(i.id)).toEqual([{ name: 'steps.md', content: '# Steps' }])
    expect(e2.segments(i.id).map((x) => x.text)).toEqual(['We close on the fifth working day.'])
    expect(e2.analysis(i.id)).toMatchObject({ summary: 'Closes on day five.', followUps: [{ id: 'q-1', status: 'open' }] })
    expect(e2.skills(i.id).map((k) => k.name)).toEqual(['month-end-close'])
    expect(e2.audioBytes(i.id)).toBe(4)
    // the one already here is left as it was
    expect(e2.get(mine.id)!.title).toBe('Already here')

    // again: nothing new
    expect(await importBackup({ db: m2.db, meetingsDir: tmp(), zip, expert: { db: e2.db, dir: e2.dir } })).toMatchObject({ ok: true, added: 0 })
    expect(e2.list()).toHaveLength(2)
  })

  it('a backup without interviews, or made before them, changes none here', async () => {
    const m1 = meetings()
    const zip = join(tmp(), 'old.zip')
    await exportBackup({ db: m1.db, meetingsDir: tmp(), out: zip, appVersion: 'x' })
    const e2 = expert()
    fill(e2)
    const r = await importBackup({ db: meetings().db, meetingsDir: tmp(), zip, expert: { db: e2.db, dir: e2.dir } })
    expect(r).toEqual({ ok: true, added: 0, skipped: 0 })
    expect(e2.list()).toHaveLength(1)
  })

  it("an older interviews' database comes in by the columns both have, its missing tables left out", () => {
    const into = expert()
    const old = new DatabaseSync(join(tmp(), 'old.db'))
    closers.push(old)
    old.exec(`CREATE TABLE interviews (id TEXT PRIMARY KEY, title TEXT NOT NULL, language TEXT NOT NULL, minutes INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE sources (id TEXT PRIMARY KEY, interview_id TEXT NOT NULL, name TEXT NOT NULL, content TEXT NOT NULL, bytes INTEGER NOT NULL, added_at INTEGER NOT NULL);`)
    old.prepare("INSERT INTO interviews VALUES ('11111111-1111-4111-8111-111111111111', 'Old one', 'en-US', 20, 1, 2)").run()
    old.prepare("INSERT INTO sources VALUES ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'a.txt', 'A', 1, 1)").run()
    expect(mergeExpert(into.db, old)).toEqual(['11111111-1111-4111-8111-111111111111'])
    // this version's defaults for what the old one didn't have
    expect(into.get('11111111-1111-4111-8111-111111111111')).toMatchObject({ title: 'Old one', domain: '', state: 'draft', consent: null })
    expect(into.sources('11111111-1111-4111-8111-111111111111')).toHaveLength(1)
    expect(INTERVIEW_TABLES).toEqual(['sources', 'sessions', 'segments', 'analyses', 'skills'])
  })

  it('the manifest says how many interviews it holds', async () => {
    const e1 = expert()
    fill(e1)
    const zip = join(tmp(), 'b.zip'), out = tmp()
    await exportBackup({ db: meetings().db, meetingsDir: tmp(), out: zip, appVersion: 'x', expert: { db: e1.db, dir: e1.dir } })
    const { unpack } = await import('../src/main/zip')
    await unpack(zip, out)
    expect(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))).toMatchObject({ meetings: 0, interviews: 1 })
    expect(existsSync(join(out, 'expert', 'expert.db'))).toBe(true)
  })
})
