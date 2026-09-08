# Capacitor screenshot plugin

The app owns a local Capacitor plugin named `Screenshot`. Tab previews use its
platform-independent API:

```js
const Screenshot = registerPlugin('Screenshot')
const { uri } = await Screenshot.take()
```

`take()` captures the visible WebView viewport at its native pixel dimensions,
without stretching, cropping, or including system bars outside the WebView. It
returns a temporary JPEG in the app's cache. The URI must work with
`Capacitor.convertFileSrc(uri)` and `Filesystem.deleteFile({ path: uri })`.
Callers delete the file after use, including when decoding fails. Capture or
encoding failures reject the promise and leave no partial file.

Android registers `ScreenshotPlugin` in `MainActivity`. It uses `PixelCopy` to
copy the window region occupied by the WebView. Software `WebView.draw` distorts
some Chromium compositor layers and must not be used as a fallback.

The repository has no iOS project yet. When adding one, implement the same
plugin name, method, and return value using `WKWebView.takeSnapshot` on the main
thread, then encode the image into the app's temporary storage. Verify viewport
bounds, safe-area insets, display scale, and video rendering on iOS before
enabling previews there. Native video surfaces may require the existing renderer
video-frame compositing step on either platform.

The renderer checks plugin availability. There is no web fallback; Electron
continues to use its own tab capture implementation.
