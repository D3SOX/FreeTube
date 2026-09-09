import i18n from '../../i18n/index'
import { showToastOnAllTabs } from '../../helpers/utils'
import { isAppHidden } from '../../helpers/appVisibility.js'
import {
  SyncServerClient,
  SyncServerCancelledError,
  SyncServerDataLossError,
  SYNC_SERVER_SESSION_EXPIRED_MESSAGE,
  getSavedOtherDeviceSessions,
  isExpiredSessionReauthentication,
  isSessionExpiredError,
  normalizeSyncServerUrl,
  syncHistory,
  syncPlaylistBookmarks,
  syncPlaylists,
  syncProfiles,
  syncSessions,
  syncSettings,
  syncSubscriptions,
} from '../../helpers/sync-server'
import {
  EncryptedSyncAdapter,
  createEmptySyncDocument,
  decryptLegacySyncDocument,
  decryptSyncDocument,
  encryptSyncDocument,
  loadLegacySyncDocument,
  migrateLegacyPlaybackSpeedsToSettings,
  preparePrivacyKey,
} from '../../helpers/sync-server-privacy'
import {
  encryptSyncServerDeviceInfo,
  loadSyncServerDeviceNames,
} from '../../helpers/sync-server-sessions'
import { mergePlaylistBookmarkConflict } from '../../helpers/playlist-bookmarks'
import { getPreviousSyncSessions, getSyncTabRoute, removeSyncSession } from '../../helpers/sync-sessions'
import {
  AUTO_SYNC_INTERVAL_MS,
  isRecentSync,
  isSyncReasonEnabled,
} from '../../helpers/sync-server-scheduling'
import { isSettingSyncEnabled } from './settings'
import { syncSubscriptionSeenVideos } from '../../helpers/subscription-seen-videos'

const EVENT_SYNC_DEBOUNCE_MS = 1500
const ENCRYPTED_SYNC_RETRIES = 3
const LEGACY_ENCRYPTED_COLLECTIONS = [
  'subscriptions',
  'playlists',
  'history',
  'profiles',
  'playlistBookmarks',
]

let activeSyncPromise = null
const activeSyncClients = new Set()
let autoSyncTimer = null
let eventSyncTimer = null
let lifecycleSyncStarted = false
let deviceNameRefreshId = 0

function clearSyncServerDeviceNames(commit) {
  deviceNameRefreshId++
  commit('setSyncServerDeviceNames', {})
}

function trackSyncClient(client) {
  activeSyncClients.add(client)
  return client
}

function releaseSyncClient(client) {
  activeSyncClients.delete(client)
}

function cancelActiveSyncClients() {
  for (const client of activeSyncClients) client.cancel()
}

function assertSyncEnabled(rootState, client) {
  if (!rootState.settings.syncServerEnabled || client.cancelled) {
    throw new SyncServerCancelledError()
  }
}

async function tryLoadSyncServerDeviceNames(client, privacyKey) {
  try {
    return await loadSyncServerDeviceNames(client, privacyKey)
  } catch (error) {
    if (error instanceof SyncServerCancelledError || isSessionExpiredError(error)) throw error
    console.warn('Failed to load encrypted sync device names:', error)
    return null
  }
}

const state = {
  syncServerStatus: 'idle',
  syncServerProgress: null,
  syncServerError: '',
  syncServerLastResult: null,
  syncServerHistorySupported: null,
  syncServerSessionExpired: false,
  syncServerOtherDeviceSessions: [],
  syncServerDeviceNames: {},
}

const getters = {
  getSyncServerStatus: state => state.syncServerStatus,
  getSyncServerProgress: state => state.syncServerProgress,
  getSyncServerError: state => state.syncServerError,
  getSyncServerLastResult: state => state.syncServerLastResult,
  getSyncServerHistorySupported: state => state.syncServerHistorySupported,
  getSyncServerOtherDeviceSessions: state => state.syncServerOtherDeviceSessions.map(session => ({
    ...session,
    syncDeviceName: state.syncServerDeviceNames[session.syncDeviceId] ?? '',
  })),
}

function parseSnapshot(value) {
  try {
    const snapshot = JSON.parse(value)
    return snapshot && typeof snapshot === 'object' ? snapshot : {}
  } catch {
    return {}
  }
}

function withSyncLock(callback) {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request('opentubex-sync-server', callback)
  }
  return callback()
}

function requiresEncryptedSync(settings) {
  // A key may survive a privacy-mode downgrade made by an older app version.
  return settings.syncServerPrivacyMode === 'enhanced' || Boolean(settings.syncServerPrivacyKey)
}

function assertEncryptionSupported(supported, required) {
  if (required && !supported) {
    throw new Error('This account requires encrypted sync, but the server no longer supports it')
  }
}

async function runSync(context, { allowDataLoss = false, notifyDataLoss = true } = {}) {
  const { commit, dispatch, rootGetters, rootState } = context
  const settings = rootState.settings
  const encrypted = requiresEncryptedSync(settings)
  const networkClient = trackSyncClient(
    new SyncServerClient(settings.syncServerUrl, settings.syncServerToken)
  )
  let client = networkClient
  let encryptedCollections = null
  const previous = parseSnapshot(settings.syncServerSnapshot)
  const next = { ...previous }
  const result = {}
  const store = { state: rootState, getters: rootGetters, commit, dispatch }
  const stages = [
    ...(encrypted ? ['download'] : []),
    ...(settings.syncServerSyncSubscriptions ? ['subscriptions'] : []),
    ...(settings.syncServerSyncPlaylists ? ['playlists'] : []),
    ...(settings.syncServerSyncPlaylists ? ['playlistBookmarks'] : []),
    ...(settings.syncServerSyncHistory ? ['history'] : []),
    ...(settings.syncServerSyncProfiles ? ['profiles'] : []),
    ...((process.env.IS_ELECTRON || process.env.IS_CAPACITOR) &&
      encrypted &&
      settings.syncServerSyncSessions
      ? ['sessionsV2']
      : []),
    ...(encrypted && settings.syncServerSyncSettings
      ? ['settings']
      : []),
    ...(encrypted ? ['upload'] : []),
    'finishing',
  ]
  let completedStages = 0

  function assertSyncStillActive() {
    assertSyncEnabled(rootState, networkClient)
  }

  async function runStage(stage, callback) {
    assertSyncStillActive()
    const progressStage = stage === 'seenVideos' ? 'history' : stage
    commit('setSyncServerProgress', {
      stage: progressStage,
      percentage: Math.round((completedStages / stages.length) * 100),
    })
    const value = await callback()
    assertSyncStillActive()
    completedStages++
    commit('setSyncServerProgress', {
      stage: progressStage,
      percentage: Math.round((completedStages / stages.length) * 100),
    })
    return value
  }

  commit('setSyncServerStatus', 'syncing')
  commit('setSyncServerProgress', { stage: stages[0], percentage: 0 })
  commit('setSyncServerError', '')

  async function applyCollection(collection, targetClient) {
    switch (collection) {
      case 'seenVideos':
        result.seenVideos = await syncSubscriptionSeenVideos(targetClient, store)
        break
      case 'subscriptions':
        next.subscriptions = await syncSubscriptions(
          targetClient,
          store,
          previous.subscriptions,
          { allowDataLoss }
        )
        result.subscriptions = next.subscriptions.length
        break
      case 'playlists':
        next.playlists = await syncPlaylists(
          targetClient,
          store,
          previous.playlists,
          { allowDataLoss }
        )
        result.playlists = Object.keys(next.playlists).length
        break
      case 'playlistBookmarks':
        next.playlistBookmarks = await syncPlaylistBookmarks(
          targetClient,
          store,
          previous.playlistBookmarks,
          { allowDataLoss }
        )
        result.playlistBookmarks = next.playlistBookmarks.length
        break
      case 'history': {
        const history = await syncHistory(
          targetClient,
          store,
          previous.history,
          { allowDataLoss }
        )
        if (history !== null) {
          commit('setSyncServerHistorySupported', true)
          next.history = history
          result.history = history.length
        } else {
          commit('setSyncServerHistorySupported', false)
        }
        break
      }
      case 'profiles':
        {
          const profiles = await syncProfiles(
            targetClient,
            store,
            previous.profiles,
            { allowDataLoss }
          )
          if (profiles !== null) {
            next.profiles = profiles
            result.profiles = Object.keys(profiles).length
          }
        }
        break
      case 'settings':
        next.settings = await syncSettings(targetClient, store, previous.settings)
        result.settings = Object.keys(next.settings).length
        break
      case 'sessionsV2': {
        const sessions = await syncSessions(
          targetClient,
          store,
          getPreviousSyncSessions(previous)
        )
        if (sessions !== null) {
          next.sessionsV2 = sessions.document
          result.sessions = sessions.sessionsToApply.reduce(
            (count, session) => count + session.tabs.length,
            0
          )
          commit('setSyncServerOtherDeviceSessions', sessions.otherDeviceSessions)
        }
        break
      }
    }
  }

  try {
    if (encrypted) {
      if (settings.syncServerSyncHistory && await networkClient.supportsSeenVideosSync()) {
        stages.splice(stages.indexOf('history') + 1, 0, 'seenVideos')
      }
      if (!settings.syncServerPrivacyKey) {
        throw new Error('Reconnect and enter your privacy passphrase to enable enhanced privacy')
      }
      const enabledCollections = stages.filter(stage => ![
        'download',
        'upload',
        'finishing',
      ].includes(stage))
      const {
        document,
        original,
        remote,
        uploadCollections,
      } = await runStage('download', async () => {
        // The snapshot is saved only after successful collection uploads.
        // Never infer completed migration from unrelated encrypted settings.
        const playbackSpeedsInSettings = settings.syncServerSyncSettings &&
          isSettingSyncEnabled(settings, 'channelPlaybackSpeeds') &&
          Boolean(previous.settings?.channelPlaybackSpeeds)
        const manifest = await networkClient.getEncryptedSyncManifest({ playbackSpeedsInSettings })
        const legacyEncrypted = manifest.legacy_encrypted_data
          ? await networkClient.getLegacyEncryptedSync()
          : null
        const legacy = legacyEncrypted?.payload
          ? await decryptLegacySyncDocument(
              legacyEncrypted.payload,
              settings.syncServerPrivacyKey
            )
          : manifest.legacy_data
            ? await loadLegacySyncDocument(networkClient)
            : createEmptySyncDocument()
        const uploadCollections = manifest.legacy_data || legacyEncrypted?.payload
          ? Array.from(new Set([...enabledCollections, ...LEGACY_ENCRYPTED_COLLECTIONS]))
          : enabledCollections
        const hasLegacyPlaybackSpeeds = manifest.collections.some(
          entry => entry.collection === 'playbackSpeeds'
        )
        const compatibilityCollections = [
          ...(hasLegacyPlaybackSpeeds ? ['playbackSpeeds'] : []),
          ...(enabledCollections.includes('sessionsV2') ? ['sessions'] : []),
        ]
        const downloadCollections = Array.from(new Set([
          ...uploadCollections,
          ...compatibilityCollections,
        ]))
        const document = createEmptySyncDocument()
        // Legacy speeds are read for migration into settings, never uploaded.
        document.playbackSpeeds = legacy.playbackSpeeds ?? []
        const original = {}
        const entries = await Promise.all(downloadCollections.map(async collection => {
          const response = await networkClient.getEncryptedSyncCollection(collection)
          const data = response.payload
            ? await decryptSyncDocument(response.payload, settings.syncServerPrivacyKey)
            : legacy[collection]
          document[collection] = data ?? document[collection]
          original[collection] = structuredClone(document[collection])
          return [collection, response]
        }))
        if (settings.syncServerSyncSettings &&
            isSettingSyncEnabled(settings, 'channelPlaybackSpeeds')) {
          migrateLegacyPlaybackSpeedsToSettings(
            document,
            settings.channelPlaybackSpeeds
          )
        }
        return { document, original, remote: Object.fromEntries(entries), uploadCollections }
      })
      client = new EncryptedSyncAdapter(document)
      encryptedCollections = {
        original,
        remote,
        enabled: enabledCollections,
        upload: uploadCollections,
      }
    }

    const collections = encryptedCollections?.enabled ?? stages.filter(stage => ![
      'download',
      'upload',
      'finishing',
      'settings',
    ].includes(stage))
    for (const collection of collections) {
      await runStage(collection, () => applyCollection(collection, client))
    }

    if (encryptedCollections) {
      await runStage('upload', async () => {
        for (const collection of encryptedCollections.upload) {
          assertSyncStillActive()
          let revision = encryptedCollections.remote[collection].revision
          let data = client.document[collection]
          if (revision > 0 &&
              JSON.stringify(data) === JSON.stringify(encryptedCollections.original[collection])) {
            continue
          }
          for (let attempt = 0; attempt < ENCRYPTED_SYNC_RETRIES; attempt++) {
            const payload = await encryptSyncDocument(
              data,
              settings.syncServerPrivacyKey,
              settings.syncServerPrivacySalt
            )
            try {
              await networkClient.putEncryptedSyncCollection(collection, revision, payload)
              break
            } catch (error) {
              if (error.status !== 409 || attempt === ENCRYPTED_SYNC_RETRIES - 1) throw error
              const remote = await networkClient.getEncryptedSyncCollection(collection)
              const retryDocument = createEmptySyncDocument()
              const remoteData = await decryptSyncDocument(
                remote.payload,
                settings.syncServerPrivacyKey
              )
              if (collection === 'playlistBookmarks') {
                revision = remote.revision
                data = mergePlaylistBookmarkConflict({
                  original: encryptedCollections.original.playlistBookmarks,
                  local: data,
                  remote: remoteData,
                })
                continue
              }
              retryDocument[collection] = remoteData
              if (collection !== 'subscriptions') {
                retryDocument.subscriptions = client.document.subscriptions
              }
              const retryClient = new EncryptedSyncAdapter(retryDocument)
              if (collection === 'settings') {
                next.settings = await syncSettings(retryClient, store, next.settings)
                result.settings = Object.keys(next.settings).length
              } else {
                await applyCollection(collection, retryClient)
              }
              revision = remote.revision
              data = retryClient.document[collection]
            }
          }
        }
      })
    }

    await runStage('finishing', async () => {
      const lastSyncAt = Date.now()
      await Promise.all([
        dispatch('updateSyncServerSnapshot', JSON.stringify(next), { root: true }),
        dispatch('updateSyncServerLastSyncAt', lastSyncAt, { root: true }),
      ])
    })
    if (settings.syncServerResumeAutoSync) {
      await dispatch('setSyncServerAutoSync', true)
    }
    commit('setSyncServerLastResult', result)
    commit('setSyncServerProgress', null)
    commit('setSyncServerStatus', 'success')
    return result
  } catch (error) {
    if (error instanceof SyncServerCancelledError) {
      commit('setSyncServerProgress', null)
      commit('setSyncServerError', '')
      commit('setSyncServerStatus', 'idle')
      return null
    }
    if (error instanceof SyncServerDataLossError) {
      if (settings.syncServerAutoSync) {
        await dispatch('updateSyncServerResumeAutoSync', true, { root: true })
      }
      // Pause without treating it as the user's choice to disable automatic sync.
      await dispatch('updateSyncServerAutoSync', false, { root: true })
      await dispatch('stopSyncServerAutoSync')
      if (notifyDataLoss) {
        showToastOnAllTabs(
          i18n.global.t('Settings.Sync Settings.Destructive Sync Blocked'),
          15000,
          ['fas', 'triangle-exclamation'],
          'open-sync-settings'
        )
      }
    }
    commit('setSyncServerProgress', null)
    if (isSessionExpiredError(error)) {
      // Retrying cannot help once the token is rejected, and every scheduled
      // sync would keep failing with the same opaque message. Drop the token so
      // automatic sync stops and the UI asks for a sign-in.
      await dispatch('expireSyncServerSession')
      throw new Error(SYNC_SERVER_SESSION_EXPIRED_MESSAGE, { cause: error })
    }
    commit('setSyncServerError', error.message)
    commit('setSyncServerStatus', 'error')
    throw error
  } finally {
    releaseSyncClient(networkClient)
  }
}

const actions = {
  async openSyncServerSession(_context, session) {
    if (!Array.isArray(session?.tabs) || session.tabs.length === 0) return false

    if (process.env.IS_CAPACITOR) {
      const { getCapacitorTabService } = await import('../../tabs/CapacitorTabService')
      return getCapacitorTabService().openSyncedSession(session)
    }
    if (!process.env.IS_ELECTRON) return false

    for (const [index, tab] of session.tabs.entries()) {
      await window.ftElectron.tabs.create({
        route: getSyncTabRoute(tab.url),
        title: tab.title ?? '',
        makeActive: index === session.tabs.length - 1,
      })
    }
    return true
  },

  async deleteSyncServerSession({ commit, dispatch, rootState }, session) {
    const { syncDeviceId, sessionId } = session ?? {}
    const settings = rootState.settings
    if (typeof syncDeviceId !== 'string' || typeof sessionId !== 'string') {
      throw new Error('Invalid synced tab set')
    }
    if (!settings.syncServerToken || !settings.syncServerPrivacyKey) {
      throw new Error('Connect to the sync server first')
    }

    const deleteSession = async () => {
      const client = trackSyncClient(new SyncServerClient(
        settings.syncServerUrl,
        settings.syncServerToken
      ))
      commit('setSyncServerStatus', 'syncing')
      commit('setSyncServerError', '')

      try {
        for (let attempt = 0; attempt < ENCRYPTED_SYNC_RETRIES; attempt++) {
          assertSyncEnabled(rootState, client)
          const remote = await client.getEncryptedSyncCollection('sessionsV2')
          let remoteValue = remote.payload
            ? await decryptSyncDocument(remote.payload, settings.syncServerPrivacyKey)
            : null

          if (remoteValue === null) {
            const legacy = await client.getEncryptedSyncCollection('sessions')
            remoteValue = legacy.payload
              ? await decryptSyncDocument(legacy.payload, settings.syncServerPrivacyKey)
              : null
          }

          assertSyncEnabled(rootState, client)
          const nextSessions = removeSyncSession(remoteValue, syncDeviceId, sessionId)
          const payload = await encryptSyncDocument(
            nextSessions,
            settings.syncServerPrivacyKey,
            settings.syncServerPrivacySalt
          )

          try {
            await client.putEncryptedSyncCollection('sessionsV2', remote.revision, payload)
          } catch (error) {
            if (error.status === 409 && attempt < ENCRYPTED_SYNC_RETRIES - 1) continue
            throw error
          }

          assertSyncEnabled(rootState, client)
          const snapshot = parseSnapshot(rootState.settings.syncServerSnapshot)
          snapshot.sessionsV2 = nextSessions
          await dispatch('updateSyncServerSnapshot', JSON.stringify(snapshot), { root: true })
          commit('setSyncServerOtherDeviceSessions', getSavedOtherDeviceSessions(snapshot, settings))
          commit('setSyncServerStatus', 'success')
          return true
        }
      } catch (error) {
        if (error instanceof SyncServerCancelledError) {
          commit('setSyncServerStatus', 'idle')
          return false
        }
        if (isSessionExpiredError(error)) {
          await dispatch('expireSyncServerSession')
          throw new Error(SYNC_SERVER_SESSION_EXPIRED_MESSAGE, { cause: error })
        }
        commit('setSyncServerError', error.message)
        commit('setSyncServerStatus', 'error')
        throw error
      } finally {
        releaseSyncClient(client)
      }
    }

    return withSyncLock(deleteSession)
  },

  async completeSyncServerPairing(
    { commit, dispatch, rootState },
    { serverUrl, username, token, privacyKey, privacySalt, deviceId, deviceName, deviceSystemInfo }
  ) {
    if (!rootState.settings.syncServerEnabled) {
      throw new Error('Enable sync first')
    }
    const normalizedUrl = normalizeSyncServerUrl(serverUrl)
    const trimmedUsername = username.trim()
    if (!trimmedUsername || !token || !privacyKey || !privacySalt || !deviceId || !deviceName) {
      throw new Error('Incomplete pairing result')
    }

    await dispatch('updateSyncServerUrl', normalizedUrl, { root: true })
    await dispatch('updateSyncServerUsername', trimmedUsername, { root: true })
    await dispatch('updateSyncServerDeviceId', deviceId, { root: true })
    await dispatch('updateSyncServerDeviceName', deviceName, { root: true })
    await dispatch('updateSyncServerResumeAutoSync', false, { root: true })
    await dispatch('updateSyncServerSnapshot', '{}', { root: true })
    await dispatch('updateSyncServerLastSyncAt', 0, { root: true })
    await dispatch('updateSyncServerPrivacyMode', 'enhanced', { root: true })
    await dispatch('updateSyncServerPrivacyKey', privacyKey, { root: true })
    await dispatch('updateSyncServerPrivacySalt', privacySalt, { root: true })
    await dispatch('replaceSyncServerToken', token)
    commit('setSyncServerSessionExpired', false)

    if (deviceSystemInfo) {
      const client = trackSyncClient(new SyncServerClient(normalizedUrl, token))
      try {
        if (await client.supportsAccountSessions()) {
          const encryptedDeviceInfo = await encryptSyncServerDeviceInfo(
            { name: deviceName, ...deviceSystemInfo },
            privacyKey,
            deviceId
          )
          await client.updateAccountSession('current', encryptedDeviceInfo)
        }
      } catch {
        // The one-time pairing transfer has already been consumed. Keep the
        // saved account session; account management repairs its metadata later.
      } finally {
        releaseSyncClient(client)
      }
    }

    return dispatch('startSyncServerAutoSync')
  },

  async authenticateSyncServer(
    { commit, dispatch, rootState, state },
    { mode, serverUrl, username, password, privacyPassphrase, deviceId, deviceName, deviceSystemInfo }
  ) {
    if (mode !== 'login' && mode !== 'register') {
      throw new Error('Invalid authentication mode')
    }
    if (!rootState.settings.syncServerEnabled) {
      throw new Error('Enable sync first')
    }

    const normalizedUrl = normalizeSyncServerUrl(serverUrl)
    const trimmedUsername = username.trim()
    const previousToken = rootState.settings.syncServerToken
    const resumesExpiredSession = isExpiredSessionReauthentication({
      expired: state.syncServerSessionExpired,
      savedServerUrl: rootState.settings.syncServerUrl,
      savedUsername: rootState.settings.syncServerUsername,
      serverUrl: normalizedUrl,
      username: trimmedUsername,
    })
    if (!trimmedUsername || !password || !deviceId || !deviceName || !deviceSystemInfo) {
      throw new Error('Username, password, and device information are required')
    }

    const client = trackSyncClient(new SyncServerClient(normalizedUrl))
    try {
      const updateWhileEnabled = async (action, value) => {
        assertSyncEnabled(rootState, client)
        await dispatch(action, value, { root: true })
        assertSyncEnabled(rootState, client)
      }

      const privacySupported = await client.supportsEncryptedSync()
      const sameAccount = normalizedUrl === rootState.settings.syncServerUrl &&
        trimmedUsername === rootState.settings.syncServerUsername
      assertEncryptionSupported(privacySupported, Boolean(privacyPassphrase) ||
        (sameAccount && requiresEncryptedSync(rootState.settings)))
      if (privacySupported && !privacyPassphrase) {
        throw new Error('A privacy passphrase is required by this server')
      }
      if (privacySupported && privacyPassphrase.length < 12) {
        throw new Error('The privacy passphrase must be at least 12 characters')
      }
      if (privacySupported && privacyPassphrase === password) {
        throw new Error('The privacy passphrase must be different from the account password')
      }
      const token = await client.authenticate(mode, trimmedUsername, password, deviceId)
      let privacyKey = ''
      let privacySalt = ''

      if (privacySupported) {
        const manifest = await client.getEncryptedSyncManifest()
        const firstCollection = manifest.collections[0]?.collection
        const remote = firstCollection
          ? await client.getEncryptedSyncCollection(firstCollection)
          : manifest.legacy_encrypted_data
            ? await client.getLegacyEncryptedSync()
            : null
        const privacy = await preparePrivacyKey(remote?.payload, privacyPassphrase)
        privacyKey = privacy.key
        privacySalt = privacy.salt
      }

      if (privacySupported && await client.supportsAccountSessions()) {
        const encryptedDeviceInfo = await encryptSyncServerDeviceInfo(
          { name: deviceName, ...deviceSystemInfo },
          privacyKey,
          deviceId
        )
        await client.updateAccountSession('current', encryptedDeviceInfo)
      }

      assertSyncEnabled(rootState, client)

      // Keep writes to the shared settings datastore ordered. In particular,
      // the URL must be committed before the token enables the initial sync.
      if (!sameAccount) {
        await updateWhileEnabled('updateSyncServerResumeAutoSync', false)
      }
      await updateWhileEnabled('updateSyncServerUrl', normalizedUrl)
      await updateWhileEnabled('updateSyncServerUsername', trimmedUsername)
      await updateWhileEnabled('updateSyncServerDeviceId', deviceId)
      await updateWhileEnabled('updateSyncServerDeviceName', deviceName)
      if (!resumesExpiredSession) {
        await updateWhileEnabled('updateSyncServerSnapshot', '{}')
        await updateWhileEnabled('updateSyncServerLastSyncAt', 0)
      }
      await updateWhileEnabled(
        'updateSyncServerPrivacyMode',
        privacySupported ? 'enhanced' : 'legacy'
      )
      await updateWhileEnabled('updateSyncServerPrivacyKey', privacyKey)
      await updateWhileEnabled('updateSyncServerPrivacySalt', privacySalt)
      await updateWhileEnabled('replaceSyncServerToken', token)
      commit('setSyncServerSessionExpired', false)

      await dispatch('startSyncServerAutoSync')
      return dispatch('syncWithSyncServer')
    } catch (error) {
      if (error instanceof SyncServerCancelledError &&
          rootState.settings.syncServerToken !== previousToken) {
        await dispatch('replaceSyncServerToken', previousToken)
      }
      throw error
    } finally {
      releaseSyncClient(client)
    }
  },

  /**
   * Handle the server rejecting the stored token.
   *
   * Only the token is cleared. The server URL, username, snapshot and privacy
   * key are kept so that signing in again resumes where sync left off instead of
   * re-downloading everything.
   */
  async expireSyncServerSession({ commit, dispatch }) {
    await dispatch('stopSyncServerAutoSync')
    await dispatch('replaceSyncServerToken', '')
    commit('setSyncServerProgress', null)
    commit('setSyncServerError', SYNC_SERVER_SESSION_EXPIRED_MESSAGE)
    commit('setSyncServerSessionExpired', true)
    commit('setSyncServerStatus', 'error')
  },

  async disconnectSyncServer({ commit, dispatch }) {
    await dispatch('stopSyncServerAutoSync')
    await dispatch('updateSyncServerUsername', '', { root: true })
    await dispatch('updateSyncServerResumeAutoSync', false, { root: true })
    await dispatch('updateSyncServerSnapshot', '{}', { root: true })
    await dispatch('updateSyncServerLastSyncAt', 0, { root: true })
    await dispatch('updateSyncServerPrivacyMode', 'unknown', { root: true })
    await dispatch('updateSyncServerPrivacyKey', '', { root: true })
    await dispatch('updateSyncServerPrivacySalt', '', { root: true })
    await dispatch('replaceSyncServerToken', '')
    commit('setSyncServerError', '')
    commit('setSyncServerLastResult', null)
    commit('setSyncServerHistorySupported', null)
    commit('setSyncServerProgress', null)
    commit('setSyncServerStatus', 'idle')
    commit('setSyncServerSessionExpired', false)
    commit('setSyncServerOtherDeviceSessions', [])
  },

  async deleteSyncServerAccount({ commit, dispatch, rootState }, password) {
    if (!rootState.settings.syncServerToken) {
      throw new Error('Connect to a sync server first')
    }
    if (!password) {
      throw new Error('Password is required')
    }

    commit('setSyncServerStatus', 'syncing')
    commit('setSyncServerProgress', null)
    commit('setSyncServerError', '')
    await dispatch('stopSyncServerAutoSync')

    try {
      const client = trackSyncClient(new SyncServerClient(
        rootState.settings.syncServerUrl,
        rootState.settings.syncServerToken
      ))
      try {
        await client.deleteAccount(password)
        assertSyncEnabled(rootState, client)
        await dispatch('disconnectSyncServer')
      } finally {
        releaseSyncClient(client)
      }
    } catch (error) {
      if (error instanceof SyncServerCancelledError) {
        commit('setSyncServerError', '')
        commit('setSyncServerStatus', 'idle')
        return null
      }
      commit('setSyncServerError', error.message)
      commit('setSyncServerStatus', 'error')
      await dispatch('startSyncServerAutoSync')
      throw error
    }
  },

  syncWithSyncServer(context, options = {}) {
    if (!context.rootState.settings.syncServerEnabled) {
      return Promise.reject(new Error('Enable sync first'))
    }
    if (!context.rootState.settings.syncServerToken) {
      return Promise.reject(new Error('Connect to a sync server first'))
    }
    if (!activeSyncPromise) {
      let syncStarted = false
      clearTimeout(eventSyncTimer)
      eventSyncTimer = null
      activeSyncPromise = withSyncLock(() => {
        if (!context.rootState.settings.syncServerEnabled) return null
        if (options.skipIfRecent &&
            isRecentSync(context.rootState.settings.syncServerLastSyncAt)) {
          return null
        }
        syncStarted = true
        return runSync(context, options)
      }).finally(() => {
        activeSyncPromise = null
        context.dispatch(syncStarted
          ? 'restartSyncServerAutoSync'
          : 'startSyncServerAutoSync')
      })
    }
    return activeSyncPromise
  },

  async initializeSyncServer({ commit, dispatch, rootState }) {
    if (!rootState.settings.syncServerEnabled || !rootState.settings.syncServerToken) return

    commit(
      'setSyncServerOtherDeviceSessions',
      getSavedOtherDeviceSessions(
        parseSnapshot(rootState.settings.syncServerSnapshot),
        rootState.settings
      )
    )

    try {
      const client = trackSyncClient(new SyncServerClient(
        rootState.settings.syncServerUrl,
        rootState.settings.syncServerToken
      ))
      let privacySupported
      try {
        privacySupported = await client.supportsEncryptedSync()
        assertSyncEnabled(rootState, client)
      } finally {
        releaseSyncClient(client)
      }
      assertEncryptionSupported(privacySupported, requiresEncryptedSync(rootState.settings))
      const privacyMode = privacySupported ? 'enhanced' : 'legacy'
      await dispatch('updateSyncServerPrivacyMode', privacyMode, { root: true })
      if (privacySupported && !rootState.settings.syncServerPrivacyKey) {
        commit(
          'setSyncServerError',
          'Reconnect and enter your privacy passphrase to enable enhanced privacy'
        )
        return
      }
    } catch (error) {
      if (error instanceof SyncServerCancelledError) return
      commit('setSyncServerError', error.message)
      return
    }

    await dispatch('startSyncServerAutoSync')
    if (!lifecycleSyncStarted && typeof window !== 'undefined') {
      lifecycleSyncStarted = true
      window.addEventListener('online', () => dispatch('scheduleSyncServer', 'automatic'))
      document.addEventListener('visibilitychange', () => {
        if (!isAppHidden()) {
          dispatch('scheduleSyncServer', 'automatic')
        }
      })
    }
    if (rootState.settings.syncServerAutoSync) {
      await dispatch('syncWithSyncServer', { skipIfRecent: true })
    }
  },

  startSyncServerAutoSync({ dispatch, rootState }) {
    if (autoSyncTimer ||
        !rootState.settings.syncServerEnabled ||
        !rootState.settings.syncServerAutoSync ||
        !rootState.settings.syncServerToken ||
        !isSyncReasonEnabled(rootState.settings, 'automatic')) {
      return
    }

    autoSyncTimer = setTimeout(() => {
      autoSyncTimer = null
      dispatch('syncWithSyncServer', { skipIfRecent: true }).catch(error => {
        console.error('Sync server automatic sync failed', error)
      })
    }, AUTO_SYNC_INTERVAL_MS)
  },

  async refreshSyncServerDeviceNames({ commit, dispatch, rootState }) {
    const settings = rootState.settings
    if (!settings.syncServerToken || !settings.syncServerPrivacyKey) {
      clearSyncServerDeviceNames(commit)
      return
    }
    const refreshId = ++deviceNameRefreshId

    const client = trackSyncClient(new SyncServerClient(
      settings.syncServerUrl,
      settings.syncServerToken
    ))
    try {
      const deviceNames = await tryLoadSyncServerDeviceNames(
        client,
        settings.syncServerPrivacyKey
      )
      assertSyncEnabled(rootState, client)
      if (refreshId === deviceNameRefreshId && deviceNames !== null) {
        commit('setSyncServerDeviceNames', deviceNames)
      }
    } catch (error) {
      if (refreshId !== deviceNameRefreshId) return
      if (error instanceof SyncServerCancelledError) return
      if (isSessionExpiredError(error)) {
        await dispatch('expireSyncServerSession')
        return
      }
      throw error
    } finally {
      releaseSyncClient(client)
    }
  },

  async replaceSyncServerToken({ commit, dispatch }, token) {
    clearSyncServerDeviceNames(commit)
    await dispatch('updateSyncServerToken', token, { root: true })
  },

  restartSyncServerAutoSync({ dispatch }) {
    clearTimeout(autoSyncTimer)
    autoSyncTimer = null
    return dispatch('startSyncServerAutoSync')
  },

  stopSyncServerAutoSync() {
    clearTimeout(autoSyncTimer)
    clearTimeout(eventSyncTimer)
    autoSyncTimer = null
    eventSyncTimer = null
  },

  scheduleSyncServer({ dispatch, rootState }, reason = 'data') {
    if (!rootState.settings.syncServerEnabled ||
        !rootState.settings.syncServerAutoSync ||
        !rootState.settings.syncServerToken ||
        !isSyncReasonEnabled(rootState.settings, reason) ||
        rootState.syncServer.syncServerStatus === 'syncing') {
      return
    }
    clearTimeout(eventSyncTimer)
    eventSyncTimer = setTimeout(() => {
      eventSyncTimer = null
      dispatch('syncWithSyncServer', {
        skipIfRecent: reason === 'automatic',
      }).catch(error => {
        console.error('Sync server event sync failed', error)
      })
    }, EVENT_SYNC_DEBOUNCE_MS)
  },

  async setSyncServerAutoSync({ dispatch }, enabled) {
    await dispatch('updateSyncServerResumeAutoSync', false, { root: true })
    await dispatch('updateSyncServerAutoSync', enabled, { root: true })
    await dispatch(enabled ? 'startSyncServerAutoSync' : 'stopSyncServerAutoSync')
  },

  async applySyncServerEnabled({ commit, dispatch, rootState }, enabled) {
    if (!enabled) {
      cancelActiveSyncClients()
      await dispatch('stopSyncServerAutoSync')
      await dispatch('updateSyncServerResumeAutoSync', false, { root: true })
      commit('setSyncServerProgress', null)
      commit('setSyncServerError', '')
      commit('setSyncServerStatus', 'idle')
      commit('setSyncServerOtherDeviceSessions', [])
      clearSyncServerDeviceNames(commit)
      return
    }
    if (rootState.settings.syncServerToken) {
      await dispatch('initializeSyncServer')
    }
  },

  async setSyncServerEnabled({ commit, dispatch }, enabled) {
    if (!enabled) {
      commit('setSyncServerEnabled', false, { root: true })
      await dispatch('applySyncServerEnabled', false)
    }
    await dispatch('updateSyncServerEnabled', enabled, { root: true })
    if (enabled) {
      await dispatch('applySyncServerEnabled', true)
    }
  },
}

const mutations = {
  setSyncServerStatus(state, status) {
    state.syncServerStatus = status
  },
  setSyncServerProgress(state, progress) {
    state.syncServerProgress = progress
  },
  setSyncServerError(state, error) {
    state.syncServerError = error
  },
  setSyncServerLastResult(state, result) {
    state.syncServerLastResult = result
  },
  setSyncServerHistorySupported(state, supported) {
    state.syncServerHistorySupported = supported
  },
  setSyncServerSessionExpired(state, expired) {
    state.syncServerSessionExpired = expired
  },
  setSyncServerOtherDeviceSessions(state, sessions) {
    state.syncServerOtherDeviceSessions = sessions
  },
  setSyncServerDeviceNames(state, deviceNames) {
    state.syncServerDeviceNames = deviceNames
  },
}

export default { state, getters, actions, mutations }
