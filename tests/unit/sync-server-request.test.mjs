import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { setImmediate as nextEventLoopTurn } from 'node:timers/promises'

import { withNetworkRecovery } from '../../src/renderer/helpers/networkRecovery.js'
import { applySyncServerUserAgent } from '../../src/syncServerUserAgent.js'
import { createSyncServerRequestHeaders } from '../../src/renderer/helpers/sync-server-request.js'
import * as errors from '../../src/renderer/helpers/sync-server-errors.js'
import { createAbortError } from '../../src/renderer/helpers/api/requestErrors.js'

async function loadClient(env, version, requests, nativeRequest) {
  const context = vm.createContext({
    ...errors,
    withNetworkRecovery,
    process: { env },
    packageDetails: { version },
    createSyncServerRequestHeaders,
    applySyncServerUserAgent,
    createAbortError,
    URL, URLSearchParams, Request, Response, Headers, AbortController, setTimeout, clearTimeout,
    CapacitorHttp: {
      request: async options => {
        requests.push(options)
        if (nativeRequest) return nativeRequest(options)
        return { status: 200, data: '{}', headers: {} }
      },
    },
    fetch: async (url, options) => {
      requests.push({ url, ...options })
      return new Response('{}')
    },
  })
  for (const file of ['api/capacitor-http.js', 'sync-server.js']) {
    const source = (await readFile(new URL(`../../src/renderer/helpers/${file}`, import.meta.url), 'utf8'))
      .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
      .replace(/^export \{[\s\S]*?\}\n/gm, '')
      .replace(/^export /gm, '')
    vm.runInContext(source, context)
  }
  return vm.runInContext('new SyncServerClient("https://sync.example")', context)
}

for (const [operation, run] of [
  ['manifest', client => client.getEncryptedSyncManifest()],
  ['collection download', client => client.getEncryptedSyncCollection('history')],
  ['legacy download', client => client.getLegacyEncryptedSync()],
  ['large collection upload', client => client.putEncryptedSyncCollection('history', 1, 'a'.repeat(4 * 1024 * 1024))],
]) {
  test(`Android encrypted sync ${operation} can take longer than 30 seconds`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const client = await loadClient({ IS_CAPACITOR: true }, '0.34.0', [], options => new Promise((resolve, reject) => {
      const responseTimer = setTimeout(() => {
        clearTimeout(timeoutTimer)
        resolve({ status: 200, data: '{"revision":2}', headers: {} })
      }, 31_000)
      const timeoutTimer = setTimeout(() => {
        clearTimeout(responseTimer)
        reject(Object.assign(new Error('timeout'), { code: 'SocketTimeoutException' }))
      }, options.readTimeout)
    }))
    const result = run(client)
    const completed = assert.doesNotReject(async () => {
      assert.equal((await result).revision, 2)
    })
    await nextEventLoopTurn()
    t.mock.timers.tick(31_000)
    await completed
  })
}

for (const [operation, run, timeoutMs] of [
  ['health check', client => client.health(), 20_000],
  ['collection download', client => client.getEncryptedSyncCollection('history'), 300_000],
  ['small collection upload', client => client.putEncryptedSyncCollection('history', 1, 'encrypted'), 20_000],
  ['large collection upload', client => client.putEncryptedSyncCollection('history', 1, 'a'.repeat(4 * 1024 * 1024)), 47_000],
]) {
  test(`Android sync ${operation} still stops at its request deadline`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const requests = []
    const client = await loadClient({ IS_CAPACITOR: true }, '0.34.0', requests, () => new Promise(() => {}))
    let settled = false
    const result = run(client).finally(() => { settled = true })
    const rejected = assert.rejects(result, { message: 'Sync server request timed out' })
    await nextEventLoopTurn()
    assert.equal(requests[0].connectTimeout, timeoutMs)
    assert.equal(requests[0].readTimeout, timeoutMs)
    t.mock.timers.tick(timeoutMs - 1)
    await nextEventLoopTurn()
    assert.equal(settled, false)
    t.mock.timers.tick(1)
    await rejected
    assert.equal(client.requestControllers.size, 0)
  })
}

test('Android encrypted sync can be cancelled before the extended deadline', async () => {
  const client = await loadClient({ IS_CAPACITOR: true }, '0.34.0', [], () => new Promise(() => {}))
  const result = client.getEncryptedSyncCollection('history')
  const rejected = assert.rejects(result, errors.SyncServerCancelledError)
  await nextEventLoopTurn()
  client.cancel()
  await rejected
  assert.equal(client.requestControllers.size, 0)
})

for (const version of ['0.34.0', '0.34.0-nightly-976']) {
  test(`Android sync sends ${version} through native HTTP on public and authenticated requests`, async () => {
    const requests = []
    const client = await loadClient({ IS_CAPACITOR: true, IS_ELECTRON: false }, version, requests)
    await client.health()
    client.token = 'sync-token'
    await client.request('/subscriptions', { method: 'POST', body: { id: 'channel' } })

    assert.equal(requests.length, 2)
    for (const request of requests) {
      const headers = new Headers(request.headers)
      assert.equal(headers.get('User-Agent'), `OpenTubeX/${version}`)
      assert.equal(headers.has('OpenTubeX-Client-Version'), false)
      assert.equal(headers.get('Accept'), 'application/json')
    }
    assert.equal(new Headers(requests[0].headers).has('Authorization'), false)
    assert.equal(new Headers(requests[1].headers).get('Authorization'), 'sync-token')
    assert.equal(new Headers(requests[1].headers).get('Content-Type'), 'application/json')
    assert.equal(requests[1].data, '{"id":"channel"}')
  })
}

test('browser sync does not send native app version headers', async () => {
  const requests = []
  const client = await loadClient({ IS_CAPACITOR: false, IS_ELECTRON: false }, '0.34.0', requests)
  await client.health()

  const headers = new Headers(requests[0].headers)
  assert.equal(Object.hasOwn(requests[0], 'nativeTimeoutMs'), false)
  assert.equal(headers.has('User-Agent'), false)
  assert.equal(headers.has('OpenTubeX-Client-Version'), false)
})

test('Electron sync retains its version marker for the main process', async () => {
  const requests = []
  const client = await loadClient({ IS_CAPACITOR: false, IS_ELECTRON: true }, '0.34.0', requests)
  await client.health()

  const headers = new Headers(requests[0].headers)
  assert.equal(Object.hasOwn(requests[0], 'nativeTimeoutMs'), false)
  assert.equal(headers.get('OpenTubeX-Client-Version'), '0.34.0')
  assert.equal(headers.has('User-Agent'), false)
})

test('unauthenticated sync requests expose the unchanged version through the user agent', () => {
  const requestHeaders = createSyncServerRequestHeaders({
    headers: { 'X-Request-Context': 'health-check' },
    version: '0.32.0-beta',
  })
  const headers = new Headers(applySyncServerUserAgent(Object.fromEntries(requestHeaders)))

  assert.equal(headers.get('Accept'), 'application/json')
  assert.equal(headers.get('User-Agent'), 'OpenTubeX/0.32.0-beta')
  assert.equal(headers.get('X-Request-Context'), 'health-check')
  assert.equal(headers.has('Authorization'), false)
  assert.equal(headers.has('OpenTubeX-Client-Version'), false)
})

test('authenticated sync requests retain authentication, content type, and caller headers', () => {
  const requestHeaders = createSyncServerRequestHeaders({
    hasBody: true,
    headers: new Headers({
      Accept: 'application/vnd.sync+json',
      'X-Request-Context': 'encrypted-sync',
    }),
    token: 'sync-token',
    version: '0.32.0-nightly-976',
  })
  const headers = new Headers(applySyncServerUserAgent(Object.fromEntries(requestHeaders)))

  assert.equal(headers.get('Accept'), 'application/vnd.sync+json')
  assert.equal(headers.get('Authorization'), 'sync-token')
  assert.equal(headers.get('Content-Type'), 'application/json')
  assert.equal(headers.get('User-Agent'), 'OpenTubeX/0.32.0-nightly-976')
  assert.equal(headers.get('X-Request-Context'), 'encrypted-sync')
  assert.equal(headers.has('OpenTubeX-Client-Version'), false)
})

test('browser sync requests do not add the Electron-only version marker', () => {
  const headers = createSyncServerRequestHeaders({ version: '' })

  assert.equal(headers.get('Accept'), 'application/json')
  assert.equal(headers.has('OpenTubeX-Client-Version'), false)
})
