import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import test from 'node:test'

import { CapacitorTabService } from '../../src/renderer/tabs/CapacitorTabService.js'
import {
  activateCapacitorTab,
  addCapacitorTab,
  closeCapacitorTab,
  completeCapacitorTabMount,
  createCapacitorTab,
  restoreCapacitorTabSession,
  toRuntimeTabState,
  unloadCapacitorTab
} from '../../src/renderer/tabs/capacitorTabState.js'

globalThis.window = {
  crypto: webcrypto,
  location: { origin: 'https://localhost' }
}
globalThis.localStorage = { setItem () {} }

const HOME_ROUTE = { path: '/home', fullPath: '/home', query: {} }
const WATCH_ROUTE = { path: '/watch/video', fullPath: '/watch/video', query: {} }

function createStore (session, presentedTabId = session.activeTabId) {
  let runtime = toRuntimeTabState(session, presentedTabId)
  const subscribers = new Set()
  const getters = {
    getLandingPage: 'home',
    getTabById: tabId => runtime.tabs.find(tab => tab.id === tabId),
    getWatchTimestamp: () => 0
  }
  Object.defineProperties(getters, {
    getTabs: { get: () => runtime.tabs },
    getClosedTabs: { get: () => runtime.closedTabs },
    getActiveTabId: { get: () => runtime.activeTabId },
    getActiveTab: { get: () => runtime.tabs.find(tab => tab.id === runtime.activeTabId) },
    getPresentedTabId: { get: () => runtime.presentedTabId }
  })

  const state = { tabs: {} }
  Object.defineProperty(state.tabs, 'selectionRevision', {
    get: () => runtime.selectionRevision
  })

  return {
    get runtime () { return runtime },
    getters,
    state,
    subscribe(callback) {
      subscribers.add(callback)
      return () => subscribers.delete(callback)
    },
    commit (type, payload) {
      if (type === 'setTabsState') runtime = payload
      else if (type === 'setPresentedTab') runtime.presentedTabId = payload
      else if (type === 'setRememberTabNavigationHistory') getters.getRememberTabNavigationHistory = payload
      else throw new Error(`Unexpected mutation: ${type}`)
      for (const subscriber of subscribers) subscriber({ type, payload })
    }
  }
}

function createRouter () {
  return {
    currentRoute: { value: HOME_ROUTE },
    resolve (location) {
      if (typeof location === 'string') {
        return { path: location, fullPath: location, query: {} }
      }
      return {
        ...location,
        fullPath: location.fullPath || location.path,
        query: location.query || {}
      }
    }
  }
}

function createNavigation (store, presented = false) {
  return {
    projectTitle () {},
    requestPresentation: async tabId => {
      if (presented) store.commit('setPresentedTab', tabId)
      return presented
    },
    saveScroll () {}
  }
}

function createLoadedSession () {
  let session = restoreCapacitorTabSession(null, HOME_ROUTE, () => 'tab-a')
  session = completeCapacitorTabMount(session, 'tab-a', 1)
  return session
}

test('does not close or unload the presented tab while another tab is mounting', async () => {
  for (const action of ['closeTab', 'unloadTab']) {
    let session = createLoadedSession()
    session = addCapacitorTab(session, createCapacitorTab(WATCH_ROUTE, 'Video', 'tab-b'))
    const store = createStore(session, 'tab-a')
    const service = new CapacitorTabService(createRouter(), store, createNavigation(store))

    assert.equal(await service[action]('tab-a'), false)
    assert.equal(store.getters.getTabById('tab-a').loadState, 'loaded')
    assert.equal(store.getters.getPresentedTabId, 'tab-a')
  }
})

test('rolls back failed activation without discarding the target tab', async () => {
  let session = createLoadedSession()
  session = addCapacitorTab(session, createCapacitorTab(WATCH_ROUTE, 'Video', 'tab-b'))
  session = completeCapacitorTabMount(session, 'tab-b', 1)
  session = activateCapacitorTab(session, 'tab-a')
  session = unloadCapacitorTab(session, 'tab-b')
  const store = createStore(session)
  const service = new CapacitorTabService(createRouter(), store, createNavigation(store))

  assert.equal(await service.activateTab('tab-b'), false)
  assert.deepEqual(store.getters.getTabs.map(tab => tab.id), ['tab-a', 'tab-b'])
  assert.equal(store.getters.getTabById('tab-b').loadState, 'unloaded')
  assert.equal(store.getters.getActiveTabId, 'tab-a')
  assert.equal(store.getters.getPresentedTabId, 'tab-a')
})

test('does not roll back over a newer tab selection', async () => {
  let session = createLoadedSession()
  session = addCapacitorTab(session, createCapacitorTab(WATCH_ROUTE, 'Video', 'tab-b'))
  session = activateCapacitorTab(session, 'tab-a')
  const previousRevision = session.selectionRevision
  const store = createStore(session)
  const navigation = createNavigation(store)
  navigation.requestPresentation = async () => {
    const newer = activateCapacitorTab(service.currentSession(), 'tab-a')
    store.commit('setTabsState', toRuntimeTabState(newer, 'tab-a'))
    return false
  }
  const service = new CapacitorTabService(createRouter(), store, navigation)

  assert.equal(await service.activateTab('tab-b'), false)
  assert.equal(store.getters.getActiveTabId, 'tab-a')
  assert.equal(store.runtime.selectionRevision, previousRevision + 2)
  assert.deepEqual(store.getters.getTabs.map(tab => tab.id), ['tab-a', 'tab-b'])
})

test('does not roll back over a reload while presentation is pending', async () => {
  let session = createLoadedSession()
  session = addCapacitorTab(session, createCapacitorTab(WATCH_ROUTE, 'Video', 'tab-b'))
  session = completeCapacitorTabMount(session, 'tab-b', 1)
  session = activateCapacitorTab(session, 'tab-a')
  const store = createStore(session)
  let finishPresentation
  const navigation = createNavigation(store)
  navigation.requestPresentation = () => new Promise(resolve => {
    finishPresentation = resolve
  })
  const service = new CapacitorTabService(createRouter(), store, navigation)

  const activation = service.activateTab('tab-b')
  assert.equal(await service.reloadTab('tab-b'), true)
  finishPresentation(false)

  assert.equal(await activation, false)
  assert.equal(store.getters.getActiveTabId, 'tab-b')
  assert.equal(store.getters.getTabById('tab-b').refreshKey, 1)
  assert.equal(store.getters.getTabById('tab-b').mountRevision, 2)
})

test('rolls back newly created tabs when presentation fails', async () => {
  const store = createStore(createLoadedSession())
  const service = new CapacitorTabService(createRouter(), store, createNavigation(store))
  const previousRevision = store.runtime.selectionRevision

  assert.equal(await service.createTab(WATCH_ROUTE), null)
  assert.deepEqual(store.getters.getTabs.map(tab => tab.id), ['tab-a'])
  assert.equal(store.getters.getActiveTabId, 'tab-a')
  assert.equal(store.getters.getPresentedTabId, 'tab-a')
  assert.equal(store.runtime.selectionRevision, previousRevision + 2)
})

test('rolls back duplicated and restored tabs when presentation fails', async () => {
  for (const action of ['duplicateTab', 'restoreClosedTab']) {
    let session = createLoadedSession()
    if (action === 'restoreClosedTab') {
      session = addCapacitorTab(session, createCapacitorTab(WATCH_ROUTE, 'Video', 'tab-b'))
      session = closeCapacitorTab(session, 'tab-b', HOME_ROUTE)
    }
    const store = createStore(session)
    const service = new CapacitorTabService(createRouter(), store, createNavigation(store))

    const result = action === 'duplicateTab'
      ? await service.duplicateTab('tab-a')
      : await service.restoreClosedTab()

    assert.equal(result, null)
    assert.deepEqual(store.getters.getTabs.map(tab => tab.id), ['tab-a'])
    assert.equal(store.getters.getActiveTabId, 'tab-a')
    assert.equal(store.getters.getPresentedTabId, 'tab-a')
  }
})

test('restores the previous session when synced-tab presentation fails', async () => {
  const store = createStore(createLoadedSession())
  const service = new CapacitorTabService(createRouter(), store, createNavigation(store))

  const applied = await service.applySyncSessions([{
    activeTabId: 'tab-synced',
    tabs: [{
      id: 'tab-synced',
      title: 'Synced video',
      url: 'https://localhost/watch/synced',
      isPinned: false
    }]
  }])

  assert.equal(applied, false)
  assert.deepEqual(store.getters.getTabs.map(tab => tab.id), ['tab-a'])
  assert.equal(store.getters.getActiveTabId, 'tab-a')
  assert.equal(store.getters.getPresentedTabId, 'tab-a')
})

for (const action of ['openSyncedSession', 'applySyncSessions']) {
  test(`${action} opens Electron hash routes on mobile`, async () => {
    const store = createStore(createLoadedSession())
    const service = new CapacitorTabService(createRouter(), store, createNavigation(store, true))
    const synced = {
      activeTabId: 'desktop-watch',
      tabs: [{
        id: 'desktop-watch',
        title: 'Desktop video',
        url: 'app://bundle/index.html#/watch/video?timestamp=42#details',
        isPinned: true
      }]
    }

    assert.equal(await service[action](action === 'applySyncSessions' ? [synced] : synced), true)
    assert.equal(store.getters.getActiveTab.route.fullPath, '/watch/video?timestamp=42#details')
    assert.equal(store.getters.getActiveTab.isPinned, true)
  })
}

test('uses tab actions on Android WebViews without Array.toReversed', async () => {
  let session = createLoadedSession()
  session = addCapacitorTab(session, createCapacitorTab(WATCH_ROUTE, 'Video', 'tab-b'))
  session = completeCapacitorTabMount(session, 'tab-b', 1)
  session = activateCapacitorTab(session, 'tab-a')
  const store = createStore(session)
  const service = new CapacitorTabService(createRouter(), store, createNavigation(store, true))
  const toReversed = Array.prototype.toReversed
  Array.prototype.toReversed = undefined

  try {
    assert.equal(await service.closeTab('tab-a'), true)
    assert.deepEqual(store.getters.getTabs.map(tab => tab.id), ['tab-b'])
  } finally {
    Array.prototype.toReversed = toReversed
  }
})

function createThreeTabSession() {
  let session = createLoadedSession()
  for (const id of ['tab-b', 'tab-c']) {
    session = addCapacitorTab(session, createCapacitorTab(WATCH_ROUTE, id, id), false)
    session = completeCapacitorTabMount(session, id, 1)
  }
  return activateCapacitorTab(session, 'tab-b')
}

for (const position of ['end', 'afterCurrent', 'afterCurrentInOrder']) {
  test(`mobile creates background tabs with position ${position}`, async () => {
    const store = createStore(createThreeTabSession())
    store.getters.getNewTabPosition = position
    const service = new CapacitorTabService(createRouter(), store, createNavigation(store, true))
    const first = await service.createTab(WATCH_ROUTE, '', false)
    const second = await service.createTab(WATCH_ROUTE, '', false)
    const expected = position === 'end'
      ? ['tab-a', 'tab-b', 'tab-c', first, second]
      : ['tab-a', 'tab-b', ...(position === 'afterCurrent' ? [second, first] : [first, second]), 'tab-c']
    assert.deepEqual(store.getters.getTabs.map(tab => tab.id), expected)
    assert.equal(store.getters.getActiveTabId, 'tab-b')
  })
}

for (const action of ['closeTab', 'unloadTab']) {
  for (const focus of ['previousTab', 'nextTab']) {
    test(`mobile ${action} respects ${focus}`, async () => {
      const store = createStore(createThreeTabSession())
      store.getters.getTabCloseFocus = focus
      const service = new CapacitorTabService(createRouter(), store, createNavigation(store, true))
      assert.equal(await service[action]('tab-b'), true)
      assert.equal(store.getters.getActiveTabId, focus === 'previousTab' ? 'tab-a' : 'tab-c')
    })
  }
}

for (const behavior of ['loadAllTabs', 'restoreTabLoadState', 'loadLastActiveTab', 'emptySession']) {
  test(`mobile startup applies ${behavior}`, async () => {
    const session = unloadCapacitorTab(createThreeTabSession(), 'tab-c')
    const persisted = {
      ...session,
      tabs: session.tabs.map(({ loadState, ...tab }) => ({ ...tab, isUnloaded: loadState === 'unloaded' })),
    }
    const previousStorage = globalThis.localStorage
    let saved
    globalThis.localStorage = {
      getItem: () => JSON.stringify(saved ?? persisted),
      setItem: (_key, value) => { saved = JSON.parse(value) },
    }
    const store = createStore(createLoadedSession())
    store.getters.getStartupBehavior = behavior
    store.getters.getLandingPage = 'subscriptions'
    store.subscribe = () => () => {}
    const router = createRouter()
    router.afterEach = () => () => {}
    const navigation = createNavigation(store, true)
    navigation.projectRoute = async route => { router.currentRoute.value = route }
    navigation.restoreScroll = () => {}
    const service = new CapacitorTabService(router, store, navigation)
    try {
      await service.initialize({ path: '/', fullPath: '/' })
      if (behavior === 'emptySession') {
        assert.equal(store.getters.getTabs.length, 1)
        assert.equal(store.getters.getActiveTab.route.fullPath, '/subscriptions')
        assert.equal(store.getters.getClosedTabs.length, 0)
      } else {
        assert.equal(store.getters.getActiveTabId, 'tab-b')
        assert.deepEqual(store.getters.getTabs.map(tab => tab.loadState), {
          loadAllTabs: ['mounting', 'mounting', 'mounting'],
          restoreTabLoadState: ['mounting', 'mounting', 'unloaded'],
          loadLastActiveTab: ['unloaded', 'mounting', 'unloaded'],
        }[behavior])
        assert.deepEqual(saved.tabs.map(tab => tab.isUnloaded), store.getters.getTabs.map(tab => tab.isUnloaded))
        store.getters.getNewTabPosition = 'afterCurrentInOrder'
        const first = await service.createTab(WATCH_ROUTE, '', false)
        const second = await service.createTab(WATCH_ROUTE, '', false)
        service.persist()
        service.dispose()
        await service.initialize(HOME_ROUTE)
        const third = await service.createTab(WATCH_ROUTE, '', false)
        assert.deepEqual(store.getters.getTabs.map(tab => tab.id), ['tab-a', 'tab-b', first, second, third, 'tab-c'])
      }
    } finally {
      service.dispose()
      globalThis.localStorage = previousStorage
    }
  })
}

for (const position of ['afterCurrent', 'afterCurrentInOrder']) {
  test(`mobile ${position} keeps new tabs after the pinned group`, async () => {
    const store = createStore(createThreeTabSession())
    store.getters.getNewTabPosition = position
    const service = new CapacitorTabService(createRouter(), store, createNavigation(store, true))
    service.setPinned('tab-a', true)
    service.setPinned('tab-b', true)
    await service.activateTab('tab-a')
    const first = await service.createTab(WATCH_ROUTE, '', false)
    const second = await service.createTab(WATCH_ROUTE, '', false)
    assert.deepEqual(store.getters.getTabs.map(tab => tab.id), [
      'tab-a', 'tab-b', ...(position === 'afterCurrent' ? [second, first] : [first, second]), 'tab-c',
    ])
  })
}

test('mobile starts a new opened-order group after manually moving tabs', async () => {
  const store = createStore(createThreeTabSession())
  store.getters.getNewTabPosition = 'afterCurrentInOrder'
  const service = new CapacitorTabService(createRouter(), store, createNavigation(store, true))
  const first = await service.createTab(WATCH_ROUTE, '', false)
  const second = await service.createTab(WATCH_ROUTE, '', false)
  service.moveTab(first, 4)
  const third = await service.createTab(WATCH_ROUTE, '', false)
  assert.deepEqual(store.getters.getTabs.map(tab => tab.id), ['tab-a', 'tab-b', third, second, 'tab-c', first])
})

test('mobile duplicates tabs using the configured new-tab position', async () => {
  const store = createStore(createThreeTabSession())
  store.getters.getNewTabPosition = 'afterCurrent'
  const service = new CapacitorTabService(createRouter(), store, createNavigation(store, true))
  const duplicate = await service.duplicateTab('tab-b')
  assert.deepEqual(store.getters.getTabs.map(tab => tab.id), ['tab-a', 'tab-b', duplicate, 'tab-c'])
  assert.equal(store.getters.getActiveTabId, duplicate)
})

for (const focus of ['previousTab', 'nextTab']) {
  test(`mobile ${focus} falls back to an already loaded tab on the other side`, async () => {
    const preferred = focus === 'previousTab' ? 'tab-a' : 'tab-c'
    const fallback = focus === 'previousTab' ? 'tab-c' : 'tab-a'
    const store = createStore(unloadCapacitorTab(createThreeTabSession(), preferred))
    store.getters.getTabCloseFocus = focus
    const service = new CapacitorTabService(createRouter(), store, createNavigation(store, true))
    assert.equal(await service.closeTab('tab-b'), true)
    assert.equal(store.getters.getActiveTabId, fallback)
  })
}

for (const action of ['closeTab', 'unloadTab']) {
  for (const focus of ['previousTab', 'nextTab']) {
    test(`mobile ${action} with ${focus} selects the nearest unloaded neighbor`, async () => {
      const activeTabId = focus === 'previousTab' ? 'tab-c' : 'tab-a'
      const session = activateCapacitorTab(unloadCapacitorTab(createThreeTabSession(), 'tab-b'), activeTabId)
      const store = createStore(session)
      store.getters.getTabCloseFocus = focus
      const service = new CapacitorTabService(createRouter(), store, createNavigation(store, true))
      assert.equal(await service[action](activeTabId), true)
      assert.equal(store.getters.getActiveTabId, 'tab-b')
    })
  }
}

for (const rememberHistory of [true, false, undefined]) {
  test(`mobile navigation history persistence honors ${rememberHistory ?? 'the default'}`, async () => {
    const history = [HOME_ROUTE, WATCH_ROUTE, { path: '/history', fullPath: '/history' }]
      .map((route, index) => ({ route, title: route.fullPath, scroll: { left: 0, top: index * 100 } }))
    const tab = { ...createCapacitorTab(WATCH_ROUTE, 'Video', 'tab-a'), history, historyIndex: 1 }
    let saved = { tabs: [tab], closedTabs: [{ ...tab, id: 'closed-tab' }], activeTabId: tab.id }
    const previousStorage = globalThis.localStorage
    globalThis.localStorage = {
      getItem: () => JSON.stringify(saved),
      setItem: (_key, value) => { saved = JSON.parse(value) },
    }
    const store = createStore(createLoadedSession())
    store.getters.getRememberTabNavigationHistory = rememberHistory
    const router = createRouter()
    router.afterEach = () => () => {}
    const navigation = createNavigation(store, true)
    navigation.projectRoute = async route => { router.currentRoute.value = route }
    navigation.restoreScroll = () => {}
    const service = new CapacitorTabService(router, store, navigation)
    try {
      await service.initialize(HOME_ROUTE)
      for (const restored of [store.getters.getActiveTab, store.getters.getClosedTabs[0]]) {
        assert.equal(restored.history.length, rememberHistory === true ? 3 : 1)
        assert.equal(restored.historyIndex, rememberHistory === true ? 1 : 0)
        assert.equal(restored.route.fullPath, WATCH_ROUTE.fullPath)
      }
      for (const persisted of [...saved.tabs, ...saved.closedTabs]) {
        assert.equal(Object.hasOwn(persisted, 'history'), rememberHistory === true)
        assert.equal(Object.hasOwn(persisted, 'historyIndex'), rememberHistory === true)
      }
      if (rememberHistory === true) {
        assert.equal(store.getters.getActiveTab.history[1].scroll.top, 100)
        store.commit('setRememberTabNavigationHistory', false)
        for (const persisted of [...saved.tabs, ...saved.closedTabs]) {
          assert.equal(Object.hasOwn(persisted, 'history'), false)
          assert.equal(Object.hasOwn(persisted, 'historyIndex'), false)
        }
        // Turning persistence off must leave in-session back/forward navigation intact.
        assert.equal(store.getters.getActiveTab.history.length, 3)
        store.commit('setRememberTabNavigationHistory', true)
        assert.equal(saved.tabs[0].history.length, 3)
        assert.equal(saved.closedTabs[0].history.length, 3)
      }
    } finally {
      service.dispose()
      globalThis.localStorage = previousStorage
    }
  })
}
