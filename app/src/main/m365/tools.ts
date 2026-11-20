import type { RawEvent } from '../calendarLink/ics'

/**
 * Microsoft 365 through the Softeria ms-365-mcp-server, read only: the names of its tools and the shapes of their
 * answers in one place, so a new version of the server changes only this file.
 * Only these tools are turned on (and the server runs with --read-only): nothing can be sent, changed or deleted.
 */
export const TOOLS = { login: 'login', verify: 'verify-login', logout: 'logout', calendarView: 'get-calendar-view', event: 'get-calendar-event', listMail: 'list-mail-messages', readMail: 'read-mail-text' } as const
export const ENABLED_TOOLS = `^(${Object.values(TOOLS).join('|')})$`

/** a tool call's answer, as the server gives it: one text block holding JSON */
export type CallTool = (name: string, args: Record<string, unknown>) => Promise<unknown>

export function toolJson(result: unknown): unknown {
  const r = result as { content?: Array<{ type?: string; text?: string }>; isError?: boolean } | undefined
  const text = r?.content?.find((c) => c.type === 'text')?.text ?? ''
  let v: unknown
  try { v = JSON.parse(text) } catch { v = text }
  if (r?.isError) throw new Error(typeof v === 'string' ? v : JSON.stringify(v).slice(0, 300))
  if (v && typeof v === 'object' && 'error' in (v as object) && !(v as { value?: unknown }).value) {
    const e = (v as { error: unknown }).error
    if (e !== 'device_code_required') throw new Error(typeof e === 'string' ? e : JSON.stringify(e).slice(0, 300))
  }
  return v
}

/** "To sign in, use a web browser to open the page https://microsoft.com/devicelogin and enter the code ABCD1234 to authenticate." */
export function deviceCode(message: string): { url: string; code: string } | null {
  const url = message.match(/https:\/\/[^\s"']+/)?.[0]
  const code = message.match(/\bcode\s+([A-Z0-9-]{6,})\b/i)?.[1]
  return url && code ? { url: url.replace(/[.,)]+$/, ''), code } : null
}

const list = (v: unknown): Record<string, unknown>[] => {
  if (Array.isArray(v)) return v as Record<string, unknown>[]
  const value = (v as { value?: unknown })?.value
  return Array.isArray(value) ? value as Record<string, unknown>[] : []
}
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
/** Graph gives dateTime with a timeZone beside it; asked for UTC, so it is read as UTC */
const utc = (v: unknown): string => {
  const d = s((v as { dateTime?: unknown })?.dateTime)
  return d ? new Date(/[zZ]|[+-]\d\d:\d\d$/.test(d) ? d : `${d}Z`).toISOString() : ''
}

/** HTML to plain text, good enough for an invite's description */
export const plainText = (html: string): string => html
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim()

/** the user's events between two times, as calendar.ts reads them (the Mac helper's shape) */
export function eventsOf(v: unknown, me: string | null): RawEvent[] {
  return list(v).flatMap((e) => {
    const id = s(e.id)
    if (!id || e.isCancelled === true) return []
    const attendees = (Array.isArray(e.attendees) ? e.attendees as Array<Record<string, unknown>> : []).map((a) => {
      const addr = a.emailAddress as { name?: unknown; address?: unknown } | undefined
      return { name: s(addr?.name), email: s(addr?.address) }
    }).filter((a) => !me || a.email?.toLowerCase() !== me.toLowerCase())
    const online = (e.onlineMeeting as { joinUrl?: unknown } | undefined)?.joinUrl
    const response = (e.responseStatus as { response?: unknown } | undefined)?.response
    return [{
      id: `m365:${id}`, externalId: s(e.iCalUId) ?? `m365:${id}`, title: s(e.subject) ?? '', start: utc(e.start), end: utc(e.end), attendees,
      url: s(online) ?? s(e.onlineMeetingUrl), location: s((e.location as { displayName?: unknown } | undefined)?.displayName),
      notes: s(e.bodyPreview), calendarId: 'm365', calendar: 'Outlook', calendarSource: 'Microsoft 365', me, ...(response === 'declined' ? { declined: true } : {}),
    }]
  })
}

/** ids of the messages a search found, newest first as the server gives them */
export const messageIds = (v: unknown): string[] => list(v).map((m) => s(m.id)).filter((x): x is string => !!x)

export type MailText = { from: string; to: string; subject: string; received: string; text: string }
/** read-mail-text's answer: [{ from, to, subject, received, text }] (text already without quoted replies) */
export function mailTexts(v: unknown): MailText[] {
  const items = Array.isArray(v) ? v : list(v)
  return (items as Array<Record<string, unknown>>).flatMap((m) => {
    if (!m || typeof m !== 'object' || m.error) return []
    const who = (x: unknown): string => (Array.isArray(x) ? x.map(who).join(', ') : typeof x === 'string' ? x : s((x as { name?: unknown })?.name) ?? s((x as { address?: unknown })?.address) ?? '')
    const text = s(m.text) ?? ''
    return text ? [{ from: who(m.from), to: who(m.to), subject: s(m.subject) ?? '', received: s(m.received) ?? '', text }] : []
  })
}

/** KQL that finds mail with any of these people, for list-mail-messages */
export const participantsQuery = (emails: string[]): string => emails.slice(0, 8).map((e) => `participants:${e.replace(/["\s]/g, '')}`).join(' OR ')
