import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import Datastore from '@seald-io/nedb'
import { migrateLegacyHistoryRecord } from '../../src/history.js'
import * as seenVideos from '../../src/subscriptionSeenVideos.js'

const source = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')

async function fixture(marks = []) {
  const db = {
    settings: new Datastore({ inMemoryOnly: true }),
    history: new Datastore({ inMemoryOnly: true }),
  }
  await db.settings.insertAsync({ _id: 'subscriptionSeenVideos', value: JSON.stringify(marks) })
  await db.history.insertAsync({ videoId: 'video', isWatched: false, watchProgress: 12, timeWatched: 1 })
  const errors = []
  const { Settings, History } = vm.runInNewContext(
    source.slice(source.indexOf('class Settings {'), source.indexOf('\nclass WatchStats {')) + '\n({Settings, History})',
    { db, ...seenVideos, migrateLegacyHistoryRecord, console: { error: error => errors.push(error) } }
  )
  return { db, Settings, History, errors }
}

for (const marks of [[], [{ videoId: 'video', seenAt: 1000, unseenAt: 1000 }]]) {
  test(`a queued unseen action wins over delayed watched persistence with ${marks.length} prior marks`, async () => {
    const { db, History } = await fixture(marks)
    const original = db.history.updateAsync.bind(db.history)
    let release
    let entered
    const blocked = new Promise(resolve => { release = resolve })
    const started = new Promise(resolve => { entered = resolve })
    db.history.updateAsync = async (query, update, options) => {
      if (update.isWatched === true) {
        entered()
        await blocked
      }
      return original(query, update, options)
    }
    const watched = History.updateSubscriptionState({ records: [{
      videoId: 'video', isWatched: true, watchProgress: 42, timeWatched: 1,
    }] })
    await started
    const unseen = History.updateSubscriptionState({ unseenVideo: { videoId: 'video' } })
    // Keep the first write pending while the competing command is submitted.
    await new Promise(resolve => setTimeout(resolve, 20))
    release()
    await Promise.all([watched, unseen])
    const record = await db.history.findOneAsync({ videoId: 'video' })
    assert.equal(record.isWatched, false)
    assert.equal(record.watchProgress, 42)
    assert.equal(record.timeWatched, 1)
    const saved = JSON.parse((await db.settings.findOneAsync({ _id: 'subscriptionSeenVideos' })).value)
    assert.ok(saved[0].unseenAt >= saved[0].seenAt)
  })
}

test('a watched action queued after unseen supersedes it without resetting progress or history order', async () => {
  const { db, History } = await fixture()
  const unseen = History.updateSubscriptionState({ unseenVideo: { videoId: 'video' } })
  const watched = History.updateSubscriptionState({ records: [{
    videoId: 'video', isWatched: true, watchProgress: 12, timeWatched: 1,
  }] })
  const [, result] = await Promise.all([unseen, watched])
  const record = await db.history.findOneAsync({ videoId: 'video' })
  assert.equal(record.isWatched, true)
  assert.equal(record.watchProgress, 12)
  assert.equal(record.timeWatched, 1)
  assert.deepEqual(result.records[0], record)
  const [mark] = JSON.parse(result.seenVideos)
  assert.ok(mark.seenAt > mark.unseenAt)
})

test('unseen patches persisted progress instead of replacing a renderer snapshot', async () => {
  const { db, History } = await fixture()
  await db.history.updateAsync({ videoId: 'video' }, { $set: { watchProgress: 99, isWatched: true } })
  const result = await History.updateSubscriptionState({ unseenVideo: { videoId: 'video' } })
  assert.equal(result.records[0].watchProgress, 99)
  assert.equal(result.records[0].timeWatched, 1)
  assert.equal(result.records[0].isWatched, false)
  const absent = await History.updateSubscriptionState({ unseenVideo: { videoId: 'absent' } })
  assert.equal(absent.records.length, 0)
  assert.equal(await db.history.findOneAsync({ videoId: 'absent' }), null)
  assert.ok(JSON.parse(absent.seenVideos).some(mark => mark.videoId === 'absent'))
})

test('bulk watched edits preserve unrelated history and only supersede matching reverse marks', async () => {
  const { db, History } = await fixture([
    { videoId: 'video', seenAt: 1000, unseenAt: 1000 },
    { videoId: 'other', seenAt: 1000, unseenAt: 1000 },
  ])
  await db.history.insertAsync({ videoId: 'other', isWatched: false, watchProgress: 77, timeWatched: 2 })
  const other = await db.history.findOneAsync({ videoId: 'other' })
  const result = await History.updateSubscriptionState({ records: [{
    videoId: 'video', isWatched: true, watchProgress: 12, timeWatched: 1,
  }] })
  assert.equal(result.records.length, 1)
  assert.deepEqual(await db.history.findOneAsync({ videoId: 'other' }), other)
  const marks = new Map(JSON.parse(result.seenVideos).map(mark => [mark.videoId, mark]))
  assert.ok(marks.get('video').seenAt > marks.get('video').unseenAt)
  assert.equal(marks.get('other').seenAt, marks.get('other').unseenAt)
})

test('ordinary history upserts do not scan history or rewrite seen marks', async () => {
  const { db, History } = await fixture([{ videoId: 'unrelated', seenAt: 1000 }])
  db.history.findAsync = () => { throw new Error('Unexpected history scan') }
  db.history.ensureIndexAsync = () => { throw new Error('Unexpected seen-merge index work') }
  db.settings.updateAsync = () => { throw new Error('Unexpected seen-mark write') }
  for (const isWatched of [false, true]) {
    const result = await History.updateSubscriptionState({ records: [{
      videoId: 'video', isWatched, watchProgress: 12, timeWatched: 1,
    }] })
    assert.equal(result.records[0].isWatched, isWatched)
    assert.equal(result.seenVideos, null)
  }
})

test('a failed status write does not poison the shared queue or publish an unseen marker', async () => {
  const { db, History } = await fixture()
  const original = db.history.updateAsync.bind(db.history)
  db.history.updateAsync = async () => { throw new Error('History persistence failed') }
  await assert.rejects(History.updateSubscriptionState({ unseenVideo: { videoId: 'video' } }), /History persistence failed/)
  assert.equal((await db.settings.findOneAsync({ _id: 'subscriptionSeenVideos' })).value, '[]')
  db.history.updateAsync = original
  const result = await History.updateSubscriptionState({ unseenVideo: { videoId: 'video' } })
  assert.equal(result.records[0].isWatched, false)
  assert.equal(JSON.parse(result.seenVideos)[0].videoId, 'video')
})

test('unwatched upserts do not read subscription settings', async () => {
  const { db, History, errors } = await fixture()
  db.settings.findOneAsync = () => { throw new Error('Unexpected settings read') }
  const result = await History.updateSubscriptionState({ records: [{
    videoId: 'video', isWatched: false, watchProgress: 12, timeWatched: 1,
  }] })
  assert.equal(result.records[0].isWatched, false)
  assert.equal(result.seenVideos, null)
  assert.equal(errors.length, 0)
})

for (const unseen of [false, true]) {
  test(`failed settings access still returns the persisted ${unseen ? 'unseen' : 'watched'} history update`, async () => {
    const { db, History, errors } = await fixture()
    db.settings.findOneAsync = () => { throw new Error('Settings unavailable') }
    const result = await History.updateSubscriptionState(unseen
      ? { unseenVideo: { videoId: 'video' } }
      : { records: [{ videoId: 'video', isWatched: true, watchProgress: 12, timeWatched: 1 }] })
    assert.equal(result.records.length, 1)
    assert.equal(result.records[0].isWatched, !unseen)
    assert.equal(result.records[0].watchProgress, 12)
    assert.equal(result.seenVideos, null)
    assert.equal(errors.length, 1)
    assert.match(errors[0].message, /Settings unavailable/)
    assert.deepEqual(result.records[0], await db.history.findOneAsync({ videoId: 'video' }))
  })
}
