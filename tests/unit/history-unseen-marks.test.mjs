import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compileFunction } from 'node:vm'
import * as historyHelpers from '../../src/history.js'
import { parseSubscriptionSeenVideos } from '../../src/subscriptionSeenVideos.js'

const source = await readFile(new URL('../../src/renderer/store/modules/history.js', import.meta.url), 'utf8')

function fixture(fail = false) {
  const writes = []
  const marks = []
  const persist = async value => {
    if (fail) throw new Error('history persistence failed')
    writes.push(structuredClone(value))
  }
  const dependencies = {
    ...historyHelpers,
    parseSubscriptionSeenVideos,
    DBHistoryHandlers: { upsert: persist, overwrite: persist },
    console: { error() {} },
  }
  const module = compileFunction(source.replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
    .replace('export default', 'return'), Object.keys(dependencies))(...Object.values(dependencies))
  const context = {
    state: module.state,
    rootGetters: { getSubscriptionSeenVideos: [
      { videoId: 'unseen', seenAt: 100, unseenAt: 100, isMembersOnly: true },
      { videoId: 'seen', seenAt: 200, unseenAt: 100 },
    ] },
    commit: (type, payload) => module.mutations[type](module.state, payload),
    dispatch: async (type, payload) => {
      if (type === 'mergeSubscriptionSeenVideos') marks.push(structuredClone(payload))
      else return module.actions[type](context, payload)
    },
  }
  return { context, writes, marks }
}

const record = videoId => ({ videoId, isWatched: false, isMembersOnly: false, watchProgress: 123, lengthSeconds: 200, timeWatched: 1 })

for (const bulk of [false, true]) {
  test(`${bulk ? 'bulk' : 'individual'} mark as watched supersedes active unseen marks without changing playback metadata`, async () => {
    const f = fixture()
    const records = ['unseen', 'seen', 'unrelated'].map(record)
    if (bulk) {
      f.context.state.historyCacheSorted = records
      assert.equal(await f.context.dispatch('markAllHistoryAsWatched'), 3)
    } else {
      for (const entry of records) await f.context.dispatch('updateHistory', { ...entry, isWatched: true })
    }
    // The previously members-only upload is public when it is marked watched.
    assert.deepEqual(f.marks, [{ videos: [{ videoId: 'unseen', isMembersOnly: false }] }])
    assert.deepEqual(f.writes.flat(), records.map(entry => ({ ...entry, isWatched: true })))
  })

  test(`${bulk ? 'bulk' : 'individual'} failed history persistence preserves active unseen marks`, async () => {
    const f = fixture(true)
    if (bulk) {
      f.context.state.historyCacheSorted = [record('unseen')]
      await f.context.dispatch('markAllHistoryAsWatched')
    } else {
      await f.context.dispatch('updateHistory', { ...record('unseen'), isWatched: true })
    }
    assert.deepEqual(f.marks, [])
  })
}

test('saving an unwatched history record preserves active unseen marks', async () => {
  const f = fixture()
  await f.context.dispatch('updateHistory', record('unseen'))
  assert.deepEqual(f.marks, [])
})
