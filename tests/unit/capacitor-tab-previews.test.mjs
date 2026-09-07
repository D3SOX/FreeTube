import assert from 'node:assert/strict'
import test from 'node:test'
import { Capacitor } from '@capacitor/core'

// Register the plugins against a native bridge so their real proxies call our mocks.
globalThis.androidBridge = {}
Capacitor.PluginHeaders = [
  { name: 'Screenshot', methods: [{ name: 'take', rtype: 'promise' }] },
  { name: 'Filesystem', methods: [{ name: 'deleteFile', rtype: 'promise' }] },
]
Capacitor.nativePromise = async () => {}
const {
  captureBeforeTabOrganizer,
  getCapacitorTabPreview,
  initializeCapacitorTabPreviews,
} = await import('../../src/renderer/tabs/capacitorTabPreviews.js')
delete globalThis.androidBridge

function setup(t, { cleanupError, decodeError } = {}) {
  const preview = 'data:image/jpeg;base64,cHJldmlldw=='
  const uri = '/cache/temporary-screenshot.jpg'
  const tab = { id: 'tab', route: { fullPath: '/home' }, loadState: 'loaded' }
  const store = { getters: {
    getShowTabPreviews: true,
    getPresentedTab: tab,
    getPresentedTabId: tab.id,
    getActiveTabId: tab.id,
    getTabs: [tab],
  } }
  const document = new EventTarget()
  let overlayReads = 0
  Object.assign(document, {
    visibilityState: 'visible',
    querySelector: () => null,
    querySelectorAll: selector => {
      if (selector.includes('[role=')) overlayReads += 1
      return []
    },
    createElement: () => ({
      getContext: () => ({ drawImage() {} }),
      toDataURL: () => preview,
    }),
  })
  const globals = {
    document,
    window: Object.assign(new EventTarget(), { innerWidth: 375, innerHeight: 700 }),
    Image: class {
      width = 750
      height = 1400
      async decode() { if (decodeError) throw decodeError }
    },
  }
  const restoreGlobals = []
  for (const [name, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name)
    Object.defineProperty(globalThis, name, { configurable: true, value })
    restoreGlobals.push(() => {
      if (original) Object.defineProperty(globalThis, name, original)
      else delete globalThis[name]
    })
  }
  const originalNative = process.env.IS_CAPACITOR
  process.env.IS_CAPACITOR = 'true'
  t.after(() => {
    if (originalNative === undefined) delete process.env.IS_CAPACITOR
    else process.env.IS_CAPACITOR = originalNative
  })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.mock.method(Capacitor, 'isPluginAvailable', () => true)
  t.mock.method(Capacitor, 'convertFileSrc', value => value)
  const take = t.mock.fn(async () => ({ uri }))
  const remove = t.mock.fn(async () => {
    if (cleanupError) throw cleanupError
  })
  t.mock.method(Capacitor, 'nativePromise', async (plugin, method, options) => {
    if (plugin === 'Screenshot' && method === 'take') return take(options)
    if (plugin === 'Filesystem' && method === 'deleteFile') return remove(options)
    assert.fail(`Unexpected native call: ${plugin}.${method}`)
  })
  const warn = t.mock.method(console, 'warn', () => {})
  const dispose = initializeCapacitorTabPreviews(store)
  t.after(() => {
    dispose()
    for (const restore of restoreGlobals) restore()
  })
  overlayReads = 0
  return { document, store, tab, preview, uri, take, remove, warn, overlayReads: () => overlayReads }
}

test('a cleanup failure preserves the successfully captured page preview', async t => {
  const error = new Error('Temporary file could not be deleted')
  const state = setup(t, { cleanupError: error })
  await captureBeforeTabOrganizer()
  assert.equal(getCapacitorTabPreview(state.tab), state.preview)
  assert.deepEqual(state.remove.mock.calls[0].arguments, [{ path: state.uri }])
  assert.equal(state.warn.mock.callCount(), 1)
  assert.equal(state.warn.mock.calls[0].arguments[1], error)
})

test('cleanup is attempted after decoding fails without replacing the capture error', async t => {
  const decodeError = new Error('Invalid screenshot')
  const state = setup(t, { decodeError, cleanupError: new Error('Cleanup failed') })
  await captureBeforeTabOrganizer()
  assert.equal(getCapacitorTabPreview(state.tab), null)
  assert.equal(state.remove.mock.callCount(), 1)
  assert.equal(state.warn.mock.calls.at(-1).arguments[1], decodeError)
})

test('scroll events defer overlay reads and native capture until scrolling settles', async t => {
  const state = setup(t)
  for (let i = 0; i < 5; i += 1) {
    state.document.dispatchEvent(new Event('scroll'))
    t.mock.timers.tick(100)
  }
  assert.equal(state.overlayReads(), 0)
  assert.equal(state.take.mock.callCount(), 0)
  t.mock.timers.tick(499)
  assert.equal(state.overlayReads(), 0)
  t.mock.timers.tick(1)
  await new Promise(setImmediate)
  assert.equal(state.take.mock.callCount(), 1)
  assert.ok(state.overlayReads() > 0)
  assert.equal(getCapacitorTabPreview(state.tab), state.preview)
})

test('a scheduled capture rechecks whether previews are enabled', async t => {
  const state = setup(t)
  state.document.dispatchEvent(new Event('scroll'))
  state.store.getters.getShowTabPreviews = false
  t.mock.timers.tick(600)
  await new Promise(setImmediate)
  assert.equal(state.take.mock.callCount(), 0)
  assert.equal(getCapacitorTabPreview(state.tab), null)
})
