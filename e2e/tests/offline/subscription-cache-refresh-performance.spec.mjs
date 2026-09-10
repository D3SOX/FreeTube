import { abortUnmockedRequest, test, expect, goTo } from '../../helpers/app.mjs'
import { largeSubscriptionsSeed } from '../../performance/subscriptions.mjs'

test.use({ seed: largeSubscriptionsSeed })

for (const feed of ['videos', 'new']) {
  test(`refreshes cached channels efficiently with the ${feed} feed visible`, async ({ page }, testInfo) => {
    await page.route(/^https?:\/\//, abortUnmockedRequest)
    await goTo(page, 'subscriptions')
    await page.locator(`[data-subscription-feed-tab="${feed === 'new' ? 'all' : 'videos'}"]`).click()
    if (feed === 'new') await expect(page.locator('#subscriptionsPanel.newFeed')).toBeVisible()
    else await expect(page.locator('#subscriptionsPanel:not(.newFeed)')).toBeVisible()
    await expect(page.getByText('Video 0-0', { exact: true })).toBeVisible()

    const cdp = process.env.OPENTUBEX_REFRESH_CPU_PROFILE
      ? await page.context().newCDPSession(page)
      : null
    if (cdp) {
      await cdp.send('Profiler.enable')
      await cdp.send('Profiler.start')
    }
    const metrics = await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      // Replay fetched channel responses through the real cache IPC, persistence,
      // Vuex mutation and incremental-feed event, without network variability.
      const responses = Object.entries(store.getters.getVideoCache).slice(0, 80)
        .map(([channelId, cache]) => ({
          channelId,
          videos: JSON.parse(JSON.stringify(cache.videos))
        }))
      responses[0].videos[0].title = 'Refreshed video 0-0'
      const durations = []
      let next = 0
      const started = performance.now()
      await Promise.all(Array.from({ length: 8 }, async () => {
        while (next < responses.length) {
          const response = responses[next++]
          const before = performance.now()
          await store.dispatch('updateSubscriptionVideosCacheByChannel', response)
          durations.push(performance.now() - before)
          window.dispatchEvent(new CustomEvent('opentubex-subscription-refresh-channel', {
            detail: { tab: 'videos' }
          }))
          await new Promise(resolve => setTimeout(resolve, 20))
        }
      }))
      return {
        elapsedMs: performance.now() - started,
        updates: durations.length,
        medianUpdateMs: durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)]
      }
    })
    if (cdp) {
      const { profile } = await cdp.send('Profiler.stop')
      await cdp.detach()
      await testInfo.attach('refresh CPU profile', {
        body: JSON.stringify(profile), contentType: 'application/json'
      })
    }
    await testInfo.attach('refresh timings', {
      body: JSON.stringify(metrics), contentType: 'application/json'
    })
    expect(metrics.updates).toBe(80)
    await expect(page.getByText('Refreshed video 0-0', { exact: true })).toBeVisible()
    // The full-feed dependency scan took ~40 seconds for this replay. Leave
    // room for runner jitter while catching that repeated work reliably.
    expect(metrics.elapsedMs, JSON.stringify(metrics)).toBeLessThan(10_000)
    expect(metrics.medianUpdateMs, JSON.stringify(metrics)).toBeLessThan(500)
  })
}

test('rechecks premiere history after the clock advances and the Home feed recomputes', async ({ page }) => {
  const published = largeSubscriptionsSeed.subscriptionCache[0].videos[0].published
  await page.clock.setFixedTime(new Date(published))
  await page.evaluate(async timestamp => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const history = {
      ...store.getters.getHistoryCacheById,
      'video-0-0': {
        videoId: 'video-0-0',
        isUpcoming: true,
        isWatched: true,
        premiereTimestamp: (timestamp + 60_000) / 1000
      }
    }
    store.commit('setHistoryCacheById', history)
  }, published)
  await goTo(page, 'home')
  await expect(page.getByText('Video 0-0', { exact: true })).toBeVisible()
  await page.clock.setFixedTime(new Date(published + 120_000))
  // An unrelated settings change recomputes the selector, but does not mutate
  // this channel's entries or history record.
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateOnlyShowLatestFromChannel', true)
  })
  await expect(page.getByText('Video 0-0', { exact: true })).toHaveCount(0)
})
