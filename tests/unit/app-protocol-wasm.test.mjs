import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('../../src/main/index.js', import.meta.url), 'utf8')
const mimeFunction = source.match(/  function contentTypeFromFileExtension\(extension\) \{[\s\S]*?\n  \}/)[0]
const contentTypeFromFileExtension = runInNewContext(`(${mimeFunction})`)

test('app protocol serves WebAssembly with a MIME type accepted by streaming compilation', async () => {
  // A valid empty WASM module, served with the same MIME lookup as app://bundle.
  const bytes = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0)
  const response = new Response(bytes, {
    headers: { 'Content-Type': contentTypeFromFileExtension('wasm') }
  })
  const module = await WebAssembly.compileStreaming(response)
  assert.ok(module instanceof WebAssembly.Module)
  assert.equal(response.headers.get('content-type'), 'application/wasm')
})
