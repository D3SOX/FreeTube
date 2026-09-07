import assert from 'node:assert/strict'
import test from 'node:test'

import {
  prepareGoogleVideoRequest
} from '../../src/renderer/helpers/player/playbackRequestPolicy.js'

test('keeps Capacitor googlevideo segments as GET requests for the native proxy', () => {
  for (const [isSabr, isCapacitor, expected] of [[false, true, 'GET'], [false, false, 'POST'], [true, false, 'GET']]) {
    const request = { uris: ['https://example.googlevideo.com/videoplayback'], method: 'GET', headers: {} }
    prepareGoogleVideoRequest(request, isSabr, isCapacitor)
    assert.equal(request.method, expected)
  }
})

test('Android sends nonzero CDN byte ranges in the URL without changing GET', () => {
  const request = {
    uris: ['https://example.googlevideo.com/videoplayback?token=preserve%2Bthis'],
    method: 'GET',
    headers: { Range: 'bytes=259-292', Accept: '*/*' }
  }
  prepareGoogleVideoRequest(request, false, true)
  assert.equal(request.method, 'GET')
  assert.equal(request.body, undefined)
  assert.equal(new URL(request.uris[0]).searchParams.get('range'), '259-292')
  assert.equal(new URL(request.uris[0]).searchParams.get('token'), 'preserve+this')
  assert.equal(request.headers.Range, undefined)
  assert.equal(request.headers.Accept, '*/*')
})

test('desktop keeps its POST body and CDN range conversion', () => {
  const request = { uris: ['https://example.googlevideo.com/videoplayback?token=keep'], method: 'GET', headers: { Range: 'bytes=700-767' } }
  prepareGoogleVideoRequest(request, false, false)
  assert.equal(request.method, 'POST')
  assert.deepEqual(request.body, new Uint8Array([0x78, 0]))
  assert.equal(new URL(request.uris[0]).searchParams.get('range'), '700-767')
  assert.equal(new URL(request.uris[0]).searchParams.get('alr'), 'yes')
  assert.equal(request.headers.Range, undefined)
})

test('Invidious and SABR requests retain their original byte-range headers', () => {
  for (const [uri, sabr] of [
    ['https://invidious.example/videoplayback?token=keep', false],
    ['https://example.googlevideo.com/videoplayback?token=keep', true]
  ]) {
    const request = { uris: [uri], method: 'GET', headers: { Range: 'bytes=259-292' } }
    const original = structuredClone(request)
    prepareGoogleVideoRequest(request, sabr, true)
    assert.deepEqual(request, original)
  }
})

test('Android also converts lowercase range headers', () => {
  const request = { uris: ['https://example.googlevideo.com/videoplayback?range=0-5'], method: 'GET', headers: { range: 'bytes=700-767' } }
  prepareGoogleVideoRequest(request, false, true)
  assert.deepEqual(new URL(request.uris[0]).searchParams.getAll('range'), ['700-767'])
  assert.deepEqual(request.headers, {})
})
