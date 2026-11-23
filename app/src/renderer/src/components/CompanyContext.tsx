import { useEffect, useRef, useState } from 'react'
import { t } from '../../../shared/i18n'
import { LoadingContent } from './LoadingContent'

/** the same limit as main/organisation.ts */
const MAX = 4000

/**
 * Settings → Company context: what the person writes about their organisation, read by the model as background for
 * the notes, the action items, the follow-up email, the brief and Ask. Saved when the field is left.
 */
export function CompanyContext() {
  const [saved, setSaved] = useState<string>()
  const [text, setText] = useState('')
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => { void window.yogurt.settings.get().then((s) => { setSaved(s.organisation); setText(s.organisation) }) }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  const save = async () => {
    if (saved === undefined || text.trim() === saved) return
    setState('saving')
    try {
      const kept = await window.yogurt.settings.setOrganisation(text)
      setSaved(kept); setText(kept); setState('saved')
      clearTimeout(timer.current); timer.current = setTimeout(() => setState('idle'), 2000)
    } catch { setState('failed') }
  }
  return <>
    <h2 className="settings-section-heading">{t('Company context')}</h2>
    <LoadingContent pending={saved === undefined}><div data-testid="company-context" className="settings-group">
      <div className="settings-row">
        <div className="settings-row-copy">
          <label htmlFor="company-context-text" className="settings-label">{t('About your organisation')}</label>
          <p id="company-context-description" className="settings-description">{t('What your organisation does, its clients, products, teams and words: the AI reads it as background for summaries, action items, follow-up emails, briefs and Ask. On Amazon Bedrock it is sent with them.')}</p>
          <textarea id="company-context-text" data-testid="company-context-text" aria-describedby="company-context-description" value={text} maxLength={MAX} rows={8}
            placeholder={t('For example: Acme makes billing software for dentists in France and Belgium. Our clients are clinics and dental groups. Teams: Sales, Customer success, Product. "MRR" is monthly recurring revenue; "the Q3 rollout" is the move of all clinics to the new version.')}
            onChange={(e) => { setText(e.target.value); setState('idle') }} onBlur={() => void save()}
            className="mt-2 w-full resize-y rounded-md border border-line bg-bg px-2 py-1.5 text-[13px] leading-relaxed text-ink" dir="auto" />
          <p className="settings-description flex justify-between" aria-live="polite">
            <span data-testid="company-context-state">{state === 'saving' ? t('Saving…') : state === 'saved' ? t('Saved') : state === 'failed' ? t("Couldn't save your changes") : ''}</span>
            <span dir="ltr" aria-label={`${text.length} / ${MAX}`}>{text.length} / {MAX}</span>
          </p>
        </div>
      </div>
    </div></LoadingContent>
  </>
}
