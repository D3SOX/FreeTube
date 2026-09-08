import { goTo, test, expect } from '../../helpers/app.mjs'
import { activeTab, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

const VIDEO_TITLES = ['Skip test video one', 'Skip test video two', 'Skip test video three']
const SHORT_PLAYLIST_ID = 'e2eshortplaylist'
const SHORT_PLAYLIST_NAME = 'Short autoplay playlist'

function playlistVideo(title, index, isShort = false) {
  return {
    videoId: `skipvideo${index}`,
    title,
    author: 'Test Channel',
    authorId: 'UC-test-channel-id',
    lengthSeconds: 120,
    published: Date.now() - 86_400_000,
    timeAdded: Date.now() + index,
    playlistItemId: `e2e-skip-item-${index}`,
    type: 'video',
    isShort
  }
}

test.use({
  seed: {
    settings: {
      // Keep the seeded order, the default sorts the newest addition to the top
      userPlaylistSortOrder: 'custom',
      useCustomShortsPlayer: true,
      loopShorts: true,
      autoplayPlaylists: true,
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true
    },
    playlists: [{
      _id: 'e2eskipplaylist',
      playlistName: 'Skip button playlist',
      protected: false,
      description: 'Playlist for the player skip buttons',
      videos: VIDEO_TITLES.map((title, index) => playlistVideo(title, index)),
      createdAt: Date.now() - 86_400_000,
      lastUpdatedAt: Date.now()
    }, {
      _id: SHORT_PLAYLIST_ID,
      playlistName: SHORT_PLAYLIST_NAME,
      protected: false,
      description: 'Playlist with a Short followed by a normal video',
      videos: VIDEO_TITLES.slice(0, 2).map((title, index) => playlistVideo(
        title,
        index,
        index === 0
      )),
      createdAt: Date.now() - 86_400_000,
      lastUpdatedAt: Date.now()
    }],
    history: ['Queued video', 'Standalone video'].map((title, index) => ({
      _id: `queuevideo${index}`,
      videoId: `queuevideo${index}`,
      title,
      author: 'Test Channel',
      authorId: 'UC-test-channel-id',
      published: Date.now() - 86_400_000,
      description: '',
      viewCount: 100,
      lengthSeconds: 60,
      watchProgress: 0,
      isWatched: false,
      timeWatched: Date.now() - index,
      isLive: false,
      type: 'video'
    }))
  }
})

/**
 * The videos themselves cannot be loaded offline, but the playlist is local, so the
 * watch view still decides which skip buttons the player is allowed to show.
 */
function readSkipAvailability(page) {
  return page.evaluate(() => {
    const app = document.querySelector('#app')?.__vue_app__

    const findWatchView = (vnode) => {
      if (vnode?.component?.type?.name === 'Watch') {
        return vnode.component.proxy
      }
      if (vnode?.component?.subTree) {
        const match = findWatchView(vnode.component.subTree)
        if (match) return match
      }
      if (Array.isArray(vnode?.children)) {
        for (const child of vnode.children) {
          const match = findWatchView(child)
          if (match) return match
        }
      }
      return null
    }

    const watchView = findWatchView(app?._container?._vnode)
    if (!watchView) {
      throw new Error('Unable to access the watch view')
    }

    return {
      canPlayNext: watchView.canSkipToNextVideo,
      canPlayPrevious: watchView.canSkipToPreviousVideo
    }
  })
}

test('playlist counter stays below the title when expanded and collapsed', async ({ page, attachScreenshot }) => {
  await page.route(/^https?:\/\//, (route) => route.abort())
  await goTo(page, 'userplaylists')
  await page.getByText('Skip button playlist').click()
  await page.getByText(VIDEO_TITLES[1]).first().click()

  const playlist = page.locator('.watchVideoPlaylist')
  const counter = playlist.locator('.playlistIndex label')
  await expect(counter).toHaveText('2 / 3')

  const expectCounterBelowTitle = async () => {
    await expect.poll(() => playlist.evaluate((element) => {
      const title = element.querySelector('.playlistTitle').getBoundingClientRect()
      const counter = element.querySelector('.playlistIndex label').getBoundingClientRect()
      return counter.top - title.bottom
    })).toBeGreaterThanOrEqual(0)
  }

  for (const scale of [1, 0.95, 1.25]) {
    await page.evaluate(value => window.ftElectron.setZoomFactor(value), scale)
    for (const width of ['240px', '']) {
      await playlist.evaluate((element, value) => {
        element.style.inlineSize = value
      }, width)
      await expectCounterBelowTitle()
      await playlist.getByRole('button', { name: 'Collapse Playlist', exact: true }).click()
      await expect(playlist.locator('.playlistItemsWrapper')).toBeHidden()
      await expectCounterBelowTitle()
      await playlist.getByRole('button', { name: 'Expand Playlist', exact: true }).click()
      await expect(playlist.locator('.playlistItemsWrapper')).toBeVisible()
      await expectCounterBelowTitle()
    }
  }
  await playlist.scrollIntoViewIfNeeded()
  await attachScreenshot('playlist counter below title at 125% UI scale')
})

test('only offers skipping to playlist videos that exist', async ({ page, attachScreenshot }) => {
  await page.route(/^https?:\/\//, (route) => route.abort())

  await goTo(page, 'userplaylists')
  await page.getByText('Skip button playlist').click()
  await expect(page).toHaveURL(/#\/playlist\/e2eskipplaylist/)

  await page.getByText(VIDEO_TITLES[0]).first().click()
  await expect(page).toHaveURL(/#\/watch\/skipvideo0\?.*playlistId=e2eskipplaylist/)

  const playlistItems = page.locator('.watchVideoPlaylist .playlistItem')
  await expect(playlistItems).toHaveCount(VIDEO_TITLES.length)

  // First video: nothing before it
  await expect.poll(() => readSkipAvailability(page)).toEqual({
    canPlayNext: true,
    canPlayPrevious: false
  })
  await attachScreenshot('first playlist video')

  // Loop wraps the playlist around in both directions
  const loopButton = page.locator('.watchVideoPlaylist').getByRole('button', { name: 'Loop Playlist' })
  await loopButton.click()
  await expect.poll(() => readSkipAvailability(page)).toEqual({
    canPlayNext: true,
    canPlayPrevious: true
  })
  await loopButton.click()

  // Last video: nothing after it
  await playlistItems.last().getByText(VIDEO_TITLES[2]).click()
  await expect(page).toHaveURL(/#\/watch\/skipvideo2\?.*playlistId=e2eskipplaylist/)
  await expect.poll(() => readSkipAvailability(page)).toEqual({
    canPlayNext: false,
    canPlayPrevious: true
  })

  // Middle video: both directions available
  await playlistItems.nth(1).getByText(VIDEO_TITLES[1]).click()
  await expect(page).toHaveURL(/#\/watch\/skipvideo1\?.*playlistId=e2eskipplaylist/)
  await expect.poll(() => readSkipAvailability(page)).toEqual({
    canPlayNext: true,
    canPlayPrevious: true
  })
})

test('continues a playlist after a Short ends', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)

  await goTo(page, 'userplaylists')
  await page.getByText(SHORT_PLAYLIST_NAME).click()
  await page.getByText(VIDEO_TITLES[0]).first().click()
  await expect(page).toHaveURL(new RegExp(`#\\/watch\\/skipvideo0\\?.*playlistId=${SHORT_PLAYLIST_ID}`))

  const video = await waitForPlayback(page)
  await expect(page.locator(`${activeTab} .ftVideoPlayer`)).toHaveClass(/shortsPlayer/)
  await expect.poll(() => readSkipAvailability(page)).toEqual({
    canPlayNext: true,
    canPlayPrevious: false
  })
  expect(await video.evaluate(element => element.loop)).toBe(false)

  await video.evaluate(element => {
    element.currentTime = Math.max(0, element.duration - 0.25)
  })

  await expect(page).toHaveURL(new RegExp(`#\\/watch\\/skipvideo1\\?.*playlistId=${SHORT_PLAYLIST_ID}`))
  await waitForPlayback(page)
})

test('offers skipping to a queued video without a playlist', async ({ page }) => {
  await page.route(/^https?:\/\//, (route) => route.abort())

  await goTo(page, 'history')

  const queuedVideo = page.locator('.ft-list-video').filter({ hasText: 'Queued video' })
  await queuedVideo.hover()
  await queuedVideo.locator('.optionsButton').click()
  await page.getByRole('option', { name: 'Add to Queue' }).click()

  await page.getByRole('link', { name: /Standalone video/ }).click()
  await expect(page).toHaveURL(/#\/watch\/queuevideo1/)
  await expect(page.locator('.watchQueue')).toBeVisible()

  // The queue supplies a next video, nothing supplies a previous one
  await expect.poll(() => readSkipAvailability(page)).toEqual({
    canPlayNext: true,
    canPlayPrevious: false
  })
})
