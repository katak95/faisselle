import { useEffect, useState } from 'react'
import { ChevronDown, Cloud } from 'lucide-react'
import type { CloudNotesView } from '../../../shared/types'
import { t } from '../../../shared/i18n'
import { LoadingContent } from './LoadingContent'

type Config = CloudNotesView['config']

/** a text field saved when it loses focus (or on Enter); what main refused goes back to what is saved */
function Field({ id, label, value, placeholder, onSave }: { id: string; label: string; value: string; placeholder?: string; onSave(v: string): void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const save = () => { if (text.trim() !== value) onSave(text.trim()) }
  return <div className="settings-row">
    <div className="settings-row-copy">
      <label htmlFor={id} className="settings-label">{label}</label>
      <input id={id} data-testid={id} dir="ltr" value={text} placeholder={placeholder} autoComplete="off" spellCheck={false}
        onChange={(e) => setText(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') save() }}
        className="mt-2 w-full rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-[12px] text-ink" />
    </div>
  </div>
}

/**
 * Settings → Notes model: written on this computer, or by Claude on Amazon Bedrock. Bedrock needs a sign-in to
 * AWS IAM Identity Center (the browser opens with a code), then an account and a role allowed to use Bedrock.
 */
export function CloudNotesSettings() {
  const [v, setV] = useState<CloudNotesView>()
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>()
  const [roles, setRoles] = useState<string[]>()
  const [test, setTest] = useState<{ ok: true } | { ok: false; message: string } | 'running'>()
  useEffect(() => {
    void window.yogurt.cloud.get().then(setV)
    return window.yogurt.cloud.onChange(setV)
  }, [])
  const signedIn = v?.sso.state === 'signed-in'
  useEffect(() => {
    if (!signedIn || v?.provider !== 'bedrock') return
    void window.yogurt.cloud.accounts().then(setAccounts, () => setAccounts([]))
  }, [signedIn, v?.provider])
  const accountId = v?.config.accountId
  useEffect(() => {
    if (!signedIn || !accountId) { setRoles(undefined); return }
    void window.yogurt.cloud.roles(accountId).then(setRoles, () => setRoles([]))
  }, [signedIn, accountId])
  const set = (c: Partial<Config>) => { setTest(undefined); void window.yogurt.cloud.setConfig(c).then(setV) }

  const bedrock = v?.provider === 'bedrock'
  return <>
    <h2 className="settings-section-heading">{t('Notes model')}</h2>
    <LoadingContent pending={!v}><div data-testid="cloud-notes" className="settings-group">
      <div className="settings-row">
        <span className="settings-permission-icon"><Cloud size={17} strokeWidth={1.75} aria-hidden="true" /></span>
        <div className="settings-row-copy">
          <label htmlFor="cloud-notes-provider" className="settings-label">{t('Where summaries are written')}</label>
          <p id="cloud-notes-provider-description" className="settings-description">{bedrock
            ? t('Transcripts, notes and related emails are sent to Amazon Bedrock in your AWS account to write summaries, briefs and emails.')
            : v && !v.canRunLocally ? t("This computer can't run the notes model. Choose Amazon Bedrock to get summaries.")
            : t('On this computer: nothing leaves it.')}</p>
        </div>
        <span className="settings-select-wrap">
          <select id="cloud-notes-provider" data-testid="cloud-notes-provider" aria-describedby="cloud-notes-provider-description" value={v?.provider ?? 'local'}
            onChange={(e) => void window.yogurt.cloud.setProvider(e.target.value as 'local' | 'bedrock').then(setV)} className="settings-select">
            <option value="local">{t('This computer')}</option>
            <option value="bedrock">{t('Amazon Bedrock (Claude)')}</option>
          </select>
          <ChevronDown size={14} aria-hidden="true" />
        </span>
      </div>

      {bedrock && v && <>
        <Field id="cloud-start-url" label={t('AWS sign-in start URL')} value={v.config.startUrl} placeholder="https://example.awsapps.com/start" onSave={(startUrl) => set({ startUrl })} />
        <Field id="cloud-sso-region" label={t('Identity Center region')} value={v.config.ssoRegion} placeholder="eu-west-1" onSave={(ssoRegion) => set({ ssoRegion })} />

        <div className="settings-row" data-testid="cloud-sign-in">
          <div className="settings-row-copy">
            <p className="settings-label">{t('AWS account')}</p>
            <p className="settings-description" aria-live="polite">{
              v.sso.state === 'signed-in' ? t('Signed in to {url}', { url: v.sso.startUrl })
              : v.sso.state === 'pending' ? t('Approve the sign-in in your browser. Code: {code}', { code: v.sso.userCode })
              : v.sso.state === 'expired' ? t('The sign-in ran out. Sign in again.')
              : v.sso.state === 'error' ? t("Signing in didn't work. Check the start URL and region, then try again.")
              : t('Not signed in.')}</p>
            {v.sso.state === 'pending' && <a className="settings-description underline" href={v.sso.url} target="_blank" rel="noreferrer">{t('Open the sign-in page again')}</a>}
          </div>
          {v.sso.state === 'signed-in'
            ? <button data-testid="cloud-sign-out" className="workspace-button settings-action" onClick={() => void window.yogurt.cloud.signOut().then(setV)}>{t('Sign out')}</button>
            : v.sso.state === 'pending'
            ? <button data-testid="cloud-cancel" className="workspace-button settings-action" onClick={() => void window.yogurt.cloud.cancelSignIn().then(setV)}>{t('Cancel')}</button>
            : <button data-testid="cloud-sign-in-button" className="workspace-button settings-action" disabled={!v.config.startUrl} onClick={() => void window.yogurt.cloud.signIn().then(setV)}>{t('Sign in to AWS')}</button>}
        </div>

        {signedIn && <div className="settings-row">
          <div className="settings-row-copy"><label htmlFor="cloud-account" className="settings-label">{t('Account')}</label></div>
          <span className="settings-select-wrap">
            <select id="cloud-account" data-testid="cloud-account" value={v.config.accountId} disabled={!accounts} onChange={(e) => set({ accountId: e.target.value })} className="settings-select">
              <option value="">{t('Choose…')}</option>
              {(accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.id})</option>)}
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </span>
        </div>}
        {signedIn && v.config.accountId && <div className="settings-row">
          <div className="settings-row-copy"><label htmlFor="cloud-role" className="settings-label">{t('Role')}</label></div>
          <span className="settings-select-wrap">
            <select id="cloud-role" data-testid="cloud-role" value={v.config.roleName} disabled={!roles} onChange={(e) => set({ roleName: e.target.value })} className="settings-select">
              <option value="">{t('Choose…')}</option>
              {(roles ?? []).map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </span>
        </div>}

        <Field id="cloud-region" label={t('Bedrock region')} value={v.config.region} placeholder="eu-west-1" onSave={(region) => set({ region })} />
        <Field id="cloud-model" label={t('Model')} value={v.config.modelId} placeholder="anthropic.claude-haiku-5-5" onSave={(modelId) => set({ modelId })} />

        {v.ready && <div className="settings-row">
          <div className="settings-row-copy">
            <p className="settings-label">{t('Check the connection')}</p>
            <p className="settings-description" aria-live="polite" data-testid="cloud-test-result">{test === 'running' ? t('Checking…') : test?.ok ? t('Bedrock answered. Summaries will be written there.') : test ? test.message : t('Sends a very short request to the model.')}</p>
          </div>
          <button data-testid="cloud-test" className="workspace-button settings-action" disabled={test === 'running'}
            onClick={() => { setTest('running'); void window.yogurt.cloud.test().then(setTest) }}>{t('Check')}</button>
        </div>}
      </>}
    </div></LoadingContent>
  </>
}
