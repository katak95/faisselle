import { describe, expect, it } from 'vitest'
import { applyShare, buildShare, parseShare, previewShare, SHARE_KIND } from '../src/main/configShare'
import type { Settings } from '../src/main/settings'

const mine: Settings = {
  notesProvider: 'bedrock',
  bedrock: { startUrl: 'https://acme.awsapps.com/start', ssoRegion: 'eu-west-1', accountId: '123456789012', roleName: 'BedrockUser', region: 'eu-west-1', modelId: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0' },
  m365: { enabled: true, clientId: '11111111-2222-3333-4444-555555555555', tenantId: 'acme.onmicrosoft.com', method: 'browser', redirectUri: 'http://localhost:3118/callback', documents: true },
  atlassian: { enabled: true, siteId: 'cloud-1', places: { 'cloud-1': { spaceId: '42', spaceKey: '~me' } } },
  jargon: ['Acme', 'Q3 rollout'],
  myName: 'Quentin', language: 'fr',
}
const site = { id: 'cloud-1', name: 'Acme', url: 'https://acme.atlassian.net' }

describe('sharing the setup', () => {
  it('puts the models and connectors in the file, never a sign-in, account, role or personal space', () => {
    const f = buildShare(mine, { appVersion: '0.3.6401', now: new Date('2026-11-23T10:00:00Z'), site })
    expect(f).toEqual({
      kind: SHARE_KIND, version: 1, exportedAt: '2026-11-23T10:00:00.000Z', appVersion: '0.3.6401',
      notes: { provider: 'bedrock', startUrl: 'https://acme.awsapps.com/start', ssoRegion: 'eu-west-1', region: 'eu-west-1', modelId: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0' },
      m365: { clientId: '11111111-2222-3333-4444-555555555555', tenantId: 'acme.onmicrosoft.com', method: 'browser', redirectUri: 'http://localhost:3118/callback', calendar: true, documents: true },
      confluence: { siteId: 'cloud-1', siteName: 'Acme', siteUrl: 'https://acme.atlassian.net' },
      vocabulary: ['Acme', 'Q3 rollout'],
    })
    const text = JSON.stringify(f)
    for (const never of ['123456789012', 'BedrockUser', '~me', 'Quentin', 'places', 'enabled']) expect(text).not.toContain(never)
  })

  it('reads back what it wrote', () => {
    const f = buildShare(mine, { appVersion: '0.3.6401', site })
    expect(parseShare(JSON.stringify(f))).toEqual({ ok: true, setup: f })
  })

  it('takes from a hand-edited file only what Settings itself would take', () => {
    const r = parseShare(JSON.stringify({ kind: SHARE_KIND, version: 1,
      notes: { provider: 'bedrock', startUrl: 'http://evil.example', region: 'nowhere', modelId: 'anthropic.claude-haiku-5-5' },
      m365: { clientId: 'not-a-guid', method: 'browser', redirectUri: 'https://evil.example/cb', calendar: false },
      confluence: { siteId: 'x y', siteUrl: 'https://evil.example' },
      vocabulary: ['ok', 42, 'x'.repeat(500)], accountId: '123456789012' }))
    expect(r.ok && r.setup).toMatchObject({
      notes: { provider: 'bedrock', modelId: 'anthropic.claude-haiku-5-5' },
      // the browser sign-in needs a real app id and a loopback redirect URI: the code otherwise
      m365: { method: 'code', calendar: false, documents: false },
      // the same rule as Settings' custom words: a word too long is cut to its first 50 characters
      vocabulary: ['ok', 'x'.repeat(50)],
    })
    expect(r.ok && r.setup.notes).not.toHaveProperty('startUrl')
    expect(r.ok && r.setup).not.toHaveProperty('confluence')
    expect(r.ok && r.setup).not.toHaveProperty('accountId')
  })

  it("says when a file isn't a setup, or comes from a newer Faisselle", () => {
    expect(parseShare('not json')).toEqual({ ok: false, error: 'invalid' })
    expect(parseShare(JSON.stringify({ kind: 'something-else', version: 1 }))).toEqual({ ok: false, error: 'invalid' })
    expect(parseShare(JSON.stringify({ kind: SHARE_KIND, version: 99 }))).toEqual({ ok: false, error: 'newer' })
  })

  it('shows what each section would change for the person importing it', () => {
    const theirs: Settings = { bedrock: { accountId: '999999999999', roleName: 'Theirs' }, jargon: ['acme', 'Kickoff'] }
    const preview = previewShare(theirs, buildShare(mine, { appVersion: 'x', site }))
    expect(preview.map((p) => p.section)).toEqual(['notes', 'm365', 'confluence', 'vocabulary'])
    expect(preview[0].changes).toContainEqual({ section: 'notes', field: 'provider', from: 'local', to: 'bedrock' })
    expect(preview[1].changes).toContainEqual({ section: 'm365', field: 'documents', from: 'off', to: 'on' })
    expect(preview[2].changes).toEqual([{ section: 'confluence', field: 'site', from: '', to: 'Acme' }])
    // words already there (whatever their case) aren't added again
    expect(preview[3].changes).toEqual([{ section: 'vocabulary', field: 'words', from: '', to: 'Q3 rollout' }])
    // the same setup changes nothing for the person who exported it
    expect(previewShare(mine, buildShare(mine, { appVersion: 'x', site }))).toEqual([])
  })

  it('shares the company context and the models for each use', () => {
    const withMore: Settings = { ...mine, organisation: 'Acme makes billing software for dentists.', bedrock: { ...mine.bedrock, models: { brief: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0' } } }
    const f = buildShare(withMore, { appVersion: 'x', site })
    expect(f.context).toBe('Acme makes billing software for dentists.')
    expect(f.notes?.models).toEqual({ brief: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0' })
    expect(parseShare(JSON.stringify(f))).toEqual({ ok: true, setup: f })
    const theirs: Settings = { organisation: 'Our own text', bedrock: { models: { summary: 'anthropic.claude-haiku-5-5' } } }
    const preview = previewShare(theirs, f)
    expect(preview.find((p) => p.section === 'context')?.changes).toEqual([{ section: 'context', field: 'text', from: 'Our own text', to: 'Acme makes billing software for dentists.' }])
    expect(preview.find((p) => p.section === 'notes')?.changes).toEqual(expect.arrayContaining([
      { section: 'notes', field: 'models.summary', from: 'anthropic.claude-haiku-5-5', to: '' },
      { section: 'notes', field: 'models.brief', from: '', to: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0' },
    ]))
    const patch = applyShare(theirs, f, ['context', 'notes'])
    // the context is one text: it replaces theirs; the uses are the sharer's
    expect(patch.organisation).toBe('Acme makes billing software for dentists.')
    expect(patch.bedrock?.models).toEqual({ brief: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0' })
  })

  it("applies only the sections kept, adds to the vocabulary, and keeps the person's own account and role", () => {
    const theirs: Settings = { bedrock: { accountId: '999999999999', roleName: 'Theirs' }, jargon: ['Kickoff'], m365: { enabled: true, calendar: false } }
    const setup = buildShare(mine, { appVersion: 'x', site })
    const patch = applyShare(theirs, setup, ['notes', 'vocabulary'])
    expect(patch).toEqual({
      notesProvider: 'bedrock',
      bedrock: { accountId: '999999999999', roleName: 'Theirs', startUrl: 'https://acme.awsapps.com/start', ssoRegion: 'eu-west-1', region: 'eu-west-1', modelId: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0' },
      jargon: ['Kickoff', 'Acme', 'Q3 rollout'],
    })
    const m = applyShare(theirs, setup, ['m365', 'confluence'])
    expect(m.m365).toMatchObject({ enabled: true, clientId: '11111111-2222-3333-4444-555555555555', method: 'browser', redirectUri: 'http://localhost:3118/callback', documents: true, calendar: undefined })
    expect(m.atlassian).toEqual({ siteId: 'cloud-1' })
  })
})
