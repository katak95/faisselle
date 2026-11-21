/* rebrand: keep-file (about merging Yogurt) */
import { expect, it } from 'vitest'
import { mergeObjects } from '../scripts/merge-json.mjs'

// the translation tables in a merge with Yogurt: both sides add texts at the end of the same object
it('merges translation tables key by key, each side keeping its own changes', () => {
  const base = { A: 'a', B: 'b', C: 'c', D: 'd' }
  const ours = { A: 'a', B: 'b (Faisselle)', C: 'c', D: 'd', F1: 'Faisselle 1' }
  const theirs = { A: 'a (Yogurt)', B: 'b (Yogurt)', D: 'd', Y1: 'Yogurt 1' }
  const { merged, kept } = mergeObjects(base, ours, theirs)
  // A: only theirs changed; B: both changed, ours kept; C: theirs removed it; new keys from both
  expect(merged).toEqual({ A: 'a (Yogurt)', B: 'b (Faisselle)', D: 'd', F1: 'Faisselle 1', Y1: 'Yogurt 1' })
  expect(Object.keys(merged)).toEqual(['A', 'B', 'D', 'F1', 'Y1'])
  expect(kept).toEqual(['B'])
})
