import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = (await readFile(new URL('../../src/renderer/helpers/api/capacitor-voice-over.js', import.meta.url), 'utf8'))
  .replace(/^import .*\n/gm, '').replace(/^export /gm, '')

function nativeFetch(request) {
  return vm.runInNewContext(`${source}\ncapacitorVoiceOverFetch`, {
    registerPlugin: () => ({ request }), createVoiceOverTranslationClient: () => {},
    Request, Response, Uint8Array, btoa, atob,
  })
}

test('native translation preserves binary protobuf request and response bytes', async () => {
  const bytes = Uint8Array.from([0, 127, 128, 255, 195, 169])
  const fetch = nativeFetch(async options => {
    assert.deepEqual(Buffer.from(options.body, 'base64'), Buffer.from(bytes))
    assert.equal(options.method, 'POST')
    assert.equal(options.headers['content-type'], 'application/x-protobuf')
    assert.equal(options.headersOnly, false)
    return { status: 200, headers: { 'content-type': 'application/x-protobuf' }, body: options.body }
  })
  const response = await fetch('https://api.browser.yandex.ru/session/create', {
    method: 'POST', body: new Blob([bytes]), headers: { 'content-type': 'application/x-protobuf' },
  })
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes)
})

test('audio validation requests headers without transferring media through the bridge', async () => {
  const fetch = nativeFetch(async options => {
    assert.equal(options.headersOnly, true)
    return { status: 302, headers: { location: 'https://strm.yandex.net/final' }, body: '' }
  })
  const response = await fetch('https://strm.yandex.net/audio', { headers: { Range: 'bytes=0-0' }, redirect: 'manual' })
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('location'), 'https://strm.yandex.net/final')
})
