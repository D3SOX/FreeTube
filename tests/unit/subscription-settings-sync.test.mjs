import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import * as subscriptionSync from '../../src/renderer/helpers/subscription-settings-sync.js'
import { mergeSettingEntry, resolveMergedThemeEntry } from '../../src/renderer/helpers/sync-settings-conflict.js'

const key = subscriptionSync.SUBSCRIPTION_CHANNEL_SETTINGS_SYNC_KEY
const source = await readFile(new URL('../../src/renderer/helpers/sync-server.js', import.meta.url), 'utf8')
const context = vm.createContext({
  ...subscriptionSync,
  mergeSettingEntry,
  resolveMergedThemeEntry,
  CUSTOM_THEMES_SYNC_KEY: 'customThemes',
  normalizeCustomThemes: value => value,
  getSyncableSettingKeys: () => [],
  isSettingSyncEnabled: settings => !settings.syncServerSettingsExcluded.includes(key),
  deepCopy: structuredClone,
})
vm.runInContext(source
  .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
  .replace(/^export \{[\s\S]*?\}\n/gm, '')
  .replace(/^export (?=(async )?(function|class|const))/gm, ''), context)

function createStore(channels, excluded = []) {
  const profiles = [{ subscriptions: structuredClone(channels) }, { subscriptions: structuredClone(channels) }]
  return {
    state: {
      profiles: { profileList: profiles },
      settings: { syncServerSettingsExcluded: excluded },
      utils: { customThemes: [] },
    },
    dispatch: async (action, { channelId, settings }) => {
      assert.equal(action, 'updateChannelSettings')
      for (const profile of profiles) {
        Object.assign(profile.subscriptions.find(channel => channel.id === channelId), settings)
      }
      return true
    },
  }
}

function createClient(entries = []) {
  return {
    entries,
    async getSettings() { return this.entries },
    async putSettings(value) { this.entries = structuredClone(value) },
  }
}

test('syncs subscription settings through the existing settings collection to another device', async () => {
  const first = createStore([{ id: 'channel', name: 'Original', feedTypes: ['shorts'], dailyVideoLimit: 3, showMembersOnly: true }])
  const client = createClient()
  await context.syncSettings(client, first)
  assert.deepEqual(client.entries.find(entry => entry.key === key).value, {
    channel: { feedTypes: ['shorts'], dailyVideoLimit: 3, showMembersOnly: true },
  })
  const second = createStore([{ id: 'channel', name: 'Local name', thumbnail: 'local-thumbnail' }])
  await context.syncSettings(client, second)
  for (const profile of second.state.profiles.profileList) {
    assert.deepEqual(profile.subscriptions[0], {
      id: 'channel', name: 'Local name', thumbnail: 'local-thumbnail',
      feedTypes: ['shorts'], dailyVideoLimit: 3, showMembersOnly: true,
    })
  }
})

test('applies a newer remote reset to defaults including the global daily limit', async () => {
  const store = createStore([{ id: 'channel', feedTypes: [], dailyVideoLimit: null, showMembersOnly: true }])
  const client = createClient()
  const previous = await context.syncSettings(client, store)
  const entry = client.entries.find(entry => entry.key === key)
  entry.value = { channel: { feedTypes: ['videos', 'shorts', 'live', 'posts'], showMembersOnly: false } }
  entry.updatedAt += 1
  await context.syncSettings(client, store, previous)
  assert.equal(store.state.profiles.profileList[0].subscriptions[0].dailyVideoLimit, undefined)
  assert.equal(store.state.profiles.profileList[0].subscriptions[0].showMembersOnly, false)
  assert.deepEqual(store.state.profiles.profileList[0].subscriptions[0].feedTypes, ['videos', 'shorts', 'live', 'posts'])
})

test('disabling subscription settings sync preserves local and remote values', async () => {
  const store = createStore([{ id: 'channel', feedTypes: ['videos'] }], [key])
  store.dispatch = () => assert.fail('Excluded settings must not be applied')
  const remote = { key, value: { channel: { feedTypes: ['posts'] } }, updatedAt: 1 }
  const client = createClient([remote])
  await context.syncSettings(client, store)
  assert.deepEqual(client.entries.find(entry => entry.key === key), remote)
  assert.deepEqual(store.state.profiles.profileList[0].subscriptions[0].feedTypes, ['videos'])
})

test('does not subscribe unknown channels or reset channels absent from remote settings', async () => {
  const store = createStore([{ id: 'local', dailyVideoLimit: 5 }])
  store.dispatch = () => assert.fail('Unrelated channels must not be changed')
  await subscriptionSync.applySubscriptionSettingsSync(store, { remote: { dailyVideoLimit: 2 } })
  assert.equal(store.state.profiles.profileList[0].subscriptions.length, 1)
  assert.equal(store.state.profiles.profileList[0].subscriptions[0].dailyVideoLimit, 5)
})

test('failed persistence aborts sync before uploading a successful snapshot', async () => {
  const store = createStore([{ id: 'channel' }])
  store.dispatch = async () => false
  const client = createClient([{ key, value: { channel: { dailyVideoLimit: 2 } }, updatedAt: 1 }])
  client.putSettings = () => assert.fail('Failed updates must be retried')
  await assert.rejects(context.syncSettings(client, store), /Failed to apply synced subscription settings/)
})

test('uploads a newer local edit using its saved edit time', async () => {
  const store = createStore([{ id: 'channel', dailyVideoLimit: 2 }])
  const client = createClient()
  const previous = await context.syncSettings(client, store)
  const entry = client.entries.find(entry => entry.key === key)
  store.state.settings.syncServerSettingUpdatedAt = { [key]: entry.updatedAt + 2 }
  store.state.profiles.profileList[0].subscriptions[0].dailyVideoLimit = null
  entry.value.channel.dailyVideoLimit = 3
  entry.updatedAt += 1
  await context.syncSettings(client, store, previous)
  assert.equal(client.entries.find(entry => entry.key === key).value.channel.dailyVideoLimit, null)
  assert.equal(client.entries.find(entry => entry.key === key).updatedAt, store.state.settings.syncServerSettingUpdatedAt[key])
})

test('consecutive syncs preserve settings for channels only subscribed on another device', async () => {
  const store = createStore([{ id: 'local', dailyVideoLimit: 2 }])
  const remoteOnly = { feedTypes: ['posts'], dailyVideoLimit: 7, showMembersOnly: true }
  const client = createClient([{
    key,
    value: { local: { feedTypes: ['videos', 'shorts', 'live', 'posts'], dailyVideoLimit: 2, showMembersOnly: false }, remote: remoteOnly },
    updatedAt: 1,
  }])
  const previous = await context.syncSettings(client, store)
  await context.syncSettings(client, store, previous)
  assert.deepEqual(client.entries.find(entry => entry.key === key).value.remote, remoteOnly)

  store.state.profiles.profileList[0].subscriptions[0].dailyVideoLimit = null
  store.state.settings.syncServerSettingUpdatedAt = { [key]: Date.now() }
  await context.syncSettings(client, store, previous)
  const synced = client.entries.find(entry => entry.key === key).value
  assert.equal(synced.local.dailyVideoLimit, null)
  assert.deepEqual(synced.remote, remoteOnly)
})

test('remote-only changes do not turn unchanged local settings into a newer local edit', async () => {
  const store = createStore([{ id: 'local', dailyVideoLimit: 2 }])
  const client = createClient([{
    key,
    value: { local: { feedTypes: ['videos', 'shorts', 'live', 'posts'], dailyVideoLimit: 2, showMembersOnly: false }, remote: { dailyVideoLimit: 7 } },
    updatedAt: 1,
  }])
  const previous = await context.syncSettings(client, store)
  const entry = client.entries.find(entry => entry.key === key)
  entry.value.local.dailyVideoLimit = 3
  entry.value.remote.dailyVideoLimit = 8
  entry.updatedAt = 2
  await context.syncSettings(client, store, previous)
  assert.equal(store.state.profiles.profileList[0].subscriptions[0].dailyVideoLimit, 3)
  const synced = client.entries.find(entry => entry.key === key)
  assert.equal(synced.value.local.dailyVideoLimit, 3)
  assert.equal(synced.value.remote.dailyVideoLimit, 8)
  assert.equal(synced.updatedAt, 2)
})
