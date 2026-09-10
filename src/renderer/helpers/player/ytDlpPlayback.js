import { ytDlp } from '../ytDlp'
import { FormatUtils, Misc } from 'youtubei.js'

import { MANIFEST_TYPE_DASH, MANIFEST_TYPE_HLS } from './utils'
import { probeStreamByteRanges } from './streamByteRanges'
import { getCompatibleAdaptiveFormats } from './compatibleAdaptiveFormats'
import { generateAudioTrackField } from '../api/local'
import { waitForYtDlpFormatAvailability } from './ytDlpFormatAvailability'
import { getEarliestYtDlpFormatExpiry, YtDlpPlaybackSourceCache } from './ytDlpPlaybackCache'

/** @typedef {import('../../../main/ytDlp').YtDlpPlaybackFormat} YtDlpPlaybackFormat */

/**
 * @typedef {object} YtDlpPlaybackSource
 * @property {string | null} manifestSrc
 * @property {MANIFEST_TYPE_DASH | MANIFEST_TYPE_HLS} manifestMimeType
 * @property {any[]} legacyFormats
 * @property {Date | null} expiryDate
 * @property {string | null} title
 * @property {boolean} isLive
 * @property {number | null} duration
 * @property {string | null} storyboardSrc
 * @property {import('../../../main/ytDlp').YtDlpPlaybackCaption[]} captions
 * @property {import('../../../main/ytDlp').YtDlpPlaybackCaption[]} captionTranslations
 * @property {boolean} subtitlesIncluded whether yt-dlp checked for automatic subtitles
 * @property {string | null} version the yt-dlp version that extracted the streams
 */

// yt-dlp appends the audio track or a suffix like "-drc" to the itag for some formats
const ITAG_REGEX = /^\d+/
const URL_PROBE_TIMEOUT = 10_000
const REJECTED_PLAYBACK_URL_STATUSES = new Set([401, 403, 404, 410])
const MINIMUM_LIVE_DVR_WINDOW_SECONDS = 30
const playbackSourceCache = new YtDlpPlaybackSourceCache()
const pendingPlaybackSourceLoads = new Map()
const playbackSourceCacheChangeListeners = new Set()

function notifyPlaybackSourceCacheChanged() {
  for (const listener of playbackSourceCacheChangeListeners) listener()
}

function effectivePlaybackSourceCacheKey(cacheKey, useAuthentication) {
  return JSON.stringify([cacheKey, useAuthentication])
}

/**
 * @param {() => void} listener
 * @returns {() => void}
 */
export function onYtDlpPlaybackSourceCacheChange(listener) {
  playbackSourceCacheChangeListeners.add(listener)
  return () => playbackSourceCacheChangeListeners.delete(listener)
}

/**
 * Returns the earliest time at which any requested source stops being safely
 * reusable, or null when at least one source is not cached.
 * @param {string[]} videoIds
 * @param {string} cacheKey
 * @param {boolean} useAuthentication
 * @param {boolean} [requireSubtitles]
 * @returns {number | null}
 */
export function getYtDlpPlaybackSourcesUsableUntil(
  videoIds,
  cacheKey,
  useAuthentication,
  requireSubtitles = true
) {
  const uniqueVideoIds = [...new Set(videoIds)]
  if (uniqueVideoIds.length === 0) return null

  const effectiveCacheKey = effectivePlaybackSourceCacheKey(cacheKey, useAuthentication)
  let usableUntil = Infinity

  for (const videoId of uniqueVideoIds) {
    const sourceUsableUntil = playbackSourceCache.getUsableUntil(
      videoId,
      effectiveCacheKey,
      requireSubtitles
    )
    if (sourceUsableUntil === null) return null

    usableUntil = Math.min(usableUntil, sourceUsableUntil)
  }

  return usableUntil
}

/**
 * Keeps every source requested by an explicit playlist preload available for
 * the rest of the app session, even when the playlist exceeds the normal LRU
 * limit.
 * @param {number} entries
 */
export function reserveYtDlpPlaybackSourceCache(entries) {
  playbackSourceCache.ensureCapacity(entries)
}

async function cacheYtDlpPlaybackSource(videoId, cacheKey, source) {
  if (source.isLive) return

  if (playbackSourceCache.set(videoId, cacheKey, source)) {
    notifyPlaybackSourceCacheChanged()
  }
  if (source.expiryDate === null) return

  try {
    await ytDlp.ytDlpPlaybackCacheSet(
      videoId,
      cacheKey,
      source.expiryDate.getTime(),
      source
    )
  } catch (error) {
    console.warn('Could not save the persistent yt-dlp playback cache', error)
  }
}

/**
 * @param {string} url
 */
function hasLimitedLiveDvrWindow(url) {
  const match = url.match(/\/(?:manifest|playlist)_duration\/(\d+)\//)
  return match !== null && parseInt(match[1], 10) <= MINIMUM_LIVE_DVR_WINDOW_SECONDS
}

/**
 * Ensures playback-error recovery extracts fresh signed stream URLs.
 * @param {string} videoId
 */
export function invalidateYtDlpPlaybackSource(videoId) {
  if (playbackSourceCache.delete(videoId)) {
    notifyPlaybackSourceCacheChanged()
  }
  ytDlp.ytDlpPlaybackCacheDelete(videoId).catch(error => {
    console.warn('Could not remove an entry from the persistent yt-dlp playback cache', error)
  })
}

export function invalidateAllYtDlpPlaybackSources() {
  if (playbackSourceCache.clear()) {
    notifyPlaybackSourceCacheChanged()
  }
  return ytDlp.ytDlpPlaybackCacheClear().catch(error => {
    console.warn('Could not clear the persistent yt-dlp playback cache', error)
    return false
  })
}

/**
 * @param {YtDlpPlaybackFormat} format
 */
function isVideoFormat(format) {
  return format.vcodec !== null && format.vcodec !== 'none'
}

/**
 * @param {YtDlpPlaybackFormat} format
 */
function isAudioFormat(format) {
  return format.acodec !== null && format.acodec !== 'none'
}

/**
 * @param {YtDlpPlaybackFormat} format
 * @returns {string} e.g. `video/mp4; codecs="av01.0.12M.08"`
 */
function buildMimeType(format) {
  const container = format.ext === 'webm' ? 'webm' : 'mp4'

  if (isVideoFormat(format)) {
    const codecs = isAudioFormat(format) ? `${format.vcodec}, ${format.acodec}` : format.vcodec
    return `video/${container}; codecs="${codecs}"`
  }

  return `audio/${container}; codecs="${format.acodec}"`
}

/**
 * @param {YtDlpPlaybackFormat} format
 */
function buildQualityLabel(format) {
  if (format.height === null) {
    return format.formatNote ?? 'unknown'
  }

  return format.fps !== null && format.fps > 30 ? `${format.height}p${Math.round(format.fps)}` : `${format.height}p`
}

/**
 * @param {YtDlpPlaybackFormat} format
 */
function buildColorInfo(format) {
  switch (format.dynamicRange) {
    case 'HDR10':
      return {
        primaries: 'COLOR_PRIMARIES_BT2020',
        transferCharacteristics: 'COLOR_TRANSFER_CHARACTERISTICS_SMPTEST2084',
        matrixCoefficients: 'COLOR_MATRIX_COEFFICIENTS_BT2020_NCL'
      }
    case 'HLG':
      return {
        primaries: 'COLOR_PRIMARIES_BT2020',
        transferCharacteristics: 'COLOR_TRANSFER_CHARACTERISTICS_ARIB_STD_B67',
        matrixCoefficients: 'COLOR_MATRIX_COEFFICIENTS_BT2020_NCL'
      }
    case 'SDR':
    case null:
      // Players compare the colour information to tell otherwise identical resolutions
      // apart, so it has to be stated for SDR streams too rather than left out,
      // which is also what YouTube's own API reports for them
      return {
        primaries: 'COLOR_PRIMARIES_BT709',
        transferCharacteristics: 'COLOR_TRANSFER_CHARACTERISTICS_BT709',
        matrixCoefficients: 'COLOR_MATRIX_COEFFICIENTS_BT709'
      }
    default:
      // Claiming the wrong colour space is worse than not stating one at all,
      // so anything we don't recognise (e.g. Dolby Vision) is left to the player
      return undefined
  }
}

/**
 * @param {URL} url
 * @returns {number | undefined} the stream duration in milliseconds
 */
function getApproxDurationMs(url) {
  const duration = parseFloat(url.searchParams.get('dur'))

  return Number.isFinite(duration) ? Math.round(duration * 1000) : undefined
}

/**
 * @param {YtDlpPlaybackFormat} format
 * @param {import('./streamByteRanges').StreamByteRanges | null} byteRanges null for segmented Post-Live-DVR formats
 * @param {number | null} fallbackDuration the video duration in seconds
 * @returns {import('youtubei.js').Misc.Format}
 */
function convertYtDlpToLocalFormat(format, byteRanges, fallbackDuration) {
  const url = new URL(format.url)
  const isVideo = isVideoFormat(format)

  const localFormat = new Misc.Format({
    itag: parseInt(ITAG_REGEX.exec(format.formatId)?.[0] ?? '0'),
    mimeType: buildMimeType(format),
    bitrate: format.bitrate ?? 0,
    ...(format.width !== null && format.height !== null ? { width: format.width, height: format.height } : {}),
    ...(byteRanges === null
      ? { targetDurationSec: format.targetDuration }
      : { initRange: byteRanges.initRange, indexRange: byteRanges.indexRange }),
    url: format.url,
    approxDurationMs: getApproxDurationMs(url) ??
      (fallbackDuration === null ? undefined : Math.round(fallbackDuration * 1000)),
    ...(isVideo
      ? {
          fps: format.fps ?? undefined,
          qualityLabel: buildQualityLabel(format),
          colorInfo: buildColorInfo(format)
        }
      : {
          audioQuality: 'AUDIO_QUALITY_MEDIUM',
          audioSampleRate: format.audioSampleRate ?? undefined,
          audioChannels: format.audioChannels ?? undefined
        })
  })

  if (localFormat.has_audio) {
    // googlevideo puts the audio track details into the URL rather than into yt-dlp's output
    const xtags = (url.searchParams.get('xtags') ?? '').split(':')

    localFormat.language = xtags.find(tag => tag.startsWith('lang='))?.split('=')[1] || format.language
    localFormat.is_drc = xtags.includes('drc=1')

    const audioContent = xtags.find(tag => tag.startsWith('acont='))?.split('=')[1]
    localFormat.is_dubbed = audioContent === 'dubbed'
    localFormat.is_descriptive = audioContent === 'descriptive'
    localFormat.is_secondary = audioContent === 'secondary'
    localFormat.is_auto_dubbed = audioContent === 'dubbed-auto'
    localFormat.is_original = audioContent === 'original' ||
      (
        !localFormat.is_dubbed &&
        !localFormat.is_descriptive &&
        !localFormat.is_secondary &&
        !localFormat.is_auto_dubbed &&
        !localFormat.is_drc
      )
  }

  return localFormat
}

/**
 * @param {YtDlpPlaybackFormat} format
 */
function isPostLiveDvrSegmentedFormat(format) {
  return format.protocol === 'http_dash_segments' &&
    format.url !== null &&
    isVideoFormat(format) !== isAudioFormat(format) &&
    format.targetDuration !== null &&
    Number.isFinite(format.targetDuration) &&
    format.targetDuration > 0 &&
    format.fragmentCount !== null &&
    Number.isInteger(format.fragmentCount) &&
    format.fragmentCount > 0
}

/**
 * @param {YtDlpPlaybackFormat} format
 */
function mapYtDlpLegacyFormat(format) {
  return {
    itag: parseInt(ITAG_REGEX.exec(format.formatId)?.[0] ?? '0'),
    qualityLabel: buildQualityLabel(format),
    fps: format.fps,
    bitrate: format.bitrate,
    mimeType: buildMimeType(format),
    height: format.height,
    width: format.width,
    url: format.url,
    availableAt: format.availableAt
  }
}

/**
 * Checks that a stream or manifest URL is accepted before exposing it to the player.
 * @param {string} url
 */
async function probeYtDlpUrl(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(URL_PROBE_TIMEOUT) })
    await response.body?.cancel()
    return response.ok
  } catch {
    return false
  }
}

/**
 * Checks whether the exact URL that timed out is still serving stream data.
 * @param {unknown} url
 * @returns {Promise<'accepted' | 'rejected' | 'inconclusive'>}
 */
export async function checkYtDlpPlaybackUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return 'inconclusive'

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(URL_PROBE_TIMEOUT) })

    if (REJECTED_PLAYBACK_URL_STATUSES.has(response.status)) {
      await response.body?.cancel().catch(() => {})
      return 'rejected'
    }

    if (!response.ok || response.body === null) {
      await response.body?.cancel().catch(() => {})
      return 'inconclusive'
    }

    const reader = response.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (value !== undefined && value.byteLength > 0) return 'accepted'
        if (done) return 'inconclusive'
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
  } catch {
    return 'inconclusive'
  }
}

/**
 * @param {string} url
 */
async function probeYtDlpHlsManifest(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(URL_PROBE_TIMEOUT) })
    return response.ok && (await response.text()).trimStart().startsWith('#EXTM3U')
  } catch {
    return false
  }
}

/**
 * @param {YtDlpPlaybackFormat[]} formats
 */
async function convertLegacyFormats(formats) {
  const results = await Promise.all(formats.map(async format => {
    if (
      !await waitForYtDlpFormatAvailability(format) ||
      !await probeYtDlpUrl(format.url)
    ) {
      return null
    }

    return mapYtDlpLegacyFormat(format)
  }))

  return results.filter(format => format !== null)
}

/**
 * Reads the byte ranges of every adaptive format in parallel and drops the ones
 * that the byte ranges couldn't be determined for.
 * @param {YtDlpPlaybackFormat[]} formats
 * @param {number | null} duration
 */
async function convertAdaptiveFormats(formats, duration) {
  const results = await Promise.all(formats.map(async (format) => {
    try {
      if (!await waitForYtDlpFormatAvailability(format)) {
        return null
      }

      const byteRanges = await probeStreamByteRanges(format.url, format.ext === 'webm')

      return byteRanges === null ? null : convertYtDlpToLocalFormat(format, byteRanges, duration)
    } catch (error) {
      console.error(`Failed to read the byte ranges of yt-dlp format ${format.formatId}`, error)
      return null
    }
  }))

  return addAudioTrackFields(results.filter(format => format !== null))
}

/**
 * Converts Post-Live-DVR formats without probing byte ranges. Each `sq` fragment
 * is a self-initializing MP4 segment, and yt-dlp provides its duration and count.
 * @param {YtDlpPlaybackFormat[]} formats
 * @param {number} duration
 */
async function convertPostLiveDvrFormats(formats, duration) {
  const results = await Promise.all(formats.map(async format => {
    return await waitForYtDlpFormatAvailability(format)
      ? convertYtDlpToLocalFormat(format, null, duration)
      : null
  }))

  return addAudioTrackFields(results.filter(format => format !== null))
}

/**
 * @param {import('youtubei.js').Misc.Format[]} localFormats
 */
function addAudioTrackFields(localFormats) {
  const audioFormats = localFormats.filter(format => format.has_audio)

  // YouTube only labels the audio tracks when there is more than one to choose from
  if (new Set(audioFormats.map(format => `${format.language}-${format.is_original}`)).size > 1) {
    // match YouTube's local API response with English
    const languageNames = new Intl.DisplayNames('en-US', { type: 'language', languageDisplay: 'standard' })

    for (const format of audioFormats) {
      generateAudioTrackField(format, languageNames)
    }
  }

  return localFormats
}

/**
 * Supplies the metadata youtubei.js normally reads from a HEAD request when it
 * generates a Post-Live-DVR DASH timeline.
 * @param {number} duration seconds
 * @param {number} fragmentCount
 */
function createPostLiveDvrActions(duration, fragmentCount) {
  const headers = new Headers({
    'X-Head-Time-Millis': String(Math.round(duration * 1000)),
    'X-Head-Seqnum': String(fragmentCount - 1)
  })

  return {
    session: {
      http: {
        fetch_function: async () => ({ headers })
      }
    }
  }
}

/**
 * Uses yt-dlp to get the stream URLs for a video, which avoids YouTube's error prone
 * SABR streaming protocol. Live streams use YouTube's HLS manifests, which keep the
 * DVR window available, so that they can be rewound.
 * @param {string} videoId
 * @param {string} cacheKey identifies the yt-dlp executable and proxy configuration
 * @param {() => void} [onDefaultClientsFallback] called before retrying with yt-dlp's default clients
 * @param {boolean} [useAuthentication] whether to use the explicitly configured cookie source
 * @param {boolean} [cachedOnly] prevents a cache miss from starting a new extraction
 * @param {boolean} [includeSubtitles] whether yt-dlp should request automatic subtitles
 * @returns {Promise<YtDlpPlaybackSource | null>}
 */
export function getYtDlpPlaybackSource(
  videoId,
  cacheKey = '',
  onDefaultClientsFallback,
  useAuthentication = false,
  cachedOnly = false,
  includeSubtitles = true
) {
  if (cachedOnly) {
    return loadYtDlpPlaybackSource(
      videoId,
      cacheKey,
      onDefaultClientsFallback,
      useAuthentication,
      true,
      includeSubtitles
    )
  }

  const requestKey = JSON.stringify([videoId, cacheKey, useAuthentication, includeSubtitles])
  const pendingLoad = pendingPlaybackSourceLoads.get(requestKey)
  if (pendingLoad !== undefined) {
    if (onDefaultClientsFallback !== undefined) {
      pendingLoad.defaultClientsFallbackCallbacks.add(onDefaultClientsFallback)
      if (pendingLoad.defaultClientsFallbackStarted) {
        onDefaultClientsFallback()
      }
    }
    return pendingLoad.promise
  }

  const defaultClientsFallbackCallbacks = new Set()
  if (onDefaultClientsFallback !== undefined) {
    defaultClientsFallbackCallbacks.add(onDefaultClientsFallback)
  }

  const pendingEntry = {
    defaultClientsFallbackCallbacks,
    defaultClientsFallbackStarted: false,
    promise: null,
  }
  pendingEntry.promise = loadYtDlpPlaybackSource(
    videoId,
    cacheKey,
    () => {
      pendingEntry.defaultClientsFallbackStarted = true
      for (const callback of defaultClientsFallbackCallbacks) callback()
    },
    useAuthentication,
    false,
    includeSubtitles
  ).finally(() => {
    if (pendingPlaybackSourceLoads.get(requestKey) === pendingEntry) {
      pendingPlaybackSourceLoads.delete(requestKey)
    }
  })
  pendingPlaybackSourceLoads.set(requestKey, pendingEntry)
  return pendingEntry.promise
}

async function loadYtDlpPlaybackSource(
  videoId,
  cacheKey,
  onDefaultClientsFallback,
  useAuthentication,
  cachedOnly,
  includeSubtitles
) {
  const effectiveCacheKey = effectivePlaybackSourceCacheKey(cacheKey, useAuthentication)
  let cachedSource = playbackSourceCache.get(videoId, effectiveCacheKey)

  if (cachedSource === null) {
    try {
      const entry = await ytDlp.ytDlpPlaybackCacheGet(videoId, effectiveCacheKey)
      if (entry !== null) {
        const source = {
          ...entry.source,
          captions: entry.source.captions ?? [],
          captionTranslations: entry.source.captionTranslations ?? [],
          subtitlesIncluded: entry.source.subtitlesIncluded ?? false,
          expiryDate: new Date(entry.expiryTime)
        }
        if (playbackSourceCache.set(videoId, effectiveCacheKey, source)) {
          notifyPlaybackSourceCacheChanged()
        }
        cachedSource = playbackSourceCache.get(videoId, effectiveCacheKey)

        if (cachedSource === null) {
          await ytDlp.ytDlpPlaybackCacheDelete(videoId)
        }
      }
    } catch (error) {
      console.warn('Could not read the persistent yt-dlp playback cache', error)
    }
  }

  if (cachedSource !== null && (!includeSubtitles || cachedSource.subtitlesIncluded)) {
    return cachedSource
  }

  if (cachedOnly) {
    return cachedSource
  }

  let extractionError = null
  let limitedLiveSource = null

  // A fresh extraction with the same default clients can return working URLs after
  // an immediately preceding extraction returned URLs that respond with 403. Give
  // yt-dlp's defaults one bounded retry before falling back to the built-in source.
  let defaultClientsFallbackAnnounced = false
  for (const useDefaultClients of [false, true, true]) {
    if (useDefaultClients && !defaultClientsFallbackAnnounced) {
      defaultClientsFallbackAnnounced = true
      onDefaultClientsFallback?.()
    }

    const info = await ytDlp.ytDlpGetPlaybackInfo(
      videoId,
      useDefaultClients,
      useAuthentication,
      includeSubtitles
    )

    if (info === null) {
      extractionError = new Error('yt-dlp is not available')
      break
    }

    if ('error' in info) {
      if (info.error === 'ENOENT') {
        extractionError = new Error('yt-dlp could not be found')
        break
      }

      extractionError = new Error(info.error)
      continue
    }

    const isLive = info.isLive || info.liveStatus === 'is_live'
    const postLiveDvrFormats = info.liveStatus === 'post_live'
      ? info.formats.filter(isPostLiveDvrSegmentedFormat)
      : []

    if (postLiveDvrFormats.length > 0) {
      const fragmentCount = Math.max(...postLiveDvrFormats.map(format => format.fragmentCount))
      const duration = info.duration !== null && info.duration > 0
        ? info.duration
        : Math.max(...postLiveDvrFormats.map(format => format.targetDuration * format.fragmentCount))
      const localFormats = await convertPostLiveDvrFormats(postLiveDvrFormats, duration)

      if (localFormats.some(format => format.has_video) && localFormats.some(format => format.has_audio)) {
        const manifest = await FormatUtils.toDash(
          { adaptive_formats: localFormats },
          true,
          undefined,
          undefined,
          undefined,
          undefined,
          createPostLiveDvrActions(duration, fragmentCount)
        )
        const source = {
          manifestSrc: `data:${MANIFEST_TYPE_DASH};charset=UTF-8,${encodeURIComponent(manifest)}`,
          manifestMimeType: MANIFEST_TYPE_DASH,
          legacyFormats: [],
          expiryDate: getEarliestYtDlpFormatExpiry(postLiveDvrFormats),
          title: info.title,
          isLive: false,
          duration,
          storyboardSrc: info.storyboardVtt === null
            ? null
            : `data:text/vtt;charset=utf-8,${encodeURIComponent(info.storyboardVtt)}`,
          captions: info.captions ?? [],
          captionTranslations: info.captionTranslations ?? [],
          subtitlesIncluded: includeSubtitles,
          version: info.version
        }

        await cacheYtDlpPlaybackSource(videoId, effectiveCacheKey, source)
        return source
      }
    }

    const httpFormats = info.formats.filter(format => format.protocol === 'https' && format.url !== null)
    const legacyHttpFormats = httpFormats.filter(format => isVideoFormat(format) && isAudioFormat(format))
    const legacyFormatsPromise = convertLegacyFormats(legacyHttpFormats)

    // live streams are only available as HLS, which is what makes rewinding within
    // the DVR window possible
    if (!isLive) {
      const adaptiveFormats = httpFormats.filter(format => !(isVideoFormat(format) && isAudioFormat(format)))
      const localFormats = getCompatibleAdaptiveFormats(await convertAdaptiveFormats(adaptiveFormats, info.duration))

      if (localFormats.some(format => format.has_video) && localFormats.some(format => format.has_audio)) {
        const manifest = await FormatUtils.toDash({ adaptive_formats: localFormats })
        const legacyFormats = await legacyFormatsPromise

        const source = {
          manifestSrc: `data:${MANIFEST_TYPE_DASH};charset=UTF-8,${encodeURIComponent(manifest)}`,
          manifestMimeType: MANIFEST_TYPE_DASH,
          legacyFormats,
          expiryDate: getEarliestYtDlpFormatExpiry(adaptiveFormats),
          title: info.title,
          isLive: false,
          duration: info.duration,
          storyboardSrc: info.storyboardVtt === null
            ? null
            : `data:text/vtt;charset=utf-8,${encodeURIComponent(info.storyboardVtt)}`,
          captions: info.captions ?? [],
          captionTranslations: info.captionTranslations ?? [],
          subtitlesIncluded: includeSubtitles,
          version: info.version
        }

        await cacheYtDlpPlaybackSource(videoId, effectiveCacheKey, source)
        return source
      }
    }

    if (
      info.hlsManifestUrl !== null &&
      await probeYtDlpHlsManifest(info.hlsManifestUrl)
    ) {
      const source = {
        manifestSrc: info.hlsManifestUrl,
        manifestMimeType: MANIFEST_TYPE_HLS,
        legacyFormats: await legacyFormatsPromise,
        expiryDate: getEarliestYtDlpFormatExpiry(
          info.formats.filter(format => format.url !== null)
        ),
        title: info.title,
        isLive,
        duration: info.duration,
        storyboardSrc: info.storyboardVtt === null
          ? null
          : `data:text/vtt;charset=utf-8,${encodeURIComponent(info.storyboardVtt)}`,
        captions: info.captions ?? [],
        captionTranslations: info.captionTranslations ?? [],
        subtitlesIncluded: includeSubtitles,
        version: info.version
      }

      // The preferred web clients sometimes expose only the last 30 seconds of an
      // otherwise rewindable live stream. Let the existing default-client fallback
      // try to obtain its full DVR manifest, while retaining this playable source in
      // case those clients fail.
      if (
        !useDefaultClients &&
        isLive &&
        hasLimitedLiveDvrWindow(info.hlsManifestUrl)
      ) {
        limitedLiveSource = source
        continue
      }

      await cacheYtDlpPlaybackSource(videoId, effectiveCacheKey, source)
      return source
    }

    if (!isLive) {
      const legacyFormats = await legacyFormatsPromise
      if (legacyFormats.length > 0) {
        const source = {
          manifestSrc: null,
          manifestMimeType: MANIFEST_TYPE_DASH,
          legacyFormats,
          expiryDate: getEarliestYtDlpFormatExpiry(legacyHttpFormats),
          title: info.title,
          isLive: false,
          duration: info.duration,
          storyboardSrc: info.storyboardVtt === null
            ? null
            : `data:text/vtt;charset=utf-8,${encodeURIComponent(info.storyboardVtt)}`,
          captions: info.captions ?? [],
          captionTranslations: info.captionTranslations ?? [],
          subtitlesIncluded: includeSubtitles,
          version: info.version
        }

        await cacheYtDlpPlaybackSource(videoId, effectiveCacheKey, source)
        return source
      }
    }

    extractionError = new Error('yt-dlp did not return any playable formats')
  }

  if (limitedLiveSource !== null) {
    return limitedLiveSource
  }

  if (cachedSource !== null) {
    return cachedSource
  }

  throw extractionError ?? new Error('yt-dlp did not return any playable formats')
}
