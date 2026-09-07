import { test, expect, setWindowSize } from '../../helpers/app.mjs'

test.use({ showTutorial: true })

for (const zoom of [1, 0.95]) {
  test(`neutral tutorial buttons have the same visible height as colored buttons at ${zoom} scale`, async ({ page }, testInfo) => {
    await page.evaluate(() => localStorage.setItem('opentubex.tutorial.audience', 'new'))
    await page.reload()
    await page.evaluate(factor => window.ftElectron.setZoomFactor(factor), zoom)

    const tutorial = page.locator('.tutorialCard')
    await expect(tutorial).toHaveAccessibleName('Welcome to OpenTubeX')

    for (const theme of ['light', 'dark']) {
      await page.evaluate(async baseTheme => {
        const store = document.querySelector('#app')._vnode.component.appContext.config.globalProperties.$store
        await store.dispatch('updateBaseTheme', baseTheme)
      }, theme)

      // A contrasting border shrinks the visible fill even when the outer
      // bounds match. Compare both the bounds and the painted background.
      const buttons = tutorial.locator('.tutorialActions .btn')
      await expect(buttons).toHaveCount(2)
      const metrics = await buttons.evaluateAll(elements => elements.map(element => {
        const style = getComputedStyle(element)
        const bounds = element.getBoundingClientRect()
        const borderBlends = style.borderTopColor === style.backgroundColor ||
          (style.borderTopColor === 'rgba(0, 0, 0, 0)' && style.backgroundClip === 'border-box')
        const borderHeight = Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth)
        return {
          height: bounds.height,
          visibleHeight: bounds.height - (borderBlends ? 0 : borderHeight)
        }
      }))
      expect(metrics[0].height).toBeCloseTo(metrics[1].height, 1)
      expect(metrics[0].visibleHeight).toBeCloseTo(metrics[1].visibleHeight, 1)
      await testInfo.attach(`Tutorial buttons in ${theme} theme at ${zoom} scale`, {
        body: await tutorial.screenshot({ animations: 'disabled' }),
        contentType: 'image/png'
      })
    }
  })
}

async function expectHighlightCenteredOn(page, targetSelector) {
  await expect.poll(async () => {
    const [highlight, target] = await Promise.all([
      page.locator('.tutorialHighlight').evaluate(element => element.getBoundingClientRect().toJSON()),
      page.locator(`${targetSelector}:visible`).evaluate(element => element.getBoundingClientRect().toJSON())
    ])

    return {
      x: Math.round(Math.abs(highlight.x + highlight.width / 2 - (target.x + target.width / 2))),
      y: Math.round(Math.abs(highlight.y + highlight.height / 2 - (target.y + target.height / 2)))
    }
  }).toEqual({ x: 0, y: 0 })
}

async function clickAppMenuItem(app, menuLabel, itemLabel) {
  await app.electronApp.evaluate(({ BrowserWindow, Menu }, { menuLabel, itemLabel }) => {
    const browserWindow = BrowserWindow.getAllWindows()[0]
    const menu = Menu.getApplicationMenu().items.find(item => item.label === menuLabel)
    menu.submenu.items.find(item => item.label === itemLabel).click(undefined, browserWindow)
  }, { menuLabel, itemLabel })
}

test('shows returning users only where settings moved', async ({ app, page }) => {
  const tutorial = page.getByRole('dialog', { name: 'Settings have moved' })
  await expect(tutorial).toBeVisible()
  const lastUsedVersion = await page.evaluate(() => localStorage.getItem('opentubex.lastUsedVersion'))
  expect(lastUsedVersion).toMatch(/^\d+\.\d+\.\d+(?:-|$)/)
  await expect(tutorial).toContainText('Right-click it to go straight to profile selection.')
  await expect(tutorial).toContainText('The cog in that menu opens all settings, and About and Downloads have moved to this menu too.')
  await expect(tutorial.locator('.tutorialProgress')).toHaveCount(0)
  await expectHighlightCenteredOn(page, '[data-tutorial="quick-settings"]')

  const tabCount = await page.locator('.tabBar .tab').count()
  await page.keyboard.press('Control+t')
  await expect(page.locator('.tabBar .tab')).toHaveCount(tabCount)

  await clickAppMenuItem(app, 'Tabs', 'New Tab')
  await expect(page.locator('.tabBar .tab')).toHaveCount(tabCount)

  const currentUrl = page.url()
  await clickAppMenuItem(app, 'File', 'Preferences')
  await clickAppMenuItem(app, 'Navigate', 'History')
  expect(page.url()).toBe(currentUrl)

  const initialWindowState = await app.electronApp.evaluate(({ BrowserWindow }) => {
    const browserWindow = BrowserWindow.getAllWindows()[0]
    return {
      count: BrowserWindow.getAllWindows().length,
      zoom: browserWindow.webContents.getZoomLevel()
    }
  })
  await clickAppMenuItem(app, 'File', 'New Window')
  await clickAppMenuItem(app, 'View', 'Toggle Developer Tools')
  await clickAppMenuItem(app, 'View', 'Zoom In')
  await clickAppMenuItem(app, 'View', 'Toggle Full Screen')
  await clickAppMenuItem(app, 'Window', 'Minimize')
  await expect.poll(() => app.electronApp.evaluate(({ BrowserWindow }) => {
    const browserWindow = BrowserWindow.getAllWindows()[0]
    return {
      count: BrowserWindow.getAllWindows().length,
      devToolsOpen: browserWindow.webContents.isDevToolsOpened(),
      fullscreen: browserWindow.isFullScreen(),
      minimized: browserWindow.isMinimized(),
      zoom: browserWindow.webContents.getZoomLevel()
    }
  })).toEqual({
    ...initialWindowState,
    devToolsOpen: false,
    fullscreen: false,
    minimized: false
  })

  const primaryAction = tutorial.getByRole('button', { name: 'Got it' })
  await expect(primaryAction).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(primaryAction).toBeFocused()

  await primaryAction.click()
  await expect(tutorial).toBeHidden()

  await clickAppMenuItem(app, 'Tabs', 'New Tab')
  await expect(page.locator('.tabBar .tab')).toHaveCount(tabCount + 1)

  await page.reload()
  await expect(page.locator('.tutorialOverlay')).toHaveCount(0)
})

test('keeps the tutorial actions reachable in a short window', async ({ app, page }) => {
  await app.electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(800, 320)
  })

  const tutorial = page.getByRole('dialog', { name: 'Settings have moved' })
  await expect(tutorial.getByRole('button', { name: 'Got it' })).toBeVisible()
  await expect.poll(() => tutorial.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return bounds.top >= 0 && bounds.bottom <= window.innerHeight
  })).toBe(true)
})

test.describe('translated import actions', () => {
  test.use({ seed: { settings: { currentLocale: 'de-DE' } } })

  test('keep their labels when they fit on one row', async ({ app, page }) => {
    await app.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setSize(500, 600)
    })
    await page.evaluate(() => localStorage.setItem('opentubex.tutorial.audience', 'new'))
    await page.reload()
    await page.evaluate(() => window.ftElectron.setZoomFactor(1.05))

    const tutorial = page.locator('.tutorialCard')
    for (let step = 0; step < 5; step++) {
      await tutorial.getByRole('button', { name: 'Weiter' }).click()
    }

    const actions = ['Zurück', 'Nicht jetzt', 'Daten importieren'].map(name => {
      return tutorial.getByRole('button', { name })
    })
    await Promise.all(actions.map(action => expect(action.locator('.tutorialActionText')).toBeVisible()))
    const actionTops = await Promise.all(actions.map(action => {
      return action.evaluate(element => Math.round(element.getBoundingClientRect().top))
    }))
    expect(new Set(actionTops).size).toBe(1)
  })

  test('stay on one row in a narrow window', async ({ app, page }) => {
    await app.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setSize(340, 600)
    })
    await page.evaluate(() => localStorage.setItem('opentubex.tutorial.audience', 'new'))
    await page.reload()
    await page.evaluate(() => window.ftElectron.setZoomFactor(1.05))

    const tutorial = page.locator('.tutorialCard')
    for (let step = 0; step < 5; step++) {
      await tutorial.getByRole('button', { name: 'Weiter' }).click()
    }
    await expect(tutorial).toHaveAccessibleName('Nimm deine Daten mit')

    const actions = ['Zurück', 'Nicht jetzt', 'Daten importieren'].map(name => {
      return tutorial.getByRole('button', { name })
    })
    await Promise.all(actions.map(action => expect(action).toBeVisible()))
    await expect.poll(async () => {
      const [cardBounds, ...actionBounds] = await Promise.all([
        tutorial.evaluate(element => element.getBoundingClientRect().toJSON()),
        ...actions.map(action => action.evaluate(element => element.getBoundingClientRect().toJSON()))
      ])
      return actionBounds.every(bounds => {
        return bounds.left >= cardBounds.left && bounds.right <= cardBounds.right &&
          bounds.top >= cardBounds.top && bounds.bottom <= cardBounds.bottom
      })
    }).toBe(true)
    await expect.poll(async () => {
      const actionBounds = await Promise.all(actions.map(action => {
        return action.evaluate(element => element.getBoundingClientRect().toJSON())
      }))
      return new Set(actionBounds.map(bounds => Math.round(bounds.top))).size
    }).toBe(1)
    const actionWidths = await Promise.all(actions.map(action => {
      return action.evaluate(element => {
        const contentRange = document.createRange()
        contentRange.selectNodeContents(element)
        const styles = getComputedStyle(element)
        return {
          availableWidth: element.clientWidth - Number.parseFloat(styles.paddingLeft) - Number.parseFloat(styles.paddingRight),
          contentWidth: contentRange.getBoundingClientRect().width
        }
      })
    }))
    expect(
      actionWidths.every(({ availableWidth, contentWidth }) => contentWidth <= availableWidth),
      JSON.stringify(actionWidths)
    ).toBe(true)
  })
})

test('resets the managed content viewport after a shorter step replaces it', async ({ app, page }) => {
  await app.electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(800, 420)
  })
  await page.evaluate(() => localStorage.setItem('opentubex.tutorial.audience', 'new'))
  await page.reload()

  const tutorial = page.locator('.tutorialCard')
  for (let step = 0; step < 4; step++) {
    await tutorial.getByRole('button', { name: 'Next' }).click()
  }
  await expect(tutorial).toHaveAccessibleName('Make it yours')

  const scrollViewport = tutorial.locator('.tutorialScroll')
  const scrollbar = scrollViewport.locator(':scope > .os-scrollbar-vertical')
  await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
  await scrollViewport.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => scrollViewport.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

  await tutorial.getByRole('button', { name: 'Next' }).click()
  await expect(tutorial).toHaveAccessibleName('Bring your data with you')
  await expect.poll(() => scrollViewport.evaluate(element => ({
    scrollTop: element.scrollTop,
    scrollRange: element.scrollHeight - element.clientHeight
  }))).toEqual({ scrollTop: 0, scrollRange: 0 })
  await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
})

test.describe('right-to-left layout', () => {
  test.use({ seed: { settings: { currentLocale: 'ar' } } })

  test('keeps the spotlight centered on physical target coordinates', async ({ page }) => {
    await expect(page.locator('.app')).toHaveClass(/isLocaleRightToLeft/)
    await expectHighlightCenteredOn(page, '[data-tutorial="quick-settings"]')
  })
})

test('walks new users through the essential controls', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('opentubex.tutorial.audience', 'new'))
  await page.reload()

  const tutorial = page.locator('.tutorialCard')
  await expect(tutorial).toHaveAccessibleName('Welcome to OpenTubeX')
  await expect(tutorial.locator('.tutorialProgress span')).toHaveCount(6)
  const skip = tutorial.getByRole('button', { name: 'Skip' })
  const next = tutorial.getByRole('button', { name: 'Next' })
  await expect(skip).toBeVisible()

  await next.click()
  await expect(tutorial).toHaveAccessibleName('Your library is always nearby')
  await expect(tutorial).toContainText('Use the navigation to reach subscriptions, playlists, history, and more.')
  await expect(tutorial.getByRole('heading', { name: 'Your library is always nearby' })).toBeFocused()
  await expect(tutorial.getByRole('button', { name: 'Skip' })).toHaveCount(0)
  await expectHighlightCenteredOn(page, '[data-tutorial="navigation"]')
  const back = tutorial.getByRole('button', { name: 'Back' })

  await back.click()
  await expect(tutorial).toHaveAccessibleName('Welcome to OpenTubeX')
  await next.click()
  await expect(tutorial).toHaveAccessibleName('Your library is always nearby')

  await tutorial.getByRole('button', { name: 'Next' }).click()
  await expect(tutorial).toHaveAccessibleName('Search or paste a link')
  await expectHighlightCenteredOn(page, '.searchContainer[data-tutorial="search"] .ft-input')
  const highlightStyles = await page.locator('.tutorialHighlight').evaluate(element => {
    const styles = getComputedStyle(element)
    return { borderRadius: Number.parseFloat(styles.borderRadius), boxShadow: styles.boxShadow }
  })
  expect(highlightStyles.borderRadius).toBeGreaterThan(0)
  expect(highlightStyles.boxShadow).toContain('inset')

  await tutorial.getByRole('button', { name: 'Next' }).click()
  await expect(tutorial).toHaveAccessibleName('Keep pages open in tabs')
  const layout = tutorial.getByRole('combobox', { name: 'Tab Layout' })
  await layout.focus()
  await page.keyboard.press('Enter')
  await expect(layout).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.selectDropdown:visible')).toHaveCSS('text-align', 'start')
  await page.keyboard.press('Escape')
  await expect(layout).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(layout).toHaveText('Horizontal at bottom')
  await expect(page.locator('.tabBar.position-bottom')).toBeVisible()
  for (const [label, className] of [
    ['Vertical on left', 'position-left'],
    ['Vertical on right', 'position-right'],
    ['Horizontal at top', 'position-top']
  ]) {
    await layout.click()
    await page.locator(`#${await layout.getAttribute('aria-controls')}`)
      .getByRole('option', { name: label, exact: true }).click()
    await expect(page.locator(`.tabBar.${className}`)).toBeVisible()
    await expectHighlightCenteredOn(page, '[data-tutorial="tabs"]')
    await expect.poll(async () => {
      const [card, tabs] = await Promise.all([
        tutorial.evaluate(element => element.getBoundingClientRect().toJSON()),
        page.locator('[data-tutorial="tabs"]').evaluate(element => element.getBoundingClientRect().toJSON())
      ])
      return card.left < tabs.right && card.right > tabs.left && card.top < tabs.bottom && card.bottom > tabs.top
    }).toBe(false)
  }

  await tutorial.getByRole('button', { name: 'Next' }).click()
  await expect(tutorial).toHaveAccessibleName('Make it yours')
  await expect(tutorial).toContainText('right-click it to switch profiles.')
  await expectHighlightCenteredOn(page, '[data-tutorial="quick-settings"]')
  const baseTheme = tutorial.getByRole('combobox', { name: 'Base Theme' })
  await baseTheme.click()
  await page.locator(`#${await baseTheme.getAttribute('aria-controls')}`)
    .getByRole('option', { name: 'Light', exact: true }).click()
  await expect(page.locator('body')).toHaveClass(/light/)
  const quality = tutorial.getByRole('combobox', { name: 'Default Quality' })
  await quality.click()
  await page.locator(`#${await quality.getAttribute('aria-controls')}`)
    .getByRole('option', { name: '480p', exact: true }).click()
  await expect(quality).toHaveText('480p')

  await tutorial.getByRole('button', { name: 'Next' }).click()
  await expect(tutorial).toHaveAccessibleName('Bring your data with you')
  await expect(tutorial.getByRole('button', { name: 'Not now' })).toBeVisible()
  await tutorial.getByRole('button', { name: 'Import data' }).click()
  await expect(tutorial).toBeHidden()
  await expect(page.locator('.settingsContent [data-section="data"]')
    .getByRole('button', { name: 'Import subscriptions', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(async () => {
    const settings = await window.ftElectron.dbSettings(1)
    return settings.find(({ _id }) => _id === 'tutorialAudience')?.value
  })).toBe('completed')

  await page.reload()
  await expect(page.locator('.tutorialOverlay')).toHaveCount(0)
})

test('repositions the navigation highlight after crossing the mobile breakpoint', async ({ app, page }) => {
  await setWindowSize(app, page, { width: 600, height: 700 })
  await page.evaluate(() => localStorage.setItem('opentubex.tutorial.audience', 'new'))
  await page.reload()
  await page.evaluate(() => window.ftElectron.setZoomFactor(1.05))

  const tutorial = page.locator('.tutorialCard')
  await tutorial.getByRole('button', { name: 'Next' }).click()
  await expect(tutorial).toHaveAccessibleName('Your library is always nearby')
  await expectHighlightCenteredOn(page, '[data-tutorial="navigation"]')

  await setWindowSize(app, page, { width: 1000, height: 800 })
  await expectHighlightCenteredOn(page, '[data-tutorial="navigation"]')
})

test('repositions the tab highlight when the layout is reset', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('opentubex.tutorial.audience', 'new'))
  await page.reload()
  await page.evaluate(() => window.ftElectron.setZoomFactor(0.95))

  const tutorial = page.locator('.tutorialCard')
  for (let step = 0; step < 3; step++) {
    await tutorial.getByRole('button', { name: 'Next' }).click()
  }
  await expect(tutorial).toHaveAccessibleName('Keep pages open in tabs')

  const layout = tutorial.getByRole('combobox', { name: 'Tab Layout' })
  await layout.click()
  await page.locator(`#${await layout.getAttribute('aria-controls')}`)
    .getByRole('option', { name: 'Vertical on right', exact: true }).click()
  await expect(page.locator('.tabBar.position-right')).toBeVisible()
  await expectHighlightCenteredOn(page, '[data-tutorial="tabs"]')

  await tutorial.getByRole('button', { name: 'Reset this setting to its default' }).click()
  await expect(page.locator('.tabBar.position-top')).toBeVisible()
  await expect(layout).toHaveText('Horizontal at top')
  await expectHighlightCenteredOn(page, '[data-tutorial="tabs"]')
})

test.describe('fresh profile relaunch', () => {
  test.use({ seed: { freshProfile: true } })

  test('keeps showing the new-user tutorial on the second launch', async ({ app, page }) => {
    await expect(page.getByRole('dialog', { name: 'Welcome to OpenTubeX' })).toBeVisible()

    // Simulate environments where Chromium does not flush local storage before
    // the first process exits. The datastore copy must preserve the audience.
    await page.evaluate(async () => {
      localStorage.removeItem('opentubex.tutorial.audience')
      localStorage.removeItem('opentubex.lastUsedVersion')
      await window.ftElectron.dbSettings(2, { _id: 'confirmCloseApp', value: false })
    })
    const { page: relaunchedPage } = await app.relaunch()

    await expect(relaunchedPage.getByRole('dialog', { name: 'Welcome to OpenTubeX' })).toBeVisible()
    await expect(relaunchedPage.getByRole('dialog', { name: 'Settings have moved' })).toHaveCount(0)
  })
})

test('highlights the mobile search button', async ({ app, page }) => {
  await app.electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(600, 700)
  })
  await page.evaluate(() => localStorage.setItem('opentubex.tutorial.audience', 'new'))
  await page.reload()

  const tutorial = page.locator('.tutorialCard')
  await tutorial.getByRole('button', { name: 'Next' }).click()
  await tutorial.getByRole('button', { name: 'Next' }).click()
  await expect(tutorial).toHaveAccessibleName('Search or paste a link')
  await expectHighlightCenteredOn(page, '.navSearchButton[data-tutorial="search"]')
})
