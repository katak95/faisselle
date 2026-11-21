// a default import, so plain Node (local recording checks) can load this file too
import electron from 'electron'
import { join } from 'node:path'
import { existsSync, renameSync, rmSync } from 'node:fs'

/** One profile folder however Faisselle is started (dev, packaged): ~/Library/Application Support/Faisselle. YOGURT_USER_DATA uses a separate one (tests) */
export const userDataDir = (): string => process.env.YOGURT_USER_DATA ?? join(electron.app.getPath('appData'), 'Faisselle')

/**
 * Faisselle was called Yogurt: its meetings, notes, recordings and models were in the Yogurt folder. At the first
 * launch under the new name that folder becomes Faisselle's (moved, not copied: the models alone are gigabytes). A
 * Faisselle folder that holds no meetings yet (only what Electron made at a launch) gives way to it.
 */
export function migrateProfile(appData: string, o: { now?: string; old?: string } = {}): 'moved' | 'none' {
  const now = join(appData, o.now ?? 'Faisselle'), old = join(appData, o.old ?? 'Yogurt')
  const db = (dir: string) => existsSync(join(dir, 'yogurt.db'))
  if (!db(old) || db(now)) return 'none'
  if (existsSync(now)) rmSync(now, { recursive: true, force: true })
  renameSync(old, now)
  return 'moved'
}

/** Test mode: stand-ins for everything that needs a model, the microphone or a calendar */
export const isFake = (): boolean => process.env.YOGURT_FAKE === '1'
