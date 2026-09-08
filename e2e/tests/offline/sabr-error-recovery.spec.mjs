import { goTo, setPlayerFullscreen, test, expect } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import {
  mockPlayableWatchPage,
  mockUnplayableWatchPage,
  watchHistoryEntry,
  watchViewHandle
} from '../../helpers/watch.mjs'

// Mirror the module-level Watch constants, which cannot be imported here.
const MAX_SABR_ERROR_RECOVERIES = 3
const MAX_SABR_ERROR_RECOVERIES_PER_VIDEO = 8

test.use({
  seed: {
    history: [{ ...watchHistoryEntry, title: 'SABR test video' }]
  }
})

/**
 * Puts the mounted Watch view into "playing a SABR stream on DASH" state, then
 * replays a scripted sequence of critical player errors and playback progress
 * against it. Reload requests are recorded instead of performed, so the run
 * stays offline and deterministic.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Array<{ error: true } | { reloadRequest: true } | { playFor: number } | { seekTo: number }>} script
 * @param {{
 *   isLoading?: boolean,
 *   legacyFormats?: Array<object>,
 *   rejectReload?: boolean,
 *   enablePlaybackEngineFallback?: boolean
 * }} options
 */
function driveWatchView(page, script, options = {}) {
  return page.evaluate(async ({ steps, isLoading, legacyFormats, rejectReload, enablePlaybackEngineFallback }) => {
    const app = document.querySelector('#app')?.__vue_app__

    const findWatchView = (vnode) => {
      if (vnode?.component?.type?.name === 'Watch') {
        return vnode.component.proxy
      }
      if (vnode?.component?.subTree) {
        const match = findWatchView(vnode.component.subTree)
        if (match) return match
      }
      if (Array.isArray(vnode?.children)) {
        for (const child of vnode.children) {
          const match = findWatchView(child)
          if (match) return match
        }
      }
      return null
    }

    const watchView = findWatchView(app?._container?._vnode)
    if (!watchView) {
      throw new Error('Unable to access the watch view')
    }

    // The state a video that is playing a SABR stream on the DASH format is in.
    watchView.errorMessage = ''
    watchView.isLoading = isLoading
    watchView.isLive = false
    watchView.isPostLiveDvr = false
    watchView.activeFormat = 'dash'
    watchView.manifestMimeType = 'application/sabr+json'
    watchView.manifestSrc = 'sabr://test'
    watchView.legacyFormats = legacyFormats

    const reloads = []
    watchView.performSabrReload = async (_payload, toastMessage) => {
      reloads.push(toastMessage)
      if (rejectReload) throw new Error('Synthetic SABR reload rejection')
    }

    if (enablePlaybackEngineFallback) {
      watchView.extractYtDlpPlaybackSource = async () => {
        watchView.activePlaybackEngine = 'yt-dlp'
        return true
      }
    } else {
      // Existing tests exercise the in-engine recovery chain in isolation.
      watchView.tryPlaybackEngineFallback = async () => false
    }

    // A critical, non-abort shaka error: the kind that walks the format
    // fallback chain. 1002 = BAD_HTTP_STATUS, category 1 = NETWORK.
    const criticalError = () => ({
      severity: 2,
      category: 1,
      code: 1002,
      data: ['https://example.invalid/sabr', 500]
    })

    // The real player emits timeupdate straight off the video element, roughly
    // four times a second, so playback is replayed here at that granularity.
    const TICK_SECONDS = 0.25
    let position = 0

    const formats = []
    for (const step of steps) {
      if (step.error) {
        await watchView.handlePlayerError(criticalError())
      } else if (step.reloadRequest) {
        await watchView.onPlayerReloadRequested({ wasPlaying: true })
      } else if (step.seekTo !== undefined) {
        position = step.seekTo
        watchView.handleTimeUpdate(position)
      } else {
        for (let played = 0; played < step.playFor; played += TICK_SECONDS) {
          position += TICK_SECONDS
          watchView.handleTimeUpdate(position)
        }
      }
      formats.push(watchView.activeFormat)
    }

    return {
      reloads,
      formats,
      finalFormat: watchView.activeFormat,
      activePlaybackEngine: watchView.activePlaybackEngine,
      playbackEngineFallbackAttempted: watchView.playbackEngineFallbackAttemptedForCurrentVideo,
      errorMessage: watchView.errorMessage
    }
  }, {
    steps: script,
    isLoading: options.isLoading ?? false,
    legacyFormats: options.legacyFormats ?? [{ itag: 18, qualityLabel: '360p', height: 360, width: 640, url: 'https://example.invalid/360p' }],
    rejectReload: options.rejectReload ?? false,
    enablePlaybackEngineFallback: options.enablePlaybackEngineFallback ?? false
  })
}

test('terminal built-in playback failure falls back to yt-dlp once', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  const result = await driveWatchView(page, [
    { error: true },
    { error: true },
    { error: true },
    { error: true },
    { error: true }
  ], { enablePlaybackEngineFallback: true })

  expect(result.reloads).toHaveLength(MAX_SABR_ERROR_RECOVERIES)
  expect(result.activePlaybackEngine).toBe('yt-dlp')
  expect(result.playbackEngineFallbackAttempted).toBe(true)
  expect(result.errorMessage).toBe('')
})

test('Android transient HTTP recovery retries the current stream once', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.ftVideoPlayer')).toBeVisible({ timeout: 30_000 })

  const watchView = await watchViewHandle(page)
  const result = await watchView.evaluate(async view => {
    if (!navigator.onLine) throw new Error('The Android transient recovery boundary requires an online renderer')

    const player = view.$refs.player
    const originalRetryStreaming = player.retryStreaming
    const originalRecoveryEnabled = view.isAndroidTransientHttpRecoveryEnabled
    const originalReloadSabrStream = view.reloadSabrStream
    let retries = 0
    let existingRecoveries = 0
    player.retryStreaming = () => {
      retries++
      return true
    }
    view.isAndroidTransientHttpRecoveryEnabled = () => true
    view.reloadSabrStream = async () => {
      existingRecoveries++
      return true
    }

    try {
      const error = {
        severity: 2,
        category: 1,
        code: 1002,
        data: ['https://example.invalid/video', { message: 'Failed to fetch' }]
      }
      await view.handlePlayerError(error)
      const afterFirstError = { retries, existingRecoveries, errorMessage: view.errorMessage }
      await view.handlePlayerError(error)
      return {
        afterFirstError,
        afterSecondError: { retries, existingRecoveries, errorMessage: view.errorMessage }
      }
    } finally {
      player.retryStreaming = originalRetryStreaming
      view.isAndroidTransientHttpRecoveryEnabled = originalRecoveryEnabled
      view.reloadSabrStream = originalReloadSabrStream
    }
  })

  expect(result).toEqual({
    afterFirstError: { retries: 1, existingRecoveries: 0, errorMessage: null },
    afterSecondError: { retries: 1, existingRecoveries: 1, errorMessage: null }
  })
})

test('terminal yt-dlp playback failure restores the built-in source once', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  const result = await page.evaluate(async () => {
    const app = document.querySelector('#app')?.__vue_app__

    const findWatchView = (vnode) => {
      if (vnode?.component?.type?.name === 'Watch') return vnode.component.proxy
      if (vnode?.component?.subTree) {
        const match = findWatchView(vnode.component.subTree)
        if (match) return match
      }
      if (Array.isArray(vnode?.children)) {
        for (const child of vnode.children) {
          const match = findWatchView(child)
          if (match) return match
        }
      }
      return null
    }

    const watchView = findWatchView(app?._container?._vnode)
    if (!watchView) throw new Error('Unable to access the watch view')

    watchView.errorMessage = ''
    watchView.isPostLiveDvr = false
    watchView.activeFormat = 'dash'
    watchView.activePlaybackEngine = 'yt-dlp'
    watchView.activePlaybackEngineVersion = 'test'
    watchView.playbackEngineFallbackTarget = null
    watchView.manifestSrc = 'data:application/dash+xml,yt-dlp'
    watchView.manifestMimeType = 'application/dash+xml'
    watchView.legacyFormats = []
    watchView.builtInPlaybackSource = {
      manifestSrc: null,
      manifestMimeType: 'application/dash+xml',
      sabrData: null,
      legacyFormats: [{ itag: 18 }],
      streamingDataExpiryDate: new Date(Date.now() + 60_000)
    }

    const error = { code: 1002, data: ['https://example.invalid/video', 500] }
    const firstFallback = await watchView.tryPlaybackEngineFallback(error)
    const secondFallback = await watchView.tryPlaybackEngineFallback(error)

    return {
      firstFallback,
      secondFallback,
      activePlaybackEngine: watchView.activePlaybackEngine,
      activePlaybackEngineVersion: watchView.activePlaybackEngineVersion,
      activeFormat: watchView.activeFormat,
      fallbackTarget: watchView.playbackEngineFallbackTarget,
      manifestSrc: watchView.manifestSrc,
      legacyFormatCount: watchView.legacyFormats.length
    }
  })

  expect(result).toEqual({
    firstFallback: true,
    secondFallback: false,
    activePlaybackEngine: 'built-in',
    activePlaybackEngineVersion: null,
    activeFormat: 'legacy',
    fallbackTarget: 'built-in',
    manifestSrc: null,
    legacyFormatCount: 1
  })
})

test('yt-dlp playback refreshes once then prefers built-in SABR over legacy', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  const result = await page.evaluate(async () => {
    const app = document.querySelector('#app')?.__vue_app__

    const findWatchView = (vnode) => {
      if (vnode?.component?.type?.name === 'Watch') return vnode.component.proxy
      if (vnode?.component?.subTree) {
        const match = findWatchView(vnode.component.subTree)
        if (match) return match
      }
      if (Array.isArray(vnode?.children)) {
        for (const child of vnode.children) {
          const match = findWatchView(child)
          if (match) return match
        }
      }
      return null
    }

    const watchView = findWatchView(app?._container?._vnode)
    if (!watchView) throw new Error('Unable to access the watch view')

    watchView.errorMessage = ''
    watchView.isLoading = false
    watchView.isLive = false
    watchView.isPostLiveDvr = false
    watchView.activeFormat = 'dash'
    watchView.activePlaybackEngine = 'yt-dlp'
    watchView.activePlaybackEngineVersion = 'test'
    watchView.streamErrorReloadAttemptedForCurrentVideo = false
    watchView.playbackEngineFallbackAttemptedForCurrentVideo = false
    watchView.playbackEngineFallbackTarget = null
    watchView.manifestSrc = 'data:application/dash+xml,yt-dlp'
    watchView.manifestMimeType = 'application/dash+xml'
    watchView.legacyFormats = [{ itag: 18 }]
    watchView.builtInPlaybackSource = {
      manifestSrc: 'data:application/sabr+json,built-in',
      manifestMimeType: 'application/sabr+json',
      sabrData: { scheme: 'sabr-test' },
      legacyFormats: [],
      streamingDataExpiryDate: new Date(Date.now() + 60_000)
    }

    let refreshes = 0
    watchView.extractYtDlpPlaybackSource = async () => {
      refreshes++
      return true
    }
    let progressSaves = 0
    watchView.handleWatchProgressAutoSaveWhenProgressEnabled = () => {
      progressSaves++
    }

    const error = { code: 1002, data: ['https://example.invalid/video', 500] }
    await watchView.handlePlayerError(error)
    const engineAfterRefresh = watchView.activePlaybackEngine
    const formatAfterRefresh = watchView.activeFormat
    await watchView.handlePlayerError(error)
    const fallbackPlaybackEngine = watchView.activePlaybackEngine
    const fallbackFormat = watchView.activeFormat
    const fallbackManifestMimeType = watchView.manifestMimeType
    const fallbackSabrScheme = watchView.sabrData?.scheme

    watchView.activeFormat = 'dash'
    watchView.activePlaybackEngine = 'yt-dlp'
    watchView.playbackEngineFallbackAttemptedForCurrentVideo = false
    watchView.playbackEngineFallbackTarget = null
    watchView.manifestSrc = 'data:application/dash+xml,yt-dlp'
    watchView.manifestMimeType = 'application/dash+xml'
    watchView.legacyFormats = [{ itag: 18 }]
    watchView.builtInPlaybackSource = {
      manifestSrc: null,
      manifestMimeType: 'application/dash+xml',
      sabrData: null,
      legacyFormats: [],
      streamingDataExpiryDate: null
    }
    const emptyBuiltInFallbackApplied = await watchView.tryPlaybackEngineFallback(error)

    return {
      refreshes,
      progressSaves,
      engineAfterRefresh,
      formatAfterRefresh,
      fallbackPlaybackEngine,
      fallbackFormat,
      fallbackManifestMimeType,
      fallbackSabrScheme,
      emptyBuiltInFallbackApplied,
      engineAfterEmptyBuiltInFallback: watchView.activePlaybackEngine,
      legacyFormatCount: watchView.legacyFormats.length
    }
  })

  expect(result).toEqual({
    refreshes: 1,
    progressSaves: 1,
    engineAfterRefresh: 'yt-dlp',
    formatAfterRefresh: 'dash',
    fallbackPlaybackEngine: 'built-in',
    fallbackFormat: 'dash',
    fallbackManifestMimeType: 'application/sabr+json',
    fallbackSabrScheme: 'sabr-test',
    emptyBuiltInFallbackApplied: false,
    engineAfterEmptyBuiltInFallback: 'yt-dlp',
    legacyFormatCount: 1
  })
})

test('yt-dlp player reload reuses cache unless the timed-out URL is rejected', async ({ app, page }) => {
  const rejectedStreamUrl = 'https://example.invalid/rejected-yt-dlp-stream'
  await mockPlayableWatchPage(app, page)
  await page.route(rejectedStreamUrl, route => route.fulfill({
    status: 403,
    headers: { 'access-control-allow-origin': '*' }
  }))
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.ftVideoPlayer')).toBeVisible({ timeout: 30_000 })

  const watchView = await watchViewHandle(page)
  const result = await watchView.evaluate(async (view) => {
    const TIMEOUT = 1003
    const useAuthentication = view.alwaysUseYtDlpPlaybackCookies
    const cacheKey = JSON.stringify([view.ytDlpPlaybackCacheKey, useAuthentication])
    const expiryTime = Date.now() + 60 * 60 * 1000
    const source = {
      manifestSrc: 'data:application/dash+xml;charset=UTF-8,cached',
      manifestMimeType: 'application/dash+xml',
      legacyFormats: [],
      title: 'Cached timeout test',
      isLive: false,
      subtitlesIncluded: true,
      version: 'test'
    }
    if (!await window.ftElectron.ytDlpPlaybackCacheSet(
      view.videoId,
      cacheKey,
      expiryTime,
      source
    )) {
      throw new Error('Unable to seed the yt-dlp playback cache')
    }

    view.errorMessage = ''
    view.isLoading = false
    view.isLive = false
    view.isPostLiveDvr = false
    view.activeFormat = 'dash'
    view.activePlaybackEngine = 'yt-dlp'
    view.activePlaybackEngineVersion = 'test'
    view.streamErrorReloadAttemptedForCurrentVideo = false
    view.playbackEngineFallbackAttemptedForCurrentVideo = false
    view.playbackEngineFallbackTarget = 'yt-dlp'
    view.manifestSrc = 'data:application/dash+xml,yt-dlp'
    view.manifestMimeType = 'application/dash+xml'
    view.legacyFormats = []
    view.builtInPlaybackSource = {
      manifestSrc: 'data:application/dash+xml,built-in',
      manifestMimeType: 'application/dash+xml',
      sabrData: null,
      legacyFormats: [],
      streamingDataExpiryDate: new Date(Date.now() + 60_000)
    }

    const metadataBeforeReload = JSON.stringify({
      title: view.videoTitle,
      description: view.videoDescription,
      channelName: view.channelName,
      recommendations: view.recommendedVideos
    })
    const initialLoadGeneration = view.videoLoadGeneration
    const cacheReuseResults = []
    const extractYtDlpPlaybackSource = view.extractYtDlpPlaybackSource.bind(view)
    view.extractYtDlpPlaybackSource = async (...args) => {
      const [loadGeneration, videoId, playbackEngineSwitchGeneration] = args
      const reused = await extractYtDlpPlaybackSource(
        loadGeneration,
        videoId,
        playbackEngineSwitchGeneration,
        useAuthentication,
        true
      )
      cacheReuseResults.push(reused)
      // Keep the synthetic cached manifest from mounting a player between reloads.
      view.errorMessage = 'Synthetic player hold'
      return reused
    }
    const waitForCacheLookup = async (count) => {
      for (let attempt = 0; attempt < 1500; attempt++) {
        if (cacheReuseResults.length >= count) return
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      throw new Error(
        `Timed out waiting for yt-dlp cache lookup ${count}, got ${cacheReuseResults.length}`
      )
    }

    await view.handlePlayerError({ code: TIMEOUT, data: [] })
    await waitForCacheLookup(1)
    const activePlaybackEngineAfterTimeout = view.activePlaybackEngine
    const cacheEntryAfterTimeout = await window.ftElectron.ytDlpPlaybackCacheGet(
      view.videoId,
      cacheKey
    )

    if (!await window.ftElectron.ytDlpPlaybackCacheSet(
      view.videoId,
      cacheKey,
      expiryTime,
      source
    )) {
      throw new Error('Unable to restore the yt-dlp playback cache')
    }
    view.streamErrorReloadAttemptedForCurrentVideo = false
    await view.handlePlayerError({ code: TIMEOUT, data: ['https://example.invalid/rejected-yt-dlp-stream'] })
    await waitForCacheLookup(2)

    return {
      activePlaybackEngineAfterTimeout,
      activePlaybackEngineAfterRejection: view.activePlaybackEngine,
      cacheEntryAfterRejection: await window.ftElectron.ytDlpPlaybackCacheGet(
        view.videoId,
        cacheKey
      ),
      cachePreservedAfterTimeout: cacheEntryAfterTimeout !== null,
      cacheReuseResults,
      metadataPreserved: metadataBeforeReload === JSON.stringify({
        title: view.videoTitle,
        description: view.videoDescription,
        channelName: view.channelName,
        recommendations: view.recommendedVideos
      }),
      reloads: view.videoLoadGeneration - initialLoadGeneration
    }
  })

  expect(result).toEqual({
    activePlaybackEngineAfterTimeout: 'yt-dlp',
    activePlaybackEngineAfterRejection: 'built-in',
    cacheEntryAfterRejection: null,
    cachePreservedAfterTimeout: true,
    cacheReuseResults: [true, false],
    metadataPreserved: true,
    reloads: 0
  })
})

test('a stale yt-dlp rejection probe preserves a newer cache entry', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.ftVideoPlayer')).toBeVisible({ timeout: 30_000 })

  const watchView = await watchViewHandle(page)
  const result = await watchView.evaluate(async (view) => {
    const rejectedStreamUrl = 'https://example.invalid/stale-rejected-yt-dlp-stream'
    const useAuthentication = view.alwaysUseYtDlpPlaybackCookies
    const cacheKey = JSON.stringify([view.ytDlpPlaybackCacheKey, useAuthentication])
    const source = {
      manifestSrc: 'data:application/dash+xml;charset=UTF-8,newer',
      manifestMimeType: 'application/dash+xml',
      legacyFormats: [],
      title: 'Newer timeout recovery',
      isLive: false,
      subtitlesIncluded: true,
      version: 'test'
    }
    const originalFetch = window.fetch

    window.fetch = async (url, options) => {
      if (url !== rejectedStreamUrl) return originalFetch(url, options)

      view.videoLoadGeneration++
      if (!await window.ftElectron.ytDlpPlaybackCacheSet(
        view.videoId,
        cacheKey,
        Date.now() + 60 * 60 * 1000,
        source
      )) {
        throw new Error('Unable to seed the newer yt-dlp playback cache')
      }
      return new Response('', { status: 403 })
    }

    try {
      await view.reloadYtDlpPlayerAfterStreamErrorOnce(
        '[PLAYER_ERROR: 1003]',
        rejectedStreamUrl
      )
    } finally {
      window.fetch = originalFetch
    }

    return {
      cacheEntry: await window.ftElectron.ytDlpPlaybackCacheGet(view.videoId, cacheKey),
      loadGeneration: view.videoLoadGeneration
    }
  })

  expect(result.cacheEntry?.source.title).toBe('Newer timeout recovery')
  expect(result.loadGeneration).toBeGreaterThan(0)
})

for (const zoom of [1, 1.25]) {
  test(`startup countdown keeps artwork visible at ${zoom * 100}% scale`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.route('https://i.ytimg.com/**', route => route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#326b8a"/></svg>'
    }))
    await page.evaluate(zoom => window.ftElectron.setZoomFactor(zoom), zoom)
    await openMockedVideo(page)
    const watchView = await watchViewHandle(page)
    await watchView.evaluate(async view => {
      view.isLoading = true
      await view.$nextTick()
      view.adEndTimeUnixMs = Date.now() + 8000
      view.isLoading = false
    })
    const player = page.locator('.ftVideoPlayer')
    await expect(player.locator('.countdownOverlay')).toBeVisible()
    const poster = player.locator('.countdownPoster img')
    await expect(poster).toBeVisible()
    await expect.poll(() => poster.evaluate(image => image.naturalWidth)).toBe(480)
    expect(await poster.getAttribute('alt')).toBe('')
    const bounds = await player.boundingBox()
    expect(await poster.boundingBox()).toEqual(bounds)
    expect(await poster.evaluate(image => getComputedStyle(image).objectFit)).toBe('contain')
    await expect(player.locator('.countdownOverlay')).toBeHidden({ timeout: 15_000 })
    await expect(poster).toHaveCount(0)
    await expect.poll(() => player.locator('video').evaluate(video => video.readyState)).toBeGreaterThanOrEqual(3)
  })

  for (const posterAvailable of [true, false]) {
    test(`yt-dlp 403 recovery keeps the player height at ${zoom * 100}% scale with poster ${posterAvailable ? 'available' : 'unavailable'}`, async ({ app, page }, testInfo) => {
      await mockPlayableWatchPage(app, page)
      if (posterAvailable) {
        // A 4:3 poster must not change the playing video's 16:9 geometry.
        await page.route('https://i.ytimg.com/**', route => route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#326b8a"/></svg>'
        }))
      }
      await page.evaluate(async zoom => {
        await window.ftElectron.setZoomFactor(zoom)
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        await store.dispatch('updateVideoPlaybackEngine', 'built-in')
      }, zoom)
      await openMockedVideo(page)

      const player = page.locator('.ftVideoPlayer')
      const before = await player.boundingBox()
      const watchView = await watchViewHandle(page)
      await watchView.evaluate((view) => {
        const area = view.$el.querySelector('.videoAreaMargin')
        window.__recoveryHeights = []
        window.__recoveryHeightObserver = new ResizeObserver(() => {
          window.__recoveryHeights.push(area.getBoundingClientRect().height)
        })
        window.__recoveryHeightObserver.observe(area)
        view.activePlaybackEngine = 'yt-dlp'
        view.extractYtDlpPlaybackSource = () => new Promise(resolve => {
          window.__releaseStreamExtraction = () => resolve(true)
        })
        const destroyPlayer = view.$refs.player.destroyPlayer
        const teardownPending = new Promise(resolve => { window.__releasePlayerTeardown = resolve })
        view.$refs.player.destroyPlayer = async () => {
          const state = await destroyPlayer()
          window.__playerTeardownFinished = true
          await teardownPending
          return state
        }
        window.__streamRecovery = view.handlePlayerError({
          code: 1002,
          data: ['https://example.invalid/video', 403]
        })
      })
      await expect.poll(() => page.evaluate(() => window.__playerTeardownFinished)).toBe(true)
      expect(await player.locator('video').evaluate(element => element.videoWidth)).toBe(0)
      await expect(player.locator('video')).toHaveAttribute('poster', /i\.ytimg\.com/)
      const during = await player.boundingBox()
      expect(Math.abs(during.height - before.height)).toBeLessThanOrEqual(1)
      await testInfo.attach('player-during-teardown', {
        body: await player.screenshot(),
        contentType: 'image/png'
      })

      await page.evaluate(() => { window.__releasePlayerTeardown() })
      const placeholder = page.locator('.streamPlaceholder')
      await expect(placeholder).toBeVisible()
      const pending = await placeholder.boundingBox()
      expect(Math.abs(pending.height - before.height)).toBeLessThanOrEqual(1)
      await expect(placeholder).toContainText('Fetching streams')
      if (posterAvailable) {
        await expect.poll(() => placeholder.locator('img').evaluate(element => element.naturalWidth)).toBe(480)
      }
      await page.evaluate(async () => {
        window.__releaseStreamExtraction()
        await window.__streamRecovery
      })
      await expect.poll(() => player.locator('video').evaluate(element => element.videoWidth)).toBeGreaterThan(0)
      const after = await player.boundingBox()
      expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1)
      const heights = await page.evaluate(() => {
        window.__recoveryHeightObserver.disconnect()
        return window.__recoveryHeights
      })
      expect(heights.length).toBeGreaterThan(0)
      expect(Math.max(...heights.map(height => Math.abs(height - before.height)))).toBeLessThanOrEqual(1)
    })
  }
}

test('yt-dlp recovery remounts only the player and preserves playback state', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)

  const player = page.locator('.ftVideoPlayer')
  const video = player.locator('video')
  await expect(player).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => video.evaluate(element => element.currentTime))
    .toBeGreaterThanOrEqual(watchHistoryEntry.watchProgress)
  await video.evaluate((element) => {
    element.pause()
    element.currentTime = 5.25
    element.playbackRate = 1.5
  })
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(5.25, 1)

  const playerBeforeReload = await player.elementHandle()
  const watchView = await watchViewHandle(page)
  const activeVideoQualityBeforeReload = await watchView.evaluate(view => {
    const getSabrReloadState = view.$refs.player.getSabrReloadState.bind(view.$refs.player)
    view.$refs.player.getSabrReloadState = () => ({
      ...getSabrReloadState(),
      videoQuality: '360'
    })
    view.currentVideoQuality = 'auto'
    return view.$refs.player.getSabrReloadState().videoQuality
  })
  const stateBeforeReload = await watchView.evaluate(view => ({
    videoLoadGeneration: view.videoLoadGeneration,
    videoTitle: view.videoTitle,
    videoDescription: view.videoDescription,
    channelName: view.channelName,
    recommendedVideos: view.recommendedVideos
  }))

  await watchView.evaluate(async (view) => {
    view.activePlaybackEngine = 'yt-dlp'
    view.streamErrorReloadAttemptedForCurrentVideo = false
    view.extractYtDlpPlaybackSource = async () => true
    await view.handlePlayerError({ code: 1003, data: [] })
  })

  await expect(player).toBeVisible()
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(5, 1)
  await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(1.5)
  expect(await video.evaluate(element => element.paused)).toBe(true)
  expect(await watchView.evaluate(view => view.currentVideoQuality)).toBe(activeVideoQualityBeforeReload)

  const playerAfterReload = await player.elementHandle()
  expect(await playerBeforeReload.evaluate(
    (before, after) => before === after,
    playerAfterReload
  )).toBe(false)
  expect(await watchView.evaluate(view => ({
    videoLoadGeneration: view.videoLoadGeneration,
    videoTitle: view.videoTitle,
    videoDescription: view.videoDescription,
    channelName: view.channelName,
    recommendedVideos: view.recommendedVideos
  }))).toEqual(stateBeforeReload)
})

test('expired built-in playback source is not restored after yt-dlp fails', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  const result = await page.evaluate(async () => {
    const app = document.querySelector('#app')?.__vue_app__

    const findWatchView = (vnode) => {
      if (vnode?.component?.type?.name === 'Watch') return vnode.component.proxy
      if (vnode?.component?.subTree) {
        const match = findWatchView(vnode.component.subTree)
        if (match) return match
      }
      if (Array.isArray(vnode?.children)) {
        for (const child of vnode.children) {
          const match = findWatchView(child)
          if (match) return match
        }
      }
      return null
    }

    const watchView = findWatchView(app?._container?._vnode)
    if (!watchView) throw new Error('Unable to access the watch view')

    watchView.errorMessage = ''
    watchView.isPostLiveDvr = false
    watchView.activePlaybackEngine = 'yt-dlp'
    watchView.playbackEngineFallbackTarget = null
    watchView.manifestSrc = 'https://example.invalid/yt-dlp.mpd'
    watchView.builtInPlaybackSource = {
      manifestSrc: 'https://example.invalid/expired.mpd',
      manifestMimeType: 'application/dash+xml',
      sabrData: null,
      legacyFormats: [],
      streamingDataExpiryDate: new Date(Date.now() - 1)
    }

    let reloads = 0
    watchView.reloadView = async () => { reloads++ }

    const fallbackApplied = await watchView.tryPlaybackEngineFallback({
      code: 1002,
      data: ['https://example.invalid/video', 500]
    })

    return {
      fallbackApplied,
      reloads,
      pending: watchView.ytDlpStreamsPending,
      fallbackTarget: watchView.playbackEngineFallbackTarget,
      activePlaybackEngine: watchView.activePlaybackEngine,
      manifestSrc: watchView.manifestSrc
    }
  })

  expect(result).toEqual({
    fallbackApplied: false,
    reloads: 0,
    pending: false,
    fallbackTarget: null,
    activePlaybackEngine: 'yt-dlp',
    manifestSrc: 'https://example.invalid/yt-dlp.mpd'
  })
})

test('a SABR reload preserves the active video quality', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  const quality = await page.evaluate(async () => {
    const app = document.querySelector('#app')?.__vue_app__

    const findWatchView = (vnode) => {
      if (vnode?.component?.type?.name === 'Watch') {
        return vnode.component.proxy
      }
      if (vnode?.component?.subTree) {
        const match = findWatchView(vnode.component.subTree)
        if (match) return match
      }
      if (Array.isArray(vnode?.children)) {
        for (const child of vnode.children) {
          const match = findWatchView(child)
          if (match) return match
        }
      }
      return null
    }

    const watchView = findWatchView(app?._container?._vnode)
    if (!watchView) {
      throw new Error('Unable to access the watch view')
    }

    watchView.currentVideoQuality = '360'
    watchView.getTimestamp = () => 0
    watchView.reloadView = async () => {}
    watchView.showTabToast = () => {}

    await watchView.performSabrReload({ videoQuality: '720' }, 'Synthetic SABR reload')

    // Metadata loading normally resets this to the configured default before
    // initializeVideoQuality restores the state captured from the old player.
    watchView.currentVideoQuality = '360'
    watchView.initializeVideoQuality()

    return watchView.currentVideoQuality
  })

  expect(quality).toBe('720')
})

test('sizes the fullscreen playback-error reload toast to its content', async ({ app, page }) => {
  await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setPlayerFullscreen(page, true)

  const watchView = await watchViewHandle(page)
  await watchView.evaluate(async (view) => {
    view.getTimestamp = () => 0
    view.reloadView = async () => {}
    view.tryPlaybackEngineFallback = async () => false
    view.errorMessage = ''
    view.isLoading = false
    view.isLive = false
    view.isPostLiveDvr = false
    view.activeFormat = 'dash'
    view.manifestMimeType = 'application/sabr+json'

    await view.handlePlayerError({
      severity: 2,
      category: 1,
      code: 1002,
      data: ['https://example.invalid/sabr', 500]
    })
  })

  const toast = page.locator('.toast', { hasText: 'Refreshing SABR stream after playback error' })
  await expect(toast).toBeVisible()
  await expect(toast).toHaveCount(1)
  await expect(toast.locator('..')).toHaveCSS('transform', 'none')

  const { trailingSpace, paddingEnd } = await toast.evaluate((element) => {
    const toastBounds = element.getBoundingClientRect()
    const messageBounds = element.querySelector('.message').getBoundingClientRect()

    return {
      trailingSpace: toastBounds.right - messageBounds.right,
      paddingEnd: Number.parseFloat(getComputedStyle(element).paddingInlineEnd)
    }
  })

  expect(Math.abs(trailingSpace - paddingEnd)).toBeLessThanOrEqual(1)
})

test('a SABR reload preserves the tab title while adding its resume timestamp', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  const titles = await page.evaluate(async () => {
    const app = document.querySelector('#app')?.__vue_app__

    const findWatchView = (vnode) => {
      if (vnode?.component?.type?.name === 'Watch') {
        return vnode.component.proxy
      }
      if (vnode?.component?.subTree) {
        const match = findWatchView(vnode.component.subTree)
        if (match) return match
      }
      if (Array.isArray(vnode?.children)) {
        for (const child of vnode.children) {
          const match = findWatchView(child)
          if (match) return match
        }
      }
      return null
    }

    const watchView = findWatchView(app?._container?._vnode)
    if (!watchView) {
      throw new Error('Unable to access the watch view')
    }

    watchView.getTimestamp = () => 42
    watchView.reloadView = async () => {}
    watchView.showTabToast = () => {}

    const titleBeforeReload = watchView.$store.getters.getTabById(watchView.tabId).contentTitle
    const publishedTitles = []
    const unsubscribe = watchView.$store.subscribe((mutation) => {
      if (mutation.type === 'setTabContentTitle' && mutation.payload.tabId === watchView.tabId) {
        publishedTitles.push(mutation.payload.title)
      }
    })

    try {
      await watchView.performSabrReload({}, 'Synthetic SABR reload')
    } finally {
      unsubscribe()
    }

    return { titleBeforeReload, publishedTitles }
  })

  expect(titles.publishedTitles).toEqual([titles.titleBeforeReload])
  await expect(page).toHaveURL(/oneTimeTimestamp=42/)
  await expect(page).toHaveTitle(`${titles.titleBeforeReload} - OpenTubeX`)
})

test('pausing keeps a SABR replacement paused when autoplay is enabled', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  const watchView = await watchViewHandle(page)

  await watchView.evaluate(view => {
    view.$store.commit('setAutoplayVideos', true)
    view.getTimestamp = () => 0

    const reloadView = view.reloadView.bind(view)
    let releaseReload
    const reloadGate = new Promise(resolve => {
      releaseReload = resolve
    })

    view.reloadView = async options => {
      await reloadGate
      return reloadView(options)
    }
    window.__releaseSabrReload = releaseReload
    window.__sabrReloadFinished = view.performSabrReload(
      { wasPlaying: true },
      'Synthetic SABR reload'
    )
  })

  await expect.poll(() => watchView.evaluate(view => view.resumePlaybackAfterSabrReload)).toBe(true)
  await video.evaluate(element => element.pause())
  await expect.poll(() => watchView.evaluate(view => view.resumePlaybackAfterSabrReload)).toBe(false)
  await page.evaluate(() => {
    window.__sabrReplacementPlayEvents = []
    document.addEventListener('play', event => {
      if (event.target instanceof HTMLVideoElement) {
        window.__sabrReplacementPlayEvents.push(event.target.currentTime)
      }
    }, true)
  })

  await app.electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].emit('blur')
  })
  await page.evaluate(() => window.__releaseSabrReload())
  await page.evaluate(() => window.__sabrReloadFinished)

  const replacementVideo = page.locator('.tabContent[aria-hidden="false"] video')
  await expect(replacementVideo).toHaveCount(1, { timeout: 30_000 })
  await expect.poll(() => replacementVideo.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2)
  await page.waitForTimeout(1000)

  expect(await page.evaluate(() => window.__sabrReplacementPlayEvents)).toEqual([])
  expect(await replacementVideo.evaluate(element => element.paused)).toBe(true)
})

test('a second SABR failure after successful playback refetches instead of dropping to legacy', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  const result = await driveWatchView(page, [
    { error: true },
    // The refreshed stream plays well past the settle threshold.
    { playFor: 60 },
    // An unrelated failure much later in the same video.
    { error: true }
  ])

  expect(result.reloads).toEqual([
    'Refreshing SABR stream after playback error',
    'Refreshing SABR stream after playback error'
  ])
  expect(result.finalFormat).toBe('dash')
})

test('SABR failures that never settle fall back to legacy but never audio', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  // Four back-to-back failures with no playback progress in between.
  const result = await driveWatchView(page, [
    { error: true },
    { error: true },
    { error: true },
    { error: true },
    { error: true }
  ])

  expect(result.reloads).toHaveLength(MAX_SABR_ERROR_RECOVERIES)
  expect(result.formats).toEqual(['dash', 'dash', 'dash', 'legacy', 'legacy'])
  expect(result.errorMessage).toContain('Unable to recover the video stream')
})

test('repeated SABR reload requests stop instead of reloading the tab forever', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  const result = await driveWatchView(page, [
    { reloadRequest: true },
    { reloadRequest: true },
    { reloadRequest: true },
    { reloadRequest: true }
  ])

  expect(result.reloads).toHaveLength(MAX_SABR_ERROR_RECOVERIES)
  expect(result.formats).toEqual(['dash', 'dash', 'dash', 'legacy'])
  expect(result.finalFormat).toBe('legacy')
})

test('repeated SABR reload requests never fall back to audio', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  const result = await driveWatchView(page, [
    { reloadRequest: true },
    { reloadRequest: true },
    { reloadRequest: true },
    { reloadRequest: true }
  ], { legacyFormats: [] })

  expect(result.reloads).toHaveLength(MAX_SABR_ERROR_RECOVERIES)
  expect(result.finalFormat).toBe('dash')
  expect(result.errorMessage).toContain('Unable to recover the video stream')
})

test('a SABR failure refetches when no 360p fallback is available', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  const result = await driveWatchView(page, [{ error: true }], { legacyFormats: [] })

  expect(result.reloads).toEqual(['Refreshing SABR stream after playback error'])
  expect(result.finalFormat).toBe('dash')
})

test('repeated SABR failures without a legacy fallback never switch to audio', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  const result = await driveWatchView(page, [
    { error: true },
    { error: true },
    { error: true },
    { error: true }
  ], { legacyFormats: [] })

  expect(result.reloads).toHaveLength(MAX_SABR_ERROR_RECOVERIES)
  expect(result.formats).toEqual(['dash', 'dash', 'dash', 'dash'])
  expect(result.finalFormat).toBe('dash')
  expect(result.errorMessage).toContain('Unable to recover the video stream')

  const errorPlayer = page.locator('.videoPlayerError')
  await expect(errorPlayer).toBeVisible()
  await expect(errorPlayer.locator('.videoThumbnail')).toHaveAttribute('src', /\S+/)

  const [playerBounds, infoBounds] = await Promise.all([
    errorPlayer.boundingBox(),
    page.locator('.infoArea').boundingBox()
  ])
  expect(playerBounds.width / playerBounds.height).toBeCloseTo(16 / 9, 1)
  expect(infoBounds.y).toBeGreaterThanOrEqual(playerBounds.y + playerBounds.height)
})

test('an error from the outgoing player is ignored while the view reloads', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  const result = await driveWatchView(page, [{ error: true }], { isLoading: true, legacyFormats: [] })

  expect(result.reloads).toHaveLength(0)
  expect(result.finalFormat).toBe('dash')
  expect(result.errorMessage).toBe('')
})

test('a loaded event from the outgoing player is ignored while the view reloads', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  const watchView = await watchViewHandle(page)
  const result = await watchView.evaluate(async (view) => {
    let historyCalls = 0
    let playlistCalls = 0
    let localPlaylistCalls = 0
    let timestampCalls = 0
    let stateDuringPreparation = null

    view.isLoading = false
    view.videoPlayerLoaded = false
    view.isUpcoming = false
    view.rememberHistory = true
    view.oneTimeTimestamp = 73
    view.sabrReloadCaptionIndex = 2
    view.sabrReloadPlaybackRate = 1.5
    view.addToHistory = () => { historyCalls++ }
    view.handlePlaylistPersisting = () => { playlistCalls++ }
    view.updateLocalPlaylistLastPlayedAtSometimes = () => { localPlaylistCalls++ }
    view.consumeTimestamp = async () => { timestampCalls++ }
    view.getVideoInformationLocal = async () => {}
    view.handleRouteChange = async () => {
      await Promise.resolve()
      await view.handleVideoLoaded({})
      stateDuringPreparation = {
        oneTimeTimestamp: view.oneTimeTimestamp,
        sabrReloadCaptionIndex: view.sabrReloadCaptionIndex,
        sabrReloadPlaybackRate: view.sabrReloadPlaybackRate,
        videoPlayerLoaded: view.videoPlayerLoaded,
        historyCalls,
        playlistCalls,
        localPlaylistCalls,
        timestampCalls
      }
    }

    await view.reloadView()
    return stateDuringPreparation
  })

  expect(result).toEqual({
    oneTimeTimestamp: 73,
    sabrReloadCaptionIndex: 2,
    sabrReloadPlaybackRate: 1.5,
    videoPlayerLoaded: false,
    historyCalls: 0,
    playlistCalls: 0,
    localPlaylistCalls: 0,
    timestampCalls: 0
  })
})

test('a SABR reload request from the outgoing player is ignored', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  const result = await driveWatchView(page, [{ reloadRequest: true }], { isLoading: true, legacyFormats: [] })

  expect(result.reloads).toHaveLength(0)
  expect(result.finalFormat).toBe('dash')
  expect(result.errorMessage).toBe('')
})

test('a rejected SABR reload request reports terminal recovery', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  const result = await driveWatchView(page, [{ reloadRequest: true }], {
    legacyFormats: [],
    rejectReload: true
  })

  expect(result.reloads).toEqual(['Reloading player according to SABR request'])
  expect(result.finalFormat).toBe('dash')
  expect(result.errorMessage).toContain('Unable to recover the video stream')
})

test('seeking around a stream that never plays does not refill the budget', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  // Each failure is followed by a long seek rather than real playback, so the
  // budget must still run out instead of being topped up by the position jump.
  const result = await driveWatchView(page, [
    { error: true },
    { seekTo: 300 },
    { error: true },
    { seekTo: 900 },
    { error: true },
    { seekTo: 60 },
    { error: true }
  ])

  expect(result.reloads).toHaveLength(MAX_SABR_ERROR_RECOVERIES)
  expect(result.finalFormat).toBe('legacy')
})

test('a video that keeps breaking after settling still stops reloading eventually', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  // Every failure is followed by enough real playback to refill the per-incident
  // budget, so without a hard per-video ceiling this reloads for ever. That is
  // what turned an unrecoverable stream into an unwatchable reload loop rather
  // than letting it settle on a format that plays.
  const script = []
  for (let i = 0; i < 12; i++) {
    script.push({ error: true }, { playFor: 60 })
  }

  const result = await driveWatchView(page, script)

  // Exactly the documented per-video ceiling: every failure up to it recovers,
  // and the ones after it fall back instead of reloading again.
  expect(result.reloads).toHaveLength(MAX_SABR_ERROR_RECOVERIES_PER_VIDEO)
  expect(result.finalFormat).toBe('legacy')
})
