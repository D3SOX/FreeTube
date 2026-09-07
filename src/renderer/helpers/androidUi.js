import { Capacitor, registerPlugin, SystemBarType, SystemBars } from '@capacitor/core'

const AndroidUi = process.env.IS_CAPACITOR ? registerPlugin('AndroidUi') : null
const ANDROID_PICTURE_IN_PICTURE_TARGET_ATTRIBUTE = 'data-android-picture-in-picture-target'

function videoDimensions(video) {
  return {
    width: video?.videoWidth || 16,
    height: video?.videoHeight || 9,
  }
}

function setAndroidPictureInPictureTarget(enabled, video) {
  const player = video?.closest?.('.ftVideoPlayer')
  if (enabled) {
    document.querySelectorAll(`[${ANDROID_PICTURE_IN_PICTURE_TARGET_ATTRIBUTE}]`)
      .forEach(element => element.removeAttribute(ANDROID_PICTURE_IN_PICTURE_TARGET_ATTRIBUTE))
    player?.setAttribute(ANDROID_PICTURE_IN_PICTURE_TARGET_ATTRIBUTE, '')
  } else {
    player?.removeAttribute(ANDROID_PICTURE_IN_PICTURE_TARGET_ATTRIBUTE)
  }
}

export function enterAndroidPictureInPicture(video) {
  setAndroidPictureInPictureTarget(true, video)
  setAndroidPictureInPictureDocumentState(true)
  const request = AndroidUi?.enterPictureInPicture(videoDimensions(video)) ?? Promise.resolve()
  return request.catch(error => {
    setAndroidPictureInPictureTarget(false, video)
    setAndroidPictureInPictureDocumentState(false)
    throw error
  })
}

export function setAndroidAutoPictureInPicture(enabled, video) {
  setAndroidPictureInPictureTarget(enabled, video)
  return AndroidUi?.setAutoPictureInPicture({
    enabled,
    ...videoDimensions(video),
  }) ?? Promise.resolve()
}

/**
 * @param {{active: boolean, fullscreen: boolean, controlsShown: boolean}} state
 * @returns {boolean}
 */
export function shouldShowAndroidStatusBar({ active, fullscreen, controlsShown }) {
  return !active || !fullscreen || controlsShown
}

export function setAndroidStatusBarVisible(visible) {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('SystemBars')) {
    return Promise.resolve()
  }

  return visible
    ? SystemBars.show({ bar: SystemBarType.StatusBar })
    : SystemBars.hide({ bar: SystemBarType.StatusBar })
}

export function exitAndroidApp() {
  return AndroidUi?.exitApp() ?? Promise.resolve()
}

export async function getAndroidHardwareKeyboardState() {
  const result = await (AndroidUi?.getHardwareKeyboardState() ?? Promise.resolve({ attached: false }))
  return result.attached === true
}

export function getAndroidDeviceArchitecture() {
  return AndroidUi?.getDeviceArchitecture() ?? Promise.resolve({ architecture: '' })
}

export function setAndroidPictureInPictureDocumentState(active) {
  document.body.classList.toggle('androidPictureInPicture', active)
}
