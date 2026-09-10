import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import * as Vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'

async function compileComponent(path, bindings = {}) {
  const { descriptor } = parse(await readFile(new URL(`../../src/renderer/components/${path}`, import.meta.url), 'utf8'))
  const source = compileScript(descriptor, { id: path, inlineTemplate: true }).content
    .replace(/import \{([^}]+)\} from ["']vue["'];?/g, (_, imports) => `const {${imports.replace(/ as /g, ': ')}} = Vue`)
    .replace(/^import .* from .*\n/gm, '')
    .replace("import('../helpers/api/capacitor-http')", 'loadNativeHttp()')
    .replace('export default', 'const component =')
  return runInNewContext(`${source}; component`, { Vue, process: { env: { IS_CAPACITOR: true } }, URL, Date, ...bindings })
}

async function mountAvatar(t, nativeResult, componentPath = 'FtChannelAvatar/FtChannelAvatar.vue') {
  const requests = []
  const timers = new Map()
  const RetryImage = await compileComponent('FtRetryImage.vue', {
    loadNativeHttp: async () => ({ fetchCapacitorAvatarDataUrl: async src => { requests.push(src); return nativeResult } }),
    setTimeout: callback => { const id = {}; timers.set(id, callback); return id },
    clearTimeout: id => timers.delete(id)
  })
  const Avatar = await compileComponent(componentPath, {
    FtRetryImage: RetryImage, FtIcon: { render: () => Vue.h('fallback') },
    getTabAvatarUrl: tab => tab.avatarUrl, getTabPreviewFallbackUrl: () => null,
    getTabPageIcon: () => null, formatTabTitle: title => title
  })
  const renderer = Vue.createRenderer({
    createElement: tag => ({ tag, props: {}, children: [] }),
    createComment: () => ({ tag: 'comment' }),
    createText: text => ({ tag: 'text', text }),
    setElementText() {}, setText() {},
    patchProp: (node, key, previous, value) => { node.props[key] = value },
    insert(node, parent, anchor) {
      node.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      if (index < 0) parent.children.push(node)
      else parent.children.splice(index, 0, node)
    },
    remove(node) { node.parent.children.splice(node.parent.children.indexOf(node), 1) },
    parentNode: node => node.parent,
    nextSibling: node => node.parent.children[node.parent.children.indexOf(node) + 1] ?? null
  })
  const thumbnail = Vue.ref('https://yt3.ggpht.com/avatar')
  const root = { children: [] }
  const app = renderer.createApp({ render: () => Vue.h(Avatar, componentPath.startsWith('TabBar/')
    ? { tab: { id: 'channel-tab', avatarUrl: thumbnail.value, title: 'Channel' } }
    : { thumbnail: thumbnail.value }) })
  app.mount(root)
  t.after(() => app.unmount())
  const find = (tag, node = root) => node.tag === tag ? node : node.children?.map(child => find(tag, child)).find(Boolean)
  return { requests, timers, thumbnail, find }
}

async function fail(image) {
  for (const handler of [image.props.onError].flat()) await handler({ type: 'error' })
  await Vue.nextTick()
}

test('channel avatars recover through native HTTP before showing a fallback', async t => {
  const f = await mountAvatar(t, 'data:image/png;base64,AA==')
  await fail(f.find('img'))
  assert.deepEqual(f.requests, ['https://yt3.ggpht.com/avatar'])
  assert.equal(f.find('img')?.props.src, 'data:image/png;base64,AA==')
  assert.equal(f.find('fallback'), undefined)
})

test('channel avatars show a fallback only after the delayed retry fails and reset for a new URL', async t => {
  const f = await mountAvatar(t, null)
  await fail(f.find('img'))
  assert.ok(f.find('img'), 'keep the image mounted while retrying')
  assert.equal(f.timers.size, 1)
  for (const callback of f.timers.values()) callback()
  await Vue.nextTick()
  assert.match(f.find('img').props.src, /opentubex_retry=/)
  await fail(f.find('img'))
  assert.ok(f.find('fallback'))
  f.thumbnail.value = 'https://yt3.ggpht.com/other-avatar'
  await Vue.nextTick()
  assert.equal(f.find('img').props.src, f.thumbnail.value)
})

test('duplicate errors during the retry delay do not remove the avatar or start another request', async t => {
  const f = await mountAvatar(t, null)
  await fail(f.find('img'))
  await fail(f.find('img'))
  assert.ok(f.find('img'))
  assert.equal(f.requests.length, 1)
  assert.equal(f.timers.size, 1)
})

test('an undecodable native image falls back without retrying indefinitely', async t => {
  const f = await mountAvatar(t, 'data:image/png;base64,AA==')
  await fail(f.find('img'))
  await fail(f.find('img'))
  assert.ok(f.find('fallback'))
  assert.equal(f.requests.length, 1)
  assert.equal(f.timers.size, 0)
})

test('tab preview channel avatars recover before hiding the failed URL', async t => {
  const f = await mountAvatar(t, 'data:image/png;base64,AA==', 'TabBar/TabTooltipPreview.vue')
  await fail(f.find('img'))
  assert.deepEqual(f.requests, ['https://yt3.ggpht.com/avatar'])
  assert.equal(f.find('img')?.props.src, 'data:image/png;base64,AA==')
})
