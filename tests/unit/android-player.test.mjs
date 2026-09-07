import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { attachAndroidMediaElement } from '../../src/renderer/helpers/player/androidMediaElement.js'
import { createAndroidPlaybackController } from '../../src/renderer/helpers/player/androidPlaybackController.js'
import { createAndroidPlaybackGate } from '../../src/renderer/helpers/player/androidPlaybackGate.js'
import { androidCaptionCues } from '../../src/renderer/helpers/player/androidCaptionCues.js'
import { overrideShakaMethods } from '../../src/renderer/helpers/player/overrideShakaMethods.js'
import { androidPlaybackTracks } from '../../src/renderer/helpers/player/androidPlaybackTracks.js'

const source = (await readFile(new URL('../../src/renderer/helpers/player/androidPlayer.js', import.meta.url), 'utf8'))
  .replace(/^import .*\n/gm, '').replace('export function ', 'function ')

async function fixture({ failLoad = false, initialTracks = [], captionCues = [], captionBytes = Promise.resolve(new Uint8Array()), options = {} } = {}) {
  const calls = []
  const listeners = new Set()
  let state
  const publish = next => {
    state = { ...state, ...next }
    for (const callback of listeners) callback(state)
  }
  const plugin = {
    async addListener(name, callback) {
      if (name === 'state') listeners.add(callback)
      return { remove: async () => listeners.delete(callback) }
    },
    async setOwner({ owner }) { state = { owner } },
    async release() {},
    async configure() {},
    async selectTrack(selection) { calls.push(['track', selection]) },
    async setCaptionCues(selection) { calls.push(['captionCues', selection]) },
    async loadSource({ positionMs, source, ...loadOptions }) {
      calls.push(['load', source])
      calls.push(['loadOptions', loadOptions])
      if (failLoad) throw new Error('Source is unavailable')
      publish({ tracks: initialTracks, position: positionMs / 1000, duration: 100, paused: true, playing: false, ready: true, playbackRate: 1 })
    },
    async command({ action }) {
      calls.push([action])
      if (initialTracks.length) publish({ tracks: state.tracks })
      if (action === 'play' || action === 'pause') publish({ paused: action === 'pause', playing: action === 'play' })
      return state
    },
  }
  class Player {
    listeners = new Map()
    addEventListener(type, listener) { this.listeners.set(type, listener) }
    setVideoContainer() {}
    async attach() {}
    async destroy() {}
    async unload() {}
    configure() {}
    getStats() { return {} }
    getConfiguration() { return { abr: { enabled: false }, textDisplayer: {}, streaming: { retryParameters: {} } } }
    getNetworkingEngine() { return { request: () => ({ promise: captionBytes.then(data => ({ data })) }) } }
    dispatchEvent(event) { this.listeners.get(event.type)?.(event) }
  }
  class TextDisplayer {
    configure() {}
    remove() { calls.push(['clearText']) }
    setTextVisibility() {}
    append(cues) { calls.push(['cues', cues]) }
    async destroy() {}
  }
  class Cue {
    constructor(startTime, endTime, payload) { Object.assign(this, { startTime, endTime, payload }) }
    static parseCuePayload() {}
  }
  const createPlayer = vm.runInNewContext(`${source}\ncreateAndroidPlayer`, {
    shaka: { Player, net: { NetworkingEngine: { makeRequest() {}, RequestType: { SEGMENT: 1 } } }, text: { UITextDisplayer: TextDisplayer, Cue, VttTextParser: class { parseMedia() { return captionCues } } }, util: { FakeEvent: class { constructor(type) { this.type = type } } } },
    registerPlugin: () => plugin,
    attachAndroidMediaElement, createAndroidPlaybackController, createAndroidPlaybackGate, androidPlaybackTracks, overrideShakaMethods, androidCaptionCues,
    createAndroidNativeScreen: () => {
      let open = false
      return {
        isOpen: () => open, reset() { open = false }, destroy() {},
        async show() { open = true; calls.push(['show']) },
        async attach() { calls.push(['attach']) },
      }
    },
    MANIFEST_TYPE_SABR: 'application/sabr+json',
    crypto, AbortController, clearInterval, console,
  })
  const element = Object.assign(new EventTarget(), {
    style: {}, volume: 1, muted: false, playbackRate: 1, defaultPlaybackRate: 1, loop: false, autoplay: true, pause() {},
  })
  const player = createPlayer(element, {}, () => options)
  await player.attach()
  return { player, element, calls, publish }
}

test('returning to a paused native tab preserves its position without reapplying autoplay', async () => {
  const { player, element } = await fixture()
  await player.load('video.mp4', 12, 'video/mp4')
  assert.equal(element.paused, false)
  element.pause()
  const position = element.currentTime
  await player.nativePlayback.setPresented(false)
  await player.nativePlayback.setPresented(true)
  assert.equal(element.paused, true)
  assert.equal(element.currentTime, position)
  await player.destroy()
})

test('native screen attaches before paused media prepares its first frame', async () => {
  const { player, element, calls } = await fixture()
  element.autoplay = false
  await player.load('video.mp4', 0, 'video/mp4')
  assert.equal(player.nativePlayback.isScreenOpen(), false)
  assert.deepEqual(calls.filter(call => ['attach', 'show', 'load'].includes(call[0])), [['attach'], ['load', 'video.mp4']])
  assert.equal(element.paused, true)
  await player.destroy()
})

test('reloading an explicitly fullscreen native video preserves fullscreen', async () => {
  const { player, calls } = await fixture()
  await player.load('video.mp4', 0, 'video/mp4')
  await player.nativePlayback.show()
  calls.length = 0
  await player.load('video.mp4', 12, 'video/mp4')
  assert.equal(player.nativePlayback.isScreenOpen(), true)
  assert.deepEqual(calls.filter(call => ['attach', 'show', 'load'].includes(call[0])), [['show'], ['load', 'video.mp4']])
  await player.destroy()
})

test('a failed native source restores Watch instead of leaving a fullscreen page with no controls', async () => {
  const { player } = await fixture({ failLoad: true })
  await assert.rejects(player.load('missing.mp4', 0, 'video/mp4'), /Source is unavailable/)
  assert.equal(player.nativePlayback.isScreenOpen(), false)
  await player.destroy()
})

test('live controls use the native default position and unseekable streams expose no range', async () => {
  const { player, element, calls, publish } = await fixture()
  await player.load('live.m3u8', 0, 'application/x-mpegURL')
  publish({ live: true, seekable: false })
  assert.equal(element.seekable.length, 0)
  assert.equal(player.seekRange().end, 0)
  player.goToLive()
  assert.deepEqual(calls.at(-1), ['live'])
  await player.destroy()
})

test('hiding native captions disables their renderer and showing restores the selected track', async () => {
  const { player, calls, publish } = await fixture()
  await player.load('captions.m3u8', 0, 'application/x-mpegURL')
  publish({ tracks: [{ type: 3, supported: true, group: 2, index: 0, language: 'de' }] })
  player.selectTextTrack(player.getTextTracks()[0])
  player.setTextTrackVisibility(false)
  assert.equal(player.isTextTrackVisible(), false)
  assert.equal(calls.at(-1)[1].disabled, true)
  player.setTextTrackVisibility(true)
  assert.equal(player.isTextTrackVisible(), true)
  assert.equal(calls.at(-1)[1].group, 2)
  assert.equal(calls.at(-1)[1].index, 0)
  await player.destroy()
})

test('embedded native cues use the shared caption display and clear when their native interval ends', async () => {
  const { player, calls, publish } = await fixture()
  await player.load('captions.mp4', 4, 'video/mp4')
  publish({ tracks: [{ type: 3, supported: true, group: 2, index: 0, language: 'de' }] })
  player.selectTextTrack(player.getTextTracks()[0])
  publish({ cues: ['Native <b>Untertitel</b>'], position: 4 })
  assert.equal(calls.at(-1)[0], 'cues')
  assert.equal(calls.at(-1)[1][0].payload, 'Native <b>Untertitel</b>')
  assert.equal(calls.at(-1)[1][0].startTime, 4)
  publish({ cues: [], position: 6 })
  assert.equal(calls.at(-2)[0], 'clearText')
  assert.equal(calls.at(-1)[1].length, 0)
  await player.destroy()
})

test('native resolution selection changes only video and keeps the selected audio', async () => {
  const { player, publish, calls } = await fixture()
  await player.load('video.mp4', 12, 'video/mp4')
  const video = { type: 2, supported: true, group: 2, width: 1920, height: 1080, frameRate: 30 }
  publish({ tracks: [
    { type: 1, supported: true, selected: true, group: 1, index: 0, id: 'audio' },
    { ...video, selected: true, index: 0, id: 'avc', codecs: 'avc1', bitrate: 1500000 },
    { ...video, index: 1, id: 'vp9', codecs: 'vp09', bitrate: 1400000 },
    { ...video, index: 2, id: '720', width: 1280, height: 720, codecs: 'vp09', bitrate: 880000 },
  ] })
  const qualities = player.getVideoTracks()
  assert.equal(qualities.length, 2)
  assert.equal(player.getVariantTracks().length, 3)
  calls.length = 0
  player.selectVideoTrack(qualities[1])
  await Promise.resolve()
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'track')
  assert.equal(calls[0][1].type, 2)
  assert.equal(calls[0][1].group, 2)
  assert.equal(calls[0][1].index, 2)
  assert.equal(player.getAudioTracks()[0].active, true)
  await player.destroy()
})


test('native startup tracks do not replace the configured quality before it is applied', async () => {
  const base = { type: 2, supported: true, group: 0, codecs: 'avc1' }
  const initialTracks = [
    { ...base, index: 0, id: '144', width: 256, height: 144, selected: true },
    { ...base, index: 1, id: '720', width: 1280, height: 720, selected: false },
  ]
  const { player, publish, calls } = await fixture({ initialTracks })
  // Watch reflects variantchanged into its preferred quality while awaiting load.
  let preferredQuality = 720
  player.addEventListener('variantchanged', () => {
    preferredQuality = player.getVariantTracks().find(track => track.active)?.height
  })
  await player.load('video.mp4', 12, 'video/mp4')
  assert.equal(preferredQuality, 720)
  player.selectVariantTrack(player.getVariantTracks().find(track => track.height === preferredQuality))
  assert.equal(calls.findLast(call => call[0] === 'track')[1].index, 1)
  publish({ tracks: initialTracks.map(track => ({ ...track, selected: track.height === 720 })) })
  assert.equal(preferredQuality, 720)
  publish({ tracks: initialTracks })
  assert.equal(preferredQuality, 144, 'later manual quality changes still reach Watch')
  await player.destroy()
})


test('external and translated captions follow native PiP without reloading the decoder', async () => {
  const captionCues = [{ startTime: 2, endTime: 5, payload: '', nestedCues: [
    { payload: 'Hallo ' }, { payload: 'Welt' }, { lineBreak: true }, { payload: 'Untertitel' },
  ] }]
  const { player, calls } = await fixture({ captionCues })
  await player.load('video.mp4', 3, 'video/mp4')
  const track = await player.addTextTrackAsync('translated.vtt', 'de', 'captions', 'text/vtt', '', 'Deutsch')
  player.selectTextTrack(track)
  await new Promise(resolve => setImmediate(resolve))
  const selected = calls.findLast(call => call[0] === 'captionCues')?.[1]
  assert.ok(selected, 'parsed captions must be sent to native playback for PiP')
  assert.match(selected.owner, /^android-/)
  assert.equal(selected.visible, true)
  assert.deepEqual(JSON.parse(JSON.stringify(selected.cues)), [{ startTime: 2, endTime: 5, text: 'Hallo Welt\nUntertitel' }])
  player.setTextTrackVisibility(false)
  assert.equal(calls.findLast(call => call[0] === 'captionCues')[1].visible, false)
  player.setTextTrackVisibility(true)
  assert.equal(calls.findLast(call => call[0] === 'captionCues')[1].visible, true)
  player.selectTextTrack(null)
  assert.equal(calls.findLast(call => call[0] === 'captionCues')[1].cues, null)
  assert.equal(calls.filter(call => call[0] === 'load').length, 1)
  await player.destroy()
})


test('disabling captions during their fetch keeps the native PiP timeline hidden', async () => {
  let finishFetch
  const captionBytes = new Promise(resolve => { finishFetch = resolve })
  const { player, calls } = await fixture({ captionBytes, captionCues: [{ startTime: 1, endTime: 4, payload: 'Hello' }] })
  await player.load('video.mp4', 2, 'video/mp4')
  const track = await player.addTextTrackAsync('captions.vtt', 'en', 'captions', 'text/vtt')
  player.selectTextTrack(track)
  player.setTextTrackVisibility(false)
  finishFetch(new Uint8Array())
  await new Promise(resolve => setImmediate(resolve))
  const selected = calls.findLast(call => call[0] === 'captionCues')[1]
  assert.equal(selected.cues[0].text, 'Hello')
  assert.equal(selected.visible, false)
  await player.destroy()
})

test('an abandoned external caption fetch cannot replace the selected embedded PiP captions', async () => {
  let finishFetch
  const captionBytes = new Promise(resolve => { finishFetch = resolve })
  const { player, calls, publish } = await fixture({ captionBytes, captionCues: [{ startTime: 1, endTime: 4, payload: 'Old translation' }] })
  await player.load('video.mp4', 2, 'video/mp4')
  const external = await player.addTextTrackAsync('translated.vtt', 'de', 'captions', 'text/vtt')
  player.selectTextTrack(external)
  publish({ tracks: [{ type: 3, supported: true, group: 2, index: 0, language: 'en' }] })
  const embedded = player.getTextTracks().find(track => track.nativeTrack)
  player.selectTextTrack(embedded)
  finishFetch(new Uint8Array())
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.findLast(call => call[0] === 'captionCues')[1].cues, null)
  assert.equal(calls.some(call => call[0] === 'captionCues' && call[1].cues?.some(cue => cue.text === 'Old translation')), false)
  await player.destroy()
})


test('audio-only selection reaches native DASH loading and resets on a later video load', async () => {
  const options = { audioOnly: true }
  const { player, calls } = await fixture({ options })
  await player.load('video.mpd', 2, 'application/dash+xml')
  assert.equal(calls.findLast(call => call[0] === 'loadOptions')[1].audioOnly, true)
  options.audioOnly = false
  await player.load('video.mpd', 2, 'application/dash+xml')
  assert.equal(calls.findLast(call => call[0] === 'loadOptions')[1].audioOnly, false)
  await player.destroy()
})
