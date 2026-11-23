import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadSettings, updateSettings, type Settings } from './settings'
import { applyShare, buildShare, parseShare, previewShare, type SharedSetup } from './configShare'
import { isFake } from './paths'
import { t } from '../shared/i18n'
import type { ShareApplied, ShareOpened, ShareSection } from '../shared/types'

const SECTIONS: ShareSection[] = ['notes', 'm365', 'confluence', 'vocabulary']
/** a file larger than this isn't a setup */
const MAX_BYTES = 256 * 1024

/**
 * Settings → Share the setup. The file always comes from the system's own save or open panel (tests name it with
 * YOGURT_SETUP_PATH); the window only sees the preview, and applies a setup it was shown, by the token it got with it.
 */
export function hookSetupShare(d: { file: string; window: () => BrowserWindow | undefined
  /** the Confluence site in use, when connected: its name and address go in the file */
  site(): { id: string; name: string; url: string } | undefined
  /** after applying: each part of the app takes up its new settings */
  applied(sections: ShareSection[], before: Settings, after: Settings): void }) {
  let last: string | undefined
  let opened: { token: string; setup: SharedSetup } | undefined
  const fakePath = () => (isFake() ? process.env.YOGURT_SETUP_PATH : undefined)

  ipcMain.handle('setup-share:export', async () => {
    try {
      let path = fakePath()
      if (!path) {
        const opts = { title: t('Export the setup'), defaultPath: join(app.getPath('documents'), 'Faisselle setup.json'), filters: [{ name: 'JSON', extensions: ['json'] }] }
        const win = d.window()
        const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
        if (r.canceled || !r.filePath) return { ok: false, error: 'cancelled' }
        path = r.filePath
      }
      await writeFile(path, JSON.stringify(buildShare(loadSettings(d.file), { appVersion: app.getVersion(), site: d.site() }), null, 2) + '\n')
      last = path
      return { ok: true }
    } catch (e) {
      console.error('exporting the setup failed', e)
      return { ok: false, error: 'failed' }
    }
  })

  ipcMain.handle('setup-share:open', async (): Promise<ShareOpened> => {
    try {
      let path = fakePath()
      if (!path) {
        const opts = { title: t('Import a setup'), defaultPath: app.getPath('documents'), properties: ['openFile' as const], filters: [{ name: 'JSON', extensions: ['json'] }] }
        const win = d.window()
        const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
        if (r.canceled || !r.filePaths[0]) return { ok: false, error: 'cancelled' }
        path = r.filePaths[0]
      }
      const raw = await readFile(path)
      if (raw.length > MAX_BYTES) return { ok: false, error: 'invalid' }
      const parsed = parseShare(raw.toString('utf8'))
      if (!parsed.ok) return parsed
      opened = { token: randomBytes(16).toString('hex'), setup: parsed.setup }
      return { ok: true, token: opened.token, preview: previewShare(loadSettings(d.file), parsed.setup), appVersion: parsed.setup.appVersion, exportedAt: parsed.setup.exportedAt }
    } catch (e) {
      console.error('reading a setup failed', e)
      return { ok: false, error: 'failed' }
    }
  })

  ipcMain.handle('setup-share:apply', (_e, token: unknown, sections: unknown): ShareApplied => {
    if (!opened || typeof token !== 'string' || token !== opened.token) return { ok: false, error: 'expired' }
    const keep = Array.isArray(sections) ? SECTIONS.filter((s) => sections.includes(s)) : []
    try {
      const before = loadSettings(d.file)
      updateSettings(d.file, applyShare(before, opened.setup, keep))
      opened = undefined
      d.applied(keep, before, loadSettings(d.file))
      return { ok: true, applied: keep }
    } catch (e) {
      console.error('applying a setup failed', e)
      return { ok: false, error: 'failed' }
    }
  })

  ipcMain.on('setup-share:show', () => { if (last && !isFake()) shell.showItemInFolder(last) })
}
