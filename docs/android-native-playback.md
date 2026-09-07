# Android native playback

Android Watch playback uses Media3 for decoding and the audio clock. It replaces the source handoff described in [#1094](https://github.com/OpenTubeX/OpenTubeX/issues/1094), with lifecycle context in [#1085](https://github.com/OpenTubeX/OpenTubeX/issues/1085) and [#1091](https://github.com/OpenTubeX/OpenTubeX/issues/1091).

## Playback and lifecycle

One primary ExoPlayer retains its source and buffered audio across foreground, Picture-in-Picture, and background transitions. Visibility changes attach or detach its video surface without preparing another source, seeking, or pausing audio. The existing foreground media service handles notifications, wake locks, audio focus, and media-session controls. Every service start acknowledges foreground mode, even when the notification content has not changed.

Background opt-out pauses playback. Returning to the Activity does not automatically resume it. Task removal and force-stop terminate playback; process death and reboot do not advertise a resumable native session. Background playback neither launches an Activity nor keeps the WebView artificially visible.

Commands, segment requests, and notification updates belong to a source owner. Inactive tabs wait before loading. Changing owners pauses the outgoing tab and retains its position and track choices. Returning to a paused tab restores its first video frame without reapplying initial autoplay. Stale commands and notifications cannot control or clear a newer source.

## Sources and buffering

LibreTube-Enhanced's SABR and ExoPlayer integration informed the native approach. OpenTubeX shares its existing SABR wire transport between desktop and Android. A generated DASH manifest maps Media3 extractor byte ranges to SABR initialization data and segments. Android does not load a Shaka streaming engine or a duplicate primary audio decoder. Optional translated speech has a separate native audio player.

The DASH manifest is an in-memory `data:` URI, but its segments require network requests. Media3 1.9's local-media defaults waited until only one second remained before refilling, causing periodic underruns. Native playback explicitly uses a 50-second refill threshold and Watch's three-minute maximum buffering goal for both local and remote manifests. `NativePlaybackBufferingTest` reproduces the default policy's failure and verifies the streaming policy.

Quality choices group codec and bitrate encodes by dimensions, frame rate, and HDR. Full variants remain available for audio selection, statistics, and restoring playback. Changing resolution preserves the selected audio track. Audio-only mode disables native video track selection for every source type, including non-SABR DASH and HLS. Initial native track snapshots are provisional: they must not emit `variantchanged` before Watch applies the configured quality, or Media3's initial 144p selection can overwrite that preference.

## Controls and shared Watch features

Native play/pause and seek controls share Watch's visibility timer. Previous/next follow the queue's available commands. Watch retains its seek timeline, chapters and SponsorBlock markers, draggable A–B repeat points, timestamps, settings, captions, PiP, and optional quick playback speed bar. Captions, PiP, and the chapter title move into settings when the toolbar has insufficient space.

Shared adapters connect quality and audio selection, captions and translation, caption appearance, chapters, SponsorBlock, A–B repeat, playback speed, sleep timer, screenshots, and information/queue panels to the native clock. Inline and fullscreen video both use the native surface at the source frame rate. A transparent window in the WebView keeps shared controls above the inline picture. Frame capture supplies ambient mode, mini-player previews, screenshots, and WebGL VR. Decoded PCM supplies the visualizer without microphone access. Native silence skipping and translated audio follow playback and audio focus. Parsed external captions are forwarded to the native clock for PiP without changing the source. Progressive word timing and caption visibility are preserved; inline/fullscreen text continues to use Watch's shared caption appearance settings.

The renderer reports menu rectangles so native buttons neither paint over menus nor intercept their touches. Native controls stay usable beside open panels. Headers remain outside each panel's OverlayScrollbars viewport, and opening information resets its real scroll position. Fullscreen locks the hidden page's scrolling while panels remain scrollable. Ambient glow excludes the fitted video rectangle after blur so it cannot tint the picture.

New videos start inline. Explicit fullscreen entry follows the landscape preference. Automatic landscape entry leaves orientation unlocked, and returning to portrait exits fullscreen. Shaka's browser fullscreen-on-rotation is disabled on Android to avoid independent fullscreen states. Loading a video while already in landscape does not itself enter fullscreen.

Fullscreen swipes may begin on native transport or shared toolbar buttons. Recognized swipes cancel the pending button tap. Two side taps within 350 ms seek without revealing controls; further taps accumulate the existing side feedback. Speed holds preserve control visibility and restore the original rate and paused state. Pinches, menus, SponsorBlock notices, and fullscreen gestures retain separate interactions.

The player reserves 16:9 before metadata so initialization and thumbnail removal cannot change its height. Scroll mini-player placement retains both its position and tucked side. Tablet tabs and button feedback follow the UI roundness setting.

## Verification evidence and limits

Automated coverage includes renderer/native ownership and source replacement, paused-tab restoration, opt-out, buffering policy, SABR ranges and transport, source errors and retries, live default-position seeking, caption visibility, and native cue delivery. Browser tests exercise the real Watch page with a native bridge fixture, including menus, panel scrolling and shortened content, gestures, loading geometry, responsive controls, and fractional UI scales. Android instrumentation covers service foreground acknowledgement, buffer policy, control visibility, menu clipping, native touch routing, and queue actions.

Physical checks on the Pixel 8 Pro running Android 16 covered SABR playback, screen lock, PiP, notification actions, task removal, queue advancement, two-tab isolation, paused return, external and embedded text captions, native controls, gestures, and fullscreen rotation. API 35 checks also exercised local MP4, WebM, HLS, DASH, translated-audio and VR fixtures, decoded audio spectrum, and natural playback completion. A live-marked HLS fixture verified default-position seeking; it was not a real live broadcast.

After the buffer-policy fix, a 279-second Pixel SABR run retained one owner and fetched 49 segment requests while hidden. It recorded one approximately 0.1-second buffering interval near the first screen-off transition despite a full buffer. Subsequent screen-off/return cycles produced 223 samples without buffering or pauses; a PiP-to-screen-off-to-foreground run produced 262 samples over 70.6 seconds without buffering or pauses. State samples alone do not establish audible continuity.

An independent API 35 audio check captured emulator PCM through its authenticated local gRPC `streamAudio` API while playing a 440 Hz tone with video. Across two screen-off/return cycles and 4,325 complete 10 ms windows after startup, no silent interval was detected at an RMS threshold of 20 for signed 16-bit PCM. Packet delivery intervals reached 93 ms, so this does not establish physical speaker timing. Real live-broadcast recovery, the remote voice-over service, and all caption translation/appearance combinations need broader device coverage.

## Repeating the checks

Run the unit tests and lint, then pack the current renderer before building an APK:

```sh
pnpm run test:unit
pnpm run lint
pnpm run capacitor:sync:android
cd android
ANDROID_HOME=/home/nico/Android/Sdk JAVA_HOME=/usr/lib/jvm/java-21-openjdk \
  ./gradlew :app:assembleDebug :app:testDebugUnitTest :app:assembleDebugAndroidTest
```

After installing the app and test APKs on an exclusively held emulator, run the native regressions:

```sh
adb -s emulator-5556 shell am instrument -w \
  org.opentubex.app.nightly.test/androidx.test.runner.AndroidJUnitRunner
```

For browser checks, pack `dist-e2e` from the current sources and run the affected files on a private X server:

```sh
pnpm run test:e2e:pack
xvfb-run -a -s '-screen 0 1920x1080x24' pnpm exec playwright test \
  -c e2e/playwright.config.mjs --project=offline \
  e2e/tests/offline/android-native-screen.spec.mjs \
  e2e/tests/offline/player.spec.mjs e2e/tests/offline/ui-bugfixes.spec.mjs
```
