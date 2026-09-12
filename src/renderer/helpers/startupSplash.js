export const STARTUP_REVEAL_DURATION_MS = 600

/** Fraction of the curtain remaining at a given height, measured from the rail. */
export function curtainExtent(elapsedMs, depth) {
  const time = elapsedMs / 1000
  const localTime = Math.max(0, time - 0.16 * Math.pow(depth, 1.25))
  const frequency = 23 - 7 * depth
  const damping = 0.98 - 0.26 * depth
  const oscillation = frequency * Math.sqrt(1 - damping * damping)
  const response = Math.exp(-damping * frequency * localTime) *
    (Math.cos(oscillation * localTime) + damping * frequency / oscillation * Math.sin(oscillation * localTime))
  // Pull the gathered fabric offscreen while the hem catches up, without the
  // preview's long pause at the edges.
  const exit = Math.min(1, Math.max(0, (time - 0.32) / 0.28))
  return Math.max(0, Math.min(1, 0.08 + 0.92 * response - 0.15 * exit * exit * (3 - 2 * exit)))
}

export function revealStartupSplash() {
  const splash = document.getElementById('startup-splash')
  if (!splash || splash.dataset.revealing) return
  splash.dataset.revealing = 'true'
  splash.setAttribute('aria-busy', 'false')

  let frame = 0
  let timeout
  const animations = []
  const finish = () => {
    cancelAnimationFrame(frame)
    clearTimeout(timeout)
    animations.forEach(animation => animation.cancel())
    document.removeEventListener('visibilitychange', onVisibilityChange)
    splash.remove()
    document.getElementById('app')?.removeAttribute('inert')
    document.dispatchEvent(new Event('startup-splash-hidden'))
  }
  const onVisibilityChange = () => {
    if (document.hidden) finish()
  }
  if (document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    finish()
    return
  }

  try {
    const canvas = splash.querySelector('.startupFabric')
    const curtain = splash.querySelector('.startupCurtain')
    const bounds = splash.getBoundingClientRect()
    // Soft folds need no high-DPI backing store. Bound the paint cost on large
    // displays and at fractional UI scales; CSS still covers the full window.
    const scale = Math.min(1, 1200 / bounds.width, 600 / bounds.height)
    const width = canvas.width = Math.max(1, Math.ceil(bounds.width * scale))
    const height = canvas.height = Math.max(1, Math.ceil(bounds.height * scale))
    const context = canvas.getContext('2d')
    if (!context) {
      finish()
      return
    }
    const texture = document.createElement('canvas')
    texture.width = 500
    texture.height = 1
    const painter = texture.getContext('2d')
    if (!painter) {
      finish()
      return
    }
    const colors = ['shadow', 'background', 'face', 'highlight', 'face', 'background', 'shadow'].map(name => {
      // Resolve theme functions such as color-mix() before passing them to Canvas.
      curtain.style.color = `var(--splash-${name})`
      return getComputedStyle(curtain).color
    })
    curtain.style.removeProperty('color')
    const stops = [0, 0.12, 0.32, 0.49, 0.64, 0.85, 1]
    const gradient = painter.createLinearGradient(0, 0, 500, 0)
    for (let fold = 0; fold < 5; fold++) {
      stops.forEach((position, index) => gradient.addColorStop((fold + position) / 5, colors[index]))
    }
    painter.fillStyle = gradient
    painter.fillRect(0, 0, 500, 1)

    const draw = elapsed => {
      context.clearRect(0, 0, width, height)
      let visible = false
      for (let y = 0; y < height; y++) {
        const extent = (width / 2 + 0.5) * curtainExtent(elapsed, y / height)
        if (extent <= 0) continue
        visible = true
        // Each scanline gathers at its own speed, so the folds bend with the
        // trailing hem instead of sliding or clipping a rigid rectangle.
        context.drawImage(texture, 0, 0, 500, 1, 0, y, extent, 1.2)
        context.drawImage(texture, 0, 0, 500, 1, width - extent, y, extent, 1.2)
      }
      return visible
    }
    draw(0)
    canvas.hidden = false
    splash.querySelectorAll('.startupCurtain').forEach(element => { element.hidden = true })
    for (const element of splash.querySelectorAll('.startupLogo, .startupTrack')) {
      animations.push(element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' }))
    }
    const start = performance.now()
    const render = now => {
      try {
        const elapsed = now - start
        if (elapsed >= STARTUP_REVEAL_DURATION_MS || !draw(elapsed)) {
          finish()
        } else {
          frame = requestAnimationFrame(render)
        }
      } catch {
        finish()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    timeout = setTimeout(finish, STARTUP_REVEAL_DURATION_MS + 100)
    frame = requestAnimationFrame(render)
  } catch {
    // A failed or disabled graphics context must never block the ready app.
    finish()
  }
}
