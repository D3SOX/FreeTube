import { test, expect, goTo } from '../../helpers/app.mjs'

test.use({
  seed: {
    settings: {
      currentLocale: 'en-US',
      backendPreference: 'invidious',
      backendFallback: false,
      defaultInvidiousInstance: 'https://invidious.test',
      generalAutoLoadMorePaginatedItemsEnabled: false,
    },
  },
})

function video(index, videoId = `fork-${String(index).padStart(6, '0')}`) {
  return { type: 'video', title: `Fork video ${index}`, videoId, author: 'Source channel', authorId: 'UCsource', authorUrl: '/channel/UCsource', videoThumbnails: [], index, lengthSeconds: 60 }
}

function response(videos, videoCount = 102) {
  return {
    title: 'Source playlist',
    description: 'Source description',
    playlistId: 'fork-source',
    author: 'Source channel',
    authorId: 'UCsource',
    authorThumbnails: [],
    videoCount,
    viewCount: 1,
    updated: 1_700_000_000,
    videos,
  }
}

async function openPlaylist(page, route = '/playlist/fork-source') {
  const tab = await page.evaluate(route => window.ftElectron.tabs.create({ route, makeActive: false }), route)
  await page.locator(`.tab[data-tab-id="${tab.id}"]`).click()
  await expect(page.locator('.playlistTitle:visible')).toBeVisible()
}

async function getCopy(page) {
  return page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return store.getters.getAllPlaylists.find(playlist => playlist.playlistName === 'My copy')
  })
}

test('forks a complete saved playlist and refreshes its editable local snapshot after restart', async ({ app, page }) => {
  let upstream = Array.from({ length: 102 }, (_, index) => video(index))
  // The source intentionally repeats a video at a different playlist position.
  upstream[101] = video(101, upstream[0].videoId)
  let failRefresh = false
  const requestedPages = []
  const mock = page => page.route(/\/api\/v1\/playlists\/fork-source\?/, route => {
    const pageNumber = Number(new URL(route.request().url()).searchParams.get('page') || 1)
    requestedPages.push(pageNumber)
    if (failRefresh && pageNumber === 2) return route.fulfill({ status: 500, json: { error: 'Refresh failed' } })
    return route.fulfill({ json: response(upstream.slice((pageNumber - 1) * 100, pageNumber * 100), upstream.length) })
  })
  await mock(page)
  await openPlaylist(page)
  await page.getByTitle('Save Playlist', { exact: true }).click()
  await goTo(page, 'userplaylists')
  await page.getByRole('link', { name: 'Source playlist', exact: true }).click()
  await expect(page.getByText('Fork video 101', { exact: true })).toHaveCount(0)

  await page.getByTitle('Copy Playlist', { exact: true }).click()
  const addDialog = page.getByRole('dialog').filter({ hasText: 'Select a playlist to add your 102 videos to' })
  await expect(addDialog).toBeVisible()
  await addDialog.getByRole('button', { name: 'Create New Playlist', exact: true }).click()
  const createDialog = page.getByRole('dialog').filter({ has: page.locator('.playlistNameInput') })
  await createDialog.locator('input').fill('My copy')
  await createDialog.getByRole('button', { name: 'Create', exact: true }).click()
  await addDialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(async () => (await getCopy(page))?.videos.length).toBe(102)
  let copy = await getCopy(page)
  expect(copy.sourcePlaylistId).toBe('fork-source')
  expect(copy.description).toBe('Source description')
  expect(copy.videos.map(video => video.videoId)).toEqual(upstream.map(video => video.videoId))
  expect(new Set(copy.videos.map(video => video.playlistItemId)).size).toBe(102)
  expect(requestedPages).toContain(2)

  await openPlaylist(page, `/playlist/${copy._id}?playlistType=user`)
  await page.getByTitle('Edit Playlist Info', { exact: true }).click()
  await page.getByTitle('Save Changes', { exact: true }).click()
  await expect(page.getByRole('link', { name: 'Source playlist', exact: true })).toBeVisible()
  // Exercise the normal local editing actions, preserving a custom order and an added video.
  await page.evaluate(async id => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const playlist = store.getters.getPlaylist(id)
    await store.dispatch('removeVideo', { _id: id, playlistItemId: playlist.videos[101].playlistItemId })
    await store.dispatch('updatePlaylist', { _id: id, videos: [...store.getters.getPlaylist(id).videos].reverse() })
    await store.dispatch('addVideo', { _id: id, videoData: { videoId: 'local-added', title: 'Local addition', lengthSeconds: 60 } })
  }, copy._id)
  copy = await getCopy(page)
  const editedIds = copy.videos.map(video => video.videoId)
  upstream = [video(102), ...upstream.slice(2), video(103, video(102).videoId)]
    .map((entry, index) => ({ ...entry, index }))

  ;({ page } = await app.relaunch())
  await mock(page)
  await openPlaylist(page, `/playlist/${copy._id}?playlistType=user`)
  failRefresh = true
  await page.getByTitle('Add missing videos from source', { exact: true }).filter({ visible: true }).click()
  await expect(page.getByText('This playlist could not be loaded.', { exact: true })).toBeVisible()
  expect((await getCopy(page)).videos.map(video => video.videoId)).toEqual(editedIds)
  failRefresh = false
  await page.getByTitle('Add missing videos from source', { exact: true }).filter({ visible: true }).click()
  await expect.poll(async () => (await getCopy(page)).videos.map(video => video.videoId))
    .toEqual([...editedIds, video(102).videoId])
  await page.getByTitle('Add missing videos from source', { exact: true }).filter({ visible: true }).click()
  await expect(page.getByTitle('Add missing videos from source', { exact: true }).filter({ visible: true })).toBeEnabled()
  expect((await getCopy(page)).videos.map(video => video.videoId)).toEqual([...editedIds, video(102).videoId])
  await page.screenshot({ path: test.info().outputPath('playlist-copy-desktop.png') })
  await page.setViewportSize({ width: 375, height: 812 })
  await expect(page.getByRole('link', { name: 'Source playlist', exact: true })).toBeVisible()
  await expect(page.getByTitle('Add missing videos from source', { exact: true }).filter({ visible: true })).toBeInViewport()
  await page.screenshot({ path: test.info().outputPath('playlist-copy-mobile.png') })
})

test('a failed copy leaves no partial prompt and can be retried', async ({ page }) => {
  let fail = true
  await page.route(/\/api\/v1\/playlists\/fork-source\?/, route => {
    const pageNumber = new URL(route.request().url()).searchParams.get('page')
    if (pageNumber && fail) return route.fulfill({ status: 500, json: { error: 'Continuation failed' } })
    return route.fulfill({ json: response(pageNumber ? [video(100), video(101)] : Array.from({ length: 100 }, (_, index) => video(index))) })
  })
  await openPlaylist(page)
  await page.getByTitle('Copy Playlist', { exact: true }).click()
  await expect(page.getByText('This playlist could not be loaded.', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await getCopy(page)).toBeUndefined()

  fail = false
  await page.getByTitle('Copy Playlist', { exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Select a playlist to add your 102 videos to')
})

test('copying stays busy during pagination and navigation cancels the pending dialog', async ({ page }) => {
  let release
  const continuation = new Promise(resolve => { release = resolve })
  let started
  const continuationStarted = new Promise(resolve => { started = resolve })
  await page.route(/\/api\/v1\/playlists\/fork-source\?/, async route => {
    if (new URL(route.request().url()).searchParams.has('page')) {
      started()
      await continuation
      await route.fulfill({ json: response([video(100), video(101)]) })
    } else {
      await route.fulfill({ json: response(Array.from({ length: 100 }, (_, index) => video(index))) })
    }
  })
  await openPlaylist(page)
  const copyButton = page.getByTitle('Copy Playlist', { exact: true })
  await copyButton.click()
  await continuationStarted
  await expect(copyButton).toBeDisabled()
  await expect(copyButton.locator('..')).toHaveAttribute('aria-busy', 'true')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await goTo(page, 'userplaylists')
  const finished = page.waitForResponse(response => response.url().includes('/playlists/fork-source?') && response.url().includes('page=2'))
  release()
  await finished
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
