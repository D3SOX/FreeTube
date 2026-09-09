import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

const source = readFileSync(new URL('../../src/renderer/components/PlaylistInfo/PlaylistInfo.vue', import.meta.url), 'utf8')
const copyFunction = source.slice(source.search(/(?:async )?function toggleCopyVideosPrompt/), source.indexOf('async function addMissingVideos'))

test('copying a remote playlist fetches the complete snapshot before opening the prompt', async () => {
  const completeVideos = [{ videoId: 'first' }, { videoId: 'later-page' }]
  let copied
  const context = {
    props: { id: 'source', videos: completeVideos.slice(0, 1), moreVideoDataAvailable: true, title: 'Source', channelName: '', description: '' },
    isUserPlaylist: { value: false },
    snapshotPending: { value: false },
    loadSnapshot: async () => ({ videos: completeVideos }),
    store: { dispatch: (_action, payload) => { copied = payload } },
    showToast: () => {},
    t: key => key,
  }
  vm.createContext(context)
  await vm.runInContext(`(async () => { ${copyFunction}; await toggleCopyVideosPrompt() })()`, context)
  assert.deepEqual(copied?.videos, completeVideos)
  assert.equal(copied.newPlaylistDefaultProperties.sourcePlaylistId, 'source')
})

test('failed full fetch never opens a partial copy prompt', async () => {
  let dispatched = false
  const context = {
    props: { id: 'source', videos: [{ videoId: 'first' }], title: 'Source', channelName: '' },
    isUserPlaylist: { value: false },
    snapshotPending: { value: false },
    loadSnapshot: async () => null,
    store: { dispatch: () => { dispatched = true } },
  }
  vm.createContext(context)
  await vm.runInContext(`(async () => { ${copyFunction}; await toggleCopyVideosPrompt() })()`, context)
  assert.equal(dispatched, false)
})
