import type { TranscriptSegment, VoiceApi } from './voice'
import type { AnalysisState, FollowUpStatus, InterviewAnalysis } from './analysis'
import type { Skill, SkillPatch, SkillsExport, SkillsState } from './skills'

// Expert interviews (Faisselle): an expert talks with a voice agent on Amazon Bedrock, and what they know becomes
// Agent Skills. What main keeps (main/expert/store.ts) and what the window sees of it; every check a page's input
// goes through is here too, so main and the screens agree on the limits.

/** the languages Amazon Nova Sonic speaks (Nova 2): an interview is held in one of them */
export const INTERVIEW_LANGUAGES = ['fr-FR', 'en-US', 'en-GB', 'de-DE', 'es-ES', 'it-IT', 'pt-BR', 'hi-IN'] as const
export type InterviewLanguage = typeof INTERVIEW_LANGUAGES[number]

export const TITLE_MAX = 120
export const DOMAIN_MAX = 120
export const GOAL_MAX = 2000
export const MINUTES_MIN = 5
export const MINUTES_MAX = 180
/** a local source: a text file the expert picked, read once and kept in the interview */
export const SOURCE_BYTES_MAX = 1_000_000
export const SOURCES_MAX = 20

/**
 * draft: being prepared. ready: the expert agreed to what is sent to Bedrock. The voice interview (in-progress,
 * paused) and its end (ended) come with the interview itself.
 */
export type InterviewState = 'draft' | 'ready' | 'in-progress' | 'paused' | 'ended'

/** what the expert agreed to send, and where: asked again when the region or a model changes */
export type Consent = { at: number; voiceRegion: string; voiceModelId: string; region: string; modelId: string }

export type Interview = {
  id: string; title: string; domain: string
  /** "What should an agent be able to do?" */
  goal: string
  language: InterviewLanguage
  /** how long the expert means to talk, roughly */
  minutes: number
  state: InterviewState
  consent: Consent | null
  createdAt: number; updatedAt: number
}

/** a local file given as background; its text stays in main and is sent to Bedrock only when it is needed */
export type InterviewSource = { id: string; name: string; bytes: number; addedAt: number }

export type InterviewCard = Interview & { sources: number }
export type InterviewDetail = { interview: Interview; sources: InterviewSource[]; segments: TranscriptSegment[]; audioBytes: number
  /** the latest analysis (expert/analyze.ts), and what one is doing now: running, or why the last one failed */
  analysis: InterviewAnalysis | null; analysisState?: AnalysisState
  /** the Agent Skills written from it (Skill Studio), and what writing them is doing now */
  skills: Skill[]; skillsState?: SkillsState }

export type InterviewDraft = Pick<Interview, 'title' | 'domain' | 'goal' | 'language' | 'minutes'>

/**
 * voiceRegion and voiceModelId: Amazon Nova Sonic, in a region of its own (it runs in a few regions only, without
 * cross-region inference). analysisModelId: Claude for planning, analysis and skills; the notes model when emptied.
 * keepAudio: the interview's audio is kept on this computer (and can be removed on its own).
 */
export type ExpertSettings = { voiceRegion: string; voiceModelId: string; analysisModelId: string; keepAudio: boolean }
// Claude Sonnet 4.5 through the EU inference profile: newer Claude models come through AWS Marketplace, which the
// AWS Free plan leaves out
export const EXPERT_DEFAULTS: ExpertSettings = { voiceRegion: 'eu-north-1', voiceModelId: 'amazon.nova-2-5-sonic', analysisModelId: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0', keepAudio: true }

/** where it all goes: Bedrock as set up for the notes (Settings → Notes model), and the folder it is kept in */
export type ExpertView = {
  settings: ExpertSettings
  bedrock: { ready: boolean; region: string; modelId: string }
  dataDir: string
}

export type SourcesResult = { ok: true; sources: InterviewSource[]; skipped: Array<{ name: string; reason: 'too-big' | 'not-text' | 'too-many' | 'unreadable' }> } | { ok: false; reason: 'canceled' | 'missing' }

export type ExpertApi = {
  view(): Promise<ExpertView>
  setSettings(patch: Partial<ExpertSettings>): Promise<ExpertView>
  list(): Promise<InterviewCard[]>
  get(id: string): Promise<InterviewDetail | null>
  create(draft: InterviewDraft): Promise<Interview | null>
  update(id: string, patch: Partial<InterviewDraft>): Promise<Interview | null>
  /** a native dialog in main picks the files: a page never names a path */
  addSources(id: string): Promise<SourcesResult>
  removeSource(id: string, sourceId: string): Promise<InterviewSource[]>
  /** the expert agreed to what is sent to Bedrock, with the regions and models of now */
  consent(id: string): Promise<Interview | null>
  /** the interview, its sources and its audio, for good */
  delete(id: string): Promise<boolean>
  /** the expert's correction of a line; what was heard is kept beside it */
  editSegment(id: string, segmentId: string, text: string): Promise<TranscriptSegment | null>
  /** the interview's audio alone; the transcript stays */
  deleteAudio(id: string): Promise<boolean>
  /** Claude reads the interview so far: it runs in the background, and the page hears of it through onChange */
  analyze(id: string): Promise<AnalysisState | null>
  /** the expert keeps a follow-up question for the next session, or sets it aside */
  setFollowUp(id: string, questionId: string, status: Exclude<FollowUpStatus, 'asked'>): Promise<InterviewAnalysis | null>
  /** Claude writes Agent Skills from the analysis; the skills the expert changed are kept */
  writeSkills(id: string): Promise<SkillsState | null>
  /** a blank skill, written by the expert */
  newSkill(id: string): Promise<Skill | null>
  updateSkill(id: string, skillId: string, patch: SkillPatch): Promise<Skill | null>
  deleteSkill(id: string, skillId: string): Promise<boolean>
  /** one skill, or all of them (no skillId), as a zip saved where main's dialog says */
  exportSkills(id: string, skillId?: string): Promise<SkillsExport>
  showData(): void
  onChange(fn: () => void): () => void
  voice: VoiceApi
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const line = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : undefined)
const block = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max) : undefined)

export const isInterviewLanguage = (v: unknown): v is InterviewLanguage => (INTERVIEW_LANGUAGES as readonly unknown[]).includes(v)

/** the fields of an interview a page may set, each checked on its own; undefined for anything that isn't one */
export function cleanDraftPatch(v: unknown): Partial<InterviewDraft> | undefined {
  if (!isObject(v)) return undefined
  const out: Partial<InterviewDraft> = {}
  const title = line(v.title, TITLE_MAX), domain = line(v.domain, DOMAIN_MAX), goal = block(v.goal, GOAL_MAX)
  if (title) out.title = title
  if (domain !== undefined) out.domain = domain
  if (goal !== undefined) out.goal = goal
  if (isInterviewLanguage(v.language)) out.language = v.language
  if (typeof v.minutes === 'number' && Number.isFinite(v.minutes)) out.minutes = Math.min(MINUTES_MAX, Math.max(MINUTES_MIN, Math.round(v.minutes)))
  return out
}

/** a new interview needs a title; the rest has a default */
export function cleanDraft(v: unknown, language: InterviewLanguage = 'en-US'): InterviewDraft | undefined {
  const p = cleanDraftPatch(v)
  if (!p?.title) return undefined
  return { title: p.title, domain: p.domain ?? '', goal: p.goal ?? '', language: p.language ?? language, minutes: p.minutes ?? 30 }
}

/** the interview language closest to the app's: same language first, then English */
export function interviewLanguageFor(locale: string): InterviewLanguage {
  if (isInterviewLanguage(locale)) return locale
  const lang = locale.split('-')[0]
  return INTERVIEW_LANGUAGES.find((l) => l.startsWith(`${lang}-`)) ?? 'en-US'
}

/** the consent still holds: given, and for the regions and models in use now */
export const consentHolds = (c: Consent | null, now: Omit<Consent, 'at'>): boolean =>
  !!c && c.voiceRegion === now.voiceRegion && c.voiceModelId === now.voiceModelId && c.region === now.region && c.modelId === now.modelId

/** the routes of expert interviews: the list, and one interview */
export const isExpertRoute = (route: string): boolean => route === '/interviews' || /^\/interview\/[\w-]{1,64}$/.test(route)
