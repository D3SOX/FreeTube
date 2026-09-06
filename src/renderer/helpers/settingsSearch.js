import { customThemeIdFromValue } from '../../customTheme.js'

import {
  SETTINGS_SEARCH_EXCLUDED_MESSAGE_PATHS,
  SETTINGS_SEARCH_SELECT_GROUP_LABELS,
  SETTINGS_SEARCH_SOURCES,
} from './settings-search-config.js'

const NON_SETTING_MESSAGE_KEY_PATTERN = /(?:^Are you sure\b|^Failed to\b|^Invalid\b|^No\b|^How\b|^Checking\b|^Downloading\b|^Loading\b|^Loaded\b|^Current .+\b(?:has|is|will)\b|\b(?:has|have) been (?:cleared|removed|saved|updated)\b|^Operation in Progress$|(?:Description|Hint|Tooltip|Placeholder|Template|Warning|Error|Status|Message|Not Downloaded|Unavailable|Connected|Connecting|Success|Failed|Failure|Invalid|Saved|Copied|Already Exists)$)/i

/**
 * Builds the localized setting labels used by both Settings search and the
 * command palette. Visibility follows the controls currently rendered by the
 * active settings state.
 * @param {object} options
 * @returns {Map<string, Array<{label: string, tab?: string}>>}
 */
export function createSettingsSearchIndex(options) {
  const {
    sections,
    tm,
  } = options
  const extraValues = {
    privacy: flattenSettingsSearchMessageValues(
      tm('Settings.Password Settings'),
      {},
      [],
      (path, value) => isSearchableSettingsMessage('password', path, value, options)
    )
  }

  return new Map(sections.map((section) => {
    const sources = SETTINGS_SEARCH_SOURCES[section.type] ?? []
    const matches = [
      { label: section.title },
      { label: section.description },
      ...sources.flatMap(source => getSettingsSearchSourceValues(source, options).map(label => ({
        label,
        ...(source.tab === undefined ? {} : { tab: source.tab })
      }))),
      ...(extraValues[section.type] ?? []).map(label => ({ label }))
    ]
    return [section.type, matches.filter((match, index) => (
      matches.findIndex(candidate => candidate.label === match.label) === index
    ))]
  }))
}

export function findSettingsSearchTab(match) {
  return match.tab
}

function getSettingsSearchSourceValues(source, options) {
  if (source.electronOnly && !options.usingElectron && !(options.isCapacitor && ['external-software', 'download', 'yt-dlp-streaming'].includes(source.type))) return []
  return flattenSettingsSearchMessageValues(
    options.tm(source.key),
    SETTINGS_SEARCH_SELECT_GROUP_LABELS[source.type],
    [],
    (path, value) => (
      (source.include === undefined || source.include.has(path[0])) &&
      (source.exclude === undefined || !source.exclude.has(path[0])) &&
      isSearchableSettingsMessage(source.type, path, value, options)
    )
  )
}

function isSearchableSettingsMessage(sectionType, path, value, options) {
  if (/\{[^{}]+\}/.test(value)) return false
  const messagePath = path.join('.')
  const messageKey = path.at(-1) ?? ''
  return !SETTINGS_SEARCH_EXCLUDED_MESSAGE_PATHS[sectionType]?.has(messagePath) &&
    !NON_SETTING_MESSAGE_KEY_PATTERN.test(messageKey) &&
    isSettingsSearchMessageVisible(sectionType, path, options)
}

function isSettingsSearchMessageVisible(sectionType, path, options) {
  const {
    store,
    usingElectron,
    isCapacitor = false,
    supportsLocalApi,
    isMac,
    isLinuxWayland,
    systemUsesDarkTheme,
  } = options
  const [group, item] = path

  if (sectionType === 'player' && group === 'Screenshot') {
    if (item === 'Enable') return true
    if (!store.getters.getEnableScreenshot) return false
    if (item === 'Mode') return true
    if (['Format Label', 'Quality Label', 'File Name Label'].includes(item)) {
      return store.getters.getScreenshotMode !== 'clipboard'
    }
    if (['Folder Label', 'Folder Button'].includes(item)) {
      return usingElectron && store.getters.getScreenshotMode === 'default_folder'
    }
    return false
  }

  if (sectionType === 'caption-appearance' && group === 'Edge Color') {
    return getCaptionEdgeStyle(store) !== 'none'
  }

  if (sectionType === 'general' && [
    'Current Invidious Instance',
    'View all Invidious instance information',
    'Set Current Instance as Default',
    'Clear Default Instance'
  ].includes(group)) {
    return store.getters.getBackendPreference === 'invidious' ||
      store.getters.getBackendFallback
  }

  if (sectionType === 'general') {
    if (group === 'Stream Extraction Method') return usingElectron || isCapacitor
    if (group === 'Mobile Layout') {
      return isCapacitor
    }
    if (group === 'Minimize to system tray') {
      return usingElectron && !isMac && !isLinuxWayland
    }
    if ([
      'Open Deep Links In New Window',
      'New Tab Position',
      'Tab Close Focus',
      'Startup Behavior',
      'Confirm Before',
      'Confirmation Options',
      'Stream Extraction Method'
    ].includes(group)) {
      return usingElectron
    }
    if (group === 'Fallback to Non-Preferred Backend on Failure') {
      return supportsLocalApi
    }
    if (group === 'Comment Translation') {
      return supportsLocalApi
    }
    if (group === 'Avoid translation') {
      return supportsLocalApi && (
        store.getters.getBackendPreference === 'local' || store.getters.getBackendFallback
      )
    }
  }

  if (sectionType === 'sync') {
    if (['Sync Settings', 'Enable Sync'].includes(group)) return true
    if (!store.getters.getSyncServerEnabled) return false
    const connected = store.getters.getSyncServerToken !== ''
    if (['Password', 'Privacy Passphrase', 'Log In', 'Register'].includes(group)) {
      return !connected
    }
    if ([
      'Automatic Sync',
      'Profiles',
      'Settings',
      'Sync Now',
      'Disconnect',
      'Delete Account'
    ].includes(group)) {
      return connected
    }
    if (group === 'Open Tabs') {
      return connected && (usingElectron || isCapacitor) &&
        store.getters.getSyncServerPrivacyMode === 'enhanced'
    }
    return true
  }

  if (sectionType === 'external-player' && [
    'Custom External Player Executable',
    'Custom External Player Arguments'
  ].includes(group)) {
    return store.getters.getExternalPlayer !== ''
  }

  if (sectionType === 'sponsor-block') {
    const useSponsorBlock = store.getters.getUseSponsorBlock
    const useDeArrowTitles = store.getters.getUseDeArrowTitles
    const useDeArrowThumbnails = store.getters.getUseDeArrowThumbnails
    if (group === 'SponsorBlock API Url (Default is https://sponsor.ajay.app)') {
      return useSponsorBlock || useDeArrowTitles || useDeArrowThumbnails
    }
    if ([
      'Enable SponsorBlock Submission',
      'Notify when sponsor segment is skipped',
      'Skip notification timeout',
      'Skip Options',
      'Category Color'
    ].includes(group)) {
      return useSponsorBlock
    }
    if (group === 'SponsorBlock Private User ID (optional)') {
      return useSponsorBlock && store.getters.getSponsorBlockEnableSubmission
    }
    if (group === 'Generated SponsorBlock User ID') return false
    if (group === 'Reveal Generated User ID') {
      return useSponsorBlock && store.getters.getSponsorBlockEnableSubmission &&
        store.getters.getSponsorBlockGeneratedUserId !== ''
    }
    if (group === 'DeArrow Thumbnail Generator API Url (Default is https://dearrow-thumb.ajay.app)') {
      return useDeArrowThumbnails
    }
  }

  if (sectionType === 'return-youtube-dislike' && group === 'Return YouTube Dislike Url') {
    return store.getters.getUseReturnYouTubeDislikes
  }

  if (sectionType === 'proxy') {
    if ([
      'Proxy Settings',
      'Enable Tor / Proxy',
      'IP Block Recovery Script Path'
    ].includes(group)) {
      return true
    }
    if (['Proxy Username', 'Proxy Password'].includes(group)) {
      return store.getters.getUseProxy &&
        ['http', 'https'].includes(store.getters.getProxyProtocol)
    }
    return store.getters.getUseProxy && [
      'Proxy Protocol',
      'Proxy Host',
      'Proxy Port Number',
      'Test Proxy'
    ].includes(group)
  }

  if (sectionType === 'download') {
    return ['Download Settings', 'Enable Downloads'].includes(group) ||
      store.getters.getEnableDownloads
  }

  if (sectionType === 'storage') {
    if (group === 'Playback URL Cache Entry Size') return usingElectron || isCapacitor
  }

  if (sectionType === 'external-software') {
    if (isCapacitor) {
      if (['yt-dlp Source', 'yt-dlp Executable Path', 'FFmpeg Source', 'FFmpeg Executable Path', 'Download FFmpeg and FFprobe', 'Update FFmpeg and FFprobe', 'Browser for Cookies', 'Browser Profile'].includes(group)) return false
      if (['yt-dlp Channel', 'Managed Tool Updates'].includes(group)) return true
    }
    if (group === 'yt-dlp Channel') return store.getters.getYtDlpSource === 'managed'
    if (group === 'Managed Tool Updates') {
      return store.getters.getYtDlpSource === 'managed' ||
        store.getters.getYtDlpFfmpegSource === 'managed'
    }
    if (group === 'yt-dlp Executable Path') return store.getters.getYtDlpSource === 'system'
    if (group === 'FFmpeg Executable Path') return store.getters.getYtDlpFfmpegSource === 'system'
    if (group === 'Cookie File') return store.getters.getYtDlpPlaybackAuthMode === 'file'
    if (group === 'Browser for Cookies' || group === 'Browser Profile') {
      return store.getters.getYtDlpPlaybackAuthMode === 'browser'
    }
  }

  if (sectionType === 'channel') {
    if (isCapacitor && ['Enable Volume', 'Auto Update Volume', 'Volume'].includes(group)) {
      return false
    }
    if (group === 'Auto Update') {
      return store.getters.getRememberPlaybackSpeedPerChannel ||
        store.getters.getRememberVideoQualityPerChannel
    }
    if (group === 'Auto Update Subtitles') {
      return store.getters.getRememberSubtitlesStatePerChannel
    }
    if (group === 'Auto Update Volume') {
      return store.getters.getRememberVolumePerChannel
    }
    return [
      'Channel Settings',
      'Enable Playback Speed',
      'Enable Video Quality',
      'Enable Subtitles State',
      'Enable Volume'
    ].includes(group)
  }

  if (sectionType === 'distraction') {
    if (group === 'Show Added Items') {
      return store.getters.getChannelsHiddenParsed.length > 0 ||
        store.getters.getForbiddenTitlesParsed.length > 0
    }
    if (group === 'Hide Trending Videos') return supportsLocalApi
  }

  if (sectionType === 'theme') {
    if (isCapacitor && ['Font', 'Show Progress as Notification'].includes(group)) {
      return false
    }
    if (group === 'Custom Theme' && item === 'Edit Custom Theme') {
      const baseTheme = store.getters.getBaseTheme
      const selectedTheme = baseTheme === 'system'
        ? (systemUsesDarkTheme
            ? store.getters.getSystemDarkTheme
            : store.getters.getSystemLightTheme)
        : baseTheme
      return customThemeIdFromValue(selectedTheme) !== null
    }
    if (group === 'Light Theme' || group === 'Dark Theme') {
      return store.getters.getBaseTheme === 'system'
    }
    if (group === 'Move Downloads to App Header') {
      return usingElectron || isCapacitor
    }
    if (['Use Fixed Tab Width', 'Show Tab Icons', 'Tab Width'].includes(group)) {
      return usingElectron || isCapacitor
    }
    if ([
      'Disable Smooth Scrolling',
      'Move Settings to App Header',
      'Show Tab Previews',
      'Tab Layout',
      'Load Missing Tab Icons',
      'UI Scale'
    ].includes(group)) {
      return usingElectron && (
        group !== 'Load Missing Tab Icons' || store.getters.getShowTabIcons
      )
    }
  }

  if (sectionType === 'player' && isCapacitor && [
    'Default Volume',
    'Display Play Button In Video Player',
    'Remember Volume',
    'Scroll Volume Over Video Player',
  ].includes(group)) {
    return false
  }

  if (sectionType === 'player' && !isCapacitor && [
    'Rotate Wide Videos to Landscape in Fullscreen',
    'Swipe Up or Down to Enter or Exit Fullscreen',
  ].includes(group)) {
    return false
  }

  if (sectionType === 'password') {
    const hasStoredPassword = store.getters.getSettingsPassword !== ''
    if (group === 'Remove Password') return hasStoredPassword
    if (['Set Password To Prevent Access', 'Set Password'].includes(group)) {
      return !hasStoredPassword
    }
  }

  return true
}

function getCaptionEdgeStyle(store) {
  const value = store.getters.getDefaultCaptionSettings
  if (value !== null && typeof value === 'object') return value.edgeStyle ?? 'none'
  try {
    return JSON.parse(value).edgeStyle ?? 'none'
  } catch {
    return 'none'
  }
}

export function flattenSettingsSearchMessageValues(
  value,
  selectGroups = {},
  path = [],
  include = () => true
) {
  if (typeof value === 'string') return include(path, value) ? [value] : []
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenSettingsSearchMessageValues(
      item,
      selectGroups,
      [...path, index.toString()],
      include
    ))
  }
  if (value !== null && typeof value === 'object') {
    const retainedKeys = selectGroups[path.join('.')]
    return Object.entries(value)
      .filter(([key]) => retainedKeys === undefined || retainedKeys.includes(key))
      .flatMap(([key, childValue]) => flattenSettingsSearchMessageValues(
        childValue,
        selectGroups,
        [...path, key],
        include
      ))
  }
  return []
}

export function removeRedundantSettingsSearchMatches(values, locale) {
  const keptMatches = []
  const normalizedMatches = []
  for (const match of values.toSorted((a, b) => a.label.length - b.label.length)) {
    const normalizedValue = normalizeSettingsSearchText(match.label, locale)
    if (normalizedMatches.some(shorterValue => normalizedValue.includes(shorterValue))) continue
    keptMatches.push(match)
    normalizedMatches.push(normalizedValue)
  }
  return keptMatches
}

export function normalizeSettingsSearchText(value, locale) {
  return value.toLocaleLowerCase(locale).normalize('NFKD').replaceAll(/\s+/g, ' ').trim()
}
