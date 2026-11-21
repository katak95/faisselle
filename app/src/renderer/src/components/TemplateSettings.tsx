import { useEffect, useState } from 'react'
// the app's own icons (Hugeicons, Icons.tsx), under the names these components use
import { ChevronDown, FileText as LayoutTemplate, Trash2 } from './Icons'
import type { TemplatesView } from '../../../shared/types'
import { CUSTOM_INSTRUCTIONS_MAX, CUSTOM_MAX, CUSTOM_NAME_MAX, templateChoices, type CustomTemplate } from '../../../shared/templates'
import { t } from '../../../shared/i18n'
import { LoadingContent } from './LoadingContent'

/** Settings → Summary templates: the one new notes follow, and the person's own (a name and how to write the notes) */
export function TemplateSettings() {
  const [v, setV] = useState<TemplatesView>()
  const [editing, setEditing] = useState<{ id?: string; name: string; instructions: string }>()
  useEffect(() => { void window.yogurt.templates.get().then(setV) }, [])
  const save = async () => {
    if (!editing?.name.trim() || !editing.instructions.trim()) return
    setV(await window.yogurt.templates.save(editing)); setEditing(undefined)
  }
  return <>
    <h2 className="settings-section-heading">{t('Summary templates')}</h2>
    <LoadingContent pending={!v}><div data-testid="settings-templates" className="settings-group">
      <div className="settings-row">
        <span className="settings-permission-icon"><LayoutTemplate size={17} strokeWidth={1.75} aria-hidden="true" /></span>
        <div className="settings-row-copy">
          <label htmlFor="settings-default-template" className="settings-label">{t('Default template')}</label>
          <p id="settings-default-template-description" className="settings-description">{t('The shape of new summaries. Each note can use another one.')}</p>
        </div>
        <span className="settings-select-wrap">
          <select id="settings-default-template" data-testid="settings-default-template" aria-describedby="settings-default-template-description" value={v?.defaultId ?? 'general'}
            onChange={(e) => void window.yogurt.templates.setDefault(e.target.value).then(setV)} className="settings-select">
            {templateChoices(v?.custom ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <ChevronDown size={14} aria-hidden="true" />
        </span>
      </div>
      {(v?.custom ?? []).map((c: CustomTemplate) => <div key={c.id} className="settings-row" data-testid="settings-template">
        <div className="settings-row-copy">
          <p className="settings-label">{c.name}</p>
          <p className="settings-description line-clamp-2">{c.instructions}</p>
        </div>
        <div className="flex gap-2">
          <button className="workspace-button settings-action" onClick={() => setEditing({ ...c })}>{t('Edit')}</button>
          <button className="workspace-button settings-action" aria-label={t('Remove {name}', { name: c.name })} onClick={() => void window.yogurt.templates.remove(c.id).then(setV)}><Trash2 size={13} aria-hidden="true" /></button>
        </div>
      </div>)}
      {editing ? <div className="settings-row">
        <div className="settings-row-copy flex flex-col gap-2">
          <input data-testid="settings-template-name" aria-label={t('Template name')} placeholder={t('Template name')} value={editing.name} maxLength={CUSTOM_NAME_MAX}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="w-full rounded-md border border-line bg-bg px-2 py-1.5 text-[13px] text-ink" />
          <textarea data-testid="settings-template-instructions" aria-label={t('How to write the summary')} rows={6} maxLength={CUSTOM_INSTRUCTIONS_MAX}
            placeholder={t('For example: sections "Context", "Decisions", "Risks". Keep it under one page. Quote every figure.')}
            value={editing.instructions} onChange={(e) => setEditing({ ...editing, instructions: e.target.value })} className="w-full rounded-md border border-line bg-bg px-2 py-1.5 text-[13px] text-ink" />
          <div className="flex gap-2">
            <button data-testid="settings-template-save" className="workspace-button" disabled={!editing.name.trim() || !editing.instructions.trim()} onClick={() => void save()}>{t('Save')}</button>
            <button className="workspace-button" onClick={() => setEditing(undefined)}>{t('Cancel')}</button>
          </div>
        </div>
      </div> : (v?.custom.length ?? 0) < CUSTOM_MAX && <div className="settings-row">
        <div className="settings-row-copy"><p className="settings-description">{t('Write your own: name it and say which sections and style you want.')}</p></div>
        <button data-testid="settings-template-new" className="workspace-button settings-action" onClick={() => setEditing({ name: '', instructions: '' })}>{t('New template')}</button>
      </div>}
    </div></LoadingContent>
  </>
}
