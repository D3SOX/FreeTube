/**
 * Track one video's repeat session. Time is wall-clock playing time, so playback
 * speed and seeks cannot turn skipped media time into time spent watching.
 *
 * @param {HTMLVideoElement} video
 * @param {(stats: { active: boolean, repeats: number, seconds: number }) => void} onChange
 * @param {() => number} [now]
 */
export function createRepeatStatsTracker(video, onChange, now = () => performance.now()) {
  let session = null
  let mode = null
  let repeats = 0
  let milliseconds = 0
  let waiting = false
  let playing = !video.paused && !video.seeking && video.readyState >= 3
  let lastClock = now()
  let position = null

  function publish() {
    onChange({ active: mode !== null, repeats, seconds: Math.floor(milliseconds / 1000) })
  }

  function accountTime() {
    const clock = now()
    if (mode !== null && playing) {
      milliseconds += Math.max(0, clock - lastClock)
    }
    lastClock = clock
  }

  function samplePosition() {
    position = { time: video.currentTime, clock: now(), rate: video.playbackRate }
  }

  function start() {
    accountTime()
    playing = !waiting && !video.paused && !video.seeking && video.readyState >= 3
    samplePosition()
    publish()
  }

  function stop() {
    accountTime()
    playing = false
    position = null
    publish()
  }

  function tick() {
    // Chromium sends timeupdate during seeks as well as during playback.
    if (video.seeking) return
    accountTime()
    samplePosition()
    publish()
  }

  function countNativeRepeat() {
    // Native looping seeks to zero without firing ended. Require enough natural
    // playback to have reached the end since the last sample; an ordinary
    // backwards seek, including one near the end, must not count as a repeat.
    if (
      mode === 'video' && playing && position !== null &&
      Number.isFinite(video.duration) && video.duration > 0 &&
      video.currentTime <= 0.05 && position.time > video.currentTime &&
      position.time + (now() - position.clock) / 1000 * position.rate >= video.duration - 0.02
    ) {
      repeats++
    }
  }

  function seek() {
    countNativeRepeat()
    stop()
  }

  function seeked() {
    // Android reports automatic repeat discontinuities as seeked only. An
    // explicit seek already cleared position, so it cannot count again here.
    countNativeRepeat()
    start()
  }

  const listeners = {
    playing: () => {
      waiting = false
      start()
    },
    pause: stop,
    waiting: () => {
      // A completed seek does not mean playback resumed after buffering or
      // native audio-focus suppression. Wait for the playing event.
      waiting = true
      stop()
    },
    ended: stop,
    emptied: stop,
    error: stop,
    seeking: seek,
    seeked,
    timeupdate: tick,
    ratechange: tick,
  }
  for (const [event, listener] of Object.entries(listeners)) {
    video.addEventListener(event, listener)
  }

  return {
    /** @param {string | null} nextMode A stable range key, 'video', or null when disabled. */
    setMode(nextMode) {
      accountTime()
      if (nextMode !== null && nextMode !== session) {
        session = nextMode
        repeats = 0
        milliseconds = 0
      }
      mode = nextMode
      samplePosition()
      publish()
    },
    /** Called only when natural A-B playback reaches the repeat boundary. */
    repeat() {
      accountTime()
      if (mode !== null) repeats++
      publish()
    },
    reset() {
      repeats = 0
      milliseconds = 0
      session = null
      position = null
      lastClock = now()
      publish()
    },
    destroy() {
      for (const [event, listener] of Object.entries(listeners)) {
        video.removeEventListener(event, listener)
      }
    },
  }
}
