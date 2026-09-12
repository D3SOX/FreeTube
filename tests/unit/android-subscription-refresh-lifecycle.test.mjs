import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { setImmediate } from 'node:timers/promises'

import { createSubscriptionRefreshStartController } from '../../src/renderer/helpers/androidSubscriptionRefreshData.js'

async function loadHelpers(native, logger = console, notifications = { checkPermissions: async () => ({ display: 'granted' }) }) {
  const source = await readFile(new URL('../../src/renderer/helpers/androidSubscriptionRefresh.js', import.meta.url), 'utf8')
  return vm.runInNewContext(`${source.replace(/^import .*$/gm, '').replaceAll('export ', '')}
    ({ startAndroidSubscriptionRefresh, finishAndroidSubscriptionRefresh, withAndroidSubscriptionRefreshBatch })`, {
    process: { env: { IS_CAPACITOR: true } },
    registerPlugin: () => native,
    LocalNotifications: notifications,
    createSubscriptionRefreshStartController,
    console: logger,
  })
}

test('Refresh All holds its native batch until every feed and its native finish settle', async () => {
  const firstFinish = Promise.withResolvers()
  const finishing = Promise.withResolvers()
  const ended = Promise.withResolvers()
  const events = []
  let starts = 0
  const helpers = await loadHelpers({
    async beginBatch() { events.push('begin'); return { acquired: true } },
    async start() { events.push(`start${++starts}`); return { acquired: true, token: `token${starts}` } },
    async finish({ token }) {
      events.push(`finish:${token}`)
      if (token === 'token1') {
        finishing.resolve()
        await firstFinish.promise
      }
    },
    async endBatch() { events.push('end'); ended.resolve() },
  })
  const refreshFeed = id => async () => {
    await helpers.startAndroidSubscriptionRefresh(id, 'Refresh', 'Cancel')
    await helpers.finishAndroidSubscriptionRefresh(id)
  }
  const source = await readFile(new URL('../../src/renderer/composables/useRefreshAllSubscriptionFeeds.js', import.meta.url), 'utf8')
  const useRefreshAll = vm.runInNewContext(`${source.slice(source.indexOf('const LARGE_SUBSCRIPTION_COUNT')).replace('export ', '')}
    useRefreshAllSubscriptionFeeds`, {
    computed: get => ({ get value() { return get() } }),
    ref: value => ({ value }),
    useI18n: () => ({ t: value => value }),
    store: { getters: { getActiveProfile: { subscriptions: [] }, getUseRssFeeds: true } },
    getEnabledSubscriptionFeedSources: () => [{ category: 'videos' }, { category: 'shorts' }],
    getSubscriptionRefreshCancelCount: () => 0,
    refreshSubscriptionVideosFromRemote: refreshFeed(1),
    refreshSubscriptionShortsFromRemote: refreshFeed(2),
    refreshSubscriptionLiveFromRemote() {},
    refreshSubscriptionPostsFromRemote() {},
    withAndroidSubscriptionRefreshBatch: helpers.withAndroidSubscriptionRefreshBatch,
  })
  const refresh = useRefreshAll()
  refresh.refresh()
  await finishing.promise
  assert.deepEqual(events, ['begin', 'start1', 'finish:token1'])
  assert.equal(refresh.isRefreshing.value, true)
  firstFinish.resolve()
  await ended.promise
  assert.deepEqual(events, ['begin', 'start1', 'finish:token1', 'start2', 'finish:token2', 'end'])
  await setImmediate()
  assert.equal(refresh.isRefreshing.value, false)
})

test('failed batch acquisition does not run or release another refresh', async () => {
  const { withAndroidSubscriptionRefreshBatch } = await loadHelpers({
    async beginBatch() { return { acquired: false } },
    endBatch() { assert.fail('must not release another batch') },
  })
  await withAndroidSubscriptionRefreshBatch(() => assert.fail('must not start overlapping work'))
})

test('empty and failed queues release their acquired batch', async () => {
  let ended = 0
  const { withAndroidSubscriptionRefreshBatch } = await loadHelpers({
    async beginBatch() { return { acquired: true } },
    async endBatch() { ended++ },
  })
  await withAndroidSubscriptionRefreshBatch(async () => {})
  await assert.rejects(withAndroidSubscriptionRefreshBatch(async () => { throw new Error('refresh failed') }), /refresh failed/)
  assert.equal(ended, 2)
})

test('a rejected native batch acquisition is handled without starting or releasing work', async () => {
  const errors = []
  const { withAndroidSubscriptionRefreshBatch } = await loadHelpers({
    async beginBatch() { throw new Error('renderer destroyed') },
    endBatch() { assert.fail('unacquired batch must not be released') },
  }, { error: (...args) => errors.push(args) })
  await withAndroidSubscriptionRefreshBatch(() => assert.fail('unacquired batch must not run'))
  assert.equal(errors.length, 1)
})

test('a batch reuses its permission result for every feed and clears it afterward', async () => {
  let requests = 0
  const helpers = await loadHelpers({
    async beginBatch() { return { acquired: true } },
    async start() { return { acquired: true, token: 'token' } },
    async finish() {},
    async endBatch() {},
  }, console, {
    async checkPermissions() { return { display: 'prompt-with-rationale' } },
    async requestPermissions() { requests++; return { display: 'denied' } },
  })
  await helpers.withAndroidSubscriptionRefreshBatch(async () => {
    for (const id of [1, 2]) {
      const result = await helpers.startAndroidSubscriptionRefresh(id, 'Refresh', 'Cancel')
      assert.equal(result.notificationsDenied, true)
      await helpers.finishAndroidSubscriptionRefresh(id)
    }
  })
  assert.equal(requests, 1)
  await helpers.startAndroidSubscriptionRefresh(3, 'Refresh', 'Cancel')
  await helpers.finishAndroidSubscriptionRefresh(3)
  assert.equal(requests, 2)
})
