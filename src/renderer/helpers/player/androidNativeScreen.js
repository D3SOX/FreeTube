import { overrideShakaMethods } from './overrideShakaMethods'

let inlineScreenOwner = null
let inlineBackdrop = null

/** Shares the existing feature panels with the native video and basic controls. */
export function createAndroidNativeScreen({ element, container, getController, getLocale, hasVideoCanvas, isFullscreenOnRotationEnabled = () => false, onError }) {
  let open = false
  let presentationSequence = 0
  let fullscreenFromRotation = false
  let frame = null
  let lastLayout = ''
  const ambientClips = new Map()
  const ambientHost = container.closest?.('.ftVideoPlayerHost')
  let controls = null
  let restoreControls = null
  let attached = false
  let attachmentSequence = 0
  let lastInlineClip = ''
  let clippedPage = null
  const inlineOwner = { clearPageClip }
  let transitionSequence = 0
  let transitioning = false
  let pageScrolling = false
  let gestureActive = false
  let appChromeElements = []
  let globalMenuElements = []
  let globalElementsDirty = true
  const appChromeSelector = '.topNav, .sideNav, .tabBar, .capacitorTabletTabBar'

  function endTransition() {
    if (!transitioning) return
    transitionSequence++
    transitioning = false
    container.toggleAttribute('data-native-player-transition', false)
    lastLayout = ''
    syncLayout()
    return getController()?.layout({ endTransition: true }).catch(onError)
  }

  function handleTransition(event) {
    if (!event.detail) {
      endTransition()
      return
    }
    if (!attached || open || hasVideoCanvas?.()) return
    event.preventDefault()
    endGesture()
    const sequence = ++transitionSequence
    const { from, to, duration } = event.detail
    container.toggleAttribute('data-native-player-transition', true)
    // Flush the hidden overlays' exclusions before native animation freezes
    // layout updates and raises the video above the WebView.
    syncLayout()
    transitioning = true
    // The native animator owns the moving video. Keep the WebView at the
    // destination, ready for the handoff once its final clip has been drawn.
    syncInlineBackground(false)
    const rect = ({ x, y, width, height }) => ({ x, y, width, height })
    event.detail.finished = getController().layout({
      ...rect(to),
      viewportWidth: window.innerWidth,
      transition: { from: rect(from), duration, radius: parseFloat(getComputedStyle(container).borderTopLeftRadius) || 0 }
    }).catch(onError).finally(() => {
      if (transitionSequence === sequence) return endTransition()
    })
  }
  container.addEventListener('native-player-transition', handleTransition)

  function handleGesture(event) {
    if (!attached || open || hasVideoCanvas?.()) return
    gestureActive = event.detail === true
    container.toggleAttribute('data-native-player-gesture', gestureActive)
    // Pointer handlers update Vue geometry in the same turn. Send the final
    // rectangle and reopen the cutout together after that update has rendered.
    scheduleLayout()
  }
  container.addEventListener('native-player-gesture', handleGesture)

  function endGesture() {
    if (!gestureActive) return
    gestureActive = false
    container.toggleAttribute('data-native-player-gesture', false)
    syncLayout()
  }

  function inlineClip(bounds, visible, origin = { x: 0, y: 0 }) {
    const style = getComputedStyle(container)
    const radius = Math.max(0, Math.min(parseFloat(style.borderTopLeftRadius) || 0, bounds.width / 2, bounds.height / 2))
    // Float32 viewport bounds plus fractional WebView scroll offsets can vary
    // by millionths of a CSS pixel. Do not invalidate the whole page's backdrop
    // for that noise; retain the same subpixel precision as native geometry.
    const left = Math.round((bounds.x - origin.x) * 1000) / 1000
    const top = Math.round((bounds.y - origin.y) * 1000) / 1000
    const right = left + bounds.width
    const bottom = top + bounds.height
    // Preserve the page background everywhere except the native video's window.
    // The rounded hole also clips zoomed video to the shared player's boundary.
    const hole = visible && !hasVideoCanvas?.()
      ? `M ${left + radius} ${top} H ${right - radius} Q ${right} ${top} ${right} ${top + radius} V ${bottom - radius} Q ${right} ${bottom} ${right - radius} ${bottom} H ${left + radius} Q ${left} ${bottom} ${left} ${bottom - radius} V ${top + radius} Q ${left} ${top} ${left + radius} ${top} Z`
      : ''
    return `path(evenodd, "M -100000 -100000 H 100000 V 100000 H -100000 Z ${hole}")`
  }

  function clearPageClip() {
    if (clippedPage) resize.unobserve(clippedPage)
    if (inlineScreenOwner === inlineOwner) {
      clippedPage?.removeAttribute('data-native-player-backdrop')
      clippedPage?.style.removeProperty('clip-path')
    }
    clippedPage = null
  }

  function followsPageScroll() {
    return !open && !container.classList.contains('scrollMiniPlayer') && !container.classList.contains('fullWindow')
  }

  function syncInlineBackground(visible) {
    if (!attached || open) return
    if (inlineScreenOwner !== inlineOwner) {
      inlineScreenOwner?.clearPageClip()
      lastInlineClip = ''
    }
    inlineScreenOwner = inlineOwner
    if (!inlineBackdrop) {
      inlineBackdrop = document.createElement('div')
      inlineBackdrop.className = 'nativeInlineBackdrop'
      inlineBackdrop.setAttribute('aria-hidden', 'true')
      document.body.append(inlineBackdrop)
    }
    const bounds = container.getBoundingClientRect()
    const scrolling = followsPageScroll()
    const origin = scrolling ? { x: -window.scrollX, y: -window.scrollY } : undefined
    const clip = inlineClip(bounds, visible, origin)
    const pageHeight = scrolling ? `${Math.max(window.innerHeight, document.body.getBoundingClientRect().height)}px` : ''
    // Read both openings before changing either clip, so a resize does not
    // force another style/layout pass midway through measuring the page.
    const page = container.closest?.('#cross-tab-mini-player-layer')
      ? document.querySelector('.app > .flexBox')
      : null
    const pageClip = page ? inlineClip(bounds, visible, page.getBoundingClientRect()) : ''
    document.documentElement.classList.toggle('nativePlaybackInline', true)
    document.documentElement.classList.toggle('nativePlaybackPageScroll', scrolling)
    if (inlineBackdrop.style.getPropertyValue('block-size') !== pageHeight) {
      inlineBackdrop.style.setProperty('block-size', pageHeight)
    }
    if (clip !== lastInlineClip) {
      // Keep changing geometry local. Inherited custom properties make every
      // descendant recalculate styles while dragging or resizing the mini player.
      inlineBackdrop.style.setProperty('clip-path', clip)
      lastInlineClip = clip
    }
    // Floating native video sits below the WebView. Cut the route's content
    // out too, while its teleported controls stay in the separate overlay layer.
    if (page !== clippedPage) {
      clearPageClip()
      clippedPage = page
      page?.setAttribute('data-native-player-backdrop', '')
      if (page) resize.observe(page)
    }
    if (page) {
      if (page.style.getPropertyValue('clip-path') !== pageClip) {
        page.style.setProperty('clip-path', pageClip)
      }
    }
  }

  function releaseInlineBackground() {
    clearPageClip()
    if (inlineScreenOwner === inlineOwner) {
      document.documentElement.classList.toggle('nativePlaybackInline', false)
      document.documentElement.classList.toggle('nativePlaybackPageScroll', false)
      inlineBackdrop?.remove()
      inlineBackdrop = null
      inlineScreenOwner = null
    }
    lastInlineClip = ''
  }

  function clearAmbientClips() {
    for (const canvas of ambientClips.keys()) canvas.style.removeProperty('clip-path')
    ambientClips.clear()
  }

  function syncAmbientClip(bounds) {
    const canvases = open
      ? [container.querySelector('.ambientFullscreenCanvas')].filter(Boolean)
      : [...(ambientHost?.querySelectorAll('.ambientCanvas, .ambientLayoutCanvas') ?? [])]
    for (const canvas of ambientClips.keys()) {
      if (!canvases.includes(canvas)) {
        canvas.style.removeProperty('clip-path')
        ambientClips.delete(canvas)
      }
    }
    for (const canvas of canvases) {
      const canvasBounds = canvas.getBoundingClientRect()
      if (!canvasBounds.width || !canvasBounds.height || !bounds.width || !bounds.height) continue
      // The WebView is above Media3, including the glow. Cut the fitted video
      // out after CSS blur in inline and fullscreen layouts.
      const ratio = element.videoWidth > 0 && element.videoHeight > 0
        ? element.videoWidth / element.videoHeight
        : bounds.width / bounds.height
      const width = Math.min(bounds.width, bounds.height * ratio)
      const height = Math.min(bounds.height, bounds.width / ratio)
      const left = bounds.x + (bounds.width - width) / 2 - canvasBounds.x
      const top = bounds.y + (bounds.height - height) / 2 - canvasBounds.y
      const point = (x, y) => `${x.toFixed(3)}px ${y.toFixed(3)}px`
      const clip = `polygon(evenodd, -100% -100%, 200% -100%, 200% 200%, -100% 200%, -100% -100%, ${point(left, top)}, ${point(left + width, top)}, ${point(left + width, top + height)}, ${point(left, top + height)}, ${point(left, top)})`
      if (clip !== ambientClips.get(canvas)) {
        canvas.style.clipPath = clip
        ambientClips.set(canvas, clip)
      }
    }
  }

  function syncLayout() {
    frame = null
    if ((!open && !attached) || transitioning) return
    const bounds = element.getBoundingClientRect()
    const sharedControls = container.querySelector('.shaka-controls-container')
    const controlBounds = sharedControls?.getBoundingClientRect() ?? bounds
    const visible = !document.hidden && bounds.width > 0 && bounds.height > 0 &&
      bounds.y + bounds.height > 0 && bounds.y < window.innerHeight &&
      container.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) !== false
    // Notices need the same native clipping and touch priority as menus.
    const playerMenus = [...container.querySelectorAll('.shaka-overflow-menu:not(.shaka-hidden), .shaka-settings-menu:not(.shaka-hidden), .shaka-sub-menu:not(.shaka-hidden), .shaka-context-menu:not(.shaka-hidden), .skippedSegmentsWrapper')]
    const countdowns = [...container.querySelectorAll('.countdownProgress')]
    // Global dialogs such as Quick Settings can cover only one native button.
    // Keep their whole rectangle above native controls, not just the center hit.
    // Scroll and scrollbar style updates change geometry, not membership.
    // Avoid searching the whole Watch page again on every scrolling frame.
    if (globalElementsDirty) {
      appChromeElements = [...document.querySelectorAll(appChromeSelector)]
      globalMenuElements = [...document.querySelectorAll('dialog[open], [role="dialog"], [role="menu"], [aria-modal="true"]')]
      globalElementsDirty = false
    }
    const appChrome = open ? [] : appChromeElements
    const globalMenus = globalMenuElements
      .filter(menu => menu.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) !== false)
    // Hidden notices retain their layout box during native scrolling/gestures.
    // Clipping that box would punch through the raised video into the page.
    const menuElements = [...playerMenus, ...countdowns, ...globalMenus, ...appChrome]
      .filter(menu => menu.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) !== false)
    const pageScroll = followsPageScroll()
    const nativeY = y => pageScroll ? Math.round((y + window.scrollY) * 1000) / 1000 : y
    const menus = menuElements.map(menu => {
      const bounds = menu.getBoundingClientRect()
      // Include the status-bar area above the fixed app header.
      return menu.matches?.('.topNav') && bounds.height > 0
        ? { x: bounds.x, y: 0, width: bounds.width, height: bounds.y + bounds.height }
        : { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, pageScroll: pageScroll && container.contains(menu) }
    }).filter(menu => menu.width > 0 && menu.height > 0)
    const panelOpen = ['fullscreenDockLayoutOpen', 'chaptersOverlayOpen'].some(name => container.classList.contains(name))
    const layout = {
      x: bounds.x,
      y: nativeY(bounds.y),
      width: bounds.width,
      height: bounds.height,
      viewportWidth: window.innerWidth,
      pageScroll,
      miniPlayer: container.classList.contains('scrollMiniPlayer'),
      gestureActive,
      radius: parseFloat(getComputedStyle(container).borderTopLeftRadius) || 0,
      controlsX: controlBounds.x,
      controlsY: nativeY(controlBounds.y),
      controlsWidth: controlBounds.width,
      controlsHeight: controlBounds.height,
      videoVisible: visible,
      controlsVisible: visible && controlBounds.width > 0 && controlBounds.height > 0 &&
        !container.querySelector('.endedPoster') &&
        !container.classList.contains('scrollMiniPlayer') && sharedControls?.hasAttribute('shown') === true,
      // Android clips and routes touches around these rectangles. A browser
      // hit test at the controls' center duplicates that work on every scroll.
      menus: menus.map(({ x, y, width, height, pageScroll = false }) => ({ x, y: pageScroll ? nativeY(y) : y, width, height, pageScroll })),
      overlayActive: panelOpen || [...playerMenus, ...globalMenus].some(menu => {
        const bounds = menu.getBoundingClientRect()
        return bounds.width > 0 && bounds.height > 0
      })
    }
    const signature = JSON.stringify(layout)
    // Transforms do not trigger ResizeObserver. Follow zoom transitions until
    // their final frame so native video matches the shared gesture geometry.
    if ([container, element, ...menuElements].some(target => target.getAnimations().some(animation => animation.playState === 'running'))) scheduleLayout()
    syncAmbientClip(bounds)
    syncInlineBackground(visible && !pageScrolling && !gestureActive)
    if (signature === lastLayout) return
    lastLayout = signature
    getController()?.layout(layout).catch(onError)
  }
  function scheduleLayout() {
    if ((open || attached) && frame === null) frame = requestAnimationFrame(syncLayout)
  }
  const resize = new ResizeObserver(scheduleLayout)
  const mutations = new MutationObserver(records => {
    if (records.some(record => record.type === 'childList'
      ? [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1)
      : ['role', 'aria-modal', 'open'].includes(record.attributeName) ||
        (record.attributeName === 'class' && (appChromeElements.includes(record.target) || record.target.matches(appChromeSelector))))) {
      globalElementsDirty = true
    }
    scheduleLayout()
  })
  resize.observe(document.body)
  resize.observe(container)
  resize.observe(element)
  // Popups outside the player must invalidate clipping even during paused video.
  mutations.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'style', 'shown', 'hidden', 'inert', 'role', 'aria-modal', 'open'], childList: true })
  mutations.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
  window.addEventListener('resize', scheduleLayout)
  window.addEventListener('scroll', scheduleLayout, true)
  document.addEventListener('visibilitychange', scheduleLayout)

  function setOpen(value) {
    if (open === value) return
    endGesture()
    endTransition()
    open = value
    presentationSequence++
    if (!open) {
      fullscreenFromRotation = false
      clearAmbientClips()
    }
    document.documentElement.classList.toggle('nativePlaybackScreen', open)
    if (open) releaseInlineBackground()
    container.toggleAttribute('data-native-player-screen', open)
    lastLayout = ''
    if (!open) document.dispatchEvent(new Event('fullscreenchange'))
    scheduleLayout()
  }
  async function attach() {
    if (!getController()) return
    const sequence = ++attachmentSequence
    await getController().show({ webOverlay: true, locale: getLocale(), fullscreen: open })
    if (attachmentSequence !== sequence) return
    attached = true
    container.toggleAttribute('data-native-player-controls', true)
    lastLayout = ''
    scheduleLayout()
  }
  async function show({ fromRotation = false } = {}) {
    if (open || !getController()) return
    fullscreenFromRotation = fromRotation
    setOpen(true)
    const sequence = presentationSequence
    try {
      const attaching = attach()
      // Queue rotation with native fullscreen, before waiting for its first
      // frame. Waiting here presents portrait fullscreen before rotating it.
      document.dispatchEvent(new Event('fullscreenchange'))
      await attaching
    } catch (error) {
      if (presentationSequence === sequence) setOpen(false)
      throw error
    }
  }
  async function hide() {
    setOpen(false)
    await getController()?.hide()
  }
  function handleRotation() {
    if (!isFullscreenOnRotationEnabled() || !attached || document.hidden || !element.readyState ||
        container.getBoundingClientRect().width <= 0 || controls?.isFullScreenSupported() === false) return
    const orientation = window.screen?.orientation?.type ?? ''
    if (orientation.startsWith('landscape') && !open) show({ fromRotation: true }).catch(onError)
    else if (orientation.startsWith('portrait') && open) hide().catch(onError)
  }
  window.screen?.orientation?.addEventListener('change', handleRotation)

  function handleFullscreenClick(event) {
    if (!event.target.closest('.shaka-fullscreen-button')) return
    event.preventDefault()
    event.stopImmediatePropagation()
    ;(open ? hide() : show()).catch(onError)
  }
  container.addEventListener('click', handleFullscreenClick, true)

  return {
    attach,
    show,
    hide,
    isOpen: () => open,
    isFullscreenFromRotation: () => fullscreenFromRotation,
    hasSurface: () => attached,
    bindControls(nextControls) {
      restoreControls?.()
      controls = nextControls
      restoreControls = overrideShakaMethods(controls, {
        toggleFullScreen: () => open ? hide() : show(),
        isFullScreenEnabled: () => open,
      })
    },
    action(action) {
      if (action === 'scroll-start') {
        pageScrolling = true
        container.toggleAttribute('data-native-player-scrolling', true)
      } else if (action === 'scroll-end') {
        pageScrolling = false
        container.toggleAttribute('data-native-player-scrolling', false)
        lastLayout = ''
        syncLayout()
        getController()?.layout({ endScroll: true }).catch(onError)
      } else if (action === 'close') setOpen(false)
      else if (action === 'controls') controls?.showUI()
      else if (action === 'back') {
        const submenu = container.querySelector('.shaka-sub-menu:not(.shaka-hidden), .shaka-settings-menu:not(.shaka-hidden)')
        const back = submenu?.querySelector('.shaka-back-to-overflow-button')
        if (back) {
          back.click()
          scheduleLayout()
          return
        }
        if (controls?.anySettingsMenusAreOpen()) {
          controls.hideSettingsMenus()
          scheduleLayout()
          return
        }
        // Existing panels and menus already implement Escape, including nested
        // views and their focus restoration.
        const target = container.contains(document.activeElement) ? document.activeElement : container
        target.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true,
        }))
        target.dispatchEvent(new KeyboardEvent('keyup', {
          key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true,
        }))
      }
      scheduleLayout()
    },
    reset() {
      attachmentSequence++
      endGesture()
      endTransition()
      attached = false
      pageScrolling = false
      container.toggleAttribute('data-native-player-controls', false)
      container.toggleAttribute('data-native-player-scrolling', false)
      releaseInlineBackground()
      clearAmbientClips()
      setOpen(false)
    },
    destroy() {
      attachmentSequence++
      endGesture()
      endTransition()
      attached = false
      pageScrolling = false
      container.toggleAttribute('data-native-player-controls', false)
      container.toggleAttribute('data-native-player-scrolling', false)
      releaseInlineBackground()
      clearAmbientClips()
      setOpen(false)
      resize.disconnect()
      mutations.disconnect()
      window.screen?.orientation?.removeEventListener('change', handleRotation)
      window.removeEventListener('resize', scheduleLayout)
      window.removeEventListener('scroll', scheduleLayout, true)
      document.removeEventListener('visibilitychange', scheduleLayout)
      container.removeEventListener('click', handleFullscreenClick, true)
      container.removeEventListener('native-player-transition', handleTransition)
      container.removeEventListener('native-player-gesture', handleGesture)
      if (frame !== null) cancelAnimationFrame(frame)
      restoreControls?.()
    },
  }
}
