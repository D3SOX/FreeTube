<template>
  <router-link
    v-if="!selectable"
    class="bubblePadding"
    :aria-labelledby="id"
    :to="`/channel/${channelId}`"
    :data-tab-title="channelName"
  >
    <FtRetryImage
      v-if="channelThumbnail != null && !thumbnailLoadFailed"
      class="bubble"
      :src="channelThumbnail"
      alt=""
      @error="handleThumbnailError"
    />
    <FtIcon
      v-else
      :icon="['fas', 'circle-user']"
      class="bubble"
    />
    <div
      :id="id"
      class="channelName"
      dir="auto"
    >
      {{ channelName }}
    </div>
  </router-link>
  <div
    v-else
    class="bubblePadding"
    :aria-checked="selected"
    role="checkbox"
    tabindex="0"
    :aria-labelledby="id"
    @click="handleClick"
    @keydown.space.enter.prevent="handleClick"
  >
    <FtRetryImage
      v-if="channelThumbnail != null && !thumbnailLoadFailed"
      class="bubble"
      :src="channelThumbnail"
      alt=""
      @error="handleThumbnailError"
    />
    <FtIcon
      v-else
      :icon="['fas', 'circle-user']"
      class="bubble"
    />
    <div
      v-if="selected"
      class="bubble selected"
    >
      <FtIcon
        :icon="['fas', 'check']"
        class="icon"
      />
    </div>
    <div
      :id="id"
      class="channelName"
      dir="auto"
    >
      {{ channelName }}
    </div>
  </div>
</template>

<script setup>
import FtRetryImage from '../FtRetryImage.vue'
import { FtIcon } from '@opentubex/icons'
import { ref, useId, watch } from 'vue'

const props = defineProps({
  channelId: {
    type: String,
    required: true
  },
  channelName: {
    type: String,
    required: true
  },
  channelThumbnail: {
    type: String,
    default: null
  },
  selectable: {
    type: Boolean,
    default: false
  },
  selected: {
    type: Boolean,
    default: false
  }
})

const id = useId()
const thumbnailLoadFailed = ref(false)

watch(() => props.channelThumbnail, () => {
  thumbnailLoadFailed.value = false
})

const emit = defineEmits(['change'])

function handleClick() {
  emit('change', !props.selected)
}

function handleThumbnailError() {
  thumbnailLoadFailed.value = true
}
</script>

<style scoped src="./FtChannelBubble.css" />
