import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

import { expect, goToSettingsSection } from './app.mjs'
import { expectImagesLoaded } from './visual-fixtures.mjs'

const SIZE = { width: 1710, height: 1026 }

/** Keep screenshot content dimensions independent of native window decorations. */
export async function sizeScreenshotWindow(app) {
  await app.electronApp.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height)
  }, SIZE)
  await expect.poll(() => app.page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
    .toEqual(SIZE)
}

export async function openScreenshotSettings(page) {
  await goToSettingsSection(page, 'general')
  const dialog = page.locator('.settingsWindow')
  await dialog.getByRole('button', { name: 'Maximize', exact: true }).click()
  await expect(dialog).toHaveClass(/maximized/)
  await expect.poll(async () => {
    const { width, height } = await dialog.boundingBox()
    return { width, height }
  }).toEqual(SIZE)
  return dialog
}

/**
 * Capture one of the README and theme-preview scenes once its content is ready.
 * @param {import('@playwright/test').Page} page
 * @param {'subscriptions'|'watch'|'settings'} view
 * @param {string} destination
 */
export async function captureAppScreenshot(page, view, destination) {
  // Content scenes must contain their expected imagery, even if a regression
  // removes the img elements entirely. Settings has no required imagery.
  if (view === 'subscriptions') {
    for (let index = 0; index < 12; index++) {
      const thumbnail = page.locator('.ft-list-video').nth(index).locator('img.thumbnailImage').first()
      await expect(thumbnail).toBeVisible()
      await expectImagesLoaded(thumbnail)
    }
  } else if (view === 'watch') {
    const avatar = page.locator('.watchVideoInfo img.channelThumbnail').first()
    await expect(avatar).toBeVisible()
    await expectImagesLoaded(avatar)
    const recommendation = page.locator('.watchVideoRecommendations img.thumbnailImage').first()
    await expect(recommendation).toBeVisible()
    await expectImagesLoaded(recommendation)
  }

  await expect.poll(() => page.locator('img').evaluateAll(images => images
    .filter(image => {
      const rect = image.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 &&
        rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth &&
        image.checkVisibility()
    })
    .filter(image => !image.complete || image.naturalWidth === 0)
    .map(image => image.currentSrc || image.src)), {
    message: 'visible thumbnails and avatars must finish loading',
  }).toEqual([])
  await page.evaluate(async () => {
    await document.fonts.ready
    document.activeElement?.blur()
  })
  await page.mouse.move(0, 0)
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
  await page.screenshot({ path: destination, animations: 'disabled' })
}

/** Call only after all scenes succeed, so failed captures do not replace images. */
export async function copyScreenshots(testInfo, names, destination) {
  await mkdir(destination, { recursive: true })
  for (const name of names) {
    await copyFile(testInfo.outputPath(name), path.join(destination, name))
  }
}
