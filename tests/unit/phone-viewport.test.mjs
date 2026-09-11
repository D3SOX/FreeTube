import assert from 'node:assert/strict'
import test from 'node:test'
import { setupPhoneViewport } from '../../src/renderer/helpers/phoneViewport.js'

test('Android keyboard transitions do not subtract the keyboard height twice', () => {
  const visualViewport = Object.assign(new EventTarget(), { height: 1026, offsetTop: 0 })
  const window = Object.assign(new EventTarget(), { innerHeight: 1026, visualViewport })
  const values = new Map()
  const dispose = setupPhoneViewport(window, { documentElement: { style: { setProperty: (key, value) => values.set(key, value) } } }, true)
  // Pixel Android 16 reports visual and layout resize in separate frames.
  for (const [layout, visual] of [[1026, 599], [599, 173], [551, 503], [551, 551], [1026, 1026]]) {
    window.innerHeight = layout
    visualViewport.height = visual
    visualViewport.dispatchEvent(new Event('resize'))
    assert.equal(values.get('--phone-viewport-height'), `${layout}px`)
  }
  dispose()
  window.innerHeight = 100
  window.dispatchEvent(new Event('resize'))
  assert.equal(values.get('--phone-viewport-height'), '1026px')
})

test('browser dialogs follow the visual viewport including panning', () => {
  const visualViewport = Object.assign(new EventTarget(), { height: 432.5, offsetTop: 20.5 })
  const window = Object.assign(new EventTarget(), { innerHeight: 800, visualViewport })
  const values = new Map()
  const dispose = setupPhoneViewport(window, { documentElement: { style: { setProperty: (key, value) => values.set(key, value) } } })
  assert.equal(values.get('--phone-viewport-height'), '432.5px')
  assert.equal(values.get('--phone-viewport-top'), '20.5px')
  dispose()
})
