<template>
  <SubscriptionsTabUi
    ref="tabUi"
    :is-loading="isLoading"
    :video-list="shortsList"
    :error-channels="errorChannels"
    :attempted-fetch="attemptedFetch"
    :youtube-style-shorts="useCustomShortsPlayer"
    refresh-tab="shorts"
    @refresh="loadVideosForSubscriptionsFromRemote"
  />
</template>

<script setup>
import { computed, shallowRef, ref, watch, onMounted, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import SubscriptionsTabUi from './SubscriptionsTabUi/SubscriptionsTabUi.vue'

import store from '../store/index'

import { useKeepAliveEffectScope } from '../composables/useKeepAliveEffectScope'
import { useRelativeTimeClock } from '../composables/useRelativeTimeClock'
import { useSubscriptionChannelUpdates } from '../composables/useSubscriptionChannelUpdates'
import {
  refreshSubscriptionShortsFromRemote,
  updateVideoListAfterProcessing
} from '../helpers/subscriptions'
import { getSubscriptionsForFeed } from '../helpers/subscription-channels'
import { getCachedRelativeTimeFormat, getRelativeTimeFromDate } from '../helpers/utils'
import { formatShortDateTime } from '../helpers/dateFormat'

const { locale, t } = useI18n()
const tabUi = useTemplateRef('tabUi')
useKeepAliveEffectScope()

const isLoading = ref(true)
const videoList = shallowRef([])
const shortsList = computed(() => videoList.value.map(video => ({ ...video, isShort: true })))
const errorChannels = ref([])
const attemptedFetch = ref(false)
const useCustomShortsPlayer = computed(() => store.getters.getUseCustomShortsPlayer)
/** @type {import('vue').Ref<number | null>} */
const lastRemoteRefreshSuccessTimestamp = ref(null)
const dateFormat = computed(() => store.getters.getDateFormat)
const timeFormat = computed(() => store.getters.getTimeFormat)

let alreadyLoadedRemotely = false

const now = useRelativeTimeClock()

/** @type {import('vue').ComputedRef<boolean>} */
const subscriptionCacheReady = computed(() => store.getters.getSubscriptionCacheReady)

/** @type {import('vue').ComputedRef<boolean>} */
const fetchSubscriptionsAutomatically = computed(() => store.getters.getFetchSubscriptionsAutomatically)

const activeSubscriptionList = computed(() => (
  getSubscriptionsForFeed(store.getters.getActiveProfile.subscriptions, 'shorts')
))

const cacheEntriesForAllActiveProfileChannels = computed(() => {
  const shortsCache = store.getters.getShortsCache
  const entries = []

  activeSubscriptionList.value.forEach((channel) => {
    const cacheEntry = shortsCache[channel.id]

    if (cacheEntry != null) {
      entries.push(cacheEntry)
    }
  })

  return entries
})

const videoCacheForAllActiveProfileChannelsPresent = computed(() => {
  if (
    cacheEntriesForAllActiveProfileChannels.value.length === 0 ||
    cacheEntriesForAllActiveProfileChannels.value.length < activeSubscriptionList.value.length
  ) {
    return false
  }

  return cacheEntriesForAllActiveProfileChannels.value.every((cacheEntry) => {
    return cacheEntry.videos != null
  })
})

const lastShortRefreshTimestamp = computed(() => {
  // Cache is not ready when data is just loaded from remote
  if (lastRemoteRefreshSuccessTimestamp.value) {
    return getRelativeTimeFromDate(lastRemoteRefreshSuccessTimestamp.value, true, true, now.value)
  }

  if (
    !videoCacheForAllActiveProfileChannelsPresent.value ||
    cacheEntriesForAllActiveProfileChannels.value.length === 0
  ) {
    return ''
  }

  let latestTimestamp = null
  cacheEntriesForAllActiveProfileChannels.value.forEach((cacheEntry) => {
    if (!latestTimestamp || cacheEntry.timestamp.getTime() > latestTimestamp.getTime()) {
      latestTimestamp = cacheEntry.timestamp
    }
  })
  return getRelativeTimeFromDate(latestTimestamp.getTime(), true, true, now.value)
})

const refreshTitle = computed(() => {
  return t('Global.Shorts')
})

const hasNewContent = computed(() => tabUi.value?.hasNewContent === true)

const nextAutoRefreshTimestamp = computed(() => {
  const timestamp = store.getters.getSubscriptionShortsNextAutoRefreshTimestamp
  const interval = parseInt(store.getters.getSubscriptionShortsAutoRefreshInterval, 10)

  if (!timestamp || Number.isNaN(interval) || interval <= 0) {
    return ''
  }

  return formatShortDateTime(timestamp, locale.value, dateFormat.value, timeFormat.value)
})

const nextAutoRefreshTooltip = computed(() => {
  const timestamp = store.getters.getSubscriptionShortsNextAutoRefreshTimestamp
  const interval = parseInt(store.getters.getSubscriptionShortsAutoRefreshInterval, 10)

  if (!timestamp || Number.isNaN(interval) || interval <= 0) {
    return ''
  }

  const relativeTime = getRelativeTimeValue(timestamp - now.value)

  return getCachedRelativeTimeFormat(locale.value, 'auto').format(relativeTime.value, relativeTime.unit)
})

/**
 * @param {number} remainingMs
 */
function getRelativeTimeValue(remainingMs) {
  const direction = remainingMs < 0 ? -1 : 1
  const absRemainingSeconds = Math.max(Math.round(Math.abs(remainingMs) / 1000), 0)

  if (absRemainingSeconds < 60) {
    return { value: direction * absRemainingSeconds, unit: 'second' }
  }

  const absRemainingMinutes = Math.round(absRemainingSeconds / 60)
  if (absRemainingMinutes < 60) {
    return { value: direction * absRemainingMinutes, unit: 'minute' }
  }

  return { value: direction * Math.round(absRemainingMinutes / 60), unit: 'hour' }
}

// Watching the channel ids instead of deep watching the subscription list,
// avoids traversing every channel object on unrelated changes
// and firing on channel name/thumbnail updates
watch(() => activeSubscriptionList.value.map((channel) => channel.id).join(','), () => {
  lastRemoteRefreshSuccessTimestamp.value = null
  isLoading.value = true
  loadVideosFromCacheSometimes()
})

watch(
  [
    () => store.getters.getSubscriptionShortsLastRefreshTimestamp,
    () => store.getters.getSubscriptionSeenVideos
  ],
  () => {
    if (subscriptionCacheReady.value) {
      loadVideosFromCacheForAllActiveProfileChannels()
    }
  }
)

if (!subscriptionCacheReady.value) {
  watch(subscriptionCacheReady, () => {
    if (!alreadyLoadedRemotely) {
      loadVideosFromCacheSometimes()
    }
  })
}

onMounted(() => {
  loadVideosFromRemoteFirstPerWindowSometimes()
})

function loadVideosFromRemoteFirstPerWindowSometimes() {
  if (
    !fetchSubscriptionsAutomatically.value ||
    // Only auto fetch once per window
    store.getters.getSubscriptionForShortsFirstAutoFetchRun
  ) {
    loadVideosFromCacheSometimes()
    return
  }

  alreadyLoadedRemotely = true
  loadVideosForSubscriptionsFromRemote()
  store.commit('setSubscriptionForShortsFirstAutoFetchRun')
}

function loadVideosFromCacheSometimes() {
  // Can only load reliably when cache ready
  if (!subscriptionCacheReady.value) { return }

  // This method is called on view visible
  if (videoCacheForAllActiveProfileChannelsPresent.value) {
    attemptedFetch.value = true
    loadVideosFromCacheForAllActiveProfileChannels()
    return
  }

  if (fetchSubscriptionsAutomatically.value) {
    // `isLoading.value = false` is called inside `loadVideosForSubscriptionsFromRemote` when needed
    loadVideosForSubscriptionsFromRemote()
    return
  }

  // Auto fetch disabled, show the cache that is available for the profile
  attemptedFetch.value = false
  loadVideosFromCacheForAllActiveProfileChannels()
}

function loadVideosFromCacheForAllActiveProfileChannels() {
  const videoList_ = cacheEntriesForAllActiveProfileChannels.value.flatMap((cacheEntry) => {
    return cacheEntry.videos ?? []
  })

  videoList.value = updateVideoListAfterProcessing(videoList_)
  isLoading.value = false
}

// Show the channels that have been fetched so far, instead of waiting for the
// whole refresh to finish
useSubscriptionChannelUpdates('shorts', () => {
  if (subscriptionCacheReady.value) {
    loadVideosFromCacheForAllActiveProfileChannels()
  }
})

async function loadVideosForSubscriptionsFromRemote() {
  isLoading.value = true
  attemptedFetch.value = true
  errorChannels.value = []

  // Whatever is cached is shown right away, the refresh then replaces it
  // channel by channel
  if (subscriptionCacheReady.value && cacheEntriesForAllActiveProfileChannels.value.length > 0) {
    loadVideosFromCacheForAllActiveProfileChannels()
  }

  try {
    const refreshedVideos = await refreshSubscriptionShortsFromRemote({
      t,
      errorChannels: errorChannels.value
    })
    if (refreshedVideos !== null) {
      loadVideosFromCacheForAllActiveProfileChannels()
      lastRemoteRefreshSuccessTimestamp.value = store.getters.getSubscriptionShortsLastRefreshTimestamp
    }
  } finally {
    isLoading.value = false
  }
}

defineExpose({
  refresh: loadVideosForSubscriptionsFromRemote,
  isLoading,
  lastRefreshTimestamp: lastShortRefreshTimestamp,
  nextAutoRefreshTimestamp,
  nextAutoRefreshTooltip,
  refreshTitle,
  hasNewContent
})
</script>
