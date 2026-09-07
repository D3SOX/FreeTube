import { app, session } from 'electron'
import { lstat, readdir, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'

import * as baseHandlers from '../datastores/handlers/base'
import { TabManager } from './tabs/TabManager'
import { clearYtDlpPlaybackCache } from './ytDlpPlaybackCache'

const USER_DATA_FILES = {
  downloadRecords: 'downloads.json',
  videoMetadata: 'video-metadata-cache.db',
  subscriptionCache: 'subscription-cache.db',
  searchHistory: 'search-history.db',
  history: 'history.db',
  watchStats: 'watch-stats.db',
  recommendations: 'recommendations.db',
  playlists: 'playlists.db',
  profiles: 'profiles.db',
  settings: 'settings.db',
  tabSessions: 'tab-session.db',
  liveReminders: 'live-reminders.db',
  ytDlpPlayback: 'yt-dlp-playback-cache.json'
}

const BROWSER_CACHE_ENTRIES = [
  'Code Cache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'Dictionaries',
  'GPUCache',
  'GrShaderCache',
  'Safe Browsing',
  'Service Worker',
  'ShaderCache',
  'Shared Dictionary',
  'component_crx_cache',
  'extensions_crx_cache'
]

const BROWSER_RUNTIME_ENTRIES = [
  'AutofillStrikeDatabase',
  'BrowserMetrics',
  'Cookies',
  'Cookies-journal',
  'Crash Reports',
  'Crashpad',
  'DIPS',
  'DIPS-journal',
  'DIPS-shm',
  'DIPS-wal',
  'DevToolsActivePort',
  'Favicons',
  'Favicons-journal',
  'File System',
  'History',
  'History-journal',
  'IndexedDB',
  'Local State',
  'Local Storage',
  'Login Data',
  'Login Data-journal',
  'Network',
  'Network Persistent State',
  'Origin Bound Certs',
  'Origin Bound Certs-journal',
  'Preferences',
  'QuotaManager',
  'QuotaManager-journal',
  'Reporting and NEL',
  'Reporting and NEL-journal',
  'Secure Preferences',
  'Session Storage',
  'SharedStorage',
  'SharedStorage-wal',
  'Shortcuts',
  'Shortcuts-journal',
  'Site Characteristics Database',
  'Top Sites',
  'Top Sites-journal',
  'TransportSecurity',
  'Trust Tokens',
  'Trust Tokens-journal',
  'VideoDecodeStats',
  'Visited Links',
  'Web Data',
  'Web Data-journal',
  'WebStorage',
  'blob_storage',
  'databases',
  'segmentation_platform',
  'shared_proto_db'
]

async function fileSize(filePath) {
  try {
    const fileStat = await stat(filePath)
    return fileStat.isFile() ? fileStat.size : 0
  } catch (error) {
    if (error?.code === 'ENOENT') return 0
    throw error
  }
}

async function entrySize(entryPath) {
  try {
    const entryStat = await lstat(entryPath)
    if (entryStat.isDirectory()) return directorySize(entryPath)
    if (entryStat.isFile()) return entryStat.size
    return 0
  } catch (error) {
    if (error?.code === 'ENOENT') return 0
    throw error
  }
}

async function profileEntrySizes(directoryPath) {
  let entries
  try {
    entries = await readdir(directoryPath)
  } catch (error) {
    if (error?.code === 'ENOENT') return new Map()
    throw error
  }

  return new Map(await Promise.all(entries.map(async entry => (
    [entry, await entrySize(join(directoryPath, entry))]
  ))))
}

function sumEntries(entrySizes, entryNames) {
  if (!(entrySizes instanceof Map)) return null
  return entryNames.reduce((total, entry) => total + (entrySizes.get(entry) ?? 0), 0)
}

async function readSize(read, label) {
  try {
    return await read()
  } catch (error) {
    console.warn(`Could not calculate ${label} storage usage`, error)
    return null
  }
}

export async function directorySize(directoryPath) {
  let entries
  try {
    entries = await readdir(directoryPath, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return 0
    throw error
  }

  const sizes = await Promise.all(entries.map(entry => {
    const entryPath = join(directoryPath, entry.name)
    if (entry.isDirectory()) return directorySize(entryPath)
    if (entry.isFile()) return fileSize(entryPath)
    return 0
  }))
  return sizes.reduce((total, size) => total + size, 0)
}

export async function getStorageUsage() {
  const userDataPath = app.getPath('userData')
  const entrySizes = await readSize(() => profileEntrySizes(userDataPath), 'profile directory')
  const fileEntries = Object.entries(USER_DATA_FILES).map(([key, fileName]) => (
    [key, sumEntries(entrySizes, [fileName])]
  ))
  const categorizedUsage = {
    ...Object.fromEntries(fileEntries),
    httpCache: sumEntries(entrySizes, ['Cache']),
    tabPreviews: sumEntries(entrySizes, [basename(TabManager.getTabPreviewCacheDirectory())]),
    playerCache: sumEntries(entrySizes, ['player_cache']),
    browserCacheData: sumEntries(entrySizes, BROWSER_CACHE_ENTRIES),
    browserRuntimeData: sumEntries(entrySizes, BROWSER_RUNTIME_ENTRIES)
  }
  const profileTotal = entrySizes instanceof Map
    ? [...entrySizes.values()].reduce((total, size) => total + size, 0)
    : null
  const categorizedSizes = Object.values(categorizedUsage)
  const otherProfileData = Number.isFinite(profileTotal) && categorizedSizes.every(Number.isFinite)
    ? Math.max(profileTotal - categorizedSizes.reduce((total, size) => total + size, 0), 0)
    : null

  return {
    ...categorizedUsage,
    otherProfileData,
    profileTotal
  }
}

export async function clearStorage(category) {
  const userDataPath = app.getPath('userData')
  switch (category) {
    case 'http-cache':
      await session.defaultSession.clearCache()
      break
    case 'tab-previews':
      await TabManager.clearTabPreviewCache()
      break
    case 'yt-dlp-playback':
      await clearYtDlpPlaybackCache()
      break
    case 'player-cache':
      await rm(join(userDataPath, 'player_cache'), { force: true, recursive: true })
      break
    default:
      return false
  }
  return true
}

export async function compactStorageDatabases() {
  await baseHandlers.compactAllDatastores()
  return true
}
