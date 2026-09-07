import assert from 'node:assert/strict'
import test from 'node:test'
import { capturePlayerFrame } from '../../src/renderer/helpers/player/capturePlayerFrame.js'

test('browser video remains the screenshot and ambient drawing source', async () => {
  const video = {}
  assert.equal(await capturePlayerFrame(video, 80, 45), video)
})

test('native frame capture waits for image decoding before drawing', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Image')
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'Image', previous)
    else delete globalThis.Image
  })
  globalThis.Image = class {
    async decode() { this.decoded = true }
  }
  const calls = []
  const video = { nativePlayback: { captureFrame: async size => {
    calls.push(size)
    return { dataUrl: 'data:image/png;base64,fixture' }
  } } }
  const frame = await capturePlayerFrame(video, 80, 45)
  assert.deepEqual(calls, [{ width: 80, height: 45 }])
  assert.equal(frame.src, 'data:image/png;base64,fixture')
  assert.equal(frame.decoded, true)
})
