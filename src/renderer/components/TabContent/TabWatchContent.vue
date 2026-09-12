<template>
  <div
    v-show="isWatchRoute"
    :inert="!isWatchRoute"
    :aria-hidden="String(!isWatchRoute)"
  >
    <component
      :is="component"
      v-if="watchRoute"
      ref="watchView"
      class="routerView"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, provide, reactive, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { routeLocationKey, routerKey } from 'vue-router'
import store from '../../store/index'
import { resolveRouteComponent } from '../../router/index'
import { getTabNavigationService } from '../../tabs/TabNavigationService'
import { tabLifecycleService } from '../../tabs/TabLifecycleService'
import { tabLifecycleKey, tabPresentedKey, watchNavigationKey } from '../../tabs/TabContext'

const props = defineProps({
  tabId: { type: String, required: true },
  route: { type: Object, required: true },
  presented: Boolean
})

const navigation = getTabNavigationService()
const watchView = useTemplateRef('watchView')
// Freeze the watch route while browsing, so its route watchers do not reload
// or tear down the video when the tab moves to another page.
const watchRoute = shallowRef(null)
const retained = ref(false)
const isWatchRoute = computed(() => props.route.path.startsWith('/watch/'))
const presented = computed(() => props.presented && isWatchRoute.value)
const detached = computed(() => retained.value && !isWatchRoute.value)
const enabled = computed(() => store.getters.getKeepPlayingOnNavigation)
const component = computed(() => watchRoute.value && resolveRouteComponent(watchRoute.value))
const injectedRoute = reactive({})
const hooks = new Set()
let disposed = false
let watchTitle = ''
let watchTitleOptions
let disposalPromise = null

async function run(name, context) {
  for (const entry of [...hooks]) {
    try {
      await entry[name]?.(context)
    } catch (error) {
      console.error(`Watch lifecycle hook "${name}" failed:`, error)
    }
  }
}

function dispose(context) {
  if (disposed || !watchRoute.value) return disposalPromise
  disposed = true
  disposalPromise = run('beforeDispose', context)
  return disposalPromise
}

const unregister = tabLifecycleService.register(props.tabId, {
  async beforeNavigate(context) {
    await disposalPromise
    if (!isWatchRoute.value) return
    // Android teleports even the scrolling mini player outside this view.
    const player = watchView.value?.$refs.player
    retained.value = enabled.value && !context.to.path.startsWith('/watch/') &&
      player?.hasLoaded === true && !player.isPaused()
    if (retained.value) {
      const entry = store.getters.getTabById(props.tabId)?.history
        .findLast(entry => entry.route.fullPath === watchRoute.value.fullPath)
      watchTitle = entry?.title || ''
      watchTitleOptions = { resolveHistoryEntry: entry?.titlePending !== true }
      await run('deactivate', context)
    } else {
      await dispose(context)
    }
  },
  async afterNavigate(context) {
    if (isWatchRoute.value) {
      if (retained.value && watchTitle) navigation.setTitle(props.tabId, watchTitle, watchTitleOptions)
      retained.value = false
      await run('activate', context)
    }
  },
  activate: context => presented.value && run('activate', context),
  deactivate: context => run('deactivate', context),
  beforeReload: dispose,
  beforeDispose: dispose
})

provide(tabLifecycleKey, {
  register(_tabId, entry) {
    hooks.add(entry)
    return () => hooks.delete(entry)
  }
})
provide(tabPresentedKey, presented)
provide('isTabActive', presented)
provide(routeLocationKey, injectedRoute)
provide('tabRoute', injectedRoute)
const router = navigation.createRouterFacade(props.tabId)
const watchRouter = Object.create(router)
Object.defineProperty(watchRouter, 'currentRoute', { value: computed(() => watchRoute.value) })
provide(routerKey, watchRouter)
provide(watchNavigationKey, {
  detached,
  tabPresented: computed(() => props.presented),
  setTitle: (title, options) => {
    watchTitle = title
    watchTitleOptions = options
  },
  returnToVideo: () => navigation.push(props.tabId, watchRoute.value.fullPath)
})

watch(() => props.route, route => {
  if (route.path.startsWith('/watch/')) {
    if (watchRoute.value?.fullPath !== route.fullPath) watchTitle = ''
    disposed = false
    watchRoute.value = route
    for (const key of Object.keys(injectedRoute)) {
      if (!(key in route)) delete injectedRoute[key]
    }
    Object.assign(injectedRoute, route)
  } else if (!retained.value) {
    watchRoute.value = null
  }
}, { immediate: true })

watch(enabled, value => {
  if (!value && detached.value) {
    // Finish cleanup and unmount before a return can mount a fresh Watch.
    disposalPromise = dispose().then(async () => {
      retained.value = false
      watchRoute.value = null
      await nextTick()
    })
  }
}, { flush: 'sync' })

onBeforeUnmount(() => {
  unregister()
  dispose()
})
</script>
