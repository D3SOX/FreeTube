import i18n, { loadLocale, setAITranslationCompletionsEnabled } from '../../i18n/index'
import allLocales from '../../../../static/locales/activeLocales.json'
import {
  applyKeyboardShortcutOverrides,
  DEFAULT_LANDING_PAGE,
  DEFAULT_QUICK_PLAYBACK_SPEED_BAR_OPTIONS,
  DEFAULT_WATCHED_PERCENTAGE_THRESHOLD,
  LEGACY_DEFAULT_LANDING_PAGE,
  MAIN_PROFILE_ID,
  resolveLandingPage,
  sanitizeKeyboardShortcutOverrides,
  SyncEvents,
} from '../../../constants'
import { DBProfileHandlers, DBSettingHandlers } from '../../../datastores/handlers/index'
import { hashPassword } from '../../helpers/passwords'
import { ANDROID_PROXY_SETTING_KEYS, configureAndroidProxy, readAndroidProxySettings } from '../../helpers/androidProxy'
import { getTabNavigationService } from '../../tabs/TabNavigationService'
import { getSystemLocale, showToast } from '../../helpers/utils'
import { DEFAULT_THUMBNAIL_SIZE } from '../../constants/thumbnailSize'
import { DEFAULT_FIXED_TAB_WIDTH } from '../../constants/tabWidth'
import { normalizeTabBarPosition } from '../../constants/tabBarPosition'
import { DEFAULT_SCROLLBAR_THUMB_WIDTH } from '../../constants/scrollbar'
import { setReducedMotionPreference } from '../../helpers/reducedMotion'
import { setAnimationSpeed } from '../../helpers/animationSpeed'
import { DEFAULT_SCROLL_SPEED } from '../../helpers/scrollSpeed'
import { DEFAULT_SEARCH_ENGINES_SETTING } from '../../../searchEngines'
import { DEFAULT_SEGMENT_PREFETCH_LIMIT } from '../../helpers/player/segmentPrefetch'
import { normalizeYouTubeCaptionLanguageCode } from '../../helpers/player/youtubeCaptionLanguages'
import { currentIconPack, isIconPack, setIconPack } from '../../icons/iconPackState'
import { resolveBaseTheme, resolveSystemTheme } from '../../../appearanceSettings.js'
import { resolveColor } from '../../helpers/colors.js'
import { DEFAULT_APP_FONT, normalizeAppFont } from '../../helpers/appFont.js'
import {
  LAST_USED_VERSION_SETTING_ID,
  TUTORIAL_AUDIENCE_SETTING_ID,
} from '../../helpers/tutorialState.js'
import { DEFAULT_YT_DLP_PLAYBACK_CACHE_MAX_ENTRY_SIZE_MB } from '../../../ytDlpPlaybackCacheSettings.js'
import {
  DEFAULT_YT_DLP_PRELOAD_CONCURRENCY,
  DEFAULT_YT_DLP_PRELOAD_COUNT,
} from '../../helpers/player/ytDlpPlaybackPreload.js'
import { terminateCommentTranslationLanguageDetector } from '../../helpers/comment-translations'
import { DEFAULT_HOME_SECTION_LAYOUT } from '../../helpers/homeSections.js'
import { isSettingSyncableOnPlatform } from '../../helpers/platformSettings.js'
import { CUSTOM_THEMES_SYNC_KEY } from '../../../customTheme.js'
import { DEFAULT_QUICK_SETTINGS, normalizeQuickSettings } from '../../helpers/quickSettings.js'
import { createOptimisticSettingUpdater, createSettingUpdateQueue } from '../../helpers/settingUpdateQueue.js'
import { mergeSubscriptionSeenVideos } from '../../../subscriptionSeenVideos.js'
import { filterAvailableNavigationItems } from '../../../navigationAvailability.js'
import {
  DEFAULT_NAVIGATION_ITEMS,
  navigationItemsFromLegacySettings,
  normalizeNavigationItems,
} from '../../../navigationItems.js'

const CHANNEL_SETTINGS_SYNC_MIGRATION_SETTING = 'channelSettingsSyncMigration'
const TUTORIAL_STATE_SETTING_IDS = new Set([
  LAST_USED_VERSION_SETTING_ID,
  TUTORIAL_AUDIENCE_SETTING_ID,
])

/*
 * Due to the complexity of the settings module in FreeTube, a more
 * in-depth explanation for adding new settings is required.
 *
 * The explanation will be written with the assumption that
 * the reader knows how Vuex works.
 *
 * And no, there's no need to read the entire wall of text.
 * We'll direct you where you need to go as we walk you through it.
 * Additionally, the text actually looks bigger than it truly is.
 * Each line has, at most, 72 characters.
 *
 ****
 * Introduction
 *
 * You can add a new setting in two different methods.
 *
 * The first method benefits from the auto-generation of
 * a getter, a mutation and a few actions related to the setting.
 * This method should be preferred whenever possible:
 * - `state`
 *
 * The last one DOES NOT feature any kind of auto-generation and should
 * only be used in scenarios that don't fall under the other 2 options:
 * - `customState`
 *
 ****
 * ASIDE:
 * The aforementioned "side effects" cover a large area
 * of interactions with other modules
 * A good example would be a setting that utilizes the Electron API
 * when its value changes.
 *
 ****
 * First and foremost, you have to understand what type of setting
 * you intend to add to the app.
 *
 * You'll have to select one of these three scenarios:
 *
 * 1) You just want to add a simple setting that does not actively
 *    interact with the Electron API, `localStorage` or
 *    other parts outside of the settings module.
 * -> Please consult the `state` section.
 *
 * 2) You want to add a more complex setting that interacts
 *    with other parts of the app and tech stack.
 * -> Please consult the `state` and `sideEffectHandlers` sections.
 *
 * 3) You want to add a completely custom state based setting
 *    that does not work like the usual settings.
 * -> Please consult the `state` and `customState` sections.
 *
 ****
 * `state`
 * This object contains settings that have NO SIDE EFFECTS.
 *
 * A getter, mutation and an action function is auto-generated
 * for every setting present in the `state` object.
 * They have the following format (exemplified with setting 'example'):
 *
 * Getter: `getExample` (gets the value from current state)
 * Mutation:
 *   `setExample`
 *     (takes a value
 *      and uses it to update the current state)
 * Action:
 *   `updateExample`
 *     (takes a value,
 *      saves it to the database
 *      and calls `setExample` with it)
 *
 ***
 * `sideEffectHandlers`
 * This object contains the side-effect handlers for settings that have SIDE EFFECTS.
 *
 * Each one of these settings must specify a handler,
 *   which should essentially be a callback of type
 *   `(store, value) => void` (the same as you would use for an `action`)
 *   that deals with the side effects for that setting
 *
 * NOTE: Example implementations of such handlers can be found
 * in the `sideEffectHandlers` object in case
 * the explanation isn't clear enough.
 *
 * All functions auto-generated for settings in `state`
 * (if you haven't read the `state` section, do it now),
 * are also auto-generated for settings in `sideEffectHandlers,
 * with a few key differences (exemplified with setting 'example'):
 *
 * - an additional action is auto-generated:
 *   - `triggerExampleSideEffects`
 *       (triggers the `handler` for that setting;
 *        you'll most likely never call this directly)
 *
 * - the behavior of `updateExample` changes a bit:
 *   - `updateExample`
 *       (saves value to the database,
 *        calls `triggerExampleSideEffects` and calls `setExample`)
 *
 ***
 * `customState`
 * This object contains settings that
 * don't linearly fall under the other two options.
 *
 * No auto-generation of any kind is performed
 * when a setting is added to `customState`
 *
 * You must manually add any getters, mutations and actions to
 * `customGetters`, `customMutations` and `customActions` respectively
 * that you find appropriate for that setting.
 *
 * NOTE:
 * When adding a setting to the `customState`,
 * additional consultation with the FreeTube team is preferred
 * to evaluate if it is truly necessary
 * and to ensure that the implementation works as intended.
 *
 ***
 * `NON_TRANSFERABLE_SETTINGS`
 * This set contains setting keys
 * that should not be exported when a user chooses to "Export settings".
 *
 * When adding a new setting, it should be considered
 * whether this setting can be exported or not. For example, settings
 * that are OS or user specific like paths should not be exported.
 *
 ****
 * ENDING NOTES
 *
 * Only two more things that need mentioning.
 *
 * 1) It's perfectly fine to add extra functionality
 *    to the `customGetters`, `customMutations` and `customActions`,
 *    whether it's related to a setting or just serving as
 *    standalone functionality for the module
 *    (e.g. `grabUserSettings` (standalone action))
 *
 * 2) It's also possible to OVERRIDE auto-generated functionality by
 *    adding functions with the same identifier to
 *    the respective `custom__` object,
 *    but you must have an acceptable reason for doing so.
 ****
 */

// HELPERS
const capitalize = str => str.charAt(0).toUpperCase() + str.slice(1)
export const defaultGetterId = settingId => 'get' + capitalize(settingId)
export const defaultMutationId = settingId => 'set' + capitalize(settingId)
export const defaultUpdaterId = settingId => 'update' + capitalize(settingId)
export const defaultSideEffectsTriggerId = settingId =>
  'trigger' + capitalize(settingId) + 'SideEffects'
/*****/

const state = {
  alwaysShowScrollbars: false,
  autoOpenChapters: false,
  autoplayPlaylists: true,
  autoplayVideos: true,
  // Combinable triggers for automatically entering Picture-in-Picture: 'tab', 'minimize', 'blur'
  autoPictureInPictureTriggers: [],
  androidAutoPictureInPicture: false,
  scrollMiniPlayerEnabled: true,
  scrollMiniPlayerOnAllTabs: false,
  scrollMiniPlayerSavedRect: '',
  crossTabMiniPlayerSavedRect: '',
  scrollbarThumbWidth: DEFAULT_SCROLLBAR_THUMB_WIDTH,
  scrollSpeed: DEFAULT_SCROLL_SPEED,
  avoidTranslation: 'disabled',
  backendFallback: false,
  backendPreference: !process.env.SUPPORTS_LOCAL_API ? 'invidious' : 'local',
  barColor: false,
  checkForUpdates: true,
  capacitorLayoutMode: 'auto',
  commentTranslationIgnoredLanguages: [],
  confirmCloseApp: true,
  confirmCloseMultipleTabs: true,
  confirmCloseWindowWithMultipleTabs: true,
  confirmLoadMultipleTabs: true,
  confirmUnloadMultipleTabs: true,
  appFont: DEFAULT_APP_FONT,
  baseTheme: 'system',
  systemLightTheme: 'light',
  systemDarkTheme: 'dark',
  iconPack: 'material',
  mainColor: 'Red',
  secColor: 'Blue',
  defaultAutoplayInterruptionIntervalHours: 3,
  defaultCaptionSettings: '{}',
  enableCommentTranslations: true,
  enableCaptionTranslations: false,
  preferredCaptionLocale: '',
  defaultInterval: 5,
  defaultPlayback: 1,
  defaultProfile: MAIN_PROFILE_ID,
  defaultQuality: '720',
  defaultSkipInterval: 5,
  seekIntervalMultiplyByPlaybackRate: false,
  // How many segments per stream shaka-player downloads in parallel ahead of the playhead
  segmentPrefetchLimit: DEFAULT_SEGMENT_PREFETCH_LIMIT,
  showPlaybackRateAdjustedTimestamp: false,
  useCustomShortsPlayer: true,
  loopShorts: true,
  defaultViewingMode: 'default',
  defaultVideoFormat: 'dash',
  disableSmoothScrolling: false,
  disableChannelLinks: false,
  displayVideoPlayButton: false,
  ambientMode: false,
  musicVisualizer: true,
  enableVideoMetadataCache: false,
  enableWatchStats: true,
  statsWeekStartsOn: '1',
  enableSearchSuggestions: true,
  contextMenuSearchEngines: DEFAULT_SEARCH_ENGINES_SETTING,
  enableSubtitlesByDefault: false,
  enterFullscreenOnDisplayRotate: false,
  rotateFullscreenToLandscape: true,
  enableMobileFullscreenSwipe: true,
  mobileLeftSwipeAction: 'disabled',
  mobileRightSwipeAction: 'disabled',
  mobileFullscreenBrightness: false,
  continuePlaybackWhenScreenIsLocked: true,
  externalLinkHandling: '',
  externalPlayer: '',
  externalPlayerExecutable: '',
  externalPlayerIgnoreWarnings: false,
  externalPlayerIgnoreDefaultArgs: false,
  externalPlayerCustomArgs: '[]',
  showAddedExternalPlayerCustomArgs: true,
  videoPlaybackEngine: 'built-in',
  ytDlpSource: 'system',
  ytDlpChannel: 'stable',
  ytDlpPath: '',
  ytDlpPlaybackAuthMode: 'none',
  ytDlpPlaybackCookiesPath: '',
  ytDlpPlaybackCookiesBrowser: '',
  ytDlpPlaybackCookiesBrowserProfile: '',
  ytDlpPlaybackAlwaysUseCookies: false,
  ytDlpSubtitleUseCookies: false,
  ytDlpPlaybackCacheMaxEntrySize: DEFAULT_YT_DLP_PLAYBACK_CACHE_MAX_ENTRY_SIZE_MB,
  ytDlpPreloadEnabled: false,
  ytDlpPreloadCount: DEFAULT_YT_DLP_PRELOAD_COUNT,
  ytDlpPreloadConcurrency: DEFAULT_YT_DLP_PRELOAD_CONCURRENCY,
  ytDlpFfmpegSource: 'system',
  ytDlpFfmpegPath: '',
  externalSoftwareUpdateMode: 'automatic',
  enableDownloads: true,
  moveDownloadsToAppHeader: false,
  moveSettingsToAppHeader: false,
  ytDlpDownloadFolderPath: '',
  ytDlpDownloadCustomArgs: '',
  ytDlpMaxConcurrentDownloads: 2,
  ytDlpDownloadBandwidthLimit: '0',
  ytDlpDownloadTemplates: '[]',
  ytDlpSelectedTemplate: 'video:best',
  ytDlpAutomaticDownloadRules: '{}',
  disableAbRepeat: false,
  expandSideBar: false,
  hideActiveSubscriptions: false,
  hideChannelAvatars: false,
  hideChannelCommunity: false,
  hideChannelHome: false,
  hideChannelPlaylists: false,
  hideChannelReleases: false,
  hideChannelPodcasts: false,
  hideChannelCourses: false,
  hideChannelShorts: false,
  hideChannelSubscriptions: false,
  hideCommentLikes: false,
  hideCommentPhotos: false,
  hideComments: false,
  hideEndScreenAnnotations: false,
  hidePaidPromotion: false,
  hideFeaturedChannels: false,
  channelsHidden: '[]',
  forbiddenTitles: '[]',
  showAddedChannelsHidden: true,
  showAddedForbiddenTitles: true,
  hideVideoDescription: false,
  hideLiveChat: false,
  hideLiveChatReplay: false,
  hideLiveStreams: false,
  hideHeaderLogo: false,
  // Former navigation switches remain loadable so older settings can migrate.
  hideHome: false,
  // This also controls playlist actions outside navigation.
  hidePlaylists: false,
  hidePopularVideos: false,
  hideRecommendedVideos: false,
  hideSearchBar: false,
  hideSideBarOnWatchPages: true,
  hideSharingActions: false,
  hideSubscriptionsVideos: false,
  hideSubscriptionsShorts: false,
  hideSubscriptionsLive: false,
  hideSubscriptionsCommunity: false,
  hideTrendingVideos: false,
  hideUnsubscribeButton: false,
  hideUpcomingPremieres: false,
  hideVideoLikesAndDislikes: false,
  hideVideoViews: false,
  shortenViewCounts: true,
  hideWatchedSubs: false,
  hideUploader: false,
  unsubscriptionPopupStatus: false,
  hideLabelsSideBar: false,
  hideChapters: false,
  homeSectionLayout: DEFAULT_HOME_SECTION_LAYOUT.map(section => ({ ...section })),
  enableHomeRecommendations: false,
  recommendationExploration: 0.2,
  showDistractionFreeTitles: false,
  showPlayerControlsWhenPaused: true,
  showVideoTitleWhenPaused: true,
  showFullscreenActionsWhenPaused: true,
  pausedInterfaceHideDelay: 2.5,
  showLiveChatTimestamps: false,
  liveChatFilter: 'TOP_CHAT',
  landingPage: DEFAULT_LANDING_PAGE,
  newTabPosition: 'afterCurrentInOrder',
  tabCloseFocus: 'previousTab',
  startupBehavior: 'loadLastActiveTab',
  showTabIcons: true,
  showTabPreviews: true,
  updateRelativeTimestamps: true,
  tabBarPosition: 'top',
  verticalTabBarWidth: 220,
  useFixedTabWidth: false,
  fixedTabWidth: DEFAULT_FIXED_TAB_WIDTH,
  listType: 'grid',
  playlistViewType: 'grid',
  quickSettings: [...DEFAULT_QUICK_SETTINGS],
  navigationItems: [...DEFAULT_NAVIGATION_ITEMS],
  maxVideoPlaybackRate: 3,
  onlyShowLatestFromChannel: false,
  onlyShowLatestFromChannelNumber: 1,
  openDeepLinksInNewWindow: false,
  playNextVideo: false,
  playlistReverseStates: {},
  proxyHostname: '127.0.0.1',
  proxyPort: '9050',
  proxyUsername: '',
  proxyPassword: '',
  proxyProtocol: 'socks5',
  videoIpBlockScriptPath: '',
  proxyVideos: !process.env.SUPPORTS_LOCAL_API,
  region: 'US',
  rememberHistory: true,
  // Empty means history is retained indefinitely.
  historyRetentionDays: '',
  rememberSearchHistory: true,
  rememberTabNavigationHistory: false,
  // 'auto', 'semi-auto', 'never'
  watchedProgressSavingMode: 'auto',
  watchedPercentageThreshold: DEFAULT_WATCHED_PERCENTAGE_THRESHOLD,
  saveVideoHistoryWithLastViewedPlaylist: true,
  showFamilyFriendlyOnly: false,
  sponsorBlockShowSkippedToast: true,
  sponsorBlockSkippedToastDuration: 6,
  sponsorBlockEnableSubmission: false,
  sponsorBlockUserId: '',
  sponsorBlockGeneratedUserId: '',
  sponsorBlockDraftSegmentsByVideoId: {},
  sponsorBlockChannelWhitelist: [],
  sponsorBlockUrl: 'https://sponsor.ajay.app',
  sponsorBlockSponsor: {
    color: 'Green',
    skip: 'autoSkip'
  },
  sponsorBlockSelfPromo: {
    color: 'Yellow',
    skip: 'promptToSkip'
  },
  sponsorBlockInteraction: {
    color: 'Pink',
    skip: 'promptToSkip'
  },
  sponsorBlockIntro: {
    color: 'Cyan',
    skip: 'promptToSkip'
  },
  sponsorBlockOutro: {
    color: 'Blue',
    skip: 'promptToSkip'
  },
  sponsorBlockRecap: {
    color: 'Indigo',
    skip: 'promptToSkip'
  },
  sponsorBlockHook: {
    color: 'Blue',
    skip: 'promptToSkip'
  },
  sponsorBlockMusicOffTopic: {
    color: 'Orange',
    skip: 'promptToSkip'
  },
  sponsorBlockFiller: {
    color: 'Purple',
    skip: 'promptToSkip'
  },
  sponsorBlockHighlight: {
    color: 'Red',
    skip: 'promptToSkip'
  },
  thumbnailPreference: '',
  showThumbnailPreviews: true,
  thumbnailSize: DEFAULT_THUMBNAIL_SIZE,
  uiRoundness: 100,
  animationSpeed: 100,
  showToastTimeoutIndicator: true,
  usePlayerMenuGrid: true,
  toastPosition: 'bottom-left',
  extraThumbnailAction: '',
  blurThumbnails: false,
  syncServerEnabled: false,
  syncServerUrl: 'https://sync.d3sox.me',
  syncServerUsername: '',
  syncServerToken: '',
  syncServerDeviceId: '',
  syncServerDeviceName: '',
  syncServerPrivacyMode: 'unknown',
  syncServerPrivacyKey: '',
  syncServerPrivacySalt: '',
  syncServerAutoSync: true,
  syncServerResumeAutoSync: false,
  syncServerSyncSubscriptions: true,
  syncServerSyncPlaylists: true,
  syncServerSyncHistory: true,
  syncServerSyncProfiles: true,
  syncServerSyncSessions: true,
  syncServerSharedTabs: false,
  syncServerSyncSettings: true,
  syncServerSettingsExcluded: [],
  syncServerSettingUpdatedAt: {},
  syncServerLastSyncAt: 0,
  syncServerSnapshot: '{}',
  subscriptionSeenVideos: '[]',
  playlistBookmarks: [],
  useProxy: false,
  userPlaylistSortOrder: 'date_added_descending',
  useRssFeeds: false,
  useReturnYouTubeDislikes: false,
  returnYouTubeDislikesUrl: 'https://ryd-proxy.kavin.rocks',
  useSponsorBlock: false,
  videoVolumeMouseScroll: false,
  videoPlaybackRateMouseScroll: false,
  videoSkipMouseScroll: false,
  videoPlaybackRateInterval: 0.25,
  rememberVolume: true,
  enableVideoZoom: true,
  showSkipSilenceButton: false,
  enableSkipSilenceByDefault: false,
  useVoiceOverTranslation: false,
  voiceOverTranslationPrepareInBackground: false,
  voiceOverTranslationLanguage: 'en',
  voiceOverTranslationVolume: 100,
  voiceOverTranslationOriginalVolume: 10,
  holdToDoublePlaybackSpeed: true,
  keyboardShortcuts: '{}',
  rememberPlaybackSpeedPerChannel: false,
  autoUpdateChannelPlaybackSpeeds: false,
  channelPlaybackSpeeds: '{}',
  useQuickPlaybackSpeedBar: false,
  quickPlaybackSpeedBarOptions: JSON.stringify(DEFAULT_QUICK_PLAYBACK_SPEED_BAR_OPTIONS),
  rememberVideoQualityPerChannel: false,
  autoUpdateChannelVideoQualities: false,
  channelVideoQualities: '{}',
  rememberSubtitlesStatePerChannel: false,
  autoUpdateChannelSubtitlesStates: false,
  channelSubtitlesStates: '{}',
  rememberVolumePerChannel: false,
  autoUpdateChannelVolumes: false,
  channelVolumes: '{}',
  enableScreenshot: false,
  screenshotMode: 'prompt_folder',
  screenshotFormat: 'png',
  screenshotQuality: 95,
  screenshotFolderPath: '',
  screenshotFilenamePattern: '%Y%M%D-%H%N%S',
  highlightChangedSettings: true,
  showPerformanceImpactIndicators: false,
  fetchSubscriptionsAutomatically: true,
  showScheduledLiveStreamsFirst: true,
  showNewSubscriptionFeed: true,
  showNewSubscriptionFeedIndicators: false,
  newSubscriptionFeedView: 'combined',
  newSubscriptionFeedSortBy: 'newest',
  subscriptionFeedAutoRefreshInterval: '0',
  subscriptionShortsAutoRefreshInterval: '0',
  subscriptionLiveAutoRefreshInterval: '0',
  subscriptionPostsAutoRefreshInterval: '0',
  enableClosedAppSubscriptionRefresh: true,
  showProgressBarToast: true,
  settingsPassword: '',
  useDeArrowTitles: false,
  useDeArrowThumbnails: false,
  deArrowThumbnailGeneratorUrl: 'https://dearrow-thumb.ajay.app',
  // This makes the `favorites` playlist uses as quick bookmark target
  // If the playlist is removed quick bookmark is disabled
  quickBookmarkTargetPlaylistId: 'favorites',
  generalAutoLoadMorePaginatedItemsEnabled: true,
  enablePullToRefresh: true,
  hideToTrayOnMinimize: false,
  dateFormat: 'locale',
  timeFormat: 'locale',

  // The settings below have side effects
  useAITranslationCompletions: true,
  currentLocale: 'system',
  reducedMotion: 'system',
  defaultInvidiousInstance: '',
  defaultVolume: 1,
  uiScale: 100,
  userPlaylistsSortBy: 'latest_played_first',
  userHistorySortBy: 'latest_played_first',
}

// Keep a snapshot separate from Vuex's reactive state so settings can reliably
// be compared with and restored to their original values.
export const DEFAULT_SETTINGS = Object.freeze(structuredClone(state))

const sideEffectHandlers = {
  useAITranslationCompletions: (_store, value) => {
    return setAITranslationCompletionsEnabled(value)
  },

  enableCommentTranslations: (_store, value) => {
    if (!value) {
      terminateCommentTranslationLanguageDetector()
    }
  },

  keyboardShortcuts: (_store, value) => {
    applyKeyboardShortcutOverrides(value)
  },

  reducedMotion: (store, value) => {
    setReducedMotionPreference(value)
  },

  animationSpeed: (_store, value) => {
    setAnimationSpeed(value)
  },

  currentLocale: async ({ dispatch }, value) => {
    const fallbackLocale = 'en-US'

    let targetLocale = value
    if (value === 'system') {
      const systemLocaleName = (await getSystemLocale()).replace('_', '-') // ex: en-US
      const systemLocaleSplit = systemLocaleName.split('-') // ex: en
      const targetLocaleOptions = allLocales.filter((locale) => {
        // filter out other languages
        const localeLang = locale.split('-')[0]
        return localeLang.includes(systemLocaleSplit[0])
      }).sort((aLocaleName, bLocaleName) => {
        const aLocale = aLocaleName.split('-') // ex: [en, US]
        const bLocale = bLocaleName.split('-')

        if (aLocaleName === systemLocaleName) { // country & language match, prefer a
          return -1
        } else if (bLocaleName === systemLocaleName) { // country & language match, prefer b
          return 1
        } else if (aLocale.length === 1) { // no country code for a, prefer a
          return -1
        } else if (bLocale.length === 1) { // no country code for b, prefer b
          return 1
        } else { // a & b have different country code from system, sort alphabetically
          return aLocaleName.localeCompare(bLocaleName)
        }
      })

      if (targetLocaleOptions.length > 0) {
        targetLocale = targetLocaleOptions[0]
      } else {
        // Go back to default value if locale is unavailable
        targetLocale = fallbackLocale
        // Translating this string isn't necessary
        // because the user will always see it in the default locale
        // (in this case, English (US))
        showToast({ message: `Locale not found, defaulting to ${fallbackLocale}`, icon: ['fas', 'circle-exclamation'] })
      }
    }

    // Always finish loading the English fallback before the app is ready.
    const loadPromises = [loadLocale(fallbackLocale)]

    // "es" is used as a fallback for "es-AR" and "es-MX"
    if (targetLocale === 'es-AR' || targetLocale === 'es-MX') {
      loadPromises.push(
        loadLocale('es')
      )
    }

    // "pt" is used as a fallback for "pt-PT" and "pt-BR"
    if (targetLocale === 'pt-PT' || targetLocale === 'pt-BR') {
      loadPromises.push(
        loadLocale('pt')
      )
    }

    if (targetLocale !== fallbackLocale) {
      loadPromises.push(
        loadLocale(targetLocale)
      )
    }

    await Promise.allSettled(loadPromises)

    i18n.global.locale.value = targetLocale
    await dispatch('getRegionData', targetLocale)
  },

  defaultInvidiousInstance: ({ commit, rootState }, value) => {
    if (value !== '' && rootState.invidious.currentInvidiousInstance !== value) {
      commit('setCurrentInvidiousInstance', value)
    }
  },

  enableWatchStats: ({ dispatch }, value) => {
    if (value) {
      dispatch('grabWatchStats')
    }
  },

  uiScale: (_, value) => {
    if (process.env.IS_ELECTRON) {
      window.ftElectron.setZoomFactor(value / 100)
    }
  },

  iconPack: async (_, value) => {
    const preferredPack = isIconPack(value) ? value : 'material'
    if (await setIconPack(preferredPack)) {
      return preferredPack
    }

    const fallbackPack = preferredPack === 'material' ? 'remix' : 'material'
    if (await setIconPack(fallbackPack)) {
      return fallbackPack
    }

    throw new Error(`Unable to apply icon pack: ${value}`)
  },

  maxVideoPlaybackRate: ({ dispatch, state }, value) => {
    if (state.defaultPlayback > value) {
      dispatch('updateDefaultPlayback', value)
    }
  },

  videoPlaybackRateInterval: ({ dispatch, state }, value) => {
    const correctedDefaultPlaybackRate = value * Math.round(state.defaultPlayback / value)

    if (state.defaultPlayback !== correctedDefaultPlaybackRate) {
      dispatch('updateDefaultPlayback', correctedDefaultPlaybackRate)
    }
  },

  showSkipSilenceButton: ({ dispatch }, value) => {
    if (!value) {
      dispatch('clearTabSkipSilence')
    }
  },

  rememberTabNavigationHistory: (_, value) => {
    // Sync (or clear) the histories of already-open tabs right away,
    // so toggling doesn't require a navigation in every tab first.
    if (process.env.IS_ELECTRON) {
      getTabNavigationService().publishAllHistories(value === true)
    }
  },
}

const settingsWithSideEffects = Object.keys(sideEffectHandlers)

export const NON_TRANSFERABLE_SETTINGS = new Set([
  // Installed fonts are specific to the current operating system.
  'appFont',
  /* Depends on process.env.IS_ELECTRON */
  // ProxySettings
  'useProxy',
  'proxyProtocol',
  'proxyHostname',
  'proxyPort',
  'proxyUsername',
  'proxyPassword',
  // ExternalPlayerSettings
  'externalPlayer',
  'externalPlayerExecutable',
  'externalPlayerIgnoreWarnings',
  'externalPlayerIgnoreDefaultArgs',
  'externalPlayerCustomArgs',
  'showAddedExternalPlayerCustomArgs',
  // ExternalSoftwareSettings
  'videoPlaybackEngine',
  'ytDlpSource',
  'ytDlpChannel',
  'ytDlpPath',
  'ytDlpPlaybackAuthMode',
  'ytDlpPlaybackCookiesPath',
  'ytDlpPlaybackCookiesBrowser',
  'ytDlpPlaybackCookiesBrowserProfile',
  'ytDlpPlaybackAlwaysUseCookies',
  'ytDlpSubtitleUseCookies',
  'ytDlpPlaybackCacheMaxEntrySize',
  'ytDlpFfmpegSource',
  'ytDlpFfmpegPath',
  'externalSoftwareUpdateMode',
  // DownloadSettings
  'ytDlpDownloadFolderPath',
  'ytDlpDownloadCustomArgs',
  // Others
  'disableSmoothScrolling',
  'hideToTrayOnMinimize',
  'settingsPassword',
  'screenshotAskPath',
  'screenshotFolderPath',
  'syncServerEnabled',
  'syncServerUrl',
  'syncServerUsername',
  'syncServerToken',
  'syncServerDeviceId',
  'syncServerDeviceName',
  'syncServerPrivacyMode',
  'syncServerPrivacyKey',
  'syncServerPrivacySalt',
  'syncServerAutoSync',
  'syncServerResumeAutoSync',
  'syncServerSyncSubscriptions',
  'syncServerSyncPlaylists',
  'syncServerSyncHistory',
  'syncServerSyncProfiles',
  'syncServerSyncSessions',
  'syncServerSharedTabs',
  'syncServerSyncSettings',
  'syncServerSettingsExcluded',
  'syncServerSettingUpdatedAt',
  'syncServerLastSyncAt',
  'syncServerSnapshot',
  'subscriptionSeenVideos',

  /* Depends on process.env.SUPPORTS_LOCAL_API */
  'backendFallback',
  'backendPreference',
  'proxyVideos',
])

export const NON_SYNCABLE_SETTINGS = new Set([
  ...NON_TRANSFERABLE_SETTINGS,
  // Playlist bookmarks sync with playlists as their own collection.
  'playlistBookmarks',
  // Updating is tied to the installed application and operating system.
  'checkForUpdates',
  // Window coordinates are only valid for the display they were saved on.
  'scrollMiniPlayerSavedRect',
  'crossTabMiniPlayerSavedRect',
  // These choices describe one physical device, not the user's account.
  'androidAutoPictureInPicture',
  'capacitorLayoutMode',
  'continuePlaybackWhenScreenIsLocked',
  'uiScale',
  'verticalTabBarWidth',
])

export function isSettingSyncable(settingKey) {
  return Object.prototype.hasOwnProperty.call(state, settingKey) &&
    !NON_SYNCABLE_SETTINGS.has(settingKey)
}

export function isSettingSyncEnabled(settings, settingKey) {
  const excluded = Array.isArray(settings.syncServerSettingsExcluded)
    ? settings.syncServerSettingsExcluded
    : []
  return isSettingSyncable(settingKey) && !excluded.includes(settingKey)
}

export function getSyncableSettingKeys(settings) {
  return Object.keys(state).filter(settingKey => (
    isSettingSyncEnabled(settings, settingKey) &&
    !(settingKey === 'defaultProfile' && !settings.syncServerSyncProfiles) &&
    isSettingSyncableOnPlatform(settingKey)
  ))
}

let settingSyncTimestampWrite = Promise.resolve()

function recordSettingSyncTimestamp(commit, settings, settingId) {
  if (!isSettingSyncable(settingId) && settingId !== CUSTOM_THEMES_SYNC_KEY) return

  settingSyncTimestampWrite = settingSyncTimestampWrite.then(async () => {
    const current = settings.syncServerSettingUpdatedAt !== null &&
      typeof settings.syncServerSettingUpdatedAt === 'object' &&
      !Array.isArray(settings.syncServerSettingUpdatedAt)
      ? settings.syncServerSettingUpdatedAt
      : {}
    const updatedAt = {
      ...current,
      [settingId]: Date.now(),
    }
    await DBSettingHandlers.upsert('syncServerSettingUpdatedAt', updatedAt)
    commit('setSyncServerSettingUpdatedAt', updatedAt)
  }).catch(error => {
    console.error('Failed to record the setting sync timestamp', error)
  })

  return settingSyncTimestampWrite
}

const customState = {
}

const customGetters = {
  getQuickSettings: (state) => normalizeQuickSettings(state.quickSettings),

  getNavigationItems: (state) => normalizeNavigationItems(state.navigationItems),

  getLandingPage: (state) => resolveLandingPage(
    state.landingPage,
    filterAvailableNavigationItems(normalizeNavigationItems(state.navigationItems), {
      supportsLocalApi: !!process.env.SUPPORTS_LOCAL_API,
      backendPreference: state.backendPreference,
      backendFallback: state.backendFallback,
      showWatchStats: state.rememberHistory && state.enableWatchStats,
    })
  ),

  getPlaylistBookmarks: (state) => {
    return Array.isArray(state.playlistBookmarks) ? state.playlistBookmarks : []
  },

  getPlaylistBookmark: (state) => (playlistId) => {
    if (!Array.isArray(state.playlistBookmarks)) return undefined
    return state.playlistBookmarks.find(bookmark => bookmark?.playlist?.id === playlistId)
  },

  // These parsed variants are cached by Vuex,
  // so that list items don't each have to parse the JSON strings themselves

  getChannelsHiddenParsed: (state) => {
    return JSON.parse(state.channelsHidden).map((ch) => {
      // Legacy support
      if (typeof ch === 'string') {
        return { name: ch, preferredName: '', icon: '' }
      }
      return ch
    })
  },

  /** Set of the `name` values in `channelsHidden` for cheap exact-match lookups */
  getChannelsHiddenNames: (_state, getters) => {
    return new Set(getters.getChannelsHiddenParsed.map((ch) => ch.name))
  },

  /** Lowercased for case-insensitive matching */
  getForbiddenTitlesParsed: (state) => {
    return JSON.parse(state.forbiddenTitles).map((title) => title.toLowerCase())
  },

  getTransferableSettings: (state) => {
    const transferableSettings = {}
    for (const [key, value] of Object.entries(state)) {
      if (!NON_TRANSFERABLE_SETTINGS.has(key)) {
        transferableSettings[key] = value
      }
    }
    return transferableSettings
  }
}

const customMutations = {
  setPreferredCaptionLocale: (state, value) => {
    state.preferredCaptionLocale = normalizeYouTubeCaptionLanguageCode(value)
  },
  setTabBarPosition: (state, value) => {
    state.tabBarPosition = normalizeTabBarPosition(value)
  }
}

async function updateValidatedSetting(commit, settings, settingId, value) {
  try {
    await DBSettingHandlers.upsert(settingId, value)
    await recordSettingSyncTimestamp(commit, settings, settingId)
    commit(defaultMutationId(settingId), value)
  } catch (error) {
    console.error(error)
  }
}

async function persistPlaylistBookmarks(commit, bookmarks) {
  try {
    await DBSettingHandlers.upsert('playlistBookmarks', bookmarks)
    commit('setPlaylistBookmarks', bookmarks)
    return true
  } catch (error) {
    console.error(error)
    return false
  }
}

const updateOptimisticSetting = createOptimisticSettingUpdater()

function updateOrderedSetting(commit, settings, settingId, value) {
  return updateOptimisticSetting(settingId, value, {
    read: () => settings[settingId],
    commit: nextValue => commit(defaultMutationId(settingId), nextValue),
    persist: async nextValue => {
      await DBSettingHandlers.upsert(settingId, nextValue)
      await recordSettingSyncTimestamp(commit, settings, settingId)
    },
  }).then(() => true).catch(error => {
    console.error(error)
    return false
  })
}

let androidProxyUpdate = Promise.resolve()

const customActions = {
  ...Object.fromEntries(ANDROID_PROXY_SETTING_KEYS.filter(() => process.env.IS_CAPACITOR).map(settingId => [
    defaultUpdaterId(settingId),
    ({ commit, state }, value) => {
      // Serialize across fields so a fast host/port edit cannot restore stale values.
      androidProxyUpdate = androidProxyUpdate.then(async () => {
        await configureAndroidProxy({ ...state, [settingId]: value })
        // Native persistence is authoritative, including when the renderer's
        // database cannot save its copy of the settings.
        commit(defaultMutationId(settingId), value)
        await DBSettingHandlers.upsert(settingId, value)
      }).catch(() => {
        showToast({
          message: i18n.global.t('Settings.Proxy Settings["Error getting network information. Is your proxy configured properly?"]'),
          icon: ['fas', 'circle-exclamation'],
        })
      })
      return androidProxyUpdate
    }
  ])),
  waitForAndroidProxySettings: () => androidProxyUpdate,
  loadAndroidProxySettings: async ({ commit }) => {
    const settings = await readAndroidProxySettings()
    if (settings === null) return
    for (const settingId of ANDROID_PROXY_SETTING_KEYS) {
      commit(defaultMutationId(settingId), settings[settingId])
    }
  },
  async mergeSubscriptionSeenVideos({ commit, state, rootGetters }, entries) {
    const saved = await DBSettingHandlers.mergeSeenVideos(entries)
    // Another window's newer update may arrive before this request's reply.
    const value = JSON.stringify(mergeSubscriptionSeenVideos(
      state.subscriptionSeenVideos, saved, rootGetters.getHistoryCacheById
    ))
    if (value !== state.subscriptionSeenVideos) commit('setSubscriptionSeenVideos', value)
  },
  recordSyncSettingEdit: ({ commit, state }, settingId) => (
    recordSettingSyncTimestamp(commit, state, settingId)
  ),
  updateQuickSettings: ({ commit, state }, value) => updateOrderedSetting(
    commit,
    state,
    'quickSettings',
    normalizeQuickSettings(value)
  ),

  updateNavigationItems: ({ commit, state }, value) => updateOrderedSetting(
    commit,
    state,
    'navigationItems',
    normalizeNavigationItems(value)
  ),

  savePlaylistBookmark: async ({ commit, getters }, bookmark) => {
    const bookmarks = getters.getPlaylistBookmarks
      .filter(entry => entry?.playlist?.id !== bookmark.playlist.id)
    bookmarks.push(bookmark)

    return persistPlaylistBookmarks(commit, bookmarks)
  },

  removePlaylistBookmark: async ({ commit, getters }, playlistId) => {
    const bookmarks = getters.getPlaylistBookmarks
      .filter(bookmark => bookmark?.playlist?.id !== playlistId)

    return persistPlaylistBookmarks(commit, bookmarks)
  },

  replacePlaylistBookmarks: async ({ commit }, bookmarks) => {
    return persistPlaylistBookmarks(commit, bookmarks)
  },

  updatePreferredCaptionLocale: ({ commit, state }, value) => updateValidatedSetting(
    commit,
    state,
    'preferredCaptionLocale',
    normalizeYouTubeCaptionLanguageCode(value)
  ),

  updateAppFont: ({ commit, state }, value) => updateValidatedSetting(
    commit,
    state,
    'appFont',
    normalizeAppFont(value)
  ),

  updateMoveDownloadsToAppHeader: async ({ commit, state }, value) => {
    try {
      await DBSettingHandlers.upsert('moveDownloadsToAppHeader', value)
      await recordSettingSyncTimestamp(commit, state, 'moveDownloadsToAppHeader')
      commit('setMoveDownloadsToAppHeader', value)
      await DBSettingHandlers.delete('moveDownloadsToQuickSettings')
    } catch (error) {
      console.error(error)
    }
  },

  updateBaseTheme: ({ commit, rootGetters, state }, value) => updateValidatedSetting(
    commit,
    state,
    'baseTheme',
    resolveBaseTheme(value, 'system', rootGetters.getCustomThemes)
  ),

  updateSystemLightTheme: ({ commit, rootGetters, state }, value) => updateValidatedSetting(
    commit,
    state,
    'systemLightTheme',
    resolveSystemTheme(value, 'light', rootGetters.getCustomThemes)
  ),

  updateSystemDarkTheme: ({ commit, rootGetters, state }, value) => updateValidatedSetting(
    commit,
    state,
    'systemDarkTheme',
    resolveSystemTheme(value, 'dark', rootGetters.getCustomThemes)
  ),

  updateMainColor: ({ commit, state }, value) => updateValidatedSetting(
    commit,
    state,
    'mainColor',
    resolveColor(value, 'Red')
  ),

  updateSecColor: ({ commit, state }, value) => updateValidatedSetting(
    commit,
    state,
    'secColor',
    resolveColor(value, 'Blue')
  ),

  updateTabBarPosition: ({ commit, state }, value) => updateValidatedSetting(
    commit,
    state,
    'tabBarPosition',
    normalizeTabBarPosition(value)
  ),

  updateIconPack: async ({ commit, state }, value) => {
    const previousIconPack = currentIconPack.value
    if (!isIconPack(value) || !await setIconPack(value)) {
      return false
    }

    try {
      await DBSettingHandlers.upsert('iconPack', value)
      await recordSettingSyncTimestamp(commit, state, 'iconPack')
      commit('setIconPack', value)
      return true
    } catch (error) {
      if (isIconPack(previousIconPack)) {
        await setIconPack(previousIconPack)
      }
      console.error(error)
      return false
    }
  },

  resetSettingToDefault: ({ dispatch }, settingKey) => {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, settingKey)) {
      return
    }

    return dispatch(defaultUpdaterId(settingKey), structuredClone(DEFAULT_SETTINGS[settingKey]))
  },

  updateSettingsPassword: async ({ commit }, value) => {
    try {
      const hashedPassword = await hashPassword(value)

      await DBSettingHandlers.upsert('settingsPassword', hashedPassword)

      commit('setSettingsPassword', hashedPassword)
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  grabUserSettings: async ({ commit, dispatch, state }) => {
    try {
      const userSettings = await DBSettingHandlers.find()
      let landingPageToInitialize = null

      const mutationIds = Object.keys(mutations)

      const alreadyTriggeredSideEffects = []
      const sideEffectPromises = []

      for (const { _id, value } of userSettings) {
        let resolvedValue = value
        if (settingsWithSideEffects.includes(_id)) {
          if (_id === 'iconPack') {
            resolvedValue = await dispatch(defaultSideEffectsTriggerId(_id), value)
            if (resolvedValue !== value) {
              await DBSettingHandlers.upsert(_id, resolvedValue)
            }
          } else {
            sideEffectPromises.push(
              dispatch(defaultSideEffectsTriggerId(_id), value)
            )
          }
          alreadyTriggeredSideEffects.push(_id)
        }

        if (mutationIds.includes(defaultMutationId(_id))) {
          commit(defaultMutationId(_id), resolvedValue)
        }
      }

      const hasNavigationItems = userSettings.some(entry => entry._id === 'navigationItems')
      if (!hasNavigationItems && userSettings.length > 0) {
        await dispatch('updateNavigationItems', navigationItemsFromLegacySettings(
          Object.fromEntries(userSettings.map(({ _id, value }) => [_id, value]))
        ))
      }

      const preferredCaptionLocaleEntry = userSettings.find(
        entry => entry._id === 'preferredCaptionLocale'
      )
      if (
        preferredCaptionLocaleEntry &&
        preferredCaptionLocaleEntry.value !== state.preferredCaptionLocale
      ) {
        await dispatch('updatePreferredCaptionLocale', preferredCaptionLocaleEntry.value)
      }

      const hasTabBarPosition = userSettings.some(entry => entry._id === 'tabBarPosition')
      const legacyVerticalTabBar = userSettings.find(entry => entry._id === 'useVerticalTabBar')
      if (!hasTabBarPosition && legacyVerticalTabBar?.value === true) {
        await dispatch('updateTabBarPosition', 'left')
      }

      if (state.landingPage === 'settings') {
        await dispatch('updateLandingPage', 'subscriptions')
      }

      const hasLandingPage = userSettings.some(entry => entry._id === 'landingPage')
      if (!hasLandingPage) {
        const profiles = await DBProfileHandlers.find()
        const isFreshInstallation = userSettings.length === 0 && profiles.length === 0
        const resolvedLandingPage = isFreshInstallation
          ? DEFAULT_LANDING_PAGE
          : LEGACY_DEFAULT_LANDING_PAGE
        commit('setLandingPage', resolvedLandingPage)
        landingPageToInitialize = isFreshInstallation
          ? resolvedLandingPage
          : null
      }

      const keyboardShortcutsEntry = userSettings.find(entry => entry._id === 'keyboardShortcuts')
      if (keyboardShortcutsEntry) {
        const sanitizedShortcuts = sanitizeKeyboardShortcutOverrides(keyboardShortcutsEntry.value)
        if (sanitizedShortcuts !== keyboardShortcutsEntry.value) {
          await dispatch('updateKeyboardShortcuts', sanitizedShortcuts)
        }
      }

      const legacyAutoPipModeEntry = userSettings.find(entry => entry._id === 'autoPictureInPictureMode')
      const legacyAutoPipTabEntry = userSettings.find(entry => entry._id === 'autoPictureInPictureOnTabChange')
      const legacyDownloadsPlacementEntry = userSettings.find(
        entry => entry._id === 'moveDownloadsToQuickSettings'
      )
      const hasDownloadsHeaderPlacementSetting = userSettings.some(
        entry => entry._id === 'moveDownloadsToAppHeader'
      )
      const hasPipTriggersSetting = userSettings.some(entry => entry._id === 'autoPictureInPictureTriggers')
      const hasScrollMiniSetting = userSettings.some(entry => entry._id === 'scrollMiniPlayerEnabled')
      const legacyProgressToastEntry = userSettings.find(entry => entry._id === 'showSubscriptionRefreshToast')
      const hasProgressToastSetting = userSettings.some(entry => entry._id === 'showProgressBarToast')
      const legacyHideLiveChatEntry = userSettings.find(entry => entry._id === 'hideLiveChat')
      const hasHideLiveChatReplaySetting = userSettings.some(entry => entry._id === 'hideLiveChatReplay')
      const legacyPlaybackSpeedSyncEntry = userSettings.find(
        entry => entry._id === 'syncServerSyncPlaybackSpeeds'
      )
      const hasMigratedChannelSettingsSync = userSettings.some(
        entry => entry._id === CHANNEL_SETTINGS_SYNC_MIGRATION_SETTING
      )

      if (legacyDownloadsPlacementEntry && !hasDownloadsHeaderPlacementSetting) {
        await dispatch(
          'updateMoveDownloadsToAppHeader',
          legacyDownloadsPlacementEntry.value !== true
        )
      }

      if (!hasMigratedChannelSettingsSync) {
        try {
          if (legacyPlaybackSpeedSyncEntry?.value === false) {
            const excluded = Array.isArray(state.syncServerSettingsExcluded)
              ? state.syncServerSettingsExcluded
              : []
            await dispatch('updateSyncServerSettingsExcluded', Array.from(new Set([
              ...excluded,
              'channelPlaybackSpeeds',
            ])))
          }
          await DBSettingHandlers.upsert(CHANNEL_SETTINGS_SYNC_MIGRATION_SETTING, true)
        } catch (error) {
          console.error('Failed to migrate saved channel settings sync', error)
        }
      }

      if (legacyProgressToastEntry && !hasProgressToastSetting) {
        await dispatch('updateShowProgressBarToast', legacyProgressToastEntry.value === true)
      }

      // Hide Live Chat covered both active chats and replays before the replay
      // preference was split out. Preserve that choice for existing profiles.
      if (legacyHideLiveChatEntry && !hasHideLiveChatReplaySetting) {
        await dispatch('updateHideLiveChatReplay', legacyHideLiveChatEntry.value === true)
      }

      // Migrate the legacy auto Picture-in-Picture setting to the combinable triggers array.
      // The old behavior fired on both in-app tab changes and window minimize, so preserve both.
      if (!hasPipTriggersSetting) {
        let tabChangeEnabled = null

        if (legacyAutoPipTabEntry) {
          tabChangeEnabled = legacyAutoPipTabEntry.value === true
        } else if (legacyAutoPipModeEntry) {
          tabChangeEnabled = legacyAutoPipModeEntry.value === 'tab' || legacyAutoPipModeEntry.value === 'both'
        }

        if (tabChangeEnabled !== null) {
          await dispatch('updateAutoPictureInPictureTriggers', tabChangeEnabled ? ['tab', 'minimize'] : [])
        }
      }

      if (legacyAutoPipModeEntry && !hasScrollMiniSetting) {
        await dispatch('updateScrollMiniPlayerEnabled', legacyAutoPipModeEntry.value !== 'never')
      }

      // Existing logged-in sync users keep sync enabled; everyone else starts off
      // so the default server is not contacted until the user opts in.
      const hasSyncServerEnabledSetting = userSettings.some(entry => entry._id === 'syncServerEnabled')
      if (!hasSyncServerEnabledSetting) {
        const token = typeof state.syncServerToken === 'string' ? state.syncServerToken : ''
        await dispatch('updateSyncServerEnabled', token !== '')
      }

      for (const _id of settingsWithSideEffects) {
        if (!alreadyTriggeredSideEffects.includes(_id)) {
          if (_id === 'iconPack') {
            const value = state[_id]
            const resolvedValue = await dispatch(defaultSideEffectsTriggerId(_id), value)
            if (resolvedValue !== value) {
              await DBSettingHandlers.upsert(_id, resolvedValue)
              commit(defaultMutationId(_id), resolvedValue)
            }
          } else {
            sideEffectPromises.push(
              dispatch(defaultSideEffectsTriggerId(_id), state[_id])
            )
          }
        }
      }

      await Promise.allSettled(sideEffectPromises)
      return {
        hasExistingSettings: userSettings.some(({ _id }) => !TUTORIAL_STATE_SETTING_IDS.has(_id)),
        landingPageToInitialize,
        tutorialAudience: userSettings.find(({ _id }) => _id === TUTORIAL_AUDIENCE_SETTING_ID)?.value ?? null,
        lastUsedVersion: userSettings.find(({ _id }) => _id === LAST_USED_VERSION_SETTING_ID)?.value ?? null,
      }
    } catch (errMessage) {
      console.error(errMessage)
      // The renderer no longer preloads a default icon bundle before mounting.
      // Preserve usable fallback icons even when the settings datastore itself
      // cannot be read during startup.
      await sideEffectHandlers.iconPack(null, state.iconPack)
        .then(value => commit('setIconPack', value))
        .catch(console.error)
      return {
        hasExistingSettings: null,
        landingPageToInitialize: null,
        tutorialAudience: null,
        lastUsedVersion: null,
      }
    }
  },

  redirectHomeTabsToLandingPage: async ({ getters }) => {
    if (!process.env.IS_ELECTRON) { return }

    const landingRoute = { path: `/${getters.getLandingPage}` }
    const homeTabs = getters.getTabs.filter(tab => tab.route.path === '/home')
    const navigation = getTabNavigationService()
    await Promise.all(homeTabs.map(tab => navigation.replace(tab.id, landingRoute)))
  },

  // Should be a root action, but we'll tolerate
  setupListenersToSyncWindows: ({ commit, dispatch }) => {
    if (process.env.IS_ELECTRON) {
      window.ftElectron.handleSyncSettings((event, data) => {
        switch (event) {
          case SyncEvents.GENERAL.UPSERT:
            if (settingsWithSideEffects.includes(data._id)) {
              dispatch(defaultSideEffectsTriggerId(data._id), data.value)
            }

            commit(defaultMutationId(data._id), data.value)
            if (
              data._id === 'navigationItems' &&
              !normalizeNavigationItems(data.value).includes('home')
            ) {
              dispatch('redirectHomeTabsToLandingPage').catch(error => {
                console.error('Failed to redirect Home tabs after syncing navigation items', error)
              })
            }
            if (data._id === 'syncServerEnabled') {
              dispatch('applySyncServerEnabled', data.value, { root: true })
            }
            break

          default:
            console.error('settings: invalid sync event received')
        }
      })

      window.ftElectron.handleSyncHistory((event, data) => {
        switch (event) {
          case SyncEvents.GENERAL.UPSERT:
            commit('upsertToHistoryCache', data)
            break

          case SyncEvents.GENERAL.OVERWRITE: {
            const byId = {}
            data.forEach(video => {
              byId[video.videoId] = video
            })

            // It comes pre-sorted, so we don't have to sort it here
            commit('setHistoryCacheSorted', data)
            commit('setHistoryCacheById', byId)
            break
          }

          case SyncEvents.HISTORY.UPDATE_WATCH_PROGRESS:
            commit('updateRecordWatchProgressInHistoryCache', data)
            break

          case SyncEvents.HISTORY.UPDATE_PLAYLIST:
            commit('updateRecordLastViewedPlaylistIdInHistoryCache', data)
            break

          case SyncEvents.HISTORY.APPLY_SYNC_CHANGES:
            commit('applyHistorySyncChanges', data)
            break

          case SyncEvents.GENERAL.DELETE:
            commit('removeFromHistoryCacheById', data)
            break

          case SyncEvents.GENERAL.DELETE_MULTIPLE:
            commit('removeMultipleFromHistoryCache', data)
            break

          case SyncEvents.GENERAL.DELETE_ALL:
            commit('setHistoryCacheSorted', [])
            commit('setHistoryCacheById', {})
            break

          default:
            console.error('history: invalid sync event received')
        }
      })

      window.ftElectron.handleSyncWatchStats((event, data) => {
        switch (event) {
          case SyncEvents.WATCH_STATS.ADD_WATCH_TIME:
            commit('addWatchTime', data)
            break

          case SyncEvents.WATCH_STATS.ADJUST_HISTORICAL_WATCH_TIME:
            commit('setWatchStats', data.records)
            commit('setHistoricalWatchTimePlaybackSpeed', data.defaultSpeed)
            break

          case SyncEvents.GENERAL.DELETE_ALL:
            commit('resetWatchStats')
            break

          default:
            console.error('watch stats: invalid sync event received')
        }
      })

      window.ftElectron.handleSyncRecommendations(data => {
        dispatch('receiveRecommendationUpdate', data).catch(error => console.error('Could not sync recommendation learning', error))
      })

      window.ftElectron.handleSyncSearchHistory((event, data) => {
        switch (event) {
          case SyncEvents.GENERAL.UPSERT:
            commit('upsertSearchHistoryEntryToList', data)
            break

          case SyncEvents.GENERAL.OVERWRITE:
            // It comes pre-sorted, so we don't have to sort it here
            commit('setSearchHistoryEntries', data)
            break

          case SyncEvents.GENERAL.DELETE:
            commit('removeSearchHistoryEntryFromList', data)
            break

          case SyncEvents.GENERAL.DELETE_ALL:
            commit('setSearchHistoryEntries', [])
            break

          default:
            console.error('search history: invalid sync event received')
        }
      })

      window.ftElectron.handleSyncProfiles((event, data) => {
        switch (event) {
          case SyncEvents.GENERAL.CREATE:
            commit('addProfileToList', data)
            break

          case SyncEvents.GENERAL.UPSERT:
            commit('upsertProfileToList', data)
            break

          case SyncEvents.PROFILES.ADD_CHANNEL:
            commit('addChannelToProfiles', data)
            break

          case SyncEvents.PROFILES.REMOVE_CHANNEL:
            commit('removeChannelFromProfiles', data)
            break

          case SyncEvents.PROFILES.UPDATE_CHANNEL_SETTINGS:
            commit('updateChannelSettings', data)
            break

          case SyncEvents.GENERAL.DELETE:
            commit('removeProfileFromList', data)
            break

          default:
            console.error('profiles: invalid sync event received')
        }
      })

      window.ftElectron.handleSyncPlaylists((event, data) => {
        switch (event) {
          case SyncEvents.GENERAL.CREATE:
            commit('addPlaylists', data)
            break

          case SyncEvents.GENERAL.DELETE:
            commit('removePlaylist', data)
            break

          case SyncEvents.GENERAL.UPSERT:
            commit('upsertPlaylistToList', data)
            break

          case SyncEvents.PLAYLISTS.UPSERT_VIDEO:
            commit('addVideo', data)
            break

          case SyncEvents.PLAYLISTS.UPSERT_VIDEOS:
            commit('addVideos', data)
            break

          case SyncEvents.PLAYLISTS.DELETE_VIDEO:
            commit('removeVideo', data)
            break

          case SyncEvents.PLAYLISTS.DELETE_VIDEOS:
            commit('removeVideos', data)
            break

          default:
            console.error('playlists: invalid sync event received')
        }
      })

      window.ftElectron.handleSyncSubscriptionCache((event, data) => {
        switch (event) {
          case SyncEvents.SUBSCRIPTION_CACHE.UPDATE_VIDEOS_BY_CHANNEL:
            commit('updateVideoCacheByChannel', data)
            break

          case SyncEvents.SUBSCRIPTION_CACHE.UPDATE_LIVE_STREAMS_BY_CHANNEL:
            commit('updateLiveCacheByChannel', data)
            break

          case SyncEvents.SUBSCRIPTION_CACHE.UPDATE_SHORTS_BY_CHANNEL:
            commit('updateShortsCacheByChannel', data)
            break

          case SyncEvents.SUBSCRIPTION_CACHE.UPDATE_SHORTS_WITH_CHANNEL_PAGE_SHORTS_BY_CHANNEL:
            commit('updateShortsCacheWithChannelPageShorts', data)
            break

          case SyncEvents.SUBSCRIPTION_CACHE.UPDATE_COMMUNITY_POSTS_BY_CHANNEL:
            commit('updatePostsCacheByChannel', data)
            break

          case SyncEvents.GENERAL.DELETE_MULTIPLE:
            commit('clearCachesForManyChannels', data)
            break

          case SyncEvents.GENERAL.DELETE_ALL:
            commit('clearCaches', data)
            break

          default:
            console.error('subscription-cache: invalid sync event received')
        }
      })
    }
  }
}

/**********************/
/*
 * DO NOT TOUCH ANYTHING BELOW
 * (unless you plan to change the architecture of this module)
 */

const getters = {}
const mutations = {}
const actions = {}
const runSettingUpdate = createSettingUpdateQueue()

// Build default getters, mutations and actions for every setting id
for (const settingId of Object.keys(state)) {
  const getterId = defaultGetterId(settingId)
  const mutationId = defaultMutationId(settingId)
  const updaterId = defaultUpdaterId(settingId)

  getters[getterId] = (state) => state[settingId]
  mutations[mutationId] = (state, value) => { state[settingId] = value }

  if (settingsWithSideEffects.includes(settingId)) {
    const triggerId = defaultSideEffectsTriggerId(settingId)

    // If setting has side effects, generate action to handle them
    actions[triggerId] = sideEffectHandlers[settingId]

    actions[updaterId] = ({ commit, dispatch, state }, value) => (
      runSettingUpdate(settingId, async isLatest => {
        await DBSettingHandlers.upsert(settingId, value)

        if (!isLatest()) return
        await recordSettingSyncTimestamp(commit, state, settingId)

        if (!isLatest()) return
        dispatch(triggerId, value)

        commit(mutationId, value)
      }).catch(errMessage => {
        console.error(errMessage)
      })
    )
  } else {
    actions[updaterId] = ({ commit, state }, value) => (
      runSettingUpdate(settingId, async isLatest => {
        await DBSettingHandlers.upsert(settingId, value)

        if (!isLatest()) return
        await recordSettingSyncTimestamp(commit, state, settingId)

        if (isLatest()) commit(mutationId, value)
      }).catch(errMessage => {
        console.error(errMessage)
      })
    )
  }
}

// Add all custom data/logic to their respective objects
Object.assign(state, customState)
Object.assign(getters, customGetters)
Object.assign(mutations, customMutations)
Object.assign(actions, customActions)

export default {
  state,
  getters,
  actions,
  mutations
}
