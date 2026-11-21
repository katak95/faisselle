import yauzl from 'yauzl'
import type { Meeting } from '../store'
import { companyOf } from '../vocab'
import { TOOLS } from './tools'

/**
 * SharePoint and OneDrive documents related to a meeting, through Microsoft Search (the Softeria server's
 * search-query tool, read only): the hits with Microsoft's snippets, and the text of the most relevant few, so the
 * model knows the projects, names and figures a meeting is about. Never more than a few thousand characters each.
 */

/** a document as the brief lists it: Figolu builds these links, the model never writes them */
export type DocRef = { name: string; url: string; modified: string }
export type DocHit = DocRef & { id: string; driveId: string | null; by: string; snippet: string; size: number }

export const SEARCH_SIZE = 8
/** the documents read in full, most relevant first */
export const READ_DOCS = 3
const MAX_BYTES = 8 * 1024 * 1024
export const DOC_CHARS = 3000
export const DOCS_CHARS = 12_000

/** words in a title that say nothing about what a meeting is about */
const FILLER = new Set(['meeting', 'call', 'sync', 'weekly', 'daily', 'monthly', 'with', 'and', 'the', 'for', 'and', 'réunion', 'point', 'avec', 'pour', 'les', 'des', 'une', 'teams', 'zoom', 'meet', 'invitation', 'rdv', 'catch', 'up', 'chat', 'check', 'in', 'de', 'du', 'la', 'le', 'et'])

/** the search words for a meeting: its title's meaningful words and the companies of the people invited */
export function searchTerms(m: Pick<Meeting, 'title' | 'attendees'>): string[] {
  const words = (m.title ?? '').split(/[^\p{L}\p{N}&'-]+/u).map((w) => w.trim()).filter((w) => w.length > 2 && !FILLER.has(w.toLowerCase()) && !/^\d+$/.test(w))
  const companies = m.attendees.map((a) => (a.email ? companyOf(a.email) : null)).filter((c): c is string => !!c)
  return [...new Set([...companies, ...words])].slice(0, 8)
}

/** KQL for Microsoft Search: any of the terms, in documents changed this last year */
export function documentQuery(terms: string[], now = Date.now()): string | null {
  if (!terms.length) return null
  const since = new Date(now - 365 * 86_400_000).toISOString().slice(0, 10)
  return `(${terms.map((t) => (/\s/.test(t) ? `"${t.replace(/"/g, '')}"` : t.replace(/["():]/g, ''))).join(' OR ')}) AND LastModifiedTime>=${since}`
}

export const searchBody = (queryString: string) => ({
  requests: [{ entityTypes: ['driveItem', 'listItem'], query: { queryString }, from: 0, size: SEARCH_SIZE,
    fields: ['id', 'name', 'webUrl', 'lastModifiedDateTime', 'lastModifiedBy', 'size', 'parentReference', 'file', 'title'] }],
})

/** Microsoft's highlight markers out of a snippet: <c0>word</c0>, <ddd/> for a cut */
export const cleanSnippet = (s: string): string => s.replace(/<ddd\/>/g, '…').replace(/<\/?c\d+>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

/** search-query's answer: value[].hitsContainers[].hits[] with a resource each */
export function documentHits(v: unknown): DocHit[] {
  const out: DocHit[] = []
  const seen = new Set<string>()
  const value = (v as { value?: unknown })?.value
  for (const r of Array.isArray(value) ? value : []) {
    for (const c of (r as { hitsContainers?: unknown[] })?.hitsContainers ?? []) {
      for (const h of (c as { hits?: unknown[] })?.hits ?? []) {
        const hit = h as { hitId?: string; summary?: string; resource?: Record<string, unknown> }
        const res = hit.resource ?? {}
        const url = typeof res.webUrl === 'string' ? res.webUrl : ''
        const name = typeof res.name === 'string' ? res.name : typeof (res as { title?: unknown }).title === 'string' ? String(res.title) : ''
        if (!url || !name || seen.has(url)) continue
        seen.add(url)
        const parent = res.parentReference as { driveId?: string } | undefined
        const by = (res.lastModifiedBy as { user?: { displayName?: string } } | undefined)?.user?.displayName ?? ''
        out.push({ id: String(res.id ?? hit.hitId ?? ''), driveId: parent?.driveId ?? null, name, url, by,
          modified: typeof res.lastModifiedDateTime === 'string' ? res.lastModifiedDateTime.slice(0, 10) : '',
          snippet: cleanSnippet(hit.summary ?? ''), size: Number(res.size ?? 0) })
      }
    }
  }
  return out
}

const unescapeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
/** the text runs (<w:t>, <a:t>, <t>) of each paragraph, one line per paragraph */
const xmlText = (xml: string, tag: string, paragraph: string): string => {
  const run = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, 'g')
  return xml.split(`</${paragraph}>`).map((p) => [...p.matchAll(run)].map((m) => m[1]).join('')).filter((l) => l.trim()).map(unescapeXml).join('\n')
}

async function zipEntries(bytes: Buffer, want: (name: string) => boolean): Promise<Array<{ name: string; text: string }>> {
  const zip = await yauzl.fromBufferPromise(bytes, { lazyEntries: true })
  const out: Array<{ name: string; text: string }> = []
  for await (const entry of zip.eachEntry()) {
    if (!want(entry.fileName) || entry.uncompressedSize > 20 * 1024 * 1024) continue
    const chunks: Buffer[] = []
    for await (const c of await zip.openReadStreamPromise(entry)) chunks.push(c as Buffer)
    out.push({ name: entry.fileName, text: Buffer.concat(chunks).toString('utf8') })
  }
  return out
}

const slideNumber = (n: string) => Number(n.match(/(\d+)\.xml$/)?.[1] ?? 0)

/** a document's text, by its kind; '' for a kind Figolu can't read */
export async function extractText(bytes: Buffer, name: string): Promise<string> {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ''
  let text = ''
  if (ext === 'docx') {
    text = (await zipEntries(bytes, (n) => n === 'word/document.xml')).map((e) => xmlText(e.text, 'w:t', 'w:p')).join('\n')
  } else if (ext === 'pptx') {
    const slides = (await zipEntries(bytes, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))).sort((a, b) => slideNumber(a.name) - slideNumber(b.name))
    text = slides.map((s, i) => `Slide ${i + 1}: ${xmlText(s.text, 'a:t', 'a:p').replace(/\n+/g, ' ').trim()}`).join('\n')
  } else if (ext === 'xlsx') {
    // the sheets' text lives in the shared strings: enough to know what a workbook is about
    text = (await zipEntries(bytes, (n) => n === 'xl/sharedStrings.xml')).map((e) => xmlText(e.text, 't', 'si')).join('\n')
  } else if (ext === 'pdf') {
    const { extractText: pdfText } = await import('unpdf')
    const r = await pdfText(new Uint8Array(bytes), { mergePages: true })
    text = Array.isArray(r.text) ? r.text.join('\n') : r.text
  } else if (['txt', 'md', 'csv', 'json', 'html', 'htm'].includes(ext)) {
    text = bytes.toString('utf8')
    if (ext.startsWith('htm')) text = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ')
  }
  return text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim().slice(0, DOC_CHARS)
}

type Call = (name: string, args: Record<string, unknown>) => Promise<unknown>

/** the hits for a meeting, and the text of the most relevant few, as text for the model plus the links for the brief */
export async function relatedDocuments(call: Call, m: Pick<Meeting, 'title' | 'attendees'>, now = Date.now()): Promise<{ text: string; refs: DocRef[] }> {
  const q = documentQuery(searchTerms(m), now)
  if (!q) return { text: '', refs: [] }
  const hits = documentHits(await call(TOOLS.search, { body: searchBody(q) }))
  const texts = new Map<string, string>()
  for (const h of hits.filter((x) => x.driveId && x.id && x.size > 0 && x.size <= MAX_BYTES).slice(0, READ_DOCS)) {
    try {
      const v = await call(TOOLS.download, { target: `/drives/${encodeURIComponent(h.driveId!)}/items/${encodeURIComponent(h.id)}/content` }) as { contentBytes?: string }
      if (v?.contentBytes) texts.set(h.url, await extractText(Buffer.from(v.contentBytes, 'base64'), h.name))
    } catch (e) { console.warn('a related document could not be read', h.name, e) }
  }
  let text = ''
  for (const h of hits) {
    const body = [h.snippet, texts.get(h.url)].filter(Boolean).join('\n')
    const block = `<document title=${JSON.stringify(h.name)} url=${JSON.stringify(h.url)} modified=${JSON.stringify(h.modified)}${h.by ? ` by=${JSON.stringify(h.by)}` : ''}>\n${body}\n</document>`
    if (text.length + block.length > DOCS_CHARS) break
    text += (text ? '\n' : '') + block
  }
  return { text, refs: hits.map(({ name, url, modified }) => ({ name, url, modified })) }
}
