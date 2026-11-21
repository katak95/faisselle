import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'

/**
 * Microsoft 365 signed in with the browser: OAuth 2.0 authorization code with PKCE, on the redirect URI an existing
 * Azure app already has (for example the one Claude Code uses: http://localhost:PORT/callback). For organisations whose
 * app doesn't allow the device code ("Allow public client flows" off). Faisselle then hands the access token to the
 * Softeria server (MS365_MCP_OAUTH_TOKEN) and refreshes it itself.
 */

/** what the app already has consent for (calendar, mail, documents when granted), and a refresh token */
export const SCOPES = 'https://graph.microsoft.com/.default offline_access openid profile'
export const DEFAULT_REDIRECT = 'http://localhost:33419/callback'

export type Tokens = { access: string; refresh?: string; expiresAt: number }
export type AppConfig = { clientId: string; tenantId?: string; redirectUri: string; secret?: string }

/** only a loopback address with its port, as Azure registers it: http://localhost:PORT/path */
export function parseRedirect(uri: string): { port: number; path: string } | null {
  let u: URL
  try { u = new URL(uri.trim()) } catch { return null }
  if (u.protocol !== 'http:' || !/^(localhost|127\.0\.0\.1)$/.test(u.hostname) || !u.port || u.search || u.hash) return null
  const port = Number(u.port)
  return port > 0 && port < 65536 ? { port, path: u.pathname || '/' } : null
}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export function pkce() {
  const verifier = b64url(randomBytes(32))
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()), state: b64url(randomBytes(16)) }
}

const authority = (tenant?: string) => `https://login.microsoftonline.com/${encodeURIComponent(tenant?.trim() || 'organizations')}/oauth2/v2.0`

export function authorizeUrl(c: AppConfig, p: { challenge: string; state: string }): string {
  const q = new URLSearchParams({ client_id: c.clientId, response_type: 'code', redirect_uri: c.redirectUri, response_mode: 'query',
    scope: SCOPES, state: p.state, code_challenge: p.challenge, code_challenge_method: 'S256', prompt: 'select_account' })
  return `${authority(c.tenantId)}/authorize?${q}`
}

/**
 * What went wrong, for Settings: the app wants its secret (its redirect URI is on the "Web" platform), the secret is
 * wrong, the app takes no secret, the redirect URI isn't the app's, or the sign-in ran out (signed out).
 */
export type AuthProblem = 'secret-needed' | 'secret-wrong' | 'secret-not-allowed' | 'redirect-mismatch' | 'expired' | 'port-busy'
export class M365AuthError extends Error {
  constructor(message: string, readonly problem?: AuthProblem) { super(message) }
}
export function problemOf(error: string, description: string): AuthProblem | undefined {
  if (/AADSTS7000218/.test(description)) return 'secret-needed'
  if (/AADSTS7000215|AADSTS7000222/.test(description)) return 'secret-wrong'
  if (/AADSTS700025/.test(description)) return 'secret-not-allowed'
  if (/AADSTS50011|AADSTS500113/.test(description)) return 'redirect-mismatch'
  if (error === 'invalid_grant') return 'expired'
  return undefined
}

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

/** the token endpoint: a code (with its verifier) or a refresh token for new tokens */
export async function tokenRequest(c: AppConfig, grant: { code: string; verifier: string } | { refresh: string }, fetchImpl: Fetch = fetch as unknown as Fetch, now = Date.now): Promise<Tokens> {
  const body = new URLSearchParams({ client_id: c.clientId, scope: SCOPES, redirect_uri: c.redirectUri,
    ...('code' in grant ? { grant_type: 'authorization_code', code: grant.code, code_verifier: grant.verifier } : { grant_type: 'refresh_token', refresh_token: grant.refresh }),
    ...(c.secret ? { client_secret: c.secret } : {}) })
  const res = await fetchImpl(`${authority(c.tenantId)}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() })
  const v = await res.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string }
  if (!res.ok || !v.access_token) {
    const description = v.error_description ?? `HTTP ${res.status}`
    throw new M365AuthError(`${v.error ?? 'token_error'}: ${description.split('\n')[0]}`, problemOf(v.error ?? '', description))
  }
  return { access: v.access_token, refresh: v.refresh_token ?? ('refresh' in grant ? grant.refresh : undefined), expiresAt: now() + (v.expires_in ?? 3600) * 1000 }
}

/** the tokens and the app's secret, sealed with the system keychain in one file */
type Saved = { tokens?: Tokens; secret?: string }
export function createTokenStore(o: { file: string; seal(plain: string): string; open(sealed: string): string }) {
  let saved: Saved = {}
  try { if (existsSync(o.file)) saved = JSON.parse(o.open(readFileSync(o.file, 'utf8'))) as Saved } catch (e) { console.warn('the Microsoft 365 sign-in could not be read', e) }
  const write = () => {
    if (!saved.tokens && !saved.secret) { rmSync(o.file, { force: true }); return }
    writeFileSync(o.file + '.tmp', o.seal(JSON.stringify(saved)), { mode: 0o600 })
    renameSync(o.file + '.tmp', o.file)
  }
  return {
    tokens: () => saved.tokens,
    setTokens(tokens: Tokens | undefined) { saved = { ...saved, tokens }; write() },
    secret: () => saved.secret,
    setSecret(secret: string | undefined) { saved = { ...saved, secret: secret || undefined }; write() },
  }
}
export type TokenStore = ReturnType<typeof createTokenStore>
