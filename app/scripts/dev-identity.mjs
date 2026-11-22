// pnpm dev on a Mac (scripts/dev.mjs calls setUp): Electron from node_modules becomes "Faisselle Dev", so the Mac's
// permissions (microphone, call audio, calendar, Accessibility) can be tried from source.
// - Who is asked. A program started from a terminal is, for the Mac's permissions, that terminal's (or Claude's, or
//   any app's that started pnpm dev): native/dev-launcher starts Electron answering for its own, as Chromium does.
// - In what name. Electron alone is com.github.Electron, signed ad hoc, and its Info.plist lacks the calendar and
//   Apple Events texts, so the calendar is refused without a prompt. It gets its own app id (com.katak95.faisselle.dev,
//   apart from the installed app's), the name the Mac shows (CFBundleDisplayName; CFBundleName stays, Electron finds
//   its helpers by it), and the app's own usage texts from electron-builder.yml.
// - For how long. Signed with this Mac's "Apple Development" certificate when there is one, what is allowed stays
//   allowed from one run to the next; ad hoc otherwise, and the Mac asks again after each reinstall of node_modules.
// Redone only when node_modules or the texts changed. FAISSELLE_DEV_SIGN=- signs ad hoc; a name picks a certificate.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEV_ID = 'com.katak95.faisselle.dev'
export const DEV_NAME = 'Faisselle Dev'
const MARK = 'FaisselleDevIdentity'
const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'

/** the NS…UsageDescription texts of electron-builder.yml (mac.extendInfo), as the Mac shows them */
export function usageDescriptions(yml) {
  const out = {}
  for (const m of yml.matchAll(/^[ \t]+(NS\w+UsageDescription):[ \t]*(.+?)[ \t]*$/gm)) {
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}

/** the certificate to sign with, from `security find-identity -v -p codesigning`: the first Apple Development one */
export function pickIdentity(found) {
  const m = found.match(/^\s*\d+\)\s+([0-9A-F]{40})\s+"Apple Development: [^"]+"/m)
  return m ? m[1] : null
}

/** what was set up, so a later run knows whether there is anything to redo */
export function fingerprint(texts, identity) {
  return createHash('sha256').update(JSON.stringify({ id: DEV_ID, name: DEV_NAME, texts, identity })).digest('hex').slice(0, 16)
}

const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' })

/** Electron.app gets Faisselle Dev's id, name, texts and signature; false when it could not */
function identity(app, bundle) {
  const plist = join(bundle, 'Contents', 'Info.plist')
  const texts = usageDescriptions(readFileSync(join(app, 'electron-builder.yml'), 'utf8'))
  const wanted = process.env.FAISSELLE_DEV_SIGN
  let used = wanted === '-' ? null : wanted || pickIdentity(run('security', ['find-identity', '-v', '-p', 'codesigning']).stdout ?? '')
  if (run('plutil', ['-extract', MARK, 'raw', '-o', '-', plist]).stdout?.trim() === fingerprint(texts, used)
    && run('codesign', ['--verify', bundle]).status === 0) return true

  const set = (key, value) => run('plutil', ['-replace', key, '-string', value, plist]).status === 0
  const pairs = [['CFBundleIdentifier', DEV_ID], ['CFBundleDisplayName', DEV_NAME], ...Object.entries(texts), [MARK, fingerprint(texts, used)]]
  if (!pairs.every(([k, v]) => set(k, v))) { console.error(`${DEV_NAME}: could not edit ${plist}`); return false }
  // the plist is part of what is signed: written first, then the whole bundle (Electron's helpers too) is signed
  const sign = (id) => run('codesign', ['--force', '--deep', '--timestamp=none', '--sign', id ?? '-', bundle])
  let signed = sign(used)
  if (signed.status !== 0 && used) {
    console.warn(`${DEV_NAME}: signing with the Apple Development certificate failed, signing ad hoc instead (the Mac will ask again after each reinstall)\n${signed.stderr.trim()}`)
    used = null
    set(MARK, fingerprint(texts, used))
    signed = sign(used)
  }
  if (signed.status !== 0) { console.error(`${DEV_NAME}: could not sign Electron\n${signed.stderr.trim()}`); return false }
  console.log(`${DEV_NAME}: Electron is now ${DEV_ID}, signed ${used ? 'with your Apple Development certificate' : 'ad hoc'}`)
  return true
}

/** native/dev-launcher, built next to Electron (again after a reinstall or a change to it); null when it can't be */
function launcher(app, electronDir) {
  const src = join(app, 'native', 'dev-launcher', 'main.c')
  const out = join(electronDir, '..', '.cache', 'faisselle-dev', 'dev-launcher')
  if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) return out
  mkdirSync(dirname(out), { recursive: true })
  const r = run('xcrun', ['clang', '-O2', '-Wall', '-o', out, src])
  if (r.status !== 0) { console.error(`${DEV_NAME}: could not build ${src}\n${r.stderr.trim()}`); return null }
  return out
}

/**
 * Sets Electron up as Faisselle Dev and gives what electron-vite needs to start it through the launcher
 * (ELECTRON_EXEC_PATH). Nothing off a Mac or on CI, and nothing when a step fails: pnpm dev then starts Electron as before.
 */
export function setUp(app) {
  if (process.platform !== 'darwin' || process.env.CI) return {}
  const electronDir = dirname(createRequire(join(app, 'package.json')).resolve('electron/package.json'))
  const pathFile = join(electronDir, 'path.txt')
  if (!existsSync(pathFile)) return {} // Electron not downloaded yet: dev.mjs fetches it first
  const electron = join(electronDir, 'dist', readFileSync(pathFile, 'utf8').trim())
  const bundle = electron.slice(0, electron.indexOf('.app/') + 4)
  if (!identity(app, bundle)) return {}
  // Launch Services still knows the bundle as it was downloaded (Electron, com.github.Electron) until told again: the
  // Mac then refuses notifications without asking, and System Settings lists it as Electron
  run(LSREGISTER, ['-f', bundle])
  const exec = launcher(app, electronDir)
  return exec ? { ELECTRON_EXEC_PATH: exec, FAISSELLE_DEV_ELECTRON: electron } : {}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(setUp(join(dirname(fileURLToPath(import.meta.url)), '..')))
