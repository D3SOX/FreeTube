import { buildYtDlpDownloadArguments } from '../ytDlpArguments'
import { PLAYBACK_INFO_OUTPUT_TEMPLATE, toFiniteNumber, toNonEmptyString, mapPlaybackFormat, mapPlaybackCaptions } from '../ytDlpMetadata'
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { inflateRawSync } from 'node:zlib'
import { app, BrowserWindow, net, Notification, shell } from 'electron'
import { settings } from '../datastores/handlers/base'
import { buildProxyUrl, isOpenTubeXUrl } from './utils'
import { TabManager } from './tabs/TabManager'
import { IpcChannels } from '../constants'
import { getMatchingDownloadValidators, getYtDlpAssetName } from './ytDlpAsset'
import { buildYtDlpStoryboardVtt } from './ytDlpStoryboard'
import { downloadYtDlpSubtitle } from './ytDlpSubtitle'
import { isYouTubeSubtitleUrl } from '../youtubeSubtitle'
import { shouldUseGioTrash } from './trashPlatform'
import {
  compareQueuedDownloads,
  normalizeDownloadBandwidth,
  normalizeDownloadConcurrency,
  resumePendingDownload,
  updatePendingDownloadStatuses,
} from './downloadQueue'
import { supportsNativeNotifications } from './nativeNotifications'

const execFileAsync = promisify(execFile)

/** @type {Map<string, AbortController>} */
const getInfoAbortControllers = new Map()

/**
 * Supersede an earlier ytDlpGetInfo for the same probe key. System and managed
 * refreshes use different keys so they can run in parallel on mount.
 * @param {string} key
 * @returns {AbortSignal}
 */
function takeGetInfoAbortSignal(key) {
  getInfoAbortControllers.get(key)?.abort()
  const controller = new AbortController()
  getInfoAbortControllers.set(key, controller)
  return controller.signal
}

/**
 * @typedef YtDlpDownloadPayload
 * @property {string} videoId
 * @property {string[]} [videoIds]
 * @property {string} [playlistId]
 * @property {string} [playlistKey] stable playlist identity used only by the renderer
 * @property {boolean} [isPlaylist]
 * @property {string} [title] only used for display purposes in the renderer
 * @property {string} [thumbnail] only used for display purposes in the renderer
 * @property {'video' | 'audio' | 'subtitles' | 'custom'} mode
 * @property {string} [quality] maximum video resolution e.g. '1080'
 * @property {string} [videoFormat] e.g. 'mp4'
 * @property {string} [audioFormat] e.g. 'mp3'
 * @property {string} [videoCodec]
 * @property {string} [filenameTemplate]
 * @property {string} [startTime]
 * @property {string} [endTime]
 * @property {boolean} [splitChapters]
 * @property {boolean} [removeSponsorblock]
 * @property {string[]} [sponsorBlockCategories]
 * @property {boolean} [includeSubtitles]
 * @property {boolean} [embedSubtitles]
 * @property {string} [subtitleLanguages]
 * @property {string} [subtitleFormat] e.g. 'srt'
 * @property {boolean} [embedThumbnail]
 * @property {boolean} [embedMetadata]
 * @property {string} [customArgs] additional yt-dlp command line arguments
 * @property {number} [estimatedSizeBytes] estimated output size when the caller has format metadata
 * @property {string} [template] the template the options came from, only used for display purposes
 * @property {boolean} [automatic] whether a subscription refresh started the download
 * @property {string} [channelId] channel whose persisted rule authorized the automatic download
 * @property {'video' | 'short' | 'livestream'} [automaticMediaType]
 * @property {string} [refreshOwnerTabId] logical tab that owns the subscription refresh
 * @property {number} [minDurationSeconds]
 * @property {number} [maxDurationSeconds]
 * @property {number} [minFileSizeMb]
 * @property {number} [maxFileSizeMb]
 * @property {number} [maxAgeDays]
 * @property {{ startedTitle?: string, startedBody?: string, completedTitle?: string, completedBody?: string, failedTitle?: string, failedBody?: string }} [notification]
 */

/**
 * @typedef YtDlpDownloadStatus
 * @property {number} id
 * @property {string} videoId
 * @property {string} playlistId
 * @property {string} playlistKey
 * @property {string} title
 * @property {string} thumbnail
 * @property {'video' | 'audio' | 'subtitles' | 'custom'} mode
 * @property {string} template
 * @property {boolean} [automatic]
 * @property {YtDlpDownloadPayload} [retryPayload]
 * @property {'queued' | 'downloading' | 'processing' | 'pausing' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'skipped'} status
 * @property {number} queuePosition
 * @property {boolean} [started]
 * @property {number} percent
 * @property {string | null} speed
 * @property {string | null} eta
 * @property {string | null} destination
 * @property {string[]} destinations
 * @property {{ videoId: string, path: string, duration?: number, width?: number, height?: number, available?: boolean }[]} [files]
 * @property {'available' | 'partial' | 'missing'} [availability]
 * @property {number} [availableDestinationCount]
 * @property {number} [destinationCount]
 * @property {number} [sizeBytes]
 * @property {boolean} [titleTruncated]
 * @property {number} [estimatedSizeBytes]
 * @property {number} [availableSpaceBytes]
 * @property {'unknown-estimate' | 'space-check-unavailable' | null} [spaceWarning]
 * @property {string | null} errorMessage
 */

const ID_REGEX = /^[\w-]{11}$/
const CHANNEL_ID_REGEX = /^UC[\w-]{22}$/
const AUTOMATIC_DISCOVERY_CACHE_TTL_MS = 60_000
const AUTOMATIC_DISCOVERY_TIMEOUT_MS = 15_000
const AUTOMATIC_METADATA_TIMEOUT_MS = 30_000
const AUTOMATIC_METADATA_MAX_BUFFER = 1024 * 1024
const AUTOMATIC_DISCOVERY_E2E_FIXTURE = 'automatic-download-discovery.xml'
const MANAGED_BINARY_UPDATE_CHECK_TIMEOUT_MS = 15_000
const AUTOMATIC_TITLE_TERM_LIMIT = 20
const AUTOMATIC_TITLE_TERM_LENGTH_LIMIT = 100
const AUTOMATIC_NUMBER_LIMITS = Object.freeze({
  minDurationSeconds: 31_536_000,
  maxDurationSeconds: 31_536_000,
  minFileSizeMb: 1_000_000,
  maxFileSizeMb: 1_000_000,
  maxAgeDays: 36_500
})
const BUILT_IN_AUTOMATIC_TEMPLATE_OPTIONS = new Map([
  ['video:best', { mode: 'video' }],
  ['video:best:mp4', { mode: 'video', videoFormat: 'mp4' }],
  ['video:1080', { mode: 'video', quality: '1080' }],
  ['video:1080:mp4', { mode: 'video', quality: '1080', videoFormat: 'mp4' }],
  ['video:720', { mode: 'video', quality: '720' }],
  ['video:720:mp4', { mode: 'video', quality: '720', videoFormat: 'mp4' }],
  ['video:480', { mode: 'video', quality: '480' }],
  ['video:480:mp4', { mode: 'video', quality: '480', videoFormat: 'mp4' }],
  ['audio:best', { mode: 'audio', embedThumbnail: true, embedMetadata: true }],
  ['audio:mp3', { mode: 'audio', audioFormat: 'mp3', embedThumbnail: true, embedMetadata: true }],
  ['subtitles:srt', { mode: 'subtitles', subtitleFormat: 'srt' }],
  ['subtitles:vtt', { mode: 'subtitles', subtitleFormat: 'vtt' }]
])
const PLAYLIST_ID_REGEX = /^[\w-]{10,128}$/
const SUBTITLE_FORMATS = ['srt', 'vtt', 'ass', 'lrc']
// Keeps local-playlist URLs comfortably below Windows' process command-line limit.
const MAX_LOCAL_PLAYLIST_VIDEOS = 500
const DENIED_CUSTOM_ARGS = [
  '--alias',
  '--config-location',
  '--config-locations',
  '--downloader',
  '--downloader-args',
  '--exec',
  '--exec-before-download',
  '--external-downloader',
  '--external-downloader-args',
  '--ffmpeg-location',
  '--plugin-dirs',
  '--remote-components'
]
const YT_DLP_RELEASE_REPOSITORIES = {
  stable: 'yt-dlp/yt-dlp',
  nightly: 'yt-dlp/yt-dlp-nightly-builds',
  master: 'yt-dlp/yt-dlp-master-builds'
}
const PROGRESS_REGEX = /^\[download\]\s+(\d+(?:\.\d+)?)%(?:.*?\bat\s+(\S+))?(?:.*?\bETA\s+(\S+))?/
const DESTINATION_REGEX = /^\[(?:download|ExtractAudio)\] Destination: (.+)$/
const MERGER_REGEX = /^\[Merger\] Merging formats into "(.+)"$/
// yt-dlp doesn't include subtitle files in its `after_move:%(filepath)s` output
const SUBTITLE_DESTINATION_REGEX = /^\[info\] Writing video subtitles to: (.+)$/
const FINAL_PATH_PREFIX = '__OPENTUBEX_FILE__:'
const FINAL_METADATA_PREFIX = '__OPENTUBEX_METADATA__:'
// yt-dlp's B conversion limits UTF-8 bytes. Leave room for IDs, extensions,
// format suffixes, and temporary-file suffixes within a 255-byte file name.
const DOWNLOAD_TITLE_FILENAME_BYTE_LIMIT = 200

let downloadCounter = 0
let downloadQueuePositionCounter = 0
let downloadRecordsSaveQueue = Promise.resolve()
let binaryInstallCounter = 0
let managedBinaryInstallQueue = Promise.resolve()
const retryingDownloadIds = new Set()
const automaticDiscoveryCache = new Map()
const activeAutomaticDownloadNotifications = new Set()
let downloadQueueDrainRunning = false
let downloadQueueDrainRequested = false
let runningDownloadCount = 0
let persistedDownloadQueueRestorePromise = null
let shuttingDownDownloads = false
let downloadQueuePaused = false
let downloadQueuePauseAllRequested = false

/** @type {Map<number, { child: import('node:child_process').ChildProcess, cancelled: boolean, paused: boolean, restarting: boolean, restartStatus: 'queued' | 'paused' }>} */
const activeDownloads = new Map()
/** @type {Map<number, YtDlpDownloadStatus>} */
const downloadRecords = new Map()
/** @type {Map<number, (permitted: boolean) => void>} */
const queuedDownloadWaiters = new Map()
const individuallyResumedDownloadIds = new Set()
/** @type {Promise<void> | null} */
let downloadRecordsLoadPromise = null

function broadcastToRenderers(channel, payload) {
  for (const browserWindow of BrowserWindow.getAllWindows()) {
    if (!browserWindow.webContents.isDestroyed() && isOpenTubeXUrl(browserWindow.webContents.getURL())) {
      browserWindow.webContents.send(channel, payload)
    }
  }
}

function showAutomaticDownloadNotification(payload, phase, downloadId = null) {
  if (payload.automatic !== true || !supportsNativeNotifications(Notification)) {
    return
  }

  const title = payload.notification?.[`${phase}Title`]
  const body = payload.notification?.[`${phase}Body`]
  if (typeof title !== 'string' || title.length === 0 || title.length > 200 ||
    typeof body !== 'string' || body.length === 0 || body.length > 500) {
    return
  }

  const notification = new Notification({ title, body })
  activeAutomaticDownloadNotifications.add(notification)
  notification.once('close', () => activeAutomaticDownloadNotifications.delete(notification))
  notification.once('click', () => {
    activeAutomaticDownloadNotifications.delete(notification)
    const browserWindow = BrowserWindow.getAllWindows().find(window => (
      !window.isDestroyed() && TabManager.getForWindow(window.id)
    )) ?? BrowserWindow.getAllWindows().find(window => !window.isDestroyed())
    if (browserWindow) {
      if (browserWindow.isMinimized()) browserWindow.restore()
      browserWindow.show()
      browserWindow.focus()

      const tabManager = TabManager.getForWindow(browserWindow.id)
      if (phase === 'started') {
        browserWindow.webContents.send(IpcChannels.CHANGE_VIEW, '/downloads')
      } else if (phase === 'completed' && tabManager && ID_REGEX.test(payload.videoId) && Number.isInteger(downloadId)) {
        tabManager.createTabWithPreference({
          route: `/watch/${payload.videoId}`,
          query: { downloadId },
          makeActive: true
        }).catch(error => {
          console.error('Failed to open automatically downloaded video', error)
        })
      }
    }
  })
  notification.show()
}

function getDownloadRecordsPath() {
  return join(app.getPath('userData'), 'downloads.json')
}

function broadcastDownloadStatus(record) {
  broadcastToRenderers(IpcChannels.YT_DLP_DOWNLOAD_STATUS, { ...record })
}

function setPendingDownloadStatus(status) {
  const pendingIds = status === 'paused'
    ? [...queuedDownloadWaiters.keys()].filter(id => !individuallyResumedDownloadIds.has(id))
    : queuedDownloadWaiters.keys()
  const updated = updatePendingDownloadStatuses(
    downloadRecords,
    pendingIds,
    status
  )
  for (const record of updated) {
    broadcastDownloadStatus(record)
  }
  return updated
}

async function getDownloadQueueSettings() {
  const concurrency = await settings._findOne('ytDlpMaxConcurrentDownloads')
  return {
    concurrency: normalizeDownloadConcurrency(concurrency?.value),
  }
}

async function drainDownloadQueue() {
  if (shuttingDownDownloads) return
  const queueSettings = await getDownloadQueueSettings()

  while (runningDownloadCount < queueSettings.concurrency) {
    const next = [...queuedDownloadWaiters.keys()]
      .map(id => downloadRecords.get(id))
      .filter(record => record?.status === 'queued' && (
        !downloadQueuePaused || individuallyResumedDownloadIds.has(record.id)
      ))
      .sort(compareQueuedDownloads)[0]
    if (!next) return

    const resolve = queuedDownloadWaiters.get(next.id)
    queuedDownloadWaiters.delete(next.id)
    runningDownloadCount++
    resolve?.(true)
  }
}

async function requestDownloadQueueDrain() {
  downloadQueueDrainRequested = true
  if (downloadQueueDrainRunning) return
  downloadQueueDrainRunning = true
  try {
    while (downloadQueueDrainRequested) {
      downloadQueueDrainRequested = false
      await drainDownloadQueue()
    }
  } finally {
    downloadQueueDrainRunning = false
  }
}

function waitForDownloadSlot(id) {
  return new Promise(resolve => {
    queuedDownloadWaiters.set(id, resolve)
    if (downloadQueuePaused && setPendingDownloadStatus('paused').length > 0) {
      saveDownloadRecords().catch(error => console.warn('Could not save download history', error))
    }
    requestDownloadQueueDrain().catch(error => console.warn('Could not schedule downloads', error))
  })
}

function cancelQueuedDownload(id) {
  const resolve = queuedDownloadWaiters.get(id)
  if (!resolve) return false
  queuedDownloadWaiters.delete(id)
  individuallyResumedDownloadIds.delete(id)
  resolve(false)
  return true
}

function releaseDownloadSlot() {
  runningDownloadCount = Math.max(0, runningDownloadCount - 1)
  requestDownloadQueueDrain().catch(error => console.warn('Could not schedule downloads', error))
}

function loadDownloadRecords() {
  downloadRecordsLoadPromise ??= (async () => {
    try {
      const records = JSON.parse(await readFile(getDownloadRecordsPath(), 'utf8'))
      if (!Array.isArray(records)) return
      for (const record of records) {
        if (Number.isInteger(record?.id) && typeof record.title === 'string' &&
          ['queued', 'paused', 'completed', 'failed', 'cancelled', 'skipped'].includes(record.status)) {
          const normalizedRecord = {
            ...record,
            queuePosition: Number.isFinite(record.queuePosition) ? record.queuePosition : record.id,
          }
          if (!downloadRecords.has(record.id)) downloadRecords.set(record.id, normalizedRecord)
          downloadCounter = Math.max(downloadCounter, record.id)
          downloadQueuePositionCounter = Math.max(downloadQueuePositionCounter, normalizedRecord.queuePosition)
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('Could not load download history', error)
    }
  })()
  return downloadRecordsLoadPromise
}

function hasAutomaticDownloadRecord(videoId) {
  return [...downloadRecords.values()].some(record => (
    record.videoId === videoId && ['queued', 'downloading', 'processing', 'pausing', 'paused', 'completed', 'skipped'].includes(record.status)
  ))
}

function saveDownloadRecords() {
  downloadRecordsSaveQueue = downloadRecordsSaveQueue
    .catch(() => {})
    .then(() => {
      const records = [...downloadRecords.values()]
        .map(record => ['downloading', 'processing', 'pausing'].includes(record.status)
          ? { ...record, status: record.status === 'pausing' ? 'paused' : 'queued', speed: null, eta: null }
          : record)
        .slice(-200)
      return writeFile(getDownloadRecordsPath(), JSON.stringify(records), 'utf8')
    })
  return downloadRecordsSaveQueue
}

export function flushYtDlpDownloadRecords() {
  return downloadRecordsSaveQueue
}

export async function shutdownYtDlpDownloads() {
  shuttingDownDownloads = true
  const downloads = [...activeDownloads.values()]
  const settled = downloads.map(({ child }) => new Promise((resolve) => {
    child.once('close', resolve)
    child.once('error', resolve)
  }))

  for (const [id, entry] of activeDownloads) {
    entry.restarting = true
    const record = downloadRecords.get(id)
    entry.restartStatus = record && ['paused', 'pausing'].includes(record.status) ? 'paused' : 'queued'
    if (entry.paused) entry.child.kill('SIGCONT')
    entry.child.kill()
  }

  await Promise.allSettled(settled)
  await saveDownloadRecords()
}
const windowsShownOnce = new WeakSet()

/**
 * Keep first-launch executable checks and downloads from competing with the
 * renderer before its BrowserWindow has been presented.
 * @param {import('electron').WebContents} webContents
 * @returns {Promise<boolean>}
 */
async function waitForFirstWindowShow(webContents) {
  const browserWindow = BrowserWindow.fromWebContents(webContents)
  if (browserWindow === null || browserWindow.isDestroyed()) {
    return false
  }
  if (windowsShownOnce.has(browserWindow)) {
    return true
  }

  if (browserWindow.isVisible()) {
    windowsShownOnce.add(browserWindow)
    return true
  }

  await new Promise(resolve => {
    const finish = () => {
      browserWindow.removeListener('show', finish)
      browserWindow.removeListener('closed', finish)
      resolve()
    }

    browserWindow.once('show', finish)
    browserWindow.once('closed', finish)
  })

  if (!browserWindow.isDestroyed()) {
    windowsShownOnce.add(browserWindow)
    return true
  }

  return false
}

function getManagedBinariesDirectory() {
  return join(app.getPath('userData'), 'yt-dlp')
}

/**
 * @param {'yt-dlp' | 'ffmpeg' | 'ffprobe'} binaryName
 */
function getManagedBinaryPath(binaryName) {
  return join(getManagedBinariesDirectory(), process.platform === 'win32' ? `${binaryName}.exe` : binaryName)
}

/**
 * @param {'ytDlpSource' | 'ytDlpFfmpegSource'} sourceSettingId
 * @param {'ytDlpPath' | 'ytDlpFfmpegPath'} pathSettingId
 * @param {'yt-dlp' | 'ffmpeg'} binaryName
 * @param {'system' | 'managed'} [sourceOverride]
 * @param {string} [pathOverride]
 * @returns {Promise<{ source: 'system' | 'managed', executable: string }>}
 */
async function resolveExecutable(sourceSettingId, pathSettingId, binaryName, sourceOverride, pathOverride) {
  /** @type {'system' | 'managed'} */
  const source = sourceOverride ?? ((await settings._findOne(sourceSettingId))?.value === 'managed' ? 'managed' : 'system')

  if (source === 'managed') {
    return { source, executable: getManagedBinaryPath(binaryName) }
  }

  /** @type {string} */
  const customPath = pathOverride ?? ((await settings._findOne(pathSettingId))?.value || '')

  return { source, executable: customPath === '' ? binaryName : customPath }
}

/**
 * FFmpeg and FFprobe share one source setting because yt-dlp accepts a single
 * `--ffmpeg-location`. A custom FFmpeg path therefore also locates FFprobe in
 * the same directory.
 * @param {'system' | 'managed'} [sourceOverride]
 * @param {string} [ffmpegPathOverride]
 * @returns {Promise<{ source: 'system' | 'managed', executable: string }>}
 */
async function resolveFfprobeExecutable(sourceOverride, ffmpegPathOverride) {
  const ffmpeg = await resolveExecutable(
    'ytDlpFfmpegSource',
    'ytDlpFfmpegPath',
    'ffmpeg',
    sourceOverride,
    ffmpegPathOverride
  )

  if (ffmpeg.source === 'managed') {
    return { source: ffmpeg.source, executable: getManagedBinaryPath('ffprobe') }
  }

  const ffprobeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
  const ffmpegDirectory = dirname(ffmpeg.executable)
  return {
    source: ffmpeg.source,
    executable: ffmpegDirectory === '.' ? 'ffprobe' : join(ffmpegDirectory, ffprobeName)
  }
}

/**
 * Builds the proxy URL for yt-dlp's `--proxy` argument from the app's proxy settings.
 * @returns {Promise<string | null>} null when the proxy is disabled
 */
async function getProxyUrl() {
  if (!(await settings._findOne('useProxy'))?.value) {
    return null
  }

  return buildProxyUrl({
    protocol: (await settings._findOne('proxyProtocol'))?.value,
    hostname: (await settings._findOne('proxyHostname'))?.value,
    port: (await settings._findOne('proxyPort'))?.value,
    username: (await settings._findOne('proxyUsername'))?.value,
    password: (await settings._findOne('proxyPassword'))?.value
  })
}

/**
 * @param {string[]} args
 */
async function pushProxyArgument(args) {
  const proxyUrl = await getProxyUrl()

  if (proxyUrl !== null) {
    args.push('--proxy', proxyUrl)
  }
}

/**
 * @param {string} executable
 * @param {AbortSignal} [signal] aborts a superseded ytDlpGetInfo probe
 * @returns {Promise<string | null>} the version, or null if the executable doesn't work
 */
async function getYtDlpVersion(executable, signal) {
  try {
    // PyInstaller onefile builds extract on first launch; allow time for that on slow disks/VMs
    const { stdout } = await execFileAsync(executable, ['--version'], {
      timeout: 60_000,
      windowsHide: true,
      signal
    })
    return stdout.trim()
  } catch {
    return null
  }
}

/**
 * @param {string} helpOutput
 * @returns {string[]}
 */
export function parseYtDlpSupportedBrowsers(helpOutput) {
  const browserList = helpOutput.match(
    /Currently supported browsers are:\s*([\s\S]*?)\s+Optionally,\s+the KEYRING/i
  )?.[1]

  if (browserList === undefined) {
    return []
  }

  const browsers = browserList
    .replaceAll(/\s+/g, ' ')
    .split(',')
    .map(browser => browser.trim())
    .filter(browser => /^[a-z0-9_-]+$/i.test(browser))

  return [...new Set(browsers)]
}

/**
 * Reads the browser names from yt-dlp's own help output so newly supported
 * browsers appear without an OpenTubeX update.
 * @param {string} executable
 * @param {AbortSignal} [signal]
 * @returns {Promise<string[]>}
 */
async function getYtDlpSupportedBrowsers(executable, signal) {
  try {
    const { stdout } = await execFileAsync(executable, ['--help'], {
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
      signal
    })
    return parseYtDlpSupportedBrowsers(stdout)
  } catch {
    return []
  }
}

/**
 * @param {string} executable
 * @param {AbortSignal} [signal] aborts a superseded ytDlpGetInfo probe
 * @returns {Promise<string | null>} the version, or null if the executable doesn't work
 */
async function getFfmpegVersion(executable, signal) {
  try {
    const { stdout } = await execFileAsync(executable, ['-version'], {
      timeout: 60_000,
      windowsHide: true,
      signal
    })
    const version = /^ffmpeg version (\S+)/.exec(stdout)?.[1] ?? null
    // the martin-riedl.de builds embed their website URL in the version string
    return version?.replace(/-https?:.*$/, '') ?? null
  } catch {
    return null
  }
}

/**
 * @param {string} executable
 * @param {AbortSignal} [signal] aborts a superseded ytDlpGetInfo probe
 * @returns {Promise<string | null>} the version, or null if the executable doesn't work
 */
async function getFfprobeVersion(executable, signal) {
  try {
    const { stdout } = await execFileAsync(executable, ['-version'], {
      timeout: 60_000,
      windowsHide: true,
      signal
    })
    const version = /^ffprobe version (\S+)/.exec(stdout)?.[1] ?? null
    return version?.replace(/-https?:.*$/, '') ?? null
  } catch {
    return null
  }
}

/**
 * @callback BinaryDownloadProgressCallback
 * @param {number | null} percent null when the total size is unknown
 */

/**
 * @typedef BinaryDownloadValidators
 * @property {string | null} etag
 * @property {string | null} lastModified
 * @property {string} [source]
 * @property {'stable' | 'nightly' | 'master'} [channel]
 */

/**
 * @param {string} url
 * @param {BinaryDownloadProgressCallback | undefined} onProgress
 * @param {(() => void) | undefined} onDownloadStart
 * @param {BinaryDownloadValidators | null} validators
 * @returns {Promise<{ data: Buffer | null, validators: BinaryDownloadValidators }>}
 */
async function downloadFile(url, onProgress, onDownloadStart, validators) {
  const headers = {}
  if (validators?.etag) {
    headers['If-None-Match'] = validators.etag
  }
  if (validators?.lastModified) {
    headers['If-Modified-Since'] = validators.lastModified
  }

  // use Electron's net module instead of fetch, so that the download
  // goes through the configured proxy (including its authentication)
  const response = await net.fetch(url, { headers })

  if (response.status === 304) {
    return { data: null, validators }
  }

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`)
  }

  onDownloadStart?.()

  const contentLength = parseInt(response.headers.get('content-length')) || 0

  /** @type {Buffer[]} */
  const chunks = []
  let receivedBytes = 0
  let lastReportedPercent = -1

  for await (const chunk of response.body) {
    chunks.push(Buffer.from(chunk))
    receivedBytes += chunk.byteLength

    if (contentLength > 0) {
      const percent = Math.min(Math.round((receivedBytes / contentLength) * 100), 100)

      if (percent !== lastReportedPercent) {
        lastReportedPercent = percent
        onProgress?.(percent)
      }
    } else {
      onProgress?.(null)
    }
  }

  return {
    data: Buffer.concat(chunks),
    validators: {
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified')
    }
  }
}

/**
 * Checks a managed download without transferring its payload.
 * A missing validator means there is no trustworthy installed-release baseline.
 * @param {string} url
 * @param {BinaryDownloadValidators | null} validators
 * @returns {Promise<boolean>}
 */
async function isFileUpdateAvailable(url, validators) {
  if (!validators?.etag && !validators?.lastModified) {
    return false
  }

  const headers = {}
  if (validators.etag) {
    headers['If-None-Match'] = validators.etag
  }
  if (validators.lastModified) {
    headers['If-Modified-Since'] = validators.lastModified
  }

  const response = await net.fetch(url, {
    method: 'HEAD',
    headers,
    signal: AbortSignal.timeout(MANAGED_BINARY_UPDATE_CHECK_TIMEOUT_MS)
  })
  if (response.status === 304) {
    return false
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`)
  }

  return true
}

/**
 * @param {string} binaryPath
 * @param {string} source
 * @param {'stable' | 'nightly' | 'master'} [channel]
 * @returns {Promise<BinaryDownloadValidators | null>}
 */
async function readDownloadValidators(binaryPath, source, channel) {
  if (!existsSync(binaryPath)) {
    return null
  }

  try {
    const validators = JSON.parse(await readFile(`${binaryPath}.download.json`, 'utf8'))
    return getMatchingDownloadValidators(validators, source, channel)
  } catch {
    return null
  }
}

/**
 * @param {string} binaryPath
 * @param {BinaryDownloadValidators} validators
 * @param {string} source
 * @param {'stable' | 'nightly' | 'master'} [channel]
 */
async function writeDownloadValidators(binaryPath, validators, source, channel) {
  await writeFile(`${binaryPath}.download.json`, JSON.stringify({
    ...validators,
    source,
    ...(channel === undefined ? {} : { channel })
  }))
}

/**
 * Minimal ZIP extractor that reads a single file from an archive.
 * The FFmpeg builds only use stored or deflated entries,
 * so this avoids pulling in a full archive dependency.
 * @param {Buffer} zip
 * @param {(name: string) => boolean} matches
 * @returns {Buffer}
 */
function extractZipEntry(zip, matches) {
  // locate the end of central directory record,
  // which is at the very end of the file apart from an optional comment
  const earliestPossibleOffset = Math.max(zip.length - 65557, 0)
  let eocdOffset = -1
  for (let i = zip.length - 22; i >= earliestPossibleOffset; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i
      break
    }
  }

  if (eocdOffset === -1) {
    throw new Error('Invalid zip file')
  }

  const entryCount = zip.readUInt16LE(eocdOffset + 10)
  let offset = zip.readUInt32LE(eocdOffset + 16)

  for (let i = 0; i < entryCount; i++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) {
      break
    }

    const compressionMethod = zip.readUInt16LE(offset + 10)
    const compressedSize = zip.readUInt32LE(offset + 20)
    const nameLength = zip.readUInt16LE(offset + 28)
    const extraLength = zip.readUInt16LE(offset + 30)
    const commentLength = zip.readUInt16LE(offset + 32)
    const localHeaderOffset = zip.readUInt32LE(offset + 42)
    const name = zip.toString('utf-8', offset + 46, offset + 46 + nameLength)

    if (matches(name)) {
      // the name and extra field lengths in the local header can
      // differ from the ones in the central directory, so read them again
      const localNameLength = zip.readUInt16LE(localHeaderOffset + 26)
      const localExtraLength = zip.readUInt16LE(localHeaderOffset + 28)
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength
      const data = zip.subarray(dataStart, dataStart + compressedSize)

      if (compressionMethod === 8) {
        return inflateRawSync(data)
      } else if (compressionMethod === 0) {
        return Buffer.from(data)
      }

      throw new Error(`Unsupported zip compression method: ${compressionMethod}`)
    }

    offset += 46 + nameLength + extraLength + commentLength
  }

  throw new Error('Binary not found in the downloaded archive')
}

/**
 * @param {Buffer} data
 * @param {string} destinationPath
 */
async function installBinary(data, destinationPath) {
  await mkdir(getManagedBinariesDirectory(), { recursive: true })

  // write to a temporary file first, so a failed download
  // doesn't corrupt an existing working binary
  const temporaryPath = `${destinationPath}.part`
  await writeFile(temporaryPath, data)

  if (process.platform !== 'win32') {
    await chmod(temporaryPath, 0o755)
  }

  await rename(temporaryPath, destinationPath)
}

/**
 * Replaces a related set of managed binaries as one transaction. If any
 * replacement fails, every executable that was already replaced is restored.
 * @template T
 * @param {{ data: Buffer, path: string }[]} binaries
 * @param {() => Promise<T>} validate
 * @returns {Promise<T>}
 */
async function performAtomicBinaryInstall(binaries, validate) {
  if (binaries.length === 0) {
    return validate()
  }

  await mkdir(getManagedBinariesDirectory(), { recursive: true })

  const transactionId = `${process.pid}-${++binaryInstallCounter}`
  const entries = binaries.map(binary => ({
    ...binary,
    temporaryPath: `${binary.path}.part-${transactionId}`,
    backupPath: `${binary.path}.backup-${transactionId}`,
    backedUp: false,
    installed: false
  }))

  let result
  try {
    for (const entry of entries) {
      await writeFile(entry.temporaryPath, entry.data)
      if (process.platform !== 'win32') {
        await chmod(entry.temporaryPath, 0o755)
      }
    }

    for (const entry of entries) {
      if (existsSync(entry.path)) {
        await rename(entry.path, entry.backupPath)
        entry.backedUp = true
      }
    }

    for (const entry of entries) {
      await rename(entry.temporaryPath, entry.path)
      entry.installed = true
    }

    result = await validate()
  } catch (error) {
    const rollbackErrors = []
    async function attemptRollback(operation) {
      try {
        await operation()
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }

    for (const entry of entries.toReversed()) {
      if (entry.installed) {
        await attemptRollback(() => rm(entry.path, { force: true }))
      }
      if (entry.backedUp) {
        await attemptRollback(() => rename(entry.backupPath, entry.path))
      }
      await attemptRollback(() => rm(entry.temporaryPath, { force: true }))
    }

    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        rollbackErrors,
        'Installing the managed binaries failed and could not be fully rolled back',
        { cause: error }
      )
    }
    throw error
  }

  const cleanupResults = await Promise.allSettled(entries
    .filter(entry => entry.backedUp)
    .map(entry => rm(entry.backupPath, { force: true })))
  const cleanupErrors = cleanupResults.filter(result => result.status === 'rejected')
  if (cleanupErrors.length > 0) {
    console.warn('Could not remove managed binary backups', cleanupErrors)
  }

  return result
}

/**
 * Prevents concurrent managed downloads from interleaving transactions that
 * replace the same FFmpeg and FFprobe destinations.
 * @template T
 * @param {{ data: Buffer, path: string }[]} binaries
 * @param {() => Promise<T>} validate
 * @returns {Promise<T>}
 */
async function installBinariesAtomically(binaries, validate) {
  const installation = managedBinaryInstallQueue
    .catch(() => {})
    .then(() => performAtomicBinaryInstall(binaries, validate))
  managedBinaryInstallQueue = installation
  return installation
}

/**
 * Downloads the latest yt-dlp release into the user data directory
 * @param {BinaryDownloadProgressCallback} [onProgress]
 * @param {() => void} [onDownloadStart]
 * @returns {Promise<{ version: string, updated: boolean } | { error: string }>}
 */
async function downloadManagedYtDlp(onProgress, onDownloadStart) {
  const configuredChannel = (await settings._findOne('ytDlpChannel'))?.value
  const channel = Object.hasOwn(YT_DLP_RELEASE_REPOSITORIES, configuredChannel) ? configuredChannel : 'stable'
  const assetName = getYtDlpAssetName(process.platform, process.arch)
  const source = `https://github.com/${YT_DLP_RELEASE_REPOSITORIES[channel]}/releases/latest/download/${assetName}`

  const managedPath = getManagedBinaryPath('yt-dlp')
  let download

  try {
    download = await downloadFile(
      source,
      onProgress,
      onDownloadStart,
      await readDownloadValidators(managedPath, source, channel)
    )

    if (download.data !== null) {
      await installBinary(download.data, managedPath)
    }
  } catch (error) {
    return { error: error.message }
  }

  const version = await getYtDlpVersion(managedPath)

  if (version === null) {
    return { error: 'The downloaded yt-dlp binary does not work on this system' }
  }

  if (download.data !== null) {
    try {
      await writeDownloadValidators(managedPath, download.validators, source, channel)
    } catch (error) {
      console.warn('Could not save yt-dlp download metadata', error)
    }
    broadcastToRenderers(IpcChannels.YT_DLP_BINARY_UPDATED)
  }

  return { version, updated: download.data !== null }
}

/**
 * Downloads up-to-date FFmpeg and FFprobe builds into the user data directory.
 * They are kept together because yt-dlp locates both through one
 * `--ffmpeg-location` argument.
 * @param {BinaryDownloadProgressCallback} [onProgress]
 * @param {() => void} [onDownloadStart]
 * @returns {Promise<{ version: string, updated: boolean } | { error: string }>}
 */
async function downloadManagedFfmpeg(onProgress, onDownloadStart) {
  const ffmpegPath = getManagedBinaryPath('ffmpeg')
  const ffprobePath = getManagedBinaryPath('ffprobe')
  const pendingValidatorWrites = []
  const pendingInstalls = []

  if (process.platform === 'win32') {
    // yt-dlp's own FFmpeg builds, patched for use with yt-dlp,
    // unfortunately they are only extractable without extra dependencies for Windows (zip)
    const url = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip'

    try {
      // Existing FFmpeg-only installations must fetch the archive again so
      // FFprobe can be added even when its validators would return 304.
      const validators = existsSync(ffprobePath)
        ? await readDownloadValidators(ffmpegPath, url)
        : null
      const download = await downloadFile(url, onProgress, onDownloadStart, validators)

      if (download.data !== null) {
        pendingInstalls.push(
          { data: extractZipEntry(download.data, name => name.endsWith('/bin/ffmpeg.exe')), path: ffmpegPath },
          { data: extractZipEntry(download.data, name => name.endsWith('/bin/ffprobe.exe')), path: ffprobePath }
        )
        pendingValidatorWrites.push(
          { path: ffmpegPath, validators: download.validators, url },
          { path: ffprobePath, validators: download.validators, url }
        )
      }
    } catch (error) {
      return { error: error.message }
    }
  } else {
    // daily builds of the latest FFmpeg release for Linux and macOS
    // https://ffmpeg.martin-riedl.de
    const platform = process.platform === 'darwin' ? 'macos' : 'linux'
    const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
    const binaries = [
      { name: 'ffmpeg', path: ffmpegPath },
      { name: 'ffprobe', path: ffprobePath }
    ]
    try {
      for (const [index, binary] of binaries.entries()) {
        const url = `https://ffmpeg.martin-riedl.de/redirect/latest/${platform}/${arch}/release/${binary.name}.zip`
        const download = await downloadFile(
          url,
          percent => onProgress?.(percent === null ? null : Math.round((index * 100 + percent) / binaries.length)),
          onDownloadStart,
          await readDownloadValidators(binary.path, url)
        )

        if (download.data !== null) {
          pendingInstalls.push({
            data: extractZipEntry(download.data, name => name === binary.name),
            path: binary.path
          })
          pendingValidatorWrites.push({ path: binary.path, validators: download.validators, url })
        }
      }
    } catch (error) {
      return { error: error.message }
    }
  }

  let version
  try {
    version = await installBinariesAtomically(pendingInstalls, async () => {
      const [ffmpegVersion, ffprobeVersion] = await Promise.all([
        getFfmpegVersion(ffmpegPath),
        getFfprobeVersion(ffprobePath)
      ])

      if (ffmpegVersion === null) {
        throw new Error('The downloaded FFmpeg binary does not work on this system')
      }
      if (ffprobeVersion === null) {
        throw new Error('The downloaded FFprobe binary does not work on this system')
      }

      return ffmpegVersion
    })
  } catch (error) {
    return { error: error.message }
  }

  try {
    await Promise.all(pendingValidatorWrites.map(({ path, validators, url }) =>
      writeDownloadValidators(path, validators, url)))
  } catch (error) {
    console.warn('Could not save FFmpeg and FFprobe download metadata', error)
  }

  return { version, updated: pendingInstalls.length > 0 }
}

/**
 * Checks whether the selected managed binary has a newer remote asset.
 * @param {'yt-dlp' | 'ffmpeg'} binary
 * @returns {Promise<boolean>}
 */
async function isManagedBinaryUpdateAvailable(binary) {
  if (binary === 'yt-dlp') {
    const configuredChannel = (await settings._findOne('ytDlpChannel'))?.value
    const channel = Object.hasOwn(YT_DLP_RELEASE_REPOSITORIES, configuredChannel) ? configuredChannel : 'stable'
    const assetName = getYtDlpAssetName(process.platform, process.arch)
    const source = `https://github.com/${YT_DLP_RELEASE_REPOSITORIES[channel]}/releases/latest/download/${assetName}`
    const managedPath = getManagedBinaryPath('yt-dlp')
    return isFileUpdateAvailable(source, await readDownloadValidators(managedPath, source, channel))
  }

  const ffmpegPath = getManagedBinaryPath('ffmpeg')
  if (process.platform === 'win32') {
    const url = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip'
    return isFileUpdateAvailable(url, await readDownloadValidators(ffmpegPath, url))
  }

  const platform = process.platform === 'darwin' ? 'macos' : 'linux'
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
  for (const binaryName of ['ffmpeg', 'ffprobe']) {
    const url = `https://ffmpeg.martin-riedl.de/redirect/latest/${platform}/${arch}/release/${binaryName}.zip`
    const binaryPath = getManagedBinaryPath(binaryName)
    if (await isFileUpdateAvailable(url, await readDownloadValidators(binaryPath, url))) {
      return true
    }
  }

  return false
}

/**
 * @typedef YtDlpBinaryInfo
 * @property {'system' | 'managed'} source
 * @property {boolean} available
 * @property {string | null} version
 */

/**
 * @typedef {YtDlpBinaryInfo & { supportedBrowsers: string[] }} YtDlpInfo
 */

/**
 * @param {{ source: 'system' | 'managed', executable: string }} resolved
 * @param {(executable: string) => Promise<string | null>} getVersion
 * @returns {Promise<YtDlpBinaryInfo>}
 */
async function getBinaryInfo(resolved, getVersion) {
  if (resolved.source === 'managed' && !existsSync(resolved.executable)) {
    return { source: resolved.source, available: false, version: null }
  }

  const version = await getVersion(resolved.executable)

  return { source: resolved.source, available: version !== null, version }
}

/**
 * @param {{ source: 'system' | 'managed', executable: string }} resolved
 * @param {AbortSignal} signal
 * @returns {Promise<YtDlpInfo>}
 */
async function getYtDlpInfo(resolved, signal) {
  if (resolved.source === 'managed' && !existsSync(resolved.executable)) {
    return { source: resolved.source, available: false, version: null, supportedBrowsers: [] }
  }

  const [version, supportedBrowsers] = await Promise.all([
    getYtDlpVersion(resolved.executable, signal),
    getYtDlpSupportedBrowsers(resolved.executable, signal)
  ])

  return {
    source: resolved.source,
    available: version !== null,
    version,
    supportedBrowsers
  }
}

/**
 * @param {{
 *   ytDlpSource: 'system' | 'managed',
 *   ytDlpPath: string,
 *   ffmpegSource: 'system' | 'managed',
 *   ffmpegPath: string
 * } | undefined} options
 * @returns {string}
 */
function getInfoProbeKey(options) {
  if (options === undefined) {
    return 'startup'
  }

  return `${options.ytDlpSource}:${options.ffmpegSource}`
}

/**
 * @param {import('electron').IpcMainInvokeEvent} event
 * @param {{
 *   ytDlpSource: 'system' | 'managed',
 *   ytDlpPath: string,
 *   ffmpegSource: 'system' | 'managed',
 *   ffmpegPath: string
 * } | undefined} [options]
 * @returns {Promise<{ ytDlp: YtDlpInfo, ffmpeg: YtDlpBinaryInfo, ffprobe: YtDlpBinaryInfo } | null>}
 */
export async function handleYtDlpGetInfo(event, options) {
  if (!isOpenTubeXUrl(event.senderFrame.url)) {
    return null
  }

  // The startup check (called without options) downloads the managed binaries
  // when they are missing, which would hit the network and show the download
  // progress bar during E2E runs.
  if (options === undefined && process.env.OPENTUBEX_E2E_USER_DATA_DIR) {
    return null
  }

  if (options !== undefined && (
    options === null ||
    typeof options !== 'object' ||
    (options.ytDlpSource !== 'system' && options.ytDlpSource !== 'managed') ||
    typeof options.ytDlpPath !== 'string' ||
    (options.ffmpegSource !== 'system' && options.ffmpegSource !== 'managed') ||
    typeof options.ffmpegPath !== 'string'
  )) {
    return null
  }

  if (!await waitForFirstWindowShow(event.sender)) {
    return null
  }

  // Abort superseded probes for this key (e.g. rapid path edits) so the longer
  // PyInstaller cold-start timeout cannot accumulate children. System vs managed
  // use different keys and stay concurrent.
  const probeKey = getInfoProbeKey(options)
  const signal = takeGetInfoAbortSignal(probeKey)

  try {
    const [ytDlp, ffmpeg, ffprobe] = await Promise.all([
      getYtDlpInfo(
        await resolveExecutable('ytDlpSource', 'ytDlpPath', 'yt-dlp', options?.ytDlpSource, options?.ytDlpPath),
        signal
      ),
      getBinaryInfo(
        await resolveExecutable('ytDlpFfmpegSource', 'ytDlpFfmpegPath', 'ffmpeg', options?.ffmpegSource, options?.ffmpegPath),
        (executable) => getFfmpegVersion(executable, signal)
      ),
      getBinaryInfo(
        await resolveFfprobeExecutable(options?.ffmpegSource, options?.ffmpegPath),
        (executable) => getFfprobeVersion(executable, signal)
      )
    ])

    if (signal.aborted) {
      return null
    }

    return {
      ytDlp,
      ffmpeg,
      ffprobe
    }
  } finally {
    if (getInfoAbortControllers.get(probeKey)?.signal === signal) {
      getInfoAbortControllers.delete(probeKey)
    }
  }
}

/**
 * @param {import('electron').IpcMainInvokeEvent} event
 * @param {'yt-dlp' | 'ffmpeg'} binary
 * @returns {Promise<{ available: boolean } | { error: string } | null>}
 */
export async function handleYtDlpCheckBinaryUpdate(event, binary) {
  if (!isOpenTubeXUrl(event.senderFrame.url) || (binary !== 'yt-dlp' && binary !== 'ffmpeg')) {
    return null
  }

  try {
    return { available: await isManagedBinaryUpdateAvailable(binary) }
  } catch (error) {
    return { error: error.message }
  }
}

/**
 * @param {import('electron').IpcMainInvokeEvent} event
 * @param {'yt-dlp' | 'ffmpeg'} binary
 * @returns {Promise<{ version: string, updated: boolean } | { error: string } | null>}
 */
export async function handleYtDlpDownloadBinary(event, binary) {
  if (!isOpenTubeXUrl(event.senderFrame.url)) {
    return null
  }

  if (binary !== 'yt-dlp' && binary !== 'ffmpeg') {
    return null
  }

  const webContents = event.sender

  let lastSent = 0

  /**
   * @param {number | null} percent
   * @param {boolean} inProgress
   */
  function sendProgress(percent, inProgress) {
    if (!webContents.isDestroyed()) {
      webContents.send(IpcChannels.YT_DLP_BINARY_DOWNLOAD_PROGRESS, { binary, percent, inProgress })
    }
  }

  /** @type {BinaryDownloadProgressCallback} */
  function onProgress(percent) {
    const now = Date.now()
    if (now - lastSent < 250) {
      return
    }
    lastSent = now

    sendProgress(percent, true)
  }

  let result
  try {
    result = binary === 'yt-dlp'
      ? await downloadManagedYtDlp(onProgress, () => sendProgress(0, true))
      : await downloadManagedFfmpeg(onProgress, () => sendProgress(0, true))
    return result
  } finally {
    const updated = result != null && 'version' in result && result.updated
    sendProgress(updated ? 100 : null, false)
  }
}

/**
 * @typedef YtDlpPlaybackFormat
 * @property {string} formatId
 * @property {string | null} url
 * @property {string | null} manifestUrl
 * @property {string} protocol
 * @property {string} ext
 * @property {string | null} container
 * @property {string | null} vcodec
 * @property {string | null} acodec
 * @property {number | null} width
 * @property {number | null} height
 * @property {number | null} fps
 * @property {number | null} bitrate bits per second
 * @property {number | null} audioSampleRate
 * @property {number | null} audioChannels
 * @property {string | null} language
 * @property {string | null} formatNote
 * @property {string | null} dynamicRange
 * @property {number | null} availableAt Unix timestamp after which the format can be requested
 * @property {number | null} targetDuration segment duration in seconds
 * @property {number | null} fragmentCount
 */

/**
 * @typedef YtDlpPlaybackCaption
 * @property {string} url
 * @property {string} language
 * @property {string} label
 * @property {'text/vtt'} mimeType
 * @property {string} [id]
 * @property {string} [translationName]
 * @property {string} [originalLanguage]
 * @property {boolean} [isAutoGenerated]
 */

/**
 * @typedef YtDlpPlaybackInfo
 * @property {string | null} version the version of yt-dlp that extracted this
 * @property {string | null} title
 * @property {boolean} isLive
 * @property {'is_live' | 'post_live' | 'was_live' | 'not_live' | 'is_upcoming' | null} liveStatus
 * @property {number | null} duration
 * @property {string | null} hlsManifestUrl
 * @property {string | null} storyboardVtt
 * @property {YtDlpPlaybackCaption[]} captions
 * @property {YtDlpPlaybackCaption[]} captionTranslations
 * @property {YtDlpPlaybackFormat[]} formats
 */

/**
 * @typedef YtDlpRecommendation
 * @property {'video'} type
 * @property {string} videoId
 * @property {string} title
 * @property {string} author
 * @property {string | null} authorId
 * @property {number | null} viewCount
 * @property {number | ''} lengthSeconds
 * @property {boolean} liveNow
 * @property {boolean} isUpcoming
 * @property {number} [published]
 */

// Keep a bound on metadata returned by custom or older yt-dlp executables. The
// output template below excludes repeated media-fragment URLs, which can make a
// Post-Live-DVR info dump hundreds of megabytes for long broadcasts.
const PLAYBACK_INFO_MAX_BUFFER = 32 * 1024 * 1024
const PLAYBACK_INFO_TIMEOUT = 60_000
/**
 * Adds the cookie source selected specifically for restricted playback.
 * @param {string[]} args
 * @returns {Promise<string | null>} an error message, or null when configured
 */
async function pushYtDlpPlaybackAuthenticationArguments(args) {
  const authenticationMode = (await settings._findOne('ytDlpPlaybackAuthMode'))?.value
  const browserProfile = (await settings._findOne('ytDlpPlaybackCookiesBrowserProfile'))?.value
  const authenticationValue = authenticationMode === 'file'
    ? (await settings._findOne('ytDlpPlaybackCookiesPath'))?.value
    : authenticationMode === 'browser'
      ? (await settings._findOne('ytDlpPlaybackCookiesBrowser'))?.value
      : ''

  if (typeof authenticationValue !== 'string' || authenticationValue.trim() === '') {
    return 'yt-dlp playback authentication is not configured'
  }

  if (authenticationMode === 'file') {
    args.push('--cookies', authenticationValue)
  } else if (authenticationMode === 'browser' && /^[a-z0-9_-]+$/i.test(authenticationValue)) {
    const profile = typeof browserProfile === 'string' ? browserProfile.trim() : ''
    args.push('--cookies-from-browser', profile === '' ? authenticationValue : `${authenticationValue}:${profile}`)
  } else {
    return 'yt-dlp playback authentication is invalid'
  }

  return null
}

/** @type {Map<string, Promise<string>>} */
const subtitleRequests = new Map()

/**
 * Fetches subtitle text without exposing account cookies to the renderer.
 * @param {import('electron').IpcMainInvokeEvent} event
 * @param {string} url
 * @returns {Promise<string | { error: string } | null>}
 */
export async function handleYtDlpGetSubtitle(event, url) {
  if (!isOpenTubeXUrl(event.senderFrame.url) || !isYouTubeSubtitleUrl(url)) return null

  const alwaysUseCookies = (await settings._findOne('ytDlpPlaybackAlwaysUseCookies'))?.value === true
  const subtitleUseCookies = (await settings._findOne('ytDlpSubtitleUseCookies'))?.value === true
  if (!alwaysUseCookies && !subtitleUseCookies) return null

  const args = []
  if (await pushYtDlpPlaybackAuthenticationArguments(args) !== null) return null
  await pushProxyArgument(args)

  const { source, executable } = await resolveExecutable('ytDlpSource', 'ytDlpPath', 'yt-dlp')
  if (source === 'managed' && !existsSync(executable)) {
    const result = await downloadManagedYtDlp()
    if ('error' in result) return { error: result.error }
  }

  const key = JSON.stringify([executable, args, url])
  let request = subtitleRequests.get(key)
  if (!request) {
    request = downloadYtDlpSubtitle(executable, args, url, app.getPath('temp'))
    subtitleRequests.set(key, request)
  }
  try {
    return await request
  } catch {
    // yt-dlp errors can contain signed URLs or cookie details.
    return { error: 'Unable to load subtitle with configured cookies' }
  } finally {
    if (subtitleRequests.get(key) === request) subtitleRequests.delete(key)
  }
}

/**
 * Extracts the stream URLs for a video with yt-dlp, so that they can be played back
 * without relying on the SABR streaming protocol.
 * @param {import('electron').IpcMainInvokeEvent} event
 * @param {string} videoId
 * @param {boolean} useDefaultClients
 * @param {boolean} useAuthentication
 * @param {boolean} includeSubtitles
 * @returns {Promise<YtDlpPlaybackInfo | { error: string } | null>}
 */
export async function handleYtDlpGetPlaybackInfo(
  event,
  videoId,
  useDefaultClients = false,
  useAuthentication = false,
  includeSubtitles = true
) {
  if (!isOpenTubeXUrl(event.senderFrame.url)) {
    return null
  }

  if (typeof videoId !== 'string' || !ID_REGEX.test(videoId)) {
    return null
  }

  if (
    typeof useDefaultClients !== 'boolean' ||
    typeof useAuthentication !== 'boolean' ||
    typeof includeSubtitles !== 'boolean'
  ) {
    return null
  }

  const { source, executable } = await resolveExecutable('ytDlpSource', 'ytDlpPath', 'yt-dlp')

  if (source === 'managed' && !existsSync(executable)) {
    const result = await downloadManagedYtDlp()

    if ('error' in result) {
      return { error: result.error }
    }
  }

  const args = [
    '--no-playlist',
    '--no-warnings',
    '--no-progress',
    '--socket-timeout',
    '15',
    '--ignore-no-formats-error',
    '--format',
    'sb0/sb1/sb2/sb3',
    '--print',
    PLAYBACK_INFO_OUTPUT_TEMPLATE
  ]

  if (includeSubtitles) {
    args.push(
      '--write-auto-subs',
      '--sub-langs',
      'all',
      '--sub-format',
      'vtt'
    )
  }

  if (useDefaultClients !== true) {
    // Keep yt-dlp's account-aware defaults first. For authenticated playback,
    // upstream recommends appending web_safari to obtain its merged HLS formats:
    // https://github.com/yt-dlp/yt-dlp/issues/17143
    // Without authentication, retain web_embedded for alternate audio and exclude
    // Android VR URLs that can face selective PO-token enforcement. The renderer
    // retries with yt-dlp's defaults if these formats are not playable.
    args.push(
      '--extractor-args',
      useAuthentication
        ? 'youtube:player_client=default,web_safari'
        : 'youtube:player_client=default,web_embedded,-android_vr'
    )
  }

  if (useAuthentication) {
    const authenticationError = await pushYtDlpPlaybackAuthenticationArguments(args)
    if (authenticationError !== null) return { error: authenticationError }
  }

  await pushProxyArgument(args)

  args.push(`https://www.youtube.com/watch?v=${videoId}`)

  let stdout
  let version
  try {
    // Unlike --dump-single-json, yt-dlp's projected output does not expose its
    // own version in the template context. Resolve it alongside extraction so
    // a slow version probe does not add another timeout to playback.
    const [playbackInfo, resolvedVersion] = await Promise.all([
      execFileAsync(executable, args, {
        timeout: PLAYBACK_INFO_TIMEOUT,
        maxBuffer: PLAYBACK_INFO_MAX_BUFFER,
        windowsHide: true
      }),
      getYtDlpVersion(executable)
    ])
    stdout = playbackInfo.stdout
    version = resolvedVersion
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { error: 'ENOENT' }
    }

    if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      return { error: 'yt-dlp returned too much playback metadata' }
    }

    // yt-dlp writes the reason for a failed extraction to stderr
    const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : ''
    return { error: stderr.split('\n').at(-1) || error.message }
  }

  let info
  try {
    info = JSON.parse(stdout)
  } catch {
    return { error: 'yt-dlp returned invalid JSON' }
  }

  const formats = Array.isArray(info.formats) ? info.formats : []
  const { captions, captionTranslations } = mapPlaybackCaptions(info.requested_subtitles)

  return {
    version,
    title: toNonEmptyString(info.title),
    isLive: !!info.is_live,
    liveStatus: toNonEmptyString(info.live_status),
    duration: toFiniteNumber(info.duration),
    hlsManifestUrl: toNonEmptyString(info.manifest_url) ??
      formats.find(format => format.protocol === 'm3u8_native' && format.manifest_url)?.manifest_url ??
      null,
    storyboardVtt: buildYtDlpStoryboardVtt([info.storyboard], toFiniteNumber(info.duration)),
    captions,
    captionTranslations,
    formats: formats.filter(format => format.protocol !== 'mhtml').map(mapPlaybackFormat)
  }
}

/**
 * Loads the signed-in user's recommendation feed after they explicitly retry a
 * restricted video. The result stays renderer-local and is never cached.
 * @param {import('electron').IpcMainInvokeEvent} event
 * @param {string} currentVideoId
 * @returns {Promise<YtDlpRecommendation[] | { error: string } | null>}
 */
export async function handleYtDlpGetRecommendations(event, currentVideoId) {
  if (!isOpenTubeXUrl(event.senderFrame.url)) {
    return null
  }

  if (typeof currentVideoId !== 'string' || !ID_REGEX.test(currentVideoId)) {
    return null
  }

  const { source, executable } = await resolveExecutable('ytDlpSource', 'ytDlpPath', 'yt-dlp')

  if (source === 'managed' && !existsSync(executable)) {
    const result = await downloadManagedYtDlp()
    if ('error' in result) return { error: result.error }
  }

  const args = [
    '--dump-single-json',
    '--flat-playlist',
    '--playlist-end',
    '25',
    '--no-warnings',
    '--no-progress',
    '--socket-timeout',
    '15'
  ]

  const authenticationError = await pushYtDlpPlaybackAuthenticationArguments(args)
  if (authenticationError !== null) return { error: authenticationError }

  await pushProxyArgument(args)
  args.push(':ytrec')

  let stdout
  try {
    ({ stdout } = await execFileAsync(executable, args, {
      timeout: PLAYBACK_INFO_TIMEOUT,
      maxBuffer: PLAYBACK_INFO_MAX_BUFFER,
      windowsHide: true
    }))
  } catch (error) {
    if (error.code === 'ENOENT') return { error: 'ENOENT' }

    const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : ''
    return { error: stderr.split('\n').at(-1) || error.message }
  }

  let info
  try {
    info = JSON.parse(stdout)
  } catch {
    return { error: 'yt-dlp returned invalid recommendation JSON' }
  }

  if (!Array.isArray(info.entries)) return []

  return info.entries.flatMap((rawEntry) => {
    if (rawEntry === null || typeof rawEntry !== 'object') return []

    const videoId = toNonEmptyString(rawEntry.id)
    const title = toNonEmptyString(rawEntry.title)
    if (videoId === null || !ID_REGEX.test(videoId) || videoId === currentVideoId || title === null) return []

    const duration = toFiniteNumber(rawEntry.duration)
    const timestamp = toFiniteNumber(rawEntry.timestamp)
    const liveStatus = toNonEmptyString(rawEntry.live_status)

    return [{
      type: 'video',
      videoId,
      title,
      author: toNonEmptyString(rawEntry.channel) ?? toNonEmptyString(rawEntry.uploader) ?? '',
      authorId: toNonEmptyString(rawEntry.channel_id),
      viewCount: toFiniteNumber(rawEntry.view_count),
      lengthSeconds: duration ?? '',
      liveNow: rawEntry.is_live === true || liveStatus === 'is_live',
      isUpcoming: liveStatus === 'is_upcoming',
      ...(timestamp === null ? {} : { published: timestamp * 1000 })
    }]
  })
}

/**
 * Splits a command line argument string into an array of arguments,
 * treating single and double quoted sections as a single argument
 * @param {string} argsString
 * @returns {string[]}
 */
function splitArguments(argsString) {
  const args = []
  const tokenRegex = /"([^"]*)"|'([^']*)'|(\S+)/g

  let match
  while ((match = tokenRegex.exec(argsString)) !== null) {
    args.push(match[1] ?? match[2] ?? match[3])
  }

  return args
}

function automaticNumber(value, maximum) {
  return Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= maximum
    ? Number(value)
    : null
}

/**
 * Loads recent video IDs for a channel from a main-process-owned source. This
 * prevents a renderer from turning a persisted channel rule into permission to
 * download an arbitrary video that was not present in the subscription feed.
 * @param {string} channelId
 * @returns {Promise<Map<string, number> | null>}
 */
async function getAutomaticDiscoveryVideoIds(channelId) {
  const cached = automaticDiscoveryCache.get(channelId)
  if (cached?.expiresAt > Date.now()) {
    return cached.videos
  }

  let feed
  if (process.env.OPENTUBEX_E2E_USER_DATA_DIR) {
    try {
      feed = await readFile(join(app.getPath('userData'), AUTOMATIC_DISCOVERY_E2E_FIXTURE), 'utf8')
    } catch {
      return null
    }
  } else {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), AUTOMATIC_DISCOVERY_TIMEOUT_MS)
    try {
      const response = await net.fetch(
        `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,
        { signal: controller.signal }
      )
      if (!response.ok) {
        return null
      }
      feed = await response.text()
    } catch {
      return null
    } finally {
      clearTimeout(timeout)
    }
  }

  const videos = new Map()
  for (const entry of feed.matchAll(/<entry\b[\s\S]*?<\/entry>/g)) {
    const entryChannelId = entry[0].match(/<yt:channelId>([^<]+)<\/yt:channelId>/)?.[1]
    const videoId = entry[0].match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1]
    const published = Date.parse(entry[0].match(/<published>([^<]+)<\/published>/)?.[1])
    if (entryChannelId === channelId && ID_REGEX.test(videoId) && Number.isFinite(published)) {
      videos.set(videoId, published)
    }
  }

  automaticDiscoveryCache.set(channelId, {
    expiresAt: Date.now() + AUTOMATIC_DISCOVERY_CACHE_TTL_MS,
    videos
  })
  return videos
}

/**
 * Verifies a candidate directly when YouTube's RSS feed has not indexed it
 * yet. Keep this check in the main process so a renderer cannot authorize an
 * arbitrary video by supplying its own channel or publication metadata.
 * @param {string} videoId
 * @param {string} channelId
 * @returns {Promise<number | null>} publication time in milliseconds
 */
async function getAutomaticVideoPublishedAt(videoId, channelId) {
  const { source, executable } = await resolveExecutable('ytDlpSource', 'ytDlpPath', 'yt-dlp')

  if (source === 'managed' && !existsSync(executable)) {
    const result = await downloadManagedYtDlp()
    if ('error' in result) return null
  }

  const args = [
    '--flat-playlist',
    '--dump-single-json',
    '--no-playlist',
    '--no-warnings',
    '--no-progress',
    '--socket-timeout',
    '15'
  ]
  await pushProxyArgument(args)
  args.push(`https://www.youtube.com/watch?v=${videoId}`)

  let info
  try {
    const { stdout } = await execFileAsync(executable, args, {
      timeout: AUTOMATIC_METADATA_TIMEOUT_MS,
      maxBuffer: AUTOMATIC_METADATA_MAX_BUFFER,
      windowsHide: true
    })
    info = JSON.parse(stdout)
  } catch {
    return null
  }

  if (info === null || typeof info !== 'object' || Array.isArray(info)) {
    return null
  }

  const publishedAt = toFiniteNumber(info.timestamp)
  return info.id === videoId && info.channel_id === channelId && publishedAt !== null
    ? publishedAt * 1000
    : null
}

function automaticTitleTerms(value) {
  return typeof value === 'string'
    ? value.split(',')
        .map(term => term.trim().slice(0, AUTOMATIC_TITLE_TERM_LENGTH_LIMIT))
        .filter(Boolean)
        .slice(0, AUTOMATIC_TITLE_TERM_LIMIT)
    : []
}

async function getAutomaticTemplateOptions(template) {
  const builtInOptions = BUILT_IN_AUTOMATIC_TEMPLATE_OPTIONS.get(template)
  if (builtInOptions) {
    return builtInOptions
  }
  if (!template.startsWith('template:')) {
    return null
  }

  let templates
  try {
    templates = JSON.parse((await settings._findOne('ytDlpDownloadTemplates'))?.value || '[]')
  } catch {
    return null
  }
  if (!Array.isArray(templates)) {
    return null
  }

  const customTemplate = templates.find(candidate => (
    candidate?.name === template.slice('template:'.length)
  ))
  if (customTemplate?.options !== null && typeof customTemplate?.options === 'object' &&
    !Array.isArray(customTemplate.options)) {
    return { mode: 'video', ...customTemplate.options }
  }
  if (typeof customTemplate?.args === 'string') {
    return { mode: 'video', customArgs: customTemplate.args }
  }
  return null
}

/**
 * Rebuilds automatic-only options from settings owned by the main process.
 * A renderer-provided `automatic` flag alone must never waive the activation
 * boundary or select arbitrary yt-dlp arguments.
 * @param {YtDlpDownloadPayload} payload
 * @param {boolean} [discoveryPreviouslyAuthorized]
 * @returns {Promise<YtDlpDownloadPayload | null>}
 */
async function authorizeAutomaticDownload(payload, discoveryPreviouslyAuthorized = false) {
  if (typeof payload.channelId !== 'string' || !CHANNEL_ID_REGEX.test(payload.channelId) ||
    typeof payload.videoId !== 'string' || !ID_REGEX.test(payload.videoId)) {
    return null
  }

  let rules
  try {
    rules = JSON.parse((await settings._findOne('ytDlpAutomaticDownloadRules'))?.value || '{}')
  } catch {
    return null
  }
  if (rules === null || typeof rules !== 'object' || Array.isArray(rules) ||
    !Object.hasOwn(rules, payload.channelId)) {
    return null
  }

  const rule = rules[payload.channelId]
  if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) {
    return null
  }
  const template = typeof rule.template === 'string' && rule.template !== '' ? rule.template : 'video:best'
  if (payload.template !== template) {
    return null
  }

  const mediaTypeAllowed = payload.automaticMediaType === 'short'
    ? rule.includeShorts === true
    : payload.automaticMediaType === 'livestream'
      ? rule.includeLivestreams === true
      : payload.automaticMediaType === 'video' && rule.includeVideos !== false
  if (!mediaTypeAllowed) {
    return null
  }

  const templateOptions = await getAutomaticTemplateOptions(template)
  if (templateOptions === null) {
    return null
  }

  if (!discoveryPreviouslyAuthorized) {
    let discoveredVideos = await getAutomaticDiscoveryVideoIds(payload.channelId)
    const enabledAt = automaticNumber(rule.enabledAt, Number.MAX_SAFE_INTEGER)
    let publishedAt = discoveredVideos?.get(payload.videoId) ?? null
    if (enabledAt !== null && publishedAt === null) {
      publishedAt = await getAutomaticVideoPublishedAt(payload.videoId, payload.channelId)
      if (publishedAt !== null) {
        if (discoveredVideos === null) {
          discoveredVideos = new Map()
          automaticDiscoveryCache.set(payload.channelId, {
            expiresAt: Date.now() + AUTOMATIC_DISCOVERY_CACHE_TTL_MS,
            videos: discoveredVideos
          })
        }
        discoveredVideos.set(payload.videoId, publishedAt)
      }
    }
    if (enabledAt === null || publishedAt === null ||
      Math.floor(publishedAt / 1000) < Math.floor(enabledAt / 1000)) {
      return null
    }
  }

  const sanitizedPayload = {
    videoId: payload.videoId,
    channelId: payload.channelId,
    title: payload.title,
    thumbnail: payload.thumbnail,
    notification: payload.notification
  }
  for (const [key, maximum] of Object.entries(AUTOMATIC_NUMBER_LIMITS)) {
    sanitizedPayload[key] = automaticNumber(rule[key], maximum)
  }
  sanitizedPayload.titleIncludes = automaticTitleTerms(rule.titleIncludes)
  sanitizedPayload.titleExcludes = automaticTitleTerms(rule.titleExcludes)

  return {
    ...sanitizedPayload,
    ...structuredClone(templateOptions),
    template,
    automatic: true
  }
}

/**
 * @param {import('electron').IpcMainInvokeEvent} event
 * @param {YtDlpDownloadPayload} incomingPayload
 * @param {boolean} automaticDownloadAuthorized
 * @param {boolean} [automaticDiscoveryPreviouslyAuthorized]
 * @param {(result: { id: number }) => void} [onQueued]
 * @param {boolean} [previouslyAccepted]
 * @returns {Promise<{ id: number } | { error: string } | { skipped: string } | null>}
 */
async function startYtDlpDownload(
  event,
  incomingPayload,
  automaticDownloadAuthorized,
  automaticDiscoveryPreviouslyAuthorized = false,
  onQueued,
  previouslyAccepted = false
) {
  if ((!previouslyAccepted && !isOpenTubeXUrl(event?.senderFrame.url)) ||
    typeof incomingPayload !== 'object' || incomingPayload === null) {
    return null
  }

  const payload = previouslyAccepted
    ? incomingPayload
    : incomingPayload.automatic === true && automaticDownloadAuthorized
      ? await authorizeAutomaticDownload(incomingPayload, automaticDiscoveryPreviouslyAuthorized)
      : incomingPayload.automatic === true ? null : incomingPayload
  if (payload === null || (!previouslyAccepted && payload.automatic !== true && !event.sender.isFocused())) {
    return null
  }

  if ((await settings._findOne('enableDownloads'))?.value === false) {
    return { error: 'downloads-disabled' }
  }

  if (!['video', 'audio', 'subtitles', 'custom'].includes(payload.mode)) {
    return null
  }

  const subtitlesOnly = payload.mode === 'subtitles'
  const subtitleFormat = typeof payload.subtitleFormat === 'string' && SUBTITLE_FORMATS.includes(payload.subtitleFormat)
    ? payload.subtitleFormat
    : ''

  const globalCustomArgsSetting = (await settings._findOne('ytDlpDownloadCustomArgs'))?.value
  const globalCustomArgs = typeof globalCustomArgsSetting === 'string' && globalCustomArgsSetting.trim() !== ''
    ? splitArguments(globalCustomArgsSetting)
    : []
  const customArgs = typeof payload.customArgs === 'string' && payload.customArgs.trim() !== ''
    ? splitArguments(payload.customArgs)
    : []
  if ([...globalCustomArgs, ...customArgs].some(argument => DENIED_CUSTOM_ARGS.includes(argument.split('=')[0]))) {
    return { error: 'unsupported-custom-argument' }
  }

  if (payload.videoIds !== undefined && (!Array.isArray(payload.videoIds) ||
    payload.videoIds.some(videoId => typeof videoId !== 'string' || !ID_REGEX.test(videoId)))) {
    return { error: 'invalid-video-ids' }
  }

  const videoIds = Array.isArray(payload.videoIds)
    ? payload.videoIds
    : []
  if (videoIds.length > MAX_LOCAL_PLAYLIST_VIDEOS) {
    return { error: 'too-many-videos' }
  }
  const isRemotePlaylist = payload.isPlaylist === true && typeof payload.playlistId === 'string' &&
    PLAYLIST_ID_REGEX.test(payload.playlistId)
  const isSingleVideo = typeof payload.videoId === 'string' && ID_REGEX.test(payload.videoId)

  if (!isRemotePlaylist && !isSingleVideo && videoIds.length === 0) {
    return null
  }

  await loadDownloadRecords()

  if (payload.automatic === true && isSingleVideo && hasAutomaticDownloadRecord(payload.videoId)) {
    return { skipped: 'already-downloaded' }
  }

  const args = [
    '--newline',
    '--progress',
    '--print',
    `after_move:${FINAL_PATH_PREFIX}%(id)s\t%(duration)s\t%(width)s\t%(height)s\t%(filepath)s`,
    '--print',
    `${subtitlesOnly ? 'video' : 'after_move'}:${FINAL_METADATA_PREFIX}%(id)j\t%(title)j\t%(thumbnail)j`
  ]

  if (!isRemotePlaylist) {
    args.push('--no-playlist')
  }

  await pushProxyArgument(args)
  args.push(...globalCustomArgs)

  const ffmpeg = await resolveExecutable('ytDlpFfmpegSource', 'ytDlpFfmpegPath', 'ffmpeg')

  if (ffmpeg.source === 'managed') {
    const ffprobe = await resolveFfprobeExecutable()
    if (!existsSync(ffmpeg.executable) || !existsSync(ffprobe.executable)) {
      const result = await downloadManagedFfmpeg()

      if ('error' in result) {
        return { error: result.error }
      }
    }

    args.push('--ffmpeg-location', ffmpeg.executable)
  } else if (ffmpeg.executable !== 'ffmpeg') {
    args.push('--ffmpeg-location', ffmpeg.executable)
  }

  /** @type {string} */
  const downloadFolder = (await settings._findOne('ytDlpDownloadFolderPath'))?.value || app.getPath('downloads')
  const { args: downloadArgs, truncatesLongTitles } = buildYtDlpDownloadArguments(payload)
  args.push('--paths', downloadFolder, ...downloadArgs)

  const { source, executable } = await resolveExecutable('ytDlpSource', 'ytDlpPath', 'yt-dlp')

  if (source === 'managed' && !existsSync(executable)) {
    const result = await downloadManagedYtDlp()

    if ('error' in result) {
      return { error: result.error }
    }
  }

  // Authorization and executable setup contain awaits, so another refresh can
  // start the same video after the initial fast-path check above.
  if (payload.automatic === true && isSingleVideo && hasAutomaticDownloadRecord(payload.videoId)) {
    return { skipped: 'already-downloaded' }
  }

  const id = ++downloadCounter
  /** @type {YtDlpDownloadStatus} */
  const status = {
    id,
    videoId: isSingleVideo ? payload.videoId : '',
    playlistId: typeof payload.playlistId === 'string' ? payload.playlistId.slice(0, 128) : '',
    playlistKey: typeof payload.playlistKey === 'string' ? payload.playlistKey.slice(0, 255) : '',
    title: typeof payload.title === 'string'
      ? payload.title.slice(0, 255)
      : (isSingleVideo ? payload.videoId : isRemotePlaylist ? payload.playlistId : ''),
    thumbnail: typeof payload.thumbnail === 'string' ? payload.thumbnail.slice(0, 2048) : '',
    mode: payload.mode,
    template: typeof payload.template === 'string' ? payload.template.slice(0, 255) : '',
    automatic: payload.automatic === true,
    retryPayload: structuredClone(payload),
    status: downloadQueuePaused ? 'paused' : 'queued',
    started: false,
    queuePosition: ++downloadQueuePositionCounter,
    percent: 0,
    speed: null,
    eta: null,
    destination: null,
    destinations: [],
    files: [],
    titleTruncated: false,
    estimatedSizeBytes: Number.isSafeInteger(payload.estimatedSizeBytes) && payload.estimatedSizeBytes > 0
      ? payload.estimatedSizeBytes
      : undefined,
    availableSpaceBytes: undefined,
    spaceWarning: null,
    errorMessage: null
  }
  downloadRecords.set(id, status)

  let lastSent = 0
  let finished = false

  /**
   * @param {boolean} [force]
   */
  function sendStatus(force = false) {
    const now = Date.now()
    if (!force && now - lastSent < 500) {
      return
    }
    lastSent = now

    broadcastDownloadStatus(status)
  }

  sendStatus(true)
  await saveDownloadRecords()
  onQueued?.({ id })

  if (!await waitForDownloadSlot(id)) {
    return { id }
  }

  // Keep post-processing inputs away from completed files with the same title
  // and video ID. Put the isolated directory beside the completed files so a
  // sandbox's capacity-limited runtime directory does not hold the media data.
  // Audio extraction otherwise reuses and then deletes an existing video file
  // when both variants have the same source extension.
  let temporaryDownloadFolder
  try {
    temporaryDownloadFolder = await mkdtemp(join(downloadFolder, '.opentubex-download-'))
  } catch {
    try {
      temporaryDownloadFolder = await mkdtemp(join(app.getPath('temp'), 'opentubex-download-'))
    } catch (error) {
      individuallyResumedDownloadIds.delete(id)
      status.status = 'failed'
      status.errorMessage = error.code === 'ENOENT' ? 'ENOENT' : error.message
      sendStatus(true)
      releaseDownloadSlot()
      await saveDownloadRecords()
      return { id }
    }
  }
  args.push('--paths', `temp:${temporaryDownloadFolder}`)

  try {
    const fileSystem = await statfs(downloadFolder)
    status.availableSpaceBytes = fileSystem.bavail * fileSystem.bsize
    if (status.estimatedSizeBytes === undefined) {
      status.spaceWarning = 'unknown-estimate'
    } else if (status.availableSpaceBytes < status.estimatedSizeBytes) {
      individuallyResumedDownloadIds.delete(id)
      status.status = 'failed'
      status.errorMessage = 'INSUFFICIENT_SPACE'
      sendStatus(true)
      releaseDownloadSlot()
      await rm(temporaryDownloadFolder, { recursive: true, force: true })
      await saveDownloadRecords()
      return { id }
    }
  } catch {
    status.spaceWarning = 'space-check-unavailable'
  }

  async function abortQueuedPreparation(error) {
    individuallyResumedDownloadIds.delete(id)
    if (error) {
      console.error('Could not prepare queued download', error)
      status.status = 'failed'
      status.errorMessage = 'download-queue-failed'
      sendStatus(true)
    }
    releaseDownloadSlot()
    await rm(temporaryDownloadFolder, { recursive: true, force: true })
    await saveDownloadRecords()
    return { id }
  }

  function queuedPreparationWasInterrupted() {
    if (status.status !== 'queued') return true
    if (!downloadQueuePaused || individuallyResumedDownloadIds.has(id)) return false
    status.status = 'paused'
    sendStatus(true)
    return true
  }

  if (queuedPreparationWasInterrupted()) return abortQueuedPreparation()

  try {
    const bandwidthLimit = normalizeDownloadBandwidth(
      (await settings._findOne('ytDlpDownloadBandwidthLimit'))?.value
    )
    if (bandwidthLimit > 0) {
      const bandwidthShare = Math.max(1, Math.floor(
        bandwidthLimit / (await getDownloadQueueSettings()).concurrency
      ))
      args.push('--limit-rate', `${bandwidthShare}K`)
    }
  } catch (error) {
    return abortQueuedPreparation(error)
  }
  if (queuedPreparationWasInterrupted()) return abortQueuedPreparation()

  individuallyResumedDownloadIds.delete(id)
  status.status = 'downloading'
  status.started = true
  const child = spawn(executable, args, { windowsHide: true })
  const entry = { child, cancelled: false, paused: false, restarting: false, restartStatus: 'queued' }
  activeDownloads.set(id, entry)
  showAutomaticDownloadNotification(payload, 'started')
  sendStatus(true)

  /** @type {string[]} */
  const stderrLines = []
  /** @type {Set<string>} */
  const subtitleDestinations = new Set()

  /**
   * @param {string} line
   */
  function handleStdoutLine(line) {
    if (line.startsWith(FINAL_METADATA_PREFIX)) {
      const [rawVideoId, rawTitle, rawThumbnail] = line.slice(FINAL_METADATA_PREFIX.length).split('\t')
      try {
        const videoId = JSON.parse(rawVideoId)
        const title = JSON.parse(rawTitle)
        const thumbnail = JSON.parse(rawThumbnail)
        if (typeof title === 'string' && title !== '') {
          status.titleTruncated ||= truncatesLongTitles &&
            Buffer.byteLength(title, 'utf8') > DOWNLOAD_TITLE_FILENAME_BYTE_LIMIT
        }
        if (videoId === status.videoId) {
          if (typeof title === 'string' && title !== '') {
            status.title = title.slice(0, 255)
          }
          if (typeof thumbnail === 'string') status.thumbnail = thumbnail.slice(0, 2048)
          else if (thumbnail === null) status.thumbnail = ''
        }
        sendStatus(true)
      } catch {
        // A malformed metadata line must not interfere with the download itself.
      }
      return
    }

    if (line.startsWith(FINAL_PATH_PREFIX)) {
      const parts = line.slice(FINAL_PATH_PREFIX.length).split('\t')
      const hasMediaMetadata = parts.length >= 5
      const [videoId, rawDuration, rawWidth, rawHeight] = parts
      const pathParts = parts.slice(hasMediaMetadata ? 4 : parts.length > 1 ? 1 : 0)
      status.destination = pathParts.join('\t')
      if (status.destination !== '' && !status.destinations.includes(status.destination)) {
        status.destinations.push(status.destination)
      }
      if (ID_REGEX.test(videoId) && status.destination !== '' &&
        !status.files.some(file => file.videoId === videoId && file.path === status.destination)) {
        const duration = hasMediaMetadata ? Number(rawDuration) : NaN
        const width = hasMediaMetadata ? Number(rawWidth) : NaN
        const height = hasMediaMetadata ? Number(rawHeight) : NaN
        status.files.push({
          videoId,
          path: status.destination,
          ...(Number.isFinite(duration) && duration > 0 ? { duration } : {}),
          ...(Number.isInteger(width) && width > 0 ? { width } : {}),
          ...(Number.isInteger(height) && height > 0 ? { height } : {})
        })
      }
      sendStatus(true)
      return
    }

    const subtitleMatch = SUBTITLE_DESTINATION_REGEX.exec(line)
    if (subtitleMatch) {
      const subtitlePath = subtitleMatch[1]
      subtitleDestinations.add(subtitlePath)
      status.destination = subtitlePath
      if (!status.destinations.includes(subtitlePath)) status.destinations.push(subtitlePath)
      sendStatus(true)
      return
    }
    const progressMatch = PROGRESS_REGEX.exec(line)
    if (progressMatch) {
      status.status = 'downloading'
      status.percent = parseFloat(progressMatch[1])
      status.speed = progressMatch[2] ?? status.speed
      status.eta = progressMatch[3] ?? status.eta
      sendStatus()
      return
    }

    // subtitle files are announced twice, and only the line handled above
    // accounts for the extension a conversion gives them
    const destinationMatch = subtitlesOnly ? null : DESTINATION_REGEX.exec(line)
    if (destinationMatch) {
      status.destination = destinationMatch[1]

      if (line.startsWith('[ExtractAudio]')) {
        status.status = 'processing'
      }

      sendStatus(true)
      return
    }

    const mergerMatch = MERGER_REGEX.exec(line)
    if (mergerMatch) {
      status.status = 'processing'
      status.destination = mergerMatch[1]
      sendStatus(true)
    }
  }

  let stdoutBuffer = ''
  function removeTemporaryDownloadFolder() {
    rm(temporaryDownloadFolder, { recursive: true, force: true })
      .catch(error => console.warn('Could not remove temporary download folder', error))
  }
  child.stdout.setEncoding('utf-8')
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk
    const lines = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = lines.pop()
    lines.forEach(handleStdoutLine)
  })

  child.stderr.setEncoding('utf-8')
  child.stderr.on('data', (chunk) => {
    stderrLines.push(...chunk.split(/\r?\n/).filter((line) => line.length > 0))

    // only keep the last few lines for error reporting
    if (stderrLines.length > 5) {
      stderrLines.splice(0, stderrLines.length - 5)
    }
  })

  child.on('error', (error) => {
    if (finished) {
      return
    }
    finished = true

    activeDownloads.delete(id)
    releaseDownloadSlot()
    removeTemporaryDownloadFolder()
    status.status = entry.restarting ? entry.restartStatus : 'failed'
    status.errorMessage = entry.restarting ? null : error.code === 'ENOENT' ? 'ENOENT' : error.message
    if (!entry.restarting) showAutomaticDownloadNotification(payload, 'failed')
    sendStatus(true)
    saveDownloadRecords().catch(error => console.warn('Could not save download history', error))
  })

  child.on('close', (code) => {
    if (finished) {
      return
    }
    finished = true

    activeDownloads.delete(id)
    releaseDownloadSlot()
    removeTemporaryDownloadFolder()

    if (entry.restarting) {
      status.status = entry.restartStatus
      status.speed = null
      status.eta = null
    } else if (entry.cancelled) {
      status.status = 'cancelled'
    } else if (code === 0) {
      if (subtitleFormat !== '') {
        const convertedSubtitleDestinations = new Map([...subtitleDestinations].map((subtitlePath) => [
          subtitlePath,
          subtitlePath.replace(/\.[^.]+$/, `.${subtitleFormat}`)
        ]))
        status.destinations = status.destinations.map((destination) => (
          convertedSubtitleDestinations.get(destination) ?? destination
        ))
        status.destination = convertedSubtitleDestinations.get(status.destination) ?? status.destination
      }
      status.status = payload.automatic === true && status.destinations.length === 0
        ? 'skipped'
        : 'completed'
      if (status.status === 'completed') status.percent = 100
    } else {
      status.status = 'failed'
      status.errorMessage = stderrLines.join('\n')
    }

    if (status.status === 'completed') {
      showAutomaticDownloadNotification(payload, 'completed', id)
    } else if (status.status === 'failed') {
      showAutomaticDownloadNotification(payload, 'failed')
    }

    sendStatus(true)
    saveDownloadRecords().catch(error => console.warn('Could not save download history', error))
  })

  return { id }
}

function queueYtDlpDownload(
  event,
  payload,
  automaticDownloadAuthorized,
  automaticDiscoveryPreviouslyAuthorized = false,
  previouslyAccepted = false,
  onQueued
) {
  return new Promise(resolve => {
    let resolved = false
    const resolveOnce = result => {
      if (resolved) return
      resolved = true
      resolve(result)
    }
    const resolveQueued = result => {
      onQueued?.(result)
      resolveOnce(result)
    }
    startYtDlpDownload(
      event,
      payload,
      automaticDownloadAuthorized,
      automaticDiscoveryPreviouslyAuthorized,
      resolveQueued,
      previouslyAccepted
    ).then(resolveOnce).catch(error => {
      console.error('Could not queue download', error)
      resolveOnce({ error: 'download-queue-failed' })
    })
  })
}

async function restartPersistedDownload(event, record, resumeIndividually = false) {
  if (!record?.retryPayload) return { error: 'download-not-resumable' }
  downloadRecords.delete(record.id)
  const result = await queueYtDlpDownload(
    event,
    record.retryPayload,
    true,
    record.automatic === true,
    true,
    queuedResult => {
      if (!resumeIndividually || !queuedResult || !('id' in queuedResult)) return
      const restartedRecord = downloadRecords.get(queuedResult.id)
      if (resumePendingDownload(restartedRecord, individuallyResumedDownloadIds, downloadQueuePaused)) {
        broadcastDownloadStatus(restartedRecord)
      }
    }
  )
  if (result && 'id' in result) {
    broadcastToRenderers(IpcChannels.YT_DLP_DOWNLOADS_REMOVED, [record.id])
    await saveDownloadRecords()
    return result
  }
  if (result?.error === 'downloads-disabled') {
    downloadRecords.set(record.id, record)
    broadcastDownloadStatus(record)
    await saveDownloadRecords()
    return result
  }
  record.status = 'failed'
  record.errorMessage = result && 'error' in result ? result.error : 'download-queue-failed'
  downloadRecords.set(record.id, record)
  broadcastDownloadStatus(record)
  await saveDownloadRecords()
  return result
}

async function restorePersistedDownloadQueue(event) {
  persistedDownloadQueueRestorePromise ??= (async () => {
    await loadDownloadRecords()
    const persisted = [...downloadRecords.values()]
      .filter(record => record.status === 'queued' &&
        !queuedDownloadWaiters.has(record.id) && !activeDownloads.has(record.id))
      .sort(compareQueuedDownloads)
    for (const record of persisted) await restartPersistedDownload(event, record)
  })().catch(error => {
    persistedDownloadQueueRestorePromise = null
    throw error
  })
  return persistedDownloadQueueRestorePromise
}

export function restoreYtDlpDownloadQueue() {
  return restorePersistedDownloadQueue(null)
}

export function refreshYtDlpDownloadQueue() {
  return requestDownloadQueueDrain()
}

/**
 * @param {import('electron').IpcMainInvokeEvent} event
 * @param {YtDlpDownloadPayload} payload
 * @param {number} [retryDownloadId]
 * @param {boolean} [automaticDownloadAuthorized]
 * @returns {Promise<{ id: number } | { error: string } | { skipped: string } | null>}
 */
export async function handleYtDlpDownload(event, payload, retryDownloadId, automaticDownloadAuthorized = false) {
  if (retryDownloadId === undefined) {
    return queueYtDlpDownload(event, payload, automaticDownloadAuthorized)
  }

  if (!isOpenTubeXUrl(event.senderFrame.url) || !event.sender.isFocused() ||
    !Number.isInteger(retryDownloadId)) {
    return null
  }
  if (retryingDownloadIds.has(retryDownloadId)) {
    return { error: 'download-already-retrying' }
  }

  retryingDownloadIds.add(retryDownloadId)
  try {
    await loadDownloadRecords()
    const retryRecord = downloadRecords.get(retryDownloadId)
    if (!['failed', 'cancelled'].includes(retryRecord?.status)) {
      return { error: 'download-not-retryable' }
    }

    const retryPayload = retryRecord.automatic === true ? retryRecord.retryPayload : payload
    const result = await queueYtDlpDownload(event, retryPayload, true, retryRecord.automatic === true)
    if (result && 'id' in result) {
      downloadRecords.delete(retryDownloadId)
      broadcastToRenderers(IpcChannels.YT_DLP_DOWNLOADS_REMOVED, [retryDownloadId])
      await saveDownloadRecords()
        .catch(error => console.warn('Could not save download history', error))
    }
    return result
  } finally {
    retryingDownloadIds.delete(retryDownloadId)
  }
}

/**
 * @param {import('electron').IpcMainEvent} event
 * @param {number} id
 */
export function handleYtDlpCancelDownload(event, id) {
  if (!isOpenTubeXUrl(event.senderFrame.url)) {
    return
  }

  const entry = activeDownloads.get(id)
  if (entry) {
    entry.cancelled = true
    if (entry.paused) entry.child.kill('SIGCONT')
    entry.child.kill()
    return
  }

  const record = downloadRecords.get(id)
  if (record && ['queued', 'paused'].includes(record.status)) {
    cancelQueuedDownload(id)
    record.status = 'cancelled'
    record.speed = null
    record.eta = null
    broadcastDownloadStatus(record)
    saveDownloadRecords().catch(error => console.warn('Could not save download history', error))
    requestDownloadQueueDrain().catch(error => console.warn('Could not schedule downloads', error))
  }
}

function clearQueuePauseAfterLastIndividualResume() {
  if (!downloadQueuePauseAllRequested || [...downloadRecords.values()]
    .some(download => ['paused', 'pausing'].includes(download.status))) return

  downloadQueuePaused = false
  downloadQueuePauseAllRequested = false
  individuallyResumedDownloadIds.clear()
}

/**
 * @param {import('electron').IpcMainInvokeEvent} event
 * @param {number} id
 * @param {'pause' | 'resume' | 'move'} action
 * @param {number} [value]
 */
export async function handleYtDlpControlDownload(event, id, action, value) {
  if (!isOpenTubeXUrl(event.senderFrame.url) || !event.sender.isFocused() || !Number.isInteger(id)) return false
  await loadDownloadRecords()
  const record = downloadRecords.get(id)
  if (!record) return false

  const entry = activeDownloads.get(id)
  if (action === 'pause') {
    if (record.status === 'queued') {
      individuallyResumedDownloadIds.delete(id)
      record.status = 'paused'
    } else if (entry && ['downloading', 'processing'].includes(record.status)) {
      if (process.platform !== 'win32' && entry.child.kill('SIGSTOP')) {
        entry.paused = true
        record.status = 'paused'
      } else {
        downloadQueuePaused = true
        record.status = 'pausing'
        setPendingDownloadStatus('paused')
      }
    } else {
      return false
    }
  } else if (action === 'resume') {
    if (entry?.paused && record.status === 'paused') {
      entry.child.kill('SIGCONT')
      entry.paused = false
      record.status = 'downloading'
    } else if (record.status === 'paused') {
      if (!queuedDownloadWaiters.has(id)) {
        const result = await restartPersistedDownload(event, record, true)
        const resumed = Boolean(result && 'id' in result)
        if (resumed) clearQueuePauseAfterLastIndividualResume()
        return resumed
      }
      resumePendingDownload(record, individuallyResumedDownloadIds, downloadQueuePaused)
    } else if (record.status === 'pausing') {
      record.status = 'downloading'
      const anotherDownloadIsPausing = [...downloadRecords.values()]
        .some(download => download.id !== id && download.status === 'pausing')
      if (!downloadQueuePauseAllRequested && !anotherDownloadIsPausing) {
        downloadQueuePaused = false
        individuallyResumedDownloadIds.clear()
        setPendingDownloadStatus('queued')
      }
    } else {
      return false
    }
    clearQueuePauseAfterLastIndividualResume()
  } else if (action === 'move' && ['queued', 'paused'].includes(record.status) && !entry && (value === -1 || value === 1)) {
    const peers = [...downloadRecords.values()]
      .filter(download => ['queued', 'paused'].includes(download.status) && !activeDownloads.has(download.id))
      .sort(compareQueuedDownloads)
    const index = peers.findIndex(download => download.id === id)
    const other = peers[index + value]
    if (!other) return false
    const position = record.queuePosition
    record.queuePosition = other.queuePosition
    other.queuePosition = position
    broadcastDownloadStatus(other)
  } else {
    return false
  }

  broadcastDownloadStatus(record)
  await saveDownloadRecords()
  await requestDownloadQueueDrain()
  return true
}

/**
 * @param {import('electron').IpcMainInvokeEvent} event
 * @param {'pause-all' | 'resume-all' | 'retry-all' | 'refresh'} action
 */
export async function handleYtDlpQueueAction(event, action) {
  if (!isOpenTubeXUrl(event.senderFrame.url) || !event.sender.isFocused()) return false
  await loadDownloadRecords()
  if (action === 'refresh') {
    await requestDownloadQueueDrain()
    return true
  }
  if (action === 'pause-all') {
    downloadQueuePaused = true
    downloadQueuePauseAllRequested = true
    individuallyResumedDownloadIds.clear()
    setPendingDownloadStatus('paused')
    for (const [id, entry] of activeDownloads) {
      const record = downloadRecords.get(id)
      if (!record || entry.paused) continue
      if (process.platform !== 'win32' && entry.child.kill('SIGSTOP')) {
        entry.paused = true
        record.status = 'paused'
      } else {
        record.status = 'pausing'
      }
      broadcastDownloadStatus(record)
    }
  } else if (action === 'resume-all') {
    downloadQueuePaused = false
    downloadQueuePauseAllRequested = false
    individuallyResumedDownloadIds.clear()
    setPendingDownloadStatus('queued')
    const persistedPaused = []
    for (const record of downloadRecords.values()) {
      const entry = activeDownloads.get(record.id)
      if (entry?.paused) {
        entry.child.kill('SIGCONT')
        entry.paused = false
        record.status = 'downloading'
        broadcastDownloadStatus(record)
      } else if (entry && record.status === 'pausing') {
        record.status = 'downloading'
        broadcastDownloadStatus(record)
      } else if (record.status === 'paused') {
        persistedPaused.push(record)
      }
    }
    for (const record of persistedPaused) await restartPersistedDownload(event, record)
  } else if (action === 'retry-all') {
    const failed = [...downloadRecords.values()].filter(record => record.status === 'failed')
    for (const record of failed) {
      await handleYtDlpDownload(event, record.retryPayload ?? {
        videoId: record.videoId,
        playlistId: record.playlistId,
        isPlaylist: Boolean(record.playlistId),
        title: record.title,
        thumbnail: record.thumbnail,
        mode: record.mode,
        template: record.template,
      }, record.id, true)
    }
  } else {
    return false
  }

  await saveDownloadRecords()
  await requestDownloadQueueDrain()
  return true
}

/**
 * Moves a file to the operating system trash.
 * Electron does not use the Trash portal for document portal paths, so let
 * GIO handle the operation when running inside Flatpak.
 * @param {string} destination
 */
async function moveToTrash(destination) {
  if (shouldUseGioTrash()) {
    await execFileAsync('gio', ['trash', destination])
  } else {
    await shell.trashItem(destination)
  }
}

/**
 * @param {import('electron').IpcMainInvokeEvent} event
 * @param {number} id
 */
export async function handleYtDlpOpenDownload(event, id) {
  if (!isOpenTubeXUrl(event.senderFrame.url) || !event.sender.isFocused() || !Number.isInteger(id)) {
    return false
  }

  await loadDownloadRecords()
  const record = downloadRecords.get(id)
  const destinations = Array.isArray(record?.destinations) && record.destinations.length > 0
    ? record.destinations
    : [record?.destination].filter(destination => typeof destination === 'string')
  const destination = destinations.find(existsSync)
  if (destination === undefined) {
    return false
  }

  shell.showItemInFolder(destination)
  return true
}

/**
 * Moves a completed download to the operating system trash.
 * @param {import('electron').IpcMainInvokeEvent} event
 * @param {number} id
 */
export async function handleYtDlpRemoveDownload(event, id) {
  if (!isOpenTubeXUrl(event.senderFrame.url) || !event.sender.isFocused() || !Number.isInteger(id)) {
    return false
  }

  await loadDownloadRecords()
  const record = downloadRecords.get(id)
  const destinations = Array.isArray(record?.destinations) && record.destinations.length > 0
    ? record.destinations
    : [record?.destination].filter(destination => typeof destination === 'string')
  if (record?.status !== 'completed' || destinations.length === 0 || !destinations.some(existsSync)) {
    return false
  }

  let trashed = false
  for (const destination of destinations) {
    if (!existsSync(destination)) continue
    try {
      await moveToTrash(destination)
      trashed = true
    } catch (error) {
      console.warn('Could not move download to trash', destination, error)
    }
  }
  if (!trashed) return false

  downloadRecords.delete(id)
  await saveDownloadRecords()
  broadcastToRenderers(IpcChannels.YT_DLP_DOWNLOADS_REMOVED, [id])
  return true
}

/**
 * @param {import('electron').IpcMainInvokeEvent} event
 */
export async function handleYtDlpListDownloads(event) {
  if (!isOpenTubeXUrl(event.senderFrame.url)) return []
  await loadDownloadRecords()
  await restorePersistedDownloadQueue(event)
  return Promise.all([...downloadRecords.values()].map(async record => {
    if (record.status !== 'completed') return record

    const destinations = Array.isArray(record.destinations) && record.destinations.length > 0
      ? record.destinations
      : [record.destination].filter(destination => typeof destination === 'string')
    const destinationStats = await Promise.all(destinations.map(async destination => {
      try {
        return await stat(destination)
      } catch {
        return null
      }
    }))
    const availableDestinationCount = destinationStats.filter(Boolean).length
    const sizeBytes = destinationStats.reduce((total, destinationStat) => (
      total + (destinationStat?.isFile() ? destinationStat.size : 0)
    ), 0)
    const availability = availableDestinationCount === 0
      ? 'missing'
      : availableDestinationCount === destinations.length
        ? 'available'
        : 'partial'

    return {
      ...record,
      availability,
      availableDestinationCount,
      destinationCount: destinations.length,
      sizeBytes,
      files: getDownloadFiles(record).map(file => ({
        ...file,
        available: existsSync(file.path)
      }))
    }
  }))
}

/**
 * Returns the playable files recorded for a video download. Older single-video
 * records can be identified without guessing from their user-customizable path.
 * @param {YtDlpDownloadStatus} record
 */
function getDownloadFiles(record) {
  if (Array.isArray(record.files) && record.files.length > 0) {
    return record.files.filter(file => ID_REGEX.test(file?.videoId) && typeof file.path === 'string')
  }
  if (['video', 'audio'].includes(record.mode) && ID_REGEX.test(record.videoId) && typeof record.destination === 'string') {
    return [{ videoId: record.videoId, path: record.destination }]
  }
  return []
}

/**
 * Resolves a local media request without exposing arbitrary filesystem access
 * through the custom protocol.
 * @param {number} id
 * @param {string} videoId
 */
export async function getYtDlpDownloadFile(id, videoId) {
  if (!Number.isInteger(id) || !ID_REGEX.test(videoId)) return null
  await loadDownloadRecords()
  const record = downloadRecords.get(id)
  if (record?.status !== 'completed' || !['video', 'audio'].includes(record.mode)) return null
  const file = getDownloadFiles(record).find(file => file.videoId === videoId && existsSync(file.path))
  return file === undefined ? null : { path: file.path, mode: record.mode }
}

/**
 * Removes download history entries without touching their files.
 * @param {import('electron').IpcMainInvokeEvent} event
 * @param {number[]} ids
 */
export async function handleYtDlpClearDownloads(event, ids) {
  if (!isOpenTubeXUrl(event.senderFrame.url) || !event.sender.isFocused() ||
    !Array.isArray(ids) || ids.some(id => !Number.isInteger(id))) {
    return false
  }
  await loadDownloadRecords()
  const removedIds = []
  for (const id of ids) {
    const record = downloadRecords.get(id)
    if (!activeDownloads.has(id) && !queuedDownloadWaiters.has(id) &&
      ['completed', 'failed', 'cancelled', 'skipped'].includes(record?.status) &&
      downloadRecords.delete(id)) removedIds.push(id)
  }
  await saveDownloadRecords()
  if (removedIds.length > 0) broadcastToRenderers(IpcChannels.YT_DLP_DOWNLOADS_REMOVED, removedIds)
  return true
}
