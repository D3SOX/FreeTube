<template>
  <div
    v-show="isPresented"
    ref="tabContentRef"
    class="tabContent"
    :data-tab-id="tab.id"
    :inert="!isPresented"
    :aria-hidden="String(!isPresented)"
  >
    <TabWatchContent
      v-if="initialized"
      :key="tab.refreshKey || 0"
      :tab-id="tab.id"
      :route="resolvedRoute"
      :presented="isPresented"
    />
    <KeepAlive
      include="AboutRoute"
      :max="1"
    >
      <component
        :is="resolvedComponent"
        v-if="initialized && resolvedComponent && !resolvedRoute.path.startsWith('/watch/')"
        :key="resolvedComponentKey"
        class="routerView"
      />
    </KeepAlive>
  </div>
</template>

<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onErrorCaptured,
  onMounted,
  provide,
  reactive,
  ref,
  useTemplateRef,
  watch
} from 'vue'
import { routeLocationKey, routerKey } from 'vue-router'
import TabWatchContent from './TabWatchContent.vue'

import store from '../../store/index'
import { resolveRouteComponent } from '../../router/index'
import { getTabNavigationService } from '../../tabs/TabNavigationService'
import { getCapacitorTabService } from '../../tabs/CapacitorTabService'
import { tabLifecycleService } from '../../tabs/TabLifecycleService'
import { tabRuntimeRegistry } from '../../tabs/TabRuntimeRegistry'
import { tabIdKey, tabLifecycleKey, tabPresentedKey } from '../../tabs/TabContext'

const TAB_LOADER_SELECTOR = '[data-tab-loading-indicator]'
const TAB_LOADER_LOADING_SOURCE = 'loader'
const TAB_LOADER_SETTLE_DELAY_MS = 100
const CACHED_ROUTE_NAMES = new Set(['about'])

const props = defineProps({
  tab: {
    type: Object,
    required: true
  }
})

const navigation = getTabNavigationService()
const tabContentRef = useTemplateRef('tabContentRef')
const isPresented = computed(() => store.getters.getPresentedTabId === props.tab.id)
const shouldMount = computed(() => !props.tab.mountDeferred && props.tab.loadState !== 'unloaded' && props.tab.loadState !== 'unloading')
const initialized = ref(shouldMount.value)
const routerFacade = navigation.createRouterFacade(props.tab.id)
// Main metadata snapshots replace the containing tab object frequently (title,
// loading, preview, playback, etc.). Resolve from the serialized fullPath so a
// metadata-only update does not manufacture a new route object and retrigger
// every deep route watcher in the mounted page.
const routeFullPath = computed(() => props.tab.route?.fullPath || '/')
const resolvedRoute = computed(() => navigation.resolve(routeFullPath.value))
const resolvedComponentKey = computed(() => {
  const refreshKey = props.tab.refreshKey || 0
  return CACHED_ROUTE_NAMES.has(resolvedRoute.value.name)
    ? `${resolvedRoute.value.name}:${refreshKey}`
    : refreshKey
})
const injectedRoute = reactive({})
const resolvedComponent = computed(() => resolveRouteComponent(resolvedRoute.value))

provide(tabIdKey, props.tab.id)
provide(tabPresentedKey, isPresented)
provide(tabLifecycleKey, tabLifecycleService)
provide('tabId', props.tab.id)
provide('isTabActive', isPresented)
provide('tabRoute', injectedRoute)
provide(routeLocationKey, injectedRoute)
provide(routerKey, routerFacade)

watch(resolvedRoute, (route) => {
  for (const key of Object.keys(injectedRoute)) {
    if (!(key in route)) {
      delete injectedRoute[key]
    }
  }
  Object.assign(injectedRoute, route)
}, { immediate: true })

let removeRootRegistration = null
let loaderObserver = null
let loaderAnimationFrameId = null
let loaderSettleTimeoutId = null
let acknowledgedMountRevision = 0
let previousRefreshKey = props.tab.refreshKey ?? 0
let lifecycleRevision = 0
// Guards against notifying `beforeDispose` twice for the same mounted instance:
// the unload watcher and onBeforeUnmount can both fire for one instance. Reset
// when the tab mounts again so a subsequent mount receives one notification.
let disposalNotified = false
let pictureInPictureExitRequested = false

async function disposeMountedContent() {
  const pictureInPictureElement = document.pictureInPictureElement
  let exitPictureInPicture = Promise.resolve()
  if (
    !pictureInPictureExitRequested &&
    pictureInPictureElement &&
    tabContentRef.value?.contains(pictureInPictureElement)
  ) {
    pictureInPictureExitRequested = true
    try {
      exitPictureInPicture = document.exitPictureInPicture().catch(error => {
        console.error(`Failed to exit Picture-in-Picture for logical tab ${props.tab.id}:`, error)
      }).finally(() => {
        pictureInPictureExitRequested = false
      })
    } catch (error) {
      pictureInPictureExitRequested = false
      console.error(`Failed to exit Picture-in-Picture for logical tab ${props.tab.id}:`, error)
    }
  }

  const notifyBeforeDispose = disposalNotified
    ? Promise.resolve()
    : tabLifecycleService.run(props.tab.id, 'beforeDispose')

  disposalNotified = true
  await Promise.all([exitPictureInPicture, notifyBeforeDispose])
}

watch(
  () => [shouldMount.value, props.tab.mountRevision, props.tab.refreshKey],
  async ([mount, mountRevision, refreshKey]) => {
    const revision = ++lifecycleRevision
    if (!mount) {
      if (initialized.value && !disposalNotified) {
        await disposeMountedContent()
        if (revision !== lifecycleRevision || shouldMount.value) return
        initialized.value = false
      }
      navigation.setLoadingSource(props.tab.id, TAB_LOADER_LOADING_SOURCE, false)
      return
    }

    if (refreshKey !== previousRefreshKey) {
      await tabLifecycleService.run(props.tab.id, 'beforeReload')
      if (revision !== lifecycleRevision) return
      previousRefreshKey = refreshKey
      initialized.value = false
      await nextTick()
      if (revision !== lifecycleRevision) return
      store.commit('applyPendingReloadRoute', props.tab.id)
    }

    if (!shouldMount.value || mountRevision !== props.tab.mountRevision || refreshKey !== props.tab.refreshKey) {
      return
    }

    initialized.value = true
    disposalNotified = false
    pictureInPictureExitRequested = false
    await nextTick()
    updateLoaderState()
    if (mountRevision > acknowledgedMountRevision) {
      acknowledgedMountRevision = mountRevision
      tabRuntimeRegistry.markMounted(props.tab.id, mountRevision)
      window.ftElectron?.tabs?.mountReady?.(props.tab.id, mountRevision)
      if (process.env.IS_CAPACITOR) {
        getCapacitorTabService().markTabMounted(props.tab.id, mountRevision)
      }
      // Mount readiness can race the initial active-tab watcher. Retry now that
      // the runtime is guaranteed to exist so the tab cannot remain hidden.
      if (
        store.getters.getActiveTabId === props.tab.id &&
        store.getters.getPresentedTabId !== props.tab.id
      ) {
        navigation.requestPresentation(props.tab.id, store.state.tabs.selectionRevision)
      }
    }
    scheduleLoaderUpdate()
  },
  { immediate: true }
)

onMounted(() => {
  if (tabContentRef.value) {
    removeRootRegistration = tabRuntimeRegistry.registerRoot(props.tab.id, tabContentRef.value)
  }

  if (typeof MutationObserver === 'function' && tabContentRef.value) {
    loaderObserver = new MutationObserver(scheduleLoaderUpdate)
    loaderObserver.observe(tabContentRef.value, {
      attributes: true,
      attributeFilter: ['data-tab-loading-indicator'],
      childList: true,
      subtree: true
    })
  }
  scheduleLoaderUpdate()
})

onErrorCaptured((error) => {
  console.error(`Logical tab ${props.tab.id} failed to render:`, error)
  const mountRevision = props.tab.mountRevision
  // Only treat this as a mount failure while the current mount revision has not
  // yet been acknowledged as mounted. A later descendant render error on an
  // already-mounted tab is logged but must not flip the tab back to failed.
  if (mountRevision > acknowledgedMountRevision) {
    tabRuntimeRegistry.markMountFailed(props.tab.id, mountRevision)
    window.ftElectron?.tabs?.mountFailed?.(props.tab.id, mountRevision)
    if (process.env.IS_CAPACITOR) {
      getCapacitorTabService().markTabMountFailed(props.tab.id, mountRevision)
    }
  }
  // Return undefined (not false) so the error still propagates to the app-level
  // errorHandler in main.js after our IPC notification, preserving observability.
})

onBeforeUnmount(() => {
  lifecycleRevision += 1
  disposeMountedContent().catch(error => {
    console.error(`Failed to dispose logical tab ${props.tab.id}:`, error)
  })
  loaderObserver?.disconnect()
  loaderObserver = null
  if (loaderAnimationFrameId != null) {
    window.cancelAnimationFrame(loaderAnimationFrameId)
    loaderAnimationFrameId = null
  }
  cancelLoaderSettle()
  removeRootRegistration?.()
  navigation.disposeTab(props.tab.id)
})

function scheduleLoaderUpdate() {
  if (loaderAnimationFrameId != null) {
    return
  }

  loaderAnimationFrameId = window.requestAnimationFrame(() => {
    loaderAnimationFrameId = null
    updateLoaderState()
  })
}

function updateLoaderState() {
  if (tabContentRef.value?.querySelector(TAB_LOADER_SELECTOR) != null) {
    cancelLoaderSettle()
    navigation.setLoadingSource(props.tab.id, TAB_LOADER_LOADING_SOURCE, true)
    return
  }

  // Async route placeholders and the mounted view can hand loading indicators
  // off across adjacent renders. Require a short indicator-free quiet period
  // before clearing this source so the tab bar cannot flash cached metadata.
  if (loaderSettleTimeoutId == null) {
    loaderSettleTimeoutId = window.setTimeout(settleLoaderState, TAB_LOADER_SETTLE_DELAY_MS)
  }
}

function settleLoaderState() {
  loaderSettleTimeoutId = null
  if (tabContentRef.value?.querySelector(TAB_LOADER_SELECTOR) != null) {
    navigation.setLoadingSource(props.tab.id, TAB_LOADER_LOADING_SOURCE, true)
    return
  }

  navigation.setLoadingSource(props.tab.id, TAB_LOADER_LOADING_SOURCE, false)
}

function cancelLoaderSettle() {
  if (loaderSettleTimeoutId != null) {
    window.clearTimeout(loaderSettleTimeoutId)
    loaderSettleTimeoutId = null
  }
}
</script>

<style scoped>
.tabContent {
  min-inline-size: 0;
  inline-size: 100%;
}
</style>
