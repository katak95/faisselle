// rebrand: keep-file (the merge of Yogurt's changes)
// A git merge driver for the translation tables (app/src/shared/locales/*.json): both sides add their new texts at the
// end of the same object, which a line merge can't put together. This merges them key by key instead:
//   - a key only one side added, changed or removed takes that side's change;
//   - a key both sides changed the same way is fine; one both changed differently keeps Figolu's (ours) and says so.
// Keys keep ours' order, with theirs' new ones after. Registered by .gitattributes and, where it runs,
//   git config merge.locale-json.driver "node app/scripts/merge-json.mjs %O %A %B"
// Exit 0: merged into %A. Exit 1 (a file that isn't a JSON object): git reports the conflict as usual.
import { readFileSync, writeFileSync } from 'node:fs'

const read = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return undefined } }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export function mergeObjects(base, ours, theirs) {
  const out = {}
  const kept = []
  for (const k of Object.keys(ours)) {
    const b = base[k], o = ours[k], t = theirs[k]
    if (!(k in theirs)) { if (k in base && same(b, o)) continue; out[k] = o; continue } // theirs removed it, unless ours changed it
    if (same(o, t) || same(b, t)) out[k] = o
    else if (same(b, o)) out[k] = t
    else { out[k] = o; kept.push(k) }
  }
  for (const k of Object.keys(theirs)) {
    if (k in out || k in ours) continue
    // ours removed it and theirs didn't change it: stays removed
    if (k in base && same(base[k], theirs[k])) continue
    out[k] = theirs[k]
  }
  return { merged: out, kept }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [basePath, oursPath, theirsPath] = process.argv.slice(2)
  const base = read(basePath) ?? {}, ours = read(oursPath), theirs = read(theirsPath)
  if (!ours || !theirs || Array.isArray(ours) || Array.isArray(theirs)) process.exit(1)
  const { merged, kept } = mergeObjects(base, ours, theirs)
  if (kept.length) console.error(`merge-json: kept Figolu's text for ${kept.length} key(s) both sides changed: ${kept.slice(0, 5).join(' | ')}`)
  writeFileSync(oursPath, JSON.stringify(merged, null, 2) + '\n')
}
