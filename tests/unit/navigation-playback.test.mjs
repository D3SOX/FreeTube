import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { computed, effectScope, nextTick, reactive, ref, shallowRef, watch } from 'vue'

const source = (await readFile(new URL('../../src/renderer/components/TabContent/TabWatchContent.vue', import.meta.url), 'utf8'))
  .split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm, '')

function mountWatch(t, { paused = false } = {}) {
  const route = { path: '/watch/video', fullPath: '/watch/video', params: { id: 'video' } }
  const props = reactive({ tabId: 'tab', route, presented: true })
  const getters = reactive({ getKeepPlayingOnNavigation: true, getTabById: () => ({ history: [] }) })
  const provides = new Map()
  const unmount = []
  const scope = effectScope()
  const video = { paused, ended: false }
  let lifecycle
  let disposals = 0
  scope.run(() => vm.runInNewContext(source, {
    computed, reactive, ref, shallowRef, watch,
    defineProps: () => props,
    // The native scroll mini player lives outside the watch view's DOM tree.
    // Its component reference must remain usable without a DOM video descendant.
    useTemplateRef: () => ref({ $refs: { player: { hasLoaded: true, isPaused: () => video.paused } }, querySelector: () => null }),
    provide: (key, value) => provides.set(key, value),
    onBeforeUnmount: callback => unmount.push(callback),
    store: { getters },
    resolveRouteComponent: () => ({}),
    getTabNavigationService: () => ({ createRouterFacade: () => ({}), setTitle() {} }),
    tabLifecycleService: { register: (_id, hooks) => { lifecycle = hooks; return () => {} } },
    tabLifecycleKey: 'lifecycle', tabPresentedKey: 'presented', watchNavigationKey: 'navigation',
    routeLocationKey: 'route', routerKey: 'router', console
  }))
  provides.get('lifecycle').register('tab', { beforeDispose: () => { disposals++ } })
  t.after(async () => {
    unmount.forEach(callback => callback())
    await nextTick()
    scope.stop()
  })
  return {
    props, getters, provides, lifecycle,
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
