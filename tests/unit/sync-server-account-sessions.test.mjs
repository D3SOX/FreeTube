import assert from 'node:assert/strict'
import test from 'node:test'

import {
  decryptSyncServerDeviceInfo,
  encryptSyncServerDeviceInfo,
  getCurrentSyncServerDeviceInfo,
  isValidSyncServerDeviceId,
  isValidSyncServerDeviceName,
  loadSyncServerDeviceNames,
  randomSyncServerDeviceId,
  resolveSyncServerDeviceName,
} from '../../src/renderer/helpers/sync-server-sessions.js'

function bytesToBase64 (bytes) {
  return Buffer.from(bytes).toString('base64')
}

test('creates random canonical device identifiers', () => {
  const identifiers = new Set(Array.from({ length: 100 }, randomSyncServerDeviceId))
  assert.equal(identifiers.size, 100)
  for (const identifier of identifiers) assert.equal(isValidSyncServerDeviceId(identifier), true)
  assert.equal(isValidSyncServerDeviceId('not a device id'), false)
})

test('uses native Android identity for the current sync device', async () => {
  const deviceInfo = await getCurrentSyncServerDeviceInfo({
    isCapacitor: true,
    getCapacitorDeviceInfo: async () => ({
      name: 'Pixel 9',
      platform: 'android',
      architecture: 'arm64-v8a',
      release: '16',
    }),
  })

  assert.deepEqual(deviceInfo, {
    name: 'Pixel 9',
    platform: 'android',
    architecture: 'arm64-v8a',
    release: '16',
  })
})

test('replaces the generic current-device name without overwriting a custom name', () => {
  assert.equal(resolveSyncServerDeviceName('This device', 'Pixel 9', 'This device'), 'Pixel 9')
  assert.equal(resolveSyncServerDeviceName('My phone', 'Pixel 9', 'This device'), 'My phone')
})

test('encrypts device identification for one device and privacy key', async () => {
  const key = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))
  const otherKey = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))
  const deviceId = randomSyncServerDeviceId()
  const otherDeviceId = randomSyncServerDeviceId()
  const deviceInfo = {
    name: 'Büro-Laptop',
    platform: 'linux',
    architecture: 'x64',
    release: '6.16.4-arch1-1',
  }
  const payload = await encryptSyncServerDeviceInfo(deviceInfo, key, deviceId)

  assert.deepEqual(await decryptSyncServerDeviceInfo(payload, key, deviceId), {
    version: 1,
    ...deviceInfo,
  })
  await assert.rejects(
    () => decryptSyncServerDeviceInfo(payload, otherKey, deviceId),
    /device info is invalid/
  )
  await assert.rejects(
    () => decryptSyncServerDeviceInfo(payload, key, otherDeviceId),
    /device info is invalid/
  )
})

test('loads valid device names from encrypted account-session metadata', async () => {
  const key = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))
  const laptopId = randomSyncServerDeviceId()
  const phoneId = randomSyncServerDeviceId()
  const encryptedLaptop = await encryptSyncServerDeviceInfo({
    name: 'Travel laptop',
    platform: 'linux',
    architecture: 'x64',
    release: '6.16.4-arch1-1',
  }, key, laptopId)

  const names = await loadSyncServerDeviceNames({
    getAccountSessions: async () => ({
      sessions: [
        { device_id: laptopId, encrypted_device_info: encryptedLaptop },
        { device_id: phoneId, encrypted_device_info: 'invalid ciphertext' },
        { device_id: 'invalid-device-id', encrypted_device_info: encryptedLaptop },
      ],
    }),
  }, key)

  assert.deepEqual(names, { [laptopId]: 'Travel laptop' })
})

test('validates device names and rejects invalid encrypted device info', async () => {
  const key = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))
  const deviceId = randomSyncServerDeviceId()
  assert.equal(isValidSyncServerDeviceName('Büro-Laptop'), true)
  assert.equal(isValidSyncServerDeviceName(' padded '), false)
  await assert.rejects(() => encryptSyncServerDeviceInfo({
    name: '',
    platform: 'linux',
    architecture: 'x64',
    release: '',
  }, key, deviceId))
})
