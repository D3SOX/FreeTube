import { test, expect, setPlayerFullscreen } from '../../helpers/innertube.mjs'
import { waitForPlaybackOrSkip } from '../../helpers/player.mjs'

const PLAYLIST_URL = 'https://youtu.be/g4OXlrxqIx0?list=UULFSMOQeBJ2RAnuFungnQOxLg'

async function clickAndMeasureNextPaint(locator) {
  const videoBox = await locator.page().locator('.ftVideoPlayer video').boundingBox()
  await locator.page().mouse.move(videoBox.x + videoBox.width / 2, videoBox.y + videoBox.height / 2)
  const measurement = await locator.page().evaluateHandle(() => ({
    nextPaint: new Promise(resolve => {
      document.addEventListener('click', () => {
        const start = performance.now()
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - start)))
      }, { capture: true, once: true })
    })
  }))
  try {
    await locator.click()
    return await measurement.evaluate(value => value.nextPaint)
  } finally {
    await measurement.dispose()
  }
}

test('large fullscreen playlist dock remains responsive and preserves its state', async ({ page, innertube }) => {
  test.skip(innertube.replay, 'playlist hydration needs the real API')

  const searchInput = page.locator('.topNav .searchInput input.ft-input')
  await searchInput.fill(PLAYLIST_URL)
  await searchInput.press('Enter')
  await page.waitForURL(/#\/watch\/g4OXlrxqIx0/, { timeout: 60000 })

  const sidebar = page.locator('.playlistItemsWrapper')
  await expect(sidebar).toBeVisible({ timeout: 60000 })
  await expect.poll(
    () => sidebar.locator('.playlistItem').count(),
    { timeout: 60000 }
  ).toBeGreaterThan(1000)
  await expect(sidebar).toHaveAttribute('data-overlayscrollbars-viewport')
  await expect(sidebar.locator(':scope > .os-scrollbar-vertical')).toHaveCount(1)
  await expect.poll(async () => sidebar.evaluate((element) => element.scrollHeight)).toBeGreaterThan(1000)

  const sidebarCard = page.locator('.watchVideoPlaylist')
  const sidebarProgress = sidebarCard.locator('.playlistProgressBarContainer')
  const sidebarProgressBox = await sidebarProgress.boundingBox()
  await page.mouse.move(
    sidebarProgressBox.x + 1,
    sidebarProgressBox.y + (sidebarProgressBox.height / 2)
  )
  const sidebarPreview = sidebarCard.locator('.previewTooltip')
  await expect(sidebarPreview).toBeVisible()
  const sidebarCardBox = await sidebarCard.boundingBox()
  const sidebarPreviewBox = await sidebarPreview.boundingBox()
  expect(sidebarPreviewBox.x).toBeGreaterThanOrEqual(sidebarCardBox.x + 7)
  expect(sidebarPreviewBox.x + sidebarPreviewBox.width).toBeLessThanOrEqual(
    sidebarCardBox.x + sidebarCardBox.width - 7
  )

  await sidebarCard.evaluate((element) => {
    element.style.inlineSize = '240px'
  })
  const narrowCardBox = await sidebarCard.boundingBox()
  const narrowProgressBox = await sidebarProgress.boundingBox()
  await sidebarProgress.dispatchEvent('mousemove', {
    clientX: narrowProgressBox.x + 1,
    clientY: narrowProgressBox.y + (narrowProgressBox.height / 2)
  })
  await expect.poll(async () => {
    const box = await sidebarPreview.boundingBox()
    return Math.round(box.x - narrowCardBox.x)
  }).toBe(8)
  const narrowLeftPreviewBox = await sidebarPreview.boundingBox()
  expect(narrowLeftPreviewBox.width).toBeLessThanOrEqual(narrowCardBox.width - 16)

  await sidebarProgress.dispatchEvent('mousemove', {
    clientX: narrowProgressBox.x + narrowProgressBox.width - 1,
    clientY: narrowProgressBox.y + (narrowProgressBox.height / 2)
  })
  await expect.poll(async () => {
    const box = await sidebarPreview.boundingBox()
    return Math.round(narrowCardBox.x + narrowCardBox.width - (box.x + box.width))
  }).toBe(8)
  await sidebarCard.evaluate((element) => {
    element.style.removeProperty('inline-size')
  })

  const video = await waitForPlaybackOrSkip(test, page)
  await video.evaluate(element => element.pause())

  await sidebar.evaluate((element) => { element.scrollTop = 420 })
  await expect.poll(async () => sidebar.evaluate((element) => element.scrollTop)).toBe(420)

  await setPlayerFullscreen(page, true)
  const sidebarScrollTop = await sidebar.evaluate((element) => element.scrollTop)
  const playlistToggle = page.getByRole('button', { name: 'Playlist', exact: true })
  const openDuration = await clickAndMeasureNextPaint(playlistToggle)
  expect(openDuration).toBeLessThan(1500)
  await expect(playlistToggle).toHaveAttribute('aria-expanded', 'true')

  const dock = page.locator('.fullscreenPlaylistTarget .playlistItemsWrapper')
  await expect(dock).toBeVisible()
  await expect(dock).toHaveAttribute('data-overlayscrollbars-viewport')
  const currentDockItem = dock.locator('.playlistItem').filter({ has: page.locator('.videoIndexIcon') })
  await expect(currentDockItem).toBeInViewport()
  const header = page.locator('.fullscreenPlaylistTarget .playlistHeader')
  const headerBounds = await header.boundingBox()
  await expect(header).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  const dockBounds = await dock.boundingBox()
  expect(dockBounds.y).toBeGreaterThanOrEqual(headerBounds.y + headerBounds.height - 1)
  const dockDimensions = await dock.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }))
  expect(dockDimensions.scrollHeight).toBeGreaterThan(dockDimensions.clientHeight)

  const centeredDockScrollTop = await dock.evaluate((element) => element.scrollTop)
  await dock.evaluate((element) => element.scrollBy(0, 480))
  await expect.poll(async () => dock.evaluate((element) => element.scrollTop)).toBeGreaterThan(centeredDockScrollTop)
  const dockScrollTop = await dock.evaluate((element) => element.scrollTop)
  const closeDuration = await clickAndMeasureNextPaint(page.getByRole('button', { name: 'Close Playlist' }))
  expect(closeDuration).toBeLessThan(1500)
  await expect(playlistToggle).toHaveAttribute('aria-expanded', 'false')
  const reopenDuration = await clickAndMeasureNextPaint(playlistToggle)
  expect(reopenDuration).toBeLessThan(1500)
  await expect(playlistToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(dock).toBeVisible()
  await expect.poll(async () => dock.evaluate((element) => element.scrollTop)).toBe(dockScrollTop)

  await page.locator('.playerFullscreenTitleOverlay').click({ force: true })
  const metadataOverlay = page.locator('.fullscreenMetadataOverlay.open')
  const playlistOverlay = page.locator('.fullscreenPlaylistOverlay.open')
  const playlistDockHeader = playlistOverlay.locator('.playlistDockHeader')
  await expect(metadataOverlay).toBeVisible()
  const dockContent = page.locator('.fullscreenPlaylistTarget .fullscreenPlaylistContent')
  await expect(dockContent).toHaveAttribute('data-overlayscrollbars-viewport')
  await expect(dockContent.locator(':scope > .os-scrollbar-vertical')).toHaveCount(1)
  await expect(dock).toHaveAttribute('data-overlayscrollbars-viewport')
  await expect(playlistDockHeader).toHaveCSS('cursor', 'grab')
  await playlistDockHeader.hover({ position: { x: 30, y: 26 } })
  const metadataBounds = await metadataOverlay.boundingBox()
  await page.mouse.down()
  await expect(page.locator('.ftVideoPlayer')).toHaveClass(/fullscreenDockReordering/)
  await page.mouse.move(metadataBounds.x + 30, metadataBounds.y + 10, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => {
    const [currentMetadataBounds, playlistBounds] = await Promise.all([
      metadataOverlay.boundingBox(),
      playlistOverlay.boundingBox()
    ])
    return playlistBounds.y < currentMetadataBounds.y
  }).toBe(true)

  await playlistDockHeader.hover({ position: { x: 30, y: 26 } })
  const reorderedMetadataBounds = await metadataOverlay.boundingBox()
  await page.mouse.down()
  await page.mouse.move(
    reorderedMetadataBounds.x + 30,
    reorderedMetadataBounds.y + reorderedMetadataBounds.height - 10,
    { steps: 5 }
  )
  await page.mouse.up()
  await expect.poll(async () => {
    const [currentMetadataBounds, playlistBounds] = await Promise.all([
      metadataOverlay.boundingBox(),
      playlistOverlay.boundingBox()
    ])
    return currentMetadataBounds.y < playlistBounds.y
  }).toBe(true)
  await page.getByRole('button', { name: 'Close video information' }).click()
  await expect(metadataOverlay).toHaveCount(0)

  await setPlayerFullscreen(page, false)
  await expect.poll(async () => {
    const restoredScrollTop = await sidebar.evaluate((element) => element.scrollTop)
    return Math.abs(restoredScrollTop - sidebarScrollTop)
  }).toBeLessThan(150)

  const fullscreenStart = Date.now()
  await setPlayerFullscreen(page, true)
  expect(Date.now() - fullscreenStart).toBeLessThan(3000)
  await expect(playlistToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(dock).toBeVisible()
  await expect.poll(async () => dock.evaluate((element) => element.scrollTop)).toBe(dockScrollTop)
})
