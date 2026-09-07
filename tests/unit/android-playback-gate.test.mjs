import assert from 'node:assert/strict'
import test from 'node:test'
import { createAndroidPlaybackGate } from '../../src/renderer/helpers/player/androidPlaybackGate.js'

test('preloaded tabs wait until presented before acquiring the native player', async () => {
  const gate = createAndroidPlaybackGate(false)
  const abort = new AbortController()
  let claimed = false
  const pending = gate.wait(abort.signal).then(() => { claimed = true })
  await Promise.resolve()
  assert.equal(claimed, false)
  gate.setActive(true)
  await pending
  assert.equal(claimed, true)
})

test('closing an inactive tab cancels its pending load permanently', async () => {
  const gate = createAndroidPlaybackGate(false)
  const abort = new AbortController()
  const pending = gate.wait(abort.signal)
  abort.abort(new Error('Tab closed'))
  await assert.rejects(pending, /Tab closed/)
  gate.setActive(true)
  await assert.rejects(gate.wait(abort.signal), /Tab closed/)
})
