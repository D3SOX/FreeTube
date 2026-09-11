/** Keep phone dialogs within the viewport while the software keyboard opens. */
export function setupPhoneViewport(window, document, nativeResize = false) {
  function update() {
    // Android resizes the WebView itself. Its visual viewport can briefly
    // subtract the IME again while those two resize events catch up.
    const viewport = nativeResize ? null : window.visualViewport
    document.documentElement.style.setProperty('--phone-viewport-height', `${viewport?.height ?? window.innerHeight}px`)
    document.documentElement.style.setProperty('--phone-viewport-top', `${viewport?.offsetTop ?? 0}px`)
  }
  update()
  window.visualViewport?.addEventListener('resize', update)
  window.visualViewport?.addEventListener('scroll', update)
  window.addEventListener('resize', update)
  return () => {
    window.visualViewport?.removeEventListener('resize', update)
    window.visualViewport?.removeEventListener('scroll', update)
    window.removeEventListener('resize', update)
  }
}
