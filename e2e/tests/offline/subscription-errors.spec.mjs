import { test, expect, goTo } from '../../helpers/app.mjs'

for (const count of [2, 20]) {
  test.describe(`${count} unavailable channels`, () => {
    const channels = Array.from({ length: count }, (_, index) => ({
      id: `UC${String(index).padStart(22, '0')}`,
      name: `Unavailable channel ${index + 1}`,
      thumbnail: ''
    }))
    test.use({
      seed: {
        settings: {
          backendPreference: 'invidious',
          backendFallback: false,
          defaultInvidiousInstance: 'https://feeds.example',
          fetchSubscriptionsAutomatically: false,
          useRssFeeds: true,
          hideSubscriptionsVideos: true,
          hideSubscriptionsLive: true,
          hideSubscriptionsCommunity: true
        },
        profiles: [{
          _id: 'allChannels',
          name: 'All Channels',
          bgColor: '#000000',
          textColor: '#FFFFFF',
          subscriptions: channels
        }]
      }
    })

    test('shows a compact summary and copies details for every channel', async ({ page, app }) => {
      await page.setViewportSize({ width: 480, height: 800 })
      await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))
      await page.route('https://feeds.example/**', route => route.fulfill({ status: 404, body: 'Not found' }))
      await goTo(page, 'subscriptions')
      await page.locator('[data-subscription-feed-tab="shorts"]').click()
      await page.getByRole('button', { name: /Refresh Shorts/ }).click()
      const toast = page.locator('.toast', { hasText: 'Channels that could not be refreshed:' })
      await expect(toast).toHaveText(`Channels that could not be refreshed: ${count}. Click to copy details.`)
      await expect(page.locator('.toast')).toHaveCount(1)
      await expect(page.locator('.connectionStatus')).toBeHidden()
      const bounds = await toast.boundingBox()
      expect(bounds.height).toBeLessThan(160)
      expect(bounds.width).toBeLessThanOrEqual(480)
      await toast.click()
      await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText())).toContain(channels.at(-1).id)
      const details = await app.electronApp.evaluate(({ clipboard }) => clipboard.readText())
      for (const channel of channels) expect(details).toContain(`${channel.name} (${channel.id})`)
      expect(details).toContain('HTTP 404')
    })

    if (count === 2) {
      test('copying an ongoing summary keeps later failures accessible', async ({ page, app }) => {
        let releaseSecond
        const secondReady = new Promise(resolve => { releaseSecond = resolve })
        await page.route('https://feeds.example/**', async route => {
          if (route.request().url().includes(channels[1].id.slice(2))) await secondReady
          return route.fulfill({ status: 404, body: 'Not found' })
        })
        try {
          await goTo(page, 'subscriptions')
          await page.locator('[data-subscription-feed-tab="shorts"]').click()
          await page.getByRole('button', { name: /Refresh Shorts/ }).click()
          const toast = page.locator('.toast', { hasText: 'Channels that could not be refreshed:' })
          await expect(toast).toContainText('refreshed: 1.')
          await toast.click()
          await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText())).toContain(channels[0].id)
          releaseSecond()
          await expect(toast).toContainText('refreshed: 2.')
          await expect(toast).toHaveCount(1)
          await toast.click()
          await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText())).toContain(channels[1].id)
        } finally {
          releaseSecond()
        }
      })
    }
  })
}
