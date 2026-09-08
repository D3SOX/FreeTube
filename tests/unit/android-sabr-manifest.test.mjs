import assert from 'node:assert/strict'
import test from 'node:test'

import { createAndroidSabrDashManifest } from '../../src/renderer/helpers/player/androidSabrManifest.js'

const audio = {
  itag: 140,
  lastModified: '123',
  mimeType: 'audio/mp4; codecs="mp4a.40.2"',
  bitrate: 128000,
  initRange: { start: 0, end: 700 },
  indexRange: { start: 701, end: 900 },
  audioSampleRate: 44100,
  audioChannels: 2,
  language: 'de',
  label: 'Deutsch & Original',
  isOriginal: true,
}
const video = {
  ...audio,
  itag: 137,
  mimeType: 'video/mp4; codecs="avc1.640028"',
  bitrate: 2000000,
  width: 1920,
  height: 1080,
  frameRate: 30,
  language: undefined,
  label: undefined,
  isOriginal: undefined,
}

test('native SABR uses the original byte indexes and one stable resource per format', () => {
  const mpd = createAndroidSabrDashManifest({ duration: 120, formats: [audio, video] }, 'session-1')
  assert.match(mpd, /mediaPresentationDuration="PT120S"/)
  assert.match(mpd, /<BaseURL>otxsabr:\/\/session-1\/0<\/BaseURL>/)
  assert.match(mpd, /<BaseURL>otxsabr:\/\/session-1\/1<\/BaseURL>/)
  assert.match(mpd, /indexRange="701-900"/)
  assert.match(mpd, /range="0-700"/)
  assert.match(mpd, /codecs="avc1.640028"/)
  assert.match(mpd, /width="1920" height="1080" frameRate="30"/)
  assert.match(mpd, /Deutsch &amp; Original/)
  assert.match(mpd, /value="main"/)
})

test('native SABR audio-only selection leaves the original resource indexes intact', () => {
  const mpd = createAndroidSabrDashManifest({ duration: 120, formats: [video, audio] }, 'session-1', true)
  assert.doesNotMatch(mpd, /video\/mp4/)
  assert.match(mpd, /otxsabr:\/\/session-1\/1/)
})

test('native SABR rejects invalid durations, range metadata and owner identifiers', () => {
  assert.throws(() => createAndroidSabrDashManifest({ duration: Infinity, formats: [audio] }, 'session-1'))
  assert.throws(() => createAndroidSabrDashManifest({ duration: 10, formats: [audio] }, 'owner/other'))
  assert.throws(() => createAndroidSabrDashManifest({ duration: 10, formats: [
    { ...audio, indexRange: { start: 900, end: 701 } },
  ] }, 'session-1'))
})
