import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildRequestDiagnostic,
  classifyRequestFailure,
  classifyRequestLifecycle,
  sanitizeRequestErrorMessage,
} from '../../src/renderer/helpers/api/requestDiagnostics.js'

test('classifies request failures without exposing request secrets', () => {
  const error = Object.assign(
    new Error('Unable to resolve https://example.test/path?token=secret with Authorization: Bearer secret-token'),
    { code: 'UnknownHostException' }
  )

  assert.deepEqual(buildRequestDiagnostic(error, {
    category: 'subscription videos',
    backend: 'local API',
    lifecycle: 'resume',
  }), {
    category: 'subscription videos',
    backend: 'local API',
    lifecycle: 'resume',
    failure: 'network',
    code: 'UnknownHostException',
    message: 'Unable to resolve https://example.test with Authorization: <redacted>',
  })
})

test('distinguishes HTTP, TLS, parsing, cancellation, and API failures', () => {
  assert.equal(classifyRequestFailure({ status: 503 }), 'http')
  assert.equal(classifyRequestFailure({ code: 'SSLHandshakeException' }), 'tls')
  assert.equal(classifyRequestFailure(new TypeError('Failed to fetch')), 'network')
  assert.equal(classifyRequestFailure(new Error('android_getaddrinfo failed: EAI_NODATA')), 'network')
  assert.equal(
    classifyRequestFailure({ code: 'ForegroundServiceStartNotAllowedException' }),
    'background restriction'
  )
  assert.equal(classifyRequestFailure(new SyntaxError('Unexpected token')), 'parsing')
  assert.equal(classifyRequestFailure({ name: 'AbortError' }), 'cancellation')
  assert.equal(classifyRequestFailure({ status: 0 }), 'api')
  assert.equal(classifyRequestFailure(new Error('API rejected the request')), 'api')
})

test('redacts credential fields, cookies, and request bodies', () => {
  const sanitized = sanitizeRequestErrorMessage(new Error([
    'Cookie: SID=cookie-secret',
    'token=token-secret api_key=key-secret',
    'request body={"password":"body-secret"}',
  ].join('\n')))

  for (const secret of ['cookie-secret', 'token-secret', 'key-secret', 'body-secret']) {
    assert.equal(sanitized.includes(secret), false)
  }
  assert.match(sanitized, /Cookie: <redacted>/)
  assert.match(sanitized, /token=<redacted>/)
  assert.match(sanitized, /api_key=<redacted>/)
  assert.match(sanitized, /request body=<redacted>/)

  assert.equal(
    sanitizeRequestErrorMessage(new Error('Authorization: Basic basic-secret with spaces')),
    'Authorization: <redacted>'
  )
})

test('labels foreground, background, and recent resume requests', () => {
  assert.equal(classifyRequestLifecycle('hidden', 0, 10000), 'background')
  assert.equal(classifyRequestLifecycle('visible', 8000, 10000), 'resume')
  assert.equal(classifyRequestLifecycle('visible', 0, 10000), 'foreground')
})

test('classifies native download transport codes without relying on their messages', () => {
  for (const code of ['UnknownHostException', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH']) {
    assert.equal(classifyRequestFailure({ code, message: 'Download failed' }), 'network', code)
  }
  assert.equal(classifyRequestFailure('Unable to resolve host "api.github.com"'), 'network')
  assert.equal(classifyRequestFailure({ code: 'FileNotFoundException', message: 'Missing feed' }), 'api')
})
