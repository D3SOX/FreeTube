import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getDefaultAudioVariants } from '../../src/renderer/helpers/player/defaultAudioTrack.js'
import { preferOriginalHlsAudio } from '../../src/renderer/helpers/player/hlsAudioTracks.js'

test('prefers the original HLS audio within each group and preserves quoted commas', () => {
  const dub = '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="234",NAME="Arabic, dubbed",URI="ar.m3u8?a=1,b=2",YT-EXT-AUDIO-CONTENT-ID="ar.10",DEFAULT=YES,AUTOSELECT=YES'
  const original = '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="234",NAME="English original",YT-EXT-AUDIO-CONTENT-ID="en-US.4",DEFAULT=NO,AUTOSELECT=NO'
  const otherGroup = dub.replace('"234"', '"233"')
  const subtitles = '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="234",DEFAULT=YES'
  const manifest = ['#EXTM3U', dub, original, otherGroup, subtitles, ''].join('\n')
  assert.equal(preferOriginalHlsAudio(manifest), [
    '#EXTM3U',
    dub.replace('DEFAULT=YES', 'DEFAULT=NO'),
    original.replace('DEFAULT=NO', 'DEFAULT=YES').replace('AUTOSELECT=NO', 'AUTOSELECT=YES'),
    otherGroup,
    subtitles,
    ''
  ].join('\n'))
})

test('leaves HLS without YouTube original-track metadata unchanged', () => {
  const manifest = '#EXTM3U\r\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English original",DEFAULT=NO\r\n'
  assert.equal(preferOriginalHlsAudio(manifest), manifest)
})

test('selects DASH/SABR main audio and HLS primary audio without discarding unlabelled streams', () => {
  const dub = { audioRoles: ['dub'], primary: false }
  const main = { audioRoles: ['main'], primary: false }
  const hlsOriginal = { audioRoles: [], primary: true }
  assert.deepEqual(getDefaultAudioVariants([dub, main]), [main])
  assert.deepEqual(getDefaultAudioVariants([dub, hlsOriginal]), [hlsOriginal])
  assert.deepEqual(getDefaultAudioVariants([dub]), [dub])
  assert.deepEqual(getDefaultAudioVariants([]), [])
})
