import { chmod, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect } from '../../helpers/app.mjs'
import { activeTab, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({ seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

const subtitleUrl = 'https://www.youtube.com/api/timedtext?v=eeeeeeeeeee&lang=en&tlang=de&fmt=vtt&pot=test-token'
const srt = '1\n00:00:00,000 --> 00:00:10,000\nCookie-authenticated subtitle\n'
const vtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:10.000\nCookie-authenticated subtitle\n'

test('downloads only opted-in YouTube subtitles with the selected cookie source', async ({ app, page }) => {
  test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')
  const executable = path.join(app.userDataDir, 'subtitle-yt-dlp.sh')
  const capturedArgs = path.join(app.userDataDir, 'subtitle-args.txt')
  const capturedInfo = path.join(app.userDataDir, 'subtitle-info.json')
  await writeFile(executable, [
    '#!/bin/sh',
    `printf '%s\\n' "$@" > '${capturedArgs}'`,
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    `    --load-info-json) shift; cp "$1" '${capturedInfo}';;`,
    '    --output) shift; output="$1";;',
    '    --sub-format) shift; format="$1";;',
    '  esac',
    '  shift',
    'done',
    'if [ "$format" = srt ]; then',
    `  printf '%s' '${srt}' > "$output.caption.srt"`,
    'else',
    `  printf '%s' '${vtt}' > "$output.caption.vtt"`,
    'fi',
  ].join('\n'))
  await chmod(executable, 0o755)
  await page.evaluate(async (executable) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateYtDlpPath', executable)
    await store.dispatch('updateYtDlpPlaybackAuthMode', 'browser')
    await store.dispatch('updateYtDlpPlaybackCookiesBrowser', 'firefox')
    await store.dispatch('updateYtDlpPlaybackCookiesBrowserProfile', '/tmp/test-profile')
  }, executable)
  expect(await page.evaluate(url => window.ftElectron.ytDlpGetSubtitle(url), subtitleUrl)).toBeNull()
  await expect(readFile(capturedArgs)).rejects.toThrow()

  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateYtDlpSubtitleUseCookies', true)
  })
  expect(await page.evaluate(url => window.ftElectron.ytDlpGetSubtitle(url), subtitleUrl)).toBe(vtt)
  let args = (await readFile(capturedArgs, 'utf8')).trim().split('\n')
  expect(args[args.indexOf('--cookies-from-browser') + 1]).toBe('firefox:/tmp/test-profile')
  expect(args).toContain('--ignore-config')
  expect(args).toContain('--skip-download')
  expect(JSON.parse(await readFile(capturedInfo, 'utf8')).subtitles.caption).toEqual([{ url: subtitleUrl, ext: 'vtt' }])
  await expect(readdir(path.dirname(args[args.indexOf('--load-info-json') + 1]))).rejects.toThrow()

  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateYtDlpSubtitleUseCookies', false)
    await store.dispatch('updateYtDlpPlaybackAlwaysUseCookies', true)
    await store.dispatch('updateYtDlpPlaybackAuthMode', 'file')
    await store.dispatch('updateYtDlpPlaybackCookiesPath', '/tmp/test-cookies.txt')
  })
  expect(await page.evaluate(url => window.ftElectron.ytDlpGetSubtitle(url), subtitleUrl)).toBe(vtt)
  expect(await page.evaluate(url => window.ftElectron.ytDlpGetSubtitle(url), subtitleUrl.replace('fmt=vtt', 'fmt=srt'))).toBe(srt)
  args = (await readFile(capturedArgs, 'utf8')).trim().split('\n')
  expect(args[args.indexOf('--cookies') + 1]).toBe('/tmp/test-cookies.txt')
  expect(args).not.toContain('--cookies-from-browser')
  for (const invalid of [subtitleUrl.replace('www.youtube.com', 'example.com'), 'file:///tmp/test-cookies.txt']) {
    expect(await page.evaluate(url => window.ftElectron.ytDlpGetSubtitle(url), invalid)).toBeNull()
  }

  await writeFile(executable, '#!/bin/sh\necho "Cookie: private-value" >&2\nexit 1\n')
  expect(await page.evaluate(url => window.ftElectron.ytDlpGetSubtitle(url), subtitleUrl)).toEqual({
    error: 'Unable to load subtitle with configured cookies'
  })
})

for (const setting of ['updateYtDlpSubtitleUseCookies', 'updateYtDlpPlaybackAlwaysUseCookies']) {
  test(`uses cookies for player translations and transcripts with ${setting}`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { captionTranslations: true })
    await app.electronApp.evaluate(({ ipcMain }, { vtt, srt }) => {
      globalThis.subtitleCookieRequests = []
      ipcMain.removeHandler('yt-dlp-get-subtitle')
      ipcMain.handle('yt-dlp-get-subtitle', (_event, url) => {
        globalThis.subtitleCookieRequests.push(url)
        return new URL(url).searchParams.get('fmt') === 'srt' ? srt : vtt
      })
    }, { vtt, srt })
    await page.evaluate(async setting => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch(setting, true)
    }, setting)
    await openMockedVideo(page)
    const player = page.locator(`${activeTab} .ftVideoPlayer`)
    await expect(player).toBeVisible()
    await expect.poll(() => player.evaluate(element => element.ui?.getControls().getPlayer().getTextTracks().length ?? 0)).toBeGreaterThan(0)
    await player.hover()
    await player.getByRole('button', { name: 'More settings' }).click()
    await player.locator('.shaka-overflow-menu').getByRole('button', { name: 'Captions' }).click()
    await player.locator('.shaka-text-languages').getByRole('button', { name: 'Auto-translate' }).click()
    await player.locator('.ft-caption-translation-options').getByRole('button', { name: 'German', exact: true }).click()
    await expect.poll(() => app.electronApp.evaluate(() => globalThis.subtitleCookieRequests.some(url => new URL(url).searchParams.get('tlang') === 'de'))).toBe(true)
    await expect.poll(() => player.evaluate(element => element.ui.getControls().getPlayer().getTextTracks().some(track => track.active && track.language === 'de'))).toBe(true)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Show transcript', exact: true }).click()
    await expect(page.locator('.watchVideoTranscript')).toContainText('Cookie-authenticated subtitle')
  })
}
