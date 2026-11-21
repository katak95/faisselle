import type { Meeting } from '../store'
import type { ActionItem } from '../../shared/actions'
import { toClipboard } from '../../shared/exportNotes'
import { formatFor, pagesOf, spacesOf, type Toolbox } from './tools'

/**
 * A meeting's report as a Confluence page in the person's personal space, under "Meeting notes": its details, the
 * summary and the action items as Confluence tasks. Sent again, the same page is updated, never copied.
 */

export const PARENT_TITLE = 'Meeting notes'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const pad = (n: number) => String(n).padStart(2, '0')
const day = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const time = (ms: number) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }

export type Report = { meeting: Pick<Meeting, 'title' | 'startedAt' | 'endedAt' | 'durationMs' | 'attendees'>; summary: string; actions: ActionItem[]; labels: ReportLabels }
/** the words on the page, in the interface's language */
export type ReportLabels = { date: string; length: string; people: string; actions: string; footer: string; minutes: (n: number) => string }

export const pageTitle = (m: Pick<Meeting, 'title' | 'startedAt'>) => `${(m.title || 'Meeting').trim().slice(0, 200)} · ${day(m.startedAt)}`

const minutesOf = (m: Report['meeting']) => {
  const ms = m.durationMs ?? (m.endedAt ? m.endedAt - m.startedAt : null)
  return ms && ms > 0 ? Math.max(1, Math.round(ms / 60_000)) : null
}

/** the page in Confluence's storage format (its XHTML): a details table, the summary, the tasks, a short footer */
export function storageBody(r: Report): string {
  const mins = minutesOf(r.meeting)
  const people = r.meeting.attendees.map((a) => a.name || a.email).filter(Boolean).join(', ')
  const row = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`
  const details = `<table><tbody>${row(r.labels.date, `${day(r.meeting.startedAt)} ${time(r.meeting.startedAt)}`)}${mins ? row(r.labels.length, r.labels.minutes(mins)) : ''}${people ? row(r.labels.people, people) : ''}</tbody></table>`
  // the summary's own marks for the person's lines (<mine>) are Yogurt's, not Confluence's
  const summary = toClipboard(r.summary.replace(/<\/?mine>/g, '')).html
  const tasks = r.actions.length ? `<h2>${esc(r.labels.actions)}</h2><ac:task-list>${r.actions.map((a, i) =>
    `<ac:task><ac:task-id>${i + 1}</ac:task-id><ac:task-status>${a.done ? 'complete' : 'incomplete'}</ac:task-status><ac:task-body><strong>${esc(a.owner)}:</strong> ${esc(a.task)}${a.due ? ` (${esc(a.due)})` : ''}</ac:task-body></ac:task>`).join('')}</ac:task-list>` : ''
  return `${details}${summary}${tasks}<p><sub>${esc(r.labels.footer)}</sub></p>`
}

/** the same page as Markdown, for a server that only takes Markdown (the tasks as checkboxes) */
export function markdownBody(r: Report): string {
  const mins = minutesOf(r.meeting)
  const people = r.meeting.attendees.map((a) => a.name || a.email).filter(Boolean).join(', ')
  return [
    `| | |`, `|---|---|`, `| **${r.labels.date}** | ${day(r.meeting.startedAt)} ${time(r.meeting.startedAt)} |`,
    ...(mins ? [`| **${r.labels.length}** | ${r.labels.minutes(mins)} |`] : []), ...(people ? [`| **${r.labels.people}** | ${people} |`] : []), '',
    r.summary.replace(/<\/?mine>/g, '').trim(), '',
    ...(r.actions.length ? [`## ${r.labels.actions}`, ...r.actions.map((a) => `- [${a.done ? 'x' : ' '}] **${a.owner}:** ${a.task}${a.due ? ` (${a.due})` : ''}`), ''] : []),
    `_${r.labels.footer}_`,
  ].join('\n')
}

export type Where = { cloudId: string; siteUrl: string; spaceId?: string; spaceKey?: string; parentId?: string }
export type Published = { pageId: string; url: string; spaceId: string; spaceKey?: string; parentId: string; created: boolean }

export class PublishError extends Error {
  name = 'PublishError'
  constructor(message: string, readonly kind: 'no-space' | 'denied' | 'missing-tool' | 'other') { super(message) }
}

const denied = (e: unknown) => /\b(401|403)\b|forbidden|permission|not permitted|unauthori[sz]ed/i.test(e instanceof Error ? e.message : String(e))
const notFound = (e: unknown) => /\b404\b|not found|does not exist|no content/i.test(e instanceof Error ? e.message : String(e))
const titleTaken = (e: unknown) => /title.*(exist|already|taken|unique)|(exist|already).*title/i.test(e instanceof Error ? e.message : String(e))

/** the person's own space: the tool for it when there is one, else the personal one among the spaces */
export async function personalSpace(box: Toolbox, cloudId: string, accountId?: string): Promise<{ id: string; key: string; url?: string }> {
  if (box.offers('personalSpace')) {
    const [s] = spacesOf(await box.call('personalSpace', { cloudId }))
    if (s) return s
  }
  if (box.can('spaces')) {
    const all = spacesOf(await box.call('spaces', { cloudId, spaceType: 'personal', limit: 250 }))
    const mine = all.find((s) => s.type === 'personal' && (!accountId || s.key === `~${accountId}`)) ?? all.find((s) => s.type === 'personal' || s.key.startsWith('~'))
    if (mine) return mine
  }
  throw new PublishError('No personal space was found: create yours once in Confluence (Profile → Personal space)', 'no-space')
}

/** "Meeting notes" in the space: found by its title, or made (once) */
export async function parentPage(box: Toolbox, w: { cloudId: string; spaceId: string; spaceKey?: string }, body: { format: 'storage' | 'markdown' }): Promise<string> {
  const match = (v: unknown) => pagesOf(v).find((p) => p.title.trim().toLowerCase() === PARENT_TITLE.toLowerCase())
  if (box.can('list')) {
    const found = match(await box.call('list', { cloudId: w.cloudId, spaceId: w.spaceId, type: 'page', limit: 250 }).catch(() => undefined))
    if (found) return found.id
  }
  if (box.can('search')) {
    const cql = `type = page AND title = "${PARENT_TITLE}" AND space${w.spaceKey ? ` = "${w.spaceKey}"` : `.id = ${w.spaceId}`}`
    const found = match(await box.call('search', { cloudId: w.cloudId, cql, limit: 10 }).catch(() => undefined))
    if (found) return found.id
  }
  const intro = body.format === 'markdown' ? 'Meeting reports sent from Yogurt.' : '<p>Meeting reports sent from Yogurt.</p>'
  const [made] = pagesOf(await box.call('create', { cloudId: w.cloudId, spaceId: w.spaceId, title: PARENT_TITLE, body: intro, type: 'page' }, body.format))
  if (!made) throw new PublishError('Confluence did not create the "Meeting notes" page', 'other')
  return made.id
}

/** the version to send an update with: what the tool's schema asks for (a number, or { number }) */
function versionArg(box: Toolbox, next: number): unknown {
  const tool = box.tool('update')
  const prop = tool && Object.entries(tool.inputSchema?.properties ?? {}).find(([k]) => /^(version|versionNumber|currentVersion)$/.test(k))
  if (!prop) return undefined
  const type = prop[1].type
  return type === 'object' || (Array.isArray(type) && type.includes('object')) ? { number: next, message: 'Updated by Yogurt' } : next
}

/**
 * Sends the report: creates its page under "Meeting notes", or updates the page it was sent to before (one deleted
 * in Confluence meanwhile is created again). where: the site, and the space and parent found last time if any.
 */
export async function publishReport(box: Toolbox, r: Report, where: Where & { accountId?: string }, previous?: { pageId: string }): Promise<Published> {
  for (const need of ['create', 'update'] as const) if (!box.can(need)) throw new PublishError(`Atlassian's MCP server can't ${need} pages here`, 'missing-tool')
  // storage keeps the tasks as Confluence tasks; only a server that takes nothing but Markdown gets Markdown
  const create = box.tool('create')
  const format = create && formatFor(create)?.value.toLowerCase() === 'markdown' ? 'markdown' as const : 'storage' as const
  try {
    const space = where.spaceId ? { id: where.spaceId, key: where.spaceKey ?? '' } : await personalSpace(box, where.cloudId, where.accountId)
    const parentId = where.parentId ?? await parentPage(box, { cloudId: where.cloudId, spaceId: space.id, spaceKey: space.key || undefined }, { format })
    const body = format === 'markdown' ? markdownBody(r) : storageBody(r)
    let title = pageTitle(r.meeting)
    const link = (id: string, url?: string) => url ?? `${where.siteUrl.replace(/\/$/, '')}/wiki/pages/viewpage.action?pageId=${encodeURIComponent(id)}`

    if (previous) {
      const current = await box.call('get', { cloudId: where.cloudId, pageId: previous.pageId }).then((v) => pagesOf(v)[0], (e) => { if (notFound(e)) return undefined; throw e })
      if (current) {
        const v = await box.call('update', { cloudId: where.cloudId, pageId: previous.pageId, title, body, type: 'page', version: versionArg(box, (current.version ?? 1) + 1), message: 'Updated by Yogurt', spaceId: space.id, parentId }, format)
        const page = pagesOf(v)[0]
        return { pageId: previous.pageId, url: link(previous.pageId, page?.url ?? current.url), spaceId: space.id, spaceKey: space.key || undefined, parentId, created: false }
      }
    }
    const make = () => box.call('create', { cloudId: where.cloudId, spaceId: space.id, parentId, title, body, type: 'page' }, format)
    // two meetings with the same title on one day: a title is unique in a space, so the second gets its time
    const v = await make().catch((e) => { if (!titleTaken(e)) throw e; title = `${title} ${time(r.meeting.startedAt)}`; return make() })
    const [page] = pagesOf(v)
    if (!page) throw new PublishError('Confluence did not say which page it created', 'other')
    return { pageId: page.id, url: link(page.id, page.url), spaceId: space.id, spaceKey: space.key || undefined, parentId, created: true }
  } catch (e) {
    if (e instanceof PublishError) throw e
    if (denied(e)) throw new PublishError('Confluence refused: you may not write in this space', 'denied')
    throw e
  }
}
