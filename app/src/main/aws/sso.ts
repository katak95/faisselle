import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import type { SsoStatus } from '../../shared/types'

/**
 * Signing in to AWS IAM Identity Center (SSO) from inside Yogurt, for the notes model on Amazon Bedrock.
 * The device flow: Yogurt registers itself as a public client, the browser opens the sign-in page with the code
 * filled in, and Yogurt waits for the token. The token (and the refresh token, when the organisation gives one) is
 * sealed with the system keychain; the role's short-lived keys live in memory only and are fetched again before they run out.
 */

/** Where to sign in: the organisation's start URL (https://xxx.awsapps.com/start) and the region Identity Center lives in */
export type SsoTarget = { startUrl: string; ssoRegion: string }
export type AwsKeys = { accessKeyId: string; secretAccessKey: string; sessionToken: string; /** ms since 1970 */ expiration: number }

export type { SsoStatus }

type Client = { clientId: string; clientSecret: string; /** ms */ expiresAt: number; region: string }
type Token = { accessToken: string; refreshToken?: string; /** ms */ expiresAt: number }
type Saved = { startUrl: string; ssoRegion: string; client: Client; token: Token }

/** what the sign-in needs from AWS: the SDK in the app, a stand-in in tests */
export type SsoApi = {
  register(region: string): Promise<Client>
  startDevice(client: Client, startUrl: string): Promise<{ deviceCode: string; userCode: string; url: string; intervalSec: number; expiresInSec: number }>
  /** throws PendingError while the person hasn't approved yet, SlowDownError when asked to wait longer between tries */
  createToken(client: Client, grant: { deviceCode: string } | { refreshToken: string }): Promise<Token>
  listAccounts(region: string, accessToken: string): Promise<Array<{ id: string; name: string }>>
  listRoles(region: string, accessToken: string, accountId: string): Promise<string[]>
  roleCredentials(region: string, accessToken: string, accountId: string, roleName: string): Promise<AwsKeys>
}
export class PendingError extends Error { name = 'PendingError' }
export class SlowDownError extends Error { name = 'SlowDownError' }
/** not signed in, or signed in somewhere else: the person has to sign in (again) */
export class SignInNeededError extends Error { name = 'SignInNeededError' }

/** keys are fetched again this long before they run out, so a long summary never starts with keys about to expire */
const KEYS_MARGIN_MS = 5 * 60_000
/** the access token is refreshed this long before it runs out */
const TOKEN_MARGIN_MS = 60_000

export const validStartUrl = (u: unknown): u is string => {
  if (typeof u !== 'string' || u.length > 300) return false
  try { const url = new URL(u); return url.protocol === 'https:' && !!url.hostname } catch { return false }
}
export const validRegion = (r: unknown): r is string => typeof r === 'string' && /^[a-z]{2}(-gov)?-[a-z]+-\d$/.test(r)

export function createSso(o: { file: string; api: SsoApi; seal(plain: string): string; open(sealed: string): string
  openExternal(url: string): void; now?: () => number; sleep?: (ms: number) => Promise<void>; onChange?: (s: SsoStatus) => void }) {
  const now = o.now ?? Date.now
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let status: SsoStatus = { state: 'signed-out' }
  let saved: Saved | undefined
  let keys: { account: string; role: string; region: string; value: AwsKeys } | undefined
  let attempt = 0

  const set = (s: SsoStatus) => { status = s; o.onChange?.(s) }
  const read = (): Saved | undefined => {
    try { return existsSync(o.file) ? JSON.parse(o.open(readFileSync(o.file, 'utf8'))) as Saved : undefined } catch (e) { console.warn('the AWS sign-in could not be read', e); return undefined }
  }
  const write = (s: Saved | undefined) => {
    if (!s) { rmSync(o.file, { force: true }); return }
    writeFileSync(o.file + '.tmp', o.seal(JSON.stringify(s)), { mode: 0o600 })
    renameSync(o.file + '.tmp', o.file)
  }
  saved = read()
  if (saved) set(saved.token.expiresAt > now() || saved.token.refreshToken ? { state: 'signed-in', startUrl: saved.startUrl, expiresAt: saved.token.expiresAt } : { state: 'expired', startUrl: saved.startUrl })

  /** a token good for a while yet: refreshed when it can be, else the person signs in again */
  const token = async (): Promise<Saved> => {
    const s = saved
    if (!s) throw new SignInNeededError('Not signed in to AWS')
    if (s.token.expiresAt - TOKEN_MARGIN_MS > now()) return s
    if (s.token.refreshToken && s.client.expiresAt > now()) {
      try {
        const t = await o.api.createToken(s.client, { refreshToken: s.token.refreshToken })
        saved = { ...s, token: { ...t, refreshToken: t.refreshToken ?? s.token.refreshToken } }
        write(saved)
        set({ state: 'signed-in', startUrl: s.startUrl, expiresAt: saved.token.expiresAt })
        return saved
      } catch (e) { console.warn('the AWS sign-in could not be refreshed', e) }
    }
    set({ state: 'expired', startUrl: s.startUrl })
    throw new SignInNeededError('The AWS sign-in ran out')
  }

  return {
    status: (): SsoStatus => status,
    /** where the person signed in last, so Settings can fill the fields in */
    target: (): SsoTarget | undefined => (saved ? { startUrl: saved.startUrl, ssoRegion: saved.ssoRegion } : undefined),
    /**
     * Starts signing in: opens the browser on the approval page and waits there (in the background) until it is
     * approved, refused or runs out. A new sign-in replaces one still waiting.
     */
    async signIn(t: SsoTarget): Promise<SsoStatus> {
      if (!validStartUrl(t.startUrl) || !validRegion(t.ssoRegion)) { set({ state: 'error', message: 'invalid' }); return status }
      const mine = ++attempt
      try {
        // the registration lasts about 90 days: kept for the same region, so refresh tokens stay valid
        const client = saved?.client.region === t.ssoRegion && saved.client.expiresAt > now() + 86_400_000 ? saved.client : await o.api.register(t.ssoRegion)
        const d = await o.api.startDevice(client, t.startUrl)
        set({ state: 'pending', userCode: d.userCode, url: d.url })
        o.openExternal(d.url)
        void (async () => {
          let wait = Math.max(1, d.intervalSec) * 1000
          const until = now() + d.expiresInSec * 1000
          while (mine === attempt && now() < until) {
            await sleep(wait)
            if (mine !== attempt) return
            try {
              const tok = await o.api.createToken(client, { deviceCode: d.deviceCode })
              saved = { startUrl: t.startUrl, ssoRegion: t.ssoRegion, client, token: tok }
              keys = undefined
              write(saved)
              set({ state: 'signed-in', startUrl: t.startUrl, expiresAt: tok.expiresAt })
              return
            } catch (e) {
              if (e instanceof PendingError) continue
              if (e instanceof SlowDownError) { wait += 5000; continue }
              console.warn('AWS sign-in failed', e)
              set({ state: 'error', message: e instanceof Error ? e.message : String(e) })
              return
            }
          }
          if (mine === attempt) set(saved ? { state: 'expired', startUrl: saved.startUrl } : { state: 'error', message: 'timeout' })
        })()
      } catch (e) {
        console.warn('AWS sign-in could not start', e)
        set({ state: 'error', message: e instanceof Error ? e.message : String(e) })
      }
      return status
    },
    /** stops a sign-in still waiting */
    cancel() {
      attempt++
      if (status.state === 'pending') set(saved ? { state: 'signed-in', startUrl: saved.startUrl, expiresAt: saved.token.expiresAt } : { state: 'signed-out' })
    },
    signOut() {
      attempt++
      saved = undefined; keys = undefined
      write(undefined)
      set({ state: 'signed-out' })
    },
    async accounts() { const s = await token(); return o.api.listAccounts(s.ssoRegion, s.token.accessToken) },
    async roles(accountId: string) { const s = await token(); return o.api.listRoles(s.ssoRegion, s.token.accessToken, accountId) },
    /** the role's keys, from memory while they last */
    async credentials(accountId: string, roleName: string): Promise<AwsKeys> {
      const s = await token()
      if (keys && keys.account === accountId && keys.role === roleName && keys.region === s.ssoRegion && keys.value.expiration - KEYS_MARGIN_MS > now()) return keys.value
      const value = await o.api.roleCredentials(s.ssoRegion, s.token.accessToken, accountId, roleName)
      keys = { account: accountId, role: roleName, region: s.ssoRegion, value }
      return value
    },
  }
}
export type Sso = ReturnType<typeof createSso>
