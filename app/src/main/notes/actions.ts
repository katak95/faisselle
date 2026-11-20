/** The prompt that turns the notes just written into a list of action items (shared/actions.ts). */

export const ACTIONS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    items: { type: 'array', items: { type: 'object', properties: {
      owner: { type: 'string' }, task: { type: 'string' }, due: { type: ['string', 'null'] },
    }, required: ['owner', 'task', 'due'], additionalProperties: false } },
  },
  required: ['items'], additionalProperties: false,
}

export const actionsPrompt = () => [
  'Now list the action items from this meeting as JSON: everything someone said they would do after it, the ones in "## Next steps" and any others the notes make clear.',
  'Answer with only this JSON, nothing before or after it: {"items":[{"owner":"…","task":"…","due":"…"}]}',
  '- owner: the name as in the notes, "You" for the person the notes are for, or plain words like "The designer".',
  '- task: what they will do, short, in the same language as the notes.',
  '- due: when, only if it was said, as it was said; otherwise null.',
  'If nobody is to do anything, answer {"items":[]}.',
].join('\n')
