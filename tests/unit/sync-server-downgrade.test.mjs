import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import { encryptLegacyDocument } from '../helpers/encrypt-legacy-sync-document.mjs'
import { CUSTOM_THEMES_SYNC_KEY, normalizeCustomThemes } from '../../src/customTheme.js'
import { mergeSettingEntry, resolveMergedThemeEntry } from '../../src/renderer/helpers/sync-settings-conflict.js'

import * as errors from '../../src/renderer/helpers/sync-server-errors.js'
import * as privacy from '../../src/renderer/helpers/sync-server-privacy.js'
import { isRecentSync } from '../../src/renderer/helpers/sync-server-scheduling.js'
import { createSyncServerRequestHeaders } from '../../src/renderer/helpers/sync-server-request.js'
import { mergeSubscriptionSeenVideos } from '../../src/subscriptionSeenVideos.js'
import { syncSubscriptionSeenVideos } from '../../src/renderer/helpers/subscription-seen-videos.js'

// These modules use webpack imports. Keep their actual request, merge, and store
// code while replacing platform dependencies and the network with local fixtures.
function withoutImports (source) {
  return source.replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
    .replace(/^export \{[\s\S]*?\}\n/gm, '')
    .replace(/^export (?=(async )?(function|class|const))/gm, '')
}

const helperSource = await readFile(new URL('../../src/renderer/helpers/sync-server.js', import.meta.url), 'utf8')
const storeSource = await readFile(new URL('../../src/renderer/store/modules/sync-server.js', import.meta.url), 'utf8')

function fixture (overrides = {}, { encrypted = false, respond } = {}) {
  const requests = []
  const commits = []
  const settings = {
    syncServerEnabled: true,
    syncServerUrl: 'https://sync.example',
    syncServerUsername: 'alice',
    syncServerToken: 'saved-token',
    syncServerPrivacyMode: 'enhanced',
    syncServerPrivacyKey: Buffer.alloc(32, 1).toString('base64'),
    syncServerPrivacySalt: Buffer.alloc(16, 2).toString('base64'),
    syncServerSnapshot: '{}',
    syncServerAutoSync: true,
    syncServerSyncSubscriptions: true,
    ...overrides,
  }
  const common = {
    ...errors,
    ...privacy,
    syncSubscriptionSeenVideos,
    isRecentSync,
    crypto,
    URL,
    Headers,
    Response,
    AbortController,
    setTimeout,
    clearTimeout,
    structuredClone,
    TextEncoder,
    TextDecoder,
    process: { env: {} },
    packageDetails: { version: 'test' },
    MAIN_PROFILE_ID: 'main',
    deepCopy: structuredClone,
    createSyncServerRequestHeaders,
    CUSTOM_THEMES_SYNC_KEY,
    normalizeCustomThemes,
    mergeSettingEntry,
    resolveMergedThemeEntry,
    getSyncableSettingKeys: () => ['channelPlaybackSpeeds'],
    isSettingSyncEnabled: (settings, key) => !settings.syncServerSettingsExcluded?.includes(key),
    fetch: async (url, options) => {
      requests.push({ url, method: options.method ?? 'GET', body: options.body })
      if (respond) {
        const response = await respond(url, options)
        if (response instanceof Response) return response
        if (response !== undefined) return new Response(JSON.stringify(response))
      }
      let result = null
      if (url.endsWith('/health')) result = encrypted ? { capabilities: { encrypted_sync: 1 } } : 'OK'
      else if (url.endsWith('/account/login') || url.endsWith('/account/register')) result = { jwt: 'new-token' }
      else if (url.endsWith('/encrypted_sync')) result = { collections: [], legacy_data: false }
      else if (url.includes('/encrypted_sync/')) result = { revision: 0, payload: null }
      else if (url.endsWith('/subscriptions/') && !options.method) result = []
      return new Response(JSON.stringify(result))
    },
  }
  const helper = vm.createContext({ ...common })
  vm.runInContext(withoutImports(helperSource) + '\nglobalThis.exports = { SyncServerClient, syncSubscriptions, syncSettings, syncHistory, normalizeSyncServerUrl };', helper)
  const store = vm.createContext({ ...common, ...helper.exports, getSavedOtherDeviceSessions: () => [] })
  vm.runInContext(withoutImports(storeSource).replace('export default { state, getters, actions, mutations }', 'globalThis.exports = { state, actions, mutations }'), store)
  const context = {
    rootState: {
      settings,
      history: { historyCacheSorted: [] },
      utils: { customThemes: [] },
      profiles: { profileList: [{ _id: 'main', subscriptions: [{ id: 'private-channel', name: 'Private subscription' }] }] },
    },
    rootGetters: {},
    state: store.exports.state,
    commit: (action, value) => {
      commits.push([action, value])
      store.exports.mutations[action]?.(store.exports.state, value)
    },
    dispatch: async (action, value) => {
      if (action === 'mergeSubscriptionSeenVideos') {
        settings.subscriptionSeenVideos = JSON.stringify(mergeSubscriptionSeenVideos(settings.subscriptionSeenVideos, value))
      }
      if (action.startsWith('updateSyncServer')) {
        const key = action.slice(6)
        settings[key[0].toLowerCase() + key.slice(1)] = value
      }
      if (action === 'updateChannelPlaybackSpeeds') settings.channelPlaybackSpeeds = value
      if (action === 'replaceSyncServerToken') settings.syncServerToken = value
      if (action === 'syncWithSyncServer') return store.exports.actions.syncWithSyncServer(context, value)
    },
  }
  return { settings, requests, commits, context, actions: store.exports.actions, Client: helper.exports.SyncServerClient }
}

for (const [method, args, path, verb] of [
  ['authenticate', ['login', 'alice', 'password'], '/account/login', 'POST'],
  ['authenticate', ['register', 'alice', 'password'], '/account/register', 'POST'],
  ['deleteAccount', ['password'], '/account/delete', 'DELETE'],
  ['getAccountSessions', [], '/account/sessions', 'GET'],
  ['updateAccountSession', ['device/id', 'encrypted'], '/account/sessions/device%2Fid', 'PATCH'],
  ['revokeAccountSession', ['device/id'], '/account/sessions/device%2Fid', 'DELETE'],
  ['changePassword', ['old', 'new'], '/account/password', 'PUT'],
]) {
  test(`${verb} ${path} preserves v1 errors without trying an unversioned alias`, async () => {
    const f = fixture({}, {
      respond: () => new Response('Resource missing', { status: 404 }),
    })
    const client = new f.Client('https://sync.example', 'saved-token')
    await assert.rejects(client[method](...args), error =>
      error.status === 404 && error.message === 'Resource missing')
    assert.deepEqual(f.requests.map(({ url, method }) => [url, method]), [
      [`https://sync.example/v1${path}`, verb],
    ])
  })

  test(`${verb} ${path} stays on v1 after legacy API prefix discovery`, async () => {
    const f = fixture()
    const client = new f.Client('https://sync.example', 'saved-token')
    client.apiPrefix = ''
    await client[method](...args)
    assert.equal(f.requests[0].url, `https://sync.example/v1${path}`)
  })
}

for (const historyEnabled of [false, true]) {
  for (const supported of [false, true]) {
    test(`seen videos sync requires history enabled=${historyEnabled} and server support=${supported}`, async () => {
      const f = fixture({
        syncServerSyncHistory: historyEnabled,
        subscriptionSeenVideos: JSON.stringify([{ videoId: 'private-seen-video', seenAt: 1000 }]),
      }, {
        encrypted: true,
        respond: url => url.endsWith('/health')
          ? { capabilities: { encrypted_sync: 1, seen_videos: supported ? 1 : 0 } }
          : undefined,
      })
      await f.actions.syncWithSyncServer(f.context)
      assert.equal(f.context.state.syncServerStatus, 'success')
      const seenRequests = f.requests.filter(request => request.url.endsWith('/encrypted_sync/seenVideos'))
      assert.equal(seenRequests.length, historyEnabled && supported ? 2 : 0)
      if (seenRequests.length > 0) {
        const upload = seenRequests.find(request => request.method === 'PUT')
        assert.ok(!upload.body.includes('private-seen-video'))
        const entries = await privacy.decryptSyncDocument(JSON.parse(upload.body).payload, f.settings.syncServerPrivacyKey)
        assert.equal(entries[0].videoId, 'private-seen-video')
      }
    })
  }
}

test('seen-video upload conflicts retain marks added by both devices', async () => {
  const key = Buffer.alloc(32, 1).toString('base64')
  const salt = Buffer.alloc(16, 2).toString('base64')
  const remote = await privacy.encryptSyncDocument([{ videoId: 'other-device', seenAt: 2000 }], key, salt)
  let uploads = 0
  const f = fixture({
    syncServerSyncHistory: true,
    subscriptionSeenVideos: JSON.stringify([{ videoId: 'local-device', seenAt: 1000 }]),
  }, {
    encrypted: true,
    respond(url, options) {
      if (url.endsWith('/health')) return { capabilities: { encrypted_sync: 1, seen_videos: 1 } }
      if (!url.endsWith('/encrypted_sync/seenVideos')) return
      if (options.method === 'PUT' && ++uploads === 1) return new Response('{}', { status: 409 })
      if (!options.method && uploads > 0) return { revision: 1, payload: remote }
    },
  })
  await f.actions.syncWithSyncServer(f.context)
  assert.equal(f.context.state.syncServerStatus, 'success')
  const upload = f.requests.filter(request => request.method === 'PUT' && request.url.endsWith('/seenVideos')).at(-1)
  const entries = await privacy.decryptSyncDocument(JSON.parse(upload.body).payload, key)
  assert.deepEqual(entries.map(entry => entry.videoId), ['local-device', 'other-device'])
  assert.equal(uploads, 2)
})

for (const overrides of [
  {},
  { syncServerPrivacyKey: '' },
  { syncServerPrivacyMode: 'legacy' },
]) {
  test(`startup refuses a capability downgrade with ${JSON.stringify(overrides)}`, async () => {
    const f = fixture(overrides)
    const saved = { ...f.settings }
    await f.actions.initializeSyncServer(f.context)
    assert.deepEqual(f.settings, saved)
    assert.equal(f.requests.length, 1)
    assert.ok(f.context.state.syncServerError.includes('encrypted sync'))
  })
}

test('legacy clients still upload subscriptions to legacy servers', async () => {
  const f = fixture({ syncServerPrivacyMode: 'legacy', syncServerPrivacyKey: '' })
  await f.actions.initializeSyncServer(f.context)
  assert.equal(f.settings.syncServerPrivacyMode, 'legacy')
  assert.ok(f.requests.some(request => request.method === 'PUT' && request.url.endsWith('/subscriptions/') && request.body.includes('Private subscription')))
})

test('encrypted accounts still sync when the server supports encryption', async () => {
  const f = fixture({}, { encrypted: true })
  await f.actions.initializeSyncServer(f.context)
  assert.equal(f.settings.syncServerPrivacyMode, 'enhanced')
  const uploads = f.requests.filter(request => request.method === 'PUT')
  assert.equal(uploads.length, 1)
  assert.ok(uploads[0].url.endsWith('/encrypted_sync/subscriptions'))
  const document = await privacy.decryptSyncDocument(
    JSON.parse(uploads[0].body).payload,
    f.settings.syncServerPrivacyKey
  )
  assert.equal(document[0].name, 'Private subscription')
})

test('manual sync uses encryption when a saved key survives an earlier downgrade', async () => {
  const f = fixture({ syncServerPrivacyMode: 'legacy' }, { encrypted: true })
  await f.actions.syncWithSyncServer(f.context)
  const uploads = f.requests.filter(request => request.method === 'PUT')
  assert.equal(uploads.length, 1)
  assert.ok(uploads[0].url.endsWith('/encrypted_sync/subscriptions'))
  assert.ok(!uploads[0].body.includes('Private subscription'))
})

const credentials = {
  mode: 'login',
  serverUrl: 'https://sync.example',
  username: 'alice',
  password: 'account-password',
  deviceId: 'device',
  deviceName: 'Laptop',
  deviceSystemInfo: { platform: 'linux' },
}

test('reauthentication cannot downgrade the same encrypted account', async () => {
  const f = fixture()
  const saved = { ...f.settings }
  await assert.rejects(f.actions.authenticateSyncServer(f.context, credentials), /encrypted sync/)
  assert.deepEqual(f.settings, saved)
  assert.ok(!f.requests.some(request => request.url.endsWith('/account/login')))
})

test('a supplied privacy passphrase cannot silently select plaintext login', async () => {
  const f = fixture({ syncServerPrivacyMode: 'unknown', syncServerPrivacyKey: '' })
  await assert.rejects(f.actions.authenticateSyncServer(f.context, {
    ...credentials, privacyPassphrase: 'privacy-passphrase',
  }), /encrypted sync/)
  assert.ok(!f.requests.some(request => request.url.endsWith('/account/login')))
})

test('connecting a different legacy account does not inherit the previous account encryption requirement', async () => {
  const f = fixture()
  await f.actions.authenticateSyncServer(f.context, { ...credentials, username: 'bob' })
  assert.equal(f.settings.syncServerPrivacyMode, 'legacy')
  assert.equal(f.settings.syncServerPrivacyKey, '')
  assert.equal(f.settings.syncServerUsername, 'bob')
  assert.ok(f.requests.some(request => request.url.endsWith('/account/login')))
})

for (const source of ['plaintext', 'single document', 'collection']) {
  test(`migrates ${source} playback speeds into settings without recreating the deleted collection`, async () => {
    const collections = new Map()
    const speeds = [{ channel_id: 'legacy-channel', playback_speed: 1.5 }]
    // Retain the legacy migration flag on subsequent runs, as an older server
    // does when playbackSpeeds is missing or plaintext data remains.
    const f = fixture({
      syncServerSyncSettings: true,
      channelPlaybackSpeeds: JSON.stringify({ 'local-channel': 2 }),
    }, {
      encrypted: true,
      respond: (url, options) => {
        const path = new URL(url).pathname
        if (path === '/v1/encrypted_sync') {
          return {
            collections: [...collections].map(([collection, entry]) => ({ collection, revision: entry.revision })),
            legacy_data: source === 'plaintext',
            legacy_encrypted_data: source === 'single document',
          }
        }
        if (path === '/v1/encrypted_sync/legacy') return { revision: 1, payload: legacyPayload }
        if (path.startsWith('/v1/encrypted_sync/')) {
          const collection = path.split('/').at(-1)
          if (options.method === 'PUT') {
            const entry = JSON.parse(options.body)
            assert.equal(entry.revision, collections.get(collection)?.revision ?? 0)
            collections.set(collection, { revision: entry.revision + 1, payload: entry.payload })
          }
          return collections.get(collection) ?? { revision: 0, payload: null }
        }
        if (path === '/v1/channel_playback_speeds/') return speeds
        if (path.startsWith('/v1/')) return []
      },
    })
    const legacyPayload = await encryptLegacyDocument({
      ...privacy.createEmptySyncDocument(), playbackSpeeds: speeds,
    }, { key: f.settings.syncServerPrivacyKey, salt: f.settings.syncServerPrivacySalt })
    if (source === 'collection') {
      collections.set('playbackSpeeds', {
        revision: 1,
        payload: await privacy.encryptSyncDocument(speeds, f.settings.syncServerPrivacyKey, f.settings.syncServerPrivacySalt),
      })
    }

    const expected = { 'legacy-channel': 1.5, 'local-channel': 2 }
    for (let run = 0; run < 2; run++) {
      await f.actions.syncWithSyncServer(f.context)
      const manifests = f.requests.filter(request => new URL(request.url).pathname === '/v1/encrypted_sync')
      assert.equal(new URL(manifests.at(-1).url).searchParams.get('playback_speeds_in_settings'), run === 1 ? 'true' : null)
      assert.equal(f.context.state.syncServerError, '')
      assert.equal(f.requests.some(request => request.method === 'PUT' &&
        request.url.endsWith('/encrypted_sync/playbackSpeeds')), false)
      const settings = await privacy.decryptSyncDocument(
        collections.get('settings').payload, f.settings.syncServerPrivacyKey
      )
      assert.deepEqual(JSON.parse(settings.find(entry => entry.key === 'channelPlaybackSpeeds').value), expected)
      assert.deepEqual(JSON.parse(f.settings.channelPlaybackSpeeds), expected)
      if (run === 0) collections.delete('playbackSpeeds')
    }
    assert.equal(collections.has('playbackSpeeds'), false)
    assert.equal(f.requests.some(request => request.method === 'GET' &&
      request.url.endsWith('/encrypted_sync/playbackSpeeds')), source === 'collection')
  })
}

for (const overrides of [
  { syncServerSyncSettings: false },
  { syncServerSyncSettings: true, syncServerSettingsExcluded: ['channelPlaybackSpeeds'] },
]) {
  test(`does not acknowledge playback-speed migration with disabled sync: ${JSON.stringify(overrides)}`, async () => {
    const f = fixture({
      ...overrides,
      channelPlaybackSpeeds: '{}',
      syncServerSnapshot: JSON.stringify({ settings: { channelPlaybackSpeeds: { value: '{}', updatedAt: 1 } } }),
    }, { encrypted: true })
    await f.actions.syncWithSyncServer(f.context)
    assert.equal(f.context.state.syncServerError, '')
    assert.ok(f.requests.some(request => request.url.endsWith('/v1/encrypted_sync')))
    assert.equal(f.requests.some(request => request.url.includes('playback_speeds_in_settings')), false)
  })
}
