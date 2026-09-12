import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../src/renderer/components/FtToast/FtToast.vue', import.meta.url), 'utf8')
const handler = source.match(/function updateFullscreenTarget\(\) \{[\s\S]*?\n\}/)[0]

for (const mode of ['android', 'browser']) {
  test(`toasts follow ${mode} fullscreen entry and exit`, () => {
    const player = { id: 'player' }
    const fullscreenTarget = { value: null }
    let nativePlayer = null
    const document = {
      fullscreenElement: null,
      querySelector(selector) {
        assert.equal(selector, '[data-native-player-screen]')
        return nativePlayer
      }
    }
    const update = vm.runInNewContext(`${handler}; updateFullscreenTarget`, { document, fullscreenTarget })
    update()
    assert.equal(fullscreenTarget.value, null)

    if (mode === 'android') nativePlayer = player
    else document.fullscreenElement = player
    update()
    assert.equal(fullscreenTarget.value, player, 'Toasts must move inside the visible fullscreen player')

    nativePlayer = null
    document.fullscreenElement = null
    update()
    assert.equal(fullscreenTarget.value, null, 'Toasts must return to their normal location on exit')
  })
}
