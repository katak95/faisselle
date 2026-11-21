import type { Connection } from './client'
import type { ToolInfo } from './tools'

/**
 * Fake mode: an Atlassian MCP server (v2 tool names) with one site, a personal space and no pages yet. Pages created
 * or updated are kept in memory, so tests can read what Figolu sent.
 */
export type FakePage = { id: string; title: string; body: string; format: string; parentId?: string; spaceId: string; version: number }
export const fakeConfluence = { pages: [] as FakePage[], calls: [] as Array<{ name: string; args: Record<string, unknown> }> }

const s = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'string', description, ...extra })
const TOOLS: ToolInfo[] = [
  { name: 'getAccessibleAtlassianResources', inputSchema: { properties: {} } },
  { name: 'atlassianUserInfo', inputSchema: { properties: {} } },
  { name: 'getConfluencePersonalSpace', inputSchema: { properties: { cloudId: s('site') }, required: ['cloudId'] } },
  { name: 'listConfluenceContent', inputSchema: { properties: { cloudId: s('site'), spaceId: s('space'), contentType: s('type'), limit: { type: 'number' } }, required: ['cloudId', 'spaceId'] } },
  { name: 'getConfluenceContent', inputSchema: { properties: { cloudId: s('site'), contentId: s('id') }, required: ['cloudId', 'contentId'] } },
  { name: 'createConfluenceContent', inputSchema: { properties: { cloudId: s('site'), spaceId: s('space'), parentId: s('parent'), title: s('title'), body: s('body'), contentFormat: s('format', { enum: ['markdown', 'storage', 'adf'] }), contentType: s('type') }, required: ['cloudId', 'spaceId', 'title', 'body'] } },
  { name: 'updateConfluenceContent', inputSchema: { properties: { cloudId: s('site'), contentId: s('id'), title: s('title'), body: s('body'), contentFormat: s('format', { enum: ['markdown', 'storage', 'adf'] }), version: { type: 'number' } }, required: ['cloudId', 'contentId', 'body'] } },
]
const SITE = 'https://example.atlassian.net'
const page = (p: FakePage) => ({ id: p.id, title: p.title, version: { number: p.version }, _links: { base: `${SITE}/wiki`, webui: `/spaces/~you/pages/${p.id}` } })

export function fakeAtlassianServer(): (interactive: boolean) => Promise<Connection> {
  let signedIn = false
  return async (interactive) => {
    if (!interactive && !signedIn) throw new Error('Sign in to Atlassian in Settings')
    signedIn = true
    return {
      tools: TOOLS,
      close: async () => {},
      async call(name, args) {
        fakeConfluence.calls.push({ name, args })
        if (name === 'getAccessibleAtlassianResources') return [{ id: 'cloud-1', name: 'Example', url: SITE, scopes: ['read:confluence-content.all'] }]
        if (name === 'atlassianUserInfo') return { account_id: 'acc-1', name: 'You', email: 'you@example.com' }
        if (name === 'getConfluencePersonalSpace') return { id: 'space-1', key: '~acc-1', name: 'You', type: 'personal' }
        if (name === 'listConfluenceContent') return { results: fakeConfluence.pages.filter((p) => p.spaceId === args.spaceId).map(page) }
        if (name === 'getConfluenceContent') {
          const p = fakeConfluence.pages.find((x) => x.id === args.contentId)
          if (!p) throw new Error('404 Not Found: no content with this id')
          return page(p)
        }
        if (name === 'createConfluenceContent') {
          if (fakeConfluence.pages.some((p) => p.title === args.title && p.spaceId === args.spaceId)) throw new Error('A page with this title already exists in this space')
          const p: FakePage = { id: String(1000 + fakeConfluence.pages.length), title: String(args.title), body: String(args.body), format: String(args.contentFormat), spaceId: String(args.spaceId), version: 1, ...(args.parentId ? { parentId: String(args.parentId) } : {}) }
          fakeConfluence.pages.push(p)
          return page(p)
        }
        if (name === 'updateConfluenceContent') {
          const p = fakeConfluence.pages.find((x) => x.id === args.contentId)
          if (!p) throw new Error('404 Not Found')
          if (args.version !== p.version + 1) throw new Error(`409 Conflict: version must be ${p.version + 1}`)
          Object.assign(p, { title: String(args.title ?? p.title), body: String(args.body), format: String(args.contentFormat), version: p.version + 1 })
          return page(p)
        }
        throw new Error(`unknown tool ${name}`)
      },
    }
  }
}
