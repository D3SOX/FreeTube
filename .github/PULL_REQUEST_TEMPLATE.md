<!-- Thanks for sending a pull request! Make sure to follow the contributing guidelines. -->
<!-- Important note, we may remove your pull request if you do not use this provided PR template correctly. -->
<!-- Agent instructions: Preserve every heading, comment, and marker in this template. Never remove or rewrite the release-note-category:start/end, release-note:start/end, or release-note-image:start/end marker pairs. -->

## Pull Request Type
<!-- Please select what type of pull request this is: [x] -->
- [ ] Bugfix
- [ ] Feature Implementation
- [ ] Documentation
- [ ] Other

## Related issue
<!-- Please link the issue your pull request is referring to. -->
<!-- If this pull request fully resolves the relevant issue, put "closes" before the issue number. -->
<!-- Example: "closes #123456". -->

## Description
<!-- Please write a clear and concise description of what the pull request does. -->

## Release note category
<!-- Select exactly one category. Every pull request must select one. -->
<!-- Select "Not noteworthy" when the pull request fixes a bug in or improves functionality that has not yet appeared in a stable release. -->
<!-- release-note-category:start -->
- [ ] Not noteworthy
- [ ] Highlights
- [ ] More improvements
- [ ] Fixed bugs
<!-- release-note-category:end -->

## Release note
<!-- Required unless "Not noteworthy" is selected. -->
<!-- Write one concise, user-facing entry without a leading bullet. -->
<!-- release-note:start -->

<!-- release-note:end -->

## Release note images
<!-- Optional. Paste one or more Markdown images, HTML image tags, or dark/light <picture> elements here. -->
<!-- The release notes normalize the markup and limit images taller than 300 pixels. -->
<!-- Agent instructions:
For a noteworthy visible change, add media when it makes the change easier to understand. Prefer a still image unless motion is the point. Recordings in this section must end up as animated WebP because release notes accept images, not video attachments.
After implementing a visible change, proactively capture the result and show the local media to the user for approval before uploading it or updating the pull request.
Use the default System Default theme pair for screenshots and recordings: `baseTheme: 'system'`, `systemDarkTheme: 'dark'`, and `systemLightTheme: 'light'`, with the default accent colors (`mainColor: 'Red'`, `secColor: 'Blue'`). Do not substitute OpenTubeX Dark/Light (`openTubeXDark` / `openTubeXLight`) or custom themes unless the user requests them or the change specifically concerns that theme.
Capture in a fresh temporary profile. In Playwright, switch the emulated system color scheme with `await page.emulateMedia({ colorScheme: 'dark' })` and then `'light'`, keeping the app theme preferences above. Before each capture, wait for the body to have the matching `dark` or `light` class, as in `e2e/screenshots/capture.spec.mjs`.
When the affected UI differs between dark and light themes, capturing both themes is required. A dark-only image is incomplete. The final pull request body must combine the hosted URLs into a theme-aware `<picture>` with dark and light `prefers-color-scheme` sources and the dark image as its `<img>` fallback. Never leave the two theme captures as separate images. Use a single default-dark capture only when the light theme cannot be captured or looks identical.
Capture or crop to the smallest region that still makes the change clear. Do not include the full window when the affected component can be understood on its own.
Use English unless localization is the subject. Keep components at their normal dimensions and placement instead of resizing them to fill the frame.
Use deterministic local fixtures for visible remote images. Reusable avatar and thumbnail fixtures are available through `e2e/helpers/visual-fixtures.mjs`. Before capturing, verify that every visible image has loaded successfully (`complete === true` and `naturalWidth > 0`).
Inspect the final dark and light files for failed images, missing content, unrelated UI, awkward animation, and misleading layout. Omit media when it does not explain the change clearly.
Use GitHub CLI 2.99.0 or newer to upload images no larger than 10 MB. For one image, write an ordinary Markdown image reference to the local file between the marker comments. Pass the same file to `gh pr create` or `gh pr edit` with `--attach <path>` so GitHub CLI replaces the local path with its hosted URL.
GitHub CLI does not rewrite paths inside HTML attributes. For themed images within its size limit, first upload both files through temporary Markdown image references and repeat `--attach <path>` for each one. Read back the hosted URLs, replace the temporary references with the `<picture>` below, and update the pull request body without `--attach`:
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="HOSTED_DARK_URL">
  <source media="(prefers-color-scheme: light)" srcset="HOSTED_LIGHT_URL">
  <img alt="DESCRIPTION" src="HOSTED_DARK_URL">
</picture>
For every MP4, MOV, or WebM recording, use `node _scripts/releaseNoteMedia.mjs FILE --alt "DESCRIPTION"` regardless of file size so the helper converts it to animated WebP. Use the same command when an image exceeds 10 MB. For a themed pair where either file needs the helper, use `node _scripts/releaseNoteMedia.mjs --dark DARK_FILE --light LIGHT_FILE --alt "DESCRIPTION"`. Paste only its generated markup between the marker comments.
Check for personal information, tokens, private repository names, and unrelated desktop content before uploading. Uploaded media is public.
Keep capture-only scripts, test hooks, screenshots, and recordings out of commits. Remove them before committing unless the capture code is also a reusable regression test. Never commit generated release-note media.
Leave this section empty when media would not help.
-->
<!-- release-note-image:start -->

<!-- release-note-image:end -->

## Testing
<!-- How can reviewers verify that the PR produces correct results? -->
<!-- Please provide instructions so that others can ensure that your pull request would produce correct results. For examples see, https://github.com/FreeTubeApp/FreeTube/pull/5743, https://github.com/FreeTubeApp/FreeTube/pull/7349, https://github.com/FreeTubeApp/FreeTube/pull/5125, https://github.com/FreeTubeApp/FreeTube/pull/7338 -->
<!-- Agent instructions: Only write human-facing steps that explain how to verify the change while running this branch in dev mode. Include expected results and, when applicable, helpful console snippets for interactive verification. Do not include automated checks, commands, results, pass counts, or CI status. -->

## Additional context
<!-- Add any other context about the pull request here. -->
