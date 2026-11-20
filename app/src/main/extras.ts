import { ipcMain } from 'electron'
import type { Meeting, Store } from './store'
import type { NotesModel } from './notes/model'
import type { Queue } from './notes/queue'
import type { ExtrasKind, ExtrasView, FollowUp } from '../shared/types'
import { actionsMarkdown, cleanActions, keepTicks, parseActions, type ActionItem } from '../shared/actions'
import { ACTIONS_SCHEMA, actionsPrompt } from './notes/actions'
import { contextIntro, languageName, tidyNotes, type Llm } from './notes/enhance'
import { isBuiltIn, isCustomId } from '../shared/templates'
import { isId } from './ipcArgs'
import { LOCALES } from '../shared/i18n'
import type { DocRef } from './m365/documents'
import type { MeetingContext } from './m365/context'

/**
 * What is written beside a meeting's notes, on request: the follow-up email (from the notes and action items), the
 * brief before a meeting (from the invite, earlier meetings with the same people and related emails), and the action
 * items again. Each goes through the one model queue, streamed to the note, then saved with the meeting.
 */

/** the most of an earlier meeting's notes a brief reads */
const EARLIER_NOTES_CHARS = 3500
const EARLIER_MEETINGS = 4
const FOLLOWUP_SCHEMA: Record<string, unknown> = { type: 'object', properties: { subject: { type: 'string' }, body: { type: 'string' } }, required: ['subject', 'body'], additionalProperties: false }

const people = (m: Pick<Meeting, 'attendees'>) => m.attendees.map((a) => a.email ? `${a.name || a.email} <${a.email}>` : a.name).filter(Boolean).join(', ') || 'not known'
const day = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ')

export function followUpPrompt(i: { meeting: Pick<Meeting, 'title' | 'attendees'>; notes: string; actions: ActionItem[]; me: string; language: string; context?: string }): string {
  return [
    'Here are the notes of a meeting that just ended ("You" is the person they are for):',
    '<notes>', i.notes, '</notes>',
    ...(i.actions.length ? ['Action items:', actionsMarkdown(i.actions)] : []),
    ...(i.context ? [contextIntro, '<context>', i.context, '</context>'] : []),
    '',
    `Meeting: ${i.meeting.title || 'Untitled'}`,
    `People invited: ${people(i.meeting)}.`,
    '',
    `Write the follow-up email that "You"${i.me ? ` (${i.me})` : ''} will send to the others after this meeting, in ${i.language || 'the language of the notes'}:`,
    '- A short subject saying what the meeting was about.',
    '- A greeting, one or two sentences thanking them and saying what the meeting was for, then what was decided and the next steps with who does what and by when, as short bullet lines starting with "- ".',
    '- Plain text, no Markdown other than those "- " lines. Friendly and professional, short: under about 200 words. End with a sign-off and the sender\'s first name if known.',
    '- Only what is in the notes. Never make anything up, and leave out anything private or off topic.',
    'Answer with only this JSON: {"subject":"…","body":"…"}',
  ].join('\n')
}

export function briefPrompt(i: { meeting: Pick<Meeting, 'title' | 'attendees'>; startsAt: number | null; earlier: Array<{ title: string; at: number; notes: string; open: ActionItem[] }>; context?: string; me: string; language: string
  /** related documents were found: the brief ends with their heading, and Yogurt adds the links */
  documents?: boolean }): string {
  return [
    `You will prepare "You"${i.me ? ` (${i.me})` : ''} for an upcoming meeting.`,
    '',
    `Meeting: ${i.meeting.title || 'Untitled'}${i.startsAt ? `, on ${day(i.startsAt)}` : ''}`,
    `People invited: ${people(i.meeting)}.`,
    '',
    ...(i.earlier.length ? ['Earlier meetings with some of the same people, latest first:', ...i.earlier.flatMap((e) => [
      `<meeting title=${JSON.stringify(e.title)} date="${day(e.at)}">`, e.notes,
      ...(e.open.length ? ['Action items still open:', actionsMarkdown(e.open)] : []), '</meeting>'])] : ['There are no earlier meetings with these people in Yogurt.']),
    '',
    ...(i.context ? [contextIntro, '<context>', i.context, '</context>', ''] : []),
    `Write a short brief in ${i.language || 'English'}, in Markdown, starting right away with the first "## " heading:`,
    '- "## Purpose": what this meeting is likely about and what "You" should get out of it, in two or three bullets.',
    '- "## People": one bullet per person invited (not "You"): who they are and what matters about them here, only from what is known.',
    '- "## History": what was said and decided before with these people, most recent first.',
    '- "## Open points": promises and questions still open, who owes what.',
    '- "## Questions to ask": three to five useful questions or points to raise.',
    '- Headings in the brief\'s language. "- " bullets of up to about 20 words. Leave out a section with nothing to put in it, except "## Questions to ask".',
    '- Only what the earlier meetings, the invite, the emails and the documents say. Never make anything up; if little is known, say so in one bullet.',
    ...(i.documents ? ['- Where a document matters, say which one by its title and why, in the sections above. Last, write only the heading "## Related documents" in the brief\'s language, with nothing under it: the links are added after.'] : []),
  ].join('\n')
}

/**
 * The brief with the documents' links under its last heading: the one the model wrote for them ("## Related
 * documents", in the brief's language), or an English one when it left it out.
 */
export function withDocumentLinks(md: string, docs: DocRef[]): string {
  if (!docs.length) return md
  const esc = (s: string) => s.replace(/([\[\]])/g, '\\$1')
  const href = (u: string) => { let v = u; try { v = encodeURI(decodeURI(u)) } catch { v = encodeURI(u) } return v.replace(/\(/g, '%28').replace(/\)/g, '%29') }
  const links = docs.filter((x) => /^https:\/\//.test(x.url)).map((x) => `- [${esc(x.name)}](${href(x.url)})${x.modified ? ` · ${x.modified}` : ''}`).join('\n')
  if (!links) return md
  const lines = md.trimEnd().split('\n')
  const last = lines.at(-1) ?? ''
  if (/^## /.test(last)) return `${lines.join('\n')}\n${links}`
  return `${md.trimEnd()}\n## Related documents\n${links}`
}

const actionsFromNotesPrompt = (notes: string) => ['Here are the notes of a meeting:', '<notes>', notes, '</notes>', '', actionsPrompt()].join('\n')

export function parseFollowUp(raw: string): FollowUp | null {
  const text = raw.trim()
  const start = text.indexOf('{'), end = text.lastIndexOf('}')
  try {
    const v = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text) as Record<string, unknown>
    const subject = typeof v.subject === 'string' ? v.subject.trim().slice(0, 300) : ''
    const body = typeof v.body === 'string' ? v.body.trim().slice(0, 20_000) : ''
    return body ? { subject, body } : null
  } catch { return null }
}

/**
 * The body as it streams in: the JSON answer's "body" so far, unescaped, so the person reads the email being
 * written rather than the JSON around it.
 */
export function bodySoFar(raw: string): string {
  const at = raw.search(/"body"\s*:\s*"/)
  if (at < 0) return ''
  const rest = raw.slice(raw.indexOf('"', raw.indexOf(':', at)) + 1)
  let out = ''
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i]
    if (c === '"') break
    if (c === '\\') {
      const n = rest[++i]
      if (n === undefined) break
      out += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'u' ? (rest.length >= i + 5 ? String.fromCharCode(parseInt(rest.slice(i + 1, i + 5), 16)) : '') : n
      if (n === 'u') i += 4
    } else out += c
  }
  return out
}

export function hookExtras(d: {
  store: Pick<Store, 'meeting' | 'notes' | 'extras' | 'setExtras' | 'meetingsWith'>
  queue: Pick<Queue, 'enqueue'>
  model: Pick<NotesModel, 'llm'>
  send(v: ExtrasView): void
  me(): string
  /** a locale from Settings, or '' for the meeting's own language */
  summaryLanguage(): string
  /** the language most of the meeting was in */
  language(id: string): string | null
  /** the meeting's invite and related emails, when Microsoft 365 is connected and the meeting allows it */
  context(id: string, o: { documents: boolean }): Promise<MeetingContext | undefined>
  contextAvailable(): boolean
  /** "Write again" with this template */
  rewrite(id: string): void
}) {
  const live = new Map<string, { writing?: ExtrasView['writing']; failed?: ExtrasView['failed'] }>()
  const view = (id: string): ExtrasView => ({ meetingId: id, ...d.store.extras(id), ...live.get(id), contextAvailable: d.contextAvailable() })
  const push = (id: string) => d.send(view(id))
  const langOf = (id: string) => {
    const set = LOCALES.find((l) => l.id === d.summaryLanguage())?.english
    return set || languageName(d.store.meeting(id)?.language ?? d.language(id))
  }

  const run = (id: string, kind: ExtrasKind, write: (llm: Llm, signal: AbortSignal, onToken: (t: string) => void) => Promise<void>) => {
    const s = live.get(id)
    if (s?.writing) return
    live.set(id, { writing: { kind, draft: '' } })
    push(id)
    void d.queue.enqueue(async (signal) => {
      const llm = await d.model.llm(signal)
      let last = 0
      await write(llm, signal, (t) => {
        const w = live.get(id)?.writing
        if (!w || signal.aborted) return
        w.draft += t
        if (Date.now() - last > 60) { last = Date.now(); push(id) }
      })
      live.delete(id)
      push(id)
    }, 'chat', id).catch((e) => {
      console.error(`writing the ${kind} failed`, id, e)
      live.set(id, { failed: { kind, message: e instanceof Error ? e.message : String(e) } })
      push(id)
    })
  }

  const followup = (id: string) => run(id, 'followup', async (llm, signal, onToken) => {
    const m = d.store.meeting(id), notes = d.store.notes(id).enhanced
    if (!m || !notes) throw new Error('No notes yet')
    // the invite and emails only: the person chose to leave documents out of the email
    const context = (await d.context(id, { documents: false }).catch(() => undefined))?.text
    let raw = ''
    const out = await llm.chat(followUpPrompt({ meeting: m, notes, actions: d.store.extras(id).actions ?? [], me: d.me(), language: langOf(id), context }), (t) => {
      const before = bodySoFar(raw); raw += t; const after = bodySoFar(raw)
      if (after.length > before.length) onToken(after.slice(before.length))
    }, { maxTokens: 1500, json: FOLLOWUP_SCHEMA })
    if (signal.aborted) return
    const f = parseFollowUp(out)
    if (!f) throw new Error('The model did not write an email')
    d.store.setExtras(id, { followup: f, followupAt: Date.now() })
  })

  const brief = (id: string) => run(id, 'brief', async (llm, signal, onToken) => {
    const m = d.store.meeting(id)
    if (!m) throw new Error('No meeting')
    const startsAt = m.eventStartedAt ?? m.startedAt
    const emails = m.attendees.map((a) => a.email).filter((e): e is string => !!e && e.toLowerCase() !== m.ownEmail?.toLowerCase())
    const earlier = d.store.meetingsWith(emails, Math.min(startsAt, m.startedAt), EARLIER_MEETINGS).filter((x) => x.id !== id).map((x) => ({
      title: x.title, at: x.startedAt, notes: (d.store.notes(x.id).enhanced ?? d.store.notes(x.id).mine).slice(0, EARLIER_NOTES_CHARS),
      open: (d.store.extras(x.id).actions ?? []).filter((a) => !a.done),
    }))
    const ctx = await d.context(id, { documents: true }).catch(() => undefined)
    const docs = ctx?.documents ?? []
    const md = tidyNotes(await llm.chat(briefPrompt({ meeting: m, startsAt, earlier, context: ctx?.text, me: d.me(), language: langOf(id), documents: docs.length > 0 }), onToken, { maxTokens: 1800 }))
    if (signal.aborted) return
    if (!md) throw new Error('The model did not write a brief')
    // the links come from the search itself, never from the model: none can be made up
    d.store.setExtras(id, { brief: withDocumentLinks(md, docs), briefAt: Date.now() })
  })

  const actions = (id: string) => run(id, 'actions', async (llm, signal) => {
    const notes = d.store.notes(id).enhanced
    if (!notes) throw new Error('No notes yet')
    const items = parseActions(await llm.chat(actionsFromNotesPrompt(notes), () => {}, { maxTokens: 1500, json: ACTIONS_SCHEMA }))
    if (signal.aborted) return
    if (!items) throw new Error('The model did not give a list')
    d.store.setExtras(id, { actions: keepTicks(items, d.store.extras(id).actions ?? []) })
  })

  const known = (id: unknown): id is string => isId(id) && !!d.store.meeting(id)
  ipcMain.handle('extras:get', (_e, id: unknown) => (known(id) ? view(id) : null))
  ipcMain.handle('extras:write', (_e, id: unknown, kind: unknown) => {
    if (!known(id)) return
    if (kind === 'followup') followup(id); else if (kind === 'brief') brief(id); else if (kind === 'actions') actions(id)
  })
  // the person ticks, edits, adds or removes items: the whole list each time
  ipcMain.handle('extras:set-actions', (_e, id: unknown, items: unknown) => {
    if (!known(id) || !Array.isArray(items)) return
    d.store.setExtras(id, { actions: cleanActions(items) }); push(id)
  })
  ipcMain.handle('extras:set-followup', (_e, id: unknown, f: unknown) => {
    if (!known(id) || !f || typeof f !== 'object') return
    const r = f as Record<string, unknown>
    if (typeof r.subject !== 'string' || typeof r.body !== 'string') return
    d.store.setExtras(id, { followup: { subject: r.subject.slice(0, 300), body: r.body.slice(0, 20_000) } }); push(id)
  })
  ipcMain.handle('extras:set-brief', (_e, id: unknown, md: unknown) => {
    if (!known(id) || typeof md !== 'string') return
    d.store.setExtras(id, { brief: md.slice(0, 50_000) }); push(id)
  })
  ipcMain.handle('extras:use-context', (_e, id: unknown, on: unknown) => {
    if (!known(id) || typeof on !== 'boolean') return
    d.store.setExtras(id, { useContext: on }); push(id)
  })
  // a template picked for this meeting: its notes are written again with it
  ipcMain.handle('extras:template', (_e, id: unknown, templateId: unknown) => {
    if (!known(id) || !(isBuiltIn(templateId) || isCustomId(templateId))) return
    d.store.setExtras(id, { templateId }); push(id)
    d.rewrite(id)
  })
  return { view, push }
}
