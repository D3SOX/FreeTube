import {
  app, BrowserWindow, dialog, Menu, ipcMain,
  powerSaveBlocker, screen, session,
  nativeTheme, net, protocol, clipboard,
  shell, Tray, Notification
} from 'electron'
import './applicationDataBootstrap'
import { isPortableBuild } from './applicationDataPaths'
import path from 'path'
import cp from 'child_process'
import { randomUUID } from 'crypto'
import { load as loadYaml } from 'js-yaml'
import { getFonts } from 'font-list'

import {
  IpcChannels,
  DBActions,
  SyncEvents,
  PlaylistVideoAddResult,
  getConfiguredKeyboardShortcuts,
  getElectronAccelerator,
  SEARCH_CHAR_LIMIT,
  MULTIPLE_TABS_CONFIRM_THRESHOLD,
  LIGHT_BASE_THEMES,
  DARK_BASE_THEMES,
  DOWNLOADED_MEDIA_MIME_TYPES,
} from '../constants'
import {
  CUSTOM_THEMES_DIRECTORY,
  customThemeIdFromValue,
  customThemeValue,
  isCustomThemeValue,
  normalizeCustomTheme,
  normalizeCustomThemes,
} from '../customTheme'
import { resolveSystemTheme, resolveSystemThemeSettings } from '../appearanceSettings'
import { applySyncServerUserAgent } from '../syncServerUserAgent'
import * as baseHandlers from '../datastores/handlers/base'
import { liveReminders } from '../datastores'
import { extractExpiryTimestamp, ImageCache } from './ImageCache'
import { constants as fsConstants, existsSync } from 'fs'
import { createReadStream } from 'node:fs'
import asyncFs from 'fs/promises'
import { promisify } from 'util'
import { Readable } from 'node:stream'
import { hostname, release } from 'node:os'
import { brotliDecompress } from 'zlib'

import packageDetails from '../../package.json'
import { handleOpenInExternalPlayer } from './externalPlayer'
import { getYtDlpDownloadFile, handleYtDlpCancelDownload, handleYtDlpCheckBinaryUpdate, handleYtDlpClearDownloads, handleYtDlpControlDownload, handleYtDlpDownload, handleYtDlpDownloadBinary, handleYtDlpGetInfo, handleYtDlpGetSubtitle, handleYtDlpGetPlaybackInfo, handleYtDlpGetRecommendations, handleYtDlpListDownloads, handleYtDlpOpenDownload, handleYtDlpQueueAction, handleYtDlpRemoveDownload, refreshYtDlpDownloadQueue, restoreYtDlpDownloadQueue, shutdownYtDlpDownloads } from './ytDlp'
import { applyYtDlpPlaybackCacheSettings, handleYtDlpPlaybackCacheClear, handleYtDlpPlaybackCacheDelete, handleYtDlpPlaybackCacheGet, handleYtDlpPlaybackCacheSet } from './ytDlpPlaybackCache'
import { generatePoToken } from './poTokenGenerator'
import { expandMultipleOnlyPluralMessages, selectPluralForm } from '../renderer/i18n/plurals'
import { composeLocaleMessages } from '../localeComposition'
import { appendYouTubeTimeZonePreference, buildProxyUrl, DEFAULT_PROXY_SETTINGS, isNonPublicNetworkAddress, isOpenTubeXUrl } from './utils'
import { isInvidiousInstanceUrl } from './invidiousAuthorization'
import { TabManager, setupTabsIPC } from './tabs/TabManager'
import { clearAllTabSessions, loadAllTabSessions } from './tabs/TabSessionStore'
import { isShareableOpenTubeXRoute, transformOpenTubeXRouteUrl } from '../renderer/helpers/share'
import {
  buildSearchUrl,
  DEFAULT_SEARCH_ENGINES_SETTING,
  getFaviconUrl,
  parseSearchEngines
} from '../searchEngines'
import { fetchFaviconDataUrl, resolveFaviconUrl } from './favicon'
import { LiveReminderManager } from './LiveReminderManager'
import { requestVoiceOverTranslation } from './voiceOverTranslation'
import { clearVideoMetadataCache, getVideoMetadataCacheSize, updateVideoMetadataCache } from './videoMetadataCache'
import { shouldAdvanceDockMediaSequence } from './dockMediaSession'
import { clearStorage, compactStorageDatabases, getStorageUsage } from './storage'
import { getLinuxDistributionInfo } from './linuxDistribution'
import {
  createKdeWaylandWindowStateBackend,
  isWaylandPlatform as detectWaylandPlatform,
  monitorKdeWaylandWindowState,
  shouldMonitorKdeWaylandWindowState,
} from './kdeWaylandWindowState'
import { supportsNativeNotifications } from './nativeNotifications'

const brotliDecompressAsync = promisify(brotliDecompress)
if (process.argv.includes('--version')) {
  console.log(`v${packageDetails.version} Beta`) // eslint-disable-line no-console
  app.exit()
} else if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp()
  app.exit()
} else {
  // Only allow single instance of the application
  // Exit if we didn't get the lock, because another instance already has it
  if (process.env.NODE_ENV !== 'development' && !app.requestSingleInstanceLock()) {
    app.exit()
  } else {
    baseHandlers.loadDatastores()
    runApp()
  }
}

function printHelp() {
  // eslint-disable-next-line no-console
  console.log(`\
usage: ${process.argv0} [options...] [url]
Options:
  --help, -h           show this message, then exit
  --version            print the current version, then exit
  --new-window         reuse an existing instance if possible`)
}

function runApp() {
  /** @type {Set<string>} */
  const ALLOWED_RENDERER_FILES = process.env.NODE_ENV === 'production'
    // __FREETUBE_ALLOWED_PATHS__ is replaced by the injectAllowedPaths.mjs script
    ? new Set(__FREETUBE_ALLOWED_PATHS__)
    : new Set()

  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'imagecache',
      privileges: {
        secure: true,
        corsEnabled: true
      }
    },
    {
      scheme: 'downloadmedia',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true
      }
    },
    ...(process.env.NODE_ENV === 'production'
      ? [{
          scheme: 'app',
          privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true
          }
        }]
      : []),
  ])

  const devServerPort = process.env.OPENTUBEX_DEV_SERVER_PORT ?? '9080'
  const ROOT_APP_URL = process.env.NODE_ENV === 'development' ? `http://localhost:${devServerPort}` : 'app://bundle/index.html'
  const CUSTOM_THEMES_PATH = path.join(app.getPath('userData'), CUSTOM_THEMES_DIRECTORY)

  const dockMediaSessions = new Map()
  const dockMediaTrackedWindowIds = new Set()
  let dockMediaPlaySequence = 0
  let dockMediaLabels = {
    previous: 'Previous',
    play: 'Play',
    pause: 'Pause',
    next: 'Next',
    newWindow: 'New Window'
  }

  function getDockMediaSession() {
    const sessions = Array.from(dockMediaSessions.values())
      .filter(({ manager }) => !manager.browserWindow.isDestroyed())
    const playingSessions = sessions.filter(({ playbackState }) => playbackState === 'playing')

    if (playingSessions.length > 0) {
      return playingSessions.reduce((latest, session) => (
        session.lastPlayedAt > latest.lastPlayedAt ? session : latest
      ))
    }

    const focusedSession = sessions.find(({ manager, hasMetadata }) => (
      hasMetadata && manager.browserWindow.isFocused()
    ))
    if (focusedSession) {
      return focusedSession
    }

    return sessions
      .filter(({ hasMetadata }) => hasMetadata)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null
  }

  function requestDockMediaAction(action) {
    const session = getDockMediaSession()
    if (!session || !session.actions.has(action)) {
      return
    }
    session.manager.bridge.send(IpcChannels.TABS_REQUEST_MEDIA_SESSION_ACTION, action)
  }

  function updateDockMenu() {
    if (process.platform !== 'darwin' || !app.dock) {
      return
    }

    const session = getDockMediaSession()
    const actions = session?.actions ?? new Set()
    const toggleAction = session?.playbackState === 'playing' ? 'pause' : 'play'
    const dockMenu = Menu.buildFromTemplate([
      {
        label: dockMediaLabels.previous,
        enabled: actions.has('previoustrack'),
        click: () => requestDockMediaAction('previoustrack')
      },
      {
        label: session?.playbackState === 'playing'
          ? dockMediaLabels.pause
          : dockMediaLabels.play,
        enabled: actions.has(toggleAction),
        click: () => requestDockMediaAction(toggleAction)
      },
      {
        label: dockMediaLabels.next,
        enabled: actions.has('nexttrack'),
        click: () => requestDockMediaAction('nexttrack')
      },
      { type: 'separator' },
      {
        label: dockMediaLabels.newWindow,
        click: () => {
          createWindow({
            replaceMainWindow: false,
            showWindowNow: true
          })
        }
      }
    ])
    app.dock.setMenu(dockMenu)
  }

  function updateDockMediaSession(manager, state) {
    const windowId = manager.browserWindow.id
    const previous = dockMediaSessions.get(windowId)
    const playbackState = ['playing', 'paused', 'none'].includes(state.playbackState)
      ? state.playbackState
      : 'none'
    const shouldAdvanceSequence = shouldAdvanceDockMediaSequence(
      playbackState,
      state.playbackStarted
    )
    dockMediaSessions.set(windowId, {
      manager,
      playbackState,
      hasMetadata: state.hasMetadata === true,
      actions: new Set(Array.isArray(state.actions) ? state.actions : []),
      lastPlayedAt: shouldAdvanceSequence
        ? ++dockMediaPlaySequence
        : previous?.lastPlayedAt ?? 0,
      updatedAt: Date.now()
    })

    if (!dockMediaTrackedWindowIds.has(windowId)) {
      dockMediaTrackedWindowIds.add(windowId)
      manager.browserWindow.on('focus', updateDockMenu)
      manager.browserWindow.once('closed', () => {
        dockMediaSessions.delete(windowId)
        dockMediaTrackedWindowIds.delete(windowId)
        updateDockMenu()
      })
    }
    updateDockMenu()
  }

  function getCustomThemePath(id) {
    if (!/^[\w-]{1,80}$/.test(id)) throw new TypeError('Invalid custom theme ID')
    return path.join(CUSTOM_THEMES_PATH, `${id}.json`)
  }

  async function writeCustomThemeFile(theme) {
    const themePath = getCustomThemePath(theme.id)
    const temporaryPath = `${themePath}.${randomUUID()}.tmp`
    await asyncFs.writeFile(temporaryPath, `${JSON.stringify(theme, null, 2)}\n`, 'utf8')
    await asyncFs.rename(temporaryPath, themePath)
  }

  async function loadCustomThemes() {
    await asyncFs.mkdir(CUSTOM_THEMES_PATH, { recursive: true })
    const entries = await asyncFs.readdir(CUSTOM_THEMES_PATH, { withFileTypes: true })
    const themes = []
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || path.extname(entry.name) !== '.json') continue
      try {
        themes.push(normalizeCustomTheme(
          JSON.parse(await asyncFs.readFile(path.join(CUSTOM_THEMES_PATH, entry.name), 'utf8'))
        ))
      } catch (error) {
        console.error(`Failed to load custom theme ${entry.name}:`, error)
      }
    }
    return themes.sort((left, right) =>
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
  }

  async function saveCustomTheme(theme) {
    getCustomThemePath(theme?.id)
    const normalizedTheme = normalizeCustomTheme(theme)
    await asyncFs.mkdir(CUSTOM_THEMES_PATH, { recursive: true })
    await writeCustomThemeFile(normalizedTheme)
    return await loadCustomThemes()
  }

  async function deleteCustomTheme(id) {
    await asyncFs.unlink(getCustomThemePath(id))
    return await loadCustomThemes()
  }

  async function replaceCustomThemes(themes) {
    const normalizedThemes = normalizeCustomThemes(themes)
    const themeIds = new Set()
    for (const theme of normalizedThemes) {
      if (themeIds.has(theme.id)) throw new TypeError(`Duplicate custom theme ID: ${theme.id}`)
      themeIds.add(theme.id)
    }

    await asyncFs.mkdir(CUSTOM_THEMES_PATH, { recursive: true })
    await Promise.all(normalizedThemes.map(writeCustomThemeFile))

    const entries = await asyncFs.readdir(CUSTOM_THEMES_PATH, { withFileTypes: true })
    await Promise.all(entries.map(async entry => {
      if (!entry.isFile() || path.extname(entry.name) !== '.json') return
      const id = path.basename(entry.name, '.json')
      if (!themeIds.has(id)) await asyncFs.unlink(path.join(CUSTOM_THEMES_PATH, entry.name))
    }))

    return await loadCustomThemes()
  }

  async function publishCustomThemes(themes) {
    const selectedTheme = (await baseHandlers.settings._findOne('baseTheme'))?.value
    const selectedCustomTheme = isCustomThemeValue(selectedTheme)
      ? themes.find(({ id }) => id === customThemeIdFromValue(selectedTheme)) ?? themes[0]
      : null
    if (selectedCustomTheme) {
      nativeTheme.themeSource = selectedCustomTheme.isDark ? 'dark' : 'light'
    }
    BrowserWindow.getAllWindows().forEach((window) => {
      if (isOpenTubeXUrl(window.webContents.getURL())) {
        window.webContents.send(IpcChannels.CUSTOM_THEME_UPDATED, themes)
      }
    })
  }

  async function getSelectedCustomTheme(value) {
    const id = customThemeIdFromValue(value)
    const themes = await loadCustomThemes()
    return id === null ? themes[0] ?? null : themes.find(theme => theme.id === id) ?? null
  }

  let backendPreference = 'local'
  let backendFallback = true
  const DEFAULT_CONFIRM_CLOSE_APP = true
  const DEFAULT_CONFIRM_CLOSE_WINDOW_WITH_MULTIPLE_TABS = true
  const MULTIPLE_TABS_CONFIRMATION_SETTING_KEYS = {
    close: 'confirmCloseMultipleTabs',
    load: 'confirmLoadMultipleTabs',
    unload: 'confirmUnloadMultipleTabs'
  }
  const DEFAULT_STARTUP_BEHAVIOR = 'loadLastActiveTab'
  const VALID_STARTUP_BEHAVIORS = new Set([
    'loadAllTabs',
    'restoreTabLoadState',
    'loadLastActiveTab',
    'emptySession'
  ])
  const closeConfirmedWindowIds = new Set()
  const closingWindowIds = new Set()
  const appShortcutBlockedWindows = new WeakSet()
  let quitPromptInProgress = null
  const windowClosePromptsInProgress = new Map()
  let isQuitConfirmed = false
  /** @type {{ webContents: import('electron').WebContents, tabId: string } | null} */
  let subscriptionAutoRefreshOwner = null
  let subscriptionAutoRefreshProgress = 0
  /** @type {Promise<{ exitCode: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string }> | null} */
  let ipBlockRecoveryScriptPromise = null
  const faviconPromises = new Map()

  /**
   * @returns {Promise<ReturnType<typeof parseSearchEngines>>}
   */
  async function getConfiguredSearchEngines() {
    const setting = (await baseHandlers.settings._findOne('contextMenuSearchEngines'))?.value ??
      DEFAULT_SEARCH_ENGINES_SETTING
    return parseSearchEngines(setting)
  }

  /**
   * @param {string} searchUrl
   * @returns {Promise<string>}
   */
  function resolveSearchEngineFavicon(searchUrl) {
    const fallback = getFaviconUrl(searchUrl)
    if (!fallback) return Promise.resolve('')

    const origin = new URL(fallback).origin
    if (!faviconPromises.has(origin)) {
      const promise = process.env.OPENTUBEX_E2E_USER_DATA_DIR
        ? Promise.resolve(fallback)
        : resolveFaviconUrl(searchUrl, (url, options) => net.fetch(url, options))
            .then(icon => fetchFaviconDataUrl(icon, (url, options) => net.fetch(url, options)))
      faviconPromises.set(origin, promise)
    }

    return faviconPromises.get(origin)
  }

  /**
   * @param {string} url
   * @returns {string | null}
   */
  function getOpenTubeXRouteFromUrl(url) {
    const parsed = URL.parse(url)

    if (!parsed || !isOpenTubeXUrl(parsed)) {
      return null
    }

    if (!parsed.hash) {
      return '/'
    }

    const route = parsed.hash.startsWith('#')
      ? parsed.hash.slice(1)
      : parsed.hash

    return route || '/'
  }

  async function getStartupBehavior() {
    try {
      const value = (await baseHandlers.settings._findOne('startupBehavior'))?.value
      return VALID_STARTUP_BEHAVIORS.has(value) ? value : DEFAULT_STARTUP_BEHAVIOR
    } catch (error) {
      console.error('Failed to load startup behavior preference:', error)
      return DEFAULT_STARTUP_BEHAVIOR
    }
  }

  async function getConfirmCloseApp() {
    try {
      const value = (await baseHandlers.settings._findOne('confirmCloseApp'))?.value
      return typeof value === 'boolean' ? value : DEFAULT_CONFIRM_CLOSE_APP
    } catch (error) {
      console.error('Failed to load close confirmation preference:', error)
      return DEFAULT_CONFIRM_CLOSE_APP
    }
  }

  async function getConfirmCloseWindowWithMultipleTabs() {
    try {
      const value = (await baseHandlers.settings._findOne('confirmCloseWindowWithMultipleTabs'))?.value
      return typeof value === 'boolean' ? value : DEFAULT_CONFIRM_CLOSE_WINDOW_WITH_MULTIPLE_TABS
    } catch (error) {
      console.error('Failed to load window close confirmation preference:', error)
      return DEFAULT_CONFIRM_CLOSE_WINDOW_WITH_MULTIPLE_TABS
    }
  }

  /**
   * @param {'close' | 'load' | 'unload'} action
   * @returns {Promise<boolean>}
   */
  async function getConfirmMultipleTabsAction(action) {
    const settingKey = MULTIPLE_TABS_CONFIRMATION_SETTING_KEYS[action]
    try {
      const value = (await baseHandlers.settings._findOne(settingKey))?.value
      return typeof value === 'boolean' ? value : true
    } catch (error) {
      console.error(`Failed to load ${action} tabs confirmation preference:`, error)
      return true
    }
  }

  /**
   * Persist a setting changed by a native main-process prompt and update every
   * open renderer so its Settings UI remains accurate.
   * @param {string} settingKey
   * @param {unknown} value
   * @param {unknown} [expectedValue] Only repair a value that has not changed.
   */
  async function updateSettingFromMain(settingKey, value, expectedValue) {
    if (expectedValue !== undefined) {
      if (!await baseHandlers.settings._updateIfUnchanged(settingKey, expectedValue, value)) return
    } else {
      await baseHandlers.settings.upsert(settingKey, value)
    }
    const syncPayload = {
      event: SyncEvents.GENERAL.UPSERT,
      data: { _id: settingKey, value }
    }
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.webContents.isDestroyed() && isOpenTubeXUrl(window.webContents.getURL())) {
        window.webContents.send(IpcChannels.SYNC_SETTINGS, syncPayload)
      }
    }
  }

  async function repairSystemThemeSettingsFromMain(themes) {
    const [systemLightTheme, systemDarkTheme] = await Promise.all([
      baseHandlers.settings._findOne('systemLightTheme'),
      baseHandlers.settings._findOne('systemDarkTheme')
    ])
    const currentSettings = {
      systemLightTheme: systemLightTheme?.value ?? 'light',
      systemDarkTheme: systemDarkTheme?.value ?? 'dark',
    }
    const resolvedSettings = resolveSystemThemeSettings(currentSettings, themes)

    await Promise.all(Object.entries(resolvedSettings).map(([key, value]) => (
      value === currentSettings[key] ? null : updateSettingFromMain(key, value, currentSettings[key])
    )))
  }

  /**
   * @param {string} key
   * @param {Record<string, unknown>} messages
   * @returns {string | undefined}
   */
  function getLocaleMessage(key, messages) {
    const value = key.split('.').reduce((current, segment) => {
      return current != null && typeof current === 'object' ? current[segment] : undefined
    }, messages)

    return typeof value === 'string' ? value : undefined
  }

  /**
   * @param {string} locale
   * @param {'human' | 'ai'} source
   * @returns {Promise<Record<string, unknown>>}
   */
  async function loadLocaleMessages(locale, source = 'human') {
    const directory = source === 'ai' ? 'locales/ai' : 'locales'
    const localePath = process.env.NODE_ENV === 'development'
      ? path.resolve(__dirname, `../../static/${directory}`, `${locale}.yaml`)
      : path.resolve(__dirname, `static/${directory}`, `${locale}.json.br`)

    if (process.env.NODE_ENV === 'development') {
      const contents = await asyncFs.readFile(localePath, 'utf8')
      return loadYaml(contents)
    }

    const contents = await asyncFs.readFile(localePath)
    const decompressed = await brotliDecompressAsync(contents)
    return JSON.parse(decompressed.toString('utf8'))
  }

  /**
   * @returns {Promise<(key: string, parameters?: Record<string, string | number>, pluralChoice?: number) => string>}
   */
  async function createMainTranslator() {
    const fallbackLocale = 'en-US'
    const storedLocale = (await baseHandlers.settings._findOne('currentLocale'))?.value
    const storedAITranslationPreference = (await baseHandlers.settings._findOne('useAITranslationCompletions'))?.value
    const useAITranslationCompletions = storedAITranslationPreference == null
      ? true
      : storedAITranslationPreference === true
    const currentLocale = typeof storedLocale === 'string' && storedLocale !== 'system'
      ? storedLocale
      : app.getLocale().replace('_', '-')

    const baseLocale = currentLocale.split('-')[0]
    const candidateLocales = [...new Set([currentLocale, baseLocale, fallbackLocale].filter(Boolean))]
    const humanMessages = new Map()
    const aiMessages = new Map()

    for (const locale of candidateLocales) {
      try {
        humanMessages.set(locale, await loadLocaleMessages(locale))
      } catch (error) {
        if (locale === fallbackLocale) {
          console.error('Failed to load fallback locale for close confirmation dialog:', error)
        }
      }
    }

    if (useAITranslationCompletions) {
      for (const locale of [currentLocale, baseLocale]) {
        if (!locale || aiMessages.has(locale)) continue
        try {
          aiMessages.set(locale, await loadLocaleMessages(locale, 'ai'))
        } catch {
          // Complete locales do not have an AI overlay.
        }
      }
    }

    const messagesByLocale = []
    const currentMessages = composeLocaleMessages({
      locale: currentLocale,
      humanMessages,
      aiMessages,
      includeAI: useAITranslationCompletions,
    })
    if (Object.keys(currentMessages).length > 0) {
      messagesByLocale.push({
        locale: currentLocale,
        messages: expandMultipleOnlyPluralMessages(currentLocale, currentMessages),
      })
    }

    if (currentLocale !== fallbackLocale && humanMessages.has(fallbackLocale)) {
      messagesByLocale.push({
        locale: fallbackLocale,
        messages: expandMultipleOnlyPluralMessages(fallbackLocale, humanMessages.get(fallbackLocale)),
      })
    }

    return (key, parameters = {}, pluralChoice) => {
      for (const { locale, messages } of messagesByLocale) {
        const message = getLocaleMessage(key, messages)
        if (message) {
          const selectedMessage = pluralChoice == null
            ? message
            : selectPluralForm(locale, message, pluralChoice)

          if (selectedMessage == null) continue

          return Object.entries(parameters).reduce(
            (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
            selectedMessage
          )
        }
      }

      return key
    }
  }

  /**
   * @param {import('electron').BrowserWindow | null | undefined} browserWindow
   * @returns {Promise<boolean>}
   */
  async function confirmCloseApp(browserWindow) {
    if (isQuitting || isQuitConfirmed || !await getConfirmCloseApp()) {
      return true
    }

    if (quitPromptInProgress) {
      return quitPromptInProgress
    }

    quitPromptInProgress = (async () => {
      const t = await createMainTranslator()
      const { response } = await dialog.showMessageBox(browserWindow ?? undefined, {
        type: 'question',
        title: t('Close Confirmation.Title'),
        message: t('Close Confirmation.Message'),
        detail: t('Confirmations.Settings Hint'),
        buttons: [
          t('Close Confirmation.Quit'),
          t('Cancel'),
          t('Close Confirmation.Never Ask Again')
        ],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      })

      if (response === 2) {
        try {
          await updateSettingFromMain('confirmCloseApp', false)
        } catch (error) {
          console.error('Failed to disable the app close confirmation:', error)
        }
        isQuitConfirmed = true
        return true
      }

      if (response === 0) {
        isQuitConfirmed = true
        return true
      }

      return false
    })().finally(() => {
      quitPromptInProgress = null
    })

    return quitPromptInProgress
  }

  /**
   * @param {import('electron').BrowserWindow} browserWindow
   * @param {number} count
   * @returns {Promise<boolean>}
   */
  async function confirmCloseWindowWithMultipleTabs(browserWindow, count) {
    if (isQuitting || !await getConfirmCloseWindowWithMultipleTabs()) {
      return true
    }

    const existingPrompt = windowClosePromptsInProgress.get(browserWindow.id)
    if (existingPrompt) return existingPrompt

    const prompt = (async () => {
      const t = await createMainTranslator()
      const { response } = await dialog.showMessageBox(browserWindow, {
        type: 'question',
        title: t('Close Window Confirmation.Title'),
        message: t('Close Window Confirmation.Message', { count }, count),
        detail: t('Confirmations.Settings Hint'),
        buttons: [
          t('Close Window Confirmation.Close Window'),
          t('Cancel'),
          t('Confirmations.Never Ask Again')
        ],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      })

      if (response === 2) {
        try {
          await updateSettingFromMain('confirmCloseWindowWithMultipleTabs', false)
        } catch (error) {
          console.error('Failed to disable the multi-tab window close confirmation:', error)
        }
        return true
      }

      return response === 0
    })().finally(() => {
      windowClosePromptsInProgress.delete(browserWindow.id)
    })

    windowClosePromptsInProgress.set(browserWindow.id, prompt)
    return prompt
  }

  let multipleTabsActionRequestCount = 0

  /**
   * Ask the renderer to confirm a bulk tab action.
   * @param {TabManager | null | undefined} manager
   * @param {number} count the number of tabs affected
   * @param {'close' | 'load' | 'unload'} action
   * @returns {Promise<boolean>}
   */
  async function confirmMultipleTabsAction(manager, count, action) {
    if (count < MULTIPLE_TABS_CONFIRM_THRESHOLD || !await getConfirmMultipleTabsAction(action)) {
      return true
    }

    const browserWindow = manager?.browserWindow
    if (!browserWindow || browserWindow.isDestroyed()) {
      return true
    }

    const requestId = `${action}-multiple-tabs-${++multipleTabsActionRequestCount}`
    return new Promise(resolve => {
      /**
       * @param {import('electron').IpcMainEvent} _event
       * @param {{ requestId?: string, confirmed?: boolean }} response
       */
      const listener = (_event, response) => {
        if (response?.requestId !== requestId) return

        finish(response.confirmed === true)
      }

      const handleWindowClosed = () => finish(false)

      /**
       * @param {boolean} confirmed
       */
      function finish(confirmed) {
        clearTimeout(timeoutId)
        ipcMain.removeListener(IpcChannels.TABS_CONFIRM_MULTIPLE_ACTION_RESPONSE, listener)
        browserWindow.removeListener('closed', handleWindowClosed)
        resolve(confirmed)
      }

      const timeoutId = setTimeout(() => finish(false), 30_000)
      ipcMain.on(IpcChannels.TABS_CONFIRM_MULTIPLE_ACTION_RESPONSE, listener)
      browserWindow.once('closed', handleWindowClosed)
      manager.bridge.send(IpcChannels.TABS_CONFIRM_MULTIPLE_ACTION, { requestId, count, action })
    })
  }

  // Becomes true once the user asks the app to quit (e.g. Ctrl+Q / "Quit" menu
  // item / last-window-closed on non-darwin). Window close handlers use this to
  // decide whether their persisted tab session record should be kept (so the
  // window is restored on the next launch) or cleared (so a window that was
  // manually closed while the app keeps running is forgotten).
  let isQuitting = false

  // Registered per-webContents in 'web-contents-created' so the shared
  // BrowserWindow renderer can resolve native menu targets through TabManager.
  const sharedContextMenuLabelKeys = {
    Blue: 'Settings.Theme Settings.Main Color Theme.Blue',
    'Close Tab': 'Close Tab',
    Copy: 'Copy',
    Cut: 'Cut',
    Green: 'Settings.Theme Settings.Main Color Theme.Green',
    'Mark All as Seen': 'Subscriptions.Mark All as Seen',
    'New Tab': 'New Tab',
    'New Window': 'New Window',
    Orange: 'Settings.Theme Settings.Main Color Theme.Orange',
    Paste: 'Paste',
    Pink: 'Settings.Theme Settings.Main Color Theme.Pink',
    Red: 'Settings.Theme Settings.Main Color Theme.Red',
    Ungrouped: 'Tab Organizer.Ungrouped',
    Yellow: 'Settings.Theme Settings.Main Color Theme.Yellow'
  }

  /**
   * @param {string} key
   * @param {Record<string, string | number>} [parameters]
   * @param {string} [fallback]
   * @returns {{ key: string, parameters: Record<string, string | number>, fallback: string }}
   */
  function contextMenuLabel(key, parameters = {}, fallback = key) {
    return {
      key: sharedContextMenuLabelKeys[key] ?? `Context Menu.${key}`,
      parameters,
      fallback
    }
  }

  // Keep the interpolated selection short, so that the surrounding translated text
  // (e.g. the trailing "in a New Tab") stays readable instead of being cut off
  const SELECTION_LABEL_MAX_LENGTH = 30

  // Counting grapheme clusters rather than UTF-16 code units, so that the cut
  // never lands inside an emoji or a combining character sequence
  const selectionLabelSegmenter = new Intl.Segmenter()

  /**
   * @param {string} text
   */
  function truncateSelectionForLabel(text) {
    const graphemes = []
    for (const { segment } of selectionLabelSegmenter.segment(text)) {
      if (graphemes.length === SELECTION_LABEL_MAX_LENGTH) {
        return `${graphemes.join('').trimEnd()}…`
      }
      graphemes.push(segment)
    }

    return text
  }

  /** @type {Record<string, Function | boolean>} */
  const contextMenuOptions = {
    showSearchWithGoogle: false,
    showSaveImageAs: true,
    showCopyImageAddress: true,
    showSelectAll: false,
    showCopyLink: false,
    prepend: (defaultActions, parameters, webContents) => {
      const manager = TabManager.getFromWebContents(webContents)
      const contextMenuTab = manager?.contextMenuTabId != null
        ? manager.tabs.get(manager.contextMenuTabId)
        : undefined
      const contextMenuTabs = contextMenuTab && manager
        ? (manager.contextMenuSelectedTabIds.length > 0
            ? manager.contextMenuSelectedTabIds
            : [contextMenuTab.id])
            .map(tabId => manager.tabs.get(tabId))
            .filter(Boolean)
        : []
      const isBulkTabAction = contextMenuTabs.length > 1
      const isContextMenuTabUnloaded = contextMenuTab?.loadState === 'unloaded'
      const isTabBarContextMenu = contextMenuTab != null || manager?.contextMenuSurface === 'tabBar'
      const subscriptionFeedTab = manager?.contextMenuSurface === 'subscriptionFeedTab'
        ? manager.contextMenuSubscriptionFeedTab
        : null
      const isSubscriptionNewFeedTab = subscriptionFeedTab != null &&
        manager?.contextMenuSubscriptionNewFeedTab === true
      const subscriptionFeedLabelKeys = {
        videos: 'Reload Videos',
        shorts: 'Reload Shorts',
        live: 'Reload Live',
        posts: 'Reload Posts',
        all: 'Reload All Feeds'
      }
      const contextMenuTabYouTubeUrls = contextMenuTabs.map(tab => {
        const route = tab.route?.fullPath ?? getOpenTubeXRouteFromUrl(tab.url)
        return isShareableOpenTubeXRoute(route)
          ? transformOpenTubeXRouteUrl(route, true)
          : null
      })
      const pageUrl = parameters.pageURL || ''
      const isInAppUrl = isOpenTubeXUrl(pageUrl) && parameters.linkURL.split('#')[0] === pageUrl.split('#')[0]

      const moveTargets = contextMenuTab != null && manager != null
        ? TabManager.listMoveTargets(manager.browserWindow.id)
        : []
      const contextMenuTabIds = contextMenuTab != null && manager != null
        ? Array.from(manager.tabs.keys())
        : []
      const contextMenuTabIndex = contextMenuTabIds.indexOf(contextMenuTab?.id)
      const selectedTabIndexes = contextMenuTabs
        .map(tab => contextMenuTabIds.indexOf(tab.id))
        .filter(index => index !== -1)
      const firstSelectedTabIndex = selectedTabIndexes.length > 0
        ? Math.min(...selectedTabIndexes)
        : contextMenuTabIndex
      const lastSelectedTabIndex = selectedTabIndexes.length > 0
        ? Math.max(...selectedTabIndexes)
        : contextMenuTabIndex
      const allSelectedTabsPinned = contextMenuTabs.every(tab => tab.isPinned === true)
      const selectedTabIdSet = new Set(contextMenuTabs.map(tab => tab.id))
      const canMoveContextMenuTabsTo = (toEnd) => {
        return [true, false].some(isPinned => {
          const groupIds = Array.from(manager?.tabs.values() ?? [])
            .filter(tab => tab.isPinned === isPinned)
            .map(tab => tab.id)
          const selectedGroupIds = groupIds.filter(tabId => selectedTabIdSet.has(tabId))
          if (selectedGroupIds.length === 0) return false

          const destinationIds = toEnd
            ? groupIds.slice(-selectedGroupIds.length)
            : groupIds.slice(0, selectedGroupIds.length)
          return destinationIds.some((tabId, index) => tabId !== selectedGroupIds[index])
        })
      }
      const canMoveContextMenuTabsToBeginning = canMoveContextMenuTabsTo(false)
      const canMoveContextMenuTabsToEnd = canMoveContextMenuTabsTo(true)
      const selectedTabColor = contextMenuTabs.every(tab => tab.color === contextMenuTabs[0]?.color)
        ? contextMenuTabs[0]?.color ?? null
        : undefined
      const selectedTabGroupId = contextMenuTabs.length > 0 &&
        contextMenuTabs.every(tab => tab.groupId === contextMenuTabs[0].groupId)
        ? contextMenuTabs[0].groupId ?? null
        : undefined
      const tabGroups = Array.from(manager?.tabGroups.values() ?? [])
      const selectedTabGroup = typeof selectedTabGroupId === 'string'
        ? manager?.tabGroups.get(selectedTabGroupId)
        : null
      const hasSelectedUnloadedTab = contextMenuTabs.some(tab => tab.loadState === 'unloaded')
      const hasSelectedLoadedTab = contextMenuTabs.some(tab => !['unloaded', 'unloading'].includes(tab.loadState))
      /**
       * Apply a bulk tab action as one renderer update instead of one per tab.
       * @param {() => void} run
       */
      const runBatchedTabAction = (run) => {
        manager?.runBatched(run).catch(error => {
          console.error('Failed to apply a bulk tab action:', error)
        })
      }
      const closeContextMenuTabs = async (tabIds) => {
        if (!manager) return

        const existingTabIds = tabIds.filter(tabId => manager.tabs.has(tabId))
        if (existingTabIds.length === 0) return

        const isLastWindow = BrowserWindow.getAllWindows().length === 1
        const closesWindow = existingTabIds.length === manager.tabs.size
        if (closesWindow && isLastWindow) {
          // The quit confirmation already covers this case
          if (!await confirmCloseApp(manager.browserWindow)) return
        } else if (!await confirmMultipleTabsAction(manager, existingTabIds.length, 'close')) {
          return
        }

        const hasRemainingTabs = await manager.closeTabs(existingTabIds)
        if (!hasRemainingTabs) {
          if (isLastWindow) closeConfirmedWindowIds.add(manager.browserWindow.id)
          manager.browserWindow.close()
        }
      }

      return [
        {
          // While a refresh runs, the same entry cancels it
          label: contextMenuLabel(subscriptionFeedLabelKeys[subscriptionFeedTab] ?? 'Reload Videos'),
          refreshingLabel: contextMenuLabel('Cancel Refresh'),
          visible: subscriptionFeedTab != null,
          click: () => {
            if (!manager || !subscriptionFeedTab) return

            if (isSubscriptionAutoRefreshInProgress()) {
              requestSubscriptionAutoRefreshCancellation()
              return
            }

            if (!manager.presentedTabId) return

            manager.bridge.send(IpcChannels.SUBSCRIPTION_FEED_REQUEST_RELOAD, {
              tabId: manager.presentedTabId,
              feedTab: subscriptionFeedTab
            })
          }
        },
        {
          label: contextMenuLabel('Mark All as Seen'),
          visible: isSubscriptionNewFeedTab &&
            manager?.contextMenuSubscriptionNewFeedHasContent === true,
          click: () => {
            if (!manager?.presentedTabId || !subscriptionFeedTab || subscriptionFeedTab === 'all') {
              return
            }

            manager.bridge.send(IpcChannels.SUBSCRIPTION_FEED_REQUEST_MARK_SEEN, {
              tabId: manager.presentedTabId,
              feedTab: subscriptionFeedTab
            })
          }
        },
        {
          type: 'separator',
          visible: subscriptionFeedTab != null
        },
        {
          label: isBulkTabAction
            ? contextMenuLabel(
                'Close Multiple Tabs',
                { count: contextMenuTabs.length },
                `Close ${contextMenuTabs.length} Tabs`
              )
            : contextMenuLabel('Close Tab'),
          visible: contextMenuTab != null,
          click: async () => {
            if (!manager || !contextMenuTab) return

            await closeContextMenuTabs(contextMenuTabs.map(tab => tab.id))
          }
        },
        {
          label: isBulkTabAction
            ? contextMenuLabel(
                'Duplicate Multiple Tabs',
                { count: contextMenuTabs.length },
                `Duplicate ${contextMenuTabs.length} Tabs`
              )
            : contextMenuLabel('Duplicate Tab'),
          visible: contextMenuTab != null,
          click: () => {
            if (!manager || !contextMenuTab) return

            runBatchedTabAction(() => {
              for (const tab of contextMenuTabs) manager.duplicateTab(tab.id)
            })
          }
        },
        {
          label: contextMenuLabel(isBulkTabAction ? 'Move Tabs' : 'Move Tab'),
          visible: contextMenuTab != null,
          submenu: [
            {
              label: contextMenuLabel('To Beginning'),
              enabled: canMoveContextMenuTabsToBeginning,
              click: () => {
                if (!manager || !contextMenuTab) return

                if (isBulkTabAction) {
                  runBatchedTabAction(() => {
                    for (const tab of [...contextMenuTabs].reverse()) {
                      manager.moveTab(tab.id, 0)
                    }
                  })
                } else {
                  manager.moveTab(contextMenuTab.id, 0)
                }
              }
            },
            {
              label: contextMenuLabel('To End'),
              enabled: canMoveContextMenuTabsToEnd,
              click: () => {
                if (!manager || !contextMenuTab) return

                if (isBulkTabAction) {
                  runBatchedTabAction(() => {
                    for (const tab of contextMenuTabs) {
                      manager.moveTab(tab.id, manager.tabs.size)
                    }
                  })
                } else {
                  manager.moveTab(contextMenuTab.id, manager.tabs.size)
                }
              }
            }
          ]
        },
        {
          label: contextMenuLabel(isBulkTabAction ? 'Move Tabs to Group' : 'Move Tab to Group'),
          visible: contextMenuTab != null,
          submenu: [
            {
              label: contextMenuLabel('Ungrouped'),
              type: 'radio',
              checked: selectedTabGroupId === null,
              click: () => {
                manager?.setTabsGroup(contextMenuTabs.map(tab => tab.id), null)
              }
            },
            ...tabGroups.map(group => ({
              label: group.name,
              type: 'radio',
              groupColor: group.color ?? 'default',
              checked: selectedTabGroupId === group.id,
              click: () => {
                manager?.setTabsGroup(contextMenuTabs.map(tab => tab.id), group.id)
              }
            })),
            { type: 'separator' },
            {
              label: contextMenuLabel('Manage Tab Groups…'),
              click: () => {
                manager?.bridge.send(IpcChannels.TABS_OPEN_ORGANIZER)
              }
            }
          ]
        },
        {
          label: contextMenuLabel('Collapse Group'),
          visible: contextMenuTab != null && selectedTabGroup != null && !selectedTabGroup.isCollapsed,
          click: () => {
            manager?.updateTabGroup(selectedTabGroup.id, { isCollapsed: true })
          }
        },
        {
          type: 'separator',
          visible: contextMenuTab != null
        },
        {
          label: contextMenuLabel('Close Tabs'),
          visible: contextMenuTab != null,
          submenu: [
            {
              label: contextMenuLabel(manager?.contextMenuTabBarVertical ? 'To the Top' : 'To the Left'),
              enabled: firstSelectedTabIndex > 0,
              click: () => {
                closeContextMenuTabs(contextMenuTabIds.slice(0, firstSelectedTabIndex))
              }
            },
            {
              label: contextMenuLabel(manager?.contextMenuTabBarVertical ? 'To the Bottom' : 'To the Right'),
              enabled: lastSelectedTabIndex < contextMenuTabIds.length - 1,
              click: () => {
                closeContextMenuTabs(contextMenuTabIds.slice(lastSelectedTabIndex + 1))
              }
            },
            {
              label: contextMenuLabel('Other Tabs'),
              enabled: contextMenuTabIds.length > contextMenuTabs.length,
              click: () => {
                const selectedIds = new Set(contextMenuTabs.map(tab => tab.id))
                closeContextMenuTabs(contextMenuTabIds.filter(tabId => !selectedIds.has(tabId)))
              }
            }
          ]
        },
        {
          type: 'separator',
          visible: contextMenuTab != null
        },
        {
          label: contextMenuLabel(isBulkTabAction ? 'Copy YouTube Links' : 'Copy YouTube Link'),
          visible: contextMenuTabYouTubeUrls.length > 0 && contextMenuTabYouTubeUrls.every(Boolean),
          click: () => {
            if (!contextMenuTabYouTubeUrls.every(Boolean)) return

            clipboard.writeText(contextMenuTabYouTubeUrls.join('\n'))
          }
        },
        {
          type: 'separator',
          visible: contextMenuTabYouTubeUrls.length > 0 && contextMenuTabYouTubeUrls.every(Boolean)
        },
        {
          label: contextMenuLabel(allSelectedTabsPinned
            ? isBulkTabAction ? 'Unpin Tabs' : 'Unpin Tab'
            : isBulkTabAction ? 'Pin Tabs' : 'Pin Tab'),
          visible: contextMenuTab != null,
          click: () => {
            if (!manager || !contextMenuTab) return

            runBatchedTabAction(() => {
              for (const tab of contextMenuTabs) {
                manager.setTabPinned(tab.id, !allSelectedTabsPinned)
              }
            })
          }
        },
        {
          label: contextMenuLabel('Tab Color'),
          visible: contextMenuTab != null,
          submenu: [
            { key: 'Default', color: null },
            { key: 'Red', color: 'red' },
            { key: 'Orange', color: 'orange' },
            { key: 'Yellow', color: 'yellow' },
            { key: 'Green', color: 'green' },
            { key: 'Blue', color: 'blue' },
            { key: 'Purple', color: 'purple' },
            { key: 'Pink', color: 'pink' }
          ].map(({ key, color }) => ({
            label: contextMenuLabel(key),
            type: 'radio',
            checked: selectedTabColor === color,
            click: () => {
              if (!manager || !contextMenuTab) return

              runBatchedTabAction(() => {
                for (const tab of contextMenuTabs) manager.setTabColor(tab.id, color)
              })
            }
          }))
        },
        {
          type: 'separator',
          visible: contextMenuTab != null
        },
        {
          label: contextMenuLabel('New Tab'),
          visible: isTabBarContextMenu && contextMenuTab == null,
          click: () => {
            manager?.createTabWithPreference({ makeActive: true }).catch(error => {
              console.error('Failed to create a new tab from the tab bar context menu:', error)
            })
          }
        },
        {
          label: contextMenuLabel('New Window'),
          visible: isTabBarContextMenu && contextMenuTab == null,
          click: () => {
            createWindow({ replaceMainWindow: false }).catch(error => {
              console.error('Failed to create a new window from the tab bar context menu:', error)
            })
          }
        },
        {
          label: contextMenuLabel('Reopen Closed Tab'),
          visible: isTabBarContextMenu && contextMenuTab == null,
          enabled: manager?.closedTabs.length > 0,
          click: () => {
            manager?.restoreClosedTab()
          }
        },
        {
          label: contextMenuLabel(isBulkTabAction ? 'Reload Tabs' : 'Reload Tab'),
          visible: contextMenuTab != null,
          click: () => {
            if (!manager || !contextMenuTab) return

            for (const tab of contextMenuTabs) manager.requestReload(tab.id)
          }
        },
        {
          label: contextMenuLabel('Load Tabs'),
          visible: contextMenuTab != null && isBulkTabAction,
          enabled: hasSelectedUnloadedTab,
          click: async () => {
            if (!manager || !contextMenuTab) return

            const tabIds = contextMenuTabs
              .filter(tab => tab.loadState === 'unloaded')
              .map(tab => tab.id)
            if (!await confirmMultipleTabsAction(manager, tabIds.length, 'load')) return

            await manager.runBatched(() => {
              for (const tabId of tabIds) manager.loadTab(tabId)
            })
          }
        },
        {
          label: contextMenuLabel(
            isBulkTabAction ? 'Unload Tabs' : isContextMenuTabUnloaded ? 'Load Tab' : 'Unload Tab'
          ),
          visible: contextMenuTab != null,
          enabled: isBulkTabAction
            ? hasSelectedLoadedTab
            : contextMenuTab != null && (
              isContextMenuTabUnloaded ||
                (contextMenuTab.loadState !== 'unloaded' &&
                  (contextMenuTab.id !== manager?.activeTabId || (manager?.tabs.size ?? 0) > 1))
            ),
          click: async () => {
            if (!manager || !contextMenuTab) return

            if (!isBulkTabAction && isContextMenuTabUnloaded) {
              manager.loadTab(contextMenuTab.id)
              return
            }

            const tabIds = contextMenuTabs
              .filter(tab => !['unloaded', 'unloading'].includes(tab.loadState))
              .map(tab => tab.id)
            if (!await confirmMultipleTabsAction(manager, tabIds.length, 'unload')) return

            await manager.unloadTabs(tabIds)
          }
        },
        {
          type: 'separator',
          visible: contextMenuTab != null && moveTargets.length > 0
        },
        {
          label: contextMenuLabel(isBulkTabAction ? 'Move Tabs to Window' : 'Move Tab to Window'),
          visible: contextMenuTab != null && moveTargets.length > 0,
          submenu: moveTargets.map(({ windowId, label }) => ({
            label,
            click: async () => {
              if (!contextMenuTab) {
                return
              }
              for (const tab of contextMenuTabs) {
                await TabManager.moveTabToWindow(tab.id, windowId)
              }
            }
          }))
        },
        {
          type: 'separator',
          visible: contextMenuTab != null
        },
        {
          label: contextMenuLabel('Open in a New Tab'),
          // Only show the option for in-app URLs and not external ones
          visible: isInAppUrl,
          click: () => {
            const manager = TabManager.getFromWebContents(webContents)
            if (manager) {
              manager.createTabWithPreferenceFromOpener(
                { url: parameters.linkURL, makeActive: true },
                manager.contextMenuTabId ?? manager.presentedTabId ?? manager.activeTabId
              ).catch(error => {
                console.error('Failed to open link in a new tab:', error)
              })
            }
          }
        },
        {
          label: contextMenuLabel('Open in a New Window'),
          // Only show the option for in-app URLs and not external ones
          visible: isInAppUrl,
          click: () => {
            createWindow({ replaceMainWindow: false, windowStartupUrl: parameters.linkURL, showWindowNow: true })
          }
        },
        // Only show select all in text fields
        {
          label: contextMenuLabel('Select All'),
          enabled: parameters.editFlags.canSelectAll,
          visible: parameters.isEditable,
          click: () => {
            webContents.selectAll()
          }
        }
      ]
    },
    // only show the copy link entry for external links and the /playlist, /channel and /watch in-app URLs
    // the /playlist, /channel and /watch in-app URLs get transformed to their equivalent YouTube or Invidious URLs
    append: async (defaultActions, parameters, webContents) => {
      const pageUrl = parameters.pageURL || ''
      let visible = false
      const urlParts = parameters.linkURL.split('#')
      const isInAppUrl = isOpenTubeXUrl(pageUrl) && urlParts[0] === pageUrl.split('#')[0]

      if (parameters.linkURL.length > 0) {
        if (isInAppUrl) {
          visible = isShareableOpenTubeXRoute(urlParts[1])
        } else {
          visible = true
        }
      }

      const copy = (url) => {
        if (parameters.linkText) {
          clipboard.write({
            bookmark: parameters.linkText,
            text: url
          })
        } else {
          clipboard.writeText(url)
        }
      }

      const selectionText = parameters.selectionText.trim()
      const selectionLabelText = truncateSelectionForLabel(selectionText)
      const textShortEnoughForSearch = selectionText.length <= SEARCH_CHAR_LIMIT
      const activeSearchEngines = (await getConfiguredSearchEngines())
        .filter(engine => engine.enabled)
      const externalSearchItems = activeSearchEngines.map(engine => ({
        label: engine.name,
        icon: getFaviconUrl(engine.url),
        faviconSource: engine.url,
        click: async () => {
          try {
            await shell.openExternal(buildSearchUrl(engine.url, selectionText))
          } catch (error) {
            console.error(`Failed to search with ${engine.name}:`, error)
          }
        }
      }))
      const externalSearch = activeSearchEngines.length === 1
        ? {
            label: contextMenuLabel(
              'Search With',
              { engine: activeSearchEngines[0].name },
              `Search with ${activeSearchEngines[0].name}`
            ),
            icon: getFaviconUrl(activeSearchEngines[0].url),
            faviconSource: activeSearchEngines[0].url,
            visible: selectionText.length > 0,
            click: externalSearchItems[0].click
          }
        : {
            label: contextMenuLabel('Search With Multiple', {}, 'Search with...'),
            visible: selectionText.length > 0 && activeSearchEngines.length > 1,
            submenu: externalSearchItems
          }

      return [
        {
          label: contextMenuLabel('Copy Link'),
          visible: visible && !isInAppUrl,
          click: () => {
            copy(parameters.linkURL)
          }
        },
        {
          label: contextMenuLabel('Copy YouTube Link'),
          visible: visible && isInAppUrl,
          click: () => {
            copy(transformOpenTubeXRouteUrl(urlParts[1], true))
          }
        },
        {
          label: contextMenuLabel('Copy Invidious Link'),
          visible: visible && isInAppUrl && (backendPreference === 'invidious' || backendFallback),
          click: () => {
            copy(transformOpenTubeXRouteUrl(urlParts[1], false))
          }
        },
        // Only show search in new tab/window for
        // Static text or link
        // NOT internal link
        // NOT link with no customized link text
        // NOT link for timestamp
        {
          label: textShortEnoughForSearch
            ? contextMenuLabel(
                'Search Selection in New Tab',
                { selection: selectionLabelText },
                `Search "${selectionLabelText}" in a New Tab`
              )
            : contextMenuLabel(
                'Selection Too Long',
                { count: SEARCH_CHAR_LIMIT },
                `"${selectionLabelText}" is too long for search (> ${SEARCH_CHAR_LIMIT} chars)`
              ),
          enabled: textShortEnoughForSearch,
          visible: (
            !isInAppUrl &&
            !parameters.isEditable &&
            (parameters.linkURL != null && !parameters.linkURL.includes(parameters.selectionText) && !(/(\d{1,2}:)*\d{1,2}:\d{2}/.test(parameters.linkText))) &&
            selectionText.length > 0
          ),
          click: () => {
            const manager = TabManager.getFromWebContents(webContents)
            if (manager) {
              manager.createTabWithPreferenceFromOpener(
                {
                  route: `/search/${encodeURIComponent(selectionText)}`,
                  makeActive: true
                },
                manager.contextMenuTabId ?? manager.presentedTabId ?? manager.activeTabId
              ).catch(error => {
                console.error('Failed to open search in a new tab:', error)
              })
            }
          }
        },
        {
          label: textShortEnoughForSearch
            ? contextMenuLabel(
                'Search Selection in New Window',
                { selection: selectionLabelText },
                `Search "${selectionLabelText}" in a New Window`
              )
            : contextMenuLabel(
                'Selection Too Long',
                { count: SEARCH_CHAR_LIMIT },
                `"${selectionLabelText}" is too long for search (> ${SEARCH_CHAR_LIMIT} chars)`
              ),
          enabled: textShortEnoughForSearch,
          visible: (
            !isInAppUrl &&
            !parameters.isEditable &&
            (parameters.linkURL != null && !parameters.linkURL.includes(parameters.selectionText) && !(/(\d{1,2}:)*\d{1,2}:\d{2}/.test(parameters.linkText))) &&
            selectionText.length > 0
          ),
          click: () => {
            createWindow({
              replaceMainWindow: false,
              windowStartupUrl: `${ROOT_APP_URL}#/search/${encodeURIComponent(selectionText)}`,
              searchQueryText: selectionText,
              showWindowNow: true,
            })
          }
        },
        externalSearch,
      ]
    },
  }

  let contextMenuSessionId = 0
  /** @type {Map<number, { sessionId: number, actions: Map<string, Function> }>} */
  const contextMenuSessions = new Map()
  /** @type {Map<number, number>} */
  const latestContextMenuRequests = new Map()

  function createDefaultContextMenuActions(parameters, webContents) {
    const hasSelection = parameters.selectionText.length > 0
    const can = action => parameters.editFlags[`can${action}`] === true

    return {
      separator: () => ({ type: 'separator' }),
      cut: () => ({
        label: contextMenuLabel('Cut'),
        visible: parameters.isEditable,
        enabled: can('Cut') && hasSelection,
        click: () => webContents.cut()
      }),
      copy: () => ({
        label: contextMenuLabel('Copy'),
        visible: parameters.isEditable || hasSelection,
        enabled: can('Copy') && hasSelection,
        click: () => webContents.copy()
      }),
      paste: () => ({
        label: contextMenuLabel('Paste'),
        visible: parameters.isEditable,
        enabled: can('Paste'),
        click: () => webContents.paste()
      }),
      selectAll: () => ({
        label: contextMenuLabel('Select All'),
        click: () => webContents.selectAll()
      }),
      saveImageAs: () => ({
        label: contextMenuLabel('Save Image As…'),
        visible: parameters.mediaType === 'image',
        click: () => webContents.downloadURL(parameters.srcURL)
      }),
      copyImage: () => ({
        label: contextMenuLabel('Copy Image'),
        visible: parameters.mediaType === 'image',
        click: () => webContents.copyImageAt(parameters.x, parameters.y)
      }),
      copyImageAddress: () => ({
        label: contextMenuLabel('Copy Image Address'),
        visible: parameters.mediaType === 'image',
        click: () => clipboard.writeText(parameters.srcURL)
      })
    }
  }

  function removeUnusedContextMenuItems(items) {
    const visibleItems = items.filter(item => item && item.visible !== false)
    const cleanedItems = []

    for (const item of visibleItems) {
      if (item.type === 'separator' && (cleanedItems.length === 0 || cleanedItems.at(-1).type === 'separator')) {
        continue
      }
      cleanedItems.push(item)
    }

    if (cleanedItems.at(-1)?.type === 'separator') cleanedItems.pop()
    return cleanedItems
  }

  /**
   * @param {unknown} label
   * @returns {{ text: string, key: string | undefined, parameters: unknown }}
   */
  function serializeContextMenuLabel(label) {
    if (
      label != null &&
      typeof label === 'object' &&
      typeof label.key === 'string' &&
      typeof label.fallback === 'string'
    ) {
      return {
        text: label.fallback,
        key: label.key,
        parameters: label.parameters
      }
    }

    return {
      text: String(label ?? ''),
      key: undefined,
      parameters: undefined
    }
  }

  function serializeContextMenuItems(items, actions, actionPrefix = 'item') {
    return removeUnusedContextMenuItems(items).map((item, index) => {
      if (item.type === 'separator') return { type: 'separator' }

      const actionId = `${actionPrefix}-${index}`
      const hasAction = item.enabled !== false && typeof item.click === 'function'
      if (hasAction) actions.set(actionId, () => item.click(item))

      const submenu = Array.isArray(item.submenu)
        ? serializeContextMenuItems(item.submenu, actions, actionId)
        : undefined
      const label = serializeContextMenuLabel(item.label)
      const refreshingLabel = item.refreshingLabel == null
        ? null
        : serializeContextMenuLabel(item.refreshingLabel)

      return {
        type: item.type ?? 'normal',
        label: label.text,
        labelKey: label.key,
        labelParameters: label.parameters,
        // Shown instead of the label while a subscription refresh is running,
        // so that an open menu doesn't go stale when the refresh ends
        refreshingLabel: refreshingLabel?.text,
        refreshingLabelKey: refreshingLabel?.key,
        refreshingLabelParameters: refreshingLabel?.parameters,
        enabled: item.enabled !== false,
        checked: item.checked === true,
        icon: typeof item.icon === 'string' ? item.icon : undefined,
        groupColor: typeof item.groupColor === 'string' ? item.groupColor : undefined,
        faviconSource: typeof item.faviconSource === 'string' ? item.faviconSource : undefined,
        actionId: hasAction ? actionId : undefined,
        submenu
      }
    })
  }

  ipcMain.handle(IpcChannels.CONTEXT_MENU_OPEN, async (event, rawParameters = {}) => {
    const webContents = event.sender
    const sessionId = ++contextMenuSessionId
    latestContextMenuRequests.set(webContents.id, sessionId)
    const parameters = {
      x: Number.isFinite(rawParameters.x) ? rawParameters.x : 0,
      y: Number.isFinite(rawParameters.y) ? rawParameters.y : 0,
      pageURL: typeof rawParameters.pageURL === 'string' ? rawParameters.pageURL : '',
      linkURL: typeof rawParameters.linkURL === 'string' ? rawParameters.linkURL : '',
      linkText: typeof rawParameters.linkText === 'string' ? rawParameters.linkText : '',
      srcURL: typeof rawParameters.srcURL === 'string' ? rawParameters.srcURL : '',
      mediaType: ['image', 'video'].includes(rawParameters.mediaType) ? rawParameters.mediaType : 'none',
      selectionText: typeof rawParameters.selectionText === 'string' ? rawParameters.selectionText : '',
      isEditable: rawParameters.isEditable === true,
      editFlags: {
        canCut: rawParameters.editFlags?.canCut === true,
        canCopy: rawParameters.editFlags?.canCopy === true,
        canPaste: rawParameters.editFlags?.canPaste === true,
        canSelectAll: rawParameters.editFlags?.canSelectAll === true
      }
    }
    const defaultActions = createDefaultContextMenuActions(parameters, webContents)
    const defaultItems = [
      defaultActions.cut(),
      defaultActions.copy(),
      defaultActions.paste(),
      defaultActions.separator(),
      defaultActions.saveImageAs(),
      defaultActions.copyImage(),
      defaultActions.copyImageAddress(),
      defaultActions.separator()
    ]
    const items = [
      ...contextMenuOptions.prepend(defaultActions, parameters, webContents),
      ...defaultItems,
      ...await contextMenuOptions.append(defaultActions, parameters, webContents)
    ]
    const actions = new Map()
    const serializedItems = serializeContextMenuItems(items, actions)

    if (latestContextMenuRequests.get(webContents.id) === sessionId) {
      contextMenuSessions.set(webContents.id, { sessionId, actions })
    }
    return { sessionId, items: serializedItems }
  })

  ipcMain.handle(IpcChannels.CONTEXT_MENU_EXECUTE, async (event, payload) => {
    const session = contextMenuSessions.get(event.sender.id)
    if (!session || payload?.sessionId !== session.sessionId) return

    const action = session.actions.get(payload?.actionId)
    if (action) await action()
  })

  ipcMain.handle(IpcChannels.RESOLVE_FAVICON, async (event, url) => {
    if (!isOpenTubeXUrl(event.senderFrame.url) || typeof url !== 'string') return ''

    if (!(await getConfiguredSearchEngines()).some(engine => engine.enabled && engine.url === url)) {
      return ''
    }

    return resolveSearchEngineFavicon(url)
  })

  if (process.platform === 'win32' && !isPortableBuild()) {
    app.setUserTasks([
      {
        program: process.execPath,
        arguments: '--new-window',
        iconPath: process.execPath,
        iconIndex: 0,
        title: 'New Window',
        description: 'Open New Window'
      }
    ])
  }

  // disable electron warning
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'
  const isDebug = process.argv.includes('--debug')

  let mainWindow
  let startupUrl
  let tray = null
  let trayOnMinimize = false
  let trayWindows = []
  const trayMaximizedWindows = {}
  /** @type {Map<number, Array<{url: string, tabId: string | null}>>} */
  const pendingOpenUrlsByWebContentsId = new Map()
  const openUrlReadyWebContentsIds = new Set()
  const activeLiveNotifications = new Set()
  const ozonePlatform = app.commandLine.getSwitchValue('ozone-platform')
  const isWaylandPlatform = detectWaylandPlatform({
    platform: process.platform,
    ozonePlatform,
    environment: process.env,
  })
  const monitorsKdeWaylandWindowState = shouldMonitorKdeWaylandWindowState({
    platform: process.platform,
    ozonePlatform,
    environment: process.env,
  })
  const kdeWaylandWindowStateBackend = monitorsKdeWaylandWindowState
    ? createKdeWaylandWindowStateBackend()
    : Promise.resolve(null)
  app.once('will-quit', () => {
    kdeWaylandWindowStateBackend.then(backend => backend?.close()).catch(() => {})
  })
  const supportsAutoPictureInPictureMinimize = isWaylandPlatform
    ? kdeWaylandWindowStateBackend.then(backend => backend !== null)
    : Promise.resolve(true)
  const isTrayOnMinimizeSupported = process.platform !== 'darwin' && !isWaylandPlatform

  const userDataPath = app.getPath('userData')

  asyncFs.rm(path.join(userDataPath, 'voice_over_translation_cache'), {
    force: true,
    recursive: true
  }).catch(error => {
    console.error('Failed to remove the obsolete voice-over translation cache:', error)
  })

  function broadcastLiveReminderUpdate(videoId, scheduled) {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.webContents.isDestroyed() && isOpenTubeXUrl(window.webContents.getURL())) {
        window.webContents.send(IpcChannels.LIVE_REMINDER_UPDATED, videoId, scheduled)
      }
    }
  }

  function showLiveReminderNotification(reminder) {
    if (!supportsNativeNotifications(Notification)) return

    const notification = new Notification({
      title: reminder.notificationTitle,
      body: reminder.notificationBody
    })
    activeLiveNotifications.add(notification)
    notification.once('close', () => activeLiveNotifications.delete(notification))
    notification.once('click', () => {
      activeLiveNotifications.delete(notification)
      const videoUrl = `https://www.youtube.com/watch?v=${reminder.videoId}`

      if (!mainWindow || mainWindow.isDestroyed()) {
        createWindowForOpenUrl(videoUrl, {
          showWindowNow: true,
          reuseEmptyRootTab: true
        }).catch(error => {
          console.error('Failed to open live stream reminder', error)
        })
        return
      }

      const isHiddenInTray = trayWindows.some(window => window.id === mainWindow.id)
      if (isHiddenInTray) {
        trayClick(mainWindow)
      } else if (mainWindow.isMinimized()) {
        mainWindow.restore()
      } else if (!mainWindow.isVisible()) {
        mainWindow.show()
      }
      mainWindow.focus()
      openUrlInWindow(mainWindow, videoUrl)
    })
    notification.show()
  }

  const liveReminderManager = new LiveReminderManager({
    notify: showLiveReminderNotification,
    onChange: broadcastLiveReminderUpdate,
    datastore: liveReminders
  })

  // command line switches need to be added before the app ready event first
  // that means we can't use the normal settings system as that is asynchronous,
  // doing it synchronously ensures that we add it before the event fires
  const REPLACE_HTTP_CACHE_PATH = `${userDataPath}/experiment-replace-http-cache`
  const replaceHttpCache = existsSync(REPLACE_HTTP_CACHE_PATH)
  if (replaceHttpCache) {
    // the http cache causes excessive disk usage during video playback
    // we've got a custom image cache to make up for disabling the http cache
    // experimental as it increases RAM use in favour of reduced disk use
    app.commandLine.appendSwitch('disable-http-cache')
  }

  if (process.platform === 'linux') {
    const middleClickAutoscrollFeature = 'MiddleClickAutoscroll'
    const enabledBlinkFeatures = app.commandLine.getSwitchValue('enable-blink-features')
      .split(',')
      .filter(Boolean)

    if (!enabledBlinkFeatures.includes(middleClickAutoscrollFeature)) {
      app.commandLine.appendSwitch('enable-blink-features', [
        ...enabledBlinkFeatures,
        middleClickAutoscrollFeature
      ].join(','))
    }
  }

  const DISABLE_HARDWARE_ACCELERATION_PATH = `${userDataPath}/experiment-disable-hardware-acceleration`
  const disableHardwareAcceleration = existsSync(DISABLE_HARDWARE_ACCELERATION_PATH)
  if (disableHardwareAcceleration) {
    app.commandLine.appendSwitch('disable-gpu')
  }

  const PLAYER_CACHE_PATH = `${userDataPath}/player_cache`

  if (!isPortableBuild()) {
    // See: https://stackoverflow.com/questions/45570589/electron-protocol-handler-not-working-on-windows
    // remove so we can register each time as we run the app.
    app.removeAsDefaultProtocolClient('opentubex')

    // If we are running a non-packaged version of the app && on windows
    if (process.env.NODE_ENV === 'development' && process.platform === 'win32') {
      // Set the path of electron.exe and your app.
      // These two additional parameters are only available on windows.
      app.setAsDefaultProtocolClient('opentubex', process.execPath, [path.resolve(process.argv[1])])
    } else {
      app.setAsDefaultProtocolClient('opentubex')
    }
  }

  if (process.env.NODE_ENV !== 'development') {
    app.on('second-instance', async (_, commandLine, __) => {
      // Someone tried to run a second instance
      if (typeof commandLine !== 'undefined') {
        const newStartupUrl = getLinkUrl(commandLine)

        if (!(mainWindow && mainWindow.webContents)) {
          startupUrl = newStartupUrl
          if (app.isReady()) {
            await createWindowForOpenUrl(startupUrl, {
              reuseEmptyRootTab: true
            })
            startupUrl = null
          }
          return
        }

        if (commandLine.includes('--new-window')) {
          // The user wants to create a new window in the existing instance
          await createWindowForOpenUrl(newStartupUrl, {
            showWindowNow: true,
            replaceMainWindow: true,
            reuseEmptyRootTab: true
          })
          return
        }

        const openDeepLinksInNewWindow = (await baseHandlers.settings._findOne('openDeepLinksInNewWindow'))?.value
        if (!openDeepLinksInNewWindow) {
          // Just focus the main window (instead of starting a new instance)
          if (mainWindow.isMinimized()) {
            if (isTrayOnMinimizeSupported && trayOnMinimize) {
              trayClick(mainWindow)
            } else {
              mainWindow.restore()
            }
          }
          mainWindow.focus()
          openUrlInWindow(mainWindow, newStartupUrl)
          return
        }

        await createWindowForOpenUrl(newStartupUrl, {
          replaceMainWindow: false,
          showWindowNow: true,
          reuseEmptyRootTab: true
        })
      }
    })
  }

  let proxyUrl

  app.on('ready', async (_, __) => {
    try {
      await applyYtDlpPlaybackCacheSettings()
    } catch (error) {
      console.warn('Could not apply the yt-dlp playback cache settings', error)
    }
    try {
      await restoreYtDlpDownloadQueue()
    } catch (error) {
      console.warn('Could not restore the download queue', error)
    }
    if (process.platform === 'darwin') {
      const t = await createMainTranslator()
      dockMediaLabels = {
        previous: t('Video.Previous'),
        play: t('Video.Player.Scroll Mini Player.Play'),
        pause: t('Video.Player.Scroll Mini Player.Pause'),
        next: t('Video.Next'),
        newWindow: t('New Window')
      }
      updateDockMenu()
    }

    if (process.env.NODE_ENV === 'production') {
      protocol.handle('app', async (request) => {
        if (request.method !== 'GET') {
          return new Response(null, {
            status: 405,
            headers: {
              Allow: 'GET'
            }
          })
        }

        const { host, pathname } = new URL(request.url)

        if (host !== 'bundle' || !ALLOWED_RENDERER_FILES.has(pathname)) {
          return new Response(null, {
            status: 400
          })
        }

        const contents = await asyncFs.readFile(path.join(__dirname, pathname))

        if (pathname.endsWith('.json.br')) {
          const decompressed = await brotliDecompressAsync(contents)

          return new Response(decompressed, {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Content-Encoding': 'br'
            }
          })
        } else {
          return new Response(contents.buffer, {
            status: 200,
            headers: {
              'Content-Type': contentTypeFromFileExtension(pathname.split('.').at(-1))
            }
          })
        }
      })
    }

    // Electron defaults to approving all permission checks and permission requests.
    // OpenTubeX only needs a few permissions, so we reject requests for other permissions
    // and reject all requests on non-OpenTubeX URLs.
    //
    // OpenTubeX needs the following permissions:
    // - "fullscreen": So that the video player can enter full screen
    // - "clipboard-sanitized-write": To allow the user to copy video URLs and error messages
    // - "fileSystem" Needed for the Web File System API (e.g. importing and exporting data)
    // - video-only "media": To scan secure sync pairing QR codes

    session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
      if (!isOpenTubeXUrl(requestingOrigin)) {
        return false
      }

      return (
        permission === 'fullscreen' ||
        permission === 'clipboard-sanitized-write' ||
        (permission === 'media' && details.mediaType === 'video') ||
        (permission === 'fileSystem' && !details.isDirectory)
      )
    })

    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      if (!isOpenTubeXUrl(webContents.getURL())) {
        // eslint-disable-next-line n/no-callback-literal
        callback(false)
        return
      }

      callback(
        permission === 'fullscreen' ||
        permission === 'clipboard-sanitized-write' ||
        (permission === 'media' &&
          details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'video') ||
        (permission === 'fileSystem' && !details.isDirectory)
      )
    })

    session.defaultSession.on('file-system-access-restricted', (event, details, callback) => {
      if (!isOpenTubeXUrl(details.origin)) {
        // eslint-disable-next-line n/no-callback-literal
        callback('deny')
        return
      }

      // eslint-disable-next-line n/no-callback-literal
      callback(details.isDirectory ? 'deny' : 'allow')
    })

    let docArray
    try {
      docArray = await baseHandlers.settings._findAppReadyRelatedSettings()
    } catch (err) {
      console.error(err)
      app.exit()
      return
    }

    let disableSmoothScrolling = false
    let useProxy = false
    let proxyProtocol = DEFAULT_PROXY_SETTINGS.protocol
    let proxyHostname = DEFAULT_PROXY_SETTINGS.hostname
    let proxyPort = DEFAULT_PROXY_SETTINGS.port

    if (docArray?.length > 0) {
      docArray.forEach((doc) => {
        switch (doc._id) {
          case 'disableSmoothScrolling':
            disableSmoothScrolling = doc.value
            break
          case 'useProxy':
            useProxy = doc.value
            break
          case 'proxyProtocol':
            proxyProtocol = doc.value
            break
          case 'proxyHostname':
            proxyHostname = doc.value
            break
          case 'proxyPort':
            proxyPort = doc.value
            break
          case 'backendFallback':
            backendFallback = doc.value
            break
          case 'backendPreference':
            backendPreference = doc.value
            break
          case 'hideToTrayOnMinimize':
            if (isTrayOnMinimizeSupported) {
              trayOnMinimize = doc.value
            }
            break
        }
      })
    }

    if (disableSmoothScrolling) {
      app.commandLine.appendSwitch('disable-smooth-scrolling')
    } else {
      app.commandLine.appendSwitch('enable-smooth-scrolling')
    }

    if (useProxy) {
      proxyUrl = buildProxyUrl({ protocol: proxyProtocol, hostname: proxyHostname, port: proxyPort })

      session.defaultSession.setProxy({
        proxyRules: proxyUrl
      })
    }

    const fixedUserAgent = session.defaultSession.getUserAgent()
      .split(' ')
      .filter(part => !part.includes('Electron') && !part.includes(packageDetails.productName))
      .join(' ')
    session.defaultSession.setUserAgent(fixedUserAgent)

    // Set CONSENT cookie on reasonable domains
    const consentCookieDomains = [
      'https://www.youtube.com',
      'https://youtube.com'
    ]
    consentCookieDomains.forEach(url => {
      session.defaultSession.cookies.set({
        url: url,
        name: 'CONSENT',
        value: 'YES+',
        sameSite: 'no_restriction'
      })
    })

    session.defaultSession.cookies.set({
      url: 'https://www.youtube.com',
      name: 'SOCS',
      value: 'CAI',
      sameSite: 'no_restriction',
    })

    const onBeforeSendHeadersRequestFilter = {
      urls: ['https://*/*', 'http://*/*'],
      types: ['xhr', 'media', 'image']
    }
    session.defaultSession.webRequest.onBeforeSendHeaders(onBeforeSendHeadersRequestFilter, ({ requestHeaders, url, webContents }, callback) => {
      const urlObj = new URL(url)

      if (webContents && isOpenTubeXUrl(webContents.getURL())) {
        applySyncServerUserAgent(requestHeaders)
      }

      if (url.startsWith('https://www.youtube.com/youtubei/')) {
        // make InnerTube requests work with the fetch function
        // InnerTube rejects requests if the referer isn't YouTube or empty
        requestHeaders.Referer = 'https://www.youtube.com/'
        requestHeaders.Origin = 'https://www.youtube.com'

        requestHeaders['Sec-Fetch-Site'] = 'same-origin'
        requestHeaders['Sec-Fetch-Mode'] = 'same-origin'
        requestHeaders['X-Youtube-Bootstrap-Logged-In'] = 'false'
      } else if (
        url.startsWith('https://www.youtube.com/watch') ||
        (urlObj.hostname === 'www.youtube.com' && urlObj.pathname === '/')
      ) {
        delete requestHeaders.Referer
        delete requestHeaders.Origin
        requestHeaders['Sec-Fetch-Dest'] = 'document'
        requestHeaders['Sec-Fetch-Mode'] = 'navigate'
        requestHeaders['Sec-Fetch-Site'] = 'none'
        requestHeaders['Sec-Fetch-User'] = '?1'
        requestHeaders.Cookie = appendYouTubeTimeZonePreference(
          requestHeaders.Cookie,
          Intl.DateTimeFormat().resolvedOptions().timeZone
        )
      } else if (url === 'https://www.youtube.com/sw.js_data' || url.startsWith('https://www.youtube.com/api/timedtext')) {
        requestHeaders.Referer = 'https://www.youtube.com/sw.js'
        requestHeaders['Sec-Fetch-Site'] = 'same-origin'
        requestHeaders['Sec-Fetch-Mode'] = 'same-origin'
      } else if (
        urlObj.origin.endsWith('.googleusercontent.com') ||
        urlObj.origin.endsWith('.ggpht.com') ||
        urlObj.origin.endsWith('.ytimg.com')
      ) {
        requestHeaders.Referer = 'https://www.youtube.com/'
        requestHeaders.Origin = 'https://www.youtube.com'
      } else if (urlObj.origin.endsWith('.googlevideo.com') && urlObj.pathname === '/videoplayback') {
        requestHeaders.Referer = 'https://www.youtube.com/'
        requestHeaders.Origin = 'https://www.youtube.com'

        // YouTube doesn't send the Content-Type header for the media requests, so we shouldn't either
        delete requestHeaders['Content-Type']
      } else if (urlObj.origin === 'https://ipwho.is') {
        // Fix the CORS error with the proxy test button
        requestHeaders = {}
      } else if (webContents) {
        const invidiousAuthorization = invidiousAuthorizations.get(webContents.id)

        if (invidiousAuthorization && isInvidiousInstanceUrl(url, invidiousAuthorization.url)) {
          requestHeaders.Authorization = invidiousAuthorization.authorization
        }
      }

      // eslint-disable-next-line n/no-callback-literal
      callback({ requestHeaders })
    })

    // when we create a real session on the watch page, youtube returns tracking cookies, which we definitely don't want
    const trackingCookieRequestFilter = {
      urls: [
        'https://www.youtube.com/sw.js_data',
        'https://www.youtube.com/iframe_api',
        'https://www.youtube.com/watch?*'
      ]
    }

    session.defaultSession.webRequest.onHeadersReceived(trackingCookieRequestFilter, ({ responseHeaders }, callback) => {
      if (responseHeaders) {
        delete responseHeaders['set-cookie']
        delete responseHeaders['content-security-policy']
        delete responseHeaders['cross-origin-opener-policy']
        delete responseHeaders['report-to']
        delete responseHeaders['reporting-endpoints']
      }

      // eslint-disable-next-line n/no-callback-literal
      callback({ responseHeaders })
    })

    protocol.handle('downloadmedia', async (request) => {
      if (!['GET', 'HEAD'].includes(request.method)) {
        return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } })
      }

      const url = new URL(request.url)
      const [, rawId, videoId] = url.pathname.split('/')
      if (url.host !== 'file' || !/^\d+$/.test(rawId ?? '')) {
        return new Response(null, { status: 400 })
      }

      const file = await getYtDlpDownloadFile(Number(rawId), videoId ?? '')
      if (file === null) return new Response(null, { status: 404 })

      let fileSize
      try {
        const fileStats = await asyncFs.stat(file.path)
        if (!fileStats.isFile()) {
          return new Response(null, { status: 404 })
        }
        fileSize = fileStats.size
      } catch {
        return new Response(null, { status: 404 })
      }
      const extension = path.extname(file.path).toLowerCase()
      const mimeType = file.mode === 'audio' && extension === '.webm'
        ? 'audio/webm'
        : file.mode === 'audio' && extension === '.mp4'
          ? 'audio/mp4'
          : DOWNLOADED_MEDIA_MIME_TYPES[extension.slice(1)] ?? 'application/octet-stream'
      const headers = {
        'Accept-Ranges': 'bytes',
        'Content-Type': mimeType
      }
      if (fileSize === 0) {
        return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': '0' } })
      }
      const rangeMatch = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '')
      let start = 0
      let end = fileSize - 1
      let status = 200

      if (rangeMatch !== null) {
        const [, rawStart, rawEnd] = rangeMatch
        if (rawStart === '') {
          const suffixLength = Number(rawEnd)
          start = Math.max(0, fileSize - suffixLength)
        } else {
          start = Number(rawStart)
          if (rawEnd !== '') end = Math.min(Number(rawEnd), end)
        }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= fileSize) {
          return new Response(null, {
            status: 416,
            headers: { ...headers, 'Content-Range': `bytes */${fileSize}` }
          })
        }
        status = 206
        headers['Content-Range'] = `bytes ${start}-${end}/${fileSize}`
      }

      headers['Content-Length'] = String(end - start + 1)
      const body = request.method === 'HEAD'
        ? null
        : Readable.toWeb(createReadStream(file.path, { start, end }))
      return new Response(body, { status, headers })
    })

    if (replaceHttpCache) {
      // in-memory image cache

      const imageCache = new ImageCache()

      protocol.handle('imagecache', (request) => {
        const [requestUrl, rawWebContentsId] = request.url.split('#')

        return new Promise((resolve, reject) => {
          const url = decodeURIComponent(requestUrl.substring(13))
          if (imageCache.has(url)) {
            const cached = imageCache.get(url)

            resolve(new Response(cached.data, {
              headers: { 'content-type': cached.mimeType }
            }))
            return
          }

          let headers

          if (rawWebContentsId) {
            const invidiousAuthorization = invidiousAuthorizations.get(parseInt(rawWebContentsId))

            if (invidiousAuthorization && isInvidiousInstanceUrl(url, invidiousAuthorization.url)) {
              headers = {
                Authorization: invidiousAuthorization.authorization
              }
            }
          }

          const newRequest = net.request({
            method: request.method,
            url,
            headers
          })

          // Electron doesn't allow certain headers to be set:
          // https://www.electronjs.org/docs/latest/api/client-request#requestsetheadername-value
          // also blacklist Origin and Referrer as we don't want to let YouTube know about them
          const blacklistedHeaders = ['content-length', 'host', 'trailer', 'te', 'upgrade', 'cookie2', 'keep-alive', 'transfer-encoding', 'origin', 'referrer']

          for (const header of Object.keys(request.headers)) {
            if (!blacklistedHeaders.includes(header.toLowerCase())) {
              newRequest.setHeader(header, request.headers[header])
            }
          }

          newRequest.on('response', (response) => {
            const chunks = []
            response.on('data', (chunk) => {
              chunks.push(chunk)
            })

            response.on('end', () => {
              const data = Buffer.concat(chunks)

              const expiryTimestamp = extractExpiryTimestamp(response.headers)
              const mimeType = response.headers['content-type']

              imageCache.add(url, mimeType, data, expiryTimestamp)

              resolve(new Response(data, {
                headers: { 'content-type': mimeType }
              }))
            })

            response.on('error', (error) => {
              console.error('image cache error', error)
              reject(error)
            })
          })

          newRequest.on('error', (err) => {
            console.error(err)
          })

          newRequest.end()
        })
      })

      const imageRequestFilter = { urls: ['https://*/*', 'http://*/*'], types: ['image'] }
      session.defaultSession.webRequest.onBeforeRequest(imageRequestFilter, (details, callback) => {
        // the requests made by the imagecache:// handler to fetch the image,
        // are allowed through, as their resourceType is 'other'

        let redirectURL = `imagecache://${encodeURIComponent(details.url)}`

        if (details.webContents) {
          redirectURL += `#${details.webContents.id}`
        }

        // eslint-disable-next-line n/no-callback-literal
        callback({
          redirectURL
        })
      })

      // --- end of `if experimentsDisableDiskCache` ---
    }

    const themeReady = (async () => {
      try {
        const baseTheme = await baseHandlers.settings._findOne('baseTheme')

        if (baseTheme?.value) {
          if (isCustomThemeValue(baseTheme.value)) {
            nativeTheme.themeSource = (await getSelectedCustomTheme(baseTheme.value))?.isDark ? 'dark' : 'light'
          } else {
            updateThemeSource(baseTheme.value)
          }
        }
      } catch {}
    })()

    // Setup tab IPC handlers
    const tabsIpcReady = setupTabsIPC({
      confirmCloseWindow: (browserWindow) => {
        const isLastWindow = BrowserWindow.getAllWindows().length === 1
        if (isLastWindow) return confirmCloseApp(browserWindow)

        const manager = TabManager.getForWindow(browserWindow.id)
        return manager && manager.tabs.size > 1
          ? confirmCloseWindowWithMultipleTabs(browserWindow, manager.tabs.size)
          : true
      },
      confirmMultipleTabsAction,
      markWindowCloseConfirmed: (browserWindow) => {
        if (BrowserWindow.getAllWindows().length === 1) {
          closeConfirmedWindowIds.add(browserWindow.id)
        }
      },
      mediaSessionStateChanged: updateDockMediaSession
    })

    // Reminder initialization is ordered with later reminder operations by the
    // manager itself, so loading and pruning its datastore need not hold the
    // first window open.
    liveReminderManager.initialize().catch(error => {
      console.error('Failed to initialize live stream reminders', error)
    })
    const startupBehaviorReady = getStartupBehavior()

    await Promise.all([themeReady, tabsIpcReady])

    // Restore every window that was open last time the app quit. Each window
    // has its own persisted session record, so a multi-window Ctrl+Q session
    // is fully rebuilt here (one window per saved session). If there are no
    // saved sessions yet, fall back to creating a single empty window.
    const startupBehavior = await startupBehaviorReady
    const shouldRestoreSession = startupBehavior !== 'emptySession'
    const savedSessions = shouldRestoreSession ? await loadAllTabSessions() : []

    if (!shouldRestoreSession) {
      await clearAllTabSessions()
    }

    // Start dropping cache entries that no restored tab points at. Captures wait
    // on this maintenance inside TabManager, but window creation does not.
    TabManager.startTabPreviewCachePrune(
      savedSessions.flatMap(session => (
        Array.isArray(session?.tabs)
          ? session.tabs.flatMap(tab => [tab?.previewFileName, tab?.avatarFileName])
          : []
      ))
    )

    let firstWindow

    const directStartupUrl = getDirectOpenUrl(startupUrl)

    if (savedSessions.length === 0) {
      firstWindow = await createWindow({
        windowStartupUrl: directStartupUrl
      })
    } else {
      firstWindow = await createWindow({
        sessionData: savedSessions[0],
        loadInactiveTabsOnRestore: startupBehavior === 'loadAllTabs',
        restoreTabLoadStateOnRestore: startupBehavior === 'restoreTabLoadState'
      })
      for (let i = 1; i < savedSessions.length; i++) {
        await createWindow({
          replaceMainWindow: false,
          showWindowNow: true,
          sessionData: savedSessions[i],
          loadInactiveTabsOnRestore: startupBehavior === 'loadAllTabs',
          restoreTabLoadStateOnRestore: startupBehavior === 'restoreTabLoadState'
        })
      }
    }

    if (startupUrl) {
      if (directStartupUrl === null || savedSessions.length > 0) {
        openUrlInWindow(firstWindow, startupUrl, {
          reuseEmptyRootTab: savedSessions.length === 0
        })
      }
      startupUrl = null
    }
    if (isDebug) {
      // Logical tabs share the BrowserWindow renderer.
      const tabManager = TabManager.getForWindow(mainWindow.id)
      if (tabManager) {
        const webContents = tabManager.getActiveWebContents()
        if (webContents) {
          webContents.openDevTools()
        }
      }
    }
  })

  app.on('login', async (event, webContents, request, authInfo, callback) => {
    if (authInfo.isProxy) {
      event.preventDefault()
      const proxyUsername = (await baseHandlers.settings._findOne('proxyUsername'))?.value
      const proxyPassword = (await baseHandlers.settings._findOne('proxyPassword'))?.value
      callback(proxyUsername, proxyPassword)
    }
  })

  function trayClick(window, close = false) {
    if (!close) {
      if (window.id in trayMaximizedWindows) {
        window.maximize()
      } else {
        window.show()

        // Calling hide() inside minimize is broken for some Linux distros (window minimizes again when trying to drag,
        // resize or maximize it, among other shenanigans). It seems to work as intended with this workaround.
        if (process.platform === 'linux') {
          window.hide()
          window.show()
        }
      }

      if (trayWindows.length === BrowserWindow.getAllWindows().length) { mainWindow = window }
    } else if (trayWindows.length > 0) {
      window.close()
    }

    trayWindows.splice(trayWindows.findIndex(item => item.id === window.id), 1)

    if (trayWindows.length > 0) {
      createTrayContextMenu()
    } else {
      destroyTray()
    }
  }

  function createTrayContextMenu() {
    const menuItems = []
    trayWindows.forEach(window => {
      menuItems.push({
        label: window.title,
        submenu: [
          {
            label: 'Show',
            click: () => trayClick(window)
          },
          {
            label: 'Close',
            click: () => trayClick(window, true)
          }
        ]
      })
    })

    menuItems.push(
      {
        type: 'separator'
      },
      ...defaultTrayMenu()
    )

    const menu = Menu.buildFromTemplate(menuItems)
    tray.setContextMenu(menu)
  }

  function defaultTrayMenu() {
    return [
      {
        label: 'New Window',
        click: () => createWindow({
          showWindowNow: true,
          replaceMainWindow: trayWindows.some(item => item.id === mainWindow.id)
        })
      },
      {
        label: 'Show All Windows',
        click: () => {
          // Use while loop instead of for loop as trayClick modifies the trayWindows array
          while (trayWindows.length > 0) {
            trayClick(trayWindows[0])
          }
        }
      },
      {
        label: 'Quit',
        click: () => requestQuit(BrowserWindow.getFocusedWindow() ?? mainWindow)
      }
    ]
  }

  function destroyTray() {
    if (!tray) return

    if (process.platform !== 'linux') {
      tray.destroy()
      tray = null
    } else {
      const menu = Menu.buildFromTemplate(defaultTrayMenu())
      tray.setContextMenu(menu)
    }
  }

  function showHiddenWindows() {
    trayWindows.forEach(window => {
      window.minimize()
    })

    destroyTray()
    trayWindows = []
  }

  /**
   * @param {string} extension
   */
  function contentTypeFromFileExtension(extension) {
    switch (extension) {
      case 'html':
        return 'text/html'
      case 'css':
        return 'text/css'
      case 'js':
        return 'text/javascript'
      case 'ttf':
        return 'font/ttf'
      case 'woff2':
        return 'font/woff2'
      case 'svg':
        return 'image/svg+xml'
      case 'png':
        return 'image/png'
      case 'json':
        return 'application/json'
      case 'txt':
        return 'text/plain'
      default:
        return 'application/octet-stream'
    }
  }

  const htmlFullscreenWindowIds = new Set()

  async function createWindow(
    {
      replaceMainWindow = true,
      windowStartupUrl = null,
      searchQueryText = null,
      sessionData = null,
      loadInactiveTabsOnRestore = false,
      restoreTabLoadStateOnRestore = false
    } = { }) {
    // Syncing new window background to theme choice.
    const windowBackground = await baseHandlers.settings._findOne('baseTheme').then(async (setting) => {
      if (!setting) {
        return nativeTheme.shouldUseDarkColors ? '#0f0f0f' : '#f1f1f1'
      }

      // Determine window color to be shown (shown most prominently during initial app load)
      // Uses the --bg-color for each corresponding theme
      if (isCustomThemeValue(setting.value)) {
        return (await getSelectedCustomTheme(setting.value))?.colors.background ??
          (nativeTheme.shouldUseDarkColors ? '#0f0f0f' : '#f1f1f1')
      }
      switch (setting.value) {
        case 'dark':
          return '#0f0f0f'
        case 'light':
          return '#f1f1f1'
        case 'openTubeXLight':
          return '#e8f2f0'
        case 'openTubeXDark':
          return '#0b1416'
        case 'black':
          return '#000000'
        case 'dracula':
          return '#282a36'
        case 'catppuccin-mocha':
          return '#1e1e2e'
        case 'pastel-pink':
          return '#ffd1dc'
        case 'hot-pink':
          return '#de1c85'
        case 'nordic':
          return '#2b2f3a'
        case 'solarized-dark':
          return '#002B36'
        case 'solarized-light':
          return '#fdf6e3'
        case 'gruvbox-dark':
          return '#282828'
        case 'gruvbox-light':
          return '#fbf1c7'
        case 'catppuccin-frappe':
          return '#303446'
        case 'everforest-dark-hard':
          return '#272e33'
        case 'everforest-dark-medium':
          return '#2d353b'
        case 'everforest-dark-low':
          return '#333c43'
        case 'everforest-light-hard':
          return '#fffbef'
        case 'everforest-light-medium':
          return '#fdf6e3'
        case 'everforest-light-low':
          return '#f3ead3'
        case 'catppuccin-latte':
          return '#eff1f5'
        case 'system':
        default:
          return nativeTheme.shouldUseDarkColors ? '#0f0f0f' : '#f1f1f1'
      }
    }).catch((error) => {
      console.error(error)
      // Default to nativeTheme settings if nothing is found.
      return nativeTheme.shouldUseDarkColors ? '#0f0f0f' : '#f1f1f1'
    })

    let savedBounds, savedMaximized

    /**
     * Check that the saved bounds still lie on one of the currently connected
     * displays. If a monitor was disconnected since the bounds were saved, we
     * want to fall back to a default position instead of placing the window
     * off-screen.
     * @param {{x: number, y: number, width: number, height: number}} bounds
     */
    const boundsOnVisibleDisplay = (bounds) => {
      return screen.getAllDisplays().some(display => {
        const { x, y, width, height } = display.bounds
        return !(bounds.x > x + width || bounds.x + bounds.width < x || bounds.y > y + height || bounds.y + bounds.height < y)
      })
    }

    // Prefer this window's own persisted bounds (from its last session) if
    // available. Otherwise fall back to the legacy app-wide `bounds` setting
    // so brand-new windows still open where the user last had one.
    if (sessionData?.bounds && typeof sessionData.bounds === 'object') {
      const { maximized, fullScreen: _fullScreen, ...bounds } = sessionData.bounds
      if (boundsOnVisibleDisplay(bounds)) {
        savedBounds = bounds
      }
      savedMaximized = maximized
    } else {
      const boundsDoc = await baseHandlers.settings._findOne('bounds')
      if (typeof boundsDoc?.value === 'object') {
        const { maximized, ...bounds } = boundsDoc.value
        if (boundsOnVisibleDisplay(bounds)) {
          savedBounds = bounds
        }
        savedMaximized = maximized
      }
    }

    const newWindow = new BrowserWindow({
      // Always wait for the shared renderer's first logical presentation. Even
      // explicitly requested windows otherwise expose a blank shell while the
      // initial container is mounting.
      show: false,
      backgroundColor: windowBackground,
      icon: process.env.NODE_ENV === 'development'
        ? path.join(__dirname, '../../_icons/iconColor.png')
        : path.join(__dirname, '../_icons/iconColor.png'),
      autoHideMenuBar: true,
      // useContentSize: true,
      webPreferences: {
        webSecurity: false,
        backgroundThrottling: false,
        preload: process.env.NODE_ENV === 'development'
          ? path.resolve(__dirname, '../../dist/preload.js')
          : path.resolve(__dirname, 'preload.js')
      },
      minWidth: 340,
      minHeight: 380,
      ...savedBounds
        ? {
            x: savedBounds.x,
            y: savedBounds.y,
            width: savedBounds.width,
            height: savedBounds.height
          }
        : {
            width: 1200,
            height: 800
          }
    })
    const kdeWindowIdentity = monitorsKdeWaylandWindowState
      ? `\u2063${newWindow.id.toString(2).replaceAll('0', '\u200b').replaceAll('1', '\u200c')}`
      : ''
    let kdeWindowIdentityReleased = false
    const formatKdeWindowTitle = title => (
      kdeWindowIdentityReleased || kdeWindowIdentity === '' || title.endsWith(kdeWindowIdentity)
        ? title
        : `${title}${kdeWindowIdentity}`
    )
    const applyKdeWindowIdentity = () => {
      const title = formatKdeWindowTitle(newWindow.getTitle())
      if (title !== newWindow.getTitle()) newWindow.setTitle(title)
    }
    const releaseKdeWindowIdentity = () => {
      kdeWindowIdentityReleased = true
      if (kdeWindowIdentity !== '' && !newWindow.isDestroyed() && newWindow.getTitle().endsWith(kdeWindowIdentity)) {
        newWindow.setTitle(newWindow.getTitle().slice(0, -kdeWindowIdentity.length))
      }
    }

    // The single BrowserWindow renderer owns window.open handling through its
    // TabManager; logical tabs do not create child webContents.

    // Initialize TabManager for this window
    const preloadPath = process.env.NODE_ENV === 'development'
      ? path.resolve(__dirname, '../../dist/preload.js')
      : path.resolve(__dirname, 'preload.js')

    const tabManager = new TabManager(
      newWindow,
      ROOT_APP_URL,
      preloadPath,
      sessionData?.sessionId,
      title => newWindow.setTitle(formatKdeWindowTitle(title))
    )

    // Forward the native window minimized state to the renderer. The renderer can't
    // reliably detect minimize on its own (`document.hidden` doesn't fire on Wayland),
    // so the auto Picture-in-Picture feature relies on these events instead.
    const sendMinimizedState = (minimized) => {
      if (!newWindow.isDestroyed() && !newWindow.webContents.isDestroyed()) {
        newWindow.webContents.send(IpcChannels.WINDOW_MINIMIZED_STATE, minimized)
      }
    }
    newWindow.on('minimize', () => sendMinimizedState(true))
    newWindow.on('restore', () => sendMinimizedState(false))
    // Cover minimize-to-tray (and app hide), where the window is hidden rather than minimized.
    newWindow.on('hide', () => sendMinimizedState(true))
    newWindow.on('show', () => sendMinimizedState(false))

    // Renderer focus events can be skipped on Windows when focus returns after
    // another application's window is closed. Forward the native state so
    // blur-triggered auto PiP can still re-embed the video. KDE Wayland checks
    // KWin first because desktop popups blur the Wayland surface without
    // switching away from the app's top-level window.
    const sendFocusedState = (focused) => {
      if (!newWindow.isDestroyed() && !newWindow.webContents.isDestroyed()) {
        newWindow.webContents.send(IpcChannels.WINDOW_FOCUSED_STATE, focused)
      }
    }
    if (monitorsKdeWaylandWindowState) {
      monitorKdeWaylandWindowState({
        browserWindow: newWindow,
        backend: kdeWaylandWindowStateBackend,
        applyWindowIdentity: applyKdeWindowIdentity,
        onFocusedState: sendFocusedState,
        onMinimizedState: sendMinimizedState,
        releaseWindowIdentity: releaseKdeWindowIdentity,
      })
    } else {
      newWindow.on('focus', () => sendFocusedState(true))
      newWindow.on('blur', () => sendFocusedState(false))
    }

    if (isTrayOnMinimizeSupported) {
      function manageTray(window, removeWindow = false) {
        if (tray) {
          if (!removeWindow) {
            trayWindows.push(window)
            createTrayContextMenu()
          } else if (trayWindows.some(item => item.id === window.id)) {
            trayClick(window)
          }
        } else {
          const icon = process.env.NODE_ENV === 'development'
            ? path.join(__dirname, '..', '..', '_icons', 'iconColor.png')
            : path.join(__dirname, '..', '_icons', 'iconColor.png')

          tray = new Tray(icon)

          tray.setIgnoreDoubleClickEvents(true)
          tray.setToolTip('OpenTubeX')

          trayWindows = [window]
          createTrayContextMenu()

          if (process.platform !== 'linux') {
            tray.on('click', (event) => {
              if (trayWindows.length === 1) { trayClick(trayWindows[0]) }
            })
          }
        }
      }

      newWindow.on('minimize', () => {
        if (trayOnMinimize) {
          // Workaround for https://github.com/electron/electron/issues/49253
          if (process.platform === 'linux') {
            setTimeout(() => {
              newWindow.restore()
              newWindow.hide()
            }, 100)
          } else {
            newWindow.hide()
          }

          manageTray(newWindow)

          if (newWindow === mainWindow) {
            // A timer is needed because getFocusedWindow doesn't update until the minimize event ends
            setTimeout(() => {
              const newMainWindow = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows().find(window => window.isVisible())
              if (newMainWindow) { mainWindow = newMainWindow }
            }, 100)
          }
        }
      })

      newWindow.on('maximize', () => {
        if (trayOnMinimize) { trayMaximizedWindows[newWindow.id] = true }
      })

      newWindow.on('unmaximize', () => {
        if (trayOnMinimize) { delete trayMaximizedWindows[newWindow.id] }
      })
    }

    if (replaceMainWindow) {
      mainWindow = newWindow
    }

    if (savedMaximized) {
      newWindow.maximize()
    }

    // If called multiple times
    // Duplicate menu items will be added
    if (replaceMainWindow) {
      setMenu()
    }

    const showWindow = () => {
      if (newWindow.isVisible()) {
        // only open the dev tools if they aren't already open
        if (process.env.NODE_ENV === 'development' && !newWindow.webContents.isDevToolsOpened()) {
          newWindow.webContents.openDevTools({ activate: false })
        }
        return
      }

      if (isTrayOnMinimizeSupported && trayOnMinimize && trayWindows.length > 0) {
        trayClick(newWindow)
      } else {
        applyKdeWindowIdentity()
        newWindow.show()
        newWindow.focus()
      }

      if (process.env.NODE_ENV === 'development') {
        newWindow.webContents.openDevTools({ activate: false })
      }
    }

    // Initialize tabs - try to restore session or create initial tab
    const initializeTabs = async () => {
      // Restore tabs from the pre-loaded session data if one was passed in
      // (the startup flow loads every window's session up-front so that each
      // window gets its own data).
      let sessionRestored = false
      if (!windowStartupUrl) {
        sessionRestored = await tabManager.restoreFromData(sessionData, {
          loadInactiveTabs: loadInactiveTabsOnRestore,
          restoreTabLoadState: restoreTabLoadStateOnRestore
        })
      }

      if (!sessionRestored) {
        // Create initial tab
        if (windowStartupUrl != null) {
          tabManager.createTab({ url: windowStartupUrl, makeActive: true })
        } else {
          await tabManager.createTabWithPreference({ makeActive: true })
        }
      }

      // Load the shared Vue shell exactly once. Logical tab routes are projected
      // by the renderer after it reconciles the main-owned metadata.
      await newWindow.loadURL(ROOT_APP_URL)
      // The shared shell has finished loading and can paint its themed frame.
      // Do not keep the whole native window hidden while the initial logical
      // route finishes mounting; that made startup feel substantially slower.
      showWindow()
      await tabManager.waitForInitialPresentation()
      if (typeof searchQueryText === 'string' && searchQueryText.length > 0) {
        newWindow.webContents.send(IpcChannels.UPDATE_SEARCH_INPUT_TEXT, searchQueryText)
      }
    }

    // Kick off tab initialization (errors are logged but shouldn't crash the app)
    initializeTabs().catch(error => {
      console.error('Failed to initialize tabs', error)
      showWindow()
    })

    // Renderer presentation readiness above has a bounded timeout, so the
    // window cannot remain hidden if the initial logical tab fails to mount.

    newWindow.on('enter-html-full-screen', () => {
      htmlFullscreenWindowIds.add(newWindow.id)
    })

    newWindow.on('leave-html-full-screen', () => {
      htmlFullscreenWindowIds.delete(newWindow.id)
    })

    newWindow.on('close', async (event) => {
      const wasLastWindow = BrowserWindow.getAllWindows().length === 1

      if (!isQuitting && !closeConfirmedWindowIds.delete(newWindow.id) &&
          (wasLastWindow || tabManager.tabs.size > 1)) {
        event.preventDefault()

        let confirmed = wasLastWindow
          ? await confirmCloseApp(newWindow)
          : await confirmCloseWindowWithMultipleTabs(newWindow, tabManager.tabs.size)
        const openWindowCount = BrowserWindow.getAllWindows()
          .filter(window => !closingWindowIds.has(window.id)).length
        if (confirmed && !wasLastWindow && openWindowCount === 1) {
          confirmed = await confirmCloseApp(newWindow)
        }
        if (confirmed) {
          closeConfirmedWindowIds.add(newWindow.id)
          newWindow.close()
        }

        return
      }

      closingWindowIds.add(newWindow.id)

      // A confirmation can remain open while another window closes. Recompute
      // this after the async prompt so the session decision uses current state.
      const isLastWindow = BrowserWindow.getAllWindows()
        .filter(window => window.id === newWindow.id || !closingWindowIds.has(window.id))
        .length === 1

      // returns true if the element existed in the set
      const htmlFullscreen = htmlFullscreenWindowIds.delete(newWindow.id)

      const value = {
        ...newWindow.getNormalBounds(),
        maximized: newWindow.isMaximized(),

        // Don't save the full screen state if it was triggered by an HTML API e.g. the video player
        fullScreen: newWindow.isFullScreen() && !htmlFullscreen
      }

      // The current window is still part of getAllWindows() at the point the
      // `close` event fires, so length === 1 means we're closing the last one.
      // Preserve this window's tab session when:
      //   - the app is quitting (so every open window comes back on next launch)
      //   - or this is the last window closing (single-window sessions have
      //     always been restored historically, keep that behavior)
      // Otherwise the user manually closed one of several windows and we don't
      // want it resurrected the next time the app runs.
      if (isQuitting || isLastWindow) {
        try {
          await tabManager._saveSession()
        } catch (err) {
          console.error('Failed to persist tab session on window close', err)
        }
      } else {
        try {
          await tabManager.clearSession()
        } catch (err) {
          console.error('Failed to clear tab session on window close', err)
        }
      }

      // Keep the legacy single-window `bounds` setting up to date so brand-new
      // windows (with no saved session of their own) still open at the user's
      // preferred size/position.
      if (isLastWindow) {
        await baseHandlers.settings._updateBounds(value)
      }
    })

    newWindow.once('closed', () => {
      closingWindowIds.delete(newWindow.id)
      const allWindows = BrowserWindow.getAllWindows()
      if (allWindows.length !== 0 && newWindow === mainWindow) {
        // Replace mainWindow to avoid accessing `mainWindow.webContents`
        // Which raises "Object has been destroyed" error
        mainWindow = allWindows[0]
      }

      stopPowerSaveBlockerForWindow(newWindow)
    })

    return newWindow
  }

  /**
   * @param {string | null | undefined} url
   * @param {object} [options]
   * @param {boolean} [options.replaceMainWindow]
   * @param {boolean} [options.showWindowNow]
   * @param {boolean} [options.reuseEmptyRootTab]
   * @returns {Promise<import('electron').BrowserWindow>}
   */
  async function createWindowForOpenUrl(url, options = {}) {
    const { reuseEmptyRootTab = false, ...createWindowOptions } = options
    const directOpenUrl = getDirectOpenUrl(url)
    const newWindow = await createWindow({
      ...createWindowOptions,
      ...(directOpenUrl ? { windowStartupUrl: directOpenUrl } : {})
    })

    if (!directOpenUrl) {
      openUrlInWindow(newWindow, url, { reuseEmptyRootTab })
    }

    return newWindow
  }

  /**
   * @param {import('electron').BrowserWindow | undefined | null} browserWindow
   * @param {string | null | undefined} url
   * @param {{ reuseEmptyRootTab?: boolean }} [options]
   */
  function openUrlInWindow(browserWindow, url, options = {}) {
    if (!browserWindow || browserWindow.isDestroyed() || !url) {
      return
    }

    const tabManager = TabManager.getForWindow(browserWindow.id)
    if (tabManager) {
      openUrlInTab(tabManager, url, options).catch(error => {
        console.error('Failed to open URL in a tab:', error)
      })
      return
    }

    sendOpenUrlToWebContents(browserWindow.webContents, url)
  }

  /**
   * @param {TabManager} tabManager
   * @param {string} url
   * @param {{ reuseEmptyRootTab?: boolean }} options
   */
  async function openUrlInTab(tabManager, url, options) {
    const directOpenUrl = getDirectOpenUrl(url)
    if (directOpenUrl) {
      await tabManager.createTabWithPreference({
        url: directOpenUrl,
        makeActive: true
      })
      return
    }

    let tab = options.reuseEmptyRootTab ? getReusableOpenUrlTab(tabManager) : null

    if (!tab) {
      tab = await tabManager.createTabWithPreference({
        url: ROOT_APP_URL,
        makeActive: true
      })
    }

    sendOpenUrlToWebContents(tabManager.browserWindow.webContents, url, tab.id)
  }

  /**
   * @param {TabManager} tabManager
   * @returns {import('./tabs/TabManager').TabInfo | null}
   */
  function getReusableOpenUrlTab(tabManager) {
    if (tabManager.tabs.size !== 1 || !tabManager.activeTabId) {
      return null
    }

    const activeTab = tabManager.tabs.get(tabManager.activeTabId)
    return activeTab && TabManager.getOpenTubeXRoute(activeTab.url) === '/'
      ? activeTab
      : null
  }

  /**
   * @param {string | null | undefined} url
   * @returns {string | null}
   */
  function getDirectOpenUrl(url) {
    if (typeof url !== 'string' || url.trim().length === 0) {
      return null
    }

    const parsed = URL.parse(url)
    if (!parsed) {
      return null
    }

    if (isOpenTubeXUrl(parsed)) {
      return url
    }

    const videoParams = getDirectVideoParams(parsed)
    if (videoParams.videoId) {
      return createAppRouteUrl(`/watch/${videoParams.videoId}`, {
        timestamp: videoParams.timestamp,
        playlistId: videoParams.playlistId,
        commentId: videoParams.commentId,
        short: videoParams.isShort ? 'true' : null
      })
    }

    const playlistId = getDirectPlaylistId(parsed)
    if (playlistId) {
      return createAppRouteUrl(`/playlist/${encodeURIComponent(playlistId)}`, getRemainingUrlQuery(parsed, ['list']))
    }

    const searchQuery = getDirectSearchQuery(parsed)
    if (searchQuery) {
      return createAppRouteUrl(`/search/${encodeURIComponent(searchQuery)}`, getRemainingUrlQuery(parsed, ['q', 'search_query']))
    }

    const hashtag = parsed.pathname.match(/^\/hashtag\/(?<tag>[^#&/?]+)\/?$/)?.groups?.tag
    if (hashtag) {
      return createAppRouteUrl(`/hashtag/${encodeURIComponent(hashtag)}`)
    }

    const postId = parsed.pathname.match(/^\/post\/(?<postId>.+)/)?.groups?.postId
    if (postId) {
      return createAppRouteUrl(`/post/${encodeURIComponent(postId)}`, {
        authorId: parsed.searchParams.get('ucid')
      })
    }

    const feedType = parsed.pathname.match(/^\/feed\/(?<type>trending|subscriptions|history|playlists|you|library)/)?.groups?.type
    if (feedType) {
      return createAppRouteUrl(feedType === 'playlists' || feedType === 'you' || feedType === 'library'
        ? '/userplaylists'
        : `/${feedType}`)
    }

    return null
  }

  /**
   * @param {URL} url
   * @returns {{ videoId: string | null, timestamp: string | null, playlistId: string | null, commentId: string | null, isShort: boolean }}
   */
  function getDirectVideoParams(url) {
    const params = {
      videoId: null,
      timestamp: null,
      playlistId: null,
      commentId: null,
      isShort: false
    }

    const setVideoId = (value) => {
      const videoId = getYoutubeId(value)
      if (videoId) {
        params.videoId = videoId
        params.timestamp = getDirectTimestamp(url)
        params.playlistId = url.searchParams.get('list')
        params.commentId = url.searchParams.get('lc')
      }
    }

    if (url.pathname === '/watch') {
      setVideoId(url.searchParams.get('v'))
    } else if (url.hostname === 'youtu.be') {
      setVideoId(url.pathname.slice(1))
    } else {
      const videoPath = url.pathname.match(/^\/(?:embed|shorts|live)\/(?<videoId>[\w-]+)/)?.groups?.videoId
      params.isShort = url.pathname.startsWith('/shorts/')
      setVideoId(videoPath)
    }

    return params
  }

  /**
   * @param {string | null | undefined} value
   * @returns {string | null}
   */
  function getYoutubeId(value) {
    return typeof value === 'string'
      ? value.match(/^[\w-]{11}/)?.[0] ?? null
      : null
  }

  /**
   * @param {URL} url
   * @returns {string | null}
   */
  function getDirectTimestamp(url) {
    const timestamp = url.searchParams.get('t')
    if (!timestamp) {
      return null
    }

    const timeParts = timestamp.match(/^(?:(?<hours>\d+)h)?(?:(?<minutes>\d+)m)?(?:(?<seconds>\d+)s?)?$/)?.groups
    if (!timeParts || (!timeParts.hours && !timeParts.minutes && !timeParts.seconds)) {
      return timestamp
    }

    return String(
      Number(timeParts.seconds ?? 0) +
      (Number(timeParts.minutes ?? 0) * 60) +
      (Number(timeParts.hours ?? 0) * 3600)
    )
  }

  /**
   * @param {URL} url
   * @returns {string | null}
   */
  function getDirectPlaylistId(url) {
    if (!/^(\/playlist\/?|\/embed\/videoseries\/?)$/.test(url.pathname)) {
      return null
    }

    return url.searchParams.get('list')
  }

  /**
   * @param {URL} url
   * @returns {string | null}
   */
  function getDirectSearchQuery(url) {
    if (!/^(\/results|\/search\/?)$/.test(url.pathname)) {
      return null
    }

    return url.searchParams.get('search_query') ?? url.searchParams.get('q')
  }

  /**
   * @param {URL} url
   * @param {string[]} excludedKeys
   * @returns {Record<string, string>}
   */
  function getRemainingUrlQuery(url, excludedKeys) {
    const excluded = new Set(excludedKeys)
    const query = {}

    for (const [key, value] of url.searchParams) {
      if (!excluded.has(key)) {
        query[key] = value
      }
    }

    return query
  }

  /**
   * @param {string} path
   * @param {Record<string, string | number | null | undefined>} [query]
   * @returns {string}
   */
  function createAppRouteUrl(path, query = {}) {
    const searchParams = new URLSearchParams()

    for (const [key, value] of Object.entries(query)) {
      if (value !== null && value !== undefined && String(value).length > 0) {
        searchParams.set(key, String(value))
      }
    }

    const search = searchParams.toString()
    return `${ROOT_APP_URL}#${path}${search.length > 0 ? `?${search}` : ''}`
  }

  /**
   * @param {import('electron').WebContents} webContents
   * @param {string} url
   * @param {string | null} [tabId]
   * @returns {boolean}
   */
  function sendOpenUrlToWebContents(webContents, url, tabId = null) {
    const payload = { url, tabId }
    if (
      !webContents.isDestroyed() &&
      openUrlReadyWebContentsIds.has(webContents.id) &&
      isOpenTubeXUrl(webContents.getURL())
    ) {
      webContents.send(IpcChannels.OPEN_URL, payload)
      return true
    }

    const pendingOpenUrls = pendingOpenUrlsByWebContentsId.get(webContents.id) ?? []
    pendingOpenUrls.push(payload)
    // Protocol activations are user-driven, but keep the startup queue bounded
    // in case a desktop environment repeatedly delivers the same URL.
    if (pendingOpenUrls.length > 20) {
      pendingOpenUrls.shift()
    }
    pendingOpenUrlsByWebContentsId.set(webContents.id, pendingOpenUrls)
    return false
  }

  /**
   * @param {import('electron').IpcMainEvent} event
   */
  function openPendingUrlForReadyWebContents(event) {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    openUrlReadyWebContentsIds.add(event.sender.id)

    const pendingOpenUrls = pendingOpenUrlsByWebContentsId.get(event.sender.id)
    if (!pendingOpenUrls || !BrowserWindow.fromWebContents(event.sender)) {
      return
    }

    pendingOpenUrlsByWebContentsId.delete(event.sender.id)
    for (const pendingOpenUrl of pendingOpenUrls) {
      event.reply(IpcChannels.OPEN_URL, pendingOpenUrl)
    }
  }

  ipcMain.on(IpcChannels.APP_READY, (event) => {
    openPendingUrlForReadyWebContents(event)
  })

  ipcMain.on(IpcChannels.SHOW_TOAST, (event, message, time, icon) => {
    if (
      !isOpenTubeXUrl(event.senderFrame.url) ||
      typeof message !== 'string' ||
      (time !== null && typeof time !== 'number') ||
      (icon != null && (!Array.isArray(icon) || icon.length !== 2 || icon.some(part => typeof part !== 'string')))
    ) {
      return
    }

    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.webContents.isDestroyed() && isOpenTubeXUrl(window.webContents.getURL())) {
        window.webContents.send(IpcChannels.SHOW_TOAST, message, time, icon ?? null)
      }
    }
  })

  const isValidLiveReminderSender = event => isOpenTubeXUrl(event.senderFrame.url)
  const isValidVideoId = videoId => typeof videoId === 'string' && /^[\w-]{11}$/.test(videoId)

  ipcMain.handle(IpcChannels.LIVE_REMINDER_GET, (event, videoId) => {
    if (!isValidLiveReminderSender(event) || !isValidVideoId(videoId) || !supportsNativeNotifications(Notification)) {
      return null
    }
    return liveReminderManager.get(videoId)
  })

  ipcMain.handle(IpcChannels.LIVE_REMINDER_LIST, (event) => {
    if (!isValidLiveReminderSender(event) || !supportsNativeNotifications(Notification)) {
      return []
    }
    return liveReminderManager.list()
  })

  ipcMain.handle(IpcChannels.LIVE_REMINDER_SCHEDULE, (event, reminder) => {
    if (
      !isValidLiveReminderSender(event) ||
      !supportsNativeNotifications(Notification) ||
      !isValidVideoId(reminder?.videoId) ||
      !Number.isFinite(reminder?.startTimestamp) ||
      reminder.startTimestamp <= Date.now() ||
      typeof reminder.notificationTitle !== 'string' ||
      reminder.notificationTitle.length === 0 ||
      reminder.notificationTitle.length > 200 ||
      typeof reminder.notificationBody !== 'string' ||
      reminder.notificationBody.length === 0 ||
      reminder.notificationBody.length > 500
    ) {
      return false
    }
    return liveReminderManager.schedule(reminder)
  })

  ipcMain.handle(IpcChannels.LIVE_REMINDER_CANCEL, (event, videoId) => {
    if (!isValidLiveReminderSender(event) || !isValidVideoId(videoId)) {
      return false
    }
    return liveReminderManager.cancel(videoId)
  })

  const MAX_VIDEO_METADATA_THUMBNAIL_BYTES = 5 * 1024 * 1024
  const MAX_VIDEO_METADATA_THUMBNAIL_REDIRECTS = 3
  const VIDEO_METADATA_THUMBNAIL_MIME_TYPES = new Set([
    'image/avif',
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/webp'
  ])
  let videoMetadataCacheGeneration = 0

  async function isAllowedVideoMetadataThumbnailUrl(parsedUrl, allowedPrivateOrigin) {
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) return false
    if (parsedUrl.origin === allowedPrivateOrigin) return true

    const hostname = parsedUrl.hostname.startsWith('[') && parsedUrl.hostname.endsWith(']')
      ? parsedUrl.hostname.slice(1, -1)
      : parsedUrl.hostname

    try {
      const { endpoints } = await session.defaultSession.resolveHost(hostname, {
        cacheUsage: 'disallowed'
      })
      return endpoints.length > 0 && endpoints.every(({ address }) => !isNonPublicNetworkAddress(address))
    } catch {
      return false
    }
  }

  async function fetchVideoMetadataThumbnail(url) {
    if (typeof url !== 'string' || url.length > 20_000) return null

    let parsedUrl
    try {
      parsedUrl = new URL(url)
    } catch {
      return null
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) return null

    let allowedPrivateOrigin = null
    try {
      const configuredInstance = (await baseHandlers.settings._findOne('defaultInvidiousInstance'))?.value
      if (typeof configuredInstance === 'string' && configuredInstance !== '') {
        allowedPrivateOrigin = new URL(configuredInstance).origin
      }
    } catch { }

    const abortController = new AbortController()
    const timeout = setTimeout(() => abortController.abort(), 15_000)

    try {
      let response

      for (let redirectCount = 0; redirectCount <= MAX_VIDEO_METADATA_THUMBNAIL_REDIRECTS; redirectCount += 1) {
        if (!await isAllowedVideoMetadataThumbnailUrl(parsedUrl, allowedPrivateOrigin)) return null

        response = await net.fetch(parsedUrl.href, {
          credentials: 'omit',
          redirect: 'manual',
          signal: abortController.signal
        })

        if (response.status < 300 || response.status >= 400) break
        if (redirectCount === MAX_VIDEO_METADATA_THUMBNAIL_REDIRECTS) return null

        const location = response.headers.get('location')
        if (location === null) return null

        await response.body?.cancel()
        parsedUrl = new URL(location, parsedUrl)
        if (parsedUrl.href.length > 20_000) return null
      }

      if (!response) return null
      const mimeType = response.headers.get('content-type')?.split(';', 1)[0].toLowerCase()
      const contentLength = Number(response.headers.get('content-length'))

      if (
        !response.ok ||
        !VIDEO_METADATA_THUMBNAIL_MIME_TYPES.has(mimeType) ||
        (Number.isFinite(contentLength) && contentLength > MAX_VIDEO_METADATA_THUMBNAIL_BYTES) ||
        !response.body
      ) {
        return null
      }

      const chunks = []
      let byteLength = 0
      const reader = response.body.getReader()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        byteLength += value.byteLength
        if (byteLength > MAX_VIDEO_METADATA_THUMBNAIL_BYTES) {
          await reader.cancel()
          return null
        }
        chunks.push(Buffer.from(value))
      }

      return `data:${mimeType};base64,${Buffer.concat(chunks).toString('base64')}`
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.warn('Could not cache the video thumbnail', error)
      }
      return null
    } finally {
      clearTimeout(timeout)
    }
  }

  ipcMain.handle(IpcChannels.VIDEO_METADATA_CACHE_UPDATE, async (event, metadata) => {
    if (!isOpenTubeXUrl(event.senderFrame.url) || !isValidVideoId(metadata?.videoId)) {
      return null
    }

    const generation = videoMetadataCacheGeneration
    const thumbnail = await fetchVideoMetadataThumbnail(metadata.thumbnailUrl)
    if (generation !== videoMetadataCacheGeneration) return null

    return updateVideoMetadataCache({ ...metadata, thumbnail })
  })

  ipcMain.handle(IpcChannels.VIDEO_METADATA_CACHE_CLEAR, async (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) return false

    videoMetadataCacheGeneration += 1
    await clearVideoMetadataCache()
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.webContents.isDestroyed() && isOpenTubeXUrl(window.webContents.getURL())) {
        window.webContents.send(IpcChannels.VIDEO_METADATA_CACHE_CLEARED)
      }
    }
    return true
  })

  ipcMain.handle(IpcChannels.VIDEO_METADATA_CACHE_GET_SIZE, async (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) return 0
    return getVideoMetadataCacheSize()
  })

  ipcMain.handle(IpcChannels.STORAGE_GET_USAGE, async (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) return {}
    return getStorageUsage()
  })

  ipcMain.handle(IpcChannels.STORAGE_CLEAR, async (event, category) => {
    if (!isOpenTubeXUrl(event.senderFrame.url) || !event.sender.isFocused()) return false
    return clearStorage(category)
  })

  ipcMain.handle(IpcChannels.STORAGE_COMPACT_DATABASES, async (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) return false
    return compactStorageDatabases()
  })

  ipcMain.handle(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_ACQUIRE, async (event, tabId, feedTab) => {
    const canAcquire = () => {
      const manager = TabManager.getFromWebContents(event.sender)
      return manager != null &&
        typeof tabId === 'string' &&
        manager.activeTabId === tabId &&
        !event.sender.isDestroyed() &&
        isOpenTubeXUrl(event.senderFrame.url)
    }

    if (!canAcquire()) {
      return false
    }

    const activeIpBlockRecovery = ipBlockRecoveryScriptPromise
    if (activeIpBlockRecovery != null) {
      try {
        await activeIpBlockRecovery
      } catch {
        // Refresh after the recovery attempt finishes, even when it failed.
      }
    }

    if (
      !canAcquire() ||
      (subscriptionAutoRefreshOwner && !subscriptionAutoRefreshOwner.webContents.isDestroyed())
    ) {
      return false
    }

    const owner = event.sender
    subscriptionAutoRefreshOwner = {
      webContents: owner,
      tabId,
      feedTab: typeof feedTab === 'string' ? feedTab : null
    }
    subscriptionAutoRefreshProgress = 0
    owner.once('destroyed', () => {
      if (subscriptionAutoRefreshOwner?.webContents.id === owner.id) {
        subscriptionAutoRefreshOwner = null
        subscriptionAutoRefreshProgress = 0
        broadcastSubscriptionAutoRefreshState()
      }
    })
    broadcastSubscriptionAutoRefreshState()
    return true
  })

  ipcMain.handle(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_GET_STATE, (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return { inProgress: false, percentage: 0, tab: null }
    }

    return {
      inProgress: isSubscriptionAutoRefreshInProgress(),
      percentage: subscriptionAutoRefreshProgress,
      tab: subscriptionAutoRefreshOwner?.feedTab ?? null
    }
  })

  ipcMain.on(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_SET_PROGRESS, (event, tabId, percentage) => {
    if (
      subscriptionAutoRefreshOwner?.webContents.id !== event.sender.id ||
      subscriptionAutoRefreshOwner?.tabId !== tabId ||
      !Number.isFinite(percentage)
    ) {
      return
    }

    subscriptionAutoRefreshProgress = Math.min(100, Math.max(0, percentage))
    broadcastSubscriptionAutoRefreshState()
  })

  ipcMain.on(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_CANCEL, (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    requestSubscriptionAutoRefreshCancellation()
  })

  function isSubscriptionAutoRefreshInProgress() {
    return subscriptionAutoRefreshOwner !== null && !subscriptionAutoRefreshOwner.webContents.isDestroyed()
  }

  // Any window may ask for the cancellation, only the one running the refresh
  // can carry it out
  function requestSubscriptionAutoRefreshCancellation() {
    if (isSubscriptionAutoRefreshInProgress()) {
      subscriptionAutoRefreshOwner.webContents.send(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_CANCEL)
    }
  }

  ipcMain.handle(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_RELEASE, (event, tabId) => {
    if (
      subscriptionAutoRefreshOwner?.webContents.id === event.sender.id &&
      subscriptionAutoRefreshOwner?.tabId === tabId
    ) {
      subscriptionAutoRefreshOwner = null
      subscriptionAutoRefreshProgress = 0
      broadcastSubscriptionAutoRefreshState()
    }
  })

  function broadcastSubscriptionAutoRefreshState() {
    const state = {
      inProgress: isSubscriptionAutoRefreshInProgress(),
      percentage: subscriptionAutoRefreshProgress,
      tab: subscriptionAutoRefreshOwner?.feedTab ?? null
    }

    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.webContents.isDestroyed() && isOpenTubeXUrl(window.webContents.getURL())) {
        window.webContents.send(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_STATE_CHANGED, state)
      }
    }
  }

  ipcMain.on(IpcChannels.SET_WINDOW_TITLE, (event, payload) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    const title = payload?.title
    const tabId = payload?.tabId
    const manager = TabManager.getFromWebContents(event.sender)
    const tab = typeof tabId === 'string' ? manager?.tabs.get(tabId) : null

    if (manager && tab && typeof title === 'string') {
      manager.applyTabTitle(tab, title)
    }
  })

  function relaunch() {
    if (process.env.NODE_ENV === 'development') {
      app.exit(parseInt(process.env.OPENTUBEX_RELAUNCH_EXIT_CODE))
      return
    }

    // The AppImage and Windows portable formats must be accounted for
    // because `process.execPath` points at the temporarily extracted
    // executables, not the executables themselves
    //
    // It's possible to detect these formats and identify their
    // executables' paths by checking the environmental variables
    const { env: { APPIMAGE, PORTABLE_EXECUTABLE_FILE } } = process

    if (!APPIMAGE) {
      // If it's a Windows portable, PORTABLE_EXECUTABLE_FILE will
      // hold a value.
      // Otherwise, `process.execPath` should be used instead.
      app.relaunch({
        args: process.argv.slice(1),
        execPath: PORTABLE_EXECUTABLE_FILE || process.execPath
      })
    } else {
      // If it's an AppImage, things must be done the "hard way"
      // `app.relaunch` doesn't work because of FUSE limitations
      // Spawn a new process using the APPIMAGE env variable
      const subprocess = cp.spawn(APPIMAGE, { detached: true, stdio: 'ignore' })
      subprocess.unref()
    }

    isQuitConfirmed = true
    app.quit()
  }

  ipcMain.once(IpcChannels.RELAUNCH_REQUEST, () => {
    relaunch()
  })

  nativeTheme.on('updated', () => {
    const allWindows = BrowserWindow.getAllWindows()

    allWindows.forEach((window) => {
      if (!window.webContents.isDestroyed() && isOpenTubeXUrl(window.webContents.getURL())) {
        window.webContents.send(IpcChannels.NATIVE_THEME_UPDATE, nativeTheme.shouldUseDarkColors)
      }
    })
  })

  ipcMain.handle(IpcChannels.GENERATE_PO_TOKEN, (event, videoId, context, initialAttestationData, ytConfig) => {
    if (isOpenTubeXUrl(event.senderFrame.url)) {
      return generatePoToken(videoId, context, initialAttestationData, ytConfig, proxyUrl)
    }
  })

  ipcMain.on(IpcChannels.ENABLE_PROXY, (event, url) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    session.defaultSession.setProxy({
      proxyRules: url
    })
    proxyUrl = url
    session.defaultSession.closeAllConnections()
  })

  ipcMain.on(IpcChannels.DISABLE_PROXY, (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    session.defaultSession.setProxy({})
    proxyUrl = undefined
    session.defaultSession.closeAllConnections()
  })

  // #region navigation history

  ipcMain.handle(IpcChannels.GET_NAVIGATION_HISTORY, ({ senderFrame }) => {
    if (!isOpenTubeXUrl(senderFrame.url)) {
      return
    }

    // Logical tab history is renderer-owned. The retained API returns an empty
    // list for older callers; TopNav reads the active tab runtime directly.
    return []
  })

  // #endregion navigation history

  ipcMain.handle(IpcChannels.GET_DEVICE_NAME, (event) => {
    if (isOpenTubeXUrl(event.senderFrame.url)) {
      return hostname()
    }
  })

  ipcMain.handle(IpcChannels.GET_DEVICE_INFO, async (event) => {
    if (isOpenTubeXUrl(event.senderFrame.url)) {
      const linuxDistribution = process.platform === 'linux'
        ? await getLinuxDistributionInfo()
        : null
      return {
        platform: linuxDistribution?.platform || process.platform,
        architecture: process.arch,
        release: linuxDistribution?.release || release(),
      }
    }
  })

  ipcMain.handle(IpcChannels.GET_SYSTEM_LOCALE, (event) => {
    if (isOpenTubeXUrl(event.senderFrame.url)) {
      // we should switch to getPreferredSystemLanguages at some point and iterate through until we find a supported locale
      return app.getSystemLocale()
    }
  })

  ipcMain.handle(IpcChannels.GET_SYSTEM_FONTS, async (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) return []

    const fonts = await getFonts({ disableQuoting: true })
    return [...new Set(fonts
      .filter(font => typeof font === 'string')
      .map(font => font.trim())
      .filter(Boolean))]
  })

  ipcMain.handle(IpcChannels.IS_WAYLAND_PLATFORM, (event) => {
    if (isOpenTubeXUrl(event.senderFrame.url)) {
      return isWaylandPlatform
    }
  })

  ipcMain.handle(IpcChannels.SUPPORTS_AUTO_PICTURE_IN_PICTURE_MINIMIZE, async (event) => {
    if (isOpenTubeXUrl(event.senderFrame.url)) {
      return supportsAutoPictureInPictureMinimize
    }
  })

  ipcMain.on(IpcChannels.OPEN_PROFILE_DIRECTORY, (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    shell.openPath(app.getPath('userData')).then((error) => {
      if (error) {
        console.error(`Unable to open profile directory: ${error}`)
      }
    }).catch((error) => {
      console.error('Unable to open profile directory', error)
    })
  })

  /**
   * @param {import('electron').WebContents} webContents
   * @param {string | undefined} [currentPath]
   */
  async function chooseDefaultFolder(webContents, currentPath) {
    if (typeof currentPath !== 'string' || currentPath.length === 0) {
      currentPath = app.getPath('pictures')
    }

    const dialogOptions = {
      defaultPath: currentPath,
      properties: ['openDirectory']
    }

    let result

    const window = BrowserWindow.fromWebContents(webContents)
    if (window) {
      result = await dialog.showOpenDialog(window, dialogOptions)
    } else {
      result = await dialog.showOpenDialog(dialogOptions)
    }

    if (result.canceled) {
      return
    }

    const settingId = 'screenshotFolderPath'

    await baseHandlers.settings.upsert(settingId, result.filePaths[0])

    const syncPayload = {
      event: SyncEvents.GENERAL.UPSERT,
      data: {
        _id: settingId,
        value: result.filePaths[0]
      }
    }

    BrowserWindow.getAllWindows().forEach((window) => {
      if (isOpenTubeXUrl(window.webContents.getURL())) {
        window.webContents.send(IpcChannels.SYNC_SETTINGS, syncPayload)
      }
    })

    return result.filePaths[0]
  }

  /**
   * @param {import('electron').WebContents} webContents
   * @param {string | undefined} [currentPath]
   * @returns {Promise<string | undefined>}
   */
  async function chooseIpBlockRecoveryScript(webContents, currentPath) {
    if (typeof currentPath !== 'string' || currentPath.length === 0) {
      currentPath = app.getPath('home')
    }

    /** @type {import('electron').FileFilter[]} */
    const filters = process.platform === 'win32'
      ? [
          { name: 'Windows Script Files', extensions: ['bat', 'ps1', 'vbs'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      : [
          { name: 'Shell Script Files', extensions: ['sh'] },
          { name: 'All Files', extensions: ['*'] }
        ]

    const dialogOptions = {
      defaultPath: currentPath,
      properties: ['openFile'],
      filters
    }

    const window = BrowserWindow.fromWebContents(webContents)
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return undefined
    }

    return result.filePaths[0]
  }

  ipcMain.on(IpcChannels.CHOOSE_DEFAULT_FOLDER, async (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    const currentPath = (await baseHandlers.settings._findOne('screenshotFolderPath'))?.value

    await chooseDefaultFolder(event.sender, currentPath)
  })

  ipcMain.handle(IpcChannels.CHOOSE_IP_BLOCK_RECOVERY_SCRIPT, async (event, currentPath) => {
    if (
      !isOpenTubeXUrl(event.senderFrame.url) ||
      (currentPath != null && typeof currentPath !== 'string')
    ) {
      return
    }

    return await chooseIpBlockRecoveryScript(event.sender, currentPath)
  })

  ipcMain.handle(IpcChannels.WRITE_TO_DEFAULT_FOLDER, async (event, filename, arrayBuffer) => {
    if (
      !isOpenTubeXUrl(event.senderFrame.url) ||
      typeof filename !== 'string' ||
      !(arrayBuffer instanceof ArrayBuffer)) {
      return
    }

    const folderPath = (await baseHandlers.settings._findOne('screenshotFolderPath'))?.value

    let directory
    if (typeof folderPath === 'string' && folderPath.length > 0) {
      try {
        await asyncFs.access(path.normalize(folderPath), fsConstants.W_OK)
        directory = folderPath
      } catch {}
    }

    // if setting is not set or we do not have write access to the folder
    // prompt the user for a folder
    // not having write access can happen if the user copies their settings to different machines
    // or if they revoke a previously permitted folder in flatseal
    if (directory === undefined) {
      directory = await chooseDefaultFolder(event.sender)

      if (typeof directory !== 'string' || directory.length === 0) {
        return false
      }
    }

    directory = path.normalize(directory)

    const filePath = path.resolve(directory, filename)

    // Ensure that we are only writing inside of the expected directory
    // 'path.dirname' does not return trailing slash, remove it from 'directory' path to ensure consistent comparison
    if (path.dirname(filePath) !== directory.replace(/\/$/, '')) {
      throw new Error('Invalid save location')
    }

    try {
      await asyncFs.mkdir(directory, { recursive: true })

      await asyncFs.writeFile(filePath, new DataView(arrayBuffer))
    } catch (error) {
      console.error('WRITE_TO_DEFAULT_FOLDER failed', error)
      // throw a new error so that we don't expose the real error to the renderer
      // eslint-disable-next-line preserve-caught-error
      throw new Error('Failed to save')
    }

    return true
  })

  /**
   * @param {string} scriptPath
   * @returns {Promise<{ exitCode: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string }>}
   */
  async function executeIpBlockRecoveryScript(scriptPath) {
    const normalizedPath = path.normalize(path.resolve(scriptPath))
    const maxOutputLength = 16_384

    return new Promise((resolve, reject) => {
      const child = cp.spawn(normalizedPath, [], {
        shell: process.platform === 'win32',
        windowsHide: true
      })

      let stdout = ''
      let stderr = ''

      child.stdout?.on('data', (chunk) => {
        stdout += chunk.toString()
        if (stdout.length > maxOutputLength) {
          stdout = stdout.slice(-maxOutputLength)
        }
      })

      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString()
        if (stderr.length > maxOutputLength) {
          stderr = stderr.slice(-maxOutputLength)
        }
      })

      child.once('error', (error) => {
        reject(error)
      })

      child.once('close', (exitCode, signal) => {
        resolve({
          exitCode,
          signal,
          stdout,
          stderr
        })
      })
    })
  }

  const ipBlockRecoveryScriptCooldownMs = 10_000

  /**
   * @param {string} scriptPath
   * @returns {boolean} whether a new run was started
   */
  function startIpBlockRecoveryScript(scriptPath) {
    if (ipBlockRecoveryScriptPromise != null) {
      return false
    }

    ipBlockRecoveryScriptPromise = executeIpBlockRecoveryScript(scriptPath)
      .finally(() => {
        setTimeout(() => {
          ipBlockRecoveryScriptPromise = null
        }, ipBlockRecoveryScriptCooldownMs)
      })

    // The execute handler still observes and forwards the rejection. Attaching a
    // handler here prevents a fast spawn failure from becoming unhandled before
    // the renderer has time to invoke it.
    ipBlockRecoveryScriptPromise.catch(() => {})
    return true
  }

  /**
   * @param {import('electron').IpcMainInvokeEvent} event
   * @param {unknown} scriptPath
   * @returns {scriptPath is string}
   */
  function isValidIpBlockRecoveryRequest(event, scriptPath) {
    return isOpenTubeXUrl(event.senderFrame.url) &&
      typeof scriptPath === 'string' &&
      scriptPath.trim().length > 0
  }

  ipcMain.handle(IpcChannels.START_IP_BLOCK_RECOVERY_SCRIPT, (event, scriptPath) => {
    if (!isValidIpBlockRecoveryRequest(event, scriptPath)) {
      return false
    }

    return startIpBlockRecoveryScript(scriptPath)
  })

  ipcMain.handle(IpcChannels.EXECUTE_IP_BLOCK_RECOVERY_SCRIPT, async (event, scriptPath) => {
    if (
      !isValidIpBlockRecoveryRequest(event, scriptPath)
    ) {
      return
    }

    try {
      startIpBlockRecoveryScript(scriptPath)

      return await ipBlockRecoveryScriptPromise
    } catch (error) {
      console.error('EXECUTE_IP_BLOCK_RECOVERY_SCRIPT failed', error)
      throw new Error('Failed to execute script', { cause: error })
    }
  })

  ipcMain.handle(IpcChannels.WAIT_FOR_IP_BLOCK_RECOVERY_SCRIPT, async (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    try {
      await ipBlockRecoveryScriptPromise
    } catch {
      // Resume subscription fetching after the recovery attempt finishes.
    }
  })

  /** @type {Map<number, number>} */
  const activePowerSaveBlockers = new Map()

  ipcMain.handle(IpcChannels.TABS_SET_SHORTCUTS_BLOCKED, (event, blocked) => {
    if (!isOpenTubeXUrl(event.senderFrame.url) || typeof blocked !== 'boolean') {
      return
    }

    const browserWindow = BrowserWindow.fromWebContents(event.sender)
    if (!browserWindow) return

    if (blocked) {
      appShortcutBlockedWindows.add(browserWindow)
    } else {
      appShortcutBlockedWindows.delete(browserWindow)
    }
  })

  /**
   * @param {BrowserWindow} window
   */
  function stopPowerSaveBlockerForWindow(window) {
    const powerSaveBlockerId = activePowerSaveBlockers.get(window.id)

    if (typeof powerSaveBlockerId === 'number') {
      powerSaveBlocker.stop(powerSaveBlockerId)

      activePowerSaveBlockers.delete(window.id)
    }
  }

  ipcMain.on(IpcChannels.STOP_POWER_SAVE_BLOCKER, (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    const browserWindow = BrowserWindow.fromWebContents(event.sender)

    if (browserWindow) {
      stopPowerSaveBlockerForWindow(browserWindow)
    }
  })

  ipcMain.on(IpcChannels.START_POWER_SAVE_BLOCKER, (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    const browserWindow = BrowserWindow.fromWebContents(event.sender)

    if (browserWindow && !activePowerSaveBlockers.has(browserWindow.id)) {
      const powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep')

      activePowerSaveBlockers.set(browserWindow.id, powerSaveBlockerId)
    }
  })

  ipcMain.on(IpcChannels.CREATE_NEW_WINDOW, (event, path, query, searchQueryText) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    if (
      typeof path !== 'string' ||
      (query != null && typeof query !== 'object') ||
      (searchQueryText != null && typeof searchQueryText !== 'string')
    ) {
      return
    }

    if (path.charAt(0) !== '/') {
      path = `/${path}`
    }

    const searchParams = new URLSearchParams()
    for (const [key, value] of Object.entries(query ?? {})) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item !== null && item !== undefined) {
            searchParams.append(key, String(item))
          }
        }
      } else if (value !== null && value !== undefined) {
        searchParams.set(key, String(value))
      }
    }
    const search = searchParams.toString()
    const windowStartupUrl = `${ROOT_APP_URL}#${path}${search.length > 0 ? `?${search}` : ''}`

    createWindow({
      replaceMainWindow: false,
      showWindowNow: true,
      windowStartupUrl,
      searchQueryText
    })
  })

  // Handler for creating new tab from renderer
  ipcMain.on(IpcChannels.CREATE_NEW_TAB, (event, path, query) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    const manager = TabManager.getFromWebContents(event.sender)
    if (manager) {
      manager.createTabWithPreference({ route: path, query, makeActive: true }).catch(error => {
        console.error('Failed to create a new tab from the renderer:', error)
      })
    }
  })

  ipcMain.on(IpcChannels.OPEN_IN_EXTERNAL_PLAYER, handleOpenInExternalPlayer)

  ipcMain.handle(IpcChannels.YT_DLP_DOWNLOAD, (event, payload, retryDownloadId) => {
    const automaticDownloadAuthorized = subscriptionAutoRefreshOwner?.webContents.id === event.sender.id &&
      payload?.refreshOwnerTabId === subscriptionAutoRefreshOwner.tabId
    return handleYtDlpDownload(event, payload, retryDownloadId, automaticDownloadAuthorized)
  })

  ipcMain.on(IpcChannels.YT_DLP_CANCEL_DOWNLOAD, handleYtDlpCancelDownload)
  ipcMain.handle(IpcChannels.YT_DLP_CONTROL_DOWNLOAD, handleYtDlpControlDownload)
  ipcMain.handle(IpcChannels.YT_DLP_QUEUE_ACTION, handleYtDlpQueueAction)
  ipcMain.handle(IpcChannels.YT_DLP_LIST_DOWNLOADS, handleYtDlpListDownloads)
  ipcMain.handle(IpcChannels.YT_DLP_CLEAR_DOWNLOADS, handleYtDlpClearDownloads)
  ipcMain.handle(IpcChannels.YT_DLP_OPEN_DOWNLOAD, handleYtDlpOpenDownload)
  ipcMain.handle(IpcChannels.YT_DLP_REMOVE_DOWNLOAD, handleYtDlpRemoveDownload)

  ipcMain.handle(IpcChannels.YT_DLP_GET_INFO, handleYtDlpGetInfo)

  ipcMain.handle(IpcChannels.YT_DLP_GET_SUBTITLE, handleYtDlpGetSubtitle)
  ipcMain.handle(IpcChannels.YT_DLP_GET_PLAYBACK_INFO, handleYtDlpGetPlaybackInfo)
  ipcMain.handle(IpcChannels.YT_DLP_GET_RECOMMENDATIONS, handleYtDlpGetRecommendations)
  ipcMain.handle(IpcChannels.YT_DLP_PLAYBACK_CACHE_GET, handleYtDlpPlaybackCacheGet)
  ipcMain.handle(IpcChannels.YT_DLP_PLAYBACK_CACHE_SET, handleYtDlpPlaybackCacheSet)
  ipcMain.handle(IpcChannels.YT_DLP_PLAYBACK_CACHE_DELETE, handleYtDlpPlaybackCacheDelete)
  ipcMain.handle(IpcChannels.YT_DLP_PLAYBACK_CACHE_CLEAR, handleYtDlpPlaybackCacheClear)

  ipcMain.handle(IpcChannels.YT_DLP_CHECK_BINARY_UPDATE, handleYtDlpCheckBinaryUpdate)
  ipcMain.handle(IpcChannels.YT_DLP_DOWNLOAD_BINARY, handleYtDlpDownloadBinary)

  ipcMain.handle(IpcChannels.YT_DLP_CHOOSE_EXECUTABLE, async (event, currentPath) => {
    if (
      !isOpenTubeXUrl(event.senderFrame.url) ||
      (currentPath != null && typeof currentPath !== 'string')
    ) {
      return
    }

    if (typeof currentPath !== 'string' || currentPath.length === 0) {
      currentPath = app.getPath('home')
    }

    /** @type {import('electron').FileFilter[]} */
    const filters = process.platform === 'win32'
      ? [
          { name: 'Executable Files', extensions: ['exe'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      : [{ name: 'All Files', extensions: ['*'] }]

    const dialogOptions = {
      defaultPath: currentPath,
      properties: ['openFile'],
      filters
    }

    const window = BrowserWindow.fromWebContents(event.sender)
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return undefined
    }

    return result.filePaths[0]
  })

  ipcMain.handle(IpcChannels.YT_DLP_CHOOSE_COOKIES, async (event, currentPath) => {
    if (
      !isOpenTubeXUrl(event.senderFrame.url) ||
      (currentPath != null && typeof currentPath !== 'string')
    ) {
      return
    }

    if (typeof currentPath !== 'string' || currentPath.length === 0) {
      currentPath = app.getPath('home')
    }

    const dialogOptions = {
      defaultPath: currentPath,
      properties: ['openFile'],
      filters: [
        { name: 'Cookie Files', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    }

    const window = BrowserWindow.fromWebContents(event.sender)
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return undefined
    }

    return result.filePaths[0]
  })

  ipcMain.handle(IpcChannels.YT_DLP_CHOOSE_BROWSER_PROFILE, async (event, currentPath) => {
    if (
      !isOpenTubeXUrl(event.senderFrame.url) ||
      (currentPath != null && typeof currentPath !== 'string')
    ) {
      return
    }

    if (typeof currentPath !== 'string' || currentPath.length === 0) {
      currentPath = app.getPath('home')
    }

    const dialogOptions = {
      defaultPath: currentPath,
      properties: ['openDirectory']
    }

    const window = BrowserWindow.fromWebContents(event.sender)
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return undefined
    }

    return result.filePaths[0]
  })

  ipcMain.handle(IpcChannels.YT_DLP_CHOOSE_DOWNLOAD_FOLDER, async (event, currentPath) => {
    if (
      !isOpenTubeXUrl(event.senderFrame.url) ||
      (currentPath != null && typeof currentPath !== 'string')
    ) {
      return
    }

    if (typeof currentPath !== 'string' || currentPath.length === 0) {
      currentPath = app.getPath('downloads')
    }

    const dialogOptions = {
      defaultPath: currentPath,
      properties: ['openDirectory']
    }

    const window = BrowserWindow.fromWebContents(event.sender)
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return undefined
    }

    return result.filePaths[0]
  })

  ipcMain.handle(IpcChannels.GET_REPLACE_HTTP_CACHE, (event) => {
    if (isOpenTubeXUrl(event.senderFrame.url)) {
      return replaceHttpCache
    }
  })

  ipcMain.once(IpcChannels.TOGGLE_REPLACE_HTTP_CACHE, async (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    if (replaceHttpCache) {
      await asyncFs.rm(REPLACE_HTTP_CACHE_PATH)
    } else {
      // create an empty file
      const handle = await asyncFs.open(REPLACE_HTTP_CACHE_PATH, 'w')
      await handle.close()
    }

    relaunch()
  })

  ipcMain.handle(IpcChannels.GET_DISABLE_HARDWARE_ACCELERATION, (event) => {
    if (isOpenTubeXUrl(event.senderFrame.url)) {
      return disableHardwareAcceleration
    }
  })

  ipcMain.once(IpcChannels.TOGGLE_DISABLE_HARDWARE_ACCELERATION, async (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    if (disableHardwareAcceleration) {
      await asyncFs.rm(DISABLE_HARDWARE_ACCELERATION_PATH)
    } else {
      // create an empty file
      const handle = await asyncFs.open(DISABLE_HARDWARE_ACCELERATION_PATH, 'w')
      await handle.close()
    }

    relaunch()
  })

  function playerCachePathForKey(key) {
    // Remove path separators and period characters,
    // to prevent any files outside of the player_cache directory,
    // from being read or written
    const sanitizedKey = `${key}`.replaceAll(/[./\\]/g, '__')

    return path.join(PLAYER_CACHE_PATH, sanitizedKey)
  }

  ipcMain.handle(IpcChannels.PLAYER_CACHE_GET, async (event, key) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    const filePath = playerCachePathForKey(key)

    try {
      const contents = await asyncFs.readFile(filePath)

      return contents.buffer
    } catch (e) {
      // Don't log the error if the file doesn't exist as we'll just fetch it from YouTube
      // this usually happens when YouTube updates their player JavaScript
      if (e.code !== 'ENOENT') {
        console.error(e)
      }

      return undefined
    }
  })

  ipcMain.handle(IpcChannels.PLAYER_CACHE_SET, async (event, key, value) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    const filePath = playerCachePathForKey(key)

    await asyncFs.mkdir(PLAYER_CACHE_PATH, { recursive: true })

    await asyncFs.writeFile(filePath, new Uint8Array(value))
  })

  ipcMain.handle(IpcChannels.VOICE_OVER_TRANSLATION_REQUEST, async (event, payload) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    return await requestVoiceOverTranslation(payload)
  })

  /** @type {Map<number, { url: string, authorization: string }>} */
  const invidiousAuthorizations = new Map()

  ipcMain.on(IpcChannels.SET_INVIDIOUS_AUTHORIZATION, (event, authorization, url) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    if (!authorization) {
      invidiousAuthorizations.delete(event.sender.id)
    } else if (typeof authorization === 'string' && typeof url === 'string') {
      invidiousAuthorizations.set(event.sender.id, { authorization, url })
    }
  })

  function updateThemeSource(baseTheme) {
    nativeTheme.themeSource = LIGHT_BASE_THEMES.includes(baseTheme)
      ? 'light'
      : (DARK_BASE_THEMES.includes(baseTheme)
          ? 'dark'
          : 'system')
  }

  ipcMain.handle(IpcChannels.READ_CLIPBOARD, (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) throw new Error('Untrusted clipboard request')
    return clipboard.readText()
  })

  ipcMain.handle(IpcChannels.CUSTOM_THEME_LOAD, async (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) return
    return await loadCustomThemes()
  })

  ipcMain.handle(IpcChannels.CUSTOM_THEME_SAVE, async (event, theme) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) return

    const themes = await saveCustomTheme(theme)
    await repairSystemThemeSettingsFromMain(themes)
    await publishCustomThemes(themes)
    return themes
  })

  ipcMain.handle(IpcChannels.CUSTOM_THEME_REPLACE, async (event, themes) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) return

    const normalizedThemes = await replaceCustomThemes(themes)
    await repairSystemThemeSettingsFromMain(normalizedThemes)
    await publishCustomThemes(normalizedThemes)
    return normalizedThemes
  })

  ipcMain.handle(IpcChannels.CUSTOM_THEME_DELETE, async (event, themeId) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) return

    const deletedTheme = (await loadCustomThemes()).find(({ id }) => id === themeId)
    const themes = await deleteCustomTheme(themeId)
    if (deletedTheme) {
      const deletedThemeValue = customThemeValue(themeId)
      const [baseTheme, systemLightTheme, systemDarkTheme] = await Promise.all([
        baseHandlers.settings._findOne('baseTheme'),
        baseHandlers.settings._findOne('systemLightTheme'),
        baseHandlers.settings._findOne('systemDarkTheme')
      ])
      if (systemLightTheme?.value === deletedThemeValue) {
        await updateSettingFromMain(
          'systemLightTheme',
          resolveSystemTheme(deletedTheme.basedOn, 'light'),
          deletedThemeValue
        )
      }
      if (systemDarkTheme?.value === deletedThemeValue) {
        await updateSettingFromMain(
          'systemDarkTheme',
          resolveSystemTheme(deletedTheme.basedOn, 'dark'),
          deletedThemeValue
        )
      }
      if (baseTheme?.value === deletedThemeValue) {
        await updateSettingFromMain('mainColor', deletedTheme.mainColor)
        await updateSettingFromMain('secColor', deletedTheme.secondaryColor)
        await updateSettingFromMain('baseTheme', deletedTheme.basedOn)
        updateThemeSource(deletedTheme.basedOn)
      }
    }
    await repairSystemThemeSettingsFromMain(themes)
    await publishCustomThemes(themes)
    return themes
  })

  // ************************************************* //
  // DB related IPC calls
  // *********** //

  // Settings
  ipcMain.handle(IpcChannels.DB_SETTINGS, async (event, { action, data }) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    try {
      switch (action) {
        case DBActions.GENERAL.FIND:
          return await baseHandlers.settings.find()

        case DBActions.GENERAL.UPSERT:
          // This one is only allowed to be changed by the CHOOSE_DEFAULT_FOLDER IPC action
          // to avoid the "write to default folder" IPC calls being abused to write to arbitrary locations
          if (data._id === 'screenshotFolderPath') {
            return null
          }

          await baseHandlers.settings.upsert(data._id, data.value)
          syncOtherWindows(
            IpcChannels.SYNC_SETTINGS,
            event,
            { event: SyncEvents.GENERAL.UPSERT, data }
          )
          switch (data._id) {
            // Update app menu on related setting update
            case 'backendFallback':
              backendFallback = data.value
              await setMenu()
              break
            case 'backendPreference':
              backendPreference = data.value
              await setMenu()
              break
            case 'keyboardShortcuts':
              await setMenu()
              break
            case 'tabCloseFocus':
              TabManager.setTabCloseFocus(data.value)
              break
            case 'showSkipSilenceButton':
              TabManager.setShowSkipSilenceButton(data.value)
              break
            case 'enableSkipSilenceByDefault':
              TabManager.setEnableSkipSilenceByDefault(data.value)
              break
            case 'hideToTrayOnMinimize':
              if (isTrayOnMinimizeSupported) {
                trayOnMinimize = data.value
                if (!trayOnMinimize) { showHiddenWindows() }
              }
              break
            case 'baseTheme':
              if (isCustomThemeValue(data.value)) {
                nativeTheme.themeSource = (await getSelectedCustomTheme(data.value))?.isDark ? 'dark' : 'light'
              } else {
                updateThemeSource(data.value)
              }
              break
            case 'ytDlpMaxConcurrentDownloads':
            case 'ytDlpDownloadBandwidthLimit':
              await refreshYtDlpDownloadQueue()
              break
            case 'ytDlpPlaybackCacheMaxEntrySize':
              try {
                await applyYtDlpPlaybackCacheSettings()
              } catch (error) {
                console.warn('Could not apply the yt-dlp playback cache settings', error)
              }
              break

            default:
              // Do nothing for unmatched settings
          }
          return null

        case DBActions.GENERAL.DELETE:
          await baseHandlers.settings.delete(data)
          return null

        default:
          // eslint-disable-next-line no-throw-literal
          throw 'invalid settings db action'
      }
    } catch (err) {
      if (typeof err === 'string') throw err
      else throw err.toString()
    }
  })

  // *********** //
  // History
  ipcMain.handle(IpcChannels.DB_HISTORY, async (event, { action, data }) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    try {
      switch (action) {
        case DBActions.GENERAL.FIND:
          return await baseHandlers.history.find()

        case DBActions.GENERAL.UPSERT:
          await baseHandlers.history.upsert(data)
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.GENERAL.UPSERT, data }
          )
          return null

        case DBActions.GENERAL.OVERWRITE:
          await baseHandlers.history.overwrite(data)
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.GENERAL.OVERWRITE, data }
          )
          return null

        case DBActions.HISTORY.APPLY_SYNC_CHANGES:
          await baseHandlers.history.applySyncChanges(data)
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.HISTORY.APPLY_SYNC_CHANGES, data }
          )
          return null

        case DBActions.HISTORY.UPDATE_WATCH_PROGRESS:
          await baseHandlers.history.updateWatchProgress(data.videoId, data.watchProgress)
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.HISTORY.UPDATE_WATCH_PROGRESS, data }
          )
          return null

        case DBActions.HISTORY.UPDATE_PLAYLIST:
          await baseHandlers.history.updateLastViewedPlaylist(data.videoId, data.lastViewedPlaylistId, data.lastViewedPlaylistType, data.lastViewedPlaylistItemId)
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.HISTORY.UPDATE_PLAYLIST, data }
          )
          return null

        case DBActions.HISTORY.UNSET_PLAYLIST_FOR_VIDEOS:
          await baseHandlers.history.unsetLastViewedPlaylistForVideos(data.videoIds, data.lastViewedPlaylistId)
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.HISTORY.UNSET_PLAYLIST_FOR_VIDEOS, data }
          )
          return null

        case DBActions.HISTORY.UNSET_PLAYLISTS:
          await baseHandlers.history.unsetLastViewedPlaylists(data)
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.HISTORY.UNSET_PLAYLISTS, data }
          )
          return null

        case DBActions.GENERAL.DELETE:
          await baseHandlers.history.delete(data)
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.GENERAL.DELETE, data }
          )
          return null

        case DBActions.HISTORY.DELETE_OLDER_THAN: {
          if (
            typeof data !== 'number' ||
            !Number.isFinite(data) ||
            data < 0 ||
            data > Date.now()
          ) {
            throw new TypeError('invalid history cutoff')
          }

          const videoIds = await baseHandlers.history.deleteOlderThan(data, getPlayingVideoIds())
          if (videoIds.length > 0) {
            syncOtherWindows(
              IpcChannels.SYNC_HISTORY,
              event,
              { event: SyncEvents.GENERAL.DELETE_MULTIPLE, data: videoIds }
            )
          }
          return videoIds
        }

        case DBActions.GENERAL.DELETE_ALL:
          await baseHandlers.history.deleteAll()
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.GENERAL.DELETE_ALL }
          )
          return null

        default:
          // eslint-disable-next-line no-throw-literal
          throw 'invalid history db action'
      }
    } catch (err) {
      if (typeof err === 'string') throw err
      else throw err.toString()
    }
  })

  // *********** //
  // Recommendation learning
  ipcMain.handle(IpcChannels.DB_RECOMMENDATIONS, async (event, { action, data }) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) return
    let result
    if (action === DBActions.GENERAL.FIND) result = await baseHandlers.recommendations.find()
    else if (action === DBActions.GENERAL.UPSERT) result = await baseHandlers.recommendations.record(data)
    else if (action === DBActions.GENERAL.DELETE_MULTIPLE) result = await baseHandlers.recommendations.remove(data)
    else if (action === DBActions.GENERAL.DELETE_ALL) result = await baseHandlers.recommendations.reset()
    else throw new Error('Invalid recommendation action')
    syncOtherWindows(IpcChannels.SYNC_RECOMMENDATIONS, event, result)
    return result
  })

  // Watch Stats
  ipcMain.handle(IpcChannels.DB_WATCH_STATS, async (event, { action, data }) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    try {
      switch (action) {
        case DBActions.GENERAL.FIND:
          return await baseHandlers.watchStats.find()

        case DBActions.WATCH_STATS.ADD_WATCH_TIME:
          await baseHandlers.watchStats.addWatchTime(data.date, data.seconds)
          syncOtherWindows(
            IpcChannels.SYNC_WATCH_STATS,
            event,
            { event: SyncEvents.WATCH_STATS.ADD_WATCH_TIME, data }
          )
          return null

        case DBActions.WATCH_STATS.MIGRATE_HISTORY:
          return await baseHandlers.watchStats.migrateHistory()

        case DBActions.WATCH_STATS.GET_HISTORICAL_ADJUSTMENT:
          return await baseHandlers.watchStats.getHistoricalAdjustment()

        case DBActions.WATCH_STATS.ADJUST_HISTORICAL_WATCH_TIME: {
          const result = await baseHandlers.watchStats.adjustHistoricalWatchTime(
            data.defaultSpeed,
            data.channelPlaybackSpeeds
          )
          syncOtherWindows(
            IpcChannels.SYNC_WATCH_STATS,
            event,
            { event: SyncEvents.WATCH_STATS.ADJUST_HISTORICAL_WATCH_TIME, data: result }
          )
          return result
        }

        case DBActions.GENERAL.DELETE_ALL:
          await baseHandlers.watchStats.deleteAll()
          syncOtherWindows(
            IpcChannels.SYNC_WATCH_STATS,
            event,
            { event: SyncEvents.GENERAL.DELETE_ALL }
          )
          return null

        default:
          // eslint-disable-next-line no-throw-literal
          throw 'invalid watch stats db action'
      }
    } catch (err) {
      if (typeof err === 'string') throw err
      else throw err.toString()
    }
  })

  // *********** //
  // Profiles
  ipcMain.handle(IpcChannels.DB_PROFILES, async (event, { action, data }) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    try {
      switch (action) {
        case DBActions.GENERAL.CREATE: {
          const newProfile = await baseHandlers.profiles.create(data)
          syncOtherWindows(
            IpcChannels.SYNC_PROFILES,
            event,
            { event: SyncEvents.GENERAL.CREATE, data: newProfile }
          )
          return newProfile
        }

        case DBActions.GENERAL.FIND:
          return await baseHandlers.profiles.find()

        case DBActions.GENERAL.UPSERT:
          await baseHandlers.profiles.upsert(data)
          syncOtherWindows(
            IpcChannels.SYNC_PROFILES,
            event,
            { event: SyncEvents.GENERAL.UPSERT, data }
          )
          return null

        case DBActions.PROFILES.ADD_CHANNEL:
          await baseHandlers.profiles.addChannelToProfiles(data.channel, data.profileIds)
          syncOtherWindows(
            IpcChannels.SYNC_PROFILES,
            event,
            { event: SyncEvents.PROFILES.ADD_CHANNEL, data }
          )
          return null

        case DBActions.PROFILES.REMOVE_CHANNEL:
          await baseHandlers.profiles.removeChannelFromProfiles(data.channelId, data.profileIds)
          syncOtherWindows(
            IpcChannels.SYNC_PROFILES,
            event,
            { event: SyncEvents.PROFILES.REMOVE_CHANNEL, data }
          )
          return null

        case DBActions.PROFILES.UPDATE_CHANNEL_SETTINGS: {
          const profileIds = await baseHandlers.profiles
            .updateChannelSettings(data.channel, data.profileIds)
          if (profileIds.length > 0) {
            syncOtherWindows(
              IpcChannels.SYNC_PROFILES,
              event,
              {
                event: SyncEvents.PROFILES.UPDATE_CHANNEL_SETTINGS,
                data: { channel: data.channel, profileIds }
              }
            )
          }
          return profileIds
        }

        case DBActions.GENERAL.DELETE:
          await baseHandlers.profiles.delete(data)
          syncOtherWindows(
            IpcChannels.SYNC_PROFILES,
            event,
            { event: SyncEvents.GENERAL.DELETE, data }
          )
          return null

        default:
          // eslint-disable-next-line no-throw-literal
          throw 'invalid profile db action'
      }
    } catch (err) {
      if (typeof err === 'string') throw err
      else throw err.toString()
    }
  })

  // *********** //
  // Playlists
  // ! NOTE: A lot of these actions are currently not used for anything
  // As such, only the currently used actions have synchronization implemented
  // The remaining should have it implemented only when playlists
  // get fully implemented into the app
  ipcMain.handle(IpcChannels.DB_PLAYLISTS, async (event, { action, data }) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    try {
      switch (action) {
        case DBActions.GENERAL.CREATE:
          await baseHandlers.playlists.create(data)
          syncOtherWindows(
            IpcChannels.SYNC_PLAYLISTS,
            event,
            { event: SyncEvents.GENERAL.CREATE, data }
          )
          return null

        case DBActions.GENERAL.FIND:
          return await baseHandlers.playlists.find()

        case DBActions.GENERAL.UPSERT:
          await baseHandlers.playlists.upsert(data)
          syncOtherWindows(
            IpcChannels.SYNC_PLAYLISTS,
            event,
            { event: SyncEvents.GENERAL.UPSERT, data }
          )
          return null

        case DBActions.PLAYLISTS.UPSERT_VIDEO: {
          const result = await baseHandlers.playlists.upsertVideoByPlaylistId(data._id, data.lastUpdatedAt, data.videoData)

          // Nothing was written when the video is already in the playlist or the
          // playlist is gone, so the other windows have nothing to apply
          if (result === PlaylistVideoAddResult.ADDED) {
            syncOtherWindows(
              IpcChannels.SYNC_PLAYLISTS,
              event,
              { event: SyncEvents.PLAYLISTS.UPSERT_VIDEO, data }
            )
          }

          return result
        }

        case DBActions.PLAYLISTS.UPSERT_VIDEOS:
          await baseHandlers.playlists.upsertVideosByPlaylistId(data._id, data.lastUpdatedAt, data.videos)
          syncOtherWindows(
            IpcChannels.SYNC_PLAYLISTS,
            event,
            { event: SyncEvents.PLAYLISTS.UPSERT_VIDEOS, data }
          )
          return null

        case DBActions.GENERAL.DELETE:
          await baseHandlers.playlists.delete(data)
          syncOtherWindows(
            IpcChannels.SYNC_PLAYLISTS,
            event,
            { event: SyncEvents.GENERAL.DELETE, data }
          )
          return null

        case DBActions.PLAYLISTS.DELETE_VIDEO_ID:
          await baseHandlers.playlists.deleteVideoIdByPlaylistId(data._id, data.lastUpdatedAt, data.videoId, data.playlistItemId)
          syncOtherWindows(
            IpcChannels.SYNC_PLAYLISTS,
            event,
            { event: SyncEvents.PLAYLISTS.DELETE_VIDEO, data }
          )
          return null

        case DBActions.PLAYLISTS.DELETE_VIDEO_IDS:
          await baseHandlers.playlists.deleteVideoIdsByPlaylistId(data._id, data.lastUpdatedAt, data.playlistItemIds)
          syncOtherWindows(
            IpcChannels.SYNC_PLAYLISTS,
            event,
            { event: SyncEvents.PLAYLISTS.DELETE_VIDEOS, data }
          )
          return null

        case DBActions.PLAYLISTS.DELETE_ALL_VIDEOS:
          await baseHandlers.playlists.deleteAllVideosByPlaylistId(data)
          // TODO: Syncing (implement only when it starts being used)
          // syncOtherWindows(IpcChannels.SYNC_PLAYLISTS, event, { event: '_', data })
          return null

        case DBActions.GENERAL.DELETE_MULTIPLE:
          await baseHandlers.playlists.deleteMultiple(data)
          // TODO: Syncing (implement only when it starts being used)
          // syncOtherWindows(IpcChannels.SYNC_PLAYLISTS, event, { event: '_', data })
          return null

        case DBActions.GENERAL.DELETE_ALL:
          await baseHandlers.playlists.deleteAll()
          // TODO: Syncing (implement only when it starts being used)
          // syncOtherWindows(IpcChannels.SYNC_PLAYLISTS, event, { event: '_', data })
          return null

        default:
          // eslint-disable-next-line no-throw-literal
          throw 'invalid playlist db action'
      }
    } catch (err) {
      if (typeof err === 'string') throw err
      else throw err.toString()
    }
  })

  // *********** //

  // ************** //
  // Search History
  ipcMain.handle(IpcChannels.DB_SEARCH_HISTORY, async (event, { action, data }) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    try {
      switch (action) {
        case DBActions.GENERAL.FIND:
          return await baseHandlers.searchHistory.find()

        case DBActions.GENERAL.UPSERT: {
          const updatedEntry = await baseHandlers.searchHistory.upsert(data)
          syncOtherWindows(
            IpcChannels.SYNC_SEARCH_HISTORY,
            event,
            { event: SyncEvents.GENERAL.UPSERT, data: updatedEntry }
          )
          return updatedEntry
        }

        case DBActions.GENERAL.OVERWRITE:
          await baseHandlers.searchHistory.overwrite(data)
          syncOtherWindows(
            IpcChannels.SYNC_SEARCH_HISTORY,
            event,
            { event: SyncEvents.GENERAL.OVERWRITE, data }
          )
          return null

        case DBActions.GENERAL.DELETE:
          await baseHandlers.searchHistory.delete(data)
          syncOtherWindows(
            IpcChannels.SYNC_SEARCH_HISTORY,
            event,
            { event: SyncEvents.GENERAL.DELETE, data }
          )
          return null

        case DBActions.GENERAL.DELETE_ALL:
          await baseHandlers.searchHistory.deleteAll()
          syncOtherWindows(
            IpcChannels.SYNC_SEARCH_HISTORY,
            event,
            { event: SyncEvents.GENERAL.DELETE_ALL }
          )
          return null

        default:
          // eslint-disable-next-line no-throw-literal
          throw 'invalid search history db action'
      }
    } catch (err) {
      if (typeof err === 'string') throw err
      else throw err.toString()
    }
  })

  // *********** //
  // Profiles
  ipcMain.handle(IpcChannels.DB_SUBSCRIPTION_CACHE, async (event, { action, data }) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    try {
      switch (action) {
        case DBActions.GENERAL.FIND:
          return await baseHandlers.subscriptionCache.find()

        case DBActions.SUBSCRIPTION_CACHE.UPDATE_VIDEOS_BY_CHANNEL:
          if (!await baseHandlers.subscriptionCache.updateVideosByChannelId(data.channelId, data.entries, data.timestamp)) return false
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.SUBSCRIPTION_CACHE.UPDATE_VIDEOS_BY_CHANNEL, data }
          )
          return null

        case DBActions.SUBSCRIPTION_CACHE.UPDATE_LIVE_STREAMS_BY_CHANNEL:
          if (!await baseHandlers.subscriptionCache.updateLiveStreamsByChannelId(data.channelId, data.entries, data.timestamp)) return false
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.SUBSCRIPTION_CACHE.UPDATE_LIVE_STREAMS_BY_CHANNEL, data }
          )
          return null

        case DBActions.SUBSCRIPTION_CACHE.UPDATE_SHORTS_BY_CHANNEL:
          if (!await baseHandlers.subscriptionCache.updateShortsByChannelId(data.channelId, data.entries, data.timestamp)) return false
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.SUBSCRIPTION_CACHE.UPDATE_SHORTS_BY_CHANNEL, data }
          )
          return null

        case DBActions.SUBSCRIPTION_CACHE.UPDATE_SHORTS_WITH_CHANNEL_PAGE_SHORTS_BY_CHANNEL:
          await baseHandlers.subscriptionCache.updateShortsWithChannelPageShortsByChannelId(data.channelId, data.entries)
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.SUBSCRIPTION_CACHE.UPDATE_SHORTS_WITH_CHANNEL_PAGE_SHORTS_BY_CHANNEL, data }
          )
          return null

        case DBActions.SUBSCRIPTION_CACHE.UPDATE_COMMUNITY_POSTS_BY_CHANNEL:
          if (!await baseHandlers.subscriptionCache.updateCommunityPostsByChannelId(data.channelId, data.entries, data.timestamp)) return false
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.SUBSCRIPTION_CACHE.UPDATE_COMMUNITY_POSTS_BY_CHANNEL, data }
          )
          return null

        case DBActions.GENERAL.DELETE_MULTIPLE:
          await baseHandlers.subscriptionCache.deleteMultipleChannels(data)
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.GENERAL.DELETE_MULTIPLE, data }
          )
          return null

        case DBActions.GENERAL.DELETE_ALL:
          await baseHandlers.subscriptionCache.deleteAll()
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.GENERAL.DELETE_ALL, data }
          )
          return null

        default:
          // eslint-disable-next-line no-throw-literal
          throw 'invalid subscriptionCache db action'
      }
    } catch (err) {
      if (typeof err === 'string') throw err
      else throw err.toString()
    }
  })

  // *********** //

  function syncOtherWindows(channel, event, payload) {
    const allWindows = BrowserWindow.getAllWindows()

    for (const window of allWindows) {
      if (
        window.webContents.id !== event.sender.id &&
        !window.webContents.isDestroyed() &&
        isOpenTubeXUrl(window.webContents.getURL())
      ) {
        window.webContents.send(channel, payload)
      }
    }
  }

  function getPlayingVideoIds() {
    const videoIds = []

    for (const window of BrowserWindow.getAllWindows()) {
      const tabManager = TabManager.getForWindow(window.id)
      if (!tabManager) { continue }

      for (const tab of tabManager.tabs.values()) {
        if (!tab.isPlaying) { continue }

        const videoId = URL.parse(tab.url)?.hash.match(/^#\/watch\/(?<videoId>[^/?]+)/)?.groups?.videoId
        if (videoId) {
          videoIds.push(decodeURIComponent(videoId))
        }
      }
    }

    return videoIds
  }

  // ************************************************* //

  let resourcesCleanUpDone = false

  // `before-quit` fires on every platform before any windows start closing.
  // Confirm app-level quit requests here, then mark the app as quitting so
  // BrowserWindow close handlers preserve their tab sessions.
  app.on('before-quit', (event) => {
    if (!isQuitConfirmed) {
      event.preventDefault()
      requestQuit(BrowserWindow.getFocusedWindow() ?? mainWindow)
      return
    }

    isQuitting = true
    if (process.platform !== 'darwin' && tray) { tray.destroy() }
  })

  app.on('window-all-closed', () => {
    // Clean up resources (datastores' compaction + Electron cache and storage data clearing)
    handleQuit()
  })

  if (process.platform === 'darwin') {
    // `window-all-closed` doesn't fire for Cmd+Q
    // https://www.electronjs.org/docs/latest/api/app#event-window-all-closed
    // This is also fired when `app.quit` called
    // Not using `before-quit` since that one is fired before windows are closed
    app.on('will-quit', e => {
      // Let app quit when the cleanup is finished

      if (resourcesCleanUpDone) { return }

      e.preventDefault()
      cleanUpResources().finally(() => {
        // Quit AFTER the resources cleanup is finished
        // Which calls the listener again, which is why we have the variable

        app.quit()
      })
    })
  }

  function handleQuit() {
    cleanUpResources().finally(() => {
      mainWindow = null
      if (process.platform !== 'darwin') {
        app.quit()
      }
    })
  }

  /**
   * @param {import('electron').BrowserWindow | null | undefined} browserWindow
   */
  function requestQuit(browserWindow) {
    confirmCloseApp(browserWindow).then((shouldQuit) => {
      if (!shouldQuit) {
        return
      }

      isQuitConfirmed = true
      app.quit()
    }).catch((error) => {
      console.error('Failed to confirm app quit:', error)
    })
  }

  async function cleanUpResources() {
    if (resourcesCleanUpDone) {
      return
    }

    await Promise.allSettled([
      baseHandlers.compactAllDatastores(),
      shutdownYtDlpDownloads(),
      session.defaultSession.clearCache(),
      session.defaultSession.clearStorageData({
        storages: [
          'appcache',
          'cookies',
          'filesystem',
          'indexdb',
          'shadercache',
          'websql',
          'serviceworkers',
          'cachestorage'
        ]
      })
    ])

    resourcesCleanUpDone = true
  }

  // MacOS event
  // https://www.electronjs.org/docs/latest/api/app#event-activate-macos
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })

  /*
   * Callback when processing an opentubex:// link (macOS)
   */
  app.on('open-url', async (event, url) => {
    event.preventDefault()

    const newStartupUrl = baseUrl(url)
    if (!(mainWindow && mainWindow.webContents)) {
      startupUrl = newStartupUrl
      if (app.isReady()) {
        await createWindowForOpenUrl(startupUrl, {
          reuseEmptyRootTab: true
        })
        startupUrl = null
      }
      return
    }

    const openDeepLinksInNewWindow = (await baseHandlers.settings._findOne('openDeepLinksInNewWindow'))?.value
    if (!openDeepLinksInNewWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      openUrlInWindow(mainWindow, newStartupUrl)
      return
    }

    await createWindowForOpenUrl(newStartupUrl, {
      replaceMainWindow: false,
      showWindowNow: true,
      reuseEmptyRootTab: true
    })
  })

  app.on('web-contents-created', (_, webContents) => {
    // When a main-frame document starts loading, the previous renderer is gone.
    // Drop its readiness entry so sendOpenUrlToWebContents queues messages until
    // the new renderer signals APP_READY again, instead of delivering to a
    // renderer that has not registered its OPEN_URL listener yet.
    webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) {
        openUrlReadyWebContentsIds.delete(webContents.id)
        const browserWindow = BrowserWindow.fromWebContents(webContents)
        if (browserWindow) {
          appShortcutBlockedWindows.delete(browserWindow)
        }
      }
    })

    webContents.once('destroyed', () => {
      contextMenuSessions.delete(webContents.id)
      latestContextMenuRequests.delete(webContents.id)
      pendingOpenUrlsByWebContentsId.delete(webContents.id)
      openUrlReadyWebContentsIds.delete(webContents.id)
      invidiousAuthorizations.delete(webContents.id)
    })
  })

  /*
   * Check if an argument was passed and send it over to the GUI (Linux / Windows).
   * Remove app protocol if present
   */
  const url = getLinkUrl(process.argv)
  if (url) {
    startupUrl = url
  }

  function baseUrl(arg) {
    let newArg = arg.replace(/^(?:opentubex|freetube):\/\//, '')
    // add support for authority free url
      .replace(/^(?:opentubex|freetube):/, '')

    // fix for Qt URL, like `opentubex://https//www.youtube.com/watch?v=...`
    // For details see https://github.com/FreeTubeApp/FreeTube/pull/3119
    if (newArg.startsWith('https') && newArg.charAt(5) !== ':') {
      newArg = 'https:' + newArg.substring(5)
    }
    return newArg
  }

  /**
   * @param {string} arg
   * @returns {string | null}
   */
  function getNormalizedLinkArg(arg) {
    if (typeof arg !== 'string' || arg.trim().length === 0 || arg.startsWith('-')) {
      return null
    }

    const url = baseUrl(arg.trim())
    const parsed = URL.parse(url)

    if (parsed?.protocol === 'http:' || parsed?.protocol === 'https:') {
      return url
    }

    return null
  }

  function getLinkUrl(argv) {
    for (let i = argv.length - 1; i > 0; i--) {
      const url = getNormalizedLinkArg(argv[i])
      if (url) {
        return url
      }
    }

    return null
  }

  /*
   * Auto Updater
   *
   * Uncomment the following code below and install `electron-updater` to
   * support auto updating. Code Signing with a valid certificate is required.
   * https://simulatedgreg.gitbooks.io/electron-vue/content/en/using-electron-builder.html#auto-updating
   */

  /*
  import { autoUpdater } from 'electron-updater'
  autoUpdater.on('update-downloaded', () => {
    autoUpdater.quitAndInstall()
  })

  app.on('ready', () => {
    if (process.env.NODE_ENV === 'production') autoUpdater.checkForUpdates()
  })
   */

  function navigateTo(path, browserWindow, toggle = false) {
    if (browserWindow == null) {
      return
    }

    const tabManager = TabManager.getForWindow(browserWindow.id)
    if (tabManager?.activeTabId && isOpenTubeXUrl(browserWindow.webContents.getURL())) {
      browserWindow.webContents.send(IpcChannels.CHANGE_VIEW, {
        tabId: tabManager.activeTabId,
        route: path,
        toggle
      })
    } else if (isOpenTubeXUrl(browserWindow.webContents.getURL())) {
      browserWindow.webContents.send(IpcChannels.CHANGE_VIEW, toggle ? { route: path, toggle } : path)
    }
  }

  async function setMenu() {
    const keyboardShortcutsSetting = await baseHandlers.settings._findOne('keyboardShortcuts')
    const keyboardShortcuts = getConfiguredKeyboardShortcuts(keyboardShortcutsSetting?.value)
    const reloadTabs = (_menuItem, browserWindow) => {
      if (browserWindow && !appShortcutBlockedWindows.has(browserWindow)) {
        const tabManager = TabManager.getForWindow(browserWindow.id)
        if (tabManager) {
          const tabIds = tabManager.selectedTabIds.length > 1
            ? tabManager.selectedTabIds
            : [tabManager.activeTabId]
          for (const tabId of tabIds) {
            tabManager.requestReload(tabId)
          }
        }
      }
    }

    const template = [
      ...process.platform === 'darwin'
        ? [
            {
              label: app.getName(),
              submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideothers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
              ]
            }
          ]
        : [],
      {
        label: 'File',
        submenu: [
          {
            label: 'New Window',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.NEW_WINDOW),
            click: (_menuItem, browserWindow, _event) => {
              if (browserWindow && appShortcutBlockedWindows.has(browserWindow)) { return }
              createWindow({
                replaceMainWindow: false,
                showWindowNow: true
              })
            },
            type: 'normal'
          },
          { type: 'separator' },
          {
            label: 'Preferences',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.NAVIGATE_TO_SETTINGS),
            click: (_menuItem, browserWindow, _event) => {
              if (browserWindow && appShortcutBlockedWindows.has(browserWindow)) { return }
              navigateTo('/settings', browserWindow, true)
            },
            type: 'normal'
          },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'cut' },
          {
            role: 'copy',
            accelerator: 'CmdOrCtrl+C',
            selector: 'copy:'
          },
          {
            role: 'paste',
            accelerator: 'CmdOrCtrl+V',
            selector: 'paste:'
          },
          { role: 'pasteandmatchstyle' },
          { role: 'delete' },
          { role: 'selectall' }
        ]
      },
      {
        label: 'View',
        submenu: [
          {
            label: 'Toggle Developer Tools',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.TOGGLE_DEVTOOLS),
            click: (_menuItem, browserWindow) => {
              if (browserWindow && appShortcutBlockedWindows.has(browserWindow)) { return }
              browserWindow?.webContents.toggleDevTools()
            }
          },
          {
            label: 'Enter Inspect Element Mode',
            accelerator: 'CmdOrCtrl+Shift+C',
            click: (_, window) => {
              if (appShortcutBlockedWindows.has(window)) { return }
              if (window.webContents.isDevToolsOpened()) {
                window.devToolsWebContents.executeJavaScript('DevToolsAPI.enterInspectElementMode()')
              } else {
                window.webContents.once('devtools-opened', () => {
                  window.devToolsWebContents.executeJavaScript('DevToolsAPI.enterInspectElementMode()')
                })
                window.webContents.openDevTools()
              }
            }
          },
          {
            label: 'GPU Internals (chrome://gpu)',
            click() {
              const gpuWindow = new BrowserWindow({
                show: true,
                autoHideMenuBar: true,
                webPreferences: {
                  devTools: false
                }
              })
              gpuWindow.loadURL('chrome://gpu')
            }
          },
          { type: 'separator' },
          {
            label: 'Actual Size',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.RESET_ZOOM),
            click: (_menuItem, browserWindow) => {
              if (browserWindow && appShortcutBlockedWindows.has(browserWindow)) { return }
              browserWindow?.webContents.setZoomLevel(0)
            }
          },
          {
            label: 'Zoom In',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.ZOOM_IN),
            click: (_menuItem, browserWindow) => {
              if (browserWindow && !appShortcutBlockedWindows.has(browserWindow)) {
                browserWindow.webContents.setZoomLevel(browserWindow.webContents.getZoomLevel() + 0.5)
              }
            }
          },
          {
            label: 'Zoom Out',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.ZOOM_OUT),
            click: (_menuItem, browserWindow) => {
              if (browserWindow && !appShortcutBlockedWindows.has(browserWindow)) {
                browserWindow.webContents.setZoomLevel(browserWindow.webContents.getZoomLevel() - 0.5)
              }
            }
          },
          { type: 'separator' },
          {
            label: 'Toggle Full Screen',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.FULLSCREEN),
            click: (_menuItem, browserWindow) => {
              if (browserWindow && appShortcutBlockedWindows.has(browserWindow)) { return }
              browserWindow?.setFullScreen(!browserWindow.isFullScreen())
            }
          },
          { type: 'separator' },
          {
            label: 'Back',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.HISTORY_BACKWARD),
            click: (_menuItem, browserWindow, _event) => {
              if (browserWindow == null || appShortcutBlockedWindows.has(browserWindow)) { return }

              TabManager.getForWindow(browserWindow.id)?.navigateHistory(-1)
            },
            type: 'normal',
          },
          ...(process.platform === 'darwin'
            ? [
                {
                  label: 'Back',
                  accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.HISTORY_BACKWARD_ALT_MAC),
                  click: (_menuItem, browserWindow, _event) => {
                    if (browserWindow == null || appShortcutBlockedWindows.has(browserWindow)) { return }

                    TabManager.getForWindow(browserWindow.id)?.navigateHistory(-1)
                  },
                  visible: false,
                },
              ]
            : []),
          {
            label: 'Forward',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.HISTORY_FORWARD),
            click: (_menuItem, browserWindow, _event) => {
              if (browserWindow == null || appShortcutBlockedWindows.has(browserWindow)) { return }

              TabManager.getForWindow(browserWindow.id)?.navigateHistory(1)
            },
            type: 'normal',
          },
          ...(process.platform === 'darwin'
            ? [
                {
                  label: 'Forward',
                  accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.HISTORY_FORWARD_ALT_MAC),
                  click: (_menuItem, browserWindow, _event) => {
                    if (browserWindow == null || appShortcutBlockedWindows.has(browserWindow)) { return }

                    TabManager.getForWindow(browserWindow.id)?.navigateHistory(1)
                  },
                  visible: false,
                },
              ]
            : []),
        ]
      },
      {
        label: 'Navigate',
        submenu: [
          {
            label: 'Home',
            click: (_menuItem, browserWindow, _event) => {
              navigateTo('/home', browserWindow)
            },
            type: 'normal'
          },
          {
            label: 'Subscriptions',
            click: (_menuItem, browserWindow, _event) => {
              navigateTo('/subscriptions', browserWindow)
            },
            type: 'normal'
          },
          {
            label: 'Channels',
            click: (_menuItem, browserWindow, _event) => {
              navigateTo('/subscribedchannels', browserWindow)
            },
            type: 'normal'
          },
          (backendFallback || backendPreference === 'local') && {
            label: 'Trending',
            click: (_menuItem, browserWindow, _event) => {
              navigateTo('/trending', browserWindow)
            },
            type: 'normal'
          },
          (backendFallback || backendPreference === 'invidious') && {
            label: 'Most Popular',
            click: (_menuItem, browserWindow, _event) => {
              navigateTo('/popular', browserWindow)
            },
            type: 'normal'
          },
          {
            label: 'Playlists',
            click: (_menuItem, browserWindow, _event) => {
              navigateTo('/userplaylists', browserWindow)
            },
            type: 'normal'
          },
          {
            label: 'Downloads',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.NAVIGATE_TO_DOWNLOADS),
            click: (_menuItem, browserWindow, _event) => {
              if (browserWindow && appShortcutBlockedWindows.has(browserWindow)) { return }
              navigateTo('/downloads', browserWindow)
            },
            type: 'normal'
          },
          {
            label: 'History',
            accelerator: getElectronAccelerator(process.platform === 'darwin'
              ? keyboardShortcuts.APP.GENERAL.NAVIGATE_TO_HISTORY_MAC
              : keyboardShortcuts.APP.GENERAL.NAVIGATE_TO_HISTORY),
            click: (_menuItem, browserWindow, _event) => {
              if (browserWindow && appShortcutBlockedWindows.has(browserWindow)) { return }
              navigateTo('/history', browserWindow)
            },
            type: 'normal'
          },
          {
            label: 'Profile Manager',
            click: (_menuItem, browserWindow, _event) => {
              navigateTo('/settings/profile/', browserWindow)
            },
            type: 'normal'
          },
        ].filter((v) => v !== false),
      },
      {
        label: 'Tabs',
        submenu: [
          {
            label: 'New Tab',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.NEW_TAB),
            click: (_menuItem, browserWindow) => {
              if (browserWindow && !appShortcutBlockedWindows.has(browserWindow)) {
                const tabManager = TabManager.getForWindow(browserWindow.id)
                if (tabManager) {
                  tabManager.createTabWithPreference({ makeActive: true }).catch(error => {
                    console.error('Failed to create a new tab from the app menu:', error)
                  })
                }
              }
            }
          },
          {
            label: 'Close Tab',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.CLOSE_TAB),
            click: async (_menuItem, browserWindow) => {
              if (browserWindow && !appShortcutBlockedWindows.has(browserWindow)) {
                const tabManager = TabManager.getForWindow(browserWindow.id)
                if (tabManager && tabManager.activeTabId) {
                  const tabIds = tabManager.selectedTabIds.length > 1
                    ? [...tabManager.selectedTabIds]
                    : [tabManager.activeTabId]
                  const closesLastWindow = tabIds.length === tabManager.tabs.size &&
                    BrowserWindow.getAllWindows().length === 1
                  if (!closesLastWindow && !await confirmMultipleTabsAction(tabManager, tabIds.length, 'close')) {
                    return
                  }
                  const hasRemainingTabs = await tabManager.closeTabs(tabIds)
                  if (!hasRemainingTabs) {
                    browserWindow.close()
                  }
                } else {
                  browserWindow.close()
                }
              }
            }
          },
          {
            label: 'Reload Tab',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.RELOAD_TAB),
            click: reloadTabs,
          },
          {
            label: 'Reload Tab',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.RELOAD_TAB_ALT),
            click: reloadTabs,
            visible: false,
          },
          {
            label: 'Reopen Closed Tab',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.RESTORE_CLOSED_TAB),
            click: (_menuItem, browserWindow) => {
              if (browserWindow && !appShortcutBlockedWindows.has(browserWindow)) {
                const tabManager = TabManager.getForWindow(browserWindow.id)
                if (tabManager) {
                  tabManager.restoreClosedTab()
                }
              }
            }
          },
          { type: 'separator' },
          {
            label: 'Next Tab',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.NEXT_TAB),
            click: (_menuItem, browserWindow) => {
              if (browserWindow && !appShortcutBlockedWindows.has(browserWindow)) {
                const tabManager = TabManager.getForWindow(browserWindow.id)
                if (tabManager && tabManager.tabs.size > 1) {
                  const tabIds = Array.from(tabManager.tabs.keys())
                  const currentIndex = tabIds.indexOf(tabManager.activeTabId)
                  const nextIndex = (currentIndex + 1) % tabIds.length
                  tabManager.activateTab(tabIds[nextIndex])
                }
              }
            }
          },
          {
            label: 'Previous Tab',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.PREV_TAB),
            click: (_menuItem, browserWindow) => {
              if (browserWindow && !appShortcutBlockedWindows.has(browserWindow)) {
                const tabManager = TabManager.getForWindow(browserWindow.id)
                if (tabManager && tabManager.tabs.size > 1) {
                  const tabIds = Array.from(tabManager.tabs.keys())
                  const currentIndex = tabIds.indexOf(tabManager.activeTabId)
                  const prevIndex = (currentIndex - 1 + tabIds.length) % tabIds.length
                  tabManager.activateTab(tabIds[prevIndex])
                }
              }
            }
          }
        ]
      },
      {
        role: 'window',
        submenu: [
          {
            label: 'Minimize',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.MINIMIZE_WINDOW),
            click: (_menuItem, browserWindow) => {
              if (browserWindow && appShortcutBlockedWindows.has(browserWindow)) { return }
              browserWindow?.minimize()
            }
          },
          {
            label: 'Close Window',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.CLOSE_WINDOW),
            click: (_menuItem, browserWindow) => browserWindow?.close()
          }
        ]
      },
      ...process.platform === 'darwin'
        ? [
            { role: 'window' },
            { role: 'help' },
            { role: 'services' }
          ]
        : []
    ]

    const menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)
  }
}
