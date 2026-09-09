import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { effectScope, nextTick, reactive, ref, watch } from 'vue'

const source = await readFile(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
const bindingStart = source.indexOf('      if (player.nativePlayback) {\n        player.nativePlayback.bindControls')
const binding = source.slice(bindingStart, source.indexOf('      wrapTextTrackSelection()', bindingStart))
// Exercise the actual subscription setup and lifecycle cleanup, without loading
// Shaka or the unrelated DOM teardown that follows these lifecycle prefixes.
const unmount = source.split('    onBeforeUnmount(() => {')
  .find(body => body.trimStart().startsWith('screenWakeBinding?.destroy()'))
  .split('      clearTimeout(paidPromotionTimer)')[0]
const destroy = source.split('    async function destroyPlayer() {')[1].split('      ignoreErrors = true')[0]

function fixture(native = true) {
  const calls = []
  const owners = new Set()
  let removals = 0
  const scope = effectScope()
  const player = { nativePlayback: native ? {
    bindControls() {},
    async setPresented(active) { calls.push(['presented', active]) },
    async setContinueInBackground(enabled) { calls.push(['background', enabled]) },
    async setSeekPreferences(seconds, scale) { calls.push(['seek', seconds, scale]) },
  } : null }
  const context = vm.createContext({
    player, localPlayer: player, controls: {}, mediaTabId: 'video',
    nativePlaybackCleanup: null, screenWakeBinding: null,
    repeatStatsTracker: null, repeatStatsLoopObserver: null,
    store: { getters: reactive({ getContinuePlaybackWhenScreenIsLocked: true }) },
    defaultSkipInterval: ref(5), seekIntervalMultiplyByPlaybackRate: ref(false),
    watch, handleError: assert.fail,
    tabMediaCoordinator: {
      subscribeOwnership(_tabId, listener) {
        owners.add(listener)
        return () => { removals++; owners.delete(listener) }
      },
    },
  })
  // These watches are registered after an await in onMounted. A separate scope
  // lets the fixture clean up failures without assuming Vue owns the watches.
  scope.run(() => vm.runInContext(binding, context))
  return {
    calls, context, scope, owners,
    get removals() { return removals },
    unmount: () => vm.runInContext(unmount, context),
    destroy: () => vm.runInContext(destroy, context),
    async changePreferences() {
      const getters = context.store.getters
      getters.getContinuePlaybackWhenScreenIsLocked = !getters.getContinuePlaybackWhenScreenIsLocked
      context.defaultSkipInterval.value += 5
      context.seekIntervalMultiplyByPlaybackRate.value = !context.seekIntervalMultiplyByPlaybackRate.value
      owners.forEach(listener => listener(false))
      await nextTick()
    },
  }
}

for (const lifecycle of [['unmount'], ['destroy', 'unmount'], ['unmount', 'destroy']]) {
  test(`native subscriptions stop after ${lifecycle.join(' then ')} and stay stopped`, async (t) => {
    const f = fixture()
    t.after(() => f.scope.stop())
    await f.changePreferences()
    assert.deepEqual(f.calls, [['presented', false], ['background', false], ['seek', 10, true]])
    f.calls.length = 0
    for (const step of lifecycle) f[step]()
    await f.changePreferences()
    assert.deepEqual(f.calls, [], 'an unmounted player must receive no ownership or preference updates')
    assert.equal(f.owners.size, 0)
    assert.equal(f.removals, 1, 'destroy and unmount must not unsubscribe twice')
    assert.equal(f.context.nativePlaybackCleanup, null)
  })
}

test('unmount is safe without initialized native playback', () => {
  const f = fixture(false)
  try {
    f.unmount()
    f.destroy()
    assert.equal(f.removals, 0)
  } finally {
    f.scope.stop()
  }
})
