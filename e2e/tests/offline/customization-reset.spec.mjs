import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'

for (const { name, lastItem, addButton, pickerRole } of [
  { name: 'navigation', lastItem: 'Stats', addButton: 'Add item', pickerRole: 'menu' },
  { name: 'quick settings', lastItem: 'Region for trending', addButton: 'Add setting', pickerRole: 'dialog' },
]) {
  test(`disables ${name} reset only when the default items and order are restored`, async ({ page }) => {
    const appearance = await goToSettingsSection(page, 'appearance')
    await appearance.getByRole('button', { name: `Customize ${name}` }).click()

    const reset = page.getByRole('button', { name: 'Reset to defaults', exact: true })
    const moveUp = page.getByRole('button', { name: `Move ${lastItem} up`, exact: true })
    const moveDown = page.getByRole('button', { name: `Move ${lastItem} down`, exact: true })
    const remove = page.getByRole('button', { name: `Remove ${lastItem}`, exact: true })
    await expect(reset).toBeDisabled()

    await moveUp.click()
    await expect(reset).toBeEnabled()
    await moveDown.click()
    await expect(reset).toBeDisabled()

    await remove.click()
    await expect(reset).toBeEnabled()
    await page.getByRole('button', { name: addButton, exact: true }).click()
    const picker = page.getByRole(pickerRole, { name: addButton, exact: true })
    if (pickerRole === 'menu') {
      await picker.getByRole('menuitem', { name: lastItem, exact: true }).click()
    } else {
      await picker.getByPlaceholder('Search settings').fill(lastItem)
      await picker.locator('.optionWrapper').filter({ hasText: lastItem }).click()
      await picker.getByPlaceholder('Search settings').press('Escape')
    }
    await expect(reset).toBeDisabled()

    await moveUp.click()
    await expect(reset).toBeEnabled()
    await reset.click()
    await expect(reset).toBeDisabled()
    await expect(moveDown).toBeDisabled()

    await remove.click()
    await expect(reset).toBeEnabled()
    await reset.click()
    await expect(reset).toBeDisabled()
    await expect(remove).toBeVisible()
  })
}
