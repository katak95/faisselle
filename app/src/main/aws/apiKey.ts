// A Bedrock API key (Settings → Notes model), for accounts without IAM Identity Center (the AWS Free plan has
// none): sealed with the system's keychain in userData/bedrock-key.json, read only in main, never sent to a page.
// - A short-term key lasts up to 12 hours and works only in the region it was made in.
// - A long-term key is an IAM user's service credential; AWS keeps those for trying Bedrock out.
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'

/** a key as Bedrock issues them: printable characters only, no spaces (short-term keys are long) */
export const validApiKey = (v: unknown): v is string => typeof v === 'string' && /^[\x21-\x7e]{20,8192}$/.test(v)

export function createApiKeyStore(o: { file: string; seal(plain: string): string; open(sealed: string): string; now?: () => number }) {
  const now = o.now ?? Date.now
  let cached: { key: string; savedAt: number } | null | undefined
  const read = () => {
    if (cached !== undefined) return cached
    try {
      const saved = JSON.parse(readFileSync(o.file, 'utf8')) as { sealed?: string; savedAt?: number }
      cached = typeof saved.sealed === 'string' ? { key: o.open(saved.sealed), savedAt: Number(saved.savedAt) || 0 } : null
    } catch { cached = null }
    return cached
  }
  return {
    /** the key, for a request; undefined when none is saved */
    get: (): string | undefined => read()?.key,
    /** when it was saved: a new key is a new client */
    savedAt: (): number | undefined => read()?.savedAt,
    has: (): boolean => !!read(),
    set(key: string) {
      const savedAt = now()
      const tmp = `${o.file}.tmp`
      writeFileSync(tmp, JSON.stringify({ sealed: o.seal(key), savedAt }), { mode: 0o600 })
      renameSync(tmp, o.file)
      cached = { key, savedAt }
    },
    remove() { if (existsSync(o.file)) rmSync(o.file, { force: true }); cached = null },
  }
}
export type ApiKeyStore = ReturnType<typeof createApiKeyStore>
