import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createAndroidMediaSessionState,
  shouldPauseAndroidPlaybackOnAppStateChange,
} from '../../src/renderer/helpers/androidMediaSession.js'

test('builds a bounded Android media state for the presented player', () => {
  assert.deepEqual(createAndroidMediaSessionState({
    playbackState: 'playing',
    metadata: {
      title: 'Video title',
      artist: 'Channel name',
      artwork: [{ src: 'https://example.com/thumb.jpg' }]
    },
    positionState: { duration: 120, position: 25, playbackRate: 1.5 },
    actionHandlers: {
      play: () => {},
      pause: () => {},
      seekbackward: () => {},
      nexttrack: null,
      unsupported: () => {}
    }
  }), {
    playbackState: 'playing',
    title: 'Video title',
    artist: 'Channel name',
    artwork: 'https://example.com/thumb.jpg',
    duration: 120,
    position: 25,
    playbackRate: 1.5,
    actions: ['play', 'pause', 'seekbackward']
  })
})

test('only pauses a backgrounded Android player after the user opts out', () => {
  assert.equal(shouldPauseAndroidPlaybackOnAppStateChange(false, true), false)
  assert.equal(shouldPauseAndroidPlaybackOnAppStateChange(false, false), true)
  assert.equal(shouldPauseAndroidPlaybackOnAppStateChange(true, false), false)
})

test('keeps the native source owner on renderer notification updates', () => {
  const payload = createAndroidMediaSessionState({ playbackState: 'playing', nativeOwner: 'android-source-1' })
  assert.equal(payload.nativeOwner, 'android-source-1')
  assert.equal(Object.hasOwn(createAndroidMediaSessionState(), 'nativeOwner'), false)
})
