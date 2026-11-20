import { ipcMain } from 'electron'
import { loadSettings, updateSettings } from '../settings'
import type { M365 } from './client'
import type { M365View } from '../../shared/types'

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const validTenant = (v: string) => v === '' || GUID.test(v) || /^(common|organizations|consumers)$/.test(v) || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(v)

/** Settings → Microsoft 365: connect (device code), the Outlook calendar on or off, and an organisation's own Azure app */
export function hookM365(d: { file: string; m365: M365; send(v: M365View): void; calendarChanged(): void; restart(): void
  /** the server starts again in the other mode, and the person signs in again so Microsoft asks for the new permissions */
  documentsChanged(on: boolean): Promise<void> }) {
  const view = (): M365View => {
    const s = loadSettings(d.file).m365
    return { status: d.m365.status(), calendar: s?.calendar !== false, clientId: s?.clientId ?? '', tenantId: s?.tenantId ?? '', documents: s?.documents === true, documentsRefused: d.m365.documentsRefused() }
  }
  const patch = (p: NonNullable<ReturnType<typeof loadSettings>['m365']>) => updateSettings(d.file, { m365: { ...loadSettings(d.file).m365, ...p } })
  ipcMain.handle('m365:get', () => view())
  ipcMain.handle('m365:sign-in', () => { patch({ enabled: true }); void d.m365.signIn(); return view() })
  ipcMain.handle('m365:cancel', () => { d.m365.cancel(); return view() })
  ipcMain.handle('m365:sign-out', async () => { patch({ enabled: undefined }); await d.m365.signOut(); d.calendarChanged(); return view() })
  ipcMain.handle('m365:calendar', (_e, on: unknown) => {
    if (typeof on !== 'boolean') return view()
    patch({ calendar: on ? undefined : false }); d.calendarChanged()
    return view()
  })
  // an organisation that needs its own app registration: the server starts again with it
  ipcMain.handle('m365:app', (_e, clientId: unknown, tenantId: unknown) => {
    if (typeof clientId !== 'string' || typeof tenantId !== 'string') return view()
    const c = clientId.trim(), t = tenantId.trim()
    if ((c && !GUID.test(c)) || !validTenant(t)) return view()
    patch({ clientId: c || undefined, tenantId: t || undefined })
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
