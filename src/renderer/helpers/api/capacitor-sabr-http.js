import { registerPlugin } from '@capacitor/core'

import { createAbortError } from './requestErrors.js'
import { DESKTOP_USER_AGENT } from './capacitor-http.js'

const SabrHttp = registerPlugin('SabrHttp')

function bytesToBase64(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * Prepares a SABR protobuf request in Android, then streams its response from
 * a same-origin URL intercepted by the WebView client. Video response bytes
 * therefore never cross the Capacitor bridge.
 * @param {string} url
 * @param {RequestInit} init
 * @returns {Promise<Response>}
 */
export async function capacitorSabrFetch(url, init) {
  if (!(init.body instanceof Uint8Array)) {
    throw new TypeError('SABR requests require a Uint8Array body')
  }
  if (init.signal?.aborted) throw createAbortError()

  // Metadata uses the WEB client. Keep its identity when native HTTP fetches
  // the stream instead of letting HttpURLConnection use Android's default.
  const headers = new Headers(init.headers)
  if (!headers.has('user-agent')) {
    headers.set('user-agent', DESKTOP_USER_AGENT)
  }

  const { requestId } = await SabrHttp.prepare({
    url,
    body: bytesToBase64(init.body),
    headers: Object.fromEntries(headers)
  })

  const onAbort = () => {
    SabrHttp.abort({ requestId }).catch(() => {})
  }
  const cleanup = () => {
    init.signal?.removeEventListener('abort', onAbort)
  }

  if (init.signal?.aborted) {
    onAbort()
    throw createAbortError()
  }
  init.signal?.addEventListener('abort', onAbort, { once: true })

  let response
  try {
    response = await fetch(
      `${location.origin}/_opentubex_sabr/${encodeURIComponent(requestId)}`,
      { signal: init.signal }
    )
  } catch (error) {
    cleanup()
    onAbort()
    throw error
  }

  if (response.body == null) {
    cleanup()
    return response
  }

  const reader = response.body.getReader()
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const chunk = await reader.read()
        if (chunk.done) {
          cleanup()
          controller.close()
        } else {
          controller.enqueue(chunk.value)
        }
      } catch (error) {
        cleanup()
        onAbort()
        controller.error(error)
      }
    },
    cancel(reason) {
      cleanup()
      onAbort()
      return reader.cancel(reason)
    }
  })

  return new Response(stream, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText
  })
}
