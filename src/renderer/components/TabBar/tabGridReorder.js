/**
 * Preview a single-card reorder without changing the grid's layout. All
 * coordinates remain fractional CSS pixels, including at non-default zoom.
 * @param {Array<{id: string, left: number, top: number, width: number, height: number, isPinned: boolean}>} rects
 * @param {string} sourceId
 * @param {number} deltaX
 * @param {number} deltaY
 */
export function getTabGridReorder(rects, sourceId, deltaX, deltaY) {
  const sourceIndex = rects.findIndex(rect => rect.id === sourceId)
  const source = rects[sourceIndex]
  const centerX = source.left + source.width / 2 + deltaX
  const centerY = source.top + source.height / 2 + deltaY
  let targetIndex = sourceIndex
  let nearestDistance = Infinity
  rects.forEach((rect, index) => {
    if (rect.isPinned !== source.isPinned) return
    const distance = Math.hypot(centerX - rect.left - rect.width / 2, centerY - rect.top - rect.height / 2)
    if (distance < nearestDistance) {
      nearestDistance = distance
      targetIndex = index
    }
  })

  const order = rects.map(rect => rect.id)
  order.splice(sourceIndex, 1)
  order.splice(targetIndex, 0, sourceId)
  const slots = new Map(order.map((id, index) => [id, rects[index]]))
  const offsets = {}
  rects.forEach(rect => {
    const slot = slots.get(rect.id)
    offsets[rect.id] = rect.id === sourceId
      ? { x: deltaX, y: deltaY }
      : { x: slot.left - rect.left, y: slot.top - rect.top }
  })
  const target = rects[targetIndex]
  return {
    targetIndex,
    offsets,
    dropOffset: { x: target.left - source.left, y: target.top - source.top },
  }
}
