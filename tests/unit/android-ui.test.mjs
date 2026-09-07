import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldShowAndroidStatusBar } from '../../src/renderer/helpers/androidUi.js'
import { shouldRotateFullscreenToLandscape } from '../../src/renderer/helpers/capacitorUi.js'

test('fullscreen landscape videos request landscape display orientation', () => {
  assert.equal(shouldRotateFullscreenToLandscape(true, { videoWidth: 1920, videoHeight: 1080 }), true)
})

test('fullscreen orientation rotation can be disabled on mobile', () => {
  assert.equal(
    shouldRotateFullscreenToLandscape(true, { videoWidth: 1920, videoHeight: 1080 }, false),
    false
  )
})

test('portrait, square, unknown, and inline videos keep the user display orientation', () => {
  assert.equal(shouldRotateFullscreenToLandscape(true, { videoWidth: 1080, videoHeight: 1920 }), false)
  assert.equal(shouldRotateFullscreenToLandscape(true, { videoWidth: 1080, videoHeight: 1080 }), false)
  assert.equal(shouldRotateFullscreenToLandscape(true, { videoWidth: 0, videoHeight: 0 }), false)
  assert.equal(shouldRotateFullscreenToLandscape(false, { videoWidth: 1920, videoHeight: 1080 }), false)
})

test('fullscreen hides the Android status bar only while player controls are hidden', () => {
  assert.equal(shouldShowAndroidStatusBar({ active: true, fullscreen: true, controlsShown: false }), false)
  assert.equal(shouldShowAndroidStatusBar({ active: true, fullscreen: true, controlsShown: true }), true)
  assert.equal(shouldShowAndroidStatusBar({ active: true, fullscreen: false, controlsShown: false }), true)
  assert.equal(shouldShowAndroidStatusBar({ active: false, fullscreen: true, controlsShown: false }), true)
})
