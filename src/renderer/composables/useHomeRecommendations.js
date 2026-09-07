import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import store from '../store/index'
import { buildRecommendationProfile, scoreRecommendationCandidates, diversifyRecommendations, recommendationSubscriptionIds } from '../helpers/recommendations'
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
  let initialized = false
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
  const subscriptions = computed(() => recommendationSubscriptionIds(store.getters.getActiveProfile?.subscriptions))
  const exploration = computed(() => Math.max(0, Math.min(0.5, Number(store.getters.getRecommendationExploration) || 0)))
  const records = computed(() => store.getters.getRecommendationRecords.filter(isVisible))
  const hasHistory = computed(() => store.getters.getRememberHistory && (
    eligibleHistory.value.length > 0 || favorites.value.length > 0 || saved.value.length > 0 ||
    records.value.some(record => record.feedback === 'positive') || subscriptions.value.length > 0
  ))
  const recommendations = computed(() => enabled.value && hasHistory.value
    ? ranked.value.filter(video => {
        const record = store.state.recommendations.recommendationRecords[video.videoId]
        return isVisible(video) &&
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
  // This identifies reusable candidates when opening Home, not a reason to
  // replace a feed that is already on screen.
  const context = computed(() => JSON.stringify({
    visible: visible.value,
    enabled: enabled.value,
    rememberHistory: store.getters.getRememberHistory,
    history: sourceIdentity(eligibleHistory.value),
    favorites: sourceIdentity(favorites.value),
    saved: sourceIdentity(saved.value),
    subscriptions: subscriptions.value,
    feedback: records.value.filter(record => record.feedback).map(record => [record.videoId, record.feedback, record.feedbackAt]),
    epoch: store.getters.getRecommendationEpoch,
    backend: store.getters.getBackendPreference,
    fallback: store.getters.getBackendFallback,
    instance: store.getters.getCurrentInvidiousInstanceUrl,
    authorization: store.getters.getCurrentInvidiousInstanceAuthorization,
    familyFriendly: store.getters.getShowFamilyFriendlyOnly,
  }))

  async function refresh(useCache = false, append = false) {
    cancelRequest()
    const requestGeneration = generation
    hasError.value = false
    if (!visible.value || !enabled.value || !store.getters.getRememberHistory) {
      clearFeed()
      return
    }
    if (!presented.value) return
    if (!append) initialized = false
    if (!store.getters.getRecommendationEpoch) {
      try { await store.dispatch('loadRecommendations') } catch { hasError.value = true }
      if (requestGeneration !== generation || !store.getters.getRecommendationEpoch) return
    }
    if (!hasHistory.value) { clearFeed(); return }
    const requestContext = context.value
    if (!append) {
      limit = 24
      if (useCache && cachedCandidates?.context === requestContext && Date.now() - cachedCandidates.at < CACHE_LIFETIME) {
        candidates = cachedCandidates.videos; feedId = cachedCandidates.feedId; round = cachedCandidates.round
        rerank()
        initialized = true
        return
      }
      candidates = []; ranked.value = []; feedId = crypto.randomUUID(); feedVersion.value++
    } else limit = Math.min(96, limit + 24)
    if (!useCache) round++
    cachedCandidates = null
    const learned = makeProfile()
    if (!learned.channels.length) learned.channels = subscriptions.value.slice(0, 3)
    const subscriptionIds = new Set(subscriptions.value)
    candidates = mergeRecommendationCandidates([...candidates, ...Object.entries(store.getters.getVideoCache)
      .filter(([id]) => subscriptionIds.has(id))
      .toSorted(([a], [b]) => (learned.channelWeights.get(b) ?? 0) - (learned.channelWeights.get(a) ?? 0))
      .slice(0, 12).flatMap(([id, entry]) => (entry.videos ?? []).slice(0, 30)
        .map(video => ({ ...video, recommendationSources: [{ type: 'subscription', id }] })))])
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
      isCancelled: () => generation !== requestGeneration,
      signal,
    })
    if (generation !== requestGeneration) return
    // Publish one completed ranking so each source response cannot reshuffle
    // cards while the user is choosing a video.
    candidates = mergeRecommendationCandidates([...candidates, ...result.videos]).slice(0, 1600)
    rerank(learned)
    initialized = true
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
    } catch { hasError.value = true }
  }
  function recordImpression(video, visible, entry) {
    if (!visible || !presented.value || !enabled.value || entry?.target.closest('[aria-hidden="true"]')) return
    store.dispatch('recordRecommendationEvent', { type: 'impression', video, feedId }).catch(() => { hasError.value = true })
  }
  function cancelRequest() {
    generation++
    requestController?.abort()
    requestController = null
    isLoading.value = false
  }
  function clearFeed() {
    initialized = false
    candidates = []; ranked.value = []; cachedCandidates = null
  }
  // Load persisted feedback before deciding whether there are any seeds.
  const available = computed(() => visible.value && enabled.value && store.getters.getRememberHistory &&
    (hasHistory.value || !store.getters.getRecommendationEpoch))
  watch([available, presented], () => {
    if (!available.value) {
      cancelRequest()
      clearFeed()
    } else if (!presented.value) {
      cancelRequest()
    } else if (!initialized) {
      refresh(true)
    }
  }, { immediate: true })
  // Revoking learning or changing the backend cancels obsolete requests.
  // A completed feed stays put; the next explicit refresh uses the new context.
  watch([
    () => store.getters.getRecommendationEpoch,
    () => store.getters.getBackendPreference,
    () => store.getters.getBackendFallback,
    () => store.getters.getCurrentInvidiousInstanceUrl,
    () => store.getters.getCurrentInvidiousInstanceAuthorization,
    () => store.getters.getShowFamilyFriendlyOnly,
  ], () => {
    cachedCandidates = null
    if (isLoading.value) {
      cancelRequest()
      if (!initialized) refresh(true)
    }
  })
  watch([() => history.value.length === 0, () => store.getters.getRecommendationEpoch],
    ([empty, epoch], [wasEmpty, previousEpoch]) => {
      if (!empty || (wasEmpty && (!previousEpoch || epoch === previousEpoch))) return
      // Clearing history also discards its visible suggestions when favorites
      // or subscriptions still supply seeds. Only Refresh should replace them.
      cancelRequest()
      clearFeed()
      initialized = available.value
    })
  watch(exploration, () => rerank())
  onBeforeUnmount(cancelRequest)
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
    reset: async () => { await store.dispatch('resetRecommendations'); await refresh() },
    setEnabled: value => store.dispatch('updateEnableHomeRecommendations', value),
  }
}
