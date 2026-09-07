<template>
  <span
    class="capacitorTabPreview"
    aria-hidden="true"
  >
    <img
      v-if="pagePreview"
      :src="pagePreview"
      class="capacitorTabThumbnail"
      draggable="false"
      alt=""
    >
    <FtRetryImage
      v-else-if="thumbnailUrl"
      v-show="failedThumbnailUrl !== thumbnailUrl"
      :src="thumbnailUrl"
      class="capacitorTabThumbnail"
      loading="lazy"
      draggable="false"
      @error="failedThumbnailUrl = thumbnailUrl"
      @load="failedThumbnailUrl = null"
    />
    <FtRetryImage
      v-if="!pagePreview && avatarUrl && (!thumbnailUrl || failedThumbnailUrl === thumbnailUrl)"
      v-show="failedAvatarUrl !== avatarUrl"
      :src="avatarUrl"
      class="capacitorPhoneTabAvatar capacitorTabPreviewAvatar"
      loading="lazy"
      draggable="false"
      @error="failedAvatarUrl = avatarUrl"
      @load="failedAvatarUrl = null"
    />
    <FtIcon
      v-if="!pagePreview && (!thumbnailUrl || failedThumbnailUrl === thumbnailUrl) && (!avatarUrl || failedAvatarUrl === avatarUrl)"
      :icon="getTabPageIcon(tab) || ['fas', 'display']"
    />
    <FtIcon
      v-if="tab.isPinned"
      class="capacitorTabPreviewPin"
      :icon="['fas', 'thumbtack']"
    />
  </span>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, ref } from 'vue'
import store from '../../store/index'
import { getVideoThumbnailUrl } from '../../helpers/utils'
import { getTabAvatarUrl, getTabPageIcon } from '../../tabs/tabPreview'
import { getCapacitorTabPreview } from '../../tabs/capacitorTabPreviews'
import FtRetryImage from '../FtRetryImage.vue'

const props = defineProps({
  tab: { type: Object, required: true },
})
const pagePreview = computed(() => store.getters.getShowTabPreviews ? getCapacitorTabPreview(props.tab) : null)
const failedThumbnailUrl = ref(null)
const failedAvatarUrl = ref(null)
const avatarUrl = computed(() => getTabAvatarUrl(props.tab))
const thumbnailUrl = computed(() => {
  const videoId = props.tab.route?.path?.match(/^\/watch\/([^/]+)/)?.[1]
  return videoId
    ? getVideoThumbnailUrl(
        videoId,
        store.getters.getBackendPreference,
        store.getters.getCurrentInvidiousInstanceUrl,
        store.getters.getThumbnailPreference
      )
    : null
})
</script>

<style scoped src="./CapacitorTabPreview.css" />
