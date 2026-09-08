import { test, expect, goToSettingsSection, setWindowSize, updateInputWithoutScrolling } from '../../helpers/app.mjs'

async function expectValidScrollRange(content) {
  await expect.poll(() => content.evaluate(element => {
    const section = element.querySelector(':scope > .section, :scope > .settingsSearchResults')
    const end = section.getBoundingClientRect().bottom - element.getBoundingClientRect().top + element.scrollTop +
      Number.parseFloat(getComputedStyle(element).paddingBottom)
    return element.scrollTop - Math.max(0, end - element.clientHeight)
  })).toBeLessThanOrEqual(1)
  await content.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => content.evaluate(element => {
    const section = element.querySelector(':scope > .section, :scope > .settingsSearchResults')
    const end = section.getBoundingClientRect().bottom - element.getBoundingClientRect().top + element.scrollTop +
      Number.parseFloat(getComputedStyle(element).paddingBottom)
    const maxScroll = Math.max(0, end - element.clientHeight)
    const scrollbar = element.querySelector('.os-scrollbar-vertical')
    if (maxScroll <= 1) return element.scrollTop <= 1 && scrollbar.classList.contains('os-scrollbar-unusable')
    const track = scrollbar.querySelector('.os-scrollbar-track').getBoundingClientRect()
    const handle = scrollbar.querySelector('.os-scrollbar-handle')
    const thumb = handle.getBoundingClientRect()
    const expectedHeight = Math.max(Number.parseFloat(getComputedStyle(handle).minHeight) || 0,
      track.height * element.clientHeight / end)
    return Math.abs(element.scrollTop - maxScroll) <= 1 &&
      !scrollbar.classList.contains('os-scrollbar-unusable') &&
      Math.abs(track.bottom - thumb.bottom) <= 1 && Math.abs(thumb.height - expectedHeight) <= 1
  })).toBe(true)
}

for (const uiScale of [100, 125]) {
  test.describe(`screenshot settings at ${uiScale}% UI scale`, () => {
    test.use({ seed: { settings: { uiScale, enableScreenshot: true, screenshotMode: 'prompt_folder' } } })

    test('clamps the bottom offset and updates the scrollbar when screenshot settings shorten', async ({ app, page }) => {
      await setWindowSize(app, page, { width: 375, height: 850 })
      await goToSettingsSection(page, 'playback')
      const content = page.locator('.settingsContent')
      const update = values => page.evaluate(async values => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        for (const [action, value] of Object.entries(values)) await store.dispatch(action, value)
      }, values)
      const scrollToBottom = async () => {
        await content.evaluate(element => { element.scrollTop = element.scrollHeight })
        await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      }
      for (const values of [
        { updateScreenshotMode: 'prompt_folder' },
        { updateScreenshotMode: 'clipboard' },
        { updateEnableScreenshot: false },
      ]) {
        await update({ updateEnableScreenshot: true, updateScreenshotMode: 'default_folder' })
        await expect(content.locator('.screenshotFolderPath')).toBeVisible()
        await scrollToBottom()
        const previousHeight = await content.locator(':scope > .section').evaluate(element => element.getBoundingClientRect().height)
        await update(values)
        await expect.poll(() => content.locator(':scope > .section').evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(previousHeight)
        await expectValidScrollRange(content)
      }
      await update({ updateEnableScreenshot: true, updateScreenshotMode: 'default_folder' })
      await expect(content.locator('.screenshotFolderPath')).toBeVisible()
      await scrollToBottom()
      await setWindowSize(app, page, { width: 850, height: 900 })
      await expectValidScrollRange(content)
      await scrollToBottom()
      await updateInputWithoutScrolling(page.getByPlaceholder('Search settings'), 'Screenshot')
      await expect(content.locator('.settingsSearchResults')).toBeVisible()
      await expectValidScrollRange(content)
    })

    test('keeps screenshot controls inside the settings viewport on narrow screens', async ({ app, page }, testInfo) => {
      await setWindowSize(app, page, { width: 375, height: 850 })
      await goToSettingsSection(page, 'playback')
      const content = page.locator('.settingsContent')
      const mode = content.locator('.select').filter({ hasText: 'Screenshot Mode' }).locator('select')
      for (const value of ['prompt_folder', 'default_folder', 'clipboard', 'prompt_folder']) {
        await mode.selectOption(value)
        await expect.poll(() => content.evaluate(element => {
          const viewport = element.querySelector('[data-overlayscrollbars-viewport]') ?? element
          return viewport.scrollWidth - viewport.clientWidth
        })).toBeLessThanOrEqual(1)
        await expect(content.locator('.os-scrollbar-horizontal')).toHaveClass(/os-scrollbar-unusable/)
      }
      await content.locator('.screenshotFilenamePatternInput').scrollIntoViewIfNeeded()
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      // Capture the full Electron framebuffer, including at non-default zoom.
      const screenshot = await app.electronApp.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
      await testInfo.attach('screenshot settings on phone', {
        body: Buffer.from(screenshot, 'base64'), contentType: 'image/png',
      })
      await setWindowSize(app, page, { width: 850, height: 375 })
      await expect.poll(() => content.evaluate(element => {
        const viewport = element.querySelector('[data-overlayscrollbars-viewport]') ?? element
        return viewport.scrollWidth - viewport.clientWidth
      })).toBeLessThanOrEqual(1)
    })
  })
}
