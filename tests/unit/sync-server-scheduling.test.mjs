import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AUTO_SYNC_INTERVAL_MS,
  SYNC_ACTION_REASONS,
  SYNC_MUTATION_REASONS,
  isRecentSync,
  isSyncReasonEnabled,
} from '../../src/renderer/helpers/sync-server-scheduling.js'

function settings (overrides = {}) {
  return {
    syncServerPrivacyMode: 'enhanced',
    syncServerSyncSubscriptions: false,
    syncServerSyncPlaylists: false,
    syncServerSyncHistory: false,
    syncServerSyncProfiles: false,
    syncServerSyncSessions: false,
    syncServerSyncSettings: false,
    ...overrides,
  }
}

test('maps local actions to their affected sync collection', () => {
  assert.equal(SYNC_ACTION_REASONS.get('updateWatchProgress'), 'history')
  assert.equal(SYNC_ACTION_REASONS.get('mergeSubscriptionSeenVideos'), 'history')
  assert.equal(SYNC_MUTATION_REASONS.get('setSubscriptionSeenVideos'), 'history')
  assert.equal(SYNC_ACTION_REASONS.get('addVideo'), 'playlists')
  assert.equal(SYNC_ACTION_REASONS.has('updateChannelPlaybackSpeeds'), false)
  assert.equal(SYNC_ACTION_REASONS.get('updateCustomThemes'), 'settings')
  assert.equal(SYNC_ACTION_REASONS.get('createProfile'), 'profiles')
  assert.equal(SYNC_ACTION_REASONS.get('addChannelToProfiles'), 'profilesOrSubscriptions')
  assert.equal(SYNC_MUTATION_REASONS.get('setTabsState'), 'sessions')
  assert.equal(SYNC_MUTATION_REASONS.get('setTabNavigation'), 'sessions')
})

test('only schedules changes for enabled collections', () => {
  assert.equal(isSyncReasonEnabled(settings(), 'history'), false)
  assert.equal(isSyncReasonEnabled(settings({ syncServerSyncHistory: true }), 'history'), true)
  assert.equal(isSyncReasonEnabled(settings({ syncServerSyncProfiles: true }), 'profilesOrSubscriptions'), true)
  assert.equal(isSyncReasonEnabled(settings({ syncServerSyncSubscriptions: true }), 'profilesOrSubscriptions'), true)
  assert.equal(isSyncReasonEnabled(settings(), 'automatic'), false)
  assert.equal(isSyncReasonEnabled(settings({ syncServerSyncPlaylists: true }), 'automatic'), true)
})

test('requires enhanced privacy and the collection toggle for private collections', () => {
  assert.equal(isSyncReasonEnabled(settings({ syncServerSyncSettings: true }), 'settings'), true)
  assert.equal(isSyncReasonEnabled(settings({ syncServerSyncSessions: true }), 'sessions'), true)
  assert.equal(isSyncReasonEnabled(settings({
    syncServerPrivacyMode: 'legacy',
    syncServerSyncSettings: true,
    syncServerSyncSessions: true,
  }), 'automatic'), false)
})

test('treats syncs as recent only inside the automatic sync interval', () => {
  const now = 1000000
  assert.equal(isRecentSync(0, now), false)
  assert.equal(isRecentSync(now + 1, now), false)
  assert.equal(isRecentSync(now - AUTO_SYNC_INTERVAL_MS + 1, now), true)
  assert.equal(isRecentSync(now - AUTO_SYNC_INTERVAL_MS, now), false)
})
