import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, goToSettingsSection, latestSettings } from '../../helpers/app.mjs'
import { DEFAULT_QUICK_SETTINGS } from '../../../src/renderer/helpers/quickSettings.js'

const ALL_QUICK_SETTINGS = [
  ...DEFAULT_QUICK_SETTINGS,
  'useProxy',
]

const ADDITIONAL_QUICK_SETTINGS = [
  ['rememberHistory', 'Remember Watch History', 'Privacy'],
  ['rememberSearchHistory', 'Remember Search History', 'Privacy'],
  ['ambientMode', 'Ambient Mode', 'Appearance'],
  ['autoplayVideos', 'Start Videos Automatically', 'Playback'],
  ['autoplayPlaylists', 'Autoplay Playlist Videos', 'Playback'],
  ['defaultPlayback', 'Default Playback Rate', 'Playback'],
  ['scrollMiniPlayerEnabled', 'Keep a mini player on screen when scrolling down', 'Playback'],
  ['defaultVideoFormat', 'Default Video Format', 'Playback'],
  ['useDeArrowTitles', 'Use DeArrow Video Titles', 'Add-ons'],
  ['useDeArrowThumbnails', 'Use DeArrow for thumbnails', 'Add-ons'],
  ['hideLiveChat', 'Hide Live Chat', 'Content'],
  ['hideLiveChatReplay', 'Hide Live Chat Replay', 'Content'],
  ['showThumbnailPreviews', 'Show thumbnail previews', 'Content'],
  ['hideSubscriptionsShorts', 'Hide Subscriptions Shorts', 'Content'],
  ['blurThumbnails', 'Blur thumbnails', 'Content'],
  ['enableCaptionTranslations', 'Enable Caption Translations', 'Language and region'],
  ['enableCommentTranslations', 'Enable comment translations', 'Language and region'],
]

test.describe('additional quick settings', () => {
  test.use({ seed: { settings: { quickSettings: [], uiScale: 125 } } })

  test('adds all suggested controls, groups them, and persists changes across restart', async ({ app, page }, testInfo) => {
    test.setTimeout(120_000)
    const appearance = await goToSettingsSection(page, 'appearance')
    await appearance.getByRole('button', { name: 'Customize quick settings' }).click()
    await page.getByRole('button', { name: 'Add setting' }).click()
    const search = page.getByPlaceholder('Search settings')
    for (const [, label] of ADDITIONAL_QUICK_SETTINGS) {
      await search.fill(label)
      await page.locator('.settingPicker .optionWrapper').getByText(new RegExp(`^${label}$`, 'i')).click()
    }
    await search.press('Escape')
    await page.locator('.settingsCloseButton').click()
    await page.locator('.profileTrigger').click()
    const menu = page.getByRole('dialog', { name: 'Quick settings' })
    const expected = {}

    for (const [id, label, section] of ADDITIONAL_QUICK_SETTINGS) {
      const control = menu.locator(`[data-setting-id="${id}"]`)
      await expect(control.locator('..').getByRole('heading'))
        .toHaveText(section)
      if (id === 'defaultPlayback') {
        const slider = control.getByRole('slider')
        await slider.press('ArrowRight')
        expected[id] = 1.25
        await expect(slider).toHaveValue('1.25')
      } else if (id === 'defaultVideoFormat') {
        await control.getByRole('combobox', { name: new RegExp(`^${label}$`, 'i') }).click()
        await page.getByRole('option', { name: /^Audio Formats$/i }).click()
        expected[id] = 'audio'
      } else {
        const toggle = control.getByRole('checkbox')
        expected[id] = !await toggle.isChecked()
        await control.locator('label.switch-label').click()
        await expect(toggle).toBeChecked({ checked: expected[id] })
      }
      await expect(menu).toBeVisible()
    }

    const ids = ADDITIONAL_QUICK_SETTINGS.map(([id]) => id)
    await expect.poll(async () => {
      const saved = latestSettings(await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8'))
      return Object.fromEntries(['quickSettings', ...ids].map(id => [id, saved[id]]))
    }).toEqual({ quickSettings: ids, ...expected })

    ;({ page } = await app.relaunch())
    await page.locator('.profileTrigger').click()
    const reopened = page.getByRole('dialog', { name: 'Quick settings' })
    await expect(reopened.getByRole('heading', { name: 'Privacy', exact: true })
      .locator('[data-icon="lock"]')).toBeVisible()
    await expect.poll(() => reopened.locator('.quickSettingControl').evaluateAll(controls => (
      controls.map(control => control.dataset.settingId)
    ))).toEqual(ids)
    for (const [id, value] of Object.entries(expected)) {
      const control = reopened.locator(`[data-setting-id="${id}"]`)
      if (typeof value === 'boolean') {
        await expect(control.getByRole('checkbox')).toBeChecked({ checked: value })
      } else if (typeof value === 'number') {
        await expect(control.getByRole('slider')).toHaveValue(String(value))
      } else {
        await expect(control.getByRole('combobox')).toContainText(/Audio Formats/i)
      }
    }
    const bounds = await reopened.boundingBox()
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height)
    // Electron capturePage includes the entire window at non-100% zoom.
    const screenshot = await app.electronApp.evaluate(async ({ BrowserWindow }) => (
      (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toDataURL()
    ))
    await testInfo.attach('expanded quick settings catalog at 125 percent scale', {
      body: Buffer.from(screenshot.split(',')[1], 'base64'),
      contentType: 'image/png',
    })
  })
})

test.describe('quick playback speed', () => {
  test.use({
    seed: {
      settings: {
        quickSettings: ['defaultPlayback'],
        videoPlaybackRateInterval: 0.1,
        maxVideoPlaybackRate: 5,
      }
    }
  })

  test('uses the configured speed interval and maximum', async ({ page }) => {
    await page.locator('.profileTrigger').click()
    const slider = page.getByRole('dialog', { name: 'Quick settings' }).getByRole('slider')
    await expect(slider).toHaveAttribute('min', '0.1')
    await expect(slider).toHaveAttribute('max', '5')
    await expect(slider).toHaveAttribute('step', '0.1')
    await slider.press('Home')
    await slider.press('ArrowRight')
    await expect(slider).toHaveValue('0.2')
    await slider.press('End')
    await expect.poll(() => page.evaluate(() => (
      document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getDefaultPlayback
    ))).toBe(5)
  })
})

test.describe('quick thumbnail blur', () => {
  test.use({ seed: { settings: { quickSettings: ['blurThumbnails'] } } })

  test('reflects the quick toggle and reset in the full thumbnail selector', async ({ page }) => {
    for (const preference of ['blur', 'middle']) {
      const appearance = await goToSettingsSection(page, 'appearance')
      const select = appearance.locator('.select').filter({
        has: page.getByRole('combobox', { name: 'Thumbnail Preference' })
      }).locator('select')
      await select.selectOption(preference)
      await expect(select).toHaveValue(preference)
      await page.locator('.settingsCloseButton').click()
      await page.locator('.profileTrigger').click()
      const menu = page.getByRole('dialog', { name: 'Quick settings' })
      const toggle = menu.getByRole('checkbox', { name: 'Blur thumbnails' })
      const label = menu.locator('label.switch-label')

      if (preference === 'middle') {
        await label.click()
        await expect(toggle).toBeChecked()
      }
      await label.click()
      await expect(toggle).not.toBeChecked()
      await label.click()
      await expect(toggle).toBeChecked()
      await menu.getByRole('button', { name: 'Reset this setting to its default' }).click()
      await expect(toggle).not.toBeChecked()

      await menu.getByRole('button', { name: 'All Settings' }).click()
      const reopened = await goToSettingsSection(page, 'appearance')
      const reopenedSelect = reopened.locator('.select').filter({
        has: page.getByRole('combobox', { name: 'Thumbnail Preference' })
      }).locator('select')
      await expect(reopenedSelect).toHaveValue(preference === 'blur' ? '' : preference)
    }
  })
})

test.describe('quick settings menu', () => {
  test.use({ seed: { settings: { quickSettings: ALL_QUICK_SETTINGS } } })

  test('opens the command palette from the header action', async ({ page }) => {
    await page.locator('.profileTrigger').click()
    const menu = page.getByRole('dialog', { name: 'Quick settings' })
    const shortcut = menu.getByRole('button', { name: 'Open command palette' })

    await expect(shortcut).toBeVisible()
    await expect(shortcut).toHaveClass(/commandPaletteShortcut/)
    await expect(shortcut.locator('[data-icon="terminal"]')).toBeVisible()
    await expect(menu.locator('.menuLinks').getByRole('button', { name: 'Open command palette' })).toHaveCount(0)

    await shortcut.click()
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
  })

  test('fits a maximized 1080p window and spaces both sliders consistently', async ({ app, page }) => {
    await app.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1920, height: 1080 })
    })
    await expect.poll(() => page.evaluate(() => window.innerHeight)).toBeGreaterThanOrEqual(1000)

    await page.locator('.profileTrigger').click()
    const menu = page.locator('.quickSettingsMenu')
    await expect(menu).toBeVisible()

    expect(await menu.evaluate(element => element.scrollHeight <= element.clientHeight)).toBe(true)

    const sliders = menu.locator('.sliderGroup .pure-material-slider')
    await expect(sliders).toHaveCount(2)
    const gaps = await sliders.evaluateAll(elements => elements.map(element => {
      const label = element.querySelector('.label')
      const input = element.querySelector('.input')
      const labelBounds = label.getBoundingClientRect()
      const inputBounds = input.getBoundingClientRect()
      return inputBounds.top - labelBounds.bottom
    }))
    expect(Math.abs(gaps[0] - gaps[1])).toBeLessThanOrEqual(1)
  })

  test('shows settings category icons before section names', async ({ page }) => {
    await page.locator('.profileTrigger').click()
    const menu = page.getByRole('dialog', { name: 'Quick settings' })
    const expectedHeaders = [
      ['Appearance', 'display'],
      ['Playback', 'circle-play'],
      ['Content', 'eye-slash'],
      ['Language and region', 'globe'],
      ['Proxy', 'flask'],
    ]

    for (const [label, icon] of expectedHeaders) {
      const heading = menu.getByRole('heading', { name: label, exact: true })
      await expect(heading.locator(`[data-icon="${icon}"]`)).toBeVisible()
      expect(await heading.evaluate(element => [...element.children].map(child => (
        child.classList.contains('menuSectionIcon') ? 'icon' : child.tagName.toLowerCase()
      )))).toEqual(['icon', 'span'])
    }
  })

  test('stays inside a short viewport below horizontal tabs', async ({ app, page }) => {
    await app.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1280, height: 720 })
    })
    await expect.poll(() => page.evaluate(() => window.innerHeight)).toBe(720)

    await page.locator('.profileTrigger').click()
    const menu = page.locator('.quickSettingsMenu')
    const tabBar = page.locator('.tabBar:not(.vertical)')
    await expect(menu).toBeVisible()
    await expect(tabBar).toBeVisible()

    const [menuBounds, tabBarBounds] = await Promise.all([
      menu.evaluate(element => element.getBoundingClientRect().toJSON()),
      tabBar.evaluate(element => element.getBoundingClientRect().toJSON())
    ])
    expect(menuBounds.top).toBeGreaterThanOrEqual(tabBarBounds.bottom)
    expect(menuBounds.bottom).toBeLessThanOrEqual(720)
  })

  test('keeps its full phone width when route cards lose their gutters', async ({ app, page }) => {
    await app.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 375, height: 700 })
    })
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(375)
    await page.locator('.app').evaluate((element) => {
      element.classList.add('capacitorTabs', 'capacitorPhoneLayout')
    })

    await page.locator('.profileTrigger').click()
    const menu = page.locator('.quickSettingsMenu')
    await expect(menu).toBeVisible()

    const bounds = await menu.evaluate(element => element.getBoundingClientRect().toJSON())
    expect(bounds.width).toBeGreaterThan(300)
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(375)
  })

  test('does not expose a horizontal scrollbar on a phone-sized viewport', async ({ app, page }) => {
    await app.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 375, height: 700 })
    })
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(375)
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateCurrentLocale', 'es')
      document.querySelector('.app').classList.add('capacitorTabs', 'capacitorPhoneLayout')
    })

    await page.locator('.profileTrigger').click()
    const scroller = page.locator('.quickSettingsScroll')
    await expect(scroller).toBeVisible()

    await expect.poll(() => scroller.evaluate(element => ({
      horizontalScrollRange: element.scrollWidth - element.clientWidth,
      overflowX: getComputedStyle(element).overflowX,
      horizontalScrollbarVisible: element.querySelector('.os-scrollbar-horizontal')
        ?.classList.contains('os-scrollbar-visible') ?? false,
    }))).toEqual({
      horizontalScrollRange: 0,
      overflowX: 'hidden',
      horizontalScrollbarVisible: false,
    })
  })

  test('keeps paired selects aligned and shows locale completeness', async ({ page }) => {
    await page.locator('.profileTrigger').click()
    const menu = page.locator('.quickSettingsMenu')
    const pairs = [
      ['baseTheme', 'mainColor'],
      ['listType', 'playlistViewType'],
      ['currentLocale', 'region'],
    ]

    for (const pair of pairs) {
      const controls = pair.map(settingId => menu.locator(`[data-setting-id="${settingId}"]`))
      const [first, second] = await Promise.all(controls.map(control => control.evaluate(element => {
        const { x, y, width } = element.getBoundingClientRect()
        return { x, y, width }
      })))
      expect(Math.abs(first.y - second.y)).toBeLessThanOrEqual(1)
      expect(second.x).toBeGreaterThan(first.x + first.width)
    }

    await menu.getByRole('combobox', { name: 'Language preference' }).click()
    await expect(page.locator('.selectDropdown')).toContainText('English (US) (100%)')
  })

  test('updates the playlist view type independently', async ({ page }) => {
    await page.locator('.profileTrigger').click()
    const menu = page.getByRole('dialog', { name: 'Quick settings' })
    const videoViewType = menu.getByRole('combobox', { name: 'Video View Type' })
    const playlistViewType = menu.getByRole('combobox', { name: 'Playlist View Type' })

    await expect(videoViewType).toContainText('Grid')
    await expect(playlistViewType).toContainText('Grid')
    await playlistViewType.click()
    await page.getByRole('option', { name: 'List', exact: true }).click()

    await expect(playlistViewType).toContainText('List')
    await expect(videoViewType).toContainText('Grid')
    await expect(menu).toBeVisible()
  })

  test('shows color swatches in the color-theme selector', async ({ page }) => {
    await page.locator('.profileTrigger').click()
    const colorTheme = page.getByRole('dialog', { name: 'Quick settings' })
      .getByRole('combobox', { name: /Main colou?r theme/i })

    await expect(colorTheme.locator('.optionColorDot')).toHaveCSS('background-color', 'rgb(213, 0, 0)')
    await colorTheme.click()

    const options = page.locator('.selectDropdown').getByRole('option')
    await expect(options.first().locator('.optionColorDot')).toHaveCSS('background-color', 'rgb(213, 0, 0)')
    await expect(page.getByRole('option', { name: 'Blue', exact: true }).locator('.optionColorDot'))
      .toHaveCSS('background-color', 'rgb(41, 98, 255)')
  })

  test('hides the unavailable main color selector', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 420 })
    await page.locator('.profileTrigger').click()
    const menu = page.locator('.quickSettingsMenu')
    const appearance = menu.locator('.menuSection').first()
    const scrollViewport = menu.locator('.quickSettingsScroll')
    await scrollViewport.evaluate(element => element.scrollTo(0, element.scrollHeight))

    const baseTheme = appearance.getByRole('combobox', { name: 'Base Theme' })
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.dispatch('updateBaseTheme', 'hotPink')
    })

    await expect(menu).toBeVisible()
    await expect(baseTheme).toBeVisible()
    await expect(appearance.getByRole('combobox', { name: 'Main Color Theme' })).toHaveCount(0)
    const [sectionWidth, controlWidth] = await Promise.all([
      appearance.evaluate(element => element.clientWidth),
      appearance.locator('[data-setting-id="baseTheme"]').evaluate(element => element.clientWidth),
    ])
    expect(controlWidth).toBeGreaterThan(sectionWidth * 0.8)
    await expect.poll(() => scrollViewport.evaluate(element => {
      const content = element.querySelector('.quickSettingsContent')
      return element.scrollTop <= Math.max(0, content.offsetTop + content.offsetHeight - element.clientHeight) + 1
    })).toBe(true)
  })

  test('keeps view headers outside their scrollports and resets switched views', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 420 })
    await page.locator('.profileTrigger').click()
    const menu = page.locator('.quickSettingsMenu')
    const mainScroll = menu.locator('.quickSettingsScroll')

    await expect(mainScroll.locator('.profileHeaderRow')).toHaveCount(0)
    await mainScroll.evaluate(element => element.scrollTo(0, element.scrollHeight))
    await menu.locator('.profileSummary').click()

    await expect(menu.locator('.quickSettingsScroll').locator('.profilePanelHeader')).toHaveCount(0)
    await menu.getByRole('button', { name: 'Back' }).click()
    await expect(menu.locator('.profileHeaderRow')).toBeVisible()
    await expect(mainScroll).toHaveJSProperty('scrollTop', 0)
  })

  test('keeps the menu open when Escape closes a select', async ({ page }) => {
    await page.locator('.profileTrigger').click()
    const menu = page.locator('.quickSettingsMenu')
    const themeSelect = menu.getByRole('combobox', { name: 'Base Theme' })

    await themeSelect.click()
    await expect(page.locator('.selectDropdown')).toBeVisible()
    await themeSelect.press('Escape')

    await expect(page.locator('.selectDropdown')).toBeHidden()
    await expect(menu).toBeVisible()
  })

  test('stays open when the application window loses focus', async ({ app, page }) => {
    await page.locator('.profileTrigger').click()
    const menu = page.locator('.quickSettingsMenu')
    await expect(menu).toBeVisible()

    await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.blur())
    await expect(menu).toBeVisible()
    await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.focus())
    await expect(menu).toBeFocused()

    await page.locator('.topNav .logo').click()
    await expect(menu).toBeHidden()
  })

  test('opens About and switches to Settings from the quick menu', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 12,
        y: 12,
        width: 400,
        height: 600
      }))
    })
    await page.locator('.profileTrigger').click()
    await page.getByRole('dialog', { name: 'Quick settings' }).getByRole('button', { name: 'About' }).click()

    const aboutWindow = page.getByRole('dialog', { name: 'About' })
    await expect(aboutWindow).toBeVisible()
    await expect(aboutWindow.locator('.settingsBreadcrumb')).toContainText('About')
    await expect(aboutWindow.locator('.settingsMenu')).toHaveCount(0)
    await expect(aboutWindow.locator('.settingsBackButton')).toHaveCount(0)

    await page.locator('.profileTrigger').click()
    await page.getByRole('dialog', { name: 'Quick settings' }).getByRole('button', { name: 'All Settings' }).click()

    const settingsWindow = page.getByRole('dialog', { name: 'Settings', exact: true })
    await expect(settingsWindow).toBeVisible()
    await expect(settingsWindow.locator('.settingsMenu')).toBeVisible()
  })

  test('keeps About visible while its close animation plays', async ({ page }) => {
    await page.locator('.profileTrigger').click()
    await page.getByRole('dialog', { name: 'Quick settings' }).getByRole('button', { name: 'About' }).click()

    const aboutWindow = page.getByRole('dialog', { name: 'About' })
    await aboutWindow.locator('.settingsCloseButton').click()

    await expect(aboutWindow).toHaveClass(/settings-window-leave-active/)
    await expect(aboutWindow.locator('.settingsBreadcrumb')).toContainText('About')
    await expect(aboutWindow.locator('.settingsMenu')).toHaveCount(0)
    await expect(aboutWindow).toBeHidden()
  })
})

test.describe('automatic quick setting select pairs', () => {
  test.use({ seed: { settings: { quickSettings: ['baseTheme', 'iconPack'] } } })

  test('places any adjacent selects in two columns', async ({ page }) => {
    await page.locator('.profileTrigger').click()
    const menu = page.locator('.quickSettingsMenu')
    const controls = ['baseTheme', 'iconPack'].map(settingId => (
      menu.locator(`[data-setting-id="${settingId}"]`)
    ))
    const [first, second] = await Promise.all(controls.map(control => control.evaluate(element => {
      const { x, y, width } = element.getBoundingClientRect()
      return { x, y, width }
    })))

    expect(Math.abs(first.y - second.y)).toBeLessThanOrEqual(1)
    expect(second.x).toBeGreaterThan(first.x + first.width)
  })
})

test.describe('customizable quick settings', () => {
  test('centers setting icons vertically within their rows', async ({ page }) => {
    const appearance = await goToSettingsSection(page, 'appearance')
    await appearance.getByRole('button', { name: 'Customize quick settings' }).click()

    const offsets = await page.locator('.selectedSetting').evaluateAll(rows => rows.map(row => {
      const icon = row.querySelector('.selectedSettingIcon > svg')
      const rowBounds = row.getBoundingClientRect()
      const iconBounds = icon.getBoundingClientRect()
      return Math.abs(
        iconBounds.y + iconBounds.height / 2 -
        (rowBounds.y + rowBounds.height / 2)
      )
    }))

    expect(Math.max(...offsets)).toBeLessThanOrEqual(0.5)
  })

  test('starts with the original quick settings', async ({ page }) => {
    await page.locator('.profileTrigger').click()
    const menu = page.getByRole('dialog', { name: 'Quick settings' })

    await expect(menu.getByRole('combobox', { name: 'Base Theme' })).toBeVisible()
    await expect(menu.getByRole('slider', { name: 'UI Scale' })).toBeVisible()
    await expect(menu.getByRole('slider', { name: 'Thumbnail Size' })).toBeVisible()
    await expect(menu.getByRole('combobox', { name: 'Default Quality' })).toBeVisible()
    await expect(menu.getByRole('checkbox', { name: 'Autoplay Recommended Videos' })).toBeVisible()
    await expect(menu.getByRole('checkbox', { name: 'Enable Subtitles by Default' })).toBeVisible()
    await expect(menu.getByRole('combobox', { name: 'Video View Type' })).toBeVisible()
    await expect(menu.getByRole('combobox', { name: 'Playlist View Type' })).toBeVisible()
    await expect(menu.getByRole('checkbox', { name: 'Hide Recommended Videos' })).toBeVisible()
    await expect(menu.getByRole('checkbox', { name: 'Hide Comments' })).toBeVisible()
    await expect(menu.getByRole('combobox', { name: 'Language preference' })).toBeVisible()
    await expect(menu.getByRole('combobox', { name: 'Region for Trending' })).toBeVisible()

    await expect(menu.getByRole('checkbox', { name: 'Enable Tor / Proxy' })).toHaveCount(0)
    await expect(menu.getByRole('button', { name: 'Customize quick settings' })).toHaveCount(0)
  })

  test('adds basic controls from Appearance and resets them', async ({ app, page }) => {
    const appearance = await goToSettingsSection(page, 'appearance')
    const customizeButton = appearance.getByRole('button', { name: 'Customize quick settings' })
    const launcher = appearance.locator('.customizerLaunchers')
    await expect(launcher).toBeVisible()
    await expect(customizeButton).toBeVisible()
    await expect(launcher.getByRole('button')).toHaveCount(2)
    await expect(launcher.getByRole('button', { name: 'Customize navigation' })).toBeVisible()
    await customizeButton.click()
    await expect(page.locator('.settingsBreadcrumb')).toContainText('Customize quick settings')

    const selectedSettings = page.locator('.selectedSettings')
    await expect(selectedSettings.locator('.selectedSetting')).toHaveCount(DEFAULT_QUICK_SETTINGS.length)
    await expect(selectedSettings.locator('.selectedSettingIcon')).toHaveCount(DEFAULT_QUICK_SETTINGS.length)
    await expect.poll(() => selectedSettings.locator('.selectedSetting').evaluateAll(rows => (
      rows.map(row => row.dataset.settingId)
    ))).toEqual(DEFAULT_QUICK_SETTINGS)
    const actions = page.locator('.quickSettingsActions')
    const [subpageBounds, actionsBounds, settingsBounds, actionButtonBounds] = await Promise.all([
      page.locator('.settingsSubpageContent').boundingBox(),
      actions.boundingBox(),
      selectedSettings.boundingBox(),
      actions.getByRole('button').evaluateAll(buttons => buttons.map(button => (
        button.getBoundingClientRect().toJSON()
      ))),
    ])
    const subpageCenter = subpageBounds.x + subpageBounds.width / 2
    expect(Math.abs(actionsBounds.x + actionsBounds.width / 2 - subpageCenter)).toBeLessThanOrEqual(1)
    expect(Math.abs(settingsBounds.x + settingsBounds.width / 2 - subpageCenter)).toBeLessThanOrEqual(1)
    const actionGroupCenter = (
      actionButtonBounds[0].x + actionButtonBounds.at(-1).x + actionButtonBounds.at(-1).width
    ) / 2
    expect(Math.abs(actionGroupCenter - subpageCenter)).toBeLessThanOrEqual(1)
    await page.getByRole('button', { name: 'Remove Hide Comments' }).click()
    await expect(selectedSettings).not.toContainText('Hide Comments')

    await page.getByRole('button', { name: 'Add setting' }).click()
    const settingPicker = page.getByPlaceholder('Search settings')
    const settingPopover = page.getByRole('dialog', { name: 'Add setting' })
    await expect(settingPopover).toBeVisible()
    await expect(settingPopover).toHaveCSS('position', 'absolute')
    await expect(settingPicker).toHaveAttribute('type', 'search')
    await expect(settingPopover.locator('.clearInputTextButton')).toHaveCount(0)
    await expect(page.locator('.settingPicker .optionWrapper').first()).toHaveCSS('cursor', 'pointer')
    await expect(page.locator('.settingPicker .optionWrapper').first()).toHaveCSS('user-select', 'none')
    await expect(selectedSettings.locator('.selectedSetting').first()).toHaveCSS('user-select', 'none')
    for (const setting of ['Icon Pack', 'UI Roundness', 'Enable Tor / Proxy']) {
      await settingPicker.fill(setting)
      await page.locator('.settingPicker .optionWrapper').filter({ hasText: setting }).click()
    }
    await settingPicker.press('Escape')
    await expect(settingPopover).toBeHidden()
    await expect(page.getByRole('button', { name: 'Add setting' })).toBeFocused()
    await page.locator('.settingsCloseButton').click()

    await page.locator('.profileTrigger').click()
    const menu = page.getByRole('dialog', { name: 'Quick settings' })
    const iconPack = menu.getByRole('combobox', { name: 'Icon Pack' })
    await expect(iconPack).toBeVisible()
    await expect(menu.getByRole('slider', { name: 'UI Roundness' })).toBeVisible()
    await expect(menu.getByRole('checkbox', { name: 'Hide Comments' })).toHaveCount(0)
    await iconPack.click()
    await page.getByRole('option', { name: 'Remix Icon' }).click()
    await expect(iconPack).toContainText('Remix Icon')
    await menu.locator('label.switch-label').filter({ hasText: 'Enable Tor / Proxy' }).click()
    await expect.poll(() => app.electronApp.evaluate(async ({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows()[0].webContents.session.resolveProxy('https://example.com')
    })).toContain('127.0.0.1:9050')

    await menu.getByRole('button', { name: 'All Settings' }).click()
    const reopenedAppearance = await goToSettingsSection(page, 'appearance')
    await reopenedAppearance.getByRole('button', { name: 'Customize quick settings' }).click()
    await page.getByRole('button', { name: 'Reset to defaults' }).click()
    await expect(page.locator('.selectedSetting')).toHaveCount(DEFAULT_QUICK_SETTINGS.length)
    await expect(page.locator('.selectedSettings')).toContainText(/Base theme/i)
    await expect(page.locator('.selectedSettings')).not.toContainText('Icon Pack')
  })

  test('rearranges controls with buttons and drag and drop', async ({ page }) => {
    const appearance = await goToSettingsSection(page, 'appearance')
    await appearance.getByRole('button', { name: 'Customize quick settings' }).click()

    const selectedSettings = page.locator('.selectedSettings')
    const settingIds = () => selectedSettings.locator('.selectedSetting').evaluateAll(rows => (
      rows.map(row => row.dataset.settingId)
    ))
    await expect(page.getByRole('button', { name: 'Move Base Theme up' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Move Region for Trending down' })).toBeDisabled()

    await page.getByRole('button', { name: 'Move Hide Comments up' }).click()
    const hideCommentsMovedUp = [...DEFAULT_QUICK_SETTINGS]
    const hideCommentsIndex = hideCommentsMovedUp.indexOf('hideComments')
    hideCommentsMovedUp.splice(hideCommentsIndex, 1)
    hideCommentsMovedUp.splice(hideCommentsIndex - 1, 0, 'hideComments')
    await expect.poll(settingIds).toEqual(hideCommentsMovedUp)

    const dragData = await page.evaluateHandle(() => new DataTransfer())
    const hideComments = selectedSettings.locator('[data-setting-id="hideComments"]')
    const baseTheme = selectedSettings.locator('[data-setting-id="baseTheme"]')
    await hideComments.locator('.dragHandle').dispatchEvent('dragstart', { dataTransfer: dragData })
    await baseTheme.dispatchEvent('dragover', { dataTransfer: dragData })
    await baseTheme.dispatchEvent('drop', { dataTransfer: dragData })
    await hideComments.locator('.dragHandle').dispatchEvent('dragend', { dataTransfer: dragData })
    const hideCommentsFirst = [
      'hideComments',
      ...DEFAULT_QUICK_SETTINGS.filter(settingId => settingId !== 'hideComments'),
    ]
    await expect.poll(settingIds).toEqual(hideCommentsFirst)

    await page.locator('.settingsCloseButton').click()
    await page.locator('.profileTrigger').click()
    const menu = page.getByRole('dialog', { name: 'Quick settings' })
    await expect.poll(() => menu.locator('.quickSettingControl').evaluateAll(controls => (
      controls.map(control => control.dataset.settingId)
    ))).toEqual(hideCommentsFirst)

    await menu.getByRole('button', { name: 'All Settings' }).click()
    const reopenedAppearance = await goToSettingsSection(page, 'appearance')
    await reopenedAppearance.getByRole('button', { name: 'Customize quick settings' }).click()
    await expect.poll(settingIds).toEqual(hideCommentsFirst)
  })
})

test.describe('quick settings customization at fractional UI scale', () => {
  test.use({ seed: { settings: { uiScale: 125 } } })

  test('keeps the searchable setting list usable when filtering shortens it', async ({ app, page }) => {
    await app.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 900, height: 650 })
    })
    const appearance = await goToSettingsSection(page, 'appearance')
    await appearance.getByRole('button', { name: 'Customize quick settings' }).click()
    await page.getByRole('button', { name: 'Add setting' }).click()

    const settingPicker = page.getByPlaceholder('Search settings')
    const settingPopover = page.getByRole('dialog', { name: 'Add setting' })
    const options = page.locator('.settingPicker .list')
    const scrollbar = options.locator('.os-scrollbar-vertical')
    await expect(options).toBeVisible()
    await expect(settingPicker).toHaveCSS('padding-inline-start', '16px')
    await expect(scrollbar).toHaveClass(/os-scrollbar-visible/)
    await options.evaluate(element => element.scrollTo(0, element.scrollHeight))
    await expect.poll(() => options.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    const [popoverBounds, scrollbarBounds] = await Promise.all([
      settingPopover.evaluate(element => element.getBoundingClientRect().toJSON()),
      scrollbar.evaluate(element => element.getBoundingClientRect().toJSON()),
    ])
    expect(scrollbarBounds.x).toBeGreaterThanOrEqual(popoverBounds.x - 1)
    expect(scrollbarBounds.y).toBeGreaterThanOrEqual(popoverBounds.y - 1)
    expect(scrollbarBounds.x + scrollbarBounds.width).toBeLessThanOrEqual(
      popoverBounds.x + popoverBounds.width + 1
    )
    expect(scrollbarBounds.y + scrollbarBounds.height).toBeLessThanOrEqual(
      popoverBounds.y + popoverBounds.height + 1
    )
    const hoveredOption = options.locator('li').nth(1)
    await hoveredOption.hover()
    const [hoveredOptionBounds, scrollbarTrackBounds] = await Promise.all([
      hoveredOption.evaluate(element => element.getBoundingClientRect().toJSON()),
      scrollbar.evaluate(element => element.getBoundingClientRect().toJSON()),
    ])
    expect(hoveredOptionBounds.x + hoveredOptionBounds.width).toBeLessThanOrEqual(
      scrollbarTrackBounds.x + 1
    )

    await settingPicker.fill('Icon Pack')
    await expect(options.locator('li')).toHaveCount(1)
    await expect(options).toHaveJSProperty('scrollTop', 0)
    await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
  })
})

test.describe('quick distraction settings', () => {
  test.use({ seed: { settings: { playNextVideo: true } } })

  test('turns off autoplay when recommended videos are hidden', async ({ page }) => {
    await page.locator('.profileTrigger').click()

    const autoplay = page.getByRole('checkbox', { name: 'Autoplay Recommended Videos' })
    await expect(autoplay).toBeChecked()
    await page.locator('label.switch-label').filter({ hasText: 'Hide Recommended Videos' }).click()

    await expect(autoplay).not.toBeChecked()
    await expect(autoplay).toBeDisabled()
  })
})

test.describe('quick settings focus after control updates', () => {
  test.use({
    seed: {
      settings: {
        baseTheme: 'dark',
        highlightChangedSettings: true
      }
    }
  })

  test('stays open when a reset control removes itself', async ({ page }) => {
    await page.locator('.profileTrigger').click()
    const menu = page.locator('.quickSettingsMenu')
    const reset = menu.getByRole('button', { name: 'Reset this setting to its default' }).first()
    await expect(reset).toBeVisible()

    await reset.click()

    await expect(reset).toHaveCount(0)
    await expect(menu).toBeVisible()
  })

  test('stays open when a switch adds its reset control', async ({ page }) => {
    await page.locator('.profileTrigger').click()
    const menu = page.locator('.quickSettingsMenu')
    const hideComments = page.getByRole('checkbox', { name: 'Hide Comments' })

    await menu.locator('label.switch-label').filter({ hasText: 'Hide Comments' }).click()

    await expect(hideComments).toBeChecked()
    await expect(menu).toBeVisible()
  })
})
