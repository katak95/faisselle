// Expert interviews, analysis in main: Claude on Bedrock (the analysis model, in the notes' region) reads the
// interview so far and says what it learned and what to ask next. One analysis at a time per interview, in the
// background; the page follows it through `changed` and the state it sends.
import { randomUUID } from 'node:crypto'
import { BedrockError } from '../notes/bedrock'
import type { Llm } from '../notes/enhance'
import type { ExpertStore } from './store'
import { languageName } from './voice'
import { ANALYSIS_SCHEMA, analysisPrompt, cleanAnalysis, type AnalysisFailure, type AnalysisState } from '../../shared/expert/analysis'
import type { Interview } from '../../shared/expert/types'

/** room for a long interview's items and questions */
const ANALYSIS_MAX_TOKENS = 12_000

export type AnalysisDeps = {
  store: ExpertStore
  /** Claude with the analysis model; it throws when Bedrock isn't set up */
  llm(signal: AbortSignal): Promise<Llm>
  /** the analysis model in use now, saved with the analysis */
  modelId(): string
  /** the interview may be sent to Claude: agreed to for the regions and models of now */
  agreed(i: Interview): boolean
  /** the voice is talking in this interview now */
  talking(id: string): boolean
  /** the company context (Settings), as the notes give it */
  organisation?(): string[]
  /** what an analysis is doing changed (running, failed, or done: then null) */
  send(s: AnalysisState | { interviewId: string; state: 'done' }): void
  now?: () => number
}

export function createAnalysis(d: AnalysisDeps) {
  const now = d.now ?? Date.now
  const running = new Map<string, AbortController>()
  const failed = new Map<string, Extract<AnalysisState, { state: 'failed' }>>()

  const fail = (id: string, reason: AnalysisFailure, detail?: string): AnalysisState => {
    const s = { interviewId: id, state: 'failed' as const, reason, ...(detail ? { detail } : {}) }
    failed.set(id, s)
    d.send(s)
    return s
  }

  async function run(i: Interview, abort: AbortController) {
    const id = i.id
    try {
      const segments = d.store.segments(id)
      const before = d.store.analysis(id)?.followUps
      const prompt = analysisPrompt({ interview: i, language: languageName(i.language), segments, sources: d.store.sourceTexts(id), before, organisation: d.organisation?.() })
      const llm = await d.llm(abort.signal)
      const raw = await llm.chat(prompt, () => {}, { json: ANALYSIS_SCHEMA as unknown as Record<string, unknown>, maxTokens: ANALYSIS_MAX_TOKENS })
      if (abort.signal.aborted) return
      const a = cleanAnalysis(raw, { at: now(), modelId: d.modelId(), segments: segments.length, before, id: randomUUID })
      if (!a) { fail(id, 'unreadable'); return }
      // deleted meanwhile: nothing to keep it in
      if (!d.store.get(id)) return
      d.store.setAnalysis(id, a)
      failed.delete(id)
      d.send({ interviewId: id, state: 'done' })
    } catch (e) {
      if (abort.signal.aborted) return
      console.warn('analysing the interview failed', e)
      const kind = e instanceof BedrockError ? e.kind : undefined
      fail(id, kind === 'sign-in' ? 'bedrock' : kind === 'refused' ? 'refused' : 'failed', e instanceof Error ? e.message.slice(0, 300) : undefined)
    } finally {
      if (running.get(id) === abort) running.delete(id)
    }
  }

  return {
    /** what the interview's analysis is doing: running, failed (and why), or nothing */
    state(id: string): AnalysisState | undefined {
      return running.has(id) ? { interviewId: id, state: 'running' } : failed.get(id)
    },
    /** starts an analysis of the interview so far; it says at once when it can't */
    start(id: string): AnalysisState {
      const i = d.store.get(id)
      if (!i) return fail(id, 'failed')
      if (running.has(id)) return { interviewId: id, state: 'running' }
      if (!d.agreed(i)) return fail(id, 'consent')
      if (d.talking(id)) return fail(id, 'busy')
      if (!d.store.segments(id).some((s) => s.speaker === 'expert')) return fail(id, 'no-transcript')
      const abort = new AbortController()
      running.set(id, abort)
      failed.delete(id)
      const s: AnalysisState = { interviewId: id, state: 'running' }
      d.send(s)
      void run(i, abort)
      return s
    },
    /** the interview was deleted: its analysis stops */
    forget(id: string) { running.get(id)?.abort(); running.delete(id); failed.delete(id) },
  }
}
export type Analysis = ReturnType<typeof createAnalysis>
