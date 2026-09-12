import { MAIN_PROFILE_ID, THEME_BG_COLOR, THEME_TEXT_COLOR } from '../../../constants'
import { DBProfileHandlers } from '../../../datastores/handlers/index'
import { deepCopy } from '../../helpers/utils'
import { getProfileWithUpdatedSubscriptionDetails } from '../../helpers/subscription-profile-details'

import { SUBSCRIPTION_CHANNEL_SETTINGS_SYNC_KEY } from '../../helpers/subscription-settings-sync'

const state = {
  profileList: [{
    _id: MAIN_PROFILE_ID,
    name: 'All Channels',
    bgColor: THEME_BG_COLOR,
    textColor: THEME_TEXT_COLOR,
    subscriptions: []
  }],
  activeProfile: MAIN_PROFILE_ID
}

const getters = {
  getProfileList: (state) => {
    return state.profileList
  },

  getActiveProfile: (state) => {
    const activeProfileId = state.activeProfile
    return state.profileList.find((profile) => {
      return profile._id === activeProfileId
    })
  },

  profileById: (state) => (id) => {
    return state.profileList.find(p => p._id === id)
  },

  getSubscribedChannelIdSet: (state) => {
    // The all channels profile is always the first profile in the array
    const mainProfile = state.profileList[0]

    return mainProfile.subscriptions.reduce((set, channel) => set.add(channel.id), new Set())
  },

  /** Cached subscription details, so channel ids can be resolved to names without a network request */
  getSubscribedChannelsById: (state) => {
    // The all channels profile is always the first profile in the array
    const mainProfile = state.profileList[0]

    return new Map(mainProfile.subscriptions.map((channel) => [channel.id, channel]))
  },
}

const collator = new Intl.Collator(undefined, {
  usage: 'sort',
  caseFirst: 'upper',
  sensitivity: 'case',
  numeric: true
})

function profileSort(a, b) {
  if (a._id === MAIN_PROFILE_ID) return -1
  if (b._id === MAIN_PROFILE_ID) return 1

  const nameA = a.name.normalize('NFC')
  const nameB = b.name.normalize('NFC')

  return collator.compare(nameA, nameB)
}

const actions = {
  async grabAllProfiles({ rootState, commit, state }, defaultName = null) {
    let profiles
    try {
      profiles = await DBProfileHandlers.find()
    } catch (errMessage) {
      console.error(errMessage)
      return null
    }

    if (!Array.isArray(profiles)) return null

    if (profiles.length === 0) {
      // Create a default profile and persist it
      const defaultProfile = {
        _id: MAIN_PROFILE_ID,
        name: defaultName,
        bgColor: THEME_BG_COLOR,
        textColor: THEME_TEXT_COLOR,
        subscriptions: []
      }

      try {
        await DBProfileHandlers.create(defaultProfile)
        commit('setProfileList', [defaultProfile])
      } catch (errMessage) {
        console.error(errMessage)
        return null
      }

      return false
    }

    // We want the primary profile to always be first
    // So sort with that then sort alphabetically by profile name
    profiles = profiles.sort(profileSort)

    if (state.profileList.length < profiles.length) {
      const profile = profiles.find((profile) => {
        return profile._id === rootState.settings.defaultProfile
      })

      if (profile) {
        commit('setActiveProfile', profile._id)
      }
    }

    commit('setProfileList', profiles)
    return true
  },

  async batchUpdateSubscriptionDetails({ dispatch, state }, channels) {
    if (channels.length === 0) { return }

    const profileList = state.profileList

    for (const profile of profileList) {
      const updatedProfile = getProfileWithUpdatedSubscriptionDetails(profile, channels)

      if (updatedProfile !== null) {
        await dispatch('updateProfile', updatedProfile)
      }
    }
  },

  async updateSubscriptionDetails({ dispatch, state }, { channelThumbnailUrl, channelName, channelId }) {
    const thumbnail = channelThumbnailUrl
      // change thumbnail size if different
      ?.replace(/=s\d*/, '=s176')
      // If this is an Invidious URL, convert it to a YouTube one
      .replace(/^https?:\/\/[^/]+\/ggpht/, 'https://yt3.googleusercontent.com') ??
      null
    const profileList = state.profileList

    for (const profile of profileList) {
      const index = profile.subscriptions.findIndex((channel) => {
        return channel.id === channelId
      })

      if (index === -1) { continue }

      // Only copied when something has actually changed
      let currentProfileCopy

      if (channelName != null && profile.subscriptions[index].name !== channelName) {
        if (currentProfileCopy === undefined) {
          currentProfileCopy = deepCopy(profile)
        }

        currentProfileCopy.subscriptions[index].name = channelName
      }

      if (thumbnail != null && profile.subscriptions[index].thumbnail !== thumbnail) {
        if (currentProfileCopy === undefined) {
          currentProfileCopy = deepCopy(profile)
        }

        currentProfileCopy.subscriptions[index].thumbnail = thumbnail
      }

      if (currentProfileCopy !== undefined) {
        await dispatch('updateProfile', currentProfileCopy)
      } else { // channel has not been updated, stop iterating through profiles
        break
      }
    }
  },

  async updateChannelSettings({ commit, dispatch, state }, { channelId, settings }) {
    const primarySubscription = state.profileList[0].subscriptions
      .find(channel => channel.id === channelId)
    if (primarySubscription === undefined) return false

    const channel = deepCopy(primarySubscription)
    if (Array.isArray(settings.feedTypes)) {
      channel.feedTypes = [...settings.feedTypes]
    }
    if (Object.hasOwn(settings, 'dailyVideoLimit')) {
      if (settings.dailyVideoLimit === undefined) {
        delete channel.dailyVideoLimit
      } else {
        channel.dailyVideoLimit = settings.dailyVideoLimit
      }
    }
    if (Object.hasOwn(settings, 'showMembersOnly')) {
      if (typeof settings.showMembersOnly === 'boolean') {
        channel.showMembersOnly = settings.showMembersOnly
      } else {
        delete channel.showMembersOnly
      }
    }

    const profileIds = state.profileList
      .filter(profile => profile.subscriptions.some(subscription => subscription.id === channelId))
      .map(profile => profile._id)

    try {
      const updatedProfileIds = await DBProfileHandlers.updateChannelSettings(channel, profileIds)
      if (!Array.isArray(updatedProfileIds)) return false

      if (updatedProfileIds.length > 0) {
        await dispatch('recordSyncSettingEdit', SUBSCRIPTION_CHANNEL_SETTINGS_SYNC_KEY)
        commit('updateChannelSettings', { channel, profileIds: updatedProfileIds })
      }
      return updatedProfileIds.length === profileIds.length
    } catch (error) {
      console.error(error)
      return false
    }
  },

  async createProfile({ commit }, profile) {
    try {
      const newProfile = await DBProfileHandlers.create(profile)
      commit('addProfileToList', newProfile)
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async updateProfile({ commit }, profile) {
    try {
      await DBProfileHandlers.upsert(profile)
      commit('upsertProfileToList', profile)
      return true
    } catch (errMessage) {
      console.error(errMessage)
      return false
    }
  },

  async addChannelToProfiles({ commit }, { channel, profileIds }) {
    // If this is an Invidious URL, convert it to a YouTube one
    if (!channel.thumbnail.startsWith('https://yt3.googleusercontent.com/')) {
      channel.thumbnail = channel.thumbnail.replace(/^https?:\/\/[^/]+\/ggpht/, 'https://yt3.googleusercontent.com')
    }

    try {
      await DBProfileHandlers.addChannelToProfiles(channel, profileIds)
      commit('addChannelToProfiles', { channel, profileIds })
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async removeChannelFromProfiles({ commit, dispatch, rootGetters }, { channelId, profileIds }) {
    try {
      await DBProfileHandlers.removeChannelFromProfiles(channelId, profileIds)
      commit('removeChannelFromProfiles', { channelId, profileIds })

      if (profileIds.includes(MAIN_PROFILE_ID)) {
        try {
          const rules = JSON.parse(rootGetters.getYtDlpAutomaticDownloadRules || '{}')
          if (rules !== null && typeof rules === 'object' && !Array.isArray(rules) && rules[channelId] !== undefined) {
            delete rules[channelId]
            await dispatch('updateYtDlpAutomaticDownloadRules', JSON.stringify(rules))
          }
        } catch (error) {
          console.error('Failed to remove automatic download settings for the unsubscribed channel', error)
        }
      }
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async removeProfile({ commit }, profileId) {
    try {
      await DBProfileHandlers.delete(profileId)
      commit('removeProfileFromList', profileId)
      return true
    } catch (errMessage) {
      console.error(errMessage)
      return false
    }
  },

  updateActiveProfile({ commit }, id) {
    commit('setActiveProfile', id)
  }
}

const mutations = {
  setProfileList(state, profileList) {
    state.profileList = profileList
  },

  setActiveProfile(state, activeProfile) {
    state.activeProfile = activeProfile
  },

  addProfileToList(state, profile) {
    state.profileList.push(profile)
    state.profileList.sort(profileSort)
  },

  upsertProfileToList(state, updatedProfile) {
    const i = state.profileList.findIndex((p) => {
      return p._id === updatedProfile._id
    })

    if (i === -1) {
      state.profileList.push(updatedProfile)
    } else {
      state.profileList.splice(i, 1, updatedProfile)
    }

    state.profileList.sort(profileSort)
  },

  addChannelToProfiles(state, { channel, profileIds }) {
    for (const id of profileIds) {
      const profile = state.profileList.find(profile => profile._id === id)
      if (!profile) { continue }

      if (!profile.subscriptions.some(subscription => subscription.id === channel.id)) {
        profile.subscriptions.push(channel)
      }
    }
  },

  removeChannelFromProfiles(state, { channelId, profileIds }) {
    for (const id of profileIds) {
      const profile = state.profileList.find(profile => profile._id === id)
      if (!profile) { continue }

      // use filter instead of splice in case the subscription appears multiple times
      // https://github.com/FreeTubeApp/FreeTube/pull/3468#discussion_r1179290877
      profile.subscriptions = profile.subscriptions.filter(channel => channel.id !== channelId)
    }
  },

  updateChannelSettings(state, { channel, profileIds }) {
    for (const id of profileIds) {
      const profile = state.profileList.find(profile => profile._id === id)
      if (!profile) continue

      profile.subscriptions = profile.subscriptions
        .filter(subscription => subscription.id !== channel.id)
      profile.subscriptions.push(deepCopy(channel))
    }
  },

  removeProfileFromList(state, profileId) {
    const i = state.profileList.findIndex((profile) => {
      return profile._id === profileId
    })

    if (i !== -1) {
      state.profileList.splice(i, 1)
    }
  }
}

export default {
  state,
  getters,
  actions,
  mutations
}
