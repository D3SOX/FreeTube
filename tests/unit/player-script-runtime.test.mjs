import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { gunzipSync } from 'node:zlib'
import { Player, Platform } from 'youtubei.js'

import { evaluatePlayerCode } from '../../src/renderer/helpers/api/player-script-runtime.js'

test('does not expose browser, worker, Electron or Node globals to player code', async () => {
  assert.deepEqual(await evaluatePlayerCode(`return {
    window: typeof window, document: typeof document, parent: typeof parent,
    fetch: typeof fetch, postMessage: typeof postMessage, process: typeof process,
    require: typeof require, electron: typeof ftElectron
  }`), {
    window: 'undefined', document: 'undefined', parent: 'undefined',
    fetch: 'undefined', postMessage: 'undefined', process: 'undefined',
    require: 'undefined', electron: 'undefined'
  })
  assert.equal(await evaluatePlayerCode('return globalThis.constructor.constructor("return typeof fetch")()'), 'undefined')
})

test('isolates globals and prototypes between evaluations', async () => {
  await evaluatePlayerCode('globalThis.saved = 1; Object.prototype.saved = 2; return true')
  assert.deepEqual(await evaluatePlayerCode('return [typeof globalThis.saved, typeof ({}).saved]'), ['undefined', 'undefined'])
  assert.equal(Object.prototype.saved, undefined)
})

test('returns values and errors without retaining failed contexts', async () => {
  assert.equal(await evaluatePlayerCode('return undefined'), undefined)
  await assert.rejects(evaluatePlayerCode('throw new Error("bad player")'), /bad player/)
  await assert.rejects(evaluatePlayerCode('invalid syntax }'), /SyntaxError/)
  assert.deepEqual(await evaluatePlayerCode('return {sig: "abc", n: "xyz"}'), { sig: 'abc', n: 'xyz' })
})

test('interrupts infinite loops and excessive allocation and remains usable', async () => {
  await assert.rejects(evaluatePlayerCode('while (true) {}', { timeoutMs: 20 }), /interrupted/)
  await assert.rejects(evaluatePlayerCode('const a=[]; while(true) a.push(new Array(10000).fill(123))', {
    memoryLimitBytes: 2 * 1024 * 1024
  }), /out of memory/)
  assert.equal(await evaluatePlayerCode('return 42'), 42)
})

test('deciphers archived YouTube player data identically to the previous evaluator', async () => {
  const source = gunzipSync(readFileSync(new URL('../../e2e/fixtures/innertube/shared/shared-99c4a5c04897.gz', import.meta.url))).toString()
  const player = await Player.create(undefined, async () => new Response(source), undefined, 'fixture')
  const previousEval = Platform.shim.eval
  Platform.shim.eval = data => evaluatePlayerCode(data.output)
  try {
    for (const [input, expected] of [
      ['abcdefghijklmno', 'lp23SSMqJ_Y3f'],
      ['0123456789ABCDEFGHIJ', 'ZfbAjVpVGFDyXkcReM']
    ]) {
      assert.equal(await player.decipher(`https://example.test/videoplayback?n=${input}`),
        `https://example.test/videoplayback?n=${expected}`)
    }
    const cipher = new URLSearchParams({
      url: 'https://example.test/videoplayback?n=abcdefghijklmno',
      s: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      sp: 'sig'
    })
    assert.equal(await player.decipher(undefined, cipher.toString()),
      'https://example.test/videoplayback?n=lp23SSMqJ_Y3f&sig=SfghijclmnopqrstuvwxyzA7CDaFGHIJKLMNOPQReTUVWXYZ0123456B')
  } finally {
    Platform.shim.eval = previousEval
  }
})
