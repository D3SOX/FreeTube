import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import { resolveMappedIcon } from '../../src/renderer/icons/iconMappingResolver.js'

const source = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
const readIconJson = name => JSON.parse(readFileSync(new URL(`../../src/renderer/icons/${name}.json`, import.meta.url), 'utf8'))
const aliases = readIconJson('faAliasToCanon')
const mapping = readIconJson('faIconMap')

function fixture() {
  const state = {
    valueChangeMessage: { value: '' },
    valueChangeIcons: { value: [] },
    showValueChangePopup: { value: false },
    invertValueChangeContentOrder: { value: false },
    valueChangeTimeout: null,
    maxVideoPlaybackRate: { value: 4 },
    playbackRateUserSet: false,
    player: { cancelTrickPlay() {}, trickPlay() {} },
    getDefaultPlaybackRateForVideo: () => 1,
    showOverlayControls() {},
    setTimeout() {},
    clearTimeout() {},
  }
  const names = ['applyPlaybackRate', 'handleControlsContainerClick', 'showValueChange']
  const functions = names.map(name => {
    const match = source.match(new RegExp(`    function ${name}\\([^]*?\\n    }`))
    assert.ok(match, `missing ${name}`)
    return match[0]
  }).join('\n')
  const api = vm.runInNewContext(`${functions}\n({ ${names.join(', ')} })`, state)
  return { state, api }
}

function assertSpeedOsd(state, message) {
  assert.equal(state.showValueChangePopup.value, true)
  assert.equal(state.valueChangeMessage.value, message)
  assert.equal(state.valueChangeIcons.value.length, 1, 'playback speed OSD must show an icon')
  for (const pack of ['material', 'remix']) {
    const icon = resolveMappedIcon(['fas', state.valueChangeIcons.value[0]], pack, aliases, mapping)
    assert.ok(icon, `speed icon must resolve in ${pack}`)
    assert.ok(readIconJson(`iconifyBundles/${pack}`)[icon], `speed icon must be bundled in ${pack}`)
  }
}

test('playback speed changes show an icon alongside the multiplier', () => {
  const { state, api } = fixture()
  for (const rate of [1.5, 0.75, 1]) {
    api.applyPlaybackRate(rate)
    assertSpeedOsd(state, `${rate.toFixed(2)}x`)
  }
})

test('Ctrl/Meta-click speed reset shows an icon alongside the default multiplier', () => {
  for (const modifier of ['ctrlKey', 'metaKey']) {
    const { state, api } = fixture()
    api.handleControlsContainerClick({ [modifier]: true, stopPropagation() {} })
    assertSpeedOsd(state, '1x')
  }
})
