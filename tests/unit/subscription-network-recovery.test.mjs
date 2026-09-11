import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { shallowReactive } from 'vue'
import { createI18n } from 'vue-i18n'
import { load } from 'js-yaml'
import { YTNodes } from 'youtubei.js'

import { createNetworkRecovery } from '../../src/renderer/helpers/networkRecovery.js'
import { createAbortError } from '../../src/renderer/helpers/api/requestErrors.js'
import { createSubscriptionNetworkRecovery, SubscriptionNetworkError } from '../../src/renderer/helpers/subscriptionNetworkRecovery.js'
import { mapConcurrently } from '../../src/renderer/helpers/concurrent-map.js'
import { buildRequestDiagnostic, classifyRequestFailure, formatRequestDiagnostic } from '../../src/renderer/helpers/api/requestDiagnostics.js'
import { getSubscriptionsForFeed } from '../../src/renderer/helpers/subscription-channels.js'
import { extractAssignedJsonObject } from '../../src/renderer/helpers/assigned-json.js'
import { getSubscriptionVideoSortTimestamp, updateUpcomingPremiereState, reconcileFetchedSubscriptionEntries } from '../../src/renderer/helpers/subscription-entries.js'

const localSource = await readFile(new URL('../../src/renderer/helpers/api/local.js', import.meta.url), 'utf8')
const shortsParserSource = localSource.slice(localSource.indexOf('export function parseShort('), localSource.indexOf('export function parseLocalListPlaylist('))
  .replace(/^export /gm, '')

const networkSource = (await readFile(new URL('../../src/renderer/helpers/networkRecovery.js', import.meta.url), 'utf8'))
  .replace(/^import .* from .*\n/gm, '').replace(/^export /gm, '')

const source = (await readFile(new URL('../../src/renderer/helpers/subscriptions.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
  .replace(/^export /gm, '')

// Exercise the real refresh, fallback, cache, and notification paths with fake
// platform APIs. Webpack-only imports are supplied in the isolated context.
function createRefresh({ online = true, feed = 'Shorts', error = new TypeError('Failed to fetch'), webCors = false, backend = 'local', fallbackWorks = false, rssStatus = 200, channelInfo = { has_shorts: true, getShorts: async () => ({ videos: [] }) }, playlistError = null, stallChannelProbe = false, channelStatus = rssStatus, scraperError = null, shortPublishDate = '2026-09-06T12:00:00Z', beforeShortMetadata = async () => {} } = {}) {
  const window = new EventTarget()
  const navigator = { onLine: online }
  const toasts = []
  const copied = []
  const subscriptionRefreshErrors = { value: null }
  const requests = []
  const fallbackRequests = []
  const writes = []
  const events = []
  let fail = !webCors
  const getters = {
    getActiveProfile: { _id: 'all', subscriptions: Array.from({ length: 20 }, (_, i) => ({ id: `UC${i}` })) },
    getBackendPreference: backend,
    getBackendFallback: true,
    getUseRssFeeds: true,
    getCurrentInvidiousInstanceUrl: 'https://invidious.example',
    getVideoCache: {},
    getShortsCache: {},
    getLiveCache: {},
    getPostsCache: {},
  }
  for (const event of ['completed', 'finished']) {
    window.addEventListener(`opentubex-subscription-refresh-${event}`, () => events.push(event))
  }
  const fetchChannel = async url => {
    requests.push(url)
    if (fail) throw typeof error === 'function' ? error(url) : error
    if (url.includes('/watch?v=')) {
      await beforeShortMetadata()
      const videoId = new URL(url).searchParams.get('v')
      return { ok: true, status: 200, text: async () => `var ytInitialPlayerResponse = ${JSON.stringify({
        videoDetails: { videoId },
        microformat: { playerMicroformatRenderer: { publishDate: shortPublishDate } }
      })};` }
    }
    return { videos: [], posts: [], status: url.includes('/feed/channel/') ? channelStatus : rssStatus, text: async () => '<feed/>' }
  }
  const fetchFallback = async url => {
    fallbackRequests.push(url)
    return { videos: [], posts: [], status: 200, text: async () => '<feed/>' }
  }
  const fetchLocal = fallbackWorks && backend === 'invidious' ? fetchFallback : fetchChannel
  const fetchInvidious = fallbackWorks && backend === 'local' ? fetchFallback : fetchChannel
  const context = vm.createContext({
    shallowReactive, subscriptionRefreshErrors, window, navigator, CustomEvent, AbortController, AbortSignal, Request, Response, URL, EventTarget, createAbortError,
    location: { href: 'https://localhost/', origin: 'https://localhost' }, setTimeout, clearTimeout, console: { error() {}, warn() {} },
    process: { env: { IS_CAPACITOR: true, SUPPORTS_LOCAL_API: true } },
    store: {
      getters,
      commit(key, value) { if (key === 'setSubscriptionFeedRefreshInProgress') getters.getSubscriptionFeedRefreshInProgress = value },
      async dispatch(key, value) { writes.push({ key, value }) },
    },
    createSubscriptionNetworkRecovery, SubscriptionNetworkError,
    mapConcurrently, buildRequestDiagnostic, classifyRequestFailure, formatRequestDiagnostic, getSubscriptionsForFeed,
    reconcileFetchedSubscriptionEntries, extractAssignedJsonObject, getSubscriptionVideoSortTimestamp, updateUpcomingPremiereState,
    isAndroidSubscriptionRefreshActive: async () => false,
    includeAutomaticDownloadChannels: channels => channels,
    startAutomaticDownloadsForChannel: async () => {},
    getChannelPlaylistId: id => id,
    showApiErrorToast: (...args) => toasts.push(args),
    copyToClipboard: text => copied.push(text),
    showToast: (...args) => {
      toasts.push(args)
      return {
        startTimeout(time) {
          args[0].time = time
        }
      }
    },
    localApiFetch: fetchLocal,
    fetch: webCors ? async () => { throw new TypeError('Failed to fetch') } : fetchChannel,
    invidiousFetch: fetchInvidious,
    getLocalChannelVideos: async url => { if (scraperError) throw scraperError; return fetchLocal(url) },
    getLocalChannelLiveStreams: async url => { if (scraperError) throw scraperError; return fetchLocal(url) },
    getInvidiousChannelVideos: async url => { if (scraperError) throw scraperError; return fetchInvidious(url) },
    getInvidiousChannelLive: async url => { if (scraperError) throw scraperError; return fetchInvidious(url) },
    getLocalChannelCommunity: async id => (await fetchLocal(id)).posts,
    invidiousGetCommunityPosts: fetchInvidious,
    getLocalChannel: async () => channelInfo,
    getLocalPlaylist: async () => { if (playlistError) throw playlistError; return { items: [] } },
    parseLocalPlaylistVideos: () => [],
    mergeSubscriptionShortThumbnails: videos => videos,
    DOMParser: class {
      parseFromString() {
        return { querySelector: () => ({ textContent: 'Channel' }), querySelectorAll: () => [] }
      }
    },
  })
  vm.runInContext(shortsParserSource, context)
  vm.runInContext(networkSource, context)
  const sharedRecovery = vm.runInContext('initializeNetworkRecovery()', context)
  context.createSubscriptionNetworkRecovery = options => createSubscriptionNetworkRecovery({ ...options, recovery: sharedRecovery })
  const wrap = (url, init, task) => vm.runInContext('withNetworkRecovery', context)(url, init, task)
  context.localApiFetch = (url, init) => wrap(url, init, () => fetchLocal(url))
  context.invidiousFetch = (url, signal) => wrap(url, { signal }, () => fetchInvidious(url))
  if (stallChannelProbe) {
    context.fetch = (url, init) => new Promise((resolve, reject) => {
      requests.push(url)
      init?.signal?.addEventListener('abort', () => reject(createAbortError()), { once: true })
    })
  }
  vm.runInContext(`${source}\nglobalThis.api = { refreshSubscriptionVideosFromRemote, refreshSubscriptionShortsFromRemote, refreshSubscriptionLiveFromRemote, refreshSubscriptionPostsFromRemote, cancelSubscriptionRefresh, updateVideoListAfterProcessing }`, context)
  return {
    get details() { return [...subscriptionRefreshErrors.value.values()].map(channel => channel.trace).join('\n') },
    ...context.api, refresh: context.api[`refreshSubscription${feed}FromRemote`], navigator, requests, fallbackRequests, toasts, copied, writes, events, getters, recovery: sharedRecovery,
    reconnect() {
      fail = false
      navigator.onLine = true
      window.dispatchEvent(new Event('online'))
    },
  }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 30))

test('mobile Shorts refresh waits offline without requests or error toasts, then resumes', async () => {
  const app = createRefresh({ online: false })
  const refresh = app.refresh({ t: key => key })
  try {
    await settle()
    assert.equal(app.requests.length, 0)
    assert.equal(app.toasts.length, 0)
    assert.deepEqual(app.events, [])
    app.reconnect()
    await refresh
    assert.equal(app.requests.length, 20)
    assert.deepEqual(app.events, ['completed', 'finished'])
    assert.equal(app.writes.filter(write => write.key.endsWith('CacheByChannel')).length, 20)
  } finally {
    app.cancelSubscriptionRefresh()
    await refresh
  }
})

for (const feed of ['Videos', 'Shorts', 'Live', 'Posts']) {
  test(`mobile ${feed} connection failure pauses the channel queue and fallbacks without toast spam`, async () => {
    const app = createRefresh({ feed })
    const refresh = app.refresh({ t: key => key })
    try {
      await settle()
      assert.equal(app.requests.length, 8, 'only already-running channel requests may fail')
      assert.equal(app.recovery.state, 'online', 'a failed refresh is not a device-wide outage')
      assert.equal(app.toasts.length, 0)
      assert.equal(app.writes.length, 0)
      assert.deepEqual(app.events, [])
      assert.equal(app.getters.getSubscriptionFeedRefreshInProgress, true)
      assert.equal(await app.refresh({ t: key => key }), null, 'another refresh cannot restart the paused queue')
      assert.equal(app.requests.length, 8)
      app.reconnect()
      await refresh
      assert.equal(app.requests.length, 28, 'failed channels must be retried after reconnection')
      assert.deepEqual(app.events, ['completed', 'finished'])
      assert.equal(app.writes.filter(write => write.key.endsWith('CacheByChannel')).length, 20)
    } finally {
      app.cancelSubscriptionRefresh()
      await refresh
    }
  })
}

for (const online of [false, true]) {
  test(`cancelling a refresh waiting ${online ? 'to retry' : 'offline'} releases ownership without marking it complete`, async () => {
    const app = createRefresh({ online })
    const refresh = app.refresh({ t: key => key })
    await settle()
    app.cancelSubscriptionRefresh()
    assert.equal(await refresh, null)
    assert.equal(app.getters.getSubscriptionFeedRefreshInProgress, false)
    assert.deepEqual(app.events, ['finished'])
    assert.equal(app.toasts.length, 0)
    assert.equal(app.writes.filter(write => write.key.endsWith('CacheByChannel')).length, 0)

    app.reconnect()
    await app.refresh({ t: key => key })
    assert.deepEqual(app.events, ['finished', 'completed', 'finished'])
    assert.equal(app.requests.length, online ? 28 : 20)
  })
}

for (const error of [404, 500, 503].map(status => Object.assign(new Error(`HTTP ${status}`), { status })).concat(new SyntaxError('Invalid JSON'))) {
  test(`${error.message} keeps the existing error and fallback behavior`, async () => {
    const app = createRefresh({ error })
    await app.refresh({ t: key => key })
    assert.equal(app.requests.length, 40)
    assert.equal(app.toasts.length, 1)
    assert.equal(app.recovery.state, 'online')
    assert.deepEqual(app.events, ['completed', 'finished'])
  })
}

async function flushPromises() {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}

for (const allowFallback of [false, true]) {
  test(`an unreported outage probes one channel with capped backoff with fallback ${allowFallback ? 'enabled' : 'disabled'}`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const eventTarget = new EventTarget()
    const recovery = createSubscriptionNetworkRecovery({ recovery: createNetworkRecovery({ eventTarget, isOnline: () => true }), allowFallback })
    let failed = true
    const attempts = []
    const run = id => recovery.run(async () => {
      attempts.push(id)
      if (failed) throw new SubscriptionNetworkError(new TypeError('Failed to fetch'))
    })
    const tasks = [run(1), run(2), run(3)]
    try {
      await flushPromises()
      assert.deepEqual(attempts, [1, 2, 3])
      for (const delay of [5000, 10000, 20000, 40000, 60000, 60000]) {
        const count = attempts.length
        t.mock.timers.tick(delay - 1)
        await flushPromises()
        assert.equal(attempts.length, count)
        t.mock.timers.tick(1)
        await flushPromises()
        assert.equal(attempts.length, count + (allowFallback ? 2 : 1), 'one channel probes the enabled backends for the entire queue')
        assert.equal(attempts.at(-1), 1)
      }
      failed = false
      t.mock.timers.tick(60000)
      await Promise.all(tasks)
      assert.deepEqual(attempts.slice(-3), [1, 2, 3])
    } finally {
      recovery.cancel()
      await Promise.all(tasks)
    }
  })
}

test('going offline during backoff stops probes until an online event', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const eventTarget = new EventTarget()
  let online = true
  let attempts = 0
  const recovery = createSubscriptionNetworkRecovery({ recovery: createNetworkRecovery({ eventTarget, isOnline: () => online }) })
  const task = recovery.run(async () => {
    attempts++
    if (attempts === 1) throw new SubscriptionNetworkError(new TypeError('Failed to fetch'))
  })
  try {
    await flushPromises()
    online = false
    eventTarget.dispatchEvent(new Event('offline'))
    t.mock.timers.tick(120000)
    await flushPromises()
    assert.equal(attempts, 1)
    online = true
    eventTarget.dispatchEvent(new Event('online'))
    await task
    assert.equal(attempts, 2)
  } finally {
    recovery.cancel()
    await task
  }
})

for (const feed of ['Videos', 'Shorts', 'Live']) {
  test(`mobile ${feed} RSS refresh uses native HTTP when WebView CORS blocks YouTube`, async () => {
    const app = createRefresh({ feed, webCors: true })
    const refresh = app.refresh({ t: key => key })
    try {
      await settle()
      assert.equal(app.writes.filter(write => write.key.endsWith('CacheByChannel')).length, 20)
      assert.equal(app.toasts.length, 0)
      assert.deepEqual(app.events, ['completed', 'finished'])
    } finally {
      app.cancelSubscriptionRefresh()
      await refresh
    }
  })
}

for (const feed of ['Videos', 'Shorts', 'Live', 'Posts']) {
  for (const backend of ['local', 'invidious']) {
    test(`mobile ${feed} recovers through the alternate backend when ${backend} is unreachable`, async t => {
      t.mock.timers.enable({ apis: ['setTimeout'] })
      const app = createRefresh({ feed, backend, fallbackWorks: true })
      const refresh = app.refresh({ t: key => key })
      try {
        await flushPromises()
        assert.equal(app.requests.length, 8)
        assert.equal(app.fallbackRequests.length, 0, 'no fallback burst before backoff')
        t.mock.timers.tick(5000)
        await flushPromises()
        assert.ok(app.fallbackRequests.length > 0, 'recovery must try the reachable fallback')
        for (let i = 0; i < 30; i++) {
          t.mock.timers.tick(1000)
          await flushPromises()
        }
        assert.equal(app.writes.filter(write => write.key.endsWith('CacheByChannel')).length, 20)
        assert.equal(app.requests.length, 9, 'reuse the working backend for the rest of this refresh')
        assert.equal(app.toasts.length, 0)
        assert.deepEqual(app.events, ['completed', 'finished'])
      } finally {
        app.cancelSubscriptionRefresh()
        for (let i = 0; i < 30; i++) {
          t.mock.timers.runAll()
          await flushPromises()
        }
        await refresh
      }
    })
  }
}

test('missing Android Shorts feeds do not flood the screen with per-channel API errors', async () => {
  const app = createRefresh({ error: Object.assign(new Error('https://www.youtube.com/feeds/videos.xml'), { code: 'FileNotFoundException' }) })
  await app.refresh({ t: key => key })
  assert.ok(app.toasts.length <= 1, `expected at most one error notification, received ${app.toasts.length}`)
})

for (const feed of ['Videos', 'Shorts', 'Live']) {
  test(`${feed} RSS 404 falls back to the API without marking existing channels unavailable`, async () => {
    const app = createRefresh({ feed, rssStatus: 404 })
    app.reconnect()
    const errorChannels = []
    await app.refresh({ t: key => key, errorChannels })
    assert.deepEqual(errorChannels, [])
    assert.equal(app.toasts.length, 0)
    assert.equal(app.writes.filter(write => write.key.endsWith('CacheByChannel')).length, 20)
  })
}

test('Shorts refresh loads the channel tab when its automatic playlist does not exist', async () => {
  const channelId = 'UCvNL_YC5NbOcoqSjjJSTzSA'
  let tabRequests = 0
  const app = createRefresh({
    rssStatus: 404,
    playlistError: new Error('The playlist does not exist.'),
    channelInfo: {
      has_shorts: true,
      async getShorts() {
        tabRequests++
        return { videos: [new YTNodes.ReelItem({
          videoId: 'C9wafAQcub0',
          headline: { simpleText: 'CAIVA Short' },
          thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/C9wafAQcub0/hqdefault.jpg' }] },
        }), new YTNodes.ReelItem({ videoId: 'cached-short', headline: { simpleText: 'Older Short' }, thumbnail: { thumbnails: [] } })] }
      }
    }
  })
  app.getters.getActiveProfile.subscriptions = [{ id: channelId, name: 'CAIVA' }]
  app.getters.getBackendFallback = false
  const cachedPublished = Date.parse('2026-09-01T12:00:00Z')
  app.getters.getShortsCache[channelId] = {
    timestamp: new Date('2026-09-05T12:00:00Z'),
    videos: [{ videoId: 'cached-short', published: cachedPublished }]
  }
  app.reconnect()
  const errorChannels = []
  await app.refresh({ t: key => key, errorChannels })
  assert.equal(app.toasts.length, 0)
  assert.deepEqual(errorChannels, [])
  assert.equal(tabRequests, 1)
  const update = app.writes.find(write => write.key === 'updateSubscriptionShortsCacheByChannel')
  assert.equal(update?.value.channelId, channelId)
  assert.equal(update.value.videos.length, 2)
  assert.equal(update.value.videos[0].videoId, 'C9wafAQcub0')
  assert.equal(update.value.videos[0].authorId, channelId)
  assert.equal(update.value.videos[0].author, 'CAIVA')
  assert.equal(update.value.videos[0].isShort, true)
  assert.equal(update.value.videos[0].published, Date.parse('2026-09-06T12:00:00Z'))
  assert.equal(update.value.videos[0].isNewInSubscriptionFeed, true)
  assert.equal(update.value.videos[1].published, cachedPublished)
  assert.equal(app.requests.filter(url => url.includes('/watch?v=')).length, 1)
  const sorted = app.updateVideoListAfterProcessing([
    { videoId: 'middle', published: Date.parse('2026-09-03T12:00:00Z') },
    ...update.value.videos
  ])
  assert.equal(sorted.map(video => video.videoId).join(','), 'C9wafAQcub0,middle,cached-short')
})

test('Shorts fallback overlaps date requests with bounded concurrency and preserves tab order', async () => {
  let active = 0
  let peak = 0
  const videoIds = Array.from({ length: 7 }, (_, i) => `short-${i}`)
  const app = createRefresh({
    rssStatus: 404,
    playlistError: new Error('The playlist does not exist.'),
    channelInfo: {
      has_shorts: true,
      getShorts: async () => ({ videos: videoIds.map(videoId => new YTNodes.ReelItem({
        videoId, headline: { simpleText: videoId }, thumbnail: { thumbnails: [] }
      })) })
    },
    async beforeShortMetadata() {
      active++
      peak = Math.max(peak, active)
      await new Promise(resolve => setImmediate(resolve))
      active--
    }
  })
  app.getters.getActiveProfile.subscriptions = [{ id: 'UC-test' }]
  app.getters.getBackendFallback = false
  app.reconnect()
  await app.refresh({ t: key => key })
  assert.ok(peak > 1, 'date requests should overlap')
  assert.ok(peak <= 3, 'date requests must respect the enrichment concurrency limit')
  assert.equal(active, 0)
  assert.equal(app.toasts.length, 0)
  const update = app.writes.find(write => write.key === 'updateSubscriptionShortsCacheByChannel')
  assert.equal(update.value.videos.map(video => video.videoId).join(','), videoIds.join(','))
  assert.ok(update.value.videos.every(video => Number.isFinite(video.published)))
})

for (const failure of ['playlist request', 'Shorts tab request', 'publication date']) {
  test(`Shorts refresh preserves errors from a failed ${failure}`, async () => {
    let tabRequests = 0
    const app = createRefresh({
      rssStatus: 404,
      shortPublishDate: null,
      playlistError: new Error(failure === 'playlist request' ? 'Request rejected' : 'The playlist does not exist.'),
      channelInfo: {
        has_shorts: true,
        async getShorts() {
          tabRequests++
          if (failure !== 'publication date') throw new Error('Request rejected')
          return { videos: [new YTNodes.ReelItem({
            videoId: 'short-without-date', headline: { simpleText: 'Short' }, thumbnail: { thumbnails: [] }
          })] }
        }
      }
    })
    app.getters.getActiveProfile.subscriptions = [{ id: 'UC-test' }]
    app.getters.getBackendFallback = false
    app.reconnect()
    await app.refresh({ t: key => key })
    assert.equal(tabRequests, failure === 'playlist request' ? 0 : 1)
    assert.equal(app.toasts.length, 1)
    app.toasts[0][0].action()
    assert.match(app.details, failure === 'publication date' ? /Could not load the publication date/ : /Request rejected/)
    assert.equal(app.writes.filter(write => write.key.endsWith('CacheByChannel')).length, 0)
  })
}

test('a channel without Shorts is empty without an API error or an unavailable-channel warning', async () => {
  const app = createRefresh({ rssStatus: 404, channelInfo: { has_shorts: false }, playlistError: new Error('This playlist does not exist.') })
  app.reconnect()
  const errorChannels = []
  await app.refresh({ t: key => key, errorChannels })
  assert.equal(app.toasts.length, 0)
  assert.deepEqual(errorChannels, [])
  assert.equal(app.writes.filter(write => write.key.endsWith('CacheByChannel')).length, 20)
})

for (const feed of ['Videos', 'Shorts', 'Live']) {
  test(`cancelling ${feed} releases a stalled secondary Invidious channel probe`, async t => {
    const app = createRefresh({ feed, backend: 'invidious', rssStatus: 404, stallChannelProbe: true })
    app.reconnect()
    const pending = app.refresh({ t: key => key })
    await flushPromises()
    assert.ok(app.requests.some(url => url.includes('/feed/channel/')))
    app.cancelSubscriptionRefresh()
    const result = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve('stuck'), 100))])
    assert.equal(result, null)
    assert.equal(app.getters.getSubscriptionFeedRefreshInProgress, false)
    assert.deepEqual(app.events, ['finished'])
  })
}

for (const feed of ['Videos', 'Shorts', 'Live']) {
  for (const backend of ['local', 'invidious']) {
    for (const status of [403, 500, 503]) {
      test(`${backend} ${feed} RSS HTTP ${status} produces one error toast without a connection banner`, async () => {
        const app = createRefresh({ feed, backend, rssStatus: status, scraperError: Object.assign(new Error(`HTTP ${status}`), { status }) })
        app.reconnect()
        await app.refresh({ t: key => key, errorChannels: [] })
        assert.equal(app.toasts.length, 1)
        app.toasts[0][0].action()
        assert.match(app.details, new RegExp(`HTTP ${status}`))
        assert.equal(app.recovery.state, 'online')
        assert.deepEqual(app.events, ['completed', 'finished'])
      })
    }
  }
}

for (const feed of ['Videos', 'Shorts', 'Live']) {
  for (const status of [404, 500]) {
    test(`${feed} failed Invidious channel verification HTTP ${status} reports one toast`, async () => {
      const app = createRefresh({ feed, backend: 'invidious', rssStatus: 404, channelStatus: status, scraperError: Object.assign(new Error(`HTTP ${status}`), { status }) })
      app.getters.getBackendFallback = false
      app.reconnect()
      const errorChannels = []
      await app.refresh({ t: key => key, errorChannels })
      assert.equal(app.toasts.length, 1)
      app.toasts[0][0].action()
      assert.match(app.details, new RegExp(`HTTP ${status}`))
      assert.equal(app.recovery.state, 'online')
      assert.equal(errorChannels.length, status === 404 ? 20 : 0)
    })
  }
}

const translateSummary = createI18n({
  legacy: false,
  locale: 'en-US',
  messages: { 'en-US': load(await readFile(new URL('../../static/locales/en-US.yaml', import.meta.url), 'utf8')) }
}).global.t

test('one compact refresh notification retains every failed channel and distinct diagnostic', async () => {
  const app = createRefresh({ error: Object.assign(new Error('HTTP 500'), { status: 500 }) })
  await app.refresh({ t: translateSummary })
  assert.equal(app.toasts.length, 1)
  const toast = app.toasts[0][0]
  assert.equal(toast.time, 10000, 'completion must start the visible timeout indicator')
  assert.equal(toast.message(), 'Channels that could not be refreshed: UC0, UC1, UC2 and 17 more. Click to view details.')
  assert.ok(toast.message().length < 100)
  toast.action()
  assert.equal(app.copied.length, 0, 'opening details must not overwrite the clipboard')
  for (let i = 0; i < 20; i++) assert.match(app.details, new RegExp(`UC${i}:`))
  assert.match(app.details, /HTTP 500/)
  assert.match(app.details, /backend=YouTube RSS/)
  assert.match(app.details, /backend=Invidious RSS/)
  assert.equal(new Set(app.details.split('\n')).size, app.details.split('\n').length)
})

for (const feed of ['Videos', 'Shorts', 'Live', 'Posts']) {
  test(`${feed} HTTP failures recovered by fallback do not appear in the summary`, async () => {
    const app = createRefresh({ feed, error: Object.assign(new Error('HTTP 500'), { status: 500 }), fallbackWorks: true })
    await app.refresh({ t: translateSummary })
    assert.equal(app.toasts.length, 0)
    assert.equal(app.writes.filter(write => write.key.endsWith('CacheByChannel')).length, 20)
  })
}

test('two confirmed unavailable channels are both named in the notification and details', async () => {
  const app = createRefresh({ rssStatus: 404, channelInfo: { alert: 'This channel does not exist.' } })
  app.getters.getActiveProfile.subscriptions = [{ id: 'UCfirst', name: 'First channel' }, { id: 'UCsecond', name: 'Second channel' }]
  app.reconnect()
  await app.refresh({ t: translateSummary })
  assert.equal(app.toasts.length, 1)
  assert.equal(app.toasts[0][0].message(), 'Channels that could not be refreshed: First channel, Second channel. Click to view details.')
  app.toasts[0][0].action()
  assert.match(app.details, /First channel \(UCfirst\)/)
  assert.match(app.details, /Second channel \(UCsecond\)/)
})

for (const feed of ['Videos', 'Shorts', 'Live', 'Posts']) {
  test(`${feed} unrecovered failures preserve cached entries and report all channels`, async () => {
    const app = createRefresh({ feed, error: Object.assign(new Error('HTTP 500'), { status: 500 }) })
    await app.refresh({ t: translateSummary })
    assert.equal(app.writes.filter(write => write.key.endsWith('CacheByChannel')).length, 0)
    assert.equal(app.toasts.length, 1)
    assert.equal(app.toasts[0][0].message(), 'Channels that could not be refreshed: UC0, UC1, UC2 and 17 more. Click to view details.')
  })
}


test('confirmed HTTP failures stay accessible while another channel retries and after cancellation', async () => {
  const app = createRefresh({ error: url => url.includes('UC0')
    ? Object.assign(new Error('HTTP 500'), { status: 500 })
    : new TypeError('Failed to fetch') })
  app.getters.getActiveProfile.subscriptions = [{ id: 'UC0' }, { id: 'UC1' }]
  const refresh = app.refresh({ t: translateSummary })
  try {
    await settle()
    assert.deepEqual(app.events, [])
    assert.equal(app.toasts.length, 1, 'the finished HTTP failure must not wait for network recovery')
    app.toasts[0][0].action()
    assert.match(app.details, /UC0:/)
    assert.doesNotMatch(app.details, /UC1:/)
    app.cancelSubscriptionRefresh()
    await refresh
    assert.equal(app.toasts.length, 1)
    assert.equal(app.toasts[0][0].time, Infinity, 'opening the details must prevent a stale timeout update')
  } finally {
    app.cancelSubscriptionRefresh()
    await refresh
  }
})

for (const count of [1, 3, 4, 5]) {
  test(`refresh toast names up to three channels with ${count} failures`, async () => {
    const app = createRefresh({ error: Object.assign(new Error('HTTP 500'), { status: 500 }) })
    app.getters.getActiveProfile.subscriptions = Array.from({ length: count }, (_, i) => ({ id: `UC${i}`, name: `Channel ${i}` }))
    await app.refresh({ t: translateSummary })
    const names = Array.from({ length: Math.min(count, 3) }, (_, i) => `Channel ${i}`).join(', ')
    const more = count > 3 ? ` and ${count - 3} more` : ''
    assert.equal(app.toasts[0][0].message(), `Channels that could not be refreshed: ${names}${more}. Click to view details.`)
  })
}
