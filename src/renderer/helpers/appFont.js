export const DEFAULT_APP_FONT = 'Geist Variable'
export const SYSTEM_APP_FONT = 'system'

const APP_FONT_FALLBACKS = "system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'"

function hasControlCharacters(value) {
  return Array.from(value).some((character) => {
    const characterCode = character.charCodeAt(0)
    return characterCode <= 31 || characterCode === 127
  })
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeAppFont(value) {
  if (typeof value !== 'string') return DEFAULT_APP_FONT

  const font = value.trim()
  return font === SYSTEM_APP_FONT || (
    font !== '' &&
    font.length <= 200 &&
    !hasControlCharacters(font)
  )
    ? font
    : DEFAULT_APP_FONT
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function getAppFontFamily(value) {
  const font = normalizeAppFont(value)
  if (font === SYSTEM_APP_FONT) return APP_FONT_FALLBACKS

  const quotedFont = font
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')

  return `"${quotedFont}", ${APP_FONT_FALLBACKS}`
}
