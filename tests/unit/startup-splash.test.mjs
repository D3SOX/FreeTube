import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { curtainExtent, STARTUP_REVEAL_DURATION_MS } from '../../src/renderer/helpers/startupSplash.js'

test('curtains cover the window initially and open from the rail before the hem', () => {
  for (const depth of [0, 0.25, 0.5, 0.75, 1]) assert.equal(curtainExtent(0, depth), 1)
  assert.equal(curtainExtent(100, 1), 1, 'the hem initially trails the rail')
  for (const elapsed of [100, 180, 260]) {
    assert.ok(curtainExtent(elapsed, 0) < curtainExtent(elapsed, 0.5))
    assert.ok(curtainExtent(elapsed, 0.5) < curtainExtent(elapsed, 1))
  }
})

test('all fabric leaves the viewport within the shortened reveal', () => {
  assert.ok(STARTUP_REVEAL_DURATION_MS <= 600)
  for (let row = 0; row <= 100; row++) {
    assert.equal(curtainExtent(STARTUP_REVEAL_DURATION_MS, row / 100), 0)
    for (let elapsed = 0; elapsed <= 1000; elapsed += 10) {
      const extent = curtainExtent(elapsed, row / 100)
      assert.ok(Number.isFinite(extent) && extent >= 0 && extent <= 1)
    }
  }
})

test('the initial splash uses native appearance without the renderer', async () => {
  const properties = new Map()
  const script = await readFile(new URL('../../src/renderer/startup/boot.js', import.meta.url), 'utf8')
  let presented = false
  let paint
  const context = {
    window: { ftElectron: {
      startupAppearance: { background: '#1e1e2e', dark: true },
      startupSplashReady: () => { presented = true }
    } },
    requestAnimationFrame: callback => { paint = callback },
    document: {
      documentElement: { style: { setProperty: (name, value) => properties.set(name, value) } }
    }
  }
  vm.runInNewContext(script, context)
  assert.equal(properties.get('--startup-background'), '#1e1e2e')
  assert.equal(properties.get('--startup-foreground'), '#eeeeee')
  assert.equal(presented, false)
  paint()
  assert.equal(presented, true)
})

for (const hideSplash of [true, false, undefined]) {
  test(`early startup honors hideSplash=${hideSplash} before loading the renderer`, async () => {
    const script = await readFile(new URL('../../src/renderer/startup/boot.js', import.meta.url), 'utf8')
    let removed = false
    let inert = true
    let presented = false
    vm.runInNewContext(script, {
      window: { ftElectron: {
        startupAppearance: { hideSplash },
        startupSplashReady: () => { presented = true }
      } },
      document: {
        documentElement: {},
        getElementById: id => id === 'startup-splash'
          ? { remove: () => { removed = true } }
          : { removeAttribute: name => { if (name === 'inert') inert = false } }
      },
      requestAnimationFrame: callback => callback()
    })
    assert.equal(removed, hideSplash === true)
    assert.equal(inert, hideSplash !== true)
    assert.equal(presented, true, 'the native window still becomes visible')
  })
}
