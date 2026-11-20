import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { enhance, enhancePrompt, type Llm } from '../src/main/notes/enhance'
import { cleanTemplates, templatePrompt, BUILT_IN } from '../src/shared/templates'
import { keepTicks, parseActions, actionsMarkdown } from '../src/shared/actions'
import { bodySoFar, briefPrompt, followUpPrompt, parseFollowUp } from '../src/main/extras'
import { deviceCode, eventsOf, mailTexts, participantsQuery, plainText, toolJson } from '../src/main/m365/tools'
import { createM365 } from '../src/main/m365/client'
import { createM365Context } from '../src/main/m365/context'
import { fakeM365Server } from '../src/main/m365/fake'
import { Store } from '../src/main/store'

const base = { title: 'Launch sync', attendees: [{ name: 'Maya Chen', email: null }], mine: '', transcript: 'You: Hi.\nMaya Chen: Hello.', language: 'English' }

describe('summary templates', () => {
  it('leaves the general notes exactly as they were', () => {
    expect(enhancePrompt({ ...base, template: templatePrompt('general', []) })).toBe(enhancePrompt(base))
  })
  it('asks for the template sections after the transcript, keeping the next steps', () => {
    const p = enhancePrompt({ ...base, template: templatePrompt('retro', []) })
    expect(p.indexOf('What went well')).toBeGreaterThan(p.indexOf('</transcript>'))
    expect(p).toContain('Keep "## Next steps" last')
  })
  it('passes a custom template as an instruction, never as meeting content', () => {
    const custom = cleanTemplates([{ id: 'custom-abc123', name: '  Board  ', instructions: 'Sections: Risks, Money.' }, { id: 'bad id', name: 'x', instructions: 'y' }])
    expect(custom).toEqual([{ id: 'custom-abc123', name: 'Board', instructions: 'Sections: Risks, Money.' }])
    expect(enhancePrompt({ ...base, template: templatePrompt('custom-abc123', custom) })).toContain(JSON.stringify('Sections: Risks, Money.'))
  })
  it('names every built-in template', () => {
    expect(BUILT_IN.every((b) => b.name().length > 0)).toBe(true)
  })
  it('puts the meeting context after the transcript', () => {
    const p = enhancePrompt({ ...base, context: '<email>Pricing question</email>' })
    expect(p.indexOf('<context>')).toBeGreaterThan(p.indexOf('</transcript>'))
  })
})

describe('action items', () => {
  it('reads a list from plain JSON, an object or text around it', () => {
    expect(parseActions('{"items":[{"owner":"Maya","task":"Ship it","due":null}]}')).toEqual([{ owner: 'Maya', task: 'Ship it', due: null, done: false }])
    expect(parseActions('Sure:\n```json\n[{"owner":"You","task":"Email","due":"Friday"}]\n```')).toEqual([{ owner: 'You', task: 'Email', due: 'Friday', done: false }])
    expect(parseActions('nothing')).toBeNull()
  })
  it('keeps ticks for items still there after a rewrite', () => {
    expect(keepTicks([{ owner: 'A', task: 'Ship it!', due: null, done: false }], [{ owner: 'A', task: 'ship it', due: null, done: true }])[0].done).toBe(true)
    expect(actionsMarkdown([{ owner: 'A', task: 'X', due: 'Mon', done: true }])).toBe('- [x] **A:** X (Mon)')
  })
  it('asks for them after the notes, following on from them', async () => {
    const asked: string[] = []
    let ask: ((llm: Llm) => Promise<string>) | undefined
    const llm: Llm = { contextSize: 32000, count: async (xs) => xs.map((x) => x.length / 4), chat: async (p, _t, o) => { asked.push(p); return o?.json ? '{"items":[]}' : '## Plan\n- Ship.\n## More\n- A.\n## Next steps\n- **You:** ship' } }
    await enhance({ meeting: { title: 'x', attendees: [] }, mine: '', segments: [{ id: 1, meetingId: 'm', track: 'me', startMs: 0, endMs: 1, text: 'Hi', speaker: 'me' }], language: 'en', actionsLater: (a) => { ask = a } }, llm, () => {})
    expect(ask).toBeDefined()
    expect(await ask!(llm)).toBe('{"items":[]}')
    expect(asked.at(-1)).toContain('Now list the action items')
  })
  it('are kept with the meeting, and go with it', () => {
    const store = new Store(join(mkdtempSync(join(tmpdir(), 'extras-')), 'y.db'))
    const m = store.createMeeting({ title: 'Sync', startedAt: 1, endedAt: null, eventId: null, app: null, state: 'done', attendees: [{ name: 'Maya', email: 'maya@acme.example' }] })
    store.setExtras(m.id, { actions: [{ owner: 'Maya', task: 'Ship', due: null, done: true }], templateId: 'retro' })
    expect(store.extras(m.id)).toMatchObject({ templateId: 'retro', actions: [{ task: 'Ship', done: true }], followup: null, brief: null })
    store.db.prepare('DELETE FROM meetings WHERE id = ?').run(m.id)
    expect(store.extras(m.id).actions).toBeNull()
  })
})

describe('follow-up email and brief', () => {
  it('reads the email from JSON, and shows its body as it streams', () => {
    expect(parseFollowUp('{"subject":"Next steps","body":"Hi\\nall"}')).toEqual({ subject: 'Next steps', body: 'Hi\nall' })
    expect(parseFollowUp('no')).toBeNull()
    expect(bodySoFar('{"subject":"S","body":"Hi\\nthe')).toBe('Hi\nthe')
  })
  it('gives the model the notes, actions and people', () => {
    const p = followUpPrompt({ meeting: { title: 'Sync', attendees: [{ name: 'Maya', email: 'maya@acme.example' }] }, notes: '## Plan', actions: [{ owner: 'Maya', task: 'Ship', due: null, done: false }], me: 'Sam', language: 'French' })
    expect(p).toContain('maya@acme.example'); expect(p).toContain('**Maya:** Ship'); expect(p).toContain('in French')
  })
  it('recalls earlier meetings and open points in the brief', () => {
    const p = briefPrompt({ meeting: { title: 'Renewal', attendees: [] }, startsAt: Date.UTC(2026, 10, 21, 9), earlier: [{ title: 'Kickoff', at: Date.UTC(2026, 9, 1), notes: '## Scope', open: [{ owner: 'You', task: 'Send prices', due: null, done: false }] }], me: '', language: 'English' })
    expect(p).toContain('Kickoff'); expect(p).toContain('Send prices'); expect(p).toContain('## Questions to ask')
  })
})

describe('Microsoft 365, read only', () => {
  it('reads the device code, tool answers and Outlook events', () => {
    expect(deviceCode('To sign in, use a web browser to open the page https://microsoft.com/devicelogin and enter the code AB12CD34 to authenticate.')).toEqual({ url: 'https://microsoft.com/devicelogin', code: 'AB12CD34' })
    expect(() => toolJson({ content: [{ type: 'text', text: '{"error":"nope"}' }] })).toThrow('nope')
    const [e] = eventsOf({ value: [{ id: 'x', subject: 'Sync', start: { dateTime: '2026-11-21T09:00:00.0000000' }, end: { dateTime: '2026-11-21T09:30:00' }, attendees: [{ emailAddress: { name: 'Me', address: 'me@x.com' } }, { emailAddress: { name: 'Maya', address: 'maya@acme.example' } }], onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/x' } }] }, 'me@x.com')
    expect(e).toMatchObject({ id: 'm365:x', start: '2026-11-21T09:00:00.000Z', attendees: [{ name: 'Maya', email: 'maya@acme.example' }], url: 'https://teams.microsoft.com/l/x' })
    expect(mailTexts([{ from: 'Maya', subject: 'Hi', received: '2026', text: 'Hello' }, { error: 'x' }])).toHaveLength(1)
    expect(participantsQuery(['a@x.com', 'b@y.com'])).toBe('participants:a@x.com OR participants:b@y.com')
    expect(plainText('<p>Hello&nbsp;<b>you</b></p><p>Bye</p>')).toBe('Hello you\nBye')
  })
  it('signs in with a code, then reads the calendar and the emails for a meeting', async () => {
    const opened: string[] = []
    const m365 = createM365({ dataDir: tmpdir(), openExternal: (u) => opened.push(u), onChange: () => {}, connect: fakeM365Server() })
    await m365.signIn()
    expect(m365.status()).toMatchObject({ state: 'connected', account: 'you@example.com' })
    expect(opened[0]).toBe('https://microsoft.com/devicelogin')
    const ctx = createM365Context({ m365, calendarOn: () => true, account: () => 'you@example.com' })
    const events = await ctx.calendar.events(Date.now(), Date.now() + 3 * 86_400_000) as Array<{ id: string }>
    expect(events[0].id).toBe('m365:evt1')
    const text = await ctx.meetingContext({ id: 'a', eventId: 'm365:evt1', attendees: [{ name: 'Maya', email: 'maya@acme.example' }], title: 'Acme' })
    expect(text).toContain('<invite>'); expect(text).toContain('Can we keep the 2025 price')
  }, 15_000)
})
