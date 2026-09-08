import { test, expect, goTo, setPlayerFullscreen } from '../../helpers/app.mjs'
import { sampleColors } from '../../helpers/colors.mjs'
import { openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

async function expectContinuousBackground(app, region, points) {
  const colors = await sampleColors(app, region, points)
  const difference = Math.max(...colors.slice(1).flatMap(color =>
    color.map((value, index) => Math.abs(value - colors[0][index]))))
  expect.soft(difference, `background pixels: ${JSON.stringify(colors)}`).toBeLessThanOrEqual(2)
}

async function expectDescriptionBackground(app, region, points) {
  await app.page.mouse.move(0, 0)
  // Compare identical viewport positions so the theme's natural color change
  // across the fade isn't mistaken for a seam. Retry while scrolling or a
  // transient player overlay still affects the captured framebuffer.
  await expect.poll(async () => {
    const actual = await sampleColors(app, region, points)
    const style = await app.page.addStyleTag({
      content: `
        .videoDescription .descriptionStatus,
        .videoDescription .descriptionStatus::before { background: transparent !important; }
      `
    })
    try {
      const reference = await sampleColors(app, region, points)
      return Math.max(...actual.flatMap((color, point) =>
        color.map((value, channel) => Math.abs(value - reference[point][channel]))))
    } finally {
      await style.evaluate(element => element.remove())
    }
  }, { message: 'Description overlay must match the card at the same pixels' }).toBeLessThanOrEqual(2)
}

async function attachThemeScreenshot(app, testInfo, name) {
  await app.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const base64 = await app.electronApp.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
  await testInfo.attach(name, { body: Buffer.from(base64, 'base64'), contentType: 'image/png' })
}

async function expectPanelOwnsBackground(app, card, points) {
  // Compare identical pixels before and after removing the nested background
  // so the panel gradient or video behind it cannot be mistaken for a seam.
  const actual = await sampleColors(app, card, points)
  const originalStyle = await card.getAttribute('style')
  await card.evaluate(element => {
    element.style.setProperty('background', 'transparent', 'important')
    element.style.setProperty('backdrop-filter', 'none', 'important')
  })
  try {
    const reference = await sampleColors(app, card, points)
    const difference = Math.max(...actual.flatMap((color, point) =>
      color.map((value, channel) => Math.abs(value - reference[point][channel]))))
    expect.soft(difference, `Panel card pixels: ${JSON.stringify({ actual, reference })}`).toBeLessThanOrEqual(2)
  } finally {
    await card.evaluate((element, style) => {
      if (style === null) element.removeAttribute('style')
      else element.setAttribute('style', style)
    }, originalStyle)
  }
}

for (const theme of ['openTubeXLight', 'openTubeXDark']) {
  for (const scale of [100, 125]) {
    test.describe(`${theme} continuous backgrounds at ${scale}%`, () => {
      test.use({
        seed: {
          settings: {
            baseTheme: theme,
            uiScale: scale,
            currentLocale: 'en-US',
            fetchSubscriptionsAutomatically: false,
            showNewSubscriptionFeed: true,
            scrollMiniPlayerEnabled: false,
            videoPlaybackEngine: 'built-in',
            ytDlpPlaybackEngineDefaultMigration: true
          }
        }
      })

      test('subscription category tabs blend into their card', async ({ app, page }, testInfo) => {
        await goTo(page, 'subscriptions')
        await page.locator('[data-subscription-feed-tab="all"]').click()
        await page.getByRole('button', { name: 'Show tabbed view' }).click()
        const header = page.locator('.subscriptionsHeader')
        await expect(header.locator('.newFeedTabs')).toBeVisible()
        const height = await header.evaluate(element => element.getBoundingClientRect().height)
        // Sample the empty gutter on both sides of the header's bottom edge.
        await expectContinuousBackground(app, header, [[5, height - 4], [5, height + 4]])
        await attachThemeScreenshot(app, testInfo, `${theme} subscription header at ${scale}%`)
      })

      test('description controls and fades blend into their card', async ({ app, page }, testInfo) => {
        await mockPlayableWatchPage(app, page)
        await openMockedVideo(page)
        const view = await watchViewHandle(page)
        await view.evaluate(async component => {
          component.isLoading = true
          await component.$nextTick()
          component.videoDescription = Array(30).fill('A short description line.').join('\n')
          component.videoDescriptionHtml = ''
          component.videoTags = []
          component.isLoading = false
          await component.$nextTick()
        })
        // Remounting updates the description's initial state and restarts the
        // player. Let its startup scroll finish before sampling the card.
        await waitForPlayback(page)
        await page.locator('.ftVideoPlayer video').evaluate(video => video.pause())
        const card = page.locator('.videoDescription')
        await expect(card.locator('.description')).toContainText('A short description line.')
        const expand = card.locator(':scope > .descriptionStatus')
        for (const direction of ['ltr', 'rtl']) {
          await card.evaluate((element, direction) => { element.dir = direction }, direction)
          const width = await expand.evaluate(element => element.getBoundingClientRect().width)
          // The fixture text leaves the fade and control padding clear.
          const points = direction === 'ltr'
            ? [[-36, 1], [-10, 1], [width / 2, 1], [width + 5, 1]]
            : [[-5, 1], [width / 2, 1], [width + 10, 1], [width + 36, 1]]
          await expectDescriptionBackground(app, expand, points)
        }
        await card.evaluate(element => { element.dir = 'ltr' })
        await expand.click()
        const footer = card.locator('.descriptionStatus')
        await footer.scrollIntoViewIfNeeded()
        const { width, height } = await footer.evaluate(element => {
          const { width, height } = element.getBoundingClientRect()
          return { width, height }
        })
        // Empty space next to Show less, through its fade and into card padding.
        await expectDescriptionBackground(app, footer, [
          [width - 60, -26], [width - 60, -12], [width - 60, height / 2], [width - 60, height + 5]
        ])
        await attachThemeScreenshot(app, testInfo, `${theme} description footer at ${scale}%`)
      })

      test('Shorts video information blends into its panel', async ({ app, page }, testInfo) => {
        await mockPlayableWatchPage(app, page, { captionCueSettings: 'align:center' })
        await openMockedVideo(page)
        const view = await watchViewHandle(page)
        await view.evaluate(async component => {
          component.isLoading = true
          await component.$nextTick()
          component.isShort = true
          component.videoDescription = 'A short description.'
          component.videoDescriptionHtml = ''
          component.videoTags = ['shorts', 'theme']
          component.shortsMetadataOpen = true
          component.isLoading = false
          await component.$nextTick()
        })
        await waitForPlayback(page)
        await page.locator('.ftVideoPlayer video').evaluate(video => video.pause())
        const panel = page.locator('.shortsAuxPanel')
        await expect(panel).toHaveClass(/shortsAuxPanelOpen/)
        await page.mouse.move(0, 0)
        for (const selector of ['.watchVideoInfo', '.videoDescription']) {
          const card = panel.locator(selector)
          await expect(card).toBeVisible()
          const height = await card.evaluate(element => element.getBoundingClientRect().height)
          // Compare the empty gutter immediately across each section boundary,
          // skipping the header's intentional one-pixel separator.
          await expectContinuousBackground(app, card, [[5, -4], [5, 4]])
          await expectContinuousBackground(app, card, [[5, height - 4], [5, height + 4]])
        }
        await attachThemeScreenshot(app, testInfo, `${theme} Shorts information at ${scale}%`)

        await setPlayerFullscreen(page, true)
        const fullscreenPanel = page.locator('.fullscreenMetadataOverlay.open')
        await expect(fullscreenPanel).toBeVisible()
        for (const selector of ['.watchVideoInfo', '.videoDescription']) {
          await expectPanelOwnsBackground(app, fullscreenPanel.locator(selector), [[5, 4], [5, 40]])
        }
        await attachThemeScreenshot(app, testInfo, `${theme} fullscreen information at ${scale}%`)

        await view.evaluate(component => component.toggleTranscript())
        const transcript = page.locator('.fullscreenTranscriptOverlay.open .watchVideoTranscript')
        await expect(transcript).toBeVisible()
        await expectPanelOwnsBackground(app, transcript, [[5, 80], [5, 160]])
        await setPlayerFullscreen(page, false)
        const shortsTranscript = panel.locator('.watchVideoTranscript')
        await expect(shortsTranscript).toBeVisible()
        await expectPanelOwnsBackground(app, shortsTranscript, [[5, 80], [5, 160]])
      })

      test('Shorts comments blend into their panel and fullscreen overlay', async ({ app, page }) => {
        await mockPlayableWatchPage(app, page)
        await openMockedVideo(page)
        const view = await watchViewHandle(page)
        await view.evaluate(async component => {
          component.isShort = true
          await component.$nextTick()
          component.toggleShortsComments()
        })
        await page.locator('.ftVideoPlayer video').evaluate(video => video.pause())
        const comments = page.locator('.shortsCommentsPanel .fullscreenCommentCard')
        await expect(comments).toBeVisible()
        await expectPanelOwnsBackground(app, comments, [[5, 80], [5, 160]])
        await setPlayerFullscreen(page, true)
        await page.locator('.fullscreenCommentsToggle').click({ force: true })
        const fullscreenComments = page.locator('.fullscreenCommentsOverlay.open .fullscreenCommentCard')
        await expect(fullscreenComments).toBeVisible()
        await expectPanelOwnsBackground(app, fullscreenComments, [[5, 80], [5, 160]])
      })

      test('other feed headers and channel panels blend into their cards', async ({ app, page }, testInfo) => {
        await page.evaluate(async () => {
          const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
          await store.dispatch('updateBackendPreference', 'invidious')
          await store.dispatch('updateDefaultInvidiousInstance', 'https://invidious.test')
        })
        await page.route('https://invidious.test/api/v1/popular/**', route => route.fulfill({ json: [] }))
        await page.route('https://invidious.test/api/v1/trending/**', route => route.fulfill({ json: [] }))
        for (const route of ['popular', 'trending']) {
          const tab = await page.evaluate(route => window.ftElectron.tabs.create({
            route: `/${route}`, makeActive: false
          }), route)
          await page.locator(`.tab[data-tab-id="${tab.id}"]`).click()
          const header = page.locator(`.${route}Page .pageHeader`)
          const height = await header.evaluate(element => element.getBoundingClientRect().height)
          // Skip the intentional one-pixel separator.
          await expectContinuousBackground(app, header, [[5, height - 4], [5, height + 4]])
        }

        const channelId = 'UCaaaaaaaaaaaaaaaaaaaaaa'
        await page.route('https://invidious.test/api/v1/channels/**', route => route.fulfill({
          json: {
            author: 'Theme test channel',
            authorId: channelId,
            authorThumbnails: [],
            authorBanners: [],
            isFamilyFriendly: true,
            subCount: 100,
            description: 'A channel description.',
            totalViews: 1000,
            joined: 1000000000,
            relatedChannels: [],
            tabs: ['about']
          }
        }))
        const tab = await page.evaluate(id => window.ftElectron.tabs.create({
          route: `/channel/${id}/about`, makeActive: false
        }), channelId)
        await page.locator(`.tab[data-tab-id="${tab.id}"]`).click()
        const info = page.locator('.channelDetails .infoContainer')
        await expect(page.locator('#aboutPanel')).toBeVisible()
        const infoWidth = await info.evaluate(element => element.getBoundingClientRect().width)
        await expectContinuousBackground(app, info, [[infoWidth - 60, -4], [infoWidth - 60, 4]])
        const about = page.locator('#aboutPanel')
        const aboutWidth = await about.evaluate(element => element.getBoundingClientRect().width)
        await expectContinuousBackground(app, about, [[aboutWidth - 5, 40], [aboutWidth + 5, 40]])
        await attachThemeScreenshot(app, testInfo, `${theme} channel panels at ${scale}%`)
      })
    })
  }
}
