import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import Datastore from '@seald-io/nedb'
import * as seenSync from '../../src/renderer/helpers/subscription-seen-videos.js'
import * as seenData from '../../src/subscriptionSeenVideos.js'
import { EncryptedSyncAdapter, createEmptySyncDocument } from '../../src/renderer/helpers/sync-server-privacy.js'

const source = await readFile(new URL('../../src/renderer/store/modules/subscription-cache.js', import.meta.url), 'utf8')
const seenVideos = { ...seenSync, ...seenData }

async function settingsFixture(history = []) {
  const baseSource = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')
  const db = {
    settings: new Datastore({ inMemoryOnly: true }),
    history: new Datastore({ inMemoryOnly: true }),
  }
  if (history.length > 0) await db.history.insertAsync(history)
  const Settings = vm.runInNewContext(baseSource.slice(baseSource.indexOf('class Settings {'),
    baseSource.indexOf('\nclass History {')) + '\nSettings', { db, ...seenVideos })
  return { db, Settings }
}

function cacheFixture(applied = true, logger = console) {
  const recorded = []
  const context = vm.createContext({
    console: logger,
    ...seenVideos,
    DBSubscriptionCacheHandlers: {
      updateVideosByChannelId: async () => applied,
      updateShortsByChannelId: async () => applied,
      updateLiveStreamsByChannelId: async () => applied,
      updateCommunityPostsByChannelId: async () => applied,
    },
  })
  vm.runInContext(source.replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
    .replace('export default', 'globalThis.module ='), context)
  const { state, actions, mutations } = context.module
  for (const cache of ['videoCache', 'shortsCache', 'liveCache']) {
    state[cache].channel = {
      videos: [{ videoId: cache, isNewInSubscriptionFeed: true }],
      timestamp: new Date(1000),
    }
  }
  state.postsCache.channel = {
    posts: [{ postId: 'post', isNewInSubscriptionFeed: true }],
    timestamp: new Date(1000),
  }
  return {
    state,
    actions,
    getters: context.module.getters,
    recorded,
    context: {
      state,
      commit: (type, payload) => mutations[type](state, payload),
      dispatch: async (type, payload) => recorded.push([type, structuredClone(payload)]),
    },
  }
}

test('marking a subscription video as seen records it for history sync without watch history', async () => {
  const fixture = cacheFixture()
  await fixture.actions.markSubscriptionVideoAsSeen(fixture.context, 'videoCache')
  assert.equal(fixture.recorded.length, 1)
  assert.equal(fixture.recorded[0][0], 'mergeSubscriptionSeenVideos')
  assert.equal(fixture.recorded[0][1][0].videoId, 'videoCache')
  assert.ok(Number.isFinite(fixture.recorded[0][1][0].seenAt))
})

test('rejected cache writes do not record seen videos', async () => {
  const fixture = cacheFixture(false)
  await fixture.actions.markSubscriptionVideoAsSeen(fixture.context, 'videoCache')
  await fixture.actions.markSubscriptionEntriesAsSeen(fixture.context, {
    tabs: ['videos', 'shorts', 'live'], channelIds: ['channel'],
  })
  assert.deepEqual(fixture.recorded, [])
})

test('encrypted sync merges marks from two devices without changing history', async () => {
  const document = createEmptySyncDocument()
  document.history = [{ video: { id: 'watched' }, metadata: { position_millis: 42000 } }]
  const client = new EncryptedSyncAdapter(document)
  const device = entries => ({
    state: { settings: { subscriptionSeenVideos: JSON.stringify(entries) } },
    async dispatch(action, remote) {
      assert.equal(action, 'mergeSubscriptionSeenVideos')
      this.state.settings.subscriptionSeenVideos = JSON.stringify(seenVideos.mergeSubscriptionSeenVideos(
        this.state.settings.subscriptionSeenVideos, remote
      ))
    },
  })
  const first = device([{ videoId: 'first', seenAt: 1000 }])
  const second = device([{ videoId: 'second', seenAt: 2000 }])
  await seenVideos.syncSubscriptionSeenVideos(client, first)
  await seenVideos.syncSubscriptionSeenVideos(client, second)
  await seenVideos.syncSubscriptionSeenVideos(client, first)
  assert.equal(first.state.settings.subscriptionSeenVideos, second.state.settings.subscriptionSeenVideos)
  assert.deepEqual(document.seenVideos.map(entry => entry.videoId), ['first', 'second'])
  assert.deepEqual(document.history, [{ video: { id: 'watched' }, metadata: { position_millis: 42000 } }])
})

test('downloaded marks hide current and subsequently fetched videos in every video cache', () => {
  const fixture = cacheFixture()
  const marks = JSON.stringify(['videoCache', 'shortsCache', 'liveCache', 'later'].map(videoId => ({ videoId, seenAt: 1000 })))
  for (const getter of ['getVideoCache', 'getShortsCache', 'getLiveCache']) {
    const cache = fixture.getters[getter](fixture.state, { getSubscriptionSeenVideos: marks })
    assert.equal(cache.channel.videos[0].isNewInSubscriptionFeed, false)
  }
  fixture.state.videoCache.channel.videos = [{ videoId: 'later', isNewInSubscriptionFeed: true }]
  assert.equal(fixture.getters.getVideoCache(fixture.state, { getSubscriptionSeenVideos: marks })
    .channel.videos[0].isNewInSubscriptionFeed, false)
  assert.equal(fixture.state.postsCache.channel.posts[0].isNewInSubscriptionFeed, true)
})

test('members-only videos can become new when public, then be marked seen again', () => {
  const cache = { channel: { videos: [{ videoId: 'video', isMembersOnly: false, isNewInSubscriptionFeed: true }] } }
  const oldMark = [{ videoId: 'video', seenAt: 1000, isMembersOnly: true }]
  assert.equal(seenVideos.applySubscriptionSeenVideosToCache(cache, oldMark).channel.videos[0].isNewInSubscriptionFeed, true)
  const merged = seenVideos.mergeSubscriptionSeenVideos([{ videoId: 'video', seenAt: 2000 }], oldMark)
  assert.equal(seenVideos.applySubscriptionSeenVideosToCache(cache, merged).channel.videos[0].isNewInSubscriptionFeed, false)
})

test('a later mark from a stale members-only feed cannot make a seen public video new again', () => {
  const publicMark = [{ videoId: 'video', seenAt: 1000, isMembersOnly: false }]
  const staleMembersMark = [{ videoId: 'video', seenAt: 2000, isMembersOnly: true }]
  const cache = { channel: { videos: [{ videoId: 'video', isMembersOnly: false, isNewInSubscriptionFeed: true }] } }
  for (const [local, remote] of [[publicMark, staleMembersMark], [staleMembersMark, publicMark]]) {
    const merged = seenVideos.mergeSubscriptionSeenVideos(local, remote)
    assert.equal(seenVideos.applySubscriptionSeenVideosToCache(cache, merged).channel.videos[0].isNewInSubscriptionFeed, false)
    assert.deepEqual(merged, [{ videoId: 'video', seenAt: 2000, isMembersOnly: false }])
  }
})

test('malformed records cannot replace valid marks', () => {
  assert.deepEqual(seenVideos.mergeSubscriptionSeenVideos('invalid', [
    null, {}, { videoId: 'video', seenAt: 'bad' }, { videoId: 'video', seenAt: 1000 },
  ]), [{ videoId: 'video', seenAt: 1000, isMembersOnly: false }])
})

test('two windows persist both marks and delayed replies cannot overwrite newer marks', async () => {
  const settingsSource = await readFile(new URL('../../src/renderer/store/modules/settings.js', import.meta.url), 'utf8')
  const { db, Settings } = await settingsFixture()
  let releaseReply
  const delayedReply = new Promise(resolve => { releaseReply = resolve })
  const makeWindow = (delayReply = false) => {
    const context = vm.createContext({
      ...seenVideos,
      ANDROID_PROXY_SETTING_KEYS: [],
      DBSettingHandlers: {
        async mergeSeenVideos(entries) {
          const saved = await Settings.mergeSeenVideos(entries)
          if (delayReply) await delayedReply
          return saved
        },
      },
    })
    vm.runInContext(settingsSource.slice(
      settingsSource.indexOf('const customActions ='),
      settingsSource.indexOf('  recordSyncSettingEdit:'),
    ) + '\n}\nglobalThis.merge = customActions.mergeSubscriptionSeenVideos', context)
    const state = { subscriptionSeenVideos: '[]' }
    return {
      state,
      mark: entry => context.merge({
        state,
        rootGetters: { getHistoryCacheById: {} },
        commit(type, value) { state.subscriptionSeenVideos = value },
      }, [entry]),
    }
  }
  const first = makeWindow(true)
  const second = makeWindow()
  const firstMark = first.mark({ videoId: 'first', seenAt: 1000 })
  await second.mark({ videoId: 'second', seenAt: 2000 })
  const saved = await db.settings.findOneAsync({ _id: 'subscriptionSeenVideos' })
  assert.deepEqual(JSON.parse(saved.value).map(entry => entry.videoId), ['first', 'second'])
  // Model the second write's broadcast reaching the first window before its
  // own older IPC reply. Applying that reply must retain the second mark.
  first.state.subscriptionSeenVideos = saved.value
  releaseReply()
  await firstMark
  assert.equal(first.state.subscriptionSeenVideos, saved.value)
  assert.equal(second.state.subscriptionSeenVideos, saved.value)
})

test('mark all records videos, Shorts and live streams, excluding community posts', async () => {
  const fixture = cacheFixture()
  await fixture.actions.markSubscriptionEntriesAsSeen(fixture.context, {
    tabs: ['videos', 'shorts', 'live', 'posts'], channelIds: ['channel'],
  })
  assert.equal(fixture.recorded.length, 1)
  assert.equal(fixture.recorded[0][0], 'mergeSubscriptionSeenVideos')
  assert.deepEqual(fixture.recorded[0][1].map(entry => entry.videoId).sort(),
    ['liveCache', 'shortsCache', 'videoCache'])
})


test('seen mark retention keeps the newest 10,000 videos with deterministic timestamp ties', () => {
  const marks = Array.from({ length: 10002 }, (_, index) => ({
    videoId: `video-${String(index).padStart(5, '0')}`,
    seenAt: Math.max(1, index),
  }))
  const merged = seenVideos.mergeSubscriptionSeenVideos(marks.slice(0, 5000), marks.slice(5000))
  assert.equal(merged.length, 10000)
  assert.equal(merged[0].videoId, 'video-00002')
  assert.equal(merged.at(-1).videoId, 'video-10001')
  const tied = marks.map(mark => ({ ...mark, seenAt: 1000 }))
  assert.deepEqual(seenVideos.mergeSubscriptionSeenVideos(tied, []),
    seenVideos.mergeSubscriptionSeenVideos([], tied.toReversed()))
  assert.equal(seenVideos.mergeSubscriptionSeenVideos(tied, []).length, 10000)
})

test('watched marks are removed before applying the cap while partial and live entries remain', () => {
  const marks = Array.from({ length: 10000 }, (_, index) => ({ videoId: `watched-${index}`, seenAt: 2000 }))
  const history = Object.fromEntries(marks.map(mark => [mark.videoId, { isWatched: true }]))
  const retained = ['unwatched', 'partial', 'live', 'upcoming']
    .map(videoId => ({ videoId, seenAt: 1000 }))
  Object.assign(history, {
    partial: { isWatched: false, watchProgress: 90, lengthSeconds: 100 },
    live: { isWatched: true, isLive: true },
    upcoming: { isWatched: true, isUpcoming: true },
    legacyWatched: { watchProgress: 100, lengthSeconds: 100 },
  })
  const merged = seenVideos.mergeSubscriptionSeenVideos(
    [...marks, { videoId: 'legacyWatched', seenAt: 3000 }], retained, history)
  assert.deepEqual(merged.map(mark => mark.videoId), ['live', 'partial', 'unwatched', 'upcoming'])
})

test('persistence prunes watched marks from saved and stale incoming data before capping', async () => {
  const { db, Settings } = await settingsFixture([{ videoId: 'watched', isWatched: true }])
  const marks = Array.from({ length: 10001 }, (_, index) => ({ videoId: `video-${index}`, seenAt: index + 1 }))
  await db.settings.insertAsync({ _id: 'subscriptionSeenVideos', value: JSON.stringify([
    ...marks, { videoId: 'watched', seenAt: 20000 },
  ]) })
  const saved = await Settings.mergeSeenVideos([{ videoId: 'watched', seenAt: 30000 }])
  const retained = JSON.parse(saved)
  assert.equal(retained.length, 10000)
  assert.ok(!retained.some(mark => ['watched', 'video-0'].includes(mark.videoId)))
  assert.equal((await db.settings.findOneAsync({ _id: 'subscriptionSeenVideos' })).value, saved)
})

test('sync uploads the retained local set without restoring pruned remote marks', async () => {
  const remote = [{ videoId: 'watched', seenAt: 3000 }, { videoId: 'keep', seenAt: 2000 }]
  const retained = [{ videoId: 'keep', seenAt: 2000, isMembersOnly: false }]
  const store = {
    state: { settings: { subscriptionSeenVideos: JSON.stringify(remote) } },
    async dispatch() { this.state.settings.subscriptionSeenVideos = JSON.stringify(retained) },
  }
  let uploaded
  await seenVideos.syncSubscriptionSeenVideos({
    getSeenVideos: async () => remote,
    putSeenVideos: async entries => { uploaded = entries },
  }, store)
  assert.deepEqual(uploaded, retained)
})

test('cache filtering uses the same capped mark set as persistence and sync', () => {
  const marks = Array.from({ length: 10001 }, (_, index) => ({ videoId: `video-${index}`, seenAt: index + 1 }))
  const cache = { channel: { videos: [
    { videoId: 'video-0', isNewInSubscriptionFeed: true },
    { videoId: 'video-10000', isNewInSubscriptionFeed: true },
  ] } }
  const result = seenVideos.applySubscriptionSeenVideosToCache(cache, marks)
  assert.equal(result.channel.videos[0].isNewInSubscriptionFeed, true)
  assert.equal(result.channel.videos[1].isNewInSubscriptionFeed, false)
})


test('seen mark persistence uses the history index instead of scanning unrelated history', async () => {
  const { db, Settings } = await settingsFixture([
    { videoId: 'watched', isWatched: true },
    { videoId: 'unrelated', isWatched: true },
  ])
  await db.history.ensureIndexAsync({ fieldName: 'videoId' })
  db.history.getAllData = () => { throw new Error('Unexpected full-history scan') }
  const saved = await Settings.mergeSeenVideos([
    { videoId: 'watched', seenAt: 2000 }, { videoId: 'keep', seenAt: 1000 },
  ])
  assert.deepEqual(JSON.parse(saved).map(mark => mark.videoId), ['keep'])
})

test('individual and bulk UI marking handle failed seen-mark persistence', async () => {
  const failure = new Error('Seen-mark persistence failed')
  const logged = []
  for (const bulk of [false, true]) {
    const fixture = cacheFixture(true, { error: error => logged.push(error) })
    fixture.context.dispatch = async () => { throw failure }
    await assert.doesNotReject(() => bulk
      ? fixture.actions.markSubscriptionEntriesAsSeen(fixture.context, {
        tabs: ['videos', 'shorts', 'live'], channelIds: ['channel'],
      })
      : fixture.actions.markSubscriptionVideoAsSeen(fixture.context, 'videoCache'))
  }
  assert.deepEqual(logged, [failure, failure])
})

test('failed seen-mark persistence stops sync before uploading stale state', async () => {
  const failure = new Error('Seen-mark persistence failed')
  let uploads = 0
  await assert.rejects(seenVideos.syncSubscriptionSeenVideos({
    getSeenVideos: async () => [],
    putSeenVideos: async () => { uploads++ },
  }, {
    state: { settings: { subscriptionSeenVideos: '[]' } },
    dispatch: async () => { throw failure },
  }), failure)
  assert.equal(uploads, 0)
})

for (const cache of ['videoCache', 'shortsCache', 'liveCache']) {
  test(`marking ${cache} unseen preserves watch progress and restores a seen video`, async () => {
    const fixture = cacheFixture()
    fixture.state[cache].channel.videos[0].isNewInSubscriptionFeed = false
    const history = { videoId: cache, isWatched: true, watchProgress: 123, lengthSeconds: 200 }
    fixture.context.rootGetters = { getHistoryCacheById: { [cache]: history }, getSubscriptionSeenVideos: [] }
    await fixture.actions.markSubscriptionVideoAsUnseen(fixture.context, cache)
    assert.equal(fixture.recorded[0][0], 'updateHistory')
    assert.deepEqual(fixture.recorded[0][1], { ...history, isWatched: false })
    const [action, marks] = fixture.recorded[1]
    assert.equal(action, 'mergeSubscriptionSeenVideos')
    const restored = seenVideos.applySubscriptionSeenVideosToCache(fixture.state[cache], marks)
    assert.equal(restored.channel.videos[0].isNewInSubscriptionFeed, true)
  })
}

test('unseen marks survive stale sync, cache refresh and a later mark as seen', () => {
  const cache = { channel: { videos: [{ videoId: 'video', isNewInSubscriptionFeed: false }] } }
  const old = { videoId: 'video', seenAt: 1000 }
  const unseen = { videoId: 'video', seenAt: 1000, unseenAt: 2000 }
  for (const [local, remote] of [[[old], [unseen]], [[unseen], [old]]]) {
    const marks = seenVideos.mergeSubscriptionSeenVideos(local, remote)
    assert.equal(seenVideos.applySubscriptionSeenVideosToCache(cache, marks).channel.videos[0].isNewInSubscriptionFeed, true)
    const seen = seenVideos.mergeSubscriptionSeenVideos(marks, [{ videoId: 'video', seenAt: 3000 }])
    assert.equal(seenVideos.applySubscriptionSeenVideosToCache(cache, seen).channel.videos[0].isNewInSubscriptionFeed, false)
  }
})

for (const bulk of [false, true]) {
  test(`${bulk ? 'bulk' : 'individual'} marking handles unseen overrides on previously seen caches`, async () => {
    const fixture = cacheFixture()
    fixture.state.videoCache.channel.videos[0].isNewInSubscriptionFeed = false
    const timestamp = Date.now() + 1000
    const unseen = [{ videoId: 'videoCache', seenAt: timestamp, unseenAt: timestamp }]
    fixture.context.rootGetters = { getSubscriptionSeenVideos: unseen }
    if (bulk) {
      await fixture.actions.markSubscriptionEntriesAsSeen(fixture.context, { tab: 'videos', channelIds: ['channel'] })
    } else {
      await fixture.actions.markSubscriptionVideoAsSeen(fixture.context, 'videoCache')
    }
    assert.equal(fixture.recorded.length, 1)
    const marks = seenVideos.mergeSubscriptionSeenVideos(unseen, fixture.recorded[0][1])
    assert.ok(marks[0].seenAt > timestamp)
    assert.equal(seenVideos.applySubscriptionSeenVideosToCache(fixture.state.videoCache, marks).channel.videos[0].isNewInSubscriptionFeed, false)
  })
}

test('unseen marks persist without creating history for an unwatched video', async () => {
  const fixture = cacheFixture()
  fixture.context.rootGetters = { getHistoryCacheById: {}, getSubscriptionSeenVideos: [] }
  await fixture.actions.markSubscriptionVideoAsUnseen(fixture.context, 'videoCache')
  assert.equal(fixture.recorded.length, 1)
  assert.equal(fixture.recorded[0][0], 'mergeSubscriptionSeenVideos')
  const { Settings } = await settingsFixture()
  await Settings.mergeSeenVideos(fixture.recorded[0][1])
  const saved = await Settings.mergeSeenVideos([{ videoId: 'videoCache', seenAt: 1 }])
  assert.equal(seenVideos.applySubscriptionSeenVideosToCache({ channel: {
    videos: [{ videoId: 'videoCache', isNewInSubscriptionFeed: false }],
  } }, saved).channel.videos[0].isNewInSubscriptionFeed, true)
})
