<template>
  <FtMobileSheet
    below-player
    :enabled="phoneLayout"
    :open="sheetOpen"
    :title="t('User Playlists.Save to')"
    @close="sheetOpen = false"
    @closed="closeDropdown"
  >
    <div
      class="addToPlaylistDropdown"
      :class="{ phonePlaylistPicker: phoneLayout }"
    >
      <p class="dropdownHeader">
        {{ t('User Playlists.Save to') }}
      </p>
      <input
        v-model="search"
        class="playlistSearch"
        type="search"
        :aria-label="t('User Playlists.AddVideoPrompt.Search in Playlists')"
        :placeholder="t('User Playlists.AddVideoPrompt.Search in Playlists')"
      >
      <div
        ref="listScroller"
        v-overlay-scrollbars
        class="playlistList"
      >
        <ul
          ref="listContent"
          class="playlistListContent"
          role="listbox"
          :aria-label="t('User Playlists.Add to Playlist')"
        >
          <li
            v-for="playlist in filteredPlaylists"
            :key="playlist._id"
            class="playlistRow"
            role="option"
            :aria-selected="containedIds.has(playlist._id)"
            tabindex="0"
            @click="togglePlaylist(playlist)"
            @keydown.enter.prevent="togglePlaylist(playlist)"
            @keydown.space.prevent="togglePlaylist(playlist)"
          >
            <img
              alt=""
              class="playlistThumbnail"
              :src="playlistThumbnail(playlist)"
            >
            <span class="playlistDetails">
              <span class="playlistName">{{ playlist.playlistName }}</span>
              <span class="videoCount">{{ t('Global.Counts.Video Count', { count: playlist.videos.length }, playlist.videos.length) }}</span>
            </span>
            <FtIcon
              class="stateIcon"
              :icon="containedIds.has(playlist._id) ? ['fas', 'bookmark'] : ['far', 'bookmark']"
              fixed-width
            />
          </li>
        </ul>
      </div>
      <button
        type="button"
        class="playlistRow createRow"
        @click="openCreatePlaylistPrompt"
      >
        <FtIcon
          :icon="['fas', 'plus']"
          fixed-width
        />
        <span>{{ t('User Playlists.Create New Playlist') }}</span>
      </button>
    </div>
  </FtMobileSheet>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, inject, ref, useTemplateRef } from 'vue'
import FtMobileSheet from '../FtMobileSheet/FtMobileSheet.vue'
import { usePhoneLayout } from '../../composables/usePhoneLayout'
import { useScrollClamp } from '../../composables/useScrollClamp'
import { useI18n } from 'vue-i18n'

import store from '../../store/index'
import { getVideoThumbnailUrl, showToast } from '../../helpers/utils'

import thumbnailPlaceholder from '../../assets/img/thumbnail_placeholder.svg'

const props = defineProps({
  videoData: {
    type: Object,
    required: true
  }
})

const { t } = useI18n()
const phoneLayout = usePhoneLayout()
const search = ref('')
const closeDropdown = inject('closeIconDropdown', () => {})
const sheetOpen = ref(true)
const listScroller = useTemplateRef('listScroller')
const listContent = useTemplateRef('listContent')
useScrollClamp(listScroller, listContent)
const filteredPlaylists = computed(() => playlists.value.filter(playlist =>
  playlist.playlistName.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())))

const allPlaylists = computed(() => store.getters.getAllPlaylists)

// Freeze the row order while the dropdown is open,
// otherwise toggling a playlist bumps its lastUpdatedAt and makes the rows jump around
const initialOrder = allPlaylists.value
  .slice()
  .sort((a, b) => (b.lastUpdatedAt ?? 0) - (a.lastUpdatedAt ?? 0))
  .map((playlist) => playlist._id)

const playlists = computed(() => {
  const playlistsById = new Map(allPlaylists.value.map((playlist) => [playlist._id, playlist]))

  const rows = []
  for (const id of initialOrder) {
    const playlist = playlistsById.get(id)
    if (playlist != null) {
      rows.push(playlist)
      playlistsById.delete(id)
    }
  }

  // Playlists created while the dropdown is open go at the end
  rows.push(...playlistsById.values())

  return rows
})

const videoThumbnail = computed(() => {
  return getVideoThumbnailUrl(
    props.videoData.videoId,
    store.getters.getBackendPreference,
    store.getters.getCurrentInvidiousInstanceUrl,
    store.getters.getThumbnailPreference
  )
})

const containedIds = computed(() => {
  const videoId = props.videoData.videoId

  return new Set(
    allPlaylists.value
      .filter((playlist) => playlist.videos.some((video) => video.videoId === videoId))
      .map((playlist) => playlist._id)
  )
})

/**
 * @param {object} playlist
 */
function playlistThumbnail(playlist) {
  if (playlist.videos.length === 0) {
    return thumbnailPlaceholder
  }

  const origin = store.getters.getBackendPreference === 'invidious'
    ? store.getters.getCurrentInvidiousInstanceUrl
    : 'https://i.ytimg.com'

  return `${origin}/vi/${playlist.videos[0].videoId}/mqdefault.jpg`
}

/**
 * @param {object} playlist
 */
async function togglePlaylist(playlist) {
  const playlistName = playlist.playlistName

  if (containedIds.value.has(playlist._id)) {
    const removed = await store.dispatch('removeVideo', {
      _id: playlist._id,
      // Remove all playlist items with the same videoId
      videoId: props.videoData.videoId,
    })

    showToast({
      message: removed
        ? t('Video.Video has been removed from {playlistName}', { playlistName })
        : t('Video.There was a problem removing the video from {playlistName}', { playlistName }),
      image: videoThumbnail.value,
      icon: ['fas', 'trash'],
    })
  } else {
    // Concurrent activations are collapsed by the store, so a rapid second
    // click (or the quick bookmark button) cannot append a duplicate entry
    const saved = await store.dispatch('addVideo', {
      _id: playlist._id,
      // The action mutates the passed object, so hand it a copy
      videoData: { ...props.videoData },
    })

    showToast({
      message: saved
        ? t('Video.Video has been saved to {playlistName}', { playlistName })
        : t('Video.There was a problem saving the video to {playlistName}', { playlistName }),
      image: videoThumbnail.value,
      icon: ['fas', 'bookmark'],
    })
  }
}

function openCreatePlaylistPrompt() {
  closeDropdown()
  store.dispatch('showCreatePlaylistPrompt', {
    title: store.getters.getNewPlaylistDefaultProperties.title || '',
    // The new playlist is created with this video already in it
    videos: [{ ...props.videoData }],
  })
}
</script>

<style scoped lang="scss" src="./FtAddToPlaylistDropdown.scss" />
