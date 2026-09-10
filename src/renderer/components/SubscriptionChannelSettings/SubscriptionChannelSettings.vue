<template>
  <FtButton
    :label="t('Channel.Subscription settings')"
    :icon="['fas', 'sliders-h']"
    @click="showManager = true"
  />
  <FtSettingsSubpage
    :open="showManager"
    :title="t('Channel.Subscription settings')"
    :icon="['fas', 'sliders-h']"
    @close="showManager = false"
  >
    <div class="channelSettingsHeader">
      <FtInput
        input-type="search"
        :placeholder="t('Settings.Channel Settings.Search Channels')"
        :show-action-button="false"
        :value="searchQuery"
        @input="searchQuery = $event"
      />
    </div>
    <div
      ref="channelSettingsScroller"
      v-overlay-scrollbars
      class="channelSettingsScroller"
    >
      <div ref="channelSettingsContent">
        <div
          v-if="channels.length > 0"
          class="channelSelectionToolbar"
        >
          <div class="channelSelectionSummary">
            <p
              :id="`${id}-selection-summary`"
              aria-live="polite"
            >
              {{ selectedChannelCountText }}
            </p>
            <div class="channelSelectionActions">
              <FtButton
                :disabled="visibleChannels.length === 0 || allVisibleChannelsSelected"
                @click="selectAllVisibleChannels"
              >
                <span>{{ t('Profile.Select All') }}</span>
                <FtIcon
                  class="channelSelectionActionIcon"
                  :icon="['fas', 'check']"
                  aria-hidden="true"
                />
              </FtButton>
              <FtButton
                :disabled="selectedChannelIds.size === 0"
                @click="clearChannelSelection"
              >
                <span>{{ t('Profile.Select None') }}</span>
                <FtIcon
                  class="channelSelectionActionIcon"
                  :icon="['fas', 'xmark']"
                  aria-hidden="true"
                />
              </FtButton>
            </div>
          </div>
          <div
            v-if="selectedChannelIds.size > 0"
            class="bulkFeedTypeSettings"
            role="group"
            :aria-labelledby="`${id}-selection-summary ${id}-bulk-feed-types`"
          >
            <p
              :id="`${id}-bulk-feed-types`"
              class="settingLabel"
            >
              {{ t('Channel.Show in subscription feed') }}
            </p>
            <div class="feedTypeOptions bulkFeedTypeOptions">
              <button
                v-for="feedType in feedTypes"
                :key="feedType.id"
                type="button"
                class="feedTypeOption"
                :class="{
                  enabled: selectedFeedTypeStates[feedType.id] === true,
                  mixed: selectedFeedTypeStates[feedType.id] === 'mixed'
                }"
                role="checkbox"
                :aria-checked="selectedFeedTypeStates[feedType.id]"
                @click="updateSelectedFeedType(feedType.id)"
              >
                <FtIcon
                  :icon="feedType.icon"
                  aria-hidden="true"
                />
                <span>{{ feedType.label }}</span>
                <FtIcon
                  v-if="selectedFeedTypeStates[feedType.id] === true"
                  class="feedTypeCheck"
                  :icon="['fas', 'check']"
                  aria-hidden="true"
                />
                <span
                  v-else-if="selectedFeedTypeStates[feedType.id] === 'mixed'"
                  class="feedTypeMixedIndicator"
                  aria-hidden="true"
                />
              </button>
            </div>
            <div class="bulkAdditionalSettings">
              <button
                v-if="restrictedPlaybackConfigured"
                type="button"
                class="bulkMembersOnlySetting"
                :class="{
                  enabled: selectedMembersOnlyState === true,
                  mixed: selectedMembersOnlyState === 'mixed'
                }"
                role="checkbox"
                :aria-checked="selectedMembersOnlyState"
                @click="updateSelectedShowMembersOnly"
              >
                <span class="bulkMembersOnlyLabel">
                  {{ t('Search Listing.Label.Members Only') }}
                </span>
                <FtIcon
                  v-if="selectedMembersOnlyState === true"
                  class="bulkSettingCheck"
                  :icon="['fas', 'check']"
                  aria-hidden="true"
                />
                <span
                  v-else-if="selectedMembersOnlyState === 'mixed'"
                  class="feedTypeMixedIndicator"
                  aria-hidden="true"
                />
              </button>
              <FtSelect
                class="bulkDailyLimitSelect"
                :placeholder="t('Channel.Videos per day')"
                :value="selectedDailyLimitValue"
                :select-names="bulkLimitNames"
                :select-values="bulkLimitValues"
                :icon="['fas', 'clock']"
                @change="updateSelectedChannelLimit"
              />
            </div>
          </div>
        </div>
        <p
          v-if="channels.length === 0"
          class="emptyState"
        >
          {{ t('Home Page.Nothing here yet') }}
        </p>
        <p
          v-else-if="visibleChannels.length === 0"
          class="emptyState"
        >
          {{ t('Settings.Channel Settings.No Matching Channels') }}
        </p>
        <ul
          v-else
          class="channelSettingsList"
        >
          <li
            v-for="(channel, index) in displayedChannels"
            :key="channel.id"
            class="channelSettings"
            :class="{ selected: isChannelSelected(channel.id) }"
            role="group"
            :aria-labelledby="`${id}-channel-${index}`"
          >
            <div class="channelIdentity">
              <button
                type="button"
                class="channelSelectionOption"
                :class="{ selected: isChannelSelected(channel.id) }"
                role="checkbox"
                :aria-checked="isChannelSelected(channel.id)"
                :aria-labelledby="`${id}-channel-${index}`"
                @click="toggleChannelSelection(channel.id)"
              >
                <FtIcon
                  v-if="isChannelSelected(channel.id)"
                  :icon="['fas', 'check']"
                  aria-hidden="true"
                />
              </button>
              <FtRetryImage
                v-if="channel.thumbnail"
                class="channelThumbnail"
                :src="channel.thumbnail"
                alt=""
              />
              <span
                v-else
                class="channelThumbnail channelThumbnailPlaceholder"
              >
                <FtIcon :icon="['fas', 'circle-user']" />
              </span>
              <p
                :id="`${id}-channel-${index}`"
                class="channelName"
                dir="auto"
              >
                {{ channel.name || channel.id }}
              </p>
            </div>
            <div
              class="feedTypeSettings"
              role="group"
              :aria-labelledby="`${id}-channel-${index}-feed-types`"
            >
              <p
                :id="`${id}-channel-${index}-feed-types`"
                class="settingLabel"
              >
                {{ t('Channel.Show in subscription feed') }}
              </p>
              <div class="feedTypeOptions">
                <button
                  v-for="feedType in feedTypes"
                  :key="feedType.id"
                  type="button"
                  class="feedTypeOption"
                  :class="{ enabled: isFeedTypeEnabled(channel, feedType.id) }"
                  role="checkbox"
                  :aria-checked="isFeedTypeEnabled(channel, feedType.id)"
                  @click="updateFeedType(
                    channel,
                    feedType.id,
                    !isFeedTypeEnabled(channel, feedType.id)
                  )"
                >
                  <FtIcon
                    :icon="feedType.icon"
                    aria-hidden="true"
                  />
                  <span>{{ feedType.label }}</span>
                  <FtIcon
                    v-if="isFeedTypeEnabled(channel, feedType.id)"
                    class="feedTypeCheck"
                    :icon="['fas', 'check']"
                    aria-hidden="true"
                  />
                </button>
              </div>
            </div>
            <div
              v-if="restrictedPlaybackConfigured"
              class="membersOnlySetting"
            >
              <FtToggleSwitch
                :label="t('Search Listing.Label.Members Only')"
                :default-value="channelSettings(channel).showMembersOnly"
                compact
                @change="value => updateShowMembersOnly(channel, value)"
              />
            </div>
            <div class="dailyLimitSetting">
              <FtSelect
                class="dailyLimitSelect"
                :placeholder="t('Channel.Videos per day')"
                :value="channelLimitValue(channel)"
                :select-names="limitNames"
                :select-values="limitValues"
                :icon="['fas', 'clock']"
                @change="value => updateChannelLimit(channel, value)"
              />
            </div>
          </li>
        </ul>
        <FtAutoLoadNextPageWrapper
          v-if="hasMoreChannels"
          :key="channelPage"
          @load-next-page="channelPage++"
        >
          <FtFlexBox>
            <FtButton
              :label="t('Channels.Load More Channels')"
              :icon="['fas', 'arrow-down']"
              background-color="var(--primary-color)"
              text-color="var(--text-with-main-color)"
              @click="channelPage++"
            />
          </FtFlexBox>
        </FtAutoLoadNextPageWrapper>
      </div>
    </div>
  </FtSettingsSubpage>
</template>

<script setup>
import FtRetryImage from '../FtRetryImage.vue'
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'
import FtAutoLoadNextPageWrapper from '../FtAutoLoadNextPageWrapper.vue'
import { useListPagination } from '../../composables/useListPagination'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtSelect from '../FtSelect/FtSelect.vue'
import FtSettingsSubpage from '../FtSettingsSubpage/FtSettingsSubpage.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'

import store from '../../store/index'
import { showToast } from '../../helpers/utils'
import { clampOverlayScrollTop } from '../../helpers/overlayScrollbars'
import { hasConfiguredRestrictedPlaybackAuthentication } from '../../helpers/restricted-playback'
import {
  formatSubscriptionDailyVideoLimit,
  getSubscriptionDailyVideoLimitOptions,
  getSubscriptionFeedTypeOptions,
  getUpdatedSubscriptionFeedTypes,
  normalizeSubscriptionChannelSettings,
  parseSubscriptionDailyVideoLimit
} from '../../helpers/subscription-channels'

const { locale, t } = useI18n()
const id = useId()
const showManager = ref(false)
const searchQuery = ref('')
// Mount editors in batches so large subscription lists open quickly.
const channelsPerPage = 24
const channelSettingsScroller = useTemplateRef('channelSettingsScroller')
const channelSettingsContent = useTemplateRef('channelSettingsContent')
const optimisticChannelSettings = shallowRef(new Map())
const selectedChannelIds = shallowRef(new Set())
const restrictedPlaybackConfigured = computed(() => (
  hasConfiguredRestrictedPlaybackAuthentication(store.getters)
))

let contentResizeObserver = null
let observationGeneration = 0
let updateSequence = 0
let pendingChannelSettingsUpdates = 0
let hasFailedChannelSettingsUpdate = false
let channelSettingsUpdateQueue = Promise.resolve()
const latestUpdateByChannel = new Map()

watch(showManager, async (open) => {
  const generation = ++observationGeneration
  stopObservingContent()
  if (!open) return
  resetChannelPage()

  await nextTick()
  if (generation !== observationGeneration || !showManager.value) return

  const scroller = channelSettingsScroller.value
  const content = channelSettingsContent.value
  if (!scroller || !content) return

  const clampScroll = () => clampOverlayScrollTop(scroller, content)
  contentResizeObserver = new ResizeObserver(clampScroll)
  contentResizeObserver.observe(scroller)
  contentResizeObserver.observe(content)
  clampScroll()
})

onBeforeUnmount(() => {
  observationGeneration += 1
  stopObservingContent()
})

function stopObservingContent() {
  contentResizeObserver?.disconnect()
  contentResizeObserver = null
}

const channels = computed(() => {
  const subscriptions = store.getters.getProfileList[0]?.subscriptions ?? []
  const collator = new Intl.Collator([locale.value, 'en'], { sensitivity: 'base' })

  return [...subscriptions].sort((a, b) => (
    collator.compare(a.name || a.id, b.name || b.id)
  ))
})

const visibleChannels = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase()
  if (query === '') return channels.value

  return channels.value.filter(channel => (
    (channel.name || '').toLocaleLowerCase().includes(query) ||
    channel.id.toLocaleLowerCase().includes(query)
  ))
})

const { page: channelPage, hasMore: hasMoreChannels, displayedItems: displayedChannels, reset: resetChannelPage } = useListPagination(visibleChannels, {
  pageSize: channelsPerPage,
  append: true,
  resetOn: searchQuery,
  scrollTarget: channelSettingsScroller
})

const feedTypes = computed(() => getSubscriptionFeedTypeOptions(t))
const limitOptions = computed(() => getSubscriptionDailyVideoLimitOptions(t))
const limitNames = computed(() => limitOptions.value.map(option => option.label))
const limitValues = computed(() => limitOptions.value.map(option => option.value))
const selectedChannels = computed(() => channels.value.filter(channel => (
  selectedChannelIds.value.has(channel.id)
)))
const selectedChannelCountText = computed(() => t('Profile.{number} selected', {
  number: selectedChannelIds.value.size
}))
const allVisibleChannelsSelected = computed(() => (
  visibleChannels.value.length > 0 &&
  visibleChannels.value.every(channel => selectedChannelIds.value.has(channel.id))
))
const selectedMembersOnlyState = computed(() => selectedState(channel => (
  channelSettings(channel).showMembersOnly
)))
const selectedDailyLimitValue = computed(() => {
  const values = selectedChannels.value.map(channelLimitValue)
  return values.every(value => value === values[0]) ? values[0] : 'mixed'
})
const bulkLimitOptions = computed(() => selectedDailyLimitValue.value === 'mixed'
  ? [{ value: 'mixed', label: t('Channel.Different values') }, ...limitOptions.value]
  : limitOptions.value)
const bulkLimitNames = computed(() => bulkLimitOptions.value.map(option => option.label))
const bulkLimitValues = computed(() => bulkLimitOptions.value.map(option => option.value))

watch(channels, (channelList) => {
  const channelIds = new Set(channelList.map(channel => channel.id))
  const nextSelection = new Set(
    [...selectedChannelIds.value].filter(channelId => channelIds.has(channelId))
  )

  if (nextSelection.size !== selectedChannelIds.value.size) {
    selectedChannelIds.value = nextSelection
  }
})

/**
 * @typedef {object} SubscriptionChannel
 * @property {string} id
 * @property {string[]|undefined} feedTypes
 * @property {number|null|undefined} dailyVideoLimit
 * @property {boolean|undefined} showMembersOnly
 */

/**
 * @param {SubscriptionChannel} channel
 */
function channelLimitValue(channel) {
  return formatSubscriptionDailyVideoLimit(channelSettings(channel).dailyVideoLimit)
}

/**
 * @param {SubscriptionChannel} channel
 * @param {'videos' | 'shorts' | 'live' | 'posts'} feedType
 */
function isFeedTypeEnabled(channel, feedType) {
  return channelSettings(channel).feedTypes.includes(feedType)
}

/**
 * @param {string} channelId
 */
function isChannelSelected(channelId) {
  return selectedChannelIds.value.has(channelId)
}

/**
 * @param {string} channelId
 */
function toggleChannelSelection(channelId) {
  const nextSelection = new Set(selectedChannelIds.value)
  if (nextSelection.has(channelId)) {
    nextSelection.delete(channelId)
  } else {
    nextSelection.add(channelId)
  }
  selectedChannelIds.value = nextSelection
}

function selectAllVisibleChannels() {
  selectedChannelIds.value = new Set([
    ...selectedChannelIds.value,
    ...visibleChannels.value.map(channel => channel.id)
  ])
}

function clearChannelSelection() {
  selectedChannelIds.value = new Set()
}

/**
 * @param {(channel: SubscriptionChannel) => boolean} isEnabled
 * @returns {boolean | 'mixed'}
 */
function selectedState(isEnabled) {
  const enabledCount = selectedChannels.value.filter(isEnabled).length

  if (enabledCount === 0) return false
  if (enabledCount === selectedChannels.value.length) return true
  return 'mixed'
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} feedType
 * @returns {boolean | 'mixed'}
 */
function selectedFeedTypeState(feedType) {
  return selectedState(channel => (
    isFeedTypeEnabled(channel, feedType)
  ))
}

const selectedFeedTypeStates = computed(() => Object.fromEntries(
  feedTypes.value.map(({ id }) => [id, selectedFeedTypeState(id)])
))

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} feedType
 */
function updateSelectedFeedType(feedType) {
  const enabled = selectedFeedTypeState(feedType) !== true
  selectedChannels.value.forEach((channel) => {
    if (isFeedTypeEnabled(channel, feedType) !== enabled) {
      updateFeedType(channel, feedType, enabled)
    }
  })
}

function updateSelectedShowMembersOnly() {
  const enabled = selectedMembersOnlyState.value !== true
  selectedChannels.value.forEach((channel) => {
    if (channelSettings(channel).showMembersOnly !== enabled) {
      updateShowMembersOnly(channel, enabled)
    }
  })
}

/**
 * @param {string} value
 */
function updateSelectedChannelLimit(value) {
  if (value === 'mixed') return

  selectedChannels.value.forEach((channel) => {
    if (channelLimitValue(channel) !== value) {
      updateChannelLimit(channel, value)
    }
  })
}

/**
 * @param {SubscriptionChannel} channel
 * @param {'videos' | 'shorts' | 'live' | 'posts'} feedType
 * @param {boolean} enabled
 */
function updateFeedType(channel, feedType, enabled) {
  persistChannelSettings(channel, {
    feedTypes: getUpdatedSubscriptionFeedTypes(
      channelSettings(channel).feedTypes,
      feedType,
      enabled
    )
  })
}

/**
 * @param {SubscriptionChannel} channel
 * @param {string} value
 */
function updateChannelLimit(channel, value) {
  persistChannelSettings(channel, {
    dailyVideoLimit: parseSubscriptionDailyVideoLimit(value)
  })
}

/**
 * @param {SubscriptionChannel} channel
 * @param {boolean} value
 */
function updateShowMembersOnly(channel, value) {
  persistChannelSettings(channel, { showMembersOnly: value })
}

/**
 * @param {SubscriptionChannel} channel
 */
function channelSettings(channel) {
  const optimisticSettings = optimisticChannelSettings.value.get(channel.id)
  if (optimisticSettings !== undefined) return optimisticSettings
  return normalizeSubscriptionChannelSettings(channel)
}

/**
 * @param {SubscriptionChannel} channel
 * @param {{ feedTypes?: string[], dailyVideoLimit?: number|null|undefined, showMembersOnly?: boolean }} patch
 */
function persistChannelSettings(channel, patch) {
  const settings = { ...channelSettings(channel), ...patch }
  const sequence = ++updateSequence
  pendingChannelSettingsUpdates += 1
  latestUpdateByChannel.set(channel.id, sequence)
  optimisticChannelSettings.value = new Map(optimisticChannelSettings.value)
    .set(channel.id, settings)

  channelSettingsUpdateQueue = channelSettingsUpdateQueue.then(async () => {
    let saved = false
    try {
      saved = await store.dispatch('updateChannelSettings', {
        channelId: channel.id,
        settings: patch
      })
    } catch (error) {
      console.error(error)
    } finally {
      if (latestUpdateByChannel.get(channel.id) === sequence) {
        const nextSettings = new Map(optimisticChannelSettings.value)
        nextSettings.delete(channel.id)
        optimisticChannelSettings.value = nextSettings
        latestUpdateByChannel.delete(channel.id)
      }
      if (!saved) hasFailedChannelSettingsUpdate = true
      pendingChannelSettingsUpdates -= 1
      if (pendingChannelSettingsUpdates === 0 && hasFailedChannelSettingsUpdate) {
        hasFailedChannelSettingsUpdate = false
        showToast({
          message: t('Channel.Failed to save subscription settings'),
          icon: ['fas', 'circle-exclamation']
        })
      }
    }
  })
}
</script>

<style scoped src="./SubscriptionChannelSettings.css" />
