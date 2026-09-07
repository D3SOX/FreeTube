import { readFile } from 'node:fs/promises'

import {
  test,
  expect,
  goTo,
  goToSettingsSection,
  openNewWindowFromTabBar,
  setWindowSize,
  waitForAppReady,
} from '../../helpers/app.mjs'
import { DBActions } from '../../../src/constants.js'
import { expectImagesLoaded } from '../../helpers/visual-fixtures.mjs'

const now = Date.now()
const HOME_CHANNEL_ID = 'UChomehomehomehomehomeho'
const HOME_THUMBNAIL_DATA_URL = `data:image/svg+xml;base64,${(
  await readFile(new URL('../../fixtures/media/video-thumbnail.svg', import.meta.url))
).toString('base64')}`

async function expectSideNavIndicatorAligned(page) {
  const activeNavOption = page.locator('.sideNav .navOption.router-link-active:visible')
  const activeIndicator = page.locator('.sideNav .activeIndicator')
  await expect.poll(async () => {
    const [optionBounds, indicatorBounds] = await Promise.all([
      activeNavOption.boundingBox(),
      activeIndicator.boundingBox()
    ])
    if (optionBounds == null || indicatorBounds == null) return Number.POSITIVE_INFINITY

    return Math.max(
      Math.abs(optionBounds.y - indicatorBounds.y),
      Math.abs(optionBounds.height - indicatorBounds.height)
    )
  }).toBeLessThanOrEqual(1)
}

function subscriptionVideo(videoId, title, extra = {}) {
  return {
    videoId,
    title,
    author: 'Home Subscription Channel',
    authorId: HOME_CHANNEL_ID,
    published: now - 3_600_000,
    viewCount: 100,
    lengthSeconds: 120,
    liveNow: false,
    isUpcoming: false,
    type: 'video',
    isNewInSubscriptionFeed: true,
    thumbnailUrl: HOME_THUMBNAIL_DATA_URL,
    ...extra
  }
}

function subscriptionPost(postId, postText, publishedTime) {
  return {
    postId,
    postText,
    author: 'Home Subscription Channel',
    authorId: HOME_CHANNEL_ID,
    authorThumbnails: [],
    publishedTime,
    voteCount: 1,
    commentCount: 0,
    postContent: { type: 'text', content: '' },
    type: 'community',
    isNewInSubscriptionFeed: true
  }
}

function historyEntry(videoId, title, watchProgress, isWatched = false, extra = {}) {
  return {
    _id: videoId,
    videoId,
    title,
    author: 'Home Test Channel',
    authorId: 'UC-home-test-channel-id',
    published: now - 86_400_000,
    description: '',
    viewCount: 100,
    lengthSeconds: 120,
    watchProgress,
    isWatched,
    timeWatched: now,
    isLive: false,
    type: 'video',
    ...extra
  }
}

const today = [
  new Date().getFullYear(),
  String(new Date().getMonth() + 1).padStart(2, '0'),
  String(new Date().getDate()).padStart(2, '0')
].join('-')
const twoWeeksAgoDate = new Date()
twoWeeksAgoDate.setDate(twoWeeksAgoDate.getDate() - 14)
const twoWeeksAgo = [
  twoWeeksAgoDate.getFullYear(),
  String(twoWeeksAgoDate.getMonth() + 1).padStart(2, '0'),
  String(twoWeeksAgoDate.getDate()).padStart(2, '0')
].join('-')

const homeSeed = {
  history: [
    historyEntry('homevideo01', 'Partly watched video', 30, false, {
      thumbnailUrl: HOME_THUMBNAIL_DATA_URL
    }),
    historyEntry('homevideo02', 'Finished video', 120, true)
  ],
  playlists: [{
    _id: 'homeplaylist',
    playlistName: 'Recent Home playlist',
    protected: false,
    description: '',
    videos: [historyEntry('homevideo01', 'Partly watched video', 30)],
    createdAt: now - 10_000,
    lastUpdatedAt: now
  }],
  profiles: [{
    _id: 'allChannels',
    name: 'All Channels',
    bgColor: '#000000',
    textColor: '#FFFFFF',
    subscriptions: [{ id: HOME_CHANNEL_ID, name: 'Home Subscription Channel', thumbnail: '' }]
  }],
  subscriptionCache: [{
    _id: HOME_CHANNEL_ID,
    videos: [
      subscriptionVideo('homefeed001', 'New Home video', { published: now - 3_600_000 }),
      ...Array.from({ length: 8 }, (_, index) => subscriptionVideo(
          `homeold${String(index + 1).padStart(4, '0')}`,
          `Older Home video ${index + 1}`,
          { published: now - (index + 2) * 3_600_000 }
      ))
    ],
    videosTimestamp: new Date(now - 3_600_000).toISOString(),
    shorts: [subscriptionVideo('homefeed002', 'New Home short', { published: now - 1_800_000 })],
    shortsTimestamp: new Date(now - 3_600_000).toISOString(),
    liveStreams: [],
    liveStreamsTimestamp: new Date(now - 3_600_000).toISOString(),
    communityPosts: [subscriptionPost('home-post-1', 'New Home post', now - 900_000)],
    communityPostsTimestamp: new Date(now - 3_600_000).toISOString()
  }],
  watchStats: [
    { _id: today, date: today, seconds: 3_600 },
    { _id: twoWeeksAgo, date: twoWeeksAgo, seconds: 7_200 },
    {
      _id: 'history-watch-time-v1',
      completedAt: now,
      hadEstimates: false,
      adjustment: null
    }
  ]
}

test.use({ seed: homeSeed })

test('keeps the previous landing page for an existing installation', async ({ page }) => {
  await expect(page).toHaveURL(/#\/subscriptions$/)

  const hasPersistedLandingPage = await page.evaluate(async (findAction) => {
    const settings = await window.ftElectron.dbSettings(findAction)
    return settings.some(setting => setting._id === 'landingPage')
  }, DBActions.GENERAL.FIND)
  expect(hasPersistedLandingPage).toBe(false)

  const tab = await page.evaluate(async () => {
    return await window.ftElectron.tabs.create({
      makeActive: false,
      lazyLoad: true
    })
  })

  expect(tab.route.fullPath).toBe('/subscriptions')
})

test('shows local activity and keeps Home customization after relaunch', async ({ app }) => {
  let page = app.page
  await goTo(page, 'home')

  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
  await expect(page.getByText('Partly watched video')).toBeVisible()
  await expectImagesLoaded(page.locator('[data-home-section="continueWatching"] .mediaThumbnail img'))
  await expect(page.locator('[data-home-section="continueWatching"] .mediaThumbnail img'))
    .toHaveAttribute('src', HOME_THUMBNAIL_DATA_URL)
  await expect(page.getByText('Finished video')).toHaveCount(0)
  await expect(page.getByText('Recent Home playlist')).toBeVisible()
  const newSinceLastVisit = page.locator('[data-home-section="newSinceLastVisit"]')
  const newSubscriptionTitles = newSinceLastVisit.locator('.mediaDetails strong')
  await expect(newSubscriptionTitles.nth(0)).toHaveText('New Home post')
  await expect(newSubscriptionTitles.nth(1)).toHaveText('New Home short')
  await expect(newSubscriptionTitles.nth(2)).toHaveText('New Home video')
  await expect(newSinceLastVisit).toContainText('Posts')
  await expect(newSinceLastVisit).toContainText('Shorts')
  await expect(newSinceLastVisit).toContainText('Videos')
  await expect(newSinceLastVisit.getByRole('link', { name: /New Home post/ }))
    .toHaveAttribute('href', /#\/post\/home-post-1\?authorId=/)
  await expect(newSinceLastVisit.getByRole('link', { name: /New Home short/ }))
    .toHaveAttribute('href', /#\/watch\/homefeed002\?short=true&shortSource=subscriptions$/)
  await expect(newSinceLastVisit.getByRole('link', { name: /New Home video/ }))
    .toHaveAttribute('href', /#\/watch\/homefeed001$/)
  const watchStats = page.locator('[data-home-section="watchStats"]')
  await expect(watchStats).toContainText('This week')
  await expect(watchStats).not.toContainText('Total watch time')
  await expect(watchStats.locator('strong')).toHaveText(['1 hr', '1 hr'])

  const nextShelfPage = newSinceLastVisit.getByRole('button', {
    name: 'Next New since last visit page'
  })
  const previousShelfPage = newSinceLastVisit.getByRole('button', {
    name: 'Previous New since last visit page'
  })
  await expect(nextShelfPage).toBeVisible()
  const previousShelfPageBox = await previousShelfPage.boundingBox()
  const shelfPageBox = await newSinceLastVisit.locator('[data-home-shelf-page]').boundingBox()
  const nextShelfPageBox = await nextShelfPage.boundingBox()
  expect(previousShelfPageBox.x + previousShelfPageBox.width).toBeLessThan(shelfPageBox.x)
  expect(nextShelfPageBox.x).toBeGreaterThan(shelfPageBox.x + shelfPageBox.width)
  await nextShelfPage.click()
  const enteringNextPage = newSinceLastVisit.locator('.shelf-next-enter-active')
  await expect(enteringNextPage).toHaveCount(1)
  await expect.poll(() => enteringNextPage.evaluate(element => (
    getComputedStyle(element).transform !== 'none'
  ))).toBe(true)
  await expect(newSinceLastVisit.locator('[data-home-shelf-page="2"]')).toBeVisible()
  await expect(newSinceLastVisit.locator('[aria-hidden="true"][data-home-shelf-page]')).toHaveCount(0)
  await expect(newSinceLastVisit.getByText('New Home post', { exact: true })).toHaveCount(0)
  await expect(newSinceLastVisit.getByRole('status'))
    .toHaveText(/New since last visit, page 2 of \d+\./)

  await previousShelfPage.click()
  await expect(newSinceLastVisit.locator('.shelf-previous-enter-active')).toHaveCount(1)
  await expect(newSinceLastVisit.locator('[aria-hidden="true"][data-home-shelf-page]')).toHaveCount(0)
  await expect(newSinceLastVisit.getByText('New Home post', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Customize Home' }).click()
  const customizer = page.getByRole('region', { name: 'Customize Home' })
  await customizer.getByText('Recent playlists', { exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Recent playlists' })).not.toBeChecked()

  for (let index = 0; index < 7; index++) {
    await page.getByRole('button', { name: 'Move Watch statistics up' }).click()
  }

  await expect(page.locator('[data-home-section="playlists"]')).toHaveCount(0)
  await expect(page.locator('[data-home-section]').first()).toHaveAttribute('data-home-section', 'watchStats')

  const relaunched = await app.relaunch()
  page = relaunched.page
  await goTo(page, 'home')

  await expect(page.locator('[data-home-section="playlists"]')).toHaveCount(0)
  await expect(page.locator('[data-home-section]').first()).toHaveAttribute('data-home-section', 'watchStats')
})

test('opens the subscriptions New feed from its Home summary', async ({ page }) => {
  await goTo(page, 'home')

  const section = page.locator('[data-home-section="newSinceLastVisit"]')
  await section.getByRole('link', { name: 'View all' }).click()

  await expect(page).toHaveURL(/#\/subscriptions\?tab=new$/)
  await expect(page.locator('[data-subscription-feed-tab="all"]')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('New Home video', { exact: true })).toBeVisible()
  await expect(page.getByText('New Home short', { exact: true })).toBeVisible()

  await page.locator('[data-subscription-feed-tab="videos"]').click()
  await expect(page).toHaveURL(/#\/subscriptions\?tab=videos$/)
})

test('activates an existing video tab from Continue watching', async ({ page }) => {
  await goTo(page, 'home')

  const homeTabId = await page.locator('.tab.active').getAttribute('data-tab-id')
  const videoTab = await page.evaluate(() => window.ftElectron.tabs.create({
    route: '/watch/homevideo01',
    title: 'Partly watched video',
    makeActive: false,
    lazyLoad: true
  }))
  await expect(page.locator('.tab')).toHaveCount(2)

  await page.locator('[data-home-section="continueWatching"]')
    .getByRole('link', { name: /Partly watched video/ })
    .click()

  await expect.poll(async () => page.evaluate(() => window.ftElectron.tabs.getState()))
    .toMatchObject({
      activeTabId: videoTab.id,
      tabs: [
        { id: homeTabId, route: { fullPath: '/home' } },
        { id: videoTab.id, route: { fullPath: '/watch/homevideo01' } }
      ]
    })

  await page.evaluate(tabId => window.ftElectron.tabs.close(tabId), videoTab.id)
  await expect(page.locator('.tab')).toHaveCount(1)
  await expect(page).toHaveURL(/#\/home$/)

  await page.locator('[data-home-section="continueWatching"]')
    .getByRole('link', { name: /Partly watched video/ })
    .click()

  await expect(page).toHaveURL(/#\/watch\/homevideo01$/)
  await expect(page.locator('.tab')).toHaveCount(1)
  await expect.poll(async () => page.evaluate(() => window.ftElectron.tabs.getState()))
    .toMatchObject({
      activeTabId: homeTabId,
      tabs: [{ id: homeTabId, route: { fullPath: '/watch/homevideo01' } }]
    })
})

test('shows recent active and completed downloads', async ({ page }) => {
  await goTo(page, 'home')
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const downloads = [
      {
        id: 3,
        title: 'Available offline video',
        status: 'completed',
        availability: 'available',
        mode: 'video',
        files: [{ videoId: 'offline0001', path: '/tmp/offline0001.mp4', available: true }]
      },
      {
        id: 2,
        title: 'Completed missing video',
        status: 'completed',
        availability: 'missing',
        mode: 'video'
      },
      {
        id: 4,
        title: 'Active video download',
        status: 'downloading',
        mode: 'video',
        percent: 50
      },
      {
        id: 1,
        title: 'Failed offline video',
        status: 'failed',
        mode: 'video'
      }
    ]
    downloads.forEach(download => store.commit('upsertYtDlpDownload', download))
  })

  const section = page.locator('[data-home-section="recentDownloads"]')
  await expect(section).toContainText('Recent downloads')
  await expect(section).toContainText('Active video download')
  await expect(section).toContainText('Downloading')
  await expect(section).toContainText('Available offline video')
  await expect(section).toContainText('Completed missing video')
  await expect(section).not.toContainText('Failed offline video')
  await expect(section.getByRole('link', { name: /Available offline video/ }))
    .toHaveAttribute('href', /#\/watch\/offline0001\?downloadId=3$/)

  await page.evaluate(() => {
    window.__homeDownloadsHashChanges = []
    window.__homePageWasRemoved = false
    window.addEventListener('hashchange', () => {
      window.__homeDownloadsHashChanges.push(location.hash)
    })
    new MutationObserver(() => {
      if (document.querySelector('.homePage') == null) {
        window.__homePageWasRemoved = true
      }
    }).observe(document.querySelector('#app'), { childList: true, subtree: true })
  })
  await section.getByText('View all', { exact: true }).click()

  await expect(page.locator('.settingsWindow')).toBeVisible()
  await expect(page.locator('.settingsDownloadsPage')).toBeVisible()
  expect(await page.evaluate(() => window.__homeDownloadsHashChanges)).toEqual([])
  expect(await page.evaluate(() => window.__homePageWasRemoved)).toBe(false)
})

test('shows a queued video without reloading the page', async ({ page }) => {
  await goTo(page, 'history')
  const video = page.locator('.ft-list-video').filter({ hasText: 'Partly watched video' })
  await video.hover()
  await video.locator('.optionsButton').click()
  await page.getByRole('option', { name: 'Add to Queue' }).click()

  await goTo(page, 'home')

  await expect(page.locator('[data-home-section="watchQueue"]')).toContainText('Partly watched video')
})

test.describe('fresh installation', () => {
  test.use({
    seed: { freshProfile: true },
    showTutorial: true
  })

  test('uses and persists Home with the new-user tutorial', async ({ page }) => {
    await expect(page).toHaveURL(/#\/home$/)
    await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Welcome to OpenTubeX' })).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Settings have moved' })).toHaveCount(0)

    await expect.poll(() => page.evaluate(async (findAction) => {
      const settings = await window.ftElectron.dbSettings(findAction)
      return settings.find(setting => setting._id === 'landingPage')?.value ?? null
    }, DBActions.GENERAL.FIND)).toBe('home')

    // Fresh profiles otherwise show the normal close confirmation during fixture teardown.
    await page.evaluate(async () => {
      await window.ftElectron.dbSettings(2, { _id: 'confirmCloseApp', value: false })
    })
  })
})

test.describe('hidden Home page', () => {
  test.use({ seed: { settings: { landingPage: 'home' } } })

  test('removes Home from navigation and falls back for new tabs', async ({ app, page }) => {
    await expect(page.locator('.sideNav a[href="#/home"]')).toBeVisible()

    const otherWindow = await openNewWindowFromTabBar(app, page)
    await waitForAppReady(otherWindow)
    await expect(otherWindow).toHaveURL(/#\/home$/)
    await expect(otherWindow.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()

    const backgroundHomeTab = await page.evaluate(() => window.ftElectron.tabs.create({
      route: '/home',
      makeActive: false,
      lazyLoad: true
    }))

    const appearanceSettings = await goToSettingsSection(page, 'appearance')
    await appearanceSettings.getByRole('button', { name: 'Customize navigation' }).click()
    const navigationSubpage = page.locator('.settingsSubpageContent')
    await navigationSubpage.getByRole('button', { name: 'Remove Home' }).click()
    await expect(page.locator('.sideNav a[href="#/home"]')).toHaveCount(0)
    await expect(page).toHaveURL(/#\/subscriptions$/)
    await expect(otherWindow).toHaveURL(/#\/subscriptions$/)
    await expect.poll(() => page.evaluate((tabId) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.getters.getTabById(tabId)?.route.fullPath
    }, backgroundHomeTab.id)).toBe('/subscriptions')

    const activeNavOption = page.locator('.sideNav .navOption.router-link-active:visible')
    await expect(activeNavOption).toHaveAttribute('href', '#/subscriptions')
    await expectSideNavIndicatorAligned(page)

    await navigationSubpage.getByRole('button', { name: 'Add item' }).click()
    await navigationSubpage.getByRole('menuitem', { name: 'Home' }).click()
    await expect(page.locator('.sideNav a[href="#/home"]')).toBeVisible()
    await expectSideNavIndicatorAligned(page)

    await navigationSubpage.getByRole('button', { name: 'Remove Home' }).click()
    await expect(page.locator('.sideNav a[href="#/home"]')).toHaveCount(0)
    await expectSideNavIndicatorAligned(page)

    await page.locator('.settingsBackButton').click()
    await goToSettingsSection(page, 'general')
    const landingPageSelect = page.getByRole('combobox', { name: /Default landing page/i })
    await expect(landingPageSelect).toContainText('Subscriptions')
    await landingPageSelect.click()
    await expect(page.getByRole('option', { name: 'Home', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')

    const tab = await page.evaluate(async () => {
      return await window.ftElectron.tabs.create({
        makeActive: false,
        lazyLoad: true
      })
    })
    expect(tab.route.fullPath).toBe('/subscriptions')

    const navigateItems = await app.electronApp.evaluate(({ Menu }) => {
      return Menu.getApplicationMenu().items
        .find(item => item.label === 'Navigate')
        .submenu.items
        .map(item => item.label)
    })
    expect(navigateItems).toContain('Home')
  })
})

test.describe('landing page availability', () => {
  test.use({
    seed: {
      settings: {
        backendFallback: false,
        backendPreference: 'local',
        enableWatchStats: true,
        landingPage: 'home',
        navigationItems: ['stats', 'popular', 'subscriptions'],
        rememberHistory: false,
      }
    }
  })

  test('skips unavailable destinations when choosing a fallback', async ({ page }) => {
    await expect(page).toHaveURL(/#\/subscriptions$/)

    const tab = await page.evaluate(() => window.ftElectron.tabs.create({
      makeActive: false,
      lazyLoad: true,
    }))
    expect(tab.route.fullPath).toBe('/subscriptions')
  })

  test.describe('with Trending configured as the landing page', () => {
    test.use({
      seed: {
        settings: {
          backendFallback: false,
          backendPreference: 'local',
          landingPage: 'trending',
          navigationItems: ['trending', 'subscriptions'],
        }
      }
    })

    test('opens Trending when the Electron renderer supports the local API', async ({ page }) => {
      await expect(page).toHaveURL(/#\/trending$/)
    })
  })
})

test.describe('legacy landing page visibility', () => {
  test.use({
    seed: {
      settings: {
        hidePlaylists: true,
        landingPage: 'userplaylists',
      }
    }
  })

  test('applies every legacy navigation switch before opening the first tab', async ({ page }) => {
    await expect(page).toHaveURL(/#\/home$/)
    await expect(page.locator('.sideNav a[href="#/userplaylists"]')).toHaveCount(0)
  })
})

test.describe('compact scaled Home page', () => {
  test.use({ seed: { ...homeSeed, settings: { uiScale: 95 } } })

  test('keeps Capacitor phone pages inside the viewport and clear of the bottom navigation', async ({ app, page }) => {
    await setWindowSize(app, page, { width: 375, height: 700 })
    await goTo(page, 'home')
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--safe-area-inset-bottom', '24px')
      const app = document.querySelector('.app')
      app.classList.add('capacitorTabs', 'capacitorPhoneLayout')
      app.classList.remove('topTabs', 'bottomTabs', 'verticalTabs')
      document.querySelector('.tabBar')?.style.setProperty('display', 'none')
    })

    for (const pageLayout of [
      { route: 'home', pageSelector: '.homePage', cardSelector: '.homeIntro' },
      { route: 'subscriptions', pageSelector: '.subscriptionsPage', cardSelector: '.card' }
    ]) {
      await goTo(page, pageLayout.route)
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))

      const metrics = await page.evaluate(({ pageSelector, cardSelector }) => {
        const pageBounds = document.querySelector(pageSelector).getBoundingClientRect()
        const firstCardBounds = document.querySelector(cardSelector).getBoundingClientRect()
        const cards = [...document.querySelectorAll(`${pageSelector} .ft-card`)]
        const lastCardBounds = cards.at(-1).getBoundingClientRect()
        const topNavBounds = document.querySelector('.topNav').getBoundingClientRect()
        const bottomNavBounds = document.querySelector('.sideNav').getBoundingClientRect()

        return {
          bottomNavBottomOffset: Math.abs(bottomNavBounds.bottom - window.innerHeight),
          bottomNavHeight: bottomNavBounds.height,
          cardBottomClearance: bottomNavBounds.top - lastCardBounds.bottom,
          cardLeft: firstCardBounds.left,
          cardRightOffset: Math.abs(window.innerWidth - firstCardBounds.right),
          horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          pageLeft: pageBounds.left,
          pageRightOffset: Math.abs(window.innerWidth - pageBounds.right),
          topGap: firstCardBounds.top + window.scrollY - topNavBounds.bottom,
        }
      }, pageLayout)

      expect(metrics.horizontalOverflow).toBeLessThanOrEqual(0)
      expect(Math.abs(metrics.pageLeft)).toBeLessThanOrEqual(1)
      expect(metrics.pageRightOffset).toBeLessThanOrEqual(1)
      expect(Math.abs(metrics.cardLeft)).toBeLessThanOrEqual(1)
      expect(metrics.cardRightOffset).toBeLessThanOrEqual(1)
      expect(Math.abs(metrics.topGap)).toBeLessThanOrEqual(1)
      expect(metrics.bottomNavHeight).toBeCloseTo(84, 0)
      expect(metrics.bottomNavBottomOffset).toBeLessThanOrEqual(1)
      expect(metrics.cardBottomClearance).toBeGreaterThanOrEqual(-1)
    }
  })

  test('fits customization controls without horizontal overflow', async ({ app, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await setWindowSize(app, page, { width: 375, height: 700 })
    await goTo(page, 'home')
    await page.getByRole('button', { name: 'Customize Home' }).click()

    await expect.poll(() => page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
    ))).toBe(true)

    const reorderButton = page.getByRole('button', { name: 'Move Watch queue down' })
    const box = await reorderButton.boundingBox()
    expect(box.width).toBeGreaterThanOrEqual(43.9)
    expect(box.height).toBeGreaterThanOrEqual(43.9)

    const newSinceLastVisit = page.locator('[data-home-section="newSinceLastVisit"]')
    await expect(newSinceLastVisit.locator('.mediaGrid > li')).toHaveCount(1)
    const shelfArrow = newSinceLastVisit.getByRole('button', {
      name: 'Next New since last visit page'
    })
    const shelfArrowBox = await shelfArrow.boundingBox()
    expect(shelfArrowBox.width).toBeGreaterThanOrEqual(43.9)
    expect(shelfArrowBox.height).toBeGreaterThanOrEqual(43.9)

    await shelfArrow.click()
    const secondShelfPage = newSinceLastVisit.locator('[data-home-shelf-page="2"]')
    await expect(secondShelfPage).toBeVisible()
    const runningAnimations = await secondShelfPage
      .evaluate(element => element.getAnimations().filter(animation => animation.playState === 'running').length)
    expect(runningAnimations).toBe(0)
  })
})
