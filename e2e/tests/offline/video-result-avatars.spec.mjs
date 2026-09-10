import { test, expect, goTo, goToSettingsSection, sel } from '../../helpers/app.mjs'
import { expectImagesLoaded, fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const AVATAR = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="red"/></svg>'

test.describe('subscription video avatars', () => {
  test.use({
    seed: {
      settings: {
        fetchSubscriptionsAutomatically: false,
        listType: 'grid'
      },
      profiles: [{
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [{ id: CHANNEL_ID, name: 'Channel A', thumbnail: AVATAR }]
      }],
      subscriptionCache: [{
        _id: CHANNEL_ID,
        videos: [{
          type: 'video',
          videoId: 'avatarfeed1',
          title: 'Subscription avatar result',
          author: 'Channel A',
          authorId: CHANNEL_ID,
          published: Date.now(),
          viewCount: 1,
          lengthSeconds: 60,
          liveNow: false
        }],
        videosTimestamp: new Date().toISOString(),
        shorts: [],
        shortsTimestamp: new Date().toISOString(),
        liveStreams: [],
        liveStreamsTimestamp: new Date().toISOString(),
        communityPosts: [],
        communityPostsTimestamp: new Date().toISOString()
      }]
    }
  })

  test('uses the cached subscription thumbnail', async ({ page }) => {
    await goTo(page, 'subscriptions')

    const video = page.locator('.ft-list-video').filter({ hasText: 'Subscription avatar result' })
    await expect(video.locator('.channelAvatarImage')).toHaveAttribute('src', AVATAR)
  })
})

test.describe('Invidious search video avatars', () => {
  const instanceUrl = 'https://invidious.test'
  const avatarUrl = `${instanceUrl}/ggpht/channel-avatar`

  test.use({
    seed: {
      settings: {
        backendPreference: 'invidious',
        defaultInvidiousInstance: instanceUrl,
        generalAutoLoadMorePaginatedItemsEnabled: false,
        listType: 'list',
        uiScale: 125
      }
    }
  })

  test('retries failed video and playlist thumbnails without reloading the results', async ({ page }) => {
    await page.route(`${instanceUrl}/api/v1/search/**`, route => route.fulfill({
      json: [invidiousVideo('avatar-search-1', 'Retry thumbnail result'), invidiousPlaylist()]
    }))
    await page.route(`${instanceUrl}/api/v1/channels/${CHANNEL_ID}?**`, route => route.fulfill({
      json: { author: 'Channel A', authorThumbnails: [{ url: avatarUrl }], tabs: [] }
    }))
    await page.route(avatarUrl, route => fulfillVisualFixture(route, 'avatar'))
    const failedRequests = []
    const serveThumbnail = route => {
      const url = new URL(route.request().url())
      if (!url.searchParams.has('opentubex_retry')) {
        failedRequests.push(url.toString())
        return route.abort('failed')
      }
      return fulfillVisualFixture(route, 'video-thumbnail')
    }
    await page.route(`${instanceUrl}/vi/**`, serveThumbnail)
    await page.route('https://i.ytimg.com/**', serveThumbnail)

    await page.locator(sel.searchInput).fill('retry thumbnails')
    await page.locator(sel.searchInput).press('Enter')

    const thumbnails = page.locator('.ft-list-video .thumbnailImage')
    await expect(thumbnails).toHaveCount(2)
    await expectImagesLoaded(thumbnails)
    expect(failedRequests.length).toBeGreaterThan(0)
    for (const thumbnail of await thumbnails.all()) {
      await expect(thumbnail).toHaveAttribute('src', /[?&]opentubex_retry=/)
    }
  })

  test('loads shared avatars and lays out result metadata responsively', async ({ page }) => {
    let channelRequests = 0

    await page.route(`${instanceUrl}/api/v1/search/**`, route => route.fulfill({
      json: [
        invidiousVideo('avatar-search-1', 'First avatar search result'),
        invidiousVideo('avatar-search-2', 'Second avatar search result'),
        invidiousPlaylist()
      ]
    }))
    await page.route(`${instanceUrl}/api/v1/channels/${CHANNEL_ID}?**`, route => {
      channelRequests++
      return route.fulfill({
        json: {
          author: 'Channel A',
          authorThumbnails: [{ url: avatarUrl }],
          tabs: []
        }
      })
    })
    await page.route(avatarUrl, route => fulfillVisualFixture(route, 'avatar'))
    await page.route(`${instanceUrl}/vi/**`, route => fulfillVisualFixture(route, 'video-thumbnail'))
    await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))

    await page.locator(sel.searchInput).fill('avatar results')
    await page.locator(sel.searchInput).press('Enter')

    const avatars = page.locator('.ft-list-video .channelAvatarImage')
    await expect(avatars).toHaveCount(3)
    await expect(avatars.first()).toHaveAttribute('src', avatarUrl)
    await expect.poll(() => avatars.evaluateAll(images => {
      return images.every(image => image.complete && image.naturalWidth === 48)
    })).toBe(true)
    await expectImagesLoaded(page.locator('.ft-list-video .thumbnailImage'))
    await expect(page.locator('.ft-list-video').filter({
      has: page.getByRole('heading', { name: 'Avatar search playlist' })
    }).locator('.channelAvatarImage')).toHaveAttribute('src', avatarUrl)
    const infoLine = page.locator('.ft-list-video').filter({
      has: page.getByRole('heading', { name: 'First avatar search result' })
    }).locator('.infoLine')
    expect(await infoLine.evaluate(element => {
      const textBounds = (selector) => {
        const range = document.createRange()
        range.selectNodeContents(element.querySelector(selector))
        return range.getBoundingClientRect()
      }
      const channelBounds = textBounds('.channelNameText')
      const channelCenter = (channelBounds.top + channelBounds.bottom) / 2
      const details = element.querySelector('.videoInfo')
      const detailBounds = details.getBoundingClientRect()
      const separator = getComputedStyle(details, '::before')
      const separatorCenter = detailBounds.top + Number.parseFloat(separator.insetBlockStart)

      return {
        metadataAligned: Math.max(...['.viewCount', '.uploadedTime'].map(selector => {
          const bounds = textBounds(selector)
          return Math.abs(channelCenter - (bounds.top + bounds.bottom) / 2)
        })) <= 0.5,
        separatorIsVisible: separator.content === '""' &&
          getComputedStyle(details).overflowX === 'visible' &&
          detailBounds.left + Number.parseFloat(separator.insetInlineStart) >
            element.querySelector('.channelName').getBoundingClientRect().right,
        separatorAligned: Math.abs(channelCenter - separatorCenter) <= 0.5
      }
    })).toEqual({
      metadataAligned: true,
      separatorAligned: true,
      separatorIsVisible: true,
    })
    expect(channelRequests).toBe(1)

    await infoLine.evaluate(element => {
      const channelWidth = element.querySelector('.channelName').getBoundingClientRect().width
      const detailsWidth = element.querySelector('.videoInfo').getBoundingClientRect().width
      element.style.flex = 'none'
      element.style.inlineSize = `${Math.ceil(Math.max(channelWidth, detailsWidth))}px`
    })
    await expect.poll(() => infoLine.evaluate(element => {
      const channelTop = element.querySelector('.channelName').getBoundingClientRect().top
      const viewTop = element.querySelector('.viewCount').getBoundingClientRect().top
      const uploadedTop = element.querySelector('.uploadedTime').getBoundingClientRect().top

      return {
        detailsShareRow: Math.abs(viewTop - uploadedTop) <= 0.5,
        detailsStartNewRow: viewTop > channelTop + 0.5
      }
    })).toEqual({
      detailsShareRow: true,
      detailsStartNewRow: true
    })
    expect(await infoLine.locator('.viewCount').textContent()).not.toMatch(/^\s*•/)
    expect(await infoLine.evaluate(element => {
      const details = element.querySelector('.videoInfo')
      const lineBounds = element.getBoundingClientRect()
      const detailBounds = details.getBoundingClientRect()
      const separator = getComputedStyle(details, '::before')

      return separator.content === '""' &&
        separator.backgroundColor === getComputedStyle(details).color &&
        getComputedStyle(element).overflowX === 'clip' &&
        detailBounds.left + Number.parseFloat(separator.insetInlineStart) < lineBounds.left
    })).toBe(true)
  })

  test('hides video and playlist avatars without fetching channel data', async ({ page }) => {
    let channelRequests = 0

    await page.route(`${instanceUrl}/api/v1/search/**`, route => route.fulfill({
      json: [
        invidiousVideo('avatar-search-hidden', 'Hidden avatar video'),
        invidiousPlaylist()
      ]
    }))
    await page.route(`${instanceUrl}/api/v1/channels/${CHANNEL_ID}?**`, route => {
      channelRequests++
      return route.fulfill({
        json: {
          author: 'Channel A',
          authorThumbnails: [{ url: avatarUrl }],
          tabs: []
        }
      })
    })

    const focusSettings = await goToSettingsSection(page, 'focus')
    const hideAvatars = focusSettings.getByRole('checkbox', { name: 'Hide Channel Avatars' })
    await focusSettings.locator('label.switch-label').filter({ hasText: 'Hide Channel Avatars' }).click()
    await expect(hideAvatars).toBeChecked()
    await page.locator('.settingsCloseButton').click()

    await page.locator(sel.searchInput).fill('hidden avatar results')
    await page.locator(sel.searchInput).press('Enter')

    await expect(page.locator('.ft-list-video')).toHaveCount(2)
    await expect(page.locator('.ft-list-video .channelAvatar')).toHaveCount(0)
    expect(channelRequests).toBe(0)
  })
})

function invidiousVideo(videoId, title) {
  return {
    type: 'video',
    title,
    videoId,
    author: 'Channel A',
    authorId: CHANNEL_ID,
    authorUrl: `/channel/${CHANNEL_ID}`,
    authorVerified: false,
    videoThumbnails: [],
    description: '',
    descriptionHtml: '',
    viewCount: 1,
    published: Math.floor(Date.now() / 1000),
    publishedText: 'now',
    lengthSeconds: 60,
    liveNow: false,
    premium: false,
    isUpcoming: false
  }
}

function invidiousPlaylist() {
  return {
    type: 'playlist',
    title: 'Avatar search playlist',
    playlistId: 'PL-avatar-search',
    playlistThumbnail: 'https://i.ytimg.com/vi/avatar-search-1/hqdefault.jpg',
    author: 'Channel A',
    authorId: CHANNEL_ID,
    authorUrl: `/channel/${CHANNEL_ID}`,
    authorVerified: false,
    videoCount: 2,
    videos: []
  }
}
