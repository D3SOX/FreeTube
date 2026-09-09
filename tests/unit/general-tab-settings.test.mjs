import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { compile, createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

const source = await readFile(new URL('../../src/renderer/components/GeneralSettings/GeneralSettings.vue', import.meta.url), 'utf8')
const keys = ['landingPage', 'newTabPosition', 'tabCloseFocus', 'startupBehavior']
const selects = [...source.matchAll(/<FtSelect\s[\s\S]*?\/>/g)]
  .map(([template]) => template)
  .filter(template => keys.some(key => template.includes(`setting-key="${key}"`)))
assert.equal(selects.length, keys.length)
const render = compile(`<div>${selects.join('\n')}</div>`)

for (const [platform, USING_ELECTRON, IS_CAPACITOR] of [
  ['desktop', true, false], ['mobile', false, true], ['web', false, false],
]) {
  test(`${platform} renders the general tab settings supported by its tab system`, async () => {
    const bindings = {
      mode: 'general', USING_ELECTRON, IS_CAPACITOR, t: key => key,
      defaultPageNames: [], defaultPageValues: [],
      NEW_TAB_POSITION_VALUES: [], TAB_CLOSE_FOCUS_VALUES: [], STARTUP_BEHAVIOR_VALUES: [],
    }
    for (const key of keys) {
      bindings[key] = ''
      bindings[`${key}Names`] = []
      bindings[`update${key[0].toUpperCase()}${key.slice(1)}`] = () => {}
    }
    const app = createSSRApp({ render, setup: () => bindings })
    app.component('FtSelect', {
      inheritAttrs: false,
      setup: (_props, { attrs }) => () => h('select', { 'data-setting': attrs['setting-key'] }),
    })
    const html = await renderToString(app)
    for (const key of keys) {
      assert.equal(html.includes(`data-setting="${key}"`), key === 'landingPage' || USING_ELECTRON || IS_CAPACITOR, key)
    }
  })
}

test('mobile startup waits for saved settings before restoring tabs', async () => {
  const app = await readFile(new URL('../../src/renderer/App.vue', import.meta.url), 'utf8')
  const start = app.indexOf('  let tabsReady = Promise.resolve()')
  const initialization = app.slice(start, app.indexOf('  const customThemesReady =', start))
  let finishSettings
  const settingsReady = new Promise(resolve => { finishSettings = resolve })
  let restored = false
  const { tabsReady } = vm.runInNewContext(`${initialization}; ({ tabsReady })`, {
    isElectron: false,
    isCapacitor: true,
    route: {},
    ytDlp: { addYtDlpBinaryUpdatedListener: () => {} },
    invalidateAllYtDlpPlaybackSources: () => {},
    store: { dispatch: () => settingsReady },
    initializeAndroidYtDlp: () => {},
    initializeCapacitorTabPreviews: () => {},
    capacitorTabService: { initialize: async () => { restored = true } },
  })
  await Promise.resolve()
  assert.equal(restored, false)
  finishSettings({})
  await tabsReady
  assert.equal(restored, true)
})

const privacySource = await readFile(new URL('../../src/renderer/components/PrivacySettings.vue', import.meta.url), 'utf8')
const historyToggle = [...privacySource.matchAll(/<FtToggleSwitch\s[\s\S]*?\/>/g)]
  .map(([template]) => template)
  .find(template => template.includes('setting-key="rememberTabNavigationHistory"'))
assert.ok(historyToggle)
for (const [platform, USING_ELECTRON, IS_CAPACITOR] of [
  ['desktop', true, false], ['mobile', false, true], ['web', false, false],
]) {
  test(`${platform} exposes navigation history persistence only with logical tabs`, async () => {
    const app = createSSRApp({
      render: compile(historyToggle),
      setup: () => ({ USING_ELECTRON, IS_CAPACITOR, rememberTabNavigationHistory: false, updateRememberTabNavigationHistory: () => {} }),
    })
    app.config.globalProperties.$t = key => key
    app.component('FtToggleSwitch', {
      inheritAttrs: false,
      setup: (_props, { attrs }) => () => h('button', { 'data-setting': attrs['setting-key'] }),
    })
    const html = await renderToString(app)
    assert.equal(html.includes('data-setting="rememberTabNavigationHistory"'), USING_ELECTRON || IS_CAPACITOR)
  })
}
