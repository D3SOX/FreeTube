import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { computed, reactive } from 'vue'

const miniSource = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/opentubex/useScrollMiniPlayer.js', import.meta.url), 'utf8')
const pipSource = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/opentubex/useAutoPictureInPicture.js', import.meta.url), 'utf8')

test('keep-playing navigation takes precedence over the automatic tab PiP trigger', () => {
  const getters = reactive({ getKeepPlayingOnNavigation: true, getAutoPictureInPictureTriggers: ['tab'] })
  const mini = miniSource.slice(miniSource.indexOf('  const autoPictureInPictureOnTabChange ='), miniSource.indexOf('\n  )', miniSource.indexOf('  const autoPictureInPictureOnTabChange =')) + 4)
  const pip = pipSource.match(/  const triggerOnTabChange = computed\([^\n]+/)[0]
  const context = { computed, store: { getters }, watchNavigation: { detached: { value: false }, tabPresented: { value: false } }, autoPictureInPictureTriggers: computed(() => getters.getAutoPictureInPictureTriggers) }
  const miniTrigger = vm.runInNewContext(`${mini}; autoPictureInPictureOnTabChange`, context)
  const pipTrigger = vm.runInNewContext(`${pip}; triggerOnTabChange`, context)
  assert.equal(miniTrigger.value, false)
  assert.equal(pipTrigger.value, false)
  getters.getKeepPlayingOnNavigation = false
  assert.equal(miniTrigger.value, true)
  assert.equal(pipTrigger.value, true)
})

test('ending a volume pointer session removes its window callbacks', () => {
  const functions = ['handleScrollMiniVolumePointerDown', 'handleScrollMiniVolumePointerUpWindow', 'endScrollMiniPointerSession']
    .map(name => miniSource.match(new RegExp(`  function ${name}\\([^]*?\\n  }`))[0]).join('\n')
  const window = new EventTarget()
  let hides = 0
  const context = vm.createContext({
    window, document: { body: { classList: { remove() {} } } },
    scrollMiniPlayerActive: { value: true }, scrollMiniPlayerRect: { value: {} },
    showScrollMiniVolume() {}, syncNativeMiniPlayerGesture() {},
    scheduleScrollMiniVolumeHide: () => { hides++ },
    handleScrollMiniPointerMoveWindow() {}, handleScrollMiniPointerUpWindow() {}
  })
  vm.runInContext(`let scrollMiniPointerSession = null; ${functions};
    handleScrollMiniVolumePointerDown({ clientX: 0, clientY: 0 }); endScrollMiniPointerSession()`, context)
  window.dispatchEvent(new Event('pointerup'))
  window.dispatchEvent(new Event('pointercancel'))
  assert.equal(hides, 0)
})
