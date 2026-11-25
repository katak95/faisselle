import { ipcRenderer } from 'electron'
import type { ExpertApi } from '../shared/expert/types'
import type { TranscriptSegment, VoiceView } from '../shared/expert/voice'

/** window.yogurt.expert: expert interviews (main/expert/ipc.ts) */
export const expert: ExpertApi = {
  view: () => ipcRenderer.invoke('expert:view'),
  setSettings: (patch) => ipcRenderer.invoke('expert:settings', patch),
  list: () => ipcRenderer.invoke('expert:list'),
  get: (id) => ipcRenderer.invoke('expert:get', id),
  create: (draft) => ipcRenderer.invoke('expert:create', draft),
  update: (id, patch) => ipcRenderer.invoke('expert:update', id, patch),
  addSources: (id) => ipcRenderer.invoke('expert:add-sources', id),
  removeSource: (id, sourceId) => ipcRenderer.invoke('expert:remove-source', id, sourceId),
  consent: (id) => ipcRenderer.invoke('expert:consent', id),
  delete: (id) => ipcRenderer.invoke('expert:delete', id),
  editSegment: (id, segmentId, text) => ipcRenderer.invoke('expert:edit-segment', id, segmentId, text),
  deleteAudio: (id) => ipcRenderer.invoke('expert:delete-audio', id),
  analyze: (id) => ipcRenderer.invoke('expert:analyze', id),
  setFollowUp: (id, questionId, status) => ipcRenderer.invoke('expert:follow-up', id, questionId, status),
  writeSkills: (id) => ipcRenderer.invoke('expert:write-skills', id),
  newSkill: (id) => ipcRenderer.invoke('expert:skill-new', id),
  updateSkill: (id, skillId, patch) => ipcRenderer.invoke('expert:skill-update', id, skillId, patch),
  deleteSkill: (id, skillId) => ipcRenderer.invoke('expert:skill-delete', id, skillId),
  exportSkills: (id, skillId) => ipcRenderer.invoke('expert:skills-export', id, skillId),
  showData: () => { ipcRenderer.send('expert:show-data') },
  onChange: (fn) => { const f = () => fn(); ipcRenderer.on('expert:changed', f); return () => { ipcRenderer.off('expert:changed', f) } },
  voice: {
    state: () => ipcRenderer.invoke('expert:voice-state'),
    start: (id) => ipcRenderer.invoke('expert:voice-start', id),
    pause: () => ipcRenderer.invoke('expert:voice-pause'),
    resume: () => ipcRenderer.invoke('expert:voice-resume'),
    stop: () => ipcRenderer.invoke('expert:voice-stop'),
    mute: (on) => ipcRenderer.invoke('expert:voice-mute', on),
    audio: (frame) => { ipcRenderer.send('expert:voice-audio', frame) },
    onState: (fn) => { const f = (_e: unknown, v: VoiceView) => fn(v); ipcRenderer.on('expert:voice-state', f); return () => { ipcRenderer.off('expert:voice-state', f) } },
    onAudio: (fn) => { const f = (_e: unknown, pcm: Uint8Array) => fn(pcm); ipcRenderer.on('expert:voice-audio', f); return () => { ipcRenderer.off('expert:voice-audio', f) } },
    onInterrupted: (fn) => { const f = () => fn(); ipcRenderer.on('expert:voice-interrupted', f); return () => { ipcRenderer.off('expert:voice-interrupted', f) } },
    onSegment: (fn) => { const f = (_e: unknown, s: TranscriptSegment) => fn(s); ipcRenderer.on('expert:voice-segment', f); return () => { ipcRenderer.off('expert:voice-segment', f) } },
  },
}
