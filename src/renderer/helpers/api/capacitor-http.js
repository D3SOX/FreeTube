import { CapacitorHttp } from '@capacitor/core'

import { withNetworkRecovery } from '../networkRecovery.js'
import { createAbortError } from './requestErrors.js'

export const DESKTOP_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const YOUTUBE_AVATAR_HOSTS = new Set([
  'yt3.ggpht.com',
  'yt4.ggpht.com',
  'yt3.googleusercontent.com'
])
const AVATAR_MIME_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp'
])
const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const MAX_AVATAR_BASE64_LENGTH = Math.ceil(MAX_AVATAR_BYTES / 3) * 4
const DNS_RETRY_DELAYS_MS = [150, 500]
const DEFAULT_NATIVE_TIMEOUT_MS = 30_000
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/**
 * @param {Promise<import('@capacitor/core').HttpResponse>} request
 * @param {AbortSignal | undefined} signal
 */
function waitForRequest(request, signal) {
  if (!signal) return request
  if (signal.aborted) return Promise.reject(createAbortError())

  return new Promise((resolve, reject) => {
    const onAbort = () => reject(createAbortError())
    signal.addEventListener('abort', onAbort, { once: true })

    request.then(
      (response) => {
        signal.removeEventListener('abort', onAbort)
        resolve(response)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}

function waitForRetry(delay, signal) {
  if (!signal) return new Promise(resolve => setTimeout(resolve, delay))
  if (signal.aborted) return Promise.reject(createAbortError())

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, delay)
    const onAbort = () => {
      clearTimeout(timer)
      reject(createAbortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function requestWithDnsRetry(options, signal) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await waitForRequest(CapacitorHttp.request(options), signal)
    } catch (error) {
      if (error?.code !== 'UnknownHostException' || attempt >= DNS_RETRY_DELAYS_MS.length) {
        throw error
      }
      await waitForRetry(DNS_RETRY_DELAYS_MS[attempt], signal)
    }
  }
}

/**
 * @param {RequestInfo | URL} input
 * @param {RequestInit | undefined} init
 */
async function getRequestBody(input, init) {
  if (init?.body != null) {
    if (typeof init.body === 'string') return init.body
    if (init.body instanceof URLSearchParams) return init.body.toString()

    throw new TypeError('Capacitor local API requests only support text request bodies')
  }

  if (input instanceof Request && input.body !== null) {
    return await input.clone().text()
  }

  return undefined
}

/**
 * Uses Capacitor's native HTTP client for small HTML and JSON requests that
 * cannot rely on WebView CORS access. Media requests must keep using the
 * WebView so their response bodies are streamed instead of copied through the
 * JavaScript bridge as base64. nativeTimeoutMs bounds connection and read
 * inactivity on Android, defaulting to 30 seconds so stalled requests release
 * the subscription queue. signal still limits the JavaScript wait.
 * @param {RequestInfo | URL} input
 * @param {RequestInit & { nativeTimeoutMs?: number }} [init]
 * @returns {Promise<Response>}
 */
export async function capacitorHttpFetch(input, init = undefined) {
  return await withNetworkRecovery(input, init, signal => nativeHttpFetch(input, { ...init, signal }))
}

async function nativeHttpFetch(input, init) {
  const inputRequest = input instanceof Request ? input : null
  const signal = init?.signal ?? inputRequest?.signal
  if (signal?.aborted) throw createAbortError()

  const url = new URL(inputRequest?.url ?? input.toString())

  if (url.protocol !== 'https:') {
    throw new TypeError('Capacitor local API requests require HTTPS')
  }

  const headers = new Headers(inputRequest?.headers)
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value))
  if (!headers.has('user-agent')) {
    headers.set('user-agent', DESKTOP_USER_AGENT)
  }

  const redirect = init?.redirect ?? inputRequest?.redirect ?? 'follow'

  const nativeResponse = await requestWithDnsRetry({
    url: url.toString(),
    method: init?.method ?? inputRequest?.method ?? 'GET',
    headers: Object.fromEntries(headers),
    data: await getRequestBody(input, init),
    responseType: 'text',
    disableRedirects: redirect !== 'follow',
    connectTimeout: init?.nativeTimeoutMs ?? DEFAULT_NATIVE_TIMEOUT_MS,
    readTimeout: init?.nativeTimeoutMs ?? DEFAULT_NATIVE_TIMEOUT_MS,
  }, signal)

  if (redirect === 'error' && REDIRECT_STATUSES.has(nativeResponse.status)) {
    throw new TypeError('Redirects are not allowed for this request')
  }

  const responseBody = nativeResponse.status === 204 || nativeResponse.status === 205 || nativeResponse.status === 304
    ? null
    : typeof nativeResponse.data === 'string'
      ? nativeResponse.data
      : JSON.stringify(nativeResponse.data)

  const response = new Response(responseBody, {
    status: nativeResponse.status,
    headers: nativeResponse.headers,
  })

  Object.defineProperty(response, 'url', { value: nativeResponse.url })
  return response
}

/**
 * @param {string} src
 * @returns {URL | null}
 */
function getYouTubeAvatarUrl(src) {
  try {
    const url = new URL(src)
    if (url.protocol !== 'https:' || !YOUTUBE_AVATAR_HOSTS.has(url.hostname)) return null

    // YouTube serves the same avatar paths from both numbered CDN hosts. Some
    // Android DNS blocklists sinkhole yt4 while leaving the canonical yt3 host
    // available, so use yt3 for the native fallback request.
    if (url.hostname === 'yt4.ggpht.com') url.hostname = 'yt3.ggpht.com'
    return url
  } catch {
    return null
  }
}

/**
 * Fetches small YouTube avatars through Android's native client when WebView
 * blocks the same response with ORB.
 * @param {string} src
 * @returns {Promise<string | null>}
 */
export async function fetchCapacitorAvatarDataUrl(src) {
  const url = getYouTubeAvatarUrl(src)
  if (url === null) return null

  let response
  try {
    response = await CapacitorHttp.request({
      url: url.toString(),
      method: 'GET',
      responseType: 'blob'
    })
  } catch {
    return null
  }

  const responseUrl = getYouTubeAvatarUrl(response.url)
  const headers = new Headers(response.headers)
  const mimeType = headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
  const contentLength = Number(headers.get('content-length'))

  if (
    responseUrl === null ||
    response.status < 200 || response.status >= 300 ||
    !AVATAR_MIME_TYPES.has(mimeType) ||
    typeof response.data !== 'string' || response.data.length === 0 ||
    response.data.length > MAX_AVATAR_BASE64_LENGTH ||
    (Number.isFinite(contentLength) && contentLength > MAX_AVATAR_BYTES)
  ) {
    return null
  }

  return `data:${mimeType};base64,${response.data}`
}
