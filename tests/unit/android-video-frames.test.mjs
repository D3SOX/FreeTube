import assert from 'node:assert/strict'
import test from 'node:test'
import { attachAndroidVideoFrames } from '../../src/renderer/helpers/player/androidVideoFrames.js'

function fixture(t, captureFrame = async () => ({ dataUrl: 'frame' })) {
  let cleanup
  const saved = new Map(['document', 'requestAnimationFrame', 'cancelAnimationFrame', 'Image']
    .map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
  t.after(() => {
    cleanup?.()
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  })
  globalThis.document = Object.assign(new EventTarget(), { hidden: false })
  let nextFrame
  globalThis.requestAnimationFrame = callback => { nextFrame = callback; return 1 }
  globalThis.cancelAnimationFrame = () => { nextFrame = null }
  globalThis.Image = class { async decode() {} }
  const uploads = []
  const gl = { texImage2D: (...args) => uploads.push(args.at(-1)) }
  const originalUpload = gl.texImage2D
  const element = Object.assign(new EventTarget(), { currentTime: 2, videoWidth: 640, videoHeight: 360, paused: false })
  const detach = attachAndroidVideoFrames(element, { getContext: () => gl }, {
    captureFrame, canCapture: () => true, onError: assert.fail,
  })
  cleanup = detach
  return { element, gl, uploads, originalUpload, detach, tick: () => nextFrame(50) }
}

test('VR texture uploads use the decoded native frame and leave other textures alone', async t => {
  const { element, gl, uploads, originalUpload, detach, tick } = fixture(t)
  let metadata
  element.requestVideoFrameCallback((_now, value) => { metadata = value })
  await tick()
  gl.texImage2D('texture', element)
  const other = {}
  gl.texImage2D('texture', other)
  assert.equal(uploads[0].src, 'frame')
  assert.equal(uploads[1], other)
  assert.equal(metadata.mediaTime, 2)
  detach()
  assert.equal(gl.texImage2D, originalUpload)
  assert.equal(Object.hasOwn(element, 'requestVideoFrameCallback'), false)
})

test('replacing a source while a native frame is being captured discards that frame', async t => {
  const pending = Promise.withResolvers()
  const { element, gl, uploads, tick } = fixture(t, () => pending.promise)
  let callbacks = 0
  element.requestVideoFrameCallback(() => { callbacks++ })
  const rendering = tick()
  element.dispatchEvent(new Event('emptied'))
  pending.resolve({ dataUrl: 'old-frame' })
  await rendering
  gl.texImage2D('texture', element)
  assert.equal(uploads.length, 0)
  assert.equal(callbacks, 0)
})
