import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

import { createAbortError } from '../../src/renderer/helpers/api/requestErrors.js'

import {
  capacitorHttpFetch,
  fetchCapacitorAvatarDataUrl
} from '../../src/renderer/helpers/api/capacitor-http.js'

const originalFetch = globalThis.fetch
const originalFileReader = globalThis.FileReader

class TestFileReader {
  readAsDataURL (blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`
      this.onload()
    }, (error) => this.onerror(error))
  }
}

function nativeHttpResponse ({
  status = 200,
  contentType = 'image/jpeg',
  data = '/9j/AA==',
  url = 'https://yt3.ggpht.com/avatar'
} = {}) {
  const response = new Response(Buffer.from(data, 'base64'), {
    status,
    headers: { 'content-type': contentType }
  })
  Object.defineProperty(response, 'url', { value: url })
  return response
}

test.afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.FileReader = originalFileReader
})

test('passes local API text requests through Capacitor HTTP', async () => {
  let receivedRequest

  globalThis.fetch = async (input, init) => {
    receivedRequest = new Request(input, init)
    const response = new Response(JSON.stringify({ items: ['result'] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
    Object.defineProperty(response, 'url', { value: 'https://www.youtube.com/youtubei/v1/search' })
    return response
  }

  const response = await capacitorHttpFetch('https://www.youtube.com/youtubei/v1/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'OpenTubeX' })
  })

  assert.equal(receivedRequest.method, 'POST')
  assert.match(receivedRequest.headers.get('user-agent'), /Chrome\/\d+/)
  assert.doesNotMatch(receivedRequest.headers.get('user-agent'), /Mobile|Android/)
  assert.deepEqual(await receivedRequest.json(), { query: 'OpenTubeX' })
  assert.equal(response.status, 200)
  assert.equal(response.url, 'https://www.youtube.com/youtubei/v1/search')
  assert.deepEqual(await response.json(), { items: ['result'] })
})

test('retries transient Android DNS failures', async () => {
  let attempts = 0
  globalThis.fetch = async () => {
    attempts++
    if (attempts < 3) {
      throw Object.assign(
        new Error('Unable to resolve host "www.youtube.com": No address associated with hostname'),
        { code: 'UnknownHostException' }
      )
    }
    return new Response('ok')
  }

  const response = await capacitorHttpFetch('https://www.youtube.com')

  assert.equal(await response.text(), 'ok')
  assert.equal(attempts, 3)
})

test('preserves an explicitly supplied user agent', async () => {
  let receivedRequest

  globalThis.fetch = async (input, init) => {
    receivedRequest = new Request(input, init)
    return new Response('ok')
  }

  await capacitorHttpFetch('https://www.youtube.com', {
    headers: { 'User-Agent': 'OpenTubeX test client' }
  })

  assert.equal(receivedRequest.headers.get('user-agent'), 'OpenTubeX test client')
})

test('rejects native redirects when redirect mode is error', async () => {
  globalThis.fetch = async () => new Response(null, {
    status: 302,
    headers: { location: 'https://example.com/redirected' }
  })

  await assert.rejects(
    capacitorHttpFetch('https://example.com/original', { redirect: 'error' }),
    { name: 'TypeError', message: 'Redirects are not allowed for this request' }
  )
})

test('accepts a 304 response when redirect mode is error', async () => {
  globalThis.fetch = async () => new Response(null, { status: 304 })

  const response = await capacitorHttpFetch('https://example.com/cached', { redirect: 'error' })

  assert.equal(response.status, 304)
  assert.equal(await response.text(), '')
})

test('rejects non-HTTPS local API requests', async () => {
  await assert.rejects(
    capacitorHttpFetch('http://www.youtube.com/youtubei/v1/search'),
    { name: 'TypeError', message: 'Capacitor local API requests require HTTPS' }
  )
})

test('does not start an already-aborted request', async () => {
  let requestStarted = false
  globalThis.fetch = async () => {
    requestStarted = true
    return new Response()
  }

  const abortController = new AbortController()
  abortController.abort()

  await assert.rejects(
    capacitorHttpFetch('https://www.youtube.com', { signal: abortController.signal }),
    { name: 'AbortError' }
  )
  assert.equal(requestStarted, false)
})

test('uses the abort signal from a Request object', async () => {
  let requestStarted = false
  globalThis.fetch = async () => {
    requestStarted = true
    return new Response()
  }

  const abortController = new AbortController()
  abortController.abort()
  const request = new Request('https://www.youtube.com', {
    signal: abortController.signal,
  })

  await assert.rejects(capacitorHttpFetch(request), { name: 'AbortError' })
  assert.equal(requestStarted, false)
})

test('loads YouTube avatars through Capacitor HTTP as data URLs', async () => {
  let receivedRequest
  globalThis.FileReader = TestFileReader
  globalThis.fetch = async (input, init) => {
    receivedRequest = new Request(input, init)
    return nativeHttpResponse({ url: receivedRequest.url })
  }

  const dataUrl = await fetchCapacitorAvatarDataUrl('https://yt3.ggpht.com/avatar=s88-c-k-c0x00ffffff-no-rj')

  assert.equal(receivedRequest.url, 'https://yt3.ggpht.com/avatar=s88-c-k-c0x00ffffff-no-rj')
  assert.equal(dataUrl, 'data:image/jpeg;base64,/9j/AA==')
})

test('accepts alternate YouTube avatar hosts', async () => {
  const receivedUrls = []
  globalThis.FileReader = TestFileReader
  globalThis.fetch = async (input, init) => {
    const url = new Request(input, init).url
    receivedUrls.push(url)
    return nativeHttpResponse({
      contentType: 'image/webp; charset=binary',
      data: 'UklGRg==',
      url
    })
  }

  assert.equal(
    await fetchCapacitorAvatarDataUrl('https://yt3.googleusercontent.com/avatar'),
    'data:image/webp;base64,UklGRg=='
  )
  assert.equal(
    await fetchCapacitorAvatarDataUrl('https://yt4.ggpht.com/avatar'),
    'data:image/webp;base64,UklGRg=='
  )
  assert.deepEqual(receivedUrls, [
    'https://yt3.googleusercontent.com/avatar',
    'https://yt3.ggpht.com/avatar'
  ])
})

test('does not send unsupported avatar URLs through native HTTP', async () => {
  let requestStarted = false
  globalThis.fetch = async () => {
    requestStarted = true
  }

  assert.equal(await fetchCapacitorAvatarDataUrl('http://yt3.ggpht.com/avatar'), null)
  assert.equal(await fetchCapacitorAvatarDataUrl('https://example.com/avatar'), null)
  assert.equal(await fetchCapacitorAvatarDataUrl('https://yt3.ggpht.com.example.com/avatar'), null)
  assert.equal(await fetchCapacitorAvatarDataUrl('not a URL'), null)
  assert.equal(requestStarted, false)
})

test('rejects invalid native avatar responses', async () => {
  globalThis.FileReader = TestFileReader
  const responses = [
    { status: 404 },
    { contentType: 'text/html', data: 'PGh0bWw+' },
    { contentType: 'image/svg+xml', data: 'PHN2Zz4=' },
    { data: '' },
    { url: 'https://example.com/avatar' }
  ]

  for (const response of responses) {
    globalThis.fetch = async () => nativeHttpResponse(response)

    assert.equal(
      await fetchCapacitorAvatarDataUrl('https://yt3.ggpht.com/avatar'),
      null
    )
  }
})

test('bounds native connection and stalled reads while retaining JavaScript cancellation', async () => {
  const source = (await readFile(new URL('../../src/renderer/helpers/api/capacitor-http.js', import.meta.url), 'utf8'))
    .replace(/^import .* from .*\n/gm, '')
    .replace(/^export /gm, '')
  const requests = []
  const context = vm.createContext({
    CapacitorHttp: {
      request(options) {
        requests.push(options)
        return new Promise(() => {})
      },
    },
    createAbortError, Request, Response, Headers, URL, URLSearchParams, setTimeout, clearTimeout,
  })
  vm.runInContext(`${source}\nglobalThis.fetchNative = capacitorHttpFetch`, context)
  const controller = new AbortController()
  const pending = context.fetchNative('https://www.youtube.com/watch?v=test', {
    signal: controller.signal,
    nativeTimeoutMs: 15_000,
  })
  const rejected = assert.rejects(pending, { name: 'AbortError' })
  try {
    await Promise.resolve()
    assert.equal(requests.length, 1)
    assert.equal(requests[0].connectTimeout, 15_000)
    assert.equal(requests[0].readTimeout, 15_000)
  } finally {
    controller.abort()
    await rejected
  }
})
