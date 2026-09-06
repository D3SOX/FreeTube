import { test, expect, sel } from '../../helpers/app.mjs'
import { activeTab } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { POST_LIVE_AUDIO_URL, POST_LIVE_VIDEO_URL, routePostLiveMedia } from '../../helpers/media.mjs'

for (const [format, quality] of [['dash', '180'], ['dash', 'auto'], ['audio', 'auto']]) {
  test.describe(`${format} with ${quality} quality`, () => {
    test.use({
      seed: {
        settings: {
          videoPlaybackEngine: 'yt-dlp',
          ytDlpPlaybackEngineDefaultMigration: true,
          defaultQuality: quality,
          defaultVideoFormat: format,
        }
      }
    })

    test('yt-dlp HLS starts with the original audio when YouTube marks every track non-default', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await routePostLiveMedia(page)

      // Arabic comes first, and even the original has DEFAULT=NO.
      const master = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="ar",NAME="العربية - dubbed-auto",YT-EXT-AUDIO-CONTENT-ID="ar.10",DEFAULT=NO,AUTOSELECT=YES,URI="ar.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="en-US",NAME="American English - original",YT-EXT-AUDIO-CONTENT-ID="en-US.4",DEFAULT=NO,AUTOSELECT=YES,URI="en.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=84000,CODECS="avc1.42c00d,mp4a.40.2",RESOLUTION=320x180,AUDIO="audio"
video.m3u8
`
      await page.route('https://audio-default.test/*.m3u8', route => {
        const filename = new URL(route.request().url()).pathname
        const media = filename === '/video.m3u8' ? POST_LIVE_VIDEO_URL : POST_LIVE_AUDIO_URL
        return route.fulfill({
          contentType: 'application/x-mpegurl',
          body: filename === '/master.m3u8'
            ? master
            : `#EXTM3U
#EXT-X-TARGETDURATION:2
#EXT-X-VERSION:7
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-MAP:URI="${media}"
#EXTINF:2,
${media}
#EXT-X-ENDLIST
`
        })
      })
      await app.electronApp.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('yt-dlp-get-playback-info')
        ipcMain.handle('yt-dlp-get-playback-info', () => ({
          isLive: false,
          liveStatus: 'not_live',
          hlsManifestUrl: 'https://audio-default.test/master.m3u8',
          formats: [],
          duration: 2,
          storyboardVtt: null,
          title: 'Original audio test',
          captions: [],
          captionTranslations: [],
          version: 'test'
        }))
      })

      await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
      await page.locator(sel.searchInput).press('Enter')
      const player = page.locator(`${activeTab} .ftVideoPlayer`)
      await expect.poll(() => player.locator('video').evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2)
      await expect.poll(() => player.evaluate(element => {
        const shakaPlayer = element.ui?.getControls().getPlayer()
        return shakaPlayer?.getVariantTracks().find(track => track.active)?.language
      })).toBe('en-US')

      await player.locator('.shaka-overflow-menu-button').click()
      await player.locator('.shaka-overflow-menu').getByRole('button', { name: 'Audio Tracks' }).click()
      await player.locator('.audio-tracks').getByRole('button', { name: 'العربية - dubbed-auto' }).click()
      await expect.poll(() => player.evaluate(element => (
        element.ui.getControls().getPlayer().getVariantTracks().find(track => track.active)?.language
      ))).toBe('ar')
    })
  })
}
