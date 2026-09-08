import assert from 'node:assert/strict'
import test from 'node:test'
import { androidPlaybackTracks } from '../../src/renderer/helpers/player/androidPlaybackTracks.js'

test('native quality and audio menus preserve SABR identities, roles and active selection', () => {
  const formats = [
    { itag: 140, lastModified: '123', isOriginal: true },
    { itag: 251, lastModified: '456', isDrc: true },
    { itag: 137, lastModified: '789' },
  ]
  const tracks = [
    { group: 0, index: 0, type: 1, id: '0', supported: true, selected: true, language: 'de', bitrate: 128000 },
    { group: 1, index: 0, type: 1, id: '1', supported: true, selected: false, language: 'de', bitrate: 128000 },
    { group: 2, index: 0, type: 2, id: '2', supported: true, selected: true, width: 1920, height: 1080, bitrate: 2000000 },
    { group: 2, index: 1, type: 2, id: '3', supported: false, selected: false, width: 3840, height: 2160 },
  ]
  const result = androidPlaybackTracks(tracks, formats)
  assert.equal(result.variants.length, 2)
  assert.deepEqual(result.audio.map(track => track.roles), [['main'], ['drc']])
  assert.equal(result.variants[0].originalAudioId, '140-123-')
  assert.equal(result.variants[0].originalVideoId, '137-789-')
  assert.equal(result.variants[0].bandwidth, 2128000)
  assert.equal(result.variants[0].active, true)
  assert.equal(result.variants[1].active, false)
  assert.deepEqual(result.variants[0].nativeVideo, tracks[2])
})

test('audio-only native playback still exposes a selected variant', () => {
  const result = androidPlaybackTracks([
    { group: 0, index: 0, type: 1, supported: true, selected: true, id: 'audio', bitrate: 96000 },
  ])
  assert.equal(result.variants.length, 1)
  assert.equal(result.variants[0].active, true)
  assert.equal(result.variants[0].videoId, null)
})

test('a native local video without audio remains selectable', () => {
  const { variants } = androidPlaybackTracks([
    { group: 0, index: 0, type: 2, supported: true, selected: true, id: 'video', width: 640, height: 360, bitrate: 500000 },
  ])
  assert.equal(variants.length, 1)
  assert.equal(variants[0].active, true)
  assert.equal(variants[0].audioId, null)
  assert.deepEqual(variants[0].audioRoles, [])
})

test('native quality menu groups codec encodes while retaining every playback variant', () => {
  const audio = { type: 1, supported: true, selected: true, group: 0, index: 0, id: 'audio' }
  const base = { type: 2, supported: true, width: 1920, height: 1080, frameRate: 30, group: 1 }
  const videos = [
    { ...base, index: 0, id: 'avc', codecs: 'avc1.640028', bitrate: 1500000 },
    { ...base, index: 1, id: 'vp9', codecs: 'vp09.00.51.08', bitrate: 1400000, selected: true },
    { ...base, index: 2, id: 'av1', codecs: 'av01.0.08M.08', bitrate: 1000000 },
    { ...base, index: 3, id: 'avc720', width: 1280, height: 720, codecs: 'avc1.64001f' },
    { ...base, index: 4, id: 'vp9720', width: 1280, height: 720, codecs: 'vp09.00.31.08' },
    { ...base, index: 5, id: 'vp960', frameRate: 60, codecs: 'vp09.00.51.08' },
    { ...base, index: 6, id: 'hdr', hdr: 'PQ', codecs: 'vp09.02.51.10' },
    { ...base, index: 7, id: 'unsupported', height: 2160, supported: false },
  ]
  const result = androidPlaybackTracks([audio, ...videos])
  assert.equal(result.variants.length, 7)
  assert.deepEqual(result.video?.map(track => track.nativeTrack.id), ['vp9', 'vp9720', 'vp960', 'hdr'])
  assert.equal(result.video.filter(track => track.active).length, 1)
  assert.equal(result.video[0].bandwidth, 1400000)
  assert.equal(result.video[0].codecs, 'vp09.00.51.08')
  assert.equal(androidPlaybackTracks([audio]).video.length, 0)
  videos[1].selected = false
  videos[2].selected = true
  assert.equal(androidPlaybackTracks([audio, ...videos]).video[0].nativeTrack.id, 'av1')
})
