import { test, expect, goTo } from '../../helpers/app.mjs'

const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const timestamp = new Date().toISOString()

test.use({
  seed: {
    settings: {
      fetchSubscriptionsAutomatically: false,
      uiScale: 125
    },
    profiles: [{
      _id: 'allChannels',
      name: 'All Channels',
      bgColor: '#000000',
      textColor: '#FFFFFF',
      subscriptions: [{ id: CHANNEL_ID, name: 'Station creator', thumbnail: '' }]
    }],
    subscriptionCache: [{
      _id: CHANNEL_ID,
      videos: [{
        type: 'video',
        videoId: 'station0001',
        title: 'Continuous station',
        author: 'Station creator',
        authorId: CHANNEL_ID,
        published: Date.now() - 3_600_000,
        viewCount: 1000,
        isStation: true,
        liveNow: true
      }],
      videosTimestamp: timestamp,
      shorts: [],
      shortsTimestamp: timestamp,
      liveStreams: [],
      liveStreamsTimestamp: timestamp,
      communityPosts: [],
      communityPostsTimestamp: timestamp
    }]
  }
})

test('renders stations with their label and watching count in OpenTubeX video cards', async ({ page }) => {
  await goTo(page, 'subscriptions')

  const card = page.locator('.ft-list-video').filter({ hasText: 'Continuous station' })
  await expect(card.locator('.videoDuration')).toHaveText('Station')
  await expect(card.locator('.videoDuration')).toHaveClass(/live/)
  await expect(card.locator('[data-icon="tower-broadcast"]')).toBeVisible()
  await expect(card.locator('.channelNameText')).toHaveText('Station creator')
  await expect(card.locator('.viewCount')).toHaveText('1k watching')
  await expect(card.locator('.uploadedTime')).toHaveCount(0)
})

test('labels the navigation search button and search action', async ({ page }) => {
  await expect(page.locator('.searchInput .inputAction')).toHaveAccessibleName('Search')

  await page.setViewportSize({ width: 600, height: 800 })
  await expect(page.locator('.navSearchButton')).toBeVisible()
  await expect(page.locator('.navSearchButton')).toHaveAccessibleName('Open Search Container')
})
