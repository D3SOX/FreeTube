import { readFile } from 'node:fs/promises'

import { test, expect, goTo, setWindowSize, openNewWindowFromTabBar, waitForAppReady } from '../../helpers/app.mjs'
import { mockWatchPage } from '../../helpers/watch.mjs'
import { expectImagesLoaded } from '../../helpers/visual-fixtures.mjs'
import { DBActions } from '../../../src/constants.js'

const INSTANCE_URL = 'https://invidious.test'
const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const DISCOVERY_CHANNEL_ID = 'UCbbbbbbbbbbbbbbbbbbbbbb'
const BLOCKED_CHANNEL_ID = 'UCcccccccccccccccccccccc'
const UNRELATED_CHANNEL_ID = 'UCdddddddddddddddddddddd'
const now = Date.now()
const thumbnailSvg = await readFile(new URL('../../fixtures/media/video-thumbnail.svg', import.meta.url))
const thumbnail = `data:image/svg+xml;base64,${thumbnailSvg.toString('base64')}`

function historyEntry(videoId = 'rechist0001') {
  return {
    _id: videoId,
    videoId,
    title: 'Linux desktop customization',
    author: 'Linux Desktop Channel',
    authorId: CHANNEL_ID,
    published: now - 86_400_000,
    description: '',
    viewCount: 100,
    lengthSeconds: 600,
    watchProgress: 480,
    isWatched: false,
    timeWatched: now,
    isLive: false,
    type: 'video',
    thumbnailUrl: thumbnail,
  }
}

// Invidious supplies seconds; its API helper normalizes these to milliseconds.
function video(videoId, title, authorId = CHANNEL_ID) {
  return {
    type: 'video',
    videoId,
    title,
    author: authorId === CHANNEL_ID ? 'Linux Desktop Channel' : 'Discovery Channel',
    authorId,
    authorUrl: `/channel/${authorId}`,
    authorVerified: false,
    description: '',
    descriptionHtml: '',
    viewCount: 100,
    viewCountText: '100 views',
    lengthSeconds: 600,
    published: Math.floor((now - 3_600_000) / 1000),
    publishedText: '1 hour ago',
    liveNow: false,
    isUpcoming: false,
    premiereTimestamp: 0,
    premium: false,
    videoThumbnails: [{ quality: 'medium', url: thumbnail, width: 320, height: 180 }],
  }
}

const channelCandidate = video('recchan0001', 'Linux desktop shortcuts')
const searchCandidate = video('recsrch0001', 'Linux desktop themes', DISCOVERY_CHANNEL_ID)
const NO_HISTORY = 'Watch some videos with history enabled to get recommendations.'
const UNAVAILABLE = 'Could not load recommendations. Try again later.'
const REFRESH = 'Refresh feed with latest content'
const excludedCandidates = [
  video('rechist0001', 'Linux desktop customization'),
  video('recseen0001', 'Linux desktop customization completed'),
  video('recbloc0001', 'Linux desktop panels', BLOCKED_CHANNEL_ID),
  video('rectext0001', 'Spoiler Linux desktop customization', DISCOVERY_CHANNEL_ID),
  video('recaway0001', 'Sourdough bread baking', UNRELATED_CHANNEL_ID),
]
const history = [
  historyEntry(),
  { ...historyEntry('recseen0001'), watchProgress: 600, isWatched: true },
]
const settings = {
  landingPage: 'subscriptions',
  backendPreference: 'invidious',
  backendFallback: false,
  defaultInvidiousInstance: INSTANCE_URL,
  uiScale: 95,
  channelsHidden: JSON.stringify([{ name: BLOCKED_CHANNEL_ID, preferredName: '', icon: '' }]),
  forbiddenTitles: JSON.stringify(['spoiler']),
}

// Deliberately omit enableHomeRecommendations to exercise its false default.
test.use({ seed: { settings, history } })

function recommendations(page) {
  return page.locator('[data-home-section="recommendations"]')
}

function candidateSource(url) {
  if (url.origin !== INSTANCE_URL) return null
  // getInvidiousChannelTab places the channel ID before the tab name.
  if (/^\/api\/v1\/channels\/UC[\w-]{22}\/videos\/?$/.test(url.pathname)) return 'channel'
  if (/^\/api\/v1\/search\/?$/.test(url.pathname)) return 'search'
  if (/^\/api\/v1\/videos\//.test(url.pathname)) return 'related'
  return null
}

async function renderTurn(page) {
  // Let response consumers and Vue's DOM updates finish before negative assertions.
  await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
}

async function mockCandidates(page) {
  const requests = []
  const finished = new Set()
  const backend = {
    requests,
    relatedVideos: [],
    get holding() { return gate !== null },
    aborted: [],
    failures: new Set(),
    channelVideos: [channelCandidate, ...excludedCandidates],
    searchVideos: [searchCandidate, channelCandidate, ...excludedCandidates],
    holdResponses() {
      let release
      gate = new Promise(resolve => { release = resolve })
      return () => {
        gate = null
        release()
      }
    },
    async settled() {
      await expect.poll(() => finished.size === requests.length).toBe(true)
      await renderTurn(page)
    },
  }
  let gate = null
  const recordFinished = request => {
    if (candidateSource(new URL(request.url()))) finished.add(request)
  }
  page.on('requestfinished', recordFinished)
  page.on('requestfailed', request => {
    recordFinished(request)
    if (candidateSource(new URL(request.url())) && /abort|cancel/i.test(request.failure()?.errorText ?? '')) {
      backend.aborted.push(request)
    }
  })

  await page.route(/^https?:\/\//, route => route.abort())
  await page.route('**/vi/**', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: thumbnailSvg,
  }))
  await page.route(url => candidateSource(url) !== null, async route => {
    const url = new URL(route.request().url())
    const source = candidateSource(url)
    requests.push({ source, url })
    const failed = backend.failures.has(source)
    // Capture each response before holding it so later fixture changes cannot
    // accidentally replace the stale result with the next generation's data.
    const body = JSON.stringify(failed
      ? { error: 'Recommendation backend unavailable' }
      : source === 'related'
        ? { recommendedVideos: backend.relatedVideos }
        : source === 'channel'
          ? { videos: backend.channelVideos, continuation: null }
          : backend.searchVideos)
    if (gate) await gate
    const wasAborted = () => /abort|cancel/i.test(route.request().failure()?.errorText ?? '')
    if (wasAborted()) return
    try {
      await route.fulfill({ status: failed ? 503 : 200, contentType: 'application/json', body })
    } catch (error) {
      // AbortSignal may cancel a held request just as its response is released.
      // Keep unrelated interception errors visible to the test runner.
      if (!wasAborted()) throw error
    }
  })
  return backend
}

async function expectBothSources(backend, since = 0) {
  if (backend.holding) {
    await expect.poll(() => backend.requests.length).toBeGreaterThan(since)
    return
  }
  await expect.poll(() => [...new Set(backend.requests.slice(since).map(request => request.source).filter(source => source !== 'related'))].sort())
    .toEqual(['channel', 'search'])
}

async function chooseRecommendationOption(page, label) {
  await recommendations(page).locator('.recommendationOptions .iconButton').click()
  await page.getByRole('button', { name: label, exact: true }).click()
}

async function setEnabled(page, enabled) {
  const section = recommendations(page)
  const enableButton = section.getByRole('button', { name: 'Enable recommendations', exact: true })
  if (enabled) {
    await enableButton.click()
    await expect(enableButton).toHaveCount(0)
  } else {
    await chooseRecommendationOption(page, 'Turn off recommendations')
    await expect(enableButton).toBeVisible()
  }
  await expect.poll(() => page.evaluate(() => {
    return document.querySelector('#app').__vue_app__.config.globalProperties.$store
      .getters.getEnableHomeRecommendations
  })).toBe(enabled)
}

async function clearHistory(page) {
  expect(await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return await store.dispatch('removeAllHistory')
  })).toBe(true)
}

async function expectNoHistory(page) {
  const section = recommendations(page)
  await expect(section.getByRole('status')).toHaveText(NO_HISTORY)
  await expect(section.locator('.recommendationFeed')).toHaveCount(0)
}

test('opts in before requesting candidates and shows only unseen matching videos at 95% scale', async ({ page }, testInfo) => {
  const backend = await mockCandidates(page)
  await goTo(page, 'home')
  const section = recommendations(page)
  await expect(section.getByRole('heading', { name: 'Recommended for you', exact: true })).toBeVisible()
  await expect(section.getByRole('button', { name: 'Enable recommendations', exact: true })).toBeVisible()
  await expect(section.locator('.recommendationFeed')).toHaveCount(0)
  await renderTurn(page)
  expect(backend.requests).toEqual([])

  await setEnabled(page, true)
  await expectBothSources(backend)
  await backend.settled()
  expect(backend.requests.filter(request => request.source === 'channel').map(request => request.url.pathname))
    .toEqual([`/api/v1/channels/${CHANNEL_ID}/videos`])
  for (const { url } of backend.requests.filter(request => request.source === 'search')) {
    expect(url.searchParams.get('q')).toMatch(/linux|desktop|customization/i)
    expect(url.searchParams.get('type')).toBe('video')
  }

  const cards = section.locator('.recommendationFeed .ft-list-video')
  await expect(cards).toHaveCount(2)
  for (const candidate of [channelCandidate, searchCandidate]) {
    await expect(section.getByRole('link', { name: new RegExp(candidate.title) })).toBeVisible()
    await expect(section.getByRole('link', { name: new RegExp(candidate.title) }))
      .toHaveAttribute('href', `#/watch/${candidate.videoId}`)
  }
  for (const candidate of excludedCandidates) {
    await expect(section.locator(`a[href*="/watch/${candidate.videoId}"]`)).toHaveCount(0)
  }
  await section.scrollIntoViewIfNeeded()
  await expectImagesLoaded(section.locator('.thumbnailImage'))
  const screenshotPath = testInfo.outputPath('home-recommendations-95.png')
  await page.screenshot({ path: screenshotPath, animations: 'disabled' })
  await testInfo.attach('Home recommendations at 95 percent scale', {
    path: screenshotPath,
    contentType: 'image/png',
  })
  await expect.poll(() => page.evaluate(async findAction => {
    const entries = await window.ftElectron.dbSettings(findAction)
    return entries.find(entry => entry._id === 'enableHomeRecommendations')?.value
  }, DBActions.GENERAL.FIND)).toBe(true)
})

test('reuses recommendations when revisiting Home and bypasses the cache with Refresh', async ({ page }) => {
  const backend = await mockCandidates(page)
  await goTo(page, 'home')
  await setEnabled(page, true)
  await expectBothSources(backend)
  await backend.settled()
  await expect(recommendations(page).getByRole('link', { name: /Linux desktop shortcuts/ })).toBeVisible()

  const requestCount = backend.requests.length
  backend.channelVideos = [video('recfresh001', 'Linux desktop fresh results')]
  backend.searchVideos = []
  await goTo(page, 'history')
  await goTo(page, 'home')
  await expect(recommendations(page).getByRole('link', { name: /Linux desktop shortcuts/ })).toBeVisible()
  await renderTurn(page)
  expect(backend.requests).toHaveLength(requestCount)

  await recommendations(page).getByRole('button', { name: REFRESH, exact: true }).click()
  await expectBothSources(backend, requestCount)
  await backend.settled()
  await expect(recommendations(page).getByRole('link', { name: /Linux desktop fresh results/ })).toBeVisible()
  await expect(recommendations(page).locator('.recommendationFeed .ft-list-video')).toHaveCount(1)
})

test('hiding through Customize invalidates pending results and stops requests until shown again', async ({ page }) => {
  const backend = await mockCandidates(page)
  const release = backend.holdResponses()
  try {
    await goTo(page, 'home')
    await setEnabled(page, true)
    await expectBothSources(backend)
    await page.getByRole('button', { name: 'Customize Home' }).click()
    const customizer = page.getByRole('region', { name: 'Customize Home' })
    await customizer.getByText('Recommended for you', { exact: true }).click()
    await expect(customizer.getByRole('checkbox', { name: 'Recommended for you' })).not.toBeChecked()
    await expect(recommendations(page)).toHaveCount(0)
    release()
    await backend.settled()

    const requestCount = backend.requests.length
    await page.evaluate(async entry => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateHistory', entry)
    }, historyEntry('rechist0002'))
    await renderTurn(page)
    expect(backend.requests).toHaveLength(requestCount)
    await expect(recommendations(page)).toHaveCount(0)

    await customizer.getByText('Recommended for you', { exact: true }).click()
    await expectBothSources(backend, requestCount)
    await expect(recommendations(page).getByRole('link', { name: /Linux desktop shortcuts/ })).toBeVisible()
  } finally {
    release()
  }
})

test.describe('Home in a background tab', () => {
  test.use({
    seed: {
      settings,
      history: [
        historyEntry(),
        { ...historyEntry('rechist0002'), authorId: DISCOVERY_CHANNEL_ID, title: 'Linux window management' },
        { ...historyEntry('rechist0003'), authorId: UNRELATED_CHANNEL_ID, title: 'Desktop panel configuration' },
      ],
    },
  })

  test('aborts active related-video requests and leaves searches queued when switching away', async ({ page }) => {
    const backend = await mockCandidates(page)
    await goTo(page, 'home')
    const homeTabId = await page.locator('.tab.active').getAttribute('data-tab-id')
    const historyTab = await page.evaluate(() => window.ftElectron.tabs.create({
      route: '/history',
      makeActive: false,
      lazyLoad: true,
    }))
    const release = backend.holdResponses()
    try {
      await setEnabled(page, true)
      // Three related-video seeds occupy all workers, leaving the topic searches queued.
      await expect.poll(() => backend.requests.map(request => request.source))
        .toEqual(['related', 'related', 'related'])
      await page.locator(`.tab[data-tab-id="${historyTab.id}"]`).click()
      await expect(page).toHaveURL(/#\/history$/)
      await expect(page.locator(`.tab[data-tab-id="${homeTabId}"]`)).not.toHaveClass(/\bactive\b/)

      // Observe actual network cancellation before releasing the mock responses.
      await expect.poll(() => backend.aborted.length).toBe(3)
      release()
      await backend.settled()
      expect(backend.requests.map(request => request.source)).toEqual(['related', 'related', 'related'])

      backend.channelVideos = [video('recfresh001', 'Linux desktop fresh results')]
      backend.searchVideos = []
      await page.locator(`.tab[data-tab-id="${homeTabId}"]`).click()
      await expect(page).toHaveURL(/#\/home$/)
      await expectBothSources(backend, 3)
      await backend.settled()
      await expect(recommendations(page).getByRole('link', { name: /Linux desktop fresh results/ })).toBeVisible()
      await expect(recommendations(page).getByRole('link', { name: /Linux desktop shortcuts/ })).toHaveCount(0)
    } finally {
      release()
    }
  })
})

test.describe('watch-page recommendations hidden', () => {
  test.use({ seed: { settings: { ...settings, hideRecommendedVideos: true }, history } })

  test('controls Home recommendations independently of the watch-page toggle', async ({ page }) => {
    const backend = await mockCandidates(page)
    await goTo(page, 'home')
    const section = recommendations(page)
    await expect(section.getByRole('button', { name: 'Enable recommendations', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Customize Home', exact: true }).click()
    await expect(page.locator('.sectionCustomizer').getByText('Recommended for you', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Done', exact: true }).click()

    await setEnabled(page, true)
    await backend.settled()
    await expect(section.getByRole('link', { name: /Linux desktop shortcuts/ })).toBeVisible()
    const watchRecommendationsHidden = () => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getHideRecommendedVideos)
    expect(await watchRecommendationsHidden()).toBe(true)

    await setEnabled(page, false)
    await expect(section.locator('.recommendationFeed')).toHaveCount(0)
    expect(await watchRecommendationsHidden()).toBe(true)
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateHideRecommendedVideos', false))
    await expect(section.getByRole('button', { name: 'Enable recommendations', exact: true })).toBeVisible()
    await expect(section.locator('.recommendationFeed')).toHaveCount(0)
  })
})

test.describe('without watch history', () => {
  test.use({ seed: { settings, history: [] } })

  test('explains how to get recommendations without making candidate requests', async ({ page }) => {
    const backend = await mockCandidates(page)
    await goTo(page, 'home')
    await setEnabled(page, true)
    await expectNoHistory(page)
    await renderTurn(page)
    expect(backend.requests).toEqual([])
  })
})

for (const failedSources of [['channel', 'search', 'related'], ['channel']]) {
  test(`recovers with Refresh after ${failedSources.join(' and ')} failure`, async ({ page }) => {
    const backend = await mockCandidates(page)
    backend.failures = new Set(failedSources)
    backend.searchVideos = [searchCandidate]
    await goTo(page, 'home')
    await setEnabled(page, true)
    await expectBothSources(backend)
    await backend.settled()
    const section = recommendations(page)
    if (failedSources.length === 3) {
      await expect(section.getByRole('status')).toHaveText(UNAVAILABLE)
      await expect(section.locator('.recommendationFeed')).toHaveCount(0)
    } else {
      await expect(section.getByRole('link', { name: /Linux desktop themes/ })).toBeVisible()
      await expect(section.getByRole('link', { name: /Linux desktop shortcuts/ })).toHaveCount(0)
      await expect(section.getByText(UNAVAILABLE, { exact: true })).toHaveCount(0)
    }

    const requestCount = backend.requests.length
    backend.failures.clear()
    await section.getByRole('button', { name: REFRESH, exact: true }).click()
    await expectBothSources(backend, requestCount)
    await backend.settled()
    await expect(section.getByText(UNAVAILABLE, { exact: true })).toHaveCount(0)
    await expect(section.getByRole('link', { name: /Linux desktop shortcuts/ })).toBeVisible()
    await expect(section.getByRole('link', { name: /Linux desktop themes/ })).toBeVisible()
  })
}

for (const change of ['clearing history', 'disabling recommendations']) {
  test(`ignores delayed candidates after ${change}`, async ({ page }) => {
    const backend = await mockCandidates(page)
    const release = backend.holdResponses()
    try {
      await goTo(page, 'home')
      await setEnabled(page, true)
      await expectBothSources(backend)
      await expect(recommendations(page).getByRole('button', { name: REFRESH, exact: true })).toBeDisabled()
      if (change === 'clearing history') {
        await clearHistory(page)
        await expectNoHistory(page)
      } else {
        await setEnabled(page, false)
      }
      release()
      await backend.settled()
      await expect(recommendations(page).locator('.recommendationFeed')).toHaveCount(0)

      // Re-enable with different results: stale candidates must not reappear
      // while the new generation is loading, or remain after it completes.
      const requestCount = backend.requests.length
      backend.channelVideos = [video('recfresh001', 'Linux desktop fresh results')]
      backend.searchVideos = []
      const releaseFresh = backend.holdResponses()
      try {
        if (change === 'clearing history') {
          await page.evaluate(async entry => {
            const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
            await store.dispatch('updateHistory', entry)
          }, historyEntry('rechist0002'))
        } else {
          await setEnabled(page, true)
        }
        await expectBothSources(backend, requestCount)
        await expect(recommendations(page).getByRole('button', { name: REFRESH, exact: true })).toBeDisabled()
        await expect(recommendations(page).locator('.recommendationFeed')).toHaveCount(0)
        releaseFresh()
        await backend.settled()
        await expect(recommendations(page).getByRole('link', { name: /Linux desktop fresh results/ })).toBeVisible()
        await expect(recommendations(page).locator('.recommendationFeed .ft-list-video')).toHaveCount(1)
      } finally {
        releaseFresh()
      }
    } finally {
      release()
    }
  })
}

test('discovers related videos without title overlap and explains their origin', async ({ page }) => {
  const backend = await mockCandidates(page)
  backend.channelVideos = []
  backend.searchVideos = []
  backend.relatedVideos = [video('recgraph001', 'A tour of KDE Plasma', DISCOVERY_CHANNEL_ID)]
  await goTo(page, 'home')
  await setEnabled(page, true)
  await backend.settled()
  await expect(recommendations(page).getByRole('link', { name: /A tour of KDE Plasma/ })).toBeVisible()
  await expect(recommendations(page).getByText('Related to Linux desktop customization', { exact: true })).toBeVisible()
  const relatedRequests = backend.requests.filter(request => request.source === 'related')
  expect(relatedRequests.length).toBeGreaterThan(0)
  expect(relatedRequests.every(request => request.url.searchParams.get('fields') === 'recommendedVideos')).toBe(true)
})

test('learns from feedback across restarts and lets the user reset recommendations', async ({ app, page }) => {
  await mockCandidates(page)
  await goTo(page, 'home')
  await setEnabled(page, true)
  const section = recommendations(page)
  await expect(section.getByRole('link', { name: /Linux desktop shortcuts/ })).toBeVisible()
  await section.getByRole('button', { name: 'Not interested: Linux desktop shortcuts', exact: true }).click()
  await expect(section.getByRole('link', { name: /Linux desktop shortcuts/ })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store
    .getters.getRecommendationRecords.find(record => record.videoId === 'recchan0001')?.feedback)).toBe('dismiss')

  const relaunched = await app.relaunch()
  page = relaunched.page
  await mockCandidates(page)
  await goTo(page, 'home')
  await expect(recommendations(page).getByRole('button', { name: 'Enable recommendations', exact: true })).toHaveCount(0)
  await expect(recommendations(page).getByRole('link', { name: /Linux desktop themes/ })).toBeVisible()
  await expect(recommendations(page).getByRole('link', { name: /Linux desktop shortcuts/ })).toHaveCount(0)
  await chooseRecommendationOption(page, 'Reset recommendations')
  await expect(recommendations(page).getByRole('link', { name: /Linux desktop shortcuts/ })).toBeVisible()
  await clearHistory(page)
  await expectNoHistory(page)
  await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getRecommendationRecords.length)).toBe(0)
})

test('records real grid impressions once per feed and supports positive and channel feedback', async ({ page }) => {
  await mockCandidates(page)
  await goTo(page, 'home')
  await setEnabled(page, true)
  const section = recommendations(page)
  await section.scrollIntoViewIfNeeded()
  const getRecord = id => page.evaluate(id => document.querySelector('#app').__vue_app__.config.globalProperties.$store
    .getters.getRecommendationRecords.find(record => record.videoId === id), id)
  await expect.poll(async () => (await getRecord('recchan0001'))?.impressions?.length).toBe(1)
  await section.getByRole('button', { name: 'More like this: Linux desktop shortcuts', exact: true }).click()
  await expect.poll(async () => (await getRecord('recchan0001'))?.feedback).toBe('positive')
  const hideChannel = section.locator('.recommendationEntry').filter({ hasText: 'Linux desktop themes' })
    .getByRole('button', { name: /^Hide this channel:/ })
  await expect(hideChannel).toHaveAttribute('title', 'Hide this channel: Discovery Channel')
  await expect(hideChannel).toHaveAccessibleName('Hide this channel: Discovery Channel')
  await hideChannel.click()
  await expect(section.getByRole('link', { name: /Linux desktop themes/ })).toHaveCount(0)
  await expect.poll(async () => (await getRecord('recsrch0001'))?.feedback).toBe('blockChannel')
})

for (const avoidTranslation of ['entire_app', 'disabled', 'watch_only']) {
  test.describe(`recommendation titles with untranslated text ${avoidTranslation}`, () => {
    test.use({ seed: { settings: { ...settings, avoidTranslation }, history } })

    test('keeps feedback tooltips consistent with the displayed video title', async ({ page }) => {
      await mockCandidates(page)
      let oembedRequests = 0
      await page.route(/\/oembed\?/, route => {
        oembedRequests++
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ title: 'Original Linux video title' }) })
      })
      await goTo(page, 'home')
      await setEnabled(page, true)
      const entry = recommendations(page).locator('.recommendationEntry').filter({
        has: page.locator('a.title[href*="recchan0001"]'),
      })
      const title = avoidTranslation === 'entire_app' ? 'Original Linux video title' : 'Linux desktop shortcuts'
      await expect(entry.locator('.h3Title')).toHaveText(title)
      for (const action of ['More like this', 'Not interested']) {
        const button = entry.getByRole('button', { name: new RegExp(`^${action}:`) })
        await expect(button).toHaveAttribute('title', `${action}: ${title}`)
        await expect(button).toHaveAccessibleName(`${action}: ${title}`)
      }
      await expect(entry.getByRole('button', { name: 'Hide this channel: Linux Desktop Channel', exact: true })).toBeVisible()
      if (avoidTranslation !== 'entire_app') expect(oembedRequests).toBe(0)
      // Recreating the cards also covers the synchronous original-title cache.
      await recommendations(page).getByRole('button', { name: REFRESH, exact: true }).click()
      await expect(entry.locator('.h3Title')).toHaveText(title)
      await expect(entry.getByRole('button', { name: `More like this: ${title}`, exact: true })).toBeVisible()
    })
  })
}

test.describe('saved-video cold start', () => {
  test.use({ seed: { settings, history: [], playlists: [{ _id: 'favorites', playlistName: 'Favorites', protected: true, videos: [historyEntry()] }] } })
  test('uses favorites before the first watch and offers discovery controls', async ({ page }) => {
    const backend = await mockCandidates(page)
    await goTo(page, 'home')
    await setEnabled(page, true)
    await expectBothSources(backend)
    await expect(recommendations(page).getByRole('link', { name: /Linux desktop shortcuts/ })).toBeVisible()
    await expect(recommendations(page).getByRole('combobox', { name: 'Discovery', exact: true })).toHaveCount(0)
    await recommendations(page).locator('.recommendationOptions .iconButton').click()
    await page.getByRole('radio', { name: 'Explore', exact: true }).check()
    await page.keyboard.press('Escape')
    await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getRecommendationExploration)).toBe(0.5)
  })
})

test('syncs feedback and resets across windows even before the second window loads learning', async ({ app, page }) => {
  await mockCandidates(page)
  await goTo(page, 'home')
  await setEnabled(page, true)
  const second = await openNewWindowFromTabBar(app, page)
  await waitForAppReady(second)
  await mockCandidates(second)
  await recommendations(page).getByRole('button', { name: 'Not interested: Linux desktop shortcuts', exact: true }).click()
  const state = target => target.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return { epoch: store.getters.getRecommendationEpoch, feedback: store.getters.getRecommendationRecords.find(record => record.videoId === 'recchan0001')?.feedback ?? null }
  })
  await expect.poll(async () => (await state(second)).feedback).toBe('dismiss')
  await goTo(second, 'home')
  await expect(recommendations(second).getByRole('link', { name: /Linux desktop themes/ })).toBeVisible()
  await expect(recommendations(second).getByRole('link', { name: /Linux desktop shortcuts/ })).toHaveCount(0)
  const oldEpoch = (await state(page)).epoch
  await chooseRecommendationOption(second, 'Reset recommendations')
  await expect.poll(async () => (await state(page)).epoch).not.toBe(oldEpoch)
  await expect.poll(async () => (await state(page)).feedback).toBe(null)
  await expect(recommendations(page).getByRole('link', { name: /Linux desktop shortcuts/ })).toBeVisible()
})

test.describe('local related discovery', () => {
  test.use({ seed: { settings: { ...settings, backendPreference: 'local' }, history: [historyEntry('jNQXAC9IVRw')] } })
  test('parses recorded YouTube related videos without fetching players or streams', async ({ app, page }) => {
    await mockWatchPage(app, page)
    const requests = []
    page.on('request', request => requests.push(request.url()))
    await goTo(page, 'home')
    await setEnabled(page, true)
    await expect(recommendations(page).locator('.recommendationFeed .ft-list-video').first()).toBeVisible()
    await expect(recommendations(page).getByText('Related to Linux desktop customization', { exact: true }).first()).toBeVisible()
    await expect(recommendations(page).locator('a[href*="/watch/jNQXAC9IVRw"]')).toHaveCount(0)
    expect(requests.some(url => url.includes('/youtubei/v1/next'))).toBe(true)
    expect(requests.some(url => url.includes('/youtubei/v1/player') || url.includes('/videoplayback'))).toBe(false)
  })
})

const gridTitles = ['Kernel internals', 'Desktop shortcuts', 'Terminal commands', 'Gaming performance', 'Network setup', 'Storage tuning', 'Security basics', 'Audio production', 'Window managers', 'Package tools', 'Power management', 'Graphics drivers']
const gridVideos = gridTitles.map((title, i) => video(`recgrid${String(i).padStart(4, '0')}`, `Linux ${title}`, `UC${String(i).padStart(22, '0')}`))

async function changeLayoutSetting(page, action, value) {
  await page.evaluate(([action, value]) => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch(action, value), [action, value])
}

async function expectRecommendationScrollRange(page) {
  await expect.poll(() => page.evaluate(() => {
    const content = document.querySelector('.app > .routerView')
    const renderedEnd = content.getBoundingClientRect().bottom + window.scrollY + (Number.parseFloat(getComputedStyle(content).marginBottom) || 0)
    const maximum = Math.max(0, renderedEnd - window.innerHeight)
    const documentMaximum = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
    const scrollbar = document.querySelector('body > .os-scrollbar-vertical')
    const track = scrollbar?.querySelector('.os-scrollbar-track')?.getBoundingClientRect()
    const handle = scrollbar?.querySelector('.os-scrollbar-handle')?.getBoundingClientRect()
    const scrollbarMatches = documentMaximum <= 1
      ? scrollbar?.classList.contains('os-scrollbar-unusable')
      : track && handle && scrollbar.classList.contains('os-scrollbar-visible') &&
        Math.abs(handle.top - track.top - window.scrollY / documentMaximum * (track.height - handle.height)) <= 1
    return {
      // scrollHeight and viewport dimensions round separately at fractional zoom.
      rangeMatches: Math.abs(documentMaximum - maximum) <= 2,
      withinRange: window.scrollY <= maximum + 1,
      scrollbarMatches: Boolean(scrollbarMatches),
    }
  })).toEqual({ rangeMatches: true, withinRange: true, scrollbarMatches: true })
}

test.describe('recommendation grid and list', () => {
  test.use({ seed: { settings: { ...settings, listType: 'grid', alwaysShowScrollbars: true }, history } })

  test('uses subscription video cards, wraps rows and follows layout and thumbnail preferences', async ({ app, page }, testInfo) => {
    const backend = await mockCandidates(page)
    backend.channelVideos = gridVideos
    backend.searchVideos = []
    await goTo(page, 'home')
    await setEnabled(page, true)
    const section = recommendations(page)
    const entries = section.locator('.recommendationEntry')
    await expect(entries).toHaveCount(12)
    await expect(section.locator('[data-home-shelf]')).toHaveCount(0)
    await expect(section.locator('.ft-list-video.grid')).toHaveCount(12)
    await expect.poll(() => entries.evaluateAll(elements => new Set(elements.map(element => Math.round(element.getBoundingClientRect().top))).size)).toBeGreaterThan(1)
    const image = section.locator('.thumbnailImage').first()
    await expectImagesLoaded(section.locator('.thumbnailImage'))
    const initialWidth = (await image.boundingBox()).width
    await changeLayoutSetting(page, 'updateThumbnailSize', 140)
    await expect.poll(async () => (await image.boundingBox()).width).toBeGreaterThan(initialWidth)
    await section.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('recommendation-grid.png'), animations: 'disabled' })
    await changeLayoutSetting(page, 'updateListType', 'list')
    await expect(section.locator('.ft-list-video.list')).toHaveCount(12)
    await expect.poll(() => entries.evaluateAll(elements => new Set(elements.map(element => Math.round(element.getBoundingClientRect().left))).size)).toBe(1)
    await page.screenshot({ path: testInfo.outputPath('recommendation-list.png'), animations: 'disabled' })

    await changeLayoutSetting(page, 'updateListType', 'grid')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await changeLayoutSetting(page, 'updateBaseTheme', 'dark')
    await setWindowSize(app, page, { width: 375, height: 700 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
    await section.getByRole('button', { name: /More like this:/ }).first().scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('recommendation-grid-narrow-dark.png'), animations: 'disabled' })
  })

  for (const trigger of ['grid layout', 'window resize', 'thumbnail size', 'dismissal', 'channel hiding', 'hidden-channel filter', 'forbidden-title filter', 'live-stream filter', 'premiere filter', 'refresh', 'disable', 'section hiding', 'history clearing']) {
    test(`clamps the scrolled feed after ${trigger} at 95% scale`, async ({ app, page }) => {
      const backend = await mockCandidates(page)
      backend.channelVideos = gridVideos
      backend.searchVideos = []
      if (trigger === 'live-stream filter' || trigger === 'premiere filter') {
        backend.channelVideos = gridVideos.map((video, index) => index === gridVideos.length - 1
          ? { ...video, liveNow: trigger === 'live-stream filter', isUpcoming: trigger === 'premiere filter', premiereTimestamp: trigger === 'premiere filter' ? Math.floor(Date.now() / 1000) + 3600 : 0 }
          : video)
      }
      await goTo(page, 'home')
      await changeLayoutSetting(page, 'updateListType', 'list')
      if (trigger === 'window resize' || trigger === 'thumbnail size') {
        await changeLayoutSetting(page, 'updateListType', 'grid')
        await setWindowSize(app, page, { width: 750, height: 700 })
      }
      await setEnabled(page, true)
      await expect(recommendations(page).locator('.recommendationEntry')).toHaveCount(12)
      await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, document.documentElement.scrollHeight) })
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100)
      const before = await page.evaluate(() => window.scrollY)

      if (trigger === 'grid layout') await changeLayoutSetting(page, 'updateListType', 'grid')
      if (trigger === 'window resize') await setWindowSize(app, page, { width: 1600, height: 900 })
      if (trigger === 'thumbnail size') await changeLayoutSetting(page, 'updateThumbnailSize', 60)
      if (trigger === 'hidden-channel filter') {
        await changeLayoutSetting(page, 'updateChannelsHidden', JSON.stringify([{ name: gridVideos.at(-1).authorId, preferredName: '', icon: '' }]))
        await expect(recommendations(page).locator('.recommendationEntry')).toHaveCount(11)
      }
      if (trigger === 'forbidden-title filter') {
        await changeLayoutSetting(page, 'updateForbiddenTitles', JSON.stringify(['graphics drivers']))
        await expect(recommendations(page).locator('.recommendationEntry')).toHaveCount(11)
      }
      if (trigger === 'live-stream filter' || trigger === 'premiere filter') {
        await changeLayoutSetting(page, trigger === 'live-stream filter' ? 'updateHideLiveStreams' : 'updateHideUpcomingPremieres', true)
        await expect(recommendations(page).locator('.recommendationEntry')).toHaveCount(11)
      }
      if (trigger === 'dismissal' || trigger === 'channel hiding') {
        await recommendations(page).getByRole('button', { name: new RegExp(`^${trigger === 'dismissal' ? 'Not interested' : 'Hide this channel'}:`) }).last().evaluate(button => button.click())
        await expect(recommendations(page).locator('.recommendationEntry')).toHaveCount(11)
      }
      if (trigger === 'refresh') {
        backend.channelVideos = gridVideos.slice(0, 2)
        await recommendations(page).getByRole('button', { name: REFRESH, exact: true }).evaluate(button => button.click())
        await expect(recommendations(page).locator('.recommendationEntry')).toHaveCount(2)
      }
      if (trigger === 'disable') await changeLayoutSetting(page, 'updateEnableHomeRecommendations', false)
      if (trigger === 'section hiding') await changeLayoutSetting(page, 'updateHomeSectionLayout', [{ id: 'recommendations', visible: false }])
      if (trigger === 'history clearing') await clearHistory(page)
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(before - 1)
      await expectRecommendationScrollRange(page)
    })
  }
})

for (const linkType of ['title', 'thumbnailLink']) {
  test(`records recommendation clicks from the standard ${linkType} link`, async ({ page }) => {
    await mockCandidates(page)
    await goTo(page, 'home')
    await setEnabled(page, true)
    const card = recommendations(page).locator('.ft-list-video').filter({ hasText: 'Linux desktop shortcuts' })
    await card.locator(`a.${linkType}`).click()
    await expect(page).toHaveURL(/#\/watch\/recchan0001/)
    await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getRecommendationRecords
      .find(record => record.videoId === 'recchan0001')?.clickedAt ?? 0)).toBeGreaterThan(0)
  })
}

test('moves the explanation into a keyboard-accessible tooltip after enabling', async ({ app, page }, testInfo) => {
  await mockCandidates(page)
  await goTo(page, 'home')
  const section = recommendations(page)
  await expect(section.locator('.recommendationIntroduction')).toContainText('Rank videos on your device using your watch history.')
  await expect(section.getByRole('checkbox', { name: 'Enable recommendations', exact: true })).toHaveCount(0)
  await expect(section.locator('.recommendationInfo')).toHaveCount(0)
  await setEnabled(page, true)
  await expect(section.getByRole('link', { name: /Linux desktop shortcuts/ })).toBeVisible()
  await expect(section.locator('.recommendationIntroduction')).toHaveCount(0)
  await expect(section.getByRole('button', { name: 'Enable recommendations', exact: true })).toHaveCount(0)
  const info = section.locator('.recommendationInfo button')
  const tooltip = page.getByRole('tooltip').filter({ hasText: 'Video IDs are also sent to find related videos.' })
  await expect(tooltip).toBeHidden()
  await info.focus()
  await expect(tooltip).toBeVisible()
  await expect(tooltip).toContainText('Channel IDs and topic searches are sent to your selected backend')
  await page.keyboard.press('Tab')
  await expect(tooltip).toBeHidden()
  await info.hover()
  await expect(tooltip).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('recommendation-info-tooltip.png'), animations: 'disabled' })
  await page.mouse.move(0, 0)
  await expect(tooltip).toBeHidden()
  await setWindowSize(app, page, { width: 375, height: 700 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await info.focus()
  await expect(tooltip).toBeVisible()
  const bounds = await tooltip.boundingBox()
  const viewportWidth = await page.evaluate(() => window.innerWidth)
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewportWidth)
  await page.keyboard.press('Tab')
  await setEnabled(page, false)
  await expect(section.locator('.recommendationIntroduction')).toBeVisible()
})

test('provides a custom discovery selector and separate actions with keyboard navigation', async ({ app, page }, testInfo) => {
  await mockCandidates(page)
  await goTo(page, 'home')
  await setEnabled(page, true)
  const section = recommendations(page)
  await expect(section.getByRole('link', { name: /Linux desktop shortcuts/ })).toBeVisible()
  await expect(section.locator('.recommendationControls')).toHaveCount(0)
  await expect(section.getByRole('button', { name: 'Reset recommendations', exact: true })).toHaveCount(0)
  const menu = section.locator('.recommendationOptions .iconButton')
  const panel = page.locator('.recommendationOptionsPopover')
  const balanced = panel.getByRole('radio', { name: 'Balanced', exact: true })
  const explore = panel.getByRole('radio', { name: 'Explore', exact: true })
  const familiar = panel.getByRole('radio', { name: 'Familiar', exact: true })
  const description = panel.locator('.recommendationDiscoveryDescriptions p.active')
  await menu.focus()
  await page.keyboard.press('Enter')
  await expect(panel.getByRole('group', { name: 'Discovery', exact: true })).toBeVisible()
  await expect(balanced).toBeChecked()
  await expect(description).toHaveText('Mix familiar channels with new ones that match your interests.')
  await expect(balanced).toHaveAccessibleDescription('Mix familiar channels with new ones that match your interests.')
  await expect(familiar).toHaveAccessibleDescription('Favor unwatched videos from channels you already enjoy.')
  await expect(explore).toHaveAccessibleDescription('Give more space to new channels related to your interests.')
  await expect(panel.locator('.recommendationDiscoveryChoice .ft-icon')).toHaveCount(3)
  await expect(panel.locator('.recommendationDiscoveryChoice [data-icon-pack="material"] svg')).toHaveCount(3)
  await expect(panel.getByRole('button', { name: 'Turn off recommendations', exact: true })).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(balanced).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(explore).toBeFocused()
  await expect(explore).toBeChecked()
  await expect(description).toHaveText('Give more space to new channels related to your interests.')
  await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getRecommendationExploration)).toBe(0.5)
  // Changing Discovery keeps the control open, so it can be adjusted again.
  await expect(panel).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(panel.getByRole('button', { name: 'Reset recommendations', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toBeFocused()
  await expect(panel).toHaveCount(0)
  await menu.click()
  await expect(explore).toBeChecked()
  await changeLayoutSetting(page, 'updateBaseTheme', 'light')
  await page.screenshot({ path: testInfo.outputPath('recommendation-options-light.png'), animations: 'disabled' })
  await section.locator('.recommendationInfo button').click()
  await expect(panel).toHaveCount(0)
  await page.keyboard.press('Tab')
  await changeLayoutSetting(page, 'updateBaseTheme', 'dark')
  await changeLayoutSetting(page, 'updateIconPack', 'remix')
  await setWindowSize(app, page, { width: 375, height: 700 })
  await menu.click()
  await expect(explore).toBeChecked()
  const initialHeight = (await panel.boundingBox()).height
  await expect(panel.locator('.recommendationDiscoveryChoice [data-icon-pack="remix"] svg')).toHaveCount(3)
  await familiar.check()
  await expect(description).toHaveText('Favor unwatched videos from channels you already enjoy.')
  expect((await panel.boundingBox()).height).toBeCloseTo(initialHeight, 0)
  await balanced.check()
  await expect(description).toHaveText('Mix familiar channels with new ones that match your interests.')
  expect((await panel.boundingBox()).height).toBeCloseTo(initialHeight, 0)
  await explore.check()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  const bounds = await panel.boundingBox()
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height)
  await page.screenshot({ path: testInfo.outputPath('recommendation-options-narrow-dark.png'), animations: 'disabled' })
  await panel.getByRole('button', { name: 'Turn off recommendations', exact: true }).click()
  await expect(panel).toHaveCount(0)
  await expect(section.getByRole('button', { name: 'Enable recommendations', exact: true })).toBeVisible()
})

test('keeps the discovery heading fixed while its constrained menu scrolls and shrinks', async ({ app, page }) => {
  await mockCandidates(page)
  await goTo(page, 'home')
  await setEnabled(page, true)
  await setWindowSize(app, page, { width: 700, height: 300 })
  await recommendations(page).locator('.recommendationOptions .iconButton').click()
  const panel = page.locator('.recommendationOptionsPopover')
  const header = panel.getByText('Discovery', { exact: true })
  const before = await header.boundingBox()
  // Use the actual scrollable element, including the old implementation.
  await panel.evaluate(element => {
    const scroller = element.querySelector('.iconDropdownContent') ?? element
    scroller.scrollTop = scroller.scrollHeight
  })
  await expect.poll(async () => (await header.boundingBox()).y).toBeCloseTo(before.y, 0)
  const scroller = panel.locator('.iconDropdownContent')
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await setWindowSize(app, page, { width: 800, height: 700 })
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
  await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1)
  await expect(scroller.locator('.os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
})
