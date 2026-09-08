import { KeepAwake } from '@capacitor-community/keep-awake'

export function createPlaybackScreenWake(plugin) {
  const videos = new Set()
  let appActive = false
  let applied = null
  let pending = Promise.resolve()

  function sync() {
    // Capacitor calls are asynchronous. Serialize them and read the latest
    // state so a delayed acquisition cannot outlive pause or backgrounding.
    pending = pending.then(async () => {
      const awake = appActive && videos.size > 0
      if (awake === applied) return
      if (awake) await plugin.keepAwake()
      else await plugin.allowSleep()
      applied = awake
    }).catch(error => {
      applied = null
      console.error('Failed to update playback screen wake', error)
    })
  }

  return {
    setAppActive(active) {
      appActive = active
      sync()
    },
    bindVideo(element, isPresentedVideo) {
      const owner = Symbol('video')
      const events = ['play', 'playing', 'pause', 'ended', 'emptied', 'error', 'loadedmetadata']
      let destroyed = false
      let failed = false
      function update(event) {
        if (destroyed) return
        if (event?.type === 'error' || event?.type === 'emptied') failed = true
        else if (['play', 'playing', 'loadedmetadata'].includes(event?.type)) failed = false
        if (!failed && !element.paused && !element.ended && isPresentedVideo()) videos.add(owner)
        else videos.delete(owner)
        sync()
      }
      for (const event of events) element.addEventListener(event, update)
      update()
      return {
        update,
        destroy() {
          destroyed = true
          for (const event of events) element.removeEventListener(event, update)
          videos.delete(owner)
          sync()
        },
      }
    },
  }
}

export const playbackScreenWake = process.env.IS_CAPACITOR
  ? createPlaybackScreenWake(KeepAwake)
  : null
