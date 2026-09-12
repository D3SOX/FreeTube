import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compile, createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'

const source = readFileSync(new URL('../../src/renderer/components/TabBar/CapacitorPhoneTabSwitcher.vue', import.meta.url), 'utf8')
const label = source.slice(source.indexOf('class="capacitorPhoneSyncedTabList"')).match(/<span dir="auto">.*?<\/span>/)[0]
const titleSource = readFileSync(new URL('../../src/renderer/tabs/tabTitle.js', import.meta.url), 'utf8')
  .replace("import packageDetails from '@root/package.json'", `const packageDetails = ${readFileSync(new URL('../../package.json', import.meta.url), 'utf8')}`)
const { formatTabTitle } = await import(`data:text/javascript;base64,${Buffer.from(titleSource).toString('base64')}`)

for (const [title, expected] of [
  ['Subscriptions - OpenTubeX', 'Subscriptions'],
  ['A video - OpenTubeX', 'A video'],
  ['OpenTubeX tutorial - part 1 - OpenTubeX', 'OpenTubeX tutorial - part 1'],
  ['Mobile title', 'Mobile title'],
  ['', '/subscriptions'],
]) {
  test(`phone synced tab label displays ${JSON.stringify(expected)}`, async () => {
    const app = createSSRApp({
      setup: () => ({ tab: { title, url: '/subscriptions' }, formatTabTitle }),
      render: compile(label),
    })
    assert.equal(await renderToString(app), `<span dir="auto">${expected}</span>`)
  })
}
