import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import { attachAndroidMediaElement } from '../../src/renderer/helpers/player/androidMediaElement.js'

const source = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
const panel = source.match(/const controlPanelElements = \[([\s\S]*?)\n      \]/)[0]

for (const mobile of [true, false]) {
  test(`${mobile ? 'Android' : 'desktop'} creates the toolbar play control needed for end-screen replay`, () => {
    const elements = vm.runInNewContext(`${panel}\ncontrolPanelElements`, {
      isCapacitorMobilePlayer: () => mobile,
      onlyUseOverFlowMenu: { value: false },
      props: { shortsPlayer: false, chapters: [] }
    })
    assert.ok(elements.includes('play_pause'), 'Recommendations occupy the center, so replay needs a toolbar button')
    assert.ok(elements.indexOf('play_pause') < elements.indexOf('time_and_duration'))
  })
}

test('one shared replay tap seeks native playback to the beginning and plays', () => {
  const shakaControls = readFileSync(new URL('../../node_modules/shaka-player/ui/controls.js', import.meta.url), 'utf8')
  const replay = shakaControls.match(/  playPausePresentation\(\) \{[\s\S]*?\n  \}/)[0]
  const paused = shakaControls.match(/  presentationIsPaused\(\) \{[\s\S]*?\n  \}/)[0]
  const controls = vm.runInNewContext(`({ ${replay}, ${paused} })`)
  const commands = []
  const element = Object.assign(new EventTarget(), {
    style: {}, volume: 1, muted: false, playbackRate: 1, pause() {}
  })
  const media = attachAndroidMediaElement(element, {
    command: async (...args) => { commands.push(args) }, load: async () => {}, onError: assert.fail
  })
  Object.assign(controls, {
    enabled_: true, video_: element, isSeeking: () => element.seeking,
    player_: { isEnded: () => element.ended, seekRange: () => ({ start: 0, end: 20 }) }
  })
  media.update({ duration: 20, position: 19, ready: true, paused: false, playing: true })
  media.update({ position: 20, ended: true, paused: false, playing: false })
  controls.playPausePresentation()
  assert.deepEqual(commands, [['seek', 0], ['play']])
  media.update({ position: 0, ended: false, paused: false, playing: true, event: 'seeked' })
  assert.equal(element.ended, false)
  assert.equal(element.paused, false)
  media.detach()
})
