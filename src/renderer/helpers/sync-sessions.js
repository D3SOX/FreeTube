import { areJsonValuesEqual } from './jsonValues.js'

export const SYNC_SESSIONS_VERSION = 1

export function getSyncTabRoute(value) {
  if (typeof value !== 'string' || value.length === 0) return '/'

  try {
    const url = new URL(value, 'https://opentubex.invalid')
    // Electron stores the route in the app shell's hash; Capacitor uses paths.
    if ((url.pathname === '/' || url.pathname === '/index.html') && url.hash.startsWith('#/')) {
      return url.hash.slice(1)
    }
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return '/'
  }
}

function clone(value) {
  return structuredClone(value)
}

function latestSessionUpdate(sessions) {
  return sessions.reduce((latest, session) => (
    Number.isFinite(session?.updatedAt) ? Math.max(latest, session.updatedAt) : latest
  ), 0)
}

function normalizeSessions(value) {
  return Array.isArray(value) ? clone(value) : []
}

function normalizeDeletedSessions(value) {
  const deletedSessions = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return deletedSessions

  for (const [deviceId, sessionIds] of Object.entries(value)) {
    if (!Array.isArray(sessionIds)) continue
    const normalized = Array.from(new Set(
      sessionIds.filter(sessionId => typeof sessionId === 'string' && sessionId.length > 0)
    ))
    if (normalized.length > 0) deletedSessions[deviceId] = normalized
  }
  return deletedSessions
}

function withoutDeletedSessions(sessions, deletedSessionIds = []) {
  const deleted = new Set(deletedSessionIds)
  return sessions.filter(session => !deleted.has(session?.sessionId))
}

export function normalizeSyncSessionsDocument(value) {
  if (Array.isArray(value)) {
    return {
      version: SYNC_SESSIONS_VERSION,
      mode: 'separate',
      devices: value.length > 0
        ? { 'legacy-desktop': { platform: 'desktop', sessions: clone(value) } }
        : {},
      shared: [],
      deletedSessions: {},
    }
  }

  const deletedSessions = normalizeDeletedSessions(value?.deletedSessions)
  const devices = {}
  if (value?.devices && typeof value.devices === 'object' && !Array.isArray(value.devices)) {
    for (const [deviceId, device] of Object.entries(value.devices)) {
      if (!device || (device.platform !== 'desktop' && device.platform !== 'mobile')) continue
      devices[deviceId] = {
        platform: device.platform,
        sessions: withoutDeletedSessions(
          normalizeSessions(device.sessions),
          deletedSessions[deviceId]
        ),
      }
    }
  }

  return {
    version: SYNC_SESSIONS_VERSION,
    mode: value?.mode === 'shared' ? 'shared' : 'separate',
    devices,
    shared: normalizeSessions(value?.shared),
    deletedSessions,
  }
}

export function getOtherDeviceSessions(value, deviceId, legacyDeviceIds = []) {
  const document = normalizeSyncSessionsDocument(value)
  const currentDeviceIds = new Set([deviceId, ...legacyDeviceIds])
  return Object.entries(document.devices)
    .filter(([id]) => !currentDeviceIds.has(id))
    .flatMap(([id, device]) => device.sessions.map(session => ({
      ...clone(session),
      syncDeviceId: id,
      syncPlatform: device.platform,
    })))
}

export function removeSyncSession(value, deviceId, sessionId) {
  const document = normalizeSyncSessionsDocument(value)
  const device = document.devices[deviceId]
  document.deletedSessions[deviceId] = Array.from(new Set([
    ...(document.deletedSessions[deviceId] ?? []),
    sessionId,
  ]))
  if (!device) return document

  device.sessions = device.sessions.filter(session => session.sessionId !== sessionId)
  if (device.sessions.length === 0) delete document.devices[deviceId]
  return document
}

export function getPreviousSyncSessions(snapshot) {
  return snapshot?.sessionsV2 ?? snapshot?.sessions ?? null
}

export function shouldShowOtherDeviceSessions({
  syncEnabled,
  syncConnected,
  enhancedSyncEnabled,
  sharedTabsEnabled,
  sessions,
}) {
  return syncEnabled &&
    syncConnected &&
    enhancedSyncEnabled &&
    !sharedTabsEnabled &&
    sessions.length > 0
}

export function formatDeviceSessionLabel(session, t) {
  const count = session.tabs.length
  const fallbackName = session.syncPlatform === 'mobile'
    ? t('Settings.Sync Settings.Mobile Device')
    : t('Settings.Sync Settings.Desktop Device')
  const name = typeof session.syncDeviceName === 'string' && session.syncDeviceName.trim()
    ? session.syncDeviceName
    : fallbackName
  return `${name} · ${t('Tab Organizer.Tab Count', { count }, count)}`
}

function claimLegacyDeviceSessions(document, deviceId, legacyDeviceIds) {
  const claimed = clone(document)
  for (const legacyDeviceId of legacyDeviceIds) {
    if (legacyDeviceId === deviceId || !claimed.devices[legacyDeviceId]) continue

    const legacyDevice = claimed.devices[legacyDeviceId]
    const currentDevice = claimed.devices[deviceId]
    if (currentDevice) {
      const currentSessionIds = new Set(
        currentDevice.sessions.map(session => session?.sessionId)
      )
      for (const session of legacyDevice.sessions) {
        if (currentSessionIds.has(session?.sessionId)) continue
        currentDevice.sessions.push(session)
        currentSessionIds.add(session?.sessionId)
      }
    } else {
      claimed.devices[deviceId] = legacyDevice
    }
    delete claimed.devices[legacyDeviceId]
    if (claimed.deletedSessions[legacyDeviceId]) {
      claimed.deletedSessions[deviceId] = Array.from(new Set([
        ...(claimed.deletedSessions[deviceId] ?? []),
        ...claimed.deletedSessions[legacyDeviceId],
      ]))
      delete claimed.deletedSessions[legacyDeviceId]
    }
  }
  return claimed
}

function claimLegacyDesktopSessions(document, deviceId, platform) {
  if (platform !== 'desktop') return document

  const claimed = clone(document)
  const legacy = claimed.devices['legacy-desktop']
  const current = claimed.devices[deviceId]
  if (legacy && (!current || current.sessions.length === 0)) {
    claimed.devices[deviceId] = legacy
    delete claimed.devices['legacy-desktop']
    if (claimed.deletedSessions['legacy-desktop']) {
      claimed.deletedSessions[deviceId] = Array.from(new Set([
        ...(claimed.deletedSessions[deviceId] ?? []),
        ...claimed.deletedSessions['legacy-desktop'],
      ]))
      delete claimed.deletedSessions['legacy-desktop']
    }
  }
  return claimed
}

function mergeSessions(local, remote, previous) {
  if (previous === null) return remote.length > 0 ? remote : local

  const localChanged = !areJsonValuesEqual(local, previous)
  const remoteChanged = !areJsonValuesEqual(remote, previous)
  if (remoteChanged && !localChanged) return remote
  if (remoteChanged && localChanged && latestSessionUpdate(remote) > latestSessionUpdate(local)) {
    return remote
  }
  return local
}

export function mergeSyncSessions({
  localSessions,
  remoteValue,
  previousValue = null,
  deviceId,
  platform,
  preferredMode,
  legacyDeviceIds = [],
}) {
  const remote = claimLegacyDeviceSessions(
    claimLegacyDesktopSessions(
      normalizeSyncSessionsDocument(remoteValue),
      deviceId,
      platform
    ),
    deviceId,
    legacyDeviceIds
  )
  const previous = previousValue === null
    ? null
    : claimLegacyDeviceSessions(
        claimLegacyDesktopSessions(
          normalizeSyncSessionsDocument(previousValue),
          deviceId,
          platform
        ),
        deviceId,
        legacyDeviceIds
      )
  const localMode = preferredMode === 'shared' ? 'shared' : 'separate'
  const localModeChanged = previous !== null && previous.mode !== localMode
  const remoteModeChanged = previous !== null && remote.mode !== previous.mode
  const mode = previous === null
    ? localMode === 'shared' ? 'shared' : remote.mode
    : localModeChanged
      ? localMode
      : remoteModeChanged
        ? remote.mode
        : localMode

  const local = normalizeSessions(localSessions)
  const localDeviceSessions = withoutDeletedSessions(
    local,
    remote.deletedSessions[deviceId]
  )
  const previousDeviceSessions = previous?.devices[deviceId]?.sessions ?? null
  const remoteDeviceSessions = remote.devices[deviceId]?.sessions ?? []
  const deviceSessions = mergeSessions(
    localDeviceSessions,
    remoteDeviceSessions,
    previousDeviceSessions
  )
  const devices = {
    ...remote.devices,
    [deviceId]: { platform, sessions: clone(deviceSessions) },
  }
  const deletedSessions = clone(remote.deletedSessions)
  if (deletedSessions[deviceId]) {
    const localSessionIds = new Set(local.map(session => session?.sessionId))
    deletedSessions[deviceId] = deletedSessions[deviceId].filter(
      sessionId => localSessionIds.has(sessionId)
    )
    if (deletedSessions[deviceId].length === 0) delete deletedSessions[deviceId]
  }

  let shared = remote.shared
  if (mode === 'shared') {
    shared = localModeChanged && previous?.mode !== 'shared'
      ? local
      : mergeSessions(local, remote.shared, previous?.shared ?? null)
  }

  const document = {
    version: SYNC_SESSIONS_VERSION,
    mode,
    devices,
    shared: clone(shared),
    deletedSessions,
  }
  const otherDeviceSessions = getOtherDeviceSessions(document, deviceId)

  return {
    document,
    sessionsToApply: mode === 'shared' ? clone(shared) : clone(deviceSessions),
    otherDeviceSessions,
    mode,
  }
}
