<template>
  <div
    class="ft-list-video ft-list-item"
    :class="{
      list: effectiveListTypeIsList,
      grid: !effectiveListTypeIsList,
      [appearance]: true,
      watched: addWatchedStyle,
      premiereVideo: isPremiere && !isUpcomingForCurrentTime
    }"
  >
    <div
      v-if="showGrabBar"
      class="grabBar"
      :class="{
        grabBarDisabled: !grabBarEnabled,
      }"
    >
      <FtIcon
        :icon="['fas', 'bars']"
      />
    </div>
    <div
      class="videoThumbnail"
      draggable="true"
      @dragstart="onDragStart"
    >
      <RouterLink
        class="thumbnailLink"
        tabindex="-1"
        :to="watchVideoRouterLink"
        @click="handleWatchPageLinkClick"
        @auxclick="handleWatchPageLinkClick"
        @pointerenter="startThumbnailPreview"
        @pointerleave="stopThumbnailPreview"
      >
        <img
          :src="thumbnail"
          class="thumbnailImage"
          :class="{ blur: blurThumbnails }"
          alt=""
        >
        <img
          v-if="thumbnailPreviewActive && thumbnailPreviewLoaded"
          :src="thumbnailPreviewUrl"
          class="thumbnailImage thumbnailPreview active loaded"
          :class="{ blur: blurThumbnails }"
          alt=""
          aria-hidden="true"
          @error="resetThumbnailPreview"
        >
        <FtEmbeddedProgress
          v-if="historyEntryExists && progressPercentage > 0"
          class="watchedProgressBar"
          :progress="progressPercentage"
          :corner-radius="thumbnailProgressRadius"
          :end-arc-fraction="0.5"
          :line-width="3"
          :start-arc-fraction="0.5"
        />
      </RouterLink>
      <div
        v-if="isLive || isUpcoming || (displayDuration !== '' && displayDuration !== '0:00')"
        class="videoDuration"
        :class="{
          live: isLive,
          upcoming: isUpcoming
        }"
      >
        {{ displayDurationLabel }}
      </div>
      <div
        v-if="useSponsorBlock && sponsorBlockFullVideoCategory"
        class="sponsorBlockVideoLabel"
        :title="t('Video.Player.SponsorBlock.FullVideoLabel', {
          segmentCategory: sponsorBlockFullVideoLabel
        })"
      >
        <FtIcon :icon="sponsorBlockFullVideoIcon" />
        <span>{{ sponsorBlockFullVideoLabel }}</span>
      </div>
      <FtIconButton
        v-if="externalPlayer !== '' && !externalPlayerIsDefaultViewingMode"
        :title="t('Video.External Player.OpenInTemplate', { externalPlayer })"
        :icon="['fas', 'external-link-alt']"
        class="externalPlayerIcon"
        theme="base"
        :padding="appearance === 'watchPlaylistItem' ? 6 : 7"
        :size="appearance === 'watchPlaylistItem' ? 12 : 16"
        draggable="true"
        @click="handleExternalPlayer"
        @dragstart="onDragStart"
      />
      <span
        class="playlistIcons"
        draggable="true"
        @dragstart="onDragStart"
      >
        <FtIconButton
          v-if="extraThumbnailActionButton"
          :title="extraThumbnailActionButton.title"
          :icon="extraThumbnailActionButton.icon"
          class="extraThumbnailActionIcon"
          theme="base"
          :padding="appearance === 'watchPlaylistItem' ? 5 : 6"
          :size="appearance === 'watchPlaylistItem' ? 14 : 18"
          @click="handleExtraThumbnailAction"
        />
        <FtIconButton
          v-if="showPlaylists"
          :title="t('User Playlists.Add to Playlist')"
          :icon="isInAnyPlaylist ? ['fac', 'playlist-check'] : ['fac', 'playlist-add']"
          class="addToPlaylistIcon"
          :class="alwaysShowAddToPlaylistButton ? 'alwaysVisible' : ''"
          :padding="playlistIconPadding"
          :size="playlistIconSize"
          force-dropdown
          dropdown-position-x="left"
          :dropdown-portal="appearance === 'watchPlaylistItem'"
          :dropdown-position-y="appearance === 'watchPlaylistItem' ? 'top' : 'bottom'"
        >
          <FtAddToPlaylistDropdown :video-data="addToPlaylistVideoData" />
        </FtIconButton>
        <FtIconButton
          v-if="isQuickBookmarkEnabled && quickBookmarkButtonEnabled"
          :title="quickBookmarkIconText"
          :icon="quickBookmarkIcon"
          class="quickBookmarkVideoIcon"
          :class="{
            bookmarked: isInQuickBookmarkPlaylist,
            alwaysVisible: alwaysShowAddToPlaylistButton,
          }"
          :theme="quickBookmarkIconTheme"
          :padding="playlistIconPadding"
          :size="playlistIconSize"
          @click="toggleQuickBookmarked"
        />
        <FtIconButton
          v-if="inUserPlaylist && canMoveVideoUp"
          :title="t('User Playlists.Move Video Up')"
          :icon="effectiveListTypeIsList ? ['fas', 'arrow-up'] : ['fas', 'arrow-left']"
          class="upArrowIcon"
          :padding="playlistIconPadding"
          :size="playlistIconSize"
          @click="moveVideoUp"
        />
        <FtIconButton
          v-if="inUserPlaylist && canMoveVideoDown"
          :title="t('User Playlists.Move Video Down')"
          :icon="effectiveListTypeIsList ? ['fas', 'arrow-down'] : ['fas', 'arrow-right']"
          class="downArrowIcon"
          :padding="playlistIconPadding"
          :size="playlistIconSize"
          @click="moveVideoDown"
        />
        <FtIconButton
          v-if="inUserPlaylist && canRemoveFromPlaylist"
          :title="t('User Playlists.Remove from Playlist')"
          :icon="['fas', 'trash']"
          class="trashIcon"
          :padding="playlistIconPadding"
          :size="playlistIconSize"
          @click="removeFromPlaylist"
        />
        <FtIconButton
          v-if="canToggleLiveReminder"
          :title="liveReminderActive ? t('Video.Notification on') : t('Video.Notify me')"
          :icon="['fas', 'calendar-days']"
          :aria-pressed="liveReminderActive"
          :disabled="liveReminderLoading"
          class="liveReminderIcon"
          :theme="liveReminderActive ? 'secondary' : 'base'"
          :padding="playlistIconPadding"
          :size="playlistIconSize"
          @click="toggleLiveReminder"
        />
      </span>
      <div
        v-if="addWatchedStyle"
        class="videoWatched"
      >
        {{ t("Video.Watched") }}
      </div>
    </div>
    <div
      class="info"
      draggable="true"
      @dragstart="onDragStart"
    >
      <RouterLink
        class="title"
        :to="watchVideoRouterLink"
        @click="handleWatchPageLinkClick"
        @auxclick="handleWatchPageLinkClick"
      >
        <h3
          class="h3Title"
          dir="auto"
        >
          <FtNewContentDot v-if="showNewSubscriptionFeedIndicator" />
          {{ displayTitle }}
        </h3>
      </RouterLink>
      <div class="infoLine">
        <button
          v-if="shouldShowChannelResolverButton"
          type="button"
          class="channelName channelResolverButton"
          dir="auto"
          :disabled="isFetchingCollaborators"
          @click.stop.prevent="openChannelByline"
        >
          <FtChannelAvatar
            v-if="showChannelAvatar"
            :thumbnail="channelThumbnail"
          />
          <span class="channelNameText">{{ channelName }}</span>
        </button>
        <component
          :is="disableChannelLinks ? 'span' : 'router-link'"
          v-else-if="channelId !== null"
          class="channelName"
          dir="auto"
          :to="`/channel/${channelId}`"
          @auxclick="handleChannelLinkClick"
        >
          <FtChannelAvatar
            v-if="showChannelAvatar"
            :thumbnail="channelThumbnail"
          />
          <span class="channelNameText">{{ channelName }}</span>
        </component>
        <bdi
          v-else-if="channelName !== null"
          class="channelName"
        >
          <FtChannelAvatar
            v-if="showChannelAvatar"
            :thumbnail="channelThumbnail"
          />
          <span class="channelNameText">{{ channelName }}</span>
        </bdi>
        <span class="videoInfo">
          <span
            v-if="!isLive && !isUpcoming && !isPremium && !hideViews && viewCount != null"
            class="viewCount"
          >{{ t('Global.Counts.View Count', { count: parsedViewCount }, viewCount) }}</span>
          <span
            v-if="displayedUploadedTime !== '' && !isLive"
            class="uploadedTime"
          >{{ displayedUploadedTime }}</span>
          <span
            v-if="subscriptionHiddenVideoCount > 0"
            class="subscriptionHiddenVideoCount"
          >{{ t('Channel.More videos hidden', { count: subscriptionHiddenVideoCount }, subscriptionHiddenVideoCount) }}</span>
          <span
            v-if="isLive && !hideViews"
            class="viewCount"
          >{{ t('Global.Counts.Watching Count', { count: parsedViewCount }, viewCount) }}</span>
        </span>
      </div>
      <FtCollaboratorsPrompt
        v-if="showCollaboratorsPrompt"
        :collaborators="channelCollaborators"
        @close="showCollaboratorsPrompt = false"
      />
      <div
        v-if="isMembersOnly || is4k || hasCaptions || is8k || isNew || isVr180 || isVr360 || is3D"
        class="videoTagLine"
      >
        <div
          v-if="isMembersOnly"
          class="videoTag membersOnlyTag"
        >
          <FtIcon
            :icon="['fas', 'users']"
            aria-hidden="true"
          />
          {{ t('Search Listing.Label.Members Only') }}
        </div>
        <div
          v-if="isNew"
          class="videoTag"
          :aria-label="t('Search Listing.Label.New')"
          role="img"
        >
          {{ t('Search Listing.Label.New') }}
        </div>
        <div
          v-if="is4k"
          class="videoTag"
          :aria-label="t('Search Listing.Label.4K')"
          role="img"
        >
          {{ t('Search Listing.Label.4K') }}
        </div>
        <div
          v-if="is8k"
          class="videoTag"
          :aria-label="t('Search Listing.Label.8K')"
          role="img"
        >
          {{ t('Search Listing.Label.8K') }}
        </div>
        <div
          v-if="isVr180"
          class="videoTag"
          :aria-label="t('Search Listing.Label.VR180')"
          role="img"
        >
          {{ t('Search Listing.Label.VR180') }}
        </div>
        <div
          v-if="isVr360"
          class="videoTag"
          :aria-label="t('Search Listing.Label.360 Video')"
          role="img"
        >
          {{ t('Search Listing.Label.360 Video') }}
        </div>
        <div
          v-if="is3D"
          class="videoTag"
          :aria-label="t('Search Listing.Label.3D')"
          role="img"
        >
          {{ t('Search Listing.Label.3D') }}
        </div>
        <div
          v-if="hasCaptions"
          class="videoTag"
          :aria-label="t('Search Listing.Label.Closed Captions')"
          role="img"
        >
          {{ t('Search Listing.Label.Subtitles') }}
        </div>
      </div>
      <div class="buttonStack">
        <FtIconButton
          class="optionsButton"
          :icon="['fas', 'ellipsis-v']"
          :title="t('Video.More Options')"
          theme="base-no-default"
          :size="16"
          :use-shadow="false"
          dropdown-class="listVideoOptionsDropdown"
          :dropdown-portal="appearance === 'watchPlaylistItem'"
          dropdown-position-x="left"
          :dropdown-position-y="appearance === 'watchPlaylistItem' ? 'top' : 'bottom'"
          :dropdown-options="dropdownOptions"
          @click="handleOptionsClick"
        />
        <button
          v-if="deArrowChangedContent || deArrowTogglePinned"
          :title="deArrowToggleTitle"
          class="optionsButton deArrowToggleButton"
          :class="{ alwaysVisible: deArrowTogglePinned }"
          @click="toggleDeArrow"
        >
          <FtIcon
            class="deArrowToggleIcon"
            :icon="['far', 'dot-circle']"
          />
        </button>
      </div>
      <p
        v-if="description && effectiveListTypeIsList && appearance === 'result'"
        v-safer-html="description"
        class="description"
        dir="auto"
      />
      <div
        v-if="effectiveListTypeIsList"
        class="restArea"
      >
        &nbsp;
      </div>
    </div>
    <WatchVideoDownloadPrompt
      v-if="enableDownloads && showDownloadPrompt"
      :video-id="id"
      :title="title"
      :thumbnail="thumbnail"
      @close="showDownloadPrompt = false"
    />
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import FtAddToPlaylistDropdown from '../FtAddToPlaylistDropdown/FtAddToPlaylistDropdown.vue'
import FtChannelAvatar from '../FtChannelAvatar/FtChannelAvatar.vue'
import FtCollaboratorsPrompt from '../FtCollaboratorsPrompt/FtCollaboratorsPrompt.vue'
import FtEmbeddedProgress from '../FtEmbeddedProgress/FtEmbeddedProgress.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import FtNewContentDot from '../FtNewContentDot/FtNewContentDot.vue'
import WatchVideoDownloadPrompt from '../WatchVideoDownloadPrompt/WatchVideoDownloadPrompt.vue'
import { vSaferHtml } from '../../directives/vSaferHtml.js'

import store from '../../store/index'

import {
  copyToClipboard,
  formatDurationAsTimestamp,
  formatViewCount,
  getCachedOembedTitle,
  getOembedTitle,
  getRelativeTimeFromDate,
  getShortThumbnailUrl,
  getVideoThumbnailUrl,
  openExternalLink,
  openInternalPath,
  showToast,
  toDistractionFreeTitle,
  deepCopy,
  debounce
} from '../../helpers/utils.js'
import { getLocalVideoChannels } from '../../helpers/api/local.js'
import { isHistoryEntryWatched } from '../../helpers/history.js'
import { liveReminder, supportsLiveReminders } from '../../helpers/liveReminders'
import { getUpcomingPremiereTimestamp } from '../../helpers/subscription-entries.js'
import { isThumbnailPreviewImageUsable } from '../../helpers/thumbnailPreview.js'
import { deArrowData, deArrowThumbnail, getSponsorBlockVideoLabel } from '../../helpers/sponsorblock.js'
import {
  morphThumbnailIntoNewTab,
  requestWatchPageViewTransition
} from '../../helpers/viewTransitions.js'
import { setCollaboratorsLoading } from './collaboratorsLoading.js'
import { useRelativeTimeClock } from '../../composables/useRelativeTimeClock.js'
import { useResultChannelAvatar } from '../../composables/useResultChannelAvatar.js'
import { formatDate, formatDateTime } from '../../helpers/dateFormat.js'
import thumbnailPlaceholder from '../../assets/img/thumbnail_placeholder.svg'

const props = defineProps({
  data: {
    type: Object,
    required: true
  },
  playlistId: {
    type: String,
    default: null
  },
  playlistType: {
    type: String,
    default: null
  },
  playlistItemId: {
    type: String,
    default: null
  },
  downloadId: {
    type: String,
    default: ''
  },
  playlistIndex: {
    type: Number,
    default: null
  },
  playlistReverse: {
    type: Boolean,
    default: false
  },
  playlistShuffle: {
    type: Boolean,
    default: false
  },
  playlistLoop: {
    type: Boolean,
    default: false
  },
  forceListType: {
    type: String,
    default: null
  },
  appearance: {
    type: String,
    required: true
  },
  showVideoWithLastViewedPlaylist: {
    type: Boolean,
    default: false
  },
  showWatchedStyleInHistory: {
    type: Boolean,
    default: false,
  },
  alwaysShowAddToPlaylistButton: {
    type: Boolean,
    default: false,
  },
  quickBookmarkButtonEnabled: {
    type: Boolean,
    default: true,
  },
  canMoveVideoUp: {
    type: Boolean,
    default: false,
  },
  canMoveVideoDown: {
    type: Boolean,
    default: false,
  },
  canRemoveFromPlaylist: {
    type: Boolean,
    default: false,
  },
  showGrabBar: {
    type: Boolean,
    default: false,
  },
  grabBarEnabled: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits([
  'move-video-down',
  'move-video-to-the-bottom',
  'move-video-to-the-top',
  'move-video-up',
  'pause-player',
  'remove-from-playlist'
])

const { locale, t } = useI18n()
const route = useRoute()
const dateFormat = computed(() => store.getters.getDateFormat)
const timeFormat = computed(() => store.getters.getTimeFormat)

const subscriptionHiddenVideoCount = computed(() => (
  Number.isInteger(props.data.subscriptionHiddenVideoCount)
    ? props.data.subscriptionHiddenVideoCount
    : 0
))

const id = ref('')
const title = ref('')
const channelName = ref(null)
const channelId = ref(null)
const channelCollaborators = ref([])
const viewCount = ref(0)
const uploadedTime = ref('')
const uploadedTimeIsRelative = ref(false)
const relativeTimeNow = useRelativeTimeClock()
const relativeTimeDataLoadedAt = ref(Date.now())
const relativeTimeClockAtLoad = ref(relativeTimeNow.value)
const lengthSeconds = ref(0)
const duration = ref('')
const description = ref('')
const published = ref(undefined)
const displayedUploadedTime = computed(() => {
  if (uploadedTimeIsRelative.value && published.value) {
    const clockNow = relativeTimeNow.value
    // Use the load-time clock while the shared tick is unchanged so reused cards
    // aren't formatted against a stale value. Follow later ticks, including
    // backward clock corrections.
    const now = clockNow === relativeTimeClockAtLoad.value
      ? relativeTimeDataLoadedAt.value
      : clockNow

    return getRelativeTimeFromDate(published.value, false, true, now)
  }

  return uploadedTime.value
})
const isLive = ref(false)
const isPremiere = ref(false)
const is4k = ref(false)
const is8k = ref(false)
const isNew = ref(false)
const isVr180 = ref(false)
const isVr360 = ref(false)
const is3D = ref(false)
const hasCaptions = ref(false)
const isMembersOnly = ref(false)
const isUpcoming = ref(false)
const showDownloadPrompt = ref(false)
const enableDownloads = computed(() => store.getters.getEnableDownloads)

watch(enableDownloads, (enabled) => {
  if (!enabled) showDownloadPrompt.value = false
})
const isPremium = ref(false)
const hideViews = ref(false)
const thumbnailPreviewActive = ref(false)
const thumbnailPreviewLoaded = ref(false)
const THUMBNAIL_PREVIEW_DELAY = 250
let thumbnailPreviewLoader = null
let thumbnailPreviewLoaderUrl = null
let thumbnailPreviewTimer = null
const deArrowTogglePinned = ref(false)
const showCollaboratorsPrompt = ref(false)
const isFetchingCollaborators = ref(false)
const sponsorBlockFullVideoCategory = ref(null)
const liveReminderActive = ref(false)
const liveReminderLoading = ref(false)
let liveReminderLoadGeneration = 0
let removeLiveReminderUpdatedListener = null

const historyEntry = computed(() => store.getters.getHistoryCacheById[id.value])

const historyEntryExists = computed(() => historyEntry.value !== undefined)

const isWatched = computed(() => isHistoryEntryWatched(historyEntry.value))

const premiereTimestamp = computed(() => getUpcomingPremiereTimestamp(props.data))
const premiereNow = ref(Date.now())
const isUpcomingForCurrentTime = computed(() => (
  isUpcoming.value &&
  (premiereTimestamp.value == null || premiereTimestamp.value > premiereNow.value)
))
const MAX_TIMEOUT_DELAY = 2_147_483_647
let premiereStartTimer = null

const canToggleLiveReminder = computed(() => (
  supportsLiveReminders &&
  premiereTimestamp.value != null &&
  premiereTimestamp.value > premiereNow.value
))

const canMarkAsWatched = computed(() => {
  if (isLive.value) {
    return false
  }

  // A scheduled premiere can only be watched once its start time has passed,
  // even if a cached entry still carries a stale upcoming flag.
  if (premiereTimestamp.value != null) {
    return premiereTimestamp.value <= premiereNow.value
  }

  return !isUpcoming.value
})

function clearPremiereStartTimer() {
  if (premiereStartTimer != null) {
    clearTimeout(premiereStartTimer)
    premiereStartTimer = null
  }
}

function schedulePremiereStartInvalidation() {
  clearPremiereStartTimer()

  const timestamp = premiereTimestamp.value
  const now = Date.now()
  premiereNow.value = now
  if (timestamp == null || timestamp <= now) {
    return
  }

  premiereStartTimer = setTimeout(() => {
    premiereStartTimer = null
    schedulePremiereStartInvalidation()
  }, Math.min(timestamp - now + 1, MAX_TIMEOUT_DELAY))
}

const watchProgress = computed(() => {
  if (!historyEntryExists.value || !watchedProgressSavingEnabled.value) {
    return 0
  }

  return historyEntry.value.watchProgress
})

/** @type {import('vue').ComputedRef<'grid' | 'list'>} */
const listType = computed(() => store.getters.getListType)

const effectiveListTypeIsList = computed(() => {
  return (listType.value === 'list' || props.forceListType === 'list') &&
    props.forceListType !== 'grid'
})

/** @type {import('vue').ComputedRef<'' | 'start' | 'middle' | 'end' | 'hidden' | 'blur'>} */
const thumbnailPreference = computed(() => store.getters.getThumbnailPreference)

/** @type {import('vue').ComputedRef<boolean>} */
const blurThumbnails = computed(() => store.getters.getBlurThumbnails)

const thumbnailPreviewUrl = computed(() => {
  if (
    !store.getters.getShowThumbnailPreviews ||
    thumbnailPreference.value === 'hidden' ||
    props.appearance === 'youtubeShort'
  ) {
    return null
  }

  return typeof props.data.thumbnailPreviewUrl === 'string'
    ? props.data.thumbnailPreviewUrl
    : null
})

function clearThumbnailPreviewTimer() {
  if (thumbnailPreviewTimer !== null) {
    clearTimeout(thumbnailPreviewTimer)
    thumbnailPreviewTimer = null
  }
}

function startThumbnailPreview() {
  clearThumbnailPreviewTimer()

  const previewUrl = thumbnailPreviewUrl.value
  if (!previewUrl) {
    return
  }

  if (thumbnailPreviewLoaderUrl !== previewUrl) {
    const loader = new Image()
    thumbnailPreviewLoader = loader
    thumbnailPreviewLoaderUrl = previewUrl
    thumbnailPreviewLoaded.value = false

    loader.onload = () => {
      if (
        thumbnailPreviewLoader === loader &&
        thumbnailPreviewUrl.value === previewUrl
      ) {
        if (isThumbnailPreviewImageUsable(loader)) {
          thumbnailPreviewLoaded.value = true
        } else {
          resetThumbnailPreview()
        }
      }
    }
    loader.onerror = () => {
      if (thumbnailPreviewLoader === loader) {
        thumbnailPreviewLoader = null
        thumbnailPreviewLoaderUrl = null
        thumbnailPreviewLoaded.value = false
      }
    }
    loader.src = previewUrl
  }

  thumbnailPreviewTimer = setTimeout(() => {
    thumbnailPreviewTimer = null
    if (thumbnailPreviewUrl.value === previewUrl) {
      thumbnailPreviewActive.value = true
    }
  }, THUMBNAIL_PREVIEW_DELAY)
}

function stopThumbnailPreview() {
  clearThumbnailPreviewTimer()
  thumbnailPreviewActive.value = false
}

function resetThumbnailPreview() {
  stopThumbnailPreview()
  if (thumbnailPreviewLoader !== null) {
    thumbnailPreviewLoader.onload = null
    thumbnailPreviewLoader.onerror = null
  }
  thumbnailPreviewLoader = null
  thumbnailPreviewLoaderUrl = null
  thumbnailPreviewLoaded.value = false
}

watch(thumbnailPreviewUrl, resetThumbnailPreview)

/** @type {import('vue').ComputedRef<'local' | 'invidious'>} */
const backendPreference = computed(() => store.getters.getBackendPreference)

/** @type {import('vue').ComputedRef<string>} */
const currentInvidiousInstanceUrl = computed(() => store.getters.getCurrentInvidiousInstanceUrl)

const showChannelAvatar = computed(() => (
  !store.getters.getHideChannelAvatars &&
  (props.appearance === 'result' || props.appearance === 'youtubeShort') &&
  channelName.value !== null &&
  channelId.value !== null
))

const { channelThumbnail } = useResultChannelAvatar(
  toRef(props, 'data'),
  channelId,
  showChannelAvatar
)

const showPlaylists = computed(() => !store.getters.getHidePlaylists)
const useSponsorBlock = computed(() => store.getters.getUseSponsorBlock)

const sponsorBlockFullVideoIcon = computed(() => {
  switch (sponsorBlockFullVideoCategory.value) {
    case 'exclusive_access':
      return ['fas', 'ticket']
    case 'selfpromo':
      return ['fas', 'bullhorn']
    default:
      return ['fas', 'rectangle-ad']
  }
})

const sponsorBlockFullVideoLabel = computed(() => {
  switch (sponsorBlockFullVideoCategory.value) {
    case 'exclusive_access':
      return t('Video.Sponsor Block category.exclusive access')
    case 'selfpromo':
      return t('Video.Sponsor Block category.self-promotion')
    default:
      return t('Video.Sponsor Block category.sponsor')
  }
})

const extraThumbnailAction = computed(() => store.getters.getExtraThumbnailAction)

const extraThumbnailActionButton = computed(() => {
  switch (extraThumbnailAction.value) {
    case 'history':
      if (!canMarkAsWatched.value) {
        return null
      }
      return {
        title: isWatched.value
          ? t('Video.Unmark As Watched')
          : t('Video.Mark As Watched'),
        icon: isWatched.value ? ['fas', 'eye-slash'] : ['fas', 'eye']
      }
    case 'copyYoutube':
      return {
        title: t('Video.Copy YouTube Link'),
        icon: ['fas', 'link']
      }
    case 'openYoutube':
      return {
        title: t('Video.Open in YouTube'),
        icon: ['fab', 'youtube']
      }
    case 'download':
      return process.env.IS_ELECTRON && enableDownloads.value
        ? {
            title: t('Downloads.Download Video'),
            icon: ['fas', 'download']
          }
        : null
    default:
      return null
  }
})

const inHistory = computed(() => {
  // When in the history page, showing relative dates isn't very useful.
  // We want to show the exact date instead
  return route.name === 'history'
})

const inSubscriptions = computed(() => route.name === 'subscriptions' || route.name === 'default')

const inUserPlaylist = computed(() => playlistTypeFinal.value === 'user' || selectedUserPlaylist.value != null)

/** @type {import('vue').ComputedRef<any>} */
const selectedUserPlaylist = computed(() => {
  if (playlistIdFinal.value == null || playlistIdFinal.value === '') { return null }

  return store.getters.getPlaylist(playlistIdFinal.value)
})

const progressPercentage = computed(() => {
  if (typeof lengthSeconds.value !== 'number' || lengthSeconds.value === 0) {
    return 0
  }

  if (isWatched.value) {
    return 100
  }

  const percentage = (Math.ceil(watchProgress.value) / lengthSeconds.value) * 100
  return Math.min(percentage, 100)
})

const thumbnailProgressRadius = computed(() => 8 * store.getters.getUiRoundness / 100)

/** @type {import('vue').ComputedRef<any[]>} */
const hiddenChannels = computed(() => store.getters.getChannelsHiddenParsed)

const playlistSharable = computed(() => {
  // `playlistId` can be undefined
  // User playlist ID should not be shared
  return playlistIdFinal.value && playlistIdFinal.value.length > 0 && !inUserPlaylist.value
})

/** @type {import('vue').ComputedRef<boolean>} */
const hideSharingActions = computed(() => store.getters.getHideSharingActions)

/** @type {import('vue').ComputedRef<boolean>} */
const showInvidiousShareOptions = computed(() => backendPreference.value === 'invidious' || store.getters.getBackendFallback)

const dropdownOptions = computed(() => {
  const options = [
    {
      label: t('Video.Play Next'),
      value: 'playNext',
      icon: ['fas', 'step-forward']
    },
    {
      label: t('Video.Add to Queue'),
      value: 'addToQueue',
      icon: ['fas', 'bars-progress']
    },
    {
      type: 'divider'
    },
    ...showMarkAsSeen.value
      ? [{
          label: t('Subscriptions.Mark as Seen'),
          value: 'markAsSeen',
          icon: ['fas', 'check']
        }]
      : [],
    ...canMarkAsWatched.value
      ? [{
          label: isWatched.value
            ? t('Video.Unmark As Watched')
            : t('Video.Mark As Watched'),
          value: 'history',
          icon: isWatched.value ? ['fas', 'eye-slash'] : ['fas', 'eye']
        }]
      : [],
    ...historyEntryExists.value
      ? [{
          label: t('Video.Remove From History'),
          value: 'removeHistory',
          icon: ['fas', 'trash']
        }]
      : [],
    ...(process.env.IS_ELECTRON && enableDownloads.value && !isUpcoming.value
      ? [{
          label: t('Downloads.Download Video'),
          value: 'download',
          icon: ['fas', 'download']
        }]
      : [])
  ]
  if (inUserPlaylist.value) {
    if (props.canMoveVideoUp || props.canMoveVideoDown) {
      options.push({ type: 'divider' })
    }
    if (props.canMoveVideoUp) {
      options.push({
        label: t('User Playlists.Move Video to the Top'),
        value: 'moveVideoTop',
        icon: ['fas', 'arrow-up']
      })
    }
    if (props.canMoveVideoDown) {
      options.push({
        label: t('User Playlists.Move Video to the Bottom'),
        value: 'moveVideoBottom',
        icon: ['fas', 'arrow-down']
      })
    }
  }
  if (!hideSharingActions.value) {
    options.push(
      {
        type: 'divider'
      },
      {
        label: t('Video.Copy YouTube Link'),
        value: 'copyYoutube',
        icon: ['fas', 'link']
      },
      {
        label: t('Video.Open in YouTube'),
        value: 'openYoutube',
        icon: ['fab', 'youtube']
      },
      {
        label: t('Video.Copy YouTube Embedded Player Link'),
        value: 'copyYoutubeEmbed',
        icon: ['fas', 'display']
      },
      {
        label: t('Video.Open YouTube Embedded Player'),
        value: 'openYoutubeEmbed',
        icon: ['fas', 'display']
      },
      ...showInvidiousShareOptions.value
        ? [
            {
              type: 'divider'
            },
            {
              label: t('Video.Copy Invidious Link'),
              value: 'copyInvidious',
              icon: ['fas', 'link']
            },
            {
              label: t('Video.Open in Invidious'),
              value: 'openInvidious',
              icon: ['fas', 'external-link-alt']
            }
          ]
        : [],
    )
    if (channelId.value !== null) {
      options.push(
        {
          type: 'divider'
        },
        {
          label: t('Video.Copy YouTube Channel Link'),
          value: 'copyYoutubeChannel',
          icon: ['fas', 'link']
        },
        {
          label: t('Video.Open Channel in YouTube'),
          value: 'openYoutubeChannel',
          icon: ['fab', 'youtube']
        },
        ...showInvidiousShareOptions.value
          ? [
              {
                type: 'divider'
              },
              {
                label: t('Video.Copy Invidious Channel Link'),
                value: 'copyInvidiousChannel',
                icon: ['fas', 'link']
              },
              {
                label: t('Video.Open Channel in Invidious'),
                value: 'openInvidiousChannel',
                icon: ['fas', 'external-link-alt']
              }
            ]
          : [],
      )
    }
  }

  if (channelId.value !== null && !inSubscriptions.value) {
    const channelShouldBeHidden = store.getters.getChannelsHiddenNames.has(channelId.value)

    options.push(
      {
        type: 'divider'
      },

      channelShouldBeHidden
        ? {
            label: t('Video.Unhide Channel'),
            value: 'unhideChannel',
            icon: ['fas', 'user-check']
          }
        : {
            label: t('Video.Hide Channel'),
            value: 'hideChannel',
            icon: ['fas', 'user-lock']
          }
    )
  }

  const normalizedOptions = []
  for (const option of options) {
    if (
      option.type === 'divider' &&
      (normalizedOptions.length === 0 || normalizedOptions.at(-1).type === 'divider')
    ) {
      continue
    }
    normalizedOptions.push(option)
  }
  if (normalizedOptions.at(-1)?.type === 'divider') {
    normalizedOptions.pop()
  }
  return normalizedOptions
})

function getLiveReminderPayload() {
  return {
    videoId: id.value,
    startTimestamp: premiereTimestamp.value,
    notificationTitle: t('Video.Scheduled video starting'),
    notificationBody: t('Video.Live notification body', { videoTitle: title.value })
  }
}

async function syncLiveReminder() {
  const generation = ++liveReminderLoadGeneration
  const videoId = id.value
  const startTimestamp = premiereTimestamp.value

  if (!canToggleLiveReminder.value) {
    liveReminderActive.value = false
    return
  }

  try {
    const reminder = await liveReminder.get(videoId)
    if (
      generation !== liveReminderLoadGeneration ||
      videoId !== id.value ||
      startTimestamp !== premiereTimestamp.value
    ) {
      return
    }

    if (reminder && reminder.startTimestamp !== startTimestamp) {
      liveReminderActive.value = await liveReminder.schedule(getLiveReminderPayload())
    } else {
      liveReminderActive.value = reminder !== null
    }
  } catch (error) {
    console.error('Failed to load live stream reminder', error)
  }
}

async function toggleLiveReminder() {
  if (liveReminderLoading.value || !canToggleLiveReminder.value) return

  const videoId = id.value
  liveReminderLoading.value = true
  try {
    if (liveReminderActive.value) {
      await liveReminder.cancel(videoId)
      if (videoId !== id.value) return
      liveReminderActive.value = false
      showToast({
        message: t('Video.Notification cancelled'),
        image: toastThumbnail.value,
        icon: ['fas', 'calendar-days']
      })
    } else {
      const scheduled = await liveReminder.schedule(getLiveReminderPayload())
      if (videoId !== id.value) return
      liveReminderActive.value = scheduled
      showToast({
        message: scheduled
          ? t('Video.Notification enabled')
          : t('Video.Notification unavailable'),
        image: toastThumbnail.value,
        icon: ['fas', 'calendar-days']
      })
    }
  } catch (error) {
    console.error('Failed to update live stream reminder', error)
    if (videoId === id.value) {
      showToast({
        message: t('Video.Notification unavailable'),
        image: toastThumbnail.value,
        icon: ['fas', 'calendar-days']
      })
    }
  } finally {
    if (videoId === id.value) {
      liveReminderLoading.value = false
    }
  }
}

function getYoutubeEmbedUrl() {
  return `https://www.youtube-nocookie.com/embed/${id.value}`
}

function getYoutubeChannelUrl() {
  return `https://youtube.com/channel/${channelId.value}`
}

function getInvidiousUrl() {
  const videoUrl = `${currentInvidiousInstanceUrl.value}/watch?v=${id.value}`
  // `playlistId` can be undefined
  if (playlistSharable.value) {
    // `index` seems can be ignored
    return videoUrl + `&list=${playlistIdFinal.value}`
  }
  return videoUrl
}

function getInvidiousChannelUrl() {
  return `${currentInvidiousInstanceUrl.value}/channel/${channelId.value}`
}

/**
 * @param {string} option
 */
function handleOptionsClick(option) {
  switch (option) {
    case 'playNext':
      addToWatchQueue(true)
      break
    case 'addToQueue':
      addToWatchQueue(false)
      break
    case 'markAsSeen':
      markSubscriptionVideoAsSeen()
      break
    case 'history':
      if (isWatched.value) {
        unmarkAsWatched()
      } else {
        markAsWatched()
      }
      break
    case 'removeHistory':
      removeFromHistory()
      break
    case 'moveVideoTop':
      emit('move-video-to-the-top', id.value, props.playlistItemId)
      break
    case 'moveVideoBottom':
      emit('move-video-to-the-bottom', id.value, props.playlistItemId)
      break
    case 'copyYoutube': {
      let videoUrl = `https://youtu.be/${id.value}`

      if (playlistSharable.value) {
        // `index` seems can be ignored
        videoUrl += `?list=${playlistIdFinal.value}`
      }

      copyToClipboard(videoUrl, { messageOnSuccess: t('Share.YouTube URL copied to clipboard') })
      break
    }
    case 'openYoutube': {
      let videoUrl = `https://www.youtube.com/watch?v=${id.value}`

      if (playlistSharable.value) {
        // `index` seems can be ignored
        videoUrl += `&list=${playlistIdFinal.value}`
      }

      openExternalLink(videoUrl)
      break
    }
    case 'copyYoutubeEmbed':
      copyToClipboard(getYoutubeEmbedUrl(), { messageOnSuccess: t('Share.YouTube Embed URL copied to clipboard') })
      break
    case 'openYoutubeEmbed':
      openExternalLink(getYoutubeEmbedUrl())
      break
    case 'copyInvidious':
      copyToClipboard(getInvidiousUrl(), { messageOnSuccess: t('Share.Invidious URL copied to clipboard') })
      break
    case 'openInvidious':
      openExternalLink(getInvidiousUrl())
      break
    case 'copyYoutubeChannel':
      copyToClipboard(getYoutubeChannelUrl(), { messageOnSuccess: t('Share.YouTube Channel URL copied to clipboard') })
      break
    case 'openYoutubeChannel':
      openExternalLink(getYoutubeChannelUrl())
      break
    case 'copyInvidiousChannel':
      copyToClipboard(getInvidiousChannelUrl(), { messageOnSuccess: t('Share.Invidious Channel URL copied to clipboard') })
      break
    case 'openInvidiousChannel':
      openExternalLink(getInvidiousChannelUrl())
      break
    case 'hideChannel':
      hideChannel(channelName.value, channelId.value)
      break
    case 'unhideChannel':
      unhideChannel(channelName.value, channelId.value)
      break
    case 'download':
      showDownloadPrompt.value = true
      break
  }
}

function addToWatchQueue(playNext) {
  store.commit('addVideoToWatchQueue', {
    video: deepCopy(props.data),
    playNext
  })
  showToast({
    message: playNext
      ? t('Video.Added to Play Next')
      : t('Video.Added to Queue'),
    image: toastThumbnail.value,
    icon: ['fas', 'list'],
  })
}

const thumbnail = computed(() => {
  if (thumbnailPreference.value === 'hidden') {
    return thumbnailPlaceholder
  }

  if (showDeArrowThumbnail.value && deArrowCache.value?.thumbnail != null) {
    return deArrowCache.value.thumbnail
  }

  if (props.appearance === 'youtubeShort') {
    return getShortThumbnailUrl(
      props.data,
      backendPreference.value,
      currentInvidiousInstanceUrl.value,
      thumbnailPreference.value
    ) ?? thumbnailPlaceholder
  }

  return getVideoThumbnailUrl(
    id.value,
    backendPreference.value,
    currentInvidiousInstanceUrl.value,
    thumbnailPreference.value
  ) ?? thumbnailPlaceholder
})

// The placeholder is fine in the list, but in a toast it would just be a grey
// box in place of the toast's fallback icon, so leave the image out instead
const toastThumbnail = computed(() => thumbnailPreference.value === 'hidden' ? null : thumbnail.value)

/** @type {import('vue').ComputedRef<boolean>} */
const hideVideoViews = computed(() => store.getters.getHideVideoViews)

/** @type {import('vue').ComputedRef<boolean>} */
const shortenViewCounts = computed(() => store.getters.getShortenViewCounts)

const parsedViewCount = computed(() => {
  if (props.data.viewCount != null) {
    return formatViewCount(props.data.viewCount, shortenViewCounts.value)
  }

  return props.data.viewCountText?.replace(' views', '') ?? ''
})

const addWatchedStyle = computed(() => {
  return isWatched.value && (!inHistory.value || props.showWatchedStyleInHistory)
})

/** @type {import('vue').ComputedRef<string>} */
const externalPlayer = computed(() => store.getters.getExternalPlayer)

/** @type {import('vue').ComputedRef<boolean>} */
const externalPlayerIsDefaultViewingMode = computed(() => {
  return process.env.IS_ELECTRON && externalPlayer.value !== '' && store.getters.getDefaultViewingMode === 'external_player'
})

/** @type {import('vue').ComputedRef<number>} */
const defaultPlayback = computed(() => store.getters.getDefaultPlayback)

const watchedProgressSavingEnabled = computed(() => {
  return ['auto', 'semi-auto'].includes(store.getters.getWatchedProgressSavingMode)
})

const watchedPercentageThreshold = computed(() => store.getters.getWatchedPercentageThreshold)

/** @type {import('vue').ComputedRef<boolean>} */
const rememberHistory = computed(() => store.getters.getRememberHistory)

/** @type {import('vue').ComputedRef<boolean>} */
const saveVideoHistoryWithLastViewedPlaylist = computed(() => store.getters.getSaveVideoHistoryWithLastViewedPlaylist)

/** @type {import('vue').ComputedRef<boolean>} */
const showDistractionFreeTitles = computed(() => store.getters.getShowDistractionFreeTitles)

const showNewSubscriptionFeedIndicator = computed(() => {
  return store.getters.getShowNewSubscriptionFeedIndicators &&
    props.data.isNewInSubscriptionFeed === true &&
    props.data.hideNewSubscriptionFeedIndicator !== true &&
    !isHistoryEntryWatched(historyEntry.value)
})

const showMarkAsSeen = computed(() => {
  return props.data.isNewInSubscriptionFeed === true &&
    (props.data.isInNewSubscriptionFeed === true || showNewSubscriptionFeedIndicator.value)
})

/** @type {import('vue').ComputedRef<string>} */
const displayTitle = computed(() => {
  let title_
  if (showDeArrowTitle.value && deArrowCache.value?.title) {
    title_ = deArrowCache.value.title
  } else {
    title_ = title.value
  }

  if (showDistractionFreeTitles.value) {
    return toDistractionFreeTitle(title_)
  } else {
    return title_
  }
})

const displayDuration = computed(() => {
  if (useDeArrowTitles.value && (duration.value === '' || duration.value === '0:00') && deArrowCache.value?.videoDuration) {
    return formatDurationAsTimestamp(deArrowCache.value.videoDuration)
  }

  return duration.value
})

const displayDurationLabel = computed(() => {
  if (isPremiere.value) return t('Video.Premiere')
  if (isLive.value) return t('Video.Live')
  if (isUpcoming.value) return t('Video.Upcoming')

  return displayDuration.value
})

/** @type {import('vue').ComputedRef<{ playlistId: string | undefined, playlistType: string | undefined, playlistItemId: string | undefined } | undefined>} */
const playlistIdTypePairFinal = computed(() => {
  if (props.playlistId) {
    return {
      playlistId: props.playlistId,
      playlistType: props.playlistType,
      playlistItemId: props.playlistItemId,
    }
  }

  // Get playlist ID from history ONLY if option enabled
  if (!props.showVideoWithLastViewedPlaylist || !saveVideoHistoryWithLastViewedPlaylist.value) {
    return
  }

  return {
    playlistId: historyEntry.value?.lastViewedPlaylistId,
    playlistType: historyEntry.value?.lastViewedPlaylistType,
    playlistItemId: historyEntry.value?.lastViewedPlaylistItemId,
  }
})

const playlistIdFinal = computed(() => playlistIdTypePairFinal.value?.playlistId)
const playlistTypeFinal = computed(() => playlistIdTypePairFinal.value?.playlistType)
const playlistItemIdFinal = computed(() => playlistIdTypePairFinal.value?.playlistItemId)

const quickBookmarkPlaylist = computed(() => store.getters.getQuickBookmarkPlaylist)
const isInAnyPlaylist = computed(() => store.getters.getPlaylistVideoCounts.has(id.value))

const isQuickBookmarkEnabled = computed(() => quickBookmarkPlaylist.value != null)
const quickBookmarkIcon = computed(() => store.getters.getQuickBookmarkIcon)

/** @type {import('vue').ComputedRef<boolean>} */
const isInQuickBookmarkPlaylist = computed(() => {
  if (!isQuickBookmarkEnabled.value) { return false }

  // Accessing a ref has a negligible amount of overhead,
  // however as we know that some users have playlists that have more than 10k items in them
  // it adds up quickly, especially as there are usually lots of FtListVideo instances active at the same time.
  // So create a temporary variable outside of the array, so we only have to do it once.
  // Also the search is retriggered every time any playlist is modified.
  const id_ = id.value

  return quickBookmarkPlaylist.value.videos.some((video) => {
    return video.videoId === id_
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

const playlistIconPadding = computed(() => props.appearance === 'watchPlaylistItem' ? 5 : 6)
const playlistIconSize = computed(() => props.appearance === 'watchPlaylistItem' ? 14 : 18)

const watchPageLinkQuery = computed(() => {
  const query = {}

  if (playlistIdFinal.value) {
    query.playlistId = playlistIdFinal.value
  }

  if (playlistTypeFinal.value) {
    query.playlistType = playlistTypeFinal.value
  }

  if (playlistItemIdFinal.value) {
    query.playlistItemId = playlistItemIdFinal.value
  }

  if (props.downloadId) {
    query.downloadId = props.downloadId
  }

  if (typeof props.data.isShort === 'boolean') {
    query.short = String(props.data.isShort)
  }

  if (props.data.isShort === true) {
    if (props.data.shortSource === 'channel' && props.data.shortChannelId) {
      query.shortSource = 'channel'
      query.shortChannelId = props.data.shortChannelId
    } else if (inSubscriptions.value) {
      query.shortSource = 'subscriptions'
    }
  }

  return query
})

const watchVideoRouterLink = computed(() => {
  // For `router-link` attribute `to`
  if (!externalPlayerIsDefaultViewingMode.value) {
    return {
      path: `/watch/${id.value}`,
      query: watchPageLinkQuery.value,
      state: { tabTitle: title.value },
    }
  } else {
    return {}
  }
})

/** @type {import('vue').ComputedRef<boolean>} */
const useDeArrowTitles = computed(() => store.getters.getUseDeArrowTitles)

/** @type {import('vue').ComputedRef<boolean>} */
const useDeArrowThumbnails = computed(() => store.getters.getUseDeArrowThumbnails)

const showDeArrowTitle = computed(() => useDeArrowTitles.value && !deArrowTogglePinned.value)
const showDeArrowThumbnail = computed(() => useDeArrowThumbnails.value && !deArrowTogglePinned.value)

const deArrowChangedContent = computed(() => {
  return (useDeArrowThumbnails.value && deArrowCache.value?.thumbnail) ||
      (useDeArrowTitles.value && deArrowCache.value?.title &&
        props.data.title.localeCompare(deArrowCache.value.title, undefined, { sensitivity: 'accent' }) !== 0)
})

const deArrowToggleTitle = computed(() => {
  return deArrowTogglePinned.value
    ? t('Video.DeArrow.Show Modified Details')
    : t('Video.DeArrow.Show Original Details')
})

const deArrowCache = computed(() => store.getters.getDeArrowCache[id.value])

const disableChannelLinks = computed(() => store.getters.getDisableChannelLinks)

const shouldShowChannelResolverButton = computed(() => !disableChannelLinks.value && channelName.value !== null && (
  !!props.data.hasCollaborators || channelId.value === null
))

async function handleWatchPageLinkClick(event) {
  // `auxclick` also fires for the right mouse button after `contextmenu`.
  // Treat only middle clicks as opening the video so a new-feed entry is not
  // marked as seen (and removed) while its context menu is open.
  if (event?.type === 'auxclick' && event.button !== 1) {
    return
  }

  markSubscriptionVideoAsSeen()

  if (externalPlayerIsDefaultViewingMode.value) {
    openInExternalPlayer()
    return
  }

  const opensActiveTab = process.env.IS_ELECTRON &&
    event?.button === 0 &&
    (event.ctrlKey || event.metaKey) &&
    !event.shiftKey &&
    !event.altKey

  if (opensActiveTab) {
    event.preventDefault()
    requestWatchPageViewTransition(event.currentTarget, {
      isShort: props.data.isShort === true && store.getters.getUseCustomShortsPlayer,
      allowVisiblePlayer: props.appearance === 'recommendation'
    })
    openInternalPath({
      path: `/watch/${id.value}`,
      query: watchPageLinkQuery.value,
      title: title.value,
      doCreateNewTab: true
    })
    return
  }

  if (process.env.IS_ELECTRON && event?.button === 1) {
    event.preventDefault()

    const openVideo = () => openInternalPath({
      path: `/watch/${id.value}`,
      query: watchPageLinkQuery.value,
      title: title.value,
      doCreateNewWindow: event.shiftKey,
      doCreateNewTab: !event.shiftKey,
      makeActive: false
    })

    if (event.shiftKey) {
      openVideo()
    } else {
      try {
        await morphThumbnailIntoNewTab(event.currentTarget, openVideo)
      } catch (error) {
        console.error('Failed to open the video in a new tab:', error)
      }
    }
    return
  }

  // Plain left click navigates in this tab: morph the thumbnail into the player
  if (event?.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
    requestWatchPageViewTransition(event.currentTarget, {
      isShort: props.data.isShort === true && store.getters.getUseCustomShortsPlayer,
      allowVisiblePlayer: props.appearance === 'recommendation'
    })
  }
}

function handleChannelLinkClick(event) {
  if (!process.env.IS_ELECTRON || event?.button !== 1 || channelId.value === null) {
    return
  }

  event.preventDefault()

  openInternalPath({
    path: `/channel/${channelId.value}`,
    title: channelName.value,
    doCreateNewWindow: event.shiftKey,
    doCreateNewTab: !event.shiftKey,
    makeActive: false
  })
}

async function fetchDeArrowThumbnail() {
  if (thumbnailPreference.value === 'hidden') { return }

  const videoId = id.value
  const thumbnail = await deArrowThumbnail(videoId, deArrowCache.value.thumbnailTimestamp)

  if (thumbnail) {
    const deArrowCacheClone = deepCopy(deArrowCache.value)
    deArrowCacheClone.thumbnail = thumbnail
    store.commit('addThumbnailToDeArrowCache', deArrowCacheClone)
  }
}

const debounceGetDeArrowThumbnail = debounce(fetchDeArrowThumbnail, 1000)

async function fetchDeArrowData() {
  const videoId = id.value
  const cacheData = { videoId, title: null, videoDuration: null, thumbnail: null, thumbnailTimestamp: null }

  const data = await deArrowData(videoId)

  if (Array.isArray(data?.titles) && data.titles.length > 0 && (data.titles[0].locked || data.titles[0].votes >= 0)) {
    // remove dearrow formatting markers https://github.com/ajayyy/DeArrow/blob/0da266485be902fe54259214c3cd7c942f2357c5/src/titles/titleFormatter.ts#L460
    cacheData.title = data.titles[0].title.replaceAll(/(^|\s)>(\S)/g, '$1$2').trim()
  }

  if (Array.isArray(data?.thumbnails) && data.thumbnails.length > 0 && (data.thumbnails[0].locked || data.thumbnails[0].votes >= 0)) {
    cacheData.thumbnailTimestamp = data.thumbnails[0].timestamp
  } else if (data?.videoDuration != null) {
    cacheData.thumbnailTimestamp = data.videoDuration * data.randomTime
  }

  cacheData.videoDuration = data?.videoDuration ? Math.floor(data.videoDuration) : null

  // Save data to cache whether data available or not to prevent duplicate requests
  store.commit('addVideoToDeArrowCache', cacheData)

  // fetch dearrow thumbnails if enabled
  if (showDeArrowThumbnail.value && deArrowCache.value?.thumbnail === null) {
    debounceGetDeArrowThumbnail()
  }
}

function toggleDeArrow() {
  if (!deArrowChangedContent.value) {
    return
  }

  deArrowTogglePinned.value = !deArrowTogglePinned.value
}

function markSubscriptionVideoAsSeen() {
  if (props.data.isNewInSubscriptionFeed === true && id.value) {
    store.dispatch('markSubscriptionVideoAsSeen', id.value)
  }
}

function handleExternalPlayer() {
  markSubscriptionVideoAsSeen()
  openInExternalPlayer()
}

function openInExternalPlayer() {
  emit('pause-player')

  const payload = {
    videoId: id.value,
    playlistId: playlistIdFinal.value,
    startTime: watchProgress.value,
    playbackRate: defaultPlayback.value,
    playlistIndex: props.playlistIndex,
    playlistReverse: props.playlistReverse,
    playlistShuffle: props.playlistShuffle,
    playlistLoop: props.playlistLoop,
  }
  // Only play video in non playlist mode when user playlist detected
  if (inUserPlaylist.value) {
    Object.assign(payload, {
      playlistId: null,
      playlistIndex: null,
      playlistReverse: null,
      playlistShuffle: null,
      playlistLoop: null,
    })
  }

  if (process.env.IS_ELECTRON) {
    window.ftElectron.openInExternalPlayer(payload)
  }

  if (rememberHistory.value && canMarkAsWatched.value) {
    markAsWatched()
  }
}

async function openChannelByline() {
  if (disableChannelLinks.value || isFetchingCollaborators.value) {
    return
  }

  if (channelCollaborators.value.length > 1) {
    showCollaboratorsPrompt.value = true
    return
  }

  isFetchingCollaborators.value = true
  setCollaboratorsLoading(true)
  const videoId = id.value

  try {
    const collaborators = await getLocalVideoChannels(videoId)

    if (id.value !== videoId || disableChannelLinks.value) {
      return
    }

    channelCollaborators.value = collaborators

    if (channelCollaborators.value.length > 1) {
      showCollaboratorsPrompt.value = true
    } else if (channelCollaborators.value.length === 1) {
      openInternalPath({ path: `/channel/${channelCollaborators.value[0].id}` })
    }
  } catch (error) {
    if (id.value === videoId) {
      console.error(`Failed to fetch collaborators for ${videoId}`, error)
      showToast({ message: t('Video.Failed to load collaborators'), icon: ['fas', 'circle-exclamation'] })
    }
  } finally {
    isFetchingCollaborators.value = false
    setCollaboratorsLoading(false)
  }
}

function handleExtraThumbnailAction() {
  handleOptionsClick(extraThumbnailAction.value)
}

function updateUploadedTime() {
  uploadedTime.value = ''
  uploadedTimeIsRelative.value = false
  published.value = undefined

  if (props.data.premiereDate !== undefined) {
    let premiereDate = props.data.premiereDate

    // premiereDate will be a string when the subscriptions are restored from the cache
    if (typeof premiereDate === 'string') {
      premiereDate = new Date(premiereDate)
    }
    uploadedTime.value = formatDateTime(
      premiereDate,
      locale.value,
      dateFormat.value,
      { year: 'numeric', month: 'numeric', day: 'numeric' },
      { hour: 'numeric', minute: '2-digit', second: '2-digit' },
      timeFormat.value
    )
    published.value = premiereDate.getTime()
  } else if (props.data.premiereTimestamp > 0) {
    const premiereDate = new Date(props.data.premiereTimestamp * 1000)
    uploadedTime.value = formatDateTime(
      premiereDate,
      locale.value,
      dateFormat.value,
      { year: 'numeric', month: 'numeric', day: 'numeric' },
      { hour: 'numeric', minute: '2-digit', second: '2-digit' },
      timeFormat.value
    )
    published.value = props.data.premiereTimestamp * 1000
  } else if (typeof props.data.published === 'number' && !isLive.value) {
    published.value = props.data.published

    if (inHistory.value) {
      uploadedTime.value = formatDate(
        props.data.published,
        locale.value,
        dateFormat.value,
        { year: 'numeric', month: 'numeric', day: 'numeric' }
      )
    } else {
      // Use 30 days per month, just like calculatePublishedDate
      uploadedTime.value = getRelativeTimeFromDate(props.data.published, false)
      uploadedTimeIsRelative.value = true
    }
  }
}

function parseVideoData() {
  relativeTimeDataLoadedAt.value = Date.now()
  relativeTimeClockAtLoad.value = relativeTimeNow.value
  id.value = props.data.videoId
  title.value = props.data.title

  if (store.getters.getAvoidTranslation === 'entire_app' && id.value) {
    const cachedTitle = getCachedOembedTitle(id.value)
    if (cachedTitle !== null) {
      title.value = cachedTitle
    } else {
      getOembedTitle(id.value).then((oembedTitle) => {
        if (oembedTitle) {
          title.value = oembedTitle
        }
      })
    }
  }

  channelName.value = props.data.author ?? null
  channelId.value = props.data.authorId ?? null
  channelCollaborators.value = props.data.collaborators ?? []

  if ((props.data.lengthSeconds === '' || props.data.lengthSeconds === '0:00') && historyEntryExists.value) {
    lengthSeconds.value = historyEntry.value.lengthSeconds
    duration.value = formatDurationAsTimestamp(historyEntry.value.lengthSeconds)
  } else {
    lengthSeconds.value = props.data.lengthSeconds
    duration.value = formatDurationAsTimestamp(props.data.lengthSeconds)
  }

  description.value = props.data.description
  isLive.value = props.data.isLive || props.data.liveNow || props.data.lengthSeconds === undefined
  isPremiere.value = props.data.isPremiere === true ||
    (isLive.value && props.data.premiereTimestamp > 0)
  isUpcoming.value = props.data.isUpcoming || props.data.premiere
  is4k.value = props.data.is4k
  is8k.value = props.data.is8k
  isNew.value = props.data.isNew
  isVr180.value = props.data.isVr180
  isVr360.value = props.data.isVr360
  is3D.value = props.data.is3d
  hasCaptions.value = props.data.hasCaptions
  isMembersOnly.value = props.data.isMembersOnly === true
  isPremium.value = props.data.premium || false
  viewCount.value = props.data.viewCount
  updateUploadedTime()

  hideViews.value = hideVideoViews.value ||
    (props.data.viewCount == null && props.data.viewCountText === undefined)
}

async function fetchSponsorBlockVideoLabel(videoId) {
  try {
    const label = await getSponsorBlockVideoLabel(videoId)
    if (useSponsorBlock.value && id.value === videoId) {
      sponsorBlockFullVideoCategory.value = label?.category ?? null
    }
  } catch {
    if (id.value === videoId) {
      sponsorBlockFullVideoCategory.value = null
    }
  }
}

function markAsWatched() {
  if (!canMarkAsWatched.value) {
    return
  }

  const videoData = {
    ...historyEntry.value,
    videoId: id.value,
    title: title.value,
    author: channelName.value,
    authorId: channelId.value,
    published: published.value,
    description: description.value,
    viewCount: viewCount.value,
    lengthSeconds: props.data.lengthSeconds,
    watchProgress: historyEntry.value?.watchProgress ?? 0,
    isWatched: true,
    timeWatched: historyEntry.value?.timeWatched ?? Date.now(),
    isLive: false,
    isUpcoming: false,
    isMembersOnly: isMembersOnly.value,
    type: 'video'
  }

  store.dispatch('updateHistory', videoData)

  showToast({
    message: t('Video.Video has been marked as watched'),
    image: toastThumbnail.value,
    icon: ['fas', 'eye'],
  })
}

async function unmarkAsWatched() {
  if (watchedPercentageThreshold.value === 0) {
    await store.dispatch('removeFromHistory', id.value)
  } else {
    await store.dispatch('updateHistory', {
      ...historyEntry.value,
      isWatched: false,
    })
  }

  showToast({
    message: t('Video.Video has been unmarked as watched'),
    image: toastThumbnail.value,
    icon: ['fas', 'eye-slash'],
  })
}

function removeFromHistory() {
  store.dispatch('removeFromHistory', id.value)

  showToast({
    message: t('Video.Video has been removed from your history'),
    image: toastThumbnail.value,
    icon: ['fas', 'trash'],
  })
}

// `description` and `viewCount` are intentionally left out,
// the store drops them from playlist entries as undesired attributes
const addToPlaylistVideoData = computed(() => ({
  videoId: id.value,
  title: title.value,
  author: channelName.value,
  authorId: channelId.value,
  lengthSeconds: props.data.lengthSeconds,
  published: published.value,
  premiereDate: props.data.premiereDate,
  premiereTimestamp: props.data.premiereTimestamp,
  isMembersOnly: isMembersOnly.value,
}))

/**
 * @param {string} channelName
 * @param {string} channelId
 */
function hideChannel(channelName, channelId) {
  const newHiddenChannels = [...hiddenChannels.value, { name: channelId, preferredName: channelName }]

  store.dispatch('updateChannelsHidden', JSON.stringify(newHiddenChannels))

  showToast({ message: t('Channel Hidden', { channel: channelName }), icon: ['fas', 'eye-slash'] })
}

/**
 * @param {string} channelName
 * @param {string} channelId
 */
function unhideChannel(channelName, channelId) {
  store.dispatch('updateChannelsHidden', JSON.stringify(hiddenChannels.value.filter(c => c.name !== channelId)))

  showToast({ message: t('Channel Unhidden', { channel: channelName }), icon: ['fas', 'eye'] })
}

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
    videoId: id.value,
    title: title.value,
    author: channelName.value,
    authorId: channelId.value,
    lengthSeconds: props.data.lengthSeconds,
    published: published.value,
    premiereDate: props.data.premiereDate,
    premiereTimestamp: props.data.premiereTimestamp,
    isMembersOnly: isMembersOnly.value,
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
    image: toastThumbnail.value,
    icon: ['fas', 'bookmark'],
  })
}

async function removeFromQuickBookmarkPlaylist() {
  const playlistName = quickBookmarkPlaylist.value.playlistName

  const removed = await store.dispatch('removeVideo', {
    _id: quickBookmarkPlaylist.value._id,
    // Remove all playlist items with same videoId
    videoId: id.value,
  })

  showToast({
    message: removed
      ? t('Video.Video has been removed from {playlistName}', { playlistName })
      : t('Video.There was a problem removing the video from {playlistName}', { playlistName }),
    image: toastThumbnail.value,
    icon: ['fas', 'trash'],
  })
}

function moveVideoUp() {
  emit('move-video-up', id.value, props.playlistItemId)
}

function moveVideoDown() {
  emit('move-video-down', id.value, props.playlistItemId)
}

function removeFromPlaylist() {
  emit('remove-from-playlist', id.value, props.playlistItemId)
}

/**
 * @param {DragEvent} event
 */
function onDragStart(event) {
  // Prevent drag event except links
  if (event.target.tagName !== 'A') {
    event.preventDefault()
    event.stopPropagation()
  }
}

watch(() => props.data, parseVideoData, { immediate: true })
watch([locale, dateFormat, timeFormat], updateUploadedTime)

watch([useDeArrowTitles, useDeArrowThumbnails], ([titles, thumbnails]) => {
  if (!titles && !thumbnails) deArrowTogglePinned.value = false
})

let fetchingDeArrowData = false
watch([showDeArrowTitle, showDeArrowThumbnail], async ([titles, thumbnails]) => {
  if (!titles && !thumbnails) return

  if (!deArrowCache.value) {
    if (fetchingDeArrowData) return
    fetchingDeArrowData = true
    try {
      await fetchDeArrowData()
    } finally {
      fetchingDeArrowData = false
    }
  } else if (thumbnails && deArrowCache.value.thumbnail == null) {
    debounceGetDeArrowThumbnail()
  }
}, { immediate: true })

watch(premiereTimestamp, schedulePremiereStartInvalidation, { immediate: true })
watch([id, premiereTimestamp], syncLiveReminder, { immediate: true })

onMounted(() => {
  removeLiveReminderUpdatedListener = liveReminder.onUpdated((videoId, scheduled) => {
    if (videoId === id.value) {
      liveReminderActive.value = scheduled
    }
  })
})

onBeforeUnmount(() => {
  resetThumbnailPreview()
  clearPremiereStartTimer()
  removeLiveReminderUpdatedListener?.()
})

watch([useSponsorBlock, id], ([enabled, videoId]) => {
  sponsorBlockFullVideoCategory.value = null
  if (enabled && videoId) {
    fetchSponsorBlockVideoLabel(videoId)
  }
}, { immediate: true })
</script>

<style scoped src="./FtListVideo.scss" lang="scss" />

<style>
body.collaboratorsLoading,
body.collaboratorsLoading * {
  cursor: wait !important;
}
</style>
