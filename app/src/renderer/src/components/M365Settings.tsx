import { useEffect, useState } from 'react'
// the app's own icons (Hugeicons, Icons.tsx), under the names these components use
import { MessageCircle as Mail } from './Icons'
import type { M365Method, M365Status, M365View } from '../../../shared/types'
import { t } from '../../../shared/i18n'
import { LoadingContent } from './LoadingContent'

/**
 * Settings → Microsoft 365, read only: the Outlook calendar in Faisselle, and the invite and recent emails with the
 * people in a meeting to prepare briefs and write summaries. Signing in is Microsoft's code page, or for an
 * organisation's app that doesn't allow it, the browser on that app's redirect URI.
 */

type AppForm = { clientId: string; tenantId: string; method: M365Method; redirectUri: string; secret: string }
const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1):\d{1,5}\/\S*$/

/** what a browser sign-in needs, said in Settings */
function problemText(p: NonNullable<Extract<M365Status, { state: 'error' }>['problem']>) {
  return p === 'secret-needed' ? t("Your app wants its client secret. Add it under Use your organization's own app.")
    : p === 'secret-wrong' ? t("Microsoft refused the client secret. Check it under Use your organization's own app.")
    : p === 'secret-not-allowed' ? t("Your app takes no client secret. Remove it under Use your organization's own app.")
    : p === 'redirect-mismatch' ? t("Microsoft doesn't know this redirect URI for your app. Copy it exactly from Azure.")
    : p === 'port-busy' ? t("The redirect URI's port is busy, maybe with another sign-in. Finish that one and try again.")
    : t("Microsoft 365 didn't connect. Try again, or ask your administrator to allow the app.")
}
export function M365Settings() {
  const [v, setV] = useState<M365View>()
  const [app, setApp] = useState<AppForm>()
  const [advanced, setAdvanced] = useState(false)
  useEffect(() => {
    void window.yogurt.m365.get().then((x) => { setV(x); setApp({ clientId: x.clientId, tenantId: x.tenantId, method: x.method, redirectUri: x.redirectUri, secret: '' }); if (x.method === 'browser') setAdvanced(true) })
    return window.yogurt.m365.onChange(setV)
  }, [])
  const st = v?.status
  return <>
    <h2 className="settings-section-heading">{t('Microsoft 365')}</h2>
    <LoadingContent pending={!v}><div data-testid="settings-m365" className="settings-group">
      <div className="settings-row">
        <span className="settings-permission-icon"><Mail size={17} strokeWidth={1.75} aria-hidden="true" /></span>
        <div className="settings-row-copy">
          <p className="settings-label">{t('Outlook calendar and email')}</p>
          <p className="settings-description" aria-live="polite" data-testid="settings-m365-status">{
            st?.state === 'connected' ? t('Connected{account}. Faisselle only reads: it never sends, changes or deletes anything.', { account: st.account ? ` · ${st.account}` : '' })
            : st?.state === 'pending' && st.code ? t('On the Microsoft page, enter the code {code}', { code: st.code })
            : st?.state === 'pending' ? t('Finish signing in on the Microsoft page in your browser.')
            : st?.state === 'starting' ? t('Connecting…')
            : st?.state === 'error' && st.problem ? problemText(st.problem)
            : st?.state === 'error' && st.consent ? t('Your administrator has to approve the permissions Faisselle asks for. Send them the docs, or turn off SharePoint and OneDrive search.')
            : st?.state === 'error' ? t("Microsoft 365 didn't connect. Try again, or ask your administrator to allow the app.")
            : t('Read your Outlook calendar, and the invite and recent emails with the people in a meeting, to prepare briefs and write better summaries.')}</p>
          {st?.state === 'pending' && <a className="settings-description underline" href={st.url} target="_blank" rel="noreferrer">{t('Open the Microsoft page again')}</a>}
        </div>
        {st?.state === 'connected'
          ? <button data-testid="settings-m365-sign-out" className="workspace-button settings-action" onClick={() => void window.yogurt.m365.signOut().then(setV)}>{t('Disconnect')}</button>
          : st?.state === 'pending'
          ? <button className="workspace-button settings-action" onClick={() => void window.yogurt.m365.cancel().then(setV)}>{t('Cancel')}</button>
          : <button data-testid="settings-m365-connect" className="workspace-button settings-action" disabled={st?.state === 'starting'} onClick={() => void window.yogurt.m365.signIn().then(setV)}>{t('Connect')}</button>}
      </div>
      {st?.state === 'connected' && <div className="settings-row">
        <div className="settings-row-copy">
          <p className="settings-label">{t('Show the Outlook calendar')}</p>
          <p className="settings-description">{t('Outlook meetings in the agenda, with reminders to record.')}</p>
        </div>
        <button data-testid="settings-m365-calendar" role="switch" aria-checked={v!.calendar} aria-label={t('Show the Outlook calendar')} onClick={() => void window.yogurt.m365.setCalendar(!v!.calendar).then(setV)} className="settings-toggle"><span className="settings-toggle-knob" /></button>
      </div>}
      {(st?.state === 'connected' || v?.documents) && <div className="settings-row">
        <div className="settings-row-copy">
          <p className="settings-label">{t('Search SharePoint and OneDrive')}</p>
          <p className="settings-description" data-testid="settings-m365-documents-description">{v?.documentsRefused
            ? t('Your administrator has to approve the permissions Faisselle asks for. Send them the docs, or turn off SharePoint and OneDrive search.')
            : t('Finds documents related to a meeting to prepare briefs, write summaries and answer questions. Needs a work account and wider read permissions, which an administrator usually approves. You sign in again when you turn it on.')}</p>
        </div>
        <button data-testid="settings-m365-documents" role="switch" aria-checked={!!v?.documents} aria-label={t('Search SharePoint and OneDrive')} onClick={() => void window.yogurt.m365.setDocuments(!v?.documents).then(setV)} className="settings-toggle"><span className="settings-toggle-knob" /></button>
      </div>}
      <div className="settings-row">
        <div className="settings-row-copy">
          <button className="settings-description underline" onClick={() => setAdvanced(!advanced)}>{t('Use your organization\'s own app')}</button>
          {advanced && app && <div className="mt-2 flex flex-col gap-2">
            <p className="settings-description">{t('Only if your administrator registered an app for Faisselle. Leave empty otherwise.')}</p>
            <input aria-label={t('Application (client) ID')} placeholder={t('Application (client) ID')} dir="ltr" value={app.clientId} onChange={(e) => setApp({ ...app, clientId: e.target.value })} className="w-full rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-[12px] text-ink" />
            <input aria-label={t('Directory (tenant) ID')} placeholder={t('Directory (tenant) ID')} dir="ltr" value={app.tenantId} onChange={(e) => setApp({ ...app, tenantId: e.target.value })} className="w-full rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-[12px] text-ink" />
            <fieldset className="flex flex-col gap-1" data-testid="settings-m365-method">
              <legend className="settings-description">{t('Sign in with')}</legend>
              {(['code', 'browser'] as const).map((m) => <label key={m} className="flex items-center gap-2 text-[13px] text-ink">
                <input type="radio" name="m365-method" value={m} checked={app.method === m} data-testid={`settings-m365-method-${m}`} onChange={() => setApp({ ...app, method: m })} />
                {m === 'code' ? t("A code on Microsoft's page") : t('The browser (apps without public client flows)')}
              </label>)}
            </fieldset>
            {app.method === 'browser' && <>
              <p className="settings-description">{t("Your app's redirect URI, as in Azure. For the app Claude Code uses: http://localhost:PORT/callback, with its callback port.")}</p>
              <input data-testid="settings-m365-redirect" aria-label={t('Redirect URI')} placeholder={t('Redirect URI')} dir="ltr" value={app.redirectUri} onChange={(e) => setApp({ ...app, redirectUri: e.target.value })} className="w-full rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-[12px] text-ink" />
              <input data-testid="settings-m365-secret" type="password" autoComplete="off" aria-label={t('Client secret, only if that redirect URI is on the Web platform')} placeholder={t('Client secret, only if that redirect URI is on the Web platform')} dir="ltr" value={app.secret} onChange={(e) => setApp({ ...app, secret: e.target.value })} className="w-full rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-[12px] text-ink" />
              {v?.hasSecret && <p className="settings-description">{t('A client secret is saved. Type another to replace it, or leave empty to keep it.')}{' '}
                <button className="underline" data-testid="settings-m365-secret-remove" onClick={() => void window.yogurt.m365.setApp({ clientId: app.clientId, tenantId: app.tenantId, method: app.method, redirectUri: app.redirectUri, secret: '' }).then(setV)}>{t('Remove the secret')}</button></p>}
            </>}
            <div><button className="workspace-button" data-testid="settings-m365-app-save" disabled={app.method === 'browser' && (!app.clientId.trim() || !LOOPBACK.test(app.redirectUri.trim()))}
              onClick={() => void window.yogurt.m365.setApp({ clientId: app.clientId, tenantId: app.tenantId, method: app.method, redirectUri: app.redirectUri, ...(app.secret.trim() ? { secret: app.secret } : {}) })
                .then((x) => { setV(x); setApp({ ...app, secret: '' }) })}>{t('Save')}</button></div>
          </div>}
        </div>
      </div>
    </div></LoadingContent>
  </>
}
