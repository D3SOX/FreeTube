import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { normalizeCustomTheme } from '../../src/customTheme.js'
import { PREVIEW_VIEWS } from '../../_scripts/themePreview.mjs'
import { test, expect, goTo, sel } from '../helpers/app.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../helpers/watch.mjs'
import { routeDemoMedia } from '../helpers/media.mjs'
import { fulfillVisualFixture } from '../helpers/visual-fixtures.mjs'
import { captureAppScreenshot, copyScreenshots, openScreenshotSettings, sizeScreenshotWindow } from '../helpers/screenshots.mjs'

const directory = process.env.THEME_PREVIEW_DIR
if (!directory) throw new Error('Set THEME_PREVIEW_DIR to a directory containing theme.json')
const theme = normalizeCustomTheme(JSON.parse(await readFile(path.join(directory, 'theme.json'), 'utf8')))
const now = Date.now()
const avatar = `data:image/svg+xml;base64,${(await readFile(new URL('../fixtures/media/avatar.svg', import.meta.url))).toString('base64')}`
const thumbnail = (await readFile(new URL('../fixtures/media/video-thumbnail.svg', import.meta.url), 'utf8'))
  .replace('OpenTubeX E2E', 'Sample video')
const media = await readFile(new URL('../fixtures/media/theme-preview.webm', import.meta.url))
const channel = { id: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'Sample channel', thumbnail: avatar }
const videos = Array.from({ length: 12 }, (_, index) => ({
  videoId: `video${String(index).padStart(6, '0')}`,
  title: ['Exploring the mountains', 'A walk by the ocean', 'An afternoon in the forest'][index % 3],
  author: channel.name,
  authorId: channel.id,
  published: now - index * 3600000,
  viewCount: 1234,
  lengthSeconds: 600,
  liveNow: false,
  isUpcoming: false,
  type: 'video',
}))

test.use({
  launchArgs: ['--lang=en-US'],
  showTutorial: true,
  seed: {
    freshProfile: true,
  },
})

test.afterEach(async ({ page }) => {
  // Preserve the default confirmation settings until all captures are done.
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateConfirmCloseApp', false)
    await store.dispatch('updateConfirmCloseWindowWithMultipleTabs', false)
  })
})

test('captures the submitted theme in three views with sample content', async ({ app, page }, testInfo) => {
  const tutorial = page.locator('.tutorialOverlay')
  await tutorial.getByRole('button', { name: 'Skip', exact: true }).click()
  await expect(tutorial).toBeHidden()

  await mockPlayableWatchPage(app, page)
  await page.route(url => ['ytimg.com', 'ggpht.com', 'googleusercontent.com']
    .some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`)), route =>
    /(^|\.)ytimg\.com$/.test(new URL(route.request().url()).hostname)
      ? route.fulfill({ body: thumbnail, contentType: 'image/svg+xml' })
      : fulfillVisualFixture(route, 'avatar'))
  await routeDemoMedia(page, media)
  await sizeScreenshotWindow(app)
  await page.evaluate(async theme => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const themes = await window.ftElectron.saveCustomTheme(theme)
    store.commit('setCustomThemes', themes)
    await store.dispatch('updateBaseTheme', `custom:${theme.id}`)
  }, theme)
  await expect(page.locator('body')).toHaveClass(/\bcustom\b/)
  await expect.poll(() => page.locator('body').evaluate(body => body.style.getPropertyValue('--bg-color')))
    .toBe(theme.colors.background)
  await expect(page.locator('.profileTrigger')).toHaveCSS('background-color',
    await page.locator('body').evaluate(body => {
      const probe = document.createElement('span')
      probe.style.backgroundColor = 'var(--primary-color)'
      body.append(probe)
      const color = getComputedStyle(probe).backgroundColor
      probe.remove()
      return color
    }))

  async function capture(view) {
    await captureAppScreenshot(page, view, testInfo.outputPath(`${view}.png`))
  }

  // Like the README captures, photograph Settings before configuring content.
  const settings = await openScreenshotSettings(page)
  await expect(settings.locator('.changedSettingIndicator')).toHaveCount(0)
  await capture('settings')
  await settings.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(settings).toBeHidden()

  await page.evaluate(async ({ channel, videos, now }) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateFetchSubscriptionsAutomatically', false)
    await store.dispatch('addChannelToProfiles', { channel, profileIds: [store.getters.getActiveProfile._id] })
    await store.dispatch('updateSubscriptionVideosCacheByChannel', {
      channelId: channel.id, videos, timestamp: new Date(now),
    })
  }, { channel, videos, now })
  await goTo(page, 'history')
  await goTo(page, 'subscriptions')
  await expect(page.locator('.ft-list-video').nth(11)).toBeVisible()
  await capture('subscriptions')

  await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.locator('.videoTitle')).toContainText('Me at the zoo')
  const video = page.locator('.ftVideoPlayer video')
  await expect.poll(() => video.evaluate(element => element.readyState >= 2)).toBe(true)
  await expect.poll(() => video.evaluate(element => element.duration)).toBeGreaterThanOrEqual(30)
  await expect.poll(() => video.evaluate(element => Number.isFinite(element.duration))).toBe(true)
  await video.evaluate(element => {
    element.pause()
  })
  await expect.poll(() => video.evaluate(element => ({
    paused: element.paused, seeking: element.seeking, ready: element.readyState >= 2,
  }))).toEqual({ paused: true, seeking: false, ready: true })
  const watch = await watchViewHandle(page)
  await watch.evaluate(async (view, { videos, avatar }) => {
    view.videoTitle = 'Sample video'
    view.updateTitle()
    view.videoDescription = 'Sample content for the automatic theme preview.'
    view.videoDescriptionHtml = ''
    view.videoViewCount = 1234
    view.videoLikeCount = 42
    view.channelName = 'Sample channel'
    view.channelThumbnail = avatar
    view.channelSubscriptionCountText = '1.2K'
    view.recommendedVideos = videos
    // The description parses its input when mounted.
    view.$store.commit('setHideVideoDescription', true)
    await view.$nextTick()
    view.$store.commit('setHideVideoDescription', false)
    await view.$nextTick()
  }, { videos, avatar })
  await watch.dispose()
  await expect(page.locator('.videoTitle')).toHaveText('Sample video')
  await expect(page.locator('.description')).toContainText('Sample content for the automatic theme preview.')
  await expect(page.locator('.errorMessage:visible')).toHaveCount(0)
  await page.locator(sel.searchInput).fill('')
  await capture('watch')

  // Only publish a complete set. Failed captures stay in Playwright's results.
  await copyScreenshots(testInfo, PREVIEW_VIEWS.map(view => `${view}.png`), directory)
})
