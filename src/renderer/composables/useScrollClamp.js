import { nextTick, onBeforeUnmount, watch } from 'vue'
import { clampOverlayScrollTop } from '../helpers/overlayScrollbars'

/** Clamp a themed scroller after both viewport and content reflow. */
export function useScrollClamp(scroller, content) {
  let observer
  let frame
  const clamp = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      if (scroller.value && content.value) clampOverlayScrollTop(scroller.value, content.value)
    })
  }
  watch([scroller, content], async () => {
    observer?.disconnect()
    await nextTick()
    if (!scroller.value || !content.value) return
    observer = new ResizeObserver(clamp)
    observer.observe(scroller.value)
    observer.observe(content.value)
    clamp()
  }, { flush: 'post' })
  onBeforeUnmount(() => {
    observer?.disconnect()
    cancelAnimationFrame(frame)
  })
  return clamp
}
