const MAX_CLOSED_CAPACITOR_TABS = 10

export function createCapacitorTab(route, title = '', id = window.crypto.randomUUID()) {
  const normalizedRoute = normalizeRoute(route)
  const resolvedTitle = typeof title === 'string' && title.length > 0
    ? title
    : normalizedRoute.fullPath

  return {
    id,
    title: resolvedTitle,
    isPinned: false,
    loadState: 'mounting',
    mountRevision: 1,
    refreshKey: 0,
    isLoading: true,
    route: normalizedRoute,
    history: [{
      route: cloneRoute(normalizedRoute),
      title: resolvedTitle,
      scroll: { left: 0, top: 0 }
    }],
    historyIndex: 0
  }
}

export function restoreCapacitorTabSession(value, currentRoute, createId = () => window.crypto.randomUUID()) {
  const seenIds = new Set()
  const tabs = Array.isArray(value?.tabs)
    ? value.tabs
        .filter(tab => {
          if (!isValidPersistedTab(tab) || seenIds.has(tab.id)) return false
          seenIds.add(tab.id)
          return true
        })
        .map(normalizeRestoredTab)
    : []

  const closedTabIds = new Set()
  const closedTabs = Array.isArray(value?.closedTabs)
    ? value.closedTabs
        .filter(tab => {
          if (!isValidPersistedTab(tab) || closedTabIds.has(tab.id)) return false
          closedTabIds.add(tab.id)
          return true
        })
        .slice(-MAX_CLOSED_CAPACITOR_TABS)
        .map(normalizePersistedTab)
    : []

  if (tabs.length === 0) {
    const tab = createCapacitorTab(currentRoute, '', createId())
    return { tabs: [tab], closedTabs, activeTabId: tab.id, selectionRevision: 0 }
  }

  const activeTabId = tabs.some(tab => tab.id === value.activeTabId)
    ? value.activeTabId
    : tabs[0].id

  return {
    tabs,
    closedTabs,
    activeTabId,
    selectionRevision: Number.isInteger(value.selectionRevision) && value.selectionRevision >= 0
      ? value.selectionRevision
      : 0
  }
}

export function addCapacitorTab(session, tab, makeActive = true, position = 'end') {
  const tabs = [...session.tabs]
  const openerIndex = tabs.findIndex(candidate => candidate.id === session.activeTabId)
  const pinnedCount = tabs.filter(candidate => candidate.isPinned).length
  let insertIndex = tabs.length
  if (position !== 'end' && openerIndex !== -1) {
    insertIndex = Math.max(openerIndex + 1, tab.isPinned ? 0 : pinnedCount)
    if (position === 'afterCurrentInOrder') {
      while (tabs[insertIndex]?.placementOpenerTabId === session.activeTabId) insertIndex += 1
    }
  }
  insertIndex = tab.isPinned ? Math.min(insertIndex, pinnedCount) : Math.max(insertIndex, pinnedCount)
  tabs.splice(insertIndex, 0, normalizePersistedTab({ ...tab, placementOpenerTabId: session.activeTabId }))
  return {
    ...session,
    tabs,
    activeTabId: makeActive ? tab.id : session.activeTabId,
    selectionRevision: session.selectionRevision + Number(makeActive)
  }
}

export function activateCapacitorTab(session, tabId) {
  if (tabId === session.activeTabId || !session.tabs.some(tab => tab.id === tabId)) {
    return session
  }

  return {
    ...session,
    activeTabId: tabId,
    selectionRevision: session.selectionRevision + 1
  }
}

export function loadCapacitorTab(session, tabId) {
  return updateCapacitorTabRuntime(session, tabId, tab => {
    if (tab.loadState !== 'unloaded') return tab

    return {
      ...tab,
      loadState: 'mounting',
      mountRevision: tab.mountRevision + 1,
      isLoading: true,
      isPlaying: false
    }
  })
}

export function unloadCapacitorTab(session, tabId) {
  return updateCapacitorTabRuntime(session, tabId, tab => {
    if (tab.loadState === 'unloaded' || tab.loadState === 'unloading') return tab

    return {
      ...tab,
      loadState: 'unloaded',
      isLoading: false,
      isPlaying: false,
      refreshKey: tab.refreshKey + 1
    }
  })
}

export function reloadCapacitorTab(session, tabId) {
  return updateCapacitorTabRuntime(session, tabId, tab => ({
    ...tab,
    loadState: 'mounting',
    mountRevision: tab.mountRevision + 1,
    refreshKey: tab.refreshKey + 1,
    isLoading: true,
    isPlaying: false
  }))
}

export function completeCapacitorTabMount(session, tabId, mountRevision, succeeded = true) {
  return updateCapacitorTabRuntime(session, tabId, tab => {
    if (tab.mountRevision !== mountRevision || tab.loadState !== 'mounting') return tab

    return {
      ...tab,
      loadState: succeeded ? 'loaded' : 'unloaded',
      isLoading: false
    }
  })
}

export function closeCapacitorTab(session, tabId, fallbackRoute) {
  const closedIndex = session.tabs.findIndex(tab => tab.id === tabId)
  if (closedIndex === -1) return session

  if (session.tabs.length === 1) {
    const tab = createCapacitorTab(fallbackRoute, '', tabId)
    tab.mountRevision = session.tabs[0].mountRevision + 1
    tab.refreshKey = session.tabs[0].refreshKey + 1
    return {
      ...session,
      tabs: [tab],
      activeTabId: tabId,
      selectionRevision: session.selectionRevision + 1
    }
  }

  const tabs = session.tabs.filter(tab => tab.id !== tabId)
  const closedTabs = [
    ...(session.closedTabs ?? []),
    normalizePersistedTab(session.tabs[closedIndex])
  ].slice(-MAX_CLOSED_CAPACITOR_TABS)
  const activeTabId = session.activeTabId === tabId
    ? tabs[Math.min(closedIndex, tabs.length - 1)].id
    : session.activeTabId

  return {
    ...session,
    tabs,
    closedTabs,
    activeTabId,
    selectionRevision: session.selectionRevision + Number(activeTabId !== session.activeTabId)
  }
}

export function restoreClosedCapacitorTab(session, createId = () => window.crypto.randomUUID()) {
  if (!Array.isArray(session.closedTabs) || session.closedTabs.length === 0) return session

  const closedTab = session.closedTabs.at(-1)
  const tab = normalizePersistedTab({
    ...closedTab,
    id: createId(),
    loadState: 'mounting',
    mountRevision: 1,
    refreshKey: 0
  })
  const tabs = tab.isPinned
    ? [
        ...session.tabs.filter(candidate => candidate.isPinned),
        tab,
        ...session.tabs.filter(candidate => !candidate.isPinned)
      ]
    : [...session.tabs, tab]

  return {
    ...session,
    tabs,
    closedTabs: session.closedTabs.slice(0, -1),
    activeTabId: tab.id,
    selectionRevision: session.selectionRevision + 1
  }
}

export function setCapacitorTabPinned(session, tabId, pinned) {
  if (!session.tabs.some(tab => tab.id === tabId) ||
      session.tabs.find(tab => tab.id === tabId).isPinned === pinned) {
    return session
  }

  const updated = session.tabs.map(tab => ({
    ...tab,
    isPinned: tab.id === tabId ? pinned : tab.isPinned,
    placementOpenerTabId: null
  }))
  return {
    ...session,
    tabs: [
      ...updated.filter(tab => tab.isPinned),
      ...updated.filter(tab => !tab.isPinned)
    ]
  }
}

export function moveCapacitorTab(session, tabId, targetIndex) {
  const sourceIndex = session.tabs.findIndex(tab => tab.id === tabId)
  if (sourceIndex === -1) return session

  const source = session.tabs[sourceIndex]
  const groupIndices = session.tabs
    .map((tab, index) => ({ tab, index }))
    .filter(({ tab }) => tab.isPinned === source.isPinned)
    .map(({ index }) => index)
  const clampedIndex = Math.max(groupIndices[0], Math.min(targetIndex, groupIndices.at(-1)))
  if (sourceIndex === clampedIndex) return session

  const tabs = [...session.tabs]
  tabs.splice(sourceIndex, 1)
  tabs.splice(clampedIndex, 0, source)
  return { ...session, tabs: tabs.map(tab => ({ ...tab, placementOpenerTabId: null })) }
}

export function toRuntimeTabState(session, presentedTabId = session.activeTabId) {
  return {
    tabs: session.tabs.map(tab => ({
      ...tab,
      syncedNavigationRevision: session.selectionRevision,
      isActive: tab.id === session.activeTabId,
      isActivatable: tab.loadState !== 'unloading',
      isUnloaded: tab.loadState === 'unloaded',
      isLoading: tab.isLoading === true || tab.loadState === 'mounting',
      isPlaying: tab.isPlaying === true,
      isPinned: tab.isPinned,
      preloadInBackground: tab.loadState === 'mounting' && tab.id !== session.activeTabId
    })),
    groups: [],
    closedTabs: (session.closedTabs ?? []).slice().reverse().map(tab => ({
      ...tab,
      route: cloneRoute(tab.route),
      history: tab.history.map(entry => ({
        ...entry,
        route: cloneRoute(entry.route),
        scroll: { ...entry.scroll }
      }))
    })),
    activeTabId: session.activeTabId,
    presentedTabId,
    selectionRevision: session.selectionRevision,
    tabBarScrollPosition: 0
  }
}

function isValidPersistedTab(tab) {
  return tab !== null &&
    typeof tab === 'object' &&
    typeof tab.id === 'string' &&
    tab.id.length > 0 &&
    tab.route !== null &&
    typeof tab.route === 'object'
}

function normalizePersistedTab(tab) {
  const route = normalizeRoute(tab.route)
  const title = typeof tab.title === 'string' && tab.title.length > 0
    ? tab.title
    : route.fullPath
  const history = Array.isArray(tab.history) && tab.history.length > 0
    ? tab.history.map(entry => ({
        route: cloneRoute(entry?.route),
        title: typeof entry?.title === 'string' ? entry.title : entry?.route?.fullPath || '/',
        titlePending: entry?.titlePending === true,
        scroll: {
          left: Number.isFinite(entry?.scroll?.left) ? entry.scroll.left : 0,
          top: Number.isFinite(entry?.scroll?.top) ? entry.scroll.top : 0
        }
      }))
    : createCapacitorTab(route, title, tab.id).history
  const historyIndex = Number.isInteger(tab.historyIndex)
    ? Math.max(0, Math.min(tab.historyIndex, history.length - 1))
    : history.length - 1

  history[historyIndex].route = cloneRoute(route)
  history[historyIndex].title = title

  return {
    id: tab.id,
    title,
    isPinned: tab.isPinned === true,
    placementOpenerTabId: typeof tab.placementOpenerTabId === 'string' ? tab.placementOpenerTabId : null,
    route,
    history,
    historyIndex,
    loadState: normalizeLoadState(tab),
    mountRevision: Number.isInteger(tab.mountRevision) && tab.mountRevision >= 0
      ? tab.mountRevision
      : 0,
    refreshKey: Number.isInteger(tab.refreshKey) && tab.refreshKey >= 0
      ? tab.refreshKey
      : 0,
    isLoading: tab.isLoading === true,
    isPlaying: tab.isPlaying === true
  }
}

function normalizeRestoredTab(tab) {
  const normalized = normalizePersistedTab(tab)
  if (normalized.loadState === 'unloaded') return normalized

  return {
    ...normalized,
    loadState: 'mounting',
    mountRevision: 1,
    isLoading: true,
    isPlaying: false
  }
}

function normalizeLoadState(tab) {
  if (['loaded', 'mounting', 'unloading', 'unloaded'].includes(tab.loadState)) {
    return tab.loadState
  }
  return tab.isUnloaded === true ? 'unloaded' : 'loaded'
}

function updateCapacitorTabRuntime(session, tabId, update) {
  const tabIndex = session.tabs.findIndex(tab => tab.id === tabId)
  if (tabIndex === -1) return session

  const tab = session.tabs[tabIndex]
  const updatedTab = update(tab)
  if (updatedTab === tab) return session

  const tabs = [...session.tabs]
  tabs[tabIndex] = updatedTab
  return { ...session, tabs }
}

function normalizeRoute(route) {
  const path = typeof route?.path === 'string' && route.path.length > 0
    ? route.path
    : '/'
  const query = normalizeQuery(route?.query)
  const hash = typeof route?.hash === 'string' ? route.hash : ''
  const fullPath = typeof route?.fullPath === 'string' && route.fullPath.length > 0
    ? route.fullPath
    : buildFullPath(path, query, hash)

  return {
    name: typeof route?.name === 'string' ? route.name : null,
    path: path.startsWith('/') ? path : `/${path}`,
    params: normalizeQuery(route?.params),
    query,
    hash,
    fullPath
  }
}

function cloneRoute(route) {
  const normalized = normalizeRoute(route)
  return {
    ...normalized,
    params: { ...normalized.params },
    query: Object.fromEntries(Object.entries(normalized.query).map(([key, value]) => [
      key,
      Array.isArray(value) ? [...value] : value
    ]))
  }
}

function normalizeQuery(query) {
  if (!query || typeof query !== 'object') return {}

  return Object.fromEntries(
    Object.entries(query)
      .filter(([, value]) => value != null)
      .map(([key, value]) => [key, Array.isArray(value) ? value.map(String) : String(value)])
  )
}

function buildFullPath(path, query, hash) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      search.append(key, item)
    }
  }
  const queryString = search.toString()
  return `${path.startsWith('/') ? path : `/${path}`}${queryString ? `?${queryString}` : ''}${hash}`
}
