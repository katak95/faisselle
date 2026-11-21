// rebrand: keep-file (it is about Yogurt's versions)
// Figolu's version from Yogurt's: Yogurt X.Y.Z is Figolu X.Y.(Z×100), and each Figolu release made between two Yogurt
// versions takes the next number (X.Y.(Z×100+1), …). Always newer than the last, so installed copies update.
//   node app/scripts/version.mjs [--yogurt]   prints the next Figolu version (--yogurt: the one for Yogurt's own release)

const parse = (v) => v.replace(/^v/, '').split('.').map(Number)

/** the Figolu version a Yogurt version gives */
export function figoluVersion(yogurt) {
  const [x, y, z] = parse(yogurt)
  return `${x}.${y}.${z * 100}`
}

/** the next Figolu version, from Yogurt's version and the tags already made */
export function nextFigoluVersion(yogurt, tags) {
  const [x, y, z] = parse(yogurt)
  const base = z * 100
  const taken = tags.map(parse).filter(([a, b, c]) => a === x && b === y && c >= base && c < base + 100).map(([, , c]) => c - base)
  const n = taken.length ? Math.max(...taken) + 1 : 0
  if (n >= 100) throw new Error(`100 Figolu releases on Yogurt ${yogurt}: wait for the next Yogurt`)
  return `${x}.${y}.${base + n}`
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { readFileSync } = await import('node:fs')
  const { execFileSync } = await import('node:child_process')
  const yogurt = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
  const tags = execFileSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8' }).split('\n').filter(Boolean)
  console.log(process.argv.includes('--yogurt') ? figoluVersion(yogurt) : nextFigoluVersion(yogurt, tags))
}
