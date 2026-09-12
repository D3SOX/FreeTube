import { inject, onBeforeUnmount } from 'vue'

import store from '../store/index'
import { getTabNavigationService } from './TabNavigationService'
import { removeLegacyTabAvatar } from '../helpers/channelThumbnailStorage'
import { fetchTabAvatarBytes } from '../helpers/tabAvatar'

export const tabIdKey = Symbol('logical-tab-id')
export const tabPresentedKey = Symbol('logical-tab-presented')
export const tabLifecycleKey = Symbol('logical-tab-lifecycle')
export const watchNavigationKey = Symbol('watch-navigation')

export function useTabContext() {
  return {
    tabId: inject(tabIdKey, null),
    isTabPresented: inject(tabPresentedKey, null),
    lifecycle: inject(tabLifecycleKey, null)
  }
}

export function useTabTitle() {
  const { tabId } = useTabContext()
  const watchNavigation = inject(watchNavigationKey, null)
  let isMounted = true

  onBeforeUnmount(() => {
    isMounted = false
  })

  return (title, options) => {
    if (!isMounted) {
      return
    }
    if (watchNavigation?.detached.value) {
      watchNavigation.setTitle(title, options)
      return
    }

    const targetTabId = process.env.IS_ELECTRON || process.env.IS_CAPACITOR
      ? tabId ?? store.getters.getActiveTabId
      : null

    if (targetTabId) {
      getTabNavigationService().setTitle(targetTabId, title, options)
    } else {
      store.commit('setAppTitle', title)
    }
  }
}

export function useTabAvatar() {
  const { tabId } = useTabContext()
  const watchNavigation = inject(watchNavigationKey, null)
  let isMounted = true

  onBeforeUnmount(() => {
    isMounted = false
  })

  return async (avatarUrl) => {
    if (!isMounted || watchNavigation?.detached.value || !process.env.IS_ELECTRON || !tabId || !store.getters.getShowTabIcons) return

    try {
      const route = store.getters.getTabById(tabId)?.route
      const avatarBytes = await fetchTabAvatarBytes(avatarUrl)
      if (!isMounted || watchNavigation?.detached.value || avatarBytes == null || route?.path == null) return

      const cached = await window.ftElectron.tabs.updateAvatar(avatarBytes, tabId, route.path)
      if (cached) {
        removeLegacyTabAvatar(route)
      }
    } catch (error) {
      console.error('Failed to cache tab avatar:', error)
    }
  }
}

export function useTabLifecycle(hooks) {
  const { tabId, lifecycle } = useTabContext()
  if (!tabId || !lifecycle) {
    return () => {}
  }

  const unregister = lifecycle.register(tabId, hooks)
  onBeforeUnmount(unregister)
  return unregister
}
