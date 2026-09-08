import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  getThemeClassification,
  hasFixedThemeColors,
  resolveBaseTheme,
  resolveSystemTheme,
} from '../../src/appearanceSettings.js'
import { PALETTE_BASE_THEMES } from '../../src/constants.js'

test('all 16 palette themes survive setting repair and work as system theme choices', () => {
  const light = ['tokyoNightDay', 'rosePineDawn', 'kanagawaLotus', 'ayuLight']
  const themes = [...PALETTE_BASE_THEMES, 'catppuccinMacchiato']
  assert.equal(new Set(themes).size, 16)
  for (const theme of themes) {
    const classification = light.includes(theme) ? 'light' : 'dark'
    assert.equal(resolveBaseTheme(theme, 'system'), theme)
    assert.equal(getThemeClassification(theme), classification)
    assert.equal(resolveSystemTheme(theme, classification), theme)
    assert.equal(hasFixedThemeColors(theme), theme !== 'catppuccinMacchiato')
  }
})

test('invalid appearance choices fall back to their defaults', () => {
  assert.equal(resolveBaseTheme('missing', 'system'), 'system')
  assert.equal(resolveBaseTheme('system', 'light', [], false), 'light')
  assert.equal(resolveBaseTheme('missing', 'dark', [], false), 'dark')
})

test('built-in and available custom appearance choices are retained', () => {
  assert.equal(resolveBaseTheme('solarizedDark', 'system'), 'solarizedDark')
  assert.equal(resolveBaseTheme('custom:paper', 'system', [{ id: 'paper' }]), 'custom:paper')
})

test('themes are classified by their built-in or custom color scheme', () => {
  const customThemes = [
    { id: 'midnight', isDark: true },
    { id: 'paper', isDark: false },
  ]

  assert.equal(getThemeClassification('solarizedLight'), 'light')
  assert.equal(getThemeClassification('solarizedDark'), 'dark')
  assert.equal(getThemeClassification('custom:paper', customThemes), 'light')
  assert.equal(getThemeClassification('custom:midnight', customThemes), 'dark')
  assert.equal(getThemeClassification('missing', customThemes), null)
})

test('system theme choices must match their color scheme', () => {
  const customThemes = [
    { id: 'midnight', isDark: true },
    { id: 'paper', isDark: false },
  ]

  assert.equal(resolveSystemTheme('solarizedLight', 'light'), 'solarizedLight')
  assert.equal(resolveSystemTheme('solarizedDark', 'light'), 'light')
  assert.equal(resolveSystemTheme('custom:paper', 'light', customThemes), 'custom:paper')
  assert.equal(resolveSystemTheme('custom:midnight', 'light', customThemes), 'light')
  assert.equal(resolveSystemTheme('custom:midnight', 'dark', customThemes), 'custom:midnight')
  assert.equal(resolveSystemTheme('custom:paper', 'dark', customThemes), 'dark')
})
