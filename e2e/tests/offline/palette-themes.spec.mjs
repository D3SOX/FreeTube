import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'
import { CATPPUCCIN_MACCHIATO_COLORS, PALETTE_BASE_THEMES } from '../../../src/constants.js'
import { sampleColors } from '../../helpers/colors.mjs'

test.use({ seed: { settings: { currentLocale: 'en-US', quickSettings: ['baseTheme'] } } })

const names = [
  'Tokyo Night Night', 'Tokyo Night Storm', 'Tokyo Night Moon', 'Tokyo Night Day',
  'Rosé Pine', 'Rosé Pine Moon', 'Rosé Pine Dawn',
  'Kanagawa Wave', 'Kanagawa Dragon', 'Kanagawa Lotus',
  'Ayu Dark', 'Ayu Mirage', 'Ayu Light', 'One Dark', 'Carbonfox', 'Catppuccin Macchiato',
]

async function expectCatppuccinOrder(page) {
  await expect(page.getByRole('option').filter({ hasText: /^Catppuccin / })).toHaveText([
    'Catppuccin Frappe', 'Catppuccin Latte', 'Catppuccin Macchiato', 'Catppuccin Mocha',
  ])
}

function contrast(first, second) {
  const luminance = rgb => rgb.map(value => value / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
  const [low, high] = [luminance(first), luminance(second)].sort((a, b) => a - b)
  return (high + 0.05) / (low + 0.05)
}

async function expectElementContrast(element, minimum = 4.5, pseudo = null, referenceBackground = null) {
  await expect.poll(async () => element.evaluate((node, { pseudo, referenceBackground }) => {
    const rgb = color => color.match(/[\d.]+/g).map(Number)
      .map((value, index) => color.startsWith('color(srgb ') && index < 3 ? value * 255 : value)
    const over = (fg, bg) => fg.slice(0, 3).map((channel, index) =>
      channel * (fg[3] ?? 1) + bg[index] * (1 - (fg[3] ?? 1)))
    const ancestors = []
    for (let parent = node; parent; parent = parent.parentElement) ancestors.unshift(parent)
    const background = referenceBackground
      ? over(rgb(getComputedStyle(node).backgroundColor), referenceBackground)
      : ancestors.reduce((color, parent) =>
          over(rgb(getComputedStyle(parent).backgroundColor), color), [255, 255, 255])
    return { foreground: over(rgb(getComputedStyle(node, pseudo).color), background), background }
  }, { pseudo, referenceBackground }).then(({ foreground, background }) => contrast(foreground, background)), {
    message: `Rendered contrast of ${element}${pseudo ?? ''}`,
  }).toBeGreaterThanOrEqual(minimum)
}

async function expectPaletteContrast(page) {
  const colors = await page.evaluate(() => {
    const properties = [
      'primary-text-color', 'secondary-text-color', 'tertiary-text-color', 'title-color',
      'bg-color', 'card-bg-color', 'secondary-card-bg-color', 'search-bar-color',
      'side-nav-color', 'side-nav-hover-color', 'side-nav-active-color',
      'primary-color', 'primary-color-hover', 'primary-color-active', 'text-with-main-color',
      'accent-color', 'accent-color-hover', 'accent-color-active', 'accent-color-light', 'text-with-accent-color',
      'link-color', 'link-visited-color', 'red-500', 'favorite-icon-color',
      'destructive-color', 'destructive-hover-color', 'destructive-active-color', 'destructive-text-color',
      'selection-background-color', 'selection-text-color',
      'dropdown-item-hover-color', 'dropdown-item-hover-text-color',
      'header-button-hover-color', 'header-button-hover-text-color',
      'header-button-pressed-color', 'header-button-pressed-text-color',
      'colored-header-button-hover-color', 'colored-header-button-hover-text-color',
      'colored-header-button-pressed-color', 'colored-header-button-pressed-text-color',
      'scrollbar-color', 'scrollbar-color-hover', 'scrollbar-color-active',
      'input-border-color', 'slider-track-color',
      'toggle-track-color', 'toggle-thumb-color', 'toggle-checked-track-color', 'toggle-checked-thumb-color',
    ]
    const reset = document.createElement('div')
    for (const property of properties) reset.style.setProperty(`--${property}`, 'initial')
    const probe = document.createElement('span')
    probe.className = document.body.className
    reset.append(probe)
    document.body.append(reset)
    const result = Object.fromEntries(properties.map(property => {
      if (getComputedStyle(probe).getPropertyValue(`--${property}`).trim() === '') {
        throw new Error(`Active palette does not define --${property}`)
      }
      probe.style.color = `var(--${property})`
      const color = getComputedStyle(probe).color
      const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number)
        .map(value => color.startsWith('color(srgb ') ? value * 255 : value)
      return [property, channels]
    }))
    reset.remove()
    return result
  })
  const check = (foreground, background, minimum = 4.5) => {
    expect.soft(contrast(colors[foreground], colors[background]), `${foreground} on ${background}`)
      .toBeGreaterThanOrEqual(minimum)
  }
  for (const background of [
    'bg-color', 'card-bg-color', 'secondary-card-bg-color', 'search-bar-color',
    'side-nav-color', 'side-nav-hover-color', 'side-nav-active-color',
  ]) {
    for (const foreground of [
      'primary-text-color', 'secondary-text-color', 'tertiary-text-color', 'title-color',
      'link-color', 'link-visited-color', 'red-500',
    ]) check(foreground, background)
    for (const control of [
      'primary-color', 'accent-color', 'favorite-icon-color',
      'scrollbar-color', 'scrollbar-color-hover', 'scrollbar-color-active',
      'input-border-color', 'slider-track-color', 'toggle-track-color', 'toggle-checked-track-color',
    ]) check(control, background, 3)
  }
  for (const [foreground, backgrounds] of [
    ['text-with-main-color', ['primary-color', 'primary-color-hover', 'primary-color-active']],
    ['text-with-accent-color', ['accent-color', 'accent-color-hover', 'accent-color-active', 'accent-color-light']],
    ['destructive-text-color', ['destructive-color', 'destructive-hover-color', 'destructive-active-color']],
    ['selection-text-color', ['selection-background-color']],
    ['dropdown-item-hover-text-color', ['dropdown-item-hover-color']],
    ['header-button-hover-text-color', ['header-button-hover-color']],
    ['header-button-pressed-text-color', ['header-button-pressed-color']],
    ['colored-header-button-hover-text-color', ['colored-header-button-hover-color']],
    ['colored-header-button-pressed-text-color', ['colored-header-button-pressed-color']],
  ]) {
    for (const background of backgrounds) check(foreground, background)
  }
  check('toggle-thumb-color', 'toggle-track-color', 3)
  check('toggle-checked-thumb-color', 'toggle-checked-track-color', 3)
}

for (const [index, theme] of [...PALETTE_BASE_THEMES, 'catppuccinMacchiato'].entries()) {
  for (const scale of [100, 125]) {
    test.describe(`${names[index]} at ${scale}%`, () => {
      test.use({
        seed: {
          settings: {
            baseTheme: theme,
            currentLocale: 'en-US',
            uiScale: scale,
            // These normally activate destructive-color overrides. Fixed palettes
            // must remain readable regardless of the user's previous accent choices.
            mainColor: theme === 'catppuccinMacchiato' ? 'CatppuccinMacchiatoMauve' : 'Red',
            secColor: theme === 'catppuccinMacchiato' ? 'CatppuccinMacchiatoTeal' : 'Purple',
            quickSettings: ['baseTheme'],
          }
        }
      })

      test('keeps text, controls and both headers readable', async ({ page, app }, testInfo) => {
        await goToSettingsSection(page, 'theme')
        await expect(page.getByRole('combobox', { name: /^Base theme/i })).toHaveText(names[index])
        await expect(page.getByRole('combobox', { name: /Main colou?r theme/i })).toBeEnabled({ enabled: theme === 'catppuccinMacchiato' })
        await expect(page.getByRole('combobox', { name: /Secondary colou?r theme/i })).toBeEnabled({ enabled: theme === 'catppuccinMacchiato' })
        await expectPaletteContrast(page)

        const button = page.getByRole('button', { name: 'Test toast', exact: true })
        await expectElementContrast(button)
        await button.hover()
        await expectElementContrast(button)
        await button.focus()
        await expectElementContrast(button)
        await page.keyboard.press('Shift+Tab')
        await page.keyboard.press('Tab')
        await expect(button).toBeFocused()
        // Settings handles Tab locally. Enable the app's keyboard outlines so
        // this checks the painted outline, not the color of a hidden outline.
        await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('showOutlines'))
        await expect(button).toHaveCSS('outline-style', 'solid')
        const focus = await button.evaluate(element => {
          const style = getComputedStyle(element)
          const rgb = color => color.match(/[\d.]+/g).slice(0, 3).map(Number)
            .map(value => color.startsWith('color(srgb ') ? value * 255 : value)
          return { outline: rgb(style.outlineColor), background: rgb(style.backgroundColor) }
        })
        expect.soft(contrast(focus.outline, focus.background), 'Button focus outline against its fill')
          .toBeGreaterThanOrEqual(3)
        await page.mouse.down()
        await expectElementContrast(button)
        await page.mouse.move(0, 0)
        await page.mouse.up()

        const select = page.getByRole('combobox', { name: /^Base theme/i })
        await select.click()
        const option = page.getByRole('option', { name: names[index], exact: true })
        await option.hover()
        await expectElementContrast(option)
        await page.keyboard.press('Escape')

        const toggle = page.getByRole('checkbox', { name: /Match top bar with main color/i })
        const label = toggle.locator('..').locator('.switch-label')
        await label.scrollIntoViewIfNeeded()
        for (const checked of [false, true]) {
          if (await toggle.isChecked() !== checked) await label.click()
          await expect(toggle).toBeChecked({ checked })
          await expect.poll(async () => {
            const height = await label.evaluate(element => element.getBoundingClientRect().height)
            const x = checked ? 12 : 34
            const [track, surface, thumb, thumbEdge] = await sampleColors(app, label, [
              [x, height / 2], [x, height / 2 - 15], [checked ? 30 : 15, height / 2],
              [checked ? 31 : 15, height / 2 - 9],
            ])
            return Math.min(contrast(track, surface), contrast(thumb, track), contrast(thumbEdge, surface))
          }, { message: 'Painted toggle track, thumb and surrounding surface' }).toBeGreaterThanOrEqual(3)
          if (scale === 100) {
            await testInfo.attach(`${theme}-toggle-${checked ? 'on' : 'off'}`, {
              body: await label.screenshot({ animations: 'disabled' }), contentType: 'image/png',
            })
          }
        }
        await page.locator('.settingsCloseButton').click()
        for (const colored of [false, true]) {
          await page.evaluate(async colored => {
            const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
            await store.dispatch('updateBarColor', colored)
          }, colored)
          await expectElementContrast(page.locator('.topNav .menuButton'), 3)
          const search = page.locator('.topNav .ft-input')
          await expectElementContrast(search, 4.5, '::placeholder')
          const filter = page.locator('.topNav .navFilterButton')
          // The absolutely positioned filter sits over its sibling input,
          // whose fill is absent from the button's ancestor backgrounds.
          const inputBackground = await search.evaluate(element => {
            const color = getComputedStyle(element).backgroundColor
            return color.match(/[\d.]+/g).slice(0, 3).map(Number)
              .map(value => color.startsWith('color(srgb ') ? value * 255 : value)
          })
          await expectElementContrast(filter, 3, null, inputBackground)
          await filter.hover()
          await expectElementContrast(filter, 3, null, inputBackground)
          await page.mouse.move(0, 0)
          await search.fill('Contrast check')
          await expectElementContrast(search)
          const action = page.locator('.topNav .inputAction.enabled')
          await expectElementContrast(action, 3, null, inputBackground)
          await action.hover()
          await expectElementContrast(action, 3, null, inputBackground)
          await page.mouse.down()
          await expectElementContrast(action, 3, null, inputBackground)
          await page.mouse.move(0, 0)
          await page.mouse.up()
          await expectElementContrast(action, 3, null, inputBackground)
          await search.fill('')
          if (scale === 100) {
            await testInfo.attach(`${theme}-${colored ? 'colored' : 'neutral'}-header`, {
              body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png',
            })
          }
        }
      })
    })
  }
}

test('offers the new palettes in quick settings, system choices and the custom editor', async ({ page }) => {
  await goToSettingsSection(page, 'theme')
  await page.getByRole('combobox', { name: /^Base theme/i }).click()
  await expectCatppuccinOrder(page)
  await page.getByRole('option', { name: /System default/i }).click()
  for (const [label, name] of [['Light theme', 'Rosé Pine Dawn'], ['Dark theme', 'Catppuccin Macchiato']]) {
    const select = page.getByRole('combobox', { name: label, exact: true })
    await select.click()
    await page.locator(`#${await select.getAttribute('aria-controls')}`).getByRole('option', { name, exact: true }).click()
  }
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('body')).toHaveClass(/rosePineDawn/)
  await expect(page.getByRole('combobox', { name: /Main colou?r theme/i })).toBeDisabled()
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('body')).toHaveClass(/catppuccinMacchiato/)
  await expect(page.getByRole('combobox', { name: /Main colou?r theme/i })).toBeEnabled()
  await expect(page.getByRole('combobox', { name: /Secondary colou?r theme/i })).toBeEnabled()
  await page.getByRole('button', { name: 'Create custom theme' }).click()
  const editor = page.locator('.customThemeEditor')
  await editor.getByRole('combobox', { name: 'Based on' }).click()
  await expectCatppuccinOrder(page)
  for (const name of names) await expect(page.getByRole('option', { name, exact: true })).toHaveCount(1)
  await page.getByRole('option', { name: 'Ayu Light', exact: true }).click()
  await expect(editor.getByRole('combobox', { name: 'Based on' })).toHaveText('Ayu Light')
  await page.locator('.settingsBackButton').click()
  await page.locator('.settingsCloseButton').click()
  await page.locator('.profileTrigger').click()
  const quick = page.getByRole('dialog', { name: 'Quick settings' })
  await quick.getByRole('combobox', { name: /^Base theme/i }).click()
  await expectCatppuccinOrder(page)
  for (const name of names) await expect(page.getByRole('option', { name, exact: true })).toHaveCount(1)
  await page.getByRole('option', { name: 'Kanagawa Wave', exact: true }).click()
  await expect(page.locator('body')).toHaveClass(/kanagawaWave/)
})

test.describe('palette onboarding', () => {
  test.use({ showTutorial: true })

  test('offers all new palettes during onboarding', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('opentubex.tutorial.audience', 'new'))
    await page.reload()
    const tutorial = page.locator('.tutorialCard')
    for (let step = 0; step < 4; step++) await tutorial.getByRole('button', { name: 'Next' }).click()
    await expect(tutorial).toHaveAccessibleName('Make it yours')
    const select = tutorial.getByRole('combobox', { name: 'Base Theme' })
    await select.click()
    await expectCatppuccinOrder(page)
    const options = page.locator(`#${await select.getAttribute('aria-controls')}`)
    for (const name of names) await expect(options.getByRole('option', { name, exact: true })).toHaveCount(1)
    await options.getByRole('option', { name: 'Carbonfox', exact: true }).click()
    await expect(page.locator('body')).toHaveClass(/carbonfox/)
  })
})

test.describe('Macchiato color choices', () => {
  test.use({ seed: { settings: { baseTheme: 'catppuccinMacchiato', currentLocale: 'en-US' } } })

  test('applies and retains all 14 Macchiato main and secondary colors', async ({ page }) => {
    await goToSettingsSection(page, 'theme')
    const main = page.getByRole('combobox', { name: /Main colou?r theme/i })
    const secondary = page.getByRole('combobox', { name: /Secondary colou?r theme/i })
    const prefix = 'CatppuccinMacchiato'
    const palette = CATPPUCCIN_MACCHIATO_COLORS
      .filter(({ name }) => name.startsWith(prefix))
      .map(({ name, value }) => [name.slice(prefix.length), value])
    for (const [name, color] of palette) {
      for (const select of [main, secondary]) {
        await select.click()
        const options = page.locator(`#${await select.getAttribute('aria-controls')}`)
        await options.getByRole('option', { name: `Catppuccin Macchiato ${name}`, exact: true }).click()
        await expect(select).toHaveText(`Catppuccin Macchiato ${name}`)
      }
      const actual = await page.evaluate(() => {
        const probe = document.createElement('span')
        document.body.append(probe)
        const colors = ['--primary-color', '--accent-color'].map(property => {
          probe.style.color = `var(${property})`
          return getComputedStyle(probe).color.match(/\d+/g).slice(0, 3).map(Number)
        })
        probe.remove()
        return colors
      })
      const expected = color.slice(1).match(/../g).map(channel => parseInt(channel, 16))
      expect(actual).toEqual([expected, expected])
      await expectPaletteContrast(page)
    }
    await page.reload()
    await goToSettingsSection(page, 'theme')
    await expect(main).toHaveText('Catppuccin Macchiato Lavender')
    await expect(secondary).toHaveText('Catppuccin Macchiato Lavender')
  })
})
