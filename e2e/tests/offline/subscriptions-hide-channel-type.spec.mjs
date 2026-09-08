import { test, expect, goTo, goToSettingsSection } from '../../helpers/app.mjs'

const CHANNEL_A = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const CHANNEL_B = 'UCbbbbbbbbbbbbbbbbbbbbbb'
const types = ['videos', 'shorts', 'live', 'posts']
const labels = { videos: 'Videos', shorts: 'Shorts', live: 'Live', posts: 'Posts' }
const now = Date.now()
const subscriptions = [CHANNEL_A, CHANNEL_B].map((id, index) => ({
  id, name: `Channel ${index === 0 ? 'A' : 'B'}`, thumbnail: '', dailyVideoLimit: null
}))

function entry(channelId, category, index = 0) {
  const common = {
    author: channelId === CHANNEL_A ? 'Channel A' : 'Channel B',
    authorId: channelId,
    isNewInSubscriptionFeed: true
  }
  if (category === 'posts') {
    return {
      ...common,
      type: 'community',
      postId: `${channelId}-post-${index}`,
      postText: `${channelId} posts ${index}`,
      publishedTime: now - index * 3600000,
      authorThumbnails: [{ url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', width: 55, height: 55 }],
      voteCount: 1,
      commentCount: 0,
      postContent: { type: 'text', content: '' }
    }
  }
  return {
    ...common,
    type: 'video',
    videoId: `${channelId}-${category}-${index}`,
    title: `${channelId} ${category} ${index}`,
    published: now - index * 3600000,
    lengthSeconds: 120,
    viewCount: 100,
    // Live archives and running premieres must use their feed's category.
    liveNow: category === 'videos',
    isPremiere: category === 'videos',
    isUpcoming: false
  }
}

const seed = {
  settings: {
    currentLocale: 'en-US',
    fetchSubscriptionsAutomatically: false,
    hideSubscriptionsVideos: false,
    hideSubscriptionsShorts: false,
    hideSubscriptionsLive: false,
    hideSubscriptionsCommunity: false,
    showNewSubscriptionFeed: true,
    useRssFeeds: false,
    uiScale: 125,
    thumbnailSize: 180
  },
  profiles: [
    { _id: 'allChannels', name: 'All Channels', subscriptions },
    { _id: 'second', name: 'Second', subscriptions }
  ].map(profile => ({ ...profile, bgColor: '#000000', textColor: '#FFFFFF' })),
  subscriptionCache: [CHANNEL_A, CHANNEL_B].map(channelId => ({
    _id: channelId,
    ...Object.fromEntries(types.flatMap(category => {
      const key = { videos: 'videos', shorts: 'shorts', live: 'liveStreams', posts: 'communityPosts' }[category]
      return [
        [key, Array.from({ length: channelId === CHANNEL_A ? 18 : 1 }, (_, index) => entry(channelId, category, index))],
        [`${key}Timestamp`, new Date(now).toISOString()]
      ]
    }))
  }))
}

test.use({ seed })

function card(page, category, channelId = CHANNEL_A, index = 0) {
  return page.locator(category === 'posts' ? '.ft-list-post' : '.ft-list-video')
    .filter({ hasText: `${channelId} ${category} ${index}` }).first()
}

for (const category of types) {
  test(`hides a channel's ${category} immediately and persists the setting`, async ({ app, page }) => {
    await goTo(page, 'subscriptions')
    await page.locator(`[data-subscription-feed-tab="${category}"]`).click()
    const lastCard = card(page, category, CHANNEL_A, 17)
    await expect(card(page, category)).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await lastCard.scrollIntoViewIfNeeded()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
    await lastCard.getByRole('button', { name: 'More Options', exact: true }).click()
    const action = page.getByRole('option', { name: `Never show ${labels[category]} from this channel in feeds again`, exact: true })
    await expect(action).toBeVisible()
    await action.focus()
    await page.keyboard.press('Enter')
    await expect(card(page, category)).toHaveCount(0)
    await expect(card(page, category, CHANNEL_B)).toBeVisible()
    await expect.poll(() => page.evaluate(() => {
      const grid = document.querySelector('.autoGrid')
      const lastItem = grid.lastElementChild
      return Math.abs(grid.getBoundingClientRect().bottom - lastItem.getBoundingClientRect().bottom)
    })).toBeLessThanOrEqual(1)
    await expect.poll(() => page.evaluate(() => {
      const maximum = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
      const scrollbar = document.querySelector('body > .os-scrollbar-vertical')
      return Math.abs(window.scrollY - maximum) <= 1 &&
        scrollbar.classList.contains('os-scrollbar-unusable') === (maximum <= 1)
    })).toBe(true)

    await page.locator('[data-subscription-feed-tab="all"]').click()
    await expect(card(page, category)).toHaveCount(0)
    for (const other of types.filter(type => type !== category)) {
      await page.locator(`[data-subscription-feed-tab="${other}"]`).click()
      await expect(card(page, other)).toBeVisible()
    }
    const expectedTypes = types.filter(type => type !== category)
    await expect.poll(() => page.evaluate(channelId => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.getters.getProfileList.map(profile => profile.subscriptions.find(channel => channel.id === channelId).feedTypes)
    }, CHANNEL_A)).toEqual([expectedTypes, expectedTypes])

    ;({ page } = await app.relaunch())
    const settings = await goToSettingsSection(page, 'subscription')
    await settings.getByRole('button', { name: 'Subscription settings', exact: true }).click()
    const group = page.getByRole('group', { name: 'Channel A', exact: true })
    await expect(group.getByRole('checkbox', { name: labels[category], exact: true })).toHaveAttribute('aria-checked', 'false')
    await group.getByRole('checkbox', { name: labels[category], exact: true }).click()
    await page.locator('.settingsWindow').getByRole('button', { name: 'Close', exact: true }).click()
    await goTo(page, 'subscriptions')
    await page.locator(`[data-subscription-feed-tab="${category}"]`).click()
    await expect(card(page, category)).toBeVisible()
  })
}

test('hides from a combined New feed section and reports failed writes', async ({ page }) => {
  await goTo(page, 'subscriptions')
  await page.locator('[data-subscription-feed-tab="all"]').click()
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const original = store._actions.updateChannelSettings
    store._actions.updateChannelSettings = [() => {
      store._actions.updateChannelSettings = original
      return Promise.resolve(false)
    }]
  })
  await page.locator('.mediaSection').first().scrollIntoViewIfNeeded()
  const short = card(page, 'shorts')
  await short.getByRole('button', { name: 'More Options', exact: true }).click()
  await page.getByRole('option', { name: 'Never show Shorts from this channel in feeds again', exact: true }).click()
  await expect(page.locator('.toast', { hasText: 'Failed to save channel settings' })).toBeVisible()
  await expect(short).toBeVisible()
  await short.getByRole('button', { name: 'More Options', exact: true }).click()
  await page.getByRole('option', { name: 'Never show Shorts from this channel in feeds again', exact: true }).click()
  await expect(short).toHaveCount(0)
  await expect(card(page, 'videos')).toHaveCount(1)
  await page.locator('[data-subscription-feed-tab="shorts"]').click()
  await expect(card(page, 'shorts')).toHaveCount(0)
})

test('keeps both types hidden when another hide is queued during a save', async ({ page }) => {
  await goTo(page, 'subscriptions')
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const update = store._actions.updateChannelSettings[0]
    let first = true
    store._actions.updateChannelSettings = [async payload => {
      if (first) {
        first = false
        await new Promise(resolve => { window.releaseFirstFeedHide = resolve })
      }
      return update(payload)
    }]
  })
  for (const category of ['videos', 'shorts']) {
    await page.locator(`[data-subscription-feed-tab="${category}"]`).click()
    await card(page, category).getByRole('button', { name: 'More Options', exact: true }).click()
    await page.getByRole('option', { name: `Never show ${labels[category]} from this channel in feeds again`, exact: true }).click()
  }
  await page.evaluate(() => window.releaseFirstFeedHide())
  await expect.poll(() => page.evaluate(channelId => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return store.getters.getSubscribedChannelsById.get(channelId).feedTypes
  }, CHANNEL_A)).toEqual(['live', 'posts'])
  await expect(card(page, 'shorts')).toHaveCount(0)
  await page.locator('[data-subscription-feed-tab="videos"]').click()
  await expect(card(page, 'videos')).toHaveCount(0)
})

for (const locale of ['en-US', 'de-DE']) {
  test.describe(`${locale} menu labels`, () => {
    test.use({ seed: { ...seed, settings: { ...seed.settings, currentLocale: locale } } })
    for (const uiScale of [100, 125]) {
      test(`shows readable hide action labels at ${uiScale}% UI scale`, async ({ app, page }) => {
        await page.evaluate(scale => window.ftElectron.setZoomFactor(scale / 100), uiScale)
        await goTo(page, 'subscriptions')
        for (const width of [1600, 375]) {
          await app.electronApp.evaluate(({ BrowserWindow }, width) => {
            BrowserWindow.getAllWindows()[0].setContentSize(width, 900)
          }, width)
          for (const category of ['videos', 'posts']) {
            await page.locator(`[data-subscription-feed-tab="${category}"]`).click()
            await card(page, category).getByRole('button', {
              name: locale === 'en-US' ? 'More Options' : 'Weitere Optionen', exact: true
            }).click()
            const type = locale === 'de-DE' && category === 'posts' ? 'Beiträge' : labels[category]
            const label = page.getByRole('option', {
              name: locale === 'en-US'
                ? `Never show ${type} from this channel in feeds again`
                : `Nie wieder ${type} von diesem Kanal in Feeds anzeigen`,
              exact: true
            }).locator(':scope > span')
            await expect(label).toBeVisible()
            await expect.poll(() => label.evaluate(element => (
              element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight
            ))).toBe(true)
            // Wrapping must preserve whole words, not squeeze the label into a
            // character-wide column that still passes the overflow check above.
            const splitWords = await label.evaluate(element => {
              const text = element.firstChild
              return [...text.textContent.matchAll(/\S+/g)].filter(match => {
                const range = document.createRange()
                range.setStart(text, match.index)
                range.setEnd(text, match.index + match[0].length)
                return range.getClientRects().length > 1
              }).map(match => match[0])
            })
            expect(splitWords).toEqual([])
            await page.keyboard.press('Escape')
          }
        }
      })
    }
  })
}
