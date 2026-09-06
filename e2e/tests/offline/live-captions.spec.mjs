import { test, expect, sel } from '../../helpers/app.mjs'
import { activeTab } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'
import { POST_LIVE_VIDEO_URL, routePostLiveMedia } from '../../helpers/media.mjs'

test.use({ seed: { settings: { videoPlaybackEngine: 'yt-dlp' } } })

test('keeps live HLS playback when external captions are advertised', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page, { captionTranslations: true })
  await routePostLiveMedia(page)
  const manifest = 'https://example.invalid/live-captions.m3u8'
  await page.route(manifest, route => route.fulfill({
    contentType: 'application/x-mpegURL',
    body: '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n' +
      Array.from({ length: 20 }, (_, index) =>
        `${index ? '#EXT-X-DISCONTINUITY\n' : ''}#EXTINF:2,\n${POST_LIVE_VIDEO_URL}&segment=${index}\n`
      ).join('')
  }))
  await app.electronApp.evaluate(({ ipcMain }, manifestUrl) => {
    globalThis.__liveCaptionExtractions = 0
    ipcMain.removeHandler('yt-dlp-get-playback-info')
    ipcMain.handle('yt-dlp-get-playback-info', () => {
      globalThis.__liveCaptionExtractions++
      return {
        isLive: true,
        liveStatus: 'is_live',
        hlsManifestUrl: manifestUrl,
        formats: [],
        duration: null,
        storyboardVtt: null,
        captions: [],
        captionTranslations: [],
        version: 'test'
      }
    })
  }, manifest)
  const errors = []
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.locator(sel.searchInput).fill('https://youtu.be/jNQXAC9IVRw')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator(`${activeTab} .videoTitle`)).toBeVisible()
  const watch = await watchViewHandle(page)
  await expect.poll(() => watch.evaluate(view => view.captions.length)).toBeGreaterThan(0)
  const video = page.locator(`${activeTab} video`)
  await expect(video).toBeVisible()
  await video.evaluate(element => element.play())
  await expect.poll(() => video.evaluate(element => element.currentTime).catch(() => 0)).toBeGreaterThan(0)
  // Allow playback to advance through a segment boundary, catching reloads as
  // well as the caption error itself.
  const start = await video.evaluate(element => element.currentTime)
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(start + 2)
  expect(errors.filter(message => /4033|addTextTrackAsync/.test(message))).toEqual([])
  expect(await page.locator(`${activeTab} .ftVideoPlayer`).evaluate(element =>
    element.ui.getControls().getPlayer().isLive()
  )).toBe(true)
  expect(await app.electronApp.evaluate(() => globalThis.__liveCaptionExtractions)).toBe(1)
  expect(await watch.evaluate(view => view.activePlaybackEngine)).toBe('yt-dlp')
})
