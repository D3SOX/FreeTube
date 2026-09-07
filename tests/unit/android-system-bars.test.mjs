import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../src/renderer/App.vue', import.meta.url), 'utf8')
const start = source.indexOf('function updateSystemBarsStyle() {')
const updateSource = source.slice(start, source.indexOf('\nfunction updateAppFont', start))

test('status bar contrast uses the theme color while native video makes the WebView transparent', () => {
  const calls = []
  const backgrounds = []
  let theme = '#f1f1f1'
  const update = vm.runInNewContext(`${updateSource}\nupdateSystemBarsStyle`, {
    Capacitor: { isNativePlatform: () => true, isPluginAvailable: () => true },
    document: { body: {} },
    getComputedStyle: () => ({ backgroundColor: 'rgba(0, 0, 0, 0)', getPropertyValue: name => name === '--bg-color' ? theme : '' }),
    calculateColorLuminance: color => color === '#f1f1f1' ? '#000000' : '#FFFFFF',
    setAndroidSystemBarsBackground: color => { backgrounds.push(color); return Promise.resolve() },
    SystemBars: { setStyle: options => { calls.push(options.style); return Promise.resolve() } },
    SystemBarType: { StatusBar: 'status' }, SystemBarsStyle: { Light: 'light', Dark: 'dark' }
  })
  update()
  theme = '#111111'
  update()
  assert.deepEqual(calls, ['light', 'dark'])
  assert.deepEqual(backgrounds, ['#f1f1f1', '#111111'])
})

test('native inset colors expand short hex and skip platforms without AndroidUi', async () => {
  const source = (await readFile(new URL('../../src/renderer/helpers/androidUi.js', import.meta.url), 'utf8'))
    .replace(/^import .*\n/gm, '').replace(/^export /gm, '')
  const calls = []
  let platform = 'android'
  const update = vm.runInNewContext(`${source}\nsetAndroidSystemBarsBackground`, {
    process: { env: { IS_CAPACITOR: true } },
    Capacitor: { getPlatform: () => platform },
    registerPlugin: () => ({ setSystemBarsBackground: options => { calls.push(options.color); return Promise.resolve() } })
  })
  await update('#000')
  await update('#f1f1f1')
  platform = 'ios'
  await update('#fff')
  assert.deepEqual(calls, ['#000000', '#f1f1f1'])
})
