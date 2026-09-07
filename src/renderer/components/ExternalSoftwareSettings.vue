<template>
  <FtSettingsSection
    :title="t('Settings.External Software Settings.External Software Settings')"
  >
    <div class="externalSoftwareTools">
      <section
        class="externalSoftwareTool"
        aria-labelledby="yt-dlp-settings-heading"
      >
        <h4
          id="yt-dlp-settings-heading"
          class="externalSoftwareToolTitle"
        >
          <FtIcon :icon="['fas', 'download']" />
          {{ YT_DLP_NAME }}
        </h4>
        <div class="externalSoftwareToolControls">
          <FtSelect
            v-if="!IS_CAPACITOR"
            class="externalSoftwareSelect"
            :placeholder="t('Settings.External Software Settings.yt-dlp Source')"
            :value="ytDlpSource"
            :select-names="sourceNames"
            :select-values="SOURCE_VALUES"
            :tooltip="t('Tooltips.External Software Settings.yt-dlp Source')"
            @change="updateYtDlpSource"
          />
          <FtSelect
            v-if="ytDlpSource === 'managed'"
            class="externalSoftwareSelect"
            :placeholder="t('Settings.External Software Settings.yt-dlp Channel')"
            :value="ytDlpChannel"
            :select-names="CHANNEL_NAMES"
            :select-values="CHANNEL_VALUES"
            :tooltip="t('Tooltips.External Software Settings.yt-dlp Channel')"
            :icon="['fas', 'download']"
            @change="updateYtDlpChannel"
          />
          <FtInput
            v-else
            class="externalSoftwarePath"
            :placeholder="t('Settings.External Software Settings.yt-dlp Executable Path')"
            :show-action-button="true"
            :allow-action-button-when-empty="true"
            :force-action-button-icon-name="['fas', 'folder-open']"
            :show-label="true"
            :value="ytDlpPath"
            :tooltip="t('Tooltips.External Software Settings.yt-dlp Executable Path')"
            @input="updateYtDlpPath"
            @click="chooseExecutablePath('yt-dlp')"
          />
        </div>
        <div class="externalSoftwareToolStatus">
          <p
            v-if="ytDlpInfo === null"
            class="ytDlpStatus"
          >
            {{ t('Settings.External Software Settings.Checking yt-dlp') }}
          </p>
          <p
            v-else-if="!ytDlpInfo.available"
            class="ytDlpStatus ytDlpWarning"
          >
            <FtIcon :icon="['fas', 'circle-exclamation']" />
            {{ ytDlpSource === 'managed'
              ? t('Settings.External Software Settings.Managed Not Downloaded')
              : t('Settings.External Software Settings.System yt-dlp Missing Warning') }}
          </p>
          <p
            v-else
            class="ytDlpStatus"
          >
            {{ t('Settings.External Software Settings.Detected Version Template', { version: ytDlpInfo.version }) }}
          </p>
        </div>
        <FtButton
          v-if="ytDlpSource === 'managed'"
          class="externalSoftwareToolAction"
          :label="ytDlpBinaryDownloadInProgress
            ? t('Settings.External Software Settings.Downloading yt-dlp')
            : (ytDlpInfo === null
              ? t('Settings.External Software Settings.Checking yt-dlp')
              : ytDlpInfo.available
                ? t('Settings.External Software Settings.Update yt-dlp')
                : t('Settings.External Software Settings.Download yt-dlp'))"
          :icon="['fas', 'download']"
          :disabled="ytDlpBinaryDownloadInProgress || ytDlpInfo === null"
          :text-color="null"
          :background-color="null"
          @click="downloadBinary('yt-dlp')"
        />
      </section>

      <section
        class="externalSoftwareTool"
        aria-labelledby="ffmpeg-settings-heading"
      >
        <h4
          id="ffmpeg-settings-heading"
          class="externalSoftwareToolTitle"
        >
          <FtIcon :icon="['fas', 'file-video']" />
          {{ FFMPEG_TOOL_NAME }}
        </h4>
        <div class="externalSoftwareToolControls">
          <FtSelect
            v-if="!IS_CAPACITOR"
            class="externalSoftwareSelect"
            :placeholder="t('Settings.External Software Settings.FFmpeg Source')"
            :value="ytDlpFfmpegSource"
            :select-names="sourceNames"
            :select-values="SOURCE_VALUES"
            :tooltip="t('Tooltips.External Software Settings.FFmpeg Source')"
            @change="updateYtDlpFfmpegSource"
          />
          <FtInput
            v-if="ytDlpFfmpegSource === 'system'"
            class="externalSoftwarePath"
            :placeholder="t('Settings.External Software Settings.FFmpeg Executable Path')"
            :show-action-button="true"
            :allow-action-button-when-empty="true"
            :force-action-button-icon-name="['fas', 'folder-open']"
            :show-label="true"
            :value="ytDlpFfmpegPath"
            :tooltip="t('Tooltips.External Software Settings.FFmpeg Executable Path')"
            @input="updateYtDlpFfmpegPath"
            @click="chooseExecutablePath('ffmpeg')"
          />
        </div>
        <div class="externalSoftwareToolStatus">
          <p
            v-if="ffmpegInfo === null"
            class="ytDlpStatus"
          >
            {{ t('Settings.External Software Settings.Checking FFmpeg') }}
          </p>
          <p
            v-else-if="!ffmpegInfo.available"
            class="ytDlpStatus ytDlpWarning"
          >
            <FtIcon :icon="['fas', 'circle-exclamation']" />
            {{ ytDlpFfmpegSource === 'managed'
              ? t('Settings.External Software Settings.FFmpeg Managed Not Downloaded')
              : t('Settings.External Software Settings.System FFmpeg Missing Warning') }}
          </p>
          <p
            v-else
            class="ytDlpStatus"
          >
            {{ t('Settings.External Software Settings.Detected FFmpeg Version Template', { version: ffmpegInfo.version }) }}
          </p>
          <p
            v-if="ffprobeInfo === null"
            class="ytDlpStatus"
          >
            {{ t('Settings.External Software Settings.Checking FFprobe') }}
          </p>
          <p
            v-else-if="!ffprobeInfo.available"
            class="ytDlpStatus ytDlpWarning"
          >
            <FtIcon :icon="['fas', 'circle-exclamation']" />
            {{ ytDlpFfmpegSource === 'managed'
              ? t('Settings.External Software Settings.FFprobe Managed Not Downloaded')
              : t('Settings.External Software Settings.System FFprobe Missing Warning') }}
          </p>
          <p
            v-else
            class="ytDlpStatus"
          >
            {{ t('Settings.External Software Settings.Detected FFprobe Version Template', { version: ffprobeInfo.version }) }}
          </p>
        </div>
        <FtButton
          v-if="!IS_CAPACITOR && ytDlpFfmpegSource === 'managed'"
          class="externalSoftwareToolAction"
          :label="ffmpegBinaryDownloadInProgress
            ? t('Settings.External Software Settings.Downloading FFmpeg and FFprobe')
            : (ffmpegInfo === null
              ? t('Settings.External Software Settings.Checking FFmpeg')
              : ffmpegToolsAvailable
                ? t('Settings.External Software Settings.Update FFmpeg and FFprobe')
                : t('Settings.External Software Settings.Download FFmpeg and FFprobe'))"
          :icon="['fas', 'download']"
          :disabled="ffmpegBinaryDownloadInProgress || ffmpegInfo === null"
          :text-color="null"
          :background-color="null"
          @click="downloadBinary('ffmpeg')"
        />
      </section>
    </div>

    <div
      v-if="ytDlpSource === 'managed' || ytDlpFfmpegSource === 'managed'"
      class="managedSoftwareControls"
    >
      <FtSelect
        class="externalSoftwareSelect"
        :placeholder="t('Settings.External Software Settings.Managed Tool Updates')"
        :value="externalSoftwareUpdateMode"
        :select-names="updateModeNames"
        :select-values="UPDATE_MODE_VALUES"
        :tooltip="t('Tooltips.External Software Settings.Managed Tool Updates')"
        :icon="['fas', 'sync']"
        @change="updateExternalSoftwareUpdateMode"
      />
    </div>
    <!-- extra wrapper, as the section adds inline padding to direct div children,
      which would offset the fill inside the track -->
    <div v-if="binaryDownloadProgress !== null">
      <div class="binaryProgressBarTrack">
        <div
          class="binaryProgressBarFill"
          :class="{ indeterminate: binaryDownloadProgress.percent === null }"
          :style="{ inlineSize: `${binaryDownloadProgress.percent ?? 100}%` }"
        />
      </div>
    </div>
  </FtSettingsSection>
  <FtSettingsSection
    :title="t('Settings.External Software Settings.Restricted Playback Authentication')"
  >
    <FtFlexBox class="restrictedPlaybackAuthControls settingsFlexStart460px">
      <div class="restrictedPlaybackAuthControl restrictedPlaybackAuthSource">
        <FtSelect
          :placeholder="t('Settings.External Software Settings.Cookie Source')"
          :value="ytDlpPlaybackAuthMode"
          setting-key="ytDlpPlaybackAuthMode"
          :select-names="authenticationModeNames"
          :select-values="AUTHENTICATION_MODE_VALUES"
          :icon="['fas', 'cookie']"
          :tooltip="t('Tooltips.External Software Settings.Cookie Source')"
          @change="updateYtDlpPlaybackAuthMode"
        />
      </div>
      <div
        v-if="ytDlpPlaybackAuthMode !== 'none'"
        class="restrictedPlaybackAuthControl restrictedPlaybackAuthDetail"
      >
        <FtInput
          v-if="ytDlpPlaybackAuthMode === 'file'"
          :placeholder="t('Settings.External Software Settings.Cookie File')"
          :show-action-button="true"
          :allow-action-button-when-empty="true"
          :force-action-button-icon-name="['fas', 'folder-open']"
          :icon="['fas', 'folder-open']"
          :show-label="true"
          :value="ytDlpPlaybackCookiesPath"
          setting-key="ytDlpPlaybackCookiesPath"
          :tooltip="t('Tooltips.External Software Settings.Cookie File')"
          @input="updateYtDlpPlaybackCookiesPath"
          @click="chooseCookiesPath"
        />
        <FtSelect
          v-else
          :placeholder="t('Settings.External Software Settings.Browser for Cookies')"
          :value="ytDlpPlaybackCookiesBrowser"
          setting-key="ytDlpPlaybackCookiesBrowser"
          :select-names="browserNames"
          :select-values="browserValues"
          :disabled="ytDlpInfo === null || !ytDlpInfo.available"
          :tooltip="t('Tooltips.External Software Settings.Browser for Cookies')"
          :icon="['fas', 'globe']"
          @change="updateYtDlpPlaybackCookiesBrowser"
        />
      </div>
    </FtFlexBox>
    <FtFlexBox
      v-if="ytDlpPlaybackAuthMode === 'browser'"
      class="restrictedPlaybackBrowserProfile"
    >
      <FtInput
        :label="t('Settings.External Software Settings.Browser Profile')"
        :placeholder="t('Settings.External Software Settings.Browser Profile Placeholder')"
        :show-action-button="true"
        :allow-action-button-when-empty="true"
        :force-action-button-icon-name="['fas', 'folder-open']"
        :icon="['fas', 'folder-open']"
        :show-label="true"
        :value="ytDlpPlaybackCookiesBrowserProfile"
        setting-key="ytDlpPlaybackCookiesBrowserProfile"
        :tooltip="t('Tooltips.External Software Settings.Browser Profile')"
        @input="updateYtDlpPlaybackCookiesBrowserProfile"
        @click="chooseBrowserProfilePath"
      />
    </FtFlexBox>
    <FtFlexBox>
      <FtToggleSwitch
        :label="t('Settings.External Software Settings.Always Use Cookies')"
        :default-value="ytDlpPlaybackAlwaysUseCookies"
        setting-key="ytDlpPlaybackAlwaysUseCookies"
        :tooltip="t('Tooltips.External Software Settings.Always Use Cookies')"
        compact
        @change="updateYtDlpPlaybackAlwaysUseCookies"
      />
      <FtToggleSwitch
        :label="t('Settings.External Software Settings.Use cookies for subtitles')"
        :default-value="ytDlpPlaybackAlwaysUseCookies || ytDlpSubtitleUseCookies"
        :disabled="ytDlpPlaybackAlwaysUseCookies"
        setting-key="ytDlpSubtitleUseCookies"
        :tooltip="t('Tooltips.External Software Settings.Use cookies for subtitles')"
        compact
        @change="store.dispatch('updateYtDlpSubtitleUseCookies', $event)"
      />
    </FtFlexBox>
    <p class="restrictedPlaybackAuthHint">
      {{ t('Settings.External Software Settings.Restricted Playback Authentication Hint') }}
      <strong>{{ t('Settings.External Software Settings.Restricted Playback Authentication Warning') }}</strong>
    </p>
  </FtSettingsSection>
</template>

<script setup>
import { ytDlp } from '../helpers/ytDlp'
import { FtIcon } from '@opentubex/icons'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSettingsSection from './FtSettingsSection/FtSettingsSection.vue'
import FtButton from './FtButton/FtButton.vue'
import FtInput from './FtInput/FtInput.vue'
import FtSelect from './FtSelect/FtSelect.vue'
import FtFlexBox from './ft-flex-box/ft-flex-box.vue'
import FtToggleSwitch from './FtToggleSwitch/FtToggleSwitch.vue'

import store from '../store/index'

import { showToast } from '../helpers/utils'

const { t } = useI18n()

const YT_DLP_NAME = 'yt-dlp'
const FFMPEG_TOOL_NAME = 'FFmpeg / FFprobe'
const SOURCE_VALUES = ['system', 'managed']
const CHANNEL_NAMES = ['Stable', 'Nightly', 'Master']
const CHANNEL_VALUES = ['stable', 'nightly', 'master']
const UPDATE_MODE_VALUES = ['automatic', 'ask', 'manual']
const AUTHENTICATION_MODE_VALUES = process.env.IS_CAPACITOR ? ['none', 'file'] : ['none', 'file', 'browser']

const sourceNames = computed(() => [
  t('Settings.External Software Settings.Sources.System'),
  t('Settings.External Software Settings.Sources.Managed')
])

const updateModeNames = computed(() => [
  t('Settings.External Software Settings.Update Modes.Automatic'),
  t('Settings.External Software Settings.Update Modes.Ask'),
  t('Settings.External Software Settings.Update Modes.Manual')
])

const authenticationModeNames = computed(() => [
  t('Settings.External Software Settings.Cookie Sources.None'),
  t('Settings.External Software Settings.Cookie Sources.File'),
  ...(!IS_CAPACITOR ? [t('Settings.External Software Settings.Cookie Sources.Browser')] : [])
])

/** @type {import('vue').ComputedRef<'system' | 'managed'>} */
const IS_CAPACITOR = !!process.env.IS_CAPACITOR
const ytDlpSource = computed(() => IS_CAPACITOR ? 'managed' : store.getters.getYtDlpSource)

/** @type {import('vue').ComputedRef<'stable' | 'nightly' | 'master'>} */
const ytDlpChannel = computed(() => store.getters.getYtDlpChannel)

/** @type {import('vue').ComputedRef<string>} */
const ytDlpPath = computed(() => store.getters.getYtDlpPath)

/** @type {import('vue').ComputedRef<'none' | 'file' | 'browser'>} */
const ytDlpPlaybackAuthMode = computed(() => IS_CAPACITOR && store.getters.getYtDlpPlaybackAuthMode === 'browser' ? 'none' : store.getters.getYtDlpPlaybackAuthMode)

/** @type {import('vue').ComputedRef<string>} */
const ytDlpPlaybackCookiesPath = computed(() => store.getters.getYtDlpPlaybackCookiesPath)

/** @type {import('vue').ComputedRef<string>} */
const ytDlpPlaybackCookiesBrowser = computed(() => store.getters.getYtDlpPlaybackCookiesBrowser)

/** @type {import('vue').ComputedRef<string>} */
const ytDlpPlaybackCookiesBrowserProfile = computed(() => store.getters.getYtDlpPlaybackCookiesBrowserProfile)

/** @type {import('vue').ComputedRef<boolean>} */
const ytDlpPlaybackAlwaysUseCookies = computed(() => store.getters.getYtDlpPlaybackAlwaysUseCookies)
const ytDlpSubtitleUseCookies = computed(() => store.getters.getYtDlpSubtitleUseCookies)

/** @type {import('vue').ComputedRef<'system' | 'managed'>} */
const ytDlpFfmpegSource = computed(() => IS_CAPACITOR ? 'managed' : store.getters.getYtDlpFfmpegSource)

/** @type {import('vue').ComputedRef<string>} */
const ytDlpFfmpegPath = computed(() => store.getters.getYtDlpFfmpegPath)

/** @type {import('vue').ComputedRef<'automatic' | 'ask' | 'manual'>} */
const externalSoftwareUpdateMode = computed(() => store.getters.getExternalSoftwareUpdateMode)

/** @typedef {import('../../main/ytDlp').YtDlpBinaryInfo} BinaryInfo */
/** @typedef {import('../../main/ytDlp').YtDlpInfo} YtDlpInfo */

/** @type {import('vue').Ref<{
 *   ytDlp: {
 *     managed: YtDlpInfo | null,
 *     system: { path: string, info: YtDlpInfo } | null
 *   },
 *   ffmpeg: {
 *     managed: BinaryInfo | null,
 *     system: { path: string, info: BinaryInfo } | null
 *   },
 *   ffprobe: {
 *     managed: BinaryInfo | null,
 *     system: { path: string, info: BinaryInfo } | null
 *   }
 * }>}
 */
const binariesInfoCache = ref({
  ytDlp: { managed: null, system: null },
  ffmpeg: { managed: null, system: null },
  ffprobe: { managed: null, system: null }
})

/** @type {import('vue').ComputedRef<YtDlpInfo | null>} */
const ytDlpInfo = computed(() => ytDlpSource.value === 'managed'
  ? binariesInfoCache.value.ytDlp.managed
  : binariesInfoCache.value.ytDlp.system?.path === ytDlpPath.value
    ? binariesInfoCache.value.ytDlp.system.info
    : null)

const supportedBrowsers = computed(() => ytDlpInfo.value?.supportedBrowsers ?? [])
const browserValues = computed(() => {
  const values = ['', ...supportedBrowsers.value]

  if (ytDlpPlaybackCookiesBrowser.value !== '' && !values.includes(ytDlpPlaybackCookiesBrowser.value)) {
    values.push(ytDlpPlaybackCookiesBrowser.value)
  }

  return values
})
const browserNames = computed(() => browserValues.value.map(browser => browser === ''
  ? t('Settings.External Software Settings.Select Browser')
  : browser.charAt(0).toUpperCase() + browser.slice(1)))

/** @type {import('vue').ComputedRef<BinaryInfo | null>} */
const ffmpegInfo = computed(() => ytDlpFfmpegSource.value === 'managed'
  ? binariesInfoCache.value.ffmpeg.managed
  : binariesInfoCache.value.ffmpeg.system?.path === ytDlpFfmpegPath.value
    ? binariesInfoCache.value.ffmpeg.system.info
    : null)

/** @type {import('vue').ComputedRef<BinaryInfo | null>} */
const ffprobeInfo = computed(() => ytDlpFfmpegSource.value === 'managed'
  ? binariesInfoCache.value.ffprobe.managed
  : binariesInfoCache.value.ffprobe.system?.path === ytDlpFfmpegPath.value
    ? binariesInfoCache.value.ffprobe.system.info
    : null)

const ffmpegToolsAvailable = computed(() => ffmpegInfo.value?.available === true && ffprobeInfo.value?.available === true)

const ytDlpBinaryDownloadInProgress = ref(false)
const ffmpegBinaryDownloadInProgress = ref(false)

/** @type {import('vue').Ref<{ binary: 'yt-dlp' | 'ffmpeg', percent: number | null, inProgress: boolean } | null>} */
const binaryDownloadProgress = ref(null)
const activeBinaryDownloads = new Set()
const binaryDownloadPercentages = new Map()

let systemInfoRequestId = 0
let managedInfoRequestId = 0
let refreshTimeout = null

/**
 * A failed check has to be reported as "not available" rather than left pending,
 * otherwise the status stays at "Checking…" and the download buttons stay disabled.
 * @param {Parameters<typeof ytDlp.ytDlpGetInfo>[0]} options
 */
async function getBinariesInfo(options) {
  try {
    return await ytDlp.ytDlpGetInfo(options)
  } catch (error) {
    console.error('Checking the yt-dlp, FFmpeg, and FFprobe binaries failed', error)

    /** @type {import('../../main/ytDlp').YtDlpBinaryInfo} */
    const unavailable = { source: options.ytDlpSource, available: false, version: null }

    const unavailableFfmpegTool = { ...unavailable, source: options.ffmpegSource }
    return {
      ytDlp: { ...unavailable, supportedBrowsers: [] },
      ffmpeg: unavailableFfmpegTool,
      ffprobe: unavailableFfmpegTool
    }
  }
}

async function refreshSystemBinariesInfo() {
  const requestId = ++systemInfoRequestId
  const ytDlpSystemPath = ytDlpPath.value
  const ffmpegSystemPath = ytDlpFfmpegPath.value

  const info = await getBinariesInfo({
    ytDlpSource: 'system',
    ytDlpPath: ytDlpSystemPath,
    ffmpegSource: 'system',
    ffmpegPath: ffmpegSystemPath
  })

  if (requestId === systemInfoRequestId && info !== null) {
    binariesInfoCache.value.ytDlp.system = { path: ytDlpSystemPath, info: info.ytDlp }
    binariesInfoCache.value.ffmpeg.system = { path: ffmpegSystemPath, info: info.ffmpeg }
    binariesInfoCache.value.ffprobe.system = { path: ffmpegSystemPath, info: info.ffprobe }
  }
}

async function refreshManagedBinariesInfo() {
  const requestId = ++managedInfoRequestId

  // Stale "not downloaded" must not stick around while we re-probe after a
  // download — null means the UI shows "Checking…".
  if (binariesInfoCache.value.ytDlp.managed?.available === false) {
    binariesInfoCache.value.ytDlp.managed = null
  }
  if (binariesInfoCache.value.ffmpeg.managed?.available === false) {
    binariesInfoCache.value.ffmpeg.managed = null
  }
  if (binariesInfoCache.value.ffprobe.managed?.available === false) {
    binariesInfoCache.value.ffprobe.managed = null
  }

  const info = await getBinariesInfo({
    ytDlpSource: 'managed',
    ytDlpPath: '',
    ffmpegSource: 'managed',
    ffmpegPath: ''
  })

  if (requestId === managedInfoRequestId && info !== null) {
    binariesInfoCache.value.ytDlp.managed = info.ytDlp
    binariesInfoCache.value.ffmpeg.managed = info.ffmpeg
    binariesInfoCache.value.ffprobe.managed = info.ffprobe
  }
}

async function refreshBinariesInfo() {
  await Promise.all([refreshSystemBinariesInfo(), refreshManagedBinariesInfo()])
}

/**
 * Keeps the combined progress for concurrent downloads monotonic.
 * @param {{ binary: 'yt-dlp' | 'ffmpeg', percent: number | null, inProgress: boolean }} progress
 */
function updateBinaryDownloadProgress(progress) {
  if (progress.percent !== null) {
    const previousBinaryPercentage = binaryDownloadPercentages.get(progress.binary) ?? 0
    binaryDownloadPercentages.set(progress.binary, Math.max(previousBinaryPercentage, progress.percent))
  } else if (!binaryDownloadPercentages.has(progress.binary)) {
    // the download reported no percentage, because its total size is unknown
    binaryDownloadPercentages.set(progress.binary, null)
  }

  const percentages = [...binaryDownloadPercentages.values()]
  const knownPercentages = percentages.filter(percent => percent !== null)

  // Without a single known percentage there is nothing to fill the bar with,
  // so it falls back to showing that something is happening at all
  if (knownPercentages.length === 0) {
    binaryDownloadProgress.value = { ...progress, percent: null }
    return
  }

  const combinedPercentage = knownPercentages.reduce((sum, percent) => sum + percent, 0) / percentages.length
  const displayedPercentage = binaryDownloadProgress.value?.percent ?? 0
  binaryDownloadProgress.value = {
    ...progress,
    percent: Math.max(displayedPercentage, combinedPercentage)
  }
}

onMounted(() => {
  refreshBinariesInfo()

  ytDlp.setYtDlpBinaryDownloadProgressListener((progress) => {
    const inProgress = progress.binary === 'yt-dlp'
      ? ytDlpBinaryDownloadInProgress
      : ffmpegBinaryDownloadInProgress
    inProgress.value = progress.inProgress

    if (progress.inProgress) {
      activeBinaryDownloads.add(progress.binary)
      updateBinaryDownloadProgress(progress)
    } else {
      if (activeBinaryDownloads.has(progress.binary)) {
        updateBinaryDownloadProgress(progress)
      }
      activeBinaryDownloads.delete(progress.binary)
      if (activeBinaryDownloads.size === 0) {
        binaryDownloadProgress.value = null
        binaryDownloadPercentages.clear()
      }
      refreshManagedBinariesInfo()
    }
  })
})

onBeforeUnmount(() => {
  clearTimeout(refreshTimeout)
  systemInfoRequestId++
  managedInfoRequestId++
  activeBinaryDownloads.clear()
  binaryDownloadPercentages.clear()
  ytDlp.setYtDlpBinaryDownloadProgressListener(null)
})

// Re-check path-dependent system binaries after edits. Source switches use
// the already cached status for that source and therefore do not flicker.
watch([ytDlpPath, ytDlpFfmpegPath], () => {
  clearTimeout(refreshTimeout)
  systemInfoRequestId++
  refreshTimeout = setTimeout(refreshSystemBinariesInfo, 500)
})

/**
 * @param {'system' | 'managed'} value
 */
function updateYtDlpSource(value) {
  store.dispatch('updateYtDlpSource', value)
}

/**
 * @param {'stable' | 'nightly' | 'master'} value
 */
function updateYtDlpChannel(value) {
  store.dispatch('updateYtDlpChannel', value)
}

/**
 * @param {string} value
 */
function updateYtDlpPath(value) {
  store.dispatch('updateYtDlpPath', value)
}

/**
 * @param {'none' | 'file' | 'browser'} value
 */
function updateYtDlpPlaybackAuthMode(value) {
  store.dispatch('updateYtDlpPlaybackAuthMode', value)
}

/**
 * @param {string} value
 */
function updateYtDlpPlaybackCookiesPath(value) {
  store.dispatch('updateYtDlpPlaybackCookiesPath', value)
}

/**
 * @param {string} value
 */
function updateYtDlpPlaybackCookiesBrowser(value) {
  store.dispatch('updateYtDlpPlaybackCookiesBrowser', value)
}

/**
 * @param {string} value
 */
function updateYtDlpPlaybackCookiesBrowserProfile(value) {
  store.dispatch('updateYtDlpPlaybackCookiesBrowserProfile', value)
}

/**
 * @param {boolean} value
 */
function updateYtDlpPlaybackAlwaysUseCookies(value) {
  store.dispatch('updateYtDlpPlaybackAlwaysUseCookies', value)
}

/**
 * @param {'system' | 'managed'} value
 */
function updateYtDlpFfmpegSource(value) {
  store.dispatch('updateYtDlpFfmpegSource', value)
}

/**
 * @param {string} value
 */
function updateYtDlpFfmpegPath(value) {
  store.dispatch('updateYtDlpFfmpegPath', value)
}

/**
 * @param {'automatic' | 'ask' | 'manual'} value
 */
function updateExternalSoftwareUpdateMode(value) {
  store.dispatch('updateExternalSoftwareUpdateMode', value)
}

/**
 * @param {'yt-dlp' | 'ffmpeg'} binary
 * @param {string} error
 */
function showDownloadErrorToast(binary, error) {
  showToast({
    message: binary === 'yt-dlp'
      ? t('Settings.External Software Settings.yt-dlp Download Error Template', { error })
      : t('Settings.External Software Settings.FFmpeg and FFprobe Download Error Template', { error }),
    icon: ['fas', 'circle-exclamation'],
  })
}

/**
 * @param {'yt-dlp' | 'ffmpeg'} binary
 */
async function downloadBinary(binary) {
  const inProgress = binary === 'yt-dlp' ? ytDlpBinaryDownloadInProgress : ffmpegBinaryDownloadInProgress
  inProgress.value = true

  try {
    const result = await ytDlp.ytDlpDownloadBinary(binary)

    if (result != null && 'version' in result) {
      const key = binary === 'yt-dlp' ? 'ytDlp' : 'ffmpeg'
      binariesInfoCache.value[key].managed = { source: 'managed', available: true, version: result.version }

      if (result.updated) {
        showToast({
          message: binary === 'yt-dlp'
            ? t('Settings.External Software Settings.yt-dlp Downloaded Template', { version: result.version })
            : t('Settings.External Software Settings.FFmpeg and FFprobe Downloaded Template', { version: result.version }),
          icon: ['fas', 'download'],
        })
      } else {
        const tool = binary === 'yt-dlp' ? 'yt-dlp' : 'FFmpeg and FFprobe'
        showToast({
          message: t('Settings.External Software Settings.Managed Tool Already Current Template', {
            tool,
            version: result.version
          }),
          icon: ['fas', 'check'],
        })
      }
    } else {
      showDownloadErrorToast(binary, result?.error ?? '')
    }
  } catch (error) {
    // without this the button would just go back to its previous label,
    // leaving the failure unexplained
    showDownloadErrorToast(binary, error.message)
  } finally {
    if (activeBinaryDownloads.size === 0) {
      binaryDownloadProgress.value = null
      binaryDownloadPercentages.clear()
    }
    try {
      await refreshManagedBinariesInfo()
    } finally {
      inProgress.value = false
    }
  }
}

/**
 * @param {'yt-dlp' | 'ffmpeg'} binary
 */
async function chooseExecutablePath(binary) {
  const currentPath = binary === 'yt-dlp' ? ytDlpPath.value : ytDlpFfmpegPath.value
  const path = await ytDlp.ytDlpChooseExecutable(currentPath)

  if (typeof path === 'string' && path.length > 0) {
    store.dispatch(binary === 'yt-dlp' ? 'updateYtDlpPath' : 'updateYtDlpFfmpegPath', path)
  }
}

async function chooseCookiesPath() {
  const path = await ytDlp.ytDlpChooseCookies(ytDlpPlaybackCookiesPath.value)

  if (typeof path === 'string' && path.length > 0) {
    store.dispatch('updateYtDlpPlaybackCookiesPath', path)
  }
}

async function chooseBrowserProfilePath() {
  const path = await ytDlp.ytDlpChooseBrowserProfile(ytDlpPlaybackCookiesBrowserProfile.value)

  if (typeof path === 'string' && path.length > 0) {
    store.dispatch('updateYtDlpPlaybackCookiesBrowserProfile', path)
  }
}
</script>

<style scoped>
.externalSoftwareTools {
  --external-software-select-gutter: 70px;
  --external-software-help-width: 28px;

  align-items: stretch;
  display: grid;
  gap: 18px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-block: 8px 18px;
  margin-inline: auto;
  max-inline-size: 860px;
}

.externalSoftwareTool {
  border-radius: calc(6px * var(--ui-roundness));
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  min-inline-size: 0;
  padding-block: 14px 18px;
  padding-inline: 18px;
}

.externalSoftwareToolTitle {
  align-items: center;
  display: flex;
  font-size: 18px;
  gap: 8px;
  margin-block: 0 6px;
  margin-inline: 0;
}

.externalSoftwareToolTitle :deep(.ft-icon) {
  color: var(--accent-color);
}

.externalSoftwareToolControls {
  display: flex;
  flex-direction: column;
  min-inline-size: 0;
}

.externalSoftwareSelect {
  inline-size: calc(100% - var(--external-software-select-gutter));
  max-inline-size: 340px;
}

.externalSoftwarePath {
  inline-size: calc(
    100% - var(--external-software-select-gutter) + var(--external-software-help-width)
  );
  margin-block-start: 24px;
  max-inline-size: calc(340px + var(--external-software-help-width));
}

.externalSoftwareToolStatus {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-block: 20px 14px;
  text-align: center;
}

.externalSoftwareToolAction {
  align-self: center;
  margin-block: auto 5px;
}

.managedSoftwareControls {
  display: flex;
  justify-content: center;
  margin-block-end: 12px;
}

.managedSoftwareControls .externalSoftwareSelect {
  inline-size: 250px;
  margin-inline-start: 70px;
}

.restrictedPlaybackAuthControls {
  column-gap: 12px;
  justify-content: center;
}

.restrictedPlaybackAuthControl {
  box-sizing: border-box;
  flex: 0 1 410px;
  max-inline-size: 100%;
}

.restrictedPlaybackAuthDetail {
  display: flex;
  justify-content: flex-end;
}

.restrictedPlaybackAuthControl > :deep(.select),
.restrictedPlaybackAuthControl > :deep(.ft-input-component) {
  inline-size: 340px;
  max-inline-size: 100%;
}

.restrictedPlaybackAuthControl > :deep(.ft-input-component) {
  margin-block-start: 14px;
}

.restrictedPlaybackAuthDetail > :deep(.select) {
  margin-inline-end: 0;
}

.restrictedPlaybackBrowserProfile {
  margin-block-start: 14px;
}

.restrictedPlaybackBrowserProfile > :deep(.ft-input-component) {
  inline-size: 340px;
  max-inline-size: 100%;
}

@container settings-content (width <= 860px) {
  .restrictedPlaybackAuthControl {
    flex-basis: 340px;
  }

  .restrictedPlaybackAuthDetail {
    justify-content: flex-start;
  }
}

.restrictedPlaybackAuthHint {
  margin-block: 16px 8px;
  margin-inline: auto;
  max-inline-size: 680px;
  padding-inline: 14px;
  text-align: center;
}

.ytDlpStatus {
  margin-block: 0;
}

.ytDlpWarning {
  color: var(--destructive-color);
  font-weight: bold;
  inline-size: 100%;
  padding-block: 8px;
  text-align: center;
}

.binaryProgressBarTrack {
  background-color: #9e9e9e;
  block-size: 8px;
  border-radius: calc(4px * var(--ui-roundness));
  margin-block: 10px;
  margin-inline: auto;
  max-inline-size: 500px;
  overflow: hidden;
}

.binaryProgressBarFill {
  background-color: var(--accent-color);
  block-size: 100%;
  border-radius: calc(4px * var(--ui-roundness));
  transition: inline-size 0.3s ease;
}

.binaryProgressBarFill.indeterminate {
  animation: binary-progress-indeterminate 1.5s ease-in-out infinite;
}

@keyframes binary-progress-indeterminate {
  0% {
    opacity: 1;
  }

  50% {
    opacity: 0.4;
  }

  100% {
    opacity: 1;
  }
}

@container settings-content (width <= 800px) {
  .externalSoftwareTools {
    grid-template-columns: minmax(0, 1fr);
    max-inline-size: 520px;
  }
}

@container settings-content (width <= 460px) {
  .externalSoftwareTools {
    --external-software-select-gutter: 28px;
  }

  .externalSoftwareTool {
    padding-inline: 14px;
  }

  .externalSoftwareSelect,
  .managedSoftwareControls .externalSoftwareSelect {
    margin-inline: 0 28px;
  }

  .externalSoftwareSelect {
    inline-size: calc(100% - var(--external-software-select-gutter));
  }

  .managedSoftwareControls .externalSoftwareSelect {
    inline-size: calc(100% - 28px);
  }
}
</style>
