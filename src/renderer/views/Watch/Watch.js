import { connectionEvents, initializeNetworkRecovery, getConnectionState } from '../../helpers/networkRecovery'
import { ytDlp } from '../../helpers/ytDlp'
import { supportsYtDlp } from '../../helpers/ytDlpCapabilities'
import { isAppHidden } from '../../helpers/appVisibility.js'
import { sampleRecommendationPlayback } from '../../../recommendation-learning'
import { defineComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { mapActions } from 'vuex'
import shaka from 'shaka-player'
import { Utils, YTNodes } from 'youtubei.js'
import FtShakaVideoPlayer from '../../components/ft-shaka-video-player/ft-shaka-video-player.vue'
import WatchVideoInfo from '../../components/WatchVideoInfo/WatchVideoInfo.vue'
import WatchVideoDescription from '../../components/WatchVideoDescription/WatchVideoDescription.vue'
import WatchVideoTranscript from '../../components/WatchVideoTranscript/WatchVideoTranscript.vue'
import WatchVideoChapters from '../../components/WatchVideoChapters/WatchVideoChapters.vue'
import WatchVideoSponsorBlock from '../../components/WatchVideoSponsorBlock/WatchVideoSponsorBlock.vue'
import CommentSection from '../../components/CommentSection/CommentSection.vue'
import WatchVideoLiveChat from '../../components/WatchVideoLiveChat/WatchVideoLiveChat.vue'
import WatchVideoPlaylist from '../../components/WatchVideoPlaylist/WatchVideoPlaylist.vue'
import WatchVideoQueue from '../../components/WatchVideoQueue/WatchVideoQueue.vue'
import WatchVideoRecommendations from '../../components/WatchVideoRecommendations/WatchVideoRecommendations.vue'
import FtAgeRestricted from '../../components/FtAgeRestricted/FtAgeRestricted.vue'
import { hasConfiguredRestrictedPlaybackAuthentication } from '../../helpers/restricted-playback'
import FtRetryImage from '../../components/FtRetryImage.vue'
import FtSubscribeButton from '../../components/FtSubscribeButton/FtSubscribeButton.vue'
import FtShareButton from '../../components/FtShareButton/FtShareButton.vue'
import FtIconButton from '../../components/FtIconButton/FtIconButton.vue'
import FtAddToPlaylistDropdown from '../../components/FtAddToPlaylistDropdown/FtAddToPlaylistDropdown.vue'
import FtPaidPromotionBadge from '../../components/FtPaidPromotionBadge/FtPaidPromotionBadge.vue'
import FtLoader from '../../components/FtLoader/FtLoader.vue'
import FtButton from '../../components/FtButton/FtButton.vue'
import { calculateColorLuminance } from '../../helpers/colors'
import { applyAnimationSpeed } from '../../helpers/animationSpeed'
import { isReducedMotionEnabled } from '../../helpers/reducedMotion'
import { clampOverlayScrollTop, restoreOverlayScrollTop } from '../../helpers/overlayScrollbars'
import { hasReachedWatchedThreshold, isHistoryEntryWatched } from '../../helpers/history'
import { liveReminder, supportsLiveReminders } from '../../helpers/liveReminders'
import { DOWNLOADED_MEDIA_MIME_TYPES } from '../../../constants'
import { isVideoHiddenByPreferences } from '../../helpers/subscriptions'
import { parseLocalVideoGames } from '../../helpers/video-games'
import { parseChannelPreferences } from '../../helpers/channel-preferences'
import {
  buildChaptersVttFile,
  buildVTTFileLocally,
  extractNumberFromString,
  formatDurationAsTimestamp,
  formatNumber,
  getCachedOembedTitle,
  getOembedTitle,
  getShortThumbnailUrl,
  openInternalPath,
  showApiErrorToast,
  showToast,
  showToastOnAllTabs
} from '../../helpers/utils'
import {
  areLocalCommentsDisabled,
  generateAudioTrackField,
  getLocalShortLinkedVideo,
  getLocalVideoInfo,
  mapLocalLegacyFormat,
  parseLocalSubscriberCount,
  parseLocalEndscreen,
  parseLocalVideoCollaborators,
  parseLocalTextRuns,
  parseLocalWatchNextVideo
} from '../../helpers/api/local'
import {
  convertInvidiousToLocalFormat,
  generateInvidiousDashManifestLocally,
  getProxyUrl,
  invidiousGetVideoInformation,
  mapInvidiousLegacyFormat,
  youtubeImageUrlToInvidious
} from '../../helpers/api/invidious'
import { sponsorBlockSkipSegments } from '../../helpers/sponsorblock'
import { getVideoDislikes } from '../../helpers/returnyoutubedislike'
import {
  findCaptionByLocale,
  getPreferredCaption,
  sortCaptions,
  MANIFEST_TYPE_DASH,
  MANIFEST_TYPE_HLS
} from '../../helpers/player/utils'
import {
  checkYtDlpPlaybackUrl,
  getYtDlpPlaybackSource,
  invalidateYtDlpPlaybackSource
} from '../../helpers/player/ytDlpPlayback'
import {
  buildYtDlpPlaybackCacheKey,
  preloadYtDlpPlaybackSources,
  selectYtDlpPreloadVideoIds,
} from '../../helpers/player/ytDlpPlaybackPreload'
import { getMusicTrackArtist, MUSIC_MEDIA_TYPE } from '../../helpers/player/musicMediaType'
import { resolveAndroidBackgroundPlaybackFormat } from '../../helpers/player/androidBackgroundPlayback'
import { getCompatibleAdaptiveFormats } from '../../helpers/player/compatibleAdaptiveFormats'
import { selectSponsorBlockFullVideoLabel } from '../../helpers/player/sponsorBlockFullVideo'
import {
  buildSubscriptionShortsFeed,
  getChannelShortsNavigationContext,
  getShortsCompletionState,
  getVideoAspectRatio,
  isYouTubeShort
} from '../../helpers/player/shorts'
import { MANIFEST_TYPE_SABR } from '../../helpers/player/SabrManifestParser'
import { AUTO_QUALITY_FALLBACK, playbackEngineSupportsAutoQuality } from '../../helpers/player/autoQuality'
import { useI18n } from 'vue-i18n'
import { useTabAvatar, useTabContext, useTabTitle } from '../../tabs/TabContext'
import { tabMediaCoordinator } from '../../tabs/TabMediaCoordinator'
import { useTabToast } from '../../composables/useTabToast'
import { useRelativeTimeClock } from '../../composables/useRelativeTimeClock'
import { areCommentsAvailable } from './watchComments'
import { formatDateTime } from '../../helpers/dateFormat'

/**
 * @typedef {{
 *   scheme: string,
 *   url: string,
 *   poToken: string,
 *   ustreamerConfig: string,
 *   clientInfo: {
 *     clientName: number,
 *     clientVersion: string,
 *     osName: string,
 *     osVersion: string
 *   }
 * }} SabrData
 */

const THEATRE_MODE_ANIMATION_DURATION = 400
const RESPONSIVE_THEATRE_MODE_MAX_WIDTH = 1350
const MAX_TIMEOUT_DELAY = 2_147_483_647
// A SABR session can go stale more than once during a long video, so the
// refetch budget is per incident rather than per video: it refills once the
// refreshed stream has played this many seconds, and only bounds reload loops
// where the refreshed stream fails again before it ever settles.
const MAX_SABR_ERROR_RECOVERIES = 3
const SABR_ERROR_RECOVERY_SETTLE_SECONDS = 30
// timeupdate fires about four times a second, so a natural tick stays well
// under a second even at the fastest playback rate, while the smallest seek
// shortcut jumps 5s. Anything above this is a seek and must not count as played
// content, otherwise seeking around a broken stream would keep handing it fresh
// recovery attempts.
const SABR_ERROR_RECOVERY_MAX_TICK_SECONDS = 2
// The refill above deliberately has no time limit, so a video that breaks every
// time it has played just past the settle threshold could otherwise reload for
// ever. This is the hard stop for a whole video: once it is spent the format
// fallback runs and the video settles on something that plays.
const MAX_SABR_ERROR_RECOVERIES_PER_VIDEO = 8
const ANDROID_HTTP_ERROR_RETRY_DELAY_MS = 750
let nextSabrSchemeId = 0
const UNAVAILABLE_VIDEO_THUMBNAILS = {
  light: 'https://www.youtube.com/img/desktop/unavailable/unavailable_video.png',
  dark: 'https://www.youtube.com/img/desktop/unavailable/unavailable_video_dark_theme.png'
}

export default defineComponent({
  name: 'Watch',
  components: {
    FtRetryImage,
    'ft-shaka-video-player': FtShakaVideoPlayer,
    'watch-video-info': WatchVideoInfo,
    'watch-video-description': WatchVideoDescription,
    'watch-video-transcript': WatchVideoTranscript,
    'watch-video-chapters': WatchVideoChapters,
    'watch-video-sponsor-block': WatchVideoSponsorBlock,
    CommentSection,
    'watch-video-live-chat': WatchVideoLiveChat,
    'watch-video-playlist': WatchVideoPlaylist,
    'watch-video-queue': WatchVideoQueue,
    'watch-video-recommendations': WatchVideoRecommendations,
    'ft-age-restricted': FtAgeRestricted,
    FtSubscribeButton,
    FtShareButton,
    FtIconButton,
    FtAddToPlaylistDropdown,
    FtPaidPromotionBadge,
    FtButton,
    'ft-loader': FtLoader,
  },
  setup: function () {
    const { t, locale } = useI18n()
    const tabRoute = useRoute()
    const tabRouter = useRouter()
    const { tabId, isTabPresented, lifecycle: tabLifecycle } = useTabContext()
    const setTabTitle = useTabTitle()
    const setTabAvatar = useTabAvatar()
    const showTabToast = useTabToast()
    const relativeTimeNow = useRelativeTimeClock()

    return {
      t,
      currentLocale: locale,
      tabId,
      isTabPresented,
      tabLifecycle,
      tabRoute,
      tabRouter,
      setTabTitle,
      setTabAvatar,
      showTabToast,
      relativeTimeNow
    }
  },
  data: function () {
    return {
      startNextVideoInFullscreen: false,
      startNextVideoInFullwindow: false,
      startNextVideoInPip: false,
      nextVideoAutoPictureInPictureState: null,
      startNextVideoWithChapters: false,
      startNextVideoWithFullscreenMetadata: false,
      startNextVideoWithFullscreenComments: false,
      startNextVideoWithFullscreenLiveChat: false,
      startNextVideoWithFullscreenPlaylist: false,
      isLoading: true,
      firstLoad: true,
      // Whether this tab has been presented while showing the current video. A
      // watch tab loading a video in the background briefly attempts to autoplay
      // and is force-paused, which would otherwise persist a ~1 second resume
      // point for a video the user never actually watched. We only save watch
      // progress once the tab is presented, and re-evaluate this per video
      // because the instance is reused across same-tab navigation.
      hasBeenPresented: false,
      useTheatreMode: false,
      // Same-tab navigation keeps the current layout while its skeleton loads.
      // A newly mounted watch tab falls back to the configured default instead.
      loadingTheatreMode: null,
      applyDefaultTheatreModeAfterLoad: false,
      theatreLayoutAvailable: window.innerWidth > RESPONSIVE_THEATRE_MODE_MAX_WIDTH,
      videoPlayerLoaded: false,
      /** @type {boolean|null} */
      isFamilyFriendly: null,
      commentsDisabled: false,
      isLive: false,
      isPremiere: false,
      liveChat: null,
      liveChatIsReplay: false,
      liveChatOpen: true,
      isLiveContent: false,
      isUpcoming: false,
      isPostLiveDvr: false,
      isUnlisted: false,
      isShort: false,
      useCustomShortsPlayerForCurrentVideo: false,
      videoAspectRatio: null,
      shortsLinkedVideo: null,
      shortsTouchStartY: null,
      shortsNavigationLockedUntil: 0,
      shortsLastWindowScrollY: window.scrollY,
      shortsScrollResetPending: false,
      shortsTransitionPreview: '',
      shortsTransitionDirection: 0,
      shortsViewportHeight: window.innerHeight,
      shortsPlaybackCompleted: false,
      shortsCompletionBlockedBySeek: false,
      shortsPlaybackAfterSeekSeconds: 0,
      videoLoadGeneration: 0,
      preparingVideoLoadGeneration: null,
      hasAiGeneratedContent: false,
      hasPaidPromotion: false,
      paidPromotionDurationMs: 10000,
      upcomingTimestamp: null,
      upcomingTimeLeft: null,
      supportsLiveReminders,
      liveReminderActive: false,
      liveReminderLoading: false,
      liveReminderNow: Date.now(),
      liveReminderStartTimer: null,
      removeLiveReminderUpdatedListener: null,
      removeVideoMetadataCacheClearedListener: null,
      /** @type {'dash' | 'audio' | 'legacy'} */
      activeFormat: 'legacy',
      /** @type {'dash' | 'legacy' | null} */
      androidBackgroundRestoreFormat: null,
      localFilePlayback: false,
      thumbnail: '',
      videoId: '',
      videoTitle: '',
      hasResolvedVideoTitle: false,
      videoDescription: '',
      videoDescriptionHtml: '',
      videoMetadataHistory: null,
      videoCategory: '',
      videoTags: [],
      /** @type {import('../../helpers/video-games').LocalVideoGame[]} */
      videoGames: [],
      license: '',
      videoViewCount: 0,
      videoLikeCount: 0,
      videoDislikeCount: 0,
      videoLengthSeconds: 0,
      videoChapters: [],
      videoCurrentChapterIndex: 0,
      /** @type {'chapters' | 'keyMoments'} */
      videoChaptersKind: 'chapters',
      channelName: '',
      channelThumbnail: '',
      channelId: '',
      channelCollaborators: [],
      channelSubscriptionCountText: '',
      videoPublished: 0,
      premiereDate: undefined,
      videoStoryboardSrc: '',
      videoAnnotations: [],
      /** @type {string|null} */
      manifestSrc: null,
      /** @type {(MANIFEST_TYPE_DASH|MANIFEST_TYPE_HLS|MANIFEST_TYPE_SABR)} */
      manifestMimeType: MANIFEST_TYPE_DASH,
      /** @type {SabrData | null} */
      sabrData: null,
      /**
       * Which engine provided the streams that are currently loaded.
       * @type {'built-in' | 'yt-dlp'}
       */
      activePlaybackEngine: 'built-in',
      /** @type {string | null} the yt-dlp version that extracted the current streams */
      activePlaybackEngineVersion: null,
      /**
       * The online streams stay cached while a downloaded file is selected so
       * changing playback sources does not have to reload the watch page.
       * @type {{
       *   manifestSrc: string | null,
       *   manifestMimeType: MANIFEST_TYPE_DASH | MANIFEST_TYPE_HLS | MANIFEST_TYPE_SABR,
       *   sabrData: SabrData | null,
       *   legacyFormats: object[],
       *   streamingDataExpiryDate: Date | null,
       *   activeFormat: 'dash' | 'audio' | 'legacy',
       *   activePlaybackEngine: 'built-in' | 'yt-dlp',
       *   activePlaybackEngineVersion: string | null,
       *   hasBeenLoaded: boolean
       * } | null}
       */
      onlinePlaybackSource: null,
      playbackSourceKey: 0,
      localPlaybackDownloadId: null,
      sabrPlaybackLoaded: false,
      /** @type {{
       *   manifestSrc: string | null,
       *   manifestMimeType: MANIFEST_TYPE_DASH | MANIFEST_TYPE_HLS | MANIFEST_TYPE_SABR,
       *   sabrData: SabrData | null,
       *   legacyFormats: object[],
       *   streamingDataExpiryDate: Date | null
       * } | null}
       */
      builtInPlaybackSource: null,
      playbackEngineFallbackAttemptedForCurrentVideo: false,
      /** @type {'built-in' | 'yt-dlp' | null} */
      playbackEngineFallbackTarget: null,
      playbackEngineSwitchGeneration: 0,
      // yt-dlp is a separate process that takes a while to extract the streams. The
      // metadata is already there at that point, so the rest of the page is shown
      // immediately and only the player waits behind a thumbnail placeholder.
      ytDlpStreamsPending: false,
      ytDlpDefaultClientsFallbackToastShown: false,
      legacyFormats: [],
      captions: [],
      captionTranslations: [],
      currentTime: 0,
      showTranscript: false,
      showSidebarChapters: false,
      showSidebarSponsorBlock: false,
      sidebarPanelLeaving: false,
      sponsorBlockInfoLoading: false,
      sponsorBlockInfoPendingUuid: null,
      sponsorBlockInfoSegments: [],
      sponsorBlockInfoSubmissionEnabled: false,
      sponsorBlockContributionStats: null,
      sponsorBlockContributionStatsError: false,
      sponsorBlockContributionStatsLoaded: false,
      sponsorBlockContributionStatsLoading: false,
      videoChapterThumbnails: [],
      fullscreenMetadataOpen: false,
      shortsMetadataOpen: false,
      shortsCommentsOpen: false,
      /** @type {HTMLElement|null} */
      fullscreenMetadataTarget: null,
      fullscreenTranscriptOpen: false,
      /** @type {HTMLElement|null} */
      fullscreenTranscriptTarget: null,
      fullscreenSponsorBlockOpen: false,
      /** @type {HTMLElement|null} */
      fullscreenSponsorBlockTarget: null,
      fullscreenCommentsOpen: false,
      /** @type {HTMLElement|null} */
      fullscreenCommentsTarget: null,
      fullscreenLiveChatOpen: false,
      /** @type {HTMLElement|null} */
      fullscreenLiveChatTarget: null,
      fullscreenPlaylistOpen: false,
      /** @type {HTMLElement|null} */
      fullscreenPlaylistTarget: null,
      playlistScrollPositions: {
        sidebar: null,
        fullscreen: null,
      },
      /** @type {'EQUIRECTANGULAR' | 'EQUIRECTANGULAR_THREED_TOP_BOTTOM' | 'MESH'| null} */
      vrProjection: null,
      autoplayNextRecommendedVideo: false,
      autoplayNextPlaylistVideo: false,
      recommendedVideos: [],
      upcomingPlaylistVideos: [],
      watchingPlaylist: false,
      playlistSkipAvailability: { canPlayNext: true, canPlayPrevious: true },
      playlistId: '',
      playlistType: '',
      playlistItemId: null,
      /** @type {number|null} */
      timestamp: null,
      // This should never be saved into history
      /** @type {number|null} */
      oneTimeTimestamp: null,
      playNextTimeout: null,
      playNextCountDownIntervalId: null,
      autoplayCountdown: null,
      blockVideoAutoplay: false,
      autoplayInterruptionTimeout: null,
      playabilityStatus: '',
      totalAdTimeSeconds: 0,
      adEndTimeUnixMs: 0,

      onMountedRun: false,

      // error handling/messages
      /** @type {string|null} */
      errorMessage: null,
      /** @type {string[]|null} */
      customErrorIcon: null,
      /** @type {'age' | 'members' | null} */
      restrictedPlaybackError: null,
      /** @type {'private' | 'drm' | null} */
      nonRetryablePlaybackError: null,
      videoGenreIsMusic: false,
      /** @type {(typeof MUSIC_MEDIA_TYPE)[keyof typeof MUSIC_MEDIA_TYPE]} */
      musicMediaType: MUSIC_MEDIA_TYPE.UNKNOWN,
      /** @type {Date|null} */
      streamingDataExpiryDate: null,
      currentPlaybackRate: null,
      currentVideoQuality: null,
      /** @type {boolean|null} */
      currentSubtitlesState: null,
      /** @type {number|null} */
      currentVolume: null,

      // Local, non-persistent toggle for temporarily disabling SponsorBlock auto-skipping
      sponsorBlockAutoSkipTemporarilyDisabled: false,

      // When true, the new player after a SABR reload should start playback (was playing before reload)
      resumePlaybackAfterSabrReload: false,
      // When true, the new player after a SABR reload must ignore the normal autoplay setting.
      suppressAutoplayAfterSabrReload: false,
      playerTeardownInProgress: false,
      /** @type {number|null} */
      sabrReloadCaptionIndex: null,
      /** @type {number|null} */
      sabrReloadPlaybackRate: null,
      /** @type {string|null} */
      sabrReloadVideoQuality: null,
      preserveTitleOnNextReload: false,
      ipBlockDetectedInCurrentChain: false,
      ipBlockRecoveryAttemptedForCurrentVideo: false,
      androidHttpErrorRecoveryAttemptedForCurrentVideo: false,
      streamErrorReloadAttemptedForCurrentVideo: false,
      sabrErrorRecoveryAttempts: 0,
      sabrErrorRecoveriesForCurrentVideo: 0,
      /** @type {number|null} */
      sabrErrorRecoveryLastSeconds: null,
      sabrErrorRecoveryPlayedSeconds: 0,
      /** @type {number|null} */
      watchTimeLastTick: null,
      recommendationPlaybackSample: null,
      recommendationWatchSession: null,
      recommendationLoadRetryAt: 0,
      /** @type {Record<string, number>} */
      pendingWatchTimeByDate: {},
      historyLastTouchedAt: 0,
    }
  },
  computed: {
    musicPlayerArtist: function () {
      return this.musicMediaType === MUSIC_MEDIA_TYPE.AUDIO_TRACK
        ? getMusicTrackArtist(this.channelName)
        : this.channelName
    },
    dateFormatPreference: function () {
      return this.$store.getters.getDateFormat
    },
    timeFormatPreference: function () {
      return this.$store.getters.getTimeFormat
    },
    localPlaybackDownloads: function () {
      const downloads = Object.values(this.$store.getters.getYtDlpDownloads)
        .filter(download => download.status === 'completed' && ['video', 'audio'].includes(download.mode))
        .filter(download => download.files?.some(file => (
          file.videoId === this.videoId && file.available !== false
        )))
        .toSorted((a, b) => b.id - a.id)
      const activeDownloadId = Number(this.tabRoute.query.downloadId)

      return ['video', 'audio'].flatMap(mode => {
        const download = downloads.find(download => (
          download.id === activeDownloadId && download.mode === mode
        )) ?? downloads.find(download => download.mode === mode)
        return download === undefined
          ? []
          : [{ id: download.id, mode, active: download.id === activeDownloadId }]
      })
    },
    hasScheduledPremiereStarted: function () {
      return this.premiereDate instanceof Date &&
        this.premiereDate.getTime() <= this.liveReminderNow
    },
    displayedUpcomingTimeLeft: function () {
      if (!(this.premiereDate instanceof Date)) return this.upcomingTimeLeft

      let timeLeft = (this.premiereDate.getTime() - this.relativeTimeNow) / 60000
      let timeUnit = 'minute'

      if (timeLeft > 120) {
        timeLeft /= 60
        timeUnit = 'hour'
      }

      if (timeUnit === 'hour' && timeLeft > 24) {
        timeLeft /= 24
        timeUnit = 'day'
      }

      timeLeft = Math.floor(timeLeft)
      if (timeLeft < 1) {
        return this.t('Video.Published.In less than a minute').toLowerCase()
      }

      return new Intl.RelativeTimeFormat(this.currentLocale).format(timeLeft, timeUnit)
    },
    canToggleLiveReminder: function () {
      return this.supportsLiveReminders &&
        this.premiereDate instanceof Date &&
        this.premiereDate.getTime() > this.liveReminderNow
    },
    sponsorBlockFullVideoCategory: function () {
      return selectSponsorBlockFullVideoLabel(this.sponsorBlockInfoSegments)?.category ?? null
    },
    // `description` and `viewCount` are intentionally left out,
    // the store drops them from playlist entries as undesired attributes
    addToPlaylistVideoData: function () {
      return {
        videoId: this.videoId,
        title: this.videoTitle,
        author: this.channelName,
        authorId: this.channelId,
        lengthSeconds: this.videoLengthSeconds,
        published: this.videoPublished,
        premiereDate: this.premiereDate
      }
    },
    historyEntry: function () {
      return this.$store.getters.getHistoryCacheById[this.videoId]
    },
    historyEntryExists: function () {
      return typeof this.historyEntry !== 'undefined'
    },
    quickBookmarkPlaylist: function () {
      return this.$store.getters.getQuickBookmarkPlaylist
    },
    quickBookmarkIcon: function () {
      return this.$store.getters.getQuickBookmarkIcon
    },
    isQuickBookmarkEnabled: function () {
      return this.quickBookmarkPlaylist != null
    },
    isCurrentVideoQuickBookmarked: function () {
      return this.quickBookmarkPlaylist?.videos.some(video => video.videoId === this.videoId) ?? false
    },
    quickBookmarkIconText: function () {
      if (!this.isQuickBookmarkEnabled) { return '' }

      const translationProperties = {
        playlistName: this.quickBookmarkPlaylist.playlistName
      }
      return this.isCurrentVideoQuickBookmarked
        ? this.$t('User Playlists.Remove from Favorites', translationProperties)
        : this.$t('User Playlists.Add to Favorites', translationProperties)
    },
    rememberHistory: function () {
      return this.$store.getters.getRememberHistory
    },
    historyRetentionEnabled: function () {
      const days = Number(this.$store.getters.getHistoryRetentionDays)
      return Number.isInteger(days) && days > 0
    },
    enableWatchStats: function () {
      return this.$store.getters.getEnableWatchStats
    },
    enableVideoMetadataCache: function () {
      return process.env.IS_ELECTRON && this.$store.getters.getEnableVideoMetadataCache
    },
    watchStatsResetVersion: function () {
      return this.$store.getters.getWatchStatsResetVersion
    },
    watchedProgressSavingEnabled: function () {
      return this.$store.getters.getWatchedProgressSavingMode !== 'never'
    },
    watchedPercentageThreshold: function () {
      return this.$store.getters.getWatchedPercentageThreshold
    },
    autosaveWatchedProgress: function () {
      return this.$store.getters.getWatchedProgressSavingMode === 'auto'
    },
    saveVideoHistoryWithLastViewedPlaylist: function () {
      return this.$store.getters.getSaveVideoHistoryWithLastViewedPlaylist
    },
    backendPreference: function () {
      return this.$store.getters.getBackendPreference
    },
    backendFallback: function () {
      return this.$store.getters.getBackendFallback
    },
    videoIpBlockScriptPath: function () {
      return this.$store.getters.getVideoIpBlockScriptPath
    },
    currentInvidiousInstanceUrl: function () {
      return this.$store.getters.getCurrentInvidiousInstanceUrl
    },
    proxyVideos: function () {
      return this.$store.getters.getProxyVideos
    },
    ytDlpPlaybackCacheKey: function () {
      return buildYtDlpPlaybackCacheKey(this.$store.getters)
    },
    hasConfiguredRestrictedPlaybackAuthentication: function () {
      return hasConfiguredRestrictedPlaybackAuthentication(this.$store.getters)
    },
    alwaysUseYtDlpPlaybackCookies: function () {
      return this.$store.getters.getYtDlpPlaybackAlwaysUseCookies &&
        this.hasConfiguredRestrictedPlaybackAuthentication
    },
    canTryRestrictedPlaybackWithCookies: function () {
      return this.restrictedPlaybackError !== null &&
        this.hasConfiguredRestrictedPlaybackAuthentication &&
        !this.ytDlpStreamsPending
    },
    defaultAutoplayInterruptionIntervalHours: function () {
      return this.$store.getters.getDefaultAutoplayInterruptionIntervalHours
    },
    defaultInterval: function () {
      return this.$store.getters.getDefaultInterval
    },
    defaultViewingMode: function () {
      const mode = this.$store.getters.getDefaultViewingMode
      return process.env.IS_CAPACITOR && ['external_player', 'fullscreen', 'fullscreen_always_on', 'pip'].includes(mode)
        ? 'default'
        : mode
    },
    autoOpenChapters: function () {
      return this.$store.getters.getAutoOpenChapters
    },
    preferredCaptionLocale: function () {
      return this.$store.getters.getPreferredCaptionLocale || this.currentLocale
    },
    preferredTranscriptCaptionIndex: function () {
      const caption = getPreferredCaption(
        this.captions,
        this.preferredCaptionLocale,
        this.$store.getters.getEnableCaptionTranslations
      )

      return caption ? this.captions.indexOf(caption) : 0
    },
    transcriptAvailable: function () {
      return this.captions.length > 0
    },
    ambientModeActive: function () {
      return this.$store.getters.getAmbientMode &&
        this.activeFormat !== 'audio' &&
        this.vrProjection !== 'EQUIRECTANGULAR'
    },
    customShortsPlayerActive: function () {
      return this.useCustomShortsPlayerForCurrentVideo &&
        this.isShort &&
        this.activeFormat !== 'audio'
    },
    isStandaloneShort: function () {
      return this.isShort && !this.watchingPlaylist
    },
    shortsPlayerWidth: function () {
      const playerHeight = Math.max(0, this.shortsViewportHeight - 156)
      return Math.min(600, playerHeight * (this.videoAspectRatio ?? 9 / 16))
    },
    shortsPlayerHeight: function () {
      return this.shortsPlayerWidth / (this.videoAspectRatio ?? 9 / 16)
    },
    subscriptionShortsFeedActive: function () {
      return this.customShortsPlayerActive
    },
    subscriptionShortsFeed: function () {
      if (!this.subscriptionShortsFeedActive) {
        return []
      }

      let feed
      if (
        this.tabRoute.query.shortSource === 'channel' &&
        this.tabRoute.query.shortChannelId
      ) {
        feed = getChannelShortsNavigationContext(
          this.tabRoute.query.shortChannelId
        )
      } else {
        const maxPerChannel = this.$store.getters.getOnlyShowLatestFromChannel
          ? this.$store.getters.getOnlyShowLatestFromChannelNumber
          : null

        feed = buildSubscriptionShortsFeed({
          cache: this.$store.getters.getShortsCache,
          subscriptions: this.$store.getters.getActiveProfile.subscriptions,
          isHidden: video => isVideoHiddenByPreferences(video, {
            hideLiveStreams: this.$store.getters.getHideLiveStreams,
            hideUpcomingPremieres: this.$store.getters.getHideUpcomingPremieres,
            forbiddenTitles: this.forbiddenTitles,
          }),
          isWatched: video => isHistoryEntryWatched(
            this.$store.getters.getHistoryCacheById[video.videoId]
          ),
          hideWatched: this.$store.getters.getHideWatchedSubs,
          restrictedPlaybackConfigured: hasConfiguredRestrictedPlaybackAuthentication(this.$store.getters),
          maxPerChannel,
          currentVideoId: this.videoId,
        })
      }

      if (
        this.videoId &&
        !feed.some(video => video.videoId === this.videoId)
      ) {
        feed.unshift({
          videoId: this.videoId,
          title: this.videoTitle,
          author: this.channelName,
          authorId: this.channelId,
          published: this.videoPublished,
          isShort: true,
        })
      }

      return feed
    },
    subscriptionShortsFeedIndex: function () {
      return this.subscriptionShortsFeed.findIndex(video => video.videoId === this.videoId)
    },
    hasPreviousSubscriptionShort: function () {
      return this.subscriptionShortsFeedIndex > 0
    },
    hasNextSubscriptionShort: function () {
      return this.subscriptionShortsFeedIndex >= 0 &&
        this.subscriptionShortsFeedIndex < this.subscriptionShortsFeed.length - 1
    },
    nextSubscriptionShort: function () {
      return this.hasNextSubscriptionShort
        ? this.subscriptionShortsFeed[this.subscriptionShortsFeedIndex + 1]
        : null
    },
    currentSubscriptionShort: function () {
      return this.subscriptionShortsFeedIndex >= 0
        ? this.subscriptionShortsFeed[this.subscriptionShortsFeedIndex]
        : null
    },
    nextSubscriptionShortThumbnail: function () {
      if (!this.nextSubscriptionShort) {
        return ''
      }

      return getShortThumbnailUrl(
        this.nextSubscriptionShort,
        this.backendPreference,
        this.currentInvidiousInstanceUrl,
        this.thumbnailPreference
      ) ?? ''
    },
    shortsCommentsPanelOpen: function () {
      return this.shortsCommentsOpen && !this.fullscreenCommentsOpen
    },
    shortsCommentsText: function () {
      return this.shortsCommentsPanelOpen
        ? this.$t('Comments.Hide Comments')
        : this.$t('Comments.Show Comments')
    },
    shortsAuxPanelOpen: function () {
      return this.customShortsPlayerActive && (
        this.shortsMetadataOpen ||
        this.showTranscript ||
        this.showSidebarSponsorBlock
      )
    },
    shortsNavigationPanelOpen: function () {
      return this.customShortsPlayerActive && (
        this.shortsCommentsOpen ||
        this.shortsAuxPanelOpen ||
        this.fullscreenMetadataOpen ||
        this.fullscreenTranscriptOpen ||
        this.fullscreenSponsorBlockOpen ||
        this.fullscreenCommentsOpen ||
        this.fullscreenLiveChatOpen ||
        this.fullscreenPlaylistOpen
      )
    },
    shortsActionSkeletonCount: function () {
      return [
        !this.hideComments,
        true,
        this.useSponsorBlock,
        !this.hideSharingActions,
        this.showPlaylists,
        this.isQuickBookmarkEnabled,
      ].filter(Boolean).length
    },
    hideUploader: function () {
      return this.$store.getters.getHideUploader
    },
    disableChannelLinks: function () {
      return this.$store.getters.getDisableChannelLinks
    },
    hideUnsubscribeButton: function () {
      return this.$store.getters.getHideUnsubscribeButton
    },
    hideSharingActions: function () {
      return this.$store.getters.getHideSharingActions
    },
    showPlaylists: function () {
      return !this.$store.getters.getHidePlaylists
    },
    isInAnyPlaylist: function () {
      return this.$store.getters.getPlaylistVideoCounts.has(this.videoId)
    },
    defaultVideoFormat: function () {
      return this.$store.getters.getDefaultVideoFormat
    },
    videoPlaybackEngine: function () {
      return supportsYtDlp ? this.$store.getters.getVideoPlaybackEngine : 'built-in'
    },
    playbackEngineSelection: function () {
      if (this.ytDlpStreamsPending) {
        if (this.playbackEngineFallbackTarget !== null) {
          return this.playbackEngineFallbackTarget
        }

        // A live stream without built-in formats automatically falls back to
        // yt-dlp even when the configured default remains the built-in engine.
        if (
          this.videoPlaybackEngine === 'built-in' &&
          this.isLive &&
          this.manifestSrc === null &&
          this.legacyFormats.length === 0
        ) {
          return 'yt-dlp'
        }

        return this.videoPlaybackEngine
      }

      return this.activePlaybackEngine
    },
    otherPlaybackEngine: function () {
      return this.playbackEngineSelection === 'yt-dlp' ? 'built-in' : 'yt-dlp'
    },
    retryWithOtherPlaybackEngineLabel: function () {
      return this.otherPlaybackEngine === 'yt-dlp'
        ? this.t('Video.Retry With yt-dlp Extraction')
        : this.t('Video.Retry With Built-in Extraction')
    },
    canRetryWithOtherPlaybackEngine: function () {
      return supportsYtDlp &&
        this.errorMessage !== null &&
        !this.localFilePlayback &&
        !this.isUpcoming &&
        !this.isPostLiveDvr &&
        this.restrictedPlaybackError === null &&
        this.nonRetryablePlaybackError === null
    },
    /** @returns {'sabr' | 'dash' | 'hls' | 'none'} */
    playbackStreamType: function () {
      if (this.manifestSrc === null || this.activeFormat === 'legacy') {
        return 'none'
      }

      switch (this.manifestMimeType) {
        case MANIFEST_TYPE_SABR:
          return 'sabr'
        case MANIFEST_TYPE_HLS:
          return 'hls'
        default:
          return 'dash'
      }
    },
    dashFormatAvailable: function () {
      return this.manifestSrc !== null
    },
    legacyFormatAvailable: function () {
      return !this.isLive && !this.isPostLiveDvr && this.legacyFormats.length > 0
    },
    audioFormatAvailable: function () {
      if (this.manifestSrc === null) {
        return false
      }

      // The WEB HLS manifests only contain combined audio and video files, so we can't do audio only.
      // The IOS HLS manifests have audio-only streams
      return !((this.isLive || this.isPostLiveDvr) &&
        this.manifestMimeType === MANIFEST_TYPE_HLS &&
        !this.manifestSrc.includes('/demuxed/1'))
    },
    autoplayEnabled: function () {
      if (this.isStandaloneShort) { return false }
      if (this.nextQueuedVideo) { return true }
      return this.watchingPlaylist ? this.autoplayNextPlaylistVideo : this.autoplayNextRecommendedVideo
    },
    nextQueuedVideo: function () {
      return this.$store.getters.getNextQueuedVideo
    },
    upcomingYtDlpPreloadVideoIds: function () {
      if (
        !supportsYtDlp ||
        this.videoPlaybackEngine !== 'yt-dlp' ||
        !this.$store.getters.getYtDlpPreloadEnabled
      ) return []

      const recommendedVideos = this.hideRecommendedVideos
        ? []
        : this.recommendedVideos.filter(video =>
            !this.isHiddenVideo(this.forbiddenTitles, this.channelsHidden, video)
          )

      return selectYtDlpPreloadVideoIds({
        currentVideoId: this.videoId,
        limit: this.$store.getters.getYtDlpPreloadCount,
        queuedVideos: this.$store.getters.getWatchQueue,
        playlistVideos: this.watchingPlaylist ? this.upcomingPlaylistVideos : null,
        recommendedVideos,
      })
    },
    thumbnailPreference: function () {
      return this.$store.getters.getThumbnailPreference
    },
    /** Thumbnail to show in toasts about this video, omitted when thumbnails are hidden */
    toastThumbnail: function () {
      return this.thumbnailPreference === 'hidden' ? null : this.thumbnail
    },
    autoplayNextRecommendedVideoByDefault: function () {
      return this.$store.getters.getPlayNextVideo
    },
    autoplayNextPlaylistVideoByDefault: function () {
      return this.$store.getters.getAutoplayPlaylists
    },
    hideRecommendedVideos: function () {
      return this.$store.getters.getHideRecommendedVideos
    },
    hideEndScreenAnnotations: function () {
      return this.$store.getters.getHideEndScreenAnnotations
    },
    hidePaidPromotion: function () {
      return this.$store.getters.getHidePaidPromotion
    },
    showPaidPromotion: function () {
      return this.hasPaidPromotion && !this.hidePaidPromotion
    },
    hideLiveChat: function () {
      return this.$store.getters.getHideLiveChat
    },
    hideLiveChatReplay: function () {
      return this.$store.getters.getHideLiveChatReplay
    },
    liveChatAvailable: function () {
      return this.liveChatIsReplay
        ? !this.hideLiveChatReplay
        : !this.hideLiveChat && (this.isLive || this.isUpcoming)
    },
    showLiveChat: function () {
      return this.liveChatAvailable && this.liveChatOpen
    },
    // The player reports its position about four times a second, but a chat replay
    // buffers 20 seconds ahead and only cares about jumps of more than a few seconds.
    // Rounding keeps the chat from re-rendering its message list on every tick.
    liveChatCurrentTime: function () {
      return Math.floor(this.currentTime)
    },
    hideComments: function () {
      return this.$store.getters.getHideComments
    },
    commentsAvailable: function () {
      return areCommentsAvailable(this)
    },
    hideVideoDescription: function () {
      return this.$store.getters.getHideVideoDescription
    },
    showFamilyFriendlyOnly: function () {
      return this.$store.getters.getShowFamilyFriendlyOnly
    },
    hideChannelSubscriptions: function () {
      return this.$store.getters.getHideChannelSubscriptions
    },
    hideVideoLikesAndDislikes: function () {
      return this.$store.getters.getHideVideoLikesAndDislikes
    },
    theatrePossible: function () {
      return this.showTranscript || !this.hideRecommendedVideos ||
        this.showLiveChat || this.watchingPlaylist || !!this.nextQueuedVideo ||
        this.showSidebarChapters || this.showSidebarSponsorBlock
    },
    theatreTogglePossible: function () {
      return this.theatreLayoutAvailable && this.theatrePossible
    },
    canSkipToNextVideo: function () {
      // The watch queue takes precedence over the playlist and works without one,
      // see `handleSkipToNext`
      return !!this.nextQueuedVideo || (this.watchingPlaylist && this.playlistSkipAvailability.canPlayNext)
    },
    canSkipToPreviousVideo: function () {
      // Only a playlist has a previous video, see `handleSkipToPrev`
      return this.watchingPlaylist && this.playlistSkipAvailability.canPlayPrevious
    },
    autoplayPossible: function () {
      return !this.isStandaloneShort && (
        !!this.nextQueuedVideo ||
        (!this.watchingPlaylist && !this.hideRecommendedVideos && !!this.nextRecommendedVideo) ||
        (this.watchingPlaylist && !this.$refs.watchVideoPlaylist?.shouldStopDueToPlaylistEnd)
      )
    },
    hideChapters: function () {
      return this.$store.getters.getHideChapters
    },
    sponsorBlockChannelWhitelist: function () {
      const whitelist = this.$store.getters.getSponsorBlockChannelWhitelist
      return Array.isArray(whitelist) ? whitelist : []
    },
    isSponsorBlockChannelWhitelisted: function () {
      return Boolean(this.channelId) && this.sponsorBlockChannelWhitelist.includes(this.channelId)
    },
    sponsorBlockAutoSkipDisabled: function () {
      return this.sponsorBlockAutoSkipTemporarilyDisabled || this.isSponsorBlockChannelWhitelisted
    },
    channelsHidden() {
      return this.$store.getters.getChannelsHiddenParsed
    },
    forbiddenTitles() {
      return this.$store.getters.getForbiddenTitlesParsed
    },
    isUserPlaylistRequested: function () {
      return this.tabRoute.query.playlistType === 'user'
    },
    userPlaylistsReady: function () {
      return this.$store.getters.getPlaylistsReady
    },
    selectedUserPlaylist: function () {
      if (this.playlistId == null || this.playlistId === '') { return null }
      if (!this.isUserPlaylistRequested) { return null }

      return this.$store.getters.getPlaylist(this.playlistId)
    },
    endScreenRecommendations: function () {
      if (this.hideRecommendedVideos) return []
      return this.recommendedVideos.filter(video =>
        video.videoId && video.videoId !== this.videoId &&
        !this.isHiddenVideo(this.forbiddenTitles, this.channelsHidden, video)
      ).slice(0, 6)
    },
    nextRecommendedVideo: function () {
      return this.recommendedVideos.find((video) =>
        !this.isHiddenVideo(this.forbiddenTitles, this.channelsHidden, video)
      )
    },
    startTimeSeconds: function () {
      if (this.isLoading || this.isLive) {
        return null
      }

      if (this.oneTimeTimestamp !== null && this.oneTimeTimestamp < this.videoLengthSeconds) {
        return this.oneTimeTimestamp
      } else if (this.timestamp !== null && this.timestamp < this.videoLengthSeconds) {
        return this.timestamp
      } else if (this.watchedProgressSavingEnabled && this.historyEntryExists) {
        // For UX consistency, no progress reading if writing disabled

        /** @type {number} */
        const watchProgress = this.historyEntry.watchProgress

        if (watchProgress > 0 && watchProgress < this.videoLengthSeconds - 2) {
          return watchProgress
        }
      }

      return null
    },

    /**
     * The metadata is rendered as soon as the backend responds, but the player can
     * only be created once the streams it is supposed to play are known.
     */
    playerReady() {
      if (this.isLoading || this.ytDlpStreamsPending) {
        return false
      }

      return this.activeFormat === 'legacy'
        ? this.legacyFormats.length > 0
        : this.manifestSrc !== null
    },

    canSaveWatchProgress() {
      if (this.isUpcoming || this.isLive) { return false }

      // `this.$refs.player?.hasLoaded` cannot be used in computed property.
      // While the streams are still being extracted there is no player to read a
      // position from, so the manual save action must not be offered yet either.
      return this.playerReady
    },
    useSponsorBlock: function () {
      return this.$store.getters.getUseSponsorBlock
    },
    useReturnYouTubeDislikes: function () {
      return this.$store.getters.getUseReturnYouTubeDislikes
    },

    chaptersSrc() {
      if (this.videoChapters.length > 0) {
        const vttText = buildChaptersVttFile(this.videoChapters)

        return `data:text/vtt,${encodeURIComponent(vttText)}`
      } else {
        return ''
      }
    }
  },
  watch: {
    currentLocale: 'updateUpcomingTimestamp',
    dateFormatPreference: 'updateUpcomingTimestamp',
    timeFormatPreference: 'updateUpcomingTimestamp',
    isLoading(loading) {
      if (!loading) {
        this.updateVideoMetadataCache()

        if (!this.transcriptAvailable && this.showTranscript) {
          this.closeTranscript()
        }

        this.loadingTheatreMode = null
        this.shortsTransitionPreview = ''
        this.shortsTransitionDirection = 0

        if (this.shortsMetadataOpen) {
          this.clampShortsAuxPanelScroll()
        }

        if (this.applyDefaultTheatreModeAfterLoad) {
          this.applyDefaultTheatreModeAfterLoad = false
          this.useTheatreMode = this.theatreTogglePossible
        }
      }
    },
    isTabPresented: {
      immediate: true,
      handler() {
        if (this.isCurrentlyPresented()) {
          this.hasBeenPresented = true
        }
      }
    },
    async 'tabRoute.fullPath'(fullPath, previousFullPath) {
      if (
        !('timestamp' in this.tabRoute.query) &&
        this.watchRouteWithoutTimestamp(fullPath) ===
          this.watchRouteWithoutTimestamp(previousFullPath)
      ) {
        return
      }

      if (
        this.playbackSourceRouteBase(fullPath) ===
        this.playbackSourceRouteBase(previousFullPath)
      ) {
        const downloadId = Number(this.tabRoute.query.downloadId)
        if (Number.isInteger(downloadId)) {
          if (downloadId !== this.localPlaybackDownloadId &&
            !this.applyDownloadedPlaybackSource(downloadId)) {
            await this.reloadView()
          }
        } else if (this.localFilePlayback && !this.restoreOnlinePlaybackSource()) {
          await this.reloadView()
        }
        return
      }
      await this.reloadView()
    },
    userPlaylistsReady() {
      this.onMountedDependOnLocalStateLoading()
    },
    enableWatchStats(enabled) {
      if (!enabled) {
        this.clearPendingWatchTime()
      }
    },
    enableVideoMetadataCache(enabled) {
      if (enabled && !this.isLoading) {
        this.updateVideoMetadataCache()
      } else if (!enabled) {
        this.videoMetadataHistory = null
      }
    },
    rememberHistory(enabled) {
      if (!enabled) {
        this.clearPendingWatchTime()
      }
    },
    watchStatsResetVersion() {
      this.clearPendingWatchTime()
    },
    canSkipToNextVideo() {
      this.syncMediaSessionSkipHandlers()
    },
    canSkipToPreviousVideo() {
      this.syncMediaSessionSkipHandlers()
    },
    upcomingYtDlpPreloadVideoIds: {
      immediate: true,
      handler(videoIds) {
        this.preloadUpcomingYtDlpPlaybackSources(videoIds)
      }
    },
  },
  created: function () {
    this.theatreModeAnimations = []
    this.videoId = this.tabRoute.params.id
    this.isShort = this.tabRoute.query.short === 'true'
    this.useCustomShortsPlayerForCurrentVideo = this.$store.getters.getUseCustomShortsPlayer
    this.videoAspectRatio = this.isShort ? 9 / 16 : null
    this.activeFormat = this.defaultVideoFormat
    // So that the value for this session remains unchanged even if setting changed
    this.autoplayNextRecommendedVideo = this.autoplayNextRecommendedVideoByDefault
    this.autoplayNextPlaylistVideo = this.autoplayNextPlaylistVideoByDefault

    this.checkIfTimestamp()
    this.initializePlaybackRate()
    this.initializeVideoQuality()
  },
  mounted: function () {
    connectionEvents.addEventListener('change', this.handleDownloadConnectionChange)
    document.addEventListener('keydown', this.handleShortsNavigationKeydown, true)
    document.addEventListener('visibilitychange', this.updateAndroidBackgroundPlaybackFormat)
    window.addEventListener('resize', this.updateShortsViewportHeight)
    window.addEventListener('resize', this.updateTheatreLayoutAvailability)
    window.addEventListener('scroll', this.handleShortsWindowScroll, { passive: true })
    this.removeTabLifecycle = this.tabLifecycle?.register(this.tabId, {
      activate: this.activateWatchRuntime,
      deactivate: this.deactivateWatchRuntime,
      beforeNavigate: this.cleanupWatchRuntime,
      beforeReload: this.cleanupWatchRuntime,
      beforeDispose: this.cleanupWatchRuntime
    })
    this.syncMediaSessionSkipHandlers()
    this.removeLiveReminderUpdatedListener = liveReminder.onUpdated((videoId, scheduled) => {
      if (videoId === this.videoId) {
        this.liveReminderActive = scheduled
      }
    })
    this.removeVideoMetadataCacheClearedListener = window.ftElectron?.videoMetadataCache?.onCleared?.(() => {
      this.videoMetadataHistory = null
    }) ?? null
    this.onMountedDependOnLocalStateLoading()
  },
  beforeUnmount: function () {
    connectionEvents.removeEventListener('change', this.handleDownloadConnectionChange)
    document.removeEventListener('keydown', this.handleShortsNavigationKeydown, true)
    document.removeEventListener('visibilitychange', this.updateAndroidBackgroundPlaybackFormat)
    window.removeEventListener('resize', this.updateShortsViewportHeight)
    window.removeEventListener('resize', this.updateTheatreLayoutAvailability)
    window.removeEventListener('scroll', this.handleShortsWindowScroll)
    this.theatreModeAnimations.forEach(animation => animation.cancel())
    this.clearLiveReminderStartTimer()
    this.removeLiveReminderUpdatedListener?.()
    this.removeLiveReminderUpdatedListener = null
    this.removeVideoMetadataCacheClearedListener?.()
    this.removeVideoMetadataCacheClearedListener = null
    if ('mediaSession' in navigator) {
      tabMediaCoordinator.setActionHandlers(this.tabId ?? 'web', 'playlist', {})
    }
    this.deactivateWatchRuntime()
    // When a logical-tab lifecycle is registered, its beforeDispose hook drives
    // cleanupWatchRuntime before this component unmounts. Without one (e.g. the
    // web build), beforeDispose never fires, so run the same teardown here so the
    // beforeunload handlers, watch progress, and player are still disposed.
    const lifecycleHandledDisposal = this.removeTabLifecycle != null
    this.removeTabLifecycle?.()
    this.removeTabLifecycle = null
    if (!lifecycleHandledDisposal) {
      this.cleanupWatchRuntime()
    }
  },
  methods: {
    handleDownloadConnectionChange({ detail }) {
      if (detail !== 'offline' || !this.isLoading || this.localFilePlayback) return
      if (this.finishDownloadedPlaybackWithoutMetadata()) {
        // Ignore metadata responses that arrive after switching to the local file.
        this.videoLoadGeneration++
      }
    },
    updateAndroidBackgroundPlaybackFormat() {
      if (!process.env.IS_CAPACITOR || this.$refs.player?.isNativePlayback?.()) return

      const change = resolveAndroidBackgroundPlaybackFormat({
        hidden: isAppHidden(),
        continuePlayback: this.$store.getters.getContinuePlaybackWhenScreenIsLocked,
        activeFormat: this.activeFormat,
        audioFormatAvailable: this.audioFormatAvailable,
        paused: this.$refs.player?.isPaused() ?? true,
        restoreFormat: this.androidBackgroundRestoreFormat,
      })
      if (change === null) return

      this.androidBackgroundRestoreFormat = change.restoreFormat
      this.activeFormat = change.activeFormat
    },

    handleUpcomingPlaylistVideosChange(videos) {
      this.upcomingPlaylistVideos = Array.isArray(videos) ? videos : []
    },
    preloadUpcomingYtDlpPlaybackSources(videoIds) {
      if (videoIds.length === 0) return

      preloadYtDlpPlaybackSources(videoIds, {
        concurrency: this.$store.getters.getYtDlpPreloadConcurrency,
        loadSource: videoId => getYtDlpPlaybackSource(
          videoId,
          this.ytDlpPlaybackCacheKey,
          undefined,
          this.alwaysUseYtDlpPlaybackCookies,
          false,
          true
        )
      }).catch(error => {
        console.warn('Could not preload upcoming yt-dlp playback sources', error)
      })
    },
    updateUpcomingTimestamp: function () {
      if (!(this.premiereDate instanceof Date)) return

      const dateOptions = {
        month: 'long',
        day: 'numeric',
      }
      if (new Date().getFullYear() < this.premiereDate.getFullYear()) {
        dateOptions.year = 'numeric'
      }

      this.upcomingTimestamp = formatDateTime(
        this.premiereDate,
        this.currentLocale,
        this.dateFormatPreference,
        dateOptions,
        { hour: 'numeric', minute: '2-digit' },
        this.timeFormatPreference
      )
    },
    async updateVideoMetadataCache() {
      if (
        !this.enableVideoMetadataCache ||
        this.isLoading ||
        !this.hasResolvedVideoTitle ||
        (this.localFilePlayback && !this.channelId) ||
        typeof window.ftElectron?.videoMetadataCache?.update !== 'function'
      ) {
        return
      }

      const loadGeneration = this.videoLoadGeneration
      const videoId = this.videoId

      try {
        const history = await window.ftElectron.videoMetadataCache.update({
          videoId,
          title: this.videoTitle,
          description: this.videoDescription ?? '',
          thumbnailUrl: this.thumbnail ?? '',
          observedAt: Date.now()
        })

        if (
          this.isCurrentVideoLoad(loadGeneration, videoId) &&
          this.enableVideoMetadataCache
        ) {
          this.videoMetadataHistory = history
        }
      } catch (error) {
        console.error('Failed to update the video metadata cache', error)
      }
    },

    clearLiveReminderStartTimer() {
      if (this.liveReminderStartTimer !== null) {
        clearTimeout(this.liveReminderStartTimer)
        this.liveReminderStartTimer = null
      }
    },
    scheduleLiveReminderStartInvalidation() {
      this.clearLiveReminderStartTimer()
      const now = Date.now()
      this.liveReminderNow = now
      if (!(this.premiereDate instanceof Date)) return

      const delay = this.premiereDate.getTime() - now
      if (delay <= 0) return

      this.liveReminderStartTimer = setTimeout(() => {
        this.liveReminderStartTimer = null
        this.scheduleLiveReminderStartInvalidation()
      }, Math.min(delay + 1, MAX_TIMEOUT_DELAY))
    },
    getLiveReminderPayload() {
      return {
        videoId: this.videoId,
        startTimestamp: this.premiereDate.getTime(),
        notificationTitle: this.t('Video.Scheduled video starting'),
        notificationBody: this.t('Video.Live notification body', { videoTitle: this.videoTitle })
      }
    },
    async syncLiveReminder(loadGeneration, videoId) {
      if (!this.canToggleLiveReminder) return

      const startTimestamp = this.premiereDate.getTime()
      const reminder = await liveReminder.get(videoId)
      if (
        !this.isCurrentVideoLoad(loadGeneration, videoId) ||
        !(this.premiereDate instanceof Date) ||
        this.premiereDate.getTime() !== startTimestamp
      ) {
        return
      }

      if (reminder && reminder.startTimestamp !== startTimestamp) {
        const scheduled = await liveReminder.schedule(this.getLiveReminderPayload())
        if (
          !this.isCurrentVideoLoad(loadGeneration, videoId) ||
          !(this.premiereDate instanceof Date) ||
          this.premiereDate.getTime() !== startTimestamp
        ) {
          return
        }
        this.liveReminderActive = scheduled
      } else {
        this.liveReminderActive = reminder !== null
      }
    },
    async toggleLiveReminder() {
      if (this.liveReminderLoading || !this.canToggleLiveReminder) return

      const videoId = this.videoId
      this.liveReminderLoading = true
      try {
        if (this.liveReminderActive) {
          await liveReminder.cancel(videoId)
          if (videoId !== this.videoId) return
          this.liveReminderActive = false
          this.showTabToast({
            message: this.t('Video.Notification cancelled'),
            icon: ['fas', 'calendar-days']
          })
        } else {
          const scheduled = await liveReminder.schedule(this.getLiveReminderPayload())
          if (videoId !== this.videoId) return
          this.liveReminderActive = scheduled
          this.showTabToast({
            message: scheduled
              ? this.t('Video.Notification enabled')
              : this.t('Video.Notification unavailable'),
            icon: ['fas', 'calendar-days']
          })
        }
      } catch (error) {
        console.error('Failed to update live stream reminder', error)
        if (videoId === this.videoId) {
          this.showTabToast({
            message: this.t('Video.Notification unavailable'),
            icon: ['fas', 'calendar-days']
          })
        }
      } finally {
        if (videoId === this.videoId) {
          this.liveReminderLoading = false
        }
      }
    },
    updateTheatreLayoutAvailability() {
      this.theatreLayoutAvailable = window.innerWidth > RESPONSIVE_THEATRE_MODE_MAX_WIDTH
    },
    updateShortsViewportHeight() {
      this.shortsViewportHeight = window.innerHeight
      if (this.shortsAuxPanelOpen) {
        this.clampShortsAuxPanelScroll()
      }
    },
    handleFullscreenMetadataChange({ open, target, presentationActive = false }) {
      const wasOpen = this.fullscreenMetadataOpen
      this.fullscreenMetadataTarget = target
      this.fullscreenMetadataOpen = open && target !== null

      if (this.customShortsPlayerActive && presentationActive) {
        this.shortsMetadataOpen = this.fullscreenMetadataOpen
        this.clampShortsAuxPanelScroll()
      }

      if (this.fullscreenMetadataOpen) {
        this.$nextTick(() => {
          if (!wasOpen) restoreOverlayScrollTop(target, 0)
          if (this.showTranscript && !this.fullscreenTranscriptOpen) {
            this.$refs.player?.setFullscreenTranscript(true)
          }
          if (this.showSidebarSponsorBlock && !this.fullscreenSponsorBlockOpen) {
            this.$refs.player?.setFullscreenSponsorBlock(true)
          }
        })
      }
    },
    toggleFullscreenMetadata() {
      this.$refs.player?.setFullscreenMetadata(!this.fullscreenMetadataOpen)
    },
    handleFullscreenTranscriptChange({ open, target }) {
      this.fullscreenTranscriptTarget = target
      this.fullscreenTranscriptOpen = open && target !== null
    },
    handleFullscreenSponsorBlockChange({ open, target }) {
      this.fullscreenSponsorBlockTarget = target
      this.fullscreenSponsorBlockOpen = open && target !== null
    },
    handleFullscreenCommentsChange({ open, target }) {
      this.fullscreenCommentsTarget = open ? target : null
      this.fullscreenCommentsOpen = open && target !== null
    },
    handleFullscreenLiveChatChange({ open, target }) {
      this.fullscreenLiveChatTarget = open ? target : null
      this.fullscreenLiveChatOpen = open && target !== null
      if (this.fullscreenLiveChatOpen) {
        this.liveChatOpen = true
      }
    },
    closeFullscreenLiveChat() {
      this.$refs.player?.closeFullscreenLiveChat()
    },
    closeLiveChat() {
      this.liveChatOpen = false
      this.closeFullscreenLiveChat()
    },
    toggleLiveChat() {
      if (this.liveChatOpen) {
        this.closeLiveChat()
      } else {
        this.liveChatOpen = true
      }
    },
    closeFullscreenComments() {
      if (this.fullscreenCommentsOpen) {
        this.$refs.player?.closeFullscreenComments()
        return
      }
      this.shortsCommentsOpen = false
    },
    handleFullscreenPlaylistChange({ open, target }) {
      const playlist = this.$refs.watchVideoPlaylist
      const sourceLayout = this.fullscreenPlaylistOpen ? 'fullscreen' : 'sidebar'
      const destinationLayout = open && target !== null ? 'fullscreen' : 'sidebar'

      this.playlistScrollPositions[sourceLayout] = playlist?.getScrollTop() ?? 0
      this.fullscreenPlaylistTarget = target
      this.fullscreenPlaylistOpen = open && target !== null
      this.$nextTick(() => {
        const scrollTop = this.playlistScrollPositions[destinationLayout]
        if (scrollTop == null) {
          playlist?.centerCurrentVideo()
        } else {
          playlist?.restoreScrollTop(scrollTop)
        }
      })
    },
    async toggleCurrentVideoQuickBookmarked() {
      if (!this.isQuickBookmarkEnabled) { return }

      const playlistName = this.quickBookmarkPlaylist.playlistName

      if (this.isCurrentVideoQuickBookmarked) {
        const removed = await this.$store.dispatch('removeVideo', {
          _id: this.quickBookmarkPlaylist._id,
          videoId: this.videoId
        })
        showToast({
          message: removed
            ? this.$t('Video.Video has been removed from {playlistName}', { playlistName })
            : this.$t('Video.There was a problem removing the video from {playlistName}', { playlistName }),
          image: this.toastThumbnail,
          icon: ['fas', 'trash'],
        })
        return
      }

      const saved = await this.$store.dispatch('addVideo', {
        _id: this.quickBookmarkPlaylist._id,
        videoData: {
          videoId: this.videoId,
          title: this.videoTitle,
          author: this.channelName,
          authorId: this.channelId,
          lengthSeconds: this.videoLengthSeconds,
          published: this.videoPublished,
          premiereDate: this.premiereDate
        }
      })
      showToast({
        message: saved
          ? this.$t('Video.Video has been saved to {playlistName}', { playlistName })
          : this.$t('Video.There was a problem saving the video to {playlistName}', { playlistName }),
        image: this.toastThumbnail,
        icon: ['fas', 'bookmark'],
      })
    },
    handleChaptersOverlayChange(open) {
      const shouldUseDefaultTheatreMode = open && !this.theatrePossible &&
        this.defaultViewingMode === 'theatre'

      if (!open && this.showSidebarChapters) {
        this.sidebarPanelLeaving = true
      }
      this.showSidebarChapters = open

      if (shouldUseDefaultTheatreMode) {
        this.useTheatreMode = true
      }
    },
    handleChapterThumbnailsChange(thumbnails) {
      this.videoChapterThumbnails = thumbnails
    },
    handleSponsorBlockInfoChange({
      open,
      loading,
      pendingUuid,
      segments,
      submissionEnabled,
      contributionStats,
      contributionStatsError,
      contributionStatsLoaded,
      contributionStatsLoading,
    }) {
      if (!open && this.showSidebarSponsorBlock) {
        this.sidebarPanelLeaving = true
      }
      this.showSidebarSponsorBlock = open
      this.sponsorBlockInfoLoading = loading
      this.sponsorBlockInfoPendingUuid = pendingUuid
      this.sponsorBlockInfoSegments = segments
      this.sponsorBlockInfoSubmissionEnabled = submissionEnabled
      this.sponsorBlockContributionStats = contributionStats
      this.sponsorBlockContributionStatsError = contributionStatsError
      this.sponsorBlockContributionStatsLoaded = contributionStatsLoaded
      this.sponsorBlockContributionStatsLoading = contributionStatsLoading

      if (!open && this.customShortsPlayerActive) {
        this.clampShortsAuxPanelScroll()
      }

      if (open && this.fullscreenMetadataOpen && !this.fullscreenSponsorBlockOpen) {
        this.$nextTick(() => this.$refs.player?.setFullscreenSponsorBlock(true))
      } else if (!open && this.fullscreenSponsorBlockOpen) {
        this.$refs.player?.closeFullscreenSponsorBlock()
      }
    },
    closeSidebarSponsorBlock() {
      this.$refs.player?.closeSponsorBlockInfo()
    },
    toggleSponsorBlockInfo() {
      if (this.customShortsPlayerActive && !this.showSidebarSponsorBlock) {
        this.resetShortsAuxPanelScroll()
        this.shortsMetadataOpen = false
        if (this.showTranscript) {
          this.closeTranscript()
        }
        this.closeShortsComments()
      }
      this.$refs.player?.toggleSponsorBlockInfo()
    },
    toggleTranscript() {
      if (!this.transcriptAvailable) {
        return
      }

      if (this.customShortsPlayerActive && !this.showTranscript) {
        this.resetShortsAuxPanelScroll()
        this.shortsMetadataOpen = false
        if (this.showSidebarSponsorBlock) {
          this.closeSidebarSponsorBlock()
        }
        this.closeShortsComments()
      }
      if (this.showTranscript) {
        this.sidebarPanelLeaving = true
      }
      this.showTranscript = !this.showTranscript
      if (this.showTranscript && this.fullscreenMetadataOpen) {
        this.$nextTick(() => this.$refs.player?.setFullscreenTranscript(true))
      } else if (!this.showTranscript) {
        this.$refs.player?.dismissFullscreenTranscript()
        this.clampShortsAuxPanelScroll()
      }
    },
    closeTranscript() {
      if (this.showTranscript) {
        this.sidebarPanelLeaving = true
      }
      this.showTranscript = false
      this.$refs.player?.dismissFullscreenTranscript()
      this.clampShortsAuxPanelScroll()
    },
    closeShortsComments() {
      this.shortsCommentsOpen = false
    },
    toggleShortsMetadata() {
      const shouldOpen = !this.shortsMetadataOpen
      if (shouldOpen) {
        this.resetShortsAuxPanelScroll()
      }
      this.shortsMetadataOpen = shouldOpen

      if (!shouldOpen) {
        this.clampShortsAuxPanelScroll()
      }

      if (shouldOpen) {
        if (this.showTranscript) {
          this.closeTranscript()
        }
        if (this.showSidebarSponsorBlock) {
          this.closeSidebarSponsorBlock()
        }
        this.closeShortsComments()
      }
    },
    resetShortsAuxPanelScroll() {
      const target = this.$refs.shortsAuxPanelTarget
      if (target != null) {
        restoreOverlayScrollTop(target, 0)
        this.$nextTick(() => {
          requestAnimationFrame(() => restoreOverlayScrollTop(target, 0))
        })
      }
    },
    clampShortsAuxPanelScroll() {
      this.$nextTick(() => {
        requestAnimationFrame(() => {
          const target = this.$refs.shortsAuxPanelTarget
          const content = this.$refs.shortsAuxPanelContentEnd
          if (target != null && content != null) {
            clampOverlayScrollTop(target, content)
          }
        })
      })
    },
    handleSidebarPanelBeforeLeave() {
      this.sidebarPanelLeaving = true
    },
    handleSidebarPanelAfterLeave() {
      this.sidebarPanelLeaving = false
    },
    closeFullscreenPlaylist() {
      this.$refs.player?.closeFullscreenPlaylist()
    },
    refreshSponsorBlockInfo() {
      this.$refs.player?.refreshSponsorBlockInfo()
    },
    voteOnSponsorBlockInfoSegment(uuid, vote) {
      this.$refs.player?.voteOnSponsorBlockInfoSegment(uuid, vote)
    },
    skipSponsorBlockInfoSegment(uuid) {
      this.$refs.player?.skipSponsorBlockInfoSegment(uuid)
    },
    closeSidebarChapters() {
      if (this.showSidebarChapters) {
        this.sidebarPanelLeaving = true
      }
      this.showSidebarChapters = false
    },
    copyChapterTimestamp(startSeconds) {
      this.$refs.player?.copyChapterTimestamp(startSeconds)
    },
    async toggleTheatreMode() {
      const layout = this.$refs.videoLayout
      const elements = [
        layout.querySelector('.videoPlayer'),
        layout.querySelector('.infoArea'),
        layout.querySelector('.sidebarArea'),
        layout.querySelector('.commentsArea')
      ].filter(element => element !== null)

      this.theatreModeAnimations.forEach(animation => animation.cancel())
      this.theatreModeAnimations = []

      if (isReducedMotionEnabled()) {
        this.useTheatreMode = !this.useTheatreMode
        return
      }

      const previousRects = elements.map(element => element.getBoundingClientRect())
      this.useTheatreMode = !this.useTheatreMode
      await this.$nextTick()

      this.theatreModeAnimations = elements.map((element, index) => {
        const previousRect = previousRects[index]
        const nextRect = element.getBoundingClientRect()
        const translateX = previousRect.left - nextRect.left
        const translateY = previousRect.top - nextRect.top
        const isVideoPlayer = element.classList.contains('videoPlayer')
        const scaleX = isVideoPlayer ? previousRect.width / nextRect.width : 1
        const scaleY = isVideoPlayer ? previousRect.height / nextRect.height : 1
        const animation = applyAnimationSpeed(element.animate([
          {
            transform: `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`,
            transformOrigin: 'top left'
          },
          {
            transform: 'none',
            transformOrigin: 'top left'
          }
        ], {
          duration: THEATRE_MODE_ANIMATION_DURATION,
          easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
        }))

        animation.addEventListener('finish', () => {
          this.theatreModeAnimations = this.theatreModeAnimations.filter(item => item !== animation)
        })
        return animation
      })
    },

    activateWatchRuntime() {
      if (this.isTabPresented === false) {
        return
      }

      if (this.subscriptionShortsFeedActive) {
        this.shortsScrollResetPending = false
        this.shortsLastWindowScrollY = window.scrollY
        requestAnimationFrame(() => {
          if (this.isCurrentlyPresented()) {
            this.shortsLastWindowScrollY = window.scrollY
          }
        })
      }

      document.removeEventListener('keydown', this.resetAutoplayInterruptionTimeout)
      document.removeEventListener('click', this.resetAutoplayInterruptionTimeout)
      document.addEventListener('keydown', this.resetAutoplayInterruptionTimeout)
      document.addEventListener('click', this.resetAutoplayInterruptionTimeout)
      this.resetAutoplayInterruptionTimeout()
    },

    deactivateWatchRuntime() {
      document.removeEventListener('keydown', this.resetAutoplayInterruptionTimeout)
      document.removeEventListener('click', this.resetAutoplayInterruptionTimeout)
      this.abortAutoplayCountdown(true)
    },

    async cleanupWatchRuntime() {
      this.$store.commit('setCurrentWatchTimestamp', { tabId: this.tabId, value: null })
      await this.handleRouteChange()
      window.removeEventListener('beforeunload', this.handleWatchProgressAutoSave)
      window.removeEventListener('beforeunload', this.flushWatchTime)
      this.deactivateWatchRuntime()

      if (this.$refs.player) {
        await this.destroyPlayer()
      }
    },

    async reloadView({ preserveTitle = false } = {}) {
      const loadGeneration = ++this.videoLoadGeneration
      this.preparingVideoLoadGeneration = loadGeneration
      const requestedVideoId = this.tabRoute.params.id
      this.loadingTheatreMode = this.useTheatreMode
      preserveTitle ||= this.preserveTitleOnNextReload
      this.preserveTitleOnNextReload = false

      try {
        await this.handleRouteChange()
        if (!this.isCurrentVideoLoad(loadGeneration, requestedVideoId)) { return }

        if (this.$refs.player) {
          await this.destroyPlayer()
          if (!this.isCurrentVideoLoad(loadGeneration, requestedVideoId)) { return }
        }

        // react to route changes...
        const previousVideoId = this.videoId
        this.videoId = this.tabRoute.params.id
        const videoIdChanged = this.videoId !== previousVideoId
        if (videoIdChanged) {
          this.useCustomShortsPlayerForCurrentVideo = this.$store.getters.getUseCustomShortsPlayer
          this.ipBlockRecoveryAttemptedForCurrentVideo = false
          this.androidHttpErrorRecoveryAttemptedForCurrentVideo = false
          this.streamErrorReloadAttemptedForCurrentVideo = false
          this.playbackEngineFallbackAttemptedForCurrentVideo = false
          this.playbackEngineFallbackTarget = null
          this.ytDlpDefaultClientsFallbackToastShown = false
          this.sabrErrorRecoveryAttempts = 0
          this.sabrErrorRecoveriesForCurrentVideo = 0
          this.sabrErrorRecoveryLastSeconds = null
          this.sabrErrorRecoveryPlayedSeconds = 0
        }
        this.ipBlockDetectedInCurrentChain = false
        const preserveShortsPanels = videoIdChanged &&
          this.customShortsPlayerActive &&
          this.tabRoute.query.short === 'true'
        this.resetVideoState({
          preserveTitle,
          placeholderTitle: videoIdChanged ? this.getPendingVideoTitle() : '',
          preserveShortsPanels,
        })
      } finally {
        if (this.preparingVideoLoadGeneration === loadGeneration) {
          this.preparingVideoLoadGeneration = null
        }
      }

      this.firstLoad = true
      this.videoPlayerLoaded = false
      // Re-evaluate per video: this instance is reused across same-tab
      // navigation, so a tab that was presented for the previous video must not
      // keep that state while it loads the next one in the background.
      this.hasBeenPresented = this.isCurrentlyPresented()
      this.activeFormat = this.defaultVideoFormat

      this.checkIfTimestamp()
      this.checkIfPlaylist()
      this.setViewingModeOnRouteChange()

      switch (this.backendPreference) {
        case 'local':
          await this.getVideoInformationLocal(loadGeneration)
          break
        case 'invidious':
          this.getVideoInformationInvidious(loadGeneration)
          break
      }
    },

    getPendingVideoTitle: function () {
      const tab = this.$store.getters.getTabById(this.tabId)
      const entry = tab?.history[tab.historyIndex]
      const title = tab?.contentTitle
      return entry?.titlePending !== true &&
        typeof title === 'string' &&
        title.length > 0 &&
        title !== this.tabRoute.fullPath
        ? title
        : this.tabRoute.fullPath
    },

    resetVideoState: function ({
      preserveTitle = false,
      placeholderTitle = '',
      preserveShortsPanels = false,
    } = {}) {
      const previousVideoTitle = this.videoTitle

      // A preserved title belongs to the previous successful request. Keep it
      // visible during a reload, but require the current request to resolve its
      // own metadata before it can be cached.
      this.hasResolvedVideoTitle = false
      if (!preserveShortsPanels) {
        this.shortsCommentsOpen = false
      }
      this.playlistScrollPositions.sidebar = null
      this.playlistScrollPositions.fullscreen = null
      this.isLoading = true
      this.isFamilyFriendly = null
      this.commentsDisabled = false
      this.isLive = false
      this.isPremiere = false
      this.liveChat = null
      this.liveChatIsReplay = false
      this.liveChatOpen = true
      this.isLiveContent = false
      this.isUpcoming = false
      this.isPostLiveDvr = false
      this.isUnlisted = false
      this.isShort = this.tabRoute.query.short === 'true'
      this.videoAspectRatio = this.isShort ? 9 / 16 : null
      this.shortsLinkedVideo = null
      this.shortsPlaybackCompleted = false
      this.shortsCompletionBlockedBySeek = false
      this.shortsPlaybackAfterSeekSeconds = 0
      this.hasAiGeneratedContent = false
      this.hasPaidPromotion = false
      this.paidPromotionDurationMs = 10000
      this.upcomingTimestamp = null
      this.upcomingTimeLeft = null
      this.clearLiveReminderStartTimer()
      this.liveReminderNow = Date.now()
      this.liveReminderActive = false
      this.liveReminderLoading = false
      this.thumbnail = ''
      this.videoTitle = preserveTitle ? previousVideoTitle : placeholderTitle
      this.videoDescription = ''
      this.videoDescriptionHtml = ''
      this.videoMetadataHistory = null
      this.videoCategory = ''
      this.videoTags = []
      this.videoGames = []
      this.license = ''
      this.videoViewCount = 0
      this.videoLikeCount = 0
      this.videoDislikeCount = 0
      this.videoLengthSeconds = 0
      this.videoChapters = []
      this.videoCurrentChapterIndex = 0
      this.videoChaptersKind = 'chapters'
      this.channelName = ''
      this.channelThumbnail = ''
      this.channelId = ''
      this.channelCollaborators = []
      this.channelSubscriptionCountText = ''
      this.videoPublished = 0
      this.premiereDate = undefined
      this.videoStoryboardSrc = ''
      this.videoAnnotations = []
      this.manifestSrc = null
      this.manifestMimeType = MANIFEST_TYPE_DASH
      this.sabrData = null
      this.androidBackgroundRestoreFormat = null
      this.activePlaybackEngine = 'built-in'
      this.activePlaybackEngineVersion = null
      this.onlinePlaybackSource = null
      this.localPlaybackDownloadId = null
      this.sabrPlaybackLoaded = false
      this.builtInPlaybackSource = null
      this.ytDlpStreamsPending = false
      this.legacyFormats = []
      this.localFilePlayback = false
      this.captions = []
      this.captionTranslations = []
      this.currentTime = 0
      if (!preserveShortsPanels) {
        this.showTranscript = false
        this.shortsMetadataOpen = false
      }
      this.showSidebarChapters = false
      this.videoChapterThumbnails = []
      this.vrProjection = null
      this.recommendedVideos = []
      this.playabilityStatus = ''
      this.adEndTimeUnixMs = 0
      this.errorMessage = null
      this.customErrorIcon = null
      this.restrictedPlaybackError = null
      this.nonRetryablePlaybackError = null
      this.videoGenreIsMusic = false
      this.musicMediaType = MUSIC_MEDIA_TYPE.UNKNOWN
      this.streamingDataExpiryDate = null
      this.ipBlockDetectedInCurrentChain = false
      // Cleared until the new player reports its ready state; otherwise the
      // manual save actions could persist the previous video's values.
      this.currentSubtitlesState = null
      this.currentVolume = null
      if (!preserveTitle) {
        this.resumePlaybackAfterSabrReload = false
        this.suppressAutoplayAfterSabrReload = false
        this.sabrReloadCaptionIndex = null
        this.sabrReloadPlaybackRate = null
        this.sabrReloadVideoQuality = null
        this.updateTitle()
      }
    },

    /**
     * Keeps the normal online metadata while replacing its streaming formats
     * with a completed file selected from the Downloads page.
     */
    applyDownloadedPlaybackSource: function (downloadId = Number(this.tabRoute.query.downloadId)) {
      if (!Number.isInteger(downloadId)) return false

      const download = this.$store.getters.getYtDlpDownloads[downloadId]
      const file = (download?.status === 'completed' || (process.env.IS_CAPACITOR && download?.status === 'failed')) && ['video', 'audio'].includes(download.mode)
        ? download.files?.find(file => file.videoId === this.videoId && file.available !== false)
        : null
      if (!file) return false

      const extension = file.extension ?? file.path.split('.').at(-1)?.toLowerCase() ?? ''
      const mimeType = download.mode === 'audio' && extension === 'webm'
        ? 'audio/webm'
        : download.mode === 'audio' && extension === 'mp4'
          ? 'audio/mp4'
          : DOWNLOADED_MEDIA_MIME_TYPES[extension]
      if (mimeType === undefined) return false

      this.cacheOnlinePlaybackSource()
      this.sabrData = null
      // Android uses the native player, which reads content URIs directly.
      const url = process.env.IS_CAPACITOR ? file.path : `downloadmedia://file/${downloadId}/${this.videoId}`
      if (download.mode === 'audio') {
        this.manifestSrc = url
        this.manifestMimeType = mimeType
        this.legacyFormats = []
        this.activeFormat = 'audio'
      } else {
        const hasDimensions = Number.isInteger(file.width) && Number.isInteger(file.height)
        this.manifestSrc = null
        this.legacyFormats = [{
          itag: 0,
          qualityLabel: hasDimensions
            ? `${file.width}×${file.height} • ${this.t('Downloads.Local File')}`
            : this.t('Downloads.Local File'),
          fps: null,
          bitrate: 0,
          mimeType,
          height: file.height ?? 0,
          width: file.width ?? 0,
          localFile: true,
          localFileLabel: this.t('Downloads.Local File'),
          url
        }]
        this.activeFormat = 'legacy'
      }
      if (Number.isFinite(file.duration) && file.duration > 0) {
        this.videoLengthSeconds = file.duration
      }
      this.thumbnail = download.thumbnail || this.thumbnail
      if (this.errorMessage) {
        const fileName = file.path.split(/[/\\]/).at(-1)?.replace(/\.[^.]+$/, '') ?? this.videoId
        this.videoTitle = download.videoId === this.videoId ? download.title : fileName
        this.hasResolvedVideoTitle = true
        this.errorMessage = null
        this.isLoading = false
        this.updateTitle()
      }
      this.streamingDataExpiryDate = null
      this.activePlaybackEngine = 'built-in'
      this.activePlaybackEngineVersion = null
      this.localFilePlayback = true
      this.localPlaybackDownloadId = downloadId
      this.playbackSourceKey++
      return file
    },

    cacheOnlinePlaybackSource: function () {
      if (
        this.localFilePlayback ||
        (this.manifestSrc === null && this.legacyFormats.length === 0)
      ) return

      this.onlinePlaybackSource = {
        manifestSrc: this.manifestSrc,
        manifestMimeType: this.manifestMimeType,
        sabrData: this.sabrData,
        legacyFormats: this.legacyFormats,
        streamingDataExpiryDate: this.streamingDataExpiryDate,
        activeFormat: this.activeFormat,
        activePlaybackEngine: this.activePlaybackEngine,
        activePlaybackEngineVersion: this.activePlaybackEngineVersion,
        hasBeenLoaded: this.sabrPlaybackLoaded
      }
    },

    restoreOnlinePlaybackSource: function () {
      const source = this.onlinePlaybackSource
      if (
        source === null ||
        (source.manifestSrc === null && source.legacyFormats.length === 0) ||
        (
          source.streamingDataExpiryDate !== null &&
          new Date() > source.streamingDataExpiryDate
        )
      ) return false

      this.manifestSrc = source.manifestSrc
      this.manifestMimeType = source.manifestMimeType
      this.sabrData = source.sabrData
      this.legacyFormats = source.legacyFormats
      this.streamingDataExpiryDate = source.streamingDataExpiryDate
      this.activeFormat = source.manifestMimeType === MANIFEST_TYPE_SABR &&
        !source.hasBeenLoaded && source.legacyFormats.length > 0
        ? 'legacy'
        : source.activeFormat
      this.activePlaybackEngine = source.activePlaybackEngine
      this.activePlaybackEngineVersion = source.activePlaybackEngineVersion
      this.localFilePlayback = false
      this.localPlaybackDownloadId = null
      this.playbackSourceKey++
      return true
    },

    playbackSourceRouteBase: function (fullPath) {
      const url = new URL(fullPath, 'https://opentubex.invalid')
      url.searchParams.delete('downloadId')
      return `${url.pathname}${url.search}${url.hash}`
    },

    watchRouteWithoutTimestamp: function (fullPath) {
      const url = new URL(fullPath, 'https://opentubex.invalid')
      url.searchParams.delete('timestamp')
      return `${url.pathname}${url.search}${url.hash}`
    },

    replacePlaybackSourceRoute: async function (downloadId = null) {
      const query = { ...this.tabRoute.query }
      if (downloadId === null) {
        delete query.downloadId
      } else {
        query.downloadId = String(downloadId)
      }

      const location = { path: this.tabRoute.path, query }
      const fullPath = this.tabRouter.resolve(location).fullPath
      if (fullPath === this.tabRoute.fullPath) return

      await this.tabRouter.replace(location)
      await this.$nextTick()
      this.updateTitle()
    },

    finishDownloadedPlaybackWithoutMetadata: function () {
      const file = this.applyDownloadedPlaybackSource()
      if (!file) return false

      const download = this.$store.getters.getYtDlpDownloads[this.localPlaybackDownloadId]
      const fileName = file.path.split(/[/\\]/).at(-1)?.replace(/\.[^.]+$/, '') ?? this.videoId
      this.videoTitle = download.videoId === this.videoId ? download.title : fileName
      this.hasResolvedVideoTitle = true
      this.thumbnail = download.thumbnail || this.thumbnail
      this.errorMessage = null
      this.isLoading = false
      this.updateTitle()
      return true
    },

    onMountedDependOnLocalStateLoading() {
      // Prevent running twice
      if (this.onMountedRun) { return }
      // Stuff that require user playlists to be ready
      if (this.isUserPlaylistRequested && !this.userPlaylistsReady) { return }

      this.onMountedRun = true

      this.checkIfPlaylist()

      // this has to be below checkIfPlaylist() as theatrePossible needs to know if there is a playlist or not
      this.setViewingModeOnFirstLoad()

      const loadGeneration = ++this.videoLoadGeneration
      if (!process.env.SUPPORTS_LOCAL_API || this.backendPreference === 'invidious') {
        this.getVideoInformationInvidious(loadGeneration)
      } else {
        this.getVideoInformationLocal(loadGeneration)
      }

      window.addEventListener('beforeunload', this.handleWatchProgressAutoSave)
      window.addEventListener('beforeunload', this.flushWatchTime)
      if (!process.env.IS_ELECTRON) {
        this.activateWatchRuntime()
      }
    },

    setViewingModeOnFirstLoad: function () {
      switch (this.defaultViewingMode) {
        case 'theatre':
          if (this.theatreTogglePossible) {
            this.useTheatreMode = true
          } else {
            // Live chat and other sidebar panels are only known after video
            // metadata loads. Re-evaluate once instead of permanently rejecting
            // the configured default based on the empty loading state.
            this.applyDefaultTheatreModeAfterLoad = true
          }
          break
        case 'fullscreen':
        case 'fullscreen_always_on':
          this.startNextVideoInFullscreen = true
          break
        case 'fullwindow':
        case 'fullwindow_always_on':
          this.startNextVideoInFullwindow = true
          break
        case 'pip':
          this.startNextVideoInPip = true
      }
    },

    setViewingModeOnRouteChange: function () {
      switch (this.defaultViewingMode) {
        case 'fullscreen_always_on':
          this.startNextVideoInFullscreen = true
          break
        case 'fullwindow_always_on':
          this.startNextVideoInFullwindow = true
          break
      }
    },

    changeTimestamp: function (timestamp) {
      const player = this.$refs.player

      if (!this.isLoading && player?.hasLoaded) {
        player.setCurrentTime(timestamp)
      }
    },

    updateShortsPlayerState: function (duration, formats) {
      const shortQuery = this.tabRoute.query.short
      const explicit = shortQuery === 'true'
        ? true
        : shortQuery === 'false'
          ? false
          : null
      const sourceAspectRatio = getVideoAspectRatio(formats)
      this.isShort = isYouTubeShort({ explicit, duration, formats })

      this.videoAspectRatio = this.isShort
        ? sourceAspectRatio !== null && sourceAspectRatio <= 1
          ? sourceAspectRatio
          : 9 / 16
        : sourceAspectRatio
    },

    loadLocalShortLinkedVideo: async function (videoId) {
      try {
        const linkedVideo = await getLocalShortLinkedVideo(videoId)

        if (this.videoId === videoId && this.isShort) {
          this.shortsLinkedVideo = linkedVideo
        }
      } catch (error) {
        console.warn('Failed to load linked Shorts video metadata', error)
      }
    },

    navigateSubscriptionShort: function (offset) {
      if (
        !this.subscriptionShortsFeedActive ||
        Date.now() < this.shortsNavigationLockedUntil
      ) {
        return
      }

      const target = this.subscriptionShortsFeed[this.subscriptionShortsFeedIndex + offset]
      if (!target) {
        return
      }

      this.shortsTransitionDirection = Math.sign(offset)
      this.shortsTransitionPreview = getShortThumbnailUrl(
        target,
        this.backendPreference,
        this.currentInvidiousInstanceUrl,
        this.thumbnailPreference
      ) ?? ''
      this.shortsNavigationLockedUntil = Date.now() + 300
      const shortSource = this.tabRoute.query.shortSource === 'channel'
        ? 'channel'
        : 'subscriptions'
      this.tabRouter.push({
        path: `/watch/${target.videoId}`,
        query: {
          short: 'true',
          shortSource,
          ...(shortSource === 'channel'
            ? { shortChannelId: this.tabRoute.query.shortChannelId }
            : {}),
          oneTimeTimestamp: '0',
        }
      })
    },

    handleShortsWindowScroll: function () {
      const scrollY = window.scrollY

      const logicalTabSelected = !process.env.IS_ELECTRON ||
        this.tabId == null ||
        this.$store.getters.getActiveTabId === this.tabId

      if (
        !this.subscriptionShortsFeedActive ||
        !this.isCurrentlyPresented() ||
        !logicalTabSelected
      ) {
        this.shortsLastWindowScrollY = scrollY
        return
      }

      if (this.shortsScrollResetPending) {
        this.shortsScrollResetPending = false
        this.shortsLastWindowScrollY = scrollY
        return
      }

      if (Math.abs(scrollY - this.shortsLastWindowScrollY) < 4) {
        this.shortsLastWindowScrollY = scrollY
        return
      }

      const movedDown = scrollY > this.shortsLastWindowScrollY
      this.shortsLastWindowScrollY = scrollY

      // The document starts at its upper boundary, so native document
      // scrolling can only intentionally advance the feed. A decrease is our
      // own reset or tab scroll restoration; wheel, touch, and keyboard input
      // handle navigation to the previous Short directly.
      if (!movedDown) {
        return
      }

      this.navigateSubscriptionShort(1)

      // The short preview deliberately gives the document a small scroll range
      // so the page scrollbar and middle-button autoscroll can navigate. Reset
      // it after interpreting the movement; otherwise the next movement at the
      // end of the range cannot emit another scroll event.
      if (window.scrollY !== 0) {
        this.shortsScrollResetPending = true
        window.scrollTo({ top: 0 })
      }
    },

    isShortsPanelEvent: function (event) {
      return Boolean(event.target?.closest?.(
        '.shortsCommentsPanel, .shortsAuxPanel, .shaka-no-propagation'
      ))
    },

    handleShortsWheel: function (event) {
      if (
        !this.subscriptionShortsFeedActive ||
        this.isShortsPanelEvent(event) ||
        Math.abs(event.deltaY) < 20
      ) {
        return
      }

      event.preventDefault()
      this.navigateSubscriptionShort(event.deltaY > 0 ? 1 : -1)
    },

    handleShortsPointerDown: function (event) {
      if (
        this.subscriptionShortsFeedActive &&
        !this.isShortsPanelEvent(event) &&
        event.pointerType === 'touch'
      ) {
        this.shortsTouchStartY = event.clientY
      } else {
        this.shortsTouchStartY = null
      }
    },

    handleShortsPointerUp: function (event) {
      if (
        this.shortsTouchStartY === null ||
        this.isShortsPanelEvent(event) ||
        event.pointerType !== 'touch'
      ) {
        this.shortsTouchStartY = null
        return
      }

      const distance = this.shortsTouchStartY - event.clientY
      this.shortsTouchStartY = null

      if (Math.abs(distance) >= 50) {
        this.navigateSubscriptionShort(distance > 0 ? 1 : -1)
      }
    },

    handleShortsNavigationKeydown: function (event) {
      if (
        !this.subscriptionShortsFeedActive ||
        !this.isCurrentlyPresented() ||
        this.shortsNavigationPanelOpen ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target?.tagName) ||
        event.target?.isContentEditable ||
        event.target?.closest?.('[role="dialog"], [role="menu"]')
      ) {
        return
      }

      if (event.key === 'ArrowDown' || event.key === 'PageDown') {
        event.preventDefault()
        this.navigateSubscriptionShort(1)
      } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault()
        this.navigateSubscriptionShort(-1)
      }
    },

    openShortsChannel: function (event) {
      if (!this.channelId || this.disableChannelLinks) {
        event?.preventDefault()
        return
      }

      this.openShortsInternalPath(event, {
        path: `/channel/${this.channelId}`,
        title: this.channelName
      })
    },

    openShortsLinkedVideo: function (event) {
      if (!this.shortsLinkedVideo?.videoId) {
        return
      }

      this.openShortsInternalPath(event, {
        path: `/watch/${this.shortsLinkedVideo.videoId}`,
        title: this.shortsLinkedVideo.title
      })
    },

    /**
     * Plain left clicks stay on the router-link. Electron needs this for
     * middle-click / Ctrl–Cmd / Shift so those open a tab or window.
     * @param {MouseEvent} event
     * @param {{ path: string, title: string }} destination
     */
    openShortsInternalPath: function (event, { path, title }) {
      if (!process.env.IS_ELECTRON) {
        return
      }

      const isMiddleClick = event?.type === 'auxclick' && event.button === 1
      const isModifiedClick = event?.type === 'click' &&
        (event.ctrlKey || event.metaKey || event.shiftKey)
      if (!isMiddleClick && !isModifiedClick) {
        return
      }

      event.preventDefault()
      openInternalPath({
        path,
        title,
        doCreateNewWindow: event.shiftKey,
        doCreateNewTab: !event.shiftKey,
        makeActive: !isMiddleClick
      })
    },

    toggleShortsComments: function () {
      if (this.shortsCommentsPanelOpen) {
        this.shortsCommentsOpen = false
        return
      }

      if (this.$refs.shortsCommentsTarget) {
        this.shortsMetadataOpen = false
        if (this.showTranscript) {
          this.closeTranscript()
        }
        if (this.showSidebarSponsorBlock) {
          this.closeSidebarSponsorBlock()
        }
        this.shortsCommentsOpen = true
      }
    },

    playTranscriptSegment: function (timestamp) {
      const player = this.$refs.player

      if (!this.isLoading && player?.hasLoaded) {
        player.setCurrentTime(timestamp)

        if (player.isPaused()) {
          player.play()
        }
      }
    },

    isCurrentVideoLoad: function (loadGeneration, videoId) {
      return loadGeneration === this.videoLoadGeneration &&
        videoId === this.tabRoute.params.id
    },

    isYtDlpPlaybackRequested: function () {
      return supportsYtDlp &&
        this.playbackEngineFallbackTarget !== 'built-in' &&
        (
          this.videoPlaybackEngine === 'yt-dlp' ||
          this.playbackEngineFallbackTarget === 'yt-dlp'
        )
    },

    setRestrictedPlaybackError: function (type) {
      this.restrictedPlaybackError = type
      this.errorMessage = type === 'members'
        ? this.t('Video.MembersOnly')
        : this.t('Video.AgeRestricted')
      this.customErrorIcon = type === 'members' ? ['fas', 'money-check-dollar'] : null

      if (this.hasConfiguredRestrictedPlaybackAuthentication) {
        this.tryCachedRestrictedPlayback(type).catch(error => {
          console.warn('Could not restore cached authenticated playback', error)
        })
      }
    },

    /**
     * Sets an error that switching stream extraction methods cannot resolve.
     * @param {'private' | 'drm'} type
     */
    setNonRetryablePlaybackError: function (type) {
      this.nonRetryablePlaybackError = type
      this.errorMessage = type === 'private'
        ? this.t('Video.Private')
        : this.t('Video.DRMProtected')
    },

    getRestrictedPlaybackErrorType: function (message) {
      if (typeof message !== 'string') {
        return null
      }

      const normalizedMessage = message.toLowerCase()
      if (
        normalizedMessage.includes('members-only') ||
        normalizedMessage.includes('members only') ||
        normalizedMessage.includes("available to this channel's members")
      ) {
        return 'members'
      }

      if (
        normalizedMessage.includes('age-restricted') ||
        normalizedMessage.includes('age restricted') ||
        normalizedMessage.includes('confirm your age')
      ) {
        return 'age'
      }

      return null
    },

    tryCachedRestrictedPlayback: async function (restrictedPlaybackError) {
      const loadGeneration = this.videoLoadGeneration
      const videoId = this.videoId
      const playbackEngineSwitchGeneration = this.playbackEngineSwitchGeneration
      const previousFallbackTarget = this.playbackEngineFallbackTarget

      const sourceApplied = await this.extractYtDlpPlaybackSource(
        loadGeneration,
        videoId,
        playbackEngineSwitchGeneration,
        true,
        true
      )

      if (!this.isCurrentVideoLoad(loadGeneration, videoId) ||
        playbackEngineSwitchGeneration !== this.playbackEngineSwitchGeneration ||
        this.restrictedPlaybackError !== restrictedPlaybackError) {
        return
      }

      if (sourceApplied) {
        this.restrictedPlaybackError = null
        this.playbackEngineFallbackTarget = null
      } else {
        this.playbackEngineFallbackTarget = previousFallbackTarget
      }
    },

    tryRestrictedPlaybackWithCookies: async function () {
      const restrictedPlaybackError = this.restrictedPlaybackError
      if (restrictedPlaybackError === null || !this.hasConfiguredRestrictedPlaybackAuthentication) {
        return
      }

      const loadGeneration = this.videoLoadGeneration
      const videoId = this.videoId
      const playbackEngineSwitchGeneration = ++this.playbackEngineSwitchGeneration
      this.errorMessage = null
      this.customErrorIcon = null
      this.playbackEngineFallbackTarget = 'yt-dlp'
      this.ytDlpStreamsPending = true
      this.ytDlpDefaultClientsFallbackToastShown = false

      try {
        const sourceApplied = await this.extractYtDlpPlaybackSource(
          loadGeneration,
          videoId,
          playbackEngineSwitchGeneration,
          true
        )

        if (!this.isCurrentVideoLoad(loadGeneration, videoId) ||
          playbackEngineSwitchGeneration !== this.playbackEngineSwitchGeneration) {
          return
        }

        if (sourceApplied) {
          this.restrictedPlaybackError = null
          this.playbackEngineFallbackTarget = null
          if (this.recommendedVideos.length === 0) {
            this.loadAuthenticatedYtDlpRecommendations(loadGeneration, videoId)
          }
        } else {
          this.setRestrictedPlaybackError(restrictedPlaybackError)
        }
      } catch (error) {
        if (this.isCurrentVideoLoad(loadGeneration, videoId) &&
          playbackEngineSwitchGeneration === this.playbackEngineSwitchGeneration) {
          console.error(`Authenticated yt-dlp playback failed for ${videoId}`, error)
          this.setRestrictedPlaybackError(restrictedPlaybackError)
          this.showTabToast({
            message: this.t('Video.Restricted Playback Authentication Failed Template', {
              error: error.message
            }),
            time: 7000,
            icon: ['fas', 'circle-exclamation']
          })
        }
      } finally {
        if (this.isCurrentVideoLoad(loadGeneration, videoId) &&
          playbackEngineSwitchGeneration === this.playbackEngineSwitchGeneration) {
          this.ytDlpStreamsPending = false
        }
      }
    },

    loadAuthenticatedYtDlpRecommendations: async function (loadGeneration, videoId) {
      try {
        const result = await ytDlp.ytDlpGetRecommendations(videoId)
        if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }

        if (result === null || 'error' in result) {
          if (result?.error) {
            console.warn('yt-dlp could not provide authenticated recommendations', result.error)
          }
          return
        }

        if (this.recommendedVideos.length === 0) {
          this.recommendedVideos = result.sort(this.sortWatchedVideosLast)
        }
      } catch (error) {
        console.warn('Could not load authenticated yt-dlp recommendations', error)
      }
    },

    getVideoInformationLocal: async function (loadGeneration = ++this.videoLoadGeneration) {
      if (this.firstLoad) {
        this.isLoading = true
      }

      const videoId = this.tabRoute.params.id
      await initializeNetworkRecovery().ready
      if (!this.isCurrentVideoLoad(loadGeneration, videoId)) return
      if (getConnectionState() === 'offline' && this.finishDownloadedPlaybackWithoutMetadata()) return

      try {
        const videoInfo = await getLocalVideoInfo(videoId)
        if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }

        const {
          info: result,
          poToken,
          clientInfo,
          adEndTimeUnixMs,
          paidPromotionDurationMs,
          isPremiere,
          watchPageIpBlocked,
          musicMediaType,
          androidLiveHlsManifestUrl,
        } = videoInfo

        this.musicMediaType = musicMediaType

        if (watchPageIpBlocked) {
          this.ipBlockDetectedInCurrentChain = true

          if (process.env.IS_ELECTRON && this.videoPlaybackEngine === 'built-in') {
            this.playbackEngineFallbackAttemptedForCurrentVideo = true
            this.playbackEngineFallbackTarget = 'yt-dlp'
            this.showTabToast({
              message: this.t('Change Format.Built-in Fallback Template', { error: this.t('Video.IP block') }),
              icon: ['fas', 'exchange-alt'],
            })
          }
        }

        const playabilityStatus = result.playability_status
        this.playabilityStatus = playabilityStatus.status

        if (playabilityStatus.status === 'LOGIN_REQUIRED' && playabilityStatus.error_screen?.reason?.text === 'Private video') {
          // Private videos cannot be played in FreeTube, as they require to be logged as the owner of the video
          // so there is no point continuing or trying any other backends as it will always fail
          this.setNonRetryablePlaybackError('private')
          this.thumbnail = this.getUnavailableVideoThumbnail()
          this.isLoading = false
          this.updateTitle()
          return
        }

        this.adEndTimeUnixMs = adEndTimeUnixMs
        this.hasPaidPromotion = paidPromotionDurationMs !== null
        this.paidPromotionDurationMs = paidPromotionDurationMs ?? 10000

        this.isFamilyFriendly = result.basic_info.is_family_safe
        this.commentsDisabled = areLocalCommentsDisabled(result)
        const avoidTranslation = this.$store.getters.getAvoidTranslation !== 'disabled'

        this.recommendedVideos = result.watch_next_feed
          ?.filter((item) => {
            return item.type === 'CompactVideo' || item.type === 'CompactMovie' ||
              (item.type === 'LockupView' && (item.content_type === 'VIDEO' || item.content_type === 'STATION'))
          })
          .map(parseLocalWatchNextVideo).filter(_ => _)
          // place watched recommended videos last
          .sort(this.sortWatchedVideosLast) ?? []

        this.videoAnnotations = parseLocalEndscreen(result.endscreen)
        if (avoidTranslation) {
          this.videoAnnotations = this.videoAnnotations.map((annotation) => {
            if (!annotation.videoId) {
              return annotation
            }

            const cachedTitle = getCachedOembedTitle(annotation.videoId)
            if (cachedTitle !== null) {
              return { ...annotation, title: cachedTitle }
            }

            getOembedTitle(annotation.videoId).then((title) => {
              if (!title || this.$store.getters.getAvoidTranslation === 'disabled' ||
                  !this.isCurrentVideoLoad(loadGeneration, videoId)) {
                return
              }

              this.videoAnnotations = this.videoAnnotations.map((currentAnnotation) =>
                currentAnnotation.id === annotation.id
                  ? { ...currentAnnotation, title }
                  : currentAnnotation
              )
            })

            return annotation
          })
        }

        if (this.showFamilyFriendlyOnly && this.isFamilyFriendly === false) {
          this.isLoading = false
          this.handleVideoEnded()
          return
        }

        if (avoidTranslation) {
          this.videoTitle = result.basic_info.title?.trim() ?? ''
        } else {
          // extract localised title first and fall back to the not localised one
          this.videoTitle = result.primary_info?.title?.text?.trim() ?? result.basic_info.title?.trim() ?? ''
        }
        this.hasResolvedVideoTitle = this.videoTitle.length > 0
        this.videoViewCount = result.basic_info.view_count ?? (result.primary_info.view_count ? extractNumberFromString(result.primary_info.view_count.text) : null)
        this.license = result.secondary_info.metadata.rows.find(element => element.title?.text === 'License')?.contents[0]?.text
        this.videoGames = parseLocalVideoGames(result)

        this.channelCollaborators = parseLocalVideoCollaborators(result)
        const primaryCollaborator = this.channelCollaborators[0]

        this.channelId = result.basic_info.channel_id ?? result.secondary_info.owner?.author.id ?? primaryCollaborator?.id ?? ''
        this.channelName = result.basic_info.author ?? result.secondary_info.owner?.author.name ?? primaryCollaborator?.name ?? ''
        this.channelThumbnail = primaryCollaborator?.thumbnail ?? result.secondary_info.owner?.author?.best_thumbnail?.url ?? ''
        this.$store.commit('setVideoAvatar', {
          videoId: this.videoId,
          avatar: this.channelThumbnail
        })
        this.setTabAvatar(this.channelThumbnail)

        this.videoCategory = result.basic_info.category ?? ''
        this.videoTags = result.basic_info.keywords ?? []
        this.videoGenreIsMusic = this.videoCategory === 'Music'

        this.updateSubscriptionDetails({
          channelThumbnailUrl: this.channelThumbnail.length === 0 ? null : this.channelThumbnail,
          channelName: this.channelName,
          channelId: this.channelId
        })

        this.initializePlaybackRate()
        this.initializeVideoQuality()

        let published
        if (result.page[0]?.microformat?.publish_date) {
          // `result.page[0].microformat.publish_date` example value: `2023-08-12T08:59:59-07:00`
          published = Date.parse(result.page[0].microformat.publish_date)
        } else {
          // text date Jan 1, 2000, not as accurate but better than nothing
          published = Date.parse(result.primary_info?.published)
        }
        this.videoPublished = Number.isFinite(published) ? published : 0

        if (avoidTranslation) {
          this.videoDescription = result.basic_info.short_description
        } else if (result.secondary_info?.description.runs) {
          try {
            this.videoDescription = parseLocalTextRuns(result.secondary_info.description.runs)
          } catch (error) {
            console.error('Failed to extract the localised description, falling back to the standard one.', error, JSON.stringify(result.secondary_info.description.runs))
            this.videoDescription = result.basic_info.short_description
          }
        } else {
          this.videoDescription = result.basic_info.short_description
        }

        switch (this.thumbnailPreference) {
          case 'start':
            this.thumbnail = `https://i.ytimg.com/vi/${this.videoId}/maxres1.jpg`
            break
          case 'middle':
            this.thumbnail = `https://i.ytimg.com/vi/${this.videoId}/maxres2.jpg`
            break
          case 'end':
            this.thumbnail = `https://i.ytimg.com/vi/${this.videoId}/maxres3.jpg`
            break
          default:
            this.thumbnail = result.basic_info.thumbnail?.[0].url ?? `https://i.ytimg.com/vi/${this.videoId}/maxresdefault.jpg`
            break
        }

        if (this.hideVideoLikesAndDislikes) {
          this.videoLikeCount = null
          this.videoDislikeCount = null
        } else {
          this.videoLikeCount = isNaN(result.basic_info.like_count) ? 0 : result.basic_info.like_count

          // YouTube doesn't return dislikes anymore
          this.videoDislikeCount = 0

          if (this.useReturnYouTubeDislikes) {
            this.fetchVideoDislikes()
          }
        }

        this.isLive = !!result.basic_info.is_live
        this.isUpcoming = !!result.basic_info.is_upcoming
        this.isLiveContent = !!result.basic_info.is_live_content
        this.isPremiere = isPremiere === true
        this.isPostLiveDvr = !!result.basic_info.is_post_live_dvr
        this.isUnlisted = !!result.basic_info.is_unlisted
        this.hasAiGeneratedContent = result.primary_info?.badges.some(badge => badge.label === 'AI') ?? false

        if (this.isLive && !this.isLiveContent) {
          this.videoPublished = result.basic_info.start_timestamp.getTime()
        }

        const subCount = !result.secondary_info.owner.subscriber_count.isEmpty() ? parseLocalSubscriberCount(result.secondary_info.owner.subscriber_count.text) : NaN

        if (!isNaN(subCount)) {
          this.channelSubscriptionCountText = formatNumber(subCount, subCount >= 10000 ? { notation: 'compact' } : undefined)
        } else {
          this.channelSubscriptionCountText = ''
        }

        let chapters = []
        let chaptersKind = 'chapters'
        if (!this.hideChapters) {
          const rawChapters = result.player_overlays?.decorated_player_bar?.player_bar?.markers_map
            ?.find(marker => marker.marker_key === 'DESCRIPTION_CHAPTERS')?.value.chapters

          if (rawChapters && !avoidTranslation) {
            for (const chapter of rawChapters) {
              const start = chapter.time_range_start_millis / 1000

              chapters.push({
                title: chapter.title.text,
                timestamp: formatDurationAsTimestamp(start),
                startSeconds: start,
                endSeconds: 0,
                thumbnail: chapter.thumbnail[0]
              })
            }
          } else {
            /** @type {import('youtubei.js').YTNodes.MacroMarkersList | null | undefined} */
            const macroMarkersList = result.page[1]?.engagement_panels
              ?.find(pannel => pannel.panel_identifier === 'engagement-panel-macro-markers-auto-chapters')?.content

            if (macroMarkersList && !avoidTranslation) {
              for (const item of macroMarkersList.contents) {
                if (item instanceof YTNodes.MacroMarkersListItem) {
                  chapters.push({
                    title: item.title.text,
                    timestamp: item.time_description.text,
                    startSeconds: Utils.timeToSeconds(item.time_description.text),
                    endSeconds: 0,
                    thumbnail: item.thumbnail[0]
                  })
                }
              }
              chaptersKind = 'keyMoments'
            } else {
              chapters = this.extractChaptersFromDescription(result.basic_info.short_description ?? result.secondary_info.description.text)
            }
          }

          if (chapters.length > 0) {
            this.finalizeChapters(chapters, result.basic_info.duration)
          } else {
            chapters = await this.getSponsorBlockCommunityChapters(result.basic_info.duration)
            if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }
          }
        }

        this.videoChapters = chapters
        this.videoChaptersKind = chaptersKind

        // The apostrophe is intentionally that one (char code 8217), because that is the one YouTube uses
        const BOT_MESSAGE = 'Sign in to confirm you’re not a bot'

        const isDrmProtected = result.streaming_data?.adaptive_formats.some(format => format.drm_families || format.drm_track_type)

        if (playabilityStatus.status === 'UNPLAYABLE' || playabilityStatus.status === 'LOGIN_REQUIRED' || isDrmProtected) {
          if (playabilityStatus.error_screen?.offer_id === 'sponsors_only_video') {
            this.setRestrictedPlaybackError('members')
          } else if (playabilityStatus.reason === 'Sign in to confirm your age' || (result.has_trailer && result.getTrailerInfo() === null)) {
            this.setRestrictedPlaybackError('age')
          } else if (isDrmProtected) {
            // DRM protected videos (e.g. movies) cannot be played in FreeTube,
            // as they require the proprietary and closed source Wideview CDM which is understandably not included in standard Electron builds
            this.setNonRetryablePlaybackError('drm')
            this.isLoading = false
            this.updateTitle()
            return
          }

          if (this.restrictedPlaybackError === null) {
            let errorText

            if (playabilityStatus.reason === BOT_MESSAGE || playabilityStatus.reason === 'Please sign in') {
              errorText = this.t('Video.IP block')
              this.ipBlockDetectedInCurrentChain = true
            } else {
              errorText = `[${playabilityStatus.status}] ${playabilityStatus.reason}`

              if (playabilityStatus.error_screen?.subreason) {
                errorText += `: ${playabilityStatus.error_screen.subreason.text}`
              }
            }

            const tryingYtDlpForIpBlock =
              this.isYtDlpPlaybackRequested() &&
              this.ipBlockDetectedInCurrentChain

            if (tryingYtDlpForIpBlock) {
              console.warn('Built-in metadata is IP blocked; continuing so yt-dlp can provide the playback source')
            } else if (this.backendFallback) {
              throw new Error(errorText)
            } else {
              const didReload = await this.runIpBlockRecoveryScriptAndReload()
              if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }
              if (didReload) {
                return
              }

              this.errorMessage = errorText
              this.isLoading = false
              this.updateTitle()
              return
            }
          }
        }

        // Streams that have ended keep their chat around as a replay, which is played back
        // in sync with the video instead of in real time.
        if (result.livechat && (this.isLive || this.isUpcoming || result.livechat.is_replay)) {
          this.liveChat = result.getLiveChat()
          this.liveChatIsReplay = this.liveChat.is_replay
        } else {
          this.liveChat = null
          this.liveChatIsReplay = false
        }

        if ((this.isLive || this.isPostLiveDvr) && !this.isUpcoming) {
          let useRemoteManifest = true

          if (this.isPostLiveDvr) {
            // I wasn't able to get SABR working with Post-Live-DVR yet, so for the moment we'll use YouTube's provided DASH manifest instead.
            // It only contains the last 4 hours of the stream, instead of starting from the beginning but that is better than nothing.
            if (
              result.streaming_data.adaptive_formats[0]?.url ||
              result.streaming_data.adaptive_formats[0]?.signature_cipher ||
              result.streaming_data.adaptive_formats[0]?.cipher
            ) {
              try {
                const manifestSrc = await this.createLocalDashManifest(result, true)
                if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }
                this.manifestSrc = manifestSrc
                this.manifestMimeType = MANIFEST_TYPE_DASH
                useRemoteManifest = false
              } catch (error) {
                if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }
                console.error(`Failed to generate DASH manifest for this Post Live DVR video ${this.videoId}, falling back to using YouTube's provided one...`, error)
              }
            }
          }

          if (useRemoteManifest) {
            if (result.streaming_data?.dash_manifest_url) {
              this.manifestSrc = result.streaming_data.dash_manifest_url
              this.manifestMimeType = MANIFEST_TYPE_DASH
            } else {
              // A blocked live player response can contain all watch-page metadata
              // without either manifest URL. Keep the missing source as `null`, as
              // expected by the player availability checks, while yt-dlp extracts
              // its independent HLS manifest.
              this.manifestSrc = result.streaming_data?.hls_manifest_url ?? androidLiveHlsManifestUrl
              this.manifestMimeType = MANIFEST_TYPE_HLS
            }
          }

          this.streamingDataExpiryDate = result.streaming_data?.expires ?? null

          if (this.activeFormat === 'legacy') {
            this.activeFormat = 'dash'
          }
        } else if (this.isUpcoming) {
          const upcomingTimestamp = result.basic_info.start_timestamp

          if (upcomingTimestamp) {
            const now = new Date()
            this.premiereDate = upcomingTimestamp
            this.updateUpcomingTimestamp()

            let upcomingTimeLeft = upcomingTimestamp - now

            // Convert from ms to second to minute
            upcomingTimeLeft = (upcomingTimeLeft / 1000) / 60
            let timeUnit = 'minute'

            // Youtube switches to showing time left in minutes at 120 minutes remaining
            if (upcomingTimeLeft > 120) {
              upcomingTimeLeft /= 60
              timeUnit = 'hour'
            }

            if (timeUnit === 'hour' && upcomingTimeLeft > 24) {
              upcomingTimeLeft /= 24
              timeUnit = 'day'
            }

            // Value after decimal not to be displayed
            // e.g. > 2 days = display as `2 days`
            upcomingTimeLeft = Math.floor(upcomingTimeLeft)

            // Displays when less than a minute remains
            // Looks better than `Premieres in x seconds`
            if (upcomingTimeLeft < 1) {
              this.upcomingTimeLeft = this.t('Video.Published.In less than a minute').toLowerCase()
            } else {
              // TODO a I18n entry for time format might be needed here
              this.upcomingTimeLeft = new Intl.RelativeTimeFormat(this.currentLocale).format(upcomingTimeLeft, timeUnit)
            }

            this.scheduleLiveReminderStartInvalidation()
            this.syncLiveReminder(loadGeneration, videoId).catch(error => {
              console.error('Failed to load live stream reminder', error)
            })
          } else {
            this.upcomingTimestamp = null
            this.upcomingTimeLeft = null
            this.premiereDate = undefined
            this.scheduleLiveReminderStartInvalidation()
          }
        }

        if ((!this.isUpcoming && !this.isLive && !this.isPostLiveDvr) || (this.isUpcoming && this.playabilityStatus === 'OK')) {
          this.videoLengthSeconds = result.basic_info.duration
          if (result.streaming_data) {
            this.streamingDataExpiryDate = result.streaming_data.expires

            if (result.streaming_data.formats.length > 0) {
              this.legacyFormats = result.streaming_data.formats.map(mapLocalLegacyFormat)
            }

            if (result.captions) {
              const captionTranslationLanguages = result.captions.translation_languages ?? []
              const captionTracks = result.captions?.caption_tracks?.map((caption) => {
                const url = new URL(caption.base_url)
                url.searchParams.set('fmt', 'vtt')

                return {
                  id: caption.vss_id,
                  url: url.toString(),
                  label: caption.name.text,
                  language: caption.language_code,
                  mimeType: 'text/vtt'
                }
              }) ?? []

              this.$store.commit('setYouTubeCaptionLanguageCodes', captionTranslationLanguages)
              this.captionTranslations = captionTranslationLanguages.map(language =>
                this.getTranslatedCaption(result.captions, language)
              ).filter(Boolean)

              if (captionTracks.length > 0) {
                const languagesSet = new Set([this.preferredCaptionLocale, this.preferredCaptionLocale.split('-')[0]])

                // special cases
                switch (this.preferredCaptionLocale) {
                  case 'nn':
                  case 'nb-NO':
                    // according to https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes
                    // "no" is the macro language for "nb" and "nn"
                    languagesSet.add('no')
                    break
                  case 'he':
                    // according to https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes
                    // "iw" is the old/original code for Hewbrew, these days it's "he"
                    languagesSet.add('iw')
                    break
                }

                const hasPreferredCaption = findCaptionByLocale(captionTracks, this.preferredCaptionLocale) ||
                  captionTracks.some(captionTrack => languagesSet.has(captionTrack.language))

                if (!hasPreferredCaption) {
                  const translatedCaptionTrack = this.getTranslatedLocaleCaption(result.captions, languagesSet)

                  if (translatedCaptionTrack) {
                    captionTracks.push(translatedCaptionTrack)
                  }
                }
              }

              this.captions = sortCaptions(captionTracks, this.preferredCaptionLocale)
            }
          } else if (
            this.restrictedPlaybackError === null &&
            !this.isYtDlpPlaybackRequested()
          ) {
            // video might be region locked or something else. This leads to no formats being available
            this.showTabToast({
              message: this.t('This video is unavailable because of missing formats. This can happen due to country unavailability.'),
              time: 7000,
              icon: ['fas', 'circle-exclamation'],
            })
            this.handleVideoEnded()
            return
          } else if (this.restrictedPlaybackError === null) {
            console.warn('Built-in metadata has no streams; continuing so yt-dlp can provide the playback source')
          }

          let storyboard

          if (result.storyboards?.type === 'PlayerStoryboardSpec') {
            /** @type {import('youtubei.js/dist/src/parser/classes/PlayerStoryboardSpec').StoryboardData[]} */
            let source = result.storyboards.boards
            if (window.innerWidth < 500) {
              source = source.filter((board) => board.thumbnail_height <= 90)
            }

            storyboard = source.at(-1)
            this.videoStoryboardSrc = this.createLocalStoryboardUrls(storyboard)
          }

          if (this.restrictedPlaybackError === null && result.streaming_data?.adaptive_formats.length > 0) {
            this.vrProjection = result.streaming_data.adaptive_formats
              .find(format => {
                return format.has_video &&
                  typeof format.projection_type === 'string' &&
                  format.projection_type !== 'RECTANGULAR'
              })
              ?.projection_type ?? null

            if (
              poToken &&
              videoInfo.info.streaming_data?.server_abr_streaming_url &&
              videoInfo.info.player_config.media_common_config.media_ustreamer_request_config
            ) {
              const storyboards = storyboard
                ? [{
                    templateUrl: storyboard.template_url,
                    mimeType: 'image/webp',
                    columns: storyboard.columns,
                    rows: storyboard.rows,
                    thumbnailCount: storyboard.thumbnail_count,
                    thumbnailWidth: storyboard.thumbnail_width,
                    thumbnailHeight: storyboard.thumbnail_height,
                    storyboardCount: storyboard.storyboard_count,
                    interval: storyboard.interval > 0 ? storyboard.interval / 1000 : 0
                  }]
                : []

              this.manifestSrc = this.createLocalSabrManifest(result, poToken, clientInfo, storyboards)
              this.manifestMimeType = MANIFEST_TYPE_SABR
            } else if (
              result.streaming_data.adaptive_formats[0]?.url ||
              result.streaming_data.adaptive_formats[0]?.signature_cipher ||
              result.streaming_data.adaptive_formats[0]?.cipher
            ) {
              const manifestSrc = await this.createLocalDashManifest(result)
              if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }
              this.manifestSrc = manifestSrc
              this.manifestMimeType = MANIFEST_TYPE_DASH
            } else {
              // Neither a SABR streaming URL nor playable adaptive format URLs,
              // so the only thing left is the 360p legacy stream. This is a
              // silent quality drop, so make it identifiable in the logs.
              console.error(`No SABR or adaptive stream URLs for ${this.videoId}, falling back to the legacy formats...`)
              this.manifestSrc = null
              this.enableLegacyFormat()
            }
          } else if (this.restrictedPlaybackError === null) {
            console.error(`No adaptive formats for ${this.videoId}, falling back to the legacy formats...`)
            this.manifestSrc = null
            this.enableLegacyFormat()
          }
        }

        if (!this.isUpcoming && this.restrictedPlaybackError === null) {
          if (!this.applyDownloadedPlaybackSource()) {
            this.alignActiveFormatWithAvailableSources()

            // Deliberately not awaited, so that the metadata (title, description,
            // comments, recommendations, ...) is shown while yt-dlp is still extracting.
            this.applyYtDlpPlaybackSource(loadGeneration, videoId)
          }
        }

        this.updateShortsPlayerState(
          result.basic_info.duration,
          result.streaming_data?.adaptive_formats
        )
        if (this.customShortsPlayerActive) {
          this.thumbnail = getShortThumbnailUrl(
            this.currentSubscriptionShort ?? { videoId: this.videoId },
            this.backendPreference,
            this.currentInvidiousInstanceUrl,
            this.thumbnailPreference
          ) ?? this.thumbnail
        }
        if (this.isShort) {
          this.loadLocalShortLinkedVideo(this.videoId)
        }
        this.isLoading = false
        this.updateTitle()
      } catch (err) {
        if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }

        let handledError = err
        if (err.isIpBlock) {
          this.ipBlockDetectedInCurrentChain = true
          handledError = new Error(this.t('Video.IP block'), { cause: err })
        }

        console.error(handledError)
        if (this.backendPreference === 'local' && this.backendFallback && !handledError.toString().includes('private') && !handledError.toString().includes('unavailable')) {
          const errorMessage = this.t('Local API Error (Click to copy)')
          showApiErrorToast(errorMessage, handledError, this.showTabToast)
          this.showTabToast({ message: this.t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
          this.getVideoInformationInvidious(loadGeneration)
        } else {
          const didReload = await this.runIpBlockRecoveryScriptAndReload()
          if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }
          if (didReload) {
            return
          }

          if (this.finishDownloadedPlaybackWithoutMetadata()) return

          this.isLoading = false

          if (!this.thumbnail) {
            this.thumbnail = this.getUnavailableVideoThumbnail()
          }
          this.errorMessage = handledError.message || handledError.toString()
        }
      }
    },

    getVideoInformationInvidious: async function (loadGeneration = ++this.videoLoadGeneration) {
      if (this.firstLoad) {
        this.isLoading = true
      }

      const videoId = this.tabRoute.params.id
      await initializeNetworkRecovery().ready
      if (!this.isCurrentVideoLoad(loadGeneration, videoId)) return
      if (getConnectionState() === 'offline' && this.finishDownloadedPlaybackWithoutMetadata()) return

      invidiousGetVideoInformation(videoId)
        .then(async result => {
          if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }

          if (result.error) {
            throw new Error(result.error)
          }

          this.videoTitle = result.title
          this.hasResolvedVideoTitle = this.videoTitle.length > 0
          this.videoViewCount = result.viewCount
          this.hasPaidPromotion = result.paid

          const subCount = parseLocalSubscriberCount(result.subCountText)
          if (!isNaN(subCount)) {
            this.channelSubscriptionCountText = formatNumber(subCount, subCount >= 10000 ? { notation: 'compact' } : undefined)
          } else {
            this.channelSubscriptionCountText = ''
          }

          if (this.hideVideoLikesAndDislikes) {
            this.videoLikeCount = null
            this.videoDislikeCount = null
          } else {
            this.videoLikeCount = result.likeCount
            this.videoDislikeCount = result.dislikeCount

            if (this.useReturnYouTubeDislikes) {
              this.fetchVideoDislikes()
            }
          }

          this.videoCategory = result.genre ?? ''
          this.videoTags = result.keywords ?? []
          this.videoGenreIsMusic = this.videoCategory === 'Music'
          this.musicMediaType = result.musicMediaType

          this.channelId = result.authorId
          this.channelName = result.author
          this.channelCollaborators = []
          const channelThumb = result.authorThumbnails.at(-1)
          this.channelThumbnail = channelThumb ? youtubeImageUrlToInvidious(channelThumb.url, this.currentInvidiousInstanceUrl) : ''
          this.$store.commit('setVideoAvatar', {
            videoId: this.videoId,
            avatar: this.channelThumbnail
          })
          this.setTabAvatar(this.channelThumbnail)
          this.updateSubscriptionDetails({
            channelThumbnailUrl: channelThumb?.url,
            channelName: result.author,
            channelId: result.authorId
          })

          this.initializePlaybackRate()
          this.initializeVideoQuality()

          this.videoPublished = result.published * 1000
          this.videoDescription = result.description ?? ''
          this.videoDescriptionHtml = result.descriptionHtml
          const recommendedVideos = result.recommendedVideos

          // The recommended videos currently use yyyy-mm-ddThh:mm:ss for the published timestamp
          // whereas the rest of the API uses unix timestamps, correct that here
          recommendedVideos.forEach((video) => {
            if (typeof video.published === 'string') {
              video.published = Date.parse(video.published)
            }
          })

          // place watched recommended videos last
          this.recommendedVideos = recommendedVideos.sort(this.sortWatchedVideosLast)

          this.isLive = result.liveNow
          this.isPremiere = this.isLive && result.premiereTimestamp > 0
          this.isFamilyFriendly = result.isFamilyFriendly
          this.isPostLiveDvr = !!result.isPostLiveDvr
          this.isUnlisted = !result.isListed

          this.captions = sortCaptions(result.captions.map(caption => {
            return {
              url: this.currentInvidiousInstanceUrl + caption.url,
              label: caption.label,
              language: caption.language_code,
              mimeType: 'text/vtt'
            }
          }), this.preferredCaptionLocale)

          if (!this.isLive && !this.isPostLiveDvr) {
            this.videoStoryboardSrc = `${this.currentInvidiousInstanceUrl}/api/v1/storyboards/${this.videoId}?height=90`
          }

          switch (this.thumbnailPreference) {
            case 'start':
              this.thumbnail = `${this.currentInvidiousInstanceUrl}/vi/${this.videoId}/maxres1.jpg`
              break
            case 'middle':
              this.thumbnail = `${this.currentInvidiousInstanceUrl}/vi/${this.videoId}/maxres2.jpg`
              break
            case 'end':
              this.thumbnail = `${this.currentInvidiousInstanceUrl}/vi/${this.videoId}/maxres3.jpg`
              break
            default:
              this.thumbnail = new URL(result.videoThumbnails[0].url, this.currentInvidiousInstanceUrl).toString()
              break
          }

          let chapters = []
          if (!this.hideChapters) {
            chapters = this.extractChaptersFromDescription(result.description)

            if (chapters.length > 0) {
              this.finalizeChapters(chapters, result.lengthSeconds)
            } else {
              chapters = await this.getSponsorBlockCommunityChapters(result.lengthSeconds)
              if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }
            }
          }
          this.videoChapters = chapters
          this.videoChaptersKind = 'chapters'

          if (this.isLive || this.isPostLiveDvr) {
            // The live DASH manifest is currently unusable as it returns 403s after 1 minute of playback
            // so we have to use the HLS one for now.
            // Leaving the code here commented out in case we can use it again in the future
            // const url = `${this.currentInvidiousInstanceUrl}/api/manifest/dash/id/${this.videoId}`

            // // Proxying doesn't work for live or post live DVR DASH, so use HLS instead
            // // https://github.com/iv-org/invidious/pull/4589
            // if (this.proxyVideos) {

            this.streamingDataExpiryDate = this.extractExpiryDateFromStreamingUrl(result.adaptiveFormats[0].url)

            let hlsManifestUrl = result.hlsUrl

            if (this.proxyVideos) {
              const url = new URL(hlsManifestUrl)
              url.searchParams.set('local', 'true')
              hlsManifestUrl = url.toString()
            }

            this.manifestSrc = hlsManifestUrl
            this.manifestMimeType = MANIFEST_TYPE_HLS

            // The HLS manifests only contain combined audio+video streams, so we can't do audio only
            if (this.activeFormat === 'audio') {
              this.activeFormat = 'dash'
            }
            // } else {
            //   this.manifestSrc = url
            //   this.manifestMimeType = MANIFEST_TYPE_DASH
            // }

            this.legacyFormats = []

            if (this.activeFormat === 'legacy') {
              this.activeFormat = 'dash'
            }
          } else {
            this.videoLengthSeconds = result.lengthSeconds

            this.streamingDataExpiryDate = this.extractExpiryDateFromStreamingUrl(result.adaptiveFormats[0].url)

            this.legacyFormats = result.formatStreams.map(mapInvidiousLegacyFormat)

            if (!process.env.SUPPORTS_LOCAL_API || this.proxyVideos) {
              this.legacyFormats.forEach(format => {
                format.url = getProxyUrl(format.url)
              })
            }

            this.vrProjection = result.adaptiveFormats
              .find(stream => {
                return typeof stream.projectionType === 'string' &&
                  stream.projectionType !== 'RECTANGULAR'
              })
              ?.projectionType ?? null

            const manifestSrc = await this.createInvidiousDashManifest(result)
            if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }
            this.manifestSrc = manifestSrc
            this.manifestMimeType = MANIFEST_TYPE_DASH
          }

          if (!this.isUpcoming) {
            if (!this.applyDownloadedPlaybackSource()) {
              this.alignActiveFormatWithAvailableSources()

              // Deliberately not awaited, so that the metadata (title, description,
              // comments, recommendations, ...) is shown while yt-dlp is still extracting.
              this.applyYtDlpPlaybackSource(loadGeneration, videoId)
            }
          }

          this.updateShortsPlayerState(result.lengthSeconds, result.adaptiveFormats)
          if (this.customShortsPlayerActive) {
            this.thumbnail = getShortThumbnailUrl(
              this.currentSubscriptionShort ?? { videoId: this.videoId },
              this.backendPreference,
              this.currentInvidiousInstanceUrl,
              this.thumbnailPreference
            ) ?? this.thumbnail
          }
          this.updateTitle()

          this.isLoading = false
        })
        .catch(async err => {
          if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }

          console.error(err)
          if (process.env.SUPPORTS_LOCAL_API && this.backendPreference === 'invidious' && this.backendFallback) {
            const errorMessage = this.t('Invidious API Error (Click to copy)')
            showApiErrorToast(errorMessage, err, this.showTabToast)
            this.showTabToast({ message: this.t('Falling back to Local API'), icon: ['fas', 'exchange-alt'] })
            this.getVideoInformationLocal(loadGeneration)
          } else {
            const restrictedPlaybackError = this.getRestrictedPlaybackErrorType(err.message || err.toString())
            if (restrictedPlaybackError !== null) {
              this.isLoading = false
              this.thumbnail ||= this.getUnavailableVideoThumbnail()
              this.setRestrictedPlaybackError(restrictedPlaybackError)
              return
            }

            const didReload = await this.runIpBlockRecoveryScriptAndReload()
            if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }
            if (didReload) {
              return
            }

            if (this.finishDownloadedPlaybackWithoutMetadata()) return

            this.isLoading = false

            if (!this.thumbnail) {
              this.thumbnail = this.getUnavailableVideoThumbnail()
            }
            this.errorMessage = err.message || err.toString()
          }
        })
    },

    async runIpBlockRecoveryScriptAndReload() {
      if (
        !this.ipBlockDetectedInCurrentChain ||
        this.ipBlockRecoveryAttemptedForCurrentVideo ||
        !process.env.IS_ELECTRON
      ) {
        return false
      }

      const scriptPath = this.videoIpBlockScriptPath.trim()
      if (
        scriptPath.length === 0 ||
        typeof window.ftElectron?.startIpBlockRecoveryScript !== 'function' ||
        typeof window.ftElectron?.executeIpBlockRecoveryScript !== 'function'
      ) {
        return false
      }

      const loadGeneration = this.videoLoadGeneration
      const videoId = this.videoId
      this.ipBlockRecoveryAttemptedForCurrentVideo = true
      const longToastDurationMs = 10000
      const startedRecovery = await window.ftElectron.startIpBlockRecoveryScript(scriptPath)
      if (startedRecovery) {
        // IP block recovery affects the whole app (network level), so surface it
        // globally once, from the tab that atomically started the shared run.
        showToastOnAllTabs(this.t('Settings.Proxy Settings.Running IP block recovery script'), longToastDurationMs, ['fas', 'shield-halved'])
      }

      try {
        const result = await window.ftElectron.executeIpBlockRecoveryScript(scriptPath)
        if (startedRecovery && result?.exitCode !== 0) {
          const exitCode = result?.exitCode == null ? 'unknown' : `${result.exitCode}`
          showToastOnAllTabs(this.t('Settings.Proxy Settings.IP block recovery script failed', { exitCode }), longToastDurationMs, ['fas', 'circle-exclamation'])
        } else if (startedRecovery) {
          showToastOnAllTabs(this.t('Settings.Proxy Settings.IP block recovery script finished'), longToastDurationMs, ['fas', 'check'])
        }
      } catch (error) {
        console.error('IP block recovery script failed:', error)
        if (startedRecovery) {
          showToastOnAllTabs(this.t('Settings.Proxy Settings.IP block recovery script failed', { exitCode: 'unknown' }), longToastDurationMs, ['fas', 'circle-exclamation'])
        }
      }

      if (!this.isCurrentVideoLoad(loadGeneration, videoId)) return false

      // The reload only affects this tab's video, so keep it scoped.
      this.showTabToast({
        message: this.t('Settings.Proxy Settings.Reloading video after IP block recovery'),
        time: longToastDurationMs,
        icon: ['fas', 'sync'],
      })
      await this.reloadView()
      return true
    },

    extractExpiryDateFromStreamingUrl: function (url) {
      const expireString = new URL(url).searchParams.get('expire')

      return new Date(parseInt(expireString) * 1000)
    },

    getUnavailableVideoThumbnail: function () {
      const backgroundColor = window.getComputedStyle(document.body).backgroundColor
      const isLightTheme = calculateColorLuminance(backgroundColor) === '#000000'

      return isLightTheme
        ? UNAVAILABLE_VIDEO_THUMBNAILS.light
        : UNAVAILABLE_VIDEO_THUMBNAILS.dark
    },

    /**
     * @param {string?} description
     */
    extractChaptersFromDescription: function (description) {
      if (description == null) { return [] }

      /** @type {{title: string, timestamp: string, startSeconds: number, endSeconds: number}[]} */
      const chapters = []

      // HH:MM:SS Text
      // MM:SS Text
      // HH:MM:SS: Text
      // MM:SS: Text
      // HH:MM:SS - Text // separator is one of '-', '–', '•', '—'
      // MM:SS - Text
      // HH:MM:SS - HH:MM:SS - Text // end timestamp is ignored, separator is one of '-', '–', '—'
      // HH:MM - HH:MM - Text // end timestamp is ignored
      const chapterMatches = description.matchAll(/^(?<timestamp>((?<hours>\d+):)?(?<minutes>\d+):(?<seconds>\d+))(?!:\d)(\s*[–—-]\s*(?:\d+:){1,2}\d+)?(?:\s*:\s*|\s+([–—•-]\s*)?)(?<title>.+)$/gm)

      for (const { groups } of chapterMatches) {
        let start = 60 * Number(groups.minutes) + Number(groups.seconds)

        if (groups.hours) {
          start += 3600 * Number(groups.hours)
        }

        // replace previous chapter with current one if they have an identical start time
        if (chapters.length > 0 && chapters[chapters.length - 1].startSeconds === start) {
          chapters.pop()
        }

        chapters.push({
          title: groups.title.trim(),
          timestamp: groups.timestamp,
          startSeconds: start,
          endSeconds: 0
        })
      }

      return chapters
    },

    addChaptersEndSeconds: function (chapters, videoLengthSeconds) {
      for (let i = 0; i < chapters.length - 1; i++) {
        chapters[i].endSeconds = chapters[i + 1].startSeconds
      }
      chapters.at(-1).endSeconds = videoLengthSeconds
    },

    finalizeChapters: function (chapters, videoLengthSeconds) {
      this.addChaptersEndSeconds(chapters, videoLengthSeconds)

      // prevent vue from adding reactivity which isn't needed
      // as the chapter objects are read-only after this anyway
      // the chapters are checked for every timeupdate event that the player emits
      // this should lessen the performance and memory impact of the chapters
      chapters.forEach(Object.freeze)
    },

    /**
     * @param {number} videoLengthSeconds
     * @returns {Promise<{title: string, timestamp: string, startSeconds: number, endSeconds: number}[]>}
     */
    async getSponsorBlockCommunityChapters(videoLengthSeconds) {
      if (!this.useSponsorBlock || this.isLive || this.isPostLiveDvr || !Number.isFinite(videoLengthSeconds) || videoLengthSeconds <= 0) {
        return []
      }

      try {
        const sponsorBlockChapters = await sponsorBlockSkipSegments(this.videoId, ['chapter'], ['chapter'])

        if (sponsorBlockChapters.length === 0) {
          return []
        }

        const chapters = sponsorBlockChapters
          .filter(({ description, segment }) => {
            return description.trim() !== '' &&
              Array.isArray(segment) &&
              segment.length === 2 &&
              Number.isFinite(segment[0]) &&
              Number.isFinite(segment[1]) &&
              segment[0] >= 0 &&
              segment[1] > segment[0]
          })
          .map(({ description, segment: [startSeconds, endSeconds] }) => {
            return {
              title: description.trim(),
              timestamp: formatDurationAsTimestamp(Math.round(startSeconds)),
              startSeconds,
              endSeconds
            }
          })
          .sort((chapterA, chapterB) => chapterA.startSeconds - chapterB.startSeconds)

        /** @type {{title: string, timestamp: string, startSeconds: number, endSeconds: number}[]} */
        const deduplicatedChapters = []

        for (const chapter of chapters) {
          if (chapter.startSeconds >= videoLengthSeconds) {
            continue
          }

          if (deduplicatedChapters.length > 0 && deduplicatedChapters.at(-1).startSeconds === chapter.startSeconds) {
            deduplicatedChapters.pop()
          }

          deduplicatedChapters.push(chapter)
        }

        if (deduplicatedChapters.length === 0) {
          return []
        }

        for (let i = 0; i < deduplicatedChapters.length - 1; i++) {
          deduplicatedChapters[i].endSeconds = deduplicatedChapters[i + 1].startSeconds
        }

        const lastChapter = deduplicatedChapters.at(-1)
        lastChapter.endSeconds = Math.min(videoLengthSeconds, Math.max(lastChapter.endSeconds, lastChapter.startSeconds))

        deduplicatedChapters.forEach(Object.freeze)

        return deduplicatedChapters
      } catch (error) {
        console.error('failed to fetch SponsorBlock community chapters', this.videoId, error)
        return []
      }
    },

    /**
     * @param {number} currentSeconds
     */
    updateCurrentChapter: function (currentSeconds) {
      this.trackRecommendationWatch(currentSeconds)
      this.trackWatchTime()
      this.markAsWatchedIfFinished(currentSeconds)
      this.keepHistoryEntryAlive(currentSeconds)

      const chapters = this.videoChapters

      if (this.hideChapters || chapters.length === 0) {
        return
      }

      const currentChapterStart = chapters[this.videoCurrentChapterIndex].startSeconds

      if (currentSeconds !== currentChapterStart) {
        let i = currentSeconds < currentChapterStart ? 0 : this.videoCurrentChapterIndex

        for (; i < chapters.length; i++) {
          if (currentSeconds < chapters[i].endSeconds) {
            this.videoCurrentChapterIndex = i
            break
          }
        }
      }
    },

    updateCurrentTime: function (currentSeconds) {
      this.currentTime = currentSeconds
    },

    handleTimeUpdate: function (currentSeconds) {
      // Once the refreshed stream has actually played a stretch of content it
      // has proven itself, so refill the budget: a later, unrelated SABR
      // failure gets its own refetch instead of dropping straight to legacy
      // 360p. Only natural playback ticks count towards that, so seeking around
      // a stream that never plays can't keep the budget topped up.
      if (this.sabrErrorRecoveryLastSeconds !== null) {
        const elapsed = currentSeconds - this.sabrErrorRecoveryLastSeconds
        this.sabrErrorRecoveryLastSeconds = currentSeconds

        if (elapsed > 0 && elapsed <= SABR_ERROR_RECOVERY_MAX_TICK_SECONDS) {
          this.sabrErrorRecoveryPlayedSeconds += elapsed

          if (this.sabrErrorRecoveryPlayedSeconds >= SABR_ERROR_RECOVERY_SETTLE_SECONDS) {
            this.sabrErrorRecoveryAttempts = 0
            this.sabrErrorRecoveryLastSeconds = null
            this.sabrErrorRecoveryPlayedSeconds = 0
          }
        }
      }

      const elapsedSeconds = currentSeconds - this.currentTime
      const shortsCompletion = getShortsCompletionState({
        blockedBySeek: this.shortsCompletionBlockedBySeek,
        playbackAfterSeekSeconds: this.shortsPlaybackAfterSeekSeconds,
        elapsedSeconds,
        currentSeconds,
        durationSeconds: this.videoLengthSeconds
      })
      this.shortsCompletionBlockedBySeek = shortsCompletion.blockedBySeek
      this.shortsPlaybackAfterSeekSeconds = shortsCompletion.playbackAfterSeekSeconds

      // A looping media element does not fire `ended`. Persist the completed
      // state just before a Short wraps to zero, but never from a seek-driven
      // time update.
      const shortReachedEnd = shortsCompletion.reachedEnd

      this.updateCurrentTime(currentSeconds)

      if (
        this.rememberHistory &&
        this.customShortsPlayerActive &&
        !this.shortsPlaybackCompleted &&
        !this.isUpcoming &&
        !this.isLive &&
        this.videoLengthSeconds > 0 &&
        // pause() queues a timeupdate before a subsequent seek's seeking event.
        // That update already sees the new time, but is not played content.
        this.$refs.player?.hasLoaded &&
        !this.$refs.player.isPaused() &&
        shortReachedEnd
      ) {
        this.shortsPlaybackCompleted = true
        const watchProgress = this.watchedProgressSavingEnabled
          ? this.videoLengthSeconds
          : (this.historyEntry?.watchProgress ?? 0)

        this.addToHistory(watchProgress, true)
      }

      this.updateCurrentChapter(currentSeconds)
      this.$store.commit('setCurrentWatchTimestamp', {
        tabId: this.tabId,
        value: currentSeconds
      })
    },

    addToHistory: function (watchProgress, isWatched = isHistoryEntryWatched(this.historyEntry)) {
      const now = Date.now()
      // Local playback can start before channel metadata is available.
      const metadata = this.localFilePlayback && !this.channelId && this.historyEntry
        ? this.historyEntry
        : {
            title: this.videoTitle,
            author: this.channelName,
            authorId: this.channelId,
            published: this.videoPublished,
            description: this.videoDescription,
            viewCount: this.videoViewCount,
          }
      const videoData = {
        ...this.historyEntry,
        ...metadata,
        videoId: this.videoId,
        lengthSeconds: this.videoLengthSeconds,
        watchProgress: watchProgress,
        isWatched,
        timeWatched: now,
        isLive: this.isLive,
        isUpcoming: this.isUpcoming,
        type: 'video',
      }

      this.historyLastTouchedAt = now
      this.updateHistory(videoData)
    },

    keepHistoryEntryAlive(currentSeconds) {
      const now = Date.now()
      if (
        !this.rememberHistory ||
        !this.historyRetentionEnabled ||
        !this.videoPlayerLoaded ||
        this.isUpcoming ||
        this.isLive ||
        this.$refs.player?.isPaused() ||
        now - this.historyLastTouchedAt < 60_000
      ) {
        return
      }

      const watchProgress = this.watchedProgressSavingEnabled
        ? currentSeconds
        : (this.historyEntry?.watchProgress ?? 0)

      this.addToHistory(watchProgress)
    },

    markAsWatchedIfFinished(currentSeconds, isFinished = false) {
      if (
        !this.rememberHistory ||
        this.isUpcoming ||
        this.isLive ||
        isHistoryEntryWatched(this.historyEntry)
      ) {
        return
      }

      if (!isFinished && this.$refs.player?.isPaused()) {
        return
      }

      if (isFinished || hasReachedWatchedThreshold(
        currentSeconds,
        this.videoLengthSeconds,
        this.watchedPercentageThreshold
      )) {
        const watchProgress = this.watchedProgressSavingEnabled
          ? currentSeconds
          : (this.historyEntry?.watchProgress ?? 0)

        this.addToHistory(watchProgress, true)
      }
    },

    handleWatchProgressManualSave() {
      // Should be called by manual action, settings should be checked in UI
      this._saveWatchProgress()
      showToast({ message: this.t('Video.Watched Progress Saved'), icon: ['fas', 'save'] })
    },
    handleChannelPlaybackSpeedManualSave() {
      // Should be called by manual action, settings should be checked in UI
      const rememberPerChannel = this.$store.getters.getRememberPlaybackSpeedPerChannel
      if (!rememberPerChannel || !this.channelId) {
        return
      }

      this.saveChannelPlaybackSpeed(this.currentPlaybackRate)
      showToast({
        message: `${this.t('Video.Channel Playback Speed Saved')}: ${this.currentPlaybackRate}×`,
        icon: ['fas', 'gauge']
      })
    },
    handleChannelVideoQualityManualSave() {
      // Should be called by manual action, settings should be checked in UI
      const rememberPerChannel = this.$store.getters.getRememberVideoQualityPerChannel
      if (!rememberPerChannel || !this.channelId) {
        return
      }

      if (this.saveChannelVideoQuality(this.currentVideoQuality)) {
        const savedQuality = this.normalizeVideoQuality(this.currentVideoQuality)
        const savedQualityLabel = savedQuality === 'auto'
          ? this.t('Settings.Player Settings.Default Quality.Auto')
          : `${savedQuality}p`
        showToast({
          message: `${this.t('Video.Channel Video Quality Saved')}: ${savedQualityLabel}`,
          icon: ['fas', 'film']
        })
      }
    },
    handleChannelSubtitlesStateManualSave() {
      // Should be called by manual action, settings should be checked in UI
      const rememberPerChannel = this.$store.getters.getRememberSubtitlesStatePerChannel
      if (!rememberPerChannel || !this.channelId || this.currentSubtitlesState === null) {
        return
      }

      this.saveChannelSubtitlesState(this.currentSubtitlesState)
      showToast({
        message: `${this.t('Video.Channel Subtitles State Saved')}: ${this.currentSubtitlesState ? '✓' : '✕'}`,
        icon: ['fas', 'closed-captioning']
      })
    },
    handleChannelVolumeManualSave() {
      // Should be called by manual action, settings should be checked in UI
      const rememberPerChannel = this.$store.getters.getRememberVolumePerChannel
      if (!rememberPerChannel || !this.channelId || this.currentVolume === null) {
        return
      }

      this.saveChannelVolume(this.currentVolume)
      showToast({
        message: `${this.t('Video.Channel Volume Saved')}: ${Math.round(this.currentVolume * 100)}%`,
        icon: ['fas', 'volume-high']
      })
    },
    handleWatchProgressAutoSave() {
      if (!this.rememberHistory || !this.autosaveWatchedProgress) { return }
      this._saveWatchProgress()
    },
    handleWatchProgressAutoSaveWhenProgressEnabled() {
      if (!this.rememberHistory || !this.watchedProgressSavingEnabled) { return }
      this._saveWatchProgress()
    },
    handleVideoPause() {
      this.recommendationPlaybackSample = null
      // A reload remembers whether the outgoing player was playing, but the
      // user can still pause it before the replacement starts loading. Do not
      // let that stale snapshot restart the replacement player. Ignore pauses
      // emitted while the outgoing player is being torn down.
      if (
        !this.isLoading &&
        !this.playerTeardownInProgress &&
        this.resumePlaybackAfterSabrReload
      ) {
        this.resumePlaybackAfterSabrReload = false
        this.suppressAutoplayAfterSabrReload = true
      }
      this.watchTimeLastTick = null
      this.flushWatchTime()
      this.handleWatchProgressAutoSaveWhenProgressEnabled()
    },
    handleVideoPlay() {
      if (isAppHidden()) this.updateAndroidBackgroundPlaybackFormat()
    },
    handlePlayerSeeking() {
      if (!this.customShortsPlayerActive) {
        return
      }

      this.shortsCompletionBlockedBySeek = true
      this.shortsPlaybackAfterSeekSeconds = 0
    },
    clearPendingWatchTime() {
      this.watchTimeLastTick = null
      this.pendingWatchTimeByDate = {}
    },
    trackRecommendationWatch(time) {
      if (!this.rememberHistory || !this.$store.getters.getEnableHomeRecommendations || this.isLoading || !this.$refs.player?.hasLoaded) {
        this.recommendationPlaybackSample = null
        this.recommendationWatchSession = null
        return
      }
      const epoch = this.$store.getters.getRecommendationEpoch
      if (!epoch) {
        if (Date.now() >= this.recommendationLoadRetryAt) {
          this.recommendationLoadRetryAt = Date.now() + 30_000
          this.$store.dispatch('loadRecommendations').catch(error => console.error('Could not load recommendation learning', error))
        }
        return
      }
      this.recommendationLoadRetryAt = 0
      if (this.recommendationWatchSession?.videoId !== this.videoId || this.recommendationWatchSession.epoch !== epoch) {
        this.recommendationWatchSession = { videoId: this.videoId, epoch, sessionId: crypto.randomUUID(), seconds: 0, savedSeconds: 0 }
        this.recommendationPlaybackSample = null
      }
      const { current, seconds } = sampleRecommendationPlayback(this.recommendationPlaybackSample, {
        videoId: this.videoId,
        time,
        now: Date.now(),
        playing: !this.$refs.player.isPaused(),
        rate: this.currentPlaybackRate ?? 1,
      })
      this.recommendationPlaybackSample = current
      this.recommendationWatchSession.seconds += seconds
      if (this.recommendationWatchSession.seconds - this.recommendationWatchSession.savedSeconds >= 30) this.flushRecommendationWatch()
    },
    async flushRecommendationWatch() {
      const session = this.recommendationWatchSession
      if (!session || session.videoId !== this.videoId || session.seconds <= session.savedSeconds) return
      session.savedSeconds = session.seconds
      try {
        await this.$store.dispatch('recordRecommendationEvent', {
          ...session,
          type: 'watch',
          video: {
            videoId: this.videoId,
            title: this.videoTitle,
            author: this.channelName,
            authorId: this.channelId,
            description: this.videoDescription,
            lengthSeconds: this.videoLengthSeconds,
            isShort: this.isShort,
          },
        })
      } catch (error) {
        console.error('Could not save recommendation learning', error)
      }
    },
    trackWatchTime() {
      if (!this.rememberHistory || !this.enableWatchStats || this.$refs.player?.isPaused()) {
        this.watchTimeLastTick = null
        return
      }

      const now = Date.now()
      if (this.watchTimeLastTick !== null) {
        const elapsed = now - this.watchTimeLastTick

        // Ignore suspended or heavily delayed timers instead of counting idle time.
        if (elapsed > 0 && elapsed <= 5000) {
          const watchedAt = new Date(now)
          const date = [
            watchedAt.getFullYear(),
            String(watchedAt.getMonth() + 1).padStart(2, '0'),
            String(watchedAt.getDate()).padStart(2, '0'),
          ].join('-')

          this.pendingWatchTimeByDate[date] = (this.pendingWatchTimeByDate[date] ?? 0) + elapsed
        }
      }

      this.watchTimeLastTick = now

      const pendingMilliseconds = Object.values(this.pendingWatchTimeByDate)
        .reduce((total, milliseconds) => total + milliseconds, 0)

      if (pendingMilliseconds >= 10000) {
        this.flushWatchTime()
      }
    },
    async flushWatchTime() {
      const learning = this.flushRecommendationWatch()
      this.watchTimeLastTick = null
      const pending = this.pendingWatchTimeByDate
      this.pendingWatchTimeByDate = {}

      await Promise.all([learning, ...Object.entries(pending).map(([date, milliseconds]) => {
        return this.$store.dispatch('recordWatchTime', {
          date,
          seconds: milliseconds / 1000,
        })
      })])
    },
    /**
     * Whether this tab is currently the presented one. Without a logical-tab
     * context (the web build) there is nothing to hide behind, so treat the view
     * as presented.
     *
     * @returns {boolean}
     */
    isCurrentlyPresented() {
      return this.isTabPresented == null || this.isTabPresented === true
    },

    _saveWatchProgress() {
      if (!this.canSaveWatchProgress) { return }
      // A background tab force-pauses its brief autoplay attempt, which would
      // otherwise save a spurious ~1 second resume point. Only persist progress
      // for tabs the user has actually presented.
      if (!this.isCurrentlyPresented() || !this.hasBeenPresented) { return }
      if (!this.$refs.player?.hasLoaded) { return }
      // Shaka can finish loading before it seeks to the resume point. Saving
      // the media element's initial zero in that gap would erase progress.
      if (!this.$refs.player.hasPlaybackPosition) { return }

      const currentTime = this.shortsPlaybackCompleted && this.watchedProgressSavingEnabled
        ? this.videoLengthSeconds
        : this.getWatchedProgress()
      const payload = {
        videoId: this.videoId,
        watchProgress: currentTime
      }
      this.updateWatchProgress(payload)
    },

    fetchVideoDislikes: function () {
      const videoIdAtRequestTime = this.videoId
      getVideoDislikes(videoIdAtRequestTime).then(dislikes => {
        // Avoid overwriting the dislike count for a different video,
        // e.g. if the user navigated away before the request resolved.
        if (this.videoId !== videoIdAtRequestTime) { return }

        this.videoDislikeCount = isNaN(dislikes) ? 0 : dislikes
      }).catch(err => {
        console.error('Failed to fetch dislikes from Return YouTube Dislike:', err)
      })
    },

    handlePlaylistPersisting: function () {
      // Only save playlist ID if enabled, and it's not special video types
      if (!(this.rememberHistory && this.saveVideoHistoryWithLastViewedPlaylist)) { return }
      if (this.isUpcoming || this.isLive) { return }

      this.updateLastViewedPlaylist({
        videoId: this.videoId,
        // Whether there is a playlist ID or not, save it
        lastViewedPlaylistId: this.playlistId,
        lastViewedPlaylistType: this.playlistType,
        lastViewedPlaylistItemId: this.playlistItemId,
      })
    },

    /**
     * @param {{ videoId: string }} a
     * @param {{ videoId: string }} b
     */
    sortWatchedVideosLast: function (a, b) {
      const aWasWatched = this.isRecommendedVideoWatched(a.videoId)
      const bWasWatched = this.isRecommendedVideoWatched(b.videoId)

      if (aWasWatched && !bWasWatched) {
        return 1
      } else if (!aWasWatched && bWasWatched) {
        return -1
      } else {
        return 0
      }
    },

    isRecommendedVideoWatched: function (videoId) {
      return isHistoryEntryWatched(this.$store.getters.getHistoryCacheById[videoId])
    },

    handleVideoLoaded: async function (mediaMetadata) {
      if (this.isLoading || this.preparingVideoLoadGeneration !== null) { return }

      // Only used one time = remove after use
      this.oneTimeTimestamp = null
      this.sabrReloadCaptionIndex = null
      this.sabrReloadPlaybackRate = null

      if (
        !this.localFilePlayback &&
        this.manifestMimeType === MANIFEST_TYPE_SABR &&
        this.activeFormat !== 'legacy'
      ) {
        this.sabrPlaybackLoaded = true
        if (this.onlinePlaybackSource !== null) {
          this.onlinePlaybackSource.hasBeenLoaded = true
        }
      }

      if (
        Number.isFinite(mediaMetadata?.duration) &&
        mediaMetadata.duration > 0 &&
        (this.tabRoute.query.downloadId || !Number.isFinite(this.videoLengthSeconds) || this.videoLengthSeconds <= 0)
      ) {
        this.videoLengthSeconds = mediaMetadata.duration
      }

      // will trigger again if you switch formats or change legacy quality
      // Check isUpcoming to avoid marking upcoming videos as watched if the user has only watched the trailer
      if (!this.videoPlayerLoaded && !this.isUpcoming) {
        this.videoPlayerLoaded = true

        if (this.rememberHistory) {
          if (this.timestamp) {
            this.addToHistory(this.timestamp)
          } else if (this.historyEntryExists) {
            this.addToHistory(this.historyEntry.watchProgress)
          } else {
            this.addToHistory(0)
          }

          // Must be called AFTER history entry inserted
          // Otherwise the value is not saved for first time watched videos
          this.handlePlaylistPersisting()
        }

        this.updateLocalPlaylistLastPlayedAtSometimes()

        if (process.env.IS_ELECTRON && this.timestamp !== null) {
          await this.consumeTimestamp()
        }
      }
    },

    checkIfPlaylist: function () {
      if (this.tabRoute.query == null) {
        this.watchingPlaylist = false
        return
      }

      this.playlistId = this.tabRoute.query.playlistId
      this.playlistItemId = this.tabRoute.query.playlistItemId

      if (this.playlistId == null || this.playlistId.length === 0) {
        this.playlistType = ''
        this.playlistItemId = null
        this.watchingPlaylist = false
        return
      }

      // `playlistId` present
      if (this.selectedUserPlaylist != null) {
        // If the page is accessed through navigation via router history, 'playlistId' is still specified
        // but the video could have been removed from the playlist in the meantime
        if (!this.selectedUserPlaylist.videos.some((video) => video.videoId === this.videoId)) {
          this.playlistId = ''
          this.playlistType = ''
          this.playlistItemId = null
          this.watchingPlaylist = false
          return
        }

        // If playlist ID matches a user playlist, it must be user playlist
        this.playlistType = 'user'
        this.watchingPlaylist = true
        return
      }

      // Still possible to be a user playlist from history
      // (but user playlist could be already removed)
      this.playlistType = this.tabRoute.query.playlistType
      if (this.playlistType !== 'user') {
        // Remote playlist
        this.playlistItemId = null
        this.watchingPlaylist = true
        return
      }

      // At this point `playlistType === 'user'`
      // But the playlist might be already removed
      if (this.selectedUserPlaylist == null) {
        // Clear playlist data so that watch history will be properly updated
        this.playlistId = ''
        this.playlistType = ''
        this.playlistItemId = null
      }
      this.watchingPlaylist = this.selectedUserPlaylist != null
    },

    checkIfTimestamp: function () {
      const oneTimeTimestamp = parseInt(this.tabRoute.query.oneTimeTimestamp)
      this.oneTimeTimestamp = isNaN(oneTimeTimestamp) || oneTimeTimestamp < 0 ? null : oneTimeTimestamp

      const timestamp = parseInt(this.tabRoute.query.timestamp)
      this.timestamp = isNaN(timestamp) || timestamp < 0 ? null : timestamp
    },

    consumeTimestamp: async function () {
      const query = { ...this.tabRoute.query }
      if (!('timestamp' in query)) return

      delete query.timestamp
      await this.tabRouter.replace({
        path: this.tabRoute.path,
        query,
        hash: this.tabRoute.hash,
        state: {
          skipTabRouteLoading: true,
          tabTitle: this.videoTitle,
        },
      })
      this.timestamp = null
    },

    handleFormatChange: function (format) {
      switch (format) {
        case 'dash':
          this.enableDashFormat()
          break
        case 'legacy':
          this.enableLegacyFormat()
          break
        case 'audio':
          this.enableAudioFormat()
          break
      }
    },

    useOnlinePlaybackSource: async function () {
      if (!this.localFilePlayback || typeof this.tabRoute.query.downloadId !== 'string') return

      const playbackPosition = this.getTimestamp()
      if (this.restoreOnlinePlaybackSource()) {
        await this.replacePlaybackSourceRoute()
        return
      }

      const query = { ...this.tabRoute.query }
      delete query.downloadId
      if (playbackPosition > 0) query.oneTimeTimestamp = playbackPosition
      await this.tabRouter.replace({ path: this.tabRoute.path, query })
    },

    useLocalPlaybackSource: async function (downloadId) {
      if (!Number.isInteger(downloadId) ||
        !this.localPlaybackDownloads.some(download => download.id === downloadId)) return

      if (!this.applyDownloadedPlaybackSource(downloadId)) return

      await this.replacePlaybackSourceRoute(downloadId)
    },

    /**
     * Changes the stream extraction method for the current video without
     * changing the default selected in the settings.
     * @param {'built-in' | 'yt-dlp'} playbackEngine
     */
    handlePlaybackEngineChange: async function (playbackEngine) {
      if (
        !supportsYtDlp ||
        playbackEngine === this.playbackEngineSelection
      ) {
        return
      }

      const playbackEngineSwitchGeneration = ++this.playbackEngineSwitchGeneration
      const loadGeneration = this.videoLoadGeneration
      const videoId = this.videoId
      const playbackPosition = this.getTimestamp()
      if (playbackPosition > 0) {
        this.oneTimeTimestamp = playbackPosition
      }

      this.playbackEngineFallbackAttemptedForCurrentVideo = false
      this.playbackEngineFallbackTarget = playbackEngine
      this.errorMessage = null

      const activePlaybackSourceAvailable = this.activeFormat === 'legacy'
        ? this.legacyFormats.length > 0
        : this.manifestSrc !== null

      if (playbackEngine === this.activePlaybackEngine && activePlaybackSourceAvailable) {
        this.ytDlpStreamsPending = false
        return
      }

      // `ytDlpStreamsPending` removes the current player from the DOM. Destroy
      // Shaka first so its live manifest refreshes and segment retries cannot
      // survive the engine switch as an orphaned player.
      if (this.$refs.player) {
        await this.destroyPlayer()
      }

      if (
        !this.isCurrentVideoLoad(loadGeneration, videoId) ||
        playbackEngineSwitchGeneration !== this.playbackEngineSwitchGeneration ||
        this.playbackEngineFallbackTarget !== playbackEngine
      ) {
        return
      }

      this.ytDlpStreamsPending = true
      await this.$nextTick()

      if (
        !this.isCurrentVideoLoad(loadGeneration, videoId) ||
        playbackEngineSwitchGeneration !== this.playbackEngineSwitchGeneration ||
        this.playbackEngineFallbackTarget !== playbackEngine
      ) {
        return
      }

      if (playbackEngine === 'yt-dlp') {
        try {
          const sourceApplied = await this.extractYtDlpPlaybackSource(
            loadGeneration,
            videoId,
            playbackEngineSwitchGeneration
          )
          if (
            !sourceApplied &&
            this.isCurrentVideoLoad(loadGeneration, videoId) &&
            playbackEngineSwitchGeneration === this.playbackEngineSwitchGeneration &&
            this.manifestSrc === null &&
            this.legacyFormats.length === 0
          ) {
            this.errorMessage = this.t('This video is unavailable because of missing formats. This can happen due to country unavailability.')
          }
        } finally {
          if (
            this.isCurrentVideoLoad(loadGeneration, videoId) &&
            playbackEngineSwitchGeneration === this.playbackEngineSwitchGeneration
          ) {
            this.ytDlpStreamsPending = false
          }
        }
        return
      }

      const source = this.builtInPlaybackSource
      if (
        source === null ||
        (source.manifestSrc === null && source.legacyFormats.length === 0) ||
        (
          source.streamingDataExpiryDate !== null &&
          new Date() > source.streamingDataExpiryDate
        )
      ) {
        await this.reloadView({ preserveTitle: true })
        return
      }

      this.manifestSrc = source.manifestSrc
      this.manifestMimeType = source.manifestMimeType
      this.sabrData = source.sabrData
      this.legacyFormats = source.legacyFormats
      this.streamingDataExpiryDate = source.streamingDataExpiryDate
      this.activePlaybackEngine = 'built-in'
      this.activePlaybackEngineVersion = null
      this.errorMessage = null
      this.alignActiveFormatWithAvailableSources()
      this.ytDlpStreamsPending = false
    },

    retryWithOtherPlaybackEngine: function () {
      this.customErrorIcon = null
      return this.handlePlaybackEngineChange(this.otherPlaybackEngine)
    },

    enableDashFormat: function () {
      if (this.activeFormat === 'dash') {
        return
      }

      if (!this.dashFormatAvailable) {
        showToast({
          message: this.t('Change Format.Dash formats are not available for this video'),
          icon: ['fas', 'circle-exclamation'],
        })
        return
      }

      this.activeFormat = 'dash'
    },

    enableLegacyFormat: function () {
      if (this.activeFormat === 'legacy') {
        return
      }

      if (!this.legacyFormatAvailable) {
        showToast({
          message: this.t('Change Format.Legacy formats are not available for this video'),
          icon: ['fas', 'circle-exclamation'],
        })
        return
      }

      this.activeFormat = 'legacy'
    },

    enableAudioFormat: function () {
      if (this.activeFormat === 'audio') {
        return
      }

      if (!this.audioFormatAvailable) {
        showToast({
          message: this.t('Change Format.Audio formats are not available for this video'),
          icon: ['fas', 'circle-exclamation'],
        })
        return
      }

      this.activeFormat = 'audio'
    },

    handlePlayerEnded: function (sleepTimerEnded = false) {
      if (!this.isCurrentlyPresented()) {
        return
      }
      this.markAsWatchedIfFinished(this.videoLengthSeconds, true)

      if (sleepTimerEnded) {
        this.handleWatchProgressAutoSaveWhenProgressEnabled()
        return
      }

      this.handleVideoEnded()
    },

    handleTerminalOutroStarted: function (currentSeconds) {
      this.markAsWatchedIfFinished(currentSeconds, true)
    },

    handleVideoEnded: function () {
      if (!this.isCurrentlyPresented()) {
        return
      }
      this.handleWatchProgressAutoSaveWhenProgressEnabled()
      // Standalone YouTube-style Shorts stop for the replay control instead of
      // advancing. Playlist Shorts still follow the playlist autoplay setting.
      if (this.customShortsPlayerActive && this.isStandaloneShort) {
        return
      }
      if (this.playNextQueuedVideo()) {
        return
      }
      if (this.isStandaloneShort) {
        return
      }
      if (!this.autoplayEnabled) {
        return
      }

      if (this.blockVideoAutoplay) {
        showToast({
          message: this.t('Autoplay Interruption Timer',
            this.defaultAutoplayInterruptionIntervalHours,
            {
              autoplayInterruptionIntervalHours: this.defaultAutoplayInterruptionIntervalHours
            }),
          time: 3_600_000,
          icon: ['fas', 'clock'],
        })
        this.resetAutoplayInterruptionTimeout()
        return
      }

      if (this.watchingPlaylist && this.$refs.watchVideoPlaylist?.shouldStopDueToPlaylistEnd) {
        // Let `watchVideoPlaylist` handle end of playlist, no countdown needed
        this.$refs.watchVideoPlaylist.playNextVideo()
        return
      }

      const nextVideo = this.watchingPlaylist
        ? this.$refs.watchVideoPlaylist?.nextVideo
        : this.nextRecommendedVideo

      if (!nextVideo?.videoId) {
        return
      }

      const nextVideoInterval = this.defaultInterval
      this.playNextTimeout = setTimeout(() => {
        this.playNextVideoNow(false)
      }, nextVideoInterval * 1000)

      if (nextVideoInterval > 0) {
        const autoplayVideo = { ...nextVideo }

        if (this.$store.getters.getAvoidTranslation === 'entire_app') {
          const cachedTitle = getCachedOembedTitle(nextVideo.videoId)
          if (cachedTitle !== null) {
            autoplayVideo.title = cachedTitle
          } else {
            getOembedTitle(nextVideo.videoId).then((title) => {
              if (title && this.autoplayCountdown?.video?.videoId === nextVideo.videoId) {
                this.autoplayCountdown = {
                  ...this.autoplayCountdown,
                  video: {
                    ...this.autoplayCountdown.video,
                    title
                  }
                }
              }
            })
          }
        }

        const countdownEndsAt = Date.now() + (nextVideoInterval * 1000)
        this.autoplayCountdown = {
          remainingSeconds: nextVideoInterval,
          video: autoplayVideo
        }
        this.playNextCountDownIntervalId = setInterval(() => {
          const remainingSeconds = Math.max(1, Math.ceil((countdownEndsAt - Date.now()) / 1000))
          this.autoplayCountdown = {
            ...this.autoplayCountdown,
            remainingSeconds
          }
        }, 250)
      }
    },

    playNextVideoNow: function (forcePlayback = true) {
      const player = this.$refs.player
      const nextVideoId = this.autoplayCountdown?.video?.videoId ?? this.nextRecommendedVideo?.videoId

      this.abortAutoplayCountdown(true)

      if (!forcePlayback && !player?.isPaused()) {
        return
      }

      if (this.watchingPlaylist) {
        this.$refs.watchVideoPlaylist?.playNextVideo()
      } else if (nextVideoId) {
        this.tabRouter.push({
          path: `/watch/${nextVideoId}`
        })
        showToast({ message: this.t('Playing Next Video'), icon: ['fas', 'step-forward'] })
      }
    },

    // Skip to the next video if in a playlist
    // else next recommended video if autoplay enabled
    handleSkipToNext: function () {
      if (this.playNextQueuedVideo()) {
        return
      }
      if (this.watchingPlaylist) {
        this.$refs.watchVideoPlaylist?.playNextVideo()
      } else if (!this.hideRecommendedVideos && this.nextRecommendedVideo) {
        this.tabRouter.push({
          path: `/watch/${this.nextRecommendedVideo.videoId}`
        })
        showToast({ message: this.t('Playing Next Video'), icon: ['fas', 'step-forward'] })
      }
    },

    playNextQueuedVideo: function () {
      const nextVideo = this.nextQueuedVideo
      if (!nextVideo?.videoId) {
        return false
      }

      this.$store.commit('removeVideoFromWatchQueue', nextVideo.queueItemId)
      this.tabRouter.push({ path: `/watch/${nextVideo.videoId}` })
      showToast({ message: this.t('Playing Next Video'), icon: ['fas', 'step-forward'] })
      return true
    },

    /**
     * @param {{ canPlayNext: boolean, canPlayPrevious: boolean }} availability
     */
    handlePlaylistSkipAvailabilityChange: function (availability) {
      this.playlistSkipAvailability = availability
    },

    // Keeps the operating system's media controls in sync with the player's skip
    // buttons, so that both offer the same skips and take the same route to them
    syncMediaSessionSkipHandlers: function () {
      tabMediaCoordinator.setActionHandlers(this.tabId ?? 'web', 'playlist', {
        previoustrack: this.canSkipToPreviousVideo ? this.handleSkipToPrev : null,
        nexttrack: this.canSkipToNextVideo ? this.handleSkipToNext : null
      })
    },

    // Skip to the previous video in a playlist
    handleSkipToPrev: function () {
      this.$refs.watchVideoPlaylist?.playPreviousVideo()
    },

    abortAutoplayCountdown: function (hideToast = false) {
      clearTimeout(this.playNextTimeout)
      clearInterval(this.playNextCountDownIntervalId)
      this.playNextTimeout = null
      this.playNextCountDownIntervalId = null
      this.autoplayCountdown = null

      if (!hideToast) {
        showToast({ message: this.t('Canceled next video autoplay'), icon: ['fas', 'times-circle'] })
      }
    },

    handleRouteChange: async function () {
      this.abortAutoplayCountdown(true)
      this.handleWatchProgressAutoSave()
      await this.flushWatchTime()
    },

    /**
     * Starts the one stream-error recovery allowed for the current video.
     * @param {string} specificError
     * @returns {boolean} whether recovery started
     */
    beginStreamErrorRecoveryOnce: function (specificError) {
      if (this.streamErrorReloadAttemptedForCurrentVideo) {
        return false
      }

      this.streamErrorReloadAttemptedForCurrentVideo = true
      this.handleWatchProgressAutoSaveWhenProgressEnabled()
      this.showTabToast({
        message: `${this.t('Video.Reloading video after streaming URL error')}: ${specificError}`,
        icon: ['fas', 'sync'],
      })
      return true
    },

    /**
     * Reload once for a playback error that may be fixed by fetching fresh
     * streaming data.
     * @param {string} specificError
     * @returns {Promise<boolean>} whether a reload was started
     */
    reloadAfterStreamErrorOnce: async function (specificError) {
      if (!this.beginStreamErrorRecoveryOnce(specificError)) {
        return false
      }

      await this.reloadView()
      return true
    },

    isAndroidTransientHttpRecoveryEnabled() {
      return process.env.IS_CAPACITOR
    },

    async retryAndroidTransientHttpError() {
      if (this.androidHttpErrorRecoveryAttemptedForCurrentVideo) return false

      this.androidHttpErrorRecoveryAttemptedForCurrentVideo = true
      const videoId = this.videoId
      await new Promise(resolve => setTimeout(resolve, ANDROID_HTTP_ERROR_RETRY_DELAY_MS))
      if (videoId !== this.videoId || this.isLoading) return true
      return this.$refs.player?.retryStreaming() === true
    },

    /**
     * Refreshes yt-dlp's streams and recreates only the player. The watch-page
     * metadata and the built-in fallback source stay loaded.
     * @param {string} specificError
     * @param {unknown} [playbackUrl] exact URL to verify after a timeout
     * @returns {Promise<boolean>} whether recovery handled the error
     */
    reloadYtDlpPlayerAfterStreamErrorOnce: async function (specificError, playbackUrl) {
      if (!this.beginStreamErrorRecoveryOnce(specificError)) {
        return false
      }

      const loadGeneration = this.videoLoadGeneration
      const videoId = this.videoId
      const playbackEngineSwitchGeneration = this.playbackEngineSwitchGeneration
      this.setPlayerReloadState(this.$refs.player?.getSabrReloadState())
      this.initializeVideoQuality()

      const timestamp = this.getTimestamp()
      if (timestamp > 0) {
        this.oneTimeTimestamp = timestamp
      }

      if (this.$refs.player) {
        await this.destroyPlayer()
      }

      if (
        !this.isCurrentVideoLoad(loadGeneration, videoId) ||
        playbackEngineSwitchGeneration !== this.playbackEngineSwitchGeneration
      ) {
        return true
      }

      const playbackUrlStatus = playbackUrl === undefined
        ? 'inconclusive'
        : await checkYtDlpPlaybackUrl(playbackUrl)

      if (
        !this.isCurrentVideoLoad(loadGeneration, videoId) ||
        playbackEngineSwitchGeneration !== this.playbackEngineSwitchGeneration
      ) {
        return true
      }

      if (playbackUrlStatus === 'rejected') {
        invalidateYtDlpPlaybackSource(videoId)
      }

      this.ytDlpStreamsPending = true
      await this.$nextTick()

      try {
        return await this.extractYtDlpPlaybackSource(
          loadGeneration,
          videoId,
          playbackEngineSwitchGeneration
        )
      } finally {
        if (
          this.isCurrentVideoLoad(loadGeneration, videoId) &&
          playbackEngineSwitchGeneration === this.playbackEngineSwitchGeneration
        ) {
          this.ytDlpStreamsPending = false
        }
      }
    },

    /**
     * @param {import('shaka-player/dist/shaka-player.ui').default.util.Error} error
     */
    handlePlayerError: async function (error) {
      // the error is logged to the console inside the player so we don't have to do it here

      // The player is only rendered while loading is false. An error received
      // after loading starts belongs to the outgoing player during its unmount
      // tick and must not change the new player's format or trigger a reload.
      if (this.isLoading) {
        return
      }

      const { Code } = shaka.util.Error

      if (error.code === Code.HTTP_ERROR) {
        if (error.data[1]?.message === 'Failed to fetch' && !navigator.onLine) {
          // Internet connection was lost, do nothing on our side as
          // shaka-player will keep trying until the internet connection returns and resume playback automatically when it does
          return
        }

        if (this.isAndroidTransientHttpRecoveryEnabled() && await this.retryAndroidTransientHttpError()) {
          return
        }
      }

      // A terminal player error can still come from a transiently bad yt-dlp
      // URL or extraction. Refresh those streams once before changing format or
      // restoring the cached built-in source (which may use SABR).
      if (this.activePlaybackEngine === 'yt-dlp') {
        if (error.code !== Code.TIMEOUT) {
          invalidateYtDlpPlaybackSource(this.videoId)
        }
        const status = error.code === Code.BAD_HTTP_STATUS ? error.data[1] : error.code
        const playbackUrl = error.code === Code.TIMEOUT ? error.data?.[0] : undefined
        if (await this.reloadYtDlpPlayerAfterStreamErrorOnce(`[PLAYER_ERROR: ${status}]`, playbackUrl)) {
          return
        }
      }

      if (error.code === Code.BAD_HTTP_STATUS) {
        switch (error.data[1]) {
          case 429:
            this.handleWatchProgressAutoSaveWhenProgressEnabled()

            if (await this.tryPlaybackEngineFallback(error)) {
              return
            }

            this.errorMessage = '[BAD_HTTP_STATUS: 429] Ratelimited'
            return
          case 403:
            this.handleWatchProgressAutoSaveWhenProgressEnabled()

            // Streaming URLs are bound to the IP they were issued to, so they also
            // start returning 403 when our own IP changes (reconnect, prefix rotation,
            // VPN switch). An expired watch session likewise needs a fresh fetch.
            // Reload once before escalating — to the IP block recovery script, or to
            // the session-expired error — so the genuine failure paths are unchanged
            // apart from the extra reload before them.
            {
              const sessionExpired = new Date() > this.streamingDataExpiryDate
              const specificError = sessionExpired
                ? '[BAD_HTTP_STATUS: 403] YouTube watch session expired. Please reopen this video.'
                : this.videoGenreIsMusic
                  ? '[BAD_HTTP_STATUS: 403] Potential causes: IP block, streaming URL deciphering failed or music video geo-block'
                  : '[BAD_HTTP_STATUS: 403] Potential causes: IP block or streaming URL deciphering failed'

              if (await this.reloadAfterStreamErrorOnce(specificError)) {
                return
              }

              if (await this.tryPlaybackEngineFallback(error)) {
                return
              }

              if (sessionExpired) {
                this.errorMessage = specificError
                this.customErrorIcon = ['fas', 'clock']
                return
              }

              this.errorMessage = specificError
              this.ipBlockDetectedInCurrentChain = true
              await this.runIpBlockRecoveryScriptAndReload()
              return
            }
        }
      } else if (error.code === Code.VIDEO_ERROR) {
        if (this.activeFormat === 'legacy') {
          if (new Date() > this.streamingDataExpiryDate) {
            this.handleWatchProgressAutoSaveWhenProgressEnabled()

            const specificError = '[VIDEO_ERROR] YouTube watch session expired. Please reopen this video.'

            if (await this.reloadAfterStreamErrorOnce(specificError)) {
              return
            }

            if (await this.tryPlaybackEngineFallback(error)) {
              return
            }

            this.errorMessage = specificError
            this.customErrorIcon = ['fas', 'clock']
            return
          }
        }
      }

      if (
        await this.reloadSabrStream(
          this.$refs.player?.getSabrReloadState(),
          'Refreshing SABR stream after playback error'
        )
      ) { return }

      // yt-dlp legacy formats come from the same extraction as its DASH
      // formats. Prefer the independent built-in source after the one-shot
      // yt-dlp refresh above, and keep legacy as the last resort when no
      // built-in source is available.
      if (
        this.activePlaybackEngine === 'yt-dlp' &&
        await this.tryPlaybackEngineFallback(error)
      ) {
        return
      }

      const stopPlaybackRecovery = async () => {
        if (await this.tryPlaybackEngineFallback(error)) {
          return
        }

        this.handleWatchProgressAutoSaveWhenProgressEnabled()
        const status = error.code === Code.BAD_HTTP_STATUS ? error.data[1] : error.code
        this.errorMessage = `[PLAYER_ERROR: ${status}] Unable to recover the video stream. Please reload this video.`
      }

      if (
        this.activeFormat === 'dash' &&
        this.manifestMimeType === MANIFEST_TYPE_SABR &&
        !this.isLive &&
        !this.isPostLiveDvr &&
        this.legacyFormats.length === 0
      ) {
        // Audio is an explicit playback mode, not a degraded video fallback.
        // Keep the bounded refresh behavior above, then stop with the actual
        // error instead of briefly replacing the video player with audio.
        await stopPlaybackRecovery()
        return
      }

      if (this.isLive || this.isPostLiveDvr) {
        if (this.activeFormat === 'dash') {
          await stopPlaybackRecovery()
        } else {
          console.error('Unable to play audio formats. Reverting to DASH formats...')
          this.enableDashFormat()
        }
      } else {
        // Audio remains available when explicitly selected, but a broken video
        // stream must never silently turn into audio-only playback.

        switch (this.activeFormat) {
          case 'dash':
            if (this.legacyFormats.length > 0) {
              console.error('Unable to play DASH formats. Reverting to legacy formats...')
              this.enableLegacyFormat()
            } else {
              await stopPlaybackRecovery()
            }
            break
          case 'legacy':
            await stopPlaybackRecovery()
            break
          case 'audio':
            console.error('Unable to play audio formats. Reverting to DASH formats...')
            this.enableDashFormat()
            break
        }
      }
    },

    /**
     * Tries the other playback engine once after the selected engine exhausts
     * its own stream recovery options.
     * @param {import('shaka-player/dist/shaka-player.ui').default.util.Error} error
     * @returns {Promise<boolean>}
     */
    tryPlaybackEngineFallback: async function (error) {
      if (
        !supportsYtDlp ||
        this.playbackEngineFallbackAttemptedForCurrentVideo ||
        this.isUpcoming
      ) {
        return false
      }

      const status = error.code === shaka.util.Error.Code.BAD_HTTP_STATUS
        ? error.data[1]
        : error.code
      const reason = `[PLAYER_ERROR: ${status}]`
      const loadGeneration = this.videoLoadGeneration
      const videoId = this.videoId
      const playbackEngineSwitchGeneration = this.playbackEngineSwitchGeneration

      if (this.activePlaybackEngine === 'yt-dlp') {
        const source = this.builtInPlaybackSource
        if (
          source === null ||
          (source.manifestSrc === null && source.legacyFormats.length === 0) ||
          (
            source.streamingDataExpiryDate !== null &&
            new Date() > source.streamingDataExpiryDate
          )
        ) {
          return false
        }

        this.playbackEngineFallbackAttemptedForCurrentVideo = true
        this.playbackEngineFallbackTarget = 'built-in'

        if (this.$refs.player) {
          await this.destroyPlayer()
        }

        if (
          !this.isCurrentVideoLoad(loadGeneration, videoId) ||
          playbackEngineSwitchGeneration !== this.playbackEngineSwitchGeneration
        ) {
          return true
        }

        this.ytDlpStreamsPending = true
        await this.$nextTick()
        if (
          !this.isCurrentVideoLoad(loadGeneration, videoId) ||
          playbackEngineSwitchGeneration !== this.playbackEngineSwitchGeneration
        ) {
          return true
        }

        this.manifestSrc = source.manifestSrc
        this.manifestMimeType = source.manifestMimeType
        this.sabrData = source.sabrData
        this.legacyFormats = source.legacyFormats
        this.streamingDataExpiryDate = source.streamingDataExpiryDate
        this.activePlaybackEngine = 'built-in'
        this.activePlaybackEngineVersion = null

        this.alignActiveFormatWithAvailableSources()

        this.showTabToast({
          message: this.t('Change Format.yt-dlp Fallback Template', { error: reason }),
          icon: ['fas', 'exchange-alt'],
        })
        this.ytDlpStreamsPending = false
        return true
      }

      this.playbackEngineFallbackAttemptedForCurrentVideo = true
      this.playbackEngineFallbackTarget = 'yt-dlp'

      if (this.$refs.player) {
        await this.destroyPlayer()
      }

      if (
        !this.isCurrentVideoLoad(loadGeneration, videoId) ||
        playbackEngineSwitchGeneration !== this.playbackEngineSwitchGeneration
      ) {
        return true
      }

      this.ytDlpStreamsPending = true
      this.showTabToast({
        message: this.t('Change Format.Built-in Fallback Template', { error: reason }),
        icon: ['fas', 'exchange-alt'],
      })

      try {
        const fallbackApplied = await this.extractYtDlpPlaybackSource(
          loadGeneration,
          videoId,
          playbackEngineSwitchGeneration
        )
        if (
          !this.isCurrentVideoLoad(loadGeneration, videoId) ||
          playbackEngineSwitchGeneration !== this.playbackEngineSwitchGeneration
        ) {
          return true
        }
        if (!fallbackApplied) {
          this.playbackEngineFallbackTarget = null
        }
        return fallbackApplied
      } catch (fallbackError) {
        if (
          !this.isCurrentVideoLoad(loadGeneration, videoId) ||
          playbackEngineSwitchGeneration !== this.playbackEngineSwitchGeneration
        ) {
          return true
        }
        this.playbackEngineFallbackTarget = null
        console.error('Falling back to yt-dlp playback failed', fallbackError)
        return false
      } finally {
        if (
          this.isCurrentVideoLoad(loadGeneration, videoId) &&
          playbackEngineSwitchGeneration === this.playbackEngineSwitchGeneration
        ) {
          this.ytDlpStreamsPending = false
        }
      }
    },

    alignActiveFormatWithAvailableSources: function () {
      if (
        (this.activeFormat === 'dash' || this.activeFormat === 'audio') &&
        this.manifestSrc === null &&
        this.legacyFormats.length > 0
      ) {
        this.activeFormat = 'legacy'
      } else if (this.activeFormat === 'legacy' && this.legacyFormats.length === 0 && this.manifestSrc !== null) {
        this.activeFormat = 'dash'
      } else if (this.activeFormat === 'audio' && !this.audioFormatAvailable) {
        this.activeFormat = 'dash'
      }
    },

    /**
     * Replaces the streams that the backend provided with the ones yt-dlp extracts.
     * Metadata keeps coming from the backend, except that yt-dlp captions fill in when
     * restricted playback leaves the backend caption list empty.
     *
     * The callers don't await this, they only wait for the metadata. `ytDlpStreamsPending`
     * is set synchronously here, so the player is held back (behind a thumbnail
     * placeholder) until the streams it should play are known.
     * @param {number} loadGeneration
     * @param {string} videoId
     */
    applyYtDlpPlaybackSource: async function (loadGeneration, videoId) {
      const playbackEngineSwitchGeneration = this.playbackEngineSwitchGeneration
      const liveSourceMissing =
        this.isLive &&
        this.manifestSrc === null &&
        this.legacyFormats.length === 0
      const builtInLiveSourceMissing =
        this.videoPlaybackEngine === 'built-in' &&
        liveSourceMissing

      // A manual Built-in selection is authoritative. If its metadata reload
      // still has no live source, report that result instead of silently
      // switching back to yt-dlp or leaving an unexplained empty player area.
      if (liveSourceMissing && this.playbackEngineFallbackTarget === 'built-in') {
        this.ytDlpStreamsPending = false
        this.errorMessage = this.t('This video is unavailable because of missing formats. This can happen due to country unavailability.')
        return
      }

      if (
        !supportsYtDlp ||
        this.playbackEngineFallbackTarget === 'built-in' ||
        (
          this.videoPlaybackEngine !== 'yt-dlp' &&
          this.playbackEngineFallbackTarget !== 'yt-dlp' &&
          !builtInLiveSourceMissing
        )
      ) {
        return
      }

      this.ytDlpStreamsPending = true

      try {
        const sourceApplied = await this.extractYtDlpPlaybackSource(
          loadGeneration,
          videoId,
          playbackEngineSwitchGeneration
        )

        if (playbackEngineSwitchGeneration !== this.playbackEngineSwitchGeneration) {
          return
        }

        if (
          !sourceApplied &&
          this.isCurrentVideoLoad(loadGeneration, videoId) &&
          this.playbackEngineFallbackTarget === 'yt-dlp' &&
          this.ipBlockDetectedInCurrentChain
        ) {
          this.playbackEngineFallbackTarget = null
          const didReload = await this.runIpBlockRecoveryScriptAndReload()
          if (!this.isCurrentVideoLoad(loadGeneration, videoId) || didReload) {
            return
          }
          this.errorMessage = this.t('Video.IP block')
          return
        }

        if (
          !sourceApplied &&
          this.isCurrentVideoLoad(loadGeneration, videoId) &&
          playbackEngineSwitchGeneration === this.playbackEngineSwitchGeneration &&
          this.manifestSrc === null &&
          this.legacyFormats.length === 0
        ) {
          this.errorMessage = this.t('This video is unavailable because of missing formats. This can happen due to country unavailability.')
        }
      } catch (error) {
        // The callers don't await this, so nothing else can handle it.
        console.error('Applying the yt-dlp playback source failed', error)
        if (
          this.isCurrentVideoLoad(loadGeneration, videoId) &&
          playbackEngineSwitchGeneration === this.playbackEngineSwitchGeneration &&
          this.manifestSrc === null &&
          this.legacyFormats.length === 0
        ) {
          this.errorMessage = this.t('This video is unavailable because of missing formats. This can happen due to country unavailability.')
        }
      } finally {
        // A stale load has already had its state reset (and may have started its own
        // extraction), so it must not clear the flag of the load that replaced it.
        if (
          this.isCurrentVideoLoad(loadGeneration, videoId) &&
          playbackEngineSwitchGeneration === this.playbackEngineSwitchGeneration
        ) {
          this.ytDlpStreamsPending = false
        }
      }
    },

    /**
     * @param {number} loadGeneration
     * @param {string} videoId
     * @param {number} playbackEngineSwitchGeneration
     * @param {boolean} useAuthentication
     * @param {boolean} cachedOnly
     */
    extractYtDlpPlaybackSource: async function (
      loadGeneration,
      videoId,
      playbackEngineSwitchGeneration = this.playbackEngineSwitchGeneration,
      useAuthentication = this.alwaysUseYtDlpPlaybackCookies,
      cachedOnly = false
    ) {
      let source
      try {
        source = await getYtDlpPlaybackSource(videoId, this.ytDlpPlaybackCacheKey, () => {
          if (
            this.isCurrentVideoLoad(loadGeneration, videoId) &&
            playbackEngineSwitchGeneration === this.playbackEngineSwitchGeneration &&
            !this.ytDlpDefaultClientsFallbackToastShown
          ) {
            this.ytDlpDefaultClientsFallbackToastShown = true
            this.showTabToast({
              message: this.t('Change Format.yt-dlp Default Clients Fallback'),
              icon: ['fas', 'exchange-alt'],
            })
          }
        }, useAuthentication, cachedOnly, this.captions.length === 0)
      } catch (error) {
        if (
          !this.isCurrentVideoLoad(loadGeneration, videoId) ||
          playbackEngineSwitchGeneration !== this.playbackEngineSwitchGeneration
        ) { return false }

        console.error(`yt-dlp could not provide streams for ${videoId}`, error)
        this.showTabToast({
          message: useAuthentication
            ? this.t('Video.Restricted Playback Authentication Failed Template', { error: error.message })
            : this.t('Change Format.yt-dlp Fallback Template', { error: error.message }),
          time: 7000,
          icon: ['fas', 'circle-exclamation'],
        })
        return false
      }

      if (source === null) { return false }

      if (
        !this.isCurrentVideoLoad(loadGeneration, videoId) ||
        playbackEngineSwitchGeneration !== this.playbackEngineSwitchGeneration
      ) { return false }

      if (this.playbackEngineFallbackTarget === 'built-in' && !cachedOnly) { return false }

      if (this.activePlaybackEngine !== 'yt-dlp') {
        this.builtInPlaybackSource = {
          manifestSrc: this.manifestSrc,
          manifestMimeType: this.manifestMimeType,
          sabrData: this.sabrData,
          legacyFormats: this.legacyFormats,
          streamingDataExpiryDate: this.streamingDataExpiryDate
        }
      }

      this.manifestSrc = source.manifestSrc
      this.manifestMimeType = source.manifestMimeType
      this.legacyFormats = source.legacyFormats
      this.isLive = source.isLive
      if (Number.isFinite(source.duration) && source.duration > 0) {
        this.videoLengthSeconds = source.duration
      }
      if (this.videoStoryboardSrc === '' && source.storyboardSrc) {
        this.videoStoryboardSrc = source.storyboardSrc
      }
      if (this.captions.length === 0 && source.captions.length > 0) {
        const languageNames = new Intl.DisplayNames([this.currentLocale, 'en'], { type: 'language' })
        const getLanguageName = (language, fallback) => {
          try {
            return languageNames.of(language) ?? fallback
          } catch {
            return fallback
          }
        }

        this.captions = sortCaptions(source.captions.map(caption => ({
          ...caption,
          label: caption.isAutoGenerated
            ? this.t('Video.Player.Auto-generated Caption Template', { language: caption.label })
            : caption.label
        })), this.preferredCaptionLocale)
        this.captionTranslations = source.captionTranslations.map(caption => {
          if (!caption.originalLanguage) return caption

          const translationName = getLanguageName(caption.language, caption.translationName)
          const originalLanguage = getLanguageName(caption.originalLanguage, caption.originalLanguage)

          return {
            ...caption,
            label: this.t('Video.Player.TranslatedCaptionTemplate', {
              language: translationName,
              originalLanguage
            }),
            translationName
          }
        })
      }
      // HLS manifests refresh themselves, so they don't expire the way the stream URLs do.
      // Keeping the backend's date stops playback errors from being blamed on an
      // expired session, which is what a missing date would compare as.
      if (source.expiryDate !== null) {
        this.streamingDataExpiryDate = source.expiryDate
      }
      // SABR specific state, which no longer applies now that the streams come from yt-dlp
      this.sabrData = null
      this.activePlaybackEngine = 'yt-dlp'
      this.activePlaybackEngineVersion = source.version
      this.errorMessage = null

      if (!this.hasResolvedVideoTitle && source.title) {
        this.videoTitle = source.title
        this.hasResolvedVideoTitle = true
        this.updateTitle()
      }

      this.alignActiveFormatWithAvailableSources()

      return true
    },

    /**
     * @param {import('youtubei.js').YT.VideoInfo} videoInfo
     * @param {boolean} includeThumbnails
     */
    createLocalDashManifest: async function (videoInfo, includeThumbnails = false) {
      const formats = new Set(getCompatibleAdaptiveFormats(videoInfo.streaming_data.adaptive_formats))
      const xmlData = await videoInfo.toDash({
        format_filter: format => format.has_video && !format.has_audio && !formats.has(format),
        manifest_options: {
          include_thumbnails: includeThumbnails,
        },
      })

      return `data:application/dash+xml;charset=UTF-8,${encodeURIComponent(xmlData)}`
    },

    /**
     * @param {import('youtubei.js').IParsedResponse} videoInfo
     * @param {string} poToken
     * @param {SabrData['clientInfo']} clientInfo
     * @param {import('../../helpers/player/SabrManifestParser').SabrManifest['storyboards']} storyboards
     */
    createLocalSabrManifest: function (videoInfo, poToken, clientInfo, storyboards) {
      const url = new URL(videoInfo.streaming_data.server_abr_streaming_url)
      url.searchParams.set('cpn', videoInfo.cpn)
      // Shaka's scheme registry is renderer-global. Each retained tab therefore
      // needs its own scheme so one SABR player cannot replace or unregister
      // another player's request handler.
      const scheme = `sabr${nextSabrSchemeId++}`
      const formats = getCompatibleAdaptiveFormats(videoInfo.streaming_data.adaptive_formats)
      const formatDurationsMs = formats
        .map(format => format.approx_duration_ms)
        .filter(Number.isFinite)
      const fallbackDurationSeconds = Number.isFinite(videoInfo.basic_info.duration)
        ? videoInfo.basic_info.duration
        : 0

      this.sabrData = {
        scheme,
        url: url.toString(),
        poToken,
        ustreamerConfig: videoInfo.player_config.media_common_config.media_ustreamer_request_config.video_playback_ustreamer_config,
        clientInfo
      }

      /** @type {import('../../helpers/player/SabrManifestParser').SabrManifest} */
      const sabrManifest = {
        scheme,
        // Different formats have different durations and
        // use of slightly longer duration in PresentationTimeline causes player to stuck at the end
        duration: formatDurationsMs.length > 0
          ? Math.min(...formatDurationsMs) / 1000
          : fallbackDurationSeconds,
        formats: formats.map((format) => ({
          itag: format.itag,
          lastModified: format.last_modified_ms,
          mimeType: format.mime_type,
          xtags: format.xtags,
          bitrate: format.bitrate,
          initRange: format.init_range,
          indexRange: format.index_range,
          width: format.width,
          height: format.height,
          frameRate: format.fps,
          quality: format.quality,
          language: format.language,
          audioSampleRate: format.audio_sample_rate,
          audioChannels: format.audio_channels,
          isDrc: format.is_drc,
          isVoiceBoost: format.is_vb,
          isOriginal: format.is_original,
          isDubbed: format.is_dubbed,
          isAutoDubbed: format.is_auto_dubbed,
          isDescriptive: format.is_descriptive,
          isSecondary: format.is_secondary,
          spatialAudio: !!format.spatial_audio_type,
          label: format.audio_track?.display_name,
          colorTransferCharacteristics: format.color_info?.transfer_characteristics,
          colorPrimaries: format.color_info?.primaries
        })),
        captions: this.captions,
        chapters: this.videoChapters,
        storyboards
      }

      return `data:${MANIFEST_TYPE_SABR},${encodeURIComponent(JSON.stringify(sabrManifest))}`
    },

    createInvidiousDashManifest: async function (result) {
      let url = `${this.currentInvidiousInstanceUrl}/api/manifest/dash/id/${this.videoId}`

      // If we are in Electron,
      // we can use YouTube.js' DASH manifest generator to generate the manifest.
      // Using YouTube.js' gives us support for multiple audio tracks (currently not supported by Invidious)
      if (process.env.SUPPORTS_LOCAL_API) {
        const adaptiveFormats = await this.getAdaptiveFormatsInvidious(result)

        /** @type {import('youtubei.js').Misc.Format[]} */
        const formats = []

        /** @type {import('youtubei.js').Misc.Format[]} */
        const audioFormats = []

        let hasMultipleAudioTracks = false

        for (const format of adaptiveFormats) {
          const localFormat = convertInvidiousToLocalFormat(format)

          if (localFormat.has_audio) {
            audioFormats.push(localFormat)

            if (localFormat.is_dubbed || localFormat.is_descriptive || localFormat.is_secondary || localFormat.is_auto_dubbed) {
              hasMultipleAudioTracks = true
            }
          }

          formats.push(localFormat)
        }

        if (hasMultipleAudioTracks) {
          // match YouTube's local API response with English
          const languageNames = new Intl.DisplayNames('en-US', { type: 'language', languageDisplay: 'standard' })
          for (const format of audioFormats) {
            generateAudioTrackField(format, languageNames)
          }
        }

        const manifest = await generateInvidiousDashManifestLocally(formats)

        url = `data:application/dash+xml;charset=UTF-8,${encodeURIComponent(manifest)}`
      } else if (this.proxyVideos) {
        url += '?local=true'
      }

      return url
    },

    getAdaptiveFormatsInvidious: async function (existingInfoResult = null) {
      let result
      if (existingInfoResult) {
        result = existingInfoResult
      } else {
        result = await invidiousGetVideoInformation(this.videoId)
      }

      result.adaptiveFormats.forEach((format) => {
        format.bitrate = parseInt(format.bitrate)

        // audio streams don't have a size property
        if (typeof format.size === 'string') {
          const [stringWidth, stringHeight] = format.size.split('x')

          format.width = parseInt(stringWidth)
          format.height = parseInt(stringHeight)
        }
      })

      return result.adaptiveFormats
    },

    /**
     * @param {import('youtubei.js/dist/src/parser/classes/PlayerStoryboardSpec').StoryboardData} storyboardInfo
     * @returns {string}
     */
    createLocalStoryboardUrls: function (storyboardInfo) {
      const results = buildVTTFileLocally(storyboardInfo, this.videoLengthSeconds)

      return `data:text/vtt;charset=utf-8,${encodeURIComponent(results)}`
    },

    /**
     * @param {import('youtubei.js').YTNodes.PlayerCaptionsTracklist} captions
     * @param {Set<string>} userLanguages
     * @returns {null|{ url: string, label: string, language: string, mimeType: string, isAutotranslated: boolean }}
     */
    getTranslatedLocaleCaption: function (captions, userLanguages) {
      // check if we can translate to the users language
      let translationLanguage = captions.translation_languages.find(language => userLanguages.has(language.language_code))

      // Otherwise use the preferred caption locale and hope that YouTube can handle it.
      if (!translationLanguage) {
        const languageCode = userLanguages.values().next().value
        translationLanguage = {
          language_code: languageCode,
          language_name: {
            text: this.$store.getters.getPreferredCaptionLocale
              ? new Intl.DisplayNames([this.currentLocale, 'en'], { type: 'language' }).of(languageCode) ?? languageCode
              : this.t('Locale Name')
          }
        }
      }

      return this.getTranslatedCaption(captions, translationLanguage)
    },

    /**
     * @param {import('youtubei.js').YTNodes.PlayerCaptionsTracklist} captions
     * @param {{ language_code: string, language_name: { text: string } }} translationLanguage
     * @returns {null|{ url: string, label: string, language: string, mimeType: string, isAutotranslated: boolean }}
     */
    getTranslatedCaption: function (captions, translationLanguage) {
      const translationName = translationLanguage.language_name.text
      const translationCode = translationLanguage.language_code

      let trackToTranslate

      const autoGeneratedCaptionTrack = captions.caption_tracks.find(track => track.kind === 'asr')
      if (autoGeneratedCaptionTrack) {
        // Check if there is a user uploaded caption track in the language of the video, as that is more trustworthy than auto-generated captions
        const userUploadedCaptionTrack = captions.caption_tracks.find(track => track.kind !== 'asr' && track.language_code === autoGeneratedCaptionTrack.language_code)

        // Fallback to the auto-generated track if there is no user uploaded one that matches the video language
        trackToTranslate = userUploadedCaptionTrack ?? autoGeneratedCaptionTrack
      } else {
        // if there is no auto-generated track choose the first translatable track
        trackToTranslate = captions.caption_tracks.find(track => track.is_translatable) ?? captions.caption_tracks[0]
      }

      if (!trackToTranslate) {
        return null
      }

      const url = new URL(trackToTranslate.base_url)
      // Requesting fmt=vtt with the tlang parameter set returns HTTP 429 errors, but requesting srt instead seems to work
      url.searchParams.set('fmt', 'srt')
      url.searchParams.set('tlang', translationCode)

      const label = this.t('Video.Player.TranslatedCaptionTemplate', {
        language: translationName,
        originalLanguage: trackToTranslate.name.text
      })

      return {
        id: `${trackToTranslate.vss_id}.${translationCode}`,
        url: url.toString(),
        label,
        translationName,
        language: translationCode,
        mimeType: 'text/srt',
        isAutotranslated: true
      }
    },

    pausePlayer: function () {
      const player = this.$refs.player

      if (player && !player.isPaused()) {
        player.pause()
      }
    },

    getWatchedProgress: function () {
      const player = this.$refs.player

      if (!this.isLoading && player?.hasLoaded) {
        return player.getCurrentTime()
      }

      return 0
    },

    getTimestamp: function () {
      return Math.floor(this.getWatchedProgress())
    },

    getPlaylistState: function () {
      return this.$refs.watchVideoPlaylist?.getState() ??
        { index: -1, reverse: false, shuffle: false, loop: false }
    },

    updateTitle: function () {
      this.setTabTitle(
        this.videoTitle || this.getPendingVideoTitle(),
        { resolveHistoryEntry: this.hasResolvedVideoTitle }
      )
    },

    isHiddenVideo: function (forbiddenTitles, channelsHidden, video) {
      return channelsHidden.some(ch => ch.name === video.authorId) ||
        channelsHidden.some(ch => ch.name === video.author) ||
        forbiddenTitles.some((text) => video.title?.toLowerCase().includes(text)) ||
        forbiddenTitles.some((text) => video.author?.toLowerCase().includes(text))
    },

    toggleAutoplay: function() {
      if (this.isShort) {
        return
      }
      if (this.autoplayEnabled && this.playNextTimeout) {
        this.abortAutoplayCountdown()
      }

      if (this.watchingPlaylist) {
        this.autoplayNextPlaylistVideo = !this.autoplayEnabled
      } else {
        this.autoplayNextRecommendedVideo = !this.autoplayEnabled
      }
    },

    handleSponsorBlockAutoSkipToggle: function(enabled) {
      this.sponsorBlockAutoSkipTemporarilyDisabled = !enabled
    },

    handleSponsorBlockChannelWhitelistToggle: function(whitelisted) {
      if (!this.channelId) {
        return
      }

      const whitelist = new Set(this.sponsorBlockChannelWhitelist)
      if (whitelisted) {
        whitelist.add(this.channelId)
      } else {
        whitelist.delete(this.channelId)
      }

      this.$store.dispatch('updateSponsorBlockChannelWhitelist', [...whitelist])
    },

    updateLocalPlaylistLastPlayedAtSometimes() {
      if (this.selectedUserPlaylist == null) { return }

      const playlist = this.selectedUserPlaylist
      this.updatePlaylistLastPlayedAt({ _id: playlist._id })
    },

    resetAutoplayInterruptionTimeout() {
      clearTimeout(this.autoplayInterruptionTimeout)
      this.autoplayInterruptionTimeout = setTimeout(() => { this.blockVideoAutoplay = true }, this.defaultAutoplayInterruptionIntervalHours * 3_600_000)
      this.blockVideoAutoplay = false
    },

    updatePlaybackRate(newRate) {
      this.currentPlaybackRate = newRate
    },

    /**
     * @param {string} newQuality
     */
    updateVideoQuality(newQuality) {
      this.currentVideoQuality = this.normalizeVideoQuality(newQuality)
    },

    handlePlaybackRateUserSet(newRate) {
      const rememberPerChannel = this.$store.getters.getRememberPlaybackSpeedPerChannel
      const autoUpdate = this.$store.getters.getAutoUpdateChannelPlaybackSpeeds
      if (!rememberPerChannel || !autoUpdate || !this.channelId) {
        return
      }

      this.saveChannelPlaybackSpeed(newRate)
    },

    /**
     * @param {string} newQuality
     */
    handleVideoQualityUserSet(newQuality) {
      const rememberPerChannel = this.$store.getters.getRememberVideoQualityPerChannel
      const autoUpdate = this.$store.getters.getAutoUpdateChannelVideoQualities
      if (!rememberPerChannel || !autoUpdate || !this.channelId) {
        return
      }

      this.saveChannelVideoQuality(newQuality)
    },

    /**
     * @param {boolean} enabled
     */
    handleSubtitlesStateUserSet(enabled) {
      this.currentSubtitlesState = enabled

      if (!this.$store.getters.getRememberSubtitlesStatePerChannel ||
        !this.$store.getters.getAutoUpdateChannelSubtitlesStates ||
        !this.channelId) {
        return
      }

      this.saveChannelSubtitlesState(enabled)
    },

    /**
     * @param {boolean} enabled
     */
    updateSubtitlesState(enabled) {
      this.currentSubtitlesState = enabled
    },

    /**
     * @param {number} volume
     */
    handleVolumeUserSet(volume) {
      this.currentVolume = volume

      if (!this.$store.getters.getRememberVolumePerChannel ||
        !this.$store.getters.getAutoUpdateChannelVolumes ||
        !this.channelId) {
        return
      }

      this.saveChannelVolume(volume)
    },

    /**
     * @param {number} volume
     */
    updateVolume(volume) {
      this.currentVolume = volume
    },

    /**
     * @param {boolean} enabled
     */
    saveChannelSubtitlesState(enabled) {
      const states = parseChannelPreferences(this.$store.getters.getChannelSubtitlesStates, 'channelSubtitlesStates')
      states[this.channelId] = enabled
      this.$store.dispatch('updateChannelSubtitlesStates', JSON.stringify(states))
    },

    /**
     * @param {number} volume
     */
    saveChannelVolume(volume) {
      const volumes = parseChannelPreferences(this.$store.getters.getChannelVolumes, 'channelVolumes')
      volumes[this.channelId] = volume
      this.$store.dispatch('updateChannelVolumes', JSON.stringify(volumes))
    },

    /**
     * @param {string | number | null | undefined} quality
     * @returns {string}
     */
    normalizeVideoQuality(quality) {
      const normalizedQuality = quality == null ? '' : String(quality)

      // Auto is broken with SABR, so fall back to the default quality there.
      // The player checks the streams it actually received as well, as yt-dlp
      // can fall back to the built-in extraction method.
      if (normalizedQuality === 'auto' && !playbackEngineSupportsAutoQuality(this.videoPlaybackEngine)) {
        return AUTO_QUALITY_FALLBACK
      }

      return normalizedQuality
    },

    getDefaultVideoQuality() {
      return this.normalizeVideoQuality(this.$store.getters.getDefaultQuality)
    },

    saveChannelPlaybackSpeed(rate) {
      if (!this.channelId) {
        return
      }

      try {
        const channelSpeeds = JSON.parse(this.$store.getters.getChannelPlaybackSpeeds || '{}')
        channelSpeeds[this.channelId] = rate
        this.$store.dispatch('updateChannelPlaybackSpeeds', JSON.stringify(channelSpeeds))
      } catch (e) {
        console.error('Failed to save channel playback speed:', e)
      }
    },

    /**
     * @param {string | number | null | undefined} quality
     * @returns {boolean} whether a channel-specific quality was stored
     */
    saveChannelVideoQuality(quality) {
      if (!this.channelId) {
        return false
      }

      try {
        const channelQualities = JSON.parse(this.$store.getters.getChannelVideoQualities || '{}')
        const normalizedQuality = this.normalizeVideoQuality(quality)
        if (normalizedQuality.length === 0) {
          return false
        }

        channelQualities[this.channelId] = normalizedQuality
        this.$store.dispatch('updateChannelVideoQualities', JSON.stringify(channelQualities))
        return true
      } catch (e) {
        console.error('Failed to save channel video quality:', e)
        return false
      }
    },

    initializePlaybackRate() {
      if (this.sabrReloadPlaybackRate !== null) {
        this.currentPlaybackRate = this.sabrReloadPlaybackRate
        return
      }

      if (this.videoGenreIsMusic) {
        this.currentPlaybackRate = 1
        return
      }

      const rememberPerChannel = this.$store.getters.getRememberPlaybackSpeedPerChannel
      if (rememberPerChannel && this.channelId) {
        try {
          const channelSpeeds = JSON.parse(this.$store.getters.getChannelPlaybackSpeeds || '{}')
          if (channelSpeeds[this.channelId] !== undefined) {
            this.currentPlaybackRate = channelSpeeds[this.channelId]
            return
          }
        } catch (e) {
          console.error('Failed to parse channel playback speeds:', e)
        }
      }
      this.currentPlaybackRate = this.$store.getters.getDefaultPlayback
    },

    initializeVideoQuality() {
      if (this.sabrReloadVideoQuality !== null) {
        this.currentVideoQuality = this.sabrReloadVideoQuality
        return
      }

      const rememberPerChannel = this.$store.getters.getRememberVideoQualityPerChannel
      if (rememberPerChannel && this.channelId) {
        try {
          const channelQualities = JSON.parse(this.$store.getters.getChannelVideoQualities || '{}')
          if (channelQualities[this.channelId] !== undefined) {
            this.currentVideoQuality = this.normalizeVideoQuality(channelQualities[this.channelId])
            return
          }
        } catch (e) {
          console.error('Failed to parse channel video qualities:', e)
        }
      }

      this.currentVideoQuality = this.getDefaultVideoQuality()
    },

    destroyPlayer: async function() {
      this.playerTeardownInProgress = true
      try {
        const uiState = await this.$refs.player.destroyPlayer()
        this.startNextVideoInFullscreen = uiState.startNextVideoInFullscreen
        this.startNextVideoInFullwindow = uiState.startNextVideoInFullwindow
        this.startNextVideoInPip = uiState.startNextVideoInPip
        this.nextVideoAutoPictureInPictureState = uiState.autoPictureInPictureState
        this.startNextVideoWithChapters = uiState.startNextVideoWithChapters
        this.startNextVideoWithFullscreenMetadata = uiState.startNextVideoWithFullscreenMetadata
        this.startNextVideoWithFullscreenComments = uiState.startNextVideoWithFullscreenComments
        this.startNextVideoWithFullscreenLiveChat = uiState.startNextVideoWithFullscreenLiveChat
        this.startNextVideoWithFullscreenPlaylist = uiState.startNextVideoWithFullscreenPlaylist
      } finally {
        this.playerTeardownInProgress = false
      }
    },

    isSabrVideoStream() {
      return this.activeFormat === 'dash' &&
        this.manifestMimeType === MANIFEST_TYPE_SABR &&
        !this.isLive &&
        !this.isPostLiveDvr
    },

    canReloadSabrStream() {
      return this.isSabrVideoStream() &&
        !this.isLoading &&
        this.sabrErrorRecoveryAttempts < MAX_SABR_ERROR_RECOVERIES &&
        this.sabrErrorRecoveriesForCurrentVideo < MAX_SABR_ERROR_RECOVERIES_PER_VIDEO
    },

    async reloadSabrStream(payload, toastMessage) {
      if (!this.canReloadSabrStream()) { return false }

      // Both critical Shaka errors and SABR's own reload policy mean the
      // current playback session is no longer reusable. Keep them on the same
      // budget so a succession of freshly fetched sessions cannot reload the
      // tab forever without making playback progress.
      this.sabrErrorRecoveryAttempts++
      this.sabrErrorRecoveriesForCurrentVideo++
      this.sabrErrorRecoveryLastSeconds = this.getTimestamp()
      this.sabrErrorRecoveryPlayedSeconds = 0
      try {
        await this.performSabrReload(payload, toastMessage)
      } catch (error) {
        console.error('SABR reload failed', error)
        return false
      }
      return true
    },

    async onPlayerReloadRequested(payload) {
      // A request from a player that is already being replaced must not spend
      // the new player's budget or change a format the user selected meanwhile.
      if (!this.isSabrVideoStream() || this.isLoading) { return }

      if (await this.reloadSabrStream(payload, 'Reloading player according to SABR request')) { return }

      this.handleWatchProgressAutoSaveWhenProgressEnabled()
      if (this.legacyFormats.length > 0) {
        console.error('Unable to recover the SABR stream. Reverting to legacy formats...')
        this.enableLegacyFormat()
      } else {
        this.errorMessage = '[PLAYER_ERROR: SABR_RELOAD] Unable to recover the video stream. Please reload this video.'
      }
    },

    setPlayerReloadState(payload) {
      const wasPlaying = payload?.wasPlaying === true
      this.resumePlaybackAfterSabrReload = wasPlaying
      this.suppressAutoplayAfterSabrReload = !wasPlaying
      this.sabrReloadCaptionIndex = Number.isInteger(payload?.captionIndex) ? payload.captionIndex : null
      const playbackRate = Number(payload?.playbackRate)
      this.sabrReloadPlaybackRate = Number.isFinite(playbackRate) && playbackRate > 0.07
        ? playbackRate
        : this.currentPlaybackRate
      this.sabrReloadVideoQuality = this.normalizeVideoQuality(payload?.videoQuality) ||
        this.normalizeVideoQuality(this.currentVideoQuality) || null
    },

    async performSabrReload(payload, toastMessage) {
      this.setPlayerReloadState(payload)
      this.preserveTitleOnNextReload = true
      this.showTabToast({ message: toastMessage, icon: ['fas', 'sync'] })

      const timestamp = this.getTimestamp()
      if (timestamp > 0) {
        // Reload at the middle should restart at current timestamp
        const reloadLocation = {
          path: this.tabRoute.path,
          query: { ...this.tabRoute.query, oneTimeTimestamp: timestamp },
          // This only carries the resume position for the same video. Keep the
          // resolved title throughout navigation instead of briefly replacing
          // it with the updated watch URL while the metadata reloads.
          state: {
            skipTabRouteLoading: true,
            tabTitle: this.videoTitle,
          },
        }

        if (this.tabRouter.resolve(reloadLocation).fullPath !== this.tabRoute.fullPath) {
          // The route watcher owns this reload. Calling reloadView here as well
          // races two metadata requests and two player teardowns.
          await this.tabRouter.replace(reloadLocation)
          return
        }
      }
      await this.reloadView({ preserveTitle: true })
    },

    onResumePlaybackAfterSabrReloadDone() {
      this.resumePlaybackAfterSabrReload = false
      this.suppressAutoplayAfterSabrReload = false
    },

    ...mapActions([
      'updateHistory',
      'updateWatchProgress',
      'updateLastViewedPlaylist',
      'updatePlaylistLastPlayedAt',
      'updateSubscriptionDetails',
    ])
  }
})
