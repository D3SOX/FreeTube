import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getThumbnailGridStyles,
  getThumbnailListStyles
} from '../../src/renderer/constants/thumbnailSize.js'

test('phone grids fit two columns at the default thumbnail size', () => {
  for (const width of [240, 313, 343, 380, 428.8]) {
    const size = Number.parseFloat(getThumbnailGridStyles(100, width)['--thumbnail-grid-size'])
    assert.equal(size * 2 + 8, width)
  }
})

test('every phone thumbnail slider step changes the card width proportionally', () => {
  for (const width of [313, 343, 380, 428.8]) {
    const defaultSize = (width - 8) / 2
    let previousSize = 0
    for (let size = 60; size <= 100; size += 10) {
      const cardSize = Number.parseFloat(getThumbnailGridStyles(size, width)['--thumbnail-grid-size'])
      assert.equal(cardSize, defaultSize * (size / 100))
      assert.ok(cardSize > previousSize)
      assert.ok(cardSize < width)
      previousSize = cardSize
    }
  }
})

test('phone grids fill the row above 100% and stop growing at full width', () => {
  for (const width of [313, 343, 428.8, 640]) {
    for (const size of [110, 140, 180]) {
      assert.equal(getThumbnailGridStyles(size, width)['--thumbnail-grid-size'], `${width}px`)
    }
  }
})

test('desktop grids retain proportional thumbnail sizing', () => {
  for (const width of [532, 800, 1200]) {
    const defaultSize = Number.parseFloat(getThumbnailGridStyles(100, width)['--thumbnail-grid-size'])
    for (const size of [60, 180]) {
      assert.equal(Number.parseFloat(getThumbnailGridStyles(size, width, 1200)['--thumbnail-grid-size']), defaultSize * (size / 100))
    }
  }
})

test('narrow grids in desktop viewports retain their full-width default', () => {
  assert.equal(getThumbnailGridStyles(100, 450, 900)['--thumbnail-grid-size'], '450px')
})

test('scales YouTube-style Shorts cards with the thumbnail size setting', () => {
  assert.equal(
    getThumbnailGridStyles(60)['--shorts-thumbnail-grid-min-size'],
    '114px'
  )
  assert.equal(
    getThumbnailGridStyles(100)['--shorts-thumbnail-grid-min-size'],
    '190px'
  )
  assert.equal(
    getThumbnailGridStyles(180)['--shorts-thumbnail-grid-min-size'],
    '342px'
  )
})

// Only the grid properties depend on the measured grid width; keeping the list
// ones separate is what lets them live on the document body.
test('keeps the grid and list properties separate', () => {
  assert.deepEqual(Object.keys(getThumbnailGridStyles(100, 800)), [
    '--thumbnail-grid-size',
    '--shorts-thumbnail-grid-min-size'
  ])
  assert.deepEqual(getThumbnailListStyles(50), {
    '--thumbnail-list-size': '168px',
    '--thumbnail-list-max-size': '12.5vw',
    '--thumbnail-list-mobile-max-size': '15vw'
  })
})
