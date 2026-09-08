import { base64ToBytes, bytesToBase64 } from './sync-server-protocol.js'

export const PRIVACY_VERSION = 1
const PBKDF2_ITERATIONS = 600_000
const PADDING_BLOCK_BYTES = 64 * 1024
const COMPRESSED_LENGTH_BYTES = 4
const ADDITIONAL_DATA = new TextEncoder().encode('OpenTubeX encrypted sync v1')
const GZIP_COMPRESSION = 'gzip'
const LEGACY_DOCUMENT_COLLECTIONS = [
  'subscriptions',
  'playlists',
  'history',
  'playbackSpeeds',
  'subscriptionGroups',
  'playlistBookmarks',
]

async function transformBytes(bytes, TransformStream) {
  const stream = new globalThis.Blob([bytes])
    .stream()
    .pipeThrough(new TransformStream(GZIP_COMPRESSION))
  return new Uint8Array(await new globalThis.Response(stream).arrayBuffer())
}

function compressBytes(bytes) {
  return transformBytes(bytes, globalThis.CompressionStream)
}

function decompressBytes(bytes) {
  if (typeof globalThis.DecompressionStream !== 'function') {
    throw new Error('Compressed encrypted sync data is not supported by this app version')
  }
  return transformBytes(bytes, globalThis.DecompressionStream)
}

async function importPrivacyKey(value) {
  return crypto.subtle.importKey(
    'raw',
    base64ToBytes(value),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  )
}

async function derivePrivacyKey(passphrase, salt) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: PBKDF2_ITERATIONS,
      salt,
    },
    material,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  )
}

function parseEnvelope(payload) {
  try {
    const envelope = JSON.parse(payload)
    const compressed = envelope.compression != null
    if (envelope.version !== PRIVACY_VERSION ||
        envelope.kdf?.name !== 'PBKDF2' ||
        envelope.kdf?.hash !== 'SHA-256' ||
        envelope.kdf?.iterations !== PBKDF2_ITERATIONS ||
        envelope.cipher?.name !== 'AES-GCM' ||
        (compressed && (
          envelope.compression.name !== GZIP_COMPRESSION
        ))) {
      throw new Error()
    }
    return envelope
  } catch {
    throw new Error('Unsupported or invalid encrypted sync data')
  }
}

async function decryptWithKey(payload, key, { allowLegacyDocument = false } = {}) {
  const envelope = parseEnvelope(payload)
  try {
    const plaintext = new Uint8Array(await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: base64ToBytes(envelope.cipher.iv),
        additionalData: ADDITIONAL_DATA,
      },
      key,
      base64ToBytes(envelope.ciphertext)
    ))
    let documentBytes = plaintext
    if (envelope.compression) {
      const compressedLength = new DataView(
        plaintext.buffer,
        plaintext.byteOffset,
        COMPRESSED_LENGTH_BYTES
      ).getUint32(0)
      if (compressedLength <= 0 || compressedLength > plaintext.length - COMPRESSED_LENGTH_BYTES) {
        throw new Error()
      }
      documentBytes = await decompressBytes(
        plaintext.slice(COMPRESSED_LENGTH_BYTES, COMPRESSED_LENGTH_BYTES + compressedLength)
      )
    }
    const document = JSON.parse(new TextDecoder().decode(documentBytes))
    if (document.version !== PRIVACY_VERSION) throw new Error()
    if ('data' in document) return document.data
    if (allowLegacyDocument && LEGACY_DOCUMENT_COLLECTIONS.some(collection => (
      Array.isArray(document[collection])
    ))) {
      return document
    }
    throw new Error()
  } catch {
    throw new Error('Incorrect privacy passphrase or corrupted sync data')
  }
}

export async function preparePrivacyKey(payload, passphrase) {
  const salt = payload
    ? base64ToBytes(parseEnvelope(payload).kdf.salt)
    : crypto.getRandomValues(new Uint8Array(16))
  const key = await derivePrivacyKey(passphrase, salt)
  if (payload) await decryptWithKey(payload, key, { allowLegacyDocument: true })
  const rawKey = await crypto.subtle.exportKey('raw', key)
  return {
    key: bytesToBase64(new Uint8Array(rawKey)),
    salt: bytesToBase64(salt),
  }
}

export async function decryptSyncDocument(payload, exportedKey) {
  if (!payload) return null
  return decryptWithKey(payload, await importPrivacyKey(exportedKey))
}

export async function decryptLegacySyncDocument(payload, exportedKey) {
  if (!payload) return null
  return decryptWithKey(
    payload,
    await importPrivacyKey(exportedKey),
    { allowLegacyDocument: true }
  )
}

export async function encryptSyncDocument(data, exportedKey, salt) {
  const key = await importPrivacyKey(exportedKey)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(JSON.stringify({ version: PRIVACY_VERSION, data }))
  const compressed = typeof globalThis.CompressionStream === 'function'
    ? await compressBytes(encoded)
    : null
  const payload = compressed ?? encoded
  const payloadOffset = compressed ? COMPRESSED_LENGTH_BYTES : 0
  const paddedLength = Math.ceil(
    (payloadOffset + payload.length) / PADDING_BLOCK_BYTES
  ) * PADDING_BLOCK_BYTES
  const plaintext = new Uint8Array(Math.max(PADDING_BLOCK_BYTES, paddedLength))
  plaintext.fill(0x20)
  if (compressed) {
    new DataView(plaintext.buffer).setUint32(0, compressed.length)
  }
  plaintext.set(payload, payloadOffset)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: ADDITIONAL_DATA },
    key,
    plaintext
  )
  return JSON.stringify({
    version: PRIVACY_VERSION,
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: PBKDF2_ITERATIONS,
      salt,
    },
    cipher: { name: 'AES-GCM', iv: bytesToBase64(iv) },
    ...(compressed && {
      compression: { name: GZIP_COMPRESSION },
    }),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  })
}

export function getPrivacySalt(payload) {
  return parseEnvelope(payload).kdf.salt
}

export function createEmptySyncDocument() {
  return {
    version: PRIVACY_VERSION,
    subscriptions: [],
    playlists: [],
    history: [],
    seenVideos: [],
    playbackSpeeds: [],
    subscriptionGroups: [],
    playlistBookmarks: [],
    profiles: [],
    settings: [],
    sessions: [],
    sessionsV2: null,
  }
}

export function migrateLegacyPlaybackSpeedsToSettings(document, localValue, updatedAt = Date.now()) {
  if (document.settings.some(entry => entry.key === 'channelPlaybackSpeeds')) return false

  const legacy = Object.fromEntries(document.playbackSpeeds
    .filter(entry => entry.channel_id && Number.isFinite(entry.playback_speed) &&
      entry.playback_speed > 0.07)
    .map(entry => [entry.channel_id, entry.playback_speed]))
  if (Object.keys(legacy).length === 0) return false

  let local = {}
  try {
    const parsed = JSON.parse(localValue)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) local = parsed
  } catch {}

  document.settings.push({
    key: 'channelPlaybackSpeeds',
    value: JSON.stringify({ ...legacy, ...local }),
    updatedAt,
  })
  return true
}

export async function loadLegacySyncDocument(client) {
  const [subscriptions, playlistHeaders, history, playbackSpeeds, subscriptionGroups, playlistBookmarks] =
    await Promise.all([
      client.getSubscriptions(),
      client.getPlaylists(),
      client.getWatchHistory(),
      client.getChannelPlaybackSpeeds(),
      client.getSubscriptionGroups(),
      client.getPlaylistBookmarks(),
    ])
  const playlists = await Promise.all(
    playlistHeaders.map(playlist => client.getPlaylist(playlist.id))
  )

  return {
    version: PRIVACY_VERSION,
    subscriptions,
    playlists,
    history: history ?? [],
    playbackSpeeds: playbackSpeeds ?? [],
    profiles: subscriptionGroups,
    playlistBookmarks,
    settings: [],
  }
}

export class EncryptedSyncAdapter {
  constructor(document) {
    this.document = document
    this.document.subscriptions ??= []
    this.document.playlists ??= []
    this.document.history ??= []
    this.document.seenVideos ??= []
    this.document.playbackSpeeds ??= []
    this.document.profiles ??= []
    this.document.settings ??= []
    this.document.sessions ??= []
    this.document.sessionsV2 ??= null
    this.document.playlistBookmarks ??= []
  }

  async getSubscriptions() { return structuredClone(this.document.subscriptions) }
  async supportsBulkSync() { return true }
  async subscribe(channel) { this.document.subscriptions.push(structuredClone(channel)) }
  async subscribeBulk(channels) { this.document.subscriptions.push(...structuredClone(channels)) }
  async unsubscribe(id) {
    this.document.subscriptions = this.document.subscriptions.filter(channel => channel.id !== id)
  }

  async getPlaylists() {
    return structuredClone(this.document.playlists.map(entry => entry.playlist))
  }

  async getPlaylist(id) {
    return structuredClone(this.document.playlists.find(entry => entry.playlist.id === id))
  }

  async getPlaylistBookmarks() {
    return structuredClone(this.document.playlistBookmarks)
  }

  async createPlaylistBookmark(bookmark) {
    this.document.playlistBookmarks.push(structuredClone(bookmark))
  }

  async deletePlaylistBookmark(id) {
    this.document.playlistBookmarks = this.document.playlistBookmarks
      .filter(entry => entry.playlist.id !== id)
  }

  async createPlaylist(playlist) {
    this.document.playlists.push({ playlist: structuredClone(playlist), videos: [] })
    return structuredClone(playlist)
  }

  async updatePlaylist(id, playlist) {
    const entry = this.document.playlists.find(entry => entry.playlist.id === id)
    entry.playlist = { ...entry.playlist, ...structuredClone(playlist), id }
  }

  async deletePlaylist(id) {
    this.document.playlists = this.document.playlists.filter(entry => entry.playlist.id !== id)
  }

  async addPlaylistVideos(id, videos) {
    this.document.playlists.find(entry => entry.playlist.id === id).videos.push(...structuredClone(videos))
  }

  async removePlaylistVideo(playlistId, videoId) {
    const entry = this.document.playlists.find(entry => entry.playlist.id === playlistId)
    entry.videos = entry.videos.filter(video => video.id !== videoId)
  }

  async getWatchHistory() { return structuredClone(this.document.history) }

  async getSeenVideos() { return structuredClone(this.document.seenVideos) }

  async putSeenVideos(entries) { this.document.seenVideos = structuredClone(entries) }

  async getSessions() {
    return structuredClone(this.document.sessionsV2 ?? this.document.sessions)
  }

  async putSessions(sessions) {
    this.document.sessionsV2 = structuredClone(sessions)
  }

  async putWatchHistory(entry) {
    this.document.history = this.document.history.filter(item => item.video.id !== entry.video.id)
    this.document.history.push(structuredClone(entry))
  }

  async putWatchHistoryBulk(entries) {
    for (const entry of entries) await this.putWatchHistory(entry)
  }

  async deleteWatchHistory(id) {
    this.document.history = this.document.history.filter(entry => entry.video.id !== id)
  }

  async getChannelPlaybackSpeeds() { return structuredClone(this.document.playbackSpeeds) }

  async putChannelPlaybackSpeed(speed) {
    await this.deleteChannelPlaybackSpeed(speed.channel_id)
    this.document.playbackSpeeds.push(structuredClone(speed))
  }

  async deleteChannelPlaybackSpeed(id) {
    this.document.playbackSpeeds = this.document.playbackSpeeds
      .filter(entry => entry.channel_id !== id)
  }

  async getSubscriptionGroups() { return structuredClone(this.document.profiles) }

  async createSubscriptionGroup(group) {
    const created = { ...structuredClone(group), id: group.id }
    this.document.profiles.push({ group: created, channels: [] })
    return structuredClone(created)
  }

  async updateSubscriptionGroup(id, group) {
    const entry = this.document.profiles.find(entry => entry.group.id === id)
    entry.group = { ...entry.group, ...structuredClone(group), id }
  }

  async deleteSubscriptionGroup(id) {
    this.document.profiles = this.document.profiles.filter(entry => entry.group.id !== id)
  }

  async addSubscriptionGroupChannel(groupId, channelId) {
    const entry = this.document.profiles.find(entry => entry.group.id === groupId)
    const channel = this.document.subscriptions.find(channel => channel.id === channelId) ?? {
      id: channelId,
    }
    if (!entry.channels.some(item => item.id === channelId)) {
      entry.channels.push(structuredClone(channel))
    }
  }

  async removeSubscriptionGroupChannel(groupId, channelId) {
    const entry = this.document.profiles.find(entry => entry.group.id === groupId)
    entry.channels = entry.channels.filter(channel => channel.id !== channelId)
  }

  async getSettings() { return structuredClone(this.document.settings) }
  async putSettings(settings) { this.document.settings = structuredClone(settings) }
}
