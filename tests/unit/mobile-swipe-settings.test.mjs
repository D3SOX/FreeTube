import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { compile, computed, createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

const source = await readFile(new URL('../../src/renderer/components/PlayerSettings/PlayerSettings.vue', import.meta.url), 'utf8')
const selects = [...source.matchAll(/<FtSelect\s[\s\S]*?\/>/g)]
  .map(([template]) => template)
  .filter(template => /setting-key="mobile(?:Left|Right)SwipeAction"/.test(template))
assert.equal(selects.length, 2)
const render = compile(`<div>${selects.join('\n')}</div>`)
const swipeSettings = source.slice(source.indexOf('const MOBILE_SWIPE_ACTION_VALUES'), source.indexOf('/** @type {import(\'vue\').ComputedRef<boolean>} */'))
const bindings = vm.runInNewContext(`${swipeSettings}; ({ MOBILE_SWIPE_ACTION_VALUES, MOBILE_SWIPE_ACTION_ICONS, mobileSwipeActionNames })`, { computed, t: key => key })

for (const side of ['Left', 'Right']) {
  for (const [action, icon] of Object.entries({ disabled: 'xmark', brightness: 'sun', volume: 'volume-high', speed: 'gauge-high' })) {
    test(`${side.toLowerCase()} swipe setting shows the ${action} icon`, async () => {
      const getters = { getMobileLeftSwipeAction: 'brightness', getMobileRightSwipeAction: 'volume' }
      getters[`getMobile${side}SwipeAction`] = action
      const app = createSSRApp({ render, setup: () => ({ ...bindings, store: { getters }, t: key => key }) })
      app.component('FtSelect', {
        inheritAttrs: false,
        setup: (_props, { attrs }) => () => h('span', {
          'data-setting': attrs['setting-key'],
          'data-icon': attrs.icon.join(':'),
        }),
      })
      const html = await renderToString(app)
      assert.ok(html.includes(`data-setting="mobile${side}SwipeAction" data-icon="fas:${icon}"`), html)
    })
  }
}
