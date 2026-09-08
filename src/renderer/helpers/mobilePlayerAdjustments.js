// Serialize native calls so a slow read or write cannot undo a newer swipe.
export function createMobilePlayerAdjustments({ read, write, onChange, onError, getPlaybackRateOptions }) {
  let queue = Promise.resolve()
  let gesture = null
  let generation = 0
  let originalBrightness = null
  let fullscreenBrightness = null

  function enqueue(task) {
    queue = queue.then(task).catch(onError)
    return queue
  }

  function begin(action) {
    const current = { action, generation, cancelled: false, revision: 0, initial: null, delta: 0, lastValue: null }
    gesture = current
    enqueue(async () => {
      if (current.cancelled || current.generation !== generation) return
      const value = await read(action)
      if (!Number.isFinite(value)) throw new Error(`Invalid ${action} level`)
      if (current.cancelled || current.generation !== generation) return
      if (action === 'brightness' && originalBrightness === null) originalBrightness = value
      // Android reports -1 while following the system brightness. The plugin
      // does not expose that system level, so start the app override halfway.
      current.initial = value < 0 ? 0.5 : value
      current.lastValue = value
    })
  }

  function update(delta) {
    const current = gesture
    if (!current) return
    const revision = ++current.revision
    enqueue(async () => {
      if (current.cancelled || current.generation !== generation || current.initial === null) return
      const speed = current.action === 'speed'
      const { maximum = 1, step = 0 } = speed ? getPlaybackRateOptions() : {}
      const minimum = speed ? Math.max(0.1, step) : current.action === 'brightness' ? 0.01 : 0
      // A full player-height swipe changes speed by 2x, independently of the
      // configured maximum. Keep sub-step movement until it adds up to a step.
      const value = Math.max(minimum, Math.min(maximum, current.initial + (delta - current.delta) * (speed ? 2 : 1)))
      // Anchor at each clamped value so reversing at a limit responds at once.
      // Process coalesced moves too: a quick reversal can cross a limit while
      // the native read or previous write is still pending.
      current.initial = value
      current.delta = delta
      if (revision !== current.revision) return
      const output = speed ? Number(Math.max(minimum, Math.min(maximum, Math.round(value / step) * step)).toFixed(2)) : value
      if (speed && output === current.lastValue) return
      await write(current.action, output)
      current.lastValue = output
      if (!current.cancelled && current.generation === generation) onChange(current.action, output)
    })
  }

  function finish() {
    gesture = null
  }

  function cancel() {
    if (gesture) gesture.cancelled = true
    gesture = null
  }

  function reset() {
    cancel()
    generation++
    return enqueue(async () => {
      if (originalBrightness === null) return
      const brightness = originalBrightness
      await write('brightness', brightness)
      originalBrightness = null
      fullscreenBrightness = null
    })
  }

  function setFullscreenBrightness(enabled) {
    cancel()
    generation++
    const currentGeneration = generation
    return enqueue(async () => {
      if (currentGeneration !== generation) return
      if (enabled) {
        const brightness = await read('brightness')
        if (currentGeneration !== generation) return
        if (!Number.isFinite(brightness)) throw new Error('Invalid brightness level')
        if (originalBrightness === null) originalBrightness = brightness
        if (fullscreenBrightness === null) fullscreenBrightness = brightness
        await write('brightness', 1)
      } else if (fullscreenBrightness !== null) {
        await write('brightness', fullscreenBrightness)
        fullscreenBrightness = null
      }
    })
  }

  return { begin, update, finish, cancel, reset, setFullscreenBrightness, settled: () => queue }
}
