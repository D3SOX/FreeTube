import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../src/renderer/helpers/utils.js', import.meta.url), 'utf8')
const saveSource = source.match(/export async function writeFileWithPicker\([\s\S]*?^\}/m)[0].replace('export ', '')

function loadPicker(saveAndroidFile, overrides = {}) {
  return vm.runInNewContext(`${saveSource}\nwriteFileWithPicker`, {
    process: { env: { IS_CAPACITOR: true } },
    window: {},
    Blob,
    URL: { createObjectURL: () => 'blob:screenshot', revokeObjectURL() {} },
    document: { createElement: () => ({ click() {} }) },
    setTimeout: callback => callback(),
    saveAndroidFile,
    ...overrides,
  })
}

test('Android screenshot saving reaches native file export with the original filename and PNG bytes', async () => {
  const calls = []
  const image = new Blob(['PNG bytes'], { type: 'image/png' })
  const save = loadPicker(async (...args) => { calls.push(args); return true })

  assert.equal(await save('Screenshot ä.png', image, 'PNG', 'image/png', '.png'), true)
  assert.deepEqual(calls, [['Screenshot ä.png', image, 'image/png', undefined]])
})

test('canceling the native save picker does not report a saved screenshot', async () => {
  const save = loadPicker(async () => false)
  assert.equal(await save('screenshot.png', new Blob(['PNG']), 'PNG', 'image/png', '.png'), false)
})

test('native export errors reach the caller instead of reporting success', async () => {
  const error = new Error('Disk full')
  const save = loadPicker(async () => { throw error })
  await assert.rejects(save('theme.json', '{}', 'JSON', 'application/json', '.json'), error)
})

test('passes the folder selected in settings to native export', async () => {
  const calls = []
  const save = loadPicker(async (...args) => { calls.push(args); return true })
  const directory = 'content://documents/tree/primary%3APictures%2FScreenshots'
  await save('screenshot.png', 'data', 'PNG', 'image/png', '.png', 'player-screenshots', 'pictures', directory)
  assert.deepEqual(calls, [['screenshot.png', 'data', 'image/png', directory]])
})

const storageSource = (await readFile(new URL('../../src/renderer/helpers/androidStorage.js', import.meta.url), 'utf8'))
  .replace(/^import .*\n/gm, '').replace(/^export /gm, '')

for (const [name, mimeType, content] of [
  ['screenshot.png', 'image/png', new Blob([new Uint8Array([0, 128, 255])], { type: 'image/png' })],
  ['transcript.txt', 'text/plain', 'Grüße 日本語 🎥\n'],
  ['theme.json', 'application/json', '{"name":"Grün"}\n'],
  ['playlist.csv', 'text/csv', 'Video ID,Timestamp\nabc,2026-01-01\n'],
  ['profiles.db', 'application/x-freetube-db', '{"name":"Öffentlich"}\n'],
  ['empty.txt', 'text/plain', ''],
]) {
  test(`native export preserves the exact bytes of ${name}`, async () => {
    const writes = []
    const save = vm.runInNewContext(`${storageSource}\nsaveAndroidFile`, {
      process: { env: { IS_CAPACITOR: true } },
      Blob,
      blobToDataUrl: async blob => `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`,
      registerPlugin: () => ({ saveFile: async options => { writes.push(options); return { saved: true } } }),
    })
    assert.equal(await save(name, content, mimeType, 'content://documents/tree/exports'), true)
    assert.equal(writes[0].fileName, name)
    assert.equal(writes[0].mimeType, mimeType)
    assert.equal(writes[0].directory, 'content://documents/tree/exports')
    const expected = content instanceof Blob ? Buffer.from(await content.arrayBuffer()) : Buffer.from(content)
    assert.deepEqual(Buffer.from(writes[0].data, 'base64'), expected)
  })
}

const playerSource = await readFile(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
const screenshotSource = playerSource.split('// #region screenshots')[1].split('// #endregion screenshots')[0]

function loadScreenshot({ directory = 'content://documents/tree/screenshots', chosenDirectory, mode = 'default_folder' } = {}) {
  const saved = []
  const settings = []
  const toasts = []
  const video = { videoWidth: 1920, videoHeight: 1080, currentTime: 10, paused: false, pauseCalls: 0, pause() { this.paused = true; this.pauseCalls++ }, play() { this.paused = false } }
  const image = new Blob(['frame'], { type: 'image/png' })
  const takeScreenshot = vm.runInNewContext(`${screenshotSource}\ntakeScreenshot`, {
    process: { env: { IS_CAPACITOR: true } },
    video: { value: video },
    capturePlayerFrame: async source => source,
    screenshotMode: { value: mode },
    screenshotFormat: { value: 'png' },
    screenshotQuality: { value: 95 },
    props: { videoId: 'video' },
    store: {
      getters: { getScreenshotFolderPath: directory },
      dispatch: async (action, value) => {
        if (action === 'parseScreenshotCustomFileName') return 'frame'
        settings.push([action, value])
      },
    },
    chooseAndroidDirectory: async () => chosenDirectory,
    writeFileWithPicker: async (...args) => { saved.push(args); return true },
    showToast: toast => toasts.push(toast.message),
    t: key => key,
    console,
    document: { createElement: () => ({ getContext: () => ({ drawImage() {} }), toBlob: callback => callback(image), remove() {} }) },
  })
  return { takeScreenshot, saved, settings, video, toasts }
}

test('the player saves screenshots automatically to its configured Android folder', async () => {
  const state = loadScreenshot()
  await state.takeScreenshot()
  assert.equal(state.saved[0][7], 'content://documents/tree/screenshots')
  assert.deepEqual(state.settings, [])
  assert.deepEqual(state.toasts, ['Screenshot Success'])
  assert.equal(state.video.paused, false)
  assert.equal(state.video.pauseCalls, 0)
})

test('the first automatic screenshot asks for a folder and remembers the selection', async () => {
  const state = loadScreenshot({ directory: '', chosenDirectory: 'content://documents/tree/new' })
  await state.takeScreenshot()
  assert.deepEqual(state.settings, [['updateScreenshotFolderPath', 'content://documents/tree/new']])
  assert.equal(state.saved[0][7], 'content://documents/tree/new')
})

test('canceling initial folder selection saves nothing and restores playback', async () => {
  const state = loadScreenshot({ directory: '' })
  await state.takeScreenshot()
  assert.deepEqual(state.saved, [])
  assert.deepEqual(state.toasts, [])
  assert.equal(state.video.paused, false)
})

test('ask-path mode uses the save picker instead of the automatic screenshot folder', async () => {
  const state = loadScreenshot({ mode: 'prompt_folder' })
  await state.takeScreenshot()
  assert.equal(state.saved[0][7], undefined)
})

test('Android screenshot settings offer automatic saving and persist the chosen folder', async () => {
  const source = await readFile(new URL('../../src/renderer/components/PlayerSettings/PlayerSettings.vue', import.meta.url), 'utf8')
  const fragment = source.slice(source.indexOf('const screenshotModeNames'), source.indexOf('const screenshotFilenamePattern'))
  const changes = []
  const controls = vm.runInNewContext(`${fragment}\n({ screenshotModeValues, chooseScreenshotFolder })`, {
    process: { env: { IS_CAPACITOR: true } },
    computed: callback => ({ get value() { return callback() } }),
    t: key => key,
    store: { getters: {}, dispatch: async (...args) => changes.push(args) },
    chooseAndroidDirectory: async () => 'content://documents/tree/chosen',
    showToast: () => assert.fail('Selecting a valid folder should succeed'),
  })
  assert.ok(controls.screenshotModeValues.value.includes('default_folder'))
  await controls.chooseScreenshotFolder()
  assert.deepEqual(changes, [['updateScreenshotFolderPath', 'content://documents/tree/chosen']])
})

test('desktop save dialogs still write and close their file stream', async () => {
  const writes = []
  const save = loadPicker(() => assert.fail('Desktop must not call the Android bridge'), {
    process: { env: { IS_ELECTRON: true } },
    window: { showSaveFilePicker: async () => ({ createWritable: async () => ({
      write: async data => writes.push(data), close: async () => writes.push('closed'),
    }) }) },
  })
  assert.equal(await save('theme.json', '{}', 'JSON', 'application/json', '.json'), true)
  assert.deepEqual(writes, ['{}', 'closed'])
})
