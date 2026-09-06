import { DBRecommendationHandlers } from '../../../datastores/handlers/index'

let loading = null
export default {
  state: { recommendationRecords: {}, recommendationEpoch: null, recommendationRevision: -1 },
  getters: {
    getRecommendationRecords: state => Object.values(state.recommendationRecords),
    getRecommendationEpoch: state => state.recommendationEpoch,
  },
  mutations: {
    applyRecommendationUpdate(state, update) {
      if (!update || update.revision < state.recommendationRevision) return
      if (update.records) {
        state.recommendationRecords = Object.fromEntries(update.records.map(record => [record.videoId, record]))
        state.recommendationEpoch = update.epoch
      } else if (update.epoch === state.recommendationEpoch) {
        if (update.record) state.recommendationRecords[update.record.videoId] = update.record
        for (const id of update.removed ?? []) delete state.recommendationRecords[id]
      } else return
      state.recommendationRevision = update.revision
    },
  },
  actions: {
    async receiveRecommendationUpdate({ state, dispatch, commit }, update) {
      if (update && !update.records && update.epoch !== state.recommendationEpoch) {
        await dispatch('loadRecommendations')
      } else commit('applyRecommendationUpdate', update)
    },
    async loadRecommendations({ commit }) {
      loading ??= DBRecommendationHandlers.find().finally(() => { loading = null })
      commit('applyRecommendationUpdate', await loading)
    },
    async recordRecommendationEvent({ commit, dispatch, state, rootGetters }, event) {
      if (!rootGetters.getEnableHomeRecommendations || !rootGetters.getRememberHistory) return
      if (!state.recommendationEpoch) await dispatch('loadRecommendations')
      if (!rootGetters.getEnableHomeRecommendations || !rootGetters.getRememberHistory) return
      const result = await DBRecommendationHandlers.record({ ...event, epoch: event.epoch ?? state.recommendationEpoch })
      if (result.stale) await dispatch('loadRecommendations')
      else commit('applyRecommendationUpdate', result)
    },
    async resetRecommendations({ commit }) {
      commit('applyRecommendationUpdate', await DBRecommendationHandlers.reset())
    },
    async removeRecommendationHistory({ commit }, ids) {
      commit('applyRecommendationUpdate', await DBRecommendationHandlers.remove(ids))
    },
  },
}
