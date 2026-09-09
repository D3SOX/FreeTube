import assert from 'node:assert/strict'
import test from 'node:test'
import { loadInvidiousPlaylistSnapshot, loadLocalPlaylistSnapshot } from '../../src/renderer/helpers/playlist-snapshot.js'

const video = (videoId, index) => ({ videoId, index })

test('local snapshot follows every continuation, including pages with no playable videos', async () => {
  const pages = [
    { info: { title: 'Source', description: 'Description' }, items: [video('a', 0)], has_continuation: true },
    { items: [], has_continuation: true },
    { items: [video('b', 2), video('a', 3)], has_continuation: false },
  ]
  let continuations = 0
  const result = await loadLocalPlaylistSnapshot('source', {
    getPlaylist: async id => { assert.equal(id, 'source'); return pages[0] },
    getContinuation: async page => { assert.equal(page, pages[continuations]); return pages[++continuations] },
    parseVideos: items => items,
  })
  assert.equal(continuations, 2)
  assert.deepEqual(result, { title: 'Source', description: 'Description', videos: [video('a', 0), video('b', 2), video('a', 3)] })
})

test('Invidious snapshot fetches all pages and keeps distinct occurrences through page overlaps', async () => {
  const requested = []
  const pages = [
    [video('a', 0), video('b', 1)],
    [video('b', 1), video('a', 100)],
    [video('last', 200)],
  ]
  const result = await loadInvidiousPlaylistSnapshot('source', {
    getPlaylist: async (id, page = 1) => {
      assert.equal(id, 'source')
      requested.push(page)
      return { title: 'Source', description: '', videoCount: 201, pageVideoCount: pages[page - 1].length, videos: pages[page - 1] }
    },
  })
  assert.deepEqual(requested, [1, 2, 3])
  assert.deepEqual(result.videos, [video('a', 0), video('b', 1), video('a', 100), video('last', 200)])
})

for (const backend of ['local', 'invidious']) {
  test(`${backend} continuation failure rejects the snapshot instead of returning partial videos`, async () => {
    const fail = async () => { throw new Error('Continuation failed') }
    const result = backend === 'local'
      ? loadLocalPlaylistSnapshot('source', {
        getPlaylist: async () => ({ info: {}, items: [video('a', 0)], has_continuation: true }),
        parseVideos: items => items,
        getContinuation: fail,
      })
      : loadInvidiousPlaylistSnapshot('source', {
        getPlaylist: async (_id, page) => page == null
          ? { videos: [video('a', 0)], videoCount: 200, pageVideoCount: 1 }
          : fail(),
      })
    await assert.rejects(result, /Continuation failed/)
  })
}

test('navigation cancellation discards a completed request and stops fetching pages', async () => {
  const controller = new AbortController()
  let requests = 0
  await assert.rejects(loadInvidiousPlaylistSnapshot('source', {
    signal: controller.signal,
    getPlaylist: async () => {
      requests++
      controller.abort()
      return { videos: [video('a', 0)], videoCount: 200, pageVideoCount: 1 }
    },
  }), { name: 'AbortError' })
  assert.equal(requests, 1)
})

test('empty remote playlists produce an empty snapshot', async () => {
  const result = await loadInvidiousPlaylistSnapshot('source', {
    getPlaylist: async () => ({ title: 'Empty', description: '', videos: [], videoCount: 0, pageVideoCount: 0 }),
  })
  assert.deepEqual(result.videos, [])
})

test('a missing advertised local continuation is not accepted as a complete snapshot', async () => {
  await assert.rejects(loadLocalPlaylistSnapshot('source', {
    getPlaylist: async () => ({ info: {}, items: [video('a', 0)], has_continuation: true }),
    parseVideos: items => items,
    getContinuation: async () => null,
  }), /Missing playlist continuation/)
})

test('an empty advertised Invidious continuation is not accepted as a complete snapshot', async () => {
  await assert.rejects(loadInvidiousPlaylistSnapshot('source', {
    getPlaylist: async (_id, page) => ({
      videos: page == null ? [video('a', 0)] : [],
      videoCount: 150,
      pageVideoCount: page == null ? 1 : 0,
    }),
  }), /Missing playlist continuation/)
})
