export const CUSTOM_THEMES_DIRECTORY = 'themes'
export const CUSTOM_THEMES_SYNC_KEY = 'customThemes'
export const CUSTOM_THEME_VALUE_PREFIX = 'custom:'

export const CUSTOM_THEME_COLORS = Object.freeze([
  ['primaryText', '--primary-text-color', 'Main text'],
  ['secondaryText', '--secondary-text-color', 'Secondary text'],
  ['tertiaryText', '--tertiary-text-color', 'Subtle text'],
  ['border', '--border-color', 'Borders and dividers'],
  ['subtleSurface', '--subtle-surface-color', 'Subtle surfaces and indicators'],
  ['title', '--title-color', 'Title text'],
  ['selectionBackground', '--selection-background-color', 'Selected text background'],
  ['selectionText', '--selection-text-color', 'Selected text'],
  ['logoPrimary', '--logo-primary-color', 'Logo icon'],
  ['logoSecondary', '--logo-secondary-color', 'Logo text'],
  ['logoTertiary', '--logo-tertiary-color', 'Logo hover'],
  ['logoPressed', '--logo-pressed-color', 'Logo pressed'],
  ['background', '--bg-color', 'Page background'],
  ['cardBackground', '--card-bg-color', 'Card background'],
  ['secondaryCardBackground', '--secondary-card-bg-color', 'Secondary card background'],
  ['favoriteIcon', '--favorite-icon-color', 'Favorite icon'],
  ['error', '--red-500', 'Error color'],
  ['scrollbar', '--scrollbar-color', 'Scrollbar thumb'],
  ['scrollbarHover', '--scrollbar-color-hover', 'Scrollbar thumb hover'],
  ['scrollbarActive', '--scrollbar-color-active', 'Scrollbar thumb pressed'],
  ['scrollbarTextHover', '--scrollbar-text-color-hover', 'Dropdown item hover text'],
  ['dropdownHover', '--dropdown-item-hover-color', 'Dropdown item hover background'],
  ['dropdownHoverText', '--dropdown-item-hover-text-color', 'Dropdown item hover text'],
  ['sideNav', '--side-nav-color', 'Navigation and panel background'],
  ['sideNavHover', '--side-nav-hover-color', 'Neutral item hover and focus background'],
  ['sideNavHoverText', '--side-nav-hover-text-color', 'Neutral item hover and focus text and icons'],
  ['sideNavActive', '--side-nav-active-color', 'Neutral item pressed background'],
  ['sideNavActiveText', '--side-nav-active-text-color', 'Neutral item pressed text and icons'],
  ['headerHover', '--header-button-hover-color', 'Header button hover and focus background'],
  ['headerHoverText', '--header-button-hover-text-color', 'Header button hover and focus text and icons'],
  ['headerPressed', '--header-button-pressed-color', 'Header button pressed background'],
  ['headerPressedText', '--header-button-pressed-text-color', 'Header button pressed text and icons'],
  ['coloredHeaderHover', '--colored-header-button-hover-color', 'Colored header button hover and focus background'],
  ['coloredHeaderHoverText', '--colored-header-button-hover-text-color', 'Colored header button hover and focus text and icons'],
  ['coloredHeaderPressed', '--colored-header-button-pressed-color', 'Colored header button pressed background'],
  ['coloredHeaderPressedText', '--colored-header-button-pressed-text-color', 'Colored header button pressed text and icons'],
  ['searchBar', '--search-bar-color', 'Search and dropdown background'],
  ['settingsSearchBar', '--settings-search-bar-color', 'Settings search background'],
  ['instanceMenu', '--instance-menu-color', 'Instance menu'],
  ['primaryInput', '--primary-input-color', 'Input background'],
  ['primaryShadow', '--primary-shadow-color', 'Shadow color'],
  ['primary', '--primary-color', 'Primary controls and highlights'],
  ['primaryHover', '--primary-color-hover', 'Primary control hover and focus'],
  ['primaryActive', '--primary-color-active', 'Primary control pressed'],
  ['textWithPrimary', '--text-with-main-color', 'Text and icons on primary controls'],
  ['accent', '--accent-color', 'Secondary controls and highlights'],
  ['accentHover', '--accent-color-hover', 'Secondary control hover and focus'],
  ['accentActive', '--accent-color-active', 'Secondary control pressed'],
  ['accentLight', '--accent-color-light', 'Light secondary color'],
  ['accentVisited', '--accent-color-visited', 'Visited accent'],
  ['textWithAccent', '--text-with-accent-color', 'Text and icons on secondary controls'],
  ['link', '--link-color', 'Links'],
  ['linkVisited', '--link-visited-color', 'Visited links'],
  ['destructive', '--destructive-color', 'Destructive action'],
  ['destructiveHover', '--destructive-hover-color', 'Destructive hover and focus'],
  ['destructiveActive', '--destructive-active-color', 'Destructive pressed'],
  ['destructiveText', '--destructive-text-color', 'Text and icons on destructive actions'],
])

const LEGACY_UNUSED_CUSTOM_THEME_COLOR_KEYS = new Set([
  'instanceMenu', 'accentVisited', 'scrollbarTextHover'
])
export const CUSTOM_THEME_EDITABLE_COLORS = Object.freeze(
  CUSTOM_THEME_COLORS.filter(([key]) => !LEGACY_UNUSED_CUSTOM_THEME_COLOR_KEYS.has(key))
)

export const CUSTOM_THEME_BLURS = Object.freeze([
  ['cardBackground', '--card-bg-blur'],
  ['secondaryCardBackground', '--secondary-card-bg-blur'],
  ['searchBar', '--search-bar-blur'],
  ['settingsSearchBar', '--settings-search-bar-blur'],
  ['primaryInput', '--primary-input-blur'],
])

const DEFAULT_CUSTOM_THEME_BLURS = Object.freeze(
  Object.fromEntries(CUSTOM_THEME_BLURS.map(([key]) => [key, 0]))
)

export const DEFAULT_CUSTOM_THEME = Object.freeze({
  version: 2,
  id: '',
  name: 'Custom Theme',
  basedOn: 'dark',
  mainColor: 'Red',
  secondaryColor: 'Blue',
  isDark: true,
  blurs: DEFAULT_CUSTOM_THEME_BLURS,
  colors: Object.freeze({
    primaryText: '#eeeeee',
    secondaryText: '#dddddd',
    tertiaryText: '#999999',
    border: '#999999',
    subtleSurface: '#999999',
    title: '#eeeeee',
    selectionBackground: '#f44336',
    selectionText: '#ffffff',
    logoPrimary: '#eeeeee',
    logoSecondary: '#eeeeee',
    logoTertiary: '#eeeeee',
    logoPressed: '#eeeeee',
    background: '#121212',
    cardBackground: '#242424',
    secondaryCardBackground: '#181818',
    favoriteIcon: '#6eaa73',
    error: '#f44336',
    scrollbar: '#515151',
    scrollbarHover: '#757575',
    scrollbarActive: '#919191',
    scrollbarTextHover: '#eeeeee',
    dropdownHover: '#757575',
    dropdownHoverText: '#eeeeee',
    sideNav: '#181818',
    sideNavHover: '#242424',
    sideNavHoverText: '#eeeeee',
    sideNavActive: '#303030',
    sideNavActiveText: '#eeeeee',
    headerHover: '#242424',
    headerHoverText: '#eeeeee',
    headerPressed: '#999999',
    headerPressedText: '#eeeeee',
    coloredHeaderHover: '#e53935',
    coloredHeaderHoverText: '#ffffff',
    coloredHeaderPressed: '#c62828',
    coloredHeaderPressedText: '#ffffff',
    searchBar: '#262626',
    settingsSearchBar: '#242424',
    instanceMenu: '#262626',
    primaryInput: '#7f7f7f',
    primaryShadow: '#000000',
    primary: '#f44336',
    primaryHover: '#e53935',
    primaryActive: '#c62828',
    textWithPrimary: '#ffffff',
    accent: '#2196f3',
    accentHover: '#1e88e5',
    accentActive: '#1565c0',
    accentLight: '#90caf9',
    accentVisited: '#7e57c2',
    textWithAccent: '#ffffff',
    link: '#2196f3',
    linkVisited: '#7e57c2',
    destructive: '#f44336',
    destructiveHover: '#e53935',
    destructiveActive: '#c62828',
    destructiveText: '#000000',
  })
})

const HEX_COLOR_PATTERN = /^#[\da-f]{6}(?:[\da-f]{2})?$/i

const LEGACY_CUSTOM_THEME_COLOR_FALLBACKS = Object.freeze({
  logoPressed: 'logoTertiary',
  border: 'tertiaryText',
  subtleSurface: 'tertiaryText',
  selectionBackground: 'primary',
  selectionText: 'textWithPrimary',
  dropdownHover: 'scrollbarHover',
  dropdownHoverText: 'scrollbarTextHover',
  headerHover: 'sideNavHover',
  headerHoverText: 'sideNavHoverText',
  headerPressed: 'tertiaryText',
  headerPressedText: 'sideNavActiveText',
  coloredHeaderHover: 'primaryHover',
  coloredHeaderHoverText: 'textWithPrimary',
  coloredHeaderPressed: 'primaryActive',
  coloredHeaderPressedText: 'textWithPrimary',
})

export function normalizeCustomTheme(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Custom theme must be a JSON object')
  }

  const colors = {}
  for (const [key] of CUSTOM_THEME_COLORS) {
    const color = value.colors?.[key] ??
      (key === 'scrollbarActive' ? deriveScrollbarActiveColor(value.colors?.scrollbarHover) : undefined) ??
      value.colors?.[LEGACY_CUSTOM_THEME_COLOR_FALLBACKS[key]]
    if (typeof color !== 'string' || !HEX_COLOR_PATTERN.test(color)) {
      throw new TypeError(`Invalid or missing custom theme color: ${key}`)
    }
    colors[key] = color.toLowerCase()
  }

  const blurs = Object.fromEntries(CUSTOM_THEME_BLURS.map(([key]) => {
    const blur = value.blurs?.[key]
    return [key, typeof blur === 'number' && Number.isFinite(blur)
      ? Math.round(Math.min(40, Math.max(0, blur)))
      : 0]
  }))

  return {
    version: 2,
    ...(/^discussion-[1-9]\d*$/.test(value.id) &&
      typeof value.discussionThemeHash === 'string' &&
      /^[\da-f]{64}$/.test(value.discussionThemeHash)
      ? { discussionThemeHash: value.discussionThemeHash }
      : {}),
    id: typeof value.id === 'string' && /^[\w-]{1,80}$/.test(value.id)
      ? value.id
      : 'custom-theme',
    name: typeof value.name === 'string' && value.name.trim() !== ''
      ? value.name.trim().slice(0, 80)
      : DEFAULT_CUSTOM_THEME.name,
    basedOn: typeof value.basedOn === 'string' && value.basedOn !== '' && !isCustomThemeValue(value.basedOn)
      ? value.basedOn
      : DEFAULT_CUSTOM_THEME.basedOn,
    mainColor: typeof value.mainColor === 'string' && value.mainColor !== ''
      ? value.mainColor
      : DEFAULT_CUSTOM_THEME.mainColor,
    secondaryColor: typeof value.secondaryColor === 'string' && value.secondaryColor !== ''
      ? value.secondaryColor
      : DEFAULT_CUSTOM_THEME.secondaryColor,
    isDark: value.isDark !== false,
    blurs,
    colors
  }
}

/** Hash the theme's normalized content, excluding local identity and source tracking. */
export async function customThemeContentHash(value) {
  const theme = normalizeCustomTheme(value)
  delete theme.id
  delete theme.discussionThemeHash
  const content = new TextEncoder().encode(JSON.stringify(theme))
  const hash = await globalThis.crypto.subtle.digest('SHA-256', content)
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}

function deriveScrollbarActiveColor(hoverColor) {
  if (typeof hoverColor !== 'string' || !HEX_COLOR_PATTERN.test(hoverColor)) return undefined

  const components = hoverColor.match(/[\da-f]{2}/gi).map(component => Number.parseInt(component, 16))
  const hoverAlpha = (components[3] ?? 255) / 255
  const mixedAlpha = hoverAlpha * 0.8 + 0.2
  const rgb = components.slice(0, 3).map(component =>
    Math.round((component * hoverAlpha * 0.8 + 255 * 0.2) / mixedAlpha))
  const alpha = Math.round(mixedAlpha * 255)
  return formatHexColor(rgb, alpha)
}

function formatHexColor(rgb, alpha) {
  const color = rgb.map(component => component.toString(16).padStart(2, '0')).join('')
  const transparency = alpha < 255 ? alpha.toString(16).padStart(2, '0') : ''
  return `#${color}${transparency}`
}

export function normalizeCustomThemes(value) {
  if (!Array.isArray(value)) throw new TypeError('Custom themes must be a JSON array')
  return value.map(normalizeCustomTheme)
}

export function hexColorToRgbComponents(color) {
  const components = color.match(/[\da-f]{2}/gi)
  return components.slice(0, 3).map(value => Number.parseInt(value, 16)).join(' ')
}

export function customThemeBackdropBlur(color, strength) {
  const alpha = color.length === 9 ? Number.parseInt(color.slice(7, 9), 16) : 255
  return alpha < 255 && strength > 0 ? `blur(${strength}px)` : 'none'
}

export function customThemeValue(id) {
  return `${CUSTOM_THEME_VALUE_PREFIX}${id}`
}

export function isCustomThemeValue(value) {
  return value === 'custom' || (typeof value === 'string' && value.startsWith(CUSTOM_THEME_VALUE_PREFIX))
}

export function customThemeIdFromValue(value) {
  return typeof value === 'string' && value.startsWith(CUSTOM_THEME_VALUE_PREFIX)
    ? value.slice(CUSTOM_THEME_VALUE_PREFIX.length)
    : null
}

export function cloneDefaultCustomTheme() {
  return {
    ...DEFAULT_CUSTOM_THEME,
    blurs: { ...DEFAULT_CUSTOM_THEME.blurs },
    colors: { ...DEFAULT_CUSTOM_THEME.colors }
  }
}
