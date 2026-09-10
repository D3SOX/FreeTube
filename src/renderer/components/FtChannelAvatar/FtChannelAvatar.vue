<template>
  <span
    class="channelAvatar"
    aria-hidden="true"
  >
    <FtRetryImage
      v-if="thumbnail && !thumbnailLoadFailed"
      class="channelAvatarImage"
      :src="thumbnail"
      alt=""
      width="24"
      height="24"
      loading="lazy"
      decoding="async"
      @error="thumbnailLoadFailed = true"
    />
    <FtIcon
      v-else
      class="channelAvatarFallback"
      :icon="['fas', 'circle-user']"
    />
  </span>
</template>

<script setup>
import FtRetryImage from '../FtRetryImage.vue'
import { FtIcon } from '@opentubex/icons'
import { ref, watch } from 'vue'

const props = defineProps({
  thumbnail: {
    type: String,
    default: null
  }
})

const thumbnailLoadFailed = ref(false)

watch(() => props.thumbnail, () => {
  thumbnailLoadFailed.value = false
})
</script>

<style scoped src="./FtChannelAvatar.css" />
