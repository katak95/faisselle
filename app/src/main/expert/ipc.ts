// Expert interviews, between the window and main: every argument is checked here, only the main window may ask,
// and files are picked with main's own dialog (FAISSELLE_EXPERT_SOURCES stands in for it in tests).
import { dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { delimiter } from 'node:path'
import { isId } from '../ipcArgs'
import { validRegion } from '../aws/sso'
import { validModelId } from '../notes/bedrock'
import { readSource, SOURCE_EXTENSIONS } from './sources'
import type { ExpertStore } from './store'
import { cleanDraft, cleanDraftPatch, interviewLanguageFor, SOURCES_MAX, type ExpertSettings, type ExpertView, type SourcesResult } from '../../shared/expert/types'

export type ExpertBedrock = { ready: boolean; region: string; modelId: string }

/** the settings a page may change, each checked on its own: a bad one is left as it was */
export function cleanSettingsPatch(v: unknown): Partial<ExpertSettings> {
  const p = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const out: Partial<ExpertSettings> = {}
  if (validRegion(p.voiceRegion)) out.voiceRegion = p.voiceRegion
  if (validModelId(p.voiceModelId)) out.voiceModelId = p.voiceModelId
  if (p.analysisModelId === '' || validModelId(p.analysisModelId)) out.analysisModelId = p.analysisModelId as string
  if (typeof p.keepAudio === 'boolean') out.keepAudio = p.keepAudio
  return out
}

export function hookExpert(d: {
  store: ExpertStore
  window(): BrowserWindow | undefined
  /** Bedrock as set up for the notes: the region and model Claude answers from */
  bedrock(): ExpertBedrock
  /** the app's language, for a new interview's */
  locale(): string
}) {
  const changed = () => d.window()?.webContents.send('expert:changed')
  // only the main window's page: no other window, and no frame inside it
  const handle = (channel: string, fn: (e: IpcMainInvokeEvent, ...args: unknown[]) => unknown, refused: unknown = null) =>
    ipcMain.handle(channel, (e, ...args) => {
      const win = d.window()
      if (!win || e.sender !== win.webContents || e.senderFrame !== win.webContents.mainFrame) return refused
      return fn(e, ...args)
    })
  const analysisModel = (s: ExpertSettings, b: ExpertBedrock) => s.analysisModelId || b.modelId
  const view = (): ExpertView => {
    const settings = d.store.settings(), b = d.bedrock()
    return { settings, bedrock: { ...b, modelId: analysisModel(settings, b) }, dataDir: d.store.dir }
  }

  handle('expert:view', () => view())
  handle('expert:settings', (_e, v) => {
    d.store.setSettings(cleanSettingsPatch(v))
    changed()
    return view()
  })
  handle('expert:list', () => d.store.list(), [])
  handle('expert:get', (_e, id) => {
    if (!isId(id)) return null
    const interview = d.store.get(id)
    return interview ? { interview, sources: d.store.sources(id) } : null
  })
  handle('expert:create', (_e, v) => {
    const draft = cleanDraft(v, interviewLanguageFor(d.locale()))
    if (!draft) return null
    const out = d.store.create(draft)
    changed()
    return out
  })
  handle('expert:update', (_e, id, v) => {
    const patch = cleanDraftPatch(v)
    if (!isId(id) || !patch) return null
    const out = d.store.update(id, patch) ?? null
    changed()
    return out
  })
  handle('expert:add-sources', async (_e, id): Promise<SourcesResult> => {
    if (!isId(id) || !d.store.get(id)) return { ok: false, reason: 'missing' }
    const paths = process.env.FAISSELLE_EXPERT_SOURCES !== undefined
      ? process.env.FAISSELLE_EXPERT_SOURCES.split(delimiter).filter(Boolean)
      : await pick(d.window())
    if (!paths?.length) return { ok: false, reason: 'canceled' }
    const skipped: Extract<SourcesResult, { ok: true }>['skipped'] = []
    let room = SOURCES_MAX - d.store.sources(id).length
    for (const path of paths) {
      const r = readSource(path)
      if (!r.ok) { skipped.push({ name: r.name, reason: r.reason }); continue }
      if (room <= 0) { skipped.push({ name: r.name, reason: 'too-many' }); continue }
      d.store.addSource(id, r.name, r.content, r.bytes)
      room--
    }
    changed()
    return { ok: true, sources: d.store.sources(id), skipped }
  }, { ok: false, reason: 'missing' })
  handle('expert:remove-source', (_e, id, sourceId) => {
    if (!isId(id) || !isId(sourceId)) return []
    d.store.removeSource(id, sourceId)
    changed()
    return d.store.sources(id)
  }, [])
  handle('expert:consent', (_e, id) => {
    if (!isId(id)) return null
    const v = view()
    if (!v.bedrock.ready) return null
    const out = d.store.consent(id, { voiceRegion: v.settings.voiceRegion, voiceModelId: v.settings.voiceModelId, region: v.bedrock.region, modelId: v.bedrock.modelId }) ?? null
    changed()
    return out
  })
  handle('expert:delete', (_e, id) => {
    if (!isId(id)) return false
    const gone = d.store.delete(id)
    changed()
    return gone
  }, false)
  ipcMain.on('expert:show-data', (e) => {
    const win = d.window()
    if (win && e.sender === win.webContents && !process.env.YOGURT_FAKE) void shell.openPath(d.store.dir)
  })
}

async function pick(win: BrowserWindow | undefined): Promise<string[] | null> {
  const options = { properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>, filters: [{ name: 'Text', extensions: SOURCE_EXTENSIONS }] }
  const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return r.canceled ? null : r.filePaths
}
