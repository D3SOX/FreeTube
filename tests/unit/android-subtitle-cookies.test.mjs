import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { isYouTubeSubtitleUrl } from '../../src/youtubeSubtitle.js'

const url = 'https://www.youtube.com/api/timedtext?v=eeeeeeeeeee&lang=en&tlang=de&fmt=vtt&pot=test-token'
const vtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nÜbersetzung\n'
const adapterSource = (await readFile(new URL('../../src/renderer/helpers/ytDlp.js', import.meta.url), 'utf8'))
  .replace(/^import .*\n/gm, '')
  .replace(/^export /gm, '')

function adapter(getters, subtitle) {
  return new Function('process', 'registerPlugin', 'store', 'isYouTubeSubtitleUrl', 'chooseAndroidDirectory', `${adapterSource}\nreturn ytDlp`)(
    { env: { IS_CAPACITOR: true } }, () => ({ subtitle }), { getters }, isYouTubeSubtitleUrl, async () => undefined)
}

test('Android subtitle cookies preserve the exact selected translation and use only imported cookies', async () => {
  const cookies = '/data/user/0/org.opentubex.app/no_backup/yt-dlp-cookies.txt'
  const bridge = adapter({ getYtDlpPlaybackAuthMode: 'file', getYtDlpPlaybackCookiesPath: cookies }, async request => {
    assert.deepEqual(request, { url, cookies })
    return { text: vtt }
  })
  assert.equal(await bridge.ytDlpGetSubtitle(url), vtt)
})

test('Android leaves subtitle fetching unchanged without an available cookie-file configuration', async () => {
  for (const getters of [{}, { getYtDlpPlaybackAuthMode: 'browser' }, { getYtDlpPlaybackAuthMode: 'file', getYtDlpPlaybackCookiesPath: '' }]) {
    const bridge = adapter(getters, () => assert.fail('Unexpected native cookie request'))
    assert.equal(await bridge.ytDlpGetSubtitle(url), null)
  }
})

test('Android rejects non-YouTube subtitle URLs and hides signed URLs in native errors', async () => {
  const getters = { getYtDlpPlaybackAuthMode: 'file', getYtDlpPlaybackCookiesPath: '/private/cookies.txt' }
  const bridge = adapter(getters, async () => { throw new Error(`failed signed request ${url}`) })
  assert.equal(await bridge.ytDlpGetSubtitle('https://other.example/api/timedtext?fmt=vtt'), null)
  assert.deepEqual(await bridge.ytDlpGetSubtitle(url), { error: 'Unable to load subtitle with configured cookies' })
})

test('subtitle helper selects the Android bridge without an Electron global', async () => {
  const source = (await readFile(new URL('../../src/renderer/helpers/player/subtitleCookies.js', import.meta.url), 'utf8'))
    .replace(/^import .*\n/gm, '')
    .replace(/^export /gm, '')
    .replace(/import\('\.\.\/ytDlp(?:\.js)?'\)/g, 'Promise.resolve({ ytDlp: androidBridge })')
  const bridge = { ytDlpGetSubtitle: async requested => { assert.equal(requested, url); return vtt } }
  const getSubtitleRequestUrl = new Function('process', 'globalThis', 'isYouTubeSubtitleUrl', 'androidBridge', `${source}\nreturn getSubtitleRequestUrl`)(
    { env: { IS_CAPACITOR: true } }, { window: {} }, isYouTubeSubtitleUrl, bridge)
  const result = await getSubtitleRequestUrl(url, { getYtDlpSubtitleUseCookies: true })
  assert.match(result, /^data:text\/vtt;/)
  assert.equal(await (await fetch(result)).text(), vtt)
})
