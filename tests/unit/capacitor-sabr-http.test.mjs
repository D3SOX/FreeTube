import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

import { capacitorHttpFetch, DESKTOP_USER_AGENT } from '../../src/renderer/helpers/api/capacitor-http.js'
import { createAbortError } from '../../src/renderer/helpers/api/requestErrors.js'

const source = (await readFile(new URL('../../src/renderer/helpers/api/capacitor-sabr-http.js', import.meta.url), 'utf8'))
  .replace(/^import .*\n/gm, '')
  .replace('export async function ', 'async function ')

async function metadataUserAgent(t) {
  let userAgent
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    userAgent = new Request(input, init).headers.get('user-agent')
    return new Response('{}')
  })
  await capacitorHttpFetch('https://www.youtube.com/youtubei/v1/player')
  return userAgent
}

function load(prepare) {
  return vm.runInNewContext(`${source}\ncapacitorSabrFetch`, {
    registerPlugin: () => ({ prepare, abort: async () => {} }),
    createAbortError,
    DESKTOP_USER_AGENT,
    Uint8Array, Headers, Response, ReadableStream, btoa,
    location: { origin: 'https://localhost' },
    fetch: async () => new Response(Uint8Array.of(1, 2, 3)),
  })
}

test('Android SABR uses the same browser identity as its YouTube metadata request', async t => {
  const userAgent = await metadataUserAgent(t)
  let prepared
  const fetchSabr = load(async request => {
    prepared = request
    return { requestId: 'sabr-request' }
  })
  const headers = new Headers({ 'content-type': 'application/x-protobuf' })
  const response = await fetchSabr('https://example.googlevideo.com/videoplayback', {
    body: Uint8Array.of(4, 5, 6), headers,
  })
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), Uint8Array.of(1, 2, 3))
  assert.equal(prepared.headers['user-agent'], userAgent,
    'the native HTTP stack must not replace the WEB identity with its Android default')
  assert.equal(prepared.headers['content-type'], 'application/x-protobuf')
  assert.equal(headers.has('user-agent'), false, 'caller headers must stay unchanged')
})

test('Android SABR preserves an explicit client user agent', async () => {
  let prepared
  const fetchSabr = load(async request => {
    prepared = request
    return { requestId: 'sabr-request' }
  })
  const response = await fetchSabr('https://example.googlevideo.com/videoplayback', {
    body: Uint8Array.of(1), headers: { 'User-Agent': 'explicit-client' },
  })
  await response.arrayBuffer()
  assert.equal(prepared.headers['user-agent'], 'explicit-client')
})
