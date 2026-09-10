import assert from 'node:assert/strict'
import test from 'node:test'
import { createInternetConnectivity, createInternetProbe, INTERNET_CHECK_URL } from '../../src/renderer/helpers/internetConnectivity.js'

const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve() }

test('the sole GrapheneOS probe is header-only and sends no credentials, cache, or referrer', async () => {
  const requests = []
  const probe = createInternetProbe(async (url, init) => {
    requests.push({ url, init })
    return new Response(null, { status: 204 })
  })
  assert.equal(await probe(new AbortController().signal), true)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, 'https://connectivitycheck.grapheneos.network/generate_204')
  assert.equal(requests[0].init.method, 'HEAD')
  assert.equal(requests[0].init.credentials, 'omit')
  assert.equal(requests[0].init.cache, 'no-store')
  assert.equal(requests[0].init.referrerPolicy, 'no-referrer')
  assert.equal(requests[0].init.redirect, 'follow')
})

test('a stalled check times out after five seconds without contacting another provider', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let requests = 0
  const probe = createInternetProbe(async (url, { signal }) => {
    assert.equal(url, INTERNET_CHECK_URL)
    requests++
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)))
  })
  const pending = probe(new AbortController().signal)
  t.mock.timers.tick(5000)
  assert.equal(await pending, false)
  assert.equal(requests, 1)
})

test('a failed endpoint reports no internet; opaque WebView replies still prove reachability', async () => {
  assert.equal(await createInternetProbe(async () => { throw new TypeError('Failed to fetch') })(new AbortController().signal), false)
  assert.equal(await createInternetProbe(async () => ({ type: 'opaque', status: 0 }))(new AbortController().signal), true)
})

test('cancellation stops the current request', async () => {
  const controller = new AbortController()
  const probe = createInternetProbe(async (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))))
  const pending = probe(controller.signal)
  controller.abort()
  assert.equal(await pending, false)
})

test('airplane mode cancels checks, ignores stale results, and does not poll until the OS reconnects', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const events = new EventTarget()
  let hardwareOnline = false
  let resolveProbe
  let signal
  let calls = 0
  const monitor = createInternetConnectivity({ eventTarget: events, isOnline: () => hardwareOnline,
    probe: inputSignal => { calls++; signal = inputSignal; return new Promise(resolve => { resolveProbe = resolve }) } })
  t.after(() => monitor.dispose())
  assert.equal(await monitor.ready, false)
  t.mock.timers.tick(3600000)
  assert.equal(calls, 0)
  hardwareOnline = true
  events.dispatchEvent(new Event('online'))
  await flush()
  assert.equal(calls, 1)
  assert.equal(monitor.online, false, 'a network link alone does not announce restored internet')
  hardwareOnline = false
  events.dispatchEvent(new Event('offline'))
  assert.equal(signal.aborted, true)
  resolveProbe(true)
  await flush()
  assert.equal(monitor.online, false)
  t.mock.timers.tick(3600000)
  assert.equal(calls, 1)
})

test('concurrent checks share one probe and outage polling backs off to a minute', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  const monitor = createInternetConnectivity({ eventTarget: new EventTarget(), isOnline: () => true,
    probe: async () => { calls++; return false } })
  t.after(() => monitor.dispose())
  await Promise.all(Array.from({ length: 30 }, () => monitor.check()))
  assert.equal(calls, 1)
  for (const delay of [5000, 10000, 20000, 40000, 60000, 60000]) {
    t.mock.timers.tick(delay - 1)
    await flush()
    const previous = calls
    t.mock.timers.tick(1)
    await flush()
    assert.equal(calls, previous + 1)
  }
  monitor.dispose()
  const previous = calls
  t.mock.timers.tick(3600000)
  await flush()
  assert.equal(calls, previous)
})

test('opt-out stops active and scheduled checks and keeps OS connectivity events working', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  let signal
  let complete
  let online = true
  const events = new EventTarget()
  const monitor = createInternetConnectivity({ eventTarget: events, isOnline: () => online, enabled: false,
    probe: inputSignal => { calls++; signal = inputSignal; return new Promise(resolve => { complete = resolve }) } })
  t.after(() => monitor.dispose())
  await monitor.check()
  t.mock.timers.tick(3600000)
  assert.equal(calls, 0)
  monitor.setEnabled(true)
  await flush()
  assert.equal(calls, 1)
  monitor.setEnabled(false)
  assert.equal(signal.aborted, true)
  complete(false)
  await flush()
  assert.equal(monitor.online, true, 'a stale probe cannot override the opt-out')
  online = false
  events.dispatchEvent(new Event('offline'))
  assert.equal(monitor.online, false)
  online = true
  events.dispatchEvent(new Event('online'))
  assert.equal(monitor.online, true)
  t.mock.timers.tick(3600000)
  await flush()
  assert.equal(calls, 1)
  monitor.setEnabled(true)
  await flush()
  assert.equal(calls, 2)
  complete(true)
})

test('healthy connections stay idle and app resume checks reachability again', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  let visible = true
  const visibilityTarget = new EventTarget()
  const monitor = createInternetConnectivity({ eventTarget: new EventTarget(), isOnline: () => true,
    visibilityTarget, isVisible: () => visible, probe: async () => { calls++; return true } })
  t.after(() => monitor.dispose())
  await monitor.ready
  t.mock.timers.tick(3600000)
  await flush()
  assert.equal(calls, 1, 'healthy connections must not poll')
  visible = false
  visibilityTarget.dispatchEvent(new Event('visibilitychange'))
  await flush()
  assert.equal(calls, 1)
  visible = true
  visibilityTarget.dispatchEvent(new Event('visibilitychange'))
  await flush()
  assert.equal(calls, 2)
  monitor.setEnabled(false)
  visibilityTarget.dispatchEvent(new Event('visibilitychange'))
  await flush()
  assert.equal(calls, 2, 'resume must honor the privacy opt-out')
  monitor.dispose()
  visibilityTarget.dispatchEvent(new Event('visibilitychange'))
  await flush()
  assert.equal(calls, 2)
})
