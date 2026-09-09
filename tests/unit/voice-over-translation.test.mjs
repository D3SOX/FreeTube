import assert from 'node:assert/strict'
import test from 'node:test'
import VOTClient from '@vot.js/core'
import { createVoiceOverTranslationClient } from '../../src/voiceOverTranslation.js'

const payload = { videoId: 'jNQXAC9IVRw', duration: 19, responseLanguage: 'ru' }

test('shared translation validates input before requesting a translation', async () => {
  const request = createVoiceOverTranslationClient(() => assert.fail('unexpected request'))
  for (const value of [null, {}, { ...payload, videoId: '../private' }, { ...payload, duration: Infinity }, { ...payload, duration: 14401 }, { ...payload, responseLanguage: 'xx' }]) {
    await assert.rejects(request(value))
  }
})

test('shared translation follows only trusted audio redirects and returns the final URL', async t => {
  t.mock.method(VOTClient.prototype, 'translateVideo', async options => {
    assert.equal(options.videoData.url, 'https://youtu.be/jNQXAC9IVRw')
    assert.equal(options.responseLang, 'ru')
    return { translated: true, url: 'https://strm.yandex.net/audio', status: 1, remainingTime: 0 }
  })
  const calls = []
  const request = createVoiceOverTranslationClient(async (url, init) => {
    calls.push(url)
    assert.equal(init.credentials, 'omit')
    assert.equal(init.redirect, 'manual')
    assert.deepEqual(init.headers, { Range: 'bytes=0-0' })
    return calls.length === 1
      ? new Response(null, { status: 302, headers: { location: 'https://storage.yandexcloud.net/audio' } })
      : new Response(new Uint8Array([255]), { status: 206 })
  })
  assert.deepEqual(await request(payload), {
    translated: true, url: 'https://storage.yandexcloud.net/audio', status: 1, remainingTime: 0,
  })
  assert.equal(calls.length, 2)
})

test('shared translation rejects untrusted redirects before fetching them', async t => {
  t.mock.method(VOTClient.prototype, 'translateVideo', async () => ({ translated: true, url: 'https://strm.yandex.net/audio' }))
  let calls = 0
  const request = createVoiceOverTranslationClient(async () => {
    calls++
    return new Response(null, { status: 302, headers: { location: 'https://example.com/private' } })
  })
  await assert.rejects(request(payload), /untrusted audio URL/)
  assert.equal(calls, 1)
})

test('shared translation preserves preparation status without fetching audio', async t => {
  t.mock.method(VOTClient.prototype, 'translateVideo', async () => ({ translated: false, status: 2, remainingTime: 35 }))
  const request = createVoiceOverTranslationClient(() => assert.fail('unexpected audio request'))
  assert.deepEqual(await request(payload), { translated: false, status: 2, remainingTime: 35 })
})
