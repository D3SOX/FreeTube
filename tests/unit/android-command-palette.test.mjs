import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { load } from 'js-yaml'
import { createSettingsSearchIndex } from '../../src/renderer/helpers/settingsSearch.js'

const messages = load(await readFile(new URL('../../static/locales/en-US.yaml', import.meta.url), 'utf8'))
const source = (await readFile(new URL('../../src/renderer/helpers/commandPaletteRegistry.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
  .replace('export function', 'function')
const shortcuts = { APP: { GENERAL: {} }, VIDEO_PLAYER: { GENERAL: {}, PLAYBACK: {} } }
const createRegistry = new Function('createSettingsSearchIndex', 'getConfiguredKeyboardShortcuts',
  'DefaultKeyboardShortcuts', 'KeyboardShortcuts', 'shouldShowKeyboardShortcutCommand',
  'isTrendingAvailable', 'isMostPopularAvailable', `${source}\nreturn createCommandPaletteRegistry`)(
  createSettingsSearchIndex, () => shortcuts, shortcuts, shortcuts, () => false, () => false, () => false
)

for (const isCapacitor of [true, false]) {
  test(`download settings commands respect Android availability: ${isCapacitor}`, () => {
    let openedSection
    let openedSearch
    const commands = createRegistry({
      isElectron: false,
      isCapacitor,
      routePath: '/settings',
      routeAvailable: () => true,
      t: key => key,
      tm: path => path.split('.').reduce((value, key) => value?.[key], messages),
      store: { getters: { getChannelsHiddenParsed: [], getForbiddenTitlesParsed: [], getTabs: [], getProfileList: [], getAllPlaylists: [], getYtDlpDownloads: {} } },
      openSettingsSection: section => { openedSection = section },
      openSettingsSearchResult: (section, match) => { openedSearch = { section, match } },
    })
    const downloads = commands.find(command => command.id === 'settings.download')
    assert.equal(downloads.disabledReason === '', isCapacitor)
    const results = commands.filter(command => command.id.startsWith('settings.search.download.'))
    assert.equal(results.length > 0, isCapacitor)
    if (isCapacitor) {
      downloads.run()
      assert.equal(openedSection, 'download')
      results[0].run()
      assert.equal(openedSearch.section, 'download')
      assert.ok(openedSearch.match.label)
    }
  })
}
