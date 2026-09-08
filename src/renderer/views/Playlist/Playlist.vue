<template>
  <div
    :class="{
      [listType]: true,
      playlistInEditMode,
      hasNoPlaylistDescription: !playlistDescription,
      oneOrFewer: shownVideoCount < 2
    }"
    class="playlistPage"
  >
    <FtLoader
      v-if="isLoading"
      :fullscreen="true"
    />
    <FtFlexBox
      v-else-if="playlistError"
      class="playlistErrorState"
    >
      <div class="errorStateContent">
        <p class="message">
          {{ playlistError }}
        </p>
        <FtButton
          v-if="playlistErrorRetryable"
          :label="t('User Playlists.SinglePlaylistView.Retry')"
          :icon="['fas', 'sync']"
          background-color="var(--primary-color)"
          text-color="var(--text-with-main-color)"
          @click="getPlaylistInfo"
        />
      </div>
    </FtFlexBox>
    <div
      v-if="!isLoading && !playlistError"
      class="playlistInfoContainer"
      :class="{
        promptOpen,
      }"
    >
      <PlaylistInfo
        :id="playlistId"
        :first-video-id="firstVideoId"
        :first-video-playlist-item-id="firstVideoPlaylistItemId"
        :playlist-thumbnail="playlistThumbnail"
        :title="playlistTitle"
        :channel-name="channelName"
        :channel-thumbnail="channelThumbnail"
        :channel-id="channelId"
        :last-updated="lastUpdated"
        :description="playlistDescription"
        :video-count="shownVideoCount"
        :videos="shownPlaylistItems"
        :sorted-videos="sortedPlaylistItems"
        :view-count="viewCount"
        :total-playlist-duration="totalPlaylistDuration"
        :is-duration-approximate="isDurationApproximate"
        :info-source="infoSource"
        :more-video-data-available="moreVideoDataAvailable"
        :is-playlist-bookmarked="isPlaylistBookmarked"
        :playlist-bookmark-pending="playlistBookmarkPending"
        :preload-available="playlistPreloadAvailable"
        :preload-pending="playlistPreloadPending"
        :preload-complete="playlistPreloadComplete"
        :search-video-mode-allowed="isUserPlaylistRequested && shownVideoCount > 1"
        :search-query-text="searchQueryTextRequested"
        :theme="listType === 'list' ? 'base' : 'top-bar'"
        class="playlistInfo"
        @dragstart.prevent
        @enter-edit-mode="playlistInEditMode = true"
        @exit-edit-mode="playlistInEditMode = false"
        @search-video-query-change="handleVideoSearchQueryChange"
        @prompt-open="promptOpen = true"
        @prompt-close="promptOpen = false"
        @toggle-playlist-bookmark="togglePlaylistBookmark"
        @preload-playlist="preloadPlaylist"
      />
    </div>

    <FtCard
      v-if="!isLoading && !playlistError"
      class="playlistItemsCard"
    >
      <FtFlexBox
        v-if="showUnavailableVideosAlert"
        class="alertBox"
      >
        <p class="alertLabel">
          {{ t("Playlist.Unavailable videos are hidden") }}
        </p>
        <button
          class="alertButton"
          :aria-label="t('Close')"
          :title="t('Close')"
          @click="handleCloseAlert"
        >
          <FtIcon
            :icon="['fas', 'xmark']"
            aria-hidden="true"
          />
        </button>
      </FtFlexBox>
      <template
        v-if="shownPlaylistItems.length > 0 || moreVideoDataAvailable"
      >
        <FtSelect
          v-if="isUserPlaylistRequested && shownPlaylistItems.length > 1"
          class="sortSelect"
          :value="sortOrder"
          :select-names="sortBySelectNames"
          :select-values="SORT_BY_SELECT_VALUES"
          :placeholder="t('Global.Sort By')"
          :icon="sortOrderIcon"
          @change="updateUserPlaylistSortOrder"
        />
        <AutoScrollWrapper
          v-if="visiblePlaylistItems.length > 0"
          :hot-zone-enabled="isSortOrderCustom && isVideoDragging"
        >
          <FtElementList
            v-if="listType === 'grid'"
            :data="visiblePlaylistItems"
            data-type="video"
            display="grid"
            :playlist-id="playlistId"
            :playlist-type="infoSource"
            :show-video-with-last-viewed-playlist="true"
            :use-channels-hidden-preference="false"
            :use-hide-upcoming-premieres-preference="false"
            :hide-forbidden-titles="false"
            :always-show-add-to-playlist-button="true"
            :quick-bookmark-button-enabled="quickBookmarkButtonEnabled"
            :can-move-video-up="canMoveVideos"
            :can-move-video-down="canMoveVideos"
            :playlist-items-length="shownPlaylistItems.length"
            :can-remove-from-playlist="true"
            :dragged-video="draggedVideo"
            :is-video-dragging="isVideoDragging"
            :video-dragging-possible="videoDraggingPossible"
            @drag-video="setDraggedVideo"
            @drag-video-end="onDragVideoEnd"
            @move-dragged-video="moveDraggedVideoTemporarilyThrottled"
            @move-video-up="moveVideoUp"
            @move-video-down="moveVideoDown"
            @move-video-to-the-top="moveVideoToTheTop"
            @move-video-to-the-bottom="moveVideoToTheBottom"
            @remove-from-playlist="removeVideoFromPlaylist"
          />
          <TransitionGroup
            v-else
            name="playlistItem"
            tag="span"
            class="playlistItems"
          >
            <FtListVideoNumbered
              v-for="(item, index) in visiblePlaylistItems"
              :key="`${item.videoId}-${item.playlistItemId || index}`"
              class="playlistItem"
              :data="item"
              :playlist-id="playlistId"
              :playlist-type="infoSource"
              :playlist-index="playlistInVideoSearchMode ? shownPlaylistItems.findIndex(i => i === item) : index"
              :playlist-item-id="item.playlistItemId"
              appearance="result"
              :always-show-add-to-playlist-button="true"
              :quick-bookmark-button-enabled="quickBookmarkButtonEnabled"
              :can-move-video-up="index > 0 && canMoveVideos"
              :can-move-video-down="index < shownPlaylistItems.length - 1 && canMoveVideos"
              :can-remove-from-playlist="true"
              :video-index="playlistInVideoSearchMode ? shownPlaylistItems.findIndex(i => i === item) : index"
              :initial-visible-state="index < 10"
              :dragged-video="draggedVideo"
              :is-sort-order-custom="isSortOrderCustom"
              :is-video-dragging="isVideoDragging"
              @drag-video="setDraggedVideo"
              @drag-video-end="onDragVideoEnd"
              @move-dragged-video="moveDraggedVideoTemporarilyThrottled"
              @move-video-up="moveVideoUp"
              @move-video-down="moveVideoDown"
              @move-video-to-the-top="moveVideoToTheTop"
              @move-video-to-the-bottom="moveVideoToTheBottom"
              @remove-from-playlist="removeVideoFromPlaylist"
            />
          </TransitionGroup>
        </AutoScrollWrapper>
        <FtFlexBox
          v-else-if="playlistInVideoSearchMode"
        >
          <p class="message">
            {{ t("User Playlists['Empty Search Message']") }}
          </p>
        </FtFlexBox>
        <FtFlexBox
          v-if="nextPageError && moreVideoDataAvailable && !isLoadingMore"
          class="paginationErrorState"
        >
          <div class="errorStateContent">
            <p class="message">
              {{ nextPageError }}
            </p>
            <FtButton
              :label="t('User Playlists.SinglePlaylistView.Retry')"
              :icon="['fas', 'sync']"
              background-color="var(--primary-color)"
              text-color="var(--text-with-main-color)"
              @click="getNextPage"
            />
          </div>
        </FtFlexBox>
        <FtAutoLoadNextPageWrapper
          v-else-if="moreVideoDataAvailable && !isLoadingMore"
          @load-next-page="getNextPage"
        >
          <FtFlexBox>
            <FtButton
              :label="t('Subscriptions.Load More Videos')"
              :icon="['fas', 'arrow-down']"
              background-color="var(--primary-color)"
              text-color="var(--text-with-main-color)"
              @click="getNextPage"
            />
          </FtFlexBox>
        </FtAutoLoadNextPageWrapper>
        <div
          v-if="isLoadingMore"
          class="loadNextPageWrapper"
        >
          <FtLoader />
        </div>
      </template>
      <FtFlexBox
        v-else
      >
        <p class="message">
          {{ t("User Playlists['This playlist currently has no videos.']") }}
        </p>
      </FtFlexBox>
    </FtCard>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { supportsYtDlp } from '../../helpers/ytDlpCapabilities'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { isNavigationFailure, NavigationFailureType, onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'

import FtLoader from '../../components/FtLoader/FtLoader.vue'
import FtCard from '../../components/ft-card/ft-card.vue'
import PlaylistInfo from '../../components/PlaylistInfo/PlaylistInfo.vue'
import FtListVideoNumbered from '../../components/FtListVideoNumbered/FtListVideoNumbered.vue'
import FtFlexBox from '../../components/ft-flex-box/ft-flex-box.vue'
import FtButton from '../../components/FtButton/FtButton.vue'
import FtElementList from '../../components/FtElementList/FtElementList.vue'
import FtSelect from '../../components/FtSelect/FtSelect.vue'
import FtAutoLoadNextPageWrapper from '../../components/FtAutoLoadNextPageWrapper.vue'
import AutoScrollWrapper from '../../components/AutoScrollWrapper/AutoScrollWrapper.vue'

import store from '../../store/index'

import {
  extractLocalCacheablePlaylistContinuation,
  getLocalPlaylist,
  getLocalPlaylistContinuation,
  parseLocalPlaylistVideos,
} from '../../helpers/api/local'
import {
  debounce,
  extractNumberFromString,
  getIconForSortPreference,
  getVideoThumbnailUrl,
  showToast,
  deepCopy,
  throttle,
} from '../../helpers/utils'
import { invidiousGetPlaylistInfo, youtubeImageUrlToInvidious } from '../../helpers/api/invidious'
import { hasMoreInvidiousPlaylistPages, mergeInvidiousPlaylistVideos } from '../../helpers/api/invidious-playlists'
import { runRetryablePlaylistRequest } from '../../helpers/playlist-pagination'
import { formatDate } from '../../helpers/dateFormat'
import {
  canonicalChannelAvatarUrl,
  canonicalPlaylistThumbnailUrl,
  createPlaylistBookmark,
} from '../../helpers/playlist-bookmarks'
import { fillMissingPlaylistVideoDurations, getSortedPlaylistItems, SORT_BY_VALUES } from '../../helpers/playlists'
import { hasConfiguredRestrictedPlaybackAuthentication } from '../../helpers/restricted-playback'
import {
  getYtDlpPlaybackSource,
  getYtDlpPlaybackSourcesUsableUntil,
  onYtDlpPlaybackSourceCacheChange,
  reserveYtDlpPlaybackSourceCache,
} from '../../helpers/player/ytDlpPlayback'
import { buildYtDlpPlaybackCacheKey, preloadYtDlpPlaybackSources } from '../../helpers/player/ytDlpPlaybackPreload'
import { startProgressBarOperation } from '../../helpers/progressBar'
import { MOBILE_WIDTH_THRESHOLD, PLAYLIST_HEIGHT_FORCE_LIST_THRESHOLD } from '../../../constants'
import { useTabContext, useTabLifecycle, useTabTitle } from '../../tabs/TabContext'
import { useTabToast } from '../../composables/useTabToast'

const { locale, t } = useI18n()
const route = useRoute()
const router = useRouter()
const { tabId } = useTabContext()
const playlistCacheTabId = tabId ?? 'web'
const setTabTitle = useTabTitle()
const showTabToast = useTabToast()

const isLoading = ref(true)
const playlistError = ref('')
const playlistErrorRetryable = ref(false)
const playlistTitle = ref('')
const playlistDescription = ref('')
const firstVideoId = ref('')
const firstVideoPlaylistItemId = ref('')
const playlistThumbnail = ref('')
const viewCount = ref(0)
const videoCount = ref(0)
/** @type {import('vue').Ref<string | undefined>} */
const lastUpdated = ref(undefined)
const lastUpdatedDate = ref(null)
const dateFormat = computed(() => store.getters.getDateFormat)

function updateLastUpdatedDate() {
  if (lastUpdatedDate.value === null) return

  lastUpdated.value = formatDate(lastUpdatedDate.value, locale.value, dateFormat.value, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

watch([locale, dateFormat], updateLastUpdatedDate)
const channelName = ref('')
const channelThumbnail = ref('')
const channelId = ref('')
const infoSource = ref('local')
const showUnavailableVideosAlert = ref(false)
const playlistItems = ref([])
/** @type {import('vue').ComputedRef<any[] | null>} */
const tempShownPlaylistItems = ref(null)
/** @import { VideoData } from '../../helpers/dragAndDrop' */
/** @import { Ref } from 'vue' */
/** @type {Ref<VideoData>} draggedVideo */
const draggedVideo = ref({ videoId: null, playlistItemId: null })
const userPlaylistVisibleLimit = ref(100)
/** @type {import('vue').ShallowRef<import('youtubei.js').YT.Playlist | null>} */
const continuationData = shallowRef(null)
/** @type {import('vue').Ref<number | null>} */
const nextInvidiousPlaylistPage = ref(null)
const isLoadingMore = ref(false)
const nextPageError = ref('')
const playlistInEditMode = ref(false)
const forceListView = ref(false)
let alreadyShownNotice = false
let fetchedLocalPlaylistItemCount = 0
let playlistRequestGeneration = 0
const videoSearchQuery = ref('')
const promptOpen = ref(false)
/** @type {import('vue').Ref<string[]>} */
const toBeDeletedPlaylistItemIds = ref([])
/** @type {import('vue').Ref<string[]>} */
const videosWithPlaylistToUnset = ref([])
const pendingDeletionRemovalInProgress = ref(false)
const playlistBookmarkPending = ref(false)
const playlistPreloadPending = ref(false)
const playlistPreloadComplete = ref(false)
let playlistPreloadExpiryTimer = null
let playlistPreloadRun = null
/** @type {AbortController | null} */
let undoToastAbortController = null
let removePendingVideosAfterDrag = false

/** @type {import('vue').ComputedRef<'local' | 'invidious'>} */
const backendPreference = computed(() => store.getters.getBackendPreference)

/** @type {import('vue').ComputedRef<boolean>} */
const backendFallback = computed(() => store.getters.getBackendFallback)

const playlistPreloadAvailable = computed(() => {
  return supportsYtDlp && store.getters.getVideoPlaybackEngine === 'yt-dlp'
})

const playlistPreloadVideoIds = computed(() => [...new Set(playlistItems.value
  .map(video => video.videoId)
  .filter(videoId => typeof videoId === 'string' && videoId !== ''))])
const playlistPreloadVideoIdsKey = computed(() => playlistPreloadVideoIds.value.join('\0'))
const ytDlpPlaybackCacheKey = computed(() => buildYtDlpPlaybackCacheKey(store.getters))
const ytDlpPlaybackUseAuthentication = computed(() =>
  store.getters.getYtDlpPlaybackAlwaysUseCookies &&
  hasConfiguredRestrictedPlaybackAuthentication(store.getters)
)

function clearPlaylistPreloadComplete() {
  clearTimeout(playlistPreloadExpiryTimer)
  playlistPreloadExpiryTimer = null
  playlistPreloadComplete.value = false
}

function refreshPlaylistPreloadComplete() {
  clearTimeout(playlistPreloadExpiryTimer)
  playlistPreloadExpiryTimer = null

  if (isLoading.value || playlistPreloadHasUnknownVideos.value) {
    playlistPreloadComplete.value = false
    return
  }

  const usableUntil = getYtDlpPlaybackSourcesUsableUntil(
    playlistPreloadVideoIds.value,
    ytDlpPlaybackCacheKey.value,
    ytDlpPlaybackUseAuthentication.value
  )
  playlistPreloadComplete.value = usableUntil !== null
  if (usableUntil === null) return

  const delay = Math.min(
    Math.max(usableUntil - Date.now() + 1, 0),
    2_147_483_647
  )
  playlistPreloadExpiryTimer = setTimeout(refreshPlaylistPreloadComplete, delay)
}

const removePlaybackSourceCacheChangeListener = onYtDlpPlaybackSourceCacheChange(() => {
  refreshPlaylistPreloadComplete()
})

/** @type {import('vue').ComputedRef<string>} */
const currentInvidiousInstanceUrl = computed(() => store.getters.getCurrentInvidiousInstanceUrl)

const thumbnailPreference = computed(() => store.getters.getThumbnailPreference)

/** @type {import('vue').ComputedRef<string>} */
const userPlaylistSortOrder = computed(() => store.getters.getUserPlaylistSortOrder)

const sortOrder = computed(() => isUserPlaylistRequested.value ? userPlaylistSortOrder.value : SORT_BY_VALUES.Custom)

const playlistId = computed(() => route.params.id)

const linkedPlaylistThumbnail = computed(() => {
  return typeof route.query.playlistThumbnail === 'string'
    ? route.query.playlistThumbnail
    : ''
})

/** @type {import('vue').ComputedRef<'grid' | 'list'>} */
const listType = computed(() => !forceListView.value ? store.getters.getPlaylistViewType : 'list')

/** @type {import('vue').ComputedRef<boolean>} */
const userPlaylistsReady = computed(() => store.getters.getPlaylistsReady)

const selectedUserPlaylist = computed(() => {
  const playlistId_ = playlistId.value

  if (
    !isUserPlaylistRequested.value ||
    playlistId_ == null ||
    playlistId_ === ''
  ) {
    return null
  }

  return store.getters.getPlaylist(playlistId_)
})

/** @type {import('vue').ComputedRef<number | undefined>} */
const selectedUserPlaylistLastUpdatedAt = computed(() => selectedUserPlaylist.value?.lastUpdatedAt)

/** @type {import('vue').ComputedRef<any[]>} */
const selectedUserPlaylistVideos = computed(() => selectedUserPlaylist.value?.videos ?? [])

const selectedUserPlaylistVideoCount = computed(() => selectedUserPlaylistVideos.value.length)

const moreVideoDataAvailable = computed(() => {
  if (isUserPlaylistRequested.value) {
    return userPlaylistVisibleLimit.value < sometimesFilteredUserPlaylistItems.value.length
  }
  if (infoSource.value === 'invidious') {
    return nextInvidiousPlaylistPage.value !== null
  }
  return continuationData.value !== null
})

const processedVideoSearchQuery = computed(() => videoSearchQuery.value.trim().toLowerCase())

const playlistInVideoSearchMode = computed(() => processedVideoSearchQuery.value !== '')

/** @type {import('vue').ComputedRef<string>} */
const searchQueryTextRequested = computed(() => route.query.searchQueryText ?? '')
const searchQueryTextPresent = computed(() => {
  const searchQueryText = searchQueryTextRequested.value
  return typeof searchQueryText === 'string' && searchQueryText !== ''
})

const isUserPlaylistRequested = computed(() => route.query.playlistType === 'user')

const playlistPreloadHasUnknownVideos = computed(() =>
  !isUserPlaylistRequested.value && (
    infoSource.value === 'invidious'
      ? nextInvidiousPlaylistPage.value !== null
      : continuationData.value !== null
  )
)

watch(
  [
    playlistPreloadVideoIdsKey,
    ytDlpPlaybackCacheKey,
    ytDlpPlaybackUseAuthentication,
    isLoading,
    playlistPreloadHasUnknownVideos,
  ],
  refreshPlaylistPreloadComplete
)

const isPlaylistBookmarked = computed(() => {
  return !isUserPlaylistRequested.value && store.getters.getPlaylistBookmark(playlistId.value) != null
})

async function refreshPlaylistBookmarkMetadata() {
  const bookmark = store.getters.getPlaylistBookmark(playlistId.value)
  if (bookmark == null) return

  const thumbnailUrl = playlistThumbnail.value || (firstVideoId.value
    ? `https://i.ytimg.com/vi/${firstVideoId.value}/mqdefault.jpg`
    : null)
  const canonicalThumbnailUrl = canonicalPlaylistThumbnailUrl(thumbnailUrl)
  const canonicalChannelAvatar = canonicalChannelAvatarUrl(channelThumbnail.value)
  const refreshedChannelId = channelId.value || playlistId.value
  const refreshedChannelName = channelName.value || playlistTitle.value
  if (
    bookmark.playlist.title === playlistTitle.value &&
    bookmark.playlist.description === playlistDescription.value &&
    bookmark.playlist.thumbnail_url === canonicalThumbnailUrl &&
    bookmark.playlist.video_count === videoCount.value &&
    bookmark.uploader.id === refreshedChannelId &&
    bookmark.uploader.name === refreshedChannelName &&
    bookmark.uploader.avatar === canonicalChannelAvatar
  ) return

  await store.dispatch('savePlaylistBookmark', {
    ...bookmark,
    playlist: {
      ...bookmark.playlist,
      title: playlistTitle.value,
      description: playlistDescription.value,
      thumbnail_url: canonicalThumbnailUrl,
      video_count: videoCount.value,
    },
    uploader: {
      ...bookmark.uploader,
      id: refreshedChannelId,
      name: refreshedChannelName,
      avatar: canonicalChannelAvatar,
    },
  })
}

async function togglePlaylistBookmark() {
  if (playlistBookmarkPending.value || isUserPlaylistRequested.value) return

  playlistBookmarkPending.value = true
  try {
    const saved = isPlaylistBookmarked.value
      ? await store.dispatch('removePlaylistBookmark', playlistId.value)
      : await store.dispatch('savePlaylistBookmark', createPlaylistBookmark({
          id: playlistId.value,
          title: playlistTitle.value,
          description: playlistDescription.value,
          thumbnailUrl: linkedPlaylistThumbnail.value || playlistThumbnail.value || (firstVideoId.value
            ? `https://i.ytimg.com/vi/${firstVideoId.value}/mqdefault.jpg`
            : null),
          videoCount: videoCount.value,
          uploaderId: channelId.value || playlistId.value,
          uploaderName: channelName.value || playlistTitle.value,
          uploaderAvatar: channelThumbnail.value,
        }))

    if (!saved) {
      showTabToast({
        message: t('User Playlists.SinglePlaylistView.Toast["There was an issue with updating this playlist."]'),
        icon: ['fas', 'circle-exclamation'],
      })
    }
  } finally {
    playlistBookmarkPending.value = false
  }
}

async function preloadPlaylist() {
  if (!playlistPreloadAvailable.value || playlistPreloadPending.value || playlistPreloadComplete.value) return

  const requestGeneration = playlistRequestGeneration
  playlistPreloadPending.value = true
  const progressOperation = startProgressBarOperation(store, {
    icon: ['fas', 'forward'],
    message: t('Playlist.Preloading Playlist'),
    percentage: 0,
  })
  const preloadRun = { progressOperation }
  playlistPreloadRun = preloadRun
  try {
    while (!isUserPlaylistRequested.value && moreVideoDataAvailable.value && nextPageError.value === '') {
      if (isLoadingMore.value) {
        await new Promise(resolve => {
          const stop = watch(isLoadingMore, loading => {
            if (!loading) {
              stop()
              resolve()
            }
          })
        })
        if (requestGeneration !== playlistRequestGeneration) return
        if (!moreVideoDataAvailable.value || nextPageError.value !== '') break
      }

      await getNextPage()
      if (requestGeneration !== playlistRequestGeneration) return
    }

    if (!isUserPlaylistRequested.value && moreVideoDataAvailable.value) {
      showTabToast({
        message: t('Playlist.Playlist Preload Pagination Failed'),
        icon: ['fas', 'circle-exclamation'],
      })
      return
    }

    const videoIds = playlistPreloadVideoIds.value
    progressOperation.update({
      message: t('Playlist.Playlist Preload Progress', {
        completed: 0,
        requested: videoIds.length,
      }),
    })
    reserveYtDlpPlaybackSourceCache(videoIds.length)

    const cacheKey = ytDlpPlaybackCacheKey.value
    const result = await preloadYtDlpPlaybackSources(videoIds, {
      concurrency: store.getters.getYtDlpPreloadConcurrency,
      loadSource: videoId => getYtDlpPlaybackSource(
        videoId,
        cacheKey,
        undefined,
        ytDlpPlaybackUseAuthentication.value,
        false,
        true
      ),
      onProgress: preloadProgress => {
        if (requestGeneration !== playlistRequestGeneration) return

        progressOperation.update({
          message: t('Playlist.Playlist Preload Progress', preloadProgress),
          percentage: preloadProgress.requested === 0
            ? 0
            : preloadProgress.completed / preloadProgress.requested * 100,
        })
      },
    })
    if (requestGeneration !== playlistRequestGeneration) return

    if (result.requested > 0 && result.failed === 0) {
      refreshPlaylistPreloadComplete()
    } else {
      clearPlaylistPreloadComplete()
    }

    showTabToast({
      message: result.failed === 0
        ? t('Playlist.Playlist Preload Complete', { count: result.preloaded })
        : t('Playlist.Playlist Preload Partial', result),
      icon: result.failed === 0 ? ['fas', 'check'] : ['fas', 'circle-exclamation'],
    })
  } finally {
    progressOperation.finish()
    if (playlistPreloadRun === preloadRun) {
      playlistPreloadRun = null
      playlistPreloadPending.value = false
    }
  }
}

function releasePlaylistPreloadUi() {
  if (playlistPreloadRun === null) return

  playlistPreloadRun.progressOperation.finish()
  playlistPreloadRun = null
  playlistPreloadPending.value = false
}

/** @type {import('vue').ComputedRef<string | undefined>} */
const quickBookmarkPlaylistId = computed(() => store.getters.getQuickBookmarkTargetPlaylistId)

const quickBookmarkButtonEnabled = computed(() => {
  if (selectedUserPlaylist.value == null) { return true }

  return selectedUserPlaylist.value?._id !== quickBookmarkPlaylistId.value
})

const sometimesFilteredUserPlaylistItems = computed(() => {
  if (!isUserPlaylistRequested.value || processedVideoSearchQuery.value === '') {
    return sortedPlaylistItems.value
  }

  const processedVideoSearchQuery_ = processedVideoSearchQuery.value

  return sortedPlaylistItems.value.filter((v) => {
    return (typeof v.title === 'string' && v.title.toLowerCase().includes(processedVideoSearchQuery_)) ||
      (typeof v.author === 'string' && v.author.toLowerCase().includes(processedVideoSearchQuery_))
  })
})

const isSortOrderCustom = computed(() => sortOrder.value === SORT_BY_VALUES.Custom)

const sortedPlaylistItems = computed(() => {
  if (
    sortOrder.value === SORT_BY_VALUES.VideoDurationAscending ||
    sortOrder.value === SORT_BY_VALUES.VideoDurationDescending
  ) {
    const playlistItems = getPlaylistItemsWithDuration()
    return getSortedPlaylistItems(playlistItems, sortOrder.value, locale.value)
  }
  return getSortedPlaylistItems(shownPlaylistItems.value, sortOrder.value, locale.value)
})

const visiblePlaylistItems = computed(() => {
  if (!isUserPlaylistRequested.value) {
    // No filtering for non user playlists yet
    return sortedPlaylistItems.value
  }

  if (userPlaylistVisibleLimit.value < sometimesFilteredUserPlaylistItems.value.length) {
    return sometimesFilteredUserPlaylistItems.value.slice(0, userPlaylistVisibleLimit.value)
  } else {
    return sometimesFilteredUserPlaylistItems.value
  }
})

const sortOrderIcon = computed(() => getIconForSortPreference(sortOrder.value))

const SORT_BY_SELECT_VALUES = Object.values(SORT_BY_VALUES)

const sortBySelectNames = computed(() => {
  return SORT_BY_SELECT_VALUES.map((k) => {
    switch (k) {
      case SORT_BY_VALUES.Custom:
        return t('Playlist.Sort By.Custom')
      case SORT_BY_VALUES.DateAddedNewest:
        return t('Playlist.Sort By.DateAddedNewest')
      case SORT_BY_VALUES.DateAddedOldest:
        return t('Playlist.Sort By.DateAddedOldest')
      case SORT_BY_VALUES.PublishedNewest:
        return t('Playlist.Sort By.PublishedNewest')
      case SORT_BY_VALUES.PublishedOldest:
        return t('Playlist.Sort By.PublishedOldest')
      case SORT_BY_VALUES.VideoTitleAscending:
        return t('Playlist.Sort By.VideoTitleAscending')
      case SORT_BY_VALUES.VideoTitleDescending:
        return t('Playlist.Sort By.VideoTitleDescending')
      case SORT_BY_VALUES.AuthorAscending:
        return t('Playlist.Sort By.AuthorAscending')
      case SORT_BY_VALUES.AuthorDescending:
        return t('Playlist.Sort By.AuthorDescending')
      case SORT_BY_VALUES.VideoDurationAscending:
        return t('Playlist.Sort By.VideoDurationAscending')
      case SORT_BY_VALUES.VideoDurationDescending:
        return t('Playlist.Sort By.VideoDurationDescending')
      default:
        console.error(`Unknown sort: ${k}`)
        return k
    }
  })
})

/**
 * @param {string} value
 */
function updateUserPlaylistSortOrder(value) {
  store.dispatch('updateUserPlaylistSortOrder', value)
}

/** @type {import('vue').ComputedRef<number>} */
const totalPlaylistDuration = computed(() => {
  return shownPlaylistItems.value.reduce((acc, video) => {
    return typeof video.lengthSeconds === 'number' ? acc + video.lengthSeconds : acc
  }, 0)
})

const isDurationApproximate = computed(() => {
  return shownPlaylistItems.value.some((video) => typeof video.lengthSeconds !== 'number')
})

const noPlaylistItemsPendingDeletion = computed(() => toBeDeletedPlaylistItemIds.value.length === 0)

const shownPlaylistItems = computed(() => {
  if (tempShownPlaylistItems.value != null) { return tempShownPlaylistItems.value }
  if (noPlaylistItemsPendingDeletion.value) {
    return playlistItems.value
  }

  const toBeDeletedPlaylistItemIds_ = toBeDeletedPlaylistItemIds.value
  return playlistItems.value.filter((v) => !toBeDeletedPlaylistItemIds_.includes(v.playlistItemId))
})

const shownPlaylistItemCount = computed(() => shownPlaylistItems.value)

const shownVideoCount = computed(() => isUserPlaylistRequested.value ? shownPlaylistItemCount.value.length : videoCount.value)

function getPlaylistInfo() {
  isLoading.value = true
  playlistError.value = ''
  playlistErrorRetryable.value = false
  nextPageError.value = ''

  if (isUserPlaylistRequested.value) {
    if (!userPlaylistsReady.value) { return }

    if (selectedUserPlaylist.value != null) {
      parseUserPlaylist(selectedUserPlaylist.value)
    } else {
      isLoading.value = false
      playlistError.value = t('User Playlists.SinglePlaylistView.Toast.This playlist does not exist')
      showTabToast({
        message: t('User Playlists.SinglePlaylistView.Toast.This playlist does not exist'),
        icon: ['fas', 'circle-exclamation'],
      })
    }
  } else {
    if (!process.env.SUPPORTS_LOCAL_API || backendPreference.value === 'invidious') {
      return getPlaylistInvidious()
    } else {
      return getPlaylistLocal()
    }
  }
}

const getPlaylistInfoDebounce = debounce(getPlaylistInfo, 100)

function resetState() {
  playlistRequestGeneration++
  releasePlaylistPreloadUi()
  clearPlaylistPreloadComplete()
  isLoading.value = true
  playlistTitle.value = ''
  playlistDescription.value = ''
  firstVideoId.value = ''
  playlistThumbnail.value = ''
  viewCount.value = 0
  videoCount.value = 0
  lastUpdated.value = undefined
  lastUpdatedDate.value = null
  channelName.value = ''
  channelThumbnail.value = ''
  channelId.value = ''
  infoSource.value = 'local'
  showUnavailableVideosAlert.value = false
  playlistItems.value = []
  continuationData.value = null
  nextInvidiousPlaylistPage.value = null
  isLoadingMore.value = false
  nextPageError.value = ''
  playlistError.value = ''
  playlistErrorRetryable.value = false
  fetchedLocalPlaylistItemCount = 0
}

async function getPlaylistLocal() {
  const requestGeneration = playlistRequestGeneration
  const requestedPlaylistId = playlistId.value
  const requestIsCurrent = () => requestGeneration === playlistRequestGeneration && requestedPlaylistId === playlistId.value

  try {
    const result = await getLocalPlaylist(requestedPlaylistId)
    if (!requestIsCurrent()) return

    let channelName_

    if (result.info.author) {
      channelName_ = result.info.author.name
    } else {
      const subtitle = result.info.subtitle?.toString()
      if (subtitle) {
        const index = subtitle.lastIndexOf('•')
        channelName_ = subtitle.substring(0, index).trim()
      } else {
        channelName_ = ''
      }
    }

    const playlistItems_ = parseLocalPlaylistVideos(result.items)
    fetchedLocalPlaylistItemCount = result.items.length

    playlistTitle.value = result.info.title
    playlistDescription.value = result.info.description ?? ''
    firstVideoId.value = playlistItems_[0]?.videoId ?? ''
    playlistThumbnail.value = result.info.thumbnails[0].url
    viewCount.value = result.info.views.toLowerCase() === 'no views' ? 0 : extractNumberFromString(result.info.views)
    videoCount.value = extractNumberFromString(result.info.total_items)
    lastUpdated.value = result.info.last_updated ?? ''
    lastUpdatedDate.value = null
    channelName.value = channelName_ ?? ''
    channelThumbnail.value = result.info.author?.best_thumbnail?.url ?? ''
    channelId.value = result.info.author?.id
    infoSource.value = 'local'
    showUnavailableVideosAlert.value = result.menu?.items?.some((item) => item.text === 'Show unavailable videos')

    store.dispatch('updateSubscriptionDetails', {
      channelThumbnailUrl: channelThumbnail.value,
      channelName: channelName_,
      channelId: channelId.value
    })

    playlistItems.value = playlistItems_

    await refreshPlaylistBookmarkMetadata()
    if (!requestIsCurrent()) return

    let shouldGetNextPage = false
    if (result.has_continuation) {
      continuationData.value = result
      shouldGetNextPage = playlistItems.value.length < 100 && fetchedLocalPlaylistItemCount < videoCount.value
    }
    // Fill the first page when unplayable entries were filtered out. The raw
    // item count bounds automatic continuation loading to the playlist size.
    if (shouldGetNextPage) {
      getNextPageLocal()
    }

    updatePageTitle()

    isLoading.value = false
  } catch (err) {
    if (!requestIsCurrent()) return

    console.error(err)

    if (backendPreference.value === 'local' && backendFallback.value) {
      console.warn('Falling back to Invidious API')
      return getPlaylistInvidious()
    } else {
      isLoading.value = false
      playlistError.value = t("User Playlists.SinglePlaylistView['This playlist could not be loaded.']")
      playlistErrorRetryable.value = true
    }
  }
}

async function getPlaylistInvidious() {
  const requestGeneration = playlistRequestGeneration
  const requestedPlaylistId = playlistId.value
  const requestIsCurrent = () => requestGeneration === playlistRequestGeneration && requestedPlaylistId === playlistId.value

  try {
    const result = await invidiousGetPlaylistInfo(requestedPlaylistId)
    if (!requestIsCurrent()) return

    playlistTitle.value = result.title
    playlistDescription.value = result.description
    firstVideoId.value = result.videos[0]?.videoId ?? ''
    viewCount.value = result.viewCount
    videoCount.value = result.videoCount
    channelName.value = result.author
    const authorThumbnail = result.authorThumbnails.at(-1)?.url ?? null
    channelThumbnail.value = youtubeImageUrlToInvidious(authorThumbnail, currentInvidiousInstanceUrl.value)
    channelId.value = result.authorId
    infoSource.value = 'invidious'

    store.dispatch('updateSubscriptionDetails', {
      channelThumbnailUrl: authorThumbnail,
      channelName: channelName.value,
      channelId: channelId.value
    })

    lastUpdatedDate.value = new Date(result.updated * 1000)
    updateLastUpdatedDate()

    playlistItems.value = result.videos
    await refreshPlaylistBookmarkMetadata()
    if (!requestIsCurrent()) return
    const hasMorePages = hasMoreInvidiousPlaylistPages(
      result.videoCount,
      1,
      result.videos.length,
      result.pageVideoCount
    )
    nextInvidiousPlaylistPage.value = hasMorePages
      ? 2
      : null

    updatePageTitle()

    isLoading.value = false
  } catch (err) {
    if (!requestIsCurrent()) return

    console.error(err)

    if (process.env.SUPPORTS_LOCAL_API && backendPreference.value === 'invidious' && backendFallback.value) {
      console.warn('Error getting data with Invidious, falling back to local backend')
      return getPlaylistLocal()
    } else {
      isLoading.value = false
      playlistError.value = t("User Playlists.SinglePlaylistView['This playlist could not be loaded.']")
      playlistErrorRetryable.value = true
    }
  }
}

function parseUserPlaylist(playlist) {
  playlistTitle.value = playlist.playlistName
  playlistDescription.value = playlist.description ?? ''

  if (playlist.videos.length > 0) {
    firstVideoId.value = playlist.videos[0].videoId
    firstVideoPlaylistItemId.value = playlist.videos[0].playlistItemId
  } else {
    firstVideoId.value = ''
    firstVideoPlaylistItemId.value = ''
  }

  lastUpdatedDate.value = new Date(playlist.lastUpdatedAt)
  updateLastUpdatedDate()
  viewCount.value = 0
  channelName.value = ''
  channelThumbnail.value = ''
  channelId.value = ''
  infoSource.value = 'user'

  playlistItems.value = playlist.videos

  updatePageTitle()

  isLoading.value = false
}

// react to route changes...
watch(playlistId, () => {
  resetState()
  getPlaylistInfoDebounce()
})

watch(userPlaylistsReady, () => {
  // Fetch from local store when playlist data ready
  if (!isUserPlaylistRequested.value) { return }

  getPlaylistInfoDebounce()
})

// Fetch from local store when current user playlist changed
watch(selectedUserPlaylist, () => {
  if (!isUserPlaylistRequested.value) { return }

  getPlaylistInfoDebounce()
})

// Re-fetch from local store when current user playlist updated
watch(selectedUserPlaylistLastUpdatedAt, () => {
  if (!isUserPlaylistRequested.value) { return }

  getPlaylistInfoDebounce()
})

watch(selectedUserPlaylistVideoCount, async () => {
  if (!isUserPlaylistRequested.value) { return }

  // Monitoring `selectedUserPlaylistVideos` makes this function called
  // Even when the same array object is returned
  // So length is monitored instead
  // Assuming in user playlist video cannot be swapped without length change

  // Re-fetch from local store when current user playlist videos updated
  // MUST NOT use `getPlaylistInfoDebounce` as it will cause delay in data update
  // Causing deleted videos to reappear for one frame
  getPlaylistInfo()
})

const historyCacheById = computed(() => store.getters.getHistoryCacheById)

function getPlaylistItemsWithDuration() {
  const modifiedPlaylistItems = deepCopy(shownPlaylistItems.value)
  const anyVideoMissingDuration = fillMissingPlaylistVideoDurations(
    modifiedPlaylistItems,
    historyCacheById.value
  )

  // Show notice if not already shown before returning playlist items
  if (anyVideoMissingDuration && !alreadyShownNotice) {
    showTabToast({
      message: t('User Playlists.SinglePlaylistView.Toast.This playlist has a video with a duration error'),
      time: 5000,
      icon: ['fas', 'circle-exclamation'],
    })
    alreadyShownNotice = true
  }

  return modifiedPlaylistItems
}

async function getNextPage() {
  if (isLoadingMore.value) return

  if (process.env.SUPPORTS_LOCAL_API && infoSource.value === 'local') {
    return await getNextPageLocal()
  } else if (infoSource.value === 'user') {
    // Stop users from spamming the load more button, by replacing it with a loading symbol until the newly added items are renderered
    isLoadingMore.value = true

    nextTick(() => {
      if (userPlaylistVisibleLimit.value + 100 < shownVideoCount.value) {
        userPlaylistVisibleLimit.value += 100
      } else {
        userPlaylistVisibleLimit.value = shownVideoCount.value
      }

      isLoadingMore.value = false
    })
  } else if (infoSource.value === 'invidious') {
    return await getNextPageInvidious()
  }
}

async function getNextPageLocal() {
  if (isLoadingMore.value || continuationData.value == null) return

  const requestGeneration = playlistRequestGeneration
  const requestedPlaylistId = playlistId.value
  const requestIsCurrent = () => requestGeneration === playlistRequestGeneration && requestedPlaylistId === playlistId.value

  await runRetryablePlaylistRequest({
    request: async () => {
      let shouldGetNextPage
      do {
        shouldGetNextPage = false
        const result = await getLocalPlaylistContinuation(continuationData.value)
        if (!requestIsCurrent()) return

        if (result) {
          const parsedVideos = parseLocalPlaylistVideos(result.items)
          fetchedLocalPlaylistItemCount += result.items.length
          playlistItems.value = playlistItems.value.concat(parsedVideos)

          if (result.has_continuation) {
            continuationData.value = result

            // Keep crossing pages that contain filtered entries until this page is
            // full or every advertised playlist item has been fetched.
            shouldGetNextPage = parsedVideos.length < 100 && fetchedLocalPlaylistItemCount < videoCount.value
          } else {
            continuationData.value = null
          }
        } else {
          continuationData.value = null
        }
      } while (shouldGetNextPage)
    },
    setLoading: (loading) => {
      if (requestIsCurrent()) {
        isLoadingMore.value = loading
      }
    },
    setError: (error) => {
      if (!requestIsCurrent()) return

      if (error == null) {
        nextPageError.value = ''
      } else {
        console.error(error)
        nextPageError.value = t("User Playlists.SinglePlaylistView['More videos could not be loaded.']")
      }
    },
  })
}

async function getNextPageInvidious() {
  if (isLoadingMore.value || nextInvidiousPlaylistPage.value == null) return

  const requestGeneration = playlistRequestGeneration
  const requestedPlaylistId = playlistId.value
  const requestedPage = nextInvidiousPlaylistPage.value
  const requestIsCurrent = () => requestGeneration === playlistRequestGeneration && requestedPlaylistId === playlistId.value

  await runRetryablePlaylistRequest({
    request: async () => {
      const result = await invidiousGetPlaylistInfo(requestedPlaylistId, requestedPage)
      if (!requestIsCurrent()) return

      const mergedVideos = mergeInvidiousPlaylistVideos(playlistItems.value, result.videos)
      playlistItems.value = mergedVideos
      firstVideoId.value ||= mergedVideos[0]?.videoId ?? ''
      const hasMorePages = hasMoreInvidiousPlaylistPages(
        videoCount.value,
        requestedPage,
        mergedVideos.length,
        result.pageVideoCount
      )
      nextInvidiousPlaylistPage.value = hasMorePages
        ? requestedPage + 1
        : null
    },
    setLoading: (loading) => {
      if (requestIsCurrent()) {
        isLoadingMore.value = loading
      }
    },
    setError: (error) => {
      if (!requestIsCurrent()) return

      if (error == null) {
        nextPageError.value = ''
      } else {
        console.error(error)
        nextPageError.value = t("User Playlists.SinglePlaylistView['More videos could not be loaded.']")
      }
    },
  })
}

const canMoveVideos = computed(() => {
  return isUserPlaylistRequested.value && !playlistInVideoSearchMode.value && isSortOrderCustom.value && !pendingDeletionRemovalInProgress.value
})

const videoDraggingPossible = computed(() => {
  return isUserPlaylistRequested.value && !playlistInVideoSearchMode.value && isSortOrderCustom.value &&
    !pendingDeletionRemovalInProgress.value && shownPlaylistItems.value.length >= 2
})

/**
 * @param {string} videoId
 * @param {string} playlistItemId
 */
function moveVideoUp(videoId, playlistItemId) {
  const playlistItems_ = playlistItems.value.slice()
  const shownIndex = shownPlaylistItems.value.findIndex((video) => {
    return video.videoId === videoId && video.playlistItemId === playlistItemId
  })

  if (shownIndex === -1) {
    return
  }

  if (shownIndex === 0) {
    showToast({
      message: t('User Playlists.SinglePlaylistView.Toast["This video cannot be moved up."]'),
      icon: ['fas', 'circle-exclamation'],
    })
    return
  }

  const previousPlaylistItemId = shownPlaylistItems.value[shownIndex - 1].playlistItemId
  const index = playlistItems_.findIndex(video => video.playlistItemId === playlistItemId)
  const previousIndex = playlistItems_.findIndex(video => video.playlistItemId === previousPlaylistItemId)
  const video = playlistItems_[index]

  playlistItems_[index] = playlistItems_[previousIndex]
  playlistItems_[previousIndex] = video

  const playlist = {
    playlistName: playlistTitle.value,
    protected: selectedUserPlaylist.value.protected,
    description: playlistDescription.value,
    videos: deepCopy(playlistItems_),
    _id: playlistId.value
  }

  try {
    store.dispatch('updatePlaylist', playlist)
    playlistItems.value = playlistItems_
  } catch (e) {
    showToast({
      message: t('User Playlists.SinglePlaylistView.Toast["There was an issue with updating this playlist."]'),
      icon: ['fas', 'circle-exclamation'],
    })
    console.error(e)
  }
}

/**
 * @param {string} videoId
 * @param {string} playlistItemId
 */
function moveVideoDown(videoId, playlistItemId) {
  const playlistItems_ = playlistItems.value.slice()
  const shownIndex = shownPlaylistItems.value.findIndex((video) => {
    return video.videoId === videoId && video.playlistItemId === playlistItemId
  })

  if (shownIndex === -1) {
    return
  }

  if (shownIndex + 1 >= shownPlaylistItems.value.length) {
    showToast({
      message: t('User Playlists.SinglePlaylistView.Toast["This video cannot be moved down."]'),
      icon: ['fas', 'circle-exclamation'],
    })
    return
  }

  const nextPlaylistItemId = shownPlaylistItems.value[shownIndex + 1].playlistItemId
  const index = playlistItems_.findIndex(video => video.playlistItemId === playlistItemId)
  const nextIndex = playlistItems_.findIndex(video => video.playlistItemId === nextPlaylistItemId)
  const video = playlistItems_[index]

  playlistItems_[index] = playlistItems_[nextIndex]
  playlistItems_[nextIndex] = video

  const playlist = {
    playlistName: playlistTitle.value,
    protected: selectedUserPlaylist.value.protected,
    description: playlistDescription.value,
    videos: deepCopy(playlistItems_),
    _id: playlistId.value
  }

  try {
    store.dispatch('updatePlaylist', playlist)
    playlistItems.value = playlistItems_
  } catch (e) {
    showToast({
      message: t('User Playlists.SinglePlaylistView.Toast["There was an issue with updating this playlist."]'),
      icon: ['fas', 'circle-exclamation'],
    })
    console.error(e)
  }
}

/**
 * @param {string} videoId
 * @param {string} playlistItemId
 */
function moveVideoToTheTop(videoId, playlistItemId) {
  const playlistItems_ = playlistItems.value.slice()

  const index = playlistItems_.findIndex((video) => {
    return video.videoId === videoId && video.playlistItemId === playlistItemId
  })

  if (index === -1) {
    return
  }

  if (index === 0) {
    showToast(t('User Playlists.SinglePlaylistView.Toast["This video cannot be moved up."]'))
    return
  }

  const videoObject = playlistItems_[index]
  playlistItems_.splice(index, 1)
  playlistItems_.unshift(videoObject)

  const playlist = {
    playlistName: playlistTitle.value,
    protected: selectedUserPlaylist.value.protected,
    description: playlistDescription.value,
    videos: deepCopy(playlistItems_),
    _id: playlistId.value
  }

  try {
    store.dispatch('updatePlaylist', playlist)
    playlistItems.value = playlistItems_
  } catch (e) {
    showToast(t('User Playlists.SinglePlaylistView.Toast["There was an issue with updating this playlist."]'))
    console.error(e)
  }
}

/**
 * @param {string} videoId
 * @param {string} playlistItemId
 */
function moveVideoToTheBottom(videoId, playlistItemId) {
  const playlistItems_ = playlistItems.value.slice()

  const index = playlistItems_.findIndex((video) => {
    return video.videoId === videoId && video.playlistItemId === playlistItemId
  })

  if (index === -1) {
    return
  }

  if (index === playlistItems_.length - 1) {
    showToast(t('User Playlists.SinglePlaylistView.Toast["This video cannot be moved down."]'))
    return
  }

  const videoObject = playlistItems_[index]
  playlistItems_.splice(index, 1)
  playlistItems_.push(videoObject)

  const playlist = {
    playlistName: playlistTitle.value,
    protected: selectedUserPlaylist.value.protected,
    description: playlistDescription.value,
    videos: deepCopy(playlistItems_),
    _id: playlistId.value
  }

  try {
    store.dispatch('updatePlaylist', playlist)
    playlistItems.value = playlistItems_
  } catch (e) {
    showToast(t('User Playlists.SinglePlaylistView.Toast["There was an issue with updating this playlist."]'))
    console.error(e)
  }
}

/**
 * @param {VideoData} video
 */
function setDraggedVideo(video) {
  draggedVideo.value = video
}

async function onDragVideoEnd() {
  if (tempShownPlaylistItems.value != null) {
    // Save on drag end ONLY
    const playlist = {
      playlistName: playlistTitle.value,
      protected: selectedUserPlaylist.value.protected,
      description: playlistDescription.value,
      // Save whatever is shown
      videos: deepCopy(tempShownPlaylistItems.value),
      _id: playlistId.value
    }

    try {
      await store.dispatch('updatePlaylist', playlist)
      playlistItems.value = tempShownPlaylistItems.value
    } catch (e) {
      showToast({
        message: t('User Playlists.SinglePlaylistView.Toast["There was an issue with updating this playlist."]'),
        icon: ['fas', 'circle-exclamation'],
      })
      console.error(e)
    }
  }

  // Cleanup
  tempShownPlaylistItems.value = null

  // Unset dragged video
  setDraggedVideo({
    videoId: null,
    playlistItemId: null,
  })

  if (removePendingVideosAfterDrag) {
    removePendingVideosAfterDrag = false
    await removeToBeDeletedVideosSometimes()
  }
}

/** @type {import('vue').ComputedRef<boolean>} */
const isVideoDragging = computed(() => {
  const { videoId, playlistItemId } = draggedVideo.value

  return videoId != null && playlistItemId != null
})

function moveDraggedVideoTemporarily({ videoId, playlistItemId }, { videoId: droppedVideoId, playlistItemId: droppedPlaylistItemId }) {
  // To ensure we can drag an item back to its original position in a single drag (i.e. no change), the temp items should be used
  const playlistItems_ = tempShownPlaylistItems.value != null ? tempShownPlaylistItems.value.slice() : playlistItems.value.slice()

  const draggedOverIndex = playlistItems_.findIndex((video) => {
    return video.videoId === videoId && video.playlistItemId === playlistItemId
  })

  const droppedVideoOriginalIndex = playlistItems_.findIndex((video) => {
    return video.videoId === droppedVideoId && video.playlistItemId === droppedPlaylistItemId
  })

  const playlistItemToBeMoved = playlistItems_.splice(droppedVideoOriginalIndex, 1)[0]
  playlistItems_.splice(draggedOverIndex, 0, playlistItemToBeMoved)

  tempShownPlaylistItems.value = playlistItems_
}

// Only fire once per 100ms to prevent items moving up and down repeatedly during transition
// 100ms is manually tested value (50ms won't work)
const moveDraggedVideoTemporarilyThrottled = throttle(moveDraggedVideoTemporarily, 100)

/**
 * @param {string} videoId
 * @param {string} playlistItemId
 */
function removeVideoFromPlaylist(videoId, playlistItemId) {
  try {
    const foundVideo = playlistItems.value.some((video) => {
      return video.videoId === videoId && video.playlistItemId === playlistItemId
    })

    if (foundVideo) {
      toBeDeletedPlaylistItemIds.value.push(playlistItemId)
      videosWithPlaylistToUnset.value.push(videoId)

      // Only show toast when no existing toast shown
      if (undoToastAbortController == null) {
        undoToastAbortController = new AbortController()

        const timeoutMs = 5000
        const actualRemoveVideosTimeout = setTimeout(() => {
          removeToBeDeletedVideosSometimes()
        }, timeoutMs)

        showToast({
          message: t('User Playlists.SinglePlaylistView.Toast["Video has been removed. Click here to undo."]'),
          time: timeoutMs,
          action: () => {
            clearTimeout(actualRemoveVideosTimeout)
            toBeDeletedPlaylistItemIds.value = []
            videosWithPlaylistToUnset.value = []
            undoToastAbortController = null
          },
          abortSignal: undoToastAbortController.signal,
          image: getVideoThumbnailUrl(videoId, backendPreference.value, currentInvidiousInstanceUrl.value, thumbnailPreference.value),
          icon: ['fas', 'trash'],
        })
      }
    }
  } catch (e) {
    showToast({
      message: t('User Playlists.SinglePlaylistView.Toast.There was a problem with removing this video'),
      icon: ['fas', 'circle-exclamation'],
    })
    console.error(e)
  }
}

async function removeToBeDeletedVideosSometimes() {
  if (isLoading.value) { return }
  if (isVideoDragging.value) {
    removePendingVideosAfterDrag = true
    return
  }

  if (toBeDeletedPlaylistItemIds.value.length > 0) {
    pendingDeletionRemovalInProgress.value = true

    try {
      await store.dispatch('removeVideos', {
        _id: playlistId.value,
        // Create a new non-reactive array to avoid Electron erroring about Proxy objects not being clonable
        playlistItemIds: [...toBeDeletedPlaylistItemIds.value],
        videoIds: [...videosWithPlaylistToUnset.value],
      })
    } catch (e) {
      showToast({
        message: t('User Playlists.SinglePlaylistView.Toast.There was a problem with removing this video'),
        icon: ['fas', 'circle-exclamation'],
      })
      console.error(e)
    } finally {
      pendingDeletionRemovalInProgress.value = false
      toBeDeletedPlaylistItemIds.value = []
      videosWithPlaylistToUnset.value = []
      undoToastAbortController?.abort()
      undoToastAbortController = null
    }
  }
}

function updatePageTitle() {
  const playlistTitle_ = playlistTitle.value
  const channelName_ = channelName.value

  let titleText = ''

  if (playlistTitle_) {
    titleText = playlistTitle_
  }

  if (channelName_) {
    if (titleText.length > 0) {
      titleText += ` | ${channelName_}`
    } else {
      titleText = channelName_
    }
  }

  setTabTitle(titleText)
}

/**
 * @param {string} value
 */
function handleVideoSearchQueryChange(value) {
  videoSearchQuery.value = value

  saveStateInRouter(value)
}

/**
 * @param {string} query
 */
async function saveStateInRouter(query) {
  const routeQuery = {
    playlistType: route.query.playlistType,
  }

  if (query !== '') {
    routeQuery.searchQueryText = query
  }

  try {
    await router.replace({
      path: `/playlist/${playlistId.value}`,
      query: routeQuery,
    })
  } catch (failure) {
    if (isNavigationFailure(failure, NavigationFailureType.duplicated)) {
      return
    }

    throw failure
  }
}

if (isUserPlaylistRequested.value && searchQueryTextPresent.value) {
  handleVideoSearchQueryChange(searchQueryTextRequested.value)
}

function handleResize() {
  forceListView.value = window.innerWidth <= MOBILE_WIDTH_THRESHOLD || window.innerHeight <= PLAYLIST_HEIGHT_FORCE_LIST_THRESHOLD
}

function handleCloseAlert() {
  showUnavailableVideosAlert.value = false
}

onMounted(() => {
  getPlaylistInfoDebounce()
  handleResize()
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  playlistRequestGeneration++
  releasePlaylistPreloadUi()
  clearPlaylistPreloadComplete()
  removePlaybackSourceCacheChangeListener()
  window.removeEventListener('resize', handleResize)
})

// Cache the playlist only when transitioning to one of its videos, so returning
// from the watch page can reuse it without a refetch.
function cachePlaylistForWatchTransition(to) {
  if (!isLoading.value && to.path.startsWith('/watch') && to.query.playlistId === playlistId.value) {
    store.commit('setCachedPlaylist', {
      tabId: playlistCacheTabId,
      value: {
        id: playlistId.value,
        title: playlistTitle.value,
        totalVideoCount: videoCount.value,
        channelName: channelName.value,
        channelId: channelId.value,
        items: sortedPlaylistItems.value,
        continuationData: continuationData.value
          ? extractLocalCacheablePlaylistContinuation(continuationData.value)
          : null,
      }
    })
  }
}

// A query-only router.replace (e.g. updating the search query) keeps us on this
// same playlist route and must not flush pending deletions before the undo
// window elapses.
function isDepartureFromThisPlaylist(to) {
  return to.path !== `/playlist/${playlistId.value}`
}

useTabLifecycle({
  beforeNavigate: ({ to }) => {
    cachePlaylistForWatchTransition(to)

    if (isDepartureFromThisPlaylist(to)) {
      removeToBeDeletedVideosSometimes()
    }
  },
  beforeDispose: removeToBeDeletedVideosSometimes
})

// Fallback for browser navigation (web build) where no logical tab context
// exists, so useTabLifecycle is a no-op. vue-router only runs leave guards on
// actual route-record departures, so query-only replaces are already excluded.
if (!tabId) {
  onBeforeRouteLeave((to) => {
    cachePlaylistForWatchTransition(to)
    removeToBeDeletedVideosSometimes()
  })
}
</script>

<style scoped src="./Playlist.scss" lang="scss" />
