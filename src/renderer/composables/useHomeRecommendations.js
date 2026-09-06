import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import store from '../store/index'
import { buildRecommendationProfile, scoreRecommendationCandidates, diversifyRecommendations } from '../helpers/recommendations'
import { collectRecommendationCandidates, fetchRecommendationSource, mergeRecommendationCandidates } from '../helpers/recommendationCandidates'
import { getLocalChannelVideos, getLocalSearchResults, getLocalRelatedVideos } from '../helpers/api/local'
import { getInvidiousChannelVideos, getInvidiousSearchResults, getInvidiousRelatedVideos } from '../helpers/api/invidious'
import { isVideoHiddenByPreferences } from '../helpers/subscriptions'
import { shouldHideMembersOnlyContent } from '../helpers/restricted-playback'
import { useTabContext } from '../tabs/TabContext'

let cachedCandidates = null
const CACHE_LIFETIME = 15 * 60 * 1000

/** @param {import('vue').ComputedRef<boolean>} visible */
export function useHomeRecommendations(visible) {
  let candidates = []
  let generation = 0
  let requestController = null
  let round = 0
  let limit = 24
  let feedId = crypto.randomUUID()
  const ranked = shallowRef([])
  const isLoading = ref(false)
  const feedVersion = ref(0)
  const hasError = ref(false)
  const { isTabPresented } = useTabContext()
  const presented = computed(() => isTabPresented?.value ?? true)
  const enabled = computed(() => store.getters.getEnableHomeRecommendations)
  const history = computed(() => store.getters.getHistoryCacheSorted)
  const eligibleHistory = computed(() => history.value.filter(isVisible))
  const favorites = computed(() => store.getters.getPlaylist('favorites')?.videos.filter(isVisible) ?? [])
  const saved = computed(() => store.getters.getAllPlaylists.filter(playlist => playlist._id !== 'favorites').flatMap(playlist => playlist.videos).filter(isVisible))
  const subscriptions = computed(() => store.getters.getActiveProfile.subscriptions ?? [])
  const exploration = computed(() => Math.max(0, Math.min(0.5, Number(store.getters.getRecommendationExploration) || 0)))
  const records = computed(() => store.getters.getRecommendationRecords.filter(isVisible))
  const hasHistory = computed(() => store.getters.getRememberHistory && (
    eligibleHistory.value.length > 0 || favorites.value.length > 0 || saved.value.length > 0 ||
    records.value.some(record => record.feedback === 'positive') || subscriptions.value.length > 0
  ))
  const recommendations = computed(() => enabled.value && hasHistory.value
    ? ranked.value.filter(video => {
        const record = store.state.recommendations.recommendationRecords[video.videoId]
        return isVisible(video) && !store.getters.getHistoryCacheById[video.videoId] &&
      !['dismiss', 'blockChannel'].includes(record?.feedback) &&
      !records.value.some(record => record.feedback === 'blockChannel' && record.authorId === video.authorId)
      })
    : [])

  function isVisible(video) {
    return video != null && typeof video === 'object' &&
      !shouldHideMembersOnlyContent(video.isMembersOnly, store.getters) &&
      !isVideoHiddenByPreferences(video, {
        hideLiveStreams: store.getters.getHideLiveStreams,
        hideUpcomingPremieres: store.getters.getHideUpcomingPremieres,
        hiddenChannelNames: store.getters.getChannelsHiddenNames,
        forbiddenTitles: store.getters.getForbiddenTitlesParsed,
      })
  }
  function makeProfile() {
    return buildRecommendationProfile(eligibleHistory.value, {
      records: records.value, favorites: favorites.value, saved: saved.value, subscriptions: subscriptions.value, round,
    })
  }
  function rerank(profile = makeProfile()) {
    // An impression must affect the next feed, not remove a card under the pointer.
    const learned = {
      ...profile,
      evidence: new Map([...profile.evidence].map(([id, record]) => [id, record.lastFeedId === feedId
        ? { ...record, impressions: record.impressions?.slice(0, -1) }
        : record]))
    }
    ranked.value = diversifyRecommendations(scoreRecommendationCandidates(candidates.filter(video => isVisible(video) &&
      !store.getters.getHistoryCacheById[video.videoId]), learned, { exploration: exploration.value }), { limit, exploration: exploration.value })
      .map(item => ({ ...item.video, recommendationReason: item.reason }))
  }
  const sourceIdentity = videos => videos.map(video => [video.videoId, video.timeWatched, video.title])
  // Do not restart discovery on every playback tick or viewport impression.
  const context = computed(() => JSON.stringify({
    visible: visible.value,
    enabled: enabled.value,
    rememberHistory: store.getters.getRememberHistory,
    history: sourceIdentity(eligibleHistory.value),
    favorites: sourceIdentity(favorites.value),
    saved: sourceIdentity(saved.value),
    subscriptions: subscriptions.value.map(channel => channel.id),
    feedback: records.value.filter(record => record.feedback).map(record => [record.videoId, record.feedback, record.feedbackAt]),
    epoch: store.getters.getRecommendationEpoch,
    backend: store.getters.getBackendPreference,
    fallback: store.getters.getBackendFallback,
    instance: store.getters.getCurrentInvidiousInstanceUrl,
    authorization: store.getters.getCurrentInvidiousInstanceAuthorization,
    familyFriendly: store.getters.getShowFamilyFriendlyOnly,
  }))

  async function refresh(useCache = false, append = false) {
    const requestGeneration = ++generation
    requestController?.abort()
    requestController = null
    hasError.value = false
    isLoading.value = false
    if (!visible.value || !enabled.value || !store.getters.getRememberHistory) {
      candidates = []; ranked.value = []; cachedCandidates = null
      return
    }
    if (!presented.value) return
    if (!store.getters.getRecommendationEpoch) {
      try { await store.dispatch('loadRecommendations') } catch { hasError.value = true }
      // The epoch update schedules a fresh generation with the loaded evidence.
      return
    }
    if (!hasHistory.value) { ranked.value = []; candidates = []; cachedCandidates = null; return }
    const requestContext = context.value
    if (!append) {
      limit = 24
      if (useCache && cachedCandidates?.context === requestContext && Date.now() - cachedCandidates.at < CACHE_LIFETIME) {
        candidates = cachedCandidates.videos; feedId = cachedCandidates.feedId; round = cachedCandidates.round
        rerank()
        return
      }
      candidates = []; ranked.value = []; feedId = crypto.randomUUID(); feedVersion.value++
    } else limit = Math.min(96, limit + 24)
    if (!useCache) round++
    cachedCandidates = null
    const learned = makeProfile()
    if (!learned.channels.length) learned.channels = subscriptions.value.slice(0, 3).map(channel => channel.id)
    const subscriptionIds = new Set(subscriptions.value.map(channel => channel.id))
    candidates = mergeRecommendationCandidates([...candidates, ...Object.entries(store.getters.getVideoCache)
      .filter(([id]) => subscriptionIds.has(id))
      .toSorted(([a], [b]) => (learned.channelWeights.get(b) ?? 0) - (learned.channelWeights.get(a) ?? 0))
      .slice(0, 12).flatMap(([id, entry]) => (entry.videos ?? []).slice(0, 30)
        .map(video => ({ ...video, recommendationSources: [{ type: 'subscription', id }] })))])
    rerank(learned)
    isLoading.value = true
    requestController = new AbortController()
    const signal = requestController.signal
    const backend = process.env.SUPPORTS_LOCAL_API ? store.getters.getBackendPreference : 'invidious'
    const fallback = store.getters.getBackendFallback && process.env.SUPPORTS_LOCAL_API
    const familyFriendly = store.getters.getShowFamilyFriendlyOnly
    const searchSettings = { type: 'video', time: '', duration: '', features: [], prioritize: 'relevance' }
    const result = await collectRecommendationCandidates(learned, {
      fetchRelated: (id, signal) => withFallback(() => getLocalRelatedVideos(id, familyFriendly, signal), () => getInvidiousRelatedVideos(id, signal), signal),
      fetchChannel: async (id, signal) => (await withFallback(
        () => getLocalChannelVideos(id, familyFriendly, signal),
        () => getInvidiousChannelVideos(id, 'newest', undefined, { signal, enrichPublicationDates: false }), signal
      ))?.videos ?? [],
      search: (query, signal) => withFallback(
        async () => (await getLocalSearchResults(query, searchSettings, familyFriendly, signal)).results,
        () => getInvidiousSearchResults(query, 1, searchSettings, signal), signal
      ),
      onCandidates: videos => {
        if (generation !== requestGeneration) return
        candidates = mergeRecommendationCandidates([...candidates, ...videos]).slice(0, 1600); rerank(learned)
      },
      isCancelled: () => generation !== requestGeneration,
      signal,
    })
    if (generation !== requestGeneration) return
    hasError.value = result.failedSources > 0
    isLoading.value = false
    if (!hasError.value) cachedCandidates = { context: requestContext, videos: candidates, feedId, round, at: Date.now() }
    function withFallback(local, invidious, signal) {
      return fetchRecommendationSource(backend === 'local' ? local : invidious,
        fallback ? (backend === 'local' ? invidious : local) : null, signal)
    }
  }
  async function feedback(video, type) {
    try {
      await store.dispatch('recordRecommendationEvent', { video, type })
      rerank()
    } catch { hasError.value = true }
  }
  function recordImpression(video, visible, entry) {
    if (!visible || !presented.value || !enabled.value || entry?.target.closest('[aria-hidden="true"]')) return
    store.dispatch('recordRecommendationEvent', { type: 'impression', video, feedId }).catch(() => { hasError.value = true })
  }
  watch([context, presented], () => refresh(true), { immediate: true })
  watch(exploration, () => rerank())
  onBeforeUnmount(() => { generation++; requestController?.abort() })
  return {
    enabled,
    hasHistory,
    isLoading,
    hasError,
    recommendations,
    exploration,
    feedVersion,
    refresh: () => refresh(),
    loadMore: () => refresh(false, true),
    feedback,
    recordImpression,
    setExploration: value => store.dispatch('updateRecommendationExploration', Number(value)),
    reset: () => store.dispatch('resetRecommendations'),
    setEnabled: value => store.dispatch('updateEnableHomeRecommendations', value),
  }
}
