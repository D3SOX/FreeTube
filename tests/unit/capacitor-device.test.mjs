import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = (await readFile(new URL('../../src/renderer/helpers/capacitorDevice.js', import.meta.url), 'utf8'))
  .replace(/^import .*\n/gm, '')
  .replace(/^export /gm, '')

function loadDeviceInfo(platform, info, getArchitecture) {
  return vm.runInNewContext(`${source}\ngetCapacitorDeviceInfo`, {
    Capacitor: { getPlatform: () => platform },
    Device: { getInfo: async () => info },
    getAndroidDeviceArchitecture: getArchitecture,
  })
}

test('combines Capacitor device details with our Android architecture', async () => {
  let architectureRequests = 0
  const getInfo = loadDeviceInfo('android', {
    name: '  My Pixel  ', model: 'Pixel 9', platform: 'android', osVersion: '16',
  }, async () => {
    architectureRequests++
    return { architecture: 'arm64-v8a' }
  })

  assert.deepEqual({ ...await getInfo() }, {
    name: 'My Pixel', platform: 'android', architecture: 'arm64-v8a', release: '16',
  })
  assert.equal(architectureRequests, 1)
})

test('uses Capacitor on iOS without calling the Android bridge', async () => {
  const getInfo = loadDeviceInfo('ios', {
    name: 'iPhone', model: 'iPhone13,4', platform: 'ios', osVersion: '18.6',
  }, () => assert.fail('iOS must not call AndroidUi'))

  assert.deepEqual({ ...await getInfo() }, {
    name: 'iPhone', platform: 'ios', architecture: '', release: '18.6',
  })
})

for (const name of [undefined, '', '   ']) {
  test(`falls back to the device model for name ${JSON.stringify(name)}`, async () => {
    const getInfo = loadDeviceInfo('android', {
      name, model: 'Pixel 9', platform: 'android', osVersion: '16',
    }, async () => ({ architecture: '' }))

    assert.equal((await getInfo()).name, 'Pixel 9')
  })
}
