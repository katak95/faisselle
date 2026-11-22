// Expert interviews' own database (userData/expert/expert.db), apart from the meetings' database: what is kept
// here never mixes with meeting notes, their backups or their schema. Each interview has a folder beside it for its audio.
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { EXPERT_DEFAULTS, isInterviewLanguage, type Consent, type ExpertSettings, type Interview, type InterviewCard, type InterviewDraft, type InterviewSource, type InterviewState } from '../../shared/expert/types'

type Row = Record<string, unknown>

/** each step brings an older database to the next version; a database is never taken back */
const MIGRATIONS: string[] = [
  `CREATE TABLE interviews (
     id TEXT PRIMARY KEY, title TEXT NOT NULL, domain TEXT NOT NULL DEFAULT '', goal TEXT NOT NULL DEFAULT '',
     language TEXT NOT NULL, minutes INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'draft', consent TEXT,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
   CREATE TABLE sources (
     id TEXT PRIMARY KEY, interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
     name TEXT NOT NULL, content TEXT NOT NULL, bytes INTEGER NOT NULL, added_at INTEGER NOT NULL);
   CREATE INDEX sources_interview ON sources(interview_id);
   CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
]
export const EXPERT_DB_VERSION = MIGRATIONS.length

const STATES: InterviewState[] = ['draft', 'ready', 'in-progress', 'paused', 'ended']

function consentOf(v: unknown): Consent | null {
  if (typeof v !== 'string') return null
  try {
    const c = JSON.parse(v) as Consent
    return typeof c.at === 'number' && [c.voiceRegion, c.voiceModelId, c.region, c.modelId].every((x) => typeof x === 'string') ? c : null
  } catch { return null }
}

const interviewOf = (r: Row): Interview => ({
  id: String(r.id), title: String(r.title), domain: String(r.domain), goal: String(r.goal),
  language: isInterviewLanguage(r.language) ? r.language : 'en-US', minutes: Number(r.minutes),
  state: STATES.includes(r.state as InterviewState) ? r.state as InterviewState : 'draft',
  consent: consentOf(r.consent), createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
})
const sourceOf = (r: Row): InterviewSource => ({ id: String(r.id), name: String(r.name), bytes: Number(r.bytes), addedAt: Number(r.added_at) })

export class ExpertStore {
  readonly db: DatabaseSync
  /** dir: userData/expert, which holds the database and a folder per interview */
  constructor(readonly dir: string, private now = () => Date.now()) {
    mkdirSync(dir, { recursive: true })
    this.db = new DatabaseSync(join(dir, 'expert.db'))
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON')
    const version = Number((this.db.prepare('PRAGMA user_version').get() as Row).user_version)
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.db.exec('BEGIN')
      try { this.db.exec(MIGRATIONS[v]); this.db.exec(`PRAGMA user_version = ${v + 1}`); this.db.exec('COMMIT') } catch (e) { this.db.exec('ROLLBACK'); throw e }
    }
  }

  close() { this.db.close() }

  /** an interview's folder (its audio); the id is checked before it gets here */
  folder(id: string) { return join(this.dir, id) }

  settings(): ExpertSettings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as Row[]
    const saved = Object.fromEntries(rows.map((r) => [String(r.key), JSON.parse(String(r.value)) as unknown]))
    const pick = <K extends keyof ExpertSettings>(k: K): ExpertSettings[K] => (typeof saved[k] === typeof EXPERT_DEFAULTS[k] ? saved[k] as ExpertSettings[K] : EXPERT_DEFAULTS[k])
    return { voiceRegion: pick('voiceRegion'), voiceModelId: pick('voiceModelId'), analysisModelId: pick('analysisModelId'), keepAudio: pick('keepAudio') }
  }

  setSettings(patch: Partial<ExpertSettings>) {
    const put = this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    for (const [k, v] of Object.entries(patch)) if (k in EXPERT_DEFAULTS && v !== undefined) put.run(k, JSON.stringify(v))
  }

  list(): InterviewCard[] {
    const rows = this.db.prepare(`SELECT i.*, (SELECT COUNT(*) FROM sources s WHERE s.interview_id = i.id) AS source_count
      FROM interviews i ORDER BY i.updated_at DESC`).all() as Row[]
    return rows.map((r) => ({ ...interviewOf(r), sources: Number(r.source_count) }))
  }

  get(id: string): Interview | undefined {
    const r = this.db.prepare('SELECT * FROM interviews WHERE id = ?').get(id) as Row | undefined
    return r && interviewOf(r)
  }

  create(d: InterviewDraft): Interview {
    const id = randomUUID(), at = this.now()
    this.db.prepare('INSERT INTO interviews (id, title, domain, goal, language, minutes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, d.title, d.domain, d.goal, d.language, d.minutes, at, at)
    return this.get(id)!
  }

  /** a change to what the interview is about; a ready interview stays ready (the consent is about where data goes) */
  update(id: string, p: Partial<InterviewDraft>): Interview | undefined {
    const cur = this.get(id)
    if (!cur) return undefined
    const n = { ...cur, ...p }
    this.db.prepare('UPDATE interviews SET title = ?, domain = ?, goal = ?, language = ?, minutes = ?, updated_at = ? WHERE id = ?')
      .run(n.title, n.domain, n.goal, n.language, n.minutes, this.now(), id)
    return this.get(id)
  }

  consent(id: string, c: Omit<Consent, 'at'>): Interview | undefined {
    const cur = this.get(id)
    if (!cur) return undefined
    const state = cur.state === 'draft' ? 'ready' : cur.state
    this.db.prepare('UPDATE interviews SET consent = ?, state = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ ...c, at: this.now() }), state, this.now(), id)
    return this.get(id)
  }

  sources(id: string): InterviewSource[] {
    return (this.db.prepare('SELECT id, name, bytes, added_at FROM sources WHERE interview_id = ? ORDER BY added_at, rowid').all(id) as Row[]).map(sourceOf)
  }

  /** the sources' text, for the requests that need it (never sent to a page) */
  sourceTexts(id: string): Array<{ name: string; content: string }> {
    return (this.db.prepare('SELECT name, content FROM sources WHERE interview_id = ? ORDER BY added_at, rowid').all(id) as Row[]).map((r) => ({ name: String(r.name), content: String(r.content) }))
  }

  addSource(id: string, name: string, content: string, bytes: number): InterviewSource {
    const s = { id: randomUUID(), name, bytes, addedAt: this.now() }
    this.db.prepare('INSERT INTO sources (id, interview_id, name, content, bytes, added_at) VALUES (?, ?, ?, ?, ?, ?)').run(s.id, id, name, content, bytes, s.addedAt)
    this.touch(id)
    return s
  }

  removeSource(id: string, sourceId: string) {
    if (this.db.prepare('DELETE FROM sources WHERE id = ? AND interview_id = ?').run(sourceId, id).changes) this.touch(id)
  }

  /** the interview, its sources and its folder; false when there was no such interview */
  delete(id: string): boolean {
    const gone = this.db.prepare('DELETE FROM interviews WHERE id = ?').run(id).changes > 0
    rmSync(this.folder(id), { recursive: true, force: true })
    return gone
  }

  private touch(id: string) { this.db.prepare('UPDATE interviews SET updated_at = ? WHERE id = ?').run(this.now(), id) }
}
