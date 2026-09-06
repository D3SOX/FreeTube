export const DEVICE_LOCAL_SETTING_KEYS = new Set([
  'autoPictureInPictureTriggers',
  'autoUpdateChannelVolumes',
  'channelVolumes',
  'continuePlaybackWhenScreenIsLocked',
  'defaultVolume',
  'displayVideoPlayButton',
  'enableClosedAppSubscriptionRefresh',
  'enableMobileFullscreenSwipe',
  'rememberTabNavigationHistory',
  'rememberVolume',
  'rememberVolumePerChannel',
  'rotateFullscreenToLandscape',
  'scrollMiniPlayerOnAllTabs',
  'showProgressBarToast',
  'showTabPreviews',
  'tabBarPosition',
  'ytDlpDownloadFolderPath',
  'ytDlpPlaybackCookiesPath',
  'videoVolumeMouseScroll',
])

/**
 * Settings with platform-specific behavior must stay local to each device
 * instead of overwriting preferences on other devices during settings sync.
 *
 * @param {string} settingKey
 * @returns {boolean}
 */
export function isSettingSyncableOnPlatform(settingKey) {
  return !DEVICE_LOCAL_SETTING_KEYS.has(settingKey)
}
