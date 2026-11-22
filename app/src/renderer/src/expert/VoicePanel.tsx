import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Pause, Pencil, Play, Trash2 } from '../components/Icons'
import { InlineError } from '../components/InlineError'
import { Modal, ModalClose } from '../components/Modal'
import { clock } from '../../../shared/transcript'
import { t } from '../../../shared/i18n'
import type { Interview } from '../../../shared/expert/types'
import { SEGMENT_MAX, type TranscriptSegment, type VoiceState, type VoiceView } from '../../../shared/expert/voice'
import { createPlayer, startMicrophone, type MicError } from './audio'

const LIVE: VoiceState[] = ['connecting', 'listening', 'thinking', 'speaking', 'reconnecting']

const stateLabel = (s: VoiceState): string => ({
  idle: '', connecting: t('Connecting…'), listening: t('Listening'), thinking: t('Thinking'), speaking: t('Speaking'),
  paused: t('Paused'), reconnecting: t('Reconnecting…'), ended: t('Ended'), failed: t('Stopped'),
})[s]

function errorText(v: VoiceView): string {
  const k = v.error?.kind
  if (k === 'not-ready') return t('Agree to what is sent to Bedrock first, with Amazon Bedrock signed in.')
  if (k === 'sign-in') return t('The AWS sign-in ran out. Sign in again in Settings → Notes model, then resume.')
  if (k === 'access') return t('The role may not use Amazon Nova Sonic ({model}) in {region}. It needs bedrock:InvokeModel there, with the model enabled in that region.', { model: v.modelId, region: v.region })
  if (k === 'model') return t('{model} is not available in {region}. Check the voice model and region in Settings → Expert interviews.', { model: v.modelId, region: v.region })
  if (k === 'busy') return t('Amazon Nova Sonic is busy, or the account has reached its number of conversations at once. Try again in a moment.')
  if (k === 'network') return t('The connection to AWS was lost. Check the network, then resume.')
  return t("The interview stopped: Bedrock didn't answer as expected. Try again.")
}

function micText(e: MicError): string {
  if (e === 'denied') return t('Faisselle may not use the microphone. Allow it in System Settings, then resume.')
  if (e === 'none') return t('No microphone was found. Plug one in, then resume.')
  return t("The microphone couldn't start. Try again.")
}

/** the voice interview's state, as main tells it */
function useVoice() {
  const [v, setView] = useState<VoiceView>()
  // the latest view wins, however they arrive
  const setV = useCallback((next: VoiceView) => setView((cur) => (cur && cur.seq > next.seq ? cur : next)), [])
  useEffect(() => {
    void window.yogurt.expert.voice.state().then(setV)
    return window.yogurt.expert.voice.onState(setV)
  }, [setV])
  return [v, setV] as const
}

/** a clock that runs while the interview does */
function useElapsed(v: VoiceView | undefined, live: boolean) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!live) return
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [live])
  if (!v) return 0
  return v.elapsedMs + (live && v.state !== 'connecting' ? Date.now() - v.at : 0)
}

/**
 * The voice interview on its interview's page: start, pause, mute, end; what was said, each line correctable. The
 * microphone runs only while this page shows a live interview: leaving the page, or hiding the window, pauses it.
 */
export function VoicePanel({ interview: i, segments, audioBytes, canStart }: { interview: Interview; segments: TranscriptSegment[]; audioBytes: number; canStart: boolean }) {
  const [v, setV] = useVoice()
  const mine = v?.interviewId === i.id
  const state: VoiceState = mine ? v!.state : 'idle'
  const live = LIVE.includes(state)
  const [micError, setMicError] = useState<MicError>()
  const [level, setLevel] = useState(0)
  const [lines, setLines] = useState(segments)
  const [deletingAudio, setDeletingAudio] = useState(false)
  useEffect(() => setLines(segments), [segments])
  const elapsed = useElapsed(mine ? v : undefined, live)
  const call = (p: Promise<VoiceView>) => void p.then(setV)

  // new lines as they are said
  useEffect(() => window.yogurt.expert.voice.onSegment((s) => {
    if (s.interviewId === i.id) setLines((cur) => (cur.some((x) => x.id === s.id) ? cur : [...cur, s]))
  }), [i.id])

  // the sound: the microphone to main, the agent's voice from it, while the interview is live
  useEffect(() => {
    if (!live) return
    let mic: Awaited<ReturnType<typeof startMicrophone>> | undefined, gone = false
    const player = createPlayer()
    const offs = [window.yogurt.expert.voice.onAudio((pcm) => player.play(pcm)), window.yogurt.expert.voice.onInterrupted(() => player.flush())]
    let lastLevel = 0
    void startMicrophone({
      onFrame: (pcm) => window.yogurt.expert.voice.audio(pcm),
      onLevel: (peak) => { const now = performance.now(); if (now - lastLevel > 100) { lastLevel = now; setLevel(peak) } },
      onError: (e) => { setMicError(e); call(window.yogurt.expert.voice.pause()) },
    }).then((m) => { if (gone) m.stop(); else { mic = m; setMicError(undefined) } }, () => { setMicError('failed'); call(window.yogurt.expert.voice.pause()) })
    return () => { gone = true; mic?.stop(); for (const off of offs) off(); player.close(); setLevel(0) }
  }, [live])

  // the interview doesn't go on unseen: leaving its page, or hiding the window, pauses it
  const liveRef = useRef(live)
  liveRef.current = live
  useEffect(() => {
    const hidden = () => { if (document.hidden && liveRef.current) call(window.yogurt.expert.voice.pause()) }
    document.addEventListener('visibilitychange', hidden)
    return () => { document.removeEventListener('visibilitychange', hidden); if (liveRef.current) void window.yogurt.expert.voice.pause() }
  }, [i.id])

  const begin = () => { setMicError(undefined); call(state === 'paused' || state === 'failed' ? window.yogurt.expert.voice.resume() : window.yogurt.expert.voice.start(i.id)) }

  return <>
    <h2 className="settings-section-heading">{t('Interview')}</h2>
    <div data-testid="voice-panel" className="settings-group">
      <div className="settings-row">
        <span className="settings-permission-icon">{v?.muted && mine ? <MicOff size={17} aria-hidden="true" /> : <Mic size={17} aria-hidden="true" />}</span>
        <div className="settings-row-copy">
          <span data-testid="voice-state" data-state={state} className="settings-label" aria-live="polite">{stateLabel(state) || (lines.length ? t('Ready to go on') : t('Ready when you are'))}</span>
          <p className="settings-description">
            <span data-testid="voice-clock">{clock(elapsed)}</span>
            {live && <span aria-hidden="true" className="ms-2 inline-block h-2 rounded-full bg-accent align-middle" style={{ width: `${Math.max(4, Math.round(level * 60))}px` }} />}
          </p>
        </div>
        {!live && state !== 'ended' && <button data-testid="voice-start" className="workspace-button" disabled={!canStart} onClick={begin}>
          <Play size={14} aria-hidden="true" /> {state === 'paused' || state === 'failed' ? t('Resume') : lines.length ? t('Continue the interview') : t('Start the interview')}</button>}
        {state === 'ended' && <button data-testid="voice-start" className="workspace-button" disabled={!canStart} onClick={begin}><Play size={14} aria-hidden="true" /> {t('Continue the interview')}</button>}
        {live && <>
          <button data-testid="voice-mute" className="ghost-btn workspace-icon" aria-pressed={!!v?.muted} aria-label={v?.muted ? t('Unmute') : t('Mute')} title={v?.muted ? t('Unmute') : t('Mute')}
            onClick={() => call(window.yogurt.expert.voice.mute(!v?.muted))}>{v?.muted ? <MicOff size={14} aria-hidden="true" /> : <Mic size={14} aria-hidden="true" />}</button>
          <button data-testid="voice-pause" className="workspace-button" onClick={() => call(window.yogurt.expert.voice.pause())}><Pause size={14} aria-hidden="true" /> {t('Pause')}</button>
        </>}
        {(live || state === 'paused' || state === 'failed') && <button data-testid="voice-stop" className="workspace-button" onClick={() => call(window.yogurt.expert.voice.stop())}>{t('End the interview')}</button>}
      </div>
      {!canStart && !live && <p data-testid="voice-not-ready" className="settings-description px-3 pb-3">{t('Agree to what is sent to Bedrock first, with Amazon Bedrock signed in.')}</p>}
      {mine && state === 'failed' && v?.error && <InlineError testId="voice-error" className="mx-3 mb-3"><span>{errorText(v)}</span></InlineError>}
      {micError && <InlineError testId="voice-mic-error" className="mx-3 mb-3"><span>{micText(micError)}</span></InlineError>}
      {live && <p className="settings-description px-3 pb-3">{t('Headphones work best: the agent then never hears itself.')}</p>}
    </div>

    <h2 className="settings-section-heading">{t('Transcript')}</h2>
    <div data-testid="voice-transcript" className="settings-group">
      {!lines.length && <p className="settings-description px-3 py-3">{t('What you and the agent say appears here. You can correct any line.')}</p>}
      {lines.map((s) => <Line key={s.id} interviewId={i.id} segment={s} onSaved={(n) => setLines((cur) => cur.map((x) => (x.id === n.id ? n : x)))} />)}
      {audioBytes > 0 && !live && <div className="settings-row">
        <div className="settings-row-copy"><p className="settings-description">{t('The audio is kept on this computer.')}</p></div>
        <button data-testid="voice-delete-audio" className="workspace-button" onClick={() => setDeletingAudio(true)}><Trash2 size={14} aria-hidden="true" /> {t('Delete audio')}</button>
      </div>}
    </div>
    {deletingAudio && <DeleteAudio id={i.id} onDone={() => setDeletingAudio(false)} />}
  </>
}

function Line({ interviewId, segment: s, onSaved }: { interviewId: string; segment: TranscriptSegment; onSaved(s: TranscriptSegment): void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(s.text)
  const save = async () => {
    const next = text.trim()
    if (next && next !== s.text) { const out = await window.yogurt.expert.editSegment(interviewId, s.id, next); if (out) onSaved(out) }
    setEditing(false)
  }
  return <div data-testid="voice-line" data-speaker={s.speaker} className="settings-row items-start">
    <span className="w-12 flex-none pt-0.5 text-[12px] tabular-nums text-muted">{clock(s.atMs)}</span>
    <div className="settings-row-copy">
      <span className="settings-label">{s.speaker === 'expert' ? t('You') : t('Agent')}{s.edited && <span data-testid="voice-line-edited" className="ms-2 text-[12px] font-normal text-muted">{t('Corrected')}</span>}</span>
      {editing
        ? <textarea data-testid="voice-line-input" data-dialog-focus autoFocus rows={Math.min(8, Math.ceil(text.length / 80) + 1)} maxLength={SEGMENT_MAX} value={text} onChange={(e) => setText(e.target.value)}
          onBlur={() => void save()} onKeyDown={(e) => { if (e.key === 'Escape') { setText(s.text); setEditing(false) } if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void save() } }}
          className="mt-1 w-full rounded-md border border-line bg-bg px-2 py-1.5 text-[13px] text-ink" />
        : <p data-testid="voice-line-text" className="settings-description whitespace-pre-wrap text-ink">{s.text}</p>}
    </div>
    {!editing && <button data-testid="voice-line-edit" className="ghost-btn workspace-icon" aria-label={t('Correct this line')} title={t('Correct this line')} onClick={() => { setText(s.text); setEditing(true) }}><Pencil size={14} aria-hidden="true" /></button>}
  </div>
}

function DeleteAudio({ id, onDone }: { id: string; onDone(): void }) {
  const [busy, setBusy] = useState(false)
  return <Modal testId="voice-delete-audio-confirm" role="alertdialog" title={t('Delete the audio of this interview?')}
    description={t('The transcript stays, with everything made from it. You can no longer listen to what was said, to check a line against it.')} onCancel={onDone} busy={busy}>
    <div className="modal-actions">
      <button data-testid="voice-delete-audio-yes" className="modal-button danger" disabled={busy} onClick={() => { setBusy(true); void window.yogurt.expert.deleteAudio(id).finally(onDone) }}>{t('Delete audio')}</button>
      <ModalClose data-dialog-cancel disabled={busy} className="workspace-button">{t('Cancel')}</ModalClose>
    </div>
  </Modal>
}
