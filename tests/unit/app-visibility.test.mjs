import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

import { isAppHidden, setAndroidAppVisible } from '../../src/renderer/helpers/appVisibility.js'
import { resolveAndroidBackgroundPlaybackFormat } from '../../src/renderer/helpers/player/androidBackgroundPlayback.js'

test('Android background playback follows Home even when Chromium stays visible for a refresh', () => {
  const originalDocument = globalThis.document
  const document = new EventTarget()
  document.hidden = false
  globalThis.document = document
  const changes = []
  document.addEventListener('visibilitychange', () => { changes.push(isAppHidden()) })
  try {
    setAndroidAppVisible(true)
    setAndroidAppVisible(false)
    assert.equal(isAppHidden(), true)
    assert.deepEqual(resolveAndroidBackgroundPlaybackFormat({
      hidden: isAppHidden(), continuePlayback: true, activeFormat: 'dash',
      audioFormatAvailable: true, paused: false
    }), { activeFormat: 'audio', restoreFormat: 'dash' })

    // Releasing the refresh changes Chromium visibility too, but the activity
    // remains hidden. Returning to the app must still publish a resume event.
    document.hidden = true
    assert.equal(isAppHidden(), true)
    document.hidden = false
    setAndroidAppVisible(true)
    assert.equal(isAppHidden(), false)
    assert.deepEqual(changes, [true, false])

    setAndroidAppVisible(null)
    document.hidden = true
    assert.equal(isAppHidden(), true, 'other platforms use document visibility')
  } finally {
    setAndroidAppVisible(null)
    if (originalDocument === undefined) delete globalThis.document
    else globalThis.document = originalDocument
  }
})

for (const eventFirst of [false, true]) {
  test(`Android initial visibility preserves ${eventFirst ? 'a newer app-state event' : 'the initial snapshot without an event'}`, async () => {
    const source = await readFile(new URL('../../src/renderer/App.vue', import.meta.url), 'utf8')
    const start = source.indexOf('async function enableCapacitorIntegrations() {')
    const integration = source.slice(start, source.indexOf('\nconst windowTitle', start))
    const initialState = Promise.withResolvers()
    const requestedState = Promise.withResolvers()
    const changes = []
    const listeners = new Map()
    const removedListeners = []
    let listener
    let pauses = 0
    let backPresses = 0
    const enable = vm.runInNewContext(`${integration}\nenableCapacitorIntegrations`, {
      Capacitor: { getPlatform: () => 'android' },
      handleAndroidBack: () => { backPresses++ },
      CapacitorApp: {
        addListener: async (name, callback) => {
          listeners.set(name, callback)
          if (name === 'appStateChange') listener = callback
          return { remove() { removedListeners.push(name) } }
        },
        getState: () => { requestedState.resolve(); return initialState.promise },
        getLaunchUrl: async () => null,
      },
      initializeCapacitorLiveReminderActions: async () => () => {},
      addAndroidMediaSessionActionListener: async () => () => {},
      AppShortcuts: { addListener: async () => ({ remove() {} }) },
      watch: () => () => {},
      locale: {},
      setAndroidAppVisible: visible => changes.push(visible),
      shouldPauseAndroidPlaybackOnAppStateChange: active => !active,
      store: { getters: { getContinuePlaybackWhenScreenIsLocked: false } },
      tabMediaCoordinator: { pauseAll: () => { pauses++ } },
    })
    const enabling = enable()
    await requestedState.promise
    if (eventFirst) listener({ isActive: false })
    initialState.resolve({ isActive: true })
    const cleanup = await enabling
    assert.deepEqual(changes, eventFirst ? [false] : [true])
    assert.equal(pauses, eventFirst ? 1 : 0)
    listeners.get('backButton')({ canGoBack: false })
    assert.equal(backPresses, 1, 'native back events reach the existing app navigation handler')
    cleanup()
    assert.equal(changes.at(-1), null)
    assert.ok(removedListeners.includes('backButton'), 'unmount removes the native back listener')
  })
}

test('Capacitor integrations do not register the Android back button on iOS', async () => {
  const source = await readFile(new URL('../../src/renderer/App.vue', import.meta.url), 'utf8')
  const start = source.indexOf('async function enableCapacitorIntegrations() {')
  const integration = source.slice(start, source.indexOf('\nconst windowTitle', start))
  const listeners = []
  const enable = vm.runInNewContext(`${integration}\nenableCapacitorIntegrations`, {
    Capacitor: { getPlatform: () => 'ios' },
    CapacitorApp: {
      addListener: async name => {
        listeners.push(name)
        return { remove() {} }
      },
      getState: async () => ({ isActive: true }),
      getLaunchUrl: async () => null,
    },
    initializeCapacitorLiveReminderActions: async () => () => {},
    addAndroidMediaSessionActionListener: async () => () => {},
    setAndroidAppVisible() {},
  })

  const cleanup = await enable()
  assert.ok(!listeners.includes('backButton'))
  cleanup()
})
