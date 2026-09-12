import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import store from '../store/index'
import {
  getSubscriptionRefreshCancelCount,
  refreshSubscriptionLiveFromRemote,
  refreshSubscriptionPostsFromRemote,
  refreshSubscriptionShortsFromRemote,
  refreshSubscriptionVideosFromRemote
} from '../helpers/subscriptions'
import { withAndroidSubscriptionRefreshBatch } from '../helpers/androidSubscriptionRefresh'
import { getEnabledSubscriptionFeedSources } from '../helpers/newSubscriptionFeed'

const LARGE_SUBSCRIPTION_COUNT = 125

export function useRefreshAllSubscriptionFeeds() {
  const { t } = useI18n()
  const isRefreshing = ref(false)
  const attemptedFetch = ref(false)
  const errorChannels = ref([])
  const showRefreshWarning = ref(false)

  const activeSubscriptionIds = computed(() => {
    return new Set(store.getters.getActiveProfile.subscriptions.map(channel => channel.id))
  })

  const enabledFeeds = computed(() => {
    const refreshByCategory = {
      videos: refreshSubscriptionVideosFromRemote,
      shorts: refreshSubscriptionShortsFromRemote,
      live: refreshSubscriptionLiveFromRemote,
      posts: refreshSubscriptionPostsFromRemote
    }

    return getEnabledSubscriptionFeedSources(store.getters).map(feed => ({
      ...feed,
      refresh: refreshByCategory[feed.category]
    }))
  })

  function refresh() {
    if (isRefreshing.value || store.getters.getSubscriptionFeedRefreshInProgress) {
      return
    }

    if (!store.getters.getUseRssFeeds && activeSubscriptionIds.value.size > LARGE_SUBSCRIPTION_COUNT) {
      showRefreshWarning.value = true
      return
    }

    refreshAllFeeds()
  }

  async function refreshAllFeeds() {
    isRefreshing.value = true
    attemptedFetch.value = true
    errorChannels.value = []

    const cancelCountAtStart = getSubscriptionRefreshCancelCount()

    try {
      if (enabledFeeds.value.length === 0) return
      await withAndroidSubscriptionRefreshBatch(async () => {
        for (const feed of enabledFeeds.value) {
          // Also covers a cancellation between two feeds, when no feed refresh
          // was running to receive it
          if (getSubscriptionRefreshCancelCount() !== cancelCountAtStart) {
            break
          }

          await feed.refresh({ t, errorChannels: errorChannels.value })
        }
      }, { title: t('Subscriptions.Subscriptions'), cancelLabel: t('Feed.Cancel Refresh') })
    } finally {
      isRefreshing.value = false
    }
  }

  function handleRefreshWarning(action) {
    showRefreshWarning.value = false

    if (action === 'refresh') {
      refreshAllFeeds()
    }
  }

  return {
    activeSubscriptionIds,
    attemptedFetch,
    enabledFeeds,
    errorChannels,
    handleRefreshWarning,
    isRefreshing,
    refresh,
    showRefreshWarning
  }
}
