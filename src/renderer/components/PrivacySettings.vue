<template>
  <FtSettingsSection
    :title="$t('Settings.Privacy Settings.Privacy Settings')"
  >
    <div class="switchColumnGrid">
      <div class="switchColumn">
        <FtToggleSwitch
          :label="$t('Settings.Privacy Settings.Internet Connectivity Checks')"
          :tooltip="$t('Settings.Privacy Settings.Internet Connectivity Checks Tooltip')"
          compact
          :default-value="internetConnectivityChecks"
          setting-key="internetConnectivityChecks"
          @change="updateInternetConnectivityChecks"
        />
        <FtToggleSwitch
          :label="$t('Settings.Privacy Settings.Remember History')"
          compact
          :default-value="rememberHistory"
          setting-key="rememberHistory"
          @change="handleRememberHistory"
        />
        <FtToggleSwitch
          :label="$t('Settings.Privacy Settings.Remember Search History')"
          compact
          :default-value="rememberSearchHistory"
          setting-key="rememberSearchHistory"
          @change="updateRememberSearchHistory"
        />
        <FtToggleSwitch
          :label="$t('Settings.Privacy Settings.Save Watched Videos With Last Viewed Playlist')"
          compact
          :disabled="!rememberHistory"
          :default-value="saveVideoHistoryWithLastViewedPlaylist"
          setting-key="saveVideoHistoryWithLastViewedPlaylist"
          @change="updateSaveVideoHistoryWithLastViewedPlaylist"
        />
      </div>
      <div class="switchColumn">
        <FtToggleSwitch
          :label="$t('Settings.Privacy Settings.Enable Watch Statistics')"
          compact
          :disabled="!rememberHistory"
          :default-value="enableWatchStats"
          setting-key="enableWatchStats"
          @change="updateEnableWatchStats"
        />
        <FtToggleSwitch
          :label="$t('Settings.General Settings.Enable Search Suggestions')"
          :default-value="enableSearchSuggestions"
          setting-key="enableSearchSuggestions"
          compact
          @change="updateEnableSearchSuggestions"
        />
        <FtToggleSwitch
          v-if="USING_ELECTRON || IS_CAPACITOR"
          :label="$t('Settings.General Settings.Remember Tab Navigation History')"
          :default-value="rememberTabNavigationHistory"
          setting-key="rememberTabNavigationHistory"
          :tooltip="$t('Tooltips.General Settings.Remember Tab Navigation History')"
          compact
          @change="updateRememberTabNavigationHistory"
        />
      </div>
    </div>
    <div class="privacyExternalLinkHandling">
      <FtSelect
        class="privacyExternalLinkSelect"
        :placeholder="$t('Settings.General Settings.External Link Handling.External Link Handling')"
        :value="externalLinkHandling"
        :select-names="externalLinkHandlingNames"
        :select-values="EXTERNAL_LINK_HANDLING_VALUES"
        :icon="['fas', 'external-link-alt']"
        :tooltip="$t('Tooltips.General Settings.External Link Handling')"
        @change="updateExternalLinkHandling"
      />
    </div>
    <br>
    <FtFlexBox>
      <FtSlider
        :label="$t('Settings.Privacy Settings.Watched Percentage Threshold')"
        :default-value="watchedPercentageThreshold"
        setting-key="watchedPercentageThreshold"
        :min-value="0"
        :max-value="100"
        :step="1"
        value-extension="%"
        :disabled="!rememberHistory"
        :tooltip="$t('Settings.Privacy Settings.Watched Percentage Threshold Tooltip')"
        @change="updateWatchedPercentageThreshold"
      />
    </FtFlexBox>
    <br>
    <FtFlexBox>
      <FtSelect
        :placeholder="$t('Settings.Privacy Settings.Week Starts On')"
        :value="statsWeekStartsOn"
        setting-key="statsWeekStartsOn"
        :select-names="weekStartNames"
        :select-values="WEEK_START_VALUES"
        :icon="['fas', 'chart-line']"
        :disabled="!rememberHistory || !enableWatchStats"
        @change="updateStatsWeekStartsOn"
      />
      <FtSelect
        :placeholder="$t('Settings.Privacy Settings.Save Watched Progress')"
        :value="watchedProgressSavingMode"
        setting-key="watchedProgressSavingMode"
        :select-names="watchedProgressSavingModeNames"
        :select-values="WATCHED_PROGRESS_SAVING_MODE_VALUES"
        :icon="['fas', 'bars-progress']"
        :tooltip="$t('Settings.Privacy Settings.Watched Progress Saving Mode.Tooltip')"
        :disabled="!rememberHistory"
        @change="updateWatchedProgressSavingMode"
      />
    </FtFlexBox>
  </FtSettingsSection>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtFlexBox from './ft-flex-box/ft-flex-box.vue'
import FtSelect from './FtSelect/FtSelect.vue'
import FtSettingsSection from './FtSettingsSection/FtSettingsSection.vue'
import FtSlider from './FtSlider/FtSlider.vue'
import FtToggleSwitch from './FtToggleSwitch/FtToggleSwitch.vue'

import store from '../store/index'

const internetConnectivityChecks = computed(() => store.getters.getInternetConnectivityChecks)
function updateInternetConnectivityChecks(value) {
  store.dispatch('updateInternetConnectivityChecks', value)
}

const { locale, t } = useI18n()
const USING_ELECTRON = process.env.IS_ELECTRON
const IS_CAPACITOR = process.env.IS_CAPACITOR

/** @type {import('vue').ComputedRef<boolean>} */
const rememberHistory = computed(() => store.getters.getRememberHistory)

/** @type {import('vue').ComputedRef<boolean>} */
const enableWatchStats = computed(() => store.getters.getEnableWatchStats)

/**
 * @param {boolean} value
 */
function updateEnableWatchStats(value) {
  store.dispatch('updateEnableWatchStats', value)
}

const WEEK_START_VALUES = ['0', '1', '2', '3', '4', '5', '6']
const weekStartNames = computed(() => {
  const formatter = new Intl.DateTimeFormat(locale.value, { weekday: 'long' })
  const sunday = new Date(2024, 0, 7, 12)

  return WEEK_START_VALUES.map((_, index) => {
    const date = new Date(sunday)
    date.setDate(date.getDate() + index)
    return formatter.format(date)
  })
})

/** @type {import('vue').ComputedRef<string>} */
const statsWeekStartsOn = computed(() => store.getters.getStatsWeekStartsOn)

/**
 * @param {string} value
 */
function updateStatsWeekStartsOn(value) {
  store.dispatch('updateStatsWeekStartsOn', value)
}

/**
 * @param {boolean} value
 */
function handleRememberHistory(value) {
  store.dispatch('updateRememberHistory', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const rememberSearchHistory = computed(() => store.getters.getRememberSearchHistory)

/**
 * @param {boolean} value
 */
function updateRememberSearchHistory(value) {
  store.dispatch('updateRememberSearchHistory', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const enableSearchSuggestions = computed(() => store.getters.getEnableSearchSuggestions)

/**
 * @param {boolean} value
 */
function updateEnableSearchSuggestions(value) {
  store.dispatch('updateEnableSearchSuggestions', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const rememberTabNavigationHistory = computed(() => store.getters.getRememberTabNavigationHistory)

/**
 * @param {boolean} value
 */
function updateRememberTabNavigationHistory(value) {
  store.dispatch('updateRememberTabNavigationHistory', value)
}

const EXTERNAL_LINK_HANDLING_VALUES = ['', 'openLinkAfterPrompt', 'doNothing']

const externalLinkHandlingNames = computed(() => [
  t('Settings.General Settings.External Link Handling.Open Link'),
  t('Settings.General Settings.External Link Handling.Ask Before Opening Link'),
  t('Settings.General Settings.External Link Handling.No Action')
])

/** @type {import('vue').ComputedRef<'' | 'openLinkAfterPrompt' | 'doNothing'>} */
const externalLinkHandling = computed(() => store.getters.getExternalLinkHandling)

/**
 * @param {'' | 'openLinkAfterPrompt' | 'doNothing'} value
 */
function updateExternalLinkHandling(value) {
  store.dispatch('updateExternalLinkHandling', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const saveVideoHistoryWithLastViewedPlaylist = computed(() => store.getters.getSaveVideoHistoryWithLastViewedPlaylist)

/**
 * @param {boolean} value
 */
function updateSaveVideoHistoryWithLastViewedPlaylist(value) {
  store.dispatch('updateSaveVideoHistoryWithLastViewedPlaylist', value)
}

const WATCHED_PROGRESS_SAVING_MODE_VALUES = ['auto', 'semi-auto', 'never']
const watchedProgressSavingModeNames = computed(() => [
  t('Settings.Privacy Settings.Watched Progress Saving Mode.Modes.Auto'),
  t('Settings.Privacy Settings.Watched Progress Saving Mode.Modes.Semi-auto'),
  t('Settings.Privacy Settings.Watched Progress Saving Mode.Modes.Never')
])

/** @type {import('vue').ComputedRef<'auto' | 'semi-auto' | 'never'>} */
const watchedProgressSavingMode = computed(() => store.getters.getWatchedProgressSavingMode)

/**
 * @param {'auto' | 'semi-auto' | 'never'} value
 */
function updateWatchedProgressSavingMode(value) {
  store.dispatch('updateWatchedProgressSavingMode', value)
}

/** @type {import('vue').ComputedRef<number>} */
const watchedPercentageThreshold = computed(() => store.getters.getWatchedPercentageThreshold)

/**
 * @param {number} value
 */
function updateWatchedPercentageThreshold(value) {
  store.dispatch('updateWatchedPercentageThreshold', value)
}

</script>

<style scoped>
.privacyExternalLinkHandling {
  display: flex;
  justify-content: center;
}

.privacyExternalLinkSelect.containsTooltip {
  --privacy-select-indicator-space: 40px;

  box-sizing: border-box;
  inline-size: min(100%, 330px);
  margin-inline-end: 0;
}

.privacyExternalLinkSelect:has(
  :deep(.syncedSettingIndicator),
  :deep(.changedSettingIndicator)
) {
  --privacy-select-indicator-space: 70px;
}

.privacyExternalLinkSelect :deep(.select-text),
.privacyExternalLinkSelect :deep(.nativeSelect),
.privacyExternalLinkSelect :deep(.select-bar) {
  inline-size: calc(100% - var(--privacy-select-indicator-space));
}

.privacyExternalLinkSelect :deep(.iconSelect) {
  inset-inline-end: calc(var(--privacy-select-indicator-space) + 10px);
}

.privacyExternalLinkSelect :deep(.selectIndicators) {
  inset-inline: auto 8px;
}

.privacyExternalLinkSelect :deep(.changedSettingIndicatorPlaceholder) {
  display: none;
}

</style>
