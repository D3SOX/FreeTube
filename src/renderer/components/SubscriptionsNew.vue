<template>
  <SubscriptionsTabUi
    class="newFeed"
    :is-loading="isLoading"
    :video-list="displayedEntries"
    :subscription-feed-type="activeCategory ?? 'videos'"
    :error-channels="errorChannels"
    :attempted-fetch="attemptedFetch"
    :only-show-new="true"
    :has-additional-content="showCombinedView && hasAdditionalContent"
    :is-community="activeCategory === 'posts'"
    :youtube-style-shorts="activeCategory === 'shorts' && useCustomShortsPlayer"
    :track-global-refresh="false"
    stable-item-keys
    @refresh="refresh"
  >
    <template #before-list="{ hasVisibleContent }">
      <h3 v-if="showCombinedView && hasVisibleContent">
        {{ $t('Global.Videos') }}
      </h3>
    </template>
    <Transition name="new-feed-section">
      <section
        v-if="showCombinedView && newShorts.length > 0"
        class="mediaSection"
      >
        <h3>{{ $t('Global.Shorts') }}</h3>
        <FtElementList
          :data="newShorts"
          subscription-feed-type="shorts"
          stable-item-keys
          :youtube-style-shorts="useCustomShortsPlayer"
          :use-channels-hidden-preference="false"
        />
      </section>
    </Transition>
    <Transition name="new-feed-section">
      <section
        v-if="showCombinedView && newLive.length > 0"
        class="mediaSection"
      >
        <h3>{{ $t('Global.Live') }}</h3>
        <FtElementList
          :data="newLive"
          subscription-feed-type="live"
          stable-item-keys
          :use-channels-hidden-preference="false"
        />
      </section>
    </Transition>
    <Transition name="new-feed-section">
      <section
        v-if="showCombinedView && newPosts.length > 0"
        class="postsSection"
      >
        <h3>{{ $t('Global.Posts') }}</h3>
        <FtElementList
          :data="newPosts"
          subscription-feed-type="posts"
          display="list"
          stable-item-keys
          :use-channels-hidden-preference="false"
        />
      </section>
    </Transition>
    <FtPrompt
      v-if="showRefreshWarning"
      :label="$t('Subscriptions.New Feed Refresh Warning Title')"
      :extra-labels="[$t('Subscriptions.New Feed Refresh Warning', { count: activeSubscriptionIds.size }, activeSubscriptionIds.size)]"
      :option-names="[$t('Yes'), $t('No')]"
      :option-values="['refresh', 'cancel']"
      autosize
      @click="handleRefreshWarning"
    />
  </SubscriptionsTabUi>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtElementList from './FtElementList/FtElementList.vue'
import FtPrompt from './FtPrompt/FtPrompt.vue'
import SubscriptionsTabUi from './SubscriptionsTabUi/SubscriptionsTabUi.vue'

import store from '../store/index'

import { useKeepAliveEffectScope } from '../composables/useKeepAliveEffectScope'
import { useRefreshAllSubscriptionFeeds } from '../composables/useRefreshAllSubscriptionFeeds'
import { getNewSubscriptionFeedEntries } from '../helpers/newSubscriptionFeed'
import { hasConfiguredRestrictedPlaybackAuthentication } from '../helpers/restricted-playback'

const props = defineProps({
  activeCategory: {
    type: String,
    default: null,
    validator: value => value === null || ['videos', 'shorts', 'live', 'posts'].includes(value)
  }
})

const { t } = useI18n()
useKeepAliveEffectScope()
const {
  activeSubscriptionIds,
  attemptedFetch,
  enabledFeeds,
  errorChannels,
  handleRefreshWarning,
  isRefreshing,
  refresh,
  showRefreshWarning
} = useRefreshAllSubscriptionFeeds()

const forbiddenTitles = computed(() => store.getters.getForbiddenTitlesParsed)
const sortBy = computed(() => {
  return store.getters.getNewSubscriptionFeedSortBy === 'oldest' ? 'oldest' : 'newest'
})
const activeSubscriptions = computed(() => store.getters.getActiveProfile.subscriptions)

const newContentByCategory = computed(() => getNewSubscriptionFeedEntries({
  feeds: enabledFeeds.value,
  activeSubscriptions: activeSubscriptions.value,
  historyCacheById: store.getters.getHistoryCacheById,
  hideLiveStreams: store.getters.getHideLiveStreams,
  hideUpcomingPremieres: store.getters.getHideUpcomingPremieres,
  forbiddenTitles: forbiddenTitles.value,
  onlyShowLatestFromChannel: store.getters.getOnlyShowLatestFromChannel,
  onlyShowLatestFromChannelNumber: store.getters.getOnlyShowLatestFromChannelNumber,
  restrictedPlaybackConfigured: hasConfiguredRestrictedPlaybackAuthentication(store.getters),
  sortBy: sortBy.value
}))

const newVideos = computed(() => newContentByCategory.value.videos)
const newShorts = computed(() => newContentByCategory.value.shorts)
const newLive = computed(() => newContentByCategory.value.live)
const newPosts = computed(() => newContentByCategory.value.posts)
const useCustomShortsPlayer = computed(() => store.getters.getUseCustomShortsPlayer)
const showCombinedView = computed(() => props.activeCategory === null)
const displayedEntries = computed(() => {
  switch (props.activeCategory) {
    case 'shorts':
      return newShorts.value
    case 'live':
      return newLive.value
    case 'posts':
      return newPosts.value
    default:
      return newVideos.value
  }
})

const hasAdditionalContent = computed(() => {
  return newShorts.value.length > 0 || newLive.value.length > 0 || newPosts.value.length > 0
})

const isLoading = computed(() => {
  return !store.getters.getSubscriptionCacheReady || isRefreshing.value
})

const hasNewContent = computed(() => {
  if (!showCombinedView.value) {
    return displayedEntries.value.length > 0
  }

  return newVideos.value.length > 0 || hasAdditionalContent.value
})

const hasNewContentByCategory = computed(() => ({
  videos: newVideos.value.length > 0,
  shorts: newShorts.value.length > 0,
  live: newLive.value.length > 0,
  posts: newPosts.value.length > 0
}))

defineExpose({
  refresh,
  isLoading,
  lastRefreshTimestamp: '',
  nextAutoRefreshTimestamp: '',
  nextAutoRefreshTooltip: '',
  refreshTitle: computed(() => t('Subscriptions.New Content')),
  hasNewContent,
  hasNewContentByCategory
})
</script>

<style scoped>
.mediaSection,
.postsSection {
  margin-block-start: 8px;
}

.mediaSection h3,
.postsSection h3 {
  margin-block-start: 0;
}

.newFeed :deep(.autoGrid) {
  position: relative;
}

.newFeed :deep(.feed-leave-active) {
  position: absolute;
  top: var(--feed-leave-top);
  left: var(--feed-leave-left);
  z-index: 1;
  width: var(--feed-leave-width);
  height: var(--feed-leave-height);
  pointer-events: none;
  transition: opacity 200ms ease;
}

.newFeed :deep(.feed-leave-to) {
  opacity: 0;
}

.new-feed-section-leave-active {
  transition: opacity 200ms ease;
}

.new-feed-section-leave-to {
  opacity: 0;
}
</style>
