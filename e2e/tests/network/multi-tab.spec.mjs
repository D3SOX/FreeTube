import { sel } from '../../helpers/app.mjs'
import { test, expect } from '../../helpers/innertube.mjs'
import { activeTab, waitForPlaybackOrSkip } from '../../helpers/player.mjs'

const VIDEO_ONE = 'https://www.youtube.com/watch?v=jNQXAC9IVRw' // Me at the zoo
const VIDEO_TWO = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' // Big Buck Bunny

async function openVideoInActiveTab(page, url) {
  await page.locator(sel.searchInput).fill(url)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(/#\/watch\//)
  await expect(page.locator(`${activeTab} .videoTitle`)).toBeVisible({ timeout: 30_000 })
  return waitForPlaybackOrSkip(test, page)
}

async function setWindowMinimized(electronApp, minimized) {
  // Xvfb has no window manager to honour minimize()/restore(). Emit the native
  // events so the main process forwards the same state as in production.
  await electronApp.evaluate(({ BrowserWindow }, event) => {
    BrowserWindow.getAllWindows()[0].emit(event)
  }, minimized ? 'minimize' : 'restore')
}

async function setWindowFocused(app, page, focused) {
  await page.evaluate((hasFocus) => {
    Object.defineProperty(document, 'hasFocus', {
      configurable: true,
      value: () => hasFocus,
    })
  }, focused)
  await app.electronApp.evaluate(({ BrowserWindow }, event) => {
    BrowserWindow.getAllWindows()[0].emit(event)
  }, focused ? 'focus' : 'blur')
}

async function expectPictureInPicture(video, active) {
  await expect.poll(
    () => video.evaluate((element) => document.pictureInPictureElement === element)
  ).toBe(active)
}

// Regression: quick playback speed state leaked between tabs (021b06197)
test('playback speed is isolated per tab', async ({ page }) => {
  test.slow()

  await openVideoInActiveTab(page, VIDEO_ONE)

  await page.locator(sel.newTabButton).click()
  await expect(page.locator(sel.tabs)).toHaveCount(2)
  const secondVideo = await openVideoInActiveTab(page, VIDEO_TWO)

  // Speed up the second tab's player only.
  await page.locator('body').press('p')
  await expect.poll(async () => await secondVideo.evaluate((el) => el.playbackRate)).toBeGreaterThan(1)

  // The first tab's player must still play at normal speed.
  await page.locator(sel.tabs).first().click()
  const firstVideo = page.locator(`${activeTab} video`)
  await expect(firstVideo).toBeVisible()
  expect(await firstVideo.evaluate((el) => el.playbackRate)).toBe(1)
})

// Regression: measuring the hidden player's control bar could enter a
// resize/mutation loop and make the renderer stop processing all input.
test('switching away from a playing video keeps the renderer responsive', async ({ page }) => {
  test.slow()

  await openVideoInActiveTab(page, VIDEO_ONE)

  await page.locator(sel.newTabButton).click()
  await expect(page.locator(sel.tabs)).toHaveCount(2)

  await page.keyboard.press('Control+t')
  await expect(page.locator(sel.tabs)).toHaveCount(3)
  await page.locator(sel.tabs).first().click()
  await expect(page.locator(`${activeTab} .videoTitle`)).toBeVisible()
})

test.describe('automatic picture-in-picture', () => {
  test.use({
    seed: {
      settings: {
        autoPictureInPictureTriggers: ['tab', 'minimize', 'blur']
      }
    }
  })

  test.beforeEach(async ({ app, page }) => {
    await setWindowFocused(app, page, true)
  })

  // Regression: the blur emitted while minimizing kept the blur trigger active
  // after restore, so the automatically opened PiP window never closed (#265).
  test('exits PiP after restoring a minimized window', async ({ app, page, innertube }) => {
    test.skip(innertube.replay, 'no recorded fixtures for these videos')
    test.slow()

    const video = await openVideoInActiveTab(page, VIDEO_ONE)

    await setWindowMinimized(app.electronApp, true)
    await expectPictureInPicture(video, true)

    await setWindowMinimized(app.electronApp, false)
    await expectPictureInPicture(video, false)
  })

  // Regression: Chromium on Windows can briefly stretch the poster across the
  // compositor surface when blur-triggered PiP detaches a playing video (#362).
  test('removes the poster before blur-triggered PiP', async ({ app, page, innertube }) => {
    test.skip(innertube.replay, 'no recorded fixtures for these videos')
    test.slow()

    const video = await openVideoInActiveTab(page, VIDEO_ONE)
    await expect(video).not.toHaveAttribute('poster')

    await setWindowFocused(app, page, false)
    await expectPictureInPicture(video, true)
    await expect(video).not.toHaveAttribute('poster')

    await setWindowFocused(app, page, true)
    await expectPictureInPicture(video, false)
  })

  // Regression: play events from an inactive logical tab were rejected even
  // when that tab's video was still presented in the native PiP window (#266).
  test('resumes PiP playback from an inactive tab while minimized', async ({ app, page, innertube }) => {
    test.skip(innertube.replay, 'no recorded fixtures for these videos')
    test.slow()

    await openVideoInActiveTab(page, VIDEO_ONE)
    // Keep targeting the original player after another tab becomes active.
    const video = page.locator('.tabContent').first().locator('video')

    await page.locator(sel.newTabButton).click()
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    await expectPictureInPicture(video, true)

    await setWindowMinimized(app.electronApp, true)
    await video.evaluate((element) => element.pause())
    await expect.poll(() => video.evaluate((element) => element.paused)).toBe(true)

    await video.evaluate((element) => element.play())
    await expect.poll(() => video.evaluate((element) => element.paused)).toBe(false)
  })
})
