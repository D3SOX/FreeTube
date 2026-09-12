/** Rasterize only the shared controls; WebView.draw flattens page transparency. */
export function createMiniControlsSnapshot(onChange, onError) {
  let previousRoot = null
  let previousSize = ''
  let previousSvg = ''
  let dirty = true
  let refreshFrozen = false
  let destroyed = false
  let sequence = 0
  let image = null
  let pending = false

  return {
    invalidate(duringScroll = false) { dirty = true; refreshFrozen ||= duringScroll },
    destroy() { destroyed = true; sequence++; previousRoot = null },
    update(root, width, height, frozen) {
      if (destroyed) return
      if (!root || width <= 0 || height <= 0) {
        if (previousRoot) {
          sequence++
          previousRoot = null
          previousSvg = ''
          image = null
          pending = false
          onChange(null)
        }
        return
      }
      if (frozen && !refreshFrozen && (image || pending)) return
      const scale = Math.min(window.devicePixelRatio || 1, 3, 1024 / width, 1024 / height)
      const size = `${width},${height},${scale}`
      if (!dirty && root === previousRoot && size === previousSize) return
      // Native transitions temporarily hide the shared controls. Do not cache
      // that empty frame: the first visible frame may arrive during a scroll.
      const rootStyle = getComputedStyle(root)
      if (rootStyle.visibility === 'hidden' || rootStyle.display === 'none' ||
        Number(rootStyle.opacity) === 0 || root.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) === false) return
      dirty = false
      refreshFrozen = false
      previousRoot = root
      previousSize = size
      const clone = cloneStyled(root)
      clone.querySelector('.scrollMiniPointerLayer')?.remove()
      Object.assign(clone.style, {
        position: 'relative',
        inset: 'auto',
        transform: 'none',
        width: `${width}px`,
        height: `${height}px`,
        margin: '0'
      })
      const content = new XMLSerializer().serializeToString(clone)
      const pixelWidth = Math.ceil(width * scale)
      const pixelHeight = Math.ceil(height * scale)
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pixelWidth}" height="${pixelHeight}" viewBox="0 0 ${width} ${height}"><foreignObject width="${width}" height="${height}">${content}</foreignObject></svg>`
      if (svg === previousSvg) return
      previousSvg = svg
      const current = ++sequence
      pending = true
      const source = new Image()
      source.onload = () => {
        if (current !== sequence) return
        pending = false
        try {
          const canvas = document.createElement('canvas')
          canvas.width = pixelWidth
          canvas.height = pixelHeight
          canvas.getContext('2d').drawImage(source, 0, 0)
          const next = canvas.toDataURL('image/png')
          if (next !== image) { image = next; onChange(image) }
        } catch (error) { onError(error) }
      }
      source.onerror = () => {
        if (current !== sequence) return
        pending = false
        previousSvg = ''
        onError(new Error('Could not render mini-player controls'))
      }
      // Data SVGs keep foreignObject canvas reads origin-clean in Chromium.
      source.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    }
  }
}

function copyStyle(source, target, pseudo) {
  const style = getComputedStyle(source, pseudo)
  for (const property of style) target.style.setProperty(property, style.getPropertyValue(property))
  target.style.setProperty('animation', 'none')
  target.style.setProperty('transition', 'none')
  return style
}

function cloneStyled(source) {
  const clone = source.cloneNode(false)
  copyStyle(source, clone)
  if (source instanceof HTMLInputElement) clone.setAttribute('value', source.value)
  for (const child of source.childNodes) {
    clone.append(child.nodeType === Node.ELEMENT_NODE ? cloneStyled(child) : child.cloneNode(true))
  }
  for (const pseudo of ['::before', '::after']) {
    const style = getComputedStyle(source, pseudo)
    if (style.content === 'none' || style.content === 'normal' || !style.content) continue
    const element = document.createElement('span')
    copyStyle(source, element, pseudo)
    // Mini controls use empty-content decorative handles.
    element.textContent = style.content.replaceAll(/^['"]|['"]$/g, '')
    if (pseudo === '::before') clone.prepend(element)
    else clone.append(element)
  }
  return clone
}
