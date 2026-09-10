import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

const source = await readFile(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
for (const method of ['getVideoInformationLocal', 'getVideoInformationInvidious']) {
  test(`${method} opens a downloaded file offline without waiting for metadata`, async () => {
    const start = source.indexOf(`    ${method}:`)
    const end = source.indexOf('\n    },', start)
    const context = vm.createContext({ navigator: { onLine: false }, getConnectionState: () => 'offline', initializeNetworkRecovery: () => ({ ready: Promise.resolve(false) }),
      getLocalVideoInfo: () => new Promise(() => {}),
      invidiousGetVideoInformation: () => new Promise(() => {}) })
    const load = vm.runInContext(`({ ${source.slice(start, end)}\n} }).${method}`, context)
    let opened = false
    const watch = { isCurrentVideoLoad: () => true, firstLoad: true, videoLoadGeneration: 0, tabRoute: { params: { id: 'video' } },
      finishDownloadedPlaybackWithoutMetadata() { opened = true; this.isLoading = false; return true } }
    load.call(watch)
    for (let i = 0; i < 10; i++) await Promise.resolve()
    assert.equal(opened, true)
    assert.equal(watch.isLoading, false)
  })
}

for (const method of ['getVideoInformationLocal', 'getVideoInformationInvidious']) {
  test(`${method} does not apply an obsolete video load after waiting for connectivity`, async () => {
    let ready
    const pending = new Promise(resolve => { ready = resolve })
    const context = vm.createContext({ getConnectionState: () => 'offline', initializeNetworkRecovery: () => ({ ready: pending }) })
    const start = source.indexOf(`    ${method}:`)
    const end = source.indexOf('\n    },', start)
    const load = vm.runInContext(`({ ${source.slice(start, end)}\n} }).${method}`, context)
    const watch = { firstLoad: true, videoLoadGeneration: 0, tabRoute: { params: { id: 'old-video' } },
      isCurrentVideoLoad: (generation, id) => id === 'new-video',
      finishDownloadedPlaybackWithoutMetadata: () => assert.fail('An obsolete video load was applied') }
    const loading = load.call(watch)
    watch.tabRoute.params.id = 'new-video'
    ready(false)
    await loading
  })
}
