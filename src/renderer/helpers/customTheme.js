import {
  CUSTOM_THEME_BLURS,
  CUSTOM_THEME_COLORS,
  customThemeBackdropBlur,
  hexColorToRgbComponents,
  isCustomThemeValue,
  normalizeCustomTheme,
  normalizeCustomThemes,
} from '../../customTheme'
import { PALETTE_BASE_THEMES } from '../../constants'

const STORAGE_KEY = 'opentubex-custom-theme'
let appliedBodyThemeClasses = []

export function applyThemeToDocument(baseTheme, mainColor, secColor, customTheme) {
  const themeClass = isCustomThemeValue(baseTheme) ? 'custom' : (baseTheme || 'system')
  const themeClasses = [themeClass]
  // Fixed palettes must not inherit selectable accent or destructive overrides.
  if (!PALETTE_BASE_THEMES.includes(themeClass)) {
    themeClasses.push(`main${mainColor || 'Red'}`, `sec${secColor || 'Blue'}`)
  }
  document.body.classList.remove(...appliedBodyThemeClasses)
  document.body.classList.add(...themeClasses)
  appliedBodyThemeClasses = themeClasses
  document.body.dataset.systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
  if (isCustomThemeValue(baseTheme) && customTheme) {
    document.body.dataset.customTheme = customTheme.isDark ? 'dark' : 'light'
  } else {
    delete document.body.dataset.customTheme
  }

  for (const [, property] of CUSTOM_THEME_COLORS) {
    document.body.style.removeProperty(property)
  }
  for (const [, property] of CUSTOM_THEME_BLURS) {
    document.body.style.removeProperty(property)
  }
  document.body.style.removeProperty('--accent-color-rgb')

  if (isCustomThemeValue(baseTheme) && customTheme) {
    for (const [key, property] of CUSTOM_THEME_COLORS) {
      document.body.style.setProperty(property, customTheme.colors[key])
    }
    for (const [key, property] of CUSTOM_THEME_BLURS) {
      document.body.style.setProperty(
        property,
        customThemeBackdropBlur(customTheme.colors[key], customTheme.blurs[key])
      )
    }
    document.body.style.setProperty(
      '--accent-color-rgb',
      hexColorToRgbComponents(customTheme.colors.accent)
    )
  }
}

export async function loadCustomThemes() {
  if (process.env.IS_ELECTRON) {
    return normalizeCustomThemes(await window.ftElectron.loadCustomTheme())
  }

  const savedTheme = localStorage.getItem(STORAGE_KEY)
  return savedTheme === null ? [] : normalizeCustomThemes(JSON.parse(savedTheme))
}

export async function saveCustomTheme(theme) {
  const normalizedTheme = normalizeCustomTheme(theme)
  if (process.env.IS_ELECTRON) {
    return normalizeCustomThemes(await window.ftElectron.saveCustomTheme(normalizedTheme))
  }

  const themes = await loadCustomThemes()
  const existingIndex = themes.findIndex(({ id }) => id === normalizedTheme.id)
  if (existingIndex === -1) themes.push(normalizedTheme)
  else themes[existingIndex] = normalizedTheme
  localStorage.setItem(STORAGE_KEY, JSON.stringify(themes, null, 2))
  return themes
}

export async function deleteCustomTheme(id) {
  if (process.env.IS_ELECTRON) {
    return normalizeCustomThemes(await window.ftElectron.deleteCustomTheme(id))
  }

  const themes = (await loadCustomThemes()).filter(theme => theme.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(themes, null, 2))
  return themes
}

export async function replaceCustomThemes(themes) {
  const normalizedThemes = normalizeCustomThemes(themes)
  if (process.env.IS_ELECTRON) {
    return normalizeCustomThemes(await window.ftElectron.replaceCustomThemes(normalizedThemes))
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizedThemes, null, 2))
  return normalizedThemes
}

export function handleCustomThemeUpdated(handler) {
  if (!process.env.IS_ELECTRON) return () => {}
  return window.ftElectron.handleCustomThemeUpdated(themes => handler(normalizeCustomThemes(themes)))
}
