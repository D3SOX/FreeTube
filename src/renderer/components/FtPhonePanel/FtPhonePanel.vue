<template>
  <div
    class="phonePanelHost"
    :class="{ hiddenPanel: enabled && !open }"
  >
    <FtMobileSheet
      :enabled="enabled"
      :open="open"
      :title="title"
      below-player
      @close="emit('close')"
    >
      <template
        v-if="customHeader"
        #heading
      >
        <div
          ref="panelHeader"
          class="phonePanelHeaderContent"
        />
      </template>
      <div
        ref="scroller"
        v-overlay-scrollbars="enabled && !fill"
        :class="{ phonePanelScroller: enabled && !fill, phonePanelFrame: enabled && fill }"
      >
        <div
          ref="content"
          class="panelContent"
          :class="{ phonePanelContent: enabled, fillPanel: enabled && fill }"
        >
          <slot />
        </div>
      </div>
    </FtMobileSheet>
  </div>
</template>

<script setup>
import { computed, nextTick, provide, useTemplateRef, watch } from 'vue'
import FtMobileSheet from '../FtMobileSheet/FtMobileSheet.vue'
import { useScrollClamp } from '../../composables/useScrollClamp'
import { restoreOverlayScrollTop } from '../../helpers/overlayScrollbars'

const props = defineProps({
  enabled: { type: Boolean, default: false },
  open: { type: Boolean, default: false },
  customHeader: { type: Boolean, default: false },
  fill: { type: Boolean, default: false },
  title: { type: String, required: true }
})
const emit = defineEmits(['close'])
const panelHeader = useTemplateRef('panelHeader')
provide('phonePanelHeader', computed(() => props.enabled ? panelHeader.value : null))
const scroller = useTemplateRef('scroller')
const content = useTemplateRef('content')
const clamp = useScrollClamp(scroller, content)
let readingPosition = 0
watch(() => props.open, async (open) => {
  if (!open) {
    readingPosition = scroller.value?.scrollTop ?? 0
  } else {
    await nextTick()
    const element = scroller.value
    if (!props.open || !element) return
    restoreOverlayScrollTop(element, readingPosition)
    clamp()
  }
}, { flush: 'pre' })
</script>

<style scoped src="./FtPhonePanel.css" />
