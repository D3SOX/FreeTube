import assert from 'node:assert/strict'
import test from 'node:test'
import { createCapacitorUiScale } from '../../src/renderer/helpers/capacitorUiScale.js'

function fixture() {
  const visualViewport = Object.assign(new EventTarget(), { width: 400, scale: 1 })
  const window = Object.assign(new EventTarget(), { visualViewport })
  const changes = []
  const scale = createCapacitorUiScale(window, {
    querySelector: () => ({ setAttribute: (_, value) => changes.push(value) }),
  })
  return { scale, visualViewport, changes, window }
}

test('UI scale resizes the layout viewport and remains stable after fractional resize events', () => {
  const { scale, visualViewport, changes } = fixture()
  scale.setScale(150)
  assert.equal(changes[0], 'width=267, initial-scale=1.4981273408239701, viewport-fit=cover')
  Object.assign(visualViewport, { width: 267.00002, scale: 400 / 267 })
  visualViewport.dispatchEvent(new Event('resize'))
  assert.equal(changes.length, 1)
  scale.setScale(100)
  assert.equal(changes.at(-1), 'width=400, initial-scale=1, viewport-fit=cover')
  scale.dispose()
})

test('UI scale follows rotation and window resizing without reacting to keyboard height changes', () => {
  const { scale, visualViewport, changes, window } = fixture()
  scale.setScale(125)
  Object.assign(visualViewport, { width: 640, scale: 1.25 })
  window.dispatchEvent(new Event('resize'))
  assert.equal(changes.at(-1), 'width=640, initial-scale=1.25, viewport-fit=cover')
  const count = changes.length
  visualViewport.dispatchEvent(new Event('resize'))
  assert.equal(changes.length, count)
  scale.dispose()
  visualViewport.width = 320
  window.dispatchEvent(new Event('resize'))
  assert.equal(changes.length, count)
})
