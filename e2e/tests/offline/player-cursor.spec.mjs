import { test, expect } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true
    }
  }
})

for (const fullscreen of [false, true]) {
  test(`hides the idle mouse cursor during ${fullscreen ? 'fullscreen' : 'windowed'} playback`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    const player = page.locator('.ftVideoPlayer')
    const controls = player.locator('.shaka-controls-container')
    if (fullscreen) {
      await player.hover()
      await player.locator('.shaka-fullscreen-button').click()
      await expect.poll(() => player.evaluate(element => document.fullscreenElement === element)).toBe(true)
    }
    const bounds = await player.boundingBox()
    const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    const cursorAtPointer = () => page.evaluate(({ x, y }) => {
      return getComputedStyle(document.elementFromPoint(x, y)).cursor
    }, point)

    // Check two idle cycles so restoring the cursor cannot disable auto-hide.
    for (let cycle = 0; cycle < 2; cycle++) {
      point.x += 10
      await page.mouse.move(point.x, point.y)
      await expect.poll(cursorAtPointer).not.toBe('none')
      await expect(controls).toHaveAttribute('shown', 'true')
      await expect(controls).not.toHaveAttribute('shown')
      await expect.poll(cursorAtPointer).toBe('none')
    }

    if (fullscreen) {
      await page.keyboard.press('Tab')
      const fullscreenButton = player.locator('.shaka-fullscreen-button')
      await fullscreenButton.focus()
      // Keyboard navigation must keep the focused controls visible past the idle timeout.
      await page.waitForTimeout(3500)
      await expect(fullscreenButton).toBeFocused()
      await expect(controls).toHaveAttribute('shown', 'true')
      await expect(controls).toHaveCSS('opacity', '1')
      await fullscreenButton.press('Enter')
      await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true)
    }
  })
}
