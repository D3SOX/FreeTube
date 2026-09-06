import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import { createSubscriptionNetworkRecovery, SubscriptionNetworkError } from '../../src/renderer/helpers/subscriptionNetworkRecovery.js'
import { mapConcurrently } from '../../src/renderer/helpers/concurrent-map.js'
import { buildRequestDiagnostic, classifyRequestFailure, formatRequestDiagnostic } from '../../src/renderer/helpers/api/requestDiagnostics.js'
import { getSubscriptionsForFeed } from '../../src/renderer/helpers/subscription-channels.js'
import { reconcileFetchedSubscriptionEntries } from '../../src/renderer/helpers/subscription-entries.js'

const source = (await readFile(new URL('../../src/renderer/helpers/subscriptions.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
  .replace(/^export /gm, '')

// Exercise the real refresh, fallback, cache, and notification paths with fake
// platform APIs. Webpack-only imports are supplied in the isolated context.
function createRefresh({ online = true, feed = 'Shorts', error = new TypeError('Failed to fetch'), webCors = false, backend = 'local', fallbackWorks = false } = {}) {
  const window = new EventTarget()
  const navigator = { onLine: online }
  const toasts = []
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
    if (fail) throw error
    return { videos: [], posts: [], status: 200, text: async () => '<feed/>' }
  }
  const fetchFallback = async url => {
    fallbackRequests.push(url)
    return { videos: [], posts: [], status: 200, text: async () => '<feed/>' }
  }
  const fetchLocal = fallbackWorks && backend === 'invidious' ? fetchFallback : fetchChannel
  const fetchInvidious = fallbackWorks && backend === 'local' ? fetchFallback : fetchChannel
  const context = vm.createContext({
    window, navigator, CustomEvent, setTimeout, clearTimeout, console: { error() {}, warn() {} },
    process: { env: { IS_CAPACITOR: true, SUPPORTS_LOCAL_API: true } },
    store: {
      getters,
      commit(key, value) { if (key === 'setSubscriptionFeedRefreshInProgress') getters.getSubscriptionFeedRefreshInProgress = value },
      async dispatch(key, value) { writes.push({ key, value }) },
    },
    createSubscriptionNetworkRecovery, SubscriptionNetworkError,
    mapConcurrently, buildRequestDiagnostic, classifyRequestFailure, formatRequestDiagnostic, getSubscriptionsForFeed,
    reconcileFetchedSubscriptionEntries,
    isAndroidSubscriptionRefreshActive: async () => false,
    includeAutomaticDownloadChannels: channels => channels,
    startAutomaticDownloadsForChannel: async () => {},
    getChannelPlaylistId: id => id,
    showApiErrorToast: (...args) => toasts.push(args),
    showToast: (...args) => toasts.push(args),
    localApiFetch: fetchLocal,
    fetch: webCors ? async () => { throw new TypeError('Failed to fetch') } : fetchChannel,
    invidiousFetch: fetchInvidious,
    getLocalChannelVideos: fetchLocal,
    getLocalChannelLiveStreams: fetchLocal,
    getLocalChannelCommunity: async id => (await fetchLocal(id)).posts,
    invidiousGetCommunityPosts: fetchInvidious,
    getLocalPlaylist: async () => ({ items: [] }),
    parseLocalPlaylistVideos: () => [],
    mergeSubscriptionShortThumbnails: videos => videos,
    DOMParser: class {
      parseFromString() {
        return { querySelector: () => ({ textContent: 'Channel' }), querySelectorAll: () => [] }
      }
    },
  })
  vm.runInContext(`${source}\nglobalThis.api = { refreshSubscriptionVideosFromRemote, refreshSubscriptionShortsFromRemote, refreshSubscriptionLiveFromRemote, refreshSubscriptionPostsFromRemote, cancelSubscriptionRefresh }`, context)
  return {
    ...context.api, refresh: context.api[`refreshSubscription${feed}FromRemote`], navigator, requests, fallbackRequests, toasts, writes, events, getters,
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

for (const error of [Object.assign(new Error('HTTP 503'), { status: 503 }), new SyntaxError('Invalid JSON')]) {
  test(`${error.message} keeps the existing error and fallback behavior`, async () => {
    const app = createRefresh({ error })
    await app.refresh({ t: key => key })
    assert.equal(app.requests.length, 40)
    assert.ok(app.toasts.length > 0)
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
    const recovery = createSubscriptionNetworkRecovery({ eventTarget, isOnline: () => true, allowFallback })
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
  const recovery = createSubscriptionNetworkRecovery({ eventTarget, isOnline: () => online })
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
