import crypto from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'

import { abortUnmockedRequest, goTo, repoRoot, test, expect } from '../../helpers/app.mjs'
import { fixtureKey } from '../../helpers/innertube.mjs'
import { demoPlayerResponse, routeWatchPageHtml } from '../../helpers/media.mjs'

const fixtureDir = path.join(repoRoot, 'e2e', 'fixtures', 'innertube', 'watch', 'shows-video-metadata')
const sharedDir = path.join(repoRoot, 'e2e', 'fixtures', 'innertube', 'shared')

const VIDEO_TITLE = 'Numbered video #9 #ShiorinSketch'
const VIDEO_DESCRIPTION = 'Follow @SomeCreator for more #ShiorinSketch clips'

async function fixture(dir, name) {
  try {
    return gunzipSync(await readFile(path.join(dir, name)))
  } catch {
    return null
  }
}

/**
 * Serves the watch page from the recorded fixtures with an unplayable video,
 * so the Watch view mounts without a real player, and replaces the recorded
 * title and description with ones that contain a hashtag and a handle that
 * YouTube did not link itself.
 */
async function mockWatchPage(app, page) {
  await app.electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('generate-po-token')
    ipcMain.handle('generate-po-token', () => 'test-po-token')
  })

  await page.route(/^https?:\/\//, abortUnmockedRequest)
  await routeWatchPageHtml(page)
  await page.route(/^https?:\/\//, async (route, request) => {
    const url = request.url()

    if (url === 'https://www.youtube.com/iframe_api') {
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'player\\/test-player\\/' })
    }

    if (url.includes('/img/desktop/unavailable/')) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: '' })
    }

    if (/\/s\/player\//.test(url) || /\/sw\.js_data/.test(url)) {
      const { pathname } = new URL(url)
      const name = `shared-${crypto.createHash('sha1').update(pathname).digest('hex').slice(0, 12)}.gz`
      const body = await fixture(sharedDir, name) ??
        (url.includes('/s/player/') ? await fixture(sharedDir, 'shared-99c4a5c04897.gz') : null)
      if (body) {
        return route.fulfill({
          status: 200,
          contentType: url.includes('/s/player/') ? 'text/javascript' : 'application/json',
          body
        })
      }
      return route.abort()
    }

    if (url.includes('/youtubei/v1/player')) {
      const json = demoPlayerResponse(JSON.parse(request.postData() ?? '{}').videoId ?? 'jNQXAC9IVRw')
      json.playabilityStatus = { status: 'UNPLAYABLE', reason: 'Video unavailable' }
      delete json.streamingData
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) })
    }

    if (url.includes('/youtubei/v1/')) {
      const key = fixtureKey(url, request.postData())
      let body = await fixture(fixtureDir, `${key}.0.json.gz`)
      if (!body) {
        const endpoint = key.replace(/-[0-9a-f]{12}$/, '')
        const files = (await readdir(fixtureDir)).filter((file) => file.startsWith(`${endpoint}-`))
        if (files.length > 0) body = await fixture(fixtureDir, files[0])
      }
      if (body) {
        if (url.includes('/youtubei/v1/next')) {
          const json = JSON.parse(body.toString())
          const contents = json.contents?.twoColumnWatchNextResults?.results?.results?.contents ?? []
          const primaryInfo = contents.find((entry) => entry.videoPrimaryInfoRenderer)?.videoPrimaryInfoRenderer
          const secondaryInfo = contents.find((entry) => entry.videoSecondaryInfoRenderer)?.videoSecondaryInfoRenderer
          primaryInfo.title = { runs: [{ text: VIDEO_TITLE }] }
          // YouTube links the hashtags and handles it recognised via `commandRuns`,
          // an empty list is what an unrecognised one looks like
          secondaryInfo.attributedDescription = { content: VIDEO_DESCRIPTION, commandRuns: [] }
          body = Buffer.from(JSON.stringify(json))
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body })
      }
      return route.abort()
    }

    return route.fallback()
  })
}

test.describe('hashtag and handle linkification', () => {
  test.use({
    seed: {
      history: [{
        _id: 'jNQXAC9IVRw',
        videoId: 'jNQXAC9IVRw',
        title: 'Hashtag test video',
        author: 'Test Channel',
        authorId: 'UC-test-channel-id',
        published: Date.now() - 86_400_000,
        description: '',
        viewCount: 1234,
        lengthSeconds: 60,
        watchProgress: 10,
        isWatched: false,
        timeWatched: Date.now(),
        isLive: false,
        type: 'video'
      }]
    }
  })

  test('links valid tags but leaves short numeric references plain', async ({ app, page }) => {
    await mockWatchPage(app, page)

    await goTo(page, 'history')
    await page.getByText('Hashtag test video').click()
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)

    const titleLink = page.locator('.videoTitle a')
    await expect(titleLink).toHaveCount(1)
    await expect(titleLink).toHaveText('#ShiorinSketch')
    await expect(titleLink).toHaveAttribute('href', 'https://youtube.com/hashtag/ShiorinSketch')
    await expect(page.locator('.videoTitle')).toHaveText(VIDEO_TITLE)

    const description = page.locator('.videoDescription .description')
    await expect(description.locator('a', { hasText: '#ShiorinSketch' }))
      .toHaveAttribute('href', 'https://youtube.com/hashtag/ShiorinSketch')
    await expect(description.locator('a', { hasText: '@SomeCreator' }))
      .toHaveAttribute('href', 'https://youtube.com/@SomeCreator')

    await titleLink.click()
    await expect(page).toHaveURL(/#\/hashtag\/ShiorinSketch/)
  })
})

test.describe('hashtag page', () => {
  test.use({
    seed: {
      settings: {
        backendPreference: 'invidious'
      }
    }
  })

  test('is requested in lowercase, whatever casing the link used', async ({ page }) => {
    const requestedUrls = []
    await page.route('**/api/v1/hashtag/**', async (route, request) => {
      requestedUrls.push(request.url())
      await route.fulfill({ json: { results: [] } })
    })

    const hashtagTab = await page.evaluate(() => window.ftElectron.tabs.create({
      route: '/hashtag/ShiorinSketch',
      makeActive: false
    }))
    await page.locator(`.tab[data-tab-id="${hashtagTab.id}"]`).click()

    await expect(page).toHaveURL(/#\/hashtag\/ShiorinSketch/)
    await expect(page.locator('.tabContent[aria-hidden="false"] h2 bdi')).toHaveText('shiorinsketch')
    await expect.poll(() => requestedUrls.length).toBe(1)
    expect(requestedUrls[0]).toContain('/api/v1/hashtag/shiorinsketch')
  })
})
