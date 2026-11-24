import { useEffect, useState } from 'react'
import { t } from '../../../shared/i18n'
import { analysisStale, KNOWLEDGE_KINDS, type AnalysisFailure, type Coverage, type FollowUpQuestion, type KnowledgeKind } from '../../../shared/expert/analysis'
import type { InterviewDetail } from '../../../shared/expert/types'

const kindLabel = (k: KnowledgeKind): string => ({
  procedure: t('Steps'), rule: t('Rules'), heuristic: t('Judgement calls'), fact: t('Facts'), pitfall: t('Pitfalls'), example: t('Examples'),
})[k]
const coverageLabel = (c: Coverage): string => ({
  thin: t('The goal is barely covered yet'), partial: t('Part of the goal is covered'), good: t('Enough to write skills from'),
})[c]
const failureText = (r: AnalysisFailure): string => ({
  consent: t('Agree to what is sent to Bedrock first (Before you talk).'),
  bedrock: t('Set up Bedrock first, in Settings → Notes model.'),
  'no-transcript': t('Talk with the interviewer first: there is nothing to analyse yet.'),
  busy: t('Pause the interview first: it is analysed between sessions.'),
  refused: t('Claude declined to analyse this interview.'),
  unreadable: t("Claude's answer couldn't be read. Try again."),
  failed: t("The interview couldn't be analysed. Try again."),
})[r]

/**
 * The analysis of the interview so far: what Claude learned (grouped as steps, rules, judgement calls…, each with the
 * expert's own words), how well the goal is covered, and the questions to ask next. The questions kept are put to
 * the expert at the start of the next voice session.
 */
const TALKING = ['connecting', 'listening', 'thinking', 'speaking', 'reconnecting']

/** the voice is talking in this interview now: it is analysed between sessions */
function useTalking(id: string): boolean {
  const [talking, setTalking] = useState(false)
  useEffect(() => {
    const seen = (v: { interviewId: string | null; state: string }) => setTalking(v.interviewId === id && TALKING.includes(v.state))
    void window.yogurt.expert.voice.state().then(seen)
    return window.yogurt.expert.voice.onState(seen)
  }, [id])
  return talking
}

export function AnalysisPanel({ id, detail }: { id: string; detail: InterviewDetail }) {
  const [busy, setBusy] = useState(false)
  const talking = useTalking(id)
  const a = detail.analysis, s = detail.analysisState
  const running = s?.state === 'running' || busy
  const heard = detail.segments.some((x) => x.speaker === 'expert')
  const stale = analysisStale(a, detail.segments.length)
  const analyze = () => { setBusy(true); void window.yogurt.expert.analyze(id).finally(() => setBusy(false)) }
  const follow = (q: FollowUpQuestion, status: 'open' | 'dismissed') => void window.yogurt.expert.setFollowUp(id, q.id, status)
  const open = a?.followUps.filter((q) => q.status === 'open') ?? []
  const asked = a?.followUps.filter((q) => q.status !== 'open') ?? []

  return <>
    <h2 className="settings-section-heading">{t('Analysis')}</h2>
    <div data-testid="interview-analysis" data-state={running ? 'running' : a ? 'done' : 'none'} className="settings-group">
      <div className="settings-row">
        <div className="settings-row-copy">
          <span className="settings-label">{a ? coverageLabel(a.coverage) : t('What Claude learned from the interview')}</span>
          <p data-testid="analysis-status" className="settings-description" aria-live="polite">{running ? t('Claude is reading the interview…')
            : s?.state === 'failed' ? failureText(s.reason)
            : stale ? t('The interview went on since: analyse it again to take the new answers in.')
            : a ? t('Analysed on {date}.', { date: new Date(a.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) })
            : t('Claude reads the transcript and your documents, says what it learned and what to ask next.')}</p>
        </div>
        <button data-testid="analysis-run" className="workspace-button" disabled={running || talking || !heard} onClick={analyze}>
          {running ? t('Analysing…') : a ? t('Analyse again') : t('Analyse the interview')}</button>
      </div>

      {a && <>
        <p data-testid="analysis-summary" className="settings-description px-5 pb-2 text-ink" dir="auto">{a.summary}</p>
        {a.gaps && <p data-testid="analysis-gaps" className="settings-description px-5 pb-2" dir="auto"><span className="text-ink">{t('Still missing:')}</span> {a.gaps}</p>}
        {KNOWLEDGE_KINDS.filter((k) => a.items.some((it) => it.kind === k)).map((k) => <div key={k} data-testid="analysis-kind" data-kind={k} className="px-5 pb-4">
          <p className="settings-label">{kindLabel(k)}</p>
          <ul className="mt-1 flex flex-col gap-2">
            {a.items.filter((it) => it.kind === k).map((it) => <li key={it.id} data-testid="analysis-item" className="text-[13px]" dir="auto">
              <span className="text-ink font-medium">{it.title}</span>
              <span className="text-muted"> · {it.detail}</span>
              {it.quotes.map((q) => <blockquote key={q} data-testid="analysis-quote" className="mt-1 border-s-2 border-line ps-2 text-[12px] text-muted">{q}</blockquote>)}
            </li>)}
          </ul>
        </div>)}
      </>}
    </div>

    {a && (open.length > 0 || asked.length > 0) && <>
      <h2 className="settings-section-heading">{t('Questions to ask next')}</h2>
      <div data-testid="analysis-follow-ups" className="settings-group">
        <p className="settings-description px-5 pt-3">{t('The questions you keep are asked at the start of your next voice session.')}</p>
        {[...open, ...asked].map((q) => <div key={q.id} data-testid="follow-up" data-status={q.status} className="settings-row">
          <div className="settings-row-copy" dir="auto">
            <span className={`settings-label${q.status === 'dismissed' ? ' line-through opacity-60' : ''}`}>{q.question}</span>
            <p className="settings-description">{q.status === 'asked' ? t('Asked in a voice session') : q.why}</p>
          </div>
          {q.status === 'open' && <button data-testid="follow-up-dismiss" className="workspace-button" onClick={() => follow(q, 'dismissed')}>{t('Set aside')}</button>}
          {q.status === 'dismissed' && <button data-testid="follow-up-keep" className="workspace-button" onClick={() => follow(q, 'open')}>{t('Keep')}</button>}
        </div>)}
      </div>
    </>}
  </>
}
