import { once } from 'node:events'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { DBActions, IpcChannels } from '../../../src/constants.js'
import { activeTab, openMockedVideo } from '../../helpers/player.mjs'
import { expect, goToSettingsSection, test } from '../../helpers/app.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

const WATCH_PAGE_SEED = {
  videoPlaybackEngine: 'built-in',
  ytDlpPlaybackEngineDefaultMigration: true,
  enableVideoMetadataCache: true
}
const THUMBNAILS = [
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
]

test.use({ seed: { settings: WATCH_PAGE_SEED } })

test('shows metadata history after loading a video with a previously recorded title', async ({ app, page }) => {
  await page.evaluate(() => window.ftElectron.videoMetadataCache.update({
    videoId: 'jNQXAC9IVRw',
    title: 'Previously recorded title',
    description: '',
    thumbnailUrl: ''
  }))
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)

  const historyButton = page.locator(`${activeTab} .infoArea`)
    .getByRole('button', { name: 'Metadata history' })
  await expect(historyButton).toBeVisible({ timeout: 25_000 })
  await historyButton.click()
  await expect(page.getByRole('dialog', { name: 'Metadata history' }))
    .toContainText('Previously recorded title')
})

test('detects a replaced thumbnail at the same cacheable URL', async ({ page }) => {
  let revision = 0
  let requests = 0
  const thumbnailServer = createServer((request, response) => {
    requests += 1
    const thumbnail = THUMBNAILS[revision]
    response.writeHead(200, {
      'cache-control': 'public, max-age=86400',
      'content-length': thumbnail.length,
      'content-type': 'image/png'
    })
    response.end(thumbnail)
  })
  thumbnailServer.listen(0, '127.0.0.1')
  await once(thumbnailServer, 'listening')

  try {
    const url = `http://127.0.0.1:${thumbnailServer.address().port}`
    await page.evaluate(({ action, url }) => window.ftElectron.dbSettings(action, {
      _id: 'defaultInvidiousInstance',
      value: url
    }), { action: DBActions.GENERAL.UPSERT, url })
    const metadata = {
      videoId: 'thumbnail01',
      title: 'Unchanged title',
      description: 'Unchanged description',
      thumbnailUrl: `${url}/thumbnail.png`
    }
    expect(await page.evaluate(metadata => window.ftElectron.videoMetadataCache.update(metadata), metadata))
      .toBeNull()
    revision = 1
    const history = await page.evaluate(metadata => window.ftElectron.videoMetadataCache.update(metadata), metadata)
    expect(history?.revisions).toHaveLength(2)
    expect(requests).toBe(2)
    expect(history.revisions[0].thumbnail).not.toBe(history.revisions[1].thumbnail)
  } finally {
    thumbnailServer.close()
    await once(thumbnailServer, 'close')
  }
})

test('preserves the displayed cache size when clearing fails', async ({ app, page }) => {
  await app.electronApp.evaluate(({ ipcMain }, channels) => {
    ipcMain.removeHandler(channels.getUsage)
    ipcMain.handle(channels.getUsage, () => ({ videoMetadata: 1536 }))
    ipcMain.removeHandler(channels.clear)
    ipcMain.handle(channels.clear, () => {
      throw new Error('Forced metadata cache clear failure')
    })
  }, {
    clear: IpcChannels.VIDEO_METADATA_CACHE_CLEAR,
    getUsage: IpcChannels.STORAGE_GET_USAGE
  })

  const storageSettings = await goToSettingsSection(page, 'storage')
  const metadata = storageSettings.locator('.storageItem').filter({ hasText: 'Metadata history' })
  const cacheSize = metadata.getByText('1.5 KiB')
  await expect(cacheSize).toBeVisible()

  await metadata.getByRole('button', { name: 'Clear Video Metadata Cache' }).click()
  await page.getByRole('dialog', {
    name: 'Are you sure you want to clear the cached video titles, thumbnails, and descriptions?'
  }).getByRole('button', { name: 'Delete' }).click()

  await expect(page.locator('.toast', { hasText: 'Failed to clear video metadata cache' })).toBeVisible()
  await expect(page.locator('.toast', { hasText: 'Video metadata cache has been cleared' })).toHaveCount(0)
  await expect(cacheSize).toBeVisible()
})

test('stores and presents every previous metadata version', async ({ app, page }) => {
  const thumbnailServer = createServer((request, response) => {
    const requestUrl = new URL(request.url, 'http://localhost')
    if (requestUrl.pathname === '/redirect.png') {
      const { port } = thumbnailServer.address()
      response.writeHead(302, { location: `http://localhost:${port}/thumbnail.png?revision=0` })
      response.end()
      return
    }

    const index = Number(requestUrl.searchParams.get('revision'))
    const thumbnail = THUMBNAILS[index % THUMBNAILS.length]
    response.writeHead(200, {
      'content-length': thumbnail.length,
      'content-type': 'image/png'
    })
    response.end(thumbnail)
  })
  thumbnailServer.listen(0, '127.0.0.1')
  await once(thumbnailServer, 'listening')

  try {
    const { port } = thumbnailServer.address()
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const thumbnailBaseUrl = `http://127.0.0.1:${port}`
    await page.evaluate(async ({ action, url }) => {
      await window.ftElectron.dbSettings(action, {
        _id: 'defaultInvidiousInstance',
        value: url
      })
    }, { action: DBActions.GENERAL.UPSERT, url: thumbnailBaseUrl })

    const watchView = await watchViewHandle(page)
    const cacheChecks = await watchView.evaluate(async (view, thumbnailBaseUrl) => {
      await window.ftElectron.videoMetadataCache.clear()

      const redirectedMetadata = {
        videoId: 'redirect001',
        title: 'Redirect test',
        description: 'Redirect test',
        thumbnailUrl: `${thumbnailBaseUrl}/redirect.png`
      }
      await window.ftElectron.videoMetadataCache.update(redirectedMetadata)
      const redirectedHistory = await window.ftElectron.videoMetadataCache.update({
        ...redirectedMetadata,
        title: 'Redirect test changed'
      })
      const privateRedirectRejected = redirectedHistory.revisions.every(revision => revision.thumbnail === null)
      await window.ftElectron.videoMetadataCache.clear()

      const observedAt = Date.now() - 10_000
      let history = null
      for (let index = 0; index < 6; index += 1) {
        const isCurrent = index === 5
        const label = isCurrent ? 'Current' : `Previous ${index + 1}`
        history = await window.ftElectron.videoMetadataCache.update({
          videoId: view.videoId,
          title: `${label} title`,
          description: Array.from(
            { length: 30 },
            (_, line) => `${label} description line ${line + 1} with enough text to wrap when the metadata history is narrow`
          ).join('\n'),
          thumbnailUrl: `${thumbnailBaseUrl}/thumbnail.png?revision=${index}`,
          observedAt: observedAt + index
        })
      }

      view.resetVideoState({ preserveTitle: true })
      view.isLoading = false
      await view.updateVideoMetadataCache()
      const preservedTitleWasRejected = !view.hasResolvedVideoTitle

      view.videoTitle = 'Current title'
      view.videoDescription = 'Current description'
      view.thumbnail = `${thumbnailBaseUrl}?revision=5`
      view.videoMetadataHistory = history
      view.hasResolvedVideoTitle = true
      await view.$nextTick()
      return { preservedTitleWasRejected, privateRedirectRejected }
    }, thumbnailBaseUrl)
    await watchView.dispose()
    expect(cacheChecks).toEqual({
      preservedTitleWasRejected: true,
      privateRedirectRejected: true
    })

    const cachePath = path.join(app.userDataDir, 'video-metadata-cache.db')
    const cacheDocuments = (await readFile(cachePath, 'utf8')).trim().split('\n')
      .map(line => JSON.parse(line))
      .filter(document => document._id && !document.$$deleted)
    expect(cacheDocuments).toHaveLength(6)
    expect(cacheDocuments.every(document => document.thumbnail?.startsWith('data:image/png;base64,')))
      .toBe(true)

    const historyButton = page.locator(`${activeTab} .infoArea`)
      .getByRole('button', { name: 'Metadata history' })
    await expect(historyButton).toBeVisible()
    await historyButton.click()

    const dialog = page.getByRole('dialog', { name: 'Metadata history' })
    await expect(dialog).toBeVisible()
    // Geometry captured during the prompt's scale/translate entrance animation
    // can differ by fractional pixels even though the fixed header never moves.
    await dialog.evaluate(element => Promise.all(
      element.getAnimations({ subtree: false }).map(animation => animation.finished)
    ))
    await expect(dialog.getByRole('heading', { name: 'Title history' })).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Thumbnail history' })).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Description history' })).toBeVisible()
    await expect(dialog.locator('.historySection')).toHaveCount(3)
    await expect(dialog.locator('.historySection').first().locator('.historyEntry')).toHaveCount(5)
    await expect(dialog).not.toContainText('Current title')

    const sectionPositions = await dialog.locator('.historySection').evaluateAll(sections => (
      sections.map(section => {
        const { x, y } = section.getBoundingClientRect()
        return { x, y }
      })
    ))
    expect(new Set(sectionPositions.map(position => Math.round(position.x))).size).toBe(3)
    expect(Math.max(...sectionPositions.map(position => position.y)) -
      Math.min(...sectionPositions.map(position => position.y))).toBeLessThanOrEqual(1)

    const thumbnailFrames = dialog.locator('.thumbnailFrame')
    await expect(thumbnailFrames).toHaveCount(5)
    expect(Math.max(...await thumbnailFrames.evaluateAll(frames => (
      frames.map(frame => frame.getBoundingClientRect().width)
    )))).toBeLessThanOrEqual(280)

    const descriptions = dialog.locator('.metadataDescription')
    await expect(descriptions).toHaveCount(5)
    for (const description of await descriptions.all()) {
      await expect(description).toHaveAttribute('data-overlayscrollbars-viewport')
      await expect(description.locator(':scope > .os-scrollbar-vertical')).toHaveCount(1)
    }

    const scroller = dialog.locator('.promptContentScroller')
    await expect(scroller).toHaveAttribute('data-overlayscrollbars-viewport')
    const heading = dialog.getByRole('heading', { name: 'Metadata history' })
    const closeButton = dialog.getByRole('button', { name: 'Close' })
    const fixedPositionsBeforeScroll = await Promise.all([heading.boundingBox(), closeButton.boundingBox()])
    await scroller.evaluate(element => element.scrollTo(0, element.scrollHeight))
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    const fixedPositionsAfterScroll = await Promise.all([heading.boundingBox(), closeButton.boundingBox()])
    for (const [index, before] of fixedPositionsBeforeScroll.entries()) {
      const after = fixedPositionsAfterScroll[index]
      for (const property of ['x', 'y', 'width', 'height']) {
        expect(Math.abs(after[property] - before[property])).toBeLessThanOrEqual(1)
      }
    }

    await page.setViewportSize({ width: 480, height: 500 })
    const firstDescription = descriptions.first()
    await scroller.evaluate(element => element.scrollTo(0, element.scrollHeight))
    await firstDescription.evaluate(element => element.scrollTo(0, element.scrollHeight))
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await expect.poll(() => firstDescription.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    await page.setViewportSize({ width: 1920, height: 1080 })
    await expect.poll(() => scroller.evaluate(element => {
      const content = element.firstElementChild
      const maximum = Math.max(0, content.offsetTop + content.offsetHeight +
        Number.parseFloat(getComputedStyle(content).marginBlockEnd) +
        Number.parseFloat(getComputedStyle(element).paddingBottom) - element.clientHeight)
      return element.scrollTop <= maximum + 1
    })).toBe(true)
    await expect.poll(() => firstDescription.evaluate(element => {
      const content = element.firstElementChild
      const maximum = Math.max(0, content.offsetTop + content.offsetHeight +
        Number.parseFloat(getComputedStyle(content).marginBlockEnd) +
        Number.parseFloat(getComputedStyle(element).paddingBottom) - element.clientHeight)
      return element.scrollTop <= maximum + 1
    })).toBe(true)

    await closeButton.click()
    await expect(dialog).toHaveCount(0)

    const storageSettings = await goToSettingsSection(page, 'storage')
    const metadata = storageSettings.locator('.storageItem').filter({ hasText: 'Metadata history' })
    await expect(metadata.getByRole('checkbox', { name: 'Metadata history' })).toBeChecked()
    await expect(metadata.locator('.storageSize')).not.toHaveText('0 B')
    await metadata.getByRole('button', { name: 'Clear Video Metadata Cache' }).click()
    await page.getByRole('dialog', {
      name: 'Are you sure you want to clear the cached video titles, thumbnails, and descriptions?'
    }).getByRole('button', { name: 'Delete' }).click()

    await expect(metadata.locator('.storageSize')).toHaveText('0 B')
    await expect(historyButton).toHaveCount(0)
  } finally {
    thumbnailServer.close()
    await once(thumbnailServer, 'close')
  }
})
