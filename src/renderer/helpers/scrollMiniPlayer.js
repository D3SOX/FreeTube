export const DEFAULT_SIZE = 360
export const DEFAULT_HEIGHT = 202
export const MIN_SIZE = 240
export const MAX_SIZE = 560
export const MARGIN = 16
export const EDGE_SNAP = 72
export const BOUNCE_MS = 450
export const DEFAULT_ASPECT_RATIO = 16 / 9

export const ENTER_MINI_RATIO = 0.15
export const EXIT_MINI_RATIO = 0.35

/** Minimum inline layout height before scroll mini player may activate. */
export const SCROLL_MINI_MIN_INLINE_LAYOUT_HEIGHT = 135

/**
 * Expected 16:9 inline player height from container width.
 * @param {HTMLElement | null | undefined} container
 * @param {number} [lastKnownHeight]
 * @returns {number}
 */
export function getScrollMiniInlineLayoutHeight(container, lastKnownHeight = 0) {
  if (!container) {
    return 0
  }

  const width = container.offsetWidth
  if (width <= 0) {
    return 0
  }

  const expectedHeight = Math.round(width * 9 / 16)
  const measuredHeight = container.offsetHeight

  return Math.max(measuredHeight, expectedHeight, lastKnownHeight)
}

/** @typedef {{ left: number, top: number, width: number, height: number, dock: 'left' | 'right', verticalDock?: 'top' | 'bottom', verticalOffset?: number, stashedSide?: 'left' | 'right' }} ScrollMiniPlayerRect */

/** @type {Record<'scroll' | 'tab', ScrollMiniPlayerRect | null>} */
const savedScrollMiniPlayerRects = { scroll: null, tab: null }

/**
 * @returns {ScrollMiniPlayerRect | null}
 * @param {'scroll' | 'tab'} mode
 */
export function getSavedScrollMiniPlayerRect(mode) {
  const savedScrollMiniPlayerRect = savedScrollMiniPlayerRects[mode]
  return savedScrollMiniPlayerRect ? { ...savedScrollMiniPlayerRect } : null
}

/**
 * @param {ScrollMiniPlayerRect | null} rect
 * @param {'scroll' | 'tab'} mode
 */
export function setSavedScrollMiniPlayerRect(rect, mode) {
  savedScrollMiniPlayerRects[mode] = rect ? { ...rect } : null
}

/**
 * @param {string} value
 * @returns {ScrollMiniPlayerRect | null}
 */
export function parseScrollMiniPlayerSavedRect(value) {
  if (!value) {
    return null
  }

  try {
    const parsed = JSON.parse(value)

    if (
      parsed == null ||
      !Number.isFinite(parsed.left) ||
      !Number.isFinite(parsed.top) ||
      !Number.isFinite(parsed.width) ||
      !Number.isFinite(parsed.height)
    ) {
      return null
    }

    // Deliberately not clamped here: restoring runs while the tab is still
    // loading, when the viewport can be unsized or mid-layout. Clamping against
    // that would shrink the rect and pin it to a corner, permanently losing the
    // saved size/position. The caller clamps on activation, once layout settled.
    return {
      left: parsed.left,
      top: parsed.top,
      width: parsed.width,
      height: parsed.height,
      dock: parsed.dock === 'left' ? 'left' : 'right',
      ...pickScrollMiniVerticalAnchor(parsed),
      ...pickScrollMiniStashedSide(parsed),
    }
  } catch {
    return null
  }
}

/** @param {Partial<ScrollMiniPlayerRect>} rect */
function pickScrollMiniStashedSide(rect) {
  return rect.stashedSide === 'left' || rect.stashedSide === 'right'
    ? { stashedSide: rect.stashedSide }
    : {}
}

/**
 * The anchor a rect already carries, if any. Reading it back beats re-deriving
 * one from the geometry: a viewport too short to honour the remembered distance
 * has to clamp the rect, and inferring from that would forget the distance for
 * good, instead of restoring it once the window grows again.
 *
 * @param {Partial<ScrollMiniPlayerRect> | null | undefined} rect
 * @returns {{ verticalDock: 'top' | 'bottom', verticalOffset: number } | null}
 */
export function pickScrollMiniVerticalAnchor(rect) {
  const parked = rect?.verticalDock === 'top' || rect?.verticalDock === 'bottom'

  // The offset is a distance from an inset, so anything negative is corrupt
  // rather than a position, and inferring one from the geometry beats replaying it.
  return parked && Number.isFinite(rect.verticalOffset) && rect.verticalOffset >= 0
    ? { verticalDock: rect.verticalDock, verticalOffset: rect.verticalOffset }
    : null
}

/**
 * Which vertical edge the rect is parked at, and how far from it. Absolute
 * coordinates go stale the moment the window is resized, so the anchor is what
 * gets remembered and replayed against the new viewport.
 *
 * @param {ScrollMiniPlayerRect} rect
 * @param {{ top: number, bottom: number }} [insets]
 * @returns {{ verticalDock: 'top' | 'bottom', verticalOffset: number }}
 */
export function getScrollMiniVerticalAnchor(rect, insets = getViewportInsets()) {
  const topOffset = rect.top - insets.top
  const bottomOffset = window.innerHeight - insets.bottom - (rect.top + rect.height)

  return bottomOffset <= topOffset
    ? { verticalDock: 'bottom', verticalOffset: Math.max(0, bottomOffset) }
    : { verticalDock: 'top', verticalOffset: Math.max(0, topOffset) }
}

/**
 * Anchor for rects saved before the anchor was recorded. Their coordinates were
 * measured against a viewport we no longer know, so they are only worth reading
 * while they still put the player at an edge: after a big enough resize the
 * stale position can be nearest the opposite edge, which would keep the player
 * stranded in the middle. Falling back to the bottom matches a fresh player, and
 * only ever happens once, since activation persists a real anchor.
 *
 * @param {ScrollMiniPlayerRect} rect
 * @param {{ top: number, bottom: number }} insets
 * @returns {{ verticalDock: 'top' | 'bottom', verticalOffset: number }}
 */
function getLegacyVerticalAnchor(rect, insets) {
  const anchor = getScrollMiniVerticalAnchor(rect, insets)

  return anchor.verticalOffset <= EDGE_SNAP
    ? anchor
    : { verticalDock: 'bottom', verticalOffset: 0 }
}

/**
 * Re-place a rect against the current viewport, keeping it the same distance
 * from the edges it was docked to. Without this a window that grew while the
 * player was docked (or closed) strands it mid-screen, because its remembered
 * left/top were only edge-aligned for the old viewport.
 *
 * @param {ScrollMiniPlayerRect} rect
 * @param {number} [aspectRatio]
 * @returns {ScrollMiniPlayerRect}
 */
export function reanchorScrollMiniPlayerRect(rect, aspectRatio = DEFAULT_ASPECT_RATIO) {
  const insets = getViewportInsets()
  // Share the longest edge across orientations, so a saved landscape width
  // becomes the portrait height instead of producing a much larger player.
  const width = Math.max(rect.width, rect.height) * Math.min(1, normalizeAspectRatio(aspectRatio))
  const sized = clampScrollMiniPlayerRect({ ...rect, width }, aspectRatio)
  const anchor = pickScrollMiniVerticalAnchor(rect) ?? getLegacyVerticalAnchor(sized, insets)

  const top = anchor.verticalDock === 'top'
    ? insets.top + anchor.verticalOffset
    : window.innerHeight - insets.bottom - sized.height - anchor.verticalOffset

  return {
    ...clampScrollMiniPlayerRect(snapScrollMiniPlayerToEdge({ ...sized, top, dock: rect.dock }, insets), aspectRatio),
    ...anchor,
  }
}

/**
 * @param {ScrollMiniPlayerRect} rect
 * @returns {string}
 */
export function serializeScrollMiniPlayerSavedRect(rect) {
  const anchor = pickScrollMiniVerticalAnchor(rect) ?? getScrollMiniVerticalAnchor(rect)

  return JSON.stringify({
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    dock: rect.dock,
    ...anchor,
    ...pickScrollMiniStashedSide(rect),
  })
}

/**
 * Usable viewport width. `window.innerWidth` includes the vertical scrollbar,
 * which would otherwise eat the inline-end margin (the mini player only shows
 * while the page is scrolled, so the scrollbar is always there).
 *
 * @returns {number}
 */
export function getViewportWidth() {
  return document.documentElement.clientWidth || window.innerWidth
}

/**
 * @returns {{ top: number, left: number, right: number, bottom: number }}
 */
export function getViewportInsets() {
  let topInset = MARGIN
  let leftInset = MARGIN
  let rightInset = MARGIN
  let bottomInset = MARGIN

  const topNav = document.querySelector('.topNav')
  const sideNav = document.querySelector('.sideNav')
  const tabBar = document.querySelector('.tabBar')
  const verticalTabBar = document.querySelector('.tabBar.vertical')

  if (topNav) {
    const rect = topNav.getBoundingClientRect()
    topInset = Math.max(topInset, rect.bottom + MARGIN)
  } else if (tabBar) {
    const rect = tabBar.getBoundingClientRect()
    if (rect.top < window.innerHeight - rect.bottom) {
      topInset = Math.max(topInset, rect.bottom + MARGIN)
    }
  }

  if (tabBar && !verticalTabBar) {
    const rect = tabBar.getBoundingClientRect()
    if (rect.top >= window.innerHeight - rect.bottom) {
      bottomInset = Math.max(bottomInset, window.innerHeight - rect.top + MARGIN)
    }
  }

  // On phones the side navigation becomes a fixed bottom bar. Use its
  // rendered geometry so the mini player also clears the Android safe area
  // included in the bar, without affecting the vertical desktop sidebar.
  if (sideNav) {
    const rect = sideNav.getBoundingClientRect()
    const isBottomBar = rect.width > rect.height &&
      rect.top >= window.innerHeight - rect.bottom
    if (isBottomBar) {
      bottomInset = Math.max(bottomInset, window.innerHeight - rect.top + MARGIN)
    }
  }

  // Keep clear of the fixed vertical tab bar column. Its setting names a
  // physical edge, so derive that edge from the measured bounds.
  if (verticalTabBar) {
    const rect = verticalTabBar.getBoundingClientRect()
    const viewportWidth = getViewportWidth()
    if (rect.left <= viewportWidth - rect.right) {
      leftInset = Math.max(leftInset, rect.right + MARGIN)
    } else {
      rightInset = Math.max(rightInset, viewportWidth - rect.left + MARGIN)
    }
  }

  return {
    top: topInset,
    left: leftInset,
    right: rightInset,
    bottom: bottomInset,
  }
}

/**
 * @param {number} [aspectRatio]
 * @returns {ScrollMiniPlayerRect}
 */
export function getDefaultScrollMiniPlayerRect(aspectRatio = DEFAULT_ASPECT_RATIO) {
  const insets = getViewportInsets()
  const width = DEFAULT_SIZE * Math.min(1, normalizeAspectRatio(aspectRatio))
  const height = getHeightForAspectRatio(width, aspectRatio)

  return {
    left: getViewportWidth() - width - insets.right,
    top: window.innerHeight - height - insets.bottom,
    width,
    height,
    dock: 'right',
  }
}

/**
 * @param {ScrollMiniPlayerRect} rect
 * @param {number} [aspectRatio]
 * @returns {ScrollMiniPlayerRect}
 */
export function clampScrollMiniPlayerRect(rect, aspectRatio = DEFAULT_ASPECT_RATIO) {
  const insets = getViewportInsets()
  const normalizedAspectRatio = normalizeAspectRatio(aspectRatio)
  const widthFactor = Math.min(1, normalizedAspectRatio)
  const maxWidth = Math.min(MAX_SIZE * widthFactor, getViewportWidth() - insets.left - insets.right)
  const maxHeight = window.innerHeight - insets.top - insets.bottom

  let width = Math.min(Math.max(rect.width, MIN_SIZE * widthFactor), maxWidth)
  let height = getHeightForAspectRatio(width, normalizedAspectRatio)
  if (height > maxHeight) {
    height = maxHeight
    width = getWidthForAspectRatio(height, normalizedAspectRatio)
  }

  const maxLeft = getViewportWidth() - insets.right - width
  const maxTop = window.innerHeight - insets.bottom - height
  const left = Math.min(Math.max(rect.left, insets.left), maxLeft)
  const top = Math.min(Math.max(rect.top, insets.top), maxTop)
  const dock = getDockFromRect({ left, width }, insets)

  return { left, top, width, height, dock }
}

/**
 * @param {Pick<ScrollMiniPlayerRect, 'left' | 'width'>} rect
 * @param {{ left: number, right: number }} insets
 * @returns {'left' | 'right'}
 */
export function getDockFromRect(rect, insets) {
  const leftDist = rect.left - insets.left
  const rightDist = getViewportWidth() - insets.right - (rect.left + rect.width)
  return leftDist <= rightDist ? 'left' : 'right'
}

/**
 * @param {ScrollMiniPlayerRect} rect
 * @returns {Record<string, string>}
 */
export function scrollMiniPlayerRectToStyle(rect) {
  // Overlays (e.g. the SponsorBlock skip notice) are sized for a full-size
  // player, so scale them to the available width, including on portrait videos.
  const scale = Math.max(0.6, Math.min(1, rect.width / DEFAULT_SIZE))

  return {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    zIndex: '150',
    '--scroll-mini-scale': `${scale}`,
  }
}

export const SCROLL_MINI_STASH_VISIBLE_SIZE = 36
export const SCROLL_MINI_STASH_THRESHOLD = 24

/**
 * Returns the physical side crossed by a drag far enough to stash the player.
 * @param {ScrollMiniPlayerRect} startRect
 * @param {number} deltaX
 * @param {number} viewportWidth
 * @param {{ left: number, right: number }} insets
 * @returns {'left' | 'right' | null}
 */
export function getScrollMiniPlayerStashSide(startRect, deltaX, viewportWidth, insets) {
  const rawLeft = startRect.left + deltaX
  if (rawLeft < insets.left - SCROLL_MINI_STASH_THRESHOLD) return 'left'
  if (rawLeft + startRect.width > viewportWidth - insets.right + SCROLL_MINI_STASH_THRESHOLD) return 'right'
  return null
}

/**
 * Leaves a tappable video sliver visible at the selected viewport edge.
 * @param {ScrollMiniPlayerRect} rect
 * @param {'left' | 'right'} side
 * @param {number} viewportWidth
 * @param {{ left: number, right: number }} insets
 * @returns {ScrollMiniPlayerRect}
 */
export function getStashedScrollMiniPlayerRect(rect, side, viewportWidth, insets) {
  return {
    ...rect,
    left: side === 'left'
      ? insets.left - rect.width + SCROLL_MINI_STASH_VISIBLE_SIZE
      : viewportWidth - insets.right - SCROLL_MINI_STASH_VISIBLE_SIZE,
  }
}

/**
 * @param {HTMLElement | null} element
 * @param {number} [layoutHeight]
 * @returns {number}
 */
export function getAnchorVisibleRatio(element, layoutHeight) {
  if (!element) {
    return 1
  }

  const rect = element.getBoundingClientRect()
  const height = layoutHeight > 0 ? layoutHeight : rect.height
  const bottom = rect.top + height
  const visibleTop = Math.max(rect.top, 0)
  const visibleBottom = Math.min(bottom, window.innerHeight)
  const visibleLeft = Math.max(rect.left, 0)
  const visibleRight = Math.min(rect.right, getViewportWidth())

  const visibleWidth = Math.max(0, visibleRight - visibleLeft)
  const visibleHeight = Math.max(0, visibleBottom - visibleTop)
  const visibleArea = visibleWidth * visibleHeight
  const totalArea = rect.width * height

  if (totalArea <= 0) {
    // Zero-height anchors cannot be observed reliably; treat as fully visible
    // so a broken placeholder does not trap the player in mini mode forever.
    return 1
  }

  return visibleArea / totalArea
}

/**
 * @param {ScrollMiniPlayerRect} rect
 * @param {{ left: number, right: number }} insets
 * @returns {boolean}
 */
export function shouldBounceScrollMiniPlayerToEdge(rect, insets) {
  const leftEdge = insets.left
  const rightEdge = getViewportWidth() - insets.right - rect.width
  const nearLeft = rect.left - leftEdge <= EDGE_SNAP
  const nearRight = rightEdge - rect.left <= EDGE_SNAP
  return !nearLeft && !nearRight
}

/**
 * @param {ScrollMiniPlayerRect} rect
 * @param {{ left: number, right: number, top: number, bottom: number }} insets
 * @returns {ScrollMiniPlayerRect}
 */
export function snapScrollMiniPlayerToEdge(rect, insets) {
  const dock = rect.dock
  const left = dock === 'left'
    ? insets.left
    : getViewportWidth() - insets.right - rect.width

  return { ...rect, left, dock }
}

/**
 * @param {number} t
 * @returns {number}
 */
function easeOutBack(t) {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

/**
 * @param {number} aspectRatio
 * @returns {number}
 */
export function normalizeAspectRatio(aspectRatio) {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return DEFAULT_ASPECT_RATIO
  }

  return aspectRatio
}

/**
 * @param {number} width
 * @param {number} aspectRatio
 * @returns {number}
 */
function getHeightForAspectRatio(width, aspectRatio) {
  return Math.max(1, Math.round(width / normalizeAspectRatio(aspectRatio)))
}

/**
 * @param {number} height
 * @param {number} aspectRatio
 * @returns {number}
 */
function getWidthForAspectRatio(height, aspectRatio) {
  return Math.max(1, Math.round(height * normalizeAspectRatio(aspectRatio)))
}

/**
 * @param {ScrollMiniPlayerRect} from
 * @param {ScrollMiniPlayerRect} to
 * @param {(rect: ScrollMiniPlayerRect) => void} onUpdate
 * @param {() => void} [onComplete]
 * @returns {() => void}
 */
export function animateScrollMiniPlayerBounce(from, to, onUpdate, onComplete) {
  const start = performance.now()
  let rafId = 0

  const tick = (now) => {
    const elapsed = now - start
    const progress = Math.min(1, elapsed / BOUNCE_MS)
    const eased = easeOutBack(progress)

    onUpdate({
      ...from,
      left: from.left + (to.left - from.left) * eased,
      top: from.top + (to.top - from.top) * eased,
      dock: to.dock,
    })

    if (progress < 1) {
      rafId = requestAnimationFrame(tick)
    } else if (onComplete) {
      onComplete()
    }
  }

  rafId = requestAnimationFrame(tick)

  return () => {
    if (rafId) {
      cancelAnimationFrame(rafId)
    }
  }
}

/**
 * @param {ScrollMiniPlayerRect} rect
 * @param {{ left: number, right: number, top: number, bottom: number }} insets
 * @returns {'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'}
 */
export function getResizeHandleCorner(rect, insets) {
  const dock = getDockFromRect(rect, insets)
  const centerY = rect.top + rect.height / 2
  const inUpperHalf = centerY < window.innerHeight / 2

  if (dock === 'left') {
    return inUpperHalf ? 'bottom-right' : 'top-right'
  }

  return inUpperHalf ? 'bottom-left' : 'top-left'
}

/**
 * @param {ScrollMiniPlayerRect} rect
 * @param {'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'} corner
 * @param {number} pointerX
 * @param {number} pointerY
 * @param {{ left: number, right: number, top: number, bottom: number }} insets
 * @param {number} [aspectRatio]
 * @returns {ScrollMiniPlayerRect}
 */
export function resizeScrollMiniPlayerFromCorner(rect, corner, pointerX, pointerY, insets, aspectRatio = DEFAULT_ASPECT_RATIO) {
  const dock = getDockFromRect(rect, insets)
  const normalizedAspectRatio = normalizeAspectRatio(aspectRatio)
  const widthFactor = Math.min(1, normalizedAspectRatio)
  const maxWidth = Math.min(MAX_SIZE * widthFactor, getViewportWidth() - insets.left - insets.right)
  const maxHeight = window.innerHeight - insets.top - insets.bottom

  let width
  if (corner.endsWith('right')) {
    width = pointerX - rect.left
  } else {
    width = rect.left + rect.width - pointerX
  }

  width = Math.min(Math.max(width, MIN_SIZE * widthFactor), maxWidth)
  let height = getHeightForAspectRatio(width, normalizedAspectRatio)

  if (height > maxHeight) {
    height = maxHeight
    width = getWidthForAspectRatio(height, normalizedAspectRatio)
  }

  const left = dock === 'left' ? insets.left : getViewportWidth() - insets.right - width
  let top

  if (corner.startsWith('top')) {
    top = rect.top + rect.height - height
  } else {
    top = rect.top
  }

  const clamped = clampScrollMiniPlayerRect({ left, top, width, height, dock }, normalizedAspectRatio)
  return { ...clamped, dock }
}

/**
 * @param {HTMLElement | null | undefined} track
 * @param {number} percent
 */
export function updateScrollMiniPlayerVolumeBarFill(track, percent) {
  if (!track) return

  const clampedPercent = Math.max(0, Math.min(100, percent))
  track.style.background = `linear-gradient(to right, var(--primary-color) ${clampedPercent}%, rgba(255, 255, 255, 0.3) ${clampedPercent}%, rgba(255, 255, 255, 0.3) 100%)`
}

/** @type {HTMLCanvasElement | null} */
let scrollMiniDragHandleSampleCanvas = null

const SCROLL_MINI_DRAG_HANDLE_WIDTH = 72
const SCROLL_MINI_DRAG_HANDLE_HEIGHT = 28

function getScrollMiniDragHandleSampleCanvas() {
  if (!scrollMiniDragHandleSampleCanvas) {
    scrollMiniDragHandleSampleCanvas = document.createElement('canvas')
    scrollMiniDragHandleSampleCanvas.width = 9
    scrollMiniDragHandleSampleCanvas.height = 3
  }

  return scrollMiniDragHandleSampleCanvas
}

/**
 * @param {HTMLVideoElement | null | undefined} videoElement
 * @param {number} [displayWidth]
 * @param {number} [displayHeight]
 * @param {{ left: number, top: number, width: number, height: number }} sampleRect
 * @returns {number | null}
 */
export function sampleScrollMiniHandleLuminance(videoElement, displayWidth, displayHeight, sampleRect) {
  if (!videoElement || videoElement.readyState < 2) return null

  const videoWidth = videoElement.videoWidth
  const videoHeight = videoElement.videoHeight
  if (!videoWidth || !videoHeight) return null

  const resolvedDisplayWidth = displayWidth > 0 ? displayWidth : videoElement.clientWidth
  const resolvedDisplayHeight = displayHeight > 0 ? displayHeight : videoElement.clientHeight
  if (!resolvedDisplayWidth || !resolvedDisplayHeight) return null

  const scale = Math.min(resolvedDisplayWidth / videoWidth, resolvedDisplayHeight / videoHeight)
  const renderedWidth = videoWidth * scale
  const renderedHeight = videoHeight * scale
  const offsetX = (resolvedDisplayWidth - renderedWidth) / 2
  const offsetY = (resolvedDisplayHeight - renderedHeight) / 2

  const contentLeft = offsetX
  const contentTop = offsetY
  const contentRight = offsetX + renderedWidth
  const contentBottom = offsetY + renderedHeight

  const sampleLeft = Math.max(sampleRect.left, contentLeft)
  const sampleTop = Math.max(sampleRect.top, contentTop)
  const sampleRight = Math.min(sampleRect.left + sampleRect.width, contentRight)
  const sampleBottom = Math.min(sampleRect.top + sampleRect.height, contentBottom)

  if (sampleRight <= sampleLeft || sampleBottom <= sampleTop) {
    return 0
  }

  const sx = (sampleLeft - offsetX) / scale
  const sy = (sampleTop - offsetY) / scale
  const sw = (sampleRight - sampleLeft) / scale
  const sh = (sampleBottom - sampleTop) / scale

  const canvas = getScrollMiniDragHandleSampleCanvas()
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  try {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(
      videoElement,
      sx, sy, sw, sh,
      0, 0, canvas.width, canvas.height
    )

    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let total = 0
    let count = 0

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3]
      if (alpha === 0) continue

      total += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      count++
    }

    return count > 0 ? total / count : null
  } catch {
    return null
  }
}

/**
 * @param {HTMLVideoElement | null | undefined} videoElement
 * @param {number} [displayWidth]
 * @param {number} [displayHeight]
 * @returns {number | null}
 */
export function sampleScrollMiniDragHandleLuminance(videoElement, displayWidth, displayHeight) {
  const resolvedDisplayWidth = displayWidth > 0 ? displayWidth : videoElement?.clientWidth

  return sampleScrollMiniHandleLuminance(videoElement, displayWidth, displayHeight, {
    left: resolvedDisplayWidth / 2 - SCROLL_MINI_DRAG_HANDLE_WIDTH / 2,
    top: 0,
    width: SCROLL_MINI_DRAG_HANDLE_WIDTH,
    height: SCROLL_MINI_DRAG_HANDLE_HEIGHT,
  })
}

/**
 * @param {number} luminance
 * @param {boolean} [previous]
 * @returns {boolean}
 */
export function resolveScrollMiniDragHandleOnLightBg(luminance, previous = false) {
  if (luminance >= 150) return true
  if (luminance <= 105) return false
  return previous
}
