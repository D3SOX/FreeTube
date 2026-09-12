import { DBHistoryHandlers } from '../../../datastores/handlers/index'
import {
  canMarkHistoryEntryAsWatched,
  migrateLegacyHistoryRecord,
} from '../../helpers/history'

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

function getRetentionCutoff(days) {
  const parsedDays = Number(days)
  if (!Number.isInteger(parsedDays) || parsedDays < 1) {
    return null
  }

  return Date.now() - parsedDays * MILLISECONDS_PER_DAY
}

const state = {
  historyCacheSorted: [],

  // Vuex doesn't support Maps, so we have to use an object here instead
  // TODO: switch to a Map during the Pinia migration
  historyCacheById: {}
}

const getters = {
  getHistoryCacheSorted(state) {
    return state.historyCacheSorted
  },

  getHistoryCacheById(state) {
    return state.historyCacheById
  }
}

const actions = {
  async grabHistory({ commit, rootGetters }) {
    try {
      const cutoff = getRetentionCutoff(rootGetters.getHistoryRetentionDays)
      if (cutoff !== null) {
        await DBHistoryHandlers.deleteOlderThan(cutoff)
      }

      const results = await DBHistoryHandlers.find()

      const resultsById = {}
      results.forEach(video => {
        resultsById[video.videoId] = video
      })

      commit('setHistoryCacheSorted', results)
      commit('setHistoryCacheById', resultsById)
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async updateSubscriptionHistory({ commit, dispatch }, update) {
    const result = await DBHistoryHandlers.updateSubscriptionState(update)
    if (result.records.length === 1) {
      commit('upsertToHistoryCache', result.records[0])
    } else if (result.records.length > 1) {
      commit('applyHistorySyncChanges', { insertions: [], updates: result.records, deletions: [] })
    }
    if (result.seenVideos != null) await dispatch('applySubscriptionSeenVideos', result.seenVideos)
    return result.records.length
  },

  async updateHistory({ dispatch }, record) {
    try {
      await dispatch('updateSubscriptionHistory', { records: [record] })
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  /**
   * @param {any} param0
   * @param {Map<string, any>} historyItems
   */
  async overwriteHistory({ commit }, historyItems) {
    try {
      const migratedHistoryItems = new Map(
        Array.from(historyItems, ([videoId, record]) => [videoId, migrateLegacyHistoryRecord(record)])
      )
      const sortedRecords = Array.from(migratedHistoryItems.values())

      // sort before sending saving to the database and passing to other windows
      // so that the other windows can use it as is, without having to sort the array themselves
      sortedRecords.sort((a, b) => b.timeWatched - a.timeWatched)

      await DBHistoryHandlers.overwrite(sortedRecords)

      commit('setHistoryCacheSorted', sortedRecords)
      commit('setHistoryCacheById', Object.fromEntries(migratedHistoryItems))
      return true
    } catch (errMessage) {
      console.error(errMessage)
      return false
    }
  },

  async applyHistorySyncChanges({ commit }, changes) {
    try {
      const migratedChanges = {
        insertions: changes.insertions.map(migrateLegacyHistoryRecord),
        updates: changes.updates.map(migrateLegacyHistoryRecord),
        deletions: changes.deletions,
      }
      await DBHistoryHandlers.applySyncChanges(migratedChanges)
      commit('applyHistorySyncChanges', migratedChanges)
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async markAllHistoryAsWatched({ dispatch, state }) {
    const records = state.historyCacheSorted
      .filter(record => record.isWatched !== true && canMarkHistoryEntryAsWatched(record))
      .map(record => ({ ...record, isWatched: true }))
    if (records.length === 0) return 0
    try {
      return await dispatch('updateSubscriptionHistory', { records })
    } catch (errMessage) {
      console.error(errMessage)
      return 0
    }
  },

  async removeFromHistory({ commit }, videoId) {
    try {
      await DBHistoryHandlers.delete(videoId)
      commit('removeFromHistoryCacheById', videoId)
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async removeHistoryOlderThan({ commit }, days) {
    const cutoff = getRetentionCutoff(days)
    if (cutoff === null) {
      return 0
    }

    try {
      const videoIds = await DBHistoryHandlers.deleteOlderThan(cutoff)
      commit('removeMultipleFromHistoryCache', videoIds)
      return videoIds.length
    } catch (errMessage) {
      console.error(errMessage)
      return 0
    }
  },

  async removeAllHistory({ commit }) {
    try {
      await DBHistoryHandlers.deleteAll()
      commit('setHistoryCacheSorted', [])
      commit('setHistoryCacheById', {})
      return true
    } catch (errMessage) {
      console.error(errMessage)
      return false
    }
  },

  async updateWatchProgress({ commit }, { videoId, watchProgress }) {
    try {
      await DBHistoryHandlers.updateWatchProgress(videoId, watchProgress)
      commit('updateRecordWatchProgressInHistoryCache', { videoId, watchProgress })
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async updateLastViewedPlaylist({ commit }, { videoId, lastViewedPlaylistId, lastViewedPlaylistType, lastViewedPlaylistItemId }) {
    try {
      await DBHistoryHandlers.updateLastViewedPlaylist(videoId, lastViewedPlaylistId, lastViewedPlaylistType, lastViewedPlaylistItemId)
      commit('updateRecordLastViewedPlaylistIdInHistoryCache', { videoId, lastViewedPlaylistId, lastViewedPlaylistType, lastViewedPlaylistItemId })
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async unsetLastViewedPlaylistForVideos({ commit }, { videoIds, lastViewedPlaylistId }) {
    try {
      await DBHistoryHandlers.unsetLastViewedPlaylistForVideos(videoIds, lastViewedPlaylistId)
      commit('unsetRecordsLastViewedPlaylistIdInHistoryCache', { videoIds, lastViewedPlaylistId })
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async unsetLastViewedPlaylists({ commit }, lastViewedPlaylistIds) {
    try {
      await DBHistoryHandlers.unsetLastViewedPlaylists(lastViewedPlaylistIds)
      commit('unsetRecordsLastViewedPlaylistIdsInHistoryCache', lastViewedPlaylistIds)
    } catch (errMessage) {
      console.error(errMessage)
    }
  },
}

const mutations = {
  setHistoryCacheSorted(state, historyCacheSorted) {
    state.historyCacheSorted = historyCacheSorted
  },

  setHistoryCacheById(state, historyCacheById) {
    state.historyCacheById = historyCacheById
  },

  upsertToHistoryCache(state, record) {
    const i = state.historyCacheSorted.findIndex((currentRecord) => {
      return record.videoId === currentRecord.videoId
    })

    if (i !== -1) {
      const currentRecord = state.historyCacheSorted[i]

      // Watched-status and other metadata-only updates keep their current position.
      // A newer timeWatched means the video was watched again and should become the
      // most recent history entry.
      if (record.timeWatched === currentRecord.timeWatched) {
        state.historyCacheSorted.splice(i, 1, record)
        state.historyCacheById[record.videoId] = record
        return
      }

      state.historyCacheSorted.splice(i, 1)
    }

    state.historyCacheSorted.unshift(record)
    state.historyCacheById[record.videoId] = record
  },

  updateRecordWatchProgressInHistoryCache(state, { videoId, watchProgress }) {
    // historyCacheById and historyCacheSorted reference the same object instances,
    // so modifying an existing object in one of them will update both.

    const record = state.historyCacheById[videoId]

    // Don't set, if the item was removed from the watch history, as we don't have any video details
    if (record) {
      record.watchProgress = watchProgress
    }
  },

  updateRecordLastViewedPlaylistIdInHistoryCache(state, { videoId, lastViewedPlaylistId, lastViewedPlaylistType, lastViewedPlaylistItemId }) {
    // historyCacheById and historyCacheSorted reference the same object instances,
    // so modifying an existing object in one of them will update both.

    const record = state.historyCacheById[videoId]

    // Don't set, if the item was removed from the watch history, as we don't have any video details
    if (record) {
      record.lastViewedPlaylistId = lastViewedPlaylistId
      record.lastViewedPlaylistType = lastViewedPlaylistType
      record.lastViewedPlaylistItemId = lastViewedPlaylistItemId
    }
  },

  unsetRecordsLastViewedPlaylistIdInHistoryCache(state, { videoIds, lastViewedPlaylistId }) {
    for (const videoId of videoIds) {
      // historyCacheById and historyCacheSorted reference the same object instances,
      // so modifying an existing object in one of them will update both.

      const record = state.historyCacheById[videoId]

      // Don't unset if the item was removed from the watch history or if the last viewed playlist does not match
      if (record && record.lastViewedPlaylistId === lastViewedPlaylistId) {
        delete record.lastViewedPlaylistId
        delete record.lastViewedPlaylistType
        delete record.lastViewedPlaylistItemId
      }
    }
  },

  unsetRecordsLastViewedPlaylistIdsInHistoryCache(state, playlistIds) {
    const playlistIdSet = new Set(playlistIds)

    for (const record of state.historyCacheSorted) {
      // Don't unset if the item was removed from the watch history or if the last viewed playlist does not match
      if (record && playlistIdSet.has(record.lastViewedPlaylistId)) {
        delete record.lastViewedPlaylistId
        delete record.lastViewedPlaylistType
        delete record.lastViewedPlaylistItemId
      }
    }
  },

  removeFromHistoryCacheById(state, videoId) {
    for (let i = 0; i < state.historyCacheSorted.length; i++) {
      if (state.historyCacheSorted[i].videoId === videoId) {
        state.historyCacheSorted.splice(i, 1)
        break
      }
    }

    delete state.historyCacheById[videoId]
  },

  removeMultipleFromHistoryCache(state, videoIds) {
    const videoIdSet = new Set(videoIds)
    state.historyCacheSorted = state.historyCacheSorted.filter(record => !videoIdSet.has(record.videoId))

    for (const videoId of videoIds) {
      delete state.historyCacheById[videoId]
    }
  },

  applyHistorySyncChanges(state, { insertions, updates, deletions }) {
    const upserts = [...insertions, ...updates]
    const deletedIds = new Set(deletions)
    const upsertsById = new Map(upserts.map(record => [record.videoId, record]))
    const retained = state.historyCacheSorted
      .filter(record => !deletedIds.has(record.videoId))
      .map(record => upsertsById.get(record.videoId) ?? record)
    const retainedIds = new Set(retained.map(record => record.videoId))

    // Replace existing entries in place so stable sorting preserves timestamp ties.
    state.historyCacheSorted = retained
      .concat(upserts.filter(record => !retainedIds.has(record.videoId)))
      .sort((a, b) => b.timeWatched - a.timeWatched)

    for (const videoId of deletions) {
      delete state.historyCacheById[videoId]
    }
    for (const record of upserts) {
      state.historyCacheById[record.videoId] = record
    }
  }
}

export default {
  state,
  getters,
  actions,
  mutations
}
