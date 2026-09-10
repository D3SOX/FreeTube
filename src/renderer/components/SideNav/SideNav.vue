<template>
  <FtFlexBox
    class="sideNav"
    :class="[{ opened: isOpen, expanded: isOpen || props.forceExpanded }, applyHiddenLabels]"
    data-tutorial="navigation"
    role="navigation"
  >
    <div
      ref="innerRef"
      v-overlay-scrollbars
      class="inner"
      :class="applyHiddenLabels"
    >
      <div
        v-show="indicatorStyle"
        class="activeIndicator"
        :style="indicatorStyle"
        aria-hidden="true"
      />
      <router-link
        v-for="(item, index) in visibleNavigationItems"
        :key="item.id"
        class="navOption"
        :class="{
          topNavOption: index === 0,
          mobileHidden: !mobilePrimaryItemIds.has(item.id),
        }"
        role="button"
        :to="`/${item.id}`"
        :title="item.id === 'history' ? historyTitle : item.label"
      >
        <div class="thumbnailContainer">
          <FtIcon
            :icon="item.icon"
            class="navIcon"
            :class="applyNavIconExpand"
          />
        </div>
        <p class="navLabel">
          {{ item.label }}
        </p>
      </router-link>
      <SideNavMoreOptions
        v-if="mobileOverflowItems.length > 0"
        :items="mobileOverflowItems"
      />
      <hr>
      <div
        v-if="!hideActiveSubscriptions"
        class="mobileHidden"
      >
        <component
          :is="enableChannelLinks ? 'router-link' : 'span'"
          v-for="channel in displayedActiveSubscriptions"
          :key="channel.id"
          :to="`/channel/${channel.id}`"
          :class="enableChannelLinks ? '' : 'disabledIcon'"
          class="navChannel channelLink mobileHidden"
          :title="channel.name"
          role="button"
        >
          <div
            class="thumbnailContainer"
          >
            <FtRetryImage
              v-if="channel.thumbnail != null"
              class="channelThumbnail"
              height="35"
              width="35"
              loading="lazy"
              :src="channel.thumbnail"
              :alt="isOpen ? '' : channel.name"
            />
            <FtIcon
              v-else
              class="channelThumbnail noThumbnail"
              :icon="['fas', 'circle-user']"
            />
          </div>
          <p
            v-if="isOpen"
            class="navLabel"
            dir="auto"
          >
            {{ channel.name }}
          </p>
        </component>
        <div
          v-if="hasMoreActiveSubscriptions"
          :key="activeSubscriptionLimit"
          v-observe-visibility="{
            callback: onActiveSubscriptionsVisibilityChanged
          }"
          class="subscriptionLoadSentinel"
          aria-hidden="true"
        />
      </div>
    </div>
  </FtFlexBox>
</template>

<script setup>
import FtRetryImage from '../FtRetryImage.vue'
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import SideNavMoreOptions from '../SideNavMoreOptions/SideNavMoreOptions.vue'

import store from '../../store/index'

import { youtubeImageUrlToInvidious } from '../../helpers/api/invidious'
import { filterAvailableNavigationItems } from '../../../navigationAvailability'
import { deepCopy, localizeAndAddKeyboardShortcutToActionTitle } from '../../helpers/utils'
import { getConfiguredKeyboardShortcuts } from '../../../constants'
import { NAVIGATION_ITEM_DEFINITIONS } from '../../../navigationItems'

const { locale, t } = useI18n()
const appKeyboardShortcuts = computed(() => getConfiguredKeyboardShortcuts(
  store.getters.getKeyboardShortcuts
).APP.GENERAL)

const SUPPORTS_LOCAL_API = process.env.SUPPORTS_LOCAL_API
const activeSubscriptionsPerPage = 50

const props = defineProps({
  forceExpanded: {
    type: Boolean,
    default: false
  }
})

/** @type {import('vue').ComputedRef<boolean>} */
const isOpen = computed(() => {
  return store.getters.getIsSideNavOpen
})

/** @type {import('vue').ComputedRef<boolean>} */
const backendFallback = computed(() => {
  return store.getters.getBackendFallback
})

/** @type {import('vue').ComputedRef<'local' | 'invidious'>} */
const backendPreference = computed(() => {
  return store.getters.getBackendPreference
})

/** @type {import('vue').ComputedRef<string>} */
const currentInvidiousInstanceUrl = computed(() => {
  return store.getters.getCurrentInvidiousInstanceUrl
})

/** @type {import('vue').ComputedRef<object>} */
const activeProfile = computed(() => {
  return store.getters.getActiveProfile
})

const activeSubscriptions = computed(() => {
  /** @type {any[]} */
  const subscriptions = deepCopy(activeProfile.value.subscriptions)

  subscriptions.forEach(channel => {
    // Change thumbnail size to 35x35, as that's the size we display it
    // so we don't need to download a bigger image (the default is 176x176)
    channel.thumbnail = channel.thumbnail?.replace(/=s\d+/, '=s35')
  })

  const locale_ = locale.value
  subscriptions.sort((a, b) => {
    return a.name?.toLowerCase().localeCompare(b.name?.toLowerCase(), locale_)
  })

  if (backendPreference.value === 'invidious') {
    const instanceUrl = currentInvidiousInstanceUrl.value

    subscriptions.forEach((channel) => {
      channel.thumbnail = youtubeImageUrlToInvidious(channel.thumbnail, instanceUrl)
    })
  }

  return subscriptions
})

const activeSubscriptionLimit = ref(activeSubscriptionsPerPage)

const displayedActiveSubscriptions = computed(() => {
  return activeSubscriptions.value.slice(0, activeSubscriptionLimit.value)
})

const hasMoreActiveSubscriptions = computed(() => {
  return displayedActiveSubscriptions.value.length < activeSubscriptions.value.length
})

function onActiveSubscriptionsVisibilityChanged(isVisible) {
  if (isVisible) {
    activeSubscriptionLimit.value += activeSubscriptionsPerPage
  }
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideActiveSubscriptions = computed(() => {
  return store.getters.getHideActiveSubscriptions
})

/** @type {import('vue').ComputedRef<boolean>} */
const showWatchStats = computed(() => {
  return store.getters.getRememberHistory && store.getters.getEnableWatchStats
})

const navigationCatalog = computed(() => new Map(NAVIGATION_ITEM_DEFINITIONS.map(item => [
  item.id,
  {
    ...item,
    // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
    label: t(item.labelKey),
  },
])))

const visibleNavigationItems = computed(() => filterAvailableNavigationItems(
  store.getters.getNavigationItems,
  {
    supportsLocalApi: !!SUPPORTS_LOCAL_API,
    backendPreference: backendPreference.value,
    backendFallback: backendFallback.value,
    showWatchStats: showWatchStats.value,
  }
)
  .map(id => navigationCatalog.value.get(id))
  .filter(item => item != null))

const mobilePrimaryItems = computed(() => visibleNavigationItems.value.length > 5
  ? visibleNavigationItems.value.slice(0, 4)
  : visibleNavigationItems.value)
const mobilePrimaryItemIds = computed(() => new Set(mobilePrimaryItems.value.map(({ id }) => id)))
const mobileOverflowItems = computed(() => visibleNavigationItems.value.length > 5
  ? visibleNavigationItems.value.slice(4)
  : [])

/** @type {import('vue').ComputedRef<boolean>} */
const hideText = computed(() => {
  return !isOpen.value && !props.forceExpanded && store.getters.getHideLabelsSideBar
})

const applyNavIconExpand = computed(() => {
  return {
    navIconExpand: hideText.value
  }
})

const applyHiddenLabels = computed(() => {
  return {
    hiddenLabels: hideText.value
  }
})

const historyTitle = computed(() => {
  const shortcut = process.platform === 'darwin'
    ? appKeyboardShortcuts.value.NAVIGATE_TO_HISTORY_MAC
    : appKeyboardShortcuts.value.NAVIGATE_TO_HISTORY

  return localizeAndAddKeyboardShortcutToActionTitle(
    t('History.History'),
    shortcut
  )
})

// ===== Sliding active-route indicator =====
const route = useRoute()
const innerRef = useTemplateRef('innerRef')
/** @type {import('vue').Ref<Record<string, string> | null>} */
const indicatorStyle = ref(null)

let remeasureTimeoutId = null
let navMutationObserver = null

function updateIndicator() {
  const inner = innerRef.value
  const mobile = window.matchMedia('(max-width: 680px)').matches
  // Hidden overflow links use the visible More button as their mobile target.
  const active = inner == null
    ? null
    : Array.from(inner.querySelectorAll(mobile
        ? ':scope > .navOption.router-link-active, :scope > .sideNavMoreOptions > .moreOptionNav.router-link-active'
        : '.navOption.router-link-active, .navChannel.router-link-active'))
        .find((el) => el instanceof HTMLElement && el.offsetParent !== null)

  if (!(active instanceof HTMLElement)) {
    indicatorStyle.value = null
    return
  }

  if (mobile) {
    const nav = active.closest('.sideNav')
    if (!(nav instanceof HTMLElement)) {
      indicatorStyle.value = null
      return
    }

    const navBounds = nav.getBoundingClientRect()
    const activeBounds = active.getBoundingClientRect()
    const inlineOffset = getComputedStyle(nav).direction === 'rtl'
      ? navBounds.right - activeBounds.right
      : activeBounds.left - navBounds.left

    indicatorStyle.value = {
      transform: `translateX(${getComputedStyle(nav).direction === 'rtl' ? -inlineOffset : inlineOffset}px)`,
      inlineSize: `${activeBounds.width}px`,
      blockSize: '3px'
    }
    return
  }

  indicatorStyle.value = {
    transform: `translateY(${active.offsetTop}px)`,
    inlineSize: '3px',
    blockSize: `${active.offsetHeight}px`
  }
}

/**
 * Re-measure once the side nav's 150ms width transition has finished,
 * as expanding/collapsing reflows the nav entries.
 */
function updateIndicatorAfterResize() {
  clearTimeout(remeasureTimeoutId)
  remeasureTimeoutId = setTimeout(updateIndicator, 200)
}

watch(() => route.fullPath, () => nextTick(updateIndicator))
watch([
  () => activeProfile.value._id,
  () => activeProfile.value.subscriptions.length
], () => {
  activeSubscriptionLimit.value = activeSubscriptionsPerPage
})

watch([isOpen, hideText, displayedActiveSubscriptions], () => {
  nextTick(updateIndicator)
  updateIndicatorAfterResize()
})

onMounted(() => {
  updateIndicator()
  navMutationObserver = new MutationObserver(() => nextTick(updateIndicator))
  navMutationObserver.observe(innerRef.value, { childList: true, subtree: true })
  window.addEventListener('resize', updateIndicatorAfterResize)
})

onBeforeUnmount(() => {
  clearTimeout(remeasureTimeoutId)
  navMutationObserver?.disconnect()
  window.removeEventListener('resize', updateIndicatorAfterResize)
})

const enableChannelLinks = computed(() => !store.getters.getDisableChannelLinks)
</script>

<style scoped src="./SideNav.css" />
