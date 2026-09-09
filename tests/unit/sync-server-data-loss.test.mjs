import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import { MAIN_PROFILE_ID } from '../../src/constants.js'
import * as errors from '../../src/renderer/helpers/sync-server-errors.js'
import * as bookmarks from '../../src/renderer/helpers/playlist-bookmarks.js'
import * as profileSync from '../../src/renderer/helpers/profile-sync.js'

const source = await readFile(new URL('../../src/renderer/helpers/sync-server.js', import.meta.url), 'utf8')
const context = vm.createContext({ MAIN_PROFILE_ID, ...errors, ...bookmarks, ...profileSync })
vm.runInContext(source
  .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
  .replace(/^export \{[\s\S]*?\}\n/gm, '')
  .replace(/^export (?=(async )?(function|class|const))/gm, ''), context)

const video = { videoId: 'video-1', title: 'A video', authorId: 'channel-1' }
const channel = { id: 'channel-1', name: 'A channel' }
const bookmark = bookmarks.createPlaylistBookmark({ id: 'playlist-1', title: 'A saved playlist', uploaderId: 'channel-1', uploaderName: 'A channel' })
const profile = { _id: 'profile-1', name: 'A profile', bgColor: '#000000', textColor: '#FFFFFF', subscriptions: [channel] }
const playlist = { _id: 'playlist-1', playlistName: 'A playlist', videos: [video] }
const cases = [
  {
    collection: 'subscriptions', method: 'syncSubscriptions',
    state: { profiles: { profileList: [{ _id: MAIN_PROFILE_ID, subscriptions: [channel] }] } },
    client: { getSubscriptions: async () => [] },
    previous: [channel.id], item: { id: channel.id, name: channel.name },
  },
  {
    collection: 'saved playlists', method: 'syncPlaylistBookmarks',
    state: { settings: { playlistBookmarks: [bookmark] } },
    client: { getPlaylistBookmarks: async () => [] },
    previous: [bookmark.playlist.id], item: { id: bookmark.playlist.id, name: bookmark.playlist.title },
  },
  {
    collection: 'playlists', method: 'syncPlaylists',
    state: { playlists: { playlists: [playlist] } },
    client: { getPlaylists: async () => [] },
    previous: { [playlist._id]: { metadata: { title: 'Old title' } } },
    item: { id: playlist._id, name: playlist.playlistName },
  },
  {
    collection: 'history', method: 'syncHistory',
    state: { history: { historyCacheSorted: [video] } },
    client: { getWatchHistory: async () => [] },
    previous: [video.videoId], item: { id: video.videoId, name: video.title },
  },
  {
    collection: 'videos in playlist A playlist', method: 'syncPlaylists',
    state: { playlists: { playlists: [playlist] } },
    client: {
      getPlaylists: async () => [{ id: playlist._id }],
      getPlaylist: async () => ({ playlist: { id: playlist._id, title: playlist.playlistName }, videos: [] }),
    },
    previous: { [playlist._id]: { metadata: { title: playlist.playlistName, description: '' }, videos: [video.videoId] } },
    item: { id: video.videoId, name: video.title },
  },
  {
    collection: 'channels in profile A profile', method: 'syncProfiles',
    state: { profiles: { profileList: [{ _id: MAIN_PROFILE_ID, subscriptions: [channel] }, profile] } },
    client: {
      getSubscriptionGroups: async () => [{ group: { id: profile._id, title: profile.name }, channels: [] }],
    },
    previous: { [profile._id]: { metadata: { title: profile.name, bgColor: '#000000', textColor: '#FFFFFF' }, channels: [channel.id] } },
    item: { id: channel.id, name: channel.name },
  },
]

for (const scenario of cases) {
  test(`identifies deletions in ${scenario.collection} before applying them`, async () => {
    const store = { state: scenario.state, dispatch: () => assert.fail('Unexpected local change') }
    await assert.rejects(context[scenario.method](scenario.client, store, scenario.previous), error => {
      assert.ok(error instanceof errors.SyncServerDataLossError, error.stack)
      assert.equal(error.collection, scenario.collection)
      assert.deepEqual(structuredClone(error.items), [scenario.item])
      return true
    })
  })
}

test('deletion details fall back to IDs and exclude surviving and new items', () => {
  const previous = Array.from({ length: 20 }, (_, index) => `item-${index}`)
  assert.throws(() => context.mergeIds(previous, [...previous.slice(10), 'new-item'], previous), error => {
    assert.equal(error.deleted, 10)
    assert.deepEqual(structuredClone(error.items), previous.slice(0, 10).map(id => ({ id, name: id })))
    return true
  })
  assert.deepEqual(Array.from(context.mergeIds(previous, [], previous, { allowDataLoss: true })), [])
})
