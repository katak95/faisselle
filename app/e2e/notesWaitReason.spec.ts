import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const main = join(import.meta.dirname, '../out/main/index.js')

// notes on Bedrock with the AWS sign-in run out: the summary says what it waits for, and starts once signed in
test('a summary waiting for the AWS sign-in says so, and starts by itself after it', async () => {
  test.setTimeout(120_000)
  const app = await electron.launch({ args: [main], env: { ...process.env, YOGURT_FAKE: '1', YOGURT_USER_DATA: mkdtempSync(join(tmpdir(), 'faisselle-wait-')) } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('home')).toBeVisible()
    const [meeting] = await app.evaluate(() => (globalThis as any).__fake__.chatMeetings()) as string[]
    await page.evaluate(async () => {
      await window.yogurt.cloud.setProvider('bedrock')
      await window.yogurt.cloud.setConfig({ startUrl: 'https://example.awsapps.com/start' })
    })
    await page.evaluate((id) => window.yogurt.nav.go(`/note/${id}`), meeting)
    await page.getByTestId('note-summary-tab').click()
    await page.getByTestId('note-template').click()
    await page.locator('[data-testid="note-template-option"][data-id="client"]').click()

    const notice = page.getByTestId('note-waiting-for')
    await expect(notice).toHaveAttribute('data-reason', 'aws-sign-in')
    await expect(notice).toContainText('sign in to AWS again')
    await notice.getByRole('button', { name: 'Sign in to AWS' }).click()
    await expect(page.getByTestId('cloud-sign-in-button')).toBeVisible()

    // signed in (fake mode approves at once), account and role chosen: the waiting summary goes on by itself
    await page.getByTestId('cloud-sign-in-button').click()
    await expect(page.getByTestId('cloud-sign-out')).toBeVisible({ timeout: 10_000 })
    await page.getByTestId('cloud-account').selectOption('123456789012')
    await page.getByTestId('cloud-role').selectOption('BedrockUser')
    const prompts = () => app.evaluate(() => (globalThis as any).__fake__.prompts().notes as string[])
    await expect.poll(async () => (await prompts()).some((p) => p.includes('This meeting was a call with a client')), { timeout: 30_000 }).toBe(true)
    await page.evaluate((id) => window.yogurt.nav.go(`/note/${id}`), meeting)
    await expect(page.getByTestId('note-waiting-for')).toHaveCount(0, { timeout: 20_000 })
  } finally { await app.close() }
})
