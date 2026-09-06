import { test, expect, goTo, goToSettingsSection, sel } from '../../helpers/app.mjs'
import { DEFAULT_SEARCH_ENGINES } from '../../../src/searchEngines.js'

const allExternalSearchEnginesEnabled = JSON.stringify(
  DEFAULT_SEARCH_ENGINES.map(engine => ({ ...engine, enabled: true }))
)

test('searching selected text in a new tab uses the default filters', async ({ page }) => {
  const contextMenu = await page.evaluate(() => window.ftElectron.contextMenu.open({
    selectionText: 'context search'
  }))
  const search = contextMenu.items.find(item => item.label === 'Search "context search" in a New Tab')
  expect(search).toMatchObject({
    labelKey: 'Context Menu.Search Selection in New Tab',
    labelParameters: { selection: 'context search' }
  })

  await page.evaluate(({ sessionId, actionId }) => {
    return window.ftElectron.contextMenu.execute(sessionId, actionId)
  }, { sessionId: contextMenu.sessionId, actionId: search.actionId })

  await expect(page.locator(sel.tabs)).toHaveCount(2)
  await expect(page).toHaveURL(/#\/search\/context%20search/)

  const filterButton = page.locator('.navFilterButton')
  await expect(filterButton).not.toHaveClass(/filterChanged/)
  await filterButton.click()

  await expect(page.locator('input[type="radio"][value="relevance"]')).toBeChecked()
  await expect(page.locator('input[type="radio"][value="all"]')).toBeChecked()
  await expect(page.locator('.searchRadio', { hasText: 'Time' }).locator('input[value=""]')).toBeChecked()
  await expect(page.locator('.searchRadio', { hasText: 'Duration' }).locator('input[value=""]')).toBeChecked()
})

test('truncates long selections so the rest of the label is never cut off', async ({ page }) => {
  const selectionText = 'OpenTubeX is a privacy respecting YouTube client for the desktop'
  const contextMenu = await page.evaluate((selection) => window.ftElectron.contextMenu.open({
    selectionText: selection
  }), selectionText)

  const newTab = contextMenu.items.find(item => item.labelKey === 'Context Menu.Search Selection in New Tab')
  const newWindow = contextMenu.items.find(item => item.labelKey === 'Context Menu.Search Selection in New Window')

  for (const item of [newTab, newWindow]) {
    expect(item.labelParameters.selection).toBe('OpenTubeX is a privacy respect…')
  }
  expect(newTab.label).toBe('Search "OpenTubeX is a privacy respect…" in a New Tab')
  expect(newWindow.label).toBe('Search "OpenTubeX is a privacy respect…" in a New Window')

  // Searching still uses the full selection, only the label is shortened
  await page.evaluate(({ sessionId, actionId }) => {
    return window.ftElectron.contextMenu.execute(sessionId, actionId)
  }, { sessionId: contextMenu.sessionId, actionId: newTab.actionId })

  await expect.poll(() => page.url()).toContain(`#/search/${encodeURIComponent(selectionText)}`)
})

test('truncates long selections without splitting emoji', async ({ page }) => {
  // The 30th UTF-16 code unit lands inside the family emoji's ZWJ sequence
  const selectionText = 'Cafe rules ok yes indeed 👨‍👩‍👧‍👦 and more text'
  const label = await page.evaluate((selection) => window.ftElectron.contextMenu.open({
    selectionText: selection
  }).then(menu => menu.items
    .find(item => item.labelKey === 'Context Menu.Search Selection in New Tab')
    .labelParameters.selection), selectionText)

  expect(label.endsWith('…')).toBe(true)
  // A cut inside the sequence would leave an unpaired surrogate behind
  expect(label).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/)
  expect(label).toBe('Cafe rules ok yes indeed 👨‍👩‍👧‍👦 and…')
})

test('keeps tall top-level menus inside the viewport and scrollable', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 180 })
  await page.locator(sel.newTabButton).click()
  await page.locator(sel.tabs).first().click({ button: 'right' })

  const menu = page.getByRole('menu', { name: 'Context Menu' })
  await expect(menu).toBeVisible()

  const geometry = await menu.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return {
      top: bounds.top,
      bottom: bounds.bottom,
      viewportBottom: innerHeight - 8,
      overflowY: getComputedStyle(element.querySelector('.menuScroll')).overflowY,
      scrollable: element.querySelector('.menuScroll').scrollHeight > element.querySelector('.menuScroll').clientHeight
    }
  })

  expect(geometry.top).toBeGreaterThanOrEqual(8)
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportBottom + 1)
  expect(geometry.overflowY).toBe('auto')
  expect(geometry.scrollable).toBe(true)

  const lastTopLevelItem = menu
    .locator('.menuScroll > .menuContent > .menuItem, .menuScroll > .menuContent > .submenuContainer > .menuItem')
    .last()
  await lastTopLevelItem.scrollIntoViewIfNeeded()
  await expect(lastTopLevelItem).toBeInViewport()
})

test('does not clip fly-out submenus', async ({ page }) => {
  await page.locator(sel.newTabButton).click()
  await page.locator(sel.tabs).first().click({ button: 'right' })

  const closeTabs = page.getByRole('menuitem', { name: 'Close Tabs', exact: true })
  await closeTabs.hover()
  const submenu = closeTabs.locator('xpath=following-sibling::*[@role="menu"]')
  await expect(submenu).toBeVisible()

  // Fixed-position fly-outs escape the top-level menu's scrollport.
  await expect.poll(() => submenu.evaluate((element) => {
    const menu = element.closest('.contextMenu')
    const style = getComputedStyle(menu.querySelector('.menuScroll'))
    const bounds = element.getBoundingClientRect()
    return {
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      position: getComputedStyle(element).position,
      reachable: document.elementFromPoint(
        (bounds.left + bounds.right) / 2,
        (bounds.top + bounds.bottom) / 2
      )?.closest('[role="menu"]') === element
    }
  })).toEqual({
    overflowX: 'auto',
    overflowY: 'auto',
    position: 'fixed',
    reachable: true
  })
})

test('renders long selection labels without clipping them', async ({ page }) => {
  const point = await page.evaluate(() => {
    const paragraph = document.createElement('p')
    paragraph.textContent = 'OpenTubeX is a privacy respecting YouTube client for the desktop'
    paragraph.style.cssText = 'position:fixed;top:120px;left:40px;width:300px;z-index:19000;background:#000'
    document.body.append(paragraph)

    const range = document.createRange()
    range.selectNodeContents(paragraph)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)

    const bounds = paragraph.getBoundingClientRect()
    return { x: bounds.left + 10, y: bounds.top + 5 }
  })
  await page.mouse.click(point.x, point.y, { button: 'right' })

  const menu = page.getByRole('menu', { name: 'Context Menu' })
  await expect(menu).toBeVisible()

  const label = menu.getByRole('menuitem', { name: /^Search ".*" in a New Tab$/ }).locator('span:not([aria-hidden])')
  await expect(label).toHaveText('Search "OpenTubeX is a privacy respect…" in a New Tab')

  const isClipped = await label.evaluate(element => {
    return element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1
  })
  expect(isClipped).toBe(false)
})

test('does not offer external search engines when they are disabled by default', async ({ page }) => {
  const contextMenu = await page.evaluate(() => window.ftElectron.contextMenu.open({
    selectionText: 'private search'
  }))

  expect(contextMenu.items.some(item => typeof item.label === 'string' && item.label.startsWith('Search with'))).toBe(false)

  const favicon = await page.evaluate(() => {
    return window.ftElectron.resolveFavicon('https://duckduckgo.com/?q=%s')
  })
  expect(favicon).toBe('')
})

test.describe('with all built-in external search engines enabled', () => {
  test.use({
    seed: {
      settings: {
        contextMenuSearchEngines: allExternalSearchEnginesEnabled
      }
    }
  })

  test('offers enabled external search engines in a submenu', async ({ page }) => {
    const contextMenu = await page.evaluate(() => window.ftElectron.contextMenu.open({
      selectionText: 'private search'
    }))
    const searchWith = contextMenu.items.find(item => item.label === 'Search with...')

    expect(searchWith).toMatchObject({
      labelKey: 'Context Menu.Search With Multiple',
      labelParameters: {}
    })
    expect(searchWith.submenu.map(item => item.label)).toEqual([
      'DuckDuckGo',
      'Startpage',
      'Qwant',
      'Brave Search'
    ])
    expect(searchWith.submenu.map(item => item.icon)).toEqual([
      'https://duckduckgo.com/favicon.ico',
      'https://www.startpage.com/favicon.ico',
      'https://www.qwant.com/favicon.ico',
      'https://search.brave.com/favicon.ico'
    ])
    expect(searchWith.submenu.map(item => item.faviconSource)).toEqual([
      'https://duckduckgo.com/?q=%s',
      'https://www.startpage.com/sp/search?query=%s',
      'https://www.qwant.com/?q=%s',
      'https://search.brave.com/search?q=%s'
    ])
    expect(searchWith.submenu.every(item => item.labelKey == null)).toBe(true)
  })

  test('opens the fly-out towards the start without a horizontal scrollbar', async ({ page }) => {
    await goTo(page, 'settings')
    const input = page.locator('.settingsSearch input')
    await input.fill('private search')
    await input.selectText()

    // Right-clicking past the middle of the viewport makes the fly-out open
    // towards the start, which is the side its hover bridge sits on.
    const box = await input.boundingBox()
    await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2, { button: 'right' })

    const searchWith = page.getByRole('menuitem', { name: 'Search with...', exact: true })
    await searchWith.hover()
    const submenu = searchWith.locator('xpath=following-sibling::*[@role="menu"]')
    await expect(submenu).toBeVisible()
    await expect(submenu.locator('xpath=..')).toHaveClass(/submenuOpenStart/)

    // Re-hover on every attempt, the fly-out closes if the pointer state is lost
    await expect.poll(async () => {
      await searchWith.hover()
      return submenu.evaluate((element) => {
        const scrollsHorizontally = (node) => {
          const overflowX = getComputedStyle(node).overflowX
          return (overflowX === 'auto' || overflowX === 'scroll') &&
            node.scrollWidth > node.clientWidth
        }
        const bounds = element.getBoundingClientRect()
        return {
          submenu: scrollsHorizontally(element),
          insideSubmenu: [...element.querySelectorAll('*')].some(scrollsHorizontally),
          // The hover bridge still has to be hit-testable outside the fly-out
          bridgeReachable: document.elementFromPoint(bounds.right + 12, bounds.top + 30) === element
        }
      })
    }).toEqual({ submenu: false, insideSubmenu: false, bridgeReachable: true })
  })

  test('keeps web search enabled and below in-app search for long selections', async ({ page }) => {
    const contextMenu = await page.evaluate(() => window.ftElectron.contextMenu.open({
      selectionText: 'x'.repeat(101)
    }))
    const webSearchIndex = contextMenu.items.findIndex(item => item.label === 'Search with...')
    const inAppSearchIndices = contextMenu.items
      .map((item, index) => typeof item.label === 'string' && item.label.includes('is too long for search')
        ? index
        : -1)
      .filter(index => index !== -1)

    expect(contextMenu.items[webSearchIndex].enabled).toBe(true)
    expect(webSearchIndex).toBeGreaterThan(Math.max(...inAppSearchIndices))
  })
})

test('keeps the newest overlapping context menu session executable', async ({ page }) => {
  const contextMenus = await page.evaluate(() => {
    return Promise.all(Array.from({ length: 10 }, (_, index) => {
      return window.ftElectron.contextMenu.open({ selectionText: `overlap ${index}` })
    }))
  })
  const contextMenu = contextMenus.at(-1)
  const search = contextMenu.items.find(item => item.label === 'Search "overlap 9" in a New Tab')

  await page.evaluate(({ sessionId, actionId }) => {
    return window.ftElectron.contextMenu.execute(sessionId, actionId)
  }, { sessionId: contextMenu.sessionId, actionId: search.actionId })

  await expect(page.locator(sel.tabs)).toHaveCount(2)
  await expect(page).toHaveURL(/#\/search\/overlap%209/)
})

test('adds a custom search engine from settings', async ({ page }) => {
  const general = await goToSettingsSection(page, 'general')
  const section = general.locator('.settingsSection').filter({
    has: page.getByRole('heading', { name: 'Context Menu Search', exact: true })
  })
  await section.getByLabel('Engine name').fill('Example Search')
  await section.getByLabel('Search URL').fill('https://example.com/search?q=%s')
  const addButton = section.getByRole('button', { name: 'Add engine' })
  await expect(addButton).toBeVisible()

  await addButton.click()
  await expect(section.getByRole('checkbox', { name: 'Example Search' })).toBeChecked()

  const customRow = section.locator('.engineRow').filter({ hasText: 'Example Search' })
  const removeButton = customRow.getByRole('button', { name: 'Remove Example Search' })
  await expect(removeButton).toBeVisible()
  expect(await section.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)

  const urlInput = customRow.getByLabel('Search URL')
  await urlInput.fill('not a search URL')
  await urlInput.blur()
  await expect(urlInput).toHaveValue('https://example.com/search?q=%s')

  const contextMenu = await page.evaluate(() => window.ftElectron.contextMenu.open({
    selectionText: 'custom search'
  }))
  // Built-ins are disabled by default, so a single custom engine is a direct action.
  const searchWith = contextMenu.items.find(item => item.label === 'Search with Example Search')

  expect(searchWith).toMatchObject({
    labelKey: 'Context Menu.Search With',
    labelParameters: { engine: 'Example Search' }
  })
  expect(searchWith.submenu).toBeUndefined()
  expect(searchWith.icon).toBe('https://example.com/favicon.ico')
})

test.describe('with one external search engine enabled', () => {
  test.use({
    seed: {
      settings: {
        contextMenuSearchEngines: JSON.stringify([
          {
            id: 'duckduckgo',
            name: 'DuckDuckGo',
            url: 'https://duckduckgo.com/?q=%s',
            enabled: true
          },
          {
            id: 'startpage',
            name: 'Startpage',
            url: 'https://www.startpage.com/sp/search?query=%s',
            enabled: false
          },
          {
            id: 'qwant',
            name: 'Qwant',
            url: 'https://www.qwant.com/?q=%s',
            enabled: false
          },
          {
            id: 'brave',
            name: 'Brave Search',
            url: 'https://search.brave.com/search?q=%s',
            enabled: false
          }
        ])
      }
    }
  })

  test('shows a direct action and opens the encoded URL in the default browser', async ({ app, page }) => {
    await app.electronApp.evaluate(({ shell }) => {
      globalThis.openedExternalSearchUrls = []
      shell.openExternal = async (url) => {
        globalThis.openedExternalSearchUrls.push(url)
      }
    })

    const contextMenu = await page.evaluate(() => window.ftElectron.contextMenu.open({
      selectionText: 'privacy & cats'
    }))
    const searchWith = contextMenu.items.find(item => item.label === 'Search with DuckDuckGo')

    expect(searchWith.submenu).toBeUndefined()
    expect(searchWith).toMatchObject({
      labelKey: 'Context Menu.Search With',
      labelParameters: { engine: 'DuckDuckGo' }
    })
    expect(searchWith.icon).toBe('https://duckduckgo.com/favicon.ico')
    expect(searchWith.faviconSource).toBe('https://duckduckgo.com/?q=%s')
    await page.evaluate(({ sessionId, actionId }) => {
      return window.ftElectron.contextMenu.execute(sessionId, actionId)
    }, { sessionId: contextMenu.sessionId, actionId: searchWith.actionId })

    await expect.poll(() => app.electronApp.evaluate(() => {
      return globalThis.openedExternalSearchUrls
    })).toEqual(['https://duckduckgo.com/?q=privacy%20%26%20cats'])
  })
})

test.describe('with the maximum custom search engines configured', () => {
  test.use({
    seed: {
      settings: {
        contextMenuSearchEngines: JSON.stringify(Array.from({ length: 20 }, (_, index) => ({
          id: `custom-${index}`,
          name: `Engine ${index}`,
          url: `https://example${index}.com/search?q=%s`,
          enabled: true
        })))
      }
    }
  })

  test('rejects another engine without clearing its inputs', async ({ page }) => {
    const general = await goToSettingsSection(page, 'general')
    const addRow = general.locator('.settingsSection').filter({
      has: page.getByRole('heading', { name: 'Context Menu Search', exact: true })
    }).locator('.addEngine')
    const nameInput = addRow.getByLabel('Engine name')
    const urlInput = addRow.getByLabel('Search URL')
    await nameInput.fill('One Too Many')
    await urlInput.fill('https://overflow.example/search?q=%s')
    await addRow.getByRole('button', { name: 'Add engine' }).click()

    await expect(nameInput).toHaveValue('One Too Many')
    await expect(urlInput).toHaveValue('https://overflow.example/search?q=%s')
    await expect(page.locator('.toast .message', {
      hasText: 'You can add up to 20 custom search engines.'
    })).toBeVisible()
  })
})

test.describe('German locale', () => {
  test.use({
    seed: {
      settings: {
        currentLocale: 'de-DE',
        contextMenuSearchEngines: allExternalSearchEnginesEnabled
      }
    }
  })

  test('translates external search labels from explicit menu metadata', async ({ page }) => {
    const searchInput = page.locator('.searchInput input')
    await searchInput.fill('Auswahl')
    await searchInput.selectText()
    await searchInput.click({ button: 'right' })

    const menu = page.getByRole('menu', { name: 'Kontextmenü' })
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Suchen mit …' })).toBeVisible()
  })
})
