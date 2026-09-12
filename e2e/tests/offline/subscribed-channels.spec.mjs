import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, goTo } from '../../helpers/app.mjs'

test.use({
  seed: {
    settings: {
      unsubscriptionPopupStatus: true
    },
    profiles: [
      {
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [
          { id: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'Alpha Channel', thumbnail: '' },
          { id: 'UCbbbbbbbbbbbbbbbbbbbbbb', name: 'Beta Channel', thumbnail: '' }
        ]
      },
      ...Array.from({ length: 6 }, (_, index) => ({
        _id: `profile-${index}`,
        name: `Profile ${index}`,
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: index === 0
          ? [{ id: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'Alpha Channel', thumbnail: '' }]
          : []
      }))
    ]
  }
})

test.describe('subscribed channels', () => {
  test('lists seeded subscriptions and filters them', async ({ page }) => {
    await goTo(page, 'subscribedchannels')

    await expect(page.getByText('2 channel(s) found.')).toBeVisible()
    await expect(page.locator('.channel', { hasText: 'Alpha Channel' })).toBeVisible()
    await expect(page.locator('.channel', { hasText: 'Beta Channel' })).toBeVisible()

    await page.getByPlaceholder('Search Channels').fill('Beta')
    await expect(page.locator('.channel', { hasText: 'Beta Channel' })).toBeVisible()
    await expect(page.locator('.channel', { hasText: 'Alpha Channel' })).toBeHidden()
  })

  test('uses the default avatar when a channel thumbnail fails to load', async ({ page }) => {
    await goTo(page, 'subscribedchannels')

    const alpha = page.locator('.channel', { hasText: 'Alpha Channel' })
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.dispatch('updateSubscriptionDetails', {
        channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa',
        channelName: 'Alpha Channel',
        channelThumbnailUrl: 'data:image/png;base64,invalid'
      })
    })

    await expect(alpha.locator('img.channelThumbnail')).toHaveCount(0)
    const fallbackAvatar = alpha.locator('.channelThumbnail:not(img)')
    await expect(fallbackAvatar).toBeVisible()
    await expect(fallbackAvatar).toHaveCSS('inline-size', '120px')
    await expect(fallbackAvatar).toHaveCSS('block-size', '120px')
    await expect(fallbackAvatar).toHaveCSS('font-size', '120px')
  })

  test('profile dropdown uses an overlay scrollbar', async ({ page }) => {
    await goTo(page, 'subscribedchannels')
    await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))

    const alpha = page.locator('.channel', { hasText: 'Alpha Channel' })
    await alpha.locator('.profileDropdownToggle').click()

    const dropdown = page.locator('.profileDropdown')
    const scroller = dropdown.locator('.profileDropdownScroller')
    await expect(scroller).toHaveAttribute('data-overlayscrollbars-viewport')
    expect(await scroller.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)

    await alpha.locator('.profileDropdownToggle').click()
    for (const direction of ['ltr', 'rtl']) {
      await page.evaluate(value => { document.body.dir = value }, direction)
      await alpha.locator('.profileDropdownToggle').click()

      const [triggerBox, dropdownBox] = await Promise.all([
        alpha.locator('.buttonList').boundingBox(),
        dropdown.boundingBox()
      ])
      const anchoredEdgeDifference = direction === 'rtl'
        ? Math.abs(triggerBox.x - dropdownBox.x)
        : Math.abs(triggerBox.x + triggerBox.width - dropdownBox.x - dropdownBox.width)
      expect(anchoredEdgeDifference).toBeLessThanOrEqual(1)

      const scrollWidthBefore = await page.evaluate(() => document.documentElement.scrollWidth)
      await dropdown.getByRole('combobox', { name: 'Videos per day' }).click()
      const selectDropdown = page.getByRole('listbox', { name: 'Videos per day' })
      await expect(selectDropdown).toBeVisible()
      expect(await selectDropdown.evaluate((element, popover) => {
        const rect = element.getBoundingClientRect()
        return {
          abovePopover: Number(getComputedStyle(element).zIndex) >
            Number(getComputedStyle(popover).zIndex),
          fitsViewport: rect.left >= 7.5 && rect.right <= window.innerWidth - 7.5,
          noHorizontalOverflow: document.documentElement.scrollWidth === document.documentElement.clientWidth
        }
      }, await dropdown.elementHandle())).toEqual({
        abovePopover: true,
        fitsViewport: true,
        noHorizontalOverflow: true
      })
      expect(await page.evaluate(width => document.documentElement.scrollWidth === width, scrollWidthBefore)).toBe(true)
      await page.getByRole('option', { name: 'Use global setting' }).click()

      await alpha.locator('.profileDropdownToggle').click()
    }
  })

  test('focuses the profile dropdown and restores focus after Escape', async ({ page }) => {
    await goTo(page, 'subscribedchannels')

    const alpha = page.locator('.channel', { hasText: 'Alpha Channel' })
    const toggle = alpha.getByRole('button', { name: 'Subscription settings' })
    await toggle.click()

    const dropdown = page.locator('.profileDropdown')
    await expect(dropdown).toBeFocused()

    await page.keyboard.press('Escape')

    await expect(dropdown).toBeHidden()
    await expect(toggle).toBeFocused()
  })

  test('keeps the profile dropdown inside the viewport near a window edge', async ({ page }) => {
    await goTo(page, 'subscribedchannels')
    await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))

    const alpha = page.locator('.channel', { hasText: 'Alpha Channel' })
    await alpha.locator('.ftSubscribeButton').evaluate((element) => {
      const channel = element.closest('.channel')
      channel.style.position = 'relative'
      const channelRect = channel.getBoundingClientRect()
      const rect = element.getBoundingClientRect()
      Object.assign(element.style, {
        left: `${window.innerWidth - channelRect.left - rect.width}px`,
        position: 'absolute',
        top: '0'
      })
    })
    await page.evaluate(() => {
      window.__profileDropdownBaselineScrollWidth = document.documentElement.scrollWidth
      window.__profileDropdownFrames = []
      window.__profileDropdownFramesComplete = new Promise((resolve) => {
        const observer = new MutationObserver(() => {
          const dropdown = document.querySelector('.profileDropdown')
          if (dropdown === null) return
          observer.disconnect()

          let framesRemaining = 12
          const sample = () => {
            const rect = dropdown.getBoundingClientRect()
            window.__profileDropdownFrames.push({
              left: rect.left,
              right: rect.right,
              visibility: getComputedStyle(dropdown).visibility
            })

            if (--framesRemaining === 0) {
              resolve()
            } else {
              requestAnimationFrame(sample)
            }
          }
          requestAnimationFrame(sample)
        })
        observer.observe(document.body, { childList: true, subtree: true })
      })
    })
    await alpha.locator('.profileDropdownToggle').click()
    await page.evaluate(() => window.__profileDropdownFramesComplete)

    const dropdown = page.locator('.profileDropdown')
    await expect(dropdown).toBeVisible()
    expect(await page.evaluate(() => ({
      framesFit: window.__profileDropdownFrames.every(frame => (
        frame.visibility === 'hidden' ||
        (frame.left >= 7.5 && frame.right <= window.innerWidth - 7.5)
      )),
      scrollWidthUnchanged: document.documentElement.scrollWidth ===
        window.__profileDropdownBaselineScrollWidth
    }))).toEqual({ framesFit: true, scrollWidthUnchanged: true })
  })

  test('keeps feed options fixed and clamps the profile list after it shortens', async ({ page }) => {
    await goTo(page, 'subscribedchannels')

    const alpha = page.locator('.channel', { hasText: 'Alpha Channel' })
    await alpha.locator('.profileDropdownToggle').click()

    const dropdown = page.locator('.profileDropdown')
    const scroller = dropdown.locator('.profileDropdownScroller')
    const scrollbar = scroller.locator(':scope > .os-scrollbar-vertical')
    await expect(dropdown.getByText('Show in subscription feed', { exact: true })).toBeVisible()
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      for (const profileId of ['profile-1', 'profile-2', 'profile-3', 'profile-4', 'profile-5']) {
        store.commit('removeProfileFromList', profileId)
      }
    })

    await expect(dropdown.getByText('Show in subscription feed', { exact: true })).toBeVisible()
    await expect(dropdown.getByRole('checkbox')).toHaveCount(6)
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
    await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
  })

  test('edits and persists the subscription settings for a channel', async ({ app, page }) => {
    await goTo(page, 'subscribedchannels')

    const alpha = page.locator('.channel', { hasText: 'Alpha Channel' })
    await alpha.getByRole('button', { name: 'Subscription settings' }).click()

    const dropdown = page.locator('.profileDropdown')
    await expect(dropdown.getByText('Show in subscription feed', { exact: true })).toBeVisible()

    const videos = dropdown.getByRole('checkbox', { name: 'Videos', exact: true })
    const shorts = dropdown.getByRole('checkbox', { name: 'Shorts', exact: true })
    const live = dropdown.getByRole('checkbox', { name: 'Live', exact: true })
    const posts = dropdown.getByRole('checkbox', { name: 'Posts', exact: true })
    await expect(videos).toBeChecked()
    await expect(shorts).toBeChecked()
    await expect(live).toBeChecked()
    await expect(posts).toBeChecked()
    const dailyVideoLimit = dropdown.getByRole('combobox', { name: 'Videos per day' })
    await expect(dailyVideoLimit).toHaveText('Use global setting')

    await shorts.click()
    await live.click()
    await posts.click()
    await dailyVideoLimit.click()
    await page.getByRole('option', { name: '1', exact: true }).click()
    await expect(shorts).not.toBeChecked()
    await expect(live).not.toBeChecked()
    await expect(posts).not.toBeChecked()
    await dropdown.getByRole('checkbox', { name: 'Profile 1', exact: true }).click()

    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
      const records = contents.trim().split('\n').map((line) => JSON.parse(line))
      const latestProfiles = new Map(records.map(record => [record._id, record]))
      return ['allChannels', 'profile-0', 'profile-1'].map(profileId => {
        const subscription = latestProfiles.get(profileId).subscriptions
          .find(channel => channel.id === 'UCaaaaaaaaaaaaaaaaaaaaaa')
        return {
          dailyVideoLimit: subscription.dailyVideoLimit,
          feedTypes: subscription.feedTypes
        }
      })
    }).toEqual([
      { dailyVideoLimit: 1, feedTypes: ['videos'] },
      { dailyVideoLimit: 1, feedTypes: ['videos'] },
      { dailyVideoLimit: 1, feedTypes: ['videos'] }
    ])

    ;({ page } = await app.relaunch())
    await goTo(page, 'subscribedchannels')

    const relaunchedAlpha = page.locator('.channel', { hasText: 'Alpha Channel' })
    await relaunchedAlpha.getByRole('button', { name: 'Subscription settings' }).click()
    const relaunchedDropdown = page.locator('.profileDropdown')
    await expect(relaunchedDropdown.getByRole('checkbox', { name: 'Videos', exact: true })).toBeChecked()
    await expect(relaunchedDropdown.getByRole('checkbox', { name: 'Shorts', exact: true })).not.toBeChecked()
    await expect(relaunchedDropdown.getByRole('checkbox', { name: 'Live', exact: true })).not.toBeChecked()
    await expect(relaunchedDropdown.getByRole('checkbox', { name: 'Posts', exact: true })).not.toBeChecked()
    await expect(relaunchedDropdown.getByRole('combobox', { name: 'Videos per day' })).toHaveText('1')
  })

  test('unsubscribing asks for confirmation and persists', async ({ app, page }) => {
    await goTo(page, 'subscribedchannels')

    const alpha = page.locator('.channel', { hasText: 'Alpha Channel' })
    await alpha.getByRole('button', { name: 'Unsubscribe' }).click()

    await expect(page.getByRole('dialog', { name: /unsubscribe from.*Alpha Channel/i })).toBeVisible()
    await page.getByRole('button', { name: 'Yes', exact: true }).click()

    await expect(alpha).toHaveCount(0)
    await expect(page.getByText('1 channel(s) found.')).toBeVisible()

    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
      const records = contents.trim().split('\n').map((line) => JSON.parse(line))
      const main = records.filter((record) => record._id === 'allChannels').at(-1)
      return main.subscriptions.map((channel) => channel.name)
    }).toEqual(['Beta Channel'])

    ;({ page } = await app.relaunch())
    await goTo(page, 'subscribedchannels')
    await expect(page.getByText('1 channel(s) found.')).toBeVisible()
    await expect(page.locator('.channel', { hasText: 'Beta Channel' })).toBeVisible()
    await expect(page.locator('.channel', { hasText: 'Alpha Channel' })).toHaveCount(0)
  })
})

test.describe('large subscribed channel lists', () => {
  test.use({
    seed: {
      settings: {
        generalAutoLoadMorePaginatedItemsEnabled: false
      },
      profiles: [
        {
          _id: 'allChannels',
          name: 'All Channels',
          bgColor: '#000000',
          textColor: '#FFFFFF',
          subscriptions: Array.from({ length: 900 }, (_, index) => ({
            id: `UC${index.toString().padStart(22, '0')}`,
            name: `Channel ${index.toString().padStart(3, '0')}`,
            thumbnail: ''
          }))
        }
      ]
    }
  })

  test('renders large lists incrementally while keeping every channel searchable', async ({ page }) => {
    await goTo(page, 'subscribedchannels')

    await expect(page.getByText('900 channel(s) found.')).toBeVisible()
    await expect(page.locator('.channel')).toHaveCount(50)
    await expect(page.locator('.navChannel')).toHaveCount(50)

    await page.locator('.sideNav .inner').evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await expect(page.locator('.navChannel')).toHaveCount(100)

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('removeChannelFromProfiles', {
        channelId: 'UC0000000000000000000000',
        profileIds: ['allChannels']
      })
    })
    await expect(page.locator('.navChannel')).toHaveCount(50)

    await page.getByPlaceholder('Search Channels').fill('Channel 899')
    expect(await page.locator('.count').textContent()).toContain('1 channel(s) found.')
    await expect(page.locator('.channel', { hasText: 'Channel 899' })).toBeVisible()

    await page.getByPlaceholder('Search Channels').fill('')
    await page.getByRole('button', { name: 'Load more channels' }).click()
    await expect(page.locator('.channel')).toHaveCount(100)
  })

  test('uses the first repeated channel search query value', async ({ page }) => {
    const channelTab = await page.evaluate(() => window.ftElectron.tabs.create({
      route: '/subscribedchannels?searchQueryText=Channel%20899&searchQueryText=Channel%20898',
      makeActive: false
    }))
    await page.locator(`.tab[data-tab-id="${channelTab.id}"]`).click()

    await expect(page.getByPlaceholder('Search Channels')).toHaveValue('Channel 899')
    await expect(page.locator('.count')).toContainText('1 channel(s) found.')
    await expect(page.locator('.channel', { hasText: 'Channel 899' })).toBeVisible()
  })
})

test.describe('subscribed channel pagination', () => {
  const subscriptions = Array.from({ length: 123 }, (_, index) => ({
    id: `UC${String(index).padStart(22, '0')}`,
    name: `Channel ${String(index).padStart(3, '0')}`,
    thumbnail: ''
  }))
  test.use({
    seed: {
      settings: {
        currentLocale: 'en-GB',
        fetchSubscriptionsAutomatically: false,
        generalAutoLoadMorePaginatedItemsEnabled: false
      },
      profiles: [{ _id: 'allChannels', name: 'All Channels', subscriptions }]
    }
  })

  test('keeps earlier pages when loading more and resets the limit after searching', async ({ page }) => {
    await goTo(page, 'subscribedchannels')
    const channels = page.locator('.channel')
    const loadMore = page.getByRole('button', { name: 'Load more channels', exact: true })
    await expect(channels).toHaveCount(50)
    await loadMore.click()
    await expect(channels).toHaveCount(100)
    await expect(channels.first()).toContainText('Channel 000')
    await loadMore.click()
    await expect(channels).toHaveCount(123)
    await expect(loadMore).toHaveCount(0)

    const search = page.getByPlaceholder('Search Channels')
    await search.fill('Channel 11')
    await expect(channels).toHaveCount(10)
    await expect(channels.first()).toContainText('Channel 110')
    await search.fill('')
    await expect(channels).toHaveCount(50)
    await expect(loadMore).toBeVisible()
  })
})
