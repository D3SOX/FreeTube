import { createServer } from 'node:http'
import { deflateSync } from 'node:zlib'

import { test, expect, goTo } from '../../helpers/app.mjs'

const now = Date.now()
const CHANNEL_ID = 'UCbbbbbbbbbbbbbbbbbbbbbb'
const FCROP = 'c-fcrop64=1,38000000c7ffffff'

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
  }
  return ~c >>> 0
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([length, typeBuf, data, crc])
}

/** Solid RGB PNG of the requested size for aspect-ratio assertions. */
function solidPng(width, height, rgb = [40, 120, 200]) {
  const row = Buffer.alloc(1 + width * 3)
  for (let x = 0; x < width; x++) {
    row[1 + x * 3] = rgb[0]
    row[2 + x * 3] = rgb[1]
    row[3 + x * 3] = rgb[2]
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

function imageUrl(id, size) {
  return `https://yt3.ggpht.com/e2e-post-${id}=s${size}-${FCROP}-rw-nd-v1`
}

function thumbnails(id, width, height) {
  return [
    { width, height, url: imageUrl(id, width) },
    { width: Math.round(width / 2), height: Math.round(height / 2), url: imageUrl(id, Math.round(width / 2)) }
  ]
}

function multiImagePost() {
  return {
    postId: 'multi-image-post',
    postText: 'Multi image community post',
    author: 'Channel B',
    authorId: CHANNEL_ID,
    authorThumbnails: [],
    publishedTime: now - 30 * 60000,
    voteCount: 12,
    commentCount: 3,
    postContent: {
      type: 'multiImage',
      content: [
        thumbnails('square-a', 640, 640),
        thumbnails('square-b', 640, 640)
      ]
    },
    type: 'community',
    isNewInSubscriptionFeed: true
  }
}

function singleImagePost() {
  return {
    postId: 'single-image-post',
    postText: 'Single image community post',
    author: 'Channel B',
    authorId: CHANNEL_ID,
    authorThumbnails: [],
    publishedTime: now - 20 * 60000,
    voteCount: 4,
    commentCount: 1,
    postContent: {
      type: 'image',
      content: thumbnails('wide', 800, 450)
    },
    type: 'community',
    isNewInSubscriptionFeed: true
  }
}

function interruptedImagePost(imageUrls) {
  return {
    postId: 'interrupted-image-post',
    postText: 'Generic gallery post',
    author: 'Example Channel',
    authorId: CHANNEL_ID,
    authorThumbnails: [],
    publishedTime: now - 10 * 60000,
    voteCount: 2,
    commentCount: 0,
    postContent: {
      type: 'multiImage',
      content: imageUrls.map((url) => [{ width: 640, height: 640, url }])
    },
    type: 'community',
    isNewInSubscriptionFeed: true
  }
}

async function stubPostImages(page) {
  await page.route(/yt3\.ggpht\.com\/e2e-post-/, async (route) => {
    const url = route.request().url()
    const sizeMatch = url.match(/=s(\d+)/)
    const size = Number.parseInt(sizeMatch?.[1] ?? '640', 10)
    const isWide = url.includes('e2e-post-wide')
    const width = size
    const height = isWide ? Math.round(size * 450 / 800) : size
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: solidPng(width, height)
    })
  })
}

test.describe('community post images', () => {
  test.use({
    seed: {
      settings: {
        fetchSubscriptionsAutomatically: false,
        hideSubscriptionsCommunity: false,
        showNewSubscriptionFeed: true,
        useRssFeeds: false,
        listType: 'list',
        uiRoundness: 200
      },
      profiles: [{
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [{ id: CHANNEL_ID, name: 'Channel B', thumbnail: '' }]
      }],
      subscriptionCache: [{
        _id: CHANNEL_ID,
        communityPosts: [multiImagePost(), singleImagePost()],
        communityPostsTimestamp: new Date(now - 3600000).toISOString()
      }]
    }
  })

  test('feed post options stay visible without hover in list and grid layouts', async ({ page }) => {
    await stubPostImages(page)
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="posts"]').click()
    for (const listType of ['list', 'grid']) {
      await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setListType', value), listType)
      await page.mouse.move(0, 0)
      await page.evaluate(() => document.activeElement?.blur())
      const post = page.locator('.ft-list-post').first()
      const options = post.locator('.optionsButton')
      await expect(options).toHaveCSS('opacity', '1')
      await options.getByRole('button', { name: /^More options$/i }).click()
      await expect(post.getByRole('option').first()).toBeVisible()
      await page.keyboard.press('Escape')
    }
  })

  test('keeps carousel crops, shows full single images, and applies UI roundness', async ({ page, attachScreenshot }) => {
    await stubPostImages(page)

    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="posts"]').click()

    const multiPost = page.locator('.ft-list-post').filter({ hasText: 'Multi image community post' })
    const singlePost = page.locator('.ft-list-post').filter({ hasText: 'Single image community post' })
    await expect(multiPost).toBeVisible()
    await expect(singlePost).toBeVisible()

    const multiImage = multiPost.locator('img.communityImage').first()
    const singleImage = singlePost.locator('img.communityImage').first()
    await expect(multiImage).toBeVisible()
    await expect(singleImage).toBeVisible()

    // Carousels keep YouTube's square CDN crop; single images drop it.
    await expect(multiImage).toHaveAttribute('src', new RegExp(FCROP))
    await expect(singleImage).not.toHaveAttribute('src', new RegExp(FCROP))

    await expect.poll(async () => multiImage.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0)
    await expect.poll(async () => singleImage.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0)
    await attachScreenshot('community posts feed')

    const multiMetrics = await multiImage.evaluate((img) => {
      const style = getComputedStyle(img)
      return {
        naturalRatio: img.naturalWidth / img.naturalHeight,
        displayRatio: img.clientWidth / img.clientHeight,
        borderRadius: style.borderRadius
      }
    })
    const singleMetrics = await singleImage.evaluate((img) => {
      return {
        naturalRatio: img.naturalWidth / img.naturalHeight,
        displayRatio: img.clientWidth / img.clientHeight
      }
    })

    // uiRoundness 200 → --ui-roundness: 2 → 8px * 2 = 16px
    expect(multiMetrics.borderRadius).toBe('16px')
    expect(multiMetrics.displayRatio).toBeCloseTo(multiMetrics.naturalRatio, 2)
    expect(multiMetrics.naturalRatio).toBeCloseTo(1, 2)
    expect(singleMetrics.displayRatio).toBeCloseTo(singleMetrics.naturalRatio, 2)
    expect(singleMetrics.naturalRatio).toBeCloseTo(800 / 450, 2)

    // Carousel chrome should sit on the image, not in a tall empty gap below it.
    const carouselLayout = await multiPost.locator('swiper-container.sliderContainer').evaluate((container) => {
      const image = container.querySelector('img.communityImage')
      const pagination = container.shadowRoot?.querySelector('.swiper-pagination')
      return {
        containerHeight: container.getBoundingClientRect().height,
        imageHeight: image.getBoundingClientRect().height,
        paginationBottom: pagination?.getBoundingClientRect().bottom ?? null,
        containerBottom: container.getBoundingClientRect().bottom
      }
    })

    expect(carouselLayout.containerHeight).toBeLessThan(carouselLayout.imageHeight * 1.35)
    if (carouselLayout.paginationBottom != null) {
      expect(carouselLayout.paginationBottom).toBeLessThanOrEqual(carouselLayout.containerBottom + 1)
    }
  })

  test('separates post images from the like and comment row at different UI scales', async ({ page, attachScreenshot }) => {
    await stubPostImages(page)
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="posts"]').click()

    for (const scale of [1, 0.95, 1.25]) {
      await page.evaluate((factor) => window.ftElectron.setZoomFactor(factor), scale)

      for (const title of ['Single image community post', 'Multi image community post']) {
        const post = page.locator('.ft-list-post').filter({ hasText: title })
        const image = post.locator('img.communityImage').first()
        await expect.poll(() => image.evaluate((element) => element.naturalWidth)).toBeGreaterThan(0)
        await post.locator('.bottomSection').scrollIntoViewIfNeeded()

        await expect.poll(() => post.evaluate((element) => {
          const imageBottom = element.querySelector('img.communityImage').getBoundingClientRect().bottom
          const actionsTop = element.querySelector('.bottomSection').getBoundingClientRect().top
          return actionsTop - imageBottom
        }), { message: `${title} needs space above its actions at ${scale * 100}% UI scale` }).toBeGreaterThanOrEqual(8)
      }

      await attachScreenshot(`post image spacing at ${scale * 100}% UI scale`)
    }
  })

  test('restores carousel navigation after returning to the Posts tab', async ({ page }) => {
    await stubPostImages(page)

    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="posts"]').click()

    const post = page.locator('.ft-list-post').filter({ hasText: 'Multi image community post' })
    const carousel = post.locator('swiper-container')
    await expect(post).toBeVisible()
    await expect.poll(async () => carousel.evaluate((element) => element.swiper?.activeIndex)).toBe(0)

    await page.locator('[data-subscription-feed-tab="videos"]').click()
    await expect(post).toHaveCount(0)
    await page.locator('[data-subscription-feed-tab="posts"]').click()
    await expect(post).toBeVisible()

    await expect.poll(async () => carousel.evaluate((element) => element.swiper?.activeIndex)).toBe(0)
    await carousel.locator('.swiper-button-next').click()
    await expect.poll(async () => carousel.evaluate((element) => element.swiper?.activeIndex)).toBe(1)
  })
})

const interruptedImageTest = test.extend({
  interruptedImageUrls: [async ({ browserName: _browserName }, use) => {
    const image = solidPng(640, 640)
    const server = createServer((request, response) => {
      response.setHeader('Access-Control-Allow-Origin', '*')
      response.setHeader('Content-Type', 'image/png')
      response.setHeader('Connection', 'close')

      if (request.url === '/interrupted.png') {
        // Send valid image bytes, then end one byte short of the declared
        // length so Chromium emits an error after lazy loading has started.
        response.setHeader('Content-Length', image.length + 1)
        response.write(image)
        setTimeout(() => response.end(), 750)
        return
      }

      response.setHeader('Content-Length', image.length)
      response.end(image)
    })

    await new Promise((resolve, reject) => {
      const onError = (error) => reject(error)
      server.once('error', onError)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', onError)
        resolve()
      })
    })

    const address = server.address()
    if (address == null || typeof address === 'string') {
      throw new Error('Failed to start the gallery image server')
    }

    try {
      const baseUrl = `http://127.0.0.1:${address.port}`
      await use([`${baseUrl}/interrupted.png`, `${baseUrl}/complete.png`])
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  }, { scope: 'worker' }],

  seed: async ({ interruptedImageUrls }, use) => {
    await use({
      settings: {
        fetchSubscriptionsAutomatically: false,
        hideSubscriptionsCommunity: false,
        showNewSubscriptionFeed: true,
        useRssFeeds: false,
        listType: 'list'
      },
      profiles: [{
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [{ id: CHANNEL_ID, name: 'Example Channel', thumbnail: '' }]
      }],
      subscriptionCache: [{
        _id: CHANNEL_ID,
        communityPosts: [interruptedImagePost(interruptedImageUrls)],
        communityPostsTimestamp: new Date(now - 3600000).toISOString()
      }]
    })
  }
})

interruptedImageTest.use({
  launchArgs: ['--disable-web-security', '--allow-running-insecure-content']
})

interruptedImageTest('clears the loader when a gallery image request is interrupted', async ({ page }) => {
  await goTo(page, 'subscriptions')
  await page.locator('[data-subscription-feed-tab="posts"]').click()

  const post = page.locator('.ft-list-post').filter({ hasText: 'Generic gallery post' })
  await expect(post).toBeVisible()

  const firstSlide = post.locator('swiper-slide').first()
  const image = firstSlide.locator('img.communityImage')
  await expect.poll(async () => image.evaluate((element) => element.complete)).toBe(true)

  await expect(firstSlide.locator('.swiper-lazy-preloader')).toHaveCount(0)
})
