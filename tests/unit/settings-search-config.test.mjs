import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { load as loadYaml } from 'js-yaml'

import {
  SETTINGS_SEARCH_EXCLUDED_MESSAGE_PATHS,
  SETTINGS_SEARCH_SOURCES,
  SETTINGS_SEARCH_SELECT_GROUP_LABELS,
} from '../../src/renderer/helpers/settings-search-config.js'
import {
  createSettingsSearchIndex,
  findSettingsSearchTab,
} from '../../src/renderer/helpers/settingsSearch.js'

const locale = loadYaml(await readFile(
  new URL('../../static/locales/en-US.yaml', import.meta.url),
  'utf8'
))
const getAtPath = (value, path) => path.split('.').reduce((nested, key) => nested?.[key], value)

test('swipe to refresh is searchable in mobile general settings only', () => {
  for (const isCapacitor of [true, false]) {
    const entries = createSettingsSearchIndex({
      sections: [{ type: 'general', title: 'General', description: '' }],
      tm: path => getAtPath(locale, path),
      store: { getters: {} },
      isCapacitor,
      usingElectron: !isCapacitor,
    }).get('general')
    assert.equal(entries.some(({ label }) => label === 'Swipe to refresh'), isCapacitor)
  }
})

test('settings search paths match the canonical locale structure', () => {
  for (const sources of Object.values(SETTINGS_SEARCH_SOURCES)) {
    for (const source of sources) {
      const messages = getAtPath(locale, source.key)
      assert.equal(typeof messages, 'object', `${source.key} must resolve to an object`)

      for (const key of [...source.include ?? [], ...source.exclude ?? []]) {
        assert.ok(Object.hasOwn(messages, key), `${source.key}.${key} must exist`)
      }

      for (const [groupPath, retainedKeys] of Object.entries(
        SETTINGS_SEARCH_SELECT_GROUP_LABELS[source.type] ?? {}
      )) {
        const group = groupPath === '' ? messages : getAtPath(messages, groupPath)
        const fullGroupPath = [source.key, groupPath].filter(Boolean).join('.')
        assert.equal(typeof group, 'object', `${fullGroupPath} must resolve to an object`)
        for (const retainedKey of retainedKeys) {
          assert.ok(
            Object.hasOwn(group, retainedKey),
            `${fullGroupPath}.${retainedKey} must exist`
          )
        }
      }

      for (const excludedPath of SETTINGS_SEARCH_EXCLUDED_MESSAGE_PATHS[source.type] ?? []) {
        assert.notEqual(
          getAtPath(messages, excludedPath),
          undefined,
          `${source.key}.${excludedPath} must exist`
        )
      }
    }
  }
})

test('playback search retains caption controls without caption option values', () => {
  const captionSource = SETTINGS_SEARCH_SOURCES.playback.find(
    ({ type }) => type === 'caption-appearance'
  )
  assert.equal(captionSource?.key, 'Settings.Player Settings.Caption Appearance')
  assert.deepEqual(SETTINGS_SEARCH_SELECT_GROUP_LABELS['caption-appearance'].Anchor, ['Anchor'])
  assert.ok(
    SETTINGS_SEARCH_EXCLUDED_MESSAGE_PATHS['caption-appearance'].has('Application Language')
  )
})

test('settings search excludes values that only exist in hidden controls', () => {
  assert.deepEqual(
    SETTINGS_SEARCH_SELECT_GROUP_LABELS.theme['Icon Pack'],
    ['Icon Pack']
  )
  assert.deepEqual(
    SETTINGS_SEARCH_SELECT_GROUP_LABELS.theme['Custom Theme'],
    ['Create Custom Theme', 'Edit Custom Theme']
  )
  assert.deepEqual(
    SETTINGS_SEARCH_SELECT_GROUP_LABELS.player['Auto Picture in Picture'],
    ['Auto Picture in Picture']
  )
  assert.equal(getAtPath(locale, 'Settings.Password Settings.Password'), undefined)
  assert.equal(typeof getAtPath(locale, 'Settings.Password Dialog.Password'), 'string')
  assert.ok(
    SETTINGS_SEARCH_EXCLUDED_MESSAGE_PATHS['sponsor-block']
      .has('Generated SponsorBlock User ID Copy Button')
  )
})

test('shared settings search index includes only settings available on this platform', () => {
  const store = {
    getters: new Proxy({
      getBaseTheme: 'dark',
      getDefaultCaptionSettings: '{}',
      getSystemDarkTheme: 'dark',
      getSystemLightTheme: 'light',
    }, {
      get(target, key) {
        return target[key] ?? false
      }
    })
  }
  const sections = [{
    type: 'appearance',
    title: locale.Settings.Categories.Appearance,
    description: locale.Settings.Categories['Appearance Description'],
  }]
  const options = {
    sections,
    tm: path => getAtPath(locale, path),
    store,
    supportsLocalApi: true,
    isMac: false,
    isLinuxWayland: false,
    systemUsesDarkTheme: true,
  }

  const desktopValues = createSettingsSearchIndex({
    ...options,
    usingElectron: true,
  }).get('appearance')
  const webValues = createSettingsSearchIndex({
    ...options,
    usingElectron: false,
    isCapacitor: false,
  }).get('appearance')
  const mobileValues = createSettingsSearchIndex({
    ...options,
    usingElectron: false,
    isCapacitor: true,
  }).get('appearance')

  assert.ok(desktopValues.some(({ label }) => label === 'Show thumbnail previews'))
  assert.ok(desktopValues.some(({ label }) => label === 'Navigation'))
  assert.ok(desktopValues.some(({ label }) => label === 'UI Scale'))
  assert.ok(!webValues.some(({ label }) => label === 'UI Scale'))
  assert.ok(mobileValues.some(({ label }) => label === 'Mobile layout'))
  assert.ok(mobileValues.some(({ label }) => label === 'Use Fixed Tab Width in Horizontal Mode'))
  assert.ok(mobileValues.some(({ label }) => label === 'Show Tab Icons'))
  assert.ok(mobileValues.some(({ label }) => label === locale.Settings['Theme Settings'].Font['App Font']))
  assert.ok(mobileValues.some(({ label }) => label === locale.Settings['Theme Settings']['Move Settings to App Header']))
  assert.ok(mobileValues.some(({ label }) => label === locale.Settings['Theme Settings']['UI Scale']))
  assert.ok(!mobileValues.some(({ label }) => label === 'Show progress as notification'))
})

test('mobile playback search excludes settings that have no Capacitor behavior', () => {
  const options = {
    sections: [{
      type: 'playback',
      title: locale.Settings.Categories.Playback,
      description: locale.Settings.Categories['Playback Description'],
    }],
    tm: path => getAtPath(locale, path),
    store: {
      getters: new Proxy({}, {
        get(target, key) {
          return target[key] ?? false
        }
      })
    },
    supportsLocalApi: true,
    isMac: false,
    isLinuxWayland: false,
    systemUsesDarkTheme: true,
  }
  const values = createSettingsSearchIndex({
    ...options,
    usingElectron: false,
    isCapacitor: true,
  }).get('playback')
  const desktopValues = createSettingsSearchIndex({
    ...options,
    usingElectron: true,
    isCapacitor: false,
  }).get('playback')

  const labels = new Set(values.map(({ label }) => label))
  const desktopLabels = new Set(desktopValues.map(({ label }) => label))
  assert.ok(labels.has('Automatically enter Picture-in-Picture'))
  assert.ok(labels.has('Rotate wide videos to landscape in fullscreen'))
  assert.ok(labels.has('Swipe up or down to enter or exit fullscreen'))
  for (const label of ['Left-side swipe', 'Right-side swipe', 'Full brightness in fullscreen']) {
    assert.ok(labels.has(label))
    assert.ok(!desktopLabels.has(label))
  }
  assert.ok(!labels.has('Scroll Volume Over Video Player'))
  assert.ok(!labels.has('Remember Volume'))
  assert.ok(!labels.has('Default Volume'))
  assert.ok(!labels.has('Display Play Button In Video Player'))
  assert.ok(!labels.has('Enable Volume'))
  assert.ok(!labels.has('Volume'))
  assert.ok(!desktopLabels.has('Rotate wide videos to landscape in fullscreen'))
  assert.ok(!desktopLabels.has('Swipe up or down to enter or exit fullscreen'))
})

test('settings search results retain their source tab', () => {
  const store = {
    getters: new Proxy({}, {
      get() {
        return false
      }
    })
  }
  const values = createSettingsSearchIndex({
    sections: [{
      type: 'data',
      title: locale.Settings.Categories.Data,
      description: locale.Settings.Categories['Data Description'],
    }],
    tm: path => getAtPath(locale, path),
    store,
    usingElectron: true,
    supportsLocalApi: true,
    isMac: false,
    isLinuxWayland: false,
    systemUsesDarkTheme: true,
  }).get('data')

  const searchHistory = values.filter(({ label }) => label === 'Search history')
  assert.equal(searchHistory.length, 1)
  assert.equal(findSettingsSearchTab(searchHistory[0]), 'data')

  const applicationCaches = values.find(({ label }) => label === 'Application caches')
  assert.equal(findSettingsSearchTab(applicationCaches), 'storage')
})

test('persistent playback cache search results follow desktop visibility', () => {
  const sections = [{
    type: 'data',
    title: locale.Settings.Categories.Data,
    description: locale.Settings.Categories['Data Description'],
  }]
  const options = {
    sections,
    tm: path => getAtPath(locale, path),
    store: {
      getters: new Proxy({}, {
        get(target, key) {
          return target[key] ?? false
        }
      })
    },
    supportsLocalApi: true,
    isMac: false,
    isLinuxWayland: false,
    systemUsesDarkTheme: true,
  }

  const desktopValues = createSettingsSearchIndex({ ...options, usingElectron: true }).get('data')
  const webValues = createSettingsSearchIndex({ ...options, usingElectron: false }).get('data')

  assert.ok(desktopValues.some(({ label }) => label === 'yt-dlp stream URL cache limit'))
  assert.ok(!webValues.some(({ label }) => label === 'yt-dlp stream URL cache limit'))
})

test('ignored comment translation languages follow local API availability', () => {
  const options = {
    sections: [{
      type: 'general',
      title: 'General',
      description: locale.Settings.Categories['General Description'],
    }],
    tm: path => getAtPath(locale, path),
    store: {
      getters: new Proxy({}, {
        get() {
          return false
        }
      })
    },
    usingElectron: true,
    isMac: false,
    isLinuxWayland: false,
    systemUsesDarkTheme: true,
  }

  const localApiValues = createSettingsSearchIndex({
    ...options,
    supportsLocalApi: true,
  }).get('general')
  const webValues = createSettingsSearchIndex({
    ...options,
    supportsLocalApi: false,
  }).get('general')

  assert.ok(localApiValues.some(({ label }) => label === 'Never translate comments in'))
  assert.ok(localApiValues.some(({ label }) => label === 'Enable comment translations'))
  assert.ok(localApiValues.some(({ label }) => label === 'Comment translations'))
  assert.ok(localApiValues.some(({ label }) => label === 'Fill missing translations with AI-generated ones'))
  assert.ok(webValues.some(({ label }) => label === 'Fill missing translations with AI-generated ones'))
  assert.ok(!webValues.some(({ label }) => label === 'Never translate comments in'))
  assert.ok(!webValues.some(({ label }) => label === 'Enable comment translations'))
  assert.ok(!webValues.some(({ label }) => label === 'Comment translations'))
})

for (const [platform, usingElectron, isCapacitor] of [
  ['desktop', true, false], ['mobile', false, true], ['web', false, false],
]) {
  test(`${platform} general settings search matches tab support`, () => {
    const entries = createSettingsSearchIndex({
      sections: [{ type: 'general', title: 'General', description: '' }],
      tm: path => getAtPath(locale, path),
      store: { getters: {} },
      usingElectron,
      isCapacitor,
    }).get('general')
    for (const path of [
      'New Tab Position.New Tab Position',
      'Tab Close Focus.Tab Close Focus',
      'Startup Behavior.Startup Behavior',
    ]) {
      const label = getAtPath(locale, `Settings.General Settings.${path}`)
      assert.equal(entries.some(entry => entry.label === label), usingElectron || isCapacitor, label)
    }
  })
}

for (const [platform, usingElectron, isCapacitor] of [
  ['desktop', true, false], ['mobile', false, true], ['web', false, false],
]) {
  test(`${platform} privacy search matches navigation history setting visibility`, () => {
    const entries = createSettingsSearchIndex({
      sections: [{ type: 'privacy', title: 'Privacy', description: '' }],
      tm: path => getAtPath(locale, path),
      store: { getters: {} },
      usingElectron,
      isCapacitor,
    }).get('privacy')
    assert.equal(entries.some(({ label }) => label === 'Remember Tab Navigation History'), usingElectron || isCapacitor)
  })
}

test('voice-over settings are searchable on Android and Electron, but not the web build', () => {
  for (const [usingElectron, isCapacitor] of [[true, false], [false, true], [false, false]]) {
    const entries = createSettingsSearchIndex({
      sections: [{ type: 'add-ons', title: 'Add-ons', description: '' }],
      tm: path => getAtPath(locale, path),
      store: { getters: { getUseVoiceOverTranslation: true } },
      usingElectron, isCapacitor,
    }).get('add-ons')
    assert.equal(entries.some(({ label }) => label === locale.Settings['Player Settings']['Voice-over Translation'].Enable), usingElectron || isCapacitor)
  }
})

test('startup splash setting is searchable only on Electron', () => {
  for (const [usingElectron, isCapacitor] of [[true, false], [false, true], [false, false]]) {
    const entries = createSettingsSearchIndex({
      sections: [{ type: 'focus', title: 'Focus', description: '' }],
      tm: path => getAtPath(locale, path),
      store: { getters: { getChannelsHiddenParsed: [], getForbiddenTitlesParsed: [] } },
      usingElectron,
      isCapacitor,
    }).get('focus')
    assert.equal(entries.some(({ label }) => label === 'Hide Startup Splash'), usingElectron)
  }
})
