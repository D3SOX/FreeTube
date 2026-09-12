import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { DBActions } from '../../../src/constants.js'
import {
  test,
  expect,
  expectAnimation,
  goTo,
  goToSettingsSection,
  latestSettings,
  openNewWindowFromTabBar,
  recordAnimations,
  sel,
  setWindowSize,
  waitForAppReady
} from '../../helpers/app.mjs'

async function expectCompactCustomThemeEditor(page) {
  const appearance = await goToSettingsSection(page, 'appearance')
  await appearance.getByRole('button', { name: 'Create custom theme' }).click()

  const editor = page.locator('.customThemeEditor')
  await expect(editor.locator('.themeNameField > input')).toBeVisible()

  const spacing = await editor.evaluate(element => {
    const contentBounds = element.closest('.settingsSubpageScroll').getBoundingClientRect()
    const nameFieldBounds = element.querySelector('.themeNameField').getBoundingClientRect()
    const buttonBounds = element.querySelector('.editorFooter .btn:last-child').getBoundingClientRect()
    return {
      top: nameFieldBounds.top - contentBounds.top,
      bottom: contentBounds.bottom - buttonBounds.bottom
    }
  })

  expect(spacing.top).toBeLessThanOrEqual(12)
  expect(spacing.bottom).toBeLessThanOrEqual(12)
}

async function expectDownloadQueueSettingsAlignment(page) {
  const downloads = await goToSettingsSection(page, 'download')
  const enableDownloads = downloads.getByRole('checkbox', { name: 'Enable Downloads' })
  if (!await enableDownloads.isChecked()) {
    await downloads.locator('label.switch-label').filter({ hasText: 'Enable Downloads' }).click()
  }

  const bounds = await downloads.evaluate(element => {
    const pathInputs = element.querySelectorAll('.downloadPathInputs .ft-input')
    const queueSelect = element.querySelector('.downloadQueueInputs .select-text')
    const queueSelectLabel = element.querySelector('.downloadQueueInputs .select-label')
    const bandwidthInput = element.querySelector('.downloadQueueInputs .ft-input')
    const bandwidthLabel = element.querySelector('.downloadQueueInputs .selectLabel')

    return {
      folder: pathInputs[0].getBoundingClientRect().toJSON(),
      customArguments: pathInputs[1].getBoundingClientRect().toJSON(),
      queueSelect: queueSelect.getBoundingClientRect().toJSON(),
      queueSelectLabel: queueSelectLabel.getBoundingClientRect().toJSON(),
      bandwidthInput: bandwidthInput.getBoundingClientRect().toJSON(),
      bandwidthLabel: bandwidthLabel.getBoundingClientRect().toJSON()
    }
  })

  expect(Math.abs(bounds.folder.x - bounds.queueSelect.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(bounds.customArguments.x - bounds.bandwidthInput.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(bounds.queueSelect.y - bounds.bandwidthInput.y)).toBeLessThanOrEqual(1)
  expect(Math.abs(bounds.queueSelectLabel.y - bounds.bandwidthLabel.y)).toBeLessThanOrEqual(1)
}

async function expectAlwaysVisibleScrollbarsToPreserveSettingsScroll(page) {
  await goToSettingsSection(page, 'appearance')
  const content = page.locator('.settingsContent')
  await content.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  const toggle = page.locator('label.switch-label').filter({ hasText: 'Always Show Scrollbars' })
  await toggle.scrollIntoViewIfNeeded()
  const scrollTop = await content.evaluate(element => element.scrollTop)

  await toggle.click()
  await expect(page.getByRole('checkbox', { name: 'Always Show Scrollbars' })).toBeChecked()
  await expect.poll(async () => Math.abs(
    await content.evaluate(element => element.scrollTop) - scrollTop
  )).toBeLessThanOrEqual(1)
}

async function expectMinimizeToPreserveSettingsScroll(page) {
  await goToSettingsSection(page, 'appearance')
  const content = page.locator('.settingsContent')
  await content.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  const scrollTop = await content.evaluate(element => element.scrollTop)

  const settingsWindow = page.getByRole('dialog', { name: 'Settings', exact: true })
  await settingsWindow.getByRole('button', { name: /Minimi[sz]e/ }).click()
  await expect(settingsWindow).toBeHidden()
  await page.getByRole('button', { name: 'Restore: Settings' }).click()
  await expect(settingsWindow).toBeVisible()

  await expect.poll(async () => Math.abs(
    await content.evaluate(element => element.scrollTop) - scrollTop
  )).toBeLessThanOrEqual(1)
}

async function pressSettingsShortcut(app) {
  await app.electronApp.evaluate(({ BrowserWindow, Menu }) => {
    const browserWindow = BrowserWindow.getAllWindows()[0]
    const fileMenu = Menu.getApplicationMenu()?.items.find(item => item.label === 'File')
    const preferencesItem = fileMenu?.submenu?.items.find(item => item.label === 'Preferences')
    if (!browserWindow || !preferencesItem) {
      throw new Error('Preferences application-menu item was not found')
    }
    preferencesItem.click(undefined, browserWindow, undefined)
  })
}

async function expectExternalSoftwarePathAlignment(tool, sourceName, pathPlaceholder) {
  const source = tool.locator('.select').filter({ hasText: sourceName })
  const [sourceBox, helpBox, pathBox] = await Promise.all([
    source.locator('.select-text').boundingBox(),
    source.locator('.selectIndicators button').boundingBox(),
    tool.getByPlaceholder(pathPlaceholder).boundingBox()
  ])

  expect(sourceBox).not.toBeNull()
  expect(helpBox).not.toBeNull()
  expect(pathBox).not.toBeNull()
  expect(pathBox.x).toBeCloseTo(sourceBox.x, 0)
  expect(pathBox.x + pathBox.width).toBeCloseTo(helpBox.x + helpBox.width, 0)
}

async function expectSubscriptionRefreshIntervalSelectHighlight(page) {
  await goTo(page, 'settings')
  const search = page.getByRole('searchbox', { name: 'Search settings' })

  await search.fill('Auto Refresh Interval')
  await expect(page.locator('.settingsSearchResultMatch')).toHaveText([
    'Live Auto Refresh Interval',
    'Posts Auto Refresh Interval',
    'Videos Auto Refresh Interval',
    'Shorts Auto Refresh Interval'
  ])
  await page.getByRole('button', { name: 'Videos Auto Refresh Interval', exact: true }).click()

  const selectHighlight = page.locator('.select.settingsSearchTarget')
  const highlightFrame = selectHighlight.locator('.selectSearchHighlightFrame')
  const selectLabel = selectHighlight.locator('.select-label')
  const selectTooltip = selectHighlight.locator('.selectTooltip')
  await expect(selectHighlight).toContainText('Videos Auto Refresh Interval')
  await expect(highlightFrame).toBeVisible()
  await expect(selectLabel).toBeVisible()
  await expect(selectTooltip).toBeVisible()
  await expect(highlightFrame).toHaveCSS('animation-name', /settings-search-highlight/)
  const highlightBounds = await highlightFrame.boundingBox()
  const labelBounds = await selectLabel.boundingBox()
  const tooltipBounds = await selectTooltip.boundingBox()
  expect(highlightBounds).not.toBeNull()
  expect(labelBounds).not.toBeNull()
  expect(tooltipBounds).not.toBeNull()
  expect(highlightBounds.y).toBeLessThanOrEqual(labelBounds.y)
  expect(highlightBounds.x + highlightBounds.width)
    .toBeGreaterThanOrEqual(tooltipBounds.x + tooltipBounds.width)
}

test.describe('skip silence settings search', () => {
  test.use({ seed: { settings: { currentLocale: 'en-US' } } })

  test('opens and highlights the visibility toggle', async ({ page }) => {
    await goTo(page, 'settings')
    const search = page.getByRole('searchbox', { name: 'Search settings' })

    await search.fill('Skip Silence')
    await page.getByRole('button', { name: 'Show Skip Silence Toggle', exact: true }).click()

    await expect(page.locator('.switch-ctn.settingsSearchTarget'))
      .toContainText('Show Skip Silence Toggle')
    await expect(page.locator('.section.settingsSearchTarget')).toHaveCount(0)
  })

  test('opens the default toggle and reflects its dependency', async ({ page }) => {
    await goTo(page, 'settings')
    const search = page.getByRole('searchbox', { name: 'Search settings' })

    await search.fill('Enable Skip Silence by Default')
    await page.getByRole('button', { name: 'Enable Skip Silence by Default', exact: true }).click()

    const defaultToggle = page.getByRole('checkbox', {
      name: /^Enable Skip Silence by Default/
    })
    await expect(defaultToggle).toBeDisabled()

    await page.locator('label.switch-label')
      .filter({ hasText: 'Show Skip Silence Toggle' })
      .click()
    await expect(defaultToggle).toBeEnabled()
  })
})

test.describe('AI translation completions', () => {
  const englishLabel = 'Fill missing translations with AI-generated ones'
  const generatedLabel = 'ترجمة اختبار بالذكاء الاصطناعي'

  test.use({
    seed: { settings: { currentLocale: 'ar', useAITranslationCompletions: false } },
    localeOverrides: {
      ar: {},
      'ai/ar': {
        Settings: {
          'General Settings': {
            'Use AI Translation Completions': generatedLabel
          }
        }
      }
    }
  })

  test('fills missing text immediately and restores the human fallback when disabled', async ({ page }) => {
    const general = await goToSettingsSection(page, 'general')

    const toggle = general.getByRole('checkbox', { name: englishLabel })
    await expect(toggle).not.toBeChecked()
    await general.locator('label.switch-label').filter({ hasText: englishLabel }).click()

    const translatedToggle = general.getByRole('checkbox', { name: generatedLabel })
    await expect(translatedToggle).toBeChecked()
    await general.locator('label.switch-label').filter({ hasText: generatedLabel }).click()

    const humanFallbackToggle = general.getByRole('checkbox', { name: englishLabel })
    await expect(humanFallbackToggle).not.toBeChecked()

    const localeSelect = general.getByRole('combobox', {
      name: /Language preference|Locale Preference/
    })
    await localeSelect.click()
    await page.getByRole('option', { name: 'English (US) (100%)', exact: true }).click()
    await expect(humanFallbackToggle).toBeDisabled()
  })
})

test.describe('date and time format preferences', () => {
  test.use({ seed: { settings: { currentLocale: 'en-US' } } })

  test('defaults to the app language and offers explicit date and clock formats', async ({ page }) => {
    const general = await goToSettingsSection(page, 'general')
    const dateFormat = general.getByRole('combobox', { name: 'Date Format' })

    await expect(dateFormat).toContainText(/^Language default \(/)
    await dateFormat.click()
    await expect(page.getByRole('option', { name: 'DD.MM.YYYY', exact: true })).toBeVisible()
    await page.getByRole('option', { name: 'DD.MM.YYYY', exact: true }).click()
    await expect(dateFormat).toHaveText('DD.MM.YYYY')

    const timeFormat = general.getByRole('combobox', { name: 'Time Format' })
    await expect(timeFormat).toContainText(/^Language default \(/)
    await timeFormat.click()
    await page.getByRole('option', { name: /^24h \(/ }).click()
    await expect(timeFormat).toContainText(/^24h \(/)
  })
})

test.describe('settings search highlights', () => {
  test.use({ seed: { settings: { currentLocale: 'en-US' } } })

  test('does not draw a separate focus frame inside the search field', async ({ page }) => {
    await goTo(page, 'settings')
    const search = page.getByRole('searchbox', { name: 'Search settings' })

    await expect(search).toBeFocused()
    await expect(search).toHaveCSS('outline-style', 'none')
    await expect(search).toHaveCSS('box-shadow', 'none')
  })

  test('finds and highlights specific subscription refresh interval selects', async ({ page }) => {
    await expectSubscriptionRefreshIntervalSelectHighlight(page)
  })

  test.describe('at 95% UI scale', () => {
    test.use({ seed: { settings: { currentLocale: 'en-US', uiScale: 95 } } })

    test('keeps the select highlight around its label and help icon', async ({ page }) => {
      await expectSubscriptionRefreshIntervalSelectHighlight(page)
    })
  })

  test('highlights a category opened through its description', async ({ page }) => {
    await goTo(page, 'settings')
    const search = page.getByRole('searchbox', { name: 'Search settings' })

    await search.fill('Feed refresh and display options')
    await page.getByRole('button', { name: 'Feed refresh and display options', exact: true }).click()

    const sectionHighlight = page.locator('.section.settingsSearchTarget')
    await expect(sectionHighlight).toHaveAttribute('data-section', 'subscriptions')
    await expect(sectionHighlight).toHaveCSS('animation-name', /settings-search-highlight/)
  })

  test('highlights a whole settings subsection opened through its heading', async ({ page }) => {
    await goTo(page, 'settings')
    const search = page.getByRole('searchbox', { name: 'Search settings' })

    await search.fill('Context Menu Search')
    await page.getByRole('button', { name: 'Context Menu Search', exact: true }).click()

    const contextMenuSearchSection = page.locator('.settingsSection').filter({
      has: page.getByRole('heading', { name: 'Context Menu Search', exact: true })
    })
    await expect(contextMenuSearchSection).toHaveClass(/settingsSearchTarget/)
    await expect(contextMenuSearchSection)
      .toHaveCSS('animation-name', /settings-search-highlight/)
  })

  for (const { searchTerm, sectionType, settingLabel } of [{
    searchTerm: 'Subscription',
    sectionType: 'subscriptions',
    settingLabel: 'Fetch Feed on Startup'
  }, {
    searchTerm: 'Caption Appearance',
    sectionType: 'playback',
    settingLabel: 'Preferred Caption Language'
  }]) {
    test(`highlights the subsection represented by the hidden ${searchTerm} title`, async ({ page }) => {
      await goTo(page, 'settings')
      const search = page.getByRole('searchbox', { name: 'Search settings' })

      await search.fill(searchTerm)
      await page.getByRole('button', { name: searchTerm, exact: true }).click()

      const subsectionHighlight = page.locator(
        `.section[data-section="${sectionType}"] .settingsSection.settingsSearchTarget`
      )
      await expect(subsectionHighlight).toContainText(settingLabel)
      await expect(subsectionHighlight).toHaveCSS('animation-name', /settings-search-highlight/)
    })
  }

  test('does not search input placeholders or feedback messages', async ({ page }) => {
    await goTo(page, 'settings')
    const search = page.getByRole('searchbox', { name: 'Search settings' })

    for (const searchTerm of [
      'Engine name',
      'Search URL',
      'Search history and cache have been cleared',
      'Generated SponsorBlock user ID copied to clipboard'
    ]) {
      await search.fill(searchTerm)
      await expect(page.locator('.settingsNoResults')).toBeVisible()
      await expect(page.locator('.settingsSearchResultMatch')).toHaveCount(0)
    }
  })

  test('only searches controls while their settings are visible', async ({ page }) => {
    await goTo(page, 'settings')
    const search = page.getByRole('searchbox', { name: 'Search settings' })

    for (const searchTerm of [
      'Screenshot Mode',
      'Edge Color',
      'Server URL',
      'Custom External Player Executable',
      'SponsorBlock API Url (Default is https://sponsor.ajay.app)',
      'Return YouTube Dislike API URL (Default is https://ryd-proxy.kavin.rocks)',
      'Proxy Host',
      'Edit custom theme',
      'Remove Password',
      'Generated SponsorBlock User ID',
      'Reveal Generated User ID'
    ]) {
      await search.fill(searchTerm)
      await expect(page.locator('.settingsNoResults')).toBeVisible()
      await expect(page.locator('.settingsSearchResultMatch')).toHaveCount(0, { timeout: 1_000 })
    }

    await search.fill('')
    const playback = await goToSettingsSection(page, 'playback')
    await playback.locator('label.switch-label').filter({ hasText: 'Enable Screenshot' }).click()
    await playback.getByRole('combobox', { name: 'Edge Style' }).click()
    await page.getByRole('option', { name: 'Outline', exact: true }).click()

    for (const searchTerm of ['Screenshot Mode', 'Edge Color']) {
      await search.fill(searchTerm)
      await expect(page.getByRole('button', { name: searchTerm, exact: true })).toBeVisible()
    }
  })
})

test.describe('settings', () => {
  test('uses distinct category names and descriptions', async ({ page }) => {
    await goTo(page, 'settings')

    await expect(page.getByRole('button', { name: 'Sort Settings Sections (A-Z)' }))
      .toHaveCount(0)
    expect(await page.locator('.settingsMenu [data-section]').evaluateAll(elements => (
      elements.map(element => element.dataset.section)
    ))).toEqual([
      'general',
      'appearance',
      'playback',
      'add-ons',
      'subscriptions',
      'download',
      'focus',
      'privacy',
      'data',
      'sync',
      'advanced'
    ])

    const subscriptions = page.locator('.settingsMenu [data-section="subscriptions"]')
    await expect(subscriptions.locator('.titleText')).toHaveText('Subscriptions')
    await expect(subscriptions.locator('.titleDescription'))
      .toHaveText('Feed refresh and display options')

    const playback = page.locator('.settingsMenu [data-section="playback"]')
    await expect(playback.locator('.titleDescription'))
      .toHaveText('Player, captions, and channel preferences')

    const downloads = page.locator('.settingsMenu [data-section="download"]')
    await expect(downloads.locator('.titleText')).toHaveText('Downloads')
    await expect(downloads.locator('.titleDescription'))
      .toHaveText('Folders, templates, and automatic rules')

    const privacy = page.locator('.settingsMenu [data-section="privacy"]')
    await expect(privacy.locator('.titleDescription'))
      .toHaveText('Viewing privacy and access controls')

    const data = page.locator('.settingsMenu [data-section="data"]')
    await expect(data.locator('.titleText')).toHaveText('Data & Storage')
    await expect(data.locator('.titleDescription'))
      .toHaveText('Import, export, disk usage, and cleanup')
    await expect(data.locator('.titleIcon')).toHaveAttribute('data-icon', 'box-archive')
  })

  test('keeps the IP block recovery script last in expanded Proxy settings', async ({ page }) => {
    const advanced = await goToSettingsSection(page, 'advanced')
    const proxy = advanced.locator('.settingsSection').filter({
      has: page.getByRole('heading', { name: 'Proxy', exact: true })
    })

    await proxy.locator('label.switch-label').filter({ hasText: 'Enable Tor / Proxy' }).click()
    const [testProxyBox, recoveryScriptBox] = await Promise.all([
      proxy.getByRole('button', { name: 'Test Proxy', exact: true }).boundingBox(),
      proxy.getByPlaceholder('IP Block Recovery Script Path').boundingBox()
    ])

    expect(testProxyBox).not.toBeNull()
    expect(recoveryScriptBox).not.toBeNull()
    expect(recoveryScriptBox.y).toBeGreaterThan(testProxyBox.y)
    expect(recoveryScriptBox.y - (testProxyBox.y + testProxyBox.height))
      .toBeGreaterThanOrEqual(16)
  })

  test('keeps Replace HTTP Cache in Experimental settings', async ({ page }) => {
    await goToSettingsSection(page, 'data')
    const search = page.getByRole('searchbox', { name: 'Search settings' })
    await search.fill('Replace HTTP Cache')
    await page.getByRole('button', { name: 'Replace HTTP cache', exact: true }).click()
    const advanced = page.locator('.settingsContent > [data-section="advanced"]')

    await expect(advanced).toBeVisible()
    await expect(advanced.getByRole('heading', { name: 'Experimental', exact: true })).toBeVisible()
    await expect(advanced.getByRole('checkbox', { name: 'Replace HTTP Cache' })).toBeVisible()
  })

  test('keeps each external tool grouped when its source changes', async ({ app, page }) => {
    await app.electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('yt-dlp-get-info')
      ipcMain.handle('yt-dlp-get-info', (_event, options) => ({
        ytDlp: {
          source: options.ytDlpSource,
          available: true,
          version: '2026.08.19',
          supportedBrowsers: []
        },
        ffmpeg: { source: options.ffmpegSource, available: true, version: '8.0' },
        ffprobe: { source: options.ffmpegSource, available: true, version: '8.0' }
      }))
    })

    const advanced = await goToSettingsSection(page, 'advanced')
    const externalSoftware = advanced.locator('.settingsSection').filter({
      has: page.getByRole('heading', { name: 'External Software', exact: true })
    })
    const tools = externalSoftware.locator('.externalSoftwareTool')
    const ytDlpTool = tools.nth(0)
    const ffmpegTool = tools.nth(1)

    await expect(tools.locator('.externalSoftwareToolTitle')).toHaveText([
      'yt-dlp',
      'FFmpeg / FFprobe'
    ])
    await expect(ytDlpTool.getByRole('combobox', { name: 'yt-dlp Source' })).toBeVisible()
    await expect(ytDlpTool.getByPlaceholder('yt-dlp Executable Path')).toBeVisible()
    await expect(ffmpegTool.getByRole('combobox', { name: 'FFmpeg Source' })).toBeVisible()
    await expect(ffmpegTool.getByPlaceholder('FFmpeg Executable Path')).toBeVisible()
    await expect(ffmpegTool.locator('.externalSoftwareToolStatus')).toHaveText(
      'Detected FFmpeg/FFprobe version: 8.0'
    )

    const ytDlpSource = ytDlpTool.locator('.select').filter({ hasText: 'yt-dlp Source' })
    const ffmpegSource = ffmpegTool.locator('.select').filter({ hasText: 'FFmpeg Source' })
    await expect(ytDlpSource.locator('.select-icon')).toHaveCount(0)
    await expect(ffmpegSource.locator('.select-icon')).toHaveCount(0)
    await expectExternalSoftwarePathAlignment(
      ytDlpTool,
      'yt-dlp Source',
      'yt-dlp Executable Path'
    )
    await expectExternalSoftwarePathAlignment(
      ffmpegTool,
      'FFmpeg Source',
      'FFmpeg Executable Path'
    )
    const positionWithinTool = source => source.evaluate(element => {
      const sourceBounds = element.getBoundingClientRect()
      const toolBounds = element.closest('.externalSoftwareTool').getBoundingClientRect()
      return {
        x: sourceBounds.x - toolBounds.x,
        y: sourceBounds.y - toolBounds.y
      }
    })
    const positionsBefore = await Promise.all([
      positionWithinTool(ytDlpSource),
      positionWithinTool(ffmpegSource)
    ])

    await ytDlpSource.locator('select').selectOption('managed')
    await expect(ytDlpTool.getByRole('combobox', { name: 'yt-dlp Channel' })).toBeVisible()
    await expect(ytDlpTool.getByPlaceholder('yt-dlp Executable Path')).toHaveCount(0)
    await expect(ytDlpTool.getByRole('button', { name: 'Update yt-dlp' })).toBeVisible()
    await expect(ffmpegTool.getByPlaceholder('FFmpeg Executable Path')).toBeVisible()

    const positionsAfter = await Promise.all([
      positionWithinTool(ytDlpSource),
      positionWithinTool(ffmpegSource)
    ])
    for (const index of [0, 1]) {
      expect(positionsAfter[index].x).toBeCloseTo(positionsBefore[index].x, 0)
      expect(positionsAfter[index].y).toBeCloseTo(positionsBefore[index].y, 0)
    }

    await ffmpegSource.locator('select').selectOption('managed')
    await expect(ffmpegTool.getByPlaceholder('FFmpeg Executable Path')).toHaveCount(0)
    await expect(ffmpegTool.getByRole('button', { name: 'Update FFmpeg and FFprobe' })).toBeVisible()
    await expect(externalSoftware.getByRole('combobox', { name: 'Managed Tool Updates' })).toBeVisible()
  })

  test('shows separate FFmpeg and FFprobe statuses when their versions differ', async ({ app, page }) => {
    await app.electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('yt-dlp-get-info')
      ipcMain.handle('yt-dlp-get-info', (_event, options) => ({
        ytDlp: {
          source: options.ytDlpSource,
          available: true,
          version: '2026.08.19',
          supportedBrowsers: []
        },
        ffmpeg: { source: options.ffmpegSource, available: true, version: '8.0' },
        ffprobe: { source: options.ffmpegSource, available: true, version: '8.1' }
      }))
    })

    const advanced = await goToSettingsSection(page, 'advanced')
    const ffmpegStatus = advanced.locator('.externalSoftwareTool').nth(1).locator('.externalSoftwareToolStatus')

    await expect(ffmpegStatus.locator('p')).toHaveText([
      'Detected FFmpeg version: 8.0',
      'Detected FFprobe version: 8.1'
    ])
  })

  test.describe('external software at 95% UI scale', () => {
    test.use({
      seed: {
        settings: {
          uiScale: 95,
          ytDlpSource: 'system',
          ytDlpFfmpegSource: 'system'
        }
      }
    })

    test('aligns path inputs with source controls when the cards stack', async ({ page }) => {
      await page.setViewportSize({ width: 1000, height: 800 })
      const advanced = await goToSettingsSection(page, 'advanced')
      const tools = advanced.locator('.externalSoftwareTool')
      const [ytDlpBox, ffmpegBox] = await Promise.all([
        tools.nth(0).boundingBox(),
        tools.nth(1).boundingBox()
      ])

      expect(ffmpegBox.y).toBeGreaterThan(ytDlpBox.y + ytDlpBox.height)

      await expectExternalSoftwarePathAlignment(
        tools.nth(0),
        'yt-dlp Source',
        'yt-dlp Executable Path'
      )
      await expectExternalSoftwarePathAlignment(
        tools.nth(1),
        'FFmpeg Source',
        'FFmpeg Executable Path'
      )
    })
  })

  test('shows yt-dlp browsers dynamically and centers the optional profile field', async ({ app, page, attachScreenshot }) => {
    await app.electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('yt-dlp-get-info')
      ipcMain.handle('yt-dlp-get-info', (_event, options) => ({
        ytDlp: {
          source: options.ytDlpSource,
          available: true,
          version: 'test',
          supportedBrowsers: ['firefox', 'vivaldi']
        },
        ffmpeg: { source: options.ffmpegSource, available: true, version: 'test' },
        ffprobe: { source: options.ffmpegSource, available: true, version: 'test' }
      }))
    })

    const advanced = await goToSettingsSection(page, 'advanced')
    const authentication = advanced.locator('.settingsSection').filter({
      has: page.getByRole('heading', { name: 'yt-dlp Playback Cookies', exact: true })
    })
    const cookieSource = authentication.locator('.restrictedPlaybackAuthSource select')
    const alwaysUseCookies = authentication.getByRole('checkbox', { name: /^Always Use Cookies/ })
    const subtitleCookies = authentication.getByRole('checkbox', { name: /^Use cookies for subtitles/ })
    const authenticationHint = authentication.locator('.restrictedPlaybackAuthHint')
    const accountRestrictionWarning = authentication.locator(
      '.restrictedPlaybackAuthHint strong'
    )

    await expect(cookieSource.locator('option')).toHaveText(['None', 'File', 'Browser'])
    await expect(alwaysUseCookies).not.toBeChecked()
    await expect(subtitleCookies).not.toBeChecked()
    await expect(subtitleCookies).toBeEnabled()
    await subtitleCookies.locator('..').locator('label.switch-label').click()
    await expect(subtitleCookies).toBeChecked()
    await expect(authenticationHint).toHaveText(
      'By default, OpenTubeX only passes these cookies to yt-dlp after you choose "Try with configured cookies" on an age-restricted or members-only video. Using yt-dlp with a Google account can lead to temporary or permanent account restrictions.'
    )
    await expect(accountRestrictionWarning).toHaveText(
      'Using yt-dlp with a Google account can lead to temporary or permanent account restrictions.'
    )

    await alwaysUseCookies.locator('..')
      .locator('.selectTooltip button')
      .focus()
    await expect(page.locator('body > [role="tooltip"]:visible')).toHaveText(
      "Use the configured cookies for subtitles and whenever yt-dlp extracts streams. This does not switch the stream extraction method to yt-dlp. With yt-dlp selected, account-only formats may become available, including YouTube Premium's enhanced bitrate when the account has access."
    )
    await cookieSource.selectOption('browser')

    const browser = authentication.locator('.restrictedPlaybackAuthDetail select')
    await expect(browser.locator('option')).toHaveText([
      'Select a browser',
      'Firefox',
      'Vivaldi'
    ])
    await browser.selectOption('firefox')

    const profile = authentication.getByPlaceholder('Profile name or path')
    await profile.fill('/tmp/firefox-profile')
    await alwaysUseCookies.locator('..').locator('label.switch-label').click()
    await expect(alwaysUseCookies).toBeChecked()
    await expect(subtitleCookies).toBeChecked()
    await expect(subtitleCookies).toBeDisabled()
    await alwaysUseCookies.locator('..').locator('label.switch-label').click()
    await expect(subtitleCookies).toBeEnabled()
    await expect(subtitleCookies).toBeChecked()
    await subtitleCookies.locator('..').locator('label.switch-label').click()
    await alwaysUseCookies.locator('..').locator('label.switch-label').click()
    await expect(subtitleCookies).toBeChecked()
    await expect(subtitleCookies).toBeDisabled()

    const [sourceBox, browserBox, profileBox] = await Promise.all([
      authentication.locator('.restrictedPlaybackAuthSource .select').boundingBox(),
      authentication.locator('.restrictedPlaybackAuthDetail .select').boundingBox(),
      authentication.locator('.restrictedPlaybackBrowserProfile .ft-input-component').boundingBox()
    ])
    expect(sourceBox).not.toBeNull()
    expect(browserBox).not.toBeNull()
    expect(profileBox).not.toBeNull()

    const upperCenter = (
      sourceBox.x + sourceBox.width / 2 +
      browserBox.x + browserBox.width / 2
    ) / 2
    expect(Math.abs(profileBox.x + profileBox.width / 2 - upperCenter)).toBeLessThanOrEqual(1)
    expect(profileBox.y).toBeGreaterThan(Math.max(
      sourceBox.y + sourceBox.height,
      browserBox.y + browserBox.height
    ))

    await expect.poll(async () => {
      const settings = latestSettings(
        await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')
      )
      return {
        mode: settings.ytDlpPlaybackAuthMode,
        browser: settings.ytDlpPlaybackCookiesBrowser,
        profile: settings.ytDlpPlaybackCookiesBrowserProfile,
        alwaysUse: settings.ytDlpPlaybackAlwaysUseCookies
      }
    }).toEqual({
      mode: 'browser',
      browser: 'firefox',
      profile: '/tmp/firefox-profile',
      alwaysUse: true
    })
    await attachScreenshot('subtitle cookie settings')
  })

  test('puts theme controls before a separate Layout section', async ({ page }) => {
    const appearance = await goToSettingsSection(page, 'appearance')
    const headings = appearance.getByRole('heading', { level: 3 })

    await expect(headings).toHaveText([
      'Theme',
      'Layout',
      'Navigation / Quick settings',
      'Video lists and thumbnails',
    ])
    const theme = appearance.locator('.settingsSection').filter({
      has: page.getByRole('heading', { name: 'Theme', exact: true })
    })
    const layout = appearance.locator('.settingsSection').filter({
      has: page.getByRole('heading', { name: 'Layout', exact: true })
    })
    await expect(theme.getByRole('combobox', { name: 'Base Theme' })).toBeVisible()
    await expect(theme.getByRole('button', { name: 'Create custom theme' })).toBeVisible()
    await expect(layout.getByRole('slider', { name: /UI Scale/ })).toBeVisible()
    await expect(layout.getByRole('combobox', { name: 'Base Theme' })).toHaveCount(0)
  })

  test('keeps the custom theme editor compact', async ({ page }) => {
    await expectCompactCustomThemeEditor(page)
  })

  test.describe('at 95% UI scale', () => {
    test.use({ seed: { settings: { uiScale: 95 } } })

    test('keeps the custom theme editor compact', async ({ page }) => {
      await expectCompactCustomThemeEditor(page)
    })

    test('aligns the download queue controls with the other fields', async ({ page }) => {
      await expectDownloadQueueSettingsAlignment(page)
    })
  })

  test('caps the width of the download action buttons', async ({ page }) => {
    const downloads = await goToSettingsSection(page, 'download')
    const enableDownloads = downloads.getByRole('checkbox', { name: 'Enable Downloads' })
    if (!await enableDownloads.isChecked()) {
      await downloads.locator('label.switch-label').filter({ hasText: 'Enable Downloads' }).click()
    }

    const buttons = downloads.locator('.downloadActions .btn')
    await expect(buttons).toHaveCount(3)
    const widths = await buttons.evaluateAll(elements => (
      elements.map(element => element.getBoundingClientRect().width)
    ))
    expect(Math.max(...widths)).toBeLessThanOrEqual(300)
  })

  test('aligns the download queue controls with the other fields', async ({ page }) => {
    await expectDownloadQueueSettingsAlignment(page)
  })

  test('hides the redundant Privacy heading and keeps the Distraction Free group headings', async ({ page }) => {
    const privacy = await goToSettingsSection(page, 'privacy')
    const mainPrivacySection = privacy.locator('.settingsSection').first()
    const privacyHeading = mainPrivacySection.locator('.sectionTitle')
    await expect(privacyHeading).toHaveText('Privacy')
    await expect(privacyHeading).not.toBeVisible()

    await expect(privacy.getByRole('checkbox', { name: 'Metadata history' })).toHaveCount(0)

    const focus = await goToSettingsSection(page, 'focus')
    await expect(focus.locator('h4.groupTitle')).toHaveText([
      'General',
      'Visible While Paused in Full Window / Full Screen',
      'Subscriptions page',
      'Channel Page',
      'Watch Page'
    ])
  })

  test('keeps comment translation controls out of Distraction Free settings', async ({ page }) => {
    const focus = await goToSettingsSection(page, 'focus')

    await expect(focus.getByRole('checkbox', {
      name: 'Hide Comment Translation Buttons'
    })).toHaveCount(0)
  })

  test('disables A-B repeat from Distraction Free settings', async ({ page }) => {
    const focus = await goToSettingsSection(page, 'focus')
    const disableAbRepeat = focus.getByRole('checkbox', { name: 'Disable A-B Repeat' })

    await expect(disableAbRepeat).not.toBeChecked()
    await disableAbRepeat.locator('..').locator('label.switch-label').click()
    await expect(disableAbRepeat).toBeChecked()
    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.getters.getDisableAbRepeat
    })).toBe(true)
  })

  test('adds and removes languages that comment translation should ignore', async ({ page }) => {
    const general = await goToSettingsSection(page, 'general')
    const enableTranslations = general.getByRole('checkbox', {
      name: 'Enable comment translations'
    })
    const languageSelect = general.getByRole('combobox', {
      name: 'Never translate comments in'
    })

    await expect(enableTranslations).toBeChecked()
    await languageSelect.click()
    await expect(page.getByRole('option', { name: 'English', exact: true })).toHaveCount(0)
    await page.getByRole('option', { name: 'German', exact: true }).click()

    const ignoredLanguages = general.getByRole('list', {
      name: 'Never translate comments in'
    })
    await expect(ignoredLanguages).toContainText('German')
    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.getters.getCommentTranslationIgnoredLanguages
    })).toEqual(['de'])

    const removeGerman = ignoredLanguages.getByRole('button', {
      name: 'Translate German comments again'
    })
    await enableTranslations.locator('..').locator('label.switch-label').click()
    await expect(enableTranslations).not.toBeChecked()
    await expect(languageSelect).toBeDisabled()
    await expect(removeGerman).toBeDisabled()

    await enableTranslations.locator('..').locator('label.switch-label').click()
    await removeGerman.click()
    await expect(ignoredLanguages).toHaveCount(0)
  })

  test('keeps General help icons close to their selects', async ({ page }) => {
    await goTo(page, 'settings')
    const startup = page.locator('.generalSelectGrid .select').filter({ hasText: 'On Startup' })
    const gaps = await startup.evaluate(element => {
      const select = element.querySelector('.select-text').getBoundingClientRect()
      const tooltip = element.querySelector('.selectTooltip').getBoundingClientRect()
      const root = element.getBoundingClientRect()
      return {
        before: tooltip.left - select.right,
        after: root.right - tooltip.right,
      }
    })

    expect(gaps.before).toBeLessThanOrEqual(16)
    expect(gaps.after).toBeLessThanOrEqual(16)
  })

  test('keeps SponsorBlock category controls inside its flexible layout', async ({ page }) => {
    const addOns = await goToSettingsSection(page, 'add-ons')
    await addOns.locator('label.switch-label').filter({ hasText: 'Enable SponsorBlock' }).click()

    const categories = addOns.locator('.sponsorBlockCategory')
    await expect(categories).toHaveCount(10)
    expect(await categories.first().locator('..').evaluate(element => (
      getComputedStyle(element).display
    ))).toBe('flex')

    const paletteColors = await categories.evaluateAll(elements => elements.slice(0, 2).map(element => (
      getComputedStyle(element.querySelector('.select-icon')).color
    )))
    expect(paletteColors).toEqual(['rgb(76, 175, 80)', 'rgb(255, 235, 59)'])

    const expectControlsInsideCategories = async () => {
      const maximumOverflow = await categories.evaluateAll(elements => Math.max(...elements.flatMap(element => {
        const categoryBounds = element.getBoundingClientRect()
        return Array.from(element.querySelectorAll('.select')).map(select => {
          const selectBounds = select.getBoundingClientRect()
          return Math.max(
            categoryBounds.left - selectBounds.left,
            selectBounds.right - categoryBounds.right
          )
        })
      })))
      expect(maximumOverflow).toBeLessThanOrEqual(1)
    }

    await expectControlsInsideCategories()
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateUiScale', 95)
    })
    await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBeCloseTo(0.95, 2)
    await expectControlsInsideCategories()
  })

  test('vertically centers switch tracks with long labels and setting indicators', async ({ app, page }) => {
    await setWindowSize(app, page, { width: 480, height: 800 })
    const addOns = await goToSettingsSection(page, 'add-ons')
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.dispatch('updateHighlightChangedSettings', true)
    })

    const sponsorBlock = addOns.getByRole('checkbox', { name: 'Enable SponsorBlock', exact: true })
    if (!await sponsorBlock.isChecked()) {
      await addOns.locator('label.switch-label').filter({ hasText: 'Enable SponsorBlock' }).click()
    }

    const submission = addOns.locator('.switch-ctn').filter({
      has: page.getByText('Enable SponsorBlock Submission', { exact: true })
    })
    await expect(submission).toBeVisible()

    const centerOffset = await submission.evaluate(element => {
      const label = element.querySelector('.switch-label')
      const text = element.querySelector('.switch-label-text').getBoundingClientRect()
      const labelBounds = label.getBoundingClientRect()
      const knob = getComputedStyle(label, '::after')
      const transform = new DOMMatrix(knob.transform)
      const knobCenter = labelBounds.top + Number.parseFloat(knob.top) +
        transform.m42 + Number.parseFloat(knob.height) / 2
      return Math.abs(knobCenter - (text.top + text.height / 2))
    })

    expect(centerOffset).toBeLessThanOrEqual(1)
  })

  test('offers a custom SponsorBlock category color initialized from its default', async ({ app, page }) => {
    const addOns = await goToSettingsSection(page, 'add-ons')
    await addOns.locator('label.switch-label').filter({ hasText: 'Enable SponsorBlock' }).click()

    const sponsorCategory = addOns.locator('.sponsorBlockCategory')
      .filter({ has: page.locator('.sponsorTitle', { hasText: /^Sponsor$/ }) })
    const colorSelect = sponsorCategory.locator('.select-text').first()
    await colorSelect.click()

    const colorOptions = page.locator('.selectDropdown .selectOption')
    await expect(colorOptions.first()).toHaveText('Custom color')
    await colorOptions.first().click()

    const picker = sponsorCategory.locator('.ftColorPicker')
    await expect(picker.getByRole('button', { name: 'Custom color' })).toBeVisible()
    await expect(picker.locator('code')).toHaveText('#4caf50')
    await expect(sponsorCategory.locator('.select-icon').first())
      .toHaveCSS('color', 'rgb(76, 175, 80)')

    await picker.getByRole('button', { name: 'Custom color' }).click()
    const pickerDialog = page.getByRole('dialog', { name: 'Custom color' })
    const hexColor = pickerDialog.getByLabel('Hex color')
    await hexColor.fill('#123456')
    await hexColor.press('Enter')
    await pickerDialog.getByRole('button', { name: 'Apply' }).click()

    await expect(picker.locator('code')).toHaveText('#123456')
    await expect(sponsorCategory.locator('.select-icon').first())
      .toHaveCSS('color', 'rgb(18, 52, 86)')
    await expect.poll(async () => {
      const settings = latestSettings(
        await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')
      )
      return settings.sponsorBlockSponsor
    }).toEqual({ color: '#123456', skip: 'autoSkip' })
  })

  test('keeps General selects compact with tooltip indicators inside their width', async ({ page, attachScreenshot }) => {
    await goTo(page, 'settings')

    const grid = page.locator('.generalSelectGrid')
    const measurements = await grid.evaluate(element => {
      const gridBounds = element.getBoundingClientRect()
      const contentBounds = element.closest('.sectionBody').getBoundingClientRect()
      const widths = Array.from(element.querySelectorAll(':scope > .select'))
        .map(select => select.getBoundingClientRect().width)
      return {
        gridWidth: gridBounds.width,
        centerOffset: Math.abs(
          gridBounds.left + gridBounds.width / 2 -
          (contentBounds.left + contentBounds.width / 2)
        ),
        minimumSelectWidth: Math.min(...widths),
        maximumSelectWidth: Math.max(...widths),
      }
    })

    expect(measurements.gridWidth).toBeLessThanOrEqual(700)
    expect(measurements.centerOffset).toBeLessThanOrEqual(1)
    expect(measurements.maximumSelectWidth - measurements.minimumSelectWidth).toBeLessThanOrEqual(1)
    await attachScreenshot('compact General setting selects')
  })

  test('places an incomplete General toggle row at the inline start', async ({ page }) => {
    const general = await goToSettingsSection(page, 'general')
    const minimizeToTray = general.getByRole('checkbox', {
      name: /Minimi[sz]e to system tray/
    }).locator('..')
    await expect(minimizeToTray).toBeVisible()
    await minimizeToTray.evaluate(element => { element.style.display = 'none' })

    const aiTranslations = general.getByRole('checkbox', {
      name: 'Fill missing translations with AI-generated ones'
    }).locator('..')
    const grid = general.locator('.switchColumnGrid').first()

    for (const direction of ['ltr', 'rtl']) {
      await page.evaluate(value => { document.documentElement.dir = value }, direction)
      const inlineOffset = await grid.evaluate((element, aiTranslationElement) => {
        const gridBounds = element.getBoundingClientRect()
        const settingBounds = aiTranslationElement.getBoundingClientRect()
        const physicalOffset = settingBounds.left + settingBounds.width / 2 -
          (gridBounds.left + gridBounds.width / 2)
        return getComputedStyle(element).direction === 'rtl' ? -physicalOffset : physicalOffset
      }, await aiTranslations.elementHandle())

      expect(inlineOffset, direction).toBeLessThan(0)
    }
  })

  test('keeps General selects compact in the one-column layout', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 40,
        y: 40,
        width: 900,
        height: 700
      }))
    })
    await goTo(page, 'settings')

    const measurements = await page.locator('.generalSelectGrid').evaluate(element => {
      const gridBounds = element.getBoundingClientRect()
      const contentBounds = element.closest('.sectionBody').getBoundingClientRect()
      const selectWidths = Array.from(element.querySelectorAll(':scope > .select'))
        .map(select => select.getBoundingClientRect().width)
      return {
        columnCount: getComputedStyle(element).gridTemplateColumns.split(' ').length,
        gridWidth: gridBounds.width,
        maximumSelectWidth: Math.max(...selectWidths),
        centerOffset: Math.abs(
          gridBounds.left + gridBounds.width / 2 -
          (contentBounds.left + contentBounds.width / 2)
        )
      }
    })

    expect(measurements.columnCount).toBe(1)
    expect(measurements.gridWidth).toBeLessThanOrEqual(330)
    expect(measurements.maximumSelectWidth).toBeLessThanOrEqual(330)
    expect(measurements.centerOffset).toBeLessThanOrEqual(1)
  })

  test('centers stacked switch columns in narrow settings sections', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 40,
        y: 40,
        width: 820,
        height: 700
      }))
    })
    await goTo(page, 'settings')

    for (const sectionType of ['general', 'subscriptions', 'focus', 'privacy']) {
      await page.locator(`.settingsMenu [data-section="${sectionType}"]`).click()
      const grids = page.locator(
        `.settingsContent > [data-section="${sectionType}"] .switchColumnGrid`
      )
      await expect(grids.first()).toBeVisible()

      const centerOffsets = await grids.evaluateAll(elements => elements.flatMap(grid => {
        const gridBounds = grid.getBoundingClientRect()
        const gridCenter = gridBounds.left + gridBounds.width / 2
        const columnControls = Array.from(grid.querySelectorAll(':scope > .switchColumn'))
          .flatMap(column => Array.from(column.children))
        const flowControls = Array.from(grid.querySelectorAll(':scope > .switch-ctn'))
        return [...columnControls, ...flowControls]
          .map(child => child.getBoundingClientRect())
          .filter(bounds => bounds.width > 0 && bounds.height > 0)
          .map(bounds => Math.abs(bounds.left + bounds.width / 2 - gridCenter))
      }))

      expect(Math.max(...centerOffsets), sectionType).toBeLessThanOrEqual(1)

      const tooltipGaps = await grids.locator('.switch-ctn.containsTooltip').evaluateAll(elements => (
        elements.map(element => {
          const label = element.querySelector('.switch-label-text').getBoundingClientRect()
          const tooltip = element.querySelector('.tooltip .button').getBoundingClientRect()
          return tooltip.left - label.right
        })
      ))
      expect(Math.max(...tooltipGaps), sectionType).toBeLessThanOrEqual(8)
    }

    await page.locator('.settingsMenu [data-section="playback"]').click()
    const channelSettings = page.locator('.settingsContent .settingsSection').filter({
      has: page.getByRole('heading', { name: 'Channel Settings', exact: true })
    })
    const preferenceOffsets = await channelSettings.locator('.preferenceToggles').evaluate(element => {
      const bounds = element.getBoundingClientRect()
      const center = bounds.left + bounds.width / 2
      return Array.from(element.querySelectorAll('.preferenceToggle > .switch-ctn'))
        .map(toggle => {
          const toggleBounds = toggle.getBoundingClientRect()
          return Math.abs(toggleBounds.left + toggleBounds.width / 2 - center)
        })
    })
    expect(Math.max(...preferenceOffsets)).toBeLessThanOrEqual(1)
  })

  test('aligns Playback toggles and selects in a narrow settings window', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 40,
        y: 40,
        width: 400,
        height: 700
      }))
    })
    const playback = await goToSettingsSection(page, 'playback')
    const playerSettings = playback.locator('.settingsSection').filter({
      has: page.getByRole('heading', { name: 'Player', exact: true })
    })

    async function expectControlsAligned() {
      const firstToggles = playerSettings.locator('.switchColumn').first()
        .locator(':scope > .switch-ctn')
      await expect(firstToggles.first()).toBeVisible()
      const toggleLabelLeftEdges = await firstToggles.evaluateAll(elements => elements.slice(0, 3)
        .map(element => element.querySelector('.switch-label-text').getBoundingClientRect().left))
      expect.soft(Math.max(...toggleLabelLeftEdges) - Math.min(...toggleLabelLeftEdges))
        .toBeLessThanOrEqual(1)

      const tooltipToggle = playerSettings.locator('.switch-ctn')
        .filter({ hasText: 'Show Skip Silence Toggle' })
      const toggleCenterOffset = await tooltipToggle.evaluate(element => {
        const label = element.querySelector('.switch-label').getBoundingClientRect()
        const text = element.querySelector('.switch-label-text').getBoundingClientRect()
        return Math.abs(label.top + label.height / 2 - (text.top + text.height / 2))
      })
      expect.soft(toggleCenterOffset).toBeLessThanOrEqual(1)

      const selectLeftEdges = await playerSettings.locator('.select .select-text')
        .evaluateAll(elements => elements.map(element => element.getBoundingClientRect().left))
      expect.soft(selectLeftEdges).toHaveLength(4)
      expect.soft(Math.max(...selectLeftEdges) - Math.min(...selectLeftEdges))
        .toBeLessThanOrEqual(1)
    }

    await expectControlsAligned()
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateUiScale', 125)
    })
    await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBeCloseTo(1.25, 2)
    await expectControlsAligned()
  })

  test('groups confirmation preferences together', async ({ page }) => {
    await goTo(page, 'settings')

    const labels = [
      'Closing OpenTubeX',
      'Closing a window with multiple tabs',
      'Closing multiple tabs',
      'Loading multiple tabs',
      'Unloading multiple tabs'
    ]
    await expect(page.getByRole('heading', { name: 'Confirm before…', exact: true })).toBeVisible()
    for (const label of labels) {
      await expect(page.getByText(label, { exact: true })).toBeVisible()
    }

    const [first, second, third] = await Promise.all(labels.slice(0, 3).map(label => (
      page.getByText(label, { exact: true }).boundingBox()
    )))
    expect(second.y).toBeCloseTo(first.y, 0)
    expect(first.x).toBeLessThan(second.x)
    expect(third.y).toBeGreaterThan(first.y)
  })

  test('places online activity controls in General and Privacy without a separate section', async ({ page }) => {
    const general = await goToSettingsSection(page, 'general')
    await expect(general.getByText(/^Auto load next page$/i)).toBeVisible()

    const privacyCategory = await goToSettingsSection(page, 'privacy')
    const privacy = privacyCategory.locator('.settingsSection').first()

    await expect(privacyCategory.getByRole('heading', {
      name: 'Online activity',
      exact: true
    })).toHaveCount(0)
    await expect(privacyCategory.getByText(/^Auto load next page$/i)).toHaveCount(0)
    const privacyColumns = privacy.locator('.switchColumn')
    await expect(privacyColumns).toHaveCount(2)
    await expect(privacyColumns.nth(1)).toContainText('Enable search suggestions')
    await expect(privacyColumns.nth(1)).toContainText('Remember Tab Navigation History')

    const select = privacy.locator('.privacyExternalLinkSelect')
    const centerOffset = await select.evaluate(element => {
      const selectBounds = element.getBoundingClientRect()
      const bodyBounds = element.closest('.sectionBody').getBoundingClientRect()
      return Math.abs(
        selectBounds.left + selectBounds.width / 2 -
        (bodyBounds.left + bodyBounds.width / 2)
      )
    })
    expect(centerOffset).toBeLessThanOrEqual(1)
  })

  test('keeps General settings aligned to the bottom of its scroll range', async ({ page }) => {
    await goTo(page, 'settings')
    const content = page.locator('.settingsContent')
    await expect(content).toBeVisible()
    await content.hover()
    await page.mouse.wheel(0, 2000)

    await expect.poll(() => content.evaluate((element) => {
      const lastSection = element.querySelector('.settingsCategory > :last-child')
      return element.getBoundingClientRect().bottom - lastSection.getBoundingClientRect().bottom
    })).toBeLessThanOrEqual(45)
  })

  test('renders without flashing native scrollbars', async ({ page }) => {
    await goTo(page, 'settings')

    await expect(page.locator('.settingsContent > .section')).toHaveCount(1)
    await expect(page.locator('.settingsContent .os-scrollbar-vertical')).toHaveCount(1)
    await expect(page.locator('.settingsContent')).toHaveCSS('scrollbar-width', 'none')
  })

  test('opens over the current page and renders the selected section', async ({ page, attachScreenshot }) => {
    const url = page.url()
    const activeTab = await page.locator(sel.activeTab).textContent()

    await goTo(page, 'settings')

    await expect(page).toHaveURL(url)
    await expect(page.locator(sel.activeTab)).toContainText(activeTab)
    const windowIcon = page.locator('.settingsWindowIcon')
    const breadcrumbLabel = page.locator('.settingsBreadcrumbLabel').first()
    await expect(windowIcon).toBeVisible()
    await expect(windowIcon).toHaveAttribute('data-icon', 'gear')
    await expect(page.locator('.settingsBreadcrumbCategoryIcon')).toBeVisible()
    const [iconBounds, labelBounds] = await Promise.all([
      windowIcon.boundingBox(),
      breadcrumbLabel.boundingBox()
    ])
    // Within a pixel rather than toBeCloseTo's half: both boxes land on
    // fractional pixels on scaled displays, which is not a misalignment.
    const iconCenter = iconBounds.y + iconBounds.height / 2
    const labelCenter = labelBounds.y + labelBounds.height / 2
    expect(Math.abs(iconCenter - labelCenter)).toBeLessThanOrEqual(1)
    await expect(page.getByRole('button', {
      name: 'Highlight settings changed from defaults'
    }).locator('[data-icon="pen"]')).toBeVisible()
    await expect(page.locator('.settingsMenu')).toBeVisible()
    await expect(page.locator('.settingsContent > [data-section="general"]')).toBeVisible()
    await attachScreenshot('settings window over the page')
  })

  test('opens from Preferences without remounting the current feed', async ({ app, page }) => {
    await goTo(page, 'subscriptions')
    const subscriptionsPage = page.locator('.subscriptionsPage')
    await subscriptionsPage.evaluate(element => {
      element.dataset.settingsShortcutMarker = 'preserved'
    })

    await app.electronApp.evaluate(({ BrowserWindow }) => {
      const browserWindow = BrowserWindow.getAllWindows()[0]
      if (!browserWindow) throw new Error('Browser window was not found')
      browserWindow.webContents.send('change-view', {
        route: '/settings',
        tabId: 'preferences-test'
      })
    })

    await expect(page.locator('.settingsWindow')).toBeVisible()
    await expect(subscriptionsPage).toHaveAttribute('data-settings-shortcut-marker', 'preserved')
  })

  test('keeps a direct legacy settings route inside the app', async ({ page }) => {
    const tab = await page.evaluate(() => window.ftElectron.tabs.create({
      route: '/settings',
      makeActive: true
    }))

    await expect(page.locator('.settingsWindow')).toBeVisible()
    await expect.poll(async () => {
      const state = await page.evaluate(() => window.ftElectron.tabs.getState())
      return state.tabs.find(candidate => candidate.id === tab.id)?.route.fullPath
    }).toBe('/')
  })

  test('toggles from the app settings button', async ({ page }) => {
    const profileButton = page.locator('.profileTrigger')
    await profileButton.click()
    const settingsButton = page.locator('.allSettingsShortcut')
    await expect(settingsButton.locator('[data-icon="gear"]')).toBeVisible()
    await expect(page.locator('.sideNav').getByText('Settings', { exact: true })).toHaveCount(0)
    await settingsButton.click()
    await expect(page.locator('.settingsWindow')).toBeVisible()

    await profileButton.click()
    await expect(settingsButton).toBeVisible()
    await settingsButton.click()
    await expect(page.locator('.settingsWindow')).toHaveClass(/settings-window-leave-active/)
    await expect(page.locator('.settingsWindow')).toBeHidden()
  })

  test('keeps the current compact view throughout the close animation at 95% UI scale', async ({ page }) => {
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 40,
        y: 40,
        width: 500,
        height: 450
      }))
      return store.dispatch('updateUiScale', 95)
    })

    const settingsWindow = page.locator('.settingsWindow')
    const settingsMenu = page.locator('.settingsMenu')

    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="playback"]').click()
    await page.getByRole('button', { name: /Manage Saved Channels/ }).click()
    await expect(page.locator('.channelListContainer')).toBeVisible()

    await page.locator('.settingsCloseButton').click()
    await expect(settingsWindow).toHaveClass(/settings-window-leave-active/)
    await expect(settingsMenu).toBeHidden()
    await expect(page.locator('.channelListContainer')).toBeVisible()
    await expect(settingsWindow).toBeHidden()

    await goTo(page, 'settings')
    await page.getByRole('button', { name: 'Show Keyboard Shortcuts' }).click()
    await expect(settingsMenu).toBeHidden()
    await expect(page.locator('.shortcutColumns')).toBeVisible()

    await page.locator('.settingsCloseButton').click()
    await expect(settingsWindow).toHaveClass(/settings-window-leave-active/)
    await expect(settingsMenu).toBeHidden()
    await expect(page.locator('.shortcutColumns')).toBeVisible()
    await expect(settingsWindow).toBeHidden()

    await goTo(page, 'settings')
    await expect(page.locator('.shortcutColumns')).toHaveCount(0)
    await expect(page.locator('.settingsContent > [data-section="playback"]')).toBeVisible()
  })

  test('closes an open shortcut prompt when Android reports keyboard disconnection', async ({ page }) => {
    // Electron removes the Android-only handler from its bundle. Exercise the
    // source handler against the running store and Settings UI instead.
    const appSource = await readFile(new URL('../../../src/renderer/App.vue', import.meta.url), 'utf8')
    const handlerSource = appSource.match(/function handleHardwareKeyboardChange\(event\) \{[\s\S]*?\n\}/)?.[0]
    expect(handlerSource).toBeTruthy()
    const reportKeyboardState = attached => page.evaluate(`(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const hardwareKeyboardAttached = { value: ${!attached} }
      ${handlerSource}
      handleHardwareKeyboardChange({ attached: ${attached} })
      return hardwareKeyboardAttached.value
    })()`)

    await goTo(page, 'settings')
    await page.getByRole('button', { name: 'Show Keyboard Shortcuts' }).click()
    await expect(page.locator('.shortcutColumns')).toBeVisible()

    expect(await reportKeyboardState(true)).toBe(true)
    await expect(page.locator('.shortcutColumns')).toBeVisible()

    expect(await reportKeyboardState(false)).toBe(false)
    await expect(page.locator('.shortcutColumns')).toHaveCount(0)
    await expect(page.locator('.settingsWindow')).toBeVisible()

    expect(await reportKeyboardState(true)).toBe(true)
    await expect(page.locator('.shortcutColumns')).toHaveCount(0)
  })

  test('reopens Keyboard Shortcuts when its shortcut is pressed during closing', async ({ page }) => {
    await goTo(page, 'settings')
    await page.getByRole('button', { name: 'Show Keyboard Shortcuts' }).click()
    await expect(page.locator('.shortcutColumns')).toBeVisible()

    const settingsWindow = page.locator('.settingsWindow')
    await page.locator('.settingsCloseButton').click()
    await expect(settingsWindow).toHaveClass(/settings-window-leave-active/)
    await page.keyboard.press('Shift+?')

    await expect(settingsWindow).toBeVisible()
    await expect(page.locator('.shortcutColumns')).toBeVisible()
  })

  test('toggles Settings and Keyboard Shortcuts with their app shortcuts', async ({ app, page }) => {
    const settingsWindow = page.locator('.settingsWindow')

    await pressSettingsShortcut(app)
    await expect(settingsWindow).toBeVisible()
    await expect(page.locator('.shortcutColumns')).toHaveCount(0)

    await pressSettingsShortcut(app)
    await expect(settingsWindow).toHaveClass(/settings-window-leave-active/)
    await expect(settingsWindow).toBeHidden()

    await page.keyboard.press('Shift+?')
    await expect(settingsWindow).toBeVisible()
    await expect(page.locator('.shortcutColumns')).toBeVisible()

    await page.keyboard.press('Shift+?')
    await expect(settingsWindow).toHaveClass(/settings-window-leave-active/)
    await expect(page.locator('.shortcutColumns')).toBeVisible()
    await expect(settingsWindow).toBeHidden()
  })

  test('preserves category scroll when Settings is toggled but resets it when switching categories', async ({ app, page }) => {
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.dispatch('updateUiScale', 95)
    })
    await pressSettingsShortcut(app)

    await page.locator('.settingsMenu [data-section="appearance"]').click()
    const content = page.locator('.settingsContent')
    await content.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    const scrollTop = await content.evaluate(element => element.scrollTop)

    await pressSettingsShortcut(app)
    await expect(page.locator('.settingsWindow')).toBeHidden()
    await pressSettingsShortcut(app)
    await expect(page.locator('.settingsWindow')).toBeVisible()
    await expect.poll(async () => Math.abs(
      await content.evaluate(element => element.scrollTop) - scrollTop
    )).toBeLessThanOrEqual(1)

    await page.locator('.settingsMenu [data-section="playback"]').click()
    await expect.poll(() => content.evaluate(element => element.scrollTop)).toBe(0)
  })

  test('minimizes utility windows into the header and restores their view', async ({ page }) => {
    for (const view of [null, 'about', 'downloads']) {
      await page.evaluate((windowView) => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        return store.dispatch('showSettingsWindow', windowView)
      }, view)

      const windowName = view === 'about' ? 'About' : view === 'downloads' ? 'Downloads' : 'Settings'
      const settingsWindow = page.getByRole('dialog', { name: windowName, exact: true })
      await expect(settingsWindow).toBeVisible()
      await settingsWindow.getByRole('button', { name: /Minimi[sz]e/ }).click()

      await expect(settingsWindow).toBeHidden()
      const minimizedButton = page.locator('.minimizedUtilityButton')
      await expect(minimizedButton).toBeVisible()
      await expect(minimizedButton).toHaveAccessibleName(`Restore: ${windowName}`)
      if (view === 'downloads') {
        await expect(page.locator('.downloadsButton')).toHaveCount(0)
      }

      await minimizedButton.click()
      await expect(page.getByRole('dialog', { name: windowName, exact: true })).toBeVisible()
      await page.locator('.settingsCloseButton').click()
      await expect(page.locator('.minimizedUtilityButton')).toHaveCount(0)
    }
  })

  test('preserves its scroll position after being minimized and restored', async ({ page }) => {
    await expectMinimizeToPreserveSettingsScroll(page)
  })

  test('keeps the current settings subpage when minimized and restored', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="playback"]').click()
    await page.getByRole('button', { name: /Manage Saved Channels/ }).click()

    const settingsWindow = page.getByRole('dialog', { name: 'Settings', exact: true })
    const breadcrumb = page.locator('.settingsBreadcrumb')
    await expect(breadcrumb).toContainText('Saved Channel Settings')

    await settingsWindow.getByRole('button', { name: /Minimi[sz]e/ }).click()
    await expect(settingsWindow).toBeHidden()
    await page.getByRole('button', { name: 'Restore: Settings' }).click()

    await expect(settingsWindow).toBeVisible()
    await expect(page.locator('.channelListContainer')).toBeVisible()
    await expect(breadcrumb).toContainText('Saved Channel Settings')
  })

  test.describe('minimized at 95% UI scale', () => {
    test.use({ seed: { settings: { uiScale: 95 } } })

    test('preserves its scroll position when restored', async ({ page }) => {
      await expectMinimizeToPreserveSettingsScroll(page)
    })
  })

  test('restores the last selected category when reopened', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="privacy"]').click()
    await expect(page.locator('.settingsContent > [data-section="privacy"]')).toBeVisible()

    await page.locator('.settingsCloseButton').click()
    await goTo(page, 'settings')

    await expect(page.locator('.settingsContent > [data-section="privacy"]')).toBeVisible()
    await expect(page.locator('.settingsMenu [data-section="privacy"]')).toHaveClass(/active/)
  })

  test('focuses its search and closes with Escape', async ({ page }) => {
    await goTo(page, 'settings')
    const search = page.getByRole('searchbox', { name: 'Search settings' })
    await expect(search).toBeFocused()
    await search.evaluate(element => element.blur())
    await page.locator('.settingsSearch svg').click()
    await expect(search).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(page.locator('.settingsWindow')).toBeHidden()
  })

  test('searches setting labels and opens their category', async ({ page }) => {
    await goTo(page, 'settings')
    const search = page.getByRole('searchbox', { name: 'Search settings' })
    await expect(search).toBeVisible()

    await search.fill('update')
    await expect(page.locator('.settingsMenu .title.active')).toHaveCount(0)
    await expect(page.locator('.settingsContent > .section')).toHaveCount(0)
    await expect(page.locator('.settingsSearchResult')).toHaveCount(1)
    expect(await page.locator('.settingsMenu .title').evaluateAll(elements => (
      elements.every(element => element.scrollHeight <= element.clientHeight + 1)
    ))).toBe(true)

    await search.fill('a')
    const searchContent = page.locator('.settingsContent')
    const searchScrollbar = searchContent.locator(':scope > .os-scrollbar-vertical')
    await searchContent.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => searchContent.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await expect(searchScrollbar).not.toHaveClass(/os-scrollbar-unusable/)

    await search.fill('FFmpeg Source')
    await expect.poll(() => searchContent.evaluate(element => element.scrollTop)).toBe(0)
    await expect.poll(() => searchContent.evaluate(
      element => element.scrollHeight <= element.clientHeight + 1
    )).toBe(true)
    await expect(searchScrollbar).toHaveClass(/os-scrollbar-unusable/)
    await expect(page.locator('.settingsMenu .title')).toHaveCount(1)
    await expect(page.locator('.settingsMenu [data-section="advanced"]')).toBeVisible()
    await expect(page.locator('.settingsSearchResult')).toContainText('FFmpeg Source')
    await page.getByRole('button', { name: 'FFmpeg Source', exact: true }).click()
    await expect(page.locator('.settingsContent > [data-section="advanced"]')).toBeVisible()
    await expect(page.locator('.settingsBreadcrumbCategoryIcon[data-icon="flask"]')).toBeVisible()
    await expect(page.locator('.select.settingsSearchTarget')).toContainText('FFmpeg Source')
    await expect(page.locator('.section.settingsSearchTarget')).toHaveCount(0)

    await search.fill('Check for Updates')
    await page.getByRole('button', { name: /Check for updates/i, exact: true }).click()
    const switchHighlight = page.locator('.switch-ctn.settingsSearchTarget')
    await expect(switchHighlight).toContainText(/Check for updates/i)
    const { borderRadius, uiRoundness } = await switchHighlight.evaluate(element => {
      const style = getComputedStyle(element)
      return {
        borderRadius: Number.parseFloat(style.borderRadius),
        uiRoundness: Number.parseFloat(style.getPropertyValue('--ui-roundness'))
      }
    })
    expect(borderRadius).toBeCloseTo(4 * uiRoundness)
    await expect(page.locator('.section.settingsSearchTarget')).toHaveCount(0)

    await search.fill('UI Scale')
    await page.getByRole('button', { name: 'UI Scale', exact: true }).click()
    await expect(page.locator('.pure-material-slider.settingsSearchTarget')).toContainText('UI Scale')
    await expect(page.locator('.section.settingsSearchTarget')).toHaveCount(0)

    await search.fill('Region for Trending')
    await page.getByRole('button', { name: /Region for trending/i }).click()
    await expect(page.locator('.settingsSearchTarget')).toContainText(/Region for trending/i)
    await expect.poll(() => page.locator('.settingsContent').evaluate(element => element.scrollTop))
      .toBeGreaterThan(0)

    await search.fill('External Player')
    await page.locator('.settingsSearchResultMatch')
      .filter({ hasText: /^External Player$/ })
      .click()
    await expect(page.locator('.settingsSearchTarget.select')).toBeVisible()

    await page.getByRole('combobox', { name: 'External Player', exact: true }).click()
    await page.getByRole('option', { name: 'mpv', exact: true }).click()
    await search.fill('Custom External Player Executable')
    await page.getByRole('button', { name: 'Custom External Player Executable', exact: true }).click()
    const executableHighlight = page.locator('input.settingsSearchTarget')
    await expect(executableHighlight).toHaveAttribute('placeholder', 'Custom External Player Executable')
    expect(await executableHighlight.evaluate(element => getComputedStyle(element).animationName))
      .toContain('settings-search-highlight')
    expect((await executableHighlight.boundingBox()).height).toBeLessThanOrEqual(45)
    await expect(page.locator('.ft-input-component.settingsSearchTarget')).toHaveCount(0)

    await search.fill('Proxy Videos Through Invidious')
    await expect(page.locator('.settingsMenu [data-section="advanced"]')).toBeVisible()
    await page.getByRole('button', { name: 'Proxy Videos Through Invidious', exact: true }).click()
    await expect(page.locator('.settingsContent > [data-section="advanced"]')).toBeVisible()
    const providerSection = page.locator('.settingsSection').filter({
      has: page.getByRole('heading', { name: 'Video and metadata providers', exact: true })
    })
    await expect(providerSection.locator('.switch-ctn.settingsSearchTarget'))
      .toContainText('Proxy Videos Through Invidious')

    await search.fill('test')
    await expect(page.getByRole('button', { name: 'Test Proxy', exact: true })).toHaveCount(0)
    await expect(page.locator('.settingsSearchResultMatch')).toHaveCount(0)

    const proxyInfo = 'Clicking on Test Proxy will send a request to ' +
      'https://ipwho.is/?output=json&fields=ip,country,city,region&lang=en'
    await search.fill(proxyInfo)
    await expect(page.locator('.settingsSearchResultMatch')).toHaveCount(0)

    await search.fill('Manage Saved Channels')
    await expect(page.locator('.settingsSearchResultMatch')).toHaveCount(0)

    await search.fill('How do I import my subscriptions?')
    await expect(page.locator('.settingsSearchResultMatch')).toHaveCount(0)

    await search.fill('successfully imported')
    await expect(page.locator('.settingsSearchResultMatch')).toHaveCount(0)

    await search.fill('checking')
    await expect(page.locator('.settingsSearchResultMatch')).toHaveCount(0)

    await search.fill('No default instance has been set')
    await expect(page.locator('.settingsSearchResultMatch')).toHaveCount(0)

    await search.fill('Current instance will be randomized on startup')
    await expect(page.locator('.settingsSearchResultMatch')).toHaveCount(0)

    await search.fill('Catppuccin Latte')
    await expect(page.locator('.settingsSearchResultMatch')).toHaveCount(0)

    await search.fill('Application Language')
    await expect(page.locator('.settingsSearchResultMatch')).toHaveCount(0)

    await search.fill('Preferred Caption Language')
    await expect(page.locator('.settingsMenu [data-section="playback"]')).toBeVisible()
    await page.getByRole('button', { name: 'Preferred Caption Language', exact: true }).click()
    await expect(page.locator('.select.settingsSearchTarget'))
      .toContainText('Preferred Caption Language')

    await search.fill('Base Theme')
    await expect(page.getByRole('button', { name: /^Base theme$/i })).toBeVisible()

    await search.fill('Default Landing Page')
    await page.getByRole('button', { name: /^Default landing page$/i }).click()
    const landingPageSelect = page.getByRole('combobox', { name: /Default landing page/i })
    await landingPageSelect.click()
    await expect(page.getByRole('option', { name: 'Settings', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await search.fill('no setting has this name')
    await expect(page.locator('.settingsMenu')).toContainText('No settings found')
    await expect(page.locator('.settingsContent')).toContainText('No settings found')
  })

  test('resizes without creating horizontal settings overflow', async ({ page }) => {
    await goTo(page, 'settings')
    const settingsWindow = page.locator('.settingsWindow')
    await expect(settingsWindow).not.toHaveClass(/settings-window-enter-active/)
    const originalBounds = await settingsWindow.boundingBox()
    const resizeHandle = page.locator('.resize-se')
    const handleBounds = await resizeHandle.boundingBox()

    await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2)
    await page.mouse.down()
    await page.mouse.move(handleBounds.x - 600, handleBounds.y - 180)
    await page.mouse.up()

    const resizedBounds = await settingsWindow.boundingBox()
    expect(resizedBounds.width).toBeLessThan(originalBounds.width)
    expect(resizedBounds.height).toBeLessThan(originalBounds.height)
    expect(resizedBounds.x).toBeCloseTo(originalBounds.x, 0)
    expect(resizedBounds.y).toBeCloseTo(originalBounds.y, 0)
    await expect(settingsWindow.locator('.settingsPage')).toHaveClass(/compactSettings/)
    expect(await page.locator('.settingsContent').evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return Array.from(element.querySelectorAll('*'))
        .filter(child => child.getBoundingClientRect().right > bounds.right + 1)
        .map(child => ({
          className: child.className?.toString(),
          right: child.getBoundingClientRect().right,
          tagName: child.tagName
        }))
    })).toEqual([])

    await expect.poll(() => page.evaluate(() => {
      return JSON.parse(localStorage.getItem('opentubex-settings-window-bounds'))?.width
    })).toBeCloseTo(resizedBounds.width, 0)
    await page.locator('.settingsCloseButton').click()
    await goTo(page, 'settings')
    await expect(settingsWindow).not.toHaveClass(/settings-window-enter-active/)

    const restoredBounds = await settingsWindow.boundingBox()
    expect(restoredBounds.width).toBeCloseTo(resizedBounds.width, 0)
    expect(restoredBounds.height).toBeCloseTo(resizedBounds.height, 0)
  })

  test('does not expose a horizontal scrollbar in phone-sized Appearance settings', async ({ app, page }) => {
    await setWindowSize(app, page, { width: 375, height: 700 })
    await goToSettingsSection(page, 'appearance')

    const scroller = page.locator('.settingsContent')
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

  test('keeps stacked theme selects compact in a narrow settings window', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 40,
        y: 40,
        width: 400,
        height: 700
      }))
    })
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()

    const selects = page.locator('.settingsContent .themeSelectRow .select')
    await expect(selects.first()).toBeVisible()
    expect(await selects.evaluateAll(elements => elements.every(element => element.offsetHeight === 45))).toBe(true)
    expect(await selects.evaluateAll(elements => elements.every(element => {
      const buttonBounds = element.querySelector('.select-text').getBoundingClientRect()
      const arrowBounds = element.querySelector('.iconSelect').getBoundingClientRect()
      return Math.abs(
        arrowBounds.top + arrowBounds.height / 2 - (buttonBounds.top + buttonBounds.height / 2)
      ) <= 1
    }))).toBe(true)
  })

  test('clamps Theme settings after a narrow-to-wide reflow', async ({ page }) => {
    await page.setViewportSize({ width: 340, height: 600 })
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()

    const content = page.locator('.settingsContent')
    await content.evaluate(element => element.scrollTo(0, element.scrollHeight))
    await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    await page.setViewportSize({ width: 1200, height: 800 })
    await expect.poll(() => content.evaluate(element => {
      const section = Array.from(element.children).find(child => {
        return child.classList.contains('section') && getComputedStyle(child).display !== 'none'
      })
      const maximum = Math.max(0, section.offsetTop + section.offsetHeight +
        Number.parseFloat(getComputedStyle(element).paddingBottom) - element.clientHeight)
      return element.scrollTop <= maximum + 1
    })).toBe(true)
  })

  test('does not clamp a subpixel Theme settings scroll boundary', async ({ page }) => {
    await goToSettingsSection(page, 'appearance')

    const result = await page.locator('.settingsContent').evaluate(element => {
      element.scrollTop = element.scrollHeight

      let prototype = Object.getPrototypeOf(element)
      let descriptor = null
      while (prototype !== null && descriptor === null) {
        descriptor = Object.getOwnPropertyDescriptor(prototype, 'scrollTop') ?? null
        prototype = Object.getPrototypeOf(prototype)
      }
      if (descriptor?.get === undefined || descriptor.set === undefined) {
        throw new Error('Unable to inspect the native scrollTop property')
      }

      const section = element.querySelector(':scope > .section')
      const maximum = Math.max(0, section.offsetTop + section.offsetHeight +
        Number.parseFloat(getComputedStyle(element).paddingBottom) - element.clientHeight)
      const writes = []

      Object.defineProperty(element, 'scrollTop', {
        configurable: true,
        get() {
          // Electron zoom can put the real boundary between CSS pixels even
          // though the layout properties used above report integer values.
          return descriptor.get.call(this) + 0.25
        },
        set(value) {
          writes.push(value)
          descriptor.set.call(this, value)
        }
      })

      try {
        const observedScrollTop = element.scrollTop
        element.dispatchEvent(new Event('scroll'))
        return { maximum, observedScrollTop, writes }
      } finally {
        delete element.scrollTop
      }
    })

    expect(result.observedScrollTop).toBeGreaterThan(result.maximum)
    expect(result.observedScrollTop).toBeLessThanOrEqual(result.maximum + 1)
    expect(result.writes).toEqual([])
  })

  test('returns to download settings when Downloads was opened from there', async ({ page }) => {
    const routeBeforeOpening = page.url()
    const downloadSection = await goToSettingsSection(page, 'download')

    await downloadSection.getByRole('button', { name: 'Open Downloads' }).click()
    const downloadsDialog = page.getByRole('dialog', { name: 'Downloads', exact: true })
    await expect(downloadsDialog).toBeVisible()
    await downloadsDialog.getByRole('button', { name: 'Back', exact: true }).click()

    await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible()
    await expect(downloadSection).toBeVisible()
    await expect(page.locator('.settingsWindow')).toHaveCount(1)
    expect(page.url()).toBe(routeBeforeOpening)

    await page.locator('.settingsCloseButton').click()
    await goTo(page, 'downloads')
    await expect(page.getByRole('dialog', { name: 'Downloads', exact: true })
      .getByRole('button', { name: 'Back', exact: true })).toHaveCount(0)
  })

  test('moves Downloads and Settings from Quick Settings into the app header', async ({ page }) => {
    const themeSection = await goToSettingsSection(page, 'appearance')
    const downloadsToggle = themeSection.getByRole('checkbox', {
      name: 'Move Downloads to App Header'
    })
    const settingsToggle = themeSection.getByRole('checkbox', {
      name: 'Move Settings to App Header'
    })

    await expect(downloadsToggle).not.toBeChecked()
    await expect(settingsToggle).not.toBeChecked()
    await expect(page.locator('.topNav .downloadsButton')).toHaveCount(0)
    await expect(page.locator('.topNav .settingsButton')).toHaveCount(0)

    await page.locator('.profileTrigger').click()
    const menu = page.getByRole('dialog', { name: 'Quick settings' })
    const downloadsShortcut = menu.getByRole('button', { name: 'Downloads' })
    const allSettingsShortcut = menu.getByRole('button', { name: 'All settings' })
    await expect(downloadsShortcut).toBeVisible()
    await expect(allSettingsShortcut).toBeVisible()
    await expect(menu.getByRole('heading', { name: 'Playback', exact: true })).toBeVisible()
    await expect(menu.getByRole('heading', { name: 'Content', exact: true })).toBeVisible()
    await page.locator('.profileTrigger').click()

    await themeSection.locator('label.switch-label')
      .filter({ hasText: 'Move Downloads to App Header' }).click()
    await themeSection.locator('label.switch-label')
      .filter({ hasText: 'Move Settings to App Header' }).click()
    await expect(downloadsToggle).toBeChecked()
    await expect(settingsToggle).toBeChecked()
    await page.locator('.settingsCloseButton').click()

    const downloadsButton = page.locator('.topNav .downloadsButton')
    const settingsButton = page.locator('.topNav .settingsButton')
    await expect(downloadsButton).toBeVisible()
    await expect(settingsButton).toBeVisible()

    await page.locator('.profileTrigger').click()
    await expect(downloadsShortcut).toHaveCount(0)
    await expect(allSettingsShortcut).toHaveCount(0)
    await page.locator('.profileTrigger').click()

    for (const [button, windowName] of [
      [downloadsButton, 'Downloads'],
      [settingsButton, 'Settings']
    ]) {
      await button.click()
      const utilityWindow = page.getByRole('dialog', { name: windowName, exact: true })
      await expect(utilityWindow).toBeVisible()
      await expect(utilityWindow.getByRole('button', { name: /Minimi[sz]e/ })).toHaveCount(0)
      await utilityWindow.getByRole('button', { name: 'Close' }).click()
    }
  })

  test('clamps the Downloads scroll position when a wider layout becomes shorter', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 40,
        y: 40,
        width: 400,
        height: 650
      }))
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      for (let index = 0; index < 8; index++) {
        store.commit('upsertYtDlpDownload', {
          id: index + 1,
          title: `Responsive download ${index + 1}`,
          status: 'completed',
          mode: 'video',
          availability: 'available',
          destination: `/tmp/responsive-download-${index + 1}.webm`,
          sizeBytes: 1024 * (index + 1)
        })
      }
    })
    await goTo(page, 'downloads')
    const downloadsScroll = page.locator('.settingsDownloadsPage')
    await downloadsScroll.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => downloadsScroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    const resizeHandle = page.locator('.resize-e')
    const handleBounds = await resizeHandle.boundingBox()
    await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2)
    await page.mouse.down()
    await page.mouse.move(handleBounds.x + 600, handleBounds.y + handleBounds.height / 2)
    await page.mouse.up()

    await expect.poll(() => downloadsScroll.evaluate(element => {
      const content = element.firstElementChild
      const maximumScrollTop = Math.max(0, content.offsetTop + content.offsetHeight +
        Number.parseFloat(getComputedStyle(element).paddingBottom) - element.clientHeight)
      return element.scrollTop <= maximumScrollTop + 1
    })).toBe(true)
  })

  test('resets standalone scroll position when switching views', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 40,
        y: 40,
        width: 400,
        height: 650
      }))
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      for (let index = 0; index < 8; index++) {
        store.commit('upsertYtDlpDownload', {
          id: index + 1,
          title: `View switch download ${index + 1}`,
          status: 'completed',
          mode: 'video',
          availability: 'available',
          destination: `/tmp/view-switch-download-${index + 1}.webm`
        })
      }
    })
    await goTo(page, 'downloads')
    const downloadsScroll = page.locator('.settingsDownloadsPage')
    await downloadsScroll.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => downloadsScroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.dispatch('showSettingsWindow', 'about')
    })
    await expect(page.getByRole('dialog', { name: 'About', exact: true })).toBeVisible()
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.dispatch('showSettingsWindow', 'downloads')
    })

    await expect.poll(() => page.locator('.settingsDownloadsPage').evaluate(element => element.scrollTop)).toBe(0)
  })

  test('clamps the settings scroll position after repeated resizing', async ({ page }) => {
    await goTo(page, 'settings')
    const settingsWindow = page.locator('.settingsWindow')
    const content = page.locator('.settingsContent')
    const resizeHandle = page.locator('.resize-se')
    await expect(settingsWindow).not.toHaveClass(/settings-window-enter-active/)

    const originalHandleBounds = await resizeHandle.boundingBox()
    await page.mouse.move(
      originalHandleBounds.x + originalHandleBounds.width / 2,
      originalHandleBounds.y + originalHandleBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(originalHandleBounds.x - 180, originalHandleBounds.y - 180)
    await page.mouse.up()

    await content.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    const smallerHandleBounds = await resizeHandle.boundingBox()
    await page.mouse.move(
      smallerHandleBounds.x + smallerHandleBounds.width / 2,
      smallerHandleBounds.y + smallerHandleBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(smallerHandleBounds.x + 180, smallerHandleBounds.y + 180)
    await page.mouse.up()

    await page.waitForTimeout(250)
    expect(await content.evaluate(element => {
      const section = element.querySelector('.section')
      const contentEnd = section.offsetTop + section.offsetHeight +
        Number.parseFloat(getComputedStyle(element).paddingBottom)
      return element.scrollTop - Math.max(0, contentEnd - element.clientHeight)
    })).toBeLessThanOrEqual(1)

    const restoredHandleBounds = await resizeHandle.boundingBox()
    await page.mouse.move(
      restoredHandleBounds.x + restoredHandleBounds.width / 2,
      restoredHandleBounds.y + restoredHandleBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(restoredHandleBounds.x - 180, restoredHandleBounds.y - 180)
    await page.mouse.up()

    const menu = page.locator('.settingsMenu')
    await menu.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => menu.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    const compactHandleBounds = await resizeHandle.boundingBox()
    await page.mouse.move(
      compactHandleBounds.x + compactHandleBounds.width / 2,
      compactHandleBounds.y + compactHandleBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(compactHandleBounds.x + 180, compactHandleBounds.y + 180)
    await page.mouse.up()

    await page.waitForTimeout(250)
    expect(await menu.evaluate(element => (
      element.scrollTop - Math.max(0, element.scrollHeight - element.clientHeight)
    ))).toBeLessThanOrEqual(1)
  })

  test('animates maximize and restore while preserving its floating bounds', async ({ page }) => {
    await goTo(page, 'settings')
    const settingsWindow = page.locator('.settingsWindow')
    await expect(settingsWindow).not.toHaveClass(/settings-window-enter-active/)
    const originalBounds = await settingsWindow.boundingBox()
    await settingsWindow.evaluate(element => {
      const animate = element.animate.bind(element)
      element.animate = (...args) => {
        element.dataset.boundsAnimationStarted = 'true'
        return animate(...args)
      }
    })

    await page.getByRole('button', { name: 'Maximize' }).click()
    await expect(settingsWindow).toHaveClass(/maximized/)
    await expect(settingsWindow).toHaveAttribute('data-bounds-animation-started', 'true')
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    await expect.poll(async () => (await settingsWindow.boundingBox()).width).toBe(viewport.width)
    await expect.poll(async () => (await settingsWindow.boundingBox()).height).toBe(viewport.height)
    await expect(page.locator('.settingsResizeHandle:visible')).toHaveCount(0)

    await settingsWindow.getByRole('button', { name: 'Restore', exact: true }).click()
    await expect(settingsWindow).not.toHaveClass(/maximized/)
    await expect.poll(async () => (await settingsWindow.boundingBox()).width)
      .toBeCloseTo(originalBounds.width, 0)
    await expect.poll(async () => (await settingsWindow.boundingBox()).height)
      .toBeCloseTo(originalBounds.height, 0)

    const breadcrumb = page.locator('.settingsBreadcrumb')
    const breadcrumbBounds = await breadcrumb.boundingBox()
    await breadcrumb.dblclick({
      position: { x: breadcrumbBounds.width - 4, y: breadcrumbBounds.height / 2 }
    })
    await expect(settingsWindow).toHaveClass(/maximized/)
    await breadcrumb.dblclick({
      position: { x: breadcrumbBounds.width - 4, y: breadcrumbBounds.height / 2 }
    })
    await expect(settingsWindow).not.toHaveClass(/maximized/)

    await page.getByRole('button', { name: 'Maximize' }).click()
    await expect(settingsWindow).toHaveClass(/maximized/)
    await expect(page.locator('body > .os-scrollbar-vertical')).toHaveCSS('visibility', 'hidden')
    await expect.poll(() => settingsWindow.evaluate(element => element.getAnimations().length)).toBe(0)
    const dragTargetBounds = await page.locator('.settingsBreadcrumbLabel').first().boundingBox()
    await page.mouse.move(
      dragTargetBounds.x + dragTargetBounds.width / 2,
      dragTargetBounds.y + dragTargetBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(
      dragTargetBounds.x + dragTargetBounds.width / 2 + 30,
      dragTargetBounds.y + dragTargetBounds.height / 2 + 20
    )
    await expect(settingsWindow).not.toHaveClass(/maximized/)
    await page.mouse.up()
    await expect.poll(async () => (await settingsWindow.boundingBox()).width)
      .toBeCloseTo(originalBounds.width, 0)
  })

  test('keeps the settings window inside the narrowest supported viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await goTo(page, 'settings')
    await page.setViewportSize({ width: 340, height: 600 })
    await expect(page.locator('.settingsWindow')).not.toHaveClass(/settings-window-enter-active/)

    const bounds = await page.locator('.settingsWindow').boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(340)
  })

  test('keeps narrow settings maximized below the status bar after viewport height changes', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 })
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--safe-area-inset-top', '24px')
    })
    await goTo(page, 'settings')

    const settingsWindow = page.locator('.settingsWindow')
    await expect(settingsWindow).toHaveClass(/maximized/)
    await expect(page.getByRole('button', { name: /Maximi[sz]e|Restore/ })).toHaveCount(0)
    await expect(page.locator('.settingsResizeHandle:visible')).toHaveCount(0)
    await expect(page.getByRole('searchbox', { name: 'Search settings' })).not.toBeFocused()

    await page.setViewportSize({ width: 375, height: 500 })
    await page.setViewportSize({ width: 375, height: 800 })

    await expect.poll(async () => (await settingsWindow.boundingBox()).y).toBe(24)
    await expect.poll(async () => (await settingsWindow.boundingBox()).height).toBe(776)

    await page.setViewportSize({ width: 720, height: 390 })
    await expect(settingsWindow).toHaveClass(/maximized/)
    await expect.poll(async () => (await settingsWindow.boundingBox()).width).toBe(720)
    await expect.poll(async () => (await settingsWindow.boundingBox()).height).toBe(366)
  })

  test('keeps its minimum size when a resize pointer crosses the window', async ({ page }) => {
    await goTo(page, 'settings')
    const resizeHandle = page.locator('.resize-se')
    const handleBounds = await resizeHandle.boundingBox()

    await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2)
    await page.mouse.down()
    await page.mouse.move(0, 0)
    await page.mouse.up()

    // Rounded because the window lands on a fractional CSS pixel on scaled
    // displays: the point is that it stopped at its 360px minimum instead of
    // collapsing, not that it hit it to the pixel.
    const bounds = await page.locator('.settingsWindow').boundingBox()
    expect(Math.round(bounds.width)).toBeGreaterThanOrEqual(360)
    expect(Math.round(bounds.height)).toBeGreaterThanOrEqual(360)
  })

  test('wraps controls before the two-column detail pane clips them', async ({ page, attachScreenshot }) => {
    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 40,
        y: 40,
        width: 820,
        height: 700
      }))
    })
    await goTo(page, 'settings')
    await expect(page.locator('.settingsPage')).not.toHaveClass(/compactSettings/)

    for (const grid of ['.switchColumnGrid', '.switchGrid']) {
      expect(await page.locator(grid).first().evaluate(element => {
        return getComputedStyle(element).gridTemplateColumns.split(' ').length
      })).toBe(1)
    }

    const content = page.locator('.settingsContent')
    expect(await content.evaluate(element => {
      const rightEdge = element.getBoundingClientRect().right
      return Array.from(element.querySelectorAll('.section *')).every(child => {
        const bounds = child.getBoundingClientRect()
        return bounds.width === 0 || bounds.right <= rightEdge + 1
      })
    })).toBe(true)
    await attachScreenshot('820px wide settings window')
  })

  test('returns from saved channel settings through its clickable breadcrumb', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="playback"]').click()
    await page.getByRole('button', { name: /Manage Saved Channels/ }).click()

    const breadcrumb = page.locator('.settingsBreadcrumb')
    await expect(breadcrumb).toContainText('Settings')
    await expect(breadcrumb).toContainText('Playback')
    await expect(breadcrumb).toContainText('Saved Channel Settings')
    await expect(breadcrumb.locator('.settingsBreadcrumbSubpageIcon[data-icon="users"]')).toBeVisible()
    await breadcrumb
      .getByRole('button', { name: 'Playback' })
      .locator('.settingsBreadcrumbCategoryIcon')
      .click()

    await expect(page.locator('.settingsContent > [data-section="playback"]')).toBeVisible()
    await expect(breadcrumb).not.toContainText('Saved Channel Settings')
  })

  test('keeps saved-channel controls in two columns without narrow wrapping', async ({ page, attachScreenshot }) => {
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return Promise.all([
        store.dispatch('updateChannelPlaybackSpeeds', JSON.stringify({
          channel1: 1,
          channel2: 1.25,
          channel3: 1.5
        })),
        store.dispatch('updateChannelVideoQualities', JSON.stringify({ channel1: '1080' })),
        store.dispatch('updateChannelSubtitlesStates', JSON.stringify({ channel1: true })),
        store.dispatch('updateChannelVolumes', JSON.stringify({ channel1: 0.5 }))
      ])
    })
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="playback"]').click()
    await page.getByRole('button', { name: /Manage Saved Channels/ }).click()

    const entries = page.locator('.channelEntry')
    await expect(entries).toHaveCount(3)
    const firstEntryPreferences = entries.first().locator('.channelPreference')
    const preferenceTops = await firstEntryPreferences.evaluateAll(elements => {
      return elements.slice(0, 2).map(element => Math.round(element.getBoundingClientRect().top))
    })
    expect(new Set(preferenceTops).size).toBe(1)
    await attachScreenshot('saved channel controls in two columns')

    await entries.first().locator('.channelLink').click()
    await expect(page.locator('.settingsBreadcrumb')).toContainText('Saved Channel Settings')
    await expect(page.locator('.channelListContainer')).toBeVisible()
  })

  test('keeps shortcut and saved-channel subpages scrollable in compact layout', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 40,
        y: 40,
        width: 500,
        height: 450
      }))
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return Promise.all([
        store.dispatch('updateChannelPlaybackSpeeds', JSON.stringify(Object.fromEntries(
          Array.from({ length: 8 }, (_, index) => [`channel${index}`, 1 + index / 10])
        ))),
        store.dispatch('updateChannelVideoQualities', JSON.stringify({ channel0: '1080' })),
        store.dispatch('updateChannelSubtitlesStates', JSON.stringify({ channel0: true })),
        store.dispatch('updateChannelVolumes', JSON.stringify({ channel0: 0.5 }))
      ])
    })
    await goTo(page, 'settings')
    await expect(page.locator('.settingsPage')).toHaveClass(/compactSettings/)
    const [headerBounds, searchBounds] = await Promise.all([
      page.locator('.settingsWindowHeader').boundingBox(),
      page.locator('.settingsSearch').boundingBox()
    ])
    expect(searchBounds.x - headerBounds.x).toBeCloseTo(10, 0)
    expect(headerBounds.x + headerBounds.width - searchBounds.x - searchBounds.width)
      .toBeCloseTo(10, 0)
    await page.getByRole('searchbox', { name: 'Search settings' }).fill('FFmpeg Source')
    await expect(page.locator('.settingsMenu')).toBeHidden()
    await expect(page.getByRole('button', { name: 'FFmpeg Source', exact: true })).toBeVisible()
    await page.getByRole('searchbox', { name: 'Search settings' }).fill('')
    await expect(page.locator('.settingsMenu')).toBeVisible()
    await recordAnimations(page)
    await page.locator('.settingsMenu [data-section="playback"]').click()
    await expectAnimation(page, 'settings-compact-slide-forward')
    await page.getByRole('button', { name: /Manage Saved Channels/ }).click()

    const channelList = page.locator('.channelListContainer')
    expect(await page.locator('.channelPreferences').first().evaluate(element => {
      return getComputedStyle(element).gridTemplateColumns.split(' ').length
    })).toBe(1)
    expect(await channelList.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    await channelList.evaluate(element => {
      element.scrollTop = element.scrollHeight
    })
    await expect.poll(() => channelList.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    const settingsBackButton = page.locator('.settingsBackButton')
    await settingsBackButton.click()
    await recordAnimations(page)
    await settingsBackButton.click()
    await expect(page.locator('.settingsMenu')).toBeVisible()
    await expectAnimation(page, 'settings-compact-slide-backward')

    await page.getByRole('button', { name: 'Show Keyboard Shortcuts' }).click()
    const shortcuts = page.locator('.shortcutColumns')
    expect(await shortcuts.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    await shortcuts.evaluate(element => {
      element.scrollTop = element.scrollHeight
    })
    await expect.poll(() => shortcuts.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    await settingsBackButton.click()
    await expect(page.locator('.settingsMenu')).toBeVisible()
    await expect(page.locator('.settingsContent')).toBeHidden()
  })

  test('animates category changes vertically in two-column layout', async ({ page }) => {
    await goTo(page, 'settings')

    await recordAnimations(page)
    await page.locator('.settingsMenu [data-section="playback"]').click()
    await expectAnimation(page, 'settings-section-slide-forward')
    await page.locator('.settingsMenu [data-section="appearance"]').click()
    await expectAnimation(page, 'settings-section-slide-backward')

    // The class is cleared once it has played, so nothing replays the slide
    // later on — rebuilding the overlay scrollbars used to.
    await expect(page.locator('.settingsContent')).not.toHaveClass(/settingsSectionSlide/)
    await recordAnimations(page)
    await page.locator('label.switch-label').filter({ hasText: 'Always Show Scrollbars' }).click()
    await page.waitForTimeout(500)
    expect(await page.evaluate(() => window.__playedAnimations)).toEqual([])
  })

  test('keeps its scroll position when always-visible scrollbars are enabled', async ({ page }) => {
    await expectAlwaysVisibleScrollbarsToPreserveSettingsScroll(page)
  })

  test.describe('with 95% UI scale', () => {
    test.use({ seed: { settings: { uiScale: 95 } } })

    test('keeps its scroll position when always-visible scrollbars are enabled', async ({ page }) => {
      await expectAlwaysVisibleScrollbarsToPreserveSettingsScroll(page)
    })
  })

  test.describe('with reduced motion', () => {
    test.use({ seed: { settings: { reducedMotion: 'on' } } })

    test('leaves no slide class behind for a suppressed animation', async ({ page }) => {
      await goTo(page, 'settings')
      await recordAnimations(page)
      await page.locator('.settingsMenu [data-section="playback"]').click()
      await expect(page.locator('.settingsContent > [data-section="playback"]')).toBeVisible()

      // Nothing plays, and nothing is left that could play later: turning
      // reduced motion back off would otherwise slide the settings unprompted.
      await expect(page.locator('.settingsContent')).not.toHaveClass(/settingsSectionSlide/)
      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        return store.dispatch('updateReducedMotion', 'off')
      })
      await page.waitForTimeout(500)
      expect(await page.evaluate(() => window.__playedAnimations)).toEqual([])
    })
  })

  test('keeps quick playback speed actions sticky and reflects the default state', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="playback"]').click()
    const customizeButton = page.getByRole('button', {
      name: 'Customize Quick Playback Speed Bar'
    })
    await expect(customizeButton).toBeDisabled()
    await page.locator('label.switch-label')
      .filter({ hasText: 'Use Quick Playback Speed Bar' })
      .click()
    await expect(customizeButton).toBeEnabled()
    await customizeButton.click()

    await expect(page.locator('.settingsBreadcrumb [data-icon="gauge-high"]')).toBeVisible()

    const scroller = page.locator('.settingsSubpageScroll')
    const toolbar = page.locator('.quickPlaybackSpeedToolbar')
    const list = page.locator('.quickPlaybackSpeedList')
    const reset = page.getByRole('button', { name: 'Reset to Defaults' })
    await expect(reset).toBeDisabled()

    const [scrollerBounds, scrollerClientWidth, listBounds] = await Promise.all([
      scroller.boundingBox(),
      scroller.evaluate(element => element.clientWidth),
      list.boundingBox()
    ])
    expect(listBounds.width).toBeLessThanOrEqual(800)
    expect(Math.abs(
      listBounds.x + listBounds.width / 2 - scrollerBounds.x - scrollerClientWidth / 2
    )).toBeLessThanOrEqual(1)

    await page.getByRole('button', { name: 'Add Playback Speed' }).click()
    await expect(reset).toBeEnabled()
    await reset.click()
    await expect(reset).toBeDisabled()

    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(async () => {
      const [currentScrollerBounds, toolbarBounds] = await Promise.all([
        scroller.boundingBox(),
        toolbar.boundingBox()
      ])
      return Math.abs(toolbarBounds.y - currentScrollerBounds.y)
    }).toBeLessThanOrEqual(1)
    await expect(toolbar).toBeVisible()
  })

  test('aligns caption color controls with neighboring selects', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="playback"]').click()

    const edgeStyle = page.getByRole('combobox', { name: 'Edge Style' })
    await edgeStyle.click()
    await page.getByRole('option', { name: 'Drop Shadow' }).click()

    const edgeStyleControl = edgeStyle.locator('..').locator('..')
    const edgeColorControl = page.locator('.captionColorControl').filter({ hasText: 'Edge Color' })
    const edgeColorTrigger = edgeColorControl.getByRole('button', { name: 'Edge Color' })
    const [styleControlBounds, colorControlBounds, colorTriggerBounds] = await Promise.all([
      edgeStyleControl.boundingBox(),
      edgeColorControl.boundingBox(),
      edgeColorTrigger.boundingBox()
    ])

    expect(colorControlBounds.y).toBeCloseTo(styleControlBounds.y, 0)
    expect(colorControlBounds.height).toBeCloseTo(styleControlBounds.height, 0)
    expect(colorTriggerBounds.y).toBeCloseTo(colorControlBounds.y, 0)
    expect(colorTriggerBounds.height).toBeCloseTo(colorControlBounds.height, 0)
  })

  test('stacks caption controls at narrow settings widths', async ({ page, attachScreenshot }) => {
    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 40,
        y: 40,
        width: 420,
        height: 700
      }))
    })
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="playback"]').click()

    const preview = page.locator('.captionPreview')
    const initialPreviewBounds = await preview.boundingBox()
    await page.getByRole('slider', { name: /Font Size/ }).fill('400')
    const enlargedPreviewBounds = await preview.boundingBox()
    expect(initialPreviewBounds.height).toBe(240)
    expect(enlargedPreviewBounds.height).toBe(initialPreviewBounds.height)

    const controls = page.locator('.captionControls')
    expect(await controls.evaluate(element => {
      return getComputedStyle(element).gridTemplateColumns.split(' ').length
    })).toBe(1)
    await attachScreenshot('caption settings at 420px')

    const contentBounds = await page.locator('.settingsContent').boundingBox()
    expect(await page.locator('.captionControl').evaluateAll((elements, rightEdge) => {
      return elements.every(element => element.getBoundingClientRect().right <= rightEdge + 1)
    }, contentBounds.x + contentBounds.width)).toBe(true)
  })

  test('does not focus a help tooltip when opening Downloads', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="download"]').click()

    await expect(page.locator('[role="tooltip"]:visible')).toHaveCount(0)
  })

  test('allows help tooltips outside the settings window', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 40,
        y: 40,
        width: 900,
        height: 360
      }))
    })
    await goTo(page, 'settings')

    const content = page.locator('.settingsContent')
    const tooltipButton = content.locator('.selectTooltip .button').last()
    await tooltipButton.evaluate(element => {
      const scrollContainer = element.closest('.settingsContent')
      const buttonBounds = element.getBoundingClientRect()
      const contentBounds = scrollContainer.getBoundingClientRect()
      scrollContainer.scrollTop += buttonBounds.bottom - contentBounds.bottom + 8
    })
    await tooltipButton.evaluate(element => element.focus({ preventScroll: true }))
    const tooltip = page.locator('body > [role="tooltip"]:visible')
    await expect(tooltip).toBeVisible()

    const [contentBounds, tooltipBounds, viewport, fontFamily] = await Promise.all([
      content.boundingBox(),
      tooltip.boundingBox(),
      page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
      tooltip.evaluate(element => getComputedStyle(element).fontFamily)
    ])
    expect(tooltipBounds.y + tooltipBounds.height).toBeGreaterThan(contentBounds.y + contentBounds.height)
    expect(tooltipBounds.x).toBeGreaterThanOrEqual(7)
    expect(tooltipBounds.y).toBeGreaterThanOrEqual(7)
    expect(tooltipBounds.x + tooltipBounds.width).toBeLessThanOrEqual(viewport.width - 7)
    expect(tooltipBounds.y + tooltipBounds.height).toBeLessThanOrEqual(viewport.height - 7)
    expect(fontFamily).toContain('Geist')
  })

  test('keeps an open help tooltip aligned and visible in fullscreen', async ({ page }) => {
    await goTo(page, 'settings')

    const settingsWindow = page.locator('.settingsWindow')
    const tooltipButton = page.locator('.settingsContent .selectTooltip .button').first()
    await tooltipButton.focus()

    const bodyTooltip = page.locator('body > [role="tooltip"]:visible')
    await expect(bodyTooltip).toBeVisible()

    // Read the button and the tooltip in one frame. Sampling them in separate
    // round-trips lets a late layout change (the open transition, a font swap
    // resizing the tooltip) land between the two reads, which offsets the
    // baselines against each other and makes the comparison below unsatisfiable.
    const measure = () => page.evaluate(() => {
      const button = document.querySelector('.settingsContent .selectTooltip .button')
      const tooltip = Array.from(document.querySelectorAll('body > [role="tooltip"]'))
        .find(element => element.checkVisibility())
      const buttonBounds = button.getBoundingClientRect()
      const tooltipBounds = tooltip.getBoundingClientRect()
      return {
        buttonLeft: buttonBounds.left,
        anchorOffset: tooltipBounds.left - buttonBounds.left,
        tooltipLeft: tooltipBounds.left,
        tooltipRight: tooltipBounds.right,
        viewportWidth: innerWidth
      }
    })

    const EDGE_MARGIN = 8
    // The window animates open, so wait for the button to hold still before
    // taking the baseline.
    let previous = null
    await expect.poll(async () => {
      const current = await measure()
      const settled = previous !== null && current.buttonLeft === previous.buttonLeft
      previous = current
      return settled
    }).toBe(true)
    const initial = previous
    // The tooltip is clamped to the viewport, so it only tracks its button
    // while it has room. Move the window towards the side that still fits.
    const shift = initial.tooltipRight + 40 <= initial.viewportWidth - EDGE_MARGIN
      ? 40
      : -40
    expect(shift === 40 || initial.tooltipLeft - 40 >= EDGE_MARGIN).toBe(true)
    await settingsWindow.evaluate((element, offset) => {
      element.style.left = `${element.getBoundingClientRect().left + offset}px`
    }, shift)

    // The tooltip stays anchored to its button: it keeps the same offset from
    // the button instead of merely moving by a similar amount.
    await expect.poll(async () => {
      const moved = await measure()
      return {
        buttonMoved: Math.abs(moved.buttonLeft - initial.buttonLeft - shift) <= 1,
        anchored: Math.abs(moved.anchorOffset - initial.anchorOffset) <= 1,
        withinViewport: moved.tooltipLeft >= EDGE_MARGIN &&
          moved.tooltipRight <= moved.viewportWidth - EDGE_MARGIN
      }
    }).toEqual({ buttonMoved: true, anchored: true, withinViewport: true })

    await settingsWindow.evaluate(element => element.requestFullscreen())
    await expect.poll(() => settingsWindow.evaluate(element => document.fullscreenElement === element)).toBe(true)
    await expect(settingsWindow.locator(':scope > [role="tooltip"]:visible')).toBeVisible()

    await page.evaluate(() => document.exitFullscreen())
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull()
    await expect(bodyTooltip).toBeVisible()
  })

  test('select dropdowns use overlay scrollbars', async ({ page }) => {
    await goTo(page, 'settings')

    const combobox = page.getByRole('combobox', { name: /Language preference|Locale Preference/ })
    await combobox.click()

    const dropdown = page.locator('.selectDropdown')
    await expect(dropdown).toBeVisible()
    await expect(dropdown).toContainText('English (US) (100%)')
    await expect(dropdown.locator('.os-scrollbar-vertical')).toHaveCount(1)
    await expect(dropdown).toHaveCSS('scrollbar-width', 'none')

    const appearance = await dropdown.evaluate((menu) => {
      const menuStyle = getComputedStyle(menu)
      const chromeBottom = Math.max(
        ...Array.from(document.querySelectorAll('.topNav, .tabBar:not(.vertical)'))
          .map(element => element.getBoundingClientRect().bottom)
      )

      return {
        chromeBottom,
        cursor: getComputedStyle(menu.querySelector('.selectOption')).cursor,
        fontFamily: menuStyle.fontFamily,
        menuTop: menu.getBoundingClientRect().top
      }
    })

    expect(appearance.fontFamily).toContain('Geist')
    expect(appearance.cursor).toBe('default')
    expect(appearance.menuTop).toBeGreaterThanOrEqual(appearance.chromeBottom)

    const scrollbarHandle = dropdown.locator('.os-scrollbar-vertical .os-scrollbar-handle')
    const handleBounds = await scrollbarHandle.boundingBox()
    await page.mouse.move(
      handleBounds.x + handleBounds.width / 2,
      handleBounds.y + handleBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(
      handleBounds.x + handleBounds.width / 2,
      handleBounds.y + handleBounds.height / 2 + 30
    )
    await expect(dropdown).toBeVisible()
    await page.mouse.up()

    await combobox.press('Home')
    await combobox.press('ArrowDown')
    await combobox.press('Enter')
    await expect(combobox).toContainText('English (US) (100%)')
    await expect(dropdown).toHaveCount(0)

    await page.locator('.settingsMenu [data-section="advanced"]').click()
    await page.getByRole('combobox', { name: 'Preferred API backend' }).click()
    await expect(dropdown).toBeVisible()
    expect(await dropdown.evaluate(menu => menu.scrollHeight <= menu.clientHeight)).toBe(true)
  })

  test('contains wheel scrolling at the ends of select dropdowns', async ({ page }) => {
    await goTo(page, 'settings')

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setScrollSpeed', 200)
      document.body.style.minBlockSize = '4000px'
      document.scrollingElement.scrollTop = 1000
    })
    await expect.poll(() => page.evaluate(() => document.scrollingElement.scrollTop))
      .toBe(1000)

    await page.getByRole('combobox', { name: /Language preference|Locale Preference/ }).click()
    const dropdown = page.locator('.selectDropdown')
    await expect(dropdown).toBeVisible()
    await dropdown.hover()

    for (const { dropdownEnd, wheelDelta } of [
      { dropdownEnd: 'bottom', wheelDelta: 1000 },
      { dropdownEnd: 'top', wheelDelta: -1000 }
    ]) {
      await dropdown.evaluate((element, end) => {
        element.scrollTop = end === 'bottom' ? element.scrollHeight : 0
      }, dropdownEnd)
      const pageScrollTop = await page.evaluate(() => document.scrollingElement.scrollTop)

      for (let index = 0; index < 5; index++) {
        await page.mouse.wheel(0, wheelDelta)
      }

      await expect.poll(() => page.evaluate(() => document.scrollingElement.scrollTop))
        .toBe(pageScrollTop)
    }
  })

  test('closes without replacing the underlying page', async ({ page }) => {
    const url = page.url()
    await goTo(page, 'settings')
    await page.locator('.settingsCloseButton').click()

    await expect(page.locator('.settingsWindow')).toHaveCount(0)
    await expect(page).toHaveURL(url)
  })

  test('switches sections without changing the current URL', async ({ page }) => {
    const url = page.url()
    await goTo(page, 'settings')

    const playerSectionLink = page.locator('.settingsMenu [data-section="playback"]')
    await playerSectionLink.click()
    await expect(playerSectionLink).toHaveClass(/active/)
    await expect(page.locator('.settingsContent > [data-section="playback"]')).toBeVisible()
    await expect(page).toHaveURL(url)
  })

  test('scrolls to the top when switching categories', async ({ page }) => {
    await goToSettingsSection(page, 'appearance')
    const content = page.locator('.settingsContent')
    await content.evaluate(element => element.scrollTo(0, element.scrollHeight))
    await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    await page.locator('.settingsMenu [data-section="privacy"]').click()
    await expect.poll(() => content.evaluate(element => element.scrollTop)).toBe(0)
  })

  test('keeps the window and its scroll position when switching tabs', async ({ page }) => {
    await goTo(page, 'settings')

    const playerSectionLink = page.locator('.settingsMenu [data-section="playback"]')
    await playerSectionLink.click()

    const settingsContent = page.locator('.settingsContent')
    const sectionScrollPosition = await settingsContent.evaluate(element => element.scrollTop)
    await settingsContent.hover()
    await page.mouse.wheel(0, 200)
    await expect.poll(() => settingsContent.evaluate(element => element.scrollTop))
      .toBeGreaterThan(sectionScrollPosition)
    const scrollPosition = await settingsContent.evaluate(element => element.scrollTop)
    await expect(playerSectionLink).toHaveClass(/active/)

    await page.locator(sel.newTabButton).click()
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    await page.locator(sel.tabs).first().click()
    await expect(page.locator(sel.tabs).first()).toHaveClass(/active/)
    await expect(page.locator('.settingsWindow')).toBeVisible()
    await expect(playerSectionLink).toHaveClass(/active/)

    await expect.poll(() => settingsContent.evaluate(element => element.scrollTop)).toBe(scrollPosition)
  })

  test('configures the watched percentage threshold', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="privacy"]').click()

    const threshold = page.getByRole('slider', { name: /Watched Percentage Threshold/ })
    await expect(threshold).toHaveValue('90')
    await threshold.fill('0')
    await expect(threshold).toHaveValue('0')
    await threshold.fill('100')
    await expect(threshold).toHaveValue('100')
  })

  test('enables YouTube-style Shorts by default in player settings', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="playback"]').click()

    const toggle = page.getByRole('checkbox', { name: 'Use YouTube-style Shorts' })
    await expect(toggle).toBeChecked()

    await page.locator('label.switch-label')
      .filter({ hasText: 'Use YouTube-style Shorts' })
      .click()
    await expect(toggle).not.toBeChecked()
  })

  test('disables the cross-tab mini player while automatic PiP on tab change is enabled', async ({ page }) => {
    const playback = await goToSettingsSection(page, 'playback')
    const miniPlayerToggle = playback.getByRole('checkbox', {
      name: 'Keep a mini player on screen when switching tabs'
    })
    const automaticPipToggle = playback.getByRole('checkbox', {
      name: 'When switching tabs',
      exact: true
    })
    const automaticPipLabel = playback.locator('.pure-checkbox label')
      .filter({ hasText: 'When switching tabs' })

    await expect(miniPlayerToggle).toBeEnabled()
    await playback.locator('label.switch-label')
      .filter({ hasText: 'Keep a mini player on screen when switching tabs' })
      .click()
    await expect(miniPlayerToggle).toBeChecked()

    await automaticPipLabel.click()
    await expect(automaticPipToggle).toBeChecked()
    await expect(miniPlayerToggle).toBeDisabled()
    await expect(miniPlayerToggle).toBeChecked()

    await automaticPipLabel.click()
    await expect(automaticPipToggle).not.toBeChecked()
    await expect(miniPlayerToggle).toBeEnabled()
    await expect(miniPlayerToggle).toBeChecked()
  })

  test('shows voice-over settings disabled until translation is enabled', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="add-ons"]').click()

    const settingsContent = page.locator('.settingsContent')
    const voiceOverSection = page.locator('.settingsSection').filter({
      has: page.getByRole('heading', { name: /Voice-over translation/ })
    })
    await settingsContent.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect(voiceOverSection).toBeInViewport()

    const enableToggle = page.getByRole('checkbox', { name: 'Enable voice-over translation' })
    const backgroundToggle = page.getByRole('checkbox', {
      name: 'Start preparing voice-over translations in the background'
    })
    const languageSelect = page.getByRole('combobox', {
      name: 'Voice-over translation language'
    })

    await expect(enableToggle).not.toBeChecked()
    await expect(backgroundToggle).toBeDisabled()
    await expect(languageSelect).toBeDisabled()
    await page.locator('label.switch-label')
      .filter({ hasText: 'Enable voice-over translation' })
      .click()

    await expect(backgroundToggle).toBeEnabled()
    await expect(backgroundToggle).not.toBeChecked()
    await expect(languageSelect).toBeEnabled()
    await expect(page.getByRole('checkbox', {
      name: 'Cache voice-over translations for one day'
    })).toHaveCount(0)
    await expect(page.getByText('Supported source languages: Russian, English, Chinese, Korean,'))
      .toBeVisible()
  })

  test('the tab width slider only becomes usable with fixed tab width on', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()

    const slider = page.getByRole('slider', { name: /Tab Width/ })
    const fixedWidthToggle = page.locator('.switchColumnGrid > .switchColumn').first()
      .locator('label.switch-label')
      .filter({ hasText: 'Use Fixed Tab Width in Horizontal Mode' })
    await expect(fixedWidthToggle).toHaveCount(1)
    await expect(slider).toBeDisabled()

    await fixedWidthToggle.click()
    await expect(page.getByRole('checkbox', { name: 'Use Fixed Tab Width in Horizontal Mode' })).toBeChecked()
    await expect(slider).toBeEnabled()

    // Dragging resizes the tabs live.
    await slider.evaluate((input) => {
      input.value = '100'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await expect.poll(async () => {
      return await page.locator(sel.activeTab).evaluate(
        tab => Math.round(tab.getBoundingClientRect().width)
      )
    }).toBe(100)
  })

  test('configures animation speed and disables it with reduced motion', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()

    const slider = page.getByRole('slider', { name: /Animation Speed/ })
    await expect(slider).toHaveValue('100')
    await expect(slider).toBeEnabled()

    await slider.fill('200')
    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.getters.getAnimationSpeed
    })).toBe(200)

    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('Wall-clock animation', 2000)
    })
    const timeoutIndicator = page.locator('.toast', { hasText: 'Wall-clock animation' })
      .locator('..').locator('.timeout-indicator .embeddedProgressPath')
    await expect.poll(() => timeoutIndicator.evaluate((element) => {
      return element.getAnimations()[0]?.playbackRate
    })).toBe(1)

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.dispatch('updateReducedMotion', 'on')
    })
    await expect(slider).toBeDisabled()

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.dispatch('updateReducedMotion', 'off')
    })
    await expect(slider).toBeEnabled()
  })

  test('configures wheel scroll speed', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()

    const slider = page.getByRole('slider', { name: /Scroll Speed/ })
    await expect(slider).toHaveValue('100')
    await slider.fill('200')
    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.getters.getScrollSpeed
    })).toBe(200)

    const content = page.locator('.settingsContent')
    await content.evaluate(element => { element.scrollTop = 0 })
    await content.hover({ position: { x: 20, y: 20 } })
    await page.mouse.wheel(0, 120)
    await expect.poll(() => content.evaluate(element => element.scrollTop)).toBe(240)

    await slider.fill('50')
    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.getters.getScrollSpeed
    })).toBe(50)
    await content.evaluate(element => { element.scrollTop = 0 })
    await content.hover({ position: { x: 20, y: 20 } })
    await page.mouse.wheel(0, 120)
    await expect.poll(() => content.evaluate(element => element.scrollTop)).toBe(60)
  })

  test('keeps the watched progress mode when history is toggled', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="privacy"]').click()

    const rememberHistoryLabel = page.locator('label.switch-label')
      .filter({ hasText: 'Remember Watch History' })
    const rememberHistory = page.getByRole('checkbox', { name: 'Remember Watch History' })
    const watchedProgressMode = page.locator('.select')
      .filter({ hasText: 'Save Watched Progress' })
      .locator('select')

    await expect(rememberHistory).toBeChecked()
    await watchedProgressMode.selectOption('semi-auto')
    await rememberHistoryLabel.click()
    await expect(rememberHistory).not.toBeChecked()
    await expect(watchedProgressMode).toHaveValue('semi-auto')

    await rememberHistoryLabel.click()
    await expect(rememberHistory).toBeChecked()
    await expect(watchedProgressMode).toHaveValue('semi-auto')
  })

  test('links the public sync server privacy policy', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="sync"]').click()

    const syncSection = page.locator('[data-section="sync"]')
    await syncSection.locator('label.switch-label').filter({ hasText: 'Enable Sync' }).click()

    const privacyPolicy = syncSection.getByRole('link', {
      name: 'Privacy policy for this server'
    })

    await expect(privacyPolicy).toHaveAttribute(
      'href',
      'https://github.com/OpenTubeX/sync-server/blob/main/PRIVACY.md'
    )

    await syncSection.getByLabel('Server URL').fill('https://sync.libretube.dev')
    await expect(privacyPolicy).toHaveCount(0)
  })

  test('waits for the device name before creating a secure sync pairing code', async ({ app, page }) => {
    const serverUrl = 'https://pairing.example'
    let createdSession
    let cancelledSessionId
    let cancelledRecipientToken

    await app.electronApp.evaluate(({ ipcMain }) => {
      globalThis.__pairingDeviceNameResolvers = []
      ipcMain.removeHandler('get-device-name')
      ipcMain.handle('get-device-name', () => new Promise(resolve => {
        globalThis.__pairingDeviceNameResolvers.push(resolve)
      }))
    })

    await page.route(`${serverUrl}/**`, async route => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.pathname === '/health') {
        await route.fulfill({
          json: {
            status: 'ok',
            capabilities: { encrypted_sync: 1, key_pairing: 1 }
          }
        })
        return
      }
      if (url.pathname === '/v1/pairing' && request.method() === 'POST') {
        createdSession = request.postDataJSON()
        await route.fulfill({
          status: 201,
          json: {
            version: 1,
            id: createdSession.id,
            account_id: null,
            recipient_public_key: createdSession.recipient_public_key,
            recipient_device_id: createdSession.recipient_device_id,
            recipient_device_name: createdSession.recipient_device_name,
            approving_device_id: null,
            expires_at: Date.now() + 120_000,
            approved: false
          }
        })
        return
      }
      if (url.pathname.startsWith('/v1/pairing/') && request.method() === 'DELETE') {
        cancelledSessionId = url.pathname.split('/').at(-1)
        cancelledRecipientToken = request.headers()['x-pairing-token']
        await route.fulfill({ status: 204 })
        return
      }
      await route.fulfill({ status: 404 })
    })

    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="sync"]').click()
    const syncSection = page.locator('[data-section="sync"]')
    await syncSection.getByText('Enable Sync', { exact: true }).click()
    await syncSection.getByLabel('Server URL').fill(serverUrl)
    await syncSection.getByLabel('Server URL').press('Tab')
    const pairButton = syncSection.getByRole('button', { name: 'Pair with an existing device' })
    const loginButton = syncSection.getByRole('button', { name: 'Log in' })
    const registerButton = syncSection.getByRole('button', { name: 'Register' })
    await expect(pairButton).toBeEnabled()
    await expect(loginButton).toBeDisabled()
    await expect(registerButton).toBeDisabled()

    await pairButton.click()
    const dialog = page.getByRole('dialog', { name: 'Pair with an existing device' })
    await expect(dialog.getByLabel('Device name')).toHaveValue('This device')
    await dialog.getByRole('button', { name: 'Create pairing code' }).click()
    await app.electronApp.evaluate(() => {
      for (const resolve of globalThis.__pairingDeviceNameResolvers) resolve('Travel laptop')
      delete globalThis.__pairingDeviceNameResolvers
    })

    await expect(dialog.getByRole('img', { name: 'Pairing QR code for Travel laptop' })).toBeVisible()
    await expect(dialog.getByText('Pairing code expires at')).toBeVisible()
    expect(createdSession).toMatchObject({ version: 1, recipient_device_name: 'Travel laptop' })
    expect(createdSession.recipient_token_hash).toMatch(/^[\w-]{43}$/)
    expect(JSON.stringify(createdSession)).not.toMatch(/privacy|passphrase|password|username|jwt/i)

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.dispatch('updateUiScale', 95)
    })
    await page.setViewportSize({ width: 600, height: 420 })
    const textCodeButton = dialog.getByRole('button', { name: 'Use text code instead' })
    await expect(textCodeButton).toBeInViewport()
    await expect(dialog.locator('.promptContentScroller')).toHaveJSProperty('scrollTop', 0)
    await textCodeButton.click()
    const codeField = dialog.getByRole('textbox', { name: 'Pairing code' })
    await expect(codeField).toHaveValue(/^opentubex-pairing:/)
    await expect(codeField).toHaveAttribute('readonly', '')

    await page.setViewportSize({ width: 600, height: 300 })
    const contentScroller = dialog.locator('.promptContentScroller')
    const cancelButton = dialog.locator('.promptFixedFooter').getByRole('button', { name: 'Cancel' })
    await expect(contentScroller).toHaveAttribute('data-overlayscrollbars-viewport')
    await expect(cancelButton).toBeVisible()
    const cancelBoundsBeforeScroll = await cancelButton.boundingBox()
    await contentScroller.evaluate(element => element.scrollTo(0, element.scrollHeight))
    await expect.poll(() => contentScroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    const cancelBoundsAfterScroll = await cancelButton.boundingBox()
    expect(Math.abs(cancelBoundsAfterScroll.y - cancelBoundsBeforeScroll.y)).toBeLessThanOrEqual(1)

    await cancelButton.click()
    await expect(dialog).toHaveCount(0)
    await expect.poll(() => cancelledSessionId).toBe(createdSession.id)
    expect(cancelledRecipientToken).toMatch(/^[\w-]{43}$/)
    expect(createHash('sha256')
      .update(Buffer.from(cancelledRecipientToken, 'base64url'))
      .digest('base64url')).toBe(createdSession.recipient_token_hash)
  })

  test('keeps the sync server idle until sync is enabled', async ({ page }) => {
    const syncRequests = []
    await page.route('https://sync.d3sox.me/**', async (route) => {
      syncRequests.push(route.request().url())
      await route.fulfill({ status: 200, body: 'OK' })
    })
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="sync"]').click()

    const syncSection = page.locator('[data-section="sync"]')
    await expect(syncSection.getByLabel('Enable Sync')).not.toBeChecked()
    await expect(syncSection.getByLabel('Server URL')).toHaveCount(0)
    await page.waitForTimeout(500)
    expect(syncRequests).toEqual([])
  })

  test('switches icon packs from Theme settings and persists the choice', async ({ page, attachScreenshot }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()

    const iconPackSetting = page.locator('.select').filter({ hasText: 'Icon Pack' })
    const select = iconPackSetting.locator('select')
    await expect(select).toHaveValue('material')
    await expect(page.locator(
      '.settingsMenu [data-section="add-ons"] [data-icon="puzzle-piece"][data-icon-pack="material"]'
    )).toBeVisible()
    await expect(page.locator(
      '.settingsMenu [data-section="data"] [data-icon="box-archive"][data-icon-pack="material"]'
    )).toBeVisible()
    await attachScreenshot('material icon pack')
    await select.selectOption('remix')
    await expect(page.locator('[data-icon-pack="remix"]').first()).toBeVisible()
    await expect(page.locator(
      '.settingsMenu [data-section="add-ons"] [data-icon="puzzle-piece"][data-icon-pack="remix"]'
    )).toBeVisible()
    await expect(page.locator(
      '.settingsMenu [data-section="data"] [data-icon="box-archive"][data-icon-pack="remix"]'
    )).toBeVisible()
    await attachScreenshot('remix icon pack')

    await page.reload()
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()
    await expect(iconPackSetting.locator('select')).toHaveValue('remix')
    await expect(page.locator('[data-icon-pack="remix"]').first()).toBeVisible()
  })

  test('groups theme selects and keeps restart settings aligned', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()

    const appearance = page.locator('[data-section="appearance"]')
    const theme = appearance.locator('.settingsSection').filter({
      has: page.getByRole('heading', { name: 'Theme', exact: true })
    })
    const layout = appearance.locator('.settingsSection').filter({
      has: page.getByRole('heading', { name: 'Layout', exact: true })
    })
    const selectRows = theme.locator('.themeSelectRow')
    await expect(selectRows).toHaveCount(3)
    await expect(selectRows.nth(0).locator('.select')).toHaveCount(3)
    await expect(selectRows.nth(1).locator('.select')).toHaveCount(2)
    await expect(selectRows.nth(2).locator('.select')).toHaveCount(3)
    await expect(layout.locator('.themeSelectRow .select')).toHaveCount(1)

    const baseThemeLabel = selectRows.first().locator('.select').first().locator('.select-label')
    const alignedLabelParts = await baseThemeLabel
      .locator('.select-icon, .select-placeholder, .syncedSettingIndicator, .changedSettingIndicatorPlaceholder')
      .evaluateAll(elements => elements.map(element => {
        const bounds = element.getBoundingClientRect()
        return bounds.y + bounds.height / 2
      }))
    expect(Math.max(...alignedLabelParts) - Math.min(...alignedLabelParts)).toBeLessThanOrEqual(1)

    const switchPositions = await Promise.all([
      'Expand Side Bar by Default',
      'Disable Smooth Scrolling',
      'Always Show Scrollbars'
    ].map(label => page.getByRole('checkbox', { name: label }).boundingBox()))
    const switchX = switchPositions.map(position => position.x)
    expect(Math.max(...switchX) - Math.min(...switchX)).toBeLessThanOrEqual(1)
  })

  test('stacks tab layout controls evenly in a narrow settings window', async ({ app, page }) => {
    await setWindowSize(app, page, { width: 720, height: 700 })
    const appearance = await goToSettingsSection(page, 'appearance')

    const tabLayout = appearance.locator('.themeSelectRow').filter({ hasText: 'Tab Layout' })
    const tabWidth = appearance.locator('.ft-flex-box').filter({
      has: page.getByRole('slider', { name: /Tab Width/ })
    }).locator('.switchColumn')
    const loadIcons = appearance.getByRole('button', { name: 'Load Missing Tab Icons' })
    const centerDifference = async () => {
      const centers = await Promise.all([tabLayout, tabWidth, loadIcons].map(async locator => {
        const bounds = await locator.boundingBox()
        return bounds.x + bounds.width / 2
      }))
      return Math.max(...centers) - Math.min(...centers)
    }

    expect(await centerDifference()).toBeLessThanOrEqual(3)
    for (const viewport of [
      { width: 375, height: 667 },
      { width: 667, height: 375 },
    ]) {
      await page.setViewportSize(viewport)
      expect(await centerDifference()).toBeLessThanOrEqual(3)
    }

    await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))
    await page.setViewportSize({ width: 667, height: 375 })
    expect(await centerDifference()).toBeLessThanOrEqual(3)
  })

  test('keeps the current icon pack when another pack fails to load', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()

    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.evaluate(() => {
      const appendChild = document.head.appendChild.bind(document.head)
      document.head.appendChild = element => {
        if (element instanceof HTMLScriptElement) {
          queueMicrotask(() => element.dispatchEvent(new Event('error')))
          return element
        }
        return appendChild(element)
      }
    })

    const select = page.locator('.select').filter({ hasText: 'Icon Pack' }).locator('select')
    const loadFailure = page.waitForEvent('console', message => (
      message.type() === 'error' && message.text().includes('[icon-pack] failed to load remix')
    ))
    await select.selectOption('remix')
    await loadFailure
    expect(errors).toEqual([])
    await expect(select).toHaveValue('material')

    await page.reload()
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()
    await expect(select).toHaveValue('material')
  })

  test('a toggled setting persists across restarts', async ({ app }) => {
    let page = app.page
    await goTo(page, 'settings')

    const toggle = page.getByRole('checkbox', { name: 'Check for Updates' })
    await expect(toggle).not.toBeChecked()
    // The styled label covers the checkbox input, so click that instead.
    await page.locator('label.switch-label').filter({ hasText: 'Check for Updates' }).click()
    await expect(toggle).toBeChecked()
    // Give nedb a moment to flush the write.
    await page.waitForTimeout(1000)

    ;({ page } = await app.relaunch())
    await goTo(page, 'settings')
    await expect(page.getByRole('checkbox', { name: 'Check for Updates' })).toBeChecked()
  })

  test('highlights changed settings and resets them to defaults', async ({ page, attachScreenshot }) => {
    await goTo(page, 'settings')

    const autoLoadToggle = page.getByRole('checkbox', { name: /Auto Load Next Page/i })
    await page.locator('label.switch-label').filter({ hasText: 'Auto Load Next Page' }).click()
    await expect(autoLoadToggle).not.toBeChecked()

    const autoLoadSetting = page.locator('.switch-ctn').filter({ has: autoLoadToggle })
    const resetButton = autoLoadSetting.getByRole('button', { name: 'Reset this setting to its default' })
    await expect(resetButton).toBeVisible()
    await expect(autoLoadSetting).toHaveCSS('border-left-width', '3px')
    await attachScreenshot('highlighted changed setting')

    await resetButton.click()
    await expect(autoLoadToggle).toBeChecked()
    await expect(resetButton).toHaveCount(0)
  })

  test('resets the composite thumbnail preference to its displayed default', async ({ page }) => {
    const appearance = await goToSettingsSection(page, 'appearance')
    const setting = appearance.locator('.select').filter({
      has: page.getByRole('combobox', { name: 'Thumbnail Preference' })
    })
    const select = setting.locator('select')

    await select.selectOption('blur')
    await expect(select).toHaveValue('blur')

    const resetButton = setting.getByRole('button', {
      name: 'Reset this setting to its default'
    })
    await expect(resetButton).toBeVisible()
    await resetButton.click()

    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return {
        blurThumbnails: store.getters.getBlurThumbnails,
        thumbnailPreference: store.getters.getThumbnailPreference
      }
    })).toEqual({ blurThumbnails: false, thumbnailPreference: '' })
    await expect(select).toHaveValue('')
    await expect(resetButton).toHaveCount(0)
  })

  test('turns thumbnail hover previews off from appearance settings', async ({ page }) => {
    const appearance = await goToSettingsSection(page, 'appearance')
    const toggle = appearance.getByRole('checkbox', { name: 'Show thumbnail previews' })

    const getCenterOffset = () => toggle.locator('..').evaluate(element => {
      const setting = element.getBoundingClientRect()
      const content = element.closest('.sectionBody').getBoundingClientRect()
      return Math.abs(
        setting.left + setting.width / 2 -
        (content.left + content.width / 2)
      )
    })
    expect(await getCenterOffset()).toBeLessThanOrEqual(1)

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateUiScale', 95)
    })
    await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBeCloseTo(0.95, 2)
    expect(await getCenterOffset()).toBeLessThanOrEqual(1)

    await expect(toggle).toBeChecked()
    await appearance.locator('label.switch-label')
      .filter({ hasText: 'Show thumbnail previews' })
      .click()
    await expect(toggle).not.toBeChecked()
    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.getters.getShowThumbnailPreviews
    })).toBe(false)
  })

  test('highlights changed backend fallback and deep-link settings', async ({ page }) => {
    await goTo(page, 'settings')

    for (const { section, name } of [{
      section: 'advanced',
      name: /non-preferred backend/i
    }, {
      section: 'general',
      name: /Open URLs Passed to OpenTubeX in a New Window/i
    }]) {
      await goToSettingsSection(page, section)
      const toggle = page.getByRole('checkbox', { name })
      const setting = page.locator('.switch-ctn').filter({ has: toggle })
      await setting.locator('label.switch-label').click()
      await expect(setting.getByRole('button', {
        name: 'Reset this setting to its default'
      })).toBeVisible()
      await expect(setting).toHaveCSS('border-left-width', '3px')
    }
  })

  test('highlights and resets caption appearance settings individually', async ({ page }) => {
    await goTo(page, 'settings')

    await page.locator('.settingsMenu [data-section="playback"]').click()

    await expect(page.locator('.captionSettings')).toHaveCSS('user-select', 'none')
    for (const captionControl of await page.locator('.captionControl').all()) {
      await expect(captionControl).toHaveCSS('border-width', '0px')
    }
    await expect(page.locator('.captionActions')).toHaveCSS('border-top-width', '0px')

    const resetCaptionAppearance = page.getByRole('button', {
      name: 'Reset Caption Appearance',
      exact: true
    })
    await expect(resetCaptionAppearance).toBeDisabled()
    const [captionActionsBounds, resetCaptionAppearanceBounds] = await Promise.all([
      page.locator('.captionActions').boundingBox(),
      resetCaptionAppearance.boundingBox()
    ])
    expect(resetCaptionAppearanceBounds.x + resetCaptionAppearanceBounds.width / 2)
      .toBeCloseTo(captionActionsBounds.x + captionActionsBounds.width / 2, 0)

    const backgroundOpacity = page.getByRole('slider', { name: /Background Opacity/ })
    await backgroundOpacity.fill('50')
    await expect(resetCaptionAppearance).toBeEnabled()

    const changedControl = page.locator('.pure-material-slider')
      .filter({ has: backgroundOpacity })
    const resetButton = changedControl.getByRole('button', {
      name: 'Reset this setting to its default'
    })

    await expect(resetButton).toBeVisible()
    await expect(changedControl).toHaveCSS('border-left-width', '3px')
    await expect(page.locator('.captionControls').getByRole('button', {
      name: 'Reset this setting to its default'
    })).toHaveCount(1)

    await resetButton.click()
    await expect(backgroundOpacity).toHaveValue('80')
    await expect(resetButton).toHaveCount(0)
    await expect(resetCaptionAppearance).toBeDisabled()
  })

  test('highlights and resets SponsorBlock category values individually', async ({ page }) => {
    await goTo(page, 'settings')

    await page.locator('.settingsMenu [data-section="add-ons"]').click()
    await page.locator('label.switch-label')
      .filter({ hasText: 'Enable SponsorBlock' })
      .click()

    const sponsorCategory = page.locator('.sponsorBlockCategory')
      .filter({ has: page.locator('.sponsorTitle', { hasText: /^Sponsor$/ }) })
    const color = sponsorCategory.locator('select').nth(0)
    const skipOption = sponsorCategory.locator('select').nth(1)

    await color.selectOption('Red')

    const resetButton = sponsorCategory.getByRole('button', {
      name: 'Reset this setting to its default'
    })
    await expect(resetButton).toHaveCount(1)
    await expect(color).toHaveValue('Red')
    await expect(skipOption).toHaveValue('autoSkip')

    await resetButton.click()
    await expect(color).toHaveValue('Green')
    await expect(skipOption).toHaveValue('autoSkip')
    await expect(resetButton).toHaveCount(0)

    await skipOption.selectOption('promptToSkip')
    await expect(resetButton).toHaveCount(1)
    await resetButton.click()
    await expect(color).toHaveValue('Green')
    await expect(skipOption).toHaveValue('autoSkip')
    await expect(resetButton).toHaveCount(0)
  })

  test('positions toasts and dismisses them towards the configured edge', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()

    const themeSection = page.locator('[data-section="appearance"]')
    const positionSelect = themeSection.locator('.select')
      .filter({ hasText: 'Toast Position' })
      .locator('select')
    const holder = page.locator('.toast-holder')

    async function showToast (message) {
      await page.evaluate((text) => {
        window.ftElectron.showToastOnAllTabs(text, 10000)
      }, message)

      const toast = holder.locator('.toast', { hasText: message })
      await expect(toast).toBeVisible()
      await expect(toast).toHaveCSS('transform', 'none')
      await expect(toast.locator('..')).toHaveCSS('transform', 'none')
      // The drain waits out the enter transition and then uses up the rest of
      // the toast's lifetime, so it empties just as the toast is dismissed
      await expect(
        toast.locator('..').locator('.timeout-indicator .embeddedProgressPath')
      ).toHaveCSS('animation-duration', '9.7s')
      await expect(
        toast.locator('..').locator('.timeout-indicator .embeddedProgressPath')
      ).toHaveCSS('animation-delay', '0.3s')
      // The row a toast sits in slides it into place, so let that settle before
      // anything measures where the toast ended up
      await page.waitForTimeout(400)
      return toast
    }

    async function expectToastInset (toast, edge, inset) {
      const bounds = await toast.boundingBox()
      const viewport = await viewportSize()

      if (edge === 'top') {
        expect(bounds.y).toBeCloseTo(inset, 0)
      } else {
        expect(viewport.height - (bounds.y + bounds.height)).toBeCloseTo(inset, 0)
      }
    }

    async function dragToast (toast, distance) {
      const bounds = await toast.boundingBox()
      const x = distance < 0
        ? bounds.x + bounds.width - 5
        : bounds.x + 5
      const y = bounds.y + bounds.height / 2

      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x + distance, y, { steps: 5 })

      // The timeout indicator has to follow the toast as it is dragged
      const indicatorTrack = toast.locator('..').locator('.timeout-indicator-track')
      const [draggedBounds, indicatorBounds] = await Promise.all([
        toast.boundingBox(),
        indicatorTrack.boundingBox()
      ])
      expect(indicatorBounds.x).toBeCloseTo(draggedBounds.x, 0)
      expect(indicatorBounds.y).toBeCloseTo(draggedBounds.y, 0)

      // A drag is dismissed on distance or on speed, so hold still for a moment
      // to keep these deliberate drags out of the flick-to-dismiss range
      await page.waitForTimeout(300)
    }

    function viewportSize () {
      return page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight
      }))
    }

    const dismissDragDistance = 120

    await positionSelect.selectOption('bottom-left')
    await expect(holder).toHaveClass(/position-bottom-left/)
    let toast = await showToast('Left toast')
    let bounds = await toast.boundingBox()
    expect(bounds.x).toBeLessThan(50)
    await expectToastInset(toast, 'bottom', 29)
    await dragToast(toast, dismissDragDistance)
    await page.mouse.up()
    await expect(toast).toBeVisible()
    await expect.poll(async () => (await toast.boundingBox()).x).toBeCloseTo(bounds.x, 0)
    await dragToast(toast, -dismissDragDistance)
    await page.mouse.up()
    await expect(toast).toHaveCount(0)

    await positionSelect.selectOption('bottom-center')
    await expect(holder).toHaveClass(/position-bottom-center/)
    toast = await showToast('Center toast dragged left')
    bounds = await toast.boundingBox()
    let viewport = await viewportSize()
    expect(bounds.x + bounds.width / 2).toBeCloseTo(viewport.width / 2, 0)
    await dragToast(toast, -dismissDragDistance)
    await page.mouse.up()
    await expect(toast).toHaveCount(0)

    toast = await showToast('Center toast dragged right')
    await dragToast(toast, dismissDragDistance)
    await page.mouse.up()
    await expect(toast).toHaveCount(0)

    await positionSelect.selectOption('bottom-right')
    await expect(holder).toHaveClass(/position-bottom-right/)
    toast = await showToast('Right toast')
    bounds = await toast.boundingBox()
    viewport = await viewportSize()
    expect(bounds.x + bounds.width).toBeGreaterThan(viewport.width - 50)
    await dragToast(toast, -dismissDragDistance)
    await page.mouse.up()
    await expect(toast).toBeVisible()
    await expect.poll(async () => (await toast.boundingBox()).x).toBeCloseTo(bounds.x, 0)
    await dragToast(toast, dismissDragDistance)
    await page.mouse.up()
    await expect(toast).toHaveCount(0)

    await positionSelect.selectOption('top-left')
    await expect(holder).toHaveClass(/position-top-left/)
    toast = await showToast('Top left toast')
    bounds = await toast.boundingBox()
    expect(bounds.x).toBeLessThan(50)
    // Below the horizontal tab bar
    await expectToastInset(toast, 'top', 61)
    await dragToast(toast, -dismissDragDistance)
    await page.mouse.up()
    await expect(toast).toHaveCount(0)

    await positionSelect.selectOption('top-center')
    await expect(holder).toHaveClass(/position-top-center/)
    toast = await showToast('Top center toast')
    bounds = await toast.boundingBox()
    viewport = await viewportSize()
    expect(bounds.x + bounds.width / 2).toBeCloseTo(viewport.width / 2, 0)
    await dragToast(toast, dismissDragDistance)
    await page.mouse.up()
    await expect(toast).toHaveCount(0)

    await positionSelect.selectOption('bottom-right')
    await positionSelect.selectOption('top-right')
    await expect(holder).toHaveClass(/position-top-right/)
    toast = await showToast('Top right toast')
    bounds = await toast.boundingBox()
    viewport = await viewportSize()
    expect(bounds.x + bounds.width).toBeGreaterThan(viewport.width - 50)
    await dragToast(toast, dismissDragDistance)
    await page.mouse.up()
    await expect(toast).toHaveCount(0)
  })

  test('shows a test toast from the toast position setting', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()

    const themeSection = page.locator('[data-section="appearance"]')
    const toastPositionRow = themeSection.locator('.themeSelectRow')
      .filter({ hasText: 'Toast Position' })
    const positionSelect = toastPositionRow.locator('.select')
      .filter({ hasText: 'Toast Position' })
      .locator('select')
    const holder = page.locator('.toast-holder')

    await positionSelect.selectOption('top-right')
    await toastPositionRow.getByRole('button', { name: 'Test toast' }).click()

    await expect(holder).toHaveClass(/position-top-right/)
    await expect(holder.locator('.toast', { hasText: 'Test toast' })).toBeVisible()
  })

  test('honors the configured toast position on Android phones', async ({ app, page }) => {
    const phoneSafeArea = { top: 24, bottom: 16 }
    const layoutTolerance = 0.05
    await setWindowSize(app, page, { width: 375, height: 700 })
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()
    await page.locator('.app').evaluate((element, safeArea) => {
      document.documentElement.style.setProperty('--safe-area-inset-top', `${safeArea.top}px`)
      document.documentElement.style.setProperty('--safe-area-inset-bottom', `${safeArea.bottom}px`)
      element.classList.remove('topTabs', 'bottomTabs', 'verticalTabs', 'verticalTabsLeft', 'verticalTabsRight')
      element.classList.add('capacitorTabs', 'capacitorPhoneLayout')
    }, phoneSafeArea)

    const positionSelect = page.locator('[data-section="appearance"] .select')
      .filter({ hasText: 'Toast Position' })
      .locator('select')
    const holder = page.locator('.toast-holder')
    const progressToast = page.getByTestId('progress-toast')

    async function viewportSize () {
      return page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight
      }))
    }

    async function preparePhoneEdge (edge) {
      // Electron needs a non-horizontal tab position to match Capacitor's 29px
      // base inset. Keep that desktop tab on the edge opposite the one under
      // test so it cannot affect the toast's horizontal alignment.
      await page.evaluate((tabBarPosition) => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setTabBarPosition', tabBarPosition)
      }, edge === 'bottom' ? 'right' : 'left')
      await expect(holder).not.toHaveClass(/horizontal-tabs/)
      // Updating the desktop tab position also refreshes `.app`'s responsive
      // classes. Reapply the Capacitor fixture after that update has landed.
      await page.locator('.app').evaluate((element) => {
        element.classList.remove('topTabs', 'bottomTabs', 'verticalTabs', 'verticalTabsLeft', 'verticalTabsRight')
        element.classList.add('capacitorTabs', 'capacitorPhoneLayout')
      })
      await expect(page.locator('.app')).toHaveClass(/capacitorPhoneLayout/)
      const progressBounds = await progressToast.count() === 1
        ? await progressToast.boundingBox()
        : null
      const progressInset = progressBounds ? progressBounds.height + 10 : 0
      const expectedOffset = 29 + progressInset
      // Layout rounds fractional CSS pixels differently from computed values.
      await expect.poll(() => holder.evaluate((element, { edge, expectedOffset }) => {
        const style = getComputedStyle(element)
        return Math.max(
          Math.abs(Number.parseFloat(style.getPropertyValue(`--offset-${edge}`)) - expectedOffset),
          Math.abs(Number.parseFloat(style.getPropertyValue(`--mobile-offset-${edge}`)) - expectedOffset)
        )
      }, { edge, expectedOffset })).toBeLessThan(layoutTolerance)
      return progressInset
    }

    async function expectBottomLeftToast (message) {
      await positionSelect.selectOption('bottom-left')
      await expect(holder).toHaveClass(/position-bottom-left/)
      const progressInset = await preparePhoneEdge('bottom')
      await page.evaluate((text) => {
        window.ftElectron.showToastOnAllTabs(text, 10000)
      }, message)
      const toast = page.locator('.toast', { hasText: message })
      const row = page.locator('[data-sonner-toast]', { hasText: message })
      await expect(toast).toBeVisible()
      await expect(row).toHaveAttribute('data-mounted', 'true')
      await page.waitForTimeout(400)
      const [bounds, viewport] = await Promise.all([
        toast.boundingBox(),
        viewportSize()
      ])
      expect.soft(bounds.x).toBeLessThan(30)
      expect.soft(viewport.height - bounds.y - bounds.height)
        .toBeCloseTo(72 + phoneSafeArea.bottom + progressInset, 1)
      if (await progressToast.count() === 1) {
        const progressBounds = await progressToast.boundingBox()
        expect(bounds.y + bounds.height).toBeLessThan(progressBounds.y)
      }
      await row.focus()
      await page.keyboard.press('Escape')
      await expect(toast).toHaveCount(0)
    }

    async function expectTopRightToast (message) {
      await positionSelect.selectOption('top-right')
      await expect(holder).toHaveClass(/position-top-right/)
      const progressInset = await preparePhoneEdge('top')
      await page.evaluate((text) => {
        window.ftElectron.showToastOnAllTabs(text, 10000)
      }, message)
      const toast = page.locator('.toast', { hasText: message })
      const row = page.locator('[data-sonner-toast]', { hasText: message })
      await expect(toast).toBeVisible()
      await expect(row).toHaveAttribute('data-mounted', 'true')
      await page.waitForTimeout(400)
      const [bounds, topNavBounds, viewport] = await Promise.all([
        toast.boundingBox(),
        page.locator('.topNav').boundingBox(),
        viewportSize()
      ])
      expect.soft(bounds.x + bounds.width).toBeGreaterThan(viewport.width - 30)
      expect.soft(bounds.y).toBeGreaterThanOrEqual(topNavBounds.y + topNavBounds.height + 12 + progressInset - layoutTolerance)
      expect.soft(bounds.y).toBeLessThan(viewport.height / 2)
      if (await progressToast.count() === 1) {
        const progressBounds = await progressToast.boundingBox()
        expect(bounds.y).toBeGreaterThan(progressBounds.y + progressBounds.height)
      }
      await row.focus()
      await page.keyboard.press('Escape')
      await expect(toast).toHaveCount(0)
    }

    await expectBottomLeftToast('Android phone bottom-left toast')
    await expectTopRightToast('Android phone top-right toast')
    await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))
    await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBeCloseTo(1.25, 2)
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setProgressBarMessage', 'Phone progress toast')
      store.commit('setProgressBarPercentage', 50)
      store.commit('setShowProgressBar', true)
    })
    await expect(progressToast).toBeVisible()

    await expectBottomLeftToast('Scaled Android phone bottom-left toast')
    await expectTopRightToast('Scaled Android phone top-right toast')
  })

  test('keeps top toasts below the Android tablet app header', async ({ app, page }) => {
    await setWindowSize(app, page, { width: 375, height: 700 })
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()
    await page.locator('.app').evaluate((app) => {
      app.classList.add('capacitorTabletLayout', 'topTabs')
      app.style.setProperty('--top-tab-bar-height', '48px')
    })

    const themeSection = page.locator('[data-section="appearance"]')
    const toastPositionRow = themeSection.locator('.themeSelectRow')
      .filter({ hasText: 'Toast Position' })
    await toastPositionRow.locator('.select')
      .filter({ hasText: 'Toast Position' })
      .locator('select')
      .selectOption('top-left')
    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('Earlier tablet toast', 10000)
    })
    await toastPositionRow.getByRole('button', { name: 'Test toast' }).click()

    const toast = page.locator('.toast', { hasText: 'Test toast' })
    const earlierToast = page.locator('.toast', { hasText: 'Earlier tablet toast' })
    await expect(toast).toBeVisible()
    await expect(earlierToast).toBeVisible()
    await expect(toast).toHaveCSS('transform', 'none')
    await page.waitForTimeout(400)

    async function expectHeaderClearance() {
      const [toastBounds, earlierToastBounds, headerBounds] = await Promise.all([
        toast.boundingBox(),
        earlierToast.boundingBox(),
        page.locator('.topNav').boundingBox()
      ])
      expect(headerBounds.y).toBeCloseTo(48, 1)
      expect(headerBounds.height).toBeCloseTo(60, 1)
      const headerClearance = headerBounds.y + headerBounds.height + 12
      expect(toastBounds.y).toBeCloseTo(headerClearance, 1)
      expect(earlierToastBounds.y).toBeGreaterThanOrEqual(headerClearance)
    }

    await expectHeaderClearance()
    await setWindowSize(app, page, { width: 700, height: 375 })
    await expectHeaderClearance()
    await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))
    await expectHeaderClearance()
  })

  test('does not dismiss non-actionable toasts when clicked', async ({ page }) => {
    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('Swipe-only dismissal', 10000)
    })

    const toast = page.locator('.toast', { hasText: 'Swipe-only dismissal' })
    await expect(toast).toBeVisible()
    await expect(toast).not.toHaveAttribute('tabindex')

    await toast.click()
    await expect(toast).toBeVisible()

    const bounds = await toast.boundingBox()
    await page.mouse.move(bounds.x + bounds.width - 5, bounds.y + bounds.height / 2)
    await page.mouse.down()
    await page.mouse.move(bounds.x - 120, bounds.y + bounds.height / 2, { steps: 5 })
    await page.mouse.up()
    await expect(toast).toHaveCount(0)
  })

  test('configures the toast timeout indicator and pauses toasts on hover', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()

    const themeSection = page.locator('[data-section="appearance"]')
    const indicatorToggle = themeSection.getByRole('checkbox', { name: 'Show toast timeout indicator' })
    await expect(indicatorToggle).toBeChecked()
    await expect(themeSection.getByRole('checkbox', { name: 'Show Tab Icons' })).toBeVisible()
    await expect(page.locator('[data-section="general"]').getByRole('checkbox', {
      name: /Show (toast timeout indicator|Tab Icons)/
    })).toHaveCount(0)

    await page.mouse.move(800, 300)
    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('Hover toast', 2000)
    })

    const toast = page.locator('.toast', { hasText: 'Hover toast' })
    const indicator = toast.locator('..').locator('.timeout-indicator .embeddedProgressPath')

    /**
     * Reported as a list so a failure says which animations were on the element
     * and what state they were in, instead of just "expected paused".
     */
    function indicatorStates (locator) {
      return locator.evaluate((element) => {
        return element.getAnimations().map(animation => [
          animation.animationName ?? animation.transitionProperty ?? animation.constructor.name,
          animation.playState,
        ].join(':'))
      })
    }

    await toast.hover()
    await expect.poll(() => indicatorStates(indicator)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^toast-timeout[\w-]*:paused$/),
    ]))
    await page.waitForTimeout(2200)
    await expect(toast).toBeVisible()

    await page.mouse.move(800, 300)
    await expect(toast).toHaveCount(0)

    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('Dragged hover toast', 2000)
    })
    const draggedToast = page.locator('.toast', { hasText: 'Dragged hover toast' })
    const draggedToastBounds = await draggedToast.boundingBox()
    await page.mouse.move(
      draggedToastBounds.x + draggedToastBounds.width / 2,
      draggedToastBounds.y + draggedToastBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(
      draggedToastBounds.x + draggedToastBounds.width / 2 + 40,
      draggedToastBounds.y + draggedToastBounds.height / 2
    )
    await page.mouse.up()
    await page.mouse.move(800, 300)
    await expect(draggedToast).toHaveCount(0)

    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('First alternating toast', 2000)
      window.ftElectron.showToastOnAllTabs('Second alternating toast', 2000)
    })
    const firstAlternatingToast = page.locator('.toast', { hasText: 'First alternating toast' })
    const secondAlternatingToast = page.locator('.toast', { hasText: 'Second alternating toast' })
    const firstIndicator = firstAlternatingToast.locator('..').locator('.timeout-indicator .embeddedProgressPath')
    const secondIndicator = secondAlternatingToast.locator('..').locator('.timeout-indicator .embeddedProgressPath')
    await page.waitForTimeout(400)

    // The stack is collapsed until it is hovered, so the toasts behind the front
    // one are only reachable once hovering the front one has fanned it out
    await secondAlternatingToast.hover()

    // Hovering anywhere in the stack holds every toast in it, so moving between
    // two toasts must not let either of them resume in between
    await expect.poll(() => indicatorStates(firstIndicator)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^toast-timeout[\w-]*:paused$/),
    ]))
    await firstAlternatingToast.hover()
    await page.waitForTimeout(300)
    await secondAlternatingToast.hover()
    await expect(indicatorStates(secondIndicator)).resolves.toEqual(expect.arrayContaining([
      expect.stringMatching(/^toast-timeout[\w-]*:paused$/),
    ]))

    // Both toasts outlive their two second lifetime while the stack is held
    await page.waitForTimeout(2200)
    await expect(firstAlternatingToast).toBeVisible()
    await expect(secondAlternatingToast).toBeVisible()

    await page.mouse.move(800, 300)
    await expect(firstAlternatingToast).toHaveCount(0)
    await expect(secondAlternatingToast).toHaveCount(0)

    await page.locator('label.switch-label')
      .filter({ hasText: 'Show toast timeout indicator' })
      .click()
    await expect(indicatorToggle).not.toBeChecked()

    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('No indicator toast', 2000)
    })
    const toastWithoutIndicator = page.locator('.toast', { hasText: 'No indicator toast' })
    const toastWithoutIndicatorSlot = toastWithoutIndicator.locator('..')
    await toastWithoutIndicator.hover()
    await expect(toastWithoutIndicatorSlot.locator('.timeout-indicator')).toHaveCount(0)
    await page.waitForTimeout(2200)
    await expect(toastWithoutIndicator).toBeVisible()

    await page.mouse.move(800, 300)
    await expect(toastWithoutIndicator).toHaveCount(0)
  })

  test('shows two toasts at a glance with the rest piled behind', async ({ page }) => {
    await page.mouse.move(800, 300)
    await page.evaluate(() => {
      for (const name of ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon']) {
        window.ftElectron.showToastOnAllTabs(`${name} toast`, 30000)
      }
    })
    await expect(page.locator('.toast', { hasText: 'Epsilon toast' })).toBeVisible()
    await page.waitForTimeout(700)

    function drawn () {
      return page.locator('[data-sonner-toast]').evaluateAll((rows) => {
        return rows.filter(row => getComputedStyle(row).opacity !== '0').length
      })
    }

    function readable () {
      return page.locator('.toast').evaluateAll((toasts) => {
        return toasts.filter((toast) => {
          return getComputedStyle(toast.querySelector('.message')).opacity !== '0'
        }).length
      })
    }

    // Collapsed, the two newest toasts can be read and the rest are drawn behind
    // them as cards with nothing on them, so a full stack still looks like more
    // than a couple of toasts do
    await expect.poll(readable).toBe(2)
    await expect.poll(drawn).toBe(5)

    // Each of those peeks out past the one in front of it, or the pile would be
    // hidden behind the toasts and there would be no sign of it
    const tops = await page.locator('.toast').evaluateAll((toasts) => {
      return toasts.map(toast => Math.round(toast.getBoundingClientRect().top))
    })
    expect(new Set(tops).size).toBe(tops.length)

    // They all become readable on hover
    await page.locator('.toast', { hasText: 'Epsilon toast' }).hover()
    await expect.poll(readable).toBe(5)

    await page.mouse.move(800, 300)
    await expect.poll(readable).toBe(2)
  })

  test('does not rewrap an indefinite toast while transient toasts leave the stack', async ({ page }) => {
    await page.mouse.move(800, 300)
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('opentubex:preview-managed-tools-update', {
        detail: ['yt-dlp', 'ffmpeg']
      }))
    })

    const updateToast = page.locator('.toast', { hasText: 'An update is available for yt-dlp and ffmpeg.' })
    const updateMessage = updateToast.locator('.message')
    await expect(updateToast).toBeVisible()
    const initialSize = await updateMessage.evaluate(element => ({
      width: element.offsetWidth,
      height: element.offsetHeight
    }))

    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('First short-lived toast', 800)
      window.ftElectron.showToastOnAllTabs('Second short-lived toast', 1000)
      window.ftElectron.showToastOnAllTabs('Third short-lived toast', 1200)
      window.ftElectron.showToastOnAllTabs('Fourth short-lived toast', 1400)
    })
    await expect(page.locator('.toast', { hasText: 'Fourth short-lived toast' })).toBeVisible()

    const sizes = await updateMessage.evaluate((element) => {
      const samples = []
      const start = performance.now()
      return new Promise((resolve) => {
        function sample () {
          samples.push({ width: element.offsetWidth, height: element.offsetHeight })
          if (performance.now() - start < 2200) {
            requestAnimationFrame(sample)
          } else {
            resolve(samples)
          }
        }
        requestAnimationFrame(sample)
      })
    })

    expect(new Set(sizes.map(({ width }) => width))).toEqual(new Set([initialSize.width]))
    expect(new Set(sizes.map(({ height }) => height))).toEqual(new Set([initialSize.height]))
    await expect(updateToast).toBeVisible()
  })

  test('keeps indefinite toast actions after the transient toast limit is exceeded', async ({ page }) => {
    await page.mouse.move(800, 300)
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('opentubex:preview-managed-tools-update', {
        detail: ['yt-dlp', 'ffmpeg']
      }))
      for (let index = 0; index < 8; index++) {
        window.ftElectron.showToastOnAllTabs(`Transient toast ${index}`, 600)
      }
    })

    const updateToast = page.locator('.toast', { hasText: 'An update is available for yt-dlp and ffmpeg.' })
    await expect(updateToast).toBeVisible()
    await expect(updateToast.locator('.timeout-indicator-track')).toHaveCount(0)
    await expect(updateToast).toHaveCSS('background-color', 'rgb(28, 28, 28)')

    await page.waitForTimeout(1200)
    await expect(updateToast).toBeVisible()
    await updateToast.getByRole('button', { name: 'Cancel' }).click()
    await expect(updateToast).toHaveCount(0)

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('opentubex:preview-managed-tools-update', {
        detail: ['yt-dlp']
      }))
    })
    const singleToolToast = page.locator('.toast', { hasText: 'An update is available for yt-dlp.' })
    await expect(singleToolToast).toBeVisible()
    await singleToolToast.getByRole('button', { name: 'Update' }).click()
    await expect(singleToolToast).toHaveCount(0)
  })

  test('keeps the stack fanned out while the pointer moves between toasts', async ({ page }) => {
    await page.mouse.move(800, 300)
    await page.evaluate(() => {
      // Deliberately mismatched widths: the toasts are only as wide as their
      // message, so consecutive ones do not line up
      window.ftElectron.showToastOnAllTabs('Alpha toast that is a great deal wider than the others around it', 30000)
      window.ftElectron.showToastOnAllTabs('Beta', 30000, ['fas', 'eye'])
      window.ftElectron.showToastOnAllTabs('Gamma toast of a middling sort of width', 30000)
    })
    await expect(page.locator('.toast', { hasText: 'Gamma toast' })).toBeVisible()
    await page.waitForTimeout(700)

    const betaToast = page.locator('.toast', { hasText: 'Beta' })
    const { trailingSpace, paddingEnd } = await betaToast.evaluate((toast) => {
      const toastBounds = toast.getBoundingClientRect()
      const messageBounds = toast.querySelector('.message').getBoundingClientRect()

      return {
        trailingSpace: toastBounds.right - messageBounds.right,
        paddingEnd: Number.parseFloat(getComputedStyle(toast).paddingInlineEnd),
      }
    })
    expect(Math.abs(trailingSpace - paddingEnd)).toBeLessThanOrEqual(1)

    const rows = page.locator('[data-sonner-toast]')
    await expect(rows.first()).toHaveAttribute('data-expanded', 'false')

    await page.locator('.toast', { hasText: 'Gamma toast' }).hover()
    await expect(rows.first()).toHaveAttribute('data-expanded', 'true')

    const centres = await page.locator('.toast').evaluateAll((elements) => {
      return elements
        .map((element) => {
          const { x, y, width, height } = element.getBoundingClientRect()
          return { x: x + width / 2, y: y + height / 2 }
        })
        .sort((a, b) => b.y - a.y)
    })

    // Walking from one toast to the next must never drop out of the stack, or
    // it collapses under the pointer and immediately reopens
    for (let index = 1; index < centres.length; index++) {
      const from = centres[index - 1]
      const to = centres[index]

      for (let step = 1; step <= 12; step++) {
        await page.mouse.move(
          from.x + (to.x - from.x) * step / 12,
          from.y + (to.y - from.y) * step / 12
        )
        await expect(rows.first()).toHaveAttribute('data-expanded', 'true')
      }
    }

    // and it lets go once the pointer is clear of the toasts, rather than
    // holding on across the width of the window
    const widest = Math.max(...(await page.locator('.toast').evaluateAll((elements) => {
      return elements.map(element => element.getBoundingClientRect().right)
    })))
    await page.mouse.move(widest + 120, centres[0].y)
    await expect(rows.first()).toHaveAttribute('data-expanded', 'false')

    await page.mouse.move(800, 300)
    await expect(rows.first()).toHaveAttribute('data-expanded', 'false')
  })

  test('dismisses a toast with the keyboard', async ({ page }) => {
    await page.mouse.move(800, 300)
    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('Keyboard toast', 30000)
    })

    const toast = page.locator('.toast', { hasText: 'Keyboard toast' })
    await expect(toast).toBeVisible()
    await page.waitForTimeout(500)

    // A toast without an action is not focusable itself, so the row it sits in
    // is what a user reaches, both through the toaster's hotkey and by tabbing
    await expect(toast).not.toHaveAttribute('tabindex')
    await page.locator('[data-sonner-toast]').filter({ hasText: 'Keyboard toast' }).focus()
    await page.keyboard.press('Escape')

    await expect(toast).toHaveCount(0)
  })

  test('reflows smoothly when a toast in the middle of the stack is dismissed', async ({ page }) => {
    await page.mouse.move(800, 300)
    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('Alpha toast', 30000)
      window.ftElectron.showToastOnAllTabs('Beta toast', 30000)
      window.ftElectron.showToastOnAllTabs('Gamma toast', 30000)
      window.ftElectron.showToastOnAllTabs('Delta toast', 30000)
    })
    await expect(page.locator('.toast', { hasText: 'Delta toast' })).toBeVisible()
    await page.waitForTimeout(700)

    await page.locator('.toast', { hasText: 'Delta toast' }).hover()
    await expect(page.locator('[data-sonner-toast]').first()).toHaveAttribute('data-expanded', 'true')
    await page.waitForTimeout(400)

    // Resting on the toast that is about to go: once it stops taking input the
    // pointer is left over nothing, which is what collapses the stack
    await page.locator('.toast', { hasText: 'Beta toast' }).hover()
    await page.waitForTimeout(200)

    const alphaStart = (await page.locator('.toast', { hasText: 'Alpha toast' }).boundingBox()).y

    // Dismiss a toast from the middle of the stack where it stands, the way one
    // that has simply run out of time goes, and follow the stack closing the gap.
    // Raised on the toast rather than driven through the keyboard, because
    // moving focus there takes the hover with it and closes the stack before the
    // dismissal lands; that a toast can be reached at all is covered on its own
    // by 'dismisses a toast with the keyboard'.
    const settling = page.evaluate(() => {
      const start = performance.now()
      const samples = []
      const unreachable = new Set()
      const collapsed = []

      const beta = [...document.querySelectorAll('.toast')].find(e => e.textContent.includes('Beta'))
      beta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

      return new Promise((resolve) => {
        function sample () {
          const toasts = [...document.querySelectorAll('.toast')]
          const alpha = toasts.find(e => e.textContent.includes('Alpha'))
          if (alpha) { samples.push([performance.now() - start, alpha.getBoundingClientRect().y]) }

          // The toast on its way out must not cover the ones staying behind: at
          // every frame each of those has to answer for its own middle
          for (const toast of toasts) {
            if (toast.closest('[data-removed="true"]')) { continue }

            const { x, y, width, height } = toast.getBoundingClientRect()
            if (!toast.contains(document.elementFromPoint(x + width / 2, y + height / 2))) {
              unreachable.add(toast.textContent.trim().split(' ')[0])
            }
          }

          // The pointer is still on the stack throughout, so it must stay
          // fanned out: collapsing and reopening around the dismissal throws
          // every remaining toast across the screen and back
          const row = document.querySelector('[data-sonner-toast]')
          if (row && row.dataset.expanded !== 'true') {
            collapsed.push(Math.round(performance.now() - start))
          }

          if (performance.now() - start < 1000) {
            requestAnimationFrame(sample)
          } else {
            resolve({ samples, unreachable: [...unreachable], collapsed })
          }
        }
        requestAnimationFrame(sample)
      })
    })

    const { samples, unreachable, collapsed } = await settling

    expect(unreachable).toEqual([])
    expect(collapsed).toEqual([])
    await expect(page.locator('.toast', { hasText: 'Beta toast' })).toHaveCount(0)

    const positions = samples.map(([, y]) => y)
    const settled = positions.at(-1)
    expect(settled).toBeGreaterThan(alphaStart)

    // The stack slides into place without springing past it and back
    expect(Math.max(...positions)).toBeCloseTo(settled, 0)

    // and it closes the gap while the dismissed toast is still animating out,
    // rather than sitting still and then shifting once it has gone
    const firstMove = samples.find(([, y]) => y > positions[0] + 1)
    expect(firstMove, 'the stack never closed the gap').toBeDefined()
    expect(firstMove[0]).toBeLessThan(200)
  })

  test('keeps the stack open when a toast is swiped out of the middle of it', async ({ page }) => {
    await page.mouse.move(800, 300)
    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('Alpha toast', 30000)
      window.ftElectron.showToastOnAllTabs('Beta toast', 30000)
      window.ftElectron.showToastOnAllTabs('Gamma toast', 30000)
      window.ftElectron.showToastOnAllTabs('Delta toast', 30000)
    })
    await expect(page.locator('.toast', { hasText: 'Delta toast' })).toBeVisible()
    await page.waitForTimeout(700)

    const rows = page.locator('[data-sonner-toast]')
    await page.locator('.toast', { hasText: 'Delta toast' }).hover()
    await expect(rows.first()).toHaveAttribute('data-expanded', 'true')
    await page.waitForTimeout(400)

    const beta = await page.locator('.toast', { hasText: 'Beta toast' }).boundingBox()
    const delta = await page.locator('.toast', { hasText: 'Delta toast' }).boundingBox()

    // Swipe the middle toast out towards the edge the stack is anchored to
    const swipeFrom = beta.x + beta.width - 10
    await page.mouse.move(swipeFrom, beta.y + beta.height / 2)
    await page.mouse.down()
    for (let step = 1; step <= 6; step++) {
      await page.mouse.move(swipeFrom - 90 * step / 6, beta.y + beta.height / 2)
    }
    await page.mouse.up()
    await expect(page.locator('.toast', { hasText: 'Beta toast' })).toHaveCount(0)

    // Only the toast that was actually swiped: a toast must never be able to
    // take a drag aimed at one of its neighbours
    await expect(page.locator('.toast', { hasText: 'Alpha toast' })).toBeVisible()
    await expect(page.locator('.toast', { hasText: 'Gamma toast' })).toBeVisible()
    await expect(page.locator('.toast', { hasText: 'Delta toast' })).toBeVisible()

    // Letting go leaves the pointer beside the stack rather than on a toast, so
    // the stack has to hold itself open until the pointer is back on one
    const from = { x: swipeFrom - 90, y: beta.y + beta.height / 2 }
    const to = { x: delta.x + delta.width / 2, y: delta.y + delta.height / 2 }
    for (let step = 1; step <= 16; step++) {
      await page.mouse.move(from.x + (to.x - from.x) * step / 16, from.y + (to.y - from.y) * step / 16)
      await expect(rows.first()).toHaveAttribute('data-expanded', 'true')
    }
  })
})

test.describe('preferred caption language migration', () => {
  test.use({ seed: { settings: { preferredCaptionLocale: 'zh-TW' } } })

  test('persists the equivalent YouTube language code for existing users', async ({ app, page }) => {
    await expect.poll(async () => {
      const settings = latestSettings(
        await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')
      )
      return settings.preferredCaptionLocale
    }).toBe('zh-Hant')

    const playback = await goToSettingsSection(page, 'playback')
    await expect(playback.getByRole('combobox', { name: 'Preferred Caption Language' }))
      .toContainText('Chinese (Traditional)')
  })
})

test.describe('existing Japanese caption preference', () => {
  test.use({ seed: { settings: { preferredCaptionLocale: 'ja' } } })

  test('remains selected before player caption metadata is available', async ({ page }) => {
    const playback = await goToSettingsSection(page, 'playback')
    await expect(playback.getByRole('combobox', { name: 'Preferred Caption Language' }))
      .toContainText('Japanese')
  })
})

test.describe('managed external software update controls', () => {
  test.use({
    seed: {
      settings: {
        ytDlpSource: 'managed',
        externalSoftwareUpdateMode: 'ask'
      }
    }
  })

  test('offers automatic, ask, and manual update modes', async ({ app, page }) => {
    const section = await goToSettingsSection(page, 'advanced')
    const updateMode = section.locator('.select')
      .filter({ hasText: 'Managed Tool Updates' })
      .locator('select')

    await expect(updateMode).toHaveValue('ask')
    await expect(updateMode.locator('option')).toHaveText([
      'Update automatically',
      'Ask before updating',
      'Only update manually'
    ])
    await expect(section.locator('.select').filter({ hasText: 'Managed Tool Updates' }))
      .toContainText('Managed Tool Updates')

    await updateMode.selectOption('manual')
    await expect(updateMode).toHaveValue('manual')
    await expect.poll(async () => {
      return latestSettings(
        await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')
      ).externalSoftwareUpdateMode
    }).toBe('manual')
  })
})

test.describe('dark theme settings', () => {
  test.use({ seed: { settings: { baseTheme: 'dark' } } })

  test('shows the search field against the settings header', async ({ page }) => {
    await goTo(page, 'settings')

    await expect(page.locator('.settingsWindowHeader'))
      .toHaveCSS('background-color', 'rgb(18, 18, 18)')
    await expect(page.locator('.settingsSearch'))
      .toHaveCSS('background-color', 'rgb(31, 31, 31)')
  })
})

test.describe('playback engine default', () => {
  test('uses the built-in engine for new users', async ({ app }) => {
    await goTo(app.page, 'settings')
    await goToSettingsSection(app.page, 'advanced')
    await expect(
      app.page.locator('[data-section="advanced"] .select')
        .filter({ hasText: 'Stream extraction method' })
        .locator('select')
    ).toHaveValue('built-in')
  })
})

test.describe('saved playback engine', () => {
  test.use({ seed: { settings: { videoPlaybackEngine: 'yt-dlp' } } })

  test('preserves the existing user choice', async ({ app }) => {
    await goTo(app.page, 'settings')
    await goToSettingsSection(app.page, 'advanced')
    await expect(
      app.page.locator('[data-section="advanced"] .select')
        .filter({ hasText: 'Stream extraction method' })
        .locator('select')
    ).toHaveValue('yt-dlp')
  })
})

test.describe('live chat replay visibility migration', () => {
  test.use({ seed: { settings: { hideLiveChat: true } } })

  test('preserves the old live chat visibility choice for replays', async ({ app }) => {
    await expect.poll(async () => {
      const settings = latestSettings(
        await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')
      )
      return {
        liveChat: settings.hideLiveChat,
        replay: settings.hideLiveChatReplay
      }
    }).toEqual({ liveChat: true, replay: true })
  })
})

test.describe('Downloads placement migration', () => {
  test.use({ seed: { settings: { moveDownloadsToQuickSettings: false } } })

  test('preserves an existing app header placement choice', async ({ app }) => {
    await expect.poll(() => app.page.evaluate(async (findAction) => {
      const settings = Object.fromEntries(
        (await window.ftElectron.dbSettings(findAction)).map(({ _id, value }) => [_id, value])
      )
      return {
        legacyPlacement: settings.moveDownloadsToQuickSettings,
        headerPlacement: settings.moveDownloadsToAppHeader
      }
    }, DBActions.GENERAL.FIND)).toEqual({
      legacyPlacement: undefined,
      headerPlacement: true
    })

    await expect(app.page.locator('.topNav .downloadsButton')).toBeVisible()
  })
})

test.describe('SponsorBlock highlight settings', () => {
  test.use({
    seed: {
      settings: {
        highlightChangedSettings: true,
        sponsorBlockHighlight: {
          color: 'Blue',
          skip: 'autoSkip'
        },
        useSponsorBlock: true
      }
    }
  })

  test('preserves the stored skip option when resetting only the color', async ({ app }) => {
    const { page } = app
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="add-ons"]').click()

    const highlightCategory = page.locator('.sponsorBlockCategory')
      .filter({ has: page.locator('.sponsorTitle', { hasText: /^Highlight$/ }) })
    const color = highlightCategory.locator('select').nth(0)
    const skipOption = highlightCategory.locator('select').nth(1)

    await expect(color).toHaveValue('Blue')
    await expect(skipOption).toHaveValue('promptToSkip')
    await highlightCategory.getByRole('button', {
      name: 'Reset this setting to its default'
    }).click()
    await expect(color).toHaveValue('Red')

    await expect.poll(async () => {
      const settings = latestSettings(
        await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')
      )
      return settings.sponsorBlockHighlight
    }).toEqual({
      color: 'Red',
      skip: 'autoSkip'
    })
  })
})

test.describe('secure pairing manual entry', () => {
  const serverUrl = 'https://pairing.example'

  test.use({
    seed: {
      settings: {
        syncServerAutoSync: false,
        syncServerEnabled: true,
        syncServerPrivacyKey: `${'A'.repeat(43)}=`,
        syncServerPrivacyMode: 'enhanced',
        syncServerPrivacySalt: `${'A'.repeat(22)}==`,
        syncServerToken: 'pairing-test-token',
        syncServerUrl: serverUrl,
        syncServerUsername: 'pairing-user'
      }
    }
  })

  test('accepts a text code when no camera is available', async ({ page }) => {
    const accountId = '0198e2d4-8ad2-7f73-8d6e-4f076707ce25'
    let approvedPayload
    const request = {
      version: 1,
      origin: serverUrl,
      sessionId: 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8',
      recipientPublicKey: 'sfG4QN56MkGwJ0jPmwW3TcjF6EUSmHOIF712qo6-jCs',
      recipientDeviceId: 'MDEyMzQ1Njc4OTo7PD0-Pw',
      recipientDeviceName: 'Window B',
      pairingSecret: 'oKGio6SlpqeoqaqrrK2ur7CxsrO0tba3uLm6u7y9vr8'
    }
    const pairingCode = `opentubex-pairing:${Buffer.from(JSON.stringify(request)).toString('base64url')}`

    await page.route(`${serverUrl}/**`, async route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/health') {
        await route.fulfill({
          json: {
            status: 'ok',
            capabilities: { encrypted_sync: 1, key_pairing: 1 }
          }
        })
        return
      }
      if (url.pathname === `/v1/pairing/${request.sessionId}/claim`) {
        await route.fulfill({
          json: {
            session: {
              version: request.version,
              id: request.sessionId,
              account_id: accountId,
              recipient_public_key: request.recipientPublicKey,
              recipient_device_id: request.recipientDeviceId,
              recipient_device_name: request.recipientDeviceName,
              approving_device_id: null,
              expires_at: Date.now() + 120_000,
              approved: false
            },
            jwt: 'fresh.pairing.token'
          }
        })
        return
      }
      if (url.pathname === `/v1/pairing/${request.sessionId}` &&
          route.request().method() === 'PUT') {
        approvedPayload = route.request().postDataJSON()
        await route.fulfill({ status: 204 })
        return
      }
      await route.fulfill({ status: 404 })
    })

    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="sync"]').click()
    const syncSection = page.locator('[data-section="sync"]')
    await expect(syncSection.getByText('Enhanced privacy is enabled.')).toBeVisible()

    await page.evaluate(() => {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          enumerateDevices: () => Promise.resolve([]),
          getUserMedia: () => Promise.reject(new Error('No camera'))
        }
      })
    })

    await syncSection.getByRole('button', { name: 'Pair another device' }).click()
    const dialog = page.getByRole('dialog', { name: 'Pair another device' })
    await expect(dialog.getByRole('alert')).toContainText('could not access a camera')
    await dialog.getByRole('button', { name: 'Enter code manually' }).click()
    await dialog.getByRole('textbox', { name: 'Pairing code' }).fill(pairingCode)
    await dialog.getByRole('button', { name: 'Check code' }).click()

    await expect(dialog.getByText(serverUrl, { exact: true })).toBeVisible()
    await expect(dialog.getByText('Window B', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Approve pairing' }).click()
    await expect(dialog.locator('.pairingVerificationCode')).toHaveText(/^\d{6}$/)
    expect(approvedPayload.approving_device_id).toMatch(/^[\w-]{22}$/)
    expect(approvedPayload.encrypted_payload).toMatch(/^[\w-]+$/)
    expect(JSON.stringify(approvedPayload)).not.toMatch(/fresh\.pairing\.token|pairing-user/)
    await expect(dialog.locator('.promptFixedFooter').getByRole('button', { name: 'Close' }))
      .toBeVisible()
  })
})

test.describe('sync settings', () => {
  test.use({
    seed: {
      settings: {
        syncServerEnabled: true,
        syncServerAutoSync: false,
        syncServerPrivacyKey: 'e2e-privacy-key',
        syncServerPrivacyMode: 'legacy',
        syncServerSnapshot: '{"subscriptions":[]}',
        syncServerToken: 'invalid-token',
        syncServerUrl: 'https://sync.d3sox.me',
        syncServerUsername: 'sync-user',
        syncServerLastSyncAt: 1234
      }
    }
  })

  for (const scale of [1, 1.25]) {
    test(`keeps the connected account label in the settings layout at UI scale ${scale}`, async ({ page }) => {
      await page.route('https://sync.d3sox.me/**', route => route.fulfill({
        json: { status: 'ok', capabilities: {} }
      }))
      await goTo(page, 'settings')
      await page.evaluate(scale => window.ftElectron.setZoomFactor(scale), scale)
      await page.locator('.settingsMenu [data-section="sync"]').click()

      const syncSection = page.locator('[data-section="sync"]')
      const label = syncSection.getByText('Connected as sync-user')
      await expect(label).toBeVisible()
      await expect(label).toHaveCSS('position', 'static')
      await expect(label).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await expect(label).toHaveCSS('padding-top', '0px')
      await expect(label).toHaveCSS('text-align', 'center')
      const bounds = await label.boundingBox()
      const fields = await syncSection.locator('.fields').boundingBox()
      const toggles = await syncSection.locator('.toggles').nth(1).boundingBox()
      expect(bounds.y).toBeGreaterThanOrEqual(fields.y + fields.height)
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(toggles.y)

      await page.evaluate(() => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
        window.dispatchEvent(new Event('offline'))
      })
      const banner = page.getByRole('status').filter({ hasText: /^Offline$/ })
      await expect(banner).toBeVisible()
      await expect(page.locator('.connection-status-holder')).toHaveCSS('position', 'fixed')
      await expect(label).toHaveCSS('position', 'static')
      await expect(label).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    })
  }

  test('keeps the paired username when its device metadata update fails', async ({ page }) => {
    await page.route('https://sync.d3sox.me/**', route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/health') {
        return route.fulfill({
          json: { status: 'ok', capabilities: { account_sessions: 1 } }
        })
      }
      if (url.pathname.endsWith('/account/sessions/current')) {
        return route.fulfill({ status: 503, body: 'metadata unavailable' })
      }
      return route.fulfill({ status: 404 })
    })
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="sync"]').click()

    const syncSection = page.locator('[data-section="sync"]')
    const username = syncSection.getByLabel('Username')
    await syncSection.getByRole('button', { name: 'Disconnect' }).click()
    await expect(username).toBeEnabled()
    await username.fill('')
    await expect(username).toHaveValue('')

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.dispatch('completeSyncServerPairing', {
        serverUrl: 'https://sync.d3sox.me',
        username: 'paired-user',
        token: 'paired-token',
        privacyKey: 'paired-privacy-key',
        privacySalt: 'paired-privacy-salt',
        deviceId: 'MDEyMzQ1Njc4OTo7PD0-Pw',
        deviceName: 'Paired device',
        deviceSystemInfo: {
          platform: 'android',
          architecture: 'arm64-v8a',
          release: '16'
        }
      })
    })

    await expect(username).toBeDisabled()
    await expect(username).toHaveValue('paired-user')
  })

  test('records concurrent setting edits without losing a sync timestamp', async ({ page }) => {
    const updatedAt = await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await Promise.all([
        store.dispatch('recordSyncSettingEdit', 'baseTheme'),
        store.dispatch('recordSyncSettingEdit', 'mainColor'),
      ])
      return store.state.settings.syncServerSettingUpdatedAt
    })

    expect(updatedAt.baseTheme).toEqual(expect.any(Number))
    expect(updatedAt.mainColor).toEqual(expect.any(Number))
  })

  test('does not follow sync-server redirects with credentials', async ({ page }) => {
    let credentialedRequestStarted
    const credentialedRequest = new Promise(resolve => {
      credentialedRequestStarted = resolve
    })
    let downgradedRequests = 0
    await page.route('https://sync.d3sox.me/**', route => {
      if (route.request().headers().authorization === 'invalid-token') {
        credentialedRequestStarted()
      }
      return route.fulfill({
        status: 307,
        headers: { location: 'http://sync.d3sox.me/health' }
      })
    })
    await page.route('http://sync.d3sox.me/**', route => {
      downgradedRequests++
      return route.fulfill({ status: 200, body: 'OK' })
    })

    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="sync"]').click()
    await credentialedRequest
    await page.waitForTimeout(100)
    expect(downgradedRequests).toBe(0)
  })

  test('shows session expiration and other sync failures outside Sync settings', async ({ page }) => {
    let response = { status: 500, body: 'Background sync failed' }
    await page.route('https://sync.d3sox.me/**', async (route) => {
      await route.fulfill(response)
    })

    const sync = () => page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('syncWithSyncServer').catch(() => {})
    })

    await sync()
    const toast = page.locator('.toast', {
      hasText: 'Sync failed: Background sync failed'
    })
    await expect(toast).toBeVisible()
    await expect(toast.locator('.icon[data-icon="circle-exclamation"]')).toBeVisible()

    response = { status: 401, body: 'Invalid or missing authentication token' }
    await sync()
    await expect(page.locator('.toast', {
      hasText: 'Sync failed: Sync server session expired. Sign in again to resume syncing.'
    })).toBeVisible()
  })

  test('clears a sync error and enables credentials after disconnecting', async ({ page }) => {
    let delayServerCheck = false
    let finishServerCheck
    let serverCheckStarted
    const serverCheckPending = new Promise((resolve) => {
      finishServerCheck = resolve
    })
    const serverCheckRequested = new Promise((resolve) => {
      serverCheckStarted = resolve
    })
    await page.route('https://sync.d3sox.me/**', async (route) => {
      if (new URL(route.request().url()).pathname === '/health') {
        if (delayServerCheck) {
          serverCheckStarted()
          await serverCheckPending
        }
        await route.fulfill({ status: 200, body: 'OK' })
      } else {
        await route.fulfill({ status: 500, body: 'Sync failed' })
      }
    })
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="sync"]').click()

    const syncSection = page.locator('[data-section="sync"]')
    await syncSection.getByRole('button', { name: 'Sync now' }).click()
    await expect(syncSection.locator('.error')).toHaveText('Sync failed')
    await page.waitForTimeout(250)
    await expect(page.locator('.toast', { hasText: 'Sync failed: Sync failed' })).toHaveCount(0)

    await expect(syncSection.getByLabel('Server URL')).toBeDisabled()
    await expect(syncSection.getByLabel('Username')).toBeDisabled()
    // Sync may query optional capabilities before the post-disconnect check.
    delayServerCheck = true
    await syncSection.getByRole('button', { name: 'Disconnect' }).click()

    try {
      await serverCheckRequested
      // Scoped to the sync failure: the same element also carries unrelated
      // notices (e.g. the enhanced-privacy hint) once the server check lands.
      await expect(syncSection.locator('.error', { hasText: 'Sync failed' })).toHaveCount(0)
      await expect(syncSection.getByLabel('Server URL')).toBeEnabled()
      await expect(syncSection.getByLabel('Username')).toBeEnabled()
      await expect(syncSection.getByLabel('Password')).toBeEnabled()
    } finally {
      finishServerCheck()
    }
  })

  test('stops an active sync when sync is disabled', async ({ page }) => {
    let finishSyncRequest
    let syncRequestStarted
    const syncRequestPending = new Promise((resolve) => {
      finishSyncRequest = resolve
    })
    const syncRequestRequested = new Promise((resolve) => {
      syncRequestStarted = resolve
    })
    const syncRequests = []

    await page.route('https://sync.d3sox.me/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname
      if (pathname === '/health') {
        await route.fulfill({ status: 200, body: 'OK' })
        return
      }

      syncRequests.push(pathname)
      syncRequestStarted()
      await syncRequestPending
      await route.fulfill({ status: 200, json: [] })
    })
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="sync"]').click()

    const syncSection = page.locator('[data-section="sync"]')
    await syncSection.getByRole('button', { name: 'Sync now' }).click()
    await syncRequestRequested
    await syncSection.getByText('Enable Sync', { exact: true }).click()
    finishSyncRequest()

    await expect(syncSection.getByLabel('Enable Sync')).not.toBeChecked()
    await expect(syncSection.locator('.syncProgress')).toBeHidden()
    await expect(syncSection.locator('.error')).toHaveCount(0)
    await expect(page.locator('.toast', { hasText: 'Sync completed' })).toHaveCount(0)
    await page.waitForTimeout(500)
    expect(syncRequests).toHaveLength(1)
  })

  test('stops an active sync in another window when sync is disabled', async ({ app, page }) => {
    const otherWindow = await openNewWindowFromTabBar(app, page)
    await waitForAppReady(otherWindow)

    let finishSyncRequest
    let syncRequestStarted
    const syncRequestPending = new Promise((resolve) => {
      finishSyncRequest = resolve
    })
    const syncRequestRequested = new Promise((resolve) => {
      syncRequestStarted = resolve
    })
    const syncRequests = []

    await otherWindow.route('https://sync.d3sox.me/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname
      if (pathname === '/health') {
        await route.fulfill({ status: 200, body: 'OK' })
        return
      }
      syncRequests.push(pathname)
      syncRequestStarted()
      await syncRequestPending
      await route.fulfill({ status: 200, json: [] }).catch(() => {})
    })

    await goTo(page, 'settings')
    await goTo(otherWindow, 'settings')
    await page.locator('.settingsMenu [data-section="sync"]').click()
    await otherWindow.locator('.settingsMenu [data-section="sync"]').click()
    const firstSyncSection = page.locator('[data-section="sync"]')
    const otherSyncSection = otherWindow.locator('[data-section="sync"]')

    await otherSyncSection.getByRole('button', { name: 'Sync now' }).click()
    await syncRequestRequested
    await firstSyncSection.getByText('Enable Sync', { exact: true }).click()
    finishSyncRequest()

    await expect(firstSyncSection.getByLabel('Enable Sync')).not.toBeChecked()
    await expect(otherSyncSection.getByLabel('Enable Sync')).not.toBeChecked()
    await expect(otherSyncSection.locator('.syncProgress')).toBeHidden()
    await otherWindow.waitForTimeout(500)
    expect(syncRequests).toHaveLength(1)
  })

  test('cancels authentication without storing a new token when sync is disabled', async ({ app, page }) => {
    let finishAuthentication
    let authenticationStarted
    const authenticationPending = new Promise((resolve) => {
      finishAuthentication = resolve
    })
    const authenticationRequested = new Promise((resolve) => {
      authenticationStarted = resolve
    })

    await page.route('https://sync.d3sox.me/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname
      if (pathname === '/health') {
        await route.fulfill({ status: 200, body: 'OK' })
        return
      }
      authenticationStarted()
      await authenticationPending
      await route.fulfill({ status: 200, json: { jwt: 'late-token' } }).catch(() => {})
    })

    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="sync"]').click()
    const syncSection = page.locator('[data-section="sync"]')
    await syncSection.getByRole('button', { name: 'Disconnect' }).click()
    await syncSection.getByLabel('Username').fill('sync-user')
    await syncSection.getByLabel('Password').fill('sync-password')
    await syncSection.getByRole('button', { name: 'Log in' }).click()
    await authenticationRequested
    await syncSection.getByText('Enable Sync', { exact: true }).click()
    finishAuthentication()

    await expect(syncSection.getByLabel('Enable Sync')).not.toBeChecked()
    await expect.poll(async () => {
      const settings = latestSettings(
        await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')
      )
      return settings.syncServerToken
    }).toBe('')
  })

  test('disables credentials while authentication is pending', async ({ page }) => {
    let finishAuthentication
    const authenticationPending = new Promise((resolve) => {
      finishAuthentication = resolve
    })
    await page.route('https://sync.d3sox.me/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname
      if (pathname === '/health') {
        await route.fulfill({ status: 200, body: 'OK' })
      } else {
        await authenticationPending
        await route.fulfill({ status: 401, body: 'Invalid credentials' })
      }
    })
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="sync"]').click()

    const syncSection = page.locator('[data-section="sync"]')
    await syncSection.getByRole('button', { name: 'Disconnect' }).click()
    await expect(syncSection.getByLabel('Username')).toBeEnabled()
    await syncSection.getByLabel('Username').fill('sync-user')
    await syncSection.getByLabel('Password').fill('sync-password')
    await syncSection.getByRole('button', { name: 'Log in' }).click()

    await expect(syncSection.getByLabel('Server URL')).toBeDisabled()
    await expect(syncSection.getByLabel('Username')).toBeDisabled()
    await expect(syncSection.getByLabel('Password')).toBeDisabled()
    await expect(syncSection.getByRole('button', { name: 'Log in' })).toBeDisabled()
    await expect(syncSection.getByRole('button', { name: 'Register' })).toBeDisabled()

    finishAuthentication()
    await expect(syncSection.locator('.error')).toHaveText('Invalid credentials')
    await expect(syncSection.getByLabel('Server URL')).toBeEnabled()
    await expect(syncSection.getByLabel('Username')).toBeEnabled()
    await expect(syncSection.getByLabel('Password')).toBeEnabled()
  })

  test('preserves the sync baseline while reauthenticating an expired session', async ({ app, page }) => {
    let finishPostLoginSync
    let postLoginSyncStarted
    const postLoginSyncPending = new Promise((resolve) => {
      finishPostLoginSync = resolve
    })
    const postLoginSyncRequested = new Promise((resolve) => {
      postLoginSyncStarted = resolve
    })
    let authenticatedManifestRequests = 0

    await page.route('https://sync.d3sox.me/**', async (route) => {
      const request = route.request()
      const pathname = new URL(request.url()).pathname
      const authorization = request.headers().authorization

      if (pathname === '/health') {
        await route.fulfill({
          status: 200,
          json: { capabilities: { encrypted_sync: 1 } }
        })
      } else if (pathname === '/v1/account/login') {
        await route.fulfill({ status: 200, json: { jwt: 'renewed-token' } })
      } else if (authorization === 'invalid-token') {
        await route.fulfill({
          status: 401,
          body: 'Invalid or missing authentication token'
        })
      } else if (pathname === '/v1/encrypted_sync') {
        authenticatedManifestRequests++
        if (authenticatedManifestRequests === 2) {
          postLoginSyncStarted()
          await postLoginSyncPending
        }
        await route.fulfill({ status: 200, json: { collections: [] } })
      } else if (request.method() === 'PUT') {
        await route.fulfill({ status: 200, json: {} })
      } else {
        await route.fulfill({ status: 200, json: { revision: 0 } })
      }
    })
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="sync"]').click()

    const syncSection = page.locator('[data-section="sync"]')
    await syncSection.getByRole('button', { name: 'Sync now' }).click()
    await expect(syncSection.locator('.error')).toHaveText(
      'Sync server session expired. Sign in again to resume syncing.'
    )
    await expect(syncSection.getByLabel('Username')).toBeEnabled()

    await syncSection.getByLabel('Password').fill('sync-password')
    await syncSection.getByLabel(/Privacy passphrase/).fill('sync-privacy-passphrase')
    await syncSection.getByRole('button', { name: 'Log in' }).click()

    try {
      await postLoginSyncRequested
      const settings = latestSettings(
        await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')
      )
      expect(settings.syncServerSnapshot).toBe('{"subscriptions":[]}')
      expect(settings.syncServerLastSyncAt).toBe(1234)
    } finally {
      finishPostLoginSync()
    }

    await expect(syncSection.getByText('Connected as sync-user')).toBeVisible()
    await expect(syncSection.getByText(/Last synced:/)).toBeVisible()
  })
})

test.describe('invalid toast position', () => {
  test.use({ seed: { settings: { toastPosition: 'unsupported' } } })

  test('falls back to bottom left', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()

    const positionSelect = page.locator('[data-section="appearance"] .select')
      .filter({ hasText: 'Toast Position' })
      .locator('select')
    await expect(positionSelect).toHaveValue('bottom-left')

    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('Fallback toast', 10000)
    })

    const holder = page.locator('.toast-holder')
    await expect(holder.locator('.toast', { hasText: 'Fallback toast' })).toBeVisible()
    await expect(holder).toHaveClass(/position-bottom-left/)
  })
})

test.describe('invalid icon pack', () => {
  test.use({ seed: { settings: { iconPack: 'unsupported' } } })

  test('normalizes the stored value to the applied fallback', async ({ app, page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()

    const iconPack = page.locator('[data-section="appearance"] .select')
      .filter({ hasText: 'Icon Pack' })
      .locator('select')
    await expect(iconPack).toHaveValue('material')
    await expect(page.locator('[data-icon-pack="material"]').first()).toBeVisible()
    await expect.poll(async () => {
      return latestSettings(
        await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')
      ).iconPack
    }).toBe('material')
  })
})

test.describe('synced setting indicators', () => {
  test.use({
    seed: {
      settings: {
        highlightChangedSettings: true,
        reducedMotion: 'on',
        syncServerEnabled: true,
        syncServerAutoSync: false,
        syncServerSyncSettings: true,
        syncServerToken: 'e2e-sync-token'
      }
    }
  })

  test('shares the subscription settings sync toggle between its button and subpage', async ({ page }) => {
    const section = await goToSettingsSection(page, 'subscription')
    const manager = section.locator('.manageButton').filter({ hasText: 'Subscription settings' })
    await manager.getByRole('button', { name: 'Stop syncing this setting' }).click()
    await expect(manager.getByRole('button', { name: 'Sync this setting' })).toHaveAttribute('aria-pressed', 'false')
    await manager.getByRole('button', { name: 'Subscription settings', exact: true }).click()
    const enable = page.getByRole('button', { name: 'Sync this setting', exact: true })
    await expect(enable).toBeVisible()
    await enable.click()
    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.state.settings.syncServerSettingsExcluded
    })).not.toContain('subscriptionChannelSettings')
    await page.reload()
    const reloaded = await goToSettingsSection(page, 'subscription')
    await expect(reloaded.locator('.manageButton').filter({ hasText: 'Subscription settings' })
      .getByRole('button', { name: 'Stop syncing this setting' })).toBeVisible()
  })

  test('allows account sync to be disabled per setting', async ({ page }) => {
    await goTo(page, 'settings')

    const syncedLabel = page.locator('label').filter({ hasText: 'Default Landing Page' })
    const syncButton = syncedLabel.getByRole('button', { name: 'Stop syncing this setting' })
    await expect(syncButton).toBeVisible()
    await syncButton.click()
    await expect(syncedLabel.getByRole('button', { name: 'Sync this setting' })).toBeVisible()

    await page.reload()
    await goTo(page, 'settings')
    await expect(syncedLabel.getByRole('button', { name: 'Sync this setting' })).toBeVisible()

    const toggle = page.getByRole('checkbox', { name: /Auto load next page/i })
    await page.locator('label').filter({ hasText: 'Auto load next page' })
      .getByRole('button', { name: 'Stop syncing this setting' })
      .click()
    await expect(toggle).toBeChecked()

    const localOnlyLabel = page.locator('label').filter({ hasText: 'Check for Updates' })
    await expect(localOnlyLabel.getByRole('button', { name: /syncing this setting/i })).toHaveCount(0)
  })

  test('allows quick settings and navigation customization to be excluded independently', async ({ page }) => {
    const appearance = await goToSettingsSection(page, 'appearance')
    const quickSettings = appearance.locator('.settingButtonWithSync').filter({
      hasText: 'Customize quick settings'
    })
    const navigation = appearance.locator('.settingButtonWithSync').filter({
      hasText: 'Customize navigation'
    })

    await quickSettings.getByRole('button', { name: 'Stop syncing this setting' }).click()
    await expect(quickSettings.getByRole('button', { name: 'Sync this setting' })).toBeVisible()
    await expect(navigation.getByRole('button', { name: 'Stop syncing this setting' })).toBeVisible()

    await navigation.getByRole('button', { name: 'Stop syncing this setting' }).click()
    await expect(navigation.getByRole('button', { name: 'Sync this setting' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.state.settings.syncServerSettingsExcluded
    })).toEqual(['quickSettings', 'navigationItems'])

    await quickSettings.getByRole('button', { name: 'Sync this setting' }).click()
    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.state.settings.syncServerSettingsExcluded
    })).toEqual(['navigationItems'])
  })

  test('spaces setting sync and help icons', async ({ page }) => {
    await goTo(page, 'settings')

    const startup = page.locator('.generalSelectGrid .select')
      .filter({ hasText: 'On Startup' })
    await startup.locator('select').selectOption('restoreTabLoadState')
    const getStartupIconGap = async () => {
      const [selectBox, helpBox] = await Promise.all([
        startup.locator('.select-text').boundingBox(),
        startup.locator('.selectTooltip').boundingBox()
      ])
      expect(selectBox).not.toBeNull()
      expect(helpBox).not.toBeNull()
      return helpBox.x - selectBox.x - selectBox.width
    }
    expect(await getStartupIconGap()).toBeGreaterThanOrEqual(8)

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateUiScale', 95)
    })
    await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBeCloseTo(0.95, 2)
    expect(await getStartupIconGap()).toBeGreaterThanOrEqual(8)

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateUiScale', 100)
    })
    await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBeCloseTo(1, 2)

    await page.locator('.settingsMenu [data-section="privacy"]').click()

    const slider = page.locator('label.pure-material-slider')
      .filter({ hasText: 'Watched Percentage Threshold' })
    const select = page.locator('.select')
      .filter({ hasText: 'Save Watched Progress' })
    await select.locator('select').selectOption('never')

    for (const setting of [slider, select]) {
      const [syncBox, helpBox] = await Promise.all([
        setting.locator('.syncedSettingIndicator').boundingBox(),
        setting.locator('.selectTooltip').boundingBox()
      ])

      expect(syncBox).not.toBeNull()
      expect(helpBox).not.toBeNull()
      expect(syncBox.x - helpBox.x - helpBox.width).toBeGreaterThanOrEqual(6)
    }

    const [syncBox, resetBox] = await Promise.all([
      select.locator('.syncedSettingIndicator').boundingBox(),
      select.locator('.changedSettingIndicator').boundingBox()
    ])
    const helpBox = await select.locator('.selectTooltip').boundingBox()
    expect(syncBox).not.toBeNull()
    expect(resetBox).not.toBeNull()
    expect(helpBox).not.toBeNull()
    expect(Math.abs(helpBox.y + helpBox.height / 2 - syncBox.y - syncBox.height / 2)).toBeLessThanOrEqual(1)
    expect(Math.abs(syncBox.y - resetBox.y)).toBeLessThanOrEqual(1)
    expect(resetBox.x - syncBox.x - syncBox.width).toBeGreaterThanOrEqual(6)

    const storage = await goToSettingsSection(page, 'storage')
    const input = storage.locator('label.selectLabel')
      .filter({ hasText: 'Automatic History Retention' })
    const [inputSyncBox, inputHelpBox] = await Promise.all([
      input.locator('.syncedSettingIndicator').boundingBox(),
      input.locator('.selectTooltip').boundingBox()
    ])
    expect(inputSyncBox).not.toBeNull()
    expect(inputHelpBox).not.toBeNull()
    expect(inputSyncBox.x - inputHelpBox.x - inputHelpBox.width).toBeGreaterThanOrEqual(6)

    await input.locator('.selectTooltip button').focus()
    const tooltipText = page.locator('body > [role="tooltip"]:visible')
    await expect(tooltipText).toBeVisible()

    const [tooltipTextBox, sectionBox] = await Promise.all([
      tooltipText.boundingBox(),
      input.locator('xpath=ancestor::*[@data-section="data"]').boundingBox()
    ])
    expect(tooltipTextBox).not.toBeNull()
    expect(sectionBox).not.toBeNull()
    expect(tooltipTextBox.width).toBeLessThan(sectionBox.width / 2)

    const removeHistoryButton = page.getByRole('button', { name: 'Remove Watch History' })
    const removeHistoryButtonBox = await removeHistoryButton.boundingBox()
    expect(removeHistoryButtonBox).not.toBeNull()

    const overlapLeft = Math.max(tooltipTextBox.x, removeHistoryButtonBox.x)
    const overlapRight = Math.min(
      tooltipTextBox.x + tooltipTextBox.width,
      removeHistoryButtonBox.x + removeHistoryButtonBox.width
    )
    const overlapTop = Math.max(tooltipTextBox.y, removeHistoryButtonBox.y)
    const overlapBottom = Math.min(
      tooltipTextBox.y + tooltipTextBox.height,
      removeHistoryButtonBox.y + removeHistoryButtonBox.height
    )
    expect(overlapLeft).toBeLessThan(overlapRight)
    expect(overlapTop).toBeLessThan(overlapBottom)

    const overlapPoint = {
      x: (overlapLeft + overlapRight) / 2,
      y: (overlapTop + overlapBottom) / 2
    }
    await tooltipText.evaluate(element => {
      element.style.pointerEvents = 'auto'
    })
    await expect.poll(() => page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y)
      return element !== null && element.closest('[role="tooltip"]') !== null
    }, overlapPoint)).toBe(true)
  })

  test('spreads the theme sliders evenly over their rows', async ({ page }) => {
    await goTo(page, 'settings')
    const themeSection = await goToSettingsSection(page, 'appearance')
    const sliders = themeSection.locator('.sliderGrid > *')
    await expect(sliders).toHaveCount(6)

    const boxes = await sliders.evaluateAll((elements) => elements.map((element) => {
      const { y, width } = element.getBoundingClientRect()
      return { y: Math.round(y), width: Math.round(width) }
    }))

    // Two even rows, rather than four squeezed together and two below.
    const rowSizes = new Map()
    for (const { y } of boxes) {
      rowSizes.set(y, (rowSizes.get(y) ?? 0) + 1)
    }
    expect([...rowSizes.values()]).toEqual([3, 3])
    // The row they landed on doesn't change how much room they get.
    expect(new Set(boxes.map(({ width }) => width)).size).toBe(1)
  })

  test('wraps the playback sliders in the same grid as the theme sliders', async ({ page }) => {
    await goTo(page, 'settings')
    const playbackSection = await goToSettingsSection(page, 'playback')
    const sliders = playbackSection.locator('.sliderGrid > *')
    await expect(sliders).toHaveCount(9)
    await expect(sliders.nth(5)).toContainText(/Max video playback rate/i)
    await expect(sliders.nth(6)).toContainText(/Parallel segment loading/i)
    await expect(sliders.nth(7)).toContainText(/Upcoming videos to preload/i)
    await expect(sliders.nth(8)).toContainText(/Concurrent Preloads/i)

    const boxes = await sliders.evaluateAll((elements) => elements.map((element) => {
      const { x, y, width } = element.getBoundingClientRect()
      return { x: Math.round(x), y: Math.round(y), width: Math.round(width) }
    }))

    const rowSizes = new Map()
    for (const { y } of boxes) {
      rowSizes.set(y, (rowSizes.get(y) ?? 0) + 1)
    }
    expect([...rowSizes.values()]).toEqual([3, 3, 3])
    expect(new Set(boxes.map(({ width }) => width)).size).toBe(1)

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateUiScale', 125)
    })
    await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBeCloseTo(1.25, 2)

    const scaledLayout = await playbackSection.locator('.sliderGrid').evaluateAll(elements => {
      const overflows = []
      const rowSizes = []

      for (const element of elements) {
        const gridBounds = element.getBoundingClientRect()
        const sliderBounds = Array.from(element.children, child => child.getBoundingClientRect())
        const rows = new Map()

        for (const bounds of sliderBounds) {
          const y = Math.round(bounds.y)
          rows.set(y, (rows.get(y) ?? 0) + 1)
          overflows.push(
            gridBounds.left - bounds.left,
            bounds.right - gridBounds.right
          )
        }

        rowSizes.push(...rows.values())
      }

      return {
        maximumOverflow: Math.max(...overflows),
        maximumRowSize: Math.max(...rowSizes)
      }
    })
    expect(scaledLayout.maximumOverflow).toBeLessThanOrEqual(1)
    expect(scaledLayout.maximumRowSize).toBeLessThanOrEqual(3)
  })

  test('does not move a setting when its changed highlight appears', async ({ page }) => {
    await goTo(page, 'settings')

    const themeSection = await goToSettingsSection(page, 'appearance')
    const slider = themeSection.locator('label.pure-material-slider')
      .filter({ hasText: 'Scrollbar Width' })
    const label = slider.locator('.label')
    const neighbour = themeSection.locator('label.pure-material-slider')
      .filter({ hasText: 'Animation Speed' })

    // At its default the setting reserves the marker's space without showing it.
    await expect(slider).toHaveCSS('border-left-width', '3px')
    await expect(slider).toHaveCSS('border-left-color', 'rgba(0, 0, 0, 0)')

    const [labelBefore, neighbourBefore] = await Promise.all([
      label.boundingBox(),
      neighbour.boundingBox()
    ])

    await slider.getByRole('slider').fill('20')
    await expect(slider.getByRole('button', { name: 'Reset this setting to its default' }))
      .toBeVisible()

    // Reserving that space must not stop the marker from showing up.
    await expect(slider).not.toHaveCSS('border-left-color', 'rgba(0, 0, 0, 0)')

    // Gaining the marker and the reset icon must not resize or shift anything,
    // otherwise the row shifts under the pointer mid-drag.
    const [labelAfter, neighbourAfter] = await Promise.all([
      label.boundingBox(),
      neighbour.boundingBox()
    ])
    expect(labelAfter.x).toBeCloseTo(labelBefore.x, 0)
    expect(labelAfter.width).toBeCloseTo(labelBefore.width, 0)
    expect(labelAfter.height).toBe(labelBefore.height)
    expect(neighbourAfter.x).toBeCloseTo(neighbourBefore.x, 0)
  })

  test('reserves changed-setting markers for non-resettable controls', async ({ page }) => {
    await goTo(page, 'settings')

    const advanced = await goToSettingsSection(page, 'advanced')
    const providers = advanced.locator('.settingsSection').filter({
      has: page.getByRole('heading', { name: 'Video and metadata providers', exact: true })
    })
    const proxyToggle = providers.locator('.switch-ctn')
      .filter({ hasText: 'Proxy Videos Through Invidious' })
    await expect(proxyToggle).toHaveCSS('border-left-width', '3px')

    const playback = await goToSettingsSection(page, 'playback')
    await expect(playback.getByText('Proxy Videos Through Invidious', { exact: true }))
      .toHaveCount(0)

    const themeSection = await goToSettingsSection(page, 'appearance')
    const smoothScrollingToggle = themeSection.locator('.switch-ctn')
      .filter({ hasText: 'Disable Smooth Scrolling' })
    await expect(smoothScrollingToggle).toHaveCSS('border-left-width', '3px')

    const playerSectionAgain = await goToSettingsSection(page, 'playback')
    const viewingModeSelect = playerSectionAgain.locator('.select')
      .filter({ hasText: 'Default Viewing Mode' })
    const [selectBox, selectLabelBox] = await Promise.all([
      viewingModeSelect.locator('.select-text').boundingBox(),
      viewingModeSelect.locator('.select-label').boundingBox()
    ])
    expect(selectBox).not.toBeNull()
    expect(selectLabelBox).not.toBeNull()
    expect(selectLabelBox.x).toBeCloseTo(selectBox.x, 0)
  })

  test('keeps a wrapped slider label beside its icons and above its track', async ({ page }) => {
    await goTo(page, 'settings')

    const themeSection = await goToSettingsSection(page, 'appearance')
    const slider = themeSection.locator('label.pure-material-slider')
      .filter({ hasText: 'Scrollbar Width' })
    const range = slider.getByRole('slider')
    const label = slider.locator('.label')

    // A shorter value must not make the label any narrower, otherwise dragging
    // the slider wraps and unwraps it, and the whole row jumps around.
    await range.fill('20')
    const wideValueBox = await label.boundingBox()
    await range.fill('4')
    const shortValueBox = await label.boundingBox()
    expect(wideValueBox).not.toBeNull()
    expect(shortValueBox).not.toBeNull()
    expect(shortValueBox.width).toBeCloseTo(wideValueBox.width, 0)

    await range.fill('20')
    // Narrow windows and longer translations make the label wrap on their own;
    // this is just a reliable way to reach the same width.
    await slider.evaluate((element) => { element.style.maxInlineSize = '150px' })

    const reset = slider.getByRole('button', { name: 'Reset this setting to its default' })
    await expect(reset).toBeVisible()

    const [labelBox, resetBox, rangeBox] = await Promise.all([
      label.boundingBox(),
      reset.boundingBox(),
      range.boundingBox()
    ])
    expect(labelBox).not.toBeNull()
    expect(resetBox).not.toBeNull()
    expect(rangeBox).not.toBeNull()

    // The label has to be the thing that wraps for the rest to mean anything.
    expect(labelBox.height).toBeGreaterThan(30)
    // Wrapped, it still keeps its size across the range.
    await range.fill('4')
    const wrappedShortValueBox = await label.boundingBox()
    expect(wrappedShortValueBox.height).toBe(labelBox.height)
    await range.fill('20')
    // The icon stays beside the label instead of dropping onto its own line.
    expect(resetBox.y).toBeGreaterThanOrEqual(labelBox.y)
    expect(resetBox.y + resetBox.height).toBeLessThanOrEqual(labelBox.y + labelBox.height + 1)
    expect(resetBox.x).toBeGreaterThanOrEqual(labelBox.x + labelBox.width)
    // A label that needs a second line pushes the track down instead of
    // running through it.
    expect(rangeBox.y).toBeGreaterThanOrEqual(labelBox.y + labelBox.height - 1)
  })

  test('renders select tooltips above neighboring setting indicators', async ({ page }) => {
    await goTo(page, 'settings')

    const startupSelect = page.locator('.select').filter({ hasText: 'On Startup' })
    await startupSelect.locator('select').selectOption('restoreTabLoadState')

    await startupSelect.locator('.selectTooltip button').focus()
    const tooltipText = page.locator('body > [role="tooltip"]:visible')
    await expect(tooltipText).toBeVisible()

    const neighboringIndicators = page.locator('.select')
      .filter({ hasText: 'Prefer untranslated video text' })
      .locator('.selectIndicators')
    const tooltipBox = await tooltipText.boundingBox()
    expect(tooltipBox).not.toBeNull()
    await neighboringIndicators.evaluate((element, { x, y }) => {
      element.style.position = 'fixed'
      element.style.inset = 'auto'
      element.style.left = `${x}px`
      element.style.top = `${y}px`
      element.style.transform = 'none'
    }, {
      x: tooltipBox.x + 10,
      y: tooltipBox.y + 10
    })
    const indicatorsBox = await neighboringIndicators.boundingBox()
    expect(indicatorsBox).not.toBeNull()

    const overlapLeft = Math.max(tooltipBox.x, indicatorsBox.x)
    const overlapRight = Math.min(
      tooltipBox.x + tooltipBox.width,
      indicatorsBox.x + indicatorsBox.width
    )
    const overlapTop = Math.max(tooltipBox.y, indicatorsBox.y)
    const overlapBottom = Math.min(
      tooltipBox.y + tooltipBox.height,
      indicatorsBox.y + indicatorsBox.height
    )
    expect(overlapLeft).toBeLessThan(overlapRight)
    expect(overlapTop).toBeLessThan(overlapBottom)

    await tooltipText.evaluate(element => {
      element.style.pointerEvents = 'auto'
    })
    await expect.poll(() => page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y)
      return element !== null && element.closest('[role="tooltip"]') !== null
    }, {
      x: (overlapLeft + overlapRight) / 2,
      y: (overlapTop + overlapBottom) / 2
    })).toBe(true)
  })
})

test.describe('performance impact indicators', () => {
  // Pinned because the labels matched below are worded differently in the other
  // English locales, which is what the runner's system locale can resolve to
  test.use({ seed: { settings: { currentLocale: 'en-US' } } })

  test('only shows the badges once they are switched on', async ({ app }) => {
    const { page } = app
    const section = await goToSettingsSection(page, 'add-ons')

    await expect(section.locator('.performanceImpact')).toHaveCount(0)

    await page.getByRole('button', { name: 'Show performance impact indicators' }).click()

    const sponsorBlock = section.locator('.switch-ctn')
      .filter({ hasText: 'Enable SponsorBlock' })
    const deArrowThumbnails = section.locator('.switch-ctn')
      .filter({ hasText: 'Use DeArrow for thumbnails' })
    await expect(sponsorBlock.locator('.performanceImpact')).toHaveText('Moderate impact')
    await expect(deArrowThumbnails.locator('.performanceImpact')).toHaveText('High impact')
    // Settings without a notable cost stay unlabelled, so that the badges keep meaning something
    await expect(section.locator('.switch-ctn')
      .filter({ hasText: 'Enable SponsorBlock Submission' })
      .locator('.performanceImpact')).toHaveCount(0)

    await expect.poll(async () => {
      const settings = latestSettings(
        await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')
      )
      return settings.showPerformanceImpactIndicators
    }).toBe(true)
  })
})

test.describe('performance impact indicators on selects', () => {
  test.use({
    seed: {
      settings: {
        currentLocale: 'en-US',
        showPerformanceImpactIndicators: true
      }
    }
  })

  test('keeps the badge inside the select it belongs to', async ({ page }) => {
    const section = await goToSettingsSection(page, 'playback')

    const defaultQuality = section.locator('.select')
      .filter({ has: page.getByText('Default Quality', { exact: true }) })
    const badge = defaultQuality.locator('.performanceImpact')
    await expect(badge).toBeVisible()

    // The label floats above the select and never wraps, so a badge that is too
    // wide reaches into whichever setting sits in the next column
    const [selectBox, badgeBox] = await Promise.all([
      defaultQuality.boundingBox(),
      badge.boundingBox()
    ])
    expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(selectBox.x + selectBox.width)
  })
})

test.describe('localized compact settings breadcrumb', () => {
  test.use({ seed: { settings: { currentLocale: 'de-DE' } } })

  test('prioritizes the current category over the redundant root label', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 40,
        y: 40,
        width: 650,
        height: 520
      }))
    })
    await goToSettingsSection(page, 'focus')

    const breadcrumb = page.locator('.settingsBreadcrumb')
    const root = breadcrumb.locator('.settingsBreadcrumbRoot')
    const category = breadcrumb.locator('.settingsBreadcrumbLabel')

    await expect(page.locator('.settingsPage')).toHaveClass(/compactSettings/)
    await expect(root).toBeHidden()
    await expect(breadcrumb.locator('.settingsBreadcrumbSeparator').first()).toBeHidden()
    await expect(category.locator('.settingsBreadcrumbText')).toHaveText('Ablenkungsfreier Modus')
    await expect.poll(() => category.locator('.settingsBreadcrumbText').evaluate(element => (
      element.scrollWidth <= element.clientWidth + 1
    ))).toBe(true)
  })
})

test.describe('tabs from other synced devices', () => {
  test.use({
    seed: {
      settings: {
        currentLocale: 'en-US',
        syncServerEnabled: true,
        syncServerUsername: 'test-user',
        syncServerToken: 'offline-test-token',
        syncServerPrivacyMode: 'enhanced',
        syncServerSyncSessions: true,
        syncServerSharedTabs: false,
      }
    }
  })

  test('keeps synced tab sets in the tab organizer instead of settings', async ({ page }) => {
    const section = await goToSettingsSection(page, 'sync')
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setSyncServerOtherDeviceSessions', [{
        sessionId: 'desktop-session',
        syncDeviceId: 'desktop-device',
        syncPlatform: 'desktop',
        tabs: [
          { id: 'first', title: 'A long channel tab title', url: 'https://www.youtube.com/' },
          { id: 'second', title: 'Watch later', url: 'https://www.youtube.com/playlist?list=WL' },
        ],
      }])
    })

    await expect(section.getByRole('heading', { name: 'Tabs from other devices' })).toHaveCount(0)
  })
})
