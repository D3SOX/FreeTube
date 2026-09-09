import { isYtDlpPlaybackSourceCacheable } from './ytDlpPlaybackCache.js'

export const DEFAULT_YT_DLP_PRELOAD_COUNT = 2
export const MAX_YT_DLP_PRELOAD_COUNT = 10
export const DEFAULT_YT_DLP_PRELOAD_CONCURRENCY = 2
export const MAX_YT_DLP_PRELOAD_CONCURRENCY = 32

const pendingPreloadTasks = []
let activePreloadTasks = 0

function startPendingPreloadTasks() {
  while (pendingPreloadTasks.length > 0) {
    const task = pendingPreloadTasks[0]
    if (activePreloadTasks >= task.concurrency) return

    pendingPreloadTasks.shift()
    activePreloadTasks++

    Promise.resolve()
      .then(task.loadSource)
      .then(task.resolve, task.reject)
      .finally(() => {
        activePreloadTasks--
        startPendingPreloadTasks()
      })
  }
}

function scheduleYtDlpPlaybackPreload(loadSource, concurrency) {
  return new Promise((resolve, reject) => {
    pendingPreloadTasks.push({ loadSource, concurrency, resolve, reject })
    startPendingPreloadTasks()
  })
}

/**
 * Identifies every setting that requires fresh yt-dlp stream URLs.
 * @param {Record<string, unknown>} getters
 */
export function buildYtDlpPlaybackCacheKey(getters) {
  return JSON.stringify([
    'captions-v4',
    getters.getYtDlpSource,
    getters.getYtDlpChannel,
    getters.getYtDlpPath,
    getters.getYtDlpPlaybackAuthMode,
    getters.getYtDlpPlaybackCookiesPath,
    getters.getYtDlpPlaybackCookiesBrowser,
    getters.getYtDlpPlaybackCookiesBrowserProfile,
  ])
}

/**
 * @param {unknown} value
 */
export function normalizeYtDlpPreloadCount(value) {
  const count = Number(value)
  if (!Number.isInteger(count) || count <= 0) return 0
  return Math.min(count, MAX_YT_DLP_PRELOAD_COUNT)
}

/**
 * @param {unknown} value
 */
export function normalizeYtDlpPreloadConcurrency(value) {
  const concurrency = Number(value)
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    return DEFAULT_YT_DLP_PRELOAD_CONCURRENCY
  }
  return Math.min(concurrency, MAX_YT_DLP_PRELOAD_CONCURRENCY)
}

/**
 * Selects the videos that can actually play next. The watch queue takes
 * precedence over a playlist, which takes precedence over recommendations.
 * @param {object} options
 * @param {string} options.currentVideoId
 * @param {number} options.limit
 * @param {{ videoId?: string }[]} options.queuedVideos
 * @param {{ videoId?: string }[] | null} options.playlistVideos null outside a playlist
 * @param {{ videoId?: string }[]} options.recommendedVideos
 */
export function selectYtDlpPreloadVideoIds({
  currentVideoId,
  limit,
  queuedVideos,
  playlistVideos,
  recommendedVideos,
}) {
  const normalizedLimit = normalizeYtDlpPreloadCount(limit)
  if (normalizedLimit === 0) return []

  const candidates = queuedVideos.length > 0
    ? queuedVideos
    : playlistVideos !== null
      ? playlistVideos
      : recommendedVideos
  const videoIds = []
  const seen = new Set([currentVideoId])

  for (const candidate of candidates) {
    const videoId = candidate?.videoId
    if (typeof videoId !== 'string' || videoId === '' || seen.has(videoId)) continue

    seen.add(videoId)
    videoIds.push(videoId)
    if (videoIds.length === normalizedLimit) break
  }

  return videoIds
}

/**
 * @param {string[]} videoIds
 * @param {object} options
 * @param {(videoId: string) => Promise<unknown>} options.loadSource
 * @param {number} [options.concurrency]
 * @param {(progress: { requested: number, completed: number, preloaded: number, failed: number }) => void} [options.onProgress]
 */
export async function preloadYtDlpPlaybackSources(videoIds, {
  loadSource,
  concurrency = DEFAULT_YT_DLP_PRELOAD_CONCURRENCY,
  onProgress = () => {},
}) {
  const uniqueVideoIds = [...new Set(videoIds.filter(videoId => typeof videoId === 'string' && videoId !== ''))]
  const normalizedConcurrency = normalizeYtDlpPreloadConcurrency(concurrency)
  let nextIndex = 0
  let preloaded = 0
  let failed = 0

  async function worker() {
    while (nextIndex < uniqueVideoIds.length) {
      const videoId = uniqueVideoIds[nextIndex++]
      try {
        const source = await scheduleYtDlpPlaybackPreload(
          () => loadSource(videoId),
          normalizedConcurrency
        )
        if (source === null || !isYtDlpPlaybackSourceCacheable(source)) {
          failed++
        } else {
          preloaded++
        }
      } catch {
        failed++
      }
      onProgress({
        requested: uniqueVideoIds.length,
        completed: preloaded + failed,
        preloaded,
        failed,
      })
    }
  }

  const workerCount = Math.min(
    uniqueVideoIds.length,
    normalizedConcurrency
  )
  await Promise.all(Array.from({ length: workerCount }, worker))

  return {
    requested: uniqueVideoIds.length,
    preloaded,
    failed,
  }
}
