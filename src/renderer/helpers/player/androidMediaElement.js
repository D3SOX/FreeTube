/**
 * Lets shared Watch features control native playback through the existing media
 * element contract. The element carries events and layout, not decoded media.
 */
export function attachAndroidMediaElement(element, { command, load, onError, now = () => performance.now() }) {
  const original = new Map()
  let state = { position: 0, duration: NaN, paused: true, playing: false, buffering: false, ready: false, ended: false }
  let sampledAt = now()
  let loaded = false
  let source = ''
  let volume = element.volume
  let outputGain = 1
  let muted = element.muted
  let rate = element.playbackRate
  let defaultRate = element.defaultPlaybackRate
  let loop = element.loop
  let seeking = false
  let seekSequence = 0
  let pendingPause = false
  let pauseSequence = 0
  let nativePosition = 0
  let detached = false
  const removeAttribute = element.removeAttribute

  function emit(type) { element.dispatchEvent(new Event(type)) }
  function send(action, value) { return command(action, value).catch(onError) }
  function outputVolume() { return muted ? 0 : volume * outputGain }
  function position() {
    const elapsed = state.playing && !seeking ? Math.max(0, now() - sampledAt) / 1000 * rate : 0
    const end = state.duration > 0 ? state.duration : Infinity
    return Math.min(end, state.position + elapsed)
  }
  function define(name, descriptor) {
    original.set(name, Object.getOwnPropertyDescriptor(element, name))
    Object.defineProperty(element, name, { configurable: true, ...descriptor })
  }
  function ranges(start, end) {
    const length = Number.isFinite(end) && end > start ? 1 : 0
    const read = (index, value) => {
      if (index !== 0 || length === 0) throw new DOMException('No media range at this index', 'IndexSizeError')
      return value
    }
    return { length, start: index => read(index, start), end: index => read(index, end) }
  }

  // Native playback never gives the DOM video intrinsic decoder dimensions.
  // Reserve its ratio before thumbnails, empty posters and captured frames load.
  element.style.aspectRatio = '16 / 9'
  element.pause()
  define('currentTime', {
    get: position,
    set(value) {
      if (!Number.isFinite(value)) return
      state = { ...state, position: Math.max(0, value) }
      sampledAt = now()
      seeking = true
      const sequence = ++seekSequence
      emit('seeking')
      command('seek', value).catch(error => {
        if (!detached && sequence === seekSequence) {
          seeking = false
          state = { ...state, position: nativePosition }
          sampledAt = now()
          emit('seeked')
          onError(error)
        }
      })
    }
  })
  define('duration', { get: () => state.duration })
  define('paused', { get: () => state.paused })
  define('ended', { get: () => state.ended })
  define('seeking', { get: () => seeking })
  define('readyState', { get: () => state.ready ? 4 : loaded ? 1 : 0 })
  define('networkState', { get: () => state.buffering ? 2 : loaded ? 1 : 0 })
  define('videoWidth', { get: () => state.width ?? 0 })
  define('videoHeight', { get: () => state.height ?? 0 })
  define('getVideoPlaybackQuality', {
    value: () => ({
      creationTime: now(),
      totalVideoFrames: state.totalFrames ?? 0,
      droppedVideoFrames: state.droppedFrames ?? 0,
      corruptedVideoFrames: 0,
    })
  })
  define('buffered', { get: () => ranges(state.position, state.bufferedPosition) })
  define('seekable', { get: () => ranges(0, state.seekable === false ? 0 : state.duration) })
  define('volume', {
    get: () => volume,
    set(value) {
      if (!Number.isFinite(value)) return
      volume = Math.max(0, Math.min(1, value))
      send('volume', outputVolume())
      emit('volumechange')
    }
  })
  define('muted', {
    get: () => muted,
    set(value) {
      muted = Boolean(value)
      send('volume', outputVolume())
      emit('volumechange')
    }
  })
  define('playbackRate', {
    get: () => rate,
    set(value) {
      if (!Number.isFinite(value) || value <= 0) return
      state = { ...state, position: position() }
      sampledAt = now()
      rate = value
      send('speed', rate)
      emit('ratechange')
    }
  })
  define('defaultPlaybackRate', { get: () => defaultRate, set: value => { defaultRate = value } })
  define('loop', { get: () => loop, set(value) { loop = Boolean(value); send('loop', loop ? 1 : 0) } })
  define('play', {
    value: () => {
      pendingPause = false
      pauseSequence++
      return command('play')
    }
  })
  define('pause', {
    value: () => {
      const changed = !state.paused
      pendingPause = true
      const sequence = ++pauseSequence
      state = { ...state, position: position(), paused: true, playing: false }
      sampledAt = now()
      if (changed) emit('pause')
      command('pause').catch(error => {
        if (!detached && sequence === pauseSequence) pendingPause = false
        onError(error)
      })
    }
  })
  define('src', { get: () => source, set(value) { source = String(value); load(source).catch(onError) } })
  define('currentSrc', { get: () => source })
  define('removeAttribute', {
    value: name => {
      if (name.toLowerCase() === 'src') source = ''
      removeAttribute?.call(element, name)
    }
  })
  define('load', { value: () => { load(source).catch(onError) } })

  return {
    outputVolume,
    setOutputGain(value) {
      outputGain = Math.max(0, Math.min(1, value))
      return command('volume', outputVolume())
    },
    update(next) {
      if (detached) return
      const previous = state
      state = { ...state, ...next }
      // A snapshot queued before pause() must not replay a play/pause pair in
      // the shared controls while Android is still processing that command.
      if (pendingPause) {
        if (next.paused === true) pendingPause = false
        else state = { ...state, paused: true, playing: false, position: previous.position }
      }
      if (Number.isFinite(next.position)) nativePosition = next.position
      if (seeking && next.event !== 'seeked') state.position = previous.position
      sampledAt = now()
      if (state.width > 0 && state.height > 0) {
        const aspectRatio = `${state.width} / ${state.height}`
        if (element.style.aspectRatio !== aspectRatio) element.style.aspectRatio = aspectRatio
      }
      if (next.playbackRate !== undefined && next.playbackRate !== rate) {
        rate = next.playbackRate
        emit('ratechange')
      }
      if (next.ready && !loaded) {
        loaded = true
        emit('loadedmetadata')
        emit('loadeddata')
        emit('canplay')
      }
      if (next.duration !== undefined && next.duration !== previous.duration) emit('durationchange')
      if (state.width !== previous.width || state.height !== previous.height) emit('resize')
      if (state.paused !== previous.paused) emit(state.paused ? 'pause' : 'play')
      if (next.buffering && !previous.buffering) emit('waiting')
      if (state.playing && !previous.playing) emit('playing')
      if (next.event === 'seeked') { seeking = false; emit('seeked') }
      if (next.ended && !previous.ended) emit('ended')
      emit('timeupdate')
    },
    reset() {
      pendingPause = false
      pauseSequence++
      seekSequence++
      nativePosition = 0
      source = ''
      loaded = false
      seeking = false
      state = { position: 0, duration: NaN, paused: true, playing: false, buffering: false, ready: false, ended: false }
      sampledAt = now()
      emit('emptied')
    },
    setSource(value) { source = value },
    detach() {
      detached = true
      for (const [name, descriptor] of original) {
        if (descriptor) Object.defineProperty(element, name, descriptor)
        else delete element[name]
      }
    },
  }
}
