export const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000

export const SYNC_ACTION_REASONS = new Map([
  ['addChannelToProfiles', 'profilesOrSubscriptions'],
  ['addPlaylist', 'playlists'],
  ['addPlaylists', 'playlists'],
  ['addVideo', 'playlists'],
  ['addVideos', 'playlists'],
  ['createProfile', 'profiles'],
  ['markAllHistoryAsWatched', 'history'],
  ['mergeSubscriptionSeenVideos', 'history'],
  ['overwriteHistory', 'history'],
  ['removeAllHistory', 'history'],
  ['removeAllPlaylists', 'playlists'],
  ['removeAllVideos', 'playlists'],
  ['removeChannelFromProfiles', 'profilesOrSubscriptions'],
  ['removeFromHistory', 'history'],
  ['removeHistoryOlderThan', 'history'],
  ['removePlaylist', 'playlists'],
  ['removePlaylistBookmark', 'playlists'],
  ['removePlaylists', 'playlists'],
  ['removeProfile', 'profiles'],
  ['removeVideo', 'playlists'],
  ['removeVideos', 'playlists'],
  ['updateHistory', 'history'],
  ['updateSubscriptionHistory', 'history'],
  ['updateCustomThemes', 'settings'],
  ['updatePlaylist', 'playlists'],
  ['savePlaylistBookmark', 'playlists'],
  ['updateProfile', 'profilesOrSubscriptions'],
  ['updateWatchProgress', 'history'],
])

export const SYNC_MUTATION_REASONS = new Map([
  ['setHistoryEntryScroll', 'sessions'],
  ['setPresentedTab', 'sessions'],
  ['setTabContentTitle', 'sessions'],
  ['setTabNavigation', 'sessions'],
  ['setTabsState', 'sessions'],
  ['setCustomThemes', 'settings'],
  ['addProfileToList', 'profiles'],
  ['addChannelToProfiles', 'profilesOrSubscriptions'],
  ['removeChannelFromProfiles', 'profilesOrSubscriptions'],
  ['removeProfileFromList', 'profiles'],
  ['upsertProfileToList', 'profilesOrSubscriptions'],
  ['addPlaylist', 'playlists'],
  ['addPlaylists', 'playlists'],
  ['addVideo', 'playlists'],
  ['addVideos', 'playlists'],
  ['removeAllPlaylists', 'playlists'],
  ['removeAllVideos', 'playlists'],
  ['removePlaylist', 'playlists'],
  ['removePlaylists', 'playlists'],
  ['removeVideo', 'playlists'],
  ['removeVideos', 'playlists'],
  ['setPlaylistBookmarks', 'playlists'],
  ['upsertPlaylistToList', 'playlists'],
  ['upsertToHistoryCache', 'history'],
  ['setHistoryCacheSorted', 'history'],
  ['setHistoryCacheById', 'history'],
  ['setSubscriptionSeenVideos', 'history'],
  ['removeFromHistoryCacheById', 'history'],
  ['removeMultipleFromHistoryCache', 'history'],
  ['updateRecordWatchProgressInHistoryCache', 'history'],
])

export function isSyncReasonEnabled(settings, reason) {
  switch (reason) {
    case 'subscriptions':
      return settings.syncServerSyncSubscriptions
    case 'playlists':
      return settings.syncServerSyncPlaylists
    case 'history':
      return settings.syncServerSyncHistory
    case 'profiles':
      return settings.syncServerSyncProfiles
    case 'profilesOrSubscriptions':
      return settings.syncServerSyncProfiles || settings.syncServerSyncSubscriptions
    case 'sessions':
      return settings.syncServerPrivacyMode === 'enhanced' &&
        settings.syncServerSyncSessions
    case 'settings':
      return settings.syncServerPrivacyMode === 'enhanced' &&
        settings.syncServerSyncSettings
    case 'data':
    case 'automatic':
      return settings.syncServerSyncSubscriptions ||
        settings.syncServerSyncPlaylists ||
        settings.syncServerSyncHistory ||
        settings.syncServerSyncProfiles ||
        (settings.syncServerPrivacyMode === 'enhanced' && (
          settings.syncServerSyncSessions || settings.syncServerSyncSettings
        ))
    default:
      return false
  }
}

export function isRecentSync(lastSyncAt, now = Date.now()) {
  const age = now - lastSyncAt
  return Number.isFinite(lastSyncAt) && lastSyncAt > 0 &&
    age >= 0 && age < AUTO_SYNC_INTERVAL_MS
}
