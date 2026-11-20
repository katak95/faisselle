import { randomBytes } from 'node:crypto'
import { ipcMain } from 'electron'
import { loadSettings, updateSettings, type Settings } from './settings'
import { CUSTOM_INSTRUCTIONS_MAX, CUSTOM_MAX, CUSTOM_NAME_MAX, GENERAL, cleanTemplates, isBuiltIn, isCustomId, templatePrompt, type CustomTemplate, type TemplatePrompt } from '../shared/templates'

export const customTemplates = (s: Settings): CustomTemplate[] => cleanTemplates(s.templates)
/** the default template, if it still exists */
export const defaultTemplate = (s: Settings): string => {
  const id = s.defaultTemplate
  return id && (isBuiltIn(id) || customTemplates(s).some((c) => c.id === id)) ? id : GENERAL
}
/** what the notes of a meeting follow: its own choice, else the default */
export const templateFor = (s: Settings, chosen: string | null): TemplatePrompt | undefined => templatePrompt(chosen ?? defaultTemplate(s), customTemplates(s))

/** Settings → Summary templates: the default one, and the ones the person writes */
export function hookTemplates(d: { file: string }) {
  const view = () => { const s = loadSettings(d.file); return { custom: customTemplates(s), defaultId: defaultTemplate(s) } }
  ipcMain.handle('templates:get', () => view())
  ipcMain.handle('templates:default', (_e, id: unknown) => {
    const s = loadSettings(d.file)
    if (isBuiltIn(id) || customTemplates(s).some((c) => c.id === id)) updateSettings(d.file, { defaultTemplate: id === GENERAL ? undefined : id as string })
    return view()
  })
  // a new one has no id yet; an existing one is replaced
  ipcMain.handle('templates:save', (_e, v: unknown) => {
    const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
    const custom = customTemplates(loadSettings(d.file))
    const id = isCustomId(r.id) ? r.id : `custom-${randomBytes(6).toString('hex')}`
    const name = typeof r.name === 'string' ? r.name.replace(/\s+/g, ' ').trim().slice(0, CUSTOM_NAME_MAX) : ''
    const instructions = typeof r.instructions === 'string' ? r.instructions.trim().slice(0, CUSTOM_INSTRUCTIONS_MAX) : ''
    if (!name || !instructions) return view()
    const at = custom.findIndex((c) => c.id === id)
    if (at < 0 && custom.length >= CUSTOM_MAX) return view()
    const next = at < 0 ? [...custom, { id, name, instructions }] : custom.map((c) => (c.id === id ? { id, name, instructions } : c))
    updateSettings(d.file, { templates: next })
    return view()
  })
  ipcMain.handle('templates:remove', (_e, id: unknown) => {
    const s = loadSettings(d.file)
    const next = customTemplates(s).filter((c) => c.id !== id)
    updateSettings(d.file, { templates: next.length ? next : undefined, ...(s.defaultTemplate === id ? { defaultTemplate: undefined } : {}) })
    return view()
  })
}
