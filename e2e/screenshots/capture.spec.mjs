import path from 'node:path'

import { test, expect, goTo, repoRoot, sel } from '../helpers/app.mjs'
import { captureAppScreenshot, copyScreenshots, openScreenshotSettings, sizeScreenshotWindow } from '../helpers/screenshots.mjs'

// Keep both themes on the same video and decoded frame across future updates.
const VIDEO_ID = 'AY5qcIq5u2g'
const TIMESTAMP = 3 * 3600 + 41 * 60 + 58
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

async function expectPausedFrame(video) {
  await expect.poll(() => video.evaluate(element => ({
    paused: element.paused,
    seeking: element.seeking,
    ready: element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
    time: element.currentTime,
  }))).toEqual({ paused: true, seeking: false, ready: true, time: TIMESTAMP })
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

  // Configure only what the live content capture needs, after photographing
  // Settings with a fresh profile and all app defaults intact.
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateFetchSubscriptionsAutomatically', false)
    await store.dispatch('updateVideoPlaybackEngine', 'yt-dlp')
  })

  await test.step('subscriptions in both themes', async () => {
    await page.locator(sel.searchInput).fill('https://www.youtube.com/channel/UCsXVk37bltHxD1rDPwtNM8Q')
    await page.locator(sel.searchInput).press('Enter')
    const subscribe = page.locator('.ftSubscribeButton .subscribeButton').first()
    await expect(subscribe).toHaveText(/^\s*Subscribe/)
    await subscribe.click()
    await expect(subscribe).toHaveText(/^\s*Unsubscribe/)
    await page.locator(sel.searchInput).fill('')
    await goTo(page, 'subscriptions')
    await page.locator('.subscriptionsHeaderRefreshWidget .refreshButton').click()
    await expect(page.locator('.ft-list-video').nth(11)).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('.subscriptionsHeaderRefreshWidget .refreshButton button'))
      .toHaveAttribute('title', /Refresh/)
    for (const theme of THEMES) {
      await setTheme(app, theme)
      await capture(1, theme)
    }
  })

  await test.step('watch page at 3:41:58 in both themes', async () => {
    await page.locator(sel.searchInput).fill(`https://www.youtube.com/watch?v=${VIDEO_ID}&t=${TIMESTAMP}`)
    await page.locator(sel.searchInput).press('Enter')
    await expect(page.locator('.videoTitle')).toContainText('FLYING OVER JAPAN', { timeout: 60_000 })
    const video = page.locator('.ftVideoPlayer video')
    await expect(video).toBeVisible({ timeout: 60_000 })
    await expect.poll(async () => ({
      ready: await video.evaluate(element => element.readyState >= 2),
      errors: await page.locator('.errorMessage:visible').allTextContents(),
    }), { timeout: 60_000, message: 'waiting for a playable frame from YouTube' })
      .toEqual({ ready: true, errors: [] })
    await video.evaluate((element, timestamp) => {
      element.pause()
      element.currentTime = timestamp
    }, TIMESTAMP)
    await expectPausedFrame(video)
    await page.locator(sel.searchInput).fill('')
    for (const theme of THEMES) {
      await setTheme(app, theme)
      await expectPausedFrame(video)
      await capture(2, theme)
      await expectPausedFrame(video)
    }
  })

  // A blocked stream or missing image must not replace the README with an
  // error page or leave it with only some of this run's captures.
  await copyScreenshots(testInfo, captures, path.join(repoRoot, 'docs', 'screenshots'))
})
