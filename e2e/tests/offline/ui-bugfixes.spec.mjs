import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, goTo, repoRoot, setWindowSize } from '../../helpers/app.mjs'
import { findWatchComponent, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import {
  encryptSyncServerDeviceInfo,
  randomSyncServerDeviceId,
} from '../../../src/renderer/helpers/sync-server-sessions.js'

function historyEntry(videoId, title, timeWatched) {
  return {
    _id: videoId,
    videoId,
    title,
    author: 'Test Channel',
    authorId: 'UC-test-channel-id',
    published: Date.now() - 86_400_000,
    description: 'Test description',
    viewCount: 1234,
    lengthSeconds: 60,
    watchProgress: 10,
    isWatched: false,
    timeWatched,
    isLive: false,
    type: 'video'
  }
}

async function enablePhoneTabSwitcher(page) {
  await page.evaluate(() => {
    const seen = new Set()
    let switcher = null
    const visit = (vnode) => {
      if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return
      seen.add(vnode)
      if (vnode.component) {
        const component = vnode.component
        if (component.type?.__name === 'CapacitorPhoneTabSwitcher') switcher = component
        visit(component.subTree)
      }
      if (Array.isArray(vnode.children)) vnode.children.forEach(visit)
      if (Array.isArray(vnode.dynamicChildren)) vnode.dynamicChildren.forEach(visit)
    }

    visit(document.querySelector('#app')._vnode)
    if (!switcher) throw new Error('Phone tab switcher component was not mounted')
    switcher.props.enabled = true
  })
  await expect(page.locator('.capacitorPhoneTabSwitcherButton')).toBeVisible()
}

async function phoneTabScrollState(page, contentSelector) {
  return await page.locator('.capacitorPhoneTabDialog').evaluate((dialog, selector) => {
    const content = dialog.querySelector(selector)
    const viewport = content.closest('[data-overlayscrollbars-viewport]')
    const scrollbar = viewport.querySelector(':scope > .os-scrollbar-vertical')
    const paddingBottom = Number.parseFloat(getComputedStyle(viewport).paddingBottom) || 0
    const maximum = Math.max(0, content.getBoundingClientRect().bottom - viewport.getBoundingClientRect().top +
      viewport.scrollTop + paddingBottom - viewport.clientHeight)
    return {
      scrollTop: viewport.scrollTop,
      maximum,
      scrollbarUnusable: scrollbar?.classList.contains('os-scrollbar-unusable') ?? false,
    }
  }, contentSelector)
}

for (const theme of ['light', 'dark']) {
  test(`phone organizer covers navigation and keeps themed safe areas in ${theme} mode`, async ({ app, page }) => {
    await setWindowSize(app, page, { width: 375, height: 760 })
    await page.evaluate(async baseTheme => {
      const store = document.querySelector('#app')._vnode.component.appContext.config.globalProperties.$store
      await store.dispatch('updateBaseTheme', baseTheme)
      document.documentElement.style.setProperty('--safe-area-inset-top', '28px')
      document.documentElement.style.setProperty('--safe-area-inset-bottom', '24px')
    }, theme)
    await enablePhoneTabSwitcher(page)
    await page.locator('.capacitorPhoneTabSwitcherButton').click()
    const overlay = page.locator('.capacitorPhoneTabOverlay')
    await expect(overlay).toBeVisible()
    for (const size of [{ width: 375, height: 760 }, { width: 760, height: 375 }]) {
      if (size.width !== 375) await setWindowSize(app, page, size)
      const metrics = await overlay.evaluate(element => {
        const dialog = element.querySelector('.capacitorPhoneTabDialog')
        const header = element.querySelector('.capacitorPhoneTabHeader')
        const bounds = dialog.getBoundingClientRect()
        return {
          top: bounds.top,
          bottom: innerHeight - bounds.bottom,
          left: bounds.left,
          right: innerWidth - bounds.right,
          background: getComputedStyle(element).backgroundColor,
          headerBackground: getComputedStyle(header).backgroundColor,
        }
      })
      expect(metrics.background).toBe(metrics.headerBackground)
      expect(metrics.top).toBeCloseTo(28, 0)
      expect(metrics.bottom).toBeCloseTo(24, 0)
      expect(metrics.left).toBeCloseTo(0, 0)
      expect(metrics.right).toBeCloseTo(0, 0)
    }
  })
}

test('phone organizer clamps its grid after column and viewport changes', async ({ app, page }) => {
  await setWindowSize(app, page, { width: 375, height: 400 })
  await page.evaluate(async () => {
    await window.ftElectron.setZoomFactor(0.95)
    const store = document.querySelector('#app')._vnode.component.appContext.config.globalProperties.$store
    for (let index = 0; index < 6; index++) {
      await store.dispatch('createTab', { route: '/subscriptions', makeActive: false })
    }
  })
  await enablePhoneTabSwitcher(page)
  await page.locator('.capacitorPhoneTabSwitcherButton').click()
  const panel = page.locator('#capacitor-phone-open-tabs-panel')
  await panel.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(async () => (await phoneTabScrollState(page, '.capacitorPhoneOpenTabs')).scrollTop)
    .toBeGreaterThan(100)
  const portrait = await phoneTabScrollState(page, '.capacitorPhoneOpenTabs')
  await setWindowSize(app, page, { width: 760, height: 401 })
  await expect.poll(async () => {
    const state = await phoneTabScrollState(page, '.capacitorPhoneOpenTabs')
    return state.maximum < portrait.maximum && state.scrollTop <= state.maximum + 1
  }).toBe(true)
  await expect.poll(() => panel.evaluate(viewport => {
    const track = viewport.querySelector('.os-scrollbar-vertical .os-scrollbar-track')
    const handle = track.querySelector('.os-scrollbar-handle')
    const actual = handle.getBoundingClientRect().height / track.getBoundingClientRect().height
    const expected = viewport.clientHeight / viewport.scrollHeight
    return Math.abs(actual - expected)
  })).toBeLessThan(0.02)
  await setWindowSize(app, page, { width: 375, height: 400 })
  await panel.evaluate(element => { element.scrollTop = element.scrollHeight })
  await setWindowSize(app, page, { width: 376, height: 950 })
  await expect.poll(() => phoneTabScrollState(page, '.capacitorPhoneOpenTabs')).toEqual({
    scrollTop: 0,
    maximum: 0,
    scrollbarUnusable: true,
  })
})

for (const zoom of [1, 0.95]) {
  test(`mobile progress sits above the navigation without moving its active indicator at ${zoom} scale`, async ({ app, page }) => {
    await setWindowSize(app, page, { width: 375, height: 760 })
    await page.evaluate(async factor => {
      await window.ftElectron.setZoomFactor(factor)
      document.documentElement.style.setProperty('--safe-area-inset-bottom', '24px')
      const store = document.querySelector('#app')._vnode.component.appContext.config.globalProperties.$store
      store.commit('setShowProgressBarToast', false)
      store.commit('setShowProgressBar', false)
    }, zoom)
    const nav = page.locator('.sideNav')
    await expect.poll(() => nav.locator('.activeIndicator').evaluate(element => element.getBoundingClientRect().height))
      .toBeCloseTo(3, 1)
    await expect.poll(() => nav.locator('.activeIndicator').evaluate(element => (
      new DOMMatrix(getComputedStyle(element).transform).m42
    ))).toBeCloseTo(0, 2)
    const originalHeight = await nav.evaluate(element => element.getBoundingClientRect().height)
    await page.evaluate(() => {
      const store = document.querySelector('#app')._vnode.component.appContext.config.globalProperties.$store
      store.commit('setProgressBarPercentage', 50)
      store.commit('setShowProgressBar', true)
    })
    await expect(page.locator('.progressBar')).toBeVisible()
    const metrics = await nav.evaluate(element => {
      const indicator = element.querySelector('.activeIndicator').getBoundingClientRect()
      const progress = document.querySelector('.progressBar').getBoundingClientRect()
      return {
        height: element.getBoundingClientRect().height,
        progressBottom: progress.bottom,
        navTop: element.getBoundingClientRect().top,
        indicatorBottomInset: innerHeight - indicator.bottom,
      }
    })
    expect(metrics.height).toBeCloseTo(originalHeight, 0)
    expect(metrics.progressBottom).toBeCloseTo(metrics.navTop, 0)
    expect(metrics.indicatorBottomInset).toBeCloseTo(24, 0)
    await page.evaluate(() => {
      document.querySelector('#app')._vnode.component.appContext.config.globalProperties.$store.commit('setShowProgressBar', false)
    })
    await expect(page.locator('.progressBar')).toHaveCount(0)
    expect(await nav.evaluate(element => element.getBoundingClientRect().height)).toBeCloseTo(originalHeight, 0)
  })
}

for (const theme of ['light', 'dark']) {
  test(`phone organizer shows a responsive thumbnail grid in ${theme} mode`, async ({ app, page }, testInfo) => {
    await setWindowSize(app, page, { width: 375, height: 760 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const thumbnail = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#216a83"/><circle cx="220" cy="70" r="40" fill="#f7c76a"/></svg>'
    await page.route('https://i.ytimg.com/vi/grid-video/*', route => route.fulfill({
      contentType: 'image/svg+xml', body: thumbnail,
    }))
    await page.evaluate(async baseTheme => {
      const store = document.querySelector('#app')._vnode.component.appContext.config.globalProperties.$store
      await store.dispatch('updateBaseTheme', baseTheme)
      for (const [route, title] of [
        ['/watch/grid-video', 'A walk along the coast at sunset'],
        ['/channel/grid-channel', 'Travel channel'],
        ['/history', 'History'],
        ['/playlists', 'Playlists'],
      ]) {
        await store.dispatch('createTab', { route, title, makeActive: false, lazyLoad: true })
      }
      store.commit('setChannelThumbnail', {
        channelId: 'grid-channel',
        thumbnail: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#6b4596"/></svg>'),
      })
      await store.dispatch('setTabPinned', { tabId: store.getters.getActiveTabId, isPinned: true })
    }, theme)
    await enablePhoneTabSwitcher(page)
    await page.locator('.capacitorPhoneTabSwitcherButton').click()
    const grid = page.locator('.capacitorPhoneOpenTabs')
    const cards = grid.locator('.capacitorPhoneTabRow')
    await expect(cards).toHaveCount(5)
    await expect(grid.locator('.capacitorPhoneTabDragHandle')).toHaveCount(0)
    await expect(cards.nth(1).locator('.capacitorTabThumbnail')).toBeVisible()
    await expect.poll(() => cards.nth(1).locator('img').evaluate(image => image.naturalWidth)).toBe(320)
    await expect(cards.nth(2).locator('.capacitorTabPreviewAvatar')).toBeVisible()
    await expect(cards.first().locator('.capacitorTabPreviewPin')).toBeVisible()
    await expect(cards.nth(3).locator('.capacitorTabPreview [data-icon="clock-rotate-left"]')).toBeVisible()
    await expect(cards.first().locator('[role="tab"]')).toHaveAttribute('aria-selected', 'true')

    for (const scenario of [
      { width: 375, height: 760, scale: 1, direction: 'ltr', columns: 2 },
      { width: 760, height: 375, scale: 0.95, direction: 'rtl', columns: 5 },
      { width: 375, height: 760, scale: 1.1, direction: 'ltr', columns: 2 },
    ]) {
      if (scenario.scale !== 1) await setWindowSize(app, page, scenario)
      await page.evaluate(({ scale, direction }) => {
        window.ftElectron.setZoomFactor(scale)
        document.body.dir = direction
      }, scenario)
      await expect.poll(() => grid.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length))
        .toBe(scenario.columns)
      const geometry = await cards.evaluateAll(elements => elements.map(element => {
        const card = element.getBoundingClientRect()
        const preview = element.querySelector('.capacitorTabPreview').getBoundingClientRect()
        const close = element.querySelector('.capacitorPhoneTabClose').getBoundingClientRect()
        return {
          inside: card.left >= 0 && card.right <= innerWidth,
          ratio: preview.width / preview.height,
          closeInside: close.left >= card.left && close.right <= card.right && close.bottom <= card.bottom,
          targets: [close.width, close.height],
        }
      }))
      for (const card of geometry) {
        expect(card.inside).toBe(true)
        expect(card.ratio).toBeCloseTo(16 / 9, 1)
        expect(card.closeInside).toBe(true)
        expect(Math.min(...card.targets)).toBeGreaterThanOrEqual(47.9)
      }
      if (scenario.scale === 1) {
        const screenshot = testInfo.outputPath(`phone-tab-grid-${theme}.png`)
        await page.locator('.capacitorPhoneTabDialog').screenshot({ path: screenshot })
        await testInfo.attach('Phone tab thumbnail grid', { path: screenshot, contentType: 'image/png' })
      }
    }
    await page.evaluate(() => {
      const store = document.querySelector('#app')._vnode.component.appContext.config.globalProperties.$store
      store.commit('setThumbnailPreference', 'hidden')
    })
    await expect(cards.nth(1).locator('.capacitorTabThumbnail')).toHaveCount(0)
    await expect(cards.nth(1).locator('[data-icon="clapperboard"]')).toBeVisible()
  })
}

test('phone cards open actions while held and dismiss them when dragging', async ({ app, page }) => {
  await setWindowSize(app, page, { width: 375, height: 760 })
  await enablePhoneTabSwitcher(page)
  await page.locator('.capacitorPhoneTabSwitcherButton').click()
  const card = page.locator('.capacitorPhoneTabRow').first()
  const target = card.locator('.capacitorPhoneTabTarget')
  const bounds = await target.boundingBox()
  const x = bounds.x + bounds.width / 2
  const y = bounds.y + 24

  await page.mouse.move(x, y)
  await page.mouse.down()
  await expect(card).toHaveClass(/holding/)
  const actions = page.locator('.capacitorTabActions')
  await expect(actions).toBeVisible()
  await page.mouse.up()
  await expect(actions.getByRole('menuitem', { name: 'Pin Tab', exact: true })).toBeVisible()
  await page.locator('.capacitorTabActionsBackdrop').click({ position: { x: 5, y: 5 } })
  await expect(actions).toBeHidden()

  await page.mouse.move(x, y)
  await page.mouse.down()
  await expect(card).toHaveClass(/holding/)
  await page.mouse.move(x + 24, y + 24, { steps: 4 })
  await expect(card).toHaveClass(/dragging/)
  await page.mouse.up()
  await expect(actions).toBeHidden()
  await expect(card).not.toHaveClass(/holding|dragging/)
  await expect(page.locator('.capacitorPhoneTabDialog')).toBeVisible()

  await target.click({ button: 'right' })
  await expect(actions).toBeVisible()
})

test('phone dragged cards follow the pointer and slide neighbors into their new slots', async ({ app, page }) => {
  await setWindowSize(app, page, { width: 375, height: 760 })
  await page.evaluate(async () => {
    const store = document.querySelector('#app')._vnode.component.appContext.config.globalProperties.$store
    for (let index = 0; index < 3; index++) {
      await store.dispatch('createTab', { route: '/subscriptions', makeActive: false })
    }
  })
  await enablePhoneTabSwitcher(page)
  await page.locator('.capacitorPhoneTabSwitcherButton').click()
  const cards = page.locator('.capacitorPhoneTabRow')
  const source = cards.first()
  const neighbor = cards.nth(1)
  const initial = await source.boundingBox()
  const adjacent = await neighbor.boundingBox()
  const x = initial.x + initial.width / 2
  const y = initial.y + 30
  await page.mouse.move(x, y)
  await page.mouse.down()
  await expect(source).toHaveClass(/holding/)
  await page.mouse.move(x + 24, y + 18, { steps: 3 })
  await expect.poll(async () => {
    const rect = await source.boundingBox()
    return { x: Math.round(rect.x - initial.x), y: Math.round(rect.y - initial.y) }
  }).toEqual({ x: 24, y: 18 })
  await page.mouse.move(adjacent.x + adjacent.width / 2, y + 18, { steps: 6 })
  await expect.poll(async () => (await neighbor.boundingBox()).x).toBeCloseTo(initial.x, 0)
  await expect(source).toHaveCSS('transition-duration', '0s')
  await expect(neighbor).not.toHaveCSS('transition-duration', '0s')
  await expect(page.locator('.capacitorTabActions')).toBeHidden()
  // Cancelling returns to the committed order without activating a tab.
  await source.dispatchEvent('pointercancel')
  await page.mouse.up()
  await expect.poll(async () => (await source.boundingBox()).x).toBeCloseTo(initial.x, 0)
  await expect.poll(async () => (await neighbor.boundingBox()).x).toBeCloseTo(adjacent.x, 0)
})

test('phone card dragging keeps its finger offset while scrolling and stops at the content end', async ({ app, page }) => {
  await setWindowSize(app, page, { width: 375, height: 450 })
  await page.evaluate(async () => {
    window.ftElectron.setZoomFactor(0.95)
    const store = document.querySelector('#app')._vnode.component.appContext.config.globalProperties.$store
    for (let index = 0; index < 7; index++) {
      await store.dispatch('createTab', { route: '/subscriptions', makeActive: false })
    }
  })
  await enablePhoneTabSwitcher(page)
  await page.locator('.capacitorPhoneTabSwitcherButton').click()
  const card = page.locator('.capacitorPhoneTabRow').first()
  const panel = page.locator('.capacitorPhoneTabList')
  const bounds = await card.boundingBox()
  const viewport = await panel.boundingBox()
  const x = bounds.x + bounds.width / 2
  const edgeY = viewport.y + viewport.height - 12
  await page.mouse.move(x, bounds.y + 30)
  await page.mouse.down()
  await expect(card).toHaveClass(/holding/)
  await page.mouse.move(x, edgeY, { steps: 5 })
  await expect.poll(() => panel.evaluate(element => element.scrollTop)).toBeGreaterThan(100)
  await expect.poll(async () => (await card.boundingBox()).y).toBeCloseTo(edgeY - 30, 0)
  await expect.poll(async () => {
    const state = await phoneTabScrollState(page, '.capacitorPhoneOpenTabs')
    return Math.abs(state.scrollTop - state.maximum)
  }).toBeLessThan(2)
  // Keep holding at the edge after reaching the end; the translated card
  // must not continually extend the scroll range beneath itself.
  await page.waitForTimeout(300)
  const state = await phoneTabScrollState(page, '.capacitorPhoneOpenTabs')
  expect(state.scrollTop).toBeLessThanOrEqual(state.maximum + 1)
  await card.dispatchEvent('pointercancel')
  await page.mouse.up()
  await expect(card).not.toHaveClass(/holding|dragging/)
})

test('fits synced-device tabs in the phone tab organizer', async ({ app, page }) => {
  await setWindowSize(app, page, { width: 375, height: 760 })
  await page.addStyleTag({
    path: path.join(
      repoRoot,
      'src/renderer/components/TabBar/CapacitorPhoneTabSwitcher.css'
    )
  })
  await page.evaluate(() => {
    const dialog = document.createElement('section')
    dialog.className = 'capacitorPhoneTabDialog'
    dialog.style.height = 'min(620px, 100%)'
    dialog.style.width = 'min(560px, 100%)'
    dialog.innerHTML = `
      <div class="capacitorPhoneTabViewTabs" role="tablist">
        <button class="capacitorPhoneTabViewTab" role="tab" aria-selected="false">2 open tabs</button>
        <button class="capacitorPhoneTabViewTab" role="tab" aria-selected="true">Tabs from other devices</button>
      </div>
      <div class="capacitorPhoneSyncedView" role="tabpanel">
        <div class="capacitorPhoneSyncedSessionTabs">
          <div class="capacitorPhoneSyncedSessionTabsInner" role="tablist" aria-label="Tabs from other devices">
            <button class="capacitorPhoneSyncedSessionTab" role="tab" aria-selected="true"><span aria-hidden="true">▣</span><strong>A very long encrypted device name that must wrap · 2 tabs</strong></button>
            <button class="capacitorPhoneSyncedSessionTab" role="tab" aria-selected="false"><span aria-hidden="true">▣</span><strong>Mobile · 1 tab</strong></button>
          </div>
        </div>
        <div class="capacitorPhoneSyncedTabs">
          <article class="capacitorPhoneSyncedSession" role="tabpanel">
            <header class="capacitorPhoneSyncedSessionHeader">
              <button class="capacitorPhoneSyncedTabButton capacitorPhoneSyncedOpenAll"><span aria-hidden="true">↗</span><span>Open all tabs</span></button>
              <button class="capacitorPhoneSyncedTabButton capacitorPhoneSyncedDelete dangerButton" aria-label="Delete: Desktop · 2 tabs"><span aria-hidden="true">×</span></button>
            </header>
            <div class="capacitorPhoneSyncedTabList">
              <button class="capacitorPhoneSyncedTabButton capacitorPhoneSyncedTabTarget"><span aria-hidden="true">↗</span><span>A very long channel tab title that must not overflow</span></button>
              <button class="capacitorPhoneSyncedTabButton capacitorPhoneSyncedTabTarget"><span aria-hidden="true">↗</span><span>Watch later</span></button>
            </div>
          </article>
        </div>
      </div>
    `
    document.body.append(dialog)
  })

  const dialog = page.locator('.capacitorPhoneTabDialog')
  await expect.poll(() => dialog.evaluate(element => (
    element.scrollWidth <= element.clientWidth + 1
  ))).toBe(true)

  const touchTargetHeights = await dialog.getByRole('button').evaluateAll(buttons => (
    buttons.map(button => button.getBoundingClientRect().height)
  ))
  expect(touchTargetHeights.every(height => height >= 48)).toBe(true)
  const actionAlignment = await dialog.locator('.capacitorPhoneSyncedSessionHeader')
    .evaluate(header => {
      const headerBounds = header.getBoundingClientRect()
      const openAllBounds = header.querySelector('.capacitorPhoneSyncedOpenAll').getBoundingClientRect()
      const deleteBounds = header.querySelector('.capacitorPhoneSyncedDelete').getBoundingClientRect()
      return {
        openAllStartOffset: Math.abs(openAllBounds.left - headerBounds.left),
        deleteEndOffset: Math.abs(deleteBounds.right - headerBounds.right),
      }
    })
  expect(actionAlignment.openAllStartOffset).toBeLessThanOrEqual(1)
  expect(actionAlignment.deleteEndOffset).toBeLessThanOrEqual(1)
  const activeIndicator = await dialog.getByRole('tab', { name: 'Tabs from other devices' })
    .evaluate(element => {
      const style = getComputedStyle(element)
      return {
        color: style.borderBottomColor,
        width: Number.parseFloat(style.borderBottomWidth),
      }
    })
  expect(activeIndicator.width).toBe(3)
  expect(activeIndicator.color).not.toBe('rgba(0, 0, 0, 0)')

  await setWindowSize(app, page, { width: 760, height: 375 })
  await expect.poll(() => dialog.evaluate(element => (
    element.scrollWidth <= element.clientWidth + 1 &&
    element.scrollHeight <= element.clientHeight + 1
  ))).toBe(true)
})

for (const iconPack of ['material', 'remix']) {
  test(`shows synced tab avatars and page icons in the phone organizer with ${iconPack}`, async ({ app, page }, testInfo) => {
    await setWindowSize(app, page, { width: 375, height: 760 })
    await enablePhoneTabSwitcher(page)
    const avatar = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="green"/></svg>')
    let captureRetry
    const retryRequest = new Promise(resolve => { captureRetry = resolve })
    await page.route('https://example.com/retry-avatar.svg*', route => {
      if (route.request().url().includes('opentubex_retry=')) {
        captureRetry(route)
        return
      }
      return route.fulfill({ contentType: 'image/svg+xml', body: 'invalid image' })
    })
    await page.evaluate(async ({ pack, avatarUrl }) => {
      const store = document.querySelector('#app')._vnode.component.appContext.config.globalProperties.$store
      await store.dispatch('updateIconPack', pack)
      store.commit('setThumbnailPreference', 'hidden')
      store.commit('setSyncServerEnabled', true)
      store.commit('setSyncServerToken', 'e2e-token')
      store.commit('setSyncServerPrivacyMode', 'enhanced')
      store.commit('setSyncServerSyncSessions', true)
      store.commit('setChannelThumbnail', { channelId: 'cached-channel', thumbnail: avatarUrl })
      store.commit('setVideoAvatar', { videoId: 'cached-video', avatar: avatarUrl })
      store.commit('setSyncServerOtherDeviceSessions', [{
        syncDeviceId: 'desktop-e2e',
        syncPlatform: 'desktop',
        sessionId: 'desktop-session',
        tabs: [
          { id: 'history', title: 'History', url: 'app://bundle/index.html#/history?search=test' },
          { id: 'subscriptions', title: 'Subscriptions', url: 'https://localhost/subscriptions' },
          { id: 'channel', title: 'Cached channel', url: 'app://bundle/index.html#/channel/cached-channel' },
          { id: 'video', title: 'Cached video', url: '/watch/cached-video?t=30' },
          { id: 'avatar', title: 'Saved avatar', url: '/watch/saved-avatar', avatarUrl },
          { id: 'broken', title: 'Broken avatar', url: '/watch/broken', avatarUrl: 'data:image/png;base64,invalid' },
          { id: 'retry', title: 'Retry avatar', url: '/watch/retry', avatarUrl: 'https://example.com/retry-avatar.svg' },
          { id: 'unknown', title: 'Unknown page', url: '/unknown' },
        ],
      }])
    }, { pack: iconPack, avatarUrl: avatar })

    await page.locator('.capacitorPhoneTabSwitcherButton').click()
    const organizer = page.locator('.capacitorPhoneTabDialog')
    await organizer.getByRole('tab', { name: 'Tabs from other devices' }).click()
    const row = title => organizer.getByRole('button', { name: title, exact: true })
    for (const [title, icon] of [['History', 'clock-rotate-left'], ['Subscriptions', 'rss'], ['Broken avatar', 'clapperboard'], ['Unknown page', 'display']]) {
      const glyph = row(title).locator(`[data-icon="${icon}"]`)
      await expect(glyph).toBeVisible()
      await expect(glyph).toHaveAttribute('data-icon-pack', iconPack)
    }
    for (const title of ['Cached channel', 'Cached video', 'Saved avatar']) {
      await expect(row(title).locator('img')).toHaveAttribute('src', avatar)
      await expect.poll(() => row(title).locator('img').evaluate(image => image.naturalWidth)).toBe(24)
    }
    await expect(row('Broken avatar').locator('img')).toBeHidden()
    // Keep the retry pending to check that only exhausted retries show a fallback.
    const retryRoute = await retryRequest
    await expect(row('Retry avatar').locator('img')).toBeVisible()
    await expect(row('Retry avatar').locator('[data-icon="clapperboard"]')).toHaveCount(0)
    await retryRoute.fulfill({
      contentType: 'image/svg+xml',
      body: decodeURIComponent(avatar.split(',')[1]),
    })
    await expect(row('Retry avatar').locator('img')).toBeVisible()
    await expect.poll(() => row('Retry avatar').locator('img').evaluate(image => image.naturalWidth)).toBe(24)
    await expect(row('Retry avatar').locator('[data-icon="clapperboard"]')).toHaveCount(0)

    const screenshot = testInfo.outputPath(`phone-synced-tab-icons-${iconPack}.png`)
    await organizer.screenshot({ path: screenshot })
    await testInfo.attach('Phone synced tab icons', { path: screenshot, contentType: 'image/png' })
    await setWindowSize(app, page, { width: 760, height: 375 })
    await expect.poll(() => organizer.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  })
}

for (const layout of ['phone', 'desktop']) {
  test(`confirms opening all synced tabs in the ${layout} organizer`, async ({ app, page }) => {
    if (layout === 'phone') {
      await setWindowSize(app, page, { width: 375, height: 760 })
      await enablePhoneTabSwitcher(page)
    }
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setSyncServerEnabled', true)
      store.commit('setSyncServerToken', 'e2e-token')
      store.commit('setSyncServerPrivacyMode', 'enhanced')
      store.commit('setSyncServerSyncSessions', true)
      store.commit('setSyncServerSharedTabs', false)
      store.commit('setSyncServerOtherDeviceSessions', [{
        syncDeviceId: 'desktop-e2e',
        syncPlatform: 'desktop',
        sessionId: 'desktop-session',
        tabs: [
          { id: 'history', title: 'History', url: '/history' },
          { id: 'playlists', title: 'Playlists', url: '/playlists' },
        ],
      }])
    })
    const initialTabIds = await page.evaluate(() => window.ftElectron.tabs.getState().then(state => state.tabs.map(tab => tab.id)))
    await page.locator(layout === 'phone' ? '.capacitorPhoneTabSwitcherButton' : '.tabBar .tabOrganizerButton').click()
    const organizer = page.getByRole('dialog', { name: 'Tab Organizer', exact: true })
    if (layout === 'phone') await organizer.getByRole('tab', { name: 'Tabs from other devices' }).click()
    const openAll = organizer.getByRole('button', { name: 'Open all tabs' })
    const confirmation = page.getByRole('dialog', { name: 'Open all tabs?', exact: true })
    // A single synced tab must still open directly, without the bulk confirmation.
    await organizer.locator(layout === 'phone' ? '.capacitorPhoneSyncedTabTarget' : '.syncedTabTarget')
      .filter({ hasText: 'History' }).click()
    await expect.poll(() => page.evaluate(() => window.ftElectron.tabs.getState().then(state => state.tabs.length)))
      .toBe(initialTabIds.length + 1)
    expect(await page.evaluate(() => window.ftElectron.tabs.getState().then(state => state.tabs.at(-1).route.fullPath)))
      .toBe('/history')
    await expect(confirmation).toHaveCount(0)
    if (layout === 'phone') {
      await expect(organizer).toHaveCount(0)
      await page.locator('.capacitorPhoneTabSwitcherButton').click()
      await organizer.getByRole('tab', { name: 'Tabs from other devices' }).click()
    }
    const tabIdsBefore = await page.evaluate(() => window.ftElectron.tabs.getState().then(state => state.tabs.map(tab => tab.id)))
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const openSession = store._actions.openSyncServerSession[0]
      window.__syncOpen = { calls: 0 }
      store._actions.openSyncServerSession[0] = async session => {
        window.__syncOpen.calls += 1
        await new Promise((resolve, reject) => {
          window.__syncOpen.release = fail => fail ? reject(new Error('Test opening failure')) : resolve()
        })
        return openSession(session)
      }
    })
    for (const dismiss of ['cancel', 'escape', 'backdrop']) {
      await openAll.click()
      await expect(confirmation).toContainText('Desktop · 2 tabs')
      await expect(organizer).toHaveAttribute('inert', '')
      if (layout === 'phone') {
        expect(await confirmation.evaluate(element => getComputedStyle(element.closest('.prompt')).zIndex)).toBe('1200')
      }
      if (dismiss === 'cancel') await confirmation.getByRole('button', { name: 'Cancel' }).click()
      else if (dismiss === 'escape') await page.keyboard.press('Escape')
      else await page.locator('.prompt').click({ position: { x: 5, y: 5 } })
      await expect(confirmation).toHaveCount(0)
      await expect(organizer).not.toHaveAttribute('inert')
      await expect(openAll).toBeFocused()
      expect(await page.evaluate(() => window.ftElectron.tabs.getState().then(state => state.tabs.map(tab => tab.id))))
        .toEqual(tabIdsBefore)
    }
    for (const [index, fail] of [true, false].entries()) {
      await openAll.click()
      await confirmation.getByRole('button', { name: 'Open all tabs', exact: true }).click()
      await expect.poll(() => page.evaluate(() => window.__syncOpen.calls)).toBe(index + 1)
      await expect(confirmation).toBeVisible()
      await expect(organizer).toHaveAttribute('inert', '')
      await expect(confirmation).toHaveAttribute('inert', '')
      // Synthetic clicks exercise the handler guard even when native inert filtering is bypassed.
      await confirmation.getByRole('button', { name: 'Open all tabs', exact: true }).dispatchEvent('click')
      await confirmation.getByRole('button', { name: 'Cancel', exact: true }).dispatchEvent('click')
      await page.keyboard.press('Escape')
      await page.mouse.click(5, 5)
      await expect(organizer).toBeVisible()
      await expect(confirmation).toBeVisible()
      expect(await page.evaluate(() => window.__syncOpen.calls)).toBe(index + 1)
      await page.evaluate(fail => window.__syncOpen.release(fail), fail)
      await expect(confirmation).toHaveCount(0)
      if (fail) {
        await expect(organizer).not.toHaveAttribute('inert')
        await expect(openAll).toBeFocused()
        expect(await page.evaluate(() => window.ftElectron.tabs.getState().then(state => state.tabs.map(tab => tab.id))))
          .toEqual(tabIdsBefore)
      }
    }
    if (layout === 'phone') await expect(organizer).toHaveCount(0)
    else await expect(organizer).not.toHaveAttribute('inert')
    await expect.poll(() => page.evaluate(() => window.ftElectron.tabs.getState().then(state => (
      state.tabs.slice(-2).map(tab => tab.route.fullPath)
    )))).toEqual(['/history', '/playlists'])
    expect(await page.evaluate(() => window.ftElectron.tabs.getState().then(state => state.tabs.length)))
      .toBe(tabIdsBefore.length + 2)
  })
}

test('shows remote tab sets as tabs and confirms deletion in the phone organizer', async ({ app, page }) => {
  await setWindowSize(app, page, { width: 375, height: 760 })
  await page.evaluate(() => window.ftElectron.setZoomFactor(0.95))
  await enablePhoneTabSwitcher(page)
  await page.evaluate(() => {
    const store = document.querySelector('#app')._vnode.component.appContext.config.globalProperties.$store
    store.commit('setSyncServerEnabled', true)
    store.commit('setSyncServerToken', 'e2e-token')
    store.commit('setSyncServerPrivacyMode', 'enhanced')
    store.commit('setSyncServerSyncSessions', true)
    store.commit('setSyncServerSharedTabs', false)
    store.commit('setSyncServerOtherDeviceSessions', [
      {
        syncDeviceId: 'phone-e2e',
        syncPlatform: 'mobile',
        sessionId: 'mobile-session-e2e',
        tabs: Array.from({ length: 30 }, (_, index) => ({
          id: `mobile-${index}`,
          title: `Mobile tab ${index}`,
          url: `/watch/mobile-${index}`,
        })),
      },
      {
        syncDeviceId: 'desktop-e2e',
        syncPlatform: 'desktop',
        sessionId: 'desktop-session-e2e',
        tabs: [{ id: 'desktop-subscriptions', title: 'Desktop subscriptions', url: '/subscriptions' }],
      },
      ...Array.from({ length: 7 }, (_, sessionIndex) => ({
        syncDeviceId: `extra-desktop-${sessionIndex}`,
        syncPlatform: 'desktop',
        sessionId: `extra-session-${sessionIndex}`,
        tabs: Array.from({ length: sessionIndex + 2 }, (_, tabIndex) => ({
          id: `extra-${sessionIndex}-${tabIndex}`,
          title: `Extra tab ${sessionIndex}-${tabIndex}`,
          url: `/watch/extra-${sessionIndex}-${tabIndex}`,
        })),
      })),
    ])
    store._actions.deleteSyncServerSession = [session => {
      store.commit(
        'setSyncServerOtherDeviceSessions',
        store.getters.getSyncServerOtherDeviceSessions.filter(candidate => (
          candidate.syncDeviceId !== session.syncDeviceId ||
          candidate.sessionId !== session.sessionId
        ))
      )
      return Promise.resolve(true)
    }]
  })

  await page.locator('.capacitorPhoneTabSwitcherButton').click()
  const organizer = page.locator('.capacitorPhoneTabDialog')
  await organizer.getByRole('tab', { name: 'Tabs from other devices' }).click()

  const sessionTabs = organizer.locator('.capacitorPhoneSyncedSessionTabs')
  const mobileTab = sessionTabs.getByRole('tab', { name: 'Mobile · 30 tabs', exact: true })
  const desktopTab = sessionTabs.getByRole('tab', { name: 'Desktop · 1 tab', exact: true })
  const syncedPanel = organizer.locator('.capacitorPhoneSyncedTabs')
  const syncedSet = organizer.locator('.capacitorPhoneSyncedSession[role="tabpanel"]')
  await expect(sessionTabs).toHaveAttribute('data-overlayscrollbars-viewport')
  const sessionTablist = sessionTabs.getByRole('tablist', { name: 'Tabs from other devices' })
  await expect(sessionTablist).toHaveCount(1)
  await expect(sessionTablist.locator(':scope > *')).toHaveCount(9)
  await expect(sessionTablist.locator(':scope > [role="tab"]')).toHaveCount(9)
  await expect(sessionTabs.getByRole('tab')).toHaveCount(9)
  await expect.poll(() => sessionTabs.evaluate(element => ({
    horizontallyScrollable: element.scrollWidth > element.clientWidth,
    selectedSetVisible: document.querySelector('.capacitorPhoneSyncedTabs').clientHeight > 0,
  }))).toEqual({ horizontallyScrollable: true, selectedSetVisible: true })
  await expect(mobileTab).toHaveAttribute('aria-selected', 'true')
  await expect(desktopTab).toHaveAttribute('aria-selected', 'false')
  await expect(syncedSet).toContainText('Mobile tab 0')
  await expect(syncedSet).not.toContainText('Desktop subscriptions')

  await mobileTab.press('ArrowRight')
  await expect(desktopTab).toBeFocused()
  await expect(desktopTab).toHaveAttribute('aria-selected', 'true')
  await expect(syncedSet).toContainText('Desktop subscriptions')
  await expect(syncedSet).not.toContainText('Mobile tab 0')

  await desktopTab.press('Home')
  await expect(mobileTab).toBeFocused()
  await expect(mobileTab).toHaveAttribute('aria-selected', 'true')
  await syncedPanel.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(async () => (
    await phoneTabScrollState(page, '.capacitorPhoneSyncedTabsContent')
  ).scrollTop).toBeGreaterThan(0)

  const deleteSet = syncedSet.getByRole('button', { name: 'Delete: Mobile · 30 tabs' })
  await deleteSet.click()
  let confirmation = page.getByRole('dialog', { name: 'Delete' })
  await expect(confirmation).toContainText('Mobile · 30 tabs')
  await expect(organizer).toHaveAttribute('inert', '')
  await expect.poll(async () => ({
    confirmation: Number.parseInt(await confirmation.evaluate(element => getComputedStyle(element.closest('.prompt')).zIndex)),
    organizer: Number.parseInt(await organizer.evaluate(element => getComputedStyle(element.closest('.capacitorPhoneTabOverlay')).zIndex)),
  })).toEqual({ confirmation: 1200, organizer: 1100 })
  await confirmation.getByRole('button', { name: 'Cancel' }).click()
  await expect(organizer).not.toHaveAttribute('inert')
  await expect(syncedSet).toBeVisible()

  await deleteSet.click()
  confirmation = page.getByRole('dialog', { name: 'Delete' })
  await confirmation.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(mobileTab).toHaveCount(0)
  await expect(desktopTab).toBeFocused()
  await expect(desktopTab).toHaveAttribute('aria-selected', 'true')
  await expect(syncedSet).toContainText('Desktop subscriptions')
  await expect.poll(() => phoneTabScrollState(page, '.capacitorPhoneSyncedTabsContent')).toEqual({
    scrollTop: 0,
    maximum: 0,
    scrollbarUnusable: true,
  })
  await page.evaluate(() => {
    const store = document.querySelector('#app')._vnode.component.appContext.config.globalProperties.$store
    store.commit('setSyncServerOtherDeviceSessions', store.getters.getSyncServerOtherDeviceSessions.slice(0, 1))
  })
  await syncedSet.getByRole('button', { name: 'Delete: Desktop · 1 tab' }).click()
  await page.getByRole('dialog', { name: 'Delete' })
    .getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(sessionTabs).toHaveCount(0)
  await expect(organizer.locator('.capacitorPhoneTabTarget[aria-selected="true"]')).toBeFocused()
})

test('restores and clamps the real phone tab organizer viewports', async ({ app, page }) => {
  const privacyKey = randomBytes(32).toString('base64')
  const desktopDeviceId = randomSyncServerDeviceId()
  const encryptedDeviceInfo = await encryptSyncServerDeviceInfo({
    name: 'Living room PC',
    platform: 'linux',
    architecture: 'x64',
    release: '6.16.4-arch1-1',
  }, privacyKey, desktopDeviceId)
  let accountSessionRequests = 0
  let healthRequests = 0
  await page.route('https://sync.d3sox.me/**', async route => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === '/health') {
      healthRequests++
      await route.fulfill({ status: 200, json: { capabilities: { account_sessions: 1 } } })
    } else if (pathname === '/v1/account/sessions') {
      accountSessionRequests++
      await route.fulfill({
        status: 200,
        json: {
          sessions: [{
            device_id: desktopDeviceId,
            encrypted_device_info: encryptedDeviceInfo,
          }],
        },
      })
    } else {
      await route.fulfill({ status: 500, body: 'Unexpected sync request' })
    }
  })
  await setWindowSize(app, page, { width: 375, height: 760 })
  await page.evaluate(() => window.ftElectron.setZoomFactor(0.95))
  await enablePhoneTabSwitcher(page)
  await page.evaluate(async ({ desktopDeviceId, privacyKey }) => {
    const store = document.querySelector('#app')._vnode.component.appContext.config.globalProperties.$store
    store.commit('setSyncServerEnabled', true)
    store.commit('setSyncServerToken', 'e2e-token')
    store.commit('setSyncServerPrivacyKey', privacyKey)
    store.commit('setSyncServerPrivacyMode', 'enhanced')
    store.commit('setSyncServerSyncSessions', true)
    store.commit('setSyncServerSharedTabs', false)
    store.commit('setSyncServerOtherDeviceSessions', [
      {
        syncDeviceId: desktopDeviceId,
        syncPlatform: 'desktop',
        sessionId: 'long-session-e2e',
        tabs: Array.from({ length: 30 }, (_, index) => ({
          id: `synced-${index}`,
          title: `Synced tab ${index}`,
          url: `/watch/synced-${index}`,
        })),
      },
      {
        syncDeviceId: desktopDeviceId,
        syncPlatform: 'desktop',
        sessionId: 'short-session-e2e',
        tabs: [{ id: 'short-synced', title: 'Short synced tab', url: '/subscriptions' }],
      },
    ])
    for (let index = 0; index < 30; index++) {
      await store.dispatch('createTab', { route: `/watch/local-${index}`, makeActive: false })
    }
  }, { desktopDeviceId, privacyKey })
  await expect.poll(() => page.locator('.capacitorPhoneTabCount').textContent()).toBe('31')
  await page.locator('.capacitorPhoneTabSwitcherButton').click()
  await expect.poll(() => accountSessionRequests).toBe(1)
  expect(healthRequests).toBe(0)

  const openPanel = page.locator('#capacitor-phone-open-tabs-panel')
  await expect(openPanel).toHaveAttribute('data-overlayscrollbars-viewport')
  await openPanel.evaluate(element => { element.scrollTop = 240 })
  await expect.poll(async () => (await phoneTabScrollState(page, '.capacitorPhoneOpenTabs')).scrollTop)
    .toBeCloseTo(240, 0)
  await page.getByRole('tab', { name: 'Tabs from other devices' }).click()

  const syncedPanel = page.locator('.capacitorPhoneSyncedTabs')
  await expect(page.getByRole('tab', { name: 'Living room PC · 30 tabs', exact: true }))
    .toHaveAttribute('aria-selected', 'true')
  await expect(syncedPanel).toHaveAttribute('data-overlayscrollbars-viewport')
  await syncedPanel.evaluate(element => { element.scrollTop = 360 })
  await expect.poll(async () => (await phoneTabScrollState(page, '.capacitorPhoneSyncedTabsContent')).scrollTop)
    .toBeCloseTo(360, 0)
  await page.getByRole('tab', { name: /open tabs/ }).click()
  await expect.poll(async () => (await phoneTabScrollState(page, '.capacitorPhoneOpenTabs')).scrollTop)
    .toBeCloseTo(240, 0)

  await openPanel.evaluate(element => { element.scrollTop = element.scrollHeight })
  await page.evaluate(async () => {
    const store = document.querySelector('#app')._vnode.component.appContext.config.globalProperties.$store
    const ids = store.getters.getTabs.slice(0, -2).map(tab => tab.id)
    for (const id of ids) await store.dispatch('closeTab', id)
  })
  await expect(page.locator('.capacitorPhoneTabRow')).toHaveCount(2)
  await expect.poll(() => phoneTabScrollState(page, '.capacitorPhoneOpenTabs')).toEqual({
    scrollTop: 0,
    maximum: 0,
    scrollbarUnusable: true,
  })

  await page.getByRole('tab', { name: 'Tabs from other devices' }).click()
  await expect.poll(async () => (await phoneTabScrollState(page, '.capacitorPhoneSyncedTabsContent')).scrollTop)
    .toBeCloseTo(360, 0)
  await syncedPanel.evaluate(element => { element.scrollTop = element.scrollHeight })
  await page.evaluate(desktopDeviceId => {
    const store = document.querySelector('#app')._vnode.component.appContext.config.globalProperties.$store
    store.commit('setSyncServerDeviceNames', { [desktopDeviceId]: 'Desk PC' })
  }, desktopDeviceId)
  await page.getByRole('tab', { name: 'Desk PC · 1 tab', exact: true }).click()
  await expect(page.locator('.capacitorPhoneSyncedTabTarget')).toHaveCount(1)
  await expect(page.locator('.capacitorPhoneSyncedSessionTab[aria-selected="true"]'))
    .toHaveText('Desk PC · 1 tab')
  await expect.poll(() => phoneTabScrollState(page, '.capacitorPhoneSyncedTabsContent')).toEqual({
    scrollTop: 0,
    maximum: 0,
    scrollbarUnusable: true,
  })
})

test('tablet tabs autosize by default and reuse the fixed tab width setting', async ({ page }) => {
  await page.addStyleTag({
    path: path.join(
      repoRoot,
      'src/renderer/components/TabBar/CapacitorTabletTabBar.css'
    )
  })
  await page.evaluate(() => {
    const bar = document.createElement('div')
    const tabs = document.createElement('div')
    for (const title of ['A', 'A much longer tab title']) {
      const tab = document.createElement('div')
      const target = document.createElement('button')
      const close = document.createElement('button')
      tab.className = 'capacitorTabletTab'
      target.className = 'capacitorTabletTabTarget'
      target.textContent = title
      close.className = 'capacitorTabletTabClose'
      close.textContent = 'x'
      tab.append(target, close)
      tabs.append(tab)
    }
    bar.className = 'capacitorTabletTabBar'
    tabs.className = 'capacitorTabletTabs'
    bar.append(tabs)
    document.body.append(bar)
  })

  const tabs = page.locator('.capacitorTabletTab')
  const automaticWidths = await tabs.evaluateAll(elements => (
    elements.map(element => Math.round(element.getBoundingClientRect().width))
  ))
  expect(automaticWidths[1]).toBeGreaterThan(automaticWidths[0])

  await page.locator('.capacitorTabletTabBar').evaluate(element => {
    element.style.setProperty('--fixed-tab-width', '140px')
  })
  await expect.poll(() => tabs.evaluateAll(elements => (
    elements.map(element => Math.round(element.getBoundingClientRect().width))
  ))).toEqual([140, 140])
})

test('keeps the tablet main-card top gutter compact on narrow layouts', async ({ app, page }) => {
  await setWindowSize(app, page, { width: 480, height: 800 })
  const appStyles = await readFile(path.join(repoRoot, 'src/renderer/App.css'), 'utf8')
  await page.addStyleTag({
    content: appStyles
      .replaceAll(/:deep\(((?:[^()]|\([^()]*\))*)\)/g, '$1')
      .replaceAll(/:global\(((?:[^()]|\([^()]*\))*)\)/g, '$1')
  })
  await page.evaluate(() => {
    const testApp = document.createElement('div')
    const outerRoute = document.createElement('div')
    const pageRoute = document.createElement('div')
    testApp.className = 'app capacitorTabs capacitorTabletLayout topTabs tabletMainCardTest'
    outerRoute.className = 'routerView'
    pageRoute.className = 'routerView'
    outerRoute.append(pageRoute)
    testApp.append(outerRoute)
    document.body.append(testApp)
  })

  const pageRoute = page.locator('.tabletMainCardTest > .routerView .routerView')
  await expect(pageRoute).toHaveCSS('margin-block-start', '18px')
})

test('collapsed description paints the More control above its text', async ({ page }) => {
  await page.addStyleTag({
    path: path.join(
      repoRoot,
      'src/renderer/components/WatchVideoDescription/WatchVideoDescription.css'
    )
  })
  await page.evaluate(() => {
    const card = document.createElement('div')
    const more = document.createElement('span')
    const scroll = document.createElement('div')
    const description = document.createElement('div')

    card.className = 'videoDescription short'
    card.style.backgroundColor = 'var(--card-bg-color)'
    card.style.inset = '300px auto auto 300px'
    card.style.padding = '16px'
    card.style.position = 'fixed'
    card.style.width = '300px'
    card.style.zIndex = '10000'
    more.className = 'descriptionStatus'
    more.textContent = 'More'
    scroll.className = 'descriptionScroll'
    description.className = 'description'
    description.textContent = Array.from(
      { length: 20 },
      (_, index) => `Long description segment ${index + 1}`
    ).join(' ')

    scroll.append(description)
    card.append(more, scroll)
    document.body.append(card)
  })

  const description = page.locator('.videoDescription.short').first()
  const more = description.locator('.descriptionStatus')
  await expect(more).toBeVisible()
  await expect.poll(async () => more.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return document.elementFromPoint(
      bounds.left + bounds.width / 2,
      bounds.top + bounds.height / 2
    ) === element
  })).toBe(true)
})

test('centers channel Home shelves within the available width', async ({ page }) => {
  await page.addStyleTag({
    path: path.join(
      repoRoot,
      'src/renderer/components/ChannelHome/ChannelHome.css'
    )
  })
  await page.evaluate(() => {
    const shelf = document.createElement('section')
    shelf.className = 'shelfContainer'
    shelf.textContent = 'Channel Home shelf'
    document.body.append(shelf)
  })

  const gaps = await page.locator('.shelfContainer').evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return {
      inlineStart: bounds.left,
      inlineEnd: document.documentElement.clientWidth - bounds.right,
    }
  })

  expect(Math.abs(gaps.inlineStart - gaps.inlineEnd)).toBeLessThanOrEqual(1)
})

test('full-window player shows the title overlay', async ({ page }) => {
  const playerStyles = await readFile(
    path.join(
      repoRoot,
      'src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.css'
    ),
    'utf8'
  )
  await page.addStyleTag({
    content: playerStyles.replaceAll(/:deep\(((?:[^()]|\([^()]*\))*)\)/g, '$1')
  })
  await page.evaluate(() => {
    const player = document.createElement('div')
    const title = document.createElement('h1')
    player.className = 'ftVideoPlayer'
    title.className = 'playerFullscreenTitleOverlay'
    title.textContent = 'Test video title'
    player.append(title)
    document.body.append(player)
  })

  const player = page.locator('.ftVideoPlayer')
  const title = player.locator('.playerFullscreenTitleOverlay')
  await expect(title).toHaveCSS('display', 'none')
  await player.evaluate(element => element.classList.add('fullWindow'))
  await expect(title).toHaveCSS('display', 'block')
})

test('keeps the full-window player title below the Android status bar', async ({ page }) => {
  const playerStyles = await readFile(
    path.join(
      repoRoot,
      'src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.css'
    ),
    'utf8'
  )
  await page.addStyleTag({
    content: playerStyles.replaceAll(/:deep\(((?:[^()]|\([^()]*\))*)\)/g, '$1')
  })
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--safe-area-inset-top', '32px')

    const app = document.querySelector('.app')
    const player = document.createElement('div')
    const title = document.createElement('h1')
    player.className = 'ftVideoPlayer fullWindow'
    title.className = 'playerFullscreenTitleOverlay'
    title.textContent = 'Test video title'
    player.append(title)
    app.append(player)
  })

  const title = page.locator('.ftVideoPlayer .playerFullscreenTitleOverlay')
  await expect(title).toHaveCSS('top', '37px')
})

test('scopes Android fullscreen safe-area rules to the player UI', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--safe-area-inset-top', '32px')
    document.documentElement.style.setProperty('--safe-area-inset-bottom', '20px')
    document.querySelector('.app').classList.add('capacitorTabs')

    const player = document.querySelector('.ftVideoPlayer')
    const topControls = document.createElement('div')
    const metadataSide = document.createElement('div')
    player.classList.add('shortsPlayer', 'fullWindow', 'fullscreenCommentsOpen')
    topControls.className = 'shortsTopControls'
    metadataSide.className = 'shortsFullscreenMetadataSide'
    player.append(topControls, metadataSide)
  })

  await expect(page.locator('.app')).toHaveCSS('display', 'flex')
  await expect(page.locator('.shortsTopControls')).toHaveCSS('padding-top', '48px')
  await expect(page.locator('.shortsFullscreenMetadataSide')).toHaveCSS('display', 'none')
  await expect(page.locator('.fullscreenCommentsOverlay')).toHaveCSS('top', '44px')
  await expect(page.locator('.fullscreenCommentsOverlay')).toHaveCSS('bottom', '32px')
})

test('keeps Android player notices and end cards clear of visible controls', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 800, height: 480 })
  await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))
  await page.evaluate(async () => {
    document.documentElement.style.setProperty('--safe-area-inset-bottom', '24px')
    const app = document.querySelector('.app')
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateShowFullscreenActionsWhenPaused', true)
    app.classList.add('capacitorTabs')
  })
  const watchComponent = await page.evaluateHandle(findWatchComponent)
  await page.locator('.full-window-button').first().dispatchEvent('click')
  await expect(page.locator('.ftVideoPlayer')).toHaveClass(/fullWindow/)
  await page.evaluate(() => {
    const player = document.querySelector('.ftVideoPlayer')
    const controls = player.querySelector('.shaka-controls-container')
    const seekBar = controls.querySelector('.shaka-seek-bar-container')
    const actionDock = player.querySelector('.fullscreenActions')
    const notice = document.createElement('div')
    const noticeAction = document.createElement('button')
    const annotations = document.createElement('div')
    const endCard = document.createElement('button')

    player.dir = 'rtl'
    controls.setAttribute('shown', 'true')
    window.__keepTestControlsShown = new MutationObserver(() => {
      if (controls.getAttribute('shown') !== 'true') controls.setAttribute('shown', 'true')
    })
    window.__keepTestControlsShown.observe(controls, {
      attributeFilter: ['shown'],
      attributes: true,
    })

    notice.className = 'skippedSegmentsWrapper'
    for (const { name } of actionDock.attributes) {
      if (name.startsWith('data-v-')) {
        notice.setAttribute(name, '')
        noticeAction.setAttribute(name, '')
      }
    }
    noticeAction.className = 'skippedSegment'
    noticeAction.textContent = 'SponsorBlock action'
    noticeAction.addEventListener('click', (event) => {
      event.stopPropagation()
      window.__sponsorBlockActionClicked = true
    })
    notice.append(noticeAction)

    annotations.className = 'videoAnnotations'
    Object.assign(annotations.style, {
      position: 'absolute',
      inset: '0',
      zIndex: '2',
      pointerEvents: 'none',
    })
    endCard.className = 'annotation'
    endCard.textContent = 'End card'
    Object.assign(endCard.style, {
      position: 'absolute',
      inlineSize: '220px',
      blockSize: '180px',
      pointerEvents: 'auto',
    })
    annotations.append(endCard)
    player.append(notice, annotations)

    const playerBounds = player.getBoundingClientRect()
    const seekBounds = seekBar.getBoundingClientRect()
    endCard.style.left = 'calc(50% - 110px)'
    endCard.style.top = `${seekBounds.top - playerBounds.top - 90}px`
  })

  const player = page.locator('.ftVideoPlayer')
  const controls = player.locator('.shaka-controls-container')
  const bottomControls = controls.locator('.shaka-bottom-controls')
  const seekBar = controls.locator('.shaka-seek-bar-container')
  const actionDock = player.locator('.fullscreenActions')
  const notice = player.locator('.skippedSegmentsWrapper')
  const endCard = player.locator('.annotation')

  const alignEndCardWithSeekBar = () => player.evaluate((element) => {
    const playerBounds = element.getBoundingClientRect()
    const seekBounds = element.querySelector('.shaka-seek-bar-container').getBoundingClientRect()
    element.querySelector('.annotation').style.top = `${seekBounds.top - playerBounds.top - 90}px`
  })
  await expect(controls).toHaveAttribute('shown', 'true')
  await expect(player).toHaveAttribute('data-action-dock-visible', 'true')
  await expect(player).toHaveAttribute('data-player-controls-shown', 'true')

  const verticalGap = () => player.evaluate((element) => {
    const dockBounds = element.querySelector('.fullscreenActions').getBoundingClientRect()
    const noticeBounds = element.querySelector('.skippedSegmentsWrapper').getBoundingClientRect()
    return dockBounds.top - noticeBounds.bottom
  })
  const noticeBottom = () => player.evaluate((element) => {
    const playerBounds = element.getBoundingClientRect()
    const noticeBounds = element.querySelector('.skippedSegmentsWrapper').getBoundingClientRect()
    return playerBounds.bottom - noticeBounds.bottom
  })
  const hitOwnership = () => player.evaluate((element) => {
    const seekBar = element.querySelector('.shaka-seek-bar-container')
    const endCard = element.querySelector('.annotation')
    const seekBounds = seekBar.getBoundingClientRect()
    const cardBounds = endCard.getBoundingClientRect()
    const seekHit = document.elementFromPoint(
      seekBounds.left + seekBounds.width / 2,
      seekBounds.top + seekBounds.height / 2
    )
    const cardHit = document.elementFromPoint(
      element.dir === 'rtl' ? cardBounds.right - 20 : cardBounds.left + 20,
      cardBounds.top + 20
    )

    return {
      cardOwnsClearArea: endCard.contains(cardHit),
      controlsOwnSeekBar: seekBar.contains(seekHit),
    }
  })

  await expect(actionDock).toHaveCSS('opacity', '1')
  await expect(actionDock).toHaveCSS('pointer-events', 'auto')
  await expect(notice).toHaveCSS('bottom', '164px')
  await expect.poll(verticalGap).toBeGreaterThanOrEqual(8)
  await expect.poll(() => player.evaluate((element) => {
    const playerBounds = element.getBoundingClientRect()
    const dockBounds = element.querySelector('.fullscreenActions').getBoundingClientRect()
    return playerBounds.bottom - dockBounds.bottom
  })).toBeCloseTo(106, 0)
  const raisedNoticeBottom = await noticeBottom()

  await expect(controls).toHaveCSS('z-index', 'auto')
  await expect(bottomControls).toHaveCSS('z-index', '3')
  const [seekBounds, cardBounds] = await Promise.all([
    seekBar.boundingBox(),
    endCard.boundingBox(),
  ])
  expect(seekBounds.y).toBeLessThan(cardBounds.y + cardBounds.height)
  expect(seekBounds.y + seekBounds.height).toBeGreaterThan(cardBounds.y)
  await expect.poll(async () => {
    const ownership = await hitOwnership()
    return {
      cardOwnsClearArea: ownership.cardOwnsClearArea,
      controlsOwnSeekBar: ownership.controlsOwnSeekBar,
    }
  }).toEqual({ cardOwnsClearArea: true, controlsOwnSeekBar: true })
  await notice.getByRole('button', { name: 'SponsorBlock action' }).click()
  await expect.poll(() => page.evaluate(() => window.__sponsorBlockActionClicked)).toBe(true)

  await seekBar.evaluate((element) => {
    window.__seekDragEvents = []
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
      element.addEventListener(type, () => window.__seekDragEvents.push(type), {
        capture: true,
      })
    }
  })
  const dragBounds = await seekBar.boundingBox()
  await page.mouse.move(dragBounds.x + dragBounds.width / 2, dragBounds.y + dragBounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(dragBounds.x + dragBounds.width / 2 + 40, dragBounds.y + dragBounds.height / 2)
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.__seekDragEvents)).toEqual([
    'pointermove',
    'pointerdown',
    'pointermove',
    'pointerup',
  ])

  for (const { width, height, direction, zoom } of [
    { width: 480, height: 800, direction: 'ltr', zoom: 1 },
    { width: 1024, height: 768, direction: 'rtl', zoom: 1.25 },
  ]) {
    await page.evaluate((factor) => window.ftElectron.setZoomFactor(factor), zoom)
    await setWindowSize(app, page, { width, height })
    await player.evaluate((element, dir) => { element.dir = dir }, direction)
    await alignEndCardWithSeekBar()
    await expect.poll(verticalGap).toBeGreaterThanOrEqual(8)
    await expect.poll(async () => {
      const ownership = await hitOwnership()
      return {
        cardOwnsClearArea: ownership.cardOwnsClearArea,
        controlsOwnSeekBar: ownership.controlsOwnSeekBar,
      }
    }).toEqual({ cardOwnsClearArea: true, controlsOwnSeekBar: true })
  }

  const moreOptions = player.getByRole('button', { name: 'More settings' })
  const overflowMenu = player.locator('.shaka-overflow-menu')
  await moreOptions.click()
  const zoomMenuButton = overflowMenu.getByRole('button', { name: 'Zoom' })
  await expect(controls).toHaveCSS('z-index', '9')
  await endCard.evaluate((element) => {
    const playerBounds = element.closest('.ftVideoPlayer').getBoundingClientRect()
    const menuButtonBounds = document.querySelector('.shaka-overflow-menu .video-zoom-button')
      .getBoundingClientRect()
    element.style.left = `${menuButtonBounds.left - playerBounds.left}px`
    element.style.top = `${menuButtonBounds.top - playerBounds.top}px`
  })
  await expect.poll(async () => zoomMenuButton.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return element.contains(document.elementFromPoint(
      bounds.left + bounds.width / 2,
      bounds.top + bounds.height / 2
    ))
  })).toBe(true)
  await zoomMenuButton.click()
  await expect(player).toHaveAttribute('data-submenu-opened', 'true')
  await expect(actionDock).toHaveCSS('opacity', '0')
  await expect(actionDock).toHaveCSS('pointer-events', 'none')
  await expect.poll(noticeBottom).toBeLessThan(raisedNoticeBottom - 40)

  await player.locator('.video-zoom-menu .shaka-back-to-overflow-button').click()
  await expect(player).toHaveAttribute('data-submenu-opened', 'false')
  await expect(actionDock).toHaveCSS('opacity', '1')
  await expect(actionDock).toHaveCSS('pointer-events', 'auto')
  await expect.poll(verticalGap).toBeGreaterThanOrEqual(8)
  await moreOptions.click()
  await expect(overflowMenu).toBeHidden()
  await alignEndCardWithSeekBar()

  await player.locator('video').evaluate(element => element.pause())
  await watchComponent.evaluate(async (component) => {
    await component.proxy.$store.dispatch('updateShowPlayerControlsWhenPaused', false)
    component.proxy.$refs.player.$.setupState.pausedInterfaceRevealed = false
    await component.proxy.$nextTick()
  })
  await expect(player).toHaveClass(/playerPaused/)
  await expect(player).toHaveAttribute('data-player-controls-shown', 'false')
  await expect(bottomControls).toHaveCSS('z-index', '1')
  await expect.poll(async () => {
    const ownership = await hitOwnership()
    return {
      cardOwnsClearArea: ownership.cardOwnsClearArea,
      controlsOwnSeekBar: ownership.controlsOwnSeekBar,
    }
  }).toEqual({ cardOwnsClearArea: true, controlsOwnSeekBar: false })
  await watchComponent.evaluate(async (component) => {
    await component.proxy.$store.dispatch('updateShowPlayerControlsWhenPaused', true)
    await component.proxy.$nextTick()
  })
  await expect(player).toHaveAttribute('data-player-controls-shown', 'true')
  await player.locator('video').evaluate(element => element.play())
  await expect(player).not.toHaveClass(/playerPaused/)

  await controls.evaluate(element => {
    window.__keepTestControlsShown.disconnect()
    element.removeAttribute('shown')
  })
  await expect(player).toHaveAttribute('data-action-dock-visible', 'false')
  await expect(player).toHaveAttribute('data-player-controls-shown', 'false')
  await expect(actionDock).toHaveCSS('opacity', '0')
  await expect(bottomControls).toHaveCSS('z-index', '1')
  await endCard.evaluate(element => { element.style.top = '100px' })
  await endCard.click({ trial: true })

  const dockFocusAction = actionDock.locator('.fullscreenShareAction > .iconButton')
  await expect(dockFocusAction).toHaveCount(1)
  await dockFocusAction.focus()
  await expect(actionDock).toHaveCSS('opacity', '1')
  await expect(player).toHaveAttribute('data-action-dock-visible', 'true')
  await expect.poll(verticalGap).toBeGreaterThanOrEqual(8)
  await dockFocusAction.evaluate(element => element.blur())
  await expect(actionDock).toHaveCSS('opacity', '0')
  await expect.poll(noticeBottom).toBeLessThan(raisedNoticeBottom - 40)

  await watchComponent.evaluate(async (component) => {
    component.proxy.$refs.player.$.setupState.fullWindowEnabled = false
    await component.proxy.$nextTick()
  })
  await expect(player).not.toHaveClass(/fullWindow/)
  await expect(notice).toHaveCSS('bottom', /.+/)
  await expect.poll(noticeBottom).toBeLessThan(raisedNoticeBottom - 40)

  await page.locator('.app').evaluate(element => element.classList.remove('capacitorTabs'))
  await watchComponent.evaluate(async (component) => {
    component.proxy.$refs.player.$.setupState.fullWindowEnabled = true
    await component.proxy.$nextTick()
  })
  await expect(player).toHaveClass(/fullWindow/)
  await controls.evaluate(element => element.setAttribute('shown', 'true'))
  await expect(controls).toHaveCSS('z-index', '1')
  await expect(bottomControls).toHaveCSS('z-index', '1')
  await moreOptions.click()
  await overflowMenu.getByRole('button', { name: 'Zoom' }).click()
  await expect(player).toHaveAttribute('data-submenu-opened', 'true')
  await expect(actionDock).toHaveCSS('opacity', '1')
  await expect(actionDock).toHaveCSS('pointer-events', 'auto')
  await player.locator('.video-zoom-menu .shaka-back-to-overflow-button').click()
  await moreOptions.click()
  await endCard.click({ trial: true })
  await watchComponent.dispose()
})

test('paid promotion badge follows the full-window title visibility', async ({ page }) => {
  const playerStyles = await readFile(
    path.join(
      repoRoot,
      'src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.css'
    ),
    'utf8'
  )
  await page.addStyleTag({
    content: playerStyles.replaceAll(/:deep\(((?:[^()]|\([^()]*\))*)\)/g, '$1')
  })
  await page.evaluate(() => {
    const player = document.createElement('div')
    const badge = document.createElement('button')
    const controls = document.createElement('div')
    player.className = 'ftVideoPlayer fullWindow'
    badge.className = 'paidPromotionOverlay'
    controls.className = 'shaka-controls-container'
    controls.setAttribute('shown', 'true')
    player.append(badge, controls)
    document.body.append(player)
  })

  const player = page.locator('.ftVideoPlayer')
  const badge = player.locator('.paidPromotionOverlay')
  const controls = player.locator('.shaka-controls-container')
  await expect(badge).toHaveCSS('top', '65px')
  await expect(badge).toHaveCSS('transition-delay', '0s, 0s')
  const [playerBounds, visibleTitleBadgeBounds] = await Promise.all([
    player.boundingBox(),
    badge.boundingBox(),
  ])
  expect(playerBounds).not.toBeNull()
  expect(visibleTitleBadgeBounds).not.toBeNull()
  expect(visibleTitleBadgeBounds.y - playerBounds.y).toBeCloseTo(65, 0)

  await controls.evaluate(element => element.setAttribute('shown', 'false'))
  await expect(badge).toHaveCSS('transition-delay', '0s, 0.45s')
  const badgePositionTransition = await badge.evaluateHandle((element) => {
    const transition = element.getAnimations().find(animation =>
      animation instanceof CSSTransition &&
      ['inset-block-start', 'top'].includes(animation.transitionProperty)
    )
    if (!transition) {
      throw new Error('Paid promotion badge position transition not found')
    }
    transition.pause()
    return transition
  })
  await badgePositionTransition.evaluate((transition) => {
    transition.currentTime = 300
  })
  const fadingTitleBadgeBounds = await badge.boundingBox()
  expect(fadingTitleBadgeBounds.y).toBeCloseTo(visibleTitleBadgeBounds.y, 0)
  await badgePositionTransition.evaluate((transition) => {
    transition.currentTime = 600
  })
  const hiddenTitleBadgeBounds = await badge.boundingBox()
  expect(hiddenTitleBadgeBounds.y - playerBounds.y).toBeCloseTo(12, 0)
  await badgePositionTransition.dispose()

  await player.evaluate((element) => {
    element.classList.remove('fullWindow')
    element.classList.add('presentationModeChanging')
  })
  await controls.evaluate(element => element.setAttribute('shown', 'true'))
  await player.evaluate(element => element.classList.add('fullWindow'))
  await expect(badge).toHaveCSS('top', '65px')
  await expect(badge).toHaveCSS('transition-property', 'opacity')
})

test('Shorts top controls stay visible over white video content', async ({ page }) => {
  await goTo(page, 'history')
  const playerStyles = await readFile(
    path.join(
      repoRoot,
      'src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.css'
    ),
    'utf8'
  )
  const captionsButtonSource = await readFile(
    path.join(
      repoRoot,
      'src/renderer/components/ft-shaka-video-player/player-components/CaptionToggleButton.js'
    ),
    'utf8'
  )
  const outlinedCaptionsIcon = captionsButtonSource.match(
    /export const CLOSED_CAPTIONS_OUTLINED = '([^']+)'/
  )?.[1]
  expect(outlinedCaptionsIcon?.length).toBeGreaterThan(100)
  await page.addStyleTag({
    content: playerStyles.replaceAll(/:deep\(((?:[^()]|\([^()]*\))*)\)/g, '$1')
  })
  await page.evaluate((captionsIconPath) => {
    const player = document.createElement('div')
    const topControls = document.createElement('div')
    const group = document.createElement('div')
    const control = document.createElement('button')
    const volume = document.createElement('div')
    const volumeButton = document.createElement('button')
    const volumeSlider = document.createElement('input')
    const captions = document.createElement('button')
    const captionsIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const captionsPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    const captionsSlash = document.createElement('span')
    const shakaControls = document.createElement('div')
    const seekBar = document.createElement('div')
    const seekInput = document.createElement('input')

    player.className = 'ftVideoPlayer shortsPlayer shortsPaused'
    player.style.backgroundColor = '#fff'
    player.style.borderRadius = '16px'
    player.style.inset = '300px auto auto 300px'
    player.style.position = 'fixed'
    player.style.width = '360px'
    player.style.height = '640px'
    player.style.zIndex = '10000'
    player.style.setProperty('--ui-roundness', '1')
    topControls.className = 'shortsTopControls'
    group.className = 'shortsTopControlsGroup'
    control.className = 'shortsTopControl'
    control.textContent = '⋮'
    volume.className = 'shortsVolumeControl'
    volumeButton.className = 'shortsTopControl'
    volumeButton.textContent = '🔊'
    volumeSlider.className = 'shortsVolumeSlider'
    volumeSlider.type = 'range'
    captions.className = 'shortsTopControl shortsCaptionsControl'
    captionsIcon.classList.add('shortsCaptionsControlIcon')
    captionsPath.setAttribute('d', captionsIconPath)
    captionsSlash.className = 'shortsCaptionsControlSlash'
    captionsIcon.append(captionsPath)
    captions.append(captionsIcon, captionsSlash)
    volume.append(volumeButton, volumeSlider)
    group.append(control, volume, captions)
    topControls.append(group)
    shakaControls.className = 'shaka-controls-container'
    seekBar.className = 'shaka-seek-bar-container'
    seekInput.className = 'shaka-range-element'
    seekInput.type = 'range'
    seekBar.append(seekInput)
    shakaControls.append(seekBar)
    player.append(topControls, shakaControls)
    document.body.append(player)
  }, outlinedCaptionsIcon)

  const player = page.locator('.ftVideoPlayer.shortsPlayer')
  const topControls = player.locator('.shortsTopControls')
  const control = page.locator('.shortsTopControl').first()
  await expect(topControls).toHaveCSS('opacity', '1')
  await expect(topControls).toHaveCSS('border-top-left-radius', '16px')
  await expect(topControls).toHaveCSS('border-top-right-radius', '16px')
  await expect(topControls).toHaveCSS('transition-duration', '0.15s, 0.25s, 0.25s')
  await expect(control).toHaveCSS('backdrop-filter', /blur\(8px\)/)
  await control.evaluate(element => element.classList.add('active'))
  await expect(control).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.52)')

  const volume = page.locator('.shortsVolumeControl')
  const volumeButton = volume.locator('.shortsTopControl')
  const volumeSlider = volume.locator('.shortsVolumeSlider')
  await expect(volumeSlider).toHaveCSS('inline-size', '0px')
  await expect(volumeSlider).toHaveCSS('opacity', '0')
  await volumeButton.focus()
  await expect(volume).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.44)')
  await expect(volumeButton).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(volumeButton).toHaveCSS('backdrop-filter', 'none')
  await expect(volumeSlider).toHaveCSS('inline-size', '96px')
  await expect(volumeSlider).toHaveCSS('opacity', '1')

  const captions = player.locator('.shortsCaptionsControl')
  expect((await captions.locator('path').getAttribute('d')).length).toBeGreaterThan(100)
  await expect(captions.locator('.shortsCaptionsControlIcon')).toHaveCSS('width', '28px')
  await expect(captions.locator('.shortsCaptionsControlIcon')).toHaveCSS('height', '28px')
  await expect(captions.locator('.shortsCaptionsControlSlash')).toHaveCSS(
    'transform',
    /matrix\([^)]*0\.707107/
  )
  await captions.evaluate(element => element.classList.add('active'))
  await expect(captions.locator('.shortsCaptionsControlSlash')).toHaveCSS(
    'transform',
    /matrix\(0, 0, -0\.707107, 0\.707107/
  )

  const seekBar = player.locator('.shaka-seek-bar-container')
  await expect(seekBar).toHaveCSS('height', '3px')
  await expect(seekBar).toHaveCSS('bottom', '-2px')
  await expect(seekBar).toHaveCSS('left', '12px')
  await expect(seekBar).toHaveCSS('right', '12px')
  await expect(seekBar).toHaveCSS('opacity', '1')
  const seekThumbRules = await page.evaluate(() => {
    return [...document.styleSheets]
      .flatMap(styleSheet => [...styleSheet.cssRules])
      .filter(rule => rule.selectorText?.includes(
        '.shaka-range-element::-webkit-slider-thumb'
      ))
      .map(rule => ({
        selector: rule.selectorText,
        opacity: rule.style.opacity,
        transform: rule.style.transform,
        transition: rule.style.transition,
      }))
  })
  expect(seekThumbRules).toEqual(expect.arrayContaining([
    expect.objectContaining({
      opacity: '0',
      transform: 'scale(0)',
      transition: expect.stringContaining('120ms'),
    }),
    expect.objectContaining({ opacity: '1', transform: 'scale(1)' }),
  ]))
  const [playerBounds, seekBounds] = await Promise.all([
    player.boundingBox(),
    seekBar.boundingBox(),
  ])
  expect(seekBounds.y + seekBounds.height).toBeGreaterThan(playerBounds.y + playerBounds.height)

  await player.evaluate(element => element.classList.remove('shortsPaused'))
  await expect(topControls).toHaveCSS('opacity', '0')
  await expect(topControls).toHaveCSS('transition-duration', '0.6s, 0s')

  await player.evaluate(element => {
    const actionDock = document.createElement('div')
    actionDock.className = 'fullscreenActions'
    element.classList.add('fullWindow')
    element.append(actionDock)
  })
  const actionDock = player.locator('.fullscreenActions')
  await expect(actionDock).toHaveCSS('display', 'flex')
  await expect(actionDock).toHaveCSS('opacity', '1')
  await expect(actionDock).toHaveCSS('pointer-events', 'auto')
})

test('compact chapters button marks its open state', async ({ page }) => {
  await goTo(page, 'history')
  const playerStyles = await readFile(
    path.join(
      repoRoot,
      'src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.css'
    ),
    'utf8'
  )
  // The component scopes these rules with :deep(), which the browser cannot parse on its own
  await page.addStyleTag({
    content: playerStyles.replaceAll(/:deep\(((?:[^()]|\([^()]*\))*)\)/g, '$1')
  })
  await page.evaluate(() => {
    const panel = document.createElement('div')
    const button = document.createElement('button')
    const icon = document.createElement('span')

    panel.className = 'shaka-controls-button-panel ft-controls-compact-chapters'
    panel.style.inset = '300px auto auto 300px'
    panel.style.position = 'fixed'
    panel.style.zIndex = '10000'
    button.className = 'ft-chapters-button'
    icon.className = 'ft-chapters-icon'
    button.append(icon)
    panel.append(button)
    document.body.append(panel)
  })

  const button = page.locator('.ft-controls-compact-chapters > .ft-chapters-button')
  const highlightColor = () => button.evaluate((element) => {
    return getComputedStyle(element, '::before').backgroundColor
  })

  await expect(button).toBeVisible()
  await expect.poll(highlightColor).toBe('rgba(0, 0, 0, 0)')
  await button.evaluate(element => element.classList.add('open'))
  await expect.poll(highlightColor).toBe('rgba(255, 255, 255, 0.2)')
})

test.describe('autosized prompts', () => {
  test.use({
    seed: {
      history: [historyEntry('aaaaaaaaaaa', 'History entry', Date.now())]
    }
  })

  test('centers the Delete Old History dialog in the viewport', async ({ page }) => {
    await goTo(page, 'history')
    await page.getByRole('button', { name: 'Delete Old History' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect.poll(() => dialog.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return Math.abs(bounds.left + bounds.width / 2 - window.innerWidth / 2)
    })).toBeLessThanOrEqual(1)
    await expect.poll(() => dialog.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return Math.abs(bounds.top + bounds.height / 2 - window.innerHeight / 2)
    })).toBeLessThanOrEqual(1)
  })
})

test('isolates the owning video surface while Android Picture-in-Picture is active', async ({ page }) => {
  await goTo(page, 'home')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('body')).toHaveAttribute('data-system-theme', 'light')
  await page.evaluate(() => {
    for (const target of [false, true]) {
      const player = document.createElement('div')
      player.className = 'ftVideoPlayer'
      if (target) player.setAttribute('data-android-picture-in-picture-target', '')
      const video = document.createElement('video')
      video.className = 'player'
      player.append(video)
      const canvas = document.createElement('canvas')
      canvas.className = 'vrCanvas'
      player.append(canvas)
      document.querySelector('.app > .routerView').append(player)
    }
    document.body.classList.add('androidPictureInPicture')
  })

  await expect(page.locator('.topNav')).toHaveCSS('visibility', 'hidden')
  await expect(page.locator('.app > .routerView')).toHaveCSS('container-type', 'normal')
  await expect(page.locator('.ftVideoPlayer').first()).toHaveCSS('visibility', 'hidden')
  const target = page.locator('[data-android-picture-in-picture-target]')
  await expect(target).toHaveCSS('visibility', 'visible')
  await expect(target.locator('> .player')).toHaveCSS('visibility', 'visible')
  await expect(target.locator('> .player')).toHaveCSS('transition-property', 'none')
  await expect(target.locator('> .vrCanvas')).toHaveCSS('transition-property', 'none')
  await expect.poll(() => target.evaluate(element => {
    const fillsViewport = (bounds) => {
      return Math.abs(bounds.top) <= 1 &&
        Math.abs(bounds.right - window.innerWidth) <= 1 &&
        Math.abs(bounds.bottom - window.innerHeight) <= 1 &&
        Math.abs(bounds.left) <= 1
    }
    return {
      target: fillsViewport(element.getBoundingClientRect()),
      video: fillsViewport(element.querySelector(':scope > .player').getBoundingClientRect()),
    }
  })).toEqual({ target: true, video: true })

  // Vue replaces the class attribute when the player changes into its
  // cross-tab mini-player layout. PiP ownership must survive that update.
  await target.evaluate(element => {
    element.className = 'ftVideoPlayer scrollMiniPlayer'
  })
  await expect(target).toHaveAttribute('data-android-picture-in-picture-target', '')
  await expect(target.locator('> .player')).toHaveCSS('visibility', 'visible')

  // Entering Android PiP can change the reported system color scheme. Theme
  // updates must not discard the transient class that isolates the video.
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('body')).toHaveAttribute('data-system-theme', 'dark')
  await expect(page.locator('body')).toHaveClass(/androidPictureInPicture/)
  await expect(target).toHaveCSS('visibility', 'visible')
})

test.describe('thumbnail watched progress', () => {
  test.use({
    seed: {
      settings: { uiRoundness: 200 },
      history: [
        {
          ...historyEntry('00000000000', 'Unwatched video', Date.now() + 1000),
          watchProgress: 0,
        },
        historyEntry('aaaaaaaaaaa', 'Partially watched video', Date.now()),
        {
          ...historyEntry('bbbbbbbbbbb', 'Fully watched video', Date.now() - 1000),
          watchProgress: 60,
          isWatched: true,
        },
      ]
    }
  })

  test('renders no progress fill at zero percent', async ({ page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-item').filter({ hasText: 'Unwatched video' })
    await expect(video).toBeVisible()
    await expect(video.locator('.watchedProgressBar')).toHaveCount(0)
  })

  test('covers the complete curved thumbnail path at 100 percent', async ({ app, page }) => {
    await setWindowSize(app, page, { width: 375, height: 700 })
    await page.locator('.app').evaluate(element => {
      element.classList.add('capacitorTabs', 'capacitorPhoneLayout')
    })
    await goTo(page, 'history')

    const progressPath = page.locator('.ft-list-item')
      .filter({ hasText: 'Fully watched video' })
      .locator('.watchedProgressBar .embeddedProgressPath')
    await expect(progressPath).toBeVisible()

    const lengths = await progressPath.evaluate(element => ({
      dashLength: Number.parseFloat(element.style.strokeDasharray),
      pathLength: element.getTotalLength(),
    }))
    expect(lengths.dashLength).toBeCloseTo(lengths.pathLength, 1)
  })

  test('matches the configured thumbnail corner radius', async ({ page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-item').filter({ hasText: 'Partially watched video' })
    const thumbnail = video.locator('.thumbnailLink')
    const progress = video.locator('.watchedProgressBar')

    await expect(thumbnail).toHaveCSS('border-radius', '16px')
    await expect(progress).toBeVisible()
    const progressPath = progress.locator('.embeddedProgressPath')
    const progressGeometry = await progressPath.evaluate(element => {
      const line = getComputedStyle(element)
      return {
        path: element.getAttribute('d'),
        pathLength: element.getTotalLength(),
        strokeDasharray: element.style.strokeDasharray,
        strokeLinecap: line.strokeLinecap,
        strokeWidth: line.strokeWidth,
        vectorEffect: line.vectorEffect,
      }
    })
    expect(progressGeometry).toMatchObject({
      strokeLinecap: 'round',
      strokeWidth: '3px',
      vectorEffect: 'none',
    })
    expect(progressGeometry.path).toContain('A 14.5 14.5')
    const [visibleLength, gapLength] = progressGeometry.strokeDasharray
      .split(' ')
      .map(Number.parseFloat)
    expect(visibleLength / (gapLength / 2)).toBeCloseTo(0.167, 2)

    const thumbnailBounds = await thumbnail.boundingBox()
    const progressBounds = await progress.boundingBox()
    expect(Math.abs(progressBounds.y - thumbnailBounds.y)).toBeLessThanOrEqual(1)
    expect(Math.abs(progressBounds.height - thumbnailBounds.height)).toBeLessThanOrEqual(1)
    expect(Math.abs(progressBounds.width - thumbnailBounds.width)).toBeLessThanOrEqual(1)
    expect(progressGeometry.pathLength).toBeGreaterThan(thumbnailBounds.width - 20)

    const renderedDirection = () => progressPath.evaluate(element => {
      const matrix = element.getScreenCTM()
      const start = element.getPointAtLength(0).matrixTransform(matrix)
      const end = element.getPointAtLength(element.getTotalLength()).matrixTransform(matrix)
      return start.x < end.x ? 'ltr' : 'rtl'
    })
    await expect.poll(renderedDirection).toBe('ltr')
    await page.evaluate(() => {
      document.body.dir = 'rtl'
    })
    await expect.poll(renderedDirection).toBe('rtl')
  })

  test('keeps full progress aligned across Android screen shapes and UI scales', async ({ app, page }) => {
    await goTo(page, 'history')
    const progress = page.locator('.ft-list-item')
      .filter({ hasText: 'Fully watched video' })
      .locator('.watchedProgressBar')
    const progressPath = progress.locator('.embeddedProgressPath')
    const scenarios = [
      { width: 375, height: 700, layout: 'capacitorPhoneLayout', direction: 'ltr', scale: 1 },
      { width: 700, height: 375, layout: 'capacitorPhoneLayout', direction: 'rtl', scale: 1 },
      { width: 768, height: 1024, layout: 'capacitorTabletLayout', direction: 'ltr', scale: 1 },
      { width: 1024, height: 768, layout: 'capacitorTabletLayout', direction: 'rtl', scale: 0.95 },
    ]

    for (const scenario of scenarios) {
      await setWindowSize(app, page, { width: scenario.width, height: scenario.height })
      await page.evaluate(({ layout, direction, scale }) => {
        const application = document.querySelector('.app')
        application.classList.add('capacitorTabs')
        application.classList.remove('capacitorPhoneLayout', 'capacitorTabletLayout')
        application.classList.add(layout)
        document.body.dir = direction
        window.ftElectron.setZoomFactor(scale)
      }, scenario)
      await expect(progress).toBeVisible()
      await expect.poll(() => progress.evaluate(element => {
        const viewBox = element.viewBox.baseVal
        const style = getComputedStyle(element)
        return Math.max(
          Math.abs(viewBox.width - Number.parseFloat(style.width)),
          Math.abs(viewBox.height - Number.parseFloat(style.height))
        )
      })).toBeLessThan(0.1)

      const geometry = await progressPath.evaluate(element => ({
        dashLength: Number.parseFloat(element.style.strokeDasharray),
        pathLength: element.getTotalLength(),
        vectorEffect: getComputedStyle(element).vectorEffect,
      }))
      expect(geometry.dashLength).toBeCloseTo(geometry.pathLength, 1)
      expect(geometry.vectorEffect).toBe('none')
    }
  })
})

test.describe('toast timeout progress', () => {
  test.use({
    seed: {
      settings: {
        uiRoundness: 200,
        showToastTimeoutIndicator: true,
      }
    }
  })

  test('makes high-roundness timeout caps visible without scaling them', async ({ page }) => {
    await goTo(page, 'history')
    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('Rounded timeout progress', 10000)
    })

    const toast = page.locator('.toast', { hasText: 'Rounded timeout progress' })
    const track = toast.locator('..').locator('.timeout-indicator-track')
    const indicator = track.locator('.timeout-indicator')
    await expect(toast).toBeVisible()
    await toast.hover()
    await expect(track).toHaveCSS('border-radius', '24px')
    await expect(indicator).toHaveCSS('transform', 'none')
    const indicatorPath = indicator.locator('.embeddedProgressPath')
    const initialGeometry = await indicatorPath.evaluate(element => {
      const line = getComputedStyle(element)
      return {
        path: element.getAttribute('d'),
        strokeLinecap: line.strokeLinecap,
        strokeWidth: line.strokeWidth,
      }
    })
    expect(initialGeometry).toMatchObject({
      strokeLinecap: 'round',
      strokeWidth: '4px',
    })
    const [fullLength, gapLength] = await indicatorPath.evaluate(element => {
      return element.style.strokeDasharray.split(' ').map(Number.parseFloat)
    })
    expect(gapLength).toBeGreaterThan(fullLength)
    const arcRadius = Number.parseFloat(initialGeometry.path.match(/ A ([\d.]+)/)[1])
    expect(arcRadius).toBeGreaterThan(15)
    await page.waitForTimeout(100)
    expect(await indicatorPath.getAttribute('d')).toBe(initialGeometry.path)

    const [toastBounds, trackBounds, indicatorBounds] = await Promise.all([
      toast.boundingBox(),
      track.boundingBox(),
      indicator.boundingBox(),
    ])
    expect(Math.abs(trackBounds.x - toastBounds.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(trackBounds.y - toastBounds.y)).toBeLessThanOrEqual(1)
    expect(Math.abs(trackBounds.width - toastBounds.width)).toBeLessThanOrEqual(1)
    expect(Math.abs(trackBounds.height - toastBounds.height)).toBeLessThanOrEqual(1)
    expect(Math.abs(indicatorBounds.y - toastBounds.y)).toBeLessThanOrEqual(1)
    expect(Math.abs(indicatorBounds.height - toastBounds.height)).toBeLessThanOrEqual(1)
  })

  test('covers the complete curved toast path before its timeout starts', async ({ app, page }) => {
    await setWindowSize(app, page, { width: 375, height: 700 })
    await page.locator('.app').evaluate(element => {
      element.classList.add('capacitorTabs', 'capacitorPhoneLayout')
    })
    await goTo(page, 'history')
    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('Full timeout progress', 10000)
    })

    const toast = page.locator('.toast', { hasText: 'Full timeout progress' })
    const progressPath = toast.locator('..').locator('.timeout-indicator .embeddedProgressPath')
    await expect(progressPath).toBeVisible()
    await toast.hover()

    const lengths = await progressPath.evaluate(element => ({
      dashLength: Number.parseFloat(element.style.strokeDasharray),
      pathLength: element.getTotalLength(),
    }))
    expect(lengths.dashLength).toBeCloseTo(lengths.pathLength, 1)
  })

  test('stays wrapped around both corners until the toast has animated in', async ({ page }) => {
    await goTo(page, 'history')
    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('Held timeout progress', 6000)
    })

    // Scoped to this toast's own slot: any other toast on screen would bring its
    // own indicator, and picking the first one would sample the wrong duration
    const indicatorPath = page.locator('.toast', { hasText: 'Held timeout progress' })
      .locator('..')
      .locator('.timeout-indicator .embeddedProgressPath')
    await indicatorPath.waitFor()

    // Pausing removes the wall clock from the picture, so the sampled lengths
    // below depend only on the delay/duration the stylesheet asks for
    const timing = await indicatorPath.evaluate(element => {
      const animation = element.getAnimations()
        .find(candidate => candidate.animationName?.startsWith('toast-timeout'))
      animation.pause()
      window.__toastTimeout = animation
      return animation.effect.getComputedTiming()
    })
    // The drain has to wait out the enter transition, then use up the rest of
    // the toast's lifetime so it empties exactly as the toast is dismissed
    expect(timing.delay).toBe(300)
    expect(timing.duration).toBe(5700)

    /** @returns {Promise<{ full: number, visible: number, offset: number }>} */
    const sampleAt = time => indicatorPath.evaluate(async (element, time) => {
      window.__toastTimeout.currentTime = time
      await window.__toastTimeout.ready
      const style = getComputedStyle(element)
      return {
        full: Number.parseFloat(element.style.strokeDasharray),
        visible: Number.parseFloat(style.strokeDasharray),
        offset: Number.parseFloat(style.strokeDashoffset),
      }
    }, time)

    // Both bottom corner arcs are only a few percent of the path, so any drain
    // during the enter transition already eats the trailing one
    for (const time of [0, 150, 299]) {
      const held = await sampleAt(time)
      expect(held.visible, `held at ${time}ms`).toBeCloseTo(held.full, 3)
      expect(held.offset, `held at ${time}ms`).toBe(0)
    }

    const midway = await sampleAt(300 + 5700 / 2)
    expect(midway.visible).toBeCloseTo(midway.full / 2, 1)

    const finished = await sampleAt(6000)
    expect(finished.visible).toBeCloseTo(0, 3)
  })
})

test.describe('history reorder animation', () => {
  test.use({
    seed: {
      history: [
        historyEntry('aaaaaaaaaaa', 'Alpha video', Date.now() - 1000),
        historyEntry('bbbbbbbbbbb', 'Bravo video', Date.now() - 2000),
        historyEntry('ccccccccccc', 'Charlie video', Date.now() - 3000)
      ]
    }
  })

  // A reorder must move the existing DOM nodes, which is what lets the
  // TransitionGroup run its FLIP move animation. Index-derived keys made Vue
  // destroy and recreate the elements instead, which is the choppy "jump".
  test('reuses the same DOM nodes when entries are reordered', async ({ page }) => {
    await goTo(page, 'history')
    await expect(page.getByText('Alpha video')).toBeVisible()

    // Tag every rendered item so we can tell reuse from recreation.
    const tagged = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.autoGrid > *'))
      items.forEach((element, index) => {
        element.dataset.ftReorderProbe = String(index)
      })
      return items.length
    })
    expect(tagged).toBe(3)

    // Reorder the list, the same path a re-watched entry moving to the top takes.
    await page.locator('.sortSelect select').selectOption('earliest_played_first')

    const items = page.locator('.autoGrid > *')
    await expect(items.first()).toContainText('Charlie video')

    // Every element still carries its probe, i.e. nothing was recreated.
    const probes = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.autoGrid > *'))
        .map((element) => element.dataset.ftReorderProbe ?? null)
    )
    expect(probes).toHaveLength(3)
    expect(probes).not.toContain(null)
  })
})

test.describe('select dropdown pixel grid', () => {
  // A fractional device pixel ratio is what makes the misalignment visible.
  test.use({
    launchArgs: ['--force-device-scale-factor=1.5'],
    seed: { settings: { uiScale: 95 } }
  })

  test('keeps option text in place when it gains a hover background', async ({ page }) => {
    await goTo(page, 'settings')

    await page.getByRole('combobox', { name: 'Default Landing Page' }).first().click()
    const dropdown = page.locator('.selectDropdown')
    await expect(dropdown).toBeVisible()
    // Scaling a menu rasterizes its labels at changing subpixel positions.
    // Keep the open/close animation opacity-only so text stays stable.
    await expect(dropdown).toHaveCSS('transform', 'none')

    const dpr = await page.evaluate(() => window.devicePixelRatio)
    expect(Math.abs(dpr - 1.425)).toBeLessThan(0.001)

    const options = dropdown.locator('.selectOption')
    const inactiveOptionIndex = await options.evaluateAll(optionElements => {
      const menuBounds = optionElements[0].parentElement.getBoundingClientRect()
      return optionElements.findIndex(option => {
        const bounds = option.getBoundingClientRect()
        return !option.classList.contains('active') &&
          bounds.top >= menuBounds.top && bounds.bottom <= menuBounds.bottom
      })
    })
    expect(inactiveOptionIndex).toBeGreaterThanOrEqual(0)
    const option = options.nth(inactiveOptionIndex)
    // The option label is a direct text node, so measure its rendered range.
    const textPosition = () => option.evaluate(element => {
      const range = document.createRange()
      range.selectNodeContents(element)
      const bounds = range.getBoundingClientRect()
      return { x: bounds.x, y: bounds.y }
    })
    const beforeHover = await textPosition()

    await option.hover()
    await expect(option).toHaveClass(/active/)
    expect(await textPosition()).toEqual(beforeHover)

    const selectedOption = dropdown.locator('.selectOption[aria-selected="true"]')
    await selectedOption.hover()
    await expect(selectedOption).toHaveClass(/active/)
    const indicatorAppearance = await selectedOption.evaluate(element => {
      const hoverLayer = getComputedStyle(element, '::before')
      const selectedIndicator = getComputedStyle(element, '::after')
      return {
        hoverLayerZIndex: hoverLayer.zIndex,
        indicatorColor: selectedIndicator.backgroundColor,
        indicatorWidth: Number.parseFloat(selectedIndicator.width),
        indicatorZIndex: selectedIndicator.zIndex
      }
    })
    expect(indicatorAppearance).toMatchObject({
      hoverLayerZIndex: '-1',
      indicatorColor: 'rgb(33, 150, 243)',
      indicatorZIndex: '1'
    })
    expect(indicatorAppearance.indicatorWidth).toBeCloseTo(3, 1)

    // At arbitrary UI scales, fixed-height options cannot all start on device
    // pixels. Their stable paint layer must therefore prevent the hover
    // background itself from changing text rasterization.
  })
})

test('a save channel setting dropdown clears the fullscreen dock content', async ({ page }) => {
  await goTo(page, 'history')
  const playerStyles = await readFile(
    path.join(
      repoRoot,
      'src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.css'
    ),
    'utf8'
  )
  // The dropdown's own placement lives in FtIconButton's stylesheet, and it is
  // what puts the fly-out over the dock edge in the first place.
  const { compile } = await import('sass')
  const buttonStyles = compile(
    path.join(repoRoot, 'src/renderer/components/FtIconButton/FtIconButton.scss')
  ).css
  await page.addStyleTag({
    content: [playerStyles, buttonStyles]
      .join('\n')
      .replaceAll(/:deep\(((?:[^()]|\([^()]*\))*)\)/g, '$1')
  })

  // The dock stacks the video info card and the description as siblings and
  // clips whatever leaves its box. The button the dropdown hangs off sits at
  // the dock's start edge, and the dropdown drops over the description below.
  await page.evaluate(() => {
    const dock = document.createElement('div')
    const info = document.createElement('div')
    const buttons = document.createElement('div')
    const options = document.createElement('div')
    const iconButton = document.createElement('div')
    const dropdown = document.createElement('div')
    const description = document.createElement('div')

    dock.className = 'fullscreenMetadataTarget'
    dock.style.cssText = 'position:fixed;inset:100px auto auto 400px;width:420px;height:420px;z-index:10000;background:#222'
    info.className = 'watchVideo watchVideoInfo'
    buttons.className = 'videoButtons'
    options.className = 'videoOptions'
    iconButton.className = 'iconButton'
    iconButton.style.cssText = 'position:relative;inline-size:30px;block-size:30px'
    dropdown.className = 'iconDropdown left bottom'
    dropdown.textContent = 'Save video quality'
    dropdown.style.inlineSize = '220px'
    dropdown.style.blockSize = '120px'
    description.className = 'watchVideo videoDescription'
    description.textContent = 'Description text that follows the info card'
    description.style.cssText = 'block-size:200px;background:#111'

    iconButton.append(dropdown)
    options.append(iconButton)
    buttons.append(options)
    info.append(buttons)
    dock.append(info, description)
    document.body.append(dock)
  })

  const dropdown = page.locator('.fullscreenMetadataTarget .iconDropdown')
  await expect(dropdown).toBeVisible()

  await expect.poll(() => dropdown.evaluate((element) => {
    const dock = element.closest('.fullscreenMetadataTarget')
    const bounds = element.getBoundingClientRect()
    const dockBounds = dock.getBoundingClientRect()
    const hit = document.elementFromPoint(
      bounds.left + bounds.width / 2,
      bounds.bottom - 8
    )
    return {
      // Not cut off by the dock, which clips its inline axis
      insideDock: bounds.left >= dockBounds.left && bounds.right <= dockBounds.right,
      // Not painted over by the description card that follows
      onTop: hit === element || element.contains(hit)
    }
  })).toEqual({ insideDock: true, onTop: true })
})

for (const scale of [1, 1.25]) {
  test(`tablet tab touch highlight covers the close-button area at scale ${scale}`, async ({ app, page }) => {
    await setWindowSize(app, page, { width: 1200, height: 850 })
    await page.evaluate(scale => window.ftElectron.setZoomFactor(scale), scale)
    await page.addStyleTag({ path: path.join(repoRoot, 'src/renderer/components/TabBar/CapacitorTabletTabBar.css') })
    await page.evaluate(() => {
      const bar = document.createElement('div')
      bar.className = 'capacitorTabletTabBar'
      bar.style.cssText = 'position:fixed;z-index:10000;top:120px;left:0;--side-nav-hover-color:rgb(50,60,70);--card-bg-color:rgb(20,25,30)'
      const tab = document.createElement('div')
      tab.className = 'capacitorTabletTab'
      const target = document.createElement('button')
      target.className = 'capacitorTabletTabTarget'
      target.textContent = 'Subscriptions'
      const close = document.createElement('button')
      close.className = 'capacitorTabletTabClose'
      close.textContent = '×'
      tab.append(target, close)
      bar.append(tab)
      document.body.append(bar)
    })
    const cdp = await page.context().newCDPSession(page)
    const tab = page.locator('.capacitorTabletTab')
    const target = tab.locator('.capacitorTabletTabTarget')
    try {
      for (const roundness of [0, 1, 2]) {
        await tab.evaluate((element, value) => element.style.setProperty('--ui-roundness', value), String(roundness))
        await expect(tab).toHaveCSS('border-top-left-radius', `${6 * roundness}px`)
        await expect(tab).toHaveCSS('border-top-right-radius', `${6 * roundness}px`)
        await expect(tab).toHaveCSS('border-bottom-left-radius', '0px')
        await expect(tab.locator('.capacitorTabletTabClose')).toHaveCSS('border-top-left-radius', `${4 * roundness}px`)
      }
      for (const selected of [false, true]) {
        await tab.evaluate((element, selected) => element.classList.toggle('active', selected), selected)
        const bounds = await target.boundingBox()
        expect(await target.evaluate(element => {
          const r = element.getBoundingClientRect()
          return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
        })).toBe(true)
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }] })
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        expect(await target.evaluate(element => element.matches(':hover, :active'))).toBe(true)
        await expect(tab).toHaveCSS('background-color', 'rgb(50, 60, 70)', { timeout: 1500 })
        await expect(target).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
        await expect(tab.locator('.capacitorTabletTabClose')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 700, y: 400 }] })
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await expect(tab).toHaveCSS('background-color', selected ? 'rgb(20, 25, 30)' : 'rgba(0, 0, 0, 0)')
        const close = tab.locator('.capacitorTabletTabClose')
        const closeBounds = await close.boundingBox()
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: closeBounds.x + closeBounds.width / 2, y: closeBounds.y + closeBounds.height / 2 }] })
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        const colors = await close.evaluate(element => {
          const style = getComputedStyle(element)
          const probe = document.createElement('span')
          probe.style.backgroundColor = 'color-mix(in srgb, var(--destructive-color) 25%, transparent)'
          probe.style.color = style.getPropertyValue('--destructive-color')
          element.append(probe)
          const colors = { background: getComputedStyle(probe).backgroundColor, text: getComputedStyle(probe).color }
          probe.remove()
          return colors
        })
        await expect(close).toHaveCSS('background-color', colors.background)
        await expect(close).toHaveCSS('color', colors.text)
        await expect(tab).toHaveCSS('background-color', selected ? 'rgb(20, 25, 30)' : 'rgba(0, 0, 0, 0)')
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 700, y: 400 }] })
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await expect(close).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      }
    } finally {
      await cdp.detach()
    }
  })
}
