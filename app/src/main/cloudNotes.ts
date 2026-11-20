import { ipcMain } from 'electron'
import { loadSettings, notesProviderSetting, updateSettings, type Settings } from './settings'
import { validRegion, validStartUrl, type Sso, type SsoStatus } from './aws/sso'
import { BEDROCK_DEFAULTS, validAccountId, validModelId, validRoleName, type BedrockConfig } from './notes/bedrock'
import { isProvider, type NotesProvider } from './notes/provider'
import type { CloudNotesView } from '../shared/types'

type Saved = NonNullable<Settings['bedrock']>

/** Bedrock's settings with the defaults filled in */
export const bedrockSettings = (s: Settings): Required<Saved> => ({
  startUrl: s.bedrock?.startUrl ?? '', ssoRegion: s.bedrock?.ssoRegion ?? BEDROCK_DEFAULTS.region,
  accountId: s.bedrock?.accountId ?? '', roleName: s.bedrock?.roleName ?? '',
  region: s.bedrock?.region ?? BEDROCK_DEFAULTS.region, modelId: s.bedrock?.modelId ?? BEDROCK_DEFAULTS.modelId,
})

/** what a Bedrock request needs, once the person signed in and chose an account and role */
export function bedrockConfig(s: Settings, sso: Pick<Sso, 'status'>): BedrockConfig | undefined {
  const b = bedrockSettings(s)
  if (sso.status().state !== 'signed-in' || !b.accountId || !b.roleName) return undefined
  return { region: b.region, modelId: b.modelId, accountId: b.accountId, roleName: b.roleName }
}

/**
 * Settings → Notes model: this computer or Amazon Bedrock, and signing in to AWS. `changed` runs when notes can
 * be written again (signed in, or switched): jobs waiting in the queue go on.
 */
export function hookCloud(d: { file: string; sso: Sso; canRunLocally(): boolean; changed(provider: NotesProvider): void
  send(v: CloudNotesView): void
  /** a short request to the model, to check the account, role and model work together */
  test(): Promise<void> }) {
  const view = (): CloudNotesView => {
    const s = loadSettings(d.file)
    return { provider: notesProviderSetting(s), canRunLocally: d.canRunLocally(), sso: d.sso.status(), config: bedrockSettings(s), ready: !!bedrockConfig(s, d.sso) }
  }
  const save = (patch: Partial<Saved>) => {
    const s = loadSettings(d.file)
    updateSettings(d.file, { bedrock: { ...s.bedrock, ...patch } })
  }
  let last: SsoStatus['state'] | undefined
  const statusChanged = () => {
    const v = view()
    d.send(v)
    if (v.sso.state === 'signed-in' && last !== 'signed-in' && v.provider === 'bedrock') d.changed('bedrock')
    last = v.sso.state
  }

  ipcMain.handle('cloud:get', () => view())
  ipcMain.handle('cloud:provider', (_e, v: unknown) => {
    if (!isProvider(v)) return view()
    updateSettings(d.file, { notesProvider: v === 'bedrock' ? 'bedrock' : undefined })
    d.changed(v)
    const out = view(); d.send(out); return out
  })
  // each field checked on its own: a bad one is left as it was
  ipcMain.handle('cloud:config', (_e, v: unknown) => {
    const p = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
    const patch: Partial<Saved> = {}
    if (p.startUrl !== undefined && (p.startUrl === '' || validStartUrl(p.startUrl))) patch.startUrl = (p.startUrl as string) || undefined
    if (p.ssoRegion !== undefined && validRegion(p.ssoRegion)) patch.ssoRegion = p.ssoRegion
    if (p.region !== undefined && validRegion(p.region)) patch.region = p.region
    if (p.modelId !== undefined && validModelId(p.modelId)) patch.modelId = p.modelId
    if (p.accountId !== undefined && (p.accountId === '' || validAccountId(p.accountId))) patch.accountId = (p.accountId as string) || undefined
    if (p.roleName !== undefined && (p.roleName === '' || validRoleName(p.roleName))) patch.roleName = (p.roleName as string) || undefined
    // another account: its role is chosen again
    if (patch.accountId !== undefined && patch.accountId !== bedrockSettings(loadSettings(d.file)).accountId && p.roleName === undefined) patch.roleName = undefined
    save(patch)
    const out = view(); d.send(out)
    if (out.ready && out.provider === 'bedrock') d.changed('bedrock')
    return out
  })
  ipcMain.handle('cloud:sign-in', async () => {
    const b = bedrockSettings(loadSettings(d.file))
    await d.sso.signIn({ startUrl: b.startUrl, ssoRegion: b.ssoRegion })
    return view()
  })
  ipcMain.handle('cloud:cancel', () => { d.sso.cancel(); return view() })
  ipcMain.handle('cloud:sign-out', () => { d.sso.signOut(); return view() })
  ipcMain.handle('cloud:accounts', () => d.sso.accounts())
  ipcMain.handle('cloud:roles', (_e, accountId: unknown) => (validAccountId(accountId) ? d.sso.roles(accountId) : []))
  ipcMain.handle('cloud:test', async () => {
    try { await d.test(); return { ok: true as const } } catch (e) { return { ok: false as const, message: e instanceof Error ? e.message : String(e) } }
  })
  return { statusChanged, view }
}
