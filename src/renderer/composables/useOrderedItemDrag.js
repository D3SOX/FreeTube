import { onBeforeUnmount, ref } from 'vue'

/**
 * Shares pointer drag reordering between ordered settings lists.
 *
 * @param {object} options
 * @param {import('vue').ComputedRef<string[]>} options.items
 * @param {string} options.rowSelector
 * @param {string} options.itemIdAttribute
 * @param {(items: string[]) => unknown} options.updateItems
 * @param {(itemId: string, position: number) => void} options.announceMoved
 */
export function useOrderedItemDrag({ items, rowSelector, itemIdAttribute, updateItems, announceMoved }) {
  const draggedItemId = ref(null)
  const dropTarget = ref(null)
  let pointerId = null
  let pointerHandle = null
  let pointerList = null
  let pointerScroller = null
  let pointerPosition = null
  let autoScrollFrame = null
  let lastScrollTime = 0

  function startDragging(event, itemId) {
    if (pointerId !== null) {
      event.preventDefault()
      return
    }
    draggedItemId.value = itemId
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', itemId)
    const row = event.currentTarget.closest(rowSelector)
    if (row !== null) event.dataTransfer.setDragImage(row, 20, 20)
  }

  function handleDragOver(event, itemId) {
    if (draggedItemId.value == null || draggedItemId.value === itemId) {
      dropTarget.value = null
      return
    }

    const bounds = event.currentTarget.getBoundingClientRect()
    dropTarget.value = {
      id: itemId,
      after: event.clientY >= bounds.top + bounds.height / 2,
    }
    event.dataTransfer.dropEffect = 'move'
  }

  function dropItem(event, itemId) {
    const bounds = event.currentTarget.getBoundingClientRect()
    commitDrop(itemId, event.clientY >= bounds.top + bounds.height / 2)
  }

  function commitDrop(itemId, after) {
    const draggedId = draggedItemId.value
    if (draggedId == null || draggedId === itemId) {
      stopDragging()
      return
    }

    const sourceIndex = items.value.indexOf(draggedId)
    const targetIndex = items.value.indexOf(itemId)
    if (sourceIndex === -1 || targetIndex === -1) {
      stopDragging()
      return
    }

    let insertIndex = targetIndex + (after ? 1 : 0)
    const reordered = items.value.slice()
    reordered.splice(sourceIndex, 1)
    if (sourceIndex < insertIndex) insertIndex--
    reordered.splice(insertIndex, 0, draggedId)
    updateItems(reordered)
    announceMoved(draggedId, insertIndex)
    stopDragging()
  }

  function startPointerDrag(event, itemId) {
    if (event.pointerType === 'mouse' || !event.isPrimary || event.button !== 0) return

    stopDragging()
    pointerId = event.pointerId
    pointerHandle = event.currentTarget
    pointerList = pointerHandle.closest(rowSelector)?.parentElement
    pointerScroller = pointerList
    while (pointerScroller && !/auto|scroll/.test(getComputedStyle(pointerScroller).overflowY)) {
      pointerScroller = pointerScroller.parentElement
    }
    draggedItemId.value = itemId
    pointerHandle.setPointerCapture(pointerId)
  }

  function movePointerDrag(event) {
    if (event.pointerId !== pointerId) return

    pointerPosition = { x: event.clientX, y: event.clientY }
    updatePointerDropTarget()
    if (pointerScroller && autoScrollFrame === null) {
      lastScrollTime = performance.now()
      autoScrollFrame = requestAnimationFrame(scrollNearEdge)
    }
  }

  function updatePointerDropTarget() {
    // Pointer capture keeps events on the grip; hit-test the row under the finger.
    const row = document.elementFromPoint(pointerPosition.x, pointerPosition.y)?.closest(rowSelector)
    const itemId = row?.getAttribute(itemIdAttribute)
    if (row == null || row.parentElement !== pointerList || itemId === draggedItemId.value) {
      dropTarget.value = null
      return
    }

    const bounds = row.getBoundingClientRect()
    dropTarget.value = { id: itemId, after: pointerPosition.y >= bounds.top + bounds.height / 2 }
  }

  function scrollNearEdge(time) {
    autoScrollFrame = null
    const bounds = pointerScroller.getBoundingClientRect()
    if (pointerPosition.x < bounds.left || pointerPosition.x > bounds.right) return

    const edgeSize = Math.min(40, bounds.height / 3)
    const topDistance = pointerPosition.y - bounds.top
    const bottomDistance = bounds.bottom - pointerPosition.y
    const direction = topDistance < edgeSize ? -1 : bottomDistance < edgeSize ? 1 : 0
    if (direction === 0) return

    const distance = direction < 0 ? topDistance : bottomDistance
    const speed = direction * 600 * Math.min(1, 1 - distance / edgeSize)
    const elapsed = Math.min(time - lastScrollTime, 32)
    lastScrollTime = time
    pointerScroller.scrollBy({ top: speed * elapsed / 1000, behavior: 'instant' })
    updatePointerDropTarget()
    autoScrollFrame = requestAnimationFrame(scrollNearEdge)
  }

  function endPointerDrag(event) {
    if (event.pointerId !== pointerId) return

    movePointerDrag(event)
    if (dropTarget.value !== null) {
      commitDrop(dropTarget.value.id, dropTarget.value.after)
    } else {
      stopDragging()
    }
  }

  function cancelPointerDrag(event) {
    if (event.pointerId === pointerId) stopDragging()
  }

  function stopDragging() {
    if (autoScrollFrame !== null) cancelAnimationFrame(autoScrollFrame)
    autoScrollFrame = null
    pointerScroller = null
    pointerPosition = null
    const handle = pointerHandle
    const capturedId = pointerId
    pointerId = null
    pointerHandle = null
    pointerList = null
    draggedItemId.value = null
    dropTarget.value = null
    if (handle?.hasPointerCapture(capturedId)) handle.releasePointerCapture(capturedId)
  }

  onBeforeUnmount(stopDragging)

  return {
    draggedItemId,
    dropTarget,
    dropItem,
    handleDragOver,
    startDragging,
    startPointerDrag,
    movePointerDrag,
    endPointerDrag,
    cancelPointerDrag,
    stopDragging,
  }
}
