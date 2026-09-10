import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
const { addToHistory } = runInNewContext(`({
  ${source.slice(source.indexOf('    addToHistory:'), source.indexOf('    keepHistoryEntryAlive('))}
})`)

test('offline download playback preserves existing history metadata while updating progress', () => {
  const historyEntry = {
    videoId: 'downloaded1', title: 'Saved title', author: 'Saved channel', authorId: 'channel1',
    published: 1234, description: 'Saved description', viewCount: 123, lengthSeconds: 40,
    watchProgress: 5, isWatched: false, timeWatched: 1,
  }
  let saved
  addToHistory.call({
    historyEntry,
    localFilePlayback: true,
    videoId: 'downloaded1', videoTitle: 'downloaded-file', channelName: '', channelId: '',
    videoPublished: 0, videoDescription: '', videoViewCount: 0, videoLengthSeconds: 42,
    isLive: false, isUpcoming: false,
    updateHistory(value) { saved = value },
  }, 20, true)

  for (const key of ['title', 'author', 'authorId', 'published', 'description', 'viewCount']) {
    assert.equal(saved[key], historyEntry[key], `${key} must survive offline playback`)
  }
  assert.equal(saved.watchProgress, 20)
  assert.equal(saved.lengthSeconds, 42)
  assert.equal(saved.isWatched, true)
  assert.ok(saved.timeWatched > historyEntry.timeWatched)
})

test('download playback with resolved online metadata refreshes history', () => {
  let saved
  addToHistory.call({
    historyEntry: { title: 'Old title', author: 'Old channel' },
    localFilePlayback: true,
    videoId: 'downloaded1', videoTitle: 'New title', channelName: 'New channel', channelId: 'channel1',
    videoPublished: 1234, videoDescription: 'New description', videoViewCount: 123, videoLengthSeconds: 42,
    isLive: false, isUpcoming: false,
    updateHistory(value) { saved = value },
  }, 20, false)

  assert.equal(saved.title, 'New title')
  assert.equal(saved.author, 'New channel')
  assert.equal(saved.authorId, 'channel1')
  assert.equal(saved.description, 'New description')
})

test('offline download metadata does not create a false metadata cache observation', async () => {
  let updates = 0
  const { updateVideoMetadataCache } = runInNewContext(`({
    ${source.slice(source.indexOf('    async updateVideoMetadataCache()'), source.indexOf('    clearLiveReminderStartTimer()'))}
  })`, {
    window: { ftElectron: { videoMetadataCache: { update: async () => { updates++ } } } },
  })
  await updateVideoMetadataCache.call({
    enableVideoMetadataCache: true, isLoading: false, hasResolvedVideoTitle: true,
    localFilePlayback: true, channelId: '', videoId: 'downloaded1', videoTitle: 'downloaded-file',
    videoDescription: '', thumbnail: '', videoLoadGeneration: 1,
    isCurrentVideoLoad: () => true,
  })
  assert.equal(updates, 0, 'missing online metadata must not be recorded as a changed description')
})
