import * as baseHandlers from './base'
import { loadLegacySubscriptionCache, removeLegacySubscriptionCache } from '../index'
import { createBrowserSubscriptionCache } from '../browserSubscriptionCache'

export const subscriptionCache = createBrowserSubscriptionCache(
  loadLegacySubscriptionCache,
  'opentubex-subscription-cache',
  removeLegacySubscriptionCache
)

// TODO: Syncing
// Syncing on the web would involve a different implementation
// to the electron one (obviously)
// One idea would be to use a watcher-like mechanism on
// localStorage or IndexedDB to inform other tabs on the changes
// that have occurred in other tabs
//
// NOTE: NeDB uses `localForage` on the browser
// https://www.npmjs.com/package/localforage

class Settings {
  static mergeSeenVideos(entries) {
    return baseHandlers.settings.mergeSeenVideos(entries)
  }

  static find() {
    return baseHandlers.settings.find()
  }

  static upsert(_id, value) {
    return baseHandlers.settings.upsert(_id, value)
  }

  static delete(_id) {
    return baseHandlers.settings.delete(_id)
  }
}

// For the settings we use the wrapper class to hide some methods only needed in the Electron main process
export { Settings as settings }

// These classes don't require any changes from the base classes, so can be exported as-is.
export {
  history,
  watchStats,
  recommendations,
  profiles,
  playlists,
  searchHistory,
  compactAllDatastores,
} from './base'
