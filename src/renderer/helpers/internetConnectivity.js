// A dedicated empty-response endpoint. No user data is included in the check.
export const INTERNET_CHECK_URL = 'https://connectivitycheck.grapheneos.network/generate_204'

/** Uses the original fetch, outside the retry queue and without cached replies. */
export function createInternetProbe(fetch) {
  return async signal => {
    if (signal.aborted) return false
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    try {
      const response = await fetch(INTERNET_CHECK_URL, {
        method: 'HEAD',
        mode: 'no-cors',
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        // Browsers reject no-CORS requests unless redirects are followed.
        redirect: 'follow',
        signal: AbortSignal.any([signal, controller.signal]),
      })
      // An opaque no-CORS response still proves that the HTTPS host replied.
      // HTTP errors also establish reachability, unlike a transport failure.
      return response.type === 'opaque' || (response.status >= 100 && response.status <= 599)
    } catch {
      return false
    } finally {
      clearTimeout(timer)
      controller.abort()
    }
  }
}

/** Combines OS connectivity with bounded, shared internet reachability checks. */
export function createInternetConnectivity({ eventTarget, isOnline, probe, enabled = true, visibilityTarget, isVisible = () => true }) {
  const events = new EventTarget()
  let online = isOnline()
  let disposed = false
  let timer
  let controller
  let pending
  let retryDelay = 5000

  function publish(value) {
    if (online === value) return
    online = value
    events.dispatchEvent(new Event(value ? 'online' : 'offline'))
  }

  function check() {
    if (disposed || !enabled || !isOnline()) return Promise.resolve(!disposed && isOnline())
    if (pending) return pending
    clearTimeout(timer)
    const current = new AbortController()
    controller = current
    pending = Promise.resolve().then(() => probe(current.signal)).catch(() => false).then(reachable => {
      // Ignore results from a previous network or a disposed app.
      if (controller !== current || current.signal.aborted) return online
      publish(isOnline() && reachable)
      if (online) {
        retryDelay = 5000
      } else {
        timer = setTimeout(check, retryDelay)
        retryDelay = Math.min(retryDelay * 2, 60000)
      }
      return online
    }).finally(() => {
      if (controller === current) pending = undefined
    })
    return pending
  }

  function connectivityChanged() {
    clearTimeout(timer)
    controller?.abort()
    controller = undefined
    pending = undefined
    retryDelay = 5000
    if (!enabled || !isOnline()) publish(isOnline())
    else check()
  }
  function visibilityChanged() {
    if (isVisible()) check()
  }
  visibilityTarget?.addEventListener('visibilitychange', visibilityChanged)
  eventTarget.addEventListener('online', connectivityChanged)
  eventTarget.addEventListener('offline', connectivityChanged)
  check()

  return {
    events,
    check,
    setEnabled(value) {
      if (enabled === value) return
      enabled = value
      connectivityChanged()
    },
    get online() { return online },
    get ready() { return pending ?? Promise.resolve(online) },
    dispose() {
      disposed = true
      clearTimeout(timer)
      controller?.abort()
      visibilityTarget?.removeEventListener('visibilitychange', visibilityChanged)
      eventTarget.removeEventListener('online', connectivityChanged)
      eventTarget.removeEventListener('offline', connectivityChanged)
    }
  }
}
