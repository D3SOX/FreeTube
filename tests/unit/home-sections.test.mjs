import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_HOME_SECTION_LAYOUT,
  getContinueWatchingEntries,
  getRecentDownloads,
  moveHomeSection,
  normalizeHomeSectionLayout,
} from '../../src/renderer/helpers/homeSections.js'
import { getHomeShelfLayout } from '../../src/renderer/helpers/homeShelfPagination.js'

test('normalizes a complete current Home layout', () => {
  const input = DEFAULT_HOME_SECTION_LAYOUT.toReversed()
    .map((section, index) => ({ id: section.id, visible: index !== 0 }))

  assert.deepEqual(normalizeHomeSectionLayout(input), input)
})

test('falls back to the complete default Home layout for invalid settings', () => {
  assert.deepEqual(
    normalizeHomeSectionLayout('invalid'),
    DEFAULT_HOME_SECTION_LAYOUT
  )
  assert.deepEqual(
    normalizeHomeSectionLayout([{ id: 'unknown', visible: true }]),
    DEFAULT_HOME_SECTION_LAYOUT
  )
})

test('adds recommendations without resetting existing Home order or visibility', () => {
  const previousLayout = DEFAULT_HOME_SECTION_LAYOUT
    .filter(section => section.id !== 'recommendations')
    .toReversed()
    .map(section => ({ ...section, visible: false }))
  assert.deepEqual(normalizeHomeSectionLayout(previousLayout), [
    ...previousLayout,
    { id: 'recommendations', visible: true },
  ])
})

test('recent downloads include active and completed entries only', () => {
  const downloads = [
    { id: 1, status: 'failed' },
    { id: 2, status: 'completed' },
    { id: 3, status: 'downloading' },
    { id: 4, status: 'cancelled' },
    { id: 5, status: 'queued' },
  ]

  assert.deepEqual(getRecentDownloads(downloads).map(download => download.id), [5, 3, 2])
})

test('moves Home sections without mutating the stored layout', () => {
  const layout = normalizeHomeSectionLayout(DEFAULT_HOME_SECTION_LAYOUT)
  const reordered = moveHomeSection(layout, 'watchQueue', -1)

  assert.equal(reordered[0].id, 'continueWatching')
  assert.equal(reordered[2].id, 'watchQueue')
  assert.equal(reordered[3].id, 'newSinceLastVisit')
  assert.equal(layout[0].id, 'continueWatching')
})

test('continue watching includes only started, unfinished videos', () => {
  const entries = [
    { videoId: 'unfinished', watchProgress: 20, lengthSeconds: 100 },
    { videoId: 'not-started', watchProgress: 0, lengthSeconds: 100 },
    { videoId: 'watched', watchProgress: 20, lengthSeconds: 100, isWatched: true },
    { videoId: 'finished', watchProgress: 100, lengthSeconds: 100 },
    { videoId: 'live', watchProgress: 20, isLive: true },
    { videoId: 'upcoming', watchProgress: 20, isUpcoming: true },
    {
      videoId: 'started-premiere',
      watchProgress: 20,
      lengthSeconds: 100,
      isUpcoming: true,
      premiereTimestamp: Math.floor(Date.now() / 1000) - 1,
    },
  ]

  assert.deepEqual(
    getContinueWatchingEntries(entries).map(entry => entry.videoId),
    ['unfinished', 'started-premiere']
  )
})

test('Home shelves use one row and reserve space for paging controls', () => {
  assert.deepEqual(getHomeShelfLayout(900, 3, 260, 12), {
    pageSize: 3,
    showControls: false,
  })
  assert.deepEqual(getHomeShelfLayout(900, 8, 260, 12), {
    pageSize: 2,
    showControls: true,
  })
})

test('continue watching is not capped before shelf pagination', () => {
  const entries = Array.from({ length: 8 }, (_, index) => ({
    videoId: `video-${index}`,
    watchProgress: 20,
    lengthSeconds: 100,
  }))

  assert.equal(getContinueWatchingEntries(entries).length, entries.length)
})

test('Home shelf capacity handles fractional UI scale measurements', () => {
  assert.deepEqual(getHomeShelfLayout(374.4, 8, 260, 12), {
    pageSize: 1,
    showControls: true,
  })
})
