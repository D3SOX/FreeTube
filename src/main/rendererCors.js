import { isOpenTubeXUrl } from './utils.js'

/**
 * The app is a native API client, including for user-configured HTTP servers.
 * Grant its renderer CORS access without disabling Chromium's other origin
 * protections or granting the same access to embedded pages and sandboxes.
 */
export class RendererCors {
  /** @type {Map<number, {frame: import('electron').WebFrameMain, origin: string, authenticated: boolean, method: string | null, headers: string | null}>} */
  requests = new Map()

  /**
   * Record final credentials while checking the renderer's unmodified origin.
   * @param {import('electron').OnBeforeSendHeadersListenerDetails} details
   * @param {string | null} [origin]
   */
  rememberRequest(details, origin = new Headers(details.requestHeaders).get('Origin')) {
    const { frame, webContents, id } = details
    if (!frame || frame !== webContents?.mainFrame || !isOpenTubeXUrl(frame.url)) {
      this.requests.delete(id)
      return
    }

    const headers = new Headers(details.requestHeaders)
    const frameUrl = new URL(frame.url)
    const appOrigin = `${frameUrl.protocol}//${frameUrl.host}`
    // Chromium changes Origin to null on a cross-origin redirect. Only accept
    // that for a request already authorized for this exact frame.
    const redirected = origin === 'null' && this.requests.get(id)?.frame === frame
    if (origin !== appOrigin && !redirected) {
      this.requests.delete(id)
      return
    }

    this.requests.set(id, {
      frame,
      origin,
      authenticated: headers.has('Authorization'),
      method: details.method === 'OPTIONS' ? headers.get('Access-Control-Request-Method') : null,
      headers: headers.get('Access-Control-Request-Headers')
    })
  }

  /**
   * @param {import('electron').OnHeadersReceivedListenerDetails} details
   * @returns {import('electron').HeadersReceivedResponse}
   */
  allowResponse(details) {
    const request = this.requests.get(details.id)
    if (!request || request.frame !== details.frame ||
      details.frame !== details.webContents?.mainFrame || !isOpenTubeXUrl(details.frame.url)) {
      return {}
    }

    // Replace existing grants instead of emitting conflicting duplicate headers.
    const responseHeaders = Object.fromEntries(Object.entries(details.responseHeaders ?? {})
      .filter(([name]) => !/^access-control-(allow|expose)-/i.test(name))
      .map(([name, values]) => [name.toLowerCase(), values]))
    responseHeaders['access-control-allow-origin'] = [request.origin]
    responseHeaders['access-control-allow-credentials'] = ['true']
    responseHeaders.vary = [...(responseHeaders.vary ?? []), 'Origin']
    responseHeaders['access-control-expose-headers'] = [Object.keys(responseHeaders)
      .filter(name => name !== 'set-cookie' && name !== 'set-cookie2')
      .join(', ')]

    if (request.origin === 'null' || request.authenticated) {
      // Do not reuse opaque-origin grants or account data after credentials change.
      responseHeaders['cache-control'] = ['no-store']
    }

    if (request.method) {
      responseHeaders['access-control-allow-methods'] = [request.method]
      if (request.headers) responseHeaders['access-control-allow-headers'] = [request.headers]
      // Native APIs need not implement OPTIONS. Only a browser-generated CORS
      // preflight gets a synthetic success; actual API error statuses survive.
      return { responseHeaders, statusLine: 'HTTP/1.1 204 No Content' }
    }

    return { responseHeaders }
  }

  /** @param {{id: number}} details */
  forgetRequest({ id }) {
    this.requests.delete(id)
  }
}
