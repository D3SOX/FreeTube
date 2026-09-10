import { abortUnmockedRequest, test, expect, goTo } from '../../helpers/app.mjs'

const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'

test.use({
  seed: {
    settings: {
      fetchSubscriptionsAutomatically: false,
      hideSubscriptionsVideos: false,
      hideSubscriptionsShorts: false,
      hideSubscriptionsLive: false,
      hideSubscriptionsCommunity: false,
      showNewSubscriptionFeed: true,
      useRssFeeds: false
    },
    profiles: [
      {
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [
          { id: CHANNEL_ID, name: 'Channel A', thumbnail: '' }
        ]
      }
    ]
  }
})

test('subscription tabs expose feed-specific reload actions', async ({ page }) => {
  // HTTP failures finish the refresh; network failures now retry until recovery.
  await page.route(/^https?:\/\//, route => route.fulfill({ status: 404, body: '' }))
  await goTo(page, 'subscriptions')

  await page.evaluate(() => {
    window.__subscriptionFeedReloadRequests = []
    window.__removeSubscriptionFeedReloadListener = window.ftElectron.subscriptionFeeds.onRequestReload((payload) => {
      window.__subscriptionFeedReloadRequests.push(payload)
    })
  })

  const feedTabs = [
    { feedTab: 'videos', label: 'Reload Videos' },
    { feedTab: 'shorts', label: 'Reload Shorts' },
    { feedTab: 'live', label: 'Reload Live' },
    { feedTab: 'posts', label: 'Reload Posts' },
    { feedTab: 'all', label: 'Reload All Feeds' }
  ]

  for (const [index, { feedTab, label }] of feedTabs.entries()) {
    // While a refresh is running the entry cancels it instead of reloading
    await expect(page.locator('.tabLoadingIndicator')).toHaveCount(0, { timeout: 30_000 })

    await page.locator(`[data-subscription-feed-tab="${feedTab}"]`).click({ button: 'right' })
    const menu = page.getByRole('menu', { name: 'Context menu' })
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem', { name: label }).click()

    await expect.poll(async () => {
      return await page.evaluate(() => window.__subscriptionFeedReloadRequests.length)
    }).toBe(index + 1)
  }

  await expect.poll(async () => {
    return await page.evaluate(() => window.__subscriptionFeedReloadRequests)
  }).toEqual(feedTabs.map(({ feedTab }) => expect.objectContaining({
    feedTab,
    tabId: expect.any(String)
  })))

  await page.evaluate(() => window.__removeSubscriptionFeedReloadListener())
})

test('holding a subscription tab opens its mobile bottom menu without selecting it', async ({ page }) => {
  await goTo(page, 'subscriptions')
  const videos = page.locator('[data-subscription-feed-tab="videos"]')
  const shorts = page.locator('[data-subscription-feed-tab="shorts"]')
  await expect(videos).toHaveAttribute('aria-selected', 'true')
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
  const bounds = await shorts.boundingBox()
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }]
  })
  const menu = page.locator('.mobileLinkActions')
  await expect(menu).toBeVisible({ timeout: 3000 })
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(menu.getByRole('menuitem', { name: 'Reload Shorts', exact: true })).toBeVisible()
  await expect(videos).toHaveAttribute('aria-selected', 'true')
  await expect(shorts).toHaveAttribute('aria-selected', 'false')
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await shorts.evaluate(element => element.dispatchEvent(new PointerEvent('contextmenu', {
    bubbles: true, cancelable: true, pointerType: 'touch'
  })))
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    window.__mobileFeedRefreshStarted = false
    store.watch(state => state.subscriptionCache.subscriptionFeedRefreshInProgress, refreshing => {
      if (refreshing) window.__mobileFeedRefreshStarted = true
    })
  })
  await page.route(/^https?:\/\//, abortUnmockedRequest)
  await menu.getByRole('menuitem', { name: 'Reload Shorts', exact: true }).click()
  await expect(menu).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.__mobileFeedRefreshStarted)).toBe(true)
  await session.detach()
})

test('a mobile Cancel Refresh action never reloads after the refresh finishes', async ({ app, page }) => {
  await goTo(page, 'subscriptions')
  await page.route(/^https?:\/\//, abortUnmockedRequest)
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setSubscriptionFeedRefreshInProgress', true)
  })
  await app.electronApp.evaluate(({ ipcMain }) => {
    globalThis.__mobileCancelRequested = false
    ipcMain.on('subscription-auto-refresh-cancel', () => {
      globalThis.__mobileCancelRequested = true
    })
  })
  await page.locator('[data-subscription-feed-tab="shorts"]').evaluate(element => {
    element.dispatchEvent(new PointerEvent('contextmenu', {
      bubbles: true, cancelable: true, pointerType: 'touch'
    }))
  })
  const cancel = page.locator('.mobileLinkActions').getByRole('menuitem', { name: 'Cancel Refresh', exact: true })
  await expect(cancel).toBeVisible()
  await page.evaluate(() => {
    document.querySelector('#app').__vue_app__.config.globalProperties.$store
      .commit('setSubscriptionFeedRefreshInProgress', false)
  })
  await cancel.click()
  await expect.poll(() => app.electronApp.evaluate(() => globalThis.__mobileCancelRequested)).toBe(true)
})

test('moving or cancelling a touch on feed tabs does not open a menu', async ({ page }) => {
  await goTo(page, 'subscriptions')
  const shorts = page.locator('[data-subscription-feed-tab="shorts"]')
  for (const event of ['pointermove', 'pointercancel', 'pointerup']) {
    await shorts.dispatchEvent('pointerdown', {
      pointerType: 'touch', isPrimary: true, clientX: 100, clientY: 100
    })
    await shorts.dispatchEvent(event, {
      pointerType: 'touch', isPrimary: true, clientX: 120, clientY: 100
    })
    await page.waitForTimeout(600)
    await expect(page.locator('.mobileLinkActions')).toHaveCount(0)
  }
})

test('disabled context menu actions cannot execute through IPC', async ({ page }) => {
  const searchInput = page.locator('.searchInput input')
  await searchInput.fill('selection')
  await searchInput.selectText()

  const contextMenu = await page.evaluate(() => window.ftElectron.contextMenu.open({
    isEditable: true,
    editFlags: { canCut: false }
  }))
  const cut = contextMenu.items.find(item => item.label === 'Cut')

  expect(cut.enabled).toBe(false)
  await page.evaluate(({ sessionId, actionId }) => {
    return window.ftElectron.contextMenu.execute(sessionId, actionId)
  }, { sessionId: contextMenu.sessionId, actionId: cut.actionId })
  await expect(searchInput).toHaveValue('selection')
})

test.describe('German locale', () => {
  test.use({ seed: { settings: { currentLocale: 'de-DE' } } })

  test('translates custom context menu actions', async ({ page }) => {
    const searchInput = page.locator('.searchInput input')
    await searchInput.fill('Auswahl')
    await searchInput.selectText()
    await searchInput.click({ button: 'right' })

    const menu = page.getByRole('menu', { name: 'Kontextmenü' })
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Einfügen' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Alles auswählen' })).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Ausschneiden' }).click()
    await expect(searchInput).toHaveValue('')
  })
})
