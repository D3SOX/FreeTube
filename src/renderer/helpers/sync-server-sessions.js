import { Capacitor } from '@capacitor/core'

import {
  SYNC_SERVER_DEVICE_ID_BYTES,
  base64UrlToBytes,
  bytesToBase64,
  canonicalBase64ToBytes as base64ToBytes,
  isValidSyncServerDeviceName,
  randomBase64Url,
} from './sync-server-protocol.js'

const SESSION_INFO_VERSION = 1
const MAX_SYSTEM_FIELD_CHARS = 80
const MAX_SYSTEM_FIELD_BYTES = 240
const PADDED_DEVICE_INFO_BYTES = 512

function validateText(value, maxCharacters, maxBytes) {
  if (typeof value !== 'string' || value.trim() !== value ||
      [...value].length > maxCharacters || new TextEncoder().encode(value).length > maxBytes ||
      [...value].some(character => /\p{Cc}/u.test(character))) {
    throw new Error()
  }
  return value
}

export { isValidSyncServerDeviceName }

function validateSystemField(value) {
  return validateText(value, MAX_SYSTEM_FIELD_CHARS, MAX_SYSTEM_FIELD_BYTES)
}

function validateDeviceInfo(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== 5 || value.version !== SESSION_INFO_VERSION ||
      !isValidSyncServerDeviceName(value.name)) {
    throw new Error()
  }
  return {
    version: SESSION_INFO_VERSION,
    name: value.name,
    platform: validateSystemField(value.platform),
    architecture: validateSystemField(value.architecture),
    release: validateSystemField(value.release),
  }
}

function additionalData(deviceId) {
  if (!isValidSyncServerDeviceId(deviceId)) throw new Error('Invalid sync device ID')
  return new TextEncoder().encode(`OpenTubeX account session info v1\0${deviceId}`)
}

async function importPrivacyKey(value, usages) {
  return crypto.subtle.importKey(
    'raw',
    base64ToBytes(value),
    { name: 'AES-GCM' },
    false,
    usages
  )
}

export function randomSyncServerDeviceId() {
  return randomBase64Url(SYNC_SERVER_DEVICE_ID_BYTES)
}

export function isValidSyncServerDeviceId(value) {
  try {
    return base64UrlToBytes(value, SYNC_SERVER_DEVICE_ID_BYTES).length === SYNC_SERVER_DEVICE_ID_BYTES
  } catch {
    return false
  }
}

export function resolveSyncServerDeviceName(savedName, systemName, fallbackName) {
  const name = typeof savedName === 'string' ? savedName.trim() : ''
  if ((!isValidSyncServerDeviceName(name) || name === fallbackName) &&
      isValidSyncServerDeviceName(systemName)) {
    return systemName
  }
  return isValidSyncServerDeviceName(name) ? name : fallbackName
}

async function loadCapacitorDeviceInfo() {
  const { getCapacitorDeviceInfo } = await import('./capacitorDevice.js')
  return getCapacitorDeviceInfo()
}

async function loadElectronDeviceInfo() {
  const [deviceInfo, name] = await Promise.all([
    globalThis.window?.ftElectron?.getDeviceInfo?.(),
    globalThis.window?.ftElectron?.getDeviceName?.(),
  ])
  return { ...deviceInfo, name }
}

export async function getCurrentSyncServerDeviceInfo({
  isCapacitor = Boolean(process.env.IS_CAPACITOR),
  getCapacitorDeviceInfo = loadCapacitorDeviceInfo,
  getElectronDeviceInfo = loadElectronDeviceInfo,
} = {}) {
  let deviceInfo
  try {
    deviceInfo = await (isCapacitor ? getCapacitorDeviceInfo() : getElectronDeviceInfo())
  } catch {}

  const electronPlatform = typeof process !== 'undefined' && process.env?.IS_ELECTRON
    ? process.platform
    : 'web'
  const name = typeof deviceInfo?.name === 'string' ? deviceInfo.name.trim() : ''
  const platform = deviceInfo?.platform || (isCapacitor ? Capacitor.getPlatform() : electronPlatform) || 'web'
  return {
    name: isValidSyncServerDeviceName(name) ? name : '',
    platform: validateSystemField(platform),
    architecture: validateSystemField(deviceInfo?.architecture || ''),
    release: validateSystemField(deviceInfo?.release || ''),
  }
}

export async function getCurrentSyncServerSystemInfo() {
  const { name, ...systemInfo } = await getCurrentSyncServerDeviceInfo()
  return systemInfo
}

export async function encryptSyncServerDeviceInfo(value, exportedKey, deviceId) {
  const info = validateDeviceInfo({ version: SESSION_INFO_VERSION, ...value })
  const encoded = new TextEncoder().encode(JSON.stringify(info))
  if (encoded.length > PADDED_DEVICE_INFO_BYTES) throw new Error('Invalid sync device info')

  const key = await importPrivacyKey(exportedKey, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new Uint8Array(PADDED_DEVICE_INFO_BYTES + 2)
  new DataView(plaintext.buffer).setUint16(0, encoded.length)
  plaintext.set(encoded, 2)
  try {
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: additionalData(deviceId) },
      key,
      plaintext
    )
    return JSON.stringify({
      version: SESSION_INFO_VERSION,
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    })
  } finally {
    plaintext.fill(0)
  }
}

export async function decryptSyncServerDeviceInfo(payload, exportedKey, deviceId) {
  try {
    const envelope = JSON.parse(payload)
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
        Object.keys(envelope).length !== 3 || envelope.version !== SESSION_INFO_VERSION) {
      throw new Error()
    }
    const iv = base64ToBytes(envelope.iv)
    const ciphertext = base64ToBytes(envelope.ciphertext)
    if (iv.length !== 12 || ciphertext.length !== PADDED_DEVICE_INFO_BYTES + 18) throw new Error()
    const key = await importPrivacyKey(exportedKey, ['decrypt'])
    const plaintext = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: additionalData(deviceId) },
      key,
      ciphertext
    ))
    try {
      const length = new DataView(plaintext.buffer).getUint16(0)
      if (length === 0 || length > PADDED_DEVICE_INFO_BYTES ||
          plaintext.slice(2 + length).some(byte => byte !== 0)) {
        throw new Error()
      }
      const decoded = new TextDecoder('utf-8', { fatal: true })
        .decode(plaintext.slice(2, 2 + length))
      return validateDeviceInfo(JSON.parse(decoded))
    } finally {
      plaintext.fill(0)
    }
  } catch {
    throw new Error('The encrypted sync device info is invalid')
  }
}

export async function loadSyncServerDeviceNames(client, exportedKey) {
  const response = await client.getAccountSessions()
  if (!response || !Array.isArray(response.sessions)) {
    throw new Error('The sync server account sessions are invalid')
  }

  const entries = await Promise.all(response.sessions.map(async session => {
    if (!isValidSyncServerDeviceId(session?.device_id) ||
        typeof session.encrypted_device_info !== 'string') {
      return null
    }

    try {
      const deviceInfo = await decryptSyncServerDeviceInfo(
        session.encrypted_device_info,
        exportedKey,
        session.device_id
      )
      return [session.device_id, deviceInfo.name]
    } catch {
      return null
    }
  }))

  return Object.fromEntries(entries.filter(Boolean))
}
