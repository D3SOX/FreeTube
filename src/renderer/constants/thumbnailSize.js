export const DEFAULT_THUMBNAIL_SIZE = 100
export const MIN_THUMBNAIL_SIZE = 60
export const MAX_THUMBNAIL_SIZE = 180
export const THUMBNAIL_SIZE_STEP = 10
export const PHONE_THUMBNAIL_MAX_SIZE = 110
export const PHONE_THUMBNAIL_VIEWPORT_WIDTH = 680

const DEFAULT_GRID_ITEM_SIZE = 262
const DEFAULT_SHORTS_GRID_ITEM_MIN_SIZE = 190
const GRID_GAP = 8

function getDefaultGridItemSize(gridWidth, viewportWidth) {
  if (gridWidth <= 0) {
    return DEFAULT_GRID_ITEM_SIZE
  }

  // Start with two columns on phones, then scale the resulting card width
  // directly so every thumbnail slider step visibly changes its size.
  const columnCount = Math.max(
    viewportWidth <= PHONE_THUMBNAIL_VIEWPORT_WIDTH ? 2 : 1,
    Math.floor((gridWidth + GRID_GAP) / (DEFAULT_GRID_ITEM_SIZE + GRID_GAP))
  )

  return (gridWidth - (columnCount - 1) * GRID_GAP) / columnCount
}

/**
 * Grid columns depend on the measured width of the grid, so these have to be
 * set on each grid element.
 * @param {number} thumbnailSize
 * @param {number} [gridWidth]
 * @param {number} [viewportWidth]
 */
export function getThumbnailGridStyles(thumbnailSize, gridWidth = 0, viewportWidth = gridWidth) {
  const scale = thumbnailSize / DEFAULT_THUMBNAIL_SIZE
  const defaultGridItemSize = getDefaultGridItemSize(gridWidth, viewportWidth)
  const fullWidth = gridWidth > 0 && viewportWidth <= PHONE_THUMBNAIL_VIEWPORT_WIDTH &&
    thumbnailSize > DEFAULT_THUMBNAIL_SIZE

  return {
    '--thumbnail-grid-size': `${fullWidth ? gridWidth : defaultGridItemSize * scale}px`,
    '--shorts-thumbnail-grid-min-size': `${fullWidth ? gridWidth : DEFAULT_SHORTS_GRID_ITEM_MIN_SIZE * scale}px`
  }
}

/**
 * List thumbnails scale off fixed values only, so these are set once on the
 * document body instead of per list.
 * @param {number} thumbnailSize
 */
export function getThumbnailListStyles(thumbnailSize) {
  const scale = thumbnailSize / DEFAULT_THUMBNAIL_SIZE

  return {
    '--thumbnail-list-size': `${336 * scale}px`,
    '--thumbnail-list-max-size': `${25 * scale}vw`,
    '--thumbnail-list-mobile-max-size': `${30 * scale}vw`
  }
}
