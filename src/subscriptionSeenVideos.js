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

export function mergeSubscriptionSeenVideos(local, remote) {
  const byId = new Map()
  for (const entry of [...parseSubscriptionSeenVideos(local), ...parseSubscriptionSeenVideos(remote)]) {
    const previous = byId.get(entry.videoId)
    // A stale device can still mark the members-only version after another
    // device has seen the public upload. Keep the public mark in either order.
    byId.set(entry.videoId, {
      videoId: entry.videoId,
      seenAt: Math.max(previous?.seenAt ?? 0, entry.seenAt),
      isMembersOnly: entry.isMembersOnly === true && previous?.isMembersOnly !== false,
    })
  }
  return [...byId.values()].sort((a, b) => a.videoId < b.videoId ? -1 : 1)
}
