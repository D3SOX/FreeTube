# Updating the README screenshots

From the repository root, run:

```sh
pnpm run screenshots
```

Install `yt-dlp`, its JavaScript runtime such as Deno, and `ffmpeg` on your PATH
for the app's yt-dlp playback engine, which the original watch screenshot used.
On Linux, also install `xorg-server-xvfb` and `xorg-xauth`.

The command packs the current app, then uses Playwright to capture its Electron
window at 1710 × 1026 in English. It starts a private X server on Linux so capture
windows stay off your desktop, including on Wayland.

The command creates or replaces six PNGs in this directory:

| Files | View |
| --- | --- |
| `OpenTubeX1-dark.png`, `OpenTubeX1-light.png` | Subscriptions, with Kurzgesagt's current videos |
| `OpenTubeX2-dark.png`, `OpenTubeX2-light.png` | [Flying over Japan](https://www.youtube.com/watch?v=AY5qcIq5u2g&t=13318), paused at 3:41:58 |
| `OpenTubeX3-dark.png`, `OpenTubeX3-light.png` | Settings, maximized on the General category |

Both themes use the same loaded feed and paused video. The script uses a fresh
temporary profile and removes it when finished. Your subscriptions, settings,
history, and cookies are not used.

Settings are captured first with the app defaults. The capture process uses an
English system locale and switches the system color scheme for each theme.
The app's locale and theme preferences stay at System Default. Only after the
settings captures does the script select yt-dlp for the watch page and disable
automatic feed refresh while capturing the subscriptions.

Internet access is required. Metadata, thumbnails, and playback come from
YouTube through the app. If YouTube blocks playback or an image fails to load,
the command fails without replacing the existing screenshots. Captures from
that attempt and a failure screenshot are kept in `e2e/results/screenshots/`.
Review the images before committing them. Video lists and metadata can change
between runs.

The capture sequence, channel, video, timestamp, and dimensions live in
`e2e/screenshots/capture.spec.mjs`. If you already packed the current source,
run `node _scripts/screenshots.mjs` to repeat the capture without repacking.
The regular E2E suites do not update these files.

The Flatpark submission and official Flatpak release workflows reuse these
committed images through `_scripts/syncAppStreamScreenshots.mjs`. The helper
updates the AppStream gallery with both themes, reads dimensions from the PNGs,
and pins image URLs to the checked-out OpenTubeX commit. It preserves the rest
of each package's metadata. Package releases do not run the capture command.
