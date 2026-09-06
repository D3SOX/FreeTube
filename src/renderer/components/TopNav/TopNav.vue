<template>
  <nav
    class="topNav"
    :class="{ topNavBarColor: barColor }"
  >
    <div class="topNavInner">
      <div class="side">
        <button
          class="menuButton navButton"
          :aria-label="expandCollapseSideBarLabel"
          :title="expandCollapseSideBarLabel"
          @click="toggleSideNav"
        >
          <FtIcon
            class="navIcon"
            :icon="['fas', 'bars']"
          />
        </button>
        <FtIconButton
          class="navIconButton"
          :disabled="isArrowBackwardDisabled"
          :class="{ arrowDisabled: isArrowBackwardDisabled }"
          :icon="['fas', 'arrow-left']"
          :theme="null"
          :size="20"
          :use-shadow="false"
          dropdown-position-x="right"
          :dropdown-options="navigationHistoryDropdownOptions"
          open-on-right-or-long-click
          :title="backwardText"
          @click="historyBack"
        />
        <FtIconButton
          class="navIconButton"
          :disabled="isArrowForwardDisabled"
          :class="{ arrowDisabled: isArrowForwardDisabled }"
          :icon="['fas', 'arrow-right']"
          :theme="null"
          :size="20"
          :use-shadow="false"
          dropdown-position-x="right"
          :dropdown-options="navigationHistoryDropdownOptions"
          open-on-right-or-long-click
          :title="forwardText"
          @click="historyForward"
        />
        <button
          v-if="!hideSearchBar"
          class="navSearchButton navButton"
          :aria-label="t('Search Bar.Open Search Container')"
          :title="t('Search Bar.Open Search Container')"
          data-tutorial="search"
          @click="toggleSearchContainer"
        >
          <FtIcon
            class="navIcon"
            :icon="['fas', 'search']"
          />
        </button>
        <RouterLink
          v-if="!hideHeaderLogo"
          class="logo"
          dir="ltr"
          :title="headerLogoTitle"
          :to="landingPage"
        >
          <div
            class="logoIcon"
          />
          <div
            class="logoText"
          />
        </RouterLink>
      </div>
      <div class="middle">
        <div
          v-if="!hideSearchBar"
          v-show="showSearchContainer"
          ref="searchContainer"
          class="searchContainer"
          data-tutorial="search"
        >
          <FtInput
            ref="searchInput"
            :placeholder="t('Search / Go to URL')"
            class="searchInput"
            is-search
            :action-button-label="t('Search Bar.Search')"
            :data-list="activeDataList"
            :data-list-properties="activeDataListProperties"
            show-clear-text-button
            show-data-when-empty
            @input="getSearchSuggestionsDebounce"
            @click="goToSearch"
            @clear="handleSearchInputClear"
            @remove="removeSearchHistoryEntryInDbAndCache"
          >
            <template #extraAction>
              <button
                type="button"
                class="navFilterButton navButton"
                :class="{ filterChanged: searchFilterValueChanged }"
                :aria-label="t('Search Filters.Search Filters')"
                :title="t('Search Filters.Search Filters')"
                @click="showSearchFilters"
                @contextmenu.stop.prevent="clearSearchFilters"
              >
                <FtIcon
                  class="navIcon"
                  :icon="['fas', 'filter']"
                />
              </button>
            </template>
          </FtInput>
        </div>
      </div>
      <div class="side profiles">
        <button
          v-if="settingsWindowMinimized"
          type="button"
          class="minimizedUtilityButton navButton"
          :class="{ utilityWindowMorphTarget: settingsWindowMorphing }"
          :aria-label="restoreSettingsWindowLabel"
          :title="restoreSettingsWindowLabel"
          @click="restoreSettingsWindow"
        >
          <FtIcon
            class="navIcon"
            :icon="minimizedSettingsWindowIcon"
          />
        </button>
        <button
          v-if="showDownloadsButton"
          type="button"
          class="downloadsButton navButton"
          :class="{ active: downloadsWindowOpen }"
          :aria-label="t('Settings.Download Settings.Download Settings')"
          :title="t('Settings.Download Settings.Download Settings')"
          :aria-pressed="downloadsWindowOpen"
          @click="toggleDownloadsWindow"
        >
          <FtIcon
            class="navIcon"
            :icon="['fas', 'download']"
          />
        </button>
        <button
          v-if="showSettingsButton"
          type="button"
          class="settingsButton navButton"
          :class="{ active: settingsWindowOpen }"
          :aria-label="t('Settings.Settings')"
          :title="t('Settings.Settings')"
          :aria-pressed="settingsWindowOpen"
          @click="toggleSettingsWindow"
        >
          <FtIcon
            class="navIcon"
            :icon="['fas', 'cog']"
          />
        </button>
        <CapacitorPhoneTabSwitcher @request-exit="emit('request-android-exit')" />
        <FtQuickSettingsMenu />
      </div>
    </div>
  </nav>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import FtInput from '../FtInput/FtInput.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import FtQuickSettingsMenu from '../FtQuickSettingsMenu/FtQuickSettingsMenu.vue'
import CapacitorPhoneTabSwitcher from '../TabBar/CapacitorPhoneTabSwitcher.vue'

import store from '../../store/index'

import { getConfiguredKeyboardShortcuts, MOBILE_WIDTH_THRESHOLD, SEARCH_RESULTS_DISPLAY_LIMIT } from '../../../constants'
import { matchesKeyboardShortcut } from '../../helpers/keyboardShortcuts'
import { getSearchHistoryEntryQuery } from '../../../search-history'
import { debounce, localizeAndAddKeyboardShortcutToActionTitle, openInternalPath } from '../../helpers/utils'
import { translateWindowTitle } from '../../helpers/strings'
import { clearLocalSearchSuggestionsSession, getLocalSearchSuggestions } from '../../helpers/api/local'
import { getInvidiousSearchSuggestions } from '../../helpers/api/invidious'
import { getTabNavigationService } from '../../tabs/TabNavigationService'

const { t } = useI18n()
const emit = defineEmits(['request-android-exit'])
const appKeyboardShortcuts = computed(() => getConfiguredKeyboardShortcuts(
  store.getters.getKeyboardShortcuts
).APP.GENERAL)
const router = useRouter()
const route = useRoute()
const usesLogicalTabs = process.env.IS_ELECTRON || process.env.IS_CAPACITOR
const navigation = usesLogicalTabs ? getTabNavigationService() : null

const showSearchContainer = ref(true)
const logicalHistoryState = computed(() => {
  const tabId = store.getters.getPresentedTabId
  return store.getters.getTabHistoryState(tabId)
})
const navigationHistoryDropdownOptions = computed(() => {
  return usesLogicalTabs ? logicalHistoryState.value.options : []
})
/** @type {import('vue').ShallowRef<string[]>} */
const searchSuggestionsDataList = shallowRef([])
const lastSuggestionQuery = ref('')

/** @type {import('vue').ComputedRef<boolean>} */
const hideSearchBar = computed(() => store.getters.getHideSearchBar)
/** @type {import('vue').ComputedRef<boolean>} */
const hideHeaderLogo = computed(() => store.getters.getHideHeaderLogo)
const useWatchSideNavOverlay = computed(() => {
  return store.getters.getHideSideBarOnWatchPages && route.path.startsWith('/watch/')
})
/** @type {import('vue').ComputedRef<boolean>} */
const enableSearchSuggestions = computed(() => store.getters.getEnableSearchSuggestions)
/** @type {import('vue').ComputedRef<string>} */
const barColor = computed(() => store.getters.getBarColor)
const expandCollapseSideBarLabel = computed(() => {
  return store.getters.getIsSideNavOpen ? t('Compact side navigation') : t('Expand side navigation')
})

const landingPage = computed(() => '/' + store.getters.getLandingPage)

const headerLogoTitle = computed(() => {
  return t('Go to page', {
    page: translateWindowTitle(
      router.getRoutes()
        .find((route) => route.path === landingPage.value)
        .meta.title)
  })
})

const navigationHistoryAddendum = computed(() => {
  return navigationHistoryDropdownOptions.value.length === 0
    ? ''
    : `\n${t('Right-click or hold to see history')}`
})

const backwardText = computed(() => {
  const shortcuts = process.platform === 'darwin'
    ? [
        appKeyboardShortcuts.value.HISTORY_BACKWARD,
        appKeyboardShortcuts.value.HISTORY_BACKWARD_ALT_MAC
      ]
    : appKeyboardShortcuts.value.HISTORY_BACKWARD

  return localizeAndAddKeyboardShortcutToActionTitle(
    t('Back'),
    shortcuts
  ) + navigationHistoryAddendum.value
})

const forwardText = computed(() => {
  const shortcuts = process.platform === 'darwin'
    ? [
        appKeyboardShortcuts.value.HISTORY_FORWARD,
        appKeyboardShortcuts.value.HISTORY_FORWARD_ALT_MAC
      ]
    : appKeyboardShortcuts.value.HISTORY_FORWARD

  return localizeAndAddKeyboardShortcutToActionTitle(
    t('Forward'),
    shortcuts
  ) + navigationHistoryAddendum.value
})

/**
 * @param {number} offset
 */
function goToOffset(offset) {
  if (offset === 0) {
    return
  }

  if (usesLogicalTabs) {
    const tabId = store.getters.getPresentedTabId
    if (tabId) {
      navigation.go(tabId, offset)
    }
  } else {
    router.go(offset)
  }
}

/**
 * @param {number} [offset]
 */
function historyBack(offset) {
  goToOffset(offset ?? -1)
}

/**
 * @param {number} [offset]
 */
function historyForward(offset) {
  goToOffset(offset ?? 1)
}

const isElectron = process.env.IS_ELECTRON
const enableDownloads = computed(() => store.getters.getEnableDownloads)
const moveDownloadsToAppHeader = computed(() => store.getters.getMoveDownloadsToAppHeader)
const moveSettingsToAppHeader = computed(() => store.getters.getMoveSettingsToAppHeader)
const settingsWindowMinimized = computed(() => store.getters.getSettingsWindowMinimized)
const settingsWindowMorphing = computed(() => store.getters.getSettingsWindowMorphing)
const settingsWindowView = computed(() => store.getters.getSettingsWindowView)
const downloadsWindowOpen = computed(() => (
  store.getters.getSettingsWindowOpen &&
  store.getters.getSettingsWindowView === 'downloads'
))
const settingsWindowOpen = computed(() => (
  store.getters.getSettingsWindowOpen &&
  !['about', 'downloads'].includes(store.getters.getSettingsWindowView)
))
const showDownloadsButton = computed(() => (
  isElectron &&
  enableDownloads.value &&
  moveDownloadsToAppHeader.value &&
  !(settingsWindowMinimized.value && settingsWindowView.value === 'downloads')
))
const showSettingsButton = computed(() => (
  isElectron &&
  moveSettingsToAppHeader.value &&
  !(settingsWindowMinimized.value && !['about', 'downloads'].includes(settingsWindowView.value))
))
const minimizedSettingsWindowTitle = computed(() => {
  if (settingsWindowView.value === 'about') return t('About.About')
  if (settingsWindowView.value === 'downloads') return t('Settings.Download Settings.Download Settings')
  return t('Settings.Settings')
})
const minimizedSettingsWindowIcon = computed(() => {
  if (settingsWindowView.value === 'about') return ['fas', 'info-circle']
  if (settingsWindowView.value === 'downloads') return ['fas', 'download']
  return ['fas', 'cog']
})
const restoreSettingsWindowLabel = computed(() => `${t('Restore')}: ${minimizedSettingsWindowTitle.value}`)

function toggleDownloadsWindow() {
  store.dispatch(downloadsWindowOpen.value ? 'hideSettingsWindow' : 'showSettingsWindow', 'downloads')
}

function toggleSettingsWindow() {
  store.dispatch(settingsWindowOpen.value ? 'hideSettingsWindow' : 'showSettingsWindow')
}

function restoreSettingsWindow() {
  store.dispatch('restoreSettingsWindow')
}

const usingOnlySearchHistoryResults = computed(() => lastSuggestionQuery.value.length === 0)

/** @type {import('vue').ComputedRef<object[]>} */
const latestMatchingSearchHistoryEntries = computed(() => {
  return store.getters.getLatestMatchingSearchHistoryEntries(lastSuggestionQuery.value)
})

/** @type {import('vue').ComputedRef<object[]>} */
const latestSearchHistoryEntries = computed(() => store.getters.getLatestSearchHistoryEntries)

const activeSearchHistoryEntries = computed(() => usingOnlySearchHistoryResults.value
  ? latestSearchHistoryEntries.value
  : latestMatchingSearchHistoryEntries.value)

const searchFilterLabels = computed(() => ({
  prioritize: {
    popularity: t('Search Filters.Prioritize.Popularity'),
  },
  time: {
    today: t('Search Filters.Time.Today'),
    week: t('Search Filters.Time.This Week'),
    month: t('Search Filters.Time.This Month'),
    year: t('Search Filters.Time.This Year'),
  },
  type: {
    video: t('Search Filters.Type.Videos'),
    shorts: t('Global.Shorts'),
    channel: t('Search Filters.Type.Channels'),
    playlist: t('Playlists'),
    movie: t('Search Filters.Type.Movies'),
  },
  duration: {
    under_three_mins: t('Search Filters.Duration.< 3 minutes'),
    three_to_twenty_mins: t('Search Filters.Duration.3 - 20 minutes'),
    over_twenty_mins: t('Search Filters.Duration.> 20 minutes'),
  },
  features: {
    live: t('Search Filters.Features.Live'),
    '4k': t('Search Filters.Features.4K'),
    hd: t('Search Filters.Features.HD'),
    subtitles: t('Search Filters.Features.Subtitles'),
    creative_commons: t('Search Filters.Features.Creative Commons'),
    360: t('Search Filters.Features.360 Video'),
    vr180: t('Search Filters.Features.VR180'),
    '3d': t('Search Filters.Features.3D'),
    hdr: t('Search Filters.Features.HDR'),
    location: t('Search Filters.Features.Location'),
  },
}))

/**
 * @param {{ query: string, searchSettings: object }} entry
 * @returns {string}
 */
function getSearchHistoryEntryDisplayText(entry) {
  const settings = entry.searchSettings
  const filterLabels = ['prioritize', 'time', 'type', 'duration']
    .map(group => searchFilterLabels.value[group][settings[group]])
    .filter(Boolean)

  for (const feature of settings.features) {
    filterLabels.push(searchFilterLabels.value.features[feature] ?? feature)
  }

  return filterLabels.length === 0
    ? entry.query
    : `${entry.query} (${filterLabels.join(', ')})`
}

/** @type {import('vue').ComputedRef<string>} */
const searchFilterTabId = computed(() => usesLogicalTabs
  ? (store.getters.getPresentedTabId ?? 'web')
  : 'web')

/** @type {import('vue').ComputedRef<any>} */
const searchSettings = computed(() => store.getters.getSearchSettings(searchFilterTabId.value))

const activeDataList = computed(() => {
  // show latest search history when the search bar is empty
  if (usingOnlySearchHistoryResults.value) {
    return latestSearchHistoryEntries.value.map(getSearchHistoryEntryQuery)
  }

  const searchHistoryNames = latestMatchingSearchHistoryEntries.value.map(getSearchHistoryEntryQuery)
  const searchResults = [...searchHistoryNames]

  if (enableSearchSuggestions.value) {
    for (const searchSuggestion of searchSuggestionsDataList.value) {
      // prevent duplicate results between search history entries and YT search suggestions
      if (searchHistoryNames.includes(searchSuggestion)) {
        continue
      }

      searchResults.push(searchSuggestion)

      if (searchResults.length === SEARCH_RESULTS_DISPLAY_LIMIT) {
        break
      }
    }
  }

  return searchResults
})

const searchHistoryEntriesCount = computed(() => activeSearchHistoryEntries.value.length)

const searchResultHrefs = shallowRef([])

const activeDataListProperties = computed(() => {
  const properties = []

  for (let i = 0; i < activeDataList.value.length; i++) {
    const href = searchResultHrefs.value[i]
    const searchHistoryEntry = activeSearchHistoryEntries.value[i]

    properties.push(i < searchHistoryEntriesCount.value
      ? {
          isLink: true,
          isRemoveable: true,
          isSearchHistory: true,
          iconName: 'clock-rotate-left',
          href,
          displayText: getSearchHistoryEntryDisplayText(searchHistoryEntry),
          ariaLabel: getSearchHistoryEntryDisplayText(searchHistoryEntry),
        }
      : { isLink: true, isRemoveable: false, isSearchHistory: false, iconName: 'magnifying-glass', href }
    )
  }

  return properties
})

const isArrowBackwardDisabled = computed(() => {
  if (usesLogicalTabs) {
    return !logicalHistoryState.value.canGoBack
  }

  // Reading the route makes this computed refresh after browser navigation.
  const hasCurrentRoute = typeof route.fullPath === 'string'
  return hasCurrentRoute && 'navigation' in window ? !window.navigation.canGoBack : false
})
const isArrowForwardDisabled = computed(() => {
  if (usesLogicalTabs) {
    return !logicalHistoryState.value.canGoForward
  }

  const hasCurrentRoute = typeof route.fullPath === 'string'
  return hasCurrentRoute && 'navigation' in window ? !window.navigation.canGoForward : false
})

function toggleSideNav() {
  store.commit('toggleSideNav')
}

const searchFilterValueChanged = computed(() => {
  return store.getters.getSearchFilterValueChanged(searchFilterTabId.value)
})

function showSearchFilters() {
  store.dispatch('showSearchFilters')
}

function clearSearchFilters() {
  const tabId = searchFilterTabId.value
  store.commit('setSearchPrioritize', { tabId, value: 'relevance' })
  store.commit('setSearchTime', { tabId, value: '' })
  store.commit('setSearchType', { tabId, value: 'all' })
  store.commit('setSearchDuration', { tabId, value: '' })
  store.commit('setSearchFeatures', { tabId, value: [] })
  store.commit('setSearchFilterValueChanged', { tabId, value: false })
}

const searchContainer = useTemplateRef('searchContainer')
const searchInput = useTemplateRef('searchInput')

// The search bar renders once for the whole window and is shared by every
// logical tab, so its text has to be persisted per tab to stay independent.
// Mirror the live input value here since FtInput doesn't expose a getter.
const searchTextByTabId = new Map()
let currentSearchText = ''

/**
 * @param {string} path
 * @returns {string | null}
 */
function getSearchTextFromPath(path) {
  const encodedQuery = path.match(/^\/search\/(.+)$/)?.[1]
  if (encodedQuery == null) {
    return null
  }

  try {
    return decodeURIComponent(encodedQuery)
  } catch {
    return encodedQuery
  }
}

/**
 * @param {string} tabId
 * @returns {string}
 */
function getSearchTextForTab(tabId) {
  if (searchTextByTabId.has(tabId)) {
    return searchTextByTabId.get(tabId) ?? ''
  }

  const path = store.getters.getTabById(tabId)?.route.path ?? ''
  return getSearchTextFromPath(path) ?? ''
}

const presentedRoutePath = computed(() => {
  if (!usesLogicalTabs) {
    return route.path
  }

  const tabId = store.getters.getPresentedTabId
  return store.getters.getTabById(tabId)?.route.path ?? ''
})

watch([searchFilterTabId, presentedRoutePath], ([tabId, path], [previousTabId]) => {
  // Tab switches restore that tab's cached draft in the watcher below. Route
  // changes within one tab restore the submitted query from navigation history.
  if (tabId !== previousTabId) {
    return
  }

  const searchText = getSearchTextFromPath(path)
  if (searchText != null) {
    updateSearchInputText(searchText)
    clearLastSuggestionQuery()
  }
})

if (usesLogicalTabs) {
  const presentedTabId = computed(() => store.getters.getPresentedTabId)

  watch(presentedTabId, (tabId, previousTabId) => {
    // Skip the initial null -> id transition during startup so we don't clobber
    // text that was pre-filled for this tab (e.g. a search carried into a new
    // window). A search route is the exception: restored tabs have no cached
    // input text, so hydrate it from the route itself.
    if (previousTabId == null) {
      if (tabId != null) {
        const searchText = getSearchTextForTab(tabId)
        if (searchText.length > 0) {
          updateSearchInputText(searchText)
        }
      }
      return
    }

    searchTextByTabId.set(previousTabId, currentSearchText)
    updateSearchInputText(tabId != null ? getSearchTextForTab(tabId) : '')
    clearLastSuggestionQuery()
  })
}

/**
 * @param {string} queryText
 * @param {object | null} selectedSearchSettings
 * @returns {Promise<{ path: string, query?: object, searchQueryText: string }>}
 */
async function getSearchDestination(queryText, selectedSearchSettings = null) {
  const result = await store.dispatch('getYoutubeUrlInfo', queryText)

  switch (result.urlType) {
    case 'video': {
      const { videoId, timestamp, playlistId, commentId, isShort } = result
      const query = {}

      if (isShort) query.short = 'true'
      if (timestamp) query.timestamp = timestamp
      if (playlistId?.length > 0) query.playlistId = playlistId
      if (commentId) query.commentId = commentId

      return { path: `/watch/${videoId}`, query, searchQueryText: queryText }
    }

    case 'playlist':
      return {
        path: `/playlist/${result.playlistId}`,
        query: result.query,
        searchQueryText: queryText
      }

    case 'search':
      return {
        path: `/search/${encodeURIComponent(result.searchQuery)}`,
        query: result.query,
        searchQueryText: result.searchQuery
      }

    case 'hashtag':
      return {
        path: `/hashtag/${encodeURIComponent(result.hashtag)}`,
        searchQueryText: `#${result.hashtag}`
      }

    case 'post':
      return {
        path: `/post/${result.postId}`,
        query: result.query,
        searchQueryText: queryText
      }

    case 'channel':
      return {
        path: `/channel/${result.channelId}/${result.subPath}`,
        query: { url: result.url },
        searchQueryText: queryText
      }

    case 'trending':
    case 'subscriptions':
    case 'history':
    case 'userplaylists':
      return { path: `/${result.urlType}`, searchQueryText: queryText }

    case 'invalid_url':
    default: {
      const settings = selectedSearchSettings ?? searchSettings.value
      return {
        path: `/search/${encodeURIComponent(queryText)}`,
        query: {
          prioritize: settings.prioritize,
          time: settings.time,
          type: settings.type,
          duration: settings.duration,
          features: [...settings.features],
        },
        searchQueryText: queryText
      }
    }
  }
}

let searchHrefRequestId = 0
watch([activeDataList, activeSearchHistoryEntries, searchSettings], async ([dataList, searchHistoryEntries]) => {
  const requestId = ++searchHrefRequestId
  const hrefs = await Promise.all(dataList.map(async (queryText, index) => {
    const searchHistoryEntry = searchHistoryEntries[index] ?? null
    const destination = await getSearchDestination(queryText, searchHistoryEntry?.searchSettings)
    return router.resolve({ path: destination.path, query: destination.query }).href
  }))

  if (requestId === searchHrefRequestId) {
    searchResultHrefs.value = hrefs
  }
}, { deep: true, immediate: true })

/**
 * @param {string} queryText
 * @param {object} options
 * @param {MouseEvent | KeyboardEvent} options.event
 * @param {number} [options.dataListIndex]
 */
async function goToSearch(queryText, { event, dataListIndex }) {
  const doCreateNewWindow = event && event.shiftKey
  const ctrlOrCmdPressed = event && ((process.platform !== 'darwin' && event.ctrlKey) ||
    (process.platform === 'darwin' && event.metaKey))
  const isMiddleClick = event?.type === 'auxclick' && event.button === 1
  const doCreateNewTab = (ctrlOrCmdPressed || isMiddleClick) && !doCreateNewWindow
  const makeActive = !isMiddleClick

  if (!isMiddleClick) {
    if (window.innerWidth <= MOBILE_WIDTH_THRESHOLD) {
      searchContainer.value.blur()
      showSearchContainer.value = false
    } else {
      searchInput.value.blur()
    }
  }

  clearLocalSearchSuggestionsSession()

  const selectedSearchHistoryEntry = activeDataListProperties.value[dataListIndex]?.isSearchHistory
    ? activeSearchHistoryEntries.value[dataListIndex]
    : null
  const selectedSearchSettings = selectedSearchHistoryEntry?.searchSettings

  if (selectedSearchSettings != null && !doCreateNewTab && !doCreateNewWindow) {
    const tabId = searchFilterTabId.value
    store.commit('setSearchPrioritize', { tabId, value: selectedSearchSettings.prioritize })
    store.commit('setSearchTime', { tabId, value: selectedSearchSettings.time })
    store.commit('setSearchType', { tabId, value: selectedSearchSettings.type })
    store.commit('setSearchDuration', { tabId, value: selectedSearchSettings.duration })
    store.commit('setSearchFeatures', { tabId, value: [...selectedSearchSettings.features] })
    store.commit('setSearchFilterValueChanged', {
      tabId,
      value: selectedSearchSettings.prioritize !== 'relevance' ||
      selectedSearchSettings.time !== '' ||
      selectedSearchSettings.type !== 'all' ||
      selectedSearchSettings.duration !== '' ||
      selectedSearchSettings.features.length > 0
    })
  }

  const destination = await getSearchDestination(queryText, selectedSearchSettings)
  openInternalPath({
    ...destination,
    doCreateNewWindow,
    doCreateNewTab,
    makeActive,
  })

  if (doCreateNewWindow) {
    // Query text copied to new window = can be removed from current window
    updateSearchInputText('')
  }
}

function clearLastSuggestionQuery() {
  lastSuggestionQuery.value = ''
}

function handleSearchInputClear() {
  currentSearchText = ''
  clearLastSuggestionQuery()
}

/**
 * @param {string} text
 */
function updateSearchInputText(text) {
  currentSearchText = text
  searchInput.value?.setText(text)
}

/**
 * @param {string} query
 */
function getSearchSuggestionsDebounce(query) {
  currentSearchText = query

  if (query === lastSuggestionQuery.value) {
    return
  }

  lastSuggestionQuery.value = query

  if (enableSearchSuggestions.value) {
    debounceSearchResults(query.trim())
  }
}

/** @type {import('vue').ComputedRef<'local' | 'invidious'>} */
const backendPreference = computed(() => store.getters.getBackendPreference)
/** @type {import('vue').ComputedRef<boolean>} */
const backendFallback = computed(() => store.getters.getBackendFallback)

const debounceSearchResults = debounce(/** @param {string} query */(query) => {
  if (!process.env.SUPPORTS_LOCAL_API || backendPreference.value === 'invidious') {
    getSearchSuggestionsInvidious(query)
  } else {
    getSearchSuggestionsLocal(query)
  }
}, 200)

/**
 * @param {string} query
 */
async function getSearchSuggestionsLocal(query) {
  searchSuggestionsDataList.value = query.length > 0
    ? await getLocalSearchSuggestions(query)
    : []
}

async function getSearchSuggestionsInvidious(query) {
  if (query === '') {
    searchSuggestionsDataList.value = []
    return
  }

  try {
    searchSuggestionsDataList.value = (await getInvidiousSearchSuggestions(query)).suggestions
  } catch (err) {
    console.error(err)

    if (process.env.SUPPORTS_LOCAL_API && backendFallback.value) {
      console.error(
        'Error gettings search suggestions.  Falling back to Local API'
      )
      getSearchSuggestionsLocal(query)
    }
  }
}

/**
 * @param {string} query
 * @param {object} options
 * @param {number} options.dataListIndex
 */
function removeSearchHistoryEntryInDbAndCache(query, { dataListIndex }) {
  const searchHistoryEntry = activeSearchHistoryEntries.value[dataListIndex]
  if (searchHistoryEntry == null) {
    return
  }

  store.dispatch('removeSearchHistoryEntry', searchHistoryEntry._id)
  store.commit('removeFromSessionSearchHistory', {
    query,
    searchSettings: searchHistoryEntry.searchSettings,
  })
}

function toggleSearchContainer() {
  showSearchContainer.value = !showSearchContainer.value
}

/**
 * @param {KeyboardEvent} event
 */
function handleKeyboardShortcuts(event) {
  const target = event.target
  const isTypingInInput = target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  const shortcuts = appKeyboardShortcuts.value
  const focusSearchShortcut = [
    shortcuts.FOCUS_SEARCH,
    shortcuts.FOCUS_SEARCH_ALT,
    ...process.platform === 'darwin' ? [shortcuts.FOCUS_SEARCH_ALT_MAC] : [],
  ].some(shortcut => matchesKeyboardShortcut(event, shortcut))
  const slashShortcut = matchesKeyboardShortcut(event, shortcuts.FOCUS_SEARCH_ALT_SLASH)

  if (
    !hideSearchBar.value &&
    (focusSearchShortcut || (slashShortcut && !isTypingInInput))
  ) {
    event.preventDefault()

    // In order to prevent Klipper's "Synchronize contents of the clipboard
    // and the selection" feature from being triggered when running
    // Chromium on KDE Plasma, it seems both focus() focus and
    // select() have to be called asynchronously (see issue #2019).
    setTimeout(() => {
      searchInput.value?.focus()
      searchInput.value?.select()
    }, 0)
  }
}

let previousWindowWidth

function handleWindowResize() {
  // Don't change the status of showSearchContainer if only the height of the window changes
  // Opening the virtual keyboard can trigger this resize event, but it won't change the width
  if (previousWindowWidth !== window.innerWidth) {
    showSearchContainer.value = window.innerWidth > MOBILE_WIDTH_THRESHOLD
    previousWindowWidth = window.innerWidth
  }
}

onMounted(() => {
  previousWindowWidth = window.innerWidth
  if (window.innerWidth <= MOBILE_WIDTH_THRESHOLD) {
    showSearchContainer.value = false
  }

  // Store is not up-to-date when the component mounts, so we use timeout.
  setTimeout(() => {
    if (store.getters.getExpandSideBar && !useWatchSideNavOverlay.value) {
      toggleSideNav()
    }
  }, 0)

  window.addEventListener('resize', handleWindowResize)

  if (usesLogicalTabs) {
    const tabId = store.getters.getPresentedTabId
    const searchText = tabId != null ? getSearchTextForTab(tabId) : ''
    if (currentSearchText.length === 0 && searchText.length > 0) {
      updateSearchInputText(searchText)
    }
  }

  if (process.env.IS_ELECTRON) {
    window.addEventListener('keydown', handleKeyboardShortcuts)

    window.ftElectron.handleUpdateSearchInputText((searchQueryText) => {
      if (searchQueryText) {
        updateSearchInputText(searchQueryText)
      }
    })
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleWindowResize)

  if (process.env.IS_ELECTRON) {
    window.removeEventListener('keydown', handleKeyboardShortcuts)

    window.ftElectron.handleUpdateSearchInputText(null)
  }
})
</script>

<style scoped lang="scss" src="./TopNav.scss" />
