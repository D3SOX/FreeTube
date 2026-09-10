import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
function method(name, next) {
  return source.slice(source.indexOf(`    ${name}:`), source.indexOf(`    ${next}`))
}

for (const android of [false, true]) {
  for (const backend of ['Local', 'Invidious']) {
    for (const mode of ['video', 'audio']) {
      test(`${android ? 'Android' : 'Electron'} ${backend} plays downloaded ${mode} without waiting for metadata`, async () => {
        let requests = 0
        const pendingMetadata = () => { requests++; return new Promise(() => {}) }
        const methods = runInNewContext(`({
          ${method('applyDownloadedPlaybackSource', 'cacheOnlinePlaybackSource')}
          ${method('finishDownloadedPlaybackWithoutMetadata', 'onMountedDependOnLocalStateLoading()')}
          ${method('getVideoInformationLocal', 'getVideoInformationInvidious')}
          ${method('getVideoInformationInvidious', 'async runIpBlockRecoveryScriptAndReload()')}
        })`, {
          process: { env: { IS_CAPACITOR: android } },
          Capacitor: { convertFileSrc: path => `https://localhost/_capacitor_file_${path}` },
          DOWNLOADED_MEDIA_MIME_TYPES: { mp4: 'video/mp4' },
          getConnectionState: () => 'offline',
          getLocalVideoInfo: pendingMetadata,
          invidiousGetVideoInformation: pendingMetadata,
        })
        const watch = {
          ...methods,
          firstLoad: true,
          isLoading: true,
          videoLoadGeneration: 0,
          videoId: 'downloaded1',
          tabRoute: { params: { id: 'downloaded1' }, query: { downloadId: '1' } },
          $store: { getters: { getYtDlpDownloads: { 1: {
            id: 1, videoId: 'downloaded1', title: 'Offline video', status: 'completed', mode,
            files: [{ path: android ? 'content://downloads/document/1' : '/downloads/video.mp4', videoId: 'downloaded1', extension: 'mp4', duration: 42 }],
          } } } },
          playbackSourceKey: 0,
          cacheOnlinePlaybackSource() {},
          updateTitle() {},
          t: key => key,
        }
        watch[`getVideoInformation${backend}`]()
        await Promise.resolve()
        assert.equal(watch.isLoading, false, 'local playback must not wait for a metadata request that stays queued offline')
        assert.equal(watch.localFilePlayback, true)
        assert.equal(watch.videoTitle, 'Offline video')
        assert.equal(watch.videoLengthSeconds, 42)
        const url = mode === 'audio' ? watch.manifestSrc : watch.legacyFormats[0].url
        assert.equal(url, android ? 'content://downloads/document/1' : 'downloadmedia://file/1/downloaded1')
        assert.equal(requests, 0)
      })
    }
  }
}

for (const backend of ['Local', 'Invidious']) {
  test(`${backend} keeps online metadata and switches to the download if the connection fails`, async () => {
    let resolveMetadata
    let requests = 0
    const pendingMetadata = () => { requests++; return new Promise(resolve => { resolveMetadata = resolve }) }
    const methods = runInNewContext(`({
      ${method('getVideoInformationLocal', 'getVideoInformationInvidious')}
      ${method('getVideoInformationInvidious', 'async runIpBlockRecoveryScriptAndReload()')}
      ${source.slice(source.indexOf('    handleDownloadConnectionChange('), source.indexOf('    updateAndroidBackgroundPlaybackFormat()'))}
    })`, {
      getConnectionState: () => 'online',
      getLocalVideoInfo: pendingMetadata,
      invidiousGetVideoInformation: pendingMetadata,
    })
    let localLoads = 0
    const watch = {
      ...methods,
      firstLoad: true,
      isLoading: true,
      videoLoadGeneration: 0,
      tabRoute: { params: { id: 'downloaded1' } },
      finishDownloadedPlaybackWithoutMetadata() { localLoads++; this.isLoading = false; this.localFilePlayback = true; return true },
      isCurrentVideoLoad(generation) { return generation === this.videoLoadGeneration },
    }
    watch[`getVideoInformation${backend}`]()
    await Promise.resolve()
    assert.equal(requests, 1, 'online downloads retain their normal metadata request')
    assert.equal(localLoads, 0)
    watch.handleDownloadConnectionChange({ detail: 'offline' })
    assert.equal(localLoads, 1)
    assert.equal(watch.isLoading, false)
    assert.equal(watch.localFilePlayback, true)
    assert.equal(watch.videoLoadGeneration, 2, 'the pending metadata load can no longer replace local playback')
    resolveMetadata({})
    for (let i = 0; i < 5; i++) await Promise.resolve()
    assert.equal(localLoads, 1)
    watch.handleDownloadConnectionChange({ detail: 'offline' })
    assert.equal(localLoads, 1, 'connection updates do not restart an already playing file')
  })
}
