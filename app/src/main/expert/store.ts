// Expert interviews' own database (userData/expert/expert.db), apart from the meetings' database: what is kept
// here never mixes with meeting notes, their backups or their schema. Each interview has a folder beside it for its audio.
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Speaker, TranscriptSegment } from '../../shared/expert/voice'
import type { FollowUpStatus, InterviewAnalysis } from '../../shared/expert/analysis'
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
  // the voice interview: its connections (a session each, offset_ms where it starts in the interview) and its lines
  `CREATE TABLE sessions (
     id TEXT PRIMARY KEY, interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
     started_at INTEGER NOT NULL, ended_at INTEGER, offset_ms INTEGER NOT NULL, region TEXT NOT NULL, model_id TEXT NOT NULL, end_reason TEXT);
   CREATE INDEX sessions_interview ON sessions(interview_id);
   CREATE TABLE segments (
     id TEXT PRIMARY KEY, interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE, session_id TEXT NOT NULL,
     speaker TEXT NOT NULL, text TEXT NOT NULL, at_ms INTEGER NOT NULL, original TEXT);
   CREATE INDEX segments_interview ON segments(interview_id, at_ms);`,
  // the analysis of an interview (shared/expert/analysis.ts): the latest one, as JSON
  `CREATE TABLE analyses (
     interview_id TEXT PRIMARY KEY REFERENCES interviews(id) ON DELETE CASCADE, at INTEGER NOT NULL, body TEXT NOT NULL);`,
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
const segmentOf = (r: Row): TranscriptSegment => ({
  id: String(r.id), interviewId: String(r.interview_id), sessionId: String(r.session_id), speaker: r.speaker === 'agent' ? 'agent' : 'expert',
  text: String(r.text), atMs: Number(r.at_ms), edited: r.original !== null && r.original !== undefined, original: r.original === null || r.original === undefined ? null : String(r.original),
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

  setState(id: string, state: InterviewState) {
    this.db.prepare('UPDATE interviews SET state = ?, updated_at = ? WHERE id = ?').run(state, this.now(), id)
  }

  /** a new connection, starting where the interview stands (the length of its earlier sessions) */
  startSession(id: string, region: string, modelId: string): { id: string; offsetMs: number } {
    const s = { id: randomUUID(), offsetMs: this.elapsedMs(id) }
    this.db.prepare('INSERT INTO sessions (id, interview_id, started_at, offset_ms, region, model_id) VALUES (?, ?, ?, ?, ?, ?)').run(s.id, id, this.now(), s.offsetMs, region, modelId)
    return s
  }

  endSession(sessionId: string, reason: string) {
    this.db.prepare('UPDATE sessions SET ended_at = ?, end_reason = ? WHERE id = ? AND ended_at IS NULL').run(this.now(), reason, sessionId)
  }

  /** how long the interview has run: its sessions that ended (one still open counts up to its last line) */
  elapsedMs(id: string): number {
    const rows = this.db.prepare(`SELECT s.started_at, s.ended_at, s.offset_ms, (SELECT MAX(at_ms) FROM segments g WHERE g.session_id = s.id) AS last
      FROM sessions s WHERE s.interview_id = ?`).all(id) as Row[]
    return rows.reduce((max, r) => Math.max(max, r.ended_at !== null ? Number(r.offset_ms) + Number(r.ended_at) - Number(r.started_at) : Number(r.last ?? r.offset_ms)), 0)
  }

  addSegment(s: { interviewId: string; sessionId: string; speaker: Speaker; text: string; atMs: number }): TranscriptSegment {
    const id = randomUUID()
    this.db.prepare('INSERT INTO segments (id, interview_id, session_id, speaker, text, at_ms) VALUES (?, ?, ?, ?, ?, ?)').run(id, s.interviewId, s.sessionId, s.speaker, s.text, Math.round(s.atMs))
    return { ...s, id, atMs: Math.round(s.atMs), edited: false, original: null }
  }

  segments(id: string): TranscriptSegment[] {
    return (this.db.prepare('SELECT * FROM segments WHERE interview_id = ? ORDER BY at_ms, rowid').all(id) as Row[]).map(segmentOf)
  }

  /** the expert's correction: what was heard is kept as the original, once */
  editSegment(id: string, segmentId: string, text: string): TranscriptSegment | undefined {
    this.db.prepare('UPDATE segments SET original = COALESCE(original, text), text = ? WHERE id = ? AND interview_id = ?').run(text, segmentId, id)
    // back to what was heard: no longer a correction
    this.db.prepare('UPDATE segments SET original = NULL WHERE id = ? AND original = text').run(segmentId)
    const r = this.db.prepare('SELECT * FROM segments WHERE id = ? AND interview_id = ?').get(segmentId, id) as Row | undefined
    if (r) this.touch(id)
    return r && segmentOf(r)
  }

  /** the audio files in the interview's folder, and their size */
  audioBytes(id: string): number {
    const dir = this.folder(id)
    if (!existsSync(dir)) return 0
    return readdirSync(dir).filter((f) => f.endsWith('.wav')).reduce((n, f) => n + statSync(join(dir, f)).size, 0)
  }

  /** the audio alone: the transcript and everything made from it stay */
  deleteAudio(id: string) {
    rmSync(this.folder(id), { recursive: true, force: true })
  }

  /** the latest analysis, or null before the first one (or when what is saved can't be read) */
  analysis(id: string): InterviewAnalysis | null {
    const r = this.db.prepare('SELECT body FROM analyses WHERE interview_id = ?').get(id) as Row | undefined
    if (!r) return null
    try {
      const a = JSON.parse(String(r.body)) as InterviewAnalysis
      return typeof a.summary === 'string' && Array.isArray(a.items) && Array.isArray(a.followUps) ? a : null
    } catch { return null }
  }

  setAnalysis(id: string, a: InterviewAnalysis) {
    if (!this.get(id)) return
    this.db.prepare('INSERT INTO analyses (interview_id, at, body) VALUES (?, ?, ?) ON CONFLICT(interview_id) DO UPDATE SET at = excluded.at, body = excluded.body')
      .run(id, a.at, JSON.stringify(a))
    this.touch(id)
  }

  /** the expert keeps a question for the next session (open), or sets it aside (dismissed) */
  setFollowUp(id: string, questionId: string, status: Exclude<FollowUpStatus, 'asked'>): InterviewAnalysis | null {
    const a = this.analysis(id)
    if (!a || !a.followUps.some((q) => q.id === questionId)) return a
    this.setAnalysis(id, { ...a, followUps: a.followUps.map((q) => (q.id === questionId ? { ...q, status } : q)) })
    return this.analysis(id)
  }

  /** the open questions were put to the expert in a voice session */
  markAsked(id: string) {
    const a = this.analysis(id)
    if (a?.followUps.some((q) => q.status === 'open')) this.setAnalysis(id, { ...a, followUps: a.followUps.map((q) => (q.status === 'open' ? { ...q, status: 'asked' } : q)) })
  }

  private touch(id: string) { this.db.prepare('UPDATE interviews SET updated_at = ? WHERE id = ?').run(this.now(), id) }
}
