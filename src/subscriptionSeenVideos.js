import { isHistoryEntryWatched } from './history.js'

export const MAX_SUBSCRIPTION_SEEN_VIDEOS = 10000

export function parseSubscriptionSeenVideos(value) {
  try {
    const entries = typeof value === 'string' ? JSON.parse(value) : value
    if (!Array.isArray(entries)) return []
    return entries.filter(entry => (
      typeof entry?.videoId === 'string' && entry.videoId.length > 0 &&
      Number.isFinite(entry.seenAt) && entry.seenAt > 0
    ))
  } catch {
    return []
  }
}

export function mergeSubscriptionSeenVideos(local, remote, historyById = {}) {
  const byId = new Map()
  for (const entry of [...parseSubscriptionSeenVideos(local), ...parseSubscriptionSeenVideos(remote)]) {
    // Watch history already excludes these videos from the new feed and badges.
    if (isHistoryEntryWatched(historyById[entry.videoId])) continue
    const previous = byId.get(entry.videoId)
    // A stale device can still mark the members-only version after another
    // device has seen the public upload. Keep the public mark in either order.
    byId.set(entry.videoId, {
      videoId: entry.videoId,
      seenAt: Math.max(previous?.seenAt ?? 0, entry.seenAt),
      isMembersOnly: entry.isMembersOnly === true && previous?.isMembersOnly !== false,
    })
  }
  const byVideoId = (a, b) => a.videoId < b.videoId ? -1 : a.videoId > b.videoId ? 1 : 0
  // Evict oldest marks only after removing watched videos. Break timestamp ties
  // by ID so devices retain the same set regardless of merge order.
  return [...byId.values()]
    .sort((a, b) => b.seenAt - a.seenAt || byVideoId(a, b))
    .slice(0, MAX_SUBSCRIPTION_SEEN_VIDEOS)
    .sort(byVideoId)
}
