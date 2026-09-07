# yt-dlp on Android

Android uses the same download dialogs, templates, queue and playback engine selection as desktop. The APK bundles Python, QuickJS, yt-dlp, FFmpeg and FFprobe through `youtubedl-android` 0.18.1. yt-dlp supports the stable, nightly and master update channels. FFmpeg and FFprobe update with the APK.

Enable downloads in Settings and choose a folder with Android's document picker. Downloads first use private staging storage, including partial files, then copy completed media and sidecar files to that folder. Keep enough free space for both copies. The app stores the queue independently of the WebView, resumes partial downloads after interruption, and can play exported media through its persisted document URI. If a playlist entry fails, completed media is still exported and playable; retrying reuses those exported files. Removing downloaded files is permanent.

Pause, resume, cancellation, retry, ordering, concurrency and bandwidth limits run in the native queue. Manual downloads use a foreground notification. WorkManager handles queued work after the activity closes; jobs started while the app is closed use bounded batches and remain subject to Android's scheduling and battery limits. Force-stopping the app prevents Android from restarting its jobs until the app is opened again.

Automatic rules run during subscription refreshes, including enabled closed-app refreshes. They include subscribed rule channels filtered out of a profile, apply publication-time and content filters, and deduplicate the download history. Closed-app discovery uses the configured Invidious instance and refresh intervals. Hidden or disabled feed schedules do not run in the background.

Playback extraction, stream caching, fallback, subtitles and storyboards use the shared renderer playback code. CDN byte ranges use the URL query parameter so Android's WebView does not apply a Range header twice to intercepted responses. Cookie authentication accepts a Netscape cookie file imported into private app storage, including authenticated subtitles and automatic translations. Android cannot read another app's browser cookies or run desktop executable paths. Custom download arguments are restricted to supported media options; executable overrides, shell commands and arbitrary file paths are rejected.

## Implementation

- `src/ytDlpArguments.js` and `src/ytDlpMetadata.js` share download options and playback metadata mapping with desktop.
- `src/renderer/helpers/ytDlp.js` adapts the renderer's desktop API to the Capacitor plugin.
- `YtDlpRuntime` launches the bundled interpreter in its own process group so cancellation also stops FFmpeg. Extraction is time- and size-bounded, and updates wait for running processes.
- `YtDlpDownloads` owns the persisted queue and export records. `YtDlpDownloadWorker` executes it without tying downloads to an activity.

## Verification

Run JavaScript tests with `pnpm run test:unit` and Android unit tests with `./android/gradlew -p android :app:testDebugUnitTest`.

`YtDlpRuntimeTest` checks local metadata extraction, audio conversion and cancellation during an FFmpeg conversion. `YtDlpDownloadsTest` uses a localhost media server and a test-only document provider to check partial-file resume, queue restoration, exported-media readability, deletion, reuse of an interrupted export's document, and completed playlist entries surviving another entry's failure. These tests use temporary storage, not the user's download folder.

Build the app and instrumentation APK after syncing current renderer assets:

```sh
pnpm run capacitor:sync:android
./android/gradlew -p android :app:assembleDebug :app:assembleDebugAndroidTest
```

For a single-ABI test APK, add `-PtestAbi=arm64-v8a`. Normal APKs retain all bundled ABIs. The test document provider exists only in the instrumentation APK.

### Playback cache across APK replacement

`YtDlpPlaybackCacheTest` checks cache persistence, Android cache eviction, migration and explicit cleanup. Its default `playbackCachePhase=both` writes and reads the replacement fixture within one test process; it does not replace the APK. To test replacement, run the `seed` and `verify` phases in separate processes with an APK install between them.

After building the app and instrumentation APKs above, run these commands from the repository root on the selected test device. Replace `DEVICE_SERIAL` with its ADB serial. The app must use the same package identity and signing key across both installs.

```sh
playback_test_device=DEVICE_SERIAL
playback_test_class='org.opentubex.app.YtDlpPlaybackCacheTest#playbackSurvivesAppReplacement'
playback_test_runner=org.opentubex.app.nightly.test/androidx.test.runner.AndroidJUnitRunner

adb -s "$playback_test_device" install --user 0 -r android/app/build/outputs/apk/debug/app-debug.apk
adb -s "$playback_test_device" install --user 0 -r android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s "$playback_test_device" shell am instrument --user 0 -w \
  -e class "$playback_test_class" -e playbackCachePhase seed "$playback_test_runner"
adb -s "$playback_test_device" install --user 0 -r android/app/build/outputs/apk/debug/app-debug.apk
adb -s "$playback_test_device" shell am instrument --user 0 -w \
  -e class "$playback_test_class" -e playbackCachePhase verify "$playback_test_runner"
```

Both instrumentation runs must print `OK (1 test)` and each install must report `Success`. Check the instrumentation output even when ADB exits successfully. Keep the device's app data intact between phases and run `verify` within one hour, before the fixture expires. The `verify` phase removes its fixture afterward.
