<template>
  <div
    v-if="dataReady"
    class="app"
    :class="[{
      hideOutlines: outlinesHidden,
      isLocaleRightToLeft: isLocaleRightToLeft,
      isSideNavOpen: isSideNavOpen,
      hideLabelsSideBar: hideLabelsSideBar && !isSideNavOpen,
      capacitorTabs: isCapacitor,
      capacitorPhoneLayout: isCapacitor && !showTabletTabStrip,
      capacitorTabletLayout: showTabletTabStrip,
      verticalTabs: useVerticalTabBar,
      verticalTabsLeft: tabBarPosition === 'left',
      verticalTabsRight: tabBarPosition === 'right',
      bottomTabs: isElectron && tabBarPosition === 'bottom',
      topTabs: (isElectron && tabBarPosition === 'top') || showTabletTabStrip,
      watchSideNavOverlay: useWatchSideNavOverlay,
      watchSideNavTransitionDisabled
    }, `tabBar-${tabBarPosition}`]"
    :style="appStyle"
  >
    <TabBar
      :inert="isAnyPromptOpen"
    />
    <CapacitorTabletTabBar
      v-if="isCapacitor"
      :inert="isAnyPromptOpen"
      @request-exit="requestAndroidAppExit"
    />
    <TopNav
      :inert="isAnyPromptOpen"
      @request-android-exit="requestAndroidAppExit"
    />
    <SideNav
      :inert="isAnyPromptOpen"
      :force-expanded="useWatchSideNavOverlay"
    />
    <Transition name="fade">
      <button
        v-if="useWatchSideNavOverlay && isSideNavOpen"
        type="button"
        class="sideNavBackdrop"
        :aria-label="t('Close')"
        @click="closeSideNav"
      />
    </Transition>
    <!-- Fixed mini players must stay outside the route's query container. -->
    <div
      id="cross-tab-mini-player-layer"
      class="crossTabMiniPlayerLayer"
      :inert="isAnyPromptOpen"
    />
    <FtFlexBox
      class="flexBox routerView"
      role="main"
      :inert="isAnyPromptOpen"
    >
      <template v-if="usesLogicalTabs">
        <TabContent
          v-for="tab in tabContainers"
          :key="tab.id"
          :tab="tab"
        />
      </template>
      <RouterView
        v-else
        v-slot="{ Component }"
        class="routerView"
      >
        <Transition
          mode="out-in"
          name="fade"
        >
          <component :is="Component" />
        </Transition>
      </RouterView>
    </FtFlexBox>
    <Transition
      name="settings-window"
      :css="!settingsWindowMorphing"
      @after-leave="resetClosedSettingsWindowView"
    >
      <KeepAlive>
        <SettingsWindow
          v-if="settingsWindowOpen"
          :hardware-keyboard-attached="hardwareKeyboardAttached"
          :search-target="settingsSearchTarget"
          @search-target-opened="clearSettingsSearchTarget"
        />
      </KeepAlive>
    </Transition>
    <FtTutorialOverlay
      v-if="showTutorial"
      :new-installation="tutorialIsNewInstallation"
      @close="completeTutorial"
    />
    <FtCommandPalette
      v-if="commandPaletteOpen"
      :commands="commandPaletteCommands"
      :show-shortcuts="hardwareKeyboardAttached"
      @close="closeCommandPalette"
    />
    <TabOrganizer
      v-if="tabOrganizerOpen"
      @close="closeTabOrganizer"
    />
    <FtPrompt
      v-if="showReleaseNotes"
      theme="readable-width"
      @click="closeReleaseNotes"
    >
      <template #label="{ labelId }">
        <h1
          :id="labelId"
          class="changeLogTitle"
        >
          {{ changeLogTitle }}
        </h1>
      </template>
      <div
        v-safer-html.lenient="updateChangelog"
        v-overlay-scrollbars
        class="changeLogText"
        dir="ltr"
        lang="en"
      />
      <FtFlexBox>
        <FtButton
          :label="t('Download From Site')"
          :icon="['fas', 'download']"
          @click="openDownloadsPage"
        />
        <FtButton
          :label="t('Close')"
          :icon="['fas', 'xmark']"
          :text-color="null"
          :background-color="null"
          @click="closeReleaseNotes"
        />
      </FtFlexBox>
    </FtPrompt>
    <FtPrompt
      v-if="showExternalLinkOpeningPrompt"
      autosize
      :label="t('Are you sure you want to open this link?')"
      :extra-labels="[lastExternalLinkToBeOpened]"
      :option-names="externalLinkOpeningPromptNames"
      :option-values="EXTERNAL_LINK_OPENING_PROMPT_VALUES"
      @click="handleExternalLinkOpeningPromptAnswer"
    />
    <FtPrompt
      v-if="multipleTabsActionPrompt != null"
      autosize
      :label="multipleTabsActionPromptTitle"
      :extra-labels="[multipleTabsActionPromptMessage, t('Confirmations.Settings Hint')]"
      :option-names="multipleTabsActionPromptNames"
      :option-values="MULTIPLE_TABS_ACTION_PROMPT_VALUES"
      @click="handleMultipleTabsActionPromptAnswer"
    />
    <FtPrompt
      v-if="showAndroidExitPrompt"
      autosize
      is-first-option-destructive
      :label="t('Close Confirmation.Title')"
      :extra-labels="[t('Close Confirmation.Message')]"
      :option-names="androidExitPromptNames"
      :option-values="ANDROID_EXIT_PROMPT_VALUES"
      @click="handleAndroidExitPromptAnswer"
    />
    <FtSearchFilters
      v-if="showSearchFilters"
    />
    <FtPlaylistAddVideoPrompt
      v-if="showAddToPlaylistPrompt"
    />
    <FtCreatePlaylistPrompt
      v-if="showCreatePlaylistPrompt"
    />
    <FtContextMenu v-if="isElectron" />
    <Teleport to="body">
      <div
        v-if="mobileContextLink || mobileContextActions"
        class="mobileLinkActionsBackdrop"
        @pointerdown.self.stop
        @click.self.stop="closeMobileLinkActions"
        @keydown.esc="closeMobileLinkActions"
      >
        <section
          ref="mobileLinkActionsRef"
          class="mobileLinkActions"
          role="menu"
          :aria-label="mobileContextLinkLabel"
          tabindex="-1"
          @keydown.esc="closeMobileLinkActions"
        >
          <strong dir="auto">{{ mobileContextLinkLabel }}</strong>
          <button
            v-for="action in mobileContextActions?.actions ?? []"
            :key="action.label"
            type="button"
            role="menuitem"
            @click="runMobileContextAction(action)"
          >
            <FtIcon
              :icon="action.icon"
              aria-hidden="true"
            />
            {{ action.label }}
          </button>
          <button
            v-if="mobileContextLink"
            type="button"
            role="menuitem"
            @click="openMobileContextLink(false)"
          >
            <FtIcon :icon="['fas', 'link']" />
            {{ t('Share.Open Link') }}
          </button>
          <button
            v-if="mobileContextLinkCanOpenInTab"
            type="button"
            role="menuitem"
            @click="openMobileContextLink(true)"
          >
            <FtIcon :icon="['fas', 'arrow-up-right-from-square']" />
            {{ t('Context Menu.Open in a New Tab') }}
          </button>
          <button
            v-if="mobileContextLinkCopyUrl"
            type="button"
            role="menuitem"
            @click="copyMobileContextLink"
          >
            <FtIcon :icon="['fas', 'copy']" />
            {{ t('Share.Copy Link') }}
          </button>
          <button
            v-if="mobileContextLinkCopyUrl"
            type="button"
            role="menuitem"
            @click="shareMobileContextLink"
          >
            <FtIcon
              :icon="['fas', 'share-alt']"
              aria-hidden="true"
            />
            {{ t('Share.Share Link') }}
          </button>
        </section>
      </div>
    </Teleport>
    <FtToast />
    <FtProgressBar
      v-if="showProgressBar"
      :progress="displayedProgressBarPercentage"
    />
    <div
      v-if="findbarVisible"
      class="findbar"
      role="search"
      @keydown.stop="handleFindbarNavigationShortcut"
    >
      <FtIcon
        :icon="['fas', 'search']"
        class="findbarIcon"
        aria-hidden="true"
      />
      <input
        ref="findbarInputRef"
        v-model="findbarQuery"
        class="findbarInput"
        type="search"
        :placeholder="t('Find in page')"
        :aria-label="t('Find in page')"
        @input="findInPage"
        @keydown.enter.prevent="findInPage($event.shiftKey)"
        @keydown.esc.prevent="closeFindbar"
      >
      <span
        class="findbarStatus"
        aria-live="polite"
      >
        {{ findbarStatus }}
      </span>
      <button
        type="button"
        class="findbarButton"
        :aria-label="t('Previous match')"
        :title="t('Previous match')"
        @click="findInPage(true)"
      >
        <FtIcon
          :icon="['fas', 'angle-up']"
          aria-hidden="true"
        />
      </button>
      <button
        type="button"
        class="findbarButton"
        :aria-label="t('Next match')"
        :title="t('Next match')"
        @click="findInPage(false)"
      >
        <FtIcon
          :icon="['fas', 'angle-down']"
          aria-hidden="true"
        />
      </button>
      <button
        type="button"
        class="findbarButton"
        :aria-label="t('Close find bar')"
        :title="t('Close')"
        @click="closeFindbar"
      >
        <FtIcon
          :icon="['fas', 'xmark']"
          aria-hidden="true"
        />
      </button>
    </div>
    <div
      v-if="tabSwitcherVisible"
      class="tabSwitcherOverlay"
      data-tab-preview-overlay
      @mousedown.prevent
      @wheel.prevent="handleTabSwitcherWheel"
    >
      <div
        ref="tabSwitcherRef"
        v-overlay-scrollbars
        class="tabSwitcher"
        :class="{
          pointerActive: tabSwitcherPointerActive,
          noPreviews: !showTabPreviews
        }"
        role="listbox"
        :aria-label="t('KeyboardShortcutPrompt.Tab Switcher')"
        :aria-activedescendant="tabSwitcherSelectedTabId"
        @pointermove="activateTabSwitcherPointer"
        @pointerleave="clearTabSwitcherSelection"
      >
        <button
          v-for="(tab, index) in tabSwitcherTabs"
          :id="`tab-switcher-option-${tab.id}`"
          :key="tab.id"
          type="button"
          class="tabSwitcherItem"
          :class="{ selected: index === tabSwitcherSelectedIndex }"
          :style="getTabSwitcherItemStyle(tab)"
          role="option"
          :aria-selected="index === tabSwitcherSelectedIndex"
          @pointermove="setTabSwitcherSelectedIndex(index)"
          @focus="setTabSwitcherSelectedIndex(index)"
          @click="commitTabSwitcherSelection(index)"
        >
          <span
            v-if="showTabPreviews"
            class="tabSwitcherPreview"
          >
            <img
              v-if="getUsableTabSwitcherPreviewUrl(tab)"
              :src="tabSwitcherPreviewUrls[tab.id]"
              :alt="`${formatTabTitle(tab.title)} preview`"
              draggable="false"
              @error="handleTabSwitcherPreviewError(tab)"
            >
            <img
              v-else-if="!tabSwitcherPreviewPending[tab.id] && getUsableTabSwitcherAvatarUrl(tab)"
              :src="getUsableTabSwitcherAvatarUrl(tab)"
              :alt="`${formatTabTitle(tab.title)} preview`"
              class="tabSwitcherPreviewAvatar"
              draggable="false"
              @error="handleTabSwitcherAvatarError(tab)"
            >
            <span
              v-else-if="!tabSwitcherPreviewPending[tab.id]"
              class="tabSwitcherPreviewFallback"
              aria-hidden="true"
            >
              <FtIcon
                :icon="getTabPageIcon(tab) || ['fas', 'display']"
                class="tabSwitcherFallbackIcon"
              />
            </span>
          </span>
          <span class="tabSwitcherTitle">
            <img
              v-if="showTabIcons && getUsableTabSwitcherAvatarUrl(tab)"
              :src="getUsableTabSwitcherAvatarUrl(tab)"
              class="tabSwitcherTitleAvatar"
              alt=""
              draggable="false"
              @error="handleTabSwitcherAvatarError(tab)"
            >
            <FtIcon
              v-else-if="showTabIcons && getTabPageIcon(tab)"
              :icon="getTabPageIcon(tab)"
              class="tabSwitcherTitleIcon"
              aria-hidden="true"
            />
            <span class="tabSwitcherTitleText">
              {{ formatTabTitle(tab.title) }}
            </span>
          </span>
        </button>
      </div>
    </div>
  </div>
  <FtConnectionStatus />
</template>

<script setup>
import { initializeAndroidYtDlp, ytDlp } from './helpers/ytDlp'
import { parseAutomaticDownloadRules } from './helpers/automaticDownloadRules'
import { isAppHidden, setAndroidAppVisible } from './helpers/appVisibility.js'
import { createAppShortcuts, getAppShortcutPath } from './helpers/appShortcuts'
import { AppShortcuts } from '@capawesome/capacitor-app-shortcuts'
import { playbackScreenWake } from './helpers/playbackScreenWake'
import { FtIcon } from '@opentubex/icons'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core'
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, provide, ref, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { routerKey, useRoute, useRouter } from 'vue-router'

import FtFlexBox from './components/ft-flex-box/ft-flex-box.vue'
import TopNav from './components/TopNav/TopNav.vue'
import SideNav from './components/SideNav/SideNav.vue'
import TabBar from './components/TabBar/TabBar.vue'
import CapacitorTabletTabBar from './components/TabBar/CapacitorTabletTabBar.vue'
import TabContent from './components/TabContent/TabContent.vue'
import FtPrompt from './components/FtPrompt/FtPrompt.vue'
import FtButton from './components/FtButton/FtButton.vue'
import FtToast from './components/FtToast/FtToast.vue'
import FtConnectionStatus from './components/FtConnectionStatus/FtConnectionStatus.vue'
import FtProgressBar from './components/FtProgressBar/FtProgressBar.vue'
import FtContextMenu from './components/FtContextMenu/FtContextMenu.vue'
import { lockBodyScroll, unlockBodyScroll } from './components/FtPrompt/scrollLock'
import { vSaferHtml } from './directives/vSaferHtml.js'

import store from './store/index'
import {
  applyThemeToDocument,
  handleCustomThemeUpdated,
  loadCustomThemes,
} from './helpers/customTheme'
import { repairSystemThemeSettings } from './helpers/customThemeSync'

import packageDetails from '../../package.json'
import { MULTIPLE_TABS_CONFIRM_THRESHOLD, KeyboardShortcuts } from '../constants'
import { resolveBaseTheme, resolveSystemThemeSettings } from '../appearanceSettings'
import { calculateColorLuminance, resolveColor } from './helpers/colors'
import { matchesKeyboardShortcut } from './helpers/keyboardShortcuts'
import { hasVisibleGamepadLayer, initializeGamepadNavigation } from './helpers/gamepadNavigation'
import { keyboardEventInitFromShortcut, OPEN_COMMAND_PALETTE_EVENT } from './helpers/commandPalette'
import { createCommandPaletteRegistry } from './helpers/commandPaletteRegistry'
import {
  resolveExternalLinkAction,
  resolveMobileContextLinkCopyUrl,
} from './helpers/mobileLinkActions'
import { startProgressBarOperation } from './helpers/progressBar'
import { initializePlatformInfo, isLinuxWayland } from './helpers/platform'
import {
  shouldShowProgressStartToast,
  shouldUseProgressToast,
} from './helpers/progressPresentation'
import { fetchReleasePages, findUpdateReleases, formatReleaseChangelog } from './helpers/releaseUpdates'
import { copyToClipboard, openExternalLink, openInternalPath, shareLink, showApiErrorToast, showToast } from './helpers/utils'
import {
  exitAndroidApp,
  getAndroidHardwareKeyboardState,
  setAndroidPictureInPictureDocumentState,
  setAndroidSystemBarsBackground
} from './helpers/androidUi'
import { openNotificationSettings } from './helpers/capacitorUi'
import { initializeCapacitorLiveReminderActions } from './helpers/liveReminders'
import {
  addAndroidMediaSessionActionListener,
  shouldPauseAndroidPlaybackOnAppStateChange,
} from './helpers/androidMediaSession'
import {
  acknowledgeAndroidSubscriptionRefreshResult,
  addAndroidSubscriptionRefreshCancelledListener,
  configureAndroidSubscriptionRefresh,
  finishAndroidSubscriptionRefresh,
  getNextAndroidSubscriptionRefreshResult,
  requestAndroidSubscriptionRefreshNotificationPermission,
  startAndroidSubscriptionRefresh,
  updateAndroidSubscriptionRefresh
} from './helpers/androidSubscriptionRefresh'
import {
  createAndroidSubscriptionRefreshConfiguration,
  createSubscriptionRefreshStartGuard,
  normalizeAndroidSubscriptionRefreshPayload,
  processAndroidSubscriptionRefreshChannelResult
} from './helpers/androidSubscriptionRefreshData'
import { normalizeInvidiousSubscriptionFeed } from './helpers/api/invidious'
import { formatRequestDiagnostic } from './helpers/api/requestDiagnostics'
import { reconcileFetchedSubscriptionEntries } from './helpers/subscription-entries'
import {
  cancelSubscriptionRefresh,
  requestSubscriptionRefreshCancellation,
  refreshSubscriptionLiveFromRemote,
  refreshSubscriptionPostsFromRemote,
  refreshSubscriptionShortsFromRemote,
  refreshSubscriptionVideosFromRemote,
  SUBSCRIPTION_REFRESH_CANCEL_STORAGE_KEY,
  SUBSCRIPTION_REFRESH_CANCELLED_EVENT,
  SUBSCRIPTION_REFRESH_COMPLETED_EVENT,
  SUBSCRIPTION_REFRESH_FINISHED_EVENT,
  SUBSCRIPTION_REFRESH_LOCK_NAME,
  SUBSCRIPTION_REFRESH_PROGRESS_EVENT,
  SUBSCRIPTION_REFRESH_STARTED_EVENT
} from './helpers/subscriptions'
import { translateWindowTitle } from './helpers/strings'
import { formatTabTitle } from './tabs/tabTitle'
import { normalizeScrollbarThumbWidth } from './constants/scrollbar'
import { getAppFontFamily } from './helpers/appFont'
import { createCapacitorUiScale } from './helpers/capacitorUiScale'
import { usesCapacitorTabletLayout } from './helpers/capacitorLayout'
import { getTabAccentColor } from './constants/tabColors'
import { getThumbnailListStyles } from './constants/thumbnailSize'
import {
  getNextTabBarPosition,
  isVerticalTabBarPosition,
  normalizeTabBarPosition
} from './constants/tabBarPosition'
import {
  getLastUsedVersion,
  getTutorialAudience,
  markTutorialCompleted,
  setLastUsedVersion,
  setTutorialAudience,
} from './helpers/tutorialState'
import { dismissAutoSyncNotice, shouldShowAutoSyncNotice, showAutoSyncNoticeOnce } from './helpers/sync-auto-sync-notice'
import { invalidateAllYtDlpPlaybackSources } from './helpers/player/ytDlpPlayback'
import { getTabNavigationService } from './tabs/TabNavigationService'
import { initializeCapacitorTabPreviews } from './tabs/capacitorTabPreviews'
import { initializeCapacitorTabService } from './tabs/CapacitorTabService'
import { tabMediaCoordinator } from './tabs/TabMediaCoordinator'
import { tabRuntimeRegistry } from './tabs/TabRuntimeRegistry'
import { getTabAvatarUrl, getTabPageIcon, getTabPreviewFallbackUrl } from './tabs/tabPreview'
import { preloadResolvedRoute, preloadUtilityRoutes } from './router/index'
import { initializeCapacitorPullToRefresh } from './helpers/capacitorPullToRefresh'

const SettingsWindow = defineAsyncComponent(() => import('./views/Settings/Settings.vue'))
const FtPlaylistAddVideoPrompt = defineAsyncComponent(() => import('./components/FtPlaylistAddVideoPrompt/FtPlaylistAddVideoPrompt.vue'))
const FtCreatePlaylistPrompt = defineAsyncComponent(() => import('./components/FtCreatePlaylistPrompt/FtCreatePlaylistPrompt.vue'))
const FtSearchFilters = defineAsyncComponent(() => import('./components/FtSearchFilters/FtSearchFilters.vue'))
const FtTutorialOverlay = defineAsyncComponent(() => import('./components/FtTutorialOverlay/FtTutorialOverlay.vue'))
const FtCommandPalette = defineAsyncComponent(() => import('./components/FtCommandPalette/FtCommandPalette.vue'))
const TabOrganizer = defineAsyncComponent(() => import('./components/TabOrganizer/TabOrganizer.vue'))
const OPEN_TAB_ORGANIZER_EVENT = 'opentubex:open-tab-organizer'

const route = useRoute()
const router = useRouter()
const availableRoutePaths = new Set(router.getRoutes().map(candidate => candidate.path))
const isElectron = process.env.IS_ELECTRON
const isCapacitor = process.env.IS_CAPACITOR
const usesLogicalTabs = isElectron || isCapacitor
const navigation = usesLogicalTabs ? getTabNavigationService() : null
const capacitorTabService = isCapacitor
  ? initializeCapacitorTabService(router, store, navigation)
  : null
if (usesLogicalTabs) {
  provide(routerKey, navigation.createPresentedRouterFacade())
}
const { locale, t, tm } = useI18n()
initializePlatformInfo()

const tabContainers = computed(() => {
  return store.getters.getTabContainerIds
    .map(tabId => store.getters.getTabById(tabId))
    .filter(Boolean)
})
const activeTabId = computed(() => store.getters.getActiveTabId)
const presentedTabId = computed(() => store.getters.getPresentedTabId)
const selectionRevision = computed(() => store.state.tabs.selectionRevision)

/** @type {import('vue').ComputedRef<boolean>} */
const isSideNavOpen = computed(() => store.getters.getIsSideNavOpen)

/** @type {import('vue').ComputedRef<boolean>} */
const hideLabelsSideBar = computed(() => store.getters.getHideLabelsSideBar)

const tabBarPosition = computed(() => isElectron
  ? normalizeTabBarPosition(store.getters.getTabBarPosition)
  : 'top')
const useVerticalTabBar = computed(() => isElectron && isVerticalTabBarPosition(tabBarPosition.value))
const tabletTabStripQuery = window.matchMedia('(min-width: 768px)')
const automaticTabletTabStrip = ref(tabletTabStripQuery.matches)
const capacitorLayoutMode = computed(() => store.getters.getCapacitorLayoutMode)
const showTabletTabStrip = computed(() => isCapacitor && (
  usesCapacitorTabletLayout(capacitorLayoutMode.value, automaticTabletTabStrip.value)
))
tabletTabStripQuery.addEventListener('change', handleTabletTabStripChange)

const appStyle = computed(() => {
  const style = {}
  if (useVerticalTabBar.value) {
    style['--vertical-tab-bar-width'] = `${store.getters.getVerticalTabBarWidth}px`
  }
  if (showTabletTabStrip.value) style['--top-tab-bar-height'] = '48px'

  return Object.keys(style).length > 0 ? style : undefined
})

function handleTabletTabStripChange(event) {
  automaticTabletTabStrip.value = event.matches
}

/** @type {import('vue').ComputedRef<boolean>} */
const useWatchSideNavOverlay = computed(() => {
  return store.getters.getHideSideBarOnWatchPages && route.path.startsWith('/watch/')
})

let sideNavOpenBeforeWatchOverlay = null
const watchSideNavTransitionDisabled = ref(false)
let watchSideNavTransitionFrame = null

watch(useWatchSideNavOverlay, (enabled) => {
  if (enabled) {
    disableWatchSideNavTransitionForNextFrame()
    sideNavOpenBeforeWatchOverlay = isSideNavOpen.value
    closeSideNav()
  } else if (sideNavOpenBeforeWatchOverlay !== null) {
    // Leaving the overlay brings the sidebar back into normal flow and may
    // reopen it. Suppress its inline-size transition for the reflow so the
    // content snaps to its final position instead of sliding in from the right.
    disableWatchSideNavTransitionForNextFrame()

    if (isSideNavOpen.value !== sideNavOpenBeforeWatchOverlay) {
      store.commit('toggleSideNav')
    }

    sideNavOpenBeforeWatchOverlay = null
  }
}, { immediate: true })

function disableWatchSideNavTransitionForNextFrame() {
  cancelWatchSideNavTransitionReset()
  watchSideNavTransitionDisabled.value = true

  watchSideNavTransitionFrame = requestAnimationFrame(() => {
    watchSideNavTransitionFrame = requestAnimationFrame(() => {
      watchSideNavTransitionDisabled.value = false
      watchSideNavTransitionFrame = null
    })
  })
}

function cancelWatchSideNavTransitionReset() {
  if (watchSideNavTransitionFrame !== null) {
    cancelAnimationFrame(watchSideNavTransitionFrame)
    watchSideNavTransitionFrame = null
  }
}

function closeSideNav() {
  if (isSideNavOpen.value) {
    store.commit('toggleSideNav')
  }
}

/** @type {import('vue').ComputedRef<boolean>} */
const isAnyPromptOpen = computed(() => store.getters.isAnyPromptOpen)

/** @type {import('vue').ComputedRef<boolean>} */
const showSearchFilters = computed(() => store.getters.getShowSearchFilters)

/** @type {import('vue').ComputedRef<boolean>} */
const isKeyboardShortcutPromptShown = computed(() => store.getters.getIsKeyboardShortcutPromptShown)
const settingsWindowOpen = computed(() => store.getters.getSettingsWindowOpen)
const settingsWindowMinimized = computed(() => store.getters.getSettingsWindowMinimized)
const settingsWindowMorphing = computed(() => store.getters.getSettingsWindowMorphing)

function resetClosedSettingsWindowView() {
  if (!settingsWindowOpen.value && !settingsWindowMinimized.value) {
    store.dispatch('showSettingsWindowRoot')
  }
}

/** @type {import('vue').ComputedRef<boolean>} */
const showAddToPlaylistPrompt = computed(() => store.getters.getShowAddToPlaylistPrompt)

/** @type {import('vue').ComputedRef<boolean>} */
const showCreatePlaylistPrompt = computed(() => store.getters.getShowCreatePlaylistPrompt)

/** @type {import('vue').ComputedRef<boolean>} */
const localProgressBarVisible = computed(() => store.getters.getShowProgressBar)

/** @type {import('vue').ComputedRef<boolean>} */
const subscriptionRefreshInProgress = computed(() => store.getters.getSubscriptionFeedRefreshInProgress)
const progressUsesToast = computed(() => {
  return shouldUseProgressToast(store.getters.getShowProgressBarToast)
})
const showProgressStartToast = computed(() => {
  return shouldShowProgressStartToast(store.getters.getShowProgressBarToast)
})

const showProgressBar = computed(() => {
  return (localProgressBarVisible.value && !progressUsesToast.value) ||
    (subscriptionRefreshInProgress.value && !progressUsesToast.value)
})
const displayedProgressBarPercentage = computed(() => {
  return localProgressBarVisible.value
    ? store.getters.getProgressBarPercentage
    : store.getters.getSubscriptionFeedRefreshProgress
})

const landingPage = computed(() => '/' + store.getters.getLandingPage)

/** @type {import('vue').ComputedRef<string>} */
const defaultInvidiousInstance = computed(() => store.getters.getDefaultInvidiousInstance)

/** @type {import('vue').ComputedRef<string>} */
const subscriptionFeedAutoRefreshInterval = computed(() => store.getters.getSubscriptionFeedAutoRefreshInterval)

/** @type {import('vue').ComputedRef<string>} */
const subscriptionShortsAutoRefreshInterval = computed(() => store.getters.getSubscriptionShortsAutoRefreshInterval)

/** @type {import('vue').ComputedRef<string>} */
const subscriptionLiveAutoRefreshInterval = computed(() => store.getters.getSubscriptionLiveAutoRefreshInterval)

/** @type {import('vue').ComputedRef<string>} */
const subscriptionPostsAutoRefreshInterval = computed(() => store.getters.getSubscriptionPostsAutoRefreshInterval)

/** @type {import('vue').ComputedRef<boolean>} */
const enableClosedAppSubscriptionRefresh = computed(() => store.getters.getEnableClosedAppSubscriptionRefresh)

/** @type {import('vue').ComputedRef<string | null>} */
const activeSubscriptionProfileId = computed(() => store.getters.getActiveProfile?._id ?? null)

/** @type {import('vue').ComputedRef<string>} */
const historyRetentionDays = computed(() => store.getters.getHistoryRetentionDays)

/** @type {import('vue').ComputedRef<boolean>} */
const hideSubscriptionsVideos = computed(() => store.getters.getHideSubscriptionsVideos)

/** @type {import('vue').ComputedRef<boolean>} */
const hideSubscriptionsShorts = computed(() => store.getters.getHideSubscriptionsShorts)

/** @type {import('vue').ComputedRef<boolean>} */
const hideSubscriptionsLive = computed(() => store.getters.getHideLiveStreams || store.getters.getHideSubscriptionsLive)

/** @type {import('vue').ComputedRef<boolean>} */
const hideSubscriptionsPosts = computed(() => store.getters.getHideSubscriptionsCommunity || store.getters.getUseRssFeeds)

const dataReady = ref(false)
const subscriptionCacheReady = computed(() => store.getters.getSubscriptionCacheReady)
const showTutorial = ref(false)
const tutorialIsNewInstallation = ref(false)
const findbarVisible = ref(false)
const findbarQuery = ref('')
const findbarMatchIndex = ref(0)
const findbarMatchCount = ref(0)
const findbarInputRef = useTemplateRef('findbarInputRef')
const tabSwitcherVisible = ref(false)
const tabSwitcherSelectedIndex = ref(-1)
const tabSwitcherPreviewUrls = ref({})
const tabSwitcherPreviewPending = ref({})
const tabSwitcherFailedAvatarUrls = ref({})
const tabSwitcherFailedPreviewUrls = ref({})
const tabSwitcherPointerActive = ref(false)
const tabSwitcherRef = useTemplateRef('tabSwitcherRef')
const commandPaletteOpen = ref(false)
const hardwareKeyboardAttached = ref(!isCapacitor)
provide('hardwareKeyboardAttached', hardwareKeyboardAttached)
const mobileContextLink = ref(null)
const mobileContextActions = ref(null)
provide('openMobileContextActions', async (menu) => {
  mobileContextLink.value = null
  mobileContextActions.value = menu
  await nextTick()
  mobileLinkActionsRef.value?.focus({ preventScroll: true })
})
const mobileLinkActionsPromptId = useId()
const mobileLinkActionsRef = useTemplateRef('mobileLinkActionsRef')
let mobileLinkActionsLocked = false
const mobileContextLinkLabel = computed(() => {
  if (mobileContextActions.value) return mobileContextActions.value.title
  const link = mobileContextLink.value
  if (!link) return ''

  const itemTitle = link.closest('.ft-list-item')?.querySelector('.h3Title, .playlistTitle')?.textContent
  return link.dataset.tabTitle?.trim() ||
    link.getAttribute('aria-label')?.trim() ||
    link.textContent?.trim() ||
    itemTitle?.trim() ||
    link.href
})
const mobileContextLinkCanOpenInTab = computed(() => {
  const href = mobileContextLink.value?.href ?? ''
  return href.startsWith(`${window.location.href.split('#')[0]}#`) ||
    /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//.test(href)
})
const mobileContextLinkCopyUrl = computed(() => {
  const href = mobileContextLink.value?.href
  return href
    ? resolveMobileContextLinkCopyUrl(href, window.location.href.split('#')[0])
    : null
})
watch(() => mobileContextLink.value !== null || mobileContextActions.value !== null, (isOpen) => {
  if (isOpen && !mobileLinkActionsLocked) {
    lockBodyScroll()
    store.commit('addOpenPrompt', mobileLinkActionsPromptId)
    mobileLinkActionsLocked = true
  } else if (!isOpen && mobileLinkActionsLocked) {
    store.commit('removeOpenPrompt', mobileLinkActionsPromptId)
    unlockBodyScroll()
    mobileLinkActionsLocked = false
  }
})
const tabOrganizerOpen = ref(false)
const showAndroidExitPrompt = ref(false)
const settingsSearchTarget = ref(null)
const subscriptionAutoRefreshTimers = {
  videos: null,
  shorts: null,
  live: null,
  posts: null
}
const HISTORY_CLEANUP_INTERVAL = 60 * 60 * 1000
const SUBSCRIPTION_AUTO_REFRESH_FAILURE_RETRY_INTERVAL = 60 * 1000
const SUBSCRIPTION_AUTO_REFRESH_LOCK_RETRY_INTERVAL = 1000
const LEGACY_SUBSCRIPTION_AUTO_REFRESH_STORAGE_KEY_PREFIX = 'opentubex.subscriptionAutoRefresh.'
const SUBSCRIPTION_AUTO_REFRESH_COMPLETION_STORAGE_KEY_PREFIX = 'opentubex.subscriptionAutoRefresh.completed.'
const SUBSCRIPTION_AUTO_REFRESH_DEADLINE_STORAGE_KEY_PREFIX = 'opentubex.subscriptionAutoRefresh.deadline.'
const SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY = 'opentubex.subscriptionAutoRefresh.inProgress'
let historyCleanupTimer = null
const subscriptionAutoRefreshTabs = ['videos', 'shorts', 'live', 'posts']
let removeSubscriptionAutoRefreshActiveChangedListener = null
let removeSubscriptionAutoRefreshCancelListener = null
let removeSubscriptionAutoRefreshStateChangedListener = null
let removeTabsStateListener = null
let removeReloadRequestListener = null
let removeConfirmMultipleTabsActionListener = null
let removeOpenUrlListener = null
let removeCapacitorIntegrationListeners = null
let capacitorPullToRefreshSetup = null
let removeCapacitorTabPreviews = null
let removeYtDlpBinaryUpdatedListener = null
let removeAndroidYtDlpSettingsListener = null
let removeOpenTabOrganizerListener = null
let removeAndroidSubscriptionRefreshCancelledListener = null
let removeGamepadNavigation = () => {}
/** @type {number|null} */
let utilityRoutePreloadId = null
let utilityRoutePreloadUsesIdleCallback = false

function isSyncSettingsVisible() {
  return settingsWindowOpen.value && document.querySelector(
    '.settingsWindow .settingsContent > [data-section="sync"]'
  ) !== null
}

watch([dataReady, () => store.getters.getSyncServerError], ([ready, error]) => {
  if (!ready || error === '' || isSyncSettingsVisible()) return

  showToast({
    message: t('Settings.Sync Settings.Sync failed', { error }),
    icon: ['fas', 'circle-exclamation'],
  })
}, { flush: 'post' })

function scheduleUtilityRoutePreload() {
  if (utilityRoutePreloadId !== null) {
    return
  }

  const preload = () => {
    utilityRoutePreloadId = null
    preloadUtilityRoutes()
  }

  if (typeof window.requestIdleCallback === 'function') {
    utilityRoutePreloadUsesIdleCallback = true
    utilityRoutePreloadId = window.requestIdleCallback(preload, { timeout: 2000 })
  } else {
    utilityRoutePreloadUsesIdleCallback = false
    utilityRoutePreloadId = window.setTimeout(preload, 1000)
  }
}

function cancelUtilityRoutePreload() {
  if (utilityRoutePreloadId === null) {
    return
  }

  if (utilityRoutePreloadUsesIdleCallback) {
    window.cancelIdleCallback(utilityRoutePreloadId)
  } else {
    clearTimeout(utilityRoutePreloadId)
  }
  utilityRoutePreloadId = null
}
const pendingSubscriptionAutoRefreshes = []
const pendingSubscriptionAutoRefreshKeys = new Set()
const cancelledSubscriptionAutoRefreshKeys = new Set()
let processingSubscriptionAutoRefreshes = false
let tabSwitcherPreviewRequestId = 0
let findbarMatches = []
const findbarStateByTabId = new Map()

const tabSwitcherTabs = computed(() => store.getters.getTabs)
const showTabIcons = computed(() => store.getters.getShowTabIcons)
const showTabPreviews = computed(() => store.getters.getShowTabPreviews)
const findbarStatus = computed(() => {
  if (findbarQuery.value.trim().length === 0) {
    return ''
  }

  if (findbarMatchCount.value === 0) {
    return t('No matches')
  }

  return `${findbarMatchIndex.value}/${findbarMatchCount.value}`
})
const tabSwitcherSelectedTabId = computed(() => {
  const tab = tabSwitcherTabs.value[tabSwitcherSelectedIndex.value]
  return tab ? `tab-switcher-option-${tab.id}` : undefined
})

/**
 * Falls back to OpenTubeX-managed external software when the configured system
 * executables are unavailable. Selected managed executables are updated when
 * automatic updates are enabled or the user accepts an available update.
 * @param {('yt-dlp' | 'ffmpeg')[] | null} requestedUpdates
 */
async function initializeManagedExternalSoftware(requestedUpdates = null) {
  if (!isElectron && !isCapacitor) {
    return
  }

  const info = await ytDlp.ytDlpGetInfo()
  if (info === null) {
    return
  }

  /** @type {('yt-dlp' | 'ffmpeg' | 'ffprobe')[]} */
  const missingBinaries = []
  /** @type {('yt-dlp' | 'ffmpeg')[]} */
  const binariesToUpdate = []

  if (!info.ytDlp.available) {
    missingBinaries.push('yt-dlp')
  }
  if (!info.ffmpeg.available) {
    missingBinaries.push('ffmpeg')
  }
  if (!info.ffprobe.available) {
    missingBinaries.push('ffprobe')
  }

  const updateMode = store.getters.getExternalSoftwareUpdateMode
  const automaticUpdates = updateMode === 'automatic'
  let missingManagedBinaries = missingBinaries
  if (!automaticUpdates && missingBinaries.length > 0) {
    const managedInfo = await ytDlp.ytDlpGetInfo({
      ytDlpSource: 'managed',
      ytDlpPath: '',
      ffmpegSource: 'managed',
      ffmpegPath: ''
    })
    if (managedInfo !== null) {
      missingManagedBinaries = missingBinaries.filter(binary => {
        if (binary === 'yt-dlp') {
          return !managedInfo.ytDlp.available
        }
        return binary === 'ffmpeg' ? !managedInfo.ffmpeg.available : !managedInfo.ffprobe.available
      })
    }
  }

  if (missingManagedBinaries.includes('yt-dlp') ||
    ((isCapacitor || store.getters.getYtDlpSource === 'managed') &&
      (automaticUpdates || requestedUpdates?.includes('yt-dlp')))) {
    binariesToUpdate.push('yt-dlp')
  }
  if (missingManagedBinaries.includes('ffmpeg') || missingManagedBinaries.includes('ffprobe') ||
    (!isCapacitor && store.getters.getYtDlpFfmpegSource === 'managed' &&
      (automaticUpdates || requestedUpdates?.includes('ffmpeg')))) {
    binariesToUpdate.push('ffmpeg')
  }

  const settingUpdates = []
  if (missingBinaries.includes('yt-dlp') && store.getters.getYtDlpSource !== 'managed') {
    settingUpdates.push(store.dispatch('updateYtDlpSource', 'managed'))
  }
  if ((missingBinaries.includes('ffmpeg') || missingBinaries.includes('ffprobe')) &&
    store.getters.getYtDlpFfmpegSource !== 'managed') {
    settingUpdates.push(store.dispatch('updateYtDlpFfmpegSource', 'managed'))
  }
  await Promise.all(settingUpdates)

  if (binariesToUpdate.length === 0) {
    if (updateMode === 'ask' && requestedUpdates === null) {
      await notifyAboutManagedExternalSoftwareUpdates([])
    }
    return
  }

  let downloadStarted = missingManagedBinaries.length > 0
  let toolProgressPercentage = 0
  let progressOperation = null

  function showToolProgress(message) {
    const progress = {
      icon: ['fas', 'download'],
      message,
      percentage: toolProgressPercentage,
    }
    if (progressOperation === null) {
      progressOperation = startProgressBarOperation(store, progress)
    } else {
      progressOperation.update(progress)
    }
  }

  if (downloadStarted) {
    const tools = binariesToUpdate.join(' and ')
    const message = t('Settings.Download Settings.Managed Tools Download Started Template', { tools })
    if (showProgressStartToast.value) {
      showToast({ message, icon: ['fas', 'download'] })
    }
    showToolProgress(message)
  }

  const progressByBinary = Object.fromEntries(
    binariesToUpdate.map(binary => [binary, 0])
  )
  const removeProgressListener = ytDlp.addYtDlpBinaryDownloadProgressListener(({ binary, percent, inProgress }) => {
    if (!binariesToUpdate.includes(binary) || !inProgress || percent === null) {
      return
    }

    if (!downloadStarted) {
      downloadStarted = true
      const tools = binariesToUpdate.join(' and ')
      const message = t('Settings.Download Settings.Managed Tools Update Started Template', { tools })
      if (showProgressStartToast.value) {
        showToast({ message, icon: ['fas', 'download'] })
      }
      showToolProgress(message)
    }

    progressByBinary[binary] = Math.max(progressByBinary[binary] ?? 0, percent)
    const percentages = Object.values(progressByBinary)
    const combinedPercentage = percentages.reduce((sum, value) => sum + value, 0) / percentages.length
    toolProgressPercentage = Math.max(toolProgressPercentage, combinedPercentage)
    progressOperation.update({ percentage: toolProgressPercentage })
  })

  try {
    const results = await Promise.all(binariesToUpdate.map(async binary => {
      try {
        return { binary, result: await ytDlp.ytDlpDownloadBinary(binary) }
      } catch (error) {
        return { binary, result: { error: String(error) } }
      }
    }))
    const failures = results.filter(({ result }) => result === null || 'error' in result)
    const updatedBinaries = results
      .filter(({ result }) => result !== null && 'version' in result && result.updated)
      .map(({ binary }) => binary)

    if (failures.length === 0 && updatedBinaries.length > 0) {
      toolProgressPercentage = 100
      progressOperation?.update({ percentage: toolProgressPercentage })
      const updatedTools = updatedBinaries.join(' and ')
      showToast({
        message: missingManagedBinaries.length > 0
          ? t('Settings.Download Settings.Managed Tools Download Finished Template', { tools: updatedTools })
          : t('Settings.Download Settings.Managed Tools Update Finished Template', { tools: updatedTools }),
        icon: ['fas', 'check'],
      })
    } else {
      if (failures.length > 0) {
        const errors = failures.map(({ binary, result }) => `${binary}: ${result?.error ?? ''}`).join('; ')
        showToast({
          message: t('Settings.Download Settings.Managed Tools Download Error Template', { errors }),
          icon: ['fas', 'circle-exclamation'],
        })
      }
    }
  } finally {
    removeProgressListener()
    progressOperation?.finish()
  }

  if (updateMode === 'ask' && requestedUpdates === null) {
    await notifyAboutManagedExternalSoftwareUpdates(missingManagedBinaries)
  }
}

/**
 * Checks installed managed tools and offers an explicit update action.
 * @param {('yt-dlp' | 'ffmpeg' | 'ffprobe')[]} binariesInstalledThisRun
 */
async function notifyAboutManagedExternalSoftwareUpdates(binariesInstalledThisRun) {
  const candidates = []
  if ((isCapacitor || store.getters.getYtDlpSource === 'managed') && !binariesInstalledThisRun.includes('yt-dlp')) {
    candidates.push('yt-dlp')
  }
  if (!isCapacitor && store.getters.getYtDlpFfmpegSource === 'managed' &&
    !binariesInstalledThisRun.includes('ffmpeg') && !binariesInstalledThisRun.includes('ffprobe')) {
    candidates.push('ffmpeg')
  }

  const checks = await Promise.all(candidates.map(async binary => {
    const result = await ytDlp.ytDlpCheckBinaryUpdate(binary)
    if (result !== null && 'error' in result) {
      console.warn(`Checking for a managed ${binary} update failed`, result.error)
    }
    return result?.available === true ? binary : null
  }))
  const availableUpdates = checks.filter(binary => binary !== null)
  if (availableUpdates.length === 0) {
    return
  }

  showManagedExternalSoftwareUpdatePrompt(availableUpdates)
}

/**
 * @param {('yt-dlp' | 'ffmpeg')[]} availableUpdates
 */
function showManagedExternalSoftwareUpdatePrompt(availableUpdates) {
  showToast({
    message: t('Settings.Download Settings.Managed Tools Update Available Template', {
      tools: availableUpdates.join(' and ')
    }),
    time: Infinity,
    icon: ['fas', 'download'],
    buttons: [
      { label: t('Cancel') },
      {
        label: t('Settings.Download Settings.Update Managed Tools'),
        primary: true,
        action: () => {
          initializeManagedExternalSoftware(availableUpdates)
            .catch(error => console.error('Failed to update managed external software', error))
        }
      }
    ]
  })
}

const MANAGED_TOOLS_UPDATE_PREVIEW_EVENT = 'opentubex:preview-managed-tools-update'

/**
 * Allows the real actionable update prompt to be previewed from DevTools.
 * @param {Event} event
 */
function previewManagedExternalSoftwareUpdatePrompt(event) {
  const detail = event instanceof CustomEvent ? event.detail : null
  const availableUpdates = Array.isArray(detail)
    ? detail.filter(binary => binary === 'yt-dlp' || binary === 'ffmpeg')
    : []
  showManagedExternalSoftwareUpdatePrompt(availableUpdates.length > 0 ? [...new Set(availableUpdates)] : ['yt-dlp'])
}

async function initializeTutorial(hasExistingInstallation, lastUsedVersion, persistedAudience) {
  try {
    let audience = getTutorialAudience(persistedAudience)
    if (audience === 'completed') return false
    if (audience !== 'new' && audience !== 'existing' && lastUsedVersion !== null) return false
    if (hasExistingInstallation === null) return false

    if (audience !== 'new' && audience !== 'existing') {
      audience = hasExistingInstallation ? 'existing' : 'new'
      await setTutorialAudience(audience)
    }

    tutorialIsNewInstallation.value = audience === 'new'
    return true
  } catch (error) {
    console.error('Failed to initialize tutorial', error)
    return false
  }
}

async function completeTutorial() {
  showTutorial.value = false
  await nextTick()

  if (isElectron) {
    try {
      await window.ftElectron.tabs.setShortcutsBlocked(false)
    } catch (error) {
      console.error('Failed to restore tab shortcuts', error)
    }
  }

  try {
    await markTutorialCompleted()
  } catch (error) {
    console.error('Failed to save tutorial completion', error)
  }
}

onMounted(async () => {
  removeGamepadNavigation = initializeGamepadNavigation({
    onBack: handleGamepadBack,
    onNavigate: () => store.dispatch('showOutlines'),
    onPlayPause: handleGamepadPlayPause,
  })
  let tabsReady = Promise.resolve()
  if (isElectron || isCapacitor) {
    removeYtDlpBinaryUpdatedListener = ytDlp.addYtDlpBinaryUpdatedListener(invalidateAllYtDlpPlaybackSources)
  }

  if (isElectron) {
    window.addEventListener(MANAGED_TOOLS_UPDATE_PREVIEW_EVENT, previewManagedExternalSoftwareUpdatePrompt)
    tabsReady = store.dispatch('initializeTabs').then((removeListener) => {
      removeTabsStateListener = removeListener
      window.ftElectron.tabs.rendererReady()
    })
  }

  const settingsReady = store.dispatch('grabUserSettings').then(async tutorialState => {
    if (isCapacitor) {
      await store.dispatch('loadAndroidProxySettings').catch(() => {
        showToast({
          message: t('Settings.Proxy Settings["Error getting network information. Is your proxy configured properly?"]'),
          icon: ['fas', 'circle-exclamation'],
        })
      })
    }
    removeAndroidYtDlpSettingsListener = initializeAndroidYtDlp()
    return tutorialState
  })
  if (isCapacitor) {
    tabsReady = settingsReady.then(() => capacitorTabService.initialize(route))
    removeCapacitorTabPreviews = initializeCapacitorTabPreviews(store)
  }
  const customThemesReady = loadCustomThemes().catch((error) => {
    console.error('Failed to load custom theme:', error)
    return []
  })
  const invidiousInstancesReady = store.dispatch('fetchInvidiousInstancesFromFile')
  const profilesReady = settingsReady.then(() => (
    store.dispatch('grabAllProfiles', t('Profile.All Channels'))
  ))
  tabsReady.then(() => {
    const initialRoute = usesLogicalTabs ? store.getters.getActiveTab?.route : route
    if (initialRoute) {
      return preloadResolvedRoute(router.resolve(initialRoute.fullPath))
    }
  }).catch(error => {
    console.error('Failed to preload the initial route', error)
  })
  const [tutorialState, themes] = await Promise.all([
    settingsReady,
    customThemesReady,
    invidiousInstancesReady,
    tabsReady,
  ])
  const lastUsedVersion = getLastUsedVersion(tutorialState.lastUsedVersion)
  const showAutoSyncNotice = shouldShowAutoSyncNotice(lastUsedVersion, store.state.settings)
  if (tutorialState.landingPageToInitialize !== null) {
    await store.dispatch('updateLandingPage', tutorialState.landingPageToInitialize)
  }

  try {
    store.commit('setCustomThemes', themes)
    if (baseTheme.value === 'custom' && themes.length > 0) {
      await store.dispatch('updateBaseTheme', `custom:${themes[0].id}`)
    }
    await sanitizeAppearanceSettings(themes)
  } catch (error) {
    console.error('Failed to load custom theme:', error)
  }
  removeCustomThemeListener = handleCustomThemeUpdated(async (themes) => {
    store.commit('setCustomThemes', themes)
    await repairSystemThemeSettings(store, themes)
    updateTheme()
  })
  updateTheme()

  if (defaultInvidiousInstance.value === '') {
    await store.dispatch('setRandomCurrentInvidiousInstance')
  }

  store.dispatch('fetchInvidiousInstances').then(() => {
    if (defaultInvidiousInstance.value === '') {
      store.dispatch('setRandomCurrentInvidiousInstance')
    }
  })

  profilesReady.then(async (hasExistingProfiles) => {
    const hasExistingInstallation = tutorialState.hasExistingSettings === true || hasExistingProfiles === true
      ? true
      : tutorialState.hasExistingSettings === null || hasExistingProfiles === null
        ? null
        : false
    const tutorialPending = await initializeTutorial(
      hasExistingInstallation,
      lastUsedVersion,
      tutorialState.tutorialAudience
    )
    if (hasExistingInstallation !== null || lastUsedVersion !== null) {
      await setLastUsedVersion(packageDetails.version)
    }

    const syncDataReady = Promise.all([
      store.dispatch('grabHistory'),
      store.dispatch('grabAllPlaylists'),
      store.dispatch('grabAllSubscriptions'),
    ])
    store.dispatch('grabSearchHistoryEntries')

    // YouTube links have to be caught in both builds, otherwise the browser
    // navigates away from the app instead of opening the linked video,
    // channel, playlist or hashtag in it
    document.addEventListener('click', handleClick)
    document.addEventListener('auxclick', handleAuxClick)

    if (process.env.IS_ELECTRON) {
      store.dispatch('setupListenersToSyncWindows')
      removeOpenUrlListener = enableOpenUrl()
      store.dispatch('getExternalPlayerCmdArgumentsData')
      removeReloadRequestListener = window.ftElectron.tabs.onRequestReload(prepareAndReloadTab)
      removeConfirmMultipleTabsActionListener = window.ftElectron.tabs
        .onConfirmMultipleAction(handleConfirmMultipleTabsActionRequest)
    } else if (isCapacitor) {
      removeCapacitorIntegrationListeners = await enableCapacitorIntegrations()
    }

    await syncDataReady
    store.dispatch('initializeSyncServer').catch(error => {
      console.error('Initial sync server sync failed', error)
    })

    dataReady.value = true

    if (isCapacitor) {
      removeAndroidSubscriptionRefreshCancelledListener =
        await addAndroidSubscriptionRefreshCancelledListener(requestSubscriptionRefreshCancellation)
    }

    await nextTick()
    if (showAutoSyncNotice) {
      showAutoSyncNoticeOnce(release => {
        const dismissNotice = () => {
          dismissAutoSyncNotice()
          release()
        }
        showToast({
          message: t('Settings.Sync Settings.Previous Auto Sync Notice'),
          time: Infinity,
          dismissible: false,
          icon: ['fas', 'sync'],
          verticalButtons: true,
          buttons: [{
            label: t('Dismiss'),
            icon: ['fas', 'xmark'],
            action: dismissNotice,
          }, {
            label: t('Settings.Sync Settings.Enable Automatic Sync'),
            icon: ['fas', 'sync'],
            primary: true,
            action: async () => {
              try {
                await store.dispatch('setSyncServerAutoSync', true)
                dismissNotice()
              } catch (error) {
                showToast({ message: error.message })
              } finally {
                release()
              }
            },
          }],
        })
      })
    }
    scheduleUtilityRoutePreload()
    if (isCapacitor) {
      capacitorPullToRefreshSetup = initializeCapacitorPullToRefresh()
        .catch(error => console.error('Failed to initialize pull to refresh', error))
    }
    if (isElectron && tutorialPending) {
      try {
        await window.ftElectron.tabs.setShortcutsBlocked(true)
      } catch (error) {
        console.error('Failed to block tab shortcuts for tutorial', error)
      }
    }
    showTutorial.value = tutorialPending
    initializeManagedExternalSoftware().catch(error => console.error('Failed to initialize managed external software', error))

    setTimeout(() => {
      checkForNewUpdates()
    }, 500)
  })

  await router.isReady()

  if (isElectron) {
    const activeTab = store.getters.getActiveTab
    if (activeTab?.route.path === '/') {
      await navigation.replace(activeTab.id, { path: landingPage.value })
    }
  } else if (route.path === '/') {
    await router.replace({ path: landingPage.value })
  }

  setWindowTitle()

  document.addEventListener('keydown', handleKeyboardShortcuts)
  window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, openCommandPalette)
  window.addEventListener(OPEN_TAB_ORGANIZER_EVENT, openTabOrganizer)
  if (isCapacitor) {
    window.addEventListener('opentubex:android-pip', handleAndroidPictureInPictureChange)
    window.addEventListener('opentubex:hardware-keyboard', handleHardwareKeyboardChange)
    document.addEventListener('contextmenu', handleMobileLinkContextMenu, true)
    hardwareKeyboardAttached.value = await getAndroidHardwareKeyboardState()
  }
  document.addEventListener('keyup', handleKeyboardShortcutKeyup)
  document.addEventListener('mousedown', handleMouseDown)
  document.addEventListener('dragstart', handleDragStart)
  window.addEventListener('blur', cancelTabSwitcher)
  window.addEventListener('online', refreshOverdueSubscriptionFeeds)
  window.addEventListener('storage', handleSubscriptionAutoRefreshStorage)
  window.addEventListener(SUBSCRIPTION_REFRESH_CANCELLED_EVENT, handleSubscriptionRefreshCancelled)
  window.addEventListener(SUBSCRIPTION_REFRESH_COMPLETED_EVENT, handleSubscriptionRefreshCompleted)
  window.addEventListener(SUBSCRIPTION_REFRESH_FINISHED_EVENT, handleSubscriptionRefreshFinished)
  window.addEventListener(SUBSCRIPTION_REFRESH_PROGRESS_EVENT, handleSubscriptionRefreshProgress)
  window.addEventListener(SUBSCRIPTION_REFRESH_STARTED_EVENT, handleSubscriptionRefreshStarted)
  document.addEventListener('visibilitychange', handleSubscriptionAutoRefreshVisibilityChange)
  if (process.env.IS_ELECTRON) {
    removeOpenTabOrganizerListener = window.ftElectron.tabs.onOpenOrganizer(openTabOrganizer)
    removeSubscriptionAutoRefreshStateChangedListener = window.ftElectron.subscriptionAutoRefresh.onStateChanged(
      applySubscriptionAutoRefreshState
    )
    removeSubscriptionAutoRefreshCancelListener = window.ftElectron.subscriptionAutoRefresh.onCancelRequested(
      cancelSubscriptionRefresh
    )
    synchronizeSubscriptionRefreshInProgress()
    removeSubscriptionAutoRefreshActiveChangedListener = window.ftElectron.tabs.onActiveChanged((isActive) => {
      if (isActive) {
        synchronizeSubscriptionRefreshInProgress()
        refreshOverdueSubscriptionFeeds()
      }
    })
  } else {
    synchronizeSubscriptionRefreshInProgress()
  }
})

onBeforeUnmount(() => {
  if (mobileLinkActionsLocked) {
    store.commit('removeOpenPrompt', mobileLinkActionsPromptId)
    unlockBodyScroll()
    mobileLinkActionsLocked = false
  }
  tabletTabStripQuery.removeEventListener('change', handleTabletTabStripChange)
  capacitorTabService?.dispose()
  removeCapacitorTabPreviews?.()
  document.documentElement.classList.remove('hideOutlines')
  removeGamepadNavigation()
  removeCustomThemeListener()
  cancelUtilityRoutePreload()
  systemColorScheme.removeEventListener('change', handleSystemColorSchemeChange)
  if (isElectron) {
    window.ftElectron.tabs.setPreviewCapturePaused(false)
    window.ftElectron.tabs.setShortcutsBlocked(false).catch(() => {})
  }
  cancelWatchSideNavTransitionReset()
  clearSubscriptionFeedAutoRefreshTimer()
  clearInterval(historyCleanupTimer)
  store.dispatch('stopSyncServerAutoSync')
  document.removeEventListener('keydown', handleKeyboardShortcuts)
  window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, openCommandPalette)
  window.removeEventListener(OPEN_TAB_ORGANIZER_EVENT, openTabOrganizer)
  window.removeEventListener('opentubex:android-pip', handleAndroidPictureInPictureChange)
  window.removeEventListener('opentubex:hardware-keyboard', handleHardwareKeyboardChange)
  document.removeEventListener('contextmenu', handleMobileLinkContextMenu, true)
  document.removeEventListener('keyup', handleKeyboardShortcutKeyup)
  document.removeEventListener('mousedown', handleMouseDown)
  document.removeEventListener('dragstart', handleDragStart)
  document.removeEventListener('click', handleClick)
  document.removeEventListener('auxclick', handleAuxClick)
  window.removeEventListener('blur', cancelTabSwitcher)
  window.removeEventListener('online', refreshOverdueSubscriptionFeeds)
  window.removeEventListener('storage', handleSubscriptionAutoRefreshStorage)
  window.removeEventListener(MANAGED_TOOLS_UPDATE_PREVIEW_EVENT, previewManagedExternalSoftwareUpdatePrompt)
  window.removeEventListener(SUBSCRIPTION_REFRESH_CANCELLED_EVENT, handleSubscriptionRefreshCancelled)
  window.removeEventListener(SUBSCRIPTION_REFRESH_COMPLETED_EVENT, handleSubscriptionRefreshCompleted)
  window.removeEventListener(SUBSCRIPTION_REFRESH_FINISHED_EVENT, handleSubscriptionRefreshFinished)
  window.removeEventListener(SUBSCRIPTION_REFRESH_PROGRESS_EVENT, handleSubscriptionRefreshProgress)
  window.removeEventListener(SUBSCRIPTION_REFRESH_STARTED_EVENT, handleSubscriptionRefreshStarted)
  document.removeEventListener('visibilitychange', handleSubscriptionAutoRefreshVisibilityChange)
  removeSubscriptionAutoRefreshActiveChangedListener?.()
  removeSubscriptionAutoRefreshCancelListener?.()
  removeSubscriptionAutoRefreshStateChangedListener?.()
  removeTabsStateListener?.()
  removeReloadRequestListener?.()
  removeConfirmMultipleTabsActionListener?.()
  removeOpenUrlListener?.()
  removeCapacitorIntegrationListeners?.()
  capacitorPullToRefreshSetup?.then(remove => remove?.())
  removeYtDlpBinaryUpdatedListener?.()
  removeAndroidYtDlpSettingsListener?.()
  removeOpenTabOrganizerListener?.()
  removeAndroidSubscriptionRefreshCancelledListener?.()
})

watch([activeTabId, selectionRevision], ([tabId, revision]) => {
  if (isElectron && tabId) {
    navigation.requestPresentation(tabId, revision)
  }
}, { immediate: true })

watch(presentedTabId, async (tabId, previousTabId) => {
  if (!isElectron || tabId === previousTabId) {
    return
  }

  if (previousTabId) {
    findbarStateByTabId.set(previousTabId, {
      visible: findbarVisible.value,
      query: findbarQuery.value,
      matchIndex: Math.max(0, findbarMatchIndex.value - 1)
    })
  }

  clearFindbarHighlights()
  const state = findbarStateByTabId.get(tabId) ?? {
    visible: false,
    query: '',
    matchIndex: 0
  }
  findbarVisible.value = state.visible
  findbarQuery.value = state.query
  findbarMatchIndex.value = 0
  findbarMatchCount.value = 0

  if (state.visible && state.query.trim().length > 0) {
    await nextTick()
    highlightFindbarMatches(state.query.trim())
    selectFindbarMatch(state.matchIndex)
  }
})

watch(historyRetentionDays, scheduleHistoryCleanup)

function scheduleHistoryCleanup(days) {
  clearInterval(historyCleanupTimer)
  historyCleanupTimer = null

  const parsedDays = Number(days)
  if (!Number.isInteger(parsedDays) || parsedDays < 1) {
    return
  }

  historyCleanupTimer = setInterval(() => {
    store.dispatch('removeHistoryOlderThan', parsedDays)
  }, HISTORY_CLEANUP_INTERVAL)
}

watch([dataReady, activeSubscriptionProfileId], ([ready, profileId]) => {
  clearSubscriptionFeedAutoRefreshTimer()
  if (ready && profileId) {
    migrateLegacySubscriptionAutoRefreshDeadlines()
    synchronizeSubscriptionAutoRefreshProfile(profileId)
  }
})

watch([subscriptionFeedAutoRefreshInterval, hideSubscriptionsVideos], () => {
  resetSubscriptionTabAutoRefreshForAllProfiles('videos')
})

watch([subscriptionShortsAutoRefreshInterval, hideSubscriptionsShorts], () => {
  resetSubscriptionTabAutoRefreshForAllProfiles('shorts')
})

watch([subscriptionLiveAutoRefreshInterval, hideSubscriptionsLive], () => {
  resetSubscriptionTabAutoRefreshForAllProfiles('live')
})

watch([subscriptionPostsAutoRefreshInterval, hideSubscriptionsPosts], () => {
  resetSubscriptionTabAutoRefreshForAllProfiles('posts')
})

const androidSubscriptionRefreshConfiguration = computed(() => {
  if (!isCapacitor || !dataReady.value) return null

  return createAndroidSubscriptionRefreshConfiguration({
    profiles: store.getters.getProfileList,
    automaticDownloadRules: store.getters.getEnableDownloads ? parseAutomaticDownloadRules(store.getters.getYtDlpAutomaticDownloadRules) : {},
    closedAppRefreshEnabled: enableClosedAppSubscriptionRefresh.value,
    intervals: {
      videos: subscriptionFeedAutoRefreshInterval.value,
      shorts: subscriptionShortsAutoRefreshInterval.value,
      live: subscriptionLiveAutoRefreshInterval.value,
      posts: subscriptionPostsAutoRefreshInterval.value
    },
    hiddenFeedTypes: [
      ...(hideSubscriptionsVideos.value ? ['videos'] : []),
      ...(hideSubscriptionsShorts.value ? ['shorts'] : []),
      ...(hideSubscriptionsLive.value ? ['live'] : []),
      ...(hideSubscriptionsPosts.value ? ['posts'] : [])
    ],
    instanceUrl: store.getters.getCurrentInvidiousInstanceUrl,
    authorization: store.getters.getCurrentInvidiousInstanceAuthorization,
    titles: Object.fromEntries(subscriptionAutoRefreshTabs.map(tab => [
      tab,
      getSubscriptionRefreshNotificationTitle(tab)
    ])),
    cancelLabel: t('Feed.Cancel Refresh')
  })
})

watch(androidSubscriptionRefreshConfiguration, async configuration => {
  if (configuration === null) return
  try {
    await configureAndroidSubscriptionRefresh(configuration)
    if (Object.values(configuration.intervals).some(interval => interval > 0)) {
      const denied = await requestAndroidSubscriptionRefreshNotificationPermission()
      if (denied) showAndroidSubscriptionRefreshNotificationWarning()
    }
  } catch (error) {
    console.error('Failed to configure closed-app subscription refreshes', error)
  }
}, { deep: true })

watch([dataReady, subscriptionCacheReady], ([ready, cacheReady]) => {
  if (isCapacitor && ready && cacheReady) {
    reconcileAndroidSubscriptionRefreshResults()
  }
})

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 */
function resetSubscriptionTabAutoRefreshForAllProfiles(tab) {
  if (!dataReady.value) {
    return
  }

  const interval = parseInt(getSubscriptionAutoRefreshInterval(tab).value, 10)
  const enabled = isSubscriptionTabAutoRefreshEnabled(tab)
  const timestamp = enabled ? Date.now() + interval : null

  for (const profile of store.getters.getProfileList) {
    setStoredSubscriptionTabNextAutoRefreshTimestamp(profile._id, tab, timestamp)
  }

  const profileId = activeSubscriptionProfileId.value
  if (profileId) {
    scheduleSubscriptionTabAutoRefresh(tab, profileId, timestamp)
  }
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 * @param {string} profileId
 * @param {number | null} [scheduledTimestamp]
 */
function scheduleSubscriptionTabAutoRefresh(tab, profileId, scheduledTimestamp) {
  clearSubscriptionTabAutoRefreshTimer(tab)

  if (!dataReady.value || profileId !== activeSubscriptionProfileId.value) {
    return
  }

  if (!isSubscriptionTabAutoRefreshEnabled(tab)) {
    setSubscriptionTabNextAutoRefreshTimestamp(tab, profileId, null)
    return
  }

  const interval = parseInt(getSubscriptionAutoRefreshInterval(tab).value, 10)
  const now = Date.now()
  const storedTimestamp = scheduledTimestamp === undefined
    ? getStoredSubscriptionTabNextAutoRefreshTimestamp(profileId, tab)
    : scheduledTimestamp
  const nextAutoRefreshTimestamp = storedTimestamp ?? now + interval

  setSubscriptionTabNextAutoRefreshTimestamp(tab, profileId, nextAutoRefreshTimestamp)
  subscriptionAutoRefreshTimers[tab] = setTimeout(() => {
    subscriptionAutoRefreshTimers[tab] = null
    enqueueSubscriptionAutoRefresh(tab, profileId)
  }, Math.max(0, nextAutoRefreshTimestamp - now))
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 * @param {string} profileId
 */
function enqueueSubscriptionAutoRefresh(tab, profileId) {
  const key = `${profileId}:${tab}`
  if (pendingSubscriptionAutoRefreshKeys.has(key)) {
    return
  }

  pendingSubscriptionAutoRefreshKeys.add(key)
  pendingSubscriptionAutoRefreshes.push({ tab, profileId, key })
  processPendingSubscriptionAutoRefreshes()
}

async function processPendingSubscriptionAutoRefreshes() {
  if (processingSubscriptionAutoRefreshes) {
    return
  }

  processingSubscriptionAutoRefreshes = true
  try {
    while (pendingSubscriptionAutoRefreshes.length > 0) {
      const { tab, profileId, key } = pendingSubscriptionAutoRefreshes.shift()

      try {
        if (
          profileId !== activeSubscriptionProfileId.value ||
          !isSubscriptionTabAutoRefreshEnabled(tab) ||
          navigator.onLine === false ||
          isAppHidden()
        ) {
          continue
        }

        if (process.env.IS_ELECTRON && !await window.ftElectron.tabs.isActive()) {
          continue
        }

        const storedTimestamp = getStoredSubscriptionTabNextAutoRefreshTimestamp(profileId, tab)
        if (storedTimestamp !== null && storedTimestamp > Date.now()) {
          scheduleSubscriptionTabAutoRefresh(tab, profileId, storedTimestamp)
          continue
        }

        cancelledSubscriptionAutoRefreshKeys.delete(key)
        const result = await getSubscriptionTabRefreshHandler(tab)({
          t,
          showStartToast: true
        })
        const wasCancelled = cancelledSubscriptionAutoRefreshKeys.delete(key)

        if (result === null) {
          if (wasCancelled) {
            scheduleSubscriptionTabAutoRefresh(tab, profileId, Date.now() + getSubscriptionTabAutoRefreshInterval(tab))
          } else {
            scheduleSubscriptionTabAutoRefreshLockRetry(tab, profileId)
          }
        }
      } catch (error) {
        cancelledSubscriptionAutoRefreshKeys.delete(key)
        console.error(`Failed to auto refresh subscription ${tab}`, error)
        scheduleSubscriptionTabAutoRefreshRetry(
          tab,
          profileId,
          SUBSCRIPTION_AUTO_REFRESH_FAILURE_RETRY_INTERVAL
        )
      } finally {
        pendingSubscriptionAutoRefreshKeys.delete(key)
      }
    }
  } finally {
    processingSubscriptionAutoRefreshes = false
  }
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 * @param {string} profileId
 */
function scheduleSubscriptionTabAutoRefreshLockRetry(tab, profileId) {
  scheduleSubscriptionTabAutoRefreshRetry(tab, profileId, SUBSCRIPTION_AUTO_REFRESH_LOCK_RETRY_INTERVAL)
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 * @param {string} profileId
 * @param {number} delay
 */
function scheduleSubscriptionTabAutoRefreshRetry(tab, profileId, delay) {
  if (profileId !== activeSubscriptionProfileId.value) {
    return
  }

  clearSubscriptionTabAutoRefreshTimer(tab)
  subscriptionAutoRefreshTimers[tab] = setTimeout(() => {
    subscriptionAutoRefreshTimers[tab] = null
    enqueueSubscriptionAutoRefresh(tab, profileId)
  }, delay)
}

function refreshOverdueSubscriptionFeeds() {
  const profileId = activeSubscriptionProfileId.value
  if (!dataReady.value || !profileId) {
    return
  }

  for (const tab of subscriptionAutoRefreshTabs) {
    const timestamp = getStoredSubscriptionTabNextAutoRefreshTimestamp(profileId, tab)
    if (timestamp !== null && timestamp <= Date.now() && isSubscriptionTabAutoRefreshEnabled(tab)) {
      enqueueSubscriptionAutoRefresh(tab, profileId)
    } else {
      scheduleSubscriptionTabAutoRefresh(tab, profileId, timestamp)
    }
  }
}

function handleSubscriptionAutoRefreshVisibilityChange() {
  if (!isAppHidden()) {
    synchronizeSubscriptionRefreshInProgress()
    if (isCapacitor && subscriptionCacheReady.value) {
      reconcileAndroidSubscriptionRefreshResults()
    }
    refreshOverdueSubscriptionFeeds()
  }
}

async function synchronizeSubscriptionRefreshInProgress() {
  try {
    let state
    if (process.env.IS_ELECTRON) {
      state = await window.ftElectron.subscriptionAutoRefresh.isInProgress()
    } else if (navigator.locks) {
      const { held } = await navigator.locks.query()
      const inProgress = held.some(lock => lock.name === SUBSCRIPTION_REFRESH_LOCK_NAME)
      if (!inProgress) {
        localStorage.removeItem(SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY)
      }
      const progressState = inProgress ? getStoredSubscriptionRefreshProgressState() : null
      state = {
        inProgress,
        percentage: progressState?.percentage ?? 0,
        tab: progressState?.tab ?? null
      }
    } else {
      const progressState = getStoredSubscriptionRefreshProgressState()
      state = {
        inProgress: progressState !== null,
        percentage: progressState?.percentage ?? 0,
        tab: progressState?.tab ?? null
      }
    }

    applySubscriptionAutoRefreshState(state)
  } catch {
    // Live start/finish events still keep the common path synchronized.
  }
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 */
function getSubscriptionAutoRefreshInterval(tab) {
  switch (tab) {
    case 'shorts':
      return subscriptionShortsAutoRefreshInterval
    case 'live':
      return subscriptionLiveAutoRefreshInterval
    case 'posts':
      return subscriptionPostsAutoRefreshInterval
    default:
      return subscriptionFeedAutoRefreshInterval
  }
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 */
function getSubscriptionTabRefreshHandler(tab) {
  switch (tab) {
    case 'shorts':
      return refreshSubscriptionShortsFromRemote
    case 'live':
      return refreshSubscriptionLiveFromRemote
    case 'posts':
      return refreshSubscriptionPostsFromRemote
    default:
      return refreshSubscriptionVideosFromRemote
  }
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 */
function getSubscriptionTabAutoRefreshInterval(tab) {
  return parseInt(getSubscriptionAutoRefreshInterval(tab).value, 10)
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 */
function isSubscriptionTabAutoRefreshEnabled(tab) {
  const interval = getSubscriptionTabAutoRefreshInterval(tab)

  return (
    dataReady.value &&
    !isSubscriptionTabHidden(tab) &&
    !Number.isNaN(interval) &&
    interval > 0
  )
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 */
function isSubscriptionTabHidden(tab) {
  switch (tab) {
    case 'shorts':
      return hideSubscriptionsShorts.value
    case 'live':
      return hideSubscriptionsLive.value
    case 'posts':
      return hideSubscriptionsPosts.value
    default:
      return hideSubscriptionsVideos.value
  }
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 * @param {string} profileId
 * @param {number | null} timestamp
 */
function setSubscriptionTabNextAutoRefreshTimestamp(tab, profileId, timestamp) {
  setStoredSubscriptionTabNextAutoRefreshTimestamp(profileId, tab, timestamp)

  if (profileId === activeSubscriptionProfileId.value) {
    commitSubscriptionTabNextAutoRefreshTimestamp(tab, timestamp)
  }
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 * @param {number | null} timestamp
 */
function commitSubscriptionTabNextAutoRefreshTimestamp(tab, timestamp) {
  switch (tab) {
    case 'shorts':
      store.commit('setSubscriptionShortsNextAutoRefreshTimestamp', timestamp)
      break
    case 'live':
      store.commit('setSubscriptionLiveNextAutoRefreshTimestamp', timestamp)
      break
    case 'posts':
      store.commit('setSubscriptionPostsNextAutoRefreshTimestamp', timestamp)
      break
    default:
      store.commit('setSubscriptionFeedNextAutoRefreshTimestamp', timestamp)
  }
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 * @param {number | null} timestamp
 */
function commitSubscriptionTabLastRefreshTimestamp(tab, timestamp) {
  switch (tab) {
    case 'shorts':
      store.commit('setSubscriptionShortsLastRefreshTimestamp', timestamp)
      break
    case 'live':
      store.commit('setSubscriptionLiveLastRefreshTimestamp', timestamp)
      break
    case 'posts':
      store.commit('setSubscriptionPostsLastRefreshTimestamp', timestamp)
      break
    default:
      store.commit('setSubscriptionFeedLastRefreshTimestamp', timestamp)
  }
}

/**
 * @param {string} prefix
 * @param {string} profileId
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 */
function getSubscriptionAutoRefreshStorageKey(prefix, profileId, tab) {
  return `${prefix}${encodeURIComponent(profileId)}/${tab}`
}

/**
 * @param {string} key
 */
function getStoredSubscriptionAutoRefreshTimestamp(key) {
  try {
    const timestamp = Number(localStorage.getItem(key))
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null
  } catch {
    return null
  }
}

/**
 * @param {string} key
 * @param {number | null} timestamp
 */
function setStoredSubscriptionAutoRefreshTimestamp(key, timestamp) {
  try {
    if (timestamp === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, String(timestamp))
    }
  } catch {
    // Auto refresh still works for the current session when storage is unavailable.
  }
}

/**
 * @param {string} profileId
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 */
function getStoredSubscriptionTabNextAutoRefreshTimestamp(profileId, tab) {
  const key = getSubscriptionAutoRefreshStorageKey(
    SUBSCRIPTION_AUTO_REFRESH_DEADLINE_STORAGE_KEY_PREFIX,
    profileId,
    tab
  )
  const timestamp = getStoredSubscriptionAutoRefreshTimestamp(key)
  return timestamp
}

function migrateLegacySubscriptionAutoRefreshDeadlines() {
  for (const tab of subscriptionAutoRefreshTabs) {
    const legacyKey = `${LEGACY_SUBSCRIPTION_AUTO_REFRESH_STORAGE_KEY_PREFIX}${tab}`
    const legacyTimestamp = getStoredSubscriptionAutoRefreshTimestamp(legacyKey)
    if (legacyTimestamp === null) {
      continue
    }

    for (const profile of store.getters.getProfileList) {
      const profileKey = getSubscriptionAutoRefreshStorageKey(
        SUBSCRIPTION_AUTO_REFRESH_DEADLINE_STORAGE_KEY_PREFIX,
        profile._id,
        tab
      )
      if (getStoredSubscriptionAutoRefreshTimestamp(profileKey) === null) {
        setStoredSubscriptionAutoRefreshTimestamp(profileKey, legacyTimestamp)
      }
    }

    setStoredSubscriptionAutoRefreshTimestamp(legacyKey, null)
  }
}

/**
 * @param {string} profileId
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 * @param {number | null} timestamp
 */
function setStoredSubscriptionTabNextAutoRefreshTimestamp(profileId, tab, timestamp) {
  setStoredSubscriptionAutoRefreshTimestamp(
    getSubscriptionAutoRefreshStorageKey(
      SUBSCRIPTION_AUTO_REFRESH_DEADLINE_STORAGE_KEY_PREFIX,
      profileId,
      tab
    ),
    timestamp
  )
}

/**
 * @param {string} profileId
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 */
function getStoredSubscriptionTabLastRefreshTimestamp(profileId, tab) {
  return getStoredSubscriptionAutoRefreshTimestamp(
    getSubscriptionAutoRefreshStorageKey(
      SUBSCRIPTION_AUTO_REFRESH_COMPLETION_STORAGE_KEY_PREFIX,
      profileId,
      tab
    )
  )
}

/**
 * @param {string} profileId
 */
function synchronizeSubscriptionAutoRefreshProfile(profileId) {
  for (const tab of subscriptionAutoRefreshTabs) {
    commitSubscriptionTabLastRefreshTimestamp(
      tab,
      getStoredSubscriptionTabLastRefreshTimestamp(profileId, tab)
    )
    scheduleSubscriptionTabAutoRefresh(tab, profileId)
  }
}

/**
 * @param {CustomEvent<{tab: 'videos' | 'shorts' | 'live' | 'posts', profileId: string}>} event
 */
function handleSubscriptionRefreshCancelled(event) {
  const { tab, profileId } = event.detail
  if (
    profileId !== activeSubscriptionProfileId.value ||
    !subscriptionAutoRefreshTabs.includes(tab)
  ) {
    return
  }

  cancelledSubscriptionAutoRefreshKeys.add(`${profileId}:${tab}`)
}

/**
 * @param {CustomEvent<{tab: 'videos' | 'shorts' | 'live' | 'posts', profileId: string, timestamp: number}>} event
 */
function handleSubscriptionRefreshCompleted(event) {
  const { tab, profileId, timestamp } = event.detail
  if (
    !subscriptionAutoRefreshTabs.includes(tab) ||
    typeof profileId !== 'string' ||
    !Number.isFinite(timestamp) ||
    timestamp < getStoredSubscriptionTabLastRefreshTimestamp(profileId, tab)
  ) {
    return
  }

  setStoredSubscriptionAutoRefreshTimestamp(
    getSubscriptionAutoRefreshStorageKey(
      SUBSCRIPTION_AUTO_REFRESH_COMPLETION_STORAGE_KEY_PREFIX,
      profileId,
      tab
    ),
    timestamp
  )

  const interval = parseInt(getSubscriptionAutoRefreshInterval(tab).value, 10)
  const nextTimestamp = isSubscriptionTabAutoRefreshEnabled(tab) ? timestamp + interval : null
  setStoredSubscriptionTabNextAutoRefreshTimestamp(profileId, tab, nextTimestamp)

  if (profileId === activeSubscriptionProfileId.value) {
    commitSubscriptionTabLastRefreshTimestamp(tab, timestamp)
    scheduleSubscriptionTabAutoRefresh(tab, profileId, nextTimestamp)
  }
}

/**
 * @param {CustomEvent<{tab: string, profileId: string, refreshId: number}>} event
 */
async function handleSubscriptionRefreshStarted(event) {
  const isCurrentStart = subscriptionRefreshStartGuard.begin()
  if (isCapacitor) {
    const { acquired, notificationsDenied } = await startAndroidSubscriptionRefresh(
      event.detail.refreshId,
      getSubscriptionRefreshNotificationTitle(event.detail.tab),
      t('Feed.Cancel Refresh')
    )
    if (!isCurrentStart()) return
    if (notificationsDenied) showAndroidSubscriptionRefreshNotificationWarning()
    if (!acquired) {
      cancelSubscriptionRefresh()
    }
  }
  if (!process.env.IS_ELECTRON) {
    try {
      localStorage.setItem(SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY, JSON.stringify({
        ...event.detail,
        percentage: 0
      }))
    } catch {
      // The owner still has its renderer-local progress state.
    }
  }
  applySubscriptionAutoRefreshState({
    inProgress: true,
    percentage: 0,
    tab: event.detail.tab
  })
}

const subscriptionRefreshStartGuard = createSubscriptionRefreshStartGuard()
let androidSubscriptionRefreshNotificationWarningShown = false

function showAndroidSubscriptionRefreshNotificationWarning() {
  if (androidSubscriptionRefreshNotificationWarningShown) return
  androidSubscriptionRefreshNotificationWarningShown = true
  showToast({
    message: t('Video.Notification unavailable'),
    icon: ['fas', 'triangle-exclamation'],
    buttons: [{
      label: t('Settings.Settings'),
      primary: true,
      action: () => openNotificationSettings()
    }]
  })
}

/**
 * @param {CustomEvent<{
 *   percentage: number,
 *   ownerTabId?: string | null,
 *   refreshId?: number
 * }>} event
 */
function handleSubscriptionRefreshProgress(event) {
  const percentage = normalizeSubscriptionRefreshProgress(event.detail.percentage)
  store.commit('setSubscriptionFeedRefreshProgress', percentage)

  if (isCapacitor) {
    updateAndroidSubscriptionRefresh(event.detail.refreshId, percentage)
  }

  if (process.env.IS_ELECTRON) {
    window.ftElectron.subscriptionAutoRefresh.setProgress(
      event.detail.ownerTabId ?? store.getters.getActiveTabId,
      percentage
    )
    return
  }

  try {
    const progressState = getStoredSubscriptionRefreshProgressState() ?? {}
    localStorage.setItem(SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY, JSON.stringify({
      ...progressState,
      percentage
    }))
  } catch {
    // The owner still has its renderer-local progress state.
  }
}

/**
 * @param {CustomEvent<{refreshId: number}>} event
 */
function handleSubscriptionRefreshFinished(event) {
  subscriptionRefreshStartGuard.finish()
  if (isCapacitor) {
    finishAndroidSubscriptionRefresh(event.detail.refreshId)
  }
  if (!process.env.IS_ELECTRON) {
    try {
      localStorage.removeItem(SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY)
    } catch {
      // The owner still clears its renderer-local progress state.
    }
  }
  applySubscriptionAutoRefreshState({ inProgress: false, percentage: 0 })
}

function getSubscriptionRefreshNotificationTitle(tab) {
  switch (tab) {
    case 'shorts':
      return t('Subscriptions.Refreshing Subscription Shorts')
    case 'live':
      return t('Subscriptions.Refreshing Subscription Live Streams')
    case 'posts':
      return t('Subscriptions.Refreshing Subscription Posts')
    default:
      return t('Subscriptions.Refreshing Subscription Videos')
  }
}

let reconcilingAndroidSubscriptionRefreshResults = false

async function reconcileAndroidSubscriptionRefreshResults() {
  if (reconcilingAndroidSubscriptionRefreshResults) return
  reconcilingAndroidSubscriptionRefreshResults = true

  try {
    while (true) {
      const result = await getNextAndroidSubscriptionRefreshResult()
      if (result === null) return

      if (
        typeof result.id !== 'string' ||
        typeof result.profileId !== 'string' ||
        !subscriptionAutoRefreshTabs.includes(result.feedType)
      ) {
        await acknowledgeAndroidSubscriptionRefreshResult(result.id)
        continue
      }

      if (result.kind === 'channel') {
        await processAndroidSubscriptionRefreshChannelResult(
          result,
          reconcileAndroidSubscriptionRefreshChannelResult,
          acknowledgeAndroidSubscriptionRefreshResult
        )
        continue
      } else if (result.kind === 'completion' && store.getters.profileById(result.profileId)) {
        handleSubscriptionRefreshCompleted({
          detail: {
            tab: result.feedType,
            profileId: result.profileId,
            timestamp: Number(result.timestamp) || Date.now()
          }
        })
      } else if (
        result.kind === 'failure' &&
        result.diagnostic &&
        store.getters.profileById(result.profileId)
      ) {
        const diagnostic = formatRequestDiagnostic(result.diagnostic)
        console.error(`Closed-app subscription refresh request failed: ${diagnostic}`)
        showApiErrorToast(t('Invidious API Error (Click to copy)'), diagnostic)
      }

      await acknowledgeAndroidSubscriptionRefreshResult(result.id)
    }
  } catch (error) {
    console.error('Failed to reconcile closed-app subscription refresh data', error)
  } finally {
    reconcilingAndroidSubscriptionRefreshResults = false
  }
}

async function reconcileAndroidSubscriptionRefreshChannelResult(result) {
  if (
    typeof result.channelId !== 'string' ||
    !store.getters.getSubscribedChannelIdSet.has(result.channelId)
  ) {
    return
  }

  const feedType = result.feedType
  const timestamp = new Date(Number(result.timestamp) || Date.now())
  const entries = normalizeAndroidSubscriptionRefreshPayload(
    normalizeInvidiousSubscriptionFeed,
    feedType,
    result.payload,
    result.channelId
  )
  const config = getAndroidSubscriptionCacheConfig(feedType)
  const previousCache = config.getCache()[result.channelId]
  if (previousCache?.timestamp > timestamp) return
  const reconciledEntries = reconcileFetchedSubscriptionEntries(
    entries,
    previousCache?.[config.entriesKey],
    config.idKey,
    previousCache?.timestamp,
    feedType === 'posts' ? undefined : store.getters.getHistoryCacheById
  )

  const applied = await store.dispatch(config.action, {
    channelId: result.channelId,
    [config.entriesKey]: reconciledEntries,
    timestamp
  })
  if (applied === false) return

  const committedTimestamp = config.getCache()[result.channelId]?.timestamp
  if (!(committedTimestamp instanceof Date) || committedTimestamp.getTime() < timestamp.getTime()) {
    throw new Error(`The ${feedType} cache write did not complete`)
  }
}

function getAndroidSubscriptionCacheConfig(feedType) {
  switch (feedType) {
    case 'shorts':
      return {
        action: 'updateSubscriptionShortsCacheByChannel',
        entriesKey: 'videos',
        idKey: 'videoId',
        getCache: () => store.getters.getShortsCache
      }
    case 'live':
      return {
        action: 'updateSubscriptionLiveCacheByChannel',
        entriesKey: 'videos',
        idKey: 'videoId',
        getCache: () => store.getters.getLiveCache
      }
    case 'posts':
      return {
        action: 'updateSubscriptionPostsCacheByChannel',
        entriesKey: 'posts',
        idKey: 'postId',
        getCache: () => store.getters.getPostsCache
      }
    default:
      return {
        action: 'updateSubscriptionVideosCacheByChannel',
        entriesKey: 'videos',
        idKey: 'videoId',
        getCache: () => store.getters.getVideoCache
      }
  }
}

/**
 * @param {StorageEvent} event
 */
function handleSubscriptionAutoRefreshStorage(event) {
  if (!process.env.IS_ELECTRON && event.key === SUBSCRIPTION_REFRESH_CANCEL_STORAGE_KEY) {
    if (event.newValue !== null) {
      cancelSubscriptionRefresh()
    }
    return
  }

  if (!process.env.IS_ELECTRON && event.key === SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY) {
    const state = getSubscriptionRefreshProgressState(event.newValue)
    applySubscriptionAutoRefreshState({
      inProgress: state !== null,
      percentage: state?.percentage ?? 0,
      tab: state?.tab ?? null
    })
    return
  }

  const deadline = parseSubscriptionAutoRefreshStorageKey(
    event.key,
    SUBSCRIPTION_AUTO_REFRESH_DEADLINE_STORAGE_KEY_PREFIX
  )
  if (deadline && deadline.profileId === activeSubscriptionProfileId.value) {
    const timestamp = Number(event.newValue)
    if (event.newValue === null || !Number.isFinite(timestamp) || timestamp <= 0) {
      clearSubscriptionTabAutoRefreshTimer(deadline.tab)
      commitSubscriptionTabNextAutoRefreshTimestamp(deadline.tab, null)
    } else {
      scheduleSubscriptionTabAutoRefresh(deadline.tab, deadline.profileId, timestamp)
    }
    return
  }

  const completion = parseSubscriptionAutoRefreshStorageKey(
    event.key,
    SUBSCRIPTION_AUTO_REFRESH_COMPLETION_STORAGE_KEY_PREFIX
  )
  if (completion && completion.profileId === activeSubscriptionProfileId.value) {
    const timestamp = Number(event.newValue)
    commitSubscriptionTabLastRefreshTimestamp(
      completion.tab,
      Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null
    )
  }
}

/**
 * @param {{inProgress: boolean, percentage: number, tab?: string | null}} state
 */
function applySubscriptionAutoRefreshState(state) {
  const wasInProgress = store.getters.getSubscriptionFeedRefreshInProgress
  const previousTab = store.getters.getSubscriptionFeedRefreshTab
  const nextTab = state.inProgress ? state.tab ?? null : null
  let percentage = normalizeSubscriptionRefreshProgress(state.percentage)

  // The refresh owner updates progress locally before the main process broadcasts
  // it to every renderer. An older broadcast can therefore arrive after a newer
  // local update, so keep progress monotonic for the duration of this refresh.
  if (state.inProgress && wasInProgress && nextTab === previousTab) {
    percentage = Math.max(store.getters.getSubscriptionFeedRefreshProgress, percentage)
  }

  store.commit('setSubscriptionFeedRefreshInProgress', state.inProgress)
  store.commit('setSubscriptionFeedRefreshTab', nextTab)
  store.commit('setSubscriptionFeedRefreshProgress', percentage)
}

/**
 * @param {number} percentage
 */
function normalizeSubscriptionRefreshProgress(percentage) {
  return Number.isFinite(percentage) ? Math.min(100, Math.max(0, percentage)) : 0
}

function getStoredSubscriptionRefreshProgressState() {
  try {
    return getSubscriptionRefreshProgressState(
      localStorage.getItem(SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY)
    )
  } catch {
    return null
  }
}

/**
 * @param {string | null} value
 * @returns {{percentage: number, tab?: string} | null}
 */
function getSubscriptionRefreshProgressState(value) {
  if (value === null) {
    return null
  }

  try {
    const state = JSON.parse(value)
    return {
      ...state,
      percentage: normalizeSubscriptionRefreshProgress(state.percentage)
    }
  } catch {
    return null
  }
}

/**
 * @param {string | null} key
 * @param {string} prefix
 * @returns {{profileId: string, tab: 'videos' | 'shorts' | 'live' | 'posts'} | null}
 */
function parseSubscriptionAutoRefreshStorageKey(key, prefix) {
  if (!key?.startsWith(prefix)) {
    return null
  }

  const separatorIndex = key.lastIndexOf('/')
  const tab = key.slice(separatorIndex + 1)
  if (separatorIndex < prefix.length || !subscriptionAutoRefreshTabs.includes(tab)) {
    return null
  }

  try {
    return {
      profileId: decodeURIComponent(key.slice(prefix.length, separatorIndex)),
      tab
    }
  } catch {
    return null
  }
}

function clearSubscriptionFeedAutoRefreshTimer() {
  clearSubscriptionTabAutoRefreshTimer('videos')
  clearSubscriptionTabAutoRefreshTimer('shorts')
  clearSubscriptionTabAutoRefreshTimer('live')
  clearSubscriptionTabAutoRefreshTimer('posts')
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 */
function clearSubscriptionTabAutoRefreshTimer(tab) {
  clearTimeout(subscriptionAutoRefreshTimers[tab])
  subscriptionAutoRefreshTimers[tab] = null
}

/** @type {import('vue').ComputedRef<string>} */
const baseTheme = computed(() => store.getters.getBaseTheme)
const capacitorUiScale = isCapacitor ? createCapacitorUiScale(window, document) : null
watch(() => store.getters.getUiScale, value => capacitorUiScale?.setScale(value), { immediate: true })
onBeforeUnmount(() => capacitorUiScale?.dispose())

const appFont = computed(() => store.getters.getAppFont)
let removeCustomThemeListener = () => {}
const systemColorScheme = window.matchMedia('(prefers-color-scheme: dark)')
const systemUsesDarkTheme = ref(systemColorScheme.matches)
systemColorScheme.addEventListener('change', handleSystemColorSchemeChange)

watch(baseTheme, updateTheme)
watch(appFont, updateAppFont)
watch(() => store.getters.getSystemLightTheme, updateTheme)
watch(() => store.getters.getSystemDarkTheme, updateTheme)

/** @type {import('vue').ComputedRef<string>} */
const mainColor = computed(() => store.getters.getMainColor)

watch(mainColor, updateTheme)

/** @type {import('vue').ComputedRef<string>} */
const secColor = computed(() => store.getters.getSecColor)

watch(secColor, updateTheme)

/** @type {import('vue').ComputedRef<number>} */
const uiRoundness = computed(() => store.getters.getUiRoundness)

watch(uiRoundness, updateUiRoundness)

/** @type {import('vue').ComputedRef<number>} */
const scrollbarThumbWidth = computed(() => store.getters.getScrollbarThumbWidth)

watch(scrollbarThumbWidth, updateScrollbarThumbWidth)

/** @type {import('vue').ComputedRef<number>} */
const thumbnailSize = computed(() => store.getters.getThumbnailSize)

watch(thumbnailSize, updateThumbnailListSize)

function updateTheme() {
  const effectiveTheme = baseTheme.value === 'system'
    ? (systemUsesDarkTheme.value ? store.getters.getSystemDarkTheme : store.getters.getSystemLightTheme)
    : baseTheme.value
  const customThemes = store.getters.getCustomThemes
  const customTheme = customThemes.find(theme => `custom:${theme.id}` === effectiveTheme) ??
    (effectiveTheme === 'custom' ? customThemes[0] : null) ?? null
  applyThemeToDocument(effectiveTheme, mainColor.value, secColor.value, customTheme)
  updateSystemBarsStyle()
}

function updateSystemBarsStyle() {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('SystemBars')) return

  // Native video needs a transparent WebView; use the theme backdrop behind it.
  const bodyStyle = getComputedStyle(document.body)
  const backgroundColor = bodyStyle.getPropertyValue('--bg-color').trim() || bodyStyle.backgroundColor
  const usesDarkIcons = calculateColorLuminance(backgroundColor) === '#000000'
  Promise.all([
    setAndroidSystemBarsBackground(backgroundColor),
    SystemBars.setStyle({
      style: usesDarkIcons ? SystemBarsStyle.Light : SystemBarsStyle.Dark
    })
  ]).catch((error) => {
    console.error('Failed to update system bar style:', error)
  })
}

function updateAppFont() {
  document.body.style.setProperty(
    '--app-font-family',
    getAppFontFamily(appFont.value)
  )
}

async function sanitizeAppearanceSettings(customThemes) {
  const systemThemes = resolveSystemThemeSettings({
    systemLightTheme: store.getters.getSystemLightTheme,
    systemDarkTheme: store.getters.getSystemDarkTheme,
  }, customThemes)
  const settings = [
    ['BaseTheme', resolveBaseTheme(store.getters.getBaseTheme, 'system', customThemes)],
    ['SystemLightTheme', systemThemes.systemLightTheme],
    ['SystemDarkTheme', systemThemes.systemDarkTheme],
    ['MainColor', resolveColor(store.getters.getMainColor, 'Red')],
    ['SecColor', resolveColor(store.getters.getSecColor, 'Blue')],
  ]

  await Promise.all(settings.map(([name, value]) =>
    store.getters[`get${name}`] === value ? null : store.dispatch(`update${name}`, value)))
}

function handleSystemColorSchemeChange(event) {
  systemUsesDarkTheme.value = event.matches
  if (baseTheme.value === 'system') updateTheme()
}

function updateUiRoundness() {
  document.body.style.setProperty('--ui-roundness', String(uiRoundness.value / 100))
}

function updateScrollbarThumbWidth() {
  document.body.style.setProperty(
    '--scrollbar-thumb-width',
    `${normalizeScrollbarThumbWidth(scrollbarThumbWidth.value)}px`
  )
}

// Setting these once on the body keeps a thumbnail size change from
// re-rendering every list that shows thumbnails.
function updateThumbnailListSize() {
  for (const [property, value] of Object.entries(getThumbnailListStyles(thumbnailSize.value))) {
    document.body.style.setProperty(property, value)
  }
}

updateTheme()
updateAppFont()
updateUiRoundness()
updateScrollbarThumbWidth()
updateThumbnailListSize()

const showReleaseNotes = ref(false)
const changeLogTitle = ref('')
const updateChangelog = ref('')
const DISMISSED_UPDATE_VERSION_STORAGE_KEY = 'opentubex-dismissed-update-version'
/** @type {{ tagName: string, versionNumber: string } | null} */
let availableUpdate = null
let releaseNotesMarkdownPromise = null

function getReleaseNotesMarkdown() {
  releaseNotesMarkdownPromise ??= import('./helpers/releaseNotesMarkdown')
    .then(({ createReleaseNotesMarkdown }) => createReleaseNotesMarkdown())
  return releaseNotesMarkdownPromise
}

/** @type {import('vue').ComputedRef<boolean>} */
const checkForUpdates = computed(() => store.getters.getCheckForUpdates)

function dismissAvailableUpdate() {
  if (availableUpdate !== null) {
    sessionStorage.setItem(DISMISSED_UPDATE_VERSION_STORAGE_KEY, availableUpdate.tagName)
  }
}

function showAvailableUpdateToast() {
  const update = availableUpdate
  if (
    update === null ||
    sessionStorage.getItem(DISMISSED_UPDATE_VERSION_STORAGE_KEY) === update.tagName
  ) {
    return
  }

  showToast({
    message: t('Version {versionNumber} is now available.', {
      versionNumber: update.versionNumber
    }),
    time: Infinity,
    dismissible: false,
    icon: ['fas', 'sync'],
    verticalButtons: true,
    buttons: [
      {
        label: t('Dismiss'),
        icon: ['fas', 'xmark'],
        action: dismissAvailableUpdate
      },
      {
        label: t('See changes and update'),
        icon: ['fas', 'file-lines'],
        primary: true,
        action: () => {
          showReleaseNotes.value = true
        }
      }
    ]
  })
}

async function checkForNewUpdates() {
  if (!checkForUpdates.value) {
    return
  }

  const releasesUrl = 'https://api.github.com/repos/OpenTubeX/OpenTubeX/releases?per_page=100'

  try {
    const availableReleases = await fetchReleasePages(releasesUrl, fetch)
    const releases = findUpdateReleases(availableReleases, packageDetails.version)
    if (releases.length === 0) {
      return
    }

    const release = releases[0]
    const tagName = release.tag_name
    const versionNumber = tagName.replace('v', '').replace('-beta', '')
    if (sessionStorage.getItem(DISMISSED_UPDATE_VERSION_STORAGE_KEY) === tagName) {
      return
    }

    const changelog = formatReleaseChangelog(releases)
      // Link usernames to their GitHub profiles
      .replaceAll(/@(\S+)\b/g, '[@$1](https://github.com/$1)')
      // Shorten pull request links to #1234
      .replaceAll(/https:\/\/github\.com\/OpenTubeX\/OpenTubeX\/pull\/(\d+)/g, '[#$1]($&)')

    const releaseNotesMarkdown = await getReleaseNotesMarkdown()
    updateChangelog.value = releaseNotesMarkdown.parse(changelog)
    changeLogTitle.value = t('Update to {version}', { version: release.name ?? tagName })
    availableUpdate = { tagName, versionNumber }
    showAvailableUpdateToast()
  } catch (error) {
    console.error('errored while checking for updates', releasesUrl, error)
  }
}

function closeReleaseNotes() {
  showReleaseNotes.value = false
  showAvailableUpdateToast()
}

function openDownloadsPage() {
  dismissAvailableUpdate()
  openExternalLink('https://opentubex.org/downloads/')
  showReleaseNotes.value = false
}

/** @type {import('vue').ComputedRef<boolean>} */
const outlinesHidden = computed(() => store.getters.getOutlinesHidden)

watch(outlinesHidden, hidden => {
  document.documentElement.classList.toggle('hideOutlines', hidden)
}, { flush: 'sync', immediate: true })

const commandPaletteCommands = computed(() => createCommandPaletteRegistry({
  t,
  tm,
  locale: locale.value,
  routePath: route.path,
  store,
  isElectron,
  isCapacitor,
  hardwareKeyboardAttached: hardwareKeyboardAttached.value,
  navigate: navigateFromCommandPalette,
  openSettingsSection,
  openSettingsSearchResult,
  openSettingsView,
  goHistory: goHistoryFromCommandPalette,
  openFindbar,
  focusSearch: focusSearchFromCommandPalette,
  showKeyboardShortcuts: () => store.dispatch('showKeyboardShortcutPrompt'),
  createTab: () => store.dispatch('createTab', { makeActive: true }),
  closeTabs: closeTabsFromCommandPalette,
  reloadTabs: reloadTabsFromCommandPalette,
  runShortcut: runShortcutFromCommandPalette,
  createWindow: createWindowFromCommandPalette,
  routeAvailable: path => availableRoutePaths.has(path),
  supportsLocalApi: !!process.env.SUPPORTS_LOCAL_API,
  isMac: process.platform === 'darwin',
  isLinuxWayland: isLinuxWayland.value,
  systemUsesDarkTheme: systemUsesDarkTheme.value,
}))

function openCommandPalette() {
  if (showTutorial.value || (!commandPaletteOpen.value && isAnyPromptOpen.value)) return
  commandPaletteOpen.value = true
}

function closeCommandPalette() {
  commandPaletteOpen.value = false
}

function openTabOrganizer() {
  if (!isElectron || showTutorial.value || (!tabOrganizerOpen.value && isAnyPromptOpen.value)) return
  tabOrganizerOpen.value = true
}

function closeTabOrganizer() {
  tabOrganizerOpen.value = false
}

function navigateFromCommandPalette(location) {
  if (isElectron) {
    return navigation.push(presentedTabId.value, location)
  }
  return router.push(location)
}

function goHistoryFromCommandPalette(offset) {
  if (usesLogicalTabs) {
    return navigation.go(presentedTabId.value, offset)
  }
  return router.go(offset)
}

const ANDROID_EXIT_PROMPT_VALUES = ['quit', 'cancel', 'neverAskAgain']
const androidExitPromptNames = computed(() => [
  t('Close Confirmation.Quit'),
  t('Cancel'),
  t('Close Confirmation.Never Ask Again')
])

async function requestAndroidAppExit() {
  if (!store.getters.getConfirmCloseApp) {
    await exitAndroidApp()
    return
  }

  showAndroidExitPrompt.value = true
}

/** @param {'quit' | 'cancel' | 'neverAskAgain' | null} option */
async function handleAndroidExitPromptAnswer(option) {
  showAndroidExitPrompt.value = false
  if (option === 'neverAskAgain') {
    await store.dispatch('updateConfirmCloseApp', false)
  }
  if (option === 'quit' || option === 'neverAskAgain') {
    await exitAndroidApp()
  }
}

async function handleAndroidBack() {
  if (mobileContextLink.value !== null || mobileContextActions.value !== null) {
    closeMobileLinkActions()
    return
  }

  const hadOpenLayer = hasVisibleGamepadLayer() || isSideNavOpen.value
  const target = document.activeElement instanceof HTMLElement ? document.activeElement : document
  const escapeEvent = new KeyboardEvent('keydown', {
    key: 'Escape',
    code: 'Escape',
    bubbles: true,
    cancelable: true,
  })

  if (isSideNavOpen.value) {
    closeSideNav()
    return
  }
  if (!target.dispatchEvent(escapeEvent) || hadOpenLayer) {
    return
  }
  if (document.fullscreenElement !== null) {
    await document.exitFullscreen()
    return
  }

  const tabId = presentedTabId.value
  if (tabId && store.getters.getTabHistoryState(tabId).canGoBack) {
    await navigation.back(tabId)
    return
  }

  await requestAndroidAppExit()
}

function handleAndroidPictureInPictureChange(event) {
  setAndroidPictureInPictureDocumentState(event.active === true)
}

function handleHardwareKeyboardChange(event) {
  hardwareKeyboardAttached.value = event.attached === true
  if (!hardwareKeyboardAttached.value) {
    store.dispatch('hideKeyboardShortcutPrompt')
  }
}

function openSettingsView(view) {
  store.dispatch('showSettingsWindow', view)
}

function openSettingsSection(section) {
  store.commit('setSettingsWindowSection', section)
  store.dispatch('showSettingsWindow')
}

function openSettingsSearchResult(section, match) {
  settingsSearchTarget.value = { section, ...match }
  store.commit('setSettingsWindowSection', section)
  store.dispatch('showSettingsWindow')
}

function clearSettingsSearchTarget(target) {
  if (settingsSearchTarget.value === target) {
    settingsSearchTarget.value = null
  }
}

function focusSearchFromCommandPalette() {
  setTimeout(() => {
    const input = document.querySelector('.topNav .searchInput .ft-input')
    input?.focus()
    input?.select()
  })
}

function createWindowFromCommandPalette() {
  if (isElectron) {
    openInternalPath({
      path: landingPage.value,
      doCreateNewWindow: true
    })
    return
  }

  const url = new URL(window.location.href)
  url.hash = landingPage.value
  window.open(url.toString(), '_blank', 'noreferrer')
}

async function closeTabsFromCommandPalette() {
  const hasRemainingTabs = await closeShortcutTabs()
  if (!hasRemainingTabs) window.close()
}

function reloadTabsFromCommandPalette() {
  for (const tabId of getShortcutTabIds()) prepareAndReloadTab(tabId)
}

function runShortcutFromCommandPalette(shortcut) {
  nextTick(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', keyboardEventInitFromShortcut(shortcut)))
  })
}

function handleGamepadPlayPause() {
  document.dispatchEvent(new KeyboardEvent(
    'keydown',
    keyboardEventInitFromShortcut(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.PLAY)
  ))
}

function handleGamepadBack() {
  const hadOpenLayer = hasVisibleGamepadLayer()
  const target = document.activeElement instanceof HTMLElement ? document.activeElement : document
  const escapeEvent = new KeyboardEvent('keydown', {
    key: 'Escape',
    code: 'Escape',
    bubbles: true,
    cancelable: true,
  })

  if (!target.dispatchEvent(escapeEvent) || hadOpenLayer) {
    return
  }
  if (document.fullscreenElement !== null) {
    document.exitFullscreen()
    return
  }

  goHistoryFromCommandPalette(-1)
}

/**
 * @param {KeyboardEvent} event
 */
function handleKeyboardShortcuts(event) {
  if (showTutorial.value) return

  if (event.key === 'Escape' && (mobileContextLink.value || mobileContextActions.value)) {
    event.preventDefault()
    closeMobileLinkActions()
    return
  }

  const shortcuts = KeyboardShortcuts.APP.GENERAL

  if (matchesKeyboardShortcut(event, shortcuts.OPEN_COMMAND_PALETTE)) {
    event.preventDefault()
    if (commandPaletteOpen.value) {
      closeCommandPalette()
    } else {
      openCommandPalette()
    }
    return
  }

  if (commandPaletteOpen.value || tabOrganizerOpen.value) return

  if (matchesKeyboardShortcut(event, shortcuts.FIND_IN_PAGE)) {
    event.preventDefault()
    store.dispatch('showOutlines')
    openFindbar()
    return
  }

  if (matchesKeyboardShortcut(event, shortcuts.NAVIGATE_TO_DOWNLOADS)) {
    event.preventDefault()
    store.dispatch('showSettingsWindow', 'downloads')
    return
  }

  if (findbarVisible.value && handleFindbarNavigationShortcut(event)) {
    return
  }

  if (tabSwitcherVisible.value && event.key === 'Escape') {
    event.preventDefault()
    cancelTabSwitcher()
    return
  }

  if (findbarVisible.value && event.key === 'Escape') {
    event.preventDefault()
    closeFindbar()
    return
  }

  if (findbarVisible.value && event.key === 'Enter' && !isTypingTarget(event.target)) {
    event.preventDefault()
    findInPage(event.shiftKey)
    return
  }

  if (matchesKeyboardShortcut(event, shortcuts.SHOW_SHORTCUTS) && !isTypingTarget(event.target)) {
    event.preventDefault()
    store.dispatch(isKeyboardShortcutPromptShown.value && settingsWindowOpen.value
      ? 'hideSettingsWindow'
      : 'showKeyboardShortcutPrompt')
  }

  if (event.key === 'Tab' && !event.ctrlKey) {
    store.dispatch('showOutlines')
  }

  // Tab keyboard shortcuts (Electron only)
  if (process.env.IS_ELECTRON) {
    // Ctrl+1..9: Switch to tab by number
    if (matchesKeyboardShortcut(event, shortcuts.SWITCH_TO_TAB)) {
      if (!isTypingTarget(event.target)) {
        const index = parseInt(event.key, 10) - 1
        const tabs = store.state.tabs.tabs
        if (index < tabs.length) {
          event.preventDefault()
          store.dispatch('activateTab', tabs[index].id)
          return
        }
      }
    }

    // Open the tab organizer with its optional user-assigned shortcut
    if (matchesKeyboardShortcut(event, shortcuts.OPEN_TAB_ORGANIZER) && !isTypingTarget(event.target)) {
      event.preventDefault()
      openTabOrganizer()
      return
    }

    // F1: Toggle between horizontal and vertical tabs
    if (matchesKeyboardShortcut(event, shortcuts.TOGGLE_TAB_ORIENTATION) && !isTypingTarget(event.target)) {
      event.preventDefault()
      cycleTabLayout()
      return
    }

    // Ctrl+T: New tab
    if (matchesKeyboardShortcut(event, shortcuts.NEW_TAB)) {
      event.preventDefault()
      store.dispatch('createTab', { makeActive: true })
      return
    }

    // Ctrl+Shift+T: Restore closed tab
    if (matchesKeyboardShortcut(event, shortcuts.RESTORE_CLOSED_TAB)) {
      event.preventDefault()
      store.dispatch('restoreClosedTab')
      return
    }

    // Ctrl+W: Close tab (handled in menu, but also here for robustness)
    if (matchesKeyboardShortcut(event, shortcuts.CLOSE_TAB)) {
      event.preventDefault()
      closeShortcutTabs().then((hasRemainingTabs) => {
        if (!hasRemainingTabs) {
          window.close()
        }
      })
      return
    }

    // Ctrl+Tab: Next tab
    if (matchesKeyboardShortcut(event, shortcuts.NEXT_TAB)) {
      event.preventDefault()
      cycleTabSwitcher(1)
      return
    }

    // Ctrl+Shift+Tab: Previous tab
    if (matchesKeyboardShortcut(event, shortcuts.PREV_TAB)) {
      event.preventDefault()
      cycleTabSwitcher(-1)
      return
    }

    // Reload tab unless the current view handles refresh itself
    if ([shortcuts.RELOAD_TAB, shortcuts.RELOAD_TAB_ALT]
      .some(shortcut => matchesKeyboardShortcut(event, shortcut))) {
      const tabIds = getShortcutTabIds()
      if (tabIds.length === 1 && route.path.startsWith('/subscriptions')) {
        event.preventDefault()
        return
      }
      event.preventDefault()
      for (const tabId of tabIds) {
        prepareAndReloadTab(tabId)
      }
    }
  }
}

/**
 * The setting is only committed to the store once it has been persisted, so
 * consecutive presses are queued to keep every one of them from advancing
 * from the same stale value.
 */
let pendingTabLayoutUpdate = Promise.resolve()

function cycleTabLayout() {
  pendingTabLayoutUpdate = pendingTabLayoutUpdate.then(() =>
    store.dispatch('updateTabBarPosition', getNextTabBarPosition(tabBarPosition.value))
  )
}

/**
 * @param {EventTarget | null} target
 * @returns {boolean}
 */
function isTypingTarget(target) {
  return target instanceof HTMLElement && (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  )
}

/**
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
function handleFindbarNavigationShortcut(event) {
  const shortcuts = KeyboardShortcuts.APP.GENERAL
  const isNextShortcut = [
    shortcuts.FIND_NEXT,
    shortcuts.FIND_NEXT_ALT,
  ].some(shortcut => matchesKeyboardShortcut(event, shortcut))
  const isPreviousShortcut = [
    shortcuts.FIND_PREVIOUS,
    shortcuts.FIND_PREVIOUS_ALT,
  ].some(shortcut => matchesKeyboardShortcut(event, shortcut))

  if (!isNextShortcut && !isPreviousShortcut) {
    return false
  }

  event.preventDefault()
  findInPage(isPreviousShortcut)
  return true
}

function openFindbar() {
  findbarVisible.value = true

  const selection = window.getSelection()?.toString().trim()
  if (selection) {
    findbarQuery.value = selection
  }

  nextTick(() => {
    findbarInputRef.value?.focus()
    findbarInputRef.value?.select()
    findInPage()
  })
}

function closeFindbar() {
  findbarVisible.value = false
  findbarMatchIndex.value = 0
  findbarMatchCount.value = 0
  clearFindbarHighlights()
}

/**
 * @param {boolean | Event} [backwards]
 */
function findInPage(backwards = null) {
  const query = findbarQuery.value.trim()
  if (query.length === 0) {
    findbarMatchIndex.value = 0
    findbarMatchCount.value = 0
    clearFindbarHighlights()
    return
  }

  const input = findbarInputRef.value
  const selectionStart = input?.selectionStart ?? query.length
  const selectionEnd = input?.selectionEnd ?? query.length
  const isNavigation = typeof backwards === 'boolean'
  const direction = backwards === true ? -1 : 1

  if (!isNavigation || findbarMatches.length === 0) {
    highlightFindbarMatches(query)
  } else {
    selectFindbarMatch(findbarMatchIndex.value - 1 + direction)
  }

  requestAnimationFrame(() => {
    input?.focus()
    input?.setSelectionRange(selectionStart, selectionEnd)
  })
}

/**
 * @param {string} query
 */
function highlightFindbarMatches(query) {
  clearFindbarHighlights()

  const walker = document.createTreeWalker(
    tabRuntimeRegistry.getRoot(presentedTabId.value) ?? document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        if (
          isFindbarTextNode(node) ||
          isNonSearchableTextNode(node) ||
          isHiddenTextNode(node)
        ) {
          return NodeFilter.FILTER_REJECT
        }

        return NodeFilter.FILTER_ACCEPT
      }
    }
  )
  const normalizedQuery = query.toLocaleLowerCase()
  const ranges = []

  while (walker.nextNode()) {
    const node = walker.currentNode
    const text = node.textContent ?? ''
    const normalizedText = text.toLocaleLowerCase()
    let index = normalizedText.indexOf(normalizedQuery)

    while (index !== -1) {
      ranges.push({
        node,
        start: index,
        end: index + normalizedQuery.length
      })
      index = normalizedText.indexOf(normalizedQuery, index + normalizedQuery.length)
    }
  }

  const matches = ranges.map((rangeInfo) => {
    const range = document.createRange()
    range.setStart(rangeInfo.node, rangeInfo.start)
    range.setEnd(rangeInfo.node, rangeInfo.end)
    return range
  })

  findbarMatches = matches
  findbarMatchCount.value = matches.length
  paintFindbarHighlights()
  selectFindbarMatch(matches.length > 0 ? 0 : -1)
}

function clearFindbarHighlights() {
  window.CSS.highlights.delete('findbarmatch')
  window.CSS.highlights.delete('findbarmatchcurrent')
  findbarMatches = []
}

function paintFindbarHighlights() {
  const highlight = new window.Highlight(...findbarMatches)
  highlight.priority = 0
  window.CSS.highlights.set('findbarmatch', highlight)
}

/**
 * @param {number} index
 */
function selectFindbarMatch(index) {
  const matches = findbarMatches
  if (matches.length === 0) {
    findbarMatchIndex.value = 0
    findbarMatchCount.value = 0
    return
  }

  const nextIndex = (index + matches.length) % matches.length
  const currentMatch = matches[nextIndex]
  const currentHighlight = new window.Highlight(currentMatch)
  currentHighlight.priority = 1

  window.CSS.highlights.set('findbarmatchcurrent', currentHighlight)
  scrollFindbarMatchIntoView(currentMatch)

  findbarMatchIndex.value = nextIndex + 1
  findbarMatchCount.value = matches.length
}

/**
 * @param {Range} match
 */
function scrollFindbarMatchIntoView(match) {
  const rect = match.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) {
    return
  }

  const targetBlockCenter = rect.top + rect.height / 2
  const viewportBlockCenter = window.innerHeight / 2
  window.scrollBy({
    top: targetBlockCenter - viewportBlockCenter,
    behavior: 'smooth'
  })
}

/**
 * @param {Node} node
 * @returns {boolean}
 */
function isFindbarTextNode(node) {
  return node.parentElement?.closest('.findbar') != null
}

/**
 * @param {Node} node
 * @returns {boolean}
 */
function isNonSearchableTextNode(node) {
  return node.parentElement?.closest('datalist, input, option, optgroup, script, select, style, template, textarea') != null
}

/**
 * @param {Node} node
 * @returns {boolean}
 */
function isHiddenTextNode(node) {
  const element = node.parentElement
  if (element == null) {
    return true
  }

  const style = window.getComputedStyle(element)
  return style.display === 'none' ||
    style.visibility === 'hidden' ||
    element.closest('[aria-hidden="true"]') != null
}

/**
 * @param {KeyboardEvent} event
 */
function handleKeyboardShortcutKeyup(event) {
  if (!tabSwitcherVisible.value) {
    return
  }

  if (event.key === 'Control' || !event.ctrlKey) {
    event.preventDefault()
    commitTabSwitcherSelection()
  }
}

/**
 * @param {number} direction
 */
function cycleTabSwitcher(direction) {
  const tabs = tabSwitcherTabs.value
  if (tabs.length <= 1) {
    return
  }

  if (!tabSwitcherVisible.value) {
    const activeIndex = Math.max(0, tabs.findIndex(tab => tab.id === store.getters.getActiveTabId))
    tabSwitcherSelectedIndex.value = wrapTabSwitcherIndex(activeIndex + direction, tabs.length)
    tabSwitcherPreviewUrls.value = {}
    tabSwitcherPointerActive.value = false
    if (showTabPreviews.value) {
      window.ftElectron.tabs.setPreviewCapturePaused(true)
    }
    tabSwitcherVisible.value = true
    scrollTabSwitcherSelectionIntoView()
    loadTabSwitcherPreviews()
    return
  }

  tabSwitcherSelectedIndex.value = wrapTabSwitcherIndex(
    tabSwitcherSelectedIndex.value + direction,
    tabs.length
  )
  scrollTabSwitcherSelectionIntoView()
}

/**
 * @param {number} index
 * @param {number} length
 * @returns {number}
 */
function wrapTabSwitcherIndex(index, length) {
  return (index + length) % length
}

function loadTabSwitcherPreviews() {
  if (
    !showTabPreviews.value ||
    !process.env.IS_ELECTRON ||
    typeof window.ftElectron?.tabs?.getCachedPreviews !== 'function'
  ) {
    return
  }

  const requestId = ++tabSwitcherPreviewRequestId
  const tabIds = tabSwitcherTabs.value.map(tab => tab.id)
  tabSwitcherPreviewPending.value = Object.fromEntries(tabIds.map(tabId => [tabId, true]))

  window.ftElectron.tabs.getCachedPreviews(tabIds).then((previews) => {
    if (requestId !== tabSwitcherPreviewRequestId || !tabSwitcherVisible.value) {
      return
    }

    tabSwitcherPreviewUrls.value = Object.fromEntries(
      Object.entries(previews).filter(([, dataUrl]) => typeof dataUrl === 'string' && dataUrl.length > 0)
    )
  }).catch(() => {}).finally(() => {
    if (requestId === tabSwitcherPreviewRequestId && tabSwitcherVisible.value) {
      tabSwitcherPreviewPending.value = {}
    }
  })
}

function getUsableTabSwitcherAvatarUrl(tab) {
  const avatarUrl = getTabAvatarUrl(tab) || getTabPreviewFallbackUrl(tab)
  return avatarUrl !== tabSwitcherFailedAvatarUrls.value[tab.id] ? avatarUrl : null
}

function getUsableTabSwitcherPreviewUrl(tab) {
  const previewUrl = tabSwitcherPreviewUrls.value[tab.id]
  return previewUrl !== tabSwitcherFailedPreviewUrls.value[tab.id] ? previewUrl : null
}

function handleTabSwitcherAvatarError(tab) {
  tabSwitcherFailedAvatarUrls.value = {
    ...tabSwitcherFailedAvatarUrls.value,
    [tab.id]: getUsableTabSwitcherAvatarUrl(tab)
  }
}

function handleTabSwitcherPreviewError(tab) {
  tabSwitcherFailedPreviewUrls.value = {
    ...tabSwitcherFailedPreviewUrls.value,
    [tab.id]: getUsableTabSwitcherPreviewUrl(tab)
  }
}

/**
 * @param {number} index
 */
function setTabSwitcherSelectedIndex(index) {
  tabSwitcherSelectedIndex.value = index
}

function activateTabSwitcherPointer() {
  tabSwitcherPointerActive.value = true
}

function clearTabSwitcherSelection() {
  tabSwitcherSelectedIndex.value = -1
  tabSwitcherPointerActive.value = false
}

/**
 * @param {WheelEvent} event
 */
function handleTabSwitcherWheel(event) {
  const switcher = tabSwitcherRef.value
  if (!(switcher instanceof HTMLElement)) {
    return
  }

  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
    ? event.deltaX
    : event.deltaY

  if (delta === 0) {
    return
  }

  // Prefer vertical scrolling when the switcher wraps into multiple rows;
  // fall back to horizontal when that is the only overflow axis.
  if (switcher.scrollHeight > switcher.clientHeight) {
    switcher.scrollTop += delta
  } else {
    switcher.scrollLeft += delta
  }
}

function scrollTabSwitcherSelectionIntoView() {
  nextTick(() => {
    const selectedTabId = tabSwitcherSelectedTabId.value
    if (selectedTabId == null) {
      return
    }

    document.getElementById(selectedTabId)?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest'
    })
  })
}

/**
 * @param {number} [index]
 */
function commitTabSwitcherSelection(index) {
  if (typeof index === 'number') {
    tabSwitcherSelectedIndex.value = index
  }

  const selectedTab = tabSwitcherTabs.value[tabSwitcherSelectedIndex.value]
  cancelTabSwitcher()

  if (selectedTab && selectedTab.id !== store.getters.getActiveTabId) {
    store.dispatch('activateTab', selectedTab.id)
  }
}

function cancelTabSwitcher() {
  if (!tabSwitcherVisible.value) {
    return
  }

  tabSwitcherVisible.value = false
  tabSwitcherSelectedIndex.value = -1
  tabSwitcherPreviewUrls.value = {}
  tabSwitcherPreviewPending.value = {}
  tabSwitcherFailedAvatarUrls.value = {}
  tabSwitcherFailedPreviewUrls.value = {}
  tabSwitcherPointerActive.value = false
  tabSwitcherPreviewRequestId++
  window.ftElectron.tabs.setPreviewCapturePaused(false)
}

/**
 * @param {{color?: string | null}} tab
 * @returns {Record<string, string | undefined>}
 */
function getTabSwitcherItemStyle(tab) {
  return {
    '--tab-switcher-accent-color': getTabAccentColor(tab.color) || undefined
  }
}

async function prepareAndReloadTab(tabId = activeTabId.value) {
  const tab = store.getters.getTabById(tabId)
  if (!tab) {
    return
  }

  if (tab.route.path.startsWith('/watch/')) {
    const timestamp = store.getters.getWatchTimestamp(tabId)
    if (typeof timestamp === 'number' && timestamp > 0) {
      navigation.prepareReload(tabId, {
        path: tab.route.path,
        query: { ...tab.route.query, oneTimeTimestamp: Math.floor(timestamp) }
      })
    }
  }
  store.dispatch('reloadTab', tabId)
}

function getShortcutTabIds() {
  const selectedTabIds = store.getters.getSelectedTabIds
  return selectedTabIds.length > 1
    ? [...selectedTabIds]
    : activeTabId.value ? [activeTabId.value] : []
}

const multipleTabsActionPrompt = ref(null)
const multipleTabsActionPromptCount = ref(0)
const MULTIPLE_TABS_ACTION_PROMPT_VALUES = ['confirm', 'cancel', 'neverAskAgain']

/** @type {((confirmed: boolean) => void) | null} */
let multipleTabsActionPromptResolve = null
/** @type {Promise<boolean> | null} */
let multipleTabsActionPromptPromise = null

const multipleTabsActionPromptTitle = computed(() => {
  if (multipleTabsActionPrompt.value === 'load') return t('Load Multiple Tabs Confirmation.Title')
  if (multipleTabsActionPrompt.value === 'unload') return t('Unload Multiple Tabs Confirmation.Title')
  return t('Close Multiple Tabs Confirmation.Title')
})
const multipleTabsActionPromptMessage = computed(() => {
  const count = multipleTabsActionPromptCount.value
  const parameters = { count }
  if (multipleTabsActionPrompt.value === 'load') return t('Load Multiple Tabs Confirmation.Message', parameters, count)
  if (multipleTabsActionPrompt.value === 'unload') return t('Unload Multiple Tabs Confirmation.Message', parameters, count)
  return t('Close Multiple Tabs Confirmation.Message', parameters, count)
})
const multipleTabsActionPromptNames = computed(() => [
  multipleTabsActionPrompt.value === 'load'
    ? t(
        'Load Multiple Tabs Confirmation.Load Tabs',
        { count: multipleTabsActionPromptCount.value },
        multipleTabsActionPromptCount.value
      )
    : multipleTabsActionPrompt.value === 'unload'
      ? t(
          'Unload Multiple Tabs Confirmation.Unload Tabs',
          { count: multipleTabsActionPromptCount.value },
          multipleTabsActionPromptCount.value
        )
      : t(
          'Close Multiple Tabs Confirmation.Close Tabs',
          { count: multipleTabsActionPromptCount.value },
          multipleTabsActionPromptCount.value
        ),
  t('Cancel'),
  t('Confirmations.Never Ask Again')
])

/**
 * @param {'close' | 'load' | 'unload'} action
 */
function isMultipleTabsActionConfirmationEnabled(action) {
  if (action === 'load') return store.getters.getConfirmLoadMultipleTabs
  if (action === 'unload') return store.getters.getConfirmUnloadMultipleTabs
  return store.getters.getConfirmCloseMultipleTabs
}

/**
 * @param {'close' | 'load' | 'unload'} action
 */
function disableMultipleTabsActionConfirmation(action) {
  if (action === 'load') return store.dispatch('updateConfirmLoadMultipleTabs', false)
  if (action === 'unload') return store.dispatch('updateConfirmUnloadMultipleTabs', false)
  return store.dispatch('updateConfirmCloseMultipleTabs', false)
}

/**
 * Ask the user to confirm an action affecting several tabs at once. Concurrent
 * requests for the same action share one prompt; a different action is rejected.
 * @param {number} count
 * @param {'close' | 'load' | 'unload'} action
 * @returns {Promise<boolean>}
 */
function confirmMultipleTabsAction(count, action) {
  if (!isMultipleTabsActionConfirmationEnabled(action)) return Promise.resolve(true)

  if (multipleTabsActionPromptPromise) {
    if (multipleTabsActionPrompt.value !== action) return Promise.resolve(false)

    multipleTabsActionPromptCount.value = Math.max(multipleTabsActionPromptCount.value, count)
    return multipleTabsActionPromptPromise
  }

  multipleTabsActionPrompt.value = action
  multipleTabsActionPromptCount.value = count
  multipleTabsActionPromptPromise = new Promise(resolve => {
    multipleTabsActionPromptResolve = resolve
  })
  return multipleTabsActionPromptPromise
}

/**
 * @param {'confirm' | 'cancel' | 'neverAskAgain' | null} option
 */
async function handleMultipleTabsActionPromptAnswer(option) {
  const action = multipleTabsActionPrompt.value
  multipleTabsActionPrompt.value = null
  multipleTabsActionPromptCount.value = 0
  const resolve = multipleTabsActionPromptResolve
  multipleTabsActionPromptResolve = null
  multipleTabsActionPromptPromise = null
  if (option === 'neverAskAgain' && action != null) {
    try {
      await disableMultipleTabsActionConfirmation(action)
    } catch (error) {
      console.error('Failed to disable the bulk tab action confirmation', error)
    }
  }
  resolve?.(option === 'confirm' || option === 'neverAskAgain')
}

/**
 * @param {{ requestId: string, count: number, action: 'close' | 'load' | 'unload' }} request
 */
async function handleConfirmMultipleTabsActionRequest({ requestId, count, action }) {
  const confirmed = await confirmMultipleTabsAction(count, action)
  window.ftElectron.tabs.respondConfirmMultipleAction(requestId, confirmed)
}

async function closeShortcutTabs() {
  const tabIds = getShortcutTabIds()
  if (tabIds.length >= MULTIPLE_TABS_CONFIRM_THRESHOLD && !await confirmMultipleTabsAction(tabIds.length, 'close')) {
    return true
  }

  if (tabIds.length === 0) {
    return true
  }
  if (tabIds.length === 1) {
    return await store.dispatch('closeTab', tabIds[0])
  }

  return await store.dispatch('closeTabs', tabIds)
}

function handleMouseDown() {
  store.dispatch('hideOutlines')
}

const lastExternalLinkToBeOpened = ref('')
const showExternalLinkOpeningPrompt = ref(false)
const EXTERNAL_LINK_OPENING_PROMPT_VALUES = ['yes', 'no']

const externalLinkOpeningPromptNames = computed(() => [
  t('Yes, Open Link'),
  t('No')
])

/** @type {import('vue').ComputedRef<'' | 'openLinkAfterPrompt' | 'doNothing'>} */
const externalLinkHandling = computed(() => store.getters.getExternalLinkHandling)

/**
 * @param {'yes' | 'no' | null} option
 */
function handleExternalLinkOpeningPromptAnswer(option) {
  showExternalLinkOpeningPrompt.value = false

  if (option === 'yes' && lastExternalLinkToBeOpened.value.length > 0) {
    // Maybe user should be notified
    // if `lastExternalLinkToBeOpened` is empty

    // Open links externally
    openExternalLink(lastExternalLinkToBeOpened.value)
  }
}

/**
 * @param {PointerEvent} event
 * @returns {HTMLAnchorElement | null}
 */
function getEventLink(event) {
  const target = event.target instanceof Element ? event.target : null
  const link = target?.closest('a[href]')
  return link instanceof HTMLAnchorElement ? link : null
}

/**
 * @param {HTMLAnchorElement} link
 */
function isExternalLink(link) {
  return link.origin !== window.location.origin
}

/**
 * Opens modified clicks on ordinary internal links through the app's tab and
 * window APIs. Components with specialized navigation can opt out by calling
 * preventDefault() before the event reaches the document.
 * @param {PointerEvent} event
 * @param {HTMLAnchorElement | null} link
 */
function handleInternalLinkShortcut(event, link) {
  if (!process.env.IS_ELECTRON || event.defaultPrevented || link === null || isExternalLink(link)) {
    return false
  }

  const isMiddleClick = event.type === 'auxclick' && event.button === 1
  const ctrlOrCmdPressed = process.platform === 'darwin' ? event.metaKey : event.ctrlKey
  const isCtrlOrCmdClick = event.type === 'click' && event.button === 0 && ctrlOrCmdPressed && !event.altKey
  if (!isMiddleClick && !isCtrlOrCmdClick) {
    return false
  }

  const hashRoute = new URL(link.href).hash.slice(1)
  if (!hashRoute.startsWith('/')) {
    return false
  }

  const destination = router.resolve(hashRoute)
  event.preventDefault()
  openInternalPath({
    path: destination.path,
    query: destination.query,
    title: link.dataset.tabTitle || undefined,
    doCreateNewWindow: event.shiftKey,
    doCreateNewTab: !event.shiftKey,
    makeActive: isCtrlOrCmdClick
  })
  return true
}

/**
 * @param {PointerEvent} event
 */
function handleClick(event) {
  const link = getEventLink(event)
  if (handleInternalLinkShortcut(event, link)) {
    return
  }

  if (link !== null && isExternalLink(link)) {
    handleLinkClick(event, link)
  }
}

async function handleMobileLinkContextMenu(event) {
  const link = getEventLink(event)
  if (!link) return

  event.preventDefault()
  event.stopPropagation()
  mobileContextActions.value = null
  mobileContextLink.value = link
  await nextTick()
  mobileLinkActionsRef.value?.focus({ preventScroll: true })
}

function closeMobileLinkActions() {
  mobileContextLink.value = null
  mobileContextActions.value = null
}

function runMobileContextAction(action) {
  closeMobileLinkActions()
  return action.run()
}

async function copyMobileContextLink() {
  const url = mobileContextLinkCopyUrl.value
  if (!url) return

  closeMobileLinkActions()
  await copyToClipboard(url)
}

async function shareMobileContextLink() {
  const url = mobileContextLinkCopyUrl.value
  if (!url) return

  closeMobileLinkActions()
  await shareLink(url)
}

async function openMobileContextLink(newTab) {
  const link = mobileContextLink.value
  if (!link) return

  const href = link.href
  closeMobileLinkActions()
  const internalPrefix = `${window.location.href.split('#')[0]}#`
  if (href.startsWith(internalPrefix)) {
    const destination = router.resolve(new URL(href).hash.slice(1))
    await openInternalPath({
      path: destination.path,
      query: destination.query,
      title: link.dataset.tabTitle || undefined,
      doCreateNewTab: newTab,
      makeActive: true
    })
    return
  }

  if (/^https?:\/\/((www\.|m\.)?youtube\.com|youtu\.be)\//.test(href)) {
    await handleYoutubeLink(href, { doCreateNewTab: newTab })
    return
  }

  handleExternalLink(href)
}

/**
 * @param {PointerEvent} event
 */
function handleAuxClick(event) {
  const link = getEventLink(event)

  // auxclick fires for all clicks not performed with the primary button
  // only handle the link click if it was the middle button,
  // otherwise the context menu breaks
  if (event.button === 1 && handleInternalLinkShortcut(event, link)) {
    return
  }

  if (link !== null && isExternalLink(link) && event.button === 1) {
    handleLinkClick(event, link)
    return
  }

  // The tab rework replaced the browser's navigation history with a per-tab
  // logical history, so Chromium's native mouse back/forward buttons no longer
  // navigate anything. Route buttons 3 (back) and 4 (forward) through the tab
  // navigation service instead. auxclick fires once per click, avoiding the
  // double dispatch seen with mousedown/mouseup for these buttons.
  // The web build has no logical tabs and the browser's own history still
  // works there, so those buttons are left alone.
  if (process.env.IS_ELECTRON && (event.button === 3 || event.button === 4)) {
    event.preventDefault()

    const tabId = activeTabId.value
    if (tabId != null) {
      navigation.go(tabId, event.button === 3 ? -1 : 1)
    }
  }
}

/**
 * @param {string} href
 */
function handleExternalLink(href) {
  const action = resolveExternalLinkAction(externalLinkHandling.value)
  if (action === 'disabled') {
    showToast({
      message: t('External link opening has been disabled in Settings → Privacy'),
      icon: ['fas', 'link-slash'],
    })
  } else if (action === 'prompt') {
    lastExternalLinkToBeOpened.value = href
    showExternalLinkOpeningPrompt.value = true
  } else {
    openExternalLink(href)
  }
}

/**
 * @param {PointerEvent} event
 * @param {HTMLAnchorElement} link
 */
function handleLinkClick(event, link) {
  const href = link.href
  event.preventDefault()

  // Check if it's a YouTube link, but exclude live chat pop out
  const youtubeUrlPattern = /^https?:\/\/((www\.|m\.)?youtube\.com(\/embed)?|youtu\.be)\/(?!.*live_chat).*$/
  const isYoutubeLink = youtubeUrlPattern.test(href)

  // Determine if we should open in new tab or new window.
  // `process.platform` is `undefined` in the web build, where the app can be
  // opened from any OS, so both modifiers count there.
  const ctrlOrCmdPressed = process.env.IS_ELECTRON
    ? ((process.platform !== 'darwin' && event.ctrlKey) || (process.platform === 'darwin' && event.metaKey))
    : (event.ctrlKey || event.metaKey)
  const isMiddleClick = event.type === 'auxclick' && event.button === 1
  const doCreateNewTab = ctrlOrCmdPressed || isMiddleClick
  const doCreateNewWindow = event.shiftKey

  if (isYoutubeLink) {
    handleYoutubeLink(href, {
      doCreateNewWindow,
      doCreateNewTab,
      isMiddleClick
    })
  } else {
    handleExternalLink(href)
  }
}

async function handleYoutubeLink(href, {
  doCreateNewWindow = false,
  doCreateNewTab = false,
  isMiddleClick = false,
  tabId = null
} = {}) {
  const result = await store.dispatch('getYoutubeUrlInfo', href)
  // Middle clicks should open tabs in background (not make them active)
  const makeActive = !isMiddleClick
  const openPath = (options) => {
    if (isElectron && tabId && !options.doCreateNewWindow && !options.doCreateNewTab) {
      return navigation.push(tabId, { path: options.path, query: options.query })
    }
    return openInternalPath(options)
  }

  switch (result.urlType) {
    case 'video': {
      const { videoId, timestamp, playlistId, commentId, isShort } = result

      const query = {}
      if (isShort) {
        query.short = 'true'
      }
      if (timestamp) {
        query.timestamp = timestamp
      }
      if (playlistId && playlistId.length > 0) {
        query.playlistId = playlistId
      }
      if (commentId) {
        query.commentId = commentId
      }

      openPath({
        path: `/watch/${videoId}`,
        query,
        doCreateNewWindow,
        doCreateNewTab,
        makeActive
      })
      break
    }

    case 'playlist': {
      const { playlistId, query } = result

      openPath({
        path: `/playlist/${playlistId}`,
        query,
        doCreateNewWindow,
        doCreateNewTab,
        makeActive
      })
      break
    }

    case 'search': {
      const { searchQuery, query } = result

      openPath({
        path: `/search/${encodeURIComponent(searchQuery)}`,
        query,
        doCreateNewWindow,
        doCreateNewTab,
        makeActive,
        searchQueryText: searchQuery
      })
      break
    }

    case 'hashtag': {
      const { hashtag } = result
      openPath({
        path: `/hashtag/${encodeURIComponent(hashtag)}`,
        doCreateNewWindow,
        doCreateNewTab,
        makeActive
      })
      break
    }

    case 'post': {
      const { postId, query } = result

      openPath({
        path: `/post/${postId}`,
        query,
        doCreateNewWindow,
        doCreateNewTab,
        makeActive
      })
      break
    }

    case 'channel': {
      const { channelId, subPath, url } = result

      openPath({
        path: `/channel/${channelId}/${subPath}`,
        doCreateNewWindow,
        doCreateNewTab,
        makeActive,
        query: {
          url
        }
      })
      break
    }

    case 'trending':
    case 'subscriptions':
    case 'history':
    case 'userplaylists':
      openPath({
        path: `/${result.urlType}`,
        doCreateNewWindow,
        doCreateNewTab,
        makeActive
      })
      break

    case 'invalid_url': {
      // Do nothing
      break
    }

    default: {
      // Unknown URL type
      showToast({
        message: t('Unknown YouTube url type, cannot be opened in app'),
        icon: ['fas', 'circle-exclamation'],
      })
    }
  }
}

function enableOpenUrl() {
  return window.ftElectron.handleOpenUrl((url, tabId) => {
    if (url) {
      handleYoutubeLink(url, { tabId })
    }
  })
}

async function enableCapacitorIntegrations() {
  const backButtonHandle = Capacitor.getPlatform() === 'android'
    ? await CapacitorApp.addListener('backButton', handleAndroidBack)
    : null
  const urlHandle = await CapacitorApp.addListener('appUrlOpen', ({ url }) => {
    if (url) handleYoutubeLink(url)
  })
  const shortcutHandle = await AppShortcuts.addListener('click', async ({ shortcutId }) => {
    const path = getAppShortcutPath(shortcutId)
    if (!path) return
    await store.dispatch('hideSettingsWindow')
    await openInternalPath({ path })
  })
  const stopShortcutUpdates = watch(locale, () => {
    const shortcuts = createAppShortcuts({
      subscriptions: t('Subscriptions.Subscriptions'),
      userplaylists: t('Playlists'),
      history: t('History.History'),
      downloads: t('Settings.Download Settings.Download Settings'),
    })
    AppShortcuts.set({ shortcuts }).catch(error => console.error('Failed to update app shortcuts', error))
  }, { immediate: true })
  const removeReminderActions = await initializeCapacitorLiveReminderActions((videoId) => {
    handleYoutubeLink(`https://www.youtube.com/watch?v=${videoId}`)
  })
  const removeMediaActions = await addAndroidMediaSessionActionListener(({ action, ...details }) => {
    tabMediaCoordinator.dispatchAction(action, details)
  })
  let receivedAppState = false
  const appStateHandle = await CapacitorApp.addListener('appStateChange', ({ isActive }) => {
    receivedAppState = true
    playbackScreenWake?.setAppActive(isActive)
    setAndroidAppVisible(isActive)
    if (shouldPauseAndroidPlaybackOnAppStateChange(
      isActive,
      store.getters.getContinuePlaybackWhenScreenIsLocked
    )) {
      tabMediaCoordinator.pauseAll()
    }
  })
  const appState = await CapacitorApp.getState()
  if (!receivedAppState) {
    playbackScreenWake?.setAppActive(appState.isActive)
    setAndroidAppVisible(appState.isActive)
  }
  const launch = await CapacitorApp.getLaunchUrl()
  if (launch?.url) await handleYoutubeLink(launch.url)

  return () => {
    stopShortcutUpdates()
    shortcutHandle.remove()
    backButtonHandle?.remove()
    urlHandle.remove()
    appStateHandle.remove()
    playbackScreenWake?.setAppActive(false)
    setAndroidAppVisible(null)
    removeReminderActions()
    removeMediaActions()
  }
}

const windowTitle = computed(() => {
  const routePath = route.path
  if (
    !routePath.startsWith('/channel/') &&
    !routePath.startsWith('/watch/') &&
    !routePath.startsWith('/hashtag/') &&
    !routePath.startsWith('/playlist/') &&
    !routePath.startsWith('/search/')
  ) {
    return translateWindowTitle(route.meta.title)
  } else {
    return null
  }
})

/** @type {import('vue').ComputedRef<string>} */
const appTitle = computed(() => {
  if (isElectron) {
    const tab = store.getters.getTabById(presentedTabId.value)
    return tab?.contentTitle ?? ''
  }
  return store.getters.getAppTitle
})

function publishAppTitle(value) {
  if (value.length > 0) {
    document.title = `${value} - ${packageDetails.productName}`
  } else {
    document.title = packageDetails.productName
  }

  if (isElectron && presentedTabId.value) {
    window.ftElectron.setWindowTitle(document.title, presentedTabId.value)
  }
}

watch(appTitle, publishAppTitle)

// Also watch the route: the title string alone can stay identical across a
// route change (e.g. '/' and '/subscriptions' share the same title), which
// would leave a tab's placeholder title in place when the route-match guard
// in setWindowTitle deferred an earlier update.
watch([windowTitle, () => route.fullPath], setWindowTitle)

function setWindowTitle() {
  if (windowTitle.value === null) {
    return
  }

  const titleTabId = store.state.tabs.transitionTargetTabId ?? presentedTabId.value
  if (usesLogicalTabs && titleTabId) {
    // During startup the shared router briefly sits on its initial route while
    // the restored tab's own route hasn't been projected yet. Only attribute
    // the router's title to the tab when it is actually on this route.
    const tab = store.getters.getTabById(titleTabId)
    if (tab && tab.route.fullPath !== route.fullPath) {
      return
    }
    navigation.setTitle(titleTabId, windowTitle.value)
  } else {
    store.commit('setAppTitle', windowTitle.value)
    publishAppTitle(windowTitle.value)
  }
}

const isLocaleRightToLeft = computed(() => {
  const locale_ = locale.value

  return locale_ === 'ar' || locale_ === 'fa' || locale_ === 'he' ||
  locale_ === 'ur' || locale_ === 'yi' || locale_ === 'ku'
})

watch(locale, (value) => {
  document.documentElement.lang = value

  document.body.dir = isLocaleRightToLeft.value ? 'rtl' : 'ltr'
}, { immediate: true })

/** @type {import('vue').ComputedRef<string>} */
const currentInvidiousInstanceUrl = computed(() => store.getters.getCurrentInvidiousInstanceUrl)

/**
 * Transforms dragged in-app URLs into YouTube ones, so they they can be dragged into other applications.
 * Cancels the drag operation if the URL is FreeTube specific and cannot be transformed e.g. user playlist URLs
 * @param {DragEvent} event
 */
function handleDragStart(event) {
  if (!event.dataTransfer.types.includes('text/uri-list')) {
    return
  }

  const originalUrlString = event.dataTransfer.getData('text/uri-list')
  const originalUrl = new URL(originalUrlString)

  // Check if this is an in-app URL
  if (originalUrl.origin !== window.location.origin || originalUrl.pathname !== window.location.pathname) {
    return
  }

  const [path, query] = originalUrl.hash.slice(2).split('?')
  const pathParts = path.split('/')
  const params = new URLSearchParams(query)

  let transformed = false
  let transformedURL = new URL('https://www.youtube.com')

  switch (pathParts[0]) {
    case 'watch':
      transformedURL.pathname = '/watch'
      transformedURL.searchParams.set('v', pathParts[1])

      if (params.has('timestamp')) {
        transformedURL.searchParams.set('t', params.get('timestamp') + 's')
      }

      if (params.has('playlistId') && params.get('playlistType') !== 'user') {
        transformedURL.searchParams.set('list', params.get('playlistId'))
      }

      transformed = true
      break
    case 'playlist':
      if (params.get('playlistType') !== 'user') {
        transformedURL.pathname = '/playlist'
        transformedURL.searchParams.set('list', pathParts[1])

        transformed = true
      }
      break
    case 'channel':
      transformedURL.pathname = `/channel/${pathParts[1]}`

      if (pathParts[2]) {
        switch (pathParts[2]) {
          case 'community':
            transformedURL.pathname += '/posts'
            break
          case 'search':
            transformedURL.pathname += '/search'
            if (params.has('searchQueryText')) {
              transformedURL.searchParams.set('query', params.get('searchQueryText'))
            }
            break
          case 'videos':
          case 'shorts':
          case 'releases':
          case 'podcasts':
          case 'courses':
          case 'playlists':
          case 'about':
            transformedURL.pathname += `/${pathParts[2]}`
            break
        }
      }

      transformed = true
      break
    case 'search':
      transformedURL.pathname = '/results'
      transformedURL.searchParams.set('search_query', decodeURIComponent(pathParts[1]))
      transformed = true
      break
    case 'hashtag':
    case 'post':
      transformedURL.pathname = `/${pathParts[0]}/${pathParts[1]}`
      transformed = true
      break
    case 'subscriptions':
    case 'history':
      transformedURL.pathname = `/feed/${pathParts[1]}`
      transformed = true
      break
    case 'userplaylists':
      transformedURL.pathname = '/feed/playlists'
      transformed = true
      break
    case 'settings':
      transformedURL.pathname = '/account'
      transformed = true
      break
    case 'about':
      transformedURL.pathname = '/about'
      transformed = true
      break
    case 'popular':
      transformedURL = new URL(`${currentInvidiousInstanceUrl.value}/feed/popular`)
      transformed = true
      break
  }

  if (transformed) {
    const transformedURLString = transformedURL.toString()

    event.dataTransfer.setData('text/uri-list', transformedURLString)

    const plainText = event.dataTransfer.getData('text/plain')
    if (plainText.length > 0) {
      event.dataTransfer.setData('text/plain', plainText.replaceAll(originalUrlString, transformedURLString))
    }

    const html = event.dataTransfer.getData('text/html')
    if (html.length > 0) {
      const originalUrlStringEncoded = originalUrlString.replaceAll('&', '&amp;')
      const transformedURLStringEncoded = transformedURLString.replaceAll('&', '&amp;')

      event.dataTransfer.setData('text/html', html.replaceAll(originalUrlStringEncoded, transformedURLStringEncoded))
    }
  } else {
    // Cancel the drag operation for FreeTube specific URLs that cannot be transformed such as user playlist URLs
    event.preventDefault()
    event.stopPropagation()
  }
}
</script>

<style src="./themes.css" />
<style scoped src="./App.css" />
