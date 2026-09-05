# Theme discussion previews

Sharing a theme from the editor opens a discussion with the theme JSON and a
Screenshots section. People can attach their own screenshots or leave that
section empty. The bot then posts three previews in a comment: subscriptions,
the watch page, and maximized settings, matching the views in the README gallery.

The capture uses an isolated Electron profile, bundled sample thumbnails, and an
offline demo video. Both this capture and the README capture use
`e2e/helpers/screenshots.mjs` for window sizing, maximized settings, image
readiness, capture, and copying completed image sets. It never reads the author's subscriptions, history, or other
settings. Only inline theme JSON is imported, through the app's theme validator.
Invalid JSON fails the workflow without posting screenshots. Fixing the JSON and
saving the discussion triggers another attempt.

The workflow runs on theme discussion creation, edits, and category changes.
Adding screenshots or text to the Screenshots section prevents new captures.
Existing bot previews stay in their comment. Editing the JSON refreshes that
comment while the section remains empty. The bot rechecks the current discussion
before posting so an edit during capture does not publish stale previews.
If publication is skipped or fails, the workflow removes unused uploads from
that attempt after checking whether the bot comment references them. If GitHub
cannot confirm that, it keeps the images to avoid breaking a published comment.

Images use the existing `attachments` releases in `OpenTubeX/media`, including
the release rollover helper used by release-note media. The repository's existing
`PUSH_TOKEN` secret needs Contents write access there. Discussion comments use
`GITHUB_TOKEN` with Discussions write permission. Neither token is passed to
Electron. No additional service is needed.

After the workflow lands on the default branch, run **Theme previews** manually
with a discussion number to fill in older posts, or retry a failed capture.
Normal runs skip themes already captured by the bot.

To verify captures locally, put an exported theme in a temporary directory as
`theme.json`, then run:

```sh
pnpm run test:e2e:pack
THEME_PREVIEW_DIR=/absolute/path/to/temporary-directory \
  xvfb-run -a -s '-screen 0 1920x1080x24' \
  pnpm exec playwright test -c e2e/theme-previews/playwright.config.mjs
```

All three PNGs appear in that directory only after the complete capture succeeds.
This command does not upload files or post to GitHub.

The small `e2e/fixtures/media/theme-preview.webm` fixture is a 30-second neutral
video with silent audio. To regenerate it with FFmpeg:

```sh
ffmpeg -f lavfi -i 'color=c=0x202830:s=640x360:r=1:d=30' \
  -f lavfi -i 'anullsrc=r=48000:cl=stereo' \
  -vf "drawtext=text='Sample video':fontsize=30:fontcolor=white:x=(w-tw)/2:y=(h-th)/2" \
  -t 30 -c:v libvpx-vp9 -crf 40 -b:v 0 -c:a libopus -b:a 6k \
  e2e/fixtures/media/theme-preview.webm
```
