import { RECOMMENDATION_RECORD_LIMIT, RECOMMENDATION_RETENTION_MS, updateRecommendationRecord } from '../recommendation-learning.js'

/** Local evidence store, shared by Electron windows through its main process. */
export function createRecommendationStore(db, createEpoch = () => crypto.randomUUID()) {
  let pending = Promise.resolve()
  const queue = operation => {
    const result = pending.catch(() => {}).then(operation)
    pending = result
    return result
  }
  async function meta() {
    let record = await db.findOneAsync({ _id: 'meta' })
    if (!record) {
      record = { _id: 'meta', version: 1, epoch: createEpoch(), revision: 0 }
      await db.insertAsync(record)
    }
    return record
  }
  async function snapshot() {
    const { epoch, revision } = await meta()
    return { epoch, revision, records: await db.findAsync({ _id: { $ne: 'meta' } }) }
  }
  return {
    find: () => queue(async () => {
      await db.removeAsync({ _id: { $ne: 'meta' }, updatedAt: { $lt: Date.now() - RECOMMENDATION_RETENTION_MS } }, { multi: true })
      return snapshot()
    }),
    record: event => queue(async () => {
      const { epoch, revision } = await meta()
      if (event?.epoch !== epoch) return { epoch, revision, stale: true }
      const previous = await db.findOneAsync({ _id: event.video?.videoId ?? '' })
      const record = updateRecommendationRecord(previous, event)
      if (!record || record === previous) return { epoch, revision }
      await db.updateAsync({ _id: record._id }, record, { upsert: true })
      const excess = await db.findAsync({ _id: { $ne: 'meta' } }, { _id: 1 }).sort({ updatedAt: -1 }).skip(RECOMMENDATION_RECORD_LIMIT)
      const removed = excess.map(entry => entry._id)
      if (removed.length) await db.removeAsync({ _id: { $in: removed } }, { multi: true })
      await db.updateAsync({ _id: 'meta' }, { $set: { revision: revision + 1 } })
      return { epoch, revision: revision + 1, record, removed }
    }),
    remove: videoIds => queue(async () => {
      const { revision } = await meta()
      await db.removeAsync({ _id: { $in: videoIds } }, { multi: true })
      await db.updateAsync({ _id: 'meta' }, { _id: 'meta', version: 1, epoch: createEpoch(), revision: revision + 1 }, { upsert: true })
      return snapshot()
    }),
    reset: () => queue(async () => {
      const { revision } = await meta()
      await db.removeAsync({ _id: { $ne: 'meta' } }, { multi: true })
      await db.updateAsync({ _id: 'meta' }, { _id: 'meta', version: 1, epoch: createEpoch(), revision: revision + 1 })
      return snapshot()
    }),
  }
}
