/**
 * @param {Record<string, unknown>} getters
 * @param {boolean} [supported]
 * @param {boolean} [isCapacitor]
 */
export function hasConfiguredRestrictedPlaybackAuthentication(
  getters,
  supported = (process.env.IS_ELECTRON || process.env.IS_CAPACITOR),
  isCapacitor = Boolean(process.env.IS_CAPACITOR)
) {
  const cookiePath = getters.getYtDlpPlaybackCookiesPath
  const browser = getters.getYtDlpPlaybackCookiesBrowser
  const cookieFileConfigured = getters.getYtDlpPlaybackAuthMode === 'file' &&
    typeof cookiePath === 'string' && cookiePath.trim() !== ''
  const browserConfigured = !isCapacitor && getters.getYtDlpPlaybackAuthMode === 'browser' &&
    typeof browser === 'string' && browser.trim() !== ''

  return Boolean(supported && (cookieFileConfigured || browserConfigured))
}

/**
 * @param {boolean} isMembersOnly
 * @param {Record<string, unknown>} getters
 * @param {boolean} [isElectron]
 */
export function shouldHideMembersOnlyContent(isMembersOnly, getters, isElectron = (process.env.IS_ELECTRON || process.env.IS_CAPACITOR)) {
  return Boolean(isMembersOnly && !hasConfiguredRestrictedPlaybackAuthentication(getters, isElectron))
}
