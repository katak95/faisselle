import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
// the app's own icons (Hugeicons, Icons.tsx), under the names these components use
import { Check, ChevronDown, Copy, ListChecks, MessageCircle as Mail, Plus, RotateCcw, Lightbulb as Sparkles, Trash2 } from './Icons'
import type { ExtrasKind, ExtrasView, FollowUp, TemplatesView } from '../../../shared/types'
import type { ActionItem } from '../../../shared/actions'
import { actionsMarkdown } from '../../../shared/actions'
import { templateChoices, GENERAL } from '../../../shared/templates'
import { t } from '../../../shared/i18n'
import { Editor } from './Editor'
import { InlineError } from './InlineError'

type Person = { name: string; email: string | null }

function useExtras(id: string) {
  const [v, setV] = useState<ExtrasView | null>(null)
  useEffect(() => {
    let live = true
    void window.yogurt.extras.get(id).then((x) => { if (live) setV(x) })
    const off = window.yogurt.extras.onChange((x) => { if (x.meetingId === id) setV(x) })
    return () => { live = false; off() }
  }, [id])
  return v
}

function CopyButton({ text, testId }: { text: string; testId: string }) {
  const [done, setDone] = useState(false)
  return <button data-testid={testId} className="workspace-button" onClick={() => void navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500) })}>
    {done ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}{done ? t('Copied') : t('Copy')}
  </button>
}

const failedFor = (v: ExtrasView, kind: ExtrasKind) => (v.failed?.kind === kind ? v.failed.message : undefined)
const writingFor = (v: ExtrasView, kind: ExtrasKind) => (v.writing?.kind === kind ? v.writing : undefined)

/**
 * The summary's template, picked for this meeting: picking another writes the notes again with it. A menu (like the
 * mic's), not a native list: its choices only exist while it is open, so they never mix with the note's other lists.
 */
function TemplatePicker({ id, current }: { id: string; current: string | null }) {
  const [tv, setTv] = useState<TemplatesView>()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null)
  useEffect(() => { void window.yogurt.templates.get().then(setTv) }, [])
  useEffect(() => {
    if (!open) return
    root.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"], [role="menuitemradio"]')?.focus()
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])
  if (!tv) return null
  const value = current ?? tv.defaultId ?? GENERAL
  const choices = templateChoices(tv.custom)
  const choose = (next: string) => {
    setOpen(false); button.current?.focus()
    if (next !== value) void window.yogurt.extras.setTemplate(id, next)
  }
  const onKey = (e: KeyboardEvent) => {
    const list = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])
    const at = list.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); button.current?.focus() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); list[(at + 1) % list.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(at - 1 + list.length) % list.length]?.focus() }
    else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus() }
    else if (e.key === 'End') { e.preventDefault(); list.at(-1)?.focus() }
    else if (e.key === 'Tab') setOpen(false)
  }
  const row = 'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-start text-sm hover:bg-[var(--line)] focus-visible:bg-[var(--line)] focus-visible:outline-none'
  return <div ref={root} className="note-extras-template relative flex items-center gap-2 text-[12px] text-muted">
    <span id={`note-template-label-${id}`}>{t('Template')}</span>
    <button ref={button} data-testid="note-template" data-value={value} aria-haspopup="menu" aria-expanded={open}
      aria-labelledby={`note-template-label-${id} note-template-value-${id}`} onClick={() => setOpen((o) => !o)}
      className="workspace-button flex items-center gap-1.5">
      <span id={`note-template-value-${id}`}>{choices.find((c) => c.id === value)?.name ?? value}</span>
      <ChevronDown size={13} aria-hidden="true" />
    </button>
    {open && <div data-testid="note-template-menu" role="menu" aria-label={t('Template')} onKeyDown={onKey}
      className="absolute start-0 top-full z-30 mt-1 w-64 rounded-xl border border-line bg-float p-1.5 text-ink shadow-[var(--shadow)]">
      {choices.map((c) => <button key={c.id} role="menuitemradio" aria-checked={c.id === value} data-testid="note-template-option" data-id={c.id}
        onClick={() => choose(c.id)} className={row}>
        <span className="truncate">{c.name}</span>
        <Check size={15} aria-hidden="true" className={`ms-auto shrink-0 ${c.id === value ? '' : 'invisible'}`} />
      </button>)}
    </div>}
  </div>
}

function Actions({ id, v }: { id: string; v: ExtrasView }) {
  // shown at once, saved behind: a tick never waits for the round trip
  const [items, setItems] = useState<ActionItem[]>(v.actions ?? [])
  useEffect(() => setItems(v.actions ?? []), [v.actions])
  const [adding, setAdding] = useState('')
  const save = (next: ActionItem[]) => { setItems(next); void window.yogurt.extras.setActions(id, next) }
  const writing = writingFor(v, 'actions'), failed = failedFor(v, 'actions')
  return <section data-testid="note-actions" className="note-extras-section" aria-labelledby="note-actions-heading">
    <div className="note-extras-heading">
      <h2 id="note-actions-heading"><ListChecks size={15} aria-hidden="true" />{t('Action items')}</h2>
      <div className="flex gap-2">
        {items.length > 0 && <CopyButton testId="note-actions-copy" text={actionsMarkdown(items)} />}
        <button data-testid="note-actions-refresh" className="workspace-button" disabled={!!writing} onClick={() => void window.yogurt.extras.write(id, 'actions')} aria-label={t('Take the action items from the summary again')}>
          <RotateCcw size={13} aria-hidden="true" />{writing ? t('Reading the summary…') : t('Refresh')}
        </button>
      </div>
    </div>
    {failed && <InlineError testId="note-actions-failed"><span>{t("Figolu couldn't list the action items.")}</span></InlineError>}
    {v.actions === null && !writing && <p className="text-[13px] text-muted">{t('The action items appear here once the summary is written.')}</p>}
    {v.actions !== null && !items.length && <p className="text-[13px] text-muted">{t('Nobody said they would do anything.')}</p>}
    <ul className="note-actions-list">
      {items.map((a, i) => <li key={`${i}-${a.task}`} data-done={a.done}>
        <input type="checkbox" checked={a.done} aria-label={a.task} onChange={(e) => save(items.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))} />
        <span className="note-action-owner">{a.owner}</span>
        <span className="note-action-task" dir="auto">{a.task}</span>
        {a.due && <span className="note-action-due">{a.due}</span>}
        <button className="note-action-remove" aria-label={t('Remove {name}', { name: a.task })} onClick={() => save(items.filter((_, j) => j !== i))}><Trash2 size={12} aria-hidden="true" /></button>
      </li>)}
    </ul>
    <form className="note-actions-add" onSubmit={(e) => { e.preventDefault(); const task = adding.trim(); if (!task) return; save([...items, { owner: t('You'), task, due: null, done: false }]); setAdding('') }}>
      <Plus size={13} aria-hidden="true" className="text-muted" />
      <input data-testid="note-actions-add" value={adding} onChange={(e) => setAdding(e.target.value)} placeholder={t('Add an action item')} maxLength={300} />
    </form>
  </section>
}

/** mailto: with the people's addresses; the body cut so the link stays short enough for mail apps */
const mailto = (people: Person[], f: FollowUp) => {
  const to = people.map((p) => p.email).filter(Boolean).join(',')
  return `mailto:${encodeURIComponent(to).replace(/%2C/g, ',')}?subject=${encodeURIComponent(f.subject)}&body=${encodeURIComponent(f.body.slice(0, 1800))}`
}

function FollowUpEmail({ id, v, people }: { id: string; v: ExtrasView; people: Person[] }) {
  const writing = writingFor(v, 'followup'), failed = failedFor(v, 'followup')
  const [draft, setDraft] = useState<FollowUp | null>(v.followup)
  useEffect(() => setDraft(v.followup), [v.followup])
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const edit = (f: FollowUp) => { setDraft(f); clearTimeout(timer.current); timer.current = setTimeout(() => void window.yogurt.extras.setFollowUp(id, f), 400) }
  return <section data-testid="note-followup" className="note-extras-section" aria-labelledby="note-followup-heading">
    <div className="note-extras-heading">
      <h2 id="note-followup-heading"><Mail size={15} aria-hidden="true" />{t('Follow-up email')}</h2>
      <div className="flex gap-2">
        {draft && !writing && <CopyButton testId="note-followup-copy" text={`${draft.subject}\n\n${draft.body}`} />}
        {draft && !writing && <a data-testid="note-followup-open" className="workspace-button" href={mailto(people, draft)}>{t('Open in my email app')}</a>}
        <button data-testid="note-followup-write" className="workspace-button" disabled={!!writing} onClick={() => void window.yogurt.extras.write(id, 'followup')}>
          <Sparkles size={13} aria-hidden="true" />{writing ? t('Writing…') : draft ? t('Write again') : t('Write the email')}
        </button>
      </div>
    </div>
    {failed && <InlineError testId="note-followup-failed"><span>{t("Figolu couldn't write the email.")}</span></InlineError>}
    {writing && <p data-testid="note-followup-draft" className="note-followup-body whitespace-pre-wrap" aria-live="polite">{writing.draft}</p>}
    {!writing && draft && <div className="flex flex-col gap-2">
      <input data-testid="note-followup-subject" aria-label={t('Subject')} value={draft.subject} onChange={(e) => edit({ ...draft, subject: e.target.value })} className="note-followup-subject" />
      <textarea data-testid="note-followup-body" aria-label={t('Email')} value={draft.body} rows={Math.min(24, draft.body.split('\n').length + 2)} onChange={(e) => edit({ ...draft, body: e.target.value })} className="note-followup-body" />
    </div>}
  </section>
}

/** before a meeting: what to know and ask, from earlier meetings with these people, the invite and related emails */
export function MeetingBrief({ id }: { id: string }) {
  const v = useExtras(id)
  if (!v) return null
  const writing = writingFor(v, 'brief'), failed = failedFor(v, 'brief')
  // a document's link opens in the browser (main's window-open handler), not as an edit in the text
  const openLink = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a')
    const href = a?.getAttribute('href') ?? ''
    if (!a || !/^https:\/\//.test(href)) return
    e.preventDefault(); e.stopPropagation()
    window.open(href, '_blank', 'noopener')
  }
  return <section data-testid="note-brief" className="note-extras-section" aria-labelledby="note-brief-heading" onClickCapture={openLink}>
    <div className="note-extras-heading">
      <h2 id="note-brief-heading"><Sparkles size={15} aria-hidden="true" />{t('Brief')}</h2>
      <div className="flex gap-2">
        {v.brief && !writing && <CopyButton testId="note-brief-copy" text={v.brief} />}
        <button data-testid="note-brief-write" className="workspace-button" disabled={!!writing} onClick={() => void window.yogurt.extras.write(id, 'brief')}>
          {writing ? t('Preparing…') : v.brief ? t('Prepare again') : t('Prepare a brief')}
        </button>
      </div>
    </div>
    {!v.brief && !writing && <p className="text-[13px] text-muted">{v.contextAvailable
      ? t('What was said before with these people, open points, related emails and documents, and questions to ask.')
      : t('What was said before with these people, open points and questions to ask. Connect Microsoft 365 in Settings to add the invite and related emails.')}</p>}
    {failed && <InlineError testId="note-brief-failed"><span>{t("Figolu couldn't prepare the brief.")}</span></InlineError>}
    {(writing || v.brief) && <Editor testId="note-brief-text" label={t('Brief')} className="enhanced" markdown={writing ? writing.draft : v.brief ?? ''} streaming={!!writing} editable={!writing}
      onChange={(md) => void window.yogurt.extras.setBrief(id, md)} />}
  </section>
}

/** under the summary: the template, the action items, the follow-up email and whether emails are read */
export function NoteExtras({ id, people }: { id: string; people: Person[] }) {
  const v = useExtras(id)
  if (!v) return null
  return <div data-testid="note-extras" className="note-extras">
    <div className="note-extras-bar">
      <TemplatePicker id={id} current={v.templateId} />
      {v.contextAvailable && <label className="flex items-center gap-2 text-[12px] text-muted">
        <input data-testid="note-use-context" type="checkbox" checked={v.useContext !== false} onChange={(e) => void window.yogurt.extras.useContext(id, e.target.checked)} />
        {t('Read the invite, related emails and documents')}
      </label>}
    </div>
    <Actions id={id} v={v} />
    <FollowUpEmail id={id} v={v} people={people} />
    {v.brief && <MeetingBrief id={id} />}
  </div>
}
