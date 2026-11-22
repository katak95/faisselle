import { expect, type Page } from '@playwright/test'

/** Bedrock as for the notes (fake mode signs in at once), so an interview can be agreed to */
export async function signInToBedrock(page: Page) {
  await page.evaluate(async () => {
    await window.yogurt.cloud.setProvider('bedrock')
    await window.yogurt.cloud.setConfig({ startUrl: 'https://example.awsapps.com/start' })
    await window.yogurt.cloud.signIn()
  })
  await expect.poll(() => page.evaluate(() => window.yogurt.cloud.get().then((v) => v.sso.state)), { timeout: 10_000 }).toBe('signed-in')
  await page.evaluate(() => window.yogurt.cloud.setConfig({ accountId: '123456789012', roleName: 'BedrockUser' }))
}

/** a new interview, agreed to, its page open */
export async function readyInterview(page: Page, title = 'Month-end close') {
  await page.getByTestId('nav-interviews').click()
  await page.getByTestId('interview-new').click()
  await page.getByTestId('interview-title').fill(title)
  await page.getByTestId('interview-create-yes').click()
  await expect(page.getByTestId('interview-heading')).toHaveText(title)
  await signInToBedrock(page)
  await page.getByTestId('consent-agree').click()
  await expect(page.getByTestId('consent-status')).toContainText('You agreed on')
}
