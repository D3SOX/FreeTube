import { parseSubscriptionSeenVideos, mergeSubscriptionSeenVideos } from '../../subscriptionSeenVideos.js'

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
  await client.putSeenVideos(merged)
  return merged.length
}
