import { useEffect, useState } from 'react'
import { ChevronDown, Send } from 'lucide-react'
import type { AtlassianView } from '../../../shared/types'
import { t } from '../../../shared/i18n'
import { LoadingContent } from './LoadingContent'

/**
 * Settings → Atlassian: sign in through Atlassian's own page in the browser, then each note can send its report to
 * Confluence, in your personal space under "Meeting notes".
 */
export function AtlassianSettings() {
  const [v, setV] = useState<AtlassianView>()
  useEffect(() => {
    void window.yogurt.atlassian.get().then(setV)
    return window.yogurt.atlassian.onChange(setV)
  }, [])
  const st = v?.status
  return <>
    <h2 className="settings-section-heading">{t('Atlassian')}</h2>
    <LoadingContent pending={!v}><div data-testid="settings-atlassian" className="settings-group">
      <div className="settings-row">
        <span className="settings-permission-icon"><Send size={17} strokeWidth={1.75} aria-hidden="true" /></span>
        <div className="settings-row-copy">
          <p className="settings-label">{t('Confluence')}</p>
          <p className="settings-description" aria-live="polite" data-testid="settings-atlassian-status">{
            st?.state === 'connected' ? t('Connected to {site}{account}. Reports go to your personal space, under "Meeting notes".', { site: st.site, account: st.account ? ` · ${st.account}` : '' })
            : st?.state === 'pending' ? t('Finish signing in on the Atlassian page in your browser.')
            : st?.state === 'starting' ? t('Connecting…')
            : st?.state === 'error' && st.admin ? t("Your Atlassian administrator has to allow Atlassian's MCP server (Rovo) for your site.")
            : st?.state === 'error' ? t("Atlassian didn't connect. Try again.")
            : st?.state === 'signed-out' ? t('The sign-in ran out. Connect again.')
            : t('Send a meeting report to Confluence, in your personal space. You sign in with your Atlassian account.')}</p>
          {st?.state === 'connected' && v?.space?.url && <a className="settings-description underline" href={v.space.url} target="_blank" rel="noreferrer">{t('Open your space')}</a>}
        </div>
        {st?.state === 'connected'
          ? <button data-testid="settings-atlassian-sign-out" className="workspace-button settings-action" onClick={() => void window.yogurt.atlassian.signOut().then(setV)}>{t('Disconnect')}</button>
          : st?.state === 'pending' || st?.state === 'starting'
          ? <button className="workspace-button settings-action" onClick={() => void window.yogurt.atlassian.cancel().then(setV)}>{t('Cancel')}</button>
          : <button data-testid="settings-atlassian-connect" className="workspace-button settings-action" onClick={() => void window.yogurt.atlassian.signIn().then(setV)}>{t('Connect')}</button>}
      </div>
      {st?.state === 'connected' && st.sites.length > 1 && <div className="settings-row">
        <div className="settings-row-copy"><label htmlFor="settings-atlassian-site" className="settings-label">{t('Site')}</label></div>
        <span className="settings-select-wrap">
          <select id="settings-atlassian-site" data-testid="settings-atlassian-site" value={v!.siteId} onChange={(e) => void window.yogurt.atlassian.setSite(e.target.value).then(setV)} className="settings-select">
            {st.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <ChevronDown size={14} aria-hidden="true" />
        </span>
      </div>}
    </div></LoadingContent>
  </>
}
