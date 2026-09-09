import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { IpcChannels } from '../../../src/constants.js'
import { test, expect, sel, goTo, goToSettingsSection } from '../../helpers/app.mjs'
import { DEMO_MEDIA_URL, routeDemoMedia } from '../../helpers/media.mjs'

const seededPremiereStart = Date.now() + 86_400_000

async function dispatchStoreAction(page, action, payload) {
  await page.evaluate(async ({ action, payload }) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch(action, payload)
  }, { action, payload })
}

async function allThumbnailsInclude(playlistCard, expectedUrlPart) {
  const sources = await playlistCard.locator('.thumbnailImage').evaluateAll(images => images.map(image => image.src))
  return sources.length > 0 && sources.every(source => source.includes(expectedUrlPart))
}

test.describe('playlist creation', () => {
  test('a playlist can be created through the UI', async ({ page }) => {
    await goTo(page, 'userplaylists')

    await page.getByTitle('Create New Playlist').click()
    const createDialog = page.getByRole('dialog')
    await expect(createDialog).toBeVisible()
    await expect(createDialog.getByText('Quick bookmark icon')).toHaveCount(0)
    await createDialog.locator('.playlistNameInput input').fill('Created via UI')
    await createDialog.getByRole('button', { name: 'Create', exact: true }).click()

    await expect(page.getByRole('link', { name: 'Created via UI' })).toBeVisible()
  })
})

test.describe('seeded playlists', () => {
  test.use({
    seed: {
      settings: {
        hideUpcomingPremieres: true,
        quickBookmarkTargetPlaylistId: 'favorites',
        videoPlaybackEngine: 'yt-dlp',
        ytDlpPlaybackEngineDefaultMigration: true
      },
      playlists: [
        {
          _id: 'favorites',
          playlistName: 'Favorites',
          protected: true,
          description: 'Quick bookmark target',
          videos: [],
          createdAt: Date.now() - 86_400_000,
          lastUpdatedAt: Date.now()
        },
        {
          _id: 'e2eseeded',
          playlistName: 'My seeded playlist',
          protected: false,
          description: 'Playlist created by the E2E seed',
          videos: [
            {
              videoId: 'ccccccccccc',
              title: 'Seeded video one',
              author: 'Test Channel',
              authorId: 'UC-test-channel-id',
              lengthSeconds: 120,
              published: Date.now() - 86_400_000,
              timeAdded: Date.now(),
              playlistItemId: 'e2e-item-1',
              type: 'video'
            },
            {
              videoId: 'ddddddddddd',
              title: 'Upcoming seeded premiere',
              author: 'Test Channel',
              authorId: 'UC-test-channel-id',
              lengthSeconds: 120,
              published: seededPremiereStart,
              isUpcoming: true,
              isPremiere: true,
              premiereDate: new Date(seededPremiereStart).toISOString(),
              timeAdded: Date.now(),
              playlistItemId: 'e2e-item-2',
              type: 'video'
            }
          ],
          createdAt: Date.now() - 86_400_000,
          lastUpdatedAt: Date.now()
        },
        {
          _id: 'secondary',
          playlistName: 'Secondary preload playlist',
          protected: false,
          description: 'Playlist used to test switching during preloading',
          videos: [
            {
              videoId: 'eeeeeeeeeee',
              title: 'Secondary seeded video',
              author: 'Test Channel',
              authorId: 'UC-test-channel-id',
              lengthSeconds: 120,
              published: Date.now() - 86_400_000,
              timeAdded: Date.now(),
              playlistItemId: 'e2e-item-3',
              type: 'video'
            }
          ],
          createdAt: Date.now() - 86_400_000,
          lastUpdatedAt: Date.now()
        }
      ]
    }
  })

  test('a seeded playlist with videos renders and opens', async ({ page }) => {
    await goTo(page, 'userplaylists')
    await expect(page.getByText('My seeded playlist')).toBeVisible()

    await page.getByText('My seeded playlist').click()
    await expect(page).toHaveURL(/#\/playlist\//)
    await expect(page.getByText('Seeded video one')).toBeVisible()
    // Local playlists intentionally ignore the global hide-upcoming setting.
    await expect(page.getByText('Upcoming seeded premiere')).toBeVisible()
  })

  test('updates a playlist card video count while the list remains open', async ({ page }) => {
    await goTo(page, 'userplaylists')

    const playlistCard = page.locator('.ft-list-video', {
      has: page.getByRole('link', { name: 'My seeded playlist', exact: true })
    })
    const thumbnail = playlistCard.locator('.thumbnailImage')
    const displayedVideoCounts = async () => {
      const counts = await playlistCard.locator('.videoCountContainer').allTextContents()
      return [...new Set(counts)]
    }
    await expect.poll(displayedVideoCounts).toEqual(['2'])
    await expect(thumbnail).toHaveAttribute('src', /ccccccccccc/)

    await dispatchStoreAction(page, 'removeAllVideos', 'e2eseeded')
    await expect.poll(displayedVideoCounts).toEqual(['0'])
    await expect(thumbnail).toHaveAttribute('src', /thumbnail_placeholder/)

    await dispatchStoreAction(page, 'addVideo', {
      _id: 'e2eseeded',
      videoData: {
        videoId: 'fffffffffff',
        title: 'New playlist video',
        playlistItemId: 'e2e-item-4',
        type: 'video'
      }
    })
    await expect.poll(displayedVideoCounts).toEqual(['1'])
    await expect.poll(() => allThumbnailsInclude(playlistCard, 'fffffffffff')).toBe(true)

    await dispatchStoreAction(page, 'removeVideo', {
      _id: 'e2eseeded',
      videoId: 'fffffffffff',
      playlistItemId: 'e2e-item-4'
    })
    await expect.poll(displayedVideoCounts).toEqual(['0'])
    await expect.poll(() => allThumbnailsInclude(playlistCard, 'thumbnail_placeholder')).toBe(true)
  })

  test('preloads every video in a user playlist with yt-dlp', async ({ app, page }) => {
    await dispatchStoreAction(page, 'updateYtDlpPreloadEnabled', true)
    await dispatchStoreAction(page, 'updateYtDlpPreloadCount', 0)
    await dispatchStoreAction(page, 'updateYtDlpPreloadConcurrency', 1)
    await app.electronApp.evaluate(({ ipcMain }, channel) => {
      globalThis.__ytDlpPreloadVideoIds = []
      globalThis.__ytDlpPreloadResolvers = []
      const requestCounts = new Map()
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, (_event, videoId) => {
        globalThis.__ytDlpPreloadVideoIds.push(videoId)
        const requestCount = (requestCounts.get(videoId) ?? 0) + 1
        requestCounts.set(videoId, requestCount)
        if (requestCount === 1) {
          return new Promise(resolve => globalThis.__ytDlpPreloadResolvers.push(resolve))
        }
        return { error: 'mock failure' }
      })
    }, IpcChannels.YT_DLP_GET_PLAYBACK_INFO)

    await goTo(page, 'userplaylists')
    await page.getByText('My seeded playlist').click()
    await page.getByTitle('Preload all videos').click()

    await expect.poll(() => app.electronApp.evaluate(
      () => [...new Set(globalThis.__ytDlpPreloadVideoIds)]
    )).toEqual(['ccccccccccc'])

    const pendingButton = page.getByTitle('Preloading all videos...')
    await expect(pendingButton).toHaveAttribute('aria-disabled', 'true')
    await expect(pendingButton.locator('.ft-icon--spin')).toBeVisible()

    const progressToast = page.getByTestId('progress-toast')
    await expect(progressToast).toContainText('Preloading videos: 0 of 2')
    await expect(progressToast.locator('.progress-indicator')).toHaveAttribute('data-progress', '0')

    await app.electronApp.evaluate(() => globalThis.__ytDlpPreloadResolvers.shift()({ error: 'mock failure' }))
    await expect.poll(() => app.electronApp.evaluate(
      () => [...new Set(globalThis.__ytDlpPreloadVideoIds)]
    )).toEqual(['ccccccccccc', 'ddddddddddd'])
    await expect(progressToast).toContainText('Preloading videos: 1 of 2')
    await expect(progressToast.locator('.progress-indicator')).toHaveAttribute('data-progress', '50')

    await app.electronApp.evaluate(() => globalThis.__ytDlpPreloadResolvers.shift()({ error: 'mock failure' }))
    await expect(page.getByText(
      'Preloaded 0 of 2 videos. 2 could not be preloaded.'
    )).toBeVisible()
    await expect(progressToast).toHaveCount(0)
    await expect(page.getByTitle('Preload all videos')).toHaveAttribute('aria-disabled', 'false')
  })

  test('keeps a successfully preloaded playlist disabled', async ({ app, page }) => {
    await routeDemoMedia(page)
    await app.electronApp.evaluate(({ ipcMain }, { channel, mediaUrl }) => {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, (_event, videoId) => ({
        isLive: false,
        liveStatus: 'not_live',
        hlsManifestUrl: null,
        formats: [{
          formatId: '43',
          url: `${mediaUrl}&expire=4102444800`,
          manifestUrl: null,
          protocol: 'https',
          ext: 'webm',
          container: 'webm',
          vcodec: 'vp9',
          acodec: 'opus',
          width: 640,
          height: 360,
          fps: 15,
          bitrate: 200_000,
          audioSampleRate: 48_000,
          audioChannels: 2,
          language: null,
          formatNote: '360p',
          dynamicRange: 'SDR',
          availableAt: null,
        }],
        duration: 30,
        storyboardVtt: null,
        captions: [],
        captionTranslations: [],
        title: videoId,
        version: 'test',
      }))
    }, {
      channel: IpcChannels.YT_DLP_GET_PLAYBACK_INFO,
      mediaUrl: DEMO_MEDIA_URL,
    })

    await goTo(page, 'userplaylists')
    await page.getByText('My seeded playlist').click()
    await page.getByTitle('Preload all videos').click()

    await expect(page.getByText('Preloaded videos: 2.')).toBeVisible()
    const completedButton = page.getByTitle('All playlist videos are already preloaded')
    await expect(completedButton).toHaveAttribute('aria-disabled', 'true')
    await expect(completedButton.locator('.ft-icon--spin')).toHaveCount(0)
    await expect(page.getByTestId('progress-toast')).toHaveCount(0)

    await goTo(page, 'userplaylists')
    await page.getByText('My seeded playlist').click()
    await expect(page.getByTitle('All playlist videos are already preloaded')).toHaveAttribute('aria-disabled', 'true')

    await app.electronApp.evaluate(({ BrowserWindow }, channel) => {
      BrowserWindow.getAllWindows()[0].webContents.send(channel)
    }, IpcChannels.YT_DLP_BINARY_UPDATED)
    await expect(page.getByTitle('Preload all videos')).toHaveAttribute('aria-disabled', 'false')
  })

  test('releases stale preload UI when switching playlists', async ({ app, page }) => {
    await app.electronApp.evaluate(({ ipcMain }, channel) => {
      globalThis.__ytDlpPreloadVideoIds = []
      globalThis.__ytDlpPreloadResolvers = []
      const requestCounts = new Map()
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, (_event, videoId) => {
        globalThis.__ytDlpPreloadVideoIds.push(videoId)
        const requestCount = (requestCounts.get(videoId) ?? 0) + 1
        requestCounts.set(videoId, requestCount)
        if (requestCount === 1) {
          return new Promise(resolve => globalThis.__ytDlpPreloadResolvers.push({ videoId, resolve }))
        }
        return { error: 'mock failure' }
      })
    }, IpcChannels.YT_DLP_GET_PLAYBACK_INFO)

    await goTo(page, 'userplaylists')
    await page.getByText('My seeded playlist').click()
    await page.getByTitle('Preload all videos').click()

    await expect.poll(() => app.electronApp.evaluate(
      () => [...new Set(globalThis.__ytDlpPreloadVideoIds)]
    )).toEqual(['ccccccccccc', 'ddddddddddd'])

    await page.locator(sel.searchInput).fill(
      'https://www.youtube.com/playlist?list=secondary&playlistType=user'
    )
    await page.locator(sel.searchInput).press('Enter')
    await expect(page.getByRole('heading', { name: 'Secondary preload playlist' })).toBeVisible()
    await expect(page.getByTestId('progress-toast')).toHaveCount(0)

    const secondaryPreloadButton = page.getByTitle('Preload all videos')
    await expect(secondaryPreloadButton).toHaveAttribute('aria-disabled', 'false')
    await secondaryPreloadButton.click()
    await expect(page.getByTestId('progress-toast')).toContainText('Preloading videos: 0 of 1')

    await app.electronApp.evaluate(() => {
      for (const entry of globalThis.__ytDlpPreloadResolvers.splice(0)) {
        entry.resolve({ error: 'mock failure' })
      }
    })
    await expect.poll(() => app.electronApp.evaluate(
      () => [...new Set(globalThis.__ytDlpPreloadVideoIds)]
    )).toEqual(['ccccccccccc', 'ddddddddddd', 'eeeeeeeeeee'])

    await app.electronApp.evaluate(() => {
      for (const entry of globalThis.__ytDlpPreloadResolvers.splice(0)) {
        entry.resolve({ error: 'mock failure' })
      }
    })
    await expect(page.getByText(
      'Preloaded 0 of 1 videos. 1 could not be preloaded.'
    )).toBeVisible()
    await expect(page.getByTestId('progress-toast')).toHaveCount(0)
  })

  test('restores running premiere styling when the scheduled time arrives', async ({ page }) => {
    await goTo(page, 'userplaylists')
    await page.clock.install({ time: seededPremiereStart - 86_400_000 })
    await page.getByText('My seeded playlist').click()

    const card = page.locator('.ft-list-video').filter({ hasText: 'Upcoming seeded premiere' })
    const title = card.getByText('Upcoming seeded premiere', { exact: true })
    await page.locator('body').evaluate(element => {
      element.style.setProperty('--primary-text-color', '#123456')
      element.style.setProperty('--tertiary-text-color', '#654321')
    })
    await expect(title).toHaveCSS('color', 'rgb(18, 52, 86)')

    await page.clock.fastForward(86_400_001)

    await expect(title).toHaveCSS('color', 'rgb(101, 67, 33)')
  })

  test('playlist artwork keeps its native aspect ratio', async ({ page }) => {
    await goTo(page, 'userplaylists')
    await page.getByText('My seeded playlist').click()

    const thumbnail = page.locator('.playlistThumbnail img')
    await page.addStyleTag({ content: '.playlistThumbnail { display: block !important; }' })
    await thumbnail.evaluate((image) => {
      image.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"/>'
    })
    await expect(thumbnail).toBeVisible()
    await expect(thumbnail).toHaveJSProperty('complete', true)

    const bounds = await thumbnail.boundingBox()
    expect(bounds.width).toBe(bounds.height)
  })

  test('keeps the playlist title when switching tabs', async ({ page }) => {
    await goTo(page, 'userplaylists')
    await page.getByText('My seeded playlist').click()
    await expect(page.locator(sel.activeTab)).toContainText('My seeded playlist')

    await page.locator(sel.newTabButton).click()
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    // Wait for the new tab to settle on its landing page before switching back.
    // Clicking while its title is still resolving races the tab bar re-render,
    // and the switch can be lost on a loaded machine.
    await expect(page.locator(sel.activeTab)).toContainText('Subscriptions')
    await expect(page.locator(sel.activeTab)).not.toContainText('My seeded playlist')
    await page.locator(sel.tabs).filter({ hasText: 'My seeded playlist' }).click()

    await expect(page.locator(sel.activeTab)).toContainText('My seeded playlist')
  })

  test('playlist edits and deletion persist across restarts', async ({ app, page }) => {
    await goTo(page, 'userplaylists')
    await page.getByText('My seeded playlist').click()

    await page.getByTitle('Edit Playlist Info').click()
    await page.locator('.playlistStats input').fill('Renamed seeded playlist')
    await page.locator('.descriptionInput input').fill('Updated through E2E')
    await page.getByTitle('Save Changes').click()

    await expect(page.locator('.playlistTitle')).toHaveText('Renamed seeded playlist')
    await expect(page.locator('.playlistDescription')).toHaveText('Updated through E2E')

    ;({ page } = await app.relaunch())
    await goTo(page, 'userplaylists')
    await page.getByText('Renamed seeded playlist').click()
    await expect(page.locator('.playlistDescription')).toHaveText('Updated through E2E')

    await page.getByTitle('Delete Playlist').click()
    await page.getByRole('button', { name: 'Yes, Delete' }).click()
    await expect(page).toHaveURL(/#\/userplaylists\/?$/)
    await expect(page.locator(sel.activeTab).locator('[data-icon="bookmark"]')).toBeVisible()
    await expect(page.getByText('Renamed seeded playlist')).toHaveCount(0)

    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'playlists.db'), 'utf8')
      const records = contents.trim().split('\n').map((line) => JSON.parse(line))
      return records.filter((record) => record._id === 'e2eseeded').at(-1)?.$$deleted
    }).toBe(true)
  })

  test('a custom quick bookmark emoji persists across restarts', async ({ app, page }) => {
    await goTo(page, 'userplaylists')
    await page.getByText('Favorites').click()

    await page.getByTitle('Edit Playlist Info').click()
    await page.getByLabel('Custom emoji').fill('❤️‍🔥')
    await page.getByTitle('Save Changes').click()

    const quickBookmarkButton = page.getByTitle('Quick Bookmark Enabled')
    await expect(quickBookmarkButton.locator('.ft-custom-icon__emoji')).toHaveText('❤️‍🔥')

    ;({ page } = await app.relaunch())
    await goTo(page, 'userplaylists')
    await page.getByText('Favorites').click()
    await expect(page.getByTitle('Quick Bookmark Enabled').locator('.ft-custom-icon__emoji')).toHaveText('❤️‍🔥')
  })
})

test.describe('saved playlist metadata', () => {
  test.use({
    seed: {
      settings: {
        playlistBookmarks: [{
          playlist: {
            id: 'saved-playlist',
            title: 'Saved playlist',
            description: '',
            thumbnail_url: 'https://i.ytimg.com/vi/ggggggggggg/mqdefault.jpg',
            video_count: 4
          },
          uploader: {
            id: 'UC-saved-playlist',
            name: 'Saved channel',
            avatar: null,
            verified: false
          },
          savedAt: 1
        }]
      }
    }
  })

  test('updates saved playlist card metadata while the list remains open', async ({ page }) => {
    await goTo(page, 'userplaylists')

    const playlistCard = page.locator('.ft-list-video', {
      has: page.locator('a.title[href*="/playlist/saved-playlist"]')
    })
    await expect(playlistCard.locator('.h3Title')).toHaveText('Saved playlist')
    await expect(playlistCard.locator('.channelNameText')).toHaveText('Saved channel')
    await expect(playlistCard.locator('.thumbnailImage')).toHaveAttribute('src', /ggggggggggg/)
    await expect(playlistCard.locator('.videoCountContainer')).toHaveText('4')

    await dispatchStoreAction(page, 'savePlaylistBookmark', {
      playlist: {
        id: 'saved-playlist',
        title: 'Saved playlist updated',
        description: 'Updated metadata',
        thumbnail_url: 'https://i.ytimg.com/vi/hhhhhhhhhhh/mqdefault.jpg',
        video_count: 5
      },
      uploader: {
        id: 'UC-updated-saved-playlist',
        name: 'Updated saved channel',
        avatar: null,
        verified: false
      },
      savedAt: 1
    })

    await expect(playlistCard.locator('.h3Title')).toHaveText('Saved playlist updated')
    await expect(playlistCard.locator('.channelNameText')).toHaveText('Updated saved channel')
    await expect(playlistCard.locator('.thumbnailImage')).toHaveAttribute('src', /hhhhhhhhhhh/)
    await expect(playlistCard.locator('.videoCountContainer')).toHaveText('5')
    await expect(playlistCard.locator('.channelName')).toHaveAttribute('href', '#/channel/UC-updated-saved-playlist')
  })
})

test.describe('playlist view type', () => {
  test.use({
    seed: {
      settings: {
        listType: 'list'
      },
      playlists: [{
        _id: 'playlist-view-type',
        playlistName: 'Playlist view type',
        protected: false,
        description: '',
        videos: [{
          videoId: 'eeeeeeeeeee',
          title: 'Playlist view video',
          author: 'Test Channel',
          authorId: 'UC-test-channel-id',
          lengthSeconds: 120,
          published: Date.now() - 86_400_000,
          timeAdded: Date.now(),
          playlistItemId: 'playlist-view-item',
          type: 'video'
        }],
        createdAt: Date.now() - 86_400_000,
        lastUpdatedAt: Date.now()
      }]
    }
  })

  test('defaults to grid independently and persists list view', async ({ app, page }) => {
    await goTo(page, 'userplaylists')
    await page.getByText('Playlist view type').click()
    await expect(page.locator('.playlistPage')).toHaveClass(/grid/)

    const appearance = await goToSettingsSection(page, 'appearance')
    const playlistViewSetting = appearance.locator('.select').filter({
      has: page.getByRole('combobox', { name: 'Playlist View Type' })
    })
    const playlistViewSelect = playlistViewSetting.locator('select')
    await expect(playlistViewSelect).toHaveValue('grid')
    await playlistViewSelect.selectOption('list')
    await page.locator('.settingsCloseButton').click()

    await expect(page.locator('.playlistPage')).toHaveClass(/list/)
    await expect(page.locator('.playlistItems')).toBeVisible()

    ;({ page } = await app.relaunch())
    await goTo(page, 'userplaylists')
    await page.getByText('Playlist view type').click()
    await expect(page.locator('.playlistPage')).toHaveClass(/list/)
  })
})

test.describe('custom playlist order', () => {
  test.use({
    seed: {
      settings: {
        listType: 'grid',
        userPlaylistSortOrder: 'custom'
      },
      playlists: [
        {
          _id: 'large-custom-playlist',
          playlistName: 'Large custom playlist',
          protected: false,
          description: '',
          videos: Array.from({ length: 101 }, (_, index) => ({
            videoId: String(index).padStart(11, '0'),
            title: `Custom playlist video ${index + 1}`,
            author: 'Test Channel',
            authorId: 'UC-test-channel-id',
            lengthSeconds: 120,
            published: Date.now() - 86_400_000,
            timeAdded: Date.now() - index,
            playlistItemId: `custom-playlist-item-${index}`,
            type: 'video'
          })),
          createdAt: Date.now() - 86_400_000,
          lastUpdatedAt: Date.now()
        }
      ]
    }
  })

  test('keeps the grid grab bars in place during the removal undo period', async ({ page }) => {
    await goTo(page, 'userplaylists')
    await page.getByText('Large custom playlist').click()

    const secondVideo = page.locator('.ft-list-video').filter({
      has: page.getByText('Custom playlist video 2', { exact: true })
    })
    await expect(secondVideo.locator('.grabBar')).toBeVisible()
    await secondVideo.getByTitle('Remove from Playlist').click()

    await expect(secondVideo).toHaveCount(0)
    await expect(page.locator('.playlistItemsCard .grid.draggable .grabBar').first()).toBeVisible()

    const thirdVideo = page.locator('.ft-list-video').filter({
      has: page.getByText('Custom playlist video 3', { exact: true })
    })
    await thirdVideo.getByTitle('Move Video Up').click()
    await expect(page.locator('.playlistItemsCard .h3Title').first()).toHaveText('Custom playlist video 3')
  })

  test('keeps the playlist header below the navigation while scrolling the grid', async ({ page }) => {
    await goTo(page, 'userplaylists')
    await page.getByText('Large custom playlist').click()

    const expectHeaderBelowNavigation = async () => {
      const playlistHeader = page.locator('.playlistInfoContainer')
      await expect(playlistHeader).toBeVisible()
      await page.evaluate(() => window.scrollTo(0, Number.MAX_SAFE_INTEGER))
      await expect.poll(async () => page.evaluate(() => {
        const previousScrollY = window.scrollY
        window.scrollTo(0, Number.MAX_SAFE_INTEGER)
        return window.scrollY - previousScrollY
      })).toBe(0)
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)

      await expect.poll(async () => {
        const [header, navigation, viewportHeight] = await Promise.all([
          playlistHeader.boundingBox(),
          page.locator('.topNav').boundingBox(),
          page.evaluate(() => window.innerHeight)
        ])
        return header != null && navigation != null &&
          header.y >= navigation.y + navigation.height &&
          header.y < viewportHeight && header.y + header.height > 0
      }).toBe(true)
    }

    await expectHeaderBelowNavigation()

    await page.keyboard.press('F1')
    await expect(page.locator('.app')).toHaveClass(/verticalTabs/)
    await expectHeaderBelowNavigation()
  })

  test('moves a video to the top from its options menu', async ({ page }) => {
    await goTo(page, 'userplaylists')
    await page.getByText('Large custom playlist').click()

    const thirdVideo = page.locator('.ft-list-video').filter({
      has: page.getByText('Custom playlist video 3', { exact: true })
    })
    await thirdVideo.locator('.optionsButton').click()
    await page.getByRole('option', { name: 'Move Video to the Top' }).click()

    await expect(page.locator('.playlistItemsCard .h3Title').first()).toHaveText('Custom playlist video 3')
  })
})
