import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = (await readFile(new URL('../../src/renderer/helpers/capacitorUi.js', import.meta.url), 'utf8'))
  .replace(/^import .*\n/gm, '')
  .replace(/^export /gm, '')

function loadUi(platform, ScreenOrientation, SettingsLauncher) {
  return vm.runInNewContext(`${source}\n({ setFullscreenOrientation, openNotificationSettings })`, {
    Capacitor: { isNativePlatform: () => platform !== 'web' },
    OrientationType: { LANDSCAPE: 'landscape' },
    ScreenOrientation,
    SettingsLauncher,
  })
}

for (const platform of ['android', 'ios']) {
  test(`${platform} locks landscape playback and releases orientation for other player states`, async () => {
    const calls = []
    const ui = loadUi(platform, {
      lock: async ({ type }) => calls.push(type),
      unlock: async () => calls.push('unlock'),
    })
    const landscape = { videoWidth: 1920, videoHeight: 1080 }
    await ui.setFullscreenOrientation(true, landscape)
    await ui.setFullscreenOrientation(false, landscape)
    await ui.setFullscreenOrientation(true, landscape, false)
    await ui.setFullscreenOrientation(true, { videoWidth: 1080, videoHeight: 1920 })
    await ui.setFullscreenOrientation(true, { videoWidth: 1080, videoHeight: 1080 })
    await ui.setFullscreenOrientation(true, null)
    assert.deepEqual(calls, ['landscape', 'unlock', 'unlock', 'unlock', 'unlock', 'unlock'])
  })

  test(`${platform} opens notification settings without opening general settings`, async () => {
    const calls = []
    const ui = loadUi(platform, {}, {
      openNotificationSettings: async () => calls.push('notifications'),
      openAppSettings: async () => calls.push('app'),
    })
    await ui.openNotificationSettings()
    assert.deepEqual(calls, ['notifications'])
  })

  test(`${platform} falls back to app settings when notification settings are unavailable`, async () => {
    const calls = []
    const ui = loadUi(platform, {}, {
      openNotificationSettings: async () => {
        calls.push('notifications')
        throw new Error('Notification settings unavailable')
      },
      openAppSettings: async () => calls.push('app'),
    })
    await ui.openNotificationSettings()
    assert.deepEqual(calls, ['notifications', 'app'])
  })
}

test('web and Electron do not invoke native orientation or settings plugins', async () => {
  const ui = loadUi('web')
  await ui.setFullscreenOrientation(true, { videoWidth: 1920, videoHeight: 1080 })
  await ui.setFullscreenOrientation(false, null)
  await ui.openNotificationSettings()
})

test('native orientation and settings failures reach the caller', async () => {
  const error = new Error('Native operation failed')
  const fail = async () => { throw error }
  const ui = loadUi('android', { lock: fail, unlock: fail }, {
    openNotificationSettings: fail,
    openAppSettings: fail,
  })
  await assert.rejects(ui.setFullscreenOrientation(true, { videoWidth: 1920, videoHeight: 1080 }), error)
  await assert.rejects(ui.setFullscreenOrientation(false, null), error)
  await assert.rejects(ui.openNotificationSettings(), error)
})
