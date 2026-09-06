<template>
  <div
    class="settingsCategory storageSettings"
    :aria-busy="isRefreshing || cleanupInProgress"
  >
    <FtSettingsSection
      :title="t('Settings.Storage Settings.Storage')"
      hide-title
    >
      <figure
        v-if="SUPPORTS_STORAGE_USAGE"
        class="storageBreakdown"
        :aria-label="chartAriaLabel"
      >
        <div class="storageDonut">
          <svg
            class="storageDonutChart"
            viewBox="0 0 42 42"
          >
            <circle
              class="storageDonutTrack"
              cx="21"
              cy="21"
              r="15.9155"
              pathLength="100"
            />
            <circle
              v-for="item in chartSegments"
              :key="item.key"
              class="storageDonutSegment"
              :data-chart-segment="item.key"
              cx="21"
              cy="21"
              r="15.9155"
              pathLength="100"
              :stroke="item.color"
              :stroke-dasharray="`${item.portion} ${100 - item.portion}`"
              :stroke-dashoffset="-item.start"
              role="img"
              tabindex="0"
              :aria-label="item.tooltip"
              @mouseenter="hoveredChartKey = item.key"
              @mouseleave="hoveredChartKey = null"
              @focus="focusedChartKey = item.key"
              @blur="focusedChartKey = null"
            />
          </svg>
          <div class="storageDonutCenter">
            <span>{{ t('Settings.Storage Settings.Shown Total') }}</span>
            <strong>{{ chartTotalText }}</strong>
          </div>
          <div
            v-if="activeChartItem"
            class="storageDonutTooltip"
            role="tooltip"
          >
            <strong>{{ activeChartItem.label }}</strong>
            <span>{{ activeChartItem.details }}</span>
          </div>
        </div>
        <figcaption class="storageBreakdownDetails">
          <ul>
            <li
              v-for="item in chartItems"
              :key="item.key"
            >
              <span
                class="storageLegendMarker"
                :style="{ backgroundColor: item.color }"
                aria-hidden="true"
              />
              <span class="storageLegendLabel">
                <span>{{ item.label }}</span>
                <FtTooltip
                  v-if="item.hint"
                  position="top"
                  :tooltip="item.hint"
                />
              </span>
              <strong>{{ item.size }}</strong>
              <span class="storageLegendPercentage">{{ item.percentage }}</span>
            </li>
          </ul>
        </figcaption>
      </figure>
    </FtSettingsSection>

    <FtSettingsSection
      v-if="USING_ELECTRON"
      :title="t('Settings.Download Settings.Download Settings')"
    >
      <StorageItem
        :title="t('Settings.Storage Settings.Downloaded Media')"
        :size="downloadedMediaText"
        :description="t('Settings.Storage Settings.Downloaded Media Description')"
        :location="downloadFolderLocation"
        location-is-directory
      >
        <FtButton
          :label="t('Downloads.Open Downloads')"
          :icon="['fas', 'download']"
          @click="openDownloads"
        />
      </StorageItem>
      <StorageItem
        :title="t('Settings.Storage Settings.Download History Records')"
        :size="sizeText('downloadRecords')"
        :description="t('Settings.Storage Settings.Download History Records Description', {
          count: finishedDownloads.length
        }, finishedDownloads.length)"
        location="downloads.json"
      >
        <FtButton
          :label="t('Settings.Storage Settings.Clear Download History Records')"
          theme="destructive"
          :icon="['fas', 'trash']"
          :disabled="finishedDownloads.length === 0"
          @click="requestCleanup('download-records')"
        />
      </StorageItem>
    </FtSettingsSection>

    <FtSettingsSection :title="t('Settings.Storage Settings.Replaceable Caches')">
      <StorageItem
        :title="t('Settings.Storage Settings.Subscription Feed Cache')"
        :size="storedDataSizeText('subscriptionCache')"
        :description="t('Settings.Storage Settings.Subscription Feed Cache Description')"
        :location="storedDataLocation('subscription-cache.db')"
      >
        <FtButton
          :label="t('Settings.Storage Settings.Clear Subscription Feed Cache')"
          theme="destructive"
          :icon="['fas', 'trash']"
          :disabled="isUsageEmpty('subscriptionCache')"
          @click="requestCleanup('subscription-cache')"
        />
      </StorageItem>
      <StorageItem
        :title="t('Settings.Storage Settings.Session Search Cache')"
        :size="t('Settings.Storage Settings.In Memory')"
        :description="t('Settings.Storage Settings.Session Search Cache Description', {
          count: sessionSearchCount
        }, sessionSearchCount)"
      >
        <FtButton
          :label="t('Settings.Storage Settings.Clear Session Search Cache')"
          theme="destructive"
          :icon="['fas', 'trash']"
          :disabled="sessionSearchCount === 0"
          @click="requestCleanup('session-search')"
        />
      </StorageItem>
      <StorageItem
        v-if="IS_CAPACITOR"
        :title="t('Settings.Storage Settings.Browser Caches')"
        :size="sizeText('androidCache')"
        :description="t('Settings.Storage Settings.Browser Caches Hint')"
      >
        <FtButton
          :label="t('Settings.Storage Settings.Clear Cache')"
          theme="destructive"
          :icon="['fas', 'trash']"
          :disabled="isUsageEmpty('androidCache')"
          @click="requestCleanup('android-cache')"
        />
      </StorageItem>
      <template v-if="USING_ELECTRON">
        <StorageItem
          :title="t('Settings.Storage Settings.HTTP Cache')"
          :size="sizeText('httpCache')"
          :description="t('Settings.Storage Settings.HTTP Cache Description')"
          :location="t('Settings.Storage Settings.Managed By Electron')"
        >
          <FtButton
            :label="t('Settings.Storage Settings.Clear HTTP Cache')"
            theme="destructive"
            :icon="['fas', 'trash']"
            :disabled="isUsageEmpty('httpCache')"
            @click="requestCleanup('http-cache')"
          />
        </StorageItem>
        <StorageItem
          :title="t('Settings.Storage Settings.Tab Image Cache')"
          :size="sizeText('tabPreviews')"
          :description="t('Settings.Storage Settings.Tab Image Cache Description')"
          location="tab-previews/"
          location-is-directory
        >
          <FtButton
            :label="t('Settings.Storage Settings.Clear Tab Image Cache')"
            theme="destructive"
            :icon="['fas', 'trash']"
            :disabled="isUsageEmpty('tabPreviews')"
            @click="requestCleanup('tab-previews')"
          />
        </StorageItem>
        <StorageItem
          :title="t('Settings.Storage Settings.Playback Caches')"
          :size="playbackCachesText"
          :description="t('Settings.Storage Settings.Playback Caches Description')"
          location="yt-dlp-playback-cache.json, player_cache/"
        >
          <FtSlider
            :label="t('Settings.Storage Settings.Playback URL Cache Entry Size')"
            :tooltip="t('Settings.Storage Settings.Playback URL Cache Entry Size Tooltip')"
            :default-value="ytDlpPlaybackCacheMaxEntrySize"
            setting-key="ytDlpPlaybackCacheMaxEntrySize"
            :min-value="MIN_YT_DLP_PLAYBACK_CACHE_MAX_ENTRY_SIZE_MB"
            :max-value="MAX_YT_DLP_PLAYBACK_CACHE_MAX_ENTRY_SIZE_MB"
            :step="1"
            value-extension=" MB"
            @change="updateYtDlpPlaybackCacheMaxEntrySize"
          />
          <FtButton
            :label="t('Settings.Storage Settings.Clear Playback Caches')"
            theme="destructive"
            :icon="['fas', 'trash']"
            :disabled="isUsageEmpty('ytDlpPlayback', 'playerCache')"
            @click="requestCleanup('playback-caches')"
          />
        </StorageItem>
      </template>
    </FtSettingsSection>

    <FtSettingsSection :title="t('Settings.Storage Settings.History Data')">
      <StorageItem
        v-if="USING_ELECTRON"
        :title="t('Settings.Privacy Settings.Cache Video Metadata')"
        :size="sizeText('videoMetadata')"
        :description="t('Settings.Storage Settings.Video Metadata Description')"
        location="video-metadata-cache.db"
      >
        <FtToggleSwitch
          :label="t('Settings.Privacy Settings.Cache Video Metadata')"
          :tooltip="t('Settings.Privacy Settings.Cache Video Metadata Tooltip')"
          compact
          :default-value="enableVideoMetadataCache"
          setting-key="enableVideoMetadataCache"
          @change="updateEnableVideoMetadataCache"
        />
        <FtButton
          :label="t('Settings.Privacy Settings.Clear Video Metadata Cache')"
          theme="destructive"
          :icon="['fas', 'trash']"
          :disabled="isUsageEmpty('videoMetadata')"
          @click="requestCleanup('video-metadata')"
        />
      </StorageItem>
      <StorageItem
        :title="t('Settings.Storage Settings.Watch History')"
        :size="storedDataSizeText('history', 'watchStats')"
        :description="t('Settings.Storage Settings.Watch History Description')"
        :location="storedDataLocation('history.db, watch-stats.db')"
      >
        <FtInput
          :placeholder="t('Settings.Privacy Settings.Automatic History Retention Placeholder')"
          :label="t('Settings.Privacy Settings.Automatic History Retention')"
          input-type="number"
          :value="historyRetentionDaysInput"
          setting-key="historyRetentionDays"
          :show-label="true"
          :allow-action-button-when-empty="true"
          :force-action-button-icon-name="['fas', 'check']"
          :tooltip="t('Settings.Privacy Settings.Automatic History Retention Tooltip')"
          :disabled="!rememberHistory"
          @input="historyRetentionDaysInput = $event"
          @click="saveHistoryRetention"
        />
        <FtButton
          :label="t('Settings.Privacy Settings.Remove Watch History')"
          theme="destructive"
          :icon="['fas', 'trash']"
          @click="requestCleanup('watch-history')"
        />
        <FtButton
          :label="t('Settings.Storage Settings.Clear Watch Statistics')"
          theme="destructive"
          :icon="['fas', 'trash']"
          @click="requestCleanup('watch-statistics')"
        />
      </StorageItem>
      <StorageItem
        :title="t('Settings.Storage Settings.Search History')"
        :size="storedDataSizeText('searchHistory')"
        :description="t('Settings.Storage Settings.Search History Description')"
        :location="storedDataLocation('search-history.db')"
      >
        <FtButton
          :label="t('Settings.Storage Settings.Delete Search History')"
          theme="destructive"
          :icon="['fas', 'trash']"
          @click="requestCleanup('search-history')"
        />
      </StorageItem>
    </FtSettingsSection>

    <FtSettingsSection :title="t('Settings.Storage Settings.Other User Data')">
      <StorageItem
        :title="t('Settings.Storage Settings.Subscriptions And Profiles')"
        :size="storedDataSizeText('profiles')"
        :description="t('Settings.Storage Settings.Subscriptions And Profiles Description')"
        :location="storedDataLocation('profiles.db')"
      >
        <FtButton
          :label="t('Settings.Privacy Settings.Remove All Subscriptions / Profiles')"
          theme="destructive"
          :icon="['fas', 'trash']"
          @click="requestCleanup('subscriptions-profiles')"
        />
      </StorageItem>
      <StorageItem
        :title="t('Playlists')"
        :size="storedDataSizeText('playlists')"
        :description="t('Settings.Storage Settings.Playlists Description')"
        :location="storedDataLocation('playlists.db')"
      >
        <FtButton
          :label="t('Settings.Privacy Settings.Remove All Playlists')"
          theme="destructive"
          :icon="['fas', 'trash']"
          @click="requestCleanup('playlists')"
        />
      </StorageItem>
      <StorageItem
        :title="t('Settings.Storage Settings.Settings And Sessions')"
        :size="storedDataSizeText('settings', 'tabSessions', 'liveReminders')"
        :description="t('Settings.Storage Settings.Settings And Sessions Description')"
        :location="storedDataLocation('settings.db, tab-session.db, live-reminders.db')"
      >
        <FtButton
          v-if="USING_ELECTRON"
          :label="t('Settings.Data Settings.Open Profile Directory')"
          :icon="['fas', 'folder-open']"
          @click="openProfileDirectory"
        />
      </StorageItem>
    </FtSettingsSection>

    <FtPrompt
      v-if="pendingAction !== null"
      autosize
      :label="cleanupPrompt.label"
      :extra-labels="cleanupPrompt.extraLabels"
      :option-names="[cleanupPrompt.confirm, t('Cancel')]"
      :option-values="['confirm', 'cancel']"
      is-first-option-destructive
      @click="handleCleanupPrompt"
    />
  </div>
</template>

<script setup>
import { ytDlp } from '../../helpers/ytDlp'
import { isAppHidden } from '../../helpers/appVisibility.js'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtPrompt from '../FtPrompt/FtPrompt.vue'
import FtSettingsSection from '../FtSettingsSection/FtSettingsSection.vue'
import FtSlider from '../FtSlider/FtSlider.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'
import FtTooltip from '../FtTooltip/FtTooltip.vue'
import StorageItem from './StorageItem.vue'

import { MAIN_PROFILE_ID } from '../../../constants'
import { compactAllDatastores } from '../../../datastores/handlers/index'
import {
  MAX_YT_DLP_PLAYBACK_CACHE_MAX_ENTRY_SIZE_MB,
  MIN_YT_DLP_PLAYBACK_CACHE_MAX_ENTRY_SIZE_MB,
  normalizeYtDlpPlaybackCacheMaxEntrySize
} from '../../../ytDlpPlaybackCacheSettings'
import { clearAndroidCache, getAndroidStorageUsage } from '../../helpers/androidStorage'
import { formatBytes } from '../../helpers/fileSize'
import { invalidateAllYtDlpPlaybackSources } from '../../helpers/player/ytDlpPlayback'
import { showToast } from '../../helpers/utils'
import store from '../../store/index'

const { locale, t } = useI18n()
const USING_ELECTRON = !!process.env.IS_ELECTRON
const IS_CAPACITOR = !!process.env.IS_CAPACITOR
const SUPPORTS_STORAGE_USAGE = USING_ELECTRON || IS_CAPACITOR
const usage = ref({})
const downloads = ref([])
const hoveredChartKey = ref(null)
const focusedChartKey = ref(null)
const isRefreshing = ref(false)
const cleanupInProgress = ref(false)
const hasLoadedUsage = ref(false)
const pendingAction = ref(null)
let removeVideoMetadataCacheClearedListener = null

const finishedDownloads = computed(() => downloads.value.filter(download => (
  !['downloading', 'processing'].includes(download.status)
)))
const downloadedMediaBytes = computed(() => downloads.value.reduce((total, download) => (
  total + (download.sizeBytes ?? 0)
), 0))
const downloadedMediaText = computed(() => hasLoadedUsage.value
  ? formatBytes(downloadedMediaBytes.value)
  : t('Settings.Storage Settings.Calculating'))
const sessionSearchCount = computed(() => store.getters.getSessionSearchHistory.length)
const ytDlpPlaybackCacheMaxEntrySize = computed(() => (
  normalizeYtDlpPlaybackCacheMaxEntrySize(store.getters.getYtDlpPlaybackCacheMaxEntrySize)
))
const downloadFolderLocation = computed(() => (
  store.getters.getYtDlpDownloadFolderPath || t('Settings.Storage Settings.Selected Download Folders')
))

function updateYtDlpPlaybackCacheMaxEntrySize(value) {
  return store.dispatch('updateYtDlpPlaybackCacheMaxEntrySize', value)
}

function sumSizeText(...keys) {
  if (!hasLoadedUsage.value) return t('Settings.Storage Settings.Calculating')
  if (keys.some(key => !Number.isFinite(usage.value[key]))) {
    return t('Settings.Storage Settings.Not Available')
  }
  return formatBytes(keys.reduce((total, key) => total + usage.value[key], 0))
}

function sizeText(key) {
  return sumSizeText(key)
}

function storedDataSizeText(...keys) {
  return IS_CAPACITOR
    ? t('Settings.Storage Settings.Included In App Data')
    : sumSizeText(...keys)
}

function storedDataLocation(electronLocation) {
  return USING_ELECTRON ? electronLocation : ''
}

function isUsageEmpty(...keys) {
  return hasLoadedUsage.value &&
    keys.every(key => Number.isFinite(usage.value[key])) &&
    keys.reduce((total, key) => total + usage.value[key], 0) === 0
}

const playbackCachesText = computed(() => sumSizeText('ytDlpPlayback', 'playerCache'))
const chartCategories = computed(() => IS_CAPACITOR
  ? [
      {
        key: 'browser-caches',
        label: t('Settings.Storage Settings.Browser Caches'),
        hint: t('Settings.Storage Settings.Browser Caches Hint'),
        bytes: Number.isFinite(usage.value.androidCache) ? usage.value.androidCache : 0,
        exact: Number.isFinite(usage.value.androidCache),
        color: 'var(--storage-chart-browser-caches)'
      },
      {
        key: 'app-data',
        label: t('Settings.Storage Settings.Stored App Data'),
        bytes: Number.isFinite(usage.value.androidAppData) ? usage.value.androidAppData : 0,
        exact: Number.isFinite(usage.value.androidAppData),
        color: 'var(--storage-chart-app-data)'
      }
    ]
  : [
      {
        key: 'downloads',
        label: t('Settings.Storage Settings.Downloaded Media'),
        bytes: downloadedMediaBytes.value,
        exact: true,
        color: 'var(--storage-chart-downloads)'
      },
      {
        key: 'app-caches',
        label: t('Settings.Storage Settings.Application Caches'),
        ...chartUsage(['subscriptionCache', 'tabPreviews', 'ytDlpPlayback', 'playerCache']),
        color: 'var(--storage-chart-app-caches)'
      },
      {
        key: 'browser-caches',
        label: t('Settings.Storage Settings.Browser Caches'),
        hint: t('Settings.Storage Settings.Browser Caches Hint'),
        ...chartUsage(['httpCache', 'browserCacheData']),
        color: 'var(--storage-chart-browser-caches)'
      },
      {
        key: 'app-data',
        label: t('Settings.Storage Settings.Stored App Data'),
        ...chartUsage([
          'downloadRecords',
          'videoMetadata',
          'searchHistory',
          'history',
          'watchStats',
          'playlists',
          'profiles',
          'settings',
          'tabSessions',
          'liveReminders'
        ]),
        color: 'var(--storage-chart-app-data)'
      },
      {
        key: 'browser-runtime',
        label: t('Settings.Storage Settings.Browser Runtime Data'),
        hint: t('Settings.Storage Settings.Browser Runtime Data Hint'),
        ...chartUsage(['browserRuntimeData']),
        color: 'var(--storage-chart-browser-runtime)'
      },
      {
        key: 'other-profile-files',
        label: t('Settings.Storage Settings.Other Profile Files'),
        hint: t('Settings.Storage Settings.Other Profile Files Hint'),
        ...chartUsage(['otherProfileData']),
        color: 'var(--storage-chart-profile-other)'
      }
    ])
const chartTotalBytes = computed(() => chartCategories.value.reduce((total, item) => (
  total + item.bytes
), 0))
const chartItems = computed(() => chartCategories.value.map(item => {
  const size = !hasLoadedUsage.value
    ? t('Settings.Storage Settings.Calculating')
    : item.exact
      ? formatBytes(item.bytes)
      : item.bytes > 0
        ? t('Settings.Storage Settings.At Least', { size: formatBytes(item.bytes) })
        : t('Settings.Storage Settings.Not Available')
  const percentage = item.bytes > 0 && chartTotalBytes.value > 0
    ? formatChartPercentage(item.bytes, chartTotalBytes.value)
    : ''
  return {
    ...item,
    size,
    percentage,
    details: [size, percentage].filter(Boolean).join(' · '),
    tooltip: [item.label, size, percentage].filter(Boolean).join(', ')
  }
}).filter(item => !hasLoadedUsage.value || item.bytes > 0 || !item.exact))
const chartSegments = computed(() => {
  let start = 0
  return chartItems.value
    .filter(item => item.bytes > 0)
    .map(item => {
      const portion = item.bytes / chartTotalBytes.value * 100
      const segment = { ...item, portion, start }
      start += portion
      return segment
    })
})
const activeChartItem = computed(() => chartItems.value.find(item => (
  item.key === (hoveredChartKey.value ?? focusedChartKey.value)
)) ?? null)
const chartTotalIsExact = computed(() => chartCategories.value.every(item => item.exact))
const chartTotalText = computed(() => hasLoadedUsage.value
  ? chartTotalIsExact.value
    ? formatBytes(chartTotalBytes.value)
    : t('Settings.Storage Settings.At Least', { size: formatBytes(chartTotalBytes.value) })
  : t('Settings.Storage Settings.Calculating'))
const chartAriaLabel = computed(() => {
  if (!hasLoadedUsage.value) {
    return `${t('Settings.Storage Settings.Storage Breakdown')}: ${t('Settings.Storage Settings.Calculating')}`
  }
  const values = chartItems.value.map(item => (
    `${item.label}: ${item.size}${item.percentage ? `, ${item.percentage}` : ''}`
  ))
  return `${t('Settings.Storage Settings.Storage Breakdown')}. ${values.join('; ')}`
})

function chartUsage(keys) {
  return {
    bytes: keys.reduce((total, key) => (
      total + (Number.isFinite(usage.value[key]) ? usage.value[key] : 0)
    ), 0),
    exact: keys.every(key => Number.isFinite(usage.value[key]))
  }
}

function formatChartPercentage(bytes, total) {
  if (bytes === 0) return '0%'
  const format = new Intl.NumberFormat(locale.value, {
    style: 'percent',
    maximumFractionDigits: 1
  })
  const share = bytes / total
  return share < 0.001 ? `<${format.format(0.001)}` : format.format(share)
}

/** @type {import('vue').ComputedRef<boolean>} */
const enableVideoMetadataCache = computed(() => store.getters.getEnableVideoMetadataCache)
/** @type {import('vue').ComputedRef<boolean>} */
const rememberHistory = computed(() => store.getters.getRememberHistory)
/** @type {import('vue').ComputedRef<string>} */
const historyRetentionDays = computed(() => store.getters.getHistoryRetentionDays)
const historyRetentionDaysInput = ref(historyRetentionDays.value)
const profileList = computed(() => store.getters.getProfileList)

watch(historyRetentionDays, value => {
  historyRetentionDaysInput.value = value
})

const cleanupPrompt = computed(() => {
  const prompts = {
    'download-records': {
      label: t('Settings.Storage Settings.Clear Download History Confirmation'),
      extraLabels: [t('Settings.Storage Settings.Download Files Stay On Disk')],
      confirm: t('Settings.Storage Settings.Clear Records')
    },
    'subscription-cache': {
      label: t('Settings.Storage Settings.Clear Subscription Feed Cache Confirmation'),
      extraLabels: [t('Settings.Storage Settings.Subscription Feed Cache Effect')],
      confirm: t('Settings.Storage Settings.Clear Cache')
    },
    'session-search': {
      label: t('Settings.Storage Settings.Clear Session Search Cache Confirmation'),
      extraLabels: [t('Settings.Storage Settings.Session Search Cache Effect')],
      confirm: t('Settings.Storage Settings.Clear Cache')
    },
    'http-cache': {
      label: t('Settings.Storage Settings.Clear HTTP Cache Confirmation'),
      extraLabels: [t('Settings.Storage Settings.HTTP Cache Effect')],
      confirm: t('Settings.Storage Settings.Clear Cache')
    },
    'android-cache': {
      label: t('Settings.Storage Settings.Clear Android Cache Confirmation'),
      extraLabels: [t('Settings.Storage Settings.HTTP Cache Effect')],
      confirm: t('Settings.Storage Settings.Clear Cache')
    },
    'tab-previews': {
      label: t('Settings.Storage Settings.Clear Tab Image Cache Confirmation'),
      extraLabels: [t('Settings.Storage Settings.Tab Image Cache Effect')],
      confirm: t('Settings.Storage Settings.Clear Cache')
    },
    'playback-caches': {
      label: t('Settings.Storage Settings.Clear Playback Caches Confirmation'),
      extraLabels: [t('Settings.Storage Settings.Playback Caches Effect')],
      confirm: t('Settings.Storage Settings.Clear Cache')
    },
    'video-metadata': {
      label: t('Settings.Privacy Settings.Are you sure you want to clear the video metadata cache?'),
      extraLabels: [t('Settings.Storage Settings.Video Metadata Effect')],
      confirm: t('Yes, Delete')
    },
    'watch-history': {
      label: t('Settings.Privacy Settings.Are you sure you want to remove your entire watch history?'),
      extraLabels: [t('Settings.Storage Settings.Watch History Effect')],
      confirm: t('Yes, Delete')
    },
    'watch-statistics': {
      label: t('Settings.Storage Settings.Clear Watch Statistics Confirmation'),
      extraLabels: [t('Settings.Storage Settings.Watch Statistics Effect')],
      confirm: t('Yes, Delete')
    },
    'search-history': {
      label: t('Settings.Storage Settings.Delete Search History Confirmation'),
      extraLabels: [t('Settings.Storage Settings.Search History Effect')],
      confirm: t('Yes, Delete')
    },
    'subscriptions-profiles': {
      label: t('Settings.Privacy Settings["Are you sure you want to remove all subscriptions and profiles?  This cannot be undone."]'),
      extraLabels: [t('Settings.Storage Settings.Subscriptions And Profiles Effect')],
      confirm: t('Yes, Delete')
    },
    playlists: {
      label: t('Settings.Privacy Settings.Are you sure you want to remove all your playlists?'),
      extraLabels: [t('Settings.Storage Settings.Playlists Effect')],
      confirm: t('Yes, Delete')
    }
  }
  return prompts[pendingAction.value] ?? { label: '', extraLabels: [], confirm: t('Yes, Delete') }
})

async function refreshUsage() {
  if (isRefreshing.value) return
  isRefreshing.value = true
  try {
    if (USING_ELECTRON) {
      const [nextUsage, nextDownloads] = await Promise.all([
        window.ftElectron.storage.getUsage(),
        ytDlp.ytDlpListDownloads()
      ])
      usage.value = nextUsage
      downloads.value = nextDownloads
    } else if (IS_CAPACITOR) {
      usage.value = await getAndroidStorageUsage()
    }
  } catch (error) {
    console.error('Failed to calculate storage usage', error)
    showToast({
      message: t('Settings.Storage Settings.Failed To Read Storage'),
      icon: ['fas', 'circle-exclamation']
    })
  } finally {
    hasLoadedUsage.value = true
    isRefreshing.value = false
  }
}

function requestCleanup(action) {
  if (cleanupInProgress.value) return
  pendingAction.value = action
}

async function compactAndRefresh() {
  try {
    if (USING_ELECTRON) {
      await requireCleanupSuccess(window.ftElectron.storage.compactDatabases())
    } else if (IS_CAPACITOR) {
      const results = await compactAllDatastores()
      await requireCleanupSuccess(results.every(result => result.status === 'fulfilled'))
    }
  } finally {
    await refreshUsage()
  }
}

async function requireCleanupSuccess(cleanup) {
  if (!await cleanup) throw new Error('Cleanup request was rejected')
}

async function performCleanup(action) {
  switch (action) {
    case 'download-records': {
      const ids = finishedDownloads.value.map(download => download.id)
      await requireCleanupSuccess(ytDlp.ytDlpClearDownloads(ids))
      ids.forEach(id => store.commit('removeYtDlpDownload', id))
      break
    }
    case 'subscription-cache':
      await requireCleanupSuccess(store.dispatch('clearSubscriptionsCache'))
      break
    case 'session-search':
      await store.dispatch('clearSessionSearchHistory')
      break
    case 'http-cache':
      await requireCleanupSuccess(window.ftElectron.storage.clear('http-cache'))
      break
    case 'android-cache':
      await requireCleanupSuccess(clearAndroidCache())
      break
    case 'tab-previews':
      await requireCleanupSuccess(window.ftElectron.storage.clear('tab-previews'))
      break
    case 'playback-caches':
      await Promise.all([
        requireCleanupSuccess(invalidateAllYtDlpPlaybackSources()),
        requireCleanupSuccess(window.ftElectron.storage.clear('player-cache'))
      ])
      break
    case 'video-metadata':
      await requireCleanupSuccess(window.ftElectron.videoMetadataCache.clear())
      break
    case 'watch-history':
      await requireCleanupSuccess(store.dispatch('removeAllHistory'))
      break
    case 'watch-statistics':
      await requireCleanupSuccess(store.dispatch('clearWatchStats'))
      break
    case 'search-history':
      await requireCleanupSuccess(store.dispatch('removeAllSearchHistoryEntries'))
      break
    case 'subscriptions-profiles':
      await removeSubscriptionsAndProfiles()
      break
    case 'playlists':
      await requireCleanupSuccess(store.dispatch('removeAllPlaylists'))
      await store.dispatch('updateQuickBookmarkTargetPlaylistId', 'favorites')
      break
  }
}

async function runCleanup(action) {
  try {
    await performCleanup(action)
  } finally {
    await compactAndRefresh()
  }
  showToast({
    message: t('Settings.Storage Settings.Cleanup Complete'),
    icon: ['fas', 'trash']
  })
}

async function handleCleanupPrompt(option) {
  const action = pendingAction.value
  pendingAction.value = null
  if (option !== 'confirm' || action === null) return

  cleanupInProgress.value = true
  try {
    await runCleanup(action)
  } catch (error) {
    console.error(`Failed to clean storage category ${action}`, error)
    showToast({
      message: action === 'video-metadata'
        ? t('Settings.Privacy Settings.Failed to clear video metadata cache')
        : t('Settings.Storage Settings.Cleanup Failed'),
      icon: ['fas', 'circle-exclamation']
    })
  } finally {
    cleanupInProgress.value = false
  }
}

async function removeSubscriptionsAndProfiles() {
  await store.dispatch('updateActiveProfile', MAIN_PROFILE_ID)
  const cleanupResults = await Promise.all(profileList.value.map(profile => {
    if (profile._id === MAIN_PROFILE_ID) {
      return store.dispatch('updateProfile', { ...profile, subscriptions: [] })
    }
    return store.dispatch('removeProfile', profile._id)
  }))
  await requireCleanupSuccess(cleanupResults.every(Boolean))
  await requireCleanupSuccess(store.dispatch('clearSubscriptionsCache'))
}

function parseDays(value, allowEmpty = false) {
  if (allowEmpty && value === '') return ''
  const days = Number(value)
  return Number.isInteger(days) && days > 0 ? String(days) : null
}

async function saveHistoryRetention() {
  const days = parseDays(historyRetentionDaysInput.value, true)
  if (days === null) {
    showToast({
      message: t('Settings.Privacy Settings.Invalid History Retention Days'),
      icon: ['fas', 'circle-exclamation']
    })
    return
  }

  historyRetentionDaysInput.value = days
  await store.dispatch('updateHistoryRetentionDays', days)
  if (days !== '') await store.dispatch('removeHistoryOlderThan', days)
  await compactAndRefresh()
  showToast({
    message: t('Settings.Privacy Settings.History Retention Saved'),
    icon: ['fas', 'check']
  })
}

function updateEnableVideoMetadataCache(value) {
  store.dispatch('updateEnableVideoMetadataCache', value)
}

function openDownloads() {
  store.dispatch('showDownloadsFromSettings')
}

function openProfileDirectory() {
  window.ftElectron.openProfileDirectory()
}

function refreshWhenVisible() {
  if (!isAppHidden()) refreshUsage()
}

onMounted(async () => {
  if (USING_ELECTRON) {
    removeVideoMetadataCacheClearedListener = window.ftElectron.videoMetadataCache.onCleared(() => {
      if (!cleanupInProgress.value) refreshUsage()
    })
  }
  if (SUPPORTS_STORAGE_USAGE) {
    document.addEventListener('visibilitychange', refreshWhenVisible)
  }
  await refreshUsage()
})

onBeforeUnmount(() => {
  removeVideoMetadataCacheClearedListener?.()
  document.removeEventListener('visibilitychange', refreshWhenVisible)
})
</script>

<style scoped src="./StorageSettings.css" />
