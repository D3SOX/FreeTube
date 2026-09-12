<template>
  <FtIconButton
    ref="iconButton"
    class="shareButton"
    :title="shareTitle"
    theme="secondary"
    :size="size"
    :icon="['fas', 'share-alt']"
    :dropdown-modal-on-mobile="true"
    dropdown-position-x="left"
    dropdown-class="content-width"
    :dropdown-position-y="dropdownPositionY"
    :force-dropdown="true"
  >
    <FtFlexBox>
      <FtToggleSwitch
        v-if="isVideo"
        :label="t('Share.Include Timestamp')"
        :compact="true"
        :default-value="includeTimestamp"
        @change="updateIncludeTimestamp"
      />
    </FtFlexBox>
    <div class="shareLinks">
      <div class="header">
        <img
          id="youtubeShareImage"
          class="youtubeLogo"
          src="~../../assets/img/yt_logo_mono_dark.png"
          alt="YouTube"
          width="794"
          height="178"
        >
      </div>

      <div class="buttons">
        <FtButton
          v-if="canShare"
          class="action"
          aria-describedby="youtubeShareImage"
          :icon="['fas', 'share-alt']"
          :label="t('Share.Share Link')"
          @click="shareYoutube"
        />
        <FtButton
          class="action"
          aria-describedby="youtubeShareImage"
          :icon="['fas', 'copy']"
          :label="t('Share.Copy Link')"
          @click="copyYoutube"
        />
        <FtButton
          class="action"
          aria-describedby="youtubeShareImage"
          :icon="['fas', 'globe']"
          :label="t('Share.Open Link')"
          @click="openYoutube"
        />
        <FtButton
          v-if="isVideo || isPlaylist"
          class="action"
          aria-describedby="youtubeShareImage"
          background-color="var(--accent-color-active)"
          :icon="['fas', 'copy']"
          :label="t('Share.Copy Embed')"
          @click="copyYoutubeEmbed"
        />
        <FtButton
          v-if="isVideo || isPlaylist"
          class="action"
          aria-describedby="youtubeShareImage"
          background-color="var(--accent-color-active)"
          :icon="['fas', 'globe']"
          :label="t('Share.Open Embed')"
          @click="openYoutubeEmbed"
        />
      </div>

      <template v-if="showInvidiousOptions">
        <div class="divider" />

        <div
          id="invidiousShare"
          class="header invidious"
        >
          <span class="invidiousLogo" /> Invidious
        </div>

        <div class="buttons">
          <FtButton
            v-if="canShare"
            class="action"
            aria-describedby="invidiousShare"
            :icon="['fas', 'share-alt']"
            :label="t('Share.Share Link')"
            @click="shareInvidious"
          />
          <FtButton
            aria-describedby="invidiousShare"
            class="action"
            :icon="['fas', 'copy']"
            :label="t('Share.Copy Link')"
            @click="copyInvidious"
          />
          <FtButton
            aria-describedby="invidiousShare"
            class="action"
            :icon="['fas', 'globe']"
            :label="t('Share.Open Link')"
            @click="openInvidious"
          />
          <FtButton
            v-if="isVideo || isPlaylist"
            aria-describedby="invidiousShare"
            class="action"
            background-color="var(--accent-color-active)"
            :icon="['fas', 'copy']"
            :label="t('Share.Copy Embed')"
            @click="copyInvidiousEmbed"
          />
          <FtButton
            v-if="isVideo || isPlaylist"
            aria-describedby="invidiousShare"
            class="action"
            background-color="var(--accent-color-active)"
            :icon="['fas', 'globe']"
            :label="t('Share.Open Embed')"
            @click="openInvidiousEmbed"
          />
        </div>
      </template>
    </div>
  </FtIconButton>
</template>

<script setup>
import { computed, ref, useTemplateRef } from 'vue'
import { copyToClipboard, openExternalLink, shareLink } from '../../helpers/utils'
import { appendTimestamp, getInvidiousVideoUrl, getYoutubeVideoShareUrl } from '../../helpers/share'
import { useI18n } from 'vue-i18n'

import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import FtButton from '../FtButton/FtButton.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'
import store from '../../store/index'

const { t } = useI18n()
const canShare = process.env.IS_CAPACITOR || (process.env.IS_ELECTRON && ['darwin', 'win32'].includes(process.platform))

const props = defineProps({
  shareTargetType: {
    /**
     * Allows to render the dropdown conditionally
     * 'Channel' will exclude embed links
     * 'Video' (default) keeps the original behaviour
     */
    type: String,
    default: 'Video'
  },
  id: {
    type: String,
    required: true
  },
  playlistId: {
    type: String,
    default: ''
  },
  getTimestamp: {
    type: Function,
    default: null
  },
  dropdownPositionY: {
    type: String,
    default: 'bottom'
  },
  size: {
    type: Number,
    default: 20
  }
})

const includeTimestamp = ref(false)
const iconButton = useTemplateRef('iconButton')

const isChannel = computed(() => {
  return props.shareTargetType === 'Channel'
})

const isPlaylist = computed(() => {
  return props.shareTargetType === 'Playlist'
})

const isPost = computed(() => {
  return props.shareTargetType === 'Post'
})

const isVideo = computed(() => {
  return props.shareTargetType === 'Video'
})

const shareTitle = computed(() => {
  if (isChannel.value) {
    return t('Share.Share Channel')
  }
  if (isPlaylist.value) {
    return t('Share.Share Playlist')
  }
  if (isPost.value) {
    return t('Share.Share Post')
  }
  return t('Share.Share Video')
})

const currentInvidiousInstanceUrl = computed(() => {
  return store.getters.getCurrentInvidiousInstanceUrl
})

const showInvidiousOptions = computed(() => {
  return store.getters.getBackendPreference === 'invidious' || store.getters.getBackendFallback
})

const selectedUserPlaylist = computed(() => {
  if (props.playlistId == null || props.playlistId === '') { return null }

  return store.getters.getPlaylist(props.playlistId)
})

const playlistSharable = computed(() => {
  // `playlistId` can be undefined
  // User playlist ID should not be shared
  return props.playlistId && props.playlistId.length !== 0 && selectedUserPlaylist.value == null
})

const invidiousURL = computed(() => {
  if (isChannel.value) {
    return `${currentInvidiousInstanceUrl.value}/channel/${props.id}`
  }
  if (isPlaylist.value) {
    return `${currentInvidiousInstanceUrl.value}/playlist?list=${props.id}`
  }
  if (isPost.value) {
    return `${currentInvidiousInstanceUrl.value}/post/${props.id}`
  }
  return getInvidiousVideoUrl(
    currentInvidiousInstanceUrl.value,
    props.id,
    playlistSharable.value ? props.playlistId : ''
  )
})

const invidiousEmbedURL = computed(() => {
  if (isPlaylist.value) {
    return `${currentInvidiousInstanceUrl.value}/embed/videoseries?list=${props.id}`
  }
  return `${currentInvidiousInstanceUrl.value}/embed/${props.id}`
})

const youtubeChannelUrl = computed(() => {
  return `https://www.youtube.com/channel/${props.id}`
})

const youtubePlaylistUrl = computed(() => {
  return `https://youtube.com/playlist?list=${props.id}`
})

const youtubeURL = computed(() => {
  if (isChannel.value) {
    return youtubeChannelUrl.value
  }
  if (isPlaylist.value) {
    return youtubePlaylistUrl.value
  }
  if (isPost.value) {
    return `https://www.youtube.com/post/${props.id}`
  }
  let videoUrl = `https://www.youtube.com/watch?v=${props.id}`
  if (playlistSharable.value) {
    // `index` seems can be ignored
    videoUrl += `&list=${props.playlistId}`
  }
  return videoUrl
})

const youtubeShareURL = computed(() => {
  if (isChannel.value) {
    return youtubeChannelUrl.value
  }
  if (isPlaylist.value) {
    return youtubePlaylistUrl.value
  }
  if (isPost.value) {
    return `https://www.youtube.com/post/${props.id}`
  }
  return getYoutubeVideoShareUrl(props.id, playlistSharable.value ? props.playlistId : '')
})

const youtubeEmbedURL = computed(() => {
  if (isPlaylist.value) {
    return `https://www.youtube-nocookie.com/embed/videoseries?list=${props.id}`
  }
  return `https://www.youtube-nocookie.com/embed/${props.id}`
})

if (isVideo.value && !props.getTimestamp) {
  console.error('Error in props validation: A Video FtShareButton requires a valid get-timestamp function.')
}

function shareYoutube() {
  const url = getFinalUrl(youtubeShareURL.value)
  iconButton.value.hideDropdown()
  return shareLink(url)
}

function shareInvidious() {
  const url = getFinalUrl(invidiousURL.value)
  iconButton.value.hideDropdown()
  return shareLink(url)
}

function openInvidious() {
  openExternalLink(getFinalUrl(invidiousURL.value))
  iconButton.value.hideDropdown()
}

function copyInvidious() {
  copyToClipboard(getFinalUrl(invidiousURL.value), {
    messageOnSuccess: getCopySuccessMessage(t('Share.Invidious URL copied to clipboard'))
  })
  iconButton.value.hideDropdown()
}

function openYoutube() {
  openExternalLink(getFinalUrl(youtubeURL.value))
  iconButton.value.hideDropdown()
}

function copyYoutube() {
  copyToClipboard(getFinalUrl(youtubeShareURL.value), {
    messageOnSuccess: getCopySuccessMessage(t('Share.YouTube URL copied to clipboard'))
  })
  iconButton.value.hideDropdown()
}

function openYoutubeEmbed() {
  openExternalLink(getFinalUrl(youtubeEmbedURL.value))
  iconButton.value.hideDropdown()
}

function copyYoutubeEmbed() {
  copyToClipboard(getFinalUrl(youtubeEmbedURL.value), {
    messageOnSuccess: getCopySuccessMessage(t('Share.YouTube Embed URL copied to clipboard'))
  })
  iconButton.value.hideDropdown()
}

function openInvidiousEmbed() {
  openExternalLink(getFinalUrl(invidiousEmbedURL.value))
  iconButton.value.hideDropdown()
}

function copyInvidiousEmbed() {
  copyToClipboard(getFinalUrl(invidiousEmbedURL.value), {
    messageOnSuccess: getCopySuccessMessage(t('Share.Invidious Embed URL copied to clipboard'))
  })
  iconButton.value.hideDropdown()
}

function getCopySuccessMessage(defaultMessage) {
  return includeTimestamp.value ? t('Share.Timestamp Link Copied') : defaultMessage
}

function updateIncludeTimestamp() {
  includeTimestamp.value = !includeTimestamp.value
}

function getFinalUrl(url) {
  if (isChannel.value || isPlaylist.value || isPost.value) {
    return url
  }
  return includeTimestamp.value ? appendTimestamp(url, props.getTimestamp()) : url
}
</script>
<style scoped src="./FtShareButton.css" />
