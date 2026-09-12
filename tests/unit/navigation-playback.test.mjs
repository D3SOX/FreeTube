import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { computed, effectScope, nextTick, reactive, ref, shallowRef, watch } from 'vue'

const source = (await readFile(new URL('../../src/renderer/components/TabContent/TabWatchContent.vue', import.meta.url), 'utf8'))
  .split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm, '')

const titleSource = (await readFile(new URL('../../src/renderer/tabs/TabContext.js', import.meta.url), 'utf8'))
  .replace(/^import .*$/gm, '').replace(/^export /gm, '')

function mountWatch(t, { paused = false, hasLoaded = true, mounted = true } = {}) {
  const route = { path: '/watch/video', fullPath: '/watch/video', params: { id: 'video' } }
  const props = reactive({ tabId: 'tab', route, presented: true })
  const getters = reactive({ getKeepPlayingOnNavigation: true, getTabById: () => ({ history: [] }) })
  const provides = new Map()
  const unmount = []
  const titles = []
  const scope = effectScope()
  const video = { paused, ended: false }
  let lifecycle
  let disposals = 0
  scope.run(() => vm.runInNewContext(source, {
    computed, nextTick, reactive, ref, shallowRef, watch,
    defineProps: () => props,
    // The native scroll mini player lives outside the watch view's DOM tree.
    // Its component reference must remain usable without a DOM video descendant.
    useTemplateRef: () => ref(mounted ? { $refs: { player: { hasLoaded, isPaused: () => video.paused } }, querySelector: () => null } : null),
    provide: (key, value) => provides.set(key, value),
    onBeforeUnmount: callback => unmount.push(callback),
    store: { getters },
    resolveRouteComponent: () => ({}),
    getTabNavigationService: () => ({ createRouterFacade: () => ({}), setTitle: (...args) => titles.push(args) }),
    tabLifecycleService: { register: (_id, hooks) => { lifecycle = hooks; return () => {} } },
    tabLifecycleKey: 'lifecycle', tabPresentedKey: 'presented', watchNavigationKey: 'navigation',
    routeLocationKey: 'route', routerKey: 'router', console
  }))
  const updateTitle = vm.runInNewContext(`${titleSource}; useTabTitle()`, {
    inject: key => key.description === 'watch-navigation' ? provides.get('navigation') : null,
    onBeforeUnmount: callback => unmount.push(callback)
  })
  provides.get('lifecycle').register('tab', { beforeDispose: () => { disposals++ } })
  t.after(async () => {
    unmount.forEach(callback => callback())
    await nextTick()
    scope.stop()
  })
  return {
    props, getters, provides, lifecycle, titles, updateTitle,
    disposals: () => disposals,
    async navigate(path) {
      const to = { path, fullPath: path, params: {} }
      await lifecycle.beforeNavigate({ to, from: props.route })
      props.route = to
      await nextTick()
      await lifecycle.afterNavigate({ to })
    }
  }
}

test('retains a playing native video outside the watch DOM across navigation', async t => {
  const mounted = mountWatch(t)
  await mounted.navigate('/subscriptions')
  assert.equal(mounted.disposals(), 0)
  assert.equal(mounted.provides.get('navigation').detached.value, true)
  assert.equal(mounted.provides.get('presented').value, false)
  assert.equal(mounted.provides.get('route').fullPath, '/watch/video')
  await mounted.navigate('/history')
  assert.equal(mounted.disposals(), 0)
  await mounted.navigate('/watch/video')
  assert.equal(mounted.disposals(), 0)
  assert.equal(mounted.provides.get('presented').value, true)
  assert.equal(mounted.provides.get('navigation').detached.value, false)
})

test('paused playback is disposed when leaving the watch view', async t => {
  const mounted = mountWatch(t, { paused: true })
  await mounted.navigate('/subscriptions')
  assert.equal(mounted.disposals(), 1)
  assert.equal(mounted.provides.get('navigation').detached.value, false)
})

test('disabling retention disposes the hidden player only once', async t => {
  const mounted = mountWatch(t)
  await mounted.navigate('/subscriptions')
  mounted.getters.getKeepPlayingOnNavigation = false
  await nextTick()
  await mounted.lifecycle.beforeDispose()
  assert.equal(mounted.disposals(), 1)
})

for (const options of [{ hasLoaded: false }, { mounted: false }]) {
  test(`does not retain unavailable playback ${JSON.stringify(options)}`, async t => {
    const mounted = mountWatch(t, options)
    await mounted.navigate('/subscriptions')
    assert.equal(mounted.disposals(), 1)
    assert.equal(mounted.provides.get('navigation').detached.value, false)
  })
}

test('restores detached title options without resolving pending metadata', async t => {
  const mounted = mountWatch(t)
  await mounted.navigate('/subscriptions')
  const options = { resolveHistoryEntry: false }
  mounted.updateTitle('Watch', options)
  await mounted.navigate('/watch/video')
  assert.equal(mounted.titles.at(-1)[1], 'Watch')
  assert.equal(mounted.titles.at(-1)[2], options)
})

test('return navigation waits for disabled retained playback to finish disposal', async t => {
  const mounted = mountWatch(t)
  await mounted.navigate('/subscriptions')
  let finish
  const pending = new Promise(resolve => { finish = resolve })
  mounted.provides.get('lifecycle').register('tab', { beforeDispose: () => pending })
  mounted.getters.getKeepPlayingOnNavigation = false
  await nextTick()
  let returned = false
  const returning = mounted.navigate('/watch/video').then(() => { returned = true })
  await new Promise(resolve => setImmediate(resolve))
  const returnedDuringDisposal = returned
  finish()
  await returning
  assert.equal(returnedDuringDisposal, false)
  assert.equal(mounted.disposals(), 1)
  assert.equal(mounted.provides.get('navigation').detached.value, false)
})
