import { useEffect, useState } from 'react'
import { Mail } from 'lucide-react'
import type { M365View } from '../../../shared/types'
import { t } from '../../../shared/i18n'
import { LoadingContent } from './LoadingContent'

/**
 * Settings → Microsoft 365, read only: the Outlook calendar in Figolu, and the invite and recent emails with the
 * people in a meeting to prepare briefs and write summaries. Signing in is Microsoft's code page.
 */
export function M365Settings() {
  const [v, setV] = useState<M365View>()
  const [app, setApp] = useState<{ clientId: string; tenantId: string }>()
  const [advanced, setAdvanced] = useState(false)
  useEffect(() => {
    void window.yogurt.m365.get().then((x) => { setV(x); setApp({ clientId: x.clientId, tenantId: x.tenantId }) })
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
            st?.state === 'connected' ? t('Connected{account}. Figolu only reads: it never sends, changes or deletes anything.', { account: st.account ? ` · ${st.account}` : '' })
            : st?.state === 'pending' ? t('On the Microsoft page, enter the code {code}', { code: st.code })
            : st?.state === 'starting' ? t('Connecting…')
            : st?.state === 'error' && st.consent ? t('Your administrator has to approve the permissions Figolu asks for. Send them the docs, or turn off SharePoint and OneDrive search.')
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
            ? t('Your administrator has to approve the permissions Figolu asks for. Send them the docs, or turn off SharePoint and OneDrive search.')
            : t('Finds documents related to a meeting to prepare briefs, write summaries and answer questions. Needs a work account and wider read permissions, which an administrator usually approves. You sign in again when you turn it on.')}</p>
        </div>
        <button data-testid="settings-m365-documents" role="switch" aria-checked={!!v?.documents} aria-label={t('Search SharePoint and OneDrive')} onClick={() => void window.yogurt.m365.setDocuments(!v?.documents).then(setV)} className="settings-toggle"><span className="settings-toggle-knob" /></button>
      </div>}
      <div className="settings-row">
        <div className="settings-row-copy">
          <button className="settings-description underline" onClick={() => setAdvanced(!advanced)}>{t('Use your organization\'s own app')}</button>
          {advanced && app && <div className="mt-2 flex flex-col gap-2">
            <p className="settings-description">{t('Only if your administrator registered an app for Figolu. Leave empty otherwise.')}</p>
            <input aria-label={t('Application (client) ID')} placeholder={t('Application (client) ID')} dir="ltr" value={app.clientId} onChange={(e) => setApp({ ...app, clientId: e.target.value })} className="w-full rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-[12px] text-ink" />
            <input aria-label={t('Directory (tenant) ID')} placeholder={t('Directory (tenant) ID')} dir="ltr" value={app.tenantId} onChange={(e) => setApp({ ...app, tenantId: e.target.value })} className="w-full rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-[12px] text-ink" />
            <div><button className="workspace-button" onClick={() => void window.yogurt.m365.setApp(app.clientId, app.tenantId).then(setV)}>{t('Save')}</button></div>
          </div>}
        </div>
      </div>
    </div></LoadingContent>
  </>
}
