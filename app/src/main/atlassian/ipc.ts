import { ipcMain } from 'electron'
import { loadSettings, updateSettings } from '../settings'
import type { Store } from '../store'
import type { AtlassianView } from '../../shared/types'
import { t } from '../../shared/i18n'
import { isId } from '../ipcArgs'
import type { Atlassian } from './client'
import { PublishError, publishReport, type ReportLabels } from './publish'

export type SendResult = { status: 'sent' | 'updated'; url: string } | { status: 'failed'; message: string; kind: PublishError['kind'] | 'not-connected' | 'no-summary' }

/** the page's words, in the interface's language */
const labels = (): ReportLabels => ({
  date: t('Date'), length: t('Length'), people: t('People'), actions: t('Action items'),
  footer: t('Written with Yogurt'), minutes: (n) => t('{n} min', { n }),
})

/** Settings → Atlassian, and a note's Send to Confluence */
export function hookAtlassian(d: { file: string; atlassian: Atlassian; store: Pick<Store, 'meeting' | 'notes' | 'extras' | 'setExtras'>; send(v: AtlassianView): void; changed(meetingId: string): void }) {
  const settings = () => loadSettings(d.file).atlassian ?? {}
  const patch = (p: Partial<NonNullable<ReturnType<typeof settings>>>) => updateSettings(d.file, { atlassian: { ...settings(), ...p } })
  const view = (): AtlassianView => {
    const s = settings(), st = d.atlassian.status()
    const siteId = s.siteId ?? (st.state === 'connected' ? st.sites[0]?.id ?? '' : '')
    const place = s.places?.[siteId]
    return { status: st, siteId, space: place ? { key: place.spaceKey ?? '', ...(place.spaceUrl ? { url: place.spaceUrl } : {}) } : null }
  }
  const sending = new Set<string>()

  ipcMain.handle('atlassian:get', () => view())
  ipcMain.handle('atlassian:sign-in', () => { patch({ enabled: true }); void d.atlassian.signIn(); return view() })
  ipcMain.handle('atlassian:cancel', () => { d.atlassian.cancel(); return view() })
  ipcMain.handle('atlassian:sign-out', async () => { patch({ enabled: undefined }); await d.atlassian.signOut(); return view() })
  ipcMain.handle('atlassian:site', (_e, id: unknown) => {
    const st = d.atlassian.status()
    if (typeof id !== 'string' || st.state !== 'connected' || !st.sites.some((s) => s.id === id)) return view()
    patch({ siteId: id }); d.atlassian.siteChanged()
    return view()
  })
  ipcMain.handle('share:confluence', async (_e, id: unknown): Promise<SendResult> => {
    if (!isId(id) || !d.store.meeting(id)) return { status: 'failed', message: 'No such meeting', kind: 'other' }
    if (!d.atlassian.connected()) return { status: 'failed', message: 'Not connected to Atlassian', kind: 'not-connected' }
    const summary = d.store.notes(id).enhanced
    if (!summary?.trim()) return { status: 'failed', message: 'No summary yet', kind: 'no-summary' }
    if (sending.has(id)) return { status: 'failed', message: 'Already sending', kind: 'other' }
    sending.add(id)
    try {
      const { box, site, accountId } = d.atlassian.current()
      const place = settings().places?.[site.id]
      const extras = d.store.extras(id)
      const send = (parentId: string | undefined) => publishReport(box, { meeting: d.store.meeting(id)!, summary, actions: extras.actions ?? [], labels: labels() },
        { cloudId: site.id, siteUrl: site.url, ...(accountId ? { accountId } : {}), ...(place ? { spaceId: place.spaceId, spaceKey: place.spaceKey, parentId } : {}) },
        extras.confluence ? { pageId: extras.confluence.pageId } : undefined)
      // "Meeting notes" deleted in Confluence since last time: found or made again, once
      const r = await send(place?.parentId).catch((e) => {
        if (!place?.parentId || e instanceof PublishError || !/parent|ancestor|not found|404/i.test(String(e))) throw e
        return send(undefined)
      })
      // the space and "Meeting notes" found once are kept for this site, so the next report goes straight there
      patch({ places: { ...settings().places, [site.id]: { spaceId: r.spaceId, ...(r.spaceKey ? { spaceKey: r.spaceKey, spaceUrl: `${site.url.replace(/\/$/, '')}/wiki/spaces/${encodeURIComponent(r.spaceKey)}` } : {}), parentId: r.parentId } } })
      d.store.setExtras(id, { confluence: { pageId: r.pageId, url: r.url, at: Date.now() } })
      d.changed(id)
      d.send(view())
      return { status: r.created ? 'sent' : 'updated', url: r.url }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.warn('sending to Confluence failed', message)
      return { status: 'failed', message, kind: e instanceof PublishError ? e.kind : 'other' }
    } finally { sending.delete(id) }
  })
  return { view, push: () => d.send(view()) }
}
