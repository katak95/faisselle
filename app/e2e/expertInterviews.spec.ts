import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

const main = join(import.meta.dirname, '../out/main/index.js')

/** Bedrock as for the notes (fake mode signs in at once), so the interview can be agreed to */
async function signInToBedrock(page: Page) {
  await page.evaluate(async () => {
    await window.yogurt.cloud.setProvider('bedrock')
    await window.yogurt.cloud.setConfig({ startUrl: 'https://example.awsapps.com/start' })
    await window.yogurt.cloud.signIn()
  })
  await expect.poll(() => page.evaluate(() => window.yogurt.cloud.get().then((v) => v.sso.state)), { timeout: 10_000 }).toBe('signed-in')
  await page.evaluate(() => window.yogurt.cloud.setConfig({ accountId: '123456789012', roleName: 'BedrockUser' }))
}

test('an expert interview is prepared, agreed to, found again after a restart, and deleted', async () => {
  test.setTimeout(120_000)
  const userData = mkdtempSync(join(tmpdir(), 'faisselle-expert-'))
  const files = mkdtempSync(join(tmpdir(), 'faisselle-expert-files-'))
  writeFileSync(join(files, 'procedure.md'), '# Month-end close\n1. Reconcile the bank accounts.\n')
  writeFileSync(join(files, 'scan.png'), 'not text')
  const env = { ...process.env, YOGURT_FAKE: '1', YOGURT_USER_DATA: userData, FAISSELLE_EXPERT_SOURCES: [join(files, 'procedure.md'), join(files, 'scan.png')].join(delimiter) }

  let app = await electron.launch({ args: [main], env })
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('home')).toBeVisible()
    await page.getByTestId('nav-interviews').click()
    await expect(page.getByTestId('interviews-none')).toBeVisible()

    await page.getByTestId('interview-new-empty').click()
    await page.getByTestId('interview-title').fill('Month-end close')
    await page.getByTestId('interview-domain').fill('Accounting')
    await page.getByTestId('interview-goal').fill('Close the books in five working days')
    await page.getByTestId('interview-create-yes').click()
    await expect(page.getByTestId('interview-heading')).toHaveText('Month-end close')
    await expect(page.getByTestId('interview-state')).toHaveText('Being prepared')
    await expect(page.getByTestId('nav-interviews')).toHaveAttribute('aria-current', 'page')

    // a change is kept when the field is left
    await page.getByTestId('interview-edit-goal').fill('Close the books in four working days')
    await page.getByTestId('interview-edit-domain').click()
    await expect.poll(() => page.evaluate(() => window.yogurt.expert.list().then((l) => l[0].goal))).toBe('Close the books in four working days')

    // text files are taken; anything else is said and left out
    await page.getByTestId('interview-add-sources').click()
    await expect(page.getByTestId('interview-source')).toHaveCount(1)
    await expect(page.getByTestId('interview-source')).toContainText('procedure.md')
    await expect(page.getByTestId('interview-source-skipped')).toHaveText('scan.png was not added: it is not a text file.')

    // Bedrock isn't set up yet: Settings first
    await expect(page.getByTestId('consent-status')).toContainText('Sign in to Amazon Bedrock')
    await expect(page.getByTestId('consent-agree')).toHaveCount(0)
    await expect(page.getByTestId('consent-voice')).toContainText('amazon.nova-2-5-sonic')
    await expect(page.getByTestId('consent-voice')).toContainText('eu-north-1')
    await signInToBedrock(page)
    await expect(page.getByTestId('consent-agree')).toBeVisible()
    await page.getByTestId('consent-agree').click()
    await expect(page.getByTestId('consent-status')).toContainText('You agreed on')
    await expect(page.getByTestId('interview-state')).toHaveText('Ready')

    // a new voice region asks again
    await page.evaluate(() => window.yogurt.expert.setSettings({ voiceRegion: 'us-east-1' }))
    await expect(page.getByTestId('consent-status')).toHaveText('The regions or models changed since you agreed. Agree again to go on.')
    await page.getByTestId('consent-agree').click()
    await expect(page.getByTestId('consent-status')).toContainText('You agreed on')
  } finally { await app.close() }

  app = await electron.launch({ args: [main], env })
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('home')).toBeVisible()
    await page.getByTestId('nav-interviews').click()
    await expect(page.getByTestId('interview-row')).toHaveCount(1)
    await expect(page.getByTestId('interview-row-state')).toHaveText('Ready')
    await page.getByTestId('interview-row').getByRole('button').click()
    await expect(page.getByTestId('interview-source')).toHaveCount(1)

    // Settings: the voice region kept
    await expect.poll(() => page.evaluate(() => window.yogurt.expert.view().then((v) => v.settings.voiceRegion))).toBe('us-east-1')

    await page.getByTestId('interview-delete').click()
    await page.getByTestId('interview-delete-yes').click()
    await expect(page.getByTestId('interviews-none')).toBeVisible()
  } finally { await app.close() }
})
