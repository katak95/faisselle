/**
 * Atlassian's MCP server (v2), as Figolu uses it. Its tool names and their parameters aren't published, and v1 and v2
 * name them differently, so nothing here is fixed: the tools the server lists (with their JSON Schemas) are read at
 * sign-in, each need is matched to the first tool that has it, and each argument goes in under the name that tool's
 * schema uses. A tool the server only offers through its executeRead / executeWrite gateway is called through it.
 */

export type ToolInfo = { name: string; description?: string; inputSchema?: { properties?: Record<string, { type?: string | string[]; enum?: unknown[]; description?: string }>; required?: string[] } }
export type RawCall = (name: string, args: Record<string, unknown>) => Promise<unknown>

/** what Figolu needs, and the tools that can do it, best first (v2 names, then v1's) */
export const NEEDS = {
  resources: ['getAccessibleAtlassianResources'],
  me: ['atlassianUserInfo', 'lookupJiraAccountId'],
  personalSpace: ['getConfluencePersonalSpace'],
  spaces: ['listConfluenceSpaces', 'getConfluenceSpaces'],
  list: ['listConfluenceContent', 'getPagesInConfluenceSpace'],
  search: ['searchConfluence', 'searchConfluenceUsingCql'],
  get: ['getConfluenceContent', 'getConfluencePage'],
  create: ['createConfluenceContent', 'createConfluencePage'],
  update: ['updateConfluenceContent', 'updateConfluencePage'],
} as const
export type Need = keyof typeof NEEDS

/** each argument Figolu gives, and the names a schema may call it */
const ALIASES: Record<string, string[]> = {
  cloudId: ['cloudId', 'cloud_id', 'siteId'],
  spaceId: ['spaceId', 'space_id', 'spaceKey', 'space'],
  pageId: ['pageId', 'contentId', 'id', 'page_id'],
  parentId: ['parentId', 'parentPageId', 'parent_id', 'parentContentId', 'ancestorId'],
  title: ['title', 'name'],
  body: ['body', 'content', 'bodyContent', 'value'],
  format: ['contentFormat', 'bodyFormat', 'format', 'representation', 'contentRepresentation'],
  type: ['type', 'contentType', 'kind'],
  version: ['version', 'versionNumber', 'currentVersion'],
  cql: ['cql', 'query'],
  spaceType: ['type', 'spaceType'],
  limit: ['limit', 'maxResults', 'pageSize'],
  message: ['versionMessage', 'message', 'versionComment'],
}

const GATEWAY = { read: ['executeRead', 'execute'], write: ['executeWrite', 'execute'] }
const WRITES: Need[] = ['create', 'update']

export class MissingToolError extends Error {
  name = 'MissingToolError'
  constructor(readonly need: Need) { super(`Atlassian's MCP server has no tool to ${need} (it offers something else than Figolu knows)`) }
}

/** the property of a schema that takes this argument, if any */
export function propFor(tool: ToolInfo, arg: string): string | undefined {
  const props = tool.inputSchema?.properties ?? {}
  return (ALIASES[arg] ?? [arg]).find((n) => n in props)
}

/** the body format to ask for: storage (Confluence's XHTML) when the tool offers it, else markdown, else what it has */
export function formatFor(tool: ToolInfo): { prop: string; value: string } | undefined {
  const prop = propFor(tool, 'format')
  if (!prop) return undefined
  const values = (tool.inputSchema?.properties?.[prop]?.enum ?? []).map(String)
  const pick = ['storage', 'markdown', 'adf'].find((v) => values.some((x) => x.toLowerCase() === v))
  return { prop, value: pick ? values.find((x) => x.toLowerCase() === pick)! : 'storage' }
}

/** Figolu's arguments under the tool's own names; ones the tool has no place for are left out */
export function argsFor(tool: ToolInfo, args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined || k === 'format') continue
    const prop = propFor(tool, k)
    if (prop && !(prop in out)) out[prop] = v
  }
  return out
}

export function createToolbox(tools: ToolInfo[], raw: RawCall) {
  const byName = new Map(tools.map((t) => [t.name, t]))
  const gateway = (write: boolean) => GATEWAY[write ? 'write' : 'read'].map((n) => byName.get(n)).find(Boolean)
  const toolFor = (need: Need) => NEEDS[need].map((n) => byName.get(n)).find(Boolean)
  return {
    /** whether Figolu can do this: a tool of its own, or through the gateway */
    can: (need: Need) => !!toolFor(need) || !!gateway(WRITES.includes(need)),
    /** whether the server offers this need directly */
    offers: (need: Need) => !!toolFor(need),
    tool: toolFor,
    /** calls the tool for a need, with Figolu's arguments renamed to its schema; format: what the body is written in */
    async call(need: Need, args: Record<string, unknown>, format?: string): Promise<unknown> {
      const tool = toolFor(need)
      if (tool) {
        const a = argsFor(tool, args)
        const f = formatFor(tool)
        if (f && format) a[f.prop] = format
        return raw(tool.name, a)
      }
      // only behind the gateway: its schema says where the tool name and the arguments go
      const g = gateway(WRITES.includes(need))
      if (!g) throw new MissingToolError(need)
      const props = Object.keys(g.inputSchema?.properties ?? {})
      const nameProp = ['tool', 'toolName', 'name', 'action'].find((p) => props.includes(p)) ?? 'tool'
      const argsProp = ['arguments', 'args', 'input', 'params', 'parameters'].find((p) => props.includes(p)) ?? 'arguments'
      return raw(g.name, { [nameProp]: NEEDS[need][0], [argsProp]: { ...args, ...(format ? { contentFormat: format } : {}) } })
    },
  }
}
export type Toolbox = ReturnType<typeof createToolbox>

/** a tool's answer as JSON: the first text block parsed, or the text itself; an error answer throws */
export function toolJson(result: unknown): unknown {
  const r = result as { content?: Array<{ type?: string; text?: string }>; isError?: boolean; structuredContent?: unknown } | undefined
  if (r?.structuredContent && !r.isError) return r.structuredContent
  const text = r?.content?.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n') ?? ''
  let v: unknown
  try { v = JSON.parse(text) } catch { v = text }
  if (r?.isError) throw new Error(typeof v === 'string' ? v.slice(0, 500) : JSON.stringify(v).slice(0, 500))
  return v
}

/** every object in a JSON answer, depth first: answers wrap their results in results / values / data … */
export function* objects(v: unknown, depth = 0): Generator<Record<string, unknown>> {
  if (depth > 6 || !v || typeof v !== 'object') return
  if (Array.isArray(v)) { for (const x of v) yield* objects(x, depth + 1); return }
  yield v as Record<string, unknown>
  for (const x of Object.values(v)) if (x && typeof x === 'object') yield* objects(x, depth + 1)
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : undefined)

/** the sites in getAccessibleAtlassianResources' answer: id (cloudId), name and url */
export function sitesOf(v: unknown): Array<{ id: string; name: string; url: string }> {
  const out: Array<{ id: string; name: string; url: string }> = []
  for (const o of objects(v)) {
    const id = str(o.id) ?? str(o.cloudId), url = str(o.url)
    if (id && url && /atlassian\.net|jira\.com|atlassian\.com/.test(url) && !out.some((s) => s.id === id)) out.push({ id, name: str(o.name) ?? url, url })
  }
  return out
}

/** the account id in atlassianUserInfo's answer */
export const accountOf = (v: unknown): { id: string; name: string } | undefined => {
  for (const o of objects(v)) {
    const id = str(o.account_id) ?? str(o.accountId)
    if (id) return { id, name: str(o.name) ?? str(o.displayName) ?? str(o.email) ?? id }
  }
  return undefined
}

export type SpaceRef = { id: string; key: string; name: string; url?: string; type?: string }
/** spaces in an answer (a list, or the one personal space) */
export function spacesOf(v: unknown): SpaceRef[] {
  const out: SpaceRef[] = []
  for (const o of objects(v)) {
    const id = str(o.id), key = str(o.key)
    if (!id || !key || out.some((s) => s.id === id)) continue
    const links = o._links as { webui?: string; base?: string } | undefined
    out.push({ id, key, name: str(o.name) ?? key, type: str(o.type), url: links?.webui ? `${links.base ?? ''}${links.webui}` : undefined })
  }
  return out
}

export type PageRef = { id: string; title: string; version?: number; url?: string }
/** pages (or other content) in an answer, with their version and link when given */
export function pagesOf(v: unknown, base = ''): PageRef[] {
  const out: PageRef[] = []
  for (const o of objects(v)) {
    const id = str(o.id), title = str(o.title)
    if (!id || !title || out.some((p) => p.id === id)) continue
    const ver = o.version as { number?: unknown } | number | undefined
    const version = typeof ver === 'number' ? ver : typeof ver?.number === 'number' ? ver.number : undefined
    const links = o._links as { webui?: string; base?: string; tinyui?: string } | undefined
    const url = str(o.webUrl) ?? str(o.url) ?? (links?.webui ? `${links.base ?? base}${links.webui}` : undefined)
    out.push({ id, title, ...(version !== undefined ? { version } : {}), ...(url ? { url } : {}) })
  }
  return out
}
