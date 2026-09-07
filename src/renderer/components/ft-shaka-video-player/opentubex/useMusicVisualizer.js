import { isAppHidden } from '../../../helpers/appVisibility.js'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const FFT_SIZE = 256
const MAX_DEVICE_PIXEL_RATIO = 2
const MIN_FRAME_INTERVAL_MS = 1000 / 30

/**
 * Draws a spectrum from the media element's captured audio without changing
 * the element's existing audio output path.
 * @param {object} options
 * @param {import('vue').ComputedRef<boolean>} options.active
 * @param {import('vue').Ref<HTMLVideoElement | null>} options.video
 * @param {import('vue').WatchSource<unknown>} options.sourceKey
 */
export function useMusicVisualizer({ active, video, sourceKey }) {
  /** @type {import('vue').Ref<HTMLCanvasElement | null>} */
  const musicVisualizerCanvas = ref(null)

  /** @type {AudioContext | null} */
  let audioContext = null
  /** @type {AnalyserNode | null} */
  let analyser = null
  /** @type {MediaStreamAudioSourceNode | null} */
  let streamSource = null
  /** @type {MediaStream | null} */
  let capturedStream = null
  /** @type {ResizeObserver | null} */
  let resizeObserver = null
  /** @type {MutationObserver | null} */
  let reducedMotionObserver = null
  /** @type {number | null} */
  let animationFrame = null
  /** @type {Uint8Array<ArrayBuffer> | null} */
  let frequencyData = null
  let lastFrameTime = 0
  let hasLoggedVisualizerError = false
  let nativeSpectrumPending = false

  function logVisualizerError(error) {
    if (!hasLoggedVisualizerError) {
      console.warn('Unable to run the music visualizer', error)
      hasLoggedVisualizerError = true
    }
  }

  function runVisualizerTask(task) {
    task.catch(logVisualizerError)
  }

  function canDraw() {
    return active.value &&
      !isAppHidden() &&
      document.documentElement.dataset.reducedMotion !== 'reduce' &&
      video.value?.paused === false
  }

  function resizeCanvas() {
    const canvas = musicVisualizerCanvas.value
    if (!canvas) {
      return
    }

    const ratio = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO)
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio))
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio))

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
  }

  function clearCanvas() {
    const canvas = musicVisualizerCanvas.value
    const context = canvas?.getContext('2d')
    if (canvas && context) {
      context.clearRect(0, 0, canvas.width, canvas.height)
    }
  }

  function stopDrawing() {
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame)
      animationFrame = null
    }

    lastFrameTime = 0
    clearCanvas()

    if (audioContext?.state === 'running') {
      runVisualizerTask(audioContext.suspend())
    }
  }

  function hasLiveCapturedAudioTrack() {
    return capturedStream?.getAudioTracks().some(track => track.readyState === 'live') === true
  }

  function handleCapturedAudioTrackEnded() {
    runVisualizerTask(disposeAudioGraph().then(startDrawing))
  }

  function handleCapturedStreamAddTrack(event) {
    if (event.track.kind !== 'audio') {
      return
    }

    event.track.addEventListener('ended', handleCapturedAudioTrackEnded)
    if (!audioContext) {
      runVisualizerTask(startDrawing())
    }
  }

  function handleCapturedStreamRemoveTrack(event) {
    event.track.removeEventListener('ended', handleCapturedAudioTrackEnded)
    if (event.track.kind === 'audio') {
      runVisualizerTask(disposeAudioGraph().then(startDrawing))
    }
  }

  function attachCapturedStreamListeners(stream) {
    stream.addEventListener('addtrack', handleCapturedStreamAddTrack)
    stream.addEventListener('removetrack', handleCapturedStreamRemoveTrack)
    stream.getAudioTracks().forEach((track) => {
      track.addEventListener('ended', handleCapturedAudioTrackEnded)
    })
  }

  function detachCapturedStreamListeners(stream) {
    stream?.removeEventListener('addtrack', handleCapturedStreamAddTrack)
    stream?.removeEventListener('removetrack', handleCapturedStreamRemoveTrack)
    stream?.getAudioTracks().forEach((track) => {
      track.removeEventListener('ended', handleCapturedAudioTrackEnded)
    })
  }

  async function disposeAudioGraph() {
    const contextToClose = audioContext
    contextToClose?.removeEventListener('statechange', handleAudioContextStateChange)
    detachCapturedStreamListeners(capturedStream)
    streamSource?.disconnect()
    analyser?.disconnect()
    capturedStream?.getTracks().forEach(track => track.stop())

    audioContext = null
    analyser = null
    streamSource = null
    capturedStream = null
    frequencyData = null
    stopDrawing()

    if (contextToClose && contextToClose.state !== 'closed') {
      await contextToClose.close()
    }
  }

  function drawFrame(timestamp) {
    animationFrame = null

    const native = video.value?.nativePlayback
    if (!canDraw() || (!analyser && !native) || !frequencyData) {
      stopDrawing()
      return
    }

    animationFrame = requestAnimationFrame(drawFrame)
    if (timestamp - lastFrameTime < MIN_FRAME_INTERVAL_MS) {
      return
    }

    lastFrameTime = timestamp
    const canvas = musicVisualizerCanvas.value
    const context = canvas?.getContext('2d')
    if (!canvas || !context) {
      return
    }

    if (native) {
      if (!nativeSpectrumPending) {
        nativeSpectrumPending = true
        const target = frequencyData
        runVisualizerTask(native.getAudioSpectrum().then(({ bins }) => {
          if (target !== frequencyData || !canDraw()) return
          for (let index = 0; index < target.length; index++) {
            target[index] = Math.round(target[index] * 0.82 + (bins[index] ?? 0) * 0.18)
          }
        }).finally(() => { nativeSpectrumPending = false }))
      }
    } else analyser.getByteFrequencyData(frequencyData)
    context.clearRect(0, 0, canvas.width, canvas.height)

    const barCount = Math.min(48, frequencyData.length)
    const gap = Math.max(2, canvas.width * 0.004)
    const barWidth = Math.max(1, (canvas.width - gap * (barCount - 1)) / barCount)
    const gradient = context.createLinearGradient(0, canvas.height, 0, 0)
    gradient.addColorStop(0, 'rgb(255 255 255 / 18%)')
    gradient.addColorStop(0.45, 'rgb(255 255 255 / 60%)')
    gradient.addColorStop(1, 'rgb(255 255 255 / 95%)')
    context.fillStyle = gradient

    for (let index = 0; index < barCount; index++) {
      const sourceIndex = Math.floor(index * frequencyData.length * 0.72 / barCount)
      const strength = frequencyData[sourceIndex] / 255
      const height = Math.max(canvas.height * 0.018, strength * canvas.height * 0.82)
      const x = index * (barWidth + gap)
      const y = canvas.height - height
      const radius = Math.min(barWidth / 2, 6)

      context.beginPath()
      context.roundRect(x, y, barWidth, height, radius)
      context.fill()
    }
  }

  async function ensureAudioGraph() {
    const videoElement = video.value
    if (audioContext || !videoElement || typeof videoElement.captureStream !== 'function') {
      return Boolean(audioContext)
    }

    try {
      if (capturedStream?.getAudioTracks().length && !hasLiveCapturedAudioTrack()) {
        await disposeAudioGraph()
      }

      if (!capturedStream) {
        capturedStream = videoElement.captureStream()
        attachCapturedStreamListeners(capturedStream)
      }

      if (!hasLiveCapturedAudioTrack()) {
        return false
      }

      const context = new AudioContext()
      const source = context.createMediaStreamSource(capturedStream)
      const nextAnalyser = context.createAnalyser()
      nextAnalyser.fftSize = FFT_SIZE
      nextAnalyser.smoothingTimeConstant = 0.82
      source.connect(nextAnalyser)
      context.addEventListener('statechange', handleAudioContextStateChange)

      audioContext = context
      streamSource = source
      analyser = nextAnalyser
      frequencyData = new Uint8Array(nextAnalyser.frequencyBinCount)
      return true
    } catch (error) {
      logVisualizerError(error)
      await disposeAudioGraph()
      return false
    }
  }

  async function startDrawing() {
    if (!canDraw()) {
      return
    }

    if (video.value?.nativePlayback) {
      frequencyData ??= new Uint8Array(FFT_SIZE / 2)
      if (animationFrame === null) animationFrame = requestAnimationFrame(drawFrame)
      return
    }

    if (audioContext?.state === 'closed') {
      await disposeAudioGraph()
    }

    if (!await ensureAudioGraph() || !audioContext) {
      return
    }

    if (audioContext.state !== 'running') {
      await audioContext.resume()
    }

    if (canDraw() && animationFrame === null) {
      animationFrame = requestAnimationFrame(drawFrame)
    }
  }

  function handleAudioContextStateChange() {
    if (audioContext?.state !== 'running' && canDraw()) {
      runVisualizerTask(startDrawing())
    }
  }

  function handleVisibilityChange() {
    if (isAppHidden()) {
      stopDrawing()
    } else {
      runVisualizerTask(startDrawing())
    }
  }

  function handlePlaybackStateChange() {
    if (video.value?.paused) {
      stopDrawing()
    } else {
      runVisualizerTask(startDrawing())
    }
  }

  function attachVideoListeners(element) {
    element?.addEventListener('play', handlePlaybackStateChange)
    element?.addEventListener('pause', handlePlaybackStateChange)
    element?.addEventListener('ended', handlePlaybackStateChange)
  }

  function detachVideoListeners(element) {
    element?.removeEventListener('play', handlePlaybackStateChange)
    element?.removeEventListener('pause', handlePlaybackStateChange)
    element?.removeEventListener('ended', handlePlaybackStateChange)
  }

  watch(video, (nextVideo, previousVideo) => {
    detachVideoListeners(previousVideo)
    attachVideoListeners(nextVideo)
    runVisualizerTask(disposeAudioGraph().then(startDrawing))
  })

  watch(musicVisualizerCanvas, (nextCanvas, previousCanvas) => {
    if (resizeObserver && previousCanvas) {
      resizeObserver.unobserve(previousCanvas)
    }
    if (resizeObserver && nextCanvas) {
      resizeObserver.observe(nextCanvas)
      resizeCanvas()
    }
  })

  watch(active, (isActive) => {
    if (isActive) {
      runVisualizerTask(nextTick(startDrawing))
    } else {
      stopDrawing()
    }
  })

  watch(sourceKey, () => {
    runVisualizerTask(disposeAudioGraph().then(startDrawing))
  })

  onMounted(() => {
    attachVideoListeners(video.value)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    resizeObserver = new ResizeObserver(resizeCanvas)
    if (musicVisualizerCanvas.value) {
      resizeObserver.observe(musicVisualizerCanvas.value)
    }

    reducedMotionObserver = new MutationObserver(() => {
      if (document.documentElement.dataset.reducedMotion === 'reduce') {
        stopDrawing()
      } else {
        runVisualizerTask(startDrawing())
      }
    })
    reducedMotionObserver.observe(document.documentElement, {
      attributeFilter: ['data-reduced-motion']
    })

    resizeCanvas()
    runVisualizerTask(startDrawing())
  })

  onBeforeUnmount(() => {
    detachVideoListeners(video.value)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    resizeObserver?.disconnect()
    reducedMotionObserver?.disconnect()
    runVisualizerTask(disposeAudioGraph())
  })

  return { musicVisualizerCanvas }
}
