import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AndroidSubscriptionRefreshPayloadError,
  createAndroidSubscriptionRefreshConfiguration,
  createSubscriptionRefreshStartController,
  createSubscriptionRefreshStartGuard,
  normalizeAndroidSubscriptionRefreshPayload,
  processAndroidSubscriptionRefreshChannelResult,
} from '../../src/renderer/helpers/androidSubscriptionRefreshData.js'

test('a completed refresh cannot become active after its start await resumes', async () => {
  const guard = createSubscriptionRefreshStartGuard()
  let releaseStart
  const nativeStart = new Promise(resolve => { releaseStart = resolve })
  let inProgress

  const start = (async () => {
    const isCurrentStart = guard.begin()
    await nativeStart
    if (isCurrentStart()) inProgress = true
  })()

  guard.finish()
  inProgress = false
  releaseStart()
  await start

  assert.equal(inProgress, false)
})

test('a pending native refresh start keeps ownership until it finishes', async () => {
  const controller = createSubscriptionRefreshStartController()
  let nativeStarts = 0
  let releaseFirstStart
  const firstNativeStart = new Promise(resolve => { releaseFirstStart = resolve })

  const firstStart = controller.begin(1, () => {
    nativeStarts++
    return firstNativeStart
  })
  const overlappingStart = controller.begin(2, () => {
    nativeStarts++
    return Promise.resolve('second-token')
  })

  assert.equal(overlappingStart, null)
  assert.equal(nativeStarts, 1)
  assert.equal(controller.current(2), null)
  assert.equal(controller.isCurrent(2, firstStart), false)
  assert.equal(controller.finish(2), null)
  assert.equal(controller.current(1), firstStart)
  assert.equal(controller.finish(1), firstStart)

  releaseFirstStart('first-token')
  assert.equal(await firstStart, 'first-token')
  assert.equal(controller.current(1), null)
})

test('creates one closed-app schedule input per profile and enabled feed', () => {
  const configuration = createAndroidSubscriptionRefreshConfiguration({
    profiles: [
      {
        _id: 'all',
        subscriptions: [
          { id: 'UC-video' },
          { id: 'UC-short', feedTypes: ['shorts'] },
          { id: 'UC-video' }
        ]
      },
      {
        _id: 'quiet',
        subscriptions: [{ id: 'UC-post', feedTypes: ['posts'] }]
      }
    ],
    closedAppRefreshEnabled: true,
    intervals: {
      videos: '1800000',
      shorts: '3600000',
      live: '0',
      posts: '7200000'
    },
    hiddenFeedTypes: ['posts'],
    instanceUrl: 'https://example.invalid',
    authorization: 'Basic secret',
    titles: { videos: 'Videos', shorts: 'Shorts', live: 'Live', posts: 'Posts' },
    cancelLabel: 'Cancel refresh'
  })

  assert.deepEqual(configuration.intervals, {
    videos: 1800000,
    shorts: 3600000,
    live: 0,
    posts: 0
  })
  assert.deepEqual(configuration.profiles, [
    {
      id: 'all',
      channels: {
        videos: ['UC-video'],
        shorts: ['UC-video', 'UC-short'],
        live: ['UC-video'],
        posts: ['UC-video']
      }
    },
    {
      id: 'quiet',
      channels: {
        videos: [],
        shorts: [],
        live: [],
        posts: ['UC-post']
      }
    }
  ])
})

test('invalid and disabled intervals do not opt in to closed-app refreshes', () => {
  const configuration = createAndroidSubscriptionRefreshConfiguration({
    profiles: [],
    closedAppRefreshEnabled: true,
    intervals: { videos: 'nope', shorts: -1, live: 0, posts: '' },
    hiddenFeedTypes: [],
    instanceUrl: '',
    authorization: null,
    titles: {},
    cancelLabel: 'Cancel'
  })

  assert.deepEqual(configuration.intervals, { videos: 0, shorts: 0, live: 0, posts: 0 })
})

test('closed-app refresh opt-out preserves selected intervals outside the native configuration', () => {
  const selectedIntervals = { videos: '1800000', shorts: '3600000', live: '7200000', posts: '14400000' }
  const configuration = createAndroidSubscriptionRefreshConfiguration({
    profiles: [],
    closedAppRefreshEnabled: false,
    intervals: selectedIntervals,
    hiddenFeedTypes: [],
    instanceUrl: '',
    authorization: null,
    titles: {},
    cancelLabel: 'Cancel'
  })

  assert.deepEqual(configuration.intervals, { videos: 0, shorts: 0, live: 0, posts: 0 })
  assert.deepEqual(selectedIntervals, {
    videos: '1800000',
    shorts: '3600000',
    live: '7200000',
    posts: '14400000'
  })
})

test('acknowledges malformed stored payloads without dropping transient cache failures', async () => {
  const result = { id: 'result-1' }
  const acknowledged = []
  const acknowledge = id => { acknowledged.push(id) }

  await processAndroidSubscriptionRefreshChannelResult(
    result,
    async () => {
      normalizeAndroidSubscriptionRefreshPayload(() => {
        throw new TypeError('missing post fields')
      }, 'posts', {}, 'UC-channel')
    },
    acknowledge
  )
  assert.deepEqual(acknowledged, ['result-1'])

  await assert.rejects(
    processAndroidSubscriptionRefreshChannelResult(
      result,
      async () => { throw new Error('cache write failed') },
      acknowledge
    ),
    error => !(error instanceof AndroidSubscriptionRefreshPayloadError) && error.message === 'cache write failed'
  )
  assert.deepEqual(acknowledged, ['result-1'])
})

test('closed-app refresh includes subscribed automatic-download channels filtered out of a profile', () => {
  const configuration = createAndroidSubscriptionRefreshConfiguration({
    profiles: [
      { _id: 'all', subscriptions: [{ id: 'UC-auto', feedTypes: ['posts'] }] },
      { _id: 'filtered', subscriptions: [] }
    ],
    automaticDownloadRules: {
      'UC-auto': { includeVideos: true, includeShorts: true, includeLivestreams: false },
      'UC-unsubscribed': { includeVideos: true }
    },
    closedAppRefreshEnabled: true,
    intervals: { videos: 1800000, shorts: 1800000, live: 0, posts: 0 },
    hiddenFeedTypes: [],
    instanceUrl: 'https://example.invalid',
    authorization: null,
    titles: {},
    cancelLabel: 'Cancel'
  })
  assert.deepEqual(configuration.profiles[1].channels, {
    videos: ['UC-auto'], shorts: ['UC-auto'], live: [], posts: []
  })
})
