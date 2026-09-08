import assert from 'node:assert/strict'
import test from 'node:test'
import { androidCaptionCues } from '../../src/renderer/helpers/player/androidCaptionCues.js'

test('native captions clamp negative starts and discard empty or invalid intervals', () => {
  assert.deepEqual(androidCaptionCues([
    { startTime: -2, endTime: 1, payload: 'Visible at start' },
    { startTime: 1, endTime: 1, payload: 'Marker' },
    { startTime: 2, endTime: NaN, payload: 'Invalid' },
    { startTime: 3, endTime: 4, payload: '' },
    { startTime: 4, endTime: Infinity, payload: 'Until the end' },
  ], 5), [
    { startTime: 0, endTime: 1, text: 'Visible at start' },
    { startTime: 4, endTime: 5, text: 'Until the end' },
  ])
})

test('native captions preserve progressive nested WebVTT word timing and line breaks', () => {
  assert.deepEqual(androidCaptionCues([{ startTime: 1, endTime: 5, nestedCues: [
    { startTime: 1, endTime: 5, payload: 'Hello' },
    { startTime: 2, endTime: 5, nestedCues: [{ lineBreak: true }, { payload: 'world' }] },
    { startTime: 3, endTime: 4, payload: '!' },
  ] }], 10), [
    { startTime: 1, endTime: 2, text: 'Hello' },
    { startTime: 2, endTime: 3, text: 'Hello\nworld' },
    { startTime: 3, endTime: 4, text: 'Hello\nworld!' },
    { startTime: 4, endTime: 5, text: 'Hello\nworld' },
  ])
})
