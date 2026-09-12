import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { registerHooks } from 'node:module'
import test from 'node:test'

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(`
        export const BrowserWindow = {}, ipcMain = {}, nativeImage = {}, shell = {};
        export const app = { getName: () => 'OpenTubeX' };
      `) }
    }
    if (specifier.endsWith('/datastores/handlers/base.js')) {
      return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(`
        export const settings = { _findOne: async () => null };
        export const tabSession = {
          saved: null,
          async save(id, data) { this.saved = structuredClone(data); }
        };
      `) }
    }
    return nextResolve(specifier, context)
  }
})
const { TabManager } = await import('../../src/main/tabs/TabManager.js')
const { tabSession } = await import('../../src/datastores/handlers/base.js')
hooks.deregister()
const { createTabAvatarFileName } = await import('../../src/main/tabs/tabPreviewCache.js')

function createManager(t) {
  const window = new EventEmitter()
  window.id = 1
  window.webContents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    setWindowOpenHandler() {},
    send() {}
  })
  window.setTitle = () => {}
  window.getBounds = () => ({ x: 0, y: 0, width: 1200, height: 800 })
  window.isDestroyed = () => false
  window.isMaximized = () => false
  window.isFullScreen = () => false
  const manager = new TabManager(window, 'app://bundle/index.html')
  manager._tabPreviewsEnabled = false
  t.after(() => {
    window.isDestroyed = () => true
    window.emit('closed')
  })
  return manager
}

function session(count) {
  return {
    tabs: Array.from({ length: count }, (_, index) => ({
      id: `tab-${index}`,
      url: 'app://bundle/index.html#/history',
      title: `History ${index}`,
      isUnloaded: false
    })),
    activeTabId: `tab-${count - 1}`
  }
}

test('foreground tabs become selected before their content mounts', async t => {
  const manager = createManager(t)
  const original = manager.createTab({ route: '/history' })
  presentActive(manager)

  const tab = await manager.createTabWithPreference({ route: '/subscriptions', makeActive: true })
  assert.equal(tab.loadState, 'mounting')
  assert.equal(manager.activeTabId, tab.id)
  assert.equal(manager.presentedTabId, original.id, 'keeps the previous content until the new content is ready')

  manager.markTabMounted(tab.id, tab.mountRevision)
  manager.markTabPresented(tab.id, manager.selectionRevision)
  assert.equal(manager.presentedTabId, tab.id)
})

test('slow foreground tab mounts cannot steal a newer selection', async t => {
  const manager = createManager(t)
  const original = manager.createTab({ route: '/history' })
  presentActive(manager)
  const first = await manager.createTabWithPreference({ route: '/subscriptions', makeActive: true })
  const second = await manager.createTabWithPreference({ route: '/about', makeActive: true })
  assert.equal(manager.activeTabId, second.id)

  manager.markTabMounted(second.id, second.mountRevision)
  manager.markTabMounted(first.id, first.mountRevision)
  assert.equal(manager.activeTabId, second.id)

  const third = await manager.createTabWithPreference({ route: '/playlists', makeActive: true })
  manager.activateTab(original.id)
  manager.markTabMounted(third.id, third.mountRevision)
  assert.equal(manager.activeTabId, original.id)
})

test('background tab creation and mounting preserve the selected tab', async t => {
  const manager = createManager(t)
  const original = manager.createTab({ route: '/history' })
  presentActive(manager)
  const tab = await manager.createTabWithPreference({ route: '/subscriptions', makeActive: false })
  assert.equal(manager.activeTabId, original.id)
  manager.markTabMounted(tab.id, tab.mountRevision)
  assert.equal(manager.activeTabId, original.id)
})

test('restoring many tabs serializes only one initial renderer snapshot', async t => {
  const manager = createManager(t)
  const getState = manager.getState.bind(manager)
  let serializedTabs = 0
  manager.getState = (...args) => {
    const state = getState(...args)
    serializedTabs += state.tabs.length
    return state
  }
  const started = performance.now()
  await manager.restoreFromData(session(100), { restoreTabLoadState: true })
  t.diagnostic(`100 tabs: ${(performance.now() - started).toFixed(1)} ms, ${serializedTabs} serialized tab records`)
  assert.equal(serializedTabs, 100)
})

test('restored background pages do not compete with the initial selected page mount', async t => {
  const manager = createManager(t)
  await manager.restoreFromData(session(10), { restoreTabLoadState: true })
  assert.deepEqual([...manager.tabs.values()].filter(tab => tab.loadState === 'mounting' && !tab.mountDeferred).map(tab => tab.id), ['tab-9'])
  assert.ok(manager.getSyncSession().tabs.every(tab => !tab.isUnloaded), 'queued tabs keep their saved loaded state')
})

for (const persistence of ['disk', 'sync']) {
  test(`restarting from ${persistence} while the selected video loads preserves background video load state`, async t => {
    const manager = createManager(t)
    const saved = session(4)
    saved.tabs[0].url = 'app://bundle/index.html#/watch/background'
    saved.tabs[2].url = 'app://bundle/index.html#/watch/unloaded'
    saved.tabs[2].isUnloaded = true
    saved.tabs[3].url = 'app://bundle/index.html#/watch/selected'
    await manager.restoreFromData(saved, { restoreTabLoadState: true })
    await manager._saveSession()
    const snapshot = persistence === 'disk' ? tabSession.saved : manager.getSyncSession()
    assert.deepEqual(snapshot.tabs.map(tab => tab.isUnloaded), [false, false, true, false])
    const restarted = createManager(t)
    await restarted.restoreFromData(snapshot, { restoreTabLoadState: true })
    restarted.setTabLoading('tab-3', true)
    restarted.setTabLoading('tab-3', false)
    await new Promise(setImmediate)
    assert.notEqual(restarted.tabs.get('tab-0').loadState, 'unloaded')
    assert.equal(restarted.tabs.get('tab-2').loadState, 'unloaded')
  })
}

for (const action of ['unload', 'load', 'reload']) {
  test(`${action} overrides a deferred startup video's saved load state`, async t => {
    const manager = createManager(t)
    const saved = session(2)
    for (const tab of saved.tabs) tab.url = `app://bundle/index.html#/watch/${tab.id}`
    await manager.restoreFromData(saved, { restoreTabLoadState: true })
    if (action === 'unload') {
      assert.equal(await manager.unloadTab('tab-0'), true)
    } else {
      if (action === 'load') manager.loadTab('tab-0')
      else manager.reloadTab('tab-0')
      const tab = manager.tabs.get('tab-0')
      manager.markTabMountFailed(tab.id, tab.mountRevision)
    }
    manager.setTabLoading('tab-1', true)
    manager.setTabLoading('tab-1', false)
    await new Promise(setImmediate)
    assert.equal(manager.tabs.get('tab-0').loadState, 'unloaded')
    await manager._saveSession()
    assert.equal(tabSession.saved.tabs[0].isUnloaded, true)
    assert.equal(manager.getSyncSession().tabs[0].isUnloaded, true)
  })
}

async function tick(t, milliseconds = 50) {
  t.mock.timers.tick(milliseconds)
  await new Promise(setImmediate)
}

function presentActive(manager) {
  const tab = manager.tabs.get(manager.activeTabId)
  manager.markTabMounted(tab.id, tab.mountRevision)
  manager.markTabPresented(tab.id, manager.selectionRevision)
}

test('loads background pages one at a time after presentation and mount acknowledgement', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const manager = createManager(t)
  await manager.restoreFromData(session(4), { restoreTabLoadState: true })
  await tick(t, 1000)
  assert.equal(manager.tabs.get('tab-0').mountDeferred, true)
  presentActive(manager)
  await tick(t)
  assert.equal(manager.tabs.get('tab-0').mountDeferred, false)
  assert.equal(manager.tabs.get('tab-1').mountDeferred, true)
  await tick(t, 1000)
  assert.equal(manager.tabs.get('tab-1').mountDeferred, true, 'waits for slow mount')
  manager.markTabMounted('tab-0', 1)
  await tick(t, 0)
  await tick(t)
  assert.equal(manager.tabs.get('tab-1').mountDeferred, false)
  manager.markTabMountFailed('tab-1', 1)
  await tick(t, 0)
  await tick(t)
  assert.equal(manager.tabs.get('tab-2').mountDeferred, false, 'continues after failure')
  manager.markTabMounted('tab-2', 1)
  await tick(t, 0)
  assert.equal(manager._startupMountQueue.size, 0)
})

test('selecting or reloading a queued tab bypasses the startup queue', async t => {
  const manager = createManager(t)
  await manager.restoreFromData(session(4), { loadInactiveTabs: true })
  manager.activateTab('tab-2')
  assert.equal(manager.tabs.get('tab-2').mountDeferred, false)
  assert.equal(manager.activeTabId, 'tab-2')
  assert.equal(manager._startupMountQueue.has('tab-2'), false)
  manager.reloadTab('tab-1')
  assert.equal(manager.tabs.get('tab-1').mountDeferred, false)
  assert.equal(manager._startupMountQueue.has('tab-1'), false)
})

test('skips tabs unloaded while queued and preserves originally unloaded tabs', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const manager = createManager(t)
  const saved = session(4)
  saved.tabs[1].isUnloaded = true
  await manager.restoreFromData(saved, { restoreTabLoadState: true })
  await manager.unloadTab('tab-0')
  presentActive(manager)
  await tick(t)
  assert.equal(manager.tabs.get('tab-0').loadState, 'unloaded')
  assert.equal(manager.tabs.get('tab-1').loadState, 'unloaded')
  assert.equal(manager.tabs.get('tab-2').mountDeferred, false)
  assert.deepEqual(manager.getSyncSession().tabs.map(tab => tab.isUnloaded), [true, true, false, false])
})

test('unloading a background tab during its mount releases the next queued tab', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const manager = createManager(t)
  await manager.restoreFromData(session(3), { restoreTabLoadState: true })
  presentActive(manager)
  await tick(t)
  assert.equal(manager.tabs.get('tab-0').mountDeferred, false)
  await manager.unloadTab('tab-0')
  await tick(t, 0)
  await tick(t)
  assert.equal(manager.tabs.get('tab-1').mountDeferred, false)
})

test('a missing selected tab falls back to a tab that can mount immediately', async t => {
  const manager = createManager(t)
  const saved = session(4)
  saved.activeTabId = 'missing'
  await manager.restoreFromData(saved, { restoreTabLoadState: true })
  assert.equal(manager.activeTabId, 'tab-0')
  assert.equal(manager.tabs.get('tab-0').mountDeferred, false)
})

test('a stalled mount cannot block the rest of the session forever', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const manager = createManager(t)
  await manager.restoreFromData(session(3), { restoreTabLoadState: true })
  presentActive(manager)
  await tick(t)
  await tick(t, 8000)
  await tick(t)
  assert.equal(manager.tabs.get('tab-1').mountDeferred, false)
})

test('reads each shared avatar once and starts independent reads together', async t => {
  const manager = createManager(t)
  const saved = session(4)
  const avatar = createTabAvatarFileName(Buffer.from('avatar'))
  const missingAvatar = createTabAvatarFileName(Buffer.from('missing'))
  saved.tabs[0].avatarFileName = avatar
  saved.tabs[1].avatarFileName = avatar
  saved.tabs[2].avatarFileName = missingAvatar
  const reads = new Map()
  manager._loadTabPreviewDataUrl = fileName => {
    assert.ok(!reads.has(fileName), 'shared file is read only once')
    return new Promise(resolve => reads.set(fileName, resolve))
  }
  const restored = manager.restoreFromData(saved)
  await new Promise(setImmediate)
  assert.deepEqual([...reads.keys()], [avatar, missingAvatar])
  const dataUrl = 'data:image/jpeg;base64,YXZhdGFy'
  reads.get(avatar)(dataUrl)
  reads.get(missingAvatar)(null)
  await restored
  assert.equal(manager.tabs.get('tab-0').avatarDataUrl, dataUrl)
  assert.equal(manager.tabs.get('tab-1').avatarDataUrl, dataUrl)
  assert.equal(manager.tabs.get('tab-2').avatarFileName, null)
})

test('closing the window cancels pending background mounts', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const manager = createManager(t)
  await manager.restoreFromData(session(3), { loadInactiveTabs: true })
  presentActive(manager)
  manager.browserWindow.isDestroyed = () => true
  manager.browserWindow.emit('closed')
  await tick(t, 10_000)
  assert.equal(manager.tabs.get('tab-0').mountDeferred, true)
  assert.equal(manager._pendingTabMountWaiters.size, 0)
})

for (const existingLanding of [false, true]) {
  test(`landing-page startup ${existingLanding ? 'reuses an existing tab' : 'adds a tab'} and unloads every other tab`, async t => {
    const manager = createManager(t)
    t.mock.method(TabManager, 'getStoredLandingRoute', async () => '/subscriptions')
    const saved = session(3)
    saved.tabs[0].title = ''
    if (existingLanding) {
      saved.tabs[1].url = 'app://bundle/index.html#/subscriptions'
      saved.tabs[1].isUnloaded = true
      saved.tabs[1].isPinned = true
    }
    await manager.restoreFromData(saved, { loadLandingPage: true })
    const tabs = [...manager.tabs.values()]
    assert.equal(tabs.length, existingLanding ? 3 : 4)
    const active = manager.tabs.get(manager.activeTabId)
    assert.equal(TabManager.getRouteFromUrl(active.url).path, '/subscriptions')
    assert.equal(active.loadState, 'mounting')
    if (existingLanding) {
      assert.equal(active.id, 'tab-1')
      assert.equal(active.isPinned, true)
    }
    assert.ok(tabs.filter(tab => tab !== active).every(tab => tab.loadState === 'unloaded'))
    presentActive(manager)
    assert.equal(manager._startupMountQueue.size, 0)
    assert.deepEqual(saved.tabs.map(tab => tab.id), ['tab-0', 'tab-1', 'tab-2'])
  })
}

test('landing-page startup selects only the first matching tab', async t => {
  const manager = createManager(t)
  t.mock.method(TabManager, 'getStoredLandingRoute', async () => '/history')
  await manager.restoreFromData(session(3), { loadLandingPage: true })
  assert.equal(manager.activeTabId, 'tab-0')
  assert.equal(manager.tabs.size, 3)
  assert.deepEqual([...manager.tabs.values()].map(tab => tab.loadState), ['mounting', 'unloaded', 'unloaded'])
})

test('group icons are validated, updated and restored from session metadata', t => {
  const manager = createManager(t)
  const group = manager.createTabGroup({ name: 'Research', icon: 'bookmark' })
  assert.equal(group.icon, 'bookmark')
  assert.equal(manager.updateTabGroup(group.id, { icon: 'flask' }), true)
  assert.equal(manager.tabGroups.get(group.id).icon, 'flask')
  manager._restoreTabGroups([...manager.tabGroups.values()])
  assert.equal(manager.tabGroups.get(group.id).icon, 'flask')
  manager.updateTabGroup(group.id, { icon: '../invalid.svg' })
  assert.equal(manager.tabGroups.get(group.id).icon, 'layer-group')
})
