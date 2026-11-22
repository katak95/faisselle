import { readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { SOURCE_BYTES_MAX } from '../../shared/expert/types'

/** the files an interview can take as background: text only, read as it is */
export const SOURCE_EXTENSIONS = ['md', 'markdown', 'txt', 'csv', 'json', 'yaml', 'yml', 'xml', 'html', 'htm']

export type ReadSource = { ok: true; name: string; content: string; bytes: number } | { ok: false; name: string; reason: 'too-big' | 'not-text' | 'unreadable' }

/** a picked file, once: too big, binary or not UTF-8 is refused rather than sent half-read */
export function readSource(path: string): ReadSource {
  const name = basename(path).slice(0, 200)
  try {
    if (!SOURCE_EXTENSIONS.includes(extname(path).slice(1).toLowerCase())) return { ok: false, name, reason: 'not-text' }
    const size = statSync(path).size
    if (size > SOURCE_BYTES_MAX) return { ok: false, name, reason: 'too-big' }
    const raw = readFileSync(path)
    if (raw.includes(0)) return { ok: false, name, reason: 'not-text' }
    let content: string
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(raw) } catch { return { ok: false, name, reason: 'not-text' } }
    return { ok: true, name, content: content.replace(/^﻿/, ''), bytes: raw.length }
  } catch { return { ok: false, name, reason: 'unreadable' } }
}
