import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { load } from 'js-yaml'
import { ANDROID_PROXY_SETTING_KEYS, configureAndroidProxy } from '../../src/renderer/helpers/androidProxy.js'
import { createSettingsSearchIndex } from '../../src/renderer/helpers/settingsSearch.js'
import { createQuickSettingCatalog } from '../../src/renderer/helpers/quickSettings.js'

const source = await readFile(new URL('../../src/renderer/store/modules/settings.js', import.meta.url), 'utf8')

function fixture(configure, { failWrite = false, persisted = null } = {}) {
  const writes = []
  const errors = []
  const context = vm.createContext({
    process: { env: { IS_CAPACITOR: true } },
    ANDROID_PROXY_SETTING_KEYS,
    configureAndroidProxy: configure,
    readAndroidProxySettings: async () => persisted,
    defaultUpdaterId: key => key,
    defaultMutationId: key => key,
    DBSettingHandlers: { upsert: async (key, value) => {
      if (failWrite) throw new Error('Renderer database is full')
      writes.push([key, value])
    } },
    showToast: toast => errors.push(toast),
    i18n: { global: { t: key => key } },
  })
  const start = source.indexOf('let androidProxyUpdate =')
  const end = source.indexOf('  async mergeSubscriptionSeenVideos(')
  assert.ok(start !== -1 && end > start, 'Expected Android proxy action anchors in settings.js')
  vm.runInContext(source.slice(start, end) + '\n};globalThis.actions = customActions', context)
  const state = { useProxy: false, proxyHostname: 'old', proxyPort: '9050', proxyProtocol: 'socks5' }
  return {
    writes,
    errors,
    state,
    wait: () => context.actions.waitForAndroidProxySettings(),
    restore: () => context.actions.loadAndroidProxySettings({ commit: (key, value) => { state[key] = value } }),
    update: (key, value) => context.actions[key]({ state, commit: (key, value) => { state[key] = value } }, value),
  }
}

test('Android proxy edits apply natively before saving and serialize across fields', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const applied = []
  const settings = fixture(async value => { applied.push(value); await gate })
  const enable = settings.update('useProxy', true)
  const host = settings.update('proxyHostname', 'new')
  const port = settings.update('proxyPort', '1080')
  let appliedAll = false
  const ready = settings.wait().then(() => { appliedAll = true })
  await Promise.resolve()
  assert.equal(applied.length, 1)
  assert.equal(applied[0].useProxy, true)
  assert.deepEqual(settings.writes, [])
  assert.equal(appliedAll, false)
  release()
  await Promise.all([enable, host, port, ready])
  assert.equal(appliedAll, true)
  assert.equal(applied[1].useProxy, true)
  assert.equal(applied[2].proxyHostname, 'new')
  assert.equal(applied[2].proxyPort, '1080')
  assert.equal(settings.state.proxyHostname, 'new')
  assert.equal(settings.state.useProxy, true)
})

test('a failed renderer database write cannot hide an enabled native proxy', async () => {
  const settings = fixture(async () => {}, { failWrite: true })
  await settings.update('useProxy', true)
  assert.equal(settings.state.useProxy, true)
  assert.equal(settings.errors.length, 1)
})

test('startup reads the native persisted proxy instead of applying stale renderer settings', async () => {
  let configured = false
  const persisted = { useProxy: true, proxyProtocol: 'socks5', proxyHostname: 'proxy.example', proxyPort: '1080', proxyUsername: '', proxyPassword: '' }
  const settings = fixture(async () => { configured = true }, { persisted })
  await settings.restore()
  assert.equal(settings.state.useProxy, true)
  assert.equal(settings.state.proxyHostname, 'proxy.example')
  assert.equal(configured, false)
})

test('failed native proxy changes are reported and a subsequent edit can recover', async () => {
  let failed = false
  const settings = fixture(async () => {
    if (!failed) { failed = true; throw new Error('Native failure') }
  })
  await settings.update('useProxy', true)
  assert.deepEqual(settings.writes, [])
  assert.equal(settings.state.useProxy, false)
  assert.equal(settings.errors.length, 1)
  await settings.update('useProxy', true)
  assert.equal(settings.state.useProxy, true)
})

test('desktop does not initialize an Android proxy', async () => {
  await configureAndroidProxy({})
})

test('Android quick settings expose the proxy toggle alongside UI Scale', () => {
  const ids = createQuickSettingCatalog(key => key, false, true).map(setting => setting.id)
  assert.ok(ids.includes('useProxy'))
  assert.ok(ids.includes('uiScale'))
  assert.equal(createQuickSettingCatalog(key => key, false, false).some(setting => setting.id === 'useProxy'), false)
})

test('Android settings search exposes SOCKS5 credentials but hides the desktop recovery script', async () => {
  const messages = load(await readFile(new URL('../../static/locales/en-US.yaml', import.meta.url), 'utf8'))
  const options = {
    sections: [{ type: 'advanced', title: 'Advanced', description: '' }],
    usingElectron: false,
    isCapacitor: true,
    store: { getters: { getUseProxy: true, getProxyProtocol: 'socks5', getChannelsHiddenParsed: [], getForbiddenTitlesParsed: [] } },
    t: key => key,
    tm: path => path.split('.').reduce((value, key) => value?.[key], messages),
  }
  const labels = createSettingsSearchIndex(options).get('advanced').map(match => match.label)
  assert.ok(labels.includes('Proxy Username'))
  assert.ok(labels.includes('Proxy Password'))
  assert.equal(labels.includes('IP Block Recovery Script Path'), false)
  assert.equal(createSettingsSearchIndex({ ...options, isCapacitor: false }).get('advanced')
    .some(match => match.label === 'Proxy Username'), false)
})
