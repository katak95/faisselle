import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readyInterview } from './expert'

const main = join(import.meta.dirname, '../out/main/index.js')
// Chromium's own stand-in microphone (a tone), allowed without asking
const fakeMic = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
const shots = process.env.YOGURT_SHOTS

test('a voice interview: the agent greets and answers, it pauses and resumes, a line is corrected, and it ends', async () => {
  test.setTimeout(120_000)
  const userData = mkdtempSync(join(tmpdir(), 'faisselle-voice-'))
  const app = await electron.launch({ args: [main, ...fakeMic], env: { ...process.env, YOGURT_FAKE: '1', YOGURT_USER_DATA: userData } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('home')).toBeVisible()
    await readyInterview(page)

    await page.getByTestId('voice-start').click()
    // the stand-in for Nova Sonic greets, then answers each second or so of the microphone
    await expect(page.getByTestId('voice-line').first()).toHaveAttribute('data-speaker', 'agent', { timeout: 10_000 })
    await expect(page.getByTestId('voice-line').first()).toContainText('What does a typical month-end close look like for you?')
    await expect(page.locator('[data-testid="voice-line"][data-speaker="expert"]').first()).toContainText('fifth working day', { timeout: 15_000 })
    await expect(page.getByTestId('voice-state')).toHaveAttribute('data-state', /listening|thinking|speaking/)
    await expect(page.getByTestId('interview-state')).toHaveText('Under way')
    if (shots) { await page.getByTestId('voice-panel').scrollIntoViewIfNeeded(); await page.screenshot({ path: join(shots, 'expert-voice.png') }) }

    await page.getByTestId('voice-pause').click()
    await expect(page.getByTestId('voice-state')).toHaveAttribute('data-state', 'paused')
    const lines = await page.getByTestId('voice-line').count()
    await page.waitForTimeout(1500)
    // paused: nothing is heard or sent
    await expect(page.getByTestId('voice-line')).toHaveCount(lines)

    // the expert corrects what was heard
    const expert = page.locator('[data-testid="voice-line"][data-speaker="expert"]').first()
    await expert.getByTestId('voice-line-edit').click()
    await expert.getByTestId('voice-line-input').fill('We close the books on the fourth working day of the month.')
    await expert.getByTestId('voice-line-input').press('Enter')
    await expect(expert.getByTestId('voice-line-text')).toHaveText('We close the books on the fourth working day of the month.')
    await expect(expert.getByTestId('voice-line-edited')).toBeVisible()

    await page.getByTestId('voice-start').click()
    await expect(page.getByTestId('voice-state')).toHaveAttribute('data-state', /listening|thinking|speaking/, { timeout: 10_000 })
    await expect.poll(() => page.getByTestId('voice-line').count(), { timeout: 15_000 }).toBeGreaterThan(lines)

    await page.getByTestId('voice-stop').click()
    await expect(page.getByTestId('voice-state')).toHaveAttribute('data-state', 'ended')
    await expect(page.getByTestId('interview-state')).toHaveText('Ended')

    // each connection's audio, kept; then deleted alone
    const id = await page.evaluate(() => window.yogurt.expert.list().then((l) => l[0].id))
    expect(readdirSync(join(userData, 'expert', id)).filter((f) => f.endsWith('.wav')).length).toBeGreaterThanOrEqual(4)
    await page.getByTestId('voice-delete-audio').click()
    await page.getByTestId('voice-delete-audio-yes').click()
    await expect(page.getByTestId('voice-delete-audio')).toHaveCount(0)
    await expect(page.getByTestId('voice-line').first()).toBeVisible()
  } finally { await app.close() }
})

test('a role that may not use Nova Sonic says what it needs, and nothing else is tried', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'faisselle-voice-'))
  const app = await electron.launch({ args: [main, ...fakeMic], env: { ...process.env, YOGURT_FAKE: '1', YOGURT_USER_DATA: userData, FAISSELLE_FAKE_SONIC: 'access' } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('home')).toBeVisible()
    await readyInterview(page)
    await page.getByTestId('voice-start').click()
    await expect(page.getByTestId('voice-error')).toHaveText('The role may not use Amazon Nova Sonic (amazon.nova-2-5-sonic) in eu-north-1. It needs bedrock:InvokeModel there, with the model enabled in that region.')
    await expect(page.getByTestId('voice-start')).toHaveText(/Resume/)
  } finally { await app.close() }
})
