import shaka from 'shaka-player'
import { registerPlugin } from '@capacitor/core'
import { createAndroidPlaybackController } from './androidPlaybackController'
import { attachAndroidMediaElement } from './androidMediaElement'
import { androidPlaybackTracks } from './androidPlaybackTracks'
import { createAndroidSabrSource } from './androidSabrSource'
import { MANIFEST_TYPE_SABR } from './SabrManifestParser'
import { createAndroidNativeScreen } from './androidNativeScreen'
import { createAndroidPlaybackGate } from './androidPlaybackGate'
import { attachAndroidVideoFrames } from './androidVideoFrames'
import { overrideShakaMethods } from './overrideShakaMethods'
import { androidCaptionCues } from './androidCaptionCues'

const AndroidPlayback = registerPlugin('AndroidPlayback')

/**
 * Native decoding with the media and track contracts used by Watch's shared
 * features. Shaka supplies its controls, text display and networking utilities;
 * no Shaka streaming engine or second decoder is loaded.
 */
export function createAndroidPlayer(element, container, getOptions) {
  const player = new shaka.Player()
  const methods = {}
  player.setVideoContainer(container)
  const originalAttach = player.attach.bind(player)
  const originalDestroy = player.destroy.bind(player)
  const originalUnload = player.unload.bind(player)
  const originalConfigure = player.configure.bind(player)
  const originalStats = player.getStats.bind(player)
  let controller = null
  let media = null
  let state = {}
  let tracks = []
  let manifestData = null
  let textTracks = []
  let imageTracks = []
  let textDisplayer = null
  let textVisible = false
  let nativeCues = []
  let textGeneration = 0
  let loadGeneration = 0
  let loading = null
  let loadAbort = null
  let suspended = false
  const gate = createAndroidPlaybackGate(getOptions().presented !== false)
  let destroyed = false
  let currentSource = null
  let defaultTrickPlayRate = null
  let reverseTimer = null
  let detachVideoFrames = null
  let voiceOver = null
  const screen = createAndroidNativeScreen({
    element,
    container,
    getController: () => controller,
    getLocale: () => getOptions().locale,
    isFullscreenOnRotationEnabled: () => getOptions().fullscreenOnRotation,
    hasVideoCanvas: () => {
      const canvas = getOptions().vrCanvas
      return !!canvas && getComputedStyle(canvas).display !== 'none'
    },
    onError: report
  })

  function dispatch(type, values = {}) {
    player.dispatchEvent(new shaka.util.FakeEvent(type, new Map(Object.entries(values))))
  }
  function report(error) {
    if (destroyed) return
    const detail = error instanceof shaka.util.Error
      ? error
      : new shaka.util.Error(
          shaka.util.Error.Severity.CRITICAL, shaka.util.Error.Category.MEDIA,
          shaka.util.Error.Code.VIDEO_ERROR, error)
    dispatch('error', { detail })
  }
  function command(action, value) {
    return controller ? controller.command(action, value) : Promise.resolve()
  }
  function syncNativeCaptions(cues) {
    if (!controller) return
    AndroidPlayback.setCaptionCues({ owner: state.owner, cues, visible: textVisible }).catch(report)
  }
  function variants() { return androidPlaybackTracks(tracks, manifestData?.formats).variants }
  function selectNative(track) {
    if (!controller || !track) return Promise.resolve()
    return AndroidPlayback.selectTrack({ owner: state.owner, type: track.type, group: track.group, index: track.index })
  }
  async function fetchBytes(uri) {
    const request = shaka.net.NetworkingEngine.makeRequest([uri], player.getConfiguration().streaming.retryParameters)
    return (await player.getNetworkingEngine().request(shaka.net.NetworkingEngine.RequestType.SEGMENT, request).promise).data
  }
  function makeTextTrack(caption) {
    const track = {
      ...caption,
      id: textTracks.length,
      originalTextId: caption.id,
      active: false,
      type: 'text',
      kind: 'captions',
      roles: [],
      codecs: '',
      forced: false,
      primary: false
    }
    textTracks.push(track)
    return track
  }

  function displayNativeCues() {
    if (!textDisplayer || !textTracks.some(track => track.active && track.nativeTrack)) return
    textDisplayer.remove(0, Infinity)
    textDisplayer.append(nativeCues.map(payload => {
      // Media3 sends a new cue group, including an empty group at its end.
      const cue = new shaka.text.Cue(state.position ?? 0, Infinity, payload)
      shaka.text.Cue.parseCuePayload(cue)
      return cue
    }))
  }

  function attachMedia() {
    media = attachAndroidMediaElement(element, {
      command,
      load: uri => uri ? player.load(uri, element.currentTime) : Promise.resolve(),
      onError: report,
    })
    element.nativePlayback = player.nativePlayback
  }
  methods.attach = async (video = element) => {
    await originalAttach(video, false)
    textDisplayer = new shaka.text.UITextDisplayer(player)
    textDisplayer.configure(player.getConfiguration().textDisplayer)
    attachMedia()
    if (getOptions().vrCanvas) {
      detachVideoFrames = attachAndroidVideoFrames(element, getOptions().vrCanvas, {
        captureFrame: options => controller.captureFrame(options),
        canCapture: () => !!controller && screen.hasSurface() && element.readyState >= 2,
        onError: error => { if (!String(error).includes('No video frame')) console.warn('Unable to capture a native VR frame', error) },
      })
    }
  }
  methods.load = async (uri, startTime = 0, mimeType, autoplay = element.autoplay) => {
    const generation = ++loadGeneration
    dispatch('loading')
    loadAbort?.abort(new Error('Playback was replaced'))
    const abort = new AbortController()
    loadAbort = abort
    const previousController = controller
    controller = null
    const reopenScreen = screen.isOpen()
    screen.reset()
    loading?.reject(new Error('Playback was replaced'))
    loading = null
    await previousController?.close()
    if (destroyed || generation !== loadGeneration) return
    media?.reset()
    media?.setSource(uri)
    textGeneration++
    textDisplayer?.remove(0, Infinity)
    textVisible = false
    nativeCues = []
    tracks = []
    state = {}
    textTracks = []
    imageTracks = []
    suspended = false
    currentSource = { uri, mimeType }
    await gate.wait(abort.signal)
    if (destroyed || generation !== loadGeneration) return
    const options = getOptions()
    const initialSettings = { volume: media.outputVolume(), rate: element.playbackRate, loop: element.loop }
    manifestData = mimeType === MANIFEST_TYPE_SABR
      ? JSON.parse(decodeURIComponent(uri.slice(uri.indexOf(',') + 1)))
      : null
    for (const caption of manifestData?.captions ?? options.captions ?? []) makeTextTrack(caption)
    imageTracks = (manifestData?.storyboards ?? []).map((storyboard, id) => ({ ...storyboard, id, type: 'image' }))
    const owner = `android-${crypto.randomUUID()}`
    let resolveReady
    let rejectReady
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
    ready.catch(() => {})
    loading = { reject: rejectReady }
    let nextController = null
    try {
      nextController = await createAndroidPlaybackController(AndroidPlayback, {
        owner,
        isCurrent: () => !destroyed && generation === loadGeneration && gate.isActive(),
        continueInBackground: options.continueInBackground,
        onError: report,
        onScreenAction: action => screen.action(action),
        onState(next) {
          if (generation !== loadGeneration || destroyed) return
          state = next
          if (next.event === 'suspended') {
            suspended = true
            gate.setActive(false)
            screen.reset()
            options.onOwnerChange?.(null)
            nextController?.close().catch(report)
            if (controller === nextController) controller = null
            rejectReady(new Error('Native playback ownership changed'))
          }
          if (next.tracks) {
            tracks = next.tracks
            for (const track of tracks.filter(track => track.type === 3 && track.supported)) {
              const id = `native-${track.group}-${track.index}`
              const existing = textTracks.find(caption => caption.originalTextId === id)
              if (existing) existing.nativeTrack = track
              else makeTextTrack({ id, language: track.language ?? 'und', label: track.label, nativeTrack: track })
            }
            dispatch('trackschanged')
            // Initial native track selection is provisional. Watch applies its
            // requested quality after load; do not overwrite it with that track.
            if (!loading) dispatch('variantchanged')
            dispatch('audiochanged')
          }
          if (next.cues) {
            nativeCues = next.cues
            displayNativeCues()
          }
          media?.update(next)
          if (voiceOver && next.voiceOver?.sourceId === voiceOver.id) {
            voiceOver.media.update(next.voiceOver)
            if (next.voiceOver.error) voiceOver.element.dispatchEvent(new Event('error'))
          }
          dispatch('buffering', { buffering: next.buffering })
          if (next.event === 'ratechange') dispatch('ratechange')
          if (next.event === 'error') {
            const error = new Error(next.message)
            if (loading) rejectReady(error)
            else report(error)
          }
          if (next.ready) resolveReady()
        },
      })
      if (destroyed || generation !== loadGeneration) {
        await nextController.close()
        return
      }
      controller = nextController
      await controller.setSeekPreferences(options.seekSeconds ?? 10, options.scaleSeekWithRate ?? false)
      const source = manifestData
        ? createAndroidSabrSource({
            manifest: manifestData,
            sabrData: options.sabrData,
            owner,
            audioOnly: options.audioOnly,
            getState: () => state
          })
        : { source: uri, mimeType }
      source.onReloadOnce?.(() => options.onReload?.())
      source.onBackoffRequested?.(event => options.onBackoff?.(event))
      // Attach the surface before preparing paused media so its first decoded
      // frame is presented instead of being consumed by ExoPlayer's dummy surface.
      if (reopenScreen) await screen.show()
      else await screen.attach()
      await nextController.load(source, {
        positionMs: Math.max(0, startTime ?? 0) * 1000,
        play: false,
        audioOnly: options.audioOnly ?? false,
        metadata: options.metadata
      })
      await ready
      if (generation !== loadGeneration || destroyed) return
      await command('volume', initialSettings.volume)
      await command('speed', initialSettings.rate)
      await command('loop', initialSettings.loop ? 1 : 0)
      await command('skipSilence', options.skipSilence && !state.live ? 1 : 0)
      if (voiceOver?.source) {
        await controller.loadVoiceOver({ sourceId: voiceOver.id, source: voiceOver.source })
      }
      options.onOwnerChange?.(owner)
      dispatch('streaming')
      dispatch('loaded')
      if (autoplay) await command('play')
      loading = null
    } catch (error) {
      await nextController?.close()
      if (generation === loadGeneration) {
        loading = null
        controller = null
        screen.reset()
        options.onOwnerChange?.(null)
      }
      if (suspended || generation !== loadGeneration || destroyed) return
      throw error
    }
  }
  methods.unload = async () => {
    loadGeneration++
    loadAbort?.abort(new Error('Playback was unloaded'))
    textGeneration++
    screen.reset()
    loading?.reject(new Error('Playback was unloaded'))
    loading = null
    const outgoing = controller
    controller = null
    await outgoing?.close()
    getOptions().onOwnerChange?.(null)
    state = {}
    currentSource = null
    suspended = false
    tracks = []
    textTracks = []
    imageTracks = []
    textDisplayer?.remove(0, Infinity)
    textVisible = false
    nativeCues = []
    media?.reset()
    media?.detach()
    await originalUnload(false)
    if (!destroyed && media) attachMedia()
  }
  methods.destroy = async () => {
    destroyed = true
    detachVideoFrames?.()
    screen.destroy()
    clearInterval(reverseTimer)
    await player.unload()
    await textDisplayer?.destroy()
    media?.detach()
    await originalDestroy()
    voiceOver?.media.detach()
    delete element.nativePlayback
  }
  methods.configure = (...args) => {
    const result = originalConfigure(...args)
    textDisplayer?.configure(player.getConfiguration().textDisplayer)
    if (controller && player.getConfiguration().abr.enabled) {
      AndroidPlayback.selectTrack({ owner: state.owner, type: 2, group: -1 }).catch(report)
    }
    return result
  }
  methods.getVideoTracks = () => androidPlaybackTracks(tracks, manifestData?.formats).video
  methods.selectVideoTrack = track => { selectNative(track?.nativeTrack).catch(report) }
  methods.getVariantTracks = variants
  methods.getAudioTracks = () => androidPlaybackTracks(tracks, manifestData?.formats).audio
  methods.selectVariantTrack = track => {
    if (!track) return
    Promise.all([selectNative(track.nativeAudio), selectNative(track.nativeVideo)]).catch(report)
  }
  methods.selectAudioTrack = track => { selectNative(track?.nativeTrack).catch(report) }
  methods.getTextTracks = () => textTracks
  methods.addTextTrackAsync = async (url, language, kind, mimeType, _codec, label) => {
    const existing = textTracks.find(track => track.url === url)
    if (existing) return existing
    const track = makeTextTrack({ url, language, kind, mimeType, label })
    dispatch('trackschanged')
    return track
  }
  methods.selectTextTrack = track => {
    const generation = ++textGeneration
    for (const candidate of textTracks) candidate.active = candidate === track
    textDisplayer.remove(0, Infinity)
    textVisible = Boolean(track)
    textDisplayer.setTextVisibility(textVisible)
    dispatch('textchanged')
    syncNativeCaptions(track && !track.nativeTrack ? [] : null)
    if (track?.nativeTrack) {
      selectNative(track.nativeTrack).catch(report)
      displayNativeCues()
      return
    }
    if (controller) AndroidPlayback.selectTrack({ owner: state.owner, type: 3, disabled: true }).catch(report)
    if (!track) return
    fetchBytes(track.url).then(bytes => {
      if (generation !== textGeneration || destroyed) return
      const Parser = track.mimeType?.includes('ttml')
        ? shaka.text.TtmlTextParser
        : track.mimeType?.includes('srt') ? shaka.text.SrtTextParser : shaka.text.VttTextParser
      const cues = new Parser().parseMedia(bytes, {
        periodStart: 0,
        segmentStart: 0,
        segmentEnd: element.duration,
        vttOffset: 0
      })
      textDisplayer.append(cues)
      syncNativeCaptions(androidCaptionCues(cues, element.duration))
    }).catch(report)
  }
  methods.isTextTrackVisible = () => textVisible
  methods.setTextTrackVisibility = visible => {
    textVisible = visible
    textDisplayer?.setTextVisibility(visible)
    syncNativeCaptions()
    const selected = textTracks.find(track => track.active)?.nativeTrack
    if (selected && controller) {
      if (visible) selectNative(selected).catch(report)
      else AndroidPlayback.selectTrack({ owner: state.owner, type: 3, disabled: true }).catch(report)
    }
    dispatch('texttrackvisibility')
  }
  methods.getTextDisplayer = () => textDisplayer
  methods.getImageTracks = () => imageTracks
  methods.addThumbnailsTrack = async (uri, mimeType) => {
    const bytes = await fetchBytes(uri)
    const cues = new shaka.text.VttTextParser().parseMedia(bytes, {
      periodStart: 0,
      segmentStart: 0,
      segmentEnd: element.duration,
      vttOffset: 0
    })
    imageTracks.push({ id: imageTracks.length, type: 'image', mimeType, uri, cues })
    dispatch('trackschanged')
  }
  methods.getThumbnails = async (id, time) => {
    const track = id == null ? imageTracks[0] : imageTracks.find(track => track.id === id)
    if (!track) return null
    if (track.cues) {
      const cue = track.cues.find(cue => cue.startTime <= time && time < cue.endTime)
      if (!cue) return null
      const url = new URL(cue.payload, track.uri)
      const rectangle = /^#xywh=(\d+),(\d+),(\d+),(\d+)$/.exec(url.hash)
      return {
        uris: [url.href],
        startTime: cue.startTime,
        duration: cue.endTime - cue.startTime,
        positionX: Number(rectangle?.[1] ?? 0),
        positionY: Number(rectangle?.[2] ?? 0),
        width: Number(rectangle?.[3] ?? 0),
        height: Number(rectangle?.[4] ?? 0),
        imageWidth: 0,
        imageHeight: 0,
        sprite: !!rectangle,
        codecs: null,
        mimeType: track.mimeType
      }
    }
    const interval = track.interval > 0 ? track.interval : element.duration / track.thumbnailCount
    const index = Math.min(track.thumbnailCount - 1, Math.max(0, Math.floor(time / interval)))
    const perImage = track.columns * track.rows
    const tile = index % perImage
    return {
      uris: [track.templateUrl.replace('$M', Math.floor(index / perImage))],
      startTime: index * interval,
      duration: interval,
      positionX: tile % track.columns * track.thumbnailWidth,
      positionY: Math.floor(tile / track.columns) * track.thumbnailHeight,
      width: track.thumbnailWidth,
      height: track.thumbnailHeight,
      imageWidth: track.columns * track.thumbnailWidth,
      imageHeight: track.rows * track.thumbnailHeight,
      sprite: perImage > 1,
      codecs: null,
      mimeType: track.mimeType
    }
  }
  methods.getPlaybackRate = () => element.playbackRate
  methods.getLoadMode = () => currentSource && controller ? shaka.Player.LoadMode.MEDIA_SOURCE : shaka.Player.LoadMode.NOT_LOADED
  methods.isLive = () => state.live ?? false
  methods.isAudioOnly = () => getOptions().audioOnly || (tracks.length > 0 && !tracks.some(track => track.type === 2))
  methods.seekRange = () => ({ start: 0, end: state.seekable === false ? 0 : state.duration ?? 0 })
  methods.goToLive = () => { command('live').catch(report) }
  methods.getStats = () => ({
    ...originalStats(),
    width: state.width,
    height: state.height,
    estimatedBandwidth: state.estimatedBandwidth,
    completionPercent: element.currentTime / element.duration * 100
  })
  methods.getBufferedInfo = () => {
    const range = state.bufferedPosition > state.position ? [{ start: state.position, end: state.bufferedPosition }] : []
    return { total: range, audio: range, video: player.isAudioOnly() ? [] : range, text: [] }
  }
  methods.getManifest = () => ({ variants: variants(), textStreams: textTracks, imageStreams: imageTracks })
  methods.retryStreaming = () => {
    if (!currentSource) return false
    player.load(currentSource.uri, element.currentTime, currentSource.mimeType, !element.paused).catch(report)
    return true
  }
  methods.trickPlay = rate => {
    defaultTrickPlayRate ??= element.playbackRate
    clearInterval(reverseTimer)
    if (rate > 0) element.playbackRate = rate
    else {
      element.pause()
      reverseTimer = setInterval(() => { element.currentTime = Math.max(0, element.currentTime + rate / 4) }, 250)
    }
  }
  methods.cancelTrickPlay = () => {
    clearInterval(reverseTimer)
    if (defaultTrickPlayRate !== null) element.playbackRate = defaultTrickPlayRate
    defaultTrickPlayRate = null
  }
  methods.nativePlayback = {
    createAudio() {
      const audio = new Audio()
      const track = { id: crypto.randomUUID(), source: '', element: audio, media: null }
      track.media = attachAndroidMediaElement(audio, {
        async command(action, value) {
          if (voiceOver !== track || !controller || !track.source) return
          const next = await controller.voiceOverCommand({ sourceId: track.id, action, value })
          if (voiceOver === track) track.media.update(next)
        },
        async load(source) {
          track.source = source
          if (controller) await controller.loadVoiceOver({ sourceId: track.id, source })
        },
        onError: () => audio.dispatchEvent(new Event('error')),
      })
      voiceOver?.media.detach()
      voiceOver = track
      return audio
    },
    show: screen.show,
    async setPresented(active) {
      gate.setActive(active)
      if (!active) {
        if (controller && !suspended) {
          const outgoing = controller
          const position = element.currentTime
          controller = null
          suspended = true
          screen.reset()
          state = { ...state, position, paused: true, playing: false }
          media.update(state)
          loading?.reject(new Error('Native playback ownership changed'))
          await outgoing.close()
          getOptions().onOwnerChange?.(null)
        }
        return
      }
      if (suspended && currentSource) {
        const source = currentSource
        const position = element.currentTime
        const selectedCaption = textTracks.find(track => track.active)
        const captionsVisible = textVisible
        const selectedVariant = variants().find(track => track.active)
        const autoQuality = player.getConfiguration().abr.enabled
        const savedImages = imageTracks
        // Leaving a tab pauses it. Restoring its source must not reapply the
        // HTML autoplay attribute that was intended for the initial load.
        await player.load(source.uri, position, source.mimeType, false)
        if (selectedVariant) {
          const restored = variants().find(track =>
            track.originalAudioId === selectedVariant.originalAudioId &&
            track.originalVideoId === selectedVariant.originalVideoId)
          if (restored) {
            await selectNative(restored.nativeAudio)
            if (!autoQuality) await selectNative(restored.nativeVideo)
          }
        }
        if (selectedCaption) {
          const restored = textTracks.find(track => selectedCaption.url
            ? track.url === selectedCaption.url
            : track.originalTextId === selectedCaption.originalTextId) ?? makeTextTrack(selectedCaption)
          player.selectTextTrack(restored)
          player.setTextTrackVisibility(captionsVisible)
        }
        if (savedImages.length) imageTracks = savedImages
      }
    },
    hide: screen.hide,
    bindControls: screen.bindControls,
    captureFrame: options => controller?.captureFrame(options) ?? Promise.reject(new Error('No native video is loaded')),
    getAudioSpectrum: () => controller?.getAudioSpectrum() ?? Promise.resolve({ bins: [] }),
    setOutputGain: value => media?.setOutputGain(value) ?? Promise.resolve(),
    isScreenOpen: screen.isOpen,
    isFullscreenFromRotation: screen.isFullscreenFromRotation,
    setContinueInBackground: enabled => controller?.setContinueInBackground(enabled),
    setSeekPreferences: (seconds, scaleWithRate) => controller?.setSeekPreferences(seconds, scaleWithRate),
    setSkipSilence: enabled => command('skipSilence', enabled ? 1 : 0),
  }
  overrideShakaMethods(player, methods)
  return player
}
