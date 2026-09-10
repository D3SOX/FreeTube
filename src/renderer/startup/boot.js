// Inlined before the deferred renderer bundle, so the first paint needs no Vue
// initialization, locale fetch, or separate image request.
(() => {
  const appearance = window.ftElectron?.startupAppearance
  const root = document.documentElement
  if (appearance?.background) {
    root.style.setProperty('--startup-background', appearance.background)
    root.style.setProperty('--startup-foreground', appearance.dark ? '#eeeeee' : '#212121')
  }
  if (appearance?.hideSplash) {
    document.getElementById('startup-splash')?.remove()
    document.getElementById('app')?.removeAttribute('inert')
  }
  try {
    const label = localStorage.getItem('startup-loading-label')
    const element = document.querySelector('#startup-splash .startupLabel')
    if (label && element) element.textContent = label
  } catch {
    // A fresh profile or unavailable storage still has the logo and progress bar.
  }
  // Electron's ready-to-show can wait for deferred scripts. Announce the
  // splash's own frame so the native window need not wait for the main bundle.
  requestAnimationFrame(() => window.ftElectron?.startupSplashReady())
})()
