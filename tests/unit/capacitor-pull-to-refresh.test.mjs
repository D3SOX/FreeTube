import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { reactive, watch } from 'vue'

const source = (await readFile(new URL('../../src/renderer/helpers/capacitorPullToRefresh.js', import.meta.url), 'utf8'))
  .replace(/^import .*\n/gm, '')
  .replace(/^export /gm, '')

function setup({ available = true, handled = false, fail = false, enabled = true } = {}) {
  const calls = []
  const tab = { id: 'a', route: { name: 'subscriptions', fullPath: '/subscriptions' }, refreshKey: 0 }
  const body = {}
  const root = {
    contains: target => target === root || target === child,
    closest: () => null,
    getBoundingClientRect: () => ({ top: 80 }),
    parentElement: body,
    querySelector: () => null
  }
  const child = { parentElement: root, closest: () => null }
  const document = { body, hidden: false, elementFromPoint: () => child }
  const window = { innerWidth: 400, innerHeight: 800, scrollY: 0 }
  const getters = reactive({ getPresentedTabId: 'a', getTabById: () => tab, getEnablePullToRefresh: enabled })
  let refresh
  const plugin = {
    addListener: async (event, handler) => {
      assert.equal(event, 'refresh')
      refresh = handler
      return { remove: async () => calls.push('remove') }
    },
    setEnabled: async ({ enabled }) => calls.push(enabled),
    finish: async () => calls.push('finish')
  }
  const api = vm.runInNewContext(`${source}\n({ canPullToRefreshTarget, initializeCapacitorPullToRefresh })`, {
    Capacitor: { isPluginAvailable: () => available }, registerPlugin: () => plugin,
    window, document, Date, setTimeout,
    getComputedStyle: element => ({ overflowX: 'visible', overflowY: 'visible', getPropertyValue: () => '#ffffff', ...element.style }),
    store: { getters, watch: (getter, callback, options) => watch(() => getter({}, getters), callback, options) }, nextTick: async () => {},
    getCapacitorTabService: () => ({ reloadTab: async id => {
      calls.push(`reload:${id}`)
      if (fail) throw new Error('reload failed')
    } }),
    tabRuntimeRegistry: { getRoot: () => root },
    tabLifecycleService: { run: async (id, hook, request) => {
      assert.equal(hook, 'pullToRefresh')
      request.handled = handled
      calls.push(`refresh:${id}`)
    } },
    console: { error: () => calls.push('error') }
  })
  return { api, calls, tab, root, child, document, window, getters, plugin, refresh: context => refresh(context) }
}

test('native availability gates setup, including future iOS builds without the plugin', async () => {
  const state = setup({ available: false })
  const remove = await state.api.initializeCapacitorPullToRefresh()
  remove()
  assert.deepEqual(state.calls, [])
  assert.equal(state.window.__opentubexPullToRefresh, undefined)
})

test('starts disabled when the saved preference is off and enables without restarting', async () => {
  const state = setup({ enabled: false })
  const remove = await state.api.initializeCapacitorPullToRefresh()
  assert.deepEqual(state.calls, [false])
  assert.equal(state.window.__opentubexPullToRefresh(0.5, 0.5), null)

  state.getters.getEnablePullToRefresh = true
  assert.deepEqual(state.calls, [false, true])
  await state.refresh(state.window.__opentubexPullToRefresh(0.5, 0.5))
  assert.deepEqual(state.calls, [false, true, 'refresh:a', 'reload:a', 'finish'])
  remove()
})

test('opting out immediately disables native gestures and rejects a pending refresh', async () => {
  const state = setup()
  const remove = await state.api.initializeCapacitorPullToRefresh()
  const context = state.window.__opentubexPullToRefresh(0.5, 0.5)
  state.getters.getEnablePullToRefresh = false
  assert.deepEqual(state.calls, [true, false])
  assert.equal(state.window.__opentubexPullToRefresh(0.5, 0.5), null)
  await state.refresh(context)
  assert.deepEqual(state.calls, [true, false, 'finish'])

  remove()
  const callsBeforeChange = [...state.calls]
  state.getters.getEnablePullToRefresh = true
  assert.deepEqual(state.calls, callsBeforeChange, 'disposal stops watching the setting')
})

test('accepts page content at the top, including fractional scroll offsets', () => {
  const { api, child, root } = setup()
  assert.equal(api.canPullToRefreshTarget(child, root, 0.4), true)
  assert.equal(api.canPullToRefreshTarget(child, root, 20), false)
  assert.equal(api.canPullToRefreshTarget({}, root, 0), false)
  assert.equal(api.canPullToRefreshTarget(null, root, 0), false)
})

test('leaves controls, players, inert content and nested scrolling alone', () => {
  const { api, child, root } = setup()
  child.closest = () => ({})
  assert.equal(api.canPullToRefreshTarget(child, root, 0), false)
  child.closest = () => null
  root.closest = () => ({})
  assert.equal(api.canPullToRefreshTarget(child, root, 0), false)
  root.closest = () => null
  for (const axis of ['X', 'Y']) {
    child.style = { [`overflow${axis}`]: 'auto' }
    child.scrollWidth = child.scrollHeight = 500
    child.clientWidth = child.clientHeight = 100
    assert.equal(api.canPullToRefreshTarget(child, root, 0), false)
  }
})

test('captures the originating tab and blocks loading, dialogs, fullscreen and utility pages', async () => {
  const state = setup()
  await state.api.initializeCapacitorPullToRefresh()
  const probe = () => state.window.__opentubexPullToRefresh(0.5, 0.5)
  assert.equal(probe().tabId, 'a')
  assert.equal(probe().offset, 0.1)
  for (const getter of ['isAnyPromptOpen', 'getSettingsWindowOpen', 'getIsSideNavOpen']) {
    state.getters[getter] = true
    assert.equal(probe(), null)
    state.getters[getter] = false
  }
  state.document.fullscreenElement = {}
  assert.equal(probe(), null)
  state.document.fullscreenElement = null
  state.tab.isLoading = true
  assert.equal(probe(), null)
  state.tab.isLoading = false
  state.tab.route.name = 'settings'
  assert.equal(probe(), null)
})

test('watch page indicator starts at the page top just like other pages at fractional UI scales', async () => {
  const state = setup()
  state.tab.route = { name: 'watch', fullPath: '/watch/video' }
  const player = { getBoundingClientRect: () => ({ bottom: 370.25 }) }
  state.root.querySelector = () => player
  state.root.getBoundingClientRect = () => ({ top: 80.25 })
  await state.api.initializeCapacitorPullToRefresh()
  assert.equal(state.window.__opentubexPullToRefresh(0.5, 0.6).offset, 80.25 / 800)
  state.root.querySelector = () => null
  assert.equal(state.window.__opentubexPullToRefresh(0.5, 0.6).offset, 80.25 / 800)
})

for (const handled of [false, true]) {
  test(handled ? 'uses the feed refresh without remounting cached subscriptions' : 'reloads pages without a feed refresh handler', async () => {
    const state = setup({ handled })
    const remove = await state.api.initializeCapacitorPullToRefresh()
    await state.refresh(state.window.__opentubexPullToRefresh(0.5, 0.5))
    assert.deepEqual(state.calls, handled ? [true, 'refresh:a', 'finish'] : [true, 'refresh:a', 'reload:a', 'finish'])
    remove()
    assert.equal(state.window.__opentubexPullToRefresh, undefined)
    assert.deepEqual(state.calls.slice(-2), ['remove', false])
  })
}

for (const change of [state => { state.tab.id = 'b' }, state => { state.tab.route.fullPath = '/history' }, state => { state.tab.refreshKey++ }]) {
  test('ignores a gesture from a replaced tab or route', async () => {
    const state = setup()
    await state.api.initializeCapacitorPullToRefresh()
    const context = state.window.__opentubexPullToRefresh(0.5, 0.5)
    change(state)
    await state.refresh(context)
    assert.deepEqual(state.calls, [true, 'finish'])
  })
}

test('finishes on reload failure and ignores duplicate refresh events', async () => {
  const state = setup({ fail: true })
  await state.api.initializeCapacitorPullToRefresh()
  const context = state.window.__opentubexPullToRefresh(0.5, 0.5)
  await Promise.all([state.refresh(context), state.refresh(context)])
  assert.deepEqual(state.calls, [true, 'refresh:a', 'reload:a', 'error', 'finish'])
})

test('spinner stays active until the feed finishes loading', async () => {
  const state = setup({ handled: true })
  await state.api.initializeCapacitorPullToRefresh()
  const context = state.window.__opentubexPullToRefresh(0.5, 0.5)
  state.getters.getSubscriptionFeedRefreshInProgress = true
  const refreshing = state.refresh(context)
  await new Promise(resolve => setTimeout(resolve, 180))
  assert.equal(state.calls.includes('finish'), false)
  state.getters.getSubscriptionFeedRefreshInProgress = false
  await refreshing
  assert.equal(state.calls.at(-1), 'finish')
})

test('an unrelated background subscription refresh does not keep a page spinner running', async () => {
  const state = setup()
  state.tab.route = { name: 'home', fullPath: '/home' }
  await state.api.initializeCapacitorPullToRefresh()
  state.getters.getSubscriptionFeedRefreshInProgress = true
  await state.refresh(state.window.__opentubexPullToRefresh(0.5, 0.5))
  assert.equal(state.calls.at(-1), 'finish')
})

for (const method of ['addListener', 'setEnabled']) {
  test(`cleans up when ${method} fails during initialization`, async () => {
    const state = setup()
    state.plugin[method] = async () => { throw new Error('native setup failed') }
    await assert.rejects(state.api.initializeCapacitorPullToRefresh(), /native setup failed/)
    assert.equal(state.window.__opentubexPullToRefresh, undefined)
    if (method === 'setEnabled') assert.deepEqual(state.calls, ['remove'])
    state.plugin.setEnabled = async () => state.calls.push('unexpected enable')
    state.getters.getEnablePullToRefresh = false
    assert.equal(state.calls.includes('unexpected enable'), false)
  })
}
