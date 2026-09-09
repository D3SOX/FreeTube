import { readFile } from 'node:fs/promises'
import { expect, goToSettingsSection, latestSettings, sel, setPlayerFullscreen, setWindowSize, test } from '../../helpers/app.mjs'
import { openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
      baseTheme: 'openTubeXDark',
      useCustomShortsPlayer: true,
      loopShorts: true,
    }
  }
})

async function openVideo(app, page) {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  return video
}

async function toggleLoop(page) {
  const player = page.locator('.ftVideoPlayer')
  await player.hover()
  await player.getByRole('button', { name: 'More settings' }).click({ force: true })
  await player.locator('.shaka-overflow-menu .loop-button').click()
  await page.keyboard.press('Escape')
}

test('repeat stats count native loops and retain totals across pauses and toggles', async ({ app, page, attachScreenshot }) => {
  const video = await openVideo(app, page)
  const stats = page.getByRole('region', { name: 'Repeat stats', exact: true })
  await expect(stats).toHaveCount(0)
  await toggleLoop(page)
  await expect(stats).toBeVisible()
  await expect(stats.locator('.repeatStatsCount')).toHaveText('0')

  await video.evaluate(element => { element.currentTime = element.duration - 1.5 })
  await expect.poll(() => video.evaluate(element => element.seeking)).toBe(false)
  await expect(stats.locator('.repeatStatsCount')).toHaveText('0')
  await video.evaluate(element => element.play())
  await expect(stats.locator('.repeatStatsCount')).toHaveText('1')
  await video.evaluate(element => element.pause())
  const spent = await stats.locator('.repeatStatsTime').textContent()
  expect(spent).not.toBe('0:00')

  await video.evaluate(element => { element.currentTime = 12 })
  await expect.poll(() => video.evaluate(element => element.seeking)).toBe(false)
  await video.evaluate(element => { element.currentTime = 0 })
  await page.waitForTimeout(1200)
  await expect(stats.locator('.repeatStatsTime')).toHaveText(spent)
  await expect(stats.locator('.repeatStatsCount')).toHaveText('1')
  await toggleLoop(page)
  await expect(stats).toHaveCount(0)
  await toggleLoop(page)
  await expect(stats.locator('.repeatStatsTime')).toHaveText(spent)
  await expect(stats.locator('.repeatStatsCount')).toHaveText('1')
  await attachScreenshot('repeat stats below the video')
})

test('repeat stats count A-B boundaries, ignore range correction seeks, and reset after range edits', async ({ app, page }) => {
  const video = await openVideo(app, page)
  await video.evaluate(element => { element.currentTime = 5 })
  await expect.poll(() => video.evaluate(element => element.seeking)).toBe(false)
  await page.keyboard.press('Shift+A')
  await video.evaluate(element => { element.currentTime = 6 })
  await expect.poll(() => video.evaluate(element => element.seeking)).toBe(false)
  await page.keyboard.press('Shift+B')
  const stats = page.locator('.repeatStats')
  await expect(stats).toContainText('A-B repeat')
  await expect(stats.locator('.repeatStatsCount')).toHaveText('0')
  await video.evaluate(element => element.play())
  await expect.poll(() => stats.locator('.repeatStatsCount').textContent()).toBe('2')
  await video.evaluate(element => element.pause())

  await video.evaluate(element => { element.currentTime = 15 })
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBe(5)
  await expect(stats.locator('.repeatStatsCount')).toHaveText('2')
  await page.locator('.abRepeatMarkerB').focus()
  await page.keyboard.press('ArrowRight')
  await expect(stats.locator('.repeatStatsCount')).toHaveText('0')
  await expect(stats.locator('.repeatStatsTime')).toHaveText('0:00')
  await expect(stats).toContainText('0:06.1')
})

test('repeat stats wrap below the player at fractional UI scale and stay out of fullscreen', async ({ app, page }, testInfo) => {
  await openVideo(app, page)
  await toggleLoop(page)
  await setWindowSize(app, page, { width: 640, height: 800 })
  await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))
  const stats = page.locator('.repeatStats')
  await expect(stats).toBeVisible()
  await expect.poll(() => stats.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    const playerBounds = element.parentElement.querySelector('.ftVideoPlayer').getBoundingClientRect()
    return bounds.right <= document.documentElement.clientWidth + 0.5 &&
      bounds.top >= playerBounds.bottom - 0.5 && element.scrollWidth <= element.clientWidth &&
      [...element.querySelectorAll('dt, dd')].every(child => {
        const rect = child.getBoundingClientRect()
        return rect.left >= bounds.left && rect.right <= bounds.right
      })
  })).toBe(true)
  // Electron capturePage uses the window's actual bounds at fractional zoom.
  const screenshot = await app.electronApp.evaluate(async ({ BrowserWindow }) => {
    return (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')
  })
  await testInfo.attach('repeat stats at 125 percent UI scale', {
    body: Buffer.from(screenshot, 'base64'), contentType: 'image/png'
  })
  await setPlayerFullscreen(page, true)
  await expect(stats).toHaveCount(0)
  await setPlayerFullscreen(page, false)
  await expect(stats).toBeVisible()
})

test('repeat stats observe Android loop toggles and automatic seek completion', async ({ app, page }) => {
  await openVideo(app, page)
  const mediaSource = await readFile(new URL('../../../src/renderer/helpers/player/androidMediaElement.js', import.meta.url), 'utf8')
  await page.addScriptTag({ content: mediaSource.replace('export function ', 'function ') })
  await page.evaluate(() => {
    const video = document.querySelector('.ftVideoPlayer video')
    window.repeatNativeMedia = window.attachAndroidMediaElement(video, {
      command: async () => {}, load: async () => {}, onError: error => { throw error }
    })
    window.repeatNativeMedia.update({ position: 29.8, duration: 30, paused: true, playing: false, ready: true })
  })
  await toggleLoop(page)
  const stats = page.locator('.repeatStats')
  await expect(stats).toBeVisible()
  await page.evaluate(() => {
    window.repeatNativeMedia.update({ position: 29.8, paused: false, playing: true })
  })
  await page.waitForTimeout(220)
  await page.evaluate(() => {
    window.repeatNativeMedia.update({ position: 0, event: 'seeked' })
  })
  await expect(stats.locator('.repeatStatsCount')).toHaveText('1')
  await toggleLoop(page)
  await expect(stats).toHaveCount(0)
  await page.evaluate(() => window.repeatNativeMedia.detach())
})

test('repeat stats reserve space below Shorts without covering the following content', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.locator(sel.searchInput).fill('https://www.youtube.com/shorts/jNQXAC9IVRw')
  await page.locator(sel.searchInput).press('Enter')
  const video = await waitForPlayback(page)
  await video.evaluate(element => element.pause())
  await expect(page.locator('.videoLayout')).toHaveClass(/shortsPlayerActive/)
  const stats = page.locator('.repeatStats')
  await expect(stats).toBeVisible()
  const expectContained = () => expect.poll(() => stats.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    const host = element.closest('.ftVideoPlayerHost').getBoundingClientRect()
    const player = element.parentElement.querySelector('.ftVideoPlayer').getBoundingClientRect()
    return host.bottom >= bounds.bottom - 0.5 && bounds.top >= player.bottom - 0.5 &&
      element.scrollWidth <= element.clientWidth
  })).toBe(true)
  await expectContained()
  await setWindowSize(app, page, { width: 640, height: 800 })
  await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))
  await expectContained()
  await expect.poll(() => page.locator('.shortsExternalMetadata').evaluate(element => {
    return element.getBoundingClientRect().top >= document.querySelector('.repeatStats').getBoundingClientRect().bottom - 0.5
  })).toBe(true)
})

test('Distraction Free hides repeat stats immediately without disabling looping or losing the session', async ({ app, page }) => {
  const video = await openVideo(app, page)
  await toggleLoop(page)
  const stats = page.locator('.repeatStats')
  await expect(stats).toBeVisible()
  await video.evaluate(element => { element.currentTime = element.duration - 0.5 })
  await expect.poll(() => video.evaluate(element => element.seeking)).toBe(false)
  await video.evaluate(element => element.play())
  await expect(stats.locator('.repeatStatsCount')).toHaveText('1')
  await video.evaluate(element => element.pause())
  const spent = await stats.locator('.repeatStatsTime').textContent()

  const focus = await goToSettingsSection(page, 'focus')
  const hideStats = focus.getByRole('checkbox', { name: /^Hide Repeat Stats/ })
  await expect(hideStats).not.toBeChecked()
  await hideStats.locator('..').locator('label.switch-label').click()
  await expect(hideStats).toBeChecked()
  await expect(stats).toHaveCount(0)
  await expect.poll(() => video.evaluate(element => element.loop)).toBe(true)
  await expect.poll(async () => {
    const contents = await readFile(`${app.userDataDir}/settings.db`, 'utf8')
    return latestSettings(contents).hideRepeatStats
  }).toBe(true)

  await hideStats.locator('..').locator('label.switch-label').click()
  await expect(hideStats).not.toBeChecked()
  await expect(stats.locator('.repeatStatsCount')).toHaveText('1')
  await expect(stats.locator('.repeatStatsTime')).toHaveText(spent)
  await expect.poll(async () => {
    const contents = await readFile(`${app.userDataDir}/settings.db`, 'utf8')
    return latestSettings(contents).hideRepeatStats
  }).toBe(false)
})
