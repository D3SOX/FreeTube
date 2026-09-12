import path from 'node:path'
import { createRequire } from 'node:module'

export function loadWindowsShare(directory, development) {
  const addon = path.resolve(directory, development ? '../../dist/windows_share.node' : 'windows_share.node')
  return createRequire(addon)(addon)
}

/** Opens an OS share picker after validating the renderer and public URL. */
export function createDesktopShareHandler({ platform, isTrustedSender, getWindow, ShareMenu, loadWindowsShare }) {
  const registeredWindows = new WeakSet()
  return (event, url) => {
    if (!isTrustedSender(event) || typeof url !== 'string' || url.length > 8192) throw new Error('Invalid share request')
    const parsed = new URL(url)
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Invalid share URL')
    const window = getWindow(event)
    if (!window || window.isDestroyed()) throw new Error('The sharing window is closed')
    if (platform === 'darwin') {
      new ShareMenu({ urls: [url] }).popup({ window })
    } else if (platform === 'win32') {
      const native = loadWindowsShare()
      const handle = window.getNativeWindowHandle()
      if (!registeredWindows.has(window)) {
        registeredWindows.add(window)
        window.once('closed', () => native.close(handle))
      }
      native.share(handle, url)
    } else {
      throw new Error('Native sharing is unavailable on this platform')
    }
  }
}
