import assert from 'node:assert/strict'
import test from 'node:test'
import { createAndroidPlaybackController } from '../../src/renderer/helpers/player/androidPlaybackController.js'

function fixture() {
  const listeners = new Map()
  const calls = []
  let owner
  const plugin = {
    async addListener(name, callback) {
      listeners.set(name, callback)
      return { remove() { listeners.delete(name) } }
    },
    async setOwner(options) { owner = options.owner; calls.push(['owner', options]) },
    async release(options) { calls.push(['release', options]); if (owner === options.owner) owner = null },
    async configure(options) { calls.push(['configure', options]); assert.equal(owner, options.owner) },
    async loadSource(options) { calls.push(['load', options]) },
    async respond(options) { calls.push(['respond', options]) },
  }
  return { plugin, listeners, calls, owner: () => owner }
}

test('native controller ignores other owners and returns requested SABR bytes', async () => {
  const { plugin, listeners, calls } = fixture()
  const states = []
  const controller = await createAndroidPlaybackController(plugin, {
    owner: 'tab-1', continueInBackground: true, onState: state => states.push(state), onError: assert.fail,
  })
  await controller.load({ source: 'test', mimeType: 'application/dash+xml', read: async () => Uint8Array.of(1, 2, 3) }, {})
  listeners.get('state')({ owner: 'other', position: 20 })
  listeners.get('state')({ owner: 'tab-1', position: 4 })
  assert.equal(states.length, 1)
  assert.equal(controller.getState().position, 4)
  await listeners.get('segment')({ owner: 'tab-1', requestId: '1' })
  assert.deepEqual(calls.at(-1), ['respond', { requestId: '1', data: 'AQID' }])
  await controller.close()
  assert.equal(listeners.size, 0)
})

test('a late native range response cannot return bytes after closing its source', async () => {
  const { plugin, listeners, calls } = fixture()
  const bytes = Promise.withResolvers()
  let closed = false
  const controller = await createAndroidPlaybackController(plugin, {
    owner: 'tab-1', onState() {}, onError: assert.fail,
  })
  await controller.load({ source: 'test', read: () => bytes.promise, close: () => { closed = true } }, {})
  const pending = listeners.get('segment')({ owner: 'tab-1', requestId: '1' })
  await controller.close()
  bytes.resolve(Uint8Array.of(1))
  await pending
  assert.equal(closed, true)
  assert.equal(calls.at(-1)[1].data, undefined)
  assert.match(calls.at(-1)[1].error, /replaced/)
})

test('closing an old controller leaves the new owner intact', async () => {
  const { plugin, owner, calls } = fixture()
  const controller = await createAndroidPlaybackController(plugin, { owner: 'old', onState() {}, onError: assert.fail })
  await plugin.setOwner({ owner: 'new' })
  await controller.close()
  assert.equal(owner(), 'new')
  assert.deepEqual(calls.at(-1), ['release', { owner: 'old' }])
})

test('background preference changes configure the current owner without claiming playback again', async () => {
  const { plugin, calls } = fixture()
  const controller = await createAndroidPlaybackController(plugin, { owner: 'tab-1', onState() {}, onError: assert.fail })
  await controller.setContinueInBackground(false)
  assert.deepEqual(calls.at(-1), ['configure', { owner: 'tab-1', continueInBackground: false }])
  await controller.load({ source: 'test' }, {})
  await assert.rejects(controller.load({ source: 'other' }, {}), /new playback owner/)
  await controller.close()
})

test('a controller superseded while listeners register never claims native playback', async () => {
  const { plugin, calls } = fixture()
  const registration = Promise.withResolvers()
  const addListener = plugin.addListener
  let current = true
  plugin.addListener = async (...args) => { await registration.promise; return addListener(...args) }
  const pending = createAndroidPlaybackController(plugin, {
    owner: 'old', isCurrent: () => current, onState() {}, onError: assert.fail,
  })
  current = false
  registration.resolve()
  await assert.rejects(pending, /replaced/)
  assert.equal(calls.some(([type]) => type === 'owner'), false)
})

test('a revoked controller preserves the final clock and ignores teardown events', async () => {
  const { plugin, listeners, calls } = fixture()
  const states = []
  const controller = await createAndroidPlaybackController(plugin, {
    owner: 'old', onState: state => states.push(state), onError: assert.fail,
  })
  const onState = listeners.get('state')
  onState({ owner: 'old', event: 'suspended', position: 45, paused: true, playing: false })
  onState({ owner: 'old', event: 'timeupdate', position: 0 })
  assert.equal(controller.getState().position, 45)
  assert.equal(states.length, 1)
  await assert.rejects(controller.command('play'), /no longer owns/)
  assert.equal(calls.some(([type]) => type === 'command'), false)
  await controller.close()
})
