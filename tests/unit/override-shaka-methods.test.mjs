import assert from 'node:assert/strict'
import test from 'node:test'
import { overrideShakaMethods } from '../../src/renderer/helpers/player/overrideShakaMethods.js'

test('compiled fullscreen calls use native methods without changing other players', () => {
  const original = () => false
  const prototype = { isFullScreenEnabled: original, a: original }
  const native = Object.create(prototype)
  const other = Object.create(prototype)
  const restore = overrideShakaMethods(native, { isFullScreenEnabled: () => true })
  assert.equal(native.isFullScreenEnabled(), true)
  assert.equal(native.a(), true)
  assert.equal(other.a(), false)
  restore()
  assert.equal(native.a(), false)
  assert.equal(Object.hasOwn(native, 'a'), false)
})
