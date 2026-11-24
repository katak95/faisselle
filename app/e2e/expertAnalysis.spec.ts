import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readyInterview } from './expert'

const main = join(import.meta.dirname, '../out/main/index.js')
const fakeMic = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
const shots = process.env.YOGURT_SHOTS

test('an interview is analysed: what was learned, the questions to ask next, asked in the next session, and analysed again', async () => {
  test.setTimeout(150_000)
  const app = await electron.launch({ args: [main, ...fakeMic], env: { ...process.env, YOGURT_FAKE: '1', YOGURT_USER_DATA: mkdtempSync(join(tmpdir(), 'faisselle-analysis-')) } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('home')).toBeVisible()
    await readyInterview(page)
    // nothing said yet: nothing to analyse
    await expect(page.getByTestId('analysis-run')).toBeDisabled()

    await page.getByTestId('voice-start').click()
    await expect(page.locator('[data-testid="voice-line"][data-speaker="expert"]').first()).toContainText('fifth working day', { timeout: 15_000 })
    // while it talks, it isn't analysed
    await expect(page.getByTestId('analysis-run')).toBeDisabled()
    await page.getByTestId('voice-pause').click()
    await expect(page.getByTestId('voice-state')).toHaveAttribute('data-state', 'paused')

    await page.getByTestId('analysis-run').click()
    const panel = page.getByTestId('interview-analysis')
    await expect(panel).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    await expect(page.getByTestId('analysis-summary')).toContainText('fifth working day')
    await expect(page.getByTestId('analysis-gaps')).toContainText('does not balance')
    await expect(page.locator('[data-testid="analysis-kind"][data-kind="procedure"]')).toContainText('Month-end close order')
    await expect(page.getByTestId('analysis-quote').first()).toContainText('First I reconcile the bank accounts')
    const followUps = page.getByTestId('follow-up')
    await expect(followUps).toHaveCount(2)
    if (shots) { await panel.scrollIntoViewIfNeeded(); await page.screenshot({ path: join(shots, 'expert-analysis.png'), fullPage: true }) }

    // one question set aside, one kept: the kept one is asked when the expert comes back
    await followUps.filter({ hasText: 'Who approves' }).getByTestId('follow-up-dismiss').click()
    await expect(followUps.filter({ hasText: 'Who approves' })).toHaveAttribute('data-status', 'dismissed')
    await page.getByTestId('voice-start').click()
    await expect(page.getByTestId('voice-state')).toHaveAttribute('data-state', /listening|thinking|speaking/, { timeout: 10_000 })
    await expect(followUps.filter({ hasText: 'does not balance' })).toHaveAttribute('data-status', 'asked')
    await expect(followUps.filter({ hasText: 'does not balance' })).toContainText('Asked in a voice session')
    const lines = await page.getByTestId('voice-line').count()
    await expect.poll(() => page.getByTestId('voice-line').count(), { timeout: 15_000 }).toBeGreaterThan(lines)
    await page.getByTestId('voice-pause').click()

    // more was said since: analysed again, the question asked and the one set aside aren't offered again
    await expect(page.getByTestId('analysis-status')).toContainText('The interview went on since')
    await page.getByTestId('analysis-run').click()
    await expect(page.getByTestId('analysis-status')).toContainText('Analysed on', { timeout: 15_000 })
    await expect(followUps).toHaveCount(2)
    await expect(followUps.filter({ hasText: 'Who approves' })).toHaveAttribute('data-status', 'dismissed')
    await expect(followUps.filter({ hasText: 'does not balance' })).toHaveAttribute('data-status', 'asked')

    // kept after a restart
    await page.reload()
    await expect(page.getByTestId('analysis-summary')).toContainText('working day')
    await expect(followUps).toHaveCount(2)
  } finally { await app.close() }
})

test('without the consent for the analysis model, the interview is not sent', async () => {
  test.setTimeout(120_000)
  const app = await electron.launch({ args: [main, ...fakeMic], env: { ...process.env, YOGURT_FAKE: '1', YOGURT_USER_DATA: mkdtempSync(join(tmpdir(), 'faisselle-analysis-')) } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('home')).toBeVisible()
    await readyInterview(page)
    await page.getByTestId('voice-start').click()
    await expect(page.locator('[data-testid="voice-line"][data-speaker="expert"]').first()).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('voice-pause').click()
    // another analysis model: what goes where changed, so it is asked again before anything is sent
    await page.evaluate(() => window.yogurt.expert.setSettings({ analysisModelId: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0' }))
    const prompts = () => app.evaluate(() => ((globalThis as any).__fake__.prompts().notes as string[]).filter((p) => p.startsWith("You are helping turn an expert's know-how")).length)
    await page.getByTestId('analysis-run').click()
    await expect(page.getByTestId('analysis-status')).toHaveText('Agree to what is sent to Bedrock first (Before you talk).')
    expect(await prompts()).toBe(0)
    await page.getByTestId('consent-agree').click()
    await page.getByTestId('analysis-run').click()
    await expect(page.getByTestId('interview-analysis')).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    expect(await prompts()).toBe(1)
  } finally { await app.close() }
})
