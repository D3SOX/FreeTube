import { computed, onUnmounted, ref } from 'vue'

export function isCapacitorMobilePlayer() {
  return document.querySelector('.app')?.classList.contains('capacitorTabs') === true
}

export function useMobileFullscreenGestures({
  getContainer,
  getControls,
  isFullscreenActive,
  isFullscreenMetadataShown,
  isFullscreenSwipeEnabled,
  isPlaybackEnded,
  isPlayerSurfaceTarget,
  isScrollMiniPlayerActive,
  seekOnDoubleTap,
  setFullscreenMetadata,
  setShowUiOnPaused,
  showOverlayControls,
  togglePlayerFullScreen,
}) {
  const mobileFullscreenSwiping = ref(false)
  const mobileFullscreenSwipeSettling = ref(false)
  const mobileFullscreenSwipeOffset = ref(0)
  const mobileFullscreenSwipeStyle = computed(() => (
    mobileFullscreenSwiping.value || mobileFullscreenSwipeSettling.value
      ? { '--mobile-fullscreen-swipe-offset': `${mobileFullscreenSwipeOffset.value}px` }
      : undefined
  ))
  /** @type {{ pointerId: number, startX: number, startY: number, startTime: number, fullscreen: boolean, distance: number, tapDirection: number, controlsShownAtStart: boolean, fullscreenSwipeEnabled: boolean, surfaceTap: boolean } | null} */
  let mobileFullscreenGesture = null
  /** @type {number | null} */
  let mobileFullscreenSettleTimer = null
  /** @type {number | null} */
  let mobileSurfaceTapTimer = null
  /** @type {{ direction: number, time: number } | null} */
  let lastMobileSideTap = null
  /** @type {HTMLElement | null} */
  let mobileSeekFeedback = null
  /** @type {number | null} */
  let mobileSeekFeedbackTimer = null
  let mobileSeekSeconds = 0
  const doubleTapWindow = 350
  let mobilePlayerSuppressClickUntil = 0
  let mobileControlSuppressClickUntil = 0
  let mobileSurfaceSuppressTouchEndUntil = 0
  let mobileTitleSuppressClickUntil = 0
  /** @type {{ pointerId: number, startX: number, startY: number, startTime: number, blocked: boolean } | null} */
  let mobileFullscreenTitleGesture = null
  /** @type {{ x: number, y: number, time: number } | null} */
  let lastMobileFullscreenTitleTap = null

  function isFullscreenTitleTarget(target) {
    return target instanceof Element && target.closest('.playerFullscreenTitleOverlay') !== null
  }

  function isSwipeControlTarget(target) {
    return target instanceof Element && target.closest('.shaka-controls-button-panel, .shaka-play-button') !== null
  }

  function startMobileFullscreenGesture(event) {
    if (
      !isCapacitorMobilePlayer() ||
      event.pointerType !== 'touch' ||
      event.button !== 0 ||
      !event.isPrimary ||
      isScrollMiniPlayerActive()
    ) {
      return
    }

    const previousTitleTap = lastMobileFullscreenTitleTap
    const blocksPreviousTitleTap = previousTitleTap !== null &&
      performance.now() - previousTitleTap.time < 350 &&
      Math.hypot(event.clientX - previousTitleTap.x, event.clientY - previousTitleTap.y) <= 32
    if (isFullscreenTitleTarget(event.target) || blocksPreviousTitleTap) {
      mobileFullscreenTitleGesture = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startTime: performance.now(),
        blocked: blocksPreviousTitleTap,
      }
      return
    }

    const surfaceTap = isPlayerSurfaceTarget(event.target)
    if (!surfaceTap) {
      clearTimeout(mobileSurfaceTapTimer)
      mobileSurfaceTapTimer = null
      lastMobileSideTap = null
    }
    if (!surfaceTap && !isSwipeControlTarget(event.target)) return
    mobileControlSuppressClickUntil = 0
    mobileSurfaceSuppressTouchEndUntil = 0

    const bounds = getContainer()?.getBoundingClientRect()
    const relativeX = bounds?.width > 0 ? (event.clientX - bounds.left) / bounds.width : 0.5
    mobileFullscreenGesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startTime: performance.now(),
      surfaceTap,
      fullscreen: isFullscreenActive(),
      distance: 0,
      tapDirection: relativeX <= 0.35 ? -1 : relativeX >= 0.65 ? 1 : 0,
      controlsShownAtStart: getControls()?.getControlsContainer().hasAttribute('shown') === true,
      fullscreenSwipeEnabled: isFullscreenSwipeEnabled(),
    }
  }

  function moveMobileFullscreenGesture(event) {
    if (event.pointerId === mobileFullscreenTitleGesture?.pointerId) {
      const distance = Math.hypot(
        event.clientX - mobileFullscreenTitleGesture.startX,
        event.clientY - mobileFullscreenTitleGesture.startY
      )
      if (distance > 12) mobileFullscreenTitleGesture = null
      return false
    }

    if (event.pointerId !== mobileFullscreenGesture?.pointerId) return false

    const deltaX = event.clientX - mobileFullscreenGesture.startX
    const deltaY = event.clientY - mobileFullscreenGesture.startY
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= 12) {
      clearTimeout(mobileSurfaceTapTimer)
      mobileSurfaceTapTimer = null
      lastMobileSideTap = null
    }
    if (!mobileFullscreenGesture.fullscreenSwipeEnabled) {
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= 12) {
        mobileFullscreenGesture = null
      }
      return false
    }
    const directionalDistance = mobileFullscreenGesture.fullscreen ? deltaY : -deltaY
    if (!mobileFullscreenSwiping.value) {
      if (Math.abs(deltaX) > Math.abs(deltaY) || directionalDistance <= 0) {
        if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= 12) {
          mobileFullscreenGesture = null
        }
        return false
      }
      if (directionalDistance < 8) return false

      mobileFullscreenSwiping.value = true
      getContainer()?.setPointerCapture(event.pointerId)
    }

    mobileFullscreenGesture.distance = directionalDistance
    mobileFullscreenSwipeOffset.value = (mobileFullscreenGesture.fullscreen ? 1 : -1) *
      Math.min(96, directionalDistance * 0.65)
    event.preventDefault()
    event.stopPropagation()
    return true
  }

  function finishMobileFullscreenGesture(event) {
    if (event.pointerId === mobileFullscreenTitleGesture?.pointerId) {
      const gesture = mobileFullscreenTitleGesture
      mobileFullscreenTitleGesture = null
      const elapsed = performance.now() - gesture.startTime
      const distance = Math.hypot(
        event.clientX - gesture.startX,
        event.clientY - gesture.startY
      )
      if (elapsed > 450 || distance > 12) return false

      event.preventDefault()
      event.stopImmediatePropagation()
      mobileSurfaceSuppressTouchEndUntil = performance.now() + 350
      mobileTitleSuppressClickUntil = performance.now() + 350
      if (gesture.blocked) {
        lastMobileFullscreenTitleTap = null
        return true
      }

      lastMobileFullscreenTitleTap = {
        x: event.clientX,
        y: event.clientY,
        time: performance.now(),
      }
      setFullscreenMetadata(!isFullscreenMetadataShown())
      showOverlayControls()
      return true
    }

    if (event.pointerId !== mobileFullscreenGesture?.pointerId) return false

    const gesture = mobileFullscreenGesture
    mobileFullscreenGesture = null
    if (!mobileFullscreenSwiping.value) {
      if (!gesture.surfaceTap) return false
      const elapsed = performance.now() - gesture.startTime
      const distance = Math.hypot(
        event.clientX - gesture.startX,
        event.clientY - gesture.startY
      )
      if (elapsed > 450 || distance > 12) return false

      mobilePlayerSuppressClickUntil = performance.now() + 350
      mobileSurfaceSuppressTouchEndUntil = performance.now() + 350
      event.preventDefault()
      event.stopImmediatePropagation()
      queueMobilePlayerSurfaceTap(!gesture.controlsShownAtStart, gesture.tapDirection)
      return true
    }

    const container = getContainer()
    if (container?.hasPointerCapture(event.pointerId)) {
      container.releasePointerCapture(event.pointerId)
    }
    event.preventDefault()
    event.stopPropagation()
    mobilePlayerSuppressClickUntil = performance.now() + 350
    mobileSurfaceSuppressTouchEndUntil = performance.now() + 350
    mobileControlSuppressClickUntil = performance.now() + 350

    const elapsed = Math.max(1, performance.now() - gesture.startTime)
    const shouldToggle = gesture.distance >= 64 ||
      (gesture.distance >= 28 && gesture.distance / elapsed >= 0.55)
    settleMobileFullscreenGesture(shouldToggle, gesture.fullscreen)
    return true
  }

  function settleMobileFullscreenGesture(shouldToggle, wasFullscreen) {
    clearTimeout(mobileFullscreenSettleTimer)
    mobileFullscreenSwiping.value = false
    mobileFullscreenSwipeSettling.value = true
    mobileFullscreenSwipeOffset.value = shouldToggle ? (wasFullscreen ? 96 : -96) : 0

    const settleDuration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 140
    mobileFullscreenSettleTimer = window.setTimeout(() => {
      mobileFullscreenSettleTimer = null
      mobileFullscreenSwipeOffset.value = 0
      mobileFullscreenSwipeSettling.value = false
      if (shouldToggle) togglePlayerFullScreen()
    }, settleDuration)
  }

  function cancelMobileFullscreenGesture(event) {
    if (!event || event.pointerId === mobileFullscreenTitleGesture?.pointerId) {
      mobileFullscreenTitleGesture = null
    }
    if (event && event.pointerId !== mobileFullscreenGesture?.pointerId) return false

    clearTimeout(mobileSurfaceTapTimer)
    mobileSurfaceTapTimer = null
    lastMobileSideTap = null
    const wasActive = mobileFullscreenGesture !== null || mobileFullscreenSwiping.value
    mobileFullscreenGesture = null
    if (mobileFullscreenSwiping.value) settleMobileFullscreenGesture(false, false)
    return wasActive
  }

  function applyMobilePlayerSurfaceTap(showControls) {
    const controls = getControls()
    const controlsContainer = controls?.getControlsContainer()
    if (!controls || !controlsContainer) return

    if (showControls || isPlaybackEnded()) {
      setShowUiOnPaused(true)
      controls.showUI()
    } else {
      setShowUiOnPaused(false)
      const config = controls.getConfig()
      const fadeDelay = config.fadeDelay
      config.fadeDelay = 0
      controls.hideUI()
      config.fadeDelay = fadeDelay
    }
  }

  function queueMobilePlayerSurfaceTap(showControls, direction) {
    const controls = getControls()
    clearTimeout(mobileSurfaceTapTimer)
    mobileSurfaceTapTimer = null
    if (controls?.anySettingsMenusAreOpen()) {
      lastMobileSideTap = null
      controls.hideSettingsMenus()
      return
    }

    const seekDistance = controls?.getConfig().tapSeekDistance ?? 0
    if (!direction || seekDistance <= 0) {
      lastMobileSideTap = null
      applyMobilePlayerSurfaceTap(showControls)
      return
    }

    // Own both taps: Shaka requires visible controls before it starts counting
    // side taps, which otherwise consumes the first tap just to show the UI.
    const now = performance.now()
    const doubleTap = lastMobileSideTap?.direction === direction &&
      now - lastMobileSideTap.time <= doubleTapWindow
    lastMobileSideTap = { direction, time: now }
    if (doubleTap) {
      showMobileSeekFeedback(seekOnDoubleTap(direction * seekDistance))
      return
    }

    mobileSurfaceTapTimer = window.setTimeout(() => {
      mobileSurfaceTapTimer = null
      lastMobileSideTap = null
      applyMobilePlayerSurfaceTap(showControls)
    }, doubleTapWindow)
  }

  function clearMobileSeekFeedback() {
    clearTimeout(mobileSeekFeedbackTimer)
    mobileSeekFeedbackTimer = null
    if (mobileSeekFeedback) {
      mobileSeekFeedback.style.opacity = '0'
      const label = mobileSeekFeedback.querySelector('span')
      if (label) label.textContent = '0s'
    }
    mobileSeekFeedback = null
    mobileSeekSeconds = 0
  }

  function showMobileSeekFeedback(seconds) {
    if (!seconds) return
    const feedback = getContainer()?.querySelector(seconds < 0 ? '.shaka-rewind-container' : '.shaka-fast-forward-container')
    if (!(feedback instanceof HTMLElement)) return
    if (mobileSeekFeedback !== feedback) clearMobileSeekFeedback()
    clearTimeout(mobileSeekFeedbackTimer)
    mobileSeekFeedback = feedback
    mobileSeekSeconds += seconds
    const label = feedback.querySelector('span')
    if (label) label.textContent = `${+mobileSeekSeconds.toFixed(2)}s`
    feedback.style.opacity = '1'
    mobileSeekFeedbackTimer = window.setTimeout(clearMobileSeekFeedback, 500)
  }

  function handleMobilePlayerTouchEnd(event) {
    if (
      !isCapacitorMobilePlayer() ||
      performance.now() >= mobileSurfaceSuppressTouchEndUntil
    ) {
      return
    }

    mobileSurfaceSuppressTouchEndUntil = 0
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  function handleMobilePlayerSurfaceClick(event) {
    if (isCapacitorMobilePlayer() && isSwipeControlTarget(event.target) && performance.now() < mobileControlSuppressClickUntil) {
      mobileControlSuppressClickUntil = 0
      event.preventDefault()
      event.stopImmediatePropagation()
      return true
    }
    if (!isCapacitorMobilePlayer() || !isPlayerSurfaceTarget(event.target)) return false

    event.preventDefault()
    event.stopPropagation()
    if (performance.now() < mobilePlayerSuppressClickUntil) {
      mobilePlayerSuppressClickUntil = 0
      return true
    }
    mobilePlayerSuppressClickUntil = 0
    const controlsContainer = getControls()?.getControlsContainer()
    const bounds = getContainer()?.getBoundingClientRect()
    const relativeX = bounds?.width > 0 ? (event.clientX - bounds.left) / bounds.width : 0.5
    const direction = relativeX <= 0.35 ? -1 : relativeX >= 0.65 ? 1 : 0
    queueMobilePlayerSurfaceTap(controlsContainer?.hasAttribute('shown') !== true, direction)
    return true
  }

  function consumeMobileTitleClickSuppression() {
    if (!isCapacitorMobilePlayer() || performance.now() >= mobileTitleSuppressClickUntil) {
      return false
    }

    mobileTitleSuppressClickUntil = 0
    return true
  }

  onUnmounted(() => {
    clearMobileSeekFeedback()
    clearTimeout(mobileFullscreenSettleTimer)
    clearTimeout(mobileSurfaceTapTimer)
    mobileFullscreenGesture = null
    mobilePlayerSuppressClickUntil = 0
    mobileSurfaceSuppressTouchEndUntil = 0
    mobileTitleSuppressClickUntil = 0
    mobileFullscreenTitleGesture = null
    lastMobileFullscreenTitleTap = null
  })

  return {
    cancelMobileFullscreenGesture,
    consumeMobileTitleClickSuppression,
    finishMobileFullscreenGesture,
    handleMobilePlayerSurfaceClick,
    handleMobilePlayerTouchEnd,
    mobileFullscreenSwipeSettling,
    mobileFullscreenSwipeStyle,
    mobileFullscreenSwiping,
    moveMobileFullscreenGesture,
    startMobileFullscreenGesture,
  }
}
