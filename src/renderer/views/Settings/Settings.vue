<template>
  <section
    ref="settingsWindowRef"
    class="settingsWindow"
    :class="{
      maximized: isWindowMaximized,
      utilityWindowMorphTarget: settingsWindowMorphing
    }"
    :style="windowStyle"
    role="dialog"
    :aria-label="windowTitle"
    tabindex="-1"
    @keydown.esc.capture="handleSettingsEscape"
  >
    <header
      class="settingsWindowHeader"
      @pointerdown="startDragging"
      @dblclick="handleHeaderDoubleClick"
    >
      <button
        v-if="showBackButton"
        type="button"
        class="settingsHeaderButton settingsBackButton"
        :aria-label="t('Back')"
        :title="t('Back')"
        @click="goBack"
      >
        <FtIcon :icon="['fas', 'arrow-left']" />
      </button>
      <div
        class="settingsBreadcrumb"
        aria-live="polite"
      >
        <span
          v-if="isStandaloneViewOpen"
          class="settingsBreadcrumbLabel"
        >
          <FtIcon
            class="settingsWindowIcon"
            :icon="standaloneViewIcon"
            aria-hidden="true"
          />
          <span class="settingsBreadcrumbText">{{ windowTitle }}</span>
        </span>
        <button
          v-else-if="showBackButton"
          v-show="isInDesktopView"
          type="button"
          class="settingsBreadcrumbRoot"
          @click="returnToSettingsMenu"
        >
          <FtIcon
            class="settingsWindowIcon"
            :icon="['fas', 'cog']"
            aria-hidden="true"
          />
          <span class="settingsBreadcrumbText">{{ t('Settings.Settings') }}</span>
        </button>
        <span
          v-else
          class="settingsBreadcrumbLabel"
        >
          <FtIcon
            class="settingsWindowIcon"
            :icon="['fas', 'cog']"
            aria-hidden="true"
          />
          <span class="settingsBreadcrumbText">{{ t('Settings.Settings') }}</span>
        </span>
        <template v-if="!isStandaloneViewOpen && currentSectionTitle">
          <FtIcon
            v-show="isInDesktopView"
            class="settingsBreadcrumbSeparator"
            :icon="['fas', 'angle-right']"
          />
          <button
            v-if="subpageTitle"
            type="button"
            class="settingsBreadcrumbParent"
            @click="returnToCategory"
          >
            <FtIcon
              v-if="currentSectionIcon"
              class="settingsBreadcrumbCategoryIcon"
              :icon="currentSectionIcon"
              aria-hidden="true"
            />
            <span class="settingsBreadcrumbText">{{ currentSectionTitle }}</span>
          </button>
          <span
            v-else
            class="settingsBreadcrumbLabel"
          >
            <FtIcon
              v-if="currentSectionIcon"
              class="settingsBreadcrumbCategoryIcon"
              :icon="currentSectionIcon"
              aria-hidden="true"
            />
            <span class="settingsBreadcrumbText">{{ currentSectionTitle }}</span>
          </span>
        </template>
        <template v-if="!isStandaloneViewOpen && subpageTitle">
          <FtIcon
            class="settingsBreadcrumbSeparator"
            :icon="['fas', 'angle-right']"
          />
          <span class="settingsBreadcrumbLabel">
            <FtIcon
              v-if="subpageIcon"
              class="settingsBreadcrumbCategoryIcon settingsBreadcrumbSubpageIcon"
              :icon="subpageIcon"
              aria-hidden="true"
            />
            <span class="settingsBreadcrumbText">{{ subpageTitle }}</span>
          </span>
        </template>
        <span
          :id="subpageBreadcrumbTargetId"
          class="settingsBreadcrumbAction"
        />
      </div>
      <label
        v-if="unlocked && !isProfileManagerOpen && !isKeyboardShortcutPromptOpen && !isStandaloneViewOpen && !subpageTitle"
        class="settingsSearch"
      >
        <FtIcon :icon="['fas', 'magnifying-glass']" />
        <input
          ref="settingsSearchInputRef"
          v-model="settingsSearchQuery"
          type="search"
          :placeholder="t('Settings.Search Settings')"
          :aria-label="t('Settings.Search Settings')"
          @input="handleSettingsSearch"
        >
      </label>
      <div class="settingsHeaderActions">
        <button
          v-if="showKeyboardShortcutAction && !isStandaloneViewOpen"
          type="button"
          class="settingsHeaderButton"
          :aria-label="t('KeyboardShortcutPrompt.Show Keyboard Shortcuts')"
          :title="t('KeyboardShortcutPrompt.Show Keyboard Shortcuts')"
          @click="showKeyboardShortcutPrompt"
        >
          <FtIcon :icon="['fas', 'keyboard']" />
        </button>
        <button
          v-if="!isStandaloneViewOpen"
          type="button"
          class="settingsHeaderButton"
          :class="{ active: highlightChangedSettings }"
          :aria-label="t('Settings.Highlight Changed Settings')"
          :title="t('Settings.Highlight Changed Settings')"
          :aria-pressed="highlightChangedSettings"
          @click="updateHighlightChangedSettings(!highlightChangedSettings)"
        >
          <FtIcon :icon="['fas', 'pen']" />
        </button>
        <button
          v-if="!isStandaloneViewOpen"
          type="button"
          class="settingsHeaderButton"
          :class="{ active: showPerformanceImpactIndicators }"
          :aria-label="t('Settings.Performance Impact.Show Performance Impact')"
          :title="t('Settings.Performance Impact.Show Performance Impact')"
          :aria-pressed="showPerformanceImpactIndicators"
          @click="updateShowPerformanceImpactIndicators(!showPerformanceImpactIndicators)"
        >
          <FtIcon :icon="['fas', 'gauge-high']" />
        </button>
        <button
          v-if="showMinimizeButton"
          type="button"
          class="settingsHeaderButton"
          :aria-label="t('Minimize')"
          :title="t('Minimize')"
          @click="minimizeSettings"
        >
          <FtIcon :icon="['fas', 'angle-down']" />
        </button>
        <button
          v-if="!isNarrowLayout"
          type="button"
          class="settingsHeaderButton"
          :aria-label="maximizeButtonLabel"
          :title="maximizeButtonLabel"
          @click="toggleMaximized"
        >
          <FtIcon :icon="isMaximized ? ['fas', 'compress'] : ['fas', 'expand']" />
        </button>
        <button
          ref="settingsCloseButtonRef"
          type="button"
          class="settingsHeaderButton settingsCloseButton"
          :aria-label="t('Close')"
          :title="t('Close')"
          @click="closeSettings"
        >
          <FtIcon :icon="['fas', 'xmark']" />
        </button>
      </div>
    </header>

    <div
      ref="settingsPageRef"
      class="settingsPage"
      :class="{ compactSettings: !isInDesktopView }"
    >
      <template v-if="isAboutOpen">
        <div
          ref="standaloneScrollRef"
          v-overlay-scrollbars
          class="settingsSubpageScroll settingsAboutPage"
        >
          <About />
        </div>
      </template>
      <template v-else-if="isDownloadsOpen">
        <div
          ref="standaloneScrollRef"
          v-overlay-scrollbars
          class="settingsSubpageScroll settingsDownloadsPage"
        >
          <Downloads />
        </div>
      </template>
      <template v-else-if="unlocked">
        <template v-if="isProfileManagerOpen">
          <div
            ref="profileManagerScrollRef"
            v-overlay-scrollbars
            class="settingsSubpageScroll"
            @scroll.passive="clampProfileManagerScroll"
          >
            <ProfileSettings />
          </div>
        </template>
        <template v-else-if="isKeyboardShortcutPromptOpen">
          <div
            class="settingsSubpageScroll settingsKeyboardShortcutPage"
          >
            <FtKeyboardShortcutPrompt embedded />
          </div>
        </template>
        <template v-else>
          <FtSettingsMenu
            v-show="!subpageTitle && (isInDesktopView || (!activeSection && settingsSearchQuery === ''))"
            ref="menuRef"
            v-overlay-scrollbars
            :class="[
              { mobileSettingsMenu: !isInDesktopView },
              settingsMenuTransitionClass
            ]"
            :settings-sections="filteredSettingsSectionComponents"
            :active-section="activeSection"
            :empty-message="t('Settings.No Settings Found')"
            :filtered="settingsSearchQuery !== ''"
            @navigate-to-section="navigateToSection"
          />
          <div
            v-show="!subpageTitle && (isInDesktopView || activeSection || settingsSearchQuery !== '')"
            ref="settingsContentRef"
            v-overlay-scrollbars
            class="settingsContent"
            :class="[
              settingsContentTransitionClass,
              { highlightChangedSettings }
            ]"
            tabindex="-1"
            @scroll.passive="clampSettingsContentScroll"
          >
            <component
              :is="activeSettingsSection.component"
              v-if="activeSettingsSection"
              ref="activeSettingsSectionRef"
              :key="activeSettingsSection.renderKey ?? activeSettingsSection.type"
              :initial-tab="activeSettingsSection.type === 'data' ? activeDataStorageTab : undefined"
              class="section"
              :data-section="activeSettingsSection.type"
              @update:active-tab="setActiveDataStorageTab"
            />
            <div
              v-else-if="settingsSearchQuery !== ''"
              class="settingsSearchResults"
              :class="{ settingsSearchResultsEmpty: settingsSearchResults.length === 0 }"
            >
              <template v-if="settingsSearchResults.length > 0">
                <section
                  v-for="result in settingsSearchResults"
                  :key="result.section.type"
                  class="settingsSearchResult"
                >
                  <button
                    type="button"
                    class="settingsSearchResultHeading"
                    @click="navigateToSection(result.section.type)"
                  >
                    <FtIcon :icon="result.section.icon" />
                    {{ result.section.title }}
                  </button>
                  <button
                    v-for="match in result.matches"
                    :key="`${match.label}-${match.tab ?? ''}`"
                    type="button"
                    class="settingsSearchResultMatch"
                    @click="openSearchResult(result.section.type, match)"
                  >
                    {{ match.label }}
                  </button>
                </section>
              </template>
              <p
                v-else
                class="settingsNoResults"
              >
                {{ t('Settings.No Settings Found') }}
              </p>
            </div>
          </div>
          <div
            v-show="subpageTitle"
            :id="subpageTargetId"
            v-overlay-scrollbars
            class="settingsSubpageScroll"
            :class="{ settingsSubpageFlush: subpageFlush }"
          />
        </template>
      </template>
      <div
        v-else
        v-overlay-scrollbars
        class="settingsPassword"
      >
        <PasswordDialog @unlocked="handleUnlock" />
      </div>
    </div>
    <div
      v-for="direction in RESIZE_DIRECTIONS"
      v-show="!isWindowMaximized"
      :key="direction"
      class="settingsResizeHandle"
      :class="`resize-${direction}`"
      aria-hidden="true"
      @pointerdown="startResizing($event, direction)"
    />
  </section>
</template>

<script setup>
import { supportsYtDlp } from '../../helpers/ytDlpCapabilities'
import { FtIcon } from '@opentubex/icons'
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  provide,
  ref,
  useId,
  useTemplateRef,
  watch
} from 'vue'
import { useI18n } from 'vue-i18n'

import DownloadSettings from '../../components/DownloadSettings.vue'
import DataStorageSettings from '../../components/DataStorageSettings/DataStorageSettings.vue'
import SyncSettings from '../../components/SyncSettings/SyncSettings.vue'
import PasswordDialog from '../../components/PasswordDialog/PasswordDialog.vue'
import FtSettingsMenu from '../../components/FtSettingsMenu/FtSettingsMenu.vue'
import FtKeyboardShortcutPrompt from '../../components/FtKeyboardShortcutPrompt/FtKeyboardShortcutPrompt.vue'
import AddOnSettings from '../../components/SettingsCategories/AddOnSettings.vue'
import AdvancedSettings from '../../components/SettingsCategories/AdvancedSettings.vue'
import AppearanceSettings from '../../components/SettingsCategories/AppearanceSettings.vue'
import FocusSettings from '../../components/SettingsCategories/FocusSettings.vue'
import GeneralCategorySettings from '../../components/SettingsCategories/GeneralCategorySettings.vue'
import PlaybackSettings from '../../components/SettingsCategories/PlaybackSettings.vue'
import PrivacyAndHistorySettings from '../../components/SettingsCategories/PrivacyAndHistorySettings.vue'
import SubscriptionCategorySettings from '../../components/SettingsCategories/SubscriptionCategorySettings.vue'
import ProfileSettings from '../ProfileSettings/ProfileSettings.vue'
import About from '../About/About.vue'
import Downloads from '../Downloads/Downloads.vue'

import store from '../../store/index'
import { settingsSubpageKey } from '../../components/FtSettingsSubpage/settingsSubpage'
import {
  clampOverlayScrollTop,
  isOverlayScrollTopOutOfBounds,
  restoreOverlayScrollTop
} from '../../helpers/overlayScrollbars'
import { initializePlatformInfo, isLinuxWayland } from '../../helpers/platform'
import {
  createSettingsSearchIndex,
  findSettingsSearchTab,
  normalizeSettingsSearchText,
  removeRedundantSettingsSearchMatches,
} from '../../helpers/settingsSearch'

const USING_ELECTRON = !!process.env.IS_ELECTRON
const IS_CAPACITOR = !!process.env.IS_CAPACITOR
const SUPPORTS_LOCAL_API = !!process.env.SUPPORTS_LOCAL_API
const IS_MAC = process.platform === 'darwin'
const SETTINGS_DESKTOP_WIDTH_THRESHOLD = 760
const SETTINGS_BOUNDS_STORAGE_KEY = 'opentubex-settings-window-bounds'
const WINDOW_MARGIN = 12
const MINIMUM_WIDTH = 360
const MINIMUM_HEIGHT = 360
const DEFAULT_WIDTH = 1280
const DEFAULT_HEIGHT = 820
const RESIZE_DIRECTIONS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']
const props = defineProps({
  hardwareKeyboardAttached: {
    type: Boolean,
    default: false
  },
  searchTarget: {
    type: Object,
    default: null
  }
})
const showKeyboardShortcutAction = computed(() => (
  USING_ELECTRON || (IS_CAPACITOR && props.hardwareKeyboardAttached)
))
const emit = defineEmits(['search-target-opened'])
const LEGACY_SETTINGS_SECTION_MAP = {
  theme: 'appearance',
  player: 'playback',
  'caption-appearance': 'playback',
  channel: 'playback',
  subscription: 'subscriptions',
  distraction: 'focus',
  'parental-control': 'focus',
  'sponsor-block': 'add-ons',
  'return-youtube-dislike': 'add-ons',
  'external-player': 'advanced',
  'external-software': 'advanced',
  sync: 'sync',
  proxy: 'advanced',
  'context-menu-search': 'general',
  storage: 'data',
  experimental: 'advanced'
}

const { locale, t, tm } = useI18n()
const normalizeSearchText = value => normalizeSettingsSearchText(value, locale.value)
initializePlatformInfo()
const systemColorScheme = window.matchMedia('(prefers-color-scheme: dark)')
const systemUsesDarkTheme = ref(systemColorScheme.matches)
const updateSystemColorScheme = (event) => {
  systemUsesDarkTheme.value = event.matches
}
const settingsSearchSubsectionTargets = computed(() => ({
  subscriptions: [{
    search: t('Settings.Subscription Settings.Subscription Settings'),
    target: t('Settings.Subscription Settings.Subscription Settings')
  }],
  playback: [{
    search: t('Settings.Player Settings.Caption Appearance.Caption Appearance'),
    target: t('Settings.Player Settings.Caption Appearance.Captions')
  }],
  data: [{
    search: t('Settings.Privacy Settings.Clear Search History and Cache'),
    target: t('Settings.Storage Settings.Search History')
  }]
}))
const isInDesktopView = ref(true)
const isMaximized = ref(false)
const isNarrowLayout = ref(window.innerWidth < SETTINGS_DESKTOP_WIDTH_THRESHOLD)
const activeSection = ref(
  LEGACY_SETTINGS_SECTION_MAP[store.getters.getSettingsWindowSection] ??
  store.getters.getSettingsWindowSection
)
const activeDataStorageTab = ref(
  store.getters.getSettingsWindowSection === 'storage'
    ? 'storage'
    : 'data'
)
const settingsSearchQuery = ref('')
const settingsContentTransitionClass = ref('')
const settingsMenuTransitionClass = ref('')
const settingsWindowRef = useTemplateRef('settingsWindowRef')
const settingsPageRef = useTemplateRef('settingsPageRef')
const settingsContentRef = useTemplateRef('settingsContentRef')
const activeSettingsSectionRef = useTemplateRef('activeSettingsSectionRef')
const standaloneScrollRef = useTemplateRef('standaloneScrollRef')
const profileManagerScrollRef = useTemplateRef('profileManagerScrollRef')
const settingsSearchInputRef = useTemplateRef('settingsSearchInputRef')
const settingsCloseButtonRef = useTemplateRef('settingsCloseButtonRef')
const menuRef = useTemplateRef('menuRef')
const subpageTargetId = `settings-subpage-${useId().replaceAll(':', '')}`
const subpageBreadcrumbTargetId = `settings-subpage-breadcrumb-${useId().replaceAll(':', '')}`
const subpageTitle = ref('')
const subpageIcon = ref(null)
const subpageFlush = ref(false)
let closeSubpage = null
let subpagePersistsOnDeactivate = false
let closeSubpageOnActivate = false
let settingsResizeObserver = null
let settingsSectionResizeObserver = null
let profileManagerResizeObserver = null
let standaloneContentResizeObserver = null
let observationScheduled = false
let boundsSaveTimer = null
let boundsAnimation = null
let searchHighlightTimer = null
let standaloneClampFrame = null
let downloadsReturnScrollTop = 0
let draggingPointerId = null
let resizeSession = null
let dragOffsetX = 0
let dragOffsetY = 0
let maximizedDragSession = null
let restoreBounds = null
/** @type {Array<{ element: HTMLElement, scrollTop: number }>} */
let preservedScrollPositions = []

const windowBounds = ref(getInitialBounds())
const isWindowMaximized = computed(() => isMaximized.value || isNarrowLayout.value)
const windowStyle = computed(() => isWindowMaximized.value
  ? {
      left: '0',
      top: 'var(--app-safe-area-inset-top, 0px)',
      inlineSize: '100vw',
      blockSize: 'calc(100dvh - var(--app-safe-area-inset-top, 0px))'
    }
  : {
      left: `${windowBounds.value.x}px`,
      top: `${windowBounds.value.y}px`,
      inlineSize: `${windowBounds.value.width}px`,
      blockSize: `${windowBounds.value.height}px`
    })
const maximizeButtonLabel = computed(() => isMaximized.value ? t('Restore') : t('Maximize'))

const settingsWindowMorphing = computed(() => store.getters.getSettingsWindowMorphing)
const highlightChangedSettings = computed(() => store.getters.getHighlightChangedSettings)
const showPerformanceImpactIndicators = computed(() => store.getters.getShowPerformanceImpactIndicators)
const isProfileManagerOpen = computed(() => store.getters.getSettingsWindowView === 'profile')
const isAboutOpen = computed(() => store.getters.getSettingsWindowView === 'about')
const isDownloadsOpen = computed(() => store.getters.getSettingsWindowView === 'downloads')
const canReturnFromDownloads = computed(() => (
  isDownloadsOpen.value && store.getters.getSettingsWindowReturnView === 'settings'
))
const isStandaloneViewOpen = computed(() => isAboutOpen.value || isDownloadsOpen.value)
const showMinimizeButton = computed(() => {
  if (isDownloadsOpen.value) return !store.getters.getMoveDownloadsToAppHeader
  if (isAboutOpen.value) return true
  return !store.getters.getMoveSettingsToAppHeader
})
const isKeyboardShortcutPromptOpen = computed(() => store.getters.getIsKeyboardShortcutPromptShown)
const windowTitle = computed(() => {
  if (isAboutOpen.value) return t('About.About')
  if (isDownloadsOpen.value) return t('Settings.Download Settings.Download Settings')
  return t('Settings.Settings')
})
const standaloneViewIcon = computed(() => isDownloadsOpen.value
  ? ['fas', 'download']
  : ['fas', 'info-circle'])

const settingsComponentsData = computed(() => [
  {
    type: 'appearance',
    title: t('Settings.Categories.Appearance'),
    description: t('Settings.Categories.Appearance Description'),
    icon: ['fas', 'display'],
    component: AppearanceSettings
  },
  {
    type: 'playback',
    title: t('Settings.Quick Settings.Playback'),
    description: t('Settings.Categories.Playback Description'),
    icon: ['fas', 'circle-play'],
    component: PlaybackSettings
  },
  {
    type: 'add-ons',
    renderKey: 'add-ons-standalone-voice-over',
    title: t('Settings.Categories.Add-ons'),
    description: t('Settings.Categories.Add-ons Description'),
    icon: ['fas', 'puzzle-piece'],
    component: AddOnSettings
  },
  {
    type: 'subscriptions',
    title: t('Subscriptions.Subscriptions'),
    description: t('Settings.Categories.Subscriptions Description'),
    icon: ['fas', 'users'],
    component: SubscriptionCategorySettings
  },
  ...(supportsYtDlp
    ? [{
        type: 'download',
        title: t('Settings.Download Settings.Download Settings'),
        description: t('Settings.Categories.Downloads Description'),
        icon: ['fas', 'download'],
        component: DownloadSettings
      }]
    : []),
  {
    type: 'focus',
    title: t('Settings.Distraction Free Settings.Distraction Free Settings'),
    description: t('Settings.Categories.Distraction Free Description'),
    icon: ['fas', 'eye-slash'],
    component: FocusSettings
  },
  {
    type: 'privacy',
    renderKey: 'privacy-with-navigation-history',
    title: t('Settings.Privacy Settings.Privacy Settings'),
    description: t('Settings.Categories.Privacy Description'),
    icon: ['fas', 'lock'],
    component: PrivacyAndHistorySettings
  },
  {
    type: 'data',
    title: t('Settings.Data Settings.Data And Storage'),
    description: t('Settings.Categories.Data And Storage Description'),
    icon: ['fas', 'box-archive'],
    component: DataStorageSettings
  },
  {
    type: 'sync',
    title: t('Settings.Sync Settings.Sync Settings'),
    description: t('Settings.Categories.Sync Description'),
    icon: ['fas', 'sync'],
    component: SyncSettings
  },
  {
    type: 'advanced',
    title: t('Settings.Categories.Advanced'),
    description: t('Settings.Categories.Advanced Description'),
    icon: ['fas', 'flask'],
    component: AdvancedSettings
  }
])

const settingsSectionComponents = computed(() => [{
  type: 'general',
  renderKey: 'general-without-navigation-history',
  title: t('Settings.General Settings.General Settings'),
  description: t('Settings.Categories.General Description'),
  icon: ['fas', 'border-all'],
  component: GeneralCategorySettings
}, ...settingsComponentsData.value])
const settingsSearchableValues = computed(() => createSettingsSearchIndex({
  sections: settingsSectionComponents.value,
  tm,
  store,
  usingElectron: USING_ELECTRON,
  isCapacitor: IS_CAPACITOR,
  supportsLocalApi: SUPPORTS_LOCAL_API,
  isMac: IS_MAC,
  isLinuxWayland: isLinuxWayland.value,
  systemUsesDarkTheme: systemUsesDarkTheme.value,
}))
const settingsSearchResults = computed(() => {
  const query = normalizeSearchText(settingsSearchQuery.value)
  if (query === '') return []

  return settingsSectionComponents.value.flatMap((section) => {
    const values = settingsSearchableValues.value.get(section.type) ?? []
    const matches = removeRedundantSettingsSearchMatches(
      values.filter(match => normalizeSearchText(match.label).includes(query)),
      locale.value
    )
    return matches.length === 0 ? [] : [{ section, matches: matches.slice(0, 6) }]
  })
})
const filteredSettingsSectionComponents = computed(() => {
  if (settingsSearchQuery.value === '') return settingsSectionComponents.value
  return settingsSearchResults.value.map(({ section }) => section)
})
const activeSettingsSection = computed(() => {
  return settingsSectionComponents.value.find(({ type }) => type === activeSection.value) ?? null
})
const currentSectionTitle = computed(() => {
  if (isKeyboardShortcutPromptOpen.value) {
    return t('KeyboardShortcutPrompt.Keyboard Shortcuts')
  }
  if (isProfileManagerOpen.value) {
    return t('Profile.Profile Manager')
  }
  return activeSettingsSection.value?.title ?? ''
})
const currentSectionIcon = computed(() => {
  if (isKeyboardShortcutPromptOpen.value) {
    return ['fas', 'keyboard']
  }
  if (isProfileManagerOpen.value) {
    return ['fas', 'users']
  }
  return activeSettingsSection.value?.icon ?? null
})
const showBackButton = computed(() => {
  if (isDownloadsOpen.value) return canReturnFromDownloads.value
  if (isStandaloneViewOpen.value) return false

  return isKeyboardShortcutPromptOpen.value || isProfileManagerOpen.value || subpageTitle.value !== '' ||
    (!isInDesktopView.value && activeSection.value !== null)
})

const unlocked = ref(store.getters.getSettingsPassword === '')

provide(settingsSubpageKey, {
  targetId: subpageTargetId,
  breadcrumbTargetId: subpageBreadcrumbTargetId,
  open(title, close, persistOnDeactivate = false, icon = null, flush = false) {
    subpageTitle.value = title
    subpageIcon.value = icon
    subpageFlush.value = flush
    closeSubpage = close
    subpagePersistsOnDeactivate = persistOnDeactivate
  },
  close(close) {
    if (closeSubpage === close) {
      subpageTitle.value = ''
      subpageIcon.value = null
      subpageFlush.value = false
      closeSubpage = null
      subpagePersistsOnDeactivate = false
    }
  }
})

onMounted(() => {
  handleMounted()
  systemColorScheme.addEventListener('change', updateSystemColorScheme)
})
onActivated(() => {
  if (closeSubpageOnActivate) {
    closeSubpageOnActivate = false
    const deferredCloseSubpage = closeSubpage
    deferredCloseSubpage?.()
    if (closeSubpage === deferredCloseSubpage) {
      subpageTitle.value = ''
      subpageIcon.value = null
      subpageFlush.value = false
      closeSubpage = null
      subpagePersistsOnDeactivate = false
    }
  }
  handleMounted()
  nextTick(restorePreservedScrollPositions)
})
onDeactivated(() => {
  if (!settingsWindowMorphing.value) {
    preserveScrollPositions()
    if (!subpagePersistsOnDeactivate) {
      closeSubpageOnActivate = true
    }
  }
  stopObserving()
  stopDragging()
  stopResizing()
})
onBeforeUnmount(() => {
  systemColorScheme.removeEventListener('change', updateSystemColorScheme)
  stopObserving()
  stopDragging()
  stopResizing()
  if (boundsSaveTimer !== null) {
    clearTimeout(boundsSaveTimer)
  }
  boundsAnimation?.cancel()
  if (searchHighlightTimer !== null) {
    clearTimeout(searchHighlightTimer)
  }
  cancelStandaloneScrollClamp()
})

watch(isProfileManagerOpen, (open) => {
  if (!open) {
    stopObservingProfileManager()
    setInitialSection()
  } else {
    nextTick(observeProfileManager)
  }
})
watch(() => store.getters.getSettingsWindowView, async (view) => {
  stopObservingStandaloneContent()
  if (view === 'downloads' && canReturnFromDownloads.value) {
    downloadsReturnScrollTop = settingsContentRef.value?.scrollTop ?? 0
  }
  if (!['about', 'downloads'].includes(view)) return
  await nextTick()
  const scrollViewport = standaloneScrollRef.value
  if (scrollViewport) restoreOverlayScrollTop(scrollViewport, 0)
  observeStandaloneContent()
})
watch(activeSection, (section) => {
  if (section !== null) {
    store.commit('setSettingsWindowSection', section)
  }
  nextTick(observeActiveSettingsSection)
})
watch(() => store.getters.getSettingsWindowSection, async (section) => {
  if (section === 'storage') activeDataStorageTab.value = 'storage'
  const normalizedSection = LEGACY_SETTINGS_SECTION_MAP[section] ?? section
  if (
    normalizedSection !== activeSection.value &&
    settingsSectionComponents.value.some(candidate => candidate.type === normalizedSection)
  ) {
    navigateToSection(normalizedSection)
  }
  if (section === 'storage') {
    await nextTick()
    await activeSettingsSectionRef.value?.activateTab('storage')
  }
})
watch(() => props.searchTarget, async (target) => {
  if (!target) return
  await nextTick()
  await openSearchResult(target.section, target)
  emit('search-target-opened', target)
}, { immediate: true })

function handleMounted() {
  unlocked.value = store.getters.getSettingsPassword === ''
  updateNarrowLayout()
  handleResize(settingsWindowRef.value?.clientWidth ?? windowBounds.value.width)
  setInitialSection()
  nextTick(observeProfileManager)
  nextTick(observeStandaloneContent)
  nextTick(() => {
    const initialFocus = isNarrowLayout.value
      ? settingsCloseButtonRef.value
      : settingsSearchInputRef.value ?? settingsCloseButtonRef.value
    initialFocus?.focus()
  })
  if (settingsResizeObserver !== null || observationScheduled) {
    return
  }
  observationScheduled = true
  nextTick(() => {
    observationScheduled = false
    const element = settingsWindowRef.value
    if (!element) return
    handleResize(element.clientWidth)
    settingsResizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      handleResize(width)
      if (width > 0 && height > 0) {
        if (
          !isWindowMaximized.value &&
          boundsAnimation === null &&
          draggingPointerId === null &&
          resizeSession === null
        ) {
          windowBounds.value = clampBounds({
            ...windowBounds.value,
            width: element.offsetWidth,
            height: element.offsetHeight
          })
          scheduleBoundsSave()
        }
        if (settingsContentRef.value) {
          clampOverlayScrollTop(
            settingsContentRef.value,
            getSettingsContentEnd(settingsContentRef.value)
          )
        }
        scheduleStandaloneScrollClamp()
      }
    })
    settingsResizeObserver.observe(element)
    window.addEventListener('resize', handleViewportResize)
    observeActiveSettingsSection()
  })
}

function stopObserving() {
  observationScheduled = false
  settingsResizeObserver?.disconnect()
  settingsResizeObserver = null
  cancelStandaloneScrollClamp()
  settingsSectionResizeObserver?.disconnect()
  settingsSectionResizeObserver = null
  stopObservingProfileManager()
  stopObservingStandaloneContent()
  window.removeEventListener('resize', handleViewportResize)
}

function observeProfileManager() {
  stopObservingProfileManager()
  const content = profileManagerScrollRef.value
  const profileManager = content?.firstElementChild
  if (!content || !(profileManager instanceof HTMLElement)) return

  profileManagerResizeObserver = new ResizeObserver(() => {
    clampOverlayScrollTop(content, profileManager)
  })
  profileManagerResizeObserver.observe(profileManager)
  clampOverlayScrollTop(content, profileManager)
}

function stopObservingProfileManager() {
  profileManagerResizeObserver?.disconnect()
  profileManagerResizeObserver = null
}

function observeStandaloneContent() {
  stopObservingStandaloneContent()
  const scrollViewport = standaloneScrollRef.value
  const content = scrollViewport?.firstElementChild
  if (!scrollViewport || !(content instanceof HTMLElement)) return

  standaloneContentResizeObserver = new ResizeObserver(scheduleStandaloneScrollClamp)
  standaloneContentResizeObserver.observe(content)
  scheduleStandaloneScrollClamp()
}

function stopObservingStandaloneContent() {
  standaloneContentResizeObserver?.disconnect()
  standaloneContentResizeObserver = null
}

function clampProfileManagerScroll() {
  const content = profileManagerScrollRef.value
  const profileManager = content?.firstElementChild
  if (content && profileManager instanceof HTMLElement) {
    clampOverlayScrollTop(content, profileManager)
  }
}

function observeActiveSettingsSection() {
  settingsSectionResizeObserver?.disconnect()
  settingsSectionResizeObserver = null
  const content = settingsContentRef.value
  const contentEnd = getSettingsContentEnd(content)
  if (!content || !contentEnd) return
  settingsSectionResizeObserver = new ResizeObserver(() => {
    clampOverlayScrollTop(content, contentEnd)
  })
  content.querySelectorAll(':scope > .section, :scope > .settingsSearchResults').forEach(element => {
    settingsSectionResizeObserver.observe(element)
  })
  clampOverlayScrollTop(content, contentEnd)
}

function clampSettingsContentScroll(event) {
  const content = event.currentTarget
  const contentEnd = getSettingsContentEnd(content)
  if (!contentEnd) return
  if (isOverlayScrollTopOutOfBounds(content, contentEnd)) {
    clampOverlayScrollTop(content, contentEnd)
  }
}

function scheduleStandaloneScrollClamp() {
  cancelStandaloneScrollClamp()
  standaloneClampFrame = requestAnimationFrame(() => {
    standaloneClampFrame = null
    const scrollViewport = standaloneScrollRef.value
    if (scrollViewport) {
      clampOverlayScrollTop(scrollViewport, scrollViewport.firstElementChild)
    }
  })
}

function cancelStandaloneScrollClamp() {
  if (standaloneClampFrame !== null) {
    cancelAnimationFrame(standaloneClampFrame)
    standaloneClampFrame = null
  }
}

function getSettingsContentEnd(content) {
  const sections = content?.querySelectorAll(
    ':scope > .section, :scope > .settingsSearchResults'
  )
  return sections?.[sections.length - 1] ?? null
}

function handleUnlock() {
  unlocked.value = true
  nextTick(setInitialSection)
}

function setInitialSection() {
  if (isProfileManagerOpen.value || !unlocked.value || settingsSearchQuery.value !== '') return
  if (isInDesktopView.value && activeSection.value === null) {
    activeSection.value = getRememberedSection()
  }
}

function getRememberedSection() {
  const rememberedSection = LEGACY_SETTINGS_SECTION_MAP[store.getters.getSettingsWindowSection] ??
    store.getters.getSettingsWindowSection
  return settingsSectionComponents.value.some(({ type }) => type === rememberedSection)
    ? rememberedSection
    : settingsSectionComponents.value[0].type
}

function navigateToSection(sectionType) {
  const previousSection = activeSection.value
  closeSubpage?.()
  subpageTitle.value = ''
  subpageIcon.value = null
  closeSubpage = null
  activeSection.value = sectionType
  if (previousSection !== sectionType) {
    nextTick(() => {
      const content = settingsContentRef.value
      if (content) restoreOverlayScrollTop(content, 0)
    })
  }
  if (isInDesktopView.value && previousSection !== null && previousSection !== sectionType) {
    const previousIndex = settingsSectionComponents.value.findIndex(({ type }) => type === previousSection)
    const nextIndex = settingsSectionComponents.value.findIndex(({ type }) => type === sectionType)
    animateSettingsElement(
      settingsContentRef,
      settingsContentTransitionClass,
      nextIndex >= previousIndex ? 'settingsSectionSlideForward' : 'settingsSectionSlideBackward'
    )
  } else if (!isInDesktopView.value) {
    animateSettingsElement(
      settingsContentRef,
      settingsContentTransitionClass,
      'settingsCompactSlideForward'
    )
    nextTick(() => settingsContentRef.value?.focus({ preventScroll: true }))
  }
}

function setActiveDataStorageTab(tab) {
  if (['data', 'storage'].includes(tab)) activeDataStorageTab.value = tab
}

/**
 * @param {Readonly<import('vue').ShallowRef<HTMLElement | {$el?: HTMLElement} | null>>} elementRef
 * @param {import('vue').Ref<string>} classRef
 * @param {string} className
 */
async function animateSettingsElement(elementRef, classRef, className) {
  classRef.value = ''
  await nextTick()
  const element = elementRef.value?.$el ?? elementRef.value
  element?.getBoundingClientRect()
  classRef.value = className
  await nextTick()

  // A class left in place keeps its animation attached to the element, so
  // anything that later has the browser start it over — rebuilding the overlay
  // scrollbars, for instance — replays the slide long after the navigation it
  // belonged to. Drop it once it has played.
  // Nothing to play, because reduced motion suppressed it. Leaving the class
  // behind would let it slide as soon as reduced motion is turned back off.
  const animations = element?.getAnimations() ?? []
  if (animations.length === 0) {
    if (classRef.value === className) {
      classRef.value = ''
    }
    return
  }

  const results = await Promise.allSettled(animations.map(animation => animation.finished))
  // Rejected means a newer navigation cancelled this one, and owns the class now.
  if (results.some(({ status }) => status === 'rejected')) return

  if (classRef.value === className) {
    classRef.value = ''
  }
}

async function openSearchResult(sectionType, match) {
  settingsSearchQuery.value = ''
  navigateToSection(sectionType)
  await nextTick()

  const { label } = match
  const normalizedLabel = normalizeSearchText(label.trim())
  const searchTab = findSettingsSearchTab(match)
  if (searchTab) {
    await activeSettingsSectionRef.value?.activateTab(searchTab)
    await nextTick()
  }

  const content = settingsContentRef.value
  if (!content) return
  const section = settingsSectionComponents.value.find(({ type }) => type === sectionType)
  const isSectionMatch = [section?.title, section?.description]
    .some(value => normalizeSearchText(value ?? '') === normalizedLabel)
  let target = isSectionMatch
    ? content.querySelector(`.section[data-section="${sectionType}"]`)
    : null
  if (target === null) {
    const subsectionTarget = settingsSearchSubsectionTargets.value[sectionType]?.find(
      ({ search }) => normalizeSearchText(search) === normalizedLabel
    )
    if (subsectionTarget) {
      const targetHeading = normalizeSearchText(subsectionTarget.target)
      const headingElement = [...content.querySelectorAll('h1, h2, h3, h4')]
        .find(element => getSearchTargetText(element) === targetHeading)
      target = headingElement?.closest('.settingsSection') ?? null
    }
  }
  if (target === null) {
    const visibleTextElements = [...content.querySelectorAll(
      'label, button, p, h1, h2, h3, h4, span, legend, div'
    )]
      .filter(element => element.getClientRects().length > 0)
    const labelElement = visibleTextElements
      .filter(element => getSearchTargetText(element) === normalizedLabel)
      .at(-1) ?? visibleTextElements
      .filter(element => getSearchTargetText(element).startsWith(`${normalizedLabel}:`))
      .at(-1)
    const settingsSection = labelElement?.matches('h1, h2, h3, h4')
      ? labelElement.closest('.settingsSection')
      : null
    const control = settingsSection ?? labelElement?.closest(
      '.switch-ctn, .select, .ft-input-component, .pure-material-slider, ' +
      '.pure-checkbox, .captionControl, .preferenceToggle'
    ) ?? labelElement
    target = control?.classList.contains('ft-input-component')
      ? control.querySelector('.ft-input')
      : control
  }
  if (!target) return

  target.scrollIntoView({ block: 'center', behavior: 'smooth' })
  target.classList.remove('settingsSearchTarget')
  // Restart the animation if the same result is selected repeatedly.
  await new Promise(resolve => requestAnimationFrame(resolve))
  target.classList.add('settingsSearchTarget')
  if (searchHighlightTimer !== null) clearTimeout(searchHighlightTimer)
  searchHighlightTimer = setTimeout(() => {
    target.classList.remove('settingsSearchTarget')
    searchHighlightTimer = null
  }, 2200)
}

function getSearchTargetText(element) {
  const clone = element.cloneNode(true)
  clone.querySelectorAll('.tooltip, .changedSettingIndicator, .changedSettingIndicatorPlaceholder')
    .forEach(child => child.remove())
  return normalizeSearchText(clone.textContent.trim())
}

function handleSettingsSearch() {
  closeSubpage?.()
  subpageTitle.value = ''
  subpageIcon.value = null
  closeSubpage = null
  activeSection.value = settingsSearchQuery.value === '' && isInDesktopView.value
    ? getRememberedSection()
    : null
  nextTick(() => {
    if (settingsContentRef.value) settingsContentRef.value.scrollTop = 0
  })
}

function goBack() {
  if (canReturnFromDownloads.value) {
    store.dispatch('showSettingsWindowRoot')
    nextTick(() => {
      const content = settingsContentRef.value
      if (!content) return
      restoreOverlayScrollTop(content, downloadsReturnScrollTop)
      content.focus()
    })
  } else if (isKeyboardShortcutPromptOpen.value) {
    store.dispatch('hideKeyboardShortcutPrompt')
  } else if (isProfileManagerOpen.value) {
    returnToSettingsMenu()
  } else if (subpageTitle.value) {
    closeSubpage?.()
  } else {
    returnToSettingsMenu()
  }
}

function returnToSettingsMenu() {
  if (isKeyboardShortcutPromptOpen.value) {
    store.dispatch('hideKeyboardShortcutPrompt')
    if (!isInDesktopView.value) {
      activeSection.value = null
    }
    return
  }
  if (isProfileManagerOpen.value) {
    store.dispatch('showSettingsWindowRoot')
    activeSection.value = isInDesktopView.value ? 'data' : null
    return
  }
  closeSubpage?.()
  subpageTitle.value = ''
  subpageIcon.value = null
  closeSubpage = null
  if (!isInDesktopView.value) {
    const previousSection = activeSection.value
    activeSection.value = null
    animateSettingsElement(menuRef, settingsMenuTransitionClass, 'settingsCompactSlideBackward')
    nextTick(() => menuRef.value?.focusLink(previousSection))
  }
}

function returnToCategory() {
  closeSubpage?.()
}

function showKeyboardShortcutPrompt() {
  store.dispatch('showKeyboardShortcutPrompt')
}

function updateShowPerformanceImpactIndicators(value) {
  store.dispatch('updateShowPerformanceImpactIndicators', value)
}

function updateHighlightChangedSettings(value) {
  store.dispatch('updateHighlightChangedSettings', value)
}

function handleResize(width) {
  if (width <= 0) return
  const desktop = width >= SETTINGS_DESKTOP_WIDTH_THRESHOLD
  if (desktop === isInDesktopView.value) return
  isInDesktopView.value = desktop
  if (desktop && activeSection.value === null && settingsSearchQuery.value === '') {
    activeSection.value = getRememberedSection()
  }
}

function closeSettings() {
  store.dispatch('hideSettingsWindow')
}

function minimizeSettings() {
  preserveScrollPositions()
  store.dispatch('minimizeSettingsWindow')
}

function preserveScrollPositions() {
  const settingsWindow = settingsWindowRef.value
  preservedScrollPositions = settingsWindow
    ? [...settingsWindow.querySelectorAll('[data-overlayscrollbars-initialize]')]
        .filter(element => element.scrollTop > 0)
        .map(element => ({ element, scrollTop: element.scrollTop }))
    : []
}

function restorePreservedScrollPositions() {
  for (const { element, scrollTop } of preservedScrollPositions) {
    if (element.isConnected) restoreOverlayScrollTop(element, scrollTop)
  }
  preservedScrollPositions = []
}

async function toggleMaximized() {
  if (isNarrowLayout.value) return
  cancelBoundsAnimation()
  const element = settingsWindowRef.value
  const from = getWindowAnimationState(element)
  if (isMaximized.value) {
    restoreSettingsWindow()
  } else {
    restoreBounds = { ...windowBounds.value }
    isMaximized.value = true
  }
  await nextTick()
  animateWindowBounds(element, from)
}

function getWindowAnimationState(element) {
  if (!element) return null
  const bounds = element.getBoundingClientRect()
  return {
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height,
    borderRadius: getComputedStyle(element).borderRadius
  }
}

// The window is already at its target bounds here, so the difference is played back
// with transforms only. Animating left/top/width/height instead would relayout the
// whole settings page and re-evaluate its container queries on every single frame.
function animateWindowBounds(element, from) {
  if (!element || !from || document.documentElement.dataset.reducedMotion === 'reduce') return
  const to = getWindowAnimationState(element)
  if (to.width === 0 || to.height === 0) return
  const animation = element.animate([
    {
      transformOrigin: '0 0',
      transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`,
      borderRadius: from.borderRadius
    },
    {
      transformOrigin: '0 0',
      transform: 'none',
      borderRadius: to.borderRadius
    }
  ], {
    duration: 240,
    easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)'
  })
  boundsAnimation = animation
  animation.finished.catch(() => {}).finally(() => {
    if (boundsAnimation === animation) boundsAnimation = null
  })
}

function cancelBoundsAnimation() {
  boundsAnimation?.cancel()
  boundsAnimation = null
}

function restoreSettingsWindow() {
  if (!isMaximized.value) return
  windowBounds.value = clampBounds(restoreBounds ?? windowBounds.value)
  restoreBounds = null
  isMaximized.value = false
  scheduleBoundsSave()
}

function handleSettingsEscape(event) {
  if (event.target.closest('[aria-expanded="true"], [data-settings-escape-scope]')) return
  event.stopPropagation()
  closeSettings()
}

function handleHeaderDoubleClick(event) {
  if (
    isNarrowLayout.value ||
    event.button !== 0 ||
    event.target.closest('button, input, .settingsSearch')
  ) return
  toggleMaximized()
}

function startDragging(event) {
  if (
    isNarrowLayout.value ||
    event.button !== 0 ||
    event.target.closest('button, input, .settingsSearch')
  ) return
  cancelBoundsAnimation()
  const renderedBounds = settingsWindowRef.value.getBoundingClientRect()
  if (isMaximized.value) {
    const floatingBounds = clampBounds(restoreBounds ?? windowBounds.value)
    maximizedDragSession = {
      floatingBounds,
      horizontalPosition: renderedBounds.width > 0
        ? (event.clientX - renderedBounds.left) / renderedBounds.width
        : 0.5,
      pointerOffsetY: event.clientY - renderedBounds.top
    }
  } else {
    const bounds = windowBounds.value
    dragOffsetX = event.clientX - bounds.x
    dragOffsetY = event.clientY - bounds.y
  }
  draggingPointerId = event.pointerId
  document.documentElement.classList.add('draggingSettingsWindow')
  window.addEventListener('pointermove', dragWindow)
  window.addEventListener('pointerup', stopDragging)
  window.addEventListener('pointercancel', stopDragging)
  event.preventDefault()
}

function dragWindow(event) {
  if (event.pointerId !== draggingPointerId) return
  if (maximizedDragSession !== null) {
    const { floatingBounds, horizontalPosition, pointerOffsetY } = maximizedDragSession
    windowBounds.value = clampBounds({
      ...floatingBounds,
      x: event.clientX - floatingBounds.width * horizontalPosition,
      y: event.clientY - pointerOffsetY
    })
    dragOffsetX = event.clientX - windowBounds.value.x
    dragOffsetY = event.clientY - windowBounds.value.y
    maximizedDragSession = null
    restoreBounds = null
    isMaximized.value = false
    return
  }
  windowBounds.value = clampBounds({
    ...windowBounds.value,
    x: event.clientX - dragOffsetX,
    y: event.clientY - dragOffsetY
  })
}

function stopDragging(event) {
  if (event && event.pointerId !== draggingPointerId) return
  if (draggingPointerId === null) return
  draggingPointerId = null
  maximizedDragSession = null
  document.documentElement.classList.remove('draggingSettingsWindow')
  window.removeEventListener('pointermove', dragWindow)
  window.removeEventListener('pointerup', stopDragging)
  window.removeEventListener('pointercancel', stopDragging)
  scheduleBoundsSave()
}

function startResizing(event, direction) {
  if (event.button !== 0 || isWindowMaximized.value) return
  cancelBoundsAnimation()
  resizeSession = {
    direction,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    bounds: { ...windowBounds.value }
  }
  document.documentElement.classList.add('resizingSettingsWindow')
  document.documentElement.style.cursor = getComputedStyle(event.currentTarget).cursor
  window.addEventListener('pointermove', resizeWindow)
  window.addEventListener('pointerup', stopResizing)
  window.addEventListener('pointercancel', stopResizing)
  event.preventDefault()
  event.stopPropagation()
}

function resizeWindow(event) {
  if (resizeSession === null || event.pointerId !== resizeSession.pointerId) return
  const { direction, startX, startY, bounds } = resizeSession
  const deltaX = event.clientX - startX
  const deltaY = event.clientY - startY
  let left = bounds.x
  let right = bounds.x + bounds.width
  let top = bounds.y
  let bottom = bounds.y + bounds.height

  if (direction.includes('e')) right += deltaX
  if (direction.includes('w')) left += deltaX
  if (direction.includes('s')) bottom += deltaY
  if (direction.includes('n')) top += deltaY

  const maximumRight = window.innerWidth - WINDOW_MARGIN
  const maximumBottom = window.innerHeight - WINDOW_MARGIN
  const minimumWidth = Math.min(MINIMUM_WIDTH, maximumRight - WINDOW_MARGIN)
  const minimumHeight = Math.min(MINIMUM_HEIGHT, maximumBottom - WINDOW_MARGIN)
  left = Math.max(WINDOW_MARGIN, left)
  top = Math.max(WINDOW_MARGIN, top)
  right = Math.min(maximumRight, right)
  bottom = Math.min(maximumBottom, bottom)

  if (right - left < minimumWidth) {
    if (direction.includes('w')) left = Math.max(WINDOW_MARGIN, right - minimumWidth)
    else right = Math.min(maximumRight, left + minimumWidth)
  }
  if (bottom - top < minimumHeight) {
    if (direction.includes('n')) top = Math.max(WINDOW_MARGIN, bottom - minimumHeight)
    else bottom = Math.min(maximumBottom, top + minimumHeight)
  }

  windowBounds.value = {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  }
}

function stopResizing(event) {
  if (resizeSession === null || (event && event.pointerId !== resizeSession.pointerId)) return
  resizeSession = null
  document.documentElement.classList.remove('resizingSettingsWindow')
  document.documentElement.style.removeProperty('cursor')
  window.removeEventListener('pointermove', resizeWindow)
  window.removeEventListener('pointerup', stopResizing)
  window.removeEventListener('pointercancel', stopResizing)
  scheduleBoundsSave()
}

function handleViewportResize() {
  updateNarrowLayout()
  clampWindowToViewport()
}

function updateNarrowLayout() {
  isNarrowLayout.value = window.innerWidth < SETTINGS_DESKTOP_WIDTH_THRESHOLD
}

function clampWindowToViewport() {
  if (isWindowMaximized.value) return
  windowBounds.value = clampBounds(windowBounds.value)
}

function clampBounds(bounds) {
  const maximumWidth = Math.max(0, window.innerWidth - WINDOW_MARGIN * 2)
  const maximumHeight = Math.max(0, window.innerHeight - WINDOW_MARGIN * 2)
  const width = Math.min(Math.max(bounds.width, MINIMUM_WIDTH), maximumWidth)
  const height = Math.min(Math.max(bounds.height, MINIMUM_HEIGHT), maximumHeight)
  return {
    x: Math.min(Math.max(bounds.x, WINDOW_MARGIN), window.innerWidth - width - WINDOW_MARGIN),
    y: Math.min(Math.max(bounds.y, WINDOW_MARGIN), window.innerHeight - height - WINDOW_MARGIN),
    width,
    height
  }
}

function getInitialBounds() {
  const fallbackWidth = Math.min(DEFAULT_WIDTH, Math.max(MINIMUM_WIDTH, window.innerWidth - 48))
  const fallbackHeight = Math.min(DEFAULT_HEIGHT, Math.max(MINIMUM_HEIGHT, window.innerHeight - 80))
  const fallback = {
    x: Math.round((window.innerWidth - fallbackWidth) / 2),
    y: Math.max(WINDOW_MARGIN, Math.round((window.innerHeight - fallbackHeight) / 2)),
    width: fallbackWidth,
    height: fallbackHeight
  }
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_BOUNDS_STORAGE_KEY))
    if ([saved?.x, saved?.y, saved?.width, saved?.height].every(Number.isFinite)) {
      return clampBounds(saved)
    }
  } catch {
    // Ignore corrupt state and use the centered default.
  }
  return clampBounds(fallback)
}

function scheduleBoundsSave() {
  if (boundsSaveTimer !== null) clearTimeout(boundsSaveTimer)
  boundsSaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(SETTINGS_BOUNDS_STORAGE_KEY, JSON.stringify(windowBounds.value))
    } catch {
      // Bounds are convenience state; storage can be unavailable or full.
    } finally {
      boundsSaveTimer = null
    }
  }, 150)
}
</script>

<style scoped src="./Settings.css" />
