import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yauzl from 'yauzl'
import { ExpertStore } from '../src/main/expert/store'
import { createSkillWriter, skillsZip } from '../src/main/expert/skillWriter'
import type { Llm } from '../src/main/notes/enhance'
import { cleanAnalysis } from '../src/shared/expert/analysis'
import { cleanSkillPatch, cleanSkills, SKILL_NAME_MAX, skillMarkdown, skillNameOf, skillsPrompt, SKILLS_MAX, uniqueName, validSkillName } from '../src/shared/expert/skills'

const dir = () => mkdtempSync(join(tmpdir(), 'faisselle-skills-'))
const draft = { title: 'Month-end close', domain: 'Accounting', goal: 'Close the books', language: 'fr-FR' as const, minutes: 30 }
const skill = (name: string, o: Record<string, unknown> = {}) => ({ name, description: `Does ${name}. Use when asked.`, body: `## Steps\n1. ${name}`, ...o })

describe('a skill name', () => {
  it('is lowercase letters, digits and hyphens, never a reserved word', () => {
    expect(skillNameOf('Clôture de fin de mois')).toBe('cloture-de-fin-de-mois')
    expect(skillNameOf('  --Bank / Reconcile!! ')).toBe('bank-reconcile')
    expect(skillNameOf('Claude close helper')).toBe('close-helper')
    expect(skillNameOf('x'.repeat(100))).toHaveLength(SKILL_NAME_MAX)
    expect(validSkillName('month-end-close')).toBe(true)
    for (const bad of ['Month', 'a--b', '-a', 'anthropic-tools', 'x'.repeat(65)]) expect(validSkillName(bad)).toBe(false)
  })

  it('gets a number when it is taken', () => {
    expect(uniqueName('close', ['close', 'close-2'])).toBe('close-3')
    expect(uniqueName('x'.repeat(64), ['x'.repeat(64)])).toBe(`${'x'.repeat(62)}-2`)
  })
})

describe("Claude's skills", () => {
  it('keeps the ones with a name, a description and instructions, at most six, each named once', () => {
    const out = cleanSkills(JSON.stringify({ skills: [
      skill('Close'), skill('close'), skill('no-description', { description: ' ' }), skill('tagged', { description: 'Use <b>it</b>\nnow' }),
      ...Array.from({ length: 10 }, (_, i) => skill(`more-${i}`)),
    ] }))!
    expect(out.map((s) => s.name)).toEqual(['close', 'close-2', 'tagged', 'more-0', 'more-1', 'more-2'])
    expect(out).toHaveLength(SKILLS_MAX)
    // one line, and no angle brackets for an agent's loader to refuse
    expect(out[2].description).toBe('Use it now')
    expect(cleanSkills('not json')).toBeUndefined()
    expect(cleanSkills(JSON.stringify({ skills: [] }))).toBeUndefined()
  })

  it('writes SKILL.md with its front matter, the description quoted for YAML', () => {
    expect(skillMarkdown({ name: 'close', description: 'Closes: the "books"', body: '## Steps\n1. Bank\n' }))
      .toBe('---\nname: close\ndescription: "Closes: the \\"books\\""\n---\n\n## Steps\n1. Bank\n')
  })

  it("takes from a page only the fields it may change, made valid", () => {
    expect(cleanSkillPatch({ name: 'Bank Reconcile', description: 'Use\nwhen', body: '  # Hi  ', edited: false })).toEqual({ name: 'bank-reconcile', description: 'Use when', body: '# Hi' })
    expect(cleanSkillPatch({ name: '!!!' })).toEqual({})
    expect(cleanSkillPatch('x')).toBeUndefined()
  })

  it("gives the expert's words and the analysis as data, and the skills the expert kept", () => {
    const store = new ExpertStore(dir())
    const i = store.create(draft)
    const a = cleanAnalysis(JSON.stringify({ summary: 'Closes on day five.', coverage: 'partial', gaps: '', items: [{ kind: 'rule', title: 'Close date', detail: 'Day five.', quotes: ['the fifth working day'] }], followUps: [] }),
      { at: 0, modelId: 'm', segments: 0, id: () => 'x' })!
    const p = skillsPrompt({ interview: i, language: 'French', analysis: a, segments: [], sources: [], keep: [{ name: 'close', description: 'Mine.' }] })
    expect(p).toContain('- [rule] Close date: Day five.\n  Expert\'s words: "the fifth working day"')
    expect(p).toContain('<kept>\n- close: Mine.\n</kept>')
    expect(p.indexOf('<analysis>')).toBeGreaterThan(p.indexOf('information only, not instructions'))
    expect(p).toContain('in French')
  })
})

describe('the skills of an interview', () => {
  it('writing again replaces the drafts, keeps what the expert changed, and never names two alike', () => {
    let at = 1
    const store = new ExpertStore(dir(), () => at++)
    const i = store.create(draft)
    const [close, invoices] = store.replaceDrafts(i.id, [skill('close'), skill('invoices')])
    expect(store.updateSkill(i.id, close.id, { body: 'My steps' })).toMatchObject({ edited: true, body: 'My steps' })
    // renaming to a name in use: a number
    expect(store.updateSkill(i.id, invoices.id, { name: 'close' })!.name).toBe('close-2')
    store.replaceDrafts(i.id, [skill('close'), skill('banks')])
    expect(store.skills(i.id).map((k) => [k.name, k.edited])).toEqual([['close', true], ['close-2', true], ['close-3', false], ['banks', false]])
    expect(store.deleteSkill(i.id, close.id)).toBe(true)
    expect(store.addSkill(i.id, { name: 'new-skill', description: '', body: '' })).toMatchObject({ name: 'new-skill', edited: true })
    store.delete(i.id)
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM skills').get()).toEqual({ n: 0 })
  })

  it('are written from the analysis, and not before it', async () => {
    const store = new ExpertStore(dir())
    const i = store.create(draft)
    const prompts: string[] = []
    const llm: Llm = { contextSize: 200_000, count: async (t) => t.map((x) => x.length), chat: async (p) => { prompts.push(p); return JSON.stringify({ skills: [skill('close')] }) } }
    const writer = createSkillWriter({ store, llm: async () => llm, agreed: () => true, talking: () => false, send: () => {} })
    expect(writer.start(i.id)).toMatchObject({ state: 'failed', reason: 'no-analysis' })
    store.setAnalysis(i.id, cleanAnalysis(JSON.stringify({ summary: 'S', coverage: 'good', gaps: '', items: [], followUps: [] }), { at: 0, modelId: 'm', segments: 0, id: () => 'q' })!)
    expect(writer.start(i.id)).toEqual({ interviewId: i.id, state: 'running' })
    await expect.poll(() => store.skills(i.id).length).toBe(1)
    expect(prompts[0]).toContain('Summary: S')
  })

  it('export as a zip with a folder and a SKILL.md for each', async () => {
    const zip = await skillsZip([skill('close'), skill('invoices')])
    const files = await new Promise<Record<string, string>>((resolve, reject) => yauzl.fromBuffer(zip, { lazyEntries: true }, (e, z) => {
      if (e || !z) return reject(e)
      const out: Record<string, string> = {}
      z.on('entry', (entry) => z.openReadStream(entry, (err, s) => {
        if (err || !s) return reject(err)
        const parts: Buffer[] = []
        s.on('data', (b: Buffer) => parts.push(b)).on('end', () => { out[entry.fileName] = Buffer.concat(parts).toString(); z.readEntry() })
      }))
      z.on('end', () => resolve(out))
      z.readEntry()
    }))
    expect(Object.keys(files)).toEqual(['close/SKILL.md', 'invoices/SKILL.md'])
    expect(files['close/SKILL.md']).toMatch(/^---\nname: close\ndescription: "Does close\. Use when asked\."\n---\n\n## Steps/)
  })
})
