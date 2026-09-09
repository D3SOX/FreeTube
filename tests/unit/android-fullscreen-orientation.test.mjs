import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { attachAndroidMediaElement } from '../../src/renderer/helpers/player/androidMediaElement.js'
import { shouldRotateFullscreenToLandscape } from '../../src/renderer/helpers/capacitorUi.js'

const source = await readFile(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
const template = await readFile(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.vue', import.meta.url), 'utf8')

for (const [label, width, height, active, fullscreen, enabled, fromRotation, expected] of [
  ['late landscape dimensions', 1920, 1080, true, true, true, false, true],
  ['late portrait dimensions', 1080, 1920, true, true, true, false, false],
  ['inline playback', 1920, 1080, true, false, true, false, null],
  ['inactive tab', 1920, 1080, false, true, true, false, null],
  ['disabled rotation', 1920, 1080, true, true, false, false, false],
  ['sensor fullscreen', 1920, 1080, true, true, true, true, false],
]) {
  test(`fullscreen orientation follows ${label} after canplay`, () => {
    const rotations = []
    const element = Object.assign(new EventTarget(), {
      style: {}, volume: 1, muted: false, playbackRate: 1, pause() {},
    })
    const media = attachAndroidMediaElement(element, {
      command: async () => {}, load: async () => {}, onError: error => { throw error },
    })
    // Android may become ready before ExoPlayer reports its video size.
    media.update({ ready: true, width: 0, height: 0 })
    const handlerName = template.match(/@resize="(\w+)"/)?.[1]
    assert.ok(handlerName, 'Video dimension changes must recheck fullscreen orientation')
    const start = source.indexOf(`    function ${handlerName}(`)
    const body = source.slice(start, source.indexOf('\n    }', start) + 6)
    const handler = vm.runInNewContext(`${body}\n${handlerName}`, {
      video: { value: element }, isActiveTab: { value: active },
      isNativeFullscreenActive: () => fullscreen,
      rotateFullscreenToLandscape: { value: enabled },
      player: { nativePlayback: { isFullscreenFromRotation: () => fromRotation } },
      setFullscreenOrientation: async (...args) => rotations.push(shouldRotateFullscreenToLandscape(...args)),
      updateAnnotationVideoAspectRatio() {}, updateScrollMiniVideoAspectRatio() {}, updateScrollMiniPlayer() {},
    })
    element.addEventListener('resize', handler)
    media.update({ width, height })
    assert.deepEqual(rotations, expected === null ? [] : [expected])
    media.detach()
  })
}
