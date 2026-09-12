import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import Datastore from '@seald-io/nedb'
import { ensureSubscriptionFeedEntryState } from '../../src/renderer/helpers/subscription-entries.js'

// The handlers module imports the platform datastore singleton through webpack.
// Run the actual cache class with an isolated real NeDB for each interleaving.
const source = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')
const start = source.indexOf('class SubscriptionCache {')
const cacheSource = source.slice(start, source.indexOf('\nclass ', start + 1))
const storeSource = await readFile(new URL('../../src/renderer/store/modules/subscription-cache.js', import.meta.url), 'utf8')
const moduleSource = storeSource.slice(storeSource.indexOf('const MAX_CONCURRENT_CACHE_WRITES'))
  .replace('export default', 'globalThis.cacheModule =')

for (const enrichmentFirst of [false, true]) {
  test(`Shorts refresh preserves new entries when enrichment starts ${enrichmentFirst ? 'first' : 'second'}`, async () => {
    const db = { subscriptionCache: new Datastore({ inMemoryOnly: true }) }
    const Cache = vm.runInNewContext(`${cacheSource}\nSubscriptionCache`, { db })
    await Cache.updateShortsByChannelId('channel', [{ videoId: 'old', title: 'Old title' }], new Date(1000))

    const refresh = () => Cache.updateShortsByChannelId('channel', [
      { videoId: 'old', title: 'Refreshed title' },
      { videoId: 'new', title: 'New title' },
    ], new Date(2000))
    const enrich = () => Cache.updateShortsWithChannelPageShortsByChannelId('channel', [
      { videoId: 'old', title: 'Enriched title', viewCount: 2000 },
    ])
    const first = enrichmentFirst ? enrich() : refresh()
    // Let the first read enter NeDB's queue before starting the other writer.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.all([first, enrichmentFirst ? refresh() : enrich()])

    const result = await db.subscriptionCache.findOneAsync({ _id: 'channel' })
    assert.deepEqual(result.shorts.map(video => video.videoId), ['old', 'new'])
    assert.equal(new Date(result.shortsTimestamp).getTime(), 2000)
    assert.equal(result.shorts[0].title, enrichmentFirst ? 'Refreshed title' : 'Enriched title')
  })
}

for (const delayDatabaseReply of [false, true]) {
  test(`a premiere update cannot overwrite a full refresh when its database ${delayDatabaseReply ? 'reply' : 'write'} arrives late`, async () => {
    const db = { subscriptionCache: new Datastore({ inMemoryOnly: true }) }
    const Cache = vm.runInNewContext(`${cacheSource}\nSubscriptionCache`, { db })
    const cachedVideos = [{ videoId: 'premiere', viewCount: 1000, isNewInSubscriptionFeed: false }]
    await Cache.updateVideosByChannelId('channel', cachedVideos, new Date(1000))

    let releasePremiere
    let signalWaiting
    const waiting = new Promise(resolve => { signalWaiting = resolve })
    const resume = new Promise(resolve => { releasePremiere = resolve })
    const context = vm.createContext({
      console,
      ensureSubscriptionFeedEntryState,
      DBSubscriptionCacheHandlers: {
        async updateVideosByChannelId(channelId, videos, timestamp) {
          if (timestamp.getTime() !== 1000) {
            return Cache.updateVideosByChannelId(channelId, videos, timestamp)
          }
          // Model an IPC acknowledgement delayed until after a newer refresh,
          // and the inverse order where the old write itself reaches NeDB late.
          if (delayDatabaseReply) {
            const result = await Cache.updateVideosByChannelId(channelId, videos, timestamp)
            signalWaiting()
            await resume
            return result
          }
          signalWaiting()
          await resume
          return Cache.updateVideosByChannelId(channelId, videos, timestamp)
        }
      }
    })
    vm.runInContext(moduleSource, context)
    const { actions, mutations, state } = context.cacheModule
    state.videoCache.channel = { videos: cachedVideos, timestamp: new Date(1000) }
    const actionContext = {
      state,
      rootGetters: { getHistoryCacheById: {} },
      commit(type, payload) { mutations[type](state, payload) }
    }
    const premiereUpdate = actions.updateSubscriptionVideosCacheByChannel(actionContext, {
      channelId: 'channel',
      videos: [{ ...cachedVideos[0], viewCount: 2500 }],
      timestamp: new Date(1000)
    })
    await waiting

    const refreshedVideos = [
      { videoId: 'premiere', viewCount: 3000, isNewInSubscriptionFeed: false },
      { videoId: 'new-video', isNewInSubscriptionFeed: true }
    ]
    await actions.updateSubscriptionVideosCacheByChannel(actionContext, {
      channelId: 'channel', videos: refreshedVideos, timestamp: new Date(2000)
    })
    releasePremiere()
    await premiereUpdate

    assert.equal(state.videoCache.channel.videos, refreshedVideos)
    assert.equal(state.videoCache.channel.timestamp.getTime(), 2000)
    const persisted = await db.subscriptionCache.findOneAsync({ _id: 'channel' })
    assert.deepEqual(persisted.videos, refreshedVideos)
    assert.equal(new Date(persisted.videosTimestamp).getTime(), 2000)
  })
}

test('loading persisted video caches supplies feed markers without changing known seen state or embedded videos', async () => {
  const entries = [
    { videoId: 'unmarked' },
    { videoId: 'seen', isNewInSubscriptionFeed: false },
    { videoId: 'new', isNewInSubscriptionFeed: true },
  ]
  const embedded = { videoId: 'embedded' }
  const context = vm.createContext({
    console,
    DBSubscriptionCacheHandlers: {
      find: async () => [{
        _id: 'channel',
        videos: entries,
        shorts: entries,
        liveStreams: entries,
        communityPosts: [{ postId: 'post', postContent: { type: 'video', content: embedded } }],
      }],
    },
  })
  vm.runInContext(moduleSource, context)
  const { actions, mutations, state } = context.cacheModule
  await actions.grabAllSubscriptions({
    rootGetters: { getSubscribedChannelIdSet: new Set(['channel']) },
    commit: (type, payload) => mutations[type](state, payload),
  })
  for (const key of ['videoCache', 'shortsCache', 'liveCache']) {
    assert.deepEqual(structuredClone(state[key].channel.videos), [
      { videoId: 'unmarked', isNewInSubscriptionFeed: false }, entries[1], entries[2],
    ])
  }
  assert.equal(state.postsCache.channel.posts[0].postContent.content.isNewInSubscriptionFeed, undefined)
})
