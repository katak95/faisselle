import { _electron as electron, expect, test } from '@playwright/test'
import { openFromCorner } from './cornerNavigation'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const main = join(import.meta.dirname, '../out/main/index.js')

// an organisation's app without public client flows (like the one Claude Code uses): Microsoft 365 signed in with the
// browser on that app's redirect URI. Fake mode's Microsoft comes straight back to it with a code.
test('Microsoft 365 signs in with the browser on the app’s own redirect URI', async () => {
  test.setTimeout(90_000)
  const app = await electron.launch({ args: [main], env: { ...process.env, YOGURT_FAKE: '1', YOGURT_USER_DATA: mkdtempSync(join(tmpdir(), 'figolu-m365-browser-')) } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('home')).toBeVisible()
    await openFromCorner(page, 'settings-open')
    await page.getByRole('button', { name: "Use your organization's own app" }).click()
    await page.getByLabel('Application (client) ID').fill('11111111-2222-3333-4444-555555555555')
    await page.getByTestId('settings-m365-method-browser').check()
    const save = page.getByTestId('settings-m365-app-save')
    // only a loopback address with its port
    await page.getByTestId('settings-m365-redirect').fill('https://example.com/callback')
    await expect(save).toBeDisabled()
    const port = 40000 + Math.floor(Math.random() * 20000)
    await page.getByTestId('settings-m365-redirect').fill(`http://localhost:${port}/callback`)
    await page.getByTestId('settings-m365-secret').fill('s3cret')
    await save.click()
    await expect(page.getByTestId('settings-m365-secret-remove')).toBeVisible()
    // what was saved: the method and the URI, and the secret only as "one is saved"
    expect(await page.evaluate(() => window.yogurt.m365.get())).toMatchObject({ method: 'browser', redirectUri: `http://localhost:${port}/callback`, hasSecret: true })

    await page.getByTestId('settings-m365-connect').click()
    await expect(page.getByTestId('settings-m365-status')).toContainText('Connected · you@example.com', { timeout: 15_000 })
    await expect(page.getByTestId('settings-m365-calendar')).toHaveAttribute('aria-checked', 'true')

    // disconnecting forgets the tokens; the secret goes only when asked
    await page.getByTestId('settings-m365-sign-out').click()
    await expect(page.getByTestId('settings-m365-connect')).toBeVisible()
    await page.getByTestId('settings-m365-secret-remove').click()
    await expect(page.getByTestId('settings-m365-secret-remove')).toHaveCount(0)
  } finally { await app.close() }
})
