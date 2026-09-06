import assert from 'node:assert/strict'
import test from 'node:test'

class FakeElement {
  constructor ({ animations = [], feed = false, managed = false, timeout = false } = {}) {
    this.animations = animations
    this.feed = feed
    this.managed = managed
    this.timeout = timeout
  }

  matches () {
    return this.feed
  }

  closest () {
    return this.managed || this.timeout ? this : null
  }

  getAnimations () {
    return this.animations
  }
}

globalThis.Element = FakeElement

const activeAnimations = []
const listeners = new Map()
globalThis.document = {
  addEventListener (type, listener) {
    listeners.set(type, listener)
  },
  getAnimations () {
    return activeAnimations
  }
}

const {
  getAnimationSpeedMultiplier,
  setAnimationSpeed
} = await import('../../src/renderer/helpers/animationSpeed.js')

test('clamps animation speed to the supported range', () => {
  assert.equal(getAnimationSpeedMultiplier(10), 0.25)
  assert.equal(getAnimationSpeedMultiplier(25), 0.25)
  assert.equal(getAnimationSpeedMultiplier(100), 1)
  assert.equal(getAnimationSpeedMultiplier(200), 2)
  assert.equal(getAnimationSpeedMultiplier(300), 2)
  assert.equal(getAnimationSpeedMultiplier(0), 1)
  assert.equal(getAnimationSpeedMultiplier(Number.NaN), 1)
})

test('does not rescale animations with speed-managed timing', () => {
  const playbackRates = []
  const animation = target => ({
    effect: { target },
    updatePlaybackRate (rate) {
      playbackRates.push(rate)
    }
  })

  activeAnimations.push(
    animation(new FakeElement()),
    animation(new FakeElement({ feed: true })),
    animation(new FakeElement({ managed: true })),
    animation(new FakeElement({ timeout: true }))
  )

  setAnimationSpeed(300)

  assert.deepEqual(playbackRates, [2])
  activeAnimations.length = 0
})

test('applies speed to newly started unmanaged animations', async () => {
  const playbackRates = []
  const animation = {
    updatePlaybackRate (rate) {
      playbackRates.push(rate)
    }
  }
  const unmanagedTarget = new FakeElement({ animations: [animation] })
  const managedTarget = new FakeElement({ animations: [animation], managed: true })

  setAnimationSpeed(200)
  listeners.get('animationstart')({ target: unmanagedTarget })
  listeners.get('animationstart')({ target: managedTarget })
  listeners.get('transitionrun')({ target: unmanagedTarget })
  listeners.get('transitionrun')({ target: managedTarget })
  await Promise.resolve()

  assert.deepEqual(playbackRates, [2, 2])
})

test('lets CSS run at its default speed without querying animations for each event', async () => {
  let queries = 0
  const target = new FakeElement()
  target.getAnimations = () => { queries++; return [] }
  setAnimationSpeed(100)
  for (let index = 0; index < 100; index++) {
    listeners.get('animationstart')({ target })
    listeners.get('transitionrun')({ target })
  }
  await Promise.resolve()
  assert.equal(queries, 0)
})

test('restores existing animations when returning to default speed', () => {
  const playbackRates = []
  activeAnimations.push({
    effect: { target: new FakeElement() },
    updatePlaybackRate: rate => playbackRates.push(rate),
  })
  setAnimationSpeed(200)
  setAnimationSpeed(100)
  assert.deepEqual(playbackRates, [2, 1])
  activeAnimations.length = 0
})
