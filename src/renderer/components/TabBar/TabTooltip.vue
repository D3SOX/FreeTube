<template>
  <slot
    name="anchor"
    :bindings="triggerBindings"
  />
  <Teleport to="body">
    <Transition name="tab-tooltip">
      <div
        v-if="isTooltipVisible"
        :id="tooltipId"
        ref="tooltipRef"
        class="tabTooltip"
        :class="{ withPreview: showPreview, tabGroupTooltip: isGroup }"
        data-tab-preview-overlay
        :style="tooltipStyle"
        role="tooltip"
      >
        <div class="tabTooltipTitle">
          {{ title }}
        </div>
        <div
          v-if="isGroup"
          class="tabTooltipCount"
        >
          {{ t('Tab Organizer.Tab Count', { count: tabs.length }, tabs.length) }}
        </div>
        <div
          v-else-if="group"
          class="tabTooltipGroup"
          :style="{ '--tab-group-color': getTabAccentColor(group.color) || 'var(--secondary-text-color)' }"
        >
          <FtIcon
            :icon="['fas', 'layer-group']"
            class="tabTooltipGroupIcon"
            aria-hidden="true"
          />
          {{ group.name }}
        </div>
        <template v-if="showPreview">
          <div
            v-if="isGroup"
            class="tabTooltipGrid"
          >
            <div
              v-for="tab in previewTabs"
              :key="tab.id"
              class="tabTooltipGridItem"
            >
              <TabTooltipPreview
                :tab="tab"
                show-title
                :show-icon="showIcon"
              />
            </div>
          </div>
          <TabTooltipPreview
            v-else-if="tabs[0]"
            :tab="tabs[0]"
          />
          <div
            v-if="isGroup && tabs.length > previewTabs.length"
            class="tabTooltipCount tabTooltipRemaining"
          >
            {{ `+${tabs.length - previewTabs.length}` }}
          </div>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getTabAccentColor } from '../../constants/tabColors'
import TabTooltipPreview from './TabTooltipPreview.vue'

const props = defineProps({
  title: { type: String, required: true },
  tabs: { type: Array, required: true },
  group: { type: Object, default: null },
  isGroup: { type: Boolean, default: false },
  isActive: { type: Boolean, default: false },
  tabBarPosition: { type: String, default: 'top' },
  disableTooltips: { type: Boolean, default: false },
  closeTooltipsSignal: { type: Number, default: 0 },
  showPreview: { type: Boolean, default: true },
  showIcon: { type: Boolean, default: true }
})

const { t } = useI18n()
const TOOLTIP_MAX_WIDTH_PX = 340
const TOOLTIP_MARGIN_PX = 8
const TOOLTIP_OFFSET_PX = 6
const TOOLTIP_SHOW_DELAY_MS = 80
const tabRef = ref(null)
const tooltipRef = useTemplateRef('tooltipRef')
const tooltipId = useId()
const isTooltipVisible = ref(false)
const tooltipStyle = ref({})
// Keep large groups quick to inspect without turning a hover tooltip into a scroller.
const previewTabs = computed(() => props.tabs.slice(0, 6))
const resizeObserver = new ResizeObserver(updateTooltipPosition)
let showTooltipTimeoutId = null
let suppressTooltipUntilPointerLeave = false

const triggerBindings = computed(() => ({
  ref: element => { tabRef.value = element },
  'aria-describedby': isTooltipVisible.value ? tooltipId : undefined,
  onPointerenter: handlePointerEnter,
  onPointerleave: handlePointerLeave,
  onFocusin: showTooltip,
  onFocusout: hideTooltip,
  onPointerdown: handlePointerDown
}))

function showTooltip() {
  if (props.disableTooltips || suppressTooltipUntilPointerLeave) {
    return
  }

  clearShowTooltipTimeout()
  showTooltipTimeoutId = window.setTimeout(() => {
    showTooltipTimeoutId = null
    if (props.disableTooltips || suppressTooltipUntilPointerLeave) {
      return
    }

    updateTooltipPosition()
    isTooltipVisible.value = true
    nextTick(updateTooltipPosition)
    addTooltipDismissListeners()
    window.addEventListener('resize', updateTooltipPosition)
    nextTick(() => {
      if (isTooltipVisible.value && tooltipRef.value) resizeObserver.observe(tooltipRef.value)
    })
  }, TOOLTIP_SHOW_DELAY_MS)
}

function handlePointerEnter() {
  suppressTooltipUntilPointerLeave = false
  showTooltip()
}

function handlePointerLeave() {
  if (document.hasFocus()) {
    suppressTooltipUntilPointerLeave = false
  }
  hideTooltip()
}

function handlePointerDown() {
  suppressTooltipUntilPointerLeave = true
  hideTooltip()
}

function handleWindowBlur() {
  suppressTooltipUntilPointerLeave = true
  hideTooltip()
}

function hideTooltip() {
  clearShowTooltipTimeout()
  isTooltipVisible.value = false
  resizeObserver.disconnect()
  removeTooltipDismissListeners()
  window.removeEventListener('resize', updateTooltipPosition)
}

function clearShowTooltipTimeout() {
  if (showTooltipTimeoutId != null) {
    clearTimeout(showTooltipTimeoutId)
    showTooltipTimeoutId = null
  }
}

function addTooltipDismissListeners() {
  document.addEventListener('pointerdown', hideTooltip, true)
  document.addEventListener('wheel', hideTooltip, true)
  document.addEventListener('visibilitychange', hideTooltip, true)
  document.addEventListener('keydown', handleTooltipKeydown, true)
}

function removeTooltipDismissListeners() {
  document.removeEventListener('pointerdown', hideTooltip, true)
  document.removeEventListener('wheel', hideTooltip, true)
  document.removeEventListener('visibilitychange', hideTooltip, true)
  document.removeEventListener('keydown', handleTooltipKeydown, true)
}

/**
 * @param {KeyboardEvent} event
 */
function handleTooltipKeydown(event) {
  if (event.key === 'Escape') {
    hideTooltip()
  }
}

function updateTooltipPosition() {
  const element = tabRef.value
  if (!(element instanceof HTMLElement)) {
    return
  }

  const rect = element.getBoundingClientRect()
  const tabBarRect = element.closest('.tabBar')?.getBoundingClientRect()
  const maxTooltipWidth = Math.min(
    props.isGroup ? 420 : TOOLTIP_MAX_WIDTH_PX,
    Math.max(120, window.innerWidth - TOOLTIP_MARGIN_PX * 2)
  )
  const tooltipHeight = tooltipRef.value?.offsetHeight ?? 240
  const renderedTooltipWidth = tooltipRef.value?.offsetWidth
  const tooltipWidth = !props.showPreview && renderedTooltipWidth > 0
    ? Math.min(renderedTooltipWidth, maxTooltipWidth)
    : maxTooltipWidth
  if (['left', 'right'].includes(props.tabBarPosition)) {
    // Place the tooltip beside the tab, keeping it inside the viewport.
    const top = Math.max(
      TOOLTIP_MARGIN_PX,
      Math.min(window.innerHeight - tooltipHeight - TOOLTIP_MARGIN_PX, rect.top)
    )
    let adjacentEdge = props.tabBarPosition === 'right'
      ? (tabBarRect?.left ?? rect.left)
      : (tabBarRect?.right ?? rect.right)
    if (props.tabBarPosition === 'right') {
      const pageScrollbar = document.querySelector(
        'body > .os-scrollbar-vertical:not(.os-scrollbar-unusable)'
      )
      if (pageScrollbar instanceof HTMLElement) {
        adjacentEdge = Math.min(adjacentEdge, pageScrollbar.getBoundingClientRect().left)
      }
    }

    const availableWidth = props.tabBarPosition === 'right'
      ? adjacentEdge - TOOLTIP_OFFSET_PX - TOOLTIP_MARGIN_PX
      : window.innerWidth - adjacentEdge - TOOLTIP_OFFSET_PX - TOOLTIP_MARGIN_PX
    const constrainedWidth = Math.min(tooltipWidth, Math.max(120, availableWidth))
    const horizontalPosition = props.tabBarPosition === 'right'
      ? {
          left: 'auto',
          // Anchor the outer tooltip edge directly to the rail. Calculating a
          // left position from its width drifts when preview content changes
          // the tooltip's final box size after the first render.
          right: `${Math.round(window.innerWidth - adjacentEdge + TOOLTIP_OFFSET_PX)}px`,
          transformOrigin: 'right top'
        }
      : {
          left: `${Math.round(adjacentEdge + TOOLTIP_OFFSET_PX)}px`,
          right: 'auto',
          transformOrigin: 'left top'
        }
    tooltipStyle.value = {
      ...horizontalPosition,
      maxInlineSize: `${Math.round(constrainedWidth)}px`,
      top: `${Math.round(top)}px`
    }
    return
  }

  const left = Math.max(
    TOOLTIP_MARGIN_PX,
    Math.min(
      window.innerWidth - tooltipWidth - TOOLTIP_MARGIN_PX,
      rect.left + rect.width / 2 - tooltipWidth / 2
    )
  )

  const anchorEdge = props.tabBarPosition === 'bottom'
    ? (tabBarRect?.top ?? rect.top)
    : (tabBarRect?.bottom ?? rect.bottom)
  const availableHeight = Math.max(0, (props.tabBarPosition === 'bottom'
    ? anchorEdge
    : window.innerHeight - anchorEdge) - TOOLTIP_OFFSET_PX - TOOLTIP_MARGIN_PX)
  const height = props.isGroup ? Math.min(tooltipHeight, availableHeight) : tooltipHeight
  const top = props.tabBarPosition === 'bottom'
    ? anchorEdge - height - TOOLTIP_OFFSET_PX
    : anchorEdge + TOOLTIP_OFFSET_PX
  tooltipStyle.value = {
    left: `${Math.round(left)}px`,
    maxBlockSize: props.isGroup ? `${availableHeight}px` : undefined,
    top: `${Math.round(Math.max(TOOLTIP_MARGIN_PX, Math.min(top, window.innerHeight - height - TOOLTIP_MARGIN_PX)))}px`
  }
}

onMounted(() => window.addEventListener('blur', handleWindowBlur))
onBeforeUnmount(() => {
  window.removeEventListener('blur', handleWindowBlur)
  hideTooltip()
})

watch(() => props.closeTooltipsSignal, hideTooltip)
watch(() => props.isActive, active => { if (active) hideTooltip() })
watch(() => props.disableTooltips, disabled => { if (disabled) hideTooltip() })
watch(() => props.tabBarPosition, hideTooltip)
watch(() => props.showPreview, () => nextTick(updateTooltipPosition))
</script>

<style scoped>
.tabTooltip {
  box-sizing: border-box;
  position: fixed;
  z-index: 10000;
  inline-size: max-content;
  max-inline-size: min(340px, calc(100vw - 16px));
  padding: 8px;
  border: 1px solid var(--border-color);
  border-radius: calc(8px * var(--ui-roundness));
  background-color: var(--card-bg-color);
  backdrop-filter: var(--card-bg-blur, none);
  box-shadow: 0 8px 26px rgb(0 0 0 / 32%);
  color: var(--primary-text-color);
  font-family: var(--app-font-family);
  font-weight: 400;
  letter-spacing: 0;
  pointer-events: none;
  -webkit-app-region: no-drag;
}

.tabTooltip.withPreview {
  inline-size: min(340px, calc(100vw - 16px));
}

.tabTooltipGroup {
  align-items: center;
  color: var(--secondary-text-color);
  display: flex;
  font-size: 11px;
  gap: 6px;
  margin-block-start: 3px;
}

.tabTooltip.withPreview .tabTooltipGroup {
  margin-block-end: 7px;
}

.tabTooltipGroupIcon {
  color: var(--tab-group-color);
  flex: 0 0 auto;
  font-size: 10px;
}

.tab-tooltip-enter-active,
.tab-tooltip-leave-active {
  transition: opacity 0.14s ease, transform 0.14s ease;
}

.tab-tooltip-enter-from,
.tab-tooltip-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.985);
}

.tabTooltipTitle {
  margin-block-end: 7px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 1.35;
}

.tabTooltipTitle:only-child {
  margin-block-end: 0;
}

.tabTooltip.tabGroupTooltip.withPreview {
  inline-size: min(420px, calc(100vw - 16px));
  max-inline-size: min(420px, calc(100vw - 16px));
  max-block-size: calc(100vh - 16px);
  display: flex;
  flex-direction: column;
}

.tabTooltipCount {
  color: var(--secondary-text-color);
  font-size: 12px;
  line-height: 1.35;
}

.tabTooltipGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-auto-rows: minmax(0, 1fr);
  gap: 10px;
  margin-block-start: 8px;
  min-block-size: 0;
}

.tabTooltipGridItem {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-inline-size: 0;
  min-block-size: 0;
}

.tabTooltipGridItem :deep(.tabTooltipPreview) {
  min-block-size: 0;
  flex-shrink: 1;
}

.tabTooltipRemaining {
  margin-block-start: 8px;
  text-align: end;
}

@media (prefers-reduced-motion: reduce) {
  .tab-tooltip-enter-active,
  .tab-tooltip-leave-active {
    transition: none;
  }
}
</style>
