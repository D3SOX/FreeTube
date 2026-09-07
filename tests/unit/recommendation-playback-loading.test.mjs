import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compileFunction } from 'node:vm'
import { sampleRecommendationPlayback } from '../../src/recommendation-learning.js'

const source = await readFile(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
const method = source.slice(source.indexOf('    trackRecommendationWatch(time) {'), source.indexOf('    async flushRecommendationWatch()'))

for (const outcome of ['rejection', 'missing epoch']) {
  test(`backs off playback learning loads after ${outcome} and resumes after recovery`, async () => {
    let now = 1000
    let calls = 0
    let recover = false
    const getters = { getEnableHomeRecommendations: true, getRecommendationEpoch: null }
    const { trackRecommendationWatch } = compileFunction(`return {${method}}`, ['Date', 'console', 'sampleRecommendationPlayback'])(
      { now: () => now }, { error() {} }, sampleRecommendationPlayback,
    )
    const watch = {
      rememberHistory: true,
      isLoading: false,
      videoId: 'video',
      currentPlaybackRate: 1,
      recommendationLoadRetryAt: 0,
      recommendationPlaybackSample: null,
      recommendationWatchSession: null,
      $refs: { player: { hasLoaded: true, isPaused: () => false } },
      $store: { getters, async dispatch(action) {
        assert.equal(action, 'loadRecommendations')
        calls++
        if (recover) getters.getRecommendationEpoch = 'recovered'
        else if (outcome === 'rejection') throw new Error('Datastore unavailable')
      } },
    }
    const tick = async () => { trackRecommendationWatch.call(watch, now / 1000); await Promise.resolve() }
    await tick()
    for (let i = 0; i < 100; i++) { now += 10; await tick() }
    assert.equal(calls, 1)
    now = 30_999
    await tick()
    assert.equal(calls, 1)
    now = 31_000
    recover = true
    await tick()
    assert.equal(calls, 2)
    await tick()
    assert.equal(watch.recommendationWatchSession.epoch, 'recovered')
    now += 1000
    await tick()
    assert.equal(watch.recommendationWatchSession.seconds, 1)
    assert.equal(calls, 2)
  })
}
