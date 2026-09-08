import { test, expect, goTo, goToSettingsSection } from '../../helpers/app.mjs'

const now = Date.now()
const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'

const videos = Array.from({ length: 80 }, (_, index) => ({
  videoId: `video${String(index).padStart(6, '0')}`,
  title: `Feed video ${String(index).padStart(2, '0')}`,
  author: 'Channel A',
  authorId: CHANNEL_ID,
  published: now - index * 3600000,
  viewCount: 1000,
  lengthSeconds: 120,
  liveNow: false,
  isUpcoming: false,
  type: 'video'
}))

test.use({
  seed: {
    settings: {
      fetchSubscriptionsAutomatically: false,
      thumbnailSize: 100
    },
    profiles: [
      {
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [{ id: CHANNEL_ID, name: 'Channel A', thumbnail: '' }]
      }
    ],
    subscriptionCache: [
      {
        _id: CHANNEL_ID,
        videos,
        videosTimestamp: new Date(now).toISOString()
      }
    ]
  }
})

/**
 * Emit the `input` events a real drag produces, without going through the mouse
 * so the number of steps is deterministic. Each step gets its own frame,
 * otherwise Vue batches the whole drag into a single update.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number[]} values
 */
async function dragSlider(page, values) {
  for (const value of values) {
    await page.evaluate((size) => {
      const slider = document.querySelector('.thumbnailSizeSlider .input')
      slider.value = String(size)
      slider.dispatchEvent(new Event('input', { bubbles: true }))

      return new Promise((resolve) => requestAnimationFrame(() => resolve()))
    }, value)
  }
}

test.describe('thumbnail size slider', () => {
  for (const [width, uiScale] of [[375, 100], [412, 100], [375, 125], [412, 125]]) {
    test(`fits thumbnails to a ${width}px window at ${uiScale}% UI scale`, async ({ app, page }) => {
      await app.electronApp.evaluate(({ BrowserWindow }, { width, uiScale }) => {
        const window = BrowserWindow.getAllWindows()[0]
        window.setMinimumSize(0, 0)
        window.webContents.setZoomFactor(uiScale / 100)
        window.setContentSize(Math.round(width * uiScale / 100), 900)
      }, { width, uiScale })
      await goTo(page, 'subscriptions')
      await expect(page.getByText('Feed video 00')).toBeVisible()
      const grid = page.locator('.autoGrid')
      const columns = () => grid.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)
      await expect.poll(columns).toBe(2)
      const cardWidth = () => grid.locator(':scope > *').first().evaluate(element => element.getBoundingClientRect().width)
      const defaultWidth = await cardWidth()

      await page.locator('.profileTrigger').click()
      await expect(page.locator('.thumbnailSizeSlider')).toBeVisible()
      await expect(page.locator('.thumbnailSizeSlider .input')).toHaveAttribute('max', '110')
      let previousWidth = 0
      for (let size = 60; size <= 100; size += 10) {
        await dragSlider(page, [size])
        await expect.poll(cardWidth).toBeCloseTo(defaultWidth * size / 100, 0)
        const currentWidth = await cardWidth()
        expect(currentWidth).toBeGreaterThan(previousWidth)
        previousWidth = currentWidth
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      }
      await dragSlider(page, [110])
      await expect.poll(columns).toBe(1)
      const gridWidth = await grid.evaluate(element => element.getBoundingClientRect().width)
      await expect.poll(cardWidth).toBeCloseTo(gridWidth, 0)

      await dragSlider(page, [100])
      await expect.poll(columns).toBe(2)
      const cards = await grid.locator(':scope > *').evaluateAll(elements => elements.slice(0, 2).map(element => {
        const { x, y, width } = element.getBoundingClientRect()
        return { x, y, width }
      }))
      expect(cards[0].y).toBeCloseTo(cards[1].y, 0)
      expect(cards[1].x).toBeGreaterThan(cards[0].x + cards[0].width)

      if (width === 412 && uiScale === 100) {
        const slider = page.locator('.thumbnailSizeSlider .input')
        const resize = width => app.electronApp.evaluate(({ BrowserWindow }, width) => {
          BrowserWindow.getAllWindows()[0].setContentSize(width, 900)
        }, width)
        await resize(1000)
        await expect(slider).toHaveAttribute('max', '180')
        await dragSlider(page, [180])
        await resize(412)
        await expect(slider).toHaveAttribute('max', '110')
        await expect(slider).toHaveValue('110')
        await expect.poll(cardWidth).toBeCloseTo(gridWidth, 0)
        await resize(1000)
        await expect(slider).toHaveValue('180')
        await resize(412)
        await page.locator('.profileTrigger').click()

        await goToSettingsSection(page, 'theme')
        await expect(page.getByRole('slider', { name: 'Thumbnail Size' })).toHaveAttribute('max', '110')
        await expect(page.getByRole('slider', { name: 'Thumbnail Size' })).toHaveValue('110')
      }
    })
  }

  for (const uiScale of [100, 125]) {
    for (const trigger of [100, 60, 'wider viewport']) {
      test(`clamps the bottom after changing to ${trigger} at ${uiScale}% UI scale`, async ({ app, page }) => {
        const resize = width => app.electronApp.evaluate(({ BrowserWindow }, { width, uiScale }) => {
          const window = BrowserWindow.getAllWindows()[0]
          window.setMinimumSize(0, 0)
          window.webContents.setZoomFactor(uiScale / 100)
          window.setContentSize(Math.round(width * uiScale / 100), 900)
        }, { width, uiScale })
        const setSize = size => page.evaluate(value => {
          const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
          store.commit('setThumbnailSize', value)
        }, size)
        const scrollState = () => page.evaluate(() => {
          const root = document.documentElement
          const scrollbar = document.querySelector('body > .os-scrollbar-vertical')
          const track = scrollbar.querySelector('.os-scrollbar-track').getBoundingClientRect()
          const handleElement = scrollbar.querySelector('.os-scrollbar-handle')
          const handle = handleElement.getBoundingClientRect()
          const minHandleHeight = Number.parseFloat(getComputedStyle(handleElement).minHeight) || 0
          const card = document.querySelector('.subscriptionsPage .card')
          const route = document.querySelector('.app > .routerView')
          const contentBottom = card.getBoundingClientRect().bottom
          const bottomMargin = Number.parseFloat(getComputedStyle(card).marginBottom) +
            Math.max(0, Number.parseFloat(getComputedStyle(route).marginBottom))
          return {
            height: root.scrollHeight,
            offset: window.scrollY,
            bottomDistance: root.scrollHeight - root.clientHeight - window.scrollY,
            contentBottomError: Math.abs(root.clientHeight - contentBottom - bottomMargin),
            thumbBottomDistance: track.bottom - handle.bottom,
            thumbHeightError: Math.abs(handle.height - Math.max(minHandleHeight, track.height * root.clientHeight / root.scrollHeight)),
            scrollbarVisible: scrollbar.classList.contains('os-scrollbar-visible')
          }
        })

        await resize(412)
        await goTo(page, 'subscriptions')
        await expect(page.getByText('Feed video 00')).toBeVisible()
        await page.evaluate(() => document.fonts.ready)
        await setSize(110)
        await expect.poll(() => page.locator('.autoGrid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(1)
        await expect.poll(async () => {
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
          return Math.abs((await scrollState()).bottomDistance)
        }).toBeLessThanOrEqual(1)
        const before = await scrollState()
        expect(before.offset).toBeGreaterThan(0)

        if (trigger === 'wider viewport') {
          await resize(1000)
        } else {
          await setSize(trigger)
        }

        await expect.poll(async () => (await scrollState()).height).toBeLessThan(before.height)
        await expect.poll(async () => Math.abs((await scrollState()).bottomDistance)).toBeLessThanOrEqual(1)
        // Include the desktop route's bottom margin as well as the card's;
        // the phone route has a negative margin and adds no bottom space.
        await expect.poll(async () => (await scrollState()).contentBottomError).toBeLessThanOrEqual(1)
        await expect.poll(async () => Math.abs((await scrollState()).thumbBottomDistance)).toBeLessThanOrEqual(1)
        await expect.poll(async () => (await scrollState()).thumbHeightError).toBeLessThanOrEqual(1)
        expect((await scrollState()).scrollbarVisible).toBe(true)
      })
    }
  }

  test('resizes the feed without re-measuring every card', async ({ page, attachScreenshot }) => {
    await goTo(page, 'subscriptions')
    await expect(page.getByText('Feed video 00')).toBeVisible()

    const grid = page.locator('.autoGrid')
    const initialSize = await grid.evaluate((element) => {
      return element.style.getPropertyValue('--thumbnail-grid-size')
    })
    expect(initialSize).not.toBe('')

    await page.locator('.profileTrigger').click()
    await expect(page.locator('.thumbnailSizeSlider')).toBeVisible()
    await attachScreenshot('feed at the default thumbnail size')

    // TransitionGroup measures every child whenever it re-renders, so a
    // reactive thumbnail size would cost one getBoundingClientRect per card per
    // slider step. Counting the calls catches that without timing anything.
    const cardCount = await page.locator('.autoGrid > *').count()
    expect(cardCount).toBeGreaterThan(15)

    await page.evaluate(() => {
      window.__rectCalls = 0
      const original = Element.prototype.getBoundingClientRect
      Element.prototype.getBoundingClientRect = function () {
        window.__rectCalls++
        return original.call(this)
      }
    })

    const steps = [110, 120, 130, 140, 150, 160, 170, 180]
    await dragSlider(page, steps)

    const rectCalls = await page.evaluate(() => window.__rectCalls)
    expect(rectCalls).toBeLessThan(cardCount)

    // The resize still has to happen, on both the grid and the list variables.
    await expect
      .poll(() => grid.evaluate((element) => element.style.getPropertyValue('--thumbnail-grid-size')))
      .not.toBe(initialSize)
    await attachScreenshot('feed at the largest thumbnail size')

    const listSize = await page.evaluate(() => {
      return document.body.style.getPropertyValue('--thumbnail-list-size')
    })
    expect(Number.parseFloat(listSize)).toBeCloseTo(336 * 1.8)
  })
})
