/**
 * Keeps native events and SABR reads scoped to one playback owner. The caller
 * supplies the Capacitor plugin so transport lifetime can be tested independently.
 */
export async function createAndroidPlaybackController(plugin, {
  owner, continueInBackground, onState, onError, onScreenAction, isCurrent = () => true,
}) {
  let source = null
  let loaded = false
  let closed = false
  let suspended = false
  let state = {}
  const listeners = []

  async function close() {
    if (closed) return
    closed = true
    source?.close?.()
    source = null
    await Promise.allSettled(listeners.map(listener => listener.remove()))
    // Release is owner-checked. A delayed close must never clear a newer tab.
    await plugin.release({ owner }).catch(() => {})
  }

  try {
    listeners[0] = await plugin.addListener('state', event => {
      if (closed || suspended || event.owner !== owner) return
      state = event
      suspended = event.event === 'suspended'
      onState(event)
    })
    listeners[1] = await plugin.addListener('segment', async event => {
      if (closed || suspended || event.owner !== owner) return
      const requestedSource = source
      try {
        if (!requestedSource?.read) throw new Error('No SABR source is loaded')
        const bytes = await requestedSource.read(event)
        if (closed || suspended || source !== requestedSource) throw new Error('Playback was replaced')
        const parts = []
        for (let i = 0; i < bytes.length; i += 32768) {
          parts.push(String.fromCharCode(...bytes.subarray(i, i + 32768)))
        }
        await plugin.respond({ requestId: event.requestId, data: btoa(parts.join('')) })
      } catch (error) {
        await plugin.respond({ requestId: event.requestId, error: String(error) }).catch(onError)
      }
    })
    if (onScreenAction) {
      listeners[2] = await plugin.addListener('screenAction', event => {
        if (!closed && !suspended && event.owner === owner) onScreenAction(event.action)
      })
    }
    if (!isCurrent()) throw new Error('Playback was replaced')
    await plugin.setOwner({ owner, continueInBackground })
  } catch (error) {
    await close()
    throw error
  }

  function ownedCall(method, options = {}) {
    if (closed || suspended) return Promise.reject(new Error('This tab no longer owns native playback'))
    return plugin[method]({ ...options, owner })
  }

  return {
    getState: () => state,
    async load(nextSource, options) {
      if (closed || suspended) throw new Error('Native playback is closed')
      // A fresh source gets a fresh owner, so old native range requests cannot
      // accidentally resolve against the same format index in a new manifest.
      if (loaded) throw new Error('A new source requires a new playback owner')
      loaded = true
      source = nextSource
      try {
        await plugin.loadSource({ ...options, owner, source: source.source, mimeType: source.mimeType })
      } catch (error) {
        nextSource.close?.()
        if (source === nextSource) source = null
        throw error
      }
    },
    command: (action, value) => ownedCall('command', { action, value }),
    show: options => ownedCall('show', options),
    hide: () => ownedCall('hide'),
    layout: options => ownedCall('screenLayout', options),
    captureFrame: options => ownedCall('captureFrame', options),
    getAudioSpectrum: () => ownedCall('getAudioSpectrum'),
    loadVoiceOver: options => ownedCall('loadVoiceOver', options),
    voiceOverCommand: options => ownedCall('voiceOverCommand', options),
    setContinueInBackground: enabled => ownedCall('configure', { continueInBackground: enabled }),
    setSeekPreferences: (seekSeconds, scaleSeekWithRate) => ownedCall('configure', { seekSeconds, scaleSeekWithRate }),
    close,
  }
}
