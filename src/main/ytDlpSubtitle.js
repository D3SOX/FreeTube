import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const MAX_SUBTITLE_BYTES = 8 * 1024 * 1024

/**
 * Downloads one already-selected subtitle with yt-dlp's cookie jar. The caller
 * validates the URL and supplies authentication and proxy arguments.
 * @param {string} executable
 * @param {string[]} args
 * @param {string} url
 * @param {string} temporaryRoot
 * @returns {Promise<string>}
 */
export async function downloadYtDlpSubtitle(executable, args, url, temporaryRoot) {
  const format = new URL(url).searchParams.get('fmt') === 'srt' ? 'srt' : 'vtt'
  const directory = await mkdtemp(join(temporaryRoot, 'opentubex-subtitle-'))
  try {
    const infoPath = join(directory, 'info.json')
    // Loading just this track preserves the selected source language, translation
    // and PO token without extracting or downloading the video again.
    await writeFile(infoPath, JSON.stringify({
      id: 'subtitle',
      title: 'subtitle',
      extractor: 'youtube',
      subtitles: { caption: [{ url, ext: format }] }
    }), { mode: 0o600 })

    await execFileAsync(executable, [
      '--ignore-config',
      '--no-playlist',
      '--no-progress',
      '--socket-timeout', '15',
      '--retries', '0',
      '--skip-download',
      '--ignore-no-formats-error',
      '--write-subs',
      '--sub-langs', 'caption',
      '--sub-format', format,
      '--load-info-json', infoPath,
      '--output', join(directory, 'subtitle'),
      ...args
    ], { timeout: 60_000, maxBuffer: 1024 * 1024, windowsHide: true })

    const subtitlePath = join(directory, `subtitle.caption.${format}`)
    if ((await stat(subtitlePath)).size > MAX_SUBTITLE_BYTES) {
      throw new Error('Subtitle exceeds size limit')
    }
    const text = await readFile(subtitlePath, 'utf8')
    const valid = format === 'vtt'
      ? /^\uFEFF?WEBVTT(?:[\t \r\n]|$)/.test(text)
      : /^\uFEFF?\s*\d+\s*\r?\n\d{2,}:\d{2}:\d{2},\d{3} --> \d{2,}:\d{2}:\d{2},\d{3}/.test(text)
    if (!valid) {
      throw new Error('Invalid subtitle')
    }
    return text
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
