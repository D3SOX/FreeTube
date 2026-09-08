import { DARK_BASE_THEMES, LIGHT_BASE_THEMES, PALETTE_BASE_THEMES } from './constants.js'
import { isCustomThemeValue } from './customTheme.js'

const BUILTIN_BASE_THEMES = new Set(['system', ...LIGHT_BASE_THEMES, ...DARK_BASE_THEMES])

function hasFixedThemeColors(theme) {
  return ['hotPink', 'openTubeXLight', 'openTubeXDark', ...PALETTE_BASE_THEMES].includes(theme) || isCustomThemeValue(theme)
}

function getThemeClassification(value, customThemes = []) {
  if (LIGHT_BASE_THEMES.includes(value)) return 'light'
  if (DARK_BASE_THEMES.includes(value)) return 'dark'

  const customTheme = customThemes.find(({ id }) => value === `custom:${id}`)
  if (customTheme) return customTheme.isDark ? 'dark' : 'light'

  return null
}

function resolveBaseTheme(value, fallback, customThemes = [], allowSystem = true) {
  if (!allowSystem && value === 'system') return fallback
  if (BUILTIN_BASE_THEMES.has(value) || customThemes.some(({ id }) => value === `custom:${id}`)) {
    return value
  }
  return fallback
}

function resolveSystemTheme(value, classification, customThemes = []) {
  return getThemeClassification(value, customThemes) === classification
    ? value
    : classification
}

function resolveSystemThemeSettings(settings, customThemes = []) {
  return {
    systemLightTheme: resolveSystemTheme(settings.systemLightTheme, 'light', customThemes),
    systemDarkTheme: resolveSystemTheme(settings.systemDarkTheme, 'dark', customThemes),
  }
}

export {
  hasFixedThemeColors,
  getThemeClassification,
  resolveBaseTheme,
  resolveSystemTheme,
  resolveSystemThemeSettings,
}
