import assert from 'node:assert/strict'
import test from 'node:test'

import { createRepeatStatsTracker } from '../../src/renderer/helpers/player/repeatStats.js'

function setup() {
  const video = Object.assign(new EventTarget(), {
    currentTime: 0, duration: 30, playbackRate: 1,
    paused: true, seeking: false, readyState: 4,
  })
  let clock = 0
  let stats
  const tracker = createRepeatStatsTracker(video, value => { stats = value }, () => clock)
  const event = (name, properties = {}) => {
    Object.assign(video, properties)
    video.dispatchEvent(new Event(name))
  }
  return { video, tracker, event, advance: ms => { clock += ms }, stats: () => stats }
}

test('counts only playing time, excluding pauses, buffering, seeking, and disabled looping', () => {
  const { tracker, event, advance, stats } = setup()
  tracker.setMode('video')
  advance(5000)
  event('playing', { paused: false })
  advance(2000)
  event('pause', { paused: true })
  assert.equal(stats().seconds, 2)
  advance(10000)
  event('playing', { paused: false })
  advance(1000)
  event('waiting', { readyState: 2 })
  advance(10000)
  event('playing', { readyState: 4 })
  advance(1000)
  event('seeking', { seeking: true, currentTime: 20 })
  advance(10000)
  event('timeupdate')
  event('seeked', { seeking: false })
  advance(1000)
  tracker.setMode(null)
  advance(10000)
  event('timeupdate')
  assert.deepEqual(stats(), { active: false, repeats: 0, seconds: 5 })
  tracker.setMode('video')
  assert.equal(stats().seconds, 5)
})

test('playback speed changes do not multiply time spent', () => {
  const { tracker, event, advance, stats } = setup()
  tracker.setMode('video')
  event('playing', { paused: false })
  advance(1000)
  event('ratechange', { playbackRate: 2, currentTime: 1 })
  advance(1000)
  event('timeupdate', { currentTime: 3 })
  assert.equal(stats().seconds, 2)
})

test('native loop seeking counts once, while normal seeks and seek timeupdates do not', () => {
  const { tracker, event, advance, stats } = setup()
  tracker.setMode('video')
  event('playing', { paused: false, currentTime: 29.8 })
  advance(100)
  event('seeking', { seeking: true, currentTime: 0 })
  assert.equal(stats().repeats, 0, 'seeking near the end is not a completed repeat')
  event('seeked', { seeking: false })
  event('seeking', { seeking: true, currentTime: 29.8 })
  event('seeked', { seeking: false })
  advance(200)
  event('seeking', { seeking: true, currentTime: 0 })
  event('timeupdate')
  assert.equal(stats().repeats, 1)
  event('seeked', { seeking: false })
  event('timeupdate', { currentTime: 0.01 })
  assert.equal(stats().repeats, 1)
})

test('native loop detection uses the playback rate and ignores paused seeks', () => {
  const { tracker, event, advance, stats } = setup()
  tracker.setMode('video')
  event('playing', { paused: false, currentTime: 29.8, playbackRate: 2 })
  advance(100)
  event('seeking', { seeking: true, currentTime: 0 })
  assert.equal(stats().repeats, 1)
  event('seeked', { seeking: false })
  event('pause', { paused: true, currentTime: 29.8 })
  advance(1000)
  event('seeking', { seeking: true, currentTime: 0 })
  assert.equal(stats().repeats, 1)
})

test('Android automatic loops report seeked without a preceding seeking event', () => {
  const { tracker, event, advance, stats } = setup()
  tracker.setMode('video')
  event('playing', { paused: false, currentTime: 29.8 })
  advance(200)
  event('seeked', { currentTime: 0 })
  event('timeupdate')
  assert.equal(stats().repeats, 1)
  event('seeking', { seeking: true, currentTime: 29.8 })
  event('seeked', { seeking: false })
  event('seeking', { seeking: true, currentTime: 0 })
  event('seeked', { seeking: false })
  assert.equal(stats().repeats, 1)
})

test('A-B repeats retain the session when toggled and reset for a different range or video', () => {
  const { tracker, event, advance, stats } = setup()
  tracker.setMode('ab:5:10')
  event('playing', { paused: false, currentTime: 5 })
  advance(5000)
  tracker.repeat()
  event('seeking', { seeking: true, currentTime: 5 })
  event('seeked', { seeking: false })
  assert.deepEqual(stats(), { active: true, repeats: 1, seconds: 5 })
  tracker.setMode(null)
  advance(5000)
  tracker.setMode('ab:5:10')
  assert.deepEqual(stats(), { active: true, repeats: 1, seconds: 5 })
  tracker.setMode('ab:5:15')
  assert.deepEqual(stats(), { active: true, repeats: 0, seconds: 0 })
  tracker.repeat()
  tracker.setMode('video')
  assert.equal(stats().repeats, 0)
  tracker.repeat()
  tracker.reset()
  assert.deepEqual(stats(), { active: true, repeats: 0, seconds: 0 })
})

test('destroy removes media listeners', () => {
  const { tracker, event, advance, stats } = setup()
  tracker.setMode('video')
  event('playing', { paused: false })
  tracker.destroy()
  advance(10000)
  event('timeupdate')
  assert.equal(stats().seconds, 0)
})
