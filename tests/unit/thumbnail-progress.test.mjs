import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import { hasReachedWatchedThreshold, isHistoryEntryWatched } from '../../src/history.js'

const source = await readFile(new URL('../../src/renderer/components/FtListVideo/FtListVideo.vue', import.meta.url), 'utf8')
const start = source.indexOf('const progressPercentage = computed(() => {')
assert.notEqual(start, -1)
const end = source.indexOf('\nconst thumbnailProgressRadius', start)
assert.notEqual(end, -1)
const progressCalculation = source.slice(start, end)

function thumbnailProgress({ progress = 150, duration = 600, threshold = 0, watched } = {}) {
  const entry = {
    watchProgress: progress,
    lengthSeconds: duration,
    isWatched: watched ?? hasReachedWatchedThreshold(progress, duration, threshold),
  }
  return vm.runInNewContext(`${progressCalculation}\nprogressPercentage.value`, {
    computed: getter => ({ value: getter() }),
    lengthSeconds: { value: entry.lengthSeconds },
    watchProgress: { value: entry.watchProgress },
    isWatched: { value: isHistoryEntryWatched(entry) },
    watchedPercentageThreshold: { value: threshold },
  })
}

test('zero watched threshold preserves actual thumbnail progress', () => {
  assert.equal(thumbnailProgress(), 25)
  assert.equal(thumbnailProgress({ progress: 0 }), 0)
  assert.equal(thumbnailProgress({ progress: 450 }), 75)
  assert.equal(thumbnailProgress({ progress: 600 }), 100)
  assert.equal(thumbnailProgress({ progress: 700 }), 100)
})

test('nonzero watched thresholds retain completed bars for watched videos', () => {
  assert.equal(thumbnailProgress({ threshold: 90, progress: 540 }), 100)
  assert.equal(thumbnailProgress({ threshold: 90 }), 25)
  assert.equal(thumbnailProgress({ threshold: 90, watched: true }), 100)
  assert.equal(thumbnailProgress({ threshold: 100, progress: 540 }), 90)
})

test('unknown or zero durations do not show thumbnail progress', () => {
  assert.equal(thumbnailProgress({ duration: null, watched: true }), 0)
  assert.equal(thumbnailProgress({ duration: 0, watched: true }), 0)
})
