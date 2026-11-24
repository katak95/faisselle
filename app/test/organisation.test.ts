import { afterEach, describe, expect, it } from 'vitest'
import { cleanOrganisation, ORGANISATION_MAX, organisationIntro, setOrganisation } from '../src/main/organisation'
import { enhancePrompt } from '../src/main/notes/enhance'
import { briefPrompt, followUpPrompt } from '../src/main/extras'
import { contextTail } from '../src/main/chat'
import { libraryPrompt } from '../src/main/library/prompt'
import { BEDROCK_DEFAULTS, cleanModels, createBedrockNotesModel, modelFor, type MessagesClient } from '../src/main/notes/bedrock'

const about = 'Acme makes billing software for dentists. "MRR" is monthly recurring revenue.'
afterEach(() => setOrganisation(() => ''))

describe('the company context', () => {
  it('is kept as plain text, trimmed, within its length', () => {
    expect(cleanOrganisation('  Acme\r\nDentists \u0007 ')).toBe('Acme\nDentists')
    expect(cleanOrganisation(42)).toBe('')
    expect(cleanOrganisation('x'.repeat(ORGANISATION_MAX + 50))).toHaveLength(ORGANISATION_MAX)
  })

  it('goes, as background, into the notes, the brief, the follow-up email and Ask; nothing when there is none', () => {
    const meeting = { title: 'Renewal', attendees: [{ name: 'Maya', email: null }] }
    const prompts = () => [
      enhancePrompt({ title: 'Renewal', attendees: meeting.attendees, mine: '', transcript: 'You: hi', language: 'English' }),
      briefPrompt({ meeting, startsAt: null, earlier: [], me: 'Sam', language: 'English' }),
      followUpPrompt({ meeting, notes: '## Plan', actions: [], me: 'Sam', language: 'English' }),
      contextTail(meeting, { mine: '', enhanced: '## Plan', edited: false }),
      libraryPrompt({ items: [], question: 'What about MRR?', history: [], now: Date.now(), spelling: '' }),
    ]
    for (const p of prompts()) expect(p).not.toContain('<organisation>')
    setOrganisation(() => about)
    for (const p of prompts()) {
      expect(p).toContain(`${organisationIntro}\n<organisation>\n${about}\n</organisation>`)
    }
    // never mistaken for the meeting: it comes before the instructions, and says it is background
    expect(organisationIntro).toMatch(/never write something from it as if it was said in the meeting/)
  })
})

describe('a model for each use on Bedrock', () => {
  it('takes the use’s own model, else the main one, and only valid IDs', () => {
    const c = { modelId: 'anthropic.claude-haiku-5-5', models: { brief: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0' } }
    expect(modelFor(c, 'brief')).toBe('eu.anthropic.claude-sonnet-4-5-20250929-v1:0')
    expect(modelFor(c, 'summary')).toBe('anthropic.claude-haiku-5-5')
    expect(modelFor(c)).toBe('anthropic.claude-haiku-5-5')
    expect(cleanModels({ brief: 'ok.model', summary: 'bad model!', ask: 3, other: 'x.y' })).toEqual({ brief: 'ok.model' })
  })

  it('sends each request with its use’s model, through that model’s endpoint', async () => {
    const sent: Array<{ model: string; endpointOf: string }> = []
    const made: string[] = []
    const client = (modelId: string): MessagesClient => ({ messages: { stream: ((p: { model: string }) => {
      sent.push({ model: p.model, endpointOf: modelId })
      const s = { on: () => s, finalMessage: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } }) }
      return s
    }) as never } })
    const config = { region: 'eu-west-1', modelId: BEDROCK_DEFAULTS.modelId, accountId: '123456789012', roleName: 'R', models: { brief: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0' } }
    const llm = await createBedrockNotesModel({ config: () => config, client: (c) => { made.push(c.modelId); return client(c.modelId) } }).llm()
    await llm.chat('Notes', () => {}, { use: 'summary' })
    await llm.chat('Brief', () => {}, { use: 'brief' })
    await llm.chat('Again', () => {}, { use: 'summary' })
    expect(sent.map((s) => s.model)).toEqual([BEDROCK_DEFAULTS.modelId, 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0', BEDROCK_DEFAULTS.modelId])
    // one client per endpoint, reused
    expect(made).toHaveLength(BEDROCK_DEFAULTS.modelId.startsWith('eu.') ? 1 : 2)
  })
})
