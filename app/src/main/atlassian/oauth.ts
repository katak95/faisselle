import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'

/**
 * Signing in to Atlassian for its MCP server: OAuth 2.1 with PKCE, Faisselle registered as a public client by dynamic
 * registration, and the browser sent back to a loopback address on this computer. What it keeps (the registration,
 * the tokens) is sealed with the system keychain in one file.
 */

type Saved = { client?: OAuthClientInformationMixed; tokens?: OAuthTokens; verifier?: string; port?: number }

export function createOAuthStore(o: { file: string; seal(plain: string): string; open(sealed: string): string }) {
  let saved: Saved = {}
  try { if (existsSync(o.file)) saved = JSON.parse(o.open(readFileSync(o.file, 'utf8'))) as Saved } catch (e) { console.warn('the Atlassian sign-in could not be read', e) }
  const write = () => {
    writeFileSync(o.file + '.tmp', o.seal(JSON.stringify(saved)), { mode: 0o600 })
    renameSync(o.file + '.tmp', o.file)
  }
  return {
    get: () => saved,
    set(patch: Partial<Saved>) { saved = { ...saved, ...patch }; write() },
    clear(what: 'all' | 'client' | 'tokens' | 'verifier') {
      if (what === 'all') { saved = {}; rmSync(o.file, { force: true }); return }
      const next = { ...saved }
      if (what === 'client') { delete next.client; delete next.tokens }
      if (what === 'tokens') delete next.tokens
      if (what === 'verifier') delete next.verifier
      saved = next; write()
    },
    signedIn: () => !!saved.tokens?.access_token,
  }
}
export type OAuthStore = ReturnType<typeof createOAuthStore>

/** the loopback address the browser comes back to; the same port each time, so the registration stays valid */
export const PREFERRED_PORT = 33418
export const callbackUrl = (port: number) => `http://localhost:${port}/oauth/callback`

/**
 * The provider the MCP SDK asks for the registration, the tokens and the verifier. interactive: a sign-in the person
 * started (the browser may open); otherwise a launch that only uses what is saved.
 */
export function oauthProvider(store: OAuthStore, o: { port: number; interactive: boolean; openExternal(url: string): void; onRedirect?(): void }): OAuthClientProvider & { expectedState(): string | undefined } {
  let state: string | undefined
  const metadata: OAuthClientMetadata = {
    client_name: 'Faisselle', redirect_uris: [callbackUrl(o.port)], grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'], token_endpoint_auth_method: 'none',
  }
  return {
    get redirectUrl() { return callbackUrl(o.port) },
    get clientMetadata() { return metadata },
    state: () => (state = randomBytes(16).toString('hex')),
    expectedState: () => state,
    // a registration made for another port can't come back here: Faisselle registers again
    clientInformation: () => (store.get().port === o.port ? store.get().client : undefined),
    saveClientInformation: (client) => store.set({ client, port: o.port }),
    tokens: () => store.get().tokens,
    saveTokens: (tokens) => store.set({ tokens }),
    redirectToAuthorization(url) {
      if (!o.interactive) throw new Error('Sign in to Atlassian in Settings')
      o.onRedirect?.()
      o.openExternal(url.toString())
    },
    saveCodeVerifier: (verifier) => store.set({ verifier }),
    codeVerifier: () => {
      const v = store.get().verifier
      if (!v) throw new Error('No sign-in in progress')
      return v
    },
    invalidateCredentials: (scope) => { store.clear(scope === 'discovery' ? 'verifier' : scope) },
  }
}

const PAGE = (title: string, text: string) => `<!doctype html><meta charset="utf-8"><title>Faisselle</title><body style="font:16px system-ui;margin:4rem auto;max-width:28rem;text-align:center"><h1 style="font-size:20px">${title}</h1><p>${text}</p></body>`

/**
 * The loopback server for one sign-in: answers the browser's return with a short page, and gives the code once the
 * state matches. Only its path (/oauth/callback by default) on localhost; anything else is a 404. Closes itself after
 * 5 minutes. fixedPort: that port or nothing (an address registered beforehand, like an Azure app's redirect URI);
 * a port in use then fails with code EADDRINUSE.
 */
export async function waitForCode(o: { port: number; state: () => string | undefined; timeoutMs?: number; signal?: AbortSignal
  path?: string; fixedPort?: boolean; service?: string }): Promise<{ code: Promise<string>; port: number; close(): void }> {
  let resolve!: (code: string) => void, reject!: (e: Error) => void
  const code = new Promise<string>((res, rej) => { resolve = res; reject = rej })
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== (o.path ?? '/oauth/callback')) { res.writeHead(404).end(); return }
    const error = url.searchParams.get('error')
    const got = url.searchParams.get('code')
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    if (error || !got) { res.end(PAGE('Sign-in not finished', 'You can close this tab and try again in Faisselle.')); reject(new Error(url.searchParams.get('error_description') ?? error ?? 'No code')); return }
    if (url.searchParams.get('state') !== o.state()) { res.end(PAGE('Sign-in not finished', 'This page did not come from Faisselle’s sign-in.')); reject(new Error('The sign-in state did not match')); return }
    res.end(PAGE(`Signed in to ${o.service ?? 'Atlassian'}`, 'You can close this tab and go back to Faisselle.'))
    resolve(got)
  })
  const listen = (port: number) => new Promise<number>((res, rej) => {
    server.once('error', rej)
    server.listen(port, '127.0.0.1', () => { server.off('error', rej); res((server.address() as { port: number }).port) })
  })
  // the preferred port when it's free, else any free one (the registration then changes)
  const port = await (o.fixedPort ? listen(o.port) : listen(o.port).catch(() => listen(0)))
  const timer = setTimeout(() => reject(new Error('The sign-in took too long')), o.timeoutMs ?? 5 * 60_000)
  const close = () => { clearTimeout(timer); server.close() }
  o.signal?.addEventListener('abort', () => { reject(new Error('Sign-in cancelled')); close() }, { once: true })
  code.catch(() => {}).finally(close)
  return { code, port, close }
}
