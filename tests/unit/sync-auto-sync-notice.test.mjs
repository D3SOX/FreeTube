import assert from 'node:assert/strict'
import test from 'node:test'
import { dismissAutoSyncNotice, shouldShowAutoSyncNotice } from '../../src/renderer/helpers/sync-auto-sync-notice.js'

const settings = {
  syncServerEnabled: true,
  syncServerToken: 'test-token',
  syncServerAutoSync: false,
}
function createStorage() {
  const values = new Map()
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
}

test('an existing client keeps the notice across launches until dismissed', () => {
  const storage = createStorage()
  assert.equal(shouldShowAutoSyncNotice('0.34.0', settings, storage), true)
  assert.equal(shouldShowAutoSyncNotice('0.34.0', settings, storage), true)
  dismissAutoSyncNotice(storage)
  assert.equal(shouldShowAutoSyncNotice('0.35.0', settings, storage), false)
})

for (const [name, previousVersion, overrides] of [
  ['fresh installation', null, {}],
  ['enabled automatic sync', '0.34.0', { syncServerAutoSync: true }],
  ['disabled sync', '0.34.0', { syncServerEnabled: false }],
  ['disconnected account', '0.34.0', { syncServerToken: '' }],
  ['known safety pause', '0.34.0', { syncServerResumeAutoSync: true }],
]) {
  test(`${name} is excluded, including on subsequent launches`, () => {
    const storage = createStorage()
    assert.equal(shouldShowAutoSyncNotice(previousVersion, { ...settings, ...overrides }, storage), false)
    assert.equal(shouldShowAutoSyncNotice('0.35.0', settings, storage), false)
  })
}

test('enabling automatic sync retires an undismissed notice', () => {
  const storage = createStorage()
  assert.equal(shouldShowAutoSyncNotice('0.34.0', settings, storage), true)
  assert.equal(shouldShowAutoSyncNotice('0.34.0', { ...settings, syncServerAutoSync: true }, storage), false)
  assert.equal(shouldShowAutoSyncNotice('0.34.0', settings, storage), false)
})
