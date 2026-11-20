import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const main = join(import.meta.dirname, '../out/main/index.js')
const shots = process.env.YOGURT_SHOTS

test('notes on Bedrock, Microsoft 365, templates, action items, the follow-up email and the brief', async () => {
  test.setTimeout(150_000)
  const userData = mkdtempSync(join(tmpdir(), 'yogurt-bedrock-'))
  const app = await electron.launch({ args: [main], env: { ...process.env, YOGURT_FAKE: '1', YOGURT_USER_DATA: userData } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('home')).toBeVisible()

    // Settings: the notes on Bedrock, signed in with Identity Center (fake mode approves at once)
    await page.getByTestId('settings-open').click()
    await page.getByTestId('cloud-notes-provider').selectOption('bedrock')
    await page.getByTestId('cloud-start-url').fill('https://example.awsapps.com/start')
    await page.getByTestId('cloud-start-url').press('Enter')
    await page.getByTestId('cloud-sign-in-button').click()
    await expect(page.getByTestId('cloud-sign-out')).toBeVisible({ timeout: 10_000 })
    await page.getByTestId('cloud-account').selectOption('123456789012')
    await page.getByTestId('cloud-role').selectOption('BedrockUser')
    await page.getByTestId('cloud-test').click()
    await expect(page.getByTestId('cloud-test-result')).toHaveText('Bedrock answered. Summaries will be written there.')

    // Microsoft 365, read only: the code, then connected
    await page.getByTestId('settings-m365-connect').click()
    await expect(page.getByTestId('settings-m365-status')).toContainText('Connected · you@example.com', { timeout: 15_000 })
    await expect(page.getByTestId('settings-m365-calendar')).toHaveAttribute('aria-checked', 'true')
    // SharePoint and OneDrive: the server starts again in work-account mode and Microsoft is asked again
    await page.getByTestId('settings-m365-documents').click()
    await expect(page.getByTestId('settings-m365-documents')).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('settings-m365-status')).toContainText('Connected · you@example.com', { timeout: 15_000 })

    // a template of one's own, then the default
    await page.getByTestId('settings-template-new').click()
    await page.getByTestId('settings-template-name').fill('Comité de pilotage')
    await page.getByTestId('settings-template-instructions').fill('Sections: Décisions, Risques, Budget.')
    await page.getByTestId('settings-template-save').click()
    await expect(page.getByTestId('settings-template')).toHaveCount(1)
    await page.getByTestId('settings-default-template').selectOption('retro')
    if (shots) await page.getByTestId('cloud-notes').screenshot({ path: join(shots, 'settings-bedrock.png') })
    if (shots) await page.getByTestId('settings-m365').screenshot({ path: join(shots, 'settings-m365.png') })

    // a finished meeting: write its notes again (on "Bedrock"), then the action items and the email
    const [meeting] = await app.evaluate(() => (globalThis as any).__fake__.chatMeetings()) as string[]
    await page.evaluate((id) => window.yogurt.nav.go(`/note/${id}`), meeting)
    await page.getByTestId('note-summary-tab').click()
    await expect(page.getByTestId('note-extras')).toBeVisible()
    await page.getByTestId('note-template').selectOption('client')
    const prompts = () => app.evaluate(() => (globalThis as any).__fake__.prompts().notes as string[])
    await expect.poll(async () => (await prompts()).some((p) => p.includes('This meeting was a call with a client'))).toBe(true)
    await expect(page.getByTestId('note-actions').locator('li')).toHaveCount(2, { timeout: 20_000 })
    await page.getByTestId('note-actions').locator('li input[type="checkbox"]').first().check()
    await page.getByTestId('note-followup-write').click()
    await expect(page.getByTestId('note-followup-subject')).toHaveValue('Launch plan: next steps', { timeout: 15_000 })
    await expect(page.getByTestId('note-followup-body')).toHaveValue(/The site goes live on Tuesday/)
    if (shots) await page.getByTestId('note-extras').screenshot({ path: join(shots, 'note-extras.png') })
    // the tick stays
    await page.reload()
    await page.getByTestId('note-summary-tab').click()
    await expect(page.getByTestId('note-actions').locator('li input[type="checkbox"]').first()).toBeChecked()

    // the brief, before an upcoming meeting
    const upcoming = await app.evaluate(() => (globalThis as any).__fake__.upcomingMeeting()) as string
    {
      await page.evaluate((id) => window.yogurt.nav.go(`/note/${id}`), upcoming)
      await page.getByTestId('note-brief-write').click()
      await expect(page.getByTestId('note-brief')).toContainText('Questions to ask', { timeout: 15_000 })
      // the brief read the invite and the emails with Maya from Microsoft 365
      const brief = (await prompts()).find((p) => p.startsWith('You will prepare'))!
      expect(brief).toContain('Agenda: renewal terms, Q3 rollout.')
      expect(brief).toContain('Can we keep the 2025 price')
      // and the related SharePoint document, read in full, with its link added by Yogurt
      expect(brief).toContain('Two-year term with a 4% discount')
      await expect(page.getByTestId('note-brief').getByRole('link', { name: 'Acme renewal proposal.docx' })).toHaveAttribute('href', /contoso\.sharepoint\.com/)
      if (shots) await page.getByTestId('note-brief').screenshot({ path: join(shots, 'note-brief.png') })
    }
  } finally { await app.close() }
})
