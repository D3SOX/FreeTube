import { supportsYtDlp } from '../helpers/ytDlpCapabilities'
import { defineAsyncComponent, h, markRaw, shallowRef } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import { getFixedInternalRouteTitle } from '../../internalRoutes'

// Loaded lazily to keep the startup bundle small, most notably the Watch view
// pulls in shaka-player and googlevideo.
// The tab system renders route components directly via `resolveRouteComponent`
// instead of `RouterView` resolving them during navigation, so they must be
// wrapped in `defineAsyncComponent` rather than passing the raw import function
// to `component`.
const AsyncRouteLoadingIndicator = {
  render: () => h('span', {
    hidden: true,
    'data-tab-loading-indicator': ''
  })
}
const routePreloaders = new WeakMap()

function createAsyncRoute(loader) {
  const component = defineAsyncComponent({
    loader,
    loadingComponent: AsyncRouteLoadingIndicator,
    delay: 0
  })
  routePreloaders.set(component, () => loader().then(() => undefined))
  return component
}

const Subscriptions = createAsyncRoute(() => import('../views/Subscriptions/Subscriptions.vue'))
const Home = createAsyncRoute(() => import('../views/Home/Home.vue'))
const SubscribedChannels = createAsyncRoute(() => import('../views/SubscribedChannels/SubscribedChannels.vue'))
const Trending = createAsyncRoute(() => import('../views/Trending/Trending.vue'))
const Popular = createAsyncRoute(() => import('../views/Popular/Popular.vue'))
const UserPlaylists = createAsyncRoute(() => import('../views/UserPlaylists/UserPlaylists.vue'))
const History = createAsyncRoute(() => import('../views/History/History.vue'))
const SearchPage = createAsyncRoute(() => import('../views/SearchPage/SearchPage.vue'))
const Playlist = createAsyncRoute(() => import('../views/Playlist/Playlist.vue'))
const Channel = createAsyncRoute(() => import('../views/Channel/Channel.vue'))
const Watch = createAsyncRoute(() => import('../views/Watch/Watch.vue'))
const Hashtag = createAsyncRoute(() => import('../views/Hashtag/Hashtag.vue'))
const Post = createAsyncRoute(() => import('../views/Post.vue'))

function createPreloadedRoute(name, loader) {
  const loadedComponent = shallowRef(defineAsyncComponent(loader))
  const preload = () => loader().then(({ default: component }) => {
    loadedComponent.value = markRaw(component)
  }).catch((error) => {
    console.error(`Failed to preload ${name}`, error)
  })
  const component = {
    name,
    setup: () => () => h(loadedComponent.value)
  }
  routePreloaders.set(component, preload)

  return {
    component,
    preload,
  }
}

const settingsWindowRoute = createPreloadedRoute('SettingsWindowRoute', () => import('../views/Settings/Settings.vue'))
const aboutRoute = createPreloadedRoute('AboutRoute', () => import('../views/About/About.vue'))
const SettingsRoute = createAsyncRoute(() => import('../views/Settings/SettingsRoute.vue'))
const About = aboutRoute.component
const Stats = createAsyncRoute(() => import('../views/Stats/Stats.vue'))

// Keep Settings in its own chunk so its styles retain their established load
// order. The app schedules these utility chunks once the first usable frame has
// rendered, avoiding startup contention without leaving the first navigation
// to pay their full parse cost.
export function preloadUtilityRoutes() {
  return Promise.all([settingsWindowRoute.preload(), aboutRoute.preload()])
}

export const routes = [
  {
    path: '/home',
    name: 'home',
    meta: {
      title: getFixedInternalRouteTitle('/home'),
      hasResizableThumbnails: true
    },
    component: Home
  },
  {
    path: '/',
    name: 'default',
    meta: {
      title: 'Subscriptions',
      hasResizableThumbnails: true
    },
    component: Subscriptions
  },
  {
    path: '/subscriptions',
    name: 'subscriptions',
    meta: {
      title: getFixedInternalRouteTitle('/subscriptions'),
      hasResizableThumbnails: true
    },
    component: Subscriptions
  },
  {
    path: '/subscribedchannels',
    name: 'subscribedChannels',
    meta: {
      title: getFixedInternalRouteTitle('/subscribedchannels')
    },
    component: SubscribedChannels
  },
  ...(process.env.SUPPORTS_LOCAL_API
    ? [{
        path: '/trending',
        name: 'trending',
        meta: {
          title: getFixedInternalRouteTitle('/trending'),
          hasResizableThumbnails: true
        },
        component: Trending
      }]
    : []),
  {
    path: '/popular',
    name: 'popular',
    meta: {
      title: getFixedInternalRouteTitle('/popular'),
      hasResizableThumbnails: true
    },
    component: Popular
  },
  {
    path: '/userplaylists',
    name: 'userPlaylists',
    meta: {
      title: getFixedInternalRouteTitle('/userplaylists'),
      hasResizableThumbnails: true
    },
    component: UserPlaylists
  },
  {
    path: '/history',
    name: 'history',
    meta: {
      title: getFixedInternalRouteTitle('/history'),
      hasResizableThumbnails: true
    },
    component: History
  },
  ...(supportsYtDlp
    ? [{
        path: '/downloads',
        name: 'downloads',
        meta: {
          title: getFixedInternalRouteTitle('/downloads')
        },
        component: SettingsRoute
      }]
    : []),
  {
    path: '/stats',
    name: 'stats',
    meta: {
      title: getFixedInternalRouteTitle('/stats')
    },
    component: Stats
  },
  {
    path: '/settings',
    name: 'settings',
    meta: {
      title: getFixedInternalRouteTitle('/settings')
    },
    component: SettingsRoute
  },
  {
    path: '/about',
    name: 'about',
    meta: {
      title: getFixedInternalRouteTitle('/about')
    },
    component: About
  },
  {
    path: '/settings/profile',
    name: 'profileSettings',
    meta: {
      title: getFixedInternalRouteTitle('/settings/profile')
    },
    component: SettingsRoute
  },
  {
    path: '/search/:query',
    meta: {
      title: 'Search Results',
      hasResizableThumbnails: true
    },
    component: SearchPage
  },
  {
    path: '/playlist/:id',
    meta: {
      title: 'Playlist',
      hasDynamicTitle: true,
      hasResizableThumbnails: true
    },
    component: Playlist
  },
  {
    path: '/channel/:id/:currentTab?',
    meta: {
      title: 'Channel',
      hasResizableThumbnails: true
    },
    component: Channel
  },
  {
    path: '/watch/:id',
    meta: {
      title: 'Watch',
      hasDynamicTitle: true
    },
    component: Watch
  },
  {
    path: '/hashtag/:hashtag',
    meta: {
      title: 'Hashtag',
      hasResizableThumbnails: true
    },
    component: Hashtag
  },
  {
    path: '/post/:id',
    meta: {
      title: 'Post',
    },
    component: Post
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    // Logical tabs restore their own viewport after presenting the target.
    // A delayed router reset would move a restored floating player back inline.
    if (process.env.IS_ELECTRON || process.env.IS_CAPACITOR) {
      return false
    }

    return new Promise((resolve) => {
      setTimeout(() => {
        if (savedPosition !== null) {
          resolve(savedPosition)
        } else {
          resolve({ left: 0, top: 0 })
        }
      }, 500)
    })
  }
})

export function resolveRouteComponent(resolvedRoute) {
  return resolvedRoute.matched.at(-1)?.components?.default ?? null
}

export function preloadResolvedRoute(resolvedRoute) {
  const component = resolveRouteComponent(resolvedRoute)
  return routePreloaders.get(component)?.() ?? Promise.resolve()
}

export default router
