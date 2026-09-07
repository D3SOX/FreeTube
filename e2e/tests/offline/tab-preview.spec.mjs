import { test, expect, sel } from '../../helpers/app.mjs'

const CAPTURE_CLASS = 'opentubex-tab-preview-capturing'
const CAPTURE_STYLE_ID = 'opentubex-tab-preview-capture-style'

/**
 * Reads the pixel size out of a preview data URL. Previews are JPEG, but a
 * cache written by an older version can still hand back a PNG.
 * @param {string} dataUrl
 * @returns {{ width: number, height: number }}
 */
function imageSize(dataUrl) {
  const buffer = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
  if (buffer.readUInt32BE(0) === 0x89504e47) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }

  // Walk the JPEG segments to the start-of-frame, which carries the size.
  for (let offset = 2; offset < buffer.length - 9;) {
    if (buffer[offset] !== 0xff) {
      throw new Error(`not a JPEG segment at offset ${offset}`)
    }
    const marker = buffer[offset + 1]
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf &&
      marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isStartOfFrame) {
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) }
    }
    offset += 2 + buffer.readUInt16BE(offset + 2)
  }
  throw new Error('no JPEG start-of-frame found')
}

/**
 * Hovers the given tab and resolves once its tooltip shows a captured preview.
 * @param {import('@playwright/test').Page} page
 * @param {number} index
 * @returns {Promise<string>} the preview data URL
 */
async function hoverTabForPreview(page, index) {
  await page.locator(sel.tabs).nth(index).hover()
  const preview = page.locator('.tabTooltip .tabTooltipPreview img')
  await expect(preview).toBeVisible()
  await expect.poll(async () => (await preview.getAttribute('src'))?.startsWith('data:image/jpeg'))
    .toBe(true)
  return await preview.getAttribute('src')
}

test.describe('tab previews', () => {
  test('captures the page content without the tab bar and header', async ({ page, attachScreenshot }) => {
    const dataUrl = await hoverTabForPreview(page, 0)
    await attachScreenshot('tab preview tooltip')

    const expectedRatio = await page.evaluate(() => {
      const bottomOf = (selector) => document.querySelector(selector)?.getBoundingClientRect().bottom ?? 0
      const contentTop = Math.max(bottomOf('.tabBar'), bottomOf('.topNav'))
      return window.innerWidth / (window.innerHeight - contentTop)
    })

    const { width, height } = imageSize(dataUrl)
    // The capture is downscaled to fit the tooltip, so only the shape of the
    // cropped region survives. Leaving the 60px header in would visibly change
    // it (~1.84 instead of ~1.98 at the default test window size).
    expect(width / height).toBeGreaterThan(expectedRatio - 0.03)
    expect(width / height).toBeLessThan(expectedRatio + 0.03)
  })

  test('never stores fewer pixels than the tooltip displays', async ({ page }) => {
    const dataUrl = await hoverTabForPreview(page, 0)

    const displayed = await page.locator('.tabTooltip .tabTooltipPreview').boundingBox()
    const { width } = imageSize(dataUrl)
    // Anything below the displayed width would be upscaled by the browser.
    expect(width).toBeGreaterThanOrEqual(Math.round(displayed.width))
  })

  test('shows the tab group icon above the preview with clear spacing', async ({ page }) => {
    const activeTabId = await page.locator(sel.activeTab).getAttribute('data-tab-id')
    await page.evaluate(async (tabId) => {
      const group = await window.ftElectron.tabs.createGroup({ name: 'Preview group', color: 'blue' })
      await window.ftElectron.tabs.setGroup([tabId], group.id)
    }, activeTabId)
    await expect(page.locator(sel.activeTab).locator('.groupBadge')).toBeVisible()

    await hoverTabForPreview(page, 0)
    const group = page.locator('.tabTooltipGroup')
    const preview = page.locator('.tabTooltipPreview')
    await expect(group).toContainText('Preview group')
    await expect(group.locator('[data-icon="layer-group"]')).toBeVisible()

    const [groupBox, previewBox] = await Promise.all([
      group.boundingBox(),
      preview.boundingBox()
    ])
    expect(previewBox.y - (groupBox.y + groupBox.height)).toBeGreaterThanOrEqual(6)
  })

  test('keeps the tooltip clear of the page scrollbar beside right vertical tabs', async ({ page, attachScreenshot }) => {
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setVerticalTabBarWidth', 220)
      store.commit('setTabBarPosition', 'right')

      const content = document.createElement('div')
      content.dataset.tabPreviewOverflow = ''
      content.style.height = '3000px'
      document.body.append(content)
    })
    await expect.poll(() => page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight
    )).toBe(true)
    await hoverTabForPreview(page, 0)

    const [tooltipBox, scrollbarBox, tabBarBox] = await Promise.all([
      page.locator('.tabTooltip').boundingBox(),
      page.locator('body > .os-scrollbar-vertical').boundingBox(),
      page.locator('.tabBar.position-right').boundingBox()
    ])
    const gap = scrollbarBox.x - (tooltipBox.x + tooltipBox.width)
    expect(gap).toBeGreaterThanOrEqual(5)
    expect(gap).toBeLessThanOrEqual(7)
    expect(tooltipBox.x + tooltipBox.width).toBeLessThan(scrollbarBox.x)
    expect(scrollbarBox.x + scrollbarBox.width).toBeLessThanOrEqual(tabBarBox.x + 1)
    await attachScreenshot('tab preview beside right tabs')
  })

  test('repositions an open tooltip after previews are disabled', async ({ page }) => {
    await hoverTabForPreview(page, 0)

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateShowTabPreviews', false)
    })

    const tooltip = page.locator('.tabTooltip')
    await expect(tooltip.locator('.tabTooltipPreview')).toHaveCount(0)
    await expect.poll(async () => {
      return await page.locator(sel.tabs).first().evaluate((tab) => {
        const tooltip = document.querySelector('.tabTooltip')
        const tabBounds = tab.getBoundingClientRect()
        const tooltipBounds = tooltip.getBoundingClientRect()
        const expectedLeft = Math.max(
          8,
          Math.min(
            window.innerWidth - tooltipBounds.width - 8,
            tabBounds.left + tabBounds.width / 2 - tooltipBounds.width / 2
          )
        )
        return Math.abs(tooltipBounds.left - Math.round(expectedLeft))
      })
    }).toBeLessThanOrEqual(1)
  })

  test('hides tab previews from the page while capturing', async ({ page }) => {
    await page.locator(sel.newTabButton).click()
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    await hoverTabForPreview(page, 1)

    // The capture stylesheet is injected by the main process on the first
    // capture; applying its class reproduces what a capture sees.
    await expect(page.locator(`#${CAPTURE_STYLE_ID}`)).toHaveCount(1)
    const hiddenWhileCapturing = await page.evaluate((captureClass) => {
      document.documentElement.classList.add(captureClass)
      const visibilities = Array.from(
        document.querySelectorAll('[data-tab-preview-overlay]'),
        (element) => getComputedStyle(element).visibility
      )
      document.documentElement.classList.remove(captureClass)
      return visibilities
    }, CAPTURE_CLASS)

    expect(hiddenWhileCapturing.length).toBeGreaterThan(0)
    expect(hiddenWhileCapturing.every((visibility) => visibility === 'hidden')).toBe(true)
  })

  test('keeps previews when re-enabled during an active transition', async ({ page }) => {
    await hoverTabForPreview(page, 0)
    const activeTabId = await page.locator(sel.activeTab).getAttribute('data-tab-id')

    await page.evaluate(async (tabId) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const capturePromise = window.ftElectron.tabs.capturePreview(tabId)
      window.ftElectron.tabs.setPreviewCapturePaused(true)
      await store.dispatch('updateShowTabPreviews', false)
      await capturePromise
    }, activeTabId)

    await expect.poll(async () => {
      const previews = await page.evaluate(
        tabId => window.ftElectron.tabs.getCachedPreviews([tabId]),
        activeTabId
      )
      return previews[activeTabId] ?? null
    }).toBe(null)

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateShowTabPreviews', true)
      await new Promise(resolve => requestAnimationFrame(resolve))
      window.ftElectron.tabs.setPreviewCapturePaused(false)
    })
    await expect.poll(async () => {
      const previews = await page.evaluate(
        tabId => window.ftElectron.tabs.getCachedPreviews([tabId]),
        activeTabId
      )
      return previews[activeTabId] ?? null
    }).toMatch(/^data:image\/jpeg;base64,/)
  })
})

test.describe('tab previews disabled', () => {
  test.use({ seed: { settings: { showTabPreviews: false } } })

  test('keeps a compact title tooltip and removes preview images', async ({ page }) => {
    await page.locator(sel.tabs).first().hover()

    const tooltip = page.locator('.tabTooltip')
    const title = tooltip.locator('.tabTooltipTitle')
    await expect(tooltip).toBeVisible()
    await expect(title).not.toBeEmpty()
    await expect(tooltip.locator('.tabTooltipPreview')).toHaveCount(0)

    const [tooltipBox, titleBox] = await Promise.all([
      tooltip.boundingBox(),
      title.boundingBox()
    ])
    expect(tooltipBox.width).toBeLessThanOrEqual(titleBox.width + 20)

    const activeTabId = await page.locator(sel.activeTab).getAttribute('data-tab-id')
    await expect.poll(() => page.evaluate(
      tabId => window.ftElectron.tabs.capturePreview(tabId),
      activeTabId
    )).toBe(null)

    await page.evaluate(async () => {
      for (let i = 0; i < 9; i++) {
        await window.ftElectron.tabs.create({
          makeActive: false,
          lazyLoad: true
        })
      }
    })
    await expect(page.locator(sel.tabs)).toHaveCount(10)
    await page.keyboard.down('Control')
    try {
      await page.keyboard.press('Tab')
      await expect(page.locator('.tabSwitcher.noPreviews')).toBeVisible()
      await expect(page.locator('.tabSwitcherPreview')).toHaveCount(0)

      const gridPositions = await page.locator('.tabSwitcherItem').evaluateAll((items) => ({
        rows: new Set(items.map(item => Math.round(item.getBoundingClientRect().top))).size,
        columns: new Set(items.map(item => Math.round(item.getBoundingClientRect().left))).size
      }))
      expect(gridPositions.rows).toBeGreaterThan(1)
      expect(gridPositions.columns).toBeGreaterThan(1)

      const verticalCenters = await page.locator('.tabSwitcherItem').first().evaluate((item) => {
        const center = element => {
          const bounds = element.getBoundingClientRect()
          return bounds.top + bounds.height / 2
        }
        return {
          item: center(item),
          icon: center(item.querySelector('.tabSwitcherTitleIcon, .tabSwitcherTitleAvatar')),
          text: center(item.querySelector('.tabSwitcherTitleText'))
        }
      })
      expect(Math.abs(verticalCenters.icon - verticalCenters.item)).toBeLessThanOrEqual(1)
      expect(Math.abs(verticalCenters.text - verticalCenters.item)).toBeLessThanOrEqual(1)
    } finally {
      await page.keyboard.up('Control')
    }
  })
})

/**
 * Groups the active tab with unloaded tabs so previews cover both captured pages
 * and fallbacks without fetching remote content.
 * @param {import('@playwright/test').Page} page
 * @param {number} count total tabs in the collapsed group, including the active tab
 * @returns {Promise<{groupId: string, tabIds: string[]}>}
 */
async function createCollapsedPreviewGroup(page, count = 4) {
  return page.evaluate(async count => {
    const state = await window.ftElectron.tabs.getState()
    const ids = [state.tabs.find(tab => tab.isActive).id]
    for (let index = 1; index < count; index++) {
      const tab = await window.ftElectron.tabs.create({
        route: `/watch/group-preview-${index}`,
        title: `Group preview ${index}`,
        makeActive: false,
        lazyLoad: true
      })
      ids.push(tab.id)
    }
    const group = await window.ftElectron.tabs.createGroup({ name: 'Research', color: 'blue' })
    await window.ftElectron.tabs.setGroup(ids, group.id)
    await window.ftElectron.tabs.updateGroup(group.id, { isCollapsed: true })
    return { groupId: group.id, tabIds: ids }
  }, count)
}

test.describe('tab group previews', () => {
  test('shows captured pages and unloaded fallbacks in a titled grid', async ({ page, attachScreenshot }) => {
    const { tabIds } = await createCollapsedPreviewGroup(page)
    const trigger = page.locator('.collapsedTabGroup')
    await expect(trigger).not.toHaveAttribute('title')
    await trigger.hover()

    const tooltip = page.locator('.tabGroupTooltip')
    await expect(tooltip).toBeVisible()
    await expect(tooltip.locator('.tabTooltipTitle')).toHaveText('Research')
    await expect(tooltip.locator('.tabTooltipCount')).toHaveText('4 tabs')
    await expect(tooltip.locator('.tabTooltipGridItem')).toHaveCount(4)
    await expect(tooltip.locator('.tabTooltipGridTitle')).toHaveText([
      /.+/, 'Group preview 1', 'Group preview 2', 'Group preview 3'
    ])
    await expect(tooltip.locator('.tabTooltipPreview img').first()).toHaveAttribute('src', /^data:image\/jpeg/)
    await expect(tooltip.locator('.tabTooltipPreviewFallback')).toHaveCount(3)
    await expect(tooltip.locator('.tabTooltipGridTitleIcon[data-icon="rss"]')).toHaveCount(1)
    await expect(tooltip.locator('.tabTooltipGridTitleIcon[data-icon="clapperboard"]')).toHaveCount(3)
    await expect(trigger).toHaveAttribute('aria-describedby', await tooltip.getAttribute('id'))

    const positions = await tooltip.locator('.tabTooltipGridItem').evaluateAll(items => ({
      rows: new Set(items.map(item => Math.round(item.getBoundingClientRect().top))).size,
      columns: new Set(items.map(item => Math.round(item.getBoundingClientRect().left))).size
    }))
    expect(positions).toEqual({ rows: 2, columns: 2 })
    const state = await page.evaluate(() => window.ftElectron.tabs.getState())
    expect(state.tabs.filter(tab => tabIds.slice(1).includes(tab.id)).every(tab => tab.isUnloaded)).toBe(true)
    await attachScreenshot('collapsed tab group preview grid')

    await page.keyboard.press('Escape')
    await expect(tooltip).toBeHidden()
    await trigger.focus()
    await expect(tooltip).toBeVisible()
    await page.locator(sel.newTabButton).focus()
    await expect(tooltip).toBeHidden()
    await page.locator(sel.newTabButton).hover()
    await trigger.hover()
    await expect(tooltip).toBeVisible()
    await trigger.click()
    await expect(tooltip).toBeHidden()
    await expect(page.locator(sel.tabs)).toHaveCount(4)
  })

  for (const position of ['top', 'bottom', 'left', 'right']) {
    test(`fits a large group beside ${position} tabs at fractional UI scale`, async ({ page, attachScreenshot }) => {
      await page.setViewportSize({ width: 800, height: 450 })
      await page.evaluate(async position => {
        await window.ftElectron.setZoomFactor(0.95)
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setTabBarPosition', position)
      }, position)
      await createCollapsedPreviewGroup(page, 8)
      await page.locator('.collapsedTabGroup').hover()
      const tooltip = page.locator('.tabGroupTooltip')
      await expect(tooltip).toBeVisible()
      await expect(tooltip.locator('.tabTooltipGridItem')).toHaveCount(6)
      await expect(tooltip.locator('.tabTooltipRemaining')).toHaveText('+2')
      await expect.poll(() => tooltip.evaluate((element, position) => {
        const bounds = element.getBoundingClientRect()
        const rail = document.querySelector('.tabBar').getBoundingClientRect()
        const besideRail = {
          top: bounds.top >= rail.bottom + 5,
          bottom: bounds.bottom <= rail.top - 5,
          left: bounds.left >= rail.right + 5,
          right: bounds.right <= rail.left - 5
        }[position]
        const inside = bounds.left >= 7 && bounds.top >= 7 &&
          bounds.right <= window.innerWidth - 7 && bounds.bottom <= window.innerHeight - 7
        const childrenFit = [...element.querySelectorAll('.tabTooltipGridItem, .tabTooltipRemaining')]
          .every(child => child.getBoundingClientRect().bottom <= bounds.bottom - 7)
        return { besideRail, inside, childrenFit }
      }, position)).toEqual({ besideRail: true, inside: true, childrenFit: true })
      const titlesAligned = await tooltip.locator('.tabTooltipGridTitle').evaluateAll(titles => titles.every(title => {
        const icon = title.querySelector('.tabTooltipGridTitleIcon').getBoundingClientRect()
        const text = title.querySelector('.tabTooltipGridTitleText').getBoundingClientRect()
        return icon.right < text.left && Math.abs(icon.top + icon.height / 2 - text.top - text.height / 2) <= 1
      }))
      expect(titlesAligned).toBe(true)
      await attachScreenshot(`group previews ${position} fractional scale`)
    })
  }

  test('uses channel avatars beside titles, handles failed images, and respects the icon setting', async ({ page }) => {
    const { tabIds, groupId } = await createCollapsedPreviewGroup(page)
    const avatarTabId = await page.evaluate(async groupId => {
      const route = '/channel/UCgroupPreviewAvatar'
      const tab = await window.ftElectron.tabs.create({ route, title: 'Channel avatar', makeActive: false, lazyLoad: true })
      const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
      const bytes = Uint8Array.from(atob(image), character => character.charCodeAt(0))
      await window.ftElectron.tabs.updateAvatar(bytes.buffer, tab.id, route)
      await window.ftElectron.tabs.setGroup([tab.id], groupId)
      return tab.id
    }, groupId)
    await page.locator('.collapsedTabGroup').hover()
    const item = page.locator('.tabTooltipGridItem').filter({ hasText: 'Channel avatar' })
    const avatar = item.locator('.tabTooltipGridTitleAvatar')
    await expect(avatar).toBeVisible()
    await expect.poll(() => avatar.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
    await avatar.dispatchEvent('error')
    await expect(avatar).toHaveCount(0)
    await expect(item.locator('.tabTooltipGridTitleIcon')).toHaveAttribute('data-icon', 'circle-user')

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateShowTabIcons', false)
    })
    await expect(page.locator('.tabTooltipGridTitleIcon, .tabTooltipGridTitleAvatar')).toHaveCount(0)
    await expect(page.locator('.tabTooltipGridTitleText')).toHaveCount(5)
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateShowTabIcons', true)
    })
    await expect(page.locator('.tabTooltipGridTitleIcon')).toHaveCount(5)
    const state = await page.evaluate(() => window.ftElectron.tabs.getState())
    expect(state.activeTabId).toBe(tabIds[0])
    expect(state.tabs.find(tab => tab.id === avatarTabId).isUnloaded).toBe(true)
  })

  test('keeps the custom title and count when previews are disabled', async ({ page, attachScreenshot }) => {
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateBaseTheme', 'dark')
    })
    await createCollapsedPreviewGroup(page)
    const trigger = page.locator('.collapsedTabGroup')
    await trigger.hover()
    const tooltip = page.locator('.tabGroupTooltip')
    await expect(tooltip.locator('.tabTooltipGridItem')).toHaveCount(4)
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateShowTabPreviews', false)
    })
    await expect(tooltip).toBeVisible()
    await expect(tooltip.locator('.tabTooltipGrid')).toHaveCount(0)
    await expect(tooltip.locator('.tabTooltipTitle')).toHaveText('Research')
    await expect(tooltip.locator('.tabTooltipCount')).toHaveText('4 tabs')
    expect((await tooltip.boundingBox()).width).toBeLessThan(200)
    await attachScreenshot('group tooltip without previews in dark theme')
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateShowTabPreviews', true)
    })
    await expect(tooltip.locator('.tabTooltipGridItem')).toHaveCount(4)
    await expect(tooltip.locator('.tabTooltipPreview img').first()).toHaveAttribute('src', /^data:image\/jpeg/)
    await expect(tooltip).toHaveCSS('visibility', 'visible')
    await attachScreenshot('group preview grid in dark theme')
  })
})
