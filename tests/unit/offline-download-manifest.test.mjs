import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
const connectionHandler = source.slice(source.indexOf('    handleDownloadConnectionChange('), source.indexOf('    updateAndroidBackgroundPlaybackFormat()'))

for (const expression of ['createLocalDashManifest(result, true)', 'createLocalDashManifest(result)', 'createInvidiousDashManifest(result)']) {
  test(`late ${expression} does not replace downloaded audio after connection loss`, async () => {
    const awaitIndex = source.indexOf(`await this.${expression}`)
    assert.notEqual(awaitIndex, -1)
    const start = source.lastIndexOf('\n', awaitIndex) + 1
    const end = source.indexOf('this.manifestMimeType = MANIFEST_TYPE_DASH', awaitIndex) + 'this.manifestMimeType = MANIFEST_TYPE_DASH'.length
    const { load, handleDownloadConnectionChange } = runInNewContext(`({
      ${connectionHandler}
      async load(loadGeneration, videoId) {
        ${source.slice(start, end)}
      }
    })`, { result: {}, MANIFEST_TYPE_DASH: 'application/dash+xml' })
    let resolveManifest
    const createManifest = () => new Promise(resolve => { resolveManifest = resolve })
    const watch = {
      load,
      handleDownloadConnectionChange,
      videoLoadGeneration: 1,
      isLoading: true,
      localFilePlayback: false,
      createLocalDashManifest: createManifest,
      createInvidiousDashManifest: createManifest,
      isCurrentVideoLoad(generation) { return generation === this.videoLoadGeneration },
      finishDownloadedPlaybackWithoutMetadata() {
        this.manifestSrc = 'content://downloads/document/audio'
        this.manifestMimeType = 'audio/mp4'
        this.localFilePlayback = true
        this.isLoading = false
        return true
      },
    }
    const pendingLoad = watch.load(1, 'downloaded1')
    watch.handleDownloadConnectionChange({ detail: 'offline' })
    resolveManifest('data:application/dash+xml,online-manifest')
    await pendingLoad
    assert.equal(watch.manifestSrc, 'content://downloads/document/audio')
    assert.equal(watch.manifestMimeType, 'audio/mp4')
  })
}

test('a stale failed DVR manifest does not fall back to an online source', async () => {
  const awaitIndex = source.indexOf('await this.createLocalDashManifest(result, true)')
  const start = source.lastIndexOf('try {', awaitIndex)
  const end = source.indexOf('          if (useRemoteManifest)', awaitIndex)
  const { load } = runInNewContext(`({
    async load(loadGeneration, videoId) {
      let useRemoteManifest = true
      ${source.slice(start, end).replace(/\s*}\s*}\s*$/, '')}
      return useRemoteManifest
    }
  })`, { result: {}, MANIFEST_TYPE_DASH: 'application/dash+xml', console: { error() {} } })
  let rejectManifest
  const watch = {
    load,
    videoLoadGeneration: 1,
    createLocalDashManifest: () => new Promise((resolve, reject) => { rejectManifest = reject }),
    isCurrentVideoLoad(generation) { return generation === this.videoLoadGeneration },
  }
  const pendingLoad = watch.load(1, 'downloaded1')
  watch.videoLoadGeneration++
  rejectManifest(new Error('offline'))
  assert.equal(await pendingLoad, undefined, 'a superseded load must return before selecting a remote fallback')
})

for (const backend of ['Local', 'Invidious']) {
  test(`late ${backend} recovery completion does not restart downloaded playback`, async () => {
    const loaderStart = source.indexOf(`    getVideoInformation${backend}:`)
    const loaderEnd = source.indexOf(backend === 'Local' ? '    getVideoInformationInvidious:' : '    async runIpBlockRecoveryScriptAndReload()', loaderStart)
    const loader = source.slice(loaderStart, loaderEnd)
    const start = loader.lastIndexOf('const didReload = await this.runIpBlockRecoveryScriptAndReload()')
    const end = loader.indexOf('if (this.finishDownloadedPlaybackWithoutMetadata()) return', start) + 'if (this.finishDownloadedPlaybackWithoutMetadata()) return'.length
    const { recover, handleDownloadConnectionChange } = runInNewContext(`({
      ${connectionHandler}
      async recover(loadGeneration, videoId) {
        ${loader.slice(start, end)}
      }
    })`)
    let resolveRecovery
    let localLoads = 0
    const watch = {
      recover,
      handleDownloadConnectionChange,
      videoLoadGeneration: 1,
      isLoading: true,
      localFilePlayback: false,
      runIpBlockRecoveryScriptAndReload: () => new Promise(resolve => { resolveRecovery = resolve }),
      isCurrentVideoLoad(generation) { return generation === this.videoLoadGeneration },
      finishDownloadedPlaybackWithoutMetadata() {
        localLoads++
        this.localFilePlayback = true
        this.isLoading = false
        return true
      },
    }
    const pendingRecovery = watch.recover(1, 'downloaded1')
    watch.handleDownloadConnectionChange({ detail: 'offline' })
    resolveRecovery(false)
    await pendingRecovery
    assert.equal(localLoads, 1)
  })
}

test('finishing an IP recovery script cannot reload a superseded offline download', async () => {
  let resolveScript
  let reloads = 0
  const { runIpBlockRecoveryScriptAndReload } = runInNewContext(`({
    ${source.slice(source.indexOf('    async runIpBlockRecoveryScriptAndReload()'), source.indexOf('    extractExpiryDateFromStreamingUrl:'))}
  })`, {
    process: { env: { IS_ELECTRON: true } },
    window: { ftElectron: {
      startIpBlockRecoveryScript: async () => true,
      executeIpBlockRecoveryScript: () => new Promise(resolve => { resolveScript = resolve }),
    } },
    showToastOnAllTabs() {},
  })
  const watch = {
    ipBlockDetectedInCurrentChain: true,
    ipBlockRecoveryAttemptedForCurrentVideo: false,
    videoIpBlockScriptPath: '/recovery-script',
    videoLoadGeneration: 1,
    videoId: 'downloaded1',
    isCurrentVideoLoad(generation) { return generation === this.videoLoadGeneration },
    t: key => key,
    showTabToast() {},
    async reloadView() { reloads++ },
  }
  const pending = runIpBlockRecoveryScriptAndReload.call(watch)
  for (let i = 0; i < 5; i++) await Promise.resolve()
  watch.videoLoadGeneration++
  resolveScript({ exitCode: 0 })
  assert.equal(await pending, false)
  assert.equal(reloads, 0)
})
