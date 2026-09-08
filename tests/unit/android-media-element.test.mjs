import assert from 'node:assert/strict'
import test from 'node:test'
import { attachAndroidMediaElement } from '../../src/renderer/helpers/player/androidMediaElement.js'

function fixture() {
  const commands = []
  const element = Object.assign(new EventTarget(), { style: {}, volume: 0.7, muted: false, playbackRate: 1, defaultPlaybackRate: 1, loop: false, pause() {} })
  let time = 0
  const media = attachAndroidMediaElement(element, {
    command: async (...args) => { commands.push(args) }, load: async () => {}, onError: assert.fail, now: () => time,
  })
  const ready = { position: 10, duration: 100, paused: false, playing: true, ready: true, buffering: false,
    ended: false, playbackRate: 1, bufferedPosition: 40, width: 640, height: 360 }
  return { commands, element, media, ready, advance: ms => { time += ms } }
}

test('shared player features observe the native clock and stop extrapolating while paused', () => {
  const { element, media, ready, advance } = fixture()
  media.update(ready)
  advance(1500)
  assert.equal(element.currentTime, 11.5)
  media.update({ ...ready, position: 11.5, playing: false, paused: true })
  advance(1000)
  assert.equal(element.currentTime, 11.5)
  assert.equal(element.buffered.end(0), 40)
  assert.throws(() => element.buffered.end(1), { name: 'IndexSizeError' })
})

test('SponsorBlock and repeat seeks reach native playback and emit seek completion', () => {
  const { element, media, ready, commands } = fixture()
  const events = []
  element.addEventListener('seeking', () => events.push('seeking'))
  element.addEventListener('seeked', () => events.push('seeked'))
  media.update(ready)
  element.currentTime = 35
  assert.deepEqual(commands.at(-1), ['seek', 35])
  assert.equal(element.seeking, true)
  media.update({ ...ready, position: 35, event: 'seeked' })
  assert.equal(element.seeking, false)
  assert.deepEqual(events, ['seeking', 'seeked'])
})

test('temporary mute preserves the user volume when native audio is restored', () => {
  const { element, commands, media, ready } = fixture()
  element.muted = true
  media.update({ ...ready, volume: 0 })
  assert.equal(element.volume, 0.7)
  element.muted = false
  assert.deepEqual(commands.slice(-2), [['volume', 0], ['volume', 0.7]])
})

test('voice-over gain scales native output without changing the user volume', async () => {
  const { element, media, commands } = fixture()
  await media.setOutputGain(0.25)
  assert.equal(element.volume, 0.7)
  assert.deepEqual(commands.at(-1), ['volume', 0.175])
  element.muted = true
  assert.deepEqual(commands.at(-1), ['volume', 0])
  element.muted = false
  assert.deepEqual(commands.at(-1), ['volume', 0.175])
  await media.setOutputGain(1)
  assert.deepEqual(commands.at(-1), ['volume', 0.7])
})

test('native metadata and playback events are emitted once per transition', () => {
  const { element, media, ready } = fixture()
  const events = []
  for (const name of ['loadedmetadata', 'playing', 'play', 'pause', 'ended']) {
    element.addEventListener(name, () => events.push(name))
  }
  media.update(ready)
  media.update({ ...ready, position: 11 })
  media.update({ ...ready, position: 100, playing: false, ended: true })
  assert.deepEqual(events, ['loadedmetadata', 'play', 'playing', 'ended'])
  media.detach()
  assert.equal(element.volume, 0.7)
  assert.equal(Object.hasOwn(element, 'currentTime'), false)
})

test('queued native position events cannot undo a user seek before acknowledgement', () => {
  const { element, media, ready } = fixture()
  media.update(ready)
  element.currentTime = 35
  media.update({ ...ready, position: 10.1, event: 'timeupdate' })
  assert.equal(element.currentTime, 35)
  media.update({ ...ready, position: 35.02, event: 'seeked' })
  assert.equal(element.currentTime, 35.02)
})

test('pause updates shared controls and freezes the clock before the native reply', () => {
  const { element, media, ready, advance } = fixture()
  media.update(ready)
  advance(500)
  element.pause()
  assert.equal(element.paused, true)
  advance(500)
  assert.equal(element.currentTime, 10.5)
})

test('a rejected seek clears seeking and restores the last native clock', async () => {
  const error = new Error('Ownership changed')
  const errors = []
  const element = Object.assign(new EventTarget(), { style: {}, volume: 1, muted: false, playbackRate: 1, pause() {} })
  const media = attachAndroidMediaElement(element, {
    command: async () => { throw error }, load: async () => {}, onError: value => errors.push(value), now: () => 0,
  })
  media.update({ position: 10, duration: 100, ready: true })
  element.currentTime = 35
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(element.seeking, false)
  assert.equal(element.currentTime, 10)
  assert.deepEqual(errors, [error])
})

test('removing an auxiliary audio source releases it instead of loading the old URL again', () => {
  const loads = []
  const element = Object.assign(new EventTarget(), { style: {}, volume: 1, muted: false, playbackRate: 1, pause() {} })
  attachAndroidMediaElement(element, {
    command: async () => {}, load: async source => { loads.push(source) }, onError: assert.fail,
  })
  element.src = 'https://example.com/speech.mp3'
  element.removeAttribute('src')
  element.load()
  assert.equal(element.currentSrc, '')
  assert.deepEqual(loads, ['https://example.com/speech.mp3', ''])
})

test('queued native playback snapshots cannot undo a pending pause', () => {
  const { element, media, ready, advance } = fixture()
  media.update(ready)
  const events = []
  for (const type of ['play', 'pause', 'playing']) element.addEventListener(type, () => events.push(type))
  element.pause()
  media.update({ ...ready, position: 10.1, event: 'timeupdate' })
  assert.equal(element.paused, true)
  advance(100)
  assert.equal(element.currentTime, 10)
  media.update({ ...ready, position: 10.2, paused: true, playing: false })
  assert.deepEqual(events, ['pause'])
  media.update({ ...ready, position: 10.2 })
  assert.equal(element.paused, false)
  assert.deepEqual(events, ['pause', 'play', 'playing'])
})

test('an explicit play supersedes a pending pause', async () => {
  const { element, media, ready } = fixture()
  media.update(ready)
  element.pause()
  await element.play()
  media.update({ ...ready, position: 11 })
  assert.equal(element.paused, false)
  assert.equal(element.currentTime, 11)
})

test('a rejected pause allows native playback state to recover', async () => {
  const error = new Error('Ownership changed')
  const errors = []
  const element = Object.assign(new EventTarget(), { style: {}, volume: 1, muted: false, playbackRate: 1, pause() {} })
  const media = attachAndroidMediaElement(element, {
    command: async () => { throw error }, load: async () => {}, onError: value => errors.push(value), now: () => 0,
  })
  media.update({ position: 10, duration: 100, paused: false, playing: true, ready: true })
  element.pause()
  await new Promise(resolve => setImmediate(resolve))
  media.update({ position: 11, paused: false, playing: true })
  assert.equal(element.paused, false)
  assert.equal(element.currentTime, 11)
  assert.deepEqual(errors, [error])
})


test('native dimensions keep layout independent of posters and empty DOM video sizing', () => {
  const { element, media, ready } = fixture()
  assert.equal(element.style.aspectRatio, '16 / 9')
  media.update({ ...ready, width: 1440, height: 1080 })
  assert.equal(element.style.aspectRatio, '1440 / 1080')
  media.update({ width: 0, height: 0, ready: false })
  assert.equal(element.style.aspectRatio, '1440 / 1080')
  media.reset()
  assert.equal(element.style.aspectRatio, '1440 / 1080')
  media.update({ ...ready, width: 1080, height: 1920 })
  assert.equal(element.style.aspectRatio, '1080 / 1920')
  media.detach()
  assert.equal(element.style.aspectRatio, '1080 / 1920')
})
