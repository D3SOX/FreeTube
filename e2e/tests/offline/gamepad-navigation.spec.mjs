import { expect, goTo, goToSettingsSection, test } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

const PLAYER_SEED = {
  baseTheme: 'dark',
  videoPlaybackEngine: 'built-in',
  ytDlpPlaybackEngineDefaultMigration: true
}

const GAMEPAD_BUTTON_INDEX = Object.freeze({
  primary: 0,
  back: 1,
  playPause: 9,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
})

test.use({ seed: { settings: PLAYER_SEED } })

test('only shows focus feedback during keyboard or gamepad navigation', async ({ page }) => {
  const searchInput = page.locator('.topNav .searchInput input.ft-input')
  await expect(searchInput).not.toBeFocused()
  // Themes can use a box shadow for the input border even without focus.
  const unfocusedBoxShadow = await searchInput.evaluate(element => getComputedStyle(element).boxShadow)

  await searchInput.click()
  await expect(searchInput).toBeFocused()
  await expect(page.locator('.app')).toHaveClass(/hideOutlines/)
  await expect(searchInput).toHaveCSS('outline-style', 'none')
  await expect(searchInput).toHaveCSS('box-shadow', unfocusedBoxShadow)

  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(searchInput).toBeFocused()
  await expect(page.locator('.app')).not.toHaveClass(/hideOutlines/)
  await expect(searchInput).toHaveCSS('outline-style', 'solid')
  await expect(searchInput).not.toHaveCSS('box-shadow', 'none')
  await expect(searchInput).not.toHaveCSS('box-shadow', unfocusedBoxShadow)

  await searchInput.click()
  await expect(searchInput).toBeFocused()
  await expect(page.locator('.app')).toHaveClass(/hideOutlines/)
  await expect(searchInput).toHaveCSS('outline-style', 'none')
  await expect(searchInput).toHaveCSS('box-shadow', unfocusedBoxShadow)
})

async function connectMockGamepad(page) {
  await page.evaluate(() => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }))
    const gamepad = {
      axes: [0, 0, 0, 0],
      buttons,
      connected: true,
      id: 'E2E standard controller',
      index: 1,
      mapping: 'standard',
      timestamp: 0,
    }

    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [null, gamepad]
    })
    window.__e2eGamepad = gamepad
    const event = new Event('gamepadconnected')
    Object.defineProperty(event, 'gamepad', { value: gamepad })
    window.dispatchEvent(event)
  })
}

async function pressGamepadButton(page, action) {
  const buttonIndex = GAMEPAD_BUTTON_INDEX[action]
  if (buttonIndex === undefined) {
    throw new Error(`Unknown gamepad action: ${action}`)
  }

  await page.evaluate((index) => {
    const button = window.__e2eGamepad.buttons[index]
    button.pressed = true
    button.value = 1
    window.__e2eGamepad.timestamp++
  }, buttonIndex)
  await page.waitForTimeout(50)
  await page.evaluate((index) => {
    const button = window.__e2eGamepad.buttons[index]
    button.pressed = false
    button.value = 0
    window.__e2eGamepad.timestamp++
  }, buttonIndex)
  await page.waitForTimeout(50)
}

async function moveGamepadAxis(page, axisIndex, value) {
  await page.evaluate(({ index, axisValue }) => {
    window.__e2eGamepad.axes[index] = axisValue
    window.__e2eGamepad.timestamp++
  }, { index: axisIndex, axisValue: value })
  await page.waitForTimeout(50)
  await page.evaluate((index) => {
    window.__e2eGamepad.axes[index] = 0
    window.__e2eGamepad.timestamp++
  }, axisIndex)
  await page.waitForTimeout(50)
}

async function expectContainedContrastFocusIndicator(locator, contrastColor) {
  const focusIndicator = await locator.evaluate((element) => {
    const style = getComputedStyle(element)
    const width = Number.parseFloat(style.outlineWidth)
    const offset = Number.parseFloat(style.outlineOffset)
    const contrastProbe = document.createElement('span')
    contrastProbe.style.color = 'var(--focus-ring-contrast-color)'
    element.append(contrastProbe)
    const contrastColor = getComputedStyle(contrastProbe).color
    contrastProbe.remove()
    return {
      contrastColor,
      contrastInset: style.boxShadow.includes(contrastColor) && style.boxShadow.includes('inset'),
      style: style.outlineStyle,
      outsideExtent: Math.max(0, width + offset),
    }
  })
  expect(focusIndicator).toEqual({
    contrastColor,
    contrastInset: true,
    style: 'solid',
    outsideExtent: 0,
  })
}

test('navigates and activates the interface with a standard gamepad', async ({ attachScreenshot, page }) => {
  await goTo(page, 'settings')
  const pageUrl = page.url()
  await page.bringToFront()
  await connectMockGamepad(page)

  const categories = page.locator('.settingsMenu [data-section]')
  await page.evaluate(() => document.activeElement?.blur())
  await pressGamepadButton(page, 'primary')
  await expect.poll(() => page.evaluate(() => document.activeElement !== document.body)).toBe(true)

  await categories.first().focus()
  await moveGamepadAxis(page, 1, 1)
  await expect(categories.nth(1)).toBeFocused()
  await pressGamepadButton(page, 'down')
  await expect(categories.nth(2)).toBeFocused()
  await expect(page.locator('.app')).not.toHaveClass(/hideOutlines/)
  const focusColors = await categories.nth(2).evaluate((element) => {
    const colorProbe = document.createElement('span')
    colorProbe.style.color = 'var(--primary-color)'
    element.append(colorProbe)
    const colors = {
      actual: getComputedStyle(element).outlineColor,
      expected: getComputedStyle(colorProbe).color,
    }
    colorProbe.remove()
    return colors
  })
  expect(focusColors.actual).toBe(focusColors.expected)
  await attachScreenshot('gamepad focus uses the theme color')

  const selectedSection = await categories.nth(2).getAttribute('data-section')
  await pressGamepadButton(page, 'primary')
  await expect(page.locator(`.settingsContent > [data-section="${selectedSection}"]`)).toBeVisible()

  await pressGamepadButton(page, 'back')
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeHidden()
  await expect(page).toHaveURL(pageUrl)

  await goTo(page, 'history')
  await pressGamepadButton(page, 'back')
  await expect(page).toHaveURL(pageUrl)
})

test.describe('at 95% UI scale', () => {
  test.use({ seed: { settings: { ...PLAYER_SEED, uiScale: 95 } } })

  test('keeps spatial gamepad navigation aligned', async ({ page }) => {
    await goTo(page, 'settings')
    await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBeCloseTo(0.95, 2)
    await page.bringToFront()
    await connectMockGamepad(page)

    const categories = page.locator('.settingsMenu [data-section]')
    await categories.first().focus()
    await moveGamepadAxis(page, 1, 1)
    await expect(categories.nth(1)).toBeFocused()
    await pressGamepadButton(page, 'down')
    await expect(categories.nth(2)).toBeFocused()
  })
})

test('keeps the focus indicator inside controls at layout edges', async ({ attachScreenshot, page }) => {
  await goTo(page, 'subscriptions')
  await page.bringToFront()
  await connectMockGamepad(page)

  const videosTab = page.locator('[data-subscription-feed-tab="videos"]')
  const shortsTab = page.locator('[data-subscription-feed-tab="shorts"]')
  await shortsTab.focus()
  await pressGamepadButton(page, 'left')
  await expect(videosTab).toBeFocused()

  await expectContainedContrastFocusIndicator(videosTab, 'rgb(255, 255, 255)')
  await attachScreenshot('contained gamepad focus indicator')

  await page.evaluate(() => document.body.classList.replace('dark', 'light'))
  await expectContainedContrastFocusIndicator(videosTab, 'rgb(0, 0, 0)')
  await attachScreenshot('light theme gamepad focus indicator')
  await page.evaluate(() => document.body.classList.replace('light', 'dark'))

  const sideNavOption = page.locator('.sideNav .navOption').first()
  await pressGamepadButton(page, 'left')
  await expect(sideNavOption).toBeFocused()
  await expectContainedContrastFocusIndicator(sideNavOption, 'rgb(255, 255, 255)')
  const sideNavLayers = await sideNavOption.evaluate((element) => ({
    activeIndicator: Number.parseInt(getComputedStyle(element.parentElement.querySelector('.activeIndicator')).zIndex),
    focusedOption: Number.parseInt(getComputedStyle(element).zIndex),
  }))
  expect(sideNavLayers.focusedOption).toBeGreaterThan(sideNavLayers.activeIndicator)
  await attachScreenshot('contained side navigation focus indicator')
})

test('adjusts and leaves sliders and commits select options', async ({ attachScreenshot, page }) => {
  const playbackSettings = await goToSettingsSection(page, 'playback')
  await page.bringToFront()
  await connectMockGamepad(page)

  const select = playbackSettings.locator('.select-text').first()
  await select.focus()
  await pressGamepadButton(page, 'primary')
  await expect(select).toHaveAttribute('aria-expanded', 'true')

  const options = page.locator(`#${await select.getAttribute('aria-controls')} [role="option"]`)
  const activeOptionId = await select.getAttribute('aria-activedescendant')
  const activeOptionIndex = await options.evaluateAll((elements, id) => (
    elements.findIndex(element => element.id === id)
  ), activeOptionId)
  await pressGamepadButton(page, activeOptionIndex < await options.count() - 1 ? 'down' : 'up')

  const optionName = await options.filter({ has: page.locator('.optionName') })
    .evaluateAll(elements => elements.find(element => element.classList.contains('active'))?.textContent.trim())
  await pressGamepadButton(page, 'primary')
  await expect(select).toHaveAttribute('aria-expanded', 'false')
  await expect(select.locator('.selectedValue')).toHaveText(optionName)

  const slider = playbackSettings.locator('input[type="range"]').first()
  await slider.focus()
  await pressGamepadButton(page, 'primary')
  await expect(slider).toHaveAttribute('data-gamepad-active', 'true')
  await attachScreenshot('active gamepad slider')
  const initialValue = await slider.inputValue()
  await pressGamepadButton(page, 'right')
  await expect(slider).not.toHaveValue(initialValue)
  await pressGamepadButton(page, 'primary')
  await expect(slider).not.toHaveAttribute('data-gamepad-active')
  await pressGamepadButton(page, 'down')
  await expect(slider).not.toBeFocused()
})

test('keeps a changed quick settings slider focused', async ({ attachScreenshot, page }) => {
  const trigger = page.locator('.profileTrigger')
  await trigger.focus()
  await page.bringToFront()
  await connectMockGamepad(page)
  await pressGamepadButton(page, 'primary')

  const menu = page.getByRole('dialog', { name: 'Quick settings' })
  await expect(menu).toBeVisible()
  await expect(menu).not.toBeFocused()
  await expect(menu.locator(':focus')).toHaveCount(1)

  const slider = menu.getByRole('slider').first()
  await slider.focus()
  await pressGamepadButton(page, 'primary')
  await expect(slider).toHaveAttribute('data-gamepad-active', 'true')

  const initialValue = await slider.inputValue()
  await pressGamepadButton(page, 'right')

  await expect(slider).not.toHaveValue(initialValue)
  await expect(slider).toBeFocused()
  await expect(slider.locator('..')).toHaveCSS('box-shadow', /inset/)
  await expect(slider).toHaveAttribute('data-gamepad-active', 'true')
  await expect(menu).not.toBeFocused()
  await attachScreenshot('active quick settings gamepad slider')
})

test.describe('quick settings changed-setting controls', () => {
  test.use({
    seed: {
      settings: {
        ...PLAYER_SEED,
        highlightChangedSettings: true,
        thumbnailSize: 110
      }
    }
  })

  test('keeps quick settings open after resetting with a gamepad', async ({ page }) => {
    const trigger = page.locator('.profileTrigger')
    await trigger.focus()
    await page.bringToFront()
    await connectMockGamepad(page)
    await pressGamepadButton(page, 'primary')

    const menu = page.getByRole('dialog', { name: 'Quick settings' })
    const slider = menu.locator('.thumbnailSizeSlider').getByRole('slider')
    const reset = slider.locator('..').getByRole('button', {
      name: 'Reset this setting to its default'
    })
    await reset.focus()
    await pressGamepadButton(page, 'primary')
    await page.waitForTimeout(300)

    await expect(reset).toHaveCount(0)
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(menu).toBeVisible()
    await expect(slider).toBeFocused()
  })
})

test.describe('configured gamepad highlight roundness', () => {
  test.use({
    seed: {
      settings: {
        ...PLAYER_SEED,
        disableSmoothScrolling: true,
        highlightChangedSettings: true,
        uiRoundness: 200
      }
    }
  })

  test('applies UI roundness to focus and active slider highlights', async ({ attachScreenshot, page }) => {
    await goTo(page, 'subscriptions')
    await page.bringToFront()
    await connectMockGamepad(page)

    const tab = page.locator('[data-subscription-feed-tab="videos"]')
    await page.locator('[data-subscription-feed-tab="shorts"]').focus()
    await pressGamepadButton(page, 'left')
    await expect(tab).toBeFocused()
    await expect(tab).toHaveCSS('border-radius', '8px')

    const appearanceSettings = await goToSettingsSection(page, 'appearance')
    const switchInput = appearanceSettings.getByRole('checkbox', {
      name: 'Disable Smooth Scrolling'
    })
    const switchSetting = switchInput.locator('..')
    const switchLabel = switchSetting.locator('.switch-label')
    const unfocusedSwitchPositions = await switchLabel.evaluate(element => ({
      textStart: element.querySelector('.switch-label-text').getBoundingClientRect().left,
      thumbStart: element.getBoundingClientRect().left +
        Number.parseFloat(getComputedStyle(element, '::after').insetInlineStart)
    }))
    await page.evaluate(() => (
      document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('showOutlines')
    ))
    await switchInput.evaluate(element => element.focus({ focusVisible: true }))
    await expect(switchInput).toBeFocused()
    await expect(switchInput).toHaveCSS('outline-style', 'none')
    await expect(switchLabel).toHaveCSS('outline-style', 'solid')
    await expect(switchLabel).toHaveCSS('border-radius', '8px')
    await expect(switchSetting).toHaveCSS('border-left-width', '3px')
    const focusedSwitchPositions = await switchLabel.evaluate(element => ({
      ringStartPadding: Number.parseFloat(getComputedStyle(element, '::after').insetInlineStart),
      textStart: element.querySelector('.switch-label-text').getBoundingClientRect().left,
      thumbStart: element.getBoundingClientRect().left +
        Number.parseFloat(getComputedStyle(element, '::after').insetInlineStart)
    }))
    expect(focusedSwitchPositions.ringStartPadding).toBeGreaterThanOrEqual(5)
    expect(focusedSwitchPositions.textStart).toBeCloseTo(unfocusedSwitchPositions.textStart)
    expect(focusedSwitchPositions.thumbStart).toBeCloseTo(unfocusedSwitchPositions.thumbStart)
    await attachScreenshot('focused changed switch label')

    const playbackSettings = await goToSettingsSection(page, 'playback')
    const slider = playbackSettings.locator('input[type="range"]').first()
    await slider.focus()
    await pressGamepadButton(page, 'primary')
    await expect(slider).toHaveAttribute('data-gamepad-active', 'true')
    await expect(slider.locator('..')).toHaveCSS('border-radius', '8px')
  })
})

test('uses the menu button to toggle playback', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await page.bringToFront()
  await connectMockGamepad(page)

  await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)
  await pressGamepadButton(page, 'playPause')
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(true)
  await pressGamepadButton(page, 'playPause')
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)
})

test('backs out of the player menu without leaving the video', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await page.bringToFront()
  await connectMockGamepad(page)

  const pageUrl = page.url()
  const player = page.locator('.tabContent[aria-hidden="false"] .ftVideoPlayer')
  await player.hover()
  await player.getByRole('button', { name: 'More settings' }).click()
  const overflowMenu = player.locator('.shaka-overflow-menu')
  await expect(overflowMenu).toBeVisible()

  await pressGamepadButton(page, 'back')
  await expect(overflowMenu).toBeHidden()
  await expect(page).toHaveURL(pageUrl)
})
