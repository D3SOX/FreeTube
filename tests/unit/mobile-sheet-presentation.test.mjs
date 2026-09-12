import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { computed, effectScope, nextTick, reactive, ref, shallowRef, watch } from 'vue'

const source = (await readFile(new URL('../../src/renderer/components/FtMobileSheet/FtMobileSheet.vue', import.meta.url), 'utf8'))
  .split('<script setup>')[1].split('</script>')[0].replace(/^import .*\n/gm, '')

function mountSheet(t) {
  const scope = effectScope()
  const cleanup = []
  const landscape = ref(false)
  const props = reactive({ enabled: true, open: false, belowPlayer: true })
  const player = Object.assign(new EventTarget(), {
    coversWindow: false,
    matches() { return this.coversWindow },
    setAttribute() {}, removeAttribute() {},
    getBoundingClientRect: () => ({ top: 50, bottom: 300 })
  })
  const element = {
    open: false, style: {},
    show() { this.open = true }, showModal() { this.open = true }, close() { this.open = false },
    animate: () => ({ cancel() {}, finished: Promise.resolve() }), querySelector: () => null
  }
  const dialog = shallowRef(element)
  const document = Object.assign(new EventTarget(), {
    fullscreenElement: null, activeElement: null, querySelector: () => null,
    body: { classList: { contains: () => false } }
  })
  const window = Object.assign(new EventTarget(), { scrollBy() {} })
  const events = []
  const context = {
    computed, ref, shallowRef, watch, nextTick, document, window, innerHeight: 800,
    isAppHidden: () => !!document.hidden,
    defineProps: () => props, defineEmits: () => (...args) => events.push(args),
    useTemplateRef: () => dialog, usePhoneLayout: () => landscape,
    inject: name => name === 'phonePanelPlayer' ? () => player : null,
    onBeforeUnmount: callback => cleanup.push(callback), onUpdated() {},
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    applyAnimationSpeed: animation => animation, lockBodyScroll() {}, unlockBodyScroll() {},
    matchMedia: () => ({ matches: true }), getComputedStyle: () => ({ transform: 'none', opacity: 1 })
  }
  scope.run(() => vm.runInNewContext(source + '\nglobalThis.state = { expanded, updatePresentation, sheetStyle };', context))
  t.after(() => { cleanup.forEach(callback => callback()); scope.stop() })
  return { ...context, element, player, props, landscape, events,
    async settle() { await nextTick(); await nextTick(); await nextTick() }
  }
}

for (const mode of ['native', 'browser', 'fullwindow']) {
  test(`an open below-player sheet hides during ${mode} fullscreen and returns below the player`, async t => {
    const sheet = mountSheet(t)
    sheet.props.open = true
    await sheet.settle()
    assert.equal(sheet.element.open, true)
    if (mode === 'browser') sheet.document.fullscreenElement = sheet.player
    else sheet.player.coversWindow = true
    sheet.state.updatePresentation()
    await sheet.settle()
    assert.equal(sheet.element.open, false, 'the panel must not cover fullscreen video')
    assert.equal(sheet.props.open, true, 'fullscreen must retain the selected panel')
    assert.equal(sheet.events.some(([event]) => event === 'closed'), false)
    sheet.document.fullscreenElement = null
    sheet.player.coversWindow = false
    sheet.state.updatePresentation()
    await sheet.settle()
    assert.equal(sheet.element.open, true)
    assert.equal(sheet.state.expanded.value, false)
  })
}

test('a transient landscape viewport while hidden does not maximize the returning panel', async t => {
  const sheet = mountSheet(t)
  sheet.props.open = true
  await sheet.settle()
  sheet.document.hidden = true
  sheet.document.dispatchEvent(new Event('visibilitychange'))
  sheet.landscape.value = true
  await sheet.settle()
  sheet.landscape.value = false
  sheet.document.hidden = false
  sheet.document.dispatchEvent(new Event('visibilitychange'))
  await sheet.settle()
  assert.equal(sheet.state.expanded.value, false, 'PiP must not change the panel expansion')
})

for (const expanded of [false, true]) {
  test(`PiP retains ${expanded ? 'expanded' : 'docked'} presentation while Chromium stays visible`, async t => {
    const sheet = mountSheet(t)
    sheet.props.open = true
    await sheet.settle()
    sheet.state.expanded.value = expanded
    sheet.document.body.classList.contains = () => true
    sheet.state.updatePresentation()
    await sheet.settle()
    assert.equal(sheet.element.open, false)
    sheet.landscape.value = true
    await sheet.settle()
    sheet.landscape.value = false
    sheet.document.body.classList.contains = () => false
    sheet.state.updatePresentation()
    await sheet.settle()
    assert.equal(sheet.element.open, true)
    assert.equal(sheet.state.expanded.value, expanded)
    assert.deepEqual(sheet.events.map(([event]) => event), ['suspend', 'resume'])
  })
}

test('closing a suspended panel does not reopen it on return', async t => {
  const sheet = mountSheet(t)
  sheet.props.open = true
  await sheet.settle()
  sheet.player.coversWindow = true
  sheet.state.updatePresentation()
  await sheet.settle()
  sheet.props.open = false
  await sheet.settle()
  sheet.player.coversWindow = false
  sheet.state.updatePresentation()
  await sheet.settle()
  assert.equal(sheet.element.open, false)
  assert.deepEqual(sheet.events.map(([event]) => event), ['suspend', 'closed'])
})

test('ordinary modal sheets remain available while the player is fullscreen', async t => {
  const sheet = mountSheet(t)
  sheet.props.belowPlayer = false
  sheet.player.coversWindow = true
  sheet.state.updatePresentation()
  sheet.props.open = true
  await sheet.settle()
  assert.equal(sheet.element.open, true)
  assert.deepEqual(sheet.events, [])
})
