import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { cloneDefaultCustomTheme } from '../../../src/customTheme.js'

import {
  test,
  expect,
  goTo,
  goToSettingsSection,
  openNewWindowFromTabBar,
  sel,
  waitForAppReady,
} from '../../helpers/app.mjs'

async function readSavedThemes (userDataDir) {
  const themeDirectory = path.join(userDataDir, 'themes')
  const files = (await readdir(themeDirectory)).filter(file => file.endsWith('.json'))
  const themes = await Promise.all(files.map(async file =>
    JSON.parse(await readFile(path.join(themeDirectory, file), 'utf8'))))
  return themes.sort((left, right) => left.name.localeCompare(right.name))
}

async function setWindowWidth (app, width) {
  await app.electronApp.evaluate(({ BrowserWindow }, targetWidth) => {
    const browserWindow = BrowserWindow.getAllWindows()[0]
    const bounds = browserWindow.getBounds()
    browserWindow.setBounds({ ...bounds, width: targetWidth })
  }, width)
}

async function enableVerticalTabBar (page, width) {
  await page.evaluate((tabBarWidth) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setTabBarPosition', 'left')
    store.commit('setVerticalTabBarWidth', tabBarWidth)
  }, width)
  await expect(page.locator('.app')).toHaveClass(/verticalTabs/)
}

async function expectHorizontalGap (left, right, expectedGap) {
  await expect.poll(async () => {
    const [leftBox, rightBox] = await Promise.all([
      left.boundingBox(),
      right.boundingBox()
    ])

    return leftBox !== null && rightBox !== null &&
      Math.abs(leftBox.y - rightBox.y) < 1 &&
      Math.abs(rightBox.x - leftBox.x - leftBox.width - expectedGap) <= 1
  }).toBe(true)
}

async function expectChangeMarkerClearOfPreviousSelect (left, right) {
  const [leftBox, rightSelectBox] = await Promise.all([
    left.boundingBox(),
    right.locator('..').boundingBox()
  ])

  expect(leftBox).not.toBeNull()
  expect(rightSelectBox).not.toBeNull()
  expect(rightSelectBox.x - leftBox.x - leftBox.width).toBeGreaterThanOrEqual(11)
}

async function getTabEdgeBorderCoverage (page, tab, edge, inset = 0) {
  const [screenshot, borderColor] = await Promise.all([
    tab.screenshot(),
    tab.evaluate((element, targetEdge) => {
      const style = getComputedStyle(element)
      return targetEdge === 'top' ? style.borderTopColor : style.borderBottomColor
    }, edge)
  ])

  return page.evaluate(async ({ base64, borderColor, edge, inset }) => {
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d')
    context.drawImage(bitmap, 0, 0)

    const target = borderColor.match(/\d+/g).slice(0, 3).map(Number)
    const row = edge === 'top' ? inset : bitmap.height - 1 - inset
    const pixels = context.getImageData(0, row, bitmap.width, 1).data
    let matchingPixels = 0
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (target.every((channel, index) => Math.abs(channel - pixels[offset + index]) <= 8)) {
        matchingPixels++
      }
    }

    return matchingPixels / bitmap.width
  }, { base64: screenshot.toString('base64'), borderColor, edge, inset })
}

test.describe('distraction and appearance settings', () => {
  test.use({
    seed: {
      settings: {
        baseTheme: 'dark',
        hideEndScreenAnnotations: true,
        hideTrendingVideos: true
      }
    }
  })

  test('hidden UI elements stay hidden and the theme applies', async ({ page, attachScreenshot }) => {
    // Trending is removed from the side nav entirely.
    await expect(page.locator(sel.sideNavLink('trending'))).toHaveCount(0)

    // Profile switching and quick settings always remain available in the header.
    await expect(page.locator('.topNav .profileTrigger')).toBeVisible()

    // The base theme is applied as a class on <body>.
    await expect(page.locator('body')).toHaveClass(/dark/)
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#0f0f0f')
    await expect(page.locator('body')).toHaveCSS('--card-bg-color', '#1f1f1f')

    await attachScreenshot('dark theme with the hidden elements')

    await goToSettingsSection(page, 'distraction')
    await expect(page.getByRole('checkbox', { name: 'Hide End-Screen Annotations' })).toBeChecked()
    await attachScreenshot('distraction settings')
  })
})

test.describe('default appearance', () => {
  test('trending link and profile selector are visible by default', async ({ page, attachScreenshot }) => {
    // The link may live in the side nav itself or its "More" flyout,
    // depending on the collapsed state — either way it must exist.
    await expect(page.locator(sel.sideNavLink('trending'))).not.toHaveCount(0)
    await expect(page.locator('.topNav .profileTrigger')).toBeVisible()
    await expect(page.locator('body')).toHaveClass(/(?:light|dark)/)
    await attachScreenshot('default appearance')
  })

  test('selects every tab layout from Theme settings instead of the header', async ({ page, attachScreenshot }) => {
    await expect(page.locator('.navTabLayoutButton')).toHaveCount(0)
    const themeSection = await goToSettingsSection(page, 'theme')
    const layout = themeSection.getByRole('combobox', { name: 'Tab Layout' })
    await expect(layout).toHaveText('Horizontal at top')
    for (const [label, className] of [
      ['Horizontal at bottom', 'position-bottom'],
      ['Vertical on left', 'position-left'],
      ['Vertical on right', 'position-right'],
      ['Horizontal at top', 'position-top']
    ]) {
      await layout.click()
      await page.locator(`#${await layout.getAttribute('aria-controls')}`)
        .getByRole('option', { name: label, exact: true }).click()
      const tabBar = page.locator(`.tabBar.${className}`)
      await expect(tabBar).toBeVisible()
      await expect(layout).toHaveText(label)

      if (className === 'position-bottom' || className === 'position-top') {
        const activeTab = tabBar.locator('.tab.active')
        const insets = await tabBar.evaluate((element) => {
          const barBounds = element.getBoundingClientRect()
          const tab = element.querySelector('.tab.active')
          const tabBounds = tab.getBoundingClientRect()
          return {
            bottom: barBounds.bottom - tabBounds.bottom,
            bottomBorder: getComputedStyle(tab).borderBottomWidth,
            top: tabBounds.top - barBounds.top,
            topBorder: getComputedStyle(tab).borderTopWidth,
          }
        })

        if (className === 'position-bottom') {
          expect(insets).toEqual({
            bottom: 4,
            bottomBorder: '1px',
            top: 0,
            topBorder: '0px',
          })
          const clipClearance = await activeTab.evaluate((element) => {
            return element.parentElement.getBoundingClientRect().bottom -
              element.getBoundingClientRect().bottom
          })
          expect(clipClearance).toBeGreaterThanOrEqual(1)
          expect(await getTabEdgeBorderCoverage(page, activeTab, 'bottom')).toBeGreaterThan(0.7)
          await attachScreenshot('horizontal tabs at bottom with safe inset')
        } else {
          expect(insets).toEqual({
            bottom: 0,
            bottomBorder: '0px',
            top: 2,
            topBorder: '1px',
          })
          expect(await getTabEdgeBorderCoverage(page, activeTab, 'top')).toBeGreaterThan(0.7)
          await attachScreenshot('horizontal tabs at top')
        }
      }
    }
  })

  test('shows color swatches in every color-theme selector', async ({ page }) => {
    const themeSection = await goToSettingsSection(page, 'theme')
    const mainColor = themeSection.getByRole('combobox', { name: /Main colou?r theme/i })
    const secondaryColor = themeSection.getByRole('combobox', { name: /Secondary colou?r theme/i })

    await expect(mainColor.locator('.optionColorDot')).toHaveCSS('background-color', 'rgb(213, 0, 0)')
    await expect(secondaryColor.locator('.optionColorDot')).toHaveCSS('background-color', 'rgb(41, 98, 255)')
    await mainColor.click()
    const options = page.locator(`#${await mainColor.getAttribute('aria-controls')}`)
    await expect(options.getByRole('option', { name: 'Blue', exact: true }).locator('.optionColorDot'))
      .toHaveCSS('background-color', 'rgb(41, 98, 255)')
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Create custom theme' }).click()
    const editor = page.locator('.customThemeEditor')
    await expect(editor.getByRole('combobox', { name: /Main colou?r theme/i }).locator('.optionColorDot'))
      .toBeVisible()
    await expect(editor.getByRole('combobox', { name: /Secondary colou?r theme/i }).locator('.optionColorDot'))
      .toBeVisible()
  })

  test('maps system light and dark modes to chosen themes', async ({ app, page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await goToSettingsSection(page, 'theme')

    const lightTheme = page.getByRole('combobox', { name: 'Light theme' })
    const darkTheme = page.getByRole('combobox', { name: 'Dark theme' })
    const mainColorTheme = page.getByRole('combobox', { name: /Main colou?r theme/i })
    const secondaryColorTheme = page.getByRole('combobox', { name: /Secondary colou?r theme/i })
    await expect(lightTheme).toHaveText('Light')
    await expect(darkTheme).toHaveText('Dark')
    await expectHorizontalGap(lightTheme, darkTheme, 24)
    await expectHorizontalGap(mainColorTheme, secondaryColorTheme, 24)
    await page.getByRole('button', { name: 'Highlight settings changed from defaults' }).click()
    await expectHorizontalGap(lightTheme, darkTheme, 12)
    await expectHorizontalGap(mainColorTheme, secondaryColorTheme, 12)
    await expect(page.locator('.select').filter({ has: lightTheme }).locator('.select-icon')).toBeVisible()
    await expect(page.locator('.select').filter({ has: darkTheme }).locator('.select-icon')).toBeVisible()

    await lightTheme.click()
    const lightThemeOptions = page.locator(`#${await lightTheme.getAttribute('aria-controls')}`)
    await expect(lightThemeOptions.getByRole('option', { name: 'Catppuccin Frappe', exact: true }))
      .toHaveCount(0)
    await expect(lightThemeOptions.getByRole('option', { name: 'Catppuccin Latte', exact: true }))
      .toBeVisible()
    await lightThemeOptions.getByRole('option', { name: 'Catppuccin Latte', exact: true }).click()
    await expect(page.locator('body')).toHaveClass(/catppuccinLatte/)

    await darkTheme.click()
    const darkThemeOptions = page.locator(`#${await darkTheme.getAttribute('aria-controls')}`)
    await expect(darkThemeOptions.getByRole('option', { name: 'Catppuccin Latte', exact: true }))
      .toHaveCount(0)
    await expect(darkThemeOptions.getByRole('option', { name: 'Catppuccin Mocha', exact: true }))
      .toBeVisible()
    await darkThemeOptions.getByRole('option', { name: 'Catppuccin Mocha', exact: true }).click()
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(page.locator('body')).toHaveClass(/catppuccinMocha/)

    ;({ page } = await app.relaunch())
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(page.locator('body')).toHaveClass(/catppuccinMocha/)
  })

  test('repairs a reclassified system theme in every open window', async ({ app, page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await goToSettingsSection(page, 'theme')
    await page.getByRole('button', { name: 'Create custom theme' }).click()
    await page.getByRole('textbox', { name: 'Theme name' }).fill('Paper')
    await page.getByRole('button', { name: 'Save and apply' }).click()

    const baseTheme = page.getByRole('combobox', { name: 'Base Theme' })
    await baseTheme.click()
    await page.locator(`#${await baseTheme.getAttribute('aria-controls')}`)
      .getByRole('option', { name: /System default/i }).click()
    const lightTheme = page.getByRole('combobox', { name: 'Light theme' })
    await lightTheme.click()
    await page.locator(`#${await lightTheme.getAttribute('aria-controls')}`)
      .getByRole('option', { name: 'Paper', exact: true }).click()
    await page.locator('.settingsCloseButton').click()

    const secondWindow = await openNewWindowFromTabBar(app, page)
    await waitForAppReady(secondWindow)
    await secondWindow.emulateMedia({ colorScheme: 'light' })
    await expect(page.locator('body')).toHaveClass(/custom/)
    await expect(secondWindow.locator('body')).toHaveClass(/custom/)

    await goToSettingsSection(page, 'theme')
    await page.getByRole('button', { name: 'Edit custom theme' }).click()
    await page.locator('label.switch-label').filter({ hasText: 'Dark theme' }).click()
    await page.getByRole('button', { name: 'Save and apply' }).click()

    for (const openWindow of [page, secondWindow]) {
      await expect.poll(() => openWindow.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        return store.getters.getSystemLightTheme
      })).toBe('light')
      await expect(openWindow.locator('body')).toHaveClass(/light/)
      await expect(openWindow.locator('body')).not.toHaveClass(/custom/)
    }
  })

  test('keeps a changed theme marker clear of the previous select', async ({ page }) => {
    await goToSettingsSection(page, 'theme')

    const lightTheme = page.getByRole('combobox', { name: 'Light theme' })
    const darkTheme = page.getByRole('combobox', { name: 'Dark theme' })
    await darkTheme.click()
    await page.locator(`#${await darkTheme.getAttribute('aria-controls')}`)
      .getByRole('option', { name: 'Catppuccin Mocha', exact: true }).click()

    const darkThemeSelect = page.locator('.select').filter({ has: darkTheme })
    await expect(darkThemeSelect.locator('.changedSettingIndicator')).toBeVisible()
    await expectChangeMarkerClearOfPreviousSelect(lightTheme, darkTheme)
  })

  test.describe('at 95% UI scale', () => {
    test.use({ seed: { settings: { uiScale: 95 } } })

    test('keeps predictable spacing between paired theme selects', async ({ page }) => {
      await goToSettingsSection(page, 'theme')

      const lightTheme = page.getByRole('combobox', { name: 'Light theme' })
      const darkTheme = page.getByRole('combobox', { name: 'Dark theme' })
      await expectHorizontalGap(lightTheme, darkTheme, 24)
      await page.getByRole('button', { name: 'Highlight settings changed from defaults' }).click()
      await expectHorizontalGap(lightTheme, darkTheme, 12)
    })
  })

  test('lists installed fonts and persists the selected app font', async ({ app, page }) => {
    await goToSettingsSection(page, 'theme')

    const appFont = page.getByRole('combobox', { name: 'App font' })
    await expect(appFont).toHaveText('Roboto')
    await expect(page.locator('.select').filter({ has: appFont }).locator('.select-icon')).toBeVisible()
    await appFont.click()

    const fontDropdown = page.locator(`#${await appFont.getAttribute('aria-controls')}`)
    const fontOptions = fontDropdown.getByRole('option')
    await expect.poll(() => fontOptions.count()).toBeGreaterThan(3)
    await expect(fontOptions.nth(0)).toHaveText('Roboto')
    await expect(fontOptions.nth(1)).toHaveText('System default')
    await expect(fontDropdown).toHaveClass(/below/)
    expect(await page.evaluate(([buttonId, dropdownId]) => {
      const button = document.getElementById(buttonId).getBoundingClientRect()
      const dropdown = document.getElementById(dropdownId).getBoundingClientRect()
      return Math.abs(dropdown.top - button.bottom - 4)
    }, [await appFont.getAttribute('id'), await fontDropdown.getAttribute('id')])).toBeLessThanOrEqual(2)

    await page.setViewportSize({ width: 600, height: 320 })
    await expect.poll(() => fontDropdown.evaluate(menu => menu.clientWidth)).toBeLessThanOrEqual(584)
    await appFont.evaluate(element => element.scrollIntoView({ block: 'center' }))
    await expect.poll(() => fontDropdown.evaluate(menu => menu.scrollHeight - menu.clientHeight))
      .toBeGreaterThan(0)
    await fontDropdown.evaluate(menu => { menu.scrollTop = menu.scrollHeight })
    await expect.poll(() => fontDropdown.evaluate(menu => menu.scrollTop)).toBeGreaterThan(0)
    await page.setViewportSize({ width: 1200, height: 720 })
    await expect.poll(() => fontDropdown.evaluate(menu => {
      const lastOption = menu.querySelector('.selectOption:last-of-type')
      const offsetTopFromDocument = (element) => {
        let offsetTop = 0
        for (let current = element; current !== null; current = current.offsetParent) {
          offsetTop += current.offsetTop
        }
        return offsetTop
      }
      const contentEnd = offsetTopFromDocument(lastOption) - offsetTopFromDocument(menu) +
        lastOption.offsetHeight + Number.parseFloat(getComputedStyle(menu).paddingBottom)
      const maximumScrollTop = Math.max(0, contentEnd - menu.clientHeight)
      return Math.abs(menu.scrollTop - maximumScrollTop) <= 1
    })).toBe(true)
    await appFont.evaluate(element => element.scrollIntoView({ block: 'center' }))
    await expect(appFont).toBeInViewport()
    await fontDropdown.evaluate(menu => { menu.scrollTop = 0 })

    const selectedFont = (await fontOptions.nth(3).textContent()).trim()
    await fontOptions.nth(3).click()
    await expect(appFont).toHaveText(selectedFont)
    expect(await page.locator('body').evaluate(body => getComputedStyle(body).fontFamily))
      .toContain(selectedFont)

    await appFont.click()
    await expect(fontOptions.nth(0)).toHaveText('Roboto')
    await expect(fontOptions.nth(1)).toHaveText('System default')
    await expect(fontOptions.nth(3)).toHaveText(selectedFont)
    await expect(fontOptions.nth(3)).toHaveAttribute('aria-selected', 'true')
    await appFont.click()

    await page.locator('.settingsCloseButton').click()
    await page.locator('.profileTrigger').click()
    const profileSummary = page.locator('.profileSummary')
    await expect(profileSummary).toBeVisible()
    expect(await profileSummary.evaluate(element => getComputedStyle(element).fontFamily))
      .toContain(selectedFont)

    ;({ page } = await app.relaunch())
    expect(await page.locator('body').evaluate(body => getComputedStyle(body).fontFamily))
      .toContain(selectedFont)

    await goToSettingsSection(page, 'theme')
    const relaunchedAppFont = page.getByRole('combobox', { name: 'App font' })
    await relaunchedAppFont.click()
    const relaunchedFontOptions = page.locator(`#${await relaunchedAppFont.getAttribute('aria-controls')}`)
      .getByRole('option')
    await expect.poll(() => relaunchedFontOptions.count()).toBeGreaterThan(3)
    await expect(relaunchedFontOptions.nth(0)).toHaveText('Roboto')
    await expect(relaunchedFontOptions.nth(1)).toHaveText('System default')
    await expect(relaunchedFontOptions.nth(3)).toHaveText(selectedFont)
    await expect(relaunchedFontOptions.nth(3)).toHaveAttribute('aria-selected', 'true')
  })
})

test.describe('custom theme editor', () => {
  test.use({
    seed: {
      settings: {
        baseTheme: 'dark',
        quickSettings: ['baseTheme', 'mainColor'],
      },
    },
  })

  test('imports clipboard themes as new drafts and saves only on confirmation', async ({ app, page }) => {
    const theme = cloneDefaultCustomTheme()
    theme.name = 'Clipboard midnight'
    theme.colors.background = '#112233'
    await app.electronApp.evaluate(({ clipboard }, text) => clipboard.writeText(text), JSON.stringify(theme))
    await goToSettingsSection(page, 'theme')
    await page.getByRole('button', { name: 'Create custom theme' }).click()
    const importButton = page.getByRole('button', { name: 'Import from clipboard' })
    await expect(importButton.locator('.ft-icon')).toBeVisible()
    await importButton.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('textbox', { name: 'Theme name' })).toHaveValue(theme.name)
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#112233')
    expect(await page.evaluate(() => window.ftElectron.loadCustomTheme())).toEqual([])
    await page.getByRole('button', { name: 'Save and apply' }).click()
    const saved = await page.evaluate(() => window.ftElectron.loadCustomTheme())
    expect(saved).toHaveLength(1)
    expect(saved[0].id).not.toBe(theme.id)
    expect(saved[0].colors.background).toBe('#112233')

    await page.emulateMedia({ colorScheme: 'dark' })
    await page.evaluate(async (themeId) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateSystemDarkTheme', `custom:${themeId}`)
      await store.dispatch('updateBaseTheme', 'system')
    }, saved[0].id)
    await page.getByRole('button', { name: 'Edit custom theme' }).click()
    await importButton.click()
    await page.getByRole('button', { name: 'Save and apply' }).click()
    const importedAgain = await page.evaluate(() => window.ftElectron.loadCustomTheme())
    expect(importedAgain).toHaveLength(2)
    expect(new Set(importedAgain.map(({ id }) => id)).size).toBe(2)
    expect(importedAgain).toContainEqual(saved[0])
    const importedId = importedAgain.find(({ id }) => id !== saved[0].id).id
    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.getters.getBaseTheme
    })).toBe(`custom:${importedId}`)
  })

  test('ignores clipboard imports after the editor unmounts', async ({ app, page }) => {
    const theme = cloneDefaultCustomTheme()
    theme.colors.background = '#112233'
    await app.electronApp.evaluate(({ clipboard }) => {
      clipboard.readText = () => new Promise(resolve => {
        globalThis.resolveThemeClipboardRead = (text) => {
          clipboard.readText = () => ''
          resolve(text)
        }
      })
    })
    await goToSettingsSection(page, 'theme')
    await page.getByRole('button', { name: 'Create custom theme' }).click()
    await page.getByRole('button', { name: 'Import from clipboard' }).click()
    await expect.poll(() => app.electronApp.evaluate(() =>
      typeof globalThis.resolveThemeClipboardRead)).toBe('function')
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setSettingsWindowView', 'about')
    })
    await expect(page.locator('.customThemeEditor')).toHaveCount(0)
    const background = await page.locator('body').evaluate(element => element.style.getPropertyValue('--bg-color'))
    await app.electronApp.evaluate((_, text) => globalThis.resolveThemeClipboardRead(text), JSON.stringify(theme))
    await page.evaluate(() => window.ftElectron.readClipboard())
    // Observe the completed IPC result before checking that no preview was applied.
    await page.waitForTimeout(500)
    await expect(page.locator('body')).toHaveCSS('--bg-color', background)
    expect(await page.evaluate(() => window.ftElectron.loadCustomTheme())).toEqual([])
  })

  test('reports clipboard read failures without replacing the draft', async ({ app, page }) => {
    await app.electronApp.evaluate(({ clipboard }) => {
      clipboard.readText = () => { throw new Error('Clipboard read failed') }
    })
    await goToSettingsSection(page, 'theme')
    await page.getByRole('button', { name: 'Create custom theme' }).click()
    const name = page.getByRole('textbox', { name: 'Theme name' })
    await name.fill('Keep my draft')
    await page.getByRole('button', { name: 'Import from clipboard' }).click()
    await expect(page.locator('.toast').filter({ hasText: 'Clipboard unavailable' })).toBeVisible()
    await expect(name).toHaveValue('Keep my draft')
  })

  test('ignores clipboard read failures after leaving the editor session', async ({ app, page }) => {
    const staleErrors = []
    page.on('console', message => {
      if (message.type() === 'error' && message.text().includes('Delayed clipboard failure')) {
        staleErrors.push(message.text())
      }
    })
    await app.electronApp.evaluate(({ clipboard }) => {
      clipboard.readText = () => new Promise((resolve, reject) => {
        globalThis.rejectThemeClipboardRead = () => {
          clipboard.readText = () => ''
          reject(new Error('Delayed clipboard failure'))
        }
      })
    })
    await goToSettingsSection(page, 'theme')
    await page.getByRole('button', { name: 'Create custom theme' }).click()
    await page.getByRole('button', { name: 'Import from clipboard' }).click()
    await expect.poll(() => app.electronApp.evaluate(() =>
      typeof globalThis.rejectThemeClipboardRead)).toBe('function')
    await page.locator('.settingsBackButton').click()
    await page.getByRole('button', { name: 'Create custom theme' }).click()
    await page.getByRole('textbox', { name: 'Theme name' }).fill('New session')
    await app.electronApp.evaluate(() => globalThis.rejectThemeClipboardRead())
    // A second IPC round trip lets the renderer process the earlier rejection.
    await page.evaluate(() => window.ftElectron.readClipboard())
    // Allow deferred toast rendering before asserting that no stale error appears.
    await page.waitForTimeout(500)
    expect(staleErrors).toEqual([])
    await expect(page.locator('.toast').filter({ hasText: 'Delayed clipboard failure' })).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Theme name' })).toHaveValue('New session')
  })

  test('keeps clipboard import controls visible in narrow and scaled windows', async ({ app, page }, testInfo) => {
    await goToSettingsSection(page, 'theme')
    await page.getByRole('button', { name: 'Create custom theme' }).click()
    for (const [width, scale] of [[1200, 1], [420, 1], [500, 1.25]]) {
      await setWindowWidth(app, width)
      await page.evaluate(value => window.ftElectron.setZoomFactor(value), scale)
      const buttons = page.locator('.fileActions button')
      await expect(buttons).toHaveCount(4)
      for (const button of await buttons.all()) {
        await expect(button).toBeInViewport({ ratio: 1 })
      }
      await expect.poll(() => page.locator('.editorHeader').evaluate(element =>
        element.scrollWidth <= element.clientWidth)).toBe(true)
    }
    await page.evaluate(() => window.ftElectron.setZoomFactor(1))
    await page.screenshot({ path: testInfo.outputPath('clipboard-import.png') })
  })

  test('preserves the draft when clipboard themes are empty or invalid', async ({ app, page }) => {
    await goToSettingsSection(page, 'theme')
    await page.getByRole('button', { name: 'Create custom theme' }).click()
    const name = page.getByRole('textbox', { name: 'Theme name' })
    await name.fill('Keep my draft')
    const originalBackground = await page.locator('body').evaluate(element => element.style.getPropertyValue('--bg-color'))
    for (const text of ['', 'not JSON', '{"name":"Missing colors"}']) {
      await app.electronApp.evaluate(({ clipboard }, value) => clipboard.writeText(value), text)
      await page.getByRole('button', { name: 'Import from clipboard' }).click()
      await expect(page.locator('.toast').filter({ hasText: 'Clipboard does not contain a valid theme' }).last()).toBeVisible()
      await expect(name).toHaveValue('Keep my draft')
      await expect(page.locator('body')).toHaveCSS('--bg-color', originalBackground)
      expect(await page.evaluate(() => window.ftElectron.loadCustomTheme())).toEqual([])
    }
  })

  test('clamps the color-source list after a responsive reflow', async ({ app, page }) => {
    await setWindowWidth(app, 420)
    await goToSettingsSection(page, 'theme')
    await page.getByRole('button', { name: 'Create custom theme' }).click()
    await page.getByRole('button', { name: 'Page background', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Page background' })
    await picker.getByRole('button', { name: 'Copy from another color' }).click()

    const list = page.locator('.colorSourceList')
    await expect(list).toHaveAttribute('data-overlayscrollbars-viewport')
    await list.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    await setWindowWidth(app, 1200)
    await expect.poll(() => list.evaluate((element) => {
      const content = element.querySelector('.colorSourceContent')
      const contentEnd = content.offsetTop + content.offsetHeight +
        Number.parseFloat(getComputedStyle(element).paddingBottom)
      return element.scrollTop <= Math.max(0, contentEnd - element.clientHeight) + 1
    })).toBe(true)
  })

  test('moves keyboard focus into the color picker', async ({ page }) => {
    await goToSettingsSection(page, 'theme')
    await page.getByRole('button', { name: 'Create custom theme' }).click()

    const trigger = page.getByRole('button', { name: 'Page background', exact: true })
    await trigger.focus()
    await page.keyboard.press('Enter')

    const picker = page.getByRole('dialog', { name: 'Page background' })
    const saturationSlider = picker.getByRole('slider', { name: 'Saturation and brightness' })
    await expect(saturationSlider).toBeFocused()
    const valueBefore = await saturationSlider.getAttribute('aria-valuetext')
    await page.keyboard.press('ArrowRight')
    await expect(saturationSlider).not.toHaveAttribute('aria-valuetext', valueBefore)

    await page.keyboard.press('Escape')
    await expect(picker).toHaveCount(0)
    await expect(trigger).toBeFocused()

    await page.keyboard.press('Enter')
    await picker.getByRole('button', { name: 'Apply' }).click()
    await expect(picker).toHaveCount(0)
    await expect(trigger).toBeFocused()
  })

  test('shows keyboard focus feedback inside the teleported color picker', async ({ page }) => {
    await goToSettingsSection(page, 'theme')
    await page.getByRole('button', { name: 'Create custom theme' }).click()

    const trigger = page.getByRole('button', { name: 'Page background', exact: true })
    await trigger.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(trigger).toBeFocused()
    await page.keyboard.press('Enter')

    const picker = page.getByRole('dialog', { name: 'Page background' })
    const hexInput = picker.getByRole('textbox', { name: 'Hex color' })
    await hexInput.focus()

    await expect(page.locator('.app')).not.toHaveClass(/hideOutlines/)
    await expect(page.locator('.app').getByRole('dialog', { name: 'Page background' })).toHaveCount(0)
    await expect(hexInput).toHaveCSS('outline-style', 'solid')
    await expect(hexInput).not.toHaveCSS('box-shadow', 'none')

    await hexInput.click()
    await expect(page.locator('.app')).toHaveClass(/hideOutlines/)
    await expect(hexInput).toHaveCSS('outline-style', 'none')
    await expect(hexInput).toHaveCSS('box-shadow', 'none')
  })

  test('keeps the hue when dragging outside the saturation and brightness area', async ({ page }) => {
    await goToSettingsSection(page, 'theme')
    await page.getByRole('button', { name: 'Create custom theme' }).click()
    await page.getByRole('button', { name: 'Page background', exact: true }).click()

    const picker = page.getByRole('dialog', { name: 'Page background' })
    const hexInput = picker.getByRole('textbox', { name: 'Hex color' })
    const hueSlider = picker.locator('.hueSlider')
    await hexInput.fill('#00ff00')
    await hexInput.press('Enter')
    await expect(hueSlider).toHaveValue('120')

    const saturationSlider = picker.getByRole('slider', { name: 'Saturation and brightness' })
    const bounds = await saturationSlider.boundingBox()
    expect(bounds).not.toBeNull()
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await page.mouse.down()
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height + 50)
    await expect(hueSlider).toHaveValue('120')
    await page.mouse.up()

    await expect(hueSlider).toHaveValue('120')
  })

  test('applies a new theme created from System Default', async ({ page }) => {
    await goToSettingsSection(page, 'theme')
    const baseTheme = page.getByRole('combobox', { name: 'Base Theme' })
    await baseTheme.click()
    await page.locator(`#${await baseTheme.getAttribute('aria-controls')}`)
      .getByRole('option', { name: /System default/i }).click()
    await page.getByRole('button', { name: 'Create custom theme' }).click()
    await page.getByRole('button', { name: 'Save and apply' }).click()
    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.getters.getBaseTheme
    })).toMatch(/^custom:/)
  })

  test('opens a pre-filled theme discussion with the current draft', async ({ app, page }) => {
    await app.electronApp.evaluate(({ shell }) => {
      globalThis.openedThemeDiscussionUrl = null
      shell.openExternal = async (url) => {
        globalThis.openedThemeDiscussionUrl = url
      }
    })
    await goToSettingsSection(page, 'theme')
    await page.getByRole('button', { name: 'Create custom theme' }).click()
    await page.getByRole('textbox', { name: 'Theme name' }).fill('Aurora & Night')

    const shareButton = page.getByRole('button', { name: 'Share theme' })
    await expect(shareButton.locator('.ft-icon')).toBeVisible()
    await shareButton.click()

    await expect.poll(() => app.electronApp.evaluate(() => {
      return globalThis.openedThemeDiscussionUrl
    })).not.toBeNull()
    const openedUrl = await app.electronApp.evaluate(() => globalThis.openedThemeDiscussionUrl)
    const discussionUrl = new URL(openedUrl)
    expect(discussionUrl.origin).toBe('https://github.com')
    expect(discussionUrl.pathname).toBe('/OpenTubeX/OpenTubeX/discussions/new')
    expect(discussionUrl.searchParams.get('category')).toBe('themes')
    expect(discussionUrl.searchParams.get('title')).toBe('Aurora & Night')

    const body = discussionUrl.searchParams.get('body')
    expect(body).toContain('## Description')
    expect(body).toContain('## Screenshots')
    expect(body).toContain('Leave this section empty for the bot to add three previews using sample content, without your personal data.')
    expect(body).toContain('<!-- theme-screenshots:start -->')
    expect(body).toContain('<!-- theme-screenshots:end -->')
    expect(body).toContain('<details>')
    expect(body).toContain('<summary>Theme JSON</summary>')
    const themeJson = body.match(/```json\n([\s\S]+)\n```/)
    expect(themeJson).not.toBeNull()
    expect(JSON.parse(themeJson[1])).toMatchObject({
      version: 2,
      name: 'Aurora & Night',
      basedOn: 'dark'
    })
  })

  test('copies built-in themes, previews efficiently, persists, and survives closing settings', async ({ app, page }) => {
    await goToSettingsSection(page, 'theme')
    await page.getByRole('button', { name: 'Highlight settings changed from defaults' }).click()
    await page.getByRole('button', { name: 'Create custom theme' }).click()

    const creatorBreadcrumb = page.locator('.settingsBreadcrumbLabel')
      .filter({ hasText: 'Custom theme creator' })
    await expect(creatorBreadcrumb.locator('.settingsBreadcrumbSubpageIcon'))
      .toHaveAttribute('data-icon', 'palette')
    await expect(page.getByRole('searchbox', { name: 'Search settings' })).toHaveCount(0)

    const editor = page.locator('.customThemeEditor')
    const resetColorsButton = editor.getByRole('button', { name: 'Reset to base theme' })
    await expect(resetColorsButton.locator('.ft-icon')).toBeVisible()
    await expect(resetColorsButton).toBeDisabled()
    await expect(editor.getByText('Instance menu', { exact: true })).toHaveCount(0)
    await expect(editor.getByText('Visited accent', { exact: true })).toHaveCount(0)
    await editor.getByRole('textbox', { name: 'Theme name' }).fill('Midnight')
    const optionsRow = editor.locator('.themeSources')
    const [editorBox, colorGridBox] = await Promise.all([
      editor.boundingBox(),
      editor.locator('.colorGrid').boundingBox()
    ])
    expect(colorGridBox.y - editorBox.y).toBeLessThan(200)
    await expect(optionsRow.getByRole('checkbox', { name: 'Dark theme' })).toBeVisible()
    await expect(optionsRow.getByRole('combobox', { name: 'Based on' })).toBeVisible()
    const sourceMainColor = optionsRow.getByRole('combobox', { name: /Main colou?r theme/i })
    const sourceSecondaryColor = optionsRow.getByRole('combobox', { name: /Secondary colou?r theme/i })
    await expect(sourceMainColor).toHaveText('Red')
    await expect(sourceSecondaryColor).toHaveText('Blue')
    await expect(editor.locator('.changedSettingIndicatorPlaceholder')).toHaveCount(0)
    const optionControlCenters = await optionsRow.evaluate((options) => {
      const select = options.querySelector('.select-text').getBoundingClientRect()
      const toggle = options.querySelector('.switch-label').getBoundingClientRect()
      return {
        select: select.y + select.height / 2,
        toggle: toggle.y + toggle.height / 2
      }
    })
    expect(optionControlCenters.toggle).toBeCloseTo(optionControlCenters.select, 0)

    await sourceMainColor.click()
    await page.locator(`#${await sourceMainColor.getAttribute('aria-controls')}`)
      .getByRole('option', { name: 'Green', exact: true }).click()
    await expect(page.locator('body')).toHaveCSS('--primary-color', '#4caf50')
    await sourceSecondaryColor.click()
    await page.locator(`#${await sourceSecondaryColor.getAttribute('aria-controls')}`)
      .getByRole('option', { name: 'Purple', exact: true }).click()
    await expect(page.locator('body')).toHaveCSS('--accent-color', '#9c27b0')

    const basedOn = page.getByRole('combobox', { name: 'Based on' })

    const setEditorColor = async (label, value) => {
      await editor.getByRole('button', { name: label, exact: true }).click()
      const picker = page.getByRole('dialog', { name: label })
      await picker.getByRole('textbox', { name: 'Hex color' }).fill(value)
      await picker.getByRole('textbox', { name: 'Hex color' }).press('Enter')
      await picker.getByRole('button', { name: 'Apply' }).click()
    }

    await setEditorColor('Logo icon', '#123456')
    await expect(resetColorsButton).toBeEnabled()
    await setEditorColor('Logo text', '#654321')
    await setEditorColor('Selected text background', '#345678')
    await setEditorColor('Selected text', '#fedcba')
    await expect.poll(() => page.evaluate(() => {
      const selectionStyle = getComputedStyle(document.body, '::selection')
      return [selectionStyle.backgroundColor, selectionStyle.color]
    })).toEqual(['rgb(52, 86, 120)', 'rgb(254, 220, 186)'])
    await expect(page.locator('.topNav .searchInput .ft-input')).toHaveCSS('line-height', '20px')
    await setEditorColor('Page background', '#101112')
    await sourceMainColor.click()
    await page.locator(`#${await sourceMainColor.getAttribute('aria-controls')}`)
      .getByRole('option', { name: 'Orange', exact: true }).click()
    await expect(page.locator('body')).toHaveCSS('--primary-color', '#ff9800')
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#101112')
    await expect(editor.locator('.ftColorPicker').filter({ hasText: 'Logo icon' }).locator('code'))
      .toHaveText('#123456')
    await sourceSecondaryColor.click()
    await page.locator(`#${await sourceSecondaryColor.getAttribute('aria-controls')}`)
      .getByRole('option', { name: 'Teal', exact: true }).click()
    await expect(page.locator('body')).toHaveCSS('--accent-color', '#009688')
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#101112')
    await expect(editor.locator('.ftColorPicker').filter({ hasText: 'Logo text' }).locator('code'))
      .toHaveText('#654321')
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setBarColor', true)
    })
    await expect(page.locator('.topNav')).toHaveClass(/topNavBarColor/)
    await page.mouse.move(0, 0)
    await expect(page.locator('.topNav .logoIcon')).toHaveCSS('background-image', 'none')
    await expect(page.locator('.topNav .logoText')).toHaveCSS('background-image', 'none')
    await expect(page.locator('.topNav .logoIcon')).toHaveCSS('background-color', 'rgb(18, 52, 86)')
    await expect(page.locator('.topNav .logoText')).toHaveCSS('background-color', 'rgb(101, 67, 33)')
    await setEditorColor('Logo hover', '#abcdef')
    await page.locator('.settingsCloseButton').click()
    await expect(page.locator('.settingsWindow')).toBeHidden()
    await page.locator('.topNav .logo').hover()
    await expect(page.locator('.topNav .logoIcon')).toHaveCSS('background-color', 'rgb(171, 205, 239)')
    await expect(page.locator('.topNav .logoText')).toHaveCSS('background-color', 'rgb(171, 205, 239)')
    await goTo(page, 'settings')
    await expect(editor).toBeVisible()

    await setEditorColor('Scrollbar thumb hover', '#345678')
    await expect(page.locator('.os-scrollbar').first()).toHaveCSS('--os-handle-bg-hover', '#345678')

    await setEditorColor('Dropdown item hover text', '#fedcba')
    await basedOn.click()
    await expect(page.getByRole('option', { name: 'System Default' })).toHaveCount(0)
    await page.getByRole('option', { name: 'Dark', exact: true }).hover()
    await expect(page.getByRole('option', { name: 'Dark', exact: true })).toHaveCSS('color', 'rgb(254, 220, 186)')
    await page.getByRole('option', { name: 'Light', exact: true }).click()
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#f1f1f1')
    await basedOn.click()
    await page.locator(`#${await basedOn.getAttribute('aria-controls')}`)
      .getByRole('option', { name: 'Dark', exact: true }).click()

    const backgroundField = editor.locator('.ftColorPicker')
      .filter({ has: page.getByText('Page background', { exact: true }) })
    const backgroundValue = backgroundField.locator('code')
    await expect(backgroundValue).toHaveText('#0f0f0f')
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#0f0f0f')
    await expect(resetColorsButton).toBeDisabled()

    await backgroundField.getByRole('button', { name: 'Page background' }).click()
    let backgroundPicker = page.getByRole('dialog', { name: 'Page background' })
    await expect(backgroundPicker.getByRole('button', { name: 'Reset' })).toBeDisabled()
    await backgroundPicker.getByRole('textbox', { name: 'Hex color' }).fill('#33445580')
    await backgroundPicker.getByRole('textbox', { name: 'Hex color' }).press('Enter')
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#33445580')
    await expect(backgroundPicker.getByRole('button', { name: 'Reset' })).toBeEnabled()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Page background' })).toHaveCount(0)
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#0f0f0f')

    await backgroundField.getByRole('button', { name: 'Page background' }).click()
    backgroundPicker = page.getByRole('dialog', { name: 'Page background' })
    await backgroundPicker.getByRole('textbox', { name: 'Hex color' }).fill('#445566')
    await backgroundPicker.getByRole('textbox', { name: 'Hex color' }).press('Enter')
    await backgroundPicker.getByRole('button', { name: 'Apply' }).click()
    await expect(backgroundValue).toHaveText('#445566')
    await expect(resetColorsButton).toBeEnabled()

    const darkTheme = page.getByRole('checkbox', { name: 'Dark theme' })
    await expect(darkTheme).toBeChecked()
    await page.locator('label.switch-label').filter({ hasText: 'Dark theme' }).click()
    await expect(page.locator('body')).toHaveAttribute('data-custom-theme', 'light')

    await setEditorColor('Primary control hover and focus', '#123456')
    await setEditorColor('Primary control pressed', '#234567')
    await setEditorColor('Secondary control hover and focus', '#345678')
    await setEditorColor('Secondary control pressed', '#456789')
    await setEditorColor('Destructive action', '#123abc')
    await setEditorColor('Destructive hover and focus', '#456def')
    await setEditorColor('Destructive pressed', '#789abc')
    await setEditorColor('Text and icons on destructive actions', '#fedcba')

    const saveAndApplyButton = page.getByRole('button', { name: 'Save and apply' })
    await page.keyboard.press('Tab')
    await saveAndApplyButton.focus()
    await expect(saveAndApplyButton).toHaveCSS('background-color', 'rgb(52, 86, 120)')
    await page.keyboard.down('Space')
    await expect(saveAndApplyButton).toHaveCSS('background-color', 'rgb(69, 103, 137)')
    await page.keyboard.up('Space')
    await expect.poll(async () => {
      const themes = await readSavedThemes(app.userDataDir)
      const theme = themes.find(({ name }) => name === 'Midnight')
      return {
        count: themes.length,
        background: theme?.colors.background,
        basedOn: theme?.basedOn,
        mainColor: theme?.mainColor,
        secondaryColor: theme?.secondaryColor,
        isDark: theme?.isDark
      }
    }).toEqual({
      count: 1,
      background: '#445566',
      basedOn: 'dark',
      mainColor: 'Orange',
      secondaryColor: 'Teal',
      isDark: false
    })
    await page.evaluate(async () => {
      const [theme] = await window.ftElectron.loadCustomTheme()
      await window.ftElectron.saveCustomTheme({ ...theme, id: '../custom-theme' })
        .then(() => { throw new Error('Invalid custom theme ID was accepted') }, () => {})
      await Promise.all([
        window.ftElectron.saveCustomTheme(theme),
        window.ftElectron.saveCustomTheme(theme)
      ])
    })
    await expect.poll(async () => (await readSavedThemes(app.userDataDir)).map(({ name }) => name))
      .toEqual(['Midnight'])
    await expect(editor).toHaveCount(0)
    await goToSettingsSection(page, 'storage')
    const removeHistoryButton = page.getByRole('button', { name: 'Remove Watch History' })
    await expect(removeHistoryButton).toHaveCSS('background-color', 'rgb(18, 58, 188)')
    await expect(removeHistoryButton).toHaveCSS('color', 'rgb(254, 220, 186)')
    await removeHistoryButton.hover()
    await expect(removeHistoryButton).toHaveCSS('background-color', 'rgb(69, 109, 239)')
    await page.mouse.down()
    await expect(removeHistoryButton).toHaveCSS('background-color', 'rgb(120, 154, 188)')
    await page.mouse.move(0, 0)
    await page.mouse.up()
    await goToSettingsSection(page, 'theme')
    await page.getByRole('button', { name: 'Edit custom theme' }).click()

    await page.locator('.settingsCloseButton').click()
    await expect(page.locator('.settingsWindow')).toBeHidden()
    await page.locator('.topNav .profileTrigger').click()
    const quickAppearance = page.locator('.quickSettingsMenu .menuSection').filter({ hasText: 'Appearance' })
    await expect(quickAppearance.getByRole('combobox', { name: 'Base Theme' })).toBeDisabled()
    await expect(quickAppearance.getByRole('combobox', { name: /Main colou?r theme/i })).toHaveCount(0)
    await page.locator('.topNav .profileTrigger').click()
    await goTo(page, 'settings')
    await expect(page.getByText('Custom theme creator', { exact: true })).toBeVisible()
    await expect(backgroundValue).toHaveText('#445566')

    const discardChangesButton = page.getByRole('button', { name: 'Discard changes' })
    await expect(saveAndApplyButton).toBeDisabled()
    await expect(discardChangesButton).toBeDisabled()

    await setEditorColor('Page background', '#112233')
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#112233')
    await expect(saveAndApplyButton).toBeEnabled()
    await expect(discardChangesButton).toBeEnabled()
    await discardChangesButton.click()
    await expect(backgroundValue).toHaveText('#445566')
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#445566')
    await expect(saveAndApplyButton).toBeDisabled()
    await expect(discardChangesButton).toBeDisabled()

    await setEditorColor('Page background', '#112233')
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#112233')
    await page.getByRole('button', { name: 'Show Keyboard Shortcuts' }).click()
    await expect(page.getByText('Custom theme creator', { exact: true })).toHaveCount(0)
    await expect(page.locator('.settingsKeyboardShortcutPage')).toBeVisible()
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#445566')

    await page.locator('.settingsBackButton').click()
    await expect(page.getByRole('combobox', { name: /Main colou?r theme/i })).toBeDisabled()
    await expect(page.getByRole('combobox', { name: /Secondary colou?r theme/i })).toBeDisabled()

    await page.getByRole('button', { name: 'Edit custom theme' }).click()
    await page.locator('label.switch-label').filter({ hasText: 'Dark theme' }).click()
    await expect(darkTheme).toBeChecked()
    await saveAndApplyButton.click()

    await page.getByRole('button', { name: 'Create custom theme' }).click()
    await expect(backgroundValue).toHaveText('#445566')
    await expect(page.getByRole('combobox', { name: 'Based on' })).toHaveText('Dark')
    await expect(editor.getByRole('combobox', { name: /Main colou?r theme/i })).toHaveText('Orange')
    await expect(editor.getByRole('combobox', { name: /Secondary colou?r theme/i })).toHaveText('Teal')
    await editor.getByRole('textbox', { name: 'Theme name' }).fill('Paper')
    await page.getByRole('combobox', { name: 'Based on' }).click()
    await page.getByRole('option', { name: 'Light', exact: true }).click()
    await page.getByRole('button', { name: 'Save and apply' }).click()
    await expect.poll(async () => {
      const themes = await readSavedThemes(app.userDataDir)
      return themes.map(({ name, basedOn }) => ({ name, basedOn }))
    }).toEqual([
      { name: 'Midnight', basedOn: 'dark' },
      { name: 'Paper', basedOn: 'light' }
    ])
    await expect(editor).toHaveCount(0)

    await page.emulateMedia({ colorScheme: 'light' })
    const baseThemeSelect = page.getByRole('combobox', { name: 'Base Theme' })
    await baseThemeSelect.click()
    await page.locator(`#${await baseThemeSelect.getAttribute('aria-controls')}`)
      .getByRole('option', { name: /System default/i }).click()
    const darkSystemTheme = page.getByRole('combobox', { name: 'Dark theme' })
    await darkSystemTheme.click()
    const darkSystemThemeOptions = page.locator(`#${await darkSystemTheme.getAttribute('aria-controls')}`)
    await expect(darkSystemThemeOptions.getByRole('option', { name: 'Paper', exact: true })).toHaveCount(0)
    await expect(darkSystemThemeOptions.getByRole('option', { name: 'Midnight', exact: true })).toBeVisible()
    await darkSystemThemeOptions.getByRole('option', { name: 'Midnight', exact: true }).click()

    await page.locator('.settingsCloseButton').click()
    await page.locator('.topNav .profileTrigger').click()
    const quickSettingsMainColor = page.locator('.quickSettingsMenu .menuSection')
      .filter({ hasText: 'Appearance' }).getByRole('combobox', { name: /Main colou?r theme/i })
    await expect(quickSettingsMainColor).toBeEnabled()
    await quickSettingsMainColor.click()
    const quickSettingsMainColorList = page.locator(`#${await quickSettingsMainColor.getAttribute('aria-controls')}`)
    await expect(quickSettingsMainColorList).toBeVisible()
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(quickSettingsMainColor).toHaveCount(0)
    await expect(quickSettingsMainColorList).toHaveCount(0)
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(quickSettingsMainColor).toBeEnabled()
    await page.keyboard.press('Escape')
    await expect(page.locator('.quickSettingsMenu')).toBeHidden()
    await goTo(page, 'settings')
    await expect(page.locator('.settingsContent > [data-section="appearance"]')).toBeVisible()

    const lightSystemTheme = page.getByRole('combobox', { name: 'Light theme' })
    await lightSystemTheme.click()
    const lightSystemThemeOptions = page.locator(`#${await lightSystemTheme.getAttribute('aria-controls')}`)
    await expect(lightSystemThemeOptions.getByRole('option', { name: 'Midnight', exact: true })).toHaveCount(0)
    await lightSystemThemeOptions.getByRole('option', { name: 'Paper', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Edit custom theme' })).toBeVisible()
    await page.getByRole('button', { name: 'Edit custom theme' }).click()
    await setEditorColor('Page background', '#abcdef')
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#abcdef')
    await page.locator('.settingsBackButton').click()
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#f1f1f1')
    await expect(page.locator('body')).toHaveClass(/custom/)
    await page.getByRole('button', { name: 'Edit custom theme' }).click()
    await setEditorColor('Page background', '#abcdef')
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.getByRole('button', { name: 'Save and apply' }).click()
    await expect(page.locator('.settingsWindow:visible')
      .getByRole('combobox', { name: 'Base Theme' })).toHaveText('System default')
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#445566')
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#abcdef')

    const activeBaseThemeSelect = page.locator('.settingsWindow:visible')
      .getByRole('combobox', { name: 'Base Theme' })
    await activeBaseThemeSelect.click()
    await page.locator(`#${await activeBaseThemeSelect.getAttribute('aria-controls')}`)
      .getByRole('option', { name: 'Midnight', exact: true }).click()
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#445566')
    await page.getByRole('button', { name: 'Edit custom theme' }).click()
    await expect(page.getByRole('combobox', { name: 'Based on' })).toHaveText('Dark')
    await expect(backgroundValue).toHaveText('#445566')

    ;({ page } = await app.relaunch())
    await expect(page.locator('body')).toHaveClass(/custom/)
    await expect(page.locator('body')).toHaveCSS('--bg-color', '#445566')
    await expect(page.locator('body')).toHaveAttribute('data-custom-theme', 'dark')

    await goToSettingsSection(page, 'theme')
    await page.getByRole('button', { name: 'Edit custom theme' }).click()
    await page.getByRole('button', { name: 'Delete theme' }).click()
    const deletePrompt = page.getByRole('dialog', { name: /Delete “Midnight”/ })
    await expect(deletePrompt).toHaveClass(/autosize/)
    await expect(deletePrompt).toContainText('Delete “Midnight”?')
    await deletePrompt.getByRole('button', { name: 'Delete theme' }).click()
    await expect(page.getByText('Custom theme creator', { exact: true })).toHaveCount(0)
    await expect.poll(async () => (await readSavedThemes(app.userDataDir)).map(({ name }) => name))
      .toEqual(['Paper'])
    await expect(page.locator('body')).toHaveClass(/dark/)
    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.getters.getBaseTheme
    })).toBe('dark')
  })
})

test.describe('invalid appearance values', () => {
  test.use({
    seed: {
      settings: {
        baseTheme: 'missingTheme',
        systemLightTheme: 'solarizedDark',
        systemDarkTheme: 'solarizedLight',
        mainColor: 'missingMainColor',
        secColor: 'missingSecondaryColor'
      }
    }
  })

  test('falls back to defaults', async ({ page }) => {
    await expect.poll(() => page.evaluate(() => {
      const getters = document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters
      return [
        getters.getBaseTheme,
        getters.getSystemLightTheme,
        getters.getSystemDarkTheme,
        getters.getMainColor,
        getters.getSecColor
      ]
    })).toEqual(['system', 'light', 'dark', 'Red', 'Blue'])
  })
})

test.describe('black theme surfaces', () => {
  test.use({ seed: { settings: { baseTheme: 'black' } } })

  test('keeps cards distinguishable from the page background', async ({ page }) => {
    await goToSettingsSection(page, 'theme')
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)')
    await expect(page.locator('.sectionBody').first()).toHaveCSS('background-color', 'rgb(5, 5, 5)')
  })
})

test.describe('global progress presentation', () => {
  test('uses a persistent notification or the global bar based on the theme setting', async ({ page }) => {
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setProgressBarMessage', 'Downloading yt-dlp and ffmpeg')
      store.commit('setProgressBarIcon', ['fas', 'download'])
      store.commit('setProgressBarPercentage', 42)
      store.commit('setShowProgressBar', true)
    })

    const progressToast = page.getByTestId('progress-toast')
    await expect(progressToast).toContainText('Downloading yt-dlp and ffmpeg')
    await expect(progressToast.locator('.icon')).toHaveAttribute('data-icon', 'download')
    await expect(progressToast.locator('.progress-indicator')).toHaveAttribute('data-progress', '42')
    const progressGeometry = await progressToast.locator('.embeddedProgressPath').evaluate(element => ({
      dashLength: Number.parseFloat(element.style.strokeDasharray),
      pathLength: element.getTotalLength(),
      vectorEffect: getComputedStyle(element).vectorEffect,
    }))
    expect(progressGeometry.dashLength / progressGeometry.pathLength).toBeCloseTo(0.42, 2)
    expect(progressGeometry.vectorEffect).toBe('none')
    await expect(page.locator('.app > .progressBar')).toHaveCount(0)

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setShowProgressBarToast', false)
    })

    await expect(progressToast).toHaveCount(0)
    await expect(page.locator('.app > .progressBar')).toHaveCount(1)

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setShowProgressBarToast', true)
    })
    await expect(progressToast).toBeVisible()

    // Fullscreen is for watching, so the progress notification steps aside
    await page.evaluate(() => document.querySelector('.app').requestFullscreen())
    await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true)
    await expect(progressToast).toHaveCount(0)
    await expect(page.locator('.app > .progressBar')).toHaveCount(0)

    // Only the progress notification is suppressed: a regular toast still has
    // something to say that the fullscreen player can't tell the user itself
    await page.evaluate(() => window.ftElectron.showToastOnAllTabs('Copied to clipboard', 10000))
    await expect(page.locator('.toast', { hasText: 'Copied to clipboard' })).toBeVisible()

    await page.evaluate(() => document.exitFullscreen())
    await expect(progressToast).toBeVisible()
  })
})

test.describe('UI roundness', () => {
  test.use({ seed: { settings: { uiRoundness: 0 } } })

  test('applies to controls, cards, popovers, and modals', async ({ app, page, attachScreenshot }) => {
    await expect(page.locator('body')).toHaveCSS('--ui-roundness', '0')

    await goToSettingsSection(page, 'theme')
    const roundnessSlider = page.getByRole('slider', { name: /UI Roundness/ })
    const toggleSwitch = page.locator('label.switch-label').first()
    const toggleTrackRadius = () => toggleSwitch.evaluate((element) =>
      getComputedStyle(element, '::before').borderRadius)
    await expect(roundnessSlider).toHaveValue('0')
    expect(await toggleTrackRadius()).toBe('8px')
    await expect(page.locator('.sectionBody').first()).toHaveCSS('border-radius', '0px')
    await expect(page.getByRole('button').first()).toHaveCSS('border-radius', '0px')

    await page.locator('.settingsMenu [data-section="data"]').click()
    await page.getByRole('button', { name: 'Export Subscriptions' }).click()
    await expect(page.getByRole('dialog')).toHaveCSS('border-radius', '0px')
    await attachScreenshot('square modal at 0% roundness')

    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()
    await page.locator(sel.tabs).first().click({ button: 'right' })
    await expect(page.getByRole('menu', { name: 'Context menu' })).toHaveCSS('border-radius', '0px')
    await attachScreenshot('square context menu at 0% roundness')

    await page.keyboard.press('Escape')
    await expect(page.locator('.settingsWindow')).toBeHidden()
    await goToSettingsSection(page, 'theme')
    await roundnessSlider.fill('150')
    await expect(page.locator('body')).toHaveCSS('--ui-roundness', '1.5')
    expect(await toggleTrackRadius()).toBe('8px')
    await expect(page.locator('.sectionBody').first()).toHaveCSS('border-radius', '12px')
    await attachScreenshot('settings at 150% roundness')

    ;({ page } = await app.relaunch())
    await goToSettingsSection(page, 'theme')
    await expect(page.getByRole('slider', { name: /UI Roundness/ })).toHaveValue('150')
  })
})

test.describe('rounded feed page headers', () => {
  test.use({
    seed: {
      settings: {
        uiRoundness: 200,
        backendPreference: 'invidious',
        backendFallback: true,
        fetchSubscriptionsAutomatically: false
      }
    }
  })

  test('preserves scaled card corners on feed pages', async ({ page, attachScreenshot }) => {
    const pages = [
      { route: 'subscriptions', header: '.subscriptionsHeader' },
      { route: 'trending', header: '.pageHeader' },
      { route: 'popular', header: '.pageHeader' }
    ]

    for (const { route, header } of pages) {
      await goTo(page, route)
      await expect(page.locator(header)).toHaveCSS('border-top-left-radius', '16px')
      await expect(page.locator(header)).toHaveCSS('border-top-right-radius', '16px')
      await attachScreenshot(`${route} header`)
    }
  })
})

test.describe('top nav beside the vertical tab bar', () => {
  test('search bar and profile selector stay clear of the tab column', async ({ app, page, attachScreenshot }) => {
    await enableVerticalTabBar(page, 220)

    // Wide enough viewport for the 3-column grid, but the top nav itself (beside
    // the 220px tab column) is not — the profile selector on the inline-end must
    // not overflow off the right edge (the grid must fall back to the flex row).
    await setWindowWidth(app, 1000)
    const profiles = page.locator('.topNav .profiles')
    await expect.poll(async () => {
      const [tabBarBox, profilesBox] = await Promise.all([
        page.locator('.tabBar.vertical').boundingBox(),
        profiles.boundingBox()
      ])
      const viewportWidth = await page.evaluate(() => window.innerWidth)
      return (
        profilesBox.x >= tabBarBox.x + tabBarBox.width - 1 &&
        profilesBox.x + profilesBox.width <= viewportWidth + 1
      )
    }).toBe(true)
    await attachScreenshot('top nav beside the vertical tab bar')

    // Mobile layout: the fixed search bar opens beside the tab column, not behind it.
    await setWindowWidth(app, 660)
    await page.locator('.topNav .navSearchButton').click()
    const searchContainer = page.locator('.topNav .searchContainer')
    await expect.poll(async () => {
      const [tabBarBox, searchBox] = await Promise.all([
        page.locator('.tabBar.vertical').boundingBox(),
        searchContainer.boundingBox()
      ])
      const viewportWidth = await page.evaluate(() => window.innerWidth)
      return (
        searchBox.x >= tabBarBox.x + tabBarBox.width - 1 &&
        searchBox.x + searchBox.width <= viewportWidth + 1
      )
    }).toBe(true)
    await attachScreenshot('mobile search bar beside the vertical tab bar')
  })
})

test.describe('tab layout shortcut', () => {
  test('F1 cycles through every tab layout', async ({ page, attachScreenshot }) => {
    const app = page.locator('.app')
    for (const className of [
      'tabBar-left',
      'tabBar-bottom',
      'tabBar-right',
      'tabBar-top'
    ]) {
      await page.keyboard.press('F1')
      await expect(app).toHaveClass(new RegExp(`(?:^|\\s)${className}(?:\\s|$)`))
    }
    await attachScreenshot('tab layouts cycled with F1')
  })

  test('presses in quick succession are not swallowed by the pending write', async ({ app: appHandle, page }) => {
    const app = page.locator('.app')

    // The setting is only committed once persisted, so two presses that beat
    // the write have to queue up instead of both advancing from the same value.
    await page.evaluate(() => {
      for (let i = 0; i < 2; i++) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', code: 'F1', bubbles: true }))
      }
    })

    await expect.poll(async () => {
      const contents = await readFile(path.join(appHandle.userDataDir, 'settings.db'), 'utf8')
      return Object.fromEntries(contents.trim().split('\n')
        .map(line => JSON.parse(line))
        .map(record => [record._id, record.value]))
        .tabBarPosition
    }).toBe('bottom')
    await expect(app).toHaveClass(/tabBar-bottom/)
  })
})

test.describe('tab layout shortcut rebound to a printable key', () => {
  test.use({
    seed: {
      settings: {
        keyboardShortcuts: JSON.stringify({ APP: { GENERAL: { TOGGLE_TAB_ORIENTATION: 'v' } } })
      }
    }
  })

  test('typing the key in the search bar does not toggle the layout', async ({ page }) => {
    const app = page.locator('.app')
    const searchInput = page.locator(sel.searchInput)

    await searchInput.click()
    await searchInput.type('vv')

    await expect(searchInput).toHaveValue('vv')
    await expect(app).toHaveClass(/tabBar-top/)

    // Outside a text field the rebound key still works.
    await page.locator('.app').click()
    await page.keyboard.press('v')
    await expect(app).toHaveClass(/tabBar-left/)
  })
})

test.describe('narrow layout top padding', () => {
  test('page content clears the fixed top nav and tab bar', async ({ app, page, attachScreenshot }) => {
    // On mobile widths the top nav is fixed and taller when a tab bar is
    // present; the page content must keep a gap below it instead of tucking
    // underneath (previously the content sat flush against the nav).
    await setWindowWidth(app, 560)
    const routerView = page.locator('.app > .routerView').first()
    await expect.poll(async () => {
      const [topNavBox, routerBox] = await Promise.all([
        page.locator('.topNav').boundingBox(),
        routerView.boundingBox()
      ])
      const gap = routerBox.y - (topNavBox.y + topNavBox.height)
      return gap >= 4 && gap <= 40
    }).toBe(true)
    await attachScreenshot('narrow layout')
  })
})

// Sample the empty padding beside the settings content, away from text and controls.
async function settingsBackgroundVariation(page) {
  const screenshot = await page.locator('.settingsContent').screenshot({ animations: 'disabled' })
  return page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d')
    context.drawImage(bitmap, 0, 0)
    const samples = [0.1, 0.3, 0.5, 0.7, 0.9].map(fraction =>
      [...context.getImageData(4, Math.floor(bitmap.height * fraction), 1, 1).data].slice(0, 3))
    bitmap.close()
    return Math.max(...[0, 1, 2].map(channel =>
      Math.max(...samples.map(color => color[channel])) - Math.min(...samples.map(color => color[channel]))))
  }, screenshot.toString('base64'))
}

test.describe('OpenTubeX homepage themes', () => {
  test('selects, persists, and follows the system with the homepage palettes', async ({ app, page, attachScreenshot }) => {
    await goToSettingsSection(page, 'theme')
    for (const [mode, background, accent] of [
      ['Light', 'rgb(232, 242, 240)', 'rgb(17, 104, 95)'],
      ['Dark', 'rgb(11, 20, 22)', 'rgb(46, 196, 182)'],
    ]) {
      await page.getByRole('combobox', { name: /^Base theme/i }).click()
      await page.getByRole('option', { name: `OpenTubeX ${mode}`, exact: true }).click()
      await expect(page.locator('body')).toHaveCSS('background-color', background)
      await expect(page.getByRole('combobox', { name: /Main colou?r theme/i })).toBeDisabled()
      await expect(page.getByRole('combobox', { name: /Secondary colou?r theme/i })).toBeDisabled()
      // Read resolved colors so accidental inheritance from Red/Blue is detected.
      expect(await page.locator('body').evaluate(body => {
        const probe = document.createElement('span')
        probe.style.color = 'var(--accent-color)'
        body.append(probe)
        const color = getComputedStyle(probe).color
        probe.remove()
        return color
      })).toBe(accent)
      for (const selector of ['.app', '.ft-card', '.settingsWindow']) {
        await expect(page.locator(selector).first()).not.toHaveCSS('background-image', 'none')
      }
      await expect(page.locator('.sectionBody').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      for (const scale of [100, 125]) {
        await page.evaluate(scale => document.querySelector('#app').__vue_app__.config.globalProperties.$store
          .dispatch('updateUiScale', scale), scale)
        await expect.poll(() => app.electronApp.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())).toBe(scale / 100)
        const variation = await settingsBackgroundVariation(page)
        expect(variation).toBeGreaterThanOrEqual(4)
        await page.locator('.settingsContent').evaluate(element => { element.scrollTop = element.scrollHeight })
        expect(await settingsBackgroundVariation(page)).toBe(variation)
        await page.locator('.settingsContent').evaluate(element => { element.scrollTop = 0 })
      }
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store
        .dispatch('updateUiScale', 100))
      await attachScreenshot(`OpenTubeX ${mode} settings`)
    }

    ;({ page } = await app.relaunch())
    await expect(page.locator('body')).toHaveClass(/openTubeXDark/)
    expect(await app.electronApp.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors)).toBe(true)
    await goToSettingsSection(page, 'theme')
    await page.getByRole('combobox', { name: /^Base theme/i }).click()
    await page.getByRole('option', { name: /^System default$/i }).click()
    for (const [mode, other] of [['Light', 'Dark'], ['Dark', 'Light']]) {
      await page.getByRole('combobox', { name: `${mode} theme`, exact: true }).click()
      await expect(page.getByRole('option', { name: `OpenTubeX ${other}`, exact: true })).toHaveCount(0)
      await page.getByRole('option', { name: `OpenTubeX ${mode}`, exact: true }).click()
      await page.emulateMedia({ colorScheme: mode.toLowerCase() })
      await expect(page.locator('body')).toHaveClass(new RegExp(`openTubeX${mode}`))
    }

    // Leaving a fixed palette restores the user's normal color controls.
    await page.getByRole('combobox', { name: /^Base theme/i }).click()
    await page.getByRole('option', { name: 'Light', exact: true }).click()
    await expect(page.getByRole('combobox', { name: /Main colou?r theme/i })).toBeEnabled()
    await expect(page.locator('body')).toHaveCSS('--primary-color', '#f44336')
    await expect(page.locator('.app')).toHaveCSS('background-image', 'none')
    await expect(page.locator('.settingsWindow')).toHaveCSS('background-image', 'none')
    expect(await settingsBackgroundVariation(page)).toBe(0)
  })
})
