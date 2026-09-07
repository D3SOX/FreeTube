import { isAppHidden } from '../../helpers/appVisibility.js'
import { playbackScreenWake } from '../../helpers/playbackScreenWake'
import { capturePlayerFrame } from '../../helpers/player/capturePlayerFrame'
import { createAndroidPlayer } from '../../helpers/player/androidPlayer'
import { computed, defineComponent, inject, nextTick, onBeforeUnmount, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue'
import FtPaidPromotionBadge from '../FtPaidPromotionBadge/FtPaidPromotionBadge.vue'
import FtSelect from '../FtSelect/FtSelect.vue'
import shaka from 'shaka-player'
import { useI18n } from 'vue-i18n'

import store from '../../store/index'
import { getSubtitleRequestUrl } from '../../helpers/player/subtitleCookies'
import { KeyboardShortcuts } from '../../../constants'
import { useTabContext, useTabLifecycle } from '../../tabs/TabContext'
import { tabMediaCoordinator } from '../../tabs/TabMediaCoordinator'
import { AmbientModeButton } from './player-components/AmbientModeButton'
import {
  AB_REPEAT_ICON,
  AbRepeatControl,
  setAbRepeatContext,
} from './player-components/AbRepeatControl'
import { AudioTrackSelection } from './player-components/AudioTrackSelection'
import { CaptionSelection } from './player-components/CaptionSelection'
import { CaptionToggleButton, CLOSED_CAPTIONS_OUTLINED } from './player-components/CaptionToggleButton'
import { ChapterOverlayButton } from './player-components/ChapterOverlayButton'
import { CopyVideoUrlButton, setCopyVideoUrlContext } from './player-components/CopyVideoUrlButton'
import { FullWindowButton } from './player-components/FullWindowButton'
import { AndroidPictureInPictureButton } from './player-components/AndroidPictureInPictureButton'
import { LegacyQualitySelection } from './player-components/LegacyQualitySelection'
import { LoopButton, setLoopButtonContext } from './player-components/LoopButton'
import { MusicVisualizerButton } from './player-components/MusicVisualizerButton'
import { QuickPlaybackRateBar, setQuickPlaybackRateBarContext } from './player-components/QuickPlaybackRateBar'
import { ScreenshotButton } from './player-components/ScreenshotButton'
import { SkipSilenceButton } from './player-components/SkipSilenceButton'
import { VideoZoomSelection } from './player-components/VideoZoomSelection'
import { VoiceOverTranslationButton } from './player-components/VoiceOverTranslationButton'
import { SleepTimer } from './player-components/SleepTimer'
import { ShortsVideoInfoButton } from './player-components/ShortsVideoInfoButton'
import { SponsorBlockCancelButton } from './player-components/SponsorBlockCancelButton'
import { SponsorBlockClearButton } from './player-components/SponsorBlockClearButton'
import { SponsorBlockEndButton } from './player-components/SponsorBlockEndButton'
import { SponsorBlockHighlightButton } from './player-components/SponsorBlockHighlightButton'
import { SponsorBlockOpenMenuButton } from './player-components/SponsorBlockOpenMenuButton'
import { SponsorBlockStartButton } from './player-components/SponsorBlockStartButton'
import { StatsButton } from './player-components/StatsButton'
import { TheatreModeButton } from './player-components/TheatreModeButton'
import { AutoplayToggle } from './player-components/AutoplayToggle'
import { SkipButton } from './player-components/SkipButton'
import { FtPlaybackAdjustedTime } from './player-components/FtPlaybackAdjustedTime'
import {
  deduplicateAudioTracks,
  findMostSimilarAudioBandwidth,
  getPreferredCaption,
  getSponsorBlockSegments,
  logShakaError,
  repairInvidiousManifest,
  translateSponsorBlockCategory
} from '../../helpers/player/utils'
import {
  addKeyboardShortcutToActionTitle,
  formatDurationAsTimestamp,
  showToast,
  writeFileWithPicker,
  throttle,
  removeFromArrayIfExists,
  copyToClipboard,
} from '../../helpers/utils'
import { isHexColor, resolveColorValue } from '../../helpers/colors'
import { applyAnimationSpeed, getAnimationSpeedMultiplier } from '../../helpers/animationSpeed'
import {
  FULLSCREEN_DOCK_GAP,
  FULLSCREEN_DOCK_OUTER_INSET,
  toggleFullscreenDockCollapsed,
} from '../../helpers/fullscreenDocks'
import { addOverlayScrollbars, removeOverlayScrollbars } from '../../helpers/overlayScrollbars'
import { setFullscreenOrientation } from '../../helpers/capacitorUi'
import { isReducedMotionEnabled } from '../../helpers/reducedMotion'
import {
  enterAndroidPictureInPicture,
  setAndroidStatusBarVisible,
  shouldShowAndroidStatusBar,
} from '../../helpers/androidUi'
import { appendTimestamp, getInvidiousVideoUrl, getYoutubeVideoShareUrl } from '../../helpers/share'
import { MANIFEST_TYPE_SABR } from '../../helpers/player/SabrManifestParser'
import { preferOriginalHlsAudio } from '../../helpers/player/hlsAudioTracks'
import { getDefaultAudioVariants } from '../../helpers/player/defaultAudioTrack'
import { MUSIC_MEDIA_TYPE } from '../../helpers/player/musicMediaType'
import { resolveSegmentPrefetchLimit } from '../../helpers/player/segmentPrefetch'
import { AUTO_QUALITY_FALLBACK, streamsSupportAutoQuality } from '../../helpers/player/autoQuality'
import { setupSabrScheme } from '../../helpers/player/SabrSchemePlugin'
import { prepareGoogleVideoRequest } from '../../helpers/player/playbackRequestPolicy'
import { getRememberedPlayerVolume, setRememberedPlayerVolume } from '../../helpers/player/volume-storage'
import { parseChannelPreferences } from '../../helpers/channel-preferences'
import { findLegacyFormatForQuality } from '../../helpers/player/legacyFormats'
import { waitForYtDlpFormatAvailability } from '../../helpers/player/ytDlpFormatAvailability'
import { getDashQualityFromDimensions } from '../../helpers/player/videoQuality'
import {
  DEFAULT_VIDEO_ZOOM,
  formatVideoZoom,
  resolveVideoZoomPinch,
  sanitizeVideoZoom,
  stepVideoZoom,
} from '../../helpers/player/videoZoom'
import { shouldStartPaidPromotionTimer } from '../../helpers/player/paidPromotion'
import { resolveSponsorBlockEnterTarget, resolveSponsorBlockEnterTargets } from '../../helpers/player/sponsorBlockShortcut'
import { createSponsorBlockMuteController } from '../../helpers/player/sponsorBlockMute'
import { findSponsorBlockSeekBarSegment } from '../../helpers/player/sponsorBlockSeekBar'
import {
  AbRepeatValidation,
  formatAbRepeatTimestamp,
  getAbRepeatBoundaryDelay,
  isCompleteAbRepeatRange,
  validateAbRepeatRange,
} from '../../helpers/player/abRepeat'
import { matchesKeyboardShortcut } from '../../helpers/keyboardShortcuts'
import { getSponsorBlockContributionStats, voteOnSponsorBlockSegment } from '../../helpers/sponsorblock'
import {
  DEFAULT_CAPTION_SETTINGS,
  getCaptionCssVariables,
  getCaptionPlayerVariables,
  parseCaptionSettings,
} from '../../helpers/player/caption-settings'
import { useAmbientMode } from './opentubex/useAmbientMode'
import { useAutoPictureInPicture } from './opentubex/useAutoPictureInPicture'
import {
  isCapacitorMobilePlayer,
  useMobileFullscreenGestures,
} from './opentubex/useMobileFullscreenGestures'
import { useMusicVisualizer } from './opentubex/useMusicVisualizer'
import { useScrollMiniPlayer } from './opentubex/useScrollMiniPlayer'
import { useSilenceSkipping } from './opentubex/useSilenceSkipping'
import { useSleepTimer } from './opentubex/useSleepTimer'
import { useSponsorBlockSubmission } from './opentubex/useSponsorBlockSubmission'
import { useVoiceOverTranslation } from './opentubex/useVoiceOverTranslation'
import FtVideoAnnotations from '../FtVideoAnnotations/FtVideoAnnotations.vue'
import FtShareButton from '../FtShareButton/FtShareButton.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import FtAddToPlaylistDropdown from '../FtAddToPlaylistDropdown/FtAddToPlaylistDropdown.vue'
import WatchVideoChapters from '../WatchVideoChapters/WatchVideoChapters.vue'
import thumbnailPlaceholder from '../../assets/img/thumbnail_placeholder.svg'

/** @typedef {import('../../helpers/sponsorblock').SponsorBlockCategory} SponsorBlockCategory */
/** @typedef {string | { path: string, viewBox: string }} ValueChangeIcon */

const SPONSORBLOCK_HIGHLIGHT_LABEL_PLAYBACK_MS = 5000
const SPONSORBLOCK_SEGMENT_START_TOLERANCE_SECONDS = 0.1
const SPONSORBLOCK_SKIP_SCHEDULE_LEAD_MS = 500
const SPONSORBLOCK_SKIP_POLL_INTERVAL_MS = 4
const SPONSORBLOCK_TERMINAL_OUTRO_TOLERANCE_SECONDS = 1
const AB_REPEAT_MIN_RANGE_SECONDS = 0.05
const AB_REPEAT_BOUNDARY_TOLERANCE_SECONDS = 0.012
const AB_REPEAT_VALUE_CHANGE_ICON = AB_REPEAT_ICON
const SPONSORBLOCK_NOT_FOUND_REFETCH_RECENT_VIDEO_AGE_MS = 24 * 60 * 60 * 1000
const SPONSORBLOCK_NOT_FOUND_REFETCH_MIN_DELAY_MS = 10000
const SPONSORBLOCK_NOT_FOUND_REFETCH_MAX_DELAY_MS = 40000
const SPONSORBLOCK_CATEGORIES = Object.freeze([
  'sponsor',
  'selfpromo',
  'interaction',
  'intro',
  'outro',
  'preview',
  'hook',
  'music_offtopic',
  'filler',
  'poi_highlight',
])
const SPONSORBLOCK_INFO_CATEGORIES = Object.freeze([...SPONSORBLOCK_CATEGORIES, 'exclusive_access'])
const SPONSORBLOCK_INFO_ACTION_TYPES = Object.freeze(['skip', 'mute', 'full', 'poi'])
const SPONSORBLOCK_PLAYBACK_ACTION_TYPES = Object.freeze(['skip', 'mute', 'poi'])
const SABR_BACKOFF_PREVIEW_REFRESH_DELAY_MS = 150
const FULL_WINDOW_ANIMATION_DURATION_MS = 400
const FULLSCREEN_DOCK_PREFERRED_MIN_HEIGHT = 360
const FULLSCREEN_DOCK_COMPACT_MIN_HEIGHT = 96
const FULLSCREEN_DOCK_HEADER_SELECTOR = [
  '.chapterOverlayHeader',
  '.fullscreenMetadataHeader',
  '.transcriptHeader',
  '.sponsorBlockHeader',
  '.liveChatDockHeader',
  '.fullscreenCommentHeader',
  '.playlistDockHeader',
].join(', ')

// The UTF-8 characters "h", "t", "t", and "p".
const HTTP_IN_HEX = 0x68747470

const USE_OVERFLOW_MENU_WIDTH_THRESHOLD = 634
const TEMPORARY_PLAYBACK_RATE_MULTIPLIER = 2
const TEMPORARY_PLAYBACK_RATE_HOLD_DELAY_MS = 625
const TEMPORARY_PLAYBACK_RATE_KEYBOARD_SOURCE = 'keyboard'
const TEMPORARY_PLAYBACK_RATE_POINTER_SOURCE = 'pointer'
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const PLAY_MORPH_PATH = 'M8 6 11.5 8.1 11.5 15.9 8 18ZM11.5 8.1 18 12 18 12 11.5 15.9Z'

// Shaka's UI element registries (Controls/OverflowMenu/ContextMenu) are
// process-global and shared by every live player instance. Track how many
// players currently rely on the custom element factories so the shared registry
// is only reset once the last one unmounts (see cleanUpCustomPlayerControls).
let liveCustomControlPlayers = 0

const RequestType = shaka.net.NetworkingEngine.RequestType
const AdvancedRequestType = shaka.net.NetworkingEngine.AdvancedRequestType
const TrackLabelFormat = shaka.ui.Overlay.TrackLabelFormat
const CaptionPositionArea = shaka.config.PositionArea
const { Severity: ErrorSeverity, Category: ErrorCategory, Code: ErrorCode } = shaka.util.Error

const CAPTION_POSITION_AREAS = Object.freeze({
  'top-left': CaptionPositionArea.TOP_LEFT,
  'top-center': CaptionPositionArea.TOP_CENTER,
  'top-right': CaptionPositionArea.TOP_RIGHT,
  'bottom-left': CaptionPositionArea.BOTTOM_LEFT,
  'bottom-center': CaptionPositionArea.BOTTOM_CENTER,
  'bottom-right': CaptionPositionArea.BOTTOM_RIGHT,
})

const NORMAL_PLAYBACK_RATE = 1

/*
  Mapping of Shaka localization keys for control labels to FreeTube shortcuts.
  See: https://github.com/shaka-project/shaka-player/blob/main/ui/locales/en.json
*/
const shakaControlKeysToShortcuts = {
  MUTE: () => KeyboardShortcuts.VIDEO_PLAYER.GENERAL.MUTE,
  UNMUTE: () => KeyboardShortcuts.VIDEO_PLAYER.GENERAL.MUTE,
  PLAY: () => KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.PLAY,
  PAUSE: () => KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.PLAY,
  PICTURE_IN_PICTURE: () => KeyboardShortcuts.VIDEO_PLAYER.GENERAL.PICTURE_IN_PICTURE,
  ENTER_PICTURE_IN_PICTURE: () => KeyboardShortcuts.VIDEO_PLAYER.GENERAL.PICTURE_IN_PICTURE,
  EXIT_PICTURE_IN_PICTURE: () => KeyboardShortcuts.VIDEO_PLAYER.GENERAL.PICTURE_IN_PICTURE,
  CAPTIONS: () => KeyboardShortcuts.VIDEO_PLAYER.GENERAL.CAPTIONS,
  FULL_SCREEN: () => KeyboardShortcuts.VIDEO_PLAYER.GENERAL.FULLSCREEN,
  EXIT_FULL_SCREEN: () => KeyboardShortcuts.VIDEO_PLAYER.GENERAL.FULLSCREEN
}

/** @type {Map<string, string>} */
const LOCALE_MAPPINGS = new Map(process.env.SHAKA_LOCALE_MAPPINGS)

export default defineComponent({
  name: 'FtShakaVideoPlayer',
  components: {
    FtPaidPromotionBadge,
    FtSelect,
    FtShareButton,
    FtIconButton,
    FtAddToPlaylistDropdown,
    FtVideoAnnotations,
    WatchVideoChapters
  },
  props: {
    format: {
      type: String,
      required: true
    },
    manifestSrc: {
      type: String,
      default: null
    },
    manifestMimeType: {
      type: String,
      required: true
    },
    /**
     * Which engine provided the streams, as yt-dlp's manifests need a few
     * accommodations that must not change the behaviour for the built-in one.
     * @type {import('vue').PropType<'built-in' | 'yt-dlp'>}
     */
    playbackEngine: {
      type: String,
      default: 'built-in'
    },
    sabrData: {
      type: Object,
      default: null
    },
    legacyFormats: {
      type: Array,
      default: () => ([])
    },
    playbackSourceKey: {
      type: Number,
      default: 0
    },
    startTime: {
      type: Number,
      default: null
    },
    captions: {
      type: Array,
      default: () => ([])
    },
    captionTranslations: {
      type: Array,
      default: () => ([])
    },
    chapters: {
      type: Array,
      default: () => ([])
    },
    currentChapterIndex: {
      type: Number,
      default: 0
    },
    chaptersKind: {
      type: String,
      default: 'chapters'
    },
    chaptersSrc: {
      type: String,
      default: ''
    },
    storyboardSrc: {
      type: String,
      default: ''
    },
    annotations: {
      type: Array,
      default: () => []
    },
    hideAnnotations: {
      type: Boolean,
      default: false
    },
    videoId: {
      type: String,
      default: ''
    },
    playlistId: {
      type: String,
      default: ''
    },
    title: {
      type: String,
      default: ''
    },
    artist: {
      type: String,
      default: ''
    },
    musicMediaType: {
      type: String,
      default: MUSIC_MEDIA_TYPE.UNKNOWN,
      validator: value => Object.values(MUSIC_MEDIA_TYPE).includes(value)
    },
    thumbnail: {
      type: String,
      default: ''
    },
    shortsPlayer: {
      type: Boolean,
      default: false
    },
    shortsMetadataOpen: {
      type: Boolean,
      default: false
    },
    shortsAspectRatio: {
      type: Number,
      default: null
    },
    theatrePossible: {
      type: Boolean,
      default: false
    },
    useTheatreMode: {
      type: Boolean,
      default: false
    },
    autoplayPossible: {
      type: Boolean,
      default: false
    },
    autoplayEnabled: {
      type: Boolean,
      default: false
    },
    autoplayCountdown: {
      type: Object,
      default: null
    },
    autoOpenChapters: {
      type: Boolean,
      default: false
    },
    sidebarChaptersOpen: {
      type: Boolean,
      default: false
    },
    watchingPlaylist: {
      type: Boolean,
      default: false
    },
    canSkipNext: {
      type: Boolean,
      default: false
    },
    canSkipPrevious: {
      type: Boolean,
      default: false
    },
    vrProjection: {
      type: String,
      default: null
    },
    startInFullscreen: {
      type: Boolean,
      default: false
    },
    startInFullwindow: {
      type: Boolean,
      default: false
    },
    startInPip: {
      type: Boolean,
      default: false
    },
    autoPictureInPictureState: {
      type: Object,
      default: null
    },
    startWithChapters: {
      type: Boolean,
      default: false
    },
    startWithFullscreenMetadata: {
      type: Boolean,
      default: false
    },
    startWithFullscreenComments: {
      type: Boolean,
      default: false
    },
    startWithFullscreenLiveChat: {
      type: Boolean,
      default: false
    },
    startWithFullscreenPlaylist: {
      type: Boolean,
      default: false
    },
    channelId: {
      type: String,
      default: ''
    },
    playlistVideoData: {
      type: Object,
      default: null
    },
    published: {
      type: Number,
      default: 0
    },
    isLive: {
      type: Boolean,
      default: false
    },
    isUpcoming: {
      type: Boolean,
      default: false
    },
    transcriptOpen: {
      type: Boolean,
      default: false
    },
    sponsorBlockInfoOpen: {
      type: Boolean,
      default: false
    },
    videoGenreIsMusic: {
      type: Boolean,
      default: false
    },
    currentPlaybackRate: {
      type: Number,
      default: 1
    },
    currentVideoQuality: {
      type: String,
      default: '720'
    },
    delayLoadUntilUnix: {
      type: Number,
      default: 0
    },
    sponsorBlockAutoSkipDisabled: {
      type: Boolean,
      default: false
    },
    commentsAvailable: {
      type: Boolean,
      default: false
    },
    liveChatAvailable: {
      type: Boolean,
      default: false
    },
    quickBookmarkEnabled: {
      type: Boolean,
      default: false
    },
    quickBookmarked: {
      type: Boolean,
      default: false
    },
    quickBookmarkTitle: {
      type: String,
      default: ''
    },
    quickBookmarkIcon: {
      type: [Array, Object],
      default: () => ['fas', 'bookmark']
    },
    paidPromotion: {
      type: Boolean,
      default: false
    },
    paidPromotionDurationMs: {
      type: Number,
      default: 10000
    },
    resumePlaybackAfterSabrReload: {
      type: Boolean,
      default: false
    },
    suppressAutoplayAfterSabrReload: {
      type: Boolean,
      default: false
    },
    sabrReloadCaptionIndex: {
      type: Number,
      default: null
    },
    sabrReloadPlaybackRate: {
      type: Number,
      default: null
    },
  },
  emits: [
    'error',
    'loaded',
    'ended',
    'play',
    'pause',
    'timeupdate',
    'terminal-outro-started',
    'toggle-autoplay',
    'autoplay-cancel',
    'autoplay-play-now',
    'toggle-theatre-mode',
    'playback-rate-updated',
    'playback-rate-user-set',
    'save-channel-playback-speed',
    'video-quality-updated',
    'video-quality-user-set',
    'subtitles-state-updated',
    'subtitles-state-user-set',
    'volume-updated',
    'volume-user-set',
    'skip-to-next',
    'skip-to-prev',
    'player-reload-requested',
    'resume-playback-after-sabr-reload-done',
    'fullscreen-metadata-change',
    'fullscreen-transcript-change',
    'fullscreen-sponsorblock-change',
    'fullscreen-comments-change',
    'fullscreen-live-chat-change',
    'fullscreen-playlist-change',
    'toggle-transcript',
    'toggle-quick-bookmark',
    'chapters-overlay-change',
    'chapter-thumbnails-change',
    'sponsorblock-info-change',
    'toggle-shorts-metadata',
    'seeking',
  ],
  setup: function (props, { emit, expose }) {
    const { locale, t } = useI18n()
    const hardwareKeyboardAttached = inject('hardwareKeyboardAttached', ref(!process.env.IS_CAPACITOR))
    const { tabId, isTabPresented } = useTabContext()
    const mediaTabId = tabId ?? 'web'
    // Shorts request autoplay, so do not render their paused-only controls
    // while the media element is still preparing its first `play` event.
    const shortsPaused = ref(false)
    const shortsEnded = ref(false)
    const shortsMuted = ref(false)
    const shortsCaptionsAvailable = ref(false)
    const shortsCaptionsEnabled = ref(false)
    const showPoster = ref(true)
    const showPaidPromotion = ref(false)
    let paidPromotionTimer = null

    function resetPaidPromotion() {
      clearTimeout(paidPromotionTimer)
      paidPromotionTimer = null
      showPaidPromotion.value = props.paidPromotion && !props.shortsPlayer
    }

    function startPaidPromotionTimer() {
      if (!showPaidPromotion.value || paidPromotionTimer !== null) {
        return
      }

      paidPromotionTimer = setTimeout(() => {
        showPaidPromotion.value = false
        paidPromotionTimer = null
      }, props.paidPromotionDurationMs)
    }

    const autoplayNextVideo = computed(() => props.autoplayCountdown?.video ?? null)
    const autoplayThumbnail = computed(() => {
      const videoId = autoplayNextVideo.value?.videoId
      if (!videoId) {
        return thumbnailPlaceholder
      }

      if (store.getters.getThumbnailPreference === 'hidden') {
        return thumbnailPlaceholder
      }

      const baseUrl = store.getters.getBackendPreference === 'invidious'
        ? store.getters.getCurrentInvidiousInstanceUrl
        : 'https://i.ytimg.com'
      let thumbnailName = 'mqdefault.jpg'

      switch (store.getters.getThumbnailPreference) {
        case 'start':
          thumbnailName = 'mq1.jpg'
          break
        case 'middle':
          thumbnailName = 'mq2.jpg'
          break
        case 'end':
          thumbnailName = 'mq3.jpg'
          break
      }

      return `${baseUrl}/vi/${videoId}/${thumbnailName}`
    })
    const autoplayDuration = computed(() => {
      const lengthSeconds = Number(autoplayNextVideo.value?.lengthSeconds)
      return Number.isFinite(lengthSeconds) && lengthSeconds > 0
        ? formatDurationAsTimestamp(lengthSeconds)
        : ''
    })

    function cancelAutoplayCountdown() {
      emit('autoplay-cancel')
    }

    function playAutoplayVideoNow() {
      emit('autoplay-play-now')
    }

    /** @type {shaka.Player|null} */
    let player = null

    /** @type {shaka.ui.Overlay|null} */
    let ui = null
    let nativePlaybackCleanup = null
    let screenWakeBinding = null

    // Set when a UI reconfigure is requested while the player is not loaded, so
    // it can be flushed once loading finishes (see configureUI).
    let pendingUiReconfigure = false

    // Whether this instance registered its custom control factories into the
    // shared global registry, so teardown decrements the live-player count
    // exactly once (see cleanUpCustomPlayerControls).
    let registeredCustomControls = false

    const events = new EventTarget()

    /** @type {import('vue').Ref<HTMLDivElement | null>} */
    const container = ref(null)

    /** @type {import('vue').Ref<HTMLVideoElement | null>} */
    const video = ref(null)

    const sleepTimer = useSleepTimer({
      getVideoId: () => props.videoId,
      isPaused: () => video.value?.paused ?? true,
      onExpired: () => showToast({ message: t('Video.Player.Sleep Timer.Timer ended'), icon: ['fas', 'clock'] }),
      pausePlayback: () => video.value?.pause(),
      tabId,
    })

    /** @type {import('vue').Ref<HTMLCanvasElement | null>} */
    const vrCanvas = ref(null)

    /** @type {import('vue').Ref<HTMLElement | null>} */
    const chapterOverlay = ref(null)
    const showChaptersOverlay = ref(false)
    // Reactive mirror of the native fullscreen state, so the template can
    // decide where the chapters render (in-player panel vs the watch sidebar).
    const isFullscreen = ref(false)
    const playerPaused = ref(true)
    const pausedInterfaceRevealed = ref(false)
    const shakaControlsShown = ref(false)
    const isSubMenuOpened = ref(false)
    const actionDockFocused = ref(false)
    /** @type {number|null} */
    let pausedInterfaceRevealTimeout = null

    const showPlayerControlsWhenPaused = computed(() => store.getters.getShowPlayerControlsWhenPaused)
    const showVideoTitleWhenPaused = computed(() => store.getters.getShowVideoTitleWhenPaused)
    const showFullscreenActionsWhenPaused = computed(() => store.getters.getShowFullscreenActionsWhenPaused)
    const pausedInterfaceHideDelay = computed(() => store.getters.getPausedInterfaceHideDelay)
    const playerControlsShown = computed(() => (
      shakaControlsShown.value &&
      (
        !playerPaused.value ||
        showPlayerControlsWhenPaused.value ||
        pausedInterfaceRevealed.value ||
        (!isFullscreen.value && !fullWindowEnabled.value)
      )
    ))
    const actionDockVisible = computed(() => (
      !isSubMenuOpened.value &&
      (
        actionDockFocused.value || (
          (shakaControlsShown.value || props.shortsPlayer) &&
          (!playerPaused.value || showFullscreenActionsWhenPaused.value || pausedInterfaceRevealed.value)
        )
      )
    ))
    function clearPausedInterfaceReveal() {
      if (pausedInterfaceRevealTimeout !== null) {
        clearTimeout(pausedInterfaceRevealTimeout)
        pausedInterfaceRevealTimeout = null
      }

      pausedInterfaceRevealed.value = false
    }

    function revealPausedInterface() {
      if (!playerPaused.value || (!isFullscreen.value && !fullWindowEnabled.value)) {
        return
      }

      pausedInterfaceRevealed.value = true

      if (pausedInterfaceRevealTimeout !== null) {
        clearTimeout(pausedInterfaceRevealTimeout)
      }

      pausedInterfaceRevealTimeout = window.setTimeout(() => {
        pausedInterfaceRevealTimeout = null
        pausedInterfaceRevealed.value = false
      }, pausedInterfaceHideDelay.value * 1000)
    }

    onUnmounted(clearPausedInterfaceReveal)

    // While switching presentation mode (fullscreen/full window) the side
    // panel transitions would run on top of the container resize and produce
    // odd combined motion, so they are suppressed for the switch duration.
    const presentationModeChanging = ref(false)
    /** @type {number|null} */
    let presentationModeChangingTimeout = null
    /** @type {HTMLElement|null} */
    let fullscreenTitleOverlay = null

    function suppressPanelTransitions(duration) {
      presentationModeChanging.value = true

      if (presentationModeChangingTimeout !== null) {
        clearTimeout(presentationModeChangingTimeout)
      }

      presentationModeChangingTimeout = window.setTimeout(() => {
        presentationModeChangingTimeout = null
        presentationModeChanging.value = false
      }, duration)
    }
    /** @type {import('vue').Ref<HTMLElement | null>} */
    const fullscreenMetadataOverlay = ref(null)
    /** @type {import('vue').Ref<HTMLElement | null>} */
    const fullscreenMetadataTarget = ref(null)
    const showFullscreenMetadata = ref(false)
    /** @type {import('vue').Ref<HTMLElement | null>} */
    const fullscreenTranscriptOverlay = ref(null)
    /** @type {import('vue').Ref<HTMLElement | null>} */
    const fullscreenTranscriptTarget = ref(null)
    const showFullscreenTranscript = ref(false)
    /** @type {import('vue').Ref<HTMLElement | null>} */
    const fullscreenSponsorBlockOverlay = ref(null)
    /** @type {import('vue').Ref<HTMLElement | null>} */
    const fullscreenSponsorBlockTarget = ref(null)
    const showFullscreenSponsorBlock = ref(false)
    /** @type {import('vue').Ref<HTMLElement | null>} */
    const fullscreenCommentsOverlay = ref(null)
    const showFullscreenComments = ref(false)
    /** @type {import('vue').Ref<HTMLElement | null>} */
    const fullscreenLiveChatOverlay = ref(null)
    /** @type {import('vue').Ref<HTMLElement | null>} */
    const fullscreenLiveChatTarget = ref(null)
    const showFullscreenLiveChat = ref(false)
    /** @type {import('vue').Ref<HTMLElement | null>} */
    const fullscreenPlaylistOverlay = ref(null)
    /** @type {import('vue').Ref<HTMLElement | null>} */
    const fullscreenPlaylistTarget = ref(null)
    const showFullscreenPlaylist = ref(false)
    const fullscreenDockOpen = computed(() => {
      return showFullscreenMetadata.value || showFullscreenTranscript.value ||
        showFullscreenSponsorBlock.value || showFullscreenComments.value ||
        showFullscreenLiveChat.value || showFullscreenPlaylist.value ||
        (showChaptersOverlay.value && props.chapters.length > 0)
    })
    const fullscreenDockLayoutOpen = ref(false)
    let fullscreenDockLayoutFrame = null
    watch(fullscreenDockOpen, (open) => {
      if (fullscreenDockLayoutFrame !== null) {
        cancelAnimationFrame(fullscreenDockLayoutFrame)
        fullscreenDockLayoutFrame = null
      }

      if (open) {
        fullscreenDockLayoutOpen.value = true
      } else {
        // Paint the layout once after teleported dock content settles, then start the reverse transition.
        fullscreenDockLayoutFrame = requestAnimationFrame(() => {
          fullscreenDockLayoutFrame = requestAnimationFrame(() => {
            fullscreenDockLayoutFrame = null
            fullscreenDockLayoutOpen.value = false
          })
        })
      }
    }, { flush: 'post' })
    const chapterThumbnails = ref([])
    const currentChapterTitle = computed(() => {
      return props.chapters[props.currentChapterIndex]?.title ?? t('Chapters.Chapters')
    })
    const shareablePlaylistId = computed(() => {
      return props.playlistId && store.getters.getPlaylist(props.playlistId) == null
        ? props.playlistId
        : ''
    })
    const showFullscreenShareAction = computed(() => !store.getters.getHideSharingActions)
    const showFullscreenPlaylistAction = computed(() => !store.getters.getHidePlaylists)
    const isInAnyPlaylist = computed(() => store.getters.getPlaylistVideoCounts.has(props.videoId))

    const fullscreenDockOrder = reactive(['metadata', 'transcript', 'sponsorBlock', 'liveChat', 'comments', 'playlist', 'chapters'])
    const fullscreenDockWeights = reactive(Object.fromEntries(fullscreenDockOrder.map(dock => [dock, 1])))
    const fullscreenDockCollapsedState = Object.fromEntries(fullscreenDockOrder.map(dock => [dock, null]))
    const fullscreenDockResizing = ref(false)
    const fullscreenDockReordering = ref(false)
    let resizingFullscreenDock = null
    let resizingFullscreenDockWeightBefore = 0
    let resizingFullscreenDockTotalWeight = 0
    let resizingFullscreenDockBounds = null

    function isFullscreenDockOpen(dock) {
      switch (dock) {
        case 'metadata': return showFullscreenMetadata.value
        case 'transcript': return showFullscreenTranscript.value
        case 'sponsorBlock': return showFullscreenSponsorBlock.value
        case 'comments': return showFullscreenComments.value
        case 'liveChat': return showFullscreenLiveChat.value
        case 'playlist': return showFullscreenPlaylist.value
        case 'chapters': return showChaptersOverlay.value && props.chapters.length > 0
        default: return false
      }
    }

    function getFullscreenOpenDocks(includeDock) {
      const openDocks = fullscreenDockOrder.filter(isFullscreenDockOpen)

      // Keep a closed dock in the slot it will enter so its transition stays
      // horizontal while the currently open docks resize around it.
      if (includeDock && !openDocks.includes(includeDock)) {
        openDocks.push(includeDock)
        openDocks.sort((a, b) => fullscreenDockOrder.indexOf(a) - fullscreenDockOrder.indexOf(b))
      }

      return openDocks
    }

    function fullscreenDockStyle(dock) {
      const openDocks = getFullscreenOpenDocks(dock)
      const index = openDocks.indexOf(dock)
      const totalWeight = openDocks.reduce((total, name) => total + fullscreenDockWeights[name], 0)
      const weightBefore = openDocks
        .slice(0, index)
        .reduce((total, name) => total + fullscreenDockWeights[name], 0)
      const weightAfter = totalWeight - weightBefore - fullscreenDockWeights[dock]

      return {
        insetBlockStart: index === 0
          ? 'calc(var(--safe-area-inset-top, env(safe-area-inset-top, 0px)) + 12px)'
          : `calc(${weightBefore * 100 / totalWeight}% + 6px)`,
        insetBlockEnd: index === openDocks.length - 1
          ? 'calc(var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)) + 12px)'
          : `calc(${weightAfter * 100 / totalWeight}% + 6px)`,
      }
    }

    function fullscreenDockCanResize(dock) {
      const openDocks = getFullscreenOpenDocks()
      const index = openDocks.indexOf(dock)
      return index >= 0 && index < openDocks.length - 1
    }

    function fullscreenDockCanReorder(dock) {
      const openDocks = getFullscreenOpenDocks()
      return openDocks.length > 1 && openDocks.includes(dock)
    }

    function resetFullscreenDockHeights() {
      for (const dock of fullscreenDockOrder) {
        fullscreenDockWeights[dock] = 1
        fullscreenDockCollapsedState[dock] = null
      }
    }

    function handleFullscreenDockHeaderDoubleClick(event, dock) {
      const target = event.target instanceof Element ? event.target : null
      const header = target?.closest(FULLSCREEN_DOCK_HEADER_SELECTOR)
      const interactiveTarget = target?.closest('button, a, input, select, textarea, [role="button"]')
      if (!header || interactiveTarget || !event.currentTarget.contains(header)) {
        return
      }

      const toggled = toggleFullscreenDockCollapsed(
        getFullscreenOpenDocks(),
        dock,
        fullscreenDockWeights,
        fullscreenDockCollapsedState,
        container.value.clientHeight
      )

      if (toggled) {
        event.preventDefault()
      }
    }

    function setFullscreenDockBoundary(dock, firstWeight) {
      const openDocks = getFullscreenOpenDocks()
      const index = openDocks.indexOf(dock)
      const nextDock = openDocks[index + 1]
      if (!nextDock) {
        return
      }

      const pairWeight = fullscreenDockWeights[dock] + fullscreenDockWeights[nextDock]
      const totalWeight = openDocks.reduce((total, name) => total + fullscreenDockWeights[name], 0)
      // Only enforce the comfortable minimum when every open dock can have
      // it. Dense stacks keep the full header plus a small content sliver so
      // dividers stay useful without clipping the header.
      const panelChrome = FULLSCREEN_DOCK_OUTER_INSET + FULLSCREEN_DOCK_GAP / 2
      const preferredMinimumFits = openDocks.length === 2 && container.value.clientHeight >=
        openDocks.length * FULLSCREEN_DOCK_PREFERRED_MIN_HEIGHT +
        FULLSCREEN_DOCK_OUTER_INSET * 2 +
        FULLSCREEN_DOCK_GAP * (openDocks.length - 1)
      const minimumHeight = preferredMinimumFits
        ? FULLSCREEN_DOCK_PREFERRED_MIN_HEIGHT
        : FULLSCREEN_DOCK_COMPACT_MIN_HEIGHT
      const minimumShare = minimumHeight + panelChrome
      const minimumWeight = Math.min(
        pairWeight / 2,
        minimumShare / container.value.clientHeight * totalWeight
      )
      const clampedWeight = Math.min(pairWeight - minimumWeight, Math.max(minimumWeight, firstWeight))
      fullscreenDockWeights[dock] = clampedWeight
      fullscreenDockWeights[nextDock] = pairWeight - clampedWeight
      fullscreenDockCollapsedState[dock] = null
      fullscreenDockCollapsedState[nextDock] = null
    }

    function handleFullscreenDockResizePointerDown(event, dock) {
      if (event.button !== 0 || !fullscreenDockCanResize(dock)) {
        return
      }

      const openDocks = getFullscreenOpenDocks()
      const index = openDocks.indexOf(dock)
      fullscreenDockResizing.value = true
      resizingFullscreenDock = dock
      resizingFullscreenDockWeightBefore = openDocks
        .slice(0, index)
        .reduce((total, name) => total + fullscreenDockWeights[name], 0)
      resizingFullscreenDockTotalWeight = openDocks
        .reduce((total, name) => total + fullscreenDockWeights[name], 0)
      resizingFullscreenDockBounds = container.value.getBoundingClientRect()
      window.addEventListener('pointermove', handleFullscreenDockResizePointerMove)
      window.addEventListener('pointerup', stopFullscreenDockResize)
      window.addEventListener('pointercancel', stopFullscreenDockResize)
      event.preventDefault()
    }

    function handleFullscreenDockResizePointerMove(event) {
      const pointerWeight = (event.clientY - resizingFullscreenDockBounds.top) /
        resizingFullscreenDockBounds.height * resizingFullscreenDockTotalWeight
      setFullscreenDockBoundary(resizingFullscreenDock, pointerWeight - resizingFullscreenDockWeightBefore)
    }

    function stopFullscreenDockResize() {
      fullscreenDockResizing.value = false
      resizingFullscreenDock = null
      resizingFullscreenDockBounds = null
      window.removeEventListener('pointermove', handleFullscreenDockResizePointerMove)
      window.removeEventListener('pointerup', stopFullscreenDockResize)
      window.removeEventListener('pointercancel', stopFullscreenDockResize)
    }

    onUnmounted(stopFullscreenDockResize)

    function handleFullscreenDockResizeKeydown(event, dock) {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
        return
      }

      const openDocks = getFullscreenOpenDocks()
      const totalWeight = openDocks.reduce((total, name) => total + fullscreenDockWeights[name], 0)
      const movement = (event.key === 'ArrowUp' ? -20 : 20) / container.value.clientHeight * totalWeight
      setFullscreenDockBoundary(dock, fullscreenDockWeights[dock] + movement)
      event.preventDefault()
    }

    let reorderingFullscreenDock = null
    let reorderingFullscreenDockBounds = null

    function handleFullscreenDockReorderPointerDown(event, dock) {
      const target = event.target instanceof Element ? event.target : null
      const header = target?.closest(FULLSCREEN_DOCK_HEADER_SELECTOR)
      const interactiveTarget = target?.closest('button, a, input, select, textarea, [role="button"]')
      if (
        event.button !== 0 || !fullscreenDockCanReorder(dock) || !header ||
        interactiveTarget || !event.currentTarget.contains(header)
      ) {
        return
      }

      fullscreenDockReordering.value = true
      reorderingFullscreenDock = dock
      reorderingFullscreenDockBounds = container.value.getBoundingClientRect()
      window.addEventListener('pointermove', handleFullscreenDockReorderPointerMove)
      window.addEventListener('pointerup', stopFullscreenDockReorder)
      window.addEventListener('pointercancel', stopFullscreenDockReorder)
      event.preventDefault()
    }

    function handleFullscreenDockReorderPointerMove(event) {
      const openDocks = getFullscreenOpenDocks()
      const currentIndex = openDocks.indexOf(reorderingFullscreenDock)
      const otherDocks = openDocks.filter(dock => dock !== reorderingFullscreenDock)
      // Hit-test against the target layout derived from the dock weights.
      // Measuring the panels while they animate towards their new slots would
      // force a layout pass per pointer move and oscillate around the pointer.
      const bounds = reorderingFullscreenDockBounds
      const totalWeight = openDocks.reduce((total, name) => total + fullscreenDockWeights[name], 0)
      let insertionIndex = otherDocks.length
      let weightBefore = 0
      let otherIndex = 0
      for (const dock of openDocks) {
        if (dock !== reorderingFullscreenDock) {
          const midpoint = bounds.top +
            (weightBefore + fullscreenDockWeights[dock] / 2) / totalWeight * bounds.height
          if (event.clientY < midpoint) {
            insertionIndex = otherIndex
            break
          }
          otherIndex++
        }
        weightBefore += fullscreenDockWeights[dock]
      }
      if (insertionIndex === currentIndex) {
        return
      }

      const orderIndex = fullscreenDockOrder.indexOf(reorderingFullscreenDock)
      fullscreenDockOrder.splice(orderIndex, 1)
      if (insertionIndex === otherDocks.length) {
        const lastOpenIndex = fullscreenDockOrder.indexOf(otherDocks.at(-1))
        fullscreenDockOrder.splice(lastOpenIndex + 1, 0, reorderingFullscreenDock)
      } else {
        const nextOpenIndex = fullscreenDockOrder.indexOf(otherDocks[insertionIndex])
        fullscreenDockOrder.splice(nextOpenIndex, 0, reorderingFullscreenDock)
      }
    }

    function stopFullscreenDockReorder() {
      fullscreenDockReordering.value = false
      reorderingFullscreenDock = null
      reorderingFullscreenDockBounds = null
      window.removeEventListener('pointermove', handleFullscreenDockReorderPointerMove)
      window.removeEventListener('pointerup', stopFullscreenDockReorder)
      window.removeEventListener('pointercancel', stopFullscreenDockReorder)
    }

    onUnmounted(stopFullscreenDockReorder)

    function getShareTimestamp() {
      const currentTime = Math.floor(video.value?.currentTime ?? 0)
      return Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0
    }

    function toggleQuickBookmark() {
      emit('toggle-quick-bookmark')
    }

    const hasLoaded = ref(false)
    const hasPlaybackPosition = ref(false)
    const videoLayoutReady = ref(false)
    const annotationCurrentTime = ref(0)
    const annotationVideoAspectRatio = ref(null)

    const hasMultipleAudioTracks = ref(false)
    const isLive = ref(props.isLive)

    const useVoiceOverTranslationSetting = computed(() => {
      return store.getters.getUseVoiceOverTranslation
    })
    const voiceOverTranslationLanguage = computed(() => {
      const language = store.getters.getVoiceOverTranslationLanguage
      return ['ru', 'en', 'kk'].includes(language) ? language : 'en'
    })
    const voiceOverTranslationVolume = computed(() => {
      const volume = Number(store.getters.getVoiceOverTranslationVolume) / 100
      return Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1
    })
    const voiceOverTranslationOriginalVolume = computed(() => {
      const volume = Number(store.getters.getVoiceOverTranslationOriginalVolume) / 100
      return Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0.1
    })
    const voiceOverTranslationAvailable = computed(() => {
      return process.env.IS_ELECTRON &&
        useVoiceOverTranslationSetting.value &&
        props.videoId !== '' &&
        !isLive.value
    })
    const voiceOverTranslationAutoPrepare = computed(() => {
      return voiceOverTranslationAvailable.value &&
        store.getters.getVoiceOverTranslationPrepareInBackground
    })
    const voiceOverTranslation = useVoiceOverTranslation({
      video,
      videoId: computed(() => props.videoId),
      responseLanguage: voiceOverTranslationLanguage,
      autoPrepare: voiceOverTranslationAutoPrepare,
      originalVolume: voiceOverTranslationOriginalVolume,
      voiceVolume: voiceOverTranslationVolume,
      onError: error => {
        const message = error instanceof RangeError
          ? t('Video.Player.Voice-over Translation.Duration Error')
          : t('Video.Player.Voice-over Translation.Error')
        console.error('Voice-over translation failed', error)
        showToast({ message, icon: ['fas', 'circle-exclamation'] })
      }
    })

    const preferredCaptionLocale = computed(() => {
      return store.getters.getPreferredCaptionLocale || locale.value
    })
    let lastSelectedCaptionTrack = null

    function getCaptionToEnable() {
      return getPreferredCaption(
        props.captions,
        preferredCaptionLocale.value,
        store.getters.getEnableCaptionTranslations
      )
    }

    function findMatchingTextTrack(textTracks, caption) {
      if (!caption) {
        return null
      }

      const originalTextId = caption.originalTextId ?? caption.id

      return textTracks.find(track => originalTextId != null && track.originalTextId === originalTextId) ??
        textTracks.find(track => track.language === caption.language && track.label === caption.label) ??
        null
    }

    function getTextTrackToEnable(textTracks) {
      return findMatchingTextTrack(textTracks, lastSelectedCaptionTrack) ??
        findMatchingTextTrack(textTracks, getCaptionToEnable()) ??
        textTracks[0]
    }

    const onlyUseOverFlowMenu = ref(false)
    const forceAspectRatio = ref(false)

    const activeLegacyFormat = shallowRef(null)

    const fullWindowEnabled = ref(false)
    const annotationVideoFit = computed(() => {
      return props.shortsPlayer && !isFullscreen.value && !fullWindowEnabled.value
        ? 'cover'
        : 'contain'
    })
    const fullWindowPlaceholderHeight = ref(0)
    /** @type {Animation|null} */
    let fullWindowAnimation = null
    // The setFullWindow listener is only attached once the shaka UI is built. An
    // early isActiveTab tick can run applyPendingPresentationModes before then, so
    // gate the full-window request on the listener being ready to avoid consuming
    // (and dropping) the startup flag while nothing is listening for the event.
    let fullWindowListenerReady = false
    let startInFullwindow = props.startInFullwindow
    let startInFullscreen = props.startInFullscreen
    let startInPip = props.startInPip
    let restoreChapters = props.startWithChapters
    let restoreFullscreenMetadata = props.startWithFullscreenMetadata
    let restoreFullscreenTranscript = false
    let restoreFullscreenSponsorBlock = false
    let restoreFullscreenComments = props.startWithFullscreenComments
    let restoreFullscreenLiveChat = props.startWithFullscreenLiveChat
    let restoreFullscreenPlaylist = props.startWithFullscreenPlaylist
    let exitFullscreenCleanup = null
    let syncingChapterOverlayButton = false

    /**
     * The subtitles state that was saved for this video's channel, if there is one.
     * @returns {boolean | null}
     */
    function getSavedChannelSubtitlesState() {
      if (!store.getters.getRememberSubtitlesStatePerChannel || props.channelId === '') {
        return null
      }

      const value = parseChannelPreferences(
        store.getters.getChannelSubtitlesStates,
        'channelSubtitlesStates'
      )[props.channelId]

      return typeof value === 'boolean' ? value : null
    }

    /** @type {number|null} */
    let restoreCaptionIndex = props.sabrReloadCaptionIndex

    // The channel's subtitles state is more specific than the global default, so it wins
    const enableSubtitlesInitially = getSavedChannelSubtitlesState() ?? store.getters.getEnableSubtitlesByDefault

    if (restoreCaptionIndex === null && enableSubtitlesInitially && props.captions.length > 0) {
      const caption = getCaptionToEnable()
      restoreCaptionIndex = caption ? props.captions.indexOf(caption) : 0
    }

    const showStats = ref(false)
    const stats = reactive({
      resolution: {
        width: 0,
        height: 0,
        frameRate: 0
      },
      bitrate: '0',
      volume: '100',
      bandwidth: '0',
      buffered: '0',
      frames: {
        totalFrames: 0,
        droppedFrames: 0
      },
      codecs: {
        audioItag: '',
        audioCodec: '',
        videoItag: '',
        videoCodec: ''
      }
    })

    const playerDimensions = computed(() => ({
      width: playerWidth.value,
      height: playerHeight.value
    }))

    // #region settings

    const isCrossTabMiniPlayerPresented = ref(false)

    const {
      getAutoPictureInPictureState,
      initializeActiveTab,
      isActiveTab,
      notifyPictureInPictureState,
      restorePictureInPicture,
      setupAutoPictureInPicture,
      teardownAutoPictureInPicture,
      updateAutoPip,
    } = useAutoPictureInPicture({
      getUi: () => ui,
      props,
      video,
      tabId,
      isTabPresented,
      isCrossTabMiniPlayerPresented,
      isPictureInPictureRestorePending: () => startInPip,
      initialState: props.autoPictureInPictureState,
    })

    // Capture the replacement player's initial state. The parent clears its
    // pending SABR state after this player loads, but that must not add autoplay
    // to the same media element afterward.
    const suppressInitialAutoplay = props.suppressAutoplayAfterSabrReload

    /** @type {import('vue').ComputedRef<boolean>} */
    const autoplayVideos = computed(() => {
      return !suppressInitialAutoplay && store.getters.getAutoplayVideos && isActiveTab.value
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const loopShorts = computed(() => {
      return store.getters.getLoopShorts
    })

    watch(isActiveTab, (active) => {
      if (active) {
        nextTick(() => {
          applyPendingPresentationModes()
          remeasureControlPanelWidth()
          syncAndroidStatusBarVisibility()
        })
      } else {
        if (controlPanelLayoutFrame !== null) {
          cancelAnimationFrame(controlPanelLayoutFrame)
          controlPanelLayoutFrame = null
        }
        handleTemporaryPlaybackRateFocusLoss()
        syncAndroidStatusBarVisibility()
      }
    })

    // Keep the theatre mode button's icon/label in sync when theatre mode is
    // toggled programmatically (e.g. a side panel opening forces the default
    // theatre mode), not just when the user clicks the button itself.
    watch(() => props.useTheatreMode, (value) => {
      events.dispatchEvent(new CustomEvent('syncTheatreMode', { detail: value }))
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const displayVideoPlayButton = computed(() => {
      return store.getters.getDisplayVideoPlayButton
    })

    const ambientMode = computed(() => {
      return store.getters.getAmbientMode
    })

    const musicAudioTrack = computed(() => {
      return props.musicMediaType === MUSIC_MEDIA_TYPE.AUDIO_TRACK
    })

    const audioPlayerMode = computed(() => {
      return props.format === 'audio' || musicAudioTrack.value
    })

    const musicVisualizer = computed(() => {
      return store.getters.getMusicVisualizer
    })

    const musicVisualizerEnabled = computed(() => {
      return audioPlayerMode.value && musicVisualizer.value
    })

    function hideBrokenMusicImage(event) {
      if (event.currentTarget instanceof HTMLImageElement) {
        event.currentTarget.hidden = true
      }
    }

    function showMusicImage(event) {
      if (event.currentTarget instanceof HTMLImageElement) {
        event.currentTarget.hidden = false
      }
    }

    const skipSilence = computed(() => {
      return store.getters.getTabSkipSilence(mediaTabId)
    })

    const showSkipSilenceButton = computed(() => {
      return store.getters.getShowSkipSilenceButton
    })

    const silenceSkipping = useSilenceSkipping({
      available: showSkipSilenceButton,
      enabled: skipSilence,
      isLive,
      video,
    })

    /** @type {shaka.extern.RequestFilter} */
    function silenceSkippingRequestFilter(type, _request, context) {
      if (type === RequestType.SEGMENT) {
        silenceSkipping.handleSegmentRequest(context)
      }
    }

    /** @type {shaka.extern.ResponseFilter} */
    function silenceSkippingResponseFilter(type, response, context) {
      if (type === RequestType.SEGMENT) {
        silenceSkipping.handleSegmentResponse(response, context)
      }
    }

    const captionSettings = computed(() => parseCaptionSettings(store.getters.getDefaultCaptionSettings))
    const captionCssVariables = computed(() => getCaptionCssVariables(captionSettings.value))
    const captionPositionArea = computed(() => CAPTION_POSITION_AREAS[captionSettings.value.anchor])
    const showCaptionAppearanceSample = ref(false)
    const captionAppearanceSampleBottom = ref('var(--caption-hidden-bottom-gap)')
    let captionAppearanceSampleTimeout = null

    function previewCaptionAppearance() {
      const textContainer = container.value?.querySelector('.shaka-text-container')
      const displayedCaption = Array.from(
        textContainer?.querySelectorAll('[translate="no"]') ?? []
      ).some(element => element.textContent?.trim())

      if (displayedCaption) {
        showCaptionAppearanceSample.value = false
        clearTimeout(captionAppearanceSampleTimeout)
        return
      }

      if (textContainer) {
        captionAppearanceSampleBottom.value = getComputedStyle(textContainer).bottom
      }
      showCaptionAppearanceSample.value = true
      clearTimeout(captionAppearanceSampleTimeout)
      captionAppearanceSampleTimeout = setTimeout(() => {
        showCaptionAppearanceSample.value = false
      }, 1000)
    }

    /**
     * @param {'textColor' | 'backgroundColor' | 'backgroundOpacity' | 'fontScale' | 'verticalPosition' | 'anchor' | 'edgeStyle' | 'edgeColor'} setting
     * @param {string | number} value
     */
    function updateCaptionAppearance(setting, value) {
      store.dispatch('updateDefaultCaptionSettings', JSON.stringify({
        ...captionSettings.value,
        [setting]: value,
      }))
      previewCaptionAppearance()
    }

    function resetCaptionAppearance() {
      store.dispatch('updateDefaultCaptionSettings', JSON.stringify(DEFAULT_CAPTION_SETTINGS))
      previewCaptionAppearance()
    }

    watch(captionPositionArea, positionArea => {
      player?.configure('textDisplayer.positionArea', positionArea)
    })

    onUnmounted(() => {
      clearTimeout(captionAppearanceSampleTimeout)
    })

    /** @param {boolean} value */
    function updateAmbientMode(value) {
      store.dispatch('updateAmbientMode', value)
    }

    /** @param {boolean} value */
    function updateMusicVisualizer(value) {
      store.dispatch('updateMusicVisualizer', value)
    }

    /** @param {boolean} value */
    function updateSkipSilence(value) {
      return store.dispatch('updateTabSkipSilence', {
        tabId: mediaTabId,
        value
      })
    }

    watch(displayVideoPlayButton, (newValue) => {
      ui.configure({
        bigButtons: newValue || isCapacitorMobilePlayer() ? ['play_pause'] : []
      })
    })

    /** @type {import('vue').ComputedRef<number>} */
    const defaultSkipInterval = computed(() => {
      return store.getters.getDefaultSkipInterval
    })
    const seekIntervalMultiplyByPlaybackRate = computed(() => {
      return store.getters.getSeekIntervalMultiplyByPlaybackRate
    })
    const showPlaybackRateAdjustedTimestamp = computed(() => {
      return store.getters.getShowPlaybackRateAdjustedTimestamp
    })

    watch(defaultSkipInterval, (newValue) => {
      ui.configure({
        tapSeekDistance: newValue
      })
    })

    watch(showPlaybackRateAdjustedTimestamp, () => {
      events.dispatchEvent(new CustomEvent('timeDisplaySettingsChanged'))
    })

    /**
     * The numeric quality to start with. Auto is handled separately by
     * `preferAutoQuality`, so that the quality selection code paths, which all
     * work with resolutions, keep a usable value to fall back to.
     * @type {import('vue').ComputedRef<number>}
     */
    const defaultQuality = computed(() => {
      const value = store.getters.getDefaultQuality

      return parseInt(value === 'auto' ? AUTO_QUALITY_FALLBACK : value)
    })

    /** @type {import('vue').ComputedRef<number>} */
    const preferredVideoQuality = computed(() => {
      const value = Number.parseInt(props.currentVideoQuality)
      return Number.isNaN(value) ? defaultQuality.value : value
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const preferAutoQuality = computed(() => {
      if (!autoQualitySupported.value) {
        return false
      }

      if (props.currentVideoQuality === 'auto') {
        return true
      }

      // Only fall back to the setting when no quality was passed in,
      // e.g. before the watch page has resolved a channel specific one
      return Number.isNaN(Number.parseInt(props.currentVideoQuality)) &&
        store.getters.getDefaultQuality === 'auto'
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const enterFullscreenOnDisplayRotate = computed(() => {
      return store.getters.getEnterFullscreenOnDisplayRotate
    })

    const rotateFullscreenToLandscape = computed(() => {
      return store.getters.getRotateFullscreenToLandscape
    })

    const enableMobileFullscreenSwipe = computed(() => {
      return store.getters.getEnableMobileFullscreenSwipe
    })

    watch(enterFullscreenOnDisplayRotate, (newValue) => {
      ui.configure({
        enableFullscreenOnRotation: !process.env.IS_CAPACITOR && newValue
      })
    })

    watch(rotateFullscreenToLandscape, (enabled) => {
      if (!isNativeFullscreenActive()) return
      setFullscreenOrientation(true, video.value, enabled && !player?.nativePlayback?.isFullscreenFromRotation()).catch(() => {})
    })

    /** @type {import('vue').ComputedRef<number>} */
    const defaultPlaybackRate = computed(() => {
      return store.getters.getDefaultPlayback
    })

    /** @type {import('vue').ComputedRef<number>} */
    const defaultVolume = computed(() => {
      return store.getters.getDefaultVolume
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const rememberVolume = computed(() => {
      return store.getters.getRememberVolume
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const rememberVolumePerChannel = computed(() => {
      return store.getters.getRememberVolumePerChannel
    })

    /**
     * The volume that was saved for this video's channel, if there is one.
     * @type {import('vue').ComputedRef<number | null>}
     */
    const savedChannelVolume = computed(() => {
      if (!rememberVolumePerChannel.value || props.channelId === '') {
        return null
      }

      const value = parseChannelPreferences(store.getters.getChannelVolumes, 'channelVolumes')[props.channelId]

      return typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : null
    })

    let applyingInitialVolume = false

    watch(defaultPlaybackRate, (newValue) => {
      if (video.value) {
        video.value.defaultPlaybackRate = getDefaultPlaybackRateForVideo(newValue)
      }
    })

    const maxVideoPlaybackRate = computed(() => {
      return parseInt(store.getters.getMaxVideoPlaybackRate)
    })

    /** @type {import('vue').ComputedRef<string>} */
    const channelPlaybackSpeeds = computed(() => {
      return store.getters.getChannelPlaybackSpeeds
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const rememberPlaybackSpeedPerChannel = computed(() => {
      return store.getters.getRememberPlaybackSpeedPerChannel
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const autoUpdateChannelPlaybackSpeeds = computed(() => {
      return store.getters.getAutoUpdateChannelPlaybackSpeeds
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const useQuickPlaybackSpeedBar = computed(() => {
      return store.getters.getUseQuickPlaybackSpeedBar
    })

    /** @type {import('vue').ComputedRef<Array<{speed: number, name: string}>>} */
    const quickPlaybackSpeedBarOptions = computed(() => {
      try {
        const parsedOptions = JSON.parse(store.getters.getQuickPlaybackSpeedBarOptions || '[]')

        if (!Array.isArray(parsedOptions)) {
          return [{ speed: 1, name: '' }]
        }

        const options = parsedOptions
          .map((option) => ({
            speed: Number.parseFloat(option?.speed),
            name: typeof option?.name === 'string' ? option.name : '',
          }))
          .filter((option) => Number.isFinite(option.speed) && option.speed > 0)

        return options.length > 0 ? options : [{ speed: 1, name: '' }]
      } catch (error) {
        console.error('Failed to parse quick playback speed bar options:', error)
        return [{ speed: 1, name: '' }]
      }
    })

    /** @type {import('vue').ComputedRef<number | null>} */
    const savedChannelPlaybackRate = computed(() => {
      if (!rememberPlaybackSpeedPerChannel.value || props.channelId === '') {
        return null
      }

      try {
        const channelSpeeds = JSON.parse(channelPlaybackSpeeds.value || '{}')
        const value = channelSpeeds[props.channelId]

        if (typeof value === 'number' && Number.isFinite(value)) {
          return value
        }

        if (typeof value === 'string') {
          const parsedValue = Number.parseFloat(value)
          return Number.isFinite(parsedValue) ? parsedValue : null
        }
      } catch (error) {
        console.error('Failed to parse channel playback speeds for quick playback speed bar:', error)
      }

      return null
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const canManuallySaveChannelPlaybackRate = computed(() => {
      return rememberPlaybackSpeedPerChannel.value &&
        !autoUpdateChannelPlaybackSpeeds.value &&
        props.channelId !== ''
    })

    const videoPlaybackRateInterval = computed(() => {
      return parseFloat(store.getters.getVideoPlaybackRateInterval)
    })

    const playbackRates = computed(() => {
      const interval = videoPlaybackRateInterval.value
      const playbackRates = []
      let i = interval

      while (i <= maxVideoPlaybackRate.value) {
        playbackRates.unshift(i)
        i += interval
        i = parseFloat(i.toFixed(2))
      }

      return playbackRates
    })

    watch(playbackRates, (newValue) => {
      ui.configure({
        playbackRates: newValue
      })
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const enableScreenshot = computed(() => {
      return store.getters.getEnableScreenshot
    })

    const usePlayerMenuGrid = computed(() => {
      return store.getters.getUsePlayerMenuGrid
    })

    /** @type {import('vue').ComputedRef<string>} */
    const screenshotMode = computed(() => {
      const mode = store.getters.getScreenshotMode
      return !process.env.IS_ELECTRON && mode === 'default_folder' ? 'prompt_folder' : mode
    })

    /** @type {import('vue').ComputedRef<string>} */
    const screenshotFormat = computed(() => {
      return store.getters.getScreenshotFormat
    })

    /** @type {import('vue').ComputedRef<number>} */
    const screenshotQuality = computed(() => {
      return store.getters.getScreenshotQuality
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const videoVolumeMouseScroll = computed(() => {
      return !process.env.IS_CAPACITOR && store.getters.getVideoVolumeMouseScroll
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const videoPlaybackRateMouseScroll = computed(() => {
      return store.getters.getVideoPlaybackRateMouseScroll
    })

    const holdToDoublePlaybackSpeed = computed(() => {
      return store.getters.getHoldToDoublePlaybackSpeed
    })

    watch(holdToDoublePlaybackSpeed, (enabled) => {
      if (!enabled) {
        handleTemporaryPlaybackRateFocusLoss()
      }
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const videoSkipMouseScroll = computed(() => {
      return store.getters.getVideoSkipMouseScroll
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const useSponsorBlock = computed(() => {
      return store.getters.getUseSponsorBlock
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const sponsorBlockShowSkippedToast = computed(() => {
      return store.getters.getSponsorBlockShowSkippedToast
    })

    const sponsorBlockEnableSubmission = computed(() => {
      return store.getters.getSponsorBlockEnableSubmission
    })

    /** @type {import('vue').ComputedRef<number>} */
    const sponsorBlockSkippedToastDuration = computed(() => {
      return store.getters.getSponsorBlockSkippedToastDuration
    })

    const sponsorBlockSkippedToastDurationMs = computed(() => {
      return Math.max(2, Math.min(15, sponsorBlockSkippedToastDuration.value)) * 1000
    })

    const sponsorSkips = computed(() => {
      // save some work when sponsorblock is disabled
      if (!useSponsorBlock.value) {
        return {
          autoSkip: new Set(),
          seekBar: [],
          promptSkip: new Set(),
          categoryData: {}
        }
      }

      /** @type {SponsorBlockCategory[]} */
      /** @type {Set<SponsorBlockCategory>} */
      const autoSkip = new Set()

      /** @type {SponsorBlockCategory[]} */
      const seekBar = []

      /** @type {Set<SponsorBlockCategory>} */
      const promptSkip = new Set()

      /**
       * @type {{
       *   [key in SponsorBlockCategory]: {
       *     color: string,
       *     skip: 'autoSkip' | 'promptToSkip' | 'showInSeekBar' | 'doNothing'
       *   }
        }} */
      const categoryData = {}

      SPONSORBLOCK_CATEGORIES.forEach(x => {
        let sponsorVal = {}
        switch (x) {
          case 'sponsor':
            sponsorVal = store.getters.getSponsorBlockSponsor
            break
          case 'selfpromo':
            sponsorVal = store.getters.getSponsorBlockSelfPromo
            break
          case 'interaction':
            sponsorVal = store.getters.getSponsorBlockInteraction
            break
          case 'intro':
            sponsorVal = store.getters.getSponsorBlockIntro
            break
          case 'outro':
            sponsorVal = store.getters.getSponsorBlockOutro
            break
          case 'preview':
            sponsorVal = store.getters.getSponsorBlockRecap
            break
          case 'hook':
            sponsorVal = store.getters.getSponsorBlockHook
            break
          case 'music_offtopic':
            sponsorVal = store.getters.getSponsorBlockMusicOffTopic
            break
          case 'filler':
            sponsorVal = store.getters.getSponsorBlockFiller
            break
          case 'poi_highlight':
            sponsorVal = store.getters.getSponsorBlockHighlight
            break
        }

        const skip = x === 'poi_highlight' && sponsorVal.skip === 'autoSkip'
          ? 'promptToSkip'
          : sponsorVal.skip

        if (skip !== 'doNothing') {
          seekBar.push(x)
        }

        if (skip === 'autoSkip') {
          autoSkip.add(x)
        }

        if (skip === 'promptToSkip') {
          promptSkip.add(x)
        }

        categoryData[x] = {
          ...sponsorVal,
          skip
        }
      })
      return { autoSkip, seekBar, promptSkip, categoryData }
    })

    // #endregion settings

    // #region SponsorBlock

    /**
     * @type {{
     *   uuid: string
     *   category: SponsorBlockCategory
     *   actionType?: 'skip' | 'mute' | 'full' | 'poi'
     *   startTime: number,
     *   endTime: number
     * }[]}
     */
    let sponsorBlockSegments = []
    const sponsorBlockInfoSegments = ref([])
    const sponsorBlockInfoOpen = ref(props.sponsorBlockInfoOpen)
    const sponsorBlockInfoLoading = ref(false)
    const sponsorBlockContributionStats = ref(null)
    const sponsorBlockContributionStatsError = ref(false)
    const sponsorBlockContributionStatsLoaded = ref(false)
    const sponsorBlockContributionStatsLoading = ref(false)
    const sponsorBlockVotePending = ref(null)
    const sponsorBlockUserVotes = reactive({})
    let terminalSponsorBlockOutroStarted = false
    let sponsorBlockAverageVideoDuration = 0
    const hasSponsorBlockMusicOfftopicSegment = ref(false)
    const activeSponsorBlockHighlightSegment = ref(null)
    let sponsorBlockHighlightLabelVisible = true
    let sponsorBlockHighlightLabelRemainingMs = SPONSORBLOCK_HIGHLIGHT_LABEL_PLAYBACK_MS
    let sponsorBlockHighlightLabelStartedAt = null
    let sponsorBlockHighlightLabelTimeout = null

    /**
     * Yes a map would be much more suitable for this (unlike objects they retain the order that items were inserted),
     * but Vue 2 doesn't support reactivity on Maps, so we have to use an array instead
     * @type {import('vue').Ref<{uuid: string, translatedCategory: string, color: string, timeoutId: ReturnType<typeof setTimeout>|0, hideAt: number|null, hideRemainingMs: number, unskipped: boolean, countdownPaused: boolean, isHighlight: boolean, isMute: boolean, unskipTime: number|null}[]>}
     */
    const skippedSponsorBlockSegments = ref([])
    const promptSponsorBlockSegments = ref([])
    const sponsorBlockToastNow = ref(Date.now())
    const sponsorBlockCurrentTime = ref(0)
    let sponsorBlockToastTimeInterval = null
    const manuallyMutedSponsorBlockSegments = new Set()
    const sponsorBlockDoNotMuteSegments = new Set()
    const notifiedSponsorBlockMuteSegments = new Set()
    const sponsorBlockMuteController = createSponsorBlockMuteController({
      getMuted: () => video.value?.muted ?? false,
      setMuted: muted => {
        if (video.value) {
          video.value.muted = muted
        }
      }
    })

    const {
      cancelCurrentSponsorBlockDraft,
      clearSponsorBlockDrafts,
      closeSponsorBlockSubmissionMenu,
      deleteSponsorBlockDraft,
      endSponsorBlockDraft,
      getSponsorBlockSubmissionVideoDuration,
      handleSponsorBlockPreviewSkip,
      isSponsorBlockDraftEditing,
      isSponsorBlockFullVideoSegment,
      isSponsorBlockPointSegment,
      loadSponsorBlockDrafts,
      openSponsorBlockGuidelines,
      openSponsorBlockSubmissionMenu,
      previewSponsorBlockDraft,
      saveSponsorBlockDraft,
      setSponsorBlockDraftTime,
      sponsorBlockCompleteDraftSegments,
      sponsorBlockDraftEditValues,
      sponsorBlockDraftSegments,
      sponsorBlockDraftSegmentsByVideoId,
      sponsorBlockSubmissionCategories,
      sponsorBlockSubmissionCategoryNames,
      getSponsorBlockActionTypeSelectNames,
      getSponsorBlockActionTypeSelectValues,
      sponsorBlockSubmissionError,
      sponsorBlockSubmissionMenuOpen,
      sponsorBlockSubmissionPending,
      sponsorBlockSubmissionVisibleButtons,
      startSponsorBlockDraft,
      submitSponsorBlockDrafts,
      toggleSponsorBlockDraftEditing,
      updateSponsorBlockDraftActionType,
      updateSponsorBlockDraftCategory,
      updateSponsorBlockDraftEditField,
      updateSponsorBlockSubmissionState,
    } = useSponsorBlockSubmission({
      canSeek,
      events,
      getPlayer: () => player,
      isLive,
      onSubmittedSegments: (submittedSegments) => {
        const playbackSegments = submittedSegments.filter(segment => {
          return SPONSORBLOCK_PLAYBACK_ACTION_TYPES.includes(segment.actionType)
        })
        sponsorBlockSegments = sponsorBlockSegments.concat(playbackSegments).sort((a, b) => a.startTime - b.startTime)
        sponsorBlockInfoSegments.value = sponsorBlockInfoSegments.value
          .concat(submittedSegments.map(segment => ({ ...segment, locked: 0, votes: 0 })))
          .sort((a, b) => a.startTime - b.startTime)
        scheduleSponsorBlockSkip()
        emitSponsorBlockInfoState()
        refreshSponsorBlockMarkers()
        if (sponsorBlockInfoOpen.value) {
          refreshSponsorBlockContributionStats()
        } else {
          sponsorBlockContributionStatsLoaded.value = false
        }
      },
      props,
      showOverlayControls,
      sponsorBlockCurrentTime,
      setSponsorBlockPreviewMuted: muted => sponsorBlockMuteController.setSourceActive('preview', muted),
      t,
      useSponsorBlock,
      video,
    })

    /**
     * Set of segment UUIDs that the user has explicitly unskipped.
     * These segments will not be auto-skipped again until the user leaves the segment.
     * @type {Set<string>}
     */
    let sponsorBlockDoNotSkipSegments = new Set()
    /**
     * Set of segment UUIDs whose prompt has been dismissed until playback leaves the segment.
     * @type {Set<string>}
     */
    let sponsorBlockDismissedPromptSegments = new Set()
    let sponsorBlockNotFoundRefetchTimeout = null
    let sponsorBlockSkipScheduleTimeout = null
    let sponsorBlockSkipScheduleInterval = null
    let sponsorBlockSkipScheduleTaskController = null

    function cancelSponsorBlockSkipSchedule() {
      clearTimeout(sponsorBlockSkipScheduleTimeout)
      clearInterval(sponsorBlockSkipScheduleInterval)
      sponsorBlockSkipScheduleTaskController?.abort()
      sponsorBlockSkipScheduleTimeout = null
      sponsorBlockSkipScheduleInterval = null
      sponsorBlockSkipScheduleTaskController = null
    }

    function clearSponsorBlockNotFoundRefetchTimeout() {
      if (sponsorBlockNotFoundRefetchTimeout !== null) {
        clearTimeout(sponsorBlockNotFoundRefetchTimeout)
        sponsorBlockNotFoundRefetchTimeout = null
      }
    }

    function isRecentVideoForSponsorBlockRefetch() {
      if (!Number.isFinite(props.published) || props.published <= 0) {
        return false
      }

      const videoAgeMs = Date.now() - props.published
      return videoAgeMs >= 0 && videoAgeMs <= SPONSORBLOCK_NOT_FOUND_REFETCH_RECENT_VIDEO_AGE_MS
    }

    function scheduleSponsorBlockNotFoundRefetch() {
      clearSponsorBlockNotFoundRefetchTimeout()

      if (
        !useSponsorBlock.value ||
        !isRecentVideoForSponsorBlockRefetch() ||
        props.videoId === '' ||
        sponsorBlockInfoSegments.value.length > 0
      ) {
        return
      }

      const videoId = props.videoId
      const refetchDelayMs = SPONSORBLOCK_NOT_FOUND_REFETCH_MIN_DELAY_MS +
        Math.random() * (SPONSORBLOCK_NOT_FOUND_REFETCH_MAX_DELAY_MS - SPONSORBLOCK_NOT_FOUND_REFETCH_MIN_DELAY_MS)

      sponsorBlockNotFoundRefetchTimeout = setTimeout(() => {
        sponsorBlockNotFoundRefetchTimeout = null

        if (!ui || !player || props.videoId !== videoId || sponsorBlockInfoSegments.value.length > 0) {
          return
        }

        refetchSponsorBlockSegmentsWhenNotFound()
      }, refetchDelayMs)
    }

    async function refetchSponsorBlockSegmentsWhenNotFound() {
      let segments, averageDuration

      try {
        ({ segments, averageDuration } = await getSponsorBlockSegments(
          props.videoId,
          SPONSORBLOCK_INFO_CATEGORIES,
          SPONSORBLOCK_INFO_ACTION_TYPES
        ))
      } catch (e) {
        console.error(e)
        return
      }

      if (!ui || !player) {
        return
      }

      if (segments.length > 0) {
        sponsorBlockInfoSegments.value = segments
        sponsorBlockSegments = segments.filter(segment => {
          return SPONSORBLOCK_PLAYBACK_ACTION_TYPES.includes(segment.actionType) && sponsorSkips.value.seekBar.includes(segment.category)
        })
        sponsorBlockAverageVideoDuration = averageDuration
        hasSponsorBlockMusicOfftopicSegment.value = segments.some(segment => segment.category === 'music_offtopic')
        refreshSponsorBlockMarkers()
        if (canSeek()) {
          const currentTime = video.value?.currentTime ?? 0
          syncPromptSponsorBlockSegments(currentTime)
          updateSponsorBlockHighlightState(currentTime)
          syncSponsorBlockMuteSegments(currentTime, !props.sponsorBlockAutoSkipDisabled)
          scheduleSponsorBlockSkip()
        }
      } else {
        scheduleSponsorBlockNotFoundRefetch()
      }
      emitSponsorBlockInfoState()
    }

    async function setupSponsorBlock() {
      let segments
      let averageDuration = 0
      let refetchWhenNotFound = false

      clearSponsorBlockNotFoundRefetchTimeout()
      cancelSponsorBlockSkipSchedule()

      // Reset the do-not-skip set for the new video
      sponsorBlockDoNotSkipSegments = new Set()
      sponsorBlockDismissedPromptSegments = new Set()
      clearSponsorBlockMuteSegments()
      sponsorBlockSegments = []
      sponsorBlockInfoSegments.value = []
      terminalSponsorBlockOutroStarted = false
      sponsorBlockAverageVideoDuration = 0
      hasSponsorBlockMusicOfftopicSegment.value = false
      activeSponsorBlockHighlightSegment.value = null
      updateSponsorBlockHighlightState(0)

      sponsorBlockInfoLoading.value = true
      emitSponsorBlockInfoState()
      try {
        ({ segments, averageDuration } = await getSponsorBlockSegments(
          props.videoId,
          SPONSORBLOCK_INFO_CATEGORIES,
          SPONSORBLOCK_INFO_ACTION_TYPES
        ))
        refetchWhenNotFound = segments.length === 0
      } catch (e) {
        console.error(e)
        segments = []
      } finally {
        sponsorBlockInfoLoading.value = false
        emitSponsorBlockInfoState()
      }

      // check if the component is already getting destroyed
      // which is possible because this function runs asynchronously
      if (!ui || !player) {
        return
      }

      clearSponsorBlockMarkers()

      if (segments.length > 0) {
        sponsorBlockInfoSegments.value = segments
        sponsorBlockSegments = segments.filter(segment => {
          return SPONSORBLOCK_PLAYBACK_ACTION_TYPES.includes(segment.actionType) && sponsorSkips.value.seekBar.includes(segment.category)
        })
        sponsorBlockAverageVideoDuration = averageDuration
        hasSponsorBlockMusicOfftopicSegment.value = segments.some(segment => segment.category === 'music_offtopic')
      } else if (refetchWhenNotFound) {
        scheduleSponsorBlockNotFoundRefetch()
      }

      emitSponsorBlockInfoState()

      refreshSponsorBlockMarkers()
      if (sponsorBlockSegments.length > 0 && canSeek()) {
        const currentTime = video.value?.currentTime ?? 0
        syncPromptSponsorBlockSegments(currentTime)
        updateSponsorBlockHighlightState(currentTime)
        syncSponsorBlockMuteSegments(currentTime, !props.sponsorBlockAutoSkipDisabled)
        scheduleSponsorBlockSkip()
      }
    }

    async function refreshSponsorBlockInfo() {
      const refreshTasks = [setupSponsorBlock()]
      if (sponsorBlockEnableSubmission.value) {
        refreshTasks.push(refreshSponsorBlockContributionStats())
      }
      await Promise.all(refreshTasks)
    }

    async function refreshSponsorBlockContributionStats() {
      if (!sponsorBlockEnableSubmission.value || sponsorBlockContributionStatsLoading.value) {
        return
      }

      sponsorBlockContributionStatsLoading.value = true
      sponsorBlockContributionStatsError.value = false
      emitSponsorBlockInfoState()

      try {
        sponsorBlockContributionStats.value = await getSponsorBlockContributionStats()
      } catch {
        sponsorBlockContributionStatsError.value = true
      } finally {
        sponsorBlockContributionStatsLoaded.value = true
        sponsorBlockContributionStatsLoading.value = false
        emitSponsorBlockInfoState()
      }
    }

    function emitSponsorBlockInfoState() {
      const detail = {
        open: sponsorBlockInfoOpen.value,
        loading: sponsorBlockInfoLoading.value,
        contributionStats: sponsorBlockContributionStats.value,
        contributionStatsError: sponsorBlockContributionStatsError.value,
        contributionStatsLoaded: sponsorBlockContributionStatsLoaded.value,
        contributionStatsLoading: sponsorBlockContributionStatsLoading.value,
        submissionEnabled: sponsorBlockEnableSubmission.value,
        pendingUuid: sponsorBlockVotePending.value,
        segments: sponsorBlockInfoSegments.value.map(segment => ({
          ...segment,
          color: getSponsorBlockInfoSegmentColor(segment.category),
          timeLabel: formatSponsorBlockInfoSegmentTime(segment),
          translatedCategory: translateSponsorBlockCategory(segment.category),
          userVote: sponsorBlockUserVotes[segment.uuid] ?? null,
        }))
      }

      emit('sponsorblock-info-change', detail)
      events.dispatchEvent(new CustomEvent('sponsorBlockInfoStateChanged', { detail }))
    }

    function toggleSponsorBlockInfo() {
      sponsorBlockInfoOpen.value = !sponsorBlockInfoOpen.value
      if (
        sponsorBlockInfoOpen.value &&
        sponsorBlockEnableSubmission.value &&
        !sponsorBlockContributionStatsLoaded.value &&
        !sponsorBlockContributionStatsLoading.value
      ) {
        refreshSponsorBlockContributionStats()
      }
      if (!sponsorBlockInfoOpen.value) {
        restoreFullscreenSponsorBlock = false
      }
      ui?.getControls().hideSettingsMenus()
      showOverlayControls()
      emitSponsorBlockInfoState()
    }

    function closeSponsorBlockInfo() {
      sponsorBlockInfoOpen.value = false
      restoreFullscreenSponsorBlock = false
      emitSponsorBlockInfoState()
    }

    function getSponsorBlockInfoSegmentColor(category) {
      return getSponsorBlockToastColor(category)
    }

    function formatSponsorBlockInfoTimestamp(seconds) {
      const safeSeconds = Number.isFinite(seconds) ? Math.max(seconds, 0) : 0
      const totalMilliseconds = Math.round(safeSeconds * 1000)
      const milliseconds = String(totalMilliseconds % 1000).padStart(3, '0')
      const totalSeconds = Math.floor(totalMilliseconds / 1000)
      const secondsPart = String(totalSeconds % 60).padStart(2, '0')
      const totalMinutes = Math.floor(totalSeconds / 60)
      const minutesPart = totalMinutes % 60
      const hours = Math.floor(totalMinutes / 60)

      return hours > 0
        ? `${hours}:${String(minutesPart).padStart(2, '0')}:${secondsPart}.${milliseconds}`
        : `${minutesPart}:${secondsPart}.${milliseconds}`
    }

    function formatSponsorBlockInfoSegmentTime(segment) {
      if (segment.actionType === 'full') {
        return t('Video.Player.SponsorBlock.FullVideo')
      }

      const start = formatSponsorBlockInfoTimestamp(segment.startTime)
      return isSponsorBlockPointSegment(segment)
        ? start
        : `${start} ${t('Video.Player.SponsorBlock.TimeDivider')} ${formatSponsorBlockInfoTimestamp(segment.endTime)}`
    }

    function getSponsorBlockVoteContribution(vote) {
      if (vote === 1) return 1
      if (vote === 0) return -1
      return 0
    }

    async function voteOnSponsorBlockInfoSegment(uuid, vote) {
      if (!sponsorBlockEnableSubmission.value || sponsorBlockVotePending.value !== null) {
        return
      }

      const segment = sponsorBlockInfoSegments.value.find(item => item.uuid === uuid)
      if (!segment) {
        return
      }

      const previousVote = sponsorBlockUserVotes[segment.uuid]
      const nextVote = previousVote === vote ? null : vote
      const type = nextVote === null ? 20 : nextVote
      sponsorBlockVotePending.value = segment.uuid
      emitSponsorBlockInfoState()

      try {
        await voteOnSponsorBlockSegment(props.videoId, segment.uuid, type)
        const currentVotes = Number.isFinite(segment.votes) ? segment.votes : 0
        segment.votes = currentVotes - getSponsorBlockVoteContribution(previousVote) +
          getSponsorBlockVoteContribution(nextVote)

        if (nextVote === null) {
          delete sponsorBlockUserVotes[segment.uuid]
        } else {
          sponsorBlockUserVotes[segment.uuid] = nextVote
        }
      } catch (error) {
        console.error(error)
        showToast({ message: t('Video.Player.SponsorBlock.VoteFailed'), icon: ['fas', 'circle-exclamation'] })
      } finally {
        sponsorBlockVotePending.value = null
        emitSponsorBlockInfoState()
      }
    }

    function skipSponsorBlockInfoSegment(uuid) {
      const segment = sponsorBlockInfoSegments.value.find(item => item.uuid === uuid)
      if (!segment || !canSeek()) {
        return
      }

      if (segment.actionType === 'mute') {
        manuallyMutedSponsorBlockSegments.add(uuid)
        const currentTime = video.value.currentTime
        if (currentTime < segment.startTime || currentTime >= segment.endTime) {
          video.value.currentTime = segment.startTime
          sponsorBlockCurrentTime.value = segment.startTime
        }
        syncSponsorBlockMuteSegments(video.value.currentTime)
        showOverlayControls()
        return
      }

      const seekRange = player.seekRange()
      video.value.currentTime = Math.min(
        Math.max(getSponsorBlockSegmentSkipTarget(segment), seekRange.start),
        seekRange.end
      )
      showOverlayControls()
    }

    function startSponsorBlockToastTimer() {
      if (sponsorBlockToastTimeInterval !== null) {
        return
      }

      sponsorBlockToastTimeInterval = setInterval(() => {
        sponsorBlockToastNow.value = Date.now()
      }, 250)
    }

    function stopSponsorBlockToastTimer() {
      if (sponsorBlockToastTimeInterval !== null) {
        clearInterval(sponsorBlockToastTimeInterval)
        sponsorBlockToastTimeInterval = null
      }
    }

    /**
     * @param {string} uuid
     */
    function removeSponsorBlockToast(uuid) {
      const index = skippedSponsorBlockSegments.value.findIndex(segment => segment.uuid === uuid)
      if (index !== -1) {
        clearTimeout(skippedSponsorBlockSegments.value[index].timeoutId)
        skippedSponsorBlockSegments.value.splice(index, 1)
      }
    }

    /**
     * @param {string} uuid
     */
    function removePromptSponsorBlockToast(uuid) {
      const index = promptSponsorBlockSegments.value.findIndex(segment => segment.uuid === uuid)
      if (index !== -1) {
        promptSponsorBlockSegments.value.splice(index, 1)
      }
    }

    /**
     * @param {SponsorBlockCategory} category
     * @returns {string}
     */
    function getSponsorBlockToastColor(category) {
      const colorName = sponsorSkips.value.categoryData[category]?.color
      return resolveColorValue(colorName, '#39be70')
    }

    /**
     * @param {{ uuid: string, translatedCategory: string, color: string, isHighlight?: boolean, unskipTime?: number }} toast
     */
    function upsertSkippedSponsorBlockToast({ uuid, translatedCategory, color, isHighlight = false, unskipTime }) {
      const hideAt = Date.now() + sponsorBlockSkippedToastDurationMs.value
      const existingSkip = skippedSponsorBlockSegments.value.find(skipped => skipped.uuid === uuid)

      if (existingSkip) {
        clearTimeout(existingSkip.timeoutId)
        existingSkip.translatedCategory = translatedCategory
        existingSkip.color = color
        existingSkip.unskipped = false
        existingSkip.hideAt = hideAt
        existingSkip.hideRemainingMs = sponsorBlockSkippedToastDurationMs.value
        existingSkip.countdownPaused = false
        existingSkip.isHighlight = isHighlight
        existingSkip.isMute = false
        existingSkip.unskipTime = unskipTime ?? null
        existingSkip.timeoutId = setTimeout(() => {
          removeSponsorBlockToast(uuid)
        }, sponsorBlockSkippedToastDurationMs.value)
        return
      }

      skippedSponsorBlockSegments.value.push({
        uuid,
        translatedCategory,
        color,
        unskipped: false,
        hideAt,
        hideRemainingMs: sponsorBlockSkippedToastDurationMs.value,
        countdownPaused: false,
        isHighlight,
        isMute: false,
        unskipTime: unskipTime ?? null,
        timeoutId: setTimeout(() => {
          removeSponsorBlockToast(uuid)
        }, sponsorBlockSkippedToastDurationMs.value)
      })
    }

    /**
     * @param {{ uuid: string, translatedCategory: string, color: string }} toast
     */
    function upsertMutedSponsorBlockToast({ uuid, translatedCategory, color }) {
      const existingToast = skippedSponsorBlockSegments.value.find(skipped => skipped.uuid === uuid)

      if (existingToast) {
        clearTimeout(existingToast.timeoutId)
        existingToast.translatedCategory = translatedCategory
        existingToast.color = color
        existingToast.unskipped = !(video.value?.muted ?? true)
        existingToast.hideAt = null
        existingToast.hideRemainingMs = 0
        existingToast.countdownPaused = false
        existingToast.isHighlight = false
        existingToast.isMute = true
        existingToast.unskipTime = null
        existingToast.timeoutId = 0
        return
      }

      skippedSponsorBlockSegments.value.push({
        uuid,
        translatedCategory,
        color,
        unskipped: !(video.value?.muted ?? true),
        hideAt: null,
        hideRemainingMs: 0,
        countdownPaused: false,
        isHighlight: false,
        isMute: true,
        unskipTime: null,
        timeoutId: 0
      })
    }

    /**
     * @param {string} uuid
     * @returns {string}
     */
    function getSponsorBlockToastTimeLabel(uuid) {
      const toastEntry = skippedSponsorBlockSegments.value.find(skipped => skipped.uuid === uuid)
      const segment = sponsorBlockSegments.find(seg => seg.uuid === uuid)

      if (!toastEntry || !segment) {
        return '0s'
      }

      const remainingSeconds = toastEntry.unskipped || toastEntry.isMute
        ? Math.max(segment.endTime - sponsorBlockCurrentTime.value, 0)
        : (toastEntry.countdownPaused
            ? Math.max(toastEntry.hideRemainingMs, 0)
            : Math.max((toastEntry.hideAt ?? 0) - sponsorBlockToastNow.value, 0)) / 1000

      if (remainingSeconds < 60) {
        return `${Math.ceil(remainingSeconds)}s`
      }

      return formatDurationAsTimestamp(Math.ceil(remainingSeconds))
    }

    /**
     * @param {string} uuid
     * @returns {boolean}
     */
    function isSponsorBlockToastCountdownPaused(uuid) {
      const toastEntry = skippedSponsorBlockSegments.value.find(skipped => skipped.uuid === uuid)
      return Boolean(toastEntry?.countdownPaused && !toastEntry.unskipped && !toastEntry.isMute)
    }

    /**
     * @param {boolean} unskipped
     * @param {string} uuid
     * @returns {string}
     */
    function getSponsorBlockToastActionLabel(unskipped, uuid) {
      const segment = sponsorBlockSegments.find(candidate => candidate.uuid === uuid)
      const actionLabel = segment?.actionType === 'mute'
        ? unskipped
          ? t('Video.Player.SponsorBlock.MuteActionType')
          : t('Video.Player.SponsorBlock.MuteToastUnmute')
        : unskipped
          ? t('Video.Player.SponsorBlock.SkipToastReskip')
          : t('Video.Player.SponsorBlock.SkipToastUnskip')

      const activeToast = getActiveSponsorBlockToast()
      if (!hardwareKeyboardAttached.value || getActivePromptSponsorBlockToast() || activeToast?.uuid !== uuid) {
        return actionLabel
      }

      return addKeyboardShortcutToActionTitle(
        actionLabel,
        t('Keys.enter')
      )
    }

    function getSponsorBlockToastLabel(uuid, translatedCategory, isHighlight) {
      if (isHighlight) {
        return t('Video.Player.SponsorBlock.SkippedToHighlight')
      }

      const segment = sponsorBlockSegments.find(candidate => candidate.uuid === uuid)
      return segment?.actionType === 'mute'
        ? t('Video.Player.SponsorBlock.MutedSegment', { segmentCategory: translatedCategory })
        : t('Video.Player.Skipped segment', { segmentCategory: translatedCategory })
    }

    /**
     * @param {string} translatedCategory
     * @returns {string}
     */
    function getSponsorBlockPromptLabel(translatedCategory, uuid) {
      const segment = sponsorBlockSegments.find(candidate => candidate.uuid === uuid)
      if (segment?.actionType === 'mute') {
        return t('Video.Player.SponsorBlock.MutePrompt', { segmentCategory: translatedCategory })
      }

      return t('Video.Player.SponsorBlock.SkipPrompt', { segmentCategory: translatedCategory })
    }

    /**
     * @param {string} uuid
     * @returns {string}
     */
    function getSponsorBlockPromptActionLabel(uuid) {
      const segment = sponsorBlockSegments.find(candidate => candidate.uuid === uuid)
      const actionLabel = segment?.actionType === 'mute'
        ? t('Video.Player.SponsorBlock.MuteActionType')
        : t('Video.Player.SponsorBlock.SkipPromptAction')

      if (!hardwareKeyboardAttached.value || getActivePromptSponsorBlockToast()?.uuid !== uuid) {
        return actionLabel
      }

      return addKeyboardShortcutToActionTitle(
        actionLabel,
        t('Keys.enter')
      )
    }

    /**
     * @param {{ category: SponsorBlockCategory, startTime: number, endTime: number }} segment
     * @returns {number}
     */
    function getSponsorBlockSegmentSkipTarget(segment) {
      return isSponsorBlockPointSegment(segment) ? segment.startTime : segment.endTime
    }

    /**
     * @param {{ category: SponsorBlockCategory, startTime: number, endTime: number }} segment
     * @param {number} currentTime
     * @returns {boolean}
     */
    function isSponsorBlockSegmentActiveForPrompt(segment, currentTime) {
      if (isSponsorBlockPointSegment(segment)) {
        return currentTime < segment.startTime
      }

      return currentTime >= segment.startTime && currentTime < segment.endTime
    }

    /**
     * @param {string} uuid
     * @returns {string}
     */
    function getSponsorBlockPromptTimeLabel(uuid) {
      const segment = sponsorBlockSegments.find(seg => seg.uuid === uuid)
      if (!segment) {
        return '0s'
      }

      const remainingSeconds = Math.max(
        getSponsorBlockSegmentSkipTarget(segment) - sponsorBlockCurrentTime.value,
        0
      )

      if (remainingSeconds < 60) {
        return `${Math.ceil(remainingSeconds)}s`
      }

      return formatDurationAsTimestamp(Math.ceil(remainingSeconds))
    }

    /**
     * @returns {{uuid: string, translatedCategory: string, timeoutId: ReturnType<typeof setTimeout>|0, hideAt: number|null, unskipped: boolean}|null}
     */
    function getActiveSponsorBlockToast() {
      if (skippedSponsorBlockSegments.value.length === 0) {
        return null
      }

      return skippedSponsorBlockSegments.value[skippedSponsorBlockSegments.value.length - 1]
    }

    /**
     * @returns {{ uuid: string, translatedCategory: string, color: string }|null}
     */
    function getActivePromptSponsorBlockToast() {
      if (promptSponsorBlockSegments.value.length === 0) {
        return null
      }

      return promptSponsorBlockSegments.value[promptSponsorBlockSegments.value.length - 1]
    }

    /**
     * @param {{ uuid: string, translatedCategory: string, color: string }} toast
     */
    function upsertPromptSponsorBlockToast({ uuid, translatedCategory, color }) {
      const existingPrompt = promptSponsorBlockSegments.value.find(prompt => prompt.uuid === uuid)

      if (existingPrompt) {
        existingPrompt.translatedCategory = translatedCategory
        existingPrompt.color = color
        return
      }

      promptSponsorBlockSegments.value.push({
        uuid,
        translatedCategory,
        color
      })
    }

    /**
     * @param {string} uuid
     */
    function dismissPromptSponsorBlockSegment(uuid) {
      sponsorBlockDismissedPromptSegments.add(uuid)
      removePromptSponsorBlockToast(uuid)
    }

    /**
     * @param {string} uuid
     * @returns {boolean}
     */
    function skipPromptSponsorBlockSegment(uuid) {
      const segment = sponsorBlockSegments.find(seg => seg.uuid === uuid)
      if (!segment || isSponsorBlockPointSegment(segment) || !canSeek()) {
        return false
      }

      sponsorBlockDismissedPromptSegments.add(uuid)
      removePromptSponsorBlockToast(uuid)

      if (segment.actionType === 'mute') {
        manuallyMutedSponsorBlockSegments.add(uuid)
        syncSponsorBlockMuteSegments(video.value.currentTime)
        return true
      }

      const seekRange = player.seekRange()
      const targetTime = Math.min(
        Math.max(getSponsorBlockSegmentSkipTarget(segment), seekRange.start),
        seekRange.end
      )
      video.value.currentTime = targetTime
      sponsorBlockCurrentTime.value = targetTime

      if (sponsorBlockShowSkippedToast.value) {
        upsertSkippedSponsorBlockToast({
          uuid,
          translatedCategory: translateSponsorBlockCategory(segment.category),
          color: getSponsorBlockToastColor(segment.category)
        })
      }

      return true
    }

    function skipToSponsorBlockHighlight() {
      const segment = activeSponsorBlockHighlightSegment.value
      if (!segment || !canSeek()) {
        return false
      }

      const unskipTime = video.value.currentTime
      const seekRange = player.seekRange()
      const targetTime = Math.min(
        Math.max(segment.startTime, seekRange.start),
        seekRange.end
      )
      video.value.currentTime = targetTime
      sponsorBlockCurrentTime.value = targetTime
      updateSponsorBlockHighlightState(targetTime)

      if (sponsorBlockShowSkippedToast.value) {
        upsertSkippedSponsorBlockToast({
          uuid: segment.uuid,
          translatedCategory: translateSponsorBlockCategory(segment.category),
          color: getSponsorBlockToastColor(segment.category),
          isHighlight: true,
          unskipTime
        })
      }

      showOverlayControls()
      return true
    }

    function toggleActiveSponsorBlockSkipState() {
      const promptToastEntry = getActivePromptSponsorBlockToast()
      const toastEntry = getActiveSponsorBlockToast()

      const targets = resolveSponsorBlockEnterTargets(
        !!promptToastEntry,
        !!toastEntry,
        !!activeSponsorBlockHighlightSegment.value
      )

      // a target can turn out to be a no-op (e.g. a toast whose segment vanished on a SponsorBlock
      // refresh), so fall through to the next one instead of swallowing the key press
      for (const target of targets) {
        let handled = false

        switch (target) {
          case 'prompt':
            handled = skipPromptSponsorBlockSegment(promptToastEntry.uuid)
            break
          case 'toast':
            handled = toastEntry.unskipped
              ? redoSkipSponsorBlockSegment(toastEntry.uuid)
              : unskipSponsorBlockSegment(toastEntry.uuid)
            break
          case 'highlight':
            handled = skipToSponsorBlockHighlight()
            break
        }

        if (handled) {
          return true
        }
      }

      return false
    }

    /**
     * @param {number} currentTime
     */
    function syncPromptSponsorBlockSegments(currentTime) {
      const { promptSkip } = sponsorSkips.value

      if (promptSkip.size === 0) {
        promptSponsorBlockSegments.value = []
        return
      }

      const activePromptUUIDs = new Set()

      for (const uuid of sponsorBlockDismissedPromptSegments) {
        const segment = sponsorBlockSegments.find(seg => seg.uuid === uuid)
        if (!segment || !isSponsorBlockSegmentActiveForPrompt(segment, currentTime)) {
          sponsorBlockDismissedPromptSegments.delete(uuid)
        }
      }

      sponsorBlockSegments.forEach(segment => {
        if (isSponsorBlockPointSegment(segment) || !promptSkip.has(segment.category) || sponsorBlockDoNotSkipSegments.has(segment.uuid)) {
          return
        }

        if (!isSponsorBlockSegmentActiveForPrompt(segment, currentTime)) {
          return
        }

        activePromptUUIDs.add(segment.uuid)

        if (sponsorBlockDismissedPromptSegments.has(segment.uuid)) {
          return
        }

        upsertPromptSponsorBlockToast({
          uuid: segment.uuid,
          translatedCategory: translateSponsorBlockCategory(segment.category),
          color: getSponsorBlockToastColor(segment.category)
        })
      })

      promptSponsorBlockSegments.value
        .filter(segment => !activePromptUUIDs.has(segment.uuid))
        .forEach(segment => removePromptSponsorBlockToast(segment.uuid))
    }

    /**
     * @param {number} currentTime
     */
    function updateSponsorBlockHighlightState(currentTime = sponsorBlockCurrentTime.value) {
      const { promptSkip } = sponsorSkips.value
      const nextHighlightSegment = promptSkip.has('poi_highlight')
        ? sponsorBlockSegments.find(segment => {
          return isSponsorBlockPointSegment(segment) &&
            segment.category === 'poi_highlight' &&
            segment.startTime - currentTime > 0.5
        }) ?? null
        : null

      activeSponsorBlockHighlightSegment.value = nextHighlightSegment
      events.dispatchEvent(new CustomEvent('sponsorBlockHighlightStateChanged', {
        detail: {
          visible: nextHighlightSegment !== null,
          labelVisible: sponsorBlockHighlightLabelVisible,
          shortcutAvailable: resolveSponsorBlockEnterTarget(
            !!getActivePromptSponsorBlockToast(),
            !!getActiveSponsorBlockToast(),
            nextHighlightSegment !== null
          ) === 'highlight'
        }
      }))
    }

    // the highlight button only advertises the Enter shortcut while no toast is claiming it
    watch(
      () => skippedSponsorBlockSegments.value.length > 0 || promptSponsorBlockSegments.value.length > 0,
      () => {
        if (activeSponsorBlockHighlightSegment.value) {
          updateSponsorBlockHighlightState()
        }
      }
    )

    function pauseSponsorBlockHighlightLabelCountdown() {
      if (sponsorBlockHighlightLabelStartedAt === null) {
        return
      }

      clearTimeout(sponsorBlockHighlightLabelTimeout)
      sponsorBlockHighlightLabelTimeout = null
      sponsorBlockHighlightLabelRemainingMs = Math.max(
        sponsorBlockHighlightLabelRemainingMs - (Date.now() - sponsorBlockHighlightLabelStartedAt),
        0
      )
      sponsorBlockHighlightLabelStartedAt = null
    }

    function startSponsorBlockHighlightLabelCountdown() {
      if (!sponsorBlockHighlightLabelVisible || sponsorBlockHighlightLabelStartedAt !== null) {
        return
      }

      sponsorBlockHighlightLabelStartedAt = Date.now()
      sponsorBlockHighlightLabelTimeout = setTimeout(() => {
        sponsorBlockHighlightLabelVisible = false
        sponsorBlockHighlightLabelRemainingMs = 0
        sponsorBlockHighlightLabelStartedAt = null
        sponsorBlockHighlightLabelTimeout = null
        updateSponsorBlockHighlightState()
      }, sponsorBlockHighlightLabelRemainingMs)
    }

    function resetSponsorBlockHighlightLabel() {
      clearTimeout(sponsorBlockHighlightLabelTimeout)
      sponsorBlockHighlightLabelVisible = true
      sponsorBlockHighlightLabelRemainingMs = SPONSORBLOCK_HIGHLIGHT_LABEL_PLAYBACK_MS
      sponsorBlockHighlightLabelStartedAt = null
      sponsorBlockHighlightLabelTimeout = null
      updateSponsorBlockHighlightState()
    }

    /**
     * @param {string} uuid
     */
    function pauseSponsorBlockToastCountdown(uuid) {
      const toastEntry = skippedSponsorBlockSegments.value.find(skipped => skipped.uuid === uuid)
      if (!toastEntry || toastEntry.unskipped || toastEntry.isMute || toastEntry.countdownPaused) {
        return
      }

      clearTimeout(toastEntry.timeoutId)
      toastEntry.hideRemainingMs = Math.max((toastEntry.hideAt ?? 0) - Date.now(), 0)
      toastEntry.hideAt = null
      toastEntry.timeoutId = 0
      toastEntry.countdownPaused = true
    }

    /**
     * @param {string} uuid
     */
    function resumeSponsorBlockToastCountdown(uuid) {
      const toastEntry = skippedSponsorBlockSegments.value.find(skipped => skipped.uuid === uuid)
      if (!toastEntry || toastEntry.unskipped || toastEntry.isMute || !toastEntry.countdownPaused) {
        return
      }

      toastEntry.hideAt = Date.now() + toastEntry.hideRemainingMs
      toastEntry.timeoutId = setTimeout(() => {
        removeSponsorBlockToast(uuid)
      }, toastEntry.hideRemainingMs)
      toastEntry.countdownPaused = false
    }

    /**
     * @param {number} currentTime
     */
    function skipSponsorBlockSegments(currentTime) {
      const { autoSkip } = sponsorSkips.value

      if (autoSkip.size === 0) {
        return
      }

      // Check if we've left any unskipped segments - if so, re-enable auto-skip for them
      for (const uuid of sponsorBlockDoNotSkipSegments) {
        const segment = sponsorBlockSegments.find(seg => seg.uuid === uuid)
        if (segment && !isSponsorBlockPointSegment(segment) &&
          (currentTime < segment.startTime - SPONSORBLOCK_SEGMENT_START_TOLERANCE_SECONDS || currentTime >= segment.endTime)) {
          sponsorBlockDoNotSkipSegments.delete(uuid)
          removeSponsorBlockToast(uuid)
        }
      }

      const video_ = video.value

      let newTime = 0
      const skippedSegments = []

      sponsorBlockSegments.forEach(segment => {
        if (segment.actionType !== 'skip' || isSponsorBlockPointSegment(segment) || sponsorBlockDoNotSkipSegments.has(segment.uuid)) {
          return
        }

        if (autoSkip.has(segment.category) && currentTime < segment.endTime &&
          (segment.startTime <= currentTime ||
            // if we already have a segment to skip, check if there are any that are less than 150ms later,
            // so that we can skip them all in one go (especially useful on slow connections)
            (newTime > 0 && (segment.startTime < newTime || segment.startTime - newTime <= 0.150) && segment.endTime > newTime))) {
          newTime = segment.endTime
          skippedSegments.push(segment)
        }
      })

      if (newTime === 0 || video_.ended) {
        return
      }

      const videoEnd = player.seekRange().end

      if (Math.abs(videoEnd - currentTime) < 1 || video_.ended) {
        return
      }

      if (newTime > videoEnd || Math.abs(videoEnd - newTime) < 1) {
        newTime = videoEnd
      }

      video_.currentTime = newTime
      sponsorBlockCurrentTime.value = newTime

      if (sponsorBlockShowSkippedToast.value) {
        skippedSegments.forEach(({ uuid, category }) => {
          removePromptSponsorBlockToast(uuid)
          sponsorBlockDismissedPromptSegments.add(uuid)
          upsertSkippedSponsorBlockToast({
            uuid,
            translatedCategory: translateSponsorBlockCategory(category),
            color: getSponsorBlockToastColor(category)
          })
        })
      }
    }

    function getNextSponsorBlockAutoSkipSegment(currentTime) {
      const { autoSkip } = sponsorSkips.value

      return sponsorBlockSegments.find(segment =>
        segment.actionType === 'skip' &&
        !isSponsorBlockPointSegment(segment) &&
        !sponsorBlockDoNotSkipSegments.has(segment.uuid) &&
        autoSkip.has(segment.category) &&
        segment.startTime > currentTime &&
        segment.endTime > segment.startTime
      ) ?? null
    }

    function startSponsorBlockSkipPolling(segment) {
      function checkBoundary() {
        const videoElement = video.value
        if (!videoElement || videoElement.paused || videoElement.ended) {
          cancelSponsorBlockSkipSchedule()
          return false
        }

        const currentTime = videoElement.currentTime
        if (currentTime < segment.startTime) {
          const remainingMs = (segment.startTime - currentTime) * 1000 / videoElement.playbackRate
          if (remainingMs > SPONSORBLOCK_SKIP_SCHEDULE_LEAD_MS) {
            scheduleSponsorBlockSkip()
            return false
          }
          return true
        }

        cancelSponsorBlockSkipSchedule()
        skipSponsorBlockSegments(currentTime)
        scheduleSponsorBlockSkip()
        return false
      }

      function scheduleTaskCheck() {
        return scheduleSponsorBlockSkipTask(() => {
          if (checkBoundary()) {
            scheduleTaskCheck()
          }
        }, SPONSORBLOCK_SKIP_POLL_INTERVAL_MS)
      }

      if (!scheduleTaskCheck()) {
        sponsorBlockSkipScheduleInterval = setInterval(checkBoundary, SPONSORBLOCK_SKIP_POLL_INTERVAL_MS)
      }
    }

    function scheduleSponsorBlockSkipTask(callback, delayMs) {
      if (typeof window.scheduler?.postTask !== 'function') {
        return false
      }

      const controller = sponsorBlockSkipScheduleTaskController ?? new AbortController()
      sponsorBlockSkipScheduleTaskController = controller
      window.scheduler.postTask(callback, {
        delay: delayMs,
        priority: 'user-blocking',
        signal: controller.signal
      }).catch((error) => {
        if (error !== controller.signal.reason) {
          console.error(error)
        }
      })
      return true
    }

    function scheduleSponsorBlockSkip() {
      cancelSponsorBlockSkipSchedule()

      const videoElement = video.value
      if (
        !useSponsorBlock.value ||
        props.sponsorBlockAutoSkipDisabled ||
        !videoElement ||
        videoElement.paused ||
        videoElement.ended ||
        !Number.isFinite(videoElement.playbackRate) ||
        videoElement.playbackRate <= 0 ||
        sponsorBlockSegments.length === 0 ||
        !canSeek()
      ) {
        return
      }

      const segment = getNextSponsorBlockAutoSkipSegment(videoElement.currentTime)
      if (!segment) {
        return
      }

      const delayMs = (segment.startTime - videoElement.currentTime) * 1000 / videoElement.playbackRate
      if (delayMs <= SPONSORBLOCK_SKIP_SCHEDULE_LEAD_MS) {
        startSponsorBlockSkipPolling(segment)
        return
      }

      if (!scheduleSponsorBlockSkipTask(
        () => startSponsorBlockSkipPolling(segment),
        delayMs - SPONSORBLOCK_SKIP_SCHEDULE_LEAD_MS
      )) {
        sponsorBlockSkipScheduleTimeout = setTimeout(() => {
          sponsorBlockSkipScheduleTimeout = null
          startSponsorBlockSkipPolling(segment)
        }, delayMs - SPONSORBLOCK_SKIP_SCHEDULE_LEAD_MS)
      }
    }

    function syncSponsorBlockMuteSegments(currentTime, autoMuteEnabled = true) {
      const activeMuteSegments = new Set()

      for (const uuid of manuallyMutedSponsorBlockSegments) {
        const segment = sponsorBlockSegments.find(candidate => candidate.uuid === uuid)
        if (!segment || currentTime < segment.startTime || currentTime >= segment.endTime) {
          manuallyMutedSponsorBlockSegments.delete(uuid)
        }
      }

      for (const uuid of sponsorBlockDoNotMuteSegments) {
        const segment = sponsorBlockSegments.find(candidate => candidate.uuid === uuid)
        if (!segment || currentTime < segment.startTime || currentTime >= segment.endTime) {
          sponsorBlockDoNotMuteSegments.delete(uuid)
        }
      }

      sponsorBlockSegments.forEach(segment => {
        const isActive = segment.actionType === 'mute' &&
          currentTime >= segment.startTime &&
          currentTime < segment.endTime &&
          (manuallyMutedSponsorBlockSegments.has(segment.uuid) ||
            sponsorBlockDoNotMuteSegments.has(segment.uuid) ||
            (autoMuteEnabled && sponsorSkips.value.autoSkip.has(segment.category)))

        if (!isActive) {
          return
        }

        activeMuteSegments.add(segment.uuid)
      })

      for (const uuid of notifiedSponsorBlockMuteSegments) {
        if (!activeMuteSegments.has(uuid)) {
          notifiedSponsorBlockMuteSegments.delete(uuid)
          removeSponsorBlockToast(uuid)
        }
      }

      const shouldMute = sponsorBlockSegments.some(segment => {
        return activeMuteSegments.has(segment.uuid) &&
          !sponsorBlockDoNotMuteSegments.has(segment.uuid)
      })

      sponsorBlockMuteController.setSourceActive('segments', activeMuteSegments.size > 0)
      sponsorBlockMuteController.setSourceSuppressed('segments', !shouldMute)

      sponsorBlockSegments.forEach(segment => {
        if (!activeMuteSegments.has(segment.uuid) ||
            !sponsorBlockShowSkippedToast.value ||
            notifiedSponsorBlockMuteSegments.has(segment.uuid)) {
          return
        }

        notifiedSponsorBlockMuteSegments.add(segment.uuid)
        upsertMutedSponsorBlockToast({
          uuid: segment.uuid,
          translatedCategory: translateSponsorBlockCategory(segment.category),
          color: getSponsorBlockToastColor(segment.category)
        })
      })
    }

    function clearSponsorBlockMuteSegments() {
      manuallyMutedSponsorBlockSegments.clear()
      sponsorBlockDoNotMuteSegments.clear()
      notifiedSponsorBlockMuteSegments.clear()
      skippedSponsorBlockSegments.value
        .filter(segment => segment.isMute)
        .forEach(segment => removeSponsorBlockToast(segment.uuid))
      sponsorBlockMuteController.setSourceActive('segments', false)
    }

    /**
     * Unskips a SponsorBlock segment by seeking back to its start time
     * and preventing it from being auto-skipped again until the user leaves the segment.
     * @param {string} uuid - The UUID of the segment to unskip
     * @returns {boolean} whether anything was actually unskipped
     */
    function unskipSponsorBlockSegment(uuid) {
      const segment = sponsorBlockSegments.find(seg => seg.uuid === uuid)
      if (!segment) {
        return false
      }

      const toastEntry = skippedSponsorBlockSegments.value.find(skipped => skipped.uuid === uuid)

      if (segment.actionType === 'mute') {
        sponsorBlockDoNotMuteSegments.add(uuid)
        manuallyMutedSponsorBlockSegments.delete(uuid)
        syncSponsorBlockMuteSegments(video.value.currentTime, !props.sponsorBlockAutoSkipDisabled)
        if (toastEntry) {
          toastEntry.unskipped = true
        }
        return true
      }

      if (isSponsorBlockPointSegment(segment)) {
        if (!toastEntry?.isHighlight || toastEntry.unskipTime === null || !canSeek()) {
          return false
        }

        const seekRange = player.seekRange()
        const targetTime = Math.min(
          Math.max(toastEntry.unskipTime, seekRange.start),
          seekRange.end
        )
        video.value.currentTime = targetTime
        sponsorBlockCurrentTime.value = targetTime
        removeSponsorBlockToast(uuid)
        updateSponsorBlockHighlightState(targetTime)
        return true
      }

      sponsorBlockDoNotSkipSegments.add(uuid)
      sponsorBlockDismissedPromptSegments.add(uuid)
      removePromptSponsorBlockToast(uuid)

      if (canSeek()) {
        const seekRange = player.seekRange()
        const targetTime = Math.max(segment.startTime, seekRange.start)
        video.value.currentTime = targetTime
        sponsorBlockCurrentTime.value = targetTime
      }

      // Update the toast entry to show it's been unskipped
      // Keep showing it for the duration of the segment (no timeout)
      if (toastEntry) {
        clearTimeout(toastEntry.timeoutId)
        toastEntry.unskipped = true
        toastEntry.hideAt = null
        toastEntry.hideRemainingMs = 0
        toastEntry.countdownPaused = false
        toastEntry.timeoutId = 0
      }

      return true
    }

    /**
     * Re-skips a SponsorBlock segment that was previously unskipped,
     * seeking to the end of the segment and restoring auto-skip behavior.
     * @param {string} uuid - The UUID of the segment to re-skip
     * @returns {boolean} whether anything was actually re-skipped
     */
    function redoSkipSponsorBlockSegment(uuid) {
      const segment = sponsorBlockSegments.find(seg => seg.uuid === uuid)
      if (!segment || isSponsorBlockPointSegment(segment)) {
        return false
      }

      if (segment.actionType === 'mute') {
        sponsorBlockDoNotMuteSegments.delete(uuid)
        manuallyMutedSponsorBlockSegments.add(uuid)
        syncSponsorBlockMuteSegments(video.value.currentTime, !props.sponsorBlockAutoSkipDisabled)
        sponsorBlockMuteController.enforceMuted()
        const toastEntry = skippedSponsorBlockSegments.value.find(skipped => skipped.uuid === uuid)
        if (toastEntry) {
          toastEntry.unskipped = false
        }
        return true
      }

      sponsorBlockDoNotSkipSegments.delete(uuid)
      sponsorBlockDismissedPromptSegments.add(uuid)
      removePromptSponsorBlockToast(uuid)

      if (canSeek()) {
        const seekRange = player.seekRange()
        const targetTime = Math.min(segment.endTime, seekRange.end)
        video.value.currentTime = targetTime
        sponsorBlockCurrentTime.value = targetTime
      }

      // Update the toast entry to show it's been re-skipped and reset the timeout
      const toastEntry = skippedSponsorBlockSegments.value.find(skipped => skipped.uuid === uuid)
      if (toastEntry) {
        upsertSkippedSponsorBlockToast({
          uuid,
          translatedCategory: toastEntry.translatedCategory,
          color: toastEntry.color
        })
      }

      return true
    }

    // #endregion SponsorBlock

    // #region player config

    const seekingIsPossible = computed(() => {
      if (props.manifestMimeType !== 'application/x-mpegurl' || !props.isLive) {
        return true
      }

      const match = props.manifestSrc.match(/\/(?:manifest|playlist)_duration\/(\d+)\//)

      if (match != null) {
        // Check how many seconds we are allowed to seek, 30 is too short, 3600 is an hour which is great
        return parseInt(match[1] || '0') > 30
      }

      // yt-dlp's manifest URLs don't state the seekable duration, but they do state
      // whether the stream has a DVR window, which is what makes it rewindable
      return props.playbackEngine === 'yt-dlp' && props.manifestSrc.includes('/playlist_type/DVR/')
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const isSabrPlayback = computed(() => {
      return !!process.env.SUPPORTS_LOCAL_API &&
        props.format !== 'legacy' &&
        props.manifestMimeType === MANIFEST_TYPE_SABR
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const autoQualitySupported = computed(() => {
      return streamsSupportAutoQuality(props.format, isSabrPlayback.value)
    })

    /**
     * How many segments per stream shaka-player downloads in parallel ahead of the playhead.
     * @type {import('vue').ComputedRef<number>}
     */
    const segmentPrefetchLimit = computed(() => {
      return resolveSegmentPrefetchLimit(store.getters.getSegmentPrefetchLimit, isSabrPlayback.value)
    })

    watch(segmentPrefetchLimit, (newValue) => {
      player?.configure('streaming.segmentPrefetchLimit', newValue)
    })

    /**
     * @param {'dash'|'audio'|'legacy'} format
     * @param {boolean} useAutoQuality
     * @returns {shaka.extern.PlayerConfiguration}
     */
    function getPlayerConfig(format, useAutoQuality = false) {
      return {
        // YouTube uses these values and they seem to work well in FreeTube too,
        // so we might as well use them
        streaming: {
          bufferingGoal: 180,
          rebufferingGoal: 0.02,
          bufferBehind: 300,
          segmentPrefetchLimit: segmentPrefetchLimit.value
        },
        manifest: {
          disableVideo: format === 'audio',

          // makes captions work for live streams and doesn't seem to have any negative affect on VOD videos
          segmentRelativeVttTiming: true,
          dash: {
            manifestPreprocessorTXml: manifestPreprocessorTXml
          },
        },
        abr: {
          enabled: useAutoQuality,

          // This only affects the "auto" quality, users can still manually select whatever quality they want.
          restrictToElementSize: true
        },

        // Prioritise variants that are predicted to play:
        // - `smooth`: without dropping frames
        // - `powerEfficient` the spec is quite vague but in Chromium it should prioritise hardware decoding when available
        // https://developer.mozilla.org/en-US/docs/Web/API/MediaCapabilities/decodingInfo
        preferredDecodingAttributes: format === 'dash' ? ['smooth', 'powerEfficient'] : [],

        // Prefer the main audio before codec/channel preferences. If there is
        // no main role, Shaka falls back to the manifest's primary track.
        preferredAudio: [{ role: 'main' }],

        // Shaka automatically shows a matching preferred text track on load.
        // Only give it a preference when captions should be enabled or restored.
        preferredText: restoreCaptionIndex === null
          ? []
          : [{
              language: getCaptionToEnable()?.language ?? preferredCaptionLocale.value,
              role: '',
              format: '',
              forced: false,
            }],

        // Caption appearance is user-controlled, so discard source WebVTT positioning (for
        // example YouTube's occasional position:63% cues) before Shaka creates the cue DOM.
        textDisplayer: {
          positionArea: captionPositionArea.value,
        },

        // Electron doesn't like YouTube's vp9 VR video streams and throws:
        // "CHUNK_DEMUXER_ERROR_APPEND_FAILED: Projection element is incomplete; ProjectionPoseYaw required."
        // So use the AV1 and h264 codecs instead which it doesn't reject
        preferredVideoCodecs: typeof props.vrProjection === 'string' ? ['av01', 'avc1'] : []
      }
    }

    /**
     * @param {shaka.extern.xml.Node} mpdNode
     */
    function manifestPreprocessorTXml(mpdNode) {
      /** @type {shaka.extern.xml.Node[]} */
      const periods = mpdNode.children?.filter(child => typeof child !== 'string' && child.tagName === 'Period') ?? []

      sortAdapationSetsByCodec(periods)
      sortAudioAdaptationSetsByBitrate(periods)

      if (mpdNode.attributes.type === 'dynamic') {
        // fix live stream loading issues
        // YouTube uses a 12 second delay on the official website for normal streams
        // and a shorter one for low latency streams
        // If we don't add a little bit of a delay, we get presented with a loading symbol every 5 seconds,
        // while shaka-player processes the new manifest and segments
        const minimumUpdatePeriod = parseFloat(mpdNode.attributes.minimumUpdatePeriod.match(/^PT(\d+(?:\.\d+)?)S$/)[1])
        mpdNode.attributes.suggestedPresentationDelay = `PT${(minimumUpdatePeriod * 2).toFixed(3)}S`

        // fix live streams with subtitles having duplicate Representation ids
        // shaka-player throws DASH_DUPLICATE_REPRESENTATION_ID if we don't fix it

        for (const period of periods) {
          /** @type {shaka.extern.xml.Node[]} */
          const representations = []

          for (const periodChild of period.children) {
            if (typeof periodChild !== 'string' && periodChild.tagName === 'AdaptationSet') {
              for (const adaptationSetChild of periodChild.children) {
                if (typeof adaptationSetChild !== 'string' && adaptationSetChild.tagName === 'Representation') {
                  representations.push(adaptationSetChild)
                }
              }
            }
          }

          const knownIds = new Set()
          let counter = 0
          for (const representation of representations) {
            const id = representation.attributes.id

            if (knownIds.has(id)) {
              const newId = `${id}-ft-fix-${counter}`

              representation.attributes.id = newId
              knownIds.add(newId)
              counter++
            } else {
              knownIds.add(id)
            }
          }
        }
      } else if (!process.env.SUPPORTS_LOCAL_API) {
        repairInvidiousManifest(periods)
      }
    }

    /**
     * @param {shaka.extern.xml.Node[]} periods
     */
    function sortAdapationSetsByCodec(periods) {
      /** @param {shaka.extern.xml.Node} adaptationSet */
      const getCodecsPrefix = (adaptationSet) => {
        const codecs = adaptationSet.attributes.codecs ??
          adaptationSet.children
            .find(child => typeof child !== 'string' && child.tagName === 'Representation').attributes.codecs

        return codecs.split('.')[0]
      }

      const codecPriorities = [
        // audio
        'opus',
        'mp4a',
        'ec-3',
        'ac-3',

        // video
        'av01',
        'vp09',
        'vp9',
        'avc1'
      ]

      for (const period of periods) {
        period.children
          ?.sort((
            /** @type {shaka.extern.xml.Node | string} */ a,
            /** @type {shaka.extern.xml.Node | string} */ b
          ) => {
            if (typeof a === 'string' || a.tagName !== 'AdaptationSet' ||
              typeof b === 'string' || b.tagName !== 'AdaptationSet') {
              return 0
            }

            const typeA = a.attributes.contentType || a.attributes.mimeType.split('/')[0]
            const typeB = b.attributes.contentType || b.attributes.mimeType.split('/')[0]

            // always place image and text tracks AdaptionSets last in the manifest

            if (typeA !== 'video' && typeA !== 'audio') {
              return 1
            }
            if (typeB !== 'video' && typeB !== 'audio') {
              return -1
            }

            const codecsPrefixA = getCodecsPrefix(a)
            const codecsPrefixB = getCodecsPrefix(b)

            return codecPriorities.indexOf(codecsPrefixA) - codecPriorities.indexOf(codecsPrefixB)
          })
      }
    }

    /**
     * Sort audio AdaptationSets so that streams with higher bitrates come first.
     * Workaround that makes the player select high-quality audio.
     * @param {shaka.extern.xml.Node[]} periods
     */
    function sortAudioAdaptationSetsByBitrate(periods) {
      for (const period of periods) {
        period.children
          ?.filter(child => typeof child !== 'string' && child.tagName === 'AdaptationSet' &&
            (child.attributes.contentType === 'audio' || child.attributes.mimeType.startsWith('audio/')))
          .forEach(adaptationSet => {
            adaptationSet.children.sort((a, b) => {
              if (a.tagName === 'AudioChannelConfiguration' && b.tagName !== 'AudioChannelConfiguration') {
                // Push AudioChannelConfiguration to the front (where it seems to already be) so that it doesn't
                // block sorting Representations if it's in the middle instead
                return -1
              } else if (b.tagName === 'AudioChannelConfiguration' && a.tagName !== 'AudioChannelConfiguration') {
                return 1
              } else if (a.tagName === 'Representation' && b.tagName === 'Representation') {
                return b.attributes.bandwidth - a.attributes.bandwidth
              } else {
                return 0
              }
            })
          })
      }
    }

    // #endregion player config

    // #region UI config

    const useVrMode = computed(() => {
      return props.format === 'dash' && props.vrProjection === 'EQUIRECTANGULAR'
    })

    const enableVideoZoom = computed(() => store.getters.getEnableVideoZoom)
    const selectedVideoZoom = computed(() => {
      return sanitizeVideoZoom(store.getters.getTabVideoZoom(mediaTabId))
    })
    const videoZoomGestureZoom = ref(null)

    const videoZoomPossible = computed(() => {
      // Audio only playback has no video surface to crop and the shorts player
      // deliberately lets its content overflow the container, which is what
      // keeps a scaled video from spilling over the page for the other layouts.
      return enableVideoZoom.value && props.format !== 'audio' && !props.shortsPlayer && !useVrMode.value
    })

    /** @type {import('vue').ComputedRef<number>} */
    const videoZoom = computed(() => {
      if (!videoZoomPossible.value) {
        return DEFAULT_VIDEO_ZOOM
      }

      return videoZoomGestureZoom.value ?? selectedVideoZoom.value
    })

    /**
     * Which part of the zoomed video is visible, as a fraction of the hidden
     * overflow on each axis (-1 to 1). Kept relative so it survives zoom
     * changes, and per player because the framing only matters for the video
     * that is currently on screen.
     */
    const videoZoomOffset = reactive({ x: 0, y: 0 })

    /** Whether a shift-drag is currently moving the zoomed video. */
    const videoZoomPanning = ref(false)
    const videoZoomPinching = ref(false)

    /** Whether releasing the pointer would start a pan, which the cursor shows. */
    const videoZoomPanReady = ref(false)

    const videoZoomPannable = computed(() => videoZoom.value !== DEFAULT_VIDEO_ZOOM)

    const videoZoomStyle = computed(() => {
      if (!videoZoomPannable.value) {
        return undefined
      }

      // The translation is applied in the video's own coordinate system, which
      // the scale then magnifies, so the offset that reaches the edge of the
      // crop shrinks as the zoom grows.
      const limit = 50 * (videoZoom.value - 1) / videoZoom.value

      return {
        transform: `scale(${videoZoom.value}) translate(${videoZoomOffset.x * limit}%, ${videoZoomOffset.y * limit}%)`
      }
    })

    watch(videoZoomPannable, (pannable) => {
      if (!pannable) {
        recenterVideoZoom()
        videoZoomPanReady.value = false
      }
    })

    // The zoom level belongs to this player (and therefore this tab), while the
    // framing belongs to one specific video. A player reused for the next video
    // keeps its zoom level but starts centered again.
    watch(() => props.videoId, () => {
      recenterVideoZoom()
    })

    function recenterVideoZoom() {
      videoZoomOffset.x = 0
      videoZoomOffset.y = 0
    }

    /** @param {number} value */
    function updateVideoZoom(value) {
      store.commit('setTabVideoZoom', {
        tabId: mediaTabId,
        value: sanitizeVideoZoom(value)
      })
    }

    /** @param {number} direction `1` to zoom in, `-1` to zoom out */
    function changeVideoZoom(direction) {
      const newZoom = stepVideoZoom(videoZoom.value, direction)

      if (newZoom !== videoZoom.value) {
        updateVideoZoom(newZoom)
      }

      showValueChange(formatVideoZoom(newZoom), 'search')
    }

    // #region video zoom panning

    /** @type {{ pointerId: number, x: number, y: number, offsetX: number, offsetY: number } | null} */
    let videoZoomPanStart = null
    let videoZoomPointerInside = false
    let videoZoomSuppressClick = false
    let videoZoomSuppressClickTimer = null
    const videoZoomTouchPointers = new Map()
    let videoZoomPinchStart = null

    function handleVideoZoomPointerEnter() {
      videoZoomPointerInside = true
    }

    function handleVideoZoomPointerLeave() {
      videoZoomPointerInside = false

      if (!videoZoomPanStart) {
        videoZoomPanReady.value = false
      }
    }

    function getVideoZoomGestureGeometry() {
      const videoElement = video.value
      if (!videoElement) return null

      const bounds = videoElement.getBoundingClientRect()
      const transform = getComputedStyle(videoElement).transform
      const matrix = transform === 'none' ? new DOMMatrix() : new DOMMatrix(transform)
      const scale = Math.hypot(matrix.a, matrix.b)
      if (bounds.width <= 0 || bounds.height <= 0 || scale <= 0) return null
      const size = {
        width: bounds.width / scale,
        height: bounds.height / scale,
      }
      const maximumTranslation = {
        x: size.width * (scale - 1) / 2,
        y: size.height * (scale - 1) / 2,
      }

      return {
        zoom: scale,
        center: {
          x: bounds.left + bounds.width / 2 - matrix.e,
          y: bounds.top + bounds.height / 2 - matrix.f,
        },
        offset: {
          x: maximumTranslation.x > 0
            ? clampVideoZoomOffset(matrix.e / maximumTranslation.x)
            : 0,
          y: maximumTranslation.y > 0
            ? clampVideoZoomOffset(matrix.f / maximumTranslation.y)
            : 0,
        },
        size,
      }
    }

    /** @param {KeyboardEvent} event */
    function handleVideoZoomModifierKey(event) {
      videoZoomPanReady.value = videoZoomPointerInside && videoZoomPannable.value && event.shiftKey
    }

    /** @param {PointerEvent} event */
    function handleVideoZoomPointerDown(event) {
      if (event.pointerType === 'touch' && !event.isPrimary && temporaryPlaybackRatePointerId !== null) {
        temporaryPlaybackRatePointerCancelled = true
        finishTemporaryPlaybackRateHold(TEMPORARY_PLAYBACK_RATE_POINTER_SOURCE)
      }
      startMobileFullscreenGesture(event)

      if (
        event.pointerType === 'touch' &&
        videoZoomPossible.value &&
        isVideoZoomGestureTarget(event.target)
      ) {
        videoZoomTouchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
        if (videoZoomTouchPointers.size === 2) {
          const points = [...videoZoomTouchPointers.values()]
          const geometry = getVideoZoomGestureGeometry()
          if (geometry) {
            cancelMobileFullscreenGesture()
            videoZoomGestureZoom.value = geometry.zoom
            videoZoomOffset.x = geometry.offset.x
            videoZoomOffset.y = geometry.offset.y
            const focal = {
              x: (points[0].x + points[1].x) / 2 - geometry.center.x,
              y: (points[0].y + points[1].y) / 2 - geometry.center.y,
            }
            videoZoomPinchStart = {
              distance: Math.max(1, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)),
              zoom: geometry.zoom,
              offset: geometry.offset,
              focal,
              currentFocal: focal,
              center: geometry.center,
              size: geometry.size,
            }
            videoZoomPinching.value = true
            videoZoomSuppressClick = true
            for (const pointerId of videoZoomTouchPointers.keys()) {
              container.value?.setPointerCapture(pointerId)
            }
            event.preventDefault()
            event.stopPropagation()
            return
          }
        }
      }

      if (!videoZoomPannable.value || !event.shiftKey || event.button !== 0) {
        return
      }

      // shaka-player's controls cover the video, so the drag is claimed in the
      // capture phase before they can turn it into a play/pause click.
      event.preventDefault()
      event.stopPropagation()

      videoZoomPanStart = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        offsetX: videoZoomOffset.x,
        offsetY: videoZoomOffset.y,
      }
      videoZoomPanning.value = true
      // Chromium still fires the click that follows a prevented pointerdown.
      videoZoomSuppressClick = true
      container.value?.setPointerCapture(event.pointerId)
    }

    /** @param {PointerEvent} event */
    function handleVideoZoomPointerMove(event) {
      if (event.pointerType === 'touch' && event.pointerId === temporaryPlaybackRatePointerId &&
        Math.hypot(event.clientX - temporaryPlaybackRatePointerStart.x, event.clientY - temporaryPlaybackRatePointerStart.y) > 12) {
        temporaryPlaybackRatePointerCancelled = true
        finishTemporaryPlaybackRateHold(TEMPORARY_PLAYBACK_RATE_POINTER_SOURCE)
      }
      if (videoZoomTouchPointers.has(event.pointerId)) {
        videoZoomTouchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      }

      if (videoZoomPinchStart && videoZoomTouchPointers.size >= 2) {
        const points = [...videoZoomTouchPointers.values()]
        const focal = {
          x: (points[0].x + points[1].x) / 2 - videoZoomPinchStart.center.x,
          y: (points[0].y + points[1].y) / 2 - videoZoomPinchStart.center.y,
        }
        const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)
        const resolved = resolveVideoZoomPinch({
          startZoom: videoZoomPinchStart.zoom,
          startOffset: videoZoomPinchStart.offset,
          startFocal: videoZoomPinchStart.focal,
          focal,
          scale: distance / videoZoomPinchStart.distance,
          size: videoZoomPinchStart.size,
        })
        videoZoomGestureZoom.value = resolved.zoom
        videoZoomOffset.x = resolved.offset.x
        videoZoomOffset.y = resolved.offset.y
        videoZoomPinchStart.currentFocal = focal
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (moveMobileFullscreenGesture(event)) return

      if (!videoZoomPanStart) {
        videoZoomPanReady.value = videoZoomPointerInside && videoZoomPannable.value && event.shiftKey
        return
      }

      if (event.pointerId !== videoZoomPanStart.pointerId) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const videoElement = video.value
      if (!videoElement) {
        return
      }

      // `offsetWidth`/`offsetHeight` are the layout size, which the zoom
      // transform does not change, so this is the overflow the crop hides.
      const maxX = videoElement.offsetWidth * (videoZoom.value - 1) / 2
      const maxY = videoElement.offsetHeight * (videoZoom.value - 1) / 2

      if (maxX > 0) {
        videoZoomOffset.x = clampVideoZoomOffset(
          videoZoomPanStart.offsetX + (event.clientX - videoZoomPanStart.x) / maxX
        )
      }

      if (maxY > 0) {
        videoZoomOffset.y = clampVideoZoomOffset(
          videoZoomPanStart.offsetY + (event.clientY - videoZoomPanStart.y) / maxY
        )
      }
    }

    /** @param {PointerEvent} event */
    function handleVideoZoomPointerUp(event) {
      if (endVideoZoomPinchPointer(event)) return
      if (finishMobileFullscreenGesture(event)) return

      if (!endVideoZoomPan(event)) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
    }

    /** @param {PointerEvent} event */
    function handleVideoZoomPointerCancel(event) {
      if (endVideoZoomPinchPointer(event)) return
      cancelMobileFullscreenGesture(event)

      if (!endVideoZoomPan(event)) {
        return
      }

      // A cancelled gesture never produces the click that clears this itself,
      // so it would otherwise swallow the next unrelated click on the player.
      videoZoomSuppressClick = false
    }

    function endVideoZoomPinchPointer(event) {
      if (!videoZoomTouchPointers.has(event.pointerId)) return false

      videoZoomTouchPointers.delete(event.pointerId)
      if (!videoZoomPinchStart) return false

      event.preventDefault()
      event.stopPropagation()
      if (container.value?.hasPointerCapture(event.pointerId)) {
        container.value.releasePointerCapture(event.pointerId)
      }

      const gestureZoom = videoZoomGestureZoom.value ?? videoZoomPinchStart.zoom
      updateVideoZoom(gestureZoom)
      videoZoomGestureZoom.value = null
      videoZoomPinchStart = null
      videoZoomPinching.value = false
      videoZoomTouchPointers.clear()
      clearTimeout(videoZoomSuppressClickTimer)
      videoZoomSuppressClickTimer = setTimeout(() => {
        videoZoomSuppressClick = false
        videoZoomSuppressClickTimer = null
      }, 0)
      return true
    }

    /**
     * @param {PointerEvent} event
     * @returns {boolean} whether the event ended this player's pan
     */
    function endVideoZoomPan(event) {
      if (!videoZoomPanStart || event.pointerId !== videoZoomPanStart.pointerId) {
        return false
      }

      // A cancelled pointer has already lost the capture.
      if (container.value?.hasPointerCapture(event.pointerId)) {
        container.value.releasePointerCapture(event.pointerId)
      }

      videoZoomPanStart = null
      videoZoomPanning.value = false
      videoZoomPanReady.value = videoZoomPointerInside && videoZoomPannable.value && event.shiftKey

      return true
    }

    /** Swallows the click that a finished pan would otherwise leave behind. */
    function handleVideoZoomClickCapture(event) {
      if (handleMobilePlayerSurfaceClick(event)) {
        return
      }

      if (!videoZoomSuppressClick) {
        return
      }

      videoZoomSuppressClick = false
      clearTimeout(videoZoomSuppressClickTimer)
      videoZoomSuppressClickTimer = null
      event.preventDefault()
      event.stopPropagation()
    }

    /**
     * @param {number} value
     * @returns {number}
     */
    function clampVideoZoomOffset(value) {
      return Math.min(Math.max(value, -1), 1)
    }

    // #endregion video zoom panning

    // #region A-B repeat

    const abRepeatStart = ref(null)
    const abRepeatEnd = ref(null)
    const abRepeatEnabled = ref(false)
    const abRepeatDuration = ref(Number.POSITIVE_INFINITY)
    const disableAbRepeat = computed(() => store.getters.getDisableAbRepeat)
    const abRepeatValidation = computed(() => validateAbRepeatRange(
      abRepeatStart.value,
      abRepeatEnd.value,
      abRepeatDuration.value
    ))
    const abRepeatAvailable = computed(() => isCompleteAbRepeatRange(
      abRepeatStart.value,
      abRepeatEnd.value,
      abRepeatDuration.value
    ))
    /**
     * @param {string | null} validation
     * @returns {string}
     */
    function getAbRepeatValidationMessage(validation) {
      switch (validation) {
        case AbRepeatValidation.END_NOT_AFTER_START:
          return t('Video.Player.A-B Repeat.End Before Start')
        case AbRepeatValidation.OUTSIDE_DURATION:
          return t('Video.Player.A-B Repeat.Outside Duration')
        default:
          return ''
      }
    }
    const abRepeatValidationMessage = computed(() => (
      getAbRepeatValidationMessage(abRepeatValidation.value)
    ))

    let abRepeatBoundaryTimeout = null
    let abRepeatDragCleanup = null

    function clearAbRepeatBoundarySchedule() {
      clearTimeout(abRepeatBoundaryTimeout)
      abRepeatBoundaryTimeout = null
    }

    /**
     * @param {'start' | 'end'} point
     * @param {number} value
     * @returns {number}
     */
    function clampAbRepeatBoundary(point, value) {
      const seekRange = player?.seekRange()
      const rangeStart = Number.isFinite(seekRange?.start) ? seekRange.start : 0
      const rangeEnd = Number.isFinite(seekRange?.end) ? seekRange.end : getAbRepeatDuration()

      if (point === 'start') {
        const latestStart = abRepeatEnd.value === null
          ? rangeEnd
          : abRepeatEnd.value - AB_REPEAT_MIN_RANGE_SECONDS
        return Math.min(Math.max(value, rangeStart), Math.max(rangeStart, latestStart))
      }

      const earliestEnd = abRepeatStart.value === null
        ? rangeStart
        : abRepeatStart.value + AB_REPEAT_MIN_RANGE_SECONDS
      return Math.max(Math.min(value, rangeEnd), Math.min(rangeEnd, earliestEnd))
    }

    /**
     * @param {'start' | 'end'} point
     * @param {number} clientX
     * @param {HTMLElement} seekBar
     */
    function setAbRepeatBoundaryFromPointer(point, clientX, seekBar) {
      const bounds = seekBar.getBoundingClientRect()
      const seekRange = player?.seekRange()
      if (!seekRange || bounds.width <= 0) {
        return
      }

      const position = Math.min(Math.max((clientX - bounds.left) / bounds.width, 0), 1)
      const value = seekRange.start + position * (seekRange.end - seekRange.start)
      setAbRepeatBoundary(point, clampAbRepeatBoundary(point, value))
    }

    /**
     * @param {'start' | 'end'} point
     * @param {PointerEvent} event
     */
    function startAbRepeatMarkerDrag(point, event) {
      const seekBar = container.value?.querySelector('.shaka-seek-bar-container')
      if (!(seekBar instanceof HTMLElement)) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      abRepeatDragCleanup?.()

      const pointerId = event.pointerId
      let latestClientX = event.clientX
      let updateFrame = null

      const applyPendingPosition = () => {
        updateFrame = null
        setAbRepeatBoundaryFromPointer(point, latestClientX, seekBar)
      }
      const queuePosition = (clientX) => {
        latestClientX = clientX
        if (updateFrame === null) {
          updateFrame = requestAnimationFrame(applyPendingPosition)
        }
      }
      const handlePointerMove = (moveEvent) => {
        if (moveEvent.pointerId !== pointerId) {
          return
        }
        moveEvent.preventDefault()
        queuePosition(moveEvent.clientX)
      }
      const cleanup = () => {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerEnd)
        window.removeEventListener('pointercancel', handlePointerEnd)
        if (updateFrame !== null) {
          cancelAnimationFrame(updateFrame)
          updateFrame = null
        }
        container.value?.classList.remove('abRepeatDragging')
        abRepeatDragCleanup = null
      }
      const handlePointerEnd = (endEvent) => {
        if (endEvent.pointerId !== pointerId) {
          return
        }
        setAbRepeatBoundaryFromPointer(point, endEvent.clientX, seekBar)
        cleanup()
      }

      abRepeatDragCleanup = cleanup
      container.value?.classList.add('abRepeatDragging')
      window.addEventListener('pointermove', handlePointerMove, { passive: false })
      window.addEventListener('pointerup', handlePointerEnd)
      window.addEventListener('pointercancel', handlePointerEnd)
    }

    /**
     * @param {'start' | 'end'} point
     * @param {KeyboardEvent} event
     */
    function handleAbRepeatMarkerKeydown(point, event) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      const currentValue = point === 'start' ? abRepeatStart.value : abRepeatEnd.value
      if (currentValue === null) {
        return
      }

      const direction = event.key === 'ArrowLeft' ? -1 : 1
      const step = event.shiftKey ? 1 : 0.1
      setAbRepeatBoundary(point, clampAbRepeatBoundary(point, currentValue + direction * step))
      requestAnimationFrame(() => {
        container.value?.querySelector(`.abRepeatMarker${point === 'start' ? 'A' : 'B'}`)?.focus()
      })
    }

    function getAbRepeatDuration() {
      const duration = video.value?.duration
      return Number.isFinite(duration) && duration >= 0
        ? duration
        : Number.POSITIVE_INFINITY
    }

    function hasValidAbRepeatRange() {
      return abRepeatAvailable.value
    }

    function repeatAbRangeFromStart() {
      const videoElement = video.value
      if (!videoElement || !hasValidAbRepeatRange()) {
        return
      }

      clearAbRepeatBoundarySchedule()
      videoElement.currentTime = abRepeatStart.value
    }

    function checkAbRepeatBoundary() {
      clearAbRepeatBoundarySchedule()
      const videoElement = video.value
      if (!videoElement || !abRepeatEnabled.value || !hasValidAbRepeatRange()) {
        return
      }

      if (
        videoElement.currentTime < abRepeatStart.value - AB_REPEAT_BOUNDARY_TOLERANCE_SECONDS ||
        videoElement.currentTime >= abRepeatEnd.value - AB_REPEAT_BOUNDARY_TOLERANCE_SECONDS
      ) {
        repeatAbRangeFromStart()
        return
      }

      scheduleAbRepeatBoundary()
    }

    function scheduleAbRepeatBoundary() {
      clearAbRepeatBoundarySchedule()

      const videoElement = video.value
      if (
        !videoElement ||
        videoElement.paused ||
        videoElement.seeking ||
        !abRepeatEnabled.value ||
        !hasValidAbRepeatRange()
      ) {
        return
      }

      if (videoElement.currentTime < abRepeatStart.value || videoElement.currentTime >= abRepeatEnd.value) {
        repeatAbRangeFromStart()
        return
      }

      const delay = getAbRepeatBoundaryDelay(
        videoElement.currentTime,
        abRepeatEnd.value,
        videoElement.playbackRate
      )

      abRepeatBoundaryTimeout = setTimeout(checkAbRepeatBoundary, Math.max(4, delay))
    }

    /**
     * @param {'start' | 'end'} point
     * @param {number | null} value
     * @returns {string | null}
     */
    function setAbRepeatBoundary(point, value) {
      if (disableAbRepeat.value) {
        return null
      }

      const nextStart = point === 'start' ? value : abRepeatStart.value
      const nextEnd = point === 'end' ? value : abRepeatEnd.value
      const validation = validateAbRepeatRange(nextStart, nextEnd, abRepeatDuration.value)
      if (validation !== null) {
        return validation
      }

      const hadValidRange = hasValidAbRepeatRange()
      if (point === 'start') {
        abRepeatStart.value = value
      } else {
        abRepeatEnd.value = value
      }

      const validRange = hasValidAbRepeatRange()
      if (!validRange) {
        abRepeatEnabled.value = false
      } else if (!hadValidRange) {
        abRepeatEnabled.value = true
      }
      if (validRange && video.value) {
        video.value.loop = false
      }

      refreshAbRepeatMarkers()
      scheduleAbRepeatBoundary()
      return null
    }

    /** @param {'start' | 'end'} point */
    function setCurrentAbRepeatBoundary(point) {
      const currentTime = video.value?.currentTime
      if (disableAbRepeat.value || isLive.value || !Number.isFinite(currentTime)) {
        return
      }

      const validation = setAbRepeatBoundary(point, currentTime)
      const label = point === 'start'
        ? t('Video.Player.A-B Repeat.Point A')
        : t('Video.Player.A-B Repeat.Point B')
      const message = getAbRepeatValidationMessage(validation) ||
        `${label} ${formatAbRepeatTimestamp(currentTime)}`
      showValueChange(message, AB_REPEAT_VALUE_CHANGE_ICON)
    }

    function toggleAbRepeat() {
      if (disableAbRepeat.value || !hasValidAbRepeatRange()) {
        return
      }

      abRepeatEnabled.value = !abRepeatEnabled.value
      if (abRepeatEnabled.value && video.value) {
        video.value.loop = false
      }
      refreshAbRepeatMarkers()
      scheduleAbRepeatBoundary()
    }

    function clearAbRepeat() {
      abRepeatDragCleanup?.()
      abRepeatStart.value = null
      abRepeatEnd.value = null
      abRepeatEnabled.value = false
      clearAbRepeatBoundarySchedule()
      refreshAbRepeatMarkers()
    }

    function resetAbRepeat() {
      abRepeatDuration.value = Number.POSITIVE_INFINITY
      clearAbRepeat()
    }

    function handleAbRepeatDurationChange() {
      abRepeatDuration.value = getAbRepeatDuration()
      if (abRepeatValidation.value !== null) {
        abRepeatEnabled.value = false
      }
      refreshAbRepeatMarkers()
      scheduleAbRepeatBoundary()
      updateVideoElementGeometry()
      syncMediaSessionPosition()
    }

    // #endregion A-B repeat

    const showInvidiousShareOptions = computed(() => {
      return store.getters.getBackendPreference === 'invidious' || store.getters.getBackendFallback
    })

    const contextMenuElements = computed(() => {
      const elements = [
        'ft_loop',
        'ft_copy_youtube_video_url',
        'ft_copy_youtube_video_url_at_current_time'
      ]

      if (showInvidiousShareOptions.value) {
        elements.push(
          'ft_copy_invidious_video_url',
          'ft_copy_invidious_video_url_at_current_time'
        )
      }

      elements.push('ft_stats')

      return elements
    })

    const uiConfig = computed(() => {
      const controlPanelElements = [
        'ft_skip_previous',
        ...(!isCapacitorMobilePlayer() ? ['play_pause'] : []),
        'ft_skip_next',
        ...(!isCapacitorMobilePlayer() ? ['mute', 'volume'] : []),
        'time_and_duration',
        'ft_playback_adjusted_time',
        ...((!onlyUseOverFlowMenu.value || isCapacitorMobilePlayer()) && !props.shortsPlayer && props.chapters.length > 0
          ? ['ft_chapters']
          : []),
        'ft_sponsorblock_highlight',
        'spacer'
      ]

      /** @type {shaka.extern.UIConfiguration} */
      const uiConfig = {
        controlPanelElements: controlPanelElements,
        topControlPanelElements: [],
        overflowMenuButtons: [],
        contextMenuElements: contextMenuElements.value,
        customContextMenu: !isCapacitorMobilePlayer(),
        // Shorts have interactive controls over nearly the entire video
        // surface. Do not let Shaka interpret rapid control clicks as a
        // request to enter fullscreen.
        doubleClickForFullscreen: !props.shortsPlayer && !isCapacitorMobilePlayer(),

        // only set this to label when we actually have labels, so that the warning doesn't show up
        // about it being set to labels, but that the audio tracks don't have labels
        trackLabelFormat: hasMultipleAudioTracks.value ? TrackLabelFormat.LABEL : TrackLabelFormat.LANGUAGE_ROLE,
        // Only set it to label if we added the captions ourselves,
        // some live streams come with subtitles in the DASH manifest, but without labels
        textTrackLabelFormat: props.captions.length > 0 ? TrackLabelFormat.LABEL : TrackLabelFormat.LANGUAGE,
        displayInVrMode: useVrMode.value
      }

      /** @type {string[]} */
      let elementList
      const pictureInPictureElement = process.env.IS_CAPACITOR
        ? 'ft_android_picture_in_picture'
        : 'picture_in_picture'

      // Shorts always use their custom top controls and hide Shaka's standard
      // control panel. Keep every applicable action in the overflow menu even
      // when full-window mode makes the player wide enough for the desktop
      // control layout.
      if (onlyUseOverFlowMenu.value || props.shortsPlayer) {
        // Keep related settings together before the one-click actions so the
        // grid's reading and tab order remain predictable.
        uiConfig.overflowMenuButtons = [
          ...(props.shortsPlayer ? ['ft_shorts_video_info'] : []),
          props.format === 'legacy' ? 'ft_legacy_quality' : 'quality',
          'playback_rate',
          'captions',
          'ft_audio_tracks',
          'ft_sleep_timer',
          ...(!props.shortsPlayer ? ['ft_autoplay_toggle'] : []),
          ...(props.chapters.length > 0 ? ['ft_chapters'] : []),
          'ft_skip_silence',
          'ft_voice_over_translation',
          'ft_music_visualizer',
          'ft_ambient_mode',
          'ft_video_zoom',
          'ft_loop',
          'ft_ab_repeat',
          'ft_screenshot',
          pictureInPictureElement,
          'ft_full_window',
          'recenter_vr',
          'toggle_stereoscopic',
        ]

        elementList = uiConfig.overflowMenuButtons

        uiConfig.controlPanelElements.push(
          ...((props.shortsPlayer || isCapacitorMobilePlayer()) && useQuickPlaybackSpeedBar.value && !isLive.value
            ? ['ft_quick_playback_rate_bar']
            : []),
          'ft_caption_toggle',
          ...(isCapacitorMobilePlayer() && !props.shortsPlayer ? [pictureInPictureElement] : []),
          'overflow_menu',
          'fullscreen'
        )
      } else {
        uiConfig.controlPanelElements.push(
          ...(useQuickPlaybackSpeedBar.value && !isLive.value ? ['ft_quick_playback_rate_bar'] : []),
          'ft_sponsorblock_open_menu',
          'ft_sponsorblock_clear',
          'ft_sponsorblock_start',
          'ft_sponsorblock_cancel',
          'ft_sponsorblock_end',
          'ft_screenshot',
          'ft_autoplay_toggle',
          'ft_caption_toggle',
          'overflow_menu',
          pictureInPictureElement,
          'ft_theatre_mode',
          'ft_full_window',
          'fullscreen'
        )

        // Keep related settings together before the one-click actions.
        uiConfig.overflowMenuButtons.push(
          'ft_audio_tracks',
          'captions',
          'playback_rate',
          props.format === 'legacy' ? 'ft_legacy_quality' : 'quality',
          'ft_sleep_timer',
          'ft_skip_silence',
          'ft_voice_over_translation',
          'ft_music_visualizer',
          'ft_ambient_mode',
          'ft_video_zoom',
          'ft_loop',
          'ft_ab_repeat',
          'recenter_vr',
          'toggle_stereoscopic',
        )

        elementList = uiConfig.controlPanelElements
      }

      if (!enableScreenshot.value || props.format === 'audio') {
        removeFromArrayIfExists(elementList, 'ft_screenshot')
      }

      // Keep the control mounted when a panel can make theatre mode available.
      if (!props.theatrePossible && props.chapters.length === 0 && !useSponsorBlock.value) {
        removeFromArrayIfExists(uiConfig.controlPanelElements, 'ft_theatre_mode')
      }

      if (!props.autoplayPossible) {
        removeFromArrayIfExists(elementList, 'ft_autoplay_toggle')
      }

      if (props.format === 'audio') {
        removeFromArrayIfExists(uiConfig.controlPanelElements, pictureInPictureElement)
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, pictureInPictureElement)
      }

      if (props.format === 'audio' || useVrMode.value) {
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'ft_ambient_mode')
      }

      if (!audioPlayerMode.value) {
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'ft_music_visualizer')
      }

      if (!videoZoomPossible.value) {
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'ft_video_zoom')
      }

      if (!showSkipSilenceButton.value || isLive.value) {
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'ft_skip_silence')
      }

      if (!voiceOverTranslationAvailable.value) {
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'ft_voice_over_translation')
      }

      if (isLive.value) {
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'loop')
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'ft_loop')
      }

      if (isLive.value || disableAbRepeat.value) {
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'ft_ab_repeat')
      }

      if (!useVrMode.value) {
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'recenter_vr')
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'toggle_stereoscopic')
      }

      // Only offer skipping where there actually is a video to skip to. The watch
      // view knows where those come from, a playlist or the watch queue.
      if (!props.canSkipPrevious) {
        removeFromArrayIfExists(uiConfig.controlPanelElements, 'ft_skip_previous')
      }

      if (!props.canSkipNext) {
        removeFromArrayIfExists(uiConfig.controlPanelElements, 'ft_skip_next')
      }

      return uiConfig
    })

    /**
     * For the first call we want to set initial values for options that may change later,
     * as well as setting the options that we won't change again.
     *
     * For all subsequent calls we only want to reconfigure the options that have changed.
     * e.g. due to the active format changing or the user changing settings
     * @param {boolean} firstTime
     */
    function configureUI(firstTime = false) {
      // Shaka rebuilds every control element on configure, and several of them
      // dereference the attached player immediately (e.g. the playback rate
      // selection reads player.getPlaybackRate()). While the player is detached
      // or mid-(re)load — the async mount gap, a format switch, or a SABR reload
      // (LOAD_INTERRUPTED) — that rebuild throws synchronously. Because these
      // reconfigures run inside Vue reactive effects, the exception reaches the
      // tab's error boundary and takes the whole tab down. Defer any non-initial
      // reconfigure until the player is loaded again, then flush it once.
      if (!firstTime && (!player || !hasLoaded.value)) {
        pendingUiReconfigure = true
        return
      }

      if (firstTime) {
        /** @type {shaka.extern.UIConfiguration} */
        const firstTimeConfig = {
          addSeekBar: seekingIsPossible.value,
          customContextMenu: true,
          contextMenuElements: contextMenuElements.value,
          enableTooltips: true,
          seekBarColors: {
            // shaka-player's chapter markers only show up part of the time for the DASH and audio formats
            // the issue is clearly on the FreeTube side as shaka-player's demo page works fine and they show up all the time for the legacy formats.
            // As I have spent way too much time debugging it and still cannot make sense of it, we'll stick with FreeTube's own chapter markers for now.
            chapters: 'transparent',
            played: 'var(--primary-color)'
          },
          showAudioCodec: false,
          // Paused media needs a visible way to resume on both desktop and touch devices.
          showUIOnPaused: true,
          // YouTube offers the same resolutions in several codecs, which shaka-player lists
          // separately, so the codec is what tells those entries apart. The built-in engine
          // keeps distinguishing them by their bitrate, the way it did before.
          showVideoCodec: props.playbackEngine === 'yt-dlp',
          volumeBarColors: {
            level: 'var(--primary-color)'
          },
          mediaSession: {
            // The WatchVideoInfo component handles that
            handleMetadata: false,
            // Need to override the default list so it doesn't override the next and previous video handlers in the WatchVideoPlaylist component.
            supportedActions: [
              'pause',
              'play',
              'seekbackward',
              'seekforward',
              'seekto'
            ]
          },

          // these have their own watchers
          bigButtons: displayVideoPlayButton.value || isCapacitorMobilePlayer() ? ['play_pause'] : [],
          enableFullscreenOnRotation: !process.env.IS_CAPACITOR && enterFullscreenOnDisplayRotate.value,
          playbackRates: playbackRates.value,
          tapSeekDistance: defaultSkipInterval.value,

          // we have our own ones (shaka-player's ones are quite limited)
          enableKeyboardPlaybackControls: false,

          // TODO: enable this when electron gets document PiP support
          // https://github.com/electron/electron/issues/39633
          documentPictureInPicture: {
            enabled: false
          }
        }

        if (document.pictureInPictureEnabled) {
          firstTimeConfig.mediaSession.supportedActions.push('enterpictureinpicture')
        }

        // Combine the config objects so we only need to do one configure call
        // as shaka-player recreates the UI when you call configure
        Object.assign(firstTimeConfig, uiConfig.value)

        ui.configure(firstTimeConfig)
      } else {
        // Another player mounted after us may have overwritten our factories
        // in shaka's shared element registries, which this configure call
        // rebuilds every control element from.
        reRegisterOwnElements()
        ui.configure(uiConfig.value)
      }

      // Shaka recreates its media-session handlers on configure. Re-apply the
      // logical-tab owner handlers so an inactive player cannot take them over.
      registerMediaSessionHandlers()

      // Shaka recreates the controls on configure, but its quality badge is not populated
      // until the next player or submenu event.
      if (hasLoaded.value) {
        ui.getControls().dispatchEvent(new shaka.util.FakeEvent('submenuclose'))
      }

      syncPlayPauseControlIcons()
      syncMuteControlIcons(video.value.muted || video.value.volume === 0)
      syncPipToggleState(document.pictureInPictureElement === video.value)
    }

    function closeChaptersOverlay() {
      showChaptersOverlay.value = false
      events.dispatchEvent(new CustomEvent('setChaptersOverlay', {
        detail: false
      }))
    }

    function syncChapterOverlayButton() {
      syncingChapterOverlayButton = true
      events.dispatchEvent(new CustomEvent('setChaptersOverlay', {
        detail: isNativeFullscreenActive() || fullWindowEnabled.value
          ? showChaptersOverlay.value
          : props.sidebarChaptersOpen
      }))
      syncingChapterOverlayButton = false
    }

    /**
     * @param {number} startSeconds
     */
    function selectOverlayChapter(startSeconds) {
      setCurrentTime(startSeconds)
    }

    /**
     * @param {number} startSeconds
     */
    function copyChapterTimestamp(startSeconds) {
      const videoUrl = appendTimestamp(getYoutubeVideoShareUrl(props.videoId), Math.floor(startSeconds))

      copyToClipboard(videoUrl, {
        messageOnSuccess: t('Share.Timestamp Link Copied')
      })
    }

    /**
     * @param {WheelEvent} event
     */
    function handleControlsContainerWheel(event) {
      /** @type {DOMTokenList} */
      const classList = event.target.classList

      if (classList.contains('shaka-scrim-container') ||
        classList.contains('shaka-fast-forward-container') ||
        classList.contains('shaka-rewind-container') ||
        classList.contains('shaka-play-button-container') ||
        classList.contains('shaka-play-button') ||
        classList.contains('shaka-controls-container') ||
        classList.contains('shaka-spacer')) {
        //

        if (event.ctrlKey || event.metaKey) {
          if (videoPlaybackRateMouseScroll.value) {
            mouseScrollPlaybackRateHandler(event)
          }
        } else {
          if (videoVolumeMouseScroll.value) {
            mouseScrollVolumeHandler(event)
          } else if (videoSkipMouseScroll.value) {
            mouseScrollSkipHandler(event)
          }
        }
      }
    }

    /**
     * @param {MouseEvent} event
     */
    function handleControlsContainerClick(event) {
      if (event.ctrlKey || event.metaKey) {
        // stop shaka-player's click handler firing
        event.stopPropagation()

        player.cancelTrickPlay()

        showValueChange(`${getDefaultPlaybackRateForVideo()}x`)
      }
    }

    let fullscreenTitleClickPending = false

    /**
     * Remember that a potential double-click began on the title because opening
     * its metadata dock can move the title before the second click lands.
     * @param {MouseEvent} event
     */
    function rememberFullscreenTitleClick(event) {
      if (event.detail === 1) {
        fullscreenTitleClickPending = true
      }
    }

    /**
     * Keep a double-click that began on the fullscreen title from reaching
     * Shaka's fullscreen toggle after the metadata layout moves its target.
     * @param {MouseEvent} event
     */
    function handleControlsContainerDoubleClick(event) {
      if (!fullscreenTitleClickPending) {
        return
      }

      fullscreenTitleClickPending = false
      event.preventDefault()
      event.stopImmediatePropagation()
    }

    /**
     * Shaka handles fullscreen double-clicks on the controls container itself.
     * Stop gestures that began on an actual control before that handler can
     * observe them; bubble-phase `.stop` handlers run too late for this case.
     * @param {MouseEvent} event
     */
    function handlePlayerControlDoubleClick(event) {
      if (!(event.target instanceof Element)) {
        return
      }

      if (event.target.closest(`${FULLSCREEN_DOCK_HEADER_SELECTOR}, .fullscreenDockResizeHandle`)) {
        return
      }

      const interactiveTarget = event.target.closest(
        '.playerFullscreenTitleOverlay, .fullscreenActions, .fullscreenMetadataOverlay, ' +
        '.fullscreenTranscriptOverlay, .fullscreenSponsorBlockOverlay, .fullscreenLiveChatOverlay, ' +
        '.fullscreenCommentsOverlay, .fullscreenPlaylistOverlay, .chapterOverlay, .shortsTopControls, ' +
        '.shaka-controls-button-panel, .shaka-settings-menu, .shaka-context-menu'
      )
      if (!interactiveTarget && isCapacitorMobilePlayer()) {
        const bounds = container.value?.getBoundingClientRect()
        const relativeX = bounds?.width > 0 ? (event.clientX - bounds.left) / bounds.width : 0.5
        // Keep side double-tap seeking, but replace center double-tap
        // fullscreen with the vertical phone gesture.
        if (relativeX <= 0.35 || relativeX >= 0.65) {
          return
        }
      } else if (!interactiveTarget) {
        return
      }

      event.preventDefault()
      event.stopImmediatePropagation()
    }

    /**
     * Clear a previous title click when a new click gesture starts elsewhere.
     * @param {MouseEvent} event
     */
    function handleFullscreenTitleMouseDown(event) {
      if (event.detail === 1 && event.target !== fullscreenTitleOverlay) {
        fullscreenTitleClickPending = false
      }
    }

    /**
     * Only start click-and-hold playback from the non-interactive player surface.
     * @param {EventTarget | null} target
     * @returns {boolean}
     */
    function isPlayerSurfaceTarget(target) {
      if (target === video.value) return true
      if (!(target instanceof Element)) return false

      // The visible web play button owns its click. Only its hidden native
      // counterpart is part of the surface handled by the mobile recognizer.
      if (target.closest('.shaka-play-button') && !container.value?.hasAttribute('data-native-player-controls')) return false

      // Seek feedback remains hit-testable while transparent, including its
      // text and SVG paths. Those descendants belong to the player surface.
      return target.closest('.shaka-fast-forward-container, .shaka-rewind-container, .shaka-play-button') !== null || [
        'shaka-scrim-container',
        'shaka-play-button-container',
        'shaka-controls-container',
      ].some(className => target.classList.contains(className))
    }

    /**
     * Pinch gestures may begin on non-interactive descendants of Shaka's
     * surface, including the SVG inside its central play button. Menus and the
     * bottom control panel retain their own two-finger interactions.
     * @param {EventTarget | null} target
     * @returns {boolean}
     */
    function isVideoZoomGestureTarget(target) {
      if (target === video.value) return true
      if (!(target instanceof Element)) return false

      return target.closest('.shaka-controls-container') !== null &&
        target.closest([
          '.shaka-controls-button-panel',
          '.shaka-seek-bar-container',
          '.shaka-settings-menu',
          '.shaka-context-menu',
        ].join(',')) === null
    }

    const {
      cancelMobileFullscreenGesture,
      consumeMobileTitleClickSuppression,
      finishMobileFullscreenGesture,
      handleMobilePlayerSurfaceClick,
      handleMobilePlayerTouchEnd,
      mobileFullscreenSwipeSettling,
      mobileFullscreenSwipeStyle,
      mobileFullscreenSwiping,
      moveMobileFullscreenGesture,
      startMobileFullscreenGesture,
    } = useMobileFullscreenGestures({
      getContainer: () => container.value,
      getControls: () => ui?.getControls(),
      isFullscreenActive: () => isNativeFullscreenActive(),
      isFullscreenMetadataShown: () => showFullscreenMetadata.value,
      isFullscreenSwipeEnabled: () => enableMobileFullscreenSwipe.value,
      isPlaybackEnded: () => video.value?.ended === true,
      isPlayerSurfaceTarget,
      isScrollMiniPlayerActive: () => scrollMiniPlayerActive.value,
      seekOnDoubleTap: seconds => {
        if (!canSeek()) return 0
        const multiplier = seekIntervalMultiplyByPlaybackRate.value ? getCurrentPlaybackRate() : 1
        const distance = seconds * multiplier
        seekBySeconds(distance, true, false, false)
        return distance
      },
      setFullscreenMetadata,
      setShowUiOnPaused,
      showOverlayControls,
      togglePlayerFullScreen: () => ui?.getControls().toggleFullScreen(),
    })

    /** @type {number | null} */
    let temporaryPlaybackRatePointerId = null
    let temporaryPlaybackRatePointerStart = { x: 0, y: 0 }
    let temporaryPlaybackRatePointerCancelled = false
    let suppressTemporaryPlaybackRateClick = false

    /**
     * @param {PointerEvent} event
     */
    function handleTemporaryPlaybackRatePointerDown(event) {
      if (
        !['mouse', 'touch'].includes(event.pointerType) ||
        event.button !== 0 ||
        !event.isPrimary ||
        event.ctrlKey ||
        event.metaKey ||
        !holdToDoublePlaybackSpeed.value ||
        temporaryPlaybackRatePointerId !== null ||
        !isPlayerSurfaceTarget(event.target)
      ) {
        return
      }

      temporaryPlaybackRatePointerId = event.pointerId
      temporaryPlaybackRatePointerStart = { x: event.clientX, y: event.clientY }
      temporaryPlaybackRatePointerCancelled = false
      suppressTemporaryPlaybackRateClick = false
      startTemporaryPlaybackRateHold(TEMPORARY_PLAYBACK_RATE_POINTER_SOURCE)
    }

    /**
     * @param {PointerEvent} event
     */
    function handleTemporaryPlaybackRatePointerUp(event) {
      if (event.pointerId !== temporaryPlaybackRatePointerId) {
        return
      }

      const wasActive = temporaryPlaybackRateSources.has(TEMPORARY_PLAYBACK_RATE_POINTER_SOURCE)
      finishTemporaryPlaybackRateHold(TEMPORARY_PLAYBACK_RATE_POINTER_SOURCE)

      temporaryPlaybackRatePointerId = null
      suppressTemporaryPlaybackRateClick = wasActive || temporaryPlaybackRatePointerCancelled
      temporaryPlaybackRatePointerCancelled = false

      if (suppressTemporaryPlaybackRateClick) {
        setTimeout(() => {
          suppressTemporaryPlaybackRateClick = false
        }, event.pointerType === 'touch' ? 350 : 0)
      }
    }

    /** @param {TouchEvent} event */
    function handlePlayerTouchEnd(event) {
      if (suppressTemporaryPlaybackRateClick) {
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }
      handleMobilePlayerTouchEnd(event)
    }

    /** @param {MouseEvent} event */
    function handlePlayerContextMenu(event) {
      if (isCapacitorMobilePlayer() && isPlayerSurfaceTarget(event.target)) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }

    /**
     * @param {PointerEvent} event
     */
    function handleTemporaryPlaybackRatePointerLeave(event) {
      if (event.pointerId !== temporaryPlaybackRatePointerId) {
        return
      }

      temporaryPlaybackRatePointerCancelled = true
      finishTemporaryPlaybackRateHold(TEMPORARY_PLAYBACK_RATE_POINTER_SOURCE)
    }

    /**
     * @param {PointerEvent} event
     */
    function handleTemporaryPlaybackRatePointerCancel(event) {
      if (event.pointerId !== temporaryPlaybackRatePointerId) {
        return
      }

      finishTemporaryPlaybackRateHold(TEMPORARY_PLAYBACK_RATE_POINTER_SOURCE)
      temporaryPlaybackRatePointerId = null
      temporaryPlaybackRatePointerCancelled = false
    }

    /**
     * @param {MouseEvent} event
     */
    function handleTemporaryPlaybackRateClick(event) {
      if (!suppressTemporaryPlaybackRateClick) {
        return
      }

      suppressTemporaryPlaybackRateClick = false
      event.preventDefault()
      event.stopImmediatePropagation()
    }

    /**
     * @param {HTMLElement} seekBarContainer
     */
    function getChapterPreview(seekBarContainer) {
      if (!container.value) return null

      let chapterPreview = container.value.querySelector('.ft-chapter-preview')

      if (!chapterPreview) {
        chapterPreview = document.createElement('div')
        chapterPreview.className = 'ft-chapter-preview'
        chapterPreview.dir = 'auto'
      }

      if (chapterPreview.parentElement !== seekBarContainer) {
        seekBarContainer.appendChild(chapterPreview)
      }

      return chapterPreview
    }

    /**
     * @param {MouseEvent} event
     */
    function handleSeekBarMouseMove(event) {
      if (!container.value || !player) return

      // The listener is bound to the seek bar container itself, so there is no
      // need to look it up again on every one of these very frequent events.
      const seekBarContainer = event.currentTarget
      if (!seekBarContainer) return

      if (props.chapters.length === 0) {
        const chapterPreview = container.value.querySelector('.ft-chapter-preview')
        if (chapterPreview) {
          chapterPreview.style.display = 'none'
        }

        return
      }

      const chapterPreview = getChapterPreview(seekBarContainer)
      if (!chapterPreview) return

      const rect = seekBarContainer.getBoundingClientRect()
      if (rect.width === 0) {
        chapterPreview.style.display = 'none'
        return
      }

      const offsetX = event.clientX - rect.left
      const percentage = Math.max(0, Math.min(1, offsetX / rect.width))

      const seekRange = player.seekRange()
      const duration = seekRange.end - seekRange.start
      const hoverTime = seekRange.start + (duration * percentage)

      const chapter = props.chapters.find((candidate, index) => {
        return hoverTime >= candidate.startSeconds &&
          (hoverTime < candidate.endSeconds || (index === props.chapters.length - 1 && hoverTime === candidate.endSeconds))
      })

      if (!chapter) {
        chapterPreview.style.display = 'none'
        return
      }

      if (chapterPreview.textContent !== chapter.title) {
        chapterPreview.textContent = chapter.title
      }

      chapterPreview.style.display = 'inline-block'

      const playerRect = container.value.getBoundingClientRect()
      const maxFromSeekBar = rect.width - 8
      const maxFromPlayer = playerRect.width - 16
      const maxW = Math.max(
        Math.min(
          maxFromSeekBar,
          maxFromPlayer,
          window.innerWidth - 24
        ),
        0
      )
      chapterPreview.style.maxWidth = `${maxW}px`

      const thumbContainer = seekBarContainer.querySelector('.shaka-player-ui-thumbnail-container')
      let bottomPx
      if (thumbContainer && window.getComputedStyle(thumbContainer).visibility === 'visible') {
        const thumbRect = thumbContainer.getBoundingClientRect()
        if (thumbRect.width > 0 && thumbRect.height > 0) {
          bottomPx = rect.bottom - thumbRect.top + 8
        }
      }
      if (bottomPx == null || !Number.isFinite(bottomPx)) {
        bottomPx = seekBarContainer.offsetHeight + 8
      }
      chapterPreview.style.bottom = `${bottomPx}px`

      const previewWidth = chapterPreview.offsetWidth
      const minX = previewWidth / 2
      const maxX = rect.width - (previewWidth / 2)
      const targetX = percentage * rect.width
      const clampedX = Math.max(minX, Math.min(maxX, targetX))

      chapterPreview.style.left = `${clampedX}px`
    }

    function handleSeekBarMouseLeave() {
      if (!container.value) return

      const chapterPreview = container.value.querySelector('.ft-chapter-preview')

      if (chapterPreview) {
        chapterPreview.style.display = 'none'
      }
    }

    /**
     * @param {number} hoverTime
     * @param {number} secondsPerPixel
     * @returns {string}
     */
    function getSponsorBlockSeekBarTooltipLabel(hoverTime, secondsPerPixel) {
      const segments = sponsorBlockSegments.concat(
        sponsorBlockCompleteDraftSegments.value.filter(segment => !isSponsorBlockFullVideoSegment(segment))
      )
      const segment = findSponsorBlockSeekBarSegment(segments, hoverTime, secondsPerPixel)

      return segment ? translateSponsorBlockCategory(segment.category) : ''
    }

    /**
     * @param {MouseEvent} event
     */
    function handleSponsorBlockSeekBarMouseMove(event) {
      if (!container.value || !player) return

      const seekBarContainer = event.currentTarget
      const thumbnailTime = seekBarContainer?.querySelector('.shaka-player-ui-thumbnail-time')
      if (!seekBarContainer || !thumbnailTime) return

      const rect = seekBarContainer.getBoundingClientRect()
      if (rect.width === 0) return

      const seekRange = player.seekRange()
      const duration = seekRange.end - seekRange.start
      if (!Number.isFinite(duration) || duration <= 0) return

      const offsetX = event.clientX - rect.left
      const percentage = Math.max(0, Math.min(1, offsetX / rect.width))
      const hoverTime = seekRange.start + (duration * percentage)
      const sponsorBlockLabel = getSponsorBlockSeekBarTooltipLabel(hoverTime, duration / rect.width)
      if (sponsorBlockLabel === '') return

      const labelSuffix = ` · ${sponsorBlockLabel}`
      const currentText = thumbnailTime.textContent ?? ''
      if (!currentText.endsWith(labelSuffix)) {
        thumbnailTime.textContent = `${currentText}${labelSuffix}`
      }
    }

    function setupChapterPreview() {
      if (!container.value) return

      const seekBarContainer = container.value.querySelector('.shaka-seek-bar-container')
      if (!seekBarContainer) return

      seekBarContainer.removeEventListener('mousemove', handleSeekBarMouseMove)
      seekBarContainer.removeEventListener('mouseleave', handleSeekBarMouseLeave)
      seekBarContainer.addEventListener('mousemove', handleSeekBarMouseMove)
      seekBarContainer.addEventListener('mouseleave', handleSeekBarMouseLeave)
    }

    function setupSponsorBlockSeekBarTooltip() {
      if (!container.value) return

      const seekBarContainer = container.value.querySelector('.shaka-seek-bar-container')
      if (!seekBarContainer) return

      seekBarContainer.removeEventListener('mousemove', handleSponsorBlockSeekBarMouseMove)
      seekBarContainer.addEventListener('mousemove', handleSponsorBlockSeekBarMouseMove)
    }

    function addUICustomizations() {
      /** @type {HTMLDivElement} */
      const controlsContainer = ui.getControls().getControlsContainer()
      observeFullscreenControlsVisibility(controlsContainer)

      const controls = ui.getControls()
      controls.removeEventListener('submenuopen', handleSubMenuOpen)
      controls.removeEventListener('submenuclose', handleSubMenuClose)
      controls.addEventListener('submenuopen', handleSubMenuOpen)
      controls.addEventListener('submenuclose', handleSubMenuClose)

      controlsContainer.removeEventListener('wheel', handleControlsContainerWheel)
      controlsContainer.removeEventListener('click', handleControlsContainerClick, true)
      controlsContainer.removeEventListener('pointerdown', handleTemporaryPlaybackRatePointerDown, true)
      controlsContainer.removeEventListener('pointerleave', handleTemporaryPlaybackRatePointerLeave)
      controlsContainer.removeEventListener('click', handleTemporaryPlaybackRateClick, true)
      controlsContainer.removeEventListener('mousedown', handleFullscreenTitleMouseDown, true)
      controlsContainer.removeEventListener('dblclick', handleControlsContainerDoubleClick, true)

      controlsContainer.addEventListener('pointerdown', handleTemporaryPlaybackRatePointerDown, true)
      controlsContainer.addEventListener('pointerleave', handleTemporaryPlaybackRatePointerLeave)
      controlsContainer.addEventListener('click', handleTemporaryPlaybackRateClick, true)
      controlsContainer.addEventListener('mousedown', handleFullscreenTitleMouseDown, true)
      controlsContainer.addEventListener('dblclick', handleControlsContainerDoubleClick, true)

      if (!useVrMode.value) {
        if (videoVolumeMouseScroll.value || videoSkipMouseScroll.value || videoPlaybackRateMouseScroll.value) {
          controlsContainer.addEventListener('wheel', handleControlsContainerWheel)
        }

        if (videoPlaybackRateMouseScroll.value) {
          controlsContainer.addEventListener('click', handleControlsContainerClick, true)
        }
      }

      // title overlay when the video fills the screen or window
      // placing this inside the controls container so that we can fade it in and out at the same time as the controls
      fullscreenTitleOverlay = document.createElement('h1')
      fullscreenTitleOverlay.textContent = props.title
      fullscreenTitleOverlay.className = 'playerFullscreenTitleOverlay shaka-no-propagation'
      fullscreenTitleOverlay.dir = 'auto'
      fullscreenTitleOverlay.role = 'button'
      fullscreenTitleOverlay.tabIndex = 0
      fullscreenTitleOverlay.ariaLabel = `${t('Video.Metadata', 'Video information')}: ${props.title}`
      fullscreenTitleOverlay.ariaExpanded = String(showFullscreenMetadata.value)

      const toggleFullscreenMetadata = (event) => {
        event.stopPropagation()
        if (event instanceof MouseEvent) {
          if (consumeMobileTitleClickSuppression()) {
            event.preventDefault()
            return
          }
          rememberFullscreenTitleClick(event)
        }
        setFullscreenMetadata(!showFullscreenMetadata.value)
      }
      fullscreenTitleOverlay.addEventListener('click', toggleFullscreenMetadata)
      fullscreenTitleOverlay.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return
        }

        event.preventDefault()
        toggleFullscreenMetadata(event)
      })
      controlsContainer.appendChild(fullscreenTitleOverlay)

      if (hasLoaded.value && props.chapters.length > 0) {
        createChapterMarkers()
      }
      refreshAbRepeatMarkers()

      setupChapterPreview()
      setupSponsorBlockSeekBarTooltip()

      const fullscreenButton = controlsContainer.querySelector('.shaka-fullscreen-button')
      if (fullscreenButton instanceof HTMLElement) {
        fullscreenButton.removeEventListener('click', handleFullscreenButtonClick, true)
        fullscreenButton.addEventListener('click', handleFullscreenButtonClick, true)
      }

      if (useSponsorBlock.value && (sponsorBlockSegments.length > 0 || sponsorBlockCompleteDraftSegments.value.length > 0)) {
        refreshSponsorBlockMarkers()
      }

      updateSponsorBlockSubmissionState()
      setupAdaptiveControlPanelLayout()
      setupOverflowMenuLayout(controlsContainer)
    }

    /**
     * The overflow menu and its submenus are rebuilt from scratch whenever the
     * UI is configured, so they need their scrollbars and their height tracking
     * back every time.
     *
     * @param {HTMLElement} controlsContainer
     */
    function setupOverflowMenuLayout(controlsContainer) {
      overflowMenuResizeObserver?.disconnect()
      overflowMenuResizeObserver = null
      overflowMenuMutationObserver?.disconnect()
      overflowMenuMutationObserver = null
      if (overflowMenuTitleFrame !== null) {
        cancelAnimationFrame(overflowMenuTitleFrame)
        overflowMenuTitleFrame = null
      }
      overflowMenuIdleHeight = 0

      if (overflowMenuElement) {
        removeOverlayScrollbars(overflowMenuElement)
      }

      const menu = controlsContainer.querySelector('.shaka-overflow-menu')
      overflowMenuElement = menu instanceof HTMLElement ? menu : null
      if (!overflowMenuElement) {
        return
      }

      menu.classList.toggle('ft-menu-grid', usePlayerMenuGrid.value)

      for (const label of menu.querySelectorAll('[data-ft-overflow-title]')) {
        label.removeAttribute('title')
        delete label.dataset.ftOverflowTitle
      }

      // The caption appearance submenu has controls rather than options, so it
      // keeps its own layout.
      const submenus = menu.querySelectorAll(':scope > .shaka-sub-menu:not(.ft-caption-appearance-menu)')
      for (const submenu of submenus) {
        const isTranslationMenu = submenu.classList.contains('ft-caption-translation-menu')
        submenu.classList.toggle('ft-menu-grid', usePlayerMenuGrid.value && !isTranslationMenu)
        submenu.querySelector('.ft-caption-translation-options')
          ?.classList.toggle('ft-menu-grid', usePlayerMenuGrid.value)
      }

      addOverlayScrollbars(menu)

      if (!usePlayerMenuGrid.value) {
        menu.style.minBlockSize = ''
        return
      }

      overflowMenuMutationObserver = new MutationObserver(() => {
        scheduleOverflowMenuLabelTitles(menu)
      })
      overflowMenuMutationObserver.observe(menu, {
        attributeFilter: ['class'],
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
      })

      // Opening a submenu replaces the tiles, which would otherwise resize the
      // popup around them. Remember how tall the menu is while its own tiles are
      // shown, so that a shorter submenu only leaves empty space below itself.
      overflowMenuResizeObserver = new ResizeObserver(() => {
        scheduleOverflowMenuLabelTitles(menu)

        if (menu.querySelector(':scope > .shaka-sub-menu:not(.shaka-hidden)')) {
          return
        }

        overflowMenuIdleHeight = menu.getBoundingClientRect().height
      })
      overflowMenuResizeObserver.observe(menu)

      const controls = ui.getControls()
      controls.removeEventListener('submenuopen', keepOverflowMenuHeight)
      controls.removeEventListener('submenuclose', releaseOverflowMenuHeight)
      controls.addEventListener('submenuopen', keepOverflowMenuHeight)
      controls.addEventListener('submenuclose', releaseOverflowMenuHeight)
      scheduleOverflowMenuLabelTitles(menu)
    }

    /**
     * Schedule title measurements after Shaka has finished updating the menu.
     *
     * @param {HTMLElement} menu
     */
    function scheduleOverflowMenuLabelTitles(menu) {
      if (overflowMenuTitleFrame !== null) {
        return
      }

      overflowMenuTitleFrame = requestAnimationFrame(() => {
        overflowMenuTitleFrame = null
        updateOverflowMenuLabelTitles(menu)
      })
    }

    /**
     * Add a native tooltip only when a visible player-menu label is clipped.
     *
     * @param {HTMLElement} menu
     */
    function updateOverflowMenuLabelTitles(menu) {
      for (const label of menu.querySelectorAll('.ft-menu-grid button span')) {
        const isVisible = label.clientWidth > 0 && label.clientHeight > 0
        const isClipped = isVisible && (
          label.scrollWidth > label.clientWidth || label.scrollHeight > label.clientHeight
        )

        if (isClipped && (!label.hasAttribute('title') || 'ftOverflowTitle' in label.dataset)) {
          label.title = label.textContent.trim()
          label.dataset.ftOverflowTitle = ''
        } else if (!isClipped && 'ftOverflowTitle' in label.dataset) {
          label.removeAttribute('title')
          delete label.dataset.ftOverflowTitle
        }
      }
    }

    function keepOverflowMenuHeight() {
      const menu = container.value?.querySelector('.shaka-overflow-menu')
      if (menu instanceof HTMLElement && overflowMenuIdleHeight > 0) {
        menu.style.minBlockSize = `${overflowMenuIdleHeight}px`
      }
      if (menu instanceof HTMLElement) {
        scheduleOverflowMenuLabelTitles(menu)
      }
    }

    function releaseOverflowMenuHeight() {
      const menu = container.value?.querySelector('.shaka-overflow-menu')
      if (menu instanceof HTMLElement) {
        menu.style.minBlockSize = ''
        scheduleOverflowMenuLabelTitles(menu)
      }
    }

    watch(uiConfig, (newValue, oldValue) => {
      if (newValue !== oldValue && ui) {
        configureUI()
      }
    })

    // The menu is only rebuilt when the UI configuration changes, so switching
    // the layout has to reach the existing one.
    watch(usePlayerMenuGrid, () => {
      if (ui) {
        setupOverflowMenuLayout(ui.getControls().getControlsContainer())
      }
    })

    // Reapply any reconfigure that was deferred while the player was unloaded,
    // now that it is loaded again and rebuilding the controls is safe.
    watch(hasLoaded, (loaded) => {
      if (loaded && pendingUiReconfigure && ui && player) {
        pendingUiReconfigure = false
        configureUI()
      }
    })

    watch(() => props.chapters.length, (chapterCount) => {
      if (chapterCount === 0) {
        closeChaptersOverlay()
      }
    })

    watch(sponsorBlockSubmissionVisibleButtons, () => {
      updateSponsorBlockSubmissionState()
    }, { immediate: true })

    let mediaSessionStopped = false

    watch(() => props.videoId, () => {
      resetAbRepeat()
      mediaSessionStopped = false
      voiceOverTranslation.reset()
      showPoster.value = true
      sponsorBlockMuteController.reset()
      clearSponsorBlockMuteSegments()
      if (props.shortsPlayer) {
        shortsPaused.value = false
        shortsEnded.value = false
        shortsCaptionsAvailable.value = false
        shortsCaptionsEnabled.value = false
      }
      closeChaptersOverlay()
      if (!props.shortsPlayer) {
        closeSponsorBlockInfo()
      }
      resetSponsorBlockHighlightLabel()
      loadSponsorBlockDrafts()
      sponsorBlockSubmissionError.value = ''
      updateSponsorBlockSubmissionState()
    }, { immediate: true })

    watch(disableAbRepeat, (disabled) => {
      if (disabled) {
        resetAbRepeat()
      }
    })

    watch(
      [() => props.videoId, () => props.paidPromotion, () => props.shortsPlayer],
      ([videoId, paidPromotion, shortsPlayer], previous = []) => {
        resetPaidPromotion()
        if (shouldStartPaidPromotionTimer({
          videoId,
          previousVideoId: previous[0],
          paidPromotion,
          shortsPlayer,
          paused: video.value?.paused,
        })) {
          startPaidPromotionTimer()
        }
      },
      { immediate: true }
    )

    watch(useSponsorBlock, enabled => {
      if (!enabled) {
        closeSponsorBlockInfo()
        sponsorBlockMuteController.reset()
        clearSponsorBlockMuteSegments()
        cancelSponsorBlockSkipSchedule()
      } else {
        scheduleSponsorBlockSkip()
      }
    })

    watch(() => props.sponsorBlockAutoSkipDisabled, disabled => {
      syncSponsorBlockMuteSegments(video.value?.currentTime ?? 0, !disabled)
      scheduleSponsorBlockSkip()
    })

    watch(sponsorSkips, scheduleSponsorBlockSkip)

    watch(sponsorBlockEnableSubmission, (enabled) => {
      if (
        enabled &&
        sponsorBlockInfoOpen.value &&
        !sponsorBlockContributionStatsLoaded.value &&
        !sponsorBlockContributionStatsLoading.value
      ) {
        refreshSponsorBlockContributionStats()
      }
      emitSponsorBlockInfoState()
    })

    watch(sponsorBlockDraftSegmentsByVideoId, () => {
      loadSponsorBlockDrafts()
    }, { deep: true })

    watch(sponsorBlockCompleteDraftSegments, () => {
      if (useSponsorBlock.value && ui) {
        refreshSponsorBlockMarkers()
      }
    }, { deep: true })

    watch(videoVolumeMouseScroll, (newValue, oldValue) => {
      if (newValue !== oldValue && ui) {
        configureUI()
      }
    })

    watch(videoPlaybackRateMouseScroll, (newValue, oldValue) => {
      if (newValue !== oldValue && ui) {
        configureUI()
      }
    })

    watch(videoSkipMouseScroll, (newValue, oldValue) => {
      if (newValue !== oldValue && ui) {
        configureUI()
      }
    })

    watch(() => props.autoplayEnabled, (newValue, oldValue) => {
      if (newValue !== oldValue) {
        events.dispatchEvent(new CustomEvent('setAutoplay', {
          detail: newValue
        }))
      }
    })

    watch(() => props.isLive, (newValue) => {
      isLive.value = newValue
    })

    watch(voiceOverTranslationLanguage, () => voiceOverTranslation.reset())
    watch([voiceOverTranslationAvailable, voiceOverTranslationAutoPrepare], ([available, autoPrepare]) => {
      if (!available) {
        voiceOverTranslation.reset()
      } else if (autoPrepare && video.value?.readyState >= HTMLMediaElement.HAVE_METADATA) {
        voiceOverTranslation.prepare()
      }
    })

    watch(
      [
        useQuickPlaybackSpeedBar,
        rememberPlaybackSpeedPerChannel,
        autoUpdateChannelPlaybackSpeeds,
        savedChannelPlaybackRate,
        quickPlaybackSpeedBarOptions,
        () => props.channelId
      ],
      () => {
        events.dispatchEvent(new CustomEvent('quickPlaybackRateBarStateChanged'))
      }
    )

    /** @type {ResizeObserver|null} */
    let containerResizeObserver = null

    /** @type {ResizeObserver|null} */
    let overflowMenuResizeObserver = null

    /** @type {MutationObserver|null} */
    let overflowMenuMutationObserver = null

    /** @type {number|null} */
    let overflowMenuTitleFrame = null

    /** How tall the overflow menu is while its own tiles are shown. */
    let overflowMenuIdleHeight = 0

    /** @type {HTMLElement|null} */
    let overflowMenuElement = null

    /** @type {ResizeObserver|null} */
    let controlPanelResizeObserver = null

    /** @type {MutationObserver|null} */
    let controlPanelMutationObserver = null

    /** @type {MutationObserver|null} */
    let fullscreenControlsVisibilityObserver = null
    let androidStatusBarVisible = true

    function handleSubMenuOpen() {
      isSubMenuOpened.value = true
    }

    function handleSubMenuClose() {
      isSubMenuOpened.value = false
    }

    /** @type {number|null} */
    let controlPanelLayoutFrame = null

    const controlPanelCompactClasses = [
      'ft-controls-hide-highlight-label',
      'ft-controls-compact-chapters',
      'ft-controls-stack-times',
      'ft-controls-overflow-pip',
      'ft-controls-overflow-captions'
    ]

    /**
     * @param {HTMLElement} controlPanel
     * @returns {boolean}
     */
    function controlPanelOverflows(controlPanel) {
      let contentWidth = 0
      let crossesPanelEdge = false
      const controlPanelBounds = controlPanel.getBoundingClientRect()
      // Full-window transitions scale the player container. Keep margins in
      // the same visual coordinate space as the bounding rectangles so a
      // measurement during the animation does not leave the compact layout
      // enabled after the transition.
      const inlineScale = controlPanel.clientWidth > 0
        ? controlPanelBounds.width / controlPanel.clientWidth
        : 1

      for (const child of controlPanel.children) {
        if (!(child instanceof HTMLElement)) {
          continue
        }

        const style = window.getComputedStyle(child)
        if (style.display === 'none' || style.position === 'absolute') {
          continue
        }

        const childBounds = child.getBoundingClientRect()
        crossesPanelEdge ||= childBounds.left < controlPanelBounds.left - 1 ||
          childBounds.right > controlPanelBounds.right + 1

        contentWidth += childBounds.width +
          ((Number.parseFloat(style.marginLeft) || 0) * inlineScale) +
          ((Number.parseFloat(style.marginRight) || 0) * inlineScale)
      }

      return crossesPanelEdge ||
        contentWidth > controlPanelBounds.width + inlineScale
    }

    /**
     * Apply space-saving modes in priority order, only when the next mode is needed.
     * @param {HTMLElement} controlPanel
     */
    function updateControlPanelLayout(controlPanel) {
      if (!controlPanel.isConnected) {
        return
      }

      controlPanel.classList.add('ft-controls-measuring')
      controlPanel.classList.remove(...controlPanelCompactClasses)

      for (const compactClass of controlPanelCompactClasses) {
        if (!controlPanelOverflows(controlPanel)) {
          break
        }

        controlPanel.classList.add(compactClass)
      }

      controlPanel.classList.remove('ft-controls-measuring')
    }

    /** @param {HTMLElement} controlPanel */
    function scheduleControlPanelLayout(controlPanel) {
      // Background tabs remain mounted but are hidden with display:none. Do not
      // let their zero-size control bars enter a resize/mutation feedback loop.
      // The active-tab watcher schedules a fresh measurement when presented.
      if (!isActiveTab.value) {
        return
      }

      if (controlPanelLayoutFrame !== null) {
        cancelAnimationFrame(controlPanelLayoutFrame)
      }

      controlPanelLayoutFrame = requestAnimationFrame(() => {
        controlPanelLayoutFrame = null
        updateControlPanelLayout(controlPanel)
      })
    }

    function setupAdaptiveControlPanelLayout() {
      controlPanelResizeObserver?.disconnect()
      controlPanelMutationObserver?.disconnect()

      const controlPanel = container.value?.querySelector('.shaka-controls-button-panel')
      if (!(controlPanel instanceof HTMLElement)) {
        return
      }

      const regularTime = controlPanel.querySelector(':scope > .shaka-current-time:not(.ft-playback-adjusted-time)')
      const adjustedTime = controlPanel.querySelector(':scope > .ft-playback-adjusted-time')

      if (regularTime instanceof HTMLElement && adjustedTime instanceof HTMLElement) {
        const timeDisplayGroup = document.createElement('div')
        timeDisplayGroup.classList.add('ft-time-display-group')
        regularTime.before(timeDisplayGroup)
        timeDisplayGroup.append(regularTime, adjustedTime)
      }

      controlPanelResizeObserver = new ResizeObserver(() => {
        scheduleControlPanelLayout(controlPanel)
      })
      controlPanelResizeObserver.observe(controlPanel)

      controlPanelMutationObserver = new MutationObserver(mutations => {
        if (mutations.some(mutation => mutation.target !== controlPanel)) {
          scheduleControlPanelLayout(controlPanel)
        }
      })
      controlPanelMutationObserver.observe(controlPanel, {
        attributeFilter: ['class'],
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true
      })

      scheduleControlPanelLayout(controlPanel)
    }

    function syncAndroidStatusBarVisibility() {
      const controlsContainer = ui?.getControls().getControlsContainer()
      if (
        isCapacitorMobilePlayer() &&
        video.value?.ended &&
        controlsContainer?.hasAttribute('shown') === false
      ) {
        controlsContainer.setAttribute('shown', 'true')
      }
      shakaControlsShown.value = controlsContainer?.hasAttribute('shown') === true
      const visible = shouldShowAndroidStatusBar({
        active: isActiveTab.value,
        fullscreen: isNativeFullscreenActive(),
        controlsShown: controlsContainer?.hasAttribute('shown') === true,
      })
      if (visible === androidStatusBarVisible) return

      androidStatusBarVisible = visible
      setAndroidStatusBarVisible(visible).catch(error => {
        androidStatusBarVisible = !visible
        console.error('Failed to update Android status bar visibility:', error)
      })
    }

    function observeFullscreenControlsVisibility(controlsContainer) {
      fullscreenControlsVisibilityObserver?.disconnect()
      fullscreenControlsVisibilityObserver = new MutationObserver(syncAndroidStatusBarVisibility)
      fullscreenControlsVisibilityObserver.observe(controlsContainer, {
        attributeFilter: ['shown'],
        attributes: true,
      })
      syncAndroidStatusBarVisibility()
    }

    /** @type {ResizeObserverCallback} */
    function resized(entries) {
      const inlineSize = entries[0].contentBoxSize[0].inlineSize
      // Ignore measurements taken while the tab is hidden (an ancestor is
      // display:none, so the inline size collapses to 0). Treating that as
      // "narrow" would wrongly fold the whole control bar into the overflow
      // menu, and it would stay collapsed once the tab is presented again.
      if (inlineSize === 0) {
        return
      }
      onlyUseOverFlowMenu.value = inlineSize <= USE_OVERFLOW_MENU_WIDTH_THRESHOLD
      rememberInlinePlayerLayoutHeight()
      repairScrollMiniPlaceholderHeight()
    }

    // Remeasure the control bar layout once the tab becomes presented. A player
    // that mounted in a background tab could not measure its real width, and the
    // ResizeObserver does not always fire for an ancestor display:none toggle.
    function remeasureControlPanelWidth() {
      if (!ui || ui.isMobile()) {
        return
      }
      const width = container.value?.getBoundingClientRect().width ?? 0
      if (width > 0) {
        onlyUseOverFlowMenu.value = width <= USE_OVERFLOW_MENU_WIDTH_THRESHOLD

        const controlPanel = container.value?.querySelector('.shaka-controls-button-panel')
        if (controlPanel instanceof HTMLElement) {
          scheduleControlPanelLayout(controlPanel)
        }
      }
    }

    // #endregion UI config

    // #region player locales

    // shaka-player ships with some locales prebundled and already loaded
    const loadedLocales = new Set(process.env.SHAKA_LOCALES_PREBUNDLED)
    const originalShakaControlLocalizations = new Map()

    /**
     * @param {string} locale
     */
    async function setLocale(locale) {
      // For most of FreeTube's locales, there is an equivalent one in shaka-player,
      // however if there isn't one we should fall back to US English.
      // At the time of writing "et", "eu", "gl", "is" don't have any translations
      const shakaLocale = LOCALE_MAPPINGS.get(locale) ?? 'en'

      const localization = ui.getControls().getLocalization()

      const cachedLocales = store.state.player.cachedPlayerLocales

      if (!loadedLocales.has(shakaLocale)) {
        if (!Object.hasOwn(cachedLocales, shakaLocale)) {
          await store.dispatch('cachePlayerLocale', shakaLocale)
        }

        localization.insert(shakaLocale, new Map(Object.entries(cachedLocales[shakaLocale])))

        loadedLocales.add(shakaLocale)
      }

      localization.changeLocale([shakaLocale])

      // Add the keyboard shortcut to the label for the default Shaka controls
      if (!originalShakaControlLocalizations.has(shakaLocale)) {
        const controlLocalizations = new Map()
        Object.keys(shakaControlKeysToShortcuts).forEach((shakaControlKey) => {
          controlLocalizations.set(shakaControlKey, localization.resolve(shakaControlKey))
        })
        originalShakaControlLocalizations.set(shakaLocale, controlLocalizations)
      }

      const shakaControlKeysToShortcutLocalizations = new Map()
      Object.entries(shakaControlKeysToShortcuts).forEach(([shakaControlKey, getShortcut]) => {
        const originalLocalization = originalShakaControlLocalizations.get(shakaLocale).get(shakaControlKey)
        if (originalLocalization === '') {
          // e.g., A Shaka localization key in shakaControlKeysToShortcuts has fallen out of date and need to be updated
          console.error('Missing Shaka localization key "%s"', shakaControlKey)
          return
        }

        const localizationWithShortcut = addKeyboardShortcutToActionTitle(
          originalLocalization,
          getShortcut()
        )

        shakaControlKeysToShortcutLocalizations.set(shakaControlKey, localizationWithShortcut)
      })

      localization.insert(shakaLocale, shakaControlKeysToShortcutLocalizations)

      events.dispatchEvent(new CustomEvent('localeChanged'))
    }

    watch(locale, setLocale)
    watch(() => store.getters.getKeyboardShortcuts, () => setLocale(locale.value))

    // #endregion player locales

    function registerMediaSessionHandlers() {
      tabMediaCoordinator.setActionHandlers(mediaTabId, 'player', {
        play: () => video.value?.play(),
        pause: () => video.value?.pause(),
        stop: () => {
          const videoElement = video.value
          if (!videoElement) return
          const wasPaused = videoElement.paused
          mediaSessionStopped = true
          videoElement.pause()
          if (Number.isFinite(videoElement.duration)) {
            videoElement.currentTime = 0
          }
          if (wasPaused) {
            tabMediaCoordinator.setPlaybackState(mediaTabId, 'none')
          }
        },
        seekbackward: (details = {}) => {
          seekBySeconds(-(details.seekOffset ?? defaultSkipInterval.value), false, true)
        },
        seekforward: (details = {}) => {
          seekBySeconds(details.seekOffset ?? defaultSkipInterval.value, false, true)
        },
        seekto: (details = {}) => {
          const videoElement = video.value
          if (!videoElement || !Number.isFinite(details.seekTime)) return
          if (details.fastSeek === true && typeof videoElement.fastSeek === 'function') {
            videoElement.fastSeek(details.seekTime)
          } else {
            videoElement.currentTime = details.seekTime
          }
        },
        enterpictureinpicture: () => {
          if (props.format !== 'audio' && ui?.getControls?.().isPiPAllowed()) {
            ui.getControls().togglePiP()
          }
        }
      })
    }

    // #region video event handlers

    /**
     * @param {Element} button
     * @param {string} iconPath
     */
    function createPlayPauseMorphIcon(button, iconPath) {
      const icon = document.createElementNS(SVG_NAMESPACE, 'svg')
      icon.classList.add('shaka-ui-icon', 'ft-play-pause-morph-icon')
      icon.setAttribute('viewBox', '0 0 24 24')
      icon.setAttribute('aria-hidden', 'true')

      const path = document.createElementNS(SVG_NAMESPACE, 'path')
      path.setAttribute('d', iconPath)
      icon.appendChild(path)
      button.appendChild(icon)
    }

    function syncPlayPauseControlIcons() {
      const video_ = video.value
      if (!video_) return

      const nextState = video_.ended && video_.duration ? 'replay' : video_.paused ? 'play' : 'pause'

      window.requestAnimationFrame(() => {
        container.value?.querySelectorAll('.shaka-play-button').forEach((button) => {
          if (!button.querySelector('.ft-play-pause-morph-icon')) {
            createPlayPauseMorphIcon(button, PLAY_MORPH_PATH)
          }

          if (nextState === 'replay') {
            button.querySelector(
              ':scope > .shaka-ui-icon:not(.ft-play-pause-morph-icon) > path'
            )?.setAttribute('d', shaka.ui.Enums.MaterialDesignSVGIcons.REPLAY)
          }

          button.setAttribute('data-ft-play-pause-state', nextState)
        })
      })
    }

    /**
     * @param {boolean} muted
     */
    function syncMuteControlIcons(muted) {
      window.requestAnimationFrame(() => {
        container.value?.querySelectorAll('.shaka-mute-button').forEach((button) => {
          button.querySelector(':scope > .shaka-ui-icon > path')?.setAttribute(
            'd',
            shaka.ui.Enums.MaterialDesignSVGIcons.MUTE
          )

          if (!button.querySelector('.ft-mute-toggle-slash')) {
            const slash = document.createElement('span')
            slash.classList.add('ft-mute-toggle-slash')
            slash.ariaHidden = 'true'
            button.appendChild(slash)
          }

          button.setAttribute('data-ft-muted', String(muted))
        })
      })
    }

    /**
     * shaka-player's picture in picture button only tells its state through its
     * label, so the overflow menu can't highlight it while it is active.
     *
     * @param {boolean} active
     */
    function syncPipToggleState(active) {
      window.requestAnimationFrame(() => {
        container.value?.querySelectorAll('.shaka-pip-button').forEach((button) => {
          button.ariaPressed = active ? 'true' : 'false'
        })
      })
    }

    function handlePlay() {
      if (!temporaryPlaybackRateActive) setShowUiOnPaused(true)
      playerPaused.value = false
      clearPausedInterfaceReveal()
      shortsPaused.value = false
      shortsEnded.value = false
      const isCurrentPictureInPictureVideo = document.pictureInPictureElement === video.value
      if (
        !isActiveTab.value &&
        !isCurrentPictureInPictureVideo &&
        !scrollMiniPlayerDetached.value
      ) {
        video.value.pause()
        return
      }

      mediaSessionStopped = false

      flushPendingMusicPlaybackRateToast()

      syncPlayPauseControlIcons()

      sleepTimer.resumeCountdown()
      startSponsorBlockHighlightLabelCountdown()
      scheduleSponsorBlockSkip()
      scheduleAbRepeatBoundary()

      tabMediaCoordinator.setPlaybackState(mediaTabId, 'playing')

      updateAutoPip()
      updateScrollMiniPlayer()

      if (scrollMiniPlayerActive.value) {
        showScrollMiniPlayPause(true)
      }

      emit('play')
    }

    function handlePlaying() {
      hasPlaybackPosition.value = true
      // Chromium can briefly paint a video's poster across the compositor
      // surface while detaching it into native PiP on Windows. Once a real
      // frame is available the poster is no longer needed, so remove it before
      // a later blur-triggered PiP transition.
      showPoster.value = false
      startPaidPromotionTimer()

      if (process.env.IS_ELECTRON && window.ftElectron?.tabs?.setPlaybackState) {
        window.ftElectron.tabs.setPlaybackState('playing', tabId)
      }
    }

    function handleWaiting() {
      if (process.env.IS_ELECTRON && window.ftElectron?.tabs?.setPlaybackState) {
        window.ftElectron.tabs.setPlaybackState('paused', tabId)
      }
    }

    function handlePause() {
      if (!preserveControlsOnTemporaryPause) setShowUiOnPaused(true)
      preserveControlsOnTemporaryPause = false
      playerPaused.value = true
      clearPausedInterfaceReveal()
      shortsPaused.value = true
      syncPlayPauseControlIcons()

      sleepTimer.pauseCountdown()
      pauseSponsorBlockHighlightLabelCountdown()
      cancelSponsorBlockSkipSchedule()
      clearAbRepeatBoundarySchedule()

      tabMediaCoordinator.setPlaybackState(
        mediaTabId,
        mediaSessionStopped ? 'none' : 'paused'
      )

      if (process.env.IS_ELECTRON && window.ftElectron?.tabs?.setPlaybackState) {
        window.ftElectron.tabs.setPlaybackState('paused', tabId)
      }

      updateAutoPip()
      updateScrollMiniPlayer()

      if (scrollMiniPlayerActive.value) {
        showScrollMiniPlayPause(false)
      }

      emit('pause')
    }

    function handleEnded() {
      if (abRepeatEnabled.value && hasValidAbRepeatRange()) {
        repeatAbRangeFromStart()
        video.value.play()
        return
      }

      setShowUiOnPaused(true)
      shortsPaused.value = true
      shortsEnded.value = true
      syncPlayPauseControlIcons()

      if (isCapacitorMobilePlayer()) {
        showOverlayControls()
      }

      sleepTimer.pauseCountdown()
      const sleepTimerEnded = sleepTimer.consumeEndOfVideo()

      pauseSponsorBlockHighlightLabelCountdown()
      cancelSponsorBlockSkipSchedule()
      promptSponsorBlockSegments.value = []
      clearAbRepeatBoundarySchedule()

      tabMediaCoordinator.setPlaybackState(mediaTabId, 'none')

      if (process.env.IS_ELECTRON && window.ftElectron?.tabs?.setPlaybackState) {
        window.ftElectron.tabs.setPlaybackState('none', tabId)
      }

      updateAutoPip()

      if (scrollMiniPlayerActive.value) {
        deactivateScrollMiniPlayer()
      }

      emit('ended', sleepTimerEnded)
    }

    function handleSeeking() {
      hasPlaybackPosition.value = true
      shortsEnded.value = false
      cancelSponsorBlockSkipSchedule()
      clearAbRepeatBoundarySchedule()
      syncPlayPauseControlIcons()
      emit('seeking')
    }

    function handleAbRepeatSeeked() {
      checkAbRepeatBoundary()
    }

    function applyPendingPresentationModes() {
      if (!isActiveTab.value || !ui) {
        return
      }

      if (startInFullwindow && fullWindowListenerReady) {
        startInFullwindow = false
        events.dispatchEvent(new CustomEvent('setFullWindow', { detail: true }))
      }

      if (startInFullscreen && hasLoaded.value && process.env.IS_ELECTRON) {
        startInFullscreen = false
        window.ftElectron.requestFullscreen(tabId)
      }

      if (
        startInPip &&
        props.format !== 'audio' &&
        video.value?.readyState >= HTMLMediaElement.HAVE_METADATA &&
        ui.getControls().isPiPAllowed() &&
        process.env.IS_ELECTRON
      ) {
        startInPip = false
        restorePictureInPicture(props.autoPictureInPictureState?.autoPipActive === true)
      }
    }

    function handleCanPlay() {
      // PiP can only be activated once the video's readyState and video track are populated.
      applyPendingPresentationModes()

      // Re-evaluate auto-PiP now that PiP is actually allowed (the video was possibly
      // in a hidden tab / scrolled out of view while still loading).
      updateAutoPip()
      updateAnnotationVideoAspectRatio()
      updateScrollMiniVideoAspectRatio()
      updateScrollMiniPlayer()
      videoLayoutReady.value = true

      if (isActiveTab.value && isNativeFullscreenActive()) {
        setFullscreenOrientation(
          true,
          video.value,
          rotateFullscreenToLandscape.value && !player?.nativePlayback?.isFullscreenFromRotation()
        ).catch(() => {})
      }
    }

    let volumeUserSetTimer = null

    // Dragging the volume slider fires a continuous stream of events,
    // so wait for the user to settle on a volume before persisting it
    function emitVolumeUserSet(volume) {
      clearTimeout(volumeUserSetTimer)
      volumeUserSetTimer = setTimeout(() => {
        volumeUserSetTimer = null
        emit('volume-user-set', volume)
      }, 500)
    }

    function cancelPendingVolumeUserSet() {
      clearTimeout(volumeUserSetTimer)
      volumeUserSetTimer = null
    }

    function updateVolume() {
      const video_ = video.value
      const muted = video_.muted || video_.volume === 0
      shortsMuted.value = muted
      scrollMiniVolume.value = muted ? 0 : video_.volume

      syncMuteControlIcons(muted)

      if (showStats.value) {
        stats.volume = (video_.volume * 100).toFixed(1)
      }

      const sponsorBlockVolumeChange = sponsorBlockMuteController.handleVolumeChange()
      skippedSponsorBlockSegments.value
        .filter(segment => segment.isMute)
        .forEach(segment => {
          segment.unskipped = !video_.muted
        })
      if (applyingInitialVolume || sponsorBlockVolumeChange) {
        return
      }

      if (isCapacitorMobilePlayer()) return

      const volume = video_.muted ? 0 : video_.volume
      emit('volume-updated', volume)
      emitVolumeUserSet(volume)

      if (!rememberVolume.value) {
        return
      }

      const remembered = getRememberedPlayerVolume()

      // https://docs.videojs.com/html5#volume
      if (remembered !== null && !remembered.muted && video_.volume === 0) {
        // If video is muted by dragging volume slider, it doesn't change 'muted' to true
        // hence compare it with the last remembered unmuted state and restore default volume.
        setRememberedPlayerVolume(defaultVolume.value, true)
      } else {
        setRememberedPlayerVolume(video_.volume, video_.muted)
      }
    }

    /**
     * @param {HTMLVideoElement} videoElement
     */
    function applyInitialVolume(videoElement) {
      applyingInitialVolume = true

      if (isCapacitorMobilePlayer()) {
        videoElement.volume = 1
        videoElement.muted = false
        applyingInitialVolume = false
        emit('volume-updated', 1)
        return
      }

      // The channel's volume is more specific than the globally remembered one, so it wins
      if (savedChannelVolume.value !== null) {
        videoElement.volume = savedChannelVolume.value
        videoElement.muted = savedChannelVolume.value === 0
      } else if (rememberVolume.value) {
        const remembered = getRememberedPlayerVolume()

        if (remembered !== null) {
          videoElement.volume = remembered.volume
          videoElement.muted = remembered.muted
        } else {
          videoElement.volume = defaultVolume.value
          videoElement.muted = defaultVolume.value === 0
        }
      } else {
        videoElement.volume = defaultVolume.value
        videoElement.muted = defaultVolume.value === 0
      }

      applyingInitialVolume = false
      emit('volume-updated', videoElement.muted ? 0 : videoElement.volume)
    }

    function handleTimeupdate() {
      if (video.value) {
        checkAbRepeatBoundary()
        const currentTime = video.value.currentTime
        sponsorBlockCurrentTime.value = currentTime
        annotationCurrentTime.value = currentTime
        updateHiddenShortsSeekBar(currentTime)

        emit('timeupdate', currentTime)
        emitTerminalSponsorBlockOutroStarted(currentTime)
        syncMediaSessionPosition()

        if (showStats.value && hasLoaded.value) {
          updateStats()
        }

        handleSponsorBlockPreviewSkip(currentTime)

        if (useSponsorBlock.value && sponsorBlockSegments.length > 0 && canSeek()) {
          syncPromptSponsorBlockSegments(currentTime)
          updateSponsorBlockHighlightState(currentTime)
          syncSponsorBlockMuteSegments(currentTime, !props.sponsorBlockAutoSkipDisabled)

          if (!props.sponsorBlockAutoSkipDisabled) {
            skipSponsorBlockSegments(currentTime)
            scheduleSponsorBlockSkip()
          }
        } else {
          sponsorBlockMuteController.setSourceActive('segments', false)
        }

        updateScrollMiniDragHandleContrast()
      }
    }

    function syncMediaSessionPosition() {
      const videoElement = video.value
      if (
        !videoElement ||
        !Number.isFinite(videoElement.duration) ||
        videoElement.duration <= 0 ||
        !Number.isFinite(videoElement.currentTime)
      ) {
        return
      }

      tabMediaCoordinator.setPositionState(
        mediaTabId,
        {
          duration: videoElement.duration,
          position: Math.min(videoElement.duration, Math.max(0, videoElement.currentTime)),
          playbackRate: videoElement.playbackRate,
        },
        mediaSessionStopped ? 'none' : videoElement.paused ? 'paused' : 'playing'
      )
    }

    /**
     * Shaka stops refreshing its seek bar while its controls are hidden, but
     * Shorts keep the seek bar visible. Keep that visible progress in sync
     * without interfering while Shaka is showing or operating the controls.
     * @param {number} currentTime
     */
    function updateHiddenShortsSeekBar(currentTime) {
      const controls = ui?.getControls()
      if (!props.shortsPlayer || !hasLoaded.value || !player || !controls ||
          controls.getControlsContainer().hasAttribute('shown') || controls.isSeeking()) {
        return
      }

      const seekBarContainer = container.value?.querySelector('.shaka-seek-bar-container')
      const seekBar = seekBarContainer?.querySelector('.shaka-seek-bar')
      if (!(seekBarContainer instanceof HTMLElement) || !(seekBar instanceof HTMLInputElement)) {
        return
      }

      const seekRange = player.seekRange()
      const seekRangeSize = seekRange.end - seekRange.start
      if (seekRangeSize <= 0) {
        return
      }

      const clampedCurrentTime = Math.min(Math.max(currentTime, seekRange.start), seekRange.end)
      const buffered = video.value.buffered
      const bufferedEnd = buffered.length > 0
        ? Math.min(buffered.end(buffered.length - 1), seekRange.end)
        : clampedCurrentTime
      const playedPercent = (clampedCurrentTime - seekRange.start) / seekRangeSize * 100
      const bufferedPercent = Math.max(
        playedPercent,
        (bufferedEnd - seekRange.start) / seekRangeSize * 100
      )
      const colors = ui.getConfiguration().seekBarColors
      const gradient = [
        'to right',
        `${colors.played} 0%`,
        `${colors.played} ${playedPercent}%`,
        `${colors.buffered} ${playedPercent}%`,
        `${colors.buffered} ${bufferedPercent}%`,
        `${colors.base} ${bufferedPercent}%`,
        `${colors.base} 100%`,
      ]

      seekBar.min = seekRange.start.toString()
      seekBar.max = seekRange.end.toString()
      seekBar.value = clampedCurrentTime.toString()
      seekBarContainer.style.background = `linear-gradient(${gradient.join(', ')})`
    }

    /**
     * @param {number} currentTime
     */
    function emitTerminalSponsorBlockOutroStarted(currentTime) {
      if (terminalSponsorBlockOutroStarted || video.value?.paused || !useSponsorBlock.value) {
        return
      }

      const videoDuration = getSponsorBlockSubmissionVideoDuration()
      if (!Number.isFinite(videoDuration)) {
        return
      }

      const terminalOutro = sponsorBlockSegments.find(segment =>
        segment.category === 'outro' &&
        Math.abs(segment.endTime - videoDuration) <= SPONSORBLOCK_TERMINAL_OUTRO_TOLERANCE_SECONDS &&
        currentTime >= segment.startTime &&
        currentTime <= segment.endTime
      )

      if (terminalOutro) {
        terminalSponsorBlockOutroStarted = true
        emit('terminal-outro-started', currentTime)
      }
    }

    const videoElementWidth = ref(0)
    const videoElementHeight = ref(0)
    /** Height of the video element in CSS pixels, used to scale the captions with the player. */
    const videoElementLayoutHeight = ref(0)
    const pictureInPictureActive = ref(false)

    const captionPlayerVariables = computed(() => {
      return getCaptionPlayerVariables(videoElementLayoutHeight.value)
    })

    function updateAnnotationVideoAspectRatio() {
      const video_ = video.value

      annotationVideoAspectRatio.value = video_?.videoWidth > 0 && video_.videoHeight > 0
        ? video_.videoWidth / video_.videoHeight
        : null
    }
    const {
      deactivateScrollMiniPlayer,
      dismissCrossTabMiniPlayer,
      handleFullscreenButtonClick,
      handleScrollMiniControlsPointerMove,
      handleScrollMiniDragPointerDown,
      handleScrollMiniPlayerEnter,
      handleScrollMiniPlayerLeave,
      handleScrollMiniPlayPauseMouseEnter,
      handleScrollMiniResizePointerDown,
      handleScrollMiniVolumeMouseEnter,
      handleScrollMiniVolumeMouseLeave,
      handleScrollMiniVolumePointerDown,
      handleScrollMiniWindowResize,
      handleScrollMiniWindowScroll,
      isNativeFullscreenActive,
      rememberInlinePlayerLayoutHeight,
      repairScrollMiniPlaceholderHeight,
      scrollMiniAnchor,
      scrollMiniDragHandleOnLightBg,
      scrollMiniIsPaused,
      scrollMiniPlaceholder,
      scrollMiniPlaceholderHeight,
      scrollMiniPlayerActive,
      scrollMiniPlayerAnimating,
      scrollMiniPlayerDetached,
      scrollMiniPlayerDismissed,
      scrollMiniPlayerStyle,
      scrollMiniPlayerStashed,
      scrollMiniPlayerStashedSide,
      scrollMiniPlayPauseVisible,
      scrollMiniResizeCorner,
      scrollMiniResizeHandleOnLightBg,
      scrollMiniScrollToTop,
      scrollMiniTogglePlayPause,
      restoreStashedScrollMiniPlayer,
      scrollMiniVolume,
      scrollMiniVolumeExpanded,
      scrollMiniVolumeIcon,
      scrollMiniVolumePercent,
      scrollMiniVolumeTrack,
      setupScrollMiniIntersectionObserver,
      showScrollMiniPlayPause,
      suppressScrollMiniPlayPausePointerReveal,
      teardownScrollMiniPlayer,
      togglePlayerFullScreen,
      updateScrollMiniDragHandleContrast,
      updateScrollMiniPlayer,
      updateScrollMiniVideoAspectRatio,
      updateScrollMiniVolume,
    } = useScrollMiniPlayer({
      container,
      fullWindowEnabled,
      getUi: () => ui,
      isActiveTab,
      pictureInPictureActive,
      props,
      tabId,
      video,
    })

    watch(scrollMiniPlayerDetached, (detached) => {
      isCrossTabMiniPlayerPresented.value = detached
      tabMediaCoordinator.setMiniPlayer(mediaTabId, detached)
    }, { immediate: true })

    watch([isActiveTab, isCrossTabMiniPlayerPresented, scrollMiniPlayerDismissed, audioPlayerMode], () => {
      screenWakeBinding?.update()
    })

    // Logical tabs restore their saved scroll position after becoming active.
    // Refresh once that restoration is complete so an already-active mini player
    // is placed directly at its saved bounds instead of replaying its entrance.
    useTabLifecycle({
      activate: () => updateScrollMiniPlayer({ animateActivation: false })
    })

    const ambientModeVisible = computed(() => {
      return isActiveTab.value &&
        ambientMode.value &&
        props.format !== 'audio' &&
        props.vrProjection !== 'EQUIRECTANGULAR' &&
        !scrollMiniPlayerActive.value
    })

    const musicVisualizerActive = computed(() => {
      return musicVisualizerEnabled.value &&
        isActiveTab.value &&
        !scrollMiniPlayerActive.value &&
        !playerPaused.value
    })

    const { musicVisualizerCanvas } = useMusicVisualizer({
      active: musicVisualizerActive,
      video,
      sourceKey: () => `${props.videoId}:${props.playbackSourceKey}`,
    })

    const fullscreenAmbientBarsVisible = computed(() => {
      const contentAspectRatio = annotationVideoAspectRatio.value
      const elementWidth = videoElementWidth.value
      const elementHeight = videoElementHeight.value

      if (!isFullscreen.value || contentAspectRatio === null ||
        elementWidth === 0 || elementHeight === 0) {
        return false
      }

      const fittedWidth = Math.min(elementWidth, elementHeight * contentAspectRatio)
      const fittedHeight = Math.min(elementHeight, elementWidth / contentAspectRatio)
      const minimumBarSize = 1

      return elementWidth - fittedWidth > minimumBarSize ||
        elementHeight - fittedHeight > minimumBarSize
    })

    const { ambientCanvas, ambientFullscreenCanvas, ambientLayoutCanvas } = useAmbientMode({
      enabled: ambientModeVisible,
      video,
    })

    function updateVideoElementGeometry() {
      if (video.value) {
        const devicePixelRatio = window.devicePixelRatio > 1 ? window.devicePixelRatio : 1
        const video_ = video.value

        videoElementWidth.value = video_.clientWidth * devicePixelRatio
        videoElementHeight.value = video_.clientHeight * devicePixelRatio
        videoElementLayoutHeight.value = video_.clientHeight
        updateAnnotationVideoAspectRatio()
        updateScrollMiniVideoAspectRatio()
      }
    }

    /** @type {ResizeObserver} */
    const videoResizeObserver = new ResizeObserver(updateVideoElementGeometry)

    /** @type {PictureInPictureWindow | null} */
    let pipWindow = null
    const pipWindowWidth = ref(null)
    const pipWindowHeight = ref(null)

    /**
     * @param {PictureInPictureEvent} event
     */
    function handleEnterPictureInPicture(event) {
      pictureInPictureActive.value = true
      pipWindow = event.pictureInPictureWindow
      tabMediaCoordinator.setPictureInPicture(mediaTabId, true)
      handlePictureInPictureResize()
      pipWindow.addEventListener('resize', handlePictureInPictureResize)

      if (scrollMiniPlayerActive.value) {
        deactivateScrollMiniPlayer()
      }

      notifyPictureInPictureState(true)
      syncPipToggleState(true)
    }

    function handleLeavePictureInPicture() {
      pictureInPictureActive.value = false
      tabMediaCoordinator.setPictureInPicture(mediaTabId, false)

      if (pipWindow) {
        pipWindow.removeEventListener('resize', handlePictureInPictureResize)
      }

      pipWindow = null
      pipWindowWidth.value = null
      pipWindowHeight.value = null

      notifyPictureInPictureState(false)
      syncPipToggleState(false)

      updateScrollMiniPlayer()
    }

    function handlePictureInPictureResize() {
      const devicePixelRatio = window.devicePixelRatio > 1 ? window.devicePixelRatio : 1

      pipWindowWidth.value = pipWindow.width * devicePixelRatio
      pipWindowHeight.value = pipWindow.height * devicePixelRatio
    }

    function clearDisplayedCaptions() {
      const textContainer = container.value?.getElementsByClassName('shaka-text-container')[0]

      if (textContainer instanceof HTMLElement) {
        textContainer.replaceChildren()
      }
    }

    function wrapTextTrackSelection() {
      const selectTextTrack = player.selectTextTrack.bind(player)

      // Shaka's own UI only passes the track, so anything without `isUserAction`
      // is a selection the user made themselves
      player.selectTextTrack = (track = null, isUserAction = true) => {
        const activeTextTrack = player.getTextTracks().find(textTrack => textTrack.active)

        if (isUserAction) {
          emit('subtitles-state-user-set', track !== null)
        }

        if (track === null) {
          clearDisplayedCaptions()
        } else {
          lastSelectedCaptionTrack = track

          if (activeTextTrack && activeTextTrack.id !== track.id) {
            selectTextTrack(null)
            clearDisplayedCaptions()
          }
        }

        selectTextTrack(track)
        emit('subtitles-state-updated', track !== null)
      }
    }

    const playerWidth = computed(() => Math.round(pipWindowWidth.value ?? videoElementWidth.value))
    const playerHeight = computed(() => Math.round(pipWindowHeight.value ?? videoElementHeight.value))
    const compactAutoplayLayout = computed(() => playerHeight.value > 0 && playerHeight.value <= 440)
    const tinyAutoplayLayout = computed(() => playerWidth.value > 0 && playerWidth.value <= 360)

    // #endregion video event handlers

    // #region SABR

    /** @type {shaka.extern.Manifest | undefined} */
    let sabrManifest

    /** @type {import('../../helpers/player/SabrSchemePlugin').SabrStream | undefined} */
    let sabrStream
    /** @type {AbortController | undefined} */
    let sabrAbortController

    const sabrBackoffRemainingMs = ref(0)
    const sabrBackoffDurationMs = ref(0)
    /** @type {number|null} */
    let sabrBackoffIntervalId = null

    const preRollRemainingMs = ref(0)
    const preRollDurationMs = ref(0)
    /** @type {number|null} */
    let preRollIntervalId = null

    const countdownRemainingMs = computed(() => sabrBackoffRemainingMs.value || preRollRemainingMs.value)
    const countdownDurationMs = computed(() => sabrBackoffRemainingMs.value > 0 ? sabrBackoffDurationMs.value : preRollDurationMs.value)
    const showCountdownOverlay = computed(() => countdownRemainingMs.value > 0)
    const countdownTimeSeconds = computed(() => +(countdownRemainingMs.value / 1000).toFixed(1))
    const countdownTimeLabel = computed(() => `${countdownTimeSeconds.value}s`)
    const countdownAriaLabel = computed(() => {
      if (sabrBackoffRemainingMs.value > 0) {
        return t('Video.Watch.Remaining SABR backoff time: {remindingTimeSeconds}s', { remindingTimeSeconds: countdownTimeSeconds.value })
      }

      return t('Video.Watch.Remaining preroll-ad time: {remindingTimeSeconds}s', { remindingTimeSeconds: countdownTimeSeconds.value })
    })
    const COUNTDOWN_RING_RADIUS = 38
    const countdownRingCircumference = 2 * Math.PI * COUNTDOWN_RING_RADIUS
    const countdownRingDashoffset = computed(() => {
      if (countdownDurationMs.value <= 0) {
        return countdownRingCircumference
      }

      const progress = 1 - (countdownRemainingMs.value / countdownDurationMs.value)
      const clampedProgress = Math.min(1, Math.max(0, progress))
      return countdownRingCircumference * (1 - clampedProgress)
    })

    function requestTabPreviewRefresh(delayMs = SABR_BACKOFF_PREVIEW_REFRESH_DELAY_MS) {
      if (
        !process.env.IS_ELECTRON ||
        typeof window.ftElectron?.tabs?.requestPreviewRefresh !== 'function'
      ) {
        return
      }

      window.ftElectron.tabs.requestPreviewRefresh({ tabId, delayMs })
    }

    function clearSabrBackoffTimer({ refreshPreview = false } = {}) {
      if (sabrBackoffIntervalId !== null) {
        clearInterval(sabrBackoffIntervalId)
        sabrBackoffIntervalId = null
      }

      sabrBackoffRemainingMs.value = 0
      sabrBackoffDurationMs.value = 0

      if (refreshPreview) {
        requestTabPreviewRefresh()
      }
    }

    function clearPreRollTimer() {
      if (preRollIntervalId !== null) {
        clearInterval(preRollIntervalId)
        preRollIntervalId = null
      }

      preRollRemainingMs.value = 0
      preRollDurationMs.value = 0
    }

    function startSabrBackoffTimer(backoffMs) {
      if (backoffMs <= 0) {
        clearSabrBackoffTimer({ refreshPreview: true })
        return
      }

      const endsAt = Date.now() + backoffMs
      sabrBackoffDurationMs.value = backoffMs

      const updateRemainingMs = () => {
        const remainingMs = Math.max(0, endsAt - Date.now())
        sabrBackoffRemainingMs.value = remainingMs

        if (remainingMs === 0) {
          clearSabrBackoffTimer({ refreshPreview: true })
        }
      }

      if (sabrBackoffIntervalId !== null) {
        clearInterval(sabrBackoffIntervalId)
      }

      updateRemainingMs()
      requestTabPreviewRefresh()
      sabrBackoffIntervalId = setInterval(updateRemainingMs, 100)
    }

    function startPreRollTimer(delayMs) {
      if (delayMs <= 0) {
        clearPreRollTimer()
        return
      }

      const endsAt = Date.now() + delayMs
      preRollDurationMs.value = delayMs

      const updateRemainingMs = () => {
        const remainingMs = Math.max(0, endsAt - Date.now())
        preRollRemainingMs.value = remainingMs

        if (remainingMs === 0) {
          clearPreRollTimer()
        }
      }

      if (preRollIntervalId !== null) {
        clearInterval(preRollIntervalId)
      }

      updateRemainingMs()
      preRollIntervalId = setInterval(updateRemainingMs, 100)
    }

    function ensureSabrStream() {
      if (process.env.IS_CAPACITOR || !process.env.SUPPORTS_LOCAL_API || sabrStream || !props.sabrData) return

      sabrStream = /** @__NOINLINE__ */ setupSabrScheme(props.sabrData, () => player, () => sabrManifest, playerWidth, playerHeight)
      sabrAbortController = new AbortController()
      sabrStream.onBackoffRequested(({ backoffMs }) => {
        startSabrBackoffTimer(backoffMs)
      })
      sabrStream.onReloadOnce(() => {
        sabrAbortController.abort()
        clearSabrBackoffTimer()
        emit('player-reload-requested', getSabrReloadState())
      })
    }

    ensureSabrStream()

    // #endregion SABR

    // #region request/response filters

    /** @type {shaka.extern.RequestFilter} */
    function requestFilter(type, request, _context) {
      if (type === RequestType.SEGMENT) {
        const url = new URL(request.uris[0])
        const isSabrRequest = props.sabrData && url.protocol === `${props.sabrData.scheme}:`

        prepareGoogleVideoRequest(request, isSabrRequest)
      }
    }

    /** @type {shaka.extern.ResponseFilter} */
    async function responseFilter(type, response, context) {
      if (type === RequestType.SEGMENT) {
        const url = new URL(response.uri)

        if (props.sabrData && url.protocol === `${props.sabrData.scheme}:`) {
          return
        }

        if (response.data && response.data.byteLength > 4 &&
          new DataView(response.data).getUint32(0) === HTTP_IN_HEX) {
          // Interpret the response data as a URL string.
          const responseAsString = shaka.util.StringUtils.fromUTF8(response.data)

          const retryParameters = player.getConfiguration().streaming.retryParameters

          // Make another request for the redirect URL.
          const uris = [responseAsString]
          const redirectRequest = shaka.net.NetworkingEngine.makeRequest(uris, retryParameters)
          const requestOperation = player.getNetworkingEngine().request(type, redirectRequest, context)
          const redirectResponse = await requestOperation.promise

          // Modify the original response to contain the results of the redirect
          // response.
          response.data = redirectResponse.data
          response.headers = redirectResponse.headers
          response.uri = redirectResponse.uri
        } else {
          // Fix positioning for auto-generated subtitles
          if (url.hostname.endsWith('.youtube.com') && url.pathname === '/api/timedtext' &&
            url.searchParams.get('caps') === 'asr' && url.searchParams.get('kind') === 'asr' && url.searchParams.get('fmt') === 'vtt') {
            const stringBody = new TextDecoder().decode(response.data)
            // position:0% for LTR text and position:100% for RTL text
            const cleaned = stringBody.replaceAll(/ align:start position:(?:10)?0%$/gm, '')

            response.data = new TextEncoder().encode(cleaned).buffer
          }
        }
      } else if (type === RequestType.MANIFEST && context.type === AdvancedRequestType.MASTER_PLAYLIST) {
        const manifest = new TextDecoder().decode(response.data)
        response.data = new TextEncoder().encode(preferOriginalHlsAudio(manifest)).buffer
      } else if (type === RequestType.MANIFEST && context.type === AdvancedRequestType.MEDIA_PLAYLIST) {
        const url = new URL(response.uri)

        let modifiedText

        // Fixes proxied HLS manifests, as Invidious replaces the path parameters with query parameters,
        // so shaka-player isn't able to infer the mime type from the `/file/seg.ts` part like it does for non-proxied HLS manifests.
        // Shaka-player does attempt to detect it with HEAD request but the `Content-Type` header is `application/octet-stream`,
        // which still doesn't tell shaka-player how to handle the stream because that's the equivalent of saying "binary data".
        if (url.searchParams.has('local')) {
          const stringBody = new TextDecoder().decode(response.data)

          modifiedText = stringBody.replaceAll(/https?:\/\/.+$/gm, hlsProxiedUrlReplacer)
        }

        // The audio-only streams are actually raw AAC, so correct the file extension from `.ts` to `.aac`
        if (/\/itag\/23[34]\//.test(url.pathname) || url.searchParams.get('itag') === '233' || url.searchParams.get('itag') === '234') {
          if (!modifiedText) {
            modifiedText = new TextDecoder().decode(response.data)
          }

          modifiedText = modifiedText.replaceAll('/file/seg.ts', '/file/seg.aac')
        }

        if (modifiedText) {
          response.data = new TextEncoder().encode(modifiedText).buffer
        }
      }
    }

    /**
     * @param {string} match
     */
    function hlsProxiedUrlReplacer(match) {
      const url = new URL(match)

      let fileValue
      for (const [key, value] of url.searchParams) {
        if (key === 'file') {
          fileValue = value
          continue
        } else if (key === 'hls_chunk_host') {
          // Add the host parameter so some Invidious instances stop complaining about the missing host parameter
          // Replace .c.youtube.com with .googlevideo.com as the built-in Invidious video proxy only accepts host parameters with googlevideo.com
          url.pathname += `/host/${encodeURIComponent(value.replace('.c.youtube.com', '.googlevideo.com'))}`
        }

        url.pathname += `/${key}/${encodeURIComponent(value)}`
      }

      // This has to be right at the end so that shaka-player can read the file extension
      url.pathname += `/file/${encodeURIComponent(fileValue)}`

      url.search = ''
      return url.toString()
    }

    // #endregion request/response filters

    // #region set quality

    /**
     * @param {number | undefined} width
     * @param {number | undefined} height
     * @returns {string | null}
     */
    function getQualityFromDimensions(width, height) {
      if (typeof width !== 'number' || typeof height !== 'number') {
        return null
      }

      return `${height > width ? width : height}`
    }

    /**
     * @returns {string | null}
     */
    function getActiveVariantQuality() {
      const activeVariant = player?.getVariantTracks().find(track => track.active)

      if (!activeVariant) {
        return null
      }

      const quality = getDashQualityFromDimensions(activeVariant.width, activeVariant.height)
      return quality === null ? null : `${quality}`
    }

    /**
     * @param {number} quality
     * @param {number | undefined} audioBandwidth
     * @param {string | undefined} label
     */
    function setDashQuality(quality, audioBandwidth, label) {
      let variants = player.getVariantTracks()

      if (label) {
        variants = variants.filter(variant => variant.label === label)
      } else if (hasMultipleAudioTracks.value) {
        variants = getDefaultAudioVariants(variants)
      }

      const isPortrait = variants[0].height > variants[0].width

      let matches = variants.filter(variant => {
        return quality === getDashQualityFromDimensions(variant.width, variant.height)
      })

      if (matches.length === 0) {
        matches = variants.filter(variant => {
          return quality > (isPortrait ? variant.width : variant.height)
        })
      }

      matches.sort((a, b) => isPortrait ? b.width - a.width : b.height - a.height)

      let chosenVariant

      if (typeof audioBandwidth === 'number') {
        const width = matches[0].width
        const height = matches[0].height

        matches = matches.filter(variant => variant.width === width && variant.height === height)

        chosenVariant = findMostSimilarAudioBandwidth(matches, audioBandwidth)
      } else {
        chosenVariant = matches[0]
      }

      player.selectVariantTrack(chosenVariant)
    }

    /**
     * @param {number|null} playbackPosition
     * @param {number|undefined} previousQuality
     * @param {number|null|undefined} playbackRate
     */
    async function setLegacyQuality(playbackPosition = null, previousQuality = undefined, playbackRate = undefined) {
      if (typeof previousQuality === 'undefined') {
        previousQuality = preferredVideoQuality.value
      }

      if (props.legacyFormats.length === 0) { return }

      const format = findLegacyFormatForQuality(props.legacyFormats, previousQuality)

      hasMultipleAudioTracks.value = false

      events.dispatchEvent(new CustomEvent('setLegacyFormat', {
        detail: {
          format,
          playbackPosition,
          playbackRate
        }
      }))
    }

    // #endregion set quality

    // #region stats

    function gatherInitialStatsValues() {
      /** @type {HTMLVideoElement} */
      const video_ = video.value

      stats.volume = (video_.volume * 100).toFixed(1)

      if (props.format === 'legacy') {
        updateLegacyQualityStats(activeLegacyFormat.value)
      }

      if (!hasLoaded.value) {
        player.addEventListener('loaded', () => {
          if (showStats.value) {
            if (props.format !== 'legacy') {
              updateQualityStats({
                newTrack: player.getVariantTracks().find(track => track.active)
              })
            }

            updateStats()
          }
        }, {
          once: true
        })

        return
      }

      if (props.format !== 'legacy') {
        updateQualityStats({
          newTrack: player.getVariantTracks().find(track => track.active)
        })
      }

      updateStats()
    }

    /**
     * @param {{
     *   type: ('adaptation'|'variantchanged'),
     *   newTrack: shaka.extern.Track,
     *   oldTrack: shaka.extern.Track
     * }} track
     */
    function updateQualityStats({ newTrack }) {
      if (!showStats.value || props.format === 'legacy') {
        return
      }

      stats.bitrate = (newTrack.bandwidth / 1000).toFixed(2)

      // Combined audio and video HLS streams
      if (newTrack.videoCodec?.includes(',')) {
        stats.codecs.audioItag = ''
        stats.codecs.videoItag = ''

        const [audioCodec, videoCodec] = newTrack.videoCodec.split(',')

        stats.codecs.audioCodec = audioCodec
        stats.codecs.videoCodec = videoCodec

        stats.resolution.frameRate = newTrack.frameRate
        stats.resolution.width = newTrack.width
        stats.resolution.height = newTrack.height
      } else {
        stats.codecs.audioItag = newTrack.originalAudioId.split('-', 1)[0]
        stats.codecs.audioCodec = newTrack.audioCodec

        if (props.format === 'dash') {
          stats.resolution.frameRate = newTrack.frameRate

          stats.codecs.videoItag = newTrack.originalVideoId.split('-', 1)[0]
          stats.codecs.videoCodec = newTrack.videoCodec

          stats.resolution.width = newTrack.width
          stats.resolution.height = newTrack.height
        }
      }
    }

    function updateLegacyQualityStats(newFormat) {
      if (!showStats.value || props.format !== 'legacy') {
        return
      }

      const { fps, bitrate, mimeType, itag, width, height } = newFormat

      const codecsMatch = mimeType.match(/codecs="(?<videoCodec>.+), ?(?<audioCodec>.+)"/)

      stats.codecs.audioItag = itag
      stats.codecs.audioCodec = codecsMatch.groups.audioCodec

      stats.codecs.videoItag = itag
      stats.codecs.videoCodec = codecsMatch.groups.videoCodec

      stats.resolution.frameRate = fps

      stats.bitrate = (bitrate / 1000).toFixed(2)

      stats.resolution.width = width
      stats.resolution.height = height
    }

    function updateStats() {
      const playerStats = player.getStats()

      if (props.format !== 'audio') {
        stats.frames = {
          droppedFrames: playerStats.droppedFrames,
          totalFrames: playerStats.decodedFrames
        }
      }

      if (props.format !== 'legacy') {
        // estimated bandwidth is NaN for legacy, as none of the requests go through shaka,
        // so it has no way to estimate the bandwidth
        stats.bandwidth = (playerStats.estimatedBandwidth / 1000).toFixed(2)
      }

      let bufferedSeconds = 0

      const buffered = player.getBufferedInfo().total

      for (const { start, end } of buffered) {
        bufferedSeconds += end - start
      }

      const seekRange = player.seekRange()
      const duration = seekRange.end - seekRange.start

      stats.buffered = ((bufferedSeconds / duration) * 100).toFixed(2)
    }

    watch(showStats, (newValue) => {
      if (newValue) {
        // for abr changes/auto quality
        player.addEventListener('adaptation', updateQualityStats)

        // for manual changes e.g. in quality selector
        player.addEventListener('variantchanged', updateQualityStats)
      } else {
        // for abr changes/auto quality
        player.removeEventListener('adaptation', updateQualityStats)

        // for manual changes e.g. in quality selector
        player.removeEventListener('variantchanged', updateQualityStats)
      }
    })

    watch(activeLegacyFormat, updateLegacyQualityStats)

    // #endregion stats

    // #region screenshots

    async function takeScreenshot() {
      const video_ = video.value

      const width = video_.videoWidth
      const height = video_.videoHeight

      if (width <= 0) {
        return
      }

      // Need to set crossorigin="anonymous" for LegacyFormat on Invidious
      // https://developer.mozilla.org/en-US/docs/Web/HTML/CORS_enabled_image
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      try {
        canvas.getContext('2d').drawImage(await capturePlayerFrame(video_, width, height), 0, 0)
      } catch (error) {
        showToast({ message: t('Screenshot Error', { error: error.message }), icon: ['fas', 'circle-exclamation'] })
        return
      }

      // Navigator Clipboard API only supports PNG
      const format = screenshotMode.value === 'clipboard' ? 'png' : screenshotFormat.value
      const mimeType = `image/${format === 'jpg' ? 'jpeg' : format}`
      // imageQuality is ignored for pngs, so it is still okay to pass the quality value
      const imageQuality = screenshotQuality.value / 100

      const wasPlaying = !video_.paused
      if ((!process.env.IS_ELECTRON || screenshotMode.value === 'prompt_folder') && wasPlaying) {
        video_.pause()
      }

      try {
        /** @type {Blob} */
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, imageQuality))

        if (screenshotMode.value === 'clipboard') {
          await copyToClipboard(blob, { messageOnSuccess: t('Screenshot Clipboard Success'), messageOnError: t('Screenshot Clipboard Error') })
        } else if (screenshotMode.value === 'prompt_folder' || screenshotMode.value === 'default_folder') {
          let filename
          try {
            filename = await store.dispatch('parseScreenshotCustomFileName', {
              date: new Date(),
              playerTime: video_.currentTime,
              videoId: props.videoId
            })
          } catch (err) {
            console.error(`Parse failed: ${err.message}`)
            showToast({ message: t('Screenshot Error', { error: err.message }), icon: ['fas', 'circle-exclamation'] })
            canvas.remove()
            return
          }

          const filenameWithExtension = `${filename}.${format}`

          if (!process.env.IS_ELECTRON || screenshotMode.value === 'prompt_folder') {
            const saved = await writeFileWithPicker(
              filenameWithExtension,
              blob,
              format.toUpperCase(),
              mimeType,
              `.${format}`,
              'player-screenshots',
              'pictures'
            )

            if (saved) {
              showToast({ message: t('Screenshot Success'), icon: ['fas', 'file-image'] })
            }
          } else {
            const arrayBuffer = await blob.arrayBuffer()

            if (await window.ftElectron.writeToDefaultFolder(filenameWithExtension, arrayBuffer)) {
              showToast({ message: t('Screenshot Success'), icon: ['fas', 'file-image'] })
            }
          }
        }
      } catch (error) {
        console.error(error)
        showToast({ message: t('Screenshot Error', { error }), icon: ['fas', 'circle-exclamation'] })
      } finally {
        canvas.remove()

        if ((!process.env.IS_ELECTRON || screenshotMode.value === 'prompt_folder') && wasPlaying) {
          video_.play()
        }
      }
    }

    // #endregion screenshots

    // #region custom player controls

    const { ContextMenu: shakaContextMenu, Controls: shakaControls, OverflowMenu: shakaOverflowMenu } = shaka.ui

    /**
     * Shaka's element registries are process-global, so a player that mounts
     * later overwrites this player's factories with ones bound to its own
     * component instance. Remember our registrations so they can be re-applied
     * before our own `ui.configure()` calls, which rebuild every control
     * element from the registries.
     * @type {[typeof shakaControls | typeof shakaOverflowMenu | typeof shakaContextMenu, string, shaka.extern.IUIElement.Factory][]}
     */
    const ownElementRegistrations = []

    /**
     * @param {typeof shakaControls | typeof shakaOverflowMenu | typeof shakaContextMenu} registry
     * @param {string} name
     * @param {shaka.extern.IUIElement.Factory} factory
     */
    function registerOwnElement(registry, name, factory) {
      ownElementRegistrations.push([registry, name, factory])
      registry.registerElement(name, factory)
    }

    function reRegisterOwnElements() {
      for (const [registry, name, factory] of ownElementRegistrations) {
        registry.registerElement(name, factory)
      }
    }

    function registerAudioTrackSelection() {
      /** @implements {shaka.extern.IUIElement.Factory} */
      class AudioTrackSelectionFactory {
        create(rootElement, controls) {
          return new AudioTrackSelection(events, rootElement, controls)
        }
      }

      registerOwnElement(shakaControls, 'ft_audio_tracks', new AudioTrackSelectionFactory())
      registerOwnElement(shakaOverflowMenu, 'ft_audio_tracks', new AudioTrackSelectionFactory())
    }

    function registerCaptionSelection() {
      /** @implements {shaka.extern.IUIElement.Factory} */
      class CaptionSelectionFactory {
        create(rootElement, controls) {
          // Shaka's factory registry is process-global, so this factory can be
          // invoked briefly while another player instance is being created.
          // Always use the player belonging to these controls instead of the
          // component's player, which may already have been destroyed.
          return new CaptionSelection(
            events,
            () => captionSettings.value,
            updateCaptionAppearance,
            resetCaptionAppearance,
            () => controls.getPlayer().isLive() ? [] : props.captionTranslations,
            caption => Boolean(findMatchingTextTrack(controls.getPlayer().getTextTracks(), caption)?.active),
            caption => selectCaptionTranslation(caption, controls.getPlayer()),
            rootElement,
            controls
          )
        }
      }

      registerOwnElement(shakaControls, 'captions', new CaptionSelectionFactory())
      registerOwnElement(shakaOverflowMenu, 'captions', new CaptionSelectionFactory())
    }

    let captionTranslationSelectionGeneration = 0

    /**
     * Native WebVTT tracks bypass Shaka's networking engine, so authenticate
     * external captions before handing them to the player as well.
     * @param {{ url: string, label: string, language: string, mimeType: string }} caption
     * @param {shaka.Player} [captionPlayer]
     * @returns {Promise<shaka.extern.Track>}
     */
    async function addCaptionTrack(caption, captionPlayer = player) {
      const url = await getSubtitleRequestUrl(caption.url, store.getters)
      return captionPlayer.addTextTrackAsync(
        url,
        caption.language,
        'captions',
        caption.mimeType,
        undefined,
        caption.label
      )
    }

    /**
     * @param {{ url: string, label: string, language: string, mimeType: string }} caption
     * @param {shaka.Player} captionPlayer
     * @returns {Promise<boolean>}
     */
    async function selectCaptionTranslation(caption, captionPlayer) {
      if (captionPlayer.isLive()) {
        return false
      }

      const selectionGeneration = ++captionTranslationSelectionGeneration
      let track = findMatchingTextTrack(captionPlayer.getTextTracks(), caption)

      if (!track) {
        try {
          track = await addCaptionTrack(caption, captionPlayer)
        } catch (error) {
          handleError(error, 'addTextTrackAsync', caption)
          return false
        }
      }

      if (
        selectionGeneration !== captionTranslationSelectionGeneration ||
        captionPlayer !== player
      ) {
        return false
      }

      captionPlayer.selectTextTrack(track)
      return true
    }

    function toggleCaptions() {
      const textTracks = player.getTextTracks()

      if (textTracks.length === 0) {
        return false
      }

      if (textTracks.some(track => track.active)) {
        player.selectTextTrack(null)
      } else {
        player.selectTextTrack(getTextTrackToEnable(textTracks))
      }

      showOverlayControls()
      return true
    }

    function toggleShortsPlayback() {
      if (video.value.paused) {
        video.value.play()
      } else {
        video.value.pause()
      }
    }

    function toggleShortsMuted() {
      video.value.muted = !video.value.muted
    }

    function syncShortsCaptionsEnabled() {
      const textTracks = player?.getTextTracks() ?? []
      shortsCaptionsAvailable.value = textTracks.length > 0
      shortsCaptionsEnabled.value = textTracks.some(track => track.active)
    }

    function toggleShortsCaptions() {
      if (toggleCaptions()) {
        syncShortsCaptionsEnabled()
      }
    }

    function openShortsOverflowMenu(event) {
      const buttonRect = event.currentTarget.getBoundingClientRect()
      const controlsContainer = ui?.getControls().getControlsContainer()
      const containerRect = controlsContainer?.getBoundingClientRect() ??
        container.value.getBoundingClientRect()
      container.value.style.setProperty(
        '--shorts-menu-top',
        `${buttonRect.bottom - containerRect.top + 8}px`
      )
      container.value.style.setProperty(
        '--shorts-menu-right',
        `${containerRect.right - buttonRect.right}px`
      )
      container.value?.querySelector('.shaka-overflow-menu-button')?.click()
    }

    function resetShortsOverflowMenu() {
      const controls = ui?.getControls()
      controls?.dispatchEvent(new shaka.util.FakeEvent('submenuclose'))
      controls?.getControlsContainer()
        .querySelectorAll('.shaka-overflow-menu, .shaka-settings-menu')
        .forEach(menu => menu.classList.add('shaka-hidden'))
      container.value?.style.removeProperty('--shorts-menu-top')
      container.value?.style.removeProperty('--shorts-menu-right')
    }

    function positionShortsContextMenu() {
      if (!props.shortsPlayer || !container.value) {
        return
      }

      const playerContainer = container.value
      const contextMenu = playerContainer.querySelector('.shaka-context-menu')
      contextMenu?.style.removeProperty('--shorts-context-menu-x')
      contextMenu?.style.removeProperty('--shorts-context-menu-y')

      requestAnimationFrame(() => {
        if (!contextMenu || contextMenu.classList.contains('shaka-hidden')) {
          return
        }

        const gap = 8
        const containerRect = playerContainer.getBoundingClientRect()
        const menuRect = contextMenu.getBoundingClientRect()
        const minLeft = containerRect.left + gap
        const maxRight = containerRect.right - gap
        const minTop = containerRect.top + gap
        const maxBottom = containerRect.bottom - gap
        const translateX = menuRect.left < minLeft
          ? minLeft - menuRect.left
          : Math.min(0, maxRight - menuRect.right)
        const translateY = menuRect.top < minTop
          ? minTop - menuRect.top
          : Math.min(0, maxBottom - menuRect.bottom)

        contextMenu.style.setProperty('--shorts-context-menu-x', `${translateX}px`)
        contextMenu.style.setProperty('--shorts-context-menu-y', `${translateY}px`)
      })
    }

    function handlePlayerMouseLeave(event) {
      handleScrollMiniPlayerLeave(event)
      container.value?.style.removeProperty('--shorts-quick-playback-rate-bar-opacity')

      if (props.shortsPlayer && !video.value.paused) {
        ui?.getControls().getControlsContainer().removeAttribute('shown')
      }
    }

    /**
     * Fade the Shorts quick playback controls in as the pointer approaches
     * without adding an invisible element that intercepts clicks.
     * @param {MouseEvent} event
     */
    function updateShortsQuickPlaybackRateBarProximity(event) {
      const playerContainer = container.value
      if (!playerContainer) {
        return
      }

      if (!props.shortsPlayer) {
        playerContainer.style.removeProperty('--shorts-quick-playback-rate-bar-opacity')
        return
      }

      const target = event.target instanceof Element ? event.target : null
      const playbackRateBar = playerContainer.querySelector('.ft-quick-playback-rate-bar')
      const seekBarTarget = target?.closest('.shaka-seek-bar-container')
      const focusedElement = document.activeElement
      if (
        seekBarTarget &&
        focusedElement instanceof HTMLElement &&
        playbackRateBar?.contains(focusedElement)
      ) {
        focusedElement.blur()
      }

      if (!playbackRateBar || seekBarTarget) {
        playerContainer.style.setProperty('--shorts-quick-playback-rate-bar-opacity', '0')
        return
      }

      const proximity = 36
      const bounds = playbackRateBar.getBoundingClientRect()
      const distanceX = Math.max(bounds.left - event.clientX, 0, event.clientX - bounds.right)
      const distanceY = Math.max(bounds.top - event.clientY, 0, event.clientY - bounds.bottom)
      const distance = Math.hypot(distanceX, distanceY)
      const opacity = Math.max(0, 1 - (distance / proximity))

      playerContainer.style.setProperty(
        '--shorts-quick-playback-rate-bar-opacity',
        opacity.toFixed(3)
      )
    }

    /**
     * In fullscreen Shaka's controls surface fills the viewport, so mouse
     * movement over the empty space would keep the controls visible. Prevent
     * those events from reaching Shaka and treat the explicit video-space
     * column like the inline player's hover area.
     * @param {MouseEvent} event
     */
    function handlePlayerMouseMove(event) {
      // Android sends a synthetic mouse move when a long press opens the
      // context menu, before the speed hold activates. Touch gestures own UI visibility.
      if (isCapacitorMobilePlayer() && event.sourceCapabilities?.firesTouchEvents && isPlayerSurfaceTarget(event.target)) {
        event.stopImmediatePropagation()
        return
      }
      // Touch browsers synthesize mouse movement after tapping a notice.
      // The notice keeps its own interactions without revealing player UI.
      if (event.target instanceof Element && event.target.closest('.skippedSegmentsWrapper')) return
      updateShortsQuickPlaybackRateBarProximity(event)

      const videoElement = video.value
      revealPausedInterface()

      if (!props.shortsPlayer || !isFullscreen.value || videoElement.paused) {
        return
      }

      const videoSpace = container.value?.querySelector('.shortsFullscreenVideoSpace')
      if (!videoSpace) {
        return
      }

      const bounds = videoSpace.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right ||
          event.clientY < bounds.top || event.clientY > bounds.bottom) {
        container.value.classList.remove('no-cursor')
        event.stopPropagation()
        ui?.getControls().getControlsContainer().removeAttribute('shown')
      }
    }

    function handlePlayerFocusIn(event) {
      handleScrollMiniPlayerEnter(event)
      revealPausedInterface()
    }

    function toggleShortsFullscreen() {
      container.value?.querySelector('.shaka-fullscreen-button')?.click()
    }

    function registerCaptionToggleButton() {
      /** @implements {shaka.extern.IUIElement.Factory} */
      class CaptionToggleButtonFactory {
        create(rootElement, controls) {
          return new CaptionToggleButton(toggleCaptions, events, rootElement, controls)
        }
      }

      registerOwnElement(shakaControls, 'ft_caption_toggle', new CaptionToggleButtonFactory())
    }

    function registerChapterOverlayButton() {
      events.addEventListener('setChaptersOverlay', (/** @type {CustomEvent} */ event) => {
        if (syncingChapterOverlayButton) {
          return
        }

        const shouldOpen = event.detail && props.chapters.length > 0

        if (!isNativeFullscreenActive() && !fullWindowEnabled.value) {
          emit('chapters-overlay-change', shouldOpen)
          return
        }

        showChaptersOverlay.value = shouldOpen

        if (shouldOpen) {
          ui?.getControls().hideSettingsMenus()
          nextTick(() => chapterOverlay.value?.focus({ preventScroll: true }))
        }
      })

      /** @implements {shaka.extern.IUIElement.Factory} */
      class ChapterOverlayButtonFactory {
        create(rootElement, controls) {
          return new ChapterOverlayButton(
            currentChapterTitle,
            isNativeFullscreenActive() || fullWindowEnabled.value
              ? showChaptersOverlay.value
              : props.sidebarChaptersOpen,
            events,
            rootElement,
            controls
          )
        }
      }

      registerOwnElement(shakaControls, 'ft_chapters', new ChapterOverlayButtonFactory())
      registerOwnElement(shakaOverflowMenu, 'ft_chapters', new ChapterOverlayButtonFactory())
    }

    function setFullscreenComments(shouldOpen) {
      const open = Boolean(
        shouldOpen && props.commentsAvailable &&
        (isNativeFullscreenActive() || fullWindowEnabled.value)
      )
      showFullscreenComments.value = open
      events.dispatchEvent(new CustomEvent('setFullscreenComments', { detail: open }))
      emit('fullscreen-comments-change', {
        open,
        target: fullscreenCommentsOverlay.value
      })
    }

    function setFullscreenLiveChat(shouldOpen) {
      const open = Boolean(
        shouldOpen && props.liveChatAvailable &&
        (isNativeFullscreenActive() || fullWindowEnabled.value)
      )
      showFullscreenLiveChat.value = open
      emit('fullscreen-live-chat-change', {
        open,
        target: fullscreenLiveChatTarget.value
      })
    }

    function closeFullscreenLiveChat() {
      setFullscreenLiveChat(false)
    }

    function closeFullscreenComments() {
      setFullscreenComments(false)
    }

    function setFullscreenMetadata(shouldOpen) {
      const presentationActive = isNativeFullscreenActive() || fullWindowEnabled.value
      const open = Boolean(
        shouldOpen && presentationActive
      )
      showFullscreenMetadata.value = open
      if (fullscreenTitleOverlay) {
        fullscreenTitleOverlay.ariaExpanded = String(open)
      }
      emit('fullscreen-metadata-change', {
        open,
        target: fullscreenMetadataTarget.value,
        presentationActive
      })
    }

    function closeFullscreenMetadata() {
      setFullscreenMetadata(false)
    }

    function setFullscreenTranscript(shouldOpen) {
      const open = Boolean(
        shouldOpen && props.captions.length > 0 &&
        (isNativeFullscreenActive() || fullWindowEnabled.value)
      )
      showFullscreenTranscript.value = open
      emit('fullscreen-transcript-change', {
        open,
        target: fullscreenTranscriptTarget.value
      })
    }

    function closeFullscreenTranscript() {
      setFullscreenTranscript(false)
    }

    function dismissFullscreenTranscript() {
      restoreFullscreenTranscript = false
      closeFullscreenTranscript()
    }

    function toggleFullscreenTranscript() {
      const shouldOpen = !showFullscreenTranscript.value

      if (shouldOpen !== props.transcriptOpen) {
        emit('toggle-transcript')
      }
      setFullscreenTranscript(shouldOpen)
    }

    function setFullscreenSponsorBlock(shouldOpen) {
      const open = Boolean(
        shouldOpen && (isNativeFullscreenActive() || fullWindowEnabled.value)
      )
      showFullscreenSponsorBlock.value = open
      emit('fullscreen-sponsorblock-change', {
        open,
        target: fullscreenSponsorBlockTarget.value
      })
    }

    function closeFullscreenSponsorBlock() {
      setFullscreenSponsorBlock(false)
    }

    function toggleFullscreenSponsorBlock() {
      const shouldOpen = !showFullscreenSponsorBlock.value

      if (shouldOpen !== sponsorBlockInfoOpen.value) {
        toggleSponsorBlockInfo()
      }
      setFullscreenSponsorBlock(shouldOpen)
    }

    function setFullscreenPlaylist(shouldOpen) {
      const open = Boolean(
        shouldOpen && props.watchingPlaylist &&
        (isNativeFullscreenActive() || fullWindowEnabled.value)
      )
      showFullscreenPlaylist.value = open
      emit('fullscreen-playlist-change', {
        open,
        target: fullscreenPlaylistTarget.value
      })
    }

    function closeFullscreenPlaylist() {
      setFullscreenPlaylist(false)
    }

    function rememberDockedPanels() {
      restoreFullscreenMetadata = showFullscreenMetadata.value
      restoreFullscreenTranscript = showFullscreenTranscript.value
      restoreFullscreenSponsorBlock = showFullscreenSponsorBlock.value
      restoreFullscreenComments = showFullscreenComments.value
      restoreFullscreenLiveChat = showFullscreenLiveChat.value
      restoreFullscreenPlaylist = showFullscreenPlaylist.value
    }

    function restoreDockedPanels() {
      if (!isNativeFullscreenActive() && !fullWindowEnabled.value) {
        return
      }

      if (restoreChapters) {
        restoreChapters = false
        events.dispatchEvent(new CustomEvent('setChaptersOverlay', {
          detail: props.chapters.length > 0
        }))
      }

      if (restoreFullscreenComments) {
        restoreFullscreenComments = false
        setFullscreenComments(true)
      }

      if (restoreFullscreenLiveChat) {
        restoreFullscreenLiveChat = false
        setFullscreenLiveChat(true)
      }

      if (restoreFullscreenMetadata) {
        restoreFullscreenMetadata = false
        setFullscreenMetadata(true)
      }

      if (restoreFullscreenTranscript) {
        restoreFullscreenTranscript = false
        setFullscreenTranscript(true)
      }

      if (restoreFullscreenSponsorBlock) {
        restoreFullscreenSponsorBlock = false
        setFullscreenSponsorBlock(true)
      }

      if (restoreFullscreenPlaylist) {
        restoreFullscreenPlaylist = false
        setFullscreenPlaylist(true)
      }
    }

    watch(() => props.commentsAvailable, available => {
      if (!available && showFullscreenComments.value) {
        closeFullscreenComments()
      }
    })

    watch(() => props.liveChatAvailable, available => {
      if (!available && showFullscreenLiveChat.value) closeFullscreenLiveChat()
    })

    watch(() => props.captions.length, captionCount => {
      if (captionCount === 0 && showFullscreenTranscript.value) {
        dismissFullscreenTranscript()
      }
    })

    watch(() => props.watchingPlaylist, watching => {
      if (!watching && showFullscreenPlaylist.value) {
        closeFullscreenPlaylist()
      }
    })

    watch(() => props.shortsMetadataOpen, open => {
      if (!props.shortsPlayer) {
        return
      }

      if (isNativeFullscreenActive() || fullWindowEnabled.value) {
        const openDocks = getFullscreenOpenDocks('metadata')
        if (open && openDocks.length === 1 && fullscreenDockCollapsedState.metadata != null) {
          toggleFullscreenDockCollapsed(
            openDocks,
            'metadata',
            fullscreenDockWeights,
            fullscreenDockCollapsedState,
            container.value.clientHeight
          )
        }
        setFullscreenMetadata(open)
      } else {
        restoreFullscreenMetadata = open
      }
    }, { immediate: true })

    watch(() => props.sidebarChaptersOpen, () => {
      if (!isNativeFullscreenActive() && !fullWindowEnabled.value) {
        syncChapterOverlayButton()
      }
    })

    watch(() => props.title, title => {
      if (fullscreenTitleOverlay) {
        fullscreenTitleOverlay.textContent = title
        fullscreenTitleOverlay.ariaLabel = `${t('Video.Metadata', 'Video information')}: ${title}`
      }
    })

    watch(fullWindowEnabled, enabled => {
      if (!enabled && !isNativeFullscreenActive()) {
        rememberDockedPanels()
        closeFullscreenMetadata()
        closeFullscreenTranscript()
        closeFullscreenSponsorBlock()
        closeFullscreenLiveChat()
        closeFullscreenComments()
        closeFullscreenPlaylist()
      }
    })

    watch(chapterThumbnails, (thumbnails) => {
      emit('chapter-thumbnails-change', thumbnails)
    })

    async function loadChapterThumbnails() {
      chapterThumbnails.value = []

      const activePlayer = player
      const videoId = props.videoId

      if (!activePlayer || activePlayer.getImageTracks().length === 0) {
        return
      }

      const imageDimensions = new Map()
      const thumbnails = await Promise.all(props.chapters.map(async chapter => {
        if (chapter.thumbnail?.url) {
          return null
        }

        try {
          const thumbnail = await activePlayer.getThumbnails(null, chapter.startSeconds)
          const uri = thumbnail?.uris[0]

          if (!thumbnail || !uri || thumbnail.codecs === 'mjpg' || uri.startsWith('offline:')) {
            return null
          }

          const result = {
            url: uri.split('#xywh=')[0],
            width: thumbnail.width,
            height: thumbnail.height,
            imageWidth: thumbnail.imageWidth,
            imageHeight: thumbnail.imageHeight,
            positionX: thumbnail.positionX,
            positionY: thumbnail.positionY,
            sprite: thumbnail.sprite ||
              thumbnail.imageWidth > thumbnail.width ||
              thumbnail.imageHeight > thumbnail.height
          }

          if (result.sprite && (!result.imageWidth || !result.imageHeight)) {
            if (!imageDimensions.has(result.url)) {
              imageDimensions.set(result.url, loadImageDimensions(result.url))
            }

            const dimensions = await imageDimensions.get(result.url)

            if (!dimensions) {
              return null
            }

            result.imageWidth = dimensions.width
            result.imageHeight = dimensions.height
          }

          return result
        } catch {
          return null
        }
      }))

      if (player === activePlayer && props.videoId === videoId) {
        chapterThumbnails.value = thumbnails
      }
    }

    /**
     * @param {string} url
     * @returns {Promise<{ width: number, height: number } | null>}
     */
    function loadImageDimensions(url) {
      return new Promise(resolve => {
        const image = new Image()

        image.addEventListener('load', () => {
          resolve({ width: image.naturalWidth, height: image.naturalHeight })
        }, { once: true })
        image.addEventListener('error', () => resolve(null), { once: true })
        image.src = url
      })
    }

    function registerAutoplayToggle() {
      events.addEventListener('toggleAutoplay', () => {
        emit('toggle-autoplay')
      })

      /**
       * @implements {shaka.extern.IUIElement.Factory}
       */
      class AutoplayToggleFactory {
        create(rootElement, controls) {
          return new AutoplayToggle(props.autoplayEnabled, events, rootElement, controls)
        }
      }

      registerOwnElement(shakaControls, 'ft_autoplay_toggle', new AutoplayToggleFactory())
      registerOwnElement(shakaOverflowMenu, 'ft_autoplay_toggle', new AutoplayToggleFactory())
    }

    function registerTheatreModeButton() {
      events.addEventListener('toggleTheatreMode', () => {
        emit('toggle-theatre-mode')
      })

      /**
       * @implements {shaka.extern.IUIElement.Factory}
       */
      class TheatreModeButtonFactory {
        create(rootElement, controls) {
          return new TheatreModeButton(props.useTheatreMode, events, rootElement, controls)
        }
      }

      registerOwnElement(shakaControls, 'ft_theatre_mode', new TheatreModeButtonFactory())
      registerOwnElement(shakaOverflowMenu, 'ft_theatre_mode', new TheatreModeButtonFactory())
    }

    function registerFullWindowButton() {
      events.addEventListener('setFullWindow', async (/** @type {CustomEvent} */ event) => {
        // Moving the player while its overflow menu is open can leave both the
        // menu DOM and its submenu state stuck. Reset both synchronously; the
        // public hide method uses a timer and can otherwise lose a race with
        // the layout transition and the next overflow-button click.
        resetShortsOverflowMenu()

        fullWindowAnimation?.cancel()
        fullWindowAnimation = null

        const playerContainer = container.value
        const shouldAnimate = playerContainer !== null && !isReducedMotionEnabled()
        const animationDuration = shouldAnimate
          ? FULL_WINDOW_ANIMATION_DURATION_MS / getAnimationSpeedMultiplier(store.getters.getAnimationSpeed)
          : FULL_WINDOW_ANIMATION_DURATION_MS
        suppressPanelTransitions(animationDuration + 50)
        const previousRect = shouldAnimate ? playerContainer.getBoundingClientRect() : null

        if (event.detail) {
          fullWindowPlaceholderHeight.value = playerContainer.getBoundingClientRect().height
        }

        fullWindowEnabled.value = event.detail
        syncChapterOverlayButton()

        if (fullWindowEnabled.value) {
          restoreDockedPanels()
        }

        if (fullWindowEnabled.value) {
          document.body.dataset.playerFullWindowOwner = mediaTabId
          document.body.classList.add('playerFullWindow')
        } else if (document.body.dataset.playerFullWindowOwner === mediaTabId) {
          delete document.body.dataset.playerFullWindowOwner
          document.body.classList.remove('playerFullWindow')
        }

        if (previousRect === null) {
          return
        }

        await nextTick()
        const nextRect = playerContainer.getBoundingClientRect()
        const animation = applyAnimationSpeed(playerContainer.animate([
          {
            transform: `translate(${previousRect.left - nextRect.left}px, ${previousRect.top - nextRect.top}px) scale(${previousRect.width / nextRect.width}, ${previousRect.height / nextRect.height})`,
            transformOrigin: 'top left'
          },
          {
            transform: 'none',
            transformOrigin: 'top left'
          }
        ], {
          duration: FULL_WINDOW_ANIMATION_DURATION_MS,
          easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
        }))

        fullWindowAnimation = animation
        animation.addEventListener('finish', () => {
          if (fullWindowAnimation === animation) {
            fullWindowAnimation = null
          }
        })
      })

      fullWindowListenerReady = true
      applyPendingPresentationModes()

      /**
       * @implements {shaka.extern.IUIElement.Factory}
       */
      class FullWindowButtonFactory {
        create(rootElement, controls) {
          return new FullWindowButton(fullWindowEnabled.value, events, rootElement, controls)
        }
      }

      registerOwnElement(shakaControls, 'ft_full_window', new FullWindowButtonFactory())
      registerOwnElement(shakaOverflowMenu, 'ft_full_window', new FullWindowButtonFactory())
    }

    function registerAndroidPictureInPictureButton() {
      if (!process.env.IS_CAPACITOR) return

      events.addEventListener('enterAndroidPictureInPicture', () => {
        enterAndroidPictureInPicture(video.value).catch(error => {
          console.error('Failed to enter Android Picture-in-Picture:', error)
        })
      })

      class AndroidPictureInPictureButtonFactory {
        create(rootElement, controls) {
          return new AndroidPictureInPictureButton(events, rootElement, controls)
        }
      }

      const factory = new AndroidPictureInPictureButtonFactory()
      registerOwnElement(shakaControls, 'ft_android_picture_in_picture', factory)
      registerOwnElement(shakaOverflowMenu, 'ft_android_picture_in_picture', factory)
    }

    function registerShortsVideoInfoButton() {
      events.addEventListener('toggleShortsMetadata', () => {
        emit('toggle-shorts-metadata')
      })

      /** @implements {shaka.extern.IUIElement.Factory} */
      class ShortsVideoInfoButtonFactory {
        create(rootElement, controls) {
          return new ShortsVideoInfoButton(events, rootElement, controls)
        }
      }

      registerOwnElement(
        shakaOverflowMenu,
        'ft_shorts_video_info',
        new ShortsVideoInfoButtonFactory()
      )
    }

    function registerLegacyQualitySelection() {
      let selectionGeneration = 0

      events.addEventListener('setLegacyFormat', async (/** @type {CustomEvent} */ event) => {
        const currentSelectionGeneration = ++selectionGeneration
        const {
          format,
          playbackPosition,
          playbackRate = pendingPlaybackRateRestore ?? getCurrentPlaybackRate(),
          restoreCaptionIndex: restoreCaptionIndex_ = null,
          userSelected = false
        } = event.detail

        queuePlaybackRateRestore(playbackRate)

        if (restoreCaptionIndex_ !== null) {
          restoreCaptionIndex = restoreCaptionIndex_
        }

        activeLegacyFormat.value = event.detail.format
        const quality = getQualityFromDimensions(format.width, format.height)

        // Only remember the quality when the user picked it themselves. The legacy formats top out
        // at 360p, so remembering an automatically chosen one would downgrade the preferred quality
        // when switching back to the DASH formats.
        if (userSelected && quality !== null) {
          emit('video-quality-updated', quality)
          emit('video-quality-user-set', quality)
        }

        try {
          const isAvailable = await waitForYtDlpFormatAvailability(format)

          if (currentSelectionGeneration !== selectionGeneration) {
            return
          }

          if (!isAvailable) {
            throw new Error('yt-dlp format availability delay is too long')
          }

          await player.load(format.url, playbackPosition, format.mimeType)
        } catch (error) {
          handleError(error, 'setLegacyFormat', event.detail)
        }
      })

      /**
       * @implements {shaka.extern.IUIElement.Factory}
       */
      class LegacyQualitySelectionFactory {
        create(rootElement, controls) {
          return new LegacyQualitySelection(
            () => activeLegacyFormat.value,
            props.legacyFormats,
            events,
            rootElement,
            controls
          )
        }
      }

      registerOwnElement(shakaControls, 'ft_legacy_quality', new LegacyQualitySelectionFactory())
      registerOwnElement(shakaOverflowMenu, 'ft_legacy_quality', new LegacyQualitySelectionFactory())
    }

    function registerStatsButton() {
      events.addEventListener('setStatsVisibility', (/** @type {CustomEvent} */ event) => {
        showStats.value = event.detail

        if (showStats.value) {
          gatherInitialStatsValues()
        }
      })

      /**
       * @implements {shaka.extern.IUIElement.Factory}
       */
      class StatsButtonFactory {
        create(rootElement, controls) {
          return new StatsButton(showStats.value, events, rootElement, controls)
        }
      }

      registerOwnElement(shakaContextMenu, 'ft_stats', new StatsButtonFactory())
    }

    function registerAmbientModeButton() {
      /**
       * @implements {shaka.extern.IUIElement.Factory}
       */
      class AmbientModeButtonFactory {
        create(rootElement, controls) {
          return new AmbientModeButton(
            ambientMode,
            updateAmbientMode,
            events,
            rootElement,
            controls
          )
        }
      }

      registerOwnElement(shakaOverflowMenu, 'ft_ambient_mode', new AmbientModeButtonFactory())
    }

    function registerMusicVisualizerButton() {
      /** @implements {shaka.extern.IUIElement.Factory} */
      class MusicVisualizerButtonFactory {
        create(rootElement, controls) {
          return new MusicVisualizerButton(
            musicVisualizer,
            updateMusicVisualizer,
            events,
            rootElement,
            controls
          )
        }
      }

      registerOwnElement(
        shakaOverflowMenu,
        'ft_music_visualizer',
        new MusicVisualizerButtonFactory()
      )
    }

    function registerVideoZoomSelection() {
      /** @implements {shaka.extern.IUIElement.Factory} */
      class VideoZoomSelectionFactory {
        create(rootElement, controls) {
          return new VideoZoomSelection(
            videoZoom,
            updateVideoZoom,
            events,
            rootElement,
            controls
          )
        }
      }

      registerOwnElement(shakaOverflowMenu, 'ft_video_zoom', new VideoZoomSelectionFactory())
    }

    function registerSkipSilenceButton() {
      /** @implements {shaka.extern.IUIElement.Factory} */
      class SkipSilenceButtonFactory {
        create(rootElement, controls) {
          return new SkipSilenceButton(
            skipSilence,
            updateSkipSilence,
            events,
            rootElement,
            controls
          )
        }
      }

      registerOwnElement(shakaOverflowMenu, 'ft_skip_silence', new SkipSilenceButtonFactory())
    }

    function registerVoiceOverTranslationButton() {
      /** @implements {shaka.extern.IUIElement.Factory} */
      class VoiceOverTranslationButtonFactory {
        create(rootElement, controls) {
          return new VoiceOverTranslationButton(
            voiceOverTranslation.state,
            voiceOverTranslation.enabled,
            voiceOverTranslation.toggle,
            events,
            rootElement,
            controls
          )
        }
      }

      registerOwnElement(
        shakaOverflowMenu,
        'ft_voice_over_translation',
        new VoiceOverTranslationButtonFactory()
      )
    }

    function registerSleepTimer() {
      events.addEventListener('setSleepTimerDuration', (/** @type {CustomEvent} */ event) => {
        sleepTimer.startDuration(event.detail)
      })
      events.addEventListener('setSleepTimerEndOfVideo', () => {
        sleepTimer.startEndOfVideo()
      })
      events.addEventListener('cancelSleepTimer', () => {
        sleepTimer.cancel()
      })

      /** @implements {shaka.extern.IUIElement.Factory} */
      class SleepTimerFactory {
        create(rootElement, controls) {
          return new SleepTimer(sleepTimer, !isLive.value, events, rootElement, controls)
        }
      }

      registerOwnElement(shakaOverflowMenu, 'ft_sleep_timer', new SleepTimerFactory())
    }

    /** @type {(() => void) | null} */
    let removeAbRepeatContext = null
    /** @type {(() => void) | null} */
    let removeLoopButtonContext = null

    function registerAbRepeatControl() {
      const controls = ui?.getControls()
      if (controls) {
        removeAbRepeatContext?.()
        removeAbRepeatContext = setAbRepeatContext(controls, {
          start: abRepeatStart,
          end: abRepeatEnd,
          enabled: abRepeatEnabled,
          validation: abRepeatValidation,
          validationMessage: abRepeatValidationMessage,
          setCurrentBoundary: setCurrentAbRepeatBoundary,
          toggle: toggleAbRepeat,
          clear: clearAbRepeat,
          getShortcut: action => ({
            start: KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.SET_AB_REPEAT_START,
            end: KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.SET_AB_REPEAT_END,
            clear: KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.CLEAR_AB_REPEAT,
          })[action],
        })
        removeLoopButtonContext?.()
        removeLoopButtonContext = setLoopButtonContext(controls, {
          isEnabled: () => Boolean(video.value?.loop || abRepeatEnabled.value),
          isVisible: location => location !== 'overflow' || !abRepeatAvailable.value,
          subscribe: callback => watch([abRepeatAvailable, abRepeatEnabled], callback),
          toggle: () => {
            if (abRepeatAvailable.value) {
              toggleAbRepeat()
            } else if (video.value) {
              video.value.loop = !video.value.loop
            }
          },
        })
      }

      class AbRepeatControlFactory {
        create(rootElement, controls) {
          return new AbRepeatControl(rootElement, controls)
        }
      }

      registerOwnElement(shakaOverflowMenu, 'ft_ab_repeat', new AbRepeatControlFactory())
    }

    /** @type {(() => void) | null} */
    let removeCopyVideoUrlContext = null

    /** @type {(() => void) | null} */
    let removeQuickPlaybackRateBarContext = null

    function registerContextMenuButtons() {
      /**
       * @returns {number}
       */
      function getCurrentTimestamp() {
        const currentTime = Math.floor(video.value?.currentTime ?? 0)
        return Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0
      }

      /**
       * @param {'youtube' | 'invidious'} backend
       * @param {boolean} includeTimestamp
       * @returns {string}
       */
      function getVideoUrl(backend, includeTimestamp) {
        const videoUrl = backend === 'invidious'
          ? getInvidiousVideoUrl(store.getters.getCurrentInvidiousInstanceUrl, props.videoId, shareablePlaylistId.value)
          : getYoutubeVideoShareUrl(props.videoId, shareablePlaylistId.value)

        if (!includeTimestamp) {
          return videoUrl
        }

        return appendTimestamp(videoUrl, getCurrentTimestamp())
      }

      /**
       * @param {'youtube' | 'invidious'} backend
       * @param {boolean} includeTimestamp
       * @returns {string}
       */
      function getCopySuccessMessage(backend, includeTimestamp) {
        if (includeTimestamp) {
          return t('Share.Timestamp Link Copied')
        }

        return backend === 'invidious'
          ? t('Share.Invidious URL copied to clipboard')
          : t('Share.YouTube URL copied to clipboard')
      }

      /**
       * @param {'youtube' | 'invidious'} backend
       * @param {boolean} includeTimestamp
       * @returns {string}
       */
      function getCopyLabel(backend, includeTimestamp) {
        const baseLabel = backend === 'invidious'
          ? t('Video.Copy Invidious Link')
          : t('Video.Copy YouTube Link')

        if (!includeTimestamp) {
          return baseLabel
        }

        return `${baseLabel} (${t('Share.Include Timestamp')})`
      }

      /**
       * @implements {shaka.extern.IUIElement.Factory}
       */
      class CopyVideoUrlButtonFactory {
        /**
         * @param {'youtube' | 'invidious'} backend
         * @param {boolean} includeTimestamp
         */
        constructor(backend, includeTimestamp) {
          this.backend = backend
          this.includeTimestamp = includeTimestamp
        }

        create(rootElement, controls) {
          return new CopyVideoUrlButton(
            this.backend,
            this.includeTimestamp,
            rootElement,
            controls
          )
        }
      }

      // The button factory is registered on shaka's renderer-global element
      // registry, so it can't close over this instance's state. Expose this
      // instance's URL/label resolvers keyed by its own `Controls` object, which
      // the button resolves at click time (see CopyVideoUrlButton).
      const controls = ui?.getControls()
      if (controls) {
        removeCopyVideoUrlContext?.()
        removeCopyVideoUrlContext = setCopyVideoUrlContext(controls, {
          getVideoUrl,
          getLabel: getCopyLabel,
          getSuccessMessage: getCopySuccessMessage
        })
      }

      /**
       * @implements {shaka.extern.IUIElement.Factory}
       */
      class LoopButtonFactory {
        create(rootElement, controls) {
          return new LoopButton(rootElement, controls)
        }
      }

      registerOwnElement(shakaContextMenu, 'ft_copy_youtube_video_url', new CopyVideoUrlButtonFactory('youtube', false))
      registerOwnElement(shakaContextMenu, 'ft_copy_youtube_video_url_at_current_time', new CopyVideoUrlButtonFactory('youtube', true))
      registerOwnElement(shakaContextMenu, 'ft_copy_invidious_video_url', new CopyVideoUrlButtonFactory('invidious', false))
      registerOwnElement(shakaContextMenu, 'ft_copy_invidious_video_url_at_current_time', new CopyVideoUrlButtonFactory('invidious', true))
      registerOwnElement(shakaContextMenu, 'ft_loop', new LoopButtonFactory())
      registerOwnElement(shakaOverflowMenu, 'ft_loop', new LoopButtonFactory())
    }

    function registerScreenshotButton() {
      events.addEventListener('takeScreenshot', () => {
        takeScreenshot()
      })

      /**
       * @implements {shaka.extern.IUIElement.Factory}
       */
      class ScreenshotButtonFactory {
        create(rootElement, controls) {
          return new ScreenshotButton(events, rootElement, controls)
        }
      }

      registerOwnElement(shakaControls, 'ft_screenshot', new ScreenshotButtonFactory())
      registerOwnElement(shakaOverflowMenu, 'ft_screenshot', new ScreenshotButtonFactory())
    }

    function registerSponsorBlockSubmissionButtons() {
      events.addEventListener('startSponsorBlockSegment', () => {
        startSponsorBlockDraft()
      })
      events.addEventListener('endSponsorBlockSegment', () => {
        endSponsorBlockDraft()
      })
      events.addEventListener('toggleSponsorBlockSubmissionMenu', () => {
        if (sponsorBlockSubmissionMenuOpen.value) {
          closeSponsorBlockSubmissionMenu()
        } else {
          openSponsorBlockSubmissionMenu()
        }
      })
      events.addEventListener('cancelSponsorBlockSegment', () => {
        cancelCurrentSponsorBlockDraft()
      })
      events.addEventListener('clearSponsorBlockSegments', () => {
        clearSponsorBlockDrafts()
      })

      class SponsorBlockStartButtonFactory {
        create(rootElement, controls) {
          return new SponsorBlockStartButton(events, rootElement, controls)
        }
      }

      class SponsorBlockEndButtonFactory {
        create(rootElement, controls) {
          return new SponsorBlockEndButton(events, rootElement, controls)
        }
      }

      class SponsorBlockOpenMenuButtonFactory {
        create(rootElement, controls) {
          return new SponsorBlockOpenMenuButton(events, rootElement, controls)
        }
      }

      class SponsorBlockCancelButtonFactory {
        create(rootElement, controls) {
          return new SponsorBlockCancelButton(events, rootElement, controls)
        }
      }

      class SponsorBlockClearButtonFactory {
        create(rootElement, controls) {
          return new SponsorBlockClearButton(events, rootElement, controls)
        }
      }

      registerOwnElement(shakaControls, 'ft_sponsorblock_start', new SponsorBlockStartButtonFactory())
      registerOwnElement(shakaControls, 'ft_sponsorblock_end', new SponsorBlockEndButtonFactory())
      registerOwnElement(shakaControls, 'ft_sponsorblock_open_menu', new SponsorBlockOpenMenuButtonFactory())
      registerOwnElement(shakaControls, 'ft_sponsorblock_cancel', new SponsorBlockCancelButtonFactory())
      registerOwnElement(shakaControls, 'ft_sponsorblock_clear', new SponsorBlockClearButtonFactory())

      updateSponsorBlockSubmissionState()
    }

    function registerSponsorBlockHighlightButton() {
      events.addEventListener('skipToSponsorBlockHighlight', () => {
        skipToSponsorBlockHighlight()
      })

      class SponsorBlockHighlightButtonFactory {
        create(rootElement, controls) {
          return new SponsorBlockHighlightButton(events, rootElement, controls)
        }
      }

      registerOwnElement(shakaControls, 'ft_sponsorblock_highlight', new SponsorBlockHighlightButtonFactory())
      updateSponsorBlockHighlightState()
    }

    function registerSkipButtons() {
      // skip to next video button
      events.addEventListener('nextVideo', () => {
        emit('skip-to-next')
      })

      class SkipNextButtonFactory {
        create(rootElement, controls) {
          return new SkipButton(events, rootElement, controls, 'next')
        }
      }

      registerOwnElement(shakaControls, 'ft_skip_next', new SkipNextButtonFactory())
      registerOwnElement(shakaOverflowMenu, 'ft_skip_next', new SkipNextButtonFactory())

      // skip to previous video button
      events.addEventListener('previousVideo', () => {
        emit('skip-to-prev')
      })

      class SkipPreviousButtonFactory {
        create(rootElement, controls) {
          return new SkipButton(events, rootElement, controls, 'previous')
        }
      }

      registerOwnElement(shakaControls, 'ft_skip_previous', new SkipPreviousButtonFactory())
      registerOwnElement(shakaOverflowMenu, 'ft_skip_previous', new SkipPreviousButtonFactory())
    }

    function registerPlaybackAdjustedTime() {
      /** @implements {shaka.extern.IUIElement.Factory} */
      class PlaybackAdjustedTimeFactory {
        create(rootElement, controls) {
          return new FtPlaybackAdjustedTime(
            () => showPlaybackRateAdjustedTimestamp.value,
            events,
            rootElement,
            controls
          )
        }
      }

      registerOwnElement(shakaControls, 'ft_playback_adjusted_time', new PlaybackAdjustedTimeFactory())
    }

    function registerQuickPlaybackRateBar() {
      events.addEventListener('quickPlaybackRateUserSet', (/** @type {CustomEvent} */ event) => {
        const playbackRate = normalizePlaybackRate(event.detail)

        if (playbackRate === null) {
          return
        }

        playbackRateUserSet = true
        queuePlaybackRateRestore(playbackRate)
        emit('playback-rate-updated', playbackRate)
        emit('playback-rate-user-set', playbackRate)
      })

      events.addEventListener('saveChannelPlaybackSpeed', () => {
        emit('save-channel-playback-speed')
      })

      const controls = ui?.getControls()
      if (controls) {
        removeQuickPlaybackRateBarContext?.()
        removeQuickPlaybackRateBarContext = setQuickPlaybackRateBarContext(controls, {
          getPlaybackRateOptions: () => quickPlaybackSpeedBarOptions.value,
          getSavedChannelPlaybackRate: () => savedChannelPlaybackRate.value,
          getCanSaveChannelPlaybackSpeed: () => canManuallySaveChannelPlaybackRate.value,
          events
        })
      }

      /** @implements {shaka.extern.IUIElement.Factory} */
      class QuickPlaybackRateBarFactory {
        create(rootElement, controls) {
          return new QuickPlaybackRateBar(rootElement, controls)
        }
      }

      registerOwnElement(shakaControls, 'ft_quick_playback_rate_bar', new QuickPlaybackRateBarFactory())
    }

    /**
     * As shaka-player doesn't let you unregister custom control factories,
     * overwrite them with `null` instead so the referenced objects
     * (e.g. {@linkcode events}, {@linkcode fullWindowEnabled}) can get garbage collected
     */
    function cleanUpCustomPlayerControls() {
      removeAbRepeatContext?.()
      removeAbRepeatContext = null

      removeLoopButtonContext?.()
      removeLoopButtonContext = null

      removeCopyVideoUrlContext?.()
      removeCopyVideoUrlContext = null

      removeQuickPlaybackRateBarContext?.()
      removeQuickPlaybackRateBarContext = null

      if (!registeredCustomControls) {
        return
      }
      registeredCustomControls = false
      liveCustomControlPlayers--

      // Shaka's element registries are process-global and shared across every
      // live player. Resetting the custom factories (to shaka defaults / null)
      // while another player is still mounted would make that player's next
      // ui.configure() build its control panel against a null factory and throw
      // — Shaka's control-panel loop only guards `registry.has(name)`, not a
      // null value — which takes down the whole tab. Only reset once this was
      // the last player relying on the shared registry.
      if (liveCustomControlPlayers > 0) {
        return
      }

      class DefaultCaptionSelectionFactory {
        create(rootElement, controls) {
          return new shaka.ui.TextSelection(rootElement, controls)
        }
      }

      const defaultCaptionSelectionFactory = new DefaultCaptionSelectionFactory()
      shakaControls.registerElement('captions', defaultCaptionSelectionFactory)
      shakaOverflowMenu.registerElement('captions', defaultCaptionSelectionFactory)

      shakaControls.registerElement('ft_audio_tracks', null)
      shakaOverflowMenu.registerElement('ft_audio_tracks', null)

      shakaControls.registerElement('ft_caption_toggle', null)

      shakaControls.registerElement('ft_autoplay_toggle', null)
      shakaOverflowMenu.registerElement('ft_autoplay_toggle', null)

      shakaControls.registerElement('ft_theatre_mode', null)
      shakaOverflowMenu.registerElement('ft_theatre_mode', null)

      shakaControls.registerElement('ft_full_window', null)
      shakaOverflowMenu.registerElement('ft_full_window', null)
      shakaControls.registerElement('ft_android_picture_in_picture', null)
      shakaOverflowMenu.registerElement('ft_android_picture_in_picture', null)
      shakaOverflowMenu.registerElement('ft_shorts_video_info', null)

      shakaControls.registerElement('ft_legacy_quality', null)
      shakaOverflowMenu.registerElement('ft_legacy_quality', null)

      shakaContextMenu.registerElement('ft_copy_youtube_video_url', null)
      shakaContextMenu.registerElement('ft_copy_youtube_video_url_at_current_time', null)
      shakaContextMenu.registerElement('ft_copy_invidious_video_url', null)
      shakaContextMenu.registerElement('ft_copy_invidious_video_url_at_current_time', null)
      shakaContextMenu.registerElement('ft_loop', null)
      shakaContextMenu.registerElement('ft_stats', null)
      shakaOverflowMenu.registerElement('ft_ambient_mode', null)
      shakaOverflowMenu.registerElement('ft_music_visualizer', null)
      shakaOverflowMenu.registerElement('ft_video_zoom', null)
      shakaOverflowMenu.registerElement('ft_skip_silence', null)
      shakaOverflowMenu.registerElement('ft_voice_over_translation', null)
      shakaOverflowMenu.registerElement('ft_sleep_timer', null)
      shakaOverflowMenu.registerElement('ft_loop', null)
      shakaOverflowMenu.registerElement('ft_ab_repeat', null)

      shakaControls.registerElement('ft_screenshot', null)
      shakaOverflowMenu.registerElement('ft_screenshot', null)

      shakaControls.registerElement('ft_sponsorblock_start', null)
      shakaControls.registerElement('ft_sponsorblock_end', null)
      shakaControls.registerElement('ft_sponsorblock_open_menu', null)
      shakaControls.registerElement('ft_sponsorblock_cancel', null)
      shakaControls.registerElement('ft_sponsorblock_clear', null)
      shakaControls.registerElement('ft_sponsorblock_highlight', null)

      shakaControls.registerElement('ft_next_previous', null)
      shakaOverflowMenu.registerElement('ft_next_previous', null)

      shakaControls.registerElement('ft_skip_previous', null)
      shakaOverflowMenu.registerElement('ft_skip_previous', null)

      shakaControls.registerElement('ft_playback_adjusted_time', null)
      shakaControls.registerElement('ft_quick_playback_rate_bar', null)
    }

    // #endregion custom player controls

    // #region mouse and keyboard helpers

    /**
     * @param {number} step
     */
    function changeVolume(step) {
      const volumeBar = container.value.querySelector('.shaka-volume-bar')

      const oldValue = parseFloat(volumeBar.value)
      const newValue = oldValue + (step * 100)

      if (newValue < 0) {
        volumeBar.value = 0
      } else if (newValue > 100) {
        volumeBar.value = 100
      } else {
        volumeBar.value = newValue
      }

      volumeBar.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }))

      let messageIcon
      if (newValue <= 0) {
        messageIcon = 'volume-mute'
      } else if (newValue > 0 && newValue < oldValue) {
        messageIcon = 'volume-low'
      } else if (newValue > 0 && newValue > oldValue) {
        messageIcon = 'volume-high'
      }
      showValueChange(`${Math.round(video.value.volume * 100)}%`, messageIcon)
    }

    /** @type {number | null} */
    let togglePlaybackRate = null

    /** @type {number | null} */
    let pendingPlaybackRateRestore = null

    let playbackRateUserSet = normalizePlaybackRate(props.sabrReloadPlaybackRate) !== null
    let musicPlaybackRateToastShown = false
    let pendingMusicPlaybackRateToast = false

    /** @type {Map<string, number>} */
    const temporaryPlaybackRateHoldTimeouts = new Map()
    const temporaryPlaybackRateSources = new Set()
    /** @type {number | null} */
    let playbackRateBeforeTemporaryPlayback = null
    let wasPausedBeforeTemporaryPlayback = false
    let temporaryPlaybackRateActive = false

    /**
     * @param {unknown} rate
     * @returns {number | null}
     */
    function normalizePlaybackRate(rate) {
      const parsedRate = typeof rate === 'number' ? rate : Number(rate)
      return Number.isFinite(parsedRate) && parsedRate > 0.07 ? parsedRate : null
    }

    const isMusicVideoDetected = computed(() => {
      return props.videoGenreIsMusic || hasSponsorBlockMusicOfftopicSegment.value
    })

    const shouldUseNormalPlaybackRateByDefault = computed(() => isLive.value || isMusicVideoDetected.value)

    /**
     * @param {number} fallbackPlaybackRate
     * @returns {number}
     */
    function getDefaultPlaybackRateForVideo(fallbackPlaybackRate = defaultPlaybackRate.value) {
      return shouldUseNormalPlaybackRateByDefault.value ? NORMAL_PLAYBACK_RATE : fallbackPlaybackRate
    }

    /**
     * @returns {number}
     */
    function getInitialPlaybackRate() {
      const sabrReloadPlaybackRate = normalizePlaybackRate(props.sabrReloadPlaybackRate)
      if (sabrReloadPlaybackRate !== null) {
        return sabrReloadPlaybackRate
      }

      if (shouldUseNormalPlaybackRateByDefault.value) {
        return NORMAL_PLAYBACK_RATE
      }

      return normalizePlaybackRate(props.currentPlaybackRate) ?? NORMAL_PLAYBACK_RATE
    }

    /**
     * @returns {number}
     */
    function getUnforcedPlaybackRate() {
      if (savedChannelPlaybackRate.value !== null) {
        return savedChannelPlaybackRate.value
      }

      const currentPlaybackRate = normalizePlaybackRate(props.currentPlaybackRate)
      if (currentPlaybackRate !== null && Math.abs(currentPlaybackRate - NORMAL_PLAYBACK_RATE) >= 0.01) {
        return currentPlaybackRate
      }

      return defaultPlaybackRate.value
    }

    /**
     * @param {number|null} unforcedPlaybackRate
     */
    function showMusicPlaybackRateToast(unforcedPlaybackRate) {
      if (
        musicPlaybackRateToastShown ||
        playbackRateUserSet ||
        !isMusicVideoDetected.value ||
        unforcedPlaybackRate === null ||
        Math.abs(unforcedPlaybackRate - NORMAL_PLAYBACK_RATE) < 0.01
      ) {
        return
      }

      // Defer the toast until the video is actually played in this tab, so it
      // doesn't pop up in whatever tab happened to be open when the video loaded.
      pendingMusicPlaybackRateToast = true
    }

    function flushPendingMusicPlaybackRateToast() {
      if (!pendingMusicPlaybackRateToast || musicPlaybackRateToastShown || playbackRateUserSet) {
        return
      }

      pendingMusicPlaybackRateToast = false
      showToast({ message: t('Video.Player.MusicPlaybackRateOverride'), icon: ['fas', 'gauge'] })
      musicPlaybackRateToastShown = true
    }

    /**
     * @returns {number | null}
     */
    function getCurrentPlaybackRate() {
      if (temporaryPlaybackRateActive && playbackRateBeforeTemporaryPlayback !== null) {
        return playbackRateBeforeTemporaryPlayback
      }

      const playerRate = normalizePlaybackRate(player?.getPlaybackRate())
      if (playerRate !== null) {
        return playerRate
      }

      const videoRate = normalizePlaybackRate(video.value?.playbackRate)
      if (videoRate !== null) {
        return videoRate
      }

      return normalizePlaybackRate(props.currentPlaybackRate)
    }

    /**
     * @param {number|null|undefined} rate
     */
    function queuePlaybackRateRestore(rate = getCurrentPlaybackRate()) {
      pendingPlaybackRateRestore = normalizePlaybackRate(rate)
    }

    function restorePendingPlaybackRate() {
      const playbackRate = pendingPlaybackRateRestore ?? getInitialPlaybackRate()
      pendingPlaybackRateRestore = null

      if (playbackRate === null || !video.value || !player) {
        return
      }

      video.value.defaultPlaybackRate = getDefaultPlaybackRateForVideo()

      try {
        if (Math.abs(playbackRate - video.value.defaultPlaybackRate) < 0.01) {
          player.cancelTrickPlay()
        } else {
          player.trickPlay(playbackRate, false)
        }
      } catch (error) {
        console.error('Failed to restore playback rate:', error)
      }
    }

    /**
     * @param {string} source
     */
    function activateTemporaryPlaybackRate(source) {
      if (!player || !video.value || !hasLoaded.value) {
        return
      }

      temporaryPlaybackRateSources.add(source)

      if (temporaryPlaybackRateActive) {
        return
      }

      const playbackRate = getCurrentPlaybackRate()
      if (playbackRate === null) {
        temporaryPlaybackRateSources.delete(source)
        return
      }

      playbackRateBeforeTemporaryPlayback = playbackRate
      wasPausedBeforeTemporaryPlayback = video.value.paused
      temporaryPlaybackRateActive = true

      try {
        const temporaryPlaybackRate = playbackRate * TEMPORARY_PLAYBACK_RATE_MULTIPLIER
        player.trickPlay(temporaryPlaybackRate, false)
        temporaryPlaybackRateIndicatorMessage.value = `${Number.parseFloat(temporaryPlaybackRate.toFixed(2))}x`
        showTemporaryPlaybackRateIndicator.value = true
        if (wasPausedBeforeTemporaryPlayback) {
          video.value.play()
        }
      } catch (error) {
        temporaryPlaybackRateSources.delete(source)
        playbackRateBeforeTemporaryPlayback = null
        wasPausedBeforeTemporaryPlayback = false
        temporaryPlaybackRateActive = false
        showTemporaryPlaybackRateIndicator.value = false
        console.error('Failed to apply temporary playback rate:', error)
      }
    }

    /**
     * @param {string} source
     */
    function startTemporaryPlaybackRateHold(source) {
      if (
        !player ||
        !video.value ||
        !hasLoaded.value ||
        !holdToDoublePlaybackSpeed.value ||
        temporaryPlaybackRateHoldTimeouts.has(source) ||
        temporaryPlaybackRateSources.has(source)
      ) {
        return
      }

      const timeoutId = setTimeout(() => {
        temporaryPlaybackRateHoldTimeouts.delete(source)
        activateTemporaryPlaybackRate(source)
      }, TEMPORARY_PLAYBACK_RATE_HOLD_DELAY_MS)

      temporaryPlaybackRateHoldTimeouts.set(source, timeoutId)
    }

    let preserveControlsOnTemporaryPause = false

    function restoreTemporaryPlaybackRate() {
      if (!temporaryPlaybackRateActive) {
        return
      }

      const playbackRate = playbackRateBeforeTemporaryPlayback

      try {
        if (playbackRate !== null) {
          if (Math.abs(playbackRate - getDefaultPlaybackRateForVideo()) < 0.01) {
            player?.cancelTrickPlay()
          } else {
            player?.trickPlay(playbackRate, false)
          }
        }

        if (wasPausedBeforeTemporaryPlayback && video.value && !video.value.paused) {
          preserveControlsOnTemporaryPause = true
          video.value.pause()
        }
      } catch (error) {
        console.error('Failed to restore playback after temporary playback rate:', error)
      } finally {
        playbackRateBeforeTemporaryPlayback = null
        wasPausedBeforeTemporaryPlayback = false
        temporaryPlaybackRateActive = false
        showTemporaryPlaybackRateIndicator.value = false
      }
    }

    /**
     * @param {string} source
     */
    function finishTemporaryPlaybackRateHold(source) {
      const timeoutId = temporaryPlaybackRateHoldTimeouts.get(source)
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
        temporaryPlaybackRateHoldTimeouts.delete(source)
      }

      temporaryPlaybackRateSources.delete(source)
      if (temporaryPlaybackRateSources.size === 0) {
        restoreTemporaryPlaybackRate()
      }
    }

    function cancelTemporaryPlaybackRateHolds() {
      temporaryPlaybackRateHoldTimeouts.forEach(timeoutId => clearTimeout(timeoutId))
      temporaryPlaybackRateHoldTimeouts.clear()
      temporaryPlaybackRateSources.clear()
      restoreTemporaryPlaybackRate()
    }

    watch(
      () => props.currentPlaybackRate,
      (playbackRate) => {
        if (hasLoaded.value) {
          return
        }

        if (normalizePlaybackRate(playbackRate) === null) {
          return
        }

        queuePlaybackRateRestore(getInitialPlaybackRate())

        if (video.value) {
          video.value.playbackRate = getInitialPlaybackRate()
        }
      }
    )

    watch(shouldUseNormalPlaybackRateByDefault, (shouldUseNormalPlaybackRate) => {
      const unforcedPlaybackRate = getCurrentPlaybackRate()

      if (video.value) {
        video.value.defaultPlaybackRate = getDefaultPlaybackRateForVideo()
      }

      if (!shouldUseNormalPlaybackRate || playbackRateUserSet) {
        return
      }

      queuePlaybackRateRestore(NORMAL_PLAYBACK_RATE)
      showMusicPlaybackRateToast(unforcedPlaybackRate)

      if (!hasLoaded.value || !player || !video.value) {
        if (video.value) {
          video.value.playbackRate = NORMAL_PLAYBACK_RATE
        }
        return
      }

      try {
        player.cancelTrickPlay()
      } catch (error) {
        console.error('Failed to apply normal playback rate default:', error)
      }
    })

    /**
     * @param {number} rate
     */
    function applyPlaybackRate(rate) {
      const newPlaybackRateString = rate.toFixed(2)
      const newPlaybackRate = parseFloat(newPlaybackRateString)

      // The following error is thrown if you go below 0.07:
      // The provided playback rate (0.05) is not in the supported playback range.
      if (newPlaybackRate > 0.07 && newPlaybackRate <= maxVideoPlaybackRate.value) {
        playbackRateUserSet = true

        if (Math.abs(newPlaybackRate - getDefaultPlaybackRateForVideo()) < 0.01) {
          player.cancelTrickPlay()
        } else {
          player.trickPlay(newPlaybackRate, false)
        }

        showValueChange(`${newPlaybackRateString}x`)
      }
    }

    /**
     * @param {number} step
     */
    function changePlayBackRate(step) {
      applyPlaybackRate(getCurrentPlaybackRate() + step)
    }

    /**
     * @param {number} rate
     */
    function isNormalPlaybackRate(rate) {
      return Math.abs(rate - NORMAL_PLAYBACK_RATE) < 0.01
    }

    function toggleNormalPlaybackRate() {
      const currentRate = getCurrentPlaybackRate()

      if (!isNormalPlaybackRate(currentRate)) {
        togglePlaybackRate = currentRate
        applyPlaybackRate(NORMAL_PLAYBACK_RATE)
      } else if (togglePlaybackRate != null) {
        applyPlaybackRate(togglePlaybackRate)
      }
    }

    function canSeek() {
      if (!player || !hasLoaded.value) {
        return false
      }

      const seekRange = player.seekRange()

      // Seeking not possible e.g. with HLS
      if (seekRange.start === seekRange.end || !seekingIsPossible.value) {
        return false
      }

      return true
    }

    /**
     * @param {number} seconds The number of seconds to seek by, positive values seek forwards, negative ones seek backwards
     * @param {boolean} canSeekResult Allow functions that have already checked whether seeking is possible, to skip the extra check (e.g. frameByFrame)
     * @param {boolean} showPopUp Whether to show a pop-up with the seconds seeked
     * @param {boolean} revealControls Whether seeking should reveal the player controls
     */
    function seekBySeconds(seconds, canSeekResult = false, showPopUp = false, revealControls = true) {
      if (!(canSeekResult || canSeek())) {
        return
      }

      const seekRange = player.seekRange()

      const video_ = video.value

      const currentTime = video_.currentTime
      const newTime = currentTime + seconds

      if (newTime < seekRange.start) {
        video_.currentTime = seekRange.start
      } else if (newTime > seekRange.end) {
        if (isLive.value) {
          player.goToLive()
        } else {
          video_.currentTime = seekRange.end
        }
      } else {
        video_.currentTime = newTime
      }
      if (showPopUp) {
        const popUpLayout = seconds > 0
          ? { icon: 'arrow-right', invertContentOrder: true }
          : { icon: 'arrow-left', invertContentOrder: false }
        // `+value` converts string back to float
        const formattedSeconds = +Math.abs(seconds).toFixed(2)
        showValueChange(`${formattedSeconds}s`, popUpLayout.icon, popUpLayout.invertContentOrder)
      }

      if (revealControls) showOverlayControls()
    }

    // #endregion mouse and keyboard helpers

    // #region mouse scroll handlers

    const mouseScrollThrottleWaitMs = 200

    /**
     * @param {WheelEvent} event
     */
    function mouseScrollPlaybackRate(event) {
      if ((event.deltaY < 0 || event.deltaX > 0)) {
        changePlayBackRate(0.05)
      } else if ((event.deltaY > 0 || event.deltaX < 0)) {
        changePlayBackRate(-0.05)
      }
    }
    const mouseScrollPlaybackRateThrottle = throttle(mouseScrollPlaybackRate, mouseScrollThrottleWaitMs)
    /**
     * @param {WheelEvent} event
     */
    function mouseScrollPlaybackRateHandler(event) {
      event.preventDefault()

      // Touchpad scroll = small deltaX/deltaY
      if (Math.abs(event.deltaX) <= 5 && Math.abs(event.deltaY) <= 5) {
        mouseScrollPlaybackRateThrottle(event)
      } else {
        mouseScrollPlaybackRate(event)
      }
    }

    /**
     * @param {WheelEvent} event
     */
    function mouseScrollSkip(event) {
      const seekMultiplier = seekIntervalMultiplyByPlaybackRate.value ? getCurrentPlaybackRate() : 1
      if ((event.deltaY < 0 || event.deltaX > 0)) {
        seekBySeconds(defaultSkipInterval.value * seekMultiplier, true)
      } else if ((event.deltaY > 0 || event.deltaX < 0)) {
        seekBySeconds(-defaultSkipInterval.value * seekMultiplier, true)
      }
    }
    const mouseScrollSkipThrottle = throttle(mouseScrollSkip, mouseScrollThrottleWaitMs)
    /**
     * @param {WheelEvent} event
     */
    function mouseScrollSkipHandler(event) {
      if (canSeek()) {
        event.preventDefault()

        // Touchpad scroll = small deltaX/deltaY
        if (Math.abs(event.deltaX) <= 5 && Math.abs(event.deltaY) <= 5) {
          mouseScrollSkipThrottle(event)
        } else {
          mouseScrollSkip(event)
        }
      }
    }

    /**
     * @param {WheelEvent} event
     */
    function mouseScrollVolume(event) {
      const video_ = video.value

      if (video_.muted && (event.deltaY < 0 || event.deltaX > 0)) {
        video_.muted = false
        video_.volume = 0
      }

      if (!video_.muted) {
        if ((event.deltaY < 0 || event.deltaX > 0)) {
          changeVolume(0.05)
        } else if ((event.deltaY > 0 || event.deltaX < 0)) {
          changeVolume(-0.05)
        }
      }
    }
    const mouseScrollVolumeThrottle = throttle(mouseScrollVolume, mouseScrollThrottleWaitMs)
    /**
     * @param {WheelEvent} event
     */
    function mouseScrollVolumeHandler(event) {
      if (!event.ctrlKey && !event.metaKey) {
        event.preventDefault()
        event.stopPropagation()

        // Touchpad scroll = small deltaX/deltaY
        if (Math.abs(event.deltaX) <= 5 && Math.abs(event.deltaY) <= 5) {
          mouseScrollVolumeThrottle(event)
        } else {
          mouseScrollVolume(event)
        }
      }
    }

    // #endregion mouse scroll handlers

    // #region keyboard shortcuts

    /**
     * @param {number} step
     */
    function frameByFrame(step) {
      if (props.format === 'audio' || !canSeek()) {
        return
      }

      video.value.pause()

      /** @type {number} */
      let fps
      if (props.format === 'legacy') {
        fps = activeLegacyFormat.value.fps
      } else {
        fps = player.getVariantTracks().find(track => track.active).frameRate
      }

      const frameTime = 1 / fps
      const dist = frameTime * step
      seekBySeconds(dist, true)
    }

    // Blur player buttons to remove :focus-visible state, preventing tooltips from staying visible
    const buttonWithTooltipClasses = [
      'shaka-play-button',
      'shaka-fullscreen-button',
      'shaka-mute-button',
      'shaka-pip-button',
      'full-window-button',
      'theatre-button',
      'screenshot-button',
    ]
    function blurTooltipButtons() {
      const element = document.activeElement
      if (buttonWithTooltipClasses.some(className => element.classList.contains(className))) {
        element.blur()
      }
    }

    /**
     * @param {EventTarget | null} target
     */
    function isEditableTarget(target) {
      if (!(target instanceof HTMLElement)) {
        return false
      }

      if (target.closest('.scrollMiniPlayerControls')) {
        return false
      }

      return target.classList.contains('ft-input') ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.getAttribute('role') === 'combobox' ||
        target.isContentEditable
    }

    /**
     * @param {KeyboardEvent} event
     * @returns {boolean}
     */
    function isSpaceKey(event) {
      return event.key === ' ' || event.key.toLowerCase() === 'spacebar'
    }

    /**
     * @param {KeyboardEvent} event
     */
    function keyboardShortcutKeyupHandler(event) {
      if (!isActiveTab.value || !isSpaceKey(event)) {
        return
      }

      const wasPending = temporaryPlaybackRateHoldTimeouts.has(TEMPORARY_PLAYBACK_RATE_KEYBOARD_SOURCE)
      const wasActive = temporaryPlaybackRateSources.has(TEMPORARY_PLAYBACK_RATE_KEYBOARD_SOURCE)

      if (!wasPending && !wasActive) {
        return
      }

      event.preventDefault()
      finishTemporaryPlaybackRateHold(TEMPORARY_PLAYBACK_RATE_KEYBOARD_SOURCE)

      if (wasPending && !wasActive && player && hasLoaded.value && video.value) {
        video.value.paused ? video.value.play() : video.value.pause()
        blurTooltipButtons()
      }
    }

    function handleTemporaryPlaybackRateFocusLoss() {
      cancelTemporaryPlaybackRateHolds()
      temporaryPlaybackRatePointerId = null
      temporaryPlaybackRatePointerCancelled = false
      suppressTemporaryPlaybackRateClick = false
    }

    function handleTemporaryPlaybackRateVisibilityChange() {
      if (isAppHidden()) {
        handleTemporaryPlaybackRateFocusLoss()
      }
    }

    /**
     * @param {KeyboardEvent} event
     */
    async function keyboardShortcutHandler(event) {
      if (!player || !isActiveTab.value) {
        return
      }

      if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) {
        return
      }

      const matches = shortcut => matchesKeyboardShortcut(event, shortcut)

      // exit fullscreen and/or fullwindow if keyboard shortcut modal is opened
      if (matches(KeyboardShortcuts.APP.GENERAL.SHOW_SHORTCUTS)) {
        event.preventDefault()

        if (ui.getControls().isFullScreenEnabled()) {
          ui.getControls().toggleFullScreen()
        }

        if (fullWindowEnabled.value) {
          events.dispatchEvent(new CustomEvent('setFullWindow', {
            detail: !fullWindowEnabled.value
          }))
        }

        return
      }

      // allow copying text
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
        return
      }

      // allow focusing on search bar without affecting the playback
      const searchShortcuts = KeyboardShortcuts.APP.GENERAL
      if ([
        searchShortcuts.FOCUS_SEARCH,
        searchShortcuts.FOCUS_SEARCH_ALT,
        searchShortcuts.FOCUS_SEARCH_ALT_MAC,
        searchShortcuts.FOCUS_SEARCH_ALT_SLASH,
      ].some(matches)) {
        return
      }

      const video_ = video.value

      // Skip to next video in playlist or recommended
      if (matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.SKIP_TO_NEXT)) {
        event.preventDefault()
        emit('skip-to-next')
        return
      }

      // Skip to previous video in playlist
      if (matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.SKIP_TO_PREV)) {
        event.preventDefault()
        emit('skip-to-prev')
        return
      }

      switch (true) {
        case matches(KeyboardShortcuts.VIDEO_PLAYER.GENERAL.FULLSCREEN):
          // Toggle full screen
          event.preventDefault()
          togglePlayerFullScreen()
          blurTooltipButtons()
          break
        case event.key.toLowerCase() === 'escape':
          // Exit full window
          if (fullWindowEnabled.value) {
            event.preventDefault()

            events.dispatchEvent(new CustomEvent('setFullWindow', {
              detail: false
            }))
          }
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.GENERAL.FULLWINDOW):
          // Toggle full window mode
          event.preventDefault()
          events.dispatchEvent(new CustomEvent('setFullWindow', {
            detail: !fullWindowEnabled.value
          }))
          blurTooltipButtons()
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.GENERAL.THEATRE_MODE):
          // Toggle theatre mode
          if (props.theatrePossible) {
            event.preventDefault()

            events.dispatchEvent(new CustomEvent('toggleTheatreMode', {
              detail: !props.useTheatreMode
            }))
          }
          blurTooltipButtons()
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.GENERAL.MUTE): {
          event.preventDefault()
          const isMuted = !video_.muted
          video_.muted = isMuted

          const messageIcon = isMuted ? 'volume-mute' : 'volume-high'
          const message = isMuted ? '0%' : `${Math.round(video_.volume * 100)}%`
          showValueChange(message, messageIcon)
          blurTooltipButtons()
          break
        }
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.TOGGLE_SKIP_SILENCE): {
          event.preventDefault()
          const enabled = !skipSilence.value
          updateSkipSilence(enabled)

          // Only confirm the state that was actually applied to this tab.
          if (skipSilence.value !== enabled) {
            break
          }

          const localization = ui.getControls().getLocalization()
          const message = localization.resolve(enabled ? 'ON' : 'OFF')
          showValueChange(message, ['step-forward', 'volume-xmark'], true)
          blurTooltipButtons()
          break
        }
      }

      if (event.defaultPrevented) {
        return
      }

      if (!hasLoaded.value) {
        return
      }

      if (event.key === 'Enter' && toggleActiveSponsorBlockSkipState()) {
        event.preventDefault()
        return
      }

      switch (true) {
        case isSpaceKey(event) && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey:
          event.preventDefault()
          if (holdToDoublePlaybackSpeed.value) {
            startTemporaryPlaybackRateHold(TEMPORARY_PLAYBACK_RATE_KEYBOARD_SOURCE)
          } else {
            video_.paused ? video_.play() : video_.pause()
            blurTooltipButtons()
          }
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.PLAY):
          // Toggle Play/Pause
          event.preventDefault()
          video_.paused ? video_.play() : video_.pause()
          blurTooltipButtons()
          break
        case !disableAbRepeat.value && matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.SET_AB_REPEAT_START):
          event.preventDefault()
          setCurrentAbRepeatBoundary('start')
          break
        case !disableAbRepeat.value && matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.SET_AB_REPEAT_END):
          event.preventDefault()
          setCurrentAbRepeatBoundary('end')
          break
        case !disableAbRepeat.value && matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.CLEAR_AB_REPEAT):
          event.preventDefault()
          clearAbRepeat()
          showValueChange(t('Video.Player.A-B Repeat.Cleared'), AB_REPEAT_VALUE_CHANGE_ICON)
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.LARGE_REWIND): {
          // Rewind by 2x the time-skip interval (in seconds)
          event.preventDefault()
          const largeRewindMultiplier = seekIntervalMultiplyByPlaybackRate.value ? getCurrentPlaybackRate() : 1
          seekBySeconds(-defaultSkipInterval.value * largeRewindMultiplier * 2, false, true)
          break
        }
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.LARGE_FAST_FORWARD): {
          // Fast-Forward by 2x the time-skip interval (in seconds)
          event.preventDefault()
          const largeFastForwardMultiplier = seekIntervalMultiplyByPlaybackRate.value ? getCurrentPlaybackRate() : 1
          seekBySeconds(defaultSkipInterval.value * largeFastForwardMultiplier * 2, false, true)
          break
        }
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.DECREASE_VIDEO_SPEED):
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.DECREASE_VIDEO_SPEED_ALT):
          // Decrease playback rate by user configured interval
          event.preventDefault()
          changePlayBackRate(-videoPlaybackRateInterval.value)
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.INCREASE_VIDEO_SPEED):
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.INCREASE_VIDEO_SPEED_ALT):
          // Increase playback rate by user configured interval
          event.preventDefault()
          changePlayBackRate(videoPlaybackRateInterval.value)
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.TOGGLE_NORMAL_PLAYBACK_SPEED):
          // Toggle between 1x and the previous playback speed
          event.preventDefault()
          toggleNormalPlaybackRate()
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.GENERAL.CAPTIONS): {
          // Toggle caption/subtitles
          if (toggleCaptions()) {
            event.preventDefault()
          }
          break
        }
        case matches(KeyboardShortcuts.VIDEO_PLAYER.GENERAL.VOLUME_UP):
          // Increase volume
          event.preventDefault()
          changeVolume(0.05)
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.GENERAL.VOLUME_DOWN):
          // Decrease Volume
          event.preventDefault()
          changeVolume(-0.05)
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.LAST_CHAPTER):
          if (props.chapters.length > 0 && props.currentChapterIndex > 0) {
            event.preventDefault()
            video_.currentTime = props.chapters[props.currentChapterIndex - 1].startSeconds
            showOverlayControls()
          }
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.NEXT_CHAPTER):
          if (props.chapters.length > 0 && props.currentChapterIndex < props.chapters.length - 1) {
            event.preventDefault()
            video_.currentTime = props.chapters[props.currentChapterIndex + 1].startSeconds
            showOverlayControls()
          }
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.SMALL_REWIND): {
          event.preventDefault()
          // Rewind by the time-skip interval (in seconds)
          const smallRewindMultiplier = seekIntervalMultiplyByPlaybackRate.value ? getCurrentPlaybackRate() : 1
          seekBySeconds(-defaultSkipInterval.value * smallRewindMultiplier, false, true)
          break
        }
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.SMALL_FAST_FORWARD): {
          event.preventDefault()
          // Fast-Forward by the time-skip interval (in seconds)
          const smallFastForwardMultiplier = seekIntervalMultiplyByPlaybackRate.value ? getCurrentPlaybackRate() : 1
          seekBySeconds(defaultSkipInterval.value * smallFastForwardMultiplier, false, true)
          break
        }
        case matches(KeyboardShortcuts.VIDEO_PLAYER.GENERAL.PICTURE_IN_PICTURE):
          // Toggle picture in picture
          if (props.format !== 'audio') {
            const controls = ui.getControls()
            if (controls.isPiPAllowed()) {
              event.preventDefault()
              controls.togglePiP()
            }
          }
          blurTooltipButtons()
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.SKIP_N_TENTHS): {
          // Jump to percentage in the video
          if (canSeek()) {
            event.preventDefault()

            // use seek range instead of duration so that it works for live streams too
            const seekRange = player.seekRange()

            const length = seekRange.end - seekRange.start
            const percentage = parseInt(event.key) / 10

            video_.currentTime = seekRange.start + (length * percentage)
            showOverlayControls()
          }
          break
        }
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.LAST_FRAME):
          if (video_.paused) {
            event.preventDefault()
            // Return to previous frame
            frameByFrame(-1)
          }
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.NEXT_FRAME):
          if (video_.paused) {
            event.preventDefault()
            // Advance to next frame
            frameByFrame(1)
          }
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.GENERAL.STATS):
          // Toggle stats display
          event.preventDefault()

          events.dispatchEvent(new CustomEvent('setStatsVisibility', {
            detail: !showStats.value
          }))
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.HOME):
          // Jump to beginning of video
          if (canSeek()) {
            event.preventDefault()
            // use seek range instead of duration so that it works for live streams too
            const seekRange = player.seekRange()
            video_.currentTime = seekRange.start
            showOverlayControls()
          }
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.END):
          // Jump to end of video
          if (canSeek()) {
            event.preventDefault()
            // use seek range instead of duration so that it works for live streams too
            const seekRange = player.seekRange()
            video_.currentTime = seekRange.end
            showOverlayControls()
          }
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.GENERAL.TAKE_SCREENSHOT):
          if (enableScreenshot.value && props.format !== 'audio') {
            event.preventDefault()
            // Take screenshot
            takeScreenshot()
          }
          blurTooltipButtons()
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.GENERAL.VIDEO_ZOOM_IN):
        case matches(KeyboardShortcuts.VIDEO_PLAYER.GENERAL.VIDEO_ZOOM_OUT):
          if (videoZoomPossible.value) {
            event.preventDefault()
            changeVideoZoom(matches(KeyboardShortcuts.VIDEO_PLAYER.GENERAL.VIDEO_ZOOM_IN) ? 1 : -1)
          }
          blurTooltipButtons()
          break
      }
    }

    // #endregion keyboard shortcuts

    let ignoreErrors = false

    /**
     * @param {shaka.util.Error} error
     * @param {string} context
     * @param {object?} details
     */
    function handleError(error, context, details) {
      // A previous critical error is already being handled, or the player is
      // unloading/destroying. Shaka can still dispatch errors from its queued
      // segment requests during that window; neither log nor emit them again.
      if (ignoreErrors) {
        return
      }

      // These two errors are just wrappers around another error, so use the original error instead
      // As they can be nested (e.g. multiple googlevideo redirects because the Invidious server was far away from the user) we should pick the inner most one
      while (error.code === ErrorCode.REQUEST_FILTER_ERROR || error.code === ErrorCode.RESPONSE_FILTER_ERROR) {
        error = error.data[0]
      }

      // Allow shaka-player to retry on potentially recoverable network errors
      if (error.severity === ErrorSeverity.RECOVERABLE && error.category === ErrorCategory.NETWORK) {
        /** @type {keyof ErrorCategory} */
        const categoryText = Object.keys(ErrorCategory).find((/** @type {keyof ErrorCategory} */ key) => ErrorCategory[key] === error.category)

        /** @type {keyof ErrorCode} */
        const codeText = Object.keys(ErrorCode).find((/** @type {keyof ErrorCode} */ key) => ErrorCode[key] === error.code)

        console.warn(
          'Recoverable network error retrying...\n' +
          `Category: ${categoryText} (${error.category})\n` +
          `Code: ${codeText} (${error.code})\n` +
          'Data', error.data
        )
        return
      }

      // Recoverable network errors, including routine SABR request aborts, return
      // above. Any remaining abort or lifecycle interruption is still not evidence
      // that the current format failed: loads are also cancelled during
      // reload/unload/destroy. Ignore these codes instead of dropping to legacy.
      if (
        error.code === ErrorCode.OPERATION_ABORTED ||
        error.code === ErrorCode.LOAD_INTERRUPTED ||
        error.code === ErrorCode.OBJECT_DESTROYED ||
        error.code === ErrorCode.CONTENT_NOT_LOADED ||
        error.code === ErrorCode.PRELOAD_DESTROYED
      ) {
        console.warn(`Ignoring player abort/interruption (code ${error.code}) in ${context}`)
        return
      }

      logShakaError(error, context, props.videoId, details)

      // Caption loading can also fail with MANIFEST errors (e.g. 4033).
      // Log caption and thumbnail failures without triggering video recovery.
      if (
        !ignoreErrors &&
        context !== 'addTextTrackAsync' &&
        error.category !== shaka.util.Error.Category.TEXT &&
        !(error.code === shaka.util.Error.Code.BAD_HTTP_STATUS && error.data[0].startsWith('https://www.youtube.com/api/timedtext'))
      ) {
        // don't react to multiple consecutive errors, otherwise we don't give the format fallback from the previous error a chance to work
        ignoreErrors = true

        emit('error', error)

        tabMediaCoordinator.setPlaybackState(mediaTabId, 'none')

        if (process.env.IS_ELECTRON && window.ftElectron?.tabs?.setPlaybackState) {
          window.ftElectron.tabs.setPlaybackState('none', tabId)
        }
      }
    }

    // #region seek bar markers

    function clearAbRepeatMarkers() {
      container.value?.querySelectorAll('.abRepeatMarker, .abRepeatRange').forEach(marker => marker.remove())
    }

    function refreshAbRepeatMarkers() {
      clearAbRepeatMarkers()

      const seekBarContainer = container.value?.querySelector('.shaka-seek-bar-container')
      if (
        disableAbRepeat.value ||
        !seekBarContainer ||
        !player ||
        (abRepeatStart.value === null && abRepeatEnd.value === null)
      ) {
        return
      }

      const { start, end } = player.seekRange()
      const duration = end - start
      if (!Number.isFinite(duration) || duration <= 0) {
        return
      }

      const markers = []
      if (hasValidAbRepeatRange()) {
        const range = document.createElement('div')
        range.className = `abRepeatRange${abRepeatEnabled.value ? '' : ' abRepeatRangeInactive'}`
        range.style.left = `${((abRepeatStart.value - start) / duration) * 100}%`
        range.style.width = `${((abRepeatEnd.value - abRepeatStart.value) / duration) * 100}%`
        markers.push(range)
      }

      markers.push(...[
        ['A', abRepeatStart.value],
        ['B', abRepeatEnd.value],
      ]
        .filter(([_point, time]) => time !== null && time >= start && time <= end)
        .map(([point, time]) => {
          const marker = document.createElement('button')
          marker.type = 'button'
          marker.className = `abRepeatMarker abRepeatMarker${point}${abRepeatEnabled.value ? '' : ' abRepeatMarkerInactive'}`
          marker.style.left = `calc(${((time - start) / duration) * 100}% - 22px)`
          marker.dataset.point = point
          marker.ariaLabel = t('Video.Player.A-B Repeat.Adjust Point', {
            point,
            timestamp: formatAbRepeatTimestamp(time),
          })
          marker.addEventListener('pointerdown', event => startAbRepeatMarkerDrag(
            point === 'A' ? 'start' : 'end',
            event
          ))
          marker.addEventListener('keydown', event => handleAbRepeatMarkerKeydown(
            point === 'A' ? 'start' : 'end',
            event
          ))
          return marker
        }))

      addMarkers(markers)
    }

    function clearSponsorBlockMarkers() {
      container.value.querySelectorAll('.sponsorBlockMarker').forEach(marker => marker.remove())
    }

    function getSponsorBlockMarkerDuration() {
      if (hasLoaded.value && player) {
        const { start, end } = player.seekRange()
        return end - start
      }

      return sponsorBlockAverageVideoDuration || getSponsorBlockSubmissionVideoDuration() || 0
    }

    function createSponsorBlockMarker(
      duration,
      startTime,
      endTime,
      title,
      className,
      isPointMarker = false,
      customColor = null
    ) {
      const markerDiv = document.createElement('div')

      markerDiv.title = title
      markerDiv.className = className
      if (customColor !== null) {
        markerDiv.style.setProperty('--primary-color', customColor)
      }
      if (isPointMarker) {
        markerDiv.style.left = `calc(${(startTime / duration) * 100}% - 1px)`
      } else {
        markerDiv.style.width = `${((endTime - startTime) / duration) * 100}%`
        markerDiv.style.left = `${(startTime / duration) * 100}%`
      }

      return markerDiv
    }

    function refreshSponsorBlockMarkers() {
      clearSponsorBlockMarkers()

      const duration = getSponsorBlockMarkerDuration()
      if (!Number.isFinite(duration) || duration <= 0) {
        return
      }

      const markers = sponsorBlockSegments.map((segment) => {
        const isPointMarker = isSponsorBlockPointSegment(segment)
        const color = sponsorSkips.value.categoryData[segment.category]?.color ?? 'Green'
        const customColor = isHexColor(color) ? color : null

        return createSponsorBlockMarker(
          duration,
          segment.startTime,
          segment.endTime,
          translateSponsorBlockCategory(segment.category),
          `sponsorBlockMarker${isPointMarker ? ' sponsorBlockPointMarker' : ''}${customColor === null ? ` main${color}` : ''}`,
          isPointMarker,
          customColor
        )
      })

      const draftMarkers = sponsorBlockCompleteDraftSegments.value
        .filter(segment => !isSponsorBlockFullVideoSegment(segment))
        .map((segment) => {
          const isPointMarker = isSponsorBlockPointSegment(segment)

          return createSponsorBlockMarker(
            duration,
            segment.startTime,
            segment.endTime,
            translateSponsorBlockCategory(segment.category),
            `sponsorBlockMarker sponsorBlockDraftMarker${isPointMarker ? ' sponsorBlockPointMarker' : ''}`,
            isPointMarker
          )
        })

      addMarkers(markers.concat(draftMarkers))
    }

    function createChapterMarkers() {
      const { start, end } = player.seekRange()
      const duration = end - start

      /**
       * @type {{
       *   title: string,
       *   timestamp: string,
       *   startSeconds: number,
       *   endSeconds: number,
       *   thumbnail?: string
       * }[]}
       */
      const chapters = props.chapters

      addMarkers(
        chapters.map(chapter => {
          const markerDiv = document.createElement('div')

          markerDiv.title = chapter.title
          markerDiv.className = 'chapterMarker'
          markerDiv.style.left = `calc(${(chapter.startSeconds / duration) * 100}% - 1px)`

          return markerDiv
        })
      )
    }

    /**
     * @param {HTMLElement[]} markers
     */
    function addMarkers(markers) {
      const seekBarContainer = container.value.querySelector('.shaka-seek-bar-container')

      if (seekBarContainer.firstElementChild?.classList.contains('markerContainer')) {
        /** @type {HTMLDivElement} */
        const markerBar = seekBarContainer.firstElementChild

        markers.forEach(marker => markerBar.appendChild(marker))
      } else {
        const markerBar = document.createElement('div')
        markerBar.className = 'markerContainer'

        markers.forEach(marker => markerBar.appendChild(marker))

        seekBarContainer.insertBefore(markerBar, seekBarContainer.firstElementChild)
      }
    }

    // #endregion seek bar markers

    // #region offline message

    const isOffline = ref(!navigator.onLine)
    const isBuffering = ref(false)

    function onlineHandler() {
      isOffline.value = false
    }

    function offlineHandler() {
      isOffline.value = true
    }

    function fullscreenChangeHandler() {
      const fullscreen = isNativeFullscreenActive()
      isFullscreen.value = fullscreen
      if (props.shortsPlayer) {
        resetShortsOverflowMenu()
      }
      suppressPanelTransitions(100)
      syncChapterOverlayButton()

      if (!isActiveTab.value) {
        return
      }

      setFullscreenOrientation(
        fullscreen,
        video.value,
        rotateFullscreenToLandscape.value && !player?.nativePlayback?.isFullscreenFromRotation()
      ).catch(() => {})
      syncAndroidStatusBarVisibility()

      if (fullscreen) {
        if (scrollMiniPlayerActive.value) {
          deactivateScrollMiniPlayer()
        }
        restoreDockedPanels()
      } else {
        if (!fullWindowEnabled.value) {
          rememberDockedPanels()
          closeFullscreenMetadata()
          closeFullscreenTranscript()
          closeFullscreenSponsorBlock()
          closeFullscreenLiveChat()
          closeFullscreenComments()
          closeFullscreenPlaylist()
        }
        updateScrollMiniPlayer()
      }

      nextTick(showOverlayControls)
    }

    function exitFullscreenHandler() {
      if (!process.env.IS_ELECTRON || !ui) return

      try {
        const controls = ui.getControls()
        // Exit fullscreen if enabled
        if (controls && controls.isFullScreenEnabled && controls.isFullScreenEnabled()) {
          controls.toggleFullScreen()
        }

        // Exit fullwindow if enabled
        if (fullWindowEnabled.value && events) {
          events.dispatchEvent(new CustomEvent('setFullWindow', {
            detail: false
          }))
        }
      } catch (error) {
        // Silently ignore errors if component is not fully initialized
        console.error('Error exiting fullscreen on tab switch:', error)
      }
    }

    /**
     * @param {MouseEvent} event
     */
    function handlePlaybackRateMenuClick(event) {
      const target = event.target
      if (!isActiveTab.value || !(target instanceof Element) || !container.value?.contains(target)) {
        return
      }
      const playbackRatesContainer = target.closest('.shaka-playback-rates')

      if (playbackRatesContainer) {
        const button = target.closest('button')

        if (button && !button.classList.contains('shaka-back-to-overflow-button')) {
          playbackRateUserSet = true
          setTimeout(() => {
            if (!player) {
              return
            }

            emit('playback-rate-user-set', player.getPlaybackRate())
          }, 10)
        }
      }
    }

    /**
     * @param {MouseEvent} event
     */
    function handleQualityMenuClick(event) {
      const target = event.target
      if (!isActiveTab.value || !(target instanceof Element) || !container.value?.contains(target)) {
        return
      }
      const resolutionsContainer = target.closest('.shaka-resolutions')

      if (resolutionsContainer) {
        const button = target.closest('button')

        if (button && !button.classList.contains('shaka-back-to-overflow-button')) {
          setTimeout(() => {
            if (!player || player.getConfiguration().abr.enabled) {
              return
            }

            const quality = getActiveVariantQuality()

            if (quality !== null) {
              emit('video-quality-user-set', quality)
            }
          }, 50)
        }
      }
    }

    window.addEventListener('online', onlineHandler)
    window.addEventListener('offline', offlineHandler)

    // Only display the offline message while buffering/the loading symbol is visible.
    // If we briefly lose the connection but it comes back before the buffer is empty,
    // the user won't notice anything so we don't need to display the message.
    const showOfflineMessage = computed(() => {
      return isOffline.value && isBuffering.value
    })

    // #endregion offline message

    // #region setup
    onMounted(async () => {
      const videoElement = video.value

      screenWakeBinding = playbackScreenWake?.bindVideo(videoElement, () =>
        !audioPlayerMode.value && !scrollMiniPlayerDismissed.value && (isActiveTab.value || isCrossTabMiniPlayerPresented.value)
      )

      voiceOverTranslation.attach(videoElement)

      await initializeActiveTab()

      const localPlayer = process.env.IS_CAPACITOR
        ? createAndroidPlayer(videoElement, container.value, () => ({
            presented: isActiveTab.value || isCrossTabMiniPlayerPresented.value,
            vrCanvas: vrCanvas.value,
            sabrData: props.sabrData,
            captions: props.captions,
            audioOnly: props.format === 'audio',
            skipSilence: skipSilence.value,
            continueInBackground: store.getters.getContinuePlaybackWhenScreenIsLocked,
            seekSeconds: defaultSkipInterval.value,
            scaleSeekWithRate: seekIntervalMultiplyByPlaybackRate.value,
            fullscreenOnRotation: enterFullscreenOnDisplayRotate.value,
            locale: locale.value,
            metadata: { title: props.title, artist: props.artist, artwork: props.thumbnail },
            onOwnerChange: owner => tabMediaCoordinator.setNativeOwner(mediaTabId, owner),
            onReload: () => emit('player-reload-requested', getSabrReloadState()),
            onBackoff: ({ backoffMs }) => startSabrBackoffTimer(backoffMs),
          }))
        : new shaka.Player()

      ui = new shaka.ui.Overlay(
        localPlayer,
        container.value,
        videoElement,
        vrCanvas.value
      )

      // This has to be called after creating the UI, so that the player uses the UI's UITextDisplayer
      // otherwise it uses the browsers native captions which get displayed underneath the UI controls
      await localPlayer.attach(videoElement)

      const initialPlaybackRate = getInitialPlaybackRate()
      queuePlaybackRateRestore(initialPlaybackRate)
      videoElement.playbackRate = initialPlaybackRate
      videoElement.defaultPlaybackRate = getDefaultPlaybackRateForVideo()

      // check if the component is already getting destroyed
      // which is possible because this function runs asynchronously
      if (!ui) {
        return
      }

      const controls = ui.getControls()
      player = controls.getPlayer()
      if (player.nativePlayback) {
        player.nativePlayback.bindControls(controls)
        const removeOwnershipListener = tabMediaCoordinator.subscribeOwnership(mediaTabId, active => {
          localPlayer.nativePlayback.setPresented(active).catch(error => handleError(error, 'native playback ownership'))
        })
        const stopBackgroundWatch = watch(() => store.getters.getContinuePlaybackWhenScreenIsLocked, enabled => {
          localPlayer.nativePlayback.setContinueInBackground(enabled)?.catch(error => handleError(error, 'native background preference'))
        })
        const stopSeekWatch = watch([defaultSkipInterval, seekIntervalMultiplyByPlaybackRate], ([seconds, scaleWithRate]) => {
          localPlayer.nativePlayback.setSeekPreferences(seconds, scaleWithRate)?.catch(error => handleError(error, 'native seek preference'))
        })
        nativePlaybackCleanup = () => { removeOwnershipListener(); stopBackgroundWatch(); stopSeekWatch() }
      }
      wrapTextTrackSelection()
      player.addEventListener('textchanged', syncShortsCaptionsEnabled)

      player.addEventListener('buffering', event => {
        isBuffering.value = event.buffering
      })

      player.addEventListener('error', event => handleError(event.detail, 'shaka error handler'))

      player.configure(getPlayerConfig(props.format, preferAutoQuality.value))

      if (process.env.SUPPORTS_LOCAL_API) {
        player.getNetworkingEngine().registerRequestFilter(requestFilter)
        player.getNetworkingEngine().registerResponseFilter(responseFilter)
      }
      if (process.env.IS_ELECTRON) {
        player.getNetworkingEngine().registerRequestFilter(async (_type, request) => {
          request.uris = await Promise.all(request.uris.map(url => getSubtitleRequestUrl(url, store.getters)))
        })
      }
      player.getNetworkingEngine().registerRequestFilter(silenceSkippingRequestFilter)
      player.getNetworkingEngine().registerResponseFilter(silenceSkippingResponseFilter)

      await setLocale(locale.value)

      if (isMusicVideoDetected.value) {
        showMusicPlaybackRateToast(getUnforcedPlaybackRate())
      }

      // check if the component is already getting destroyed
      // which is possible because this function runs asynchronously
      if (!ui || !player) {
        return
      }

      videoResizeObserver.observe(videoElement)

      registerScreenshotButton()
      registerAudioTrackSelection()
      registerCaptionSelection()
      registerCaptionToggleButton()
      registerChapterOverlayButton()
      registerAutoplayToggle()
      registerAmbientModeButton()
      registerMusicVisualizerButton()
      registerVideoZoomSelection()
      registerSkipSilenceButton()
      registerVoiceOverTranslationButton()
      registerSleepTimer()
      registerAbRepeatControl()

      registerTheatreModeButton()
      registerFullWindowButton()
      registerAndroidPictureInPictureButton()
      registerShortsVideoInfoButton()

      if (
        props.autoOpenChapters &&
        props.chapters.length > 0 &&
        !isNativeFullscreenActive() &&
        !fullWindowEnabled.value
      ) {
        emit('chapters-overlay-change', true)
      }

      registerLegacyQualitySelection()
      registerContextMenuButtons()
      registerStatsButton()
      registerSponsorBlockSubmissionButtons()
      registerSponsorBlockHighlightButton()
      registerSkipButtons()
      registerPlaybackAdjustedTime()
      registerQuickPlaybackRateBar()

      registeredCustomControls = true
      liveCustomControlPlayers++

      if (ui.isMobile()) {
        onlyUseOverFlowMenu.value = true
      } else {
        const initialWidth = container.value.getBoundingClientRect().width
        // A zero width means the player mounted in a non-presented tab (an
        // ancestor is display:none), not that the player is actually narrow.
        // Default to the full control bar; the resize/presentation remeasure
        // decides the real layout once the tab is visible.
        onlyUseOverFlowMenu.value = initialWidth > 0 && initialWidth <= USE_OVERFLOW_MENU_WIDTH_THRESHOLD

        containerResizeObserver = new ResizeObserver(resized)
        containerResizeObserver.observe(container.value)
      }

      controls.addEventListener('uiupdated', addUICustomizations)
      configureUI(true)

      applyInitialVolume(videoElement)

      document.removeEventListener('keydown', keyboardShortcutHandler)
      document.addEventListener('keydown', keyboardShortcutHandler)
      document.addEventListener('keyup', keyboardShortcutKeyupHandler)
      document.addEventListener('keydown', handleVideoZoomModifierKey)
      document.addEventListener('keyup', handleVideoZoomModifierKey)
      // Not a template listener: it only swallows the click that shaka-player
      // would otherwise read as play/pause at the end of a pan.
      container.value?.addEventListener('click', handleVideoZoomClickCapture, true)
      document.addEventListener('pointerup', handleTemporaryPlaybackRatePointerUp, true)
      document.addEventListener('pointercancel', handleTemporaryPlaybackRatePointerCancel, true)
      document.addEventListener('visibilitychange', handleTemporaryPlaybackRateVisibilityChange)
      document.addEventListener('fullscreenchange', fullscreenChangeHandler)
      // Use event delegation on document with capture phase to catch events before shaka-no-propagation stops them from bubbling
      document.addEventListener('click', handlePlaybackRateMenuClick, true)
      document.addEventListener('click', handleQualityMenuClick, true)

      // Set up IPC listener for exit fullscreen when tab becomes inactive (Electron only)
      // Only set up after UI is fully initialized
      if (process.env.IS_ELECTRON && ui && window.ftElectron?.tabs?.onExitFullscreen) {
        try {
          exitFullscreenCleanup = window.ftElectron.tabs.onExitFullscreen(exitFullscreenHandler, tabId)
        } catch (error) {
          console.error('Failed to set up exit fullscreen listener:', error)
        }
      }

      setupAutoPictureInPicture()

      if (container.value && props.format !== 'audio' && typeof IntersectionObserver !== 'undefined') {
        setupScrollMiniIntersectionObserver()
      }

      window.addEventListener('scroll', handleScrollMiniWindowScroll, { passive: true })
      window.addEventListener('resize', handleScrollMiniWindowResize)
      window.addEventListener('blur', handleTemporaryPlaybackRateFocusLoss)

      player.addEventListener('loading', () => {
        silenceSkipping.reset()
        hasLoaded.value = false
        hasPlaybackPosition.value = false
        videoLayoutReady.value = false
        annotationVideoAspectRatio.value = null
        if (props.shortsPlayer) {
          shortsPaused.value = false
          shortsCaptionsAvailable.value = false
          shortsCaptionsEnabled.value = false
        }
        chapterThumbnails.value = []
      })

      player.addEventListener('loaded', handleLoaded)
      player.addEventListener('variantchanged', () => {
        if (props.format === 'legacy' || player.getConfiguration().abr.enabled) {
          return
        }

        const quality = getActiveVariantQuality()

        if (quality !== null) {
          emit('video-quality-updated', quality)
        }
      })

      if (props.format !== 'legacy') {
        player.addEventListener('streaming', () => {
          if (props.format === 'dash') {
            const firstVariant = player.getVariantTracks()[0]

            // force the player aspect ratio to 16:9 to avoid overflowing the layout
            forceAspectRatio.value = firstVariant != null && !props.shortsPlayer &&
              firstVariant.width / firstVariant.height < 1.5
          }
        })
      } else if (props.legacyFormats.length > 0) {
        // force the player aspect ratio to 16:9 to avoid overflowing the layout, when the video is too tall

        const firstFormat = props.legacyFormats[0]
        forceAspectRatio.value = !props.shortsPlayer &&
          firstFormat.width / firstFormat.height < 1.5
      }

      if (useSponsorBlock.value) {
        setupSponsorBlock()
        if (sponsorBlockInfoOpen.value) {
          refreshSponsorBlockContributionStats()
        }
      }

      // shaka-player doesn't start with the cursor hidden, so hide it here for instances in which the
      // cursor is in the video player area when the video first loads
      container.value.classList.add('no-cursor')

      await performFirstLoad()
      // Whatever runs after `performFirstLoad` might be after switching to another page due to SABR backoff

      player?.addEventListener('ratechange', () => {
        const playbackRate = player.getPlaybackRate()
        if (!temporaryPlaybackRateActive) {
          emit('playback-rate-updated', playbackRate)
        }
        scheduleSponsorBlockSkip()
        scheduleAbRepeatBoundary()
      })
    })
    onUnmounted(() => {
      clearSabrBackoffTimer()
      clearPreRollTimer()
      clearTimeout(sponsorBlockHighlightLabelTimeout)
      cancelSponsorBlockSkipSchedule()
      clearAbRepeatBoundarySchedule()
      abRepeatDragCleanup?.()
    })

    async function performFirstLoad(isCurrentLoad = () => true) {
      if (process.env.SUPPORTS_LOCAL_API && sabrStream) {
        // Longer timeout for receiving larger responses
        player.configure({
          streaming: {
            retryParameters: {
              timeout: 30 * 1000 * 2,
            }
          }
        })
      } else {
        // Reset to default value
        player.configure({
          streaming: {
            retryParameters: {
              timeout: 30 * 1000,
            }
          }
        })
      }

      const initialLoadDelayMs = props.delayLoadUntilUnix - Date.now()
      if (initialLoadDelayMs > 0 && (props.format === 'legacy' || props.manifestMimeType !== MANIFEST_TYPE_SABR)) {
        startPreRollTimer(initialLoadDelayMs)
        await new Promise((resolve) => setTimeout(resolve, initialLoadDelayMs))
        clearPreRollTimer()
        if (!ui || !player || !isCurrentLoad()) return
      }

      if (props.format === 'dash' || props.format === 'audio') {
        try {
          await player.load(props.manifestSrc, props.startTime, props.manifestMimeType)
          if (!ui || !player || !isCurrentLoad()) return

          if (props.format === 'dash') {
            // Let shaka-player's ABR pick the variant when auto quality is preferred
            if (!preferAutoQuality.value) {
              setDashQuality(preferredVideoQuality.value)
            }
          } else {
            let variants = player.getVariantTracks()

            if (hasMultipleAudioTracks.value) {
              variants = getDefaultAudioVariants(variants)
            }

            if (variants.length > 0) {
              const highestBandwidth = Math.max(...variants
                .map(variant => variant.audioBandwidth)
                .filter(Number.isFinite))
              const selectedVariant = variants.find(variant => (
                variant.audioBandwidth === highestBandwidth
              )) ?? variants[0]

              player.selectVariantTrack(selectedVariant)
            }
          }
        } catch (error) {
          if (ui && player && isCurrentLoad()) {
            handleError(error, 'loading dash/audio manifest and setting default quality in mounted')
          }
        }
      } else {
        await setLegacyQuality(props.startTime)
      }
    }

    /**
     * Adds the captions and thumbnail tracks, also restores the previously selected captions track,
     * if this was triggered by a format change and the user had the captions enabled.
     */
    async function handleLoaded() {
      togglePlaybackRate = null
      hasLoaded.value = true
      // Ideally we would set this in the `streaming` event handler, but for HLS this is only set to true after the loaded event fires.
      isLive.value = player.isLive()
      restorePendingPlaybackRate()
      const mediaElement = video.value
      if (props.format === 'legacy' && activeLegacyFormat.value?.localFile &&
        mediaElement.videoWidth > 0 && mediaElement.videoHeight > 0) {
        const format = activeLegacyFormat.value
        format.width = mediaElement.videoWidth
        format.height = mediaElement.videoHeight
        format.qualityLabel = `${format.width}×${format.height} • ${format.localFileLabel}`
        events.dispatchEvent(new CustomEvent('legacyFormatMetadataChanged'))
      }
      emit('loaded', {
        duration: mediaElement.duration,
        width: mediaElement.videoWidth,
        height: mediaElement.videoHeight
      })

      nextTick(() => {
        rememberInlinePlayerLayoutHeight()
      })

      // getAudioTracks() returns an empty array when no variant is active, so we can't do this in the `streaming` event
      hasMultipleAudioTracks.value = deduplicateAudioTracks(player.getAudioTracks()).size > 1

      if (process.env.SUPPORTS_LOCAL_API && props.format !== 'legacy' && props.manifestMimeType === MANIFEST_TYPE_SABR) {
        sabrManifest = player.getManifest()
      }

      // Shaka cannot add external text tracks to a live presentation. Keep any
      // captions supplied by the live manifest instead. SABR already includes
      // the thumbnails, chapters and subtitles in its manifest.
      if (!isLive.value && (!process.env.SUPPORTS_LOCAL_API || props.format === 'legacy' || props.manifestMimeType !== MANIFEST_TYPE_SABR)) {
        const promises = []

        for (const caption of props.captions) {
          if (props.format === 'legacy') {
            const url = new URL(caption.url)

            if (url.hostname.endsWith('.youtube.com') && url.pathname === '/api/timedtext' &&
              url.searchParams.get('caps') === 'asr' && url.searchParams.get('kind') === 'asr' && url.searchParams.get('fmt') === 'vtt') {
              promises.push((async () => {
                try {
                  const response = await fetch(await getSubtitleRequestUrl(caption.url, store.getters))
                  let text = await response.text()

                  // position:0% for LTR text and position:100% for RTL text
                  text = text.replaceAll(/ align:start position:(?:10)?0%$/gm, '')

                  const url = `data:${caption.mimeType};charset=utf-8,${encodeURIComponent(text)}`

                  await player.addTextTrackAsync(
                    url,
                    caption.language,
                    'captions',
                    caption.mimeType,
                    undefined, // codec, only needed if the captions are inside a container (e.g. mp4)
                    caption.label
                  )
                } catch (error) {
                  if (error instanceof shaka.util.Error) {
                    handleError(error, 'addTextTrackAsync', caption)
                  } else {
                    console.error(error)
                  }
                }
              })())
            } else {
              promises.push(
                addCaptionTrack(caption)
                  .catch(error => handleError(error, 'addTextTrackAsync', caption))
              )
            }
          } else {
            promises.push(
              addCaptionTrack(caption)
                .catch(error => handleError(error, 'addTextTrackAsync', caption))
            )
          }
        }

        if (!isLive.value && props.storyboardSrc) {
          promises.push(
            // Only log the error, as the thumbnails are a nice to have
            // If an error occurs with them, it's not critical
            player.addThumbnailsTrack(props.storyboardSrc, 'text/vtt')
              .catch(error => logShakaError(error, 'addThumbnailsTrack', props.videoId, props.storyboardSrc))
          )
        }

        await Promise.all(promises)
      }

      loadChapterThumbnails()

      if (restoreCaptionIndex !== null) {
        const index = restoreCaptionIndex
        restoreCaptionIndex = null

        const textTrack = player.getTextTracks()[index]

        if (textTrack) {
          player.selectTextTrack(textTrack, false)
        }
      }
      syncShortsCaptionsEnabled()
      emit('subtitles-state-updated', player.getTextTracks().some(track => track.active))

      if (props.chapters.length > 0) {
        createChapterMarkers()
      }
      refreshAbRepeatMarkers()

      applyPendingPresentationModes()

      if (props.resumePlaybackAfterSabrReload) {
        video.value?.play()
      }
      if (props.resumePlaybackAfterSabrReload || suppressInitialAutoplay) {
        emit('resume-playback-after-sabr-reload-done')
      }
    }

    async function unloadForFormatSwitch() {
      // The previous frame disappears when Shaka unloads. Keep the normal
      // player dimensions filled with the thumbnail until the new format has
      // produced a frame of its own.
      showPoster.value = true

      try {
        await player.unload()
      } catch { }
    }

    let formatSwitchGeneration = 0
    /**
     * A newer source update can supersede a format switch after it has paused
     * and unloaded the media element. Keep the user's state from before the
     * first switch so the latest generation does not mistake that pause for
     * user intent or restart from the beginning.
     * @type {{
     *   oldFormat: 'dash'|'audio'|'legacy',
     *   wasPaused: boolean,
     *   playbackRate: number|null,
     *   playbackPosition: number,
     *   useAutoQuality: boolean,
     *   audioBandwidth: number|undefined,
     *   label: string|undefined,
     *   previousQuality: number|undefined
     * } | null}
     */
    let pendingFormatSwitchState = null

    watch(
      () => [props.format, props.playbackSourceKey],
      /**
       * Handles changing between formats. It tries its best to backup and restore the settings:
       * - playback position
       * - paused state
       * - playback rate
       * - audio track
       * - captions track
       * - video quality
       * @param {'dash'|'audio'|'legacy'} newFormat
       * @param {'dash'|'audio'|'legacy'} oldFormat
       */
      async ([newFormat], [oldFormat]) => {
        const generation = ++formatSwitchGeneration
        const isCurrentFormatSwitch = () => generation === formatSwitchGeneration
        ignoreErrors = true

        // format switch happened before the player loaded, probably because of an error
        // as there are no previous player settings to restore, we should treat it like this was the original format
        if (!hasLoaded.value && pendingFormatSwitchState === null) {
          await unloadForFormatSwitch()
          if (!isCurrentFormatSwitch()) return
          ensureSabrStream()

          if (newFormat === 'audio' && props.thumbnail) {
            // A media element that has already painted video frames may keep
            // its last frame instead of showing a newly assigned poster. Reset
            // it after Shaka detaches the video source so audio-only playback
            // reliably returns to the thumbnail.
            video.value.poster = props.thumbnail
            video.value.load()
          }

          ignoreErrors = false

          player.configure(getPlayerConfig(newFormat, preferAutoQuality.value))

          await performFirstLoad(isCurrentFormatSwitch)
          return
        }

        const video_ = video.value
        if (pendingFormatSwitchState === null) {
          const activeVariant = oldFormat === 'legacy'
            ? undefined
            : player.getVariantTracks().find(track => track.active)
          const activeCaptionIndex = player.getTextTracks().findIndex(caption => caption.active)

          pendingFormatSwitchState = {
            oldFormat,
            wasPaused: video_.paused,
            playbackRate: getCurrentPlaybackRate(),
            playbackPosition: video_.currentTime,
            // The legacy formats don't have an ABR configuration to carry over,
            // so fall back to the user's preference when switching away from them.
            useAutoQuality: oldFormat === 'legacy'
              ? preferAutoQuality.value
              : player.getConfiguration().abr.enabled,
            audioBandwidth: typeof activeVariant?.audioBandwidth === 'number'
              ? activeVariant.audioBandwidth
              : undefined,
            label: activeVariant?.label || undefined,
            previousQuality: oldFormat === 'dash' && activeVariant
              ? (activeVariant.height > activeVariant.width ? activeVariant.width : activeVariant.height)
              : undefined
          }

          if (!pendingFormatSwitchState.wasPaused) {
            video_.pause()
          }

          if (activeCaptionIndex >= 0) {
            restoreCaptionIndex = activeCaptionIndex

            // hide captions before switching as shaka/the browser doesn't clean up the displayed captions
            // when switching away from the legacy formats
            player.selectTextTrack(null, false)
          } else {
            restoreCaptionIndex = null
          }

          // Shaka clears its manifest before unload() finishes. A timeupdate can
          // still arrive from the media element in that window, so stop handlers
          // from querying player state as soon as the format switch begins.
          hasLoaded.value = false
        }

        const {
          oldFormat: sourceFormat,
          wasPaused,
          playbackRate,
          playbackPosition,
          useAutoQuality,
          audioBandwidth,
          label,
          previousQuality
        } = pendingFormatSwitchState

        if (newFormat === 'audio' || newFormat === 'dash') {
          let dimension

          if (sourceFormat === 'legacy' && newFormat === 'dash') {
            if (!useAutoQuality) {
              // Use the preferred quality instead of the active legacy format's dimensions, as the
              // legacy formats top out at 360p and the user may never have chosen that themselves
              dimension = preferredVideoQuality.value
            }
          }

          if (sourceFormat === 'audio' && newFormat === 'dash' && !useAutoQuality) {
            dimension = preferredVideoQuality.value
          }

          await unloadForFormatSwitch()
          if (!isCurrentFormatSwitch()) return
          ensureSabrStream()

          if (newFormat === 'audio' && props.thumbnail) {
            video_.poster = props.thumbnail
            video_.load()
          }

          ignoreErrors = false
          queuePlaybackRateRestore(playbackRate)

          player.configure(getPlayerConfig(newFormat, useAutoQuality))

          try {
            await player.load(props.manifestSrc, playbackPosition, props.manifestMimeType)
            if (!isCurrentFormatSwitch()) return

            if (useAutoQuality) {
              if (label) {
                const audioTracks = deduplicateAudioTracks(player.getAudioTracks()).values()

                for (const track of audioTracks) {
                  if (label === track.label) {
                    player.selectAudioTrack(track)
                    break
                  }
                }
              }
            } else {
              if (dimension) {
                setDashQuality(dimension, audioBandwidth, label)
              } else {
                let variants = player.getVariantTracks()

                if (label) {
                  variants = variants.filter(variant => variant.label === label)
                } else if (variants.length > 1) {
                  variants = getDefaultAudioVariants(variants)
                }

                let chosenVariant

                if (typeof audioBandwidth === 'number') {
                  chosenVariant = findMostSimilarAudioBandwidth(variants, audioBandwidth)
                } else {
                  chosenVariant = variants.reduce((previous, current) => {
                    return previous === null || current.bandwidth > previous.bandwidth ? current : previous
                  }, null)
                }

                if (chosenVariant) {
                  player.selectVariantTrack(chosenVariant)
                }
              }
            }
          } catch (error) {
            if (!isCurrentFormatSwitch()) return
            handleError(error, 'loading dash/audio manifest for format switch', `${sourceFormat} -> ${newFormat}`)
          }
          activeLegacyFormat.value = null
        } else {
          await unloadForFormatSwitch()
          if (!isCurrentFormatSwitch()) return

          ignoreErrors = false

          await setLegacyQuality(playbackPosition, previousQuality, playbackRate)
          if (!isCurrentFormatSwitch()) return
        }

        pendingFormatSwitchState = null
        if (wasPaused) {
          video_.pause()
        } else {
          video_.play()
        }
      }
    )

    // #endregion setup

    watch(() => skippedSponsorBlockSegments.value.length, (length) => {
      if (length > 0) {
        sponsorBlockToastNow.value = Date.now()
        startSponsorBlockToastTimer()
      } else {
        stopSponsorBlockToastTimer()
      }
    })

    // #region tear down

    onBeforeUnmount(() => {
      screenWakeBinding?.destroy()
      screenWakeBinding = null
      clearTimeout(paidPromotionTimer)
      if (fullscreenDockLayoutFrame !== null) {
        cancelAnimationFrame(fullscreenDockLayoutFrame)
      }
      cancelPendingVolumeUserSet()
      fullWindowAnimation?.cancel()
      hasLoaded.value = false
      closeFullscreenMetadata()
      closeFullscreenTranscript()
      closeFullscreenSponsorBlock()
      closeFullscreenLiveChat()
      closeFullscreenComments()
      closeFullscreenPlaylist()
      if (document.body.dataset.playerFullWindowOwner === mediaTabId) {
        delete document.body.dataset.playerFullWindowOwner
        document.body.classList.remove('playerFullWindow')
      }

      document.removeEventListener('keydown', keyboardShortcutHandler)
      document.removeEventListener('keyup', keyboardShortcutKeyupHandler)
      document.removeEventListener('keydown', handleVideoZoomModifierKey)
      document.removeEventListener('keyup', handleVideoZoomModifierKey)
      container.value?.removeEventListener('click', handleVideoZoomClickCapture, true)
      document.removeEventListener('pointerup', handleTemporaryPlaybackRatePointerUp, true)
      document.removeEventListener('pointercancel', handleTemporaryPlaybackRatePointerCancel, true)
      document.removeEventListener('visibilitychange', handleTemporaryPlaybackRateVisibilityChange)
      document.removeEventListener('fullscreenchange', fullscreenChangeHandler)
      document.removeEventListener('click', handlePlaybackRateMenuClick, true)
      document.removeEventListener('click', handleQualityMenuClick, true)
      window.removeEventListener('blur', handleTemporaryPlaybackRateFocusLoss)
      player?.removeEventListener('textchanged', syncShortsCaptionsEnabled)

      cancelTemporaryPlaybackRateHolds()

      // Clean up IPC listener for exit fullscreen
      if (exitFullscreenCleanup) {
        exitFullscreenCleanup()
        exitFullscreenCleanup = null
      }

      teardownAutoPictureInPicture()
      teardownScrollMiniPlayer()

      if (containerResizeObserver) {
        containerResizeObserver.disconnect()
        containerResizeObserver = null
      }

      if (overflowMenuResizeObserver) {
        overflowMenuResizeObserver.disconnect()
        overflowMenuResizeObserver = null
      }

      if (overflowMenuMutationObserver) {
        overflowMenuMutationObserver.disconnect()
        overflowMenuMutationObserver = null
      }

      if (overflowMenuTitleFrame !== null) {
        cancelAnimationFrame(overflowMenuTitleFrame)
        overflowMenuTitleFrame = null
      }

      if (overflowMenuElement) {
        removeOverlayScrollbars(overflowMenuElement)
        overflowMenuElement = null
      }

      if (controlPanelResizeObserver) {
        controlPanelResizeObserver.disconnect()
        controlPanelResizeObserver = null
      }

      if (controlPanelMutationObserver) {
        controlPanelMutationObserver.disconnect()
        controlPanelMutationObserver = null
      }

      if (fullscreenControlsVisibilityObserver) {
        fullscreenControlsVisibilityObserver.disconnect()
        fullscreenControlsVisibilityObserver = null
      }

      const controls = ui?.getControls()
      controls?.removeEventListener('submenuopen', handleSubMenuOpen)
      controls?.removeEventListener('submenuclose', handleSubMenuClose)

      if (!androidStatusBarVisible) {
        androidStatusBarVisible = true
        setAndroidStatusBarVisible(true).catch(() => {})
      }

      if (controlPanelLayoutFrame !== null) {
        cancelAnimationFrame(controlPanelLayoutFrame)
        controlPanelLayoutFrame = null
      }

      if (videoResizeObserver) {
        videoResizeObserver.disconnect()
      }

      cleanUpCustomPlayerControls()

      videoZoomTouchPointers.clear()
      videoZoomPinchStart = null
      videoZoomGestureZoom.value = null
      clearTimeout(videoZoomSuppressClickTimer)

      tabMediaCoordinator.setMiniPlayer(mediaTabId, false)
      tabMediaCoordinator.setActionHandlers(mediaTabId, 'player', {})
      tabMediaCoordinator.setPlaybackState(mediaTabId, 'none')

      // Clear tab playback state indicator when player is destroyed
      if (process.env.IS_ELECTRON && window.ftElectron?.tabs?.setPlaybackState) {
        window.ftElectron.tabs.setPlaybackState('none', tabId)
      }

      skippedSponsorBlockSegments.value.forEach(segment => clearTimeout(segment.timeoutId))
      promptSponsorBlockSegments.value = []
      stopSponsorBlockToastTimer()
      clearSponsorBlockNotFoundRefetchTimeout()
      sponsorBlockMuteController.reset()

      window.removeEventListener('online', onlineHandler)
      window.removeEventListener('offline', offlineHandler)
    })

    // #endregion tear down

    // #region functions used by the watch page

    function isPaused() {
      return video.value.paused
    }

    function pause() {
      video.value.pause()
    }

    function play() {
      return video.value.play()
    }

    function getCurrentTime() {
      return video.value.currentTime
    }

    /**
     * @param {number} time
     */
    function setCurrentTime(time) {
      video.value.currentTime = time
    }

    function getSabrReloadState() {
      const captionIndex = player?.getTextTracks().findIndex(caption => caption.active) ?? -1

      return {
        wasPlaying: !video.value?.paused,
        captionIndex: captionIndex >= 0 ? captionIndex : null,
        playbackRate: getCurrentPlaybackRate(),
        videoQuality: getActiveVariantQuality()
      }
    }

    function retryStreaming() {
      if (!player) return false
      ignoreErrors = false
      return player.retryStreaming()
    }

    /**
     * Vue's lifecycle hooks are synchonous, so if we destroy the player in {@linkcode onBeforeUnmount},
     * it won't be finished in time, as the player destruction is asynchronous.
     * To workaround that we destroy the player first and wait for it to finish before we unmount this component.
     *
     * @returns {Promise<{
     *   startNextVideoInFullscreen: boolean,
     *   startNextVideoInFullwindow: boolean,
     *   startNextVideoInPip: boolean,
     *   autoPictureInPictureState: object | null,
     *   startNextVideoWithChapters: boolean,
     *   startNextVideoWithFullscreenMetadata: boolean,
     *   startNextVideoWithFullscreenComments: boolean,
     *   startNextVideoWithFullscreenLiveChat: boolean,
     *   startNextVideoWithFullscreenPlaylist: boolean
     * }>}
     */
    async function destroyPlayer() {
      screenWakeBinding?.destroy()
      screenWakeBinding = null
      nativePlaybackCleanup?.()
      nativePlaybackCleanup = null
      ignoreErrors = true
      cancelPendingVolumeUserSet()
      cancelSponsorBlockSkipSchedule()
      // The media element can emit one final timeupdate while Shaka is being
      // destroyed, after its internal manifest has already been cleared.
      hasLoaded.value = false

      // Shaka clears the video's intrinsic dimensions before this component
      // unmounts. Keep its ratio and restore the poster so recovery doesn't
      // briefly collapse the player to the empty video's 150px default height.
      if (video.value?.videoWidth > 0 && video.value.videoHeight > 0) {
        video.value.style.aspectRatio = `${video.value.videoWidth} / ${video.value.videoHeight}`
      }
      showPoster.value = true
      await nextTick()

      let uiState = {
        startNextVideoInFullscreen: false,
        startNextVideoInFullwindow: false,
        startNextVideoInPip: false,
        autoPictureInPictureState: null,
        startNextVideoWithChapters: false,
        startNextVideoWithFullscreenMetadata: false,
        startNextVideoWithFullscreenComments: false,
        startNextVideoWithFullscreenLiveChat: false,
        startNextVideoWithFullscreenPlaylist: false
      }

      if (ui) {
        if (ui.getControls()) {
          // save the state of player settings to reinitialize them upon next creation
          const controls = ui.getControls()
          const isCurrentPlayerInPip = document.pictureInPictureElement === video.value
          uiState = {
            startNextVideoInFullscreen: controls.isFullScreenEnabled(),
            startNextVideoInFullwindow: fullWindowEnabled.value,
            startNextVideoInPip: isCurrentPlayerInPip,
            autoPictureInPictureState: isCurrentPlayerInPip
              ? getAutoPictureInPictureState()
              : null,
            startNextVideoWithChapters: showChaptersOverlay.value,
            startNextVideoWithFullscreenMetadata: showFullscreenMetadata.value,
            startNextVideoWithFullscreenComments: showFullscreenComments.value,
            startNextVideoWithFullscreenLiveChat: showFullscreenLiveChat.value,
            startNextVideoWithFullscreenPlaylist: showFullscreenPlaylist.value
          }
        }

        // destroying the ui also destroys the player
        await player?.nativePlayback?.hide().catch(() => {})
        await ui.destroy()
        ui = null
        player = null
      } else if (player) {
        await player.destroy()
        player = null
      }

      if (process.env.SUPPORTS_LOCAL_API && sabrStream) {
        sabrStream.cleanup()
        sabrAbortController?.abort()
      }

      // shaka-player doesn't clear these itself, which prevents shaka.ui.Overlay from being garbage collected
      // Should really be fixed in shaka-player but it's easier just to do it ourselves
      if (container.value) {
        container.value.ui = null
      }

      if (video.value) {
        video.value.ui = null
      }

      return uiState
    }

    expose({
      isNativePlayback: () => !!player?.nativePlayback,
      hasLoaded,
      hasPlaybackPosition,

      isPaused,
      play,
      pause,
      getCurrentTime,
      setCurrentTime,
      getSabrReloadState,
      retryStreaming,
      setFullscreenMetadata,
      closeFullscreenMetadata,
      setFullscreenTranscript,
      closeFullscreenTranscript,
      dismissFullscreenTranscript,
      setFullscreenSponsorBlock,
      closeFullscreenSponsorBlock,
      closeFullscreenComments,
      closeFullscreenLiveChat,
      closeFullscreenPlaylist,
      closeChaptersOverlay,
      toggleSponsorBlockInfo,
      closeSponsorBlockInfo,
      refreshSponsorBlockInfo,
      skipSponsorBlockInfoSegment,
      voteOnSponsorBlockInfoSegment,
      copyChapterTimestamp,
      destroyPlayer
    })

    // #endregion functions used by the watch page

    const showValueChangePopup = ref(false)
    const valueChangeMessage = ref('')
    const valueChangeIcons = ref([])
    const invertValueChangeContentOrder = ref(false)
    const showTemporaryPlaybackRateIndicator = ref(false)
    const temporaryPlaybackRateIndicatorMessage = ref('')
    let valueChangeTimeout = null

    function setShowUiOnPaused(value) {
      const config = ui?.getControls().getConfig()
      if (config) config.showUIOnPaused = value
    }

    function showOverlayControls() {
      ui.getControls().showUI()
    }

    /**
     * Shows a popup with a message and an icon on top of the video player.
     * @param {string} message - The message to display.
     * @param {ValueChangeIcon | ValueChangeIcon[]} icons - The icons to display.
     * @param {boolean} invertContentOrder - Whether to invert the order of the icon and message.
     */
    function showValueChange(message, icons = [], invertContentOrder = false) {
      valueChangeMessage.value = message
      valueChangeIcons.value = Array.isArray(icons) ? icons : [icons]
      showValueChangePopup.value = true
      invertValueChangeContentOrder.value = invertContentOrder

      if (valueChangeTimeout) {
        clearTimeout(valueChangeTimeout)
      }

      valueChangeTimeout = setTimeout(() => {
        showValueChangePopup.value = false
      }, 2000)

      showOverlayControls()
    }

    return {
      hasLoaded,
      useNativePlayback: process.env.IS_CAPACITOR,
      videoLayoutReady,
      shortsPaused,
      shortsEnded,
      replayIcon: shaka.ui.Enums.MaterialDesignSVGIcons.REPLAY,
      shortsMuted,
      shortsCaptionsAvailable,
      shortsCaptionsEnabled,
      closedCaptionsOutlinedIcon: CLOSED_CAPTIONS_OUTLINED,
      closedCaptionsFilledIcon: shaka.ui.Enums.MaterialDesignSVGIcons.CLOSED_CAPTIONS,
      showPoster,
      showPaidPromotion,
      toggleShortsPlayback,
      toggleShortsMuted,
      toggleShortsCaptions,
      handlePlaying,
      handleWaiting,
      updateVideoElementGeometry,
      openShortsOverflowMenu,
      positionShortsContextMenu,
      handlePlayerContextMenu,
      handlePlayerTouchEnd,
      handlePlayerMouseMove,
      handlePlayerMouseLeave,
      handlePlayerFocusIn,
      toggleShortsFullscreen,
      handlePlayerControlDoubleClick,
      ambientCanvas,
      ambientFullscreenCanvas,
      ambientLayoutCanvas,
      ambientModeVisible,
      audioPlayerMode,
      musicAudioTrack,
      hideBrokenMusicImage,
      showMusicImage,
      musicVisualizerCanvas,
      musicVisualizerEnabled,
      fullscreenAmbientBarsVisible,
      captionCssVariables,
      captionPlayerVariables,
      captionAppearanceSampleBottom,
      showCaptionAppearanceSample,
      isActiveTab,
      container,
      video,
      voiceOverTranslationState: voiceOverTranslation.state,
      vrCanvas,
      chapterOverlay,
      showChaptersOverlay,
      isFullscreen,
      playerPaused,
      pausedInterfaceRevealed,
      showPlayerControlsWhenPaused,
      showVideoTitleWhenPaused,
      showFullscreenActionsWhenPaused,
      actionDockVisible,
      actionDockFocused,
      playerControlsShown,
      isSubMenuOpened,
      presentationModeChanging,
      chapterThumbnails,
      closeChaptersOverlay,
      selectOverlayChapter,
      copyChapterTimestamp,
      fullscreenDockStyle,
      fullscreenDockCanResize,
      fullscreenDockCanReorder,
      fullscreenDockResizing,
      fullscreenDockReordering,
      enableMobileFullscreenSwipe,
      mobileFullscreenSwiping,
      mobileFullscreenSwipeSettling,
      mobileFullscreenSwipeStyle,
      resetFullscreenDockHeights,
      handleFullscreenDockHeaderDoubleClick,
      handleFullscreenDockResizePointerDown,
      handleFullscreenDockResizeKeydown,
      handleFullscreenDockReorderPointerDown,
      fullscreenMetadataOverlay,
      fullscreenMetadataTarget,
      showFullscreenMetadata,
      closeFullscreenMetadata,
      fullscreenTranscriptOverlay,
      fullscreenTranscriptTarget,
      showFullscreenTranscript,
      closeFullscreenTranscript,
      dismissFullscreenTranscript,
      toggleFullscreenTranscript,
      fullscreenSponsorBlockOverlay,
      fullscreenSponsorBlockTarget,
      showFullscreenSponsorBlock,
      closeFullscreenSponsorBlock,
      toggleFullscreenSponsorBlock,
      fullscreenCommentsOverlay,
      showFullscreenComments,
      closeFullscreenComments,
      setFullscreenComments,
      fullscreenLiveChatOverlay,
      fullscreenLiveChatTarget,
      showFullscreenLiveChat,
      closeFullscreenLiveChat,
      setFullscreenLiveChat,
      fullscreenPlaylistOverlay,
      fullscreenPlaylistTarget,
      showFullscreenPlaylist,
      fullscreenDockLayoutOpen,
      closeFullscreenPlaylist,
      setFullscreenPlaylist,
      showFullscreenShareAction,
      showFullscreenPlaylistAction,
      isInAnyPlaylist,
      useSponsorBlock,
      getShareTimestamp,
      toggleQuickBookmark,

      autoQualitySupported,
      tabId,

      fullWindowEnabled,
      fullWindowPlaceholderHeight,
      forceAspectRatio,

      showStats,
      stats,
      playerDimensions,
      annotationCurrentTime,
      annotationVideoAspectRatio,
      annotationVideoFit,

      autoplayVideos,
      suppressInitialAutoplay,
      loopShorts,
      sponsorBlockShowSkippedToast,
      sponsorBlockDraftEditValues,
      sponsorBlockDraftSegments,
      sponsorBlockSubmissionCategories,
      sponsorBlockSubmissionCategoryNames,
      getSponsorBlockActionTypeSelectNames,
      getSponsorBlockActionTypeSelectValues,
      sponsorBlockSubmissionError,
      sponsorBlockSubmissionMenuOpen,
      sponsorBlockSubmissionPending,
      isSponsorBlockDraftEditing,
      isSponsorBlockFullVideoSegment,
      isSponsorBlockPointSegment,

      promptSponsorBlockSegments,
      getSponsorBlockPromptLabel,
      getSponsorBlockPromptActionLabel,
      getSponsorBlockPromptTimeLabel,
      dismissPromptSponsorBlockSegment,
      skipPromptSponsorBlockSegment,
      skippedSponsorBlockSegments,
      getSponsorBlockToastTimeLabel,
      isSponsorBlockToastCountdownPaused,
      getSponsorBlockToastActionLabel,
      getSponsorBlockToastLabel,
      pauseSponsorBlockToastCountdown,
      resumeSponsorBlockToastCountdown,
      removeSponsorBlockToast,
      unskipSponsorBlockSegment,
      redoSkipSponsorBlockSegment,
      updateSponsorBlockDraftEditField,
      updateSponsorBlockDraftActionType,
      updateSponsorBlockDraftCategory,
      setSponsorBlockDraftTime,
      saveSponsorBlockDraft,
      toggleSponsorBlockDraftEditing,
      previewSponsorBlockDraft,
      deleteSponsorBlockDraft,
      submitSponsorBlockDrafts,
      closeSponsorBlockSubmissionMenu,
      openSponsorBlockGuidelines,
      translateSponsorBlockCategory,

      showOfflineMessage,
      autoplayNextVideo,
      autoplayThumbnail,
      autoplayDuration,
      compactAutoplayLayout,
      tinyAutoplayLayout,
      cancelAutoplayCountdown,
      playAutoplayVideoNow,
      showCountdownOverlay,
      countdownTimeLabel,
      countdownAriaLabel,
      countdownRingCircumference,
      countdownRingDashoffset,

      handlePlay,
      handlePause,
      syncPlayPauseControlIcons,
      handleCanPlay,
      handleEnded,
      handleSeeking,
      handleAbRepeatSeeked,
      handleAbRepeatDurationChange,
      updateVolume,
      handleTimeupdate,
      syncMediaSessionPosition,
      handleEnterPictureInPicture,
      handleLeavePictureInPicture,

      videoZoomStyle,
      videoZoomPossible,
      videoZoomPanning,
      videoZoomPinching,
      videoZoomPanReady,
      handleVideoZoomPointerEnter,
      handleVideoZoomPointerLeave,
      handleVideoZoomPointerDown,
      handleVideoZoomPointerMove,
      handleVideoZoomPointerUp,
      handleVideoZoomPointerCancel,
      handleMobilePlayerTouchEnd,

      valueChangeMessage,
      valueChangeIcons,
      showValueChangePopup,
      invertValueChangeContentOrder,
      showTemporaryPlaybackRateIndicator,
      temporaryPlaybackRateIndicatorMessage,

      scrollMiniPlayerActive,
      scrollMiniPlayerAnimating,
      scrollMiniPlayerDetached,
      scrollMiniPlayerDismissed,
      scrollMiniPlaceholderHeight,
      scrollMiniPlayerStyle,
      scrollMiniPlayerStashed,
      scrollMiniPlayerStashedSide,
      scrollMiniIsPaused,
      scrollMiniVolume,
      scrollMiniVolumePercent,
      scrollMiniVolumeIcon,
      scrollMiniPlayPauseVisible,
      scrollMiniVolumeExpanded,
      scrollMiniDragHandleOnLightBg,
      scrollMiniResizeHandleOnLightBg,
      scrollMiniResizeCorner,
      scrollMiniAnchor,
      scrollMiniPlaceholder,
      scrollMiniVolumeTrack,
      handleScrollMiniPlayerLeave,
      handleScrollMiniPlayerEnter,
      handleScrollMiniPlayPauseMouseEnter,
      handleScrollMiniControlsPointerMove,
      suppressScrollMiniPlayPausePointerReveal,
      dismissCrossTabMiniPlayer,
      scrollMiniTogglePlayPause,
      scrollMiniScrollToTop,
      restoreStashedScrollMiniPlayer,
      updateScrollMiniVolume,
      handleScrollMiniVolumeMouseEnter,
      handleScrollMiniVolumeMouseLeave,
      handleScrollMiniVolumePointerDown,
      handleScrollMiniDragPointerDown,
      handleScrollMiniResizePointerDown,
    }
  }
})
