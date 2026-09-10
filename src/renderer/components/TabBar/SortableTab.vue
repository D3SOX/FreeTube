<template>
  <TabTooltip
    :title="displayTitle"
    :tabs="[tab]"
    :group="group"
    :is-active="tab.isActive"
    :tab-bar-position="tabBarPosition"
    :disable-tooltips="disableTooltips || isDragging"
    :close-tooltips-signal="closeTooltipsSignal"
    :show-preview="showPreview"
  >
    <template #anchor="{ bindings }">
      <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events -->
      <div
        v-bind="bindings"
        class="tab tabBarReorderItem"
        :data-tab-id="tab.id"
        :data-reorder-id="tab.id"
        :class="tabClasses"
        :style="tabStyle"
        :aria-label="displayTitle"
        :aria-pressed="isSelected"
        role="button"
        tabindex="-1"
        @click="handleClick"
        @mousedown.middle.prevent
        @auxclick.prevent="handleAuxClick"
      >
        <FtIcon
          v-if="tab.isPinned"
          :icon="['fas', 'thumbtack']"
          class="pinBadge"
          aria-hidden="true"
        />
        <span class="tabTitle">
          <FtIcon
            v-if="group"
            :icon="['fas', 'layer-group']"
            class="groupBadge"
            aria-hidden="true"
          />
          <span
            v-if="tab.isLoading"
            class="loadingDot"
            aria-hidden="true"
          />
          <FtIcon
            v-else-if="tab.isPlaying"
            :icon="['fas', 'play']"
            class="playingIcon"
            aria-hidden="true"
          />
          <FtRetryImage
            v-else-if="showIcon && usableTabAvatarUrl"
            :src="tabAvatarUrl"
            class="tabAvatar"
            alt=""
            draggable="false"
            @error="handleAvatarError"
          />
          <FtIcon
            v-else-if="showIcon && tabPageIcon"
            :icon="tabPageIcon"
            class="tabPageIcon"
            aria-hidden="true"
          />
          <span class="tabTitleText">{{ displayTitle }}</span>
        </span>
        <button
          class="closeButton"
          :aria-label="closeLabel"
          :title="closeLabel"
          @click.stop="$emit('close', tab.id)"
          @pointerdown.stop
        >
          <FtIcon
            :icon="['fas', 'times']"
            class="closeIcon"
          />
        </button>
      </div>
    </template>
  </TabTooltip>
</template>

<script setup>
import FtRetryImage from '../FtRetryImage.vue'
import { FtIcon } from '@opentubex/icons'
import { computed, ref, watch } from 'vue'
import { getTabAccentColor } from '../../constants/tabColors'
import { getTabAvatarUrl, getTabPageIcon, getTabPreviewFallbackUrl } from '../../tabs/tabPreview'
import { formatTabTitle } from '../../tabs/tabTitle'
import TabTooltip from './TabTooltip.vue'

const props = defineProps({
  tab: {
    type: Object,
    required: true
  },
  group: {
    type: Object,
    default: null
  },
  closeLabel: {
    type: String,
    default: 'Close Tab'
  },
  index: {
    type: Number,
    required: true
  },
  offset: {
    type: Number,
    default: 0
  },
  vertical: {
    type: Boolean,
    default: false
  },
  tabBarPosition: {
    type: String,
    default: 'top',
    validator: value => ['top', 'bottom', 'left', 'right'].includes(value)
  },
  isDragging: {
    type: Boolean,
    default: false
  },
  isSettling: {
    type: Boolean,
    default: false
  },
  suppressTransition: {
    type: Boolean,
    default: false
  },
  disableTooltips: {
    type: Boolean,
    default: false
  },
  closeTooltipsSignal: {
    type: Number,
    default: 0
  },
  showIcon: {
    type: Boolean,
    default: true
  },
  showPreview: {
    type: Boolean,
    default: true
  },
  isSelected: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['activate', 'close', 'middleClick'])

const failedAvatarUrl = ref(null)

const tabColor = computed(() => getTabAccentColor(props.tab.color))
const groupColor = computed(() => getTabAccentColor(props.group?.color))

const tabClasses = computed(() => ({
  active: props.tab.isActive,
  loading: props.tab.isLoading,
  unloaded: props.tab.isUnloaded,
  playing: props.tab.isPlaying,
  pinned: props.tab.isPinned,
  colored: tabColor.value != null,
  selected: props.isSelected,
  dragging: props.isDragging,
  settling: props.isSettling,
  noTransition: props.suppressTransition,
  vertical: props.vertical,
  bottom: props.tabBarPosition === 'bottom'
}))

const tabStyle = computed(() => {
  const translation = props.vertical ? `0, ${props.offset}px` : `${props.offset}px, 0`
  const transform = props.offset !== 0 ? `translate3d(${translation}, 0)` : ''
  /** @type {Record<string, string | undefined>} */
  const style = {
    transform: transform || undefined,
    '--tab-accent-color': tabColor.value || undefined,
    '--tab-group-color': groupColor.value || 'var(--secondary-text-color)'
  }

  return style
})

const displayTitle = computed(() => formatTabTitle(props.tab.title))

// When a tab points at a channel page and no screenshot has been captured yet,
// fall back to the channel's profile picture (cached by the Channel view).
const tabAvatarUrl = computed(() => getTabAvatarUrl(props.tab))
const previewFallbackUrl = computed(() => getTabPreviewFallbackUrl(props.tab))
const usableTabAvatarUrl = computed(() => {
  const avatarUrl = tabAvatarUrl.value || previewFallbackUrl.value
  return avatarUrl !== failedAvatarUrl.value ? avatarUrl : null
})
const tabPageIcon = computed(() => getTabPageIcon(props.tab))

function handleAvatarError() {
  failedAvatarUrl.value = usableTabAvatarUrl.value
}

function handleClick(event) {
  emit('activate', event, props.tab.id)
}

/**
 * @param {MouseEvent} event
 */
function handleAuxClick(event) {
  if (event.button === 1) {
    emit('middleClick', event, props.tab.id)
  }
}

watch(tabAvatarUrl, (avatarUrl) => {
  if (avatarUrl !== failedAvatarUrl.value) {
    failedAvatarUrl.value = null
  }
})
</script>

<style scoped>
.tab {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  padding-inline: 10px;
  padding-block: 6px;
  background-color: var(--tab-surface-color, var(--bg-color));
  border-radius: calc(6px * var(--ui-roundness)) calc(6px * var(--ui-roundness)) 0 0;
  cursor: pointer;
  block-size: 30px;

  /* Without a configured fixed width, tabs size to their content within these
     bounds. `--fixed-tab-width` (set by the tab bar) pins both ends together. */
  min-inline-size: var(--fixed-tab-width, 100px);
  max-inline-size: var(--fixed-tab-width, 200px);
  flex-shrink: 0;
  border: 1px solid transparent;
  border-block-end: 0;
  transition: background-color 0.15s ease, transform 0.2s ease;
  position: relative;
  user-select: none;
  touch-action: none;
  will-change: transform;
  --tab-accent-mix: 18%;
  --tab-accent-border-mix: 55%;
}

.tab.noTransition {
  transition: background-color 0.15s ease;
}

.tab.vertical {
  inline-size: calc(100% - 1px);
  min-inline-size: 0;
  max-inline-size: none;
  border-radius: calc(6px * var(--ui-roundness));
  border-block-end: 1px solid transparent;
}

.tab.bottom {
  border-radius: 0 0 calc(6px * var(--ui-roundness)) calc(6px * var(--ui-roundness));
  border-block-start: 0;
  border-block-end: 1px solid transparent;
}

.tab.vertical.active {
  border-color: var(--tab-border-color, var(--border-color));
}

.tab.vertical.colored {
  box-shadow: inset 2px 0 0 var(--tab-accent-color);
}

.tab.vertical.pinned {
  inline-size: calc(100% - 1px);
  min-inline-size: 0;
  max-inline-size: none;
}

.tab:hover {
  background-color: var(--tab-hover-color, var(--card-bg-color));
}

.tab.active {
  background-color: var(--tab-active-color, var(--card-bg-color));
  border-color: var(--tab-border-color, var(--border-color));
}

.tab.selected {
  background-color: color-mix(in srgb, var(--accent-color) 22%, var(--card-bg-color));
  outline: 2px solid var(--accent-color, var(--primary-text-color));
  outline-offset: -2px;
}

.tab.selected:hover {
  background-color: color-mix(in srgb, var(--accent-color) 28%, var(--card-bg-color));
}

.tab.colored {
  --tab-surface-color: color-mix(in srgb, var(--tab-accent-color) var(--tab-accent-mix), var(--bg-color));
  --tab-hover-color: color-mix(in srgb, var(--tab-accent-color) 22%, var(--card-bg-color));
  --tab-active-color: color-mix(in srgb, var(--tab-accent-color) 26%, var(--card-bg-color));
  --tab-border-color: color-mix(in srgb, var(--tab-accent-color) var(--tab-accent-border-mix), var(--border-color));

  box-shadow: inset 0 2px 0 var(--tab-accent-color);
}

.tab.pinned {
  inline-size: var(--fixed-tab-width, 72px);
  min-inline-size: var(--fixed-tab-width, 72px);
  max-inline-size: var(--fixed-tab-width, 72px);
  padding-inline: 9px 7px;
  gap: 4px;
}

.tab.loading {
  opacity: 0.8;
}

.tab.unloaded .tabTitle {
  color: var(--secondary-text-color);
  opacity: 0.72;
}

.tab.unloaded:hover .tabTitle,
.tab.unloaded.active .tabTitle,
.tab.unloaded.loading .tabTitle {
  opacity: 1;
}

.tab.dragging {
  z-index: 10;
  cursor: grabbing;
  transition: background-color 0.15s ease;
  box-shadow: 0 4px 12px rgb(0 0 0 / 18%);
}

.tab.settling {
  z-index: 10;
}

.tabTitle {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  block-size: 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 16px;
  color: var(--primary-text-color);
}

.groupBadge {
  color: var(--tab-group-color);
  flex: 0 0 auto;
  font-size: 10px;
}

.tabAvatar {
  inline-size: 16px;
  block-size: 16px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.tabPageIcon {
  inline-size: 13px;
  font-size: 12px;
  color: var(--secondary-text-color);
  flex-shrink: 0;
}

.tabTitleText {
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab.pinned .tabTitle {
  padding-inline-start: 9px;
}

.pinBadge {
  position: absolute;
  inset-block-start: 50%;
  inset-inline-start: 5px;
  transform: translateY(-50%);
  font-size: 8px;
  color: var(--tab-accent-color, var(--secondary-text-color));
  opacity: 0.92;
  pointer-events: none;
}

.loadingDot {
  display: inline-block;
  inline-size: 6px;
  block-size: 6px;
  flex: 0 0 6px;
  border-radius: 50%;
  background-color: var(--accent-color, var(--primary-text-color));
  animation: tab-loading-pulse 0.9s ease-in-out infinite;
  vertical-align: middle;
}

@keyframes tab-loading-pulse {
  0% {
    transform: scale(0.7);
    opacity: 0.5;
  }

  50% {
    transform: scale(1);
    opacity: 1;
  }

  100% {
    transform: scale(0.7);
    opacity: 0.5;
  }
}

.playingIcon {
  font-size: 8px;
  color: var(--accent-color, var(--primary-text-color));
  flex-shrink: 0;
}

.closeButton {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 0;
  cursor: pointer;
  padding: 2px;
  border-radius: calc(4px * var(--ui-roundness));
  color: var(--tertiary-text-color);
  opacity: 0;
  transition: opacity 0.15s ease, background-color 0.15s ease, color 0.15s ease;
  flex-shrink: 0;
}

.tab.pinned .closeButton {
  position: absolute;
  inset-inline-end: 3px;
  inset-block-start: 50%;
  transform: translateY(-50%);
  background-color: var(--tab-active-color, var(--card-bg-color));
}

.tab.vertical.pinned .closeButton {
  inset-inline-end: 10px;
}

.tab.pinned:hover .tabTitle {
  padding-inline-end: 12px;
}

.closeButton:hover {
  background-color: var(--destructive-color);
  color: var(--destructive-text-color);
}

.tab.pinned .closeButton:hover {
  background-color: var(--destructive-color);
  color: var(--destructive-text-color);
}

.tab:hover .closeButton,
.tab.active .closeButton {
  opacity: 1;
}

.tab.pinned.active:not(:hover) .closeButton {
  opacity: 0;
  pointer-events: none;
}

.closeIcon {
  font-size: 10px;
}

</style>
