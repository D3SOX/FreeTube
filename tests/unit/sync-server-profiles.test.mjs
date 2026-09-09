import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import { MAIN_PROFILE_ID } from '../../src/constants.js'
import { SyncServerDataLossError } from '../../src/renderer/helpers/sync-server-errors.js'
import * as profileSync from '../../src/renderer/helpers/profile-sync.js'

// Run the real sync code, replacing webpack imports with its profile dependencies.
const source = await readFile(new URL('../../src/renderer/helpers/sync-server.js', import.meta.url), 'utf8')
const context = vm.createContext({ MAIN_PROFILE_ID, SyncServerDataLossError, ...profileSync })
vm.runInContext(source
  .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
  .replace(/^export \{[\s\S]*?\}\n/gm, '')
  .replace(/^export (?=(async )?(function|class|const))/gm, '') + '\nglobalThis.syncProfiles = syncProfiles', context)

for (const colors of [
  { bg_color: '#123456', text_color: '#abcdef' },
  { bg_color: null, text_color: null },
  {},
]) {
  test(`first sync imports a remote profile with colors ${JSON.stringify(colors)}`, async () => {
    const channel = { id: 'channel-1', name: 'Subscribed channel' }
    const profileList = [{ _id: MAIN_PROFILE_ID, subscriptions: [channel] }]
    const group = { id: 'remote-profile', local_id: 'profile-1', title: 'Music', ...colors }
    const client = {
      getSubscriptionGroups: async () => [{ group, channels: [{ id: channel.id }] }],
    }
    const store = {
      state: { profiles: { profileList } },
      dispatch: async (action, profile) => {
        assert.equal(action, 'updateProfile')
        profileList.push(structuredClone(profile))
      },
    }

    const snapshot = await context.syncProfiles(client, store)

    assert.deepEqual(profileList[1], {
      _id: 'profile-1',
      name: 'Music',
      bgColor: colors.bg_color ?? '#000000',
      textColor: colors.text_color ?? '#FFFFFF',
      subscriptions: [channel],
    })
    assert.deepEqual(structuredClone(snapshot), {
      'profile-1': {
        remoteId: 'remote-profile',
        metadata: {
          title: 'Music',
          bgColor: colors.bg_color ?? '#000000',
          textColor: colors.text_color ?? '#FFFFFF',
        },
        channels: [channel.id],
      },
    })

    // A later sync uploads edits made on the second device to the same server group.
    profileList[1].name = 'Renamed on second device'
    const uploads = []
    client.updateSubscriptionGroup = async (id, payload) => uploads.push([id, structuredClone(payload)])
    await context.syncProfiles(client, store, snapshot)
    assert.deepEqual(uploads, [['remote-profile', {
      id: 'profile-1',
      local_id: 'profile-1',
      title: 'Renamed on second device',
      bg_color: colors.bg_color ?? '#000000',
      text_color: colors.text_color ?? '#FFFFFF',
    }]])
  })
}


for (const deletedFrom of ['server', 'device']) {
  test(`destructive profile sync identifies the profile deleted from the ${deletedFrom}`, async () => {
    const profile = { _id: 'profile-1', name: 'Music', subscriptions: [] }
    const store = {
      state: { profiles: { profileList: [
        { _id: MAIN_PROFILE_ID, subscriptions: [] },
        ...(deletedFrom === 'server' ? [profile] : []),
      ] } },
      dispatch: async () => assert.fail('Must not change local data before confirmation'),
    }
    const client = {
      getSubscriptionGroups: async () => deletedFrom === 'server' ? [] : [{
        group: { id: 'remote-1', local_id: profile._id, title: profile.name }, channels: [],
      }],
    }
    await assert.rejects(context.syncProfiles(client, store, {
      'profile-1': { remoteId: 'remote-1', metadata: { title: 'Old name' }, channels: [] },
    }), error => {
      assert.ok(error instanceof SyncServerDataLossError)
      assert.equal(error.deleted, 1)
      assert.deepEqual(structuredClone(error.items), [{ id: 'profile-1', name: 'Music' }])
      return true
    })
  })
}
