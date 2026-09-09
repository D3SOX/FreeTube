import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import * as Vue from 'vue'

const source = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.vue', import.meta.url), 'utf8')
const poster = source.match(/<div\s+v-if="[^"]+"\s+class="countdownPoster"[\s\S]*?<\/div>/)[0]
const render = Vue.compile(poster)
const script = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')

test('native startup shows the poster outside the SABR countdown until a frame is rendered', () => {
  const context = { showCountdownOverlay: false, audioPlayerMode: false, thumbnail: 'poster.jpg', useNativePlayback: true, showPoster: true }
  assert.equal(render(context).type, 'div')
  context.showPoster = false
  assert.equal(render(context).type, Vue.Comment)
  context.showPoster = true
  context.audioPlayerMode = true
  assert.equal(render(context).type, Vue.Comment)
  context.audioPlayerMode = false
  context.useNativePlayback = false
  assert.equal(render(context).type, Vue.Comment)
  context.showCountdownOverlay = true
  assert.equal(render(context).type, 'div')
})

test('native playing notification cannot dismiss the poster before the first frame', () => {
  const body = script.match(/function handlePlaying\(\) \{([\s\S]*?)\n    function handleWaiting/)[1]
  const context = { hasPlaybackPosition: { value: false }, showPoster: { value: true }, useNativePlayback: true, startPaidPromotionTimer() {}, process: { env: { IS_CAPACITOR: true } } }
  vm.runInNewContext(`function handlePlaying() {${body}; handlePlaying()`, context)
  assert.equal(context.showPoster.value, true)
})

test('poster event bindings reveal the first frame and restore the poster for another load', () => {
  const bindings = source.match(/@firstframe="[^"]+"/)[0] + ' ' + source.match(/@emptied="[^"]+"/)[0]
  const renderEvents = Vue.compile(`<video ${bindings} />`)
  const context = { showPoster: true }
  const video = renderEvents(context, [])
  video.props.onFirstframe()
  assert.equal(context.showPoster, false)
  video.props.onEmptied()
  assert.equal(context.showPoster, true)
})
