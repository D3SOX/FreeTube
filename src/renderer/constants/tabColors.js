export const TAB_COLOR_ACCENTS = Object.freeze({
  red: '#d84f4f',
  orange: '#d9822b',
  yellow: '#c7a72e',
  green: '#3e9b62',
  blue: '#3f7fd6',
  purple: '#8b64d8',
  pink: '#d65b96'
})

/**
 * @param {string | null | undefined} color
 * @returns {string | null}
 */
export function getTabAccentColor(color) {
  return TAB_COLOR_ACCENTS[color] ?? null
}
