import { join } from 'node:path'
import { createRequire } from 'node:module'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { M365Status } from '../../shared/types'
import { deviceCode, ENABLED_TOOLS, toolJson, TOOLS, type CallTool } from './tools'

/**
 * Microsoft 365 as an MCP client: Yogurt starts the Softeria ms-365-mcp-server (read only, calendar and mail tools
 * only) with Electron's own Node, and talks to it over stdio. Signing in is Microsoft's device code: the browser opens
 * microsoft.com/devicelogin and the person types the code shown in Settings. The server keeps its token in Yogurt's
 * folder.
 */
export type M365Options = { dataDir: string; /** an organisation's own Azure app registration, read each time the server starts */ app?: () => { clientId?: string; tenantId?: string }; openExternal(url: string): void; onChange(s: M365Status): void
  /** tests and fake mode: a stand-in for the server */
  connect?: () => Promise<{ call: CallTool; close(): Promise<void> }> }

const serverScript = () => createRequire(import.meta.url).resolve('@softeria/ms-365-mcp-server/dist/index.js')

async function startServer(o: M365Options): Promise<{ call: CallTool; close(): Promise<void> }> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/^(ELECTRON_|NODE_OPTIONS$)/.test(k)) env[k] = v
  Object.assign(env, {
    ELECTRON_RUN_AS_NODE: '1',
    MS365_MCP_TOKEN_CACHE_PATH: join(o.dataDir, 'm365-token-cache.json'),
    MS365_MCP_SELECTED_ACCOUNT_PATH: join(o.dataDir, 'm365-account.json'),
    MS365_MCP_LOG_DIR: join(o.dataDir, 'logs'),
    MS365_MCP_OUTPUT_FORMAT: 'json',
    ...(o.app?.().clientId ? { MS365_MCP_CLIENT_ID: o.app!().clientId! } : {}),
    ...(o.app?.().tenantId ? { MS365_MCP_TENANT_ID: o.app!().tenantId! } : {}),
  })
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverScript(), '--read-only', '--enabled-tools', ENABLED_TOOLS], env, stderr: 'pipe' })
  transport.stderr?.on('data', (b: Buffer) => { const line = b.toString().trim(); if (line) console.info('M365', line.slice(0, 500)) })
  const client = new Client({ name: 'Yogurt', version: '1' })
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
  const set = (s: M365Status) => { status = s; o.onChange(s) }
  const connect = () => (server ??= (o.connect ?? (() => startServer(o)))().catch((e) => { server = undefined; throw e }))
  const call: CallTool = async (name, args) => toolJson(await (await connect()).call(name, args))

  /** signed in: the account's name, if the server says it */
  const verify = async (): Promise<string | null | false> => {
    const v = await call(TOOLS.verify, {}) as { success?: boolean; userData?: { displayName?: string; userPrincipalName?: string } }
    return v?.success ? v.userData?.userPrincipalName ?? v.userData?.displayName ?? null : false
  }

  return {
    status: () => status,
    /** at launch, when it was connected before: start the server and see whether the sign-in still holds */
    async resume() {
      set({ state: 'starting' })
      try {
        const who = await verify()
        set(who === false ? { state: 'signed-out' } : { state: 'connected', account: who })
      } catch (e) { console.warn('Microsoft 365 did not start', e); set({ state: 'error', message: e instanceof Error ? e.message : String(e) }) }
    },
    /** asks for a device code, opens the page, then checks every few seconds until the sign-in is done (10 minutes at most) */
    async signIn() {
      const mine = ++polling
      set({ state: 'starting' })
      try {
        const v = await call(TOOLS.login, { force: false }) as { status?: string; message?: string }
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
        set({ state: 'error', message: e instanceof Error ? e.message : String(e) })
      }
    },
    cancel() { polling++; if (status.state === 'pending') set({ state: 'signed-out' }) },
    async signOut() {
      polling++
      try { await call(TOOLS.logout, {}) } catch (e) { console.warn('Microsoft 365 sign-out failed', e) }
      await this.stop()
      set({ state: 'off' })
    },
    async stop() {
      const s = server
      server = undefined
      await s?.then((x) => x.close()).catch(() => {})
    },
    connected: () => status.state === 'connected',
    /** a read-only tool call, once connected */
    async call(name: string, args: Record<string, unknown>) {
      if (status.state !== 'connected') throw new Error('Microsoft 365 is not connected')
      return call(name, args)
    },
  }
}
export type M365 = ReturnType<typeof createM365>
