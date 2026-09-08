<template>
  <FtCard
    class="relative"
    :class="{ fullscreenPlaylist: fullscreenOverlay, isCollapsed: playlistCollapsed }"
  >
    <FtLoader
      v-if="isLoading"
    />
    <template v-else>
      <header
        v-if="fullscreenOverlay"
        class="playlistDockHeader"
      >
        <FtIcon :icon="['fas', 'list']" />
        <h3
          dir="auto"
          :title="playlistTitle"
        >
          {{ playlistTitle }}
        </h3>
        <button
          type="button"
          class="playlistDockClose"
          :aria-label="t('Playlist.Close Playlist')"
          :title="t('Playlist.Close Playlist')"
          @click="emit('close')"
        >
          <FtIcon :icon="['fas', 'xmark']" />
        </button>
      </header>
      <div
        v-overlay-scrollbars="fullscreenOverlay"
        :class="{ fullscreenPlaylistContent: fullscreenOverlay }"
      >
        <div class="playlistHeader">
          <div
            v-if="!fullscreenOverlay"
            class="playlistTitleRow"
          >
            <h3
              class="playlistTitle"
              :title="playlistTitle"
            >
              <RouterLink
                class="playlistTitleLink"
                dir="auto"
                :to="playlistPageLinkTo"
              >
                {{ playlistTitle }}
              </RouterLink>
            </h3>
            <button
              class="playlistButton playlistCollapseButton"
              :aria-label="playlistCollapsed ? t('Video.Expand Playlist') : t('Video.Collapse Playlist')"
              :aria-expanded="!playlistCollapsed"
              :title="playlistCollapsed ? t('Video.Expand Playlist') : t('Video.Collapse Playlist')"
              @click="toggleCollapse"
            >
              <FtIcon
                class="playlistIcon"
                :icon="['fas', playlistCollapsed ? 'angle-down' : 'angle-up']"
              />
            </button>
          </div>
          <template
            v-if="!playlistCollapsed && channelName !== ''"
          >
            <RouterLink
              v-if="channelId"
              class="channelName"
              dir="auto"
              :to="`/channel/${channelId}`"
            >
              {{ channelName }} -
            </RouterLink>
            <bdi
              v-else
              class="channelName"
            >
              {{ channelName }} -
            </bdi>
          </template>
          <span
            class="playlistIndex"
            :class="{ isCollapsed: playlistCollapsed }"
          >
            <label for="playlistProgressBar">
              {{ currentVideoIndexOneBased }} / {{ playlistVideoCount }}
            </label>

            <!-- eslint-disable vuejs-accessibility/mouse-events-have-key-events, vuejs-accessibility/click-events-have-key-events -->
            <div
              v-if="!playlistCollapsed && !shuffleEnabled && !reversePlaylist"
              class="playlistProgressBarContainer"
              @mouseenter="showProgressBarPreview = true"
              @mouseleave="showProgressBarPreview = false"
              @mousemove="updateProgressBarPreview"
            >
              <div
                ref="playlistProgressBar"
                class="playlistProgressBar"
                :class="{ expanded: showProgressBarPreview }"
                @click="handleProgressBarClick"
              >
                <div
                  class="playlistProgressBarFill"
                  :style="{ width: (currentVideoIndexOneBased / playlistVideoCount) * 100 + '%' }"
                />
                <div
                  v-if="showProgressBarPreview"
                  ref="progressBarPreview"
                  class="progressBarPreview"
                  :style="previewStyle"
                >
                  <div class="previewTooltip">
                    <img
                      v-if="previewVideoThumbnail"
                      :src="previewVideoThumbnail"
                      alt=""
                      class="previewThumbnail"
                    >
                    <div class="previewText">
                      {{ previewVideoIndex }} / {{ playlistVideoCount }}
                    </div>
                    <div
                      class="previewVideoTitle"
                      dir="auto"
                    >{{ previewVideoTitle }}</div>
                  </div>
                </div>
              </div>
            </div>
          </span>
          <div
            v-show="!playlistCollapsed"
            class="playlistButtons"
          >
            <button
              class="playlistButton"
              :class="{ playlistButtonActive: loopEnabled }"
              :aria-label="t('Video.Loop Playlist')"
              :aria-pressed="loopEnabled"
              :title="t('Video.Loop Playlist')"
              @click="toggleLoop"
            >
              <FtIcon
                class="playlistIcon"
                :icon="['fas', 'retweet']"
              />
            </button>
            <button
              class="playlistButton"
              :class="{ playlistButtonActive: shuffleEnabled }"
              :aria-label="t('Video.Shuffle Playlist')"
              :aria-pressed="shuffleEnabled"
              :title="t('Video.Shuffle Playlist')"
              @click="toggleShuffle"
            >
              <FtIcon
                class="playlistIcon"
                :icon="['fas', 'random']"
              />
            </button>
            <button
              class="playlistButton"
              :class="{ playlistButtonActive: reversePlaylist }"
              :aria-label="t('Video.Reverse Playlist')"
              :aria-pressed="reversePlaylist"
              :title="t('Video.Reverse Playlist')"
              @click="toggleReversePlaylist"
            >
              <FtIcon
                class="playlistIcon"
                :icon="['fas', 'exchange-alt']"
              />
            </button>
            <button
              v-if="userPlaylistWatchedVideoCount > 0"
              class="playlistButton"
              :aria-label="t('User Playlists.Remove Watched Videos')"
              :title="t('User Playlists.Remove Watched Videos')"
              @click="showRemoveWatchedVideosPrompt = true"
            >
              <FtIcon
                class="playlistIcon"
                :icon="['fas', 'eye-slash']"
              />
            </button>
          </div>
        </div>
        <component
          :is="playlistItemsWrapperComponent"
          v-if="!isLoading"
          v-show="!playlistCollapsed"
          ref="playlistItemsWrapper"
          v-overlay-scrollbars
          :name="animatePlaylistItems ? 'playlistItem' : undefined"
          :tag="animatePlaylistItems ? 'div' : undefined"
          class="playlistItemsWrapper"
        >
          <FtListVideoNumbered
            v-for="(item, index) in playlistItems"
            :key="item.playlistItemId || item.videoId"
            ref="playlistItem"
            class="playlistItem"
            :data="item"
            :playlist-id="playlistId"
            :playlist-type="playlistType"
            :playlist-index="reversePlaylist ? playlistItems.length - index - 1 : index"
            :playlist-item-id="item.playlistItemId"
            :download-id="downloadId"
            :playlist-reverse="reversePlaylist"
            :playlist-shuffle="shuffleEnabled"
            :playlist-loop="loopEnabled"
            :video-index="index"
            :is-current-video="currentVideoIndexZeroBased === index"
            :can-move-video-up="index > 0 && canMoveVideos"
            :can-move-video-down="index < playlistItems.length - 1 && canMoveVideos"
            :can-remove-from-playlist="isUserPlaylist"
            :quick-bookmark-button-enabled="quickBookmarkButtonEnabled"
            :dragged-video="draggedVideo"
            :is-sort-order-custom="isSortOrderCustom"
            :is-video-dragging="isVideoDragging"
            appearance="watchPlaylistItem"
            :initial-visible-state="index < (currentVideoIndexZeroBased + 4) && index > (currentVideoIndexZeroBased - 4)"
            @drag-video="setDraggedVideo"
            @drag-video-end="onDragVideoEnd"
            @move-dragged-video="moveDraggedVideoTemporarilyThrottled"
            @move-video-up="moveVideoUp"
            @move-video-down="moveVideoDown"
            @remove-from-playlist="removeVideoFromPlaylist"
            @pause-player="pausePlayer"
          />
        </component>
        <FtPrompt
          v-if="showRemoveWatchedVideosPrompt"
          autosize
          :label="removeWatchedVideosPromptLabel"
          :option-names="removeWatchedVideosPromptOptionNames"
          :option-values="REMOVE_WATCHED_VIDEOS_PROMPT_VALUES"
          is-first-option-destructive
          @click="handleRemoveWatchedVideosPromptAnswer"
        />
        <p
          v-if="playlistUnavailableVideoCount > 0"
        >
          {{ t('Video.Playlist.Unavailable videos are hidden', { count: playlistUnavailableVideoCount }, playlistUnavailableVideoCount) }}
        </p>
      </div>
    </template>
  </FtCard>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, TransitionGroup, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import FtLoader from '../FtLoader/FtLoader.vue'
import FtCard from '../ft-card/ft-card.vue'
import FtListVideoNumbered from '../FtListVideoNumbered/FtListVideoNumbered.vue'
import FtPrompt from '../FtPrompt/FtPrompt.vue'

import store from '../../store/index'

import { deepCopy, extractNumberFromString, getVideoThumbnailUrl, showApiErrorToast, showToast, throttle } from '../../helpers/utils'
import {
  getLocalCachedFeedContinuation,
  getLocalPlaylist,
  parseLocalPlaylistVideos,
  untilEndOfLocalPlayList,
} from '../../helpers/api/local'
import { invidiousGetPlaylistInfo } from '../../helpers/api/invidious'
import { isHistoryEntryWatched } from '../../helpers/history'
import { clampOverlayScrollTop, restoreOverlayScrollTop } from '../../helpers/overlayScrollbars'
import { getPlaylistSkipAvailability, getSortedPlaylistItems, SORT_BY_VALUES } from '../../helpers/playlists'
import { useTabContext } from '../../tabs/TabContext'

const props = defineProps({
  playlistId: {
    type: String,
    required: true,
  },
  playlistType: {
    type: String,
    default: null
  },
  videoId: {
    type: String,
    required: true,
  },
  playlistItemId: {
    type: String,
    default: null,
  },
  downloadId: {
    type: String,
    default: '',
  },
  watchViewLoading: {
    type: Boolean,
    required: true,
  },
  fullscreenOverlay: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['close', 'pause-player', 'skip-availability-change', 'upcoming-videos-change'])

const { locale, t } = useI18n()
const router = useRouter()
const { tabId, isTabPresented } = useTabContext()
const playlistCacheTabId = tabId ?? 'web'

// Set when centering is attempted while the tab is hidden (e.g. opened in a
// background tab): the list has no layout yet, so we retry once it is presented.
const needsInitialCenter = ref(false)

const isLoading = ref(false)
const isCollapsed = ref(false)
const playlistCollapsed = computed(() => isCollapsed.value && !props.fullscreenOverlay)
let savedScrollTop = 0
let lastScrolledVideoId = null
const shuffleEnabled = ref(false)
const loopEnabled = ref(false)
const reversePlaylist = ref(false)
const showRemoveWatchedVideosPrompt = ref(false)
const channelId = ref('')
const channelName = ref('')
const playlistTitle = ref('')
const playlistTotalVideoCount = ref(0)
const playlistItems = shallowRef([])
const randomizedPlaylistItems = shallowRef([])
/** @import { VideoData } from '../../helpers/dragAndDrop' */
/** @type {import('vue').Ref<VideoData>} */
const draggedVideo = ref({ videoId: null, playlistItemId: null })
const showProgressBarPreview = ref(false)
const previewPositionPixels = ref(0)
const previewVideoIndex = ref(1)

const prevVideoBeforeDeletion = ref(null)
let getPlaylistInfoRun = false
let previewPositionUpdatePending = false
let previewPointerClientX = 0

/** @type {import('vue').ComputedRef<'local' | 'invidious'>} */
const backendPreference = computed(() => store.getters.getBackendPreference)

/** @type {import('vue').ComputedRef<boolean>} */
const backendFallback = computed(() => store.getters.getBackendFallback)

/** @type {import('vue').ComputedRef<string>} */
const currentInvidiousInstanceUrl = computed(() => store.getters.getCurrentInvidiousInstanceUrl)

const thumbnailPreference = computed(() => store.getters.getThumbnailPreference)

const isUserPlaylist = computed(() => props.playlistType === 'user')

const playlistReverseStateKey = computed(() => {
  if (props.playlistId == null || props.playlistId === '') { return null }

  return `${props.playlistType ?? 'default'}:${props.playlistId}`
})

const playlistReverseStates = computed(() => store.getters.getPlaylistReverseStates)

const storedReversePlaylist = computed(() => {
  const key = playlistReverseStateKey.value
  if (key == null) { return false }

  return playlistReverseStates.value?.[key] === true
})

/** @type {import('vue').ComputedRef<boolean>} */
const userPlaylistsReady = computed(() => store.getters.getPlaylistsReady)

const selectedUserPlaylist = computed(() => {
  if (props.playlistId == null || props.playlistId === '') { return null }

  return store.getters.getPlaylist(props.playlistId)
})

const quickBookmarkPlaylistId = computed(() => store.getters.getQuickBookmarkTargetPlaylistId)

const quickBookmarkButtonEnabled = computed(() => {
  if (selectedUserPlaylist.value == null) { return true }

  return selectedUserPlaylist.value._id !== quickBookmarkPlaylistId.value
})

/** @type {import('vue').ComputedRef<number | undefined>} */
const selectedUserPlaylistVideoCount = computed(() => selectedUserPlaylist.value?.videos?.length)

/** @type {import('vue').ComputedRef<number | undefined>} */
const selectedUserPlaylistLastUpdatedAt = computed(() => selectedUserPlaylist.value?.lastUpdatedAt)

const userPlaylistWatchedVideoCount = computed(() => {
  if (!isUserPlaylist.value) { return 0 }

  const historyCacheById = store.getters.getHistoryCacheById
  return selectedUserPlaylist.value?.videos.reduce((count, video) => {
    return isHistoryEntryWatched(historyCacheById[video.videoId]) ? count + 1 : count
  }, 0) ?? 0
})

const removeWatchedVideosPromptLabel = computed(() => {
  return t(
    'User Playlists.Are you sure you want to remove {playlistItemCount} watched videos from this playlist? This cannot be undone',
    { playlistItemCount: userPlaylistWatchedVideoCount.value },
    userPlaylistWatchedVideoCount.value
  )
})

const removeWatchedVideosPromptOptionNames = computed(() => [
  t('Yes, Delete'),
  t('Cancel')
])

const REMOVE_WATCHED_VIDEOS_PROMPT_VALUES = ['delete', 'cancel']

const currentVideoIndexZeroBased = computed(() => {
  return findIndexOfCurrentVideoInPlaylist(playlistItems.value)
})

const currentVideoIndexOneBased = computed(() => currentVideoIndexZeroBased.value + 1)

const currentVideo = computed(() => playlistItems.value[currentVideoIndexZeroBased.value])

const playlistVideoCount = computed(() => playlistItems.value.length)

const playlistUnavailableVideoCount = computed(() => playlistTotalVideoCount.value - playlistVideoCount.value)

const videoIndexInPlaylistItems = computed(() => {
  const items = shuffleEnabled.value ? randomizedPlaylistItems.value : playlistItems.value
  return findIndexOfCurrentVideoInPlaylist(items)
})

const videoIsLastPlaylistItem = computed(() => {
  return videoIndexInPlaylistItems.value === (playlistItems.value.length - 1)
})

const videoIsNotPlaylistItem = computed(() => videoIndexInPlaylistItems.value === -1)

const nextVideo = computed(() => {
  const targetList = shuffleEnabled.value ? randomizedPlaylistItems.value : playlistItems.value
  const targetVideoIndex = (videoIsNotPlaylistItem.value || videoIsLastPlaylistItem.value)
    ? 0
    : videoIndexInPlaylistItems.value + 1

  return targetList[targetVideoIndex] ?? null
})

const upcomingVideos = computed(() => {
  const targetList = shuffleEnabled.value ? randomizedPlaylistItems.value : playlistItems.value
  const currentIndex = findIndexOfCurrentVideoInPlaylist(targetList)
  const startIndex = currentIndex === -1 ? 0 : currentIndex + 1
  const remainingVideos = targetList.slice(startIndex)

  return loopEnabled.value && currentIndex !== -1
    ? remainingVideos.concat(targetList.slice(0, startIndex))
    : remainingVideos
})

watch(upcomingVideos, videos => {
  emit('upcoming-videos-change', videos)
}, { immediate: true })

const playlistPageLinkTo = computed(() => ({
  path: `/playlist/${props.playlistId}`,
  query: {
    playlistType: isUserPlaylist.value ? 'user' : '',
  }
}))

/** @type {import('vue').ComputedRef<string>} */
const userPlaylistSortOrder = computed(() => store.getters.getUserPlaylistSortOrder)

const sortOrder = computed(() => isUserPlaylist.value ? userPlaylistSortOrder.value : SORT_BY_VALUES.Custom)

const isSortOrderCustom = computed(() => sortOrder.value === SORT_BY_VALUES.Custom)

const canMoveVideos = computed(() => {
  return isUserPlaylist.value && isSortOrderCustom.value && playlistItems.value.length > 1
})

const MAX_ENHANCED_PLAYLIST_ITEMS = 200
const animatePlaylistItems = computed(() => {
  return canMoveVideos.value && playlistItems.value.length < MAX_ENHANCED_PLAYLIST_ITEMS
})

// TransitionGroup runs FLIP layout measurements for every child whenever this
// component updates. The fullscreen dock changes this component's layout, so a
// large playlist would synchronously measure thousands of items just to open or
// close. Retain move animations only where that cost stays bounded.
const playlistItemsWrapperComponent = computed(() => animatePlaylistItems.value ? TransitionGroup : 'div')

const isVideoDragging = computed(() => {
  const { videoId, playlistItemId } = draggedVideo.value

  return videoId != null && playlistItemId != null
})

const previewStyle = computed(() => ({
  left: `${previewPositionPixels.value}px`,
  transform: 'none'
}))

const previewVideoTitle = computed(() => {
  const index = previewVideoIndex.value - 1

  if (index >= 0 && index < playlistItems.value.length) {
    return playlistItems.value[index].title || 'Unknown Title'
  }
  return ''
})

const previewVideoThumbnail = computed(() => {
  const index = previewVideoIndex.value - 1

  if (index >= 0 && index < playlistItems.value.length) {
    const videoId = playlistItems.value[index].videoId

    if (videoId) {
      const baseUrl = backendPreference.value === 'invidious'
        ? currentInvidiousInstanceUrl.value
        : 'https://i.ytimg.com'
      return `${baseUrl}/vi/${videoId}/default.jpg`
    }
  }

  return null
})

watch(userPlaylistsReady, () => {
  getPlaylistInfoWithDelay()
})

watch(selectedUserPlaylistVideoCount, () => {
  // Re-fetch from local store when current user playlist updated
  parseUserPlaylist(selectedUserPlaylist.value)
  shufflePlaylistItems()
})

watch(selectedUserPlaylistLastUpdatedAt, () => {
  // Re-fetch from local store when current user playlist updated
  parseUserPlaylist(selectedUserPlaylist.value)
})

watch(() => props.videoId, (newId, oldId) => {
  // Check if next video is from the shuffled list or if the user clicked a different video
  if (shuffleEnabled.value) {
    const newVideoIndex = randomizedPlaylistItems.value.findIndex((item) => {
      return item.videoId === newId
    })

    const oldVideoIndex = randomizedPlaylistItems.value.findIndex((item) => {
      return item.videoId === oldId
    })

    if ((newVideoIndex - 1) !== oldVideoIndex) {
      // User clicked a different video than expected. Re-shuffle the list
      shufflePlaylistItems()
    }
  }
})

watch(() => props.playlistItemId, () => {
  prevVideoBeforeDeletion.value = null
})

watch(
  [isLoading, () => props.watchViewLoading, currentVideoIndexZeroBased],
  ([playlistLoading, watchViewLoading]) => {
    if (!playlistLoading && !watchViewLoading) {
      // Wait until both the watch view and playlist items are visible before
      // measuring them. The current index also changes when playback advances.
      centerCurrentVideo()
    }
  },
  { flush: 'post' }
)

// A playlist opened in a background tab centers while hidden, so it lands at the
// top. Re-center the current video the first time the tab is presented.
if (isTabPresented != null) {
  watch(isTabPresented, (presented) => {
    if (presented && needsInitialCenter.value) {
      centerCurrentVideo()
    }
  })
}

watch(() => props.playlistId, () => {
  reversePlaylist.value = storedReversePlaylist.value

  if (!process.env.SUPPORTS_LOCAL_API || backendPreference.value === 'invidious') {
    getPlaylistInformationInvidious()
  } else {
    getPlaylistInformationLocal()
  }
})

watch(storedReversePlaylist, (newVal) => {
  if (reversePlaylist.value !== newVal) {
    reversePlaylist.value = newVal
    playlistItems.value = playlistItems.value.toReversed()
  }
})

onMounted(() => {
  reversePlaylist.value = storedReversePlaylist.value

  const cachedPlaylist = store.getters.getCachedPlaylist(playlistCacheTabId)

  if (cachedPlaylist?.id === props.playlistId) {
    loadCachedPlaylistInformation(cachedPlaylist)
  } else {
    getPlaylistInfoWithDelay()
  }
})

/**
 * @param {any[]} videoList
 */
function findIndexOfCurrentVideoInPlaylist(videoList) {
  const playlistItemId = props.playlistItemId
  const videoId = props.videoId
  const prevVideoBeforeDeletionPlaylistItemId = prevVideoBeforeDeletion.value?.playlistItemId
  const prevVideoBeforeDeletionPlaylistVideoId = prevVideoBeforeDeletion.value?.videoId

  return videoList.findIndex((item) => {
    if (item.playlistItemId && (playlistItemId || prevVideoBeforeDeletionPlaylistItemId)) {
      return item.playlistItemId === playlistItemId || item.playlistItemId === prevVideoBeforeDeletionPlaylistItemId
    } else if (item.videoId) {
      return item.videoId === videoId || item.videoId === prevVideoBeforeDeletionPlaylistVideoId
    } else if (item.id) {
      return item.id === videoId || item.id === prevVideoBeforeDeletionPlaylistVideoId
    }

    return false
  })
}

function getPlaylistInfoWithDelay() {
  if (getPlaylistInfoRun) { return }

  isLoading.value = true
  // `selectedUserPlaylist` result accuracy relies on data being ready
  if (isUserPlaylist.value && !userPlaylistsReady.value) { return }

  getPlaylistInfoRun = true

  if (selectedUserPlaylist.value != null) {
    parseUserPlaylist(selectedUserPlaylist.value)
  } else if (!process.env.SUPPORTS_LOCAL_API || backendPreference.value === 'invidious') {
    getPlaylistInformationInvidious()
  } else {
    getPlaylistInformationLocal()
  }
}

function saveScrollState() {
  savedScrollTop = getScrollTop()
  lastScrolledVideoId = props.videoId
}

function restoreScrollState() {
  if (lastScrolledVideoId !== props.videoId) {
    centerCurrentVideo()
  } else {
    restoreScrollTop(savedScrollTop)
  }
}

watch(isCollapsed, (collapsed) => {
  if (collapsed) {
    saveScrollState()
  } else {
    restoreScrollState()
  }
})

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value
}

function toggleLoop() {
  if (loopEnabled.value) {
    loopEnabled.value = false
    showToast({ message: t('Loop is now disabled'), icon: ['fas', 'retweet'] })
  } else {
    loopEnabled.value = true
    showToast({ message: t('Loop is now enabled'), icon: ['fas', 'retweet'] })
  }
}

function toggleShuffle() {
  if (shuffleEnabled.value) {
    shuffleEnabled.value = false
    showToast({ message: t('Shuffle is now disabled'), icon: ['fas', 'random'] })
  } else {
    shuffleEnabled.value = true
    showToast({ message: t('Shuffle is now enabled'), icon: ['fas', 'random'] })
    shufflePlaylistItems()
  }
}

function toggleReversePlaylist() {
  isLoading.value = true
  showToast({ message: t('The playlist has been reversed'), icon: ['fas', 'exchange-alt'] })

  reversePlaylist.value = !reversePlaylist.value
  persistReversePlaylistState()
  // Create a new array to avoid changing array in data store state
  // it could be user playlist or cache playlist
  playlistItems.value = playlistItems.value.toReversed()

  nextTick(() => {
    isLoading.value = false
  })
}

function persistReversePlaylistState() {
  const key = playlistReverseStateKey.value
  if (key == null) { return }

  const updatedPlaylistReverseStates = { ...(playlistReverseStates.value ?? {}) }
  if (reversePlaylist.value) {
    updatedPlaylistReverseStates[key] = true
  } else {
    delete updatedPlaylistReverseStates[key]
  }

  store.dispatch('updatePlaylistReverseStates', updatedPlaylistReverseStates)
}

/**
 * @param {any[]} items
 */
function applyReversePlaylistState(items) {
  return reversePlaylist.value ? items.toReversed() : items
}

/**
 * @param {any[]} items
 */
async function persistPlaylistOrder(items) {
  const selectedPlaylist = selectedUserPlaylist.value
  if (selectedPlaylist == null) { return }

  const playlist = {
    playlistName: selectedPlaylist.playlistName,
    protected: selectedPlaylist.protected,
    description: selectedPlaylist.description,
    videos: deepCopy(reversePlaylist.value ? items.toReversed() : items),
    _id: selectedPlaylist._id,
  }

  try {
    await store.dispatch('updatePlaylist', playlist)
  } catch (error) {
    showToast({
      message: t('User Playlists.SinglePlaylistView.Toast["There was an issue with updating this playlist."]'),
      icon: ['fas', 'circle-exclamation'],
    })
    console.error(error)
  }
}

/**
 * @param {string} videoId
 * @param {string} playlistItemId
 * @param {-1 | 1} offset
 */
function moveVideo(videoId, playlistItemId, offset) {
  const items = playlistItems.value.slice()
  const index = items.findIndex((video) => {
    return video.videoId === videoId && video.playlistItemId === playlistItemId
  })
  const targetIndex = index + offset

  if (index === -1 || targetIndex < 0 || targetIndex >= items.length) { return }

  [items[index], items[targetIndex]] = [items[targetIndex], items[index]]
  playlistItems.value = items
  persistPlaylistOrder(items)
}

function moveVideoUp(videoId, playlistItemId) {
  moveVideo(videoId, playlistItemId, -1)
}

function moveVideoDown(videoId, playlistItemId) {
  moveVideo(videoId, playlistItemId, 1)
}

/**
 * @param {string} videoId
 * @param {string} playlistItemId
 */
async function removeVideoFromPlaylist(videoId, playlistItemId) {
  try {
    await store.dispatch('removeVideo', {
      _id: props.playlistId,
      videoId,
      playlistItemId,
    })
    showToast({
      message: t('User Playlists.SinglePlaylistView.Toast.Video has been removed'),
      image: getVideoThumbnailUrl(videoId, backendPreference.value, currentInvidiousInstanceUrl.value, thumbnailPreference.value),
      icon: ['fas', 'trash'],
    })
  } catch (error) {
    showToast({
      message: t('User Playlists.SinglePlaylistView.Toast.There was a problem with removing this video'),
      icon: ['fas', 'circle-exclamation'],
    })
    console.error(error)
  }
}

/** @param {'delete' | 'cancel' | null} option */
async function handleRemoveWatchedVideosPromptAnswer(option) {
  showRemoveWatchedVideosPrompt.value = false
  if (option !== 'delete' || selectedUserPlaylist.value == null) { return }

  const historyCacheById = store.getters.getHistoryCacheById
  const watchedVideos = selectedUserPlaylist.value.videos
    .filter((video) => isHistoryEntryWatched(historyCacheById[video.videoId]))
  const playlistItemIds = watchedVideos.map((video) => video.playlistItemId)

  if (playlistItemIds.length === 0) {
    showToast({
      message: t('User Playlists.SinglePlaylistView.Toast["There were no videos to remove."]'),
      icon: ['fas', 'circle-exclamation'],
    })
    return
  }

  try {
    await store.dispatch('removeVideos', {
      _id: props.playlistId,
      playlistItemIds,
      videoIds: watchedVideos.map((video) => video.videoId),
    })
    showToast({
      message: t('User Playlists.SinglePlaylistView.Toast.{videoCount} video(s) have been removed', {
        videoCount: playlistItemIds.length
      }, playlistItemIds.length),
      icon: ['fas', 'trash'],
    })
  } catch (error) {
    showToast({
      message: t('User Playlists.SinglePlaylistView.Toast["There was an issue with updating this playlist."]'),
      icon: ['fas', 'circle-exclamation'],
    })
    console.error(error)
  }
}

/** @param {VideoData} video */
function setDraggedVideo(video) {
  draggedVideo.value = video
}

function onDragVideoEnd() {
  persistPlaylistOrder(playlistItems.value)
  setDraggedVideo({ videoId: null, playlistItemId: null })
}

/**
 * @param {VideoData} draggedOverVideo
 * @param {VideoData} draggedVideo_
 */
function moveDraggedVideoTemporarily(draggedOverVideo, draggedVideo_) {
  const items = playlistItems.value.slice()
  const draggedOverIndex = items.findIndex((video) => {
    return video.videoId === draggedOverVideo.videoId && video.playlistItemId === draggedOverVideo.playlistItemId
  })
  const draggedVideoIndex = items.findIndex((video) => {
    return video.videoId === draggedVideo_.videoId && video.playlistItemId === draggedVideo_.playlistItemId
  })

  if (draggedOverIndex === -1 || draggedVideoIndex === -1) { return }

  const [itemToMove] = items.splice(draggedVideoIndex, 1)
  items.splice(draggedOverIndex, 0, itemToMove)
  playlistItems.value = items
}

const moveDraggedVideoTemporarilyThrottled = throttle(moveDraggedVideoTemporarily, 100)

function playNextVideo() {
  const videoIndex = videoIndexInPlaylistItems.value
  const targetVideoIndex = (videoIsNotPlaylistItem.value || videoIsLastPlaylistItem.value) ? 0 : videoIndex + 1

  const targetList = shuffleEnabled.value ? randomizedPlaylistItems.value : playlistItems.value

  const targetPlaylistItem = targetList[targetVideoIndex]

  if (!targetPlaylistItem?.videoId) {
    return
  }

  const routerPushPayload = {
    path: `/watch/${targetPlaylistItem.videoId}`,
    query: {
      playlistId: props.playlistId,
      playlistType: props.playlistType,
      playlistItemId: targetPlaylistItem.playlistItemId,
      ...(props.downloadId ? { downloadId: props.downloadId } : {})
    }
  }

  if (shuffleEnabled.value) {
    let doShufflePlaylistItems = false

    if (videoIsLastPlaylistItem.value && !loopEnabled.value) {
      showToast({ message: t('The playlist has ended. Enable loop to continue playing'), icon: ['fas', 'retweet'] })
      return
    }
    // loopEnabled = true
    if (videoIsLastPlaylistItem.value || videoIsNotPlaylistItem.value) {
      doShufflePlaylistItems = true
    }

    router.push(routerPushPayload)

    showToast({ message: t('Playing Next Video'), icon: ['fas', 'step-forward'] })

    if (doShufflePlaylistItems) {
      shufflePlaylistItems()
    }
  } else {
    const stopDueToLoopDisabled = videoIsLastPlaylistItem.value && !loopEnabled.value

    if (stopDueToLoopDisabled) {
      showToast({ message: t('The playlist has ended. Enable loop to continue playing'), icon: ['fas', 'retweet'] })
      return
    }

    router.push(routerPushPayload)
    showToast({ message: t('Playing Next Video'), icon: ['fas', 'step-forward'] })
  }
}

function playPreviousVideo() {
  // At the start of the playlist there is nothing to go back to, unless loop wraps us around
  if (!canPlayPreviousVideo.value) {
    showToast({ message: t('The playlist is at the beginning. Enable loop to continue playing'), icon: ['fas', 'retweet'] })
    return
  }

  const videoIndex = previousVideoSourceIndex.value

  // Wrap around to the end of the playlist only if there are no remaining earlier videos
  const targetVideoIndex = (videoIndex === 0 || videoIsNotPlaylistItem.value) ? playlistItems.value.length - 1 : videoIndex - 1

  const targetList = shuffleEnabled.value ? randomizedPlaylistItems.value : playlistItems.value

  const targetPlaylistItem = targetList[targetVideoIndex]

  if (!targetPlaylistItem?.videoId) {
    return
  }

  showToast({ message: t('Playing Previous Video'), icon: ['fas', 'step-backward'] })

  router.push(
    {
      path: `/watch/${targetPlaylistItem.videoId}`,
      query: {
        playlistId: props.playlistId,
        playlistType: props.playlistType,
        playlistItemId: targetPlaylistItem.playlistItemId,
        ...(props.downloadId ? { downloadId: props.downloadId } : {})
      }
    }
  )
}

/**
 * @param {{ id: string, title: string, channelName: string, channelId: string, items: any[], continuationData: string | null }} cachedPlaylist
 */
async function loadCachedPlaylistInformation(cachedPlaylist) {
  isLoading.value = true
  getPlaylistInfoRun = true
  store.commit('setCachedPlaylist', { tabId: playlistCacheTabId, value: null })

  playlistTitle.value = cachedPlaylist.title
  playlistTotalVideoCount.value = cachedPlaylist.totalVideoCount
  channelName.value = cachedPlaylist.channelName
  channelId.value = cachedPlaylist.channelId

  if (!process.env.SUPPORTS_LOCAL_API || backendPreference.value === 'invidious' || cachedPlaylist.continuationData === null) {
    playlistItems.value = applyReversePlaylistState(cachedPlaylist.items)
  } else {
    const videos = cachedPlaylist.items

    const continuationData = await getLocalCachedFeedContinuation('playlist', cachedPlaylist.continuationData)
    videos.push(...parseLocalPlaylistVideos(continuationData.items))

    await untilEndOfLocalPlayList(continuationData, (p) => {
      videos.push(...parseLocalPlaylistVideos(p.items))
    }, { runCallbackOnceFirst: false })

    playlistItems.value = applyReversePlaylistState(videos)
  }
  isLoading.value = false
}

async function getPlaylistInformationLocal() {
  isLoading.value = true

  try {
    const playlist = await getLocalPlaylist(props.playlistId)

    let channelName_

    if (playlist.info.author) {
      channelName_ = playlist.info.author.name
    } else {
      const subtitle = playlist.info.subtitle.toString()

      const index = subtitle.lastIndexOf('•')
      channelName_ = subtitle.substring(0, index).trim()
    }

    playlistTitle.value = playlist.info.title
    playlistTotalVideoCount.value = extractNumberFromString(playlist.info.total_items)
    channelName.value = channelName_
    channelId.value = playlist.info.author?.id

    const videos = []
    await untilEndOfLocalPlayList(playlist, (p) => {
      videos.push(...parseLocalPlaylistVideos(p.items))
    })

    playlistItems.value = applyReversePlaylistState(videos)

    isLoading.value = false
  } catch (err) {
    console.error(err)
    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)
    if (backendPreference.value === 'local' && backendFallback.value) {
      showToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
      getPlaylistInformationInvidious()
    } else {
      isLoading.value = false
    }
  }
}

async function getPlaylistInformationInvidious() {
  isLoading.value = true

  try {
    const result = await invidiousGetPlaylistInfo(props.playlistId)

    playlistTitle.value = result.title
    playlistTotalVideoCount.value = result.videoCount
    channelName.value = result.author
    channelId.value = result.authorId

    playlistItems.value = applyReversePlaylistState(result.videos)

    isLoading.value = false
  } catch (err) {
    console.error(err)
    const errorMessage = t('Invidious API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)
    if (process.env.SUPPORTS_LOCAL_API && backendPreference.value === 'invidious' && backendFallback.value) {
      showToast({ message: t('Falling back to Local API'), icon: ['fas', 'exchange-alt'] })
      getPlaylistInformationLocal()
    } else {
      isLoading.value = false
    }
  }
}

function parseUserPlaylist(playlist) {
  playlistTitle.value = playlist.playlistName
  channelName.value = ''
  channelId.value = ''

  const isCurrentVideoInParsedPlaylist = findIndexOfCurrentVideoInPlaylist(playlist.videos) !== -1
  if (!isCurrentVideoInParsedPlaylist) {
    // grab 2nd video if the 1st one is current & deleted
    // or the prior video in the list before the current video's deletion
    const targetVideoIndex = currentVideoIndexZeroBased.value - 1
    prevVideoBeforeDeletion.value = targetVideoIndex >= 0 ? playlistItems.value[targetVideoIndex] : null
  }

  playlistItems.value = getSortedPlaylistItems(playlist.videos, sortOrder.value, locale.value, reversePlaylist.value)

  isLoading.value = false
}

function shufflePlaylistItems() {
  // Prevents the array from affecting the original object
  const items = playlistItems.value.slice()

  let cachedCurrentVideos

  if (currentVideo.value != null) {
    cachedCurrentVideos = items.splice(currentVideoIndexZeroBased.value, 1)
    // There is no else case
    // If current video is absent in (removed from) the playlist, nothing should be changed
  }

  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))

    const temp = items[i]
    items[i] = items[j]
    items[j] = temp
  }

  if (cachedCurrentVideos && cachedCurrentVideos.length > 0) {
    items.unshift(cachedCurrentVideos[0])
  }

  randomizedPlaylistItems.value = items
}

const playlistItemsWrapper = useTemplateRef('playlistItemsWrapper')
let playlistItemsObserver = null
let playlistItemsClampFrame = null

function stopObservingPlaylistItems() {
  playlistItemsObserver?.disconnect()
  playlistItemsObserver = null
  if (playlistItemsClampFrame !== null) {
    cancelAnimationFrame(playlistItemsClampFrame)
    playlistItemsClampFrame = null
  }
}

watch(playlistItemsWrapper, (wrapper) => {
  stopObservingPlaylistItems()
  const container = wrapper?.$el ?? wrapper
  if (container == null) {
    return
  }

  playlistItemsObserver = new MutationObserver(() => {
    playlistItemsClampFrame ??= requestAnimationFrame(() => {
      playlistItemsClampFrame = null
      const items = container.querySelectorAll(':scope > .playlistItem')
      clampOverlayScrollTop(
        container,
        items[items.length - 1] ?? null
      )
    })
  })
  playlistItemsObserver.observe(container, { childList: true })
}, { flush: 'post' })

onBeforeUnmount(stopObservingPlaylistItems)

function getScrollTop() {
  const container = playlistItemsWrapper.value?.$el ?? playlistItemsWrapper.value
  return container?.scrollTop ?? 0
}

/** @param {number} scrollTop */
function setScrollTop(scrollTop) {
  const container = playlistItemsWrapper.value?.$el ?? playlistItemsWrapper.value
  if (container != null) {
    container.scrollTop = scrollTop
  }
}

/** @param {number} scrollTop */
function restoreScrollTop(scrollTop) {
  nextTick(() => {
    requestAnimationFrame(() => {
      const container = playlistItemsWrapper.value?.$el ?? playlistItemsWrapper.value
      if (container != null) {
        restoreOverlayScrollTop(container, scrollTop)
      }
    })
  })
}

/**
 * @param {number} index
 */
/**
 * @param {number} index
 * @returns {boolean} whether the scroll could actually be applied. It cannot
 * when the tab is hidden (`display: none`), because the list then has no layout.
 */
function scrollToVideo(index) {
  const container = playlistItemsWrapper.value?.$el ?? playlistItemsWrapper.value

  if (container == null || container.clientHeight === 0) {
    return false
  }

  const currentVideoItemEl = container.children[index]

  if (currentVideoItemEl == null) {
    return false
  }

  const containerRect = container.getBoundingClientRect()
  const itemRect = currentVideoItemEl.getBoundingClientRect()
  const itemOffset = itemRect.top - containerRect.top - container.clientTop + container.scrollTop
  const centeredOffset = (container.clientHeight - itemRect.height) / 2

  container.scrollTop = Math.max(0, itemOffset - centeredOffset)
  return true
}

function scrollToCurrentVideo() {
  return scrollToVideo(currentVideoIndexZeroBased.value)
}

function centerCurrentVideo() {
  nextTick(() => {
    requestAnimationFrame(() => {
      if (scrollToCurrentVideo()) {
        needsInitialCenter.value = false
        requestAnimationFrame(scrollToCurrentVideo)
      } else {
        // The tab is still hidden; retry once it becomes presented.
        needsInitialCenter.value = true
      }
    })
  })
}

function pausePlayer() {
  emit('pause-player')
}

const playlistProgressBar = useTemplateRef('playlistProgressBar')
const progressBarPreview = useTemplateRef('progressBarPreview')

/**
 * @param {MouseEvent} event
 */
async function updateProgressBarPreview(event) {
  if (!showProgressBarPreview.value) return

  const rect = playlistProgressBar.value.getBoundingClientRect()
  const mouseX = event.clientX - rect.left
  const progressBarWidth = rect.width
  const percentage = Math.max(0, Math.min(100, (mouseX / progressBarWidth) * 100))

  previewVideoIndex.value = Math.max(1, Math.min(playlistVideoCount.value, Math.ceil((percentage / 100) * playlistVideoCount.value)))
  previewPointerClientX = event.clientX

  if (previewPositionUpdatePending) return
  previewPositionUpdatePending = true
  await nextTick()
  previewPositionUpdatePending = false

  const boundary = playlistProgressBar.value.closest('.watchVideoPlaylist')
  if (boundary && progressBarPreview.value) {
    const boundaryRect = boundary.getBoundingClientRect()
    const margin = 8
    const availableWidth = Math.max(0, boundaryRect.width - (margin * 2))
    progressBarPreview.value.style.setProperty(
      '--playlist-preview-max-inline-size',
      `${availableWidth}px`
    )
    const previewWidth = Math.min(progressBarPreview.value.offsetWidth, availableWidth)
    const minimumViewportLeft = boundaryRect.left + margin
    const maximumViewportLeft = boundaryRect.right - margin - previewWidth
    const centeredViewportLeft = previewPointerClientX - (previewWidth / 2)
    const viewportLeft = Math.max(
      minimumViewportLeft,
      Math.min(maximumViewportLeft, centeredViewportLeft)
    )
    previewPositionPixels.value = viewportLeft - rect.left
  }
}

/**
 * @param {PointerEvent} event
 */
function handleProgressBarClick(event) {
  const rect = event.currentTarget.getBoundingClientRect()
  const clickX = event.clientX - rect.left
  const progressBarWidth = rect.width
  const clickPercentage = clickX / progressBarWidth

  const targetVideoIndex = Math.max(1, Math.min(playlistVideoCount.value, Math.ceil(clickPercentage * playlistVideoCount.value)))
  const targetArrayIndex = targetVideoIndex - 1

  if (targetArrayIndex >= 0 && targetArrayIndex < playlistItems.value.length) {
    scrollToVideo(targetArrayIndex)
  }
}

const videoIsLastInInPlaylistItems = computed(() => {
  if (shuffleEnabled.value) {
    return videoIndexInPlaylistItems.value === randomizedPlaylistItems.value.length - 1
  } else {
    return videoIndexInPlaylistItems.value === playlistItems.value.length - 1
  }
})

const shouldStopDueToPlaylistEnd = computed(() => {
  // Loop enabled = should not stop
  return videoIsLastInInPlaylistItems.value && !loopEnabled.value
})

/**
 * Index that `playPreviousVideo` steps back from.
 *
 * When the current video being watched in the playlist is deleted,
 * the previous video is shown as the "current" one.
 * So if we want to play the previous video, in this case,
 * we actually want to actually play the "current" video.
 * The only exception is when shuffle is enabled, as we don't actually
 * want to play the last sequential video with shuffle.
 */
const previousVideoSourceIndex = computed(() => {
  const videoIndex = videoIndexInPlaylistItems.value

  return prevVideoBeforeDeletion.value && !shuffleEnabled.value ? videoIndex + 1 : videoIndex
})

const skipAvailability = computed(() => {
  const items = shuffleEnabled.value ? randomizedPlaylistItems.value : playlistItems.value

  return getPlaylistSkipAvailability({
    itemCount: items.length,
    currentIndex: videoIndexInPlaylistItems.value,
    loopEnabled: loopEnabled.value,
    previousVideoSourceIndex: previousVideoSourceIndex.value
  })
})

const canPlayNextVideo = computed(() => skipAvailability.value.canPlayNext)

const canPlayPreviousVideo = computed(() => skipAvailability.value.canPlayPrevious)

// The watch view owns the skip actions, as it also knows about the watch queue
watch([canPlayNextVideo, canPlayPreviousVideo], ([canPlayNext, canPlayPrevious]) => {
  emit('skip-availability-change', { canPlayNext, canPlayPrevious })
}, { immediate: true })

defineExpose({
  centerCurrentVideo,
  getScrollTop,
  restoreScrollTop,
  setScrollTop,
  playNextVideo,
  playPreviousVideo,
  nextVideo,
  shouldStopDueToPlaylistEnd,
  getState: () => ({
    index: reversePlaylist.value
      ? playlistItems.value.length - currentVideoIndexOneBased.value
      : currentVideoIndexZeroBased.value,
    reverse: reversePlaylist.value,
    shuffle: shuffleEnabled.value,
    loop: loopEnabled.value
  })
})
</script>

<style scoped src="./WatchVideoPlaylist.css" />
