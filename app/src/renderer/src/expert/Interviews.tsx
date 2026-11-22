import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { FileText, Mic, Trash2 } from '../components/Icons'
import { LoadingContent } from '../components/LoadingContent'
import { InlineError } from '../components/InlineError'
import { Modal, ModalClose } from '../components/Modal'
import { LibraryEmpty } from '../screens/Home'
import { dayLabel } from '../dates'
import { language, t } from '../../../shared/i18n'
import { consentHolds, DOMAIN_MAX, GOAL_MAX, INTERVIEW_LANGUAGES, MINUTES_MAX, MINUTES_MIN, TITLE_MAX, type ExpertView, type Interview, type InterviewCard, type InterviewDetail, type InterviewDraft, type InterviewState, type SourcesResult } from '../../../shared/expert/types'

/** the screen for an expert-interview route, or null for any other route */
export function expertScreen(route: string, go: (route: string) => void): ReactNode {
  if (route === '/interviews') return <Interviews go={go} />
  if (route.startsWith('/interview/')) { const id = route.slice('/interview/'.length); return <InterviewPage key={id} id={id} go={go} /> }
  return null
}

const languageName = (code: string) => {
  try { return new Intl.DisplayNames([language()], { type: 'language' }).of(code) ?? code } catch { return code }
}
const stateLabel = (s: InterviewState): string => ({
  draft: t('Being prepared'), ready: t('Ready'), 'in-progress': t('Under way'), paused: t('Paused'), ended: t('Ended'),
})[s]
const kilobytes = (bytes: number) => new Intl.NumberFormat(language(), { style: 'unit', unit: 'kilobyte', maximumFractionDigits: 0 }).format(Math.max(1, Math.round(bytes / 1000)))

/** live data from main, read again whenever an interview changes */
function useExpert<T>(read: () => Promise<T>): { value?: T; failed: boolean; reload(): void } {
  const [value, setValue] = useState<T>()
  const [failed, setFailed] = useState(false)
  const reload = useCallback(() => { void read().then((v) => { setFailed(false); setValue(v) }, () => setFailed(true)) }, [read])
  // Bedrock's sign-in, account or model (Settings → Notes model) changes what can be agreed to
  useEffect(() => {
    reload()
    const offs = [window.yogurt.expert.onChange(reload), window.yogurt.cloud.onChange(reload)]
    return () => { for (const off of offs) off() }
  }, [reload])
  return { value, failed, reload }
}

/**
 * Interviews: an expert talks with a voice agent about their work, and what they know becomes Agent Skills. The list,
 * the last changed first, and a new one.
 */
function Interviews({ go }: { go: (route: string) => void }) {
  const read = useCallback(() => window.yogurt.expert.list(), [])
  const { value: cards, failed, reload } = useExpert<InterviewCard[]>(read)
  const [creating, setCreating] = useState(false)
  const [actions, setActions] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => { setActions(document.getElementById('workspace-actions')) }, [])
  return <div data-testid="interviews-page" className="native-folder">
    {actions && createPortal(<button data-testid="interview-new" className="workspace-button no-drag" onClick={() => setCreating(true)}>{t('New interview')}</button>, actions)}
    <div className="native-library">
      <h1>{t('Interviews')}</h1>
      <p className="trash-note">{t('Talk about your work with a voice agent. What you explain becomes skills an AI agent can follow, after you review them.')}</p>
      <LoadingContent pending={!cards && !failed} testId="interviews-loading" className="library-load">{!cards?.length
        ? <LibraryEmpty testId="interviews-none" icon={<Mic size={28} aria-hidden="true" />} title={t('No interviews yet')} description={t('Start with what an agent should be able to do. You can add documents for background.')} retry={failed ? reload : undefined}>
          <button data-testid="interview-new-empty" className="workspace-button" onClick={() => setCreating(true)}>{t('New interview')}</button>
        </LibraryEmpty>
        : <ul aria-label={t('Interviews')}>
          {cards.map((c) => <li key={c.id} data-testid="interview-row" className="native-meeting-row">
            <button className="flex w-full items-center gap-3 px-3 py-2 text-start" onClick={() => go(`/interview/${c.id}`)}>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{c.title}</span>
                <span className="block truncate text-[12px] text-muted">{[c.domain, languageName(c.language), dayLabel(c.updatedAt)].filter(Boolean).join(' · ')}</span>
              </span>
              <span data-testid="interview-row-state" className="text-[12px] text-muted">{stateLabel(c.state)}</span>
            </button>
          </li>)}
        </ul>}
      </LoadingContent>
    </div>
    {creating && <NewInterview onDone={(id) => { setCreating(false); if (id) go(`/interview/${id}`) }} />}
  </div>
}

function NewInterview({ onDone }: { onDone(id?: string): void }) {
  const [title, setTitle] = useState('')
  const [domain, setDomain] = useState('')
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const create = async () => {
    setBusy(true); setFailed(false)
    const made = await window.yogurt.expert.create({ title, domain, goal } as InterviewDraft).catch(() => null)
    setBusy(false)
    if (made) onDone(made.id); else setFailed(true)
  }
  return <Modal testId="interview-create" title={t('New interview')} description={t('What you write here guides the voice agent. You can change it later.')} onCancel={() => onDone()} busy={busy}>
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (title.trim()) void create() }}>
      <label className="flex flex-col gap-1 text-[13px]">{t('Title')}
        <input data-testid="interview-title" data-dialog-focus maxLength={TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} className="rounded-md border border-line bg-bg px-2 py-1.5 text-ink" />
      </label>
      <label className="flex flex-col gap-1 text-[13px]">{t('Skill or field')}
        <input data-testid="interview-domain" maxLength={DOMAIN_MAX} value={domain} onChange={(e) => setDomain(e.target.value)} className="rounded-md border border-line bg-bg px-2 py-1.5 text-ink" />
      </label>
      <label className="flex flex-col gap-1 text-[13px]">{t('What should an agent be able to do?')}
        <textarea data-testid="interview-goal" rows={4} maxLength={GOAL_MAX} value={goal} onChange={(e) => setGoal(e.target.value)} className="rounded-md border border-line bg-bg px-2 py-1.5 text-ink" />
      </label>
      {failed && <InlineError testId="interview-create-failed" className="inline-error-in-dialog"><span>{t("Faisselle couldn't make that change. Try again.")}</span></InlineError>}
      <div className="modal-actions">
        <button type="submit" data-testid="interview-create-yes" disabled={busy || !title.trim()} className="modal-button">{t('Create')}</button>
        <ModalClose type="button" data-dialog-cancel disabled={busy} className="workspace-button">{t('Cancel')}</ModalClose>
      </div>
    </form>
  </Modal>
}

/** a text field saved when it loses focus; what main refused goes back to what is saved */
function SavedText({ id, label, value, max, rows, onSave }: { id: string; label: string; value: string; max: number; rows?: number; onSave(v: string): void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const save = () => { if (text.trim() !== value) onSave(text.trim()) }
  const cls = 'mt-2 w-full rounded-md border border-line bg-bg px-2 py-1.5 text-[13px] text-ink'
  return <div className="settings-row"><div className="settings-row-copy">
    <label htmlFor={id} className="settings-label">{label}</label>
    {rows ? <textarea id={id} data-testid={id} rows={rows} maxLength={max} value={text} onChange={(e) => setText(e.target.value)} onBlur={save} className={cls} />
      : <input id={id} data-testid={id} maxLength={max} value={text} onChange={(e) => setText(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') save() }} className={cls} />}
  </div></div>
}

function skippedText(s: Extract<SourcesResult, { ok: true }>['skipped'][number]) {
  if (s.reason === 'too-big') return t('{name} was not added: it is larger than 1 MB.', { name: s.name })
  if (s.reason === 'not-text') return t('{name} was not added: it is not a text file.', { name: s.name })
  if (s.reason === 'too-many') return t('{name} was not added: an interview takes 20 files at most.', { name: s.name })
  return t("{name} was not added: it couldn't be read.", { name: s.name })
}

/** one interview: what it is about, its sources, and what the expert agrees to send before talking */
function InterviewPage({ id, go }: { id: string; go: (route: string) => void }) {
  const read = useCallback(() => Promise.all([window.yogurt.expert.get(id), window.yogurt.expert.view()]), [id])
  const { value, failed, reload } = useExpert<[InterviewDetail | null, ExpertView]>(read)
  const [skipped, setSkipped] = useState<string[]>([])
  const [deleting, setDeleting] = useState(false)
  const [actions, setActions] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => { setActions(document.getElementById('workspace-actions')) }, [])
  const detail = value?.[0], view = value?.[1]
  if (value && !detail) return <div className="native-folder"><div className="native-library">
    <LibraryEmpty testId="interview-missing" icon={<Mic size={28} aria-hidden="true" />} title={t('This interview was deleted')} description={t('It is no longer on this computer.')}>
      <button className="workspace-button" onClick={() => go('/interviews')}>{t('Interviews')}</button>
    </LibraryEmpty>
  </div></div>
  const i = detail?.interview
  const update = (patch: Partial<InterviewDraft>) => void window.yogurt.expert.update(id, patch)
  const add = async () => {
    const r = await window.yogurt.expert.addSources(id)
    setSkipped(r.ok ? r.skipped.map(skippedText) : [])
  }
  return <div data-testid="interview-page" className="native-folder">
    {actions && i && createPortal(<button data-testid="interview-delete" className="ghost-btn workspace-icon no-drag" aria-label={t('Delete interview')} title={t('Delete interview')} onClick={() => setDeleting(true)}><Trash2 size={14} aria-hidden="true" /></button>, actions)}
    <div className="native-library">
      <LoadingContent pending={!value && !failed} testId="interview-loading">{failed ? <InlineError testId="interview-read-error" retry={reload} /> : i && view && <>
        <h1 data-testid="interview-heading">{i.title}</h1>
        <p data-testid="interview-state" className="trash-note">{stateLabel(i.state)}</p>

        <h2 className="settings-section-heading">{t('Preparation')}</h2>
        <div className="settings-group">
          <SavedText id="interview-edit-title" label={t('Title')} value={i.title} max={TITLE_MAX} onSave={(title) => { if (title) update({ title }) }} />
          <SavedText id="interview-edit-domain" label={t('Skill or field')} value={i.domain} max={DOMAIN_MAX} onSave={(domain) => update({ domain })} />
          <SavedText id="interview-edit-goal" label={t('What should an agent be able to do?')} value={i.goal} max={GOAL_MAX} rows={4} onSave={(goal) => update({ goal })} />
          <div className="settings-row">
            <div className="settings-row-copy"><label htmlFor="interview-language" className="settings-label">{t('Interview language')}</label></div>
            <select id="interview-language" data-testid="interview-language" value={i.language} onChange={(e) => update({ language: e.target.value as Interview['language'] })} className="settings-select">
              {INTERVIEW_LANGUAGES.map((l) => <option key={l} value={l}>{languageName(l)}</option>)}
            </select>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy"><label htmlFor="interview-minutes" className="settings-label">{t('About how long, in minutes')}</label></div>
            <input id="interview-minutes" data-testid="interview-minutes" type="number" min={MINUTES_MIN} max={MINUTES_MAX} defaultValue={i.minutes} key={i.minutes}
              onBlur={(e) => { const n = Number(e.target.value); if (n && n !== i.minutes) update({ minutes: n }) }} className="w-20 rounded-md border border-line bg-bg px-2 py-1.5 text-[13px] text-ink" />
          </div>
        </div>

        <h2 className="settings-section-heading">{t('Documents')}</h2>
        <div data-testid="interview-sources" className="settings-group">
          <div className="settings-row">
            <div className="settings-row-copy">
              <span className="settings-label">{t('Background for the interview')}</span>
              <p className="settings-description">{t('Text files you choose. They are kept with the interview and sent to Claude only to prepare and analyse it.')}</p>
            </div>
            <button data-testid="interview-add-sources" className="workspace-button" onClick={() => void add()}>{t('Add files…')}</button>
          </div>
          {detail.sources.map((s) => <div key={s.id} data-testid="interview-source" className="settings-row">
            <FileText size={16} aria-hidden="true" />
            <div className="settings-row-copy"><span className="settings-label">{s.name}</span><p className="settings-description">{kilobytes(s.bytes)}</p></div>
            <button data-testid="interview-source-remove" className="ghost-btn workspace-icon" aria-label={t('Remove {name}', { name: s.name })} title={t('Remove {name}', { name: s.name })}
              onClick={() => void window.yogurt.expert.removeSource(id, s.id)}><Trash2 size={14} aria-hidden="true" /></button>
          </div>)}
          {skipped.map((s) => <p key={s} data-testid="interview-source-skipped" className="settings-description px-3 pb-2">{s}</p>)}
        </div>

        <Consent interview={i} view={view} go={go} />
      </>}</LoadingContent>
    </div>
    {deleting && i && <DeleteInterview interview={i} onDone={(gone) => { setDeleting(false); if (gone) go('/interviews') }} />}
  </div>
}

/** what goes to Bedrock, and where everything else stays: agreed to before the interview, and again when that changes */
function Consent({ interview: i, view: v, go }: { interview: Interview; view: ExpertView; go: (route: string) => void }) {
  const [busy, setBusy] = useState(false)
  const now = { voiceRegion: v.settings.voiceRegion, voiceModelId: v.settings.voiceModelId, region: v.bedrock.region, modelId: v.bedrock.modelId }
  const holds = consentHolds(i.consent, now)
  return <>
    <h2 className="settings-section-heading">{t('Before you talk')}</h2>
    <div data-testid="interview-consent" className="settings-group">
      <ul className="flex list-disc flex-col gap-2 px-8 py-3 text-[13px] text-ink">
        <li data-testid="consent-voice">{t('Your voice is sent to Amazon Nova Sonic ({model}) in {region}, in your AWS account, to hold the conversation.', { model: now.voiceModelId, region: now.voiceRegion })}</li>
        <li data-testid="consent-analysis">{t('The transcript and the documents you add are sent to Claude ({model}) in {region}, to prepare the interview, follow what is covered and write skills.', { model: now.modelId, region: now.region })}</li>
        <li>{t('Audio, transcripts, analyses and skills are kept on this computer, in {folder}. Nothing is sent anywhere else, published or shared.', { folder: v.dataDir })}</li>
        <li>{t('You can pause, stop, correct and delete at any time. A skill you export is your draft, not an official procedure.')}</li>
      </ul>
      <div className="settings-row">
        <div className="settings-row-copy">
          <p data-testid="consent-status" className="settings-description">{!v.bedrock.ready
            ? t('Sign in to Amazon Bedrock and choose an account and role in Settings → Notes model first.')
            : holds ? t('You agreed on {date}.', { date: dayLabel(i.consent!.at) })
            : i.consent ? t('The regions or models changed since you agreed. Agree again to go on.')
            : t('Agree to this to hold the interview.')}</p>
        </div>
        {!v.bedrock.ready
          ? <button data-testid="consent-settings" className="workspace-button" onClick={() => go('/settings/notes-model')}>{t('Open Settings')}</button>
          : !holds && <button data-testid="consent-agree" className="workspace-button" disabled={busy} onClick={() => { setBusy(true); void window.yogurt.expert.consent(i.id).finally(() => setBusy(false)) }}>{t('I agree')}</button>}
        <button data-testid="consent-show-data" className="workspace-button" onClick={() => window.yogurt.expert.showData()}>{t('Show folder')}</button>
      </div>
    </div>
  </>
}

function DeleteInterview({ interview, onDone }: { interview: Interview; onDone(gone: boolean): void }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const yes = async () => {
    setBusy(true); setFailed(false)
    const gone = await window.yogurt.expert.delete(interview.id).catch(() => false)
    setBusy(false)
    if (gone) onDone(true); else setFailed(true)
  }
  return <Modal testId="interview-delete-confirm" role="alertdialog" title={t('Delete “{title}” forever?', { title: interview.title })}
    description={t('Its preparation, documents, transcript and audio are removed from this computer for good. Skills you exported stay where you saved them.')} onCancel={() => onDone(false)} busy={busy}>
    {failed && <InlineError testId="interview-delete-failed" className="inline-error-in-dialog"><span>{t("Faisselle couldn't make that change. Try again.")}</span></InlineError>}
    <div className="modal-actions">
      <button data-testid="interview-delete-yes" onClick={() => void yes()} disabled={busy} className="modal-button danger">{t('Delete forever')}</button>
      <ModalClose data-testid="interview-delete-cancel" data-dialog-cancel disabled={busy} className="workspace-button">{t('Cancel')}</ModalClose>
    </div>
  </Modal>
}
