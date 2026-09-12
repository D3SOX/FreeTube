<template>
  <Teleport
    to=".app"
    :disabled="!docked"
  >
    <dialog
      ref="dialog"
      class="mobileSheet"
      :class="{ dockedSheet: docked, mobileSheetEnabled: enabled }"
      :style="sheetStyle"
      :role="enabled ? null : 'presentation'"
      :aria-label="enabled ? title : null"
      @cancel.prevent="dismiss"
      @keydown.esc.prevent.stop="dismiss"
      @pointerdown.stop
      @click="enabled && $event.stopPropagation()"
      @dblclick.stop
      @touchstart.stop
      @touchend.stop
    >
      <header
        v-if="enabled"
        class="mobileSheetHeader"
        @pointerdown="startDrag"
        @pointermove="moveDrag"
        @pointerup="endDrag"
        @pointercancel="cancelDrag"
      >
        <button
          v-if="back"
          type="button"
          :aria-label="$t('Back')"
          @click="emit('back')"
        >
          <FtIcon
            :icon="['fas', 'arrow-left']"
            aria-hidden="true"
          />
        </button>
        <slot name="heading">
          <h2>{{ title }}</h2>
        </slot>
        <slot name="actions" />
        <button
          type="button"
          :aria-label="$t('Close')"
          @click="emit('close')"
        >
          <FtIcon
            :icon="['fas', 'xmark']"
            aria-hidden="true"
          />
        </button>
      </header>
      <slot />
    </dialog>
  </Teleport>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, inject, nextTick, onBeforeUnmount, onUpdated, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { usePhoneLayout } from '../../composables/usePhoneLayout'
import { isAppHidden } from '../../helpers/appVisibility'
import { applyAnimationSpeed } from '../../helpers/animationSpeed'
import { lockBodyScroll, unlockBodyScroll } from '../FtPrompt/scrollLock'

const props = defineProps({
  enabled: { type: Boolean, default: true },
  open: { type: Boolean, default: true },
  title: { type: String, required: true },
  back: { type: Boolean, default: false },
  belowPlayer: { type: Boolean, default: false }
})
const emit = defineEmits(['close', 'back', 'closed', 'suspend', 'resume'])
const dialog = useTemplateRef('dialog')
let locked = false
let previousFocus = null

const getPlayer = inject('phonePanelPlayer', null)
const preparePanel = inject('preparePhonePanel', null)
const expandPanel = inject('expandPhonePanel', null)
const landscape = usePhoneLayout('(orientation: landscape)')
const expanded = ref(false)
const dragOffset = ref(0)
const visibleTop = computed(() => Math.max(0, (expanded.value ? 0 : sheetTop.value) + Math.min(0, dragOffset.value)))
const fullscreenElement = shallowRef(document.fullscreenElement)
const playerCoversWindow = ref(false)
const appHidden = ref(isAppHidden())
const pictureInPicture = ref(document.body.classList.contains('androidPictureInPicture'))
const docked = computed(() => props.enabled && props.belowPlayer && getPlayer !== null)
const suspended = computed(() => docked.value &&
  (!!fullscreenElement.value || playerCoversWindow.value || appHidden.value || pictureInPicture.value))
function updateVisibility() {
  appHidden.value = isAppHidden()
}
document.addEventListener('visibilitychange', updateVisibility)
const pictureInPictureObserver = new MutationObserver(updatePresentation)
pictureInPictureObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] })
let observedPlayer = null
let presentationObserver = null
function updatePresentation() {
  fullscreenElement.value = document.fullscreenElement
  pictureInPicture.value = document.body.classList.contains('androidPictureInPicture')
  const player = getPlayer?.() ?? null
  if (player !== observedPlayer) {
    presentationObserver?.disconnect()
    observedPlayer = player
    if (player) {
      presentationObserver = new MutationObserver(updatePresentation)
      presentationObserver.observe(player, { attributes: true, attributeFilter: ['class', 'data-native-player-screen'] })
    }
  }
  playerCoversWindow.value = player?.matches('[data-native-player-screen], .fullWindow') ?? false
}
updatePresentation()
// Options API $refs are not reactive; refresh the observed player when opening.
watch([dialog, () => props.open], updatePresentation, { flush: 'post' })
onUpdated(updatePresentation)
document.addEventListener('fullscreenchange', updatePresentation)
const sheetTop = ref(0)
const sheetStyle = computed(() => docked.value
  ? {
      insetBlockStart: `max(var(--app-safe-area-inset-top, 0px), ${visibleTop.value}px)`,
      blockSize: `calc(var(--phone-viewport-height, 100dvh) - max(var(--app-safe-area-inset-top, 0px), ${visibleTop.value}px))`
    }
  : null)
let resize
let drag = null
let animation
let closing = false
let resumePlayback = null
let openingSequence = 0
let presentationSuspended = false

function restorePlayback() {
  if (!landscape.value) resumePlayback?.()
  resumePlayback = null
}

function measurePlayer() {
  if (!docked.value || !props.open || suspended.value) return
  const player = getPlayer?.()
  if (!player) return
  let bounds = player.getBoundingClientRect()
  const toolbarBottom = document.querySelector('.topNav')?.getBoundingClientRect().bottom ?? 0
  // Native player restoration and focus can restore a late page scroll offset.
  if (bounds.top < toolbarBottom - 1) {
    window.scrollBy({ top: bounds.top - toolbarBottom, behavior: 'instant' })
    bounds = player.getBoundingClientRect()
  }
  sheetTop.value = Math.max(0, bounds.bottom)
}

watch([dialog, () => props.enabled, () => props.open, docked, fullscreenElement, suspended], async ([element, enabled, open], previous) => {
  const sequence = ++openingSequence
  if (!element) return
  if (suspended.value && enabled && open) {
    if (element.open) {
      emit('suspend')
      element.close()
      release(true)
      presentationSuspended = true
    }
    return
  }
  if (presentationSuspended && (!enabled || !open)) {
    presentationSuspended = false
    expanded.value = false
    restorePlayback()
    emit('closed')
  }
  if (element.open && (docked.value !== previous[3] || fullscreenElement.value !== previous[4])) {
    element.close()
    release()
    if (!enabled || !open) {
      emit('closed')
      return
    }
  }
  if (enabled && open && closing) {
    closing = false
    animation?.cancel()
  }
  if (enabled && open && !element.open) {
    previousFocus = document.activeElement
    if (docked.value) {
      const player = getPlayer?.()
      player?.setAttribute('data-phone-panel-video', '')
      await preparePanel?.()
      if (sequence !== openingSequence || !docked.value || suspended.value || !props.enabled || !props.open || dialog.value !== element) {
        player?.removeAttribute('data-phone-panel-video')
        return
      }
      // Restore the video before opening a panel from an action farther down the page.
      if (player) {
        const bounds = player.getBoundingClientRect()
        const toolbarBottom = document.querySelector('.topNav')?.getBoundingClientRect().bottom ?? 0
        if (bounds.top < toolbarBottom || bounds.bottom > innerHeight - 120) {
          window.scrollBy({ top: bounds.top - toolbarBottom, behavior: 'instant' })
        }
      }
      if (!presentationSuspended) expanded.value = landscape.value
      measurePlayer()
      element.show()
      animation = applyAnimationSpeed(element.animate([
        { transform: 'translateY(100%)' },
        { transform: 'translateY(0)' }
      ], { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220, easing: 'ease-out' }))
      resize = new ResizeObserver(measurePlayer)
      if (player) resize.observe(player)
      window.addEventListener('resize', measurePlayer)
      window.addEventListener('scroll', measurePlayer, { capture: true, passive: true })
      window.visualViewport?.addEventListener('resize', measurePlayer)
    } else {
      element.showModal()
      animation = applyAnimationSpeed(element.animate([
        { transform: 'translateY(24px)', opacity: 0 },
        { transform: 'translateY(0)', opacity: 1 }
      ], { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220, easing: 'ease-out' }))
    }
    lockBodyScroll()
    locked = true
    await nextTick()
    if (sequence !== openingSequence || !element.open) return
    if (presentationSuspended) {
      presentationSuspended = false
      emit('resume')
    }
    if (docked.value) element.querySelector('button')?.focus({ preventScroll: true })
  } else if ((!enabled || !open) && element.open) {
    if (!closing) {
      closing = true
      animation?.cancel()
      animation = applyAnimationSpeed(element.animate([
        { transform: getComputedStyle(element).transform, opacity: getComputedStyle(element).opacity },
        { transform: docked.value ? 'translateY(100%)' : 'translateY(24px)', opacity: docked.value ? 1 : 0 }
      ], { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180, easing: 'ease-in', fill: 'forwards' }))
      try { await animation.finished } catch { return }
      if (!closing) return
    }
    element.close()
    release()
    emit('closed')
  }
}, { flush: 'post' })

watch(landscape, (value) => {
  if (value && props.open && docked.value && !suspended.value && !expanded.value) {
    expanded.value = true
  }
})

function startDrag(event) {
  if (!docked.value || event.button !== 0 || event.target.closest('button, input, a, [role="button"]')) return
  animation?.cancel()
  drag = { id: event.pointerId, y: event.clientY, start: performance.now(), distance: 0 }
  event.currentTarget.setPointerCapture(event.pointerId)
}
function moveDrag(event) {
  if (drag?.id !== event.pointerId) return
  drag.distance = event.clientY - drag.y
  dragOffset.value = drag.distance
  dialog.value.style.transform = `translateY(${Math.max(0, drag.distance)}px)`
}
function endDrag(event) {
  if (drag?.id !== event.pointerId) return
  const { distance, start } = drag
  drag = null
  const expand = !expanded.value && distance < -60
  const collapse = expanded.value && distance > 80
  const close = !collapse && (distance > 80 || (distance > 20 && distance / (performance.now() - start) > 0.6))
  if (close) {
    emit('close')
    return
  }
  const element = dialog.value
  const before = element.getBoundingClientRect()
  if (expand) {
    expanded.value = true
    if (!landscape.value) resumePlayback = expandPanel?.()
  } else if (collapse) {
    expanded.value = false
    restorePlayback()
  }
  dragOffset.value = 0
  element.style.transform = ''
  nextTick(() => {
    const after = element.getBoundingClientRect()
    animation = applyAnimationSpeed(element.animate([
      { top: `${before.top}px`, height: `${before.height}px`, transform: 'translateY(0)' },
      { top: `${after.top}px`, height: `${after.height}px`, transform: 'translateY(0)' }
    ], { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180, easing: 'ease-out' }))
  })
}
function cancelDrag() {
  dragOffset.value = 0
  drag = null
  if (dialog.value) dialog.value.style.transform = ''
}

function dismiss() {
  emit(props.back ? 'back' : 'close')
}

function release(preservePresentation = false) {
  closing = false
  if (!locked) return
  const anotherPanelOpen = document.querySelector('.dockedSheet[open]') !== null
  if (!anotherPanelOpen) getPlayer?.()?.removeAttribute('data-phone-panel-video')
  resize?.disconnect()
  window.removeEventListener('resize', measurePlayer)
  window.removeEventListener('scroll', measurePlayer, true)
  window.visualViewport?.removeEventListener('resize', measurePlayer)
  animation?.cancel()
  if (!preservePresentation) {
    expanded.value = false
    restorePlayback()
  }
  cancelDrag()
  unlockBodyScroll()
  locked = false
  if (!preservePresentation && !anotherPanelOpen && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
}
onBeforeUnmount(() => {
  openingSequence++
  document.removeEventListener('fullscreenchange', updatePresentation)
  document.removeEventListener('visibilitychange', updateVisibility)
  pictureInPictureObserver.disconnect()
  presentationObserver?.disconnect()
  dialog.value?.close()
  release()
})
</script>

<style scoped src="./FtMobileSheet.css" />
