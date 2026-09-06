import assert from 'node:assert/strict'
import test from 'node:test'
import { collectRecommendationCandidates, fetchRecommendationSource } from '../../src/renderer/helpers/recommendationCandidates.js'

test('uses the configured fallback for failed or empty backend responses', async () => {
  for (const preferred of [async () => { throw new Error('offline') }, async () => null]) {
    const videos = await fetchRecommendationSource(preferred, async () => [{ videoId: 'fallback' }], new AbortController().signal)
    assert.deepEqual(videos, [{ videoId: 'fallback' }])
  }
})

test('does not fall back after successful empty results or when fallback is disabled', async () => {
  const signal = new AbortController().signal
  assert.deepEqual(await fetchRecommendationSource(async () => [], async () => {
    assert.fail('Empty results are a successful response')
  }, signal), [])
  await assert.rejects(fetchRecommendationSource(async () => { throw new Error('offline') }, null, signal), /offline/)
})

test('cancellation never starts a fallback request', async () => {
  const controller = new AbortController()
  await assert.rejects(fetchRecommendationSource(async () => {
    controller.abort()
    throw controller.signal.reason
  }, async () => { assert.fail('Must not start fallback after abort') }, controller.signal), { name: 'AbortError' })
})

test('keeps successful sources when another source fails', async () => {
  const result = await collectRecommendationCandidates({ channels: ['a', 'b'], queries: ['linux desktop'] }, {
    fetchChannel: async id => {
      if (id === 'a') throw new Error('offline')
      return [{ videoId: 'upload' }]
    },
    search: async () => [{ videoId: 'discovery' }],
  })
  assert.deepEqual(result.videos.map(video => video.videoId), ['upload', 'discovery'])
  assert.equal(result.failedSources, 1)
  assert.deepEqual(result.videos[1].recommendationSources, [{ type: 'search', id: 'linux desktop' }])
})

test('bounds request concurrency, source count and candidate count', async () => {
  let active = 0
  let maximum = 0
  let calls = 0
  const fetchVideos = async () => {
    calls++
    maximum = Math.max(maximum, ++active)
    await new Promise(resolve => setImmediate(resolve))
    active--
    return Array.from({ length: 50 }, (_, i) => ({ videoId: String(i) }))
  }
  const sources = Array.from({ length: 10 }, (_, i) => String(i))
  const result = await collectRecommendationCandidates({ channels: sources, queries: sources }, {
    fetchChannel: fetchVideos,
    search: fetchVideos,
  })
  assert.equal(maximum, 3)
  assert.equal(calls, 6)
  assert.equal(result.videos.length, 30)
  assert.equal(result.videos[0].recommendationSources.length, 6)
})

test('does not start queued requests after cancellation', async () => {
  let cancelled = false
  let calls = 0
  await collectRecommendationCandidates({ channels: ['a', 'b', 'c'], queries: ['d', 'e', 'f'] }, {
    fetchChannel: async () => {
      calls++
      await new Promise(resolve => setImmediate(resolve))
      cancelled = true
      return []
    },
    search: async () => { throw new Error('Must not start after cancellation') },
    isCancelled: () => cancelled,
  })
  assert.equal(calls, 3)
})

test('times out a stuck source and treats invalid responses as failures', async () => {
  const result = await collectRecommendationCandidates({ channels: ['a'], queries: ['b'] }, {
    fetchChannel: (id, signal) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }),
    search: async () => null,
    timeoutMs: 5,
  })
  assert.deepEqual(result, { videos: [], failedSources: 2 })
})

test('aborts in-flight requests before starting queued sources after timeouts', async () => {
  let active = 0
  let maximum = 0
  const fetchVideos = (id, signal) => new Promise((resolve, reject) => {
    maximum = Math.max(maximum, ++active)
    signal.addEventListener('abort', () => {
      active--
      reject(signal.reason)
    }, { once: true })
  })
  const result = await collectRecommendationCandidates({ channels: ['a', 'b', 'c'], queries: ['d', 'e', 'f'] }, {
    fetchChannel: fetchVideos,
    search: fetchVideos,
    timeoutMs: 5,
  })
  assert.equal(maximum, 3)
  assert.equal(active, 0)
  assert.equal(result.failedSources, 6)
})

test('external cancellation aborts active requests and never starts queued sources', async () => {
  const controller = new AbortController()
  let calls = 0
  const fetchVideos = (id, signal) => new Promise((resolve, reject) => {
    calls++
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  const loading = collectRecommendationCandidates({ channels: ['a', 'b', 'c'], queries: ['d'] }, {
    fetchChannel: fetchVideos,
    search: fetchVideos,
    signal: controller.signal,
  })
  controller.abort()
  await loading
  assert.equal(calls, 3)
})
