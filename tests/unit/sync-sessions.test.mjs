import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatDeviceSessionLabel,
  getOtherDeviceSessions,
  getPreviousSyncSessions,
  getSyncTabRoute,
  mergeSyncSessions,
  normalizeSyncSessionsDocument,
  removeSyncSession,
  shouldShowOtherDeviceSessions,
} from '../../src/renderer/helpers/sync-sessions.js'

const session = (id, updatedAt, url = `https://opentubex.local/${id}`) => ({
  sessionId: id,
  updatedAt,
  activeTabId: `${id}-tab`,
  tabs: [{ id: `${id}-tab`, url }],
})

test('extracts synced routes from desktop, mobile, and relative URLs', () => {
  const route = '/watch/video?timestamp=42&list=PL123#details'
  for (const prefix of [
    'app://bundle/index.html#',
    'app://bundle/#',
    'http://localhost:9080/#',
    'https://localhost',
    'capacitor://localhost',
    '',
  ]) {
    assert.equal(getSyncTabRoute(`${prefix}${route}`), route)
  }
  assert.equal(getSyncTabRoute('app://bundle/index.html#/subscriptions'), '/subscriptions')
  assert.equal(getSyncTabRoute('https://localhost/watch/video#/details'), '/watch/video#/details')
  assert.equal(getSyncTabRoute('/search/a%20b?searchQuery=a%2Fb'), '/search/a%20b?searchQuery=a%2Fb')
  for (const value of [null, undefined, '', {}, 'https://[invalid']) {
    assert.equal(getSyncTabRoute(value), '/')
  }
})

test('formats device session labels with localized tab plurals', () => {
  const t = (key, { count } = {}, choice) => {
    if (key === 'Settings.Sync Settings.Mobile Device') return 'Mobile'
    if (key === 'Settings.Sync Settings.Desktop Device') return 'Desktop'
    if (key === 'Tab Organizer.Tab Count') return `${count} ${choice === 1 ? 'tab' : 'tabs'}`
    throw new Error(`Unexpected translation key: ${key}`)
  }

  assert.equal(formatDeviceSessionLabel({ syncPlatform: 'desktop', tabs: [{}] }, t), 'Desktop · 1 tab')
  assert.equal(formatDeviceSessionLabel({ syncPlatform: 'mobile', tabs: [{}, {}] }, t), 'Mobile · 2 tabs')
  assert.equal(formatDeviceSessionLabel({
    syncDeviceName: 'Travel phone',
    syncPlatform: 'mobile',
    tabs: [{}, {}],
  }, t), 'Travel phone · 2 tabs')
})

test('moves this device tab sets from its old local ID to its account-session ID', () => {
  const local = session('local', 2)
  const remote = session('remote', 1)
  const result = mergeSyncSessions({
    localSessions: [local],
    remoteValue: {
      version: 1,
      mode: 'separate',
      devices: {
        'old-local-id': { platform: 'desktop', sessions: [local] },
        'remote-account-id': { platform: 'mobile', sessions: [remote] },
      },
      shared: [],
    },
    deviceId: 'current-account-id',
    legacyDeviceIds: ['old-local-id'],
    platform: 'desktop',
    preferredMode: 'separate',
  })

  assert.deepEqual(result.document.devices['current-account-id'].sessions, [local])
  assert.equal(result.document.devices['old-local-id'], undefined)
  assert.deepEqual(result.otherDeviceSessions, [{
    ...remote,
    syncDeviceId: 'remote-account-id',
    syncPlatform: 'mobile',
  }])
})

test('merges legacy tab sets into an existing account-session device', () => {
  const current = session('current', 3)
  const duplicate = session('duplicate', 2)
  const legacyOnly = session('legacy-only', 1)
  const result = mergeSyncSessions({
    localSessions: [current, duplicate],
    remoteValue: {
      version: 1,
      mode: 'separate',
      devices: {
        'current-account-id': {
          platform: 'desktop',
          sessions: [current, duplicate],
        },
        'old-local-id': {
          platform: 'desktop',
          sessions: [session('duplicate', 1), legacyOnly],
        },
      },
      shared: [],
    },
    deviceId: 'current-account-id',
    legacyDeviceIds: ['old-local-id'],
    platform: 'desktop',
    preferredMode: 'separate',
  })

  assert.deepEqual(result.document.devices['current-account-id'].sessions, [
    current,
    duplicate,
    legacyOnly,
  ])
  assert.equal(result.document.devices['old-local-id'], undefined)
})

test('treats legacy session arrays as a separate desktop device', () => {
  const document = normalizeSyncSessionsDocument([session('desktop', 1)])
  assert.equal(document.mode, 'separate')
  assert.deepEqual(document.devices['legacy-desktop'].sessions, [session('desktop', 1)])
})

test('keeps mobile and desktop sessions separate by default', () => {
  const result = mergeSyncSessions({
    localSessions: [session('mobile', 2)],
    remoteValue: [session('desktop', 1)],
    deviceId: 'phone',
    platform: 'mobile',
    preferredMode: 'separate',
  })

  assert.deepEqual(result.sessionsToApply, [session('mobile', 2)])
  assert.equal(result.otherDeviceSessions[0].sessionId, 'desktop')
  assert.equal(result.otherDeviceSessions[0].syncPlatform, 'desktop')
})

test('removes one synced tab set and drops an empty device', () => {
  const value = {
    version: 1,
    mode: 'separate',
    devices: {
      desktop: {
        platform: 'desktop',
        sessions: [session('keep', 1), session('remove', 2)],
      },
      phone: {
        platform: 'mobile',
        sessions: [session('phone', 3)],
      },
    },
    shared: [],
  }

  const withOneRemoved = removeSyncSession(value, 'desktop', 'remove')
  assert.deepEqual(withOneRemoved.devices.desktop.sessions, [session('keep', 1)])
  assert.deepEqual(withOneRemoved.deletedSessions.desktop, ['remove'])
  assert.deepEqual(value.devices.desktop.sessions, [session('keep', 1), session('remove', 2)])

  const withoutPhone = removeSyncSession(withOneRemoved, 'phone', 'phone')
  assert.equal(withoutPhone.devices.phone, undefined)
  assert.deepEqual(withoutPhone.deletedSessions.phone, ['phone'])
})

test('records a deletion after a concurrent sync already removed the device', () => {
  const value = {
    version: 1,
    mode: 'separate',
    devices: {},
    shared: [],
  }

  const removed = removeSyncSession(value, 'missing-phone', 'stale-session')
  assert.deepEqual(removed.deletedSessions['missing-phone'], ['stale-session'])
})

test('keeps a deleted tab set from returning while its owning device still has it open', () => {
  const retained = session('retained-on-phone', 1)
  const previous = {
    version: 1,
    mode: 'separate',
    devices: {
      phone: { platform: 'mobile', sessions: [retained] },
    },
    shared: [],
  }
  const deleted = removeSyncSession(previous, 'phone', retained.sessionId)

  const firstSync = mergeSyncSessions({
    localSessions: [retained],
    remoteValue: deleted,
    previousValue: previous,
    deviceId: 'phone',
    platform: 'mobile',
    preferredMode: 'separate',
  })
  assert.deepEqual(firstSync.sessionsToApply, [])
  assert.deepEqual(firstSync.document.devices.phone.sessions, [])
  assert.deepEqual(firstSync.document.deletedSessions.phone, [retained.sessionId])

  const secondSync = mergeSyncSessions({
    localSessions: [session(retained.sessionId, 2)],
    remoteValue: firstSync.document,
    previousValue: firstSync.document,
    deviceId: 'phone',
    platform: 'mobile',
    preferredMode: 'separate',
  })
  assert.deepEqual(secondSync.sessionsToApply, [])
  assert.deepEqual(secondSync.document.devices.phone.sessions, [])
  assert.deepEqual(secondSync.document.deletedSessions.phone, [retained.sessionId])

  const afterLocalClose = mergeSyncSessions({
    localSessions: [],
    remoteValue: secondSync.document,
    previousValue: secondSync.document,
    deviceId: 'phone',
    platform: 'mobile',
    preferredMode: 'separate',
  })
  assert.equal(afterLocalClose.document.deletedSessions.phone, undefined)
})

test('claims an upgraded desktop legacy session instead of showing it as another device', () => {
  const desktop = session('desktop', 3)
  const result = mergeSyncSessions({
    localSessions: [session('local', 2)],
    remoteValue: [desktop],
    deviceId: 'upgraded-desktop',
    platform: 'desktop',
    preferredMode: 'separate',
  })

  assert.deepEqual(result.sessionsToApply, [desktop])
  assert.deepEqual(result.document.devices['upgraded-desktop'].sessions, [desktop])
  assert.equal(result.document.devices['legacy-desktop'], undefined)
  assert.deepEqual(result.otherDeviceSessions, [])
})

test('claims legacy desktop tabs after a mobile-first versioned migration', () => {
  const legacy = session('desktop-before-upgrade', 3)
  const mobileMigration = mergeSyncSessions({
    localSessions: [],
    remoteValue: [legacy],
    deviceId: 'phone',
    platform: 'mobile',
    preferredMode: 'separate',
  })

  assert.deepEqual(mobileMigration.document.devices['legacy-desktop'].sessions, [legacy])

  const desktopMigration = mergeSyncSessions({
    localSessions: [session('temporary-desktop-tab', 4)],
    remoteValue: mobileMigration.document,
    deviceId: 'upgraded-desktop',
    platform: 'desktop',
    preferredMode: 'separate',
  })

  assert.deepEqual(desktopMigration.sessionsToApply, [legacy])
  assert.deepEqual(desktopMigration.document.devices['upgraded-desktop'].sessions, [legacy])
  assert.equal(desktopMigration.document.devices['legacy-desktop'], undefined)
  assert.deepEqual(desktopMigration.otherDeviceSessions, [])
})

test('does not claim legacy tabs over an existing desktop session or named device', () => {
  const legacy = session('legacy', 1)
  const current = session('current', 2)
  const named = session('named', 3)
  const remoteValue = {
    version: 1,
    mode: 'separate',
    devices: {
      'legacy-desktop': { platform: 'desktop', sessions: [legacy] },
      'current-desktop': { platform: 'desktop', sessions: [current] },
      'named-desktop': { platform: 'desktop', sessions: [named] },
    },
    shared: [],
  }

  const result = mergeSyncSessions({
    localSessions: [current],
    remoteValue,
    deviceId: 'current-desktop',
    platform: 'desktop',
    preferredMode: 'separate',
  })

  assert.deepEqual(result.document.devices['legacy-desktop'].sessions, [legacy])
  assert.deepEqual(result.document.devices['current-desktop'].sessions, [current])
  assert.deepEqual(result.document.devices['named-desktop'].sessions, [named])
})

test('an explicit shared mode mirrors the newest shared session set', () => {
  const previous = {
    version: 1,
    mode: 'shared',
    devices: { phone: { platform: 'mobile', sessions: [session('mobile', 2)] } },
    shared: [session('desktop', 3)],
  }
  const remote = structuredClone(previous)
  remote.shared = [session('desktop-new', 5)]

  const result = mergeSyncSessions({
    localSessions: [session('mobile', 2)],
    remoteValue: remote,
    previousValue: previous,
    deviceId: 'phone',
    platform: 'mobile',
    preferredMode: 'shared',
  })

  assert.deepEqual(result.sessionsToApply, [session('desktop-new', 5)])
})

test('switching to shared mode publishes the local tabs intentionally', () => {
  const previous = {
    version: 1,
    mode: 'separate',
    devices: { phone: { platform: 'mobile', sessions: [session('mobile-old', 1)] } },
    shared: [session('desktop', 5)],
  }

  const result = mergeSyncSessions({
    localSessions: [session('mobile-new', 6)],
    remoteValue: previous,
    previousValue: previous,
    deviceId: 'phone',
    platform: 'mobile',
    preferredMode: 'shared',
  })

  assert.equal(result.mode, 'shared')
  assert.deepEqual(result.sessionsToApply, [session('mobile-new', 6)])
})

test('shows other-device tabs only while separate session sync is connected', () => {
  const sessions = [session('desktop', 1)]

  assert.equal(shouldShowOtherDeviceSessions({
    syncEnabled: false,
    syncConnected: false,
    enhancedSyncEnabled: true,
    sharedTabsEnabled: false,
    sessions,
  }), false)
  assert.equal(shouldShowOtherDeviceSessions({
    syncEnabled: true,
    syncConnected: false,
    enhancedSyncEnabled: true,
    sharedTabsEnabled: false,
    sessions,
  }), false)
  assert.equal(shouldShowOtherDeviceSessions({
    syncEnabled: true,
    syncConnected: true,
    enhancedSyncEnabled: true,
    sharedTabsEnabled: false,
    sessions,
  }), true)
})

test('keeps saved other-device tabs available for manual sync', () => {
  assert.equal(shouldShowOtherDeviceSessions({
    syncEnabled: true,
    automaticSyncEnabled: false,
    syncConnected: true,
    enhancedSyncEnabled: true,
    sharedTabsEnabled: false,
    sessions: [session('desktop', 1)],
  }), true)
})

test('restores migrated desktop tabs from the saved sync snapshot', () => {
  const desktop = session('desktop', 1)
  const savedSnapshot = normalizeSyncSessionsDocument([desktop])

  assert.deepEqual(getOtherDeviceSessions(savedSnapshot, 'phone'), [{
    ...desktop,
    syncDeviceId: 'legacy-desktop',
    syncPlatform: 'desktop',
  }])
})

test('uses legacy sessions as the baseline when the versioned snapshot is null', () => {
  const previousSessions = [session('previous', 1)]
  const localSessions = [session('local', 3)]
  const remoteValue = {
    version: 1,
    mode: 'separate',
    devices: {
      desktop: { platform: 'desktop', sessions: [session('remote', 2)] },
    },
    shared: [],
  }
  const previousValue = getPreviousSyncSessions({
    sessions: previousSessions,
    sessionsV2: null,
  })

  const result = mergeSyncSessions({
    localSessions,
    remoteValue,
    previousValue,
    deviceId: 'desktop',
    platform: 'desktop',
    preferredMode: 'separate',
  })

  assert.deepEqual(result.sessionsToApply, localSessions)
})
