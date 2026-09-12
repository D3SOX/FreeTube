import assert from 'node:assert/strict'
import test from 'node:test'
import { createMobileNavigationScroll } from '../../src/renderer/helpers/mobileNavigationScroll.js'

test('hides downward and reveals upward after a small accumulated movement', () => {
  const nav = createMobileNavigationScroll()
  nav.reset(0)
  assert.equal(nav.update(4, 1000), false)
  assert.equal(nav.update(9, 1000), true)
  assert.equal(nav.update(200, 1000), true)
  assert.equal(nav.update(197.5, 1000), true)
  assert.equal(nav.update(191.5, 1000), false)
})

test('clamps overscroll, reveals at the top and resets after navigation', () => {
  const nav = createMobileNavigationScroll()
  nav.reset(0)
  assert.equal(nav.update(100, 100), true)
  assert.equal(nav.update(120, 100), true)
  assert.equal(nav.update(100, 100), true)
  assert.equal(nav.update(-10, 100), false)
  assert.equal(nav.update(0, 100), false)
  nav.update(80, 100)
  nav.reset(80)
  assert.equal(nav.update(80, 100), false)
  assert.equal(nav.update(90, 100), true)
  assert.equal(nav.update(0, 0), false)
})
