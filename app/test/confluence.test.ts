import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { markdownBody, pageTitle, personalSpace, publishReport, storageBody, type Report } from '../src/main/atlassian/publish'
import { argsFor, createToolbox, formatFor, pagesOf, sitesOf, spacesOf, toolJson, type ToolInfo } from '../src/main/atlassian/tools'
import { fakeAtlassianServer, fakeConfluence } from '../src/main/atlassian/fake'
import { createAtlassian } from '../src/main/atlassian/client'
import { createOAuthStore, oauthProvider, waitForCode } from '../src/main/atlassian/oauth'

const labels = { date: 'Date', length: 'Length', people: 'People', actions: 'Action items', footer: 'Written with Yogurt', minutes: (n: number) => `${n} min` }
const report = (over: Partial<Report> = {}): Report => ({
  meeting: { title: 'Acme renewal', startedAt: new Date(2026, 10, 21, 9, 5).getTime(), endedAt: new Date(2026, 10, 21, 9, 35).getTime(), attendees: [{ name: 'Maya & Co', email: 'maya@acme.example' }] },
  summary: '## Pricing\n- <mine>Two years</mine> at **the 2025 price**', actions: [{ owner: 'You', task: 'Send the <quote>', due: 'Friday', done: true }, { owner: 'Maya', task: 'Sign', due: null, done: false }], labels, ...over,
})

describe('the Confluence page', () => {
  it('is valid storage XHTML: details, the summary, tasks and a footer, everything escaped', () => {
    const b = storageBody(report())
    expect(b).toContain('<tr><th>Date</th><td>2026-11-21 09:05</td></tr>')
    expect(b).toContain('<tr><th>Length</th><td>30 min</td></tr>')
    expect(b).toContain('<td>Maya &amp; Co</td>')
    expect(b).toContain('<h2>Pricing</h2>')
    expect(b).toContain('<strong>the 2025 price</strong>')
    expect(b).not.toContain('<mine>')
    expect(b).toContain('<ac:task-status>complete</ac:task-status><ac:task-body><strong>You:</strong> Send the &lt;quote&gt; (Friday)</ac:task-body>')
    expect(b).toContain('<ac:task-status>incomplete</ac:task-status>')
    // every tag that opens closes
    const open = [...b.matchAll(/<([a-z:0-9]+)[\s>]/g)].map((m) => m[1]), close = [...b.matchAll(/<\/([a-z:0-9]+)>/g)].map((m) => m[1])
    expect(open.sort()).toEqual(close.sort())
    expect(pageTitle(report().meeting)).toBe('Acme renewal · 2026-11-21')
  })
  it('as Markdown for a server that only takes Markdown, with checkboxes', () => {
    expect(markdownBody(report())).toContain('- [x] **You:** Send the <quote> (Friday)')
  })
})

describe("Atlassian's tools, read from what the server lists", () => {
  const create: ToolInfo = { name: 'createConfluenceContent', inputSchema: { properties: { cloudId: {}, spaceId: {}, parentPageId: {}, title: {}, content: {}, bodyFormat: { enum: ['MARKDOWN', 'STORAGE'] } } } }
  it('renames arguments to the schema and picks the storage format', () => {
    expect(argsFor(create, { cloudId: 'c', spaceId: 's', parentId: 'p', title: 't', body: 'b', type: 'page' })).toEqual({ cloudId: 'c', spaceId: 's', parentPageId: 'p', title: 't', content: 'b' })
    expect(formatFor(create)).toEqual({ prop: 'bodyFormat', value: 'STORAGE' })
  })
  it('reaches a tool behind the executeWrite gateway', async () => {
    const calls: Array<[string, unknown]> = []
    const box = createToolbox([{ name: 'executeWrite', inputSchema: { properties: { toolName: {}, args: {} } } }], async (n, a) => { calls.push([n, a]); return {} })
    await box.call('create', { title: 'x' }, 'storage')
    expect(calls[0]).toEqual(['executeWrite', { toolName: 'createConfluenceContent', args: { title: 'x', contentFormat: 'storage' } }])
    expect(box.can('create')).toBe(true)
    expect(box.can('get')).toBe(false)
  })
  it('reads sites, spaces and pages from wrapped answers', () => {
    expect(sitesOf([{ id: 'c1', name: 'Acme', url: 'https://acme.atlassian.net' }])).toEqual([{ id: 'c1', name: 'Acme', url: 'https://acme.atlassian.net' }])
    expect(spacesOf({ results: [{ id: '9', key: '~a', name: 'Me', type: 'personal' }] })[0]).toMatchObject({ id: '9', key: '~a', type: 'personal' })
    expect(pagesOf({ data: { results: [{ id: '5', title: 'X', version: { number: 3 }, _links: { base: 'https://a/wiki', webui: '/p/5' } }] } })).toEqual([{ id: '5', title: 'X', version: 3, url: 'https://a/wiki/p/5' }])
    expect(() => toolJson({ isError: true, content: [{ type: 'text', text: 'nope' }] })).toThrow('nope')
  })
})

describe('sending a report', () => {
  const connect = async () => {
    fakeConfluence.pages.length = 0
    const c = await fakeAtlassianServer()(true)
    return createToolbox(c.tools, c.call)
  }
  it('creates "Meeting notes" once, then the page under it; sending again updates it', async () => {
    const box = await connect()
    const where = { cloudId: 'cloud-1', siteUrl: 'https://example.atlassian.net' }
    const first = await publishReport(box, report(), where)
    expect(first.created).toBe(true)
    const parent = fakeConfluence.pages.find((p) => p.title === 'Meeting notes')!
    const page = fakeConfluence.pages.find((p) => p.id === first.pageId)!
    expect(page).toMatchObject({ parentId: parent.id, spaceId: 'space-1', format: 'storage', title: 'Acme renewal · 2026-11-21' })
    expect(first.url).toContain(`/pages/${first.pageId}`)
    const again = await publishReport(box, report({ summary: '## New' }), { ...where, spaceId: first.spaceId, parentId: first.parentId }, { pageId: first.pageId })
    expect(again).toMatchObject({ created: false, pageId: first.pageId })
    expect(page.version).toBe(2)
    expect(page.body).toContain('<h2>New</h2>')
    expect(fakeConfluence.pages.filter((p) => p.title === 'Meeting notes')).toHaveLength(1)
  })
  it('makes the page again when it was deleted in Confluence, and gives a second meeting of the day its time', async () => {
    const box = await connect()
    const where = { cloudId: 'cloud-1', siteUrl: 'https://example.atlassian.net' }
    const a = await publishReport(box, report(), where)
    fakeConfluence.pages.splice(fakeConfluence.pages.findIndex((p) => p.id === a.pageId), 1)
    const b = await publishReport(box, report(), where, { pageId: a.pageId })
    expect(b.created).toBe(true)
    const c = await publishReport(box, report(), where)
    expect(fakeConfluence.pages.find((p) => p.id === c.pageId)!.title).toBe('Acme renewal · 2026-11-21 09:05')
  })
  it('says so when there is no personal space', async () => {
    const box = createToolbox([{ name: 'listConfluenceSpaces', inputSchema: { properties: { cloudId: {}, type: {} } } }], async () => ({ results: [{ id: '1', key: 'TEAM', type: 'global' }] }))
    await expect(personalSpace(box, 'c')).rejects.toMatchObject({ kind: 'no-space' })
  })
})

describe('signing in to Atlassian', () => {
  it('connects through the fake server, and keeps the sign-in for the next launch', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'atl-')), 'atlassian.json')
    const store = createOAuthStore({ file, seal: (s) => `x${s}`, open: (s) => s.slice(1) })
    const a = createAtlassian({ store, openExternal: () => {}, onChange: () => {}, siteId: () => undefined, connect: fakeAtlassianServer() })
    await a.signIn()
    expect(a.status()).toMatchObject({ state: 'connected', site: 'Example', account: 'You' })
    expect(a.current().accountId).toBe('acc-1')
    await a.signOut()
    expect(a.status().state).toBe('off')
  })
  it('keeps the registration and tokens sealed, and registers again for another port', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'atl-')), 'atlassian.json')
    const store = createOAuthStore({ file, seal: (s) => `x${s}`, open: (s) => s.slice(1) })
    const p = oauthProvider(store, { port: 4000, interactive: true, openExternal: () => {} })
    p.saveClientInformation!({ client_id: 'id1' })
    p.saveTokens({ access_token: 'a', token_type: 'bearer' })
    const again = createOAuthStore({ file, seal: (s) => `x${s}`, open: (s) => s.slice(1) })
    expect(oauthProvider(again, { port: 4000, interactive: false, openExternal: () => {} }).clientInformation()).toEqual({ client_id: 'id1' })
    expect(oauthProvider(again, { port: 4001, interactive: false, openExternal: () => {} }).clientInformation()).toBeUndefined()
    expect(() => oauthProvider(again, { port: 4000, interactive: false, openExternal: () => {} }).redirectToAuthorization(new URL('https://x'))).toThrow('Sign in')
  })
  it('takes the code from the browser only when the state matches', async () => {
    const good = await waitForCode({ port: 0, state: () => 'abc' })
    const res = await fetch(`http://127.0.0.1:${good.port}/oauth/callback?code=C1&state=abc`)
    expect(res.status).toBe(200)
    expect(await good.code).toBe('C1')
    const bad = await waitForCode({ port: 0, state: () => 'abc' })
    await fetch(`http://127.0.0.1:${bad.port}/oauth/callback?code=C2&state=evil`)
    await expect(bad.code).rejects.toThrow('state')
    const other = await waitForCode({ port: 0, state: () => 'abc' })
    expect((await fetch(`http://127.0.0.1:${other.port}/elsewhere`)).status).toBe(404)
    other.close()
  })
})
