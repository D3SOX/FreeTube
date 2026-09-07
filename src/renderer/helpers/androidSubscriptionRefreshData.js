import { normalizeAutomaticDownloadRule } from './automaticDownloadRules.js'

const FEED_TYPES = ['videos', 'shorts', 'live', 'posts']

export class AndroidSubscriptionRefreshPayloadError extends Error {
  constructor(cause) {
    super('The stored Android subscription refresh payload is invalid', { cause })
    this.name = 'AndroidSubscriptionRefreshPayloadError'
  }
}

export function normalizeAndroidSubscriptionRefreshPayload(normalize, feedType, payload, channelId) {
  try {
    return normalize(feedType, payload, channelId)
  } catch (error) {
    throw new AndroidSubscriptionRefreshPayloadError(error)
  }
}

export async function processAndroidSubscriptionRefreshChannelResult(result, reconcile, acknowledge) {
  try {
    await reconcile(result)
  } catch (error) {
    if (!(error instanceof AndroidSubscriptionRefreshPayloadError)) throw error
  }
  await acknowledge(result.id)
}

/**
 * Prevents an asynchronous refresh-start handler from restoring progress
 * after the matching refresh already finished.
 */
export function createSubscriptionRefreshStartGuard() {
  let generation = 0

  return {
    begin() {
      const startGeneration = ++generation
      return () => generation === startGeneration
    },
    finish() {
      generation++
    }
  }
}

/**
 * Owns the one renderer refresh that may be waiting for or using native work.
 * A start factory is only called after the controller has reserved the slot.
 */
export function createSubscriptionRefreshStartController() {
  let activeStart = null

  return {
    begin(refreshId, createStart) {
      if (activeStart !== null) return null

      activeStart = { refreshId, start: null }
      try {
        activeStart.start = createStart()
        return activeStart.start
      } catch (error) {
        activeStart = null
        throw error
      }
    },
    current(refreshId) {
      return activeStart?.refreshId === refreshId ? activeStart.start : null
    },
    isCurrent(refreshId, start) {
      return activeStart?.refreshId === refreshId && activeStart.start === start
    },
    finish(refreshId) {
      if (activeStart?.refreshId !== refreshId) return null

      const { start } = activeStart
      activeStart = null
      return start
    }
  }
}

/**
 * Builds the renderer-to-native snapshot used by closed-app Android workers.
 * The native side receives channel IDs only, never browser datastore files.
 * @param {{
 *   profiles: object[],
 *   automaticDownloadRules?: Record<string, object>,
 *   closedAppRefreshEnabled: boolean,
 *   intervals: Record<string, string | number>,
 *   hiddenFeedTypes: string[],
 *   instanceUrl: string,
 *   authorization: string | null,
 *   titles: Record<string, string>,
 *   cancelLabel: string
 * }} input
 */
export function createAndroidSubscriptionRefreshConfiguration(input) {
  const automaticChannels = Object.fromEntries(FEED_TYPES.map(feedType => [feedType,
    (input.profiles?.[0]?.subscriptions ?? []).filter(channel => {
      const rawRule = input.automaticDownloadRules?.[channel.id]
      if (!rawRule || feedType === 'posts') return false
      const rule = normalizeAutomaticDownloadRule(rawRule)
      if (feedType === 'shorts') return rule.includeShorts
      if (feedType === 'live') return rule.includeLivestreams
      return rule.includeVideos || rule.includeLivestreams
    }).map(channel => channel.id)
  ]))
  const hiddenFeedTypes = new Set(input.hiddenFeedTypes)
  const intervals = Object.fromEntries(FEED_TYPES.map(feedType => {
    const interval = Number(input.intervals[feedType])
    return [
      feedType,
      input.closedAppRefreshEnabled === false ||
      hiddenFeedTypes.has(feedType) ||
      !Number.isFinite(interval) ||
      interval <= 0
        ? 0
        : Math.floor(interval)
    ]
  }))

  const profiles = Array.isArray(input.profiles)
    ? input.profiles.flatMap(profile => {
        if (typeof profile?._id !== 'string' || !Array.isArray(profile.subscriptions)) return []

        const channels = Object.fromEntries(FEED_TYPES.map(feedType => {
          const channelIds = profile.subscriptions
            .filter(channel => (
              typeof channel?.id === 'string' &&
            channel.id.length > 0 &&
            (!Array.isArray(channel.feedTypes) || channel.feedTypes.includes(feedType))
            ))
            .map(channel => channel.id)
          return [feedType, [...new Set([...channelIds, ...automaticChannels[feedType]])]]
        }))
        return [{ id: profile._id, channels }]
      })
    : []

  return {
    instanceUrl: input.instanceUrl,
    authorization: input.authorization,
    intervals,
    profiles,
    titles: input.titles,
    cancelLabel: input.cancelLabel
  }
}
