<template>
  <FtSettingsSection
    :title="$t('Settings.Theme Settings.Theme Settings')"
  >
    <FtFlexBox class="themeSelectRow">
      <FtSelect
        :placeholder="$t('Settings.Theme Settings.Base Theme.Base Theme')"
        :value="baseTheme"
        setting-key="baseTheme"
        :select-names="baseThemeNames"
        :select-values="baseThemeValues"
        :icon="['fas', 'palette']"
        @change="updateBaseTheme"
      />
      <FtSelect
        :placeholder="$t('Settings.Theme Settings.Icon Pack.Icon Pack')"
        :value="iconPack"
        setting-key="iconPack"
        :select-names="iconPackNames"
        :select-values="ICON_PACKS"
        :icon="['fas', 'icons']"
        @change="updateIconPack"
      />
      <FtSelect
        :placeholder="$t('Settings.Theme Settings.Toast Position.Toast Position')"
        :value="toastPosition"
        setting-key="toastPosition"
        :select-names="toastPositionNames"
        :select-values="TOAST_POSITION_VALUES"
        :icon="['fas', 'message']"
        @change="updateToastPosition"
      />
      <FtButton
        class="testToastButton"
        :label="t('Settings.Theme Settings.Toast Position.Test Toast')"
        :icon="['fas', 'message']"
        @click="showTestToast"
      />
    </FtFlexBox>
    <FtFlexBox
      v-if="baseTheme === 'system'"
      class="themeSelectRow"
    >
      <FtSelect
        :placeholder="t('Settings.Theme Settings.Light Theme')"
        :value="systemLightTheme"
        setting-key="systemLightTheme"
        :select-names="systemLightThemeNames"
        :select-values="systemLightThemeValues"
        :icon="['fas', 'sun']"
        @change="store.dispatch('updateSystemLightTheme', $event)"
      />
      <FtSelect
        :placeholder="t('Settings.Theme Settings.Dark Theme')"
        :value="systemDarkTheme"
        setting-key="systemDarkTheme"
        :select-names="systemDarkThemeNames"
        :select-values="systemDarkThemeValues"
        :icon="['fas', 'moon']"
        @change="store.dispatch('updateSystemDarkTheme', $event)"
      />
    </FtFlexBox>
    <FtFlexBox class="themeSelectRow">
      <FtSelect
        :placeholder="t('Settings.Theme Settings.Font.App Font')"
        :value="appFont"
        setting-key="appFont"
        :select-names="fontNames"
        :select-values="fontValues"
        :icon="['fas', 'font']"
        @change="updateAppFont"
        @open="loadSystemFonts"
      />
      <FtSelect
        :placeholder="$t('Settings.Theme Settings.Main Color Theme.Main Color Theme')"
        :value="mainColor"
        setting-key="mainColor"
        :select-names="colorNames"
        :select-values="COLOR_VALUES"
        :option-colors="COLOR_SWATCHES"
        :disabled="!areColorThemesEnabled"
        :icon="['fas', 'palette']"
        icon-color="var(--primary-color)"
        @change="updateMainColor"
      />
      <FtSelect
        :placeholder="$t('Settings.Theme Settings.Secondary Color Theme')"
        :value="secColor"
        setting-key="secColor"
        :select-names="colorNames"
        :select-values="COLOR_VALUES"
        :option-colors="COLOR_SWATCHES"
        :disabled="!areColorThemesEnabled"
        :icon="['fas', 'palette']"
        icon-color="var(--accent-color)"
        @change="updateSecColor"
      />
    </FtFlexBox>
    <FtFlexBox class="customThemeActions">
      <FtButton
        :label="t('Theme Discovery.Discover Themes')"
        :icon="['fas', 'search']"
        @click="showThemeDiscovery = true"
      />
      <FtButton
        :label="t('Settings.Theme Settings.Custom Theme.Create Custom Theme')"
        :icon="['fas', 'palette']"
        @click="openCustomThemeEditor(null)"
      />
      <FtButton
        v-if="selectedCustomThemeId"
        :label="t('Settings.Theme Settings.Custom Theme.Edit Custom Theme')"
        :icon="['fas', 'pen']"
        @click="openCustomThemeEditor(selectedCustomThemeId)"
      />
    </FtFlexBox>
    <ThemeDiscovery
      :open="showThemeDiscovery"
      @close="showThemeDiscovery = false"
    />
    <CustomThemeEditor
      :open="showCustomThemeEditor"
      :theme-id="editingCustomThemeId"
      @close="showCustomThemeEditor = false"
    />
  </FtSettingsSection>
  <FtSettingsSection :title="t('Settings.Categories.Layout')">
    <FtFlexBox
      v-if="IS_CAPACITOR"
      class="themeSelectRow"
    >
      <FtSelect
        :placeholder="t('Settings.General Settings.Mobile Layout.Mobile Layout')"
        :value="capacitorLayoutMode"
        setting-key="capacitorLayoutMode"
        :select-names="capacitorLayoutModeNames"
        :select-values="CAPACITOR_LAYOUT_MODE_VALUES"
        :icon="['fas', 'display']"
        @change="store.dispatch('updateCapacitorLayoutMode', $event)"
      />
    </FtFlexBox>
    <div class="switchColumnGrid">
      <div class="switchColumn">
        <FtToggleSwitch
          :label="$t('Settings.Theme Settings.Match Top Bar with Main Color')"
          compact
          :default-value="barColor"
          setting-key="barColor"
          @change="updateBarColor"
        />
        <FtToggleSwitch
          :label="$t('Settings.Theme Settings.Expand Side Bar by Default')"
          compact
          :default-value="expandSideBar"
          setting-key="expandSideBar"
          @change="handleExpandSideBar"
        />
        <FtToggleSwitch
          v-if="usingElectron || IS_CAPACITOR"
          :label="$t('Settings.Theme Settings.Move Downloads to App Header')"
          compact
          :default-value="moveDownloadsToAppHeader"
          setting-key="moveDownloadsToAppHeader"
          @change="updateMoveDownloadsToAppHeader"
        />
        <FtToggleSwitch
          v-if="usingElectron"
          :label="$t('Settings.Theme Settings.Disable Smooth Scrolling')"
          compact
          :default-value="disableSmoothScrollingToggleValue"
          @change="handleRestartPrompt"
        />
        <FtToggleSwitch
          :label="$t('Settings.Theme Settings.Always Show Scrollbars')"
          :tooltip="$t('Tooltips.Theme Settings.Always Show Scrollbars')"
          compact
          :default-value="alwaysShowScrollbars"
          setting-key="alwaysShowScrollbars"
          @change="updateAlwaysShowScrollbars"
        />
        <FtToggleSwitch
          :label="$t('Settings.Theme Settings.Show Toast Timeout Indicator')"
          compact
          :default-value="showToastTimeoutIndicator"
          setting-key="showToastTimeoutIndicator"
          @change="updateShowToastTimeoutIndicator"
        />
        <FtToggleSwitch
          :label="$t('Settings.Theme Settings.Use Grid Player Menu')"
          :tooltip="$t('Tooltips.Theme Settings.Use Grid Player Menu')"
          compact
          :default-value="usePlayerMenuGrid"
          setting-key="usePlayerMenuGrid"
          @change="updateUsePlayerMenuGrid"
        />
        <FtToggleSwitch
          v-if="usingElectron || IS_CAPACITOR"
          :label="$t('Settings.Theme Settings.Use Fixed Tab Width')"
          :tooltip="$t('Tooltips.Theme Settings.Use Fixed Tab Width')"
          compact
          :default-value="useFixedTabWidth"
          setting-key="useFixedTabWidth"
          @change="updateUseFixedTabWidth"
        />
      </div>
      <div class="switchColumn">
        <FtToggleSwitch
          :label="$t('Settings.Theme Settings.Hide Side Bar Labels')"
          compact
          :default-value="hideLabelsSideBar"
          setting-key="hideLabelsSideBar"
          @change="updateHideLabelsSideBar"
        />
        <FtToggleSwitch
          :label="$t('Settings.Theme Settings.Hide Side Bar on Watch Pages')"
          compact
          :default-value="hideSideBarOnWatchPages"
          setting-key="hideSideBarOnWatchPages"
          @change="updateHideSideBarOnWatchPages"
        />
        <FtToggleSwitch
          :label="$t('Settings.Theme Settings.Hide OpenTubeX Header Logo')"
          compact
          :default-value="hideHeaderLogo"
          setting-key="hideHeaderLogo"
          @change="updateHideHeaderLogo"
        />
        <FtToggleSwitch
          v-if="usingElectron || IS_CAPACITOR"
          :label="$t('Settings.Theme Settings.Move Settings to App Header')"
          compact
          :default-value="moveSettingsToAppHeader"
          setting-key="moveSettingsToAppHeader"
          @change="updateMoveSettingsToAppHeader"
        />
        <FtToggleSwitch
          v-if="usingElectron || IS_CAPACITOR"
          :label="$t('Settings.Theme Settings.Show Tab Icons')"
          compact
          :default-value="showTabIcons"
          setting-key="showTabIcons"
          @change="updateShowTabIcons"
        />
        <FtToggleSwitch
          v-if="usingElectron || IS_CAPACITOR"
          :label="$t('Settings.Theme Settings.Show Tab Previews')"
          compact
          :default-value="showTabPreviews"
          setting-key="showTabPreviews"
          @change="updateShowTabPreviews"
        />
        <FtToggleSwitch
          v-if="!IS_CAPACITOR"
          :label="$t('Settings.Theme Settings.Show Progress as Notification')"
          :tooltip="$t('Tooltips.Theme Settings.Show Progress as Notification')"
          compact
          :default-value="showProgressBarToast"
          setting-key="showProgressBarToast"
          @change="updateShowProgressBarToast"
        />
      </div>
    </div>
    <template v-if="usingElectron || IS_CAPACITOR">
      <FtFlexBox
        v-if="usingElectron"
        class="themeSelectRow"
      >
        <FtSelect
          :placeholder="t('Settings.Theme Settings.Tab Layout.Tab Layout')"
          :value="tabBarPosition"
          setting-key="tabBarPosition"
          :select-names="tabBarPositionNames"
          :select-values="TAB_BAR_POSITIONS"
          :icon="['fac', 'horizontal-tabs']"
          @change="updateTabBarPosition"
        />
      </FtFlexBox>
      <FtFlexBox class="tabSettingsRow">
        <div class="switchColumn">
          <FtSlider
            :label="$t('Settings.Theme Settings.Tab Width')"
            :default-value="fixedTabWidth"
            setting-key="fixedTabWidth"
            :min-value="MIN_FIXED_TAB_WIDTH"
            :max-value="MAX_FIXED_TAB_WIDTH"
            :step="FIXED_TAB_WIDTH_STEP"
            :disabled="!useFixedTabWidth"
            value-extension="px"
            @input="previewFixedTabWidth"
            @change="updateFixedTabWidth"
          />
        </div>
        <FtButton
          v-if="usingElectron && showTabIcons"
          :label="loadingTabIcons
            ? $t('Settings.Theme Settings.Loading Missing Tab Icons')
            : $t('Settings.Theme Settings.Load Missing Tab Icons')"
          :icon="['fas', 'download']"
          :disabled="loadingTabIcons || !hasMissingTabIcons"
          @click="loadTabIcons"
        />
      </FtFlexBox>
    </template>
    <FtSliderGrid>
      <FtSlider
        v-if="usingElectron || IS_CAPACITOR"
        :label="$t('Settings.Theme Settings.UI Scale')"
        :default-value="uiScale"
        :min-value="IS_CAPACITOR ? CAPACITOR_UI_SCALE_MIN : 50"
        :max-value="IS_CAPACITOR ? CAPACITOR_UI_SCALE_MAX : 300"
        :step="5"
        value-extension="%"
        @change="updateUiScale"
      />
      <FtSlider
        :label="t('Settings.Theme Settings.Thumbnail Size')"
        :default-value="thumbnailSize"
        setting-key="thumbnailSize"
        :min-value="MIN_THUMBNAIL_SIZE"
        :max-value="maxThumbnailSize"
        :step="THUMBNAIL_SIZE_STEP"
        value-extension="%"
        @input="previewThumbnailSize"
        @change="updateThumbnailSize"
      />
      <FtSlider
        :label="t('Settings.Theme Settings.UI Roundness')"
        :default-value="uiRoundness"
        setting-key="uiRoundness"
        :min-value="0"
        :max-value="200"
        :step="5"
        value-extension="%"
        @input="previewUiRoundness"
        @change="updateUiRoundness"
      />
      <FtSlider
        :label="t('Settings.Theme Settings.Scrollbar Width')"
        :default-value="scrollbarThumbWidth"
        setting-key="scrollbarThumbWidth"
        :min-value="MIN_SCROLLBAR_THUMB_WIDTH"
        :max-value="MAX_SCROLLBAR_THUMB_WIDTH"
        :step="SCROLLBAR_THUMB_WIDTH_STEP"
        value-extension="px"
        @input="previewScrollbarThumbWidth"
        @change="updateScrollbarThumbWidth"
      />
      <FtSlider
        :label="t('Settings.Theme Settings.Scroll Speed')"
        :tooltip="t('Tooltips.Theme Settings.Scroll Speed')"
        :default-value="scrollSpeed"
        setting-key="scrollSpeed"
        :min-value="MIN_SCROLL_SPEED"
        :max-value="MAX_SCROLL_SPEED"
        :step="SCROLL_SPEED_STEP"
        value-extension="%"
        @change="updateScrollSpeed"
      />
      <FtSlider
        :label="t('Settings.Theme Settings.Animation Speed')"
        :default-value="animationSpeed"
        setting-key="animationSpeed"
        :min-value="25"
        :max-value="200"
        :step="5"
        :disabled="reducedMotionEnabled"
        value-extension="%"
        @input="previewAnimationSpeed"
        @change="updateAnimationSpeed"
      />
    </FtSliderGrid>
    <FtPrompt
      v-if="showRestartPrompt"
      autosize
      :label="$t('Settings[\'The app needs to restart for changes to take effect. Restart and apply change?\']')"
      :option-names="restartPromptNames"
      :option-values="RESTART_PROMPT_VALUES"
      @click="handleSmoothScrolling"
    />
  </FtSettingsSection>
  <QuickSettingsCustomizer />
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSettingsSection from './FtSettingsSection/FtSettingsSection.vue'
import FtSelect from './FtSelect/FtSelect.vue'
import FtToggleSwitch from './FtToggleSwitch/FtToggleSwitch.vue'
import FtSlider from './FtSlider/FtSlider.vue'
import FtSliderGrid from './FtSliderGrid/FtSliderGrid.vue'
import FtFlexBox from './ft-flex-box/ft-flex-box.vue'
import FtButton from './FtButton/FtButton.vue'
import FtPrompt from './FtPrompt/FtPrompt.vue'
import ThemeDiscovery from './ThemeDiscovery.vue'
import CustomThemeEditor from './CustomThemeEditor/CustomThemeEditor.vue'
import QuickSettingsCustomizer from './QuickSettingsCustomizer/QuickSettingsCustomizer.vue'

import store from '../store/index'
import { getThemeClassification, hasFixedThemeColors } from '../../appearanceSettings'
import { BUILTIN_BASE_THEME_VALUES } from '../../constants'
import { customThemeIdFromValue, customThemeValue } from '../../customTheme'

import { colors } from '../helpers/colors'
import { useColorTranslations } from '../composables/colors'
import { useBaseThemeNames } from '../composables/baseThemes'
import { useThumbnailSizeSlider } from '../composables/useThumbnailSizeSlider'
import {
  MIN_THUMBNAIL_SIZE,
  THUMBNAIL_SIZE_STEP
} from '../constants/thumbnailSize'
import {
  FIXED_TAB_WIDTH_STEP,
  MAX_FIXED_TAB_WIDTH,
  MIN_FIXED_TAB_WIDTH
} from '../constants/tabWidth'
import {
  normalizeTabBarPosition,
  TAB_BAR_POSITIONS
} from '../constants/tabBarPosition'
import {
  MAX_SCROLLBAR_THUMB_WIDTH,
  MIN_SCROLLBAR_THUMB_WIDTH,
  normalizeScrollbarThumbWidth,
  SCROLLBAR_THUMB_WIDTH_STEP
} from '../constants/scrollbar'
import { normalizeToastPosition, TOAST_POSITION_VALUES } from '../constants/toastPosition'
import { setAnimationSpeed } from '../helpers/animationSpeed'
import {
  MAX_SCROLL_SPEED,
  MIN_SCROLL_SPEED,
  normalizeScrollSpeed,
  SCROLL_SPEED_STEP
} from '../helpers/scrollSpeed'
import { getMissingTabAvatarTabs, loadMissingTabAvatars } from '../helpers/loadTabAvatars'
import { showToast } from '../helpers/utils'
import { ICON_PACKS } from '../icons/iconPackState'
import { CAPACITOR_UI_SCALE_MIN, CAPACITOR_UI_SCALE_MAX } from '../helpers/capacitorUiScale'
import { DEFAULT_APP_FONT, normalizeAppFont, SYSTEM_APP_FONT } from '../helpers/appFont'

const { locale, t } = useI18n()
const IS_CAPACITOR = !!process.env.IS_CAPACITOR
const CAPACITOR_LAYOUT_MODE_VALUES = ['auto', 'phone', 'tablet']
const capacitorLayoutMode = computed(() => store.getters.getCapacitorLayoutMode)
const capacitorLayoutModeNames = computed(() => [
  t('Settings.General Settings.Mobile Layout.Automatic'),
  t('Settings.General Settings.Mobile Layout.Phone'),
  t('Settings.General Settings.Mobile Layout.Tablet')
])

const builtInBaseThemeNames = useBaseThemeNames()
const customThemes = computed(() => store.getters.getCustomThemes)
const baseThemeValues = computed(() => [
  ...BUILTIN_BASE_THEME_VALUES,
  ...customThemes.value.map(({ id }) => customThemeValue(id))
])
const baseThemeNames = computed(() => [
  ...builtInBaseThemeNames.value,
  ...customThemes.value.map(({ name }) => name)
])
function systemThemeOptions(classification) {
  return baseThemeValues.value.flatMap((value, index) =>
    getThemeClassification(value, customThemes.value) === classification
      ? [{ name: baseThemeNames.value[index], value }]
      : [])
}

const systemLightThemeOptions = computed(() => systemThemeOptions('light'))
const systemLightThemeValues = computed(() => systemLightThemeOptions.value.map(({ value }) => value))
const systemLightThemeNames = computed(() => systemLightThemeOptions.value.map(({ name }) => name))
const systemDarkThemeOptions = computed(() => systemThemeOptions('dark'))
const systemDarkThemeValues = computed(() => systemDarkThemeOptions.value.map(({ value }) => value))
const systemDarkThemeNames = computed(() => systemDarkThemeOptions.value.map(({ name }) => name))

const iconPackNames = computed(() => [
  t('Settings.Theme Settings.Icon Pack.Material Symbols'),
  t('Settings.Theme Settings.Icon Pack.Remix Icon')
])

const tabBarPositionNames = computed(() => [
  t('Settings.Theme Settings.Tab Layout.Horizontal Top'),
  t('Settings.Theme Settings.Tab Layout.Horizontal Bottom'),
  t('Settings.Theme Settings.Tab Layout.Vertical Left'),
  t('Settings.Theme Settings.Tab Layout.Vertical Right')
])

const tabBarPosition = computed(() => normalizeTabBarPosition(store.getters.getTabBarPosition))

/**
 * @param {'top' | 'bottom' | 'left' | 'right'} value
 */
function updateTabBarPosition(value) {
  store.dispatch('updateTabBarPosition', value)
}

const COLOR_VALUES = colors.map(color => color.name)
const COLOR_SWATCHES = colors.map(color => color.value)
const colorNames = useColorTranslations()
const showThemeDiscovery = ref(false)
const showCustomThemeEditor = ref(false)
const editingCustomThemeId = ref(null)
const systemFonts = ref([])
let systemFontsPromise = null

const appFont = computed(() => normalizeAppFont(store.getters.getAppFont))
const fontValues = computed(() => [
  DEFAULT_APP_FONT,
  SYSTEM_APP_FONT,
  ...[...new Set([
    ...IS_CAPACITOR ? [] : [appFont.value],
    ...systemFonts.value
  ])]
    .filter(font => font !== DEFAULT_APP_FONT && font !== SYSTEM_APP_FONT)
    .toSorted(new Intl.Collator([locale.value, 'en'], { sensitivity: 'base' }).compare)
])
const fontNames = computed(() => [
  DEFAULT_APP_FONT,
  t('Settings.Theme Settings.Font.System Default'),
  ...fontValues.value.slice(2)
])

function updateAppFont(value) {
  store.dispatch('updateAppFont', value)
}

async function loadSystemFonts() {
  if (IS_CAPACITOR || systemFontsPromise !== null) return

  const fontRequest = process.env.IS_ELECTRON
    ? window.ftElectron.getSystemFonts()
    : typeof window.queryLocalFonts === 'function'
      ? window.queryLocalFonts().then(fonts => fonts.map(({ family }) => family))
      : Promise.resolve([])

  systemFontsPromise = fontRequest
    .then(fonts => {
      const families = fonts
        .map(font => font.trim())
        .filter(Boolean)
      systemFonts.value = [...new Set(families)]
    })
    .catch(error => {
      console.error('Failed to load system fonts', error)
      showToast(t('Settings.Theme Settings.Font.Unable to Load'))
    })

  await systemFontsPromise
}

/** @type {import('vue').ComputedRef<boolean>} */
const barColor = computed(() => {
  return store.getters.getBarColor
})

/**
 * @param {boolean} value
 */
function updateBarColor(value) {
  store.dispatch('updateBarColor', value)
}

/** @type {import('vue').ComputedRef<string>} */
const baseTheme = computed(() => {
  return store.getters.getBaseTheme
})
const systemLightTheme = computed(() => store.getters.getSystemLightTheme)
const systemDarkTheme = computed(() => store.getters.getSystemDarkTheme)
const systemColorScheme = window.matchMedia('(prefers-color-scheme: dark)')
const systemUsesDarkTheme = ref(systemColorScheme.matches)

function updateSystemColorScheme(event) {
  systemUsesDarkTheme.value = event.matches
}

/**
 * @param {string} value
 */
function updateBaseTheme(value) {
  store.dispatch('updateBaseTheme', value)
}

const iconPack = computed(() => store.getters.getIconPack)

/**
 * @param {import('../icons/iconPackState').IconPackId} value
 */
function updateIconPack(value) {
  store.dispatch('updateIconPack', value)
}

const areColorThemesEnabled = computed(() => baseTheme.value === 'system'
  ? !hasFixedThemeColors(systemLightTheme.value) && !hasFixedThemeColors(systemDarkTheme.value)
  : !hasFixedThemeColors(baseTheme.value))
const selectedCustomThemeId = computed(() => customThemeIdFromValue(baseTheme.value === 'system'
  ? (systemUsesDarkTheme.value ? systemDarkTheme.value : systemLightTheme.value)
  : baseTheme.value))

function openCustomThemeEditor(themeId) {
  editingCustomThemeId.value = themeId
  showCustomThemeEditor.value = true
}

/** @type {import('vue').ComputedRef<string>} */
const mainColor = computed(() => {
  return store.getters.getMainColor
})

/**
 * @param {string} value
 */
function updateMainColor(value) {
  store.dispatch('updateMainColor', value)
}

/** @type {import('vue').ComputedRef<string>} */
const secColor = computed(() => {
  return store.getters.getSecColor
})

/**
 * @param {string} value
 */
function updateSecColor(value) {
  store.dispatch('updateSecColor', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const expandSideBar = computed(() => {
  return store.getters.getExpandSideBar
})

/** @type {import('vue').ComputedRef<boolean>} */
const isSideNavOpen = computed(() => {
  return store.getters.getIsSideNavOpen
})

/**
 * @param {boolean} value
 */
function handleExpandSideBar(value) {
  if (isSideNavOpen.value !== value) {
    store.commit('toggleSideNav')
  }

  store.dispatch('updateExpandSideBar', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideSideBarOnWatchPages = computed(() => store.getters.getHideSideBarOnWatchPages)

/**
 * @param {boolean} value
 */
function updateHideSideBarOnWatchPages(value) {
  store.dispatch('updateHideSideBarOnWatchPages', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideLabelsSideBar = computed(() => {
  return store.getters.getHideLabelsSideBar
})

/**
 * @param {boolean} value
 */
function updateHideLabelsSideBar(value) {
  store.dispatch('updateHideLabelsSideBar', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const alwaysShowScrollbars = computed(() => {
  return store.getters.getAlwaysShowScrollbars
})

/**
 * @param {boolean} value
 */
function updateAlwaysShowScrollbars(value) {
  store.dispatch('updateAlwaysShowScrollbars', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideHeaderLogo = computed(() => {
  return store.getters.getHideHeaderLogo
})

const moveDownloadsToAppHeader = computed(() => store.getters.getMoveDownloadsToAppHeader)
const moveSettingsToAppHeader = computed(() => store.getters.getMoveSettingsToAppHeader)

function updateMoveDownloadsToAppHeader(value) {
  store.dispatch('updateMoveDownloadsToAppHeader', value)
}

function updateMoveSettingsToAppHeader(value) {
  store.dispatch('updateMoveSettingsToAppHeader', value)
}

/**
 * @param {boolean} value
 */
function updateHideHeaderLogo(value) {
  store.dispatch('updateHideHeaderLogo', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const showToastTimeoutIndicator = computed(() => store.getters.getShowToastTimeoutIndicator)

/**
 * @param {boolean} value
 */
function updateShowToastTimeoutIndicator(value) {
  store.dispatch('updateShowToastTimeoutIndicator', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const usePlayerMenuGrid = computed(() => store.getters.getUsePlayerMenuGrid)

/**
 * @param {boolean} value
 */
function updateUsePlayerMenuGrid(value) {
  store.dispatch('updateUsePlayerMenuGrid', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const showProgressBarToast = computed(() => store.getters.getShowProgressBarToast)

/**
 * @param {boolean} value
 */
function updateShowProgressBarToast(value) {
  store.dispatch('updateShowProgressBarToast', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const showTabIcons = computed(() => store.getters.getShowTabIcons)
const hasMissingTabIcons = computed(() => getMissingTabAvatarTabs(store.getters.getTabs).length > 0)
const loadingTabIcons = ref(false)

async function loadTabIcons() {
  if (loadingTabIcons.value) return
  loadingTabIcons.value = true
  try {
    const { loaded, failed } = await loadMissingTabAvatars(store.getters.getTabs)
    if (loaded === 0 && failed === 0) {
      showToast({
        message: t('Settings.Theme Settings.No Missing Tab Icons'),
        icon: ['fas', 'circle-info'],
      })
    } else if (failed > 0) {
      showToast({
        message: t('Settings.Theme Settings.Loaded Tab Icons With Failures', { loaded, failed }),
        icon: ['fas', 'circle-exclamation'],
      })
    } else {
      showToast({
        message: t('Settings.Theme Settings.Loaded Tab Icons', { count: loaded }, loaded),
        icon: ['fas', 'check'],
      })
    }
  } finally {
    loadingTabIcons.value = false
  }
}

/**
 * @param {boolean} value
 */
function updateShowTabIcons(value) {
  store.dispatch('updateShowTabIcons', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const showTabPreviews = computed(() => store.getters.getShowTabPreviews)

/**
 * @param {boolean} value
 */
function updateShowTabPreviews(value) {
  store.dispatch('updateShowTabPreviews', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const useFixedTabWidth = computed(() => store.getters.getUseFixedTabWidth)

/** @type {import('vue').ComputedRef<number>} */
const fixedTabWidth = computed(() => store.getters.getFixedTabWidth)

/**
 * @param {boolean} value
 */
function updateUseFixedTabWidth(value) {
  store.dispatch('updateUseFixedTabWidth', value)
}

/**
 * @param {number} value
 */
function previewFixedTabWidth(value) {
  store.commit('setFixedTabWidth', value)
}

/**
 * @param {number} value
 */
function updateFixedTabWidth(value) {
  store.dispatch('updateFixedTabWidth', value)
}

const toastPositionNames = computed(() => [
  t('Settings.Theme Settings.Toast Position.Bottom Left'),
  t('Settings.Theme Settings.Toast Position.Bottom Center'),
  t('Settings.Theme Settings.Toast Position.Bottom Right'),
  t('Settings.Theme Settings.Toast Position.Top Left'),
  t('Settings.Theme Settings.Toast Position.Top Center'),
  t('Settings.Theme Settings.Toast Position.Top Right')
])

/** @type {import('vue').ComputedRef<'bottom-left' | 'bottom-center' | 'bottom-right' | 'top-left' | 'top-center' | 'top-right'>} */
const toastPosition = computed(() => normalizeToastPosition(store.getters.getToastPosition))
let toastPositionUpdatePromise = Promise.resolve()

/**
 * @param {'bottom-left' | 'bottom-center' | 'bottom-right' | 'top-left' | 'top-center' | 'top-right'} value
 */
function updateToastPosition(value) {
  toastPositionUpdatePromise = toastPositionUpdatePromise
    .then(() => store.dispatch('updateToastPosition', value))
}

async function showTestToast() {
  await toastPositionUpdatePromise
  showToast({
    message: t('Settings.Theme Settings.Toast Position.Test Toast'),
    icon: ['fas', 'message']
  })
}

/** @type {import('vue').ComputedRef<number>} */
const uiScale = computed(() => store.getters.getUiScale)

/**
 * @param {number} value
 */
function updateUiScale(value) {
  store.dispatch('updateUiScale', value)
}

const { thumbnailSize, maxThumbnailSize } = useThumbnailSizeSlider()
const uiRoundness = computed(() => store.getters.getUiRoundness)
const scrollbarThumbWidth = computed(
  () => normalizeScrollbarThumbWidth(store.getters.getScrollbarThumbWidth)
)
const scrollSpeed = computed(() => normalizeScrollSpeed(store.getters.getScrollSpeed))
const animationSpeed = computed(() => store.getters.getAnimationSpeed)

const systemReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const systemReducedMotionEnabled = ref(systemReducedMotion.matches)
const reducedMotion = computed(() => store.getters.getReducedMotion)
const reducedMotionEnabled = computed(() => reducedMotion.value === 'on' ||
  (reducedMotion.value === 'system' && systemReducedMotionEnabled.value))

function updateSystemReducedMotion(event) {
  systemReducedMotionEnabled.value = event.matches
}

onMounted(() => {
  systemReducedMotion.addEventListener('change', updateSystemReducedMotion)
  systemColorScheme.addEventListener('change', updateSystemColorScheme)
})
onUnmounted(() => {
  systemReducedMotion.removeEventListener('change', updateSystemReducedMotion)
  systemColorScheme.removeEventListener('change', updateSystemColorScheme)
})

/**
 * @param {number} value
 */
function previewThumbnailSize(value) {
  store.commit('setThumbnailSize', value)
}

/**
 * @param {number} value
 */
function updateThumbnailSize(value) {
  store.dispatch('updateThumbnailSize', value)
}

/**
 * @param {number} value
 */
function previewUiRoundness(value) {
  store.commit('setUiRoundness', value)
}

/**
 * @param {number} value
 */
function updateUiRoundness(value) {
  store.dispatch('updateUiRoundness', value)
}

/**
 * @param {number} value
 */
function previewScrollbarThumbWidth(value) {
  store.commit('setScrollbarThumbWidth', value)
}

/**
 * @param {number} value
 */
function updateScrollbarThumbWidth(value) {
  store.dispatch('updateScrollbarThumbWidth', value)
}

/**
 * @param {number} value
 */
function updateScrollSpeed(value) {
  store.dispatch('updateScrollSpeed', value)
}

/**
 * @param {number} value
 */
function previewAnimationSpeed(value) {
  setAnimationSpeed(value)
}

/**
 * @param {number} value
 */
function updateAnimationSpeed(value) {
  store.dispatch('updateAnimationSpeed', value)
}

/** @type {boolean} */
const usingElectron = process.env.IS_ELECTRON

const RESTART_PROMPT_VALUES = [
  'restart',
  'cancel'
]

const restartPromptNames = computed(() => [
  t('Yes, Restart'),
  t('Cancel')
])

/** @type {import('vue').Ref<boolean>} */
const disableSmoothScrollingToggleValue = ref(store.getters.getDisableSmoothScrolling)
const showRestartPrompt = ref(false)

/**
 * @param {boolean} value
 */
function handleRestartPrompt(value) {
  disableSmoothScrollingToggleValue.value = value
  showRestartPrompt.value = true
}

/**
 * @param {'restart' | 'cancel' | null} value
 */
function handleSmoothScrolling(value) {
  showRestartPrompt.value = false

  if (value === null || value === 'cancel') {
    disableSmoothScrollingToggleValue.value = !disableSmoothScrollingToggleValue.value
    return
  }

  if (process.env.IS_ELECTRON) {
    store.dispatch('updateDisableSmoothScrolling',
      disableSmoothScrollingToggleValue.value
    ).then(() => {
      window.ftElectron.relaunch()
    })
  }
}
</script>

<style scoped>
.customThemeActions {
  margin-block-start: 24px;
}

.themeSelectRow {
  flex-flow: row nowrap;
  justify-content: center;
  gap: 12px;
}

.themeSelectRow :deep(.select) {
  flex: 1 1 200px;
  min-inline-size: 0;
  max-inline-size: 200px;
}

.testToastButton {
  margin-block-start: 30px;
}

@container settings-content (width <= 760px) {
  .themeSelectRow {
    align-items: center;
    flex-direction: column;
  }

  .tabSettingsRow {
    align-items: center;
    flex-direction: column;
    gap: 12px;
    justify-content: center;
  }

  .themeSelectRow :deep(.select) {
    flex: 0 0 auto;
    inline-size: min(200px, 100%);
  }

  .testToastButton {
    margin-block-start: 5px;
  }
}

</style>
