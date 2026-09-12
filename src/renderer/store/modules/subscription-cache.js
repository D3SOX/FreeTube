import {
  DBSubscriptionCacheHandlers,
} from '../../../datastores/handlers/index'
import { ensureSubscriptionFeedEntryState } from '../../helpers/subscription-entries'
import { nextSubscriptionSeenTimestamp } from '../../../subscriptionSeenVideos'
import { applySubscriptionSeenVideosToCache } from '../../helpers/subscription-seen-videos'

const MAX_CONCURRENT_CACHE_WRITES = 8

/**
 * NeDB serializes writes internally, and Electron adds an IPC round-trip for
 * each one. Keep a small worker pool instead of creating hundreds of concurrent
 * promises for large subscription profiles.
 * @template T
 * @param {(() => Promise<T>)[]} writes
 * @returns {Promise<T[]>}
 */
async function runSubscriptionCacheWrites(writes) {
  if (writes.length === 0) {
    return []
  }

  /** @type {T[]} */
  const results = new Array(writes.length)
  let nextWriteIndex = 0
  const workerCount = Math.min(MAX_CONCURRENT_CACHE_WRITES, writes.length)

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextWriteIndex < writes.length) {
      const writeIndex = nextWriteIndex++
      results[writeIndex] = await writes[writeIndex]()
    }
  }))

  return results
}

/**
 * Electron datastore payloads are converted to plain JSON before crossing IPC,
 * which serializes dates as ISO strings.
 * @param {Date | number | string} timestamp
 * @returns {Date}
 */
function toDate(timestamp) {
  return timestamp instanceof Date ? timestamp : new Date(timestamp)
}

const state = {
  videoCache: {},
  liveCache: {},
  shortsCache: {},
  postsCache: {},

  subscriptionCacheReady: false,
  subscriptionFeedRefreshInProgress: false,
  subscriptionFeedRefreshTab: null,
  subscriptionFeedRefreshProgress: 0,
  subscriptionFeedLastRefreshTimestamp: null,
  subscriptionFeedNextAutoRefreshTimestamp: null,
  subscriptionShortsLastRefreshTimestamp: null,
  subscriptionShortsNextAutoRefreshTimestamp: null,
  subscriptionLiveLastRefreshTimestamp: null,
  subscriptionLiveNextAutoRefreshTimestamp: null,
  subscriptionPostsLastRefreshTimestamp: null,
  subscriptionPostsNextAutoRefreshTimestamp: null,
}

const getters = {
  getSubscriptionCacheReady: (state) => state.subscriptionCacheReady,
  getSubscriptionFeedRefreshInProgress: (state) => state.subscriptionFeedRefreshInProgress,
  getSubscriptionFeedRefreshTab: (state) => state.subscriptionFeedRefreshTab,
  getSubscriptionFeedRefreshProgress: (state) => state.subscriptionFeedRefreshProgress,
  getSubscriptionFeedLastRefreshTimestamp: (state) => state.subscriptionFeedLastRefreshTimestamp,
  getSubscriptionFeedNextAutoRefreshTimestamp: (state) => state.subscriptionFeedNextAutoRefreshTimestamp,
  getSubscriptionShortsLastRefreshTimestamp: (state) => state.subscriptionShortsLastRefreshTimestamp,
  getSubscriptionShortsNextAutoRefreshTimestamp: (state) => state.subscriptionShortsNextAutoRefreshTimestamp,
  getSubscriptionLiveLastRefreshTimestamp: (state) => state.subscriptionLiveLastRefreshTimestamp,
  getSubscriptionLiveNextAutoRefreshTimestamp: (state) => state.subscriptionLiveNextAutoRefreshTimestamp,
  getSubscriptionPostsLastRefreshTimestamp: (state) => state.subscriptionPostsLastRefreshTimestamp,
  getSubscriptionPostsNextAutoRefreshTimestamp: (state) => state.subscriptionPostsNextAutoRefreshTimestamp,

  getVideoCache: (state, getters) => applySubscriptionSeenVideosToCache(state.videoCache, getters.getSubscriptionSeenVideos),

  getShortsCache: (state, getters) => applySubscriptionSeenVideosToCache(state.shortsCache, getters.getSubscriptionSeenVideos),

  getLiveCache: (state, getters) => applySubscriptionSeenVideosToCache(state.liveCache, getters.getSubscriptionSeenVideos),

  getPostsCache: (state) => state.postsCache,
}

const actions = {
  async grabAllSubscriptions({ commit, dispatch, rootGetters }) {
    try {
      const payload = await DBSubscriptionCacheHandlers.find()

      const videos = {}
      const liveStreams = {}
      const shorts = {}
      const communityPosts = {}

      const toBeRemovedChannelIds = []
      const subscribedChannelIdSet = rootGetters.getSubscribedChannelIdSet

      for (const dataEntry of payload) {
        const channelId = dataEntry._id
        if (!subscribedChannelIdSet.has(channelId)) {
          // Clean up cache data for unsubscribed channels
          toBeRemovedChannelIds.push(channelId)
          // No need to load data for unsubscribed channels
          continue
        }

        let hasData = false

        if (Array.isArray(dataEntry.videos)) {
          videos[channelId] = { videos: dataEntry.videos, timestamp: toDate(dataEntry.videosTimestamp) }
          hasData = true
        }
        if (Array.isArray(dataEntry.liveStreams)) {
          liveStreams[channelId] = { videos: dataEntry.liveStreams, timestamp: toDate(dataEntry.liveStreamsTimestamp) }
          hasData = true
        }
        if (Array.isArray(dataEntry.shorts)) {
          shorts[channelId] = { videos: dataEntry.shorts, timestamp: toDate(dataEntry.shortsTimestamp) }
          hasData = true
        }
        if (Array.isArray(dataEntry.communityPosts)) {
          communityPosts[channelId] = { posts: dataEntry.communityPosts, timestamp: toDate(dataEntry.communityPostsTimestamp) }
          hasData = true
        }

        if (!hasData) { toBeRemovedChannelIds.push(channelId) }
      }

      if (toBeRemovedChannelIds.length > 0) {
        // Delete channels with no data
        dispatch('clearSubscriptionsCacheForManyChannels', toBeRemovedChannelIds)
      }
      commit('setCaches', { videos, liveStreams, shorts, communityPosts })
      commit('setSubscriptionCacheReady', true)
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async updateSubscriptionVideosCacheByChannel({ commit, state, rootGetters }, { channelId, videos, timestamp = new Date() }) {
    const previousCache = state.videoCache[channelId]
    videos = ensureSubscriptionFeedEntryState(
      videos,
      previousCache?.videos,
      'videoId',
      previousCache?.timestamp,
      rootGetters.getHistoryCacheById
    )

    try {
      if (await DBSubscriptionCacheHandlers.updateVideosByChannelId(channelId, videos, timestamp) === false) return false
      commit('updateVideoCacheByChannel', { channelId, entries: videos, timestamp })
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async updateSubscriptionShortsCacheByChannel({ commit }, { channelId, videos, timestamp = new Date() }) {
    try {
      if (await DBSubscriptionCacheHandlers.updateShortsByChannelId(channelId, videos, timestamp) === false) return false
      commit('updateShortsCacheByChannel', { channelId, entries: videos, timestamp })
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async updateSubscriptionShortsCacheWithChannelPageShorts({ commit }, { channelId, videos }) {
    try {
      await DBSubscriptionCacheHandlers.updateShortsWithChannelPageShortsByChannelId(channelId, videos)
      commit('updateShortsCacheWithChannelPageShorts', { channelId, entries: videos })
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async updateSubscriptionLiveCacheByChannel({ commit, state, rootGetters }, { channelId, videos, timestamp = new Date() }) {
    const previousCache = state.liveCache[channelId]
    videos = ensureSubscriptionFeedEntryState(
      videos,
      previousCache?.videos,
      'videoId',
      previousCache?.timestamp,
      rootGetters.getHistoryCacheById
    )

    try {
      if (await DBSubscriptionCacheHandlers.updateLiveStreamsByChannelId(channelId, videos, timestamp) === false) return false
      commit('updateLiveCacheByChannel', { channelId, entries: videos, timestamp })
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async updateSubscriptionPostsCacheByChannel({ commit, state }, { channelId, posts, timestamp = new Date() }) {
    const previousCache = state.postsCache[channelId]
    posts = ensureSubscriptionFeedEntryState(
      posts,
      previousCache?.posts,
      'postId',
      previousCache?.timestamp
    )

    try {
      if (await DBSubscriptionCacheHandlers.updateCommunityPostsByChannelId(channelId, posts, timestamp) === false) return false
      commit('updatePostsCacheByChannel', { channelId, entries: posts, timestamp })
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async markSubscriptionEntriesAsSeen({ commit, dispatch, state, rootGetters }, {
    tab,
    tabs = [tab],
    channelIds = [],
    channelIdsByTab = {}
  }) {
    const cacheConfigs = {
      videos: {
        cache: applySubscriptionSeenVideosToCache(state.videoCache, rootGetters?.getSubscriptionSeenVideos),
        entriesKey: 'videos',
        updateEntries: DBSubscriptionCacheHandlers.updateVideosByChannelId
      },
      shorts: {
        cache: applySubscriptionSeenVideosToCache(state.shortsCache, rootGetters?.getSubscriptionSeenVideos),
        entriesKey: 'videos',
        updateEntries: DBSubscriptionCacheHandlers.updateShortsByChannelId
      },
      live: {
        cache: applySubscriptionSeenVideosToCache(state.liveCache, rootGetters?.getSubscriptionSeenVideos),
        entriesKey: 'videos',
        updateEntries: DBSubscriptionCacheHandlers.updateLiveStreamsByChannelId
      },
      posts: {
        cache: state.postsCache,
        entriesKey: 'posts',
        updateEntries: DBSubscriptionCacheHandlers.updateCommunityPostsByChannelId
      }
    }

    const writes = []
    const seenVideos = []
    const seenAt = nextSubscriptionSeenTimestamp(rootGetters?.getSubscriptionSeenVideos)

    for (const feedTab of tabs) {
      const channelIdSet = new Set(channelIdsByTab[feedTab] ?? channelIds)
      const config = cacheConfigs[feedTab]
      if (config == null) {
        continue
      }

      for (const [channelId, cacheEntry] of Object.entries(config.cache)) {
        if (!channelIdSet.has(channelId)) {
          continue
        }

        const entries = cacheEntry?.[config.entriesKey]
        if (!entries?.some(entry => entry.isNewInSubscriptionFeed === true)) {
          continue
        }

        const seenEntries = entries.map(entry => ({
          ...entry,
          isNewInSubscriptionFeed: false
        }))
        const timestamp = cacheEntry.timestamp

        writes.push(async () => {
          try {
            if (await config.updateEntries(channelId, seenEntries, timestamp) === false) return null
            if (feedTab !== 'posts') {
              seenVideos.push(...entries.filter(entry => entry.isNewInSubscriptionFeed === true)
                .map(entry => ({ videoId: entry.videoId, seenAt, isMembersOnly: entry.isMembersOnly === true })))
            }
            return { tab: feedTab, channelId, timestamp }
          } catch (errMessage) {
            console.error(errMessage)
            return null
          }
        })
      }
    }

    // Updating every successful cache entry in one mutation gives Vue one
    // render, so all cards leave together regardless of feed size.
    commit('markSubscriptionEntriesAsSeenInCache', (await runSubscriptionCacheWrites(writes))
      .filter(cacheEntry => cacheEntry != null))
    if (seenVideos.length > 0) {
      await dispatch('mergeSubscriptionSeenVideos', seenVideos).catch(error => console.error(error))
    }
  },

  async markSubscriptionVideoAsSeen({ commit, dispatch, state, rootGetters }, videoId) {
    const cacheConfigs = [
      {
        cache: applySubscriptionSeenVideosToCache(state.videoCache, rootGetters?.getSubscriptionSeenVideos),
        tab: 'videos',
        updateEntries: DBSubscriptionCacheHandlers.updateVideosByChannelId
      },
      {
        cache: applySubscriptionSeenVideosToCache(state.shortsCache, rootGetters?.getSubscriptionSeenVideos),
        tab: 'shorts',
        updateEntries: DBSubscriptionCacheHandlers.updateShortsByChannelId
      },
      {
        cache: applySubscriptionSeenVideosToCache(state.liveCache, rootGetters?.getSubscriptionSeenVideos),
        tab: 'live',
        updateEntries: DBSubscriptionCacheHandlers.updateLiveStreamsByChannelId
      }
    ]

    const writes = []
    const seenVideos = []
    const seenAt = nextSubscriptionSeenTimestamp(rootGetters?.getSubscriptionSeenVideos)
    for (const { cache, tab, updateEntries } of cacheConfigs) {
      for (const [channelId, cacheEntry] of Object.entries(cache)) {
        const entry = cacheEntry?.videos?.find(video => video.videoId === videoId)
        if (entry?.isNewInSubscriptionFeed !== true) {
          continue
        }

        const seenEntries = cacheEntry.videos.map(video => video.videoId === videoId
          ? { ...video, isNewInSubscriptionFeed: false }
          : video)
        const timestamp = cacheEntry.timestamp

        writes.push(async () => {
          try {
            if (await updateEntries(channelId, seenEntries, timestamp) === false) return
            seenVideos.push({ videoId, seenAt, isMembersOnly: entry.isMembersOnly === true })
            commit('markSubscriptionVideoAsSeenByChannel', { tab, channelId, videoId, timestamp })
          } catch (errMessage) {
            console.error(errMessage)
          }
        })
      }
    }
    await runSubscriptionCacheWrites(writes)
    if (seenVideos.length > 0) {
      await dispatch('mergeSubscriptionSeenVideos', seenVideos).catch(error => console.error(error))
    }
  },

  async markSubscriptionVideoAsUnseen({ dispatch, state, rootGetters }, videoId) {
    const video = [state.videoCache, state.shortsCache, state.liveCache]
      .flatMap(cache => Object.values(cache))
      .flatMap(entry => entry?.videos ?? [])
      .find(video => video.videoId === videoId)
    if (!video) return

    const history = rootGetters.getHistoryCacheById[videoId]
    // Explicitly unset watched status without resetting the playback position,
    // including when the watched threshold is zero.
    if (history) await dispatch('updateHistory', { ...history, isWatched: false })
    const timestamp = nextSubscriptionSeenTimestamp(rootGetters.getSubscriptionSeenVideos)
    await dispatch('mergeSubscriptionSeenVideos', [{
      videoId,
      seenAt: timestamp,
      unseenAt: timestamp,
      isMembersOnly: video.isMembersOnly === true
    }])
  },

  async markSubscriptionPostAsSeen({ commit, state }, postId) {
    const writes = []
    for (const [channelId, cacheEntry] of Object.entries(state.postsCache)) {
      const entry = cacheEntry?.posts?.find(post => post.postId === postId)
      if (entry?.isNewInSubscriptionFeed !== true) {
        continue
      }

      const seenEntries = cacheEntry.posts.map(post => post.postId === postId
        ? { ...post, isNewInSubscriptionFeed: false }
        : post)
      const timestamp = cacheEntry.timestamp

      writes.push(async () => {
        try {
          const applied = await DBSubscriptionCacheHandlers.updateCommunityPostsByChannelId(
            channelId,
            seenEntries,
            timestamp
          )
          if (applied === false) return
          commit('markSubscriptionPostAsSeenByChannel', { channelId, postId, timestamp })
        } catch (errMessage) {
          console.error(errMessage)
        }
      })
    }
    await runSubscriptionCacheWrites(writes)
  },

  async clearSubscriptionsCacheForManyChannels({ commit }, channelIds) {
    try {
      await DBSubscriptionCacheHandlers.deleteMultipleChannels(channelIds)
      commit('clearCachesForManyChannels', channelIds)
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async clearSubscriptionsCache({ commit }) {
    try {
      await DBSubscriptionCacheHandlers.deleteAll()
      commit('clearCaches')
      return true
    } catch (errMessage) {
      console.error(errMessage)
      return false
    }
  },
}

const mutations = {
  markSubscriptionPostAsSeenByChannel(state, { channelId, postId, timestamp }) {
    if (toDate(state.postsCache[channelId]?.timestamp).getTime() !== toDate(timestamp).getTime()) return
    const entry = state.postsCache[channelId]?.posts?.find(post => post.postId === postId)

    if (entry) {
      entry.isNewInSubscriptionFeed = false
    }
  },

  markSubscriptionVideoAsSeenByChannel(state, { tab, channelId, videoId, timestamp }) {
    const cacheEntry = tab === 'videos'
      ? state.videoCache[channelId]
      : tab === 'shorts'
        ? state.shortsCache[channelId]
        : state.liveCache[channelId]
    if (toDate(cacheEntry?.timestamp).getTime() !== toDate(timestamp).getTime()) return
    const entry = cacheEntry?.videos?.find(video => video.videoId === videoId)

    if (entry) {
      entry.isNewInSubscriptionFeed = false
    }
  },

  markSubscriptionEntriesAsSeenInCache(state, cacheEntries) {
    for (const { tab, channelId, timestamp } of cacheEntries) {
      const cache = tab === 'videos'
        ? state.videoCache
        : tab === 'shorts'
          ? state.shortsCache
          : tab === 'live'
            ? state.liveCache
            : state.postsCache
      const cacheEntry = cache[channelId]
      if (toDate(cacheEntry?.timestamp).getTime() !== toDate(timestamp).getTime()) continue
      const entries = tab === 'posts' ? cacheEntry?.posts : cacheEntry?.videos

      entries?.forEach(entry => {
        entry.isNewInSubscriptionFeed = false
      })
    }
  },

  updateVideoCacheByChannel(state, { channelId, entries, timestamp = new Date() }) {
    const existingObject = state.videoCache[channelId]
    if (toDate(existingObject?.timestamp).getTime() > toDate(timestamp).getTime()) return
    const newObject = existingObject ?? { videos: null }
    if (entries != null) { newObject.videos = entries }
    newObject.timestamp = toDate(timestamp)
    state.videoCache[channelId] = newObject
  },
  updateShortsCacheByChannel(state, { channelId, entries, timestamp = new Date() }) {
    const existingObject = state.shortsCache[channelId]
    if (toDate(existingObject?.timestamp).getTime() > toDate(timestamp).getTime()) return
    const newObject = existingObject ?? { videos: null }
    if (entries != null) { newObject.videos = entries }
    newObject.timestamp = toDate(timestamp)
    state.shortsCache[channelId] = newObject
  },
  updateShortsCacheWithChannelPageShorts(state, { channelId, entries }) {
    const cachedObject = state.shortsCache[channelId]

    if (cachedObject && cachedObject.videos.length > 0) {
      cachedObject.videos.forEach(cachedVideo => {
        const channelVideo = entries.find(short => cachedVideo.videoId === short.videoId)

        if (channelVideo) {
          // authorId probably never changes, so we don't need to update that

          cachedVideo.title = channelVideo.title
          cachedVideo.author = channelVideo.author
          cachedVideo.thumbnailUrl = channelVideo.thumbnailUrl ?? cachedVideo.thumbnailUrl

          // as the channel shorts page only has compact view counts for numbers above 1000 e.g. 12k
          // and the RSS feeds include an exact value, we only want to overwrite it when the number is larger than the cached value
          // 12345 vs 12000 => 12345
          // 12345 vs 15000 => 15000

          if (channelVideo.viewCount > cachedVideo.viewCount) {
            cachedVideo.viewCount = channelVideo.viewCount
          }
        }
      })
    }
  },
  updateLiveCacheByChannel(state, { channelId, entries, timestamp = new Date() }) {
    const existingObject = state.liveCache[channelId]
    if (toDate(existingObject?.timestamp).getTime() > toDate(timestamp).getTime()) return
    const newObject = existingObject ?? { videos: null }
    if (entries != null) { newObject.videos = entries }
    newObject.timestamp = toDate(timestamp)
    state.liveCache[channelId] = newObject
  },
  updatePostsCacheByChannel(state, { channelId, entries, timestamp = new Date() }) {
    const existingObject = state.postsCache[channelId]
    if (toDate(existingObject?.timestamp).getTime() > toDate(timestamp).getTime()) return
    const newObject = existingObject ?? { posts: null }
    if (entries != null) { newObject.posts = entries }
    newObject.timestamp = toDate(timestamp)
    state.postsCache[channelId] = newObject
  },

  clearCaches(state) {
    state.videoCache = {}
    state.shortsCache = {}
    state.liveCache = {}
    state.postsCache = {}
  },

  clearCachesForManyChannels(state, channelIds) {
    channelIds.forEach((channelId) => {
      state.videoCache[channelId] = null
      state.liveCache[channelId] = null
      state.shortsCache[channelId] = null
      state.postsCache[channelId] = null
    })
  },

  setCaches(state, { videos, liveStreams, shorts, communityPosts }) {
    state.videoCache = videos
    state.liveCache = liveStreams
    state.shortsCache = shorts
    state.postsCache = communityPosts
  },

  setSubscriptionCacheReady(state, payload) {
    state.subscriptionCacheReady = payload
  },
  setSubscriptionFeedRefreshInProgress(state, payload) {
    state.subscriptionFeedRefreshInProgress = payload
  },
  setSubscriptionFeedRefreshTab(state, payload) {
    state.subscriptionFeedRefreshTab = payload
  },
  setSubscriptionFeedRefreshProgress(state, payload) {
    state.subscriptionFeedRefreshProgress = payload
  },
  setSubscriptionFeedLastRefreshTimestamp(state, payload) {
    state.subscriptionFeedLastRefreshTimestamp = payload
  },
  setSubscriptionFeedNextAutoRefreshTimestamp(state, payload) {
    state.subscriptionFeedNextAutoRefreshTimestamp = payload
  },
  setSubscriptionShortsLastRefreshTimestamp(state, payload) {
    state.subscriptionShortsLastRefreshTimestamp = payload
  },
  setSubscriptionShortsNextAutoRefreshTimestamp(state, payload) {
    state.subscriptionShortsNextAutoRefreshTimestamp = payload
  },
  setSubscriptionLiveLastRefreshTimestamp(state, payload) {
    state.subscriptionLiveLastRefreshTimestamp = payload
  },
  setSubscriptionLiveNextAutoRefreshTimestamp(state, payload) {
    state.subscriptionLiveNextAutoRefreshTimestamp = payload
  },
  setSubscriptionPostsLastRefreshTimestamp(state, payload) {
    state.subscriptionPostsLastRefreshTimestamp = payload
  },
  setSubscriptionPostsNextAutoRefreshTimestamp(state, payload) {
    state.subscriptionPostsNextAutoRefreshTimestamp = payload
  },
}

export default {
  state,
  getters,
  actions,
  mutations
}
