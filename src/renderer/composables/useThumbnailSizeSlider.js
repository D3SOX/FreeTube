import { computed, onBeforeUnmount, ref, shallowReactive } from 'vue'

import store from '../store/index'
import {
  MAX_THUMBNAIL_SIZE,
  PHONE_THUMBNAIL_MAX_SIZE,
  PHONE_THUMBNAIL_VIEWPORT_WIDTH
} from '../constants/thumbnailSize'

const visibleGrids = shallowReactive(new Set())

// Some views, including YouTube-style Shorts, force a grid even when the
// global preference is list. Track rendered grids using their resize observer.
export function setThumbnailGridVisible(element, visible) {
  if (visible) visibleGrids.add(element)
  else visibleGrids.delete(element)
}

export function useThumbnailSizeSlider() {
  const query = window.matchMedia(`(width <= ${PHONE_THUMBNAIL_VIEWPORT_WIDTH}px)`)
  const phoneWidth = ref(query.matches)
  const updatePhoneWidth = () => { phoneWidth.value = query.matches }
  query.addEventListener('change', updatePhoneWidth)
  onBeforeUnmount(() => query.removeEventListener('change', updatePhoneWidth))

  const maxThumbnailSize = computed(() => phoneWidth.value && (store.getters.getListType === 'grid' || visibleGrids.size > 0)
    ? PHONE_THUMBNAIL_MAX_SIZE
    : MAX_THUMBNAIL_SIZE)
  // A size chosen in a wider window already renders full-width on a phone.
  // Display that endpoint without overwriting the saved desktop preference.
  const thumbnailSize = computed(() => Math.min(store.getters.getThumbnailSize, maxThumbnailSize.value))

  return { thumbnailSize, maxThumbnailSize }
}
