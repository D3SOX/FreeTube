import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import { getLocalSubscriptionPremiereUpdate, getInvidiousSubscriptionPremiereUpdate, shouldRefreshSubscriptionPremiere } from '../../src/renderer/helpers/subscription-premieres.js'
import { mapConcurrently } from '../../src/renderer/helpers/concurrent-map.js'
import { getSubscriptionsForFeed } from '../../src/renderer/helpers/subscription-channels.js'
import { formatDate, formatDateTime } from '../../src/renderer/helpers/dateFormat.js'

const cardSource = await readFile(new URL('../../src/renderer/components/FtListVideo/FtListVideo.vue', import.meta.url), 'utf8')
const dateStart = cardSource.indexOf('function updateUploadedTime()')
const dateSource = cardSource.slice(dateStart, cardSource.indexOf('\nfunction ', dateStart + 1))

for (const backend of ['local', 'invidious']) {
  test(`${backend} completed premiere displays its publication date instead of January 1970`, () => {
    const update = backend === 'local'
      ? getLocalSubscriptionPremiereUpdate(html({ live: false }), videoId)
      : getInvidiousSubscriptionPremiereUpdate({ videoId, liveNow: false, lengthSeconds: 4540 }, videoId)
    const published = 1789026626910
    const context = {
      props: { data: { published, ...update } },
      uploadedTime: { value: '' },
      uploadedTimeIsRelative: { value: false },
      published: { value: undefined },
      locale: { value: 'en-US' },
      dateFormat: { value: 'locale' },
      timeFormat: { value: 'locale' },
      isLive: { value: false },
      isStation: { value: false },
      inHistory: { value: false },
      formatDate,
      formatDateTime,
      getRelativeTimeFromDate(timestamp) {
        assert.equal(timestamp, published)
        return '2 hours ago'
      }
    }
    let error
    try {
      vm.runInNewContext(`${dateSource}\nupdateUploadedTime()`, context)
    } catch (caught) {
      error = caught
    }
    assert.equal(context.uploadedTime.value, '2 hours ago')
    assert.equal(error, undefined)
    assert.equal(context.published.value, published)
    assert.equal(context.uploadedTimeIsRelative.value, true)
  })
}

const videoId = 'premiere123'
function html({ live = true, upcoming = false, watching = '2,500', status = 'OK', microformat = {} } = {}) {
  return `<script>var ytInitialPlayerResponse = ${JSON.stringify({
    playabilityStatus: { status },
    videoDetails: { videoId, isLive: live, isLiveContent: false, isUpcoming: upcoming, viewCount: '9000', lengthSeconds: '702' },
    microformat: { playerMicroformatRenderer: { liveBroadcastDetails: { isLiveNow: live && !upcoming }, ...microformat } }
  })}; var ytInitialData = ${JSON.stringify({ contents: { videoViewCountRenderer: {
    viewCount: { runs: [{ text: watching }, { text: ' watching now' }] }, isLive: true
  } } })};</script>`
}

test('polls due and running premieres, excluding ordinary videos and future premieres', () => {
  assert.equal(shouldRefreshSubscriptionPremiere({ isUpcoming: true, premiereDate: new Date(1000) }, 999), false)
  assert.equal(shouldRefreshSubscriptionPremiere({ isUpcoming: true, premiereDate: new Date(1000) }, 1000), true)
  assert.equal(shouldRefreshSubscriptionPremiere({ isPremiere: true, liveNow: true }, 1000), true)
  assert.equal(shouldRefreshSubscriptionPremiere({ premiereTimestamp: 0, liveNow: false }, 1000), false)
  assert.equal(shouldRefreshSubscriptionPremiere({ isLive: true, isPremiere: false }, 1000), false)
})

test('polls supported cached premieres that only have a scheduled date', () => {
  const premiere = { premiereDate: new Date(1000) }
  assert.equal(shouldRefreshSubscriptionPremiere(premiere, 999), false)
  assert.equal(shouldRefreshSubscriptionPremiere(premiere, 1000), true)
  assert.equal(shouldRefreshSubscriptionPremiere({ ...premiere, isUpcoming: false, premiere: false }, 1000), false)
})

test('uses the concurrent audience rather than total views while a premiere runs', () => {
  const update = getLocalSubscriptionPremiereUpdate(html(), videoId)
  assert.equal(update.viewCount, 2500)
  assert.equal(update.liveNow, true)
  assert.equal(update.isPremiere, true)
  assert.equal(update.isUpcoming, false)
  assert.equal(getLocalSubscriptionPremiereUpdate(html({ watching: '0' }), videoId).viewCount, 0)
})

test('clears premiere flags and scheduled dates when the video ends', () => {
  const update = getLocalSubscriptionPremiereUpdate(html({ live: false }), videoId)
  assert.equal(update.viewCount, 9000)
  assert.equal(update.lengthSeconds, 702)
  assert.equal(update.liveNow, false)
  assert.equal(update.isLive, false)
  assert.equal(update.isPremiere, false)
  assert.equal(update.isUpcoming, false)
  assert.equal(update.premiere, false)
  assert.equal(update.premiereDate, null)
  assert.equal(update.premiereTimestamp, 0)
  assert.equal(shouldRefreshSubscriptionPremiere(update, 1000), false)
})

test('unavailable or malformed responses cannot complete a premiere', () => {
  assert.equal(getLocalSubscriptionPremiereUpdate('<html>Consent required</html>', videoId), null)
  assert.equal(getLocalSubscriptionPremiereUpdate(html({ status: 'ERROR' }), videoId), null)
  assert.equal(getLocalSubscriptionPremiereUpdate(html(), 'different-id'), null)
})

test('completed premieres can omit the live flags entirely', () => {
  const response = `<script>var ytInitialPlayerResponse = ${JSON.stringify({
    playabilityStatus: { status: 'OK' },
    videoDetails: { videoId, isLiveContent: false, viewCount: '9000', lengthSeconds: '702' }
  })};</script>`
  assert.equal(getLocalSubscriptionPremiereUpdate(response, videoId).isPremiere, false)
})

test('delayed premieres remain eligible for subsequent checks', () => {
  const update = getLocalSubscriptionPremiereUpdate(html({ upcoming: true, status: 'LIVE_STREAM_OFFLINE' }), videoId)
  assert.equal(update.isUpcoming, true)
  assert.equal(update.liveNow, false)
  assert.equal(update.isPremiere, true)
  assert.equal(shouldRefreshSubscriptionPremiere({ ...update, premiereDate: new Date(1000) }, 2000), true)
})

test('Invidious live and completed responses update the same cached fields', () => {
  const live = getInvidiousSubscriptionPremiereUpdate({ videoId, liveNow: true, isUpcoming: false, viewCount: 1234, lengthSeconds: 0 }, videoId)
  assert.equal(live.liveNow, true)
  assert.equal(live.viewCount, 1234)
  assert.equal(live.isPremiere, undefined)
  const ended = getInvidiousSubscriptionPremiereUpdate({ videoId, liveNow: false, isUpcoming: false, viewCount: 9000, lengthSeconds: 702 }, videoId)
  assert.equal(ended.isPremiere, false)
  assert.equal(ended.lengthSeconds, 702)
  assert.equal(ended.premiereDate, null)
  assert.equal(getInvidiousSubscriptionPremiereUpdate({ error: 'Unavailable' }, videoId), null)
})

test('a missing concurrent count keeps the cached audience instead of using total views', () => {
  const response = html().replace('videoViewCountRenderer', 'unrelatedRenderer')
  assert.equal(getLocalSubscriptionPremiereUpdate(response, videoId).viewCount, undefined)
})

// Run the real refresh function without the renderer's platform singletons.
const source = await readFile(new URL('../../src/renderer/helpers/subscriptions.js', import.meta.url), 'utf8')
const start = source.indexOf('export async function refreshSubscriptionPremieres(')
const refreshSource = source.slice(start, source.indexOf('\n/**', start)).replace('export ', '')

function createRefresh(fetch) {
  const video = { videoId, isPremiere: true, liveNow: true, viewCount: 1000, isNewInSubscriptionFeed: false }
  const getters = {
    getSubscriptionCacheReady: true,
    getSubscriptionFeedRefreshInProgress: false,
    getBackendPreference: 'local',
    getCurrentInvidiousInstanceUrl: 'https://invidious.example',
    getActiveProfile: { _id: 'profile', subscriptions: [{ id: 'channel' }] },
    getVideoCache: { channel: { videos: [video], timestamp: new Date(1000) } }
  }
  const writes = []
  const refresh = vm.runInNewContext(`${refreshSource}\nrefreshSubscriptionPremieres`, {
    store: { getters, dispatch: async (action, payload) => writes.push(payload) },
    process: { env: { SUPPORTS_LOCAL_API: true } },
    AbortSignal,
    RSS_ENRICHMENT_TIMEOUT_MS: 15_000,
    RSS_ENRICHMENT_CONCURRENCY: 3,
    getSubscriptionsForFeed,
    shouldRefreshSubscriptionPremiere,
    mapConcurrently,
    localApiFetch: fetch,
    invidiousFetch: fetch,
    getLocalSubscriptionPremiereUpdate,
    getInvidiousSubscriptionPremiereUpdate,
    notifySubscriptionChannelRefreshed() {}
  })
  return { refresh, getters, writes }
}

for (const backend of ['local', 'invidious']) {
  test(`${backend} completion replaces the cached live fetch time with the fetched publication date`, async () => {
    const published = Date.parse('2026-09-10T16:00:00Z')
    const { refresh, getters, writes } = createRefresh(async () => backend === 'local'
      ? new Response(html({ live: false, microformat: { publishDate: '2026-09-10T16:00:00Z' } }))
      : Response.json({ videoId, liveNow: false, published: published / 1000 }))
    getters.getBackendPreference = backend
    getters.getVideoCache.channel.videos[0].published = published + 30 * 60 * 1000
    await refresh(() => true)
    assert.equal(writes[0].videos[0].published, published)
    assert.equal(writes[0].videos[0].isPremiere, false)
    assert.equal(writes[0].timestamp.getTime(), 1000)
  })
}

test('completion does not replace cached publication dates with missing or invalid metadata', () => {
  for (const publishDate of [undefined, null, '', 'invalid', 0, '1970-01-01']) {
    const update = getLocalSubscriptionPremiereUpdate(html({ live: false, microformat: { publishDate } }), videoId)
    assert.equal(Object.hasOwn(update, 'published'), false)
  }
  for (const published of [undefined, null, '', 'invalid', 0, -1, Infinity]) {
    const update = getInvidiousSubscriptionPremiereUpdate({ videoId, liveNow: false, published }, videoId)
    assert.equal(Object.hasOwn(update, 'published'), false)
  }
})

test('running and upcoming premieres keep their cached publication date', () => {
  for (const upcoming of [false, true]) {
    const local = getLocalSubscriptionPremiereUpdate(html({ upcoming, microformat: { publishDate: '2026-09-10T06:37:06Z' } }), videoId)
    const invidious = getInvidiousSubscriptionPremiereUpdate({ videoId, liveNow: !upcoming, isUpcoming: upcoming, published: 1789022226 }, videoId)
    assert.equal(Object.hasOwn(local, 'published'), false)
    assert.equal(Object.hasOwn(invidious, 'published'), false)
  }
})

test('polling preserves seen state and the last full channel refresh timestamp', async () => {
  const { refresh, writes } = createRefresh(async () => new Response(html()))
  await refresh(() => true)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].videos[0].viewCount, 2500)
  assert.equal(writes[0].videos[0].isNewInSubscriptionFeed, false)
  assert.equal(writes[0].timestamp.getTime(), 1000)
})

test('requests English watch-page counts when the system locale uses other digits', async () => {
  const { refresh, writes } = createRefresh(async (url, options) => new Response(html({
    watching: options.headers?.['Accept-Language'] === 'en-US' ? '2,500' : '٢٬٥٠٠'
  })))
  await refresh(() => true)
  assert.equal(writes[0].videos[0].viewCount, 2500)
})

test('polling uses the selected Invidious backend with a request timeout', async () => {
  const { refresh, getters, writes } = createRefresh(async (url, signal) => {
    assert.equal(url, `https://invidious.example/api/v1/videos/${videoId}`)
    assert.ok(signal instanceof AbortSignal)
    return Response.json({ videoId, liveNow: false, isUpcoming: false, viewCount: 9000, lengthSeconds: 702 })
  })
  getters.getBackendPreference = 'invidious'
  await refresh(() => true)
  assert.equal(writes[0].videos[0].isPremiere, false)
  assert.equal(writes[0].videos[0].viewCount, 9000)
})

for (const change of ['cache', 'profile', 'inactive']) {
  test(`ignores a response after the ${change} changes while fetching`, async () => {
    let finish
    const response = new Promise(resolve => { finish = resolve })
    const { refresh, getters, writes } = createRefresh(() => response)
    let active = true
    const pending = refresh(() => active)
    if (change === 'cache') getters.getVideoCache.channel.videos = [{ videoId: 'newer-video' }]
    if (change === 'profile') getters.getActiveProfile = { _id: 'another-profile', subscriptions: [] }
    if (change === 'inactive') active = false
    finish(new Response(html()))
    await pending
    assert.equal(writes.length, 0)
  })
}
