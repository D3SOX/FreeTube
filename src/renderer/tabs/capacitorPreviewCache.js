// Last-seen images are local to this runtime and never enter persisted/synced tabs.
export function createCapacitorPreviewCache(capture, entries = new Map(), limit = 24) {
  let generation = 0
  let pending = null
  return {
    entries,
    get(tab) {
      const entry = entries.get(tab.id)
      return entry && entry.route === tab.route?.fullPath ? entry.image : null
    },
    invalidate() { generation += 1 },
    clear() { generation += 1; entries.clear() },
    prune(tabs) {
      for (const [id, entry] of entries) {
        if (!tabs.some(tab => tab.id === id && tab.route.fullPath === entry.route)) entries.delete(id)
      }
    },
    async capture(tab) {
      if (pending) return pending
      const revision = generation
      const { id, route: { fullPath: route } } = tab
      pending = (async () => {
        try {
          const image = await capture()
          if (!image || revision !== generation) return
          entries.delete(id)
          entries.set(id, { route, image })
          while (entries.size > limit) entries.delete(entries.keys().next().value)
        } catch (error) {
          console.warn('Failed to capture mobile tab preview:', error)
        }
      })()
      try { await pending } finally { pending = null }
    }
  }
}

export function canCaptureCapacitorTab(getters, visible) {
  const tab = getters.getPresentedTab
  return !!(getters.getShowTabPreviews && !getters.isAnyPromptOpen &&
    !getters.getSettingsWindowOpen && !getters.getSettingsWindowMorphing &&
    visible && tab && !tab.isLoading && tab.id === getters.getActiveTabId &&
    tab.loadState === 'loaded')
}
