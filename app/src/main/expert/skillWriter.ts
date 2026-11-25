// Expert interviews, Skill Studio in main: Claude (the analysis model) writes Agent Skills from the interview's
// analysis, transcript and documents; the skills the expert changed are kept. One writing at a time per interview,
// in the background. And the skills as a zip: a folder each, with its SKILL.md, as agents load them.
import yazl from 'yazl'
import { BedrockError } from '../notes/bedrock'
import type { Llm } from '../notes/enhance'
import type { ExpertStore } from './store'
import { languageName } from './voice'
import { cleanSkills, skillMarkdown, skillsPrompt, SKILLS_SCHEMA, type Skill, type SkillsFailure, type SkillsState } from '../../shared/expert/skills'
import type { Interview } from '../../shared/expert/types'

/** room for several skills' instructions */
const SKILLS_MAX_TOKENS = 16_000

export type SkillWriterDeps = {
  store: ExpertStore
  llm(signal: AbortSignal): Promise<Llm>
  agreed(i: Interview): boolean
  talking(id: string): boolean
  organisation?(): string[]
  send(s: SkillsState | { interviewId: string; state: 'done' }): void
}

export function createSkillWriter(d: SkillWriterDeps) {
  const running = new Map<string, AbortController>()
  const failed = new Map<string, Extract<SkillsState, { state: 'failed' }>>()
  const fail = (id: string, reason: SkillsFailure, detail?: string): SkillsState => {
    const s = { interviewId: id, state: 'failed' as const, reason, ...(detail ? { detail } : {}) }
    failed.set(id, s)
    d.send(s)
    return s
  }

  async function run(i: Interview, abort: AbortController) {
    const id = i.id
    try {
      const analysis = d.store.analysis(id)!
      const keep = d.store.skills(id).filter((k) => k.edited)
      const prompt = skillsPrompt({ interview: i, language: languageName(i.language), analysis, segments: d.store.segments(id), sources: d.store.sourceTexts(id), keep, organisation: d.organisation?.() })
      const llm = await d.llm(abort.signal)
      const raw = await llm.chat(prompt, () => {}, { json: SKILLS_SCHEMA as unknown as Record<string, unknown>, maxTokens: SKILLS_MAX_TOKENS })
      if (abort.signal.aborted) return
      const drafts = cleanSkills(raw)
      if (!drafts) { fail(id, 'unreadable'); return }
      if (!d.store.get(id)) return
      d.store.replaceDrafts(id, drafts)
      failed.delete(id)
      d.send({ interviewId: id, state: 'done' })
    } catch (e) {
      if (abort.signal.aborted) return
      console.warn('writing the skills failed', e)
      const kind = e instanceof BedrockError ? e.kind : undefined
      fail(id, kind === 'sign-in' ? 'bedrock' : kind === 'refused' ? 'refused' : 'failed', e instanceof Error ? e.message.slice(0, 300) : undefined)
    } finally {
      if (running.get(id) === abort) running.delete(id)
    }
  }

  return {
    state(id: string): SkillsState | undefined { return running.has(id) ? { interviewId: id, state: 'running' } : failed.get(id) },
    /** writes the skills from the interview's analysis; it says at once when it can't */
    start(id: string): SkillsState {
      const i = d.store.get(id)
      if (!i) return fail(id, 'failed')
      if (running.has(id)) return { interviewId: id, state: 'running' }
      if (!d.agreed(i)) return fail(id, 'consent')
      if (d.talking(id)) return fail(id, 'busy')
      if (!d.store.analysis(id)) return fail(id, 'no-analysis')
      const abort = new AbortController()
      running.set(id, abort)
      failed.delete(id)
      d.send({ interviewId: id, state: 'running' })
      void run(i, abort)
      return { interviewId: id, state: 'running' }
    },
    forget(id: string) { running.get(id)?.abort(); running.delete(id); failed.delete(id) },
  }
}

/** the skills as a zip: <name>/SKILL.md for each */
export function skillsZip(skills: Array<Pick<Skill, 'name' | 'description' | 'body'>>, at = new Date()): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile()
    for (const s of skills) zip.addBuffer(Buffer.from(skillMarkdown(s), 'utf8'), `${s.name}/SKILL.md`, { mtime: at })
    const parts: Buffer[] = []
    zip.outputStream.on('data', (b: Buffer) => parts.push(b)).on('end', () => resolve(Buffer.concat(parts))).on('error', reject)
    zip.end()
  })
}
