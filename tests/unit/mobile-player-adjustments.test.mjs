import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createMobilePlayerAdjustments } from '../../src/renderer/helpers/mobilePlayerAdjustments.js'

function fixture(initial = { volume: 0.4, brightness: -1 }, overrides = {}) {
  const levels = { ...initial }
  const writes = []
  const changes = []
  const errors = []
  const controls = createMobilePlayerAdjustments({
    read: async action => levels[action],
    write: async (action, value) => { levels[action] = value; writes.push([action, value]) },
    onChange: (action, value) => changes.push([action, value]),
    onError: error => errors.push(error),
    ...overrides,
  })
  return { controls, levels, writes, changes, errors }
}

test('coalesces quick moves and applies the final level after release', async () => {
  const { controls, writes } = fixture()
  controls.begin('volume')
  controls.update(0.1)
  controls.update(0.3)
  controls.finish()
  await controls.settled()
  assert.equal(writes.length, 1)
  assert.equal(writes[0][0], 'volume')
  assert.ok(Math.abs(writes[0][1] - 0.7) < 1e-9)
})

test('reads hardware volume again on the next swipe and clamps to its bounds', async () => {
  const { controls, levels } = fixture()
  controls.begin('volume')
  controls.update(2)
  await controls.settled()
  assert.equal(levels.volume, 1)
  controls.finish()
  levels.volume = 0.2
  controls.begin('volume')
  controls.update(-0.5)
  await controls.settled()
  assert.equal(levels.volume, 0)
})

test('restores Android automatic brightness and never dims the screen to zero', async () => {
  const { controls, levels } = fixture()
  controls.begin('brightness')
  controls.update(-1)
  await controls.settled()
  assert.equal(levels.brightness, 0.01)
  controls.finish()
  await controls.reset()
  assert.equal(levels.brightness, -1)
})

test('preserves the original brightness across multiple swipes', async () => {
  const { controls, levels } = fixture({ brightness: 0.3 })
  controls.begin('brightness')
  controls.update(0.2)
  controls.finish()
  controls.begin('brightness')
  controls.update(0.1)
  controls.finish()
  await controls.settled()
  assert.equal(levels.brightness, 0.6)
  await controls.reset()
  assert.equal(levels.brightness, 0.3)
})

test('cancellation while reading prevents a late native write', async () => {
  let resolveRead
  const { controls, writes } = fixture(undefined, { read: () => new Promise(resolve => { resolveRead = resolve }) })
  controls.begin('volume')
  controls.update(0.2)
  await Promise.resolve()
  controls.cancel()
  resolveRead(0.4)
  await controls.settled()
  assert.deepEqual(writes, [])
})

test('leaving during a native write restores brightness after that write finishes', async () => {
  let finishWrite
  const writes = []
  const { controls, changes } = fixture(undefined, {
    write: async (action, value) => {
      if (value !== -1) await new Promise(resolve => { finishWrite = resolve })
      writes.push(value)
    },
  })
  controls.begin('brightness')
  controls.update(0.2)
  while (!finishWrite) await Promise.resolve()
  const reset = controls.reset()
  finishWrite()
  await reset
  assert.deepEqual(writes, [0.7, -1])
  assert.deepEqual(changes, [])
})

test('a failed read reports the error without writing a guessed volume', async () => {
  const failure = new Error('Unavailable')
  const { controls, writes, errors } = fixture(undefined, { read: async () => { throw failure } })
  controls.begin('volume')
  controls.update(0.1)
  await controls.settled()
  assert.deepEqual(writes, [])
  assert.deepEqual(errors, [failure])
})

test('fullscreen starts at full brightness, permits swipes, and restores the prior level on exit', async () => {
  const { controls, levels } = fixture({ brightness: 0.3 })
  await controls.setFullscreenBrightness(true)
  assert.equal(levels.brightness, 1)
  controls.begin('brightness')
  controls.update(-0.2)
  controls.finish()
  await controls.settled()
  assert.equal(levels.brightness, 0.8)
  await controls.setFullscreenBrightness(false)
  assert.equal(levels.brightness, 0.3)
})

test('fullscreen exit restores a prior swipe, leaving the player restores system brightness', async () => {
  const { controls, levels } = fixture()
  controls.begin('brightness')
  controls.update(0.1)
  controls.finish()
  await controls.settled()
  await controls.setFullscreenBrightness(true)
  await controls.setFullscreenBrightness(false)
  assert.equal(levels.brightness, 0.6)
  await controls.reset()
  assert.equal(levels.brightness, -1)
})

test('leaving fullscreen during its initial brightness read does not apply maximum brightness', async () => {
  let resolveRead
  const { controls, writes } = fixture(undefined, { read: () => new Promise(resolve => { resolveRead = resolve }) })
  controls.setFullscreenBrightness(true)
  await Promise.resolve()
  controls.setFullscreenBrightness(false)
  resolveRead(-1)
  await controls.settled()
  assert.deepEqual(writes, [])
})

test('reversing a swipe at maximum brightness responds immediately', async () => {
  const { controls, levels } = fixture({ brightness: 1 })
  controls.begin('brightness')
  controls.update(0.2)
  await controls.settled()
  assert.equal(levels.brightness, 1)
  controls.update(0.1)
  await controls.settled()
  assert.ok(Math.abs(levels.brightness - 0.9) < 1e-9)
})

test('reversing a swipe at minimum volume responds immediately', async () => {
  const { controls, levels } = fixture({ volume: 0 })
  controls.begin('volume')
  controls.update(-0.2)
  await controls.settled()
  assert.equal(levels.volume, 0)
  controls.update(-0.1)
  await controls.settled()
  assert.equal(levels.volume, 0.1)
})

test('a quick reversal at a limit is retained while the native read is pending', async () => {
  const { controls, levels, writes } = fixture({ volume: 1 })
  controls.begin('volume')
  controls.update(0.2)
  controls.update(0.1)
  controls.finish()
  await controls.settled()
  assert.ok(Math.abs(levels.volume - 0.9) < 1e-9)
  assert.equal(writes.length, 1)
})

function speedFixture(rate = 1, options = { maximum: 3, step: 0.25 }, overrides = {}) {
  return fixture({ speed: rate }, { getPlaybackRateOptions: () => options, ...overrides })
}

test('speed swipes accumulate small moves into configured steps without redundant writes', async () => {
  const { controls, levels, writes } = speedFixture()
  controls.begin('speed')
  for (const delta of [0.01, 0.02, 0.03, 0.04, 0.05]) {
    controls.update(delta)
    await controls.settled()
  }
  assert.deepEqual(writes, [])
  controls.update(0.07)
  await controls.settled()
  assert.equal(levels.speed, 1.25)
  controls.update(0.25)
  controls.finish()
  await controls.settled()
  assert.equal(levels.speed, 1.5)
  assert.equal(writes.length, 2)
  await controls.reset()
  assert.equal(levels.speed, 1.5)
})

test('speed swipes respect the configured maximum and respond to reversal at both limits', async () => {
  const { controls, levels } = speedFixture(2.5, { maximum: 4, step: 0.5 })
  controls.begin('speed')
  controls.update(2)
  await controls.settled()
  assert.equal(levels.speed, 4)
  controls.update(1.75)
  await controls.settled()
  assert.equal(levels.speed, 3.5)
  controls.update(-2)
  await controls.settled()
  assert.equal(levels.speed, 0.5)
  controls.update(-1.75)
  await controls.settled()
  assert.equal(levels.speed, 1)
})

test('speed with fine steps stays in the playable range and avoids floating point artifacts', async () => {
  const { controls, levels } = speedFixture(1, { maximum: 3, step: 0.05 })
  controls.begin('speed')
  controls.update(0.075)
  await controls.settled()
  assert.equal(levels.speed, 1.15)
  controls.update(-2)
  await controls.settled()
  assert.equal(levels.speed, 0.1)
})

test('coalesced speed swipes preserve reversal and read the latest rate on the next gesture', async () => {
  const { controls, levels, writes } = speedFixture(3)
  controls.begin('speed')
  controls.update(0.5)
  controls.update(0.25)
  controls.finish()
  await controls.settled()
  assert.deepEqual(writes, [['speed', 2.5]])
  levels.speed = 1
  controls.begin('speed')
  controls.update(-0.125)
  await controls.settled()
  assert.equal(levels.speed, 0.75)
})

test('cancelling a speed swipe during its read prevents late speed changes', async () => {
  let resolveRead
  const { controls, writes } = speedFixture(1, undefined, {
    read: () => new Promise(resolve => { resolveRead = resolve }),
  })
  controls.begin('speed')
  controls.update(0.5)
  await Promise.resolve()
  controls.cancel()
  resolveRead(1)
  await controls.settled()
  assert.deepEqual(writes, [])
})
