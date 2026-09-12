import crypto from 'node:crypto'
import { abortUnmockedRequest, sel, setPlayerFullscreen, setWindowSize, test, expect } from '../../helpers/app.mjs'
import { activeTab, findWatchComponent, openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'
import {
  DEMO_MEDIA_URL,
  POST_LIVE_AUDIO_URL,
  POST_LIVE_VIDEO_URL,
  demoPlayerResponse,
  routePostLiveMedia
} from '../../helpers/media.mjs'
import { fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

// These used to live in the network suite, gated on the live API. They all use
// "Me at the zoo", whose page and comment pages are recorded, so they run
// against the mocked watch page and the local demo video instead. See
// e2e/README.md, "Playing a video without YouTube".

// yt-dlp isn't installed in the test environment, so its extraction attempt
// only costs time and leaves a fallback toast over the page. The migration
// marker stops the store from switching the engine back on launch.
const WATCH_PAGE_SEED = {
  videoPlaybackEngine: 'built-in',
  ytDlpPlaybackEngineDefaultMigration: true
}

async function scrollPlayerMenuToBottom(menu) {
  await menu.evaluate((element) => {
    element.style.blockSize = '180px'
    element.style.maxBlockSize = '180px'
    element.style.gridTemplateColumns = '1fr'
    element.scrollTop = element.scrollHeight
  })
  await expect.poll(() => menu.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
}

async function expectPlayerMenuScrollState(menu, atEnd = true) {
  await expect.poll(() => menu.evaluate((element, expectAtEnd) => {
    const visibleButtons = [...element.children].filter(child => (
      child instanceof HTMLButtonElement && !child.classList.contains('shaka-hidden')
    ))
    const contentEnd = visibleButtons.at(-1)
    const viewportBounds = element.getBoundingClientRect()
    const contentEndBounds = contentEnd.getBoundingClientRect()
    const maximumScrollTop = Math.max(
      0,
      element.scrollTop + contentEndBounds.bottom - viewportBounds.bottom +
        Number.parseFloat(getComputedStyle(contentEnd).marginBlockEnd) +
        Number.parseFloat(getComputedStyle(element).paddingBottom)
    )
    const hasVerticalOverflow = maximumScrollTop > 1
    const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
    return {
      scrollPositionValid: expectAtEnd
        ? Math.abs(element.scrollTop - maximumScrollTop) <= 1
        : element.scrollTop <= maximumScrollTop + 1,
      scrollbarMatchesOverflow:
        scrollbar?.classList.contains('os-scrollbar-visible') === hasVerticalOverflow,
    }
  }, atEnd)).toEqual({ scrollPositionValid: true, scrollbarMatchesOverflow: true })
}

async function expectSponsorBlockContentClamp(content, previousScrollTop) {
  await expect.poll(() => content.evaluate((element, previousScrollTop) => {
    const viewportBounds = element.getBoundingClientRect()
    const contentEndBounds = element.querySelector('.sponsorBlockFooter').getBoundingClientRect()
    const maximumScrollTop = Math.max(
      0,
      element.scrollTop + contentEndBounds.bottom - viewportBounds.bottom
    )
    const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
    const hasVerticalOverflow = maximumScrollTop > 1
    return {
      scrollTopReduced: element.scrollTop < previousScrollTop,
      withinRenderedRange: element.scrollTop <= maximumScrollTop + 1,
      scrollbarMatchesOverflow:
        scrollbar?.classList.contains('os-scrollbar-visible') === hasVerticalOverflow
    }
  }, previousScrollTop)).toEqual({
    scrollTopReduced: true,
    withinRenderedRange: true,
    scrollbarMatchesOverflow: true
  })
}

test.use({ seed: { settings: WATCH_PAGE_SEED } })

async function swipeVertically(session, bounds, distance) {
  const x = bounds.x + bounds.width / 2
  const y = bounds.y + bounds.height / 2
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ x, y }]
  })
  for (let step = 1; step <= 10; step++) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x, y: y + distance * step / 10 }]
    })
  }
  // Hold before releasing so momentum cannot race the next boundary check.
  await new Promise(resolve => setTimeout(resolve, 200))
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

for (const zoom of [1, 1.25]) {
  for (const chapterCount of [1, 30]) {
    test(`touch scrolling chains from sidebar chapters to the page (${chapterCount} chapters, ${zoom} scale)`, async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      await page.locator(`${activeTab} .ftVideoPlayer video`).evaluate(video => video.pause())
      await setWindowSize(app, page, { width: 800, height: 850 })
      await page.evaluate(zoom => window.ftElectron.setZoomFactor(zoom), zoom)
      const session = await page.context().newCDPSession(page)
      const view = await watchViewHandle(page)
      await view.evaluate(async (view, count) => {
        view.videoChapters = Array.from({ length: count }, (_, index) => ({
          title: `Test chapter ${index + 1}`,
          timestamp: `${index}:00`,
          startSeconds: index * 60
        }))
        view.videoCurrentChapterIndex = count - 1
        view.showSidebarChapters = true
        await view.$nextTick()
      }, chapterCount)
      const panel = page.locator(`${activeTab} .watchVideoChaptersPanel`)
      const chapters = panel.locator('.chaptersWrapper')
      await expect(panel).toBeVisible()
      await expect(panel).not.toHaveClass(/chapters-panel-enter-active/)
      await expect(chapters).toHaveCSS('overscroll-behavior-y', 'contain')
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
      await expect.poll(() => page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
      await expect(chapters).toHaveCSS('overscroll-behavior-y', 'auto')
      await chapters.evaluate(element => {
        element.scrollIntoView({ block: 'center' })
        element.scrollTop = element.scrollHeight
      })
      await expect.poll(() => chapters.evaluate(element =>
        Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop)
      )).toBeLessThanOrEqual(1)
      const initialPageScroll = await page.evaluate(() => window.scrollY)
      expect(await page.evaluate(() =>
        document.scrollingElement.scrollHeight - innerHeight - scrollY
      )).toBeGreaterThan(100)
      const bounds = await chapters.boundingBox()
      await swipeVertically(session, bounds, -150)
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(initialPageScroll + 50)

      await chapters.evaluate(element => {
        element.scrollIntoView({ block: 'center' })
        element.scrollTop = 0
      })
      const pageScrollAtTop = await page.evaluate(() => window.scrollY)
      expect(pageScrollAtTop).toBeGreaterThan(100)
      const topBounds = await chapters.boundingBox()
      await swipeVertically(session, topBounds, 150)
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(pageScrollAtTop - 50)
      await session.detach()
      await view.dispose()
    })
  }
}

test('reserves the player height when Shaka loads before video metadata', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))

  let releaseMedia
  const mediaPending = new Promise(resolve => { releaseMedia = resolve })
  await page.route(/googlevideo\.com\/videoplayback/, async route => {
    await mediaPending
    await route.fallback()
  })

  await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)

  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  await expect(player).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => {
    return await player.evaluate(element => {
      const video = element.querySelector('video')
      const bounds = element.getBoundingClientRect()
      return {
        hasReservedRatio: element.classList.contains('sixteenByNine'),
        metadataPending: video?.videoWidth === 0,
        geometryReserved: Math.abs(bounds.height - bounds.width * 9 / 16) <= 1,
      }
    })
  }).toEqual({
    hasReservedRatio: true,
    metadataPending: true,
    geometryReserved: true,
  })
  const pendingBounds = await player.boundingBox()
  expect(Math.abs(pendingBounds.height - pendingBounds.width * 9 / 16)).toBeLessThanOrEqual(1)

  const watchComponent = await page.evaluateHandle(findWatchComponent)
  await watchComponent.evaluate(async component => {
    component.refs.player.hasLoaded = true
    await new Promise(resolve => requestAnimationFrame(resolve))
  })
  await expect(player).toHaveClass(/sixteenByNine/)
  const shakaLoadedBounds = await player.boundingBox()
  expect(Math.abs(shakaLoadedBounds.height - pendingBounds.height)).toBeLessThanOrEqual(1)

  await player.evaluate(element => {
    window.__playerLoadingHeights = []
    const recordHeight = () => {
      window.__playerLoadingHeights.push(element.getBoundingClientRect().height)
    }
    window.__playerLoadingHeightObserver = new ResizeObserver(recordHeight)
    window.__playerLoadingHeightObserver.observe(element)
    recordHeight()
  })
  releaseMedia()
  await waitForPlayback(page)
  const loadingHeights = await player.evaluate((element) => {
    window.__playerLoadingHeightObserver.disconnect()
    return window.__playerLoadingHeights.filter(height => height > 0)
  })
  const maximumLoadingHeightChange = Math.max(...loadingHeights
    .map(height => Math.abs(height - pendingBounds.height)))
  expect(maximumLoadingHeightChange).toBeLessThanOrEqual(1)
  await expect.poll(async () => {
    const loadedBounds = await player.boundingBox()
    return Math.abs(loadedBounds.height - pendingBounds.height)
  }).toBeLessThanOrEqual(1)
})

test('keeps metadata errors visible in family-friendly-only mode', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await app.electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('generate-po-token')
    ipcMain.handle('generate-po-token', () => {
      throw new Error('VM operation timed out')
    })
  })
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateShowFamilyFriendlyOnly', true)
  })

  await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=4FEzLc7iBY0')
  await page.locator(sel.searchInput).press('Enter')

  await expect(page).toHaveURL(/#\/watch\/4FEzLc7iBY0/)
  await expect(page.locator('.errorMessage')).toContainText('VM operation timed out')
  await expect(page.locator('.infoArea .ageRestrictedBadge')).toHaveCount(0)
})

test('offers a YouTube link action in the watch tab context menu', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)

  await page.locator('.tab.active').click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Copy YouTube Link', exact: true })).toBeVisible()
})

test('uses the stored watch route for a dev-server tab link action', async ({ app, page }) => {
  const watchTab = await page.evaluate(() => window.ftElectron.tabs.create({
    url: 'http://localhost:9080/#/watch/jNQXAC9IVRw',
    title: 'Dev watch tab',
    makeActive: false,
    lazyLoad: true
  }))

  await expect.poll(async () => {
    const state = await page.evaluate(() => window.ftElectron.tabs.getState())
    return state.tabs.find(tab => tab.id === watchTab.id)?.route.fullPath
  }).toBe('/watch/jNQXAC9IVRw')
  await page.locator(`.tab[data-tab-id="${watchTab.id}"]`).click({ button: 'right' })
  const copyYouTubeLink = page.getByRole('menuitem', { name: 'Copy YouTube Link', exact: true })
  await expect(copyYouTubeLink).toBeVisible()
  await copyYouTubeLink.click()
  await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe('https://youtu.be/jNQXAC9IVRw')
})

test('shows age-restricted and unlisted badges below the video title', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.route(/\/youtubei\/v1\/player/, (route, request) => {
    const videoId = JSON.parse(request.postData() ?? '{}').videoId ?? 'jNQXAC9IVRw'
    const response = demoPlayerResponse(videoId)
    response.microformat.playerMicroformatRenderer.isFamilySafe = false
    response.microformat.playerMicroformatRenderer.isUnlisted = true
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response)
    })
  })

  await openMockedVideo(page)

  const videoInfo = page.locator('.infoArea .watchVideoInfo')
  const ageRestrictedBadge = videoInfo.locator('.ageRestrictedBadge')
  const unlistedBadge = videoInfo.locator('.unlistedBadge')
  await expect(videoInfo.locator('.videoBadges')).toHaveCount(1)
  await expect(ageRestrictedBadge).toHaveText('Age restricted')
  await expect(ageRestrictedBadge.locator('[data-icon="user-lock"]')).toBeVisible()
  await expect(unlistedBadge).toHaveText('Unlisted')
  await expect(unlistedBadge.locator('[data-icon="eye-slash"]')).toBeVisible()

  const [badgeBounds, titleBounds] = await Promise.all([
    ageRestrictedBadge.boundingBox(),
    videoInfo.locator('.videoTitle').boundingBox()
  ])
  expect(badgeBounds).not.toBeNull()
  expect(titleBounds).not.toBeNull()
  expect(badgeBounds.y).toBeGreaterThanOrEqual(titleBounds.y + titleBounds.height)
})

async function mockMusicMediaType(app, page, musicVideoType) {
  await mockPlayableWatchPage(app, page)
  await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
  await page.route(/\/youtubei\/v1\/player/, (route, request) => {
    const requestBody = JSON.parse(request.postData() ?? '{}')
    const videoId = requestBody.videoId ?? 'jNQXAC9IVRw'
    const response = demoPlayerResponse(videoId)
    response.microformat.playerMicroformatRenderer.category = 'Music'
    if (requestBody.context?.client?.clientName === 'WEB_REMIX' && musicVideoType !== undefined) {
      response.videoDetails.musicVideoType = musicVideoType
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response)
    })
  })
}

async function countDistinctVisualizerFrames(canvas) {
  return canvas.evaluate(async (element) => {
    const signatures = new Set()
    for (let sample = 0; sample < 5; sample++) {
      await new Promise(resolve => setTimeout(resolve, 80))
      const data = element.getContext('2d').getImageData(0, 0, element.width, element.height).data
      let signature = 0
      for (let index = 3; index < data.length; index += 4) {
        signature = (signature + data[index] * index) >>> 0
      }
      signatures.add(signature)
    }
    return signatures.size
  })
}

test('shows the audio-track player and custom visualizer for YouTube Music tracks', async ({ app, page, attachScreenshot }) => {
  await mockMusicMediaType(app, page, 'MUSIC_VIDEO_TYPE_ATV')
  await page.evaluate(async () => {
    const NativeAudioContext = window.AudioContext
    window.__musicVisualizerTestAudioContexts = []
    window.__musicVisualizerTestCapturedStreams = []
    window.AudioContext = new Proxy(NativeAudioContext, {
      construct(Target, args) {
        const context = Reflect.construct(Target, args)
        const createAnalyser = context.createAnalyser.bind(context)
        context.createAnalyser = (...analyserArgs) => {
          const analyser = createAnalyser(...analyserArgs)
          const readFrequencyData = analyser.getByteFrequencyData.bind(analyser)
          let frame = 0
          analyser.getByteFrequencyData = (data) => {
            readFrequencyData(data)
            if (context.state === 'running') {
              data.fill(32 + (frame++ * 37) % 192)
            }
          }
          return analyser
        }
        window.__musicVisualizerTestAudioContexts.push(context)
        return context
      }
    })

    const captureStream = HTMLMediaElement.prototype.captureStream
    HTMLMediaElement.prototype.captureStream = function (...args) {
      const sourceStream = captureStream.apply(this, args)
      let capturedStream = sourceStream
      if (window.__musicVisualizerTestCapturedStreams.length === 0) {
        window.__musicVisualizerTestReplacementTrack = sourceStream.getAudioTracks()[0].clone()
      } else {
        capturedStream = new MediaStream(sourceStream.getVideoTracks())
        setTimeout(() => {
          const track = window.__musicVisualizerTestReplacementTrack
          capturedStream.addTrack(track)
          capturedStream.dispatchEvent(new MediaStreamTrackEvent('addtrack', { track }))
        }, 100)
      }
      window.__musicVisualizerTestCapturedStreams.push(capturedStream)
      return capturedStream
    }

    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await Promise.all([
      store.dispatch('updateReducedMotion', 'off'),
      store.dispatch('updateUiScale', 125),
    ])
  })

  const video = await openMockedVideo(page)
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  const surface = player.locator('.musicAudioSurface')
  const canvas = surface.locator('.musicVisualizerCanvas')

  await expect(player).toHaveClass(/musicAudioPlayer/)
  await expect(surface).toBeVisible()
  await expect(surface.locator('.musicAudioArtwork')).toBeVisible()
  await expect(surface.locator('.musicAudioTitle')).toHaveText(/\S/)
  await expect(surface.locator('.musicAudioArtist')).toHaveText(/\S/)
  await expect(video).toHaveCSS('opacity', '0')
  await expect(canvas).toBeVisible()

  const artwork = surface.locator('.musicAudioArtwork')
  const artworkSrc = await artwork.getAttribute('src')
  await artwork.dispatchEvent('error')
  await expect(artwork).toBeHidden()
  await artwork.evaluate((element) => {
    element.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/%3E'
  })
  await expect(artwork).toBeVisible()
  await artwork.evaluate((element, src) => { element.src = src }, artworkSrc)
  await expect.poll(() => artwork.evaluate(element => element.naturalWidth)).toBeGreaterThan(0)

  await player.getByRole('button', { name: 'More settings' }).click({ force: true })
  const visualizerToggle = player.getByRole('button', { name: 'Music visualizer', exact: true })
  await expect(visualizerToggle).toBeVisible()
  await expect(visualizerToggle).toHaveAttribute('aria-pressed', 'true')
  await visualizerToggle.click()
  await expect(visualizerToggle).toHaveAttribute('aria-pressed', 'false')
  await expect(canvas).toBeHidden()
  await visualizerToggle.click()
  await expect(visualizerToggle).toHaveAttribute('aria-pressed', 'true')
  await expect(canvas).toBeVisible()
  await page.keyboard.press('Escape')

  const seekBar = player.locator('.shaka-seek-bar-container')
  await player.hover()
  await seekBar.hover({ position: { x: 120, y: 4 } })
  await expect(player.locator('.shaka-player-ui-thumbnail-image-container')).toBeHidden()
  await expect(player.locator('.shaka-player-ui-thumbnail-time-container')).toBeVisible()

  await expect.poll(() => canvas.evaluate((element) => {
    const context = element.getContext('2d')
    return context && context.getImageData(0, 0, element.width, element.height)
      .data.some((channel, index) => index % 4 === 3 && channel > 0)
  }), { timeout: 10_000 }).toBe(true)
  await expect.poll(() => countDistinctVisualizerFrames(canvas)).toBeGreaterThan(1)

  const playbackTimeBeforeSuspension = await video.evaluate(element => element.currentTime)
  await page.evaluate(async () => {
    await window.__musicVisualizerTestAudioContexts.at(-1).suspend()
  })
  await expect.poll(() => page.evaluate(() => (
    window.__musicVisualizerTestAudioContexts.at(-1).state
  )), {
    timeout: 5_000,
    message: 'visualizer should recover when its audio context is suspended while media keeps playing'
  }).toBe('running')
  await expect.poll(() => video.evaluate(element => element.currentTime))
    .toBeGreaterThan(playbackTimeBeforeSuspension)
  await expect.poll(() => countDistinctVisualizerFrames(canvas)).toBeGreaterThan(1)

  const audioContextCount = await page.evaluate(() => (
    window.__musicVisualizerTestAudioContexts.length
  ))
  const capturedStreamCount = await page.evaluate(() => (
    window.__musicVisualizerTestCapturedStreams.length
  ))
  await expect.poll(() => page.evaluate(() => (
    window.__musicVisualizerTestCapturedStreams.at(-1).getAudioTracks().length
  ))).toBeGreaterThan(0)
  await page.evaluate(() => {
    const track = window.__musicVisualizerTestCapturedStreams.at(-1).getAudioTracks()[0]
    track.stop()
    track.dispatchEvent(new Event('ended'))
  })
  await expect.poll(() => page.evaluate(() => (
    window.__musicVisualizerTestCapturedStreams.length
  )), {
    message: 'visualizer should capture the media element again after its audio track ends'
  }).toBeGreaterThan(capturedStreamCount)
  await expect.poll(() => page.evaluate(() => (
    window.__musicVisualizerTestAudioContexts.length
  )), {
    message: 'visualizer should rebuild after its captured audio track ends'
  }).toBeGreaterThan(audioContextCount)
  await expect.poll(() => countDistinctVisualizerFrames(canvas)).toBeGreaterThan(1)

  await attachScreenshot('YouTube Music audio-track player')

  const [playerBounds, artworkBounds] = await Promise.all([
    player.boundingBox(),
    surface.locator('.musicAudioArtwork').boundingBox(),
  ])
  expect(playerBounds).not.toBeNull()
  expect(artworkBounds).not.toBeNull()
  expect(artworkBounds.x).toBeGreaterThanOrEqual(playerBounds.x)
  expect(artworkBounds.y).toBeGreaterThanOrEqual(playerBounds.y)
  expect(artworkBounds.x + artworkBounds.width)
    .toBeLessThanOrEqual(playerBounds.x + playerBounds.width)
  expect(artworkBounds.y + artworkBounds.height)
    .toBeLessThanOrEqual(playerBounds.y + playerBounds.height)

  await video.evaluate(element => element.pause())
  await expect.poll(() => canvas.evaluate((element) => {
    const context = element.getContext('2d')
    return context && context.getImageData(0, 0, element.width, element.height)
      .data.some((channel, index) => index % 4 === 3 && channel > 0)
  })).toBe(false)

  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateReducedMotion', 'on')
  })
  await video.evaluate(element => element.play())
  await expect(canvas).toBeHidden()
})

for (const { label, musicVideoType } of [
  { label: 'official music videos', musicVideoType: 'MUSIC_VIDEO_TYPE_OMV' },
  { label: 'Music category videos without a YouTube Music type', musicVideoType: undefined },
]) {
  test(`keeps ${label} in the video player`, async ({ app, page }) => {
    await mockMusicMediaType(app, page, musicVideoType)
    const video = await openMockedVideo(page)
    const player = page.locator(`${activeTab} .ftVideoPlayer`)

    await expect(player).not.toHaveClass(/musicAudioPlayer/)
    await expect(player.locator('.musicAudioSurface')).toHaveCount(0)
    await expect(video).toHaveCSS('opacity', '1')
  })
}

test('detects Invidious audio tracks from artist topic channels', async ({ page }) => {
  const instanceUrl = 'https://invidious.test'
  await page.route(/^https?:\/\//, abortUnmockedRequest)
  await routePostLiveMedia(page)
  await page.route(`${instanceUrl}/api/v1/videos/**`, route => route.fulfill({
    json: {
      title: 'Invidious audio track',
      viewCount: 1,
      paid: false,
      subCountText: '1',
      likeCount: 1,
      dislikeCount: 0,
      genre: 'Music',
      keywords: [],
      author: 'Example Artist - Topic',
      authorId: 'UC-example-artist-topic',
      authorThumbnails: [],
      description: '',
      descriptionHtml: '',
      published: 1_700_000_000,
      recommendedVideos: [],
      liveNow: false,
      premiereTimestamp: 0,
      isFamilyFriendly: true,
      isPostLiveDvr: false,
      isListed: true,
      captions: [],
      lengthSeconds: 1,
      formatStreams: [],
      adaptiveFormats: [{
        itag: 140,
        url: `${POST_LIVE_AUDIO_URL}&dur=1`,
        type: 'audio/mp4; codecs="mp4a.40.2"',
        bitrate: '128000',
        init: '0-700',
        index: '701-800',
        audioQuality: 'AUDIO_QUALITY_MEDIUM',
        audioSampleRate: '48000',
        audioChannels: 2,
      }],
      videoThumbnails: [{ url: '/vi/jNQXAC9IVRw/hqdefault.jpg', width: 480, height: 360 }],
    }
  }))
  await page.evaluate(async (url) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await Promise.all([
      store.dispatch('updateBackendPreference', 'invidious'),
      store.dispatch('updateDefaultInvidiousInstance', url),
      store.dispatch('updateHideChapters', true),
    ])
  }, instanceUrl)

  await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.infoArea .videoTitle')).toHaveText('Invidious audio track')
  const watchView = await watchViewHandle(page)
  await expect.poll(() => watchView.evaluate(view => view.musicMediaType)).toBe('audioTrack')
  await watchView.dispose()
})

test('updates boolean settings from the player options', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateShowSkipSilenceButton', true)
  })
  await openMockedVideo(page)

  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  await player.getByRole('button', { name: 'More settings' }).click({ force: true })
  const ambientMode = player.getByRole('button', { name: 'Ambient Mode', exact: true })
  const skipSilence = player.getByRole('button', { name: 'Skip Silence', exact: true })

  await expect(ambientMode).toHaveAttribute('aria-pressed', 'false')
  await ambientMode.click()
  await expect(ambientMode).toHaveAttribute('aria-pressed', 'true')
  await expect(skipSilence).toHaveAttribute('aria-pressed', 'false')
  await skipSilence.click()
  await expect(skipSilence).toHaveAttribute('aria-pressed', 'true')
})

test('marks the chapters player-option tile active while chapters are open', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  await page.locator('.app').evaluate(element => {
    element.classList.add('capacitorTabs', 'capacitorPhoneLayout')
  })

  const watchComponent = await page.evaluateHandle(findWatchComponent)
  await watchComponent.evaluate(async (component) => {
    component.proxy.videoChapters = [{
      title: 'Opening',
      startSeconds: 0,
      endSeconds: 30,
    }]
    await component.proxy.$nextTick()
  })

  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  await player.getByRole('button', { name: 'More settings' }).click({ force: true })
  const chapters = player.locator('.shaka-overflow-menu .ft-chapters-button')
  await expect(chapters).toHaveAttribute('aria-expanded', 'false')
  const closedBackground = await chapters.evaluate(element => getComputedStyle(element).backgroundColor)

  await chapters.click()
  await page.mouse.move(0, 0)
  await expect(chapters).toHaveAttribute('aria-expanded', 'true')
  const openBackground = await chapters.evaluate(element => getComputedStyle(element).backgroundColor)

  expect(openBackground).not.toBe(closedBackground)
  await watchComponent.dispose()
})

test('keeps watch metadata and comment filters inside a narrow viewport', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowWidth(app, 520)

  const videoInfo = page.locator('.infoArea .watchVideoInfo')
  await expect(videoInfo.locator('.videoCategory')).toBeVisible()
  expect(await videoInfo.evaluate(element => element.scrollWidth - element.clientWidth))
    .toBeLessThanOrEqual(1)

  await expect.poll(() => watchViewHandle(page).then(handle => handle.evaluate(view => view.phonePanelsEnabled))).toBe(true)
  await page.locator('.phoneCommentsButton').click()
  const comments = page.locator('.mobileSheet[open]')
  await expect(comments).toBeVisible()
  const loadComments = comments.locator('.getCommentsTitle')
  if (await loadComments.count() > 0) {
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
  }
  await expect(comments.locator('.fullscreenCommentHeader h3')).toBeVisible({ timeout: 30_000 })
  await comments.getByRole('button', { name: 'Filter loaded comments' }).click()

  const menuBounds = await page.getByRole('dialog', { name: 'Comment filters' }).evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return {
      left: bounds.left,
      right: bounds.right,
      viewportLeft: window.visualViewport?.offsetLeft ?? 0,
      viewportRight: (window.visualViewport?.offsetLeft ?? 0) +
        (window.visualViewport?.width ?? window.innerWidth)
    }
  })
  expect(menuBounds.left).toBeGreaterThanOrEqual(menuBounds.viewportLeft)
  expect(menuBounds.right).toBeLessThanOrEqual(menuBounds.viewportRight)
})

test('keeps stacked watch cards separated in the Capacitor phone layout', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowWidth(app, 520)
  await page.locator('.app').evaluate((element) => {
    element.classList.add('capacitorTabs', 'capacitorPhoneLayout')
    element.classList.remove('topTabs', 'bottomTabs', 'verticalTabs')
  })

  const cards = page.locator('.watchVideoInfo:visible, .videoDescription:visible, .watchVideoRecommendations:visible, .commentsArea > .watchVideo:visible')
  await expect(cards).toHaveCount(3)

  const geometry = await cards.evaluateAll((elements) => elements.map((element) => {
    const bounds = element.getBoundingClientRect()
    return {
      bottom: bounds.bottom,
      left: bounds.left,
      right: bounds.right,
      top: bounds.top,
      viewportWidth: window.innerWidth
    }
  }))

  for (const card of geometry) {
    expect(card.left).toBeGreaterThanOrEqual(-1)
    expect(card.right).toBeLessThanOrEqual(card.viewportWidth + 1)
    expect(card.left).toBeLessThanOrEqual(1)
    expect(card.viewportWidth - card.right).toBeLessThanOrEqual(1)
  }

  for (let index = 1; index < geometry.length; index++) {
    expect(geometry[index].top - geometry[index - 1].bottom).toBeGreaterThanOrEqual(12)
  }
})

for (const { name, options, expectedCount } of [
  { name: 'hides transcript actions without captions', options: {}, expectedCount: 0 },
  {
    name: 'shows transcript actions with captions',
    options: { captionCueSettings: 'align:center' },
    expectedCount: 1
  }
]) {
  test(name, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, options)
    await openMockedVideo(page)

    await expect(page.locator('.infoArea .watchVideoInfo')
      .getByRole('button', { name: 'Show transcript' }))
      .toHaveCount(expectedCount)
    await expect(page.locator('.fullscreenActions .fullscreenTranscriptToggle'))
      .toHaveCount(expectedCount)
  })
}

test.describe('watch sidebar panels without recommendations', () => {
  test.use({
    seed: {
      settings: {
        ...WATCH_PAGE_SEED,
        defaultViewingMode: 'theatre',
        hideRecommendedVideos: true
      }
    }
  })

  test('collapses the sidebar after closing the transcript', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { captionCueSettings: 'align:center' })
    await openMockedVideo(page)

    const layout = page.locator(`${activeTab} .videoLayout`)
    await expect(layout).toHaveClass(/noSidebar/)

    await page.getByRole('button', { name: 'Show transcript' }).click()
    await expect(layout).not.toHaveClass(/noSidebar/)
    await page.locator(`${activeTab} .sidebarArea`)
      .getByRole('button', { name: 'Close transcript' })
      .click()

    await expect(layout).toHaveClass(/noSidebar/)
  })
})

test('repeats an A-B range and manages it from the player menu', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  const player = page.locator('.ftVideoPlayer')

  await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))
  await video.evaluate((element) => {
    element.pause()
    element.currentTime = 5.25
  })

  await player.hover()
  await player.getByRole('button', { name: 'More settings' }).click({ force: true })
  await player.getByRole('button', { name: /^Set repeat start/ }).click()

  await expect(player.locator('.abRepeatRange')).toHaveCount(0)
  const abRepeatPopup = player.locator('.valueChangePopup')
  await expect(abRepeatPopup.locator('.valueChangeCustomIcon')).toBeVisible()
  await expect.poll(() => abRepeatPopup.locator(':scope > span:last-child').evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    return [...range.getClientRects()].filter(rect => rect.width > 0).length
  })).toBe(1)
  await expect(player.locator('.abRepeatMarkerA')).toHaveAttribute(
    'aria-label',
    'Adjust point A, currently 0:05.25'
  )

  await player.hover()
  await player.getByRole('button', { name: 'More settings' }).click({ force: true })
  const pendingRangeClearAction = player.getByRole('button', { name: /^Clear A-B repeat range/ })
  await expect(pendingRangeClearAction).toBeVisible()
  await pendingRangeClearAction.click()
  await expect(player.locator('.shaka-overflow-menu:not(.shaka-hidden)')).toBeVisible()
  await expect(player.locator('.abRepeatMarker')).toHaveCount(0)
  await player.getByRole('button', { name: /^Set repeat start/ }).click()

  await video.evaluate((element) => { element.currentTime = 4 })
  await page.keyboard.press('Shift+B')
  await expect(player.locator('.valueChangePopup')).toContainText('Point B must be after point A.')
  await expect(player.locator('.abRepeatMarker')).toHaveCount(1)
  await expect(player.locator('.abRepeatMarkerB')).toHaveCount(0)

  await video.evaluate((element) => { element.currentTime = 6.25 })
  await player.hover()
  await player.getByRole('button', { name: 'More settings' }).click({ force: true })
  await expect(player.getByRole('button', { name: /^Clear A-B repeat range/ })).toBeVisible()
  await expect(player.locator('.ab-repeat-button .shaka-current-selection-span'))
    .toHaveText('A 0:05.25')
  await expect(player.getByRole('button', { name: /^Set repeat end/ })).toBeVisible()
  const overflowMenu = player.locator('.shaka-overflow-menu:not(.shaka-hidden)')
  const loopAction = overflowMenu.locator('.loop-button')
  const abRepeatAction = overflowMenu.locator('.ab-repeat-button')
  await expect(loopAction).toBeVisible()
  await scrollPlayerMenuToBottom(overflowMenu)
  await page.keyboard.press('Shift+B')
  await expect(overflowMenu).toBeVisible()
  await expect(loopAction).not.toBeVisible()
  await expectPlayerMenuScrollState(overflowMenu)

  const [loopIconPath, abRepeatIconPath, clearIconPath, sponsorBlockClearIconPath] = await Promise.all([
    loopAction.locator('svg path').getAttribute('d'),
    abRepeatAction.locator('svg path').getAttribute('d'),
    overflowMenu.locator('.ab-repeat-clear-button svg path').getAttribute('d'),
    player.locator('.sponsorblock-clear-button svg path').getAttribute('d'),
  ])
  expect(abRepeatIconPath).not.toBe(loopIconPath)
  expect(clearIconPath).not.toBe(sponsorBlockClearIconPath)

  await overflowMenu.evaluate((element) => {
    element.style.blockSize = ''
    element.style.maxBlockSize = ''
    element.style.gridTemplateColumns = ''
    element.scrollTop = 0
  })

  await abRepeatAction.click()
  await expect(overflowMenu).toBeVisible()
  await expect(abRepeatAction).toHaveAttribute('aria-pressed', 'false')
  await expect(abRepeatAction).toHaveAccessibleName('Resume A-B repeat')
  await expect(loopAction).not.toBeVisible()

  await abRepeatAction.click()
  await expect(overflowMenu).toBeVisible()
  await expect(abRepeatAction).toHaveAttribute('aria-pressed', 'true')
  await expect(abRepeatAction).toHaveAccessibleName('Pause A-B repeat')
  await expect(loopAction).not.toBeVisible()
  await page.keyboard.press('Escape')

  const markers = player.locator('.abRepeatMarker')
  await expect(markers).toHaveCount(2)
  await expect(player.locator('.abRepeatRange')).toHaveCount(1)
  const seekBar = player.locator('.shaka-seek-bar-container')
  const markerPositions = await markers.evaluateAll((elements) => elements.map(element => {
    const bounds = element.getBoundingClientRect()
    const seekBounds = element.closest('.shaka-seek-bar-container').getBoundingClientRect()
    return (bounds.left + bounds.width / 2 - seekBounds.left) / seekBounds.width
  }))
  expect(markerPositions[0]).toBeCloseTo(5.25 / 30, 2)
  expect(markerPositions[1]).toBeCloseTo(6.25 / 30, 2)
  await expect(seekBar).toBeVisible()

  const endHandle = player.locator('.abRepeatMarkerB')
  const [seekBounds, endHandleBounds] = await Promise.all([
    seekBar.boundingBox(),
    endHandle.boundingBox(),
  ])
  await page.mouse.move(
    endHandleBounds.x + endHandleBounds.width / 2,
    endHandleBounds.y + endHandleBounds.height / 2
  )
  await page.mouse.down()
  const expectedBoundaryTime = 6.5
  await page.mouse.move(
    seekBounds.x + seekBounds.width * (expectedBoundaryTime / 30),
    seekBounds.y + seekBounds.height / 2
  )
  await page.mouse.up()
  await expect(endHandle).toHaveAttribute('aria-label', /Adjust point B, currently 0:06\.5/)

  await video.evaluate((element) => { element.currentTime = 8 })
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(5.25, 2)

  await video.evaluate(async (element) => {
    const currentTime = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')
    Object.defineProperty(element, 'currentTime', {
      configurable: true,
      get: currentTime.get,
      set(value) {
        if (Math.abs(value - 5.25) < 0.001 && currentTime.get.call(this) > 5.25) {
          window.__abRepeatBoundaryTime = currentTime.get.call(this)
        }
        currentTime.set.call(this, value)
      }
    })
    element.currentTime = 5.75
    element.playbackRate = 2
    await element.play()
  })

  await expect.poll(() => page.evaluate(() => window.__abRepeatBoundaryTime ?? null)).not.toBeNull()
  const boundaryTime = await page.evaluate(() => window.__abRepeatBoundaryTime)
  const boundaryTolerance = 0.015
  expect(boundaryTime).toBeGreaterThan(expectedBoundaryTime - boundaryTolerance)
  expect(boundaryTime).toBeLessThan(expectedBoundaryTime + boundaryTolerance)

  await video.evaluate(element => element.pause())
  await player.hover()
  await player.getByRole('button', { name: 'More settings' }).click({ force: true })
  const clearAction = player.getByRole('button', { name: /^Clear A-B repeat range/ })
  await expect(clearAction).toBeVisible()
  const clearMenu = player.locator('.shaka-overflow-menu:not(.shaka-hidden)')
  await scrollPlayerMenuToBottom(clearMenu)
  await page.keyboard.press('Shift+X')
  await expect(player.locator('.shaka-overflow-menu:not(.shaka-hidden)')).toBeVisible()
  await expect(clearAction).not.toBeVisible()
  await expect(player.getByRole('button', { name: /^Set repeat start/ })).toBeVisible()
  await expect(clearMenu.locator('.loop-button')).toBeVisible()
  await expect(player.locator('.abRepeatMarker')).toHaveCount(0)
  await expect(player.locator('.abRepeatRange')).toHaveCount(0)
  await expectPlayerMenuScrollState(clearMenu, false)

  await player.getByRole('button', { name: /^Set repeat start/ }).click()
  await expect(player.locator('.abRepeatMarker')).toHaveCount(1)
  await openMockedVideo(page, 'aqz-KE-bpKQ')
  await expect(player.locator('.abRepeatMarker')).toHaveCount(0)
  await player.hover()
  await player.getByRole('button', { name: 'More settings' }).click({ force: true })
  await expect(player.getByRole('button', { name: /^Set repeat start/ })).toBeVisible()
  await expect(player.getByRole('button', { name: /^Clear A-B repeat range/ })).not.toBeVisible()
})

test('keeps the B repeat marker visible and interactive at the end', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  const player = page.locator('.ftVideoPlayer')

  await video.evaluate((element) => {
    element.pause()
    element.currentTime = 5
    // Media duration can extend past the last seekable sample.
    Object.defineProperty(element, 'seekable', {
      configurable: true,
      get: () => ({ length: 1, start: () => 0, end: () => element.duration - 0.001 })
    })
  })
  await player.hover()
  await player.getByRole('button', { name: 'More settings' }).click()
  await player.getByRole('button', { name: /^Set repeat start/ }).click()
  await video.evaluate(async (element) => {
    element.currentTime = element.duration - 0.1
    await element.play()
  })
  await expect.poll(() => video.evaluate(element => element.ended)).toBe(true)
  await player.hover()
  await player.getByRole('button', { name: 'More settings' }).click()
  await player.getByRole('button', { name: /^Set repeat end/ }).click()

  for (const zoom of [1, 1.25]) {
    await page.evaluate(zoom => window.ftElectron.setZoomFactor(zoom), zoom)
    await player.hover()
    const marker = player.locator('.abRepeatMarkerB')
    await expect(marker).toBeVisible()
    await expect.poll(() => marker.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      const label = getComputedStyle(element, '::after')
      const left = bounds.left + Number.parseFloat(label.left)
      const top = bounds.top + Number.parseFloat(label.top)
      const width = Number.parseFloat(label.width)
      const height = Number.parseFloat(label.height)
      return [left + 1, left + width - 1].every(x => (
        document.elementFromPoint(x, top + height / 2) === element
      ))
    })).toBe(true)
    await marker.click({ trial: true })
  }
})

test('repeats an A-B range when point B is at the end of the video', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  const player = page.locator('.ftVideoPlayer')

  await video.evaluate((element) => {
    element.pause()
    element.currentTime = 5
  })
  await page.keyboard.press('Shift+A')
  await video.evaluate((element) => { element.currentTime = element.duration })
  await page.keyboard.press('Shift+B')
  await expect(player.locator('.abRepeatMarker')).toHaveCount(2)

  const watchComponent = await page.evaluateHandle(findWatchComponent)
  await watchComponent.evaluate((component) => {
    const findPlayer = (vnode) => {
      if (vnode?.component?.type?.name === 'FtShakaVideoPlayer') return vnode.component
      if (vnode?.component?.subTree) {
        const match = findPlayer(vnode.component.subTree)
        if (match) return match
      }
      if (Array.isArray(vnode?.children)) {
        for (const child of vnode.children) {
          const match = findPlayer(child)
          if (match) return match
        }
      }
      return null
    }
    const playerComponent = findPlayer(component.subTree)
    const onEnded = playerComponent.vnode.props.onEnded
    window.__abRepeatEndedEvents = 0
    playerComponent.vnode.props.onEnded = (...args) => {
      window.__abRepeatEndedEvents++
      return onEnded(...args)
    }
  })
  await video.evaluate((element) => {
    const currentTime = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')
    const play = element.play.bind(element)
    window.__abRepeatRestartTime = null
    window.__abRepeatPlayCalls = 0
    Object.defineProperty(element, 'currentTime', {
      configurable: true,
      get: currentTime.get,
      set(value) {
        if (Math.abs(value - 5) < 0.001) {
          window.__abRepeatRestartTime = value
        }
        currentTime.set.call(this, value)
      }
    })
    element.play = () => {
      window.__abRepeatPlayCalls++
      return play()
    }
    element.currentTime = element.duration
    element.dispatchEvent(new Event('ended'))
  })

  await expect.poll(() => page.evaluate(() => window.__abRepeatRestartTime)).toBeCloseTo(5, 2)
  await expect.poll(() => page.evaluate(() => window.__abRepeatPlayCalls)).toBe(1)
  expect(await page.evaluate(() => window.__abRepeatEndedEvents)).toBe(0)
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
})

test.describe('with A-B repeat disabled', () => {
  test.use({
    seed: {
      settings: {
        ...WATCH_PAGE_SEED,
        disableAbRepeat: true
      }
    }
  })

  test('removes the control and ignores its shortcuts', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    const player = page.locator('.ftVideoPlayer')

    await player.hover()
    await player.getByRole('button', { name: 'More settings' }).click({ force: true })
    await expect(player.locator('.ab-repeat-button')).toHaveCount(0)
    await expect(player.locator('.ab-repeat-clear-button')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Shift+A')
    await expect(player.locator('.abRepeatMarker')).toHaveCount(0)
  })
})

test.describe('fullscreen ambient mode', () => {
  test.use({
    seed: {
      settings: {
        ...WATCH_PAGE_SEED,
        uiScale: 95
      }
    }
  })

  test('stays off without bars and centers letterbox glow beside a dock', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateAmbientMode', true)
    })

    await setPlayerFullscreen(page, true)
    const player = page.locator('.ftVideoPlayer')
    const ambient = player.locator('.ambientFullscreenCanvas')
    await expect.poll(() => ambient.evaluate(element => Number(getComputedStyle(element).opacity)))
      .toBe(0)

    await video.evaluate(async (element) => {
      const source = document.createElement('canvas')
      source.width = 190
      source.height = 90
      source.getContext('2d').fillStyle = '#ff0000'
      source.getContext('2d').fillRect(0, 0, source.width, source.height)

      const stream = source.captureStream(10)
      element.srcObject = stream
      await element.play()
      window.__ambientModeTestMedia = { source, stream }
    })
    await expect.poll(() => video.evaluate(element => [element.videoWidth, element.videoHeight]))
      .toEqual([190, 90])

    await expect.poll(() => ambient.evaluate(element => Number(getComputedStyle(element).opacity)))
      .toBeGreaterThan(0)
    await expect.poll(() => ambient.evaluate((element) => {
      const [red, green, blue, alpha] = element.getContext('2d').getImageData(40, 22, 1, 1).data
      return red > 200 && green < 20 && blue < 20 && alpha === 255
    })).toBe(true)

    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await watchComponent.evaluate(component => {
      component.proxy.$refs.player.setFullscreenMetadata(true)
    })
    await expect(page.locator('.fullscreenMetadataOverlay.open')).toBeVisible()
    await expect.poll(async () => {
      const [playerBounds, videoBounds] = await Promise.all([
        player.boundingBox(),
        video.boundingBox()
      ])
      return playerBounds.width - videoBounds.width
    }).toBeGreaterThan(100)
    await expect.poll(async () => {
      const [ambientBounds, videoBounds] = await Promise.all([
        ambient.boundingBox(),
        video.boundingBox()
      ])
      const ambientCenter = ambientBounds.x + ambientBounds.width / 2
      const videoCenter = videoBounds.x + videoBounds.width / 2
      return Math.abs(ambientCenter - videoCenter)
    }).toBeLessThanOrEqual(1)

    await player.evaluate((element) => {
      for (const overlay of element.querySelectorAll('.shaka-controls-container, .playerFullscreenTitleOverlay')) {
        overlay.style.visibility = 'hidden'
      }
    })
    const screenshot = await player.screenshot()
    const letterboxPixel = await page.evaluate(async (base64) => {
      const image = new Image()
      image.src = `data:image/png;base64,${base64}`
      await image.decode()

      const canvas = new OffscreenCanvas(image.width, image.height)
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0)
      return [...context.getImageData(Math.floor(image.width / 2), 20, 1, 1).data]
    }, screenshot.toString('base64'))

    expect(letterboxPixel[0]).toBeGreaterThan(40)
    expect(letterboxPixel[0]).toBeGreaterThan(letterboxPixel[1] * 2)
    expect(letterboxPixel[0]).toBeGreaterThan(letterboxPixel[2] * 2)
  })
})

test('shows the restricted playback setup hint and loads yt-dlp subtitles after an authenticated retry', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.route('https://example.invalid/restricted-en.vtt', route => route.fulfill({
    contentType: 'text/vtt',
    body: 'WEBVTT\n\n00:00:00.000 --> 00:00:10.000\nRestricted caption\n'
  }))
  await page.route('https://example.invalid/restricted-de.vtt', route => route.fulfill({
    contentType: 'text/vtt',
    body: 'WEBVTT\n\n00:00:00.000 --> 00:00:10.000\nEingeschränkte Untertitel\n'
  }))
  await openMockedVideo(page)

  const watchView = await watchViewHandle(page)
  await watchView.evaluate(async (view) => {
    view.isLoading = false
    view.captions = []
    view.captionTranslations = []
    view.playbackEngineFallbackTarget = 'built-in'
    view.setRestrictedPlaybackError('age')
    await view.$nextTick()
  })

  await expect(page.getByText(
    'Configure cookies in Settings → External Software → yt-dlp Playback Cookies.'
  )).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try with configured cookies' })).toHaveCount(0)

  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateYtDlpPlaybackAuthMode', 'browser')
    await store.dispatch('updateYtDlpPlaybackCookiesBrowser', 'firefox')
  })
  await app.electronApp.evaluate(({ ipcMain }, demoMediaUrl) => {
    globalThis.__restrictedPlaybackCalls = []
    ipcMain.removeHandler('yt-dlp-get-playback-info')
    ipcMain.handle(
      'yt-dlp-get-playback-info',
      (_event, _videoId, useDefaultClients, useAuthentication, includeSubtitles) => {
        globalThis.__restrictedPlaybackCalls.push({ useDefaultClients, useAuthentication, includeSubtitles })
        return {
          isLive: false,
          liveStatus: 'not_live',
          hlsManifestUrl: null,
          formats: [{
            formatId: '18',
            url: `${demoMediaUrl}&expire=4102444800`,
            manifestUrl: null,
            protocol: 'https',
            ext: 'webm',
            container: 'webm',
            vcodec: 'vp9',
            acodec: 'opus',
            width: 640,
            height: 360,
            fps: 30,
            bitrate: 500000,
            audioSampleRate: 44100,
            audioChannels: 2,
            language: null,
            formatNote: '360p',
            dynamicRange: 'SDR',
            availableAt: null
          }],
          duration: 60,
          storyboardVtt: null,
          captions: [{
            url: 'https://example.invalid/restricted-en.vtt',
            language: 'en',
            label: 'English',
            mimeType: 'text/vtt',
            isAutoGenerated: true
          }],
          captionTranslations: [{
            url: 'https://example.invalid/restricted-de.vtt',
            language: 'de',
            label: 'German from English',
            translationName: 'German',
            originalLanguage: 'en',
            mimeType: 'text/vtt',
            id: 'yt-dlp:de'
          }],
          title: 'Restricted video',
          version: 'test'
        }
      }
    )
  }, DEMO_MEDIA_URL)
  await watchView.evaluate((view) => {
    const extractYtDlpPlaybackSource = view.extractYtDlpPlaybackSource
    view.extractYtDlpPlaybackSource = async (...args) => {
      const applied = await extractYtDlpPlaybackSource.apply(view, args)
      window.__restrictedPlaybackResult = {
        applied,
        activeEngine: view.activePlaybackEngine,
        activeFormat: view.activeFormat,
        legacyFormats: view.legacyFormats.length,
        manifest: view.manifestSrc
      }
      return applied
    }
  })

  await expect(page.getByText(
    'Configure cookies in Settings → External Software → yt-dlp Playback Cookies.'
  )).toHaveCount(0)
  const retry = page.getByRole('button', { name: 'Try with configured cookies' })
  await expect(retry).toBeVisible()
  await retry.click()

  await expect.poll(() => app.electronApp.evaluate(
    () => globalThis.__restrictedPlaybackCalls
  )).toEqual([{ useDefaultClients: false, useAuthentication: true, includeSubtitles: true }])
  await expect.poll(() => page.evaluate(
    () => window.__restrictedPlaybackResult
  )).toEqual({
    applied: true,
    activeEngine: 'yt-dlp',
    activeFormat: 'legacy',
    legacyFormats: 1,
    manifest: null
  })
  expect(await watchView.evaluate((view) => view.playbackEngineFallbackTarget)).toBeNull()
  const translatedCaptionLabel = await watchView.evaluate((view) => {
    return view.t('Video.Player.TranslatedCaptionTemplate', {
      language: 'German',
      originalLanguage: 'English'
    })
  })

  await expect.poll(() => watchView.evaluate((view) => ({
    captions: view.captions,
    captionTranslations: view.captionTranslations
  }))).toEqual({
    captions: [{
      url: 'https://example.invalid/restricted-en.vtt',
      language: 'en',
      label: 'English (auto-generated)',
      mimeType: 'text/vtt',
      isAutoGenerated: true
    }],
    captionTranslations: [{
      url: 'https://example.invalid/restricted-de.vtt',
      language: 'de',
      label: translatedCaptionLabel,
      translationName: 'German',
      originalLanguage: 'en',
      mimeType: 'text/vtt',
      id: 'yt-dlp:de'
    }]
  })

  await waitForPlayback(page)
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  await expect.poll(() => player.evaluate(element => {
    return element.ui.getControls().getPlayer().getTextTracks().map(track => ({
      language: track.language,
      label: track.label
    }))
  })).toContainEqual({ language: 'en', label: 'English (auto-generated)' })

  await player.hover()
  const moreOptions = player.getByRole('button', { name: 'More settings' })
  await moreOptions.click()
  await player.locator('.shaka-overflow-menu').getByRole('button', { name: 'Captions' }).click()
  await player.locator('.shaka-text-languages').getByRole('button', { name: 'Auto-translate' }).click()
  await player.locator('.ft-caption-translation-options').getByRole('button', { name: 'German' }).click()
  await expect.poll(() => player.evaluate(element => {
    return element.ui.getControls().getPlayer().getTextTracks().map(track => ({
      language: track.language,
      label: track.label
    }))
  })).toContainEqual({
    language: 'de',
    label: translatedCaptionLabel
  })

  await watchView.evaluate(async (view) => {
    window.__restrictedPlaybackResult = null
    view.manifestSrc = null
    view.legacyFormats = []
    view.activeFormat = 'dash'
    view.activePlaybackEngine = 'built-in'
    view.playbackEngineFallbackTarget = 'built-in'
    view.setRestrictedPlaybackError('age')
    await view.$nextTick()
  })

  await expect.poll(() => page.evaluate(
    () => window.__restrictedPlaybackResult
  )).toEqual({
    applied: true,
    activeEngine: 'yt-dlp',
    activeFormat: 'legacy',
    legacyFormats: 1,
    manifest: null
  })
  await expect.poll(() => app.electronApp.evaluate(
    () => globalThis.__restrictedPlaybackCalls
  )).toEqual([{ useDefaultClients: false, useAuthentication: true, includeSubtitles: true }])
  await expect(page.getByRole('button', { name: 'Try with configured cookies' })).toHaveCount(0)
})

test('uses configured cookies for every yt-dlp extraction when enabled', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)

  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateYtDlpPlaybackAuthMode', 'browser')
    await store.dispatch('updateYtDlpPlaybackCookiesBrowser', 'firefox')
    await store.dispatch('updateYtDlpPlaybackAlwaysUseCookies', true)
  })
  await app.electronApp.evaluate(({ ipcMain }) => {
    globalThis.__alwaysUseCookiesCalls = []
    ipcMain.removeHandler('yt-dlp-get-playback-info')
    ipcMain.handle(
      'yt-dlp-get-playback-info',
      (_event, _videoId, useDefaultClients, useAuthentication) => {
        globalThis.__alwaysUseCookiesCalls.push({ useDefaultClients, useAuthentication })
        return { error: 'expected test extraction failure' }
      }
    )
  })

  const watchView = await watchViewHandle(page)
  expect(await watchView.evaluate((view) => {
    view.playbackEngineFallbackTarget = 'yt-dlp'
    return view.extractYtDlpPlaybackSource(
      view.videoLoadGeneration,
      view.videoId,
      view.playbackEngineSwitchGeneration
    )
  })).toBe(false)
  expect(await app.electronApp.evaluate(() => globalThis.__alwaysUseCookiesCalls)).toEqual([
    { useDefaultClients: false, useAuthentication: true },
    { useDefaultClients: true, useAuthentication: true },
    { useDefaultClients: true, useAuthentication: true }
  ])
})

test.describe('Shorts transcript navigation', () => {
  const SHORTS_CHANNEL_ID = 'UC-transcript-shorts'
  const CAPTIONED_SHORT_IDS = ['captioned-short-1', 'captioned-short-2']
  const CAPTIONLESS_SHORT_ID = 'captionless-short'
  const shorts = [...CAPTIONED_SHORT_IDS, CAPTIONLESS_SHORT_ID].map((videoId, index) => ({
    type: 'video',
    videoId,
    title: `Transcript Short ${index + 1}`,
    author: 'Transcript Shorts',
    authorId: SHORTS_CHANNEL_ID,
    published: CAPTIONED_SHORT_IDS.length + 1 - index,
    isShort: true,
    lengthSeconds: '',
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/frame0.jpg?selected=1`
  }))

  test.use({
    seed: {
      settings: {
        ...WATCH_PAGE_SEED,
        useCustomShortsPlayer: true,
        useQuickPlaybackSpeedBar: true,
        fetchSubscriptionsAutomatically: false
      },
      profiles: [{
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [{
          id: SHORTS_CHANNEL_ID,
          name: 'Transcript Shorts',
          thumbnail: ''
        }]
      }],
      subscriptionCache: [{
        _id: SHORTS_CHANNEL_ID,
        shorts,
        shortsTimestamp: new Date().toISOString()
      }]
    }
  })

  test('pausing and seeking near the end does not complete a Short', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.locator(sel.searchInput).fill(`https://www.youtube.com/shorts/${CAPTIONED_SHORT_IDS[0]}`)
    await page.locator(sel.searchInput).press('Enter')
    const video = await waitForPlayback(page)
    await video.evaluate(async element => {
      element.pause()
      element.currentTime = element.duration - 0.25
      await new Promise(resolve => element.addEventListener('seeked', resolve, { once: true }))
    })
    const view = await watchViewHandle(page)
    await expect.poll(() => view.evaluate(view => ({
      complete: view.shortsPlaybackCompleted,
      progress: view.historyEntry?.watchProgress,
      full: view.historyEntry?.watchProgress === view.historyEntry?.lengthSeconds
    }))).toEqual({ complete: false, progress: expect.any(Number), full: false })
    await video.evaluate(async element => {
      element.currentTime = element.duration - 2
      await new Promise(resolve => element.addEventListener('seeked', resolve, { once: true }))
      await element.play()
    })
    await expect.poll(() => view.evaluate(view => view.shortsPlaybackCompleted)).toBe(true)
    await view.dispose()
  })

  for (const zoom of [1, 1.25]) {
    test(`Escape dismisses the Shorts context menu before exiting full window at ${zoom} scale`, async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await page.evaluate(zoom => window.ftElectron.setZoomFactor(zoom), zoom)
      await page.locator(sel.searchInput).fill(`https://www.youtube.com/shorts/${CAPTIONED_SHORT_IDS[0]}`)
      await page.locator(sel.searchInput).press('Enter')
      const video = await waitForPlayback(page)
      await video.evaluate(element => element.pause())
      const player = page.locator('.ftVideoPlayer.shortsPlayer')
      await page.keyboard.press('s')
      await expect(player).toHaveClass(/fullWindow/)
      await player.click({ button: 'right', position: { x: 100, y: 100 } })
      const menu = player.locator('.shaka-context-menu')
      await expect(menu).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(menu).toBeHidden()
      await expect(player).toHaveClass(/fullWindow/)
      const volume = player.locator('.shortsVolumeControl')
      await volume.hover()
      await expect(volume.locator('.shortsVolumeSlider')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(player).not.toHaveClass(/fullWindow/)
    })

    test(`Shorts information panels contain wheel input with and without overflow at ${zoom} scale`, async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await page.evaluate(zoom => window.ftElectron.setZoomFactor(zoom), zoom)
      await page.locator('[data-subscription-feed-tab="shorts"]').click()
      await page.getByText('Transcript Short 1', { exact: true }).click()
      const video = await waitForPlayback(page)
      await video.evaluate(element => element.pause())
      const view = await watchViewHandle(page)
      await view.evaluate(async view => {
        view.videoDescription = 'Short description'
        view.videoDescriptionHtml = ''
        view.toggleShortsMetadata()
        await view.$nextTick()
      })
      const panel = page.locator('.shortsAuxPanel')
      const scroller = panel.locator('.shortsAuxPanelTarget')
      await expect(panel).toHaveClass(/shortsAuxPanelOpen/)
      const originalUrl = page.url()
      const bounds = await scroller.boundingBox()
      await page.mouse.move(bounds.x + 20, bounds.y + 20)
      await page.mouse.wheel(0, 2000)
      await page.waitForTimeout(300)
      await expect(page).toHaveURL(originalUrl)
      await view.evaluate(async view => {
        view.toggleShortsMetadata()
        await view.$nextTick()
        view.videoDescription = Array(200).fill('Long description').join('\n')
        view.toggleShortsMetadata()
      })
      await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(100)
      const longBounds = await scroller.boundingBox()
      await page.mouse.move(longBounds.x + 20, longBounds.y + 20)
      await page.mouse.wheel(0, 120)
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await page.mouse.wheel(0, 2000)
      await page.waitForTimeout(300)
      await expect(page).toHaveURL(originalUrl)
      await view.dispose()
    })
  }

  test('keeps the current Short from expanding when YouTube-style Shorts are disabled', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateUiScale', 95)
    })
    await page.locator(sel.searchInput)
      .fill(`https://www.youtube.com/shorts/${CAPTIONED_SHORT_IDS[0]}`)
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[0]}\\?short=true`))
    await waitForPlayback(page)

    const player = page.locator('.ftVideoPlayer')
    await expect(player).toHaveClass(/shortsPlayer/)
    const shortsBounds = await player.boundingBox()
    expect(shortsBounds).not.toBeNull()

    // Avoid Playwright scrolling the Shorts feed to bring menu controls into view.
    await page.locator('.profileTrigger').evaluate(button => button.click())
    await expect(page.locator('.quickSettingsMenu')).toBeVisible()
    await page.locator('.allSettingsShortcut').evaluate(button => button.click())
    await expect(page.locator('.settingsWindow')).toBeVisible()
    await expect(page).toHaveURL(new RegExp(CAPTIONED_SHORT_IDS[0]))
    await page.locator('.settingsMenu [data-section="playback"]').click()
    const toggle = page.getByRole('checkbox', { name: 'Use YouTube-style Shorts' })
    await expect(toggle).toBeChecked()
    await page.locator('label.switch-label')
      .filter({ hasText: 'Use YouTube-style Shorts' })
      .click()
    await expect(toggle).not.toBeChecked()
    await expect(page).toHaveURL(new RegExp(CAPTIONED_SHORT_IDS[0]))
    await expect(player).toHaveClass(/shortsPlayer/)

    const bounds = await player.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds.width).toBeLessThanOrEqual(shortsBounds.width + 1)

    await page.locator('.settingsWindow').getByRole('button', { name: 'Close' }).click()
    await expect(page).toHaveURL(new RegExp(CAPTIONED_SHORT_IDS[0]))
    await page.locator('.shortsNavigationButton').last().evaluate(element => element.click())
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[1]}\\?short=true`))
    await waitForPlayback(page)
    await expect(player).not.toHaveClass(/shortsPlayer/)
  })

  test('shows quick playback speeds near the pointer without covering the seek preview', async ({ app, page, attachScreenshot }) => {
    await mockPlayableWatchPage(app, page)
    await page.locator(sel.searchInput)
      .fill(`https://www.youtube.com/shorts/${CAPTIONED_SHORT_IDS[0]}`)
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[0]}\\?short=true`))
    const video = await waitForPlayback(page)

    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    const controlPanel = player.locator('.shaka-controls-button-panel')
    const playbackRateBar = controlPanel.locator('.ft-quick-playback-rate-bar')
    const seekBar = player.locator('.shaka-seek-bar-container')
    const opacity = () => controlPanel.evaluate(element => Number(getComputedStyle(element).opacity))

    await expect(playbackRateBar).toHaveCount(1)
    await expect(playbackRateBar.getByRole('button')).toHaveCount(9)

    const playerBounds = await player.boundingBox()
    expect(playerBounds).not.toBeNull()

    await player.dispatchEvent('mousemove', {
      clientX: playerBounds.x + playerBounds.width / 2,
      clientY: playerBounds.y + 80
    })
    await expect.poll(opacity).toBe(0)

    let rateBarBounds = await playbackRateBar.boundingBox()
    expect(rateBarBounds).not.toBeNull()
    await player.dispatchEvent('mousemove', {
      clientX: rateBarBounds.x + rateBarBounds.width / 2,
      clientY: rateBarBounds.y - 24
    })
    await expect.poll(opacity).toBeGreaterThan(0.2)
    expect(await opacity()).toBeLessThan(0.5)

    rateBarBounds = await playbackRateBar.boundingBox()
    expect(rateBarBounds).not.toBeNull()
    await player.dispatchEvent('mousemove', {
      clientX: rateBarBounds.x + rateBarBounds.width / 2,
      clientY: rateBarBounds.y - 6
    })
    await expect.poll(opacity).toBeGreaterThan(0.75)

    rateBarBounds = await playbackRateBar.boundingBox()
    expect(rateBarBounds).not.toBeNull()
    await playbackRateBar.dispatchEvent('mousemove', {
      clientX: rateBarBounds.x + rateBarBounds.width / 2,
      clientY: rateBarBounds.y + rateBarBounds.height / 2
    })
    await expect.poll(opacity).toBe(1)
    await attachScreenshot('Shorts quick playback speed bar')

    const playbackRateButton = playbackRateBar.getByRole('button', { name: '1.25x', exact: true })
    await playbackRateButton.click()
    await expect(playbackRateButton).toBeFocused()
    await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(1.25)

    await seekBar.hover()
    await expect.poll(opacity).toBe(0)
    await expect(playbackRateButton).not.toBeFocused()
    expect(await seekBar.evaluate(element => getComputedStyle(element).zIndex)).toBe('3')
    expect(await controlPanel.evaluate(element => getComputedStyle(element).zIndex)).toBe('2')
  })

  test('preserves the panel until navigation reaches a captionless Short', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, {
      captionCueSettings: 'align:center',
      captionVideoIds: CAPTIONED_SHORT_IDS
    })
    await page.locator(sel.searchInput)
      .fill(`https://www.youtube.com/shorts/${CAPTIONED_SHORT_IDS[0]}`)
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[0]}\\?short=true`))
    await waitForPlayback(page)

    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    const transcriptButton = page.locator('.shortsComponentAction')
      .filter({ hasText: 'Transcript' })
      .getByRole('button')
    const transcriptPanel = page.locator('.shortsAuxPanelTarget .watchVideoTranscript')
    const next = page.locator('.shortsNavigationButton').last()

    await expect(player).toBeVisible()
    await transcriptButton.click()
    await expect(transcriptPanel).toBeVisible()

    await next.click()
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[1]}\\?short=true`))
    await expect(transcriptPanel).toBeVisible()
    await expect(transcriptButton).toHaveAttribute('aria-pressed', 'true')

    await page.waitForTimeout(350)
    await next.click()
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONLESS_SHORT_ID}\\?short=true`))
    await expect(transcriptPanel).toHaveCount(0)
    await expect(transcriptButton).toHaveCount(0)
  })

  test('docks, scrolls, and clamps video information across Shorts navigation', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await setWindowSize(app, page, { width: 1325, height: 760 })
    await page.locator(sel.searchInput)
      .fill(`https://www.youtube.com/shorts/${CAPTIONED_SHORT_IDS[0]}`)
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[0]}\\?short=true`))
    await waitForPlayback(page)
    await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))

    const watchView = await watchViewHandle(page)
    await watchView.evaluate(async (view) => {
      const lines = Array.from({ length: 80 }, (_, index) => `Description line ${index + 1}`)
      view.videoDescription = lines.join('\n')
      view.videoDescriptionHtml = lines.join('<br>')
      view.toggleShortsMetadata()
      await view.$nextTick()
    })

    const panel = page.locator('.shortsAuxPanel')
    const scroller = panel.locator('.shortsAuxPanelTarget')
    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    await expect(panel).toHaveClass(/shortsAuxPanelOpen/)
    await expect.poll(async () => {
      const [panelBounds, playerBounds] = await Promise.all([
        panel.boundingBox(),
        player.boundingBox()
      ])
      const bottomDelta = Math.abs(
        panelBounds.y + panelBounds.height - playerBounds.y - playerBounds.height
      )
      const topDelta = Math.abs(panelBounds.y - playerBounds.y)
      return Math.max(bottomDelta, topDelta)
    }).toBeLessThanOrEqual(1)
    await expect(scroller).toHaveAttribute('data-overlayscrollbars-viewport')
    await expect(panel.locator('.os-scrollbar-vertical')).toHaveCount(1)
    await expect.poll(() => scroller.evaluate(element => {
      return element.scrollHeight - element.clientHeight
    })).toBeGreaterThan(100)

    const initialScrollTop = await scroller.evaluate(element => element.scrollTop)
    const pointer = await scroller.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return {
        x: bounds.left + bounds.width / 2,
        y: Math.min(bounds.bottom - 1, window.innerHeight - 1)
      }
    })
    await page.mouse.move(pointer.x, pointer.y)
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[0]}\\?short=true`))
    expect(await scroller.evaluate((element, point) => {
      const hit = document.elementFromPoint(point.x, point.y)
      return element.contains(hit)
    }, pointer)).toBe(true)
    await page.mouse.wheel(0, 500)
    await expect.poll(() => scroller.evaluate(element => element.scrollTop))
      .toBeGreaterThan(initialScrollTop)
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => scroller.evaluate(element => {
      const viewportBounds = element.getBoundingClientRect()
      const descriptionBounds = element.querySelector('.description').getBoundingClientRect()
      return {
        atScrollEnd: element.scrollHeight - element.clientHeight - element.scrollTop <= 1,
        renderedEndVisible: descriptionBounds.bottom <= viewportBounds.bottom + 1
      }
    })).toEqual({ atScrollEnd: true, renderedEndVisible: true })

    await setWindowSize(app, page, { width: 1326, height: 1012 })
    await expect.poll(() => scroller.evaluate(element => {
      const contentEnd = element.querySelector('.shortsAuxPanelContentEnd')
      const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
      const viewportBounds = element.getBoundingClientRect()
      const contentEndBounds = contentEnd.getBoundingClientRect()
      const maximumScrollTop = Math.max(0, contentEnd.offsetTop - element.clientHeight)
      const hasVerticalOverflow = maximumScrollTop > 1
      return {
        atRenderedEnd: maximumScrollTop === 0
          ? element.scrollTop <= 1
          : Math.abs(contentEndBounds.bottom - viewportBounds.bottom) <= 1,
        scrollbarMatchesOverflow:
          scrollbar?.classList.contains('os-scrollbar-visible') === hasVerticalOverflow,
        withinRenderedRange: element.scrollTop <= maximumScrollTop + 1
      }
    })).toEqual({
      atRenderedEnd: true,
      scrollbarMatchesOverflow: true,
      withinRenderedRange: true
    })
    await page.mouse.wheel(0, 500)
    await page.waitForTimeout(100)
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[0]}\\?short=true`))

    await page.locator('.shortsNavigationButton').last().click()
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[1]}\\?short=true`))
    await waitForPlayback(page)
    await expect(panel).toHaveClass(/shortsAuxPanelOpen/)
    await expect.poll(() => scroller.evaluate(element => {
      const content = element.querySelector('.videoDescription')
      const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
      const viewportBounds = element.getBoundingClientRect()
      const contentBounds = content?.getBoundingClientRect()
      const maximumScrollTop = Math.max(
        0,
        (content?.offsetTop ?? 0) + (content?.offsetHeight ?? 0) - element.clientHeight
      )
      const hasVerticalOverflow = element.scrollHeight > element.clientHeight + 1
      return {
        atRenderedEnd: contentBounds != null &&
          (maximumScrollTop === 0
            ? element.scrollTop <= 1
            : Math.abs(contentBounds.bottom - viewportBounds.bottom) <= 1),
        horizontalOverflowHidden: getComputedStyle(element).overflowX === 'hidden' &&
          element.scrollWidth <= element.clientWidth + 1,
        scrollbarMatchesOverflow:
          scrollbar?.classList.contains('os-scrollbar-visible') === hasVerticalOverflow,
        withinRenderedRange: element.scrollTop <= maximumScrollTop + 1
      }
    })).toEqual({
      atRenderedEnd: true,
      horizontalOverflowHidden: true,
      scrollbarMatchesOverflow: true,
      withinRenderedRange: true
    })
  })

  test('keeps loading Shorts when another player keeps the shared caption factory alive', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { captionTranslations: true })

    const backgroundTab = await page.evaluate(() => window.ftElectron.tabs.create({
      route: '/watch/background-captioned-video',
      title: 'Background captioned video',
      makeActive: false,
      preloadInBackground: true
    }))
    const backgroundContent = page.locator(`.tabContent[data-tab-id="${backgroundTab.id}"]`)
    const backgroundPlayer = backgroundContent.locator('.ftVideoPlayer')
    await expect(backgroundPlayer).toHaveCount(1, { timeout: 30_000 })
    await expect.poll(() => backgroundPlayer.evaluate(element => {
      return element.ui?.getControls().getPlayer().getAssetUri() ?? ''
    })).not.toBe('')

    await page.locator(sel.searchInput)
      .fill(`https://www.youtube.com/shorts/${CAPTIONED_SHORT_IDS[0]}`)
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[0]}\\?short=true`))
    await waitForPlayback(page)

    const rendererErrors = []
    page.on('pageerror', error => rendererErrors.push(error.message))
    page.on('console', message => {
      if (message.type() === 'error') rendererErrors.push(message.text())
    })

    await page.locator('.shortsNavigationButton').last().click()
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[1]}\\?short=true`))
    await waitForPlayback(page)

    expect(rendererErrors.filter(error => (
      error.includes('getTextTracks') || error.includes('failed to render')
    ))).toEqual([])
  })

  for (const zoom of [1, 1.25]) {
    test(`keeps the Shorts player, action rail, and comments inside a Capacitor phone viewport at ${zoom} scale`, async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await page.evaluate(zoom => window.ftElectron.setZoomFactor(zoom), zoom)
      await page.locator(sel.searchInput)
        .fill(`https://www.youtube.com/shorts/${CAPTIONED_SHORT_IDS[0]}`)
      await page.locator(sel.searchInput).press('Enter')
      await waitForPlayback(page)
      await setWindowSize(app, page, { width: 461, height: 1026 })
      await page.locator('.app').evaluate((element) => {
        element.classList.add('capacitorTabs', 'capacitorPhoneLayout')
        element.classList.remove('topTabs', 'bottomTabs', 'verticalTabs')
        document.querySelector('.tabBar')?.style.setProperty('display', 'none')
      })

      const player = page.locator('.ftVideoPlayer.shortsPlayer')
      const rail = page.locator('.shortsActionRail')
      const commentsPanel = page.locator('.shortsCommentsPanel')
      await expect(player).toBeVisible()
      await expect(rail).toBeVisible()
      await page.locator('.shortsCommentsAction .iconButton').click()
      await expect(commentsPanel).toHaveClass(/shortsCommentsPanelOpen/)

      const geometry = await page.evaluate(() => {
        const playerBounds = document.querySelector('.ftVideoPlayer.shortsPlayer').getBoundingClientRect()
        const railBounds = document.querySelector('.shortsActionRail').getBoundingClientRect()
        const commentsBounds = document.querySelector('.shortsCommentsPanel').getBoundingClientRect()
        const actionLabels = [...document.querySelectorAll('.shortsAction > span')]
        return {
          commentsLeft: commentsBounds.left,
          commentsRight: commentsBounds.right,
          documentClientWidth: document.documentElement.clientWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          labelsHidden: actionLabels.every(label => getComputedStyle(label).display === 'none'),
          railBottom: railBounds.bottom,
          railLeft: railBounds.left,
          railRight: railBounds.right,
          playerBottom: playerBounds.bottom,
          playerLeft: playerBounds.left,
          playerRight: playerBounds.right,
          viewportWidth: window.innerWidth,
        }
      })

      expect(geometry.labelsHidden).toBe(true)
      expect(geometry.documentScrollWidth).toBeLessThanOrEqual(geometry.documentClientWidth + 1)
      expect(geometry.playerLeft).toBeGreaterThanOrEqual(0)
      expect(geometry.playerRight).toBeLessThanOrEqual(geometry.viewportWidth)
      expect(geometry.commentsLeft).toBeGreaterThanOrEqual(0)
      expect(geometry.commentsRight).toBeLessThanOrEqual(geometry.viewportWidth)
      expect(geometry.railLeft).toBeGreaterThanOrEqual(geometry.playerLeft)
      expect(geometry.railRight).toBeLessThanOrEqual(geometry.playerRight)
      expect(geometry.railRight).toBeLessThanOrEqual(geometry.viewportWidth)
      expect(geometry.railBottom).toBeLessThanOrEqual(geometry.playerBottom)
    })
  }
})

for (const zoom of [1, 1.25]) {
  test(`chapters stay centered through layout changes until manually scrolled at ${zoom} scale`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.evaluate(zoom => window.ftElectron.setZoomFactor(zoom), zoom)
    const video = await openMockedVideo(page)
    await video.evaluate(async element => {
      element.pause()
      element.currentTime = element.duration * 20.5 / 40
      if (element.seeking) {
        await new Promise(resolve => element.addEventListener('seeked', resolve, { once: true }))
      }
    })
    const chapterDuration = await video.evaluate(element => element.duration / 40)
    const view = await watchViewHandle(page)
    await view.evaluate(async (view, chapterDuration) => {
      view.videoChapters = Array.from({ length: 40 }, (_, index) => ({
        title: `Chapter ${index + 1}`,
        timestamp: `${index}:00`,
        startSeconds: index * chapterDuration
      }))
      view.videoCurrentChapterIndex = 20
      view.showSidebarChapters = true
      await view.$nextTick()
    }, chapterDuration)
    const scroller = page.locator('.watchVideoChaptersPanel .chaptersWrapper')
    const expectCentered = () => expect.poll(() => scroller.evaluate(element => {
      const row = element.querySelector('.chapter.current').getBoundingClientRect()
      const viewport = element.getBoundingClientRect()
      return Math.abs(row.top + row.height / 2 - viewport.top - viewport.height / 2)
    })).toBeLessThan(2)
    await expectCentered()
    await scroller.locator('.chapter.current .copyTimestamp').click()
    await scroller.evaluate(element => { element.style.maxBlockSize = '240px' })
    await expectCentered()
    await scroller.locator('.chapter.current .copyTimestamp').press('Shift')
    await scroller.evaluate(element => { element.style.maxBlockSize = '360px' })
    await expectCentered()
    await scroller.hover()
    await page.mouse.wheel(0, 2000)
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(2000)
    await scroller.evaluate(element => { element.style.maxBlockSize = '480px' })
    await expect.poll(() => scroller.evaluate(element => (
      Math.abs(element.scrollTop - (element.scrollHeight - element.clientHeight))
    ))).toBeLessThan(2)
    await scroller.locator('.chapterSeek').nth(32).click()
    await expect(scroller.locator('.chapter.current .chapterTitle')).toHaveText('Chapter 33')
    await scroller.evaluate(element => { element.style.maxBlockSize = '240px' })
    await expectCentered()
    await scroller.hover()
    await page.mouse.wheel(0, 2000)
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(2000)
    await view.evaluate(view => { view.videoChapters = view.videoChapters.slice(0, 3) })
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
    await expect(scroller.locator(':scope > .os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
    await view.dispose()
  })
}

test('a background watch tab stays loading until its cached avatar is ready', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)

  await page.evaluate(() => {
    window.__backgroundWatchIconStates = []
    const record = () => {
      for (const tab of document.querySelectorAll('.tab')) {
        window.__backgroundWatchIconStates.push({
          id: tab.dataset.tabId,
          loading: tab.querySelector('.loadingDot') != null,
          avatar: tab.querySelector('.tabAvatar') != null,
          pageIcon: tab.querySelector('.tabPageIcon') != null
        })
      }
    }
    new MutationObserver(record).observe(
      document.querySelector('.tabsContainer'),
      { childList: true, subtree: true }
    )
  })

  const watchTab = await page.evaluate(() => window.ftElectron.tabs.create({
    route: '/watch/jNQXAC9IVRw',
    title: 'Cached video',
    makeActive: false,
    preloadInBackground: true
  }))
  const tab = page.locator(`.tab[data-tab-id="${watchTab.id}"]`)

  await expect(tab.locator('.loadingDot')).toBeVisible()
  const avatarCached = await page.evaluate(async tabId => {
    const avatarBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEUzZpk7I4HSAAAACklEQVQI12NgAAAAAgAB4iG8MwAAAABJRU5ErkJggg=='
    const avatarBytes = Uint8Array.from(atob(avatarBase64), character => character.charCodeAt(0))
    return await window.ftElectron.tabs.updateAvatar(
      avatarBytes.buffer,
      tabId,
      '/watch/jNQXAC9IVRw'
    )
  }, watchTab.id)
  expect(avatarCached).toBe(true)
  await expect(tab.locator('.loadingDot')).toHaveCount(0)
  await expect.poll(() => page.evaluate(tabId => (
    window.__backgroundWatchIconStates.some(state => state.id === tabId && !state.loading && state.avatar)
  ), watchTab.id)).toBe(true)

  const states = await page.evaluate(
    tabId => window.__backgroundWatchIconStates.filter(state => state.id === tabId),
    watchTab.id
  )
  expect(states.some(state => state.loading)).toBe(true)
  expect(states.some(state => !state.loading && state.avatar)).toBe(true)
  expect(states.some(state => state.loading && state.pageIcon)).toBe(false)
})

test('keeps background comment loading local to the loaded watch page', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setGeneralAutoLoadMorePaginatedItemsEnabled', false)
  })
  await openMockedVideo(page)

  const watchTabId = await page.locator(sel.activeTab).getAttribute('data-tab-id')
  const watchTab = page.locator(`.tab[data-tab-id="${watchTabId}"]`)
  const watchContent = page.locator(`.tabContent[data-tab-id="${watchTabId}"]`)
  await expect(watchContent.locator('.getCommentsTitle')).toHaveCount(1)
  await expect(watchTab).not.toHaveClass(/loading/)

  let commentRequestStarted = false
  let releaseComments = () => {}
  const commentsReleased = new Promise(resolve => { releaseComments = resolve })
  await page.route(/\/youtubei\/v1\/next/, async (route, request) => {
    const body = JSON.parse(request.postData() ?? '{}')
    if (!body.continuation) return route.fallback()

    commentRequestStarted = true
    await commentsReleased
    return route.fallback()
  })

  try {
    await page.locator(sel.newTabButton).click()
    await expect(watchContent).toHaveAttribute('aria-hidden', 'true')
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setGeneralAutoLoadMorePaginatedItemsEnabled', true)
    })
    await expect.poll(() => commentRequestStarted).toBe(true)
    await expect(watchContent.locator('.commentsArea .commentLoader')).toHaveCount(1)
    await expect(watchContent.locator('.commentsArea [data-tab-loading-indicator]')).toHaveCount(0)
    await expect(watchTab).not.toHaveClass(/loading/)
  } finally {
    releaseComments()
  }

  await expect(watchContent.locator('.commentsArea .commentLoader')).toHaveCount(0)

  const watchView = await watchViewHandle(page)
  await watchView.evaluate(view => { view.isLoading = true })
  await expect(watchTab).toHaveClass(/loading/)
  await watchView.evaluate(view => { view.isLoading = false })
  await expect(watchTab).not.toHaveClass(/loading/)
  await watchView.dispose()
})

for (const { defaultViewingMode, currentTheatreMode } of [
  { defaultViewingMode: 'theatre', currentTheatreMode: false },
  { defaultViewingMode: 'default', currentTheatreMode: true }
]) {
  test.describe(`recommended video morph with ${defaultViewingMode} as the default`, () => {
    test.use({
      seed: {
        settings: {
          ...WATCH_PAGE_SEED,
          defaultViewingMode
        }
      }
    })

    test(`uses the current ${currentTheatreMode ? 'theatre' : 'default'} layout`, async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)

      let releaseRecommendedPlayer
      await page.route(/\/youtubei\/v1\/player/, async (route, request) => {
        const videoId = JSON.parse(request.postData() ?? '{}').videoId
        if (videoId === 'recommended-video') {
          await new Promise(resolve => { releaseRecommendedPlayer = resolve })
        }
        return route.fallback()
      })

      await openMockedVideo(page)
      const watchView = await watchViewHandle(page)
      await watchView.evaluate(async (view, theatreMode) => {
        view.useTheatreMode = theatreMode
        view.recommendedVideos = [{
          videoId: 'recommended-video',
          title: 'Recommended video',
          author: 'Recommended channel',
          authorId: 'UC-recommended-channel',
          lengthSeconds: 60,
          published: Date.now(),
          type: 'video'
        }]
        await view.$nextTick()
      }, currentTheatreMode)
      const lazyRecommendation = page.locator('.watchVideoRecommendations > div').nth(1)
      await lazyRecommendation.evaluate(element => { element.style.minHeight = '1px' })
      await lazyRecommendation.scrollIntoViewIfNeeded()
      const recommendation = page.locator('.watchVideoRecommendations .title', {
        hasText: 'Recommended video'
      })
      await expect(recommendation).toBeVisible()

      await page.evaluate((activeTabSelector) => {
        const startViewTransition = document.startViewTransition.bind(document)
        document.startViewTransition = (update) => {
          window.__recommendedMorph = {
            sourceName: document.querySelector('.watchVideoRecommendations .thumbnailImage')
              ?.style.viewTransitionName
          }
          return startViewTransition(async () => {
            await update()
            const player = document.querySelector(`${activeTabSelector} .videoPlayer`)
            const layout = document.querySelector(`${activeTabSelector} .videoLayout`)
            window.__recommendedMorph.destinationName = getComputedStyle(player).viewTransitionName
            window.__recommendedMorph.usesTheatreLayout = layout.classList.contains('useTheatreMode')
          })
        }
      }, activeTab)

      await recommendation.click()
      await expect(page).toHaveURL(/#\/watch\/recommended-video/)
      await expect.poll(() => page.evaluate(() => window.__recommendedMorph)).toEqual({
        sourceName: 'video-morph',
        destinationName: 'video-morph',
        usesTheatreLayout: currentTheatreMode
      })
      expect(await watchView.evaluate(view => view.loadingTheatreMode)).toBe(currentTheatreMode)

      await expect.poll(() => typeof releaseRecommendedPlayer).toBe('function')
      releaseRecommendedPlayer()
    })
  })
}

const FULLSCREEN_PLAYLIST_ID = 'fullscreen-preview'
const FULLSCREEN_PLAYLIST = {
  _id: FULLSCREEN_PLAYLIST_ID,
  playlistName: 'Fullscreen preview',
  protected: false,
  description: '',
  videos: [{
    videoId: 'jNQXAC9IVRw',
    title: 'Me at the zoo',
    author: 'jawed',
    authorId: 'UC4QobU6STFB0P71PMvOGN5A',
    lengthSeconds: 19,
    playlistItemId: 'playlist-item-0',
    type: 'video'
  }, ...Array.from({ length: 29 }, (_, index) => ({
    videoId: `playlist${String(index + 1).padStart(3, '0')}`,
    title: `Playlist video ${index + 1}`,
    author: 'Playlist channel',
    authorId: 'UC-playlist-channel',
    lengthSeconds: 60,
    playlistItemId: `playlist-item-${index + 1}`,
    type: 'video'
  }))],
  createdAt: Date.now() - 86_400_000,
  lastUpdatedAt: Date.now() - 86_400_000
}

async function setWindowWidth(app, width) {
  await app.electronApp.evaluate(({ BrowserWindow }, targetWidth) => {
    const browserWindow = BrowserWindow.getAllWindows()[0]
    browserWindow.setBounds({ ...browserWindow.getBounds(), width: targetWidth })
  }, width)
}

async function mockTranslatedEndscreen(app, page) {
  await mockPlayableWatchPage(app, page)

  await page.route(/\/youtubei\/v1\/player/, (route, request) => {
    const videoId = JSON.parse(request.postData() ?? '{}').videoId ?? 'jNQXAC9IVRw'
    const response = demoPlayerResponse(videoId, {
      endscreen: {
        endscreenRenderer: {
          elements: [{
            endscreenElementRenderer: {
              style: 'VIDEO',
              title: { simpleText: 'Translated end-screen title' },
              endpoint: { watchEndpoint: { videoId: 'end-screen-video' } },
              image: {
                thumbnails: [{
                  url: 'https://i.ytimg.com/vi/end-screen-video/hqdefault.jpg',
                  width: 480,
                  height: 270
                }]
              },
              left: '0.1',
              top: '0.1',
              width: '0.3',
              aspectRatio: '1.777',
              startMs: '0',
              endMs: '30000',
              id: 'original-title-annotation'
            }
          }],
          startMs: '0'
        }
      }
    })

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response)
    })
  })

  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateAvoidTranslation', 'watch_only')
  })
}

async function measureSponsorBlockSkipStartTime(app, page, { rendererLoad = false } = {}) {
  await mockPlayableWatchPage(app, page)
  await page.route('**/api/skipSegments/**', route => route.fulfill({
    body: JSON.stringify([{
      videoID: 'jNQXAC9IVRw',
      segments: [{
        UUID: 'timed-skip-segment',
        actionType: 'skip',
        category: 'sponsor',
        description: '',
        locked: 0,
        segment: [15, 20],
        videoDuration: 30,
        votes: 1
      }]
    }]),
    contentType: 'application/json'
  }))
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setUseSponsorBlock', true)
  })

  await openMockedVideo(page)
  await expect(page.locator('.sponsorBlockMarker')).toHaveCount(1)

  const video = page.locator('.ftVideoPlayer video')
  await video.evaluate((element, rendererLoad) => {
    element.pause()
    element.currentTime = 14.57
    element.dispatchEvent(new Event('timeupdate'))

    let loadInterval
    window.__sponsorBlockLoadTasks = 0
    if (rendererLoad) {
      // Use fixed-duration work so the load does not depend on host CPU speed.
      // Leave gaps for the skip scheduler to run while playback advances.
      loadInterval = setInterval(() => {
        const end = performance.now() + 30
        while (performance.now() < end) { /* simulate renderer work */ }
        window.__sponsorBlockLoadTasks++
      }, 50)
    }

    const currentTime = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')
    Object.defineProperty(element, 'currentTime', {
      configurable: true,
      get: currentTime.get,
      set(value) {
        if (value === 20) {
          window.__sponsorBlockSkipStartedAt = currentTime.get.call(this)
          clearInterval(loadInterval)
        }
        currentTime.set.call(this, value)
      }
    })
    element.addEventListener('timeupdate', event => event.stopImmediatePropagation(), { capture: true })
    return element.play()
  }, rendererLoad)

  await expect.poll(() => page.evaluate(() => window.__sponsorBlockSkipStartedAt ?? null)).not.toBeNull()
  if (rendererLoad) {
    expect(await page.evaluate(() => window.__sponsorBlockLoadTasks)).toBeGreaterThan(0)
  }
  return page.evaluate(() => window.__sponsorBlockSkipStartedAt)
}

test.describe('watch page', () => {
  test('keeps private and DRM errors ineligible for extraction retry after locale changes', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const watchView = await watchViewHandle(page)
    await watchView.evaluate(async (view) => {
      view.setNonRetryablePlaybackError('private')
      await view.$nextTick()
    })
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateCurrentLocale', 'de-DE')
    })
    await expect.poll(() => watchView.evaluate(view => view.currentLocale)).toBe('de-DE')
    expect(await watchView.evaluate(view => view.errorMessage === view.t('Video.Private'))).toBe(false)
    await expect(page.locator('.errorActions')).toHaveCount(0)

    await watchView.evaluate(async (view) => {
      view.setNonRetryablePlaybackError('drm')
      await view.$nextTick()
    })
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateCurrentLocale', 'en-US')
    })
    await expect.poll(() => watchView.evaluate(view => view.currentLocale)).toBe('en-US')
    expect(await watchView.evaluate(view => view.errorMessage === view.t('Video.DRMProtected'))).toBe(false)
    await expect(page.locator('.errorActions')).toHaveCount(0)
  })

  test('retries an error with the other extraction method without changing the default', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { captionCueSettings: 'align:center' })
    await page.route('https://example.invalid/retry.m3u8', route => route.fulfill({
      contentType: 'application/x-mpegURL',
      body: '#EXTM3U\n'
    }))
    await app.electronApp.evaluate(({ ipcMain }) => {
      globalThis.__ytDlpRetryIncludeSubtitles = []
      ipcMain.removeHandler('yt-dlp-get-playback-info')
      ipcMain.handle('yt-dlp-get-playback-info', (_event, _videoId, _useDefaultClients, _useAuthentication, includeSubtitles) => {
        globalThis.__ytDlpRetryIncludeSubtitles.push(includeSubtitles)
        if (includeSubtitles) {
          return { error: 'subtitle extraction failed' }
        }

        return {
          isLive: false,
          liveStatus: 'not_live',
          hlsManifestUrl: 'https://example.invalid/retry.m3u8',
          formats: [{
            protocol: 'm3u8_native',
            url: 'https://example.invalid/unused?expire=4102444800',
            vcodec: null,
            acodec: null
          }],
          duration: 600,
          version: 'test'
        }
      })
    })
    await openMockedVideo(page)

    const watchView = await watchViewHandle(page)
    await watchView.evaluate((view) => {
      // This test exercises manual extraction retries. The empty HLS fixture is
      // not playable, so ignore its player error instead of racing the manual switch.
      view.handlePlayerError = () => {}
    })
    const builtInManifest = await watchView.evaluate((view) => view.manifestSrc)
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateUiScale', 125)
    })
    await watchView.evaluate(async (view) => {
      view.errorMessage = 'The built-in extraction failed'
      await view.$nextTick()
    })

    const ytDlpRetry = page.getByRole('button', { name: 'Retry with yt-dlp extraction' })
    const [buttonBounds, errorBounds] = await Promise.all([
      ytDlpRetry.boundingBox(),
      page.locator('.errorWrapper').boundingBox()
    ])
    expect(buttonBounds.x).toBeGreaterThanOrEqual(errorBounds.x)
    expect(buttonBounds.x + buttonBounds.width).toBeLessThanOrEqual(errorBounds.x + errorBounds.width)
    await ytDlpRetry.click()
    await expect.poll(() => watchView.evaluate((view) => ({
      activeEngine: view.activePlaybackEngine,
      errorMessage: view.errorMessage,
      manifest: view.manifestSrc,
      streamsPending: view.ytDlpStreamsPending
    }))).toEqual({
      activeEngine: 'yt-dlp',
      errorMessage: null,
      manifest: 'https://example.invalid/retry.m3u8',
      streamsPending: false
    })
    expect(await app.electronApp.evaluate(() => globalThis.__ytDlpRetryIncludeSubtitles)).toEqual([false])

    await watchView.evaluate(async (view) => {
      view.errorMessage = 'The yt-dlp extraction failed'
      await view.$nextTick()
      await view.retryWithOtherPlaybackEngine()
    })
    await expect.poll(() => watchView.evaluate((view) => ({
      activeEngine: view.activePlaybackEngine,
      errorMessage: view.errorMessage,
      manifest: view.manifestSrc,
      streamsPending: view.ytDlpStreamsPending
    }))).toEqual({
      activeEngine: 'built-in',
      errorMessage: null,
      manifest: builtInManifest,
      streamsPending: false
    })
    await waitForPlayback(page)
    expect(await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.getters.getVideoPlaybackEngine
    })).toBe('built-in')

    expect(await watchView.evaluate(async (view) => {
      view.captions = []
      view.playbackEngineFallbackTarget = 'yt-dlp'
      return view.extractYtDlpPlaybackSource(
        view.videoLoadGeneration,
        view.videoId,
        view.playbackEngineSwitchGeneration
      )
    })).toBe(true)
    expect(await app.electronApp.evaluate(() => globalThis.__ytDlpRetryIncludeSubtitles))
      .toEqual([false, true, true, true])
  })

  test('shows the automatic yt-dlp live fallback while streams are pending', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const watchView = await watchViewHandle(page)
    await watchView.evaluate(async (view) => {
      view.isLive = true
      view.manifestSrc = null
      view.legacyFormats = []
      view.playbackEngineFallbackTarget = null
      view.ytDlpStreamsPending = true
      await view.$nextTick()
    })

    await page.getByRole('button', { name: 'Change Media Formats' }).click()
    const prompt = page.getByRole('dialog', { name: 'Change Media Formats' })
    const ytDlp = prompt.getByRole('button', { name: 'yt-dlp' })
    const builtIn = prompt.getByRole('button', { name: 'Built-in' })

    await expect(ytDlp).toHaveAttribute('aria-pressed', 'true')
    await expect(builtIn).toHaveAttribute('aria-pressed', 'false')
    await expect(ytDlp.locator('.engineOptionCheck')).toBeVisible()
    await expect(builtIn.locator('.engineOptionCheck')).toHaveCount(0)
    await expect(prompt.locator('.engineBadge')).toHaveText('yt-dlp')
    await expect(prompt.getByTitle('Streaming protocol')).toHaveCount(0)

    await builtIn.click()
    await expect(prompt).toHaveCount(0)
    expect(await watchView.evaluate((view) => ({
      pending: view.ytDlpStreamsPending,
      target: view.playbackEngineFallbackTarget
    }))).toEqual({
      pending: false,
      target: 'built-in'
    })
  })

  test('shares a pending yt-dlp extraction after rapid engine switches', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.route('https://example.invalid/*.m3u8', route => route.fulfill({
      contentType: 'application/x-mpegURL',
      body: '#EXTM3U\n'
    }))
    await openMockedVideo(page)

    await app.electronApp.evaluate(({ ipcMain }) => {
      globalThis.__ytDlpPlaybackResolvers = []
      ipcMain.removeHandler('yt-dlp-get-playback-info')
      ipcMain.handle('yt-dlp-get-playback-info', () => new Promise(resolve => {
        globalThis.__ytDlpPlaybackResolvers.push(resolve)
      }))
    })

    const watchView = await watchViewHandle(page)
    const builtInManifest = await watchView.evaluate((view) => view.manifestSrc)
    await watchView.evaluate((view) => {
      window.__firstEngineSwitch = view.handlePlaybackEngineChange('yt-dlp')
    })
    await expect.poll(() => app.electronApp.evaluate(
      () => globalThis.__ytDlpPlaybackResolvers.length
    )).toBe(1)

    await watchView.evaluate(async (view) => {
      await view.handlePlaybackEngineChange('built-in')
      window.__secondEngineSwitch = view.handlePlaybackEngineChange('yt-dlp')
    })
    expect(await app.electronApp.evaluate(
      () => globalThis.__ytDlpPlaybackResolvers.length
    )).toBe(1)

    await app.electronApp.evaluate(() => {
      globalThis.__ytDlpPlaybackResolvers.shift()({
        isLive: true,
        liveStatus: 'is_live',
        hlsManifestUrl: 'https://example.invalid/shared.m3u8',
        formats: [],
        duration: null,
        version: 'shared'
      })
    })
    await page.evaluate(() => Promise.all([
      window.__firstEngineSwitch,
      window.__secondEngineSwitch
    ]))
    expect(await watchView.evaluate((view) => ({
      activeEngine: view.activePlaybackEngine,
      builtInManifest: view.builtInPlaybackSource.manifestSrc,
      manifest: view.manifestSrc,
      pending: view.ytDlpStreamsPending,
      version: view.activePlaybackEngineVersion
    }))).toEqual({
      activeEngine: 'yt-dlp',
      builtInManifest,
      manifest: 'https://example.invalid/shared.m3u8',
      pending: false,
      version: 'shared'
    })
  })

  test('preloads the configured number of upcoming yt-dlp recommendations', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    await app.electronApp.evaluate(({ ipcMain }) => {
      globalThis.__ytDlpPreloadCalls = []
      ipcMain.removeHandler('yt-dlp-get-playback-info')
      ipcMain.handle('yt-dlp-get-playback-info', (_event, videoId) => {
        globalThis.__ytDlpPreloadCalls.push(videoId)
        return { error: 'expected test extraction failure' }
      })
    })

    const watchView = await watchViewHandle(page)
    await watchView.evaluate(async (view) => {
      view.recommendedVideos = [
        { videoId: 'nextvideo01', title: 'First recommendation' },
        { videoId: 'nextvideo02', title: 'Second recommendation' },
        { videoId: 'nextvideo03', title: 'Third recommendation' }
      ]
      await view.$store.dispatch('updateYtDlpPreloadCount', 2)
      await view.$store.dispatch('updateYtDlpPreloadEnabled', true)
      await view.$store.dispatch('updateVideoPlaybackEngine', 'yt-dlp')
    })

    await expect.poll(() => app.electronApp.evaluate(() => [
      ...new Set(globalThis.__ytDlpPreloadCalls.filter(videoId => videoId.startsWith('nextvideo')))
    ])).toEqual(['nextvideo01', 'nextvideo02'])
  })

  test('an IP-blocked playback fallback retries yt-dlp with its default clients', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.route('https://example.invalid/rejected.m3u8', route => route.fulfill({
      contentType: 'text/html',
      body: '<html>expired</html>'
    }))
    await app.electronApp.evaluate(({ ipcMain }) => {
      globalThis.__ytDlpIpBlockFallbackCalls = 0
      globalThis.__ytDlpIpBlockFallbackDefaultClients = []
      ipcMain.removeHandler('yt-dlp-get-playback-info')
      ipcMain.handle('yt-dlp-get-playback-info', (_event, _videoId, useDefaultClients) => {
        globalThis.__ytDlpIpBlockFallbackCalls++
        globalThis.__ytDlpIpBlockFallbackDefaultClients.push(useDefaultClients)
        return globalThis.__ytDlpIpBlockFallbackCalls <= 2
          ? {
              isLive: true,
              liveStatus: 'is_live',
              hlsManifestUrl: 'https://example.invalid/rejected.m3u8',
              formats: [],
              duration: null,
              version: 'test'
            }
          : { error: 'ENOENT' }
      })
    })

    await openMockedVideo(page)
    const watchView = await watchViewHandle(page)
    await watchView.evaluate(async (view) => {
      view.ipBlockDetectedInCurrentChain = true
      view.playbackEngineFallbackAttemptedForCurrentVideo = true
      view.playbackEngineFallbackTarget = 'yt-dlp'
      view.runIpBlockRecoveryScriptAndReload = async () => false
      await view.applyYtDlpPlaybackSource(view.videoLoadGeneration, view.videoId)
    })

    await expect.poll(() => app.electronApp.evaluate(() => globalThis.__ytDlpIpBlockFallbackCalls)).toBe(3)
    expect(await app.electronApp.evaluate(() => globalThis.__ytDlpIpBlockFallbackDefaultClients)).toEqual([false, true, true])
    await expect(page.locator('.toast', {
      hasText: 'The preferred yt-dlp clients could not provide playable streams'
    })).toHaveCount(1)
    expect(await watchView.evaluate((view) => ({
      ipBlockDetected: view.ipBlockDetectedInCurrentChain,
      fallbackAttempted: view.playbackEngineFallbackAttemptedForCurrentVideo,
      fallbackTarget: view.playbackEngineFallbackTarget
    }))).toEqual({
      ipBlockDetected: true,
      fallbackAttempted: true,
      fallbackTarget: null
    })

    expect(await watchView.evaluate(async (view) => {
      let recoveryCalls = 0
      view.ipBlockDetectedInCurrentChain = true
      view.playbackEngineFallbackTarget = 'yt-dlp'
      view.extractYtDlpPlaybackSource = async () => false
      view.runIpBlockRecoveryScriptAndReload = async () => {
        recoveryCalls++
        return true
      }
      await view.applyYtDlpPlaybackSource(view.videoLoadGeneration, view.videoId)
      return recoveryCalls
    })).toBe(1)
  })

  test('retries yt-dlp with its default clients for a limited live DVR manifest', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.route(/^https:\/\/example\.invalid\/.*\.m3u8$/, route => route.fulfill({
      contentType: 'application/x-mpegURL',
      body: '#EXTM3U\n'
    }))
    await openMockedVideo(page)

    await app.electronApp.evaluate(({ ipcMain }) => {
      globalThis.__ytDlpLiveDvrFallbackDefaultClients = []
      ipcMain.removeHandler('yt-dlp-get-playback-info')
      ipcMain.handle('yt-dlp-get-playback-info', (_event, _videoId, useDefaultClients) => {
        globalThis.__ytDlpLiveDvrFallbackDefaultClients.push(useDefaultClients)
        return {
          isLive: true,
          liveStatus: 'is_live',
          hlsManifestUrl: useDefaultClients
            ? 'https://example.invalid/playlist_type/DVR/full.m3u8'
            : 'https://example.invalid/manifest_duration/30/limited.m3u8',
          formats: [],
          duration: null,
          version: 'test'
        }
      })
    })

    const watchView = await watchViewHandle(page)
    await watchView.evaluate((view) => view.handlePlaybackEngineChange('yt-dlp'))

    expect(await app.electronApp.evaluate(
      () => globalThis.__ytDlpLiveDvrFallbackDefaultClients
    )).toEqual([false, true])
    expect(await watchView.evaluate((view) => ({
      activeEngine: view.activePlaybackEngine,
      manifest: view.manifestSrc
    }))).toEqual({
      activeEngine: 'yt-dlp',
      manifest: 'https://example.invalid/playlist_type/DVR/full.m3u8'
    })

    // A stream error can cause a fresh extraction for the same video. The retry
    // still uses the default clients, but should not repeat the same notification.
    await watchView.evaluate((view) => view.extractYtDlpPlaybackSource(
      view.videoLoadGeneration,
      view.videoId,
      view.playbackEngineSwitchGeneration
    ))
    expect(await app.electronApp.evaluate(
      () => globalThis.__ytDlpLiveDvrFallbackDefaultClients
    )).toEqual([false, true, false, true])
    await expect(page.locator('.toast', {
      hasText: 'The preferred yt-dlp clients could not provide playable streams'
    })).toHaveCount(1)
  })

  test('treats yt-dlp live status as live and does not cache its HLS source', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.route('https://example.invalid/live-status.m3u8', route => route.fulfill({
      contentType: 'application/x-mpegURL',
      body: '#EXTM3U\n'
    }))
    await openMockedVideo(page)

    await app.electronApp.evaluate(({ ipcMain }) => {
      globalThis.__ytDlpLiveStatusCalls = 0
      ipcMain.removeHandler('yt-dlp-get-playback-info')
      ipcMain.handle('yt-dlp-get-playback-info', () => {
        globalThis.__ytDlpLiveStatusCalls++
        return {
          isLive: false,
          liveStatus: 'is_live',
          hlsManifestUrl: 'https://example.invalid/live-status.m3u8',
          formats: [{
            url: 'https://example.invalid/live-segment.mp4?expire=4102444800',
            protocol: 'https',
            vcodec: null,
            acodec: null
          }],
          duration: null,
          storyboardVtt: null,
          title: 'Live video',
          version: 'test'
        }
      })
    })

    const watchView = await watchViewHandle(page)
    await watchView.evaluate((view) => view.handlePlaybackEngineChange('yt-dlp'))
    expect(await watchView.evaluate((view) => view.isLive)).toBe(true)

    await watchView.evaluate((view) => view.extractYtDlpPlaybackSource(
      view.videoLoadGeneration,
      view.videoId,
      view.playbackEngineSwitchGeneration
    ))
    expect(await app.electronApp.evaluate(() => globalThis.__ytDlpLiveStatusCalls)).toBe(2)
  })

  test('falls back to yt-dlp when the built-in live source has no manifest', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.route('https://example.invalid/live.m3u8', route => route.fulfill({
      contentType: 'application/x-mpegURL',
      body: '#EXTM3U\n'
    }))
    await page.route('https://example.invalid/rejected.mp4', route => route.fulfill({ status: 403 }))
    await openMockedVideo(page)

    await app.electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('yt-dlp-get-playback-info')
      ipcMain.handle('yt-dlp-get-playback-info', () => ({
        isLive: true,
        liveStatus: 'is_live',
        hlsManifestUrl: 'https://example.invalid/live.m3u8',
        formats: [{
          formatId: '18',
          url: 'https://example.invalid/rejected.mp4',
          protocol: 'https',
          ext: 'mp4',
          vcodec: 'avc1',
          acodec: 'mp4a',
          width: 640,
          height: 360,
          fps: 30,
          bitrate: 500_000,
          audioSampleRate: 44_100,
          audioChannels: 2,
          language: null,
          formatNote: null,
          dynamicRange: 'SDR',
          availableAt: null
        }],
        duration: null,
        version: 'test'
      }))
    })

    const watchView = await watchViewHandle(page)
    await watchView.evaluate(async (view) => {
      view.isLoading = false
      view.errorMessage = 'Previous playback source failed'
      view.videoTitle = 'Active live stream'
      view.isLive = true
      view.manifestSrc = null
      view.legacyFormats = []
      view.activeFormat = 'legacy'
      view.activePlaybackEngine = 'built-in'
      await view.applyYtDlpPlaybackSource(view.videoLoadGeneration, view.videoId)
      await view.$nextTick()
    })

    await expect(page.locator(`${activeTab} .videoTitle`)).toHaveText('Active live stream')
    expect(await watchView.evaluate((view) => ({
      manifestSrc: view.manifestSrc,
      activeFormat: view.activeFormat,
      activePlaybackEngine: view.activePlaybackEngine,
      activePlaybackEngineVersion: view.activePlaybackEngineVersion,
      errorMessage: view.errorMessage,
      legacyFormats: view.legacyFormats,
      playerReady: view.playerReady,
      ytDlpStreamsPending: view.ytDlpStreamsPending
    }))).toEqual({
      manifestSrc: 'https://example.invalid/live.m3u8',
      activeFormat: 'dash',
      activePlaybackEngine: 'yt-dlp',
      activePlaybackEngineVersion: 'test',
      errorMessage: null,
      legacyFormats: [],
      playerReady: true,
      ytDlpStreamsPending: false
    })
  })

  test('uses yt-dlp for a recently ended live stream after the built-in source fails', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await routePostLiveMedia(page)
    await page.route(/\/youtubei\/v1\/player/, (route, request) => {
      const videoId = JSON.parse(request.postData() ?? '{}').videoId ?? 'jNQXAC9IVRw'
      const response = demoPlayerResponse(videoId)
      response.videoDetails.isLiveContent = true
      response.videoDetails.isPostLiveDvr = true
      response.streamingData = {
        expiresInSeconds: '21540',
        formats: [],
        adaptiveFormats: [],
        dashManifestUrl: 'https://example.invalid/rejected-post-live.mpd'
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response)
      })
    })
    let rejectedManifestRequests = 0
    await page.route(/^https:\/\/example\.invalid\/api\/manifest\/dash\//, route => {
      rejectedManifestRequests++
      return route.fulfill({ status: 403 })
    })

    await app.electronApp.evaluate(({ ipcMain }, urls) => {
      globalThis.__ytDlpPostLiveCalls = 0
      ipcMain.removeHandler('yt-dlp-get-playback-info')
      ipcMain.handle('yt-dlp-get-playback-info', () => {
        globalThis.__ytDlpPostLiveCalls++
        return {
          isLive: false,
          liveStatus: 'post_live',
          hlsManifestUrl: null,
          formats: [{
            formatId: '134',
            url: urls.video,
            manifestUrl: null,
            protocol: 'http_dash_segments',
            ext: 'mp4',
            container: 'mp4_dash',
            vcodec: 'avc1.42c00d',
            acodec: 'none',
            width: 320,
            height: 180,
            fps: 30,
            bitrate: 20_000,
            audioSampleRate: null,
            audioChannels: null,
            language: null,
            formatNote: '180p',
            dynamicRange: 'SDR',
            availableAt: null,
            targetDuration: 2,
            fragmentCount: 1
          }, {
            formatId: '140',
            url: urls.audio,
            manifestUrl: null,
            protocol: 'http_dash_segments',
            ext: 'm4a',
            container: 'm4a_dash',
            vcodec: 'none',
            acodec: 'mp4a.40.2',
            width: null,
            height: null,
            fps: null,
            bitrate: 64_000,
            audioSampleRate: 44_100,
            audioChannels: 2,
            language: null,
            formatNote: 'medium',
            dynamicRange: null,
            availableAt: null,
            targetDuration: 2,
            fragmentCount: 1
          }],
          duration: 2,
          storyboardVtt: null,
          title: 'Recently ended live stream',
          captions: [],
          captionTranslations: [],
          version: 'test'
        }
      })
    }, { audio: POST_LIVE_AUDIO_URL, video: POST_LIVE_VIDEO_URL })
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateVideoPlaybackEngine', 'built-in')
    })

    await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
    await expect(page.locator(`${activeTab} .videoTitle`)).toBeVisible()

    const watchView = await watchViewHandle(page)
    await expect.poll(() => watchView.evaluate((view) => ({
      activeEngine: view.activePlaybackEngine,
      errorMessage: view.errorMessage,
      postLive: view.isPostLiveDvr,
      streamsPending: view.ytDlpStreamsPending
    })), { timeout: 15_000 }).toEqual({
      activeEngine: 'yt-dlp',
      errorMessage: null,
      postLive: true,
      streamsPending: false
    })

    expect(rejectedManifestRequests).toBeGreaterThan(0)
    expect(await app.electronApp.evaluate(() => globalThis.__ytDlpPostLiveCalls)).toBe(1)
    await waitForPlayback(page)

    await page.getByRole('button', { name: 'Change Media Formats' }).click()
    const prompt = page.getByRole('dialog', { name: 'Change Media Formats' })
    await expect(prompt.getByRole('button', { name: 'yt-dlp' })).toBeEnabled()
    await expect(prompt.getByRole('button', { name: 'Built-in' })).toBeEnabled()
  })

  test('does not override a manual built-in selection when its live source is unavailable', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const watchView = await watchViewHandle(page)
    const result = await watchView.evaluate(async (view) => {
      view.isLive = true
      view.isPostLiveDvr = false
      view.manifestSrc = null
      view.legacyFormats = []
      view.activePlaybackEngine = 'built-in'
      view.playbackEngineFallbackTarget = 'built-in'
      view.ytDlpStreamsPending = true
      view.errorMessage = null

      await view.applyYtDlpPlaybackSource(view.videoLoadGeneration, view.videoId)

      return {
        activeEngine: view.activePlaybackEngine,
        fallbackTarget: view.playbackEngineFallbackTarget,
        pending: view.ytDlpStreamsPending,
        errorMessage: view.errorMessage
      }
    })

    expect(result).toEqual({
      activeEngine: 'built-in',
      fallbackTarget: 'built-in',
      pending: false,
      errorMessage: 'This video is unavailable because of missing formats. This can happen due to country unavailability.'
    })
  })

  test('does not speculate about live chat while availability loads', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)

    let releaseMetadata
    await page.route(/\/youtubei\/v1\/next/, async (route) => {
      await new Promise(resolve => { releaseMetadata = resolve })
      await route.fallback()
    })

    await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
    await expect(page.locator(`${activeTab} .sidebarArea > .liveChatSkeleton`)).toHaveCount(0)
    await expect(page.locator(`${activeTab} .sidebarArea > .recommendationsSkeleton`)).toBeVisible()

    await expect.poll(() => typeof releaseMetadata).toBe('function')
    releaseMetadata()
    await expect(page.locator(`${activeTab} .ftVideoPlayer`)).toBeVisible()
  })

  test('retries failed live chat avatars and preserves the pop-out target', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    let avatarRequests = 0
    await page.route('https://yt3.ggpht.com/e2e-live-chat-avatar*', (route) => {
      avatarRequests++
      return route.fulfill({ status: 500, body: '' })
    })

    const watchView = await watchViewHandle(page)
    await watchView.evaluate(async (view) => {
      const listeners = new Map()
      const liveChat = new EventTarget()
      liveChat.is_replay = false
      liveChat.on = (event, listener) => {
        listeners.set(listener, event)
        liveChat.addEventListener(event, listener)
      }
      liveChat.once = (event, listener) => {
        listeners.set(listener, event)
        liveChat.addEventListener(event, listener, { once: true })
      }
      liveChat.off = (_event, listener) => {
        liveChat.removeEventListener(listeners.get(listener), listener)
        listeners.delete(listener)
      }
      liveChat.emit = (event, value) => {
        for (const [listener, listenerEvent] of listeners) {
          if (listenerEvent === event) listener(value)
        }
      }
      liveChat.start = () => {}
      liveChat.stop = () => {}

      view.$store.commit('setHideLiveChat', false)
      view.liveChat = liveChat
      view.liveChatIsReplay = false
      view.liveChatOpen = true
      view.isLive = true
      view.isUpcoming = false
      await view.$nextTick()
    })

    await expect(page.locator(`${activeTab} .liveChatSkeleton`)).toBeVisible()
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateExternalLinkHandling', '')
      window.__e2eOpenedExternalUrl = null
      window.open = (url) => {
        window.__e2eOpenedExternalUrl = String(url)
        return null
      }
    })
    await page.getByRole('link', { name: 'Popout Chat' }).click()
    await expect.poll(() => page.evaluate(() => window.__e2eOpenedExternalUrl))
      .toBe('https://www.youtube.com/live_chat?is_popout=1&v=jNQXAC9IVRw')
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)

    await watchView.evaluate((view) => {
      let actionTypeChecks = 0
      view.liveChat.emit('start', {
        actions: [{
          is: () => ++actionTypeChecks === 2,
          item: {
            is: () => true,
            id: 'avatar-retry-message',
            timestamp: Date.now(),
            message: { runs: [{ text: 'Avatar retry' }] },
            author: {
              badges: [],
              id: 'avatar-retry-author',
              name: 'Avatar retry author',
              thumbnails: [{ url: 'https://yt3.ggpht.com/e2e-live-chat-avatar' }],
              is_moderator: false
            }
          }
        }]
      })
    })

    const avatar = page.locator(`${activeTab} .liveChatComments .channelThumbnail`).first()
    await expect(avatar).toHaveAttribute('src', /e2e-live-chat-avatar/)
    await expect.poll(() => avatarRequests, { timeout: 6_000 }).toBeGreaterThanOrEqual(2)
    await expect(avatar).toHaveAttribute('src', /opentubex_retry=/)
  })

  test('keeps live chat and replay visibility independent and restores a closed chat', async ({ app, page, attachScreenshot }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const watchView = await watchViewHandle(page)
    await watchView.evaluate(async (view) => {
      const listeners = new Map()
      const liveChat = new EventTarget()
      liveChat.is_replay = true
      liveChat.on = (event, listener) => {
        listeners.set(listener, event)
        liveChat.addEventListener(event, listener)
      }
      liveChat.once = (event, listener) => {
        listeners.set(listener, event)
        liveChat.addEventListener(event, listener, { once: true })
      }
      liveChat.off = (_event, listener) => {
        liveChat.removeEventListener(listeners.get(listener), listener)
        listeners.delete(listener)
      }
      liveChat.emit = (event, value) => {
        for (const [listener, listenerEvent] of listeners) {
          if (listenerEvent === event) {
            listener(value)
          }
        }
      }
      liveChat.start = () => {}
      liveChat.stop = () => {}

      view.$store.commit('setHideLiveChat', true)
      view.$store.commit('setHideLiveChatReplay', false)
      view.liveChat = liveChat
      view.liveChatIsReplay = true
      view.liveChatOpen = true
      view.isLive = false
      view.isUpcoming = false
      await view.$nextTick()
    })

    const replay = page.locator(`${activeTab} .watchVideoPlaylist`).filter({ hasText: 'Live Chat Replay' })
    await expect(replay).toBeVisible()
    const skeleton = replay.locator('.liveChatSkeleton')
    await expect(skeleton).toBeVisible()
    await expect(skeleton.locator('.liveChatSkeletonMessage')).toHaveCount(24)
    expect(await skeleton.evaluate((element) => {
      const firstMessage = element.querySelector('.liveChatSkeletonMessage')
      const avatar = firstMessage.querySelector('.liveChatSkeletonAvatar')
      const author = firstMessage.querySelector('.liveChatSkeletonAuthor')
      const text = firstMessage.querySelector('.liveChatSkeletonText')
      const skeletonRect = element.getBoundingClientRect()

      return {
        avatarInset: avatar.getBoundingClientRect().top - skeletonRect.top,
        clipsOverflow: element.scrollHeight > element.clientHeight &&
          getComputedStyle(element).overflowY === 'hidden',
        linesAligned: Math.abs(author.getBoundingClientRect().top - text.getBoundingClientRect().top) <= 1
      }
    })).toEqual({
      avatarInset: 5,
      clipsOverflow: true,
      linesAligned: true
    })
    const skeletonLines = skeleton.locator('.liveChatSkeletonContent').first().locator('div')
    await expect(skeletonLines.nth(0)).toHaveCSS('block-size', '10px')
    await expect(skeletonLines.nth(1)).toHaveCSS('block-size', '10px')

    await setPlayerFullscreen(page, true)
    await page.locator('video.player').evaluate(element => element.pause())
    const fullscreenLiveChatToggle = page.locator('.fullscreenLiveChatToggle')
    await fullscreenLiveChatToggle.click({ force: true })
    const fullscreenChat = page.locator('.fullscreenLiveChatOverlay.open')
    const fullscreenSkeleton = fullscreenChat.locator('.liveChatSkeleton')
    await expect(fullscreenSkeleton).toBeVisible()
    const fullscreenSkeletonGeometry = await fullscreenSkeleton.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      const firstMessageBounds = element.firstElementChild.getBoundingClientRect()
      const lastMessageBounds = element.lastElementChild.getBoundingClientRect()

      return {
        firstMessageInlineInset: Math.round(firstMessageBounds.left - bounds.left),
        lastMessageBlockInset: Math.round(bounds.bottom - lastMessageBounds.bottom)
      }
    })
    expect(fullscreenSkeletonGeometry.firstMessageInlineInset).toBe(16)
    expect(fullscreenSkeletonGeometry.lastMessageBlockInset).toBeGreaterThanOrEqual(0)
    expect(fullscreenSkeletonGeometry.lastMessageBlockInset).toBeLessThan(30)

    await watchView.evaluate((view) => {
      const actions = Array.from({ length: 60 }, (_, index) => {
        let actionTypeChecks = 0
        return {
          is: () => ++actionTypeChecks === 2,
          item: {
            is: () => true,
            id: `mock-live-chat-message-${index}`,
            timestamp: Date.now(),
            message: { runs: [{ text: `Mock live chat message ${index}` }] },
            author: {
              badges: [],
              id: `mock-live-chat-author-${index}`,
              name: `Chat author ${index}`,
              thumbnails: [{ url: '' }],
              is_moderator: false
            }
          }
        }
      })
      view.liveChat.emit('start', { actions })
    })

    const liveChatComments = fullscreenChat.locator('.liveChatComments')
    await expect(liveChatComments).toBeVisible()
    await expect(liveChatComments).toHaveClass(/atLiveEdge/)
    await expect.poll(() => liveChatComments.evaluate(
      element => element.scrollHeight > element.clientHeight
    )).toBe(true)
    await liveChatComments.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => liveChatComments.evaluate(
      element => element.scrollTop
    )).toBeGreaterThan(0)

    const readbackAnchor = liveChatComments.locator('.comment').filter({
      has: page.getByText('Mock live chat message 30', { exact: true })
    })
    await liveChatComments.dispatchEvent('wheel')
    await liveChatComments.evaluate((element) => {
      const anchor = Array.from(element.querySelectorAll('.comment'))
        .find(comment => comment.querySelector('.chatMessage')?.textContent === 'Mock live chat message 30')
      element.scrollTop = anchor.offsetTop
    })
    const anchorTop = await readbackAnchor.evaluate((element) => (
      element.getBoundingClientRect().top - element.closest('.liveChatComments').getBoundingClientRect().top
    ))

    await watchView.evaluate((view) => {
      for (let index = 60; index < 520; index++) {
        let actionTypeChecks = 0
        view.liveChat.emit('chat-update', {
          is: () => ++actionTypeChecks === 2,
          item: {
            is: () => true,
            id: `mock-live-chat-message-${index}`,
            timestamp: Date.now(),
            message: { runs: [{ text: `Mock live chat message ${index}` }] },
            author: {
              badges: [],
              id: `mock-live-chat-author-${index}`,
              name: `Chat author ${index}`,
              thumbnails: [{ url: '' }],
              is_moderator: false
            }
          }
        })
      }
    })

    await expect(liveChatComments.locator('.comment')).toHaveCount(500)
    await expect(liveChatComments.locator('.chatMessage').first()).toHaveText('Mock live chat message 20')
    await expect.poll(() => readbackAnchor.evaluate((element) => Math.round(
      element.getBoundingClientRect().top - element.closest('.liveChatComments').getBoundingClientRect().top
    ))).toBe(Math.round(anchorTop))
    expect(await liveChatComments.evaluate((element) => {
      const content = element.querySelector('.liveChatCommentList')
      const maximumScrollTop = Math.max(0, content.offsetTop + content.offsetHeight - element.clientHeight)
      return {
        maximumScrollTop,
        overflowing: maximumScrollTop > 0,
        scrollTop: element.scrollTop,
        withinRange: element.scrollTop <= maximumScrollTop + 1
      }
    })).toMatchObject({ overflowing: true, withinRange: true })
    await expect(liveChatComments.locator(':scope > .os-scrollbar-vertical'))
      .not.toHaveClass(/os-scrollbar-unusable/)
    await fullscreenChat.getByRole('button', { name: 'Scroll to Bottom' }).click()

    await page.locator('.fullscreenCommentsToggle').click({ force: true })
    await expect(page.locator('.fullscreenCommentsOverlay.open')).toBeVisible()
    await expect.poll(() => liveChatComments.evaluate(element =>
      Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop)
    )).toBeLessThanOrEqual(1)
    await page.locator('.fullscreenCommentsToggle').click({ force: true })
    await expect(page.locator('.fullscreenCommentsOverlay.open')).toHaveCount(0)

    await liveChatComments.locator('.comment').evaluateAll((comments) => {
      for (const comment of comments.slice(3)) {
        comment.style.display = 'none'
      }
    })
    await expect.poll(() => liveChatComments.evaluate(element => ({
      fits: element.scrollHeight <= element.clientHeight,
      scrollTop: element.scrollTop
    }))).toEqual({ fits: true, scrollTop: 0 })
    await expect(liveChatComments.locator(':scope > .os-scrollbar-vertical'))
      .toHaveClass(/os-scrollbar-unusable/)

    await fullscreenLiveChatToggle.click({ force: true })
    await expect(fullscreenChat).toHaveCount(0)
    await setPlayerFullscreen(page, false)
    await watchView.evaluate((view) => {
      view.liveChat.dispatchEvent(new ErrorEvent('error', { message: 'Unavailable' }))
    })
    await expect(replay.locator('.messageContainer.hasError')).toBeVisible()
    await expect(replay.locator('.titleContainer')).toHaveCSS('margin-block-start', '0px')
    await replay.getByRole('button', { name: 'Close Live Chat Replay' }).click()
    await expect(replay).toHaveCount(0)

    const replayToggle = page.getByTitle('Show Live Chat Replay')
    await expect(replayToggle).toBeVisible()
    await replayToggle.click()
    await expect(replay).toBeVisible()
    await expect(replay.getByRole('button', { name: 'Close Live Chat Replay' })).toBeVisible()

    await watchView.evaluate(async (view) => {
      view.$store.commit('setHideLiveChat', false)
      view.$store.commit('setHideLiveChatReplay', true)
      await view.$nextTick()
    })
    await expect(replay).toHaveCount(0)
    await expect(page.getByTitle('Show Live Chat Replay')).toHaveCount(0)

    await watchView.evaluate(async (view) => {
      view.liveChat.is_replay = false
      view.liveChatIsReplay = false
      view.isLive = true
      await view.$nextTick()
    })
    const activeChat = page.locator(`${activeTab} .watchVideoPlaylist`).filter({ hasText: 'Live Chat' })
    await expect(activeChat).toBeVisible()
    await activeChat.getByRole('button', { name: 'Close Live Chat' }).click()
    await expect(activeChat).toHaveCount(0)

    const activeChatToggle = page.getByTitle('Show Live Chat')
    await expect(activeChatToggle).toBeVisible()
    await activeChatToggle.click()
    await expect(activeChat).toBeVisible()

    await activeChat.locator('.liveChatSkeleton').evaluate(element => {
      const owner = document.createElement('a')
      owner.className = 'channelName owner'
      owner.textContent = 'Channel owner'
      for (const attribute of element.getAttributeNames()) {
        if (attribute.startsWith('data-v-')) {
          owner.setAttribute(attribute, '')
        }
      }
      element.replaceWith(owner)
    })

    const owner = activeChat.locator('.channelName.owner', { hasText: 'Channel owner' })
    await expect(owner).toHaveCSS('border-radius', '2px')
    await page.locator('body').evaluate(element => {
      element.style.setProperty('--ui-roundness', '2')
    })
    await expect(owner).toHaveCSS('border-radius', '4px')
    await attachScreenshot('rounded live chat owner label')

    await watchView.evaluate(async (view) => {
      view.$store.commit('setHideLiveChat', true)
      await view.$nextTick()
    })
    await expect(activeChat).toHaveCount(0)
  })

  test('transitions a premiere when relative timestamp updates are disabled', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await page.clock.install({ time: Date.now() })

    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await watchComponent.evaluate(async (component) => {
      const watchView = component.proxy
      watchView.$store.commit('setUpdateRelativeTimestamps', false)
      watchView.isLoading = false
      watchView.errorMessage = ''
      watchView.isUpcoming = true
      watchView.playabilityStatus = 'UNPLAYABLE'
      watchView.upcomingTimestamp = 'August 11 at 5:00 PM'
      watchView.upcomingTimeLeft = 'in less than a minute'
      watchView.premiereDate = new Date(Date.now() + 60_000)
      watchView.scheduleLiveReminderStartInvalidation()
      await watchView.$nextTick()
    })

    await expect(page.locator(`${activeTab} .premiereTextTimeLeft`)).toHaveCount(1)

    await page.clock.fastForward(60_001)

    await expect(page.locator(`${activeTab} .premiereTextTimeLeft`)).toHaveCount(0)
    await expect(page.locator(`${activeTab} .premiereText`)).toHaveText(
      'Starting soon, please refresh the page to check again'
    )
  })

  test('keeps original video titles in end-screen annotations', async ({ app, page }) => {
    await mockTranslatedEndscreen(app, page)
    await page.route(/\/oembed\?/, route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ title: 'Original end-screen title' })
    }))

    await openMockedVideo(page)
    await waitForPlayback(page)

    await expect(page.locator(`${activeTab} .annotationTitleText`))
      .toHaveText('Original end-screen title')
  })

  test('does not replace an end-screen title after original text is disabled', async ({ app, page }) => {
    await mockTranslatedEndscreen(app, page)

    let releaseOembed
    let markOembedRequested
    const oembedRequested = new Promise((resolve) => { markOembedRequested = resolve })
    await page.route(/\/oembed\?/, async (route) => {
      markOembedRequested()
      await new Promise((resolve) => { releaseOembed = resolve })
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ title: 'Original end-screen title' })
      })
    })

    await openMockedVideo(page)
    await waitForPlayback(page)
    await oembedRequested

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateAvoidTranslation', 'disabled')
    })
    const oembedResponse = page.waitForResponse(/\/oembed\?/)
    releaseOembed()
    await oembedResponse
    await page.waitForTimeout(100)

    await expect(page.locator(`${activeTab} .annotationTitleText`))
      .toHaveText('Translated end-screen title')
  })

  test('shows tags below the description and copies the description', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const videoDescription = Array(30).fill('Description to copy').join('\n')
    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await watchComponent.evaluate(async (component, description) => {
      const watchView = component.proxy
      watchView.isLoading = true
      await watchView.$nextTick()
      watchView.videoDescription = description
      watchView.videoDescriptionHtml = ''
      watchView.videoTags = ['first tag', 'second tag']
      watchView.isLoading = false
      await watchView.$nextTick()
    }, videoDescription)

    const description = page.locator(`${activeTab} .videoDescription`)
    const descriptionText = description.locator('.description')
    const tags = description.locator('.videoTags')
    const expandControl = description.locator(':scope > .descriptionStatus')
    const copyButton = description.locator('.descriptionCopyButton')
    const controlsOverlap = async () => expandControl.evaluate((element, copyButtonElement) => {
      const expandRect = element.getBoundingClientRect()
      const copyRect = copyButtonElement.getBoundingClientRect()
      return (
        expandRect.top < copyRect.bottom &&
        expandRect.bottom > copyRect.top &&
        expandRect.left < copyRect.right &&
        expandRect.right > copyRect.left
      )
    }, await copyButton.elementHandle())

    await description.evaluate(element => { element.style.height = '70px' })
    await expect(expandControl).toHaveClass(/avoidCopyButton/)
    expect(await controlsOverlap()).toBe(false)

    await description.evaluate(element => { element.style.height = '160px' })
    await expect(expandControl).not.toHaveClass(/avoidCopyButton/)
    await expect(expandControl).toHaveCSS('inset-inline-end', '16px')

    await description.evaluate(element => {
      element.dir = 'rtl'
      element.style.height = '70px'
    })
    await expect(expandControl).toHaveClass(/avoidCopyButton/)
    expect(await controlsOverlap()).toBe(false)

    await description.evaluate(element => { element.style.height = '' })

    await expandControl.click()
    await expect(tags.locator('.videoTagLink')).toHaveText(['first tag', 'second tag'])
    await expect(tags.locator('.videoTagLink').first()).toHaveAttribute('href', /\/search\/first%20tag/)
    await expect(description.locator('.descriptionScroll')).toHaveCSS('overflow-anchor', 'none')
    expect(await descriptionText.evaluate((element, tagsElement) => (
      Boolean(element.compareDocumentPosition(tagsElement) & Node.DOCUMENT_POSITION_FOLLOWING)
    ), await tags.elementHandle())).toBe(true)
    expect(await tags.evaluate(element => element.closest('.descriptionScroll') !== null)).toBe(true)
    const descriptionScroll = description.locator('.descriptionScroll')
    expect(await descriptionScroll.evaluate(element => getComputedStyle(element).maskImage))
      .toContain('linear-gradient')
    await expect(descriptionScroll).not.toHaveClass(/descriptionFadeTop/)
    const collapseControl = description.locator('.descriptionScroll > .descriptionStatus')
    await expect(collapseControl).toBeVisible()
    await expect(collapseControl).toHaveCSS('position', 'sticky')
    const collapseControlStyles = await collapseControl.evaluate(element => {
      const style = getComputedStyle(element)
      const fadeStyle = getComputedStyle(element, '::before')
      return {
        fadeMask: fadeStyle.maskImage,
        fadeHeight: Number.parseFloat(fadeStyle.height),
        fontSize: Number.parseFloat(style.fontSize),
        marginBlockStart: Number.parseFloat(style.marginBlockStart)
      }
    })
    expect(collapseControlStyles.fadeMask).toContain('linear-gradient')
    expect(collapseControlStyles.fadeHeight).toBeGreaterThan(0)
    expect(collapseControlStyles.marginBlockStart).toBeGreaterThan(collapseControlStyles.fontSize)
    const maxScrollTop = await descriptionScroll.evaluate(element =>
      element.scrollHeight - element.clientHeight
    )
    expect(maxScrollTop).toBeGreaterThan(0)
    await descriptionScroll.evaluate((element, maxScrollTop) => {
      element.scrollTop = maxScrollTop / 2
    }, maxScrollTop)
    await expect.poll(() => descriptionScroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await expect(descriptionScroll).toHaveClass(/descriptionFadeTop/)
    await expect.poll(() => descriptionScroll.evaluate(element =>
      element.scrollTop < element.scrollHeight - element.clientHeight
    )).toBe(true)
    await expect.poll(() => collapseControl.evaluate(element => {
      const controlBottom = element.getBoundingClientRect().bottom
      const scrollBottom = element.parentElement.getBoundingClientRect().bottom
      return Math.abs(controlBottom - scrollBottom) <= 1
    })).toBe(true)

    await description.locator('.descriptionCopyButton button').click()
    await expect(page.locator('.toast', { hasText: 'Description copied to clipboard' })).toBeVisible()
    await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(videoDescription)
    await watchComponent.dispose()
  })

  test('handles videos without a description', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const pageErrors = []
    page.on('pageerror', error => pageErrors.push(error.message))
    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await watchComponent.evaluate(async component => {
      const watchView = component.proxy
      watchView.isLoading = true
      await watchView.$nextTick()
      watchView.videoDescription = ''
      watchView.videoDescriptionHtml = ''
      watchView.videoTags = []
      watchView.videoGames = []
      watchView.isLoading = false
      await watchView.$nextTick()
    })

    await expect(page.locator(`${activeTab} .videoDescription`)).toHaveCount(0)
    expect(pageErrors).toEqual([])
    await watchComponent.dispose()
  })

  test('the sidebar panels use overlay scrollbars', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    // Whether these overflow depends on the video, so assert that the directive
    // took hold rather than measuring widths: the panel stays the scrolling
    // element and gets its own overlay scrollbars.
    for (const selector of ['.descriptionScroll', '.commentsContentWrapper']) {
      await expect(page.locator(selector)).toBeVisible({ timeout: 30_000 })
      await expect(page.locator(`${selector}[data-overlayscrollbars-viewport]`)).toHaveCount(1)
      await expect(page.locator(`${selector} > .os-scrollbar-vertical`)).toHaveCount(1)
    }
  })

  test('resets the Shorts auxiliary viewport when switching panels', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { captionCueSettings: 'align:center' })
    await openMockedVideo(page)

    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await watchComponent.evaluate(async (component) => {
      const watchView = component.proxy
      watchView.isLoading = true
      await watchView.$nextTick()
      watchView.isShort = true
      watchView.videoDescription = Array(200).fill('Long Shorts metadata').join('\n')
      watchView.videoDescriptionHtml = ''
      watchView.shortsMetadataOpen = true
      watchView.isLoading = false
      await watchView.$nextTick()
    })

    const target = page.locator('.shortsAuxPanelTarget')
    await expect(page.locator('.shortsAuxPanel')).toHaveClass(/shortsAuxPanelOpen/)
    await expect.poll(() => target.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    await target.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => target.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    await watchComponent.evaluate(async (component) => {
      component.proxy.toggleTranscript()
      await component.proxy.$nextTick()
    })
    await expect(page.locator('.shortsAuxPanelTarget .watchVideoTranscript')).toBeVisible()
    await page.waitForTimeout(250)
    expect(await target.evaluate(element => element.scrollTop)).toBe(0)

    const transcript = page.locator('.shortsAuxPanelTarget .watchVideoTranscript')
    await transcript.evaluate(element => { element.style.blockSize = '200%' })
    await target.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => target.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await watchComponent.evaluate(async (component) => {
      component.proxy.closeTranscript()
      await component.proxy.$nextTick()
    })
    await expect(transcript).toHaveCount(0)
    await expect.poll(() => target.evaluate(element => element.scrollTop)).toBe(0)

    await watchComponent.evaluate(async (component) => {
      component.proxy.handleSponsorBlockInfoChange({
        open: true,
        loading: false,
        pendingUuid: null,
        segments: [],
        submissionEnabled: false
      })
      await component.proxy.$nextTick()
    })
    const sponsorBlock = page.locator('.shortsAuxPanelTarget .watchVideoSponsorBlock')
    await expect(sponsorBlock).toBeVisible()
    await sponsorBlock.evaluate(element => { element.style.blockSize = '200%' })
    await target.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => target.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await watchComponent.evaluate(async (component) => {
      component.proxy.handleSponsorBlockInfoChange({
        open: false,
        loading: false,
        pendingUuid: null,
        segments: [],
        submissionEnabled: false
      })
      await component.proxy.$nextTick()
    })
    await expect(sponsorBlock).toHaveCount(0)
    await expect.poll(() => target.evaluate(element => element.scrollTop)).toBe(0)

    await watchComponent.dispose()
  })

  test('shares the Shorts information dock with fullscreen and keeps its settings menu visible', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { captionCueSettings: 'align:center' })
    await page.locator(sel.searchInput).fill('https://www.youtube.com/shorts/jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw\?short=true/)
    await waitForPlayback(page)
    await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))

    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await watchComponent.evaluate(async (component) => {
      await Promise.all([
        component.proxy.$store.dispatch('updateRememberPlaybackSpeedPerChannel', true),
        component.proxy.$store.dispatch('updateRememberVideoQualityPerChannel', true),
      ])
      await component.proxy.$nextTick()
    })

    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    const moreOptions = player.getByRole('button', { name: 'More Options' })
    const overflowMenu = player.locator('.shaka-overflow-menu')
    const auxPanel = page.locator('.shortsAuxPanel')

    await moreOptions.click()
    await expect(overflowMenu.locator(':scope > button').first())
      .toHaveAccessibleName('Video information')
    await overflowMenu.getByRole('button', { name: 'Video information' }).click()
    await expect(auxPanel).toHaveClass(/shortsAuxPanelOpen/)

    await auxPanel.getByRole('button', { name: /Save channel setting/i }).click()
    const settingsMenu = page.locator('.app > .dropdownLayer > .iconDropdown.portal')
    await expect(settingsMenu).toBeVisible()
    expect(await settingsMenu.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      const hit = document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2
      )
      return element.contains(hit)
    })).toBe(true)
    await page.keyboard.press('Escape')

    await setPlayerFullscreen(page, true)
    const fullscreenMetadata = player.locator('.fullscreenMetadataOverlay.open')
    await expect(fullscreenMetadata).toBeVisible()
    await expect(player).not.toHaveClass(/presentationModeChanging/)

    expect(await player.evaluate(element => {
      const movingProperties = [
        ['.player', 'inline-size'],
        ['.shaka-controls-container', 'inline-size'],
        ['.shortsTopControls', 'inset-inline-start'],
        ['.shortsTopControls', 'max-inline-size'],
        ['.fullscreenActions', 'inset-inline-end']
      ]
      return movingProperties.map(([selector, property]) => {
        const style = getComputedStyle(element.querySelector(selector))
        const properties = style.transitionProperty.split(', ')
        const durations = style.transitionDuration.split(', ')
        const index = properties.indexOf(property)
        return index === -1 ? null : durations[index % durations.length]
      })
    })).toEqual(Array(5).fill('0.25s'))

    expect(await player.evaluate(element => {
      return getComputedStyle(
        element.querySelector('.shaka-seek-bar-container')
      ).transitionProperty
    })).toBe('none')

    const closingMotion = player.evaluate(element => new Promise(resolve => {
      const controls = element.querySelector('.shaka-controls-container')
      const seek = element.querySelector('.shaka-seek-bar-container')
      const initial = {
        seekLeft: seek.getBoundingClientRect().left
      }
      controls.addEventListener('transitionrun', event => {
        resolve({ initial, transitionProperty: event.propertyName })
      }, { once: true })
    }))
    await watchComponent.evaluate(component => {
      component.proxy.$refs.player.setFullscreenMetadata(false)
    })
    const { initial, transitionProperty } = await closingMotion
    await expect(fullscreenMetadata).toHaveCount(0)
    const fullscreenWidth = (await player.boundingBox()).width
    expect(['inline-size', 'width']).toContain(transitionProperty)
    await expect.poll(async () => {
      return player.locator('.shaka-controls-container').evaluate(element => {
        return element.getBoundingClientRect().width
      })
    }).toBeCloseTo(fullscreenWidth, 0)
    const closedSeekLeft = await player.locator('.shaka-seek-bar-container').evaluate(element => {
      return element.getBoundingClientRect().left
    })
    expect(closedSeekLeft).toBeGreaterThan(initial.seekLeft)

    const reopeningMotion = player.evaluate(element => new Promise(resolve => {
      const controls = element.querySelector('.shaka-controls-container')
      controls.addEventListener('transitionend', event => {
        resolve(event.propertyName)
      }, { once: true })
    }))
    await watchComponent.evaluate(component => {
      component.proxy.$refs.player.setFullscreenMetadata(true)
    })
    await expect(fullscreenMetadata).toBeVisible()
    expect(['inline-size', 'width']).toContain(await reopeningMotion)
    const reopenedControlsWidth = await player.locator('.shaka-controls-container').evaluate(element => {
      return element.getBoundingClientRect().width
    })
    expect(reopenedControlsWidth).toBeLessThan(fullscreenWidth)
    const reopenedSeekLeft = await player.locator('.shaka-seek-bar-container').evaluate(element => {
      return element.getBoundingClientRect().left
    })
    expect(reopenedSeekLeft).toBeLessThan(closedSeekLeft)

    await player.locator('.shortsFullscreenVideoSpace').hover({ force: true })
    await moreOptions.click()
    await expect(overflowMenu).toBeVisible()
    await expect.poll(async () => {
      const [buttonBounds, menuBounds] = await Promise.all([
        moreOptions.boundingBox(),
        overflowMenu.boundingBox()
      ])
      return Math.max(
        Math.abs(buttonBounds.x + buttonBounds.width - menuBounds.x - menuBounds.width),
        Math.abs(buttonBounds.y + buttonBounds.height + 8 - menuBounds.y)
      )
    }).toBeLessThanOrEqual(1)
    await page.keyboard.press('Escape')
    await expect(overflowMenu).toBeHidden()

    await watchComponent.evaluate(component => {
      component.proxy.$refs.player.setFullscreenTranscript(true)
    })
    const fullscreenTranscript = player.locator('.fullscreenTranscriptOverlay.open')
    await expect(fullscreenTranscript).toBeVisible()
    await fullscreenMetadata.locator('.fullscreenMetadataHeader').dblclick({
      position: { x: 30, y: 26 }
    })
    await expect.poll(async () => (await fullscreenMetadata.boundingBox()).height)
      .toBeLessThan(100)
    await watchComponent.evaluate(component => {
      component.proxy.$refs.player.setFullscreenTranscript(false)
    })
    await expect(fullscreenTranscript).toHaveCount(0)
    await fullscreenMetadata.getByRole('button', { name: 'Close video information' }).click()
    await player.locator('.shortsFullscreenTitleButton').click()
    await watchComponent.evaluate(component => {
      component.proxy.$refs.player.setFullscreenTranscript(true)
    })
    await expect.poll(async () => (await fullscreenMetadata.boundingBox()).height)
      .toBeGreaterThan(150)

    await setPlayerFullscreen(page, false)
    await expect(auxPanel).toHaveClass(/shortsAuxPanelOpen/)

    await auxPanel.getByRole('button', { name: 'Close video information' }).click()
    await expect(auxPanel).not.toHaveClass(/shortsAuxPanelOpen/)

    await setPlayerFullscreen(page, true)
    await player.locator('.shortsFullscreenVideoSpace').hover({ force: true })
    await moreOptions.click()
    await overflowMenu.getByRole('button', { name: 'Video information' }).click()
    await expect(player.locator('.fullscreenMetadataOverlay.open')).toBeVisible()

    // Cover reopening the menu after playback controls have auto-hidden.
    await page.mouse.move(0, 0)
    await expect(player.locator('.shortsTopControls')).toBeHidden()
    await player.locator('.shortsFullscreenVideoSpace').hover({ force: true })
    await moreOptions.click()
    await expect(overflowMenu).toBeVisible()
    await setPlayerFullscreen(page, false)
    await expect(overflowMenu).toBeHidden()
    await expect(auxPanel).toHaveClass(/shortsAuxPanelOpen/)

    await moreOptions.click()
    await expect(overflowMenu).toBeVisible()
    await expect.poll(async () => {
      const [buttonBounds, menuBounds] = await Promise.all([
        moreOptions.boundingBox(),
        overflowMenu.boundingBox()
      ])
      return Math.max(
        Math.abs(buttonBounds.x + buttonBounds.width - menuBounds.x - menuBounds.width),
        Math.abs(buttonBounds.y + buttonBounds.height + 8 - menuBounds.y)
      )
    }).toBeLessThanOrEqual(1)

    await watchComponent.dispose()
  })

  test('toggles information from the Shorts title and matches the comments header', async ({ app, page }) => {
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateBaseTheme', 'light')
    })
    await expect(page.locator('body')).toHaveClass(/light/)
    await mockPlayableWatchPage(app, page)
    await page.locator(sel.searchInput).fill('https://www.youtube.com/shorts/jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw\?short=true/)
    await waitForPlayback(page)

    const watchComponent = await page.evaluateHandle(findWatchComponent)
    const titleButton = page.locator('.shortsExternalTitleButton')
    await expect(titleButton).toHaveAttribute('aria-expanded', 'false')
    await titleButton.click()
    await expect(page.locator('.shortsAuxPanel')).toHaveClass(/shortsAuxPanelOpen/)
    await expect(titleButton).toHaveAttribute('aria-expanded', 'true')

    const headerStyles = async (headerSelector, closeSelector) => page.evaluate(
      ({ headerSelector, closeSelector }) => {
        const header = document.querySelector(headerSelector)
        const heading = header?.querySelector('h2, h3')
        const close = document.querySelector(closeSelector)
        const headerStyle = getComputedStyle(header)
        const headingStyle = getComputedStyle(heading)
        const closeStyle = getComputedStyle(close)
        return {
          header: {
            height: headerStyle.height,
            padding: headerStyle.padding,
            backgroundColor: headerStyle.backgroundColor,
            borderBottomColor: headerStyle.borderBottomColor
          },
          heading: {
            margin: headingStyle.margin,
            fontSize: headingStyle.fontSize,
            color: headingStyle.color
          },
          close: {
            width: closeStyle.width,
            height: closeStyle.height,
            color: closeStyle.color,
            backgroundColor: closeStyle.backgroundColor,
            borderRadius: closeStyle.borderRadius,
            fontSize: closeStyle.fontSize
          }
        }
      },
      { headerSelector, closeSelector }
    )

    const informationStyles = await headerStyles(
      '.shortsAuxPanelHeader',
      '.shortsAuxPanelClose'
    )

    await titleButton.click()
    await expect(page.locator('.shortsAuxPanel')).not.toHaveClass(/shortsAuxPanelOpen/)
    await expect(titleButton).toHaveAttribute('aria-expanded', 'false')

    await watchComponent.evaluate(async (component) => {
      component.proxy.toggleShortsComments()
      await component.proxy.$nextTick()
    })
    await expect(page.locator('.shortsCommentsPanel .fullscreenCommentHeader')).toBeVisible()
    const commentText = page.locator('.shortsCommentsPanel .commentText').first()
    await expect(commentText).toBeVisible()
    const commentContrast = await commentText.evaluate(element => {
      const parseRgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number)
      const luminance = value => {
        const channels = parseRgb(value).map(channel => {
          const normalized = channel / 255
          return normalized <= 0.04045
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
      }
      const foreground = luminance(getComputedStyle(element).color)
      const background = luminance(getComputedStyle(element.closest('.shortsCommentsPanel')).backgroundColor)
      return (Math.max(foreground, background) + 0.05) /
        (Math.min(foreground, background) + 0.05)
    })
    expect(commentContrast).toBeGreaterThanOrEqual(4.5)
    const commentsStyles = await headerStyles(
      '.shortsCommentsPanel .fullscreenCommentHeader',
      '.shortsCommentsPanel .fullscreenCommentAction:last-of-type'
    )

    expect(informationStyles.header.backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(informationStyles.heading.color).toBe(informationStyles.close.color)
    expect(informationStyles).toEqual(commentsStyles)
    await watchComponent.dispose()
  })

  test('keeps the Shorts comment filter menu above creator hearts', async ({ app, page, attachScreenshot }) => {
    await mockPlayableWatchPage(app, page)
    await page.locator(sel.searchInput).fill('https://www.youtube.com/shorts/jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw\?short=true/)
    await waitForPlayback(page)

    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await watchComponent.evaluate(async (component) => {
      component.proxy.toggleShortsComments()
      await component.proxy.$nextTick()
    })

    const commentsPanel = page.locator('.shortsCommentsPanel')
    const heart = commentsPanel.locator('.commentHeartBadgeRed').first()
    await expect(heart).toBeVisible({ timeout: 30_000 })
    await commentsPanel.getByRole('button', { name: 'Filter loaded comments' }).click()

    const menu = commentsPanel.getByRole('dialog', { name: 'Comment filters' })
    await expect(menu).toBeVisible()
    await attachScreenshot('Shorts comment filter above creator heart')
    const menuCoversHeart = await menu.evaluate((element, heartElement) => {
      const menuBounds = element.getBoundingClientRect()
      const heartBounds = heartElement.getBoundingClientRect()
      const x = Math.max(menuBounds.left, heartBounds.left) + 1
      const y = Math.max(menuBounds.top, heartBounds.top) + 1
      const overlaps = x < Math.min(menuBounds.right, heartBounds.right) &&
        y < Math.min(menuBounds.bottom, heartBounds.bottom)
      return overlaps && document.elementFromPoint(x, y)?.closest('.commentFilterMenu') === element
    }, await heart.elementHandle())

    expect(menuCoversHeart).toBe(true)
    await watchComponent.dispose()
  })

  test('sidebar chapters and SponsorBlock honor roundness while closing beside the description', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    await page.evaluate(async () => {
      const layout = document.querySelector('.videoLayout')
      const app = document.querySelector('#app')?.__vue_app__
      const findWatchView = (vnode) => {
        if (vnode?.component?.refs?.videoLayout === layout) {
          return vnode.component.proxy
        }
        if (vnode?.component?.subTree) {
          const match = findWatchView(vnode.component.subTree)
          if (match) {
            return match
          }
        }
        if (Array.isArray(vnode?.children)) {
          for (const child of vnode.children) {
            const match = findWatchView(child)
            if (match) {
              return match
            }
          }
        }
        return null
      }
      const watchView = findWatchView(app?._container?._vnode)
      if (!watchView) {
        throw new Error('Unable to access the watch view')
      }

      document.body.style.setProperty('--ui-roundness', '2')
      window.__sidebarRoundnessWatchView = watchView
      await watchView.$store.dispatch('updateHideRecommendedVideos', true)
      watchView.useTheatreMode = true
      watchView.videoChapters = Array.from({ length: 6 }, (_, index) => ({
        title: `Test chapter ${index + 1}`,
        timestamp: `${index}:00`,
        startSeconds: index * 60
      }))
      watchView.videoCurrentChapterIndex = 5
      watchView.showSidebarChapters = true
      await watchView.$nextTick()
    })

    const layout = page.locator('.videoLayout')
    const panel = page.locator('.watchVideoChaptersPanel')
    const standardCardRadius = await page.locator('.watchVideoInfo.ft-card').evaluate(element => {
      return getComputedStyle(element).borderRadius
    })
    await expect(layout).toHaveClass(/useTheatreMode/)
    await expect(panel).toBeVisible()
    expect(standardCardRadius).toBe('16px')
    await expect(panel).toHaveCSS('border-radius', standardCardRadius)
    await expect(panel).not.toHaveClass(/chapters-panel-enter-active/)
    await expect.poll(() => panel.evaluate((element) => {
      const container = element.querySelector('.chaptersWrapper')
      const scrollbar = container?.querySelector(':scope > .os-scrollbar-vertical')
      return container && {
        hasVisibleScrollbar: scrollbar?.classList.contains('os-scrollbar-visible'),
        scrollTop: container.scrollTop,
      }
    })).toEqual({
      hasVisibleScrollbar: false,
      scrollTop: 0,
    })
    await expect.poll(() => panel.evaluate((element) => {
      const container = element.querySelector('.chaptersWrapper')
      const currentChapter = container?.querySelector('.chapter.current')
      const containerBounds = container?.getBoundingClientRect()
      const chapterBounds = currentChapter?.getBoundingClientRect()
      return Boolean(
        containerBounds &&
        chapterBounds &&
        chapterBounds.top >= containerBounds.top &&
        chapterBounds.bottom <= containerBounds.bottom
      )
    })).toBe(true)

    await panel.getByRole('button', { name: 'Close Chapters' }).click()
    await expect(panel).toHaveClass(/chapters-panel-leave-active/)
    const leavingScrollbar = await panel.evaluate((element) => {
      const viewport = element.querySelector('.chaptersWrapper')
      return viewport && {
        initializing: viewport.hasAttribute('data-overlayscrollbars-initialize'),
        nativeScrollbarWidth: getComputedStyle(viewport).scrollbarWidth
      }
    })
    expect(leavingScrollbar).toEqual({
      initializing: true,
      nativeScrollbarWidth: 'none'
    })

    const leavingLayout = await page.evaluate(() => {
      const layoutElement = document.querySelector('.videoLayout')
      const infoElement = document.querySelector('.infoArea')
      const panelElement = document.querySelector('.watchVideoChaptersPanel')
      const infoBounds = infoElement.getBoundingClientRect()
      const panelBounds = panelElement.getBoundingClientRect()

      return {
        noSidebar: layoutElement.classList.contains('noSidebar'),
        infoRight: infoBounds.right,
        panelLeft: panelBounds.left
      }
    })
    expect(leavingLayout.noSidebar).toBe(false)
    expect(leavingLayout.panelLeft).toBeGreaterThanOrEqual(leavingLayout.infoRight - 1)

    await expect(panel).toHaveCount(0)
    await expect(layout).toHaveClass(/noSidebar/)

    await page.evaluate(async () => {
      window.__sidebarRoundnessWatchView.showSidebarSponsorBlock = true
      await window.__sidebarRoundnessWatchView.$nextTick()
    })
    await expect(page.locator('.watchVideoSponsorBlock')).toHaveCSS(
      'border-radius',
      standardCardRadius
    )
  })

  test('fullscreen metadata uses one full-dock scrollbar', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await setPlayerFullscreen(page, true)
    await page.locator('.playerFullscreenTitleOverlay').click({ force: true })

    const metadata = page.locator('.fullscreenMetadataOverlay.open')
    const target = metadata.locator('.fullscreenMetadataTarget')
    await expect(metadata).toBeVisible()
    await expect(target).toHaveAttribute('data-overlayscrollbars-viewport')
    await expect(metadata.locator('.os-scrollbar-vertical')).toHaveCount(1)
    await expect(metadata.locator('.descriptionScroll'))
      .not.toHaveAttribute('data-overlayscrollbars-viewport')

    await metadata.locator('.description').evaluate((element) => {
      element.textContent = Array.from(
        { length: 100 },
        (_, index) => `Long description line ${index + 1}`
      ).join('\n')
    })
    await expect.poll(() => target.evaluate(
      element => element.scrollHeight > element.clientHeight
    )).toBe(true)

    const scrollbar = target.locator(':scope > .os-scrollbar-vertical')
    const scrollbarBounds = await scrollbar.boundingBox()
    const targetBounds = await target.boundingBox()
    expect(Math.abs(scrollbarBounds.y - targetBounds.y)).toBeLessThanOrEqual(1)
    expect(
      Math.abs(
        targetBounds.y + targetBounds.height -
        scrollbarBounds.y - scrollbarBounds.height
      )
    ).toBeLessThanOrEqual(1)

    await target.evaluate(element => {
      element.scrollTop = (element.scrollHeight - element.clientHeight) / 3
    })
    await expect.poll(() => target.evaluate(
      element => element.scrollTop
    )).toBeGreaterThan(0)
    const handle = scrollbar.locator('.os-scrollbar-handle')
    await handle.hover()
  })

  test('fullscreen comments scrollbar reaches the dock bottom', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await setPlayerFullscreen(page, true)
    await page.locator('.fullscreenCommentsToggle').click({ force: true })

    const dock = page.locator('.fullscreenCommentsOverlay.open')
    const content = dock.locator('.commentsContentWrapper')
    await expect(content).toBeVisible()

    const bottomGap = await Promise.all([dock.boundingBox(), content.boundingBox()])
      .then(([dockBox, contentBox]) => (
        dockBox.y + dockBox.height - contentBox.y - contentBox.height
      ))
    expect(bottomGap).toBeLessThanOrEqual(2)
  })

  test('fullscreen SponsorBlock uses one content scrollbar', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.route('**/api/skipSegments/**', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([{
        videoID: 'jNQXAC9IVRw',
        segments: Array.from({ length: 20 }, (_, index) => ({
          UUID: `scrollbar-segment-${index}`,
          actionType: 'skip',
          category: 'sponsor',
          description: '',
          locked: 0,
          segment: [index, index + 0.5],
          videoDuration: 30,
          votes: 1
        }))
      }])
    }))
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setUseSponsorBlock', true)
    })
    const video = await openMockedVideo(page)
    await video.evaluate(element => element.pause())
    await setPlayerFullscreen(page, true)
    await page.locator('.fullscreenSponsorBlockToggle').click({ force: true })

    const sponsorBlock = page.locator('.fullscreenSponsorBlockOverlay.open')
    await expect(sponsorBlock).toBeVisible()
    await expect(sponsorBlock.locator('.sponsorBlockContent'))
      .toHaveAttribute('data-overlayscrollbars-viewport')
    await expect(sponsorBlock.locator('.sponsorBlockSegments'))
      .not.toHaveAttribute('data-overlayscrollbars-viewport')
    await expect(sponsorBlock.locator('.os-scrollbar-vertical')).toHaveCount(1)
  })

  test('shows SponsorBlock contribution stats for the existing user ID', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)

    let expectedPublicUserId = 'test-contributor'
    for (let round = 0; round < 5000; round++) {
      expectedPublicUserId = crypto.createHash('sha256').update(expectedPublicUserId).digest('hex')
    }

    let userInfoRequests = 0
    let requestedUserInfoUrl = null
    let segmentRequests = 0
    await page.route('**/api/skipSegments/**', async (route) => {
      segmentRequests++
      const segments = segmentRequests === 1
        ? Array.from({ length: 18 }, (_, index) => ({
            UUID: `contribution-stats-segment-${index}`,
            actionType: 'skip',
            category: 'sponsor',
            description: '',
            locked: 0,
            segment: [index, index + 0.5],
            videoDuration: 19,
            votes: 1
          }))
        : []
      await route.fulfill({
        body: JSON.stringify([{ videoID: 'jNQXAC9IVRw', segments }]),
        contentType: 'application/json'
      })
    })
    await page.route('**/api/userInfo?*', async (route) => {
      userInfoRequests++
      requestedUserInfoUrl = new URL(route.request().url())
      const publicUserIdMatches = requestedUserInfoUrl.searchParams.get('publicUserID') === expectedPublicUserId
      await route.fulfill({
        body: JSON.stringify(publicUserIdMatches
          ? {
              segmentCount: 42,
              viewCount: 1234,
              minutesSaved: 22759
            }
          : {
              segmentCount: 0,
              viewCount: 0,
              minutesSaved: 0
            }),
        contentType: 'application/json'
      })
    })

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setUseSponsorBlock', true)
      store.commit('setSponsorBlockGeneratedUserId', 'test-contributor')
      await store.dispatch('updateSponsorBlockEnableSubmission', true)
      await store.dispatch('updateUiScale', 125)
    })
    await openMockedVideo(page)
    await page.getByRole('button', { name: 'Open SponsorBlock info' }).click()

    const panel = page.locator('.watchVideoSponsorBlock')
    const stats = panel.locator('.sponsorBlockContributionStats')
    await expect(stats).toContainText('Your contributions')
    await expect(stats.locator('dt')).toHaveText(['Submissions', 'Segments', 'Time saved'])
    await expect(stats.locator('dd')).toHaveText(['42', '1,234', '379 hr 19 min'])
    const metricLayout = await stats.locator('.sponsorBlockContributionMetric').evaluateAll(metrics => {
      return metrics.map((metric) => {
        const labelBounds = metric.querySelector('dt').getBoundingClientRect()
        const valueBounds = metric.querySelector('dd').getBoundingClientRect()
        const metricBounds = metric.getBoundingClientRect()
        return {
          labelBottom: labelBounds.bottom,
          metricCenter: metricBounds.left + metricBounds.width / 2,
          valueCenter: valueBounds.top + valueBounds.height / 2,
          valueTop: valueBounds.top
        }
      })
    })
    expect(metricLayout.every(({ labelBottom, valueTop }) => labelBottom <= valueTop)).toBe(true)
    expect(Math.abs(
      (metricLayout[1].metricCenter - metricLayout[0].metricCenter) -
      (metricLayout[2].metricCenter - metricLayout[1].metricCenter)
    )).toBeLessThanOrEqual(1)
    expect(Math.max(...metricLayout.map(({ valueCenter }) => valueCenter)) -
      Math.min(...metricLayout.map(({ valueCenter }) => valueCenter))).toBeLessThanOrEqual(1)
    await expect(panel.locator('.sponsorBlockSegment')).toHaveCount(18)
    expect(userInfoRequests).toBe(1)
    expect(requestedUserInfoUrl.searchParams.get('publicUserID')).toBe(expectedPublicUserId)
    expect(JSON.parse(requestedUserInfoUrl.searchParams.get('values'))).toEqual([
      'segmentCount',
      'viewCount',
      'minutesSaved'
    ])

    const content = panel.locator('.sponsorBlockContent')
    await panel.evaluate((element) => { element.style.inlineSize = '240px' })
    await expect(panel).toHaveCSS('width', '240px')
    await content.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    const narrowScrollTop = await content.evaluate(element => element.scrollTop)
    await panel.evaluate((element) => { element.style.inlineSize = '' })
    await expect.poll(() => panel.evaluate(element => element.getBoundingClientRect().width))
      .toBeGreaterThan(240)
    await expectSponsorBlockContentClamp(content, narrowScrollTop)

    await content.evaluate((element) => { element.scrollTop = element.scrollHeight })
    const enabledScrollTop = await content.evaluate(element => element.scrollTop)
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateSponsorBlockEnableSubmission', false)
    })
    await expect(stats).toHaveCount(0)
    await expectSponsorBlockContentClamp(content, enabledScrollTop)
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateSponsorBlockEnableSubmission', true)
    })
    await expect(stats).toBeVisible()

    await panel.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('button', { name: 'Open SponsorBlock info' }).click()
    await expect.poll(() => userInfoRequests).toBe(1)

    await content.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Refresh SponsorBlock information' }).click()
    await expect.poll(() => userInfoRequests).toBe(2)
    await expect(panel.locator('.sponsorBlockSegment')).toHaveCount(0)
    await expect.poll(() => content.evaluate((element) => {
      const scrollbar = element.querySelector('.os-scrollbar-vertical')
      const hasVerticalOverflow = element.scrollHeight > element.clientHeight + 1
      return {
        hasVerticalOverflow,
        hasVisibleScrollbar: scrollbar?.classList.contains('os-scrollbar-visible'),
        scrollTop: element.scrollTop
      }
    })).toEqual({
      hasVerticalOverflow: false,
      hasVisibleScrollbar: false,
      scrollTop: 0
    })
  })

  test('hides SponsorBlock contribution stats when submission is disabled', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setUseSponsorBlock', true)
      store.commit('setSponsorBlockGeneratedUserId', 'test-contributor')
    })
    await expect.poll(() => page.evaluate(() => {
      return document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters
        .getSponsorBlockEnableSubmission
    })).toBe(false)
    await openMockedVideo(page)
    await page.getByRole('button', { name: 'Open SponsorBlock info' }).click()

    await expect(page.locator('.sponsorBlockContributionStats')).toHaveCount(0)
  })

  test('does not create a SponsorBlock user ID to load contribution stats', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)

    let userInfoRequests = 0
    await page.route('**/api/userInfo?*', (route) => {
      userInfoRequests++
      return route.abort()
    })
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setUseSponsorBlock', true)
      await store.dispatch('updateSponsorBlockEnableSubmission', true)
    })
    await openMockedVideo(page)
    await page.getByRole('button', { name: 'Open SponsorBlock info' }).click()

    await expect(page.locator('.sponsorBlockContributionStats')).toContainText(
      'Submit a segment or import your SponsorBlock user ID to see contribution stats.'
    )
    expect(userInfoRequests).toBe(0)
  })

  test('uses a custom SponsorBlock category color for markers and prompts', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.route('**/api/skipSegments/**', route => route.fulfill({
      body: JSON.stringify([{
        videoID: 'jNQXAC9IVRw',
        segments: [{
          UUID: 'custom-color-sponsor',
          actionType: 'skip',
          category: 'sponsor',
          description: '',
          locked: 0,
          segment: [15, 20],
          videoDuration: 30,
          votes: 1
        }]
      }]),
      contentType: 'application/json'
    }))
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setUseSponsorBlock', true)
      store.commit('setSponsorBlockSponsor', { color: '#123456', skip: 'promptToSkip' })
    })

    await openMockedVideo(page)

    const marker = page.locator('.sponsorBlockMarker')
    await expect(marker).toHaveCount(1)
    await expect(marker).toHaveCSS('background-color', 'rgb(18, 52, 86)')

    const video = page.locator('.ftVideoPlayer video')
    await video.evaluate(element => {
      element.pause()
      element.currentTime = 16
      element.dispatchEvent(new Event('timeupdate'))
    })
    const prompt = page.locator('.skippedSegment').filter({ hasText: 'Skip Sponsor?' })
    await expect(prompt).toBeVisible()
    await expect(prompt.locator('.skippedSegmentShield')).toHaveCSS('color', 'rgb(18, 52, 86)')
  })

  test('does not restore a SponsorBlock prompt when a skip remains inside the segment', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.route('**/api/skipSegments/**', route => route.fulfill({
      body: JSON.stringify([{
        videoID: 'jNQXAC9IVRw',
        segments: [{
          UUID: 'terminal-outro',
          actionType: 'skip',
          category: 'outro',
          description: '',
          locked: 0,
          segment: [15, 40],
          videoDuration: 40,
          votes: 1
        }]
      }]),
      contentType: 'application/json'
    }))
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setUseSponsorBlock', true)
    })
    await openMockedVideo(page)

    const video = page.locator('.ftVideoPlayer video')
    await video.evaluate(element => {
      element.pause()
      element.currentTime = 16
      element.dispatchEvent(new Event('timeupdate'))
    })

    const prompt = page.locator('.skippedSegment').filter({ hasText: 'Skip Endcards/Credits?' })
    await expect(prompt).toBeVisible()
    await prompt.getByRole('button', { name: /Skip/ }).click()
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeLessThan(40)
    await page.evaluate(() => new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    }))

    await expect(page.locator('.skippedSegment').filter({ hasText: 'Endcards/Credits Skipped' })).toBeVisible()
    await expect(prompt).toHaveCount(0)
  })

  test('dismisses a SponsorBlock prompt when playback ends', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.route('**/api/skipSegments/**', route => route.fulfill({
      body: JSON.stringify([{
        videoID: 'jNQXAC9IVRw',
        segments: [{
          UUID: 'terminal-outro-prompt',
          actionType: 'skip',
          category: 'outro',
          description: '',
          locked: 0,
          segment: [15, 30],
          videoDuration: 30,
          votes: 1
        }]
      }]),
      contentType: 'application/json'
    }))
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setUseSponsorBlock', true)
    })
    await openMockedVideo(page)

    const video = page.locator('.ftVideoPlayer video')
    await video.evaluate(element => {
      element.pause()
      element.currentTime = 29
      element.dispatchEvent(new Event('timeupdate'))
    })

    const prompt = page.locator('.skippedSegment').filter({ hasText: 'Skip Endcards/Credits?' })
    await expect(prompt).toBeVisible()
    await video.dispatchEvent('ended')

    await expect(prompt).toHaveCount(0)
  })

  test('previews and submits edited SponsorBlock timestamps', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    let submittedBody = null
    let userInfoRequests = 0

    await page.route('**/api/skipSegments/**', route => route.fulfill({
      body: JSON.stringify([]),
      contentType: 'application/json'
    }))
    await page.route('**/api/skipSegments', async route => {
      submittedBody = route.request().postDataJSON()
      await route.fulfill({
        body: JSON.stringify([{
          UUID: 'submitted-edited-segment',
          category: 'sponsor',
          segment: [11.722, 12]
        }]),
        contentType: 'application/json'
      })
    })
    await page.route('**/api/userInfo?*', async route => {
      userInfoRequests++
      await route.fulfill({
        body: JSON.stringify({
          segmentCount: userInfoRequests,
          viewCount: 0,
          minutesSaved: 0
        }),
        contentType: 'application/json'
      })
    })
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setUseSponsorBlock', true)
      store.commit('setSponsorBlockGeneratedUserId', 'test-contributor')
      await store.dispatch('updateSponsorBlockEnableSubmission', true)
    })

    await openMockedVideo(page)
    await page.getByRole('button', { name: 'Open SponsorBlock info' }).click()
    await expect.poll(() => userInfoRequests).toBe(1)
    await page.locator('.watchVideoSponsorBlock').getByRole('button', { name: 'Close' }).click()

    const video = page.locator('.ftVideoPlayer video')
    await video.evaluate(element => {
      element.pause()
      element.currentTime = 11
    })
    await page.locator('.sponsorblock-start-button').click({ force: true })
    await video.evaluate(element => { element.currentTime = 12 })
    await page.locator('.sponsorblock-end-button').click({ force: true })

    const submissionMenu = page.locator('.sponsorBlockSubmissionMenu')
    await submissionMenu.locator('.sponsorBlockDraftTimeInput').first().fill('0:11.722')
    await submissionMenu.getByRole('button', { name: 'Inspect' }).click()
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(11.722, 3)

    await video.evaluate(element => {
      const currentTime = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')
      Object.defineProperty(element, 'currentTime', {
        configurable: true,
        get: currentTime.get,
        set(value) {
          window.__sponsorBlockPreviewSeekTime ??= value
          currentTime.set.call(this, value)
        }
      })
    })
    await submissionMenu.getByRole('button', { name: 'Preview' }).click()
    await expect.poll(() => page.evaluate(() => window.__sponsorBlockPreviewSeekTime ?? null))
      .toBeCloseTo(9.722, 3)
    await video.evaluate(element => {
      element.currentTime = 11.8
      element.dispatchEvent(new Event('timeupdate'))
    })
    await submissionMenu.locator('.sponsorBlockSubmissionButton').click()

    await expect.poll(() => submittedBody).not.toBeNull()
    expect(submittedBody.segments).toEqual([{
      actionType: 'skip',
      category: 'sponsor',
      description: '',
      segment: [11.722, 12]
    }])

    await page.getByRole('button', { name: 'Open SponsorBlock info' }).click()
    await expect.poll(() => userInfoRequests).toBe(2)
  })

  test('skips SponsorBlock segments at their boundary without timeupdate events', async ({ app, page }) => {
    const skipStartedAt = await measureSponsorBlockSkipStartTime(app, page)
    expect(skipStartedAt).toBeGreaterThanOrEqual(15)
    expect(skipStartedAt).toBeLessThan(15.05)
  })

  test('skips SponsorBlock segments promptly under renderer load', async ({ app, page }) => {
    const skipStartedAt = await measureSponsorBlockSkipStartTime(app, page, { rendererLoad: true })
    expect(skipStartedAt).toBeGreaterThanOrEqual(15)
    expect(skipStartedAt).toBeLessThan(15.3)
  })

  test('displays and submits full-video SponsorBlock labels', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    const fullVideoSegment = {
      UUID: 'full-video-label',
      actionType: 'full',
      category: 'exclusive_access',
      description: '',
      locked: 0,
      segment: [0, 0],
      videoDuration: 19,
      votes: 1
    }
    let submittedBody = null

    await page.route('**/api/skipSegments/**', route => route.fulfill({
      body: JSON.stringify([{
        videoID: 'jNQXAC9IVRw',
        segments: [fullVideoSegment]
      }]),
      contentType: 'application/json'
    }))
    await page.route('**/api/skipSegments', async route => {
      submittedBody = route.request().postDataJSON()
      await route.fulfill({
        body: JSON.stringify([{
          UUID: 'submitted-full-video-label',
          category: 'exclusive_access',
          segment: [0, 0]
        }]),
        contentType: 'application/json'
      })
    })
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setUseSponsorBlock', true)
      await store.dispatch('updateSponsorBlockEnableSubmission', true)
    })

    await openMockedVideo(page)

    await expect(page.locator('.watchVideoInfo .videoBadge'))
      .toContainText('Exclusive Access · Full Video')

    await page.locator('.sponsorblock-start-button').click({ force: true })
    await page.locator('.sponsorblock-open-menu-button').click({ force: true })

    const submissionMenu = page.locator('.sponsorBlockSubmissionMenu')
    await expect(submissionMenu).toBeVisible()
    await submissionMenu.locator('select').first().selectOption('exclusive_access')
    await expect(submissionMenu.locator('select').nth(1)).toHaveValue('full')
    await expect(submissionMenu.locator('.sponsorBlockDraftTimeText')).toHaveText('Full Video')

    await submissionMenu.locator('.sponsorBlockSubmissionButton').click()
    await expect.poll(() => submittedBody).not.toBeNull()
    expect(submittedBody.segments).toEqual([{
      actionType: 'full',
      category: 'exclusive_access',
      description: '',
      segment: [0, 0]
    }])
    await expect(page.locator('.sponsorBlockMarker')).toHaveCount(0)
  })
})

test.describe('fullscreen captions', () => {
  test.use({
    seed: {
      settings: {
        ...WATCH_PAGE_SEED,
        defaultCaptionSettings: JSON.stringify({ fontScale: 1.5 })
      }
    }
  })

  test('keeps the configured caption size in fullscreen', async ({ app }) => {
    const { page } = app
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const player = page.locator('.ftVideoPlayer')
    await player.evaluate(element => {
      for (const className of ['shaka-text-container', 'shaka-speech-to-text-container']) {
        if (element.querySelector(`.${className}`)) continue

        const captions = document.createElement('div')
        captions.className = className
        element.append(captions)
      }
    })

    const captionContainers = player.locator(
      '.shaka-text-container, .shaka-speech-to-text-container'
    )
    await expect(captionContainers).toHaveCount(2)
    const windowedFontSizes = await captionContainers.evaluateAll(elements => {
      return elements.map(element => getComputedStyle(element).fontSize)
    })
    expect(windowedFontSizes).toEqual(['30px', '30px'])

    // The player is only a few hundred pixels tall here, so the captions scale down with it.
    await setWindowWidth(app, 400)
    await expect.poll(async () => captionContainers.evaluateAll(elements => {
      return elements.map(element => getComputedStyle(element).fontSize)
    })).not.toEqual(windowedFontSizes)

    const narrowFontSizes = await captionContainers.evaluateAll(elements => {
      return elements.map(element => Number.parseFloat(getComputedStyle(element).fontSize))
    })
    for (const fontSize of narrowFontSizes) {
      expect(fontSize).toBeGreaterThan(30 * 0.45)
      expect(fontSize).toBeLessThan(30 * 0.75)
    }

    // Fullscreen makes the player tall again, so the configured size comes back.
    await setPlayerFullscreen(page, true)
    await expect.poll(async () => captionContainers.evaluateAll(elements => {
      return elements.map(element => getComputedStyle(element).fontSize)
    })).toEqual(windowedFontSizes)
  })
})

test.describe('fullscreen playlist dock', () => {
  test.use({
    seed: {
      settings: {
        ...WATCH_PAGE_SEED,
        enableSubtitlesByDefault: true,
        uiRoundness: 200,
      },
      playlists: [FULLSCREEN_PLAYLIST],
      history: [{
        ...FULLSCREEN_PLAYLIST.videos[0],
        _id: 'jNQXAC9IVRw',
        watchProgress: 19,
        isWatched: true,
        timeWatched: Date.now(),
        isLive: false,
      }]
    }
  })

  async function openFullscreenPlaylistVideo(page, { enableQuickBookmark = false } = {}) {
    await page.locator(sel.sideNavLink('userplaylists')).first().evaluate(element => element.click())
    await expect(page).toHaveURL(/#\/userplaylists/)
    await page.getByRole('link', { name: FULLSCREEN_PLAYLIST.playlistName }).first().click()
    await expect(page).toHaveURL(new RegExp(`#\\/playlist\\/${FULLSCREEN_PLAYLIST_ID}`))
    if (enableQuickBookmark) {
      const enableButton = page.getByTitle('Enable Quick Bookmark With This Playlist')
      const enabledIndicator = page.getByTitle('Quick Bookmark Enabled')
      // Wait for either state before branching, isVisible() does not retry.
      await expect(enableButton.or(enabledIndicator).first()).toBeVisible()
      if (await enableButton.isVisible()) {
        await enableButton.click()
      }
      await expect(enabledIndicator).toBeVisible()
    }
    await page.getByRole('link', { name: FULLSCREEN_PLAYLIST.videos[0].title }).first().click()
    await expect(page).toHaveURL(
      new RegExp(`#\\/watch\\/jNQXAC9IVRw\\?.*playlistId=${FULLSCREEN_PLAYLIST_ID}`)
    )
  }

  test('does not duplicate the remove action for the Quick Bookmark playlist', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await openFullscreenPlaylistVideo(page, { enableQuickBookmark: true })

    const item = page.locator('.watchVideoPlaylist .playlistItem').first()
    await item.locator('.videoThumbnail').hover()
    await expect(item.locator('.trashIcon')).toHaveCount(1)
    await expect(item.locator('.quickBookmarkVideoIcon')).toHaveCount(0)
  })

  test('keeps positioned captions centered across playlist videos', async ({ app, page }) => {
    test.setTimeout(120_000)
    await mockPlayableWatchPage(app, page, { captionCueSettings: 'position:63% align:start' })
    await openMockedVideo(page)
    await openFullscreenPlaylistVideo(page)

    const player = page.locator('.ftVideoPlayer')
    const caption = player.locator('.shaka-text-container [translate="no"]')
    const expectCaptionCentered = async () => {
      await expect(caption).toBeVisible()
      await expect.poll(async () => {
        const [playerBounds, captionBounds] = await Promise.all([
          player.boundingBox(),
          caption.boundingBox(),
        ])
        if (!playerBounds || !captionBounds) return Number.POSITIVE_INFINITY

        return Math.abs(
          (playerBounds.x + playerBounds.width / 2) -
          (captionBounds.x + captionBounds.width / 2)
        )
      }).toBeLessThanOrEqual(1)
    }

    // The source cue must not override the configured anchor in the inline player either.
    await expectCaptionCentered()
    await setPlayerFullscreen(page, true)
    await expectCaptionCentered()

    for (let index = 1; index <= 9; index++) {
      await player.locator('.skip-next-button').click({ force: true })
      await expect(page).toHaveURL(new RegExp(
        `#\\/watch\\/playlist${String(index).padStart(3, '0')}\\?.*playlistId=${FULLSCREEN_PLAYLIST_ID}`
      ))
      await expectCaptionCentered()
    }
  })

  test('clamps the watch playlist after removing most entries', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await openFullscreenPlaylistVideo(page)

    await setPlayerFullscreen(page, true)
    await page.locator('.fullscreenPlaylistToggle').click()
    await expect(page.locator('.fullscreenPlaylistTarget .watchVideoPlaylist')).toBeVisible()

    const playlist = page.locator('.fullscreenPlaylistTarget .watchVideoPlaylist')
    const scroller = playlist.locator('.playlistItemsWrapper')
    const items = scroller.locator('.playlistItem')
    await expect(items).toHaveCount(FULLSCREEN_PLAYLIST.videos.length)
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    await page.evaluate(async ({ playlistId, playlistItemIds, videoIds }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('removeVideos', { _id: playlistId, playlistItemIds, videoIds })
    }, {
      playlistId: FULLSCREEN_PLAYLIST_ID,
      playlistItemIds: FULLSCREEN_PLAYLIST.videos.slice(4).map(video => video.playlistItemId),
      videoIds: FULLSCREEN_PLAYLIST.videos.slice(4).map(video => video.videoId)
    })
    await expect(items).toHaveCount(4)
    await page.waitForTimeout(250)
    expect(await scroller.evaluate(element => element.scrollTop)).toBe(0)
  })

  test('keeps compact watched labels and playlist menus clear of other controls', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await openFullscreenPlaylistVideo(page)

    const playlist = page.locator('.watchVideoPlaylist.resizablePlaylist')
    const item = playlist.locator('.playlistItem').first()
    const thumbnail = item.locator('.videoThumbnail')
    const watched = thumbnail.locator('.videoWatched')
    const actions = thumbnail.locator('.playlistIcons')
    await expect(playlist).toBeVisible()
    await thumbnail.hover()
    await expect(watched).toBeVisible()
    await expect(actions).toBeVisible()
    const duration = thumbnail.locator('.videoDuration')
    await expect(watched).toHaveCSS('font-size', '12px')
    await expect(watched).toHaveCSS('border-radius', '10px')
    await expect(duration).toHaveCSS('font-size', '12px')
    await expect(duration).toHaveCSS('border-radius', '10px')

    const [watchedBox, actionsBox] = await Promise.all([
      watched.boundingBox(),
      actions.boundingBox(),
    ])
    expect(
      watchedBox.x + watchedBox.width <= actionsBox.x ||
    actionsBox.x + actionsBox.width <= watchedBox.x ||
    watchedBox.y + watchedBox.height <= actionsBox.y ||
    actionsBox.y + actionsBox.height <= watchedBox.y
    ).toBe(true)

    const sponsorBlockLabel = thumbnail.locator('.sponsorBlockVideoLabel')
    await thumbnail.evaluate(element => {
      const watched = element.querySelector('.videoWatched')
      watched.style.display = 'none'
      watched.closest('.ft-list-item').classList.remove('watched')

      const label = element.querySelector('.videoDuration').cloneNode(false)
      label.className = 'sponsorBlockVideoLabel'
      const text = document.createElement('span')
      text.textContent = 'Self-Promotion'
      for (const attribute of label.getAttributeNames()) {
        if (attribute.startsWith('data-v-')) {
          text.setAttribute(attribute, '')
        }
      }
      label.append(text)
      element.append(label)
    })
    await expect(sponsorBlockLabel).toBeVisible()
    const [sponsorBlockBox, durationBox, currentActionsBox] = await Promise.all([
      sponsorBlockLabel.boundingBox(),
      duration.boundingBox(),
      actions.boundingBox(),
    ])
    expect(sponsorBlockBox.y).toBeGreaterThan(
      currentActionsBox.y + currentActionsBox.height
    )
    expect(sponsorBlockBox.x + sponsorBlockBox.width).toBeLessThanOrEqual(durationBox.x)

    const addToPlaylist = item.locator('.addToPlaylistIcon .iconButton')
    await addToPlaylist.click()
    const dropdown = page.locator('.app > .dropdownLayer > .iconDropdown.portal')
    await expect(dropdown).toBeVisible()
    const [buttonBox, dropdownBox] = await Promise.all([
      addToPlaylist.boundingBox(),
      dropdown.boundingBox(),
    ])
    expect(
      dropdownBox.y + dropdownBox.height <= buttonBox.y ||
      dropdownBox.y >= buttonBox.y + buttonBox.height
    ).toBe(true)
    expect(dropdownBox.x).toBeGreaterThanOrEqual(8)
    expect(dropdownBox.x + dropdownBox.width).toBeLessThanOrEqual(
      await page.evaluate(() => window.innerWidth - 8)
    )
    expect(await dropdown.evaluate(element => element.parentElement?.parentElement?.classList.contains('app'))).toBe(true)
    await expect(dropdown).toHaveCSS(
      'font-family',
      await page.locator('.app').evaluate(element => getComputedStyle(element).fontFamily)
    )
    expect(await dropdown.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return element.contains(document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2
      ))
    })).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dropdown).toHaveCount(0)

    await item.locator('.title').click({ button: 'right' })
    const contextMenu = page.locator('.contextMenu')
    await expect(contextMenu).toBeVisible()
    await expect(contextMenu.getByRole('menuitem', { name: 'Copy YouTube Link', exact: true })).toBeVisible()
    const menuBounds = await contextMenu.boundingBox()
    expect(menuBounds.x).toBeGreaterThanOrEqual(8)
    expect(menuBounds.y).toBeGreaterThanOrEqual(8)
    // offsetWidth rounds while rendered bounds can retain fractional CSS pixels.
    expect(menuBounds.x + menuBounds.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth - 7))
    expect(menuBounds.y + menuBounds.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight - 7))
  })
})

test('treats an empty comments response as no comments', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)

  let commentRequestCount = 0
  await page.route(/\/youtubei\/v1\/next/, (route, request) => {
    const body = JSON.parse(request.postData() ?? '{}')
    if (!body.continuation) {
      return route.fallback()
    }

    commentRequestCount++
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}'
    })
  })

  await openMockedVideo(page)
  await page.locator('.commentAutoLoadSentinel').scrollIntoViewIfNeeded()

  await expect(page.locator('.noCommentMsg')).toHaveText('There are no comments available for this video')
  const reloadButton = page.locator('.noCommentActions .reloadComments .iconButton')
  const sortSelect = page.locator('.noCommentActions .select-text')
  const expectReloadAlignedBeforeSort = async () => {
    const [reloadBox, sortBox] = await Promise.all([
      reloadButton.boundingBox(),
      sortSelect.boundingBox()
    ])
    expect({
      reloadBeforeSort: reloadBox.x + reloadBox.width <= sortBox.x,
      verticallyAligned: Math.abs(
        reloadBox.y + reloadBox.height / 2 -
        (sortBox.y + sortBox.height / 2)
      ) <= 1
    }).toEqual({
      reloadBeforeSort: true,
      verticallyAligned: true
    })
  }
  await expectReloadAlignedBeforeSort()

  const [actionsBox, messageBox] = await Promise.all([
    page.locator('.noCommentActions').boundingBox(),
    page.locator('.noCommentMsg').boundingBox()
  ])
  expect(Math.abs(
    actionsBox.y + actionsBox.height / 2 -
    (messageBox.y + messageBox.height / 2)
  )).toBeLessThanOrEqual(1)

  await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))
  const [scaledActionsBox, scaledMessageBox] = await Promise.all([
    page.locator('.noCommentActions').boundingBox(),
    page.locator('.noCommentMsg').boundingBox()
  ])
  expect(Math.abs(
    scaledActionsBox.y + scaledActionsBox.height / 2 -
    (scaledMessageBox.y + scaledMessageBox.height / 2)
  )).toBeLessThanOrEqual(1)

  await setWindowSize(app, page, { width: 375, height: 800 })
  await page.locator('.app').evaluate((element) => {
    element.classList.add('capacitorTabs', 'capacitorPhoneLayout')
    element.classList.remove('topTabs', 'bottomTabs', 'verticalTabs')
  })
  await (await watchViewHandle(page)).evaluate(view => view.openPhonePanel('comments'))
  await expect(page.locator('.mobileSheet[open] .noComments')).toBeVisible()

  const readMobileLayout = () => page.locator('.noComments').evaluate((element) => {
    const actionsBounds = element.querySelector('.noCommentActions').getBoundingClientRect()
    const messageBounds = element.querySelector('.noCommentMsg').getBoundingClientRect()
    return {
      actionsAboveMessage: actionsBounds.bottom <= messageBounds.top,
      hasHorizontalOverflow: element.scrollWidth > element.clientWidth + 1
    }
  })
  const expectedMobileLayout = {
    actionsAboveMessage: true,
    hasHorizontalOverflow: false
  }
  expect(await readMobileLayout()).toEqual(expectedMobileLayout)
  await expectReloadAlignedBeforeSort()

  await setWindowSize(app, page, { width: 800, height: 375 })
  expect(await readMobileLayout()).toEqual(expectedMobileLayout)
  await expectReloadAlignedBeforeSort()
  await expect(page.locator('.toast', { hasText: 'Local API Error' })).toHaveCount(0)
  expect(commentRequestCount).toBe(1)
})

test('loads initial comments with the video when automatic pagination is enabled', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setGeneralAutoLoadMorePaginatedItemsEnabled', true)
  })
  // Initial comments must not depend on the later-page sentinel being visible.
  await page.addStyleTag({ content: '.commentAutoLoadSentinel { display: none !important; }' })

  await openMockedVideo(page)

  await expect(page.locator('.getCommentsTitle')).toHaveCount(0, { timeout: 5_000 })
  await expect(page.locator('.commentsTitle')).toBeVisible()
  await expect(page.locator('.getMoreComments')).toHaveCount(0)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
})

test('pauses automatic comment pagination while filtering', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)

  let commentRequestCount = 0
  await page.route(/\/youtubei\/v1\/next/, async (route, request) => {
    const body = JSON.parse(request.postData() ?? '{}')
    if (body.continuation) {
      commentRequestCount++
    }
    await route.fallback()
  })

  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setGeneralAutoLoadMorePaginatedItemsEnabled', true)
  })
  await openMockedVideo(page)
  await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

  await page.getByRole('button', { name: 'Filter loaded comments' }).click()
  await page.getByRole('checkbox', { name: 'From creator' }).click()
  const requestCountAfterFiltering = commentRequestCount

  await page.waitForTimeout(750)
  expect(commentRequestCount).toBe(requestCountAfterFiltering)
  await expect(page.locator('.getMoreComments')).toBeVisible()
})

async function expectCommentHeaderToolsAligned(page) {
  const commentHeaderActions = [
    page.getByRole('button', { name: 'Filter loaded comments' }),
    page.getByRole('button', { name: 'Reload Comments' })
  ]
  const actionCenters = await Promise.all(commentHeaderActions.map(action => (
    action.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return bounds.top + bounds.height / 2
    })
  )))
  expect(Math.max(...actionCenters) - Math.min(...actionCenters)).toBeLessThanOrEqual(1)

  const actionRightEdges = await Promise.all(commentHeaderActions.map(action => (
    action.evaluate(element => element.getBoundingClientRect().right)
  )))
  const sortControlLeft = await page.locator('.commentHeaderActions .select').evaluate(element => {
    return element.getBoundingClientRect().left
  })
  expect(Math.max(...actionRightEdges)).toBeLessThan(sortControlLeft)

  const commentHeaderBottom = await page.locator('.commentHeader').evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return bounds.bottom
  })
  const searchInputTop = await page.getByRole('searchbox', { name: 'Search loaded comments' }).evaluate(element => {
    return element.getBoundingClientRect().top
  })
  expect(searchInputTop - commentHeaderBottom).toBeGreaterThanOrEqual(7.5)
}

test.describe('manual comment loading', () => {
  // These drive the click-to-load path and the reply pagination on top of a
  // single loaded page, so they turn off the automatic pagination that would
  // otherwise load (and keep loading) the comments on its own.
  test.use({
    seed: {
      settings: {
        ...WATCH_PAGE_SEED,
        generalAutoLoadMorePaginatedItemsEnabled: false
      }
    }
  })

  test('translates a comment and restores its original text', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateCurrentLocale', 'de-DE')
    })

    let translationRequestCount = 0
    await page.route(/\/youtubei\/v1\/comment\/perform_comment_action/, route => {
      translationRequestCount++
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          frameworkUpdates: {
            entityBatchUpdate: {
              mutations: [{
                payload: {
                  commentEntityPayload: {
                    translatedContent: {
                      content: 'Translated comment text'
                    }
                  }
                }
              }]
            }
          }
        })
      })
    })

    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    const translatableComment = page.locator('.commentThread').filter({
      has: page.locator(':scope > .commentTranslation .commentTranslationButton')
    }).first()
    const comment = page.locator(`#${await translatableComment.getAttribute('id')}`)
    await expect(comment).toBeVisible()
    const commentText = comment.locator(':scope > .commentText')
    const originalText = await commentText.textContent()
    const translate = comment.locator(':scope > .commentTranslation .commentTranslationButton')

    await translate.click()

    await expect(commentText).toHaveText('Translated comment text')
    await translate.click()
    await expect(commentText).toHaveText(originalText)

    await translate.click()
    await expect(commentText).toHaveText('Translated comment text')
    expect(translationRequestCount).toBe(1)

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateCurrentLocale', 'fr-FR')
    })

    await expect(commentText).toHaveText(originalText)
    await translate.click()
    await expect(commentText).toHaveText('Translated comment text')
    expect(translationRequestCount).toBe(2)

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateCommentTranslationIgnoredLanguages', ['en'])
    })

    await expect(commentText).toHaveText(originalText)
    await expect(translate).toHaveCount(0)
  })

  test('does not offer to translate a comment already in the app language', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    const englishComment = page.locator('.commentThread').filter({
      hasText: "We're so honored that the first ever YouTube video was filmed here!"
    })
    await expect(englishComment).toBeVisible()
    await expect(englishComment.locator(':scope > .commentTranslation .commentTranslationButton')).toHaveCount(0)
  })

  test('does not offer to translate comments in an ignored language', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await Promise.all([
        store.dispatch('updateCurrentLocale', 'de-DE'),
        store.dispatch('updateCommentTranslationIgnoredLanguages', ['en'])
      ])
    })

    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.commentTranslationButton')).toHaveCount(0)

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateCommentTranslationIgnoredLanguages', [])
    })
    await expect(page.locator('.commentTranslationButton').first()).toBeVisible()
  })

  test('disables comment translations globally and restarts detection when re-enabled', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateCurrentLocale', 'de-DE')
    })

    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })
    const translationButtons = page.locator('.commentTranslationButton')
    await expect(translationButtons.first()).toBeVisible()

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateEnableCommentTranslations', false)
    })
    await expect(translationButtons).toHaveCount(0)

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateEnableCommentTranslations', true)
    })
    await expect(translationButtons.first()).toBeVisible()
  })

  test('loads collapsed replies from the video uploader while filtering', async ({ app, page, attachScreenshot }) => {
    await mockPlayableWatchPage(app, page, { creatorReply: true, ownerReply: true })
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.getMoreComments')).toHaveCount(1)

    const ownerReplyToggle = page.locator('.commentReplyRootToggle').getByRole('button', {
      name: /replies from .+ and others/
    })
    await expect(ownerReplyToggle).toBeVisible()
    await expect(ownerReplyToggle.locator('.commentReplyOwnerThumbnail')).toBeVisible()
    await expect(ownerReplyToggle.locator('.commentReplyOwnerSeparator')).toHaveText('•')
    await expect(ownerReplyToggle.locator('.commentReplyToggleText')).toHaveText(/\d+ replies/)
    await expect(ownerReplyToggle).not.toContainText('from')
    const ownerReplyThreadWithToggle = page.locator('.commentThread').filter({ has: ownerReplyToggle })
    const ownerReplyThread = page.locator(`#${await ownerReplyThreadWithToggle.getAttribute('id')}`)
    const ownerReplyThreadElement = await ownerReplyThread.elementHandle()
    expect(ownerReplyThreadElement).not.toBeNull()
    await expect(ownerReplyThread.locator('.commentReplyContent')).toHaveCount(0)
    await ownerReplyToggle.scrollIntoViewIfNeeded()
    await attachScreenshot('uploader reply indicator')

    await page.getByRole('button', { name: 'Filter loaded comments' }).click()
    await page.getByRole('checkbox', { name: 'From creator' }).click()
    await expect.poll(() => ownerReplyThreadElement.evaluate(element => ({
      isConnected: element.isConnected,
      isVisible: element.getClientRects().length > 0,
      loadedReplyCount: element.querySelectorAll('.commentReplyContent').length
    }))).toEqual({ isConnected: true, isVisible: true, loadedReplyCount: 0 })
    await expect(ownerReplyToggle).toBeVisible()
    await ownerReplyToggle.click()
    await expect.poll(() => ownerReplyThread.evaluate(element => {
      const replies = [...element.querySelectorAll('.commentReplyContent')]
      return replies.length > 0 && replies.every(reply => reply.querySelector('.commentOwner'))
    })).toBe(true)
    await ownerReplyThreadElement.dispose()
  })

  for (const scale of [100, 125]) {
    test(`toggles comment thread lines with mouse and keyboard at ${scale}% scale`, async ({ app, page, attachScreenshot }) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      await page.evaluate(async scale => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        await store.dispatch('updateUiScale', scale)
        await store.dispatch('updateBaseTheme', scale === 100 ? 'dark' : 'light')
      }, scale)
      await page.locator('.getCommentsTitle').click()
      await expect(page.locator('.commentsTitle')).toBeVisible()

      const thread = page.locator('.commentThread').first()
      const line = thread.locator(':scope > .commentThreadLineToggle')
      await expect(line).toHaveAttribute('aria-expanded', 'false')
      await page.mouse.move(0, 0)
      const restingColor = await thread.evaluate(element => getComputedStyle(element, '::before').borderInlineStartColor)
      await line.hover({ position: { x: 10, y: 5 } })
      await expect(line).toHaveCSS('cursor', 'pointer')
      await expect.poll(() => thread.evaluate(element => getComputedStyle(element, '::before').borderInlineStartColor)).not.toBe(restingColor)
      await line.click({ position: { x: 10, y: 5 } })
      await expect(line).toHaveAttribute('aria-expanded', 'true')
      await expect(thread.locator('.commentReplyContent').first()).toBeVisible()
      const replyCount = await thread.locator('.commentReplyContent').count()

      const connector = thread.locator('.commentReplyConnectorToggle').first()
      await connector.hover()
      await expect(connector).toHaveCSS('cursor', 'pointer')
      await expect.poll(() => connector.evaluate(element => getComputedStyle(element).borderInlineStartColor)).not.toBe(restingColor)
      await expect.poll(() => thread.evaluate(element => getComputedStyle(element, '::before').borderInlineStartColor)).not.toBe(restingColor)
      await expect.poll(() => thread.locator(':scope > .commentReplies > .commentReplyContinuation').last().evaluate(element => getComputedStyle(element, '::before').borderInlineStartColor)).not.toBe(restingColor)
      await connector.click()
      await expect(thread.locator('.commentReplyContent')).toHaveCount(0)
      await line.focus()
      await line.press('Enter')
      await expect(thread.locator('.commentReplyContent')).toHaveCount(replyCount)
      await line.press('Space')
      await expect(thread.locator('.commentReplyContent')).toHaveCount(0)
      await line.press('Enter')

      // Give one loaded reply children so the same controls are exercised at a
      // second depth without relying on YouTube's changing reply structure.
      const branch = thread.locator('.commentReplyBranchRoot').first()
      await branch.evaluate(element => {
        const find = vnode => {
          if (vnode?.component?.subTree?.el === element) return vnode.component
          if (vnode?.component?.subTree) {
            const match = find(vnode.component.subTree)
            if (match) return match
          }
          for (const child of Array.isArray(vnode?.children) ? vnode.children : []) {
            const match = find(child)
            if (match) return match
          }
          return null
        }
        const component = find(document.querySelector('#app').__vue_app__._container._vnode)
        const reply = component.props.node.reply
        reply.replies = Array.from({ length: 8 }, (_, index) => ({
          ...reply,
          id: `thread-line-child-${index}`,
          text: `Nested reply ${index}`,
          replies: [],
          numReplies: 0,
          hasReplyToken: false,
        }))
        reply.numReplies = 8
        reply.hasReplyToken = false
      })
      const nestedLine = branch.locator(':scope > .commentReplyLineToggle')
      const children = branch.locator('.commentReplyChildren .commentReplyContent')
      await expect(children).toHaveCount(8)
      await expect(thread.locator('.commentReplyContinuationButton').filter({ hasText: /^Hide / })).toHaveCount(1)
      await line.evaluate(element => element.blur())
      await nestedLine.hover({ position: { x: 10, y: 5 } })
      await expect(nestedLine).toHaveCSS('cursor', 'pointer')
      await expect.poll(() => branch.locator('.commentReplyChildStem').evaluate(element => getComputedStyle(element).borderInlineStartColor)).not.toBe(restingColor)
      await attachScreenshot(`comment thread line hover at ${scale}%`)
      await nestedLine.click({ position: { x: 10, y: 5 } })
      await expect(children).toHaveCount(0)
      await expect(thread.locator('.commentReplyContent')).toHaveCount(replyCount)
      await nestedLine.focus()
      await nestedLine.press('Space')
      await expect(children).toHaveCount(8)
      await nestedLine.evaluate(element => element.blur())
      const nestedConnector = branch.locator('.commentReplyChildren .commentReplyConnectorToggle').first()
      await nestedConnector.hover()
      await expect.poll(() => branch.locator('.commentReplyChildStem').evaluate(element => getComputedStyle(element).borderInlineStartColor)).not.toBe(restingColor)
      await expect.poll(() => thread.evaluate(element => getComputedStyle(element, '::before').borderInlineStartColor)).toBe(restingColor)
      await nestedConnector.click()
      await expect(children).toHaveCount(0)
      await branch.locator(':scope > .commentReplyChildren > .commentReplyContinuation button').click()
      await expect(children).toHaveCount(8)

      await setPlayerFullscreen(page, true)
      await page.locator('.fullscreenCommentsToggle').click({ force: true })
      const scroller = page.locator('.fullscreenCommentsOverlay.open .commentsContentWrapper')
      for (const toggle of [nestedLine, line]) {
        await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
        const previousScrollTop = await scroller.evaluate(element => element.scrollTop)
        expect(previousScrollTop).toBeGreaterThan(0)
        await toggle.evaluate(element => element.click())
        await expect.poll(() => scroller.evaluate((element, previousScrollTop) => {
          const content = element.querySelector(':scope > div')
          const maximumScrollTop = Math.max(0, element.scrollTop +
            content.getBoundingClientRect().bottom - element.getBoundingClientRect().bottom)
          const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
          return {
            reduced: element.scrollTop < previousScrollTop,
            scrollbarMatchesOverflow: scrollbar.classList.contains('os-scrollbar-visible') === (maximumScrollTop > 1),
          }
        }, previousScrollTop)).toEqual({ reduced: true, scrollbarMatchesOverflow: true })
        await expect.poll(() => scroller.evaluate(element => {
          const content = element.querySelector(':scope > div')
          return element.getBoundingClientRect().bottom - content.getBoundingClientRect().bottom
        // The clamp uses integer layout offsets and heights; their rounding
        // can add up to more than one CSS pixel at fractional Electron zoom.
        })).toBeLessThanOrEqual(2)
      }
    })
  }

  test('searches the comments loaded for the current video', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    const comments = page.locator('.commentThread')
    const initialCommentCount = await comments.count()
    expect(initialCommentCount).toBeGreaterThan(1)

    await expect(page.getByRole('searchbox', { name: 'Search loaded comments' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Filter loaded comments' }).click()
    const searchFilter = page.getByRole('checkbox', { name: 'Search loaded comments' })
    await expect(searchFilter).toBeFocused()
    await searchFilter.click()
    const commentSearchInput = page.getByRole('searchbox', { name: 'Search loaded comments' })
    await expect(commentSearchInput).toBeFocused()
    await expect(page.locator('.commentTools .clearInputTextButton')).toHaveCount(0)
    await expectCommentHeaderToolsAligned(page)
    await commentSearchInput.fill('honored')

    const searchCancelButtonStyles = await page.evaluate(() => {
      const rules = [...document.styleSheets].flatMap(sheet => [...sheet.cssRules])
      const baseRule = rules.find(rule => (
        rule.selectorText?.includes('input[type="search"]::-webkit-search-cancel-button') &&
        !rule.selectorText.includes(':hover') &&
        !rule.selectorText.includes(':active')
      ))
      const hoverRule = rules.find(rule => rule.selectorText?.includes('::-webkit-search-cancel-button:hover'))

      return {
        appearance: baseRule?.style.getPropertyValue('-webkit-appearance'),
        backgroundColor: baseRule?.style.backgroundColor,
        blockSize: baseRule?.style.blockSize,
        hoverBackgroundColor: hoverRule?.style.backgroundColor,
        inlineSize: baseRule?.style.inlineSize,
        maskSize: baseRule?.style.maskSize
      }
    })
    expect(searchCancelButtonStyles).toEqual({
      appearance: 'none',
      backgroundColor: 'var(--secondary-text-color)',
      blockSize: '24px',
      hoverBackgroundColor: 'var(--primary-color)',
      inlineSize: '24px',
      maskSize: '12px 12px',
    })

    await expect(comments).toHaveCount(1)
    await expect(comments).toContainText("We're so honored that the first ever YouTube video was filmed here!")
    await expect(comments.locator('.commentText mark')).toHaveText('honored')
    await expect(page.getByText(`1 of ${initialCommentCount} loaded comments`)).toBeVisible()

    await commentSearchInput.fill('WahilPro')
    await expect(comments).toHaveCount(1)
    await expect(comments.locator('.commentAuthor mark')).toHaveText('WahilPro')
  })

  test('searches loaded replies and keeps their parent thread', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    const thread = page.locator('.commentThread').first()
    await thread.locator('.commentReplyRootToggle button').click()
    const firstReply = thread.locator('.commentReplyContent').first()
    await expect(firstReply).toBeVisible({ timeout: 30_000 })
    const replyAuthor = await firstReply.locator('.commentAuthor').innerText()

    await page.getByRole('button', { name: 'Filter loaded comments' }).click()
    await page.getByRole('checkbox', { name: 'Search loaded comments' }).click()
    await page.getByRole('searchbox', { name: 'Search loaded comments' }).fill(replyAuthor)

    await expect(page.locator('.commentThread')).toHaveCount(1)
    await expect(page.locator('.commentReplyContent')).toHaveCount(1)
    await expect(page.locator('.commentReplyContent .commentAuthor mark')).toHaveText(replyAuthor)
  })

  test('keeps creator-filtered thread lines connected without dangling stems', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { creatorReply: true })
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    const thread = page.locator('.commentThread').first()
    await thread.locator('.commentReplyRootToggle button').click()
    const firstReply = thread.locator('.commentReplyContent').first()
    await expect(firstReply).toBeVisible({ timeout: 30_000 })
    await firstReply.evaluate(element => {
      const branch = element.closest('.commentReplyBranch')
      const app = document.querySelector('#app')?.__vue_app__
      const find = vnode => {
        if (vnode?.component?.subTree?.el === branch) return vnode.component
        if (vnode?.component?.subTree) {
          const match = find(vnode.component.subTree)
          if (match) return match
        }
        if (Array.isArray(vnode?.children)) {
          for (const child of vnode.children) {
            const match = find(child)
            if (match) return match
          }
        }
        return null
      }
      const replyComponent = find(app?._container?._vnode)
      if (!replyComponent) throw new Error('Unable to access the comment reply')
      replyComponent.props.node.reply.hasReplyToken = true
    })
    await expect(firstReply.locator(':scope > .commentReplyChildStem')).toHaveCount(1)

    await page.getByRole('button', { name: 'Filter loaded comments' }).click()
    await page.getByRole('checkbox', { name: 'From creator' }).click()

    const filteredReplyThread = page.locator('.commentThread').filter({
      has: page.locator('.commentReplyContent')
    })
    await expect(filteredReplyThread).toHaveCount(1)
    await expect(filteredReplyThread.locator('.commentReplyContent')).toHaveCount(1)
    await expect(filteredReplyThread.locator('.commentReplyChildStem')).toHaveCount(0)

    const expectLineToEndAtLastConnectorStart = () => expect.poll(() => filteredReplyThread.evaluate(element => {
      const lineStyle = getComputedStyle(element, '::before')
      const lineEnd = element.getBoundingClientRect().bottom - Number.parseFloat(lineStyle.insetBlockEnd)
      const connectors = element.querySelectorAll(
        ':scope > .commentReplies > .commentReplyBranchRoot > .commentReplyConnector'
      )
      const connectorStart = connectors.item(connectors.length - 1).getBoundingClientRect().top
      return Math.abs(lineEnd - connectorStart)
    })).toBeLessThanOrEqual(0.5)

    await expectLineToEndAtLastConnectorStart()
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.dispatch('updateUiScale', 125)
    })
    await expectLineToEndAtLastConnectorStart()
  })

  test('filters comments with timestamps and keeps highlighted timestamps clickable', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { commentTimestamp: true })
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Filter loaded comments' }).click()
    await page.getByRole('checkbox', { name: 'Contains timestamps' }).click()
    await expect(page.locator('.commentThread')).toHaveCount(1)

    await page.getByRole('checkbox', { name: 'Search loaded comments' }).click()
    const search = page.getByRole('searchbox', { name: 'Search loaded comments' })
    await search.fill('0:05')
    const timestamp = page.locator('.commentThread .commentText a[data-time="5"]')
    await expect(timestamp.locator('mark')).toHaveText('0:05')

    const video = page.locator('video')
    await video.evaluate(element => {
      element.pause()
      element.currentTime = 0
    })
    await timestamp.locator('mark').click()
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(5, 1)
  })

  test('keeps personal comment pins for the current video', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const initialCommentsResponsePromise = page.waitForResponse(response => {
      if (!/\/youtubei\/v1\/next/.test(response.url())) return false
      return Boolean(JSON.parse(response.request().postData() ?? '{}').continuation)
    }, { timeout: 30_000 })
    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    const initialCommentsResponse = await initialCommentsResponsePromise
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    const pinnedComment = page.locator('.commentThread').filter({ hasText: 'Who is here today?' })
    await pinnedComment.getByRole('button', { name: 'Pin comment by @WahilPro' }).click()
    await expect(pinnedComment).toContainText('Pinned by you')
    await expect(pinnedComment.getByRole('button', { name: 'Unpin comment by @WahilPro' })).toHaveAttribute('aria-pressed', 'true')
    await expect(pinnedComment).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(pinnedComment.locator('.commentPersonalPin')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(page.locator('.commentThread').first()).toContainText('Who is here today?')

    const commentsWithoutPinned = await initialCommentsResponse.json()
    const mutations = commentsWithoutPinned.frameworkUpdates.entityBatchUpdate.mutations
    const pinnedMutation = mutations.find(mutation => {
      return mutation.payload?.commentEntityPayload?.properties?.content?.content === 'Who is here today?'
    })
    const pinnedCommentId = pinnedMutation.payload.commentEntityPayload.properties.commentId
    commentsWithoutPinned.frameworkUpdates.entityBatchUpdate.mutations = mutations.filter(mutation => {
      return mutation.payload?.commentEntityPayload?.properties?.commentId !== pinnedCommentId
    })
    for (const endpoint of commentsWithoutPinned.onResponseReceivedEndpoints) {
      const command = endpoint.reloadContinuationItemsCommand ?? endpoint.appendContinuationItemsAction
      if (!Array.isArray(command?.continuationItems)) continue

      command.continuationItems = command.continuationItems.filter(item => {
        return item.commentThreadRenderer?.commentViewModel?.commentViewModel?.commentId !== pinnedCommentId
      })
    }
    expect(JSON.stringify(commentsWithoutPinned)).not.toContain('Who is here today?')

    await page.route(/\/youtubei\/v1\/next/, route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(commentsWithoutPinned)
    }), { times: 1 })
    const reloadResponse = page.waitForResponse(/\/youtubei\/v1\/next/, { timeout: 30_000 })
    await page.getByRole('button', { name: 'Reload Comments' }).click()
    await reloadResponse

    await expect(pinnedComment).toHaveCount(1)
    await expect(page.locator('.commentThread').first()).toContainText('Who is here today?')
    await expect(page.locator('.commentThread').first()).toContainText('Pinned by you')
  })

  test('keeps personal pins on loaded replies', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    let thread = page.locator('.commentThread').first()
    const parentAuthor = await thread.locator(':scope > .commentAuthorWrapper .commentAuthor').innerText()
    await thread.locator('.commentReplyRootToggle button').click()
    let firstReply = thread.locator('.commentReplyContent').first()
    await expect(firstReply).toBeVisible({ timeout: 30_000 })
    const replyAuthor = await firstReply.locator('.commentAuthor').innerText()
    await firstReply.getByRole('button', { name: `Pin comment by ${replyAuthor}` }).click()
    await expect(firstReply).toContainText('Pinned by you')
    await expect(thread.locator(':scope > .commentPersonalPin')).toContainText('A reply is pinned')
    await expect(thread.getByRole('button', { name: `Pin comment by ${parentAuthor}` })).toHaveAttribute('aria-pressed', 'false')

    const reloadResponse = page.waitForResponse(/\/youtubei\/v1\/next/, { timeout: 30_000 })
    await page.getByRole('button', { name: 'Reload Comments' }).click()
    await reloadResponse

    thread = page.locator('.commentThread').first()
    await expect(thread.locator(':scope > .commentPersonalPin')).toContainText('A reply is pinned')
    const parentPinButton = thread.getByRole('button', { name: `Pin comment by ${parentAuthor}` })
    await expect(parentPinButton).toHaveAttribute('aria-pressed', 'false')
    await thread.locator('.commentReplyRootToggle button').click()
    firstReply = thread.locator('.commentReplyContent').filter({ hasText: replyAuthor })
    const replyUnpinButton = firstReply.getByRole('button', { name: `Unpin comment by ${replyAuthor}` })
    await expect(replyUnpinButton).toHaveAttribute('aria-pressed', 'true')
    await expect(firstReply).toContainText('Pinned by you')

    await replyUnpinButton.click()
    await expect(thread.locator(':scope > .commentPersonalPin')).toHaveCount(0)
    await firstReply.getByRole('button', { name: `Pin comment by ${replyAuthor}` }).click()
    await expect(thread.locator(':scope > .commentPersonalPin')).toContainText('A reply is pinned')

    await parentPinButton.click()
    await expect(thread.locator(':scope > .commentPersonalPin')).toContainText('Pinned by you')
    await expect(thread.getByRole('button', { name: `Unpin comment by ${parentAuthor}` })).toHaveAttribute('aria-pressed', 'true')
  })

  test('filters loaded comments to the video creator', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Filter loaded comments' }).click()
    const creatorFilter = page.getByRole('checkbox', { name: 'From creator' })
    await expect(creatorFilter.locator('.commentCreatorFilterAvatar')).toHaveAttribute('src', /.+/)
    await creatorFilter.click()

    await expect(page.locator('.commentThread')).toHaveCount(1)
    await expect(page.locator('.commentThread')).toContainText('@jawed')
    await expect(page.locator('.commentThread')).toContainText('Hello')
  })

  test('applies the shortened view count setting to comment likes', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    const commentLikes = page.locator('.commentThread')
      .filter({ hasText: "We're so honored" })
      .locator('.commentLikeCount')
    await expect(commentLikes).toContainText(/4\.6\s?m/i)

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.dispatch('updateShortenViewCounts', false)
    })
    await expect(commentLikes).toContainText('4,600,000')
  })

  test('renders whitespace-only zero like counts as zero', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { blankCommentLikes: true })
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    const commentLikes = page.locator('.commentThread')
      .filter({ hasText: "We're so honored" })
      .locator('.commentLikeCount')
    await expect(commentLikes).toHaveText('0')
  })

  test.describe('comment filtering at 125% UI scale', () => {
    test.use({
      seed: {
        settings: {
          ...WATCH_PAGE_SEED,
          generalAutoLoadMorePaginatedItemsEnabled: false,
          uiScale: 125
        },
        profiles: [{
          _id: 'allChannels',
          name: 'All Channels',
          bgColor: '#d50000',
          textColor: '#FFFFFF',
          subscriptions: []
        }, {
          _id: 'commentPinsProfile',
          name: 'Comment pins profile',
          bgColor: '#558B2F',
          textColor: '#FFFFFF',
          subscriptions: []
        }]
      }
    })

    test('clamps fullscreen comment scrolling after switching pin storage groups', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)

      const loadComments = page.locator('.getCommentsTitle')
      await loadComments.scrollIntoViewIfNeeded()
      await loadComments.click()
      await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

      const liveCommentCount = await page.locator('.commentThread').count()
      const persistedCommentCount = 20
      await page.evaluate(({ persistedCommentCount }) => {
        const commentSnapshots = Array.from({ length: persistedCommentCount }, (_, index) => ({
          id: `persisted-comment-${index}`,
          author: `@PersistedAuthor${index}`,
          authorId: `UC-persisted-${index}`,
          authorLink: `UC-persisted-${index}`,
          authorThumb: '',
          dataType: 'local',
          hasOwnerReplied: false,
          hasReplyToken: false,
          isEdited: false,
          isHearted: false,
          isMember: false,
          isOwner: false,
          isPinned: false,
          likes: 0,
          memberIconUrl: '',
          numReplies: 0,
          published: 0,
          replies: [],
          showReplies: false,
          text: `Persisted pinned comment ${index}`,
          time: 'now',
          translationText: ''
        }))
        localStorage.setItem('opentubex-comment-pins', JSON.stringify({
          'allChannels:video:jNQXAC9IVRw': {
            commentIds: commentSnapshots.map(comment => comment.id),
            commentSnapshots
          }
        }))
      }, { persistedCommentCount })

      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        return store.dispatch('updateActiveProfile', 'commentPinsProfile')
      })
      await expect.poll(() => page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        return store.getters.getActiveProfile._id
      })).toBe('commentPinsProfile')
      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        return store.dispatch('updateActiveProfile', 'allChannels')
      })
      await expect(page.locator('.commentThread')).toHaveCount(liveCommentCount + persistedCommentCount)

      await setPlayerFullscreen(page, true)
      await page.locator('.fullscreenCommentsToggle').click({ force: true })

      const dock = page.locator('.fullscreenCommentsOverlay.open')
      const scroller = dock.locator('.commentsContentWrapper')
      const scrollbar = scroller.locator(':scope > .os-scrollbar-vertical')
      const commentsList = dock.locator('.commentThread').first().locator('..')
      await expect.poll(() => scroller.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      const previousContentHeight = await commentsList.evaluate(element => element.offsetHeight)

      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        return store.dispatch('updateActiveProfile', 'commentPinsProfile')
      })
      await expect(dock.locator('.commentThread')).toHaveCount(liveCommentCount)
      await expect.poll(() => commentsList.evaluate(element => element.offsetHeight))
        .toBeLessThan(previousContentHeight)
      await expect.poll(() => scroller.evaluate(element => {
        const contentElement = element.querySelector('.commentThread')?.parentElement
        if (!contentElement) return false

        const viewportBounds = element.getBoundingClientRect()
        const contentBounds = contentElement.getBoundingClientRect()
        const contentMarginBlockEnd = Number.parseFloat(getComputedStyle(contentElement).marginBlockEnd) || 0
        const viewportPaddingBottom = Number.parseFloat(getComputedStyle(element).paddingBottom) || 0
        const renderedEndGap = viewportBounds.bottom - contentBounds.bottom
        return Math.abs(renderedEndGap - contentMarginBlockEnd - viewportPaddingBottom) <= 1
      })).toBe(true)
      await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
    })

    test('clamps fullscreen comment scrolling after creator and search filtering', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)

      const loadComments = page.locator('.getCommentsTitle')
      await loadComments.scrollIntoViewIfNeeded()
      await loadComments.click()
      await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

      await page.getByRole('button', { name: 'Filter loaded comments' }).click()
      await page.getByRole('checkbox', { name: 'Search loaded comments' }).click()
      await expectCommentHeaderToolsAligned(page)
      await page.getByRole('searchbox', { name: 'Search loaded comments' }).press('Escape')

      await setPlayerFullscreen(page, true)
      await page.locator('.fullscreenCommentsToggle').click({ force: true })

      const dock = page.locator('.fullscreenCommentsOverlay.open')
      const scroller = dock.locator('.commentsContentWrapper')
      const scrollbar = scroller.locator(':scope > .os-scrollbar-vertical')
      await dock.getByRole('button', { name: 'Filter loaded comments' }).click()
      await expect(dock.getByRole('checkbox', { name: 'From creator' }).locator('.commentCreatorFilterAvatar')).toHaveAttribute('src', /.+/)
      await dock.getByRole('button', { name: 'Filter loaded comments' }).click()
      await expect.poll(() => scroller.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
      await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)

      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

      await dock.getByRole('button', { name: 'Filter loaded comments' }).click()
      const creatorFilter = dock.getByRole('checkbox', { name: 'From creator' })
      await creatorFilter.click()

      await expect(dock.locator('.commentThread')).toHaveCount(1)
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
      await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)

      await creatorFilter.click()
      await expect.poll(() => scroller.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
      await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
      await dock.getByRole('button', { name: 'Filter loaded comments' }).click()
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

      await dock.getByRole('button', { name: 'Filter loaded comments' }).click()
      await dock.getByRole('checkbox', { name: 'Search loaded comments' }).click()
      await dock.getByRole('searchbox', { name: 'Search loaded comments' }).fill('honored')

      await expect(dock.locator('.commentThread')).toHaveCount(1)
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
      await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
    })
  })

  test('stale reply controls disappear after an empty final reply page', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    const comments = page.locator('.comment')
    const commentIndex = await comments.evaluateAll(elements => (
      elements.findIndex(element => element.querySelector('.commentReplyRootToggle'))
    ))
    expect(commentIndex).toBeGreaterThanOrEqual(0)
    const comment = comments.nth(commentIndex)
    const replyToggleRow = comment.locator('.commentReplyRootToggle')
    const replyToggle = replyToggleRow.locator('.commentReplyContinuationButton')
    await expect(replyToggle).toBeVisible()
    await expect(replyToggle).not.toContainText('View')
    await expect(replyToggle.locator('svg')).toBeVisible()
    expect(await replyToggleRow.evaluate(element => (
      getComputedStyle(element, '::before').borderInlineStartWidth
    ))).toBe('1px')
    expect(await comment.evaluate((element) => {
      const toggle = element.querySelector('.commentReplyRootToggle')
      const stemStyle = getComputedStyle(element, '::before')
      const connectorStyle = getComputedStyle(toggle, '::before')
      const stemBottom = element.getBoundingClientRect().bottom - Number.parseFloat(stemStyle.insetBlockEnd)
      const connectorTop = toggle.getBoundingClientRect().top +
        Number.parseFloat(connectorStyle.insetBlockStart)
      return Math.abs(stemBottom - connectorTop)
    })).toBeLessThanOrEqual(0.5)

    await page.route(/\/youtubei\/v1\/next/, route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        onResponseReceivedEndpoints: [{
          appendContinuationItemsAction: {
            targetId: 'comment-replies-item-stale'
          }
        }]
      })
    }), { times: 1 })

    await replyToggle.click()

    await expect(comment.locator('.commentReplyRootToggle')).toHaveCount(0)
    await expect(comment).not.toHaveClass(/commentThreadCollapsed/)
    await expect(comment.locator('.commentReplyBranch')).toHaveCount(0)
  })

  test('reloading fullscreen comments scrolls back to the first comment', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await waitForPlayback(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    await setPlayerFullscreen(page, true)
    await page.locator('.fullscreenCommentsToggle').click({ force: true })

    const comments = page.locator('.fullscreenCommentsOverlay .commentsContentWrapper')
    await expect(comments).toBeVisible()
    await expect.poll(async () => comments.evaluate((element) => element.scrollHeight)).toBeGreaterThan(500)

    // The end of the loaded comments: the offset the reloaded, shorter list has
    // no room for, so it used to leave the dock parked past its own content.
    await comments.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await expect.poll(async () => comments.evaluate((element) => element.scrollTop)).toBeGreaterThan(300)

    const [reloadResponse] = await Promise.all([
      page.waitForResponse(/\/youtubei\/v1\/next/, { timeout: 30_000 }),
      page.locator('.fullscreenCommentHeader').getByRole('button', { name: 'Reload Comments' }).click()
    ])
    expect(reloadResponse.ok()).toBe(true)
    await expect(page.locator('.fullscreenCommentsOverlay .comment').first()).toBeVisible({ timeout: 30_000 })

    // OverlayScrollbars reapplies its remembered offset once the new list has
    // rendered, so the position has to still be at the top a moment later.
    await page.waitForTimeout(1000)
    expect(await comments.evaluate((element) => element.scrollTop)).toBe(0)
  })
})

test.describe('Shorts feed navigation', () => {
  const SHORTS_CHANNEL = 'UC-transcript-shorts'
  const FIRST_SHORT_THUMBNAIL = 'https://i.ytimg.com/vi/jNQXAC9IVRw/frame0.jpg?selected=1'
  const SECOND_SHORT_THUMBNAIL = 'https://i.ytimg.com/vi/captioned-short-2/frame0.jpg?selected=1'

  test.use({
    seed: {
      settings: {
        ...WATCH_PAGE_SEED,
        useCustomShortsPlayer: true,
        useSponsorBlock: true,
        fetchSubscriptionsAutomatically: false,
        playNextVideo: true,
        defaultInterval: 0
      },
      profiles: [{
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [{
          id: SHORTS_CHANNEL,
          name: 'Shorts Channel',
          thumbnail: ''
        }]
      }],
      subscriptionCache: [{
        _id: SHORTS_CHANNEL,
        shorts: [
          {
            type: 'video',
            videoId: 'jNQXAC9IVRw',
            title: 'First seeded Short',
            author: 'Shorts Channel',
            authorId: SHORTS_CHANNEL,
            published: 2,
            isShort: true,
            lengthSeconds: '',
            thumbnailUrl: FIRST_SHORT_THUMBNAIL
          },
          {
            type: 'video',
            videoId: 'captioned-short-2',
            title: 'Second seeded Short',
            author: 'Shorts Channel',
            authorId: SHORTS_CHANNEL,
            published: 1,
            isShort: true,
            lengthSeconds: '',
            thumbnailUrl: SECOND_SHORT_THUMBNAIL
          }
        ],
        shortsTimestamp: new Date().toISOString()
      }]
    }
  })

  test('scrolls through the cached subscriptions Shorts feed', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { captionVideoIds: ['jNQXAC9IVRw', 'captioned-short-2'] })
    await page.route('**/api/skipSegments**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    const shortsTab = page
      .locator('.tabContent[aria-hidden="false"]')
      .locator('[data-subscription-feed-tab="shorts"]')
    await shortsTab.click()
    await page.getByText('First seeded Short', { exact: true }).click()
    await expect(page).toHaveURL(
      /#\/watch\/jNQXAC9IVRw\?short=true&shortSource=subscriptions/
    )

    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    await expect(player).toBeVisible({ timeout: 30_000 })

    const previous = page.locator('.shortsNavigationButton').first()
    const next = page.locator('.shortsNavigationButton').last()
    await expect(previous).toBeDisabled()
    await expect(next).toBeEnabled()
    await expect(page.locator('.shortsNextPreview')).toBeVisible()
    await expect(page.locator('.shortsNextPreview')).toHaveAttribute(
      'style',
      /captioned-short-2\/frame0\.jpg\?selected=1/
    )
    await expect(page.locator('.shortsExternalMetadata')).toBeVisible()
    await expect(page.locator('.shortsActionRail')).toBeVisible()

    const commentsButton = page.locator('.shortsCommentsAction').getByRole('button')
    await commentsButton.click()
    const commentsPanel = page.locator('.shortsCommentsPanel')
    await expect(commentsPanel).toHaveClass(/shortsCommentsPanelOpen/)
    const commentsScroller = commentsPanel.locator('.commentsContentWrapper')
    const firstComment = commentsPanel.locator('.comment').first()
    const loadComments = commentsPanel.locator('.getCommentsTitle')
    await expect(firstComment.or(loadComments)).toBeVisible()
    if (await loadComments.isVisible()) {
      await loadComments.click()
    }
    await expect(firstComment).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => commentsScroller.evaluate(element => {
      return element.scrollHeight > element.clientHeight
    })).toBe(true)
    const commentsScrollTop = await commentsScroller.evaluate(element => element.scrollTop)
    const commentsBounds = await commentsScroller.boundingBox()
    await page.mouse.move(commentsBounds.x + commentsBounds.width / 2, commentsBounds.y + commentsBounds.height / 2)
    await page.mouse.wheel(0, 120)
    await expect.poll(() => commentsScroller.evaluate(element => element.scrollTop))
      .toBeGreaterThan(commentsScrollTop)
    await expect(page).toHaveURL(
      /#\/watch\/jNQXAC9IVRw\?short=true&shortSource=subscriptions/
    )
    await page.keyboard.press('ArrowDown')
    await expect(page).toHaveURL(
      /#\/watch\/jNQXAC9IVRw\?short=true&shortSource=subscriptions/
    )

    await page.evaluate(() => window.scrollTo({
      top: document.documentElement.scrollHeight
    }))
    await expect(page).toHaveURL(
      /#\/watch\/captioned-short-2\?short=true&shortSource=subscriptions/
    )
    await expect(commentsPanel).toHaveClass(/shortsCommentsPanelOpen/)

    await page.waitForTimeout(500)
    await previous.click()
    await expect(page).toHaveURL(
      /#\/watch\/jNQXAC9IVRw\?short=true&shortSource=subscriptions/
    )
    await expect(commentsPanel).toHaveClass(/shortsCommentsPanelOpen/)
    await commentsPanel.getByRole('button', { name: 'Hide Comments' }).click()

    const auxPanel = page.locator('.shortsAuxPanel')
    const sponsorBlockButton = page.getByRole('button', { name: 'Open SponsorBlock info' })
    await sponsorBlockButton.click()
    await expect(sponsorBlockButton).toHaveAttribute('aria-pressed', 'true')
    await expect(auxPanel).toHaveClass(/shortsAuxPanelOpen/)
    const sponsorBlockContent = auxPanel.locator('.sponsorBlockContent')
    await expect(sponsorBlockContent).toHaveCSS('overscroll-behavior', 'contain')
    const sponsorBlockBounds = await sponsorBlockContent.boundingBox()
    await page.mouse.move(sponsorBlockBounds.x + 20, sponsorBlockBounds.y + 20)
    await page.mouse.wheel(0, 2000)
    await expect(page).toHaveURL(
      /#\/watch\/jNQXAC9IVRw\?short=true&shortSource=subscriptions/
    )

    await page.waitForTimeout(500)
    await page.evaluate(() => window.scrollTo({
      top: document.documentElement.scrollHeight
    }))
    await expect(page).toHaveURL(
      /#\/watch\/captioned-short-2\?short=true&shortSource=subscriptions/
    )
    await expect(auxPanel).toHaveClass(/shortsAuxPanelOpen/)
    await expect(sponsorBlockButton).toHaveAttribute('aria-pressed', 'true')

    await page.waitForTimeout(500)
    await previous.click()
    await expect(page).toHaveURL(
      /#\/watch\/jNQXAC9IVRw\?short=true&shortSource=subscriptions/
    )
    await expect(auxPanel).toHaveClass(/shortsAuxPanelOpen/)
    await expect(sponsorBlockButton).toHaveAttribute('aria-pressed', 'true')
    await auxPanel.locator('.sponsorBlockHeader').getByRole('button', { name: 'Close' }).click()

    const transcriptButton = page.locator('.shortsComponentAction')
      .filter({ hasText: 'Transcript' })
      .getByRole('button')
    await transcriptButton.click()
    const transcriptCard = auxPanel.locator('.watchVideoTranscript')
    const transcriptTarget = auxPanel.locator('.shortsAuxPanelTarget')
    await expect(transcriptCard).toBeVisible()
    await expect(transcriptTarget).toHaveCSS('overscroll-behavior', 'contain')
    await expect.poll(async () => {
      const [cardHeight, targetHeight] = await Promise.all([
        transcriptCard.evaluate(element => element.offsetHeight),
        transcriptTarget.evaluate(element => element.clientHeight),
      ])
      return Math.abs(cardHeight - targetHeight)
    }).toBeLessThanOrEqual(32)
    const transcriptBounds = await transcriptTarget.boundingBox()
    await page.mouse.move(transcriptBounds.x + 20, transcriptBounds.y + 20)
    await page.mouse.wheel(0, 2000)
    await expect(page).toHaveURL(
      /#\/watch\/jNQXAC9IVRw\?short=true&shortSource=subscriptions/
    )

    await page.waitForTimeout(500)
    await page.evaluate(() => window.scrollTo({
      top: document.documentElement.scrollHeight
    }))
    await expect(page).toHaveURL(
      /#\/watch\/captioned-short-2\?short=true&shortSource=subscriptions/
    )
    await expect(auxPanel).toHaveClass(/shortsAuxPanelOpen/)
    await expect(transcriptButton).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(async () => {
      const [cardHeight, targetHeight] = await Promise.all([
        transcriptCard.evaluate(element => element.offsetHeight),
        transcriptTarget.evaluate(element => element.clientHeight),
      ])
      return Math.abs(cardHeight - targetHeight)
    }).toBeLessThanOrEqual(32)

    await page.waitForTimeout(500)
    await previous.click()
    await expect(page).toHaveURL(
      /#\/watch\/jNQXAC9IVRw\?short=true&shortSource=subscriptions/
    )
    await auxPanel.getByRole('button', { name: 'Close transcript' }).click()

    const [playerBounds, videoAreaBounds, metadataBounds, actionBounds, previewBounds, navigationBounds] =
      await Promise.all([
        player.boundingBox(),
        page.locator('.videoArea').boundingBox(),
        page.locator('.shortsExternalMetadata').boundingBox(),
        page.locator('.shortsActionRail').boundingBox(),
        page.locator('.shortsNextPreview').boundingBox(),
        page.locator('.shortsNavigation').boundingBox(),
      ])
    expect(metadataBounds.x + metadataBounds.width).toBeLessThanOrEqual(playerBounds.x)
    expect(actionBounds.x).toBeGreaterThanOrEqual(playerBounds.x + playerBounds.width)
    expect(previewBounds.y).toBeGreaterThanOrEqual(playerBounds.y + playerBounds.height)
    expect(previewBounds.width).toBeCloseTo(playerBounds.width, 0)
    expect(playerBounds.x + playerBounds.width / 2)
      .toBeCloseTo(videoAreaBounds.x + videoAreaBounds.width / 2, 0)
    expect(navigationBounds.x).toBeGreaterThan(actionBounds.x)

    // Narrow layouts move the rail over the player and grow it upwards, so the
    // navigation joins the same column above the actions instead of landing on
    // top of them.
    await page.setViewportSize({ width: 900, height: 700 })
    await expect(page.locator('.shortsExternalChannel')).toHaveCSS('opacity', '1')
    expect(await page.locator('.shortsExternalChannel').evaluate(element => {
      return getComputedStyle(element).color === getComputedStyle(document.body).color
    })).toBe(true)
    await expect.poll(async () => {
      const [rail, navigation, firstAction] = await Promise.all([
        page.locator('.shortsActionRail').boundingBox(),
        page.locator('.shortsNavigation').boundingBox(),
        page.locator('.shortsAction').first().boundingBox()
      ])

      return {
        navigationAboveActions: navigation.y + navigation.height <= firstAction.y,
        centeredInRail: Math.abs(
          (navigation.x + navigation.width / 2) - (rail.x + rail.width / 2)
        ) <= 1,
        insideRail: navigation.x >= rail.x && navigation.x + navigation.width <= rail.x + rail.width
      }
    }).toEqual({ navigationAboveActions: true, centeredInRail: true, insideRail: true })

    await page.setViewportSize({ width: 1280, height: 900 })
    await expect.poll(async () => {
      const [rail, navigation] = await Promise.all([
        page.locator('.shortsActionRail').boundingBox(),
        page.locator('.shortsNavigation').boundingBox()
      ])

      return navigation.x > rail.x + rail.width
    }).toBe(true)

    await page.evaluate(() => {
      window.__shortsNavigationDisappeared = false
      const observer = new MutationObserver(() => {
        if (!document.querySelector('.shortsNavigation')) {
          window.__shortsNavigationDisappeared = true
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })
    })

    await next.click()
    await expect(page.locator('.videoPlayerPlaceholder.ft-shimmer')).toHaveCount(0)
    await expect(page).toHaveURL(
      /#\/watch\/captioned-short-2\?short=true&shortSource=subscriptions/
    )
    expect(await page.evaluate(() => window.__shortsNavigationDisappeared)).toBe(false)

    await page.waitForTimeout(500)
    await page.keyboard.press('ArrowUp')
    await expect(page).toHaveURL(
      /#\/watch\/jNQXAC9IVRw\?short=true&shortSource=subscriptions/
    )

    await page.waitForTimeout(500)
    // Browser middle-button autoscroll moves the window instead of emitting a
    // wheel event, so window scrolling must navigate Shorts too.
    await page.evaluate(() => window.scrollTo({
      top: document.documentElement.scrollHeight
    }))
    await expect(page).toHaveURL(
      /#\/watch\/captioned-short-2\?short=true&shortSource=subscriptions/
    )

    await page.waitForTimeout(500)
    await page.keyboard.press('ArrowUp')
    await expect(page).toHaveURL(
      /#\/watch\/jNQXAC9IVRw\?short=true&shortSource=subscriptions/
    )

    await page.waitForTimeout(500)
    const scrollbarHandle = page.locator(
      'body > .os-scrollbar-vertical .os-scrollbar-handle'
    )
    const handleBounds = await scrollbarHandle.boundingBox()
    await page.mouse.move(
      handleBounds.x + handleBounds.width / 2,
      handleBounds.y + handleBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(
      handleBounds.x + handleBounds.width / 2,
      handleBounds.y + handleBounds.height / 2 + 50
    )
    await page.mouse.up()
    await expect(page).toHaveURL(
      /#\/watch\/captioned-short-2\?short=true&shortSource=subscriptions/
    )
  })

  test('does not show a stale loading indicator after leaving a loaded Shorts tab', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.route('**/api/skipSegments**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.locator(sel.newTabButton).click()
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    const shortTab = page.locator(sel.tabs).first()
    await shortTab.click()

    const shortsFeedTab = page
      .locator('.tabContent[aria-hidden="false"]')
      .locator('[data-subscription-feed-tab="shorts"]')
    await shortsFeedTab.click()
    await page.getByText('First seeded Short', { exact: true }).click()
    await expect(page).toHaveURL(
      /#\/watch\/jNQXAC9IVRw\?short=true&shortSource=subscriptions/
    )

    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    await expect(player).toBeVisible({ timeout: 30_000 })

    await expect(shortTab).not.toHaveClass(/loading/)
    await shortTab.evaluate((tab) => {
      window.__shortTabShowedLoadingWhileScrolling = false
      new MutationObserver(() => {
        if (tab.classList.contains('loading')) {
          window.__shortTabShowedLoadingWhileScrolling = true
        }
      }).observe(tab, { attributes: true, attributeFilter: ['class'] })
    })
    await page.evaluate(() => window.scrollTo({
      top: document.documentElement.scrollHeight
    }))
    await expect(page).toHaveURL(
      /#\/watch\/captioned-short-2\?short=true&shortSource=subscriptions/
    )
    await expect.poll(() => page.evaluate(
      () => window.__shortTabShowedLoadingWhileScrolling
    )).toBe(true)
    await expect(
      page.locator('.tabContent[aria-hidden="false"] [data-tab-loading-indicator]')
    ).toHaveCount(0)
    await expect(player).toBeVisible({ timeout: 30_000 })
    const video = await waitForPlayback(page)
    await video.evaluate(element => element.pause())

    await expect(shortTab).not.toHaveClass(/loading/)
    await shortTab.evaluate((tab) => {
      window.__shortTabShowedLoadingAfterDeactivation = false
      window.__shortTabLoadingTransitions = []
      new MutationObserver(() => {
        window.__shortTabLoadingTransitions.push({
          loading: tab.classList.contains('loading'),
          markers: [...document.querySelectorAll(
            `[data-tab-id="${tab.dataset.tabId}"] [data-tab-loading-indicator]`
          )].map(element => element.className),
        })
        if (tab.classList.contains('loading')) {
          window.__shortTabShowedLoadingAfterDeactivation = true
        }
      }).observe(tab, { attributes: true, attributeFilter: ['class'] })
    })

    await app.electronApp.evaluate(({ BrowserWindow, Menu }) => {
      const findMenuItem = (items, label) => {
        for (const item of items) {
          if (item.label === label) return item
          const match = findMenuItem(item.submenu?.items ?? [], label)
          if (match) return match
        }
        return null
      }
      const menuItem = findMenuItem(Menu.getApplicationMenu()?.items ?? [], 'Next Tab')
      const browserWindow = BrowserWindow.getFocusedWindow()
      if (!menuItem || !browserWindow) {
        throw new Error('Next Tab application-menu item was not found')
      }
      menuItem.click(undefined, browserWindow, undefined)
    })
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    await page.waitForTimeout(5000)
    const loadingResult = await page.evaluate(() => ({
      showed: window.__shortTabShowedLoadingAfterDeactivation,
      transitions: window.__shortTabLoadingTransitions,
    }))
    expect(loadingResult.showed, JSON.stringify(loadingResult.transitions)).toBe(false)
    await expect(shortTab).not.toHaveClass(/loading/)

    await shortTab.click()
    await expect(page).toHaveURL(
      /#\/watch\/captioned-short-2\?short=true&shortSource=subscriptions/
    )
    await expect(shortTab).not.toHaveClass(/loading/)
    await expect(player).toBeVisible()
    await expect(
      page.locator('.tabContent[aria-hidden="false"] [data-tab-loading-indicator]')
    ).toHaveCount(0)
  })
})
