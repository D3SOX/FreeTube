<template>
  <FtSettingsSection
    :title="t('Settings.Distraction Free Settings.Distraction Free Settings')"
  >
    <h4
      class="groupTitle"
    >
      {{ t('Settings.Distraction Free Settings.Sections.General') }}
    </h4>
    <div class="switchColumnGrid">
      <div class="switchColumn">
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide Video Views')"
          :compact="true"
          :default-value="hideVideoViews"
          setting-key="hideVideoViews"
          @change="updateHideVideoViews"
        />
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Shorten View Counts')"
          :compact="true"
          :default-value="shortenViewCounts"
          setting-key="shortenViewCounts"
          :tooltip="t('Tooltips.Distraction Free Settings.Shorten View Counts')"
          @change="updateShortenViewCounts"
        />
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide Channel Subscribers')"
          :compact="true"
          :default-value="hideChannelSubscriptions"
          setting-key="hideChannelSubscriptions"
          @change="updateHideChannelSubscriptions"
        />
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide Sharing Actions')"
          :compact="true"
          :default-value="hideSharingActions"
          setting-key="hideSharingActions"
          @change="updateHideSharingActions"
        />
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide Videos on Watch')"
          :default-value="hideWatchedSubs"
          setting-key="hideWatchedSubs"
          :compact="true"
          :tooltip="t('Tooltips.Distraction Free Settings.Hide Videos on Watch')"
          @change="updateHideWatchedSubs"
        />
      </div>
      <div class="switchColumn">
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide Channel Avatars')"
          :compact="true"
          :default-value="hideChannelAvatars"
          setting-key="hideChannelAvatars"
          @change="updateHideChannelAvatars"
        />
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide Live Streams')"
          :compact="true"
          :default-value="hideLiveStreams"
          setting-key="hideLiveStreams"
          @change="updateHideLiveStreams"
        />
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide Upcoming Premieres')"
          :compact="true"
          :default-value="hideUpcomingPremieres"
          setting-key="hideUpcomingPremieres"
          @change="updateHideUpcomingPremieres"
        />
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Display Titles Without Excessive Capitalisation')"
          :compact="true"
          :default-value="showDistractionFreeTitles"
          setting-key="showDistractionFreeTitles"
          @change="updateShowDistractionFreeTitles"
        />
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide Playlists')"
          :compact="true"
          :default-value="hidePlaylists"
          setting-key="hidePlaylists"
          @change="updateHidePlaylists"
        />
      </div>
    </div>
    <br class="hide-on-mobile">
    <FtFlexBox>
      <FtInputTags
        :disabled="channelHiderDisabled"
        setting-key="channelsHidden"
        :disabled-msg="t('Settings.Distraction Free Settings.Hide Channels Disabled Message')"
        :label="t('Settings.Distraction Free Settings.Hide Channels')"
        :tag-name-placeholder="t('Settings.Distraction Free Settings.Hide Channels Placeholder')"
        :tag-list="channelsHidden"
        :tooltip="t('Tooltips.Distraction Free Settings.Hide Channels')"
        :validate-tag-name="checkYoutubeChannelId"
        :find-tag-info="findChannelTagInfoWrapper"
        :are-channel-tags="true"
        :show-tags="showAddedChannelsHidden"
        @invalid-name="handleInvalidChannel"
        @error-find-tag-info="handleChannelAPIError"
        @change="handleChannelsHidden"
        @already-exists="handleChannelsExists"
        @toggle-show-tags="handleAddedChannelsHidden"
      />
    </FtFlexBox>
    <FtFlexBox class="containingTextFlexBox">
      <FtInputTags
        :label="t('Settings.Distraction Free Settings.Hide Videos, Playlists and Channels Containing Text')"
        setting-key="forbiddenTitles"
        :tag-name-placeholder="t('Settings.Distraction Free Settings.Hide Videos, Playlists and Channels Containing Text Placeholder')"
        :show-tags="showAddedForbiddenTitles"
        :tag-list="forbiddenTitles"
        :min-input-length="1"
        :tooltip="t('Tooltips.Distraction Free Settings.Hide Videos, Playlists and Channels Containing Text')"
        @change="handleForbiddenTitles"
        @toggle-show-tags="handleAddedForbiddenTitles"
      />
    </FtFlexBox>
    <h4
      class="groupTitle"
    >
      {{ t('Settings.Distraction Free Settings.Sections.Visible While Paused') }}
    </h4>
    <div class="switchColumnGrid">
      <div class="switchColumn">
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Show Player Controls')"
          :compact="true"
          :default-value="showPlayerControlsWhenPaused"
          setting-key="showPlayerControlsWhenPaused"
          @change="updateShowPlayerControlsWhenPaused"
        />
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Show Video Title')"
          :compact="true"
          :default-value="showVideoTitleWhenPaused"
          setting-key="showVideoTitleWhenPaused"
          @change="updateShowVideoTitleWhenPaused"
        />
      </div>
      <div class="switchColumn">
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Show Bottom Right Actions Dock')"
          :compact="true"
          :default-value="showFullscreenActionsWhenPaused"
          setting-key="showFullscreenActionsWhenPaused"
          @change="updateShowFullscreenActionsWhenPaused"
        />
      </div>
    </div>
    <FtFlexBox>
      <FtSlider
        :label="t('Settings.Distraction Free Settings.Paused Interface Hide Delay')"
        :default-value="pausedInterfaceHideDelay"
        setting-key="pausedInterfaceHideDelay"
        :min-value="0.5"
        :max-value="10"
        :step="0.5"
        value-extension="s"
        :disabled="pausedInterfaceVisibilityUnchanged"
        @change="updatePausedInterfaceHideDelay"
      />
    </FtFlexBox>
    <h4
      class="groupTitle"
    >
      {{ t('Settings.Distraction Free Settings.Sections.Side Bar') }}
    </h4>
    <div class="switchColumnGrid">
      <div class="switchColumn">
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide Active Subscriptions')"
          :compact="true"
          :default-value="hideActiveSubscriptions"
          setting-key="hideActiveSubscriptions"
          @change="updateHideActiveSubscriptions"
        />
      </div>
    </div>
    <h4
      class="groupTitle"
    >
      {{ t('Settings.Distraction Free Settings.Sections.Subscriptions Page') }}
    </h4>
    <div class="switchColumnGrid">
      <div class="switchColumn">
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide Subscriptions Videos')"
          :compact="true"
          :default-value="hideSubscriptionsVideos"
          setting-key="hideSubscriptionsVideos"
          @change="updateHideSubscriptionsVideos"
        />
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide Subscriptions Shorts')"
          :compact="true"
          :default-value="hideSubscriptionsShorts"
          setting-key="hideSubscriptionsShorts"
          @change="updateHideSubscriptionsShorts"
        />
      </div>
      <div class="switchColumn">
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide Subscriptions Live')"
          :compact="true"
          :disabled="hideLiveStreams"
          :default-value="hideLiveStreams || hideSubscriptionsLive"
          setting-key="hideSubscriptionsLive"
          :tooltip="hideLiveStreams ? hideSubscriptionsLiveTooltip : ''"
          v-on="!hideLiveStreams ? { change: updateHideSubscriptionsLive } : {}"
        />
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide Subscriptions Posts')"
          :compact="true"
          :default-value="hideSubscriptionsCommunity"
          setting-key="hideSubscriptionsCommunity"
          @change="updateHideSubscriptionsCommunity"
        />
      </div>
    </div>
    <h4
      class="groupTitle"
    >
      {{ t('Settings.Distraction Free Settings.Sections.Channel Page') }}
    </h4>
    <div class="switchColumnGrid">
      <div class="switchColumn">
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide Channel Home')"
          :compact="true"
          :default-value="hideChannelHome"
          setting-key="hideChannelHome"
          @change="updateHideChannelHome"
        />
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide Channel Shorts')"
          :compact="true"
          :default-value="hideChannelShorts"
          setting-key="hideChannelShorts"
          @change="updateHideChannelShorts"
        />
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide Channel Playlists')"
          :compact="true"
          :default-value="hideChannelPlaylists"
          setting-key="hideChannelPlaylists"
          @change="updateHideChannelPlaylists"
        />
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide Channel Podcasts')"
          :compact="true"
          :default-value="hideChannelPodcasts"
          setting-key="hideChannelPodcasts"
          @change="updateHideChannelPodcasts"
        />
      </div>
      <div class="switchColumn">
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide Channel Posts')"
          :compact="true"
          :default-value="hideChannelCommunity"
          setting-key="hideChannelCommunity"
          @change="updateHideChannelCommunity"
        />
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide Featured Channels')"
          :compact="true"
          :default-value="hideFeaturedChannels"
          setting-key="hideFeaturedChannels"
          @change="updateHideFeaturedChannels"
        />
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide Channel Releases')"
          :compact="true"
          :default-value="hideChannelReleases"
          setting-key="hideChannelReleases"
          @change="updateHideChannelReleases"
        />
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide Channel Courses')"
          :compact="true"
          :default-value="hideChannelCourses"
          setting-key="hideChannelCourses"
          @change="updateHideChannelCourses"
        />
      </div>
    </div>
    <h4
      class="groupTitle"
    >
      {{ t('Settings.Distraction Free Settings.Sections.Watch Page') }}
    </h4>
    <div class="switchColumnGrid">
      <div class="switchColumn">
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide Video Likes And Dislikes')"
          :compact="true"
          :default-value="hideVideoLikesAndDislikes"
          setting-key="hideVideoLikesAndDislikes"
          @change="updateHideVideoLikesAndDislikes"
        />
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide Chapters')"
          :compact="true"
          :default-value="hideChapters"
          setting-key="hideChapters"
          @change="updateHideChapters"
        />
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Disable A-B Repeat')"
          :compact="true"
          :default-value="disableAbRepeat"
          setting-key="disableAbRepeat"
          @change="updateDisableAbRepeat"
        />
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide Repeat Stats')"
          :compact="true"
          :default-value="hideRepeatStats"
          setting-key="hideRepeatStats"
          @change="updateHideRepeatStats"
        />
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide End-Screen Annotations')"
          :compact="true"
          :default-value="hideEndScreenAnnotations"
          setting-key="hideEndScreenAnnotations"
          @change="updateHideEndScreenAnnotations"
        />
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide Video Description')"
          :compact="true"
          :default-value="hideVideoDescription"
          setting-key="hideVideoDescription"
          @change="updateHideVideoDescription"
        />
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide Comment Likes')"
          :compact="true"
          :disabled="hideComments"
          :default-value="hideCommentLikes"
          setting-key="hideCommentLikes"
          @change="updateHideCommentLikes"
        />
      </div>
      <div class="switchColumn">
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide Live Chat')"
          :compact="true"
          :default-value="hideLiveChat"
          setting-key="hideLiveChat"
          @change="updateHideLiveChat"
        />
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide Live Chat Replay')"
          :compact="true"
          :default-value="hideLiveChatReplay"
          setting-key="hideLiveChatReplay"
          @change="updateHideLiveChatReplay"
        />
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide Recommended Videos')"
          :compact="true"
          :default-value="hideRecommendedVideos"
          setting-key="hideRecommendedVideos"
          @change="handleHideRecommendedVideos"
        />
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide Comments')"
          :compact="true"
          :default-value="hideComments"
          setting-key="hideComments"
          @change="updateHideComments"
        />
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide Profile Pictures in Comments')"
          :compact="true"
          :disabled="hideComments"
          :default-value="hideCommentPhotos"
          setting-key="hideCommentPhotos"
          @change="updateHideCommentPhotos"
        />
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Hide Paid Promotion Badge')"
          :compact="true"
          :default-value="hidePaidPromotion"
          setting-key="hidePaidPromotion"
          @change="updateHidePaidPromotion"
        />
      </div>
    </div>
  </FtSettingsSection>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSettingsSection from '../FtSettingsSection/FtSettingsSection.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'
import FtSlider from '../FtSlider/FtSlider.vue'
import FtInputTags from '../FtInputTags/FtInputTags.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'

import store from '../../store/index'

import { showToast } from '../../helpers/utils'
import { checkYoutubeChannelId, findChannelTagInfo } from '../../helpers/channels'

const { t } = useI18n()

const channelHiderDisabled = ref(false)

/** @type {import('vue').ComputedRef<'local' | 'invidious'>} */
const backendPreference = computed(() => store.getters.getBackendPreference)

/** @type {import('vue').ComputedRef<boolean>} */
const backendFallback = computed(() => store.getters.getBackendFallback)

const backendOptions = computed(() => ({
  preference: backendPreference.value,
  fallback: backendFallback.value
}))

/** @type {import('vue').ComputedRef<boolean>} */
const hideVideoViews = computed(() => store.getters.getHideVideoViews)

/**
 * @param {boolean} value
 */
function updateHideVideoViews(value) {
  store.dispatch('updateHideVideoViews', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideChannelAvatars = computed(() => store.getters.getHideChannelAvatars)

/**
 * @param {boolean} value
 */
function updateHideChannelAvatars(value) {
  store.dispatch('updateHideChannelAvatars', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const shortenViewCounts = computed(() => store.getters.getShortenViewCounts)

/**
 * @param {boolean} value
 */
function updateShortenViewCounts(value) {
  store.dispatch('updateShortenViewCounts', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideVideoLikesAndDislikes = computed(() => store.getters.getHideVideoLikesAndDislikes)

/**
 * @param {boolean} value
 */
function updateHideVideoLikesAndDislikes(value) {
  store.dispatch('updateHideVideoLikesAndDislikes', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideChannelSubscriptions = computed(() => store.getters.getHideChannelSubscriptions)

/**
 * @param {boolean} value
 */
function updateHideChannelSubscriptions(value) {
  store.dispatch('updateHideChannelSubscriptions', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideCommentLikes = computed(() => store.getters.getHideCommentLikes)

/**
 * @param {boolean} value
 */
function updateHideCommentLikes(value) {
  store.dispatch('updateHideCommentLikes', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideRecommendedVideos = computed(() => store.getters.getHideRecommendedVideos)

/**
 * @param {boolean} value
 */
function handleHideRecommendedVideos(value) {
  if (value) {
    store.dispatch('updatePlayNextVideo', false)
  }

  store.dispatch('updateHideRecommendedVideos', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hidePlaylists = computed(() => store.getters.getHidePlaylists)

/**
 * @param {boolean} value
 */
function updateHidePlaylists(value) {
  store.dispatch('updateHidePlaylists', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideLiveChat = computed(() => store.getters.getHideLiveChat)

/**
 * @param {boolean} value
 */
function updateHideLiveChat(value) {
  store.dispatch('updateHideLiveChat', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideLiveChatReplay = computed(() => store.getters.getHideLiveChatReplay)

/**
 * @param {boolean} value
 */
function updateHideLiveChatReplay(value) {
  store.dispatch('updateHideLiveChatReplay', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideActiveSubscriptions = computed(() => store.getters.getHideActiveSubscriptions)

/**
 * @param {boolean} value
 */
function updateHideActiveSubscriptions(value) {
  store.dispatch('updateHideActiveSubscriptions', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideVideoDescription = computed(() => store.getters.getHideVideoDescription)

/**
 * @param {boolean} value
 */
function updateHideVideoDescription(value) {
  store.dispatch('updateHideVideoDescription', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideComments = computed(() => store.getters.getHideComments)

/**
 * @param {boolean} value
 */
function updateHideComments(value) {
  store.dispatch('updateHideComments', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideCommentPhotos = computed(() => store.getters.getHideCommentPhotos)

/**
 * @param {boolean} value
 */
function updateHideCommentPhotos(value) {
  store.dispatch('updateHideCommentPhotos', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideLiveStreams = computed(() => store.getters.getHideLiveStreams)

/**
 * @param {boolean} value
 */
function updateHideLiveStreams(value) {
  store.dispatch('updateHideLiveStreams', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideUpcomingPremieres = computed(() => store.getters.getHideUpcomingPremieres)

/**
 * @param {boolean} value
 */
function updateHideUpcomingPremieres(value) {
  store.dispatch('updateHideUpcomingPremieres', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideSharingActions = computed(() => store.getters.getHideSharingActions)

/**
 * @param {boolean} value
 */
function updateHideSharingActions(value) {
  store.dispatch('updateHideSharingActions', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideChapters = computed(() => store.getters.getHideChapters)

/**
 * @param {boolean} value
 */
function updateHideChapters(value) {
  store.dispatch('updateHideChapters', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const disableAbRepeat = computed(() => store.getters.getDisableAbRepeat)

/**
 * @param {boolean} value
 */
function updateDisableAbRepeat(value) {
  store.dispatch('updateDisableAbRepeat', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideRepeatStats = computed(() => store.getters.getHideRepeatStats)

/** @param {boolean} value */
function updateHideRepeatStats(value) {
  store.dispatch('updateHideRepeatStats', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideEndScreenAnnotations = computed(() => store.getters.getHideEndScreenAnnotations)

/**
 * @param {boolean} value
 */
function updateHideEndScreenAnnotations(value) {
  store.dispatch('updateHideEndScreenAnnotations', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hidePaidPromotion = computed(() => store.getters.getHidePaidPromotion)

/**
 * @param {boolean} value
 */
function updateHidePaidPromotion(value) {
  store.dispatch('updateHidePaidPromotion', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideFeaturedChannels = computed(() => store.getters.getHideFeaturedChannels)

/**
 * @param {boolean} value
 */
function updateHideFeaturedChannels(value) {
  store.dispatch('updateHideFeaturedChannels', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideChannelShorts = computed(() => store.getters.getHideChannelShorts)

/**
 * @param {boolean} value
 */
function updateHideChannelShorts(value) {
  store.dispatch('updateHideChannelShorts', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideChannelPlaylists = computed(() => store.getters.getHideChannelPlaylists)

/**
 * @param {boolean} value
 */
function updateHideChannelPlaylists(value) {
  store.dispatch('updateHideChannelPlaylists', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideChannelPodcasts = computed(() => store.getters.getHideChannelPodcasts)

/**
 * @param {boolean} value
 */
function updateHideChannelPodcasts(value) {
  store.dispatch('updateHideChannelPodcasts', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideChannelReleases = computed(() => store.getters.getHideChannelReleases)

/**
 * @param {boolean} value
 */
function updateHideChannelReleases(value) {
  store.dispatch('updateHideChannelReleases', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideChannelCourses = computed(() => store.getters.getHideChannelCourses)

/**
 * @param {boolean} value
 */
function updateHideChannelCourses(value) {
  store.dispatch('updateHideChannelCourses', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideChannelCommunity = computed(() => store.getters.getHideChannelCommunity)

/**
 * @param {boolean} value
 */
function updateHideChannelCommunity(value) {
  store.dispatch('updateHideChannelCommunity', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideChannelHome = computed(() => store.getters.getHideChannelHome)

/**
 * @param {boolean} value
 */
function updateHideChannelHome(value) {
  store.dispatch('updateHideChannelHome', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideSubscriptionsVideos = computed(() => store.getters.getHideSubscriptionsVideos)

/**
 * @param {boolean} value
 */
function updateHideSubscriptionsVideos(value) {
  store.dispatch('updateHideSubscriptionsVideos', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideSubscriptionsShorts = computed(() => store.getters.getHideSubscriptionsShorts)

/**
 * @param {boolean} value
 */
function updateHideSubscriptionsShorts(value) {
  store.dispatch('updateHideSubscriptionsShorts', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideSubscriptionsLive = computed(() => store.getters.getHideSubscriptionsLive)

const hideSubscriptionsLiveTooltip = computed(() => {
  return t('Tooltips.Distraction Free Settings.Hide Subscriptions Live', {
    appWideSetting: t('Settings.Distraction Free Settings.Hide Live Streams'),
    subsection: t('Settings.Distraction Free Settings.Sections.General'),
    settingsSection: t('Settings.Distraction Free Settings.Distraction Free Settings')
  })
})

/**
 * @param {boolean} value
 */
function updateHideSubscriptionsLive(value) {
  store.dispatch('updateHideSubscriptionsLive', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideSubscriptionsCommunity = computed(() => store.getters.getHideSubscriptionsCommunity)

/**
 * @param {boolean} value
 */
function updateHideSubscriptionsCommunity(value) {
  store.dispatch('updateHideSubscriptionsCommunity', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const showDistractionFreeTitles = computed(() => store.getters.getShowDistractionFreeTitles)

/**
 * @param {boolean} value
 */
function updateShowDistractionFreeTitles(value) {
  store.dispatch('updateShowDistractionFreeTitles', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const showPlayerControlsWhenPaused = computed(() => store.getters.getShowPlayerControlsWhenPaused)

/**
 * @param {boolean} value
 */
function updateShowPlayerControlsWhenPaused(value) {
  store.dispatch('updateShowPlayerControlsWhenPaused', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const showVideoTitleWhenPaused = computed(() => store.getters.getShowVideoTitleWhenPaused)

/**
 * @param {boolean} value
 */
function updateShowVideoTitleWhenPaused(value) {
  store.dispatch('updateShowVideoTitleWhenPaused', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const showFullscreenActionsWhenPaused = computed(() => store.getters.getShowFullscreenActionsWhenPaused)

/**
 * @param {boolean} value
 */
function updateShowFullscreenActionsWhenPaused(value) {
  store.dispatch('updateShowFullscreenActionsWhenPaused', value)
}

const pausedInterfaceVisibilityUnchanged = computed(() => {
  return showPlayerControlsWhenPaused.value &&
    showVideoTitleWhenPaused.value &&
    showFullscreenActionsWhenPaused.value
})

/** @type {import('vue').ComputedRef<number>} */
const pausedInterfaceHideDelay = computed(() => store.getters.getPausedInterfaceHideDelay)

/**
 * @param {number} value
 */
function updatePausedInterfaceHideDelay(value) {
  store.dispatch('updatePausedInterfaceHideDelay', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const showAddedChannelsHidden = computed(() => store.getters.getShowAddedChannelsHidden)

function handleAddedChannelsHidden() {
  store.dispatch('updateShowAddedChannelsHidden', !showAddedChannelsHidden.value)
}

/** @type {import('vue').ComputedRef<any[]>} */
const channelsHidden = computed(() => store.getters.getChannelsHiddenParsed)

/**
 * @param {any[]} value
 */
function handleChannelsHidden(value) {
  store.dispatch('updateChannelsHidden', JSON.stringify(value))
}

/** @type {import('vue').ComputedRef<boolean>} */
const showAddedForbiddenTitles = computed(() => store.getters.getShowAddedForbiddenTitles)

function handleAddedForbiddenTitles() {
  store.dispatch('updateShowAddedForbiddenTitles', !showAddedForbiddenTitles.value)
}

/** @type {import('vue').ComputedRef<string[]>} */
const forbiddenTitles = computed(() => JSON.parse(store.getters.getForbiddenTitles))

/**
 * @param {string[]} value
 */
function handleForbiddenTitles(value) {
  store.dispatch('updateForbiddenTitles', JSON.stringify(value))
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideWatchedSubs = computed(() => store.getters.getHideWatchedSubs)

/**
 * @param {boolean} value
 */
function updateHideWatchedSubs(value) {
  store.dispatch('updateHideWatchedSubs', value)
}

onMounted(() => {
  verifyChannelsHidden()
})

function handleInvalidChannel() {
  showToast({
    message: t('Settings.Distraction Free Settings.Hide Channels Invalid'),
    icon: ['fas', 'circle-exclamation'],
  })
}

function handleChannelAPIError() {
  showToast({
    message: t('Settings.Distraction Free Settings.Hide Channels API Error'),
    icon: ['fas', 'circle-exclamation'],
  })
}

function handleChannelsExists() {
  showToast({
    message: t('Settings.Distraction Free Settings.Hide Channels Already Exists'),
    icon: ['fas', 'circle-exclamation'],
  })
}

/**
 * @param {string} text
 */
async function findChannelTagInfoWrapper(text) {
  return await findChannelTagInfo(text, backendOptions.value)
}

async function verifyChannelsHidden() {
  const channelsHiddenCpy = [...channelsHidden.value]

  for (let i = 0; i < channelsHiddenCpy.length; i++) {
    const tag = channelsHiddenCpy[i]

    // if channel has been processed and confirmed as non existent, skip
    if (tag.invalid) continue

    // process if no preferred name and is possibly a YouTube ID
    if ((tag.preferredName === '' || !tag.icon) && checkYoutubeChannelId(tag.name)) {
      channelHiderDisabled.value = true

      const { preferredName, icon, iconHref, invalidId } = await findChannelTagInfoWrapper(tag.name)
      if (invalidId) {
        channelsHiddenCpy[i] = { name: tag.name, invalid: invalidId }
      } else {
        channelsHiddenCpy[i] = { name: tag.name, preferredName, icon, iconHref }
      }

      // update on every tag in case it closes
      handleChannelsHidden(channelsHiddenCpy)
    }
  }

  channelHiderDisabled.value = false
}
</script>

<style scoped src="./DistractionSettings.css" />
