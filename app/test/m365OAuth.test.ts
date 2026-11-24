import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { authorizeUrl, createTokenStore, M365AuthError, parseRedirect, pkce, problemOf, tokenRequest, type Fetch } from '../src/main/m365/oauth'
import { createM365 } from '../src/main/m365/client'
import { fakeM365Server, fakeMicrosoftSignIn } from '../src/main/m365/fake'
import type { M365Status } from '../src/shared/types'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'm365-oauth-')); dirs.push(d); return d }
const plain = { seal: (s: string) => `x:${Buffer.from(s).toString('base64')}`, open: (s: string) => Buffer.from(s.slice(2), 'base64').toString() }
const app = { clientId: '11111111-2222-3333-4444-555555555555', tenantId: 'contoso.onmicrosoft.com', redirectUri: 'http://localhost:3118/callback' }

describe('the browser sign-in for Microsoft 365', () => {
  it('only takes a loopback redirect URI with its port, as Azure registers it', () => {
    expect(parseRedirect('http://localhost:3118/callback')).toEqual({ port: 3118, path: '/callback' })
    expect(parseRedirect(' http://127.0.0.1:8080/oauth/callback ')).toEqual({ port: 8080, path: '/oauth/callback' })
    for (const bad of ['http://localhost/callback', 'https://localhost:3118/callback', 'http://example.com:3118/callback', 'http://localhost:3118/callback?x=1', 'nonsense', 'http://localhost:0/cb'])
      expect(parseRedirect(bad), bad).toBeNull()
  })

  it("asks Microsoft for a code with PKCE, on the app's redirect URI and tenant, for what the app already has", () => {
    const p = pkce()
    const u = new URL(authorizeUrl(app, p))
    expect(u.origin + u.pathname).toBe('https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/authorize')
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ client_id: app.clientId, response_type: 'code', redirect_uri: app.redirectUri, code_challenge_method: 'S256',
      code_challenge: p.challenge, state: p.state, scope: 'https://graph.microsoft.com/.default offline_access openid profile' })
    expect(p.challenge).not.toBe(p.verifier)
    // no tenant: work and school accounts
    expect(authorizeUrl({ ...app, tenantId: '' }, p)).toContain('/organizations/oauth2/v2.0/authorize')
  })

  it('exchanges the code, sending the secret only when there is one', async () => {
    const sent: URLSearchParams[] = []
    const fetchImpl: Fetch = async (url, init) => { expect(url).toBe('https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token'); sent.push(new URLSearchParams(init.body)); return { ok: true, status: 200, json: async () => ({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }) } }
    expect(await tokenRequest(app, { code: 'c', verifier: 'v' }, fetchImpl, () => 1000)).toEqual({ access: 'a', refresh: 'r', expiresAt: 3_601_000 })
    expect(Object.fromEntries(sent[0])).toMatchObject({ grant_type: 'authorization_code', code: 'c', code_verifier: 'v', redirect_uri: app.redirectUri, client_id: app.clientId })
    expect(sent[0].has('client_secret')).toBe(false)
    await tokenRequest({ ...app, secret: 's3cret' }, { refresh: 'r' }, fetchImpl)
    expect(Object.fromEntries(sent[1])).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'r', client_secret: 's3cret' })
  })

  it("says what the app needs when Microsoft refuses", async () => {
    expect(problemOf('invalid_client', "AADSTS7000218: The request body must contain the following parameter: 'client_assertion' or 'client_secret'.")).toBe('secret-needed')
    expect(problemOf('invalid_client', 'AADSTS7000215: Invalid client secret provided.')).toBe('secret-wrong')
    expect(problemOf('invalid_request', "AADSTS700025: Client is public so neither 'client_assertion' nor 'client_secret' should be presented.")).toBe('secret-not-allowed')
    expect(problemOf('invalid_request', 'AADSTS50011: The redirect URI specified in the request does not match.')).toBe('redirect-mismatch')
    expect(problemOf('invalid_grant', 'AADSTS70008: The refresh token has expired.')).toBe('expired')
    const refused: Fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: 'invalid_client', error_description: "AADSTS7000218: The request body must contain 'client_secret'.\r\nTrace ID: x" }) })
    const e = await tokenRequest(app, { code: 'c', verifier: 'v' }, refused).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(M365AuthError)
    expect((e as M365AuthError).problem).toBe('secret-needed')
  })

  it('keeps the tokens and the secret sealed, and forgets the file once both are gone', () => {
    const file = join(tmp(), 'm365-oauth.json')
    const s = createTokenStore({ file, ...plain })
    s.setSecret('s3cret'); s.setTokens({ access: 'a', refresh: 'r', expiresAt: 1 })
    expect(readFileSync(file, 'utf8')).not.toContain('s3cret')
    expect(createTokenStore({ file, ...plain }).secret()).toBe('s3cret')
    s.setSecret(''); s.setTokens(undefined)
    expect(() => readFileSync(file)).toThrow()
  })

  it('signs in with the browser on the redirect URI, gives the server the token and refreshes it before it runs out', async () => {
    const store = createTokenStore({ file: join(tmp(), 'm365-oauth.json'), ...plain })
    const microsoft = fakeMicrosoftSignIn()
    const tokens: Array<string | undefined> = []
    const server = fakeM365Server()
    const states: M365Status[] = []
    const port = 30000 + Math.floor(Math.random() * 20000)
    const m = createM365({ dataDir: tmp(), app: () => ({ clientId: app.clientId, tenantId: app.tenantId }), browser: () => ({ redirectUri: `http://localhost:${port}/callback` }),
      store, fetch: microsoft.fetch, openExternal: microsoft.open, onChange: (s) => states.push(s), connect: (t) => { tokens.push(t); return server(t) } })
    await m.signIn()
    expect(states.some((s) => s.state === 'pending' && !s.code && s.url.includes('/authorize'))).toBe(true)
    expect(m.status()).toEqual({ state: 'connected', account: 'you@example.com' })
    expect(tokens.at(-1)).toBe('fake-access-1')
    // close to its end: a new token, and the server starts again with it
    store.setTokens({ ...store.tokens()!, expiresAt: Date.now() + 60_000 })
    await m.call('get-calendar-view', {})
    expect(tokens.at(-1)).toBe('fake-access-2')
    // refused refresh (revoked): signed out after a sign-in: it ran out, and Settings offers to connect again
    store.setTokens({ access: 'old', refresh: 'revoked', expiresAt: Date.now() })
    await expect(m.call('get-calendar-view', {})).rejects.toThrow()
    expect(m.status()).toEqual({ state: 'signed-out', expired: true })
    expect(store.tokens()).toBeUndefined()
  })

  it('says when the redirect URI\'s port is taken', async () => {
    const { createServer } = await import('node:http')
    const busy = createServer().listen(0, '127.0.0.1')
    await new Promise((r) => busy.once('listening', r))
    const port = (busy.address() as { port: number }).port
    const m = createM365({ dataDir: tmp(), app: () => ({ clientId: app.clientId }), browser: () => ({ redirectUri: `http://localhost:${port}/callback` }),
      store: createTokenStore({ file: join(tmp(), 'x.json'), ...plain }), openExternal: () => {}, onChange: () => {}, connect: fakeM365Server() })
    await m.signIn()
    busy.close()
    expect(m.status()).toMatchObject({ state: 'error', problem: 'port-busy' })
  })
})

describe('a Microsoft 365 sign-in that ran out', () => {
  const client = (once: { v: boolean }) => createM365({ dataDir: tmp(), app: () => ({ clientId: app.clientId }), browser: () => ({ redirectUri: app.redirectUri }),
    store: createTokenStore({ file: join(tmp(), 'x.json'), ...plain }), openExternal: () => {}, onChange: () => {}, connect: fakeM365Server(),
    connectedOnce: { get: () => once.v, set: (on) => { once.v = on } } })

  it('says it ran out when it was connected before', async () => {
    const m = client({ v: true })
    await m.resume()
    expect(m.status()).toEqual({ state: 'signed-out', expired: true })
  })

  it("doesn't, when it was turned on but never connected", async () => {
    const m = client({ v: false })
    await m.resume()
    expect(m.status()).toEqual({ state: 'signed-out' })
  })

  it('stays ran out through a sign-in given up, and not once turned off', async () => {
    const m = client({ v: true })
    await m.resume()
    m.cancel()
    expect(m.status()).toEqual({ state: 'signed-out', expired: true })
    await m.signOut()
    expect(m.status()).toEqual({ state: 'off' })
  })
})
