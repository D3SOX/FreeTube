const DAY = 24 * 60 * 60 * 1000
const STOPWORDS = new Set(`
  a about above after again against all an and any are as at be because been
  before being below between both but by can could did do does doing down during
  each few for from further
  had has have having he her here hers herself him himself his how i if in into
  is it its itself just many me more most much must my myself no nor not of off on once only or
  other our ours ourselves out over own same she should so some such than that
  the their theirs them themselves then there these they this those through to
  too under until up very was we were what when where which while who whom why
  will with would you your yours yourself yourselves don doesn didn isn aren
  won wouldn couldn shouldn video videos official new watch part episode
  aber alle allem allen aller alles als also am an ander andere anderen anderer
  anderes auch auf aus bei bin bis bist da damit dann das dass dein deine dem
  den denn der des dich die dies diese diesem diesen dieser dieses dir doch
  dort du durch ein eine einem einen einer eines er es etwas für gegen gewesen
  hab habe haben hat hatte hatten hier hin hinter ich ihr ihre ihrem ihren ihrer
  im in ist ja jede jedem jeden jeder jedes jetzt kann kein keine einem man
  mehr mein meine mit muss nach nicht nichts noch nun nur ob oder ohne schon
  sehr sein seine selbst sich sie sind so soll sollte sondern sonst über um und
  uns unser unsere unter viel vom von vor war waren warst was weg weil weiter
  welche welchem welchen welcher welches wenn werde werden wie wieder wir wird
  wirst wo wollen wollte wurde wurden zu zum zur zwar zwischen neu neue folge
`.trim().split(/\s+/u))

function number(value) {
  return (typeof value === 'number' || typeof value === 'string') && Number.isFinite(Number(value))
    ? Math.max(0, Number(value))
    : 0
}
function id(value) { return typeof value === 'string' && value !== 'N/A' ? value.trim() : '' }
function valid(video) { return video && typeof video === 'object' && id(video.videoId) && (video.type === undefined || video.type === 'video') }
const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })

export function recommendationTokens(text) {
  if (typeof text !== 'string') return []
  return [...segmenter.segment(text.slice(0, 2000).normalize('NFKC').toLowerCase())]
    .filter(part => part.isWordLike)
    .map(part => part.segment)
    .filter(word => /\p{L}/u.test(word) && word.length <= 40 &&
      (word.length >= 3 || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(word)) && !STOPWORDS.has(word))
}

export function recommendationFeatures(video) {
  const features = new Map()
  function add(text, weight, phrases = false) {
    const tokens = recommendationTokens(text).slice(0, 80)
    for (const token of new Set(tokens)) features.set(token, (features.get(token) ?? 0) + weight)
    if (phrases) {
      for (let i = 1; i < tokens.length; i++) {
        const phrase = `${tokens[i - 1]} ${tokens[i]}`
        features.set(phrase, (features.get(phrase) ?? 0) + weight * 1.3)
      }
    }
  }
  add(video?.title, 1, true)
  add(video?.description, 0.18)
  if (Array.isArray(video?.keywords)) add(video.keywords.join(' '), 1.4)
  return features
}

function normalize(vector) {
  let squaredLength = 0
  for (const value of vector.values()) squaredLength += value * value
  const length = Math.sqrt(squaredLength)
  return new Map([...vector].map(([key, value]) => [key, length ? value / length : 0]))
}
function sumInto(target, source, weight) {
  for (const [key, value] of source) target.set(key, (target.get(key) ?? 0) + value * weight)
}
function cosine(a, b) {
  let score = 0
  for (const [key, value] of a) score += value * (b.get(key) ?? 0)
  return Math.min(1, Math.max(0, score))
}
function decay(at, now, days) { return at ? 2 ** (-Math.max(0, now - number(at)) / (days * DAY)) : 0.1 }
function normalizedWeights(weights) {
  let maximum = 0
  for (const value of weights.values()) maximum = Math.max(maximum, value)
  return new Map([...weights].map(([key, value]) => [key, maximum ? value / maximum : 0]))
}
function tie(a, b) { return a < b ? -1 : a > b ? 1 : 0 }
function rotate(items, round) {
  if (!items.length) return []
  const offset = Math.max(0, Math.floor(number(round))) % items.length
  return [...items.slice(offset), ...items.slice(0, offset)]
}

export function recommendationSubscriptionIds(subscriptions) {
  return (Array.isArray(subscriptions) ? subscriptions : [])
    .map(channel => typeof channel === 'string' ? channel : channel?.id)
    .filter(channel => typeof channel === 'string' && channel.length > 0)
}

/**
 * Learn reversible long-term, current-session, negative and channel interests.
 * Saved videos and positive feedback contribute even before the first watch.
 * Actual playback observations replace seekable resume positions when available.
 */
export function buildRecommendationProfile(history, {
  now = Date.now(), records = [], favorites = [], saved = [], subscriptions = [], round = 0,
} = {}) {
  const entries = Array.isArray(history) ? history.filter(valid) : []
  const evidence = new Map((Array.isArray(records) ? records : []).filter(valid).map(record => [record.videoId, record]))
  const seenVideoIds = new Set((Array.isArray(history) ? history : []).map(video => id(video?.videoId)).filter(Boolean))
  const blockedChannels = new Set([...evidence.values()].filter(record => record.feedback === 'blockChannel').map(record => record.authorId).filter(Boolean))
  const rejectedIds = new Set([...evidence.values()].filter(record => ['dismiss', 'blockChannel'].includes(record.feedback)).map(record => record.videoId))
  const sources = new Map()
  for (const record of entries.toSorted((a, b) => number(b.timeWatched) - number(a.timeWatched)).slice(0, 1000)) {
    if (sources.has(record.videoId)) continue
    const learned = evidence.get(record.videoId)
    const actual = learned?.lastWatchSeconds
    const duration = number(record.lengthSeconds)
    const progress = actual ?? number(record.watchProgress)
    const completion = actual == null && record.isWatched === true ? 1 : duration ? Math.min(1, progress / duration) : 0
    const engagement = completion * 0.7 + Math.min(1, progress / 600) * 0.3
    const weight = Math.max(0.04, engagement) * (record.isShort ? 0.45 : 1)
    sources.set(record.videoId, { video: { ...record, ...learned }, weight, at: number(learned?.watchedAt ?? record.timeWatched), strong: completion >= 0.7 || (completion >= 0.35 && progress >= 180) })
  }
  for (const [videos, weight] of [[saved, 0.8], [favorites, 1.5]]) {
    for (const video of (Array.isArray(videos) ? videos : []).filter(valid).slice(0, 500)) {
      const existing = sources.get(video.videoId)
      sources.set(video.videoId, { video: { ...video, ...evidence.get(video.videoId) }, weight: Math.max(weight, existing?.weight ?? 0), at: existing?.at || now, strong: true })
    }
  }
  for (const record of evidence.values()) {
    if (record.feedback === 'positive') {
      const existing = sources.get(record.videoId)
      sources.set(record.videoId, { video: { ...existing?.video, ...record }, weight: Math.max(1.8, existing?.weight ?? 0), at: Math.max(number(existing?.at), number(record.feedbackAt)), strong: true })
    }
  }
  const usable = [...sources.values()].filter(source => !rejectedIds.has(source.video.videoId) && !blockedChannels.has(source.video.authorId))
  const documents = usable.map(source => recommendationFeatures(source.video))
  const frequency = new Map()
  for (const features of documents) for (const term of features.keys()) frequency.set(term, (frequency.get(term) ?? 0) + 1)
  const idf = new Map([...frequency].map(([term, count]) => [term, 1 + Math.log(1 + documents.length / count)]))
  const vectorFor = video => normalize(new Map([...recommendationFeatures(video)].map(([term, value]) => [term, value * (idf.get(term) ?? 1)])))
  const longTerm = new Map()
  const session = new Map()
  const negative = new Map()
  let negativeStrength = 0
  const channelWeights = new Map()
  for (const source of usable) {
    const vector = vectorFor(source.video)
    const weight = source.weight * decay(source.at, now, 60)
    source.vector = vector
    source.score = weight
    sumInto(longTerm, vector, weight)
    sumInto(session, vector, source.weight * decay(source.at, now, 0.5))
    const channel = id(source.video.authorId)
    if (channel) channelWeights.set(channel, (channelWeights.get(channel) ?? 0) + source.weight * decay(source.at, now, 30))
  }
  for (const record of evidence.values()) {
    if (['dismiss', 'blockChannel'].includes(record.feedback)) {
      const weight = decay(record.feedbackAt, now, 60)
      sumInto(negative, vectorFor(record), weight)
      negativeStrength += weight
    }
    // A short, actually played recommendation is weak negative evidence after
    // the session has ended. Clicks that failed to play do not count as skips.
    if (record.clickedAt && record.lastWatchSeconds > 0 && record.lastWatchSeconds < Math.min(30, number(record.lengthSeconds) * 0.15) &&
      record.watchedAt < now - 60_000 && record.feedback !== 'positive') {
      const weight = 0.25 * decay(record.watchedAt, now, 7)
      sumInto(negative, vectorFor(record), weight)
      negativeStrength += weight
    }
  }
  const interests = normalize(longTerm)
  const topicCandidates = usable.toSorted((a, b) => b.score - a.score || tie(a.video.videoId, b.video.videoId))
  // MMR seed selection covers different interests before repeating one topic.
  const seeds = []
  const seedPool = rotate(topicCandidates.filter(source => source.strong).slice(0, 24), round)
  while (seeds.length < 4 && seedPool.length) {
    let bestIndex = 0
    let bestScore = -Infinity
    for (let i = 0; i < seedPool.length; i++) {
      const source = seedPool[i]
      const similarity = Math.max(0, ...seeds.map(seed => cosine(seed.vector, source.vector)))
      const channelCount = seeds.filter(seed => seed.video.authorId === source.video.authorId).length
      const score = Math.sqrt(source.score) * (1 - similarity * 0.8) / (1 + channelCount * 2) / (1 + i * 0.015)
      if (score > bestScore) { bestScore = score; bestIndex = i }
    }
    seeds.push(seedPool.splice(bestIndex, 1)[0])
  }
  const queryPool = [...seeds, ...rotate(topicCandidates.slice(0, 30), round)]
  const queries = []
  const queryVectors = []
  for (const source of queryPool) {
    const tokens = [...new Set(recommendationTokens(source.video.title))]
    const pairs = tokens.slice(1).map((token, i) => [tokens[i], token])
      .sort((a, b) => b.reduce((score, token) => score + (longTerm.get(token) ?? 0), 0) - a.reduce((score, token) => score + (longTerm.get(token) ?? 0), 0))
    const pair = pairs.find(pair => !queries.includes(pair.join(' ')))
    if (!pair || queryVectors.some(vector => cosine(vector, source.vector) > 0.8)) continue
    queries.push(pair.join(' ')); queryVectors.push(source.vector)
    if (queries.length === 3) break
  }
  const channels = rotate([...channelWeights].sort((a, b) => b[1] - a[1] || tie(a[0], b[0])).slice(0, 12), round).slice(0, 3).map(([channel]) => channel)
  return {
    channels,
    queries,
    seeds: seeds.map(source => ({ videoId: source.video.videoId, title: source.video.title, authorId: source.video.authorId, weight: Math.min(1, source.score) })),
    channelWeights: normalizedWeights(channelWeights),
    tokenWeights: normalizedWeights(longTerm),
    seenVideoIds,
    interests,
    session: normalize(session),
    negative: new Map([...normalize(negative)].map(([term, weight]) => [term, weight * Math.min(1, negativeStrength)])),
    evidence,
    rejectedIds,
    blockedChannels,
    subscriptions: new Set(recommendationSubscriptionIds(subscriptions)),
    vectorFor,
    hasInterests: usable.length > 0,
    now,
  }
}

/** Rank by personalized relevance, graph evidence, confidence and feed novelty. */
export function scoreRecommendationCandidates(candidates, profile, { exploration = 0.2, now = Date.now() } = {}) {
  const scored = new Map()
  const seedMap = new Map(profile.seeds.map(seed => [seed.videoId, seed]))
  for (const video of (Array.isArray(candidates) ? candidates : [])) {
    if (!valid(video) || profile.seenVideoIds.has(video.videoId) || profile.rejectedIds.has(video.videoId) || profile.blockedChannels.has(video.authorId)) continue
    const vector = profile.vectorFor(video)
    const affinity = cosine(profile.interests, vector)
    const sessionAffinity = cosine(profile.session, vector)
    const negativeAffinity = cosine(profile.negative, vector)
    const channelAffinity = profile.channelWeights.get(id(video.authorId)) ?? 0
    const sources = video.recommendationSources ?? []
    const related = sources.filter(source => source.type === 'related' && seedMap.has(source.id))
    const graphAffinity = Math.min(1, related.reduce((total, source) => total + seedMap.get(source.id).weight * 0.6, 0))
    const subscribed = profile.subscriptions.has(video.authorId)
    // Graph evidence may admit a video with entirely different title vocabulary.
    const relevance = affinity * 0.48 + sessionAffinity * 0.17 + channelAffinity * 0.18 + graphAffinity * 0.32 + (subscribed ? 0.06 : 0)
    if (relevance <= 0 || (!profile.hasInterests && !subscribed)) continue
    const record = profile.evidence.get(video.videoId)
    const impressions = record?.impressions ?? []
    const lastSeen = impressions.at(-1) ?? 0
    const ignored = impressions.filter(at => at > now - 14 * DAY && at > (record?.clickedAt ?? 0)).length
    const recentExposure = lastSeen > now - 30 * 60_000 ? 0.25 : 1
    const repetition = recentExposure / (1 + ignored * 0.45)
    const uncertainty = 1 / Math.sqrt(1 + impressions.length + channelAffinity * 6)
    const novelty = Math.max(0, Math.min(0.5, exploration)) * uncertainty * (graphAffinity > 0 || affinity > 0.08 ? 0.3 : 0)
    const freshness = 0.85 + 0.15 * decay(video.published, now, 30)
    const negativePenalty = Math.max(0.04, 1 - negativeAffinity * 1.3)
    const score = (relevance + novelty) * freshness * repetition * negativePenalty
    const reason = related.length
      ? { type: 'related', text: seedMap.get(related[0].id).title }
      : channelAffinity > affinity
        ? { type: 'channel', text: video.author ?? '' }
        : subscribed && !profile.hasInterests
          ? { type: 'subscription', text: video.author ?? '' }
          : { type: 'topic', text: [...recommendationFeatures(video)].filter(([term]) => !term.includes(' ')).sort((a, b) => (profile.tokenWeights.get(b[0]) ?? 0) - (profile.tokenWeights.get(a[0]) ?? 0))[0]?.[0] ?? '' }
    const item = { video, score, affinity, graphAffinity, novelty, vector, reason, discovery: channelAffinity === 0 && !subscribed }
    if (!scored.has(video.videoId) || score > scored.get(video.videoId).score) scored.set(video.videoId, item)
  }
  return [...scored.values()].sort((a, b) => b.score - a.score || tie(a.video.videoId, b.video.videoId))
}

export function diversifyRecommendations(scored, { limit = 24, exploration = 0.2 } = {}) {
  limit = Math.floor(number(limit))
  const pool = [...scored]
  const selected = []
  const channelCounts = new Map()
  while (selected.length < limit && pool.length) {
    const wantsDiscovery = exploration > 0 && selected.length > 0 && selected.filter(item => item.discovery).length < Math.floor((selected.length + 1) * exploration)
    let bestIndex = -1
    let bestScore = -Infinity
    for (let i = 0; i < pool.length; i++) {
      const item = pool[i]
      const count = channelCounts.get(id(item.video.authorId)) ?? 0
      if (count >= 3) continue
      const similarity = Math.max(0, ...selected.map(other => cosine(item.vector, other.vector)))
      // Near-duplicate titles compete for a single place, even across channels.
      if (similarity > 0.96 && item.vector.size > 2) continue
      const score = item.score * (1 - 0.45 * similarity) / (1 + count * 0.6) * (wantsDiscovery && item.discovery ? 1.3 : 1)
      if (score > bestScore) { bestScore = score; bestIndex = i }
    }
    if (bestIndex < 0) break
    const item = pool.splice(bestIndex, 1)[0]
    selected.push(item)
    const channel = id(item.video.authorId)
    channelCounts.set(channel, (channelCounts.get(channel) ?? 0) + 1)
  }
  return selected
}

export function rankRecommendations(candidates, history, options = {}) {
  const profile = buildRecommendationProfile(history, options)
  return diversifyRecommendations(scoreRecommendationCandidates(candidates, profile, options), options).map(item => item.video)
}
