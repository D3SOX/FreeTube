import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import { createAppShortcuts, getAppShortcutPath } from '../../src/renderer/helpers/appShortcuts.js'

const pages = ['subscriptions', 'userplaylists', 'history', 'downloads']

test('page shortcuts share stable IDs and translated titles across Android and iOS', () => {
  const labels = { subscriptions: 'Abonnements', userplaylists: 'Wiedergabelisten', history: 'Verlauf', downloads: 'Downloads' }
  const shortcuts = createAppShortcuts(labels)
  assert.deepEqual(shortcuts.map(shortcut => shortcut.id), pages)
  for (const shortcut of shortcuts) {
    assert.equal(shortcut.title, labels[shortcut.id])
    assert.ok(shortcut.androidIcon.startsWith('ic_shortcut_'))
    assert.ok(shortcut.iosIcon)
    assert.equal(getAppShortcutPath(shortcut.id), `/${shortcut.id}`)
  }
})

test('unknown shortcut IDs cannot navigate to arbitrary routes', () => {
  for (const id of ['settings', '../history', '/history', '__proto__', '', null, undefined]) {
    assert.equal(getAppShortcutPath(id), null)
  }
})

test('retained startup clicks and running-app clicks navigate and update localized shortcuts', async () => {
  const source = await readFile(new URL('../../src/renderer/App.vue', import.meta.url), 'utf8')
  const start = source.indexOf('async function enableCapacitorIntegrations() {')
  const integration = source.slice(start, source.indexOf('\nconst windowTitle', start))
  const listeners = new Map()
  const paths = []
  const youtubeLinks = []
  const updates = []
  let settingsOpen = true
  let updateLocale
  let stopped = false
  const locale = { value: 'en-US' }
  const enable = vm.runInNewContext(`${integration}\nenableCapacitorIntegrations`, {
    Capacitor: { getPlatform: () => 'android' },
    handleAndroidBack() {},
    CapacitorApp: {
      addListener: async (name, callback) => {
        listeners.set(name, callback)
        return { remove: () => listeners.delete(name) }
      },
      getState: async () => ({ isActive: true }),
      getLaunchUrl: async () => null,
    },
    AppShortcuts: {
      addListener: async (name, callback) => {
        assert.equal(name, 'click')
        listeners.set(name, callback)
        // Native plugins retain shortcut clicks until the renderer subscribes.
        await callback({ shortcutId: 'subscriptions' })
        return { remove: () => listeners.delete(name) }
      },
      set: async ({ shortcuts }) => { updates.push(shortcuts) },
    },
    initializeCapacitorLiveReminderActions: async () => () => {},
    addAndroidMediaSessionActionListener: async () => () => {},
    setAndroidAppVisible() {},
    store: {
      getters: {},
      dispatch: async action => {
        assert.equal(action, 'hideSettingsWindow')
        settingsOpen = false
      },
    },
    watch: (watchedLocale, callback, options) => {
      assert.equal(watchedLocale, locale)
      assert.equal(options.immediate, true)
      updateLocale = callback
      callback()
      return () => { stopped = true }
    },
    locale,
    t: key => `${locale.value}:${key}`,
    createAppShortcuts,
    getAppShortcutPath,
    openInternalPath: ({ path }) => {
      assert.equal(settingsOpen, false, 'settings must not cover the destination')
      paths.push(path)
    },
    handleYoutubeLink: url => { youtubeLinks.push(url) },
  })
  const cleanup = await enable()
  assert.deepEqual(paths, ['/subscriptions'])
  for (const page of pages.slice(1)) {
    settingsOpen = true
    await listeners.get('click')({ shortcutId: page })
  }
  await listeners.get('click')({ shortcutId: 'settings' })
  assert.deepEqual(paths, pages.map(page => `/${page}`))
  listeners.get('appUrlOpen')({ url: 'https://youtu.be/123' })
  assert.deepEqual(youtubeLinks, ['https://youtu.be/123'])
  assert.equal(updates[0][2].title, 'en-US:History.History')
  locale.value = 'de-DE'
  updateLocale()
  assert.equal(updates[1][2].title, 'de-DE:History.History')
  cleanup()
  assert.equal(stopped, true)
  assert.equal(listeners.size, 0)
})
