import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildYtDlpPlaybackCacheKey,
  DEFAULT_YT_DLP_PRELOAD_CONCURRENCY,
  MAX_YT_DLP_PRELOAD_CONCURRENCY,
  MAX_YT_DLP_PRELOAD_COUNT,
  normalizeYtDlpPreloadConcurrency,
  normalizeYtDlpPreloadCount,
  preloadYtDlpPlaybackSources,
  selectYtDlpPreloadVideoIds,
} from '../../src/renderer/helpers/player/ytDlpPlaybackPreload.js'

const video = videoId => ({ videoId })
const source = videoId => ({
  videoId,
  isLive: false,
  expiryDate: new Date(Date.now() + 10 * 60 * 1000),
})

test('reuses preloaded playback sources across proxy changes', () => {
  const directGetters = {
    getYtDlpSource: 'system',
    getYtDlpChannel: 'stable',
    getYtDlpPath: '/usr/bin/yt-dlp',
    getUseProxy: false,
    getYtDlpPlaybackAuthMode: 'browser',
    getYtDlpPlaybackCookiesPath: '',
    getYtDlpPlaybackCookiesBrowser: 'firefox',
    getYtDlpPlaybackCookiesBrowserProfile: 'default',
  }
  const proxyGetters = {
    ...directGetters,
    getUseProxy: true,
    getProxyProtocol: 'socks5',
    getProxyHostname: 'localhost',
    getProxyPort: 9050,
    getProxyUsername: 'user',
    getProxyPassword: 'password',
  }
  const directKey = buildYtDlpPlaybackCacheKey(directGetters)

  assert.equal(
    directKey,
    buildYtDlpPlaybackCacheKey(proxyGetters)
  )

  for (const [setting, value] of Object.entries({
    getYtDlpSource: 'bundled',
    getYtDlpChannel: 'nightly',
    getYtDlpPath: '/opt/yt-dlp',
    getYtDlpPlaybackAuthMode: 'cookies',
    getYtDlpPlaybackCookiesPath: '/tmp/cookies.txt',
    getYtDlpPlaybackCookiesBrowser: 'chromium',
    getYtDlpPlaybackCookiesBrowserProfile: 'Profile 1',
  })) {
    assert.notEqual(
      directKey,
      buildYtDlpPlaybackCacheKey({ ...directGetters, [setting]: value }),
      setting
    )
  }
})

test('normalizes the number of upcoming yt-dlp videos to preload', () => {
  assert.equal(normalizeYtDlpPreloadCount(3), 3)
  assert.equal(normalizeYtDlpPreloadCount('4'), 4)
  assert.equal(normalizeYtDlpPreloadCount(0), 0)
  assert.equal(normalizeYtDlpPreloadCount(-1), 0)
  assert.equal(normalizeYtDlpPreloadCount(MAX_YT_DLP_PRELOAD_COUNT + 1), MAX_YT_DLP_PRELOAD_COUNT)
  assert.equal(normalizeYtDlpPreloadCount(1.5), 0)
})

test('normalizes the number of concurrent yt-dlp preloads', () => {
  assert.equal(normalizeYtDlpPreloadConcurrency(3), 3)
  assert.equal(normalizeYtDlpPreloadConcurrency('4'), 4)
  assert.equal(normalizeYtDlpPreloadConcurrency(32), 32)
  assert.equal(normalizeYtDlpPreloadConcurrency(33), 32)
  assert.equal(normalizeYtDlpPreloadConcurrency(0), DEFAULT_YT_DLP_PRELOAD_CONCURRENCY)
  assert.equal(normalizeYtDlpPreloadConcurrency(-1), DEFAULT_YT_DLP_PRELOAD_CONCURRENCY)
  assert.equal(normalizeYtDlpPreloadConcurrency(1.5), DEFAULT_YT_DLP_PRELOAD_CONCURRENCY)
  assert.equal(
    normalizeYtDlpPreloadConcurrency(MAX_YT_DLP_PRELOAD_CONCURRENCY + 1),
    MAX_YT_DLP_PRELOAD_CONCURRENCY
  )
})

test('preloads queued videos before playlist or recommendation candidates', () => {
  assert.deepEqual(selectYtDlpPreloadVideoIds({
    currentVideoId: 'current00001',
    limit: 3,
    queuedVideos: [video('queue000001'), video('queue000002'), video('queue000003'), video('queue000004')],
    playlistVideos: [video('list0000001'), video('list0000002')],
    recommendedVideos: [video('recommend01')],
  }), ['queue000001', 'queue000002', 'queue000003'])
})

test('uses the active playlist when the watch queue is empty', () => {
  assert.deepEqual(selectYtDlpPreloadVideoIds({
    currentVideoId: 'current00001',
    limit: 4,
    queuedVideos: [],
    playlistVideos: [
      video('current00001'),
      video('list0000001'),
      video('list0000001'),
      { title: 'Unavailable' },
      video('list0000002'),
    ],
    recommendedVideos: [video('recommend01')],
  }), ['list0000001', 'list0000002'])
})

test('uses recommendations outside a queue or playlist', () => {
  assert.deepEqual(selectYtDlpPreloadVideoIds({
    currentVideoId: 'current00001',
    limit: 2,
    queuedVideos: [],
    playlistVideos: null,
    recommendedVideos: [video('current00001'), video('recommend01'), video('recommend02'), video('recommend03')],
  }), ['recommend01', 'recommend02'])
})

test('does not fall back to recommendations at the end of a playlist', () => {
  assert.deepEqual(selectYtDlpPreloadVideoIds({
    currentVideoId: 'current00001',
    limit: 2,
    queuedVideos: [],
    playlistVideos: [],
    recommendedVideos: [video('recommend01')],
  }), [])
})

test('selects no upcoming videos when the preload count is zero', () => {
  for (const candidates of [
    { queuedVideos: [video('queue000001')], playlistVideos: [video('list0000001')] },
    { queuedVideos: [], playlistVideos: [video('list0000001')] },
    { queuedVideos: [], playlistVideos: null },
  ]) {
    assert.deepEqual(selectYtDlpPreloadVideoIds({
      currentVideoId: 'current00001',
      limit: 0,
      recommendedVideos: [video('recommend01')],
      ...candidates,
    }), [])
  }
})

test('preloads unique videos with bounded concurrency and reports failures', async () => {
  let active = 0
  let peakActive = 0
  const loaded = []
  const progressUpdates = []
  const release = new Map()
  const loadSource = videoId => new Promise((resolve, reject) => {
    active++
    peakActive = Math.max(peakActive, active)
    loaded.push(videoId)
    release.set(videoId, (error = null) => {
      active--
      error === null ? resolve(source(videoId)) : reject(error)
    })
  })

  const resultPromise = preloadYtDlpPlaybackSources(
    ['video000001', 'video000002', 'video000001', 'video000003'],
    {
      concurrency: 2,
      loadSource,
      onProgress: progress => progressUpdates.push(progress),
    }
  )

  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(loaded, ['video000001', 'video000002'])
  release.get('video000001')()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(loaded, ['video000001', 'video000002', 'video000003'])
  release.get('video000002')(new Error('unavailable'))
  release.get('video000003')()

  assert.deepEqual(await resultPromise, {
    requested: 3,
    preloaded: 2,
    failed: 1,
  })
  assert.equal(peakActive, 2)
  assert.deepEqual(progressUpdates, [
    { requested: 3, completed: 1, preloaded: 1, failed: 0 },
    { requested: 3, completed: 2, preloaded: 1, failed: 1 },
    { requested: 3, completed: 3, preloaded: 2, failed: 1 },
  ])
})

test('shares the preload concurrency limit across overlapping runs', async () => {
  let active = 0
  let peakActive = 0
  const loaded = []
  const releases = []
  const loadSource = videoId => new Promise(resolve => {
    active++
    peakActive = Math.max(peakActive, active)
    loaded.push(videoId)
    releases.push(() => {
      active--
      resolve(source(videoId))
    })
  })

  const firstRun = preloadYtDlpPlaybackSources(['first00001', 'first00002', 'first00003'], { loadSource })
  const secondRun = preloadYtDlpPlaybackSources(['second0001', 'second0002'], { loadSource })

  await new Promise(resolve => setImmediate(resolve))
  assert.equal(loaded.length, 2)

  for (let completed = 0; completed < 5; completed++) {
    const release = releases.shift()
    assert.ok(release)
    release()
    await new Promise(resolve => setImmediate(resolve))
  }

  await Promise.all([firstRun, secondRun])
  assert.equal(peakActive, 2)
  assert.deepEqual(new Set(loaded), new Set([
    'first00001',
    'first00002',
    'first00003',
    'second0001',
    'second0002',
  ]))
})

test('raises the shared preload concurrency limit when configured', async () => {
  let active = 0
  let peakActive = 0
  const releases = []
  const loadSource = videoId => new Promise(resolve => {
    active++
    peakActive = Math.max(peakActive, active)
    releases.push(() => {
      active--
      resolve(source(videoId))
    })
  })

  const firstRun = preloadYtDlpPlaybackSources(
    Array.from({ length: 20 }, (_, index) => `first${index}`),
    { concurrency: 32, loadSource }
  )
  const secondRun = preloadYtDlpPlaybackSources(
    Array.from({ length: 20 }, (_, index) => `second${index}`),
    { concurrency: 32, loadSource }
  )

  await new Promise(resolve => setImmediate(resolve))
  const initiallyActive = active

  for (let completed = 0; completed < 40; completed++) {
    const release = releases.shift()
    assert.ok(release)
    release()
    await new Promise(resolve => setImmediate(resolve))
  }

  await Promise.all([firstRun, secondRun])
  assert.equal(initiallyActive, 32)
  assert.equal(peakActive, 32)
})

test('reports sources that cannot be cached as preload failures', async () => {
  const results = new Map([
    ['live0000001', { isLive: true, expiryDate: new Date(Date.now() + 10 * 60 * 1000) }],
    ['noexpiry001', { isLive: false, expiryDate: null }],
    ['expired0001', { isLive: false, expiryDate: new Date(0) }],
    ['cached00001', source('cached00001')],
  ])

  assert.deepEqual(await preloadYtDlpPlaybackSources([...results.keys()], {
    loadSource: async videoId => results.get(videoId)
  }), {
    requested: 4,
    preloaded: 1,
    failed: 3,
  })
})
