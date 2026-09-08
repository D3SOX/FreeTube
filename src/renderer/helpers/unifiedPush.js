import { registerPlugin } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'

const plugin = registerPlugin('UnifiedPush')

export const unifiedPush = {
  getState: () => plugin.getState(),
  getSubscription: () => plugin.getSubscription(),
  copySubscription: () => plugin.copySubscription(),
  unregister: () => plugin.unregister(),
  addStateListener: listener => plugin.addListener('stateChanged', listener),
  async register(options) {
    let permission = await LocalNotifications.checkPermissions()
    if (permission.display === 'prompt' || permission.display === 'prompt-with-rationale') {
      permission = await LocalNotifications.requestPermissions()
    }
    if (permission.display !== 'granted') {
      const error = new Error('Android notification permission is required')
      error.code = 'notifications-denied'
      throw error
    }
    return plugin.register(options)
  },
}
