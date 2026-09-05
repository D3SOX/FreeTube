# Theme discussion previews

Sharing a theme from the editor opens a discussion with the theme JSON and a
Screenshots section. People can attach their own screenshots or leave that
section empty. The bot then edits the original post to fill that section with
three previews: subscriptions, the watch page, and maximized settings, matching
the views in the README gallery.

The capture uses an isolated Electron profile, bundled sample thumbnails, and an
offline demo video. Both this capture and the README capture use
`e2e/helpers/screenshots.mjs` for window sizing, maximized settings, image
readiness, capture, and copying completed image sets. It never reads the author's
subscriptions, history, or other settings. Only inline theme JSON is imported,
through the app's theme validator.
Invalid JSON fails the workflow without posting screenshots. Fixing the JSON and
saving the discussion triggers another attempt.

The workflow runs on theme discussion creation, edits, and category changes.
Adding screenshots or text to the Screenshots section prevents new captures.
Editing the JSON refreshes the generated previews in that section. Editing the
generated image block itself or adding your own screenshots stops automatic
updates; the bot preserves that content. The bot rechecks the current discussion
before posting so an edit during capture does not publish stale previews.

Images are native GitHub attachments, uploaded through the same endpoint as
GitHub CLI's `--attach` flag. Discussion commands do not expose that flag yet,
so the script calls the endpoint with `gh api` and includes the returned URLs in
the discussion body. No media repository or release is needed.

GitHub requires a user token for attachment uploads; the built-in Actions token
is not supported. The existing `PUSH_TOKEN` needs write access to this repository
and Discussions write permission for editing the original post. The built-in
`GITHUB_TOKEN` reads discussions but cannot edit another author's post.
Neither token is passed to Electron.

Like attachments uploaded through `gh --attach`, native uploads cannot be
removed through the CLI. If publication fails or the discussion changes during
capture, unused attachments can remain, but the bot does not insert stale previews.

After the workflow lands on the default branch, run **Theme previews** manually
with a discussion number to fill in older posts, or retry a failed capture.
Normal runs skip themes already captured by the bot. Manual runs use the selected
workflow ref; discussion events always use the default branch.

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
