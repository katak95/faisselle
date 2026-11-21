/**
 * A meeting's action items as a list to tick: who, what, by when. Taken from the notes once they are written
 * (main/notes/actions.ts), kept with the meeting, and ticked off in the note's Actions.
 */
export type ActionItem = { owner: string; task: string; /** as it was said ("Friday", "end of March"), or null */ due: string | null; done: boolean }

export const ACTIONS_MAX = 40
export const OWNER_MAX = 80
export const TASK_MAX = 300
export const DUE_MAX = 60

const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** one item from the model or the window: owner and task required, the rest cleaned */
export function cleanAction(v: unknown): ActionItem | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  const owner = clean(r.owner, OWNER_MAX), task = clean(r.task, TASK_MAX), due = clean(r.due, DUE_MAX)
  if (!task) return null
  return { owner: owner || '?', task, due: due && !/^(null|none|n\/a|-)$/i.test(due) ? due : null, done: r.done === true }
}

export const cleanActions = (v: unknown): ActionItem[] => (Array.isArray(v) ? v.map(cleanAction).filter((a): a is ActionItem => !!a).slice(0, ACTIONS_MAX) : [])

/**
 * The list in a model's answer: plain JSON (Bedrock is held to the schema), or JSON somewhere in the text (a local
 * model may add words or a code fence around it). Anything that isn't a list of items is no list.
 */
export function parseActions(raw: string): ActionItem[] | null {
  const text = raw.trim()
  const tryParse = (s: string): unknown => { try { return JSON.parse(s) } catch { return undefined } }
  let v = tryParse(text)
  if (v === undefined) {
    const start = text.search(/[[{]/), end = Math.max(text.lastIndexOf(']'), text.lastIndexOf('}'))
    if (start >= 0 && end > start) v = tryParse(text.slice(start, end + 1))
  }
  if (v && typeof v === 'object' && !Array.isArray(v) && Array.isArray((v as { items?: unknown }).items)) v = (v as { items: unknown }).items
  if (!Array.isArray(v)) return null
  return cleanActions(v.map((x) => (x && typeof x === 'object' ? { ...(x as object), done: false } : x)))
}

const key = (a: Pick<ActionItem, 'task'>) => a.task.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** notes written again: an item that is still there (same task) keeps its tick */
export const keepTicks = (fresh: ActionItem[], old: ActionItem[]): ActionItem[] => {
  const done = new Set(old.filter((a) => a.done).map(key))
  return fresh.map((a) => ({ ...a, done: a.done || done.has(key(a)) }))
}

/** the list as Markdown, to copy */
export const actionsMarkdown = (items: ActionItem[]): string =>
  items.map((a) => `- [${a.done ? 'x' : ' '}] **${a.owner}:** ${a.task}${a.due ? ` (${a.due})` : ''}`).join('\n')
