import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../src/renderer/components/FtListVideo/FtListVideo.vue', import.meta.url), 'utf8')
const start = source.indexOf('function openVideoContextMenu(event) {')
const handler = source.slice(start, source.indexOf('\nfunction handleContextMenuKeydown', start))

function openMenu ({ electron = false, capacitor = false, media = false, selected = false, unrelatedSelection = false, touch = false } = {}) {
  const dispatched = []
  const listeners = []
  const target = {
    closest: selector => selector === 'img, video' && media ? target : null,
    getBoundingClientRect: () => ({ left: 10, bottom: 30 })
  }
  const selection = {
    isCollapsed: !selected && !unrelatedSelection,
    containsNode: node => selected && node === target
  }
  const event = {
    target,
    type: touch ? 'pointerdown' : 'contextmenu',
    pointerType: touch ? 'touch' : 'mouse',
    clientX: 20,
    clientY: 40,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault () { this.defaultPrevented = true },
    stopPropagation () { this.propagationStopped = true }
  }
  const context = {
    process: { env: { IS_ELECTRON: electron, IS_CAPACITOR: capacitor } },
    window: {
      getSelection: () => selection,
      dispatchEvent: event => dispatched.push(event)
    },
    document: { addEventListener: type => listeners.push(type) },
    CustomEvent: class {
      constructor (type, options) { this.type = type; this.detail = options.detail }
    },
    cancelMenuHold () {},
    suppressMenuHoldClick () {},
    resetMenuHold () {},
    videoContextMenuItems: {},
    event
  }
  vm.runInNewContext(handler + '\nopenVideoContextMenu(event)', context)
  return { event, dispatched, listeners }
}

for (const capacitor of [false, true]) {
  for (const target of ['media', 'selected']) {
    for (const touch of [false, true]) {
      test(`${capacitor ? 'Capacitor' : 'web'} preserves native ${target} actions on ${touch ? 'touch hold' : 'right click'}`, () => {
        const { event, dispatched, listeners } = openMenu({ capacitor, [target]: true, touch })
        assert.equal(event.defaultPrevented, false)
        assert.equal(event.propagationStopped, false)
        assert.equal(dispatched.length, 0)
        assert.equal(listeners.length, 0, 'native interactions must not suppress the release click')
      })
    }
  }
}

test('Electron continues merging media and selected-text actions into the video menu', () => {
  for (const target of ['media', 'selected']) {
    const { event, dispatched } = openMenu({ electron: true, [target]: true })
    assert.equal(event.defaultPrevented, true)
    assert.equal(dispatched[0].type, 'opentubex:context-menu')
    assert.equal(dispatched[0].detail.contextEvent, event)
  }
})

test('ordinary card targets retain the video menu, including with a selection elsewhere', () => {
  for (const unrelatedSelection of [false, true]) {
    const { event, dispatched } = openMenu({ unrelatedSelection })
    assert.equal(event.defaultPrevented, true)
    assert.equal(dispatched[0].type, 'opentubex:context-menu')
  }
})
