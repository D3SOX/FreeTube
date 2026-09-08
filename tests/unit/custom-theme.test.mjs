import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  customThemeBackdropBlur,
  customThemeContentHash,
  DEFAULT_CUSTOM_THEME,
  normalizeCustomTheme,
} from '../../src/customTheme.js'

function legacyTheme() {
  const theme = JSON.parse(JSON.stringify(DEFAULT_CUSTOM_THEME))
  delete theme.version
  delete theme.blurs
  for (const key of [
    'border',
    'subtleSurface',
    'selectionBackground',
    'selectionText',
    'logoPressed',
    'scrollbarActive',
    'dropdownHover',
    'dropdownHoverText',
    'headerHover',
    'headerHoverText',
    'headerPressed',
    'headerPressedText',
    'coloredHeaderHover',
    'coloredHeaderHoverText',
    'coloredHeaderPressed',
    'coloredHeaderPressedText',
  ]) delete theme.colors[key]
  return theme
}

test('migrates legacy custom themes without changing their existing appearance', () => {
  const theme = legacyTheme()
  theme.colors.scrollbarHover = '#75757580'
  const migrated = normalizeCustomTheme(theme)

  assert.equal(migrated.version, 2)
  assert.equal(migrated.colors.border, theme.colors.tertiaryText)
  assert.equal(migrated.colors.selectionBackground, theme.colors.primary)
  assert.equal(migrated.colors.selectionText, theme.colors.textWithPrimary)
  assert.equal(migrated.colors.logoPressed, theme.colors.logoTertiary)
  assert.equal(migrated.colors.headerHover, theme.colors.sideNavHover)
  assert.equal(migrated.colors.headerPressed, theme.colors.tertiaryText)
  assert.equal(migrated.colors.coloredHeaderPressed, theme.colors.primaryActive)
  assert.equal(migrated.colors.scrollbarActive, '#a3a3a399')
  assert.deepEqual(migrated.blurs, {
    cardBackground: 0,
    secondaryCardBackground: 0,
    searchBar: 0,
    settingsSearchBar: 0,
    primaryInput: 0,
  })
})

test('normalizes transparent colors and bounded backdrop blur strengths', () => {
  const theme = JSON.parse(JSON.stringify(DEFAULT_CUSTOM_THEME))
  theme.colors.cardBackground = '#12345680'
  theme.blurs.cardBackground = 100
  theme.blurs.searchBar = -4

  const normalized = normalizeCustomTheme(theme)
  assert.equal(normalized.colors.cardBackground, '#12345680')
  assert.equal(normalized.blurs.cardBackground, 40)
  assert.equal(normalized.blurs.searchBar, 0)
  assert.equal(customThemeBackdropBlur(normalized.colors.cardBackground, 12), 'blur(12px)')
  assert.equal(customThemeBackdropBlur('#123456', 12), 'none')
  assert.equal(customThemeBackdropBlur('#12345680', 0), 'none')
})

test('preserves source fingerprints through save and sync, but drops them from copies', () => {
  const theme = {
    ...DEFAULT_CUSTOM_THEME,
    id: 'discussion-1197',
    discussionThemeHash: 'a'.repeat(64),
  }
  const normalized = normalizeCustomTheme(theme)
  assert.equal(normalized.discussionThemeHash, 'a'.repeat(64))
  assert.deepEqual(normalizeCustomTheme(JSON.parse(JSON.stringify(normalized))), normalized)
  assert.equal(normalizeCustomTheme({ ...theme, id: 'my-copy' }).discussionThemeHash, undefined)
  assert.equal(normalizeCustomTheme({ ...theme, discussionThemeHash: 'invalid' }).discussionThemeHash, undefined)
})


test('theme fingerprints ignore formatting, key order, local IDs and source fingerprints', async () => {
  const theme = normalizeCustomTheme(DEFAULT_CUSTOM_THEME)
  const expected = await customThemeContentHash(theme)
  assert.match(expected, /^[\da-f]{64}$/)
  const reordered = Object.fromEntries(Object.entries(theme).reverse())
  reordered.colors = Object.fromEntries(Object.entries(theme.colors).reverse())
  reordered.blurs = Object.fromEntries(Object.entries(theme.blurs).reverse())
  assert.equal(await customThemeContentHash(JSON.parse(JSON.stringify(reordered, null, 4))), expected)
  assert.equal(await customThemeContentHash({ ...theme, id: 'discussion-1197', discussionThemeHash: 'b'.repeat(64) }), expected)
  assert.equal(await customThemeContentHash({ ...theme, colors: { ...theme.colors, background: '#ABCDEF' } }),
    await customThemeContentHash({ ...theme, colors: { ...theme.colors, background: '#abcdef' } }))
})

test('theme fingerprints detect changes to colors, blur, name and theme settings', async () => {
  const theme = normalizeCustomTheme(DEFAULT_CUSTOM_THEME)
  const original = await customThemeContentHash(theme)
  for (const patch of [
    { colors: { ...theme.colors, background: '#112233' } },
    { blurs: { ...theme.blurs, cardBackground: 10 } },
    { name: 'New theme name' },
    { isDark: !theme.isDark },
    { basedOn: 'light' },
    { mainColor: 'Purple' },
    { secondaryColor: 'Green' },
  ]) assert.notEqual(await customThemeContentHash({ ...theme, ...patch }), original)
})
