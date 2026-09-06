import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Datastore from '@seald-io/nedb'
import { createRecommendationStore } from '../../src/datastores/recommendations.js'
import { recommendationVideo, updateRecommendationRecord, sampleRecommendationPlayback, RECOMMENDATION_RECORD_LIMIT } from '../../src/recommendation-learning.js'
const video = { videoId: 'linux-video', title: 'Linux desktop', authorId: 'channel', lengthSeconds: 600 }
const memoryStore = () => createRecommendationStore(new Datastore({ inMemoryOnly: true }))

test('actual playback counts progress but not seeks, paused time, stalls or suspended timers', () => {
  const previous = { videoId: 'video', time: 100, now: 10000, playing: true }
  const sample = changes => sampleRecommendationPlayback(previous, { ...previous, time: 101, now: 11000, ...changes }).seconds
  assert.equal(sample({}), 1)
  assert.equal(sample({ time: 102, rate: 2 }), 2)
  assert.equal(sample({ time: 500 }), 0)
  assert.equal(sample({ time: 99 }), 0)
  assert.equal(sample({ time: 100 }), 0)
  assert.equal(sample({ playing: false }), 0)
  assert.equal(sample({ now: 30000 }), 0)
  assert.equal(sample({ videoId: 'different' }), 0)
})
test('impressions count once per feed and retain bounded recent exposure history', () => {
  let record
  for (let i = 0; i < 20; i++) {
    record = updateRecommendationRecord(record, { type: 'impression', video, feedId: String(i) }, i + 1)
    assert.equal(updateRecommendationRecord(record, { type: 'impression', video, feedId: String(i) }, i + 1), record)
  }
  assert.equal(record.impressions.length, 12)
})
test('malformed evidence is rejected and persisted metadata is bounded', () => {
  assert.equal(recommendationVideo({ videoId: 'meta' }), null)
  assert.equal(recommendationVideo({ videoId: '__proto__' }), null)
  assert.equal(recommendationVideo({ videoId: 1 }), null)
  assert.equal(updateRecommendationRecord(undefined, { type: 'invalid', video }), undefined)
  const stored = recommendationVideo({ ...video, description: 'x'.repeat(5000), lengthSeconds: Infinity })
  assert.equal(stored.description.length, 1500)
  assert.equal(stored.lengthSeconds, 0)
})
test('concurrent cumulative watch observations are serialized and idempotent', async () => {
  const store = memoryStore()
  const { epoch } = await store.find()
  await Promise.all([10, 20, 5, 20].map(seconds => store.record({ type: 'watch', video, epoch, sessionId: 'session', seconds })))
  const { records } = await store.find()
  assert.equal(records[0].watchSeconds, 20)
  await store.record({ type: 'watch', video, epoch, sessionId: 'second-session', seconds: 7 })
  assert.equal((await store.find()).records[0].watchSeconds, 27)
})
test('reset rejects queued events from the old epoch instead of resurrecting learning', async () => {
  const store = memoryStore()
  const { epoch } = await store.find()
  await store.record({ type: 'positive', video, epoch })
  const resetting = store.reset()
  const late = store.record({ type: 'positive', video, epoch })
  const reset = await resetting
  assert.notEqual(reset.epoch, epoch)
  assert.equal((await late).stale, true)
  assert.deepEqual((await store.find()).records, [])
})
test('removing a history video removes its learned contribution and invalidates late observations', async () => {
  const store = memoryStore()
  const { epoch } = await store.find()
  await store.record({ type: 'positive', video, epoch })
  await store.record({ type: 'positive', video: { ...video, videoId: 'retained' }, epoch })
  const state = await store.remove([video.videoId])
  assert.deepEqual(state.records.map(record => record.videoId), ['retained'])
  assert.equal((await store.record({ type: 'click', video, epoch })).stale, true)
})
test('feedback and exposure survive a datastore reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'otx-recommendations-'))
  try {
    const filename = join(directory, 'recommendations.db')
    const store = createRecommendationStore(new Datastore({ filename, autoload: true }))
    const { epoch } = await store.find()
    await store.record({ type: 'dismiss', video, epoch })
    await store.record({ type: 'impression', video, epoch, feedId: 'feed' })
    const reopened = createRecommendationStore(new Datastore({ filename, autoload: true }))
    const state = await reopened.find()
    assert.equal(state.records[0].feedback, 'dismiss')
    assert.equal(state.records[0].impressions.length, 1)
    assert.equal(state.epoch, epoch)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test('prunes old and excess learning records without deleting the schema record', async () => {
  const db = new Datastore({ inMemoryOnly: true })
  const store = createRecommendationStore(db)
  const { epoch } = await store.find()
  const now = Date.now()
  await db.insertAsync(Array.from({ length: RECOMMENDATION_RECORD_LIMIT + 2 }, (_, i) => ({ ...video, _id: `video${i}`, videoId: `video${i}`, updatedAt: now - i })))
  await store.record({ type: 'positive', video, epoch })
  assert.equal((await store.find()).records.length, RECOMMENDATION_RECORD_LIMIT)
  await db.insertAsync({ ...video, _id: 'expired', videoId: 'expired', updatedAt: 1 })
  assert.ok(!(await store.find()).records.some(record => record.videoId === 'expired'))
  assert.equal((await store.find()).epoch, epoch)
})

test('a sparse impression does not erase metadata learned during playback', () => {
  const learned = updateRecommendationRecord(undefined, { type: 'watch', video: { ...video, description: 'KDE Plasma widgets', keywords: ['Plasma'] }, sessionId: 'session', seconds: 120 })
  const seen = updateRecommendationRecord(learned, { type: 'impression', video: { videoId: video.videoId, title: video.title }, feedId: 'feed' })
  assert.equal(seen.description, 'KDE Plasma widgets')
  assert.equal(seen.authorId, video.authorId)
  assert.deepEqual(seen.keywords, ['Plasma'])
})
