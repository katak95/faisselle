import { _electron as electron, expect, test } from '@playwright/test'
import { openFromCorner } from './cornerNavigation'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const main = join(import.meta.dirname, '../out/main/index.js')

// one person exports their models and connectors; a colleague, on another profile, imports the parts they want
test('the setup goes from one person to another, without a secret, section by section', async () => {
  test.setTimeout(120_000)
  const file = join(mkdtempSync(join(tmpdir(), 'faisselle-setup-')), 'setup.json')
  const env = (profile: string) => ({ ...process.env, YOGURT_FAKE: '1', YOGURT_USER_DATA: mkdtempSync(join(tmpdir(), `faisselle-${profile}-`)), YOGURT_SETUP_PATH: file })

  const first = await electron.launch({ args: [main], env: env('first') })
  try {
    const page = await first.firstWindow()
    await expect(page.getByTestId('home')).toBeVisible()
    await page.evaluate(async () => {
      await window.yogurt.cloud.setProvider('bedrock')
      await window.yogurt.cloud.setConfig({ startUrl: 'https://acme.awsapps.com/start', region: 'eu-west-1', modelId: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0', accountId: '123456789012', roleName: 'BedrockUser' })
      await window.yogurt.m365.setApp({ clientId: '11111111-2222-3333-4444-555555555555', tenantId: 'acme.onmicrosoft.com', method: 'browser', redirectUri: 'http://localhost:3118/callback', secret: 's3cret' })
      await window.yogurt.settings.setJargon(['Acme', 'Q3 rollout'])
    })
    await openFromCorner(page, 'settings-open')
    await page.getByTestId('setup-export').click()
    await expect(page.getByTestId('setup-said')).toHaveAttribute('data-kind', 'exported')
  } finally { await first.close() }

  const text = readFileSync(file, 'utf8')
  for (const never of ['123456789012', 'BedrockUser', 's3cret']) expect(text).not.toContain(never)

  const second = await electron.launch({ args: [main], env: env('second') })
  try {
    const page = await second.firstWindow()
    await expect(page.getByTestId('home')).toBeVisible()
    await page.evaluate(() => window.yogurt.settings.setJargon(['Kickoff']))
    await openFromCorner(page, 'settings-open')
    await page.getByTestId('setup-import').click()
    await expect(page.getByTestId('setup-preview')).toBeVisible()
    await expect(page.getByTestId('setup-section-notes')).toContainText('eu.anthropic.claude-haiku-4-5-20251001-v1:0')
    await expect(page.getByTestId('setup-section-vocabulary')).toContainText('Acme, Q3 rollout')
    // the colleague keeps their own Microsoft 365 setup
    await page.getByTestId('setup-keep-m365').uncheck()
    await page.getByTestId('setup-apply').click()
    await expect(page.getByTestId('setup-said')).toHaveAttribute('data-kind', 'applied')
    const after = await page.evaluate(async () => ({ cloud: await window.yogurt.cloud.get(), m365: await window.yogurt.m365.get(), prefs: await window.yogurt.settings.get() }))
    expect(after.cloud.provider).toBe('bedrock')
    expect(after.cloud.config).toMatchObject({ startUrl: 'https://acme.awsapps.com/start', region: 'eu-west-1', modelId: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0', accountId: '', roleName: '' })
    expect(after.m365).toMatchObject({ clientId: '', method: 'code', hasSecret: false })
    expect(after.prefs.jargon).toEqual(['Kickoff', 'Acme', 'Q3 rollout'])
    // the sections on the page show what was applied
    await expect(page.getByTestId('cloud-model')).toHaveValue('eu.anthropic.claude-haiku-4-5-20251001-v1:0')
  } finally { await second.close() }
})
