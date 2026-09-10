<template>
  <div
    ref="slot"
    class="toast-slot"
  >
    <div
      ref="toastElement"
      class="toast"
      :class="{
        hasImage: toast.image,
        actionable: toast.action,
        indefinite: !Number.isFinite(toast.duration)
      }"
      :tabindex="toast.action ? 0 : null"
      role="status"
      @click="onClick"
      @keydown.enter.self.prevent="performAction"
      @keydown.space.self.prevent="performAction"
      @pointerdown="onPointerDown"
      @pointerup="onPointerUp"
    >
      <img
        v-if="toast.image"
        :src="toast.image"
        class="image"
        alt=""
        draggable="false"
      >
      <FtIcon
        v-else-if="toast.icon"
        :icon="toast.icon"
        class="icon"
        fixed-width
      />
      <p class="message">
        {{ toast.message }}
      </p>
      <div
        v-if="toast.buttons.length > 0"
        class="toastActions"
        :class="{ vertical: toast.verticalButtons }"
        @click.stop
      >
        <FtButton
          v-for="button in toast.buttons"
          :key="button.label"
          :label="button.label"
          :icon="button.icon"
          :text-color="button.primary ? undefined : null"
          :background-color="button.primary ? undefined : null"
          @click="performButtonAction(button)"
        />
      </div>
    </div>
    <div
      v-if="showTimeoutIndicator"
      class="timeout-indicator-track"
      :class="{ paused: isPaused }"
      aria-hidden="true"
    >
      <FtEmbeddedProgress
        class="timeout-indicator"
        :corner-radius="toastProgressRadius"
        :end-arc-fraction="0.5"
        :line-width="toastProgressLineWidth"
        :start-arc-fraction="0.5"
        :style="{ '--toast-duration': `${toast.duration}ms` }"
      />
    </div>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, onBeforeUnmount, onMounted, useTemplateRef } from 'vue'
import store from '../../store'
import FtEmbeddedProgress from '../FtEmbeddedProgress/FtEmbeddedProgress.vue'
import FtButton from '../FtButton/FtButton.vue'

/** Distance in px the pointer may travel before a click counts as the tail end of a swipe */
const CLICK_SLOP = 5

const props = defineProps({
  /**
   * The toast's live state, as built by `FtToast`. Mutable so messages built
   * from a function can be refreshed while the toast is on screen.
   */
  toast: {
    type: Object,
    required: true
  },
  /**
   * Set by vue-sonner while its timer is on hold: the pointer is over the
   * toaster, a toast has focus, or the document is hidden. The timeout
   * indicator follows the same clock, so it freezes with it.
   */
  isPaused: {
    type: Boolean,
    default: false
  }
})

// vue-sonner passes its dismiss handler in as `onCloseToast`
const emit = defineEmits(['closeToast'])

/** @type {number | null} */
let pointerDownX = null
let pointerMoved = false
/** @type {HTMLElement | null} */
let row = null

const slot = useTemplateRef('slot')
const toastElement = useTemplateRef('toastElement')

const showTimeoutIndicator = computed(() => {
  return store.getters.getShowToastTimeoutIndicator && Number.isFinite(props.toast.duration)
})
const toastProgressRadius = computed(() => 12 * store.getters.getUiRoundness / 100)
const toastProgressLineWidth = computed(() => Math.min(4, Math.max(2, 2 * store.getters.getUiRoundness / 100)))

function close() {
  if (!props.toast.dismissible) {
    props.toast.dismiss()
    return
  }

  emit('closeToast')
}

/**
 * Dismisses a toast the user has reached with the keyboard. The handler belongs
 * on the row rather than on the toast: the row is what sonner makes focusable,
 * both for its own hotkey and for tabbing, while the toast itself only takes
 * focus when it has an action to run. Bound on the row a key press reaches every
 * toast, and one that ran an action still bubbles up to here.
 * @param {KeyboardEvent} event
 */
function onRowKeydown(event) {
  if (event.key !== 'Escape' || !props.toast.dismissible) { return }

  event.preventDefault()
  close()
}

onMounted(() => {
  // The collapsed stack clips the slot around this card. Pinning the card's
  // measured width keeps that constraint from shrinking its flex contents and
  // rewrapping the message while toasts enter or leave the stack. Use the
  // computed content-box size: offsetWidth also includes the inline padding,
  // which content-box sizing would add a second time once assigned as a width.
  toastElement.value.style.setProperty('--toast-natural-width', getComputedStyle(toastElement.value).inlineSize)
  row = slot.value?.parentElement ?? null
  row?.addEventListener('keydown', onRowKeydown)
})

onBeforeUnmount(() => {
  row?.removeEventListener('keydown', onRowKeydown)
})

function performAction() {
  if (!props.toast.action) { return }

  props.toast.action()
  if (props.toast.dismissOnAction !== false) close()
}

/**
 * @param {{ action?: Function }} button
 */
function performButtonAction(button) {
  button.action?.()
  close()
}

/**
 * @param {PointerEvent} event
 */
function onPointerDown(event) {
  pointerDownX = event.clientX
  pointerMoved = false
}

/**
 * @param {PointerEvent} event
 */
function onPointerUp(event) {
  pointerMoved = pointerDownX !== null && Math.abs(event.clientX - pointerDownX) > CLICK_SLOP
  pointerDownX = null
}

/**
 * Runs an available toast action on click, unless the pointer was dragged (in
 * which case the click is the tail end of a swipe gesture and should be ignored).
 */
function onClick() {
  if (pointerMoved) {
    pointerMoved = false
    return
  }

  performAction()
}
</script>
