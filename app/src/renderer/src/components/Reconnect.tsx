import { useEffect, useState } from 'react'
import type { AtlassianStatus, M365Status, SsoStatus } from '../../../shared/types'
import { t } from '../../../shared/i18n'

/** a service whose sign-in ran out: it was connected, and needs the person to sign in again */
export type Lost = 'bedrock' | 'm365' | 'atlassian'
export const LOST_ORDER: Lost[] = ['bedrock', 'm365', 'atlassian']

/** a Bedrock API key doesn't run out like the AWS sign-in: only the sign-in counts */
export const lostBedrock = (provider: string, sso: SsoStatus, auth?: string) => provider === 'bedrock' && auth !== 'api-key' && sso.state === 'expired'
export const lostM365 = (s: M365Status) => s.state === 'signed-out' && !!s.expired
/** Atlassian is signed out only after a sign-in (never connected, it is off) */
export const lostAtlassian = (s: AtlassianStatus) => s.state === 'signed-out'

/** where to sign in again: the service's own section in Settings */
export const reconnect = (l: Lost) => window.yogurt.nav.go(`/settings/${l}`)
export const lostName = (l: Lost) => ({ bedrock: t('Amazon Bedrock (Claude)'), m365: t('Microsoft 365'), atlassian: t('Confluence') })[l]

/** the services whose sign-in ran out, kept up to date as each one changes */
export function useLostConnections(): Lost[] {
  const [bedrock, setBedrock] = useState(false)
  const [m365, setM365] = useState(false)
  const [atlassian, setAtlassian] = useState(false)
  useEffect(() => {
    let live = true
    void window.yogurt.cloud.get().then((v) => { if (live) setBedrock(lostBedrock(v.provider, v.sso, v.config.auth)) }).catch(() => {})
    void window.yogurt.m365.get().then((v) => { if (live) setM365(lostM365(v.status)) }).catch(() => {})
    void window.yogurt.atlassian.get().then((v) => { if (live) setAtlassian(lostAtlassian(v.status)) }).catch(() => {})
    const off = [
      window.yogurt.cloud.onChange((v) => setBedrock(lostBedrock(v.provider, v.sso, v.config.auth))),
      window.yogurt.m365.onChange((v) => setM365(lostM365(v.status))),
      window.yogurt.atlassian.onChange((v) => setAtlassian(lostAtlassian(v.status))),
    ]
    return () => { live = false; off.forEach((f) => f()) }
  }, [])
  return LOST_ORDER.filter((l) => ({ bedrock, m365, atlassian })[l])
}

/** Home: one notice for every sign-in that ran out, each with its way back */
export function ReconnectBanner() {
  const lost = useLostConnections()
  if (!lost.length) return null
  return <div data-testid="reconnect-banner" role="status" className="mb-4 flex flex-col gap-2 rounded-xl border border-line px-4 py-3 text-[13px]">
    {lost.map((l) => <div key={l} data-testid={`reconnect-${l}`} className="flex items-center justify-between gap-3">
      <span className="text-ink">{t('Your {service} sign-in ran out.', { service: lostName(l) })}</span>
      <button data-testid={`reconnect-${l}-button`} className="workspace-button shrink-0" onClick={() => reconnect(l)}>{t('Sign in again')}</button>
    </div>)}
  </div>
}
