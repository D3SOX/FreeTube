# Project instructions

## Documentation

- Do not create new documentation files, feature writeups, implementation notes, plans, or task summaries unless the user explicitly requests them. Put change explanations and validation details in the PR description. Update existing documentation only when the change makes it inaccurate.

## Testing

- Local Android debug builds install as `org.opentubex.app.dev` (OpenTubeX Dev). Launch `org.opentubex.app.dev/org.opentubex.app.MainActivity`; instrumentation uses `org.opentubex.app.dev.test`. Reserve `assembleNightly` for intentionally building the published nightly identity. See `android/SIGNING.md`.
- For bugfixes, reproduce the failure with a regression test before applying the fix, then verify that it passes afterward. Verify new features with checks appropriate to the affected code. If automated reproduction or verification is impractical, explain why and report the evidence used, unless the user explicitly waived verification.
- Run the relevant checks: `pnpm run test:unit` for unit tests, `pnpm run lint` for JavaScript/Vue and styles, `pnpm run lint-json` for static JSON, and `pnpm run lint-yml` for YAML. Use the filtered E2E command below for affected Electron flows.
- When running Electron/Playwright E2E tests on a user's graphical desktop, use a private X server so test windows do not appear in their session. For example: `xvfb-run -a -s "-screen 0 1920x1080x24"`. The exact command may vary, and this is not required in CI or other isolated/headless environments.
- For filtered Electron/Playwright E2E runs, invoke Playwright directly, for example `pnpm exec playwright test -c e2e/playwright.config.mjs e2e/tests/network/channel.spec.mjs --project=network --grep "test name"`. Never use `pnpm run test:e2e -- ...`; the extra `--` stops Playwright from parsing the following path and options and can launch the full suite.
- Before running Electron/Playwright E2E tests, ensure `dist-e2e` reflects the current application sources, assets, and build configuration. Run `pnpm run test:e2e:pack` if the package is missing, any of those inputs have changed, or its freshness is uncertain. This also applies when running unchanged tests against application changes.

## UI

- Follow `.github/PULL_REQUEST_TEMPLATE.md` for release-note screenshot and recording instructions.
- The in-app UI Scale setting changes Electron's zoom factor and can produce legitimate fractional CSS-pixel geometry. Changes involving scrolling, measurements, positioning, reflow, or animation boundaries must also work at non-100% UI scales; do not treat a subpixel difference from integer layout properties as stale or invalid state.
- Custom Shaka overflow-menu controls must hide while any submenu is open; follow the existing `submenuopen` / `submenuclose` visibility pattern using `isSubMenuOpened` and `shaka-hidden`.
- Headers in scrollable menus and panels must stay outside the content's scroll viewport so neither content nor its scrollbar can pass behind the header. Prefer a fixed header plus a separate inner scroller over covering content with a sticky header.
- When switching between menu views, explicitly restore the actual scroll viewport to the intended position. Use `restoreOverlayScrollTop` for OverlayScrollbars-managed elements instead of relying on focus or DOM replacement to reset it.
- After any reflow or dynamic update that can shorten scrollable content, clamp the scroll position against the real rendered content end after the DOM update. This includes resize, responsive layout changes, searching, filtering, collapsing, removing, and replacing content.
- Observe a stable content wrapper when practical and use `clampOverlayScrollTop` with that content element instead of trusting a possibly stale `scrollHeight`.
- For scrolling changes, cover every relevant content-shortening trigger in the affected component with a regression test. First scroll to the bottom, trigger the shorter state, then verify that no obsolete offset or empty space remains and that the rendered scrollbar thumb/overflow state matches the new scroll range.
- Every nested element that can show a scrollbar through `overflow: auto`, `overflow: scroll`, `overflow-x`, or `overflow-y` must use the app's `v-overlay-scrollbars` directive so it matches the active theme and scrollbar settings. Treat native nested scrollbars as a bug unless the element is explicitly documented as an exception; whenever adding or changing scrollable CSS, verify the corresponding template element has the directive.
- New icons must be registered in the icon registry and mapped for every currently supported icon pack: Material and Remix. If neither pack has a suitable glyph, a raw custom icon may be used directly without a registry entry or pack mappings.
- Labeled action buttons, such as Enable, Load more, Refresh, and Reset, must include a relevant icon alongside their text. Reuse the icon registry and keep the visible label; decorative icons must be hidden from assistive technology.
- When adding or changing icon-pack mappings, get human confirmation that the mapped glyphs fit visually in Material and Remix before considering the mapping work done.

## Dependencies and data formats

- Keep the npm `allow` list in `.github/dependabot.yml` limited to direct dependencies in this repository's `package.json` that are absent from the latest `upstream/development:package.json`. Upstream manages shared npm dependencies. Whenever changing dependencies or the Dependabot configuration, fetch `upstream/development` and update the allowlist to match that exact difference.
- Do not add migrations, compatibility aliases, or legacy handling for behavior or data formats introduced only by unshipped changes in the current PR. Change unreleased data directly; if that breaks local development data, tell the user in the task instead of shipping a migration path.

## Translations

- When adding or changing translatable strings, update the English (`en-US`) and German (`de-DE`) human translations. Weblate handles every other human locale. Also add or update the corresponding AI-generated completions for every other active locale in `static/locales/ai`, preserving placeholders and locale plural forms. After syncing human translations, run `node _scripts/aiTranslations.mjs cleanup --all --write` to remove AI entries that now have human translations. The AI locale validator runs with the unit tests.

## Related repositories and naming

- Related repositories such as Website, APT, RPM, Flatpak, and AUR live alongside the main OpenTubeX checkout. Use `git worktree list --porcelain` to locate the main checkout, listed first, then look in its parent directory. Do not assume a linked worktree's parent contains these repositories.
- Never use the "FreeTube" name for promotion of the project. See discussion #391 for details when in doubt.
