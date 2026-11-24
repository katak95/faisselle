import { join } from 'node:path'
import { createRequire } from 'node:module'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { UtilityProcessTransport } from './serverProcess'
import type { M365Status } from '../../shared/types'
import { deviceCode, enabledTools, needsAdminConsent, toolJson, TOOLS, type CallTool } from './tools'
import { authorizeUrl, M365AuthError, parseRedirect, pkce, tokenRequest, type AppConfig, type Fetch, type TokenStore } from './oauth'
import { waitForCode } from '../atlassian/oauth'

/**
 * Microsoft 365 as an MCP client: Faisselle starts the Softeria ms-365-mcp-server (read only, calendar and mail tools
 * only) in an Electron utility process (src/m365/worker.ts, serverProcess.ts), and talks to it as over stdio. Signing in is Microsoft's device code: the browser opens
 * microsoft.com/devicelogin and the person types the code shown in Settings. The server keeps its token in Faisselle's
 * folder.
 *
 * An organisation's app that doesn't allow the device code signs in with the browser instead (oauth.ts): Faisselle gets
 * the token on the app's own redirect URI, gives it to the server (MS365_MCP_OAUTH_TOKEN) and starts the server again
 * with a new one before it runs out.
 */
export type M365Options = { dataDir: string; /** the built worker the server runs in (out/main/m365.js) */ worker?: string; /** an organisation's own Azure app registration, read each time the server starts */ app?: () => { clientId?: string; tenantId?: string }; openExternal(url: string): void; onChange(s: M365Status): void
  /** it connected at least once since it was turned on (a sign-in that ends signed out then ran out); kept by the caller */
  connectedOnce?: { get(): boolean; set(on: boolean): void }
  /** SharePoint and OneDrive search: work-account mode, with Microsoft Search's wider read permissions (read when the server starts) */
  documents?: () => boolean
  /** the browser sign-in (an app without public client flows): its redirect URI, when that's the method */
  browser?: () => { redirectUri: string } | null
  /** the browser sign-in's tokens and the app's secret (sealed) */
  store?: TokenStore
  /** tests and fake mode: the token endpoint */
  fetch?: Fetch
  /** tests and fake mode: a stand-in for the server (token: the browser sign-in's) */
  connect?: (token?: string) => Promise<{ call: CallTool; close(): Promise<void> }> }

/** a token this close to its end is refreshed before the next call */
const REFRESH_MARGIN_MS = 5 * 60_000

const serverScript = () => createRequire(import.meta.url).resolve('@softeria/ms-365-mcp-server/dist/index.js')

async function startServer(o: M365Options, token?: string): Promise<{ call: CallTool; close(): Promise<void> }> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/^(ELECTRON_|NODE_OPTIONS$)/.test(k)) env[k] = v
  Object.assign(env, {
    MS365_MCP_TOKEN_CACHE_PATH: join(o.dataDir, 'm365-token-cache.json'),
    MS365_MCP_SELECTED_ACCOUNT_PATH: join(o.dataDir, 'm365-account.json'),
    MS365_MCP_LOG_DIR: join(o.dataDir, 'logs'),
    MS365_MCP_OUTPUT_FORMAT: 'json',
    ...(o.app?.().clientId ? { MS365_MCP_CLIENT_ID: o.app!().clientId! } : {}),
    ...(o.app?.().tenantId ? { MS365_MCP_TENANT_ID: o.app!().tenantId! } : {}),
    ...(token ? { MS365_MCP_OAUTH_TOKEN: token } : {}),
  })
  const documents = o.documents?.() ?? false
  if (!o.worker) throw new Error('The Microsoft 365 server has no worker to run in')
  const transport = new UtilityProcessTransport({ worker: o.worker, script: serverScript(), env,
    args: ['--read-only', ...(documents ? ['--org-mode'] : []), '--enabled-tools', enabledTools(documents)],
    // what the server says on stderr goes to main.log: why it stopped, when it does
    stderr: (line) => console.info('M365', line.slice(0, 500)) })
  transport.onerror = (e) => console.warn('M365', e.message)
  const client = new Client({ name: 'Faisselle', version: '1' })
  await client.connect(transport)
  return {
    call: (name, args) => client.callTool({ name, arguments: args }, undefined, { timeout: 60_000 }),
    close: () => client.close(),
  }
}

export function createM365(o: M365Options) {
  let status: M365Status = { state: 'off' }
  let server: Promise<{ call: CallTool; close(): Promise<void> }> | undefined
  let polling = 0
  let documentsRefused = false
  /** it was connected, and the sign-in ran out: signed out stays 'expired' until connected again or turned off */
  let lost = false
  const set = (s: M365Status) => {
    if (s.state === 'connected' || s.state === 'off') lost = false
    if (s.state === 'connected' && o.connectedOnce && !o.connectedOnce.get()) o.connectedOnce.set(true)
    status = s.state === 'signed-out' && lost ? { state: 'signed-out', expired: true } : s
    o.onChange(status)
  }
  const ranOut = () => { lost = o.connectedOnce?.get() ?? true; set({ state: 'signed-out' }) }
  /** the browser sign-in's app, when that's the method in use */
  const browserApp = (): AppConfig | null => {
    const b = o.browser?.(), a = o.app?.()
    return b && a?.clientId && o.store ? { clientId: a.clientId, tenantId: a.tenantId, redirectUri: b.redirectUri, secret: o.store.secret() } : null
  }
  let serverToken: string | undefined
  const connect = (token?: string) => (server ??= (serverToken = token, (o.connect ?? ((t?: string) => startServer(o, t)))(token)).catch((e) => { server = undefined; throw e }))
  const stopServer = async () => { const s = server; server = undefined; await s?.then((x) => x.close()).catch(() => {}) }
  /** the browser sign-in's access token, refreshed when it's about to run out (the server then starts again with it) */
  let refreshing: Promise<string> | undefined
  const accessToken = (app: AppConfig): Promise<string> => {
    const t = o.store!.tokens()
    if (!t) return Promise.reject(new M365AuthError('Not signed in to Microsoft 365', 'expired'))
    if (t.expiresAt - Date.now() > REFRESH_MARGIN_MS) return Promise.resolve(t.access)
    if (!t.refresh) return Promise.reject(new M365AuthError('The Microsoft 365 sign-in ran out', 'expired'))
    return (refreshing ??= tokenRequest(app, { refresh: t.refresh }, o.fetch).then((next) => { o.store!.setTokens(next); return next.access })
      .catch((e) => { if (e instanceof M365AuthError && e.problem === 'expired') o.store!.setTokens(undefined); throw e })
      .finally(() => { refreshing = undefined }))
  }
  const ready = async () => {
    const app = browserApp()
    if (!app) return connect()
    const token = await accessToken(app)
    if (server && serverToken !== token) await stopServer()
    return connect(token)
  }
  const call: CallTool = async (name, args) => toolJson(await (await ready()).call(name, args))
  const failed = (e: unknown) => {
    const message = e instanceof Error ? e.message : String(e)
    const problem = e instanceof M365AuthError ? e.problem : undefined
    // signed out on Microsoft's side (revoked, or unused for months): Settings offers to connect again
    if (problem === 'expired') { ranOut(); return }
    set({ state: 'error', message, ...(needsAdminConsent(message) ? { consent: true } : {}), ...(problem ? { problem } : {}) })
  }
  let cancelBrowser: AbortController | undefined
  /** the browser sign-in: Microsoft's page in the browser, back to the app's redirect URI on this computer */
  const signInBrowser = async (app: AppConfig, mine: number) => {
    const at = parseRedirect(app.redirectUri)
    if (!at) throw new M365AuthError('The redirect URI must be http://localhost:PORT/path', 'redirect-mismatch')
    const p = pkce()
    cancelBrowser?.abort(); cancelBrowser = new AbortController()
    const wait = await waitForCode({ port: at.port, path: at.path, fixedPort: true, service: 'Microsoft 365', state: () => p.state, signal: cancelBrowser.signal })
      .catch((e: NodeJS.ErrnoException) => { throw e?.code === 'EADDRINUSE' ? new M365AuthError(`Port ${at.port} is in use`, 'port-busy') : e })
    const url = authorizeUrl(app, p)
    set({ state: 'pending', url })
    o.openExternal(url)
    const code = await wait.code
    if (mine !== polling) return
    o.store!.setTokens(await tokenRequest(app, { code, verifier: p.verifier }, o.fetch))
    await stopServer()
    const who = await verify()
    if (mine !== polling) return
    if (who === false) throw new Error('Microsoft 365 did not accept the sign-in')
    set({ state: 'connected', account: who })
  }

  /** signed in: the account's name, if the server says it */
  const verify = async (): Promise<string | null | false> => {
    const v = await call(TOOLS.verify, {}) as { success?: boolean; userData?: { displayName?: string; userPrincipalName?: string } }
    return v?.success ? v.userData?.userPrincipalName ?? v.userData?.displayName ?? null : false
  }

  return {
    status: () => status,
    /** tests (fake mode): the sign-in runs out, as when Microsoft refuses its refresh */
    ranOut() { if (status.state === 'connected') ranOut() },
    /** at launch, when it was connected before: start the server and see whether the sign-in still holds */
    async resume() {
      set({ state: 'starting' })
      if (browserApp() && !o.store!.tokens()) { ranOut(); return }
      try {
        const who = await verify()
        if (who === false) ranOut(); else set({ state: 'connected', account: who })
      } catch (e) { console.warn('Microsoft 365 did not start', e); failed(e) }
    },
    /** asks for a device code, opens the page, then checks every few seconds until the sign-in is done (10 minutes at most) */
    /** force: a new sign-in even when one holds, so Microsoft asks for newly needed permissions (documents turned on) */
    async signIn(force = false) {
      const mine = ++polling
      set({ state: 'starting' })
      const app = browserApp()
      if (app) {
        try { await signInBrowser(app, mine) } catch (e) { if (mine === polling) { console.warn('Microsoft 365 sign-in failed', e); failed(e) } }
        return
      }
      try {
        const v = await call(TOOLS.login, { force }) as { status?: string; message?: string }
        if (v?.status && /logged in|successful/i.test(v.status)) { const who = await verify(); set({ state: 'connected', account: who || null }); return }
        const dc = deviceCode(v?.message ?? '')
        if (!dc) throw new Error('Microsoft did not give a sign-in code')
        set({ state: 'pending', code: dc.code, url: dc.url })
        o.openExternal(dc.url)
        const until = Date.now() + 10 * 60_000
        while (mine === polling && Date.now() < until) {
          await new Promise((r) => setTimeout(r, 4000))
          if (mine !== polling) return
          const who = await verify().catch(() => false as const)
          if (who !== false) { set({ state: 'connected', account: who }); return }
        }
        if (mine === polling) set({ state: 'signed-out' })
      } catch (e) {
        console.warn('Microsoft 365 sign-in failed', e)
        failed(e)
      }
    },
    cancel() { polling++; cancelBrowser?.abort(); if (status.state === 'pending') set({ state: 'signed-out' }) },
    async signOut() {
      polling++
      cancelBrowser?.abort()
      // the browser sign-in's tokens are Faisselle's own: forgetting them signs out
      if (browserApp()) o.store!.setTokens(undefined)
      else try { await call(TOOLS.logout, {}) } catch (e) { console.warn('Microsoft 365 sign-out failed', e) }
      await this.stop()
      set({ state: 'off' })
    },
    async stop() { await stopServer() },
    connected: () => status.state === 'connected',
    /** a read-only tool call, once connected */
    async call(name: string, args: Record<string, unknown>) {
      if (status.state !== 'connected') throw new Error('Microsoft 365 is not connected')
      try { return await call(name, args) } catch (e) {
        // the browser sign-in ran out and couldn't be refreshed: Settings asks to connect again
        if (e instanceof M365AuthError) failed(e)
        throw e
      }
    },
    /** the documents search failed because an admin has to approve its permissions (Settings says so) */
    documentsRefused: () => documentsRefused,
    /** what the last documents search said: refused for want of consent, or fine */
    documentsAnswered(e?: unknown) {
      const refused = !!e && needsAdminConsent(e instanceof Error ? e.message : String(e))
      if (refused !== documentsRefused) { documentsRefused = refused; o.onChange(status) }
    },
  }
}
export type M365 = ReturnType<typeof createM365>
