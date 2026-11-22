import { useEffect, useState } from 'react'
import { Mic } from '../components/Icons'
import { LoadingContent } from '../components/LoadingContent'
import type { ExpertSettings as Saved, ExpertView } from '../../../shared/expert/types'
import { t } from '../../../shared/i18n'

/** a text field saved when it loses focus (or on Enter); what main refused goes back to what is saved */
function Field({ id, label, hint, value, placeholder, onSave }: { id: string; label: string; hint: string; value: string; placeholder?: string; onSave(v: string): void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const save = () => { if (text.trim() !== value) onSave(text.trim()) }
  return <div className="settings-row">
    <div className="settings-row-copy">
      <label htmlFor={id} className="settings-label">{label}</label>
      <p id={`${id}-hint`} className="settings-description">{hint}</p>
      <input id={id} data-testid={id} dir="ltr" value={text} placeholder={placeholder} autoComplete="off" spellCheck={false} aria-describedby={`${id}-hint`}
        onChange={(e) => setText(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') save() }}
        className="mt-2 w-full rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-[12px] text-ink" />
    </div>
  </div>
}

/** Settings → Expert interviews: where the voice agent runs, which Claude analyses, and whether audio is kept */
export function ExpertSettings() {
  const [v, setV] = useState<ExpertView>()
  useEffect(() => {
    const load = () => void window.yogurt.expert.view().then(setV)
    load()
    return window.yogurt.expert.onChange(load)
  }, [])
  const set = (patch: Partial<Saved>) => void window.yogurt.expert.setSettings(patch).then(setV)
  return <>
    <h2 className="settings-section-heading">{t('Expert interviews')}</h2>
    <LoadingContent pending={!v}><div data-testid="settings-expert" className="settings-group">
      {v && <>
        <div className="settings-row">
          <span className="settings-permission-icon"><Mic size={17} strokeWidth={1.75} aria-hidden="true" /></span>
          <div className="settings-row-copy">
            <span className="settings-label">{t('Amazon Bedrock only')}</span>
            <p className="settings-description">{t('The voice agent and Claude run in your AWS account, signed in as for the notes. No other AI service is used.')}</p>
          </div>
        </div>
        <Field id="expert-voice-region" label={t('Voice region')} value={v.settings.voiceRegion} placeholder="eu-north-1" onSave={(voiceRegion) => set({ voiceRegion })}
          hint={t('Amazon Nova Sonic runs in a few regions only, without cross-region inference: in Europe, eu-north-1 (Stockholm).')} />
        <Field id="expert-voice-model" label={t('Voice model')} value={v.settings.voiceModelId} placeholder="amazon.nova-2-5-sonic" onSave={(voiceModelId) => set({ voiceModelId })}
          hint={t('The role needs bedrock:InvokeModel on this model in the voice region.')} />
        <Field id="expert-analysis-model" label={t('Analysis model')} value={v.settings.analysisModelId} placeholder={v.bedrock.modelId} onSave={(analysisModelId) => set({ analysisModelId })}
          hint={t('Claude prepares interviews, follows what is covered and writes skills, in {region}. The notes model when left empty.', { region: v.bedrock.region })} />
        <div className="settings-row">
          <div className="settings-row-copy">
            <label htmlFor="expert-keep-audio" className="settings-label">{t('Keep interview audio')}</label>
            <p id="expert-keep-audio-description" className="settings-description">{t('On this computer, to listen again. It can be deleted on its own, keeping the transcript.')}</p>
          </div>
          <button id="expert-keep-audio" data-testid="expert-keep-audio" role="switch" aria-checked={v.settings.keepAudio} aria-describedby="expert-keep-audio-description"
            onClick={() => set({ keepAudio: !v.settings.keepAudio })} className="settings-toggle">
            <span className="settings-toggle-knob" />
          </button>
        </div>
      </>}
    </div></LoadingContent>
  </>
}
