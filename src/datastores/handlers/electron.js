import { DBActions } from '../../constants'

/**
 * Payloads can contain Vue reactivity proxies (e.g. objects taken from Vuex
 * state), which Electron IPC cannot structured-clone ("An object could not be
 * cloned"). Datastore payloads are plain JSON documents, so strip reactivity
 * once here at the process boundary instead of in every caller.
 * @template T
 * @param {T} data
 * @returns {T}
 */
function toPlain(data) {
  return data === undefined ? undefined : JSON.parse(JSON.stringify(data))
}

const dbSettings = (action, data) => window.ftElectron.dbSettings(action, toPlain(data))
const dbHistory = (action, data) => window.ftElectron.dbHistory(action, toPlain(data))
const dbWatchStats = (action, data) => window.ftElectron.dbWatchStats(action, toPlain(data))
const dbRecommendations = (action, data) => window.ftElectron.dbRecommendations(action, toPlain(data))

export const recommendations = {
  find: () => dbRecommendations(DBActions.GENERAL.FIND),
  record: event => dbRecommendations(DBActions.GENERAL.UPSERT, event),
  remove: ids => dbRecommendations(DBActions.GENERAL.DELETE_MULTIPLE, ids),
  reset: () => dbRecommendations(DBActions.GENERAL.DELETE_ALL),
}
const dbProfiles = (action, data) => window.ftElectron.dbProfiles(action, toPlain(data))
const dbPlaylists = (action, data) => window.ftElectron.dbPlaylists(action, toPlain(data))
const dbSearchHistory = (action, data) => window.ftElectron.dbSearchHistory(action, toPlain(data))
const dbSubscriptionCache = (action, data) => window.ftElectron.dbSubscriptionCache(action, toPlain(data))

class Settings {
  static mergeSeenVideos(entries) {
    return dbSettings(DBActions.SETTINGS.MERGE_SEEN_VIDEOS, entries)
  }

  static find() {
    return dbSettings(DBActions.GENERAL.FIND)
  }

  static upsert(_id, value) {
    return dbSettings(DBActions.GENERAL.UPSERT, { _id, value })
  }

  static delete(_id) {
    return dbSettings(DBActions.GENERAL.DELETE, _id)
  }
}

class History {
  static find() {
    return dbHistory(DBActions.GENERAL.FIND)
  }

  static upsert(record) {
    return dbHistory(DBActions.GENERAL.UPSERT, record)
  }

  static overwrite(records) {
    return dbHistory(DBActions.GENERAL.OVERWRITE, records)
  }

  static applySyncChanges(changes) {
    return dbHistory(DBActions.HISTORY.APPLY_SYNC_CHANGES, changes)
  }

  static updateWatchProgress(videoId, watchProgress) {
    return dbHistory(
      DBActions.HISTORY.UPDATE_WATCH_PROGRESS,
      { videoId, watchProgress }
    )
  }

  static updateLastViewedPlaylist(videoId, lastViewedPlaylistId, lastViewedPlaylistType, lastViewedPlaylistItemId) {
    return dbHistory(
      DBActions.HISTORY.UPDATE_PLAYLIST,
      { videoId, lastViewedPlaylistId, lastViewedPlaylistType, lastViewedPlaylistItemId }
    )
  }

  static unsetLastViewedPlaylistForVideos(videoIds, lastViewedPlaylistId) {
    return window.ftElectron.dbHistory(DBActions.HISTORY.UNSET_PLAYLIST_FOR_VIDEOS, { videoIds, lastViewedPlaylistId })
  }

  static unsetLastViewedPlaylists(lastViewedPlaylistIds) {
    return window.ftElectron.dbHistory(DBActions.HISTORY.UNSET_PLAYLISTS, lastViewedPlaylistIds)
  }

  static delete(videoId) {
    return dbHistory(DBActions.GENERAL.DELETE, videoId)
  }

  static deleteOlderThan(cutoff) {
    return dbHistory(DBActions.HISTORY.DELETE_OLDER_THAN, cutoff)
  }

  static deleteAll() {
    return dbHistory(DBActions.GENERAL.DELETE_ALL)
  }
}

class WatchStats {
  static find() {
    return dbWatchStats(DBActions.GENERAL.FIND)
  }

  static addWatchTime(date, seconds) {
    return dbWatchStats(
      DBActions.WATCH_STATS.ADD_WATCH_TIME,
      { date, seconds }
    )
  }

  static migrateHistory() {
    return dbWatchStats(DBActions.WATCH_STATS.MIGRATE_HISTORY)
  }

  static getHistoricalAdjustment() {
    return dbWatchStats(DBActions.WATCH_STATS.GET_HISTORICAL_ADJUSTMENT)
  }

  static adjustHistoricalWatchTime(defaultSpeed, channelPlaybackSpeeds) {
    return dbWatchStats(
      DBActions.WATCH_STATS.ADJUST_HISTORICAL_WATCH_TIME,
      { defaultSpeed, channelPlaybackSpeeds }
    )
  }

  static deleteAll() {
    return dbWatchStats(DBActions.GENERAL.DELETE_ALL)
  }
}

class Profiles {
  static create(profile) {
    return dbProfiles(DBActions.GENERAL.CREATE, profile)
  }

  static find() {
    return dbProfiles(DBActions.GENERAL.FIND)
  }

  static upsert(profile) {
    return dbProfiles(DBActions.GENERAL.UPSERT, profile)
  }

  static addChannelToProfiles(channel, profileIds) {
    return dbProfiles(DBActions.PROFILES.ADD_CHANNEL, { channel, profileIds })
  }

  static removeChannelFromProfiles(channelId, profileIds) {
    return dbProfiles(DBActions.PROFILES.REMOVE_CHANNEL, { channelId, profileIds })
  }

  static updateChannelSettings(channel, profileIds) {
    return dbProfiles(DBActions.PROFILES.UPDATE_CHANNEL_SETTINGS, { channel, profileIds })
  }

  static delete(id) {
    return dbProfiles(DBActions.GENERAL.DELETE, id)
  }
}

class Playlists {
  static create(playlists) {
    return dbPlaylists(DBActions.GENERAL.CREATE, playlists)
  }

  static find() {
    return dbPlaylists(DBActions.GENERAL.FIND)
  }

  static upsert(playlist) {
    return dbPlaylists(DBActions.GENERAL.UPSERT, playlist)
  }

  static upsertVideoByPlaylistId(_id, lastUpdatedAt, videoData) {
    return dbPlaylists(
      DBActions.PLAYLISTS.UPSERT_VIDEO,
      { _id, lastUpdatedAt, videoData }
    )
  }

  static upsertVideosByPlaylistId(_id, lastUpdatedAt, videos) {
    return dbPlaylists(
      DBActions.PLAYLISTS.UPSERT_VIDEOS,
      { _id, lastUpdatedAt, videos }
    )
  }

  static delete(_id) {
    return dbPlaylists(DBActions.GENERAL.DELETE, _id)
  }

  static deleteVideoIdByPlaylistId(_id, lastUpdatedAt, videoId, playlistItemId) {
    return dbPlaylists(
      DBActions.PLAYLISTS.DELETE_VIDEO_ID,
      { _id, lastUpdatedAt, videoId, playlistItemId }
    )
  }

  static deleteVideoIdsByPlaylistId(_id, lastUpdatedAt, playlistItemIds) {
    return dbPlaylists(
      DBActions.PLAYLISTS.DELETE_VIDEO_IDS,
      { _id, lastUpdatedAt, playlistItemIds }
    )
  }

  static deleteAllVideosByPlaylistId(_id) {
    return dbPlaylists(DBActions.PLAYLISTS.DELETE_ALL_VIDEOS, _id)
  }

  static deleteMultiple(ids) {
    return dbPlaylists(DBActions.GENERAL.DELETE_MULTIPLE, ids)
  }

  static deleteAll() {
    return dbPlaylists(DBActions.GENERAL.DELETE_ALL)
  }
}

class SearchHistory {
  static find() {
    return dbSearchHistory(DBActions.GENERAL.FIND)
  }

  static upsert(searchHistoryEntry) {
    return dbSearchHistory(DBActions.GENERAL.UPSERT, searchHistoryEntry)
  }

  static overwrite(records) {
    return dbSearchHistory(DBActions.GENERAL.OVERWRITE, records)
  }

  static delete(_id) {
    return dbSearchHistory(DBActions.GENERAL.DELETE, _id)
  }

  static deleteAll() {
    return dbSearchHistory(DBActions.GENERAL.DELETE_ALL)
  }
}

class SubscriptionCache {
  static find() {
    return dbSubscriptionCache(DBActions.GENERAL.FIND)
  }

  static updateVideosByChannelId(channelId, entries, timestamp) {
    return dbSubscriptionCache(
      DBActions.SUBSCRIPTION_CACHE.UPDATE_VIDEOS_BY_CHANNEL,
      { channelId, entries, timestamp }
    )
  }

  static updateLiveStreamsByChannelId(channelId, entries, timestamp) {
    return dbSubscriptionCache(
      DBActions.SUBSCRIPTION_CACHE.UPDATE_LIVE_STREAMS_BY_CHANNEL,
      { channelId, entries, timestamp }
    )
  }

  static updateShortsByChannelId(channelId, entries, timestamp) {
    return dbSubscriptionCache(
      DBActions.SUBSCRIPTION_CACHE.UPDATE_SHORTS_BY_CHANNEL,
      { channelId, entries, timestamp }
    )
  }

  static updateShortsWithChannelPageShortsByChannelId(channelId, entries) {
    return dbSubscriptionCache(
      DBActions.SUBSCRIPTION_CACHE.UPDATE_SHORTS_WITH_CHANNEL_PAGE_SHORTS_BY_CHANNEL,
      { channelId, entries }
    )
  }

  static updateCommunityPostsByChannelId(channelId, entries, timestamp) {
    return dbSubscriptionCache(
      DBActions.SUBSCRIPTION_CACHE.UPDATE_COMMUNITY_POSTS_BY_CHANNEL,
      { channelId, entries, timestamp }
    )
  }

  static deleteMultipleChannels(channelIds) {
    return dbSubscriptionCache(DBActions.GENERAL.DELETE_MULTIPLE, channelIds)
  }

  static deleteAll() {
    return dbSubscriptionCache(DBActions.GENERAL.DELETE_ALL)
  }
}

function compactAllDatastores() {
  return window.ftElectron.storage.compactDatabases()
}

export {
  Settings as settings,
  History as history,
  WatchStats as watchStats,
  Profiles as profiles,
  Playlists as playlists,
  SearchHistory as searchHistory,
  SubscriptionCache as subscriptionCache,
  compactAllDatastores,
}
