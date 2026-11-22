import { ipcRenderer } from 'electron'
import type { ExpertApi } from '../shared/expert/types'

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
  showData: () => { ipcRenderer.send('expert:show-data') },
  onChange: (fn) => { const f = () => fn(); ipcRenderer.on('expert:changed', f); return () => { ipcRenderer.off('expert:changed', f) } },
}
