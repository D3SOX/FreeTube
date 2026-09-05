# End-to-end tests

Playwright drives the packed Electron app (`dist/main.js`) against an isolated,
per-test userData directory. Playback tests use the local API (youtubei.js).
Offline metadata tests may use Invidious when they mock every request.

## Running locally

```bash
pnpm run test:e2e:pack      # build dist-e2e/ (required once per code change)
pnpm run test:e2e:offline   # fast suite, no YouTube network needed
pnpm run test:e2e:network   # talks to the real YouTube servers
pnpm run test:e2e           # both
```

The tests run a production build from `dist-e2e/`, separate from `dist/`,
so they work (and stay production-mode) even while `pnpm dev` is running.

On a headless machine (or to avoid windows popping up) prefix with
`xvfb-run --auto-servernum --server-args='-screen 0 1920x1080x24'`.
The screen size matters: xvfb's default 640x480 puts the app into its
mobile layout and breaks selectors.

## Structure

- `helpers/app.mjs` – launches the app with a fresh temp userData dir per test.
  Seed settings/datastores per file via `test.use({ seed: { ... } })`.
  The main process honours `OPENTUBEX_E2E_USER_DATA_DIR` for isolation.
- `helpers/innertube.mjs` – record/replay for Innertube requests (see below).
- `helpers/media.mjs` – the offline demo video and the fake player response
  that serves it (see below).
- `helpers/watch.mjs` – a fully mocked watch page, playable or unplayable.
- `tests/offline/` – must pass without any external network.
- `tests/network/` – requires YouTube. Runs nightly and via workflow dispatch.
- `fixtures/innertube/` – gzipped recorded Innertube responses, committed to git.
- `fixtures/media/demo.webm` – 30s VP9/Opus clip with a burnt-in timecode.

## Playing a video without YouTube

Media streams can't be recorded, and recorded player responses are useless
(their stream URLs expire, and CI recordings are usually bot checks). So
whenever the player has to run without the live API, the `/youtubei/v1/player`
response is synthesized instead: `demoPlayerResponse()` reports a playable
video with a single progressive format pointing at `fixtures/media/demo.webm`,
which is served locally by `routeDemoMedia()`. Without adaptive formats the
app takes its legacy (progressive) player path, so neither a DASH manifest
nor SABR is involved.

Everything else (title, channel, description, comments, recommendations)
still comes from the recorded `/next` response, so tests that only need
*some* video playing belong in `tests/offline/` — see
`tests/offline/player.spec.mjs` and `mockPlayableWatchPage()`.

## Network fallback

Network tests hit the real YouTube servers on the first attempt. If a test
fails (e.g. bot checks on CI runner IPs), Playwright retries it and the retry
replays recorded fixtures instead: Innertube requests are answered from
`fixtures/innertube/`, all other external network is blocked, and the player
plays the demo video.

Tests whose videos have no recorded fixtures, or that need data the demo
player response doesn't have (adaptive formats), are guarded with
`test.skip(innertube.replay, ...)`. Replay mode is a smoke layer: it verifies
search results, the channel page, playback and navigation against recorded
Innertube data.

Live playback tests wait for either media playback or the app's explicit
IP-block error. GitHub-hosted runners are commonly blocked from streaming
media; in that case only the playback-dependent test is skipped with a clear
reason. Other watch-page assertions continue against the live API, while
unexpected player failures still fail normally.

## Screenshots

To update the full-window README images in both themes, run
`pnpm run screenshots`. See [the screenshot instructions](../docs/screenshots/README.md)
for prerequisites and the fixed video timestamp. This capture runs separately
from the test suites below.

Failures always attach a screenshot. Passing tests do not need to attach
screenshots, including tests with visual assertions.

Use `attachScreenshot` when a capture is useful for preparing a release-note
image for a pull request. Follow the instructions under "Release note images"
in `.github/PULL_REQUEST_TEMPLATE.md`; screenshots are optional test artifacts,
not part of the assertions:

```js
test('...', async ({ page, attachScreenshot }) => {
  await attachScreenshot('subscriptions feed')
})
```

To (re-)record fixtures after YouTube-facing changes or for new tests:

```bash
E2E_RECORD=1 pnpm run test:e2e:network
```

Commit the updated files under `fixtures/innertube/`. Player responses are
deliberately not recorded. To force replay mode
locally (validate fixtures without touching the network):

```bash
E2E_USE_FIXTURES=1 pnpm run test:e2e:network
```

## CI

`.github/workflows/e2e.yml`:

- **Pull requests** → changed test files and tests importing changed helpers.
- **Nightly** → full offline and network suites.
- **Manual dispatch** → all suites by default, or an individual suite.

The selected tests are split across four CI jobs. Each job still uses one
Playwright worker and its own X server, avoiding interference between Electron
windows while substantially reducing the suite's wall-clock time.

Pull requests without changed or affected E2E tests pass without running tests.
Network tests use the fixture fallback on retry.

On failure the Playwright HTML report and traces are uploaded as artifacts.

## Performance comparison

The pull-request performance workflow builds the base and candidate commits,
then runs the large cached-subscription benchmark against both builds on one
runner. It alternates between builds, discards two warm-ups per build, and
compares the median of seven samples. A single pull-request comment and the
Actions summary show the comparison, and the raw samples are uploaded as
`performance-results.json`.

An absolute gate fails when the base median is below the limit, the candidate's
lower quartile reaches the limit, and the median increase exceeds the configured
absolute minimum delta. A relative gate fails when the candidate's lower
quartile clears the threshold against the base's upper quartile and the
interquartile increase exceeds the configured minimum delta. This prevents an
overlapping distribution from failing because of a median flip. Elapsed metrics
allow 15%, longest-frame metrics 20%, renderer heap growth 50%, and packed code
size 5%. Each metric's minimum delta lives in `e2e/performance/report.mjs`. A
trusted follow-up workflow updates the comment so pull requests from forks
never receive a write-capable token.

To compare two checkouts locally, build `dist-e2e` in both and run:

```bash
xvfb-run -a -s "-screen 0 1920x1080x24" \
  pnpm run test:performance -- \
  --base /path/to/base-checkout \
  --candidate /path/to/candidate-checkout
```
