import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { effectScope, nextTick, reactive, ref, watch } from 'vue'
import { createPlaybackScreenWake, playbackScreenWake } from '../../src/renderer/helpers/playbackScreenWake.js'
import { attachAndroidMediaElement } from '../../src/renderer/helpers/player/androidMediaElement.js'

function fixture(plugin) {
  const calls = []
  const wake = createPlaybackScreenWake(plugin ?? {
    async keepAwake() { calls.push('awake') },
    async allowSleep() { calls.push('sleep') },
  })
  const element = Object.assign(new EventTarget(), {
    style: {}, volume: 1, muted: false, playbackRate: 1, defaultPlaybackRate: 1, loop: false, pause() {},
  })
  const media = attachAndroidMediaElement(element, {
    command: async () => {}, load: async () => {}, onError: assert.fail,
  })
  let presentedVideo = true
  const binding = wake.bindVideo(element, () => presentedVideo)
  const playing = { paused: false, playing: true, ready: true, ended: false, position: 0, duration: 100 }
  return { wake, calls, element, media, binding, playing, present(value) { presentedVideo = value; binding.update() } }
}

test('native foreground video prevents sleep, pauses release it, and resumed playback reacquires it', async () => {
  const f = fixture()
  f.wake.setAppActive(true)
  f.media.update(f.playing)
  await setImmediate()
  assert.equal(f.calls.at(-1), 'awake')
  f.element.pause()
  await setImmediate()
  assert.equal(f.calls.at(-1), 'sleep')
  await f.element.play()
  f.media.update(f.playing)
  await setImmediate()
  assert.equal(f.calls.at(-1), 'awake')
  f.media.update({ ...f.playing, ended: true, playing: false })
  await setImmediate()
  assert.equal(f.calls.at(-1), 'sleep')
})

test('background audio keeps playing without keeping the screen awake, then return reacquires it', async () => {
  const f = fixture()
  f.wake.setAppActive(true)
  f.media.update(f.playing)
  await setImmediate()
  f.wake.setAppActive(false)
  await setImmediate()
  assert.equal(f.calls.at(-1), 'sleep')
  assert.equal(f.element.paused, false)
  f.media.update({ ...f.playing, position: 10 })
  await setImmediate()
  assert.equal(f.calls.at(-1), 'sleep')
  f.wake.setAppActive(true)
  await setImmediate()
  assert.equal(f.calls.at(-1), 'awake')
})

test('audio-only and hidden tabs do not retain screen wake; dismissing video releases it', async () => {
  const f = fixture()
  f.wake.setAppActive(true)
  f.media.update(f.playing)
  await setImmediate()
  f.present(false)
  await setImmediate()
  assert.equal(f.calls.at(-1), 'sleep')
  f.present(true)
  await setImmediate()
  assert.equal(f.calls.at(-1), 'awake')
  f.binding.destroy()
  await setImmediate()
  assert.equal(f.calls.at(-1), 'sleep')
  f.binding.update()
  f.media.update(f.playing)
  await setImmediate()
  assert.equal(f.calls.at(-1), 'sleep')
})

test('removing an old player cannot release another playing video', async () => {
  const f = fixture()
  f.wake.setAppActive(true)
  f.media.update(f.playing)
  const other = Object.assign(new EventTarget(), { paused: false, ended: false })
  const binding = f.wake.bindVideo(other, () => true)
  await setImmediate()
  f.binding.destroy()
  await setImmediate()
  assert.equal(f.calls.at(-1), 'awake')
  binding.destroy()
  await setImmediate()
  assert.equal(f.calls.at(-1), 'sleep')
})

test('backgrounding during an in-flight acquire always leaves sleep allowed', async () => {
  const calls = []
  let resolveAcquire
  const f = fixture({
    keepAwake: () => new Promise(resolve => { calls.push('awake'); resolveAcquire = resolve }),
    async allowSleep() { calls.push('sleep') },
  })
  f.wake.setAppActive(true)
  f.media.update(f.playing)
  await setImmediate()
  assert.equal(calls.at(-1), 'awake')
  f.wake.setAppActive(false)
  f.binding.destroy()
  resolveAcquire()
  await setImmediate()
  assert.equal(calls.at(-1), 'sleep')
})

test('Electron does not instantiate the mobile screen wake controller', () => {
  assert.equal(playbackScreenWake, null)
})

test('ordinary mobile media events release on failure and source removal', async () => {
  const calls = []
  const wake = createPlaybackScreenWake({
    async keepAwake() { calls.push('awake') },
    async allowSleep() { calls.push('sleep') },
  })
  const element = Object.assign(new EventTarget(), { paused: true, ended: false })
  const binding = wake.bindVideo(element, () => true)
  wake.setAppActive(true)
  element.paused = false
  element.dispatchEvent(new Event('playing'))
  await setImmediate()
  assert.equal(calls.at(-1), 'awake')
  for (const event of ['error', 'emptied']) {
    element.dispatchEvent(new Event(event))
    binding.update()
    await setImmediate()
    assert.equal(calls.at(-1), 'sleep')
    element.dispatchEvent(new Event('playing'))
    await setImmediate()
    assert.equal(calls.at(-1), 'awake')
  }
  binding.destroy()
})

test('returning to paused video or playing before foreground state arrives never acquires screen wake', async () => {
  const f = fixture()
  f.media.update(f.playing)
  await setImmediate()
  assert.equal(f.calls.at(-1), 'sleep')
  f.element.pause()
  f.wake.setAppActive(true)
  await setImmediate()
  assert.equal(f.calls.at(-1), 'sleep')
  assert.equal(f.calls.includes('awake'), false)
})

test('the shared player updates screen wake when its mini-player is dismissed or music becomes audio-only', async () => {
  const source = await readFile(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
  const bind = source.match(/screenWakeBinding = playbackScreenWake\?\.bindVideo\(videoElement, \(\) =>\n[\s\S]*?\n      \)/)[0]
  const update = source.indexOf('screenWakeBinding?.update()')
  const observer = source.slice(source.lastIndexOf('watch(', update), source.indexOf('\n    })', update) + 7)
  const f = fixture()
  f.binding.destroy()
  f.wake.setAppActive(true)
  const refs = {
    isActiveTab: ref(false), isCrossTabMiniPlayerPresented: ref(true),
    scrollMiniPlayerDismissed: ref(false), audioPlayerMode: ref(false),
  }
  const scope = effectScope()
  const context = vm.createContext({
    ...refs, props: reactive({ format: 'dash' }), screenWakeBinding: null,
    playbackScreenWake: f.wake, videoElement: f.element, watch,
  })
  scope.run(() => vm.runInContext(`${bind}\n${observer}`, context))
  try {
    f.media.update(f.playing)
    await setImmediate()
    assert.equal(f.calls.at(-1), 'awake')
    refs.scrollMiniPlayerDismissed.value = true
    await nextTick()
    await setImmediate()
    assert.equal(f.calls.at(-1), 'sleep', 'dismissal hides the video without pausing audio')
    refs.scrollMiniPlayerDismissed.value = false
    refs.isActiveTab.value = true
    await nextTick()
    await setImmediate()
    assert.equal(f.calls.at(-1), 'awake')
    refs.audioPlayerMode.value = true
    await nextTick()
    await setImmediate()
    assert.equal(f.calls.at(-1), 'sleep', 'music artwork is not active video even with DASH format')
  } finally {
    scope.stop()
    context.screenWakeBinding.destroy()
  }
})
