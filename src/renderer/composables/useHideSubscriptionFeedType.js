import { computed, inject, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import store from '../store'
import { getSubscriptionFeedTypeOptions, getUpdatedSubscriptionFeedTypes, normalizeSubscriptionChannelSettings } from '../helpers/subscription-channels'
import { showToast } from '../helpers/utils'

export const subscriptionFeedTypeKey = Symbol('subscriptionFeedType')

// Cards share this queue so each hide starts with the preceding save's settings.
let pendingFeedTypeUpdates = Promise.resolve()

/**
 * @param {() => string} getChannelId
 * @param {boolean} isPost
 */
export function useHideSubscriptionFeedType(getChannelId, isPost = false) {
  const { t } = useI18n()
  const feedType = inject(subscriptionFeedTypeKey, ref(null))
  const saving = ref(false)
  const channel = computed(() => store.getters.getSubscribedChannelsById.get(getChannelId()))
  const option = computed(() => {
    const type = getSubscriptionFeedTypeOptions(t).find(type => type.id === feedType.value)
    // Embedded videos in posts must not change the embedded author's post settings.
    if (!type || isPost !== (type.id === 'posts') || !channel.value ||
      !normalizeSubscriptionChannelSettings(channel.value).feedTypes.includes(type.id)) return null

    return {
      label: t('Subscriptions.Never show {type} from this channel in feeds again', { type: type.label }),
      value: 'hideSubscriptionFeedType',
      icon: ['fas', 'eye-slash'],
      wrapLabel: true,
      disabled: saving.value
    }
  })

  function hide() {
    if (!option.value || saving.value) return
    const channelId = getChannelId()
    const typeToHide = feedType.value
    saving.value = true
    pendingFeedTypeUpdates = pendingFeedTypeUpdates.then(async () => {
      try {
        const currentChannel = store.getters.getSubscribedChannelsById.get(channelId)
        const saved = await store.dispatch('updateChannelSettings', {
          channelId,
          settings: {
            feedTypes: getUpdatedSubscriptionFeedTypes(
              normalizeSubscriptionChannelSettings(currentChannel).feedTypes,
              typeToHide,
              false
            )
          }
        })
        if (!saved) throw new Error('Failed to save subscription feed type')
      } catch (error) {
        console.error(error)
        showToast({
          message: t('Channel.Failed to save subscription settings'),
          icon: ['fas', 'circle-exclamation']
        })
      } finally {
        saving.value = false
      }
    })
    return pendingFeedTypeUpdates
  }

  return { hideSubscriptionFeedType: hide, hideSubscriptionFeedTypeOption: option }
}
