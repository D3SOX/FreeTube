import { test, expect, sel } from '../../helpers/app.mjs'

test('compact tab actions keep their labels and execute on the target tab', async ({ page }) => {
  const target = await page.evaluate(() => window.ftElectron.tabs.create({
    route: '/about', makeActive: false, lazyLoad: true
  }))
  const tab = page.locator(`.tab[data-tab-id="${target.id}"]`)
  const open = () => tab.click({ button: 'right' })
  const state = () => page.evaluate(async id => (
    (await window.ftElectron.tabs.getState()).tabs.find(tab => tab.id === id)
  ), target.id)

  await open()
  const menu = page.locator('.compactTabMenu')
  await expect(menu.locator('.tabQuickActions button')).toHaveCount(4)
  for (const name of ['Reload Tab', 'Duplicate Tab', 'Pin Tab', 'Close Tab']) {
    await expect(menu.getByRole('menuitem', { name, exact: true })).toHaveAttribute('title', name)
  }
  const box = await menu.boundingBox()
  expect(box.width).toBeLessThanOrEqual(240)
  expect(box.height).toBeLessThan(300)
  await menu.getByRole('menuitem', { name: 'Pin Tab', exact: true }).click()
  await expect.poll(async () => (await state()).isPinned).toBe(true)

  await open()
  await menu.getByRole('menuitemradio', { name: 'Purple', exact: true }).click()
  await expect.poll(async () => (await state()).color).toBe('purple')
  await open()
  await expect(menu.getByRole('menuitemradio', { name: 'Purple', exact: true })).toBeChecked()
  await menu.getByRole('menuitemradio', { name: 'Default', exact: true }).click()
  await expect.poll(async () => (await state()).color).toBeNull()

  await open()
  await menu.getByRole('menuitem', { name: 'Unpin Tab', exact: true }).click()
  await expect.poll(async () => (await state()).isPinned).toBe(false)
  await open()
  await menu.getByRole('menuitem', { name: 'Load Tab', exact: true }).click()
  await expect.poll(async () => (await state()).isUnloaded).toBe(false)
  const refreshKey = (await state()).refreshKey
  await open()
  await menu.getByRole('menuitem', { name: 'Reload Tab', exact: true }).click()
  await expect.poll(async () => (await state()).refreshKey).toBeGreaterThan(refreshKey)

  await open()
  await menu.getByRole('menuitem', { name: 'Duplicate Tab', exact: true }).click()
  await expect(page.locator(sel.tabs)).toHaveCount(3)
  await open()
  await menu.getByRole('menuitem', { name: 'Close Tab', exact: true }).click()
  await expect(tab).toHaveCount(0)
  await expect(page.locator(sel.tabs)).toHaveCount(2)
})

test('compact tab menu supports keyboard navigation and disabled actions', async ({ page }) => {
  await page.locator(sel.activeTab).focus()
  await page.locator(sel.activeTab).click({ button: 'right' })
  const menu = page.locator('.compactTabMenu')
  await expect(menu.getByRole('menuitem', { name: 'Unload Tab', exact: true })).toBeDisabled()
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'Reload Tab', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(menu.getByRole('menuitem', { name: 'Duplicate Tab', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await expect(page.locator(sel.activeTab)).toHaveClass(/pinned/)

  await page.locator(sel.activeTab).click({ button: 'right' })
  await menu.getByRole('menuitemradio', { name: 'Default', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(menu.getByRole('menuitemradio', { name: 'Red', exact: true })).toBeFocused()
  await page.keyboard.press('Space')
  await page.locator(sel.activeTab).click({ button: 'right' })
  await expect(menu.getByRole('menuitemradio', { name: 'Red', exact: true })).toBeChecked()
  await menu.getByRole('menuitem', { name: 'Move Tab to Group', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(menu.getByRole('menuitemradio', { name: 'Ungrouped', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(menu.getByRole('menuitem', { name: 'Move Tab to Group', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(page.locator(sel.activeTab)).toBeFocused()
})

test('compact bulk actions preserve the selection and mixed color state', async ({ page }) => {
  await page.locator(sel.newTabButton).click()
  await page.locator(sel.newTabButton).click()
  const ids = await page.locator(sel.tabs).evaluateAll(tabs => tabs.map(tab => tab.dataset.tabId))
  const open = async () => {
    await page.evaluate(async ids => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('setTabSelection', ids)
    }, ids.slice(0, 2))
    await page.locator(`.tab[data-tab-id="${ids[0]}"]`).click({ button: 'right' })
  }
  await page.evaluate(id => window.ftElectron.tabs.setColor(id, 'blue'), ids[0])
  await open()
  const menu = page.locator('.compactTabMenu')
  await expect(menu.locator('.tabColorPalette [aria-checked="true"]')).toHaveCount(0)
  await expect(menu.getByRole('menuitem', { name: 'Duplicate 2 Tabs', exact: true })).toHaveAttribute('title', 'Duplicate 2 Tabs')
  await menu.getByRole('menuitemradio', { name: 'Green', exact: true }).click()
  await expect.poll(() => page.evaluate(async () => (
    (await window.ftElectron.tabs.getState()).tabs.map(tab => tab.color)
  ))).toEqual(['green', 'green', null])
  await open()
  await menu.getByRole('menuitem', { name: 'Pin Tabs', exact: true }).click()
  await expect(page.locator(`${sel.tabs}.pinned`)).toHaveCount(2)
  await open()
  await menu.getByRole('menuitem', { name: 'Close 2 Tabs', exact: true }).click()
  await expect(page.locator(sel.tabs)).toHaveCount(1)
  await expect(page.locator(sel.tabs)).toHaveAttribute('data-tab-id', ids[2])
})

test('pink tab colors render and survive an app restart', async ({ page, app }) => {
  await page.locator(sel.activeTab).click({ button: 'right' })
  await page.getByRole('menuitemradio', { name: 'Pink', exact: true }).click()
  await expect(page.locator(sel.activeTab)).toHaveCSS('--tab-accent-color', '#d65b96')
  await app.relaunch()
  await expect(app.page.locator(sel.activeTab)).toHaveCSS('--tab-accent-color', '#d65b96')
  await app.page.locator(sel.activeTab).click({ button: 'right' })
  await expect(app.page.getByRole('menuitemradio', { name: 'Pink', exact: true })).toBeChecked()
})

for (const settings of [
  { currentLocale: 'en-US', baseTheme: 'dark', iconPack: 'material', uiScale: 100 },
  { currentLocale: 'de-DE', baseTheme: 'light', iconPack: 'remix', uiScale: 125 },
  { currentLocale: 'en-US', baseTheme: 'dark', iconPack: 'remix', uiScale: 95 }
]) {
  test.describe(`compact tab menu ${Object.values(settings).join(' ')}`, () => {
    test.use({ seed: { settings } })

    test('fits small windows and keeps the action header clear of scrolling', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 680, height: 300 })
      await page.locator(sel.activeTab).click({ button: 'right' })
      const menu = page.locator('.compactTabMenu')
      await expect(menu).toBeVisible()
      await expect(menu.locator('.tabQuickActions svg')).toHaveCount(4)
      const colors = menu.locator('.tabColorPalette button')
      await expect(colors).toHaveCount(8)
      const positions = await colors.evaluateAll(buttons => buttons.map(button => {
        const { x, y } = button.getBoundingClientRect()
        return { x, y }
      }))
      expect(new Set(positions.map(({ y }) => y)).size).toBe(2)
      for (let index = 0; index < 4; index++) {
        expect(positions[index].y).toBe(positions[0].y)
        expect(positions[index + 4].y).toBe(positions[4].y)
        expect(positions[index].x).toBe(positions[index + 4].x)
      }
      await expect(menu).toHaveCSS('opacity', '1')
      await testInfo.attach('compact tab menu', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
      if (settings.uiScale === 100) {
        await testInfo.attach('compact tab menu detail', { body: await menu.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
      }

      // Reduce the action viewport while the menu stays open, then restore it.
      const scroller = menu.locator('.menuScroll')
      const header = menu.locator('.tabMenuHeader')
      const headerBox = await header.boundingBox()
      await menu.evaluate(element => { element.style.maxHeight = '150px' })
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      await expect(scroller.locator(':scope > .os-scrollbar-vertical')).not.toHaveClass(/os-scrollbar-unusable/)
      expect(await header.boundingBox()).toEqual(headerBox)
      await expect.poll(() => scroller.evaluate(element => {
        const header = element.parentElement.querySelector('.tabMenuHeader').getBoundingClientRect()
        return element.getBoundingClientRect().top >= header.bottom
      })).toBe(true)

      await menu.evaluate(element => { element.style.maxHeight = 'none' })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
      await expect(scroller.locator(':scope > .os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
      await page.keyboard.press('Escape')
      await page.locator(sel.activeTab).click({ button: 'right' })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
      const box = await menu.boundingBox()
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
      expect(box.x).toBeGreaterThanOrEqual(7)
      expect(box.y).toBeGreaterThanOrEqual(7)
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 7)
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 7)
    })
  })
}
