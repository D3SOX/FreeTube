<template>
  <div class="tabTooltipPreview">
    <img
      v-if="previewUrl"
      :src="previewUrl"
      alt=""
      draggable="false"
      @error="previewUrl = null"
    >
    <FtRetryImage
      v-else-if="avatarUrl && avatarUrl !== failedAvatarUrl"
      :src="avatarUrl"
      alt=""
      class="tabTooltipPreviewAvatar"
      draggable="false"
      @error="failedAvatarUrl = avatarUrl"
    />
    <div
      v-else
      class="tabTooltipPreviewFallback"
      aria-hidden="true"
    >
      <FtIcon
        :icon="pageIcon || ['fas', 'display']"
        class="tabTooltipFallbackIcon"
      />
    </div>
  </div>
  <div
    v-if="showTitle"
    class="tabTooltipGridTitle"
  >
    <FtRetryImage
      v-if="showIcon && avatarUrl && avatarUrl !== failedAvatarUrl"
      :src="avatarUrl"
      class="tabTooltipGridTitleAvatar"
      alt=""
      draggable="false"
      @error="failedAvatarUrl = avatarUrl"
    />
    <FtIcon
      v-else-if="showIcon && pageIcon"
      :icon="pageIcon"
      class="tabTooltipGridTitleIcon"
      aria-hidden="true"
    />
    <span class="tabTooltipGridTitleText">{{ formatTabTitle(tab.title) }}</span>
  </div>
</template>

<script setup>
import FtRetryImage from '../FtRetryImage.vue'
import { FtIcon } from '@opentubex/icons'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { getTabAvatarUrl, getTabPageIcon, getTabPreviewFallbackUrl } from '../../tabs/tabPreview'
import { formatTabTitle } from '../../tabs/tabTitle'

const props = defineProps({
  tab: { type: Object, required: true },
  showTitle: { type: Boolean, default: false },
  showIcon: { type: Boolean, default: true }
})
const previewUrl = ref(null)
const failedAvatarUrl = ref(null)
const avatarUrl = computed(() => getTabAvatarUrl(props.tab) || getTabPreviewFallbackUrl(props.tab))
const pageIcon = computed(() => getTabPageIcon(props.tab))
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

.tabTooltipGridTitle {
  display: flex;
  align-items: center;
  gap: 6px;
  min-inline-size: 0;
  font-size: 12px;
  line-height: 1.35;
  flex-shrink: 0;
}

.tabTooltipGridTitleText {
  min-inline-size: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tabTooltipGridTitleAvatar,
.tabTooltipGridTitleIcon {
  inline-size: 14px;
  block-size: 14px;
  flex-shrink: 0;
}

.tabTooltipGridTitleAvatar {
  border-radius: 50%;
  object-fit: cover;
}

.tabTooltipGridTitleIcon {
  color: var(--secondary-text-color);
}
</style>
