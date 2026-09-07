import { isAppHidden } from '../../../helpers/appVisibility.js'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { capturePlayerFrame } from '../../../helpers/player/capturePlayerFrame'

const AMBIENT_FRAME_INTERVAL_MS = 100
const AMBIENT_FRAME_BLEND_ALPHA = 0.14
const AMBIENT_FRAME_SETTLE_TICKS = 16
const AMBIENT_FRAME_WIDTH = 80
const AMBIENT_FRAME_HEIGHT = 45

/**
 * Renders low-resolution video frames for the ambient glow behind the player.
 * @param {object} options
 * @param {import('vue').ComputedRef<boolean>} options.enabled
 * @param {import('vue').Ref<HTMLVideoElement | null>} options.video
 */
export function useAmbientMode({ enabled, video }) {
  /** @type {import('vue').Ref<HTMLCanvasElement | null>} */
  const ambientCanvas = ref(null)
  /** @type {import('vue').Ref<HTMLCanvasElement | null>} */
  const ambientLayoutCanvas = ref(null)
  /** @type {import('vue').Ref<HTMLCanvasElement | null>} */
  const ambientFullscreenCanvas = ref(null)

  /** @type {number|null} */
  let frameInterval = null
  /** @type {HTMLVideoElement | null} */
  let playbackListenersAttached = null
  let lastVideoTime = -1
  let blendTicksRemaining = 0
  let hasAmbientFrame = false
  let hasLoggedRenderError = false
  let framePending = false

  async function drawAmbientFrame() {
    if (framePending) return
    const canvas = ambientCanvas.value
    const videoElement = video.value

    // The element only shows up once the player is ready, so keep trying until
    // there is something to listen to.
    attachPlaybackListeners()

    const videoTimeChanged = videoElement?.currentTime !== lastVideoTime

    if (!enabled.value || isAppHidden() || !canvas || !videoElement ||
      videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      (!videoTimeChanged && blendTicksRemaining === 0)) {
      // Nothing left to draw and no new frames coming: 'play' restarts the timer.
      if (playbackListenersAttached && videoElement?.paused && blendTicksRemaining === 0) {
        pauseAmbientTicking()
      }

      return
    }

    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    if (videoTimeChanged) {
      blendTicksRemaining = AMBIENT_FRAME_SETTLE_TICKS
    }

    const wasInitialized = hasAmbientFrame
    framePending = true
    try {
      const frame = await capturePlayerFrame(videoElement, canvas.width, canvas.height)
      if (!enabled.value || isAppHidden() || canvas !== ambientCanvas.value || videoElement !== video.value) return
      context.globalAlpha = wasInitialized ? AMBIENT_FRAME_BLEND_ALPHA : 1
      context.drawImage(frame, 0, 0, canvas.width, canvas.height)
      hasAmbientFrame = true
      lastVideoTime = videoElement.currentTime
      blendTicksRemaining = wasInitialized ? Math.max(0, blendTicksRemaining - 1) : 0

      for (const mirrorCanvas of [ambientLayoutCanvas.value, ambientFullscreenCanvas.value]) {
        const mirrorContext = mirrorCanvas?.getContext('2d')
        if (mirrorCanvas && mirrorContext) {
          mirrorContext.clearRect(0, 0, mirrorCanvas.width, mirrorCanvas.height)
          mirrorContext.drawImage(canvas, 0, 0, mirrorCanvas.width, mirrorCanvas.height)
        }
      }
    } catch (error) {
      if (!hasLoggedRenderError) {
        console.warn('Unable to render ambient mode frame', error)
        hasLoggedRenderError = true
      }
    } finally {
      framePending = false
      context.globalAlpha = 1
    }
  }

  function startAmbientFrames() {
    if (frameInterval !== null) {
      return
    }

    lastVideoTime = -1
    blendTicksRemaining = 0
    hasAmbientFrame = false
    drawAmbientFrame()
    resumeAmbientTicking()
  }

  function stopAmbientFrames() {
    pauseAmbientTicking()
    detachPlaybackListeners()
  }

  function resumeAmbientTicking() {
    if (frameInterval !== null || !enabled.value) {
      return
    }

    frameInterval = window.setInterval(drawAmbientFrame, AMBIENT_FRAME_INTERVAL_MS)
    attachPlaybackListeners()
  }

  function pauseAmbientTicking() {
    if (frameInterval !== null) {
      window.clearInterval(frameInterval)
      frameInterval = null
    }
  }

  // A paused video produces no new frames, so the timer stops itself once the
  // blend has settled (see drawAmbientFrame) and playing again restarts it.
  function attachPlaybackListeners() {
    const videoElement = video.value
    if (!videoElement || playbackListenersAttached) {
      return
    }

    videoElement.addEventListener('play', resumeAmbientTicking)
    playbackListenersAttached = videoElement
  }

  function detachPlaybackListeners() {
    if (!playbackListenersAttached) {
      return
    }

    playbackListenersAttached.removeEventListener('play', resumeAmbientTicking)
    playbackListenersAttached = null
  }

  watch(enabled, (isEnabled) => {
    if (isEnabled) {
      startAmbientFrames()
    } else {
      stopAmbientFrames()
    }
  })

  onMounted(() => {
    const canvas = ambientCanvas.value
    if (!canvas) {
      return
    }

    canvas.width = AMBIENT_FRAME_WIDTH
    canvas.height = AMBIENT_FRAME_HEIGHT

    for (const mirrorCanvas of [ambientLayoutCanvas.value, ambientFullscreenCanvas.value]) {
      if (mirrorCanvas) {
        mirrorCanvas.width = AMBIENT_FRAME_WIDTH
        mirrorCanvas.height = AMBIENT_FRAME_HEIGHT
      }
    }

    if (enabled.value) {
      startAmbientFrames()
    }
  })

  onBeforeUnmount(stopAmbientFrames)

  return {
    ambientCanvas,
    ambientFullscreenCanvas,
    ambientLayoutCanvas,
  }
}
