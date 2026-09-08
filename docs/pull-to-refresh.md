# Pull to refresh

The local `PullToRefresh` Capacitor plugin uses AndroidX `SwipeRefreshLayout`
(Apache-2.0). The plugin itself uses this repository's AGPL-3.0-or-later license.
It needs no service, account or additional permission. Android is implemented;
iOS can implement the same bridge contract later. Unsupported platforms skip setup.

Settings → General → Swipe to refresh controls the gesture. It defaults to on,
applies immediately and is saved per device. Disabling it also rejects any
pending gesture before it can refresh a page.

Native video playback reparents the WebView. Its overlay gets a refresh wrapper
with the same configuration and listener, and the plugin addresses whichever
wrapper currently owns the WebView. The original wrapper stays in place for
window inset measurements and receives the WebView again when playback closes.

- `setEnabled({ enabled })` enables or disables gesture recognition.
- `refresh` emits the context captured at the beginning of an accepted gesture.
- `finish()` dismisses the native indicator. A 60-second native timeout also
  dismisses it if the renderer stops responding.

Before intercepting a gesture, Android evaluates
`window.__opentubexPullToRefresh(x, y)` with coordinates normalized to the WebView.
The renderer returns `null` to reject it, or `{ tabId, fullPath, refreshKey, offset }`.
`offset` is the indicator's top inset as a fraction of the viewport height.
Watch pages use the same top inset as other pages. Native playback draws the
indicator above the video and its controls, and hides it in picture-in-picture.
Late results from finished or cancelled touches are ignored. Horizontal and
multitouch gestures cancel the pull. The renderer checks the captured tab and
route again on release, so switching tabs cannot refresh the wrong page.
Interrupted touches explicitly clear the indicator. Native playback also
invalidates its indicator layer when the indicator changes, so dismissal and
animation completion do not depend on the video repainting.

The gesture starts only at the page top, outside controls, players and nested
scrollers. Settings, dialogs and fullscreen playback block it. Pages with an
`FtRefreshWidget` use their existing feed refresh action, including its disabled
state. Other pages use the existing tab reload action. Existing refresh buttons
and the tab menu's reload action remain available without gestures.
