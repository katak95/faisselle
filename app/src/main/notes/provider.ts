import type { NotesModel } from './model'

/** where the notes are written: the model on this computer, or Claude on Amazon Bedrock */
export type NotesProvider = 'local' | 'bedrock'
export const isProvider = (v: unknown): v is NotesProvider => v === 'local' || v === 'bedrock'

type Model = Pick<NotesModel, 'llm' | 'unload' | 'loaded' | 'needsLoad'>

/**
 * The notes model the rest of the app sees: the local one or Bedrock's, whichever Settings says right now. A job
 * asks for the model when it starts, so a switch applies to the next note; the local model is let go when Bedrock
 * takes over, so it doesn't hold memory meanwhile.
 */
export function createSwitchingNotesModel(o: { local: Model; bedrock: Model; provider: () => NotesProvider }): Model & { /** the local model is let go after a switch to Bedrock */ switched(): Promise<void> } {
  const current = () => (o.provider() === 'bedrock' ? o.bedrock : o.local)
  return {
    llm: (signal) => current().llm(signal),
    unload: () => current().unload(),
    loaded: () => current().loaded(),
    needsLoad: () => current().needsLoad(),
    async switched() { if (o.provider() === 'bedrock') await o.local.unload() },
  }
}
