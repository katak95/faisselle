import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readyInterview } from './expert'

const main = join(import.meta.dirname, '../out/main/index.js')
const fakeMic = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
const shots = process.env.YOGURT_SHOTS

test('Skill Studio: skills written from the analysis, changed, written again around the change, and exported', async () => {
  test.setTimeout(150_000)
  const out = mkdtempSync(join(tmpdir(), 'faisselle-skills-out-'))
  const app = await electron.launch({ args: [main, ...fakeMic], env: { ...process.env, YOGURT_FAKE: '1', YOGURT_USER_DATA: mkdtempSync(join(tmpdir(), 'faisselle-skills-')), FAISSELLE_EXPERT_EXPORT: out } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('home')).toBeVisible()
    await readyInterview(page)
    // no analysis yet: nothing to write the skills from
    await expect(page.getByTestId('skills-write')).toBeDisabled()

    await page.getByTestId('voice-start').click()
    await expect(page.locator('[data-testid="voice-line"][data-speaker="expert"]').first()).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('voice-pause').click()
    await page.getByTestId('analysis-run').click()
    await expect(page.getByTestId('interview-analysis')).toHaveAttribute('data-state', 'done', { timeout: 15_000 })

    await page.getByTestId('skills-write').click()
    const skills = page.getByTestId('skill')
    await expect(skills).toHaveCount(2, { timeout: 15_000 })
    // Claude's "Month-end close" becomes a valid name
    await expect(skills.nth(0).getByTestId('skill-name')).toHaveText('month-end-close')
    await expect(skills.nth(0).getByTestId('skill-edit-body')).toHaveValue(/## Steps\n1\. Reconcile the bank accounts\./)
    if (shots) { await skills.nth(0).scrollIntoViewIfNeeded(); await page.screenshot({ path: join(shots, 'expert-skills.png') }) }

    // the expert's change is kept when the skills are written again; the other is written anew
    const close = page.locator('[data-testid="skill"][data-name="month-end-close"]')
    await close.getByTestId('skill-edit-body').fill('## Steps\n1. Reconcile the bank accounts by the third working day.')
    await close.getByTestId('skill-edit-name').click()
    await expect(close).toHaveAttribute('data-edited', 'true')
    await page.getByTestId('skills-write').click()
    await expect(page.getByTestId('skill-studio')).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    await expect(skills).toHaveCount(3)
    await expect(close.getByTestId('skill-edit-body')).toHaveValue(/third working day/)
    // Claude wrote month-end-close again: the new one gets a number, the expert's keeps the name
    await expect(page.locator('[data-testid="skill"][data-name="month-end-close-2"]')).toHaveAttribute('data-edited', 'false')

    // a name made valid, and one already taken given a number
    const invoices = page.locator('[data-testid="skill"][data-name="missing-invoices"]')
    await invoices.getByTestId('skill-edit-name').fill('Month End Close')
    await invoices.getByTestId('skill-edit-name').press('Enter')
    await expect(page.locator('[data-testid="skill"][data-name="month-end-close-3"]')).toHaveCount(1)
    await page.locator('[data-testid="skill"][data-name="month-end-close-2"]').getByTestId('skill-delete').click()
    await page.locator('[data-testid="skill"][data-name="month-end-close-2"]').getByTestId('skill-delete-yes').click()
    await expect(skills).toHaveCount(2)

    // a blank skill can't be exported until it says when to use it and what to do
    await page.getByTestId('skill-new').click()
    const fresh = page.locator('[data-testid="skill"][data-name="new-skill"]')
    await expect(fresh.getByTestId('skill-export')).toBeDisabled()
    await expect(fresh.getByTestId('skill-edit-description-hint')).toBeVisible()

    // one skill, then all of those ready, each a folder with its SKILL.md
    await close.getByTestId('skill-export').click()
    await expect(page.getByTestId('skills-status')).toHaveText('Skills exported.')
    expect(readdirSync(out)).toContain('month-end-close.zip')
    await page.getByTestId('skills-export-all').click()
    await expect.poll(() => readdirSync(out)).toContain('month-end-close-skills.zip')
    const zip = readFileSync(join(out, 'month-end-close-skills.zip')).toString('latin1')
    expect(zip).toContain('month-end-close/SKILL.md')
    expect(zip).toContain('month-end-close-3/SKILL.md')
    expect(zip).not.toContain('new-skill/SKILL.md')

    // kept after a restart
    await page.reload()
    await expect(skills).toHaveCount(3)
    await expect(close.getByTestId('skill-edit-body')).toHaveValue(/third working day/)
  } finally { await app.close() }
})
