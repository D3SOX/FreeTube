import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

// utils imports the renderer's router and i18n. Exercise the actual helper
// without booting those browser-only modules, using Node's mocked timers.
const source = await readFile(new URL('../../src/renderer/helpers/utils.js', import.meta.url), 'utf8')
const start = source.indexOf('export function debounce(')
const helper = source.slice(start + 'export '.length, source.indexOf('\n}\n', start) + 2)

function loadDebounce(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  return vm.runInNewContext(`${helper}\ndebounce`, { setTimeout, clearTimeout })
}

test('debounce cancellation is safe before scheduling and prevents a pending call', t => {
  const debounce = loadDebounce(t)
  let calls = 0
  const debounced = debounce(() => calls++, 100)
  debounced.cancel()
  debounced()
  t.mock.timers.tick(50)
  debounced.cancel()
  debounced.cancel()
  t.mock.timers.tick(100)
  assert.equal(calls, 0)
})

test('debounce can be reused after cancellation and keeps the last arguments and receiver', t => {
  const debounce = loadDebounce(t)
  const calls = []
  const receiver = { name: 'video' }
  const debounced = debounce(function (value) { calls.push([this, value]) }, 100)
  debounced('cancelled')
  debounced.cancel()
  debounced.call(receiver, 'first')
  t.mock.timers.tick(50)
  debounced.call(receiver, 'last')
  t.mock.timers.tick(99)
  assert.equal(calls.length, 0)
  t.mock.timers.tick(1)
  assert.deepEqual(calls, [[receiver, 'last']])
  debounced.cancel()
  t.mock.timers.tick(100)
  assert.equal(calls.length, 1)
})
