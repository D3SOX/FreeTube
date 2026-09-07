/** Wait for this tab to be presented before it can acquire native playback. */
export function createAndroidPlaybackGate(initiallyActive = true) {
  let active = initiallyActive
  const waiters = new Set()
  return {
    isActive: () => active,
    setActive(value) {
      active = value
      if (active) for (const resolve of [...waiters]) resolve()
    },
    wait(signal) {
      if (signal.aborted) return Promise.reject(signal.reason)
      if (active) return Promise.resolve()
      return new Promise((resolve, reject) => {
        const cleanup = () => {
          waiters.delete(finish)
          signal.removeEventListener('abort', abort)
        }
        const finish = () => { cleanup(); resolve() }
        const abort = () => { cleanup(); reject(signal.reason) }
        waiters.add(finish)
        signal.addEventListener('abort', abort, { once: true })
      })
    },
  }
}
