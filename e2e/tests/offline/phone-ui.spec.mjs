import { setWindowSize, test, expect } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

async function expectNoScrollbarOverflow(scroller) {
  await expect.poll(() => scroller.evaluate(element => {
    const scrollbar = element.querySelector('.os-scrollbar-vertical')
    return element.scrollTop === 0 && scrollbar &&
      (!scrollbar.classList.contains('os-scrollbar-visible') || scrollbar.classList.contains('os-scrollbar-unusable'))
  })).toBe(true)
}

for (const uiScale of [100, 95]) {
  test.describe(`phone UI at ${uiScale}%`, () => {
    test.use({
      seed: {
        settings: {
          uiScale,
          videoPlaybackEngine: 'built-in',
          ytDlpPlaybackEngineDefaultMigration: true,
          quickSettings: ['currentLocale', 'baseTheme', 'uiScale'],
        },
        playlists: Array.from({ length: 24 }, (_, index) => ({ _id: `phone-list-${index}`, playlistName: `Phone playlist ${index}`, protected: false, videos: [], lastUpdatedAt: index }))
      }
    })

    test('opens inline player options within the player and navigates submenus', async ({ app, page, attachScreenshot }) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      await setWindowSize(app, page, { width: 360, height: 760 })
      const player = page.locator('.ftVideoPlayer')
      await player.hover()
      await player.locator('.shaka-overflow-menu-button').click({ force: true })
      const dialog = player.locator('.phonePlayerOptions[open]')
      await expect(dialog).toBeVisible()
      const viewport = await player.boundingBox()
      const box = await dialog.boundingBox()
      expect(Math.abs(box.width - viewport.width)).toBeLessThan(2)
      expect(Math.abs(box.height - viewport.height)).toBeLessThan(2)
      await attachScreenshot('phone player options')
      await dialog.locator('.shaka-playbackrate-button').click()
      await attachScreenshot('phone player submenu')
      await expect(dialog.locator(':scope > .shaka-back-to-overflow-button').first()).toBeVisible()
      await dialog.press('Escape')
      await expect(dialog.locator('.shaka-playbackrate-button')).toBeVisible()
      await dialog.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(page).toHaveURL(/watch/)
    })

    test('searches a language picker without closing quick settings', async ({ app, page }) => {
      await setWindowSize(app, page, { width: 360, height: 760 })
      await page.locator('.profileTrigger').click()
      const quick = page.locator('.quickSettingsMenu')
      await expect(quick).toBeVisible()
      await expect(quick).toHaveCSS('position', 'relative')
      const headerBox = await page.locator('.mobileSheetHeader').boundingBox()
      const quickBox = await quick.boundingBox()
      expect(quickBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 1)
      await quick.locator('.select').filter({ hasText: 'Language' }).getByRole('combobox').click()
      const picker = page.locator('dialog[open]').last()
      await expect(picker.locator('.pickerSearch')).toBeVisible()
      await picker.locator('.selectDropdown').evaluate(element => { element.scrollTop = 100000 })
      await picker.locator('.pickerSearch').fill('Deutsch')
      await expect(picker.getByRole('option')).toHaveCount(1)
      await expectNoScrollbarOverflow(picker.locator('.selectDropdown'))
      await picker.press('Escape')
      await expect(quick).toBeVisible()
      await quick.locator('.profileSummary').click()
      await expect(quick.locator('.profileList')).toBeVisible()
      await quick.press('Escape')
      await expect(quick.locator('.profileSummary')).toBeVisible()
      await quick.press('Escape')
      await expect(quick).toHaveCount(0)
      await expect(page.locator('.profileTrigger')).toBeFocused()
    })

    test('opens watch panels and offers tap queue reordering', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        for (let i = 0; i < 12; i++) {
          store.commit('addVideoToWatchQueue', {
            video: { videoId: 'jNQXAC9IVRw', title: `Queue item ${i}`, author: 'Test channel' }
          })
        }
      })
      await setWindowSize(app, page, { width: 360, height: 760 })
      const actions = page.locator('.phonePanelActions')
      await actions.getByRole('button', { name: 'Queue', exact: true }).click()
      const sheet = page.locator('dialog[open]')
      await expect(sheet.locator('.queueItem')).toHaveCount(12)
      await sheet.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)))
      const touch = await page.context().newCDPSession(page)
      const dragStart = await sheet.locator('.queueDragHandle').first().boundingBox()
      const targetBox = await sheet.locator('.queueItem').nth(2).boundingBox()
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: dragStart.x + 24, y: dragStart.y + 24 }] })
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: dragStart.x + 24, y: targetBox.y + targetBox.height * 0.75 }] })
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect(sheet.locator('.queueItem').nth(2)).toContainText('Queue item 0')
      for (let index = 0; index < 2; index++) {
        await sheet.getByRole('button', { name: 'Move Queue item 0 up' }).click()
      }
      const gripBox = await sheet.locator('.queueDragHandle').first().boundingBox()
      const queueBox = await sheet.locator('.queueItems').boundingBox()
      const x = gripBox.x + gripBox.width / 2
      const y = gripBox.y + gripBox.height / 2
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: queueBox.y + queueBox.height - 5 }] })
      await expect.poll(() => sheet.locator('.queueItems').evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
      await sheet.locator('.queueItems').evaluate(element => { element.scrollTop = 0 })
      await sheet.locator('.queueItem').first().getByRole('button', { name: 'Move Queue item 0 down' }).click()
      await expect(sheet.locator('.queueItem').nth(1)).toContainText('Queue item 0')
      await sheet.locator('.queueItems').evaluate(element => { element.scrollTop = 100000 })
      for (let i = 0; i < 11; i++) {
        await sheet.locator('.queueItem').last().getByRole('button', { name: /Remove.*Queue/ }).click()
      }
      await expectNoScrollbarOverflow(sheet.locator('.queueItems'))
      await sheet.locator('.mobileSheetHeader').getByRole('button', { name: 'Close', exact: true }).click()
      await expect(sheet).toHaveCount(0)
      await page.locator('.phoneDescriptionPreview .description').click()
      await expect(page.locator('dialog[open]')).toContainText('Description')
      await page.locator('dialog[open]').press('Escape')
      await expect(page.locator('dialog[open]')).toHaveCount(0)
    })

    test('opens chapters and transcript as independent sheets', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page, { captionTranslations: true })
      await openMockedVideo(page)
      await setWindowSize(app, page, { width: 360, height: 760 })
      const actions = page.locator('.videoOptions')
      for (const [label, content] of [['Chapters', '.watchVideoChaptersPanel'], ['Transcript', '.transcriptCard']]) {
        if (label === 'Chapters') {
          await page.locator('.shaka-overflow-menu-button').click({ force: true })
          await page.locator('.phonePlayerOptions[open] .ft-chapters-button').click()
        } else {
          await actions.getByRole('button', { name: new RegExp(label, 'i') }).click()
        }
        const sheet = page.locator('dialog[open]')
        await expect(sheet.locator(content)).toBeVisible()
        await sheet.locator('.mobileSheetHeader').getByRole('button', { name: 'Close', exact: true }).click()
        await expect(sheet).toHaveCount(0)
      }
      await expect(page).toHaveURL(/watch/)
    })

    test('preserves transcript search through the shared Close button', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page, { captionTranslations: true })
      await openMockedVideo(page)
      await setWindowSize(app, page, { width: 360, height: 760 })
      const trigger = page.locator('.videoOptions').getByRole('button', { name: /transcript/i })
      await trigger.click()
      const transcript = page.locator('dialog[open] .transcriptCard')
      await page.locator('.mobileSheetHeader').getByRole('button', { name: 'Search transcript', exact: true }).click()
      await transcript.locator('.transcriptControls input').fill('elephant')
      await page.locator('.mobileSheetHeader').getByRole('button', { name: 'Close', exact: true }).click()
      await expect(page.locator('dialog[open]')).toHaveCount(0)
      await trigger.click()
      await expect(transcript.locator('.transcriptControls input')).toHaveValue('elephant')
    })

    test('opens live chat in a sheet and keeps it mounted when dismissed', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      const view = await watchViewHandle(page)
      await view.evaluate(view => {
        const listeners = new Map()
        view.$store.commit('setHideLiveChatReplay', false)
        view.liveChatIsReplay = true
        view.liveChat = {
          is_replay: true,
          on(event, listener) { listeners.set(listener, event) },
          once(event, listener) { listeners.set(listener, event) },
          off(_event, listener) { listeners.delete(listener) },
          start() {},
          stop() {},
          emit(event, value) {
            for (const [listener, name] of listeners) if (name === event) listener(value)
          }
        }
      })
      await setWindowSize(app, page, { width: 360, height: 760 })
      const trigger = page.locator('.videoOptions').getByRole('button', { name: /Live Chat/i })
      await trigger.click()
      const chat = page.locator('dialog[open] .phoneLiveChat')
      await expect(chat).toBeVisible()
      await expect(chat).toBeInViewport()
      await view.evaluate(view => {
        view.liveChat.emit('start', {
          actions: Array.from({ length: 45 }, (_, index) => {
            let checks = 0
            return {
              is: () => ++checks === 2,
              item: {
                is: () => true,
                id: `phone-chat-${index}`,
                timestamp: Date.now(),
                message: { runs: [{ text: `Phone message ${index}` }] },
                author: { badges: [], id: `viewer-${index}`, name: 'Viewer', thumbnails: [{ url: '' }], is_moderator: false }
              }
            }
          })
        })
      })
      const scroller = chat.locator('.liveChatComments')
      await expect(scroller.locator('.chatMessage')).toHaveCount(45)
      await scroller.dispatchEvent('wheel', { deltaY: -100 })
      await scroller.evaluate(element => { element.scrollTop = 180 })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeCloseTo(180, 0)
      await page.locator('.mobileSheetHeader').getByRole('button', { name: 'Close', exact: true }).click()
      await expect(page.locator('dialog[open]')).toHaveCount(0)
      expect(await view.evaluate(view => view.liveChatOpen)).toBe(true)
      await trigger.click()
      await expect(chat).toBeVisible()
      // Allow chat's debounced viewport observer to finish after reopening.
      await page.waitForTimeout(350)
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeCloseTo(180, 0)
    })

    test('filters playlists and keeps Create reachable', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      await setWindowSize(app, page, { width: 360, height: 760 })
      await page.locator('.videoOptions').getByRole('button', { name: /^Add to playlist$/i }).click()
      const picker = page.locator('.phonePlaylistPicker')
      await expect(picker).toBeVisible()
      await picker.locator('.playlistList').evaluate(element => { element.scrollTop = 100000 })
      await picker.locator('.playlistSearch').fill('Phone playlist 23')
      await expect(picker.locator('li')).toHaveCount(1)
      await expectNoScrollbarOverflow(picker.locator('.playlistList'))
      await picker.locator('li').click()
      await expect(picker.locator('li')).toHaveAttribute('aria-selected', 'true')
      await picker.getByRole('button', { name: /Create new playlist/i }).click()
      await expect(page.locator('.playlistNameInput')).toBeVisible()
      await expect(page.locator('.promptFixedFooter')).toBeInViewport()
    })

    test('keeps filter actions fixed and clears the visible summary', async ({ app, page }) => {
      await setWindowSize(app, page, { width: 360, height: 760 })
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('showSearchFilters'))
      const prompt = page.locator('.searchFiltersCard')
      await expect(prompt).toBeVisible()
      await prompt.getByText('Today', { exact: true }).click()
      await expect(prompt.locator('.activeFilters')).toContainText('Today')
      await prompt.locator('.promptContentScroller').evaluate(element => { element.scrollTop = 100000 })
      await expect(prompt.locator('.clearFilterButton')).toBeInViewport()
      await expect(prompt.locator('.promptFixedFooter')).toBeInViewport()
      await prompt.locator('.clearFilterButton').click()
      await expect(prompt.locator('.activeFilters')).toHaveCount(0)
      await prompt.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(prompt).toHaveCount(0)
    })

    test('collapses advanced download options without leaving an obsolete scroll offset', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      await setWindowSize(app, page, { width: 360, height: 760 })
      await page.locator('.videoOptions').getByRole('button', { name: 'Download Video', exact: true }).click()
      const prompt = page.locator('.downloadPromptCard')
      const advanced = prompt.locator('.advancedDownloadOptions')
      await expect(advanced).not.toHaveAttribute('open')
      await advanced.locator('summary').click()
      await expect(advanced).toHaveAttribute('open')
      const scroller = prompt.locator('.downloadOptions')
      await scroller.evaluate(element => { element.scrollTop = 100000 })
      await advanced.evaluate(element => { element.open = false })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
      await expect(prompt.locator('.downloadFooter')).toBeInViewport()
    })
  })
}

for (const currentLocale of ['en-US', 'de-DE', 'ar']) {
  test.describe(`phone layout in ${currentLocale}`, () => {
    test.use({ seed: { settings: { currentLocale, useAITranslationCompletions: true, quickSettings: ['currentLocale', 'baseTheme', 'uiScale'] } } })
    test('fits small phones, landscape, and tablet windows', async ({ app, page }) => {
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
      for (const [width, height] of [[320, 640], [360, 760], [720, 360], [900, 900]]) {
        await setWindowSize(app, page, { width, height })
        await page.locator('.profileTrigger').click()
        const menu = page.locator('.quickSettingsMenu')
        if (width === 900) {
          await expect(menu).toHaveCSS('position', 'absolute')
        } else {
          await expect(menu).toHaveCSS('position', 'relative')
          await expect.poll(() => menu.evaluate(element => {
            const box = element.getBoundingClientRect()
            return box.left >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1
          })).toBe(true)
          await menu.locator('.select').filter({ has: page.locator('option[value="de-DE"]') }).getByRole('combobox').click()
          const sheet = page.locator('dialog[open]').last()
          await sheet.locator('.pickerSearch').fill('Deutsch')
          await expect(sheet.getByRole('option')).toHaveCount(1)
          await sheet.press('Escape')
          await expect(page.locator('dialog[open]')).toHaveCount(1)
        }
        await menu.press('Escape')
        await expect(menu).toHaveCount(0)
      }
    })
  })
}
