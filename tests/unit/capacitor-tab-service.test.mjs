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
    commit (type, payload) {
      if (type === 'setTabsState') runtime = payload
      else if (type === 'setPresentedTab') runtime.presentedTabId = payload
      else throw new Error(`Unexpected mutation: ${type}`)
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
