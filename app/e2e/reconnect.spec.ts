import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@playwright/test'

/** Settings scrolled to that section: it is on screen */
const onScreen = (page: Page, testId: string) => expect.poll(() => page.getByTestId(testId).evaluate((el) => {
  const r = el.getBoundingClientRect(); return r.top < window.innerHeight && r.bottom > 0
})).toBe(true)

const main = join(import.meta.dirname, '../out/main/index.js')

// Bedrock, Microsoft 365 and Confluence connected, then each sign-in runs out: Home says so, with the way back to each,
// and so do sharing to Confluence and the brief
test('a sign-in that ran out is shown on Home, in sharing and in the brief, each with the way back', async () => {
  test.setTimeout(150_000)
  const app = await electron.launch({ args: [main], env: { ...process.env, YOGURT_FAKE: '1', YOGURT_USER_DATA: mkdtempSync(join(tmpdir(), 'faisselle-reconnect-')) } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('home')).toBeVisible()
    const [meeting] = await app.evaluate(() => (globalThis as any).__fake__.chatMeetings()) as string[]
    // never connected: nothing to sign in again to
    await expect(page.getByTestId('reconnect-banner')).toHaveCount(0)
    await page.evaluate(async () => {
      await window.yogurt.cloud.setProvider('bedrock')
      await window.yogurt.cloud.setConfig({ startUrl: 'https://example.awsapps.com/start' })
      await window.yogurt.cloud.signIn()
      await window.yogurt.m365.signIn()
      await window.yogurt.atlassian.signIn()
    })
    await expect.poll(() => page.evaluate(async () => [(await window.yogurt.cloud.get()).sso.state, (await window.yogurt.m365.get()).status.state, (await window.yogurt.atlassian.get()).status.state]), { timeout: 20_000 })
      .toEqual(['signed-in', 'connected', 'connected'])
    await expect(page.getByTestId('reconnect-banner')).toHaveCount(0)

    await app.evaluate(() => (globalThis as any).__fake__.signInsRanOut())
    const banner = page.getByTestId('reconnect-banner')
    await expect(banner.locator('[data-testid^="reconnect-"][data-testid$="-button"]')).toHaveCount(3)
    await expect(page.getByTestId('reconnect-m365')).toContainText('Your Microsoft 365 sign-in ran out.')

    // the way back: Microsoft 365's own section in Settings, which says the sign-in ran out (not "never connected")
    await page.getByTestId('reconnect-m365-button').click()
    await expect(page.getByTestId('settings-m365-status')).toHaveText('The sign-in ran out. Connect again.')
    await onScreen(page, 'settings-m365')

    // sharing: Confluence is still offered, as the way to sign in again
    await page.evaluate((id) => window.yogurt.nav.go(`/note/${id}`), meeting)
    await page.getByTestId('share-button').click()
    await expect(page.getByTestId('share-confluence')).toHaveCount(0)
    await page.getByTestId('share-confluence-reconnect-item').click()
    await expect(page.getByTestId('settings-atlassian-status')).toHaveText('The sign-in ran out. Connect again.')
    await onScreen(page, 'settings-atlassian')

    // the brief: prepared without Microsoft 365, and says so
    const upcoming = await app.evaluate(() => (globalThis as any).__fake__.upcomingMeeting()) as string
    await page.evaluate((id) => window.yogurt.nav.go(`/note/${id}`), upcoming)
    await expect(page.getByTestId('note-brief-reconnect')).toContainText('Your Microsoft 365 sign-in ran out')
    await page.getByTestId('note-brief-reconnect-button').click()
    await page.getByTestId('settings-m365-connect').click()
    await expect(page.getByTestId('settings-m365-status')).toContainText('Connected · you@example.com', { timeout: 15_000 })

    // signed in again: Home no longer lists Microsoft 365
    await page.evaluate(() => window.yogurt.nav.go(''))
    await expect(page.getByTestId('reconnect-m365')).toHaveCount(0)
    await expect(page.getByTestId('reconnect-bedrock')).toBeVisible()
    await expect(page.getByTestId('reconnect-atlassian')).toBeVisible()
  } finally { await app.close() }
})
