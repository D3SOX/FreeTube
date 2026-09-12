import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

test.use({ seed: { settings: { animationSpeed: 0, videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

for (const zoom of [1, 0.95]) {
  for (const mode of ['native', 'browser', 'pip']) {
    test(`phone panel survives ${mode} and clamps shorter content at ${zoom} UI scale`, async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      await setWindowSize(app, page, { width: 480, height: 800 })
      await page.evaluate(zoom => window.ftElectron.setZoomFactor(zoom), zoom)
      if (mode === 'browser') await page.setViewportSize({ width: Math.round(480 / zoom), height: Math.round(800 / zoom) })
      const watch = await watchViewHandle(page)
      await watch.evaluate(vm => {
        vm.videoDescription = 'Description line\n'.repeat(100)
        vm.videoDescriptionHtml = ''
        vm.openPhonePanel('description')
      })
      const sheet = page.locator('.dockedSheet[open]')
      await expect(sheet).toBeVisible()
      const description = await sheet.locator('.description').elementHandle()
      await description.evaluate(el => { el.textContent = 'Description line\n'.repeat(100) })
      const viewport = sheet.locator('.phonePanelScroller')
      await expect.poll(() => viewport.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(100)
      await viewport.evaluate(el => { el.scrollTop = el.scrollHeight })
      const position = await viewport.evaluate(el => el.scrollTop)
      const player = page.locator('.ftVideoPlayer')
      for (const shorten of [false, true]) {
        await player.evaluate((el, mode) => {
          if (mode === 'native') el.setAttribute('data-native-player-screen', '')
          else if (mode === 'browser') return el.requestFullscreen()
          else document.body.classList.add('androidPictureInPicture')
        }, mode)
        await expect(sheet).toHaveCount(0)
        if (mode === 'pip') await setWindowSize(app, page, { width: 450, height: 270 })
        if (shorten) await description.evaluate(el => { el.textContent = 'Short description' })
        if (mode === 'pip') await setWindowSize(app, page, { width: 480, height: 800 })
        await player.evaluate((el, mode) => {
          if (mode === 'native') el.removeAttribute('data-native-player-screen')
          else if (mode === 'browser') return document.exitFullscreen()
          else document.body.classList.remove('androidPictureInPicture')
        }, mode)
        await expect(sheet).toBeVisible()
        await expect.poll(async () => {
          const panel = await sheet.boundingBox()
          const video = await player.boundingBox()
          return Math.abs(panel.y - video.y - video.height)
        }).toBeLessThan(2)
        if (!shorten) {
          await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBeCloseTo(position, 0)
        } else {
          await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBe(0)
          await expect(viewport.locator('.os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
          await expect.poll(() => viewport.evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1)
        }
      }
    })
  }
}

test('comments retain their inner scroll position through fullscreen rotation and clamp on PiP return', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  await page.locator('.phoneCommentsButton').click()
  const sheet = page.locator('.dockedSheet[open]')
  const viewport = sheet.locator('.commentsContentWrapper')
  await expect(sheet.locator('.comment').first()).toBeVisible()
  await expect.poll(() => viewport.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(800)
  await viewport.evaluate(el => { el.scrollTop = 800 })
  const player = page.locator('.ftVideoPlayer')
  await player.evaluate(el => el.setAttribute('data-native-player-screen', ''))
  await expect(sheet).toHaveCount(0)
  await setWindowSize(app, page, { width: 800, height: 480 })
  await player.evaluate(el => el.removeAttribute('data-native-player-screen'))
  await expect(sheet).toBeVisible()
  await setWindowSize(app, page, { width: 480, height: 800 })
  await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBeCloseTo(800, 0)
  await viewport.evaluate(el => { el.scrollTop = el.scrollHeight })
  const comments = await sheet.locator('.comment').first().locator('..').elementHandle()
  await page.evaluate(() => document.body.classList.add('androidPictureInPicture'))
  await expect(sheet).toHaveCount(0)
  await comments.evaluate(el => { el.textContent = 'Only remaining comment' })
  await page.evaluate(() => document.body.classList.remove('androidPictureInPicture'))
  await expect(sheet).toBeVisible()
  await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBe(0)
  await expect(viewport.locator('.os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
})
