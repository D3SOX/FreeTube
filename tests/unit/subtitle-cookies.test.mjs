import assert from 'node:assert/strict'
import test from 'node:test'

import { isYouTubeSubtitleUrl } from '../../src/youtubeSubtitle.js'
import { getSubtitleRequestUrl } from '../../src/renderer/helpers/player/subtitleCookies.js'

const url = 'https://www.youtube.com/api/timedtext?v=eeeeeeeeeee&lang=en&tlang=de&fmt=vtt&pot=test-token'
const vtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nÜbersetzung\n'

test('accepts only HTTPS YouTube WebVTT and SRT requests for cookie authentication', () => {
  assert.equal(isYouTubeSubtitleUrl(url), true)
  assert.equal(isYouTubeSubtitleUrl(url.replace('fmt=vtt', 'fmt=srt')), true)
  for (const invalid of [
    null, {}, '', 'invalid',
    url.replace('https:', 'http:'),
    url.replace('www.youtube.com', 'www.youtube.com.evil.test'),
    url.replace('www.youtube.com', 'evil.test'),
    url.replace('www.youtube.com', 'user:password@www.youtube.com'),
    url.replace('www.youtube.com', 'www.youtube.com:8443'),
    url.replace('/api/timedtext', '/watch'),
    url.replace('fmt=vtt', 'fmt=json3'),
    'file:///tmp/cookies.txt',
  ]) assert.equal(isYouTubeSubtitleUrl(invalid), false, String(invalid))
})

test('both cookie switches authenticate the exact selected translation', async () => {
  for (const getters of [
    { getYtDlpSubtitleUseCookies: true },
    { getYtDlpPlaybackAlwaysUseCookies: true },
    { getYtDlpPlaybackAlwaysUseCookies: true, getYtDlpSubtitleUseCookies: true },
  ]) {
    const authenticatedUrl = await getSubtitleRequestUrl(url, getters, {
      ytDlpGetSubtitle: async requestedUrl => {
        assert.equal(requestedUrl, url)
        return vtt
      }
    })
    assert.equal(await (await fetch(authenticatedUrl)).text(), vtt)
  }
})

test('does not send other requests or disabled requests through yt-dlp', async () => {
  const electron = { ytDlpGetSubtitle: () => assert.fail('Unexpected cookie request') }
  assert.equal(await getSubtitleRequestUrl(url, {}, electron), url)
  const otherUrl = 'https://invidious.example/api/v1/captions/eeeeeeeeeee'
  assert.equal(await getSubtitleRequestUrl(otherUrl, { getYtDlpSubtitleUseCookies: true }, electron), otherUrl)
  assert.equal(await getSubtitleRequestUrl(url, { getYtDlpSubtitleUseCookies: true }, null), url)
})

test('uses normal fetching when no cookie source is configured and reports download errors', async () => {
  const getters = { getYtDlpSubtitleUseCookies: true }
  assert.equal(await getSubtitleRequestUrl(url, getters, { ytDlpGetSubtitle: async () => null }), url)
  await assert.rejects(getSubtitleRequestUrl(url, getters, {
    ytDlpGetSubtitle: async () => ({ error: 'Unable to load subtitle with configured cookies' })
  }), /Unable to load subtitle/)
})


test('preserves the SRT format used by automatic caption translations', async () => {
  const srt = '1\n00:00:00,000 --> 00:00:01,000\nÜbersetzung\n'
  const result = await getSubtitleRequestUrl(url.replace('fmt=vtt', 'fmt=srt'), { getYtDlpSubtitleUseCookies: true }, {
    ytDlpGetSubtitle: async () => srt
  })
  assert.match(result, /^data:text\/srt;/)
  assert.equal(await (await fetch(result)).text(), srt)
})

for (const position of ['0%', '100%']) {
  test(`keeps authenticated automatic captions centered instead of forcing position:${position}`, async () => {
    const caption = vtt.replace('00:00:01.000', `00:00:01.000 align:start position:${position}`)
    const authenticatedUrl = await getSubtitleRequestUrl(`${url}&caps=asr&kind=asr`, {
      getYtDlpSubtitleUseCookies: true
    }, { ytDlpGetSubtitle: async () => caption })
    assert.equal(await (await fetch(authenticatedUrl)).text(), vtt)

    // Uploaded captions retain the author's positioning.
    const uploadedUrl = await getSubtitleRequestUrl(url, {
      getYtDlpSubtitleUseCookies: true
    }, { ytDlpGetSubtitle: async () => caption })
    assert.equal(await (await fetch(uploadedUrl)).text(), caption)
  })
}
