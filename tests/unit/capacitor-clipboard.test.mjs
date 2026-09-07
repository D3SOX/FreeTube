import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../src/renderer/helpers/utils.js', import.meta.url), 'utf8')
const readSource = source.match(/export async function readClipboard\(\) \{[\s\S]*?^\}/m)[0]
const writeSource = source.match(/export async function copyToClipboard\([\s\S]*?^\}/m)[0]

function loadClipboard(clipboard, toasts = []) {
  return vm.runInNewContext(`${readSource}\n${writeSource}\n({ readClipboard, copyToClipboard })`.replace(/^export /gm, ''), {
    Clipboard: clipboard,
    process: { env: { IS_CAPACITOR: true } },
    navigator: {},
    Blob,
    showToast: toast => toasts.push(toast),
    console: { error() {} },
    ERROR_TOAST_ICON: 'error',
  })
}

test('copies text through Capacitor without requiring the WebView clipboard API', async () => {
  const writes = []
  const toasts = []
  const { copyToClipboard } = loadClipboard({ write: async options => writes.push({ ...options }) }, toasts)

  await copyToClipboard('https://www.youtube.com/watch?v=abcdefghijk', { messageOnSuccess: 'Copied' })

  assert.deepEqual(writes, [{ string: 'https://www.youtube.com/watch?v=abcdefghijk', label: 'OpenTubeX' }])
  assert.equal(toasts[0].message, 'Copied')
})

test('reads text from the Capacitor result and ignores image data', async () => {
  const { readClipboard } = loadClipboard({ read: async () => ({ type: 'text/plain', value: 'Copied text' }) })
  assert.equal(await readClipboard(), 'Copied text')

  const images = loadClipboard({ read: async () => ({ type: 'image/png', value: 'data:image/png;base64,AA==' }) })
  assert.equal(await images.readClipboard(), '')
})

test('an empty native clipboard still returns empty text', async () => {
  const { readClipboard } = loadClipboard({ read: async () => { throw new Error('There is no data on the clipboard') } })
  assert.equal(await readClipboard(), '')
})

test('propagates native read failures and shows native write failures', async () => {
  const error = new Error('Clipboard access denied')
  const toasts = []
  const clipboard = loadClipboard({
    read: async () => { throw error },
    write: async () => { throw error },
  }, toasts)

  await assert.rejects(clipboard.readClipboard(), error)
  await clipboard.copyToClipboard('test', { messageOnError: 'Copy failed' })
  assert.equal(toasts[0].message, 'Copy failed: Error: Clipboard access denied')
})
