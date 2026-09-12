import { BrowserWindow, ipcMain, app, nativeImage, shell } from 'electron'
import { randomUUID } from 'crypto'
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { normalizeTabGroupIcon } from '../../tabGroupIcons.js'
import {
  DEFAULT_LANDING_PAGE,
  IpcChannels,
  LEGACY_DEFAULT_LANDING_PAGE,
  resolveLandingPage,
} from '../../constants.js'
import {
  navigationItemsFromLegacySettings,
  normalizeNavigationItems,
} from '../../navigationItems.js'
import { filterAvailableNavigationItems } from '../../navigationAvailability.js'
import * as baseHandlers from '../../datastores/handlers/base.js'
import { getFixedInternalRouteTitle } from '../../internalRoutes.js'
import {
  clearTabSession,
  replaceAllTabSessions,
  saveTabSession
} from './TabSessionStore.js'
import { TabRendererBridge } from './TabRendererBridge.js'
import {
  buildReorderedTabMap,
  getGroupedTabInsertIndex,
  resetTabPlacementOpeners,
  restoreTabPlacementOpeners
} from './tabOrder.js'
import {
  createTabAvatarFileName,
  createTabPreviewFileName,
  createTabPreviewTempFileName,
  isReusableTabPreviewFileName,
  isTabPreviewDataUrl,
  normalizeTabPreviewFileName,
  selectOrphanedTabPreviews,
  TAB_PREVIEW_JPEG_QUALITY,
  tabPreviewBufferToDataUrl
} from './tabPreviewCache.js'
import { isTabActivatable } from './tabAvailability.js'
import {
  cropTabPreviewToContent,
  getTabPreviewTargetSize,
  measureTabPreviewContentBounds
} from './tabPreviewGeometry.js'
import { isOpenTubeXUrl } from '../utils.js'

/** @type {Map<number, TabManager>} windowId -> TabManager */
const tabManagers = new Map()

const DEFAULT_NEW_TAB_POSITION = 'afterCurrentInOrder'
const VALID_NEW_TAB_POSITIONS = new Set(['end', 'afterCurrent', 'afterCurrentInOrder'])
const DEFAULT_TAB_CLOSE_FOCUS = 'previousTab'
const VALID_TAB_CLOSE_FOCUS = new Set(['previousTab', 'nextTab'])
// Closing a tab has to pick the replacement synchronously, so the preference is
// cached here instead of being read from the settings store on every close.
let tabCloseFocus = DEFAULT_TAB_CLOSE_FOCUS
// Tab creation is also synchronous after its placement preferences have loaded.
// Cache whether silence skipping should start enabled for newly-created tabs.
let enableSkipSilenceByDefault = false
let showSkipSilenceButton = false
const VALID_TAB_COLORS = new Set(['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'])
const MAX_TAB_GROUP_NAME_LENGTH = 80
const TAB_PREVIEW_REFRESH_DELAY_MS = 700
const TAB_PREVIEW_CAPTURE_STYLE_ID = 'opentubex-tab-preview-capture-style'
const TAB_PREVIEW_CAPTURE_CLASS = 'opentubex-tab-preview-capturing'
const TAB_PREVIEW_CACHE_DIR_NAME = 'tab-previews'
const TAB_TRANSFER_MOUNT_TIMEOUT_MS = 8000
const STARTUP_TAB_MOUNT_DELAY_MS = 50
const RAPID_TAB_CREATION_BATCH_DELAY_MS = 40
const RAPID_TAB_CREATION_BATCH_MAX_DELAY_MS = 100
const transferringTabIds = new Set()
const TAB_LOADING_SOURCE_MOUNT = 'mount'
const TAB_LOADING_SOURCE_RENDERER = 'renderer'
const MAX_PERSISTED_NAV_HISTORY_ENTRIES = 25
const MAX_TAB_AVATAR_DOWNLOAD_BYTES = 2 * 1024 * 1024
const TAB_AVATAR_SIZE = 64
/** Prevent newly cached previews or avatars from racing startup pruning. */
let tabPreviewCacheMaintenance = Promise.resolve()

/**
 * @typedef {'unloaded' | 'mounting' | 'loaded' | 'unloading'} TabLoadState
 */

/**
 * @typedef {object} TabInfo
 * @property {string} id
 * @property {string} url
 * @property {{name?: string | null, path: string, params: Record<string, string>, query: Record<string, string>, hash: string, fullPath: string}} route
 * @property {string} title
 * @property {string | null} avatarDataUrl
 * @property {string | null} avatarFileName
 * @property {number} lastActiveAt
 * @property {boolean} isPlaying
 * @property {boolean} isPinned
 * @property {boolean} isLoading
 * @property {boolean} mountDeferred
 * @property {Set<string>} loadingSources
 * @property {string | null} color
 * @property {string | null} previewDataUrl
 * @property {number} previewCapturedAt
 * @property {string | null} previewFileName
 * @property {ReturnType<typeof setTimeout> | null} previewCaptureTimeoutId
 * @property {Promise<string | null> | null} previewCapturePromise
 * @property {boolean} skipSilence
 * @property {TabLoadState} loadState
 * @property {boolean} preloadInBackground
 * @property {number} mountRevision
 * @property {number} refreshKey
 * @property {number} syncedNavigationRevision
 * @property {string | null} placementOpenerTabId
 * @property {NavigationHistoryEntry[] | null} navigationHistory
 * @property {number} navigationHistoryIndex
 * @property {boolean} persistNavigationHistory
 * @property {string | null} groupId
 */

/**
 * @typedef {object} NavigationHistoryEntry
 * @property {ReturnType<typeof normalizeRoute>} route
 * @property {string} title
 * @property {boolean} titlePending
 * @property {{left: number, top: number}} scroll
 */

export class TabManager {
  /**
   * @param {unknown} value
   * @returns {'end' | 'afterCurrent' | 'afterCurrentInOrder'}
   */
  static normalizeNewTabPosition(value) {
    return VALID_NEW_TAB_POSITIONS.has(value)
      ? value
      : DEFAULT_NEW_TAB_POSITION
  }

  /**
   * @param {unknown} value
   * @returns {'previousTab' | 'nextTab'}
   */
  static normalizeTabCloseFocus(value) {
    return VALID_TAB_CLOSE_FOCUS.has(value)
      ? value
      : DEFAULT_TAB_CLOSE_FOCUS
  }

  /**
   * @param {unknown} value
   */
  static setTabCloseFocus(value) {
    tabCloseFocus = TabManager.normalizeTabCloseFocus(value)
  }

  /**
   * @returns {Promise<void>}
   */
  static async refreshStoredTabCloseFocus() {
    try {
      TabManager.setTabCloseFocus((await baseHandlers.settings._findOne('tabCloseFocus'))?.value)
    } catch (error) {
      console.error('Failed to load tab close focus preference:', error)
    }
  }

  /**
   * @param {unknown} value
   */
  static setEnableSkipSilenceByDefault(value) {
    enableSkipSilenceByDefault = value === true
  }

  /**
   * @param {unknown} value
   */
  static setShowSkipSilenceButton(value) {
    showSkipSilenceButton = value === true
  }

  /**
   * @returns {Promise<void>}
   */
  static async refreshStoredSkipSilenceSettings() {
    try {
      const [showButtonSetting, defaultSetting] = await Promise.all([
        baseHandlers.settings._findOne('showSkipSilenceButton'),
        baseHandlers.settings._findOne('enableSkipSilenceByDefault')
      ])
      TabManager.setShowSkipSilenceButton(showButtonSetting?.value)
      TabManager.setEnableSkipSilenceByDefault(defaultSetting?.value)
    } catch (error) {
      console.error('Failed to load skip silence preferences:', error)
    }
  }

  /**
   * @param {unknown} value
   * @returns {string | null}
   */
  static normalizeTabColor(value) {
    return VALID_TAB_COLORS.has(value) ? value : null
  }

  /**
   * @param {unknown} value
   * @returns {string}
   */
  static normalizeTabGroupName(value) {
    return typeof value === 'string'
      ? value.trim().slice(0, MAX_TAB_GROUP_NAME_LENGTH)
      : ''
  }

  /**
   * @returns {string}
   */
  static getTabPreviewCacheDirectory() {
    return join(app.getPath('userData'), TAB_PREVIEW_CACHE_DIR_NAME)
  }

  /**
   * Starts orphan cleanup without holding window creation. Preview and avatar
   * persistence wait for this maintenance promise, so a newly written file
   * cannot be mistaken for an orphan while the directory scan is in flight.
   * @param {Iterable<string | null | undefined>} referencedFileNames
   * @returns {Promise<number>}
   */
  static startTabPreviewCachePrune(referencedFileNames) {
    const prune = TabManager.pruneTabPreviewCache(referencedFileNames).catch(error => {
      console.error('Failed to prune the tab preview cache:', error)
      return 0
    })
    tabPreviewCacheMaintenance = prune.then(() => undefined)
    return prune
  }

  /**
   * Deletes cached previews and avatars that no restored session refers to.
   * Tabs delete their own files when they close, but a crash or a forced quit
   * can leave a file behind with nothing left to point at it.
   *
   * Use `startTabPreviewCachePrune` during startup so captures are held until
   * this scan completes.
   * @param {Iterable<string | null | undefined>} referencedFileNames
   * @returns {Promise<number>} how many files were deleted
   */
  static async pruneTabPreviewCache(referencedFileNames) {
    const cacheDirectory = TabManager.getTabPreviewCacheDirectory()
    /** @type {string[]} */
    let fileNames
    try {
      fileNames = await readdir(cacheDirectory)
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.error('Failed to read the tab preview cache:', error)
      }
      return 0
    }

    const orphans = selectOrphanedTabPreviews(fileNames, referencedFileNames)
    const results = await Promise.all(orphans.map(async fileName => {
      try {
        await unlink(join(cacheDirectory, fileName))
        return true
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          console.error('Failed to delete an orphaned tab preview:', error)
        }
        return false
      }
    }))
    return results.filter(Boolean).length
  }

  /**
   * Clears persisted tab thumbnails and channel avatars without leaving live
   * tabs pointing at files that no longer exist. Enabled caches resume after
   * cleanup and refill as tabs are used.
   * @returns {Promise<void>}
   */
  static async clearTabPreviewCache() {
    const states = Array.from(tabManagers.values(), manager => ({
      manager,
      previewsEnabled: manager._tabPreviewsEnabled,
      avatarsEnabled: manager._avatarsEnabled
    }))

    try {
      await Promise.all(states.map(async ({ manager, previewsEnabled, avatarsEnabled }) => {
        if (previewsEnabled) await manager.setTabPreviewsEnabled(false)
        if (avatarsEnabled) await manager.setTabAvatarsEnabled(false)
      }))

      await TabManager.pruneTabPreviewCache([])
    } finally {
      await Promise.all(states.map(async ({ manager, previewsEnabled, avatarsEnabled }) => {
        if (previewsEnabled) await manager.setTabPreviewsEnabled(true)
        if (avatarsEnabled) await manager.setTabAvatarsEnabled(true)
      }))
    }
  }

  /**
   * @returns {Promise<'end' | 'afterCurrent' | 'afterCurrentInOrder'>}
   */
  static async getStoredNewTabPosition() {
    try {
      const value = (await baseHandlers.settings._findOne('newTabPosition'))?.value
      return TabManager.normalizeNewTabPosition(value)
    } catch (error) {
      console.error('Failed to load new tab position preference:', error)
      return DEFAULT_NEW_TAB_POSITION
    }
  }

  /**
   * @returns {Promise<string>}
   */
  static async getStoredLandingRoute() {
    try {
      const [
        landingPageSetting,
        navigationItemsSetting,
        hideHomeSetting,
        hidePlaylistsSetting,
        hidePopularVideosSetting,
        hideTrendingVideosSetting,
        backendPreferenceSetting,
        backendFallbackSetting,
        rememberHistorySetting,
        enableWatchStatsSetting,
      ] = await Promise.all([
        baseHandlers.settings._findOne('landingPage'),
        baseHandlers.settings._findOne('navigationItems'),
        baseHandlers.settings._findOne('hideHome'),
        baseHandlers.settings._findOne('hidePlaylists'),
        baseHandlers.settings._findOne('hidePopularVideos'),
        baseHandlers.settings._findOne('hideTrendingVideos'),
        baseHandlers.settings._findOne('backendPreference'),
        baseHandlers.settings._findOne('backendFallback'),
        baseHandlers.settings._findOne('rememberHistory'),
        baseHandlers.settings._findOne('enableWatchStats'),
      ])

      let landingPage = landingPageSetting?.value
      if (typeof landingPage !== 'string' || landingPage.length === 0) {
        const [settings, profiles] = await Promise.all([
          baseHandlers.settings.find(),
          baseHandlers.profiles.find(),
        ])
        landingPage = settings.length > 0 || profiles.length > 0
          ? LEGACY_DEFAULT_LANDING_PAGE
          : DEFAULT_LANDING_PAGE
      }

      const configuredPages = navigationItemsSetting == null
        ? navigationItemsFromLegacySettings({
            hideHome: hideHomeSetting?.value,
            hidePlaylists: hidePlaylistsSetting?.value,
            hidePopularVideos: hidePopularVideosSetting?.value,
            hideTrendingVideos: hideTrendingVideosSetting?.value,
          })
        : normalizeNavigationItems(navigationItemsSetting.value)
      const supportsLocalApi = !!process.env.SUPPORTS_LOCAL_API
      const availablePages = filterAvailableNavigationItems(configuredPages, {
        supportsLocalApi,
        backendPreference: backendPreferenceSetting?.value ?? (supportsLocalApi ? 'local' : 'invidious'),
        backendFallback: backendFallbackSetting?.value === true,
        showWatchStats: (rememberHistorySetting?.value ?? true) &&
          (enableWatchStatsSetting?.value ?? true),
      })

      return normalizeRoutePath(resolveLandingPage(landingPage, availablePages))
    } catch (error) {
      console.error('Failed to load landing page preference:', error)
      return `/${LEGACY_DEFAULT_LANDING_PAGE}`
    }
  }

  /**
   * @returns {Promise<boolean>}
   */
  static async getStoredRememberTabNavigationHistory() {
    try {
      return (await baseHandlers.settings._findOne('rememberTabNavigationHistory'))?.value === true
    } catch (error) {
      console.error('Failed to load tab navigation history preference:', error)
      return false
    }
  }

  /**
   * Validate and normalize a renderer-provided or persisted back/forward
   * history so only well-formed entries reach the session store and state
   * broadcasts. Returns null when there is nothing usable to keep.
   * @param {unknown} history
   * @param {unknown} historyIndex
   * @returns {{history: NavigationHistoryEntry[], historyIndex: number} | null}
   */
  static sanitizeNavigationHistory(history, historyIndex) {
    if (!Array.isArray(history) || history.length === 0) {
      return null
    }

    const entries = history
      .filter(entry => typeof entry?.route?.path === 'string')
      .map(entry => {
        const route = normalizeRoute(entry.route)
        // `oneTimeTimestamp` must not survive persistence (see stripOneTimeTimestampFromUrl)
        if ('oneTimeTimestamp' in route.query) {
          delete route.query.oneTimeTimestamp
        }
        return {
          route: normalizeRoute(route),
          title: typeof entry.title === 'string' ? entry.title : route.fullPath,
          titlePending: entry.titlePending === true,
          scroll: {
            left: Number.isFinite(entry.scroll?.left) ? entry.scroll.left : 0,
            top: Number.isFinite(entry.scroll?.top) ? entry.scroll.top : 0
          }
        }
      })

    if (entries.length === 0) {
      return null
    }

    const removedCount = entries.length - Math.min(entries.length, MAX_PERSISTED_NAV_HISTORY_ENTRIES)
    const cappedEntries = entries.slice(-MAX_PERSISTED_NAV_HISTORY_ENTRIES)
    const index = Number.isInteger(historyIndex) ? historyIndex - removedCount : cappedEntries.length - 1

    return {
      history: cappedEntries,
      historyIndex: Math.max(0, Math.min(index, cappedEntries.length - 1))
    }
  }

  /**
   * @param {string} url
   * @returns {string}
   */
  static formatDefaultTabTitle(url) {
    const route = TabManager.getRouteFromUrl(url)
    return getFixedInternalRouteTitle(route.path) ?? route.fullPath
  }

  /**
   * @param {string} url
   * @returns {string}
   */
  static getOpenTubeXRoute(url) {
    return TabManager.getRouteFromUrl(url).fullPath
  }

  /**
   * @param {string} url
   * @returns {{name: null, path: string, params: Record<string, string>, query: Record<string, string>, hash: string, fullPath: string}}
   */
  static getRouteFromUrl(url) {
    try {
      const parsed = new URL(url)
      const rawHash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash
      const hashUrl = new URL(rawHash || '/', 'https://opentubex.invalid')
      return normalizeRoute({
        path: hashUrl.pathname,
        query: searchParamsToQuery(hashUrl.searchParams),
        hash: hashUrl.hash
      })
    } catch {
      return normalizeRoute({ path: '/' })
    }
  }

  /**
   * `oneTimeTimestamp` is only meant to be consumed once by the Watch view
   * (e.g. after a SABR player reload). If it survives into a persisted tab
   * session, restoring the tab jumps to the stale reload position instead of
   * the newer watch progress saved in the history database.
   * @param {string} url
   * @returns {string}
   */
  static stripOneTimeTimestampFromUrl(url) {
    if (typeof url !== 'string' || !url.includes('oneTimeTimestamp=')) {
      return url
    }

    const hashIndex = url.indexOf('#')
    if (hashIndex === -1) {
      return url
    }

    const route = TabManager.getRouteFromUrl(url)
    if (!('oneTimeTimestamp' in route.query)) {
      return url
    }

    delete route.query.oneTimeTimestamp
    return url.slice(0, hashIndex + 1) + normalizeRoute(route).fullPath
  }

  /**
   * @param {string} url
   * @returns {string | null}
   */
  static getVideoIdFromUrl(url) {
    const parsed = URL.parse(url)
    if (parsed == null) {
      return null
    }

    const route = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash
    const appVideoId = route.match(/^\/watch\/(?<videoId>[^/?#]+)/)?.groups?.videoId
    if (TabManager.isValidVideoId(appVideoId)) {
      return appVideoId
    }

    const directVideoId = parsed.searchParams.get('v')
    if (TabManager.isValidVideoId(directVideoId)) {
      return directVideoId
    }

    const pathVideoId = parsed.pathname.match(/^\/(?:shorts|embed|live)\/(?<videoId>[^/?#]+)/)?.groups?.videoId
    if (TabManager.isValidVideoId(pathVideoId)) {
      return pathVideoId
    }

    if (parsed.hostname === 'youtu.be') {
      const shortUrlVideoId = parsed.pathname.match(/^\/(?<videoId>[^/?#]+)/)?.groups?.videoId
      if (TabManager.isValidVideoId(shortUrlVideoId)) {
        return shortUrlVideoId
      }
    }

    return null
  }

  /**
   * @param {unknown} value
   * @returns {boolean}
   */
  static isValidVideoId(value) {
    return typeof value === 'string' && /^[\w-]{11}$/.test(value)
  }

  /**
   * @param {string} url
   * @returns {string | null}
   */
  static getVideoThumbnailUrl(url) {
    const videoId = TabManager.getVideoIdFromUrl(url)
    return videoId == null ? null : `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
  }

  /**
   * @param {string} title
   * @returns {boolean}
   */
  static isGenericTitle(title) {
    if (typeof title !== 'string') {
      return true
    }

    const trimmed = title.trim()
    return trimmed.length === 0 || trimmed === app.getName()
  }

  /**
   * @param {string | undefined} currentTitle
   * @param {string} newTitle
   * @returns {string}
   */
  static resolveTabTitle(currentTitle, newTitle) {
    if (typeof newTitle !== 'string') {
      return currentTitle ?? ''
    }

    if (
      TabManager.isGenericTitle(newTitle) &&
      currentTitle &&
      !TabManager.isGenericTitle(currentTitle)
    ) {
      return currentTitle
    }

    return newTitle
  }

  /**
   * @param {number} windowId
   * @returns {TabManager|undefined}
   */
  static getForWindow(windowId) {
    return tabManagers.get(windowId)
  }

  /**
   * Resolve the manager from the BrowserWindow's one shared renderer.
   * @param {import('electron').WebContents} webContents
   * @returns {TabManager|undefined}
   */
  static getFromWebContents(webContents) {
    const browserWindow = BrowserWindow.fromWebContents(webContents)
    return browserWindow ? tabManagers.get(browserWindow.id) : undefined
  }

  /**
   * @param {string} tabId
   * @returns {TabManager|undefined}
   */
  static getManagerForTabId(tabId) {
    for (const manager of tabManagers.values()) {
      if (manager.tabs.has(tabId)) {
        return manager
      }
    }
    return undefined
  }

  /**
   * @returns {Set<string>} video IDs referenced by tabs in any window
   */
  static getOpenVideoIds() {
    const videoIds = new Set()
    for (const manager of tabManagers.values()) {
      for (const tab of manager.tabs.values()) {
        const videoId = TabManager.getVideoIdFromUrl(tab.url)
        if (videoId !== null) {
          videoIds.add(videoId)
        }
      }
    }
    return videoIds
  }

  /**
   * @param {number} excludeWindowId
   * @returns {Array<{ windowId: number, label: string }>}
   */
  static listMoveTargets(excludeWindowId) {
    const candidates = Array.from(tabManagers.values())
      .filter(manager => !manager.browserWindow.isDestroyed() && manager.browserWindow.id !== excludeWindowId)
      .sort((a, b) => a.browserWindow.id - b.browserWindow.id)

    const baseTitle = (manager) => manager.browserWindow.getTitle().trim() || app.getName()
    const counts = new Map()
    for (const manager of candidates) {
      const title = baseTitle(manager)
      counts.set(title, (counts.get(title) || 0) + 1)
    }

    const indexByTitle = new Map()
    return candidates.map(manager => {
      const title = baseTitle(manager)
      let label = title
      if ((counts.get(title) ?? 1) > 1) {
        const index = (indexByTitle.get(title) || 0) + 1
        indexByTitle.set(title, index)
        label = `${title} (${index})`
      }
      return { windowId: manager.browserWindow.id, label }
    })
  }

  /**
   * @param {string} tabId
   * @param {number} targetWindowId
   */
  static async moveTabToWindow(tabId, targetWindowId) {
    if (transferringTabIds.has(tabId)) {
      return false
    }

    const source = TabManager.getManagerForTabId(tabId)
    const target = TabManager.getForWindow(targetWindowId)
    if (!source || !target || source.browserWindow.id === targetWindowId) {
      return false
    }
    if (source.browserWindow.isDestroyed() || target.browserWindow.isDestroyed()) {
      return false
    }

    transferringTabIds.add(tabId)
    try {
      const snapshot = source.createTransferSnapshot(tabId)
      if (!snapshot) {
        return false
      }

      const stagedTab = target.adoptTransferredTab(snapshot)
      const mounted = await target.waitForTabMount(
        stagedTab.id,
        stagedTab.mountRevision,
        TAB_TRANSFER_MOUNT_TIMEOUT_MS
      )

      if (
        !mounted ||
        source.browserWindow.isDestroyed() ||
        target.browserWindow.isDestroyed() ||
        !source.tabs.has(tabId)
      ) {
        target.removeStagedTransferredTab(tabId)
        return false
      }

      const detached = source.detachTabForTransfer(tabId)
      if (!detached) {
        target.removeStagedTransferredTab(tabId)
        return false
      }

      // The destination mounted from the snapshot taken before the mount wait.
      // The source tab may have resolved a real title or refreshed its preview in
      // the meantime, so reconcile the order-independent metadata from the latest
      // source state before activating. (url/route stay as mounted; isPinned is
      // fixed by insertion order and must not change here.)
      stagedTab.title = detached.title
      stagedTab.avatarDataUrl = detached.avatarDataUrl
      stagedTab.avatarFileName = detached.avatarFileName
      stagedTab.color = detached.color
      stagedTab.previewDataUrl = detached.previewDataUrl
      stagedTab.previewCapturedAt = detached.previewCapturedAt
      stagedTab.previewFileName = detached.previewFileName
      stagedTab.skipSilence = detached.skipSilence === true

      stagedTab.isTransferStaged = false
      target.activateTab(tabId)
      target.browserWindow.focus()
      if (source.tabs.size === 0) {
        source.browserWindow.close()
      }
      return true
    } catch (error) {
      console.error('Failed to move tab to another window:', error)
      target.removeStagedTransferredTab(tabId)
      return false
    } finally {
      transferringTabIds.delete(tabId)
    }
  }

  /**
   * @param {import('electron').BrowserWindow} browserWindow
   * @param {string} rootAppUrl
   * @param {string} _preloadPath
   * @param {string} [sessionId]
   * @param {(title: string) => void} [setWindowTitle]
   */
  constructor(browserWindow, rootAppUrl, _preloadPath, sessionId, setWindowTitle) {
    this.browserWindow = browserWindow
    this._setWindowTitle = setWindowTitle ?? (title => browserWindow.setTitle(title))
    this.rootAppUrl = rootAppUrl
    this.sessionId = sessionId || randomUUID()
    /** @type {Map<string, TabInfo>} */
    this.tabs = new Map()
    /** @type {string|null} */
    this.activeTabId = null
    /** @type {string|null} */
    this.presentedTabId = null
    this.selectionRevision = 0
    /** @type {Array<{ id: string, url: string, title?: string, isPinned?: boolean, color?: string | null, groupId?: string | null, history?: object[] | null, historyIndex?: number, tabIndex: number }>} */
    this.closedTabs = []
    /** @type {Map<string, {id: string, name: string, color: string | null, icon: string, isCollapsed: boolean}>} */
    this.tabGroups = new Map()
    this.tabBarScrollPosition = 0
    this.contextMenuTabId = null
    /** @type {string[]} */
    this.contextMenuSelectedTabIds = []
    /** @type {string[]} */
    this.selectedTabIds = []
    this.lastReorderRequestId = null
    this.contextMenuSurface = 'content'
    this.contextMenuSubscriptionFeedTab = null
    this.contextMenuSubscriptionNewFeedTab = false
    this.contextMenuSubscriptionNewFeedHasContent = false
    this.contextMenuTabBarVertical = false
    this._sessionPersistenceDisabled = false
    this.sessionUpdatedAt = 0
    this._pendingTabMountWaiters = new Map()
    this._deferredCloseTabIds = new Set()
    this._deferredUnloadTabIds = new Set()
    // Loading every restored watch page at once makes them compete with the
    // selected video's metadata and stream requests. Keep those background
    // mounts queued until the selected watch page has finished its initial load.
    this._deferredStartupWatchTabIds = new Set()
    this._startupPriorityTabId = null
    this._startupPriorityLoadingObserved = false
    this._startupMountQueue = new Set()
    this._startupMountTimer = null
    this._startupMountRunning = false
    // While a batch runs, state broadcasts and session writes are collapsed into
    // a single one that is emitted once the batch finishes (see runBatched).
    this._batchDepth = 0
    this._batchedBroadcastPending = false
    this._batchedSessionSavePending = false
    this._rapidTabCreationBatch = null
    // Serializes preview captures across every tab in this window. Captures share
    // the window's single renderer, so running two at once would screenshot each
    // other's content and toggle capture mode out from under one another.
    /** @type {Promise<void>} */
    this._previewCaptureLock = Promise.resolve()
    this._previewCapturePaused = false
    this._tabPreviewsEnabled = true
    this._tabPreviewTransitionId = 0
    this._avatarsEnabled = true
    /** Tabs whose navigation history the renderer has already been sent. */
    this._historyAnnouncedTabIds = new Set()
    this.bridge = new TabRendererBridge(browserWindow)
    this._initialPresentationResolved = false
    this._initialPresentationPromise = new Promise(resolve => {
      this._resolveInitialPresentation = resolve
    })

    tabManagers.set(browserWindow.id, this)
    this._installWindowOpenHandler()

    browserWindow.on('closed', () => {
      clearTimeout(this._startupMountTimer)
      this._startupMountQueue.clear()
      if (this._rapidTabCreationBatch) {
        clearTimeout(this._rapidTabCreationBatch.timeoutId)
        this._rapidTabCreationBatch.resolve()
        this._rapidTabCreationBatch = null
      }
      tabManagers.delete(browserWindow.id)
      // Preview refreshes can self-reschedule (see _scheduleTabPreviewRefresh), so
      // any still-pending capture timer would keep firing and pin this manager
      // alive after the window is gone. Clear them all before releasing it.
      for (const tab of this.tabs.values()) {
        this._clearTabPreviewRefresh(tab)
      }
      for (const waiters of this._pendingTabMountWaiters.values()) {
        for (const waiter of waiters) {
          clearTimeout(waiter.timeoutId)
          waiter.resolve(false)
        }
      }
      this._pendingTabMountWaiters.clear()
    })
  }

  _installWindowOpenHandler() {
    this.browserWindow.webContents.setWindowOpenHandler((details) => {
      const parsedUrl = URL.parse(details.url)
      const currentUrl = this.browserWindow.webContents.getURL()

      if (parsedUrl !== null && isOpenTubeXUrl(currentUrl)) {
        if (isOpenTubeXUrl(parsedUrl)) {
          this.createTabWithPreferenceFromOpener({
            url: details.url,
            makeActive: true
          }, this.presentedTabId ?? this.activeTabId).catch(error => {
            console.error('Failed to open window.open URL in a new tab:', error)
          })
        } else if (
          parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:' ||
          parsedUrl.protocol === 'mailto:' || parsedUrl.protocol === 'tel:'
        ) {
          shell.openExternal(details.url)
        }
      }

      return { action: 'deny' }
    })
  }

  markRendererReady() {
    this.bridge.markReady()
    this._broadcastStateUpdate()
  }

  /**
   * @param {number} [timeoutMs]
   * @returns {Promise<boolean>}
   */
  async waitForInitialPresentation(timeoutMs = 8000) {
    if (this._initialPresentationResolved) {
      return true
    }

    let timeoutId
    const timedOut = new Promise(resolve => {
      timeoutId = setTimeout(() => resolve(false), timeoutMs)
    })
    const presented = this._initialPresentationPromise.then(() => true)
    const result = await Promise.race([presented, timedOut])
    clearTimeout(timeoutId)
    return result
  }

  /**
   * @param {TabInfo} tab
   * @param {string} title
   * @returns {boolean}
   */
  applyTabTitle(tab, title) {
    const nextTitle = TabManager.resolveTabTitle(tab.title, title)
    if (nextTitle === tab.title) {
      return false
    }

    tab.title = nextTitle
    if (this.activeTabId === tab.id) {
      this._setWindowTitle(nextTitle)
    }

    this._broadcastStateUpdate()
    this._saveSession()
    return true
  }

  /**
   * @param {TabInfo} tab
   * @param {unknown} avatarBytes
   * @param {string} routePath
   * @returns {Promise<boolean>}
   */
  async applyTabAvatar(tab, avatarBytes, routePath) {
    if (!this._avatarsEnabled || tab.route.path !== routePath) {
      return false
    }

    try {
      const sourceBuffer = avatarBytes instanceof ArrayBuffer
        ? Buffer.from(avatarBytes)
        : ArrayBuffer.isView(avatarBytes)
          ? Buffer.from(avatarBytes.buffer, avatarBytes.byteOffset, avatarBytes.byteLength)
          : null
      if (sourceBuffer == null) return false
      if (sourceBuffer.length === 0 || sourceBuffer.length > MAX_TAB_AVATAR_DOWNLOAD_BYTES) {
        return false
      }

      let image = nativeImage.createFromBuffer(sourceBuffer)
      if (image.isEmpty()) {
        console.warn('Failed to decode tab avatar image data')
        return false
      }

      const size = image.getSize()
      if (size.width > TAB_AVATAR_SIZE || size.height > TAB_AVATAR_SIZE) {
        const scale = TAB_AVATAR_SIZE / Math.max(size.width, size.height)
        image = image.resize({
          width: Math.max(1, Math.round(size.width * scale)),
          height: Math.max(1, Math.round(size.height * scale)),
          quality: 'best'
        })
      }

      const buffer = image.toJPEG(TAB_PREVIEW_JPEG_QUALITY)
      if (
        !this._avatarsEnabled ||
        !this.tabs.has(tab.id) ||
        tab.route.path !== routePath ||
        buffer.length === 0
      ) {
        return false
      }

      await this._persistTabAvatar(tab, buffer)
      if (
        !this._avatarsEnabled ||
        !this.tabs.has(tab.id) ||
        tab.route.path !== routePath
      ) {
        const fileName = tab.avatarFileName
        tab.avatarFileName = null
        await this._releaseTabAvatarFile(fileName)
        return false
      }
      tab.avatarDataUrl = tabPreviewBufferToDataUrl(buffer)
      this._broadcastStateUpdate()
      await this._saveSession()
      return true
    } catch (error) {
      console.error('Failed to cache tab avatar:', error)
      return false
    }
  }

  /**
   * @param {boolean} enabled
   * @returns {Promise<void>}
   */
  async setTabAvatarsEnabled(enabled) {
    if (this._avatarsEnabled === enabled) return

    this._avatarsEnabled = enabled
    if (enabled) return

    // Every tab has to let go of its avatar before the first file is released,
    // or a name shared by two tabs would still look referenced and survive.
    const fileNames = Array.from(this.tabs.values(), tab => {
      tab.avatarDataUrl = null
      const fileName = tab.avatarFileName
      tab.avatarFileName = null
      return fileName
    })
    await Promise.all(fileNames.map(fileName => this._releaseTabAvatarFile(fileName)))
    this._broadcastStateUpdate()
    await this._saveSession()
  }

  /**
   * @param {string | undefined} url
   * @param {string | undefined} route
   * @param {object | undefined} query
   * @returns {{url: string, route: ReturnType<typeof normalizeRoute>}}
   */
  _resolveTabLocation(url, route, query) {
    if (url) {
      return {
        url,
        route: TabManager.getRouteFromUrl(url)
      }
    }

    const normalizedRoute = normalizeRoute({
      path: normalizeRoutePath(route || '/'),
      query
    })

    return {
      url: this._urlFromRoute(normalizedRoute),
      route: normalizedRoute
    }
  }

  /**
   * @param {ReturnType<typeof normalizeRoute>} route
   * @returns {string}
   */
  _urlFromRoute(route) {
    return `${this.rootAppUrl}#${route.fullPath}`
  }

  /**
   * @param {string} tabId
   * @param {TabInfo} tabInfo
   * @param {number} preferredIndex
   */
  _insertTabEntry(tabId, tabInfo, preferredIndex) {
    if (!tabInfo.isPinned && preferredIndex >= this.tabs.size) {
      this.tabs.set(tabId, tabInfo)
      return
    }
    const entries = Array.from(this.tabs.entries())
    const pinnedCount = entries.filter(([, tab]) => tab.isPinned).length
    let insertIndex = Math.max(0, Math.min(preferredIndex, entries.length))

    if (tabInfo.isPinned) {
      insertIndex = Math.min(insertIndex, pinnedCount)
    } else {
      insertIndex = Math.max(insertIndex, pinnedCount)
    }

    entries.splice(insertIndex, 0, [tabId, tabInfo])
    this.tabs = new Map(entries)
  }

  /**
   * @param {object} [options]
   * @returns {TabInfo}
   */
  createTab(options = {}) {
    const {
      id: requestedId,
      url,
      route,
      query,
      title,
      avatarDataUrl = null,
      avatarFileName = null,
      isPinned = false,
      color = null,
      previewDataUrl = null,
      previewCapturedAt = 0,
      previewFileName = null,
      makeActive = true,
      openPosition = DEFAULT_NEW_TAB_POSITION,
      lazyLoad = false,
      isUnloaded = false,
      preloadInBackground = false,
      history = null,
      historyIndex = null,
      persistHistory = history != null,
      skipSilence = showSkipSilenceButton && enableSkipSilenceByDefault,
      groupId = null,
      openerTabId = this.activeTabId,
      _preferredIndex = null,
      _deferUpdates = false,
      _deferMount = false
    } = options

    // Only trusted callers (session restore, transfers) supply an id; renderer
    // options are stripped upstream. Validate defensively and never reuse an id
    // that already exists, which would silently drop a tab from the Map.
    let id = typeof requestedId === 'string' && requestedId.length > 0 ? requestedId : randomUUID()
    while (this.tabs.has(id)) {
      id = randomUUID()
    }

    const location = this._resolveTabLocation(url, route, query)
    const startsUnloaded = (Boolean(lazyLoad) || Boolean(isUnloaded)) && !makeActive && !preloadInBackground
    const shouldMount = !startsUnloaded
    const restoredPreviewDataUrl = isTabPreviewDataUrl(previewDataUrl)
      ? previewDataUrl
      : null
    const restoredPreviewFileName = normalizeTabPreviewFileName(previewFileName)
    const restoredAvatarFileName = normalizeTabPreviewFileName(avatarFileName)
    const restoredPreviewCapturedAt = (restoredPreviewDataUrl != null || restoredPreviewFileName != null) && Number.isFinite(previewCapturedAt)
      ? previewCapturedAt
      : 0
    const restoredNavigationHistory = TabManager.sanitizeNavigationHistory(history, historyIndex)

    /** @type {TabInfo} */
    const tabInfo = {
      id,
      url: location.url,
      route: location.route,
      title: title || TabManager.formatDefaultTabTitle(location.url),
      avatarDataUrl: isTabPreviewDataUrl(avatarDataUrl) ? avatarDataUrl : null,
      avatarFileName: restoredAvatarFileName,
      lastActiveAt: Date.now(),
      isPlaying: false,
      isPinned: Boolean(isPinned),
      isLoading: shouldMount && getFixedInternalRouteTitle(location.route.path) === null,
      loadingSources: new Set(shouldMount ? [TAB_LOADING_SOURCE_MOUNT] : []),
      color: TabManager.normalizeTabColor(color),
      previewDataUrl: restoredPreviewDataUrl,
      previewCapturedAt: restoredPreviewCapturedAt,
      previewFileName: restoredPreviewFileName,
      previewCaptureTimeoutId: null,
      previewCapturePromise: null,
      skipSilence: skipSilence === true,
      loadState: startsUnloaded ? 'unloaded' : 'mounting',
      mountDeferred: shouldMount && !makeActive && _deferMount,
      preloadInBackground: Boolean(preloadInBackground),
      mountRevision: shouldMount ? 1 : 0,
      refreshKey: 0,
      syncedNavigationRevision: 0,
      placementOpenerTabId: this.tabs.has(openerTabId) ? openerTabId : null,
      navigationHistory: restoredNavigationHistory?.history ?? null,
      navigationHistoryIndex: restoredNavigationHistory?.historyIndex ?? 0,
      persistNavigationHistory: Boolean(persistHistory) && restoredNavigationHistory != null,
      groupId: typeof groupId === 'string' && this.tabGroups.has(groupId) ? groupId : null
    }

    const hasPreferredIndex = Number.isInteger(_preferredIndex) && _preferredIndex >= 0
    let preferredIndex = hasPreferredIndex ? _preferredIndex : this.tabs.size
    if (!hasPreferredIndex) {
      const normalizedOpenPosition = TabManager.normalizeNewTabPosition(openPosition)
      if (normalizedOpenPosition === 'afterCurrent' && this.activeTabId != null) {
        const activeTabIndex = Array.from(this.tabs.keys()).indexOf(this.activeTabId)
        if (activeTabIndex !== -1) {
          preferredIndex = activeTabIndex + 1
        }
      } else if (normalizedOpenPosition === 'afterCurrentInOrder' && tabInfo.placementOpenerTabId != null) {
        preferredIndex = getGroupedTabInsertIndex(
          this.tabs,
          tabInfo.placementOpenerTabId,
          tabInfo.isPinned
        ) ?? preferredIndex
      }
    }

    this._insertTabEntry(id, tabInfo, preferredIndex)
    if (tabInfo.mountDeferred) this._startupMountQueue.add(id)

    if (makeActive) {
      // Select immediately; the renderer keeps the outgoing content visible
      // until this tab mounts. Mount completion must not steal a later selection.
      this.activateTab(id)
    } else if (!_deferUpdates) {
      this._broadcastStateUpdate()
      this._saveSession()
    }

    return tabInfo
  }

  /**
   * @param {object} [options]
   * @returns {Promise<TabInfo>}
   */
  async createTabWithPreference(options = {}) {
    const openPosition = options.openPosition == null
      ? await TabManager.getStoredNewTabPosition()
      : TabManager.normalizeNewTabPosition(options.openPosition)
    const tabOptions = options.url || options.route
      ? options
      : { ...options, route: await TabManager.getStoredLandingRoute() }

    const canBatchRapidCreation = this.activeTabId != null && tabOptions.makeActive === false
    const deferUpdates = canBatchRapidCreation && this._rapidTabCreationBatch != null
    const tab = this.createTab({ ...tabOptions, openPosition, _deferUpdates: deferUpdates })
    if (canBatchRapidCreation) {
      const flush = this._scheduleRapidTabCreationFlush(deferUpdates)
      if (deferUpdates) await flush
    }
    return tab
  }

  /**
   * Publish the first background tab in a burst immediately, then coalesce
   * additional creations into one renderer snapshot and session write. The
   * maximum delay keeps continuous creation from postponing updates indefinitely.
   * @param {boolean} updatesDeferred
   * @returns {Promise<void>}
   */
  _scheduleRapidTabCreationFlush(updatesDeferred) {
    if (!this._rapidTabCreationBatch) {
      /** @type {(value?: void | PromiseLike<void>) => void} */
      let resolveBatch
      const promise = new Promise(resolve => {
        resolveBatch = resolve
      })
      this._rapidTabCreationBatch = {
        startedAt: Date.now(),
        hasDeferredUpdates: false,
        timeoutId: null,
        promise,
        resolve: resolveBatch
      }
    }

    const batch = this._rapidTabCreationBatch
    batch.hasDeferredUpdates ||= updatesDeferred
    clearTimeout(batch.timeoutId)
    const elapsed = Date.now() - batch.startedAt
    const delay = Math.max(0, Math.min(
      RAPID_TAB_CREATION_BATCH_DELAY_MS,
      RAPID_TAB_CREATION_BATCH_MAX_DELAY_MS - elapsed
    ))
    batch.timeoutId = setTimeout(() => {
      if (this._rapidTabCreationBatch !== batch) return

      this._rapidTabCreationBatch = null
      if (batch.hasDeferredUpdates) {
        this._broadcastStateUpdate()
        this._saveSession()
      }
      batch.resolve()
    }, delay)

    return batch.promise
  }

  /**
   * @param {object} [options]
   * @param {string | undefined | null} [openerTabId=this.activeTabId]
   * @returns {Promise<TabInfo>}
   */
  async createTabWithPreferenceFromOpener(options = {}, openerTabId = this.activeTabId) {
    return this.createTabWithPreference(this._withOpenerTab(options, openerTabId))
  }

  /**
   * @param {object} options
   * @param {string | undefined | null} openerTabId
   * @returns {object}
   */
  _withOpenerTab(options, openerTabId) {
    if (Object.hasOwn(options, 'color')) {
      return { ...options, openerTabId }
    }

    const openerColor = TabManager.normalizeTabColor(this.tabs.get(openerTabId)?.color)
    return {
      ...options,
      openerTabId,
      ...(openerColor != null && { color: openerColor })
    }
  }

  /**
   * @param {TabInfo | undefined} tab
   * @returns {boolean}
   */
  _isTabActivatable(tab) {
    return isTabActivatable(
      tab,
      this._deferredCloseTabIds,
      this._deferredUnloadTabIds
    )
  }

  /**
   * @param {string} tabId
   */
  activateTab(tabId) {
    const tab = this.tabs.get(tabId)
    if (!this._isTabActivatable(tab)) return

    const previousActiveId = this.activeTabId
    if (
      previousActiveId === tabId &&
      tab.loadState !== 'unloaded' &&
      !tab.mountDeferred
    ) {
      return
    }

    tab.mountDeferred = false
    this._startupMountQueue.delete(tabId)

    const outgoingTabId = this.presentedTabId ?? previousActiveId
    if (outgoingTabId && outgoingTabId !== tabId) {
      this.bridge.send(IpcChannels.TABS_EXIT_FULLSCREEN, outgoingTabId)
    }

    if (tab.loadState === 'unloaded') {
      this._deferredStartupWatchTabIds.delete(tabId)
      tab.loadState = 'mounting'
      tab.mountRevision += 1
      this._setTabLoadingSource(tab, TAB_LOADING_SOURCE_MOUNT, true)
    }

    const shouldResumeDeferredStartupWatchTabs =
      this._deferredStartupWatchTabIds.size > 0 &&
      previousActiveId !== tabId &&
      tab.loadState === 'loaded'
    if (
      this._deferredStartupWatchTabIds.size > 0 &&
      previousActiveId !== tabId &&
      !shouldResumeDeferredStartupWatchTabs
    ) {
      this._startupPriorityTabId = tabId
      this._startupPriorityLoadingObserved = false
    }

    tab.preloadInBackground = false
    tab.lastActiveAt = Date.now()
    this.activeTabId = tabId
    this.selectionRevision += 1
    this._setWindowTitle(tab.title)
    this.bridge.send(IpcChannels.TABS_ACTIVE_CHANGED, tabId, this.selectionRevision)
    if (shouldResumeDeferredStartupWatchTabs) {
      this._resumeDeferredStartupWatchTabs()
    }
    this._broadcastStateUpdate()
    this._saveSession()
  }

  /**
   * @param {string} tabId
   * @param {number} mountRevision
   * @param {number} [timeoutMs]
   * @returns {Promise<boolean>}
   */
  waitForTabMount(tabId, mountRevision, timeoutMs = TAB_TRANSFER_MOUNT_TIMEOUT_MS) {
    const tab = this.tabs.get(tabId)
    if (!tab || tab.mountRevision !== mountRevision) {
      return Promise.resolve(false)
    }
    if (tab.loadState === 'loaded') {
      return Promise.resolve(true)
    }

    return new Promise(resolve => {
      const waiter = {
        mountRevision,
        resolve,
        timeoutId: setTimeout(() => {
          const waiters = this._pendingTabMountWaiters.get(tabId)
          waiters?.delete(waiter)
          if (waiters?.size === 0) {
            this._pendingTabMountWaiters.delete(tabId)
          }
          resolve(false)
        }, timeoutMs)
      }

      let waiters = this._pendingTabMountWaiters.get(tabId)
      if (!waiters) {
        waiters = new Set()
        this._pendingTabMountWaiters.set(tabId, waiters)
      }
      waiters.add(waiter)
    })
  }

  _resolveTabMountWaiters(tabId, mountRevision, succeeded) {
    const waiters = this._pendingTabMountWaiters.get(tabId)
    if (!waiters) {
      return
    }

    for (const waiter of waiters) {
      if (waiter.mountRevision <= mountRevision) {
        waiters.delete(waiter)
        clearTimeout(waiter.timeoutId)
        waiter.resolve(succeeded && waiter.mountRevision === mountRevision)
      }
    }
    if (waiters.size === 0) {
      this._pendingTabMountWaiters.delete(tabId)
    }
  }

  /**
   * @param {string} tabId
   * @param {number} mountRevision
   */
  markTabMounted(tabId, mountRevision) {
    const tab = this.tabs.get(tabId)
    if (!tab || mountRevision !== tab.mountRevision) {
      this._resolveTabMountWaiters(tabId, mountRevision, false)
      return
    }

    tab.loadState = 'loaded'
    tab.preloadInBackground = false
    this._setTabLoadingSource(tab, TAB_LOADING_SOURCE_MOUNT, false)
    this._resolveTabMountWaiters(tabId, mountRevision, true)

    this._broadcastStateUpdate()
  }

  /**
   * @param {string} tabId
   * @param {number} mountRevision
   */
  markTabMountFailed(tabId, mountRevision) {
    const tab = this.tabs.get(tabId)
    if (!tab || mountRevision !== tab.mountRevision) {
      this._resolveTabMountWaiters(tabId, mountRevision, false)
      return
    }

    tab.loadState = 'unloaded'
    tab.preloadInBackground = false
    this._setTabLoadingSource(tab, TAB_LOADING_SOURCE_MOUNT, false)
    this._resolveTabMountWaiters(tabId, mountRevision, false)
    if (tabId === this._startupPriorityTabId) {
      this._resumeDeferredStartupWatchTabs()
    }

    // The failed tab was activated as the replacement for one or more tabs whose
    // close/unload was deferred until it presented. Since it will never present,
    // markTabPresented would never run and those tabs would stay stranded in the
    // bar/store forever. Finalize them now. The deferred tab is still the
    // presentedTabId, so clear it first to avoid closeTab/unloadTab re-deferring it.
    if (this.activeTabId === tabId) {
      if (
        this.presentedTabId != null &&
        (this._deferredCloseTabIds.has(this.presentedTabId) ||
          this._deferredUnloadTabIds.has(this.presentedTabId))
      ) {
        this.presentedTabId = null
      }
      this._scheduleStartupMount()
      this._finalizeDeferredDisposals(tabId)
    }

    this._broadcastStateUpdate()
    this._saveSession()
  }

  /**
   * @param {string} tabId
   * @param {number} selectionRevision
   */
  markTabPresented(tabId, selectionRevision) {
    if (
      selectionRevision !== this.selectionRevision ||
      tabId !== this.activeTabId ||
      !this.tabs.has(tabId)
    ) {
      return
    }

    this.presentedTabId = tabId
    if (!this._initialPresentationResolved) {
      this._initialPresentationResolved = true
      this._resolveInitialPresentation()
    }

    this._scheduleStartupMount()
    this._finalizeDeferredDisposals(tabId)

    const tab = this.tabs.get(tabId)
    this._scheduleTabPreviewRefresh(tab)
    this._broadcastStateUpdate()
  }

  /**
   * Finalize any tab closes/unloads that were deferred until a new tab was
   * presented, skipping the tab that should remain.
   * @param {string} keepTabId
   */
  _finalizeDeferredDisposals(keepTabId) {
    for (const deferredTabId of [...this._deferredCloseTabIds]) {
      if (deferredTabId !== keepTabId) {
        this._deferredCloseTabIds.delete(deferredTabId)
        this.closeTab(deferredTabId)
      }
    }
    for (const deferredTabId of [...this._deferredUnloadTabIds]) {
      if (deferredTabId !== keepTabId) {
        this._deferredUnloadTabIds.delete(deferredTabId)
        this.unloadTab(deferredTabId).catch(error => {
          console.error('Failed to finish deferred tab unload:', error)
        })
      }
    }
  }

  /**
   * @param {string} tabId
   * @param {boolean} [loadedOnly]
   * @param {Set<string> | null} [excludedTabIds] tabs that are about to be closed
   * or unloaded as part of the same bulk operation
   * @returns {string | null}
   */
  _getNeighborTabId(tabId, loadedOnly = false, excludedTabIds = null) {
    const orderedTabIds = Array.from(this.tabs.keys())
    const tabIndex = orderedTabIds.indexOf(tabId)
    if (tabIndex === -1) {
      return null
    }

    const previousTabIds = orderedTabIds.slice(0, tabIndex).reverse()
    const nextTabIds = orderedTabIds.slice(tabIndex + 1)
    // A tab already queued for deferred close/unload must never be selected as
    // the replacement, otherwise a rapid second close/unload would leave the
    // window with no selectable tab.
    const isSelectable = candidateId =>
      excludedTabIds?.has(candidateId) !== true &&
      this.tabs.get(candidateId)?.isTransferStaged !== true &&
      (!loadedOnly || this.tabs.get(candidateId)?.loadState === 'loaded') &&
      !this._deferredCloseTabIds.has(candidateId) &&
      !this._deferredUnloadTabIds.has(candidateId)

    const [preferredTabIds, fallbackTabIds] = tabCloseFocus === 'nextTab'
      ? [nextTabIds, previousTabIds]
      : [previousTabIds, nextTabIds]
    const preferredTabId = preferredTabIds.find(isSelectable)
    const fallbackTabId = fallbackTabIds.find(isSelectable)

    // Prefer an already-loaded tab on the other side over mounting an unloaded
    // tab on the configured side.
    if (
      preferredTabId != null &&
      fallbackTabId != null &&
      this.tabs.get(preferredTabId)?.loadState !== 'loaded' &&
      this.tabs.get(fallbackTabId)?.loadState === 'loaded'
    ) {
      return fallbackTabId
    }

    return preferredTabId ?? fallbackTabId ?? null
  }

  _prepareNeighborActivation(tabId) {
    const tab = this.tabs.get(tabId)
    if (!tab || tab.isTransferStaged === true) {
      return false
    }

    return true
  }

  /**
   * Return the tab's position in the live and recently-closed tabs combined.
   * Closed positions keep later closes from collapsing into the same index.
   * @param {string} tabId
   * @returns {number}
   */
  _getClosedTabIndex(tabId) {
    let tabIndex = Array.from(this.tabs.keys()).indexOf(tabId)
    if (tabIndex < 0) return tabIndex

    const closedTabIndexes = this.closedTabs
      .map(tab => tab.tabIndex)
      .sort((a, b) => a - b)
    for (const closedTabIndex of closedTabIndexes) {
      if (closedTabIndex <= tabIndex) tabIndex += 1
    }
    return tabIndex
  }

  /**
   * Convert a retained logical position back into the current live tab order.
   * @param {{ tabIndex: number }} closedTab
   * @returns {number}
   */
  _getClosedTabRestoreIndex(closedTab) {
    const earlierClosedTabCount = this.closedTabs.reduce((count, tab) => {
      return count + Number(tab.tabIndex < closedTab.tabIndex)
    }, 0)
    return closedTab.tabIndex - earlierClosedTabCount
  }

  /**
   * @param {string} tabId
   * @returns {boolean}
   */
  closeTab(tabId) {
    const tab = this.tabs.get(tabId)
    if (!tab) {
      return this.tabs.size > 0
    }
    if (tab.isTransferStaged === true) {
      return true
    }

    // Keep the currently composited subtree alive until its replacement has
    // mounted and been presented. Removing it immediately would expose the
    // BrowserWindow background during lazy activation.
    if (this.presentedTabId === tabId && this.tabs.size > 1) {
      if (this._deferredCloseTabIds.has(tabId)) {
        return true
      }

      const nextTabId = this.activeTabId !== tabId && this.tabs.has(this.activeTabId)
        ? this.activeTabId
        : this._getNeighborTabId(tabId)
      if (nextTabId) {
        this._deferredCloseTabIds.add(tabId)
        this.bridge.send(IpcChannels.TABS_EXIT_FULLSCREEN, tabId)
        if (this.activeTabId === tabId) {
          this.activeTabId = null
          if (this._prepareNeighborActivation(nextTabId)) {
            this.activateTab(nextTabId)
          }
        }
        this._saveSession()
        return true
      }
      return true
    }

    if (this.activeTabId === tabId) {
      if (this.browserWindow.isFullScreen()) {
        this.browserWindow.setFullScreen(false)
      }
      this.bridge.send(IpcChannels.TABS_EXIT_FULLSCREEN, tabId)
    }

    this._clearTabPreviewRefresh(tab)
    this.closedTabs.push({
      id: randomUUID(),
      url: tab.url,
      title: tab.title,
      isPinned: tab.isPinned,
      color: tab.color,
      groupId: tab.groupId,
      history: tab.navigationHistory,
      historyIndex: tab.navigationHistoryIndex,
      tabIndex: this._getClosedTabIndex(tabId)
    })
    if (this.closedTabs.length > 10) {
      const removedClosedTab = this.closedTabs.shift()
      for (const closedTab of this.closedTabs) {
        if (closedTab.tabIndex > removedClosedTab.tabIndex) closedTab.tabIndex -= 1
      }
    }

    const nextTabId = this.activeTabId === tabId
      ? this._getNeighborTabId(tabId)
      : null

    this.tabs.delete(tabId)
    this.selectedTabIds = this.selectedTabIds.filter(selectedTabId => selectedTabId !== tabId)
    this._deferredCloseTabIds.delete(tabId)
    this._deferredUnloadTabIds.delete(tabId)
    this._resolveTabMountWaiters(tabId, Number.MAX_SAFE_INTEGER, false)
    if (this.contextMenuTabId === tabId) {
      this.contextMenuTabId = null
    }
    if (this.presentedTabId === tabId) {
      this.presentedTabId = null
    }

    this._deleteTabPreviewFile(tab.previewFileName).catch(error => {
      console.error('Failed to delete closed tab preview:', error)
    })
    this._releaseTabAvatarFile(tab.avatarFileName).catch(error => {
      console.error('Failed to delete closed tab avatar:', error)
    })

    if (nextTabId) {
      this.activeTabId = null
      if (this._prepareNeighborActivation(nextTabId)) {
        this.activateTab(nextTabId)
      }
    } else if (this.activeTabId === tabId) {
      this.activeTabId = null
      this.selectionRevision += 1
      this._broadcastStateUpdate()
      this._saveSession()
    } else {
      this._broadcastStateUpdate()
      this._saveSession()
    }

    return this.tabs.size > 0
  }

  /**
   * Close several tabs at once. Activating the surviving replacement up front
   * keeps the tabs that are on their way out from being mounted just to be torn
   * down again, and the batching collapses the per-tab renderer updates and
   * session writes into one.
   * @param {string[]} tabIds
   * @returns {Promise<boolean>} whether the window still has tabs
   */
  async closeTabs(tabIds) {
    const closingTabIds = tabIds.filter(tabId => this.tabs.has(tabId))
    if (closingTabIds.length === 0) {
      return this.tabs.size > 0
    }
    if (closingTabIds.length === 1) {
      return this.closeTab(closingTabIds[0])
    }

    return await this.runBatched(() => {
      const closingTabIdSet = new Set(closingTabIds)
      if (this.activeTabId != null && closingTabIdSet.has(this.activeTabId)) {
        const nextTabId = this._getNeighborTabId(this.activeTabId, false, closingTabIdSet)
        if (nextTabId != null && this._prepareNeighborActivation(nextTabId)) {
          this.activateTab(nextTabId)
        }
      }

      // Close the presented tab last so its replacement can be shown before the
      // composited subtree is removed.
      closingTabIds.sort((a, b) => Number(a === this.presentedTabId) - Number(b === this.presentedTabId))
      let hasRemainingTabs = this.tabs.size > 0
      for (const tabId of closingTabIds) {
        hasRemainingTabs = this.closeTab(tabId)
      }
      return hasRemainingTabs
    })
  }

  /**
   * Unload several tabs at once, see {@link closeTabs}.
   * @param {string[]} tabIds
   * @returns {Promise<void>}
   */
  async unloadTabs(tabIds) {
    const unloadingTabIds = tabIds.filter(tabId => this.tabs.has(tabId))
    if (unloadingTabIds.length === 0) {
      return
    }

    const presentedTabId = this.presentedTabId
    const batchedTabIds = unloadingTabIds.filter(tabId => tabId !== presentedTabId)

    await this.runBatched(async () => {
      const unloadingTabIdSet = new Set(unloadingTabIds)
      if (this.activeTabId != null && unloadingTabIdSet.has(this.activeTabId)) {
        const nextTabId = this._getNeighborTabId(this.activeTabId, true, unloadingTabIdSet) ??
          this._getNeighborTabId(this.activeTabId, false, unloadingTabIdSet)
        if (nextTabId != null && this._prepareNeighborActivation(nextTabId)) {
          this.activateTab(nextTabId)
        }
      }

      for (const tabId of batchedTabIds) {
        await this.unloadTab(tabId).catch(error => {
          console.error('Failed to unload tab:', error)
        })
      }
    })

    // The presented tab captures a fresh preview before it goes. Run it outside
    // the manager-wide batch so the capture cannot hold back unrelated updates.
    if (presentedTabId != null && unloadingTabIds.includes(presentedTabId)) {
      await this.unloadTab(presentedTabId).catch(error => {
        console.error('Failed to unload tab:', error)
      })
    }
  }

  /**
   * @param {string} tabId
   * @returns {TabInfo|null}
   */
  duplicateTab(tabId) {
    const tab = this.tabs.get(tabId)
    if (!tab) return null

    return this.createTab({
      url: tab.url,
      title: tab.title,
      avatarDataUrl: tab.avatarDataUrl,
      isPinned: tab.isPinned,
      color: tab.color,
      groupId: tab.groupId,
      makeActive: true
    })
  }

  /**
   * @param {string | null} [closedTabId]
   * @returns {Promise<TabInfo|null>}
   */
  async restoreClosedTab(closedTabId = null) {
    const index = closedTabId == null
      ? this.closedTabs.length - 1
      : this.closedTabs.findIndex(tab => tab.id === closedTabId)
    if (index < 0) return null

    const [closedTab] = this.closedTabs.splice(index, 1)
    if (!closedTab) return null
    const restoreIndex = this._getClosedTabRestoreIndex(closedTab)

    return this.createTab({
      url: closedTab.url,
      title: closedTab.title,
      isPinned: closedTab.isPinned,
      color: closedTab.color,
      groupId: closedTab.groupId,
      history: closedTab.history,
      historyIndex: closedTab.historyIndex,
      persistHistory: await TabManager.getStoredRememberTabNavigationHistory(),
      _preferredIndex: restoreIndex,
      makeActive: true
    })
  }

  clearClosedTabs() {
    if (this.closedTabs.length === 0) return false
    this.closedTabs = []
    this._broadcastStateUpdate()
    return true
  }

  /**
   * @param {string} tabId
   * @param {boolean} isPinned
   * @returns {boolean}
   */
  setTabPinned(tabId, isPinned) {
    const tab = this.tabs.get(tabId)
    if (!tab) return false

    const nextPinned = Boolean(isPinned)
    if (tab.isPinned === nextPinned) {
      return false
    }

    tab.isPinned = nextPinned
    const entries = Array.from(this.tabs.entries()).filter(([id]) => id !== tabId)
    const pinnedCount = entries.filter(([, candidate]) => candidate.isPinned).length
    entries.splice(pinnedCount, 0, [tabId, tab])
    this.tabs = new Map(entries)
    this._broadcastStateUpdate()
    this._saveSession()
    return true
  }

  /**
   * @param {string} tabId
   * @param {string | null} color
   * @returns {boolean}
   */
  setTabColor(tabId, color) {
    const tab = this.tabs.get(tabId)
    if (!tab) return false

    const nextColor = TabManager.normalizeTabColor(color)
    if (tab.color === nextColor) {
      return false
    }

    tab.color = nextColor
    this._broadcastStateUpdate()
    this._saveSession()
    return true
  }

  /**
   * @param {{name?: unknown, icon?: unknown, color?: unknown}} group
   * @returns {{id: string, name: string, color: string | null, icon: string, isCollapsed: boolean} | null}
   */
  createTabGroup(group = {}) {
    const name = TabManager.normalizeTabGroupName(group.name)
    if (name.length === 0) return null

    const tabGroup = {
      id: randomUUID(),
      name,
      color: TabManager.normalizeTabColor(group.color),
      icon: normalizeTabGroupIcon(group.icon),
      isCollapsed: false
    }
    this.tabGroups.set(tabGroup.id, tabGroup)
    this._broadcastStateUpdate()
    this._saveSession()
    return { ...tabGroup }
  }

  /**
   * @param {string} groupId
   * @param {{name?: unknown, icon?: unknown, color?: unknown, isCollapsed?: unknown}} changes
   * @returns {boolean}
   */
  updateTabGroup(groupId, changes = {}) {
    const group = this.tabGroups.get(groupId)
    if (!group) return false

    const nextName = Object.hasOwn(changes, 'name')
      ? TabManager.normalizeTabGroupName(changes.name)
      : group.name
    if (nextName.length === 0) return false

    const nextColor = Object.hasOwn(changes, 'color')
      ? TabManager.normalizeTabColor(changes.color)
      : group.color
    const nextIcon = Object.hasOwn(changes, 'icon')
      ? normalizeTabGroupIcon(changes.icon)
      : normalizeTabGroupIcon(group.icon)
    const nextCollapsed = Object.hasOwn(changes, 'isCollapsed')
      ? changes.isCollapsed === true
      : group.isCollapsed
    if (
      nextName === group.name &&
      nextColor === group.color &&
      nextIcon === group.icon &&
      nextCollapsed === group.isCollapsed
    ) {
      return false
    }

    group.name = nextName
    group.icon = nextIcon
    group.color = nextColor
    group.isCollapsed = nextCollapsed
    this._broadcastStateUpdate()
    this._saveSession()
    return true
  }

  /**
   * @param {string[]} tabIds
   * @param {string | null} groupId
   * @returns {number}
   */
  setTabsGroup(tabIds, groupId) {
    const nextGroupId = typeof groupId === 'string' && this.tabGroups.has(groupId)
      ? groupId
      : null
    if (groupId != null && nextGroupId == null) return 0

    let changed = 0
    for (const tabId of new Set(tabIds)) {
      const tab = this.tabs.get(tabId)
      if (tab && tab.groupId !== nextGroupId) {
        tab.groupId = nextGroupId
        changed += 1
      }
    }
    if (changed > 0) {
      this._broadcastStateUpdate()
      this._saveSession()
    }
    return changed
  }

  /**
   * @param {string} groupId
   * @returns {boolean}
   */
  deleteTabGroup(groupId) {
    if (!this.tabGroups.delete(groupId)) return false

    for (const tab of this.tabs.values()) {
      if (tab.groupId === groupId) tab.groupId = null
    }
    for (const tab of this.closedTabs) {
      if (tab.groupId === groupId) tab.groupId = null
    }
    this._broadcastStateUpdate()
    this._saveSession()
    return true
  }

  /**
   * Replace group metadata from a persisted or synced session before its tabs
   * are created. Invalid and duplicate entries are ignored.
   * @param {unknown} groups
   */
  _restoreTabGroups(groups) {
    const restored = new Map()
    if (Array.isArray(groups)) {
      for (const candidate of groups) {
        const id = typeof candidate?.id === 'string' ? candidate.id : ''
        const name = TabManager.normalizeTabGroupName(candidate?.name)
        if (id.length === 0 || name.length === 0 || restored.has(id)) continue

        restored.set(id, {
          id,
          name,
          color: TabManager.normalizeTabColor(candidate.color),
          icon: normalizeTabGroupIcon(candidate.icon),
          isCollapsed: candidate.isCollapsed === true
        })
      }
    }
    this.tabGroups = restored
  }

  /**
   * @param {TabInfo} tab
   * @returns {Set<string>}
   */
  _getTabLoadingSources(tab) {
    if (!(tab.loadingSources instanceof Set)) {
      tab.loadingSources = new Set()
    }
    return tab.loadingSources
  }

  /**
   * @param {TabInfo} tab
   * @returns {boolean}
   */
  _getTabLoadingState(tab) {
    const loadingSources = this._getTabLoadingSources(tab)
    if (getFixedInternalRouteTitle(tab.route.path) !== null) {
      return loadingSources.has(TAB_LOADING_SOURCE_RENDERER)
    }
    return loadingSources.size > 0 || tab.loadState === 'mounting'
  }

  /**
   * @param {TabInfo} tab
   */
  _syncTabLoadingState(tab) {
    const nextLoading = this._getTabLoadingState(tab)
    if (tab.isLoading === nextLoading) {
      return
    }

    tab.isLoading = nextLoading
    this._broadcastStateUpdate()
    if (!nextLoading) {
      this._scheduleTabPreviewRefresh(tab)
    }
  }

  /**
   * @param {TabInfo} tab
   * @param {string} source
   * @param {boolean} isLoading
   */
  _setTabLoadingSource(tab, source, isLoading) {
    const loadingSources = this._getTabLoadingSources(tab)
    if (isLoading) {
      loadingSources.add(source)
    } else {
      loadingSources.delete(source)
    }
    this._syncTabLoadingState(tab)
  }

  /**
   * @param {TabInfo} tab
   * @param {number} [delay]
   */
  _scheduleTabPreviewRefresh(tab, delay = TAB_PREVIEW_REFRESH_DELAY_MS) {
    this._clearTabPreviewRefresh(tab)
    if (!this._tabPreviewsEnabled || this._previewCapturePaused || this.presentedTabId !== tab.id) {
      return
    }

    tab.previewCaptureTimeoutId = setTimeout(() => {
      tab.previewCaptureTimeoutId = null
      if (this.presentedTabId !== tab.id) {
        return
      }
      if (this._getTabLoadingState(tab)) {
        this._scheduleTabPreviewRefresh(tab, delay)
        return
      }
      this._refreshTabPreview(tab).catch(error => {
        console.error('Failed to refresh tab preview:', error)
      })
    }, delay)
  }

  /**
   * @param {TabInfo} tab
   */
  _clearTabPreviewRefresh(tab) {
    if (tab.previewCaptureTimeoutId != null) {
      clearTimeout(tab.previewCaptureTimeoutId)
      tab.previewCaptureTimeoutId = null
    }
  }

  /**
   * @param {string | null | undefined} fileName
   * @returns {string | null}
   */
  _getTabPreviewFilePath(fileName) {
    const normalizedFileName = normalizeTabPreviewFileName(fileName)
    return normalizedFileName == null
      ? null
      : join(TabManager.getTabPreviewCacheDirectory(), normalizedFileName)
  }

  /**
   * @param {TabInfo} tab
   * @param {Buffer} buffer
   * @returns {Promise<void>}
   */
  async _persistTabPreview(tab, buffer) {
    if (buffer == null || buffer.length === 0) {
      return
    }

    const existingFileName = normalizeTabPreviewFileName(tab.previewFileName)
    // A cache entry left by an older version is a PNG; writing JPEG bytes into
    // it would leave the extension lying about the contents, so start a new file.
    const reusableFileName = isReusableTabPreviewFileName(existingFileName) ? existingFileName : null
    const fileName = reusableFileName ?? createTabPreviewFileName()
    const cacheDirectory = TabManager.getTabPreviewCacheDirectory()
    await mkdir(cacheDirectory, { recursive: true })
    // Writing straight to the target would truncate it first, so a failed write
    // (a full disk, a kill) would destroy a preview that was perfectly good.
    // A rename within the directory swaps it in atomically instead.
    const tempPath = join(cacheDirectory, createTabPreviewTempFileName())
    try {
      await writeFile(tempPath, buffer)
      await rename(tempPath, join(cacheDirectory, fileName))
    } catch (error) {
      await unlink(tempPath).catch(() => {})
      throw error
    }
    tab.previewFileName = fileName

    if (reusableFileName == null && existingFileName != null) {
      await this._deleteTabPreviewFile(existingFileName)
    }
  }

  /**
   * @param {TabInfo} tab
   * @param {Buffer} buffer
   * @returns {Promise<void>}
   */
  async _persistTabAvatar(tab, buffer) {
    await tabPreviewCacheMaintenance
    const existingFileName = normalizeTabPreviewFileName(tab.avatarFileName)
    // Named after the bytes, so every tab of the same channel ends up on one
    // file. Rewriting it costs a couple of kilobytes and keeps the write atomic
    // even when a previous one was interrupted halfway.
    const fileName = createTabAvatarFileName(buffer)
    const cacheDirectory = TabManager.getTabPreviewCacheDirectory()
    await mkdir(cacheDirectory, { recursive: true })
    const tempPath = join(cacheDirectory, createTabPreviewTempFileName())
    try {
      await writeFile(tempPath, buffer)
      await rename(tempPath, join(cacheDirectory, fileName))
    } catch (error) {
      await unlink(tempPath).catch(() => {})
      throw error
    }
    tab.avatarFileName = fileName

    if (existingFileName != null && existingFileName !== fileName) {
      await this._releaseTabAvatarFile(existingFileName)
    }
  }

  /**
   * Whether any tab, in this window or another one, still shows this avatar.
   * @param {string} fileName
   * @param {Set<TabInfo>} [ignoredTabs] tabs that are dropping it right now
   * @returns {boolean}
   */
  _isTabAvatarFileReferenced(fileName, ignoredTabs) {
    for (const manager of tabManagers.values()) {
      for (const tab of manager.tabs.values()) {
        if (ignoredTabs?.has(tab)) continue
        if (normalizeTabPreviewFileName(tab.avatarFileName) === fileName) {
          return true
        }
      }
    }
    return false
  }

  /**
   * Deletes a cached avatar once the last tab using it lets go. Avatars are
   * shared between tabs of the same channel, so unlinking on the first close
   * would take the file out from under the tabs that are still open.
   * @param {string | null | undefined} fileName
   * @param {Set<TabInfo>} [ignoredTabs]
   * @returns {Promise<void>}
   */
  async _releaseTabAvatarFile(fileName, ignoredTabs) {
    const normalizedFileName = normalizeTabPreviewFileName(fileName)
    if (
      normalizedFileName == null ||
      this._isTabAvatarFileReferenced(normalizedFileName, ignoredTabs)
    ) {
      return
    }
    await this._deleteTabPreviewFile(normalizedFileName)
  }

  /**
   * @param {string | null | undefined} fileName
   * @returns {Promise<string | null>}
   */
  async _loadTabPreviewDataUrl(fileName) {
    const filePath = this._getTabPreviewFilePath(fileName)
    if (filePath == null) {
      return null
    }

    try {
      const buffer = await readFile(filePath)
      return buffer.length > 0 ? tabPreviewBufferToDataUrl(buffer) : null
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.error('Failed to load tab preview:', error)
      }
      return null
    }
  }

  /**
   * @param {TabInfo} tab
   * @returns {Promise<string | null>}
   */
  async _getCachedTabPreviewDataUrl(tab) {
    if (typeof tab.previewDataUrl === 'string' && tab.previewDataUrl.length > 0) {
      return tab.previewDataUrl
    }

    const dataUrl = await this._loadTabPreviewDataUrl(tab.previewFileName)
    if (dataUrl != null) {
      tab.previewDataUrl = dataUrl
    }
    return dataUrl
  }

  /**
   * @param {string | null | undefined} fileName
   * @returns {Promise<void>}
   */
  async _deleteTabPreviewFile(fileName) {
    const filePath = this._getTabPreviewFilePath(fileName)
    if (filePath == null) {
      return
    }

    try {
      await unlink(filePath)
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.error('Failed to delete tab preview:', error)
      }
    }
  }

  /**
   * @param {string} tabId
   * @returns {Promise<string | null>}
   */
  async captureTabPreview(tabId) {
    if (!this._tabPreviewsEnabled) {
      return null
    }

    const tab = this.tabs.get(tabId)
    if (!tab) {
      return null
    }

    const cachedPreview = await this._getCachedTabPreviewDataUrl(tab)
    if (
      tab.id !== this.presentedTabId ||
      this.browserWindow.webContents.isDestroyed() ||
      this._getTabLoadingState(tab)
    ) {
      return cachedPreview ?? TabManager.getVideoThumbnailUrl(tab.url)
    }

    return await this._refreshTabPreview(tab) ?? cachedPreview ?? TabManager.getVideoThumbnailUrl(tab.url)
  }

  /**
   * @param {string[]} tabIds
   * @returns {Promise<Record<string, string | null>>}
   */
  async getCachedTabPreviews(tabIds) {
    if (!this._tabPreviewsEnabled) {
      return Object.fromEntries(tabIds.map(tabId => [tabId, null]))
    }

    const previews = await Promise.all(tabIds.map(async tabId => {
      const tab = this.tabs.get(tabId)
      const preview = tab == null
        ? null
        : await this._getCachedTabPreviewDataUrl(tab) ?? TabManager.getVideoThumbnailUrl(tab.url)
      return [tabId, preview]
    }))
    return Object.fromEntries(previews)
  }

  /**
   * @param {boolean} paused
   */
  setPreviewCapturePaused(paused) {
    if (this._previewCapturePaused === paused) {
      return
    }

    this._previewCapturePaused = paused
    if (paused) {
      for (const tab of this.tabs.values()) {
        this._clearTabPreviewRefresh(tab)
      }
      return
    }

    const presentedTab = this.presentedTabId == null ? null : this.tabs.get(this.presentedTabId)
    if (presentedTab != null && !this._getTabLoadingState(presentedTab)) {
      this._scheduleTabPreviewRefresh(presentedTab)
    }
  }

  /**
   * @param {boolean} enabled
   * @returns {Promise<void>}
   */
  async setTabPreviewsEnabled(enabled) {
    if (this._tabPreviewsEnabled === enabled) return

    const transitionId = ++this._tabPreviewTransitionId
    this._tabPreviewsEnabled = enabled
    if (enabled) {
      const presentedTab = this.presentedTabId == null ? null : this.tabs.get(this.presentedTabId)
      if (presentedTab != null && !this._getTabLoadingState(presentedTab)) {
        this._scheduleTabPreviewRefresh(presentedTab)
      }
      return
    }

    for (const tab of this.tabs.values()) {
      this._clearTabPreviewRefresh(tab)
    }
    await Promise.allSettled(Array.from(this.tabs.values(), tab => tab.previewCapturePromise).filter(Boolean))
    if (transitionId !== this._tabPreviewTransitionId || this._tabPreviewsEnabled) {
      return
    }

    const fileNames = Array.from(this.tabs.values(), tab => {
      tab.previewDataUrl = null
      tab.previewCapturedAt = 0
      const fileName = tab.previewFileName
      tab.previewFileName = null
      return fileName
    })
    await Promise.all(fileNames.map(fileName => this._deleteTabPreviewFile(fileName)))
    if (transitionId !== this._tabPreviewTransitionId || this._tabPreviewsEnabled) {
      return
    }
    this._broadcastStateUpdate()
    await this._saveSession()
  }

  /**
   * @param {TabInfo} tab
   * @returns {Promise<string | null>}
   */
  async _refreshTabPreview(tab) {
    if (!this._tabPreviewsEnabled) {
      return null
    }

    if (
      tab.id !== this.presentedTabId ||
      this.browserWindow.webContents.isDestroyed() ||
      this._getTabLoadingState(tab)
    ) {
      return await this._getCachedTabPreviewDataUrl(tab)
    }

    if (tab.previewCapturePromise != null) {
      return tab.previewCapturePromise
    }

    tab.previewCapturePromise = this._captureTabPreviewSerialized(tab)

    try {
      return await tab.previewCapturePromise
    } finally {
      tab.previewCapturePromise = null
    }
  }

  /**
   * Runs a single preview capture, serialized against every other capture in
   * this window via {@link _previewCaptureLock}. Only the lock owner toggles
   * capture mode, and presentation is revalidated across every async hop so a
   * screenshot of a different tab is never persisted as this tab's preview.
   * @param {TabInfo} tab
   * @returns {Promise<string | null>}
   */
  async _captureTabPreviewSerialized(tab) {
    const previousCapture = this._previewCaptureLock
    /** @type {() => void} */
    let releaseLock = () => {}
    this._previewCaptureLock = new Promise(resolve => {
      releaseLock = resolve
    })
    await Promise.all([
      previousCapture.catch(() => {}),
      tabPreviewCacheMaintenance,
    ])

    try {
      // Presentation and window state may have changed while waiting for the lock.
      if (
        !this._tabPreviewsEnabled ||
        this._previewCapturePaused ||
        tab.id !== this.presentedTabId ||
        this.browserWindow.webContents.isDestroyed() ||
        this._getTabLoadingState(tab)
      ) {
        return await this._getCachedTabPreviewDataUrl(tab)
      }

      try {
        await this._setTabPreviewCaptureMode(true)
        // Entering capture mode awaits an IPC round-trip, during which the main
        // process stays unblocked and another tab may have been activated. If so,
        // the renderer is now painting a different tab, so capturing here would
        // save the wrong content as this tab's preview. Bail out with the cache.
        if (!this._tabPreviewsEnabled || tab.id !== this.presentedTabId) {
          return await this._getCachedTabPreviewDataUrl(tab)
        }
        const image = await this.browserWindow.webContents.capturePage()
        // capturePage awaits another round-trip; the presented tab may have
        // changed again. Never persist a screenshot captured for a stale tab.
        if (!this._tabPreviewsEnabled || tab.id !== this.presentedTabId) {
          return await this._getCachedTabPreviewDataUrl(tab)
        }
        if (image.isEmpty()) {
          return await this._getCachedTabPreviewDataUrl(tab)
        }

        const contentBounds = await this._getTabPreviewContentBounds()
        const contentImage = contentBounds == null ? image : cropTabPreviewToContent(image, contentBounds)
        if (contentImage == null || contentImage.isEmpty()) {
          return await this._getCachedTabPreviewDataUrl(tab)
        }

        const targetSize = getTabPreviewTargetSize(contentImage.getSize(), contentBounds)
        const preview = targetSize == null
          ? contentImage
          : contentImage.resize({ ...targetSize, quality: 'best' })
        const previewBuffer = preview.toJPEG(TAB_PREVIEW_JPEG_QUALITY)
        if (previewBuffer.length === 0) {
          return await this._getCachedTabPreviewDataUrl(tab)
        }

        if (!this._tabPreviewsEnabled) {
          return null
        }

        const dataUrl = tabPreviewBufferToDataUrl(previewBuffer)
        tab.previewDataUrl = dataUrl
        tab.previewCapturedAt = Date.now()
        await this._persistTabPreview(tab, previewBuffer)
        await this._saveSession()
        return dataUrl
      } catch (error) {
        console.error('Failed to capture tab preview:', error)
        return await this._getCachedTabPreviewDataUrl(tab)
      } finally {
        await this._setTabPreviewCaptureMode(false)
      }
    } finally {
      releaseLock()
    }
  }

  /**
   * @returns {Promise<import('./tabPreviewGeometry.js').TabPreviewContentBounds | null>}
   */
  async _getTabPreviewContentBounds() {
    try {
      return await this.browserWindow.webContents.executeJavaScript(
        `(${measureTabPreviewContentBounds.toString()})(window, document)`,
        true
      )
    } catch {
      return null
    }
  }

  /**
   * @param {boolean} enabled
   */
  async _setTabPreviewCaptureMode(enabled) {
    if (this.browserWindow.webContents.isDestroyed()) {
      return
    }

    const script = enabled
      ? `
        (() => {
          let style = document.getElementById(${JSON.stringify(TAB_PREVIEW_CAPTURE_STYLE_ID)})
          if (!style) {
            style = document.createElement('style')
            style.id = ${JSON.stringify(TAB_PREVIEW_CAPTURE_STYLE_ID)}
            style.textContent = 'html.${TAB_PREVIEW_CAPTURE_CLASS} [data-tab-preview-overlay] { visibility: hidden !important; }'
            document.head.appendChild(style)
          }
          document.documentElement.classList.add(${JSON.stringify(TAB_PREVIEW_CAPTURE_CLASS)})
          // Two frames: the first callback runs before the frame that applies
          // the class is painted, so resolving there can still capture a
          // visible overlay and put one tab's preview inside another's.
          return new Promise(resolve => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))
          })
        })()
      `
      : `document.documentElement.classList.remove(${JSON.stringify(TAB_PREVIEW_CAPTURE_CLASS)})`

    try {
      await this.browserWindow.webContents.executeJavaScript(script, true)
    } catch {
      // The shared renderer may be navigating or shutting down.
    }
  }

  /**
   * @param {string | null} [tabId]
   */
  requestReload(tabId = this.presentedTabId ?? this.activeTabId) {
    if (!tabId || !this.tabs.has(tabId)) {
      return
    }
    this.bridge.send(IpcChannels.TABS_REQUEST_RELOAD, tabId)
  }

  /**
   * Renderer acknowledgement that preparation for a logical reload completed.
   * @param {string | null} [tabId]
   */
  reloadTab(tabId = this.activeTabId) {
    if (!tabId) return

    const tab = this.tabs.get(tabId)
    if (!tab) return

    this._deferredStartupWatchTabIds.delete(tabId)
    tab.mountDeferred = false
    this._startupMountQueue.delete(tabId)
    tab.loadState = 'mounting'
    tab.preloadInBackground = tab.id !== this.activeTabId
    tab.mountRevision += 1
    tab.refreshKey += 1
    this._setTabLoadingSource(tab, TAB_LOADING_SOURCE_MOUNT, true)
    this._broadcastStateUpdate()
  }

  /**
   * @param {string} tabId
   * @param {boolean} [deferMount]
   * @returns {boolean}
   */
  loadTab(tabId, deferMount = false) {
    const tab = this.tabs.get(tabId)
    if (!tab || tab.loadState !== 'unloaded') {
      return false
    }

    this._deferredStartupWatchTabIds.delete(tabId)
    tab.loadState = 'mounting'
    tab.mountDeferred = deferMount
    if (deferMount) this._startupMountQueue.add(tabId)
    tab.preloadInBackground = true
    tab.mountRevision += 1
    this._setTabLoadingSource(tab, TAB_LOADING_SOURCE_MOUNT, true)
    this._broadcastStateUpdate()
    this._saveSession()
    return true
  }

  /**
   * @param {string} tabId
   * @returns {Promise<boolean>}
   */
  async unloadTab(tabId) {
    const tab = this.tabs.get(tabId)
    if (tab?.loadState === 'unloaded' && this._deferredStartupWatchTabIds.delete(tabId)) {
      await this._saveSession()
      return true
    }
    if (!tab || tab.loadState === 'unloaded' || tab.loadState === 'unloading') {
      return false
    }

    if (tab.id === this.presentedTabId && this.tabs.size > 1) {
      if (this._deferredUnloadTabIds.has(tabId)) {
        return true
      }

      await this._refreshTabPreview(tab).catch(error => {
        console.error('Failed to refresh preview before unloading tab:', error)
      })

      // A bulk unload may have already activated and presented the replacement
      // while the preview refresh was in flight. Only defer when this tab is
      // still presented, otherwise no later presentation event would finalize it.
      if (tab.id === this.presentedTabId) {
        const nextTabId = this.activeTabId !== tabId && this.tabs.has(this.activeTabId)
          ? this.activeTabId
          : this._getNeighborTabId(tabId, true)
        if (nextTabId) {
          this._deferredUnloadTabIds.add(tabId)
          this.bridge.send(IpcChannels.TABS_EXIT_FULLSCREEN, tabId)
          if (this.activeTabId === tabId) {
            this.activeTabId = null
            if (this._prepareNeighborActivation(nextTabId)) {
              this.activateTab(nextTabId)
            }
          }
          this._saveSession()
          return true
        }
        return true
      }
    }

    if (tab.id === this.presentedTabId) {
      await this._refreshTabPreview(tab).catch(error => {
        console.error('Failed to refresh preview before unloading tab:', error)
      })
    }

    if (tab.id === this.activeTabId) {
      if (this.tabs.size <= 1) {
        return false
      }

      const nextTabId = this._getNeighborTabId(tabId, true)
      if (!nextTabId) {
        return false
      }

      this.activeTabId = null
      if (this._prepareNeighborActivation(nextTabId)) {
        this.activateTab(nextTabId)
      }
    }

    tab.loadState = 'unloaded'
    tab.mountDeferred = false
    this._startupMountQueue.delete(tabId)
    this._resolveTabMountWaiters(tabId, tab.mountRevision, false)
    tab.preloadInBackground = false
    tab.isPlaying = false
    tab.loadingSources = new Set()
    tab.isLoading = false
    tab.refreshKey += 1
    this._deferredUnloadTabIds.delete(tabId)
    if (this.presentedTabId === tabId) {
      this.presentedTabId = null
    }
    this._broadcastStateUpdate()
    this._saveSession()
    return true
  }

  /**
   * @param {string} tabId
   * @param {number} toIndex
   */
  moveTab(tabId, toIndex) {
    const currentTabIds = Array.from(this.tabs.keys())
    const entries = Array.from(this.tabs.entries())
    const fromIndex = entries.findIndex(([id]) => id === tabId)
    if (fromIndex === -1) return

    const [entry] = entries.splice(fromIndex, 1)
    const [, tab] = entry
    const pinnedCount = entries.filter(([, candidate]) => candidate.isPinned).length
    let targetIndex = Math.max(0, Math.min(toIndex, entries.length))

    if (tab.isPinned) {
      targetIndex = Math.min(targetIndex, pinnedCount)
    } else {
      targetIndex = Math.max(targetIndex, pinnedCount)
    }

    entries.splice(targetIndex, 0, entry)
    this.tabs = new Map(entries)
    if (entries.some(([id], index) => id !== currentTabIds[index])) {
      resetTabPlacementOpeners(this.tabs)
    }
    this._broadcastStateUpdate()
    this._saveSession()
  }

  /**
   * Apply a complete tab order in one state update.
   * @param {string[]} tabIds
   * @param {string | null} requestId
   */
  reorderTabs(tabIds, requestId) {
    this.lastReorderRequestId = requestId
    const reorderedTabs = buildReorderedTabMap(this.tabs, tabIds)
    if (reorderedTabs == null || reorderedTabs === this.tabs) {
      this._broadcastStateUpdate()
      return
    }

    this.tabs = reorderedTabs
    resetTabPlacementOpeners(this.tabs)
    this._broadcastStateUpdate()
    this._saveSession()
  }

  /**
   * Create the main-owned portion of a logical tab for staged recreation in
   * another renderer process. Runtime history/player state cannot be moved as a
   * DOM tree, but all persisted metadata and the cached preview stay intact.
   * @param {string} tabId
   * @returns {object|null}
   */
  createTransferSnapshot(tabId) {
    const tab = this.tabs.get(tabId)
    if (!tab) {
      return null
    }

    return {
      id: tab.id,
      url: tab.url,
      route: cloneRoute(tab.route),
      title: tab.title,
      avatarDataUrl: tab.avatarDataUrl,
      avatarFileName: tab.avatarFileName,
      isPinned: tab.isPinned,
      color: tab.color,
      groupId: tab.groupId,
      group: tab.groupId == null ? null : { ...this.tabGroups.get(tab.groupId) },
      previewDataUrl: tab.previewDataUrl,
      previewCapturedAt: tab.previewCapturedAt,
      previewFileName: tab.previewFileName,
      skipSilence: tab.skipSilence === true,
      syncedNavigationRevision: tab.syncedNavigationRevision
    }
  }

  /**
   * @param {string} tabId
   * @returns {TabInfo|null}
   */
  detachTabForTransfer(tabId) {
    const tab = this.tabs.get(tabId)
    if (!tab) return null

    this._clearTabPreviewRefresh(tab)
    const nextTabId = this.activeTabId === tabId
      ? this._getNeighborTabId(tabId)
      : null

    this.tabs.delete(tabId)
    this._deferredCloseTabIds.delete(tabId)
    this._deferredUnloadTabIds.delete(tabId)
    this._resolveTabMountWaiters(tabId, Number.MAX_SAFE_INTEGER, false)
    if (this.contextMenuTabId === tabId) {
      this.contextMenuTabId = null
    }
    if (this.presentedTabId === tabId) {
      this.presentedTabId = null
    }

    if (nextTabId) {
      this.activeTabId = null
      if (this._prepareNeighborActivation(nextTabId)) {
        this.activateTab(nextTabId)
      }
    } else if (this.activeTabId === tabId) {
      this.activeTabId = null
      this.selectionRevision += 1
      this._broadcastStateUpdate()
      this._saveSession()
    } else {
      this._broadcastStateUpdate()
      this._saveSession()
    }

    return tab
  }

  /**
   * Stage a transferred tab in this window and mount it in the background. The
   * source remains authoritative until the destination acknowledges the mount.
   * @param {object} snapshot
   * @returns {TabInfo}
   */
  adoptTransferredTab(snapshot) {
    if (this.tabs.has(snapshot.id)) {
      throw new Error(`Cannot adopt duplicate tab ID ${snapshot.id}`)
    }

    const groupName = TabManager.normalizeTabGroupName(snapshot.group?.name)
    if (
      typeof snapshot.groupId === 'string' &&
      !this.tabGroups.has(snapshot.groupId) &&
      groupName.length > 0
    ) {
      this.tabGroups.set(snapshot.groupId, {
        id: snapshot.groupId,
        name: groupName,
        color: TabManager.normalizeTabColor(snapshot.group.color),
        icon: normalizeTabGroupIcon(snapshot.group.icon),
        isCollapsed: snapshot.group.isCollapsed === true
      })
    }

    /** @type {TabInfo} */
    const tabInfo = {
      id: snapshot.id,
      url: snapshot.url,
      route: cloneRoute(snapshot.route),
      title: snapshot.title,
      avatarDataUrl: isTabPreviewDataUrl(snapshot.avatarDataUrl) ? snapshot.avatarDataUrl : null,
      avatarFileName: normalizeTabPreviewFileName(snapshot.avatarFileName),
      lastActiveAt: Date.now(),
      isPlaying: false,
      isPinned: snapshot.isPinned === true,
      isLoading: getFixedInternalRouteTitle(snapshot.route.path) === null,
      loadingSources: new Set([TAB_LOADING_SOURCE_MOUNT]),
      color: TabManager.normalizeTabColor(snapshot.color),
      previewDataUrl: snapshot.previewDataUrl ?? null,
      previewCapturedAt: snapshot.previewCapturedAt ?? 0,
      previewFileName: normalizeTabPreviewFileName(snapshot.previewFileName),
      previewCaptureTimeoutId: null,
      previewCapturePromise: null,
      skipSilence: snapshot.skipSilence === true,
      loadState: 'mounting',
      preloadInBackground: true,
      mountRevision: 1,
      refreshKey: 0,
      syncedNavigationRevision: Number.isInteger(snapshot.syncedNavigationRevision)
        ? snapshot.syncedNavigationRevision
        : 0,
      placementOpenerTabId: null,
      groupId: typeof snapshot.groupId === 'string' && this.tabGroups.has(snapshot.groupId)
        ? snapshot.groupId
        : null,
      isTransferStaged: true
    }

    const activeTabIndex = Array.from(this.tabs.keys()).indexOf(this.activeTabId)
    const preferredIndex = activeTabIndex === -1 ? this.tabs.size : activeTabIndex + 1
    this._insertTabEntry(tabInfo.id, tabInfo, preferredIndex)
    this._broadcastStateUpdate()
    return tabInfo
  }

  /**
   * Roll back a destination-side transfer without touching the shared preview
   * file, which is still owned by the source tab.
   * @param {string} tabId
   */
  removeStagedTransferredTab(tabId) {
    const tab = this.tabs.get(tabId)
    if (!tab?.isTransferStaged) {
      return
    }

    this._clearTabPreviewRefresh(tab)
    this.tabs.delete(tabId)
    this._resolveTabMountWaiters(tabId, Number.MAX_SAFE_INTEGER, false)
    if (this.contextMenuTabId === tabId) {
      this.contextMenuTabId = null
    }
    this._broadcastStateUpdate()
  }

  /**
   * @param {string} tabId
   * @param {object} route
   * @param {string | undefined} [url]
   */
  updateTabRoute(tabId, route, url) {
    const tab = this.tabs.get(tabId)
    if (!tab) return

    const nextRoute = normalizeRoute(route)
    if (nextRoute.path !== tab.route.path) {
      const avatarFileName = tab.avatarFileName
      tab.avatarDataUrl = null
      tab.avatarFileName = null
      this._releaseTabAvatarFile(avatarFileName).catch(error => {
        console.error('Failed to delete stale tab avatar:', error)
      })
    }
    tab.route = nextRoute
    tab.url = url || this._urlFromRoute(tab.route)
    this._scheduleTabPreviewRefresh(tab)
    this._saveSession()
    this._broadcastStateUpdate()
  }

  /**
   * Store the renderer-owned back/forward history for persistence with the
   * tab session. A null history clears it (persistence setting disabled).
   * @param {string} tabId
   * @param {object[] | null} history
   * @param {number | null} historyIndex
   * @param {boolean} persistHistory
   */
  updateTabNavigationHistory(tabId, history, historyIndex, persistHistory) {
    const tab = this.tabs.get(tabId)
    if (!tab) return

    const sanitized = TabManager.sanitizeNavigationHistory(history, historyIndex)
    tab.navigationHistory = sanitized?.history ?? null
    tab.navigationHistoryIndex = sanitized?.historyIndex ?? 0
    if (typeof persistHistory === 'boolean') {
      tab.persistNavigationHistory = persistHistory && sanitized != null
    }
    this._saveSession()
  }

  /**
   * @param {string} tabId
   * @param {boolean} isLoading
   */
  setTabLoading(tabId, isLoading) {
    const tab = this.tabs.get(tabId)
    if (tab) {
      this._setTabLoadingSource(tab, TAB_LOADING_SOURCE_RENDERER, isLoading)
      if (tabId === this._startupPriorityTabId) {
        if (isLoading) {
          this._startupPriorityLoadingObserved = true
        } else if (this._startupPriorityLoadingObserved) {
          this._resumeDeferredStartupWatchTabs()
        }
      }
    }
  }

  _resumeDeferredStartupWatchTabs() {
    const tabIds = Array.from(this._deferredStartupWatchTabIds)
    this._deferredStartupWatchTabIds.clear()
    this._startupPriorityTabId = null
    this._startupPriorityLoadingObserved = false

    // Resuming can touch dozens of tabs, so publish one renderer snapshot and
    // one session write rather than waking the shared renderer for every tab.
    this.runBatched(() => {
      for (const tabId of tabIds) {
        this.loadTab(tabId, true)
      }
    }).catch(error => {
      console.error('Failed to resume deferred startup watch tabs:', error)
    })
    this._scheduleStartupMount()
  }

  _scheduleStartupMount() {
    if (
      this._startupMountRunning || this._startupMountTimer != null ||
      this._startupMountQueue.size === 0 || this.browserWindow.isDestroyed()
    ) return

    // Yield between mounts so input and paint can run on slower CPUs. Waiting
    // for mount acknowledgement also prevents a slow page from piling up work.
    this._startupMountTimer = setTimeout(async () => {
      this._startupMountTimer = null
      this._startupMountRunning = true
      try {
        const active = this.tabs.get(this.activeTabId)
        if (active?.loadState === 'mounting') {
          await this.waitForTabMount(active.id, active.mountRevision)
        }
        if (this.browserWindow.isDestroyed()) return

        for (const tabId of this._startupMountQueue) {
          this._startupMountQueue.delete(tabId)
          const tab = this.tabs.get(tabId)
          if (!tab?.mountDeferred || tab.loadState !== 'mounting') continue

          tab.mountDeferred = false
          this._broadcastStateUpdate()
          await this.waitForTabMount(tabId, tab.mountRevision)
          break
        }
      } catch (error) {
        console.error('Failed to mount restored background tab:', error)
      } finally {
        this._startupMountRunning = false
        this._scheduleStartupMount()
      }
    }, STARTUP_TAB_MOUNT_DELAY_MS)
  }

  /**
   * @returns {object}
   */
  /**
   * @param {{ historyForTabIds?: Set<string> | null }} [options]
   *   Which tabs the navigation history should be included for. Defaults to all
   *   of them; pass a set to leave it out for the rest.
   */
  getState({ historyForTabIds = null } = {}) {
    const tabs = Array.from(this.tabs.values()).map(tab => {
      // The renderer only consumes this when it first learns about a tab
      // (e.g. session restore); afterwards it owns the live history. Sending it
      // on every update would serialize each tab's whole history over IPC just
      // for the renderer to discard it.
      const includeHistory = historyForTabIds === null || historyForTabIds.has(tab.id)

      return {
        id: tab.id,
        history: includeHistory ? tab.navigationHistory : undefined,
        historyIndex: includeHistory && tab.navigationHistory != null
          ? tab.navigationHistoryIndex
          : undefined,
        url: tab.url,
        route: cloneRoute(tab.route),
        title: tab.title,
        avatarUrl: tab.avatarDataUrl,
        isActive: tab.id === this.activeTabId,
        isActivatable: this._isTabActivatable(tab),
        isUnloaded: tab.loadState === 'unloaded',
        mountDeferred: tab.mountDeferred === true,
        isLoading: this._getTabLoadingState(tab),
        isPlaying: tab.isPlaying || false,
        skipSilence: tab.skipSilence === true,
        isPinned: tab.isPinned || false,
        color: TabManager.normalizeTabColor(tab.color),
        groupId: tab.groupId,
        loadState: tab.loadState,
        preloadInBackground: tab.preloadInBackground,
        mountRevision: tab.mountRevision,
        refreshKey: tab.refreshKey,
        syncedNavigationRevision: tab.syncedNavigationRevision
      }
    })

    return {
      tabs,
      groups: Array.from(this.tabGroups.values(), group => ({ ...group })),
      closedTabs: this.closedTabs.toReversed().map(tab => ({
        id: tab.id,
        url: tab.url,
        route: cloneRoute(TabManager.getRouteFromUrl(tab.url)),
        title: tab.title ?? TabManager.formatDefaultTabTitle(tab.url),
        isPinned: tab.isPinned === true,
        color: TabManager.normalizeTabColor(tab.color),
        groupId: tab.groupId ?? null
      })),
      activeTabId: this.activeTabId,
      presentedTabId: this.presentedTabId,
      selectionRevision: this.selectionRevision,
      reorderRequestId: this.lastReorderRequestId,
      tabBarScrollPosition: this.tabBarScrollPosition
    }
  }

  /**
   * @returns {import('electron').WebContents|null}
   */
  getActiveWebContents() {
    return this.browserWindow.webContents.isDestroyed() ? null : this.browserWindow.webContents
  }

  /**
   * Run a bulk operation with its state broadcasts and session writes collapsed
   * into a single one, so the renderer re-renders the tab bar and the session
   * file is written once instead of once per tab. Batching is manager-wide, so
   * asynchronous callbacks must stay short to avoid suppressing unrelated state
   * updates until the callback settles.
   * @template T
   * @param {() => T | Promise<T>} run
   * @returns {Promise<T>}
   */
  async runBatched(run) {
    this._batchDepth += 1
    try {
      return await run()
    } finally {
      this._batchDepth -= 1
      if (this._batchDepth === 0) {
        const broadcastPending = this._batchedBroadcastPending
        const sessionSavePending = this._batchedSessionSavePending
        this._batchedBroadcastPending = false
        this._batchedSessionSavePending = false
        if (broadcastPending) {
          this._broadcastStateUpdate()
        }
        if (sessionSavePending) {
          await this._saveSession()
        }
      }
    }
  }

  _broadcastStateUpdate() {
    if (this._batchDepth > 0) {
      this._batchedBroadcastPending = true
      return
    }

    // Queued snapshots get coalesced down to the newest one, so while the
    // renderer is still bootstrapping every snapshot has to carry the history
    // in full — whichever one survives is the one the tabs get created from.
    if (!this.bridge.ready) {
      this._historyAnnouncedTabIds.clear()
      this.bridge.send(IpcChannels.TABS_STATE_UPDATED, this.getState())
      return
    }

    const historyForTabIds = new Set()
    for (const tabId of this.tabs.keys()) {
      if (!this._historyAnnouncedTabIds.has(tabId)) {
        historyForTabIds.add(tabId)
      }
    }

    this.bridge.send(IpcChannels.TABS_STATE_UPDATED, this.getState({ historyForTabIds }))

    for (const tabId of historyForTabIds) {
      this._historyAnnouncedTabIds.add(tabId)
    }
    for (const tabId of this._historyAnnouncedTabIds) {
      if (!this.tabs.has(tabId)) {
        this._historyAnnouncedTabIds.delete(tabId)
      }
    }
  }

  async _saveSession() {
    if (this._sessionPersistenceDisabled) return

    if (this._batchDepth > 0) {
      this._batchedSessionSavePending = true
      return
    }

    this.sessionUpdatedAt = Date.now()

    const tabs = Array.from(this.tabs.values())
      // A presented tab stays mounted until its replacement is ready, but a
      // shutdown during that handoff must not resurrect the already-closed tab.
      .filter(tab => (
        tab.isTransferStaged !== true &&
        !this._deferredCloseTabIds.has(tab.id)
      ))
      .map(tab => {
        const tabData = {
          id: tab.id,
          url: TabManager.stripOneTimeTimestampFromUrl(tab.url),
          title: tab.title,
          isPinned: tab.isPinned,
          color: TabManager.normalizeTabColor(tab.color),
          groupId: tab.groupId,
          skipSilence: tab.skipSilence === true,
          // Startup deferral delays mounting without changing the saved load intent.
          isUnloaded: (tab.loadState === 'unloaded' && !this._deferredStartupWatchTabIds.has(tab.id)) ||
            this._deferredUnloadTabIds.has(tab.id),
          ...(tab.placementOpenerTabId != null && {
            placementOpenerTabId: tab.placementOpenerTabId
          })
        }

        const previewFileName = normalizeTabPreviewFileName(tab.previewFileName)
        if (previewFileName != null && tab.previewCapturedAt > 0) {
          tabData.previewFileName = previewFileName
          tabData.previewCapturedAt = tab.previewCapturedAt
        }

        const avatarFileName = normalizeTabPreviewFileName(tab.avatarFileName)
        if (avatarFileName != null) {
          tabData.avatarFileName = avatarFileName
        }

        if (tab.persistNavigationHistory && tab.navigationHistory != null) {
          tabData.history = tab.navigationHistory
          tabData.historyIndex = tab.navigationHistoryIndex
        }

        return tabData
      })
    const activeTabId = tabs.some(tab => tab.id === this.activeTabId)
      ? this.activeTabId
      : tabs[0]?.id ?? null

    await saveTabSession(this.sessionId, {
      tabs,
      groups: Array.from(this.tabGroups.values(), group => ({ ...group })),
      activeTabId,
      bounds: this._getCurrentBounds(),
      updatedAt: this.sessionUpdatedAt
    })
  }

  /**
   * Return the portable session state used by encrypted sync.
   * @returns {object}
   */
  getSyncSession() {
    const state = this.getState()
    const tabs = state.tabs
      .filter(tab => !this._deferredCloseTabIds.has(tab.id))
      .map(tab => ({
        id: tab.id,
        url: TabManager.stripOneTimeTimestampFromUrl(tab.url),
        title: tab.title,
        isPinned: tab.isPinned,
        color: tab.color,
        groupId: tab.groupId,
        isUnloaded: (tab.isUnloaded && !this._deferredStartupWatchTabIds.has(tab.id)) ||
          this._deferredUnloadTabIds.has(tab.id),
        ...(this.tabs.get(tab.id)?.placementOpenerTabId != null && {
          placementOpenerTabId: this.tabs.get(tab.id).placementOpenerTabId
        }),
        ...(this.tabs.get(tab.id)?.persistNavigationHistory && tab.history != null && {
          history: tab.history,
          historyIndex: tab.historyIndex
        })
      }))
    const activeTabId = tabs.some(tab => tab.id === state.activeTabId)
      ? state.activeTabId
      : tabs[0]?.id ?? null

    return {
      sessionId: this.sessionId,
      tabs,
      groups: Array.from(this.tabGroups.values(), group => ({ ...group })),
      activeTabId,
      updatedAt: this.sessionUpdatedAt
    }
  }

  /**
   * Reconcile this window's live tabs with a synced session.
   * Existing tab objects stay alive so their mounted renderer state is not
   * discarded when another device only adds, removes, or selects a tab.
   * @param {object} sessionData
   * @returns {Promise<boolean>}
   */
  async replaceFromSyncData(sessionData) {
    if (!sessionData || !Array.isArray(sessionData.tabs) || sessionData.tabs.length === 0) {
      return false
    }

    this._sessionPersistenceDisabled = true
    try {
      const restoreNavigationHistory = await TabManager.getStoredRememberTabNavigationHistory()
      this._restoreTabGroups(sessionData.groups)
      const previousTabs = this.tabs
      const syncedTabs = new Map()
      const removedTabs = new Set(previousTabs.values())

      for (const tabData of sessionData.tabs) {
        const syncedId = typeof tabData.id === 'string' && tabData.id.length > 0
          ? tabData.id
          : undefined
        let tab = syncedId == null ? null : previousTabs.get(syncedId)

        if (tab) {
          removedTabs.delete(tab)
          const nextUrl = TabManager.stripOneTimeTimestampFromUrl(tabData.url)
          if (tab.url !== nextUrl) {
            const previewFileName = tab.previewFileName
            const avatarFileName = tab.avatarFileName
            tab.url = nextUrl
            tab.route = TabManager.getRouteFromUrl(nextUrl)
            tab.previewDataUrl = null
            tab.previewCapturedAt = 0
            tab.previewFileName = null
            tab.avatarDataUrl = null
            tab.avatarFileName = null
            const navigationHistory = restoreNavigationHistory
              ? TabManager.sanitizeNavigationHistory(tabData.history, tabData.historyIndex)
              : null
            tab.navigationHistory = navigationHistory?.history ?? null
            tab.navigationHistoryIndex = navigationHistory?.historyIndex ?? 0
            tab.persistNavigationHistory = restoreNavigationHistory && navigationHistory != null
            // The renderer normally ignores main-process route echoes because
            // it owns live navigation. Mark this remote route as authoritative.
            tab.syncedNavigationRevision += 1
            this._historyAnnouncedTabIds.delete(tab.id)
            this._deleteTabPreviewFile(previewFileName).catch(error => {
              console.error('Failed to delete stale synced tab preview:', error)
            })
            this._releaseTabAvatarFile(avatarFileName).catch(error => {
              console.error('Failed to delete stale synced tab avatar:', error)
            })
          }
          if (typeof tabData.title === 'string' && tabData.title.trim().length > 0) {
            tab.title = tabData.title
          }
          tab.isPinned = tabData.isPinned === true
          tab.color = TabManager.normalizeTabColor(tabData.color)
          tab.groupId = typeof tabData.groupId === 'string' && this.tabGroups.has(tabData.groupId)
            ? tabData.groupId
            : null
        } else {
          const hasSavedTitle = typeof tabData.title === 'string' && tabData.title.trim().length > 0
          // createTab inserts into previousTabs through this.tabs. The synced
          // map and restored placement openers below replace that temporary order.
          tab = this.createTab({
            id: syncedId,
            url: TabManager.stripOneTimeTimestampFromUrl(tabData.url),
            title: hasSavedTitle ? tabData.title : undefined,
            isPinned: tabData.isPinned === true,
            color: tabData.color,
            groupId: tabData.groupId,
            history: restoreNavigationHistory ? tabData.history : null,
            historyIndex: restoreNavigationHistory ? tabData.historyIndex : null,
            persistHistory: restoreNavigationHistory,
            makeActive: false,
            openPosition: 'end',
            lazyLoad: tabData.isUnloaded === true,
            preloadInBackground: tabData.isUnloaded === false,
            _deferUpdates: true
          })
        }

        syncedTabs.set(tab.id, tab)
      }

      this.tabs = syncedTabs
      restoreTabPlacementOpeners(this.tabs, sessionData.tabs)

      for (const tab of removedTabs) {
        this._clearTabPreviewRefresh(tab)
        this._resolveTabMountWaiters(tab.id, Number.MAX_SAFE_INTEGER, false)
        if (this.presentedTabId === tab.id) {
          this.presentedTabId = null
        }
        this._deleteTabPreviewFile(tab.previewFileName).catch(error => {
          console.error('Failed to delete remotely closed tab preview:', error)
        })
        this._releaseTabAvatarFile(tab.avatarFileName).catch(error => {
          console.error('Failed to delete remotely closed tab avatar:', error)
        })
      }

      const retainedTabIds = new Set(this.tabs.keys())
      this.selectedTabIds = this.selectedTabIds.filter(tabId => retainedTabIds.has(tabId))
      this.contextMenuSelectedTabIds = this.contextMenuSelectedTabIds.filter(tabId => retainedTabIds.has(tabId))
      if (!retainedTabIds.has(this.contextMenuTabId)) {
        this.contextMenuTabId = null
      }
      this._deferredCloseTabIds.clear()
      this._deferredUnloadTabIds.clear()
      this._deferredStartupWatchTabIds = new Set(
        [...this._deferredStartupWatchTabIds].filter(tabId => retainedTabIds.has(tabId))
      )
      if (!retainedTabIds.has(this._startupPriorityTabId)) {
        this._startupPriorityTabId = null
        this._startupPriorityLoadingObserved = false
      }

      this.sessionId = sessionData.sessionId
      this.sessionUpdatedAt = Number.isFinite(sessionData.updatedAt)
        ? sessionData.updatedAt
        : Date.now()

      const nextActiveTabId = this.tabs.has(sessionData.activeTabId)
        ? sessionData.activeTabId
        : this.tabs.keys().next().value
      if (nextActiveTabId !== this.activeTabId || this.tabs.get(nextActiveTabId)?.loadState === 'unloaded') {
        this.activateTab(nextActiveTabId)
      } else {
        this._setWindowTitle(this.tabs.get(nextActiveTabId).title)
        this._broadcastStateUpdate()
      }

      return this.tabs.size > 0
    } finally {
      this._sessionPersistenceDisabled = false
    }
  }

  _getCurrentBounds() {
    const win = this.browserWindow
    if (!win || win.isDestroyed()) return undefined

    try {
      return {
        ...win.getNormalBounds(),
        maximized: win.isMaximized(),
        fullScreen: win.isFullScreen()
      }
    } catch {
      return undefined
    }
  }

  async clearSession() {
    this._sessionPersistenceDisabled = true
    const clearedTabs = Array.from(this.tabs.values())
      .filter(tab => tab.isTransferStaged !== true)
    await Promise.all([
      ...clearedTabs.map(tab => this._deleteTabPreviewFile(tab.previewFileName)),
      // These tabs are all going away, so none of them counts as a reference
      ...clearedTabs.map(tab => this._releaseTabAvatarFile(
        tab.avatarFileName,
        new Set(clearedTabs)
      ))
    ])
    await clearTabSession(this.sessionId)
  }

  /**
   * @param {{ tabs?: Array<{id?: string, url: string, title?: string, avatarFileName?: string | null, isPinned?: boolean, color?: string | null, skipSilence?: boolean, isUnloaded?: boolean, previewFileName?: string | null, previewCapturedAt?: number, placementOpenerTabId?: string | null, history?: object[], historyIndex?: number}>, activeTabId?: string }} sessionData
   * @param {{ loadInactiveTabs?: boolean, restoreTabLoadState?: boolean, loadLandingPage?: boolean }} [options]
   * @returns {Promise<boolean>}
   */
  async restoreFromData(sessionData, { loadInactiveTabs = false, restoreTabLoadState = false, loadLandingPage = false } = {}) {
    if (!sessionData || !Array.isArray(sessionData.tabs) || sessionData.tabs.length === 0) {
      return false
    }

    if (Number.isFinite(sessionData.updatedAt)) {
      this.sessionUpdatedAt = sessionData.updatedAt
    }

    const preserveUpdatedAt = Number.isFinite(sessionData.updatedAt)
    const persistenceWasDisabled = this._sessionPersistenceDisabled
    if (preserveUpdatedAt) this._sessionPersistenceDisabled = true

    try {
      const restoreNavigationHistory = await TabManager.getStoredRememberTabNavigationHistory()
      this._restoreTabGroups(sessionData.groups)
      const landingRoute = loadLandingPage ? await TabManager.getStoredLandingRoute() : null
      const activeTabData = loadLandingPage
        ? sessionData.tabs.find(tab => TabManager.getRouteFromUrl(tab.url).path === landingRoute)
        : sessionData.tabs.find(tab => tab.id === sessionData.activeTabId)
      const prioritizeActiveWatchTab = activeTabData != null &&
        TabManager.getRouteFromUrl(activeTabData.url).path.startsWith('/watch/')
      const deferredStartupWatchTabIds = new Set()
      const avatars = new Map()
      for (const tabData of sessionData.tabs) {
        const fileName = normalizeTabPreviewFileName(tabData.avatarFileName)
        if (fileName != null && !avatars.has(fileName)) {
          avatars.set(fileName, this._loadTabPreviewDataUrl(fileName))
        }
      }
      await Promise.all([...avatars].map(async ([fileName, data]) => {
        avatars.set(fileName, await data)
      }))

      await this.runBatched(() => {
        for (const tabData of sessionData.tabs) {
          const makeActive = tabData === activeTabData
          const hasSavedTitle = typeof tabData.title === 'string' && tabData.title.trim().length > 0
          const previewFileName = normalizeTabPreviewFileName(tabData.previewFileName)
          const avatarFileName = normalizeTabPreviewFileName(tabData.avatarFileName)
          const avatarDataUrl = avatars.get(avatarFileName) ?? null
          const loadInBackground = !loadLandingPage && (loadInactiveTabs || (restoreTabLoadState && tabData.isUnloaded === false))
          const deferForActiveWatchTab = prioritizeActiveWatchTab &&
            !makeActive &&
            loadInBackground &&
            TabManager.getRouteFromUrl(tabData.url).path.startsWith('/watch/')
          const restoreAsUnloaded = (loadLandingPage && !makeActive) || deferForActiveWatchTab || (!loadInactiveTabs && !makeActive && (
            (restoreTabLoadState && tabData.isUnloaded === true) ||
            (!loadInBackground && hasSavedTitle)
          ))

          const tab = this.createTab({
            id: typeof tabData.id === 'string' ? tabData.id : undefined,
            // Strip here as well to heal sessions persisted before the strip on save existed
            url: TabManager.stripOneTimeTimestampFromUrl(tabData.url),
            title: hasSavedTitle ? tabData.title : undefined,
            avatarDataUrl,
            avatarFileName: avatarDataUrl == null ? null : avatarFileName,
            isPinned: tabData.isPinned === true,
            color: tabData.color,
            groupId: tabData.groupId,
            // Legacy sessions did not persist this field and must retain the old
            // disabled behavior instead of inheriting the new-tab default.
            skipSilence: tabData.skipSilence === true,
            // Preview images are only needed when the switcher asks for them.
            // Keep the cache reference and let getTabPreview load it on demand
            // instead of serially reading every restored tab before first paint.
            previewCapturedAt: previewFileName != null && Number.isFinite(tabData.previewCapturedAt)
              ? tabData.previewCapturedAt
              : 0,
            previewFileName,
            history: restoreNavigationHistory ? tabData.history : null,
            historyIndex: restoreNavigationHistory ? tabData.historyIndex : null,
            persistHistory: restoreNavigationHistory,
            makeActive,
            openPosition: 'end',
            openerTabId: typeof tabData.placementOpenerTabId === 'string'
              ? tabData.placementOpenerTabId
              : null,
            lazyLoad: restoreAsUnloaded,
            _deferMount: !makeActive,
            preloadInBackground: loadInBackground && !makeActive && !deferForActiveWatchTab
          })
          if (deferForActiveWatchTab) {
            deferredStartupWatchTabIds.add(tab.id)
          }
        }

        if (deferredStartupWatchTabIds.size > 0) {
          this._deferredStartupWatchTabIds = deferredStartupWatchTabIds
          this._startupPriorityTabId = this.activeTabId
          this._startupPriorityLoadingObserved = false
        }

        restoreTabPlacementOpeners(this.tabs, sessionData.tabs)

        if (loadLandingPage && !activeTabData) {
          this.createTab({ route: landingRoute, makeActive: true, openPosition: 'end' })
        }

        if (!this.activeTabId) {
          const firstTabId = this.tabs.keys().next().value
          if (firstTabId) {
            this.activateTab(firstTabId)
          }
        }
      })

      return this.tabs.size > 0
    } finally {
      this._sessionPersistenceDisabled = persistenceWasDisabled
    }
  }

  /**
   * @param {string} url
   */
  navigateActiveTabTo(url) {
    if (!this.activeTabId) return
    this.bridge.send(IpcChannels.OPEN_URL, { tabId: this.activeTabId, url })
  }

  /**
   * @param {number} offset
   */
  navigateHistory(offset) {
    const tabId = this.presentedTabId ?? this.activeTabId
    if (!tabId) return
    this.bridge.send(IpcChannels.TABS_GO_HISTORY, { tabId, offset })
  }
}

/**
 * @param {string} route
 * @returns {string}
 */
function normalizeRoutePath(route) {
  if (typeof route !== 'string' || route.trim().length === 0) {
    return '/'
  }
  return route.startsWith('/') ? route : `/${route}`
}

/**
 * @param {object | undefined | null} query
 * @returns {Record<string, string>}
 */
/**
 * Convert URLSearchParams into a plain query object, preserving repeated keys as
 * arrays while keeping single occurrences as scalars.
 * @param {URLSearchParams} searchParams
 * @returns {Record<string, string | string[]>}
 */
function searchParamsToQuery(searchParams) {
  /** @type {Record<string, string | string[]>} */
  const query = {}
  for (const [key, value] of searchParams) {
    if (key in query) {
      const existing = query[key]
      query[key] = Array.isArray(existing) ? [...existing, value] : [existing, value]
    } else {
      query[key] = value
    }
  }
  return query
}

function normalizeQuery(query) {
  if (!query || typeof query !== 'object') {
    return {}
  }

  return Object.fromEntries(
    Object.entries(query)
      .filter(([, value]) => value != null)
      .map(([key, value]) => [key, Array.isArray(value) ? value.map(String) : String(value)])
  )
}

/**
 * @param {object} route
 * @returns {{name: string | null, path: string, params: Record<string, string>, query: Record<string, string>, hash: string, fullPath: string}}
 */
function normalizeRoute(route) {
  const path = normalizeRoutePath(route?.path)
  const query = normalizeQuery(route?.query)
  const hash = typeof route?.hash === 'string' ? route.hash : ''
  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      searchParams.append(key, item)
    }
  }
  const search = searchParams.toString()
  return {
    name: typeof route?.name === 'string' ? route.name : null,
    path,
    params: normalizeQuery(route?.params),
    query,
    hash,
    fullPath: `${path}${search.length > 0 ? `?${search}` : ''}${hash}`
  }
}

/**
 * @param {ReturnType<typeof normalizeRoute>} route
 * @returns {ReturnType<typeof normalizeRoute>}
 */
function cloneRoute(route) {
  return normalizeRoute(route)
}

/**
 * @param {object} [options]
 * @param {(browserWindow: import('electron').BrowserWindow) => boolean | Promise<boolean>} [options.confirmCloseWindow]
 * @param {(manager: TabManager, count: number, action: 'close' | 'load' | 'unload') => boolean | Promise<boolean>} [options.confirmMultipleTabsAction]
 * @param {(browserWindow: import('electron').BrowserWindow) => void} [options.markWindowCloseConfirmed]
 * @param {(manager: TabManager, state: object) => void} [options.mediaSessionStateChanged]
 */
export async function setupTabsIPC(options = {}) {
  const {
    confirmCloseWindow = () => true,
    confirmMultipleTabsAction = () => true,
    markWindowCloseConfirmed = () => {},
    mediaSessionStateChanged = () => {}
  } = options

  // Load synchronous tab-lifecycle preferences before the first window exists.
  await Promise.all([
    TabManager.refreshStoredTabCloseFocus(),
    TabManager.refreshStoredSkipSilenceSettings()
  ])

  const getManager = event => TabManager.getFromWebContents(event.sender)

  ipcMain.on(IpcChannels.TABS_RENDERER_READY, (event) => {
    getManager(event)?.markRendererReady()
  })

  ipcMain.handle(IpcChannels.TABS_GET_STATE, (event) => {
    return getManager(event)?.getState() ?? null
  })

  ipcMain.handle(IpcChannels.TABS_GET_SYNC_SESSIONS, () => {
    return Array.from(tabManagers.values(), manager => manager.getSyncSession())
  })

  ipcMain.handle(IpcChannels.TABS_APPLY_SYNC_SESSIONS, async (event, sessions) => {
    const manager = getManager(event)
    if (!manager || !Array.isArray(sessions) || sessions.length === 0) return false

    const validSessions = sessions.filter(session => (
      session &&
      typeof session.sessionId === 'string' &&
      session.sessionId.length > 0 &&
      Array.isArray(session.tabs) &&
      session.tabs.length > 0 &&
      session.tabs.every(tab => tab && typeof tab.url === 'string')
    ))
    if (validSessions.length === 0) return false

    const liveManagers = Array.from(tabManagers.values())
    const remaining = new Map(validSessions.map(session => [session.sessionId, session]))
    const assignments = new Map()

    for (const liveManager of liveManagers) {
      const matching = remaining.get(liveManager.sessionId)
      if (matching) {
        assignments.set(liveManager, matching)
        remaining.delete(liveManager.sessionId)
      }
    }
    if (!assignments.has(manager) && remaining.size > 0) {
      const first = remaining.values().next().value
      assignments.set(manager, first)
      remaining.delete(first.sessionId)
    }

    for (const [liveManager, session] of assignments) {
      await liveManager.replaceFromSyncData(session)
    }
    const localBounds = new Map(Array.from(assignments, ([liveManager, session]) => (
      [session.sessionId, liveManager._getCurrentBounds()]
    )))
    await replaceAllTabSessions(validSessions.map(session => ({
      ...session,
      ...(localBounds.get(session.sessionId) && {
        bounds: localBounds.get(session.sessionId)
      })
    })))
    return true
  })

  ipcMain.handle(IpcChannels.TABS_CREATE, async (event, options) => {
    const manager = getManager(event)
    if (!manager) return null

    const {
      inheritColorFromOpener = false,
      openerTabId,
      // Never let a renderer choose the internal tab id; it is always generated.
      id,
      // Silence skipping starts from the main-owned default, not renderer input.
      skipSilence,
      // Restored tabs alone may choose their previous position.
      _preferredIndex,
      ...tabOptions
    } = options != null && typeof options === 'object' ? options : {}

    const resolvedOpenerTabId = typeof openerTabId === 'string'
      ? openerTabId
      : manager.presentedTabId ?? manager.activeTabId
    const tab = inheritColorFromOpener === true
      ? await manager.createTabWithPreferenceFromOpener(tabOptions, resolvedOpenerTabId)
      : await manager.createTabWithPreference({ ...tabOptions, openerTabId: resolvedOpenerTabId })

    return {
      id: tab.id,
      url: tab.url,
      route: cloneRoute(tab.route),
      title: tab.title,
      isPinned: tab.isPinned,
      color: tab.color
    }
  })

  ipcMain.on(IpcChannels.TABS_ACTIVATE, (event, tabId) => {
    const manager = getManager(event)
    if (manager && typeof tabId === 'string') {
      manager.activateTab(tabId)
    }
  })

  ipcMain.on(IpcChannels.TABS_SET_SELECTED, (event, tabIds) => {
    const manager = getManager(event)
    if (!manager) return

    manager.selectedTabIds = Array.isArray(tabIds)
      ? Array.from(new Set(tabIds.filter(tabId => {
          return typeof tabId === 'string' && manager.tabs.has(tabId)
        })))
      : []
  })

  ipcMain.handle(IpcChannels.TABS_IS_ACTIVE, (event, tabId) => {
    const manager = getManager(event)
    if (!manager) return false
    return typeof tabId === 'string' ? manager.activeTabId === tabId : manager.activeTabId != null
  })

  ipcMain.handle(IpcChannels.TABS_CLOSE, async (event, tabId) => {
    const manager = getManager(event)
    if (manager && typeof tabId === 'string') {
      if (manager.tabs.size === 1 && !await confirmCloseWindow(manager.browserWindow)) {
        return { hasRemainingTabs: true }
      }

      const hasRemainingTabs = manager.closeTab(tabId)
      if (!hasRemainingTabs) {
        markWindowCloseConfirmed(manager.browserWindow)
        manager.browserWindow.close()
      }
      return { hasRemainingTabs }
    }
    return { hasRemainingTabs: false }
  })

  ipcMain.handle(IpcChannels.TABS_CLOSE_MULTIPLE, async (event, tabIds) => {
    const manager = getManager(event)
    if (!manager || !Array.isArray(tabIds)) {
      return { hasRemainingTabs: false }
    }

    const closingTabIds = tabIds.filter(tabId => typeof tabId === 'string' && manager.tabs.has(tabId))
    if (closingTabIds.length === 0) {
      return { hasRemainingTabs: manager.tabs.size > 0 }
    }

    if (
      closingTabIds.length === manager.tabs.size &&
      !await confirmCloseWindow(manager.browserWindow)
    ) {
      return { hasRemainingTabs: true }
    }

    let hasRemainingTabs
    try {
      hasRemainingTabs = await manager.closeTabs(closingTabIds)
    } catch (error) {
      console.error('Failed to close tabs:', error)
      hasRemainingTabs = manager.tabs.size > 0
    }
    if (!hasRemainingTabs) {
      markWindowCloseConfirmed(manager.browserWindow)
      manager.browserWindow.close()
    }
    return { hasRemainingTabs }
  })

  ipcMain.handle(IpcChannels.TABS_DUPLICATE, (event, tabId) => {
    const manager = getManager(event)
    const tab = manager && typeof tabId === 'string' ? manager.duplicateTab(tabId) : null
    return tab
      ? { id: tab.id, url: tab.url, route: cloneRoute(tab.route), title: tab.title, isPinned: tab.isPinned, color: tab.color }
      : null
  })

  ipcMain.on(IpcChannels.TABS_MOVE, (event, tabId, toIndex) => {
    const manager = getManager(event)
    if (manager && typeof tabId === 'string' && typeof toIndex === 'number') {
      manager.moveTab(tabId, toIndex)
    }
  })

  ipcMain.on(IpcChannels.TABS_REORDER, (event, tabIds, requestId) => {
    const manager = getManager(event)
    const normalizedTabIds = Array.isArray(tabIds) ? Array.from(tabIds) : null
    if (
      manager &&
      normalizedTabIds?.every(tabId => typeof tabId === 'string') &&
      (requestId === null || typeof requestId === 'string')
    ) {
      manager.reorderTabs(normalizedTabIds, requestId)
    }
  })

  ipcMain.on(IpcChannels.TABS_SET_PINNED, (event, tabId, isPinned) => {
    const manager = getManager(event)
    if (manager && typeof tabId === 'string') {
      manager.setTabPinned(tabId, isPinned === true)
    }
  })

  ipcMain.on(IpcChannels.TABS_SET_COLOR, (event, tabId, color) => {
    const manager = getManager(event)
    if (manager && typeof tabId === 'string') {
      manager.setTabColor(tabId, color)
    }
  })

  ipcMain.handle(IpcChannels.TABS_CREATE_GROUP, (event, group) => {
    return getManager(event)?.createTabGroup(group) ?? null
  })

  ipcMain.handle(IpcChannels.TABS_UPDATE_GROUP, (event, groupId, changes) => {
    const manager = getManager(event)
    return manager != null && typeof groupId === 'string'
      ? manager.updateTabGroup(groupId, changes)
      : false
  })

  ipcMain.handle(IpcChannels.TABS_DELETE_GROUP, (event, groupId) => {
    const manager = getManager(event)
    return manager != null && typeof groupId === 'string'
      ? manager.deleteTabGroup(groupId)
      : false
  })

  ipcMain.handle(IpcChannels.TABS_SET_GROUP, (event, tabIds, groupId) => {
    const manager = getManager(event)
    if (!manager || !Array.isArray(tabIds) || (groupId !== null && typeof groupId !== 'string')) {
      return 0
    }
    return manager.setTabsGroup(tabIds.filter(tabId => typeof tabId === 'string'), groupId)
  })

  ipcMain.handle(IpcChannels.TABS_RUN_ORGANIZER_ACTION, async (event, action, tabIds) => {
    const manager = getManager(event)
    if (!manager || !['close', 'load', 'unload'].includes(action) || !Array.isArray(tabIds)) {
      return { success: false, hasRemainingTabs: manager?.tabs.size > 0 }
    }

    const uniqueTabIds = Array.from(new Set(tabIds.filter(tabId => (
      typeof tabId === 'string' && manager.tabs.has(tabId)
    ))))
    const actionableTabIds = action === 'load'
      ? uniqueTabIds.filter(tabId => manager.tabs.get(tabId)?.loadState === 'unloaded')
      : action === 'unload'
        ? uniqueTabIds.filter(tabId => !['unloaded', 'unloading'].includes(manager.tabs.get(tabId)?.loadState))
        : uniqueTabIds
    if (actionableTabIds.length === 0) {
      return { success: true, hasRemainingTabs: manager.tabs.size > 0 }
    }
    if (!await confirmMultipleTabsAction(manager, actionableTabIds.length, action)) {
      return { success: false, hasRemainingTabs: manager.tabs.size > 0 }
    }

    if (action === 'load') {
      await manager.runBatched(() => {
        for (const tabId of actionableTabIds) manager.loadTab(tabId)
      })
      return { success: true, hasRemainingTabs: true }
    }
    if (action === 'unload') {
      await manager.unloadTabs(actionableTabIds)
      return { success: true, hasRemainingTabs: true }
    }

    if (actionableTabIds.length === manager.tabs.size && !await confirmCloseWindow(manager.browserWindow)) {
      return { success: false, hasRemainingTabs: true }
    }
    const hasRemainingTabs = await manager.closeTabs(actionableTabIds)
    if (!hasRemainingTabs) {
      markWindowCloseConfirmed(manager.browserWindow)
      manager.browserWindow.close()
    }
    return { success: true, hasRemainingTabs }
  })

  ipcMain.handle(IpcChannels.TABS_GET_MOVE_TARGETS, (event) => {
    const manager = getManager(event)
    return manager ? TabManager.listMoveTargets(manager.browserWindow.id) : []
  })

  ipcMain.handle(IpcChannels.TABS_MOVE_TO_WINDOW, async (event, tabIds, targetWindowId) => {
    const manager = getManager(event)
    if (!manager || !Array.isArray(tabIds) || !Number.isInteger(targetWindowId)) return 0

    let moved = 0
    for (const tabId of new Set(tabIds)) {
      if (typeof tabId === 'string' && manager.tabs.has(tabId) && await TabManager.moveTabToWindow(tabId, targetWindowId)) {
        moved += 1
      }
    }
    return moved
  })

  ipcMain.handle(IpcChannels.TABS_CAPTURE_PREVIEW, (event, tabId) => {
    const manager = getManager(event)
    return manager && typeof tabId === 'string' ? manager.captureTabPreview(tabId) : null
  })

  ipcMain.handle(IpcChannels.TABS_GET_CACHED_PREVIEWS, (event, tabIds) => {
    const manager = getManager(event)
    if (!manager) {
      return {}
    }

    const validTabIds = Array.isArray(tabIds)
      ? tabIds.filter(tabId => typeof tabId === 'string' && manager.tabs.has(tabId))
      : []
    return manager.getCachedTabPreviews(validTabIds)
  })

  ipcMain.on(IpcChannels.TABS_SET_PREVIEWS_ENABLED, (event, enabled) => {
    const manager = getManager(event)
    manager?.setTabPreviewsEnabled(enabled === true).catch(error => {
      console.error('Failed to update tab previews:', error)
    })
  })

  ipcMain.on(IpcChannels.TABS_SET_PREVIEW_CAPTURE_PAUSED, (event, paused) => {
    const manager = getManager(event)
    manager?.setPreviewCapturePaused(paused === true)
  })

  ipcMain.on(IpcChannels.TABS_REQUEST_PREVIEW_REFRESH, (event, options = {}) => {
    const manager = getManager(event)
    const tabId = typeof options?.tabId === 'string' ? options.tabId : null
    const tab = tabId ? manager?.tabs.get(tabId) : null
    if (!manager || !tab) {
      return
    }

    const delayMs = Number.isFinite(options.delayMs)
      ? Math.max(0, Math.min(5000, options.delayMs))
      : TAB_PREVIEW_REFRESH_DELAY_MS
    manager._scheduleTabPreviewRefresh(tab, delayMs)
  })

  ipcMain.handle(IpcChannels.TABS_RESTORE_CLOSED, async (event, closedTabId = null) => {
    const manager = getManager(event)
    const tab = await manager?.restoreClosedTab(typeof closedTabId === 'string' ? closedTabId : null)
    return tab
      ? { id: tab.id, url: tab.url, route: cloneRoute(tab.route), title: tab.title, isPinned: tab.isPinned, color: tab.color }
      : null
  })

  ipcMain.handle(IpcChannels.TABS_CLEAR_CLOSED, (event) => {
    return getManager(event)?.clearClosedTabs() ?? false
  })

  ipcMain.on(IpcChannels.TABS_RELOAD, (event, tabId) => {
    const manager = getManager(event)
    if (manager && typeof tabId === 'string') {
      manager.reloadTab(tabId)
    }
  })

  ipcMain.on(IpcChannels.TABS_UPDATE_TITLE, (event, title, tabId) => {
    const manager = getManager(event)
    const tab = typeof tabId === 'string' ? manager?.tabs.get(tabId) : null
    if (manager && tab && typeof title === 'string') {
      manager.applyTabTitle(tab, title)
    }
  })

  ipcMain.handle(IpcChannels.TABS_UPDATE_AVATAR, async (event, avatarBytes, tabId, routePath) => {
    const manager = getManager(event)
    const tab = typeof tabId === 'string' ? manager?.tabs.get(tabId) : null
    if (manager && tab && typeof routePath === 'string') {
      return await manager.applyTabAvatar(tab, avatarBytes, routePath)
    }
    return false
  })

  ipcMain.on(IpcChannels.TABS_SET_AVATARS_ENABLED, (event, enabled) => {
    const manager = getManager(event)
    manager?.setTabAvatarsEnabled(enabled === true).catch(error => {
      console.error('Failed to update tab avatar caching:', error)
    })
  })

  ipcMain.on(IpcChannels.TABS_UPDATE_ROUTE, (event, payload) => {
    const manager = getManager(event)
    if (
      manager &&
      typeof payload?.tabId === 'string' &&
      typeof payload?.route?.path === 'string'
    ) {
      manager.updateTabRoute(payload.tabId, payload.route, payload.url)
    }
  })

  ipcMain.on(IpcChannels.TABS_UPDATE_NAV_HISTORY, (event, payload) => {
    const manager = getManager(event)
    if (manager && typeof payload?.tabId === 'string') {
      manager.updateTabNavigationHistory(
        payload.tabId,
        payload.history,
        payload.historyIndex,
        payload.persistHistory
      )
    }
  })

  ipcMain.on(IpcChannels.TABS_SET_TAB_BAR_SCROLL, (event, position) => {
    const manager = getManager(event)
    if (manager && typeof position === 'number') {
      manager.tabBarScrollPosition = position
    }
  })

  ipcMain.on(IpcChannels.TABS_SET_CONTEXT_MENU_TAB, (event, payload) => {
    const manager = getManager(event)
    if (!manager) return

    manager.contextMenuTabId = typeof payload?.tabId === 'string' && manager.tabs.has(payload.tabId)
      ? payload.tabId
      : null
    manager.contextMenuSelectedTabIds = Array.isArray(payload?.selectedTabIds)
      ? Array.from(new Set(payload.selectedTabIds.filter(tabId => {
          return typeof tabId === 'string' && manager.tabs.has(tabId)
        })))
      : []
    if (
      manager.contextMenuTabId &&
      !manager.contextMenuSelectedTabIds.includes(manager.contextMenuTabId)
    ) {
      manager.contextMenuSelectedTabIds = [manager.contextMenuTabId]
    }
    manager.contextMenuSurface = ['tab', 'tabBar', 'content', 'subscriptionFeedTab'].includes(payload?.surface)
      ? payload.surface
      : payload?.isTabBar === true ? 'tabBar' : 'content'
    manager.contextMenuSubscriptionFeedTab = manager.contextMenuSurface === 'subscriptionFeedTab' &&
      ['videos', 'shorts', 'live', 'posts', 'all'].includes(payload?.feedTab)
      ? payload.feedTab
      : null
    manager.contextMenuSubscriptionNewFeedTab = manager.contextMenuSubscriptionFeedTab !== null &&
      payload?.isNewFeedTab === true
    manager.contextMenuSubscriptionNewFeedHasContent = manager.contextMenuSubscriptionNewFeedTab &&
      payload?.hasNewContent === true
    manager.contextMenuTabBarVertical = payload?.verticalLayout === true
  })

  ipcMain.on(IpcChannels.TABS_SET_PLAYBACK_STATE, (event, playbackState, tabId) => {
    const manager = getManager(event)
    const tab = typeof tabId === 'string' ? manager?.tabs.get(tabId) : null
    if (manager && tab && typeof playbackState === 'string') {
      tab.isPlaying = playbackState === 'playing'
      manager._broadcastStateUpdate()
    }
  })

  ipcMain.on(IpcChannels.TABS_SET_MEDIA_SESSION_STATE, (event, state) => {
    const manager = getManager(event)
    if (manager && state && typeof state === 'object') {
      mediaSessionStateChanged(manager, state)
    }
  })

  ipcMain.on(IpcChannels.TABS_SET_SKIP_SILENCE, (event, enabled, tabId) => {
    const manager = getManager(event)
    const tab = typeof tabId === 'string' ? manager?.tabs.get(tabId) : null
    const skipSilence = enabled === true
    if (tab && tab.skipSilence !== skipSilence) {
      tab.skipSilence = skipSilence
      manager._broadcastStateUpdate()
      manager._saveSession()
    }
  })

  ipcMain.on(IpcChannels.TABS_SET_LOADING, (event, isLoading, tabId) => {
    const manager = getManager(event)
    if (manager && typeof tabId === 'string') {
      manager.setTabLoading(tabId, isLoading === true)
    }
  })

  ipcMain.on(IpcChannels.TABS_MOUNT_READY, (event, payload) => {
    const manager = getManager(event)
    if (manager && typeof payload?.tabId === 'string' && Number.isInteger(payload?.mountRevision)) {
      manager.markTabMounted(payload.tabId, payload.mountRevision)
    }
  })

  ipcMain.on(IpcChannels.TABS_MOUNT_FAILED, (event, payload) => {
    const manager = getManager(event)
    if (manager && typeof payload?.tabId === 'string' && Number.isInteger(payload?.mountRevision)) {
      manager.markTabMountFailed(payload.tabId, payload.mountRevision)
    }
  })

  ipcMain.on(IpcChannels.TABS_PRESENTED, (event, payload) => {
    const manager = getManager(event)
    if (manager && typeof payload?.tabId === 'string' && Number.isInteger(payload?.selectionRevision)) {
      manager.markTabPresented(payload.tabId, payload.selectionRevision)
    }
  })

  ipcMain.handle(IpcChannels.TABS_REQUEST_PICTURE_IN_PICTURE, async (event, tabId) => {
    const manager = getManager(event)
    if (
      !manager ||
      typeof tabId !== 'string' ||
      !manager.tabs.has(tabId) ||
      manager._deferredCloseTabIds.has(tabId) ||
      manager._deferredUnloadTabIds.has(tabId)
    ) {
      return false
    }

    return manager.browserWindow.webContents.executeJavaScript(`
      (async () => {
        const root = Array.from(document.querySelectorAll('.tabContent[data-tab-id]'))
          .find(element => element.dataset.tabId === ${JSON.stringify(tabId)})
        const detachedPlayer = Array.from(document.querySelectorAll('.ftVideoPlayer[data-tab-id]'))
          .find(element => element.dataset.tabId === ${JSON.stringify(tabId)})
        const target = root?.querySelector('video.player') ?? detachedPlayer?.querySelector('video.player')
        if (!target?.ui?.getControls) return false

        if (document.pictureInPictureElement && document.pictureInPictureElement !== target) {
          try { await document.exitPictureInPicture() } catch {}
        }

        target.ui.getControls().togglePiP()
        return true
      })()
    `, true)
  })

  ipcMain.handle(IpcChannels.TABS_REQUEST_FULLSCREEN, (event, tabId) => {
    const manager = getManager(event)
    if (!manager || typeof tabId !== 'string' || !manager.tabs.has(tabId)) {
      return false
    }

    return manager.browserWindow.webContents.executeJavaScript(`
      Array.from(document.querySelectorAll('.tabContent[data-tab-id]'))
        .find(element => element.dataset.tabId === ${JSON.stringify(tabId)})
        ?.querySelector('video.player')
        ?.ui?.getControls?.().toggleFullScreen()
    `, true)
  })
}

export default TabManager
