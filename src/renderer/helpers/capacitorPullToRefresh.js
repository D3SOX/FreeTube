import { Capacitor, registerPlugin } from '@capacitor/core'
import { nextTick } from 'vue'
import store from '../store/index'
import { getCapacitorTabService } from '../tabs/CapacitorTabService'
import { tabLifecycleService } from '../tabs/TabLifecycleService'
import { tabRuntimeRegistry } from '../tabs/TabRuntimeRegistry'

const PullToRefresh = registerPlugin('PullToRefresh')
const EXCLUDED_TARGETS = 'button, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="dialog"], [role="menu"], video, audio, .shaka-video-container'
const EXCLUDED_ROUTES = new Set(['settings', 'profileSettings', 'about', 'stats', 'downloads'])

export function canPullToRefreshTarget(target, root, pageScrollY) {
  if (!target || !root?.contains(target) || root.closest('[inert]') || pageScrollY > 1 || target.closest(EXCLUDED_TARGETS)) {
    return false
  }

  // Nested scrollers own their gestures even when they happen to be at the top.
  // Check ancestors beyond the tab root too, in case a page acquires a wrapper.
  for (let element = target; element && element !== document.body; element = element.parentElement) {
    const style = getComputedStyle(element)
    if (/(auto|scroll)/.test(`${style.overflowX} ${style.overflowY}`) &&
      (element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1)) {
      return false
    }
  }
  return true
}

export function isPullToRefreshContextCurrent(context, tab) {
  return Boolean(tab && context.tabId === tab.id &&
    context.fullPath === tab.route.fullPath && context.refreshKey === tab.refreshKey)
}

export async function initializeCapacitorPullToRefresh() {
  if (!Capacitor.isPluginAvailable('PullToRefresh')) return () => {}

  let disposed = false
  let refreshing = false
  const currentTab = () => store.getters.getTabById(store.getters.getPresentedTabId)
  const blocked = () => disposed || document.hidden || document.fullscreenElement ||
    !store.getters.getEnablePullToRefresh ||
    store.getters.isAnyPromptOpen || store.getters.getSettingsWindowOpen || store.getters.getIsSideNavOpen

  window.__opentubexPullToRefresh = (x, y) => {
    const tab = currentTab()
    if (blocked() || refreshing || !tab || tab.isLoading || EXCLUDED_ROUTES.has(tab.route.name)) return null
    const root = tabRuntimeRegistry.getRoot(tab.id)
    const target = document.elementFromPoint(x * window.innerWidth, y * window.innerHeight)
    if (!canPullToRefreshTarget(target, root, window.scrollY)) return null
    const style = getComputedStyle(root)
    return {
      tabId: tab.id,
      fullPath: tab.route.fullPath,
      refreshKey: tab.refreshKey,
      offset: Math.max(0, root.getBoundingClientRect().top) / window.innerHeight,
      color: style.getPropertyValue('--primary-color').trim(),
      backgroundColor: style.getPropertyValue('--card-bg-color').trim()
    }
  }

  const listener = await PullToRefresh.addListener('refresh', async context => {
    if (refreshing) return
    refreshing = true
    try {
      if (blocked() || !isPullToRefreshContextCurrent(context, currentTab())) return
      const subscriptionFeedRefreshing = () => ['default', 'subscriptions'].includes(currentTab()?.route.name) &&
        store.getters.getSubscriptionFeedRefreshInProgress
      const request = { handled: false }
      await tabLifecycleService.run(context.tabId, 'pullToRefresh', request)
      if (!request.handled) {
        await getCapacitorTabService().reloadTab(context.tabId)
      }
      await nextTick()
      // Wait through the tab loader's 100ms settling period and then for loading
      // to complete. Feed refreshes can outlive the route's own loading indicator.
      const deadline = Date.now() + 55000
      do {
        await new Promise(resolve => setTimeout(resolve, 150))
        if (blocked() || currentTab()?.id !== context.tabId || currentTab()?.route.fullPath !== context.fullPath) break
      } while (Date.now() < deadline && (currentTab()?.isLoading ||
        tabRuntimeRegistry.getRoot(context.tabId)?.querySelector('[data-tab-loading-indicator]') ||
        subscriptionFeedRefreshing()))
    } catch (error) {
      console.error('Failed to refresh the current page', error)
    } finally {
      refreshing = false
      await PullToRefresh.finish().catch(error => console.error('Failed to finish pull to refresh', error))
    }
  }).catch(error => {
    delete window.__opentubexPullToRefresh
    throw error
  })

  const stopWatching = store.watch(
    (_, getters) => getters.getEnablePullToRefresh,
    enabled => {
      PullToRefresh.setEnabled({ enabled })
        .catch(error => console.error('Failed to update pull to refresh', error))
    },
    { flush: 'sync' }
  )

  try {
    await PullToRefresh.setEnabled({ enabled: store.getters.getEnablePullToRefresh })
  } catch (error) {
    stopWatching()
    delete window.__opentubexPullToRefresh
    await listener.remove()
    throw error
  }

  return () => {
    disposed = true
    stopWatching()
    delete window.__opentubexPullToRefresh
    Promise.all([listener.remove(), PullToRefresh.setEnabled({ enabled: false })])
      .catch(error => console.error('Failed to disable pull to refresh', error))
  }
}
