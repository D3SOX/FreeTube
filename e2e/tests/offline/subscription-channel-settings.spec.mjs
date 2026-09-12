import { readFile } from 'node:fs/promises'
import path from 'node:path'

import {
  test,
  expect,
  expectScrollAtRenderedEnd,
  goTo,
  goToSettingsSection,
  setWindowSize
} from '../../helpers/app.mjs'

const CHANNEL_ID = `UC${'0'.repeat(22)}`
const subscriptions = Array.from({ length: 18 }, (_, index) => ({
  id: `UC${String(index).padStart(22, '0')}`,
  name: index === 0 ? 'Alpha Channel' : `Channel ${String(index).padStart(2, '0')}`,
  thumbnail: '',
  ...(index === 0 ? { feedTypes: ['videos'] } : {}),
  ...(index === 1 ? { dailyVideoLimit: 1, showMembersOnly: true } : {})
}))

test.use({
  seed: {
    settings: {
      currentLocale: 'en-US',
      uiScale: 125,
      ytDlpPlaybackAuthMode: 'browser',
      ytDlpPlaybackCookiesBrowser: 'firefox'
    },
    profiles: [
      {
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions
      },
      {
        _id: 'profile-1',
        name: 'Profile 1',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [subscriptions[0]]
      }
    ]
  }
})

test('keeps the popover and Subscription Settings manager in sync', async ({ app, page }) => {
  const subscriptionSettings = await goToSettingsSection(page, 'subscription')
  await subscriptionSettings.getByRole('button', { name: 'Subscription settings', exact: true }).click()
  await expect.poll(() => page.evaluate(() => {
    const scroller = document.querySelector('.channelSettingsScroller')
    return Math.max(
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
      scroller.scrollWidth - scroller.clientWidth
    )
  })).toBeLessThanOrEqual(1)

  const alphaSettings = page.getByRole('group', { name: 'Alpha Channel' })
  const videos = alphaSettings.getByRole('checkbox', { name: 'Videos' })
  const shorts = alphaSettings.getByRole('checkbox', { name: 'Shorts' })
  await expect(videos).toHaveAttribute('aria-checked', 'true')
  await expect(shorts).toHaveAttribute('aria-checked', 'false')
  await shorts.click()
  await videos.click()
  const membersOnly = alphaSettings.getByRole('checkbox', { name: 'Members only' })
  await expect(membersOnly).not.toBeChecked()
  await alphaSettings.locator('label', { hasText: 'Members only' }).click()
  await expect(membersOnly).toBeChecked()

  const alphaLimit = alphaSettings
    .getByRole('combobox', { name: 'Videos per day' })
  await expect(alphaLimit).toHaveText('Use global setting')
  await alphaLimit.click()
  await page.getByRole('option', { name: '2', exact: true }).click()

  await expect.poll(async () => {
    const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
    const records = contents.trim().split('\n').map(line => JSON.parse(line))
    const latestProfiles = new Map(records.map(record => [record._id, record]))
    return ['allChannels', 'profile-1'].map(profileId => {
      const channel = latestProfiles.get(profileId).subscriptions
        .find(subscription => subscription.id === CHANNEL_ID)
      return {
        dailyVideoLimit: channel.dailyVideoLimit,
        feedTypes: channel.feedTypes,
        showMembersOnly: channel.showMembersOnly
      }
    })
  }).toEqual([
    { dailyVideoLimit: 2, feedTypes: ['shorts'], showMembersOnly: true },
    { dailyVideoLimit: 2, feedTypes: ['shorts'], showMembersOnly: true }
  ])

  ;({ page } = await app.relaunch())
  await goTo(page, 'subscribedchannels')
  const alpha = page.locator('.channel', { hasText: 'Alpha Channel' })
  await alpha.getByRole('button', { name: 'Subscription settings' }).click()
  const popover = page.locator('.profileDropdown')
  await expect(popover).toHaveClass(/profileDropdownPositioned/)
  await expect.poll(() => page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ))).toBeLessThanOrEqual(1)
  const [popoverBounds, viewport] = await Promise.all([
    popover.boundingBox(),
    page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  ])
  expect(popoverBounds.x).toBeGreaterThanOrEqual(0)
  expect(popoverBounds.y).toBeGreaterThanOrEqual(0)
  expect(popoverBounds.x + popoverBounds.width).toBeLessThanOrEqual(viewport.width + 1)
  expect(popoverBounds.y + popoverBounds.height).toBeLessThanOrEqual(viewport.height + 1)
  const popoverScroller = popover.locator('.profileDropdownScroller')
  await expect(popoverScroller).toHaveAttribute('data-overlayscrollbars-viewport')
  await expect(popoverScroller.locator(':scope > .os-scrollbar-vertical'))
    .toHaveClass(/os-scrollbar-unusable/)
  const popoverVideos = popover.getByRole('checkbox', { name: 'Videos' })
  const popoverShorts = popover.getByRole('checkbox', { name: 'Shorts' })
  await expect.poll(async () => {
    const [videosBounds, shortsBounds] = await Promise.all([
      popoverVideos.boundingBox(),
      popoverShorts.boundingBox()
    ])
    return Math.abs(videosBounds.y - shortsBounds.y) <= 1 &&
      shortsBounds.x > videosBounds.x
  }).toBe(true)
  await expect(popoverVideos)
    .toHaveAttribute('aria-checked', 'false')
  await expect(popoverShorts)
    .toHaveAttribute('aria-checked', 'true')
  const popoverMembersOnly = popover.getByRole('checkbox', { name: 'Members only' })
  await expect(popoverMembersOnly).toHaveAttribute('aria-checked', 'true')
  await popoverMembersOnly.click()
  await expect(popoverMembersOnly).toHaveAttribute('aria-checked', 'false')
  await popover.getByRole('checkbox', { name: 'Live' }).click()
  const popoverLimit = page.locator('.profileDropdown')
    .getByRole('combobox', { name: 'Videos per day' })
  await expect(popoverLimit).toHaveText('2')

  await popoverLimit.click()
  await page.getByRole('option', { name: 'Unlimited' }).click()
  await expect.poll(async () => {
    const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
    const records = contents.trim().split('\n').map(line => JSON.parse(line))
    const channel = records.filter(record => record._id === 'allChannels').at(-1).subscriptions
      .find(subscription => subscription.id === CHANNEL_ID)
    return {
      dailyVideoLimit: channel.dailyVideoLimit,
      showMembersOnly: channel.showMembersOnly
    }
  }).toEqual({ dailyVideoLimit: null, showMembersOnly: false })

  const reopenedSubscriptionSettings = await goToSettingsSection(page, 'subscription')
  await reopenedSubscriptionSettings
    .getByRole('button', { name: 'Subscription settings', exact: true })
    .click()
  const syncedAlphaSettings = page.getByRole('group', { name: 'Alpha Channel' })
  await expect(syncedAlphaSettings.getByRole('checkbox', { name: 'Live' }))
    .toHaveAttribute('aria-checked', 'true')
  await expect(syncedAlphaSettings.getByRole('checkbox', { name: 'Members only' }))
    .not.toBeChecked()
  await expect(syncedAlphaSettings
    .getByRole('combobox', { name: 'Videos per day' })).toHaveText('Unlimited')
})

test('changes subscription settings for selected channels', async ({ app, attachScreenshot, page }) => {
  const subscriptionSettings = await goToSettingsSection(page, 'subscription')
  await subscriptionSettings.getByRole('button', { name: 'Subscription settings', exact: true }).click()

  const selectionToolbar = page.locator('.channelSelectionToolbar')
  const selectAll = selectionToolbar.getByRole('button', { name: 'Select All' })
  const selectNone = selectionToolbar.getByRole('button', { name: 'Select None' })
  await expect(selectAll.locator('.channelSelectionActionIcon')).toHaveCount(1)
  await expect(selectNone.locator('.channelSelectionActionIcon')).toHaveCount(1)
  for (const button of [selectAll, selectNone]) {
    await expect.poll(() => button.evaluate(element => {
      const label = element.querySelector(':scope > span')
      const icon = element.querySelector(':scope > .channelSelectionActionIcon')
      return label?.getBoundingClientRect().right <= icon?.getBoundingClientRect().left
    })).toBe(true)
  }
  await expect(selectionToolbar).toContainText('0 selected')
  await expect(page.locator('.bulkFeedTypeSettings')).toHaveCount(0)

  await selectAll.click()
  await expect(selectionToolbar).toContainText(`${subscriptions.length} selected`)
  await expect(page.getByRole('checkbox', { name: 'Alpha Channel' }))
    .toHaveAttribute('aria-checked', 'true')
  await selectNone.click()

  await page.getByRole('checkbox', { name: 'Alpha Channel' }).click()
  await page.getByRole('checkbox', { name: 'Channel 01' }).click()
  await expect(selectionToolbar).toContainText('2 selected')

  const bulkSettings = page.locator('.bulkFeedTypeSettings')
  const bulkVideos = bulkSettings.getByRole('checkbox', { name: 'Videos' })
  const bulkShorts = bulkSettings.getByRole('checkbox', { name: 'Shorts' })
  const bulkMembersOnly = bulkSettings.getByRole('checkbox', { name: 'Members only' })
  const bulkDailyLimit = bulkSettings.getByRole('combobox', { name: 'Videos per day' })
  await expect(bulkVideos).toHaveAttribute('aria-checked', 'true')
  await expect(bulkShorts).toHaveAttribute('aria-checked', 'mixed')
  await expect(bulkMembersOnly).toHaveAttribute('aria-checked', 'mixed')
  await expect(bulkDailyLimit).toHaveText('Different values')

  await setWindowSize(app, page, { width: 375, height: 700 })
  await expect.poll(() => page.locator('.settingsContent').evaluate(element => (
    element.scrollWidth - element.clientWidth
  ))).toBeLessThanOrEqual(1)
  await attachScreenshot('compact subscription channel selection controls')
  await bulkDailyLimit.scrollIntoViewIfNeeded()
  await expect(bulkMembersOnly).toBeVisible()
  await expect(bulkDailyLimit).toBeVisible()
  await attachScreenshot('compact subscription channel batch settings')

  await bulkVideos.click()
  await bulkShorts.click()
  await bulkMembersOnly.click()
  await bulkDailyLimit.click()
  await page.getByRole('option', { name: '2', exact: true }).click()
  await expect(bulkVideos).toHaveAttribute('aria-checked', 'false')
  await expect(bulkShorts).toHaveAttribute('aria-checked', 'true')
  await expect(bulkMembersOnly).toHaveAttribute('aria-checked', 'true')
  await expect(bulkDailyLimit).toHaveText('2')

  await expect.poll(async () => {
    const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
    const records = contents.trim().split('\n').map(line => JSON.parse(line))
    const latestProfiles = new Map(records.map(record => [record._id, record]))
    return ['allChannels', 'profile-1'].map(profileId => (
      latestProfiles.get(profileId).subscriptions
        .filter(channel => [subscriptions[0].id, subscriptions[1].id].includes(channel.id))
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(channel => ({
          dailyVideoLimit: channel.dailyVideoLimit,
          feedTypes: channel.feedTypes,
          showMembersOnly: channel.showMembersOnly
        }))
    ))
  }).toEqual([
    [
      { dailyVideoLimit: 2, feedTypes: ['shorts'], showMembersOnly: true },
      { dailyVideoLimit: 2, feedTypes: ['shorts', 'live', 'posts'], showMembersOnly: true }
    ],
    [
      { dailyVideoLimit: 2, feedTypes: ['shorts'], showMembersOnly: true }
    ]
  ])

  const scroller = page.locator('.channelSettingsScroller')
  const scrollbar = scroller.locator(':scope > .os-scrollbar-vertical')
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)

  await selectNone.evaluate(button => button.click())
  await expect(selectionToolbar).toContainText('0 selected')
  await expect(page.locator('.bulkFeedTypeSettings')).toHaveCount(0)
  await expectScrollAtRenderedEnd(scroller)
  await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
})

test('only offers members-only controls when yt-dlp playback cookies are configured', async ({ page }) => {
  const subscriptionSettings = await goToSettingsSection(page, 'subscription')
  await subscriptionSettings.getByRole('button', { name: 'Subscription settings', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Members only' })).toHaveCount(subscriptions.length)
  await page.locator('.channelSelectionToolbar').getByRole('button', { name: 'Select All' }).click()
  await expect(page.getByRole('checkbox', { name: 'Members only' })).toHaveCount(subscriptions.length + 1)

  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateYtDlpPlaybackAuthMode', 'none')
  })

  await expect(page.getByRole('checkbox', { name: 'Members only' })).toHaveCount(0)

  await page.locator('.settingsWindow').getByRole('button', { name: 'Close' }).click()
  await goTo(page, 'subscribedchannels')
  const alpha = page.locator('.channel', { hasText: 'Alpha Channel' })
  await alpha.getByRole('button', { name: 'Subscription settings' }).click()
  await expect(page.locator('.profileDropdown')
    .getByRole('checkbox', { name: 'Members only' })).toHaveCount(0)
})

test('reports subscription setting write failures from the channel popover', async ({ page }) => {
  await goTo(page, 'subscribedchannels')
  const alpha = page.locator('.channel', { hasText: 'Alpha Channel' })
  await alpha.getByRole('button', { name: 'Subscription settings' }).click()
  const popover = page.locator('.profileDropdown')
  const shorts = popover.getByRole('checkbox', { name: 'Shorts' })
  await expect(shorts).toHaveAttribute('aria-checked', 'false')

  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store._actions.updateChannelSettings = [() => Promise.resolve(false)]
  })
  await shorts.click()

  await expect(page.locator('.toast', {
    hasText: 'Failed to save channel settings'
  })).toBeVisible()
  await expect(shorts).toHaveAttribute('aria-checked', 'false')
})

test('does not carry a failed popover edit into a later update', async ({ app, page }) => {
  await goTo(page, 'subscribedchannels')
  const alpha = page.locator('.channel', { hasText: 'Alpha Channel' })
  await alpha.getByRole('button', { name: 'Subscription settings' }).click()
  const popover = page.locator('.profileDropdown')

  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const updateChannelSettings = store._actions.updateChannelSettings[0]
    let updateCount = 0
    store._actions.updateChannelSettings = [payload => {
      updateCount++
      if (updateCount === 1) {
        return new Promise(resolve => {
          window.resolveFirstChannelSettingsWrite = () => resolve(false)
        })
      }
      return updateChannelSettings(payload)
    }]
    window.channelSettingsUpdateCount = () => updateCount
  })

  await popover.getByRole('checkbox', { name: 'Members only' }).click()
  await expect.poll(() => page.evaluate(() => window.channelSettingsUpdateCount())).toBe(1)

  const limit = popover.getByRole('combobox', { name: 'Videos per day' })
  await limit.click()
  await page.getByRole('option', { name: '2', exact: true }).click()
  await page.evaluate(() => window.resolveFirstChannelSettingsWrite())

  await expect.poll(async () => {
    const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
    const records = contents.trim().split('\n').map(line => JSON.parse(line))
    const channel = records.filter(record => record._id === 'allChannels').at(-1).subscriptions
      .find(subscription => subscription.id === CHANNEL_ID)
    return {
      dailyVideoLimit: channel.dailyVideoLimit,
      showMembersOnly: channel.showMembersOnly ?? false
    }
  }).toEqual({ dailyVideoLimit: 2, showMembersOnly: false })
  await expect(page.locator('.toast', {
    hasText: 'Failed to save channel settings'
  })).toBeVisible()
})

test('reports subscription setting write failures from the settings manager', async ({ page }) => {
  const subscriptionSettings = await goToSettingsSection(page, 'subscription')
  await subscriptionSettings.getByRole('button', { name: 'Subscription settings', exact: true }).click()
  const alphaSettings = page.getByRole('group', { name: 'Alpha Channel' })
  const shorts = alphaSettings.getByRole('checkbox', { name: 'Shorts' })
  await expect(shorts).toHaveAttribute('aria-checked', 'false')

  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store._actions.updateChannelSettings = [() => Promise.resolve(false)]
  })
  await shorts.click()

  await expect(page.locator('.toast', {
    hasText: 'Failed to save channel settings'
  })).toBeVisible()
  await expect(shorts).toHaveAttribute('aria-checked', 'false')
})

test('reports one failure toast for a failed batch update', async ({ page }) => {
  const subscriptionSettings = await goToSettingsSection(page, 'subscription')
  await subscriptionSettings.getByRole('button', { name: 'Subscription settings', exact: true }).click()

  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    let updateCount = 0
    store._actions.updateChannelSettings = [() => {
      updateCount += 1
      return Promise.resolve(false)
    }]
    window.channelSettingsUpdateCount = () => updateCount
  })

  const selectionToolbar = page.locator('.channelSelectionToolbar')
  await selectionToolbar.getByRole('button', { name: 'Select All' }).click()
  await page.locator('.bulkFeedTypeSettings')
    .getByRole('checkbox', { name: 'Videos' })
    .click()

  await expect.poll(() => page.evaluate(() => window.channelSettingsUpdateCount()))
    .toBe(subscriptions.length)
  await expect(page.locator('.toast', {
    hasText: 'Failed to save channel settings'
  })).toHaveCount(1)
})

test('reports a partial write when a requested profile no longer exists', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.state.profiles.profileList.push({
      _id: 'removed-profile',
      name: 'Removed profile',
      bgColor: '#000000',
      textColor: '#FFFFFF',
      subscriptions: [{
        id: 'UC0000000000000000000000',
        name: 'Alpha Channel',
        thumbnail: '',
        feedTypes: ['videos']
      }]
    })

    const saved = await store.dispatch('updateChannelSettings', {
      channelId: 'UC0000000000000000000000',
      settings: { feedTypes: ['shorts'] }
    })

    return {
      saved,
      feedTypesByProfile: Object.fromEntries(store.getters.getProfileList.map(profile => [
        profile._id,
        profile.subscriptions.find(channel => channel.id === 'UC0000000000000000000000')
          ?.feedTypes
      ]))
    }
  })

  expect(result).toEqual({
    saved: false,
    feedTypesByProfile: {
      allChannels: ['shorts'],
      'profile-1': ['shorts'],
      'removed-profile': ['videos']
    }
  })
})

test('clamps the channel list after searching', async ({ page }) => {
  const subscriptionSettings = await goToSettingsSection(page, 'subscription')
  await subscriptionSettings.getByRole('button', { name: 'Subscription settings', exact: true }).click()

  const scroller = page.locator('.channelSettingsScroller')
  const scrollbar = scroller.locator(':scope > .os-scrollbar-vertical')
  await expect(scroller).toHaveAttribute('data-overlayscrollbars-viewport')
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)

  await page.getByPlaceholder('Search channels').fill('Alpha Channel')
  await expect(page.locator('.channelSettings')).toHaveCount(1)
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
  await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
})

test('records edit times per channel and does not retimestamp received settings', async ({ page }) => {
  const result = await page.evaluate(async (channelId) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const secondChannelId = store.state.profiles.profileList[0].subscriptions[1].id
    const timestamps = () => ({ ...store.state.settings.syncServerSettingUpdatedAt.subscriptionChannelSettings })
    await store.dispatch('updateChannelSettings', { channelId, settings: { dailyVideoLimit: 2 } })
    const firstEdit = timestamps()
    await store.dispatch('updateChannelSettings', { channelId: secondChannelId, settings: { dailyVideoLimit: 3 } })
    const secondEdit = timestamps()
    await store.dispatch('updateChannelSettings', { channelId, settings: { dailyVideoLimit: 4 }, fromSync: true })
    return { firstEdit, secondEdit, afterSync: timestamps(), secondChannelId }
  }, CHANNEL_ID)
  expect(result.firstEdit[CHANNEL_ID]).toBeGreaterThan(0)
  expect(result.secondEdit[CHANNEL_ID]).toBe(result.firstEdit[CHANNEL_ID])
  expect(result.secondEdit[result.secondChannelId]).toBeGreaterThan(0)
  expect(result.afterSync).toEqual(result.secondEdit)
})
