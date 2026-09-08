import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getViewportInsets,
  getViewportWidth,
  snapScrollMiniPlayerToEdge,
  clampScrollMiniPlayerRect,
  parseScrollMiniPlayerSavedRect,
  serializeScrollMiniPlayerSavedRect,
  getSavedScrollMiniPlayerRect,
  setSavedScrollMiniPlayerRect,
  getScrollMiniVerticalAnchor,
  getScrollMiniPlayerStashSide,
  getStashedScrollMiniPlayerRect,
  pickScrollMiniVerticalAnchor,
  reanchorScrollMiniPlayerRect,
  MARGIN
} from '../../src/renderer/helpers/scrollMiniPlayer.js'

test('a phone drag beyond either edge stashes the mini player', () => {
  const rect = { left: 16, top: 120, width: 320, height: 180 }
  const insets = { left: 0, right: 0 }

  assert.equal(getScrollMiniPlayerStashSide(rect, -50, 400, insets), 'left')
  assert.equal(getScrollMiniPlayerStashSide(rect, 100, 400, insets), 'right')
  assert.equal(getScrollMiniPlayerStashSide(rect, 10, 400, insets), null)
})

test('a stashed mini player leaves a 36px restore target visible', () => {
  const rect = { left: 16, top: 120, width: 320, height: 180 }
  const insets = { left: 4, right: 8 }
  const left = getStashedScrollMiniPlayerRect(rect, 'left', 400, insets)
  const right = getStashedScrollMiniPlayerRect(rect, 'right', 400, insets)

  assert.equal(left.left + left.width - insets.left, 36)
  assert.equal(400 - insets.right - right.left, 36)
})

/**
 * @param {object} options
 * @param {{ top: number, bottom: number, width: number, height: number } | null} [options.sideNavRect]
 * @param {{ left: number, right: number } | null} [options.verticalTabBarRect]
 * @param {{ top: number, bottom: number } | null} [options.tabBarRect]
 * @param {number} options.clientWidth usable width (excludes the scrollbar)
 * @param {number} [options.scrollbarWidth]
 * @param {number} [options.clientHeight]
 */
function stubViewport ({
  sideNavRect = null,
  verticalTabBarRect = null,
  tabBarRect = null,
  clientWidth,
  scrollbarWidth = 0,
  clientHeight = 800
}) {
  global.window = { innerWidth: clientWidth + scrollbarWidth, innerHeight: clientHeight }
  global.document = {
    querySelector (selector) {
      if (selector === '.sideNav' && sideNavRect) {
        return { getBoundingClientRect: () => sideNavRect }
      }
      if (selector === '.tabBar.vertical' && verticalTabBarRect) {
        return { getBoundingClientRect: () => verticalTabBarRect }
      }
      if (selector === '.tabBar' && tabBarRect) {
        return { getBoundingClientRect: () => tabBarRect }
      }
      return null
    },
    documentElement: { clientWidth }
  }
}

test.afterEach(() => {
  delete global.document
  delete global.window
})

test('the usable viewport width excludes the vertical scrollbar', () => {
  stubViewport({ clientWidth: 1585, scrollbarWidth: 15 })

  assert.equal(getViewportWidth(), 1585)
})

test('docking to the inline-end leaves a margin clear of the scrollbar', () => {
  stubViewport({ clientWidth: 1585, scrollbarWidth: 15 })
  const insets = getViewportInsets()

  const snapped = snapScrollMiniPlayerToEdge(
    { left: 800, top: 100, width: 360, height: 202, dock: 'right' },
    insets
  )

  // The right edge must sit MARGIN away from the content edge, not be swallowed
  // by the scrollbar (regression: window.innerWidth left only a 1px gap).
  assert.equal(1585 - (snapped.left + snapped.width), MARGIN)
})

test('a vertical tab bar on the inline-start side pads the left inset', () => {
  stubViewport({ verticalTabBarRect: { left: 0, right: 220 }, clientWidth: 1000 })

  const insets = getViewportInsets()

  assert.equal(insets.left, 220 + MARGIN)
  assert.equal(insets.right, MARGIN)
})

test('a vertical tab bar on the right (RTL) pads the right inset instead', () => {
  stubViewport({ verticalTabBarRect: { left: 780, right: 1000 }, clientWidth: 1000 })

  const insets = getViewportInsets()

  assert.equal(insets.right, (1000 - 780) + MARGIN)
  assert.equal(insets.left, MARGIN)
})

test('without a vertical tab bar both inline insets stay at the margin', () => {
  stubViewport({ clientWidth: 1000 })

  const insets = getViewportInsets()

  assert.equal(insets.left, MARGIN)
  assert.equal(insets.right, MARGIN)
})

test('a bottom tab bar pads the bottom inset', () => {
  stubViewport({
    tabBarRect: { top: 766, bottom: 800 },
    clientWidth: 1000,
    clientHeight: 800
  })

  const insets = getViewportInsets()

  assert.equal(insets.top, MARGIN)
  assert.equal(insets.bottom, 34 + MARGIN)
})

test('a phone bottom navigation pads the bottom inset', () => {
  stubViewport({
    sideNavRect: { top: 716, bottom: 800, width: 375, height: 84 },
    clientWidth: 375,
    clientHeight: 800
  })

  const insets = getViewportInsets()

  assert.equal(insets.bottom, 84 + MARGIN)
})

test('a desktop side navigation does not pad the bottom inset', () => {
  stubViewport({
    sideNavRect: { top: 0, bottom: 800, width: 88, height: 800 },
    clientWidth: 1000,
    clientHeight: 800
  })

  const insets = getViewportInsets()

  assert.equal(insets.bottom, MARGIN)
})

test('the left dock edge follows the tab rail width', () => {
  stubViewport({ verticalTabBarRect: { left: 0, right: 400 }, clientWidth: 1585 })
  const insets = getViewportInsets()

  const snapped = snapScrollMiniPlayerToEdge(
    { left: 236, top: 100, width: 360, height: 202, dock: 'left' },
    insets
  )

  // Regression: widening the rail used to strand the player at its old edge.
  assert.equal(snapped.left, 400 + MARGIN)
})

// Exactly 16:9 and fits the 800px-tall stub viewport, so activation must
// preserve its size (the height is derived from the width) and its distance
// from the edges it is docked to.
const SAVED_RECT = {
  left: 1000,
  top: 400,
  width: 512,
  height: 288,
  dock: 'right',
  verticalDock: 'bottom',
  verticalOffset: 96
}

test('scroll and tab-switch positions do not overwrite each other', () => {
  const tabRect = { ...SAVED_RECT, top: 200 }
  setSavedScrollMiniPlayerRect(SAVED_RECT, 'scroll')
  setSavedScrollMiniPlayerRect(tabRect, 'tab')
  assert.deepEqual(getSavedScrollMiniPlayerRect('scroll'), SAVED_RECT)
  assert.deepEqual(getSavedScrollMiniPlayerRect('tab'), tabRect)
  setSavedScrollMiniPlayerRect(null, 'tab')
  assert.equal(getSavedScrollMiniPlayerRect('tab'), null)
  assert.deepEqual(getSavedScrollMiniPlayerRect('scroll'), SAVED_RECT)
  setSavedScrollMiniPlayerRect(null, 'scroll')
})

test('parsing a saved rect round-trips it without consulting the viewport', () => {
  const saved = serializeScrollMiniPlayerSavedRect(SAVED_RECT)

  // Restoring runs while the tab is still loading, so the viewport can be
  // unsized. Clamping here used to shrink the rect and pin it bottom-left, so
  // the parsed result must not vary with the viewport.
  stubViewport({ clientWidth: 0 })
  assert.deepEqual(parseScrollMiniPlayerSavedRect(saved), SAVED_RECT)

  stubViewport({ clientWidth: 300 })
  assert.deepEqual(parseScrollMiniPlayerSavedRect(saved), SAVED_RECT)
})

test('saved mini-player placement round-trips either tucked side', () => {
  for (const stashedSide of ['left', 'right']) {
    const saved = { ...SAVED_RECT, stashedSide }
    assert.deepEqual(parseScrollMiniPlayerSavedRect(serializeScrollMiniPlayerSavedRect(saved)), saved)
  }
  const invalid = parseScrollMiniPlayerSavedRect(JSON.stringify({ ...SAVED_RECT, stashedSide: 'middle' }))
  assert.equal(invalid.stashedSide, undefined)
})

test('the vertical anchor is measured from the nearer edge', () => {
  stubViewport({ clientWidth: 1585 })

  assert.deepEqual(
    getScrollMiniVerticalAnchor({ left: 0, top: 400, width: 512, height: 288, dock: 'right' }),
    { verticalDock: 'bottom', verticalOffset: 96 }
  )
  assert.deepEqual(
    getScrollMiniVerticalAnchor({ left: 0, top: 40, width: 512, height: 288, dock: 'right' }),
    { verticalDock: 'top', verticalOffset: 24 }
  )
})

test('restoring while unsized then activating keeps the saved size and edges', () => {
  const saved = serializeScrollMiniPlayerSavedRect(SAVED_RECT)

  // The restore/activation sequence: parse while the tab is still loading...
  stubViewport({ clientWidth: 0 })
  const restored = parseScrollMiniPlayerSavedRect(saved)

  // ...then activation re-anchors it, once layout has settled.
  stubViewport({ clientWidth: 1585, scrollbarWidth: 15 })
  const activated = reanchorScrollMiniPlayerRect(restored)

  assert.equal(activated.width, SAVED_RECT.width)
  assert.equal(activated.height, SAVED_RECT.height)
  assert.equal(activated.left + activated.width, 1585 - MARGIN)
  assert.equal(800 - (activated.top + activated.height), MARGIN + SAVED_RECT.verticalOffset)
  assert.equal(activated.dock, 'right')
})

test('a window that grew while the player was away still docks it to the edge', () => {
  // Saved against a small window...
  stubViewport({ clientWidth: 1188, clientHeight: 894 })
  const saved = serializeScrollMiniPlayerSavedRect(
    // Parked in the bottom-right corner.
    { left: 1188 - 16 - 512, top: 894 - 16 - 288, width: 512, height: 288, dock: 'right' }
  )

  // ...then reopened after the window was maximised. Regression: the stale
  // absolute left/top left the player floating in the middle of the screen.
  stubViewport({ clientWidth: 1744, clientHeight: 1041 })
  const activated = reanchorScrollMiniPlayerRect(parseScrollMiniPlayerSavedRect(saved))

  assert.equal(activated.left + activated.width, 1744 - MARGIN)
  assert.equal(activated.top + activated.height, 1041 - MARGIN)
})

test('a viewport too short for the saved distance does not forget it', () => {
  const parked = { ...SAVED_RECT, verticalDock: 'bottom', verticalOffset: 600 }

  // 600px above the bottom does not fit in an 800px-tall viewport, so the rect
  // has to be clamped...
  stubViewport({ clientWidth: 1585, clientHeight: 800 })
  const squeezed = reanchorScrollMiniPlayerRect(parked)

  assert.equal(squeezed.top, MARGIN, 'clamped against the top inset')
  assert.deepEqual(
    pickScrollMiniVerticalAnchor(squeezed),
    { verticalDock: 'bottom', verticalOffset: 600 },
    'but the distance it should keep survives the clamp'
  )

  // ...and is restored once there is room for it again.
  stubViewport({ clientWidth: 1585, clientHeight: 1200 })
  const restored = reanchorScrollMiniPlayerRect(squeezed)

  assert.equal(1200 - (restored.top + restored.height), MARGIN + 600)
})

test('a legacy rect without an anchor is docked to the bottom once it is adrift', () => {
  // Saved before the anchor existed: bottom-right in an 894-tall window.
  const legacy = JSON.stringify(
    { left: 660, top: 590, width: 512, height: 288, dock: 'right' }
  )

  // Its stale top is now nearer the top edge than the bottom one, so reading the
  // position at face value would leave the player floating mid-screen.
  stubViewport({ clientWidth: 1744, clientHeight: 2000 })
  const activated = reanchorScrollMiniPlayerRect(parseScrollMiniPlayerSavedRect(legacy))

  assert.equal(activated.verticalDock, 'bottom')
  assert.equal(activated.top + activated.height, 2000 - MARGIN)
})

test('a legacy rect still parked at an edge keeps its offset', () => {
  // Within EDGE_SNAP of the top inset, so it still reads as parked up there.
  const legacy = JSON.stringify(
    { left: 16, top: 60, width: 512, height: 288, dock: 'left' }
  )

  stubViewport({ clientWidth: 1744, clientHeight: 900 })
  const activated = reanchorScrollMiniPlayerRect(parseScrollMiniPlayerSavedRect(legacy))

  assert.equal(activated.verticalDock, 'top')
  assert.equal(activated.top, 60)
  assert.equal(activated.left, MARGIN)
})

test('a restored rect that no longer fits is pulled back into view on activation', () => {
  const saved = serializeScrollMiniPlayerSavedRect(SAVED_RECT)

  stubViewport({ clientWidth: 0 })
  const restored = parseScrollMiniPlayerSavedRect(saved)

  // Saved against a wide window, reopened in a narrow one.
  stubViewport({ clientWidth: 600 })
  const activated = clampScrollMiniPlayerRect(restored)

  assert.ok(activated.left >= MARGIN, `left ${activated.left} should clear the margin`)
  assert.ok(
    activated.left + activated.width <= 600 - MARGIN,
    `right edge ${activated.left + activated.width} should stay inside the viewport`
  )
})

test('a malformed saved rect is rejected', () => {
  stubViewport({ clientWidth: 1585 })

  assert.equal(parseScrollMiniPlayerSavedRect(''), null)
  assert.equal(parseScrollMiniPlayerSavedRect('not json'), null)
  assert.equal(parseScrollMiniPlayerSavedRect(JSON.stringify({ left: 1 })), null)
  assert.equal(
    parseScrollMiniPlayerSavedRect(JSON.stringify({ left: NaN, top: 0, width: 1, height: 1 })),
    null
  )
})

test('a corrupt anchor is dropped instead of replayed', () => {
  stubViewport({ clientWidth: 1585 })

  // An offset is a distance from an inset, so these cannot describe a position.
  for (const verticalOffset of [-100, NaN, 'nope']) {
    const saved = JSON.stringify({ ...SAVED_RECT, verticalDock: 'top', verticalOffset })

    assert.equal(pickScrollMiniVerticalAnchor(parseScrollMiniPlayerSavedRect(saved)), null)
  }

  // The rect itself still survives, with an anchor inferred from its geometry.
  const saved = JSON.stringify({ ...SAVED_RECT, verticalDock: 'bottom', verticalOffset: -100 })
  const activated = reanchorScrollMiniPlayerRect(parseScrollMiniPlayerSavedRect(saved))

  assert.equal(activated.top + activated.height, 800 - MARGIN)
  assert.equal(activated.verticalOffset, 0)
})
