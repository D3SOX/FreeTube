import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { attachAndroidMediaElement } from '../../src/renderer/helpers/player/androidMediaElement.js'

const source = await readFile(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
const start = source.indexOf('    function syncMediaSessionPosition()')
const body = source.slice(start, source.indexOf('\n    }', start) + 6)

test('the final native timeupdate cannot restore media controls after ended', () => {
  const states = []
  const element = Object.assign(new EventTarget(), {
    style: {}, volume: 1, muted: false, playbackRate: 1, pause() {},
  })
  const media = attachAndroidMediaElement(element, {
    command: async () => {}, load: async () => {}, onError: error => { throw error },
  })
  const sync = vm.runInNewContext(`${body}\nsyncMediaSessionPosition`, {
    video: { value: element }, mediaSessionStopped: false, mediaTabId: 'test',
    tabMediaCoordinator: { setPositionState: (tab, position, state) => states.push(state) },
  })
  element.addEventListener('timeupdate', sync)
  element.addEventListener('ended', () => states.push('none'))
  media.update({ duration: 20, position: 19, ready: true, playing: true, paused: false })
  states.length = 0
  media.update({ position: 20, playing: false, paused: false, ended: true })
  assert.deepEqual(states, ['none', 'none'], 'ExoPlayer retains playWhenReady after the video ends')
  media.update({ paused: true })
  assert.equal(states.at(-1), 'none', 'The ensuing native pause must not restore the notification')
  media.update({ position: 0, paused: false, playing: true, ended: false })
  assert.equal(states.at(-1), 'playing', 'Replay must restore media controls')
  media.detach()
})
