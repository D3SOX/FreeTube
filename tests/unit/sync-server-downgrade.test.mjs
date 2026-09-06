import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import * as errors from '../../src/renderer/helpers/sync-server-errors.js'
import * as privacy from '../../src/renderer/helpers/sync-server-privacy.js'
import { isRecentSync } from '../../src/renderer/helpers/sync-server-scheduling.js'
import { createSyncServerRequestHeaders } from '../../src/renderer/helpers/sync-server-request.js'

// These modules use webpack imports. Keep their actual request, merge, and store
// code while replacing platform dependencies and the network with local fixtures.
function withoutImports(source) {
  return source.replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
    .replace(/^export \{[\s\S]*?\}\n/gm, '')
    .replace(/^export (?=(async )?(function|class|const))/gm, '')
}

const helperSource = await readFile(new URL('../../src/renderer/helpers/sync-server.js', import.meta.url), 'utf8')
const storeSource = await readFile(new URL('../../src/renderer/store/modules/sync-server.js', import.meta.url), 'utf8')

function fixture(overrides = {}, { encrypted = false } = {}) {
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
    isRecentSync,
    crypto, URL, Headers, Response, AbortController, setTimeout, clearTimeout,
    structuredClone, TextEncoder, TextDecoder,
    process: { env: {} },
    packageDetails: { version: 'test' },
    MAIN_PROFILE_ID: 'main',
    deepCopy: structuredClone,
    createSyncServerRequestHeaders,
    fetch: async (url, options) => {
      requests.push({ url, method: options.method ?? 'GET', body: options.body })
      let result = null
      if (url.endsWith('/health')) result = encrypted ? { capabilities: { encrypted_sync: 1 } } : 'OK'
      else if (url.endsWith('/account/login')) result = { jwt: 'new-token' }
      else if (url.endsWith('/encrypted_sync')) result = { collections: [], legacy_data: false }
      else if (url.includes('/encrypted_sync/')) result = { revision: 0, payload: null }
      else if (url.endsWith('/subscriptions/') && !options.method) result = []
      return new Response(JSON.stringify(result))
    },
  }
  const helper = vm.createContext({ ...common })
  vm.runInContext(withoutImports(helperSource) + '\nglobalThis.exports = { SyncServerClient, syncSubscriptions, normalizeSyncServerUrl };', helper)
  const store = vm.createContext({ ...common, ...helper.exports, getSavedOtherDeviceSessions: () => [] })
  vm.runInContext(withoutImports(storeSource).replace('export default { state, getters, actions, mutations }', 'globalThis.exports = { state, actions, mutations }'), store)
  const context = {
    rootState: {
      settings,
      profiles: { profileList: [{ _id: 'main', subscriptions: [{ id: 'private-channel', name: 'Private subscription' }] }] },
    },
    rootGetters: {},
    state: store.exports.state,
    commit: (action, value) => {
      commits.push([action, value])
      store.exports.mutations[action]?.(store.exports.state, value)
    },
    dispatch: async (action, value) => {
      if (action.startsWith('updateSyncServer')) {
        const key = action.slice(6)
        settings[key[0].toLowerCase() + key.slice(1)] = value
      }
      if (action === 'replaceSyncServerToken') settings.syncServerToken = value
      if (action === 'syncWithSyncServer') return store.exports.actions.syncWithSyncServer(context, value)
    },
  }
  return { settings, requests, commits, context, actions: store.exports.actions }
}

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
  mode: 'login', serverUrl: 'https://sync.example', username: 'alice', password: 'account-password',
  deviceId: 'device', deviceName: 'Laptop', deviceSystemInfo: { platform: 'linux' },
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
