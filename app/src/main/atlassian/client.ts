import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import type { AtlassianStatus } from '../../shared/types'
import { oauthProvider, PREFERRED_PORT, waitForCode, type OAuthStore } from './oauth'
import { accountOf, createToolbox, describeTools, sitesOf, toolJson, type RawCall, type ToolInfo, type Toolbox } from './tools'

/** Atlassian's remote MCP server; v2 is the one Atlassian recommends for every client */
export const ATLASSIAN_MCP = 'https://mcp.atlassian.com/v2/mcp'

export type Connection = { tools: ToolInfo[]; call: RawCall; close(): Promise<void> }
export type Site = { id: string; name: string; url: string }

/** a site or an organisation that doesn't let this app (or the MCP server) in: only an administrator can change it */
export const adminBlocked = (message: string): boolean => /not (enabled|allowed|permitted) for (this|your) (site|organi[sz]ation)|admin(istrator)? (has|must|needs)|domain.*(allowlist|not allowed)|redirect.*(not allowed|allowlist)|access_denied|unauthorized_client/i.test(message)

/**
 * Atlassian as an MCP client: signed in with OAuth in the browser (the server's own registration and PKCE, the
 * browser sent back to this computer), then the site, the account and the tools the server offers.
 */
export function createAtlassian(o: { store: OAuthStore; openExternal(url: string): void; onChange(s: AtlassianStatus): void
  /** the site the person picked when the account has several */
  siteId(): string | undefined
  /** tests and fake mode: a stand-in for the server (interactive: may open the sign-in page) */
  connect?: (interactive: boolean) => Promise<Connection> }) {
  let status: AtlassianStatus = { state: 'off' }
  let conn: Connection | undefined
  let box: Toolbox | undefined
  let sites: Site[] = []
  let account: { id: string; name: string } | undefined
  let attempt = 0
  let cancel: AbortController | undefined
  const set = (s: AtlassianStatus) => { status = s; o.onChange(s) }

  /** one connection to the server: with the saved tokens, or (interactive) after the browser sign-in */
  async function open(interactive: boolean, mine: number): Promise<Connection> {
    if (o.connect) return o.connect(interactive)
    const port = o.store.get().port ?? PREFERRED_PORT
    const connectWith = async (p: number, wait?: Awaited<ReturnType<typeof waitForCode>>, provider = oauthProvider(o.store, { port: p, interactive, openExternal: o.openExternal, onRedirect: () => { if (mine === attempt) set({ state: 'pending' }) } })) => {
      const client = new Client({ name: 'Faisselle', version: '1' })
      const transport = new StreamableHTTPClientTransport(new URL(ATLASSIAN_MCP), { authProvider: provider })
      try {
        await client.connect(transport)
      } catch (e) {
        if (!(e instanceof UnauthorizedError) || !wait) throw e
        // the browser is open on Atlassian's page: wait for it to come back with the code
        const code = await wait.code
        await transport.finishAuth(code)
        return connectWith(p, undefined, provider)
      }
      // every page of the list: a tool on a later page would otherwise only be reachable through the gateway
      const tools: unknown[] = []
      for (let cursor: string | undefined, n = 0; n < 20; n++) {
        const page = await client.listTools(cursor ? { cursor } : undefined)
        tools.push(...page.tools)
        cursor = page.nextCursor
        if (!cursor) break
      }
      return { tools: tools as ToolInfo[], close: () => client.close(),
        call: (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }, undefined, { timeout: 90_000 }).then(toolJson)
          // which tool, and which arguments it was given (their names, not their values)
          .catch((e: unknown) => { console.warn('Atlassian call failed', name, Object.keys(args).join(','), e instanceof Error ? e.message : String(e)); throw e }) }
    }
    if (!interactive) return connectWith(port)
    cancel = new AbortController()
    let provider: ReturnType<typeof oauthProvider> | undefined
    const wait = await waitForCode({ port, state: () => provider?.expectedState(), signal: cancel.signal })
    provider = oauthProvider(o.store, { port: wait.port, interactive: true, openExternal: o.openExternal, onRedirect: () => { if (mine === attempt) set({ state: 'pending' }) } })
    try { return await connectWith(wait.port, wait, provider) } finally { wait.close() }
  }

  /** after connecting: the sites, the one in use, and who is signed in */
  async function settle(c: Connection) {
    conn = c
    // what the server offers today: Atlassian adds, renames and defers tools without notice
    console.info('Atlassian tools', describeTools(c.tools).slice(0, 4000))
    box = createToolbox(c.tools, c.call)
    sites = box.can('resources') ? sitesOf(await box.call('resources', {})) : []
    account = box.can('me') ? accountOf(await box.call('me', {}).catch(() => undefined)) : undefined
    const site = sites.find((s) => s.id === o.siteId()) ?? sites[0]
    if (!site) throw new Error('This Atlassian account has no Confluence site')
    set({ state: 'connected', site: site.name, siteUrl: site.url, account: account?.name ?? null, sites })
  }

  const fail = (e: unknown) => {
    const message = e instanceof Error ? e.message : String(e)
    console.warn('Atlassian', message)
    set({ state: 'error', message, ...(adminBlocked(message) ? { admin: true } : {}) })
  }

  return {
    status: () => status,
    /** at launch, when signed in before: connect with the saved tokens (no browser) */
    async resume() {
      if (!o.store.signedIn() && !o.connect) return
      const mine = ++attempt
      set({ state: 'starting' })
      try { const c = await open(false, mine); if (mine === attempt) await settle(c) } catch (e) {
        if (mine !== attempt) return
        if (e instanceof UnauthorizedError || /Sign in to Atlassian/.test(String(e))) set({ state: 'signed-out' }); else fail(e)
      }
    },
    /** opens Atlassian's sign-in in the browser and waits for it to come back (5 minutes at most) */
    async signIn() {
      const mine = ++attempt
      set({ state: 'starting' })
      try { const c = await open(true, mine); if (mine === attempt) await settle(c); else await c.close() } catch (e) { if (mine === attempt) fail(e) }
    },
    cancel() { attempt++; cancel?.abort(); if (status.state === 'pending' || status.state === 'starting') set({ state: o.store.signedIn() ? 'signed-out' : 'off' }) },
    async signOut() {
      attempt++; cancel?.abort()
      await conn?.close().catch(() => {})
      conn = undefined; box = undefined; sites = []; account = undefined
      o.store.clear('all')
      set({ state: 'off' })
    },
    connected: () => status.state === 'connected',
    /** the site in use, the account and the tools, once connected */
    current(): { box: Toolbox; site: Site; accountId?: string } {
      const site = sites.find((s) => s.id === o.siteId()) ?? sites[0]
      if (!box || !site || status.state !== 'connected') throw new Error('Not connected to Atlassian')
      return { box, site, ...(account ? { accountId: account.id } : {}) }
    },
    /** the person picked another site */
    siteChanged() { if (status.state === 'connected') { const site = sites.find((s) => s.id === o.siteId()) ?? sites[0]; set({ ...status, site: site.name, siteUrl: site.url }) } },
  }
}
export type Atlassian = ReturnType<typeof createAtlassian>
