import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openFromCorner } from './cornerNavigation'
import { readyInterview } from './expert'

const main = join(import.meta.dirname, '../out/main/index.js')
const fakeMic = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
const launch = (env: Record<string, string>) => electron.launch({ args: [main, ...fakeMic], env: { ...process.env, YOGURT_FAKE: '1', YOGURT_USER_DATA: mkdtempSync(join(tmpdir(), 'faisselle-expert-backup-')), ...env } })

test('an interview, its transcript, analysis and skills go in the backup and come back on another computer', async () => {
  test.setTimeout(180_000)
  const file = join(mkdtempSync(join(tmpdir(), 'faisselle-expert-backup-file-')), 'backup.zip')
  const a = await launch({ YOGURT_BACKUP_PATH: file })
  try {
    const page = await a.firstWindow()
    await expect(page.getByTestId('home')).toBeVisible()
    await readyInterview(page)
    await page.getByTestId('voice-start').click()
    await expect(page.locator('[data-testid="voice-line"][data-speaker="expert"]').first()).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('voice-pause').click()
    await page.getByTestId('analysis-run').click()
    await expect(page.getByTestId('interview-analysis')).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    await page.getByTestId('skills-write').click()
    await expect(page.getByTestId('skill')).toHaveCount(2, { timeout: 15_000 })

    await openFromCorner(page, 'settings-open')
    await page.getByTestId('backup-export').click()
    await expect(page.getByTestId('backup-said')).toContainText('Expert interviews are in it too.')
  } finally { await a.close() }

  const b = await launch({ YOGURT_BACKUP_PATH: file })
  try {
    const page = await b.firstWindow()
    await expect(page.getByTestId('home')).toBeVisible()
    await openFromCorner(page, 'settings-open')
    await page.getByTestId('backup-import').click()
    await expect(page.getByTestId('backup-said')).toHaveText('Expert interviews added.')
    await page.getByTestId('nav-interviews').click()
    await expect(page.getByTestId('interview-row')).toHaveCount(1)
    await page.getByTestId('interview-row').click()
    await expect(page.getByTestId('interview-heading')).toHaveText('Month-end close')
    // talked in, then paused: it comes back as it was left
    await expect(page.getByTestId('interview-state')).toHaveText('Paused')
    await expect(page.locator('[data-testid="voice-line"][data-speaker="expert"]').first()).toContainText('fifth working day')
    await expect(page.getByTestId('analysis-summary')).toContainText('fifth working day')
    await expect(page.getByTestId('skill')).toHaveCount(2)

    // again: nothing new
    await openFromCorner(page, 'settings-open')
    await page.getByTestId('backup-import').click()
    await expect(page.getByTestId('backup-said')).toHaveText('Nothing new in this backup.')
  } finally { await b.close() }
})
