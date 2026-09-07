import * as db from '../index'
import { updateSettingIfUnchanged } from '../settingRepair'
import { PlaylistVideoAddResult } from '../../constants'
import { hasReachedWatchedThreshold, migrateLegacyHistoryRecord } from '../../history'
import { resolveSearchHistoryEntry } from '../../search-history'
import { createRecommendationStore } from '../recommendations'

const recommendations = createRecommendationStore(db.recommendations)

const HISTORY_WATCHED_STATUS_MIGRATION_ID = 'historyWatchedStatusMigrated'

class Settings {
  static async find() {
    const currentLocale = await db.settings.findOneAsync({ _id: 'currentLocale' })

    // In FreeTube 0.21.3 and earlier the locales 'en-GB', 'es-AR' and 'nb-NO' had underscores instead of a hyphens
    // This is a one time migration for users that are using one of those locales
    if (currentLocale?.value.includes('_')) {
      await this.upsert('currentLocale', currentLocale.value.replace('_', '-'))
    }

    // In FreeTube 0.22.0 and earlier the external player arguments were displayed in a text box,
    // with the user manually entering `;` to separate the different arguments.
    // This is a one time migration that converts the old string to a JSON array
    const externalPlayerCustomArgs = await db.settings.findOneAsync({ _id: 'externalPlayerCustomArgs' })

    if (externalPlayerCustomArgs && !externalPlayerCustomArgs.value.startsWith('[')) {
      let newValue = '[]'

      if (externalPlayerCustomArgs.value.length > 0) {
        newValue = JSON.stringify(externalPlayerCustomArgs.value.split(';'))
      }

      await this.upsert('externalPlayerCustomArgs', newValue)
    }

    // In FreeTube 0.23.0, the "Enable Theatre Mode by Default" setting was incoporated as an option
    // of the "Default Viewing Mode" setting. This is a one time migration to preserve users'
    // Theater Mode preference through this change.
    const defaultTheatreMode = await db.settings.findOneAsync({ _id: 'defaultTheatreMode' })

    if (defaultTheatreMode) {
      if (defaultTheatreMode.value) {
        await this.upsert('defaultViewingMode', 'theatre')
      }

      await db.settings.removeAsync({ _id: 'defaultTheatreMode' })
    }

    const saveWatchedProgress = await db.settings.findOneAsync({ _id: 'saveWatchedProgress' })
    const watchedProgressSavingMode = await db.settings.findOneAsync({ _id: 'watchedProgressSavingMode' })
    if (saveWatchedProgress && !watchedProgressSavingMode) {
      if (!saveWatchedProgress.value) {
        await this.upsert('watchedProgressSavingMode', 'never')
      }

      await db.settings.removeAsync({ _id: 'saveWatchedProgress' })
    }

    // In FreeTube 0.24.0, the "Screenshot Mode" setting only had two options that were represented as a toggle named "Ask path"
    // This is a one time migration to preserve users' Screenshot prompt preference through this change.
    const screenshotAskPath = await db.settings.findOneAsync({ _id: 'screenshotAskPath' })

    if (screenshotAskPath) {
      await this.upsert('screenshotMode', screenshotAskPath.value ? 'prompt_folder' : 'default_folder')
      await db.settings.removeAsync({ _id: 'screenshotAskPath' })
    }

    return db.settings.findAsync({ _id: { $ne: 'bounds' } })
  }

  static upsert(_id, value) {
    return db.settings.updateAsync({ _id }, { _id, value }, { upsert: true })
  }

  static _updateIfUnchanged(_id, expectedValue, value) {
    return updateSettingIfUnchanged(db.settings, _id, expectedValue, value)
  }

  static delete(_id) {
    return db.settings.removeAsync({ _id })
  }

  // ******************** //
  // Unique Electron main process handlers
  static _findAppReadyRelatedSettings() {
    return db.settings.findAsync({
      _id: {
        $in: [
          'disableSmoothScrolling',
          'useProxy',
          'proxyProtocol',
          'proxyHostname',
          'proxyPort',
          'backendFallback',
          'backendPreference',
          'hideToTrayOnMinimize'
        ]
      }
    })
  }

  static _findOne(_id) {
    return db.settings.findOneAsync({ _id })
  }

  static _updateBounds(value) {
    return db.settings.updateAsync({ _id: 'bounds' }, { _id: 'bounds', value }, { upsert: true })
  }
  // ******************** //
}

class History {
  static migrationPromise = null

  static async find() {
    await this.migrateWatchedStatus()
    return db.history.findAsync({}).sort({ timeWatched: -1 })
  }

  static upsert(record) {
    const migratedRecord = migrateLegacyHistoryRecord(record)
    return db.history.updateAsync({ videoId: migratedRecord.videoId }, migratedRecord, { upsert: true })
  }

  static async overwrite(records) {
    const migratedRecords = records.map(migrateLegacyHistoryRecord)
    const retained = new Set(migratedRecords.map(record => record.videoId))
    const removed = (await db.history.findAsync({}, { videoId: 1 })).map(record => record.videoId).filter(id => !retained.has(id))
    if (removed.length) await recommendations.remove(removed)

    await db.history.removeAsync({}, { multi: true })

    await db.history.insertAsync(migratedRecords)
  }

  static async applySyncChanges({ insertions, updates, deletions }) {
    const migratedInsertions = insertions.map(migrateLegacyHistoryRecord)
    const migratedUpdates = updates.map(migrateLegacyHistoryRecord)

    if (deletions.length > 0) {
      await recommendations.remove(deletions)
      await db.history.removeAsync({ videoId: { $in: deletions } }, { multi: true })
    }
    for (const record of migratedUpdates) {
      await db.history.updateAsync({ videoId: record.videoId }, record, { upsert: true })
    }
    if (migratedInsertions.length > 0) {
      await db.history.insertAsync(migratedInsertions)
    }
  }

  static migrateWatchedStatus() {
    this.migrationPromise ??= this._migrateWatchedStatus()
    return this.migrationPromise
  }

  static async _migrateWatchedStatus() {
    // `isWatched` isn't indexed, so the lookup below is a full collection scan
    // that history loading blocks on. Once every record has been migrated the
    // answer can never change, so record that and skip the scan on later runs.
    //
    // Skipping it later is safe even though `updateWatchProgress` can upsert a
    // record without the field: such a record has no `lengthSeconds`, so the
    // migration would only ever have derived `isWatched: false` for it, and
    // `isHistoryEntryWatched` falls back to the same threshold when the field
    // is absent. Every path that writes a full record (`upsert`, `overwrite`,
    // `applySyncChanges`) migrates it inline, so a legacy-shaped record can no
    // longer appear after this point either.
    const migrationMarker = await db.settings.findOneAsync({ _id: HISTORY_WATCHED_STATUS_MIGRATION_ID })
    if (migrationMarker?.value === true) {
      return
    }

    const records = await db.history.findAsync({ isWatched: { $exists: false } })
    const batchSize = 250

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize)

      await Promise.all(batch.map(record => {
        const migratedRecord = migrateLegacyHistoryRecord(record)
        const updates = { isWatched: migratedRecord.isWatched }

        if (migratedRecord.watchProgress !== record.watchProgress) {
          updates.watchProgress = migratedRecord.watchProgress
        }

        if (migratedRecord.isLive !== record.isLive) {
          updates.isLive = migratedRecord.isLive
        }

        return db.history.updateAsync(
          { _id: record._id },
          { $set: updates }
        )
      }))
    }

    if (records.length > 0) {
      await db.history.compactDatafileAsync()
    }

    await db.settings.updateAsync(
      { _id: HISTORY_WATCHED_STATUS_MIGRATION_ID },
      { _id: HISTORY_WATCHED_STATUS_MIGRATION_ID, value: true },
      { upsert: true }
    )
  }

  static updateWatchProgress(videoId, watchProgress) {
    return db.history.updateAsync({ videoId }, { $set: { watchProgress } }, { upsert: true })
  }

  static updateLastViewedPlaylist(videoId, lastViewedPlaylistId, lastViewedPlaylistType, lastViewedPlaylistItemId) {
    return db.history.updateAsync({ videoId }, { $set: { lastViewedPlaylistId, lastViewedPlaylistType, lastViewedPlaylistItemId } }, { upsert: true })
  }

  static unsetLastViewedPlaylistForVideos(videoIds, lastViewedPlaylistId) {
    return db.history.updateAsync(
      {
        videoId: { $in: videoIds },
        lastViewedPlaylistId: lastViewedPlaylistId
      },
      { $unset: { lastViewedPlaylistId: '', lastViewedPlaylistType: '', lastViewedPlaylistItemId: '' } },
      { multi: true }
    )
  }

  static unsetLastViewedPlaylists(lastViewedPlaylistIds) {
    return db.history.updateAsync(
      {
        lastViewedPlaylistId: { $in: lastViewedPlaylistIds }
      },
      { $unset: { lastViewedPlaylistId: '', lastViewedPlaylistType: '', lastViewedPlaylistItemId: '' } },
      { multi: true }
    )
  }

  static async delete(videoId) {
    await recommendations.remove([videoId])
    return db.history.removeAsync({ videoId })
  }

  static async deleteOlderThan(cutoff, excludedVideoIds = []) {
    const query = { timeWatched: { $lt: cutoff } }
    if (excludedVideoIds.length > 0) {
      query.videoId = { $nin: excludedVideoIds }
    }

    const records = await db.history.findAsync(query)
    const videoIds = records.map(record => record.videoId)

    if (videoIds.length > 0) {
      await recommendations.remove(videoIds)
      await db.history.removeAsync({ videoId: { $in: videoIds } }, { multi: true })
    }

    return videoIds
  }

  static async deleteAll() {
    await recommendations.reset()
    return db.history.removeAsync({}, { multi: true })
  }
}

class WatchStats {
  static migrationId = 'history-watch-time-v1'
  static defaultChannelKey = '__default__'

  static find() {
    return db.watchStats.findAsync({ date: { $exists: true } }).sort({ date: 1 })
  }

  static addWatchTime(date, seconds) {
    return db.watchStats.updateAsync(
      { date },
      { $inc: { seconds }, $set: { date } },
      { upsert: true }
    )
  }

  static async addHistoricalWatchTime(date, secondsByChannel) {
    const existingRecord = await db.watchStats.findOneAsync({ date })
    if (existingRecord?.historyEstimateApplied) { return true }

    const historyEstimateSeconds = Object.values(secondsByChannel)
      .reduce((total, seconds) => total + seconds, 0)

    await db.watchStats.updateAsync(
      { date },
      {
        $inc: { seconds: historyEstimateSeconds },
        $set: {
          date,
          historyEstimateApplied: true,
          historyEstimateSeconds,
          historyAdjustedSeconds: historyEstimateSeconds,
          historyEstimateByChannel: secondsByChannel,
        }
      },
      { upsert: true }
    )
    return true
  }

  static getHistoricalAdjustment() {
    return db.watchStats.findOneAsync({ _id: this.migrationId })
      .then(record => record?.adjustment ?? null)
  }

  static _getEstimatedSeconds(record) {
    const lengthSeconds = Number(record.lengthSeconds)
    const watchProgress = Number(record.watchProgress)

    let seconds = Number.isFinite(watchProgress) ? watchProgress : 0
    const reachedLegacyWatchedThreshold = hasReachedWatchedThreshold(watchProgress, lengthSeconds)

    if ((record.isWatched === true || reachedLegacyWatchedThreshold) && lengthSeconds > 0) {
      seconds = lengthSeconds
    } else if (Number.isFinite(lengthSeconds)) {
      seconds = Math.min(seconds, lengthSeconds)
    }

    return seconds > 0 ? seconds : 0
  }

  static async _getHistoryEstimates(completedAt = Number.POSITIVE_INFINITY) {
    const history = await db.history.findAsync({})
    const estimatesByDate = new Map()

    for (const record of history) {
      const timestamp = Number(record.timeWatched)
      if (!Number.isFinite(timestamp) || timestamp > completedAt) { continue }

      const seconds = this._getEstimatedSeconds(record)
      if (seconds === 0) { continue }

      const watchedAt = new Date(timestamp)
      const date = [
        watchedAt.getFullYear(),
        String(watchedAt.getMonth() + 1).padStart(2, '0'),
        String(watchedAt.getDate()).padStart(2, '0'),
      ].join('-')
      const channelId = record.authorId || this.defaultChannelKey
      const secondsByChannel = estimatesByDate.get(date) ?? {}
      secondsByChannel[channelId] = (secondsByChannel[channelId] ?? 0) + seconds
      estimatesByDate.set(date, secondsByChannel)
    }

    return estimatesByDate
  }

  static async adjustHistoricalWatchTime(defaultSpeed, channelPlaybackSpeeds = {}) {
    const normalizedDefaultSpeed = Number(defaultSpeed)
    if (!Number.isFinite(normalizedDefaultSpeed) || normalizedDefaultSpeed <= 0) {
      throw new Error('watch stats: invalid historical playback speed')
    }

    const migration = await db.watchStats.findOneAsync({ _id: this.migrationId })
    if (!migration?.hadEstimates) {
      throw new Error('watch stats: no historical estimate to adjust')
    }

    const normalizedChannelSpeeds = Object.fromEntries(
      Object.entries(channelPlaybackSpeeds)
        .map(([channelId, speed]) => [channelId, Number(speed)])
        .filter(([, speed]) => Number.isFinite(speed) && speed > 0)
    )
    const reconstructedEstimates = await this._getHistoryEstimates(migration.completedAt)
    const records = await db.watchStats.findAsync({ historyEstimateApplied: true })

    for (const record of records) {
      const secondsByChannel = record.historyEstimateByChannel ?? reconstructedEstimates.get(record.date) ?? {}
      const reconstructedSeconds = Object.values(secondsByChannel)
        .reduce((total, seconds) => total + seconds, 0)
      // Records created by the original migration did not store the imported
      // contribution separately, so reconstruct it before falling back to the
      // day's total (which may also contain newly recorded watch time).
      const baselineSeconds = Number(record.historyEstimateSeconds) ||
        reconstructedSeconds ||
        Number(record.seconds) ||
        0
      const previousAdjustedSeconds = Number(record.historyAdjustedSeconds) || baselineSeconds

      if (reconstructedSeconds < baselineSeconds) {
        secondsByChannel[this.defaultChannelKey] = (secondsByChannel[this.defaultChannelKey] ?? 0) +
          baselineSeconds - reconstructedSeconds
      }

      const adjustedSeconds = Object.entries(secondsByChannel).reduce((total, [channelId, seconds]) => {
        const speed = normalizedChannelSpeeds[channelId] ?? normalizedDefaultSpeed
        return total + seconds / speed
      }, 0)
      const seconds = Math.max(0, Number(record.seconds) - previousAdjustedSeconds + adjustedSeconds)

      await db.watchStats.updateAsync(
        { _id: record._id },
        {
          $set: {
            seconds,
            historyEstimateSeconds: baselineSeconds,
            historyAdjustedSeconds: adjustedSeconds,
            historyEstimateByChannel: secondsByChannel,
          }
        }
      )
    }

    const adjustment = { defaultSpeed: normalizedDefaultSpeed, updatedAt: Date.now() }
    await db.watchStats.updateAsync(
      { _id: this.migrationId },
      { $set: { adjustment } }
    )

    return { records: await this.find(), ...adjustment }
  }

  static async deleteAll() {
    await db.watchStats.removeAsync({ date: { $exists: true } }, { multi: true })
    await db.watchStats.updateAsync(
      { _id: this.migrationId },
      { $set: { hadEstimates: false, adjustment: null } },
      { upsert: true }
    )
    this.migrationPromise = null
  }

  static migrateHistory() {
    this.migrationPromise ??= this._migrateHistory()
    return this.migrationPromise
  }

  static async _migrateHistory() {
    const alreadyMigrated = await db.watchStats.findOneAsync({ _id: this.migrationId })
    if (alreadyMigrated) { return alreadyMigrated.hadEstimates === true }

    await History.migrateWatchedStatus()

    const secondsByDate = await this._getHistoryEstimates()

    let hadEstimates = false
    for (const [date, secondsByChannel] of secondsByDate) {
      const imported = await this.addHistoricalWatchTime(date, secondsByChannel)
      hadEstimates ||= imported
    }

    await db.watchStats.insertAsync({
      _id: this.migrationId,
      completedAt: Date.now(),
      hadEstimates,
      adjustment: null,
    })
    return hadEstimates
  }
}

class Profiles {
  static create(profile) {
    return db.profiles.insertAsync(profile)
  }

  static find() {
    return db.profiles.findAsync({})
  }

  static upsert(profile) {
    return db.profiles.updateAsync({ _id: profile._id }, profile, { upsert: true })
  }

  static addChannelToProfiles(channel, profileIds) {
    if (profileIds.length === 1) {
      return db.profiles.updateAsync(
        { _id: profileIds[0] },
        { $push: { subscriptions: channel } }
      )
    } else {
      return db.profiles.updateAsync(
        { _id: { $in: profileIds } },
        { $push: { subscriptions: channel } },
        { multi: true }
      )
    }
  }

  static removeChannelFromProfiles(channelId, profileIds) {
    if (profileIds.length === 1) {
      return db.profiles.updateAsync(
        { _id: profileIds[0] },
        { $pull: { subscriptions: { id: channelId } } }
      )
    } else {
      return db.profiles.updateAsync(
        { _id: { $in: profileIds } },
        { $pull: { subscriptions: { id: channelId } } },
        { multi: true }
      )
    }
  }

  static async updateChannelSettings(channel, profileIds) {
    const { affectedDocuments } = await db.profiles.updateAsync(
      {
        _id: { $in: profileIds },
        subscriptions: { $elemMatch: { id: channel.id } }
      },
      {
        $pull: { subscriptions: { id: channel.id } },
        $push: { subscriptions: channel }
      },
      { multi: true, returnUpdatedDocs: true }
    )

    return affectedDocuments.map(profile => profile._id)
  }

  static delete(id) {
    return db.profiles.removeAsync({ _id: id })
  }
}

class Playlists {
  static create(playlists) {
    return db.playlists.insertAsync(playlists)
  }

  static find() {
    return db.playlists.findAsync({})
  }

  static upsert(playlist) {
    return db.playlists.updateAsync({ _id: playlist._id }, { $set: playlist }, { upsert: true })
  }

  /**
   * Adds a single video to a playlist, unless an entry with the same video id
   * is already there.
   *
   * Every window writes through this one datastore, so it is the only place
   * that can order two of them adding the same video at the same time.
   * `upsertVideosByPlaylistId` is the bulk path and still allows duplicates.
   *
   * @returns {Promise<'added' | 'already-present' | 'playlist-missing'>}
   */
  static async upsertVideoByPlaylistId(_id, lastUpdatedAt, videoData) {
    const { numAffected } = await db.playlists.updateAsync(
      // Not `{ 'videos.videoId': { $ne: videoData.videoId } }`: against an array
      // that matches whenever any other entry differs, so it lets duplicates
      // through, and it rejects the first video as an empty array matches nothing
      { _id, $not: { videos: { $elemMatch: { videoId: videoData.videoId } } } },
      {
        $push: { videos: videoData },
        $set: { lastUpdatedAt }
      },
      // Must not upsert: the selector deliberately misses when the video is
      // already there, which would otherwise insert a malformed playlist
      { upsert: false }
    )

    if (numAffected > 0) {
      return PlaylistVideoAddResult.ADDED
    }

    // Nothing was written, which means the video is already in the playlist, or
    // the playlist is gone (another window may have deleted it). Only the former
    // leaves the caller with what it asked for, so the two must be told apart.
    const playlist = await db.playlists.findOneAsync({ _id })

    return playlist == null
      ? PlaylistVideoAddResult.PLAYLIST_MISSING
      : PlaylistVideoAddResult.ALREADY_PRESENT
  }

  static upsertVideosByPlaylistId(_id, lastUpdatedAt, videos) {
    return db.playlists.updateAsync(
      { _id },
      {
        $push: { videos: { $each: videos } },
        $set: { lastUpdatedAt }
      },
      { upsert: true }
    )
  }

  static delete(_id) {
    return db.playlists.removeAsync({ _id, protected: { $ne: true } })
  }

  static deleteVideoIdByPlaylistId(_id, lastUpdatedAt, videoId, playlistItemId) {
    if (playlistItemId != null) {
      return db.playlists.updateAsync(
        { _id },
        {
          $pull: { videos: { playlistItemId } },
          $set: { lastUpdatedAt }
        },
        { upsert: true }
      )
    } else if (videoId != null) {
      return db.playlists.updateAsync(
        { _id },
        {
          $pull: { videos: { videoId } },
          $set: { lastUpdatedAt }
        },
        { upsert: true }
      )
    } else {
      throw new Error(`Both videoId & playlistItemId are absent, _id: ${_id}`)
    }
  }

  static deleteVideoIdsByPlaylistId(_id, lastUpdatedAt, playlistItemIds) {
    return db.playlists.updateAsync(
      { _id },
      {
        $pull: { videos: { playlistItemId: { $in: playlistItemIds } } },
        $set: { lastUpdatedAt }
      },
      { upsert: true }
    )
  }

  static deleteAllVideosByPlaylistId(_id) {
    return db.playlists.updateAsync(
      { _id },
      { $set: { videos: [] } },
      { upsert: true }
    )
  }

  static deleteMultiple(ids) {
    return db.playlists.removeAsync({ _id: { $in: ids }, protected: { $ne: true } })
  }

  static deleteAll() {
    return db.playlists.removeAsync({}, { multi: true })
  }
}

class SearchHistory {
  static find() {
    return db.searchHistory.findAsync({}).sort({ lastUpdatedAt: -1 })
  }

  static async upsert(searchHistoryEntry) {
    const matchingCandidates = await db.searchHistory.findAsync({
      $or: [
        { _id: searchHistoryEntry._id },
        { _id: searchHistoryEntry.query },
        { query: searchHistoryEntry.query },
      ],
    })
    const resolvedEntry = resolveSearchHistoryEntry(searchHistoryEntry, matchingCandidates)

    await db.searchHistory.updateAsync({ _id: resolvedEntry._id }, resolvedEntry, { upsert: true })
    return resolvedEntry
  }

  static async overwrite(records) {
    await db.searchHistory.removeAsync({}, { multi: true })

    await db.searchHistory.insertAsync(records)
  }

  static delete(_id) {
    return db.searchHistory.removeAsync({ _id: _id })
  }

  static deleteAll() {
    return db.searchHistory.removeAsync({}, { multi: true })
  }
}

class SubscriptionCache {
  static pendingUpdates = new Map()

  static queueUpdate(channelId, field, operation) {
    const key = JSON.stringify([channelId, field])
    const previous = this.pendingUpdates.get(key) ?? Promise.resolve()
    const update = previous.catch(() => {}).then(operation)
    this.pendingUpdates.set(key, update)
    return update.finally(() => {
      if (this.pendingUpdates.get(key) === update) this.pendingUpdates.delete(key)
    })
  }

  static updateFeed(channelId, entries, timestamp, field) {
    return this.queueUpdate(channelId, field, async () => {
      const timestampField = `${field}Timestamp`
      const current = await db.subscriptionCache.findOneAsync({ _id: channelId })
      if (new Date(current?.[timestampField]).getTime() > new Date(timestamp).getTime()) return false

      await db.subscriptionCache.updateAsync(
        { _id: channelId },
        { $set: { [field]: entries, [timestampField]: timestamp } },
        { upsert: true }
      )
      return true
    })
  }

  static find() {
    return db.subscriptionCache.findAsync({})
  }

  static updateVideosByChannelId(channelId, entries, timestamp) {
    return SubscriptionCache.updateFeed(channelId, entries, timestamp, 'videos')
  }

  static updateLiveStreamsByChannelId(channelId, entries, timestamp) {
    return SubscriptionCache.updateFeed(channelId, entries, timestamp, 'liveStreams')
  }

  static updateShortsByChannelId(channelId, entries, timestamp) {
    return SubscriptionCache.updateFeed(channelId, entries, timestamp, 'shorts')
  }

  static updateShortsWithChannelPageShortsByChannelId(channelId, entries) {
    return SubscriptionCache.queueUpdate(channelId, 'shorts', async () => {
      const doc = await db.subscriptionCache.findOneAsync({ _id: channelId }, { shorts: 1 })

      if (!Array.isArray(doc?.shorts)) {
        return
      }

      let hasUpdates = false

      doc.shorts.forEach(cachedVideo => {
        const channelVideo = entries.find(short => cachedVideo.videoId === short.videoId)
        if (!channelVideo) { return }

        hasUpdates = true

        // authorId probably never changes, so we don't need to update that
        cachedVideo.title = channelVideo.title
        cachedVideo.author = channelVideo.author

        // as the channel shorts page only has compact view counts for numbers above 1000 e.g. 12k
        // and the RSS feeds include an exact value, we only want to overwrite it when the number is larger than the cached value
        // 12345 vs 12000 => 12345
        // 12345 vs 15000 => 15000
        if (channelVideo.viewCount > cachedVideo.viewCount) {
          cachedVideo.viewCount = channelVideo.viewCount
        }
      })

      if (hasUpdates) {
        await db.subscriptionCache.updateAsync(
          { _id: channelId },
          { $set: { shorts: doc.shorts } }
        )
      }
    })
  }

  static updateCommunityPostsByChannelId(channelId, entries, timestamp) {
    return SubscriptionCache.updateFeed(channelId, entries, timestamp, 'communityPosts')
  }

  static deleteMultipleChannels(channelIds) {
    return db.subscriptionCache.removeAsync({ _id: { $in: channelIds } }, { multi: true })
  }

  static deleteAll() {
    return db.subscriptionCache.removeAsync({}, { multi: true })
  }
}

class TabSession {
  static async load(sessionId = 'session') {
    const doc = await db.tabSession.findOneAsync({ _id: sessionId })
    if (doc && doc.value) {
      return doc.value
    }
    return null
  }

  static async loadAll() {
    const docs = await db.tabSession.findAsync({})
    return docs
      .filter(doc => doc && doc.value)
      .map(doc => ({ sessionId: doc._id, ...doc.value }))
  }

  static async save(sessionId, sessionData) {
    // Backwards-compatible single argument form: treat as legacy singleton record.
    if (typeof sessionId !== 'string') {
      sessionData = sessionId
      sessionId = 'session'
    }
    return db.tabSession.updateAsync(
      { _id: sessionId },
      { _id: sessionId, value: sessionData },
      { upsert: true }
    )
  }

  static async clear(sessionId = 'session') {
    return db.tabSession.removeAsync({ _id: sessionId })
  }

  static async clearAll() {
    return db.tabSession.removeAsync({}, { multi: true })
  }
}

function loadDatastores() {
  return Promise.allSettled([
    db.settings.loadDatabaseAsync(),
    db.history.loadDatabaseAsync(),
    db.watchStats.loadDatabaseAsync(),
    db.recommendations.loadDatabaseAsync(),
    db.profiles.loadDatabaseAsync(),
    db.playlists.loadDatabaseAsync(),
    db.searchHistory.loadDatabaseAsync(),
    db.subscriptionCache.loadDatabaseAsync(),
    db.tabSession.loadDatabaseAsync(),
    db.liveReminders.loadDatabaseAsync(),
    db.videoMetadataCache.loadDatabaseAsync(),
  ])
}

function compactAllDatastores() {
  return Promise.allSettled([
    db.settings.compactDatafileAsync(),
    db.history.compactDatafileAsync(),
    db.watchStats.compactDatafileAsync(),
    db.recommendations.compactDatafileAsync(),
    db.profiles.compactDatafileAsync(),
    db.playlists.compactDatafileAsync(),
    db.searchHistory.compactDatafileAsync(),
    // IndexedDB stores each browser cache record directly and needs no compaction.
    ...(db.subscriptionCache ? [db.subscriptionCache.compactDatafileAsync()] : []),
    db.tabSession.compactDatafileAsync(),
    db.liveReminders.compactDatafileAsync(),
    db.videoMetadataCache.compactDatafileAsync(),
  ])
}

export {
  Settings as settings,
  History as history,
  WatchStats as watchStats,
  recommendations,
  Profiles as profiles,
  Playlists as playlists,
  SearchHistory as searchHistory,
  SubscriptionCache as subscriptionCache,
  TabSession as tabSession,

  loadDatastores,
  compactAllDatastores,
}
