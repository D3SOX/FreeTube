import shaka from 'shaka-player'
import { PHONE_LAYOUT_QUERY } from '../../composables/usePhoneLayout'
import { clampOverlayScrollTop, restoreOverlayScrollTop } from '../overlayScrollbars'

/** Keep Shaka's controls and selection state, presenting their menu over the video on phones without locking page scrolling. */
export function setupPhoneOptionsMenu(menu, controls, t) {
  const parent = menu.parentElement
  const dialog = document.createElement('dialog')
  dialog.className = 'phonePlayerOptions shaka-no-propagation'
  dialog.ariaLabel = t('Video.More Options')
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'phonePlayerOptionsClose'
  close.ariaLabel = t('Close')
  const closeIcon = new shaka.ui.Icon(close, shaka.ui.Enums.MaterialDesignSVGIcons.CLOSE)
  closeIcon.getSvgElement().setAttribute('aria-hidden', 'true')
  close.addEventListener('click', dismiss)
  dialog.append(close)
  parent.append(dialog)
  const query = window.matchMedia(PHONE_LAYOUT_QUERY)
  let frame = null
  let activeView = null
  let previousFocus = null
  let headerButton = null
  let headerParent = null

  function restoreHeader() {
    if (headerButton && headerParent) headerParent.prepend(headerButton)
    headerButton = null
    headerParent = null
  }

  function visibleSubmenu() {
    return [...menu.querySelectorAll('.shaka-sub-menu:not(.shaka-hidden)')]
      .filter(element => element.getClientRects().length > 0).at(-1) ?? null
  }

  function dismiss() {
    controls.hideSettingsMenus()
    update()
  }

  function goBack() {
    const submenu = visibleSubmenu()
    const button = headerButton ?? submenu?.querySelector('.shaka-back-to-overflow-button')
    if (button) button.click()
    else dismiss()
  }

  function update() {
    frame = null
    const open = query.matches && !menu.classList.contains('shaka-hidden')
    if (open && !dialog.open) {
      previousFocus = document.activeElement
      dialog.append(menu)
      dialog.show()
      close.focus({ preventScroll: true })
    } else if (!open && dialog.open) {
      dialog.close()
      restoreHeader()
      parent.append(menu)
      activeView = null
      const trigger = parent.querySelector('.shaka-overflow-menu-button')
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
      else if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
    if (!open) return
    const submenu = visibleSubmenu()
    const view = submenu ?? menu
    if (view !== activeView) {
      restoreHeader()
      headerButton = submenu?.querySelector('.shaka-back-to-overflow-button') ?? null
      if (headerButton) {
        headerParent = headerButton.parentElement
        dialog.prepend(headerButton)
      }
      activeView = view
      restoreOverlayScrollTop(menu, 0)
    }
    const end = [...view.children].filter(child => child.getClientRects().length > 0 && !child.classList.contains('os-scrollbar')).at(-1)
    clampOverlayScrollTop(menu, end ?? view)
  }

  function schedule() {
    frame ??= requestAnimationFrame(update)
  }

  let outsidePointer = null
  function handleOutsidePointer(event) {
    dialog.toggleAttribute('data-touch-input', event.pointerType === 'touch')
    outsidePointer = dialog.open && !dialog.contains(event.target)
      ? { id: event.pointerId, x: event.clientX, y: event.clientY, scroll: window.scrollY }
      : null
  }
  function finishOutsidePointer(event) {
    const start = outsidePointer
    outsidePointer = null
    if (start?.id === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 8 && Math.abs(window.scrollY - start.scroll) < 2) dismiss()
  }
  function cancelOutsidePointer() { outsidePointer = null }
  document.addEventListener('pointerdown', handleOutsidePointer, true)
  document.addEventListener('pointerup', finishOutsidePointer, true)
  document.addEventListener('pointercancel', cancelOutsidePointer, true)
  dialog.addEventListener('click', event => {
    if (headerButton?.contains(event.target)) {
      event.preventDefault()
      event.stopPropagation()
      const button = headerButton
      // Shaka handles Back through the submenu's bubbling click listener.
      restoreHeader()
      queueMicrotask(() => {
        button.click()
        schedule()
      })
    }
  }, true)
  dialog.addEventListener('click', event => {
    if (event.target === dialog || event.target === menu) dismiss()
  })
  dialog.addEventListener('cancel', event => {
    event.preventDefault()
    goBack()
  })
  dialog.addEventListener('pointermove', event => {
    if (event.pointerType === 'mouse') dialog.removeAttribute('data-touch-input')
  })
  dialog.addEventListener('keydown', event => {
    dialog.removeAttribute('data-touch-input')
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      goBack()
    }
  })
  for (const type of ['click', 'dblclick', 'pointerdown', 'pointerup', 'touchstart', 'touchend']) {
    dialog.addEventListener(type, event => event.stopPropagation())
  }
  const observer = new MutationObserver(records => {
    if (records.some(record => !record.target.closest?.('.os-scrollbar') &&
      (record.type !== 'attributes' || record.oldValue !== record.target.getAttribute('class')))) schedule()
  })
  observer.observe(menu, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true, characterData: true })
  const resize = new ResizeObserver(schedule)
  resize.observe(menu)
  resize.observe(parent.closest('.ftVideoPlayer') ?? parent)
  query.addEventListener('change', schedule)
  window.addEventListener('resize', schedule)
  schedule()

  return () => {
    document.removeEventListener('pointerdown', handleOutsidePointer, true)
    document.removeEventListener('pointerup', finishOutsidePointer, true)
    document.removeEventListener('pointercancel', cancelOutsidePointer, true)
    observer.disconnect()
    resize.disconnect()
    cancelAnimationFrame(frame)
    query.removeEventListener('change', schedule)
    window.removeEventListener('resize', schedule)
    restoreHeader()
    if (dialog.contains(menu)) parent.append(menu)
    dialog.remove()
  }
}
