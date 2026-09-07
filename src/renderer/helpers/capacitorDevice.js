import { Capacitor } from '@capacitor/core'
import { Device } from '@capacitor/device'
import { getAndroidDeviceArchitecture } from './androidUi.js'

export async function getCapacitorDeviceInfo() {
  const [info, { architecture }] = await Promise.all([
    Device.getInfo(),
    Capacitor.getPlatform() === 'android'
      ? getAndroidDeviceArchitecture()
      : { architecture: '' },
  ])

  return {
    name: info.name?.trim() || info.model,
    platform: info.platform,
    architecture,
    release: info.osVersion,
  }
}
