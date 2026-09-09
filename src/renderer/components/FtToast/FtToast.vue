<template>
  <Teleport
    :to="fullscreenTarget || 'body'"
    :disabled="fullscreenTarget === null"
  >
    <Toaster
      class="toast-holder"
      :class="[`position-${toastPosition}`, tabBarToastClasses]"
      :position="SONNER_POSITION"
      :gap="TOAST_GAP"
      :visible-toasts="MAX_VISIBLE_TOASTS"
      :swipe-directions="swipeDirections"
      :offset="toasterOffset"
      :mobile-offset="toasterOffset"
      :style="{ '--width': TOAST_WIDTH, '--front-toast-width': frontToastWidth, '--stacked-toast-width': stackedToastWidth, '--stack-height': stackHeight, '--stack-width': stackWidth }"
    />
    <div
      v-if="showProgressToast"
      class="progress-toast-holder"
      :class="[`position-${toastPosition}`, tabBarToastClasses]"
      :style="progressToastHolderStyle"
    >
      <div
        ref="progressToast"
        class="toast-slot persistent-slot"
        :class="{ minimized: progressToastMinimized }"
        :data-testid="store.getters.getShowProgressBar ? 'progress-toast' : 'subscription-refresh-toast'"
      >
        <div
          class="toast persistent"
          role="status"
        >
          <FtIcon
            :icon="progressToastIcon"
            class="icon"
            fixed-width
          />
          <p class="message">
            {{ progressToastMessage }}
          </p>
        </div>
        <div
          class="timeout-indicator-track"
          aria-hidden="true"
        >
          <FtEmbeddedProgress
            class="timeout-indicator progress-indicator"
            :corner-radius="toastProgressRadius"
            :end-arc-fraction="0.5"
            :line-width="toastProgressLineWidth"
            :progress="progressToastPercentage"
            :start-arc-fraction="0.5"
          />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, reactive, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Toaster, toast as sonner } from 'vue-sonner'
import { normalizeToastPosition } from '../../constants/toastPosition'
import { shouldUseProgressToast } from '../../helpers/progressPresentation'
import { showToast, ToastEventBus } from '../../helpers/utils'
import store from '../../store'
import FtEmbeddedProgress from '../FtEmbeddedProgress/FtEmbeddedProgress.vue'
import FtToastItem from './FtToastItem.vue'

let removeShowToastListener = null
const { t } = useI18n()

/**
 * @typedef ToastState the live state handed to {@link FtToastItem}
 * @property {string} message
 * @property {Function | null} action
 * @property {{ label: string, action?: Function, primary?: boolean, icon?: [string, string] }[]} buttons
 * @property {boolean} verticalButtons whether buttons should be stacked vertically
 * @property {boolean} dismissible whether Escape and swipe gestures can dismiss the toast
 * @property {Function} dismiss closes the toast even when gestures are disabled
 * @property {string | null} image
 * @property {[string, string] | null} icon
 * @property {number} duration lifetime of the toast in milliseconds
 */

/** How many toasts are on screen at once, oldest first out */
const MAX_VISIBLE_TOASTS = 5
/**
 * Sonner keys its toast list by the `position` prop, so changing it tears the
 * list down and takes every toast currently on screen with it. The prop is
 * pinned to one value and the configured position is applied in CSS instead,
 * off the `position-*` class on the holder.
 */
const SONNER_POSITION = 'bottom-left'
/**
 * Inline size of the toast column. It spans everything inside the viewport
 * insets, so each toast is bounded by its own `max-inline-size` rather than by
 * the column, and the row it sits in only decides which edge it is aligned to.
 */
const TOAST_WIDTH = 'calc(100vw - 60px)'
/**
 * Distance in px between two toasts: the spacing once the stack is fanned out,
 * and how far each collapsed toast peeks out from behind the one in front of it.
 * Sonner lays the stack out from the measured toast heights plus this gap, so
 * the spacing must not come from margins on the toasts themselves.
 */
const TOAST_GAP = 10
/** Distance in px from the screen edges the toasts are anchored to */
const VIEWPORT_INSET = 29
/** Larger top inset that keeps top-positioned toasts below the horizontal tab bar */
const TAB_BAR_INSET = 61
/** Bottom tabs reserve two extra pixels that stay clear of decorated window frames */
const BOTTOM_TAB_BAR_INSET = TAB_BAR_INSET + 2
/** Distance in px at which the persistent refresh toast gets out of the pointer's way */
const PROGRESS_TOAST_PROXIMITY = 32
/** Extra distance required before restoring the toast, to avoid flicker around the boundary */
const PROGRESS_TOAST_PROXIMITY_HYSTERESIS = 20

const toastItem = markRaw(FtToastItem)

/** Intervals refreshing the messages of toasts built from a function, by toast id */
const messageIntervals = new Map()
/**
 * Ids of the toasts currently on screen, oldest first. Sonner keeps everything
 * past `visibleToasts` queued up out of sight and lets it back in as room frees
 * up, which would have a toast the user has already seen reappear long after it
 * was raised, so the queue is capped here instead.
 * @type {(number | string)[]}
 */
const liveToasts = []
/** Toast ids which must remain until explicitly dismissed. */
const indefiniteToastIds = new Set()
/**
 * Removes the abort listener of each toast raised with an abort signal, by toast
 * id.
 * @type {Map<number | string, () => void>}
 */
const abortListeners = new Map()
/** @type {import('vue').Ref<Element|null>} */
const fullscreenTarget = ref(null)
/** @type {import('vue').Ref<HTMLElement|null>} */
const progressToast = useTemplateRef('progressToast')
const progressToastMinimized = ref(false)
const progressToastHeight = ref(0)
/**
 * Width of the toast at the front of the stack, as a CSS length. Sonner records
 * the front toast's height so it can lay the collapsed stack out from it, but
 * not its width: its own toasts are all one fixed width, ours are only as wide
 * as their message. Without this the toasts stacked behind the front one keep
 * their own widths and stick out from underneath it.
 * @type {import('vue').Ref<string|null>}
 */
const frontToastWidth = ref(null)
/**
 * Width of the second toast, as a CSS length. The pile of older toasts sits
 * behind that one rather than behind the front one, so it is the width they have
 * to tuck under.
 * @type {import('vue').Ref<string|null>}
 */
const stackedToastWidth = ref(null)
/**
 * Height of the whole fanned out stack, as a CSS length, used to back it with a
 * region that holds the hover. Without one the stack collapses the moment the
 * pointer is between toasts or over one that has just been dismissed, and then
 * reopens as the next toast slides under the pointer.
 * @type {import('vue').Ref<string|null>}
 */
const stackHeight = ref(null)
/**
 * Width of the widest toast in the stack, as a CSS length. The rows the toasts
 * sit in span the whole column, so the backdrop has to be sized from the toasts
 * themselves or it reaches most of the way across the window.
 * @type {import('vue').Ref<string|null>}
 */
const stackWidth = ref(null)
/** @type {ResizeObserver|null} */
let frontToastResizeObserver = null
/** @type {MutationObserver|null} */
let toastListObserver = null
/** @type {ResizeObserver|null} */
let progressToastResizeObserver = null
/** @type {DOMRect|null} */
let progressToastBounds = null
/** @type {HTMLElement|null} */
let measuredProgressToast = null
/** @type {number|null} */
let progressToastPointerFrame = null
let progressToastPointerX = 0
let progressToastPointerY = 0
/** @type {import('vue').ComputedRef<'bottom-left' | 'bottom-center' | 'bottom-right' | 'top-left' | 'top-center' | 'top-right'>} */
const toastPosition = computed(() => {
  return normalizeToastPosition(store.getters.getToastPosition)
})
const tabBarPosition = computed(() => process.env.IS_ELECTRON
  ? store.getters.getTabBarPosition
  : null)
const hasHorizontalTabBar = computed(() => ['top', 'bottom'].includes(tabBarPosition.value))
const tabBarToastClasses = computed(() => ({
  'horizontal-tabs': hasHorizontalTabBar.value,
  'top-tabs': tabBarPosition.value === 'top',
  'bottom-tabs': tabBarPosition.value === 'bottom'
}))
const tabBarInlineOffset = computed(() => `${store.getters.getVerticalTabBarWidth}px`)
const progressToastHolderStyle = computed(() => ({
  '--left-tab-bar-offset': tabBarPosition.value === 'left' ? tabBarInlineOffset.value : '0px',
  '--right-tab-bar-offset': tabBarPosition.value === 'right' ? tabBarInlineOffset.value : '0px'
}))

/**
 * Toasts are swiped away towards the screen edge they are anchored to, so they
 * leave through the nearest edge rather than across the whole window. Centered
 * toasts have no nearer edge, so they go either way.
 */
const swipeDirections = computed(() => {
  if (toastPosition.value.endsWith('left')) { return ['left'] }
  if (toastPosition.value.endsWith('right')) { return ['right'] }

  return ['left', 'right']
})

/**
 * Keeps the toast column clear of the persistent progress toast, which is
 * anchored to the same corner but sits outside the toaster.
 */
const toasterOffset = computed(() => {
  const progressInset = showProgressToast.value ? progressToastHeight.value + TOAST_GAP : 0

  return {
    left: VIEWPORT_INSET + (tabBarPosition.value === 'left' ? store.getters.getVerticalTabBarWidth : 0),
    right: VIEWPORT_INSET + (tabBarPosition.value === 'right' ? store.getters.getVerticalTabBarWidth : 0),
    bottom: (tabBarPosition.value === 'bottom' ? BOTTOM_TAB_BAR_INSET : VIEWPORT_INSET) + progressInset,
    top: (tabBarPosition.value === 'top' ? TAB_BAR_INSET : VIEWPORT_INSET) + progressInset
  }
})

const showProgressToast = computed(() => {
  // The toast holder is teleported into the fullscreen element, so a progress
  // toast would sit on top of the fullscreen player. Hide it until fullscreen
  // is left, as progress updates aren't urgent enough to interrupt playback.
  return fullscreenTarget.value === null &&
    shouldUseProgressToast(store.getters.getShowProgressBarToast) &&
    (store.getters.getShowProgressBar ||
      store.getters.getSubscriptionFeedRefreshInProgress)
})
const progressToastPercentage = computed(() => {
  return store.getters.getShowProgressBar
    ? store.getters.getProgressBarPercentage
    : store.getters.getSubscriptionFeedRefreshProgress
})
const subscriptionRefreshIcon = computed(() => {
  switch (store.getters.getSubscriptionFeedRefreshTab) {
    case 'shorts':
      return ['fa', 'clapperboard']
    case 'live':
      return ['fa', 'tower-broadcast']
    case 'posts':
      return ['fa', 'message']
    default:
      return ['fa', 'video']
  }
})
const subscriptionRefreshMessage = computed(() => {
  switch (store.getters.getSubscriptionFeedRefreshTab) {
    case 'shorts':
      return t('Subscriptions.Refreshing Subscription Shorts')
    case 'live':
      return t('Subscriptions.Refreshing Subscription Live Streams')
    case 'posts':
      return t('Subscriptions.Refreshing Subscription Posts')
    default:
      return t('Subscriptions.Refreshing Subscription Videos')
  }
})
const progressToastIcon = computed(() => {
  return store.getters.getShowProgressBar
    ? store.getters.getProgressBarIcon
    : subscriptionRefreshIcon.value
})
const progressToastMessage = computed(() => {
  if (!store.getters.getShowProgressBar) {
    return subscriptionRefreshMessage.value
  }

  return store.getters.getProgressBarMessage || t('Settings.Theme Settings.Operation in Progress')
})
const toastProgressRadius = computed(() => 12 * store.getters.getUiRoundness / 100)
const toastProgressLineWidth = computed(() => Math.min(4, Math.max(2, 2 * store.getters.getUiRoundness / 100)))

function updateFullscreenTarget() {
  fullscreenTarget.value = document.fullscreenElement
}

/**
 * Follows the front toast, which changes as toasts come and go, and remeasures
 * it whenever it or its message resizes. `offsetWidth` rather than a bounding
 * box, so a toast measured mid animation reports its laid out width instead of
 * its scaled one.
 */
function trackFrontToast() {
  const holder = document.querySelector('.toast-holder')
  const front = holder?.querySelector('[data-sonner-toast] .toast')

  frontToastResizeObserver.disconnect()
  toastListObserver.disconnect()

  if (holder) {
    toastListObserver.observe(holder, { childList: true, subtree: true, characterData: true })
  }

  if (front) {
    frontToastResizeObserver.observe(front)
  } else {
    frontToastWidth.value = null
  }

  measureStack(holder)
}

/**
 * The rows are laid out one gap apart when the stack is fanned out, so their own
 * heights add up to how much room it takes. `offsetWidth` and `offsetHeight`
 * rather than bounding boxes, so anything measured mid animation reports its
 * laid out size instead of its scaled one.
 * @param {Element|null|undefined} holder
 */
function measureStack(holder) {
  const rows = holder ? [...holder.querySelectorAll('[data-sonner-toast]')] : []

  if (rows.length === 0) {
    stackHeight.value = null
    stackWidth.value = null
    return
  }

  const height = rows.reduce((total, row) => total + row.offsetHeight, 0) +
    (rows.length - 1) * TOAST_GAP
  const width = rows.reduce((widest, row) => {
    return Math.max(widest, row.querySelector('.toast')?.offsetWidth ?? 0)
  }, 0)
  const stacked = rows[1]?.querySelector('.toast')?.offsetWidth

  stackHeight.value = `${height}px`
  stackWidth.value = `${width}px`
  stackedToastWidth.value = stacked ? `${stacked}px` : null
}

/**
 * Keeps the non-interactive refresh toast readable until the mouse approaches,
 * then tucks it into its configured edge of the screen. The expanded bounds
 * remain the hit area while minimized so scaling cannot make the state flicker.
 * @param {MouseEvent} event
 */
function onProgressToastPointerMove(event) {
  progressToastPointerX = event.clientX
  progressToastPointerY = event.clientY
  if (progressToastPointerFrame !== null) { return }

  progressToastPointerFrame = requestAnimationFrame(updateProgressToastProximity)
}

function updateProgressToastProximity() {
  progressToastPointerFrame = null
  const element = progressToast.value

  if (!element) {
    measuredProgressToast = null
    progressToastBounds = null
    progressToastMinimized.value = false
    return
  }

  if (element !== measuredProgressToast) {
    measuredProgressToast = element
    progressToastBounds = null
    progressToastMinimized.value = false
  }

  if (!progressToastMinimized.value || progressToastBounds === null) {
    progressToastBounds = element.getBoundingClientRect()
  }

  const bounds = progressToastBounds
  const horizontalDistance = Math.max(bounds.left - progressToastPointerX, 0, progressToastPointerX - bounds.right)
  const verticalDistance = Math.max(bounds.top - progressToastPointerY, 0, progressToastPointerY - bounds.bottom)
  const distance = Math.hypot(horizontalDistance, verticalDistance)
  const threshold = PROGRESS_TOAST_PROXIMITY +
    (progressToastMinimized.value ? PROGRESS_TOAST_PROXIMITY_HYSTERESIS : 0)

  progressToastMinimized.value = distance <= threshold
}

function resetProgressToastProximity() {
  progressToastBounds = null
  progressToastMinimized.value = false
}

function stopProgressToastPointerTracking() {
  window.removeEventListener('mousemove', onProgressToastPointerMove)
  window.removeEventListener('resize', resetProgressToastProximity)
  if (progressToastPointerFrame !== null) {
    cancelAnimationFrame(progressToastPointerFrame)
    progressToastPointerFrame = null
  }
  resetProgressToastProximity()
}

/**
 * @param {CustomEvent<{ message: string | (({elapsedMs: number, remainingMs: number}) => string), time: number | null, action: Function | null, abortSignal: AbortSignal | null, image: string | null, icon: [string, string] | null, buttons: { label: string, action?: Function, primary?: boolean, icon?: [string, string] }[], buttonAction: 'open-sync-settings' | null, verticalButtons: boolean, dismissible: boolean }>} event
 */
function open({ detail: { message, time, action, abortSignal, image, icon, buttons, buttonAction, verticalButtons, dismissible } }) {
  if (buttonAction === 'open-sync-settings') {
    buttons = [{
      label: t('Settings.Sync Settings.Sync Settings'),
      icon: ['fas', 'sync'],
      action: () => {
        store.commit('setSettingsWindowSection', 'sync')
        store.dispatch('showSettingsWindow')
      },
    }]
  }
  time ||= 3000

  /** @type {number | string | null} */
  let toastId = null

  /** @type {ToastState} */
  const state = reactive({
    message: typeof message === 'function' ? message({ elapsedMs: 0, remainingMs: time }) : message,
    action: action ?? null,
    buttons: buttons ?? [],
    verticalButtons: verticalButtons ?? false,
    dismissible: dismissible ?? true,
    dismiss: () => {
      if (toastId !== null) {
        sonner.dismiss(toastId)
      }
    },
    image: image ?? null,
    icon: icon ?? null,
    duration: time
  })

  const id = sonner.custom(toastItem, {
    duration: time,
    dismissible: state.dismissible,
    // Stated rather than left to the toaster's default: sonner counts the
    // toasts at a position to work out how they stack in front of one another,
    // and a toast that names no position is left out of that count, which puts
    // the whole stack at or below the depth of the list it sits in
    position: SONNER_POSITION,
    componentProps: { toast: state },
    onDismiss: forgetToast,
    onAutoClose: forgetToast
  })
  toastId = id

  if (typeof message === 'function') {
    let elapsed = 0
    const updateDelay = 1000

    messageIntervals.set(id, setInterval(() => {
      elapsed += updateDelay
      // Skip the last update, the toast is about to go away anyway
      if (elapsed >= time) {
        clearMessageInterval(id)
        return
      }

      state.message = message({ elapsedMs: elapsed, remainingMs: time - elapsed })
    }, updateDelay))
  }

  if (abortSignal != null) {
    const abort = () => sonner.dismiss(id)
    abortSignal.addEventListener('abort', abort)
    // The signal can outlive the toast, so the listener has to come off when the
    // toast goes rather than only when the signal fires
    abortListeners.set(id, () => abortSignal.removeEventListener('abort', abort))
  }

  liveToasts.push(id)
  if (!Number.isFinite(time)) {
    indefiniteToastIds.add(id)
  }
  while (liveToasts.length > MAX_VISIBLE_TOASTS) {
    const transientIndex = liveToasts.findIndex(toastId => !indefiniteToastIds.has(toastId))
    if (transientIndex === -1) {
      break
    }
    sonner.dismiss(liveToasts.splice(transientIndex, 1)[0])
  }
}

/**
 * @param {{ id: number | string }} toast
 */
function forgetToast(toast) {
  clearMessageInterval(toast.id)
  indefiniteToastIds.delete(toast.id)
  abortListeners.get(toast.id)?.()
  abortListeners.delete(toast.id)

  const index = liveToasts.indexOf(toast.id)
  if (index !== -1) {
    liveToasts.splice(index, 1)
  }
}

/**
 * @param {number | string} id
 */
function clearMessageInterval(id) {
  const interval = messageIntervals.get(id)

  if (interval !== undefined) {
    clearInterval(interval)
    messageIntervals.delete(id)
  }
}

// The toaster is anchored past the progress toast, so its height has to be
// known before the toasts can be laid out clear of it.
watch(progressToast, (element) => {
  progressToastResizeObserver?.disconnect()
  stopProgressToastPointerTracking()

  if (!element) {
    progressToastHeight.value = 0
    return
  }

  progressToastResizeObserver ??= new ResizeObserver(([entry]) => {
    progressToastHeight.value = entry.target.getBoundingClientRect().height
  })
  progressToastResizeObserver.observe(element)
  window.addEventListener('mousemove', onProgressToastPointerMove, { passive: true })
  window.addEventListener('resize', resetProgressToastProximity)
})

watch(
  () => [tabBarPosition.value, store.getters.getVerticalTabBarWidth],
  async () => {
    await nextTick()
    resetProgressToastProximity()
  }
)

// The holder is recreated when the toasts are teleported into or out of a
// fullscreen element, so the observers have to be pointed at the new one.
watch(fullscreenTarget, () => nextTick(trackFrontToast))

onMounted(() => {
  frontToastResizeObserver = new ResizeObserver(([entry]) => {
    frontToastWidth.value = `${entry.target.offsetWidth}px`
  })
  toastListObserver = new MutationObserver(trackFrontToast)
  trackFrontToast()

  ToastEventBus.addEventListener('toast-open', open)
  document.addEventListener('fullscreenchange', updateFullscreenTarget)
  updateFullscreenTarget()

  if (process.env.IS_ELECTRON) {
    removeShowToastListener = window.ftElectron.handleShowToast((message, time, icon, buttonAction) => {
      showToast({ message, time, icon, buttonAction })
    })
  }
})

onBeforeUnmount(() => {
  ToastEventBus.removeEventListener('toast-open', open)
  document.removeEventListener('fullscreenchange', updateFullscreenTarget)
  stopProgressToastPointerTracking()
  progressToastResizeObserver?.disconnect()
  frontToastResizeObserver?.disconnect()
  toastListObserver?.disconnect()
  removeShowToastListener?.()
  messageIntervals.forEach(clearInterval)
  messageIntervals.clear()
  abortListeners.forEach(remove => remove())
  abortListeners.clear()
})
</script>

<style src="./FtToast.css" />
