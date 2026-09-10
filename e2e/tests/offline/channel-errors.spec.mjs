import { test, expect, sel } from '../../helpers/app.mjs'

const CACHED_CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const UNKNOWN_CHANNEL_ID = 'UCbbbbbbbbbbbbbbbbbbbbbb'

test.use({
  seed: {
    settings: {
      backendPreference: 'invidious',
      defaultInvidiousInstance: 'https://invidious.test'
    },
    profiles: [{
      _id: 'allChannels',
      name: 'All Channels',
      bgColor: '#000000',
      textColor: '#FFFFFF',
      subscriptions: [{
        id: CACHED_CHANNEL_ID,
        name: 'Deleted Channel',
        thumbnail: 'data:image/png;base64,invalid'
      }]
    }]
  }
})

async function openChannelTab(page, channelId) {
  const tab = await page.evaluate((id) => window.ftElectron.tabs.create({
    route: `/channel/${id}`,
    makeActive: false
  }), channelId)
  await page.locator(`.tab[data-tab-id="${tab.id}"]`).click()
}

test('keeps subscription options inside the channel page viewport without horizontal overflow', async ({ page }) => {
  await page.route('https://invidious.test/api/v1/channels/**', route => route.fulfill({
    json: { error: 'This channel is unavailable' }
  }))
  await openChannelTab(page, CACHED_CHANNEL_ID)

  const channel = page.locator('.channelDetails:visible')
  await channel.locator('.buttonList').evaluate(element => {
    element.dataset.subscriptionOptionsTrigger = ''
  })
  const scrollWidthBefore = await page.evaluate(() => document.documentElement.scrollWidth)
  await channel.getByRole('button', { name: 'Subscription settings' }).click()

  const dropdown = page.locator('body > .profileDropdown')
  await expect(dropdown).toBeVisible()
  await expect(dropdown).not.toHaveClass(/profile-dropdown-enter-active/)
  expect(await dropdown.evaluate((element, { initialScrollWidth, triggerSelector }) => {
    const rect = element.getBoundingClientRect()
    const triggerRect = document.querySelector(triggerSelector).getBoundingClientRect()
    return {
      anchoredInlineEnd: Math.abs(rect.right - triggerRect.right) <= 1,
      anchoredVertically: Math.abs(rect.top - triggerRect.bottom - 4) <= 1,
      leftFits: rect.left >= 7.5,
      rightFits: rect.right <= window.innerWidth - 7.5,
      scrollWidthUnchanged: document.documentElement.scrollWidth === initialScrollWidth
    }
  }, {
    initialScrollWidth: scrollWidthBefore,
    triggerSelector: '[data-subscription-options-trigger]'
  })).toEqual({
    anchoredInlineEnd: true,
    anchoredVertically: true,
    leftFits: true,
    rightFits: true,
    scrollWidthUnchanged: true
  })

  await channel.locator('.buttonList').evaluate(element => {
    element.style.transform = 'translateX(-80px)'
  })
  await expect.poll(() => dropdown.evaluate((element, triggerSelector) => {
    const rect = element.getBoundingClientRect()
    const triggerRect = document.querySelector(triggerSelector).getBoundingClientRect()
    return Math.abs(rect.right - triggerRect.right)
  }, '[data-subscription-options-trigger]')).toBeLessThanOrEqual(1)
})

test('shows fallback metadata for unavailable channels', async ({ page }) => {
  await page.route('https://invidious.test/api/v1/channels/**', route => route.fulfill({
    json: { error: 'This channel is unavailable' }
  }))

  // Pause before opening the tab so no screenshot can replace its fallback icon.
  await page.evaluate(() => window.ftElectron.tabs.setPreviewCapturePaused(true))
  try {
    await openChannelTab(page, CACHED_CHANNEL_ID)

    const cachedChannel = page.locator('.channelDetails:visible')
    await expect(cachedChannel.locator('.name')).toHaveText('Deleted Channel')
    await expect(cachedChannel.locator('img.thumbnail')).toHaveCount(0)
    const fallbackAvatar = cachedChannel.locator('.thumbnail:not(img)')
    await expect(fallbackAvatar).toBeVisible()
    await expect(fallbackAvatar).toHaveCSS('font-size', '100px')

    const cachedChannelTab = page.locator(sel.activeTab)
    await expect(cachedChannelTab.locator('.tabAvatar')).toHaveCount(0)
    await expect(cachedChannelTab.locator('.tabPageIcon'))
      .toHaveAttribute('data-icon', 'circle-user')

    await cachedChannel.hover()
    await cachedChannelTab.hover()
    const tooltipPreview = page.locator('.tabTooltipPreview')
    await expect(tooltipPreview).toBeVisible()
    await expect(tooltipPreview.locator('.tabTooltipPreviewAvatar')).toHaveCount(0)
    await expect(tooltipPreview.locator('.tabTooltipFallbackIcon'))
      .toHaveAttribute('data-icon', 'circle-user')

    await page.keyboard.down('Control')
    try {
      await page.keyboard.press('Tab')
      const switcherItem = page.locator('.tabSwitcherItem', { hasText: 'Deleted Channel' })
      await expect(switcherItem).toBeVisible()
      const switcherTitleAvatar = switcherItem.locator('.tabSwitcherTitleAvatar')
      const switcherTitleIcon = switcherItem.locator('.tabSwitcherTitleIcon')
      await expect(switcherTitleAvatar.or(switcherTitleIcon)).toHaveCount(1)
      if (await switcherTitleAvatar.count() > 0) {
        await switcherTitleAvatar.dispatchEvent('error')
      }
      await expect(switcherItem.locator('.tabSwitcherTitleIcon'))
        .toHaveAttribute('data-icon', 'circle-user')
    } finally {
      await page.keyboard.up('Control')
    }
  } finally {
    await page.evaluate(() => window.ftElectron.tabs.setPreviewCapturePaused(false))
  }

  await openChannelTab(page, UNKNOWN_CHANNEL_ID)

  const unknownChannel = page.locator('.channelDetails:visible')
  await expect(unknownChannel.locator('.name')).toHaveText('Channel name unavailable')
  await expect(page.locator(sel.activeTab)).toContainText('Channel name unavailable')

  await page.evaluate(() => {
    const app = document.querySelector('#app').__vue_app__
    const i18n = app._context.provides[app.__VUE_I18N_SYMBOL__].global
    i18n.setLocaleMessage('e2e', {
      Channel: { 'Channel Name Unavailable': 'Localized unavailable name' }
    })
    i18n.locale.value = 'e2e'
  })

  await expect(unknownChannel.locator('.name')).toHaveText('Localized unavailable name')
  await expect(page.locator(sel.activeTab)).toContainText('Localized unavailable name')
})
