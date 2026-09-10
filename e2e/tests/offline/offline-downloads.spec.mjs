import path from 'node:path'

import { test, expect, goTo, repoRoot, waitForAppReady } from '../../helpers/app.mjs'

const mediaPath = path.join(repoRoot, 'e2e/fixtures/media/demo.webm')
test.use({
  seed: {
    settings: { landingPage: 'history', enableDownloads: true },
    downloads: [{
      id: 1,
      videoId: 'offline0001',
      title: 'Offline download',
      status: 'completed',
      mode: 'video',
      percent: 100,
      destination: mediaPath,
      destinations: [mediaPath],
      files: [{ videoId: 'offline0001', path: mediaPath, extension: 'webm' }],
    }],
  },
})

for (const restart of [false, true]) {
  test(`plays downloads offline ${restart ? 'after restarting the renderer' : 'after losing connectivity'}`, async ({ page }) => {
    await page.context().route(/^https?:/, route => route.abort('internetdisconnected'))
    const disconnect = () => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
      window.dispatchEvent(new Event('offline'))
    }
    await page.context().addInitScript(disconnect)
    await page.evaluate(disconnect)
    if (restart) {
      await page.reload()
      await waitForAppReady(page)
    }
    await expect(page.locator('.connectionStatus')).toHaveText('Offline')
    await goTo(page, 'downloads')
    await expect(page.locator('.downloadRow')).toContainText('Offline download')
    await page.getByRole('button', { name: 'Play download', exact: true }).click()
    const video = page.locator('video').first()
    await expect(video).toBeVisible()
    await expect.poll(() => video.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2)
    await video.evaluate(element => element.play())
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(0)
    await expect(page.locator('.videoPlayerPlaceholder.ft-shimmer')).toHaveCount(0)
  })
}
