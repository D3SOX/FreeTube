import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import * as utils from 'googlevideo/utils'
import * as protos from 'googlevideo/protos'
import { CompositeBuffer, UmpReader, UmpWriter } from 'googlevideo/ump'
import * as protocol from '../../src/renderer/helpers/player/sabrProtocol.js'

const source = (await readFile(new URL('../../src/renderer/helpers/player/SabrSchemePlugin.js', import.meta.url), 'utf8'))
  .replace(/^import [\s\S]*? from ['"][^'"]+['"]\n/gm, '').replaceAll('export function ', 'function ')

class Operation {
  constructor(promise, abort = async () => {}) { this.promise = promise; this.abort = abort }
  static completed(value) { return new Operation(Promise.resolve(value)) }
  finally(callback) { this.promise.then(callback, callback) }
}
class ShakaError extends Error {
  static Severity = { RECOVERABLE: 1, CRITICAL: 2 }
  static Category = { NETWORK: 1 }
  static Code = { OPERATION_ABORTED: 7001, HTTP_ERROR: 1002 }
  constructor(severity, category, code) { super(String(code)); this.code = code }
}
const audioFormatId = { itag: 140, lastModified: '123' }
const videoFormatId = { itag: 137, lastModified: '456' }
const context = { audioFormatId, videoFormatId, bufferedRanges: [], drcEnabled: false,
  enableVoiceBoost: false, bandwidthEstimate: 2000000, playbackRate: 1.5, width: 640, height: 360 }
const sabrData = { url: 'https://example.test/sabr', scheme: 'sabr1', poToken: '', ustreamerConfig: '', clientInfo: {} }
const request = uri => ({ uris: [uri], retryParameters: { timeout: 1000 } })

function response(data, isInit = false, formatId = audioFormatId) {
  const buffer = new CompositeBuffer([])
  const writer = new UmpWriter(buffer)
  writer.write(protos.UMPPartId.MEDIA_HEADER, protos.MediaHeader.encode({
    headerId: 1, formatId, isInitSeg: isInit, sequenceNumber: 1,
  }).finish())
  writer.write(protos.UMPPartId.MEDIA, Uint8Array.of(1, ...data))
  writer.write(protos.UMPPartId.MEDIA_END, Uint8Array.of(1))
  return new Response(utils.concatenateChunks(buffer.chunks), { status: 200 })
}

function load(fetch, globals = {}) {
  const schemes = new Map()
  const api = vm.runInNewContext(`${source}\n({ createSabrTransport, setupSabrScheme })`, {
    ...utils, ...protos, ...protocol, CompositeBuffer, UmpReader,
    shaka: { util: { AbortableOperation: Operation, Error: ShakaError }, net: {
      NetworkingEngine: { registerScheme: (key, value) => schemes.set(key, value),
        unregisterScheme: key => schemes.delete(key) },
    } },
    fetch, process: { env: {} }, URL, AbortController, setTimeout, clearTimeout, console,
    ...globals,
  })
  return { ...api, schemes }
}

function policyResponse(backoffTimeMs) {
  const buffer = new CompositeBuffer([])
  new UmpWriter(buffer).write(protos.UMPPartId.NEXT_REQUEST_POLICY,
    protos.NextRequestPolicy.encode({ backoffTimeMs }).finish())
  return new Response(utils.concatenateChunks(buffer.chunks))
}

async function flushRequests() {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}

for (const coalesced of [false, true]) {
  test(`a completed segment does not apply a trailing backoff with ${coalesced ? 'coalesced' : 'separate'} network chunks`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
    const media = new Uint8Array(await response([1], true).arrayBuffer())
    const policy = new Uint8Array(await policyResponse(30000).arrayBuffer())
    const chunks = coalesced ? [utils.concatenateChunks([media, policy])] : [media, policy]
    const calls = []
    const waits = []
    const { createSabrTransport } = load(async () => {
      calls.push(Date.now())
      if (calls.length > 1) return response([2], true, videoFormatId)
      return new Response(new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk)
          controller.close()
        }
      }))
    }, { Date })
    const transport = createSabrTransport(sabrData, () => context)
    t.after(() => transport.cleanup())
    transport.onBackoffRequested(({ backoffMs }) => waits.push(backoffMs))
    const makeRequest = uri => transport.request(uri, {
      uris: [uri], retryParameters: { timeout: 60000 }
    }, 1).promise
    await makeRequest('sabr1:audio?formatId=140-123-&init')
    const video = makeRequest('sabr1:video?formatId=137-456-&resolution=1080&init')
    await flushRequests()
    t.mock.timers.tick(30000)
    await video
    assert.deepEqual(waits, [], 'bytes after the requested MEDIA_END must not delay another loader')
    assert.deepEqual(calls, [0, 0])
  })
}

test('staggered native audio and video initialization share the server backoff deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  const calls = []
  const waits = []
  const { createSabrTransport } = load(async (_uri, options) => {
    const body = protos.VideoPlaybackAbrRequest.decode(options.body)
    calls.push(Date.now())
    if (calls.length === 1) return policyResponse(15000)
    return response([1], true, body.clientAbrState.enabledTrackTypesBitfield === 1 ? audioFormatId : videoFormatId)
  }, { Date })
  const transport = createSabrTransport(sabrData, () => context)
  t.after(() => transport.cleanup())
  transport.onBackoffRequested(({ backoffMs }) => waits.push(backoffMs))
  const audio = 'sabr1:audio?formatId=140-123-&init'
  const video = 'sabr1:video?formatId=137-456-&resolution=1080&init'
  const makeRequest = uri => ({ uris: [uri], retryParameters: { timeout: 30000 } })
  const audioPending = transport.request(audio, makeRequest(audio), 1).promise
  await flushRequests()
  t.mock.timers.tick(5000)
  const videoPending = transport.request(video, makeRequest(video), 1).promise
  await flushRequests()
  t.mock.timers.tick(10000)
  await flushRequests()
  // Observe both completions before assertions so a failing run can clean up.
  t.mock.timers.tick(5000)
  await Promise.all([audioPending, videoPending])
  assert.deepEqual(waits, [15000, 10000], 'the second loader must not restart the full startup countdown')
  assert.deepEqual(calls, [0, 15000, 15000])
})

test('later native segments do not repeat an expired server backoff', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  let calls = 0
  const waits = []
  const { createSabrTransport } = load(async () => {
    if (++calls === 1) return policyResponse(15000)
    return response([1])
  }, { Date })
  const transport = createSabrTransport(sabrData, () => context)
  t.after(() => transport.cleanup())
  transport.onBackoffRequested(({ backoffMs }) => waits.push(backoffMs))
  const uri = 'sabr1:audio?formatId=140-123-&sq=1'
  const request = { uris: [uri], retryParameters: { timeout: 30000 } }
  const first = transport.request(uri, request, 1).promise
  await flushRequests()
  t.mock.timers.tick(15000)
  await first
  const later = transport.request(uri, request, 1).promise
  await flushRequests()
  t.mock.timers.tick(15000)
  await later
  assert.deepEqual(waits, [15000])
  assert.equal(calls, 3)
})

test('closing a native source cancels its backoff without sending a delayed request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  let calls = 0
  const { createSabrTransport } = load(async () => {
    calls++
    return policyResponse(15000)
  }, { Date })
  const transport = createSabrTransport(sabrData, () => context)
  const uri = 'sabr1:audio?formatId=140-123-&init'
  const pending = transport.request(uri, { uris: [uri], retryParameters: { timeout: 30000 } }, 1).promise
  await flushRequests()
  transport.cleanup()
  await assert.rejects(pending, error => error.code === ShakaError.Code.OPERATION_ABORTED)
  t.mock.timers.tick(30000)
  await flushRequests()
  assert.equal(calls, 1)
})

test('a newer server policy extends the deadline for loaders already waiting', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  let releaseVideo
  const calls = []
  const { createSabrTransport } = load(async (_uri, options) => {
    calls.push(Date.now())
    if (calls.length === 1) return policyResponse(15000)
    if (calls.length === 2) return new Promise(resolve => { releaseVideo = resolve })
    const body = protos.VideoPlaybackAbrRequest.decode(options.body)
    return response([1], true, body.clientAbrState.enabledTrackTypesBitfield === 1 ? audioFormatId : videoFormatId)
  }, { Date })
  const transport = createSabrTransport(sabrData, () => context)
  t.after(() => transport.cleanup())
  const pending = [
    'sabr1:audio?formatId=140-123-&init',
    'sabr1:video?formatId=137-456-&resolution=1080&init',
  ].map(uri => transport.request(uri, { uris: [uri], retryParameters: { timeout: 30000 } }, 1).promise)
  await flushRequests()
  t.mock.timers.tick(5000)
  releaseVideo(policyResponse(20000))
  await flushRequests()
  t.mock.timers.tick(10000)
  await flushRequests()
  assert.equal(calls.length, 2, 'the audio loader must respect the newer deadline')
  t.mock.timers.tick(10000)
  await Promise.all(pending)
  assert.deepEqual(calls, [0, 0, 25000, 25000])
})

test('native SABR transport encodes decoder state and returns only the requested media bytes', async () => {
  const requests = []
  const { createSabrTransport } = load(async (uri, options) => {
    requests.push({ uri, body: protos.VideoPlaybackAbrRequest.decode(options.body) })
    return response([5, 6, 7])
  })
  const transport = createSabrTransport(sabrData, () => context)
  const uri = 'sabr1:audio?formatId=140-123-&sq=1&startTimeMs=10000'
  const result = await transport.request(uri, request(uri), 1).promise
  assert.deepEqual([...result.data], [5, 6, 7])
  assert.equal(requests[0].body.clientAbrState.playbackRate, 1.5)
  assert.equal(requests[0].body.clientAbrState.playerTimeMs, '10000')
  assert.equal(requests[0].body.preferredAudioFormatIds[0].itag, 140)
  assert.equal(requests[0].body.preferredVideoFormatIds[0].itag, 137)
  assert.equal(new URL(requests[0].uri).searchParams.get('rn'), '0')
  transport.cleanup()
})

test('SABR initialization stays cached until the native source closes', async () => {
  let calls = 0
  const { createSabrTransport } = load(async () => { calls++; return response([1, 2, 3], true) })
  const transport = createSabrTransport(sabrData, () => context)
  const uri = 'sabr1:audio?formatId=140-123-&init'
  await transport.request(uri, request(uri), 1).promise
  const cached = await transport.request(uri, request(uri), 1).promise
  assert.equal(cached.fromCache, true)
  assert.equal(calls, 1)
  transport.cleanup()
  const abandoned = await transport.request(uri, request(uri), 1).promise
  assert.equal(abandoned.data.byteLength, 0)
  assert.equal(calls, 1)
})

test('replacing a SABR source aborts its outstanding network request', async () => {
  const { createSabrTransport } = load((_uri, options) => new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  }))
  const transport = createSabrTransport(sabrData, () => context)
  const uri = 'sabr1:audio?formatId=140-123-&sq=1'
  const pending = transport.request(uri, request(uri), 1).promise
  transport.cleanup()
  await assert.rejects(pending, error => error.code === ShakaError.Code.OPERATION_ABORTED)
})

test('the Shaka adapter retains format selection, registration and teardown behavior', async () => {
  let body
  const { setupSabrScheme, schemes } = load(async (_uri, options) => {
    body = protos.VideoPlaybackAbrRequest.decode(options.body)
    return response([1], true)
  })
  const player = {
    isAudioOnly: () => false,
    getVariantTracks: () => [{ originalVideoId: '137-456-', originalAudioId: '140-123-', audioRoles: ['main'] }],
    getStats: () => ({ estimatedBandwidth: 1234567 }), getPlaybackRate: () => 2,
  }
  const transport = setupSabrScheme(sabrData, () => player, () => ({}), { value: 1920 }, { value: 1080 })
  const uri = 'sabr1:audio?formatId=140-123-&init'
  await schemes.get('sabr1')(uri, request(uri), 1).promise
  assert.equal(body.clientAbrState.playbackRate, 2)
  assert.equal(body.clientAbrState.clientViewportWidth, 1920)
  assert.equal(body.preferredVideoFormatIds[0].itag, 137)
  transport.cleanup()
  assert.equal(schemes.size, 0)
})
