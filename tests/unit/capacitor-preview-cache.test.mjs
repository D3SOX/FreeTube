import assert from 'node:assert/strict'
import test from 'node:test'
import { createCapacitorPreviewCache } from '../../src/renderer/tabs/capacitorPreviewCache.js'

const tab = (id, fullPath = '/home') => ({ id, route: { fullPath } })
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

test('last-seen previews are bounded and closed/navigated tabs are pruned', async () => {
  const cache = createCapacitorPreviewCache(async () => 'image', new Map(), 2)
  await cache.capture(tab('a'))
  await cache.capture(tab('b'))
  await cache.capture(tab('a', '/history'))
  await cache.capture(tab('c'))
  assert.deepEqual([...cache.entries.keys()], ['a', 'c'])
  cache.prune([tab('a', '/home'), tab('c')])
  assert.deepEqual([...cache.entries.keys()], ['c'])
  cache.prune([])
  assert.equal(cache.entries.size, 0)
})

test('switching away and back during capture cannot publish a stale frame', async () => {
  const frame = deferred()
  const cache = createCapacitorPreviewCache(() => frame.promise)
  const capture = cache.capture(tab('a'))
  cache.invalidate() // A -> B
  cache.invalidate() // B -> A
  frame.resolve('stale image')
  await capture
  assert.equal(cache.entries.size, 0)
  await cache.capture(tab('a'))
  assert.equal(cache.entries.get('a').image, 'stale image')
})

test('disabling previews clears images and discards an in-flight capture', async () => {
  const frame = deferred()
  const cache = createCapacitorPreviewCache(() => frame.promise)
  const capture = cache.capture(tab('a'))
  cache.clear()
  frame.resolve('image')
  await capture
  assert.equal(cache.entries.size, 0)
})

test('overlapping requests share one native capture and never assign it to another tab', async () => {
  const frame = deferred()
  let calls = 0
  const cache = createCapacitorPreviewCache(() => { calls += 1; return frame.promise })
  const first = cache.capture(tab('a'))
  const second = cache.capture(tab('b'))
  frame.resolve('image')
  await Promise.all([first, second])
  assert.equal(calls, 1)
  assert.deepEqual([...cache.entries.keys()], ['a'])
})

test('missing frames preserve the last successful preview', async () => {
  let image = 'previous'
  const cache = createCapacitorPreviewCache(async () => image)
  await cache.capture(tab('a'))
  image = null
  await cache.capture(tab('a'))
  assert.equal(cache.entries.get('a').image, 'previous')
})

test('capture eligibility excludes settings, prompts, background and loading tabs', async () => {
  const { canCaptureCapacitorTab } = await import('../../src/renderer/tabs/capacitorPreviewCache.js')
  const presented = { ...tab('a'), loadState: 'loaded', isLoading: false }
  const getters = { getShowTabPreviews: true, getPresentedTab: presented, getActiveTabId: 'a' }
  assert.equal(canCaptureCapacitorTab(getters, true), true)
  for (const field of ['isAnyPromptOpen', 'getSettingsWindowOpen', 'getSettingsWindowMorphing']) {
    assert.equal(canCaptureCapacitorTab({ ...getters, [field]: true }, true), false)
  }
  assert.equal(canCaptureCapacitorTab(getters, false), false)
  assert.equal(canCaptureCapacitorTab({ ...getters, getActiveTabId: 'b' }, true), false)
  assert.equal(canCaptureCapacitorTab({ ...getters, getShowTabPreviews: false }, true), false)
  assert.equal(canCaptureCapacitorTab({ ...getters, getPresentedTab: { ...presented, isLoading: true } }, true), false)
})
