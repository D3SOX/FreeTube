import { test, expect, goTo, sel } from '../../helpers/app.mjs'

const HOUR = 3_600_000
const now = Date.now()

// The RSS refresh path is the one that can be driven without Innertube.
const commonSettings = {
  fetchSubscriptionsAutomatically: false,
  useRssFeeds: true,
  backendPreference: 'local',
  hideSubscriptionsShorts: true,
  hideSubscriptionsLive: true,
  thumbnailSize: 180
}

function channelId(index) {
  return `UC${String(index).padStart(22, '0')}`
}

function channelIndexFromUrl(url) {
  return Number(new URL(url).searchParams.get('playlist_id').match(/0*(\d+)$/)[1])
}

function rssFeed(index) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <author><name>Channel ${index}</name></author>
  <entry>
    <yt:videoId>fresh${index}</yt:videoId>
    <title>Fresh video ${index}</title>
    <published>${new Date(now - HOUR).toISOString()}</published>
    <media:group>
      <media:statistics views="1000"/>
    </media:group>
  </entry>
</feed>`
}

function rssFeedWithPreviousEntry(index) {
  return rssFeed(index).replace('</feed>', `
  <entry>
    <yt:videoId>cached${index}</yt:videoId>
    <title>Cached video ${index}</title>
    <published>${new Date(now - 2 * HOUR).toISOString()}</published>
    <media:group>
      <media:statistics views="1000"/>
    </media:group>
  </entry>
</feed>`)
}

function cachedChannel(index) {
  return {
    _id: channelId(index),
    videos: [{
      videoId: `cached${index}`,
      title: `Cached video ${index}`,
      author: `Channel ${index}`,
      authorId: channelId(index),
      published: now - (index + 2) * HOUR,
      viewCount: 1000,
      lengthSeconds: 120,
      liveNow: false,
      isUpcoming: false,
      type: 'video'
    }],
    videosTimestamp: new Date(now - 2 * HOUR).toISOString()
  }
}

function cachedCollaboratorChannel(index) {
  const channel = cachedChannel(index)
  channel.videos[0] = {
    ...channel.videos[0],
    hasCollaborators: true,
    collaborators: [
      { id: channelId(index), name: `Channel ${index}`, thumbnail: '', subtitle: '' },
      { id: 'UCcollaborator00000000000', name: 'Collaborator', thumbnail: '', subtitle: '' }
    ]
  }
  return channel
}

function profileWith(channelCount) {
  return {
    _id: 'allChannels',
    name: 'All Channels',
    bgColor: '#000000',
    textColor: '#FFFFFF',
    subscriptions: Array.from({ length: channelCount }, (_, index) => ({
      id: channelId(index),
      name: `Channel ${index}`,
      thumbnail: ''
    }))
  }
}

function profileWithFilteredChannel() {
  const profile = profileWith(2)
  profile.subscriptions[1].feedTypes = []
  return profile
}

function profileWithDailyLimit(limit) {
  const profile = profileWith(1)
  profile.subscriptions[0].dailyVideoLimit = limit
  return profile
}

/**
 * @param {(index: number) => number} delayFor per channel response delay
 */
async function routeFeeds(page, delayFor, feedFor = rssFeed) {
  await page.route(/^https?:\/\//, (route) => route.abort())

  await page.route('**/feeds/videos.xml**', async (route, request) => {
    const index = channelIndexFromUrl(request.url())
    const delay = delayFor(index)

    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay))
    }

    // The window may already be gone when a delayed response arrives.
    await route.fulfill({
      status: 200,
      contentType: 'application/xml',
      body: feedFor(index)
    }).catch(() => {})
  })
}

test.describe('per-channel subscription refresh filters', () => {
  test.use({
    seed: {
      settings: {
        ...commonSettings,
        enableDownloads: true,
        ytDlpAutomaticDownloadRules: JSON.stringify({
          [channelId(1)]: { includeVideos: true }
        })
      },
      profiles: [profileWithFilteredChannel()],
      subscriptionCache: [cachedChannel(0), cachedChannel(1)]
    }
  })

  test('keeps automatic-download refreshes independent from feed visibility', async ({ page }) => {
    const requestedChannelIndexes = []
    page.on('request', request => {
      if (request.url().includes('/feeds/videos.xml')) {
        requestedChannelIndexes.push(channelIndexFromUrl(request.url()))
      }
    })
    await routeFeeds(page, () => 0)
    await goTo(page, 'subscriptions')

    await expect(page.getByText('Cached video 0', { exact: true })).toBeVisible()
    await expect(page.getByText('Cached video 1', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: /Refresh Videos/ }).click()
    await expect(page.getByText('Fresh video 0', { exact: true })).toBeVisible()
    await expect(page.getByText('Fresh video 1', { exact: true })).toHaveCount(0)

    expect(requestedChannelIndexes).toEqual([0, 1])
  })
})

test.describe('invalid per-channel daily video limit', () => {
  test.use({
    seed: {
      settings: commonSettings,
      profiles: [profileWithDailyLimit(0)],
      subscriptionCache: [cachedChannel(0)]
    }
  })

  test('falls back to unlimited without suppressing the channel refresh', async ({ page }) => {
    const requestedChannelIndexes = []
    page.on('request', request => {
      if (request.url().includes('/feeds/videos.xml')) {
        requestedChannelIndexes.push(channelIndexFromUrl(request.url()))
      }
    })
    await routeFeeds(page, () => 0)
    await goTo(page, 'subscriptions')

    await expect(page.getByText('Cached video 0', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Refresh Videos/ }).click()
    await expect.poll(() => requestedChannelIndexes).toEqual([0])
    await expect(page.getByText('Fresh video 0', { exact: true })).toBeVisible()
  })
})

test.describe('incremental subscription feed refresh', () => {
  test.use({
    seed: {
      settings: commonSettings,
      profiles: [profileWith(2)],
      subscriptionCache: [cachedChannel(0), cachedChannel(1)]
    }
  })

  test('shows fetched channels before the whole refresh is done', async ({ page }) => {
    await routeFeeds(page, (index) => index === 1 ? 8_000 : 0)
    await goTo(page, 'subscriptions')
    await expect(page.getByText('Cached video 0', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: /Refresh Videos/ }).click()
    await expect(page.locator('.tab.active .loadingDot')).toBeVisible()

    // Channel 0 is done well before the pending channel 1, which keeps its
    // cached entry in the meantime
    await expect(page.getByText('Fresh video 0', { exact: true })).toBeVisible({ timeout: 3_000 })
    await expect(page.getByText('Fresh video 1', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Cached video 1', { exact: true })).toBeVisible()
    await expect(page.getByTestId('subscription-refresh-toast')).toBeVisible()
    await expect(page.locator('.tabsProgressBar')).toHaveCount(0)

    await expect(page.getByText('Fresh video 1', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.tab.active .loadingDot')).toHaveCount(0)
  })

  test('defers incremental feed renders while its app tab is hidden', async ({ page }) => {
    await routeFeeds(page, (index) => index === 1 ? 8_000 : 2_000)
    await goTo(page, 'subscriptions')
    await expect(page.getByText('Cached video 0', { exact: true })).toBeVisible()

    const firstChannelResponse = page.waitForResponse((response) => {
      return response.url().includes('/feeds/videos.xml') &&
        channelIndexFromUrl(response.url()) === 0 &&
        response.ok()
    })
    await page.getByRole('button', { name: /Refresh Videos/ }).click()
    await page.locator(sel.newTabButton).click()
    await goTo(page, 'history')

    await firstChannelResponse
    const refreshProgress = page.getByTestId('subscription-refresh-toast')
      .locator('.progress-indicator')
    await expect.poll(async () => Number(await refreshProgress.getAttribute('data-progress')))
      .toBeGreaterThan(0)

    const hiddenSubscriptions = page.locator('.tabContent[aria-hidden="true"]')
    await expect(hiddenSubscriptions.getByText('Fresh video 0', { exact: true })).toHaveCount(0)
    await expect(hiddenSubscriptions.getByText('Cached video 0', { exact: true })).toHaveCount(1)

    await page.locator(sel.tabs).first().click()
    await expect(page.getByText('Fresh video 0', { exact: true })).toBeVisible({ timeout: 3_000 })
  })

  test('keeps a manual refresh in the progress toast across navigation', async ({ page }) => {
    await routeFeeds(page, () => 8_000)
    await goTo(page, 'subscriptions')

    await page.getByRole('button', { name: /Refresh Videos/ }).click()
    const refreshToast = page.getByTestId('subscription-refresh-toast')
    await expect(refreshToast).toContainText('Refreshing subscription videos')
    await expect(page.locator('.app > .progressBar')).toHaveCount(0)

    await expect(refreshToast).toBeVisible()
    await goTo(page, 'history')
    await expect(refreshToast).toBeVisible()
    await expect(refreshToast).toHaveCount(0, { timeout: 30_000 })
  })
})

test.describe('subscription refresh performance with many tabs', () => {
  const channelCount = 933
  const tabCount = 46
  const loadedTabCount = 17
  const subscriptionTabId = 'perf-subscriptions'

  test.use({
    seed: {
      settings: {
        ...commonSettings,
        startupBehavior: 'restoreTabLoadState',
        reducedMotion: 'off'
      },
      profiles: [profileWith(channelCount)],
      subscriptionCache: Array.from({ length: channelCount }, (_, index) => cachedChannel(index)),
      tabSessions: [{
        _id: 'perf-window-session',
        value: {
          tabs: Array.from({ length: tabCount }, (_, index) => ({
            id: index === 0 ? subscriptionTabId : `perf-tab-${index}`,
            url: index === 0
              ? 'app://bundle/index.html#/subscriptions'
              : 'app://bundle/index.html#/history',
            title: index === 0 ? 'Subscriptions' : `Background tab ${index}`,
            isUnloaded: index >= loadedTabCount
          })),
          activeTabId: subscriptionTabId,
          bounds: { x: 0, y: 0, width: 1600, height: 900, maximized: false }
        }
      }]
    }
  })

  test('keeps the renderer responsive while refreshing a large profile', async ({ app, page }, testInfo) => {
    test.setTimeout(120_000)
    let fulfilledFeedCount = 0
    await routeFeeds(page, () => 0, (index) => {
      fulfilledFeedCount++
      return rssFeed(index)
    })
    await expect(page.locator(sel.tabs)).toHaveCount(tabCount)
    await expect(page.locator(`${sel.tabs}:not(.unloaded)`)).toHaveCount(loadedTabCount)
    await expect(page.getByText('Cached video 0', { exact: true })).toBeVisible({ timeout: 30_000 })

    const profileUpdate = await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const channels = store.getters.getActiveProfile.subscriptions.map(channel => ({
        channelId: channel.id,
        channelName: channel.name
      }))
      const startedAt = performance.now()
      await store.dispatch('batchUpdateSubscriptionDetails', channels)
      return performance.now() - startedAt
    })

    const rendererWorkingSet = async () => app.electronApp.evaluate(({ app }) => {
      return app.getAppMetrics()
        .filter(metric => metric.type === 'Tab')
        .reduce((total, metric) => total + metric.memory.workingSetSize, 0)
    })
    const memoryBefore = await rendererWorkingSet()

    await page.getByRole('button', { name: /Refresh Videos/ }).evaluate(button => {
      const startedAt = performance.now()
      let previousFrame = startedAt
      let longestFrame = 0
      let refreshedChannels = 0
      let completedAt = null
      const longFrames = []
      const longTasks = []
      let animationFrame

      const collectLongTasks = (entries) => {
        for (const entry of entries) {
          longTasks.push({
            at: entry.startTime - startedAt,
            duration: entry.duration,
            refreshedChannels,
            completedAt
          })
        }
      }
      const taskObserver = new PerformanceObserver((list) => {
        collectLongTasks(list.getEntries())
      })
      taskObserver.observe({ type: 'longtask' })

      const sampleFrame = (timestamp) => {
        const duration = timestamp - previousFrame
        longestFrame = Math.max(longestFrame, duration)
        if (duration >= 50) {
          longFrames.push({
            at: timestamp - startedAt,
            duration,
            refreshedChannels,
            completedAt
          })
        }
        previousFrame = timestamp
        animationFrame = requestAnimationFrame(sampleFrame)
      }
      const channelRefreshed = () => refreshedChannels++
      const refreshCompleted = () => { completedAt = performance.now() - startedAt }

      window.addEventListener('opentubex-subscription-refresh-channel', channelRefreshed)
      window.addEventListener('opentubex-subscription-refresh-completed', refreshCompleted)
      animationFrame = requestAnimationFrame(sampleFrame)
      window.__subscriptionRefreshPerformance = {
        stop: () => {
          cancelAnimationFrame(animationFrame)
          window.removeEventListener('opentubex-subscription-refresh-channel', channelRefreshed)
          window.removeEventListener('opentubex-subscription-refresh-completed', refreshCompleted)
          collectLongTasks(taskObserver.takeRecords())
          taskObserver.disconnect()
          return {
            elapsed: performance.now() - startedAt,
            longestFrame,
            longFrames,
            longestTask: Math.max(0, ...longTasks.map(task => task.duration)),
            totalBlockingTime: longTasks.reduce((total, task) => {
              return total + Math.max(0, task.duration - 50)
            }, 0),
            longTasks
          }
        }
      }
      button.click()
    })

    const cancelRefresh = page.getByRole('button', { name: 'Cancel refresh' })
    await expect(cancelRefresh).toBeVisible()
    await expect(cancelRefresh).toHaveCount(0, { timeout: 90_000 })
    expect(fulfilledFeedCount).toBe(channelCount)
    await expect(page.getByText('Fresh video 0', { exact: true })).toBeVisible()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))

    const timing = await page.evaluate(() => window.__subscriptionRefreshPerformance.stop())
    const memoryAfter = await rendererWorkingSet()
    const metrics = {
      ...timing,
      profileUpdate,
      rendererWorkingSetBeforeKiB: memoryBefore,
      rendererWorkingSetAfterKiB: memoryAfter
    }
    await testInfo.attach('performance metrics', {
      body: JSON.stringify(metrics, null, 2),
      contentType: 'application/json'
    })

    expect(profileUpdate, JSON.stringify(metrics)).toBeLessThan(50)
    // A single long-task duration can include runner preemption. Total blocking
    // time tolerates that jitter while still catching repeated or larger stalls.
    expect(timing.totalBlockingTime, JSON.stringify(metrics)).toBeLessThan(100)
    expect(timing.elapsed).toBeLessThan(10_000)
  })
})

test.describe('subscription refresh bottom progress', () => {
  test.use({
    seed: {
      settings: {
        ...commonSettings,
        showProgressBarToast: false
      },
      profiles: [profileWith(2)],
      subscriptionCache: [cachedChannel(0), cachedChannel(1)]
    }
  })

  test('keeps the global progress bar visible across navigation', async ({ page }) => {
    await routeFeeds(page, () => 8_000)
    await goTo(page, 'subscriptions')

    await page.getByRole('button', { name: /Refresh Videos/ }).click()
    const progressBar = page.locator('.app > .progressBar')
    await expect(progressBar).toBeVisible()
    await expect(page.locator('.tab.active .loadingDot')).toBeVisible()
    await expect(page.locator('.tabsProgressBar')).toHaveCount(0)

    await goTo(page, 'history')
    await expect(progressBar).toBeVisible()
    await expect(progressBar).toHaveCount(0, { timeout: 30_000 })
  })
})

test.describe('subscription feed state during refresh', () => {
  test.use({
    seed: {
      settings: commonSettings,
      profiles: [profileWith(2)],
      subscriptionCache: [cachedCollaboratorChannel(0), cachedChannel(1)]
    }
  })

  test('keeps an open collaborators modal when refreshed videos reorder the feed', async ({ page }) => {
    await routeFeeds(page, (index) => index === 0 ? 8_000 : 0)
    await goTo(page, 'subscriptions')

    const collaboratorVideo = page.locator('.ft-list-video').filter({ hasText: 'Cached video 0' })
    await collaboratorVideo.getByRole('button', { name: 'Channel 0' }).click()
    await expect(page.getByRole('heading', { name: 'Collaborators' })).toBeVisible()

    await page.getByRole('button', { name: /Refresh Videos/ }).evaluate(button => button.click())
    await expect(page.getByText('Fresh video 1', { exact: true })).toBeVisible({ timeout: 3_000 })
    await expect(page.getByRole('heading', { name: 'Collaborators' })).toBeVisible()
  })
})

test.describe('subscription feed refresh controls', () => {
  const cachedShort = {
    videoId: 'cached-short',
    title: 'Cached short',
    author: 'Channel 0',
    authorId: channelId(0),
    published: now - HOUR,
    viewCount: 1000,
    lengthSeconds: 30,
    liveNow: false,
    isUpcoming: false,
    type: 'video',
    isNewInSubscriptionFeed: true
  }

  test.use({
    seed: {
      settings: {
        ...commonSettings,
        hideSubscriptionsShorts: false,
        showNewSubscriptionFeedIndicators: true
      },
      profiles: [profileWith(1)],
      subscriptionCache: [{
        ...cachedChannel(0),
        shorts: [cachedShort],
        shortsTimestamp: new Date(now - 2 * HOUR).toISOString()
      }]
    }
  })

  test('keeps Mark all as seen enabled while another feed refreshes', async ({ page }) => {
    await routeFeeds(page, () => 8_000)
    await goTo(page, 'subscriptions')

    await page.getByRole('button', { name: /Refresh Videos/ }).click()
    await expect(page.getByRole('button', { name: 'Cancel refresh' })).toBeVisible()
    await page.locator('[data-subscription-feed-tab="shorts"]').click()

    await expect(page.getByRole('button', { name: 'Mark all as seen' })).toBeEnabled()
  })

  test('updates the Shorts feed immediately when all entries are marked as seen', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="shorts"]').click()

    const markAllAsSeen = page.getByRole('button', { name: 'Mark all as seen' })
    await expect(markAllAsSeen).toBeVisible()
    await markAllAsSeen.click()

    await expect(page.locator('.newContentDot')).toHaveCount(0)
    await expect(markAllAsSeen).toHaveCount(0)
  })

  test.describe('tabbed New feed', () => {
    test.use({
      seed: {
        settings: {
          ...commonSettings,
          hideSubscriptionsShorts: false,
          hideSubscriptionsLive: false,
          showNewSubscriptionFeed: true,
          showNewSubscriptionFeedIndicators: true
        },
        profiles: [profileWith(1)],
        subscriptionCache: [{
          ...cachedChannel(0),
          videos: [{ ...cachedChannel(0).videos[0], isNewInSubscriptionFeed: true }],
          shorts: [cachedShort],
          shortsTimestamp: new Date(now - 2 * HOUR).toISOString(),
          liveStreams: [{ ...cachedShort, videoId: 'cached-live', title: 'Cached live', liveNow: true }],
          liveStreamsTimestamp: new Date(now - 2 * HOUR).toISOString()
        }]
      }
    })

    for (const feed of ['shorts', 'live']) {
      test(`keeps Mark all as seen enabled for New ${feed} while Videos refreshes`, async ({ page }) => {
        await page.route(/^https?:\/\//, route => route.abort())
        // Leave the refresh pending until the test window closes.
        const pendingRequest = page.waitForRequest('**/feeds/videos.xml**')
        await page.route('**/feeds/videos.xml**', () => {})
        await goTo(page, 'subscriptions')
        await page.getByRole('button', { name: /Refresh Videos/ }).click()
        await pendingRequest
        await page.locator('[data-subscription-feed-tab="all"]').click()
        const markAllAsSeen = page.getByRole('button', { name: 'Mark all as seen' })
        await expect(markAllAsSeen).toBeDisabled()

        await page.getByRole('button', { name: 'Show tabbed view' }).click()
        await expect(markAllAsSeen).toBeDisabled()
        await page.locator(`[data-new-feed-tab="${feed}"]`).click()
        const entry = page.getByText(feed === 'shorts' ? 'Cached short' : 'Cached live', { exact: true })
        await expect(entry).toHaveCount(1)
        await expect(entry).toBeVisible()
        await expect(markAllAsSeen).toBeEnabled({ timeout: 3_000 })
        await markAllAsSeen.click()
        await expect(entry).toHaveCount(0)
        await expect(markAllAsSeen).toHaveCount(0)
        await expect(page.getByTestId('subscription-refresh-toast')).toBeVisible()

        await page.locator('[data-new-feed-tab="videos"]').click()
        await expect(page.getByText('Cached video 0', { exact: true })).toBeVisible()
        await expect(markAllAsSeen).toBeDisabled()
      })
    }
  })
})

test.describe('seen state after a subscription feed refresh', () => {
  test.use({
    seed: {
      settings: {
        ...commonSettings,
        showNewSubscriptionFeedIndicators: true
      },
      profiles: [profileWith(1)],
      subscriptionCache: [cachedChannel(0)]
    }
  })

  test('updates the refreshed feed immediately when all entries are marked as seen', async ({ page }) => {
    await routeFeeds(page, () => 0, rssFeedWithPreviousEntry)
    await goTo(page, 'subscriptions')

    await page.getByRole('button', { name: /Refresh Videos/ }).click()
    await expect(page.getByText('Fresh video 0', { exact: true })).toBeVisible()

    const markAllAsSeen = page.getByRole('button', { name: 'Mark all as seen' })
    await expect(markAllAsSeen).toBeVisible()
    await markAllAsSeen.click()

    await expect(page.locator('.newContentDot')).toHaveCount(0)
    await expect(markAllAsSeen).toHaveCount(0)
  })
})

test.describe('cancelling a subscription feed refresh', () => {
  // More channels than are fetched at once, so that the cancellation can skip
  // the ones that haven't started yet
  const channelCount = 12

  test.use({
    seed: {
      settings: commonSettings,
      profiles: [profileWith(channelCount)],
      subscriptionCache: Array.from({ length: channelCount }, (_, index) => cachedChannel(index))
    }
  })

  test('stops a running refresh and keeps what was already fetched', async ({ page }) => {
    await routeFeeds(page, () => 4_000)
    await goTo(page, 'subscriptions')
    await expect(page.getByText('Cached video 0', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: /Refresh Videos/ }).click()

    const cancelRefresh = page.getByRole('button', { name: 'Cancel refresh' })
    await expect(cancelRefresh).toBeVisible()
    await cancelRefresh.click()

    // The channels that were in flight still finish, the remaining ones are
    // skipped instead of being fetched
    await expect(page.locator('.tabsProgressBar')).toHaveCount(0, { timeout: 20_000 })
    await expect(cancelRefresh).toHaveCount(0)
    await expect(page.getByText('Fresh video 0', { exact: true })).toBeVisible()
    await expect(page.getByText(`Fresh video ${channelCount - 1}`, { exact: true })).toHaveCount(0)
    await expect(page.getByText(`Cached video ${channelCount - 1}`, { exact: true })).toBeVisible()
  })

  test('offers the cancellation in the feed tab context menu', async ({ page }) => {
    await routeFeeds(page, () => 4_000)
    await goTo(page, 'subscriptions')
    await expect(page.getByText('Cached video 0', { exact: true })).toBeVisible()

    await page.locator('[data-subscription-feed-tab="videos"]').click({ button: 'right' })
    const menu = page.getByRole('menu', { name: 'Context menu' })
    await menu.getByRole('menuitem', { name: 'Reload Videos' }).click()

    await expect(page.getByRole('button', { name: 'Cancel refresh' })).toBeVisible()

    await page.locator('[data-subscription-feed-tab="videos"]').click({ button: 'right' })
    await expect(menu.getByRole('menuitem', { name: 'Reload Videos' })).toHaveCount(0)
    await menu.getByRole('menuitem', { name: 'Cancel Refresh' }).click()

    await expect(page.locator('.tabsProgressBar')).toHaveCount(0, { timeout: 20_000 })
    await expect(page.getByText('Fresh video 0', { exact: true })).toBeVisible()
    await expect(page.getByText(`Cached video ${channelCount - 1}`, { exact: true })).toBeVisible()
  })

  test('turns the open context menu entry back into a reload when the refresh ends', async ({ page }) => {
    await routeFeeds(page, () => 1_000)
    await goTo(page, 'subscriptions')
    await expect(page.getByText('Cached video 0', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: /Refresh Videos/ }).click()

    const menu = page.getByRole('menu', { name: 'Context menu' })
    await page.locator('[data-subscription-feed-tab="videos"]').click({ button: 'right' })
    await expect(menu.getByRole('menuitem', { name: 'Cancel Refresh' })).toBeVisible()

    // The menu stays open while the refresh finishes
    await expect(menu.getByRole('menuitem', { name: 'Reload Videos' })).toBeVisible({ timeout: 30_000 })
    await expect(menu.getByRole('menuitem', { name: 'Cancel Refresh' })).toHaveCount(0)
  })
})

test.describe('cancelling an automatic subscription feed refresh', () => {
  const channelCount = 12

  test.use({
    seed: {
      settings: {
        ...commonSettings,
        subscriptionFeedAutoRefreshInterval: '5000',
        showToastTimeoutIndicator: false,
        toastPosition: 'top-left'
      },
      profiles: [profileWith(channelCount)],
      subscriptionCache: Array.from({ length: channelCount }, (_, index) => cachedChannel(index))
    }
  })

  test('shows persistent progress in a toast without the global progress bar', async ({ page }) => {
    await routeFeeds(page, (index) => index === 0 ? 0 : 8_000)
    await goTo(page, 'history')

    const refreshToast = page.getByTestId('subscription-refresh-toast')
    await expect(refreshToast).toContainText('Refreshing subscription videos', { timeout: 10_000 })
    await expect(refreshToast.locator('.icon')).toHaveAttribute('data-icon', 'video')
    await expect(page.locator('.app > .progressBar')).toHaveCount(0)
    expect(await refreshToast.evaluate((toast) => {
      const { left, top, width, height } = toast.getBoundingClientRect()
      const hit = document.elementFromPoint(left + width / 2, top + height / 2)
      return hit !== null && !toast.contains(hit)
    })).toBe(true)

    const indicator = refreshToast.locator('.progress-indicator')
    await expect(indicator).toBeVisible()
    await expect.poll(async () => Number(await indicator.getAttribute('data-progress'))).toBeGreaterThan(0)
    expect(Number(await indicator.getAttribute('data-progress'))).toBeLessThan(100)

    const expandedBounds = await refreshToast.boundingBox()
    const tabBarBounds = await page.locator('.tabBar:not(.vertical)').boundingBox()
    expect(expandedBounds.y).toBeGreaterThanOrEqual(tabBarBounds.y + tabBarBounds.height)

    await page.mouse.move(expandedBounds.x + expandedBounds.width / 2, expandedBounds.y + expandedBounds.height / 2)
    await expect(refreshToast).toHaveClass(/minimized/)
    await expect.poll(async () => (await refreshToast.boundingBox()).width).toBeLessThan(expandedBounds.width * 0.6)

    const minimizedBounds = await refreshToast.boundingBox()
    expect(minimizedBounds.x).toBeLessThan(expandedBounds.x)
    expect(minimizedBounds.y).toBeCloseTo(expandedBounds.y, 0)
    expect(minimizedBounds.y).toBeGreaterThanOrEqual(tabBarBounds.y + tabBarBounds.height)

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setVerticalTabBarWidth', 220)
      store.commit('setTabBarPosition', 'left')
    })
    const leftTabBar = page.locator('.tabBar.position-left')
    await expect(leftTabBar).toBeVisible()
    await expect(refreshToast).not.toHaveClass(/minimized/)
    const [shiftedBounds, leftTabBarBounds] = await Promise.all([
      refreshToast.boundingBox(),
      leftTabBar.boundingBox()
    ])
    expect(shiftedBounds.x).toBeGreaterThanOrEqual(leftTabBarBounds.x + leftTabBarBounds.width)

    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    await page.mouse.move(viewport.width / 2, viewport.height / 2)
    await expect(refreshToast).not.toHaveClass(/minimized/)
    await expect.poll(async () => (await refreshToast.boundingBox()).width).toBeGreaterThan(expandedBounds.width * 0.9)

    await page.evaluate(() => document.documentElement.requestFullscreen())
    await expect(refreshToast).toHaveCount(0)
    await page.evaluate(() => document.exitFullscreen())
    await expect(refreshToast).toBeVisible()

    await expect(refreshToast).toHaveCount(0, { timeout: 30_000 })
  })

  test('resets the timer instead of immediately refreshing again', async ({ page }) => {
    let requestCount = 0
    await routeFeeds(page, () => {
      requestCount++
      return 4_000
    })
    await goTo(page, 'subscriptions')

    const cancelRefresh = page.getByRole('button', { name: 'Cancel refresh' })
    await expect(cancelRefresh).toBeVisible({ timeout: 10_000 })
    await cancelRefresh.click()

    await expect(page.locator('.tabsProgressBar')).toHaveCount(0, { timeout: 20_000 })
    const requestCountAfterCancel = requestCount
    await page.waitForTimeout(2_000)

    expect(requestCountAfterCancel).toBeGreaterThan(0)
    expect(requestCount).toBe(requestCountAfterCancel)
    await expect(cancelRefresh).toHaveCount(0)
  })
})
