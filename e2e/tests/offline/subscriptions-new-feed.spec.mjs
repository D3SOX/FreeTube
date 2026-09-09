import { test, expect, goTo } from '../../helpers/app.mjs'
import { encryptSyncDocument, decryptSyncDocument } from '../../../src/renderer/helpers/sync-server-privacy.js'

const now = Date.now()
const HOUR = 3600000
const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const AUTHOR_THUMBNAIL = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="55" height="55"/>'

function video (videoId, title, published, extra = {}) {
  return {
    videoId,
    title,
    author: 'Channel A',
    authorId: CHANNEL_ID,
    published,
    viewCount: 1000,
    lengthSeconds: 120,
    liveNow: false,
    isUpcoming: false,
    type: 'video',
    ...extra
  }
}

function post (postId, text, publishedTime) {
  return {
    postId,
    postText: text,
    author: 'Channel A',
    authorId: CHANNEL_ID,
    authorThumbnails: [{ url: AUTHOR_THUMBNAIL, width: 55, height: 55 }],
    publishedTime,
    voteCount: 1,
    commentCount: 0,
    postContent: { type: 'text', content: '' },
    type: 'community',
    isNewInSubscriptionFeed: true
  }
}

function profile (subscriptions = [{ id: CHANNEL_ID, name: 'Channel A', thumbnail: '' }]) {
  return {
    _id: 'allChannels',
    name: 'All Channels',
    bgColor: '#000000',
    textColor: '#FFFFFF',
    subscriptions
  }
}

const newVideo = video('new-video-1', 'New video', now - HOUR, { isNewInSubscriptionFeed: true })
const watchedVideo = video('watched-new', 'Watched new video', now - 2 * HOUR, { isNewInSubscriptionFeed: true })
const oldVideo = video('not-new', 'Previously seen video', now - 3 * HOUR, { isNewInSubscriptionFeed: false })
const newShort = video('new-short-1', 'New short', now - 30 * 60000, {
  isNewInSubscriptionFeed: true,
  thumbnailUrl: 'https://i.ytimg.com/vi/new-short-1/hq720_2.jpg?sqp=selected&rs=signature'
})
const newLive = video('new-live-1', 'New live stream', now - 15 * 60000, {
  isNewInSubscriptionFeed: true,
  liveNow: true
})

const populatedCache = [{
  _id: CHANNEL_ID,
  videos: [newVideo, watchedVideo, oldVideo],
  videosTimestamp: new Date(now - HOUR).toISOString(),
  shorts: [newShort],
  shortsTimestamp: new Date(now - HOUR).toISOString(),
  liveStreams: [newVideo, newLive],
  liveStreamsTimestamp: new Date(now - HOUR).toISOString(),
  communityPosts: [post('new-post-1', 'New community post', now - 45 * 60000)],
  communityPostsTimestamp: new Date(now - HOUR).toISOString()
}]

const cacheWithoutNewContent = [{
  _id: CHANNEL_ID,
  videos: [oldVideo],
  videosTimestamp: new Date(now - HOUR).toISOString(),
  shorts: [],
  shortsTimestamp: new Date(now - HOUR).toISOString(),
  liveStreams: [],
  liveStreamsTimestamp: new Date(now - HOUR).toISOString(),
  communityPosts: [],
  communityPostsTimestamp: new Date(now - HOUR).toISOString()
}]

const watchedHistory = [{
  _id: watchedVideo.videoId,
  ...watchedVideo,
  description: '',
  watchProgress: watchedVideo.lengthSeconds,
  timeWatched: now,
  isWatched: true,
  isLive: false
}]

const commonSettings = {
  fetchSubscriptionsAutomatically: false,
  hideSubscriptionsVideos: false,
  hideSubscriptionsShorts: false,
  hideSubscriptionsLive: false,
  hideSubscriptionsCommunity: false,
  showNewSubscriptionFeed: true,
  useRssFeeds: false
}

test.describe('new subscriptions feed', () => {
  test.use({
    seed: {
      settings: {
        ...commonSettings,
        listType: 'grid',
        showNewSubscriptionFeedIndicators: true,
        thumbnailSize: 180
      },
      profiles: [profile()],
      history: watchedHistory,
      subscriptionCache: populatedCache
    }
  })

  test('groups new content by feed category', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()

    await expect(page.getByRole('heading', { name: 'Videos', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Shorts', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Live', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible()
    await expect(page.getByText('New video', { exact: true })).toHaveCount(1)
    await expect(page.getByText('New short', { exact: true })).toBeVisible()
    await expect(page.getByText('New live stream', { exact: true })).toBeVisible()
    await expect(page.getByText('New community post', { exact: true })).toBeVisible()
    await expect(page.getByText('Watched new video', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Previously seen video', { exact: true })).toHaveCount(0)

    await expect(page.locator('.ft-list-video').filter({ hasText: 'New video' })).toHaveClass(/grid/)
    await expect(page.locator('.ft-list-video').filter({ hasText: 'New short' })).toHaveClass(/youtubeShort/)
    await expect(page.locator('.ft-list-video').filter({ hasText: 'New live stream' })).not.toHaveClass(/youtubeShort/)
    await expect(page.locator('.ft-list-post').filter({ hasText: 'New community post' })).toHaveClass(/list/)
    await expect(page.locator('.newContentDot')).toHaveCount(0)
    await expect(page.locator('.headerRefreshWidget .lastRefreshTimestamp')).toHaveCount(0)
  })

  test('switches between the combined and tabbed views and remembers the choice', async ({ app, page, attachScreenshot }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()

    const showTabbedView = page.getByRole('button', { name: 'Show tabbed view' })
    await expect(showTabbedView).toHaveAttribute('aria-pressed', 'false')
    await expect(showTabbedView.locator('[data-icon="horizontal-tabs"]')).toBeVisible()
    await showTabbedView.click()

    const newContentTabs = page.getByRole('tablist', { name: 'New content tabs' })
    const newContentTabsIndicator = newContentTabs.locator('.newFeedTabsIndicator')
    await expect(newContentTabs).toBeVisible()
    await expect(newContentTabsIndicator).toBeVisible()
    await expect(page.getByRole('button', { name: 'Show combined view' })).toHaveAttribute('aria-pressed', 'true')
    await expect(newContentTabs.locator('[data-new-feed-tab="videos"]')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('New video', { exact: true })).toBeVisible()
    await expect(page.getByText('New short', { exact: true })).toHaveCount(0)

    const centerDifference = await page.evaluate(() => {
      const header = document.querySelector('.subscriptionsHeader').getBoundingClientRect()
      const tabs = [...document.querySelectorAll('[data-new-feed-tab]')]
        .map(tab => tab.getBoundingClientRect())

      return Math.abs(
        (tabs[0].left + tabs.at(-1).right) / 2 -
        (header.left + header.right) / 2
      )
    })
    expect(centerDifference).toBeLessThanOrEqual(1)
    await attachScreenshot('tabbed New feed')

    const shortsTab = newContentTabs.locator('[data-new-feed-tab="shorts"]')
    await shortsTab.click()
    await expect(shortsTab).toHaveAttribute('aria-selected', 'true')
    await expect(newContentTabsIndicator).toHaveCSS('transition-property', 'transform')
    await expect(page.getByText('New short', { exact: true })).toBeVisible()
    await expect(page.getByText('New video', { exact: true })).toHaveCount(0)

    await page.waitForTimeout(400)
    const indicatorAlignment = await page.evaluate(() => {
      const indicator = document.querySelector('.newFeedTabsIndicator').getBoundingClientRect()
      const tab = document.querySelector('[data-new-feed-tab="shorts"]').getBoundingClientRect()

      return {
        x: Math.abs(indicator.x - tab.x),
        width: Math.abs(indicator.width - tab.width),
        top: Math.abs(indicator.top - tab.bottom)
      }
    })
    expect(indicatorAlignment.x).toBeLessThan(2)
    expect(indicatorAlignment.width).toBeLessThan(2)
    expect(indicatorAlignment.top).toBeLessThan(2)

    await shortsTab.focus()
    await shortsTab.press('ArrowRight')
    await expect(newContentTabs.locator('[data-new-feed-tab="live"]')).toBeFocused()
    await expect(page.getByText('New live stream', { exact: true })).toBeVisible()

    const liveTab = newContentTabs.locator('[data-new-feed-tab="live"]')
    const altArrowWasNotPrevented = await liveTab.evaluate(element => {
      return element.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        altKey: true,
        bubbles: true,
        cancelable: true
      }))
    })
    expect(altArrowWasNotPrevented).toBe(true)
    await expect(liveTab).toHaveAttribute('aria-selected', 'true')
    await expect(liveTab).toBeFocused()

    await newContentTabs.locator('[data-new-feed-tab="posts"]').click()
    await expect(page.getByText('New community post', { exact: true })).toBeVisible()

    const relaunched = await app.relaunch()
    await goTo(relaunched.page, 'subscriptions')
    await relaunched.page.locator('[data-subscription-feed-tab="all"]').click()

    const relaunchedTabs = relaunched.page.getByRole('tablist', { name: 'New content tabs' })
    await expect(relaunchedTabs).toBeVisible()
    await expect(relaunchedTabs.locator('[data-new-feed-tab="posts"]')).toHaveAttribute('aria-selected', 'true')
    await expect(relaunched.page.getByText('New community post', { exact: true })).toBeVisible()

    await relaunched.page.getByRole('button', { name: 'Show combined view' }).click()
    await expect(relaunchedTabs).toHaveCount(0)
    await expect(relaunched.page.getByRole('heading', { name: 'Videos', exact: true })).toBeVisible()
    await expect(relaunched.page.getByRole('heading', { name: 'Shorts', exact: true })).toBeVisible()
    await expect(relaunched.page.getByRole('heading', { name: 'Live', exact: true })).toBeVisible()
    await expect(relaunched.page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible()
  })

  test('marks only the active category as seen in the tabbed New feed', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()
    await page.getByRole('button', { name: 'Show tabbed view' }).click()

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      window.__markSeenMutations = []
      window.__unsubscribeMarkSeen = store.subscribe((mutation) => {
        if (mutation.type === 'markSubscriptionEntriesAsSeenInCache') {
          window.__markSeenMutations.push(mutation.payload)
        }
      })
    })

    await page.getByRole('button', { name: 'Mark all as seen' }).click()

    await expect(page.getByText('New video', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Mark all as seen' })).toHaveCount(0)
    await page.locator('[data-new-feed-tab="shorts"]').click()
    await expect(page.getByText('New short', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark all as seen' })).toBeVisible()
    expect(await page.evaluate(() => {
      window.__unsubscribeMarkSeen()
      return window.__markSeenMutations
    })).toEqual([[
      { tab: 'videos', channelId: CHANNEL_ID, timestamp: expect.any(Date) }
    ]])
  })

  test('shows category dots and marks an inactive category as seen from its context menu', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()
    await page.getByRole('button', { name: 'Show tabbed view' }).click()

    const tabs = page.getByRole('tablist', { name: 'New content tabs' })
    const videosTab = tabs.locator('[data-new-feed-tab="videos"]')
    const shortsTab = tabs.locator('[data-new-feed-tab="shorts"]')
    const liveTab = tabs.locator('[data-new-feed-tab="live"]')
    const postsTab = tabs.locator('[data-new-feed-tab="posts"]')

    await expect(videosTab.locator('.newContentDot')).toBeVisible()
    await expect(shortsTab.locator('.newContentDot')).toBeVisible()
    await expect(liveTab.locator('.newContentDot')).toBeVisible()
    await expect(postsTab.locator('.newContentDot')).toBeVisible()
    await expect(videosTab).toHaveAttribute('aria-selected', 'true')

    await shortsTab.click({ button: 'right' })
    const menu = page.getByRole('menu', { name: 'Context menu' })
    const markAllAsSeen = menu.getByRole('menuitem', { name: 'Mark all as seen' })
    await expect(markAllAsSeen.locator('[data-prefix="fas"][data-icon="check"]')).toBeVisible()
    await markAllAsSeen.click()

    await expect(videosTab).toHaveAttribute('aria-selected', 'true')
    await expect(shortsTab.locator('.newContentDot')).toHaveCount(0)
    await expect(videosTab.locator('.newContentDot')).toBeVisible()
    await expect(liveTab.locator('.newContentDot')).toBeVisible()
    await expect(postsTab.locator('.newContentDot')).toBeVisible()

    await shortsTab.click()
    await expect(page.getByText('There is no new content.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark all as seen' })).toHaveCount(0)

    await shortsTab.click({ button: 'right' })
    await expect(menu.getByRole('menuitem', { name: 'Mark all as seen' })).toHaveCount(0)
  })

  test('the mobile feed menu marks an inactive new category as seen', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()
    await page.getByRole('button', { name: 'Show tabbed view' }).click()
    const videos = page.locator('[data-new-feed-tab="videos"]')
    const shorts = page.locator('[data-new-feed-tab="shorts"]')
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
    const bounds = await shorts.boundingBox()
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }]
    })
    const menu = page.locator('.mobileLinkActions')
    await expect(menu).toBeVisible()
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(menu.getByRole('menuitem', { name: 'Reload Shorts', exact: true })).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Mark all as seen', exact: true }).click()
    await expect(menu).toHaveCount(0)
    await expect(videos).toHaveAttribute('aria-selected', 'true')
    await expect(videos.locator('.newContentDot')).toBeVisible()
    await expect(shorts.locator('.newContentDot')).toHaveCount(0)
    await shorts.evaluate(element => element.dispatchEvent(new PointerEvent('contextmenu', {
      bubbles: true, cancelable: true, pointerType: 'touch'
    })))
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Mark all as seen', exact: true })).toHaveCount(0)
    await session.detach()
  })

  test('shows Shorts as portrait cards with their duration and upload time', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="shorts"]').click()

    const short = page.locator('.ft-list-video.youtubeShort').filter({ hasText: 'New short' })
    await expect(short).toBeVisible()
    await expect(short.locator('.videoDuration')).toHaveText('2:00')
    await expect(short.locator('.uploadedTime')).not.toBeEmpty()
    await expect(short.locator('.thumbnailImage')).toHaveAttribute('src', newShort.thumbnailUrl)

    const aspectRatio = await short.locator('.thumbnailImage').evaluate(element => {
      return getComputedStyle(element).aspectRatio
    })
    expect(aspectRatio).toBe('2 / 3')

    // This suite seeds the largest thumbnail preference. The portrait grid
    // must honor it instead of falling back to its old fixed card width.
    const cardWidth = await short.evaluate(element => element.getBoundingClientRect().width)
    expect(cardWidth).toBeGreaterThanOrEqual(342)
  })

  test('keeps a new video and its menus open until the video is chosen', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()

    const video = page.locator('.ft-list-video').filter({
      has: page.getByRole('heading', { name: 'New video', exact: true })
    })
    await video.locator('.thumbnailLink').click({ button: 'right' })

    await expect(page.getByRole('menu', { name: 'Context menu' })).toBeVisible()
    await expect(video).toBeVisible()
    // The broken behavior removed the card after its 200 ms leave transition.
    await page.waitForTimeout(300)
    await expect(page.getByRole('menu', { name: 'Context menu' })).toBeVisible()
    await expect(video).toBeVisible()

    await page.keyboard.press('Escape')
    await video.hover()
    await video.locator('.optionsButton').click()

    await expect(video.locator('.optionsButton .iconDropdown')).toBeVisible()
    await expect(video).toBeVisible()
  })

  test('marks a dotted video as seen from its options menu', async ({ page }) => {
    await goTo(page, 'subscriptions')

    const video = page.locator('.ft-list-video').filter({
      has: page.getByText('New video', { exact: true })
    })
    const markAllAsSeen = page.getByRole('button', { name: 'Mark all as seen' })
    await expect(video.locator('.newContentDot')).toBeVisible()
    await expect(markAllAsSeen).toBeVisible()

    await video.hover()
    await video.locator('.optionsButton').click()
    await page.getByRole('option', { name: 'Mark as seen' }).click()

    await expect(video).toBeVisible()
    await expect(video.locator('.newContentDot')).toHaveCount(0)
    await expect(video).not.toHaveClass(/watched/)
    await expect(markAllAsSeen).toHaveCount(0)

    await video.hover()
    await video.locator('.optionsButton').click()
    await expect(page.getByRole('option', { name: 'Mark as seen' })).toHaveCount(0)
  })

  test('marks a dotted post as seen from its options menu and persists after restart', async ({ app, page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="posts"]').click()

    const post = page.locator('.ft-list-post').filter({ hasText: 'New community post' })
    await expect(post.locator('.newContentDot')).toBeVisible()
    await post.getByRole('button', { name: /^More options$/i }).click()
    await page.getByRole('option', { name: 'Mark as seen', exact: true }).click()

    await expect(post).toBeVisible()
    await expect(post.locator('.newContentDot')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Mark all as seen' })).toHaveCount(0)

    await post.getByRole('button', { name: /^More options$/i }).click()
    await expect(page.getByRole('option', { name: 'Mark as seen', exact: true })).toHaveCount(0)
    await expect(page.getByRole('option', { name: 'Never show Posts from this channel in feeds again' })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.locator('[data-subscription-feed-tab="all"]').click()
    await expect(post).toHaveCount(0)
    await expect(page.getByText('New video', { exact: true })).toBeVisible()

    const relaunched = await app.relaunch()
    await goTo(relaunched.page, 'subscriptions')
    await relaunched.page.locator('[data-subscription-feed-tab="posts"]').click()
    const seenPost = relaunched.page.locator('.ft-list-post').filter({ hasText: 'New community post' })
    await expect(seenPost).toBeVisible()
    await expect(seenPost.locator('.newContentDot')).toHaveCount(0)
    await seenPost.getByRole('button', { name: /^More options$/i }).click()
    await expect(relaunched.page.getByRole('option', { name: 'Mark as seen', exact: true })).toHaveCount(0)
  })

  test('history sync imports seen videos and keeps them seen after refresh and restart', async ({ app, page }) => {
    const key = Buffer.alloc(32, 1).toString('base64')
    const salt = Buffer.alloc(16, 2).toString('base64')
    const marks = [newVideo, newShort, newLive, { videoId: 'fetched-later' }]
      .map(entry => ({ videoId: entry.videoId, seenAt: now, isMembersOnly: false }))
    const olderMarks = Array.from({ length: 10000 }, (_, index) => ({
      videoId: `older-seen-${index}`, seenAt: now - 10000 + index, isMembersOnly: false,
    }))
    const retainedMarks = [...olderMarks.slice(marks.length), ...marks]
    const remote = {
      history: await encryptSyncDocument([], key, salt),
      seenVideos: await encryptSyncDocument([
        ...olderMarks, ...marks,
        { videoId: watchedVideo.videoId, seenAt: now + 1, isMembersOnly: false },
      ], key, salt),
    }
    const uploads = []
    await page.route('https://seen-sync.example/**', async route => {
      const request = route.request()
      const pathname = new URL(request.url()).pathname
      let body
      if (pathname === '/health') {
        body = { capabilities: { encrypted_sync: 1, seen_videos: 1 } }
      } else if (pathname === '/v1/encrypted_sync') {
        body = { collections: [], legacy_data: false, legacy_encrypted_data: false }
      } else {
        const collection = pathname.split('/').at(-1)
        expect(Object.hasOwn(remote, collection)).toBe(true)
        if (request.method() === 'PUT') {
          uploads.push(collection)
          remote[collection] = request.postDataJSON().payload
        }
        body = { revision: 1, payload: remote[collection] }
      }
      await route.fulfill({ json: body })
    })

    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()
    await expect(page.getByText('New video', { exact: true })).toBeVisible()

    const result = await page.evaluate(async ({ key, salt }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const settings = {
        SyncServerEnabled: true,
        SyncServerUrl: 'https://seen-sync.example',
        SyncServerToken: 'test-token',
        SyncServerPrivacyMode: 'enhanced',
        SyncServerPrivacyKey: key,
        SyncServerPrivacySalt: salt,
        SyncServerAutoSync: false,
        SyncServerSyncHistory: true,
        SyncServerSyncSubscriptions: false,
        SyncServerSyncPlaylists: false,
        SyncServerSyncProfiles: false,
        SyncServerSyncSettings: false,
        SyncServerSyncSessions: false,
      }
      for (const [setting, value] of Object.entries(settings)) store.commit(`set${setting}`, value)
      const historyBefore = JSON.stringify(store.getters.getHistoryCacheSorted)
      await store.dispatch('syncWithSyncServer')
      return {
        status: store.state.syncServer.syncServerStatus,
        error: store.state.syncServer.syncServerError,
        historyUnchanged: historyBefore === JSON.stringify(store.getters.getHistoryCacheSorted),
      }
    }, { key, salt })
    expect(result).toEqual({ status: 'success', error: '', historyUnchanged: true })
    await expect(page.getByText('New video', { exact: true })).toHaveCount(0)
    await expect(page.getByText('New short', { exact: true })).toHaveCount(0)
    await expect(page.getByText('New live stream', { exact: true })).toHaveCount(0)
    await expect(page.getByText('New community post', { exact: true })).toBeVisible()

    await page.evaluate(async ({ channelId, videos }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateSubscriptionVideosCacheByChannel', { channelId, videos, timestamp: new Date() })
    }, {
      channelId: CHANNEL_ID,
      videos: [
        video('fetched-later', 'Fetched after sync', now, { isNewInSubscriptionFeed: true }),
        video('fetched-unseen', 'Fetched unseen video', now, { isNewInSubscriptionFeed: true })
      ]
    })
    await expect(page.getByText('Fetched unseen video', { exact: true })).toBeVisible()
    await expect(page.getByText('Fetched after sync', { exact: true })).toHaveCount(0)
    expect(uploads).toContain('history')
    expect(uploads).toContain('seenVideos')
    expect((await decryptSyncDocument(remote.seenVideos, key)).map(entry => entry.videoId).sort())
      .toEqual(retainedMarks.map(entry => entry.videoId).sort())

    const relaunched = await app.relaunch()
    await goTo(relaunched.page, 'subscriptions')
    await relaunched.page.locator('[data-subscription-feed-tab="all"]').click()
    await expect(relaunched.page.getByText('New community post', { exact: true })).toBeVisible()
    await expect(relaunched.page.getByText('Fetched unseen video', { exact: true })).toBeVisible()
    await expect(relaunched.page.getByText('Fetched after sync', { exact: true })).toHaveCount(0)
    expect(await relaunched.page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return JSON.parse(store.getters.getSubscriptionSeenVideos).length
    })).toBe(10000)
  })
})

for (const uiScale of [100, 125]) {
  test.describe(`community post author at ${uiScale}% UI scale`, () => {
    test.use({
      seed: {
        settings: {
          ...commonSettings,
          uiScale
        },
        profiles: [profile()],
        subscriptionCache: populatedCache
      }
    })

    test('centers the channel name and relative time on the avatar', async ({ page }) => {
      await goTo(page, 'subscriptions')
      await page.locator('[data-subscription-feed-tab="posts"]').click()

      const post = page.locator('.ft-list-post').filter({ hasText: 'New community post' })
      await expect(post).toBeVisible()

      const centers = await post.evaluate(element => {
        const verticalCenter = selector => {
          const rect = element.querySelector(selector).getBoundingClientRect()
          return (rect.top + rect.bottom) / 2
        }

        return {
          avatar: verticalCenter('.communityThumbnail'),
          author: verticalCenter('.authorName'),
          published: verticalCenter('.publishedText')
        }
      })

      expect(Math.abs(centers.author - centers.avatar)).toBeLessThanOrEqual(1)
      expect(Math.abs(centers.published - centers.avatar)).toBeLessThanOrEqual(1)
    })
  })

  test.describe(`new subscriptions feed empty state at ${uiScale}% UI scale`, () => {
    test.use({
      seed: {
        settings: {
          ...commonSettings,
          uiScale
        },
        profiles: [profile()],
        subscriptionCache: cacheWithoutNewContent
      }
    })

    test('uses matching space above and below the message', async ({ page, attachScreenshot }) => {
      await goTo(page, 'subscriptions')
      await page.locator('[data-subscription-feed-tab="all"]').click()

      const message = page.getByText('There is no new content.', { exact: true })
      await expect(message).toBeVisible()

      const spacing = await message.evaluate(element => {
        const card = element.closest('.card').getBoundingClientRect()
        const header = element.closest('.card').querySelector('.subscriptionsHeader').getBoundingClientRect()
        const message = element.getBoundingClientRect()

        return {
          top: message.top - header.bottom,
          bottom: card.bottom - message.bottom
        }
      })

      expect(spacing.top).toBeGreaterThanOrEqual(15)
      expect(spacing.top).toBeLessThanOrEqual(17)
      expect(Math.abs(spacing.top - spacing.bottom)).toBeLessThanOrEqual(1)
      await attachScreenshot(`empty New feed at ${uiScale}% UI scale`)
    })
  })
}

test.describe('per-channel subscription feed filters', () => {
  test.use({
    seed: {
      settings: commonSettings,
      profiles: [profile([{
        id: CHANNEL_ID,
        name: 'Channel A',
        thumbnail: '',
        feedTypes: ['videos']
      }])],
      subscriptionCache: populatedCache
    }
  })

  test('hides every disabled cached feed type', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()

    await expect(page.getByText('New video', { exact: true })).toBeVisible()
    await expect(page.getByText('New community post', { exact: true })).toHaveCount(0)
    await expect(page.getByText('New short', { exact: true })).toHaveCount(0)
    await expect(page.getByText('New live stream', { exact: true })).toHaveCount(0)

    await page.locator('[data-subscription-feed-tab="shorts"]').click()
    await expect(page.getByText('New short', { exact: true })).toHaveCount(0)

    await page.locator('[data-subscription-feed-tab="live"]').click()
    await expect(page.getByText('New live stream', { exact: true })).toHaveCount(0)

    await page.locator('[data-subscription-feed-tab="posts"]').click()
    await expect(page.getByText('New community post', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Refresh Posts/ })).toBeDisabled()
  })
})

test.describe('new subscriptions feed sorting', () => {
  const newestVideo = video('sort-newest-video', 'Newest video', now - HOUR, {
    isNewInSubscriptionFeed: true
  })
  const oldestVideo = video('sort-oldest-video', 'Oldest video', now - 3 * HOUR, {
    isNewInSubscriptionFeed: true
  })
  const newestPost = post('sort-newest-post', 'Newest post', now - 2 * HOUR)
  const oldestPost = post('sort-oldest-post', 'Oldest post', now - 4 * HOUR)

  test.use({
    seed: {
      settings: commonSettings,
      profiles: [profile()],
      subscriptionCache: [{
        _id: CHANNEL_ID,
        videos: [oldestVideo, newestVideo],
        videosTimestamp: new Date(now).toISOString(),
        shorts: [],
        shortsTimestamp: new Date(now).toISOString(),
        liveStreams: [],
        liveStreamsTimestamp: new Date(now).toISOString(),
        communityPosts: [oldestPost, newestPost],
        communityPostsTimestamp: new Date(now).toISOString()
      }]
    }
  })

  test('sorts every section oldest first and persists the preference', async ({ app, page }) => {
    const videoTitles = page => page.locator('.newFeed > .autoGrid .ft-list-video').evaluateAll(cards => {
      return cards.map(card => card.querySelector('.title').textContent.trim())
    })
    const postTexts = page => page.locator('.newFeed .postsSection .ft-list-post').evaluateAll(posts => {
      return posts.map(post => post.querySelector('.postText').textContent.trim())
    })

    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()

    await expect.poll(() => videoTitles(page)).toEqual(['Newest video', 'Oldest video'])
    await expect.poll(() => postTexts(page)).toEqual(['Newest post', 'Oldest post'])

    const sortSelect = page.locator('.headerSortSelect').getByRole('combobox')
    await expect(sortSelect).toHaveText('Newest first')
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setNewSubscriptionFeedSortBy', 'unsupported')
    })
    await expect(sortSelect).toHaveText('Newest first')
    await expect.poll(() => videoTitles(page)).toEqual(['Newest video', 'Oldest video'])

    await sortSelect.click()
    await page.getByRole('option', { name: 'Oldest first' }).click()

    await expect(sortSelect).toHaveText('Oldest first')
    await expect.poll(() => videoTitles(page)).toEqual(['Oldest video', 'Newest video'])
    await expect.poll(() => postTexts(page)).toEqual(['Oldest post', 'Newest post'])
    await expect.poll(() => page.evaluate(() => {
      return document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getNewSubscriptionFeedSortBy
    })).toBe('oldest')

    const relaunched = await app.relaunch()
    await goTo(relaunched.page, 'subscriptions')
    await relaunched.page.locator('[data-subscription-feed-tab="all"]').click()

    await expect(relaunched.page.locator('.headerSortSelect').getByRole('combobox')).toHaveText('Oldest first')
    await expect.poll(() => videoTitles(relaunched.page)).toEqual(['Oldest video', 'Newest video'])
    await expect.poll(() => postTexts(relaunched.page)).toEqual(['Oldest post', 'Newest post'])
  })
})

test.describe('new feed settings and seen state', () => {
  const videoPost = {
    ...post('new-post-2', 'New video post', now - 40 * 60000),
    postContent: {
      type: 'video',
      content: video('post-video-1', 'Attached video', now - 40 * 60000)
    }
  }
  const cacheWithVideoPost = [{
    ...populatedCache[0],
    communityPosts: [...populatedCache[0].communityPosts, videoPost]
  }]

  test.use({
    seed: {
      settings: {
        ...commonSettings,
        listType: 'list',
        showNewSubscriptionFeedIndicators: false
      },
      profiles: [profile()],
      subscriptionCache: cacheWithVideoPost
    }
  })

  test('works without dots and persists marking all entries as seen', async ({ app, page }) => {
    await goTo(page, 'subscriptions')
    await expect(page.locator('[data-subscription-feed-tab="all"]')).toBeVisible()
    await expect(page.locator('.newContentDot')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Mark all as seen' })).toHaveCount(0)

    await page.locator('[data-subscription-feed-tab="all"]').click()
    await page.getByRole('button', { name: 'Show tabbed view' }).click()
    await expect(page.getByRole('tablist', { name: 'New content tabs' }).locator('.newContentDot')).toHaveCount(0)
    await page.getByRole('button', { name: 'Show combined view' }).click()
    const newVideoCard = page.locator('.ft-list-video').filter({
      has: page.getByRole('heading', { name: 'New video', exact: true })
    })
    await expect(newVideoCard).toHaveClass(/list/)

    const markAllAsSeen = page.getByRole('button', { name: 'Mark all as seen' })
    await expect(markAllAsSeen).toBeVisible()
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      window.__markSeenMutations = []
      window.__unsubscribeMarkSeen = store.subscribe((mutation) => {
        if (mutation.type === 'markSubscriptionEntriesAsSeenInCache') {
          window.__markSeenMutations.push(mutation.payload)
        }
      })
    })
    await markAllAsSeen.click()
    await expect(page.getByText('There is no new content.')).toBeVisible()
    expect(await page.evaluate(() => {
      window.__unsubscribeMarkSeen()
      return window.__markSeenMutations
    })).toEqual([[
      { tab: 'videos', channelId: CHANNEL_ID, timestamp: expect.any(Date) },
      { tab: 'shorts', channelId: CHANNEL_ID, timestamp: expect.any(Date) },
      { tab: 'live', channelId: CHANNEL_ID, timestamp: expect.any(Date) },
      { tab: 'posts', channelId: CHANNEL_ID, timestamp: expect.any(Date) }
    ]])
    await expect(markAllAsSeen).toHaveCount(0)

    const relaunched = await app.relaunch()
    await goTo(relaunched.page, 'subscriptions')
    await relaunched.page.locator('[data-subscription-feed-tab="all"]').click()
    await expect(relaunched.page.getByText('There is no new content.')).toBeVisible()
  })

  test('marks a video as seen from the New feed even when dots are disabled', async ({ page }) => {
    await goTo(page, 'subscriptions')

    const regularFeedVideo = page.locator('.ft-list-video').filter({
      has: page.getByRole('heading', { name: 'New video', exact: true })
    })
    await regularFeedVideo.hover()
    await regularFeedVideo.locator('.optionsButton').click()
    await expect(page.getByRole('option', { name: 'Mark as seen' })).toHaveCount(0)

    await page.keyboard.press('Escape')
    await page.locator('[data-subscription-feed-tab="all"]').click()

    const newFeedVideo = page.locator('.ft-list-video').filter({
      has: page.getByRole('heading', { name: 'New video', exact: true })
    })
    await newFeedVideo.hover()
    await newFeedVideo.locator('.optionsButton').click()
    await page.getByRole('option', { name: 'Mark as seen' }).click()

    await expect(newFeedVideo).toHaveCount(0)
  })

  test('marks a post as seen from the New feed even when dots are disabled', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="posts"]').click()

    const post = page.locator('.ft-list-post').filter({ hasText: 'New community post' })
    await post.getByRole('button', { name: /^More options$/i }).click()
    await expect(page.getByRole('option', { name: 'Mark as seen', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.locator('[data-subscription-feed-tab="all"]').click()

    await post.getByRole('button', { name: /^More options$/i }).click()
    await page.getByRole('option', { name: 'Mark as seen', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(post).toHaveCount(0)
    await expect(page.getByText('New video post', { exact: true })).toBeVisible()

    await page.locator('[data-subscription-feed-tab="posts"]').click()
    await expect(post).toBeVisible()
    await post.getByRole('button', { name: /^More options$/i }).click()
    await expect(page.getByRole('option', { name: 'Mark as seen', exact: true })).toHaveCount(0)
  })

  test('keeps YouTube-style Shorts as portrait grid cards in list display mode', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="shorts"]').click()

    const short = page.locator('.ft-list-video.youtubeShort').filter({ hasText: 'New short' })
    await expect(short).toBeVisible()
    // The list layout squeezes the portrait card into a row and drops the
    // portrait thumbnail rule, which the grid class must prevent.
    await expect(short).toContainClass('grid')
    await expect(short).not.toContainClass('list')

    const aspectRatio = await short.locator('.thumbnailImage').evaluate(element => {
      return getComputedStyle(element).aspectRatio
    })
    expect(aspectRatio).toBe('2 / 3')
  })

  test('stacks community post sections in list display mode', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="posts"]').click()

    const post = page.locator('.ft-list-post').filter({ hasText: 'New community post' })
    await expect(post).toBeVisible()

    // The video list template placed the author, the text and the bottom
    // section into its three columns instead of stacking them.
    const layout = await post.evaluate(element => {
      const author = element.querySelector('.author-div').getBoundingClientRect()
      const text = element.querySelector('.postText').getBoundingClientRect()

      return {
        postWidth: element.getBoundingClientRect().width,
        authorBottom: author.bottom,
        textTop: text.top,
        textWidth: text.width
      }
    })

    expect(layout.textTop).toBeGreaterThanOrEqual(layout.authorBottom)
    expect(layout.textWidth).toBeGreaterThan(layout.postWidth * 0.8)
  })

  test('keeps an attached video inside a post as a full width card in list display mode', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="posts"]').click()

    const attachedVideo = page.locator('.ft-list-post .ft-list-video').filter({ hasText: 'Attached video' })
    await expect(attachedVideo).toBeVisible()
    // The list layout put the thumbnail beside the title and left the duration
    // badge stranded outside the shrunken thumbnail.
    await expect(attachedVideo).toContainClass('grid')

    const layout = await attachedVideo.evaluate(element => {
      const thumbnail = element.querySelector('.videoThumbnail').getBoundingClientRect()
      const title = element.querySelector('.title').getBoundingClientRect()
      const duration = element.querySelector('.videoDuration').getBoundingClientRect()

      return {
        cardWidth: element.getBoundingClientRect().width,
        thumbnailWidth: thumbnail.width,
        thumbnailRight: thumbnail.right,
        titleTop: title.top,
        thumbnailBottom: thumbnail.bottom,
        durationRight: duration.right
      }
    })

    expect(layout.thumbnailWidth).toBeGreaterThan(layout.cardWidth * 0.8)
    expect(layout.titleTop).toBeGreaterThanOrEqual(layout.thumbnailBottom - 12)
    expect(layout.durationRight).toBeLessThanOrEqual(layout.thumbnailRight)
  })

  test('persists a post as seen when its comments are opened', async ({ app, page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()

    const newPost = page.locator('.ft-list-post').filter({ hasText: 'New community post' })
    await expect(newPost).toBeVisible()
    await newPost.locator('.commentsLink').click()
    await expect(page).toHaveURL(/#\/post\/new-post-1/)

    const relaunched = await app.relaunch()
    await goTo(relaunched.page, 'subscriptions')
    await relaunched.page.locator('[data-subscription-feed-tab="all"]').click()
    await expect(relaunched.page.getByText('New community post', { exact: true })).toHaveCount(0)
  })
})

test.describe('classic Shorts watch layout', () => {
  test.use({
    seed: {
      settings: {
        ...commonSettings,
        useCustomShortsPlayer: false
      },
      profiles: [profile()],
      subscriptionCache: populatedCache
    }
  })

  test('uses the regular player thumbnail morph when YouTube-style Shorts are disabled', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="shorts"]').click()
    await expect(page.getByText('New short', { exact: true })).toBeVisible()

    await page.evaluate(() => {
      window.__watchMorphClasses = []
      const observer = new MutationObserver(() => {
        window.__watchMorphClasses.push(document.documentElement.className)
      })
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class']
      })
    })

    await page.getByText('New short', { exact: true }).click()
    await expect(page).toHaveURL(/#\/watch\/new-short-1\?short=true&shortSource=subscriptions/)
    await page.waitForTimeout(350)

    const morphClasses = await page.evaluate(() => window.__watchMorphClasses)
    expect(morphClasses.some(value => value.includes('viewTransitionMorphActive'))).toBe(true)
    expect(morphClasses.some(value => value.includes('viewTransitionShortMorphActive'))).toBe(false)
  })
})

test.describe('new feed display filters', () => {
  const hiddenPremiere = video('hidden-premiere', 'Hidden premiere', now + HOUR, {
    isNewInSubscriptionFeed: true,
    isUpcoming: true,
    premiereDate: new Date(now + HOUR).toISOString()
  })
  const forbiddenVideo = video('forbidden-video', 'Blocked title', now - HOUR, {
    isNewInSubscriptionFeed: true
  })
  const hiddenLive = video('hidden-live', 'Hidden live stream', now, {
    isNewInSubscriptionFeed: true,
    liveNow: true
  })
  const forbiddenPost = {
    ...post('forbidden-post', 'Forbidden post', now),
    author: 'Blocked channel'
  }
  const hiddenCache = [{
    _id: CHANNEL_ID,
    videos: [hiddenPremiere, forbiddenVideo],
    videosTimestamp: new Date(now).toISOString(),
    shorts: [],
    shortsTimestamp: new Date(now).toISOString(),
    liveStreams: [hiddenLive],
    liveStreamsTimestamp: new Date(now).toISOString(),
    communityPosts: [forbiddenPost],
    communityPostsTimestamp: new Date(now).toISOString()
  }]

  test.use({
    seed: {
      settings: {
        ...commonSettings,
        forbiddenTitles: JSON.stringify(['Blocked']),
        hideLiveStreams: true,
        hideUpcomingPremieres: true,
        showNewSubscriptionFeedIndicators: true
      },
      profiles: [profile()],
      subscriptionCache: hiddenCache
    }
  })

  test('does not advertise new content hidden by display preferences', async ({ page }) => {
    await goTo(page, 'subscriptions')

    await expect(page.getByRole('button', { name: 'Mark all as seen' })).toHaveCount(0)
    await page.locator('[data-subscription-feed-tab="posts"]').click()
    await expect(page.getByText(/Posts feed last updated:/)).toBeVisible()
    await expect(page.getByText('Forbidden post', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Mark all as seen' })).toHaveCount(0)

    await page.locator('[data-subscription-feed-tab="all"]').click()

    await expect(page.getByText('There is no new content.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Videos', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Mark all as seen' })).toHaveCount(0)
  })
})

test.describe('new feed latest-per-channel limit', () => {
  const publishedTimeShort = video('published-time-short', 'New short by published time', undefined, {
    isNewInSubscriptionFeed: true,
    publishedTime: now + HOUR
  })
  const latestLimitCache = [{
    ...populatedCache[0],
    shorts: [publishedTimeShort]
  }]

  test.use({
    seed: {
      settings: {
        ...commonSettings,
        onlyShowLatestFromChannel: true,
        onlyShowLatestFromChannelNumber: 1
      },
      profiles: [profile()],
      subscriptionCache: latestLimitCache
    }
  })

  test('applies the limit across media categories', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()

    await expect(page.getByText('New short by published time', { exact: true })).toBeVisible()
    await expect(page.getByText('New video', { exact: true })).toHaveCount(0)
    await expect(page.getByText('New live stream', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Videos', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Live', exact: true })).toHaveCount(0)
  })
})

test.describe('new feed per-channel daily limit', () => {
  const day = new Date(2026, 7, 31, 12).getTime()
  const dailyLimitCache = [{
    ...populatedCache[0],
    videos: [
      video('daily-newest', 'Newest video today', day, { isNewInSubscriptionFeed: true }),
      video('daily-hidden', 'Hidden video today', day - HOUR, { isNewInSubscriptionFeed: true }),
      video('daily-previous', 'Video from yesterday', day - 24 * HOUR, { isNewInSubscriptionFeed: true })
    ],
    shorts: [],
    liveStreams: [],
    communityPosts: []
  }]

  test.use({
    seed: {
      settings: commonSettings,
      profiles: [profile([{
        id: CHANNEL_ID,
        name: 'Channel A',
        thumbnail: '',
        dailyVideoLimit: 1
      }])],
      subscriptionCache: dailyLimitCache
    }
  })

  test('keeps the newest video from each day and reports hidden entries', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()

    await expect(page.getByText('Newest video today', { exact: true })).toBeVisible()
    await expect(page.getByText('Hidden video today', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Video from yesterday', { exact: true })).toBeVisible()
    await expect(page.getByText('+1 more', { exact: true })).toBeVisible()
  })
})

test.describe('independent new feed setting', () => {
  test.use({
    seed: {
      settings: {
        ...commonSettings,
        showNewSubscriptionFeed: false,
        showNewSubscriptionFeedIndicators: true
      },
      profiles: [profile()],
      history: watchedHistory,
      subscriptionCache: populatedCache
    }
  })

  test('can hide the New tab without disabling indicators', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await expect(page.getByText('New video', { exact: true })).toBeVisible()
    await expect(page.locator('[data-subscription-feed-tab="all"]')).toHaveCount(0)
    await expect(page.locator('.newContentDot')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Mark all as seen' })).toBeVisible()
  })
})

test.describe('large new feed refresh', () => {
  const subscriptions = Array.from({ length: 126 }, (_, index) => ({
    id: `UC${String(index).padStart(22, '0')}`,
    name: `Channel ${index}`,
    thumbnail: ''
  }))

  test.use({
    seed: {
      settings: {
        ...commonSettings,
        showNewSubscriptionFeedIndicators: false
      },
      profiles: [profile(subscriptions)]
    }
  })

  test('warns before refreshing all non-RSS feeds', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()
    await expect(page.getByText('There is no new content.')).toBeVisible()

    const refreshNewContent = page.getByRole('button', { name: /Refresh New content/ })
    await expect(refreshNewContent).toBeVisible()
    await refreshNewContent.click()
    await expect(page.getByRole('heading', { name: 'Refresh all subscription feeds?' })).toBeVisible()
    await expect(page.getByText(/126 subscriptions can take a long time/)).toBeVisible()
    expect(await page.locator('.promptCard').evaluate(
      element => element.scrollHeight <= element.clientHeight
    )).toBe(true)

    await page.getByRole('button', { name: 'No', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Refresh all subscription feeds?' })).toHaveCount(0)
    await expect(page.getByText('There is no new content.')).toBeVisible()
  })
})
