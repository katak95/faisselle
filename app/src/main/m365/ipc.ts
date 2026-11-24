import { ipcMain } from 'electron'
import { loadSettings, updateSettings } from '../settings'
import type { M365 } from './client'
import type { M365View } from '../../shared/types'
import { DEFAULT_REDIRECT, parseRedirect, type TokenStore } from './oauth'

export const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const validTenant = (v: string) => v === '' || GUID.test(v) || /^(common|organizations|consumers)$/.test(v) || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(v)

/** Settings → Microsoft 365: connect (device code), the Outlook calendar on or off, and an organisation's own Azure app */
export function hookM365(d: { file: string; m365: M365; /** the browser sign-in's tokens and secret */ store: TokenStore; send(v: M365View): void; calendarChanged(): void; restart(): void
  /** the server starts again in the other mode, and the person signs in again so Microsoft asks for the new permissions */
  documentsChanged(on: boolean): Promise<void> }) {
  const view = (): M365View => {
    const s = loadSettings(d.file).m365
    return { status: d.m365.status(), calendar: s?.calendar !== false, clientId: s?.clientId ?? '', tenantId: s?.tenantId ?? '', documents: s?.documents === true, documentsRefused: d.m365.documentsRefused(),
      method: s?.method === 'browser' ? 'browser' : 'code', redirectUri: s?.redirectUri ?? DEFAULT_REDIRECT, hasSecret: !!d.store.secret() }
  }
  const patch = (p: NonNullable<ReturnType<typeof loadSettings>['m365']>) => updateSettings(d.file, { m365: { ...loadSettings(d.file).m365, ...p } })
  ipcMain.handle('m365:get', () => view())
  ipcMain.handle('m365:sign-in', () => { patch(loadSettings(d.file).m365?.enabled ? { enabled: true } : { enabled: true, connectedOnce: false }); void d.m365.signIn(); return view() })
  ipcMain.handle('m365:cancel', () => { d.m365.cancel(); return view() })
  ipcMain.handle('m365:sign-out', async () => { patch({ enabled: undefined, connectedOnce: undefined }); await d.m365.signOut(); d.calendarChanged(); return view() })
  ipcMain.handle('m365:calendar', (_e, on: unknown) => {
    if (typeof on !== 'boolean') return view()
    patch({ calendar: on ? undefined : false }); d.calendarChanged()
    return view()
  })
  // an organisation that needs its own app registration: the server starts again with it. The browser sign-in needs
  // that app (Faisselle's default app only does the device code), on a loopback redirect URI the app has.
  ipcMain.handle('m365:app', (_e, a: unknown) => {
    if (!a || typeof a !== 'object') return view()
    const { clientId, tenantId, method, redirectUri, secret } = a as Record<string, unknown>
    if (typeof clientId !== 'string' || typeof tenantId !== 'string' || (method !== 'code' && method !== 'browser') || typeof redirectUri !== 'string' || (secret !== undefined && typeof secret !== 'string')) return view()
    const c = clientId.trim(), t = tenantId.trim(), uri = redirectUri.trim()
    if ((c && !GUID.test(c)) || !validTenant(t)) return view()
    if (method === 'browser' && (!c || !parseRedirect(uri))) return view()
    const before = loadSettings(d.file).m365
    const browserChanged = (before?.method === 'browser') !== (method === 'browser') || before?.clientId !== (c || undefined) || before?.tenantId !== (t || undefined)
    patch({ clientId: c || undefined, tenantId: t || undefined, method: method === 'browser' ? 'browser' : undefined, redirectUri: method === 'browser' && uri !== DEFAULT_REDIRECT ? uri : undefined })
    if (typeof secret === 'string') d.store.setSecret(secret.trim() || undefined)
    // tokens from another app or tenant are no use: sign in again
    if (browserChanged) d.store.setTokens(undefined)
    d.restart()
    return view()
  })
  ipcMain.handle('m365:documents', async (_e, on: unknown) => {
    if (typeof on !== 'boolean' || on === (loadSettings(d.file).m365?.documents === true)) return view()
    patch({ documents: on || undefined })
    await d.documentsChanged(on)
    return view()
  })
  return { view, push: () => d.send(view()) }
}
