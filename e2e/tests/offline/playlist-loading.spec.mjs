import { test, expect, goTo, sel } from '../../helpers/app.mjs'
import { fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

test.use({
  seed: {
    settings: {
      backendPreference: 'invidious',
      backendFallback: false,
      // Suggestions would contact the fake instance and block playlist requests
      // while network recovery waits for that unrelated request to succeed.
      enableSearchSuggestions: false,
      defaultInvidiousInstance: 'https://invidious.test',
      generalAutoLoadMorePaginatedItemsEnabled: true
    }
  }
})

function playlistVideo(index, videoId = `video-${String(index).padStart(5, '0')}`) {
  return {
    type: 'video',
    title: `Playlist video ${index + 1}`,
    videoId,
    author: 'Playlist channel',
    authorId: 'UCplaylistchannel',
    authorUrl: '/channel/UCplaylistchannel',
    videoThumbnails: [],
    index,
    lengthSeconds: 60,
    liveNow: false
  }
}

function playlistResponse(videos, videoCount = videos.length) {
  return {
    type: 'playlist',
    title: 'Pagination test playlist',
    playlistId: 'pagination-test',
    author: 'Playlist channel',
    authorId: 'UCplaylistchannel',
    authorThumbnails: [
      { url: 'https://yt3.ggpht.com/test=s32' },
      { url: 'https://yt3.ggpht.com/test=s48' },
      { url: 'https://yt3.ggpht.com/test=s76' }
    ],
    description: '',
    descriptionHtml: '',
    videoCount,
    viewCount: 1,
    updated: 1_700_000_000,
    videos
  }
}

async function openPlaylistTab(page, route) {
  const tab = await page.evaluate((playlistRoute) => window.ftElectron.tabs.create({
    route: playlistRoute,
    makeActive: false
  }), route)
  await page.locator(`.tab[data-tab-id="${tab.id}"]`).click()
  await expect(page).toHaveURL(/#\/playlist\//)
}

test('loads an Invidious Mix response from the playlist endpoint', async ({ page, attachScreenshot }) => {
  await page.route('https://invidious.test/vi/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
  const playlistId = 'RDnGusAJYHcjo'
  const errors = []
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text())
  })
  // Invidious redirects RD playlists to /mixes, whose JSON only has these fields.
  await page.route(new RegExp(`/api/v1/playlists/${playlistId}\\?`), route => route.fulfill({
    json: {
      title: 'Mix - Playlist video 1',
      mixId: playlistId,
      videos: [playlistVideo(0, 'nGusAJYHcjo'), playlistVideo(1)],
    },
  }))

  await openPlaylistTab(page, `/playlist/${playlistId}`)

  const playlistPage = page.locator('.playlistPage')
  await expect(playlistPage.getByText('Playlist video 1', { exact: true })).toBeVisible()
  await expect(playlistPage.getByText('Playlist video 2', { exact: true })).toBeVisible()
  await expect(playlistPage.locator('.playlistInfo')).toContainText('2 videos')
  await expect(playlistPage.locator('.playlistInfo')).not.toContainText('Invalid Date')
  await expect(playlistPage.locator('.playlistInfo')).not.toContainText('Last Updated')
  await expect(playlistPage.locator('.playlistInfo')).not.toContainText('views')
  await expect(playlistPage.locator('.playlistChannel')).toHaveCount(0)
  await expect(playlistPage.locator('.ft-auto-load-next-page-wrapper')).toHaveCount(0)
  await expect(playlistPage.locator('.playlistThumbnail a')).toHaveAttribute('href', /\/watch\/nGusAJYHcjo/)
  expect(errors).toEqual([])
  await attachScreenshot('loaded-invidious-mix')

  await playlistPage.getByText('Playlist video 1', { exact: true }).click()
  const watchPlaylist = page.locator('.watchVideoPlaylist')
  await expect(watchPlaylist.locator('.playlistItem')).toHaveCount(2)
  await expect(watchPlaylist.locator('.playlistIndex label')).toHaveText('1 / 2')
})

test('displays an unknown Mix video count without a negative badge', async ({ page, attachScreenshot }) => {
  await page.route('https://invidious.test/api/v1/search/**', route => route.fulfill({
    json: [{
      type: 'playlist',
      title: 'Mix - Playlist video 1',
      playlistId: 'RDnGusAJYHcjo',
      playlistThumbnail: 'https://i.ytimg.com/vi/nGusAJYHcjo/hqdefault.jpg',
      author: 'YouTube',
      authorId: '',
      videoCount: -1,
      videos: [],
    }],
  }))

  await page.locator(sel.searchInput).fill('mix')
  await page.locator(sel.searchInput).press('Enter')

  const mix = page.getByRole('link', { name: 'Mix - Playlist video 1' }).last()
    .locator('xpath=ancestor::div[contains(@class, "ft-list-item")]')
  await expect(mix.locator('.videoCountContainer')).toHaveText('∞')
  await attachScreenshot('mix-search-count')
})

test('settles a missing user playlist into a persistent not-found state', async ({ page }) => {
  await openPlaylistTab(page, '/playlist/missing-playlist?playlistType=user')

  const playlistPage = page.locator('.playlistPage')
  await expect(playlistPage.getByText('This playlist does not exist', { exact: true })).toBeVisible()
  await expect(playlistPage.locator('[data-tab-loading-indicator]')).toHaveCount(0)
})

test('shows a persistent initial error and retries without navigation', async ({ page }) => {
  let requestCount = 0
  await page.route(/\/api\/v1\/playlists\/initial-retry\?/, async (route) => {
    requestCount++
    if (requestCount === 1) {
      await route.fulfill({ status: 500, json: { error: 'Synthetic initial failure' } })
    } else {
      await route.fulfill({ json: playlistResponse([playlistVideo(0)]) })
    }
  })

  await openPlaylistTab(page, '/playlist/initial-retry')

  const playlistPage = page.locator('.playlistPage')
  await expect(playlistPage.getByText('This playlist could not be loaded.', { exact: true })).toBeVisible()
  await playlistPage.getByRole('button', { name: 'Retry', exact: true }).click()

  await expect(playlistPage.getByText('Playlist video 1', { exact: true })).toBeVisible()
  expect(requestCount).toBe(2)
})

test('saves a YouTube playlist as a read-only link and persists it', async ({ app, page }) => {
  const playlistId = 'saved-playlist'
  const response = {
    ...playlistResponse([playlistVideo(0)], 1),
    title: 'Saved YouTube playlist',
    playlistId,
  }
  const mockPlaylist = currentPage => currentPage.route(
    new RegExp(`/api/v1/playlists/${playlistId}\\?`),
    route => route.fulfill({ json: response })
  )

  await mockPlaylist(page)
  await page.route('https://invidious.test/vi/video-00000/mqdefault.jpg', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="9"/>',
  }))
  await openPlaylistTab(page, `/playlist/${playlistId}`)

  const saveButton = page.getByTitle('Save Playlist')
  await expect(saveButton).toHaveAttribute('aria-pressed', 'false')
  await saveButton.click()
  await expect(page.getByTitle('Remove Saved Playlist')).toHaveAttribute('aria-pressed', 'true')

  await goTo(page, 'userplaylists')
  const savedPlaylistLink = page.getByRole('link', { name: 'Saved YouTube playlist' })
  await expect(savedPlaylistLink).toBeVisible()
  const savedPlaylistCard = savedPlaylistLink
    .locator('xpath=ancestor::div[contains(@class, "ft-list-item")]')
  const savedPlaylistThumbnail = savedPlaylistCard.locator('img.thumbnailImage')
  await expect(savedPlaylistThumbnail).toHaveAttribute(
    'src',
    'https://invidious.test/vi/video-00000/mqdefault.jpg'
  )
  await expect.poll(() => savedPlaylistThumbnail.evaluate(image => image.naturalWidth))
    .toBeGreaterThan(0)

  ;({ page } = await app.relaunch())
  await goTo(page, 'userplaylists')
  await expect(page.getByRole('link', { name: 'Saved YouTube playlist' })).toBeVisible()

  await mockPlaylist(page)
  await page.getByRole('link', { name: 'Saved YouTube playlist' }).click()
  await expect(page).toHaveURL(new RegExp(`#/playlist/${playlistId}(?:\\?|$)`))
  await expect(page.getByTitle('Edit Playlist Info')).toHaveCount(0)

  await page.getByTitle('Remove Saved Playlist').click()
  await goTo(page, 'userplaylists')
  await expect(page.getByRole('link', { name: 'Saved YouTube playlist' })).toHaveCount(0)
})

test('keeps the search result thumbnail when saving a playlist', async ({ page }) => {
  const playlistId = 'search-thumbnail-playlist'
  const searchThumbnailVideoId = 'search-thumbnail-video'
  const firstPlaylistVideoId = 'first-playlist-video'

  await page.route('https://invidious.test/api/v1/search/**', route => route.fulfill({
    json: [{
      type: 'playlist',
      title: 'Playlist with search thumbnail',
      playlistId,
      playlistThumbnail: `https://i.ytimg.com/vi/${searchThumbnailVideoId}/hqdefault.jpg`,
      author: 'Playlist channel',
      authorId: 'UCplaylistchannel',
      authorUrl: '/channel/UCplaylistchannel',
      authorVerified: false,
      videoCount: 1,
      videos: [],
    }],
  }))
  await page.route(new RegExp(`/api/v1/playlists/${playlistId}\\?`), route => route.fulfill({
    json: {
      ...playlistResponse([playlistVideo(0, firstPlaylistVideoId)], 1),
      title: 'Playlist with search thumbnail',
      playlistId,
    },
  }))

  await page.locator(sel.searchInput).fill('playlist thumbnail')
  await page.locator(sel.searchInput).press('Enter')

  const searchResultLink = page.getByRole('link', { name: 'Playlist with search thumbnail' }).last()
  const searchResultCard = searchResultLink
    .locator('xpath=ancestor::div[contains(@class, "ft-list-item")]')
  const searchResultThumbnail = searchResultCard.locator('img.thumbnailImage')
  const expectedThumbnail = `https://invidious.test/vi/${searchThumbnailVideoId}/mqdefault.jpg`
  await expect(searchResultThumbnail).toHaveAttribute('src', expectedThumbnail)

  await searchResultLink.click()
  await page.getByTitle('Save Playlist').click()
  await goTo(page, 'userplaylists')

  const savedPlaylistLink = page.getByRole('link', { name: 'Playlist with search thumbnail' }).last()
  const savedPlaylistCard = savedPlaylistLink
    .locator('xpath=ancestor::div[contains(@class, "ft-list-item")]')
  await expect(savedPlaylistCard.locator('img.thumbnailImage'))
    .toHaveAttribute('src', expectedThumbnail)
})

test('refreshes saved playlist metadata after opening the playlist again', async ({ app, page }) => {
  const playlistId = 'dynamic-saved-playlist'
  let firstVideoId = 'original-first-video'
  let videoCount = 1
  let playlistTitle = 'Dynamic saved playlist'
  let playlistDescription = 'Original playlist description'
  let channelName = 'Playlist channel'
  let channelId = 'UCplaylistchannel'
  let channelAvatar = 'https://yt3.ggpht.com/original-avatar=s76'
  const getSavedPlaylistCard = () => page.locator('.ft-list-video:visible', {
    has: page.locator(`a.title[href*="/playlist/${playlistId}"]`)
  })
  let markStaleRequestStarted
  const staleRequestStarted = new Promise(resolve => { markStaleRequestStarted = resolve })
  let releaseStaleRequest
  const staleRequestRelease = new Promise(resolve => { releaseStaleRequest = resolve })
  let markStaleRequestFinished
  const staleRequestFinished = new Promise(resolve => { markStaleRequestFinished = resolve })

  await page.route(new RegExp(`/api/v1/playlists/${playlistId}\\?`), route => route.fulfill({
    json: {
      ...playlistResponse([playlistVideo(0, firstVideoId)], videoCount),
      title: playlistTitle,
      description: playlistDescription,
      playlistId,
      author: channelName,
      authorId: channelId,
      authorThumbnails: [{ url: channelAvatar }],
    },
  }))
  await page.route(/\/api\/v1\/playlists\/stale-thumbnail-source\?/, async route => {
    markStaleRequestStarted()
    await staleRequestRelease
    await route.fulfill({
      json: {
        ...playlistResponse([playlistVideo(0, 'stale-first-video')], 1),
        title: 'Stale thumbnail source',
        playlistId: 'stale-thumbnail-source',
      },
    })
    markStaleRequestFinished()
  })

  await openPlaylistTab(page, `/playlist/${playlistId}`)
  await page.getByTitle('Save Playlist').click()
  await goTo(page, 'userplaylists')

  let savedPlaylistCard = getSavedPlaylistCard()
  let savedPlaylistThumbnail = savedPlaylistCard.locator('img.thumbnailImage')
  await expect(savedPlaylistThumbnail).toHaveAttribute(
    'src',
    'https://invidious.test/vi/original-first-video/mqdefault.jpg'
  )
  await expect(savedPlaylistCard.locator('.videoCountContainer')).toHaveText('1')

  videoCount = 5
  playlistTitle = 'Updated saved playlist'
  playlistDescription = 'Updated playlist description'
  channelName = 'Updated playlist channel'
  channelId = 'UCupdatedplaylistchannel'
  channelAvatar = 'https://yt3.ggpht.com/updated-avatar=s76'
  await openPlaylistTab(page, '/playlist/stale-thumbnail-source')
  await staleRequestStarted
  await page.locator(sel.searchInput).fill(`https://www.youtube.com/playlist?list=${playlistId}`)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.getByText('Playlist video 1', { exact: true })).toBeVisible()
  await expect(page.locator('.playlistInfo')).toContainText('5 videos')
  releaseStaleRequest()
  await staleRequestFinished
  await goTo(page, 'userplaylists')

  savedPlaylistCard = getSavedPlaylistCard()
  savedPlaylistThumbnail = savedPlaylistCard.locator('img.thumbnailImage')
  await expect(savedPlaylistCard.locator('.h3Title')).toHaveText(playlistTitle)
  await expect(savedPlaylistCard.locator('.channelNameText')).toHaveText(channelName)
  await expect(savedPlaylistCard.locator('.channelName')).toHaveAttribute('href', `#/channel/${channelId}`)
  await expect(savedPlaylistThumbnail).toHaveAttribute(
    'src',
    'https://invidious.test/vi/original-first-video/mqdefault.jpg'
  )
  await expect(savedPlaylistCard.locator('.videoCountContainer')).toHaveText('5')

  firstVideoId = 'updated-first-video'
  await page.getByRole('link', { name: playlistTitle }).click()
  await expect(page.getByText('Playlist video 1', { exact: true })).toBeVisible()
  await goTo(page, 'userplaylists')

  const updatedThumbnailUrl = 'https://invidious.test/vi/updated-first-video/mqdefault.jpg'
  await expect(savedPlaylistThumbnail).toHaveAttribute('src', updatedThumbnailUrl)

  ;({ page } = await app.relaunch())
  await goTo(page, 'userplaylists')
  const persistedPlaylistCard = getSavedPlaylistCard()
  await expect(persistedPlaylistCard.locator('.h3Title')).toHaveText(playlistTitle)
  await expect(persistedPlaylistCard.locator('.channelNameText')).toHaveText(channelName)
  await expect(persistedPlaylistCard.locator('.channelName')).toHaveAttribute('href', `#/channel/${channelId}`)
  await expect(persistedPlaylistCard.locator('img.thumbnailImage'))
    .toHaveAttribute('src', updatedThumbnailUrl)
  await expect(persistedPlaylistCard.locator('.videoCountContainer')).toHaveText('5')
  await expect(page.evaluate(id => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return store.getters.getPlaylistBookmark(id)
  }, playlistId)).resolves.toMatchObject({
    playlist: {
      title: playlistTitle,
      description: playlistDescription,
    },
    uploader: {
      id: channelId,
      name: channelName,
      avatar: 'https://yt3.googleusercontent.com/updated-avatar=s76',
    },
  })
})

test('retries the failed Invidious page and merges its overlapping videos once', async ({ page }) => {
  const requestedPages = []
  await page.route(/\/api\/v1\/playlists\/pagination-test\?/, async (route) => {
    const pageNumber = new URL(route.request().url()).searchParams.get('page')
    if (pageNumber === null) {
      await route.fulfill({ json: playlistResponse([playlistVideo(0), playlistVideo(1)], 150) })
      return
    }

    requestedPages.push(pageNumber)
    if (requestedPages.length === 1) {
      await route.fulfill({ status: 500, json: { error: 'Synthetic continuation failure' } })
      return
    }

    await route.fulfill({
      json: playlistResponse([playlistVideo(1), playlistVideo(2), playlistVideo(3)], 150)
    })
  })

  await openPlaylistTab(page, '/playlist/pagination-test')
  const playlistPage = page.locator('.playlistPage')
  await expect(playlistPage.getByText('Playlist video 1', { exact: true })).toBeVisible()

  await expect(playlistPage.getByText('More videos could not be loaded.', { exact: true })).toBeVisible()
  await playlistPage.getByRole('button', { name: 'Retry', exact: true }).click()

  await expect(playlistPage.getByText('Playlist video 4', { exact: true })).toBeVisible()
  await expect(playlistPage.getByText('Playlist video 2', { exact: true })).toHaveCount(1)
  await expect(playlistPage.locator('.ft-auto-load-next-page-wrapper')).toHaveCount(0)
  expect(requestedPages).toEqual(['2', '2'])
})

test('uses the first playable video found on a later Invidious page', async ({ page }) => {
  await page.route(/\/api\/v1\/playlists\/later-playable\?/, async (route) => {
    const pageNumber = new URL(route.request().url()).searchParams.get('page')
    if (pageNumber === null) {
      await route.fulfill({
        json: playlistResponse([{
          ...playlistVideo(0),
          title: '',
          author: '',
          authorId: null
        }], 150)
      })
      return
    }

    await route.fulfill({ json: playlistResponse([playlistVideo(1)], 150) })
  })

  await openPlaylistTab(page, '/playlist/later-playable')
  const playlistPage = page.locator('.playlistPage')
  await expect(playlistPage.getByText('Playlist video 2', { exact: true })).toBeVisible()
  await expect(playlistPage.locator('.playlistThumbnail a')).toHaveAttribute('href', /\/watch\/video-00001/)
})

test('ignores an Invidious continuation that finishes after playlist navigation', async ({ page }) => {
  let markContinuationStarted
  const continuationStarted = new Promise((resolve) => { markContinuationStarted = resolve })
  let releaseContinuation
  const continuationRelease = new Promise((resolve) => { releaseContinuation = resolve })
  let markContinuationFinished
  const continuationFinished = new Promise((resolve) => { markContinuationFinished = resolve })

  await page.route(/\/api\/v1\/playlists\/(stale-source|fresh-target)\?/, async (route) => {
    const requestUrl = new URL(route.request().url())
    const pageNumber = requestUrl.searchParams.get('page')

    if (requestUrl.pathname.endsWith('/stale-source') && pageNumber !== null) {
      markContinuationStarted()
      await continuationRelease
      await route.fulfill({ json: playlistResponse([playlistVideo(99)], 150) })
      markContinuationFinished()
      return
    }

    const videos = requestUrl.pathname.endsWith('/stale-source')
      ? [playlistVideo(0)]
      : [playlistVideo(49)]
    const count = requestUrl.pathname.endsWith('/stale-source') ? 150 : 1
    await route.fulfill({ json: playlistResponse(videos, count) })
  })

  await openPlaylistTab(page, '/playlist/stale-source')
  await continuationStarted

  await page.locator(sel.searchInput).fill('https://www.youtube.com/playlist?list=fresh-target')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(/#\/playlist\/fresh-target/)
  await expect(page.locator('.playlistPage').getByText('Playlist video 50', { exact: true })).toBeVisible()

  releaseContinuation()
  await continuationFinished
  await page.waitForTimeout(100)
  await expect(page.locator('.playlistPage').getByText('Playlist video 100', { exact: true })).toHaveCount(0)
})

test.describe('saved playlist thumbnails', () => {
  test.use({
    seed: {
      settings: {
        backendPreference: 'local',
        defaultInvidiousInstance: 'https://invidious.test',
        playlistBookmarks: [{
          playlist: {
            id: 'saved-local-playlist',
            title: 'Saved local playlist',
            description: '',
            thumbnail_url: 'https://i.ytimg.com/vi/saved-video/mqdefault.jpg',
            video_count: 1,
          },
          uploader: {
            id: 'saved-channel',
            name: 'Saved channel',
            avatar: null,
            verified: false,
          },
          savedAt: 1_700_000_000_000,
        }],
      },
    },
  })

  test('loads a saved playlist thumbnail through the active local backend', async ({ page }) => {
    await page.route('https://i.ytimg.com/vi/saved-video/mqdefault.jpg', route => route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="9"/>',
    }))
    await page.route('https://invidious.test/vi/saved-video/mqdefault.jpg', route => route.abort())

    await goTo(page, 'userplaylists')

    const playlistCard = page.getByRole('link', { name: 'Saved local playlist' })
      .locator('xpath=ancestor::div[contains(@class, "ft-list-item")]')
    const thumbnail = playlistCard.locator('img.thumbnailImage')
    await expect(thumbnail).toHaveAttribute(
      'src',
      'https://i.ytimg.com/vi/saved-video/mqdefault.jpg'
    )
    await expect.poll(() => thumbnail.evaluate(image => image.naturalWidth)).toBeGreaterThan(0)
  })
})
