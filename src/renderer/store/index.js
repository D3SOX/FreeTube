import { createStore } from 'vuex'
// import createPersistedState from 'vuex-persistedstate'

import downloads from './modules/downloads'
import history from './modules/history'
import recommendations from './modules/recommendations'
import invidious from './modules/invidious'
import playlists from './modules/playlists'
import profiles from './modules/profiles'
import settings, { isSettingSyncEnabled, isSettingSyncable } from './modules/settings'
import searchHistory from './modules/search-history'
import subscriptionCache from './modules/subscription-cache'
import utils from './modules/utils'
import player from './modules/player'
import tabs from './modules/tabs'
import watchStats from './modules/watch-stats'
import watchQueue from './modules/watch-queue'
import syncServer from './modules/sync-server'
import {
  SYNC_ACTION_REASONS,
  SYNC_MUTATION_REASONS,
} from '../helpers/sync-server-scheduling'

function syncOnLocalChanges(store) {
  const revisions = new Map()
  const actionRevisions = new WeakMap()
  const settingValues = new Map(Object.entries(store.state.settings).map(([key, value]) => {
    return [key, JSON.stringify(value)]
  }))

  const incrementRevision = reason => {
    revisions.set(reason, (revisions.get(reason) ?? 0) + 1)
  }

  store.subscribe((mutation, state) => {
    const reason = SYNC_MUTATION_REASONS.get(mutation.type)
    if (reason) incrementRevision(reason)

    if (mutation.type.startsWith('set')) {
      const setting = mutation.type.charAt(3).toLowerCase() + mutation.type.slice(4)
      if (isSettingSyncable(setting)) {
        const value = JSON.stringify(state.settings[setting])
        if (settingValues.get(setting) !== value) incrementRevision('settings')
        settingValues.set(setting, value)
      }
    }
  })

  store.subscribeAction({
    before: action => {
      const setting = action.type.startsWith('update')
        ? action.type.charAt(6).toLowerCase() + action.type.slice(7)
        : ''
      const reason = isSettingSyncable(setting)
        ? 'settings'
        : SYNC_ACTION_REASONS.get(action.type)
      if (reason) actionRevisions.set(action, revisions.get(reason) ?? 0)
    },
    after: action => {
      const setting = action.type.startsWith('update')
        ? action.type.charAt(6).toLowerCase() + action.type.slice(7)
        : ''
      const syncableSetting = isSettingSyncable(setting)
      const reason = syncableSetting ? 'settings' : SYNC_ACTION_REASONS.get(action.type)
      if (reason && (revisions.get(reason) ?? 0) !== actionRevisions.get(action)) {
        const syncEnabled = isSettingSyncEnabled(store.state.settings, setting)
        if (!syncableSetting || syncEnabled) {
          store.dispatch('scheduleSyncServer', reason)
        }
      }
    },
  })
}

function reloadRecommendationEvidenceAfterHistoryRemoval(store) {
  store.subscribe(mutation => {
    if (!store.getters.getRecommendationEpoch) return
    // Persistence can remove evidence and change its epoch even when no cached
    // history IDs disappear, such as clearing empty history with saved feedback.
    const mayRemoveHistory = mutation.type === 'setHistoryCacheSorted' ||
      mutation.type === 'removeFromHistoryCacheById' ||
      (mutation.type === 'removeMultipleFromHistoryCache' && mutation.payload.length > 0) ||
      (mutation.type === 'applyHistorySyncChanges' && mutation.payload.deletions.length > 0)
    if (mayRemoveHistory) {
      store.dispatch('loadRecommendations').catch(error => console.error('Could not reload recommendation evidence', error))
    }
  })
}

export default createStore({
  modules: {
    downloads,
    history,
    recommendations,
    invidious,
    playlists,
    profiles,
    settings,
    searchHistory,
    subscriptionCache,
    utils,
    player,
    tabs,
    watchStats,
    watchQueue,
    syncServer,
  },

  // Detects unsafe changes to the store state e.g. outside of mutations
  // but we have to turn it off despite its usefulness as we have so much data in the store
  // that it causes a noticable slow-down :(
  strict: false,
  plugins: [syncOnLocalChanges, reloadRecommendationEvidenceAfterHistoryRemoval]

  // TODO: Enable when deploy
  // plugins: [createPersistedState()]
})
