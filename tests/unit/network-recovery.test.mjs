import assert from 'node:assert/strict'
import test from 'node:test'
import { createNetworkRecovery } from '../../src/renderer/helpers/networkRecovery.js'

const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve() }
function setup(t, online = true) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const events = new EventTarget()
  const states = []
  const recovery = createNetworkRecovery({ eventTarget: events, isOnline: () => online, onChange: state => states.push(state) })
  t.after(() => recovery.dispose())
  return { recovery, states, connect(value) { online = value; events.dispatchEvent(new Event(value ? 'online' : 'offline')) } }
}

test('all callers wait offline and one request per origin verifies recovery before the queue resumes', async t => {
  const { recovery, states, connect } = setup(t, false)
  let calls = 0
  const requests = Array.from({ length: 20 }, () => recovery.run('https://www.youtube.com', async () => { calls++; return 'ok' }))
  await flush()
  assert.equal(calls, 0)
  assert.equal(states.at(-1), 'offline')
  connect(true)
  assert.deepEqual(await Promise.all(requests), Array(20).fill('ok'))
  assert.equal(states.at(-1), 'restored')
  t.mock.timers.tick(3000)
  assert.equal(states.at(-1), 'online')
})

test('a stalled route pauses concurrent requests, probes with backoff, and resumes after a real response', async t => {
  const { recovery, states } = setup(t)
  let fail = true
  let calls = 0
  const task = async () => { calls++; if (fail) throw new TypeError('Failed to fetch'); return 42 }
  const first = recovery.run('https://www.youtube.com', task)
  await flush()
  const second = recovery.run('https://www.youtube.com', task)
  await flush()
  assert.equal(calls, 1)
  assert.equal(states.at(-1), 'offline')
  t.mock.timers.tick(5000)
  await flush()
  assert.equal(calls, 2)
  fail = false
  t.mock.timers.tick(10000)
  await flush()
  assert.deepEqual(await Promise.all([first, second]), [42, 42])
  assert.equal(states.at(-1), 'restored')
})

test('an unavailable optional host does not block other services or mistake their responses for its recovery', async t => {
  const { recovery, states } = setup(t)
  const controller = new AbortController()
  const failed = recovery.run('https://optional.example', async () => { throw new TypeError('Failed to fetch') }, { signal: controller.signal })
  const rejected = assert.rejects(failed, { name: 'AbortError' })
  await flush()
  assert.equal(await recovery.run('https://www.youtube.com', async () => 'ok'), 'ok')
  assert.equal(states.at(-1), 'offline')
  controller.abort()
  await rejected
})

test('cancelling the probe releases other callers and does not retry a cancelled request', async t => {
  const { recovery, connect } = setup(t, false)
  const controller = new AbortController()
  let cancelledCalls = 0
  const first = recovery.run('https://www.youtube.com', async () => { cancelledCalls++ }, { signal: controller.signal })
  const rejected = assert.rejects(first, { name: 'AbortError' })
  const second = recovery.run('https://www.youtube.com', async () => 'ok')
  controller.abort()
  await rejected
  connect(true)
  assert.equal(await second, 'ok')
  assert.equal(cancelledCalls, 0)
})

for (const error of [Object.assign(new Error('HTTP 404'), { status: 404 }), new SyntaxError('Invalid JSON'), Object.assign(new Error('certificate'), { code: 'SSLHandshakeException' })]) {
  test(`${error.message} is not retried as an outage`, async t => {
    const { recovery, states } = setup(t)
    await assert.rejects(recovery.run('https://www.youtube.com', async () => { throw error }), error)
    assert.deepEqual(states, ['online'])
  })
}

test('non-idempotent operations wait offline but are never automatically replayed', async t => {
  const { recovery, connect, states } = setup(t, false)
  let calls = 0
  const pending = recovery.run('https://example.com', async () => { calls++; throw new TypeError('Failed to fetch') }, { retry: false })
  const rejected = assert.rejects(pending, { message: 'Failed to fetch' })
  await flush()
  assert.equal(calls, 0)
  connect(true)
  await rejected
  t.mock.timers.tick(60000)
  await flush()
  assert.equal(calls, 1)
  assert.equal(states.includes('restored'), false, 'a failed write is not proof of recovery')
})

async function loadAppNetwork(t, fetch, nativeRequest, options = {}) {
  const { readFile } = await import('node:fs/promises')
  const { default: vm } = await import('node:vm')
  const { classifyRequestFailure } = await import('../../src/renderer/helpers/api/requestDiagnostics.js')
  const { createAbortError } = await import('../../src/renderer/helpers/api/requestErrors.js')
  const window = new EventTarget()
  window.fetch = fetch
  const context = vm.createContext({
    options, window, navigator: { onLine: true }, location: { href: 'https://localhost/', origin: 'https://localhost' },
    classifyRequestFailure, createAbortError, CapacitorHttp: { request: nativeRequest },
    AbortController, AbortSignal, DOMException, EventTarget, CustomEvent, Request, Response, Headers, URL, URLSearchParams, setTimeout, clearTimeout,
  })
  for (const file of ['networkRecovery.js', 'api/capacitor-http.js']) {
    const source = (await readFile(new URL(`../../src/renderer/helpers/${file}`, import.meta.url), 'utf8'))
      .replace(/^import .* from .*\n/gm, '').replace(/^export /gm, '')
    vm.runInContext(source, context)
  }
  vm.runInContext('installNetworkFetch({ verifyConnection: verifyCapacitorConnection, ...options }); globalThis.nativeFetch = capacitorHttpFetch; globalThis.recovery = appRecovery;', context)
  t.after(() => context.recovery.dispose())
  return context
}

test('native API and WebView requests share recovery, including an unreported route outage', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let fail = true
  let nativeCalls = 0
  let webCalls = 0
  const app = await loadAppNetwork(t,
    async () => { webCalls++; return new Response('web') },
    async () => {
      nativeCalls++
      if (fail) throw Object.assign(new Error('Read timed out'), { code: 'SocketTimeoutException' })
      return { status: 200, data: 'native', headers: {} }
    })
  const native = app.nativeFetch('https://www.youtube.com/feeds/videos.xml')
  await flush()
  const web = app.window.fetch('https://www.youtube.com/oembed')
  await flush()
  assert.equal(webCalls, 0)
  assert.equal(app.recovery.state, 'offline')
  fail = false
  t.mock.timers.tick(5000)
  await flush()
  assert.equal(await (await native).text(), 'native')
  assert.equal(await (await web).text(), 'web')
  assert.equal(nativeCalls, 2)
  assert.equal(app.recovery.state, 'restored')
})

test('a browser CORS failure does not enter endless recovery when native HTTP reaches the server', async t => {
  const app = await loadAppNetwork(t,
    async () => { throw new TypeError('Failed to fetch') },
    async () => ({ status: 404, data: '', headers: {} }))
  await assert.rejects(app.window.fetch('https://www.youtube.com/oembed'), { message: 'Failed to fetch' })
  assert.equal(app.recovery.state, 'online')
})

test('the connection timeout stops after headers and does not abort streaming video bodies', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let signal
  const app = await loadAppNetwork(t, async (input, init) => { signal = init.signal; return new Response('media') })
  const response = await app.window.fetch('https://media.example/video')
  t.mock.timers.tick(60000)
  assert.equal(signal.aborted, false)
  assert.equal(await response.text(), 'media')
})

test('Electron route failures recover while the OS still reports online', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let fail = true
  const app = await loadAppNetwork(t, async () => {
    if (fail) throw new TypeError('Failed to fetch')
    return new Response('recovered')
  }, undefined, { corsDisabled: true, verifyConnection: undefined })
  const pending = app.window.fetch('https://www.youtube.com/feeds/videos.xml')
  await flush()
  assert.equal(app.recovery.state, 'offline')
  fail = false
  t.mock.timers.tick(5000)
  assert.equal(await (await pending).text(), 'recovered')
  assert.equal(app.recovery.state, 'restored')
})

test('delegated subscription transport retains browser CORS classification', async t => {
  const app = await loadAppNetwork(t, async () => { throw new TypeError('Failed to fetch') }, undefined, { verifyConnection: undefined })
  const controller = new AbortController()
  const release = app.recovery.delegateRequests(controller.signal)
  t.after(release)
  const error = await app.window.fetch('https://invidious.example/feed/channel/test', { signal: controller.signal }).catch(error => error)
  const { default: vm } = await import('node:vm')
  app.requestError = error
  assert.equal(vm.runInContext('isRecoverableNetworkError(requestError)', app), false)
  assert.equal(app.recovery.state, 'online')
})

for (const transport of ['native', 'browser']) {
  test(`${transport} fetch rejects malformed URLs asynchronously`, async t => {
    const unexpectedRequest = () => assert.fail('malformed input must not reach the transport')
    const app = await loadAppNetwork(t, unexpectedRequest, unexpectedRequest)
    const fetch = transport === 'native' ? app.nativeFetch : app.window.fetch
    let pending
    assert.doesNotThrow(() => { pending = fetch('https://[') })
    assert.equal(typeof pending.catch, 'function')
    await assert.rejects(pending, { name: 'TypeError' })
  })
}
