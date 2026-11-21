import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const main = join(import.meta.dirname, '../out/main/index.js')
const llmFiles = (dir: string) => (existsSync(join(dir, 'models', 'llm')) ? readdirSync(join(dir, 'models', 'llm')) : [])

for (const bedrock of [true, false]) {
  test(`the first run's notes model waits for the welcome screen, and ${bedrock ? 'never downloads once Bedrock is picked there' : 'downloads after it otherwise'}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'yogurt-welcome-'))
    const app = await electron.launch({ args: [main], env: { ...process.env, YOGURT_FAKE: '1', YOGURT_USER_DATA: dir, YOGURT_FAKE_PERMISSIONS: 'unknown', YOGURT_FAKE_CALENDAR: 'notDetermined' } })
    try {
      const page = await app.firstWindow()
      await expect(page.getByTestId('intro-page')).toBeVisible()
      // speech is in, but the notes model waits on this screen
      await page.waitForTimeout(1500)
      expect(llmFiles(dir)).toEqual([])
      if (bedrock) await page.getByTestId('intro-bedrock').check()
      if (process.env.YOGURT_SHOTS && bedrock) await page.screenshot({ path: join(process.env.YOGURT_SHOTS, 'welcome.png') })
      await expect(page.getByTestId('intro-notes-model')).toContainText(bedrock ? 'No notes model is downloaded' : 'downloads after this screen')
      await page.getByTestId('intro-next').click()
      await expect(page.getByTestId('onboarding-step')).toBeVisible()
      if (bedrock) {
        await page.waitForTimeout(2000)
        expect(llmFiles(dir)).toEqual([])
        expect(await page.evaluate(() => window.yogurt.cloud.get().then((v) => v.provider))).toBe('bedrock')
      } else {
        await expect.poll(() => llmFiles(dir).length, { timeout: 15_000 }).toBeGreaterThan(0)
      }
    } finally { await app.close() }
  })
}
