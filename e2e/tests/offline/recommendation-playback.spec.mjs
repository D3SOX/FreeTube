import { test, expect } from '../../helpers/app.mjs'
import { openMockedVideo, findWatchComponent } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({
  seed: {
    settings: {
      enableHomeRecommendations: true,
      rememberHistory: true,
      enableWatchStats: false,
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
    }
  }
})

test('learns actual playback on pause without watch statistics and stops when disabled', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  const watch = await page.evaluateHandle(findWatchComponent)
  await expect.poll(() => watch.evaluate(component => component.proxy.recommendationWatchSession?.seconds ?? 0)).toBeGreaterThan(2)
  await video.evaluate(element => element.pause())
  const learned = () => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store
    .getters.getRecommendationRecords.find(record => record.videoId === 'jNQXAC9IVRw'))
  await expect.poll(async () => (await learned())?.watchSeconds ?? 0).toBeGreaterThan(2)
  const before = await learned()
  expect(before.lengthSeconds).toBeGreaterThan(0)
  expect(before.authorId).toBeTruthy()
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateEnableHomeRecommendations', false))
  const start = await video.evaluate(element => { element.play(); return element.currentTime })
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(start + 2)
  await video.evaluate(element => element.pause())
  expect((await learned()).watchSeconds).toBe(before.watchSeconds)
})
