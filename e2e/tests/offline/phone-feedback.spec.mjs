import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

test.use({ seed: { settings: { quickSettings: ['appFont', 'baseTheme'], videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

test('keeps the selected font checkmark at the end of the row', async ({ app, page }) => {
  await setWindowSize(app, page, { width: 480, height: 800 })
  await page.locator('.profileTrigger').click()
  await page.locator('.quickSettingsMenu .select').first().getByRole('combobox').click()
  const row = page.locator('dialog[open]').last().getByRole('option', { selected: true })
  const gap = await row.evaluate(element => element.getBoundingClientRect().right - element.querySelector('svg:last-child').getBoundingClientRect().right)
  expect(gap).toBeLessThan(25)
})

test('centers radio text on its control in phone search filters', async ({ app, page }) => {
  await setWindowSize(app, page, { width: 480, height: 800 })
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('showSearchFilters'))
  const offset = await page.locator('.searchRadio label').first().evaluate(label => {
    const range = document.createRange()
    range.selectNodeContents(label)
    const text = range.getBoundingClientRect()
    const row = label.getBoundingClientRect()
    return Math.abs(text.top + text.height / 2 - (row.top + row.height / 2))
  })
  expect(offset).toBeLessThan(2)
})

test('uses the player area and the selected grid layout for phone player options', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  await page.locator('.shaka-overflow-menu-button').click({ force: true })
  const bounds = await page.locator('.phonePlayerOptions[open]').boundingBox()
  const player = await page.locator('.ftVideoPlayer').boundingBox()
  expect(Math.abs(bounds.height - player.height)).toBeLessThan(2)
  const grid = page.locator('.phonePlayerOptions > .ft-menu-grid')
  await expect(grid).toHaveCSS('display', 'grid')
})

test('starts download setup with a fixed template selector and footer', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  await page.locator('.videoOptions').getByRole('button', { name: 'Download Video', exact: true }).click()
  const prompt = page.locator('.downloadPromptCard')
  await expect(prompt.locator('.templateSection')).toBeVisible()
  await prompt.locator('.downloadOptions').evaluate(element => { element.scrollTop = 100000 })
  await expect(prompt.locator('.templateSection')).toBeInViewport()
  await expect(prompt.locator('.downloadHeader')).toBeInViewport()
  await expect(prompt.locator('.downloadFooter')).toBeInViewport()
  expect(await prompt.evaluate(element => element.scrollTop)).toBe(0)
})

test('keeps watch panels below the video with one heading', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page, { captionTranslations: true })
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  await page.locator('.videoOptions').getByRole('button', { name: /transcript/i }).click()
  const sheet = page.locator('.mobileSheet[open]')
  await expect(sheet).toBeVisible()
  const box = await sheet.boundingBox()
  const player = await page.locator('.ftVideoPlayer').boundingBox()
  expect(box.y).toBeGreaterThanOrEqual(player.y + player.height - 1)
  await expect(sheet.getByRole('heading', { name: 'Transcript', exact: true })).toHaveCount(1)
  await expect(sheet.locator('header').getByRole('button', { name: 'Search transcript', exact: true })).toBeVisible()
})

test('keeps the profile editor at its real bottom while scrolling', async ({ app, page }) => {
  await setWindowSize(app, page, { width: 480, height: 800 })
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('showSettingsWindow', 'profile'))
  await page.getByRole('button', { name: 'Create New Profile', exact: true }).click()
  const scroller = page.locator('.settingsSubpageScroll')
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
  await page.waitForTimeout(400)
  const gap = await scroller.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)
  expect(gap).toBeLessThan(2)
})

test('does not change page width while quick settings closes', async ({ app, page }) => {
  await setWindowSize(app, page, { width: 480, height: 800 })
  const before = await page.evaluate(() => document.body.getBoundingClientRect().width)
  await page.locator('.profileTrigger').click()
  const widths = await page.evaluate(async () => {
    document.querySelector('.mobileSheetHeader button:last-child').click()
    const values = []
    for (let i = 0; i < 20; i++) {
      await new Promise(requestAnimationFrame)
      values.push(document.body.getBoundingClientRect().width)
    }
    return values
  })
  expect(Math.max(...widths) - before).toBeLessThan(2)
})

test('follows a downward drag and dismisses the panel', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page, { captionTranslations: true })
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  await page.locator('.videoOptions').getByRole('button', { name: /transcript/i }).click()
  const sheet = page.locator('.mobileSheet[open]')
  await sheet.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)))
  const before = await sheet.boundingBox()
  const header = await sheet.locator('.mobileSheetHeader').boundingBox()
  await page.mouse.move(header.x + header.width / 2, header.y + 6)
  await page.mouse.down()
  await page.mouse.move(header.x + header.width / 2, header.y + 126, { steps: 6 })
  expect((await sheet.boundingBox()).y - before.y).toBeCloseTo(120, 0)
  await page.mouse.up()
  await expect(sheet).toHaveCount(0)
})

test('clamps the download dialog when setup becomes progress', async ({ app, page, attachScreenshot }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  await page.locator('.videoOptions').getByRole('button', { name: 'Download Video', exact: true }).click()
  const prompt = page.locator('.downloadPromptCard')
  await prompt.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)))
  const setupHeight = (await prompt.boundingBox()).height
  await prompt.locator('.advancedDownloadOptions summary').click()
  await prompt.locator('.downloadOptions').evaluate(element => { element.scrollTop = element.scrollHeight })
  await app.electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('yt-dlp-download')
    ipcMain.handle('yt-dlp-download', () => ({ id: 1296 }))
  })
  await prompt.locator('.downloadFooter').getByRole('button', { name: 'Download', exact: true }).click()
  await expect(prompt.locator('.downloadProgress')).toBeVisible()
  await expect(prompt.locator('.downloadOptions')).toHaveCount(0)
  await attachScreenshot('compact active download')
  expect((await prompt.boundingBox()).height).toBeLessThan(setupHeight - 100)
  await expect(prompt.locator('.downloadFooter')).toBeInViewport()
  expect(await prompt.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThan(2)
  expect(await prompt.locator('.downloadProgress').evaluate(element => element.scrollTop)).toBe(0)
})

test('keeps landscape player options within the player in list and grid modes', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page, { captionTranslations: true })
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 1000, height: 480 })
  for (const grid of [false, true]) {
    await page.evaluate(grid => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUsePlayerMenuGrid', grid), grid)
    await page.locator('.shaka-overflow-menu-button').click({ force: true })
    const dialog = page.locator('.phonePlayerOptions[open]')
    await expect(dialog).toBeVisible()
    const bounds = await dialog.boundingBox()
    const player = await page.locator('.ftVideoPlayer').boundingBox()
    expect(Math.abs(bounds.width - player.width)).toBeLessThan(2)
    expect(Math.abs(bounds.height - player.height)).toBeLessThan(2)
    await expect(dialog.locator(':scope > .shaka-overflow-menu')).toHaveCSS('display', grid ? 'grid' : 'flex')
    await dialog.press('Escape')
  }
  await page.locator('.videoOptions').getByRole('button', { name: /transcript/i }).click()
  const sheet = page.locator('.mobileSheet[open]')
  await expect(sheet).toBeVisible()
  await expect.poll(async () => {
    const bounds = await sheet.boundingBox()
    const player = await page.locator('.ftVideoPlayer').boundingBox()
    const toolbar = await page.locator('.topNav').boundingBox()
    const header = await sheet.locator('.mobileSheetHeader').boundingBox()
    return player.y >= toolbar.y + toolbar.height - 1 && bounds.y >= player.y + player.height - 1 && bounds.height >= header.height + 48
  }).toBe(true)
})

test('restores the inline video before opening a panel from the mini player', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page, { captionTranslations: true })
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 1000, height: 480 })
  await page.evaluate(async () => {
    await document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateScrollMiniPlayerEnabled', true)
    window.scrollTo(0, document.body.scrollHeight)
  })
  await expect(page.locator('.ftVideoPlayer')).toHaveClass(/scrollMiniPlayer/)
  await page.locator('.videoOptions').getByRole('button', { name: /transcript/i }).click()
  const sheet = page.locator('.mobileSheet[open]')
  await expect(sheet).toBeVisible()
  await expect(page.locator('.ftVideoPlayer')).not.toHaveClass(/scrollMiniPlayer/)
  // Android can restore an old page offset after returning the native player.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await expect.poll(async () => {
    const player = await page.locator('.ftVideoPlayer').boundingBox()
    const panel = await sheet.boundingBox()
    const toolbar = await page.locator('.topNav').boundingBox()
    return player.y >= toolbar.y + toolbar.height - 1 && panel.y >= player.y + player.height - 1
  }).toBe(true)
})

test('phone options keep the page scrollable and omit the extra header', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  await page.locator('.shaka-overflow-menu-button').click({ force: true })
  const menu = page.locator('.phonePlayerOptions[open]')
  await expect(menu).toBeVisible()
  await expect(menu.locator(':scope > header')).toHaveCount(0)
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden')
})

test('chapter sheet scrolls to a sought chapter and closes with its player control', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => {
    vm.videoChapters = Array.from({ length: 40 }, (_, index) => ({ title: `Chapter ${index}`, startSeconds: index, endSeconds: index + 1, timestamp: `0:${index}` }))
    vm.openPhonePanel('chapters')
  })
  const sheet = page.locator('.dockedSheet[open]')
  const list = sheet.locator('.chaptersWrapper')
  await expect(list).toBeVisible()
  await watch.evaluate(vm => { vm.videoCurrentChapterIndex = 35 })
  await expect.poll(() => list.evaluate(el => el.scrollTop)).toBeGreaterThan(100)
  await expect(list.locator('.chapter.current')).toBeInViewport()
  await watch.evaluate(vm => vm.handleChaptersOverlayChange(false))
  await expect(sheet).toHaveCount(0)
})

test('comments hide content within their sheet and keep tools in the header', async ({ app, page, attachScreenshot }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => vm.openPhonePanel('comments'))
  const sheet = page.locator('.dockedSheet[open]')
  await expect(sheet.locator('.comment').first()).toBeVisible()
  const hide = sheet.locator('.mobileSheetHeader').getByRole('button', { name: 'Hide Comments', exact: true })
  await expect(hide.locator('svg')).toHaveCount(1)
  await sheet.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)))
  await attachScreenshot('comments sheet header')
  await hide.click()
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText('Click to View Comments', { exact: true })).toBeVisible()
  await expect(sheet.locator('.commentHeader')).toHaveCount(0)
})

test('dragging a sheet up pauses playback and settings stay above it', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page, { captionTranslations: true })
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => vm.openPhonePanel('transcript'))
  const sheet = page.locator('.dockedSheet[open]')
  await page.waitForTimeout(300)
  const header = await sheet.locator('.mobileSheetHeader').boundingBox()
  await page.locator('video').evaluate(video => video.play())
  await page.mouse.move(header.x + header.width / 2, header.y + 5)
  await page.mouse.down()
  await page.mouse.move(header.x + header.width / 2, 5, { steps: 12 })
  await page.mouse.up()
  await expect.poll(async () => (await sheet.boundingBox()).y).toBeLessThan(2)
  await expect.poll(() => page.locator('video').evaluate(video => video.paused)).toBe(true)
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('showSettingsWindow', 'profile'))
  expect(await page.locator('.settingsSubpageScroll').evaluate(el => {
    const box = el.getBoundingClientRect()
    return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
  })).toBe(true)
})

test('profile customize uses the same touch target and background as Close', async ({ app, page, attachScreenshot }) => {
  await setWindowSize(app, page, { width: 480, height: 800 })
  await page.locator('.profileTrigger').click({ button: 'right' })
  await page.mouse.move(0, 0)
  await expect(page.locator('.mobileSheet[open]')).toHaveCSS('transform', 'none')
  const header = page.locator('.mobileSheetHeader')
  const customize = header.getByRole('button', { name: 'Profile', exact: true })
  const close = header.getByRole('button', { name: 'Close', exact: true })
  await expect(customize).toBeVisible()
  await attachScreenshot('profile header actions')
  expect((await customize.boundingBox()).height).toBeGreaterThanOrEqual(48)
  expect(await customize.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await close.evaluate(el => getComputedStyle(el).backgroundColor))
})

test('comment continuation spinner stays visible at the bottom of the sheet', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => vm.openPhonePanel('comments'))
  const sheet = page.locator('.dockedSheet[open]')
  await expect(sheet.locator('.comment').first()).toBeVisible()
  let release
  const pending = new Promise(resolve => { release = resolve })
  await page.route('**/youtubei/v1/next*', async route => {
    await pending
    await route.fallback()
  })
  try {
    await sheet.locator('.commentsContentWrapper').evaluate(el => { el.scrollTop = el.scrollHeight })
    await expect(sheet.getByRole('status', { name: 'Load More Comments' })).toBeInViewport()
  } finally {
    release()
    await page.unrouteAll({ behavior: 'wait' })
  }
})

test('submenu navigation stays outside the player menu scroller', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 360, height: 760 })
  await page.locator('.shaka-overflow-menu-button').click({ force: true })
  const dialog = page.locator('.phonePlayerOptions[open]')
  await dialog.locator('.shaka-playbackrate-button').click()
  const back = dialog.locator(':scope > .shaka-back-to-overflow-button')
  await expect(back).toBeVisible()
  const before = await back.boundingBox()
  await dialog.locator(':scope > .shaka-overflow-menu').evaluate(el => { el.scrollTop = el.scrollHeight })
  const after = await back.boundingBox()
  expect(after.y).toBeCloseTo(before.y, 0)
  await expect(back).toBeInViewport()
})

test('autoplay glyph stays within its switch in both states', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 360, height: 760 })
  await page.locator('.shaka-overflow-menu-button').click({ force: true })
  const toggle = page.locator('.phonePlayerOptions[open] .autoplay-toggle')
  for (let state = 0; state < 2; state++) {
    await toggle.scrollIntoViewIfNeeded()
    await page.waitForTimeout(200)
    const geometry = await toggle.evaluate(el => {
      const track = el.querySelector('.ft-autoplay-switch').getBoundingClientRect()
      const thumb = el.querySelector('.ft-autoplay-switch-thumb').getBoundingClientRect()
      const enabled = el.getAttribute('aria-pressed') === 'true'
      return { edge: enabled ? track.right - thumb.right : thumb.left - track.left, center: thumb.top + thumb.height / 2 - track.top - track.height / 2 }
    })
    expect(geometry.edge).toBeCloseTo(1, 0)
    expect(geometry.center).toBeCloseTo(0, 0)
    await toggle.click()
  }
})

test('switching tabs dismisses the sheet and releases its scroll lock', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page, { captionTranslations: true })
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => vm.openPhonePanel('transcript'))
  await expect(page.locator('.dockedSheet[open]')).toBeVisible()
  await page.locator('.tabBar .newTabButton').click()
  await expect(page.locator('.dockedSheet[open]')).toHaveCount(0)
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden')
})

test('expanded sheets clear Android status bars and animate on close', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page, { captionTranslations: true })
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  await page.evaluate(() => document.documentElement.style.setProperty('--safe-area-inset-top', '28px'))
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => vm.openPhonePanel('transcript'))
  const sheet = page.locator('.dockedSheet[open]')
  await sheet.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)))
  const header = await sheet.locator('.mobileSheetHeader').boundingBox()
  await page.mouse.move(header.x + header.width / 2, header.y + 5)
  await page.mouse.down()
  await page.mouse.move(header.x + header.width / 2, 5, { steps: 12 })
  await page.mouse.up()
  await sheet.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)))
  expect((await sheet.locator('.mobileSheetHeader').boundingBox()).y).toBeGreaterThanOrEqual(28)
  const closing = await sheet.evaluate(async el => {
    el.querySelector('.mobileSheetHeader > button:last-child').click()
    await new Promise(requestAnimationFrame)
    return { open: el.open, animated: el.getAnimations().some(animation => animation.playState === 'running') }
  })
  expect(closing).toEqual({ open: true, animated: true })
  await expect(sheet).toHaveCount(0)
})

test('comments fill the card width and keep their scrollbar at the panel edge', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const button = await page.locator('.phoneCommentsButton').boundingBox()
  const area = await page.locator('.infoArea').boundingBox()
  expect(button.width).toBeCloseTo(area.width, 0)
  await page.locator('.phoneCommentsButton').click()
  const sheet = page.locator('.dockedSheet[open]')
  await expect(sheet.locator('.comment').first()).toBeVisible()
  const right = await sheet.evaluate(el => el.getBoundingClientRect().right - el.querySelector('.commentsContentWrapper').getBoundingClientRect().right)
  expect(right).toBeLessThan(2)
  await sheet.getByRole('button', { name: 'Filter loaded comments', exact: true }).click()
  const option = sheet.getByRole('checkbox', { name: 'Contains timestamps', exact: true })
  const labelLeft = () => option.locator('span').nth(1).evaluate(el => el.getBoundingClientRect().left)
  const before = await labelLeft()
  await option.click()
  expect(await labelLeft()).toBeCloseTo(before, 1)
})

test('phone player menus have a fixed close control and equal centered tiles', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 1000, height: 480 })
  for (const grid of [true, false]) {
    await page.evaluate(grid => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUsePlayerMenuGrid', grid), grid)
    await page.locator('.shaka-overflow-menu-button').click({ force: true })
    const dialog = page.locator('.phonePlayerOptions[open]')
    const close = dialog.getByRole('button', { name: 'Close', exact: true })
    await expect(close).toBeVisible()
    if (grid) {
      const sizes = await dialog.locator('.shaka-overflow-menu > button:visible').evaluateAll(buttons => buttons.map(el => el.getBoundingClientRect().toJSON()))
      expect(Math.max(...sizes.map(x => x.height)) - Math.min(...sizes.map(x => x.height))).toBeLessThan(2)
      expect(Math.max(...sizes.map(x => x.width)) - Math.min(...sizes.map(x => x.width))).toBeLessThan(2)
      const bounds = await dialog.boundingBox()
      if (Math.max(...sizes.map(x => x.bottom)) < bounds.y + bounds.height) {
        const viewport = await dialog.locator('.shaka-overflow-menu').boundingBox()
        expect((Math.min(...sizes.map(x => x.top)) + Math.max(...sizes.map(x => x.bottom))) / 2).toBeCloseTo(viewport.y + viewport.height / 2, 0)
      }
      expect((Math.min(...sizes.map(x => x.left)) + Math.max(...sizes.map(x => x.right))) / 2).toBeCloseTo(bounds.x + bounds.width / 2, 0)
    }
    await dialog.locator('.shaka-overflow-menu').evaluate(el => { el.scrollTop = el.scrollHeight })
    await expect(close).toBeInViewport()
    await close.click()
    await expect(dialog).toHaveCount(0)
  }
})

test('switching sheets during their exit keeps the new player anchor and focus', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page, { captionTranslations: true })
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => vm.openPhonePanel('transcript'))
  await expect(page.locator('.dockedSheet[open]')).toHaveCount(1)
  await watch.evaluate(vm => vm.openPhonePanel('comments'))
  await expect(page.locator('.dockedSheet[open]')).toHaveCount(1)
  await expect(page.locator('[data-phone-panel-video]')).toHaveCount(1)
  const sheet = page.locator('.dockedSheet[open]')
  await expect(sheet).toHaveAttribute('aria-label', 'Comments')
  await expect.poll(() => sheet.evaluate(el => el.contains(document.activeElement))).toBe(true)
  await expect(sheet.locator('.comment').first()).toBeVisible()
  await sheet.getByRole('button', { name: /^sort by$/i }).click()
  const positions = await sheet.locator('.fullscreenSortMenu button > span:first-child').evaluateAll(es => es.map(el => el.getBoundingClientRect().left))
  expect(positions).toHaveLength(2)
  expect(positions[0]).toBeCloseTo(positions[1], 1)
})

test('phone comment popup labels stay on one line', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 360, height: 760 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => vm.openPhonePanel('comments'))
  const sheet = page.locator('.dockedSheet[open]')
  await expect(sheet.locator('.comment').first()).toBeVisible()
  await sheet.getByRole('button', { name: /^sort by$/i }).click()
  const lines = label => label.evaluate(el => {
    const range = document.createRange()
    range.selectNodeContents(el)
    return range.getClientRects().length
  })
  expect(await lines(sheet.locator('.fullscreenSortMenu button > span:first-child').first())).toBe(1)
  await sheet.getByRole('button', { name: 'Filter loaded comments', exact: true }).click()
  expect(await lines(sheet.getByRole('checkbox', { name: 'Search loaded comments', exact: true }).locator('span').nth(1))).toBe(1)
})

test('comment loading at the end stays visible without a second swipe or horizontal overflow', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 360, height: 760 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => vm.openPhonePanel('comments'))
  const sheet = page.locator('.dockedSheet[open]')
  await expect(sheet.locator('.comment').first()).toBeVisible()
  let release
  const pending = new Promise(resolve => { release = resolve })
  await page.route('**/youtubei/v1/next*', async route => { await pending; await route.fallback() })
  try {
    const scroller = sheet.locator('.commentsContentWrapper')
    await scroller.evaluate(el => { el.scrollTop = el.scrollHeight })
    const spinner = sheet.getByRole('status', { name: 'Load More Comments' })
    await expect(spinner).toBeVisible()
    await expect.poll(() => scroller.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThan(2)
    const bounds = await scroller.boundingBox()
    const loading = await spinner.boundingBox()
    expect(loading.y + loading.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1)
  } finally {
    release()
    await page.unrouteAll({ behavior: 'wait' })
  }
})

test('phone options retain their menu during a page swipe', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  await page.locator('.shaka-overflow-menu-button').click({ force: true })
  const dialog = page.locator('.phonePlayerOptions[open]')
  await page.locator('.watchVideoInfo').evaluate(el => {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 12, clientY: 600 }))
    el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'touch', pointerId: 12, clientY: 450 }))
    window.scrollBy(0, 120)
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 12, clientY: 450 }))
  })
  await expect(dialog).toBeVisible()
})

test('phone list menu keeps its scrollbar visible without mouse movement', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUsePlayerMenuGrid', false))
  await page.locator('.shaka-overflow-menu-button').click({ force: true })
  const dialog = page.locator('.phonePlayerOptions[open]')
  await dialog.locator('.shaka-overflow-menu').evaluate(el => { el.scrollTop = el.scrollHeight })
  await expect(dialog.locator('.os-scrollbar-vertical')).toBeVisible()
  await page.waitForTimeout(1500)
  await expect(dialog.locator('.os-scrollbar-vertical')).toHaveCSS('opacity', '1')
})

test('touching another list option clears an old hover highlight', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUsePlayerMenuGrid', false))
  await page.locator('.shaka-overflow-menu-button').click({ force: true })
  const dialog = page.locator('.phonePlayerOptions[open]')
  const first = dialog.locator('.shaka-overflow-menu > button:visible').first()
  await first.hover()
  await dialog.locator('.autoplay-toggle').evaluate(el => {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))
    el.click()
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }))
  })
  await expect(first).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
})

for (const native of [false, true]) {
  test(`fullscreen playlist picker stays inside the player (${native ? 'native' : 'browser'})`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await setWindowSize(app, page, { width: 1000, height: 480 })
    const player = page.locator('.ftVideoPlayer')
    await page.locator('body').press('s')
    if (native) {
      await page.addStyleTag({ path: 'src/renderer/helpers/player/androidNativeScreen.css' })
      await player.evaluate(el => {
        document.documentElement.classList.add('nativePlaybackScreen')
        el.setAttribute('data-native-player-screen', '')
        el.classList.remove('fullWindow')
      })
    } else await player.evaluate(el => el.requestFullscreen())
    await player.locator('.fullscreenPlaylistAction > button').click({ force: true })
    const sheet = page.locator('.mobileSheet[open]')
    await expect(sheet).toBeVisible()
    await expect(sheet).not.toHaveClass(/dockedSheet/)
    await expect(player).not.toHaveAttribute('data-phone-panel-video')
    await expect(sheet).toHaveCSS('transform', 'none')
    const bounds = await sheet.boundingBox()
    expect(bounds.y).toBeGreaterThanOrEqual(0)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight + 1))
    await expect(sheet.locator('.playlistSearch')).toBeVisible()
    await sheet.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(sheet).toHaveCount(0)
  })
}

test('landscape fullscreen share consumes an outside tap', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 1000, height: 480 })
  await page.locator('body').press('s')
  const player = page.locator('.ftVideoPlayer')
  await page.addStyleTag({ path: 'src/renderer/helpers/player/androidNativeScreen.css' })
  await player.evaluate(el => {
    document.documentElement.classList.add('nativePlaybackScreen')
    el.setAttribute('data-native-player-screen', '')
  })
  await player.locator('.fullscreenShareAction > button').click({ force: true })
  await expect(page.locator('.prompt')).toHaveCount(0)
  const popup = page.locator('.fullscreenDropdownLayer .iconDropdown')
  await expect(popup).toBeVisible()
  expect((await popup.boundingBox()).width).toBeLessThan(400)
  await expect.poll(async () => {
    const bounds = await popup.boundingBox()
    return bounds.y + bounds.height
  }).toBeGreaterThan(await page.evaluate(() => innerHeight - 20))
  await player.evaluate(el => {
    window.__outsidePlayerEvents = []
    for (const type of ['pointerdown', 'click', 'touchstart', 'touchend']) {
      el.addEventListener(type, () => window.__outsidePlayerEvents.push(type))
    }
  })
  await expect.poll(() => player.evaluate(el => getComputedStyle(el).transform)).toBe('none')
  await page.mouse.click(12, 12)
  await expect(page.locator('.fullscreenShareAction > button')).toHaveAttribute('aria-expanded', 'false')
  expect(await page.evaluate(() => window.__outsidePlayerEvents)).toEqual([])
})

test('description uses the whole panel scroller without a nested clipped viewport', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 1000 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => {
    vm.videoDescription = 'Description line\n'.repeat(100)
    vm.videoDescriptionHtml = ''
    vm.openPhonePanel('description')
  })
  const sheet = page.locator('.dockedSheet[open]')
  await sheet.locator('.description').evaluate(el => { el.textContent = 'Description line\n'.repeat(100) })
  const inner = sheet.locator('.descriptionScroll')
  await expect(inner).toHaveCSS('max-block-size', 'none')
  await expect(inner).toHaveCSS('overflow-y', 'visible')
  const viewport = sheet.locator('.phonePanelScroller')
  await expect.poll(() => viewport.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(100)
  await viewport.evaluate(el => { el.scrollTop = el.scrollHeight })
  await expect(viewport.locator('.os-scrollbar-vertical')).toHaveCSS('opacity', '1')
})

for (const playing of [true, false]) {
  test(`lowering an expanded panel restores ${playing ? 'playing' : 'paused'} playback`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await setWindowSize(app, page, { width: 480, height: 800 })
    const video = page.locator('.ftVideoPlayer video')
    await video.evaluate((el, play) => play ? el.play() : el.pause(), playing)
    const watch = await watchViewHandle(page)
    await watch.evaluate(vm => vm.openPhonePanel('comments'))
    const header = page.locator('.dockedSheet[open] .mobileSheetHeader')
    await page.waitForTimeout(300)
    const bounds = await header.boundingBox()
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 5)
    await page.mouse.down()
    await page.mouse.move(bounds.x + bounds.width / 2, 5, { steps: 8 })
    await page.mouse.up()
    await expect.poll(() => video.evaluate(el => el.paused)).toBe(true)
    await page.waitForTimeout(250)
    await page.mouse.move(20, 20)
    await page.mouse.down()
    await page.mouse.move(20, 220, { steps: 8 })
    await page.mouse.up()
    await expect.poll(() => video.evaluate(el => el.paused)).toBe(!playing)
  })
}

test('closing an expanded panel resumes the video it paused', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => vm.openPhonePanel('description'))
  const sheet = page.locator('.dockedSheet[open]')
  await page.waitForTimeout(300)
  const bounds = await sheet.locator('.mobileSheetHeader').boundingBox()
  const video = page.locator('.ftVideoPlayer video')
  await video.evaluate(el => el.play())
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 5)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width / 2, 5, { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => video.evaluate(el => el.paused)).toBe(true)
  await sheet.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(sheet).toHaveCount(0)
  await expect.poll(() => video.evaluate(el => el.paused)).toBe(false)
})

for (const picker of [false, true]) {
  test(`fullscreen ${picker ? 'select' : 'quick settings'} animates opening and closing`, async ({ app, page }) => {
    await setWindowSize(app, page, { width: 480, height: 800 })
    await page.locator('.profileTrigger').click()
    if (picker) await page.locator('.quickSettingsMenu .select').first().getByRole('combobox').click()
    const sheet = page.locator('.mobileSheet[open]').last()
    expect(await sheet.evaluate(el => el.getAnimations().some(animation => animation.effect.getTiming().duration > 0))).toBe(true)
    await sheet.getByRole('button', { name: 'Close', exact: true }).click()
    expect(await sheet.evaluate(el => el.getAnimations().some(animation => animation.effect.getTiming().duration > 0))).toBe(true)
    await expect(page.locator('.mobileSheet[open]')).toHaveCount(picker ? 1 : 0)
  })
}

for (const [width, height] of [[480, 800], [900, 480], [900, 950], [1280, 950]]) {
  test(`Share and Media Formats modals fit their content at ${width}x${height}`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await setWindowSize(app, page, { width, height })
    for (const name of width > 900 ? ['Change Media Formats'] : ['Share Video', 'Change Media Formats']) {
      await page.locator('.watchVideoInfo').getByRole('button', { name, exact: true }).click()
      const card = page.locator('.promptCard')
      await expect(card).toBeVisible()
      await expect.poll(async () => (await card.boundingBox()).width).toBeLessThan(width - 32)
      expect(await card.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThan(2)
      await page.locator('.prompt').click({ position: { x: 2, y: 2 } })
      await expect(card).toHaveCount(0)
    }
  })
}
