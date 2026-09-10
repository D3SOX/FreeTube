import { test, expect, goTo } from '../../helpers/app.mjs'
import { IpcChannels } from '../../../src/constants.js'

const now = Date.now()
const HOUR = 3_600_000

const CHANNEL_A = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const CHANNEL_B = 'UCbbbbbbbbbbbbbbbbbbbbbb'

function feedVideo(videoId, title, authorId, published, extra = {}) {
  return {
    videoId,
    title,
    author: authorId === CHANNEL_A ? 'Channel A' : 'Channel B',
    authorId,
    published,
    // Invidious includes this sentinel value for videos that are not premieres.
    premiereTimestamp: 0,
    viewCount: 1000,
    lengthSeconds: 120,
    liveNow: false,
    type: 'video',
    ...extra
  }
}

// Auto-fetch is disabled so the feed must come entirely from the seeded
// cache — this is exactly the offline startup path the app uses before
// any refresh (53caa4084, 7ad96d185).
const seed = {
  settings: {
    fetchSubscriptionsAutomatically: false,
    hideUpcomingPremieres: true,
    thumbnailSize: 180,
    ytDlpPlaybackAuthMode: 'browser',
    ytDlpPlaybackCookiesBrowser: 'firefox'
  },
  profiles: [
    {
      _id: 'allChannels',
      name: 'All Channels',
      bgColor: '#000000',
      textColor: '#FFFFFF',
      subscriptions: [
        { id: CHANNEL_A, name: 'Channel A', thumbnail: '', showMembersOnly: true },
        { id: CHANNEL_B, name: 'Channel B', thumbnail: '' }
      ]
    }
  ],
  subscriptionCache: [
    {
      _id: CHANNEL_A,
      videos: [
        feedVideo('aaaaaaaaaa1', 'Video A newer', CHANNEL_A, now - 1 * HOUR, { isMembersOnly: true }),
        feedVideo('aaaaaaaaaa4', 'Running premiere video', CHANNEL_A, now - 2 * HOUR, {
          isPremiere: true,
          liveNow: true
        }),
        feedVideo('aaaaaaaaaa2', 'Video A older', CHANNEL_A, now - 3 * HOUR),
        feedVideo('aaaaaaaaaa3', 'Upcoming premiere video', CHANNEL_A, now + 30 * 24 * HOUR, {
          isUpcoming: true,
          isPremiere: true,
          premiereDate: new Date(now + 30 * 24 * HOUR).toISOString()
        })
      ],
      videosTimestamp: new Date(now - 2 * HOUR).toISOString(),
      shorts: [],
      shortsTimestamp: new Date(now - 2 * HOUR).toISOString(),
      liveStreams: [],
      liveStreamsTimestamp: new Date(now - 2 * HOUR).toISOString(),
      communityPosts: [],
      communityPostsTimestamp: new Date(now - 2 * HOUR).toISOString()
    },
    {
      _id: CHANNEL_B,
      videos: [
        feedVideo('bbbbbbbbbb1', 'Video B newest', CHANNEL_B, now - 0.5 * HOUR)
      ],
      videosTimestamp: new Date(now - 1 * HOUR).toISOString(),
      shorts: [],
      shortsTimestamp: new Date(now - 1 * HOUR).toISOString(),
      liveStreams: [],
      liveStreamsTimestamp: new Date(now - 1 * HOUR).toISOString(),
      communityPosts: [],
      communityPostsTimestamp: new Date(now - 1 * HOUR).toISOString()
    }
  ]
}

test.use({ seed })

for (const theme of ['openTubeXLight', 'openTubeXDark']) {
  test.describe(`${theme} premiere colors`, () => {
    test.use({ seed: { ...seed, settings: { ...seed.settings, baseTheme: theme } } })

    test('running premieres use normal video text colors', async ({ page }) => {
      await goTo(page, 'subscriptions')
      const premiere = page.locator('.ft-list-video').filter({ hasText: 'Running premiere video' })
      const video = page.locator('.ft-list-video').filter({ hasText: 'Video A older' })
      await expect(premiere).toBeVisible()
      await expect(video).toBeVisible()
      await expect(premiere.locator('.videoDuration')).toHaveText('Premiere')

      for (const selector of ['.title', '.infoLine', '.channelName']) {
        const color = await video.locator(selector).evaluate(element => getComputedStyle(element).color)
        await expect(premiere.locator(selector)).toHaveCSS('color', color)
      }
    })
  })
}

test.describe('subscriptions feed from cache', () => {
  test('does not animate cards while calculating the initial grid size', async ({ page }) => {
    await page.evaluate(() => {
      window.__subscriptionFeedMoveClasses = []

      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.target.classList.contains('feed-move')) {
            window.__subscriptionFeedMoveClasses.push(mutation.target.className)
          }
        }
      })

      observer.observe(document.querySelector('.app'), {
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
      })
    })

    await goTo(page, 'subscriptions')
    await expect(page.getByText('Video A older')).toBeVisible()
    await page.waitForTimeout(350)

    const moveClasses = await page.evaluate(() => window.__subscriptionFeedMoveClasses)
    expect(moveClasses).toEqual([])
  })

  test('renders the cached feed offline, newest first across channels', async ({ page }) => {
    await goTo(page, 'subscriptions')

    await expect(page.getByText('Video B newest')).toBeVisible()
    await expect(page.getByText('Video A newer')).toBeVisible()
    await expect(page.getByText('Running premiere video')).toBeVisible()
    await expect(page.getByText('Video A older')).toBeVisible()

    const runningPremiere = page.locator('.ft-list-video').filter({ hasText: 'Running premiere video' })
    await expect(runningPremiere.locator('.videoDuration')).toHaveText('Premiere')
    await expect(runningPremiere.locator('.viewCount')).toContainText('1k watching')

    const titles = page.locator('.ft-list-video .title, [class*="videoTitle"]')
    await expect(titles.nth(0)).toContainText('Video B newest')
    await expect(titles.nth(1)).toContainText('Video A newer')
    await expect(titles.nth(2)).toContainText('Running premiere video')
    await expect(titles.nth(3)).toContainText('Video A older')

    // The subscription feed honours the hide-upcoming-premieres setting.
    await expect(page.getByText('Upcoming premiere video')).toHaveCount(0)
  })

  test('only shows opted-in members-only videos with configured playback cookies', async ({ page }) => {
    await goTo(page, 'subscriptions')

    let video = page.locator('.ft-list-video').filter({ hasText: 'Video A newer' })
    const badge = video.locator('.membersOnlyTag')
    await expect(badge).toHaveText('Members only')
    await expect(badge.locator('[data-icon="users"]')).toBeVisible()
    await expect(badge).toHaveCSS('white-space', 'nowrap')

    await page.evaluate(async (channelId) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateChannelSettings', {
        channelId,
        settings: { showMembersOnly: false }
      })
    }, CHANNEL_A)
    await expect(video).toHaveCount(0)

    await page.evaluate(async (channelId) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateChannelSettings', {
        channelId,
        settings: { showMembersOnly: true }
      })
    }, CHANNEL_A)
    video = page.locator('.ft-list-video').filter({ hasText: 'Video A newer' })
    await expect(video).toBeVisible()

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateYtDlpPlaybackAuthMode', 'none')
    })
    await expect(video).toHaveCount(0)
  })

  test('shows a hidden upcoming premiere as a premiere when its scheduled time arrives', async ({ page }) => {
    // The app opens on Subscriptions, so leave it before installing the clock;
    // timers created before installation cannot be advanced by Playwright.
    await goTo(page, 'trending')
    await page.clock.install({ time: now })
    await goTo(page, 'subscriptions')

    await expect(page.getByText('Upcoming premiere video')).toHaveCount(0)

    await page.clock.fastForward(24 * 24 * HOUR)
    await page.clock.fastForward(6 * 24 * HOUR + 1000)

    const premiere = page.locator('.ft-list-video').filter({ hasText: 'Upcoming premiere video' })
    await expect(premiere).toBeVisible()
    await expect(premiere.locator('.videoDuration')).toHaveText('Premiere')
  })

  test('polls a started premiere for watching counts and its completed video state', async ({ page }) => {
    await goTo(page, 'trending')
    await page.clock.install({ time: now + 30 * 24 * HOUR - 30_000 })
    let ended = false
    let watching = 2500
    let failRequests = false
    const requests = []
    await page.route('https://www.youtube.com/watch?*', async route => {
      const videoId = new URL(route.request().url()).searchParams.get('v')
      requests.push(videoId)
      if (failRequests) {
        // Exercise a failed poll, not network recovery's transport retry loop.
        await route.fulfill({ status: 503, body: 'Premiere metadata unavailable' })
        return
      }
      const player = {
        playabilityStatus: { status: 'OK' },
        videoDetails: {
          videoId,
          isLive: !ended,
          isLiveContent: false,
          viewCount: '9000',
          lengthSeconds: '702'
        },
        microformat: {
          playerMicroformatRenderer: {
            liveBroadcastDetails: {
              isLiveNow: !ended,
              ...(ended ? { endTimestamp: new Date().toISOString() } : {})
            }
          }
        }
      }
      const initialData = {
        contents: {
          videoViewCountRenderer: {
            viewCount: { runs: [{ text: String(watching) }, { text: ' watching now' }] },
            isLive: true
          }
        }
      }
      await route.fulfill({
        contentType: 'text/html',
        body:
        `<script>var ytInitialPlayerResponse = ${JSON.stringify(player)}; var ytInitialData = ${JSON.stringify(initialData)};</script>`
      })
    })
    await goTo(page, 'subscriptions')
    await expect(page.getByText('Upcoming premiere video')).toHaveCount(0)
    await page.clock.fastForward(61_000)
    await page.clock.runFor(200)

    const premiere = page.locator('.ft-list-video').filter({ hasText: 'Upcoming premiere video' })
    await expect(premiere.locator('.viewCount')).toContainText('2.5k watching')
    failRequests = true
    // Both polls must finish before advancing to the next interval. The existing
    // view count alone cannot show whether the failed requests have settled.
    const failedResponses = Promise.all(['aaaaaaaaaa3', 'aaaaaaaaaa4'].map(videoId =>
      page.waitForResponse(response =>
        response.url() === `https://www.youtube.com/watch?v=${videoId}` && response.status() === 503
      ).then(response => response.finished())
    ))
    await page.clock.fastForward(61_000)
    await failedResponses
    await page.clock.runFor(200)
    await expect(premiere.locator('.viewCount')).toContainText('2.5k watching')
    await expect(premiere.locator('.videoDuration')).toHaveText('Premiere')
    failRequests = false
    watching = 3700
    await page.clock.fastForward(61_000)
    await page.clock.runFor(200)
    await expect(premiere.locator('.viewCount')).toContainText('3.7k watching')

    await goTo(page, 'trending')
    const inactiveRequestCount = requests.length
    await page.clock.fastForward(121_000)
    expect(requests).toHaveLength(inactiveRequestCount)
    await goTo(page, 'subscriptions')

    ended = true
    await page.clock.fastForward(61_000)
    await page.clock.runFor(200)
    await expect(premiere.locator('.videoDuration')).toHaveText('11:42')
    await expect(premiere.locator('.viewCount')).toContainText('9k views')

    const completedRequestCount = requests.length
    await page.clock.fastForward(121_000)
    expect(requests).toHaveLength(completedRequestCount)
    expect(requests).not.toContain('aaaaaaaaaa1')
    expect(requests).not.toContain('bbbbbbbbbb1')
  })

  test('an open video menu does not lift feed content over the sticky header', async ({ page }) => {
    await goTo(page, 'subscriptions')

    const video = page.locator('.ft-list-video').first()
    await expect(video).toBeVisible()
    await video.hover()
    await video.locator('.title').click({ button: 'right' })
    await expect(page.locator('.contextMenu')).toBeVisible()

    const headerCoversVideo = await page.evaluate(() => {
      const header = document.querySelector('.subscriptionsHeader')
      const video = document.querySelector('.ft-list-video')
      const initialHeaderRect = header.getBoundingClientRect()
      const initialVideoRect = video.getBoundingClientRect()
      window.scrollBy(0, initialVideoRect.top - initialHeaderRect.top + 20)

      const headerRect = header.getBoundingClientRect()
      const thumbnailRect = video.querySelector('.videoThumbnail').getBoundingClientRect()
      const elementAtHeader = document.elementFromPoint(
        thumbnailRect.left + thumbnailRect.width / 2,
        headerRect.bottom - 5
      )
      return header.contains(elementAtHeader)
    })

    expect(headerCoversVideo).toBe(true)
  })

  test('does not offer to mark a running premiere as watched', async ({ page }) => {
    await goTo(page, 'subscriptions')

    const runningPremiere = page.locator('.ft-list-video').filter({ hasText: 'Running premiere video' })
    await runningPremiere.hover()
    await runningPremiere.locator('.title').click({ button: 'right' })

    await expect(page.getByRole('menuitem', { name: 'Mark As Watched' })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: 'Unmark As Watched' })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: 'Add to Queue' })).toBeVisible()
  })

  test('shows when the feed was last updated without being held back by a stale channel', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await expect(page.getByText('Video B newest')).toBeVisible()

    // Cache timestamps must survive the IPC round trip as dates (7ad96d185).
    // The displayed value is the latest per-channel timestamp (1 hour ago).
    for (const tab of ['videos', 'shorts', 'live', 'posts']) {
      await page.locator(`[data-subscription-feed-tab="${tab}"]`).click()

      const lastRefresh = page.locator('.headerRefreshWidget .lastRefreshTimestamp')
      await expect(lastRefresh).toBeVisible()
      await expect(lastRefresh).toContainText('1 hour ago')
    }
  })

  test('updates relative timestamps without reloading the page', async ({ page }) => {
    // Install the clock before mounting the feed so its shared interval is controlled.
    await goTo(page, 'trending')
    await page.clock.install({ time: now })
    await goTo(page, 'subscriptions')

    const newestVideo = page.locator('.ft-list-video').filter({ hasText: 'Video B newest' })
    await expect(newestVideo.locator('.uploadedTime')).toHaveText('30 minutes ago')

    await page.clock.fastForward(31 * 60_000)

    await expect(newestVideo.locator('.uploadedTime')).toHaveText('1 hour ago')
  })
})

test.describe('subscriptions feed with a partially cached profile', () => {
  test.use({
    seed: {
      ...seed,
      subscriptionCache: [seed.subscriptionCache[0]]
    }
  })

  test('keeps cached videos visible when automatic fetching is disabled', async ({ page }) => {
    await goTo(page, 'subscriptions')

    await expect(page.getByText('Video A newer')).toBeVisible()
    await expect(page.getByText('Video A older')).toBeVisible()
    await expect(page.getByText('Video B newest')).toHaveCount(0)
  })
})

test.describe('relative timestamp updates disabled', () => {
  test.use({
    seed: {
      ...seed,
      settings: {
        ...seed.settings,
        updateRelativeTimestamps: false
      }
    }
  })

  test('keeps relative timestamps fixed until the page is revisited', async ({ page }) => {
    await goTo(page, 'trending')
    await page.clock.install({ time: now })
    await goTo(page, 'subscriptions')

    const newestVideo = page.locator('.ft-list-video').filter({ hasText: 'Video B newest' })
    await expect(newestVideo.locator('.uploadedTime')).toHaveText('30 minutes ago')

    await page.clock.fastForward(31 * 60_000)
    await expect(newestVideo.locator('.uploadedTime')).toHaveText('30 minutes ago')

    await goTo(page, 'trending')
    await goTo(page, 'subscriptions')
    await expect(newestVideo.locator('.uploadedTime')).toHaveText('1 hour ago')
  })

  test('uses the current time when a reused card receives new data', async ({ page }) => {
    await goTo(page, 'trending')
    await page.clock.install({ time: now })
    await goTo(page, 'subscriptions')

    const newestVideo = page.locator('.ft-list-video').filter({ hasText: 'Video B newest' })
    await expect(newestVideo).toBeVisible()
    await newestVideo.evaluate(element => { element.dataset.reuseMarker = 'relative-time' })

    await page.clock.fastForward(2 * HOUR)
    await page.evaluate(async ({ channelId, published }) => {
      const app = document.querySelector('#app').__vue_app__
      const store = app.config.globalProperties.$store
      const videos = store.getters.getVideoCache[channelId].videos.map(video => ({
        ...video,
        published
      }))

      await store.dispatch('updateSubscriptionVideosCacheByChannel', { channelId, videos })
      window.dispatchEvent(new CustomEvent('opentubex-subscription-refresh-channel', {
        detail: { tab: 'videos' }
      }))
    }, { channelId: CHANNEL_B, published: now + 1.5 * HOUR })

    await expect(page.locator('[data-reuse-marker="relative-time"]')).toBeVisible()
    await expect(newestVideo.locator('.uploadedTime')).toHaveText('30 minutes ago')
  })
})

test.describe('subscriptions feed with upcoming premieres shown', () => {
  test.use({
    seed: {
      ...seed,
      settings: { ...seed.settings, hideUpcomingPremieres: false }
    }
  })

  test('does not offer to mark an upcoming premiere as watched', async ({ page }) => {
    await goTo(page, 'subscriptions')

    const upcomingPremiere = page.locator('.ft-list-video').filter({ hasText: 'Upcoming premiere video' })
    await expect(upcomingPremiere).toBeVisible()
    await upcomingPremiere.hover()
    await upcomingPremiere.locator('.title').click({ button: 'right' })

    await expect(page.getByRole('menuitem', { name: 'Mark As Watched' })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: 'Unmark As Watched' })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: 'Add to Queue' })).toBeVisible()
  })

  test.describe('with date and time formats independent of the app language', () => {
    test.use({
      seed: {
        ...seed,
        settings: {
          ...seed.settings,
          currentLocale: 'en-US',
          dateFormat: 'DD.MM.YYYY',
          timeFormat: '24-hour',
          hideUpcomingPremieres: false,
        },
      },
    })

    test('formats an upcoming premiere with the selected date and clock formats', async ({ page }) => {
      await goTo(page, 'subscriptions')

      const premiereDate = new Date(now + 30 * 24 * HOUR)
      const numericParts = Object.fromEntries(
        new Intl.DateTimeFormat('en-US', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).formatToParts(premiereDate).map(part => [part.type, part.value])
      )
      const time = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).format(premiereDate)
      const upcomingPremiere = page.locator('.ft-list-video').filter({ hasText: 'Upcoming premiere video' })

      await expect(upcomingPremiere.locator('.uploadedTime')).toHaveText(
        `${numericParts.day}.${numericParts.month}.${numericParts.year}, ${time}`
      )
    })
  })

  test('uses the main text color for an upcoming premiere title', async ({ page }) => {
    await goTo(page, 'subscriptions')

    const upcomingPremiere = page.locator('.ft-list-video').filter({ hasText: 'Upcoming premiere video' })
    const title = upcomingPremiere.getByText('Upcoming premiere video', { exact: true })
    await expect(title).toBeVisible()
    await page.locator('body').evaluate(element => {
      element.style.setProperty('--primary-text-color', '#123456')
      element.style.setProperty('--tertiary-text-color', '#654321')
    })
    await expect(title).toHaveCSS('color', 'rgb(18, 52, 86)')
  })

  test('toggles a reminder from the rightmost thumbnail action', async ({ app }) => {
    await app.electronApp.evaluate(({ Notification }) => {
      Notification.isSupported = () => true
    })

    const page = app.page
    await goTo(page, 'subscriptions')

    const upcomingPremiere = page.locator('.ft-list-video').filter({ hasText: 'Upcoming premiere video' })
    const reminderButton = upcomingPremiere.getByRole('button', { name: 'Notify me' })
    await expect(reminderButton).toBeVisible()
    await expect(reminderButton).toHaveAttribute('aria-pressed', 'false')

    const isRightmost = await reminderButton.evaluate(button => {
      const actions = button.closest('.playlistIcons')
      return Math.abs(button.getBoundingClientRect().right - actions.getBoundingClientRect().right) < 1
    })
    expect(isRightmost).toBe(true)

    await reminderButton.click()
    await expect(upcomingPremiere.getByRole('button', { name: 'Notification on' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  test('updates a reused upcoming card when refreshed premiere state changes', async ({ page }) => {
    await goTo(page, 'subscriptions')

    const upcomingPremiere = page.locator('.ft-list-video').filter({ hasText: 'Upcoming premiere video' })
    await expect(upcomingPremiere.locator('.videoDuration')).toHaveText('Premiere')
    await expect(upcomingPremiere.getByRole('button', { name: 'Notify me' })).toBeVisible()
    await upcomingPremiere.evaluate(element => { element.dataset.reuseMarker = 'upcoming-premiere' })
    const reusedCard = page.locator('[data-reuse-marker="upcoming-premiere"]')

    const updateCachedPremiere = async (updates) => {
      await page.evaluate(async ({ channelId, updates }) => {
        const app = document.querySelector('#app').__vue_app__
        const store = app.config.globalProperties.$store
        const videos = store.getters.getVideoCache[channelId].videos.map(video => {
          if (video.videoId !== 'aaaaaaaaaa3') return video

          const updatedVideo = { ...video, ...updates }
          delete updatedVideo.premiereDate
          return updatedVideo
        })

        await store.dispatch('updateSubscriptionVideosCacheByChannel', { channelId, videos })
        window.dispatchEvent(new CustomEvent('opentubex-subscription-refresh-channel', {
          detail: { tab: 'videos' }
        }))
      }, { channelId: CHANNEL_A, updates })
    }

    await updateCachedPremiere({
      isUpcoming: false,
      isPremiere: true,
      liveNow: true,
      lengthSeconds: ''
    })

    await expect(reusedCard).toBeVisible()
    await expect(upcomingPremiere.locator('.videoDuration')).toHaveText('Premiere')
    await expect(upcomingPremiere.getByRole('button', { name: /Notify me|Notification on/ })).toHaveCount(0)

    await updateCachedPremiere({
      isPremiere: false,
      liveNow: false,
      lengthSeconds: 702
    })

    await expect(reusedCard).toBeVisible()
    await expect(upcomingPremiere.locator('.videoDuration')).toHaveText('11:42')
  })

  test('cleans up repeated live-reminder subscriptions independently', async ({ app, page }) => {
    await page.evaluate(() => {
      window.liveReminderUpdates = 0
      const handler = () => { window.liveReminderUpdates++ }
      window.removeFirstLiveReminderSubscription = window.ftElectron.liveReminder.onUpdated(handler)
      window.removeSecondLiveReminderSubscription = window.ftElectron.liveReminder.onUpdated(handler)
    })

    const sendUpdate = () => app.electronApp.evaluate(({ BrowserWindow }, channel) => {
      BrowserWindow.getAllWindows()[0].webContents.send(channel, 'video-id', true)
    }, IpcChannels.LIVE_REMINDER_UPDATED)

    await sendUpdate()
    await expect.poll(() => page.evaluate(() => window.liveReminderUpdates)).toBe(2)

    await page.evaluate(() => window.removeFirstLiveReminderSubscription())
    await sendUpdate()
    await expect.poll(() => page.evaluate(() => window.liveReminderUpdates)).toBe(3)

    await page.evaluate(() => window.removeSecondLiveReminderSubscription())
    await sendUpdate()
    await expect.poll(() => page.evaluate(() => window.liveReminderUpdates)).toBe(3)
  })

  test('does not render adjacent separators in the upcoming-video menu', async ({ page }) => {
    await goTo(page, 'subscriptions')

    const upcomingPremiere = page.locator('.ft-list-video').filter({ hasText: 'Upcoming premiere video' })
    await upcomingPremiere.locator('.title').click({ button: 'right' })
    const menu = page.locator('.contextMenu')
    await expect(menu).toBeVisible()
    await expect(menu.locator('.separator + .separator')).toHaveCount(0)
  })
})
