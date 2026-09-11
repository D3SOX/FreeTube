<template>
  <FtCard class="watchVideoInfo">
    <div>
      <!-- rendered as HTML so that the hashtags and handles in the title are clickable -->
      <h1
        v-safer-html="titleHtml"
        class="videoTitle"
        dir="auto"
      />
      <div
        v-if="isUnlisted || isAgeRestricted || hasAiGeneratedContent || sponsorBlockFullVideoCategory"
        class="videoBadges"
      >
        <div
          v-if="isUnlisted"
          class="videoBadge unlistedBadge"
        >
          <FtIcon
            :icon="['fas', 'eye-slash']"
            aria-hidden="true"
          />
          {{ t('Video.Unlisted') }}
        </div>
        <div
          v-if="isAgeRestricted"
          class="videoBadge ageRestrictedBadge"
        >
          <FtIcon
            :icon="['fas', 'user-lock']"
            aria-hidden="true"
          />
          {{ t('Video.Age Restricted Badge') }}
        </div>
        <div
          v-if="hasAiGeneratedContent"
          :aria-label="t('Video.AI-generated content')"
          :title="t('Video.AI-generated content')"
          class="videoBadge"
        >
          <FtIcon :icon="['fas', 'info-circle']" />
          {{ t('Video.AI') }}
        </div>
        <div
          v-if="sponsorBlockFullVideoCategory"
          class="videoBadge"
        >
          <FtIcon :icon="['fas', 'shield-halved']" />
          {{ t('Video.Player.SponsorBlock.FullVideoLabel', {
            segmentCategory: translateSponsorBlockCategory(sponsorBlockFullVideoCategory)
          }) }}
        </div>
      </div>
    </div>
    <div class="videoMetrics">
      <div class="datePublishedAndViewCount">
        <span class="publishedDate">
          {{ publishedDateText }}
        </span>
        <template
          v-if="publishedTimeAgo && !isPremiereInProgress"
        >
          <span class="seperator">•</span><span class="publishedTimeAgo">{{ publishedTimeAgo }}</span>
        </template>
        <template
          v-if="parsedViewCount"
        >
          <span class="seperator">•</span><span class="videoViews">{{ parsedViewCount }}</span>
        </template>
        <template v-if="category">
          <span class="seperator">•</span>
          <bdi class="videoCategory">
            <strong>{{ t('Description.Video Category') }}</strong> {{ category }}
          </bdi>
        </template>
      </div>
      <div
        v-if="!hideVideoLikesAndDislikes"
        class="likeBarContainer"
      >
        <div
          class="likeSection"
        >
          <div
            v-if="useReturnYoutubeDislikes && likePercentageRatio !== null"
            class="likeBar"
            :style="{ background: `linear-gradient(to right, var(--accent-color) ${likePercentageRatio}%, #9E9E9E ${likePercentageRatio}%)` }"
          />
          <div class="likeCounts">
            <span class="likeCount"><FtIcon :icon="['fas', 'thumbs-up']" /> {{ parsedLikeCount }}</span>
            <span
              v-if="useReturnYoutubeDislikes"
              class="dislikeCount"
            >
              <FtIcon :icon="['fas', 'thumbs-down']" /> {{ parsedDislikeCount }}
            </span>
          </div>
        </div>
      </div>
    </div>
    <div class="videoButtons">
      <div
        class="profileRow"
      >
        <button
          v-if="!hideUploader && hasMultipleCollaborators"
          type="button"
          class="collaboratorSummary"
          @click="showCollaboratorsPrompt = true"
        >
          <span class="collaboratorSummaryThumbnails">
            <FtRetryImage
              v-for="collaborator in channelCollaborators"
              :key="collaborator.id"
              :src="collaborator.thumbnail"
              class="channelThumbnail collaboratorThumbnail"
              alt=""
            />
          </span>
          <span
            class="channelName collaboratorSummaryName"
            dir="auto"
          >
            {{ collaboratorSummaryName }}
          </span>
        </button>
        <template v-else>
          <div
            v-if="!hideUploader"
          >
            <component
              :is="enableChannelLinks ? 'RouterLink' : 'div'"
              :to="`/channel/${channelId}`"
              @click="handleChannelLinkClick"
              @auxclick="handleChannelLinkClick"
            >
              <FtRetryImage
                :src="channelThumbnail"
                :class="enableChannelLinks ? '' : 'initialCursor'"
                class="channelThumbnail"
                alt=""
              />
            </component>
          </div>
          <div>
            <div
              v-if="!hideUploader"
            >
              <component
                :is="enableChannelLinks ? 'RouterLink' : 'span'"
                :to="`/channel/${channelId}`"
                :class="enableChannelLinks ? '' : 'initialCursor'"
                class="channelName"
                dir="auto"
                @click="handleChannelLinkClick"
                @auxclick="handleChannelLinkClick"
              >
                {{ channelName }}
              </component>
            </div>
            <FtSubscribeButton
              v-if="!hideUnsubscribeButton"
              :channel-id="channelId"
              :channel-name="channelName"
              :channel-thumbnail="channelThumbnail"
              :subscription-count-text="subscriptionCountText"
            />
          </div>
        </template>
        <FtCollaboratorsPrompt
          v-if="showCollaboratorsPrompt"
          :collaborators="channelCollaborators"
          @close="showCollaboratorsPrompt = false"
        />
      </div>
      <div class="videoOptions">
        <span class="videoOptionsMobileRow">
          <FtIconButton
            v-if="showPlaylists && !isUpcoming && !hidePlaylistActions"
            :title="t('User Playlists.Add to Playlist')"
            :icon="isInAnyPlaylist ? ['fac', 'playlist-check'] : ['fac', 'playlist-add']"
            theme="base"
            force-dropdown
            mobile-sheet
          >
            <FtAddToPlaylistDropdown :video-data="addToPlaylistVideoData" />
          </FtIconButton>
          <FtIconButton
            v-if="isQuickBookmarkEnabled && !hidePlaylistActions"
            :title="quickBookmarkIconText"
            :icon="quickBookmarkIcon"
            class="quickBookmarkVideoIcon"
            :class="{
              bookmarked: isInQuickBookmarkPlaylist,
            }"
            :theme="quickBookmarkIconTheme"
            @click="toggleQuickBookmarked"
          />
          <FtIconButton
            v-if="canSaveWatchedProgress && watchedProgressSavingInSemiAutoMode"
            :title="t('Video.Save Watched Progress')"
            :icon="['fas', 'bars-progress']"
            @click="saveWatchedProgressManually"
          />
          <FtIconButton
            v-if="channelSettingSaveActions.length === 1"
            :title="channelSettingSaveActions[0].label"
            :icon="channelSettingSaveActions[0].icon"
            :overlay-icon="channelSettingSaveActions[0].saved ? ['fas', 'check'] : null"
            :disabled="channelSettingSaveActions[0].disabled"
            @click="saveChannelSetting(channelSettingSaveActions[0].value)"
          />
          <FtIconButton
            v-else-if="channelSettingSaveActions.length > 1"
            :title="t('Video.Save Channel Setting')"
            :icon="['fas', 'floppy-disk']"
            :overlay-icon="channelSettingSaveActions.some(action => action.saved) ? ['fas', 'check'] : null"
            :dropdown-options="channelSettingSaveActions"
            :dropdown-portal="channelSettingDropdownPortal"
            dropdown-position-x="left"
            @click="saveChannelSetting"
          />
          <FtIconButton
            v-if="useSponsorBlock && !isUpcoming && !hideFullscreenDockActions"
            :title="sponsorBlockInfoTitle"
            :icon="['fas', 'shield-halved']"
            :theme="sponsorBlockPanelOpen ? 'secondary' : 'base'"
            @click="emit('toggle-sponsorblock-info')"
          />
          <FtIconButton
            v-if="liveChatAvailable && !hideFullscreenDockActions"
            :title="liveChatToggleTitle"
            :icon="['fas', 'message']"
            :theme="liveChatOpen ? 'secondary' : 'base'"
            :aria-pressed="liveChatOpen"
            @click="emit('toggle-live-chat')"
          />
          <FtIconButton
            v-if="transcriptAvailable && !isLive && !isUpcoming && !hideFullscreenDockActions"
            :title="transcriptOpen ? t('Video.Transcript.Hide') : t('Video.Transcript.Show')"
            :icon="['fas', 'file-lines']"
            :theme="transcriptOpen ? 'secondary' : 'base'"
            @click="emit('toggle-transcript')"
          />
          <FtIconButton
            v-if="metadataHistory"
            :title="t('Settings.Privacy Settings.Cache Video Metadata')"
            :icon="['fas', 'clock-rotate-left']"
            @click="showMetadataHistory = true"
          />
        </span>
        <span class="videoOptionsMobileRow">
          <FtIconButton
            v-if="supportsYtDlp && enableDownloads && !isUpcoming"
            :title="t('Downloads.Download Video')"
            :icon="['fas', 'download']"
            theme="secondary"
            @click="showDownloadPrompt = true"
          />
          <FtIconButton
            v-if="USING_ELECTRON && externalPlayer !== ''"
            :title="t('Video.External Player.OpenInTemplate', { externalPlayer })"
            :icon="['fas', 'external-link-alt']"
            theme="secondary"
            @click="handleExternalPlayer"
          />
          <FtIconButton
            v-if="!isUpcoming"
            :title="t('Change Format.Change Media Formats')"
            theme="secondary"
            :icon="['fas', 'file-video']"
            @click="openFormatPrompt"
          />
          <FtShareButton
            v-if="!hideSharingActions && !hideShareButton"
            :id="id"
            :get-timestamp="getTimestamp"
            :playlist-id="playlistId"
          />
          <slot name="phone-actions" />
        </span>
      </div>
    </div>
    <WatchVideoFormatPrompt
      v-if="showFormatPrompt"
      :active-format="activeFormat"
      :playback-engine="playbackEngine"
      :playback-engine-version="playbackEngineVersion"
      :playback-engine-selection="playbackEngineSelection"
      :stream-type="streamType"
      :dash-available="dashAvailable"
      :legacy-available="legacyAvailable"
      :audio-available="audioAvailable"
      :local-file-playback="localFilePlayback"
      :local-playback-downloads="localPlaybackDownloads"
      :can-change-playback-engine="supportsYtDlp"
      @change-format="changeFormat"
      @change-playback-engine="changePlaybackEngine"
      @use-local-source="emit('use-local-source', $event)"
      @use-online-source="emit('use-online-source')"
      @close="showFormatPrompt = false"
    />
    <WatchVideoDownloadPrompt
      v-if="enableDownloads && showDownloadPrompt"
      :video-id="id"
      :title="title"
      :thumbnail="videoThumbnail"
      @close="showDownloadPrompt = false"
    />
    <WatchVideoMetadataHistory
      v-if="metadataHistory && showMetadataHistory"
      :history="metadataHistory"
      @close="showMetadataHistory = false"
    />
  </FtCard>
</template>

<script setup>
import FtRetryImage from '../FtRetryImage.vue'
import { ytDlp } from '../../helpers/ytDlp'
import { supportsYtDlp } from '../../helpers/ytDlpCapabilities'
import { FtIcon } from '@opentubex/icons'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtAddToPlaylistDropdown from '../FtAddToPlaylistDropdown/FtAddToPlaylistDropdown.vue'
import FtCard from '../ft-card/ft-card.vue'
import FtCollaboratorsPrompt from '../FtCollaboratorsPrompt/FtCollaboratorsPrompt.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import FtShareButton from '../FtShareButton/FtShareButton.vue'
import FtSubscribeButton from '../FtSubscribeButton/FtSubscribeButton.vue'
import WatchVideoDownloadPrompt from '../WatchVideoDownloadPrompt/WatchVideoDownloadPrompt.vue'
import WatchVideoFormatPrompt from '../WatchVideoFormatPrompt/WatchVideoFormatPrompt.vue'
import WatchVideoMetadataHistory from '../WatchVideoMetadataHistory/WatchVideoMetadataHistory.vue'

import store from '../../store'

import { vSaferHtml } from '../../directives/vSaferHtml'

import { linkifyHashtagsAndHandles } from '../../helpers/descriptionLinks'
import { escapeHTML, formatNumber, formatViewCount, getRelativeTimeFromDate, getVideoThumbnailUrl, openInternalPath, showToast } from '../../helpers/utils'
import { translateSponsorBlockCategory } from '../../helpers/player/utils'
import { parseChannelPreferences } from '../../helpers/channel-preferences'
import { useTabContext } from '../../tabs/TabContext'
import { tabMediaCoordinator } from '../../tabs/TabMediaCoordinator'
import { useRelativeTimeClock } from '../../composables/useRelativeTimeClock'
import { formatDate } from '../../helpers/dateFormat'

const { tabId } = useTabContext()
const dateFormat = computed(() => store.getters.getDateFormat)

const props = defineProps({
  id: {
    type: String,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  channelId: {
    type: String,
    required: true
  },
  currentPlaybackRate: {
    type: Number,
    default: null
  },
  currentVideoQuality: {
    type: String,
    default: null
  },
  currentSubtitlesState: {
    type: Boolean,
    default: null
  },
  currentVolume: {
    type: Number,
    default: null
  },
  channelName: {
    type: String,
    required: true
  },
  channelThumbnail: {
    type: String,
    required: true
  },
  channelCollaborators: {
    type: Array,
    default: () => []
  },
  published: {
    type: Number,
    required: true
  },
  premiereDate: {
    type: Date,
    default: undefined
  },
  viewCount: {
    type: Number,
    default: null
  },
  subscriptionCountText: {
    type: String,
    required: true
  },
  likeCount: {
    type: Number,
    default: 0
  },
  dislikeCount: {
    type: Number,
    default: 0
  },
  category: {
    type: String,
    default: ''
  },
  getTimestamp: {
    type: Function,
    required: true
  },
  isLive: {
    type: Boolean,
    required: false
  },
  isLiveContent: {
    type: Boolean,
    required: true
  },
  isUpcoming: {
    type: Boolean,
    required: true
  },
  playlistId: {
    type: String,
    default: null
  },
  /** @type {import('vue').PropType<() => { index: number, reverse: boolean, shuffle: boolean, loop: boolean }>} */
  getPlaylistState: {
    type: Function,
    required: true
  },
  lengthSeconds: {
    type: Number,
    required: true
  },
  videoThumbnail: {
    type: String,
    required: true
  },
  metadataHistory: {
    type: Object,
    default: null
  },
  inUserPlaylist: {
    type: Boolean,
    required: true
  },
  isUnlisted: {
    type: Boolean,
    required: false
  },
  isAgeRestricted: {
    type: Boolean,
    default: false
  },
  hasAiGeneratedContent: {
    type: Boolean,
    default: false
  },
  sponsorBlockFullVideoCategory: {
    type: String,
    default: null
  },
  /** @type {import('vue').PropType<'dash' | 'legacy' | 'audio'>} */
  activeFormat: {
    type: String,
    default: 'dash'
  },
  /** @type {import('vue').PropType<'built-in' | 'yt-dlp'>} */
  playbackEngine: {
    type: String,
    default: 'built-in'
  },
  playbackEngineVersion: {
    type: String,
    default: null
  },
  /** @type {import('vue').PropType<'built-in' | 'yt-dlp'>} */
  playbackEngineSelection: {
    type: String,
    default: 'built-in'
  },
  /** @type {import('vue').PropType<'sabr' | 'dash' | 'hls' | 'none'>} */
  streamType: {
    type: String,
    default: 'none'
  },
  dashAvailable: {
    type: Boolean,
    default: false
  },
  legacyAvailable: {
    type: Boolean,
    default: false
  },
  audioAvailable: {
    type: Boolean,
    default: false
  },
  localFilePlayback: {
    type: Boolean,
    default: false
  },
  localPlaybackDownloads: {
    type: Array,
    default: () => []
  },
  canSaveWatchedProgress: {
    type: Boolean,
    required: true
  },
  sponsorBlockPanelOpen: {
    type: Boolean,
    default: false
  },
  transcriptOpen: {
    type: Boolean,
    default: false
  },
  transcriptAvailable: {
    type: Boolean,
    default: false
  },
  liveChatAvailable: {
    type: Boolean,
    default: false
  },
  liveChatOpen: {
    type: Boolean,
    default: false
  },
  liveChatReplay: {
    type: Boolean,
    default: false
  },
  hideShareButton: {
    type: Boolean,
    default: false
  },
  hidePlaylistActions: {
    type: Boolean,
    default: false
  },
  hideFullscreenDockActions: {
    type: Boolean,
    default: false
  },
  channelSettingDropdownPortal: {
    type: Boolean,
    default: false
  },
})

const emit = defineEmits([
  'change-format',
  'change-playback-engine',
  'use-local-source',
  'use-online-source',
  'pause-player',
  'save-watched-progress',
  'save-channel-playback-speed',
  'save-channel-video-quality',
  'save-channel-subtitles-state',
  'save-channel-volume',
  'toggle-sponsorblock-info',
  'toggle-transcript',
  'toggle-live-chat',
])

const USING_ELECTRON = process.env.IS_ELECTRON

const { locale, t } = useI18n()
const relativeTimeNow = useRelativeTimeClock()

const showCollaboratorsPrompt = ref(false)
const showDownloadPrompt = ref(false)
const showFormatPrompt = ref(false)
const showMetadataHistory = ref(false)
const enableDownloads = computed(() => store.getters.getEnableDownloads)

const liveChatToggleTitle = computed(() => {
  if (props.liveChatReplay) {
    return props.liveChatOpen ? t('Video.Close Live Chat Replay') : t('Video.Show Live Chat Replay')
  }

  return props.liveChatOpen ? t('Video.Close Live Chat') : t('Video.Show Live Chat')
})

watch(enableDownloads, (enabled) => {
  if (!enabled) showDownloadPrompt.value = false
})

watch(() => props.metadataHistory, history => {
  if (!history) showMetadataHistory.value = false
})

// the title is plain text, so it has to be escaped before the hashtags and handles are linked
/** @type {import('vue').ComputedRef<string>} */
const titleHtml = computed(() => linkifyHashtagsAndHandles(escapeHTML(props.title)))

/** @type {import('vue').ComputedRef<boolean>} */
const hideSharingActions = computed(() => store.getters.getHideSharingActions)

/** @type {import('vue').ComputedRef<boolean>} */
const hideUnsubscribeButton = computed(() => store.getters.getHideUnsubscribeButton)

/** @type {import('vue').ComputedRef<boolean>} */
const hideUploader = computed(() => store.getters.getHideUploader)

/** @type {import('vue').ComputedRef<boolean>} */
const hideVideoLikesAndDislikes = computed(() => store.getters.getHideVideoLikesAndDislikes)

const parsedLikeCount = computed(() => {
  if (hideVideoLikesAndDislikes.value || props.likeCount === null) {
    return null
  }

  return formatNumber(props.likeCount)
})

const hasMultipleCollaborators = computed(() => props.channelCollaborators.length > 1)

const collaboratorSummaryName = computed(() => {
  const names = props.channelCollaborators.map(collaborator => collaborator.name).filter(Boolean)

  if (names.length === 0) {
    return props.channelName
  }

  return new Intl.ListFormat(locale.value, {
    style: 'long',
    type: 'conjunction'
  }).formatToParts(names).map((part, index, parts) => {
    return names.length > 2 && index === parts.length - 2
      ? part.value.replace(',', '')
      : part.value
  }).join('')
})

/** @type {import('vue').ComputedRef<boolean>} */
const useReturnYoutubeDislikes = computed(() => store.getters.getUseReturnYouTubeDislikes)

const parsedDislikeCount = computed(() => {
  if (hideVideoLikesAndDislikes.value || props.dislikeCount === null) {
    return null
  }

  return formatNumber(props.dislikeCount)
})

const likePercentageRatio = computed(() => {
  if (hideVideoLikesAndDislikes.value || props.likeCount === null || props.dislikeCount === null) {
    return null
  }

  const total = props.likeCount + props.dislikeCount
  if (total === 0) {
    return null
  }

  return Math.round((props.likeCount / total) * 100)
})

/** @type {import('vue').ComputedRef<boolean>} */
const hideVideoViews = computed(() => store.getters.getHideVideoViews)

/** @type {import('vue').ComputedRef<boolean>} */
const shortenViewCounts = computed(() => store.getters.getShortenViewCounts)

const parsedViewCount = computed(() => {
  if (hideVideoViews.value || props.viewCount == null) {
    return null
  }

  return t('Global.Counts.View Count', { count: formatViewCount(props.viewCount, shortenViewCounts.value) }, props.viewCount)
})

const validPublishedDate = computed(() => {
  if (!Number.isFinite(props.published) || props.published <= 0) return null

  const date = new Date(props.published)
  return Number.isNaN(date.getTime()) ? null : date
})

const dateString = computed(() => {
  if (!validPublishedDate.value) return ''

  const localeDateString = formatDate(
    validPublishedDate.value,
    locale.value,
    dateFormat.value,
    { dateStyle: 'medium' }
  )
  // replace spaces with no break spaces to make the date act as a single entity while wrapping
  return localeDateString.replaceAll(' ', '\u00A0')
})

const publishedTimeAgo = computed(() => {
  if (!locale.value || !validPublishedDate.value || props.published > relativeTimeNow.value) {
    return ''
  }

  return getRelativeTimeFromDate(props.published, false, true, relativeTimeNow.value)
})

const isPremiereInProgress = computed(() => {
  return props.isLive && !props.isLiveContent
})

const publishedString = computed(() => {
  if (props.isLive && props.isLiveContent) {
    return t('Video.Started streaming on')
  } else if (props.isLiveContent && !props.isLive) {
    return t('Video.Streamed on')
  } else {
    return t('Video.Published on')
  }
})

const publishedDateText = computed(() => {
  if (isPremiereInProgress.value) {
    return t('Video.Premiere started', { timeAgo: publishedTimeAgo.value })
  }

  if (!dateString.value) {
    return ''
  }

  return `${publishedString.value} ${dateString.value}`
})

/**
 * @param {'dash' | 'legacy' | 'audio'} value
 */
function changeFormat(value) {
  emit('change-format', value)
}

async function openFormatPrompt() {
  if (supportsYtDlp) {
    try {
      const downloads = await ytDlp.ytDlpListDownloads()
      downloads.forEach(download => store.commit('upsertYtDlpDownload', download))
    } catch (error) {
      console.warn('Could not refresh downloads for the media format selector', error)
    }
  }
  showFormatPrompt.value = true
}

/**
 * @param {'built-in' | 'yt-dlp'} value
 */
function changePlaybackEngine(value) {
  emit('change-playback-engine', value)
}

const watchedProgressSavingInSemiAutoMode = computed(() => {
  return store.getters.getWatchedProgressSavingMode === 'semi-auto'
})

function saveWatchedProgressManually() {
  emit('save-watched-progress')
}

/** @type {import('vue').ComputedRef<boolean>} */
const rememberPlaybackSpeedPerChannel = computed(() => store.getters.getRememberPlaybackSpeedPerChannel)

/** @type {import('vue').ComputedRef<boolean>} */
const autoUpdateChannelPlaybackSpeeds = computed(() => store.getters.getAutoUpdateChannelPlaybackSpeeds)

/** @type {import('vue').ComputedRef<boolean>} */
const useQuickPlaybackSpeedBar = computed(() => store.getters.getUseQuickPlaybackSpeedBar)

const showSaveChannelPlaybackSpeedButton = computed(() => {
  return !props.isUpcoming &&
    rememberPlaybackSpeedPerChannel.value &&
    !autoUpdateChannelPlaybackSpeeds.value &&
    !useQuickPlaybackSpeedBar.value
})

/** @type {import('vue').ComputedRef<boolean>} */
const rememberVideoQualityPerChannel = computed(() => store.getters.getRememberVideoQualityPerChannel)

/** @type {import('vue').ComputedRef<boolean>} */
const autoUpdateChannelVideoQualities = computed(() => store.getters.getAutoUpdateChannelVideoQualities)

const showSaveChannelVideoQualityButton = computed(() => {
  return !props.isUpcoming && rememberVideoQualityPerChannel.value && !autoUpdateChannelVideoQualities.value
})

const showSaveChannelSubtitlesStateButton = computed(() => {
  return !props.isUpcoming &&
    store.getters.getRememberSubtitlesStatePerChannel &&
    !store.getters.getAutoUpdateChannelSubtitlesStates
})

const showSaveChannelVolumeButton = computed(() => {
  return !process.env.IS_CAPACITOR &&
    !props.isUpcoming &&
    store.getters.getRememberVolumePerChannel &&
    !store.getters.getAutoUpdateChannelVolumes
})

const savedChannelSettings = computed(() => ({
  playbackSpeed: parseChannelPreferences(
    store.getters.getChannelPlaybackSpeeds,
    'channelPlaybackSpeeds'
  )[props.channelId],
  videoQuality: parseChannelPreferences(
    store.getters.getChannelVideoQualities,
    'channelVideoQualities'
  )[props.channelId],
  subtitlesState: parseChannelPreferences(
    store.getters.getChannelSubtitlesStates,
    'channelSubtitlesStates'
  )[props.channelId],
  volume: parseChannelPreferences(
    store.getters.getChannelVolumes,
    'channelVolumes'
  )[props.channelId]
}))

const currentChannelSettings = computed(() => ({
  playbackSpeed: props.currentPlaybackRate,
  videoQuality: props.currentVideoQuality,
  subtitlesState: props.currentSubtitlesState,
  volume: props.currentVolume
}))

function formatChannelSettingValue(type, value) {
  if (type === 'playbackSpeed') {
    return `${value}×`
  }
  if (type === 'videoQuality') {
    return `${value}p`
  }
  if (type === 'subtitlesState') {
    return value ? '✓' : '✕'
  }
  return `${Math.round(value * 100)}%`
}

function createChannelSettingSaveAction(type, visible, label, settingLabel, icon) {
  const savedValue = savedChannelSettings.value[type]
  const currentValue = currentChannelSettings.value[type]
  const hasSavedValue = savedValue !== undefined
  // Player-driven values (especially volume) stay null until initialization finishes;
  // keep the action disabled so the parent handler cannot silently no-op.
  const isUninitialized = currentValue === null
  const isAlreadyCurrent = !isUninitialized && hasSavedValue && String(savedValue) === String(currentValue)
  const disabled = isUninitialized || isAlreadyCurrent
  const formattedValue = hasSavedValue ? formatChannelSettingValue(type, savedValue) : ''
  let actionLabel = label

  if (isAlreadyCurrent) {
    actionLabel = t('Video.Channel Setting Already Set', { setting: settingLabel, value: formattedValue })
  } else if (hasSavedValue) {
    actionLabel = `${label}: ${formattedValue}`
  }

  return {
    visible,
    label: actionLabel,
    icon,
    value: type,
    saved: hasSavedValue,
    disabled
  }
}

const channelSettingSaveActions = computed(() => [
  createChannelSettingSaveAction('playbackSpeed', showSaveChannelPlaybackSpeedButton.value,
    t('Video.Save Channel Playback Speed'), t('Settings.Player Settings.Playback Speed'), ['fas', 'gauge']),
  createChannelSettingSaveAction('videoQuality', showSaveChannelVideoQualityButton.value,
    t('Video.Save Channel Video Quality'), t('Settings.Channel Settings.Video Quality'), ['fas', 'photo-film']),
  createChannelSettingSaveAction('subtitlesState', showSaveChannelSubtitlesStateButton.value,
    t('Video.Save Channel Subtitles State'), t('Search Listing.Label.Subtitles'),
    ['fas', 'closed-captioning']),
  createChannelSettingSaveAction('volume', showSaveChannelVolumeButton.value,
    t('Video.Save Channel Volume'), t('Settings.Channel Settings.Volume'), ['fas', 'volume-high'])
].filter(action => action.visible))

/**
 * @param {'playbackSpeed'|'videoQuality'|'subtitlesState'|'volume'} setting
 */
function saveChannelSetting(setting) {
  switch (setting) {
    case 'playbackSpeed':
      emit('save-channel-playback-speed')
      break
    case 'videoQuality':
      emit('save-channel-video-quality')
      break
    case 'subtitlesState':
      emit('save-channel-subtitles-state')
      break
    case 'volume':
      emit('save-channel-volume')
      break
  }
}

/** @type {import('vue').ComputedRef<boolean>} */
const useSponsorBlock = computed(() => store.getters.getUseSponsorBlock)

const sponsorBlockInfoTitle = computed(() => props.sponsorBlockPanelOpen
  ? t('Video.Player.SponsorBlock.CloseInfoPanel')
  : t('Video.Player.SponsorBlock.OpenInfoPanel'))

/** @type {import('vue').ComputedRef<string>} */
const externalPlayer = computed(() => store.getters.getExternalPlayer)

/** @type {import('vue').ComputedRef<number>} */
const defaultPlayback = computed(() => store.getters.getDefaultPlayback)

function handleExternalPlayer() {
  emit('pause-player')

  let payload

  // Only play video in non playlist mode when user playlist detected
  if (props.inUserPlaylist) {
    payload = {
      videoId: props.id,
      startTime: props.getTimestamp(),
      playbackRate: defaultPlayback.value,
    }
  } else {
    const playlistState = props.getPlaylistState()

    payload = {
      videoId: props.id,
      playlistId: props.playlistId,
      startTime: props.getTimestamp(),
      playbackRate: defaultPlayback.value,
      playlistIndex: playlistState.index,
      playlistReverse: playlistState.reverse,
      playlistShuffle: playlistState.shuffle,
      playlistLoop: playlistState.loop
    }
  }

  if (process.env.IS_ELECTRON) {
    window.ftElectron.openInExternalPlayer(payload)
  }
}

watch(
  () => [props.title, props.channelName, props.videoThumbnail],
  ([title, artist, artworkSrc]) => {
    const metadata = {
      title,
      artist,
      artwork: artworkSrc
        ? [{ src: artworkSrc, sizes: '128x128', type: 'image/png' }]
        : []
    }
    tabMediaCoordinator.setMetadata(
      tabId ?? 'web',
      typeof MediaMetadata === 'function' ? new MediaMetadata(metadata) : metadata
    )
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  tabMediaCoordinator.setMetadata(tabId ?? 'web', null)
})

const showPlaylists = computed(() => !store.getters.getHidePlaylists)
const isInAnyPlaylist = computed(() => store.getters.getPlaylistVideoCounts.has(props.id))

// `description` and `viewCount` are intentionally left out,
// the store drops them from playlist entries as undesired attributes
const addToPlaylistVideoData = computed(() => ({
  videoId: props.id,
  title: props.title,
  author: props.channelName,
  authorId: props.channelId,
  lengthSeconds: props.lengthSeconds,
  published: props.published,
  premiereDate: props.premiereDate
}))

const quickBookmarkPlaylist = computed(() => store.getters.getQuickBookmarkPlaylist)

const quickBookmarkThumbnail = computed(() => {
  return getVideoThumbnailUrl(props.id, store.getters.getBackendPreference, store.getters.getCurrentInvidiousInstanceUrl, store.getters.getThumbnailPreference)
})

const isQuickBookmarkEnabled = computed(() => quickBookmarkPlaylist.value != null)
const quickBookmarkIcon = computed(() => store.getters.getQuickBookmarkIcon)

const isInQuickBookmarkPlaylist = computed(() => {
  if (!isQuickBookmarkEnabled.value) { return false }

  // Accessing a reactive property has a negligible amount of overhead,
  // however as we know that some users have playlists that have more than 10k items in them
  // it adds up quickly. So create a temporary variable outside of the array, so we only have to do it once.
  // Also the search is retriggered every time any playlist is modified.
  const id = props.id

  return quickBookmarkPlaylist.value.videos.some((video) => {
    return video.videoId === id
  })
})

const quickBookmarkIconText = computed(() => {
  if (!isQuickBookmarkEnabled.value) { return '' }

  const translationProperties = {
    playlistName: quickBookmarkPlaylist.value.playlistName,
  }
  return isInQuickBookmarkPlaylist.value
    ? t('User Playlists.Remove from Favorites', translationProperties)
    : t('User Playlists.Add to Favorites', translationProperties)
})

const quickBookmarkIconTheme = computed(() => isInQuickBookmarkPlaylist.value ? 'base favorite' : 'base')

function toggleQuickBookmarked() {
  if (!isQuickBookmarkEnabled.value) {
    // This should be prevented by UI
    return
  }

  if (isInQuickBookmarkPlaylist.value) {
    removeFromQuickBookmarkPlaylist()
  } else {
    addToQuickBookmarkPlaylist()
  }
}

async function addToQuickBookmarkPlaylist() {
  const videoData = {
    videoId: props.id,
    title: props.title,
    author: props.channelName,
    authorId: props.channelId,
    lengthSeconds: props.lengthSeconds,
    published: props.published,
    premiereDate: props.premiereDate
  }

  const playlistName = quickBookmarkPlaylist.value.playlistName

  const saved = await store.dispatch('addVideo', {
    _id: quickBookmarkPlaylist.value._id,
    videoData,
  })

  showToast({
    message: saved
      ? t('Video.Video has been saved to {playlistName}', { playlistName })
      : t('Video.There was a problem saving the video to {playlistName}', { playlistName }),
    image: quickBookmarkThumbnail.value,
    icon: ['fas', 'bookmark'],
  })
}

async function removeFromQuickBookmarkPlaylist() {
  const playlistName = quickBookmarkPlaylist.value.playlistName

  const removed = await store.dispatch('removeVideo', {
    _id: quickBookmarkPlaylist.value._id,
    // Remove all playlist items with same videoId
    videoId: props.id,
  })

  showToast({
    message: removed
      ? t('Video.Video has been removed from {playlistName}', { playlistName })
      : t('Video.There was a problem removing the video from {playlistName}', { playlistName }),
    image: quickBookmarkThumbnail.value,
    icon: ['fas', 'trash'],
  })
}

const enableChannelLinks = computed(() => !store.getters.getDisableChannelLinks)

function handleChannelLinkClick(event) {
  if (!USING_ELECTRON || !enableChannelLinks.value) {
    return
  }

  const isMiddleClick = event.type === 'auxclick' && event.button === 1
  const isModifiedClick = event.type === 'click' && (event.ctrlKey || event.metaKey)
  if (!isMiddleClick && !isModifiedClick) {
    return
  }

  event.preventDefault()
  openInternalPath({
    path: `/channel/${props.channelId}`,
    title: props.channelName,
    doCreateNewWindow: event.shiftKey,
    doCreateNewTab: !event.shiftKey,
    makeActive: !isMiddleClick
  })
}
</script>

<style scoped src="./WatchVideoInfo.css" />
