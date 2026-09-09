import {
  activateCapacitorTab,
  addCapacitorTab,
  closeCapacitorTab,
  completeCapacitorTabMount,
  createCapacitorTab,
  loadCapacitorTab,
  moveCapacitorTab,
  reloadCapacitorTab,
  restoreClosedCapacitorTab,
  restoreCapacitorTabSession,
  setCapacitorTabPinned,
  toRuntimeTabState,
  unloadCapacitorTab
} from './capacitorTabState.js'
import { tabMediaCoordinator } from './TabMediaCoordinator.js'
import { getSyncTabRoute } from '../helpers/sync-sessions.js'

const STORAGE_KEY = 'opentubex-capacitor-tabs'
const PERSISTED_MUTATIONS = new Set([
  'setHistoryEntryScroll',
  'setPresentedTab',
  'setTabContentTitle',
  'setTabNavigation',
  'setTabsState'
])

let service = null

export function initializeCapacitorTabService(router, store, navigation) {
  service?.dispose()
  service = new CapacitorTabService(router, store, navigation)
  return service
}

export function getCapacitorTabService() {
  if (!service) throw new Error('Capacitor tab service has not been initialized')
  return service
}

export class CapacitorTabService {
  constructor(router, store, navigation) {
    this.router = router
    this.store = store
    this.navigation = navigation
    this.initialized = false
    this.sessionGeneration = 0
    this.removeRouterHook = () => {}
    this.removeStoreSubscription = () => {}
  }

  async initialize(currentRoute) {
    if (this.initialized) return

    const startupBehavior = this.store.getters.getStartupBehavior ?? 'loadLastActiveTab'
    const persisted = startupBehavior === 'emptySession' ? null : readPersistedSession()
    const initialRoute = currentRoute.path === '/'
      ? this.router.resolve(`/${this.store.getters.getLandingPage}`)
      : currentRoute
    this.sessionUpdatedAt = Number.isFinite(persisted?.updatedAt)
      ? persisted.updatedAt
      : Date.now()
    let session = restoreCapacitorTabSession(
      persisted,
      initialRoute
    )
    for (const tab of session.tabs) {
      if (tab.id === session.activeTabId || startupBehavior === 'loadAllTabs') {
        session = loadCapacitorTab(session, tab.id)
      } else if (startupBehavior !== 'restoreTabLoadState') {
        session = unloadCapacitorTab(session, tab.id)
      }
    }
    this.commitSession(session, session.activeTabId)
    this.store.commit('setPresentedTab', session.activeTabId)
    tabMediaCoordinator.setPresented(session.activeTabId)
    this.initialized = true

    this.removeRouterHook = this.router.afterEach((to, _from, failure) => {
      if (failure || !this.initialized) return

      const tabId = this.store.getters.getActiveTabId
      const tab = this.store.getters.getTabById(tabId)
      if (!tab || tab.route.fullPath === to.fullPath) return

      this.navigation.push(tabId, to).catch(error => {
        console.error('Failed to record Capacitor tab navigation:', error)
      })
    })
    this.removeStoreSubscription = this.store.subscribe((mutation) => {
      if (PERSISTED_MUTATIONS.has(mutation.type)) this.persist()
    })

    const activeTab = this.store.getters.getActiveTab
    if (activeTab?.route.fullPath !== this.router.currentRoute.value.fullPath) {
      await this.navigation.projectRoute(activeTab.route)
      this.navigation.restoreScroll(activeTab.id)
    }
    this.navigation.projectTitle(session.activeTabId)
    this.persist()
  }

  async createTab(location = `/${this.store.getters.getLandingPage}`, title = '', makeActive = true) {
    const tab = createCapacitorTab(this.router.resolve(location), title)
    const previous = this.currentSession()
    const session = addCapacitorTab(previous, tab, makeActive, this.store.getters.getNewTabPosition ?? 'afterCurrentInOrder')
    if (!makeActive) {
      this.commitSession(session)
      return tab.id
    }

    return await this.commitAndPresent(previous, session) ? tab.id : null
  }

  async activateTab(tabId) {
    const previous = this.currentSession()
    const session = activateCapacitorTab(loadCapacitorTab(previous, tabId), tabId)
    if (session === previous) return false

    return await this.commitAndPresent(previous, session)
  }

  async duplicateTab(tabId) {
    const source = this.store.getters.getTabById(tabId)
    if (!source) return null

    const tab = createCapacitorTab(source.route)
    tab.title = source.contentTitle || source.title || source.route.fullPath
    const previous = this.currentSession()
    const session = addCapacitorTab(previous, tab, true, this.store.getters.getNewTabPosition ?? 'afterCurrentInOrder')
    return await this.commitAndPresent(previous, session) ? tab.id : null
  }

  async closeTab(tabId) {
    let previous = this.currentSession()
    if (!previous.tabs.some(tab => tab.id === tabId)) return false

    const wasActive = previous.activeTabId === tabId
    const wasPresented = this.store.getters.getPresentedTabId === tabId
    if (wasPresented && !wasActive) return false
    if (wasActive) this.navigation.saveScroll(tabId)

    if (wasActive && previous.tabs.length > 1) {
      const nextTabId = findReplacementTabId(previous.tabs, tabId, this.store.getters.getTabCloseFocus)
      if (!nextTabId || !await this.activateTab(nextTabId)) return false
      previous = this.currentSession()
    }

    const landingRoute = this.router.resolve(`/${this.store.getters.getLandingPage}`)
    let session = closeCapacitorTab(previous, tabId, landingRoute)
    const needsPresentation = session.activeTabId === tabId
    if (needsPresentation) {
      session = loadCapacitorTab(session, session.activeTabId)
    }
    if (needsPresentation) {
      return await this.commitAndPresent(previous, session)
    }

    this.commitSession(session)
    return true
  }

  async restoreClosedTab() {
    const previous = this.currentSession()
    const session = restoreClosedCapacitorTab(previous)
    if (session === previous) return null

    return await this.commitAndPresent(previous, session) ? session.activeTabId : null
  }

  getSyncSessions() {
    const session = this.currentSession()
    return [{
      sessionId: 'mobile',
      updatedAt: this.sessionUpdatedAt,
      activeTabId: session.activeTabId,
      tabs: session.tabs.map(tab => ({
        id: tab.id,
        url: new URL(tab.route.fullPath, window.location.origin).toString(),
        title: tab.title,
        isPinned: tab.isPinned,
      })),
    }]
  }

  async applySyncSessions(sessions) {
    const synced = sessions.find(session => Array.isArray(session?.tabs) && session.tabs.length > 0)
    if (!synced) return false

    const previous = this.currentSession()
    const tabs = synced.tabs.map(tab => createCapacitorTab(
      this.router.resolve(getSyncTabRoute(tab.url)),
      tab.title,
      tab.id
    )).map((tab, index) => ({
      ...tab,
      isPinned: synced.tabs[index].isPinned === true,
    }))
    const session = restoreCapacitorTabSession({
      tabs,
      activeTabId: tabs.some(tab => tab.id === synced.activeTabId)
        ? synced.activeTabId
        : tabs[0].id,
      closedTabs: [],
    }, this.router.currentRoute.value)
    if (!await this.commitAndPresent(previous, session)) return false

    this.sessionUpdatedAt = Number.isFinite(synced.updatedAt) ? synced.updatedAt : Date.now()
    this.persist()
    return true
  }

  async openSyncedSession(session) {
    if (!Array.isArray(session?.tabs) || session.tabs.length === 0) return false

    for (const tab of session.tabs) {
      const tabId = await this.createTab(getSyncTabRoute(tab.url), tab.title)
      if (!tabId) return false
      if (tab.isPinned === true) this.setPinned(tabId, true)
    }
    return true
  }

  setPinned(tabId, pinned) {
    const previous = this.currentSession()
    const session = setCapacitorTabPinned(previous, tabId, pinned)
    if (session === previous) return false

    this.commitSession(session)
    return true
  }

  moveTab(tabId, targetIndex) {
    const previous = this.currentSession()
    const session = moveCapacitorTab(previous, tabId, targetIndex)
    if (session === previous) return false

    this.commitSession(session)
    return true
  }

  async reloadTab(tabId) {
    const tab = this.store.getters.getTabById(tabId)
    if (!tab) return false

    if (tab.route.path.startsWith('/watch/')) {
      const timestamp = this.store.getters.getWatchTimestamp(tabId)
      if (typeof timestamp === 'number' && timestamp > 0) {
        this.navigation.prepareReload(tabId, {
          path: tab.route.path,
          query: { ...tab.route.query, oneTimeTimestamp: Math.floor(timestamp) }
        })
      }
    }

    const previous = this.currentSession()
    const session = reloadCapacitorTab(previous, tabId)
    if (session === previous) return false

    this.commitSession(session)
    return true
  }

  loadTab(tabId) {
    const previous = this.currentSession()
    const session = loadCapacitorTab(previous, tabId)
    if (session === previous) return false

    this.commitSession(session)
    return true
  }

  async unloadTab(tabId) {
    let session = this.currentSession()
    const tab = session.tabs.find(candidate => candidate.id === tabId)
    if (!tab || tab.loadState === 'unloaded' || tab.loadState === 'unloading') return false

    if (this.store.getters.getPresentedTabId === tabId && session.activeTabId !== tabId) {
      return false
    }

    if (session.activeTabId === tabId) {
      if (session.tabs.length <= 1) return false

      const nextTabId = findReplacementTabId(session.tabs, tabId, this.store.getters.getTabCloseFocus)
      if (!nextTabId || !await this.activateTab(nextTabId)) return false
      session = this.currentSession()
    }

    const unloaded = unloadCapacitorTab(session, tabId)
    if (unloaded === session) return false

    this.commitSession(unloaded)
    return true
  }

  markTabMounted(tabId, mountRevision) {
    const previous = this.currentSession()
    const session = completeCapacitorTabMount(previous, tabId, mountRevision)
    if (session !== previous) this.commitSession(session)
  }

  markTabMountFailed(tabId, mountRevision) {
    const previous = this.currentSession()
    const session = completeCapacitorTabMount(previous, tabId, mountRevision, false)
    if (session !== previous) this.commitSession(session)
  }

  async commitAndPresent(previous, session) {
    const previousPresentedTabId = this.store.getters.getPresentedTabId
    const presentationGeneration = this.commitSession(session)
    if (await this.navigation.requestPresentation(session.activeTabId, session.selectionRevision)) {
      return true
    }

    const current = this.currentSession()
    if (
      this.sessionGeneration !== presentationGeneration ||
      current.activeTabId !== session.activeTabId ||
      current.selectionRevision !== session.selectionRevision
    ) {
      return false
    }

    const rollbackPresentedTabId = previous.tabs.some(tab => tab.id === previousPresentedTabId)
      ? previousPresentedTabId
      : previous.activeTabId
    const rollback = {
      ...previous,
      selectionRevision: current.selectionRevision + 1
    }
    this.commitSession(rollback, rollbackPresentedTabId)
    await this.navigation.requestPresentation(rollback.activeTabId, rollback.selectionRevision)
    return false
  }

  currentSession() {
    return {
      tabs: this.store.getters.getTabs.map(tab => ({
        id: tab.id,
        title: tab.contentTitle || tab.title || tab.route.fullPath,
        isPinned: tab.isPinned === true,
        placementOpenerTabId: tab.placementOpenerTabId,
        route: tab.route,
        history: tab.history,
        historyIndex: tab.historyIndex,
        loadState: tab.loadState,
        mountRevision: tab.mountRevision,
        refreshKey: tab.refreshKey,
        isLoading: tab.isLoading,
        isPlaying: tab.isPlaying,
        pendingReloadRoute: tab.pendingReloadRoute
      })),
      closedTabs: this.store.getters.getClosedTabs.slice().reverse().map(tab => ({
        id: tab.id,
        title: tab.title || tab.route.fullPath,
        isPinned: tab.isPinned === true,
        placementOpenerTabId: tab.placementOpenerTabId,
        route: tab.route,
        history: tab.history,
        historyIndex: tab.historyIndex
      })),
      activeTabId: this.store.getters.getActiveTabId,
      selectionRevision: this.store.state.tabs.selectionRevision,
      updatedAt: this.sessionUpdatedAt,
    }
  }

  commitSession(session, presentedTabId = this.store.getters.getPresentedTabId ?? session.activeTabId) {
    this.store.commit('setTabsState', toRuntimeTabState(session, presentedTabId))
    this.sessionGeneration += 1
    return this.sessionGeneration
  }

  persist() {
    try {
      this.sessionUpdatedAt = Date.now()
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toPersistedSession(this.currentSession())))
    } catch (error) {
      console.error('Failed to persist Capacitor tabs:', error)
    }
  }

  dispose() {
    this.removeRouterHook()
    this.removeStoreSubscription()
    this.initialized = false
  }
}

function findReplacementTabId(tabs, tabId, focus) {
  const tabIndex = tabs.findIndex(tab => tab.id === tabId)
  if (tabIndex === -1) return null

  const previous = tabs[tabIndex - 1]
  const next = tabs[tabIndex + 1]
  const [preferred, fallback] = focus === 'nextTab' ? [next, previous] : [previous, next]
  // Match desktop: prefer a loaded opposite neighbor, but never skip over
  // the nearest tab on the configured side to find a more distant loaded tab.
  if (preferred?.loadState !== 'loaded' && fallback?.loadState === 'loaded') return fallback.id
  return preferred?.id ?? fallback?.id ?? null
}

function toPersistedSession(session) {
  const serializeTab = (tab, includeLoadState) => ({
    id: tab.id,
    title: tab.title,
    isPinned: tab.isPinned,
    placementOpenerTabId: tab.placementOpenerTabId,
    route: tab.route,
    history: tab.history,
    historyIndex: tab.historyIndex,
    ...(includeLoadState && { isUnloaded: tab.loadState === 'unloaded' })
  })

  return {
    tabs: session.tabs.map(tab => serializeTab(tab, true)),
    closedTabs: session.closedTabs.map(tab => serializeTab(tab, false)),
    activeTabId: session.activeTabId,
    selectionRevision: session.selectionRevision,
    updatedAt: session.updatedAt
  }
}

function readPersistedSession() {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === null ? null : JSON.parse(value)
  } catch (error) {
    console.error('Failed to restore Capacitor tabs:', error)
    return null
  }
}
