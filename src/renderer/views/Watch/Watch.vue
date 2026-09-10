<template>
  <div
    ref="videoLayout"
    class="videoLayout"
    :class="{
      ambientModeActive,
      isLoading,
      shortsPlayerActive: customShortsPlayerActive,
      useTheatreMode: isLoading
        ? (loadingTheatreMode ?? (defaultViewingMode === 'theatre'))
        : useTheatreMode,
      noSidebar: !theatrePossible && !sidebarPanelLeaving
    }"
  >
    <div
      v-if="(isFamilyFriendly !== false || !showFamilyFriendlyOnly)"
      class="videoArea"
      :style="customShortsPlayerActive
        ? {
          '--shorts-aspect-ratio': videoAspectRatio,
          '--shorts-player-width': `${shortsPlayerWidth}px`,
          '--shorts-player-height': `${shortsPlayerHeight}px`
        }
        : undefined"
      @wheel="handleShortsWheel"
      @pointerdown.capture="handleShortsPointerDown"
      @pointerup.capture="handleShortsPointerUp"
    >
      <div class="videoAreaMargin">
        <div
          v-if="isLoading && customShortsPlayerActive"
          class="videoPlayer videoPlayerPlaceholder shortsPlayerPlaceholder"
          data-tab-loading-indicator
        >
          <img
            v-if="shortsTransitionPreview"
            :src="shortsTransitionPreview"
            class="shortsTransitionPreview"
            :class="{
              shortsTransitionNext: shortsTransitionDirection > 0,
              shortsTransitionPrevious: shortsTransitionDirection < 0
            }"
            alt=""
          >
          <div
            v-else
            class="shortsSkeleton"
            aria-hidden="true"
          >
            <div class="shortsSkeletonControls">
              <div class="shortsSkeletonControlGroup">
                <span class="ft-shimmer" />
                <span class="ft-shimmer" />
              </div>
              <div class="shortsSkeletonControlGroup">
                <span class="ft-shimmer" />
                <span class="ft-shimmer" />
                <span class="ft-shimmer" />
              </div>
            </div>
            <span class="shortsSkeletonSeek ft-shimmer" />
          </div>
        </div>
        <div
          v-else-if="isLoading"
          class="videoPlayer videoPlayerPlaceholder ft-shimmer"
          data-tab-loading-indicator
        />
        <div
          v-else-if="ytDlpStreamsPending && (!isUpcoming || playabilityStatus === 'OK') && !errorMessage"
          class="videoPlayer videoPlayerPlaceholder streamPlaceholder"
          :class="{ shortsPlayerPlaceholder: customShortsPlayerActive }"
          data-tab-loading-indicator
        >
          <img
            v-if="thumbnail"
            :src="thumbnail"
            class="videoThumbnail"
            alt=""
          >
          <div class="streamPlaceholderOverlay">
            <span class="streamPlaceholderSpinner">
              <ft-loader />
            </span>
            <span class="streamPlaceholderText">{{ $t("Video.Fetching Streams") }}</span>
          </div>
        </div>
        <ft-shaka-video-player
          v-if="playerReady && (!isUpcoming || playabilityStatus === 'OK') && !errorMessage"
          ref="player"
          :manifest-src="manifestSrc"
          :manifest-mime-type="manifestMimeType"
          :playback-engine="activePlaybackEngine"
          :sabr-data="sabrData"
          :legacy-formats="legacyFormats"
          :playback-source-key="playbackSourceKey"
          :start-time="startTimeSeconds"
          :captions="captions"
          :caption-translations="captionTranslations"
          :storyboard-src="videoStoryboardSrc"
          :annotations="videoAnnotations"
          :hide-annotations="hideEndScreenAnnotations"
          :end-screen-recommendations="endScreenRecommendations"
          :format="activeFormat"
          :thumbnail="thumbnail"
          :video-id="videoId"
          :playlist-id="playlistId"
          :chapters="videoChapters"
          :current-chapter-index="videoCurrentChapterIndex"
          :chapters-kind="videoChaptersKind"
          :chapters-src="chaptersSrc"
          :title="videoTitle"
          :artist="musicPlayerArtist"
          :music-media-type="musicMediaType"
          :theatre-possible="theatreTogglePossible"
          :use-theatre-mode="useTheatreMode"
          :autoplay-possible="autoplayPossible"
          :autoplay-enabled="autoplayEnabled"
          :autoplay-countdown="autoplayCountdown"
          :auto-open-chapters="autoOpenChapters"
          :sidebar-chapters-open="showSidebarChapters"
          :watching-playlist="watchingPlaylist"
          :can-skip-next="canSkipToNextVideo"
          :can-skip-previous="canSkipToPreviousVideo"
          :vr-projection="vrProjection"
          :start-in-fullscreen="startNextVideoInFullscreen"
          :start-in-fullwindow="startNextVideoInFullwindow"
          :start-in-pip="startNextVideoInPip"
          :auto-picture-in-picture-state="nextVideoAutoPictureInPictureState"
          :start-with-chapters="startNextVideoWithChapters"
          :start-with-fullscreen-metadata="startNextVideoWithFullscreenMetadata"
          :start-with-fullscreen-comments="startNextVideoWithFullscreenComments"
          :start-with-fullscreen-live-chat="startNextVideoWithFullscreenLiveChat"
          :start-with-fullscreen-playlist="startNextVideoWithFullscreenPlaylist"
          :channel-id="channelId"
          :playlist-video-data="addToPlaylistVideoData"
          :published="videoPublished"
          :is-live="isLive"
          :is-upcoming="isUpcoming"
          :transcript-open="showTranscript"
          :sponsor-block-info-open="showSidebarSponsorBlock"
          :video-genre-is-music="videoGenreIsMusic"
          :current-playback-rate="currentPlaybackRate"
          :current-video-quality="currentVideoQuality"
          :delay-load-until-unix="adEndTimeUnixMs"
          :sponsor-block-auto-skip-disabled="sponsorBlockAutoSkipDisabled"
          :comments-available="commentsAvailable"
          :live-chat-available="liveChatAvailable"
          :quick-bookmark-enabled="isQuickBookmarkEnabled"
          :quick-bookmarked="isCurrentVideoQuickBookmarked"
          :quick-bookmark-title="quickBookmarkIconText"
          :quick-bookmark-icon="quickBookmarkIcon"
          :paid-promotion="showPaidPromotion"
          :paid-promotion-duration-ms="paidPromotionDurationMs"
          :resume-playback-after-sabr-reload="resumePlaybackAfterSabrReload"
          :suppress-autoplay-after-sabr-reload="suppressAutoplayAfterSabrReload"
          :sabr-reload-caption-index="sabrReloadCaptionIndex"
          :sabr-reload-playback-rate="sabrReloadPlaybackRate"
          :shorts-player="customShortsPlayerActive"
          :shorts-metadata-open="shortsMetadataOpen"
          :shorts-aspect-ratio="videoAspectRatio"
          class="videoPlayer"
          @error="handlePlayerError"
          @loaded="handleVideoLoaded"
          @timeupdate="handleTimeUpdate"
          @terminal-outro-started="handleTerminalOutroStarted"
          @ended="handlePlayerEnded"
          @play="handleVideoPlay"
          @pause="handleVideoPause"
          @seeking="handlePlayerSeeking"
          @toggle-theatre-mode="toggleTheatreMode"
          @toggle-autoplay="toggleAutoplay"
          @autoplay-cancel="abortAutoplayCountdown"
          @autoplay-play-now="playNextVideoNow"
          @playback-rate-updated="updatePlaybackRate"
          @playback-rate-user-set="handlePlaybackRateUserSet"
          @save-channel-playback-speed="handleChannelPlaybackSpeedManualSave"
          @video-quality-updated="updateVideoQuality"
          @video-quality-user-set="handleVideoQualityUserSet"
          @subtitles-state-updated="updateSubtitlesState"
          @subtitles-state-user-set="handleSubtitlesStateUserSet"
          @volume-updated="updateVolume"
          @volume-user-set="handleVolumeUserSet"
          @skip-to-next="handleSkipToNext"
          @skip-to-prev="handleSkipToPrev"
          @player-reload-requested="onPlayerReloadRequested"
          @resume-playback-after-sabr-reload-done="onResumePlaybackAfterSabrReloadDone"
          @fullscreen-metadata-change="handleFullscreenMetadataChange"
          @fullscreen-transcript-change="handleFullscreenTranscriptChange"
          @fullscreen-sponsorblock-change="handleFullscreenSponsorBlockChange"
          @toggle-transcript="toggleTranscript"
          @fullscreen-comments-change="handleFullscreenCommentsChange"
          @fullscreen-live-chat-change="handleFullscreenLiveChatChange"
          @fullscreen-playlist-change="handleFullscreenPlaylistChange"
          @toggle-quick-bookmark="toggleCurrentVideoQuickBookmarked"
          @chapters-overlay-change="handleChaptersOverlayChange"
          @chapter-thumbnails-change="handleChapterThumbnailsChange"
          @sponsorblock-info-change="handleSponsorBlockInfoChange"
          @toggle-shorts-metadata="toggleShortsMetadata"
        >
          <template #shorts-fullscreen-metadata>
            <div class="shortsFullscreenMetadataContent">
              <FtPaidPromotionBadge
                v-if="showPaidPromotion"
                class="shortsPaidPromotion"
              />
              <div class="shortsFullscreenChannelRow">
                <component
                  :is="disableChannelLinks ? 'span' : 'router-link'"
                  v-if="!hideUploader && channelId"
                  class="shortsFullscreenChannel"
                  :to="disableChannelLinks ? undefined : `/channel/${channelId}`"
                  @click="openShortsChannel"
                  @auxclick="openShortsChannel"
                >
                  <FtRetryImage
                    v-if="channelThumbnail"
                    :src="channelThumbnail"
                    class="shortsFullscreenChannelThumbnail"
                    alt=""
                  />
                  <span dir="auto">{{ channelName }}</span>
                </component>
                <FtSubscribeButton
                  v-if="!hideUnsubscribeButton"
                  :channel-id="channelId"
                  :channel-name="channelName"
                  :channel-thumbnail="channelThumbnail"
                  :subscription-count-text="channelSubscriptionCountText"
                  :hide-profile-dropdown-toggle="true"
                />
              </div>
              <h1 class="shortsFullscreenTitle">
                <button
                  type="button"
                  class="shortsFullscreenTitleButton"
                  dir="auto"
                  :aria-label="`${$t('Video.Metadata')}: ${videoTitle}`"
                  :aria-expanded="fullscreenMetadataOpen"
                  @click="toggleShortsMetadata"
                >
                  {{ videoTitle }}
                </button>
              </h1>
            </div>
          </template>
        </ft-shaka-video-player>
        <div
          v-if="!isLoading && (isUpcoming || errorMessage)"
          class="videoPlayer"
          :class="{ videoPlayerError: errorMessage }"
        >
          <img
            v-if="!isUpcoming || playabilityStatus !== 'OK'"
            :src="thumbnail"
            class="videoThumbnail"
            alt=""
          >
          <div
            v-if="isUpcoming"
            class="premiereDate"
            :class="{trailer: isUpcoming && playabilityStatus === 'OK'}"
          >
            <ft-icon
              :icon="['fas', 'satellite-dish']"
              class="premiereIcon"
            />
            <p
              v-if="upcomingTimestamp !== null && !hasScheduledPremiereStarted"
              class="premiereText"
            >
              <span
                class="premiereTextTimeLeft"
              >
                {{ $t("Video.Premieres") }} {{ displayedUpcomingTimeLeft }}
              </span>
              <br>
              <span
                class="premiereTextTimestamp"
              >
                {{ upcomingTimestamp }}
              </span>
            </p>
            <p
              v-else
              class="premiereText"
            >
              {{ $t("Video.Starting soon, please refresh the page to check again") }}
            </p>
            <button
              v-if="canToggleLiveReminder"
              type="button"
              class="liveReminderButton"
              :class="{ active: liveReminderActive }"
              :disabled="liveReminderLoading"
              :aria-pressed="liveReminderActive"
              @click="toggleLiveReminder"
            >
              <ft-icon :icon="['fas', 'calendar-days']" />
              {{ liveReminderActive ? $t('Video.Notification on') : $t('Video.Notify me') }}
            </button>
          </div>
          <div
            v-else-if="errorMessage"
            class="errorContainer"
          >
            <div
              class="errorWrapper"
            >
              <ft-icon
                :icon="customErrorIcon || ['fas', 'exclamation-circle']"
                aria-hidden="true"
                class="errorIcon"
              />
              <div class="errorContent">
                <p
                  class="errorMessage"
                >
                  {{ errorMessage }}
                </p>
                <p
                  v-if="restrictedPlaybackError !== null && !hasConfiguredRestrictedPlaybackAuthentication"
                  class="restrictedPlaybackHint"
                >
                  {{ $t('Video.Configure Restricted Playback Cookies Hint') }}
                </p>
                <div
                  v-if="canTryRestrictedPlaybackWithCookies || canRetryWithOtherPlaybackEngine"
                  class="errorActions"
                >
                  <FtButton
                    v-if="canTryRestrictedPlaybackWithCookies"
                    class="errorActionButton"
                    :label="$t('Video.Try With Configured Cookies')"
                    :icon="['fas', 'cookie']"
                    :text-color="null"
                    :background-color="null"
                    @click="tryRestrictedPlaybackWithCookies"
                  />
                  <FtButton
                    v-if="canRetryWithOtherPlaybackEngine"
                    class="errorActionButton"
                    :label="retryWithOtherPlaybackEngineLabel"
                    :icon="['fas', 'sync']"
                    :text-color="null"
                    :background-color="null"
                    @click="retryWithOtherPlaybackEngine"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
        <div
          v-if="customShortsPlayerActive"
          class="shortsExternalMetadata"
          :class="{ shortsMetadataSkeleton: isLoading }"
        >
          <template v-if="isLoading">
            <div class="shortsSkeletonChannelRow">
              <span class="shortsSkeletonAvatar ft-shimmer" />
              <span class="shortsSkeletonChannel ft-shimmer" />
              <span class="shortsSkeletonSubscribe ft-shimmer" />
            </div>
            <span class="shortsSkeletonTitle ft-shimmer" />
          </template>
          <template v-else>
            <FtPaidPromotionBadge
              v-if="showPaidPromotion"
              class="shortsPaidPromotion"
            />
            <div
              class="shortsChannelRow"
            >
              <component
                :is="disableChannelLinks ? 'span' : 'router-link'"
                v-if="!hideUploader && channelId"
                class="shortsExternalChannel"
                :to="disableChannelLinks ? undefined : `/channel/${channelId}`"
                @click="openShortsChannel"
                @auxclick="openShortsChannel"
              >
                <FtRetryImage
                  v-if="channelThumbnail"
                  :src="channelThumbnail"
                  class="shortsExternalChannelThumbnail"
                  alt=""
                />
                <span dir="auto">{{ channelName }}</span>
              </component>
              <FtSubscribeButton
                v-if="!hideUnsubscribeButton"
                :channel-id="channelId"
                :channel-name="channelName"
                :channel-thumbnail="channelThumbnail"
                :subscription-count-text="channelSubscriptionCountText"
                :hide-profile-dropdown-toggle="true"
              />
            </div>
          </template>
          <h1
            v-if="!isLoading"
            class="shortsExternalTitle"
          >
            <button
              type="button"
              class="shortsExternalTitleButton"
              dir="auto"
              :aria-label="`${$t('Video.Metadata')}: ${videoTitle}`"
              :aria-expanded="shortsMetadataOpen"
              @click="toggleShortsMetadata"
            >
              {{ videoTitle }}
            </button>
          </h1>
          <RouterLink
            v-if="!isLoading && shortsLinkedVideo?.videoId"
            class="shortsLinkedVideo"
            :to="`/watch/${shortsLinkedVideo.videoId}`"
            :title="shortsLinkedVideo.title"
            @click="openShortsLinkedVideo"
            @auxclick="openShortsLinkedVideo"
          >
            <ft-icon :icon="['fas', 'play']" />
            <span dir="auto">{{ shortsLinkedVideo.title }}</span>
          </RouterLink>
        </div>
        <div
          v-if="customShortsPlayerActive"
          class="shortsActionRail"
          :class="{ shortsActionRailSkeleton: isLoading }"
        >
          <div
            v-if="hasPreviousSubscriptionShort || hasNextSubscriptionShort"
            class="shortsNavigation"
          >
            <button
              type="button"
              class="shortsNavigationButton"
              :disabled="!hasPreviousSubscriptionShort"
              :aria-label="$t('Video.Previous')"
              :title="$t('Video.Previous')"
              @click="navigateSubscriptionShort(-1)"
            >
              <ft-icon :icon="['fas', 'arrow-up']" />
            </button>
            <button
              type="button"
              class="shortsNavigationButton"
              :disabled="!hasNextSubscriptionShort"
              :aria-label="$t('Video.Next')"
              :title="$t('Video.Next')"
              @click="navigateSubscriptionShort(1)"
            >
              <ft-icon :icon="['fas', 'arrow-down']" />
            </button>
          </div>
          <template v-if="isLoading">
            <div
              v-for="index in shortsActionSkeletonCount"
              :key="index"
              class="shortsAction shortsActionSkeleton"
            >
              <span class="ft-shimmer" />
              <small class="ft-shimmer" />
            </div>
            <span class="shortsSkeletonSound ft-shimmer" />
          </template>
          <div
            v-if="!isLoading && commentsAvailable"
            class="shortsAction shortsComponentAction shortsCommentsAction"
            :class="{ active: shortsCommentsPanelOpen }"
          >
            <FtIconButton
              :title="shortsCommentsText"
              :icon="['fas', 'comment-alt']"
              :aria-pressed="shortsCommentsPanelOpen"
              theme="base"
              @click="toggleShortsComments"
            />
            <span>{{ shortsCommentsText }}</span>
          </div>
          <div
            v-if="!isLoading && !isLive && !isUpcoming && transcriptAvailable"
            class="shortsAction shortsComponentAction"
            :class="{ active: showTranscript }"
          >
            <FtIconButton
              :title="showTranscript
                ? $t('Video.Transcript.Hide')
                : $t('Video.Transcript.Show')"
              :icon="['fas', 'file-lines']"
              :aria-pressed="showTranscript"
              theme="base"
              @click="toggleTranscript"
            />
            <span>{{ $t('Video.Transcript.Title') }}</span>
          </div>
          <div
            v-if="!isLoading && useSponsorBlock && !isUpcoming"
            class="shortsAction shortsComponentAction"
            :class="{ active: showSidebarSponsorBlock }"
          >
            <FtIconButton
              :title="$t('Video.Player.SponsorBlock.OpenInfoPanel')"
              :icon="['fas', 'shield-halved']"
              :aria-pressed="showSidebarSponsorBlock"
              theme="base"
              @click="toggleSponsorBlockInfo"
            />
            <span>{{ $t('Settings.SponsorBlock Settings.SponsorBlock Settings') }}</span>
          </div>
          <div
            v-if="!isLoading && !hideSharingActions"
            class="shortsAction shortsComponentAction"
          >
            <FtShareButton
              :id="videoId"
              :get-timestamp="getTimestamp"
              :playlist-id="playlistId"
              dropdown-position-y="top"
            />
            <span>{{ $t('Share.Share Video') }}</span>
          </div>
          <div
            v-if="!isLoading && showPlaylists && !isUpcoming"
            class="shortsAction shortsComponentAction"
          >
            <FtIconButton
              :title="$t('User Playlists.Add to Playlist')"
              :icon="isInAnyPlaylist ? ['fac', 'playlist-check'] : ['fac', 'playlist-add']"
              force-dropdown
              dropdown-position-x="left"
              dropdown-position-y="top"
            >
              <FtAddToPlaylistDropdown :video-data="addToPlaylistVideoData" />
            </FtIconButton>
            <span>{{ $t('User Playlists.Add to Playlist') }}</span>
          </div>
          <div
            v-if="!isLoading && isQuickBookmarkEnabled"
            class="shortsAction shortsComponentAction shortsQuickBookmark"
            :class="{ shortsQuickBookmarked: isCurrentVideoQuickBookmarked }"
          >
            <FtIconButton
              :title="quickBookmarkIconText"
              :icon="quickBookmarkIcon"
              :theme="isCurrentVideoQuickBookmarked ? 'favorite' : 'base'"
              @click="toggleCurrentVideoQuickBookmarked"
            />
            <span>{{ quickBookmarkIconText }}</span>
          </div>
          <component
            :is="disableChannelLinks ? 'span' : 'router-link'"
            v-if="!isLoading && channelId && channelThumbnail"
            class="shortsSoundThumbnail"
            :to="disableChannelLinks ? undefined : `/channel/${channelId}`"
            :title="channelName"
            @click="openShortsChannel"
            @auxclick="openShortsChannel"
          >
            <FtRetryImage
              :src="channelThumbnail"
              alt=""
            />
          </component>
        </div>
        <button
          v-if="customShortsPlayerActive && nextSubscriptionShortThumbnail"
          type="button"
          class="shortsNextPreview"
          :style="{ '--shorts-next-thumbnail': `url(${nextSubscriptionShortThumbnail})` }"
          :aria-label="$t('Video.Next')"
          @click="navigateSubscriptionShort(1)"
        />
      </div>
      <div
        v-if="customShortsPlayerActive"
        ref="shortsCommentsTarget"
        class="shortsCommentsPanel"
        :class="{ shortsCommentsPanelOpen }"
      />
      <div
        v-if="customShortsPlayerActive"
        class="shortsAuxPanel"
        :class="{ shortsAuxPanelOpen }"
      >
        <div
          v-if="shortsMetadataOpen"
          class="shortsAuxPanelHeader"
        >
          <h2>
            <ft-icon :icon="['fas', 'circle-info']" />
            {{ $t('Video.Metadata') }}
          </h2>
          <button
            type="button"
            class="shortsAuxPanelClose"
            :aria-label="$t('Video.Close Metadata')"
            :title="$t('Video.Close Metadata')"
            @click="toggleShortsMetadata"
          >
            <ft-icon :icon="['fas', 'xmark']" />
          </button>
        </div>
        <div
          ref="shortsAuxPanelTarget"
          v-overlay-scrollbars
          class="shortsAuxPanelTarget"
        >
          <watch-video-info
            v-if="shortsMetadataOpen && !isLoading"
            :id="videoId"
            :title="videoTitle"
            :channel-id="channelId"
            :channel-name="channelName"
            :channel-thumbnail="channelThumbnail"
            :channel-collaborators="channelCollaborators"
            :published="videoPublished"
            :premiere-date="premiereDate"
            :subscription-count-text="channelSubscriptionCountText"
            :like-count="videoLikeCount"
            :dislike-count="videoDislikeCount"
            :category="videoCategory"
            :view-count="videoViewCount"
            :get-timestamp="getTimestamp"
            :is-live-content="isLiveContent"
            :is-live="isLive"
            :is-upcoming="isUpcoming"
            :playlist-id="playlistId"
            :get-playlist-state="getPlaylistState"
            :length-seconds="videoLengthSeconds"
            :video-thumbnail="thumbnail"
            :metadata-history="videoMetadataHistory"
            :in-user-playlist="!!selectedUserPlaylist"
            :is-unlisted="isUnlisted"
            :is-age-restricted="isFamilyFriendly === false"
            :has-ai-generated-content="hasAiGeneratedContent"
            :sponsor-block-full-video-category="sponsorBlockFullVideoCategory"
            :active-format="activeFormat"
            :playback-engine="activePlaybackEngine"
            :playback-engine-version="activePlaybackEngineVersion"
            :playback-engine-selection="playbackEngineSelection"
            :stream-type="playbackStreamType"
            :dash-available="dashFormatAvailable"
            :legacy-available="legacyFormatAvailable"
            :audio-available="audioFormatAvailable"
            :local-file-playback="localFilePlayback"
            :local-playback-downloads="localPlaybackDownloads"
            :can-save-watched-progress="canSaveWatchProgress"
            :current-playback-rate="currentPlaybackRate"
            :current-video-quality="currentVideoQuality"
            :current-subtitles-state="currentSubtitlesState"
            :current-volume="currentVolume"
            :sponsor-block-panel-open="showSidebarSponsorBlock"
            :transcript-open="showTranscript"
            :transcript-available="transcriptAvailable"
            channel-setting-dropdown-portal
            hide-share-button
            hide-playlist-actions
            hide-fullscreen-dock-actions
            class="watchVideo"
            @change-format="handleFormatChange"
            @change-playback-engine="handlePlaybackEngineChange"
            @use-local-source="useLocalPlaybackSource"
            @use-online-source="useOnlinePlaybackSource"
            @pause-player="pausePlayer"
            @save-watched-progress="handleWatchProgressManualSave"
            @save-channel-playback-speed="handleChannelPlaybackSpeedManualSave"
            @save-channel-video-quality="handleChannelVideoQualityManualSave"
            @save-channel-subtitles-state="handleChannelSubtitlesStateManualSave"
            @save-channel-volume="handleChannelVolumeManualSave"
          />
          <watch-video-description
            v-if="shortsMetadataOpen && !isLoading && !hideVideoDescription"
            :description="videoDescription"
            :description-html="videoDescriptionHtml"
            :tags="videoTags"
            :license="license"
            :games="videoGames"
            always-expanded
            class="watchVideo"
            @timestamp-event="changeTimestamp"
          />
          <watch-video-sponsor-block
            v-if="showSidebarSponsorBlock && !isLoading"
            class="watchVideoSideBar watchVideoSponsorBlock"
            :loading="sponsorBlockInfoLoading"
            :pending-uuid="sponsorBlockInfoPendingUuid"
            :segments="sponsorBlockInfoSegments"
            :submission-enabled="sponsorBlockInfoSubmissionEnabled"
            :contribution-stats="sponsorBlockContributionStats"
            :contribution-stats-error="sponsorBlockContributionStatsError"
            :contribution-stats-loaded="sponsorBlockContributionStatsLoaded"
            :contribution-stats-loading="sponsorBlockContributionStatsLoading"
            :auto-skip-disabled="sponsorBlockAutoSkipTemporarilyDisabled"
            :channel-whitelisted="isSponsorBlockChannelWhitelisted"
            :can-whitelist-channel="Boolean(channelId)"
            :current-time="currentTime"
            @close="closeSidebarSponsorBlock"
            @refresh="refreshSponsorBlockInfo"
            @skip="skipSponsorBlockInfoSegment"
            @auto-skip-change="handleSponsorBlockAutoSkipToggle"
            @channel-whitelist-change="handleSponsorBlockChannelWhitelistToggle"
            @vote="voteOnSponsorBlockInfoSegment"
          />
          <watch-video-transcript
            v-if="showTranscript && transcriptAvailable && !isLoading && !isLive && !isUpcoming"
            :captions="captions"
            :current-time="currentTime"
            :preferred-caption-index="preferredTranscriptCaptionIndex"
            :video-title="videoTitle"
            class="watchVideoSideBar watchVideoTranscript"
            @close="closeTranscript"
            @timestamp-event="playTranscriptSegment"
          />
          <div
            ref="shortsAuxPanelContentEnd"
            class="shortsAuxPanelContentEnd"
            aria-hidden="true"
          />
        </div>
      </div>
    </div>
    <ft-age-restricted
      v-if="(!isLoading && isFamilyFriendly === false && showFamilyFriendlyOnly)"
      class="ageRestricted"
    />
    <div
      v-if="(isFamilyFriendly !== false || !showFamilyFriendlyOnly)"
      class="infoArea"
    >
      <div
        v-if="isLoading"
        class="watchVideo infoSkeleton"
        aria-hidden="true"
      >
        <div class="skeletonLine skeletonTitle ft-shimmer" />
        <div class="skeletonInfoRow">
          <div class="skeletonAvatar ft-shimmer" />
          <div class="skeletonLine skeletonChannel ft-shimmer" />
        </div>
      </div>
      <Teleport
        :to="fullscreenMetadataTarget || 'body'"
        :disabled="!fullscreenMetadataOpen"
      >
        <watch-video-info
          v-if="!isLoading && (!customShortsPlayerActive || fullscreenMetadataOpen)"
          :id="videoId"
          :title="videoTitle"
          :channel-id="channelId"
          :channel-name="channelName"
          :channel-thumbnail="channelThumbnail"
          :channel-collaborators="channelCollaborators"
          :published="videoPublished"
          :premiere-date="premiereDate"
          :subscription-count-text="channelSubscriptionCountText"
          :like-count="videoLikeCount"
          :dislike-count="videoDislikeCount"
          :category="videoCategory"
          :view-count="videoViewCount"
          :get-timestamp="getTimestamp"
          :is-live-content="isLiveContent"
          :is-live="isLive"
          :is-upcoming="isUpcoming"
          :playlist-id="playlistId"
          :get-playlist-state="getPlaylistState"
          :length-seconds="videoLengthSeconds"
          :video-thumbnail="thumbnail"
          :metadata-history="videoMetadataHistory"
          :in-user-playlist="!!selectedUserPlaylist"
          :is-unlisted="isUnlisted"
          :is-age-restricted="isFamilyFriendly === false"
          :has-ai-generated-content="hasAiGeneratedContent"
          :sponsor-block-full-video-category="sponsorBlockFullVideoCategory"
          :active-format="activeFormat"
          :playback-engine="activePlaybackEngine"
          :playback-engine-version="activePlaybackEngineVersion"
          :playback-engine-selection="playbackEngineSelection"
          :stream-type="playbackStreamType"
          :dash-available="dashFormatAvailable"
          :legacy-available="legacyFormatAvailable"
          :audio-available="audioFormatAvailable"
          :local-file-playback="localFilePlayback"
          :local-playback-downloads="localPlaybackDownloads"
          :can-save-watched-progress="canSaveWatchProgress"
          :current-playback-rate="currentPlaybackRate"
          :current-video-quality="currentVideoQuality"
          :current-subtitles-state="currentSubtitlesState"
          :current-volume="currentVolume"
          :sponsor-block-panel-open="showSidebarSponsorBlock"
          :transcript-open="showTranscript"
          :transcript-available="transcriptAvailable"
          :live-chat-available="liveChatAvailable"
          :live-chat-open="showLiveChat"
          :live-chat-replay="liveChatIsReplay"
          :hide-share-button="fullscreenMetadataOpen"
          :hide-playlist-actions="fullscreenMetadataOpen"
          :hide-fullscreen-dock-actions="fullscreenMetadataOpen"
          class="watchVideo"
          :class="{ theatreWatchVideo: useTheatreMode }"
          @change-format="handleFormatChange"
          @change-playback-engine="handlePlaybackEngineChange"
          @use-local-source="useLocalPlaybackSource"
          @use-online-source="useOnlinePlaybackSource"
          @pause-player="pausePlayer"
          @save-watched-progress="handleWatchProgressManualSave"
          @save-channel-playback-speed="handleChannelPlaybackSpeedManualSave"
          @save-channel-video-quality="handleChannelVideoQualityManualSave"
          @save-channel-subtitles-state="handleChannelSubtitlesStateManualSave"
          @save-channel-volume="handleChannelVolumeManualSave"
          @toggle-sponsorblock-info="toggleSponsorBlockInfo"
          @toggle-transcript="toggleTranscript"
          @toggle-live-chat="toggleLiveChat"
        />
        <watch-video-description
          v-if="!isLoading && !hideVideoDescription && (!customShortsPlayerActive || fullscreenMetadataOpen)"
          :description="videoDescription"
          :description-html="videoDescriptionHtml"
          :tags="videoTags"
          :license="license"
          :games="videoGames"
          :always-expanded="fullscreenMetadataOpen"
          class="watchVideo"
          :class="{ theatreWatchVideo: useTheatreMode }"
          @timestamp-event="changeTimestamp"
        />
      </Teleport>
    </div>
    <div
      v-if="(isFamilyFriendly !== false || !showFamilyFriendlyOnly)"
      class="sidebarArea"
    >
      <div
        v-if="isLoading && watchingPlaylist"
        class="playlistSkeleton watchVideoSideBar watchVideoPlaylist"
        aria-hidden="true"
      >
        <div class="skeletonLine skeletonPlaylistTitle ft-shimmer" />
        <div class="skeletonLine skeletonPlaylistMeta ft-shimmer" />
        <div class="skeletonPlaylistProgress ft-shimmer" />
        <div class="skeletonPlaylistButtons">
          <div
            v-for="n in 3"
            :key="n"
            class="skeletonPlaylistButton ft-shimmer"
          />
        </div>
        <div class="skeletonPlaylistItems">
          <div
            v-for="n in 4"
            :key="n"
            class="skeletonPlaylistItem"
          >
            <div class="skeletonPlaylistIndex ft-shimmer" />
            <div class="skeletonPlaylistThumbnail ft-shimmer" />
            <div class="skeletonPlaylistDetails">
              <div class="skeletonPlaylistDetailLine ft-shimmer" />
              <div class="skeletonPlaylistDetailLine short ft-shimmer" />
              <div class="skeletonPlaylistDetailLine shorter ft-shimmer" />
            </div>
          </div>
        </div>
      </div>
      <div
        v-if="isLoading && !hideRecommendedVideos"
        class="recommendationsSkeleton"
        aria-hidden="true"
      >
        <div
          v-for="n in 5"
          :key="n"
          class="skeletonRecommendation"
        >
          <div class="skeletonRecommendationThumbnail ft-shimmer" />
          <div class="skeletonRecommendationDetails">
            <div class="skeletonLine ft-shimmer" />
            <div class="skeletonLine short ft-shimmer" />
          </div>
        </div>
      </div>
      <transition
        name="chapters-panel"
        @before-leave="handleSidebarPanelBeforeLeave"
        @after-leave="handleSidebarPanelAfterLeave"
        @leave-cancelled="handleSidebarPanelAfterLeave"
      >
        <div
          v-if="showSidebarChapters && !isLoading && videoChapters.length > 0"
          class="watchVideoSideBar watchVideoChaptersPanel"
        >
          <div class="chaptersPanelHeader">
            <h3 class="chaptersPanelTitle">
              {{ videoChaptersKind === 'keyMoments' ? $t('Chapters.Key Moments') : $t('Chapters.Chapters') }}
            </h3>
            <button
              type="button"
              class="chaptersPanelClose"
              :aria-label="$t('Chapters.Close Chapters')"
              :title="$t('Chapters.Close Chapters')"
              @click="closeSidebarChapters"
            >
              <ft-icon :icon="['fas', 'xmark']" />
            </button>
          </div>
          <watch-video-chapters
            :chapters="videoChapters"
            :chapter-thumbnails="videoChapterThumbnails"
            :current-chapter-index="videoCurrentChapterIndex"
            :fallback-thumbnail="thumbnail"
            @copy-timestamp="copyChapterTimestamp"
            @timestamp-event="changeTimestamp"
          />
        </div>
      </transition>
      <Teleport
        :to="fullscreenSponsorBlockTarget || 'body'"
        :disabled="!fullscreenSponsorBlockOpen"
      >
        <transition
          name="sidebar-panel"
          @before-leave="handleSidebarPanelBeforeLeave"
          @after-leave="handleSidebarPanelAfterLeave"
          @leave-cancelled="handleSidebarPanelAfterLeave"
        >
          <watch-video-sponsor-block
            v-if="showSidebarSponsorBlock && !isLoading && (!customShortsPlayerActive || fullscreenSponsorBlockOpen)"
            class="watchVideoSideBar watchVideoSponsorBlock"
            :loading="sponsorBlockInfoLoading"
            :pending-uuid="sponsorBlockInfoPendingUuid"
            :segments="sponsorBlockInfoSegments"
            :submission-enabled="sponsorBlockInfoSubmissionEnabled"
            :contribution-stats="sponsorBlockContributionStats"
            :contribution-stats-error="sponsorBlockContributionStatsError"
            :contribution-stats-loaded="sponsorBlockContributionStatsLoaded"
            :contribution-stats-loading="sponsorBlockContributionStatsLoading"
            :auto-skip-disabled="sponsorBlockAutoSkipTemporarilyDisabled"
            :channel-whitelisted="isSponsorBlockChannelWhitelisted"
            :can-whitelist-channel="Boolean(channelId)"
            :current-time="currentTime"
            @close="closeSidebarSponsorBlock"
            @refresh="refreshSponsorBlockInfo"
            @skip="skipSponsorBlockInfoSegment"
            @auto-skip-change="handleSponsorBlockAutoSkipToggle"
            @channel-whitelist-change="handleSponsorBlockChannelWhitelistToggle"
            @vote="voteOnSponsorBlockInfoSegment"
          />
        </transition>
      </Teleport>
      <Teleport
        :to="fullscreenTranscriptTarget || 'body'"
        :disabled="!fullscreenTranscriptOpen"
      >
        <transition
          name="sidebar-panel"
          @before-leave="handleSidebarPanelBeforeLeave"
          @after-leave="handleSidebarPanelAfterLeave"
          @leave-cancelled="handleSidebarPanelAfterLeave"
        >
          <watch-video-transcript
            v-if="showTranscript && transcriptAvailable && !isLoading && !isLive && !isUpcoming && (!customShortsPlayerActive || fullscreenTranscriptOpen)"
            :captions="captions"
            :current-time="currentTime"
            :preferred-caption-index="preferredTranscriptCaptionIndex"
            :video-title="videoTitle"
            :fullscreen-overlay="fullscreenTranscriptOpen"
            class="watchVideoSideBar watchVideoTranscript"
            @close="closeTranscript"
            @timestamp-event="playTranscriptSegment"
          />
        </transition>
      </Teleport>
      <Teleport
        :to="fullscreenLiveChatTarget || 'body'"
        :disabled="!fullscreenLiveChatOpen"
      >
        <transition
          name="sidebar-panel"
          @before-leave="handleSidebarPanelBeforeLeave"
          @after-leave="handleSidebarPanelAfterLeave"
          @leave-cancelled="handleSidebarPanelAfterLeave"
        >
          <watch-video-live-chat
            v-if="!isLoading && showLiveChat"
            :live-chat="liveChat"
            :video-id="videoId"
            :channel-id="channelId"
            :current-time="liveChatCurrentTime"
            :fullscreen-overlay="fullscreenLiveChatOpen"
            class="watchVideoSideBar watchVideoPlaylist"
            :class="{ theatrePlaylist: useTheatreMode }"
            @close="closeLiveChat"
          />
        </transition>
      </Teleport>
      <watch-video-queue
        v-if="$store.getters.getWatchQueueLength > 0"
        class="watchVideoSideBar watchVideoQueue"
        @pause-player="pausePlayer"
      />
      <Teleport
        :to="fullscreenPlaylistTarget || 'body'"
        :disabled="!fullscreenPlaylistOpen"
      >
        <watch-video-playlist
          v-if="watchingPlaylist"
          v-show="!isLoading"
          ref="watchVideoPlaylist"
          :watch-view-loading="isLoading"
          :playlist-id="playlistId"
          :playlist-type="playlistType"
          :video-id="videoId"
          :playlist-item-id="playlistItemId"
          :download-id="typeof tabRoute.query.downloadId === 'string' ? tabRoute.query.downloadId : ''"
          :fullscreen-overlay="fullscreenPlaylistOpen"
          class="watchVideoSideBar watchVideoPlaylist resizablePlaylist"
          :class="{ theatrePlaylist: useTheatreMode }"
          @close="closeFullscreenPlaylist"
          @pause-player="pausePlayer"
          @skip-availability-change="handlePlaylistSkipAvailabilityChange"
          @upcoming-videos-change="handleUpcomingPlaylistVideosChange"
        />
      </Teleport>
      <watch-video-recommendations
        v-if="!isLoading && !hideRecommendedVideos"
        :data="recommendedVideos"
        class="watchVideoSideBar watchVideoRecommendations"
        :class="{
          theatreRecommendations: useTheatreMode,
          watchVideoRecommendationsLowerCard: watchingPlaylist || isLive,
          watchVideoRecommendationsNoCard: !watchingPlaylist || !isLive
        }"
        @pause-player="pausePlayer"
      />
    </div>
    <div
      v-if="(isFamilyFriendly !== false || !showFamilyFriendlyOnly)"
      class="commentsArea"
    >
      <Teleport
        :to="fullscreenCommentsTarget || (shortsCommentsOpen ? $refs.shortsCommentsTarget : null) || 'body'"
        :disabled="!fullscreenCommentsOpen && !shortsCommentsOpen"
      >
        <CommentSection
          v-if="!isLoading && commentsAvailable"
          :id="videoId"
          class="watchVideo"
          :class="{ theatreWatchVideo: useTheatreMode }"
          :channel-thumbnail="channelThumbnail"
          :channel-name="channelName"
          :comments-disabled="commentsDisabled"
          :fullscreen-overlay="fullscreenCommentsOpen || shortsCommentsOpen"
          :highlighted-comment-id="tabRoute.query.commentId"
          @close-comments="closeFullscreenComments"
          @timestamp-event="changeTimestamp"
        />
      </Teleport>
    </div>
  </div>
</template>

<script src="./Watch.js" />
<style scoped src="./Watch.scss" lang="scss" />
