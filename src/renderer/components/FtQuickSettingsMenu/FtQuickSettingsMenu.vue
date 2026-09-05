<template>
  <div class="quickSettings">
    <button
      ref="triggerRef"
      type="button"
      class="profileTrigger"
      data-tutorial="quick-settings"
      :aria-label="t('Settings.Quick Settings.Quick Settings')"
      :title="t('Settings.Quick Settings.Quick Settings')"
      :aria-expanded="menuOpen"
      :aria-controls="id"
      :style="{ background: activeProfile.bgColor, color: activeProfile.textColor }"
      @click="toggleMenu"
      @contextmenu.stop.prevent="openProfilePanelFromContextMenu"
      @mousedown="handleTriggerMouseDown"
      @keydown.esc.stop="closeMenu"
    >
      <FtProfileIcon
        class="profileInitial"
        :profile="activeProfile"
        :fallback="activeProfileInitial"
      />
    </button>

    <Transition
      name="quick-settings-menu"
      @after-leave="handleMenuAfterLeave"
    >
      <FtCard
        v-if="menuOpen"
        :id="id"
        ref="menuRef"
        class="quickSettingsMenu"
        role="dialog"
        :aria-label="t('Settings.Quick Settings.Quick Settings')"
        tabindex="-1"
        @focusout="handleMenuFocusOut"
        @keydown.esc.stop="closeMenu"
      >
        <template v-if="profilePanelOpen">
          <header class="profilePanelHeader">
            <button
              type="button"
              :aria-label="t('Back')"
              :title="t('Back')"
              @click="closeProfilePanel"
            >
              <FtIcon :icon="['fas', 'arrow-left']" />
            </button>
            <h2>{{ t('Profile.Profile Select') }}</h2>
            <button
              type="button"
              :aria-label="t('Profile.Profile Settings')"
              :title="t('Profile.Profile Settings')"
              @click="openProfileSettings"
            >
              <FtIcon :icon="['fas', 'sliders-h']" />
            </button>
          </header>
          <div
            ref="profileScrollRef"
            v-overlay-scrollbars
            class="quickSettingsScroll"
          >
            <div
              class="profileList"
              role="listbox"
              :aria-label="t('Profile.Profile Select')"
            >
              <button
                v-for="profile in profileList"
                :key="profile._id"
                type="button"
                class="profileOption"
                role="option"
                :aria-selected="profile._id === activeProfile._id"
                @click="setActiveProfile(profile)"
              >
                <FtProfileIcon
                  class="profileAvatar"
                  :profile="profile"
                  :fallback="profileInitials[profile._id]"
                />
                <span dir="auto">{{ translateProfileName(profile) }}</span>
                <FtIcon
                  v-if="profile._id === activeProfile._id"
                  class="activeProfileIcon"
                  :icon="['fas', 'check']"
                />
              </button>
            </div>
          </div>
        </template>

        <template v-else>
          <div
            class="profileHeaderRow"
          >
            <button
              type="button"
              class="profileSummary"
              @click="openProfilePanel"
            >
              <FtProfileIcon
                class="profileAvatar"
                :profile="activeProfile"
                :fallback="activeProfileInitial"
              />
              <span class="profileSummaryText">
                <strong dir="auto">{{ translateProfileName(activeProfile) }}</strong>
                <small>{{ t('Settings.Quick Settings.Profile Selector Hint') }}</small>
              </span>
              <FtIcon :icon="['fas', 'angle-right']" />
            </button>
            <button
              type="button"
              class="quickSettingsShortcut commandPaletteShortcut"
              :aria-label="t('CommandPalette.Open')"
              :title="t('CommandPalette.Open')"
              @click="openCommandPalette"
            >
              <FtIcon :icon="['fas', 'terminal']" />
            </button>
            <button
              v-if="showDownloadsShortcut"
              type="button"
              class="quickSettingsShortcut downloadsShortcut"
              :aria-label="t('Settings.Download Settings.Download Settings')"
              :title="t('Settings.Download Settings.Download Settings')"
              @click="openDownloads"
            >
              <FtIcon :icon="['fas', 'download']" />
            </button>
            <button
              v-if="showSettingsShortcut"
              type="button"
              class="quickSettingsShortcut allSettingsShortcut"
              :aria-label="t('Settings.Quick Settings.All Settings')"
              :title="t('Settings.Quick Settings.All Settings')"
              @click="openSettings"
            >
              <FtIcon :icon="['fas', 'cog']" />
            </button>
          </div>

          <div
            ref="mainScrollRef"
            v-overlay-scrollbars
            class="quickSettingsScroll"
          >
            <div
              ref="mainContentRef"
              class="quickSettingsContent"
            >
              <section
                v-for="(section, sectionIndex) in orderedQuickSettingSections"
                :key="`${section.id}-${sectionIndex}`"
                class="menuSection"
              >
                <h3>
                  <FtIcon
                    class="menuSectionIcon"
                    :icon="section.icon"
                    aria-hidden="true"
                  />
                  <span>{{ section.label }}</span>
                </h3>
                <div
                  v-for="setting in section.settings"
                  :key="setting.id"
                  class="quickSettingControl"
                  :class="{ pairedQuickSetting: isPairedQuickSetting(section.settings, setting.id) }"
                  :data-setting-id="setting.id"
                >
                  <FtSelect
                    v-if="setting.id === 'baseTheme'"
                    class="quickSelect"
                    :placeholder="t('Settings.Theme Settings.Base Theme.Base Theme')"
                    :value="baseTheme"
                    setting-key="baseTheme"
                    :select-names="baseThemeNames"
                    :select-values="baseThemeValues"
                    :disabled="customThemeEditorOpen"
                    :icon="['fas', 'palette']"
                    @change="updateSetting('BaseTheme', $event)"
                  />
                  <FtSelect
                    v-else-if="setting.id === 'mainColor'"
                    class="quickSelect"
                    :placeholder="t('Settings.Theme Settings.Main Color Theme.Main Color Theme')"
                    :value="mainColor"
                    setting-key="mainColor"
                    :select-names="colorNames"
                    :select-values="COLOR_VALUES"
                    :option-colors="COLOR_SWATCHES"
                    :icon="['fas', 'palette']"
                    icon-color="var(--primary-color)"
                    @change="updateSetting('MainColor', $event)"
                  />
                  <div
                    v-else-if="setting.id === 'uiScale'"
                    class="sliderGroup"
                  >
                    <FtSlider
                      :label="t('Settings.Theme Settings.UI Scale')"
                      :default-value="uiScale"
                      :min-value="50"
                      :max-value="300"
                      :step="5"
                      value-extension="%"
                      @change="updateUiScale"
                    />
                  </div>
                  <div
                    v-else-if="setting.id === 'thumbnailSize'"
                    class="sliderGroup"
                  >
                    <FtSlider
                      class="thumbnailSizeSlider"
                      :label="t('Settings.Theme Settings.Thumbnail Size')"
                      :default-value="thumbnailSize"
                      setting-key="thumbnailSize"
                      :min-value="MIN_THUMBNAIL_SIZE"
                      :max-value="MAX_THUMBNAIL_SIZE"
                      :step="THUMBNAIL_SIZE_STEP"
                      value-extension="%"
                      @input="previewThumbnailSize"
                      @change="updateThumbnailSize"
                    />
                  </div>
                  <FtSelect
                    v-else-if="setting.id === 'defaultQuality'"
                    class="quickSelect"
                    :placeholder="t('Settings.Player Settings.Default Quality.Default Quality')"
                    :value="defaultQuality"
                    setting-key="defaultQuality"
                    :select-names="qualityNames"
                    :select-values="qualityValues"
                    :icon="['fas', 'photo-film']"
                    @change="updateSetting('DefaultQuality', $event)"
                  />
                  <FtToggleSwitch
                    v-else-if="setting.id === 'playNextVideo'"
                    :label="t('Settings.Player Settings.Play Next Video')"
                    :default-value="playNextVideo"
                    :disabled="hideRecommendedVideos"
                    setting-key="playNextVideo"
                    compact
                    @change="updateSetting('PlayNextVideo', $event)"
                  />
                  <FtSlider
                    v-else-if="setting.id === 'defaultPlayback'"
                    :label="t('Settings.Player Settings.Default Playback Rate')"
                    :default-value="store.getters.getDefaultPlayback"
                    setting-key="defaultPlayback"
                    :min-value="store.getters.getVideoPlaybackRateInterval"
                    :max-value="store.getters.getMaxVideoPlaybackRate"
                    :step="store.getters.getVideoPlaybackRateInterval"
                    value-extension="x"
                    @change="updateSetting('DefaultPlayback', $event)"
                  />
                  <FtToggleSwitch
                    v-else-if="setting.id === 'enableSubtitlesByDefault'"
                    :label="t('Settings.Player Settings.Turn on Subtitles by Default')"
                    :default-value="enableSubtitlesByDefault"
                    setting-key="enableSubtitlesByDefault"
                    compact
                    @change="updateSetting('EnableSubtitlesByDefault', $event)"
                  />
                  <FtSelect
                    v-else-if="setting.id === 'listType'"
                    class="quickSelect"
                    :placeholder="t('Settings.General Settings.Video View Type.Video View Type')"
                    :value="listType"
                    setting-key="listType"
                    :select-names="viewTypeNames"
                    :select-values="VIEW_TYPE_VALUES"
                    :icon="listType === 'grid' ? ['fas', 'grip'] : ['fas', 'list']"
                    @change="updateSetting('ListType', $event)"
                  />
                  <FtSelect
                    v-else-if="setting.id === 'playlistViewType'"
                    class="quickSelect"
                    :placeholder="t('Settings.General Settings.Playlist View Type.Playlist View Type')"
                    :value="playlistViewType"
                    setting-key="playlistViewType"
                    :select-names="viewTypeNames"
                    :select-values="VIEW_TYPE_VALUES"
                    :icon="playlistViewType === 'grid' ? ['fas', 'grip'] : ['fas', 'list']"
                    @change="updateSetting('PlaylistViewType', $event)"
                  />
                  <FtToggleSwitch
                    v-else-if="setting.id === 'hideRecommendedVideos'"
                    :label="t('Settings.Distraction Free Settings.Hide Recommended Videos')"
                    :default-value="hideRecommendedVideos"
                    setting-key="hideRecommendedVideos"
                    compact
                    @change="handleHideRecommendedVideos"
                  />
                  <FtToggleSwitch
                    v-else-if="setting.id === 'hideComments'"
                    :label="t('Settings.Distraction Free Settings.Hide Comments')"
                    :default-value="hideComments"
                    setting-key="hideComments"
                    compact
                    @change="updateSetting('HideComments', $event)"
                  />
                  <FtSelect
                    v-else-if="setting.id === 'currentLocale'"
                    class="quickSelect"
                    :placeholder="t('Settings.General Settings.Locale Preference')"
                    :value="currentLocale"
                    setting-key="currentLocale"
                    :select-names="localeNames"
                    :select-values="LOCALE_VALUES"
                    :icon="['fas', 'language']"
                    is-locale-selector
                    @change="updateSetting('CurrentLocale', $event)"
                  />
                  <FtSelect
                    v-else-if="setting.id === 'region'"
                    class="quickSelect"
                    :placeholder="t('Settings.General Settings.Region for Trending')"
                    :value="region"
                    setting-key="region"
                    :select-names="regionNames"
                    :select-values="regionValues"
                    :icon="['fas', 'globe']"
                    @change="updateSetting('Region', $event)"
                  />
                  <FtToggleSwitch
                    v-else-if="setting.id === 'useProxy'"
                    :label="t('Settings.Proxy Settings.Enable Tor / Proxy')"
                    :default-value="useProxy"
                    setting-key="useProxy"
                    compact
                    @change="updateProxy"
                  />
                  <FtQuickSettingControl
                    v-else
                    :definition="setting"
                    @update="updateBasicQuickSetting"
                  />
                </div>
              </section>

              <div class="menuLinks">
                <button
                  v-if="USING_ELECTRON"
                  type="button"
                  @click="openKeyboardShortcuts"
                >
                  <FtIcon :icon="['fas', 'keyboard']" />
                  <span>{{ t('KeyboardShortcutPrompt.Keyboard Shortcuts') }}</span>
                  <FtIcon
                    class="linkArrow"
                    :icon="['fas', 'angle-right']"
                  />
                </button>
                <button
                  type="button"
                  @click="openAbout"
                >
                  <FtIcon :icon="['fas', 'info-circle']" />
                  <span>{{ t('About.About') }}</span>
                  <FtIcon
                    class="linkArrow"
                    :icon="['fas', 'angle-right']"
                  />
                </button>
              </div>
            </div>
          </div>
        </template>
      </FtCard>
    </Transition>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtCard from '../ft-card/ft-card.vue'
import FtSelect from '../FtSelect/FtSelect.vue'
import FtSlider from '../FtSlider/FtSlider.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'
import FtProfileIcon from '../FtProfileIcon/FtProfileIcon.vue'
import FtQuickSettingControl from '../FtQuickSettingControl/FtQuickSettingControl.vue'

import store from '../../store/index'
import allLocales from '../../../../static/locales/activeLocales.json'
import { localeTranslationPercentages } from '../../i18n/index'
import { colors } from '../../helpers/colors'
import { OPEN_COMMAND_PALETTE_EVENT } from '../../helpers/commandPalette'
import { useColorTranslations } from '../../composables/colors'
import {
  MAX_THUMBNAIL_SIZE,
  MIN_THUMBNAIL_SIZE,
  THUMBNAIL_SIZE_STEP
} from '../../constants/thumbnailSize'
import { AUTO_QUALITY_FALLBACK, playbackEngineSupportsAutoQuality } from '../../helpers/player/autoQuality'
import { getFirstCharacter } from '../../helpers/strings'
import { clampOverlayScrollTop, restoreOverlayScrollTop } from '../../helpers/overlayScrollbars'
import {
  createQuickSettingCatalog,
  createQuickSettingSections,
  isQuickSettingPaired,
} from '../../helpers/quickSettings'
import { defaultUpdaterId } from '../../store/modules/settings'
import { switchActiveProfile, translateProfileName as getTranslatedProfileName } from '../../helpers/profileSwitching'
import { customThemeValue, isCustomThemeValue } from '../../../customTheme'

const { locale, t } = useI18n()
const id = useId()
const USING_ELECTRON = process.env.IS_ELECTRON
const systemColorScheme = window.matchMedia('(prefers-color-scheme: dark)')
const systemUsesDarkTheme = ref(systemColorScheme.matches)

const menuOpen = ref(false)
const profilePanelOpen = ref(false)
let mouseDownOnTrigger = false
let pointerDownInsideMenu = false
let pendingSettingUpdateCount = 0
const triggerRef = useTemplateRef('triggerRef')
const menuRef = useTemplateRef('menuRef')
const mainScrollRef = useTemplateRef('mainScrollRef')
const mainContentRef = useTemplateRef('mainContentRef')
const profileScrollRef = useTemplateRef('profileScrollRef')
let mainContentResizeObserver = null

const profileList = computed(() => store.getters.getProfileList)
const activeProfile = computed(() => store.getters.getActiveProfile)
const activeProfileInitial = computed(() => activeProfile.value?.name
  ? getFirstCharacter(translateProfileName(activeProfile.value), locale.value)
  : '')
const profileInitials = computed(() => profileList.value.reduce((initials, profile) => {
  initials[profile._id] = profile?.name
    ? getFirstCharacter(translateProfileName(profile), locale.value)
    : ''
  return initials
}, {}))

const BUILTIN_BASE_THEME_VALUES = [
  'system', 'light', 'dark', 'black', 'nordic', 'hotPink', 'pastelPink',
  'catppuccinFrappe', 'catppuccinLatte', 'catppuccinMocha', 'dracula',
  'everforestDarkHard', 'everforestDarkMedium', 'everforestDarkLow',
  'everforestLightHard', 'everforestLightMedium', 'everforestLightLow',
  'gruvboxDark', 'gruvboxLight', 'solarizedDark', 'solarizedLight'
]

const builtInBaseThemeNames = computed(() => [
  t('Settings.Theme Settings.Base Theme.System Default'),
  t('Settings.Theme Settings.Base Theme.Light'),
  t('Settings.Theme Settings.Base Theme.Dark'),
  t('Settings.Theme Settings.Base Theme.Black'),
  t('Settings.Theme Settings.Base Theme.Nordic'),
  t('Settings.Theme Settings.Base Theme.Hot Pink'),
  t('Settings.Theme Settings.Base Theme.Pastel Pink'),
  t('Settings.Theme Settings.Base Theme.Catppuccin Frappe'),
  t('Settings.Theme Settings.Base Theme.Catppuccin Latte'),
  t('Settings.Theme Settings.Base Theme.Catppuccin Mocha'),
  t('Settings.Theme Settings.Base Theme.Dracula'),
  t('Settings.Theme Settings.Base Theme.Everforest Dark Hard'),
  t('Settings.Theme Settings.Base Theme.Everforest Dark Medium'),
  t('Settings.Theme Settings.Base Theme.Everforest Dark Low'),
  t('Settings.Theme Settings.Base Theme.Everforest Light Hard'),
  t('Settings.Theme Settings.Base Theme.Everforest Light Medium'),
  t('Settings.Theme Settings.Base Theme.Everforest Light Low'),
  t('Settings.Theme Settings.Base Theme.Gruvbox Dark'),
  t('Settings.Theme Settings.Base Theme.Gruvbox Light'),
  t('Settings.Theme Settings.Base Theme.Solarized Dark'),
  t('Settings.Theme Settings.Base Theme.Solarized Light')
])
const customThemes = computed(() => store.getters.getCustomThemes)
const baseThemeValues = computed(() => [
  ...BUILTIN_BASE_THEME_VALUES,
  ...customThemes.value.map(({ id }) => customThemeValue(id))
])
const baseThemeNames = computed(() => [
  ...builtInBaseThemeNames.value,
  ...customThemes.value.map(({ name }) => name)
])

const COLOR_VALUES = colors.map(color => color.name)
const COLOR_SWATCHES = colors.map(color => color.value)
const colorNames = useColorTranslations()
const VIEW_TYPE_VALUES = ['grid', 'list']
const viewTypeNames = computed(() => [
  t('Settings.General Settings.Video View Type.Grid'),
  t('Settings.General Settings.Video View Type.List')
])
const LOCALE_VALUES = ['system', ...allLocales]
const localeNames = computed(() => [
  t('Settings.General Settings.System Default'),
  ...process.env.LOCALE_NAMES.map((name, index) => `${name} (${localeTranslationPercentages.value[index]}%)`)
])

const baseTheme = computed(() => store.getters.getBaseTheme)
const usesCustomThemePalette = computed(() => isCustomThemeValue(baseTheme.value) || (
  baseTheme.value === 'system' && isCustomThemeValue(systemUsesDarkTheme.value
    ? store.getters.getSystemDarkTheme
    : store.getters.getSystemLightTheme)
))
const customThemeEditorOpen = computed(() => store.getters.getCustomThemeEditorOpen)
const mainColor = computed(() => store.getters.getMainColor)
const mainColorAvailable = computed(() => (
  !customThemeEditorOpen.value &&
  baseTheme.value !== 'hotPink' &&
  !usesCustomThemePalette.value
))
const uiScale = computed(() => store.getters.getUiScale)
const thumbnailSize = computed(() => store.getters.getThumbnailSize)
const playNextVideo = computed(() => store.getters.getPlayNextVideo)
const enableSubtitlesByDefault = computed(() => store.getters.getEnableSubtitlesByDefault)
const listType = computed(() => store.getters.getListType)
const playlistViewType = computed(() => store.getters.getPlaylistViewType)
const hideRecommendedVideos = computed(() => store.getters.getHideRecommendedVideos)
const hideComments = computed(() => store.getters.getHideComments)
const currentLocale = computed(() => store.getters.getCurrentLocale)
const region = computed(() => store.getters.getRegion)
const regionNames = computed(() => store.getters.getRegionNames)
const regionValues = computed(() => store.getters.getRegionValues)
const useProxy = computed(() => store.getters.getUseProxy)
const proxyUrl = computed(() => (
  `${store.getters.getProxyProtocol}://${store.getters.getProxyHostname}:${store.getters.getProxyPort}`
))
const showDownloadsShortcut = computed(() => (
  USING_ELECTRON &&
  store.getters.getEnableDownloads &&
  !store.getters.getMoveDownloadsToAppHeader
))
const showSettingsShortcut = computed(() => (
  !USING_ELECTRON || !store.getters.getMoveSettingsToAppHeader
))

const quickSettings = computed(() => store.getters.getQuickSettings)
const quickSettingCatalog = computed(() => createQuickSettingCatalog(t, USING_ELECTRON))
const quickSettingSectionDefinitions = computed(() => new Map(
  createQuickSettingSections(t, USING_ELECTRON).map(section => [section.id, section])
))
const orderedQuickSettingSections = computed(() => {
  const catalogById = new Map(quickSettingCatalog.value.map(setting => [setting.id, setting]))
  const visibleSettings = quickSettings.value
    .map(settingId => catalogById.get(settingId))
    .filter(setting => setting != null && (
      (setting.id !== 'mainColor' || mainColorAvailable.value) &&
      (setting.id !== 'region' || regionValues.value.length > 0)
    ))

  return visibleSettings.reduce((sections, setting) => {
    let section = sections.at(-1)
    if (section?.id !== setting.section) {
      const sectionDefinition = quickSettingSectionDefinitions.value.get(setting.section)
      section = {
        id: setting.section,
        label: setting.id === 'useProxy'
          ? t('Settings.Proxy Settings.Proxy Settings')
          : sectionDefinition.label,
        icon: sectionDefinition.icon,
        settings: [],
      }
      sections.push(section)
    }
    section.settings.push(setting)
    return sections
  }, [])
})

function isPairedQuickSetting(settings, settingId) {
  const settingIndex = settings.findIndex(setting => setting.id === settingId)
  return isQuickSettingPaired(settings, settingIndex)
}

const RESOLUTION_VALUES = ['2160', '1440', '1080', '720', '480', '360', '240', '144']
const autoQualityAvailable = computed(() => playbackEngineSupportsAutoQuality(store.getters.getVideoPlaybackEngine))
const qualityValues = computed(() => autoQualityAvailable.value ? [...RESOLUTION_VALUES, 'auto'] : RESOLUTION_VALUES)
const qualityNames = computed(() => [
  t('Settings.Player Settings.Default Quality.4k'),
  t('Settings.Player Settings.Default Quality.1440p'),
  t('Settings.Player Settings.Default Quality.1080p'),
  t('Settings.Player Settings.Default Quality.720p'),
  t('Settings.Player Settings.Default Quality.480p'),
  t('Settings.Player Settings.Default Quality.360p'),
  t('Settings.Player Settings.Default Quality.240p'),
  t('Settings.Player Settings.Default Quality.144p'),
  ...(autoQualityAvailable.value ? [t('Settings.Player Settings.Default Quality.Auto')] : [])
])
const defaultQuality = computed(() => {
  const value = store.getters.getDefaultQuality
  return value === 'auto' && !autoQualityAvailable.value ? AUTO_QUALITY_FALLBACK : value
})

function toggleMenu() {
  menuOpen.value = !menuOpen.value
  if (menuOpen.value) {
    profilePanelOpen.value = false
    nextTick(() => {
      menuRef.value?.$el?.focus()
      const scrollViewport = mainScrollRef.value
      if (scrollViewport) restoreOverlayScrollTop(scrollViewport, 0)
      observeMainContent()
    })
  }
}

function handleMenuAfterLeave() {
  if (!menuOpen.value) {
    profilePanelOpen.value = false
    stopObservingMainContent()
  }
}

function clampMainContentScroll() {
  const scrollViewport = mainScrollRef.value
  const content = mainContentRef.value
  if (scrollViewport && content) clampOverlayScrollTop(scrollViewport, content)
}

function observeMainContent() {
  stopObservingMainContent()
  const content = mainContentRef.value
  if (!content) return
  mainContentResizeObserver = new ResizeObserver(clampMainContentScroll)
  mainContentResizeObserver.observe(content)
  clampMainContentScroll()
}

function stopObservingMainContent() {
  mainContentResizeObserver?.disconnect()
  mainContentResizeObserver = null
}

function handleTriggerMouseDown(event) {
  if (event.button === 0 && menuOpen.value) {
    mouseDownOnTrigger = true
  }
}

async function focusMenu() {
  await nextTick()
  menuRef.value?.$el?.focus()
}

function handleWindowFocus() {
  if (menuOpen.value && !menuRef.value?.$el?.matches(':focus-within')) {
    menuRef.value?.$el?.focus()
  }
}

function handleWindowBlur() {
  pointerDownInsideMenu = false
}

function handleSystemColorSchemeChange(event) {
  return runSettingUpdate(() => {
    systemUsesDarkTheme.value = event.matches
  })
}

function handleDocumentPointerDown(event) {
  pointerDownInsideMenu = event.target instanceof Node && menuRef.value?.$el?.contains(event.target)
}

function handleDocumentPointerUp() {
  setTimeout(() => {
    pointerDownInsideMenu = false
  })
}

onMounted(() => {
  window.addEventListener('focus', handleWindowFocus)
  window.addEventListener('blur', handleWindowBlur)
  systemColorScheme.addEventListener('change', handleSystemColorSchemeChange)
  document.addEventListener('pointerdown', handleDocumentPointerDown, true)
  document.addEventListener('pointerup', handleDocumentPointerUp, true)
  document.addEventListener('pointercancel', handleDocumentPointerUp, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('focus', handleWindowFocus)
  window.removeEventListener('blur', handleWindowBlur)
  systemColorScheme.removeEventListener('change', handleSystemColorSchemeChange)
  document.removeEventListener('pointerdown', handleDocumentPointerDown, true)
  document.removeEventListener('pointerup', handleDocumentPointerUp, true)
  document.removeEventListener('pointercancel', handleDocumentPointerUp, true)
  stopObservingMainContent()
})

watch(profilePanelOpen, async (profileOpen) => {
  if (!menuOpen.value) return
  stopObservingMainContent()
  await nextTick()
  const scrollViewport = profileOpen ? profileScrollRef.value : mainScrollRef.value
  if (scrollViewport) restoreOverlayScrollTop(scrollViewport, 0)
  if (!profileOpen) observeMainContent()
})

watch(mainColorAvailable, async () => {
  await nextTick()
  clampMainContentScroll()
})

function openProfilePanel() {
  profilePanelOpen.value = true
  focusMenu()
}

function openProfilePanelFromContextMenu() {
  menuOpen.value = true
  openProfilePanel()
}

function closeProfilePanel() {
  profilePanelOpen.value = false
  focusMenu()
}

function updateBasicQuickSetting(settingId, value) {
  return runSettingUpdate(() => store.dispatch(defaultUpdaterId(settingId), value))
}

function handleMenuFocusOut(event) {
  if (event.relatedTarget === null) {
    const controlChangedDuringClick = pointerDownInsideMenu || pendingSettingUpdateCount > 0
    const focusTarget = event.target
    const focusTargetLabel = focusTarget instanceof HTMLElement
      ? focusTarget.closest('label')
      : null
    const associatedControl = focusTargetLabel instanceof HTMLLabelElement
      ? focusTargetLabel.control
      : null
    setTimeout(() => {
      const focusedControlWasRemoved = focusTarget instanceof Node && !focusTarget.isConnected
      if (controlChangedDuringClick || focusedControlWasRemoved) {
        const menu = menuRef.value?.$el
        if (
          focusedControlWasRemoved &&
          associatedControl instanceof HTMLElement &&
          associatedControl.isConnected &&
          menu?.contains(associatedControl)
        ) {
          associatedControl.focus({ preventScroll: true, focusVisible: true })
        } else if (!menu?.matches(':focus-within')) {
          focusMenu()
        }
        return
      }
      if (document.hasFocus() && !menuRef.value?.$el.matches(':focus-within')) {
        menuOpen.value = false
      }
    })
    return
  }

  if (mouseDownOnTrigger) {
    mouseDownOnTrigger = false
  } else if (!menuRef.value?.$el.matches(':focus-within')) {
    menuOpen.value = false
  }
}

function closeMenu() {
  menuOpen.value = false
  triggerRef.value?.focus()
}

function translateProfileName(profile) {
  return getTranslatedProfileName(profile, t)
}

function setActiveProfile(profile) {
  switchActiveProfile(store, profile, t)
  menuOpen.value = false
}

function openProfileSettings() {
  menuOpen.value = false
  store.dispatch('showSettingsWindow', 'profile')
}

/**
 * @param {string} setting
 * @param {string | boolean} value
 */
async function updateSetting(setting, value) {
  return runSettingUpdate(() => store.dispatch(`update${setting}`, value))
}

async function runSettingUpdate(update) {
  const menu = menuRef.value?.$el
  const focusTarget = document.activeElement instanceof HTMLElement && menu?.contains(document.activeElement)
    ? document.activeElement
    : null
  pendingSettingUpdateCount++
  try {
    await update()
  } finally {
    await nextTick()
    if (focusTarget?.isConnected && menu?.contains(focusTarget)) {
      focusTarget.focus({ preventScroll: true, focusVisible: true })
    } else if (!menu?.matches(':focus-within')) {
      await focusMenu()
    }
    pendingSettingUpdateCount--
  }
}

function updateUiScale(value) {
  return runSettingUpdate(() => store.dispatch('updateUiScale', value))
}

function updateProxy(value) {
  return runSettingUpdate(async () => {
    if (USING_ELECTRON) {
      if (value) {
        await window.ftElectron.enableProxy(proxyUrl.value)
      } else {
        await window.ftElectron.disableProxy()
      }
    }
    await store.dispatch('updateUseProxy', value)
  })
}

function previewThumbnailSize(value) {
  store.commit('setThumbnailSize', value)
}

function updateThumbnailSize(value) {
  return runSettingUpdate(() => store.dispatch('updateThumbnailSize', value))
}

function handleHideRecommendedVideos(value) {
  return runSettingUpdate(async () => {
    if (value) {
      await store.dispatch('updatePlayNextVideo', false)
    }
    await store.dispatch('updateHideRecommendedVideos', value)
  })
}

function openSettings() {
  menuOpen.value = false
  store.dispatch('toggleSettingsWindow')
}

function openDownloads() {
  menuOpen.value = false
  store.dispatch('showSettingsWindow', 'downloads')
}

function openKeyboardShortcuts() {
  menuOpen.value = false
  store.dispatch('showKeyboardShortcutPrompt')
}

function openCommandPalette() {
  menuOpen.value = false
  window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE_EVENT))
}

function openAbout() {
  menuOpen.value = false
  store.dispatch('showSettingsWindow', 'about')
}

</script>

<style scoped src="./FtQuickSettingsMenu.css" />
