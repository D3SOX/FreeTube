import path from 'node:path'

import { test, expect, repoRoot } from '../helpers/app.mjs'
import { captureAppScreenshot, copyScreenshots, openScreenshotSettings, openScreenshotSubscriptions, openScreenshotWatch, sizeScreenshotWindow } from '../helpers/screenshots.mjs'

const THEMES = ['dark', 'light']

test.use({
  launchArgs: ['--lang=en-US'],
  showTutorial: true,
  seed: {
    freshProfile: true,
  },
})

test.afterEach(async ({ page }, testInfo) => {
  try {
    if (testInfo.status !== testInfo.expectedStatus) {
      await page.screenshot({ path: testInfo.outputPath('failure.png') })
    }
  } finally {
    // Keep the default confirmation settings in the images, but allow the
    // test fixture to close its isolated app without a confirmation prompt.
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateConfirmCloseApp', false)
      await store.dispatch('updateConfirmCloseWindowWithMultipleTabs', false)
    })
  }
})

async function setTheme(app, theme) {
  // Exercise the default System theme without changing an app setting.
  await app.page.emulateMedia({ colorScheme: theme })
  await expect(app.page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
}

test('refresh README screenshots from the live app', async ({ app, page }, testInfo) => {
  const tutorial = page.locator('.tutorialOverlay')
  await tutorial.getByRole('button', { name: 'Skip', exact: true }).click()
  await expect(tutorial).toBeHidden()

  await sizeScreenshotWindow(app)

  const captures = []
  async function capture(number, theme) {
    const name = `OpenTubeX${number}-${theme}.png`
    const view = { 1: 'subscriptions', 2: 'watch', 3: 'settings' }[number]
    await captureAppScreenshot(page, view, testInfo.outputPath(name))
    captures.push(name)
  }

  await test.step('maximized settings in both themes', async () => {
    const dialog = await openScreenshotSettings(page)
    for (const theme of THEMES) {
      await setTheme(app, theme)
      await expect(dialog.locator('.changedSettingIndicator')).toHaveCount(0)
      await capture(3, theme)
    }
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(dialog).toBeHidden()
  })

  await test.step('subscriptions in both themes', async () => {
    await openScreenshotSubscriptions(page)
    for (const theme of THEMES) {
      await setTheme(app, theme)
      await capture(1, theme)
    }
  })

  await test.step('watch page at 3:41:58 in both themes', async () => {
    await openScreenshotWatch(page)
    for (const theme of THEMES) {
      await setTheme(app, theme)
      await capture(2, theme)
    }
  })

  // A blocked stream or missing image must not replace the README with an
  // error page or leave it with only some of this run's captures.
  await copyScreenshots(testInfo, captures, path.join(repoRoot, 'docs', 'screenshots'))
})
