import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createEmptySyncDocument,
  decryptLegacySyncDocument,
  decryptSyncDocument,
  EncryptedSyncAdapter,
  migrateLegacyPlaybackSpeedsToSettings,
  preparePrivacyKey,
} from '../../src/renderer/helpers/sync-server-privacy.js'

import { encryptLegacyDocument } from '../helpers/encrypt-legacy-sync-document.mjs'

test('decrypts the original single-document encrypted sync format', async () => {
  const passphrase = 'legacy-privacy-passphrase'
  const privacy = await preparePrivacyKey(null, passphrase)
  const document = {
    version: 1,
    subscriptions: [{ id: 'UC-test' }],
    playlists: [],
    history: [],
    playbackSpeeds: [],
    subscriptionGroups: [],
    playlistBookmarks: [],
  }
  const payload = await encryptLegacyDocument(document, privacy)

  assert.deepEqual(
    await decryptLegacySyncDocument(payload, privacy.key),
    document
  )
  await assert.doesNotReject(() => preparePrivacyKey(payload, passphrase))
  await assert.rejects(
    () => decryptSyncDocument(payload, privacy.key),
    /corrupted sync data/
  )
})

test('moves legacy playback speeds into settings while preserving local values', () => {
  const document = {
    settings: [],
    playbackSpeeds: [
      { channel_id: 'remote', playback_speed: 1.25 },
      { channel_id: 'shared', playback_speed: 1.5 },
    ],
  }

  assert.equal(migrateLegacyPlaybackSpeedsToSettings(
    document,
    JSON.stringify({ local: 0.75, shared: 2 }),
    123
  ), true)
  assert.deepEqual(document.settings, [{
    key: 'channelPlaybackSpeeds',
    value: JSON.stringify({ remote: 1.25, shared: 2, local: 0.75 }),
    updatedAt: 123,
  }])
})

test('keeps the current settings collection instead of legacy playback speeds', () => {
  const current = {
    key: 'channelPlaybackSpeeds',
    value: JSON.stringify({ current: 1.75 }),
    updatedAt: 456,
  }
  const document = {
    settings: [current],
    playbackSpeeds: [{ channel_id: 'legacy', playback_speed: 1.25 }],
  }

  assert.equal(migrateLegacyPlaybackSpeedsToSettings(document, '{}', 789), false)
  assert.deepEqual(document.settings, [current])
})

test('stores playlist bookmarks in the encrypted sync document', async () => {
  const adapter = new EncryptedSyncAdapter(createEmptySyncDocument())
  const bookmark = {
    playlist: { id: 'saved-playlist', title: 'Saved playlist' },
    uploader: { id: 'saved-channel', name: 'Saved channel' },
  }

  await adapter.createPlaylistBookmark(bookmark)
  assert.deepEqual(await adapter.getPlaylistBookmarks(), [bookmark])

  await adapter.deletePlaylistBookmark('saved-playlist')
  assert.deepEqual(await adapter.getPlaylistBookmarks(), [])
})

test('keeps versioned sessions isolated from older clients', async () => {
  const legacySessions = [{ sessionId: 'legacy-desktop', tabs: [] }]
  const versionedSessions = {
    version: 1,
    mode: 'separate',
    devices: {},
    shared: [],
  }
  const document = createEmptySyncDocument()
  document.sessions = legacySessions
  const adapter = new EncryptedSyncAdapter(document)

  assert.deepEqual(await adapter.getSessions(), legacySessions)
  await adapter.putSessions(versionedSessions)
  assert.deepEqual(document.sessions, legacySessions)
  assert.deepEqual(await adapter.getSessions(), versionedSessions)

  document.sessions = [{ sessionId: 'changed-by-older-client', tabs: [] }]
  assert.deepEqual(await adapter.getSessions(), versionedSessions)
})
