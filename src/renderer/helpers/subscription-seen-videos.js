import { parseSubscriptionSeenVideos, mergeSubscriptionSeenVideos } from '../../subscriptionSeenVideos.js'
import { isHistoryEntryWatched } from '../../history.js'

export function applySubscriptionSeenVideosToCache(cache, seenVideos) {
  const byId = new Map(mergeSubscriptionSeenVideos([], seenVideos).map(entry => [entry.videoId, entry]))
  if (byId.size === 0) return cache

  return Object.fromEntries(Object.entries(cache).map(([channelId, cached]) => {
    if (!cached?.videos) return [channelId, cached]
    const videos = cached.videos.map(video => {
      const seen = byId.get(video.videoId)
      if (!seen) return video
      if (seen.unseenAt >= seen.seenAt) {
        return video.isNewInSubscriptionFeed ? video : { ...video, isNewInSubscriptionFeed: true }
      }
      // A members-only upload becoming public is new content again.
      if (!video.isNewInSubscriptionFeed ||
          (seen.isMembersOnly && video.isMembersOnly === false)) return video
      return { ...video, isNewInSubscriptionFeed: false }
    })
    return [channelId, videos.every((video, index) => video === cached.videos[index])
      ? cached
      : { ...cached, videos }]
  }))
}

export async function syncSubscriptionSeenVideos(client, store) {
  const remote = await client.getSeenVideos()
  await store.dispatch('mergeSubscriptionSeenVideos', remote)
  const merged = parseSubscriptionSeenVideos(store.state.settings.subscriptionSeenVideos)
  const unseenById = new Map(merged.filter(entry => entry.unseenAt >= entry.seenAt)
    .map(entry => [entry.videoId, entry.unseenAt]))
  if (unseenById.size > 0) {
    // History sync runs first. An older completed record must not undo the
    // reverse action, while watching again after it still counts as watched.
    for (const history of store.state.history.historyCacheSorted) {
      if (isHistoryEntryWatched(history) &&
          unseenById.get(history.videoId) > (history.timeWatched ?? 0)) {
        await store.dispatch('updateHistory', { ...history, isWatched: false })
      }
    }
    for (const history of await client.getWatchHistory() ?? []) {
      if (history.metadata.watched_state === 'completed' &&
          unseenById.get(history.video.id) > (history.metadata.added_date ?? 0)) {
        await client.putWatchHistory({
          ...history,
          metadata: {
            ...history.metadata,
            watched_state: history.metadata.position_millis > 0 ? 'watching' : 'planned'
          }
        })
      }
    }
  }
  await client.putSeenVideos(merged)
  return merged.length
}
