import { computed, onBeforeUnmount, ref, watch } from 'vue'

const MAX_VIDEO_DURATION_SECONDS = 4 * 60 * 60
const MIN_POLL_DELAY_SECONDS = 5
const MAX_POLL_DELAY_SECONDS = 60
const MAX_POLL_ATTEMPTS = 30
const PARTIAL_CONTENT_STATUS = 5
const MAX_AUDIO_DRIFT_SECONDS = 0.75
const AUDIO_DRIFT_DEADBAND_SECONDS = 0.05
const MAX_AUDIO_RATE_ADJUSTMENT = 0.05
const AUDIO_SYNC_GAIN = 0.25

/**
 * Smoothly correct voice-over drift without seeking for ordinary scheduling jitter.
 *
 * @param {number} playbackRate
 * @param {number} drift difference between the video and voice-over positions
 * @returns {number | null} the corrected rate, or null when a seek is required
 */
export function getVoiceOverPlaybackRate(playbackRate, drift) {
  const wallClockDrift = drift / playbackRate

  if (Math.abs(wallClockDrift) > MAX_AUDIO_DRIFT_SECONDS) {
    return null
  }

  if (Math.abs(wallClockDrift) <= AUDIO_DRIFT_DEADBAND_SECONDS) {
    return playbackRate
  }

  const adjustment = Math.max(
    -MAX_AUDIO_RATE_ADJUSTMENT,
    Math.min(MAX_AUDIO_RATE_ADJUSTMENT, wallClockDrift * AUDIO_SYNC_GAIN)
  )
  return playbackRate * (1 + adjustment)
}

/**
 * Keep a translated audio track synchronized with the player video.
 *
 * @param {{
 *   video: import('vue').Ref<HTMLVideoElement | null>,
 *   videoId: import('vue').ComputedRef<string>,
 *   responseLanguage: import('vue').ComputedRef<'ru' | 'en' | 'kk'>,
 *   autoPrepare: import('vue').ComputedRef<boolean>,
 *   originalVolume: import('vue').ComputedRef<number>,
 *   voiceVolume: import('vue').ComputedRef<number>,
 *   onError: (error: unknown) => void
 * }} options
 */
export function useVoiceOverTranslation({
  video,
  videoId,
  responseLanguage,
  autoPrepare,
  originalVolume,
  voiceVolume,
  onError
}) {
  const state = ref('idle')
  const enabled = ref(false)
  const preparationRequested = ref(false)
  const visibleState = computed(() => {
    return state.value === 'loading' && !preparationRequested.value ? 'idle' : state.value
  })

  /** @type {HTMLAudioElement | null} */
  let audio = null
  /** @type {ReturnType<typeof setTimeout> | null} */
  let pollTimeout = null
  let requestGeneration = 0
  let pollAttempts = 0
  let enableOnReady = false
  let destroyed = false

  /** @type {AudioContext | null} */
  let outputAudioContext = null
  /** @type {GainNode | null} */
  let outputGainNode = null
  let outputGraphSetupPromise = null

  async function setupOutputGraph() {
    if (outputGainNode) {
      return
    }

    const videoElement = video.value
    if (!videoElement) {
      return
    }

    outputAudioContext ??= new AudioContext()
    await outputAudioContext.resume()
    if (destroyed || video.value !== videoElement) {
      return
    }

    // A media element can only have one MediaElementAudioSourceNode. Future
    // output processing for the player must reuse this graph.
    const source = outputAudioContext.createMediaElementSource(videoElement)
    outputGainNode = outputAudioContext.createGain()
    outputGainNode.gain.value = enabled.value ? originalVolume.value : 1
    source.connect(outputGainNode)
    outputGainNode.connect(outputAudioContext.destination)
  }

  async function updateOriginalVolume() {
    const initialGain = enabled.value ? originalVolume.value : 1
    if (video.value?.nativePlayback) {
      await video.value.nativePlayback.setOutputGain(initialGain)
      return
    }
    if (!outputGainNode && initialGain !== 1) {
      try {
        outputGraphSetupPromise ??= setupOutputGraph()
        await outputGraphSetupPromise
        if (!outputGainNode) {
          outputGraphSetupPromise = null
        }
      } catch (error) {
        if (!outputGainNode) {
          outputGraphSetupPromise = null
        }
        console.warn('Unable to adjust original audio volume', error)
        return
      }
    }

    if (!outputGainNode) {
      return
    }

    const gain = enabled.value ? originalVolume.value : 1
    const now = outputGainNode.context.currentTime
    outputGainNode.gain.cancelScheduledValues(now)
    outputGainNode.gain.setTargetAtTime(gain, now, 0.015)
  }

  function clearPollTimeout() {
    if (pollTimeout !== null) {
      clearTimeout(pollTimeout)
      pollTimeout = null
    }
  }

  function syncAudioPosition(force = false) {
    const videoElement = video.value
    if (!audio || !videoElement || !Number.isFinite(videoElement.currentTime)) {
      return
    }

    const playbackRate = videoElement.playbackRate
    const drift = videoElement.currentTime - audio.currentTime
    const synchronizedPlaybackRate = getVoiceOverPlaybackRate(playbackRate, drift)

    if (force || synchronizedPlaybackRate === null) {
      audio.currentTime = videoElement.currentTime
      audio.playbackRate = playbackRate
      return
    }

    audio.playbackRate = synchronizedPlaybackRate
  }

  function syncAudioPlayback() {
    if (!audio || !video.value) {
      return
    }

    if (!enabled.value) {
      audio.pause()
      return
    }

    audio.playbackRate = video.value.playbackRate
    syncAudioPosition()
    audio.volume = Math.min(1, video.value.volume * voiceVolume.value)
    audio.muted = video.value.muted

    if (video.value.paused || video.value.ended) {
      audio.pause()
    } else {
      audio.play().catch(() => {})
    }
  }

  function handleAudioError() {
    requestGeneration++
    pollAttempts = 0
    clearPollTimeout()
    enabled.value = false
    state.value = 'error'
    onError(new Error('The translated audio track could not be played'))
  }

  function discardAudio() {
    if (!audio) {
      return
    }

    audio.removeEventListener('error', handleAudioError)
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    audio = null
  }

  function setAudioSource(url, shouldEnable) {
    discardAudio()

    audio = video.value?.nativePlayback?.createAudio() ?? new Audio()
    audio.preload = 'auto'
    audio.addEventListener('error', handleAudioError)
    audio.src = url
    state.value = 'ready'
    enabled.value = shouldEnable
    syncAudioPosition(true)
    syncAudioPlayback()
  }

  function schedulePoll(result, generation, preserveReadyTrack = false, enableWhenReady = true) {
    if (pollAttempts >= MAX_POLL_ATTEMPTS) {
      requestGeneration++
      clearPollTimeout()
      enabled.value = false
      syncAudioPlayback()
      state.value = 'error'
      onError(new Error('The voice-over translation was not prepared in time'))
      return
    }

    pollAttempts++
    const remainingTime = Number.isFinite(result.remainingTime) ? result.remainingTime : MIN_POLL_DELAY_SECONDS
    const delaySeconds = Math.min(MAX_POLL_DELAY_SECONDS, Math.max(MIN_POLL_DELAY_SECONDS, remainingTime))

    clearPollTimeout()
    pollTimeout = setTimeout(() => {
      requestTranslation(generation, preserveReadyTrack, enableWhenReady)
    }, delaySeconds * 1000)
  }

  async function requestTranslation(generation, preserveReadyTrack = false, enableWhenReady = true) {
    if (generation === undefined) {
      generation = ++requestGeneration
      pollAttempts = 0
    }

    const videoElement = video.value
    if (!videoElement) {
      return
    }

    const duration = videoElement.duration
    if (!Number.isFinite(duration)) {
      if (enableWhenReady || enableOnReady) {
        state.value = 'loading'
      }
      return
    }

    if (duration <= 0 || duration > MAX_VIDEO_DURATION_SECONDS) {
      state.value = 'error'
      onError(new RangeError('Voice-over translation only supports videos up to four hours long'))
      return
    }

    if (!preserveReadyTrack) {
      state.value = 'loading'
    }

    try {
      const result = await window.ftElectron.requestVoiceOverTranslation({
        videoId: videoId.value,
        duration,
        responseLanguage: responseLanguage.value
      })

      if (generation !== requestGeneration) {
        return
      }

      if (result?.translated && typeof result.url === 'string') {
        setAudioSource(
          result.url,
          preserveReadyTrack ? enabled.value : (enableWhenReady || enableOnReady)
        )
        enableOnReady = false

        if (result.status === PARTIAL_CONTENT_STATUS) {
          schedulePoll(result, generation, true, enableWhenReady)
        }
      } else {
        schedulePoll(result ?? {}, generation, preserveReadyTrack, enableWhenReady)
      }
    } catch (error) {
      if (generation !== requestGeneration) {
        return
      }

      if (preserveReadyTrack) {
        schedulePoll({}, generation, true, enableWhenReady)
        return
      }

      if (!preserveReadyTrack) {
        enabled.value = false
        if (enableWhenReady || enableOnReady) {
          state.value = 'error'
          onError(error)
        } else {
          state.value = 'idle'
        }
      }
    }
  }

  function toggle() {
    if (state.value === 'loading') {
      if (preparationRequested.value) {
        requestGeneration++
        enableOnReady = false
        preparationRequested.value = false
        clearPollTimeout()
        state.value = 'idle'
        return
      }

      preparationRequested.value = true
      enableOnReady = true
      return
    }

    if (state.value === 'error') {
      discardAudio()
      preparationRequested.value = true
      enableOnReady = true
      requestTranslation()
      return
    }

    if (audio) {
      enabled.value = !enabled.value
      syncAudioPlayback()
      return
    }

    preparationRequested.value = true
    enableOnReady = true
    requestTranslation()
  }

  function prepare() {
    const duration = video.value?.duration
    if (state.value === 'idle' && !audio && Number.isFinite(duration) &&
        duration > 0 && duration <= MAX_VIDEO_DURATION_SECONDS) {
      requestTranslation(undefined, false, false)
    }
  }

  function reset() {
    requestGeneration++
    pollAttempts = 0
    enableOnReady = false
    preparationRequested.value = false
    clearPollTimeout()
    enabled.value = false
    state.value = 'idle'
    discardAudio()
  }

  function handlePlay() {
    syncAudioPlayback()
  }

  function handlePause() {
    audio?.pause()
  }

  function handleSeeking() {
    syncAudioPosition(true)
  }

  function handleTimeUpdate() {
    if (enabled.value) {
      syncAudioPosition()
    }
  }

  function handleRateChange() {
    if (audio && video.value) {
      audio.playbackRate = video.value.playbackRate
      syncAudioPosition()
    }
  }

  function handleVolumeChange() {
    if (audio && video.value) {
      audio.volume = Math.min(1, video.value.volume * voiceVolume.value)
      audio.muted = video.value.muted
    }
  }

  function handleLoadedMetadata() {
    if (enableOnReady) {
      requestTranslation()
    } else if (autoPrepare.value) {
      prepare()
    }
  }

  function attach(videoElement) {
    videoElement.addEventListener('play', handlePlay)
    videoElement.addEventListener('playing', handlePlay)
    videoElement.addEventListener('pause', handlePause)
    videoElement.addEventListener('waiting', handlePause)
    videoElement.addEventListener('seeking', handleSeeking)
    videoElement.addEventListener('timeupdate', handleTimeUpdate)
    videoElement.addEventListener('ratechange', handleRateChange)
    videoElement.addEventListener('volumechange', handleVolumeChange)
    videoElement.addEventListener('loadedmetadata', handleLoadedMetadata)
  }

  function detach(videoElement) {
    videoElement.removeEventListener('play', handlePlay)
    videoElement.removeEventListener('playing', handlePlay)
    videoElement.removeEventListener('pause', handlePause)
    videoElement.removeEventListener('waiting', handlePause)
    videoElement.removeEventListener('seeking', handleSeeking)
    videoElement.removeEventListener('timeupdate', handleTimeUpdate)
    videoElement.removeEventListener('ratechange', handleRateChange)
    videoElement.removeEventListener('volumechange', handleVolumeChange)
    videoElement.removeEventListener('loadedmetadata', handleLoadedMetadata)
  }

  onBeforeUnmount(() => {
    destroyed = true
    reset()
    if (video.value) {
      detach(video.value)
    }
    outputAudioContext?.close().catch(() => {})
    outputAudioContext = null
    outputGainNode = null
    outputGraphSetupPromise = null
  })

  watch([enabled, originalVolume], updateOriginalVolume)
  watch(voiceVolume, syncAudioPlayback)

  return {
    state: visibleState,
    enabled,
    attach,
    prepare,
    reset,
    toggle
  }
}
