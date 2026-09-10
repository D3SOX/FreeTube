import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createRenderer } from 'vue'
import { useMobileFullscreenGestures } from '../../src/renderer/components/ft-shaka-video-player/opentubex/useMobileFullscreenGestures.js'

const playerSource = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')

class ElementStub {
  constructor(selector = '') { this.selector = selector }
  closest(selectors) { return this.selector && selectors.includes(this.selector) ? this : null }
}

function fixture(t, { left = 'brightness', right = 'volume', fullscreenSwipe = true, mobile = true, mini = false, height = 200.5, nativeReplay = false } = {}) {
  t.mock.method(globalThis, 'setTimeout', setTimeout)
  const previous = { document: globalThis.document, window: globalThis.window, Element: globalThis.Element }
  globalThis.Element = ElementStub
  globalThis.document = { querySelector: () => ({ classList: { contains: () => mobile } }) }
  globalThis.window = { setTimeout, matchMedia: () => ({ matches: true }) }
  const surface = new ElementStub()
  const calls = []
  const captures = new Set()
  const container = {
    getBoundingClientRect: () => ({ left: 10, width: 400, height }),
    setPointerCapture: id => captures.add(id),
    hasPointerCapture: id => captures.has(id),
    releasePointerCapture: id => captures.delete(id),
  }
  let gestures
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({
    setup() {
      gestures = useMobileFullscreenGestures({
        getContainer: () => container,
        getControls: () => ({ getControlsContainer: () => ({ hasAttribute: () => false }), anySettingsMenusAreOpen: () => false, getConfig: () => ({ tapSeekDistance: 0 }), showUI: () => calls.push('show') }),
        isFullscreenActive: () => false,
        isFullscreenMetadataShown: () => false,
        isFullscreenSwipeEnabled: () => fullscreenSwipe,
        isPlaybackEnded: () => false,
        isPlaybackPaused: () => true,
        isPlayerSurfaceTarget: nativeReplay
          ? vm.runInNewContext(`(${playerSource.match(/function isPlayerSurfaceTarget\(target\) \{[\s\S]*?\n    \}/)[0]})`, {
            Element: ElementStub, video: { value: {} }, container: { value: { hasAttribute: () => true } }
          })
          : target => target === surface,
        isScrollMiniPlayerActive: () => mini,
        getSwipeAction: side => side === 'left' ? left : right,
        adjustments: {
          begin: action => calls.push(['begin', action]),
          update: delta => calls.push(['update', delta]),
          finish: () => calls.push('finish'),
          cancel: () => calls.push('cancel'),
        },
        setFullscreenMetadata() {}, setShowUiOnPaused() {}, showOverlayControls() {},
        togglePlayerFullScreen: () => calls.push('fullscreen'),
      })
      return () => null
    },
  })
  app.mount({})
  t.after(() => { app.unmount(); Object.assign(globalThis, previous) })
  function event(x = 50, y = 150, extra = {}) {
    return { clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', button: 0, isPrimary: true, target: surface,
      preventDefault() { this.prevented = true }, stopPropagation() {}, stopImmediatePropagation() {}, ...extra }
  }
  return { gestures, calls, event, captures }
}

test('left and right vertical swipes use their configured actions with fractional geometry', t => {
  const { gestures: g, event, calls, captures } = fixture(t, { left: 'volume', right: 'brightness', fullscreenSwipe: false })
  for (const [x, action] of [[50, 'volume'], [370, 'brightness']]) {
    calls.length = 0
    g.startMobileFullscreenGesture(event(x))
    assert.equal(g.moveMobileFullscreenGesture(event(x, 49.75)), true)
    g.finishMobileFullscreenGesture(event(x, 49.75))
    assert.deepEqual(calls, [['begin', action], ['update', 0.5], 'finish'])
    assert.equal(captures.size, 0)
    const touchEnd = event()
    g.handleMobilePlayerTouchEnd(touchEnd)
    assert.equal(touchEnd.prevented, true)
    g.handleMobilePlayerSurfaceClick(event(x))
    assert.equal(calls.includes('show'), false)
  }
})

test('a tap still shows controls and does not call native adjustments', t => {
  const { gestures: g, event, calls } = fixture(t)
  g.startMobileFullscreenGesture(event())
  g.moveMobileFullscreenGesture(event(51, 148))
  g.finishMobileFullscreenGesture(event(51, 148))
  assert.deepEqual(calls, ['show'])
})

test('center swipes retain fullscreen and disabled sides allow fullscreen swipes', t => {
  const { gestures: g, event, calls } = fixture(t, { left: 'disabled' })
  for (const x of [50, 210]) {
    g.startMobileFullscreenGesture(event(x))
    assert.equal(g.moveMobileFullscreenGesture(event(x, 50)), true)
    assert.equal(g.mobileFullscreenSwiping.value, true)
    g.cancelMobileFullscreenGesture()
  }
  assert.deepEqual(calls, [])
})

test('horizontal movement never becomes an adjustment later in the same gesture', t => {
  const { gestures: g, event, calls } = fixture(t)
  g.startMobileFullscreenGesture(event())
  g.moveMobileFullscreenGesture(event(100, 149))
  g.moveMobileFullscreenGesture(event(100, 50))
  g.finishMobileFullscreenGesture(event(100, 50))
  assert.deepEqual(calls, [])
})

test('a second finger cancels adjustments for pinch zoom, even when zoom is disabled', t => {
  const { gestures: g, event, calls, captures } = fixture(t)
  g.startMobileFullscreenGesture(event())
  g.moveMobileFullscreenGesture(event(50, 100))
  g.startMobileFullscreenGesture(event(100, 100, { pointerId: 2, isPrimary: false }))
  assert.equal(calls.at(-1), 'cancel')
  assert.equal(captures.size, 0)
  const count = calls.length
  g.moveMobileFullscreenGesture(event(50, 50))
  g.finishMobileFullscreenGesture(event(50, 50))
  assert.equal(calls.length, count)
})

for (const [name, options, extra] of [
  ['desktop', { mobile: false }, {}],
  ['mini player', { mini: true }, {}],
  ['mouse', {}, { pointerType: 'mouse' }],
  ['menu control', {}, { target: new ElementStub() }],
  ['disabled sides', { left: 'disabled', fullscreenSwipe: false }, {}],
]) {
  test(`does not adjust from ${name}`, t => {
    const { gestures: g, event, calls } = fixture(t, options)
    g.startMobileFullscreenGesture(event(50, 150, extra))
    g.moveMobileFullscreenGesture(event(50, 50, extra))
    g.finishMobileFullscreenGesture(event(50, 50, extra))
    assert.deepEqual(calls, [])
  })
}

test('a slightly diagonal start can settle into a vertical side swipe', t => {
  const { gestures: g, event, calls } = fixture(t)
  g.startMobileFullscreenGesture(event(50, 150))
  g.moveMobileFullscreenGesture(event(63, 138))
  g.moveMobileFullscreenGesture(event(64, 100))
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'begin'), true)
})

test('a side swipe that starts on a toolbar button does not click the button on release', t => {
  const { gestures: g, event } = fixture(t)
  const target = new ElementStub('.shaka-controls-button-panel')
  g.startMobileFullscreenGesture(event(370, 150, { target }))
  g.moveMobileFullscreenGesture(event(370, 100, { target }))
  g.finishMobileFullscreenGesture(event(370, 100, { target }))
  const click = event(370, 100, { target })
  assert.equal(g.handleMobilePlayerSurfaceClick(click), true)
  assert.equal(click.prevented, true)
})

for (const [side, x] of [['left', 50], ['right', 370]]) {
  test(`playback speed works on the ${side} with fullscreen swiping disabled`, t => {
    const { gestures: g, event, calls } = fixture(t, { left: 'disabled', right: 'disabled', [side]: 'speed', fullscreenSwipe: false })
    g.startMobileFullscreenGesture(event(x))
    assert.equal(g.moveMobileFullscreenGesture(event(x, 49.75)), true)
    g.finishMobileFullscreenGesture(event(x, 49.75))
    assert.deepEqual(calls, [['begin', 'speed'], ['update', 0.5], 'finish'])
    assert.equal(calls.includes('fullscreen'), false)
  })
}

for (const [placement, x] of [['toolbar', 50], ['center', 210]]) {
  test(`native ${placement} replay taps reach the button without gesture suppression`, t => {
    const { gestures: g, event, calls } = fixture(t, { nativeReplay: true })
    const target = new ElementStub('.shaka-play-button')
    target.classList = { contains: () => false }
    target.closest = selectors => selectors.includes('.shaka-play-button') ||
      (placement === 'toolbar' && selectors.includes('.shaka-controls-button-panel')) ? target : null
    g.startMobileFullscreenGesture(event(x, 150, { target }))
    g.finishMobileFullscreenGesture(event(x, 150, { target }))
    const touchEnd = event(x, 150, { target })
    g.handleMobilePlayerTouchEnd(touchEnd)
    assert.notEqual(touchEnd.prevented, true, 'Touch end must allow the replay click')
    const click = event(x, 150, { target })
    assert.equal(g.handleMobilePlayerSurfaceClick(click), false, 'Click capture must allow Shaka to receive replay')
    assert.notEqual(click.prevented, true)
    assert.deepEqual(calls, [])
  })
}
