import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compileFunction } from 'node:vm'
import Datastore from '@seald-io/nedb'
import * as historyHelpers from '../../src/history.js'
import * as seenHelpers from '../../src/subscriptionSeenVideos.js'

const source = await readFile(new URL('../../src/renderer/store/modules/history.js', import.meta.url), 'utf8')
const baseSource = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')
const record = videoId => ({ videoId, isWatched: false, isMembersOnly: false, watchProgress: 123, lengthSeconds: 200, timeWatched: 1 })

async function fixture(fail = false) {
  const db = { history: new Datastore({ inMemoryOnly: true }), settings: new Datastore({ inMemoryOnly: true }) }
  const savedMarks = [
    { videoId: 'unseen', seenAt: 100, unseenAt: 100, isMembersOnly: true },
    { videoId: 'seen', seenAt: 200, unseenAt: 100 },
  ]
  await db.settings.insertAsync({ _id: 'subscriptionSeenVideos', value: JSON.stringify(savedMarks) })
  const records = ['unseen', 'seen', 'unrelated'].map(record)
  await db.history.insertAsync(records)
  const baseDependencies = { db, ...historyHelpers, ...seenHelpers, console: { error() {} } }
  const History = compileFunction(baseSource.slice(baseSource.indexOf('class Settings {'), baseSource.indexOf('\nclass WatchStats {'))
    + '\nreturn History', Object.keys(baseDependencies))(...Object.values(baseDependencies))
  if (fail) History.updateSubscriptionState = async () => { throw new Error('history persistence failed') }
  const dependencies = { ...historyHelpers, DBHistoryHandlers: History, console: { error() {} } }
  const module = compileFunction(source.replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
    .replace('export default', 'return'), Object.keys(dependencies))(...Object.values(dependencies))
  const appliedMarks = []
  const context = {
    state: module.state,
    commit: (type, payload) => module.mutations[type](module.state, payload),
    dispatch: async (type, payload) => {
      if (type === 'applySubscriptionSeenVideos') appliedMarks.push(JSON.parse(payload))
      else return module.actions[type](context, payload)
    },
  }
  context.commit('setHistoryCacheSorted', structuredClone(records))
  context.commit('setHistoryCacheById', Object.fromEntries(context.state.historyCacheSorted.map(entry => [entry.videoId, entry])))
  return { context, db, appliedMarks, savedMarks, handlers: History }
}

for (const bulk of [false, true]) {
  test(`${bulk ? 'bulk' : 'individual'} mark as watched persists and applies seen marks without changing playback metadata`, async () => {
    const f = await fixture()
    if (bulk) {
      assert.equal(await f.context.dispatch('markAllHistoryAsWatched'), 3)
    } else {
      for (const videoId of ['unseen', 'seen', 'unrelated']) {
        await f.context.dispatch('updateHistory', { ...record(videoId), isWatched: true })
      }
    }
    for (const videoId of ['unseen', 'seen', 'unrelated']) {
      const persisted = await f.db.history.findOneAsync({ videoId })
      assert.equal(persisted.isWatched, true)
      assert.equal(persisted.watchProgress, 123)
      assert.equal(persisted.timeWatched, 1)
      assert.deepEqual(f.context.state.historyCacheById[videoId], persisted)
    }
    const saved = JSON.parse((await f.db.settings.findOneAsync({ _id: 'subscriptionSeenVideos' })).value)
    const unseen = saved.find(mark => mark.videoId === 'unseen')
    assert.ok(unseen.seenAt > unseen.unseenAt)
    assert.equal(unseen.isMembersOnly, false)
    assert.deepEqual(f.appliedMarks.at(-1), saved)
    assert.equal(saved.some(mark => mark.videoId === 'unrelated'), false)
  })

  test(`${bulk ? 'bulk' : 'individual'} failed history persistence leaves renderer and marks unchanged`, async () => {
    const f = await fixture(true)
    if (bulk) assert.equal(await f.context.dispatch('markAllHistoryAsWatched'), 0)
    else await f.context.dispatch('updateHistory', { ...record('unseen'), isWatched: true })
    assert.equal(f.context.state.historyCacheById.unseen.isWatched, false)
    assert.deepEqual(f.appliedMarks, [])
  })
}

test('saving an unwatched history record preserves active unseen marks', async () => {
  const f = await fixture()
  await f.context.dispatch('updateHistory', record('unseen'))
  assert.deepEqual(JSON.parse((await f.db.settings.findOneAsync({ _id: 'subscriptionSeenVideos' })).value), f.savedMarks)
  for (const marks of f.appliedMarks) assert.deepEqual(marks, f.savedMarks)
})

test('marking unseen commits the latest persisted progress instead of stale renderer history', async () => {
  const f = await fixture()
  await f.db.history.updateAsync({ videoId: 'unseen' }, { $set: { isWatched: true, watchProgress: 170 } })
  assert.equal(await f.context.dispatch('updateSubscriptionHistory', { unseenVideo: { videoId: 'unseen', isMembersOnly: false } }), 1)
  const cached = f.context.state.historyCacheById.unseen
  assert.equal(cached.isWatched, false)
  assert.equal(cached.watchProgress, 170)
  assert.equal(cached.timeWatched, 1)
  assert.deepEqual(cached, await f.db.history.findOneAsync({ videoId: 'unseen' }))
  assert.equal(f.appliedMarks.at(-1).find(mark => mark.videoId === 'unseen').unseenAt >= 100, true)
})

test('marking unseen without history applies saved marks without creating a renderer record', async () => {
  const f = await fixture()
  assert.equal(await f.context.dispatch('updateSubscriptionHistory', { unseenVideo: { videoId: 'no-history', isMembersOnly: false } }), 0)
  assert.equal(f.context.state.historyCacheById['no-history'], undefined)
  assert.equal(f.appliedMarks.at(-1).some(mark => mark.videoId === 'no-history'), true)
})

test('bulk watched action reports saved history when writing the seen marker fails', async () => {
  const f = await fixture()
  f.db.settings.updateAsync = async () => { throw new Error('Seen marker persistence failed') }
  assert.equal(await f.context.dispatch('markAllHistoryAsWatched'), 3)
  for (const videoId of ['unseen', 'seen', 'unrelated']) {
    assert.equal(f.context.state.historyCacheById[videoId].isWatched, true)
    assert.equal(f.context.state.historyCacheById[videoId].watchProgress, 123)
    assert.equal((await f.db.history.findOneAsync({ videoId })).isWatched, true)
  }
  assert.deepEqual(f.appliedMarks, [])
})

test('bulk watched updates preserve the order of entries with equal history timestamps', async () => {
  const f = await fixture()
  const middle = f.context.state.historyCacheById.seen
  middle.isWatched = true
  await f.db.history.updateAsync({ videoId: 'seen' }, { $set: { isWatched: true } })
  const before = f.context.state.historyCacheSorted.map(entry => entry.videoId)
  assert.equal(await f.context.dispatch('markAllHistoryAsWatched'), 2)
  assert.deepEqual(f.context.state.historyCacheSorted.map(entry => entry.videoId), before)
})
