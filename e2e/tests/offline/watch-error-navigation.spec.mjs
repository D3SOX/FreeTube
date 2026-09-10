import crypto from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'

import { abortUnmockedRequest, goTo, repoRoot, sel, test, expect } from '../../helpers/app.mjs'
import { fixtureKey } from '../../helpers/innertube.mjs'
import { demoPlayerResponse, routeWatchPageHtml } from '../../helpers/media.mjs'
import { watchViewHandle } from '../../helpers/watch.mjs'

const fixtureDir = path.join(repoRoot, 'e2e', 'fixtures', 'innertube', 'watch', 'shows-video-metadata')
const sharedDir = path.join(repoRoot, 'e2e', 'fixtures', 'innertube', 'shared')
test.use({
  seed: {
    history: [{
      _id: 'jNQXAC9IVRw',
      videoId: 'jNQXAC9IVRw',
      title: 'Blocked test video',
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

async function fixture(dir, name) {
  try {
    return gunzipSync(await readFile(path.join(dir, name)))
  } catch {
    return null
  }
}

async function mockBlockedVideo({
  app,
  page,
  beforePlayerResponse,
  beforeNextResponse,
  omitVideoMetadata = false
}) {
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
      await beforePlayerResponse?.()
      const json = demoPlayerResponse(JSON.parse(request.postData() ?? '{}').videoId ?? 'jNQXAC9IVRw')
      if (omitVideoMetadata) {
        // No title anywhere, so the watch page has to fall back to the route.
        delete json.videoDetails
        delete json.microformat
      }
      json.playabilityStatus = {
        status: 'LOGIN_REQUIRED',
        reason: 'Sign in to confirm you’re not a bot'
      }
      delete json.streamingData
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) })
    }

    if (url.includes('/youtubei/v1/')) {
      if (url.includes('/youtubei/v1/next')) {
        await beforeNextResponse?.()
      }
      const key = fixtureKey(url, request.postData())
      let body = await fixture(fixtureDir, `${key}.0.json.gz`)
      if (!body) {
        const endpoint = key.replace(/-[0-9a-f]{12}$/, '')
        const files = (await readdir(fixtureDir)).filter((file) => file.startsWith(`${endpoint}-`))
        if (files.length > 0) body = await fixture(fixtureDir, files[0])
      }
      if (body) {
        if (omitVideoMetadata && url.includes('/youtubei/v1/next')) {
          const json = JSON.parse(body.toString())
          const primaryInfo = json.contents?.twoColumnWatchNextResults?.results?.results?.contents
            ?.find((entry) => entry.videoPrimaryInfoRenderer)?.videoPrimaryInfoRenderer
          if (primaryInfo) {
            delete primaryInfo.title
            delete primaryInfo.dateText
            delete primaryInfo.relativeDateText
          }
          delete json.playerOverlays?.playerOverlayRenderer?.videoDetails?.playerOverlayVideoDetailsRenderer?.title
          body = Buffer.from(JSON.stringify(json))
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body })
      }
      return route.abort()
    }

    return route.fallback()
  })
}

function captureRenderErrors(page) {
  const errors = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error}`))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  return errors
}

function expectNoRenderErrors(errors) {
  const renderErrors = errors.filter((error) =>
    error.includes('emitsOptions') ||
    error.includes('failed to render') ||
    error.includes('Invalid time value')
  )
  expect(renderErrors, `Renderer errors:\n${errors.join('\n')}`).toEqual([])
}

test('an IP-blocked response still uses the configured yt-dlp extractor and title', async ({ app, page }) => {
  await mockBlockedVideo({
    app,
    page,
    omitVideoMetadata: true
  })
  await page.route('https://example.invalid/recovered.m3u8', route => route.fulfill({
    contentType: 'application/x-mpegURL',
    body: '#EXTM3U\n'
  }))
  await app.electronApp.evaluate(({ ipcMain }) => {
    globalThis.__ipBlockedYtDlpCalls = 0
    ipcMain.removeHandler('yt-dlp-get-playback-info')
    ipcMain.handle('yt-dlp-get-playback-info', () => {
      globalThis.__ipBlockedYtDlpCalls++
      return {
        title: 'Title recovered by yt-dlp',
        isLive: false,
        liveStatus: 'not_live',
        hlsManifestUrl: 'https://example.invalid/recovered.m3u8',
        formats: [],
        duration: 60,
        version: 'test'
      }
    })
  })
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateVideoPlaybackEngine', 'yt-dlp')
  })

  await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)

  await expect.poll(() => app.electronApp.evaluate(
    () => globalThis.__ipBlockedYtDlpCalls
  )).toBeGreaterThan(0)
  const watchView = await watchViewHandle(page)
  await expect.poll(() => watchView.evaluate(view => ({
    title: view.videoTitle,
    titleResolved: view.hasResolvedVideoTitle
  }))).toEqual({
    title: 'Title recovered by yt-dlp',
    titleResolved: true
  })
  expect(await watchView.evaluate(view => view.errorMessage ?? '')).not.toContain('blocked')
  await expect(page.locator('.infoArea .videoTitle')).toHaveText('Title recovered by yt-dlp')
  await expect(page.locator('.tabBar .tab.active')).toContainText('Title recovered by yt-dlp')
})

test('watch page IP-block error does not break later navigation', async ({ app, page }) => {
  const errors = captureRenderErrors(page)
  let pausePlayerResponses = false
  let releasePlayerResponse
  let notifyPlayerRequested
  const playerResponseReleased = new Promise((resolve) => { releasePlayerResponse = resolve })
  const playerRequested = new Promise((resolve) => { notifyPlayerRequested = resolve })
  await mockBlockedVideo({
    app,
    page,
    omitVideoMetadata: true,
    beforePlayerResponse: async () => {
      if (pausePlayerResponses) {
        notifyPlayerRequested()
        await playerResponseReleased
      }
    }
  })

  try {
    await goTo(page, 'history')
    await page.getByText('Blocked test video').click()
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
    await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.errorMessage')).toContainText('blocked')
    await expect(page.locator('.errorActions').getByRole('button')).toHaveText(
      /Retry with (?:built-in|yt-dlp) extraction/
    )

    const tabs = page.locator('.tabBar .tab')
    await page.locator('.newTabButton').click()
    await expect(tabs).toHaveCount(2)
    await tabs.first().click()
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)

    pausePlayerResponses = true
    await page.keyboard.press('Control+R')
    await playerRequested
    await tabs.nth(1).click()
    releasePlayerResponse()

    await expect(tabs.nth(1)).toHaveClass(/active/)
    await expect(page.locator('.tabContent[aria-hidden="false"] .subscriptionsPage')).toBeVisible()
    await page.waitForTimeout(100)
    expectNoRenderErrors(errors)
  } finally {
    releasePlayerResponse()
  }
})

test('an IP-block error keeps the title passed to a background watch tab', async ({ app, page }) => {
  await mockBlockedVideo({
    app,
    page,
    omitVideoMetadata: true
  })

  await goTo(page, 'history')
  await page.getByText('Blocked test video').click({ button: 'middle' })

  const backgroundTab = page.locator(sel.tabs).nth(1)
  const backgroundContent = page.locator('.tabContent[aria-hidden="true"]').first()
  await expect(backgroundTab).toContainText('Blocked test video')
  await expect(backgroundContent.locator('.errorMessage')).toContainText('blocked', { timeout: 30_000 })
  await expect(backgroundTab).toContainText('Blocked test video')
  await expect(backgroundTab).not.toContainText('/watch/jNQXAC9IVRw')
})

test('an unresolved generic Watch title falls back to the route placeholder', async ({ app, page }) => {
  await mockBlockedVideo({
    app,
    page,
    omitVideoMetadata: true
  })

  await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toContainText('blocked', { timeout: 30_000 })

  const activeTab = page.locator('.tabBar .tab.active')
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const tab = store.getters.getActiveTab
    store.commit('setTabContentTitle', {
      tabId: tab.id,
      title: 'Watch',
      resolveHistoryEntry: false
    })
  })
  await expect(activeTab).toContainText('Watch')

  await page.keyboard.press('Control+R')
  await expect(page.locator('.errorMessage')).toContainText('blocked', { timeout: 30_000 })
  await expect(activeTab).toContainText('/watch/jNQXAC9IVRw')
  await expect(activeTab).not.toContainText('Watch')
})

test('a late video response cannot replace the title after going back', async ({ app, page }) => {
  let releaseMetadataResponse
  let notifyMetadataRequested
  const metadataResponseReleased = new Promise((resolve) => { releaseMetadataResponse = resolve })
  const metadataRequested = new Promise((resolve) => { notifyMetadataRequested = resolve })
  await mockBlockedVideo({
    app,
    page,
    beforeNextResponse: async () => {
      notifyMetadataRequested()
      await metadataResponseReleased
    }
  })

  try {
    await goTo(page, 'history')
    await page.getByText('Blocked test video').click()
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
    await metadataRequested

    await page.locator(sel.backButton).click()
    await expect(page).toHaveURL(/#\/history/)
    await expect(page.locator('.tabBar .tab.active')).toContainText('History')

    const metadataResponse = page.waitForResponse((response) =>
      response.url().includes('/youtubei/v1/next')
    )
    releaseMetadataResponse()
    await metadataResponse
    await expect(page.locator('.tabBar .tab.active')).toContainText('History')
    await expect(page.locator('.tabBar .tab.active')).not.toContainText('Me at the zoo')
  } finally {
    releaseMetadataResponse()
  }
})
