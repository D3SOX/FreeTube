import { normalizeSubscriptionChannelSettings } from './subscription-channels.js'
import { areJsonValuesEqual } from './jsonValues.js'
import { mergeSettingEntry } from './sync-settings-conflict.js'

// Stored in the existing encrypted settings collection; channel records remain
// the local source of truth.
export const SUBSCRIPTION_CHANNEL_SETTINGS_SYNC_KEY = 'subscriptionChannelSettings'

export function getSubscriptionSettingsForSync(store) {
  return Object.fromEntries(store.state.profiles.profileList[0].subscriptions.map(channel => {
    const settings = normalizeSubscriptionChannelSettings(channel)
    // JSON has no undefined value. Omission means "use the global limit".
    if (settings.dailyVideoLimit === undefined) delete settings.dailyVideoLimit
    return [channel.id, settings]
  }))
}

export function mergeSubscriptionSettingsEntry(options) {
  // Subscription sync can be disabled independently. Compare only channels
  // present locally, so remote-only edits do not count as local changes.
  const subscribedEntry = entry => entry && ({
    ...entry,
    value: Object.fromEntries(Object.entries(entry.value ?? {})
      .filter(([channelId]) => Object.hasOwn(options.value, channelId)))
  })
  const merged = mergeSettingEntry({
    ...options,
    old: subscribedEntry(options.old),
    remoteEntry: subscribedEntry(options.remoteEntry)
  })
  // This device cannot edit settings for channels it is not subscribed to.
  return { ...merged, value: { ...options.remoteEntry?.value, ...merged.value } }
}

export async function applySubscriptionSettingsSync(store, value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return

  for (const channel of store.state.profiles.profileList[0].subscriptions) {
    if (!Object.hasOwn(value, channel.id)) continue
    const settings = normalizeSubscriptionChannelSettings(value[channel.id])
    if (areJsonValuesEqual(normalizeSubscriptionChannelSettings(channel), settings)) continue
    const saved = await store.dispatch('updateChannelSettings', { channelId: channel.id, settings })
    if (!saved) throw new Error('Failed to apply synced subscription settings')
  }
}
