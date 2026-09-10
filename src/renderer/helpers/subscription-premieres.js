import { extractAssignedJsonObject } from './assigned-json.js'
import { getUpcomingPremiereTimestamp, updateUpcomingPremiereState } from './subscription-entries.js'

/** @param {object} video @param {number} now */
export function shouldRefreshSubscriptionPremiere(video, now) {
  const scheduled = getUpcomingPremiereTimestamp(video)
  if (scheduled > now) return false
  return video.isPremiere === true ||
    updateUpcomingPremiereState(video, now) !== video ||
    ((video.isUpcoming === true || video.premiere === true) && (scheduled == null || scheduled <= now)) ||
    (scheduled > 0 && (video.liveNow === true || video.isLive === true))
}

/** @param {unknown} value */
function numericCount(value) {
  if (value == null || value === '') return undefined
  const count = Number(value)
  return Number.isFinite(count) && count >= 0 ? count : undefined
}

/** @param {object} data */
function findWatchingCount(data) {
  if (data == null || typeof data !== 'object') return undefined
  const renderer = data.videoViewCountRenderer
  if (renderer?.isLive === true) {
    const text = renderer.viewCount?.simpleText ?? renderer.viewCount?.runs?.map(run => run.text).join('')
    const digits = text?.match(/[\d, .\u00a0\u202f]+/)?.[0].replaceAll(/\D/g, '')
    return numericCount(digits)
  }
  for (const value of Object.values(data)) {
    const count = findWatchingCount(value)
    if (count !== undefined) return count
  }
  return undefined
}

/** @param {boolean} liveNow @param {boolean} isUpcoming */
function stateUpdate(liveNow, isUpcoming) {
  return {
    liveNow,
    isLive: liveNow,
    isUpcoming,
    premiere: isUpcoming,
    ...(!liveNow && !isUpcoming
      ? { isPremiere: false, premiereDate: null, premiereTimestamp: 0 }
      : {})
  }
}

/** @param {string} html @param {string} videoId */
export function getLocalSubscriptionPremiereUpdate(html, videoId) {
  try {
    const player = JSON.parse(extractAssignedJsonObject(html, 'ytInitialPlayerResponse') ?? 'null')
    const details = player?.videoDetails
    if (details?.videoId !== videoId) return null
    const isUpcoming = details.isUpcoming === true
    if (player.playabilityStatus?.status !== 'OK' && !isUpcoming) return null
    const microformat = player.microformat?.playerMicroformatRenderer
    const broadcast = microformat?.liveBroadcastDetails
    // Finished premieres can omit isLive entirely once they become VODs.
    const live = broadcast?.isLiveNow ?? details.isLive ??
      (numericCount(details.lengthSeconds) > 0 ? false : undefined)
    if (typeof live !== 'boolean') return null
    const liveNow = live && !isUpcoming
    const update = stateUpdate(liveNow, isUpcoming)
    if (!liveNow && !isUpcoming && typeof microformat?.publishDate === 'string') {
      const published = Date.parse(microformat.publishDate)
      if (Number.isFinite(published) && published > 0) update.published = published
    }
    if ((liveNow || isUpcoming) && typeof details.isLiveContent === 'boolean') {
      update.isPremiere = !details.isLiveContent
    }
    let viewCount
    if (liveNow) {
      const data = JSON.parse(extractAssignedJsonObject(html, 'ytInitialData') ?? 'null')
      viewCount = findWatchingCount(data)
    } else {
      viewCount = numericCount(details.viewCount)
    }
    if (viewCount !== undefined) update.viewCount = viewCount
    const lengthSeconds = numericCount(details.lengthSeconds)
    if (lengthSeconds !== undefined) update.lengthSeconds = lengthSeconds
    return update
  } catch {
    return null
  }
}

/** @param {object} video @param {string} videoId */
export function getInvidiousSubscriptionPremiereUpdate(video, videoId) {
  if (video?.error || video?.videoId !== videoId || typeof video.liveNow !== 'boolean') return null
  const update = stateUpdate(video.liveNow, video.isUpcoming === true)
  if (!update.liveNow && !update.isUpcoming) {
    const published = typeof video.published === 'number' && Number.isFinite(video.published)
      ? video.published * 1000
      : undefined
    if (Number.isFinite(published) && published > 0) update.published = published
  }
  const viewCount = numericCount(video.viewCount)
  const lengthSeconds = numericCount(video.lengthSeconds)
  if (viewCount !== undefined) update.viewCount = viewCount
  if (lengthSeconds !== undefined) update.lengthSeconds = lengthSeconds
  return update
}
