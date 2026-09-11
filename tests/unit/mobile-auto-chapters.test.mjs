import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { compile, createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

const settingsSource = await readFile(new URL('../../src/renderer/components/PlayerSettings/PlayerSettings.vue', import.meta.url), 'utf8')
const toggle = [...settingsSource.matchAll(/<FtToggleSwitch\s[\s\S]*?\/>/g)]
  .map(([template]) => template)
  .find(template => template.includes('Automatically Open Chapters'))
const render = compile(`<div>${toggle}</div>`)

for (const [platform, IS_CAPACITOR, visible] of [['Android', true, false], ['desktop', false, true]]) {
  test(`automatically open chapters is ${visible ? 'shown' : 'hidden'} on ${platform}`, async () => {
    const app = createSSRApp({
      render,
      setup: () => ({ IS_CAPACITOR, t: key => key, autoOpenChapters: true, updateAutoOpenChapters() {} })
    })
    app.component('FtToggleSwitch', {
      setup: (_props, { attrs }) => () => h('span', { 'data-label': attrs.label })
    })
    const html = await renderToString(app)
    assert.equal(html.includes('Automatically Open Chapters'), visible)
  })
}

const watchSource = await readFile(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
const autoOpenBody = watchSource.match(/autoOpenChapters:\s*function \(\) \{([\s\S]*?)\n    \},/)[1]

test('persisted automatically open chapters setting has no effect on Android', () => {
  const getter = vm.runInNewContext(`(function () {${autoOpenBody}\n})`, {
    process: { env: { IS_CAPACITOR: true } }
  })
  assert.equal(getter.call({ $store: { getters: { getAutoOpenChapters: true } } }), false)
})
