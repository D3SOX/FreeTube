import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compileFunction } from 'node:vm'
import Datastore from '@seald-io/nedb'
import { createStore } from 'vuex'
import * as historyHelpers from '../../src/history.js'
import { parseSubscriptionSeenVideos } from '../../src/subscriptionSeenVideos.js'
import { createRecommendationStore } from '../../src/datastores/recommendations.js'
import { buildRecommendationProfile } from '../../src/renderer/helpers/recommendations.js'

const sources = await Promise.all([
  'src/datastores/handlers/base.js',
  'src/renderer/store/modules/history.js',
  'src/renderer/store/modules/recommendations.js',
  'src/renderer/store/index.js',
].map(path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')))

// Resolve webpack imports locally, keeping the real datastore handlers, Vuex
// actions, mutations and plugin registration. No Electron or network is needed.
function evaluate (source, dependencies, exports = '') {
  const body = source.replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
    .replace(/^export \{[\s\S]*?\}\n/gm, '')
    .replace('export default ', 'return ')
  return compileFunction(`${body}\n${exports}`, Object.keys(dependencies))(...Object.values(dependencies))
}

function fixture () {
  const db = Object.fromEntries(['history', 'settings', 'recommendations'].map(name => [name, new Datastore({ inMemoryOnly: true })]))
  const handlers = evaluate(sources[0], { db, createRecommendationStore, ...historyHelpers }, 'return { history: History, recommendations }')
  const history = evaluate(sources[1], { DBHistoryHandlers: handlers.history, DBSettingHandlers: { mergeSeenVideos: async () => '[]' }, parseSubscriptionSeenVideos, ...historyHelpers })
  const recommendations = evaluate(sources[2], { DBRecommendationHandlers: handlers.recommendations })
  const otherModules = Object.fromEntries([...sources[3].matchAll(/^import (\w+) from '\.\/modules\//gm)].map(([, name]) => [name, {}]))
  const store = evaluate(sources[3], {
    ...otherModules,
    history,
    recommendations,
    createStore,
    settings: {
      state: {},
      getters: {
        getEnableHomeRecommendations: () => true,
        getRememberHistory: () => true,
        getHistoryRetentionDays: () => 0,
      },
    },
    isSettingSyncable: () => false,
    isSettingSyncEnabled: () => false,
    SYNC_ACTION_REASONS: new Map(),
    SYNC_MUTATION_REASONS: new Map(),
  })
  const reloads = []
  const dispatch = store.dispatch
  store.dispatch = (type, payload) => {
    const result = dispatch(type, payload)
    if (type === 'loadRecommendations') reloads.push(result)
    return result
  }
  return {
    store,
    handlers,
    reloads,
    async settle () {
      await Promise.all(reloads.splice(0))
    },
  }
}

const video = (videoId, timeWatched = Date.now()) => ({
  videoId,
  title: 'Linux desktop customization',
  authorId: videoId,
  lengthSeconds: 600,
  watchProgress: 500,
  timeWatched,
  isWatched: true,
})
const evidenceIds = records => records.map(record => record.videoId).sort()
const seeds = store => buildRecommendationProfile(store.getters.getHistoryCacheSorted, {
  records: store.getters.getRecommendationRecords,
}).seeds.map(seed => seed.videoId)

async function learn (store, record) {
  await store.dispatch('recordRecommendationEvent', { type: 'positive', video: record })
}

const removals = {
  single: store => store.dispatch('removeFromHistory', 'removed'),
  bulk: store => store.dispatch('removeHistoryOlderThan', 1),
  sync: store => store.dispatch('applyHistorySyncChanges', { insertions: [], updates: [], deletions: ['removed'] }),
  overwrite: store => store.dispatch('overwriteHistory', new Map([['retained', video('retained')]])),
}

for (const origin of ['same-session', 'loaded']) {
  for (const [name, remove] of Object.entries(removals)) {
    test(`${name} removal refreshes ${origin} evidence and epoch without retaining a discovery seed`, async () => {
      const f = fixture()
      const removed = video('removed', Date.now() - 3 * 86400000)
      const retained = video('retained')
      if (origin === 'loaded') {
        await f.handlers.history.upsert(removed)
        await f.handlers.history.upsert(retained)
      }
      await f.store.dispatch('grabHistory')
      await f.store.dispatch('loadRecommendations')
      if (origin === 'same-session') {
        await f.store.dispatch('updateHistory', removed)
        await f.store.dispatch('updateHistory', retained)
      }
      await learn(f.store, removed)
      await learn(f.store, retained)
      await f.settle()
      const epoch = f.store.getters.getRecommendationEpoch
      assert.ok(seeds(f.store).includes('removed'))

      await remove(f.store)
      await f.settle()

      const persisted = await f.handlers.recommendations.find()
      assert.deepEqual(evidenceIds(persisted.records), ['retained'])
      assert.notEqual(persisted.epoch, epoch)
      assert.deepEqual(evidenceIds(f.store.getters.getHistoryCacheSorted), ['retained'])
      assert.deepEqual(evidenceIds(f.store.getters.getRecommendationRecords), ['retained'])
      assert.equal(f.store.getters.getRecommendationEpoch, persisted.epoch)
      assert.deepEqual(seeds(f.store), ['retained'])
    })
  }
}

test('clearing empty history also clears cold-start feedback and refreshes the epoch', async () => {
  const f = fixture()
  await f.store.dispatch('grabHistory')
  await learn(f.store, video('cold-start'))
  await f.settle()
  const epoch = f.store.getters.getRecommendationEpoch
  assert.deepEqual(f.store.getters.getHistoryCacheSorted, [])
  assert.deepEqual(seeds(f.store), ['cold-start'])

  assert.equal(await f.store.dispatch('removeAllHistory'), true)
  await f.settle()

  const persisted = await f.handlers.recommendations.find()
  assert.deepEqual(persisted.records, [])
  assert.notEqual(persisted.epoch, epoch)
  assert.deepEqual(f.store.getters.getRecommendationRecords, [])
  assert.equal(f.store.getters.getRecommendationEpoch, persisted.epoch)
  assert.deepEqual(seeds(f.store), [])
})

test('a sync deletion refreshes feedback even when its video is absent from renderer history', async () => {
  const f = fixture()
  await learn(f.store, video('removed'))
  await f.settle()

  // Other Electron windows receive the cache mutation after persistence.
  const changes = { insertions: [video('inserted')], updates: [], deletions: ['removed'] }
  await f.handlers.history.applySyncChanges(changes)
  f.store.commit('applyHistorySyncChanges', changes)
  await f.settle()

  assert.deepEqual(f.store.getters.getRecommendationRecords, [])
  assert.equal(f.store.getters.getRecommendationEpoch, (await f.handlers.recommendations.find()).epoch)
  assert.deepEqual(evidenceIds(f.store.getters.getHistoryCacheSorted), ['inserted'])
  assert.ok(!seeds(f.store).includes('removed'))
})

test('playback upserts, progress and sync additions preserve evidence without reloading', async () => {
  const f = fixture()
  await learn(f.store, video('retained'))
  await f.settle()
  const epoch = f.store.getters.getRecommendationEpoch

  await f.store.dispatch('updateHistory', video('retained'))
  await f.store.dispatch('updateWatchProgress', { videoId: 'retained', watchProgress: 550 })
  await f.store.dispatch('applyHistorySyncChanges', {
    insertions: [video('inserted')], updates: [video('retained')], deletions: [],
  })
  await f.store.dispatch('removeHistoryOlderThan', 30)

  assert.equal(f.reloads.length, 0)
  assert.equal(f.store.getters.getRecommendationEpoch, epoch)
  assert.deepEqual(evidenceIds(f.store.getters.getRecommendationRecords), ['retained'])
})

test('history removal does not eagerly initialize unused recommendation state', async () => {
  const f = fixture()
  await f.store.dispatch('updateHistory', video('removed'))
  await f.store.dispatch('removeFromHistory', 'removed')
  await f.store.dispatch('removeAllHistory')

  assert.equal(f.reloads.length, 0)
  assert.equal(f.store.getters.getRecommendationEpoch, null)
})
