import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { overrideShakaMethods } from '../../src/renderer/helpers/player/overrideShakaMethods.js'

const source = (await readFile(new URL('../../src/renderer/helpers/player/androidNativeScreen.js', import.meta.url), 'utf8'))
  .replace(/^import .*\n/gm, '').replace('export function ', 'function ')

async function fixture({ fullscreen = true, chrome = [], dialogs = [], deferTransitions = false, deferFullscreen = false } = {}) {
  const frames = new Map()
  const layouts = []
  const presentations = []
  const completeTransitions = []
  const completeFullscreen = []
  const fullscreenEvents = []
  const observers = []
  const styleWrites = []
  const window = Object.assign(new EventTarget(), { innerWidth: 1000, innerHeight: 700, scrollX: 0, scrollY: 0 })
  let shown = true
  let menu = false
  let panel = false
  let recommendations = false
  let ended = false
  let animating = false
  let id = 0
  const bounds = { x: 0, y: 0, width: 640, height: 360 }
  const controlsElement = { hasAttribute: () => shown, getBoundingClientRect: () => bounds }
  const container = Object.assign(new EventTarget(), {
    classList: { contains: name => panel && ['fullscreenDockLayoutOpen', 'chaptersOverlayOpen'].includes(name) },
    contains: () => false,
    getBoundingClientRect: () => bounds,
    toggleAttribute() {},
    getAnimations: () => animating ? [{ playState: 'running' }] : [],
    querySelectorAll(selector) { return menu && selector.includes('shaka-overflow-menu') ? [{ getAnimations: () => [], getBoundingClientRect: () => ({ x: 400, y: 100, width: 200, height: 240 }) }] : [] },
    querySelector(selector) {
      if (selector === '.shaka-controls-container') return controlsElement
      if (selector === '.endedPoster' && (ended || recommendations)) return { getBoundingClientRect: () => bounds }
      if (selector === '.endedScreen' && recommendations) return { getBoundingClientRect: () => bounds }
      return null
    },
  })
  const element = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => bounds, getAnimations: () => [],
  })
  const document = Object.assign(new EventTarget(), { body: { append() {}, getBoundingClientRect: () => ({ height: 2000 }) }, createElement: () => ({ setAttribute() {}, remove() {}, style: { getPropertyValue() { return '' }, setProperty(name, value) { styleWrites.push({ name, value }) } } }), elementFromPoint: () => null, querySelectorAll: selector => selector.includes('.topNav') ? chrome : selector.includes('dialog[open]') ? dialogs : [], documentElement: { classList: { toggle() {} }, style: { getPropertyValue() { return '' }, setProperty(name, value) { styleWrites.push({ name, value }) }, removeProperty() {} } } })
  document.addEventListener('fullscreenchange', () => fullscreenEvents.push(presentations.length))
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this) }
    observe(target, options) { if (options) this.options = { attributeFilter: [...(this.options?.attributeFilter ?? []), ...options.attributeFilter] } }
    disconnect() {}
  }
  const create = vm.runInNewContext(`${source}\ncreateAndroidNativeScreen`, {
    document, window, Event,
    ResizeObserver: Observer, MutationObserver: Observer, overrideShakaMethods,
    getComputedStyle: () => ({ borderTopLeftRadius: '12px' }),
    requestAnimationFrame(callback) { frames.set(++id, callback); return id },
    cancelAnimationFrame(id) { frames.delete(id) },
  })
  const screen = create({ element, container, getController: () => ({
    async show(value) {
      presentations.push(value)
      if (deferFullscreen && value.fullscreen) await new Promise(resolve => completeFullscreen.push(resolve))
    }, async hide() {}, async layout(value) {
      layouts.push(value)
      if (deferTransitions && value.transition) await new Promise(resolve => completeTransitions.push(resolve))
    },
  }), getLocale: () => 'en-US', onError: error => { throw error } })
  async function flush() {
    for (const [id, callback] of [...frames]) { frames.delete(id); callback() }
    await Promise.resolve()
  }
  if (fullscreen) await screen.show()
  else await screen.attach()
  await flush()
  return { screen, container, layouts, presentations, completeTransitions, completeFullscreen, fullscreenEvents, bounds, observers, window, styleWrites, flush, change({ visible = shown, menuOpen = menu, panelOpen = panel, containerAnimating = animating, endedRecommendations = recommendations, playbackEnded = ended }) {
    shown = visible; menu = menuOpen; panel = panelOpen
    recommendations = endedRecommendations
    ended = playbackEnded
    animating = containerAnimating
    for (const observer of observers) observer.callback([{ type: 'attributes', attributeName: 'style', target: container }])
  } }
}

test('fractional Android scrolling does not repaint an unchanged document cutout', async () => {
  const f = await fixture({ fullscreen: false })
  f.bounds.y = 111
  f.bounds.width = 460.79998779296875
  f.bounds.height = 259.20001220703125
  f.change({})
  await f.flush()
  f.styleWrites.length = 0
  for (let i = 1; i <= 40; i++) {
    // WebView returns float32 viewport bounds and fractional CSS scroll offsets.
    // Adding them back produces small errors even with an unchanged document Y.
    f.window.scrollY = Math.fround(i * 3.2)
    f.bounds.y = Math.fround(111 - f.window.scrollY)
    f.window.dispatchEvent(new Event('scroll'))
    await f.flush()
  }
  assert.equal(f.styleWrites.filter(write => write.name === 'clip-path').length, 0)
  // Preserve real subpixel layout changes, including fractional UI scaling.
  f.bounds.y += 0.125
  f.change({})
  await f.flush()
  const clips = f.styleWrites.filter(write => write.name === 'clip-path')
  assert.equal(clips.length, 1)
  assert.ok(clips[0].value.includes('111.125'))
  f.screen.destroy()
})

test('live dragging and resizing keeps the page cutout fixed and restores its final fractional geometry', async () => {
  const f = await fixture({ fullscreen: false })
  const gesture = active => {
    const event = new Event('native-player-gesture')
    event.detail = active
    f.container.dispatchEvent(event)
  }
  gesture(true)
  await f.flush()
  assert.equal(f.layouts.at(-1).gestureActive, true)
  f.styleWrites.length = 0
  for (let i = 0; i < 20; i++) {
    f.bounds.width += 0.125
    f.bounds.x += 0.375
    f.change({})
    await f.flush()
  }
  assert.equal(f.styleWrites.filter(write => write.name === 'clip-path').length, 0)
  assert.equal(f.layouts.at(-1).width, f.bounds.width)
  gesture(false)
  await f.flush()
  assert.equal(f.layouts.at(-1).gestureActive, false)
  assert.equal(f.styleWrites.filter(write => write.name === 'clip-path').length, 1)
  // Replacing the player during a gesture must release native ownership too.
  gesture(true)
  await f.flush()
  f.screen.reset()
  assert.equal(f.layouts.at(-1).gestureActive, false)
  f.screen.destroy()
})

test('mini-player motion is sent as one native animation instead of separate browser frames', async () => {
  const f = await fixture({ fullscreen: false })
  const event = new Event('native-player-transition', { cancelable: true })
  event.detail = { from: { x: 0, y: 100, width: 640, height: 360 }, to: { x: 300, y: 400, width: 300, height: 168.75 }, duration: 300 }
  f.container.dispatchEvent(event)
  assert.equal(event.defaultPrevented, true, 'The native surface must own motion above the page')
  await event.detail.finished
  const transitions = f.layouts.filter(layout => layout.transition)
  assert.equal(transitions.length, 1)
  assert.equal(transitions[0].transition.duration, 300)
  assert.equal(transitions[0].x, 300)
  assert.ok(f.layouts.some(layout => layout.endTransition), 'Return below shared controls only after the final page clip is ready')
  f.screen.destroy()
})

test('an edge animation takes over a live gesture without retaining gesture ownership', async () => {
  const f = await fixture({ fullscreen: false })
  const gesture = new Event('native-player-gesture')
  gesture.detail = true
  f.container.dispatchEvent(gesture)
  await f.flush()
  const motion = new Event('native-player-transition', { cancelable: true })
  motion.detail = { from: f.bounds, to: { ...f.bounds, x: -200 }, duration: 300 }
  f.container.dispatchEvent(motion)
  await motion.detail.finished
  assert.equal(f.layouts.filter(layout => 'gestureActive' in layout).at(-1).gestureActive, false)
  assert.equal(f.layouts.at(-1).endTransition, true)
  f.screen.destroy()
})

test('an interrupted transition cannot lower the video during its replacement', async () => {
  const f = await fixture({ fullscreen: false, deferTransitions: true })
  const motions = [100, 300].map(y => {
    const event = new Event('native-player-transition', { cancelable: true })
    event.detail = { from: f.bounds, to: { ...f.bounds, y }, duration: 300 }
    f.container.dispatchEvent(event)
    return event.detail.finished
  })
  f.completeTransitions[0]()
  await motions[0]
  assert.equal(f.layouts.filter(layout => layout.endTransition).length, 0)
  f.completeTransitions[1]()
  await motions[1]
  assert.equal(f.layouts.filter(layout => layout.endTransition).length, 1)
  f.screen.destroy()
})

test('app chrome clips native controls when scrolling carries the player under the header', async () => {
  const header = { x: 0, y: 24, width: 1000, height: 60 }
  const f = await fixture({ fullscreen: false, chrome: [{ matches: () => true, getAnimations: () => [], getBoundingClientRect: () => header }] })
  assert.ok(f.layouts.at(-1).menus.some(rect => rect.y === 0 && rect.height === 84))
  assert.equal(f.layouts.at(-1).overlayActive, false, 'App chrome does not count as an open panel')
  f.screen.destroy()
})

test('native geometry follows every frame of a mini-player container animation', async () => {
  const f = await fixture({ fullscreen: false })
  f.change({ containerAnimating: true })
  await f.flush()
  f.bounds.y = 100
  await f.flush()
  assert.equal(f.layouts.at(-1).y, 100, 'Ancestor transforms need a fresh native layout without another DOM mutation')
  f.bounds.y = 200
  await f.flush()
  assert.equal(f.layouts.at(-1).y, 200)
  f.change({ containerAnimating: false })
  await f.flush()
  f.screen.destroy()
})

test('initial attachment requests an inline native surface without a fullscreen transition', async () => {
  const f = await fixture({ fullscreen: false })
  assert.equal(f.screen.isOpen(), false)
  assert.equal(f.screen.hasSurface(), true)
  assert.equal(f.presentations.at(-1).fullscreen, false)
  await f.screen.show()
  assert.equal(f.screen.isOpen(), true)
  assert.equal(f.presentations.at(-1).fullscreen, true)
  f.screen.destroy()
})

test('native controls follow shared shown state, including paused tap-to-hide', async () => {
  const f = await fixture()
  assert.equal(f.layouts.at(-1).controlsVisible, true)
  assert.ok(f.observers.some(observer => observer.options?.attributeFilter.includes('shown')))
  f.change({ visible: false })
  await f.flush()
  assert.equal(f.layouts.at(-1).controlsVisible, false)
  f.change({ visible: true })
  await f.flush()
  assert.equal(f.layouts.at(-1).controlsVisible, true)
  f.screen.destroy()
})

for (const fullscreen of [false, true]) {
  test(`end-screen recommendations hide native transport controls ${fullscreen ? 'in fullscreen' : 'inline'}`, async () => {
    const f = await fixture({ fullscreen })
    assert.equal(f.layouts.at(-1).controlsVisible, true)
    f.change({ endedRecommendations: true })
    await f.flush()
    assert.equal(f.layouts.at(-1).controlsVisible, false, 'Native play and seek buttons must not cover recommendation links')
    f.change({ visible: false })
    await f.flush()
    f.change({ visible: true })
    await f.flush()
    assert.equal(f.layouts.at(-1).controlsVisible, false, 'Revealing the shared toolbar must not restore the overlapping native buttons')
    f.change({ endedRecommendations: false })
    await f.flush()
    assert.equal(f.layouts.at(-1).controlsVisible, true, 'Leaving the end screen restores native controls')
    f.screen.destroy()
  })
}

test('side panels and menus retain transport controls inside the video column', async () => {
  const f = await fixture()
  f.change({ panelOpen: true })
  await f.flush()
  assert.equal(f.layouts.at(-1).overlayActive, true)
  assert.equal(f.layouts.at(-1).controlsVisible, true)
  assert.equal(f.layouts.at(-1).controlsWidth, 640)
  f.change({ menuOpen: true })
  await f.flush()
  assert.equal(f.layouts.at(-1).controlsVisible, true)
  assert.equal(JSON.stringify(f.layouts.at(-1).menus), JSON.stringify([{ x: 400, y: 100, width: 200, height: 240, pageScroll: false }]))
  f.change({ menuOpen: false })
  await f.flush()
  assert.equal(f.layouts.at(-1).menus.length, 0)
  f.screen.destroy()
})

test('inline native controls follow the player bounds and shared visibility after leaving fullscreen', async () => {
  const f = await fixture()
  await f.screen.hide()
  f.bounds.x = 20
  f.bounds.y = 120
  f.bounds.width = 360
  f.bounds.height = 203
  f.change({ visible: true })
  await f.flush()
  assert.equal(f.layouts.at(-1).controlsX, 20)
  assert.equal(f.layouts.at(-1).controlsY, 120)
  assert.equal(f.layouts.at(-1).controlsVisible, true)
  f.change({ visible: false })
  await f.flush()
  assert.equal(f.layouts.at(-1).controlsVisible, false)
  f.screen.destroy()
})

for (const cancel of [false, true]) {
  test(`fullscreen rotation starts with native presentation${cancel ? ' and cancels without a late entry' : ''}`, async () => {
    const f = await fixture({ fullscreen: false, deferFullscreen: true })
    const entering = f.screen.show()
    assert.deepEqual(f.fullscreenEvents, [2], 'Queue native fullscreen and rotation together, before a portrait fullscreen frame is drawn')
    if (cancel) await f.screen.hide()
    f.completeFullscreen[0]()
    await entering
    assert.equal(f.fullscreenEvents.length, cancel ? 2 : 1)
    assert.equal(f.screen.isOpen(), !cancel)
    f.screen.destroy()
  })
}

for (const teardown of ['reset', 'destroy']) {
  test(`deferred fullscreen entry cannot restore a surface after ${teardown}`, async () => {
    const f = await fixture({ fullscreen: false, deferFullscreen: true })
    const entering = f.screen.show()
    f.screen[teardown]()
    f.completeFullscreen[0]()
    await entering
    assert.equal(f.screen.hasSurface(), false)
    assert.equal(f.screen.isOpen(), false)
    assert.equal(f.fullscreenEvents.length, 2)
    f.screen.destroy()
  })
}

for (const fullscreen of [false, true]) {
  test(`end screens without recommendations reserve the center for shared replay ${fullscreen ? 'in fullscreen' : 'inline'}`, async () => {
    const f = await fixture({ fullscreen })
    f.change({ playbackEnded: true })
    await f.flush()
    assert.equal(f.layouts.at(-1).controlsVisible, false, 'Native transport controls must not overlap the shared replay button')
    f.change({ playbackEnded: false })
    await f.flush()
    assert.equal(f.layouts.at(-1).controlsVisible, true)
    f.screen.destroy()
  })
}


for (const fullscreen of [false, true]) {
  test(`open HTML sheets clip native controls and update when dismissed (${fullscreen ? 'fullscreen' : 'inline'})`, async () => {
    let open = true
    const dialog = {
      matches: () => false,
      getAnimations: () => [],
      getBoundingClientRect: () => ({ x: 0, y: 200, width: open ? 640 : 0, height: open ? 500 : 0 })
    }
    const f = await fixture({ fullscreen, dialogs: [dialog] })
    assert.equal(f.layouts.at(-1).overlayActive, true)
    assert.ok(f.layouts.at(-1).menus.some(rect => rect.y === 200 && rect.height === 500))
    const observer = f.observers.find(observer => observer.options?.attributeFilter.includes('open'))
    assert.ok(observer, 'Opening and closing a dialog must invalidate native occlusion')
    open = false
    observer.callback([{ type: 'attributes', attributeName: 'open', target: dialog }])
    await f.flush()
    assert.equal(f.layouts.at(-1).overlayActive, false)
    assert.equal(f.layouts.at(-1).menus.length, 0)
    f.screen.destroy()
  })

}
