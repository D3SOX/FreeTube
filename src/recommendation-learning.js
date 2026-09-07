// Store the evidence behind interests, rather than an irreversible aggregate.
// This makes deleting one video's history also remove its learned contribution.
export const RECOMMENDATION_RECORD_LIMIT = 1500
export const RECOMMENDATION_RETENTION_MS = 180 * 86_400_000

export function recommendationVideo(video) {
  if (!video || typeof video.videoId !== 'string' || !/^[\w-]{1,100}$/.test(video.videoId) || ['meta', '__proto__', 'constructor', 'prototype'].includes(video.videoId)) return null
  const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : ''
  return {
    videoId: video.videoId,
    title: text(video.title, 512),
    authorId: text(video.authorId, 100),
    author: text(video.author, 200),
    description: text(video.description, 1500),
    keywords: Array.isArray(video.keywords) ? video.keywords.filter(word => typeof word === 'string').slice(0, 24) : [],
    lengthSeconds: Number.isFinite(Number(video.lengthSeconds)) ? Math.max(0, Number(video.lengthSeconds)) : 0,
    published: Number.isFinite(Number(video.published)) ? Math.max(0, Number(video.published)) : 0,
    isShort: video.isShort === true,
    type: 'video',
  }
}

/** Apply an idempotent observation; callers serialize writes per datastore. */
export function updateRecommendationRecord(previous, event, now = Date.now()) {
  const video = recommendationVideo(event?.video)
  if (!video || !['impression', 'click', 'watch', 'positive', 'dismiss', 'blockChannel'].includes(event.type)) return previous
  // Cards often omit metadata available during playback. Keep that evidence.
  for (const key of ['title', 'authorId', 'author', 'description', 'lengthSeconds', 'published']) {
    if (!video[key] && previous?.[key]) video[key] = previous[key]
  }
  if (!video.keywords.length && previous?.keywords?.length) video.keywords = previous.keywords
  if (event.video.isShort == null) video.isShort = previous?.isShort === true
  const record = {
    ...previous,
    ...video,
    _id: video.videoId,
    updatedAt: now,
  }
  if (event.type === 'watch') {
    if (typeof event.sessionId !== 'string' || !/^[\w-]{1,100}$/.test(event.sessionId) ||
      !Number.isFinite(event.seconds) || event.seconds <= 0) return previous
    const sessions = Object.assign(Object.create(null), previous?.sessions)
    const previousSeconds = sessions[event.sessionId]?.seconds ?? 0
    const seconds = Math.min(event.seconds, 24 * 3600)
    if (seconds <= previousSeconds) return previous
    sessions[event.sessionId] = { seconds, at: now }
    record.sessions = Object.fromEntries(Object.entries(sessions).sort((a, b) => b[1].at - a[1].at).slice(0, 8))
    record.watchSeconds = Math.min(1_000_000, (previous?.watchSeconds ?? 0) + seconds - previousSeconds)
    record.lastWatchSeconds = seconds
    record.watchedAt = now
  } else if (event.type === 'impression') {
    // Count visibility once per feed, even across shelf paging and re-renders.
    if (typeof event.feedId !== 'string' || previous?.lastFeedId === event.feedId) return previous
    record.lastFeedId = event.feedId.slice(0, 100)
    record.impressions = [...(previous?.impressions ?? []), now].slice(-12)
  } else if (event.type === 'click') {
    record.clickedAt = now
  } else {
    record.feedback = event.type
    record.feedbackAt = now
  }
  return record
}

/** Conservative watch sampling: seeks, stalls and suspended timers teach nothing. */
export function sampleRecommendationPlayback(previous, { videoId, time, now, playing, rate = 1 }) {
  const current = { videoId, time, now, playing }
  if (!playing || !previous?.playing || previous.videoId !== videoId) return { current, seconds: 0 }
  const elapsed = (now - previous.now) / 1000
  const advance = time - previous.time
  if (elapsed <= 0 || elapsed > 5 || advance <= 0 || advance > elapsed * Math.max(1, rate) + 1) {
    return { current, seconds: 0 }
  }
  return { current, seconds: Math.min(advance, elapsed * Math.max(0.25, rate)) }
}
