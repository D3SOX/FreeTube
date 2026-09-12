import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEVICE_LOCAL_SETTING_KEYS,
  isSettingSyncableOnPlatform,
} from '../../src/renderer/helpers/platformSettings.js'

test('platform-specific settings stay local to every device', () => {
  assert.deepEqual([...DEVICE_LOCAL_SETTING_KEYS], [
    'autoPictureInPictureTriggers',
    'autoUpdateChannelVolumes',
    'channelVolumes',
    'continuePlaybackWhenScreenIsLocked',
    'defaultVolume',
    'displayVideoPlayButton',
    'enableClosedAppSubscriptionRefresh',
    'enableMobileFullscreenSwipe',
    'enablePullToRefresh',
    'keepPlayingOnNavigation',
    'mobileFullscreenBrightness',
    'mobileLeftSwipeAction',
    'mobileRightSwipeAction',
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

  for (const settingKey of DEVICE_LOCAL_SETTING_KEYS) {
    assert.equal(isSettingSyncableOnPlatform(settingKey), false, settingKey)
  }
})

test('shared settings remain syncable on every platform', () => {
  assert.equal(isSettingSyncableOnPlatform('baseTheme'), true)
})
