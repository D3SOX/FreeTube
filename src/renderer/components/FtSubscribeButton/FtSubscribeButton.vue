<template>
  <div
    ref="subscribeButton"
    class="ftSubscribeButton"
    @focusout="handleProfileDropdownFocusOut"
  >
    <div
      ref="buttonList"
      class="buttonList"
    >
      <FtButton
        :label="subscribedText"
        :no-border="true"
        :icon="isSubscribed ? ['fas', 'check'] : null"
        class="subscribeButton"
        :class="{
          hasProfileDropdownToggle: isSubscriptionOptionsEnabled,
          dropdownOpened: isProfileDropdownOpen,
          justToggled: justToggled
        }"
        background-color="var(--primary-color)"
        text-color="var(--text-with-main-color)"
        @click="handleSubscription(activeProfile)"
      />
      <FtPrompt
        v-if="showUnsubscribePopupForProfile !== null"
        :label="$t('Channels.Unsubscribe Prompt', { channelName: channelName })"
        :option-names="[$t('Yes'), $t('No')]"
        :option-values="['yes', 'no']"
        :autosize="true"
        @click="handleUnsubscribeConfirmation"
      />
      <button
        v-if="isSubscriptionOptionsEnabled"
        type="button"
        :title="subscriptionOptionsTitle"
        :aria-label="subscriptionOptionsTitle"
        class="profileDropdownToggle profileDropdownToggleButton"
        :class="{ dropdownOpened: isProfileDropdownOpen}"
        :aria-expanded="isProfileDropdownOpen"
        @click="toggleProfileDropdown"
      />
    </div>
    <Teleport
      v-if="isProfileDropdownOpen"
      to="body"
    >
      <Transition
        name="profile-dropdown"
        appear
      >
        <div
          ref="profileDropdown"
          tabindex="-1"
          class="profileDropdown"
          :class="{
            profileDropdownAnchoredLeftEdge,
            profileDropdownPositioned: isProfileDropdownPositioned,
            profileDropdownOpensAbove: profileDropdownOpensAbove
          }"
          :style="profileDropdownStyle"
          @focusout="handleProfileDropdownFocusOut"
          @keydown.esc.stop.prevent="closeProfileDropdown"
        >
          <div class="feedTypePreferences">
            <div
              role="group"
              class="feedTypePreferenceGroup"
              :aria-labelledby="`${id}-feed-types`"
            >
              <p
                :id="`${id}-feed-types`"
                class="feedTypePreferencesLabel"
              >
                {{ $t('Channel.Show in subscription feed') }}
              </p>
              <div class="feedTypePreferenceGrid">
                <button
                  v-for="feedType in feedTypes"
                  :key="feedType.id"
                  type="button"
                  class="feedTypePreference"
                  role="checkbox"
                  :aria-checked="enabledFeedTypes.has(feedType.id)"
                  @click="updateFeedType(feedType.id, !enabledFeedTypes.has(feedType.id))"
                >
                  <span
                    class="feedTypePreferenceIcon"
                    aria-hidden="true"
                  >
                    <FtIcon :icon="feedType.icon" />
                  </span>
                  <span>{{ feedType.label }}</span>
                  <span
                    class="feedTypePreferenceCheck"
                    aria-hidden="true"
                  >
                    <FtIcon
                      v-if="enabledFeedTypes.has(feedType.id)"
                      :icon="['fas', 'check']"
                    />
                  </span>
                </button>
              </div>
            </div>
            <div class="secondaryPreferences">
              <div
                v-if="restrictedPlaybackConfigured"
                class="membersOnlyPreference"
              >
                <button
                  type="button"
                  class="feedTypePreference"
                  role="checkbox"
                  :aria-checked="activeChannelSettings.showMembersOnly"
                  @click="updateShowMembersOnly(!activeChannelSettings.showMembersOnly)"
                >
                  <span
                    class="feedTypePreferenceIcon"
                    aria-hidden="true"
                  >
                    <FtIcon :icon="['fas', 'users']" />
                  </span>
                  <span>{{ $t('Search Listing.Label.Members Only') }}</span>
                  <span
                    class="feedTypePreferenceCheck"
                    aria-hidden="true"
                  >
                    <FtIcon
                      v-if="activeChannelSettings.showMembersOnly"
                      :icon="['fas', 'check']"
                    />
                  </span>
                </button>
              </div>
              <div class="dailyVideoLimitPreference">
                <FtSelect
                  class="dailyVideoLimitSelect"
                  :value="dailyVideoLimitValue"
                  :placeholder="$t('Channel.Videos per day')"
                  :select-names="dailyVideoLimitNames"
                  :select-values="dailyVideoLimitValues"
                  :icon="['fas', 'clock']"
                  :dropdown-z-index="1002"
                  @change="updateDailyVideoLimit"
                />
              </div>
            </div>
          </div>
          <div
            v-if="isProfileDropdownEnabled"
            ref="profileDropdownScroller"
            v-overlay-scrollbars
            class="profileDropdownScroller"
          >
            <ul
              ref="profileListContent"
              class="profileList"
            >
              <li
                v-for="(profile, index) in profileDisplayList"
                :key="index"
                class="profile"
                :aria-labelledby="id + '-' + index"
                :aria-selected="isActiveProfile(profile)"
                :aria-checked="isProfileSubscribed(profile)"
                tabindex="0"
                role="checkbox"
                @click.stop.prevent="handleSubscription(profile)"
                @keydown.space.stop.prevent="handleSubscription(profile)"
              >
                <FtProfileIcon
                  class="colorOption"
                  :profile="profile"
                  :fallback="profileInitials[profile._id]"
                />
                <p
                  :id="id + '-' + index"
                  class="profileName"
                  dir="auto"
                >
                  {{ profile.name }}
                </p>
                <span
                  class="profileCheck"
                  aria-hidden="true"
                >
                  <FtIcon
                    v-if="isProfileSubscribed(profile)"
                    :icon="['fas', 'check']"
                  />
                </span>
              </li>
            </ul>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'
import FtPrompt from '../FtPrompt/FtPrompt.vue'
import FtProfileIcon from '../FtProfileIcon/FtProfileIcon.vue'
import FtSelect from '../FtSelect/FtSelect.vue'

import store from '../../store/index'

import { MAIN_PROFILE_ID } from '../../../constants'
import { showToast } from '../../helpers/utils'
import { getFirstCharacter } from '../../helpers/strings'
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

const props = defineProps({
  channelId: {
    type: String,
    required: true
  },
  channelName: {
    type: String,
    required: true
  },
  channelThumbnail: {
    type: String,
    default: null
  },
  hideProfileDropdownToggle: {
    type: Boolean,
    default: false
  },
  openDropdownOnSubscribe: {
    type: Boolean,
    default: true
  },
  subscriptionCountText: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['subscribed'])

const id = useId()

/**
 * @typedef {object} Profile
 * @property {string} _id
 * @property {string} name
 * @property {string} bgColor
 * @property {string} textColor
 * @property {object[]} subscriptions
 * @property {string} subscriptions[].id
 * @property {string|undefined} subscriptions[].name
 * @property {string|undefined} subscriptions[].thumbnail
 * @property {string[]|undefined} subscriptions[].feedTypes
 * @property {number|null|undefined} subscriptions[].dailyVideoLimit
 * @property {boolean|undefined} subscriptions[].showMembersOnly
 */

/** @type {import('vue').ComputedRef<Profile[]>} */
const profileList = computed(() => {
  return store.getters.getProfileList
})

/** @type {import('vue').ComputedRef<Profile>} */
const activeProfile = computed(() => {
  return store.getters.getActiveProfile
})

const profileDisplayList = computed(() => [
  profileList.value[0],
  ...(activeProfile.value._id !== MAIN_PROFILE_ID ? [activeProfile.value] : []),
  ...profileList.value.filter((profile, i) => i !== 0 && !isActiveProfile(profile) && !isProfileSubscribed(profile)),
  ...profileList.value.filter((profile, i) => i !== 0 && !isActiveProfile(profile) && isProfileSubscribed(profile))
])

const profileInitials = computed(() => {
  const locale_ = locale.value

  return profileList.value.reduce((accumulator, profile) => {
    accumulator[profile._id] = profile.name
      ? getFirstCharacter(profile.name, locale_)
      : ''

    return accumulator
  }, {})
})

/** @type {import('vue').ComputedRef<boolean>} */
const hideChannelSubscriptions = computed(() => {
  return store.getters.getHideChannelSubscriptions
})

const subscribedText = computed(() => {
  let subscribedValue = (isProfileSubscribed(activeProfile.value) ? t('Channel.Unsubscribe') : t('Channel.Subscribe'))
  if (props.subscriptionCountText !== '' && !hideChannelSubscriptions.value) {
    subscribedValue += ' ' + props.subscriptionCountText
  }
  return subscribedValue
})

const isProfileDropdownEnabled = computed(() => {
  return !props.hideProfileDropdownToggle && profileList.value.length > 1
})

const isSubscriptionOptionsEnabled = computed(() => {
  return !props.hideProfileDropdownToggle && isSubscribed.value
})

const isProfileDropdownOpen = ref(false)
const buttonList = useTemplateRef('buttonList')
const profileDropdown = useTemplateRef('profileDropdown')
const profileDropdownScroller = useTemplateRef('profileDropdownScroller')
const profileListContent = useTemplateRef('profileListContent')
const profileDropdownStyle = ref({ left: '8px', top: '8px' })
const profileDropdownAnchoredLeftEdge = ref(false)
const isProfileDropdownPositioned = ref(false)
const profileDropdownOpensAbove = ref(false)
/** @type {import('vue').ShallowRef<Profile | null>} */
const showUnsubscribePopupForProfile = shallowRef(null)

let profileListResizeObserver = null
let profileListObservationGeneration = 0
let profileDropdownPositionMutationObserver = null
let profileDropdownPositionResizeObserver = null
let profileDropdownPositionFrame = null

watch(isProfileDropdownOpen, async (open) => {
  const generation = ++profileListObservationGeneration
  stopObservingProfileList()
  removeProfileDropdownPositionTracking()
  if (!open) return

  await nextTick()
  if (generation !== profileListObservationGeneration ||
    !isProfileDropdownOpen.value || profileDropdown.value === null) return

  positionProfileDropdown()
  await nextTick()
  if (generation !== profileListObservationGeneration ||
    !isProfileDropdownOpen.value || profileDropdown.value === null) return

  profileDropdown.value.focus({ preventScroll: true })
  profileDropdownPositionResizeObserver = new ResizeObserver(scheduleProfileDropdownPositionUpdate)
  profileDropdownPositionResizeObserver.observe(profileDropdown.value)
  if (buttonList.value !== null) {
    profileDropdownPositionResizeObserver.observe(buttonList.value)
  }
  profileDropdownPositionMutationObserver = new MutationObserver((records) => {
    const dropdown = profileDropdown.value
    if (dropdown !== null && records.every(({ target }) => (
      target === dropdown || dropdown.contains(target)
    ))) return

    scheduleProfileDropdownPositionUpdate()
  })
  profileDropdownPositionMutationObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['class', 'hidden', 'style'],
    childList: true,
    subtree: true
  })
  window.addEventListener('resize', scheduleProfileDropdownPositionUpdate)
  window.addEventListener('scroll', scheduleProfileDropdownPositionUpdate, { capture: true, passive: true })

  const scroller = profileDropdownScroller.value
  const content = profileListContent.value
  if (!isProfileDropdownEnabled.value || !scroller || !content) return

  const clampScroll = () => clampOverlayScrollTop(scroller, content)
  profileListResizeObserver = new ResizeObserver(clampScroll)
  profileListResizeObserver.observe(scroller)
  profileListResizeObserver.observe(content)
  clampScroll()
})

const isSubscribed = computed(() => isProfileSubscribed(activeProfile.value))
const restrictedPlaybackConfigured = computed(() => (
  hasConfiguredRestrictedPlaybackAuthentication(store.getters)
))

const feedTypes = computed(() => getSubscriptionFeedTypeOptions(t))

const storedChannelSettings = computed(() => {
  const subscription = profileList.value[0].subscriptions.find(channel => channel.id === props.channelId)
  return normalizeSubscriptionChannelSettings(subscription)
})

/** @type {import('vue').Ref<{feedTypes: string[], dailyVideoLimit: number|null|undefined, showMembersOnly: boolean} | null>} */
const optimisticChannelSettings = ref(null)
const activeChannelSettings = computed(() => (
  optimisticChannelSettings.value ?? storedChannelSettings.value
))
const enabledFeedTypes = computed(() => new Set(activeChannelSettings.value.feedTypes))
const dailyVideoLimitValue = computed(() => (
  formatSubscriptionDailyVideoLimit(activeChannelSettings.value.dailyVideoLimit)
))
const dailyVideoLimitOptions = computed(() => getSubscriptionDailyVideoLimitOptions(t))
const dailyVideoLimitNames = computed(() => dailyVideoLimitOptions.value.map(option => option.label))
const dailyVideoLimitValues = computed(() => dailyVideoLimitOptions.value.map(option => option.value))
let channelSettingsUpdateSequence = 0
let channelSettingsUpdateQueue = Promise.resolve()

const subscriptionOptionsTitle = computed(() => t('Channel.Subscription settings'))

const justToggled = ref(false)
let justToggledTimeoutId = null

watch(isSubscribed, (subscribed) => {
  clearTimeout(justToggledTimeoutId)
  justToggled.value = true
  justToggledTimeoutId = setTimeout(() => {
    justToggled.value = false
  }, 400)

  if (subscribed) {
    optimisticChannelSettings.value = null
  } else {
    isProfileDropdownOpen.value = false
  }
})

onBeforeUnmount(() => {
  clearTimeout(justToggledTimeoutId)
  profileListObservationGeneration += 1
  stopObservingProfileList()
  removeProfileDropdownPositionTracking()
})

function stopObservingProfileList() {
  profileListResizeObserver?.disconnect()
  profileListResizeObserver = null
}

function positionProfileDropdown() {
  const dropdown = profileDropdown.value
  const trigger = buttonList.value
  if (dropdown === null || trigger === null) return

  const viewportMargin = 8
  const gap = 4
  const triggerRect = trigger.getBoundingClientRect()
  const dropdownWidth = dropdown.offsetWidth
  const dropdownHeight = dropdown.offsetHeight
  const horizontalPosition = getProfileDropdownHorizontalPosition(
    trigger,
    triggerRect,
    dropdownWidth,
    viewportMargin
  )
  const below = triggerRect.bottom + gap
  const above = triggerRect.top - dropdownHeight - gap
  const maximumTop = Math.max(viewportMargin, window.innerHeight - dropdownHeight - viewportMargin)
  const opensAbove = below + dropdownHeight > window.innerHeight - viewportMargin &&
    above >= viewportMargin
  const preferredTop = opensAbove ? above : below
  const top = Math.max(viewportMargin, Math.min(preferredTop, maximumTop))

  profileDropdownStyle.value = {
    left: `${snapToDevicePixels(horizontalPosition.left)}px`,
    top: `${snapToDevicePixels(top)}px`
  }
  profileDropdownAnchoredLeftEdge.value = horizontalPosition.anchoredLeftEdge
  profileDropdownOpensAbove.value = opensAbove
  isProfileDropdownPositioned.value = true
}

function prepareProfileDropdownPosition() {
  const trigger = buttonList.value
  if (trigger === null) return

  const viewportMargin = 8
  const dropdownWidth = Math.min(240, window.innerWidth - 2 * viewportMargin)
  const triggerRect = trigger.getBoundingClientRect()
  const horizontalPosition = getProfileDropdownHorizontalPosition(
    trigger,
    triggerRect,
    dropdownWidth,
    viewportMargin
  )

  profileDropdownStyle.value = {
    left: `${snapToDevicePixels(horizontalPosition.left)}px`,
    top: `${snapToDevicePixels(Math.max(viewportMargin, triggerRect.bottom + 4))}px`
  }
  profileDropdownAnchoredLeftEdge.value = horizontalPosition.anchoredLeftEdge
  profileDropdownOpensAbove.value = false
  isProfileDropdownPositioned.value = false
}

/**
 * @param {HTMLElement} trigger
 * @param {DOMRect} triggerRect
 * @param {number} dropdownWidth
 * @param {number} viewportMargin
 */
function getProfileDropdownHorizontalPosition(trigger, triggerRect, dropdownWidth, viewportMargin) {
  const anchoredLeftEdge = getComputedStyle(trigger).direction === 'rtl'
  const preferredLeft = anchoredLeftEdge
    ? triggerRect.left
    : triggerRect.right - dropdownWidth
  const maximumLeft = Math.max(viewportMargin, window.innerWidth - dropdownWidth - viewportMargin)

  return {
    anchoredLeftEdge,
    left: Math.max(viewportMargin, Math.min(preferredLeft, maximumLeft))
  }
}

/**
 * @param {number} value
 */
function snapToDevicePixels(value) {
  const ratio = window.devicePixelRatio || 1
  return Math.round(value * ratio) / ratio
}

function scheduleProfileDropdownPositionUpdate() {
  if (profileDropdownPositionFrame !== null) {
    cancelAnimationFrame(profileDropdownPositionFrame)
  }

  profileDropdownPositionFrame = requestAnimationFrame(() => {
    profileDropdownPositionFrame = null
    positionProfileDropdown()
  })
}

function removeProfileDropdownPositionTracking() {
  window.removeEventListener('resize', scheduleProfileDropdownPositionUpdate)
  window.removeEventListener('scroll', scheduleProfileDropdownPositionUpdate, true)
  profileDropdownPositionMutationObserver?.disconnect()
  profileDropdownPositionMutationObserver = null
  profileDropdownPositionResizeObserver?.disconnect()
  profileDropdownPositionResizeObserver = null

  if (profileDropdownPositionFrame !== null) {
    cancelAnimationFrame(profileDropdownPositionFrame)
    profileDropdownPositionFrame = null
  }
}

/**
 * @param {FocusEvent} event
 */
function handleProfileDropdownFocusOut(event) {
  const nextTarget = event.relatedTarget
  const focusStaysInControl = nextTarget instanceof Node && (
    subscribeButton.value?.contains(nextTarget) ||
    profileDropdown.value?.contains(nextTarget)
  )

  if (!focusStaysInControl) isProfileDropdownOpen.value = false
}

/**
 * @param {Profile} profile
 */
function handleSubscription(profile) {
  if (props.channelId === '') {
    return
  }

  if (isProfileSubscribed(profile)) {
    if (store.getters.getUnsubscriptionPopupStatus) {
      showUnsubscribePopupForProfile.value = profile
    } else {
      handleUnsubscription(profile)
    }
  } else {
    const profileIds = [profile._id]

    if (profile._id !== MAIN_PROFILE_ID) {
      const primaryProfile = profileList.value.find(prof => {
        return prof._id === MAIN_PROFILE_ID
      })

      if (!isProfileSubscribed(primaryProfile)) {
        profileIds.push(MAIN_PROFILE_ID)
      }
    }

    const channel = {
      id: props.channelId,
      name: props.channelName,
      thumbnail: props.channelThumbnail,
      feedTypes: [...activeChannelSettings.value.feedTypes],
      showMembersOnly: activeChannelSettings.value.showMembersOnly
    }
    if (activeChannelSettings.value.dailyVideoLimit !== undefined) {
      channel.dailyVideoLimit = activeChannelSettings.value.dailyVideoLimit
    }

    store.dispatch('addChannelToProfiles', {
      channel,
      profileIds
    })

    showToast({ message: t('Channel.Added channel to your subscriptions'), icon: ['fas', 'rss'] })
    emit('subscribed')
  }

  if (isProfileDropdownEnabled.value && props.openDropdownOnSubscribe && !isProfileDropdownOpen.value) {
    toggleProfileDropdown()
  }
}

const subscribeButton = useTemplateRef('subscribeButton')

function toggleProfileDropdown() {
  if (isProfileDropdownOpen.value) {
    isProfileDropdownOpen.value = false
  } else {
    prepareProfileDropdownPosition()
    isProfileDropdownOpen.value = true
  }
}

function closeProfileDropdown() {
  isProfileDropdownOpen.value = false
  nextTick(() => {
    subscribeButton.value?.querySelector('.profileDropdownToggle')?.focus({ preventScroll: true })
  })
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} feedType
 * @param {boolean} enabled
 */
function updateFeedType(feedType, enabled) {
  persistChannelSettings({
    feedTypes: getUpdatedSubscriptionFeedTypes(
      activeChannelSettings.value.feedTypes,
      feedType,
      enabled
    )
  })
}

/**
 * @param {string} value
 */
function updateDailyVideoLimit(value) {
  persistChannelSettings({
    dailyVideoLimit: parseSubscriptionDailyVideoLimit(value)
  })
}

/**
 * @param {boolean} value
 */
function updateShowMembersOnly(value) {
  persistChannelSettings({ showMembersOnly: value })
}

/**
 * @param {{feedTypes?: string[], dailyVideoLimit?: number|null|undefined, showMembersOnly?: boolean}} patch
 */
function persistChannelSettings(patch) {
  const settings = {
    ...activeChannelSettings.value,
    ...patch
  }
  const updateSequence = ++channelSettingsUpdateSequence
  optimisticChannelSettings.value = settings
  if (!isSubscribed.value) return

  channelSettingsUpdateQueue = channelSettingsUpdateQueue.then(async () => {
    let saved = false
    try {
      saved = await store.dispatch('updateChannelSettings', {
        channelId: props.channelId,
        settings: patch
      })
    } catch (error) {
      console.error(error)
    } finally {
      if (updateSequence === channelSettingsUpdateSequence) {
        optimisticChannelSettings.value = null
      }
      if (!saved) {
        showToast({
          message: t('Channel.Failed to save subscription settings'),
          icon: ['fas', 'circle-exclamation']
        })
      }
    }
  })
}

/**
 * @param {'yes' | 'no' | null} value
 */
function handleUnsubscribeConfirmation(value) {
  const profile = showUnsubscribePopupForProfile.value
  showUnsubscribePopupForProfile.value = null

  if (value === 'yes') {
    handleUnsubscription(profile)
  }
}

/**
 * @param {Profile} profile
 */
function handleUnsubscription(profile) {
  const profileIds = [profile._id]

  if (profile._id === MAIN_PROFILE_ID) {
    // Check if a subscription exists in a different profile.
    // Remove from there as well.

    profileList.value.forEach((profileInList) => {
      if (profileInList._id === MAIN_PROFILE_ID) {
        return
      }

      if (isProfileSubscribed(profileInList)) {
        profileIds.push(profileInList._id)
      }
    })
  }

  store.dispatch('removeChannelFromProfiles', { channelId: props.channelId, profileIds })

  showToast({ message: t('Channel.Channel has been removed from your subscriptions'), icon: ['fas', 'trash'] })

  if (profile._id === MAIN_PROFILE_ID && profileIds.length > 1) {
    showToast({
      message: t('Channel.Removed subscription from {count} other channel(s)', { count: profileIds.length - 1 }, profileIds.length - 1),
      icon: ['fas', 'trash'],
    })
  }
}

/**
 * @param {Profile} profile
 */
function isActiveProfile(profile) {
  return profile._id === activeProfile.value._id
}

/**
 * @param {Profile} profile
 */
function isProfileSubscribed(profile) {
  const channelId = props.channelId

  return profile.subscriptions.some((channel) => channel.id === channelId)
}
</script>

<style scoped src="./FtSubscribeButton.css" />
