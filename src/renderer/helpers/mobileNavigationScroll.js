// Accumulate small scroll steps without reacting to subpixel jitter or overscroll.
export function createMobileNavigationScroll() {
  let anchor = 0
  let hidden = false

  return {
    reset(position) {
      anchor = Math.max(0, position)
      hidden = false
    },
    update(position, maximum) {
      const top = Math.max(0, Math.min(position, Math.max(0, maximum)))
      if (top <= 8) {
        hidden = false
        anchor = 0
      } else if (hidden) {
        anchor = Math.max(anchor, top)
        if (anchor - top >= 8) {
          hidden = false
          anchor = top
        }
      } else {
        anchor = Math.min(anchor, top)
        if (top - anchor >= 8) {
          hidden = true
          anchor = top
        }
      }
      return hidden
    }
  }
}
