import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, goTo, updateInputWithoutScrolling } from '../../helpers/app.mjs'

const now = Date.now()
const DAY = 86_400_000

function historyEntry(videoId, title, timeWatched, isWatched = false, extra = {}) {
  return {
    _id: videoId,
    videoId,
    title,
    author: 'Test Channel',
    authorId: 'UC-test-channel-id',
    published: Date.now() - 86_400_000,
    description: 'Test description',
    viewCount: 1234,
    lengthSeconds: 60,
    watchProgress: 10,
    isWatched,
    timeWatched,
    isLive: false,
    type: 'video',
    ...extra
  }
}

function matchingHistoryEntries(prefix, count, timeOffset = 0) {
  return Array.from({ length: count }, (_, index) => {
    const suffix = String(index).padStart(6, '0')
    return historyEntry(
      `${prefix.toLowerCase()}${suffix}`,
      `${prefix} match ${suffix}`,
      now - timeOffset - index
    )
  })
}

async function scrollPageToEnd(page) {
  await page.evaluate(() => {
    document.activeElement?.blur()
    window.scrollTo(0, document.documentElement.scrollHeight)
  })
  await expect.poll(() => page.evaluate(() => {
    const maximumScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
    return Math.abs(window.scrollY - maximumScrollY)
  })).toBeLessThanOrEqual(1)
}

async function expectPageScrollWithinRenderedRange(page) {
  await expect.poll(() => page.evaluate(() => {
    const content = document.querySelector('.app > .routerView')
    const contentBox = content.getBoundingClientRect()
    const contentMarginBottom = Number.parseFloat(getComputedStyle(content).marginBottom) || 0
    const renderedMaximumScrollY = Math.max(
      0,
      contentBox.bottom + window.scrollY + contentMarginBottom - window.innerHeight
    )
    const documentMaximumScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
    const scrollbar = document.querySelector('body > .os-scrollbar-vertical')
    const track = scrollbar?.querySelector('.os-scrollbar-track')
    const handle = scrollbar?.querySelector('.os-scrollbar-handle')
    let scrollbarMatchesOverflow = scrollbar?.classList.contains('os-scrollbar-unusable') === true

    if (documentMaximumScrollY > 1 && track && handle) {
      const trackBox = track.getBoundingClientRect()
      const handleBox = handle.getBoundingClientRect()
      const trackRange = trackBox.height - handleBox.height
      const expectedHandleOffset = window.scrollY / documentMaximumScrollY * trackRange
      const handleOffset = handleBox.top - trackBox.top
      scrollbarMatchesOverflow =
        scrollbar.classList.contains('os-scrollbar-visible') &&
        !scrollbar.classList.contains('os-scrollbar-unusable') &&
        Math.abs(handleOffset - expectedHandleOffset) <= 1
    }

    return {
      documentRangeMatchesContent: Math.abs(documentMaximumScrollY - renderedMaximumScrollY) <= 1,
      scrollWithinRenderedRange: window.scrollY <= renderedMaximumScrollY + 1,
      scrollbarMatchesOverflow
    }
  })).toEqual({
    documentRangeMatchesContent: true,
    scrollWithinRenderedRange: true,
    scrollbarMatchesOverflow: true
  })
}

test.use({
  seed: {
    settings: {
      uiRoundness: 200,
      quickBookmarkTargetPlaylistId: 'favorites'
    },
    playlists: [{
      _id: 'favorites',
      playlistName: 'Favorites',
      protected: true,
      description: '',
      quickBookmarkIcon: 'bookmark',
      videos: [],
      createdAt: now - DAY,
      lastUpdatedAt: now - DAY
    }],
    history: [
      historyEntry('aaaaaaaaaaa', 'First test video', now - 1000, true),
      historyEntry('bbbbbbbbbbb', 'Second test video', now - 2000),
      historyEntry('ccccccccccc', 'Active live stream', now - 3000, false, { isLive: true }),
      historyEntry('eeeeeeeeeee', 'Upcoming premiere', now - 4000, false, {
        isUpcoming: true,
        premiereTimestamp: Math.floor((now + 30 * DAY) / 1000)
      }),
      historyEntry('fffffffffff', 'Started premiere with stale flag', now - 5000, false, {
        isUpcoming: true,
        premiereTimestamp: Math.floor((now - DAY) / 1000)
      })
    ]
  }
})

test.describe('watch history', () => {
  test('shows seeded entries, newest first', async ({ page }) => {
    await goTo(page, 'history')

    await expect(page.getByText('First test video')).toBeVisible()
    await expect(page.getByText('Second test video')).toBeVisible()

    const titles = page.locator('.ft-list-video .title, [class*="videoTitle"]')
    await expect(titles.first()).toContainText('First test video')
  })

  test('consumes the backdrop tap when dismissing a prompt', async ({ page }) => {
    await goTo(page, 'history')
    await page.getByRole('button', { name: 'Delete Old History' }).click()

    const prompt = page.locator('.prompt')
    await expect(prompt).toBeVisible()
    await page.evaluate(() => {
      window.__promptBackdropEvents = { clicks: 0, pointerDowns: 0 }
      const app = document.querySelector('.app')
      app.addEventListener('pointerdown', () => window.__promptBackdropEvents.pointerDowns++)
      app.addEventListener('click', () => window.__promptBackdropEvents.clicks++)
    })

    const bounds = await prompt.boundingBox()
    await page.mouse.move(bounds.x + 1, bounds.y + 1)
    await page.mouse.down()
    await page.mouse.up()

    await expect(prompt).toHaveCount(0)
    expect(await page.evaluate(() => window.__promptBackdropEvents)).toEqual({
      clicks: 0,
      pointerDowns: 0
    })
  })

  test('the sort options row keeps a gap above the video grid', async ({ page }) => {
    await goTo(page, 'history')
    await expect(page.getByText('First test video')).toBeVisible()

    const optionsRow = page.locator('.optionsRow')
    const firstVideo = page.locator('.ft-list-video, [class*="ft-list-video"]').first()
    await expect.poll(async () => {
      const [optionsBox, videoBox] = await Promise.all([
        optionsRow.boundingBox(),
        firstVideo.boundingBox()
      ])
      return videoBox.y - (optionsBox.y + optionsBox.height)
    }).toBeGreaterThanOrEqual(10)
  })

  test('keeps space between the history actions and search field', async ({ page }) => {
    await page.setViewportSize({ width: 520, height: 900 })
    await goTo(page, 'history')

    const actions = page.locator('.headingActions')
    const search = page.locator('.historySearch')
    await expect.poll(async () => {
      const [actionsBox, searchBox] = await Promise.all([actions.boundingBox(), search.boundingBox()])
      return searchBox.y - actionsBox.y - actionsBox.height
    }).toBeGreaterThanOrEqual(12)
  })

  test('keeps thumbnail actions inset and separated on narrow layouts', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 })
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').filter({ hasText: 'Upcoming premiere' })
    await video.hover()
    const thumbnail = video.locator('.videoThumbnail')
    const actions = video.locator('.playlistIcons')
    const buttons = actions.locator('.iconButton')
    await expect(buttons).toHaveCount(3)

    const [thumbnailBox, actionsBox, firstButtonBox, secondButtonBox] = await Promise.all([
      thumbnail.boundingBox(),
      actions.boundingBox(),
      buttons.nth(0).boundingBox(),
      buttons.nth(1).boundingBox()
    ])
    expect(actionsBox.y - thumbnailBox.y).toBeGreaterThanOrEqual(8)
    expect(thumbnailBox.x + thumbnailBox.width - actionsBox.x - actionsBox.width).toBeGreaterThanOrEqual(8)
    expect(secondButtonBox.x - firstButtonBox.x - firstButtonBox.width).toBeGreaterThanOrEqual(8)
    expect(actionsBox.x).toBeGreaterThanOrEqual(thumbnailBox.x)
    expect(actionsBox.x + actionsBox.width).toBeLessThanOrEqual(thumbnailBox.x + thumbnailBox.width)
  })

  test('uses edge-to-edge cards in the Capacitor phone layout', async ({ page }) => {
    await page.setViewportSize({ width: 520, height: 900 })
    await goTo(page, 'history')
    await page.locator('.app').evaluate(element => element.classList.add('capacitorPhoneLayout'))

    const card = page.locator('.card').first()
    await expect.poll(async () => {
      const cardBox = await card.boundingBox()
      return Math.max(
        Math.abs(cardBox.x),
        Math.abs(520 - cardBox.x - cardBox.width)
      )
    }).toBeLessThanOrEqual(1)
    await expect(card).toHaveCSS('margin-bottom', '0px')
    await expect(card).toHaveCSS('border-radius', '0px')
  })

  test('history search filters entries', async ({ page }) => {
    await goTo(page, 'history')
    await expect(page.getByText('First test video')).toBeVisible()

    const filterInput = page.locator('.ft-input-component input').last()
    await filterInput.fill('Second')

    await expect(page.getByText('Second test video')).toBeVisible()
    await expect(page.getByText('First test video')).toBeHidden()
  })

  test('always shows watched indicators', async ({ page }) => {
    await goTo(page, 'history')

    const watchedVideo = page.locator('.ft-list-video').filter({ hasText: 'First test video' })
    const watchedIndicator = watchedVideo.locator('.videoWatched')
    const durationIndicator = watchedVideo.locator('.videoDuration')
    await expect(page.getByRole('checkbox', { name: 'Show Watched Indicators' })).toHaveCount(0)
    await expect(watchedIndicator).toHaveText('Watched')
    await expect(watchedIndicator).toHaveCSS('border-radius', '10px')
    await expect(watchedIndicator).toHaveCSS('font-size', '15px')
    await expect(durationIndicator).toHaveCSS('border-radius', '10px')
    await expect(durationIndicator).toHaveCSS('font-size', '15px')
  })

  test('keeps an existing entry in place when toggling watched status', async ({ page }) => {
    await goTo(page, 'history')

    const videos = page.locator('.ft-list-video')
    const secondVideo = videos.filter({ hasText: 'Second test video' })

    await secondVideo.hover()
    await secondVideo.locator('.optionsButton').click()
    await page.getByRole('option', { name: 'Mark As Watched' }).click()

    await expect(videos.nth(0)).toContainText('First test video')
    await expect(videos.nth(1)).toContainText('Second test video')

    await secondVideo.hover()
    await secondVideo.locator('.optionsButton').click()
    await page.getByRole('option', { name: 'Unmark As Watched' }).click()

    await expect(videos.nth(0)).toContainText('First test video')
    await expect(videos.nth(1)).toContainText('Second test video')
  })

  test('does not offer watched actions for an active live history entry', async ({ page }) => {
    await goTo(page, 'history')

    const activeLiveStream = page.locator('.ft-list-video').filter({ hasText: 'Active live stream' })
    await activeLiveStream.hover()
    await activeLiveStream.locator('.optionsButton').click()

    await expect(page.getByRole('option', { name: 'Mark As Watched' })).toHaveCount(0)
    await expect(page.getByRole('option', { name: 'Unmark As Watched' })).toHaveCount(0)
    await expect(page.getByRole('option', { name: 'Remove From History' })).toBeVisible()
  })

  test('does not offer watched actions for an upcoming premiere history entry', async ({ page }) => {
    await goTo(page, 'history')

    const upcomingPremiere = page.locator('.ft-list-video').filter({ hasText: 'Upcoming premiere' })
    await upcomingPremiere.hover()
    await upcomingPremiere.locator('.optionsButton').click()

    await expect(page.getByRole('option', { name: 'Mark As Watched' })).toHaveCount(0)
    await expect(page.getByRole('option', { name: 'Unmark As Watched' })).toHaveCount(0)
    await expect(page.getByRole('option', { name: 'Remove From History' })).toBeVisible()
  })

  test('enables watched actions when a mounted premiere reaches its scheduled time', async ({ page }) => {
    await goTo(page, 'trending')
    await page.clock.install({ time: now })
    await goTo(page, 'history')

    const upcomingPremiere = page.locator('.ft-list-video').filter({ hasText: 'Upcoming premiere' })
    await upcomingPremiere.hover()
    await upcomingPremiere.locator('.optionsButton').click()
    await expect(page.getByRole('option', { name: 'Mark As Watched' })).toHaveCount(0)

    // Split the jump so timers beyond Chromium's maximum timeout are rescheduled.
    await page.clock.fastForward(24 * DAY)
    await page.clock.fastForward(6 * DAY + 1000)

    await expect(page.getByRole('option', { name: 'Mark As Watched' })).toBeVisible()
  })

  test('marks every history entry as watched', async ({ app, page }) => {
    await goTo(page, 'history')

    const markAllButton = page.getByRole('button', { name: 'Mark All As Watched' })
    await expect(markAllButton).not.toBeDisabled()
    await markAllButton.click()

    const prompt = page.getByRole('dialog', {
      name: 'Are you sure you want to mark all videos in your history as watched?'
    })
    await expect(prompt).toBeVisible()
    await prompt.getByRole('button', { name: 'Mark All As Watched' }).click()

    await expect(markAllButton).toBeDisabled()

    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'history.db'), 'utf8')
      const records = contents.trim().split('\n').map((line) => JSON.parse(line))
      const latestRecords = Object.values(Object.fromEntries(
        records.filter(record => record.videoId).map(record => [record.videoId, record])
      ))
      return latestRecords.every(record => {
        return record.isLive === true || record.isUpcoming === true || record.isWatched === true
      }) &&
        latestRecords.find(record => record.videoId === 'ccccccccccc')?.isWatched === false &&
        latestRecords.find(record => record.videoId === 'eeeeeeeeeee')?.isWatched === false &&
        latestRecords.find(record => record.videoId === 'fffffffffff')?.isWatched === true
    }).toBe(true)
  })
})

test.describe('fractional history durations', () => {
  const examples = [
    { videoId: 'fraction001', lengthSeconds: 4125.721, timestamp: '1:08:45' },
    { videoId: 'fraction002', lengthSeconds: 153.839, timestamp: '2:33' },
    { videoId: 'fraction003', lengthSeconds: 125.109, timestamp: '2:05' },
    { videoId: 'fraction004', lengthSeconds: 116.889, timestamp: '1:56' },
    { videoId: 'fraction005', lengthSeconds: 104.768, timestamp: '1:44' }
  ]

  test.use({
    seed: {
      history: examples.map(({ videoId, lengthSeconds }, index) => historyEntry(
        videoId, `Fractional duration ${index}`, now - index, false, { lengthSeconds }
      ))
    }
  })

  test('shows whole-second duration badges for persisted fractional durations', async ({ page }) => {
    await goTo(page, 'history')

    for (const [index, { timestamp }] of examples.entries()) {
      const video = page.locator('.ft-list-video').filter({ hasText: `Fractional duration ${index}` })
      await expect(video.locator('.videoDuration')).toHaveText(timestamp)
    }
  })
})

test.describe('history search pagination', () => {
  test.use({
    seed: {
      settings: {
        generalAutoLoadMorePaginatedItemsEnabled: false,
        uiScale: 125
      },
      history: [
        ...matchingHistoryEntries('Decoy', 100),
        ...matchingHistoryEntries('Alpha', 220, 1000),
        ...matchingHistoryEntries('Beta', 130, 2000),
        ...matchingHistoryEntries('Gamma', 20, 3000)
      ]
    }
  })

  test('loads every filtered batch and resets the limit for a new query', async ({ page }) => {
    await goTo(page, 'history')

    const historySearch = page.locator('.ft-input-component').filter({
      has: page.getByRole('searchbox', { name: 'Search in History' })
    })
    const filterInput = historySearch.getByRole('searchbox', { name: 'Search in History' })
    const videos = page.locator('.tabContent[aria-hidden="false"] .autoGrid > *')
    const loadMoreButton = page.getByRole('button', { name: 'Load More Videos' })

    await filterInput.fill('Alpha match')
    await expect(videos.first()).toContainText('Alpha match')
    await expect(videos).toHaveCount(100)
    await expect(loadMoreButton).toBeVisible()

    await loadMoreButton.click()
    await expect(videos).toHaveCount(200)
    await expect(loadMoreButton).toBeVisible()

    await scrollPageToEnd(page)
    await updateInputWithoutScrolling(filterInput, 'Beta match')
    await expect(videos.first()).toContainText('Beta match')
    await expect(videos).toHaveCount(100)
    await expect(loadMoreButton).toBeVisible()
    await expectPageScrollWithinRenderedRange(page)

    await loadMoreButton.click()
    await expect(videos).toHaveCount(130)
    await expect(loadMoreButton).toHaveCount(0)

    await scrollPageToEnd(page)
    await expect(filterInput).toHaveAttribute('type', 'search')
    await filterInput.fill('')
    await expect(filterInput).toHaveValue('')
    await expect(videos.first()).toContainText('Decoy match')
    await expect(videos).toHaveCount(100)
    await expect(loadMoreButton).toBeVisible()
    await expectPageScrollWithinRenderedRange(page)

    await scrollPageToEnd(page)
    await updateInputWithoutScrolling(filterInput, 'Gamma match')
    await expect(videos.first()).toContainText('Gamma match')
    await expect(videos).toHaveCount(20)
    await expect(loadMoreButton).toHaveCount(0)
    await expectPageScrollWithinRenderedRange(page)
  })
})

test.describe('history search automatic pagination', () => {
  test.use({
    seed: {
      settings: {
        generalAutoLoadMorePaginatedItemsEnabled: true,
        uiScale: 125
      },
      history: [
        ...matchingHistoryEntries('Decoy', 100),
        ...matchingHistoryEntries('Automatic', 150, 1000)
      ]
    }
  })

  test('loads the next filtered batch when the pagination control enters view', async ({ page }) => {
    await goTo(page, 'history')

    const filterInput = page.getByRole('searchbox', { name: 'Search in History' })
    const videos = page.locator('.tabContent[aria-hidden="false"] .autoGrid > *')

    await filterInput.fill('Automatic match')
    await expect(videos.first()).toContainText('Automatic match')
    await expect(videos).toHaveCount(100)
    await expect(page.getByRole('button', { name: 'Load More Videos' })).toHaveCount(0)
    await expect(page.locator('.ft-auto-load-next-page-wrapper')).toBeAttached()

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await expect(videos).toHaveCount(150)
    await expect(page.locator('.ft-auto-load-next-page-wrapper')).toHaveCount(0)
  })
})

test.describe('watch history with an immediate watched threshold', () => {
  const immediateHistoryEntry = historyEntry(
    'ddddddddddd',
    'Immediately watched video',
    Date.now(),
    true
  )

  test.use({
    seed: {
      settings: {
        fetchSubscriptionsAutomatically: false,
        watchedPercentageThreshold: 0,
      },
      profiles: [{
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [{
          id: immediateHistoryEntry.authorId,
          name: immediateHistoryEntry.author,
          thumbnail: '',
        }]
      }],
      history: [immediateHistoryEntry],
      subscriptionCache: [{
        _id: immediateHistoryEntry.authorId,
        videos: [immediateHistoryEntry],
        videosTimestamp: new Date().toISOString(),
      }]
    }
  })

  test('removes a history entry when it is marked as unwatched', async ({ app, page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').filter({ hasText: 'Immediately watched video' })
    await video.hover()
    await video.locator('.optionsButton').click()
    await page.getByRole('option', { name: 'Unmark As Watched' }).click()

    await expect(video).toHaveCount(0)
    await expect(page.getByText('Your history list is currently empty.')).toBeVisible()
    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'history.db'), 'utf8')
      const records = contents.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
      return records.filter(record => record._id === 'ddddddddddd').at(-1)?.$$deleted
    }).toBe(true)
  })

  test('removes and cleanly re-adds a history entry from the subscriptions feed', async ({ app, page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="videos"]').click()

    const video = page.locator('.ft-list-video').filter({ hasText: 'Immediately watched video' })
    await expect(video.locator('.watchedProgressBar')).toHaveCount(1)
    await video.hover()
    await video.locator('.optionsButton').click()
    await page.getByRole('option', { name: 'Unmark As Watched' }).click()

    await expect(video).toBeVisible()
    await expect(video.locator('.watchedProgressBar')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.getters.getHistoryCacheById.ddddddddddd
    })).toBeUndefined()

    await video.hover()
    await video.locator('.optionsButton').click()
    await page.getByRole('option', { name: 'Mark As Watched' }).click()

    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'history.db'), 'utf8')
      const records = contents.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
      return records.filter(record => record.videoId === 'ddddddddddd').at(-1)?.watchProgress
    }).toBe(0)
    await expect(video.locator('.watchedProgressBar')).toHaveAttribute('data-progress', '100')
  })
})

test.describe('history cleanup', () => {
  test.use({
    seed: {
      history: [
        historyEntry('rrrrrrrrrrr', 'Recent video', Date.now() - 1000),
        historyEntry('ooooooooooo', 'Old video', Date.now() - 100 * 86_400_000)
      ]
    }
  })

  test('deletes only entries older than the selected cutoff', async ({ app, page }) => {
    await goTo(page, 'history')
    await expect(page.getByText('Recent video')).toBeVisible()
    await expect(page.getByText('Old video')).toBeVisible()

    await page.getByRole('button', { name: 'Delete Old History' }).click()
    await page.locator('.cleanupPromptContent select').selectOption('30')
    await page.getByRole('button', { name: 'Delete', exact: true }).click()

    await expect(page.getByText('Old video')).toBeHidden()
    await expect(page.getByText('Recent video')).toBeVisible()

    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'history.db'), 'utf8')
      const records = contents.trim().split('\n').map((line) => JSON.parse(line))
      return records.filter((record) => record._id === 'ooooooooooo').at(-1)?.$$deleted
    }).toBe(true)
  })

  test('selects a history cutoff from the modal dropdown', async ({ page }) => {
    await goTo(page, 'history')
    await page.getByRole('button', { name: 'Delete Old History' }).click()

    const dialog = page.getByRole('dialog')
    const combobox = dialog.getByRole('combobox', { name: /Delete entries older than/i })
    await combobox.click()

    const dropdown = page.getByRole('listbox', { name: /Delete entries older than/i })
    await expect(dropdown).toBeVisible()
    await expect(dropdown.locator('xpath=..')).toHaveClass(/prompt/)
    await dropdown.getByRole('option', { name: '1 month' }).click()

    await expect(combobox).toContainText('1 month')
    await expect(dialog).toBeVisible()
  })
})

test.describe('legacy watch history', () => {
  const timeWatched = Date.now() - 1000

  test.use({
    seed: {
      history: [
        {
          _id: 'legacyvideo',
          videoId: 'legacyvideo',
          title: 'Legacy imported video',
          author: 'Test Channel',
          authorId: 'UC-test-channel-id',
          published: timeWatched,
          description: '',
          viewCount: 1234,
          lengthSeconds: 100,
          watchProgress: 0.95,
          timeWatched,
          isLive: false,
          type: 'video'
        }
      ]
    }
  })

  test('migrates fractional progress and watched status on load', async ({ app, page }) => {
    await goTo(page, 'history')
    await expect(page.getByText('Legacy imported video')).toBeVisible()

    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'history.db'), 'utf8')
      const records = contents.trim().split('\n').map((line) => JSON.parse(line))
      return records.find((record) => record._id === 'legacyvideo')
    }).toMatchObject({ watchProgress: 95, isWatched: true, isLive: false })
  })
})
