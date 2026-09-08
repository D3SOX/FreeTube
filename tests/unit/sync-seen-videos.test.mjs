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

function cacheFixture(applied = true) {
  const recorded = []
  const context = vm.createContext({
    console,
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
  const baseSource = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')
  const db = { settings: new Datastore({ inMemoryOnly: true }) }
  const Settings = vm.runInNewContext(baseSource.slice(baseSource.indexOf('class Settings {'),
    baseSource.indexOf('\nclass History {')) + '\nSettings', { db, ...seenVideos })
  let releaseReply
  const delayedReply = new Promise(resolve => { releaseReply = resolve })
  const makeWindow = (delayReply = false) => {
    const context = vm.createContext({
      ...seenVideos,
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
