import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import { getCapacitorTabService } from '../../tabs/CapacitorTabService'
import { buildShiftedTabIds, computeTabOffsets, getTabIndexShift } from './tabReorder'

/** Hold for actions, then drag along the tablet strip using desktop tab geometry. */
export function useTabletTabReorder({ tabs, viewport, openActions, closeActions, clampScroll }) {
  const heldTabId = ref(null)
  const dragging = ref(false)
  const settling = ref(false)
  const offsets = ref({})
  const suppressTransitions = ref(false)
  const suppressClick = ref(false)
  const holding = computed(() => heldTabId.value !== null)
  let session = null
  let holdTimer = null
  let dropTimer = null
  let clickTimer = null
  let scrollFrame = null

  function reset() {
    clearTimeout(holdTimer)
    clearTimeout(dropTimer)
    cancelAnimationFrame(scrollFrame)
    holdTimer = dropTimer = scrollFrame = null
    const hadOffsets = Object.keys(offsets.value).length > 0
    if (hadOffsets) suppressTransitions.value = true
    session = null
    heldTabId.value = null
    dragging.value = settling.value = false
    offsets.value = {}
    if (hadOffsets) {
      nextTick(() => {
        clampScroll()
        requestAnimationFrame(() => { suppressTransitions.value = false })
      })
    }
  }

  function releaseClickSuppression() {
    clearTimeout(clickTimer)
    clickTimer = setTimeout(() => { suppressClick.value = false }, 0)
  }

  function cancel() {
    if (holding.value) closeActions()
    reset()
    releaseClickSuppression()
  }

  function start(event, tabId) {
    if (!event.isPrimary || event.button !== 0 || settling.value || event.target.closest('.capacitorTabletTabClose')) return
    reset()
    clearTimeout(clickTimer)
    suppressClick.value = false
    session = { tabId, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, currentX: event.clientX }
    const target = event.target.closest('.capacitorTabletTabTarget')
    holdTimer = setTimeout(() => {
      const element = viewport.value
      const content = element.querySelector('.capacitorTabletTabs')
      const direction = getComputedStyle(element).direction === 'rtl' ? -1 : 1
      const pinned = new Map(tabs.value.map(tab => [tab.id, tab.isPinned === true]))
      const rects = Array.from(content.children).map(tab => {
        const rect = tab.getBoundingClientRect()
        const id = tab.querySelector('[data-tab-id]').dataset.tabId
        return { id, start: direction === 1 ? rect.left : -rect.right, size: rect.width, isPinned: pinned.get(id) }
      })
      Object.assign(session, {
        rects,
        direction,
        sourceIndex: rects.findIndex(rect => rect.id === tabId),
        scrollStart: element.scrollLeft,
        maximumScroll: Math.max(0, content.getBoundingClientRect().width - element.clientWidth),
        gap: Number.parseFloat(getComputedStyle(content).columnGap) || 0,
        draggedIds: new Set([tabId]),
        targetIndex: rects.findIndex(rect => rect.id === tabId),
      })
      heldTabId.value = tabId
      suppressClick.value = true
      target.setPointerCapture(event.pointerId)
      openActions(tabId)
    }, 400)
  }

  function updatePosition() {
    const { rects, sourceIndex, direction, draggedIds, gap } = session
    const source = rects[sourceIndex]
    const delta = (session.currentX - session.startX + viewport.value.scrollLeft - session.scrollStart) * direction
    const first = rects.findIndex(rect => rect.isPinned === source.isPinned)
    const last = rects.findLastIndex(rect => rect.isPinned === source.isPinned)
    const shift = getTabIndexShift(rects, draggedIds, sourceIndex, source.start + source.size / 2 + delta, first, last)
    session.targetIndex = sourceIndex + shift
    session.order = buildShiftedTabIds(rects.map(rect => rect.id), [session.tabId], shift)
    offsets.value = computeTabOffsets(rects, session.order, gap, draggedIds, delta)
  }

  function autoScroll() {
    if (scrollFrame !== null) return
    let previous = performance.now()
    const frame = (time) => {
      const element = viewport.value
      const bounds = element.getBoundingClientRect()
      const speed = session.currentX < bounds.left + 48
        ? -Math.min(1, (bounds.left + 48 - session.currentX) / 48)
        : Math.max(0, Math.min(1, (session.currentX - bounds.right + 48) / 48))
      const before = element.scrollLeft
      const minimum = session.direction === 1 ? 0 : -session.maximumScroll
      const maximum = session.direction === 1 ? session.maximumScroll : 0
      // A translated tab can enlarge scrollWidth, so retain the real strip's range.
      element.scrollLeft = Math.max(minimum, Math.min(maximum, before + speed * Math.min(time - previous, 32) * 0.6))
      previous = time
      if (element.scrollLeft !== before) updatePosition()
      scrollFrame = requestAnimationFrame(frame)
    }
    scrollFrame = requestAnimationFrame(frame)
  }

  function move(event) {
    if (!session || session.pointerId !== event.pointerId || settling.value) return
    const moved = Math.hypot(event.clientX - session.startX, event.clientY - session.startY) > 8
    if (!holding.value) {
      if (moved) reset()
      return
    }
    if (!moved && !dragging.value) return
    event.preventDefault()
    if (!dragging.value) closeActions()
    dragging.value = true
    session.currentX = event.clientX
    updatePosition()
    autoScroll()
  }

  function finish(event) {
    if (!session || session.pointerId !== event.pointerId || settling.value) return
    cancelAnimationFrame(scrollFrame)
    scrollFrame = null
    if (!dragging.value) {
      reset()
      releaseClickSuppression()
      return
    }
    dragging.value = false
    settling.value = true
    offsets.value = computeTabOffsets(session.rects, session.order, session.gap)
    const reducedMotion = document.documentElement.dataset.reducedMotion === 'reduce' ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    dropTimer = setTimeout(() => {
      const { tabId, sourceIndex, targetIndex } = session
      reset()
      if (targetIndex !== sourceIndex) getCapacitorTabService().moveTab(tabId, targetIndex)
      releaseClickSuppression()
    }, reducedMotion ? 0 : 160)
  }

  function preventHoldScroll(event) {
    // A quick swipe scrolls normally; after a hold, the pointer owns the drag.
    if (holding.value && event.touches.length === 1) event.preventDefault()
  }

  function contextMenu(event, tabId) {
    if (session?.tabId === tabId || (event.pointerType === 'touch' && suppressClick.value)) return
    openActions(tabId)
  }

  function style(tabId) {
    const offset = offsets.value[tabId]
    return offset === undefined ? undefined : { transform: `translateX(${offset * session.direction}px)` }
  }

  watch(() => tabs.value.map(tab => `${tab.id}:${tab.isPinned}`).join(','), cancel)
  onBeforeUnmount(() => {
    reset()
    clearTimeout(clickTimer)
  })

  return {
    heldTabId,
    holding,
    dragging,
    settling,
    suppressTransitions,
    suppressClick,
    start,
    move,
    finish,
    cancel,
    preventHoldScroll,
    contextMenu,
    style,
  }
}
