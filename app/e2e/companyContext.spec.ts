import { _electron as electron, expect, test } from '@playwright/test'
import { openFromCorner } from './cornerNavigation'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const main = join(import.meta.dirname, '../out/main/index.js')

// the company context, written once in Settings, reaches the notes; a use gets its own Bedrock model
test('the company context goes into the notes, and a use can have its own model', async () => {
  test.setTimeout(120_000)
  const app = await electron.launch({ args: [main], env: { ...process.env, YOGURT_FAKE: '1', YOGURT_USER_DATA: mkdtempSync(join(tmpdir(), 'faisselle-context-')) } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('home')).toBeVisible()
    await openFromCorner(page, 'settings-open')
    const about = 'Acme makes billing software for dentists. "MRR" is monthly recurring revenue.'
    await page.getByTestId('company-context-text').fill(about)
    await page.getByTestId('company-context-text').blur()
    await expect(page.getByTestId('company-context-state')).toHaveText('Saved')
    expect((await page.evaluate(() => window.yogurt.settings.get())).organisation).toBe(about)

    // Bedrock: the brief on another model than the notes
    await page.getByTestId('cloud-notes-provider').selectOption('bedrock')
    await page.getByTestId('cloud-models-by-use').getByRole('button', { name: 'Model for each use' }).click()
    await expect(page.getByTestId('cloud-model-brief')).toHaveAttribute('placeholder', /claude/)
    await page.getByTestId('cloud-model-brief').fill('eu.anthropic.claude-sonnet-4-5-20250929-v1:0')
    await page.getByTestId('cloud-model-brief').press('Enter')
    await expect.poll(() => page.evaluate(() => window.yogurt.cloud.get().then((v) => v.config.models))).toEqual({ brief: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0' })
    // emptied: the brief goes back to the main model
    await page.getByTestId('cloud-model-brief').fill('')
    await page.getByTestId('cloud-model-brief').press('Enter')
    await expect.poll(() => page.evaluate(() => window.yogurt.cloud.get().then((v) => v.config.models))).toEqual({})
    await page.getByTestId('cloud-notes-provider').selectOption('local')

    // a meeting's notes written again read the context, as background
    const [meeting] = await app.evaluate(() => (globalThis as any).__fake__.chatMeetings()) as string[]
    await page.evaluate((id) => window.yogurt.nav.go(`/note/${id}`), meeting)
    await page.getByTestId('note-summary-tab').click()
    await page.getByTestId('note-template').click()
    await page.locator('[data-testid="note-template-option"][data-id="client"]').click()
    const prompts = () => app.evaluate(() => (globalThis as any).__fake__.prompts().notes as string[])
    await expect.poll(async () => (await prompts()).some((p) => p.includes(`<organisation>\n${about}\n</organisation>`)), { timeout: 30_000 }).toBe(true)
  } finally { await app.close() }
})
