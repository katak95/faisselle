import { useState } from 'react'
import { Check, Download, Upload } from './Icons'
import type { ShareChange, ShareOpened, ShareSection } from '../../../shared/types'
import { t } from '../../../shared/i18n'
import { osWords } from '../keys'

type Opened = Extract<ShareOpened, { ok: true }>

const sectionTitle = (s: ShareSection) => ({ notes: t('Notes model'), m365: t('Microsoft 365'), confluence: t('Confluence'), vocabulary: t('Custom words') })[s]

/** a field's name and values in the interface's words; ids, addresses and words as they are */
function fieldLabel(c: ShareChange): string {
  const labels: Record<string, string> = {
    'notes.provider': t('Where summaries are written'), 'notes.startUrl': t('AWS sign-in start URL'), 'notes.ssoRegion': t('Identity Center region'),
    'notes.region': t('Bedrock region'), 'notes.modelId': t('Model'),
    'm365.clientId': t('Application (client) ID'), 'm365.tenantId': t('Directory (tenant) ID'), 'm365.method': t('Sign in with'),
    'm365.redirectUri': t('Redirect URI'), 'm365.calendar': t('Show the Outlook calendar'), 'm365.documents': t('Search SharePoint and OneDrive'),
    'confluence.site': t('Site'), 'vocabulary.words': t('Words added'),
  }
  return labels[`${c.section}.${c.field}`] ?? c.field
}
function valueLabel(c: ShareChange, v: string): string {
  if (!v) return t('Not set')
  if (c.field === 'provider') return v === 'bedrock' ? t('Amazon Bedrock (Claude)') : t('This computer')
  if (c.field === 'method') return v === 'browser' ? t('The browser (apps without public client flows)') : t("A code on Microsoft's page")
  if (c.field === 'calendar' || c.field === 'documents') return v === 'on' ? t('On') : t('Off')
  return v
}

/**
 * Settings → Share the setup: the models and connectors (where the notes are written, Bedrock, Microsoft 365,
 * Confluence) and the custom words to a file, and from one: what it would change is shown first, section by section,
 * and only the sections kept are applied. No secret or sign-in is in the file.
 */
export function SetupShare({ onApplied }: { onApplied(): void }) {
  const [busy, setBusy] = useState<'export' | 'import' | 'apply' | null>(null)
  const [said, setSaid] = useState<{ kind: 'exported' | 'applied' | 'nothing' | 'error'; text?: string } | null>(null)
  const [opened, setOpened] = useState<Opened | null>(null)
  const [keep, setKeep] = useState<Set<ShareSection>>(new Set())

  const exportIt = async () => {
    setBusy('export'); setSaid(null); setOpened(null)
    const r = await window.yogurt.setupShare.export().catch(() => ({ ok: false, error: 'failed' } as const)).finally(() => setBusy(null))
    if (r.ok) setSaid({ kind: 'exported' })
    else if (r.error === 'failed') setSaid({ kind: 'error', text: t("Couldn't save the setup. Try again, or pick another place.") })
  }
  const importIt = async () => {
    setBusy('import'); setSaid(null); setOpened(null)
    const r = await window.yogurt.setupShare.open().catch(() => ({ ok: false, error: 'failed' } as const)).finally(() => setBusy(null))
    if (!r.ok) {
      const text = { cancelled: '', invalid: t("That file isn't a Faisselle setup."), newer: t('This setup is from a newer Faisselle. Update Faisselle, then try again.'), failed: t("Couldn't read that setup. Try again.") }[r.error]
      if (text) setSaid({ kind: 'error', text })
      return
    }
    if (!r.preview.length) { setSaid({ kind: 'nothing' }); return }
    setOpened(r)
    setKeep(new Set(r.preview.map((p) => p.section)))
  }
  const apply = async () => {
    if (!opened) return
    setBusy('apply')
    const r = await window.yogurt.setupShare.apply(opened.token, [...keep]).catch(() => ({ ok: false, error: 'failed' } as const)).finally(() => setBusy(null))
    setOpened(null)
    if (r.ok) { onApplied(); setSaid({ kind: 'applied' }) }
    else setSaid({ kind: 'error', text: r.error === 'expired' ? t('This preview is out of date. Import the setup again.') : t("Couldn't read that setup. Try again.") })
  }
  const toggle = (s: ShareSection) => setKeep((k) => { const n = new Set(k); if (n.has(s)) n.delete(s); else n.add(s); return n })

  return (
    <>
      <h2 className="settings-section-heading">{t('Share the setup')}</h2>
      <div data-testid="setup-share" className="settings-group settings-backup">
        <p className="settings-description">{t('Your models and connectors in one file, to give to someone else: where summaries are written, Bedrock, Microsoft 365, Confluence and your custom words. No password, key or sign-in goes in it: each person signs in with their own accounts.')}</p>
        <div className="settings-backup-actions">
          <button data-testid="setup-export" disabled={!!busy} onClick={() => void exportIt()} className="workspace-button">
            <Download size={14} aria-hidden="true" className="text-muted" />{busy === 'export' ? t('Exporting…') : t('Export the setup')}
          </button>
          <button data-testid="setup-import" disabled={!!busy} onClick={() => void importIt()} className="workspace-button">
            <Upload size={14} aria-hidden="true" className="text-muted" />{busy === 'import' ? t('Importing…') : t('Import a setup')}
          </button>
        </div>
        {opened && <div data-testid="setup-preview" className="mt-3 flex flex-col gap-3">
          <p className="settings-description">{t('Choose what to apply from this setup:')}</p>
          {opened.preview.map((p) => <div key={p.section} data-testid={`setup-section-${p.section}`} className="rounded-xl border border-line p-3">
            <label className="flex items-center gap-2 text-[13px] font-medium text-ink">
              <input type="checkbox" checked={keep.has(p.section)} onChange={() => toggle(p.section)} data-testid={`setup-keep-${p.section}`} />
              {sectionTitle(p.section)}
            </label>
            <ul className="mt-2 flex flex-col gap-1 ps-6">
              {p.changes.map((c) => <li key={c.field} className="settings-description" dir="auto">
                <span className="text-ink">{fieldLabel(c)}</span>{' · '}
                {c.field === 'words' ? <span dir="ltr">{c.to}</span> : <><span className="line-through" dir="ltr">{valueLabel(c, c.from)}</span>{' → '}<span className="text-ink" dir="ltr">{valueLabel(c, c.to)}</span></>}
              </li>)}
            </ul>
          </div>)}
          <div className="flex gap-2">
            <button data-testid="setup-apply" className="workspace-button" disabled={!keep.size || busy === 'apply'} onClick={() => void apply()}>{t('Apply')}</button>
            <button className="ghost-btn" onClick={() => setOpened(null)}>{t('Cancel')}</button>
          </div>
        </div>}
        <div aria-live="polite">
          {said && <p data-testid="setup-said" data-kind={said.kind} className={`settings-backup-status ${said.kind === 'error' ? 'text-danger' : 'text-ink'}`}>
            {said.kind === 'exported' && <>
              <span className="flex items-center gap-1.5"><Check size={14} aria-hidden="true" className="text-muted" />{t('Setup exported.')}</span>
              <button data-testid="setup-show" onClick={() => window.yogurt.setupShare.show()} className="ghost-btn">{osWords({ mac: t('Show in Finder'), windows: t('Show in File Explorer'), linux: t('Show in Files') })}</button>
            </>}
            {said.kind === 'applied' && <span className="flex items-center gap-1.5"><Check size={14} aria-hidden="true" className="text-muted" />{t('Setup applied. Sign in with your own accounts in the sections above where needed.')}</span>}
            {said.kind === 'nothing' && t('Nothing in this setup changes yours.')}
            {said.kind === 'error' && said.text}
          </p>}
        </div>
      </div>
    </>
  )
}
