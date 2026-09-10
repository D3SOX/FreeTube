import { isAppHidden } from './appVisibility.js'
import { createInternetConnectivity, createInternetProbe } from './internetConnectivity.js'
import { classifyRequestFailure } from './api/requestDiagnostics.js'
import { createAbortError } from './api/requestErrors.js'

const nonNetworkErrors = new WeakSet()
export function isRecoverableNetworkError(error) {
  return !nonNetworkErrors.has(error) && classifyRequestFailure(error) === 'network'
}

/**
 * One connectivity listener for the app. Each origin gets one recovery probe,
 * so an unavailable optional service cannot block YouTube or another backend.
 */
export function createNetworkRecovery({ eventTarget, isOnline, visibilityTarget, isVisible, checkInternet, internetChecksEnabled = true, onChange = () => {} }) {
  const connectivity = checkInternet ? createInternetConnectivity({ eventTarget, isOnline, probe: checkInternet, enabled: internetChecksEnabled, visibilityTarget, isVisible }) : null
  if (connectivity) {
    eventTarget = connectivity.events
    isOnline = () => connectivity.online
  }
  const shutdown = new AbortController()
  const origins = new Map()
  const delegatedSignals = new WeakSet()
  let state
  let restoredTimer
  let online = isOnline()

  function publish(next) {
    if (state === next) return
    clearTimeout(restoredTimer)
    state = next
    onChange(state)
    if (state === 'restored') restoredTimer = setTimeout(() => publish('online'), 3000)
  }

  function update() {
    // Only OS status and independent reachability checks set global status.
    // An individual origin can keep retrying without declaring an outage.
    if (!online) publish('offline')
    else if (state === 'offline') publish('restored')
    else if (!state) publish('online')
  }

  function connectivityChanged() {
    online = isOnline()
    update()
  }
  eventTarget.addEventListener('online', connectivityChanged)
  eventTarget.addEventListener('offline', connectivityChanged)
  update()

  function wait(delay, signal) {
    return new Promise((resolve, reject) => {
      let timer
      const finish = (error) => {
        clearTimeout(timer)
        eventTarget.removeEventListener('online', connected)
        eventTarget.removeEventListener('offline', disconnected)
        signal.removeEventListener('abort', aborted)
        if (error) reject(error)
        else resolve()
      }
      const connected = () => { if (isOnline()) finish() }
      const disconnected = () => { clearTimeout(timer) }
      const aborted = () => finish(createAbortError())
      eventTarget.addEventListener('online', connected)
      eventTarget.addEventListener('offline', disconnected)
      signal.addEventListener('abort', aborted, { once: true })
      if (isOnline()) timer = setTimeout(() => finish(), delay)
      if (signal.aborted) aborted()
    })
  }

  function waitForPromise(promise, signal) {
    return new Promise((resolve, reject) => {
      const aborted = () => reject(createAbortError())
      signal.addEventListener('abort', aborted, { once: true })
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted))
      if (signal.aborted) aborted()
    })
  }

  async function run(originKey, task, { signal: callerSignal, retry = true, isNetworkError = error => classifyRequestFailure(error) === 'network' } = {}) {
    const signal = callerSignal ? AbortSignal.any([callerSignal, shutdown.signal]) : shutdown.signal
    if (signal.aborted) throw createAbortError()
    if (connectivity) await waitForPromise(connectivity.ready, signal)
    if (signal.aborted) throw createAbortError()
    let origin = origins.get(originKey)
    if (!origin) {
      origin = { failed: false, probe: null, users: 0 }
      origins.set(originKey, origin)
    }
    origin.users++
    try {
      for (;;) {
        if (signal.aborted) throw createAbortError()
        if (origin.probe) {
          // A cancelled probe must release its followers, not cancel them.
          await waitForPromise(origin.probe, signal)
          continue
        }
        if (!online || origin.failed) {
          origin.failed = true
          let release
          origin.probe = new Promise(resolve => { release = resolve })
          try {
            let delay = 5000
            for (;;) {
              await wait(delay, signal)
              if (!online) continue
              try {
                const result = await task(signal)
                origin.failed = false
                return result
              } catch (error) {
                if (signal.aborted) throw createAbortError()
                const networkError = await isNetworkError(error)
                if (!networkError) {
                  origin.failed = false
                  throw error
                }
                if (online && connectivity) await waitForPromise(connectivity.check(), signal)
                if (!retry) throw error
                origin.failed = true
                delay = Math.min(delay * 2, 60000)
              }
            }
          } finally {
            origin.probe = null
            release()
          }
        }
        try {
          return await task(signal)
        } catch (error) {
          if (signal.aborted || !await isNetworkError(error)) throw error
          if (online && connectivity) await waitForPromise(connectivity.check(), signal)
          if (!retry) throw error
          origin.failed = true
        }
      }
    } finally {
      origin.users--
      if (origin.users === 0) {
        origins.delete(originKey)
      }
    }
  }

  return {
    run,
    setInternetChecksEnabled(enabled) {
      connectivity?.setEnabled(enabled)
      if (!enabled && online) publish('online')
    },
    get ready() { return connectivity?.ready ?? Promise.resolve(online) },
    checkConnection: () => connectivity?.check() ?? Promise.resolve(online),
    // A whole-operation retry can own its transport calls, including backend
    // fallback. Those calls must not wait in a second, nested recovery queue.
    delegateRequests(signal) {
      delegatedSignals.add(signal)
      return () => delegatedSignals.delete(signal)
    },
    ownsRequests(signal) { return delegatedSignals.has(signal) },
    get state() { return state },
    dispose() {
      shutdown.abort()
      connectivity?.dispose()
      clearTimeout(restoredTimer)
      eventTarget.removeEventListener('online', connectivityChanged)
      eventTarget.removeEventListener('offline', connectivityChanged)
    }
  }
}

let appRecovery
export const connectionEvents = new EventTarget()
export function getConnectionState() { return appRecovery?.state ?? 'online' }

export function initializeNetworkRecovery({ checkInternet, internetChecksEnabled } = {}) {
  if (!appRecovery) {
    appRecovery = createNetworkRecovery({
      checkInternet,
      internetChecksEnabled,
      eventTarget: window,
      visibilityTarget: typeof document === 'undefined' ? undefined : document,
      isVisible: () => !isAppHidden(),
      isOnline: () => navigator.onLine !== false,
      onChange: state => connectionEvents.dispatchEvent(new CustomEvent('change', { detail: state }))
    })
  }
  return appRecovery
}

/** Use the same queue for native HTTP and WebView requests. */
export function withNetworkRecovery(input, init, task, options = {}) {
  if (typeof window === 'undefined') return task(init?.signal)
  const request = input instanceof Request ? input : null
  const signal = init?.signal ?? request?.signal
  if (appRecovery?.ownsRequests(signal)) {
    return task(signal).catch(async error => {
      // Keep transport classification when the caller owns the retry policy.
      await options.isNetworkError?.(error)
      throw error
    })
  }
  const url = new URL(request?.url ?? input.toString(), location.href)
  if (!['http:', 'https:'].includes(url.protocol) || url.origin === location.origin) return task(init?.signal ?? request?.signal)
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
  // YouTube's browse/search/player APIs use POST for read-only queries.
  const retry = ['GET', 'HEAD'].includes(method) ||
    (method === 'POST' && /(^|\.)youtube\.com$/.test(url.hostname) &&
      /^\/youtubei\/v1\/(browse|search|player|next|guide|get_transcript|navigation\/resolve_url|updated_metadata)$/.test(url.pathname))
  return initializeNetworkRecovery().run(url.origin, task, { ...options, signal: init?.signal ?? request?.signal, retry })
}

export function installNetworkFetch({ corsDisabled = false, checkInternet = false, internetChecksEnabled = true } = {}) {
  const fetch = window.fetch.bind(window)
  initializeNetworkRecovery({ checkInternet: checkInternet ? createInternetProbe(fetch) : undefined, internetChecksEnabled })
  window.fetch = async (input, init) => withNetworkRecovery(input, init, async signal => {
    // A fetch can stall while the OS still reports online. Bound the wait for
    // response headers; media response bodies keep their streaming behavior.
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(new DOMException('Connection timed out', 'TimeoutError')), 30000)
    try {
      return await fetch(input instanceof Request ? input.clone() : input, {
        ...init,
        signal: signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal
      })
    } finally {
      clearTimeout(timer)
    }
  }, {
    async isNetworkError(error) {
      if (classifyRequestFailure(error) !== 'network') return false
      if (error.name !== 'TypeError' || navigator.onLine === false || corsDisabled) return true
      // Browsers hide CORS failures behind the same TypeError as a lost route.
      // Use the shared connectivity check to distinguish an internet outage.
      const networkError = !await appRecovery.checkConnection()
      if (!networkError) nonNetworkErrors.add(error)
      return networkError
    }
  })
}
