import { test, expect, goTo } from '../../helpers/app.mjs'

const VIDEO_ID = 'jNQXAC9IVRw'

const SEED = {
  history: [{
    _id: VIDEO_ID,
    videoId: VIDEO_ID,
    title: 'Video menu test',
    author: 'Test Channel',
    authorId: 'UCaaaaaaaaaaaaaaaaaaaaaa',
    published: Date.now() - 86400000,
    description: 'Video description',
    viewCount: 1234,
    lengthSeconds: 60,
    watchProgress: 10,
    timeWatched: Date.now(),
    isWatched: false,
    isLive: false,
    type: 'video'
  }]
}

test.use({ seed: SEED })

test('the whole video card offers one menu with video and link actions', async ({ page, app, attachScreenshot }) => {
  await goTo(page, 'history')
  const card = page.locator('.ft-list-video').first()
  await expect(card.getByTitle('More Options', { exact: true })).toHaveCount(0)
  const menu = page.getByRole('menu', { name: 'Context menu', exact: true })

  for (const selector of ['.thumbnailImage', '.h3Title', '.channelName', '.videoInfo', '.info']) {
    await card.locator(selector).first().click({ button: 'right' })
    await expect(menu).toBeVisible()
    for (const label of ['Play Next', 'Add to Queue', 'Mark As Watched', 'Remove From History', 'Copy YouTube Link', 'Open in a New Tab', 'Open in a New Window']) {
      await expect(menu.getByRole('menuitem', { name: label, exact: true })).toBeVisible()
    }
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  }

  await card.locator('.title').focus()
  await page.keyboard.press('Shift+F10')
  await expect(menu.getByRole('menuitem').first()).toBeFocused()
  await expect(menu.getByRole('menuitem', { name: /without playlist/ })).toHaveCount(0)
  await expect(menu).toHaveCSS('opacity', '1')
  await attachScreenshot('unified video context menu')
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem').nth(1)).toBeFocused()
  await menu.getByRole('menuitem', { name: 'Copy YouTube Link', exact: true }).click()
  await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(`https://youtu.be/${VIDEO_ID}`)
  await expect(card.locator('.title')).toBeFocused()

  await card.locator('.videoInfo').click({ button: 'right' })
  await menu.getByRole('menuitem', { name: 'Mark As Watched', exact: true }).click()
  await expect(card).toHaveClass(/watched/)
  await card.locator('.videoInfo').click({ button: 'right' })
  await expect(menu.getByRole('menuitem', { name: 'Unmark As Watched', exact: true })).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Remove From History', exact: true }).click()
  await expect(card).toHaveCount(0)
})

for (const uiScale of [100, 125]) {
  test.describe(`video context menu at ${uiScale}% UI scale`, () => {
    test.use({ seed: { ...SEED, settings: { uiScale } } })

    test('touch opens the menu without navigating and keeps actions within the viewport', async ({ page }) => {
      await goTo(page, 'history')
      const session = await page.context().newCDPSession(page)
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
      const menu = page.locator('.contextMenu')
      try {
        for (const viewport of [{ width: 375, height: 812 }, { width: 812, height: 375 }, { width: 1024, height: 768 }]) {
          await page.setViewportSize(viewport)
          const card = page.locator('.ft-list-video').first()
          await card.locator('.title').scrollIntoViewIfNeeded()
          const bounds = await card.locator('.title').boundingBox()
          await session.send('Input.dispatchTouchEvent', {
            type: 'touchStart', touchPoints: [{ x: bounds.x + 8, y: bounds.y + 8 }]
          })
          await expect(menu).toBeVisible({ timeout: 3000 })
          await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
          await expect(page).toHaveURL(/#\/history/)
          const actions = menu.getByRole('menuitem')
          await expect(actions.first()).toHaveCSS('font-size', '16px')
          expect(await actions.evaluateAll(elements => Math.min(...elements.map(element => element.getBoundingClientRect().height)))).toBeGreaterThanOrEqual(47.99)
          expect(await menu.evaluate(element => {
            const bounds = element.getBoundingClientRect()
            return bounds.left >= 0 && bounds.right <= innerWidth + 1 && bounds.top >= 0 && bounds.bottom <= innerHeight + 1
          })).toBe(true)
          await actions.last().scrollIntoViewIfNeeded()
          await expect(actions.last()).toBeInViewport()
          await page.keyboard.press('Escape')
          await expect(menu).toHaveCount(0)
        }
      } finally {
        await session.detach()
      }
    })
  })
}

test('clamps a menu after actions disappear and resets it after resizing', async ({ page }) => {
  await goTo(page, 'history')
  await page.setViewportSize({ width: 1000, height: 300 })
  const card = page.locator('.ft-list-video').first()
  await card.locator('.title').click({ button: 'right' })
  const menu = page.locator('.contextMenu')
  const scroller = menu.locator('.menuScroll')
  await menu.getByRole('menuitem').last().scrollIntoViewIfNeeded()
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setHideSharingActions', true))
  await expect(menu.getByRole('menuitem', { name: 'Copy YouTube Link', exact: true })).toHaveCount(0)
  await expect.poll(() => scroller.evaluate(element => {
    const content = element.querySelector('.menuContent')
    const end = content.offsetTop + content.offsetHeight
    return Math.abs(element.scrollTop - Math.max(0, end - element.clientHeight))
  })).toBeLessThanOrEqual(1)
  await expect(menu.getByRole('menuitem').last()).toBeInViewport()
  await page.setViewportSize({ width: 1200, height: 1000 })
  await expect(menu).toHaveCount(0)
  await card.locator('.title').click({ button: 'right' })
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
  await expect(scroller.locator('.os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
  await expect(menu.getByRole('menuitem').first()).toBeInViewport()
  await expect(menu.getByRole('menuitem').last()).toBeInViewport()
})

test('opens the selected video in a new tab', async ({ page }) => {
  await goTo(page, 'history')
  const initialTabs = await page.evaluate(async () => (await window.ftElectron.tabs.getState()).tabs.length)
  await page.locator('.ft-list-video .videoInfo').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open in a New Tab', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`#/watch/${VIDEO_ID}`))
  await expect.poll(() => page.evaluate(async () => (await window.ftElectron.tabs.getState()).tabs.length)).toBe(initialTabs + 1)
  await expect(page.locator('.contextMenu')).toHaveCount(0)
})

for (const playlistType of ['youtube', 'user']) {
  test.describe(`${playlistType} playlist copy actions`, () => {
    const playlistId = playlistType === 'youtube' ? 'PL1234567890' : 'private-playlist'
    test.use({
      seed: {
        settings: { saveVideoHistoryWithLastViewedPlaylist: true, backendFallback: true },
        history: [{ ...SEED.history[0], lastViewedPlaylistId: playlistId, lastViewedPlaylistType: playlistType }]
      }
    })

    test('keeps public playlist parameters by default and offers a separate video-only copy', async ({ page, app }) => {
      await goTo(page, 'history')
      const card = page.locator('.ft-list-video').first()
      const menu = page.locator('.contextMenu')
      const invidious = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getCurrentInvidiousInstanceUrl)
      for (const [service, url, separator] of [
        ['YouTube', `https://youtu.be/${VIDEO_ID}`, '?'],
        ['Invidious', `${invidious}/watch?v=${VIDEO_ID}`, '&']
      ]) {
        await card.locator('.title').click({ button: 'right' })
        await menu.getByRole('menuitem', { name: `Copy ${service} Link`, exact: true }).click()
        await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText()))
          .toBe(playlistType === 'youtube' ? `${url}${separator}list=${playlistId}` : url)
        await card.locator('.title').click({ button: 'right' })
        const withoutPlaylist = menu.getByRole('menuitem', { name: `Copy ${service} link without playlist`, exact: true })
        if (playlistType === 'youtube') {
          await withoutPlaylist.click()
          await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(url)
        } else {
          await expect(withoutPlaylist).toHaveCount(0)
          await page.keyboard.press('Escape')
        }
      }
    })
  })
}

test('retains image and selected-text actions alongside video actions', async ({ page, app }) => {
  await goTo(page, 'history')
  const card = page.locator('.ft-list-video').first()
  const menu = page.locator('.contextMenu')
  await card.locator('.thumbnailImage').click({ button: 'right' })
  for (const name of ['Copy Image', 'Copy Image Address']) {
    await expect(menu.getByRole('menuitem', { name, exact: true })).toBeVisible()
  }
  await expect(menu.getByRole('menuitem', { name: /^Save Image As/ })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Add to Queue', exact: true })).toBeVisible()
  const imageUrl = await card.locator('.thumbnailImage').evaluate(image => image.currentSrc || image.src)
  await menu.getByRole('menuitem', { name: 'Copy Image Address', exact: true }).click()
  await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(imageUrl)
  await card.locator('.h3Title').evaluate(element => {
    const selection = window.getSelection()
    selection.selectAllChildren(element)
  })
  await card.locator('.h3Title').click({ button: 'right' })
  await expect(menu.getByRole('menuitem', { name: 'Copy', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /Search.*Video menu test/ }).first()).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Copy YouTube Link', exact: true })).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Copy', exact: true }).click()
  await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe('Video menu test')
})
