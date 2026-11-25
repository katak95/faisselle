import { useEffect, useState } from 'react'
import { Download, Plus, Trash2 } from '../components/Icons'
import { t } from '../../../shared/i18n'
import { SKILL_BODY_MAX, SKILL_DESCRIPTION_MAX, SKILL_NAME_MAX, type Skill, type SkillsExport, type SkillsFailure } from '../../../shared/expert/skills'
import type { InterviewDetail } from '../../../shared/expert/types'

const failureText = (r: SkillsFailure): string => ({
  consent: t('Agree to what is sent to Bedrock first (Before you talk).'),
  bedrock: t('Set up Bedrock first, in Settings → Notes model.'),
  'no-analysis': t('Analyse the interview first: the skills are written from the analysis.'),
  busy: t('Pause the interview first: the skills are written between sessions.'),
  refused: t('Claude declined to write these skills.'),
  unreadable: t("Claude's answer couldn't be read. Try again."),
  failed: t("The skills couldn't be written. Try again."),
})[r]
const exportText = (r: SkillsExport): string | undefined => (r.ok ? t('Skills exported.') : r.reason === 'failed' ? t("The skills couldn't be saved. Try another place.") : r.reason === 'none' ? t('A skill needs a description and instructions to be exported.') : undefined)

const TALKING = ['connecting', 'listening', 'thinking', 'speaking', 'reconnecting']
function useTalking(id: string): boolean {
  const [talking, setTalking] = useState(false)
  useEffect(() => {
    const seen = (v: { interviewId: string | null; state: string }) => setTalking(v.interviewId === id && TALKING.includes(v.state))
    void window.yogurt.expert.voice.state().then(seen)
    return window.yogurt.expert.voice.onState(seen)
  }, [id])
  return talking
}

/** a field saved when it loses focus; a value main changed (the name made valid) comes back into it */
function Field({ id, label, value, max, rows, mono, hint, onSave }: { id: string; label: string; value: string; max: number; rows?: number; mono?: boolean; hint?: string; onSave(v: string): void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const save = () => { if (text !== value) onSave(text) }
  const cls = `w-full rounded-md border border-line bg-bg px-2 py-1.5 text-[13px] text-ink${mono ? ' font-mono' : ''}`
  return <label className="flex flex-col gap-1 px-5 pb-3">
    <span className="settings-label">{label}</span>
    {rows ? <textarea data-testid={id} rows={rows} maxLength={max} value={text} dir="auto" onChange={(e) => setText(e.target.value)} onBlur={save} className={cls} />
      : <input data-testid={id} maxLength={max} value={text} dir="ltr" spellCheck={false} onChange={(e) => setText(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') save() }} className={cls} />}
    {hint && <span data-testid={`${id}-hint`} className="settings-description">{hint}</span>}
  </label>
}

function SkillCard({ id, skill: k, onSaid }: { id: string; skill: Skill; onSaid(text?: string): void }) {
  const [deleting, setDeleting] = useState(false)
  const update = (patch: Partial<Pick<Skill, 'name' | 'description' | 'body'>>) => void window.yogurt.expert.updateSkill(id, k.id, patch)
  const exportIt = async () => onSaid(exportText(await window.yogurt.expert.exportSkills(id, k.id).catch(() => ({ ok: false, reason: 'failed' } as const))))
  const ready = !!k.description && !!k.body
  return <div data-testid="skill" data-name={k.name} data-edited={k.edited} className="settings-group">
    <div className="settings-row">
      <div className="settings-row-copy">
        <span data-testid="skill-name" className="settings-label font-mono" dir="ltr">{k.name}</span>
        <p className="settings-description">{k.edited ? t('Changed by you: kept when the skills are written again.') : t('Written by Claude. Change anything: your version is kept.')}</p>
      </div>
      <button data-testid="skill-export" className="workspace-button" disabled={!ready} onClick={() => void exportIt()}><Download size={14} aria-hidden="true" className="text-muted" />{t('Export')}</button>
      {deleting
        ? <button data-testid="skill-delete-yes" className="workspace-button text-danger" onClick={() => void window.yogurt.expert.deleteSkill(id, k.id)}>{t('Delete forever')}</button>
        : <button data-testid="skill-delete" className="ghost-btn workspace-icon" aria-label={t('Delete {name}', { name: k.name })} title={t('Delete {name}', { name: k.name })} onClick={() => setDeleting(true)}><Trash2 size={14} aria-hidden="true" /></button>}
    </div>
    <Field id="skill-edit-name" label={t('Name')} value={k.name} max={SKILL_NAME_MAX} onSave={(name) => update({ name })}
      hint={t('Lowercase letters, digits and hyphens. It names the skill’s folder.')} />
    <Field id="skill-edit-description" label={t('When an agent should use it')} value={k.description} max={SKILL_DESCRIPTION_MAX} rows={3} onSave={(description) => update({ description })}
      hint={k.description ? undefined : t('An agent reads this to choose the skill: say what it does and when to use it.')} />
    <Field id="skill-edit-body" label={t('Instructions (Markdown)')} value={k.body} max={SKILL_BODY_MAX} rows={14} mono onSave={(body) => update({ body })} />
  </div>
}

/**
 * Skill Studio: the Agent Skills Claude writes from the interview's analysis, to read, change and export. Each is a
 * folder with its SKILL.md, in a zip; the skills the expert changed are kept when the others are written again.
 */
export function SkillStudio({ id, detail }: { id: string; detail: InterviewDetail }) {
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string>()
  const talking = useTalking(id)
  const s = detail.skillsState, list = detail.skills
  const running = s?.state === 'running' || busy
  const write = () => { setSaid(undefined); setBusy(true); void window.yogurt.expert.writeSkills(id).finally(() => setBusy(false)) }
  const exportAll = async () => setSaid(exportText(await window.yogurt.expert.exportSkills(id).catch(() => ({ ok: false, reason: 'failed' } as const))))

  return <>
    <h2 className="settings-section-heading">{t('Skills')}</h2>
    <div data-testid="skill-studio" data-state={running ? 'running' : list.length ? 'done' : 'none'} className="settings-group">
      <div className="settings-row">
        <div className="settings-row-copy">
          <span className="settings-label">{t('Agent Skills from this interview')}</span>
          <p data-testid="skills-status" className="settings-description" aria-live="polite">{running ? t('Claude is writing the skills…')
            : s?.state === 'failed' ? failureText(s.reason)
            : said ?? (list.length ? t('Read them, change what you want, then export them for your agents.') : t('Claude writes the skills from the analysis: one per task, with its steps, rules and checks.'))}</p>
        </div>
        <button data-testid="skills-write" className="workspace-button" disabled={running || talking || !detail.analysis} onClick={write}>
          {running ? t('Writing…') : list.length ? t('Write again') : t('Write the skills')}</button>
        <button data-testid="skill-new" className="workspace-button" onClick={() => void window.yogurt.expert.newSkill(id)}><Plus size={14} aria-hidden="true" className="text-muted" />{t('New skill')}</button>
        {list.length > 1 && <button data-testid="skills-export-all" className="workspace-button" onClick={() => void exportAll()}><Download size={14} aria-hidden="true" className="text-muted" />{t('Export all')}</button>}
      </div>
    </div>
    {list.length > 0 && <div data-testid="skills" className="mt-3 flex flex-col gap-3">{list.map((k) => <SkillCard key={k.id} id={id} skill={k} onSaid={setSaid} />)}</div>}
  </>
}
