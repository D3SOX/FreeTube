<template>
  <div
    ref="ftIconButton"
    class="ftIconButton"
    @focusout="handleDropdownFocusOut"
  >
    <button
      class="iconButton"
      :aria-label="title"
      :title="title"
      :class="{
        [theme]: true,
        shadow: useShadow,
        pressed: openOnRightOrLongClick && dropdownShown,
        disabled
      }"
      :style="{
        padding: padding + 'px',
        fontSize: size + 'px'
      }"
      :aria-disabled="disabled"
      :aria-expanded="dropdownShown"
      :aria-pressed="ariaPressed"
      @pointerdown="handleIconPointerDown"
      @contextmenu.prevent
      @click="handleIconClick"
    >
      <FtIconLayers
        v-if="overlayIcon"
        class="icon"
      >
        <FtIcon
          :icon="icon"
          :spin="spin"
        />
        <FtIcon
          class="overlayIcon"
          :icon="overlayIcon"
          transform="shrink-7 up-1"
        />
      </FtIconLayers>
      <FtIcon
        v-else
        class="icon"
        :icon="icon"
        :spin="spin"
      />
    </button>
    <template
      v-if="dropdownShown"
    >
      <FtPrompt
        v-if="useModal"
        :autosize="true"
        :label="title"
        @click="dropdownShown = false"
      >
        <slot>
          <ul
            v-if="dropdownOptions.length > 0"
            class="list"
            role="listbox"
          >
            <li
              v-for="(option, index) in dropdownOptions"
              :id="id + '-' + index"
              :key="index"
              role="option"
              :aria-selected="option.active"
              :aria-disabled="option.disabled"
              tabindex="-1"
              :class="{
                listItemDivider: option.type === 'divider',
                listItem: option.type !== 'divider',
                hasIcon: option.icon,
                active: option.active,
                disabled: option.disabled
              }"
              @click="handleDropdownClick(option, $event)"
              @keydown.enter="handleDropdownClick(option)"
              @keydown.space="handleDropdownClick(option)"
            >
              <template v-if="option.type !== 'divider'">
                <div
                  v-if="option.icon || option.active"
                  class="optionIconColumn"
                >
                  <FtIcon
                    :icon="option.active ? ['fas', 'check'] : option.icon"
                  />
                </div>
                <span :class="{ wrapLabel: option.wrapLabel }">{{ option.label }}</span>
              </template>
            </li>
          </ul>
        </slot>
      </FtPrompt>
      <Teleport
        v-else
        to=".app"
        :disabled="!dropdownPortal"
      >
        <div
          ref="dropdown"
          v-overlay-scrollbars="!$slots['dropdown-header']"
          tabindex="-1"
          class="iconDropdown"
          :class="{
            kebabMenu: isKebabMenu,
            left: dropdownPositionX === 'left',
            right: dropdownPositionX === 'right',
            center: dropdownPositionX === 'center',
            bottom: dropdownPositionY === 'bottom',
            top: dropdownPositionY === 'top',
            portal: dropdownPortal,
            hasFixedHeader: !!$slots['dropdown-header'],
            [dropdownClass]: dropdownClass !== ''
          }"
          @focusout="handleDropdownFocusOut"
          @keydown.esc.stop="handleDropdownEscape"
        >
          <div
            v-if="$slots['dropdown-header']"
            class="iconDropdownHeader"
          >
            <slot name="dropdown-header" />
          </div>
          <div
            v-if="$slots['dropdown-header']"
            ref="dropdownContent"
            v-overlay-scrollbars
            class="iconDropdownContent"
          >
            <div ref="dropdownContentInner">
              <slot />
            </div>
          </div>
          <slot v-else>
            <ul
              v-if="dropdownOptions.length > 0"
              class="list"
              role="listbox"
            >
              <li
                v-for="(option, index) in dropdownOptions"
                :id="id + index"
                :key="index"
                :role="option.type === 'divider' ? 'separator' : 'option'"
                :aria-selected="option.active"
                :aria-disabled="option.disabled"
                :tabindex="option.type === 'divider' || option.disabled ? '-1' : '0'"
                :class="{
                  listItemDivider: option.type === 'divider',
                  listItem: option.type !== 'divider',
                  hasIcon: option.icon,
                  active: option.active,
                  disabled: option.disabled
                }"
                @click="handleDropdownClick(option)"
                @keydown.enter="handleDropdownClick(option)"
                @keydown.space="handleDropdownClick(option)"
              >
                <div
                  v-if="option.icon || option.active"
                  class="optionIconColumn"
                >
                  <FtIcon
                    :icon="option.active ? ['fas', 'check'] : option.icon"
                  />
                </div>
                <span
                  v-if="option.type !== 'divider'"
                  :class="{ wrapLabel: option.wrapLabel }"
                >{{ option.label }}</span>
              </li>
            </ul>
          </slot>
        </div>
      </Teleport>
    </template>
  </div>
</template>

<script setup>
import { FtIcon, FtIconLayers } from '@opentubex/icons'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, useTemplateRef, watch } from 'vue'

import FtPrompt from '../FtPrompt/FtPrompt.vue'
import { clampOverlayScrollTop } from '../../helpers/overlayScrollbars'

const props = defineProps({
  title: {
    type: String,
    required: true,
  },
  icon: {
    type: [Array, Object],
    default: () => ['fas', 'ellipsis-v']
  },
  overlayIcon: {
    type: Array,
    default: null
  },
  disabled: {
    type: Boolean,
    default: false
  },
  spin: {
    type: Boolean,
    default: false
  },
  ariaPressed: {
    type: Boolean,
    default: null
  },
  theme: {
    type: String,
    default: 'base'
  },
  useShadow: {
    type: Boolean,
    default: true
  },
  padding: {
    type: Number,
    default: 10
  },
  size: {
    type: Number,
    default: 20
  },
  forceDropdown: {
    type: Boolean,
    default: false
  },
  dropdownPortal: {
    type: Boolean,
    default: false
  },
  dropdownClass: {
    type: String,
    default: ''
  },
  dropdownPositionX: {
    type: String,
    default: 'center'
  },
  dropdownPositionY: {
    type: String,
    default: 'bottom'
  },
  dropdownOptions: {
    // Array of objects with these properties
    // - type: ('labelValue'|'divider', default to 'labelValue' for less typing)
    // - label: String (if type === 'labelValue')
    // - value: String (if type === 'labelValue')
    // - (OPTIONAL) icon: semantic icon tuple (if type === 'labelValue')
    // - (OPTIONAL) active: Number (if type === 'labelValue')
    // - (OPTIONAL) disabled: Boolean (if type === 'labelValue')
    // - (OPTIONAL) wrapLabel: Boolean (if type === 'labelValue')
    type: Array,
    default: () => []
  },
  dropdownModalOnMobile: {
    type: Boolean,
    default: false
  },
  openOnRightOrLongClick: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['click', 'disabled-click'])

const LONG_CLICK_BOUNDARY_MS = 500

const id = useId()

const isKebabMenu = computed(() => (
  Array.isArray(props.icon) && ['ellipsis-v', 'ellipsis-vertical'].includes(props.icon[1])
))

const dropdownShown = ref(false)
const useModal = ref(false)

let blockLeftClick = false
let longPressTimer = null
let dropdownViewportUpdateFrame = null

if (props.dropdownModalOnMobile) {
  onMounted(() => {
    useModal.value = window.innerWidth <= 900
    window.addEventListener('resize', handleResize)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', handleResize)
  })
}

const dropdown = useTemplateRef('dropdown')
const dropdownContent = useTemplateRef('dropdownContent')
const dropdownContentInner = useTemplateRef('dropdownContentInner')

watch(dropdownContentInner, (content, _, onCleanup) => {
  if (!content) return
  const observer = new ResizeObserver(scheduleDropdownViewportUpdate)
  observer.observe(content)
  onCleanup(() => observer.disconnect())
})

watch(dropdownShown, (shown) => {
  if (shown && !useModal.value) {
    window.addEventListener('resize', scheduleDropdownViewportUpdate)
    window.addEventListener('scroll', scheduleDropdownViewportUpdate, { capture: true, passive: true })
  } else {
    removeDropdownViewportListeners()
  }
})

onBeforeUnmount(removeDropdownViewportListeners)

/**
 * @param {PointerEvent | null} e
 * @param {boolean} isRightOrLongClick
 */
function handleIconClick(e, isRightOrLongClick = false) {
  if (props.disabled) {
    emit('disabled-click')
    return
  }

  if (blockLeftClick) {
    return
  }

  if (longPressTimer != null) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }

  if ((!props.openOnRightOrLongClick || (props.openOnRightOrLongClick && isRightOrLongClick)) &&
    (props.forceDropdown || props.dropdownOptions.length > 0)) {
    dropdownShown.value = !dropdownShown.value
    if (dropdownShown.value && !useModal.value) {
      // wait until the dropdown is visible
      // then focus it so we can hide it automatically when it loses focus
      nextTick(() => {
        dropdown.value?.focus()
        keepDropdownInViewport()
      })
    }
  } else {
    emit('click')
  }
}

/**
 * @param {PointerEvent} event
 */
function handleIconPointerDown(event) {
  if (!props.openOnRightOrLongClick) {
    return
  }

  if (event.button === 2) { // right button click
    handleIconClick(null, true)
  } else if (event.button === 0) { // left button click
    longPressTimer = setTimeout(() => {
      handleIconClick(null, true)

      // prevent a long press that ends on the icon button from firing the handleIconClick handler
      window.addEventListener('pointerup', preventButtonClickAfterLongPress, { once: true })
      window.addEventListener('pointercancel', () => {
        window.removeEventListener('pointerup', preventButtonClickAfterLongPress)
      }, { once: true })
    }, LONG_CLICK_BOUNDARY_MS)
  }
}

/**
 * The bottom edge of the sticky app chrome (the horizontal tab bar and the top
 * navigation). Dropdowns must not cover it, so it is their upper boundary
 * instead of the viewport edge. The vertical tab bar is a side column, so it
 * never sits above the content.
 * @returns {number}
 */
function getTopChromeBottom() {
  // In fullscreen the chrome is not on screen, even though it keeps its layout.
  if (document.fullscreenElement != null) {
    return 0
  }

  let bottom = 0

  for (const selector of ['.topNav', '.tabBar.position-top']) {
    const element = document.querySelector(selector)

    if (element != null) {
      bottom = Math.max(bottom, element.getBoundingClientRect().bottom)
    }
  }

  return bottom
}

function keepDropdownInViewport() {
  if (dropdown.value == null) {
    return
  }

  const viewportMargin = 8
  const minTop = Math.max(viewportMargin, getTopChromeBottom() + 4)
  dropdown.value.style.removeProperty('transform')
  dropdown.value.style.removeProperty('max-block-size')
  dropdown.value.style.removeProperty('overflow-y')

  // A menu that is too tall for the space below the chrome has to scroll,
  // otherwise clamping it would just push it past the viewport bottom instead.
  const availableHeight = window.innerHeight - minTop - viewportMargin
  if (dropdown.value.getBoundingClientRect().height > availableHeight) {
    dropdown.value.style.maxBlockSize = `${availableHeight}px`
    dropdown.value.style.overflowY = dropdownContent.value ? 'hidden' : 'auto'
  }

  if (dropdownContent.value) {
    clampOverlayScrollTop(dropdownContent.value, dropdownContentInner.value)
  }

  if (props.dropdownPortal) {
    const button = ftIconButton.value?.querySelector('.iconButton')
    if (button == null) {
      return
    }

    const buttonRect = button.getBoundingClientRect()
    const dropdownRect = dropdown.value.getBoundingClientRect()
    let left
    if (props.dropdownPositionX === 'left') {
      left = buttonRect.right - dropdownRect.width
    } else if (props.dropdownPositionX === 'right') {
      left = buttonRect.left
    } else {
      left = buttonRect.left + (buttonRect.width - dropdownRect.width) / 2
    }

    const top = props.dropdownPositionY === 'top'
      ? buttonRect.top - dropdownRect.height - 4
      : buttonRect.bottom + 4
    const maxLeft = window.innerWidth - viewportMargin - dropdownRect.width
    const maxTop = window.innerHeight - viewportMargin - dropdownRect.height

    dropdown.value.style.inset = 'auto'
    dropdown.value.style.left = `${Math.max(viewportMargin, Math.min(left, maxLeft))}px`
    dropdown.value.style.top = `${Math.max(minTop, Math.min(top, maxTop))}px`
    return
  }

  const rect = dropdown.value.getBoundingClientRect()
  const offsetX = Math.max(viewportMargin - rect.left, Math.min(0, window.innerWidth - viewportMargin - rect.right))
  const offsetY = Math.max(minTop - rect.top, Math.min(0, window.innerHeight - viewportMargin - rect.bottom))

  dropdown.value.style.transform = `translate(${offsetX}px, ${offsetY}px)`
}

function scheduleDropdownViewportUpdate() {
  if (dropdownViewportUpdateFrame != null) {
    cancelAnimationFrame(dropdownViewportUpdateFrame)
  }

  dropdownViewportUpdateFrame = requestAnimationFrame(() => {
    dropdownViewportUpdateFrame = null
    keepDropdownInViewport()
  })
}

function removeDropdownViewportListeners() {
  window.removeEventListener('resize', scheduleDropdownViewportUpdate)
  window.removeEventListener('scroll', scheduleDropdownViewportUpdate, true)

  if (dropdownViewportUpdateFrame != null) {
    cancelAnimationFrame(dropdownViewportUpdateFrame)
    dropdownViewportUpdateFrame = null
  }
}

function preventButtonClickAfterLongPress() {
  blockLeftClick = true

  setTimeout(() => {
    blockLeftClick = false
  }, 0)
}

const ftIconButton = useTemplateRef('ftIconButton')

function handleDropdownFocusOut(event) {
  const nextTarget = event.relatedTarget
  const focusStaysInControl = (
    nextTarget instanceof Node &&
    (
      ftIconButton.value?.contains(nextTarget) ||
      dropdown.value?.contains(nextTarget)
    )
  )

  if (!useModal.value && dropdownShown.value && !focusStaysInControl) {
    dropdownShown.value = false
  }
}

function handleDropdownEscape() {
  dropdownShown.value = false
  ftIconButton.value?.firstElementChild?.focus()
}

function handleDropdownClick(option, event) {
  if (option.disabled) {
    if (useModal.value) {
      event?.stopPropagation()
    }

    return
  }

  emit('click', option.value)

  dropdownShown.value = false
}

function handleResize() {
  useModal.value = window.innerWidth <= 900
}

defineExpose({
  dropdownShown: computed(() => dropdownShown.value),

  hideDropdown: () => {
    dropdownShown.value = false
  }
})
</script>

<style scoped lang="scss" src="./FtIconButton.scss" />
