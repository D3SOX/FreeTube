import './androidNativeScreen.css'
import { overrideShakaMethods } from './overrideShakaMethods'

let inlineScreenOwner = null

/** Shares the existing feature panels with the native video and basic controls. */
export function createAndroidNativeScreen({ element, container, getController, getLocale, hasVideoCanvas, isFullscreenOnRotationEnabled = () => false, onError }) {
  let open = false
  let fullscreenFromRotation = false
  let frame = null
  let lastLayout = ''
  const ambientClips = new Map()
  const ambientHost = container.closest?.('.ftVideoPlayerHost')
  let controls = null
  let restoreControls = null
  let attached = false
  let lastInlineClip = ''
  let clippedPage = null
  const inlineOwner = {}

  function inlineClip(bounds, visible, origin = { x: 0, y: 0 }) {
    const style = getComputedStyle(container)
    const radius = Math.max(0, Math.min(parseFloat(style.borderTopLeftRadius) || 0, bounds.width / 2, bounds.height / 2))
    const left = bounds.x - origin.x
    const top = bounds.y - origin.y
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
    if (inlineScreenOwner === inlineOwner) {
      clippedPage?.removeAttribute('data-native-player-backdrop')
      clippedPage?.style.removeProperty('--native-player-content-clip')
    }
    clippedPage = null
  }

  function syncInlineBackground(visible) {
    if (!attached || open) return
    inlineScreenOwner = inlineOwner
    document.documentElement.classList.toggle('nativePlaybackInline', true)
    const bounds = container.getBoundingClientRect()
    const clip = inlineClip(bounds, visible)
    if (clip !== lastInlineClip) {
      document.documentElement.style.setProperty('--native-inline-background-clip', clip)
      lastInlineClip = clip
    }
    // Floating native video sits below the WebView. Cut the route's content
    // out too, while its teleported controls stay in the separate overlay layer.
    const page = container.closest?.('#cross-tab-mini-player-layer')
      ? document.querySelector('.app > .flexBox')
      : null
    if (page !== clippedPage) {
      clearPageClip()
      clippedPage = page
      page?.setAttribute('data-native-player-backdrop', '')
    }
    if (page) {
      const pageClip = inlineClip(bounds, visible, page.getBoundingClientRect())
      if (page.style.getPropertyValue('--native-player-content-clip') !== pageClip) {
        page.style.setProperty('--native-player-content-clip', pageClip)
      }
    }
  }

  function releaseInlineBackground() {
    clearPageClip()
    if (inlineScreenOwner === inlineOwner) {
      document.documentElement.classList.toggle('nativePlaybackInline', false)
      document.documentElement.style.removeProperty('--native-inline-background-clip')
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
    if (!open && !attached) return
    const bounds = element.getBoundingClientRect()
    syncAmbientClip(bounds)
    const sharedControls = container.querySelector('.shaka-controls-container')
    const controlBounds = sharedControls?.getBoundingClientRect() ?? bounds
    const visible = !document.hidden && bounds.width > 0 && bounds.height > 0 &&
      bounds.y + bounds.height > 0 && bounds.y < window.innerHeight &&
      container.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) !== false
    syncInlineBackground(visible)
    const centerElement = !open && document.elementFromPoint(
      Math.max(0, Math.min(window.innerWidth - 1, controlBounds.x + controlBounds.width / 2)),
      Math.max(0, Math.min(window.innerHeight - 1, controlBounds.y + controlBounds.height / 2)))
    // Notices need the same native clipping and touch priority as menus.
    const playerMenus = [...container.querySelectorAll('.shaka-overflow-menu:not(.shaka-hidden), .shaka-settings-menu:not(.shaka-hidden), .shaka-sub-menu:not(.shaka-hidden), .shaka-context-menu:not(.shaka-hidden), .skippedSegmentsWrapper')]
    // Global dialogs such as Quick Settings can cover only one native button.
    // Keep their whole rectangle above native controls, not just the center hit.
    const appChrome = open ? [] : [...document.querySelectorAll('.topNav, .sideNav, .tabBar, .capacitorTabletTabBar')]
    const globalMenus = open
      ? []
      : [...document.querySelectorAll('[role="dialog"], [role="menu"], [aria-modal="true"]')]
          .filter(menu => !container.contains(menu))
    const menuElements = [...playerMenus, ...globalMenus, ...appChrome]
    const menus = menuElements.map(menu => {
      const bounds = menu.getBoundingClientRect()
      // Include the status-bar area above the fixed app header.
      return menu.matches?.('.topNav') && bounds.height > 0
        ? { x: bounds.x, y: 0, width: bounds.width, height: bounds.y + bounds.height }
        : bounds
    }).filter(menu => menu.width > 0 && menu.height > 0)
    const panelOpen = ['fullscreenDockLayoutOpen', 'chaptersOverlayOpen'].some(name => container.classList.contains(name))
    const layout = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      viewportWidth: window.innerWidth,
      controlsX: controlBounds.x,
      controlsY: controlBounds.y,
      controlsWidth: controlBounds.width,
      controlsHeight: controlBounds.height,
      videoVisible: visible,
      controlsVisible: visible && controlBounds.width > 0 && controlBounds.height > 0 &&
        !container.classList.contains('scrollMiniPlayer') && sharedControls?.hasAttribute('shown') === true &&
        (!centerElement || container.contains(centerElement)),
      menus: menus.map(({ x, y, width, height }) => ({ x, y, width, height })),
      overlayActive: panelOpen || [...playerMenus, ...globalMenus].some(menu => {
        const bounds = menu.getBoundingClientRect()
        return bounds.width > 0 && bounds.height > 0
      })
    }
    const signature = JSON.stringify(layout)
    // Transforms do not trigger ResizeObserver. Follow zoom transitions until
    // their final frame so native video matches the shared gesture geometry.
    if ([container, element, ...menuElements].some(target => target.getAnimations().some(animation => animation.playState === 'running'))) scheduleLayout()
    if (signature === lastLayout) return
    lastLayout = signature
    getController()?.layout(layout).catch(onError)
  }
  function scheduleLayout() {
    if ((open || attached) && frame === null) frame = requestAnimationFrame(syncLayout)
  }
  const resize = new ResizeObserver(scheduleLayout)
  const mutations = new MutationObserver(scheduleLayout)
  resize.observe(container)
  resize.observe(element)
  // Popups outside the player must invalidate clipping even during paused video.
  mutations.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'style', 'shown', 'hidden', 'inert'], childList: true })
  mutations.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
  window.addEventListener('resize', scheduleLayout)
  window.addEventListener('scroll', scheduleLayout, true)
  document.addEventListener('visibilitychange', scheduleLayout)

  function setOpen(value) {
    if (open === value) return
    open = value
    if (!open) {
      fullscreenFromRotation = false
      clearAmbientClips()
    }
    document.documentElement.classList.toggle('nativePlaybackScreen', open)
    if (open) releaseInlineBackground()
    container.toggleAttribute('data-native-player-screen', open)
    lastLayout = ''
    document.dispatchEvent(new Event('fullscreenchange'))
    scheduleLayout()
  }
  async function attach() {
    if (!getController()) return
    await getController().show({ webOverlay: true, locale: getLocale(), fullscreen: open })
    attached = true
    container.toggleAttribute('data-native-player-controls', true)
    lastLayout = ''
    scheduleLayout()
  }
  async function show({ fromRotation = false } = {}) {
    if (open || !getController()) return
    fullscreenFromRotation = fromRotation
    setOpen(true)
    try {
      await attach()
    } catch (error) {
      setOpen(false)
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
      if (action === 'close') setOpen(false)
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
      attached = false
      container.toggleAttribute('data-native-player-controls', false)
      releaseInlineBackground()
      clearAmbientClips()
      setOpen(false)
    },
    destroy() {
      attached = false
      container.toggleAttribute('data-native-player-controls', false)
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
      if (frame !== null) cancelAnimationFrame(frame)
      restoreControls?.()
    },
  }
}
