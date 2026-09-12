import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createDesktopShareHandler, loadWindowsShare } from '../../src/main/desktopShare.js'

function fixture(platform) {
  const calls = []
  const listeners = []
  const handle = Buffer.alloc(8)
  const window = { isDestroyed: () => false, getNativeWindowHandle: () => handle, once: (event, callback) => listeners.push({ event, callback }) }
  const share = createDesktopShareHandler({
    platform,
    isTrustedSender: event => event.trusted,
    getWindow: () => window,
    ShareMenu: class {
      constructor(item) { calls.push(item) }
      popup(options) { calls.push(options) }
    },
    loadWindowsShare: () => ({ share: (...args) => calls.push(args), close: value => calls.push(['close', value]) })
  })
  return { share, calls, window, handle, listeners }
}

test('macOS shares the exact URL in the requesting window', () => {
  const f = fixture('darwin')
  f.share({ trusted: true }, 'https://youtu.be/video?list=PL123&t=42')
  assert.deepEqual(f.calls, [{ urls: ['https://youtu.be/video?list=PL123&t=42'] }, { window: f.window }])
})

test('Windows shares through the native window and releases its request handler on close', () => {
  const f = fixture('win32')
  for (const url of ['https://youtu.be/one?t=42', 'https://youtu.be/two']) f.share({ trusted: true }, url)
  assert.equal(f.listeners.length, 1)
  assert.equal(f.listeners[0].event, 'closed')
  f.listeners[0].callback()
  assert.deepEqual(f.calls, [[f.handle, 'https://youtu.be/one?t=42'], [f.handle, 'https://youtu.be/two'], ['close', f.handle]])
})

test('sharing rejects untrusted requests, credentials and non-web URLs before opening any picker', () => {
  const f = fixture('darwin')
  assert.throws(() => f.share({}, 'https://youtu.be/video'))
  for (const url of ['file:///private', 'javascript:alert(1)', 'https://user:password@example.com', 'invalid', null, 'https://example.com/' + 'x'.repeat(8192)]) {
    assert.throws(() => f.share({ trusted: true }, url))
  }
  assert.deepEqual(f.calls, [])
})

test('closed windows and unsupported platforms do not open a picker', () => {
  const f = fixture('linux')
  assert.throws(() => f.share({ trusted: true }, 'https://youtu.be/video'), /unavailable/)
  f.window.isDestroyed = () => true
  assert.throws(() => f.share({ trusted: true }, 'https://youtu.be/video'), /closed/)
})


test('Windows development resolves the addon from dist even with webpack relative filenames', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'opentubex-share-'))
  t.after(() => rmSync(directory, { recursive: true }))
  const relativeSource = path.relative(process.cwd(), path.join(directory, 'src/main'))
  assert.throws(() => loadWindowsShare(relativeSource, true), error =>
    error.code === 'MODULE_NOT_FOUND' && error.message.includes(path.join(directory, 'dist/windows_share.node')))
})

test('packaged Windows resolves the addon beside main.js', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'opentubex-share-'))
  t.after(() => rmSync(directory, { recursive: true }))
  assert.throws(() => loadWindowsShare(directory, false), error =>
    error.code === 'MODULE_NOT_FOUND' && error.message.includes(path.join(directory, 'windows_share.node')))
})
