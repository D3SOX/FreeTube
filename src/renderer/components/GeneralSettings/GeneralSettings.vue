<template>
  <FtSettingsSection
    :title="sectionTitle"
  >
    <div
      class="switchColumnGrid switchFlowGrid"
      :class="{ appearanceSwitchGrid: mode === 'appearance' }"
    >
      <FtToggleSwitch
        v-if="mode === 'appearance'"
        :label="t('Settings.General Settings.Show Thumbnail Previews')"
        :default-value="showThumbnailPreviews"
        setting-key="showThumbnailPreviews"
        :compact="true"
        :tooltip="t('Tooltips.General Settings.Show Thumbnail Previews')"
        @change="updateShowThumbnailPreviews"
      />
      <FtToggleSwitch
        v-if="mode === 'general'"
        :label="t('Settings.General Settings.Check for Updates')"
        :default-value="checkForUpdates"
        setting-key="checkForUpdates"
        :compact="true"
        @change="updateCheckForUpdates"
      />
      <FtToggleSwitch
        v-if="mode === 'general' && USING_ELECTRON"
        :label="t('Settings.General Settings.Open Deep Links In New Window')"
        :default-value="openDeepLinksInNewWindow"
        setting-key="openDeepLinksInNewWindow"
        :compact="true"
        :tooltip="t('Tooltips.General Settings.Open Deep Links In New Window')"
        @change="updateOpenDeepLinksInNewWindow"
      />
      <FtToggleSwitch
        v-if="mode === 'providers' && SUPPORTS_LOCAL_API"
        :label="t('Settings.General Settings.Fallback to Non-Preferred Backend on Failure')"
        :default-value="backendFallback"
        setting-key="backendFallback"
        :compact="true"
        :tooltip="t('Tooltips.General Settings.Fallback to Non-Preferred Backend on Failure')"
        @change="updateBackendFallback"
      />
      <FtToggleSwitch
        v-if="mode === 'providers'"
        :label="t('Settings.Player Settings.Proxy Videos Through Invidious')"
        :compact="true"
        :default-value="showProxyVideosAsDisabled ? false : proxyVideos"
        :disabled="showProxyVideosAsDisabled"
        :tooltip="t('Tooltips.Player Settings.Proxy Videos Through Invidious')"
        @change="updateProxyVideos"
      />
      <FtToggleSwitch
        v-if="mode === 'general'"
        :label="t('Settings.General Settings.Update Relative Timestamps')"
        :tooltip="t('Tooltips.General Settings.Update Relative Timestamps')"
        :default-value="updateRelativeTimestamps"
        setting-key="updateRelativeTimestamps"
        :compact="true"
        @change="updateRelativeTimestampsSetting"
      />
      <FtToggleSwitch
        v-if="mode === 'general'"
        :label="t('Settings.General Settings.Auto Load Next Page.Label')"
        :default-value="generalAutoLoadMorePaginatedItemsEnabled"
        setting-key="generalAutoLoadMorePaginatedItemsEnabled"
        :compact="true"
        :tooltip="t('Settings.General Settings.Auto Load Next Page.Tooltip')"
        @change="updateGeneralAutoLoadMorePaginatedItemsEnabled"
      />
      <FtToggleSwitch
        v-if="mode === 'general' && !IS_MAC && !isLinuxWayland && USING_ELECTRON"
        :label="t('Settings.General Settings.Minimize to system tray')"
        :default-value="hideToTrayOnMinimize"
        setting-key="hideToTrayOnMinimize"
        :compact="true"
        @change="updateHideToTrayOnMinimize"
      />
      <FtToggleSwitch
        v-if="mode === 'general'"
        :label="t('Settings.General Settings.Use AI Translation Completions')"
        :default-value="useAITranslationCompletions"
        setting-key="useAITranslationCompletions"
        :compact="true"
        :disabled="aiTranslationCompletionsDisabled"
        :tooltip="t('Tooltips.General Settings.Use AI Translation Completions')"
        @change="updateUseAITranslationCompletions"
      />
    </div>
    <div class="switchGrid generalSelectGrid">
      <FtSelect
        v-if="mode === 'providers' && USING_ELECTRON"
        :placeholder="t('Settings.General Settings.Stream Extraction Method.Stream Extraction Method')"
        :value="videoPlaybackEngine"
        setting-key="videoPlaybackEngine"
        :select-names="playbackEngineNames"
        :select-values="PLAYBACK_ENGINE_VALUES"
        :tooltip="t('Tooltips.General Settings.Stream Extraction Method')"
        :icon="['fas', 'circle-play']"
        @change="updateVideoPlaybackEngine"
      />
      <FtSelect
        v-if="mode === 'providers'"
        :placeholder="t('Settings.General Settings.Preferred API Backend.Preferred API Backend')"
        :value="backendPreference"
        :select-names="backendNames"
        :select-values="BACKEND_VALUES"
        :tooltip="t('Tooltips.General Settings.Preferred API Backend')"
        :icon="['fas', 'server']"
        @change="updateBackendPreference"
      />
      <FtSelect
        v-if="mode === 'general'"
        :placeholder="t('Settings.General Settings.Default Landing Page')"
        :value="landingPage"
        setting-key="landingPage"
        :select-names="defaultPageNames"
        :select-values="defaultPageValues"
        :icon="['fas', 'location-dot']"
        @change="updateLandingPage"
      />
      <FtSelect
        v-if="mode === 'general' && USING_ELECTRON"
        :placeholder="t('Settings.General Settings.New Tab Position.New Tab Position')"
        :value="newTabPosition"
        setting-key="newTabPosition"
        :select-names="newTabPositionNames"
        :select-values="NEW_TAB_POSITION_VALUES"
        :icon="['fas', 'plus']"
        @change="updateNewTabPosition"
      />
      <FtSelect
        v-if="mode === 'general' && USING_ELECTRON"
        :placeholder="t('Settings.General Settings.Tab Close Focus.Tab Close Focus')"
        :value="tabCloseFocus"
        setting-key="tabCloseFocus"
        :select-names="tabCloseFocusNames"
        :select-values="TAB_CLOSE_FOCUS_VALUES"
        :icon="['fas', 'xmark']"
        @change="updateTabCloseFocus"
      />
      <FtSelect
        v-if="mode === 'general' && USING_ELECTRON"
        :placeholder="t('Settings.General Settings.Startup Behavior.Startup Behavior')"
        :value="startupBehavior"
        setting-key="startupBehavior"
        :select-names="startupBehaviorNames"
        :select-values="STARTUP_BEHAVIOR_VALUES"
        :tooltip="t('Tooltips.General Settings.Startup Behavior')"
        :icon="['fas', 'power-off']"
        @change="updateStartupBehavior"
      />
      <FtSelect
        v-if="mode === 'appearance'"
        :placeholder="t('Settings.General Settings.Video View Type.Video View Type')"
        :value="listType"
        setting-key="listType"
        :select-names="viewTypeNames"
        :select-values="VIEW_TYPE_VALUES"
        :icon="listType === 'grid' ? ['fas', 'grip'] : ['fas', 'list']"
        @change="updateListType"
      />
      <FtSelect
        v-if="mode === 'appearance'"
        :placeholder="t('Settings.General Settings.Playlist View Type.Playlist View Type')"
        :value="playlistViewType"
        setting-key="playlistViewType"
        :select-names="viewTypeNames"
        :select-values="VIEW_TYPE_VALUES"
        :icon="playlistViewType === 'grid' ? ['fas', 'grip'] : ['fas', 'list']"
        @change="updatePlaylistViewType"
      />
      <FtSelect
        v-if="mode === 'appearance'"
        :placeholder="t('Settings.General Settings.Thumbnail Preference.Thumbnail Preference')"
        :value="thumbnailPreference"
        setting-key="thumbnailPreference"
        :is-changed="thumbnailPreferenceChanged"
        :select-names="thumbnailTypeNames"
        :select-values="THUMBNAIL_TYPE_VALUES"
        :tooltip="t('Tooltips.General Settings.Thumbnail Preference')"
        :icon="['fas', 'images']"
        @change="handleThumbnailPreferenceChange"
        @reset="resetThumbnailPreference"
      />
      <FtSelect
        v-if="mode === 'general'"
        :placeholder="t('Settings.General Settings.Extra Thumbnail Action Button.Extra Thumbnail Action Button')"
        :value="effectiveExtraThumbnailAction"
        setting-key="extraThumbnailAction"
        :select-names="extraThumbnailActionNames"
        :select-values="extraThumbnailActionValues"
        :icon="['fas', 'ellipsis-v']"
        @change="updateExtraThumbnailAction"
      />
      <FtSelect
        v-if="mode === 'general'"
        :placeholder="t('Settings.General Settings.Locale Preference')"
        :value="currentLocale"
        setting-key="currentLocale"
        :select-names="localeNames"
        :select-values="LOCALE_VALUES"
        :icon="['fas', 'language']"
        :is-locale-selector="true"
        @change="updateCurrentLocale"
      />
      <FtSelect
        v-if="mode === 'general'"
        :placeholder="t('Settings.General Settings.Date Format')"
        :value="dateFormat"
        setting-key="dateFormat"
        :select-names="dateFormatNames"
        :select-values="DATE_FORMAT_OPTIONS"
        :icon="['fas', 'calendar-days']"
        @change="updateDateFormat"
      />
      <FtSelect
        v-if="mode === 'general'"
        :placeholder="t('Settings.General Settings.Time Format')"
        :value="timeFormat"
        setting-key="timeFormat"
        :select-names="timeFormatNames"
        :select-values="TIME_FORMAT_OPTIONS"
        :icon="['fas', 'clock']"
        @change="updateTimeFormat"
      />
      <FtSelect
        v-if="mode === 'general'"
        :placeholder="t('Settings.General Settings.Reduced Motion.Reduced Motion')"
        :value="reducedMotion"
        setting-key="reducedMotion"
        :select-names="reducedMotionNames"
        :select-values="REDUCED_MOTION_VALUES"
        :icon="['fas', 'gauge']"
        @change="updateReducedMotion"
      />
      <FtSelect
        v-if="mode === 'general' && SUPPORTS_LOCAL_API && (backendPreference === 'local' || backendFallback)"
        :placeholder="t('Settings.General Settings.Avoid translation.Avoid translation')"
        :value="avoidTranslation"
        setting-key="avoidTranslation"
        :select-names="avoidTranslationNames"
        :select-values="AVOID_TRANSLATION_VALUES"
        :tooltip="t('Tooltips.General Settings.Avoid translation')"
        :icon="['fas', 'language']"
        @change="updateAvoidTranslation"
      />
      <FtSelect
        v-if="mode === 'general' && regionDataLoaded"
        :placeholder="t('Settings.General Settings.Region for Trending')"
        :value="region"
        setting-key="region"
        :select-names="regionNames"
        :select-values="regionValues"
        :icon="['fas', 'globe']"
        :tooltip="t('Tooltips.General Settings.Region for Trending')"
        @change="updateRegion"
      />
    </div>
    <div
      v-if="mode === 'providers' && (backendPreference === 'invidious' || backendFallback)"
    >
      <FtFlexBox class="settingsFlexStart460px">
        <FtInput
          :placeholder="t('Settings.General Settings.Current Invidious Instance')"
          :show-action-button="false"
          :show-label="true"
          :value="currentInvidiousInstance"
          setting-key="defaultInvidiousInstance"
          :data-list="invidiousInstancesList"
          :tooltip="t('Tooltips.General Settings.Invidious Instance')"
          @input="handleInvidiousInstanceInput"
        />
      </FtFlexBox>
      <FtFlexBox>
        <div>
          <a
            href="https://api.invidious.io"
          >
            {{ t('Settings.General Settings.View all Invidious instance information') }}
          </a>
        </div>
      </FtFlexBox>
      <p
        v-if="defaultInvidiousInstance !== ''"
        class="center"
      >
        {{ t('Settings.General Settings.The currently set default instance is {instance}', { instance: defaultInvidiousInstance }) }}
      </p>
      <template v-else>
        <p class="center">
          {{ t('Settings.General Settings.No default instance has been set') }}
        </p>
        <p class="center">
          {{ t('Settings.General Settings.Current instance will be randomized on startup') }}
        </p>
      </template>
      <FtFlexBox>
        <FtButton
          :label="t('Settings.General Settings.Set Current Instance as Default')"
          :icon="['fas', 'thumbtack']"
          @click="handleSetDefaultInstanceClick"
        />
        <FtButton
          :label="t('Settings.General Settings.Clear Default Instance')"
          :icon="['fas', 'thumbtack-slash']"
          @click="handleClearDefaultInstanceClick"
        />
      </FtFlexBox>
    </div>
    <FtFlexBox
      v-if="mode === 'general' && (USING_ELECTRON || IS_CAPACITOR)"
      class="confirmations"
    >
      <FtCheckboxList
        v-model="enabledConfirmations"
        :title="t('Settings.General Settings.Confirm Before')"
        :labels="confirmationLabels"
        :values="confirmationValues"
      />
    </FtFlexBox>
  </FtSettingsSection>
</template>

<script setup>
import { computed, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import FtSettingsSection from '../FtSettingsSection/FtSettingsSection.vue'
import FtSelect from '../FtSelect/FtSelect.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'
import FtCheckboxList from '../FtCheckboxList/FtCheckboxList.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtButton from '../FtButton/FtButton.vue'

import store from '../../store/index'
import { DEFAULT_SETTINGS } from '../../store/modules/settings'
import { localeTranslationPercentages } from '../../i18n/index'

import allLocales from '../../../../static/locales/activeLocales.json'
import { debounce, randomArrayItem, showToast } from '../../helpers/utils'
import { translateWindowTitle } from '../../helpers/strings'
import { initializePlatformInfo, isLinuxWayland } from '../../helpers/platform'
import { filterAvailableNavigationItems } from '../../../navigationAvailability'
import {
  DATE_FORMAT_OPTIONS,
  TIME_FORMAT_OPTIONS,
  formatDate,
  formatTime,
  normalizeDateFormat,
  normalizeTimeFormat,
} from '../../helpers/dateFormat'

const USING_ELECTRON = !!process.env.IS_ELECTRON
const IS_CAPACITOR = !!process.env.IS_CAPACITOR
const SUPPORTS_LOCAL_API = !!process.env.SUPPORTS_LOCAL_API
const IS_MAC = process.platform === 'darwin'
const PLAYBACK_ENGINE_VALUES = ['yt-dlp', 'built-in']

const { locale, t } = useI18n()
const router = useRouter()

const props = defineProps({
  mode: {
    type: String,
    default: 'general',
    validator: value => ['general', 'appearance', 'providers'].includes(value)
  }
})

const mode = computed(() => props.mode)
const sectionTitle = computed(() => ({
  general: t('Settings.General Settings.General Settings'),
  appearance: t('Settings.Categories.Content appearance'),
  providers: t('Settings.Categories.Alternative providers')
})[mode.value])

const playbackEngineNames = computed(() => [
  t('Settings.General Settings.Stream Extraction Method.yt-dlp'),
  t('Settings.General Settings.Stream Extraction Method.Built-in')
])

/** @type {import('vue').ComputedRef<'yt-dlp' | 'built-in'>} */
const videoPlaybackEngine = computed(() => store.getters.getVideoPlaybackEngine)

/**
 * @param {'yt-dlp' | 'built-in'} value
 */
function updateVideoPlaybackEngine(value) {
  store.dispatch('updateVideoPlaybackEngine', value)
}

// The 'minimize' event doesn't fire on Wayland. This shared check starts during
// app initialization, before settings can mount, and is cached for every view.
initializePlatformInfo()

/** @type {import('vue').ComputedRef<boolean>} */
const checkForUpdates = computed(() => store.getters.getCheckForUpdates)

/**
 * @param {boolean} value
 */
function updateCheckForUpdates(value) {
  store.dispatch('updateCheckForUpdates', value)
}

const CONFIRMATION_OPTIONS = [
  {
    value: 'closeApp',
    label: () => t('Settings.General Settings.Confirmation Options.Closing App'),
    enabled: () => store.getters.getConfirmCloseApp,
    action: 'updateConfirmCloseApp'
  },
  {
    value: 'closeWindow',
    label: () => t('Settings.General Settings.Confirmation Options.Closing Window'),
    enabled: () => store.getters.getConfirmCloseWindowWithMultipleTabs,
    action: 'updateConfirmCloseWindowWithMultipleTabs'
  },
  {
    value: 'closeTabs',
    label: () => t('Settings.General Settings.Confirmation Options.Closing Tabs'),
    enabled: () => store.getters.getConfirmCloseMultipleTabs,
    action: 'updateConfirmCloseMultipleTabs'
  },
  {
    value: 'loadTabs',
    label: () => t('Settings.General Settings.Confirmation Options.Loading Tabs'),
    enabled: () => store.getters.getConfirmLoadMultipleTabs,
    action: 'updateConfirmLoadMultipleTabs'
  },
  {
    value: 'unloadTabs',
    label: () => t('Settings.General Settings.Confirmation Options.Unloading Tabs'),
    enabled: () => store.getters.getConfirmUnloadMultipleTabs,
    action: 'updateConfirmUnloadMultipleTabs'
  }
]
const visibleConfirmationOptions = computed(() => IS_CAPACITOR
  ? CONFIRMATION_OPTIONS.slice(0, 1)
  : CONFIRMATION_OPTIONS)
const confirmationValues = computed(() => visibleConfirmationOptions.value.map(option => option.value))
const confirmationLabels = computed(() => visibleConfirmationOptions.value.map(option => option.label()))
const enabledConfirmations = computed({
  get: () => visibleConfirmationOptions.value.filter(option => option.enabled()).map(option => option.value),
  set: values => {
    const enabled = new Set(values)
    for (const option of visibleConfirmationOptions.value) {
      const next = enabled.has(option.value)
      if (option.enabled() !== next) {
        store.dispatch(option.action, next)
      }
    }
  }
})

/** @type {import('vue').ComputedRef<boolean>} */
const backendFallback = computed(() => store.getters.getBackendFallback)

/**
 * @param {boolean} value
 */
function updateBackendFallback(value) {
  store.dispatch('updateBackendFallback', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const proxyVideos = computed(() => store.getters.getProxyVideos)

/**
 * @param {boolean} value
 */
function updateProxyVideos(value) {
  store.dispatch('updateProxyVideos', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const generalAutoLoadMorePaginatedItemsEnabled = computed(() => {
  return store.getters.getGeneralAutoLoadMorePaginatedItemsEnabled
})

/**
 * @param {boolean} value
 */
function updateGeneralAutoLoadMorePaginatedItemsEnabled(value) {
  store.dispatch('updateGeneralAutoLoadMorePaginatedItemsEnabled', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideToTrayOnMinimize = computed(() => store.getters.getHideToTrayOnMinimize)

/**
 * @param {boolean} value
 */
function updateHideToTrayOnMinimize(value) {
  store.dispatch('updateHideToTrayOnMinimize', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const openDeepLinksInNewWindow = computed(() => store.getters.getOpenDeepLinksInNewWindow)

/**
 * @param {boolean} value
 */
function updateOpenDeepLinksInNewWindow(value) {
  store.dispatch('updateOpenDeepLinksInNewWindow', value)
}

const updateRelativeTimestamps = computed(() => store.getters.getUpdateRelativeTimestamps)

/**
 * @param {boolean} value
 */
function updateRelativeTimestampsSetting(value) {
  store.dispatch('updateUpdateRelativeTimestamps', value)
}

const BACKEND_VALUES = process.env.SUPPORTS_LOCAL_API
  ? ['invidious', 'local']
  : ['invidious']

const backendNames = computed(() => {
  if (process.env.SUPPORTS_LOCAL_API) {
    return [
      t('Settings.General Settings.Preferred API Backend.Invidious API'),
      t('Settings.General Settings.Preferred API Backend.Local API')
    ]
  } else {
    return [
      t('Settings.General Settings.Preferred API Backend.Invidious API')
    ]
  }
})

/** @type {import('vue').ComputedRef<'local' | 'invidious'>} */
const backendPreference = computed(() => store.getters.getBackendPreference)

const showProxyVideosAsDisabled = computed(() => {
  return backendPreference.value !== 'invidious' && !backendFallback.value
})

/**
 * @param {'local' | 'invidious'} value
 */
function updateBackendPreference(value) {
  store.dispatch('updateBackendPreference', value)
}

const navigationItems = computed(() => store.getters.getNavigationItems)

const defaultPages = computed(() => {
  const routeByPath = new Map(router.getRoutes().map(route => [route.path.slice(1), route]))
  return filterAvailableNavigationItems(navigationItems.value, {
    supportsLocalApi: SUPPORTS_LOCAL_API,
    backendPreference: backendPreference.value,
    backendFallback: backendFallback.value,
    showWatchStats: store.getters.getRememberHistory && store.getters.getEnableWatchStats,
  })
    .map(id => routeByPath.get(id))
    .filter(route => route != null)
})

const defaultPageNames = computed(() => defaultPages.value.map((route) => translateWindowTitle(route.meta.title)))

const defaultPageValues = computed(() => {
  // avoid Vue parsing issues by excluding '/' from path values
  return defaultPages.value.map((route) => route.path.slice(1))
})

/** @type {import('vue').ComputedRef<'home' | 'subscriptions' | 'subscribedchannels' | 'popular' | 'userplaylists' | 'history' | 'trending' | 'stats'>} */
const landingPage = computed(() => store.getters.getLandingPage)

/**
 * @param {'home' | 'subscriptions' | 'subscribedChannels' | 'popular' | 'userPlaylists' | 'history' | 'trending'} value
 */
function updateLandingPage(value) {
  store.dispatch('updateLandingPage', value)
}

const NEW_TAB_POSITION_VALUES = ['end', 'afterCurrent', 'afterCurrentInOrder']

const newTabPositionNames = computed(() => [
  t('Settings.General Settings.New Tab Position.At the end'),
  t('Settings.General Settings.New Tab Position.After current tab'),
  t('Settings.General Settings.New Tab Position.After current tab in opened order')
])

/** @type {import('vue').ComputedRef<'end' | 'afterCurrent' | 'afterCurrentInOrder'>} */
const newTabPosition = computed(() => store.getters.getNewTabPosition)

/**
 * @param {'end' | 'afterCurrent' | 'afterCurrentInOrder'} value
 */
function updateNewTabPosition(value) {
  store.dispatch('updateNewTabPosition', value)
}

const TAB_CLOSE_FOCUS_VALUES = ['previousTab', 'nextTab']

const tabCloseFocusNames = computed(() => [
  t('Settings.General Settings.Tab Close Focus.Previous tab'),
  t('Settings.General Settings.Tab Close Focus.Next tab')
])

/** @type {import('vue').ComputedRef<'previousTab' | 'nextTab'>} */
const tabCloseFocus = computed(() => store.getters.getTabCloseFocus)

/**
 * @param {'previousTab' | 'nextTab'} value
 */
function updateTabCloseFocus(value) {
  store.dispatch('updateTabCloseFocus', value)
}

const STARTUP_BEHAVIOR_VALUES = ['loadAllTabs', 'restoreTabLoadState', 'loadLastActiveTab', 'emptySession']

const startupBehaviorNames = computed(() => [
  t('Settings.General Settings.Startup Behavior.Load all tabs'),
  t('Settings.General Settings.Startup Behavior.Load previously loaded tabs'),
  t('Settings.General Settings.Startup Behavior.Load last active tab'),
  t('Settings.General Settings.Startup Behavior.Start with an empty session')
])

/** @type {import('vue').ComputedRef<'loadAllTabs' | 'restoreTabLoadState' | 'loadLastActiveTab' | 'emptySession'>} */
const startupBehavior = computed(() => store.getters.getStartupBehavior)

/**
 * @param {'loadAllTabs' | 'restoreTabLoadState' | 'loadLastActiveTab' | 'emptySession'} value
 */
function updateStartupBehavior(value) {
  store.dispatch('updateStartupBehavior', value)
}

const VIEW_TYPE_VALUES = ['grid', 'list']

const viewTypeNames = computed(() => [
  t('Settings.General Settings.Video View Type.Grid'),
  t('Settings.General Settings.Video View Type.List')
])

/** @type {import('vue').ComputedRef<'grid' | 'list'>} */
const listType = computed(() => store.getters.getListType)

/**
 * @param {'grid' | 'list'} value
 */
function updateListType(value) {
  store.dispatch('updateListType', value)
}

/** @type {import('vue').ComputedRef<'grid' | 'list'>} */
const playlistViewType = computed(() => store.getters.getPlaylistViewType)

/**
 * @param {'grid' | 'list'} value
 */
function updatePlaylistViewType(value) {
  store.dispatch('updatePlaylistViewType', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const showThumbnailPreviews = computed(() => store.getters.getShowThumbnailPreviews)

/**
 * @param {boolean} value
 */
function updateShowThumbnailPreviews(value) {
  store.dispatch('updateShowThumbnailPreviews', value)
}

const THUMBNAIL_TYPE_VALUES = ['', 'start', 'middle', 'end', 'hidden', 'blur']

const thumbnailTypeNames = computed(() => [
  t('Settings.General Settings.Thumbnail Preference.Default'),
  t('Settings.General Settings.Thumbnail Preference.Beginning'),
  t('Settings.General Settings.Thumbnail Preference.Middle'),
  t('Settings.General Settings.Thumbnail Preference.End'),
  t('Settings.General Settings.Thumbnail Preference.Hidden'),
  t('Settings.General Settings.Thumbnail Preference.Blur')
])

/** @type {import('vue').ComputedRef<boolean>} */
const blurThumbnails = computed(() => store.getters.getBlurThumbnails)

/** @type {import('vue').ComputedRef<'' | 'start' | 'middle' | 'end' | 'hidden' | 'blur'>} */
const thumbnailPreference = computed(() => {
  if (blurThumbnails.value) return 'blur'
  // Quick settings can turn blurring off independently of the thumbnail style.
  const preference = store.getters.getThumbnailPreference
  return preference === 'blur' ? '' : preference
})

const thumbnailPreferenceChanged = computed(() => (
  blurThumbnails.value !== DEFAULT_SETTINGS.blurThumbnails ||
  store.getters.getThumbnailPreference !== DEFAULT_SETTINGS.thumbnailPreference
))

/**
 * @param {'' | 'start' | 'middle' | 'end' | 'hidden' | 'blur'} value
 */
function handleThumbnailPreferenceChange(value) {
  store.dispatch('updateBlurThumbnails', value === 'blur')
  store.dispatch('updateThumbnailPreference', value)
}

function resetThumbnailPreference() {
  store.dispatch('updateBlurThumbnails', DEFAULT_SETTINGS.blurThumbnails)
  store.dispatch('updateThumbnailPreference', DEFAULT_SETTINGS.thumbnailPreference)
}

const enableDownloads = computed(() => store.getters.getEnableDownloads)

/** @type {import('vue').ComputedRef<'' | 'history' | 'copyYoutube' | 'openYoutube' | 'download'>} */
const extraThumbnailAction = computed(() => store.getters.getExtraThumbnailAction)

const effectiveExtraThumbnailAction = computed(() => (
  !enableDownloads.value && extraThumbnailAction.value === 'download'
    ? ''
    : extraThumbnailAction.value
))

const extraThumbnailActionValues = computed(() => [
  '',
  'history',
  'copyYoutube',
  'openYoutube',
  ...(process.env.IS_ELECTRON && enableDownloads.value ? ['download'] : [])
])

const extraThumbnailActionNames = computed(() => [
  t('Settings.General Settings.Extra Thumbnail Action Button.None'),
  t('Settings.General Settings.Extra Thumbnail Action Button.Mark as Watched'),
  t('Settings.General Settings.Extra Thumbnail Action Button.Copy YouTube Link'),
  t('Settings.General Settings.Extra Thumbnail Action Button.Open in YouTube'),
  ...(process.env.IS_ELECTRON && enableDownloads.value ? [t('Downloads.Download Video')] : [])
])

/**
 * @param {'' | 'history' | 'copyYoutube' | 'openYoutube' | 'download'} value
 */
function updateExtraThumbnailAction(value) {
  store.dispatch('updateExtraThumbnailAction', value)
}

const LOCALE_VALUES = ['system', ...allLocales]

const localeNames = computed(() => [
  t('Settings.General Settings.System Default'),
  ...process.env.LOCALE_NAMES.map((name, index) => `${name} (${localeTranslationPercentages.value[index]}%)`)
])

/** @type {import('vue').ComputedRef<string>} */
const currentLocale = computed(() => store.getters.getCurrentLocale)

/** @type {import('vue').ComputedRef<boolean>} */
const useAITranslationCompletions = computed(() => store.getters.getUseAITranslationCompletions)

const aiTranslationCompletionsDisabled = computed(() => {
  const selectedLocale = currentLocale.value === 'system' ? locale.value : currentLocale.value
  const localeIndex = allLocales.indexOf(selectedLocale)
  return localeTranslationPercentages.value[localeIndex] === 100
})

/**
 * @param {string} value
 */
function updateCurrentLocale(value) {
  store.dispatch('updateCurrentLocale', value)
}

/** @type {import('vue').ComputedRef<string>} */
const dateFormat = computed(() => normalizeDateFormat(store.getters.getDateFormat))

const dateFormatNames = computed(() => [
  `${t('Settings.General Settings.Language Default')} (${formatDate(new Date(), locale.value, 'locale')})`,
  ...DATE_FORMAT_OPTIONS.slice(1),
])

/** @param {string} value */
function updateDateFormat(value) {
  store.dispatch('updateDateFormat', value)
}

/** @type {import('vue').ComputedRef<string>} */
const timeFormat = computed(() => normalizeTimeFormat(store.getters.getTimeFormat))

const timeFormatNames = computed(() => {
  const example = new Date()
  const options = { hour: 'numeric', minute: '2-digit' }

  return [
    `${t('Settings.General Settings.Language Default')} (${formatTime(example, locale.value, 'locale', options)})`,
    `12h (${formatTime(example, locale.value, '12-hour', options)})`,
    `24h (${formatTime(example, locale.value, '24-hour', options)})`,
  ]
})

/** @param {string} value */
function updateTimeFormat(value) {
  store.dispatch('updateTimeFormat', value)
}

/** @param {boolean} value */
function updateUseAITranslationCompletions(value) {
  store.dispatch('updateUseAITranslationCompletions', value)
}

const REDUCED_MOTION_VALUES = ['system', 'on', 'off']

const reducedMotionNames = computed(() => [
  t('Settings.General Settings.Reduced Motion.System'),
  t('Settings.General Settings.Reduced Motion.Force On'),
  t('Settings.General Settings.Reduced Motion.Force Off')
])

/** @type {import('vue').ComputedRef<'system' | 'on' | 'off'>} */
const reducedMotion = computed(() => store.getters.getReducedMotion)

/**
 * @param {'system' | 'on' | 'off'} value
 */
function updateReducedMotion(value) {
  store.dispatch('updateReducedMotion', value)
}

/** @type {import('vue').ComputedRef<'disabled' | 'watch_only' | 'entire_app'>} */
const avoidTranslation = computed(() => store.getters.getAvoidTranslation)

/**
 * @param {'disabled' | 'watch_only' | 'entire_app'} value
 */
function updateAvoidTranslation(value) {
  store.dispatch('updateAvoidTranslation', value)
}

const AVOID_TRANSLATION_VALUES = ['disabled', 'watch_only', 'entire_app']

const avoidTranslationNames = computed(() => [
  t('Settings.General Settings.Avoid translation.Disabled'),
  t('Settings.General Settings.Avoid translation.Watch Only'),
  t('Settings.General Settings.Avoid translation.Entire App')
])

/** @type {import('vue').ComputedRef<string[]>} */
const regionNames = computed(() => store.getters.getRegionNames)

/** @type {import('vue').ComputedRef<string[]>} */
const regionValues = computed(() => store.getters.getRegionValues)

const regionDataLoaded = computed(() => regionValues.value.length > 0)

/** @type {import('vue').ComputedRef<string>} */
const region = computed(() => store.getters.getRegion)

/**
 * @param {string} value
 */
function updateRegion(value) {
  store.dispatch('updateRegion', value)
}

/** @type {import('vue').ComputedRef<string[]>} */
const invidiousInstancesList = computed(() => store.getters.getInvidiousInstancesList)

/** @type {import('vue').ComputedRef<string>} */
const currentInvidiousInstance = computed(() => store.getters.getCurrentInvidiousInstance)

onBeforeUnmount(() => {
  if (currentInvidiousInstance.value === '') {
    // FIXME: If we call an action from here, there's no guarantee it will finish
    // before the component is destroyed, which could bring up some problems
    // Since I can't see any way to await it (because lifecycle hooks must be
    // synchronous), unfortunately, we have to copy/paste the logic
    // from the `setRandomCurrentInvidiousInstance` action onto here
    // Fix when we migrate to Pinia
    const instanceList = invidiousInstancesList.value
    store.commit('setCurrentInvidiousInstance', randomArrayItem(instanceList))
  }
})

const setCurrentInvidiousInstanceBounce = debounce((/** @type {string} */instance) => {
  store.commit('setCurrentInvidiousInstance', instance)
}, 500)

/**
 * @param {string} input
 */
function handleInvidiousInstanceInput(input) {
  let instance = input
  // If NOT something like https:// (1-2 slashes), remove trailing slash
  if (!/^https?:\/{1,2}$/.test(input)) {
    instance = input.replace(/\/$/, '')
  }

  setCurrentInvidiousInstanceBounce(instance)
}

/** @type {import('vue').ComputedRef<string>} */
const defaultInvidiousInstance = computed(() => store.getters.getDefaultInvidiousInstance)

function handleSetDefaultInstanceClick() {
  const instance = currentInvidiousInstance.value
  store.dispatch('updateDefaultInvidiousInstance', instance)

  const message = t('Default Invidious instance has been set to {instance}', { instance })
  showToast({ message: message, icon: ['fas', 'check'] })
}

function handleClearDefaultInstanceClick() {
  store.dispatch('updateDefaultInvidiousInstance', '')
  showToast({ message: t('Default Invidious instance has been cleared'), icon: ['fas', 'trash'] })
}
</script>

<style scoped src="./GeneralSettings.css" />
