import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { getYoutubeVideoShareUrl } from '../../src/renderer/helpers/share.js'

const source = await readFile(new URL('../../src/renderer/components/FtListVideo/FtListVideo.vue', import.meta.url), 'utf8')
const start = source.indexOf('function openVideoContextMenu(event) {')
const handler = source.slice(start, source.indexOf('\nfunction handleContextMenuKeydown', start))

function openMenu ({ electron = false, capacitor = false, media = false, selected = false, unrelatedSelection = false, touch = false } = {}) {
  const dispatched = []
  const listeners = []
  const mobileMenus = []
  const target = {
    closest: selector => selector === 'img, video' && media ? target : null,
    getBoundingClientRect: () => ({ left: 10, bottom: 30 })
  }
  const selection = {
    isCollapsed: !selected && !unrelatedSelection,
    containsNode: node => selected && node === target
  }
  const event = {
    target,
    type: touch ? 'pointerdown' : 'contextmenu',
    pointerType: touch ? 'touch' : 'mouse',
    clientX: 20,
    clientY: 40,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault () { this.defaultPrevented = true },
    stopPropagation () { this.propagationStopped = true }
  }
  const context = {
    process: { env: { IS_ELECTRON: electron, IS_CAPACITOR: capacitor } },
    window: {
      getSelection: () => selection,
      dispatchEvent: event => dispatched.push(event)
    },
    document: { addEventListener: type => listeners.push(type) },
    CustomEvent: class {
      constructor (type, options) { this.type = type; this.detail = options.detail }
    },
    cancelMenuHold () {},
    suppressMenuHoldClick () {},
    resetMenuHold () {},
    title: { value: 'Test video' },
    videoMenuOptions: { value: [{ label: 'Play Next', value: 'playNext', icon: ['fas', 'step-forward'] }] },
    openMobileContextActions: menu => mobileMenus.push(menu),
    videoContextMenuItems: { value: [{ label: 'Play Next', icon: ['fas', 'step-forward'], quickAction: true }] },
    event
  }
  vm.runInNewContext(handler + '\nopenVideoContextMenu(event)', context)
  return { event, dispatched, listeners, mobileMenus }
}

for (const capacitor of [false, true]) {
  for (const target of ['media', 'selected']) {
    test(`${capacitor ? 'Capacitor' : 'web'} preserves native ${target} actions on right click`, () => {
      const { event, dispatched, listeners } = openMenu({ capacitor, [target]: true })
      assert.equal(event.defaultPrevented, false)
      assert.equal(event.propagationStopped, false)
      assert.equal(dispatched.length, 0)
      assert.equal(listeners.length, 0, 'native interactions must not suppress the release click')
    })
  }
}

test('Electron continues merging media and selected-text actions into the video menu', () => {
  for (const target of ['media', 'selected']) {
    const { event, dispatched } = openMenu({ electron: true, [target]: true })
    assert.equal(event.defaultPrevented, true)
    assert.equal(dispatched[0].type, 'opentubex:context-menu')
    assert.equal(dispatched[0].detail.contextEvent, event)
  }
})

test('ordinary card targets retain the video menu, including with a selection elsewhere', () => {
  for (const unrelatedSelection of [false, true]) {
    const { event, dispatched } = openMenu({ unrelatedSelection })
    assert.equal(event.defaultPrevented, true)
    assert.equal(dispatched[0].type, 'opentubex:context-menu')
  }
})

for (const platform of [{}, { capacitor: true }, { electron: true }]) {
  for (const target of ['media', 'selected']) {
    test(`touch hold uses the shared bottom menu for ${target} on ${JSON.stringify(platform)}`, () => {
      const { event, dispatched, mobileMenus } = openMenu({ ...platform, [target]: true, touch: true })
      assert.equal(event.defaultPrevented, true)
      assert.equal(event.propagationStopped, true)
      assert.equal(dispatched.length, 0)
      assert.equal(mobileMenus.length, 1)
      assert.equal(mobileMenus[0].title, 'Test video')
      assert.equal(mobileMenus[0].actions.value[0].label, 'Play Next')
    })
  }
}

test('Android video menus share a public video URL and omit private playlist IDs', async () => {
  const start = source.indexOf('const videoContextMenuItems = computed(')
  const menuSource = source.slice(start, source.indexOf('const openMobileContextActions', start))
  for (const publicPlaylist of [true, false]) {
    const shared = []
    const context = {
      process: { env: { IS_CAPACITOR: true } },
      computed: get => ({ value: get() }),
      videoMenuOptions: { value: [] },
      t: key => key,
      id: { value: 'video-id' },
      playlistSharable: { value: publicPlaylist },
      playlistIdFinal: { value: publicPlaylist ? 'PL-public' : 'private-id' },
      getYoutubeVideoShareUrl,
      shareLink: url => shared.push(url)
    }
    vm.runInNewContext(menuSource + '\nvideoContextMenuItems.value.find(item => item.label === "Share.Share Link").run()', context)
    assert.deepEqual(shared, [publicPlaylist ? 'https://youtu.be/video-id?list=PL-public' : 'https://youtu.be/video-id'])
  }
})
