import { t } from './i18n'

/**
 * Summary templates: the shape of the notes for a kind of meeting (a one-on-one, a client call, a retro…).
 * The general one is Faisselle's own notes, unchanged. A built-in template says, in English for the model, which
 * "## " sections to use; one the person writes says it in their own words.
 */
export type TemplateId = string
export type BuiltInTemplate = { id: TemplateId; name: () => string; /** English, for the model: what the meeting is */ kind: string; /** English, for the model: the "## " sections, in order */ sections: string[]; /** English, for the model: anything else about writing it */ guidance?: string }
/** a template the person wrote in Settings */
export type CustomTemplate = { id: TemplateId; name: string; instructions: string }
/** what the notes prompt needs from a template (none: the general notes) */
export type TemplatePrompt = { kind: 'built-in'; meeting: string; sections: string[]; guidance?: string } | { kind: 'custom'; name: string; instructions: string }

export const GENERAL = 'general'
export const CUSTOM_PREFIX = 'custom-'
export const CUSTOM_MAX = 20
export const CUSTOM_NAME_MAX = 60
export const CUSTOM_INSTRUCTIONS_MAX = 2000

export const BUILT_IN: BuiltInTemplate[] = [
  { id: GENERAL, name: () => t('General'), kind: '', sections: [] },
  { id: 'one-on-one', name: () => t('One-on-one'), kind: 'a one-on-one between a manager and a team member',
    sections: ['Wins and progress', 'Blockers and concerns', 'Feedback (both ways)', 'Growth and goals', 'Agreements'],
    guidance: 'Keep it personal and candid but factual; write feedback as what was said, not as judgements.' },
  { id: 'client', name: () => t('Client call'), kind: 'a call with a client or prospect',
    sections: ['Context and goals', 'Needs and pain points', 'What we proposed', 'Objections and questions', 'Budget, timing and decision makers', 'Agreements'],
    guidance: 'Keep every number, price, date, product and competitor named. Say clearly what the client agreed to and what is still open.' },
  { id: 'retro', name: () => t('Retrospective'), kind: 'a team retrospective',
    sections: ['What went well', 'What went less well', 'Ideas and lessons', 'Improvement actions'] },
  { id: 'interview', name: () => t('Job interview'), kind: 'a job interview',
    sections: ['Candidate background', 'Strengths shown', 'Concerns and gaps', 'Questions the candidate asked', 'Logistics (salary, notice, start date)', 'Overall impression'],
    guidance: 'Write the overall impression only from what was said; never invent a rating or a decision.' },
  { id: 'project-status', name: () => t('Project status'), kind: 'a project status meeting',
    sections: ['Progress since last time', 'Status by workstream', 'Risks and issues', 'Decisions', 'Upcoming milestones'],
    guidance: 'Give each workstream a plain status (on track, at risk, late) only when it was said.' },
  { id: 'committee', name: () => t('Board or committee'), kind: 'a formal board or committee meeting',
    sections: ['Attendance and agenda', 'Items discussed', 'Decisions and votes', 'Open items'],
    guidance: 'Formal, neutral minutes. Record each decision exactly as stated, with any vote count.' },
]

export const isBuiltIn = (id: unknown): id is TemplateId => BUILT_IN.some((b) => b.id === id)
export const isCustomId = (id: unknown): id is TemplateId => typeof id === 'string' && /^custom-[a-z0-9]{6,24}$/.test(id)

/** a list from settings or the window, cleaned: unknown shapes dropped, text cut to length, ids made safe */
export function cleanTemplates(v: unknown): CustomTemplate[] {
  if (!Array.isArray(v)) return []
  const out: CustomTemplate[] = []
  for (const x of v) {
    if (!x || typeof x !== 'object') continue
    const r = x as Record<string, unknown>
    const name = typeof r.name === 'string' ? r.name.replace(/\s+/g, ' ').trim().slice(0, CUSTOM_NAME_MAX) : ''
    const instructions = typeof r.instructions === 'string' ? r.instructions.trim().slice(0, CUSTOM_INSTRUCTIONS_MAX) : ''
    if (!name || !instructions || !isCustomId(r.id) || out.some((o) => o.id === r.id)) continue
    out.push({ id: r.id, name, instructions })
    if (out.length >= CUSTOM_MAX) break
  }
  return out
}

/** the prompt part of a template, by id: undefined for the general notes (or one that no longer exists) */
export function templatePrompt(id: TemplateId | null | undefined, custom: CustomTemplate[]): TemplatePrompt | undefined {
  if (!id || id === GENERAL) return undefined
  const b = BUILT_IN.find((x) => x.id === id)
  if (b) return { kind: 'built-in', meeting: b.kind, sections: b.sections, ...(b.guidance ? { guidance: b.guidance } : {}) }
  const c = custom.find((x) => x.id === id)
  return c ? { kind: 'custom', name: c.name, instructions: c.instructions } : undefined
}

/** every template the person can pick, for menus */
export const templateChoices = (custom: CustomTemplate[]): Array<{ id: TemplateId; name: string }> =>
  [...BUILT_IN.map((b) => ({ id: b.id, name: b.name() })), ...custom.map((c) => ({ id: c.id, name: c.name }))]
