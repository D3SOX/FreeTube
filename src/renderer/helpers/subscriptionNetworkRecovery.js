// Distinguish transport failures from errors in parsing or cache updates.
export class SubscriptionNetworkError extends Error {
  constructor(cause) {
    super('Subscription refresh is waiting for the network', { cause })
  }
}

const INITIAL_RETRY_DELAY_MS = 5000
const MAX_RETRY_DELAY_MS = 60_000

/**
 * Pauses all channel workers after a transport failure. Once the connection
 * returns, one channel checks it before the rest of the queue resumes.
 * @param {{ eventTarget: EventTarget, isOnline: () => boolean, allowFallback?: boolean }} options
 */
export function createSubscriptionNetworkRecovery({ eventTarget, isOnline, allowFallback = false }) {
  const cancellation = new AbortController()
  let recovery = null
  let useFallback = false

  function waitForConnection(delay) {
    return new Promise(resolve => {
      let timer
      const finish = () => {
        clearTimeout(timer)
        eventTarget.removeEventListener('online', onOnline)
        eventTarget.removeEventListener('offline', onOffline)
        cancellation.signal.removeEventListener('abort', finish)
        resolve()
      }
      const onOnline = () => {
        if (isOnline()) finish()
      }
      const onOffline = () => { clearTimeout(timer) }
      eventTarget.addEventListener('online', onOnline)
      eventTarget.addEventListener('offline', onOffline)
      cancellation.signal.addEventListener('abort', finish, { once: true })
      // WebView can report online despite a broken route or unreachable server.
      // Probe with backoff in that case, but send nothing while actually offline.
      if (isOnline()) timer = setTimeout(finish, delay)
      if (cancellation.signal.aborted) finish()
    })
  }

  async function recover(task) {
    let delay = INITIAL_RETRY_DELAY_MS
    while (!cancellation.signal.aborted) {
      await waitForConnection(delay)
      if (cancellation.signal.aborted) return
      if (!isOnline()) continue
      try {
        await task(useFallback)
        return
      } catch (error) {
        if (!(error instanceof SubscriptionNetworkError)) throw error
        if (allowFallback && isOnline() && !cancellation.signal.aborted) {
          try {
            await task(!useFallback)
            // Keep the working backend for this refresh, including later batches.
            useFallback = !useFallback
            return
          } catch (fallbackError) {
            if (!(fallbackError instanceof SubscriptionNetworkError)) throw fallbackError
          }
        }
        delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS)
      }
    }
  }

  function startRecovery(task) {
    recovery = recover(task).finally(() => { recovery = null })
    return recovery
  }

  return {
    cancel() { cancellation.abort() },
    async run(task) {
      while (!cancellation.signal.aborted) {
        if (recovery) {
          await recovery
          continue
        }
        if (!isOnline()) {
          await startRecovery(task)
          return
        }
        try {
          await task(useFallback)
          return
        } catch (error) {
          if (!(error instanceof SubscriptionNetworkError)) throw error
          if (!recovery) {
            await startRecovery(task)
            return
          }
        }
      }
    }
  }
}
