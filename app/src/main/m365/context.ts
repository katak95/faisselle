import type { CalendarLinkSource } from '../calendar'
import type { CalendarSource } from '../calendar'
import type { Meeting } from '../store'
import type { M365 } from './client'
import { eventsOf, mailTexts, messageIds, participantsQuery, plainText, TOOLS } from './tools'
import { relatedDocuments, type DocRef } from './documents'

/** what one meeting's context may hold: enough to understand it, never the whole mailbox */
const INVITE_CHARS = 2000
const MAIL_CHARS = 1500
const MAILS = 8
const CONTEXT_CHARS = 14_000
/** the calendar is read at most this often; a meeting's context is kept this long (the notes, actions and email read it in turn) */
const EVENTS_MS = 5 * 60_000
const CONTEXT_MS = 10 * 60_000

const OUTLOOK: CalendarSource = { id: 'm365', name: 'Outlook', source: 'Microsoft 365' }

/**
 * Microsoft 365 as Figolu uses it: the Outlook calendar beside the others (calendar.ts reads it like a calendar
 * link), and for one meeting its invite, the recent emails with the people in it and (when turned on) related
 * SharePoint and OneDrive documents, as text for the model.
 */
export function createM365Context(o: { m365: M365; calendarOn(): boolean; account(): string | null; /** SharePoint and OneDrive search is on */ documentsOn(): boolean }) {
  let events: { from: number; to: number; at: number; raw: unknown[] } | undefined
  const contexts = new Map<string, { at: number; value: unknown }>()

  const calendar: CalendarLinkSource = {
    status: () => (o.calendarOn() && o.m365.connected() ? 'granted' : 'notDetermined'),
    calendars: async () => (o.calendarOn() && o.m365.connected() ? [OUTLOOK] : []),
    async events(fromMs, toMs, unavailable, hidden) {
      if (!o.calendarOn() || !o.m365.connected() || hidden?.includes(OUTLOOK.id)) return []
      if (events && events.from <= fromMs && events.to >= toMs && Date.now() - events.at < EVENTS_MS) return events.raw
      try {
        const v = await o.m365.call(TOOLS.calendarView, {
          startDateTime: new Date(fromMs).toISOString(), endDateTime: new Date(toMs).toISOString(), $top: 200,
          $select: 'id,iCalUId,subject,start,end,attendees,location,onlineMeeting,onlineMeetingUrl,bodyPreview,isCancelled,responseStatus',
        })
        const raw = eventsOf(v, o.account())
        events = { from: fromMs, to: toMs, at: Date.now(), raw }
        return raw
      } catch (e) {
        console.warn('the Outlook calendar could not be read', e)
        unavailable?.push('Outlook')
        return events?.raw ?? []
      }
    },
  }

  type M = Pick<Meeting, 'id' | 'eventId' | 'attendees' | 'ownEmail' | 'title'>
  /** the invite's description (Outlook events only) and recent emails with the people invited */
  async function readMail(m: M): Promise<string> {
    const parts: string[] = []
    if (m.eventId?.startsWith('m365:')) {
      try {
        const v = await o.m365.call(TOOLS.event, { 'event-id': m.eventId.slice(5), $select: 'subject,body,bodyPreview' }) as { body?: { content?: string; contentType?: string }; bodyPreview?: string }
        const body = v?.body?.content ? (v.body.contentType === 'html' ? plainText(v.body.content) : v.body.content.trim()) : v?.bodyPreview ?? ''
        if (body) parts.push(`<invite>\n${body.slice(0, INVITE_CHARS)}\n</invite>`)
      } catch (e) { console.warn('the invite could not be read', e) }
    }
    const own = (m.ownEmail ?? o.account() ?? '').toLowerCase()
    const emails = [...new Set(m.attendees.map((a) => a.email?.toLowerCase()).filter((e): e is string => !!e && e !== own))]
    if (emails.length) {
      try {
        const ids = messageIds(await o.m365.call(TOOLS.listMail, { $search: `"${participantsQuery(emails)}"`, $top: MAILS, $select: 'id' }))
        if (ids.length) {
          const mails = mailTexts(await o.m365.call(TOOLS.readMail, { messageIds: ids.slice(0, MAILS), maxChars: MAIL_CHARS }))
          for (const x of mails) parts.push(`<email from=${JSON.stringify(x.from)} to=${JSON.stringify(x.to)} date=${JSON.stringify(x.received.slice(0, 10))} subject=${JSON.stringify(x.subject)}>\n${x.text}\n</email>`)
        }
      } catch (e) { console.warn('related emails could not be read', e) }
    }
    let out = ''
    for (const p of parts) { if (out.length + p.length > CONTEXT_CHARS) break; out += (out ? '\n' : '') + p }
    return out
  }

  /** SharePoint and OneDrive documents (documents.ts), when that search is on */
  async function readDocuments(m: M): Promise<{ text: string; refs: DocRef[] }> {
    try {
      const r = await relatedDocuments((name, args) => o.m365.call(name, args), m)
      o.m365.documentsAnswered()
      return r
    } catch (e) {
      console.warn('related documents could not be searched', e)
      o.m365.documentsAnswered(e)
      return { text: '', refs: [] }
    }
  }

  /** each part kept a few minutes, so the notes, the action items, the email and Ask read it once */
  const cached = async <T>(key: string, read: () => Promise<T>): Promise<T> => {
    const c = contexts.get(key)
    if (c && Date.now() - c.at < CONTEXT_MS) return c.value as T
    const value = await read()
    contexts.set(key, { at: Date.now(), value })
    return value
  }

  return {
    calendar,
    /**
     * A meeting's context as text for the model: the invite and related emails, and with documents the related
     * SharePoint and OneDrive documents too (when that search is on), with their links for the brief.
     */
    async meetingContext(m: M, opts: { documents?: boolean } = {}): Promise<MeetingContext | undefined> {
      if (!o.m365.connected()) return undefined
      const mail = await cached(`${m.id}:mail`, () => readMail(m))
      const docs = opts.documents && o.documentsOn() ? await cached(`${m.id}:docs`, () => readDocuments(m)) : { text: '', refs: [] }
      const text = [mail, docs.text].filter(Boolean).join('\n')
      return text ? { text, documents: docs.refs } : undefined
    },
    forget() { events = undefined; contexts.clear() },
  }
}

/** what Microsoft 365 knows about one meeting: text for the model, and the documents' links for the brief */
export type MeetingContext = { text: string; documents: DocRef[] }

/** two calendar sources as one: what either has, connected when either is */
export function bothSources(a: CalendarLinkSource | null, b: CalendarLinkSource): CalendarLinkSource {
  if (!a) return b
  return {
    status: () => (a.status() === 'granted' || b.status() === 'granted' ? 'granted' : 'notDetermined'),
    calendars: async () => [...(await a.calendars()), ...(await b.calendars())],
    events: async (from, to, unavailable, hidden) => [...(await a.events(from, to, unavailable, hidden)), ...(await b.events(from, to, unavailable, hidden))],
  }
}
