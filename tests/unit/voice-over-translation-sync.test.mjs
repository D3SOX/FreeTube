import assert from 'node:assert/strict'
import test from 'node:test'

import { createRenderer, nextTick, ref } from 'vue'
import { getVoiceOverPlaybackRate, useVoiceOverTranslation } from '../../src/renderer/components/ft-shaka-video-player/opentubex/useVoiceOverTranslation.js'

test('handles a failed native original-volume command locally and retries on the next change', async t => {
  const failure = new Error('Native playback owner was released')
  const warnings = []
  t.mock.method(console, 'warn', (...args) => warnings.push(args))
  const errors = []
  const gains = []
  const video = ref({
    nativePlayback: { async setOutputGain(gain) {
      gains.push(gain)
      if (gains.length === 1) throw failure
    } },
    removeEventListener() {}
  })
  const originalVolume = ref(0.25)
  const renderer = createRenderer({
    createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {}
  })
  const app = renderer.createApp({
    setup() {
      useVoiceOverTranslation({
        video, videoId: ref('test'), responseLanguage: ref('en'), autoPrepare: ref(false),
        originalVolume, voiceVolume: ref(1), onError: error => errors.push(error)
      })
      return () => null
    }
  })
  app.config.errorHandler = error => errors.push(error)
  app.mount({})
  t.after(() => app.unmount())
  originalVolume.value = 0.5
  await nextTick()
  await nextTick()
  assert.deepEqual(errors, [])
  assert.deepEqual(warnings, [['Unable to adjust original audio volume', failure]])
  originalVolume.value = 0.75
  await nextTick()
  assert.deepEqual(gains, [1, 1])
})

test('corrects ordinary voice-over drift with a bounded playback-rate adjustment', () => {
  assert.equal(getVoiceOverPlaybackRate(2, 0.2), 2.05)
  assert.equal(getVoiceOverPlaybackRate(2, 0.8), 2.1)
  assert.equal(getVoiceOverPlaybackRate(2, -0.8), 1.9)
})

test('measures voice-over drift in wall-clock time at faster playback rates', () => {
  assert.equal(getVoiceOverPlaybackRate(1, 0.8), null)
  assert.equal(getVoiceOverPlaybackRate(2, 0.8), 2.1)
})

test('keeps the selected playback rate while voice-over drift is negligible', () => {
  assert.equal(getVoiceOverPlaybackRate(2, 0.08), 2)
})
