<template>
  <Teleport :to="teleportTarget">
    <div
      class="prompt"
      :class="{ lockScroll }"
      tabindex="-1"
      :inert="inert"
      @pointerdown.stop
      @touchstart.stop
      @touchend.stop
      @dblclick.stop
      @click.stop="($event.target === $event.currentTarget) && hide()"
      @keydown.enter.self="hide"
      @keydown.left.right.capture="handleArrowKeys"
    >
      <FtCard
        ref="promptCard"
        v-overlay-scrollbars="!fixedLayout"
        class="promptCard"
        :class="{ autosize, fixedLayout, [theme]: true, [cardClass]: cardClass !== '' }"
        :inert="busy"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="id"
      >
        <slot
          name="label"
          :label-id="id"
        >
          <h2
            :id="id"
            class="center"
          >
            {{ label }}
          </h2>
        </slot>

        <template v-if="fixedLayout">
          <div
            ref="promptContentScroller"
            v-overlay-scrollbars="contentScrollable"
            :class="contentScrollable ? 'promptContentScroller' : 'promptManagedContent'"
          >
            <div class="promptContent">
              <slot />
            </div>
          </div>
          <div class="promptFixedFooter">
            <slot name="footer" />
          </div>
        </template>
        <slot v-else>
          <p
            v-for="extraLabel in extraLabels"
            :key="extraLabel"
            class="center"
          >
            <strong>
              {{ extraLabel }}
            </strong>
          </p>
          <FtFlexBox>
            <FtButton
              v-for="(option, index) in optionNames"
              :key="index"
              :label="option"
              :text-color="optionButtonTextColor(index)"
              :background-color="optionButtonBackgroundColor(index)"
              :theme="index === 0 && isFirstOptionDestructive ? 'destructive' : ''"
              :icon="optionIcons[index] ?? (index === 0 && isFirstOptionDestructive ? ['fas', 'trash'] : null)"
              @click="click(optionValues[index])"
            />
          </FtFlexBox>
        </slot>
      </FtCard>
    </div>
  </Teleport>
</template>

<script setup>
import { nextTick, onBeforeMount, onBeforeUnmount, onMounted, useId, useTemplateRef } from 'vue'

import { clampOverlayScrollTop } from '../../helpers/overlayScrollbars'
import store from '../../store/index'

import FtCard from '../ft-card/ft-card.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtButton from '../FtButton/FtButton.vue'
import { lockBodyScroll, unlockBodyScroll } from './scrollLock'

const props = defineProps({
  label: {
    type: String,
    default: ''
  },
  extraLabels: {
    type: Array,
    default: () => []
  },
  optionNames: {
    type: Array,
    default: () => []
  },
  optionValues: {
    type: Array,
    default: () => []
  },
  optionIcons: {
    type: Array,
    default: () => []
  },
  autosize: {
    type: Boolean,
    default: false
  },
  isFirstOptionDestructive: {
    type: Boolean,
    default: false
  },
  theme: {
    type: String,
    default: 'base'
  },
  cardClass: {
    type: String,
    default: ''
  },
  inert: {
    type: Boolean,
    default: false
  },
  busy: {
    type: Boolean,
    default: false
  },
  lockScroll: {
    type: Boolean,
    default: true
  },
  contentScrollable: { type: Boolean, default: true },
  fixedLayout: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['click'])

const id = useId()
const teleportTarget = document.fullscreenElement ?? '.app'

const promptCard = useTemplateRef('promptCard')
const promptContentScroller = useTemplateRef('promptContentScroller')

let promptButtons = []
let lastActiveElement = null
let promptContentResizeObserver = null

onBeforeMount(() => {
  if (props.lockScroll) {
    lockBodyScroll()
  }
})

onMounted(() => {
  lastActiveElement = document.activeElement
  document.addEventListener('keydown', handleEscape, true)
  store.commit('addOpenPrompt', id)

  nextTick(() => {
    promptButtons = Array.from(promptCard.value.$el.querySelectorAll('.btn.ripple, .iconButton'))
    focusItem(0)

    const scroller = promptContentScroller.value
    const content = scroller?.firstElementChild
    if (scroller && content && typeof ResizeObserver === 'function') {
      const clampScroll = () => clampOverlayScrollTop(scroller, content)
      promptContentResizeObserver = new ResizeObserver(clampScroll)
      promptContentResizeObserver.observe(scroller)
      promptContentResizeObserver.observe(content)
      clampScroll()
    }
  })
})

onBeforeUnmount(() => {
  promptContentResizeObserver?.disconnect()
  document.removeEventListener('keydown', handleEscape, true)
  store.commit('removeOpenPrompt', id)
  if (props.lockScroll) {
    unlockBodyScroll()
  }
  nextTick(() => lastActiveElement?.focus())
})

/**
 * @param {number} index
 */
function optionButtonTextColor(index) {
  if (index === 0 && props.isFirstOptionDestructive) {
    return 'var(--destructive-text-color)'
  } else if (index < props.optionNames.length - 1) {
    return 'var(--text-with-accent-color)'
  } else {
    return null
  }
}

/**
 * @param {number} index
 */
function optionButtonBackgroundColor(index) {
  if (index === 0 && props.isFirstOptionDestructive) {
    return 'var(--destructive-color)'
  } else if (index < props.optionNames.length - 1) {
    return 'var(--accent-color)'
  } else {
    return null
  }
}

/**
 * @param {any} value
 */
function click(value) {
  if (props.busy) return
  emit('click', value)
}

function hide() {
  click(null)
}

/**
 * @param {number} index
 */
function focusItem(index) {
  if (promptButtons.length === 0) return

  if (index < 0) {
    index = promptButtons.length - 1
  } else if (index >= promptButtons.length) {
    index = 0
  }

  promptButtons[index]?.focus()
  store.dispatch('showOutlines')
}

/**
 * @param {KeyboardEvent} event
 */
function handleEscape(event) {
  if (event.target instanceof Element && event.target.closest('dialog[open]')) return
  if (event.key === 'Escape' && !props.inert && !event.defaultPrevented) {
    event.preventDefault()
    hide()
  }
}

/**
 * @param {KeyboardEvent} event
 */
function handleArrowKeys(event) {
  const currentIndex = promptButtons.indexOf(event.target)

  // Only react if a button was focused when the arrow key was pressed
  if (currentIndex === -1) {
    return
  }

  event.preventDefault()

  const direction = (event.key === 'ArrowLeft') ? -1 : 1
  focusItem(currentIndex + direction)
}
</script>

<style scoped src="./FtPrompt.css" />
