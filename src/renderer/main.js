import { ytDlp } from './helpers/ytDlp'
import { supportsYtDlp } from './helpers/ytDlpCapabilities'
import { createApp } from 'vue'
import { installNetworkFetch } from './helpers/networkRecovery'
import i18n from './i18n/index'
import router from './router/index'
import store from './store/index'
import App from './App.vue'
import { initializeTabNavigationService } from './tabs/TabNavigationService'
import { showExternalPlayerUnsupportedActionToast, showToast } from './helpers/utils'
import { installViewTransitions } from './helpers/viewTransitions'
import { initializeAppScrollbars, overlayScrollbarsDirective } from './helpers/overlayScrollbars'
import { releaseAutomaticDownloadSchedule } from './helpers/automaticDownloads'
// import the styles
import 'overlayscrollbars/styles/overlayscrollbars.css'
// Only the positioning and stacking rules are used, FtToast supplies the design
import 'vue-sonner/style.css'

import { ObserveVisibility } from 'vue-observe-visibility'

import { FtIcon, FtIconLayers } from './icons/iconComponents'

installNetworkFetch({
  checkInternet: true,
  // Load the persisted privacy choice before sending the first probe.
  internetChecksEnabled: false,
  corsDisabled: process.env.IS_ELECTRON
})

const app = createApp(App)

app.config.performance = process.env.NODE_ENV === 'development'

app
  .component('FtIcon', FtIcon)
  .component('FtIconLayers', FtIconLayers)
  .directive('observe-visibility', ObserveVisibility)
  .directive('overlay-scrollbars', overlayScrollbarsDirective)

  .use(router)
  .use(store)
  .use(i18n)

installViewTransitions(router)

const tabNavigation = initializeTabNavigationService(router, store)

router.isReady().then(() => {
  app.mount('#app')
  initializeAppScrollbars({ useNativePageScrollbar: process.env.IS_CAPACITOR })
})

// to avoid accessing electron api from web app build
if (process.env.IS_ELECTRON) {
  window.ftElectron.handleChangeView((route, tabId, toggle) => {
    if (typeof route === 'string' && (route === '/downloads' || route === '/settings' || route.startsWith('/settings/profile'))) {
      const view = route === '/downloads'
        ? 'downloads'
        : route.startsWith('/settings/profile') ? 'profile' : null
      const settingsWindowOpen = store.getters.getSettingsWindowOpen &&
        !['about', 'downloads'].includes(store.getters.getSettingsWindowView)
      if (toggle && route === '/settings' && settingsWindowOpen) {
        store.dispatch('hideSettingsWindow')
      } else {
        store.dispatch('showSettingsWindow', view)
      }
      return
    }
    const targetTabId = tabId ?? store.getters.getActiveTabId
    if (route && targetTabId) {
      tabNavigation.push(targetTabId, route)
    }
  })

  window.ftElectron.tabs.onGoHistory(({ tabId, offset }) => {
    tabNavigation.go(tabId, offset)
  })

  window.ftElectron.handleOpenInExternalPlayerResult(
    (externalPlayer, unsupportedActions, isPlaylist) => {
      for (const action of unsupportedActions) {
        showExternalPlayerUnsupportedActionToast(externalPlayer, action)
      }

      const videoOrPlaylist = isPlaylist
        ? i18n.global.t('Video.External Player.playlist')
        : i18n.global.t('Video.External Player.video')

      showToast({
        message: i18n.global.t('Video.External Player.OpeningTemplate', { videoOrPlaylist, externalPlayer }),
        icon: ['fas', 'external-link-alt'],
      })
    }
  )
}

if (supportsYtDlp) {
  const removedDownloadIds = new Set()

  ytDlp.handleYtDlpDownloadStatus((download) => {
    store.commit('upsertYtDlpDownload', download)
    releaseAutomaticDownloadSchedule(download)

    if (download.status === 'completed' && download.automatic !== true) {
      showToast({
        message: i18n.global.t('Downloads.Download Complete Template', { title: download.title }),
        icon: ['fas', 'download'],
      })
    } else if (download.status === 'failed' && download.automatic !== true) {
      showToast({
        message: download.errorMessage === 'ENOENT'
          ? i18n.global.t('Downloads.yt-dlp Not Found')
          : i18n.global.t('Downloads.Download Failed Template', { title: download.title }),
        icon: ['fas', 'circle-exclamation'],
      })
    }
  })

  ytDlp.handleYtDlpDownloadsRemoved((ids) => {
    for (const id of ids) {
      removedDownloadIds.add(id)
      store.commit('removeYtDlpDownload', id)
    }
  })

  ytDlp.ytDlpListDownloads().then(downloads => {
    for (const download of downloads) {
      if (!removedDownloadIds.has(download.id)) store.commit('upsertYtDlpDownload', download)
    }
  }).catch(error => console.warn('Could not load download history', error))
}
