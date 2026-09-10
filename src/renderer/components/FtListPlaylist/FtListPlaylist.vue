<template>
  <div
    class="ft-list-video ft-list-item"
    :class="{
      [appearance]: true,
      list: listType === 'list',
      grid: listType === 'grid'
    }"
  >
    <div
      class="videoThumbnail"
    >
      <RouterLink
        class="thumbnailLink"
        :to="playlistPageLinkTo"
        tabindex="-1"
        aria-hidden="true"
      >
        <FtRetryImage
          alt=""
          :src="thumbnailForDisplay"
          class="thumbnailImage"
          :class="{ blur: blurThumbnails }"
        />
      </RouterLink>
      <div
        class="videoCountContainer"
      >
        <div class="background" />
        <div class="inner">
          <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- Infinity is a language-independent count indicator. -->
          <div>{{ playlistMetadata.videoCount < 0 ? '∞' : playlistMetadata.videoCount }}</div>
          <div><FtIcon :icon="['fas','list']" /></div>
        </div>
      </div>
    </div>
    <div class="info">
      <RouterLink
        class="title"
        :to="playlistPageLinkTo"
      >
        <h3
          class="h3Title"
          dir="auto"
        >
          {{ titleForDisplay }}
        </h3>
      </RouterLink>
      <div class="infoLine">
        <RouterLink
          v-if="playlistMetadata.channelId && enableChannelLinks"
          class="channelName"
          dir="auto"
          :to="`/channel/${playlistMetadata.channelId}`"
        >
          <FtChannelAvatar
            v-if="showChannelAvatar"
            :thumbnail="channelThumbnail"
          />
          <span class="channelNameText">{{ playlistMetadata.channelName }}</span>
        </RouterLink>
        <bdi
          v-else
          class="channelName"
        >
          <FtChannelAvatar
            v-if="showChannelAvatar"
            :thumbnail="channelThumbnail"
          />
          <span class="channelNameText">{{ playlistMetadata.channelName }}</span>
        </bdi>
      </div>
      <div class="buttonStack playlistButtonStack">
        <FtIconButton
          v-if="externalPlayer !== '' && !isUserPlaylist"
          :title="t('Video.External Player.OpenInTemplate', { externalPlayer })"
          :icon="['fas', 'external-link-alt']"
          class="externalPlayerButton"
          theme="base-no-default"
          :size="16"
          :use-shadow="false"
          @click="handleExternalPlayer"
        />
        <FtIconButton
          v-if="supportsYtDlp && enableDownloads && playlistMetadata.videoCount > 0"
          :title="t('Downloads.Download Playlist')"
          :icon="['fas', 'download']"
          theme="base-no-default"
          :size="16"
          @click="showDownloadPrompt = true"
        />
        <FtIconButton
          v-if="isUserPlaylist"
          :title="markedAsQuickBookmarkTarget ? t('User Playlists.Quick Bookmark Enabled') : t('User Playlists.Enable Quick Bookmark With This Playlist')"
          :icon="markedAsQuickBookmarkTarget ? quickBookmarkIcon : ['far', 'bookmark']"
          :disabled="markedAsQuickBookmarkTarget"
          :theme="markedAsQuickBookmarkTarget ? 'secondary' : 'base-no-default'"
          :size="16"
          @disabled-click="handleQuickBookmarkEnabledDisabledClick"
          @click="enableQuickBookmarkForThisPlaylist"
        />
        <FtIconButton
          v-if="isPlaylistBookmark"
          :title="t('User Playlists.Remove Saved Playlist')"
          :icon="['fas', 'bookmark']"
          :aria-pressed="true"
          theme="secondary"
          :size="16"
          @click="removePlaylistBookmark"
        />
      </div>
    </div>
    <WatchVideoDownloadPrompt
      v-if="enableDownloads && showDownloadPrompt"
      :playlist-id="isUserPlaylist ? '' : playlistMetadata.playlistId"
      :playlist-key="playlistMetadata.playlistId"
      :video-ids="isUserPlaylist ? data.videos.map(video => video.videoId) : []"
      :is-playlist="true"
      :title="playlistMetadata.title"
      :thumbnail="thumbnailForDisplay"
      @close="showDownloadPrompt = false"
    />
  </div>
</template>

<script setup>
import FtRetryImage from '../FtRetryImage.vue'
import { supportsYtDlp } from '../../helpers/ytDlpCapabilities'
import { FtIcon } from '@opentubex/icons'
import { computed, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtChannelAvatar from '../FtChannelAvatar/FtChannelAvatar.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import WatchVideoDownloadPrompt from '../WatchVideoDownloadPrompt/WatchVideoDownloadPrompt.vue'

import store from '../../store/index'

import { useResultChannelAvatar } from '../../composables/useResultChannelAvatar'
import { showToast } from '../../helpers/utils'
import thumbnailPlaceholder from '../../assets/img/thumbnail_placeholder.svg'

const props = defineProps({
  data: {
    type: Object,
    required: true
  },
  appearance: {
    type: String,
    required: true
  },
  searchQueryText: {
    type: String,
    default: ''
  },
})

const { t } = useI18n()
const showDownloadPrompt = ref(false)
const enableDownloads = computed(() => store.getters.getEnableDownloads)

watch(enableDownloads, (enabled) => {
  if (!enabled) showDownloadPrompt.value = false
})

/** @type {import('vue').ComputedRef<'grid' | 'list'>} */
const listType = computed(() => store.getters.getListType)

/** @type {import('vue').ComputedRef<boolean>} */
const blurThumbnails = computed(() => store.getters.getBlurThumbnails)

/** @type {import('vue').ComputedRef<'' | 'start' | 'middle' | 'end' | 'hidden' | 'blur'>} */
const thumbnailPreference = computed(() => store.getters.getThumbnailPreference)

/** @type {import('vue').ComputedRef<'local' | 'invidious'>} */
const backendPreference = computed(() => store.getters.getBackendPreference)

/** @type {import('vue').ComputedRef<string>} */
const currentInvidiousInstanceUrl = computed(() => store.getters.getCurrentInvidiousInstanceUrl)

const isUserPlaylist = computed(() => props.data._id != null)
const isPlaylistBookmark = computed(() => props.data.isPlaylistBookmark === true)
const playlistMetadata = computed(() => {
  if (isUserPlaylist.value) {
    let thumbnailUrl = thumbnailPlaceholder
    if (props.data.videos.length > 0) {
      const origin = backendPreference.value === 'invidious'
        ? currentInvidiousInstanceUrl.value
        : 'https://i.ytimg.com'
      thumbnailUrl = `${origin}/vi/${props.data.videos[0].videoId}/mqdefault.jpg`
    }

    return {
      playlistId: props.data._id,
      title: props.data.playlistName,
      thumbnailUrl,
      channelName: '',
      channelId: '',
      videoCount: props.data.videos.length,
    }
  }

  if (props.data.dataSource === 'local') {
    return {
      playlistId: props.data.playlistId,
      title: props.data.title,
      thumbnailUrl: props.data.thumbnail,
      channelName: props.data.channelName,
      channelId: props.data.channelId,
      videoCount: props.data.videoCount,
    }
  }

  let thumbnailUrl = thumbnailPlaceholder
  if (props.data.proxyThumbnail === false) {
    thumbnailUrl = props.data.playlistThumbnail
  } else if (typeof props.data.playlistThumbnail === 'string' && props.data.playlistThumbnail !== '') {
    thumbnailUrl = props.data.playlistThumbnail.replace('hqdefault', 'mqdefault')
    if (!isPlaylistBookmark.value || backendPreference.value === 'invidious') {
      thumbnailUrl = thumbnailUrl.replace('https://i.ytimg.com', currentInvidiousInstanceUrl.value)
    }
  }

  return {
    playlistId: props.data.playlistId,
    title: props.data.title,
    thumbnailUrl,
    channelName: props.data.author,
    channelId: props.data.authorId,
    videoCount: props.data.videoCount,
  }
})

const titleForDisplay = computed(() => {
  const { title } = playlistMetadata.value
  if (typeof title !== 'string') return ''
  if (title.length <= 255) return title
  return `${title.slice(0, 255)}...`
})

/** @type {import('vue').ComputedRef<string>} */
const thumbnailForDisplay = computed(() => {
  return thumbnailPreference.value !== 'hidden'
    ? playlistMetadata.value.thumbnailUrl
    : thumbnailPlaceholder
})

// For `router-link` attribute `to`
const playlistPageLinkTo = computed(() => {
  const query = {
    playlistType: isUserPlaylist.value ? 'user' : '',
    searchQueryText: props.searchQueryText,
  }
  const playlistThumbnail = props.data.dataSource === 'local'
    ? props.data.thumbnail
    : props.data.playlistThumbnail
  if (!isUserPlaylist.value && typeof playlistThumbnail === 'string' && playlistThumbnail !== '') {
    query.playlistThumbnail = playlistThumbnail
  }

  return {
    path: `/playlist/${playlistMetadata.value.playlistId}`,
    query,
  }
})

const channelId = computed(() => playlistMetadata.value.channelId)

const showChannelAvatar = computed(() => (
  !store.getters.getHideChannelAvatars &&
  (props.appearance === 'result' || props.appearance === 'youtubeShort') &&
  typeof playlistMetadata.value.channelName === 'string' &&
  playlistMetadata.value.channelName !== '' &&
  typeof playlistMetadata.value.channelId === 'string' &&
  playlistMetadata.value.channelId !== ''
))

const { channelThumbnail } = useResultChannelAvatar(
  toRef(props, 'data'),
  channelId,
  showChannelAvatar
)

/** @type {import('vue').ComputedRef<string | null>} */
const quickBookmarkPlaylistId = computed(() => store.getters.getQuickBookmarkTargetPlaylistId)
const quickBookmarkIcon = computed(() => store.getters.getQuickBookmarkIcon)

const markedAsQuickBookmarkTarget = computed(() => {
  // Only user playlists can be target
  return playlistMetadata.value.playlistId != null &&
    quickBookmarkPlaylistId.value != null &&
    quickBookmarkPlaylistId.value === playlistMetadata.value.playlistId
})

function handleQuickBookmarkEnabledDisabledClick() {
  showToast({
    message: t('User Playlists.SinglePlaylistView.Toast["This playlist is already being used for quick bookmark."]'),
    icon: ['fas', 'bookmark'],
  })
}

async function enableQuickBookmarkForThisPlaylist() {
  const currentQuickBookmarkTargetPlaylist = store.getters.getQuickBookmarkPlaylist

  store.dispatch('updateQuickBookmarkTargetPlaylistId', playlistMetadata.value.playlistId)

  if (currentQuickBookmarkTargetPlaylist != null) {
    showToast({
      message: t('User Playlists.SinglePlaylistView.Toast["This playlist is now used for quick bookmark instead of {oldPlaylistName}. Click here to undo"]', {
        oldPlaylistName: currentQuickBookmarkTargetPlaylist.playlistName,
      }),
      time: 5000,
      action: () => {
        store.dispatch('updateQuickBookmarkTargetPlaylistId', currentQuickBookmarkTargetPlaylist._id)
        showToast({
          message: t('User Playlists.SinglePlaylistView.Toast["Reverted to use {oldPlaylistName} for quick bookmark"]', {
            oldPlaylistName: currentQuickBookmarkTargetPlaylist.playlistName,
          }),
          time: 5000,
          icon: ['fas', 'undo'],
        })
      },
      icon: ['fas', 'bookmark'],
    })
  } else {
    showToast({
      message: t('User Playlists.SinglePlaylistView.Toast.This playlist is now used for quick bookmark'),
      icon: ['fas', 'bookmark'],
    })
  }
}

async function removePlaylistBookmark() {
  const removed = await store.dispatch('removePlaylistBookmark', playlistMetadata.value.playlistId)
  if (!removed) {
    showToast({
      message: t('User Playlists.SinglePlaylistView.Toast["There was an issue with updating this playlist."]'),
      icon: ['fas', 'circle-exclamation'],
    })
  }
}

/** @type {import('vue').ComputedRef<string>} */
const externalPlayer = computed(() => store.getters.getExternalPlayer)

/** @type {import('vue').ComputedRef<number>} */
const defaultPlayback = computed(() => store.getters.getDefaultPlayback)

const enableChannelLinks = computed(() => !store.getters.getDisableChannelLinks)

function handleExternalPlayer() {
  if (process.env.IS_ELECTRON) {
    window.ftElectron.openInExternalPlayer({
      playlistId: playlistMetadata.value.playlistId,
      playbackRate: defaultPlayback.value,
    })
  }
}
</script>

<style scoped lang="scss" src="./FtListPlaylist.scss" />
