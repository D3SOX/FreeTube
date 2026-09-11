import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/helpers/api/invidious.js', import.meta.url), 'utf8')
const fetchSource = source.slice(source.indexOf('export function invidiousFetch('), source.indexOf('\nfunction invidiousAPICall('))
  .replace('export function', 'function')

test('authenticated Invidious API requests bypass the browser cache and preserve cancellation', async () => {
  for (const authorization of ['test-account', null]) {
    let requestedOptions
    const signal = new AbortController().signal
    const fetch = vm.runInNewContext(`${fetchSource}; invidiousFetch`, {
      store: { getters: { getCurrentInvidiousInstanceAuthorization: authorization } },
      fetch: async (_url, options) => { requestedOptions = options; return 'response' }
    })
    assert.equal(await fetch('https://instance.example/api/v1/account', signal), 'response')
    assert.equal(requestedOptions.signal, signal)
    assert.equal(requestedOptions.headers?.Authorization ?? null, authorization)
    assert.equal(requestedOptions.cache, authorization ? 'no-store' : undefined)
  }
})
