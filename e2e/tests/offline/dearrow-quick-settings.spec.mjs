import { createHash } from 'node:crypto'
import { test, expect, goTo } from '../../helpers/app.mjs'
import { fulfillVisualFixture, expectImagesLoaded } from '../../helpers/visual-fixtures.mjs'

const VIDEO_ID = 'eeeeeeeeeee'
const ORIGINAL_TITLE = 'Original video title'
const REPLACEMENT_TITLE = 'DeArrow video title'
const THUMBNAIL_URL = `https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=${VIDEO_ID}&time=10`

test.use({
  seed: {
    settings: {
      quickSettings: ['useDeArrowTitles', 'useDeArrowThumbnails'],
      useDeArrowTitles: false,
      useDeArrowThumbnails: false,
    },
    history: [{
      _id: VIDEO_ID,
      videoId: VIDEO_ID,
      title: ORIGINAL_TITLE,
      author: 'Test Channel',
      authorId: 'UC-test-channel-id',
      published: 1_700_000_000_000,
      timeWatched: 1_700_000_000_000,
      lengthSeconds: 60,
      viewCount: 1234,
      isLive: false,
      type: 'video',
    }],
  }
})

for (const cached of [false, true]) {
  test(`DeArrow quick toggles update visible cards ${cached ? 'with' : 'without'} cached replacements`, async ({ page }) => {
    let brandingRequests = 0
    await page.route('https://sponsor.ajay.app/api/branding/*', async route => {
      brandingRequests++
      await route.fulfill({
        json: {
          [VIDEO_ID]: {
            titles: [{ title: REPLACEMENT_TITLE, votes: 1 }],
            thumbnails: [{ timestamp: 10, votes: 1 }],
            videoDuration: 60,
          }
        }
      })
    })
    await page.route('https://dearrow-thumb.ajay.app/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    if (cached) {
      await page.evaluate(({ videoId, title, thumbnail }) => {
        document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('addVideoToDeArrowCache', {
          videoId, title, thumbnail, thumbnailTimestamp: 10, videoDuration: 60,
        })
      }, { videoId: VIDEO_ID, title: REPLACEMENT_TITLE, thumbnail: THUMBNAIL_URL })
    }

    await goTo(page, 'history')
    const card = page.locator('.ft-list-video').first()
    const title = card.locator('.title')
    const thumbnail = card.locator('.thumbnailImage').first()
    const originalThumbnail = await thumbnail.getAttribute('src')
    await expect(title).toHaveText(ORIGINAL_TITLE)
    const originalCard = await card.elementHandle()
    await page.locator('.profileTrigger').click()
    const menu = page.getByRole('dialog', { name: 'Quick settings' })
    const titlesToggle = menu.locator('[data-setting-id="useDeArrowTitles"] label.switch-label')
    const thumbnailsToggle = menu.locator('[data-setting-id="useDeArrowThumbnails"] label.switch-label')

    await titlesToggle.click()
    await expect(title).toHaveText(REPLACEMENT_TITLE)
    await expect(thumbnail).toHaveAttribute('src', originalThumbnail)
    await thumbnailsToggle.click()
    await expect(thumbnail).toHaveAttribute('src', THUMBNAIL_URL)
    await expectImagesLoaded(thumbnail)
    await titlesToggle.click()
    await expect(title).toHaveText(ORIGINAL_TITLE)
    await expect(thumbnail).toHaveAttribute('src', THUMBNAIL_URL)
    await thumbnailsToggle.click()
    await expect(thumbnail).toHaveAttribute('src', originalThumbnail)
    await expect(card.locator('.deArrowToggleButton')).toHaveCount(0)

    await titlesToggle.click()
    await thumbnailsToggle.click()
    await menu.press('Escape')
    await card.locator('.deArrowToggleButton').click()
    await expect(title).toHaveText(ORIGINAL_TITLE)
    await expect(thumbnail).toHaveAttribute('src', originalThumbnail)
    await expect(card.locator('.deArrowToggleButton')).toHaveAttribute('title', /Show modified details/i)
    await page.locator('.profileTrigger').click()
    await titlesToggle.click()
    await expect(title).toHaveText(ORIGINAL_TITLE)
    await expect(thumbnail).toHaveAttribute('src', originalThumbnail)
    await thumbnailsToggle.click()
    await expect(card.locator('.deArrowToggleButton')).toHaveCount(0)
    await titlesToggle.click()
    await thumbnailsToggle.click()
    await menu.press('Escape')
    await expect(title).toHaveText(REPLACEMENT_TITLE)
    await expect(thumbnail).toHaveAttribute('src', THUMBNAIL_URL)
    await card.locator('.deArrowToggleButton').click()
    await card.locator('.deArrowToggleButton').click()
    await expect(title).toHaveText(REPLACEMENT_TITLE)
    await expect(thumbnail).toHaveAttribute('src', THUMBNAIL_URL)
    expect(await originalCard.evaluate(element => element.isConnected)).toBe(true)
    expect(brandingRequests).toBe(cached ? 0 : 1)
  })
}

for (const pending of ['metadata', 'thumbnail']) {
  test(`reused DeArrow cards load the new video with old ${pending} pending`, async ({ page }) => {
    const nextVideoId = 'fffffffffff'
    const nextTitle = 'Replacement video DeArrow title'
    const nextThumbnail = `https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=${nextVideoId}&time=20`
    const oldHash = createHash('sha256').update(VIDEO_ID).digest('hex').slice(0, 4)
    let heldRoute
    const branding = {
      [VIDEO_ID]: {
        titles: [{ title: REPLACEMENT_TITLE, votes: 1 }],
        thumbnails: [{ timestamp: 10, votes: 1 }],
        videoDuration: 60,
      },
      [nextVideoId]: {
        titles: [{ title: nextTitle, votes: 1 }],
        thumbnails: [{ timestamp: 20, votes: 1 }],
        videoDuration: 60,
      },
    }
    await page.route('https://sponsor.ajay.app/api/branding/*', async route => {
      if (pending === 'metadata' && route.request().url().endsWith(oldHash)) {
        heldRoute = route
        return
      }
      await route.fulfill({ json: branding })
    })
    await page.route('https://dearrow-thumb.ajay.app/**', async route => {
      if (pending === 'thumbnail' && route.request().url().includes(VIDEO_ID)) {
        heldRoute = route
        return
      }
      await fulfillVisualFixture(route, 'video-thumbnail')
    })
    await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    await goTo(page, 'history')
    const card = page.locator('.ft-list-video').first()
    await expect(card.locator('.title')).toHaveText(ORIGINAL_TITLE)
    const originalCard = await card.elementHandle()
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateUseDeArrowTitles', true)
      await store.dispatch('updateUseDeArrowThumbnails', true)
    })
    await expect.poll(() => Boolean(heldRoute)).toBe(true)
    if (pending === 'thumbnail') {
      await card.locator('.deArrowToggleButton').click()
      await expect(card.locator('.title')).toHaveText(ORIGINAL_TITLE)
    }
    // Replace the data prop without remounting, as a stable playlistItemId does.
    await page.evaluate(({ videoId }) => {
      const find = vnode => {
        if (vnode?.component?.type?.__name === 'FtListVideo') return vnode.component
        const nested = vnode?.component?.subTree && find(vnode.component.subTree)
        if (nested) return nested
        for (const child of Array.isArray(vnode?.children) ? vnode.children : []) {
          const match = find(child)
          if (match) return match
        }
      }
      const component = find(document.querySelector('#app').__vue_app__._container._vnode)
      component.props.data = { ...component.props.data, videoId, title: 'Replacement original title' }
    }, { videoId: nextVideoId })
    await expect(card.locator('.title')).toHaveText(nextTitle)
    await expect(card.locator('.thumbnailImage').first()).toHaveAttribute('src', nextThumbnail)
    if (pending === 'metadata') {
      await heldRoute.fulfill({ json: branding })
    } else {
      await fulfillVisualFixture(heldRoute, 'video-thumbnail')
    }
    await expect.poll(() => page.evaluate(videoId => {
      const cache = document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getDeArrowCache
      return cache[videoId]?.thumbnail
    }, VIDEO_ID)).toBe(pending === 'thumbnail' ? THUMBNAIL_URL : null)
    await expect(card.locator('.title')).toHaveText(nextTitle)
    await expect(card.locator('.thumbnailImage').first()).toHaveAttribute('src', nextThumbnail)
    expect(await originalCard.evaluate(element => element.isConnected)).toBe(true)
  })
}
