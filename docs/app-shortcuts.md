# App shortcuts

Launcher shortcuts use the MIT-licensed `@capawesome/capacitor-app-shortcuts` plugin. The shared definitions in `src/renderer/helpers/appShortcuts.js` provide page IDs and Android/iOS icons. `App.vue` registers the click listener after app data and tabs initialize, and updates titles when the app language changes. The native plugin retains startup clicks until that listener is ready.

Android drawable resources reuse the app's existing Material glyphs. Keep their viewport at 24×24 so the launcher does not add another layer of padding around the glyphs.

## Adding iOS

There is no iOS project in this repository yet. When adding one:

1. Sync Capacitor so the shortcut plugin is included.
2. Add the plugin's documented `AppDelegate.swift` hooks for launch options and `performActionFor`. See the [iOS setup instructions](https://capawesome.io/docs/sdks/capacitor/app-shortcuts/#ios).
3. Verify all four actions from a terminated app and a running app, including language changes and the supplied SF Symbols. Android testing does not verify the iOS lifecycle hooks.

## Dependency patch

Version 8.0.2 copies `bridge.getIntentUri()` into Android shortcut intents. If a YouTube link opened the app, later shortcut clicks also deliver that video URL to Capacitor's App plugin, causing two competing navigations.

The pnpm patch removes the inherited URI. The shortcut ID remains in the plugin's intent extra and is delivered through its cross-platform `click` event. `LauncherShortcutsTest.shortcutIntentsDoNotInheritTheVideoThatOpenedTheApp` reproduces the unpatched failure. Remove the patch once an upstream release fixes this behavior.
