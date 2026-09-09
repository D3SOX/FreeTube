export const CAPACITOR_UI_SCALE_MIN = 75
export const CAPACITOR_UI_SCALE_MAX = 150

/**
 * Resize the layout viewport along with its visual scale, so responsive layouts
 * and native video bounds use the same CSS coordinates. CSS zoom alone leaves
 * media queries and window.innerWidth at the unscaled size.
 */
export function createCapacitorUiScale(window, document) {
  const viewport = document.querySelector('meta[name="viewport"]')
  let scale = 100
  let lastContent = ''

  function apply() {
    if (!viewport || !window.visualViewport) return
    const baseWidth = Math.round(window.visualViewport.width * window.visualViewport.scale)
    if (baseWidth <= 0) return
    const width = Math.max(1, Math.round(baseWidth * 100 / scale))
    const zoom = baseWidth / width
    const content = `width=${width}, initial-scale=${zoom}, viewport-fit=cover`
    if (content === lastContent) return
    lastContent = content
    viewport.setAttribute('content', content)
  }

  window.addEventListener('resize', apply)
  window.visualViewport?.addEventListener('resize', apply)

  return {
    setScale(value) {
      scale = Number.isFinite(value)
        ? Math.min(CAPACITOR_UI_SCALE_MAX, Math.max(CAPACITOR_UI_SCALE_MIN, value))
        : 100
      apply()
    },
    dispose() {
      window.removeEventListener('resize', apply)
      window.visualViewport?.removeEventListener('resize', apply)
    },
  }
}
