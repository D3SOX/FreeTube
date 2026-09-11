import assert from 'node:assert/strict'
import test from 'node:test'

import { RendererCors } from '../../src/main/rendererCors.js'

function fixture() {
  const policy = new RendererCors()
  const frame = { url: 'app://bundle/index.html#/watch/example' }
  const details = {
    id: 1,
    frame,
    webContents: { mainFrame: frame },
    method: 'GET',
    requestHeaders: { Origin: 'app://bundle' },
    responseHeaders: { 'Content-Range': ['bytes 0-3/4'], 'Set-Cookie': ['synthetic=1'] },
    statusCode: 206
  }
  return { policy, details }
}

test('grants only the app origin and exposes response metadata with credentials', () => {
  const { policy, details } = fixture()
  details.responseHeaders['Access-Control-Allow-Origin'] = ['https://youtube.com']
  policy.rememberRequest(details)
  const result = policy.allowResponse(details)
  assert.equal(result.statusLine, undefined)
  assert.deepEqual(result.responseHeaders['access-control-allow-origin'], ['app://bundle'])
  assert.equal(result.responseHeaders['Access-Control-Allow-Origin'], undefined)
  assert.deepEqual(result.responseHeaders['content-range'], ['bytes 0-3/4'])
  assert.deepEqual(result.responseHeaders['access-control-allow-credentials'], ['true'])
  assert.match(result.responseHeaders['access-control-expose-headers'][0], /content-range/)
  assert.doesNotMatch(result.responseHeaders['access-control-expose-headers'][0], /set-cookie/)
  assert.deepEqual(result.responseHeaders.vary, ['Origin'])
})

test('does not grant CORS access to foreign frames, native requests or spoofed origins', () => {
  for (const change of [
    details => { details.frame = null },
    details => { details.webContents = undefined },
    details => { details.frame = { url: 'app://bundle/index.html' } },
    details => { details.frame.url = 'https://foreign.example/' },
    details => { details.frame.url = 'app://bundle/other.html' },
    details => { details.requestHeaders.Origin = 'https://foreign.example' },
    details => { details.requestHeaders.Origin = 'null' },
    details => { details.requestHeaders = {} },
  ]) {
    const { policy, details } = fixture()
    change(details)
    policy.rememberRequest(details)
    assert.deepEqual(policy.allowResponse(details), {})
  }
})

test('revokes pending grants when the requesting frame navigates or is destroyed', () => {
  for (const change of [
    details => { details.frame.url = 'https://foreign.example/' },
    details => { details.frame = null },
    details => { details.webContents.mainFrame = { url: 'app://bundle/index.html' } },
  ]) {
    const { policy, details } = fixture()
    policy.rememberRequest(details)
    change(details)
    assert.deepEqual(policy.allowResponse(details), {})
  }
})

test('answers preflights without masking actual API errors or ordinary OPTIONS requests', () => {
  const { policy, details } = fixture()
  details.method = 'OPTIONS'
  details.statusCode = 405
  details.requestHeaders = {
    origin: 'app://bundle',
    'access-control-request-method': 'PUT',
    'access-control-request-headers': 'authorization, content-type'
  }
  policy.rememberRequest(details)
  const result = policy.allowResponse(details)
  assert.equal(result.statusLine, 'HTTP/1.1 204 No Content')
  assert.deepEqual(result.responseHeaders['access-control-allow-methods'], ['PUT'])
  assert.deepEqual(result.responseHeaders['access-control-allow-headers'], ['authorization, content-type'])

  for (const method of ['PUT', 'OPTIONS']) {
    details.method = method
    details.requestHeaders = { Origin: 'app://bundle' }
    details.statusCode = 401
    policy.rememberRequest(details)
    assert.equal(policy.allowResponse(details).statusLine, undefined)
  }
})

test('accepts opaque redirect origins only for existing app requests and prevents caching the grant', () => {
  const { policy, details } = fixture()
  policy.rememberRequest(details)
  details.requestHeaders.Origin = 'null'
  policy.rememberRequest(details)
  const result = policy.allowResponse(details)
  assert.deepEqual(result.responseHeaders['access-control-allow-origin'], ['null'])
  assert.deepEqual(result.responseHeaders['cache-control'], ['no-store'])

  policy.forgetRequest(details)
  assert.deepEqual(policy.allowResponse(details), {})
  policy.rememberRequest(details)
  assert.deepEqual(policy.allowResponse(details), {})
})

test('retains cookie removal performed by the privacy hook', () => {
  const { policy, details } = fixture()
  policy.rememberRequest(details)
  delete details.responseHeaders['Set-Cookie']
  assert.equal(policy.allowResponse(details).responseHeaders['set-cookie'], undefined)
})

test('disables caching for final authorization headers while preserving the original origin', () => {
  for (const name of ['Authorization', 'authorization']) {
    const { policy, details } = fixture()
    details.responseHeaders['Cache-Control'] = ['public, max-age=3600']
    details.requestHeaders = { Origin: 'https://www.youtube.com', [name]: 'test-account' }
    policy.rememberRequest(details, 'app://bundle')
    const headers = policy.allowResponse(details).responseHeaders
    assert.deepEqual(headers['cache-control'], ['no-store'])
    assert.deepEqual(headers['access-control-allow-origin'], ['app://bundle'])
  }
  const { policy, details } = fixture()
  details.responseHeaders['Cache-Control'] = ['public, max-age=3600']
  policy.rememberRequest(details)
  assert.deepEqual(policy.allowResponse(details).responseHeaders['cache-control'], ['public, max-age=3600'])
})
