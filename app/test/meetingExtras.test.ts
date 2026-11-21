import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { enhance, enhancePrompt, type Llm } from '../src/main/notes/enhance'
import { cleanTemplates, templatePrompt, BUILT_IN } from '../src/shared/templates'
import { keepTicks, parseActions, actionsMarkdown } from '../src/shared/actions'
import { bodySoFar, briefPrompt, followUpPrompt, parseFollowUp, withDocumentLinks } from '../src/main/extras'
import { deviceCode, enabledTools, eventsOf, mailTexts, needsAdminConsent, participantsQuery, plainText, toolJson } from '../src/main/m365/tools'
import { createM365 } from '../src/main/m365/client'
import { createM365Context } from '../src/main/m365/context'
import { fakeDocx, fakeM365Server } from '../src/main/m365/fake'
import { documentHits, documentQuery, extractText, searchTerms } from '../src/main/m365/documents'
import yazl from 'yazl'
import { Store } from '../src/main/store'
import { contextTail } from '../src/main/chat'

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
    let documents = false
    const ctx = createM365Context({ m365, calendarOn: () => true, account: () => 'you@example.com', documentsOn: () => documents })
    const events = await ctx.calendar.events(Date.now(), Date.now() + 3 * 86_400_000) as Array<{ id: string }>
    expect(events[0].id).toBe('m365:evt1')
    const meeting = { id: 'a', eventId: 'm365:evt1', attendees: [{ name: 'Maya', email: 'maya@acme.example' }], title: 'Acme renewal' }
    const mail = await ctx.meetingContext(meeting, { documents: true })
    expect(mail?.text).toContain('<invite>'); expect(mail?.text).toContain('Can we keep the 2025 price')
    // documents only once that search is turned on, and only where asked for
    expect(mail?.text).not.toContain('<document'); expect(mail?.documents).toEqual([])
    documents = true
    expect((await ctx.meetingContext(meeting))?.text).not.toContain('<document')
    const withDocs = await ctx.meetingContext(meeting, { documents: true })
    expect(withDocs?.text).toContain('Two-year term with a 4% discount')
    expect(withDocs?.text).toContain('Proposed Acme renewal: two years at the 2025 price…')
    expect(withDocs?.documents.map((x) => x.name)).toEqual(['Acme renewal proposal.docx', 'Q3 rollout.pptx'])
  }, 15_000)
  it('starts the server in work-account mode with the document tools only when asked', () => {
    expect(enabledTools(false)).not.toContain('search-query')
    expect(enabledTools(true)).toContain('search-query|download-bytes')
    expect(needsAdminConsent('AADSTS65001: The user or administrator has not consented')).toBe(true)
    expect(needsAdminConsent('network down')).toBe(false)
  })
})

describe('related documents', () => {
  it('give Ask the meeting context after the notes, as background', () => {
    const tail = contextTail({ title: 'Acme', attendees: [] }, { mine: '', enhanced: '## Plan', edited: false }, '', '<document title="a">x</document>')
    expect(tail.indexOf('<context>')).toBeGreaterThan(tail.indexOf('</notes>'))
    expect(tail).toContain('Never write something from it as if it was said')
    expect(contextTail({ title: 'Acme', attendees: [] }, { mine: '', enhanced: null, edited: false })).not.toContain('<context>')
  })
  it('searches with the title and the companies of the people invited', () => {
    const terms = searchTerms({ title: 'Weekly sync: Acme renewal', attendees: [{ name: 'Maya', email: 'maya@globex.com' }, { name: 'Bo', email: 'bo@gmail.com' }] })
    expect(terms).toEqual(['Globex', 'Acme', 'renewal'])
    expect(documentQuery(terms, Date.UTC(2026, 10, 20))).toBe('(Globex OR Acme OR renewal) AND LastModifiedTime>=2025-11-20')
    expect(documentQuery([])).toBeNull()
  })
  it('reads hits, cleans their snippets and drops copies', () => {
    const hit = (id: string, url: string) => ({ hitId: id, summary: '<c0>Acme</c0> plan<ddd/>', resource: { id, name: `${id}.docx`, webUrl: url, lastModifiedDateTime: '2026-11-01T00:00:00Z', size: 10, parentReference: { driveId: 'd' } } })
    const hits = documentHits({ value: [{ hitsContainers: [{ hits: [hit('a', 'https://x/a'), hit('b', 'https://x/a'), hit('c', 'https://x/c')] }] }] })
    expect(hits.map((h) => h.id)).toEqual(['a', 'c'])
    expect(hits[0]).toMatchObject({ snippet: 'Acme plan…', modified: '2026-11-01', driveId: 'd' })
  })
  it('extracts the text of Word, PowerPoint and text files', async () => {
    expect(await extractText(await fakeDocx(['Hello & welcome', 'Second line']), 'a.docx')).toBe('Hello & welcome\nSecond line')
    const pptx = await zipOf({ 'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>Second</a:t></a:r></a:p></p:sld>', 'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>First</a:t></a:r></a:p></p:sld>' })
    expect(await extractText(pptx, 'deck.pptx')).toBe('Slide 1: First\nSlide 2: Second')
    expect(await extractText(Buffer.from('plain notes'), 'n.txt')).toBe('plain notes')
    expect(await extractText(readFileSync(join(import.meta.dirname, 'fixtures/hello.pdf')), 'hello.pdf')).toContain('Hello PDF world')
    expect(await extractText(Buffer.from('x'), 'image.png')).toBe('')
    expect((await extractText(Buffer.from('y'.repeat(9000)), 'long.md')).length).toBe(3000)
  })
  it('adds the links to the brief itself, under the heading the model wrote', () => {
    const docs = [{ name: 'Plan [v2].docx', url: 'https://contoso.sharepoint.com/a (1).docx', modified: '2026-11-01' }]
    expect(withDocumentLinks('## Purpose\n- X\n## Documents liés', docs)).toBe('## Purpose\n- X\n## Documents liés\n- [Plan \\[v2\\].docx](https://contoso.sharepoint.com/a%20%281%29.docx) · 2026-11-01')
    expect(withDocumentLinks('## Purpose\n- X', docs)).toContain('## Related documents\n- [Plan')
    expect(withDocumentLinks('## Purpose', [{ name: 'x', url: 'javascript:alert(1)', modified: '' }])).toBe('## Purpose')
  })
})

function zipOf(files: Record<string, string>): Promise<Buffer> {
  const zip = new yazl.ZipFile()
  for (const [name, text] of Object.entries(files)) zip.addBuffer(Buffer.from(text), name)
  zip.end()
  return new Promise((resolve) => { const c: Buffer[] = []; zip.outputStream.on('data', (b: Buffer) => c.push(b)).on('end', () => resolve(Buffer.concat(c))) })
}
