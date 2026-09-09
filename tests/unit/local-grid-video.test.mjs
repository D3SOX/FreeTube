import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { Utils, YTNodes } from 'youtubei.js'

// The API module imports platform services through webpack. Exercise its actual
// parser with isolated metadata helpers so unavailable clips need no services.
const source = await readFile(new URL('../../src/renderer/helpers/api/local.js', import.meta.url), 'utf8')
const start = source.indexOf('export function parseLocalListVideo(')
const parserSource = source.slice(start, source.indexOf('\n}\n', start) + 2).replace('export ', '')
const parseLocalListVideo = vm.runInNewContext(`${parserSource}\nparseLocalListVideo`, {
  Utils,
  calculatePublishedDate: () => '2026-09-09',
  getThumbnailPreviewUrl: () => undefined,
})

for (const videoId of [null, undefined, '']) {
  test(`skips an unavailable grid clip with ${String(videoId)} video ID`, () => {
    const clip = new YTNodes.GridVideo({
      videoId,
      title: { simpleText: 'Unavailable clip' },
      thumbnailOverlays: [],
    })
    assert.equal(parseLocalListVideo(clip), null)
  })
}

test('parses an available grid video and preserves channel fallbacks', () => {
  const video = new YTNodes.GridVideo({
    videoId: 'available-id',
    title: { simpleText: ' Available clip ' },
    lengthText: { simpleText: '1:23' },
    thumbnailOverlays: [],
  })
  const result = parseLocalListVideo(video, 'channel-id', 'Channel')

  assert.equal(result.videoId, 'available-id')
  assert.equal(result.title, 'Available clip')
  assert.equal(result.authorId, 'channel-id')
  assert.equal(result.author, 'Channel')
  assert.equal(result.lengthSeconds, 83)
  assert.equal(result.liveNow, false)
})
