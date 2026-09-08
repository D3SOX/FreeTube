import assert from 'node:assert/strict'
import test from 'node:test'
import { createAndroidSabrRangeReader } from '../../src/renderer/helpers/player/androidSabrRanges.js'

function fixture() {
  const reads = []
  const references = [{ startByte: 4, endByte: 7 }, { startByte: 8, endByte: 11 }]
  const read = createAndroidSabrRangeReader({
    owner: 'owner',
    formats: [{}],
    readInitialization: async () => { reads.push('init'); return Uint8Array.of(0, 1, 2, 3) },
    getReferences: async () => references,
    readSegment: async (_, ref) => {
      reads.push(ref.startByte)
      return Uint8Array.from({ length: 4 }, (_, i) => ref.startByte + i)
    },
  })
  return { reads, read: (position, length, uri = 'otxsabr://owner/0') => read({ uri, position, length }) }
}

test('native init and index reads share one SABR initialization', async () => {
  const { read, reads } = fixture()
  const data = await Promise.all([read(0, 2), read(2, 2)])
  assert.deepEqual(data.map(value => [...value]), [[0, 1], [2, 3]])
  assert.deepEqual(reads, ['init'])
})

test('native retries can resume inside a SABR segment and cross a segment boundary', async () => {
  const { read, reads } = fixture()
  assert.deepEqual([...await read(6, 4)], [6, 7, 8, 9])
  assert.deepEqual(reads, ['init', 4, 8])
})

test('native merged init and media requests preserve exact bytes', async () => {
  const { read } = fixture()
  assert.deepEqual([...await read(2, 6)], [2, 3, 4, 5, 6, 7])
})

test('native requests cannot address another owner or an invalid range', async () => {
  const { read } = fixture()
  await assert.rejects(read(0, 2, 'otxsabr://other/0'))
  await assert.rejects(read(0, 2, 'otxsabr://owner/1'))
  await assert.rejects(read(-1, 2))
  await assert.rejects(read(0, 64 * 1024 * 1024))
  await assert.rejects(read(10, 4))
})

test('native resource parsing works on WebViews that treat custom schemes as opaque paths', async () => {
  const OriginalURL = globalThis.URL
  // Older WebViews expose custom-scheme authority as part of pathname.
  globalThis.URL = class {
    constructor(uri) {
      this.protocol = uri.slice(0, uri.indexOf(':') + 1)
      this.host = ''
      this.pathname = uri.slice(uri.indexOf(':') + 1)
    }
  }
  try {
    const { read } = fixture()
    assert.deepEqual([...await read(0, 2)], [0, 1])
  } finally {
    globalThis.URL = OriginalURL
  }
})
