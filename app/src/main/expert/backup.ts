// Expert interviews in the app's backup (main/backup.ts): expert/expert.db, a snapshot of the interviews' own
// database, and expert/<id>/ with each interview's audio. Importing adds the interviews that aren't here yet, with
// everything of theirs (documents, sessions, transcript, analysis, skills), and never changes one that is.
import { constants, existsSync } from 'node:fs'
import { cp, lstat, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { isId } from '../ipcArgs'

type Row = Record<string, string | number | bigint | null | Uint8Array>
const q = (name: string) => `"${name.replace(/"/g, '""')}"`
const tables = (db: DatabaseSync) => new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Row[]).map((r) => String(r.name)))
const columns = (db: DatabaseSync, table: string) => (db.prepare(`PRAGMA table_info(${q(table)})`).all() as Array<{ name: string }>).map((c) => c.name)

/** what belongs to an interview, parents first: every table with an interview_id, as this version has them */
export const INTERVIEW_TABLES = ['sources', 'sessions', 'segments', 'analyses', 'skills']

/** the interviews' database and audio into work/expert; how many interviews it holds */
export async function exportExpert(o: { db: DatabaseSync; dir: string; work: string }): Promise<number> {
  const out = join(o.work, 'expert')
  await mkdir(out, { recursive: true })
  const file = join(out, 'expert.db')
  o.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
  const snap = new DatabaseSync(file, { readOnly: true })
  const ids = (snap.prepare('SELECT id FROM interviews').all() as Row[]).map((r) => r.id).filter(isId)
  snap.close()
  for (const id of ids) {
    const src = join(o.dir, id)
    if (!existsSync(src)) continue
    try {
      await cp(src, join(out, id), { recursive: true, mode: constants.COPYFILE_FICLONE })
    } catch (e) {
      // the audio can be deleted while the backup is made: the transcript and the rest still make it
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
  }
  return ids.length
}

/**
 * The backup's interviews that aren't here yet, and every row of theirs, in one transaction: all of it or none.
 * Rows go by the columns both sides have (an older backup gets this version's defaults; a newer one's extra columns
 * are left out). An interview being talked in when the backup was made comes in paused.
 */
export function mergeExpert(into: DatabaseSync, from: DatabaseSync): string[] {
  if (!tables(from).has('interviews')) return []
  const here = new Set((into.prepare('SELECT id FROM interviews').all() as Row[]).map((r) => String(r.id)))
  const add = (from.prepare('SELECT id FROM interviews').all() as Row[]).map((r) => r.id).filter(isId).filter((id) => !here.has(id))
  if (!add.length) return []
  const theirs = tables(from), ours = tables(into)
  const plan = ['interviews', ...INTERVIEW_TABLES].filter((t) => theirs.has(t) && ours.has(t)).map((table) => {
    const mine = new Set(columns(into, table))
    const cols = columns(from, table).filter((c) => mine.has(c))
    const key = table === 'interviews' ? 'id' : 'interview_id'
    return { table, cols, read: from.prepare(`SELECT ${cols.map(q).join(', ')} FROM ${q(table)} WHERE ${q(key)} = ?`),
      write: into.prepare(`INSERT OR IGNORE INTO ${q(table)} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`) }
  })
  into.exec('BEGIN')
  try {
    for (const id of add) for (const p of plan) for (const row of p.read.all(id) as Row[]) {
      if (p.table === 'interviews' && row.state === 'in-progress') row.state = 'paused'
      p.write.run(...p.cols.map((c) => row[c] ?? null))
    }
    into.exec('COMMIT')
  } catch (e) { into.exec('ROLLBACK'); throw e }
  return add
}

/** only plain files and folders come out of a backup: a link could point anywhere on the computer */
const plainOnly = async (s: string) => !(await lstat(s)).isSymbolicLink()

/**
 * The interviews in an unpacked backup (work/expert) added here: their audio first, then their rows. Returns the
 * interviews added, and the audio folders copied (to remove again if what follows fails).
 */
export async function importExpert(o: { db: DatabaseSync; dir: string; work: string; copied: string[] }): Promise<number> {
  const file = join(o.work, 'expert', 'expert.db')
  if (!existsSync(file)) return 0
  const from = new DatabaseSync(file, { readOnly: true })
  try {
    if (!tables(from).has('interviews')) return 0
    const here = new Set((o.db.prepare('SELECT id FROM interviews').all() as Row[]).map((r) => String(r.id)))
    for (const id of (from.prepare('SELECT id FROM interviews').all() as Row[]).map((r) => r.id).filter(isId)) {
      const src = join(o.work, 'expert', id), dest = join(o.dir, id)
      if (here.has(id) || !existsSync(src) || existsSync(dest)) continue
      await mkdir(o.dir, { recursive: true })
      o.copied.push(dest)
      await cp(src, dest, { recursive: true, filter: plainOnly })
    }
    return mergeExpert(o.db, from).length
  } finally { from.close() }
}
