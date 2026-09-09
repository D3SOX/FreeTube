import { initializeNetworkRecovery } from './networkRecovery.js'

// Distinguish transport failures from errors in parsing or cache updates.
export class SubscriptionNetworkError extends Error {
  constructor(cause) {
    super('Subscription refresh is waiting for the network', { cause })
  }
}

/** Uses the app's recovery queue while retaining the refresh's backend policy. */
export function createSubscriptionNetworkRecovery({ recovery = initializeNetworkRecovery(), signal, allowFallback = false } = {}) {
  const cancellation = new AbortController()
  const releaseRequests = recovery.delegateRequests(signal ?? cancellation.signal)
  let useFallback = false

  return {
    cancel() {
      cancellation.abort()
      releaseRequests()
    },
    async run(task) {
      let retrying = false
      try {
        await recovery.run(cancellation.signal, async () => {
          try {
            await task(useFallback)
          } catch (error) {
            if (!(error instanceof SubscriptionNetworkError)) throw error
            if (retrying && allowFallback && !cancellation.signal.aborted) {
              await task(!useFallback)
              // Reuse the working backend for the rest of this refresh.
              useFallback = !useFallback
              return
            }
            retrying = true
            throw error
          }
        }, { signal: cancellation.signal, isNetworkError: error => error instanceof SubscriptionNetworkError })
      } catch (error) {
        if (!cancellation.signal.aborted) throw error
      }
    }
  }
}
