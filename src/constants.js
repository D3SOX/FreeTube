// IPC Channels
const IpcChannels = {
  ENABLE_PROXY: 'enable-proxy',
  DISABLE_PROXY: 'disable-proxy',
  GET_DEVICE_NAME: 'get-device-name',
  GET_DEVICE_INFO: 'get-device-info',
  GET_SYSTEM_LOCALE: 'get-system-locale',
  GET_SYSTEM_FONTS: 'get-system-fonts',
  READ_CLIPBOARD: 'read-clipboard',
  GET_NAVIGATION_HISTORY: 'get-navigation-history',
  IS_WAYLAND_PLATFORM: 'is-wayland-platform',
  STOP_POWER_SAVE_BLOCKER: 'stop-power-save-blocker',
  START_POWER_SAVE_BLOCKER: 'start-power-save-blocker',
  CREATE_NEW_WINDOW: 'create-new-window',
  NATIVE_THEME_UPDATE: 'native-theme-update',
  APP_READY: 'app-ready',
  RELAUNCH_REQUEST: 'relaunch-request',
  SET_WINDOW_TITLE: 'set-window-title',
  CUSTOM_THEME_LOAD: 'custom-theme-load',
  CUSTOM_THEME_SAVE: 'custom-theme-save',
  CUSTOM_THEME_DELETE: 'custom-theme-delete',
  CUSTOM_THEME_REPLACE: 'custom-theme-replace',
  CUSTOM_THEME_UPDATED: 'custom-theme-updated',

  SEARCH_INPUT_HANDLING_READY: 'search-input-handling-ready',
  UPDATE_SEARCH_INPUT_TEXT: 'update-search-input-text',

  OPEN_URL: 'open-url',
  CHANGE_VIEW: 'change-view',
  SHOW_TOAST: 'show-toast',
  LIVE_REMINDER_GET: 'live-reminder-get',
  LIVE_REMINDER_LIST: 'live-reminder-list',
  LIVE_REMINDER_SCHEDULE: 'live-reminder-schedule',
  LIVE_REMINDER_CANCEL: 'live-reminder-cancel',
  LIVE_REMINDER_UPDATED: 'live-reminder-updated',
  VIDEO_METADATA_CACHE_UPDATE: 'video-metadata-cache-update',
  VIDEO_METADATA_CACHE_GET_SIZE: 'video-metadata-cache-get-size',
  VIDEO_METADATA_CACHE_CLEAR: 'video-metadata-cache-clear',
  VIDEO_METADATA_CACHE_CLEARED: 'video-metadata-cache-cleared',
  STORAGE_GET_USAGE: 'storage-get-usage',
  STORAGE_CLEAR: 'storage-clear',
  STORAGE_COMPACT_DATABASES: 'storage-compact-databases',
  SUBSCRIPTION_AUTO_REFRESH_ACQUIRE: 'subscription-auto-refresh-acquire',
  SUBSCRIPTION_AUTO_REFRESH_CANCEL: 'subscription-auto-refresh-cancel',
  SUBSCRIPTION_AUTO_REFRESH_GET_STATE: 'subscription-auto-refresh-get-state',
  SUBSCRIPTION_AUTO_REFRESH_RELEASE: 'subscription-auto-refresh-release',
  SUBSCRIPTION_AUTO_REFRESH_SET_PROGRESS: 'subscription-auto-refresh-set-progress',
  SUBSCRIPTION_AUTO_REFRESH_STATE_CHANGED: 'subscription-auto-refresh-state-changed',
  SUBSCRIPTION_FEED_REQUEST_MARK_SEEN: 'subscription-feed-request-mark-seen',
  SUBSCRIPTION_FEED_REQUEST_RELOAD: 'subscription-feed-request-reload',

  // Tab management
  TABS_GET_STATE: 'tabs-get-state',
  TABS_GET_SYNC_SESSIONS: 'tabs-get-sync-sessions',
  TABS_APPLY_SYNC_SESSIONS: 'tabs-apply-sync-sessions',
  TABS_CREATE: 'tabs-create',
  TABS_CLOSE: 'tabs-close',
  TABS_CLOSE_MULTIPLE: 'tabs-close-multiple',
  TABS_ACTIVATE: 'tabs-activate',
  TABS_DUPLICATE: 'tabs-duplicate',
  TABS_MOVE: 'tabs-move',
  TABS_REORDER: 'tabs-reorder',
  TABS_SET_PINNED: 'tabs-set-pinned',
  TABS_SET_COLOR: 'tabs-set-color',
  TABS_CREATE_GROUP: 'tabs-create-group',
  TABS_UPDATE_GROUP: 'tabs-update-group',
  TABS_DELETE_GROUP: 'tabs-delete-group',
  TABS_SET_GROUP: 'tabs-set-group',
  TABS_RUN_ORGANIZER_ACTION: 'tabs-run-organizer-action',
  TABS_GET_MOVE_TARGETS: 'tabs-get-move-targets',
  TABS_MOVE_TO_WINDOW: 'tabs-move-to-window',
  TABS_SET_SELECTED: 'tabs-set-selected',
  TABS_SET_LOADING: 'tabs-set-loading',
  TABS_CAPTURE_PREVIEW: 'tabs-capture-preview',
  TABS_GET_CACHED_PREVIEWS: 'tabs-get-cached-previews',
  TABS_SET_PREVIEWS_ENABLED: 'tabs-set-previews-enabled',
  TABS_SET_PREVIEW_CAPTURE_PAUSED: 'tabs-set-preview-capture-paused',
  TABS_SET_SHORTCUTS_BLOCKED: 'tabs-set-shortcuts-blocked',
  TABS_REQUEST_PREVIEW_REFRESH: 'tabs-request-preview-refresh',
  TABS_RESTORE_CLOSED: 'tabs-restore-closed',
  TABS_CLEAR_CLOSED: 'tabs-clear-closed',
  TABS_RELOAD: 'tabs-reload',
  TABS_REQUEST_RELOAD: 'tabs-request-reload',
  TABS_STATE_UPDATED: 'tabs-state-updated',
  TABS_RENDERER_READY: 'tabs-renderer-ready',
  TABS_MOUNT_READY: 'tabs-mount-ready',
  TABS_MOUNT_FAILED: 'tabs-mount-failed',
  TABS_PRESENTED: 'tabs-presented',
  TABS_UPDATE_ROUTE: 'tabs-update-route',
  TABS_UPDATE_NAV_HISTORY: 'tabs-update-nav-history',
  TABS_UPDATE_TITLE: 'tabs-update-title',
  TABS_UPDATE_AVATAR: 'tabs-update-avatar',
  TABS_SET_AVATARS_ENABLED: 'tabs-set-avatars-enabled',
  TABS_EXIT_FULLSCREEN: 'tabs-exit-fullscreen',
  TABS_ACTIVE_CHANGED: 'tabs-active-changed',
  TABS_IS_ACTIVE: 'tabs-is-active',
  TABS_GO_HISTORY: 'tabs-go-history',
  TABS_SET_PLAYBACK_STATE: 'tabs-set-playback-state',
  TABS_SET_MEDIA_SESSION_STATE: 'tabs-set-media-session-state',
  TABS_REQUEST_MEDIA_SESSION_ACTION: 'tabs-request-media-session-action',
  TABS_SET_SKIP_SILENCE: 'tabs-set-skip-silence',
  TABS_REQUEST_PICTURE_IN_PICTURE: 'tabs-request-picture-in-picture',
  WINDOW_MINIMIZED_STATE: 'window-minimized-state',
  WINDOW_FOCUSED_STATE: 'window-focused-state',
  SUPPORTS_AUTO_PICTURE_IN_PICTURE_MINIMIZE: 'supports-auto-picture-in-picture-minimize',
  TABS_REQUEST_FULLSCREEN: 'tabs-request-fullscreen',
  TABS_SET_TAB_BAR_SCROLL: 'tabs-set-tab-bar-scroll',
  TABS_SET_CONTEXT_MENU_TAB: 'tabs-set-context-menu-tab',
  TABS_OPEN_ORGANIZER: 'tabs-open-organizer',
  TABS_CONFIRM_MULTIPLE_ACTION: 'tabs-confirm-multiple-action',
  TABS_CONFIRM_MULTIPLE_ACTION_RESPONSE: 'tabs-confirm-multiple-action-response',
  CONTEXT_MENU_OPEN: 'context-menu-open',
  CONTEXT_MENU_EXECUTE: 'context-menu-execute',
  RESOLVE_FAVICON: 'resolve-favicon',
  CREATE_NEW_TAB: 'create-new-tab',

  DB_SETTINGS: 'db-settings',
  DB_HISTORY: 'db-history',
  DB_WATCH_STATS: 'db-watch-stats',
  DB_RECOMMENDATIONS: 'db-recommendations',
  SYNC_RECOMMENDATIONS: 'sync-recommendations',
  DB_PROFILES: 'db-profiles',
  DB_PLAYLISTS: 'db-playlists',
  DB_SEARCH_HISTORY: 'db-search-history',
  DB_SUBSCRIPTION_CACHE: 'db-subscription-cache',

  SYNC_SETTINGS: 'sync-settings',
  SYNC_HISTORY: 'sync-history',
  SYNC_WATCH_STATS: 'sync-watch-stats',
  SYNC_SEARCH_HISTORY: 'sync-search-history',
  SYNC_PROFILES: 'sync-profiles',
  SYNC_PLAYLISTS: 'sync-playlists',
  SYNC_SUBSCRIPTION_CACHE: 'sync-subscription-cache',

  GET_REPLACE_HTTP_CACHE: 'get-replace-http-cache',
  TOGGLE_REPLACE_HTTP_CACHE: 'toggle-replace-http-cache',

  GET_DISABLE_HARDWARE_ACCELERATION: 'get-disable-hardware-acceleration',
  TOGGLE_DISABLE_HARDWARE_ACCELERATION: 'toggle-disable-hardware-acceleration',

  PLAYER_CACHE_GET: 'player-cache-get',
  PLAYER_CACHE_SET: 'player-cache-set',
  VOICE_OVER_TRANSLATION_REQUEST: 'voice-over-translation-request',

  SET_INVIDIOUS_AUTHORIZATION: 'set-invidious-authorization',

  GENERATE_PO_TOKEN: 'generate-po-token',

  OPEN_PROFILE_DIRECTORY: 'open-profile-directory',
  CHOOSE_DEFAULT_FOLDER: 'choose-default-folder',
  CHOOSE_IP_BLOCK_RECOVERY_SCRIPT: 'choose-ip-block-recovery-script',
  WRITE_TO_DEFAULT_FOLDER: 'write-to-default-folder',
  START_IP_BLOCK_RECOVERY_SCRIPT: 'start-ip-block-recovery-script',
  EXECUTE_IP_BLOCK_RECOVERY_SCRIPT: 'execute-ip-block-recovery-script',
  WAIT_FOR_IP_BLOCK_RECOVERY_SCRIPT: 'wait-for-ip-block-recovery-script',

  OPEN_IN_EXTERNAL_PLAYER: 'open-in-external-player',
  OPEN_IN_EXTERNAL_PLAYER_RESULT: 'open-in-external-player-result',

  YT_DLP_DOWNLOAD: 'yt-dlp-download',
  YT_DLP_CANCEL_DOWNLOAD: 'yt-dlp-cancel-download',
  YT_DLP_CONTROL_DOWNLOAD: 'yt-dlp-control-download',
  YT_DLP_QUEUE_ACTION: 'yt-dlp-queue-action',
  YT_DLP_DOWNLOAD_STATUS: 'yt-dlp-download-status',
  YT_DLP_DOWNLOADS_REMOVED: 'yt-dlp-downloads-removed',
  YT_DLP_LIST_DOWNLOADS: 'yt-dlp-list-downloads',
  YT_DLP_CHOOSE_BROWSER_PROFILE: 'yt-dlp-choose-browser-profile',
  YT_DLP_CHOOSE_COOKIES: 'yt-dlp-choose-cookies',
  YT_DLP_CLEAR_DOWNLOADS: 'yt-dlp-clear-downloads',
  YT_DLP_OPEN_DOWNLOAD: 'yt-dlp-open-download',
  YT_DLP_REMOVE_DOWNLOAD: 'yt-dlp-remove-download',
  YT_DLP_CHOOSE_DOWNLOAD_FOLDER: 'yt-dlp-choose-download-folder',
  YT_DLP_CHOOSE_EXECUTABLE: 'yt-dlp-choose-executable',
  YT_DLP_GET_INFO: 'yt-dlp-get-info',
  YT_DLP_GET_SUBTITLE: 'yt-dlp-get-subtitle',
  YT_DLP_GET_PLAYBACK_INFO: 'yt-dlp-get-playback-info',
  YT_DLP_GET_RECOMMENDATIONS: 'yt-dlp-get-recommendations',
  YT_DLP_PLAYBACK_CACHE_GET: 'yt-dlp-playback-cache-get',
  YT_DLP_PLAYBACK_CACHE_SET: 'yt-dlp-playback-cache-set',
  YT_DLP_PLAYBACK_CACHE_DELETE: 'yt-dlp-playback-cache-delete',
  YT_DLP_PLAYBACK_CACHE_CLEAR: 'yt-dlp-playback-cache-clear',
  YT_DLP_CHECK_BINARY_UPDATE: 'yt-dlp-check-binary-update',
  YT_DLP_DOWNLOAD_BINARY: 'yt-dlp-download-binary',
  YT_DLP_BINARY_DOWNLOAD_PROGRESS: 'yt-dlp-binary-download-progress',
  YT_DLP_BINARY_UPDATED: 'yt-dlp-binary-updated'
}

const DOWNLOADED_MEDIA_MIME_TYPES = {
  aac: 'audio/aac',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  m4v: 'video/mp4',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  mp4: 'video/mp4',
  webm: 'video/webm'
}

const DBActions = {
  // The constants in the GENERAL group are usally intermingeled with the ones in other groups, so they need unique values.
  // The other groups however are usually not mixed (e.g. HISTORY and PROFILES),
  // so they can have similar values (as long as they don't overlap with the GENERAL group).
  GENERAL: {
    CREATE: 0,
    FIND: 1,
    UPSERT: 2,
    DELETE: 3,
    DELETE_MULTIPLE: 4,
    DELETE_ALL: 5,
    OVERWRITE: 6
  },

  HISTORY: {
    UPDATE_WATCH_PROGRESS: 20,
    UPDATE_PLAYLIST: 21,
    DELETE_OLDER_THAN: 22,
    APPLY_SYNC_CHANGES: 23,
  },

  WATCH_STATS: {
    ADD_WATCH_TIME: 20,
    MIGRATE_HISTORY: 21,
    GET_HISTORICAL_ADJUSTMENT: 22,
    ADJUST_HISTORICAL_WATCH_TIME: 23,
  },

  PROFILES: {
    ADD_CHANNEL: 20,
    REMOVE_CHANNEL: 21,
    UPDATE_CHANNEL_SETTINGS: 22
  },

  PLAYLISTS: {
    UPSERT_VIDEO: 20,
    UPSERT_VIDEOS: 21,
    DELETE_VIDEO_ID: 22,
    DELETE_VIDEO_IDS: 23,
    DELETE_ALL_VIDEOS: 24,
  },

  SUBSCRIPTION_CACHE: {
    UPDATE_VIDEOS_BY_CHANNEL: 20,
    UPDATE_LIVE_STREAMS_BY_CHANNEL: 21,
    UPDATE_SHORTS_BY_CHANNEL: 22,
    UPDATE_SHORTS_WITH_CHANNEL_PAGE_SHORTS_BY_CHANNEL: 23,
    UPDATE_COMMUNITY_POSTS_BY_CHANNEL: 24,
  },
}

const SyncEvents = {
  // The constants in the GENERAL group are usally intermingeled with the ones in other groups, so they need unique values.
  // The other groups however are usually not mixed (e.g. HISTORY and PROFILES),
  // so they can have similar values (as long as they don't overlap with the GENERAL group).
  GENERAL: {
    CREATE: 0,
    UPSERT: 1,
    DELETE: 2,
    DELETE_MULTIPLE: 3,
    DELETE_ALL: 4,
    OVERWRITE: 5,
  },

  HISTORY: {
    UPDATE_WATCH_PROGRESS: 20,
    UPDATE_PLAYLIST: 21,
    APPLY_SYNC_CHANGES: 22,
  },

  WATCH_STATS: {
    ADD_WATCH_TIME: 20,
    ADJUST_HISTORICAL_WATCH_TIME: 21,
  },

  PROFILES: {
    ADD_CHANNEL: 20,
    REMOVE_CHANNEL: 21,
    UPDATE_CHANNEL_SETTINGS: 22
  },

  PLAYLISTS: {
    UPSERT_VIDEO: 20,
    UPSERT_VIDEOS: 21,
    DELETE_VIDEO: 22,
    DELETE_VIDEOS: 23,
  },

  SUBSCRIPTION_CACHE: {
    UPDATE_VIDEOS_BY_CHANNEL: 20,
    UPDATE_LIVE_STREAMS_BY_CHANNEL: 21,
    UPDATE_SHORTS_BY_CHANNEL: 22,
    UPDATE_SHORTS_WITH_CHANNEL_PAGE_SHORTS_BY_CHANNEL: 23,
    UPDATE_COMMUNITY_POSTS_BY_CHANNEL: 24,
  },
}

/*
  DEV NOTE: Duplicate any and all changes made here to our [official documentation site here](https://github.com/FreeTubeApp/FreeTube-Docs/blob/master/usage/keyboard-shortcuts.md)
  to have them reflect on the [keyboard shortcut reference webpage](https://docs.freetubeapp.io/usage/keyboard-shortcuts).
  Please also update the [keyboard shortcut modal](src/renderer/components/FtKeyboardShortcutPrompt/FtKeyboardShortcutPrompt.vue)
*/
const DefaultKeyboardShortcuts = {
  APP: {
    GENERAL: {
      OPEN_COMMAND_PALETTE: 'ctrl+K',
      SHOW_SHORTCUTS: 'shift+?',
      HISTORY_BACKWARD: 'alt+arrowleft',
      HISTORY_FORWARD: 'alt+arrowright',
      HISTORY_BACKWARD_ALT_MAC: 'cmd+[',
      HISTORY_FORWARD_ALT_MAC: 'cmd+]',
      FULLSCREEN: 'f11',
      NAVIGATE_TO_SETTINGS: 'ctrl+,',
      NAVIGATE_TO_DOWNLOADS: 'ctrl+J',
      NAVIGATE_TO_HISTORY: 'ctrl+H',
      NAVIGATE_TO_HISTORY_MAC: 'cmd+Y',
      NEW_WINDOW: 'ctrl+N',
      MINIMIZE_WINDOW: 'ctrl+M',
      CLOSE_WINDOW: 'ctrl+W',
      TOGGLE_DEVTOOLS: 'ctrl+shift+I',
      FOCUS_SEARCH: 'alt+D',
      FOCUS_SEARCH_ALT: 'ctrl+L',
      FOCUS_SEARCH_ALT_MAC: 'cmd+L',
      FOCUS_SEARCH_ALT_SLASH: '/',
      SEARCH_IN_NEW_WINDOW: 'shift+enter',
      FIND_IN_PAGE: 'ctrl+F',
      FIND_NEXT: 'ctrl+G',
      FIND_NEXT_ALT: 'f3',
      FIND_NEXT_ALT_ENTER: 'enter',
      FIND_PREVIOUS: 'ctrl+shift+G',
      FIND_PREVIOUS_ALT: 'shift+f3',
      FIND_PREVIOUS_ALT_ENTER: 'shift+enter',
      RESET_ZOOM: 'ctrl+0',
      ZOOM_IN: 'ctrl+plus',
      ZOOM_OUT: 'ctrl+-',
      // Tab shortcuts
      NEW_TAB: 'ctrl+T',
      CLOSE_TAB: 'ctrl+W',
      RELOAD_TAB: 'ctrl+R',
      RELOAD_TAB_ALT: 'f5',
      NEXT_TAB: 'control+tab',
      PREV_TAB: 'control+shift+tab',
      RESTORE_CLOSED_TAB: 'ctrl+shift+T',
      SWITCH_TO_TAB: 'ctrl+1-9',
      OPEN_TAB_ORGANIZER: '',
      TOGGLE_TAB_ORIENTATION: 'f1',
    },
    SITUATIONAL: {
      REFRESH: 'r'
    },
  },
  VIDEO_PLAYER: {
    GENERAL: {
      CAPTIONS: 'c',
      THEATRE_MODE: 't',
      FULLSCREEN: 'f',
      FULLWINDOW: 's',
      PICTURE_IN_PICTURE: 'i',
      MUTE: 'm',
      VOLUME_UP: 'arrowup',
      VOLUME_DOWN: 'arrowdown',
      STATS: 'd',
      TAKE_SCREENSHOT: 'u',
      VIDEO_ZOOM_IN: 'z',
      VIDEO_ZOOM_OUT: 'shift+z',
    },
    PLAYBACK: {
      PLAY: 'k',
      LARGE_REWIND: 'j',
      LARGE_FAST_FORWARD: 'l',
      SMALL_REWIND: 'arrowleft',
      SMALL_FAST_FORWARD: 'arrowright',
      DECREASE_VIDEO_SPEED: 'o',
      DECREASE_VIDEO_SPEED_ALT: '<',
      INCREASE_VIDEO_SPEED: 'p',
      INCREASE_VIDEO_SPEED_ALT: '>',
      TOGGLE_NORMAL_PLAYBACK_SPEED: 'g',
      TOGGLE_SKIP_SILENCE: '',
      SET_AB_REPEAT_START: 'shift+a',
      SET_AB_REPEAT_END: 'shift+b',
      CLEAR_AB_REPEAT: 'shift+x',
      SKIP_N_TENTHS: '0..9',
      LAST_CHAPTER: 'ctrl+arrowleft',
      NEXT_CHAPTER: 'ctrl+arrowright',
      LAST_FRAME: ',',
      NEXT_FRAME: '.',
      HOME: 'home',
      END: 'end',
      SKIP_TO_NEXT: 'shift+n',
      SKIP_TO_PREV: 'shift+p'
    }
  },
}

const NonEditableKeyboardShortcutPaths = new Set([
  'APP.GENERAL.FOCUS_SEARCH_ALT_SLASH',
  'APP.GENERAL.SEARCH_IN_NEW_WINDOW',
  'APP.GENERAL.FIND_NEXT_ALT_ENTER',
  'APP.GENERAL.FIND_PREVIOUS_ALT_ENTER',
  'APP.GENERAL.NEXT_TAB',
  'APP.GENERAL.PREV_TAB',
])

const KeyboardShortcuts = getConfiguredKeyboardShortcuts()

/**
 * Builds a complete shortcut dictionary from the defaults and a partial set
 * of user overrides. Unknown entries are ignored so stale settings cannot add
 * actions that the current app does not support.
 * @param {string | object} [overrides]
 * @returns {typeof DefaultKeyboardShortcuts}
 */
function getConfiguredKeyboardShortcuts(overrides = {}) {
  const editableOverrides = getEditableKeyboardShortcutOverrides(overrides)

  return mergeKeyboardShortcutOverrides(DefaultKeyboardShortcuts, editableOverrides)
}

/**
 * Removes overrides for reserved shortcuts and ranges, which represent
 * multiple keys and cannot be replaced by recording one keyboard event.
 * @param {string | object} overrides
 * @returns {string}
 */
function sanitizeKeyboardShortcutOverrides(overrides) {
  return JSON.stringify(getEditableKeyboardShortcutOverrides(overrides))
}

/**
 * @param {string | object} overrides
 * @returns {object}
 */
function getEditableKeyboardShortcutOverrides(overrides) {
  const editableOverrides = filterEditableKeyboardShortcutOverrides(
    DefaultKeyboardShortcuts,
    parseKeyboardShortcutOverrides(overrides)
  )
  const appShortcuts = editableOverrides.APP?.GENERAL

  // Older settings may already replace Ctrl/Cmd+R with F5. Keep that choice
  // without adding the same F5 binding a second time.
  if (
    appShortcuts?.RELOAD_TAB?.toLowerCase() === DefaultKeyboardShortcuts.APP.GENERAL.RELOAD_TAB_ALT &&
    !Object.hasOwn(appShortcuts, 'RELOAD_TAB_ALT')
  ) {
    appShortcuts.RELOAD_TAB_ALT = ''
  }

  return editableOverrides
}

/**
 * @param {string} shortcut
 * @returns {boolean}
 */
function isKeyboardShortcutRange(shortcut) {
  return /^\d(?:\.\.|-)\d$/.test(shortcut.split('+').at(-1))
}

/**
 * @param {string[]} path
 * @param {string} shortcut
 * @returns {boolean}
 */
function isKeyboardShortcutEditable(path, shortcut) {
  return !NonEditableKeyboardShortcutPaths.has(path.join('.')) &&
    !isKeyboardShortcutRange(shortcut)
}

/**
 * @param {string | object} overrides
 * @returns {object}
 */
function parseKeyboardShortcutOverrides(overrides) {
  if (typeof overrides === 'string') {
    try {
      const parsedOverrides = JSON.parse(overrides)
      return parsedOverrides && typeof parsedOverrides === 'object' ? parsedOverrides : {}
    } catch {
      return {}
    }
  }

  return overrides && typeof overrides === 'object' ? overrides : {}
}

/**
 * @param {object | string} defaults
 * @param {unknown} overrides
 * @returns {object | string | undefined}
 */
function filterEditableKeyboardShortcutOverrides(defaults, overrides, path = []) {
  if (typeof defaults === 'string') {
    if (!isKeyboardShortcutEditable(path, defaults)) {
      return undefined
    }
    return typeof overrides === 'string' ? overrides : undefined
  }

  const overrideDictionary = overrides && typeof overrides === 'object' ? overrides : {}
  return Object.fromEntries(Object.entries(defaults)
    .map(([key, value]) => [
      key,
      filterEditableKeyboardShortcutOverrides(value, overrideDictionary[key], [...path, key])
    ])
    .filter(([_key, value]) => value !== undefined && (
      typeof value === 'string' || Object.keys(value).length > 0
    )))
}

/**
 * @param {object | string} defaults
 * @param {unknown} overrides
 * @returns {object | string}
 */
function mergeKeyboardShortcutOverrides(defaults, overrides) {
  if (typeof defaults === 'string') {
    return typeof overrides === 'string' ? overrides : defaults
  }

  const overrideDictionary = overrides && typeof overrides === 'object' ? overrides : {}
  return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [
    key,
    mergeKeyboardShortcutOverrides(value, overrideDictionary[key])
  ]))
}

/**
 * Applies persisted overrides to the live dictionary used by renderer code.
 * Keeping the object identity stable means existing imports see edits without
 * requiring an app restart.
 * @param {string | object} overrides
 */
function applyKeyboardShortcutOverrides(overrides) {
  replaceKeyboardShortcutDictionary(
    KeyboardShortcuts,
    getConfiguredKeyboardShortcuts(overrides)
  )
}

/**
 * @param {object} target
 * @param {object} source
 */
function replaceKeyboardShortcutDictionary(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') {
      target[key] = value
    } else {
      replaceKeyboardShortcutDictionary(target[key], value)
    }
  }
}

/**
 * Converts the app's portable shortcut format to Electron's accelerator
 * syntax. Empty and range-based shortcuts cannot be native accelerators.
 * @param {string} shortcut
 * @returns {string | undefined}
 */
function getElectronAccelerator(shortcut) {
  if (!shortcut || /^\d(?:\.\.|-)\d$/.test(shortcut.split('+').at(-1))) {
    return undefined
  }

  const electronKeys = {
    alt: 'Alt',
    arrowdown: 'Down',
    arrowleft: 'Left',
    arrowright: 'Right',
    arrowup: 'Up',
    cmd: 'Cmd',
    control: 'Ctrl',
    ctrl: 'CmdOrCtrl',
    enter: 'Enter',
    plus: 'Plus',
    shift: 'Shift',
  }

  return shortcut
    .split('+')
    .map(key => electronKeys[key.toLowerCase()] ?? key)
    .join('+')
}

/**
 * Material Design Symbols and custom glyphs used by player components
 *
 * This only has the value of the `d` attribute from the `<path>` element, the rest of the SVG is generated at runtime.
 *
 * Fetched with
 * https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsrounded/<icon>/default/24px.svg
 * https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsrounded/<icon>/fill1/24px.svg
 */
const PlayerIcons = {
  CLOSE_FULLSCREEN_FILLED: 'M400-344 164-108q-11 11-28 11t-28-11q-11-11-11-28t11-28l236-236H200q-17 0-28.5-11.5T160-440q0-17 11.5-28.5T200-480h240q17 0 28.5 11.5T480-440v240q0 17-11.5 28.5T440-160q-17 0-28.5-11.5T400-200v-144Zm216-216h144q17 0 28.5 11.5T800-520q0 17-11.5 28.5T760-480H520q-17 0-28.5-11.5T480-520v-240q0-17 11.5-28.5T520-800q17 0 28.5 11.5T560-760v144l236-236q11-11 28-11t28 11q11 11 11 28t-11 28L616-560Z',
  DONE_FILLED: 'm382-354 339-339q12-12 28-12t28 12q12 12 12 28.5T777-636L410-268q-12 12-28 12t-28-12L182-440q-12-12-11.5-28.5T183-497q12-12 28.5-12t28.5 12l142 143Z',
  INSERT_CHART_DEFAULT: 'M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm0-560v560-560Zm120 200q-17 0-28.5 11.5T280-520v200q0 17 11.5 28.5T320-280q17 0 28.5-11.5T360-320v-200q0-17-11.5-28.5T320-560Zm160-120q-17 0-28.5 11.5T440-640v320q0 17 11.5 28.5T480-280q17 0 28.5-11.5T520-320v-320q0-17-11.5-28.5T480-680Zm160 240q-17 0-28.5 11.5T600-400v80q0 17 11.5 28.5T640-280q17 0 28.5-11.5T680-320v-80q0-17-11.5-28.5T640-440Z',
  INSERT_CHART_FILLED: 'M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm120-440q-17 0-28.5 11.5T280-520v200q0 17 11.5 28.5T320-280q17 0 28.5-11.5T360-320v-200q0-17-11.5-28.5T320-560Zm160-120q-17 0-28.5 11.5T440-640v320q0 17 11.5 28.5T480-280q17 0 28.5-11.5T520-320v-320q0-17-11.5-28.5T480-680Zm160 240q-17 0-28.5 11.5T600-400v80q0 17 11.5 28.5T640-280q17 0 28.5-11.5T680-320v-80q0-17-11.5-28.5T640-440Z',
  INFO_FILLED: 'M440-280h80v-240h-80v240Zm40-320q17 0 28.5-11.5T520-640q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640q0 17 11.5 28.5T480-600Zm0 520q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z',
  LIGHT_MODE_FILLED: 'M480-280q-83 0-141.5-58.5T280-480q0-83 58.5-141.5T480-680q83 0 141.5 58.5T680-480q0 83-58.5 141.5T480-280ZM200-440H40v-80h160v80Zm720 0H760v-80h160v80ZM440-760v-160h80v160h-80Zm0 720v-160h80v160h-80ZM256-650l-101-99 57-57 99 101-55 55Zm492 496-99-101 55-55 101 99-57 57Zm-43-495-55-55 99-101 57 57-101 99ZM211-155l-57-56 101-99 55 55-99 100Z',
  VARIABLES_DEFAULT: 'M120-320v-320q0-17 11.5-28.5T160-680h640q17 0 28.5 11.5T840-640v320q0 17-11.5 28.5T800-280H160q-17 0-28.5-11.5T120-320Zm80-40h560v-240H200v240Zm0 0v-240 240Z',
  OPEN_IN_FULL_FILLED: 'M160-120q-17 0-28.5-11.5T120-160v-240q0-17 11.5-28.5T160-440q17 0 28.5 11.5T200-400v144l504-504H560q-17 0-28.5-11.5T520-800q0-17 11.5-28.5T560-840h240q17 0 28.5 11.5T840-800v240q0 17-11.5 28.5T800-520q-17 0-28.5-11.5T760-560v-144L256-200h144q17 0 28.5 11.5T440-160q0 17-11.5 28.5T400-120H160Z',
  PAUSE_CIRCLE_FILLED: 'M400-320q17 0 28.5-11.5T440-360v-240q0-17-11.5-28.5T400-640q-17 0-28.5 11.5T360-600v240q0 17 11.5 28.5T400-320Zm160 0q17 0 28.5-11.5T600-360v-240q0-17-11.5-28.5T560-640q-17 0-28.5 11.5T520-600v240q0 17 11.5 28.5T560-320ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z',
  PHOTO_CAMERA_FILLED: 'M480-260q75 0 127.5-52.5T660-440q0-75-52.5-127.5T480-620q-75 0-127.5 52.5T300-440q0 75 52.5 127.5T480-260Zm0-80q-42 0-71-29t-29-71q0-42 29-71t71-29q42 0 71 29t29 71q0 42-29 71t-71 29ZM160-120q-33 0-56.5-23.5T80-200v-480q0-33 23.5-56.5T160-760h126l50-54q11-12 26.5-19t32.5-7h170q17 0 32.5 7t26.5 19l50 54h126q33 0 56.5 23.5T880-680v480q0 33-23.5 56.5T800-120H160Z',
  PLAY_CIRCLE_FILLED: 'm426-330 195-125q14-9 14-25t-14-25L426-630q-15-10-30.5-1.5T380-605v250q0 18 15.5 26.5T426-330Zm54 250q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z',
  SPONSORBLOCK_CANCEL: 'M 284.70508 42.693359 A 479.9 479.9 0 0 0 54.369141 100.41992 A 22.53 22.53 0 0 0 42.669922 120.41992 C 45.069922 290.25992 135.67008 438.63977 270.83008 522.00977 A 22.48 22.48 0 0 0 294.32031 522.00977 C 429.48031 438.63977 520.08047 290.25992 522.48047 120.41992 A 22.53 22.53 0 0 0 510.7793 100.41992 A 479.9 479.9 0 0 0 284.70508 42.693359 z M 193 177 L 227 143 L 282.5 198.5 L 338 143 L 372 177 L 316.5 232.5 L 372 288 L 338 322 L 282.5 266.5 L 227 322 L 193 288 L 248.5 232.5 L 193 177 z',
  SPONSORBLOCK_DELETE: 'M 284.70508 42.693359 A 479.9 479.9 0 0 0 54.369141 100.41992 A 22.53 22.53 0 0 0 42.669922 120.41992 C 45.069922 290.25992 135.67008 438.63977 270.83008 522.00977 A 22.48 22.48 0 0 0 294.32031 522.00977 C 429.48031 438.63977 520.08047 290.25992 522.48047 120.41992 A 22.53 22.53 0 0 0 510.7793 100.41992 A 479.9 479.9 0 0 0 284.70508 42.693359 z M 184.84375 113.77344 L 380.30664 113.77344 L 380.30664 161.31836 L 184.84375 161.31836 L 184.84375 113.77344 z M 184.84375 174.45703 L 380.30469 174.45703 L 380.30469 430.16992 L 184.84375 430.16992 L 184.84375 174.45703 z M 214.16406 207.67773 L 239.57031 207.67773 L 239.57031 396.92383 L 214.16406 396.92383 L 214.16406 207.67773 z M 269.875 207.67773 L 295.28125 207.67773 L 295.28125 396.92383 L 269.875 396.92383 L 269.875 207.67773 z M 322.64844 207.67773 L 348.05469 207.67773 L 348.05469 396.92383 L 322.64844 396.92383 L 322.64844 207.67773 z',
  SPONSORBLOCK_HIGHLIGHT: 'M 284.70508 42.693359 A 479.9 479.9 0 0 0 54.369141 100.41992 A 22.53 22.53 0 0 0 42.669922 120.41992 C 45.069922 290.25992 135.67008 438.63977 270.83008 522.00977 A 22.48 22.48 0 0 0 294.32031 522.00977 C 429.48031 438.63977 520.08047 290.25992 522.48047 120.41992 A 22.53 22.53 0 0 0 510.7793 100.41992 A 479.9 479.9 0 0 0 284.70508 42.693359 z M 185 170 L 225 170 L 305 248 L 225 326 L 185 326 L 265 248 L 185 170 z M 285 170 L 325 170 L 405 248 L 325 326 L 285 326 L 365 248 L 285 170 z',
  SPONSORBLOCK_START: 'M 284.70508 42.693359 A 479.9 479.9 0 0 0 54.369141 100.41992 A 22.53 22.53 0 0 0 42.669922 120.41992 C 45.069922 290.25992 135.67008 438.63977 270.83008 522.00977 A 22.48 22.48 0 0 0 294.32031 522.00977 C 429.48031 438.63977 520.08047 290.25992 522.48047 120.41992 A 22.53 22.53 0 0 0 510.7793 100.41992 A 479.9 479.9 0 0 0 284.70508 42.693359 z M 220.41016 145.74023 L 411.2793 255.93945 L 220.41016 366.14062 L 220.41016 145.74023 z',
  SPONSORBLOCK_STOP: 'M 284.70508 42.693359 A 479.9 479.9 0 0 0 54.369141 100.41992 A 22.53 22.53 0 0 0 42.669922 120.41992 C 45.069922 290.25992 135.67008 438.63977 270.83008 522.00977 A 22.48 22.48 0 0 0 294.32031 522.00977 C 429.48031 438.63977 520.08047 290.25992 522.48047 120.41992 A 22.53 22.53 0 0 0 510.7793 100.41992 A 479.9 479.9 0 0 0 284.70508 42.693359 z M 187.11914 147.00977 L 378.03125 147.00977 L 378.03125 351.04102 L 187.11914 351.04102 L 187.11914 147.00977 z',
  SPONSORBLOCK_UPLOAD: 'M 284.70508 42.693359 A 479.9 479.9 0 0 0 54.369141 100.41992 A 22.53 22.53 0 0 0 42.669922 120.41992 C 45.069922 290.25992 135.67008 438.63977 270.83008 522.00977 A 22.48 22.48 0 0 0 294.32031 522.00977 C 429.48031 438.63977 520.08047 290.25992 522.48047 120.41992 A 22.53 22.53 0 0 0 510.7793 100.41992 A 479.9 479.9 0 0 0 284.70508 42.693359 z M 282.57422 112.11133 L 282.87109 112.11133 L 423.75977 365.75391 L 330.30273 365.75391 L 330.30273 409.21094 L 234.84766 409.21094 L 234.84766 365.75391 L 141.39062 365.75391 L 282.57422 112.11133 z',
  RECORD_VOICE_OVER_FILLED: 'M920-600q0 69-24.5 131.5T829-355q-12 14-30 15t-32-13q-13-13-12-31t12-33q30-38 46.5-85t16.5-98q0-51-16.5-97T767-781q-12-15-12.5-33t12.5-32q13-14 31.5-13.5T829-845q42 51 66.5 113.5T920-600Zm-182 0q0 32-10 61.5T700-484q-11 15-29.5 15.5T638-482q-13-13-13.5-31.5T633-549q6-11 9.5-24t3.5-27q0-14-3.5-27t-9.5-25q-9-17-8.5-35t13.5-31q14-14 32.5-13.5T700-716q18 25 28 54.5t10 61.5ZM360-440q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47ZM40-200v-32q0-33 17-62t47-44q51-26 115-44t141-18q77 0 141 18t115 44q30 15 47 44t17 62v32q0 33-23.5 56.5T600-120H120q-33 0-56.5-23.5T40-200Z',
  TUNE_FILLED: 'M480-120q-17 0-28.5-11.5T440-160v-160q0-17 11.5-28.5T480-360q17 0 28.5 11.5T520-320v40h280q17 0 28.5 11.5T840-240q0 17-11.5 28.5T800-200H520v40q0 17-11.5 28.5T480-120Zm-320-80q-17 0-28.5-11.5T120-240q0-17 11.5-28.5T160-280h160q17 0 28.5 11.5T360-240q0 17-11.5 28.5T320-200H160Zm160-160q-17 0-28.5-11.5T280-400v-40H160q-17 0-28.5-11.5T120-480q0-17 11.5-28.5T160-520h120v-40q0-17 11.5-28.5T320-600q17 0 28.5 11.5T360-560v160q0 17-11.5 28.5T320-360Zm160-80q-17 0-28.5-11.5T440-480q0-17 11.5-28.5T480-520h320q17 0 28.5 11.5T840-480q0 17-11.5 28.5T800-440H480Zm160-160q-17 0-28.5-11.5T600-640v-160q0-17 11.5-28.5T640-840q17 0 28.5 11.5T680-800v40h120q17 0 28.5 11.5T840-720q0 17-11.5 28.5T800-680H680v40q0 17-11.5 28.5T640-600Zm-480-80q-17 0-28.5-11.5T120-720q0-17 11.5-28.5T160-760h320q17 0 28.5 11.5T520-720q0 17-11.5 28.5T480-680H160Z',
  RECTANGLE_DEFAULT: 'M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm0-80h640v-480H160v480Zm0 0v-480 480Z',
  SKIP_NEXT_FILLED: 'M660-280v-400q0-17 11.5-28.5T700-720q17 0 28.5 11.5T740-680v400q0 17-11.5 28.5T700-240q-17 0-28.5-11.5T660-280Zm-440-35v-330q0-18 12-29t28-11q5 0 11 1t11 5l248 166q9 6 13.5 14.5T548-480q0 10-4.5 18.5T530-447L282-281q-5 4-11 5t-11 1q-16 0-28-11t-12-29Z',
  SKIP_PREVIOUS_FILLED: 'M220-280v-400q0-17 11.5-28.5T260-720q17 0 28.5 11.5T300-680v400q0 17-11.5 28.5T260-240q-17 0-28.5-11.5T220-280Zm458-1L430-447q-9-6-13.5-14.5T412-480q0-10 4.5-18.5T430-513l248-166q5-4 11-5t11-1q16 0 28 11t12 29v330q0 18-12 29t-28 11q-5 0-11-1t-11-5Z',
  TIMER_FILLED: 'M360-840v-80h240v80H360Zm80 440h80v-240h-80v240Zm40 320q-74 0-139.5-28.5T226-186q-49-49-77.5-114.5T120-440q0-74 28.5-139.5T226-694q49-49 114.5-77.5T480-800q62 0 119 20t107 58l56-56 56 56-56 56q38 50 58 107t20 119q0 74-28.5 139.5T734-186q-49 49-114.5 77.5T480-80Zm0-80q116 0 198-82t82-198q0-116-82-198t-198-82q-116 0-198 82t-82 198q0 116 82 198t198 82Zm0-280Z',
  ZOOM_IN_ROUNDED: 'M8.5 10.5h-1q-.425 0-.712-.288T6.5 9.5t.288-.712T7.5 8.5h1v-1q0-.425.288-.712T9.5 6.5t.713.288t.287.712v1h1q.425 0 .713.288t.287.712t-.288.713t-.712.287h-1v1q0 .425-.288.713T9.5 12.5t-.712-.288T8.5 11.5zm1 5.5q-2.725 0-4.612-1.888T3 9.5t1.888-4.612T9.5 3t4.613 1.888T16 9.5q0 1.1-.35 2.075T14.7 13.3l5.6 5.6q.275.275.275.7t-.275.7t-.7.275t-.7-.275l-5.6-5.6q-.75.6-1.725.95T9.5 16m0-2q1.875 0 3.188-1.312T14 9.5t-1.312-3.187T9.5 5T6.313 6.313T5 9.5t1.313 3.188T9.5 14',
}

/**
 * ViewBox for `PlayerIcons.SPONSORBLOCK_*` paths. Shaka's `ui.Icon` uses Material's
 * `0 -960 960 960` when given a plain path string, which does not fit these paths (~0–565).
 */
const SPONSORBLOCK_ICON_VIEWBOX = '0 0 565 565'

/**
 * ViewBox for `PlayerIcons.ZOOM_IN_ROUNDED`, which comes from Material Symbols'
 * 24x24 set instead of the icon-font geometry the other paths use.
 */
const ZOOM_IN_ICON_VIEWBOX = '0 0 24 24'

const UnsupportedPlayerActions = /** @type {const} */({
  STARTING_VIDEO_AT_OFFSET: 1,
  PLAYBACK_RATE: 2,
  OPENING_PLAYLISTS: 3,
  PLAYLIST_SPECIFIC_VIDEO: 4,
  PLAYLIST_REVERSE: 5,
  PLAYLIST_SHUFFLE: 6,
  PLAYLIST_LOOP: 7,
})

/**
 * @typedef {UnsupportedPlayerActions[(keyof typeof UnsupportedPlayerActions)]} UnsupportedPlayerAction
 */

// Utils
const MAIN_PROFILE_ID = 'allChannels'
const DEFAULT_LANDING_PAGE = 'home'
const LEGACY_DEFAULT_LANDING_PAGE = 'subscriptions'

function resolveLandingPage(landingPage, availablePages = null) {
  if (typeof availablePages === 'boolean') {
    return availablePages && landingPage === DEFAULT_LANDING_PAGE
      ? LEGACY_DEFAULT_LANDING_PAGE
      : landingPage
  }

  if (!Array.isArray(availablePages) || availablePages.includes(landingPage)) {
    return landingPage
  }

  return availablePages[0] ?? LEGACY_DEFAULT_LANDING_PAGE
}

// Profile colors that follow the selected theme color instead of a fixed value
const THEME_BG_COLOR = 'var(--primary-color)'
const THEME_TEXT_COLOR = 'var(--text-with-main-color)'

// Width threshold in px at which we switch to using a more heavily altered view for mobile users
const MOBILE_WIDTH_THRESHOLD = 680

// Height threshold in px at which we switch to using a more heavily altered playlist view for mobile users
const PLAYLIST_HEIGHT_FORCE_LIST_THRESHOLD = 500

// Acting on this many tabs at once (or more) asks for a confirmation first
const MULTIPLE_TABS_CONFIRM_THRESHOLD = 5

// YouTube search character limit is 100 characters
const SEARCH_CHAR_LIMIT = 100

// max # of results we show for search suggestions
const SEARCH_RESULTS_DISPLAY_LIMIT = 14

// max # of search history results we show when mixed with YT search suggestions
const MIXED_SEARCH_HISTORY_ENTRIES_DISPLAY_LIMIT = 4

/**
 * Outcome of adding a single video to a playlist. A write that affected nothing
 * is ambiguous on its own: the video may already be there, or the playlist may
 * have been deleted (possibly by another window), which callers must not report
 * as a successful save.
 */
const PlaylistVideoAddResult = {
  ADDED: 'added',
  ALREADY_PRESENT: 'already-present',
  PLAYLIST_MISSING: 'playlist-missing',
}

// Percentage of a video's duration that must be played before it is considered watched
const DEFAULT_WATCHED_PERCENTAGE_THRESHOLD = 90
const WATCHED_MAX_REMAINING_SECONDS = 120
const DEFAULT_QUICK_PLAYBACK_SPEED_BAR_OPTIONS = Object.freeze([
  { speed: 0.5, name: '' },
  { speed: 1, name: '' },
  { speed: 1.25, name: '' },
  { speed: 1.5, name: '' },
  { speed: 1.75, name: '' },
  { speed: 2, name: '' },
  { speed: 2.25, name: '' },
  { speed: 2.5, name: '' },
  { speed: 3, name: '' },
])

const LIGHT_BASE_THEMES = [
  'light',
  'openTubeXLight',
  'pastelPink',
  'catppuccinLatte',
  'everforestLightHard',
  'everforestLightMedium',
  'everforestLightLow',
  'gruvboxLight',
  'solarizedLight',
]

const DARK_BASE_THEMES = [
  'dark',
  'openTubeXDark',
  'black',
  'nordic',
  'hotPink',
  'catppuccinFrappe',
  'catppuccinMocha',
  'dracula',
  'everforestDarkHard',
  'everforestDarkMedium',
  'everforestDarkLow',
  'gruvboxDark',
  'solarizedDark',
]

export {
  IpcChannels,
  DBActions,
  SyncEvents,
  PlaylistVideoAddResult,
  DefaultKeyboardShortcuts,
  KeyboardShortcuts,
  applyKeyboardShortcutOverrides,
  getConfiguredKeyboardShortcuts,
  getElectronAccelerator,
  isKeyboardShortcutEditable,
  isKeyboardShortcutRange,
  sanitizeKeyboardShortcutOverrides,
  PlayerIcons,
  SPONSORBLOCK_ICON_VIEWBOX,
  ZOOM_IN_ICON_VIEWBOX,
  UnsupportedPlayerActions,
  MAIN_PROFILE_ID,
  DEFAULT_LANDING_PAGE,
  LEGACY_DEFAULT_LANDING_PAGE,
  resolveLandingPage,
  THEME_BG_COLOR,
  THEME_TEXT_COLOR,
  MOBILE_WIDTH_THRESHOLD,
  PLAYLIST_HEIGHT_FORCE_LIST_THRESHOLD,
  MULTIPLE_TABS_CONFIRM_THRESHOLD,
  SEARCH_CHAR_LIMIT,
  SEARCH_RESULTS_DISPLAY_LIMIT,
  MIXED_SEARCH_HISTORY_ENTRIES_DISPLAY_LIMIT,
  DEFAULT_QUICK_PLAYBACK_SPEED_BAR_OPTIONS,
  DEFAULT_WATCHED_PERCENTAGE_THRESHOLD,
  WATCHED_MAX_REMAINING_SECONDS,
  LIGHT_BASE_THEMES,
  DARK_BASE_THEMES,
  DOWNLOADED_MEDIA_MIME_TYPES,
}
