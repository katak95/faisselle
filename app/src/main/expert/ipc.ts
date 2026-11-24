// Expert interviews, between the window and main: every argument is checked here, only the main window may ask,
// and files are picked with main's own dialog (FAISSELLE_EXPERT_SOURCES stands in for it in tests).
import { app, dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { delimiter } from 'node:path'
import { isId } from '../ipcArgs'
import { validRegion } from '../aws/sso'
import { validModelId } from '../notes/bedrock'
import { readSource, SOURCE_EXTENSIONS } from './sources'
import type { ExpertStore } from './store'
import { createVoice, frameOf } from './voice'
import { createAnalysis } from './analyze'
import type { Llm } from '../notes/enhance'
import type { SonicTransport } from './sonic'
import { SEGMENT_MAX } from '../../shared/expert/voice'
import { cleanDraft, cleanDraftPatch, consentHolds, interviewLanguageFor, SOURCES_MAX, type ExpertSettings, type ExpertView, type SourcesResult } from '../../shared/expert/types'

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
  /** Nova Sonic: Bedrock's bidirectional stream, or its stand-in in fake mode */
  sonic: SonicTransport
  /** Claude on Bedrock with this model (the analysis model), signed in like the notes */
  llm(modelId: string, signal: AbortSignal): Promise<Llm>
  /** the company context (Settings), as the notes give it */
  organisation?(): string[]
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

  const send = (channel: string, ...args: unknown[]) => d.window()?.webContents.send(channel, ...args)
  const voice = createVoice({
    store: d.store, transport: d.sonic,
    config: () => { const s = d.store.settings(); return { ready: d.bedrock().ready, region: s.voiceRegion, modelId: s.voiceModelId, keepAudio: s.keepAudio } },
    agreed: (i) => { const v = view(); return consentHolds(i.consent, { voiceRegion: v.settings.voiceRegion, voiceModelId: v.settings.voiceModelId, region: v.bedrock.region, modelId: v.bedrock.modelId }) },
    send: (v) => { send('expert:voice-state', v); changed() },
    audio: (pcm) => send('expert:voice-audio', pcm),
    interrupted: () => send('expert:voice-interrupted'),
    segment: (s) => send('expert:voice-segment', s),
  })
  app.on('before-quit', () => voice.shutdown())
  const agreed = (i: { consent: Parameters<typeof consentHolds>[0] }) => { const v = view(); return consentHolds(i.consent, { voiceRegion: v.settings.voiceRegion, voiceModelId: v.settings.voiceModelId, region: v.bedrock.region, modelId: v.bedrock.modelId }) }
  const analysis = createAnalysis({
    store: d.store, llm: (signal) => d.llm(view().bedrock.modelId, signal), modelId: () => view().bedrock.modelId, agreed,
    talking: (id) => voice.view().interviewId === id && ['connecting', 'listening', 'thinking', 'speaking', 'reconnecting'].includes(voice.view().state),
    organisation: d.organisation, send: () => changed(),
  })

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
    return interview ? { interview, sources: d.store.sources(id), segments: d.store.segments(id), audioBytes: d.store.audioBytes(id), analysis: d.store.analysis(id), analysisState: analysis.state(id) } : null
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
    voice.forget(id)
    analysis.forget(id)
    const gone = d.store.delete(id)
    changed()
    return gone
  }, false)
  handle('expert:edit-segment', (_e, id, segmentId, v) => {
    const text = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, SEGMENT_MAX) : ''
    if (!isId(id) || !isId(segmentId) || !text) return null
    const out = d.store.editSegment(id, segmentId, text) ?? null
    changed()
    return out
  })
  handle('expert:delete-audio', (_e, id) => {
    if (!isId(id)) return false
    // not while it records into those files
    if (voice.view().interviewId === id && ['connecting', 'listening', 'thinking', 'speaking', 'reconnecting'].includes(voice.view().state)) return false
    d.store.deleteAudio(id)
    changed()
    return true
  }, false)

  handle('expert:analyze', (_e, id) => (isId(id) ? analysis.start(id) : null))
  handle('expert:follow-up', (_e, id, questionId, status) => {
    if (!isId(id) || !isId(questionId) || (status !== 'open' && status !== 'dismissed')) return null
    const out = d.store.setFollowUp(id, questionId, status)
    changed()
    return out
  })

  // the voice interview: one at a time, started from its page
  handle('expert:voice-state', () => voice.view())
  handle('expert:voice-start', (_e, id) => {
    const i = isId(id) ? d.store.get(id) : undefined
    return i ? voice.start(i) : voice.view()
  })
  handle('expert:voice-pause', () => voice.pause())
  handle('expert:voice-resume', () => voice.resume())
  handle('expert:voice-stop', () => voice.stop())
  handle('expert:voice-mute', (_e, on) => voice.mute(on === true))
  ipcMain.on('expert:voice-audio', (e, frame) => {
    const win = d.window()
    if (!win || e.sender !== win.webContents) return
    const pcm = frameOf(frame)
    if (pcm) voice.audio(pcm)
  })
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
