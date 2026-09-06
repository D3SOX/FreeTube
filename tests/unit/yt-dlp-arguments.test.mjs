import assert from 'node:assert/strict'
import test from 'node:test'
import { buildYtDlpDownloadArguments } from '../../src/ytDlpArguments.js'
import { mapPlaybackCaptions, mapPlaybackFormat } from '../../src/ytDlpMetadata.js'

const videoId = 'jNQXAC9IVRw'

test('desktop and Android download options preserve format, subtitles, clipping, and metadata', () => {
  const { args, truncatesLongTitles } = buildYtDlpDownloadArguments({
    videoId, mode: 'video', quality: '1080', videoCodec: 'h264', videoFormat: 'mp4',
    includeSubtitles: true, embedSubtitles: true, subtitleLanguages: 'en,de', subtitleFormat: 'srt',
    embedThumbnail: true, embedMetadata: true, startTime: '0:10', endTime: '0:15'
  })
  assert.equal(truncatesLongTitles, true)
  for (const [option, value] of [['-S', 'res:1080,codec:h264'], ['--merge-output-format', 'mp4'],
    ['--remux-video', 'mp4'], ['--sub-langs', 'en,de'], ['--sub-format', 'srt/best'],
    ['--download-sections', '*0:10-0:15']]) {
    assert.equal(args[args.indexOf(option) + 1], value)
  }
  assert.ok(args.includes('--embed-subs'))
  assert.ok(args.includes('--embed-thumbnail'))
  assert.ok(args.includes('--embed-metadata'))
  assert.equal(args.at(-1), `https://www.youtube.com/watch?v=${videoId}`)
})

test('audio and subtitle-only downloads use the selected conversion formats', () => {
  const audio = buildYtDlpDownloadArguments({ videoId, mode: 'audio', audioFormat: 'opus' }).args
  assert.ok(audio.includes('--extract-audio'))
  assert.equal(audio[audio.indexOf('--audio-format') + 1], 'opus')
  const subtitles = buildYtDlpDownloadArguments({ videoId, mode: 'subtitles', subtitleFormat: 'vtt', embedMetadata: true }).args
  assert.ok(subtitles.includes('--skip-download'))
  assert.ok(subtitles.includes('--no-quiet'))
  assert.ok(!subtitles.includes('--embed-metadata'))
})

test('local playlists retain order and escape literal title placeholders', () => {
  const args = buildYtDlpDownloadArguments({ videoIds: [videoId, 'BaW_jenozKc'], mode: 'video', isPlaylist: true, title: '100% / Music' }).args
  assert.deepEqual(args.slice(-2), [`https://www.youtube.com/watch?v=${videoId}`, 'https://www.youtube.com/watch?v=BaW_jenozKc'])
  assert.match(args[args.indexOf('--output') + 1], /^100%% _ Music\/.*autonumber/)
})

test('invalid IDs and custom executable overrides cannot reach either runtime', () => {
  assert.throws(() => buildYtDlpDownloadArguments({ videoId: 'bad', mode: 'audio' }), /invalid-video-id/)
  assert.throws(() => buildYtDlpDownloadArguments({ videoIds: Array(501).fill(videoId), mode: 'video' }), /too-many-videos/)
  for (const customArgs of ['--exec "touch /tmp/pwned"', '--ffmpeg-location=/tmp/ffmpeg', '--remote-components ejs:github']) {
    assert.throws(() => buildYtDlpDownloadArguments({ videoId, mode: 'custom', customArgs }), /unsupported-custom-argument/)
    assert.throws(() => buildYtDlpDownloadArguments({ videoId, mode: 'video' }, customArgs), /unsupported-custom-argument/)
  }
})

test('playback mapping retains alternate audio and live stream timing', () => {
  const format = mapPlaybackFormat({ format_id: '140-2', url: 'https://example.test/audio', protocol: 'https', ext: 'm4a',
    acodec: 'mp4a.40.2', vcodec: 'none', language: 'de', tbr: 128.5, available_at: '123', fragments: [{}, {}] })
  assert.equal(format.language, 'de')
  assert.equal(format.bitrate, 128500)
  assert.equal(format.availableAt, 123)
  assert.equal(format.fragmentCount, 2)
  assert.equal(format.height, null)
})

test('caption mapping separates translated tracks and rejects non-HTTPS URLs', () => {
  const result = mapPlaybackCaptions({
    en: { ext: 'vtt', url: 'https://www.youtube.com/api/timedtext?lang=en', name: 'English' },
    de: { ext: 'vtt', url: 'https://www.youtube.com/api/timedtext?lang=en&tlang=de', name: 'German' },
    fr: { ext: 'vtt', url: 'file:///private/cookies.txt' }
  })
  assert.equal(result.captions.length, 1)
  assert.equal(result.captionTranslations.length, 1)
  assert.equal(result.captionTranslations[0].language, 'de')
})
