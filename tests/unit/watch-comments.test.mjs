import assert from 'node:assert/strict'
import test from 'node:test'

import { getLocalPremiereState } from '../../src/renderer/helpers/premiere.js'
import { areCommentsAvailable } from '../../src/renderer/views/Watch/watchComments.js'

test('only identifies a Local API livestream as a premiere from an explicit marker', () => {
  assert.equal(getLocalPremiereState({ isLive: true, isLiveContent: false }), true)
  assert.equal(getLocalPremiereState({ isLive: true, isLiveContent: true }), false)
  assert.equal(getLocalPremiereState({ isLive: true }), undefined)
  assert.equal(getLocalPremiereState({ isLive: false }), false)
})

test('shows comments for videos and active premieres but not live streams', () => {
  assert.equal(areCommentsAvailable({ isLive: false, isPremiere: false, hideComments: false }), true)
  assert.equal(areCommentsAvailable({ isLive: true, isPremiere: true, hideComments: false }), true)
  assert.equal(areCommentsAvailable({ isLive: true, isPremiere: false, hideComments: false }), false)
})

test('respects the hide comments preference for premieres', () => {
  assert.equal(areCommentsAvailable({ isLive: true, isPremiere: true, hideComments: true }), false)
})

test('downloaded playback without online metadata does not mount a comments request that waits forever offline', () => {
  assert.equal(areCommentsAvailable({ isLive: false, hideComments: false, localFilePlayback: true, channelId: '' }), false)
  assert.equal(areCommentsAvailable({ isLive: false, hideComments: false, localFilePlayback: true, channelId: 'UCchannel' }), true)
})
