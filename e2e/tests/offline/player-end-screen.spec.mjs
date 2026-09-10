import { fileURLToPath } from 'node:url'
import { test, expect, setWindowSize, setPlayerFullscreen } from '../../helpers/app.mjs'
import { findWatchComponent, openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
      playNextVideo: false,
      hideRecommendedVideos: true,
      hideEndScreenAnnotations: false,
    }
  }
})

async function endVideo(video) {
  await video.evaluate(element => {
    element.currentTime = element.duration - 0.1
    return element.play()
  })
  await expect.poll(() => video.evaluate(element => element.ended)).toBe(true)
}

async function openVideo({ app, page }) {
  await mockPlayableWatchPage(app, page)
  await page.route('https://i.ytimg.com/**', route => route.fulfill({
    path: fileURLToPath(new URL('../../fixtures/media/video-thumbnail.svg', import.meta.url)),
    contentType: 'image/svg+xml'
  }))
  const video = await openMockedVideo(page)
  const watch = await page.evaluateHandle(findWatchComponent)
  await watch.evaluate(component => {
    component.proxy.videoAnnotations = [{
      id: 'end-video',
      type: 'VIDEO',
      title: 'Annotated video',
      startTime: 0,
      endTime: 1000,
      left: 0.6,
      top: 0.2,
      width: 0.3,
      aspectRatio: 16 / 9,
      route: '/watch/aqz-KE-bpKQ',
      thumbnail: component.proxy.thumbnail,
    }]
  })
  return { video, watch }
}

test('restores the poster and hides annotations at the end, then clears it on seek and replay', async ({ app, page }) => {
  const { video } = await openVideo({ app, page })
  await expect(page.locator('.videoAnnotations')).toBeVisible()
  await endVideo(video)
  const poster = page.locator('.endedPoster')
  await expect(poster).toBeVisible()
  await expect(poster.locator('img')).toHaveCSS('opacity', '0.35')
  await expect.poll(() => poster.locator('img').evaluate(image => image.naturalWidth)).toBeGreaterThan(0)
  await expect(page.locator('.videoAnnotations')).toHaveCount(0)
  await expect(page.locator('.endedRecommendations')).toHaveCount(0)
  await video.evaluate(element => { element.currentTime = 1 })
  await expect(poster).toHaveCount(0)
  await expect(page.locator('.videoAnnotations')).toBeVisible()
  await endVideo(video)
  await expect(poster).toBeVisible()
  await page.locator('.shaka-controls-button-panel .shaka-play-button').click()
  await expect(poster).toHaveCount(0)
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)
})

test('shows recommended thumbnails over a darkened poster with working keyboard navigation', async ({ app, page, attachScreenshot }) => {
  const { video, watch } = await openVideo({ app, page })
  await watch.evaluate(async component => {
    await component.proxy.$store.dispatch('updateHideRecommendedVideos', false)
    component.proxy.recommendedVideos = Array.from({ length: 8 }, (_, index) => ({
      videoId: `video00000${index}`,
      title: `Recommended video ${index + 1}`,
      author: 'Example channel',
      authorId: 'example-channel',
      type: 'video',
      lengthSeconds: 120,
    }))
  })
  const titleStyle = element => {
    const style = getComputedStyle(element)
    return Object.fromEntries([
      'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
      'backgroundImage', 'fontSize', 'fontWeight', 'lineHeight', 'textShadow'
    ].map(property => [property, /^[\d.]+px$/.test(style[property])
      ? Math.round(parseFloat(style[property]) * 10) / 10
      : style[property]]))
  }
  const annotationTitleStyle = await page.locator('.annotationTitle').evaluate(titleStyle)
  await endVideo(video)
  const cards = page.locator('.endedRecommendation')
  await expect(cards).toHaveCount(6)
  await expect.poll(() => cards.first().locator('.endedRecommendationTitle').evaluate(titleStyle)).toEqual(annotationTitleStyle)
  await expect(cards.first().locator('.endedRecommendationTitleText')).toBeVisible()
  await expect(cards.first().locator('.endedRecommendationTitleText')).toHaveText('Recommended video 1')
  await expect(page.locator('.endedPoster img')).toHaveCSS('opacity', '0.35')
  await expect(cards.first()).toHaveAttribute('href', '#/watch/video000000')
  await expect(cards.first().locator('img')).toHaveAttribute('src', /\/vi\/video000000\/mqdefault.jpg$/)
  await expect.poll(() => cards.first().locator('img').evaluate(image => image.naturalWidth)).toBeGreaterThan(0)
  await cards.first().click({ trial: true })
  await attachScreenshot('video ended with recommendations')
  await setPlayerFullscreen(page, true)
  await expect(cards.first()).toBeVisible()
  await cards.first().click({ trial: true })
  await setPlayerFullscreen(page, false)
  await page.evaluate(() => window.ftElectron.setZoomFactor(0.95))
  await setWindowSize(app, page, { width: 480, height: 800 })
  const grid = page.locator('.endedRecommendations')
  await expect.poll(() => grid.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true)
  await expect(cards.first()).toBeVisible()
  await expect(cards.nth(4)).toBeHidden()
  await expect(cards.first().locator('.endedRecommendationTitleText')).toBeVisible()
  await attachScreenshot('video ended in a narrow player')
  await watch.evaluate(component => component.proxy.$store.dispatch('updateBlurThumbnails', true))
  await expect(cards.first().locator('img')).toHaveCSS('filter', 'blur(20px)')
  await expect(cards.first().locator('.endedRecommendationTitle')).toHaveCSS('filter', 'none')
  await watch.evaluate(component => component.proxy.$store.dispatch('updateBlurThumbnails', false))
  await expect(cards.first().locator('img')).toHaveCSS('filter', 'none')
  await watch.evaluate(async component => {
    await component.proxy.$store.dispatch('updateThumbnailPreference', 'hidden')
  })
  await expect(cards.first().locator('img')).toHaveAttribute('src', /thumbnail_placeholder/)
  await watch.evaluate(async component => {
    await component.proxy.$store.dispatch('updateHideRecommendedVideos', true)
  })
  await expect(grid).toHaveCount(0)
  await expect(page.locator('.endedPoster img')).toHaveCSS('opacity', '0.35')
  await watch.evaluate(async component => {
    await component.proxy.$store.dispatch('updateHideRecommendedVideos', false)
  })
  await cards.first().focus()
  await cards.first().press('Enter')
  await expect(page).toHaveURL(/#\/watch\/video000000$/)
  await expect(page.locator('.endedPoster')).toHaveCount(0)
  await waitForPlayback(page)
})

test('keeps the autoplay countdown instead of the finished poster when autoplay is enabled', async ({ app, page }) => {
  const { video, watch } = await openVideo({ app, page })
  await watch.evaluate(async component => {
    await component.proxy.$store.dispatch('updateHideRecommendedVideos', false)
    component.proxy.autoplayNextRecommendedVideo = true
    component.proxy.recommendedVideos = [{ videoId: 'video000000', title: 'Next video', type: 'video' }]
  })
  await endVideo(video)
  await expect(page.locator('.autoplayCountdownOverlay')).toBeVisible()
  await expect(page.locator('.endedPoster')).toHaveCount(0)
  await expect(page.locator('.endedRecommendations')).toHaveCount(0)
})

test('filters hidden and current videos and keeps the poster darkened when none remain', async ({ app, page }) => {
  const { video, watch } = await openVideo({ app, page })
  await watch.evaluate(async component => {
    await component.proxy.$store.dispatch('updateHideRecommendedVideos', false)
    await component.proxy.$store.dispatch('updateForbiddenTitles', JSON.stringify(['blocked']))
    await component.proxy.$store.dispatch('updateChannelsHidden', JSON.stringify([{ name: 'hidden-channel' }]))
    component.proxy.recommendedVideos = [
      { videoId: component.proxy.videoId, title: 'Current video' },
      { videoId: 'video000001', title: 'Blocked title' },
      { videoId: 'video000002', title: 'Hidden channel video', authorId: 'hidden-channel' },
      { videoId: 'video000003', title: 'Visible video' },
    ]
  })
  await endVideo(video)
  await expect(page.locator('.endedRecommendation')).toHaveCount(1)
  await expect(page.locator('.endedRecommendation')).toHaveAttribute('aria-label', 'Visible video')
  await watch.evaluate(component => { component.proxy.recommendedVideos = [] })
  await expect(page.locator('.endedRecommendations')).toHaveCount(0)
  await expect(page.locator('.endedPoster')).toBeVisible()
  await expect(page.locator('.endedPoster img')).toHaveCSS('opacity', '0.35')
})

test('uses original recommendation titles only for the entire-app preference and handles late replies', async ({ app, page }) => {
  const { video, watch } = await openVideo({ app, page })
  const requests = []
  let releaseTitle
  const titleReady = new Promise(resolve => { releaseTitle = resolve })
  await page.route('https://www.youtube.com/oembed**', async route => {
    requests.push(route.request().url())
    await titleReady
    if (route.request().url().includes('video000010')) {
      await route.fulfill({ status: 404, json: {} })
      return
    }
    const title = route.request().url().includes('video000009') ? 'Another original title' : 'Original recommendation title'
    await route.fulfill({ json: { title } })
  })
  await watch.evaluate(async component => {
    await component.proxy.$store.dispatch('updateHideRecommendedVideos', false)
    component.proxy.recommendedVideos = [{ videoId: 'video000008', title: 'Translated recommendation title', type: 'video' }]
  })
  await endVideo(video)
  const card = page.locator('.endedRecommendation')
  await expect(card).toHaveAttribute('title', 'Translated recommendation title')
  await watch.evaluate(component => component.proxy.$store.dispatch('updateAvoidTranslation', 'watch_only'))
  await expect(card).toHaveAttribute('title', 'Translated recommendation title')
  expect(requests).toHaveLength(0)
  await watch.evaluate(component => component.proxy.$store.dispatch('updateAvoidTranslation', 'entire_app'))
  await expect.poll(() => requests.length).toBe(1)
  await watch.evaluate(component => component.proxy.$store.dispatch('updateAvoidTranslation', 'disabled'))
  const originalResponse = page.waitForResponse('https://www.youtube.com/oembed**')
  releaseTitle()
  await (await originalResponse).finished()
  await expect(card).toHaveAttribute('title', 'Translated recommendation title')
  await watch.evaluate(component => component.proxy.$store.dispatch('updateAvoidTranslation', 'entire_app'))
  await expect(card).toHaveAttribute('title', 'Original recommendation title')
  await expect(card).toHaveAttribute('aria-label', 'Original recommendation title')
  await expect(card.locator('.endedRecommendationTitleText')).toHaveText('Original recommendation title')
  expect(requests).toHaveLength(1)
  await watch.evaluate(component => {
    component.proxy.recommendedVideos = [{ videoId: 'video000009', title: 'Another translated title', type: 'video' }]
  })
  await expect.poll(() => requests.length).toBe(2)
  await expect(card).toHaveAttribute('title', 'Another original title')
  // A failed title can be requested by both sidebar and end-screen cards.
  const missingTitleResponse = page.waitForResponse('https://www.youtube.com/oembed**video000010**')
  await watch.evaluate(component => {
    component.proxy.recommendedVideos = [{ videoId: 'video000010', title: 'Fallback title', type: 'video' }]
  })
  await (await missingTitleResponse).finished()
  await expect(card).toHaveAttribute('title', 'Fallback title')
})

test('hides the VR canvas behind the finished poster and restores it after seeking', async ({ app, page }) => {
  const { video, watch } = await openVideo({ app, page })
  await watch.evaluate(component => { component.proxy.vrProjection = 'EQUIRECTANGULAR' })
  const canvas = page.locator('.vrCanvas')
  await expect(canvas).toBeVisible()
  await canvas.evaluate(element => {
    const context = element.getContext('2d')
    context.fillStyle = 'red'
    context.fillRect(0, 0, element.width, element.height)
  })
  await endVideo(video)
  await expect(page.locator('.endedPoster')).toBeVisible()
  await expect(canvas).toBeHidden()
  await video.evaluate(element => { element.currentTime = 1 })
  await expect(page.locator('.endedPoster')).toHaveCount(0)
  await expect(canvas).toBeVisible()
})
