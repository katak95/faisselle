import type { Settings } from './settings'
import { validRegion, validStartUrl } from './aws/sso'
import { validModelId } from './notes/bedrock'
import { GUID, validTenant } from './m365/ipc'
import { DEFAULT_REDIRECT, parseRedirect } from './m365/oauth'
import { cleanJargon } from '../shared/jargon'
import type { ShareChange, ShareSection, SharePreview } from '../shared/types'

/**
 * Faisselle's models and connectors as a file another person imports (Settings → Share the setup): where the notes
 * are written and how Bedrock is reached, the Microsoft 365 app, the Confluence site, and the custom vocabulary.
 * Never a secret or a sign-in: no AWS token, account or role, no Microsoft client secret or token, no Atlassian
 * sign-in or personal space. The person who imports it signs in with their own accounts.
 *
 * A file is checked field by field with the same rules as Settings; a field that isn't valid is left out, so a
 * hand-edited file can't put anything in the settings that Settings itself wouldn't take.
 */

export const SHARE_KIND = 'faisselle-setup'
export const SHARE_VERSION = 1

export type SharedSetup = {
  kind: typeof SHARE_KIND
  version: number
  exportedAt: string
  appVersion: string
  notes?: { provider: 'local' | 'bedrock'; startUrl?: string; ssoRegion?: string; region?: string; modelId?: string }
  m365?: { clientId?: string; tenantId?: string; method: 'code' | 'browser'; redirectUri?: string; calendar: boolean; documents: boolean }
  confluence?: { siteId: string; siteName?: string; siteUrl?: string }
  vocabulary?: string[]
}

/** the setup on this computer, as a file to share; site: the Confluence site in use, when connected */
export function buildShare(s: Settings, o: { appVersion: string; now?: Date; site?: { id: string; name: string; url: string } }): SharedSetup {
  const b = s.bedrock ?? {}, m = s.m365
  const out: SharedSetup = { kind: SHARE_KIND, version: SHARE_VERSION, exportedAt: (o.now ?? new Date()).toISOString(), appVersion: o.appVersion,
    notes: { provider: s.notesProvider === 'bedrock' ? 'bedrock' : 'local',
      ...(b.startUrl ? { startUrl: b.startUrl } : {}), ...(b.ssoRegion ? { ssoRegion: b.ssoRegion } : {}),
      ...(b.region ? { region: b.region } : {}), ...(b.modelId ? { modelId: b.modelId } : {}) } }
  if (m && (m.enabled || m.clientId || m.method))
    out.m365 = { ...(m.clientId ? { clientId: m.clientId } : {}), ...(m.tenantId ? { tenantId: m.tenantId } : {}), method: m.method === 'browser' ? 'browser' : 'code',
      ...(m.method === 'browser' ? { redirectUri: m.redirectUri ?? DEFAULT_REDIRECT } : {}), calendar: m.calendar !== false, documents: m.documents === true }
  const siteId = o.site?.id ?? s.atlassian?.siteId
  if (siteId && s.atlassian?.enabled !== false) out.confluence = { siteId, ...(o.site ? { siteName: o.site.name, siteUrl: o.site.url } : {}) }
  const words = cleanJargon(s.jargon)
  if (words.length) out.vocabulary = words
  return out
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, max = 300) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : undefined)
const SITE_URL = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.(atlassian\.net|jira\.com|atlassian\.com)\/?$/i

/** a file's text as a setup: only what passes Settings' own checks; invalid when it isn't a Faisselle setup at all */
export function parseShare(raw: string): { ok: true; setup: SharedSetup } | { ok: false; error: 'invalid' | 'newer' } {
  let v: unknown
  try { v = JSON.parse(raw) } catch { return { ok: false, error: 'invalid' } }
  if (!isObj(v) || v.kind !== SHARE_KIND || typeof v.version !== 'number') return { ok: false, error: 'invalid' }
  if (v.version > SHARE_VERSION) return { ok: false, error: 'newer' }
  const setup: SharedSetup = { kind: SHARE_KIND, version: v.version, exportedAt: text(v.exportedAt, 40) ?? '', appVersion: text(v.appVersion, 40) ?? '' }
  if (isObj(v.notes)) {
    const n = v.notes
    setup.notes = { provider: n.provider === 'bedrock' ? 'bedrock' : 'local',
      ...(validStartUrl(n.startUrl) ? { startUrl: n.startUrl } : {}), ...(validRegion(n.ssoRegion) ? { ssoRegion: n.ssoRegion } : {}),
      ...(validRegion(n.region) ? { region: n.region } : {}), ...(validModelId(n.modelId) ? { modelId: n.modelId } : {}) }
  }
  if (isObj(v.m365)) {
    const m = v.m365
    const clientId = typeof m.clientId === 'string' && GUID.test(m.clientId.trim()) ? m.clientId.trim() : undefined
    const tenantId = typeof m.tenantId === 'string' && m.tenantId.trim() && validTenant(m.tenantId.trim()) ? m.tenantId.trim() : undefined
    const redirectUri = typeof m.redirectUri === 'string' && parseRedirect(m.redirectUri) ? m.redirectUri.trim() : undefined
    // the browser sign-in needs the organisation's app and a loopback redirect URI: without them, the code
    const browser = m.method === 'browser' && !!clientId && !!redirectUri
    setup.m365 = { ...(clientId ? { clientId } : {}), ...(tenantId ? { tenantId } : {}), method: browser ? 'browser' : 'code', ...(browser ? { redirectUri } : {}),
      calendar: m.calendar !== false, documents: m.documents === true }
  }
  if (isObj(v.confluence) && typeof v.confluence.siteId === 'string' && /^[\w-]{1,100}$/.test(v.confluence.siteId)) {
    const c = v.confluence
    setup.confluence = { siteId: c.siteId as string, ...(text(c.siteName, 200) ? { siteName: text(c.siteName, 200) } : {}),
      ...(typeof c.siteUrl === 'string' && SITE_URL.test(c.siteUrl) ? { siteUrl: c.siteUrl } : {}) }
  }
  const words = cleanJargon(v.vocabulary)
  if (words.length) setup.vocabulary = words
  return { ok: true, setup }
}

const onOff = (b: boolean) => (b ? 'on' : 'off')
const change = (section: ShareSection, field: string, from: string | undefined, to: string | undefined): ShareChange[] =>
  (from ?? '') === (to ?? '') ? [] : [{ section, field, from: from ?? '', to: to ?? '' }]

/** what importing each section would change here, field by field (sections that change nothing are left out) */
export function previewShare(s: Settings, setup: SharedSetup): SharePreview[] {
  const out: SharePreview[] = []
  if (setup.notes) {
    const n = setup.notes, b = s.bedrock ?? {}
    const changes = [
      ...change('notes', 'provider', s.notesProvider === 'bedrock' ? 'bedrock' : 'local', n.provider),
      ...(n.startUrl ? change('notes', 'startUrl', b.startUrl, n.startUrl) : []),
      ...(n.ssoRegion ? change('notes', 'ssoRegion', b.ssoRegion, n.ssoRegion) : []),
      ...(n.region ? change('notes', 'region', b.region, n.region) : []),
      ...(n.modelId ? change('notes', 'modelId', b.modelId, n.modelId) : []),
    ]
    if (changes.length) out.push({ section: 'notes', changes })
  }
  if (setup.m365) {
    const m = setup.m365, here = s.m365 ?? {}
    const changes = [
      ...change('m365', 'clientId', here.clientId, m.clientId), ...change('m365', 'tenantId', here.tenantId, m.tenantId),
      ...change('m365', 'method', here.method === 'browser' ? 'browser' : 'code', m.method),
      ...(m.method === 'browser' ? change('m365', 'redirectUri', here.method === 'browser' ? here.redirectUri ?? DEFAULT_REDIRECT : undefined, m.redirectUri) : []),
      ...change('m365', 'calendar', onOff(here.calendar !== false), onOff(m.calendar)), ...change('m365', 'documents', onOff(here.documents === true), onOff(m.documents)),
    ]
    if (changes.length) out.push({ section: 'm365', changes })
  }
  if (setup.confluence) {
    const changes = change('confluence', 'site', s.atlassian?.siteId, setup.confluence.siteId)
      .map((c) => ({ ...c, to: setup.confluence!.siteName ?? setup.confluence!.siteUrl ?? c.to }))
    if (changes.length) out.push({ section: 'confluence', changes })
  }
  if (setup.vocabulary) {
    const here = new Set(cleanJargon(s.jargon).map((w) => w.toLowerCase()))
    const added = setup.vocabulary.filter((w) => !here.has(w.toLowerCase()))
    if (added.length) out.push({ section: 'vocabulary', changes: [{ section: 'vocabulary', field: 'words', from: '', to: added.join(', ') }] })
  }
  return out
}

/**
 * The settings to write for the sections the person kept. The vocabulary is added to (never replaced); Microsoft 365
 * and Bedrock keep this person's own sign-ins, account and role.
 */
export function applyShare(s: Settings, setup: SharedSetup, sections: ShareSection[]): Partial<Settings> {
  const patch: Partial<Settings> = {}
  const want = new Set(sections)
  if (want.has('notes') && setup.notes) {
    const n = setup.notes
    patch.notesProvider = n.provider === 'bedrock' ? 'bedrock' : undefined
    patch.bedrock = { ...s.bedrock, ...(n.startUrl ? { startUrl: n.startUrl } : {}), ...(n.ssoRegion ? { ssoRegion: n.ssoRegion } : {}),
      ...(n.region ? { region: n.region } : {}), ...(n.modelId ? { modelId: n.modelId } : {}) }
  }
  if (want.has('m365') && setup.m365) {
    const m = setup.m365
    patch.m365 = { ...s.m365, clientId: m.clientId, tenantId: m.tenantId, method: m.method === 'browser' ? 'browser' : undefined,
      redirectUri: m.method === 'browser' && m.redirectUri !== DEFAULT_REDIRECT ? m.redirectUri : undefined,
      calendar: m.calendar ? undefined : false, documents: m.documents || undefined }
  }
  if (want.has('confluence') && setup.confluence) patch.atlassian = { ...s.atlassian, siteId: setup.confluence.siteId }
  if (want.has('vocabulary') && setup.vocabulary) {
    const here = cleanJargon(s.jargon), seen = new Set(here.map((w) => w.toLowerCase()))
    patch.jargon = cleanJargon([...here, ...setup.vocabulary.filter((w) => !seen.has(w.toLowerCase()))])
  }
  return patch
}
