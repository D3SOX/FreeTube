<template>
  <div class="tabTooltipPreview">
    <img
      v-if="previewUrl"
      :src="previewUrl"
      alt=""
      draggable="false"
      @error="previewUrl = null"
    >
    <img
      v-else-if="avatarUrl && avatarUrl !== failedAvatarUrl"
      :src="avatarUrl"
      alt=""
      class="tabTooltipPreviewAvatar"
      draggable="false"
      @error="failedAvatarUrl = avatarUrl"
    >
    <div
      v-else
      class="tabTooltipPreviewFallback"
      aria-hidden="true"
    >
      <FtIcon
        :icon="getTabPageIcon(tab) || ['fas', 'display']"
        class="tabTooltipFallbackIcon"
      />
    </div>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { getTabAvatarUrl, getTabPageIcon, getTabPreviewFallbackUrl } from '../../tabs/tabPreview'

const props = defineProps({ tab: { type: Object, required: true } })
const previewUrl = ref(null)
const failedAvatarUrl = ref(null)
const avatarUrl = computed(() => getTabAvatarUrl(props.tab) || getTabPreviewFallbackUrl(props.tab))
let requestId = 0

watch(() => props.tab.id, async tabId => {
  const currentRequestId = ++requestId
  previewUrl.value = null
  if (!process.env.IS_ELECTRON || typeof window.ftElectron?.tabs?.capturePreview !== 'function') return
  try {
    const dataUrl = await window.ftElectron.tabs.capturePreview(tabId)
    if (currentRequestId === requestId) {
      previewUrl.value = typeof dataUrl === 'string' && dataUrl.length > 0 ? dataUrl : null
    }
  } catch {
    // Unloaded tabs or failed captures keep their avatar or page icon.
  }
}, { immediate: true })

onBeforeUnmount(() => { requestId++ })
</script>

<style scoped>
.tabTooltipPreview {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 16 / 9;
  inline-size: 100%;
  overflow: hidden;
  border-radius: calc(5px * var(--ui-roundness));
  background-color: var(--secondary-card-bg-color);
  backdrop-filter: var(--secondary-card-bg-blur, none);
}

.tabTooltipPreview img {
  display: block;
  inline-size: 100%;
  block-size: 100%;
  object-fit: contain;
}

.tabTooltipPreview .tabTooltipPreviewAvatar {
  inline-size: auto;
  block-size: 72%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 50%;
}

.tabTooltipPreviewFallback {
  display: flex;
  align-items: center;
  justify-content: center;
  inline-size: 100%;
  block-size: 100%;
  color: var(--tertiary-text-color);
}

.tabTooltipFallbackIcon {
  font-size: 24px;
  opacity: 0.72;
}

</style>
