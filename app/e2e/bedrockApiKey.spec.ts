import { _electron as electron, expect, test } from '@playwright/test'
import { openFromCorner } from './cornerNavigation'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const main = join(import.meta.dirname, '../out/main/index.js')
const KEY = 'ABSKQmVkcm9ja0FQSUtleS1leGFtcGxlLWZvci10ZXN0cw=='

test('notes on Bedrock with an API key instead of Identity Center: saved sealed, never shown again, removed', async () => {
  test.setTimeout(120_000)
  const userData = mkdtempSync(join(tmpdir(), 'yogurt-bedrock-key-'))
  const app = await electron.launch({ args: [main], env: { ...process.env, YOGURT_FAKE: '1', YOGURT_USER_DATA: userData } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('home')).toBeVisible()
    await openFromCorner(page, 'settings-open')
    await page.getByTestId('cloud-notes-provider').selectOption('bedrock')
    await page.getByTestId('cloud-auth').selectOption('api-key')
    // no Identity Center sign-in on this way
    await expect(page.getByTestId('cloud-sign-in')).toHaveCount(0)
    await expect(page.getByTestId('cloud-test')).toHaveCount(0)

    await page.getByTestId('cloud-api-key-input').fill('not a key')
    await page.getByTestId('cloud-api-key-save').click()
    await expect(page.getByTestId('cloud-api-key')).toContainText("That doesn't look like a Bedrock API key.")

    await page.getByTestId('cloud-api-key-input').fill(KEY)
    await page.getByTestId('cloud-api-key-save').click()
    await expect(page.getByTestId('cloud-api-key')).toContainText('A key is saved.')
    await expect(page.getByTestId('cloud-api-key-input')).toHaveValue('')
    // the page never gets the key back, and the file holds it sealed
    expect(JSON.stringify(await page.evaluate(() => window.yogurt.cloud.get()))).not.toContain(KEY)
    expect(readFileSync(join(userData, 'bedrock-key.json'), 'utf8')).not.toContain(KEY)

    await page.getByTestId('cloud-test').click()
    await expect(page.getByTestId('cloud-test-result')).toHaveText('Bedrock answered. Summaries will be written there.')

    await page.getByTestId('cloud-api-key-remove').click()
    await expect(page.getByTestId('cloud-test')).toHaveCount(0)
    expect(readdirSync(userData)).not.toContain('bedrock-key.json')

    // back to Identity Center: its sign-in is there again
    await page.getByTestId('cloud-auth').selectOption('sso')
    await expect(page.getByTestId('cloud-sign-in')).toBeVisible()
  } finally { await app.close() }
})
