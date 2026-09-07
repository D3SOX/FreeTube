import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { computed, ref } from 'vue'

const component = await readFile(new URL('../../src/renderer/views/Settings/Settings.vue', import.meta.url), 'utf8')

function componentFunction(name) {
  const start = component.search(new RegExp(`(?:async )?function ${name}\\(`))
  assert.notEqual(start, -1)
  return component.slice(start, component.indexOf('\n}', start) + 2)
}

// Run the real window sizing and interaction logic without the settings pages'
// browser-only imports. Vue refs keep viewport changes reactive in this harness.
function settingsWindow(isCapacitor, width) {
  const window = { innerWidth: width }
  const initialState = component.slice(component.indexOf('const isMaximized ='), component.indexOf('const activeSection ='))
  const windowState = component.slice(component.indexOf('const windowBounds ='), component.indexOf('const settingsWindowMorphing ='))
  const functions = ['updateNarrowLayout', 'toggleMaximized', 'handleHeaderDoubleClick', 'startDragging', 'startResizing']
    .map(componentFunction).join('\n')
  const api = vm.runInNewContext(`${initialState}\n${windowState}\n${functions}\n;({
    isWindowMaximized, windowStyle, updateNarrowLayout,
    toggleMaximized, handleHeaderDoubleClick, startDragging, startResizing
  })`, {
    computed,
    ref,
    window,
    IS_CAPACITOR: isCapacitor,
    SETTINGS_DESKTOP_WIDTH_THRESHOLD: 760,
    getInitialBounds: () => ({ x: 24, y: 40, width: 720, height: 600 }),
    t: key => key,
    cancelBoundsAnimation: () => assert.fail('Forced maximization must reject window gestures')
  })
  return {
    ...api,
    resize(width) {
      window.innerWidth = width
      api.updateNarrowLayout()
    }
  }
}

function assertMaximized(settings) {
  assert.equal(settings.isWindowMaximized.value, true)
  assert.equal(settings.windowStyle.value.left, '0')
  assert.equal(settings.windowStyle.value.top, 'var(--app-safe-area-inset-top, 0px)')
  assert.equal(settings.windowStyle.value.inlineSize, '100vw')
  assert.equal(settings.windowStyle.value.blockSize, 'calc(100dvh - var(--app-safe-area-inset-top, 0px))')
}

test('mobile settings open maximized on landscape phones and tablets', () => {
  for (const width of [375, 844, 1024, 1366, 1092.8]) {
    assertMaximized(settingsWindow(true, width))
  }
})

test('mobile settings stay maximized when rotating across the compact breakpoint', () => {
  const settings = settingsWindow(true, 375)
  for (const width of [844, 375, 1024, 1366]) {
    settings.resize(width)
    assertMaximized(settings)
  }
})

test('mobile settings cannot be restored, dragged, or resized on tablets', async () => {
  const settings = settingsWindow(true, 1024)
  const event = { button: 0, target: { closest: () => null } }
  await settings.toggleMaximized()
  settings.handleHeaderDoubleClick(event)
  settings.startDragging(event)
  settings.startResizing(event, 'se')
  assertMaximized(settings)
})

test('desktop settings float at wide widths and maximize only at narrow widths', () => {
  const settings = settingsWindow(false, 1280)
  assert.equal(settings.isWindowMaximized.value, false)
  assert.equal(settings.windowStyle.value.inlineSize, '720px')
  settings.resize(375)
  assertMaximized(settings)
  settings.resize(1280)
  assert.equal(settings.isWindowMaximized.value, false)
})
