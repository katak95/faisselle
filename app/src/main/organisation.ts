/**
 * What the person wrote about their organisation (Settings → Company context): what it does, its clients, products,
 * teams, words and anything else that helps the model read their meetings. Read each time a prompt is written, so a
 * change counts from the next one on. It goes, as background, into the notes, the action items, the follow-up email,
 * the brief and Ask; never as something said in a meeting. It is shared with the setup (configShare.ts).
 */

/** long enough for a page about the organisation, short enough for the local model's prompt */
export const ORGANISATION_MAX = 4000

/** the text as Settings keeps it: plain, trimmed, at most ORGANISATION_MAX characters */
export function cleanOrganisation(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, ORGANISATION_MAX).trim()
}

let organisationOf = (): string => ''
export const setOrganisation = (f: () => string): void => { organisationOf = f }

export const organisationIntro = 'About the organisation the person works in, as they wrote it themselves: what it does, its clients, products, teams and words. Use it to understand what the meeting was about, who people and names are, and what matters to them. It is background: never write something from it as if it was said in the meeting:'

/** the organisation as lines of a prompt (nothing when the person wrote none) */
export function organisationBlock(): string[] {
  const text = cleanOrganisation(organisationOf())
  return text ? [organisationIntro, '<organisation>', text, '</organisation>', ''] : []
}
