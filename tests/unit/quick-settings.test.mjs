import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { load } from 'js-yaml'

import {
  createQuickSettingSections,
  DEFAULT_QUICK_SETTINGS,
  isQuickSettingPaired,
  normalizeQuickSettings,
  QUICK_SETTING_DEFINITIONS,
} from '../../src/renderer/helpers/quickSettings.js'

test('keeps the original quick settings as defaults', () => {
  assert.deepEqual(DEFAULT_QUICK_SETTINGS, [
    'baseTheme',
    'mainColor',
    'uiScale',
    'thumbnailSize',
    'defaultQuality',
    'playNextVideo',
    'enableSubtitlesByDefault',
    'listType',
    'playlistViewType',
    'hideRecommendedVideos',
    'hideComments',
    'currentLocale',
    'region',
  ])
})

test('localizes every quick setting, select option, and category in English and German', () => {
  for (const locale of ['en-US', 'de-DE']) {
    const messages = load(readFileSync(new URL(`../../static/locales/${locale}.yaml`, import.meta.url), 'utf8'))
    const translate = key => {
      const value = key.split('.').reduce((object, part) => object?.[part], messages)
      assert.equal(typeof value, 'string', `${locale}: ${key}`)
      assert.ok(value.length > 0, `${locale}: ${key}`)
      return value
    }
    const sections = createQuickSettingSections(translate, true)
    assert.ok(sections.some(section => section.id === 'privacy'))
    for (const setting of QUICK_SETTING_DEFINITIONS) {
      for (const key of setting.optionLabelKeys ?? []) translate(key)
    }
  }
})

test('gives every customizable setting an icon', () => {
  for (const setting of QUICK_SETTING_DEFINITIONS) {
    assert.equal(Array.isArray(setting.icon) && setting.icon.length, 2, setting.id)
  }
})

test('uses the settings category icons for quick setting sections', () => {
  const sectionIcons = Object.fromEntries(
    createQuickSettingSections(key => key, true).map(section => [section.id, section.icon])
  )

  assert.deepEqual(sectionIcons, {
    appearance: ['fas', 'display'],
    playback: ['fas', 'circle-play'],
    content: ['fas', 'eye-slash'],
    language: ['fas', 'globe'],
    advanced: ['fas', 'flask'],
    'add-ons': ['fas', 'puzzle-piece'],
    privacy: ['fas', 'lock'],
  })
})

test('pairs adjacent selects without leaving an odd select in a half-row', () => {
  const select = { control: 'select' }
  const toggle = { control: 'toggle' }

  assert.deepEqual(
    [select, select, toggle, select, select, select].map((_, index, settings) => (
      isQuickSettingPaired(settings, index)
    )),
    [true, true, false, true, true, false]
  )
})

test('keeps valid quick settings in the selected order', () => {
  assert.deepEqual(
    normalizeQuickSettings(['useProxy', 'baseTheme', 'hideComments']),
    ['useProxy', 'baseTheme', 'hideComments']
  )
})

test('removes unknown setting identifiers and duplicates', () => {
  assert.deepEqual(
    normalizeQuickSettings(['useProxy', 'removedSetting', 'useProxy']),
    ['useProxy']
  )
})

test('removes values that cannot identify a setting', () => {
  assert.deepEqual(normalizeQuickSettings(['baseTheme', '', null, 4]), ['baseTheme'])
})

test('falls back to defaults only when the stored value is invalid', () => {
  assert.deepEqual(normalizeQuickSettings(null), DEFAULT_QUICK_SETTINGS)
  assert.deepEqual(normalizeQuickSettings([]), [])
})
