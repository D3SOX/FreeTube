import { test, expect, goTo } from '../../helpers/app.mjs'

const now = Date.now()
const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const shorts = Array.from({ length: 8 }, (_, index) => ({
  videoId: `short${String(index).padStart(6, '0')}`,
  title: `Phone short ${index}`,
  author: 'Channel A',
  authorId: CHANNEL_ID,
  published: now - index * 3600000,
  viewCount: 1000,
  lengthSeconds: 30,
  liveNow: false,
  isUpcoming: false,
  type: 'video'
}))

for (const listType of ['grid', 'list']) {
  test.describe(`phone Shorts with ${listType} display preference`, () => {
    test.use({
      seed: {
        settings: {
          fetchSubscriptionsAutomatically: false,
          hideSubscriptionsShorts: false,
          useCustomShortsPlayer: true,
          thumbnailSize: 100,
          listType
        },
        profiles: [{
          _id: 'allChannels',
          name: 'All Channels',
          bgColor: '#000000',
          textColor: '#FFFFFF',
          subscriptions: [{ id: CHANNEL_ID, name: 'Channel A', thumbnail: '' }]
        }],
        subscriptionCache: [{
          _id: CHANNEL_ID,
          videos: [],
          videosTimestamp: new Date(now).toISOString(),
          shorts,
          shortsTimestamp: new Date(now).toISOString()
        }]
      }
    })

    test('scales portrait cards distinctly and stops at full width', async ({ app, page }) => {
      await app.electronApp.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]
        window.setMinimumSize(0, 0)
        window.setContentSize(412, 900)
      })
      await goTo(page, 'subscriptions')
      await page.locator('[data-subscription-feed-tab="shorts"]').click()
      const grid = page.locator('.autoGrid.youtubeStyleShorts')
      await expect(grid.locator('.ft-list-video.youtubeShort').first()).toBeVisible()
      const columns = () => grid.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)
      const cardWidth = () => grid.locator(':scope > *').first().evaluate(element => element.getBoundingClientRect().width)
      const gridWidth = await grid.evaluate(element => element.getBoundingClientRect().width)

      await page.locator('.profileTrigger').click()
      const slider = page.locator('.thumbnailSizeSlider .input')
      await expect(slider).toHaveAttribute('max', '110')
      await expect.poll(columns).toBe(2)
      const defaultWidth = await cardWidth()
      for (let size = 60; size <= 110; size += 10) {
        await slider.evaluate((element, value) => {
          element.value = String(value)
          element.dispatchEvent(new Event('input', { bubbles: true }))
          element.dispatchEvent(new Event('change', { bubbles: true }))
        }, size)
        await expect.poll(cardWidth).toBeCloseTo(size === 110 ? gridWidth : defaultWidth * size / 100, 0)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      }
      await expect.poll(columns).toBe(1)

      if (listType === 'list') {
        await page.locator('.mobileSheetHeader').getByRole('button', { name: 'Close', exact: true }).click()
        await page.locator('[data-subscription-feed-tab="videos"]').click()
        await page.locator('.profileTrigger').click()
        await expect(slider).toHaveAttribute('max', '180')
      }
    })

    if (listType === 'grid') {
      test('updates a constrained grid when the viewport crosses the phone breakpoint', async ({ app, page }) => {
        await goTo(page, 'subscriptions')
        await page.locator('[data-subscription-feed-tab="shorts"]').click()
        const grid = page.locator('.autoGrid.youtubeStyleShorts')
        await expect(grid.locator('.ft-list-video.youtubeShort').first()).toBeVisible()
        await grid.evaluate(element => { element.style.inlineSize = '300px' })
        const columns = () => grid.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)
        await expect.poll(() => grid.evaluate(element => element.getBoundingClientRect().width)).toBe(300)
        await expect.poll(columns).toBe(1)

        await app.electronApp.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0]
          window.setMinimumSize(0, 0)
          window.setContentSize(650, 900)
        })
        await expect.poll(() => grid.evaluate(element => element.getBoundingClientRect().width)).toBe(300)
        await expect.poll(columns).toBe(2)
      })
    }
  })
}
