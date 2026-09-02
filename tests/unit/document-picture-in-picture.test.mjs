import assert from 'node:assert/strict'
import test from 'node:test'

import {
  shouldEnableDocumentPictureInPicture
} from '../../src/renderer/helpers/player/documentPictureInPicture.js'

test('uses video PiP on Electron native Wayland', () => {
  assert.equal(shouldEnableDocumentPictureInPicture(true, true), false)
})

test('uses Document PiP where always-on-top windows are supported', () => {
  assert.equal(shouldEnableDocumentPictureInPicture(true, false), true)
  assert.equal(shouldEnableDocumentPictureInPicture(false, true), true)
})
