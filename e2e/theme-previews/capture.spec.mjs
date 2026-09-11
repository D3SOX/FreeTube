import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { normalizeCustomTheme } from '../../src/customTheme.js'
import { PREVIEW_VIEWS } from '../../_scripts/themePreview.mjs'
import { test, expect } from '../helpers/app.mjs'
import { captureAppScreenshot, copyScreenshots, openScreenshotSettings, openScreenshotSubscriptions, openScreenshotWatch, sizeScreenshotWindow } from '../helpers/screenshots.mjs'

const directory = process.env.THEME_PREVIEW_DIR
if (!directory) throw new Error('Set THEME_PREVIEW_DIR to a directory containing theme.json')
const theme = normalizeCustomTheme(JSON.parse(await readFile(path.join(directory, 'theme.json'), 'utf8')))

test.use({
  launchArgs: ['--lang=en-US'],
  showTutorial: true,
  seed: {
    freshProfile: true,
  },
})

test.afterEach(async ({ page }) => {
  // Preserve the default confirmation settings until all captures are done.
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateConfirmCloseApp', false)
    await store.dispatch('updateConfirmCloseWindowWithMultipleTabs', false)
  })
})

test('captures the submitted theme with the README feed and watch page', async ({ app, page }, testInfo) => {
  const tutorial = page.locator('.tutorialOverlay')
  await tutorial.getByRole('button', { name: 'Skip', exact: true }).click()
  await expect(tutorial).toBeHidden()

  await sizeScreenshotWindow(app)
  await page.evaluate(async theme => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const themes = await window.ftElectron.saveCustomTheme(theme)
    store.commit('setCustomThemes', themes)
    await store.dispatch('updateBaseTheme', `custom:${theme.id}`)
  }, theme)
  await expect(page.locator('body')).toHaveClass(/\bcustom\b/)
  await expect.poll(() => page.locator('body').evaluate(body => body.style.getPropertyValue('--bg-color')))
    .toBe(theme.colors.background)
  await expect(page.locator('.profileTrigger')).toHaveCSS('background-color',
    await page.locator('body').evaluate(body => {
      const probe = document.createElement('span')
      probe.style.backgroundColor = 'var(--primary-color)'
      body.append(probe)
      const color = getComputedStyle(probe).backgroundColor
      probe.remove()
      return color
    }))

  async function capture(view) {
    await captureAppScreenshot(page, view, testInfo.outputPath(`${view}.png`))
  }

  // Like the README captures, photograph Settings before configuring content.
  const settings = await openScreenshotSettings(page)
  await expect(settings.locator('.changedSettingIndicator')).toHaveCount(0)
  await capture('settings')
  await settings.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(settings).toBeHidden()

  await openScreenshotSubscriptions(page)
  await capture('subscriptions')

  await openScreenshotWatch(page)
  await capture('watch')

  // Only publish a complete set. Failed captures stay in Playwright's results.
  await copyScreenshots(testInfo, PREVIEW_VIEWS.map(view => `${view}.png`), directory)
})
