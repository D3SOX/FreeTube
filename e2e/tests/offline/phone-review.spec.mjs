import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

test.use({ seed: { settings: { animationSpeed: 25, videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

test('Escape closes a foreground prompt above a docked phone panel', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => vm.openPhonePanel('description'))
  await expect(page.locator('.dockedSheet[open]')).toBeVisible()
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('showSearchFilters'))
  const prompt = page.locator('.searchFiltersCard')
  await expect(prompt).toBeVisible()
  await prompt.press('Escape')
  await expect(prompt).toHaveCount(0)
  await expect(page.locator('.dockedSheet[open]')).toBeVisible()
})

test('Escape closes only the latest of multiple prompts', async ({ page }) => {
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('showSearchFilters')
    await store.dispatch('showCreatePlaylistPrompt', { title: '', description: '', sourcePlaylistId: null })
  })
  const searchFilters = page.locator('.searchFiltersCard')
  const createPlaylist = page.locator('.playlistNameInput')
  await expect(searchFilters).toBeVisible()
  await expect(createPlaylist).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(createPlaylist).toHaveCount(0)
  await expect(searchFilters).toBeVisible()
})

test('playlist prompts preserve their desktop sizing and heading alignment', async ({ page }) => {
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch(
    'showCreatePlaylistPrompt', { title: '', description: '', sourcePlaylistId: null }
  ))
  const nameInput = page.locator('.playlistNameInput')
  await expect(nameInput).toBeVisible()
  expect((await nameInput.boundingBox()).width).toBeGreaterThan(500)
  await page.keyboard.press('Escape')

  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch(
    'showAddToPlaylistPromptForManyVideos', {
      videos: [{ videoId: 'test', title: 'Test', lengthSeconds: 10 }]
    }
  ))
  const heading = page.locator('.playlistPromptHeading')
  await expect(heading).toBeVisible()
  await expect(heading).toHaveCSS('text-align', 'center')
})

test('docked phone panel animations respect the configured animation speed', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(async vm => {
    vm.openPhonePanel('description')
    await vm.$nextTick()
    await new Promise(resolve => requestAnimationFrame(resolve))
    const animation = document.querySelector('.dockedSheet[open]').getAnimations()[0]
    await animation.ready
    window.__panelOpeningRate = animation.playbackRate
  })
  expect(await page.evaluate(() => window.__panelOpeningRate)).toBe(0.25)
  const sheet = page.locator('.dockedSheet[open]')
  await sheet.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)))
  const header = await sheet.locator('.mobileSheetHeader').boundingBox()
  await page.mouse.move(20, header.y + 5)
  await page.mouse.down()
  await page.mouse.move(20, 5, { steps: 8 })
  await page.mouse.up()
  expect(await sheet.evaluate(async el => {
    const animation = el.getAnimations()[0]
    await animation.ready
    return animation.playbackRate
  })).toBe(0.25)
})

for (const mode of ['native', 'browser']) {
  test(`reopens a watch sheet after switching ${mode} fullscreen`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await setWindowSize(app, page, { width: 480, height: 800 })
    const watch = await watchViewHandle(page)
    await watch.evaluate(vm => vm.openPhonePanel('description'))
    const sheet = page.locator('.mobileSheet[open]')
    await expect(sheet).toHaveClass(/dockedSheet/)
    await sheet.press('Escape')
    await expect(sheet).toHaveCount(0)
    await page.locator('.ftVideoPlayer').evaluate((el, mode) => mode === 'native'
      ? el.setAttribute('data-native-player-screen', '')
      : el.requestFullscreen(), mode)
    await watch.evaluate(vm => vm.openPhonePanel('description'))
    await expect(sheet).not.toHaveClass(/dockedSheet/)
    await page.locator('.ftVideoPlayer').evaluate((el, mode) => mode === 'native'
      ? el.removeAttribute('data-native-player-screen')
      : document.exitFullscreen(), mode)
    await expect(sheet).toHaveClass(/dockedSheet/)
    await sheet.press('Escape')
    await expect(sheet).toHaveCount(0)
    await watch.evaluate(vm => vm.openPhonePanel('description'))
    await expect(sheet).toHaveClass(/dockedSheet/)
  })
}

test('description preview exposes links and a separate expansion control', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const preview = page.locator('.phoneDescriptionPreview')
  await expect(preview.locator('.description')).not.toHaveAttribute('role', 'button')
  await preview.getByRole('button', { name: '...more', exact: true }).press('Enter')
  await expect(page.locator('.mobileSheet[open]')).toContainText('Description')
})

test('description metadata remains reachable without description text', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(async vm => {
    vm.videoDescription = ''
    vm.videoDescriptionHtml = ''
    vm.videoTags = ['metadata-tag']
    await vm.$nextTick()
  })

  await page.locator('.phoneDescriptionPreview')
    .getByRole('button', { name: '...more', exact: true })
    .click()
  await expect(page.locator('.mobileSheet[open]')).toContainText('metadata-tag')
})

test('phone comments keep their inset and hide unavailable visibility actions', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const button = page.locator('.phoneCommentsButton')
  const bounds = await button.boundingBox()
  expect(bounds.x).toBeGreaterThan(0)
  expect(bounds.x + bounds.width).toBeLessThan(await page.evaluate(() => innerWidth))

  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => {
    vm.commentsDisabled = true
    vm.openPhonePanel('comments')
  })
  const sheet = page.locator('.mobileSheet[open]')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('button', { name: /View Comments/ })).toHaveCount(0)
})

test('phone panel content remains rendered through its close animation', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => vm.openPhonePanel('description'))
  const sheet = page.locator('.mobileSheet[open]')
  await sheet.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.locator('.phonePanelHost:not(.hiddenPanel)')).toHaveCount(1)
  await expect(sheet).toHaveCount(0)
  await expect(page.locator('.phonePanelHost:not(.hiddenPanel)')).toHaveCount(0)
})

test('phone transcript language menu stays inside the viewport', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page, { captionTranslations: true })
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => {
    vm.captions = [...vm.captions, { ...vm.captions[0], label: 'Second language' }]
    vm.openPhonePanel('transcript')
  })
  const sheet = page.locator('.mobileSheet[open]')
  await sheet.getByRole('button', { name: 'Language' }).click()
  const bounds = await sheet.locator('.transcriptLanguageMenu').boundingBox()
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
})

test('fullscreen dropdowns close when native player presentation ends', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const button = page.getByRole('button', { name: 'Share Video' }).first()
  const presentation = button.locator('xpath=ancestor::*[contains(@class, "videoLayout")]')
  await presentation.evaluate(el => el.setAttribute('data-native-player-screen', ''))
  await button.click()
  const layer = page.locator('.fullscreenDropdownLayer')
  await expect(layer).toBeVisible()
  await expect(layer).toHaveCSS('z-index', '100')
  await presentation.evaluate(el => el.removeAttribute('data-native-player-screen'))
  await expect(layer).toHaveCount(0)
})

test('Settings consumes Escape after closing', async ({ page }) => {
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('toggleSettingsWindow'))
  const settings = page.locator('.settingsWindow')
  await expect(settings).toBeVisible()
  expect(await settings.evaluate(el => !el.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape', bubbles: true, cancelable: true
  })))).toBe(true)
  await expect(settings).toHaveCount(0)
})

for (const [panel, flag] of [
  ['chapters', 'showSidebarChapters'],
  ['transcript', 'showTranscript'],
  ['chat', 'liveChatOpen']
]) {
  test(`closing the phone ${panel} panel clears its desktop state`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { captionTranslations: true })
    await openMockedVideo(page)
    await setWindowSize(app, page, { width: 480, height: 800 })
    const watch = await watchViewHandle(page)
    await watch.evaluate((vm, panel) => vm.openPhonePanel(panel), panel)
    const sheet = page.locator('.mobileSheet[open]')
    await expect(sheet).toBeVisible()
    await sheet.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(sheet).toHaveCount(0)
    expect(await watch.evaluate((vm, flag) => ({
      flag: vm[flag],
      mobilePanel: vm.mobilePanel
    }), flag)).toEqual({ flag: false, mobilePanel: null })
  })
}

test('a new watch load closes the current phone panel', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const watch = await watchViewHandle(page)
  expect(await watch.evaluate(vm => {
    vm.mobilePanel = 'description'
    vm.resetVideoState()
    return vm.mobilePanel
  })).toBeNull()
})

test('phone key-moment panels use the matching title', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(async vm => {
    vm.videoChaptersKind = 'keyMoments'
    vm.videoChapters = [{ title: 'Moment', timestamp: '0:00', startSeconds: 0 }]
    vm.openPhonePanel('chapters')
    await vm.$nextTick()
  })
  await expect(page.locator('.mobileSheet[open]')).toHaveAttribute('aria-label', 'Key Moments')
})

test('player options stop updating their scrollbars when idle', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  await page.locator('.shaka-overflow-menu-button').click({ force: true })
  await expect(page.locator('.phonePlayerOptionsClose')).toBeFocused()
  const menu = page.locator('.phonePlayerOptions[open] .shaka-overflow-menu')
  await expect(menu).toBeVisible()
  await page.waitForTimeout(400)
  const mutations = await menu.evaluate(el => new Promise(resolve => {
    let count = 0
    const targets = {}
    const observer = new MutationObserver(records => {
      count += records.length
      for (const record of records) {
        const key = record.target.className
        targets[key] = (targets[key] ?? 0) + 1
      }
    })
    observer.observe(el, { subtree: true, attributes: true, attributeFilter: ['class'] })
    setTimeout(() => { observer.disconnect(); resolve({ count, targets }) }, 300)
  }))
  expect(mutations.count, JSON.stringify(mutations.targets)).toBeLessThan(20)
})

for (const panel of ['description', 'comments', 'chapters', 'transcript', 'queue']) {
  test(`landscape ${panel} panel opens maximized`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { captionTranslations: true })
    await openMockedVideo(page)
    await setWindowSize(app, page, { width: 1000, height: 480 })
    const video = page.locator('video')
    await video.evaluate(el => el.play())
    const watch = await watchViewHandle(page)
    await watch.evaluate((vm, panel) => vm.openPhonePanel(panel), panel)
    const sheet = page.locator('.mobileSheet[open]')
    await sheet.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)))
    expect((await sheet.boundingBox()).y).toBeLessThan(5)
    expect((await sheet.boundingBox()).height).toBeGreaterThan(450)
    expect(await video.evaluate(el => el.paused)).toBe(false)
    await sheet.press('Escape')
    await expect(sheet).toHaveCount(0)
    expect(await video.evaluate(el => el.paused)).toBe(false)
  })
}

test('panel scrollbar positioning follows the compositor scroll timeline', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page, { captionTranslations: true })
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => vm.openPhonePanel('transcript'))
  const track = page.locator('.mobileSheet[open] .os-scrollbar-vertical').last()
  await expect(track).toBeAttached()
  expect(await track.evaluate(el => el.getAnimations().some(animation => animation.timeline?.constructor.name === 'ScrollTimeline'))).toBe(true)
})
