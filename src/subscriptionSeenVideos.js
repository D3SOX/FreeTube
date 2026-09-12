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
    // Retain the reverse action so an older synced seen mark cannot undo it.
    const unseenAt = Math.max(previous?.unseenAt ?? 0,
      Number.isFinite(entry.unseenAt) && entry.unseenAt > 0 ? entry.unseenAt : 0)
    byId.set(entry.videoId, {
      videoId: entry.videoId,
      seenAt: Math.max(previous?.seenAt ?? 0, entry.seenAt),
      ...(unseenAt > 0 ? { unseenAt } : {}),
      // Keep public marks even when a stale device saw the members-only upload.
      isMembersOnly: entry.isMembersOnly === true && previous?.isMembersOnly !== false,
    })
  }
  const byVideoId = (a, b) => a.videoId < b.videoId ? -1 : a.videoId > b.videoId ? 1 : 0
  // Evict oldest marks only after removing watched videos. Break timestamp ties
  // by ID so devices retain the same set regardless of merge order.
  return [...byId.values()]
    .sort((a, b) => Math.max(b.seenAt, b.unseenAt ?? 0) - Math.max(a.seenAt, a.unseenAt ?? 0) || byVideoId(a, b))
    .slice(0, MAX_SUBSCRIPTION_SEEN_VIDEOS)
    .sort(byVideoId)
}

// Keep consecutive menu actions ordered even within the same millisecond.
export function nextSubscriptionSeenTimestamp(marks) {
  return parseSubscriptionSeenVideos(marks).reduce((timestamp, entry) => (
    Math.max(timestamp, entry.seenAt + 1, Number.isFinite(entry.unseenAt) ? entry.unseenAt + 1 : 0)
  ), Date.now())
}
