import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { computed, effectScope, reactive, ref, watch } from 'vue'

// Execute the entire composable. Stub its platform/layout dependencies, while
// retaining Vue watchers, pointer events, and the real volume timeout behavior.
const source = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/opentubex/useScrollMiniPlayer.js', import.meta.url), 'utf8')
  .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
  .replace(/^export /gm, '')

function mountMiniPlayer(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const scope = effectScope()
  const window = new EventTarget()
  window.setTimeout = t.mock.fn(setTimeout)
  const isActiveTab = ref(true)
  const rect = { left: 10, top: 10, width: 360, height: 202 }
  const create = vm.runInNewContext(`${source}; useScrollMiniPlayer`, {
    computed, ref, watch, inject: () => null, watchNavigationKey: Symbol(),
    nextTick() {}, window, clearTimeout,
    document: { body: { classList: { remove() {} } } },
    store: { getters: reactive({ getAutoPictureInPictureTriggers: [] }) },
    DEFAULT_ASPECT_RATIO: 16 / 9,
    getDefaultScrollMiniPlayerRect: () => ({ ...rect }),
    getSavedScrollMiniPlayerRect: () => null,
    parseScrollMiniPlayerSavedRect: () => null,
    setSavedScrollMiniPlayerRect() {},
    getViewportInsets: () => ({ left: 0, right: 0, top: 0, bottom: 0 }),
    clampScrollMiniPlayerRect: value => ({ ...value }),
    pickScrollMiniVerticalAnchor: () => null,
    getScrollMiniVerticalAnchor: () => ({}),
    getResizeHandleCorner: () => 'bottom-right',
    markCrossTabMiniPlayerActive() {}, markCrossTabMiniPlayerInactive() {},
    unregisterCrossTabMiniPlayer() {}
  })
  const player = scope.run(() => create({
    container: ref(null), fullWindowEnabled: ref(false), getUi: () => null,
    isActiveTab, pictureInPictureActive: ref(false), props: reactive({ format: 'video', videoId: 'video' }),
    video: ref(null)
  }))
  player.scrollMiniPlayerActive.value = true
  t.after(() => { player.teardownScrollMiniPlayer(); scope.stop() })
  return { player, window, isActiveTab }
}

test('tab changes end held volume gestures and hide the expanded control', t => {
  const { player, window, isActiveTab } = mountMiniPlayer(t)
  player.handleScrollMiniVolumePointerDown({ clientX: 0, clientY: 0 })
  assert.equal(player.scrollMiniVolumeExpanded.value, true)
  isActiveTab.value = false
  t.mock.timers.tick(1000)
  assert.equal(player.scrollMiniVolumeExpanded.value, false)
  const scheduled = window.setTimeout.mock.callCount()
  window.dispatchEvent(new Event('pointerup'))
  window.dispatchEvent(new Event('pointercancel'))
  assert.equal(window.setTimeout.mock.callCount(), scheduled)
})
