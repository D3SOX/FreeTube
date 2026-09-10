import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { FormatUtils, Misc } from 'youtubei.js'
import { getCompatibleAdaptiveFormats } from '../../src/renderer/helpers/player/compatibleAdaptiveFormats.js'

function format(itag, duration, codec = 'avc1.4d401f') {
  const audio = codec === 'mp4a.40.2'
  return new Misc.Format({
    itag,
    mimeType: `${audio ? 'audio' : 'video'}/mp4; codecs="${codec}"`,
    bitrate: 128000,
    url: `https://example.com/videoplayback?itag=${itag}`,
    approxDurationMs: duration,
    initRange: { start: 0, end: 99 },
    indexRange: { start: 100, end: 199 },
    ...(audio
      ? { audioQuality: 'AUDIO_QUALITY_MEDIUM', audioSampleRate: 44100, audioChannels: 2 }
      : { qualityLabel: '480p', width: 854, height: 480, fps: 30 })
  })
}

test('excludes the stale AV1 edit from the DASH manifest for issue #1263', async () => {
  // Durations from w9P1BPt16-A. Around 02:00:03, AV1 contains 24 extra
  // seconds of footage absent from H.264, VP9 and every audio rendition.
  const formats = [
    format(140, 11570386, 'mp4a.40.2'),
    format(135, 11570336),
    format(397, 11594326, 'av01.0.04M.08')
  ]
  const manifest = await FormatUtils.toDash({
    adaptive_formats: getCompatibleAdaptiveFormats(formats)
  })
  assert.match(manifest, /Representation id="135"/)
  assert.match(manifest, /Representation id="140"/)
  assert.doesNotMatch(manifest, /Representation id="397"/)
  assert.equal(formats.length, 3, 'does not mutate the extracted formats')
})

test('retains encoder padding differences and matching AV1 streams', () => {
  const formats = [format(140, 600150, 'mp4a.40.2'), format(135, 600000), format(397, 600050, 'av01.0.04M.08')]
  assert.deepEqual(getCompatibleAdaptiveFormats(formats), formats)
})

test('the built-in DASH path excludes stale video using youtubei.js filter semantics', async () => {
  const source = readFileSync(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
  const method = source.match(/createLocalDashManifest: (async function \(videoInfo, includeThumbnails = false\) \{[\s\S]*?\n    \}),/)[1]
  const createManifest = new Function('getCompatibleAdaptiveFormats', `return (${method})`)(getCompatibleAdaptiveFormats)
  const streamingData = { adaptive_formats: [
    format(140, 11570386, 'mp4a.40.2'), format(135, 11570336), format(397, 11594326, 'av01.0.04M.08')
  ] }
  const uri = await createManifest({
    streaming_data: streamingData,
    toDash: options => FormatUtils.toDash(streamingData, false, undefined, options.format_filter)
  })
  const manifest = decodeURIComponent(uri.slice(uri.indexOf(',') + 1))
  assert.match(manifest, /Representation id="135"/)
  assert.match(manifest, /Representation id="140"/)
  assert.doesNotMatch(manifest, /Representation id="397"/)
})

test('does not guess when durations are missing, audio disagrees, or no video matches', () => {
  for (const formats of [
    [format(135, 600000), format(397, 624000)],
    [format(140, undefined, 'mp4a.40.2'), format(135, 600000), format(397, 624000)],
    [format(140, 600000, 'mp4a.40.2'), format(141, 624000, 'mp4a.40.2'), format(135, 600000), format(397, 624000)],
    [format(140, 600000, 'mp4a.40.2'), format(397, 624000)],
    [format(140, 600000, 'mp4a.40.2'), format(135, 600000), format(397, undefined)]
  ]) {
    assert.deepEqual(getCompatibleAdaptiveFormats(formats), formats)
  }
})

test('excludes mismatched video regardless of codec or whether it is shorter', () => {
  const audio = format(140, 600000, 'mp4a.40.2')
  const matching = format(397, 600000, 'av01.0.04M.08')
  assert.deepEqual(getCompatibleAdaptiveFormats([audio, format(135, 576000), matching]), [audio, matching])
})
