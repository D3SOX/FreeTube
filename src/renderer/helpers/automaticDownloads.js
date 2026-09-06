import { ytDlp } from './ytDlp'
import { supportsYtDlp } from './ytDlpCapabilities'
import store from '../store/index'
import { getDownloadTemplateOptions } from './downloadTemplates'
import {
  matchesAutomaticDownloadRule,
  normalizeAutomaticDownloadRule,
  parseAutomaticDownloadRules
} from './automaticDownloadRules'
import { showToastOnAllTabs } from './utils'

// Feed refreshes can overlap across profiles and views. Keep a session-level
// guard in addition to the persistent download history in the main process.
const scheduledVideoIds = new Set()

/**
 * Failed or canceled downloads may be retried by a later feed refresh. The
 * main-process history remains the source of truth for terminal deduplication.
 * @param {object} download
 */
export function releaseAutomaticDownloadSchedule(download) {
  if (download?.automatic === true && ['failed', 'cancelled'].includes(download.status)) {
    scheduledVideoIds.delete(download.videoId)
  }
}

/**
 * Adds channels with automatic rules to the set fetched for a subscription
 * feed, even when the current profile filters those channels out.
 * @param {{ id: string }[]} activeSubscriptions
 * @param {'videos' | 'shorts' | 'live'} source
 */
export function includeAutomaticDownloadChannels(activeSubscriptions, source) {
  if (!supportsYtDlp || !store.getters.getEnableDownloads) {
    return activeSubscriptions
  }

  const rules = parseAutomaticDownloadRules(store.getters.getYtDlpAutomaticDownloadRules)
  const automaticChannelIds = new Set(Object.entries(rules)
    .filter(([, rawRule]) => {
      const rule = normalizeAutomaticDownloadRule(rawRule)
      if (source === 'shorts') return rule.includeShorts
      if (source === 'live') return rule.includeLivestreams
      return rule.includeVideos || rule.includeLivestreams
    })
    .map(([channelId]) => channelId))
  if (automaticChannelIds.size === 0) {
    return activeSubscriptions
  }

  const includedIds = new Set(activeSubscriptions.map(channel => channel.id))
  const allSubscriptions = store.getters.getProfileList[0]?.subscriptions ?? []
  return [
    ...activeSubscriptions,
    ...allSubscriptions.filter(channel => automaticChannelIds.has(channel.id) && !includedIds.has(channel.id))
  ]
}

function parseCustomTemplates() {
  try {
    const templates = JSON.parse(store.getters.getYtDlpDownloadTemplates || '[]')
    return Array.isArray(templates) ? templates : []
  } catch {
    return []
  }
}

function getThumbnail(video) {
  return video.thumbnailUrl ?? video.videoThumbnails?.at(-1)?.url ?? video.thumbnail ?? ''
}

/**
 * Starts eligible automatic downloads discovered by a subscription refresh.
 * @param {{ id: string, name?: string }} channel
 * @param {object[]} videos
 * @param {'videos' | 'shorts' | 'live'} source
 * @param {(key: string, values?: object) => string} t
 * @param {string | null} refreshOwnerTabId
 */
export async function startAutomaticDownloadsForChannel(channel, videos, source, t, refreshOwnerTabId) {
  if (!supportsYtDlp || !store.getters.getEnableDownloads || !Array.isArray(videos)) {
    return
  }

  const rawRule = parseAutomaticDownloadRules(store.getters.getYtDlpAutomaticDownloadRules)[channel.id]
  if (!rawRule) {
    return
  }

  const rule = normalizeAutomaticDownloadRule(rawRule)
  const customTemplates = parseCustomTemplates()
  const templateOptions = getDownloadTemplateOptions(rule.template, customTemplates)
  if (templateOptions === null) {
    console.warn(`Automatic download template no longer exists for ${channel.id}: ${rule.template}`)
    return
  }

  const existingDownloads = Object.values(store.getters.getYtDlpDownloads)
  const knownVideoIds = new Set(existingDownloads
    .filter(download => !['failed', 'cancelled'].includes(download.status))
    .map(download => download.videoId))

  for (const video of videos) {
    if (!matchesAutomaticDownloadRule(video, source, rule) ||
      scheduledVideoIds.has(video.videoId) || knownVideoIds.has(video.videoId)) {
      continue
    }

    scheduledVideoIds.add(video.videoId)
    const title = video.title || video.videoId
    const automaticMediaType = source === 'shorts'
      ? 'short'
      : source === 'live' || video.liveNow === true ? 'livestream' : 'video'
    let result
    try {
      result = await ytDlp.ytDlpDownload({
        ...templateOptions,
        videoId: video.videoId,
        title,
        thumbnail: getThumbnail(video),
        template: rule.template,
        automatic: true,
        channelId: channel.id,
        automaticMediaType,
        refreshOwnerTabId,
        minDurationSeconds: rule.minDurationSeconds,
        maxDurationSeconds: rule.maxDurationSeconds,
        minFileSizeMb: rule.minFileSizeMb,
        maxFileSizeMb: rule.maxFileSizeMb,
        maxAgeDays: rule.maxAgeDays,
        notification: {
          startedTitle: t('Downloads.Automatic Download Started'),
          startedBody: t('Downloads.Automatic Download Started Body', { title, channel: channel.name || channel.id }),
          completedTitle: t('Downloads.Automatic Download Complete'),
          completedBody: t('Downloads.Download Complete Template', { title }),
          failedTitle: t('Downloads.Automatic Download Failed'),
          failedBody: t('Downloads.Download Failed Template', { title })
        }
      })
    } catch {
      result = null
    }

    if (result == null || 'error' in result) {
      scheduledVideoIds.delete(video.videoId)
      showToastOnAllTabs(t('Downloads.Automatic Download Could Not Start', { title }), 5000, ['fas', 'circle-exclamation'])
    }
  }
}
