import shaka from 'shaka-player'
import { createSabrTransport } from './SabrSchemePlugin'
import { parseMp4SegmentIndex } from './Mp4SegmentIndexParser'
import { parseWebmSegmentIndex } from './WebmSegmentIndexParser'
import { createAndroidSabrDashManifest } from './androidSabrManifest'
import { createAndroidSabrRangeReader } from './androidSabrRanges'
import { parseSabrFormatId } from './sabrProtocol'

const formatId = format => `${format.itag}-${format.lastModified ?? '0'}-${format.xtags ?? ''}`

/** A SABR source for Media3, using the same protocol and indexes as desktop. */
export function createAndroidSabrSource({ manifest, sabrData, owner, audioOnly = false, getState }) {
  const formats = manifest.formats
  const supported = formats.filter(format => format.xtags !== 'CgcKAnZiEgEx')
  let audio = supported.filter(format => format.mimeType.startsWith('audio/'))
    .sort((a, b) => Number(!!b.isOriginal) - Number(!!a.isOriginal) || b.bitrate - a.bitrate)[0]
  let video = supported.filter(format => format.mimeType.startsWith('video/'))
    .sort((a, b) => a.bitrate - b.bitrate)[0]
  if (!audio || !video) throw new Error('SABR requires audio and video format metadata')
  const byId = new Map(supported.map(format => [formatId(format), format]))
  const indexes = new Map()
  const initializations = new Map()
  let closed = false

  const transport = createSabrTransport(sabrData, (uri) => {
    if (closed) return null
    const url = new URL(uri)
    const requested = byId.get(url.searchParams.get('formatId'))
    if (!requested) throw new Error('Unknown SABR format')
    const isAudio = requested.mimeType.startsWith('audio/')
    if (isAudio) audio = requested
    else video = requested
    const state = getState()
    // Each Media3 loader requests one track. Tell SABR the other track is full
    // so it does not return duplicate audio or video with that request.
    const bufferedRanges = url.searchParams.has('init')
      ? []
      : [{
          formatId: parseSabrFormatId(formatId(isAudio ? video : audio)),
          durationMs: '2147483647',
          startTimeMs: '0',
          startSegmentIndex: 2147483647,
          endSegmentIndex: 2147483647,
          timeRange: { durationTicks: '2147483647', startTicks: '0', timescale: 1000 },
        }]
    return {
      audioFormatId: parseSabrFormatId(formatId(audio)),
      videoFormatId: parseSabrFormatId(formatId(video)),
      bufferedRanges,
      drcEnabled: !!audio.isDrc,
      enableVoiceBoost: !!audio.isVoiceBoost,
      bandwidthEstimate: state.estimatedBandwidth ?? 2400000,
      playbackRate: state.playbackRate ?? 1,
      width: state.width ?? 0,
      height: state.height ?? 0,
    }
  })

  function resourceUrl(index) {
    const format = formats[index]
    const type = format.mimeType.split('/')[0]
    const url = new URL(`${manifest.scheme}:${type}`)
    url.searchParams.set('formatId', formatId(format))
    if (format.isDrc) url.searchParams.set('drc', '')
    if (format.isVoiceBoost) url.searchParams.set('vb', '')
    if (type === 'video') url.searchParams.set('resolution', String(format.height || 360))
    return url.toString()
  }

  async function fetchBytes(uri) {
    if (closed) throw new Error('SABR source was closed')
    const request = shaka.net.NetworkingEngine.makeRequest([uri], shaka.net.NetworkingEngine.defaultRetryParameters())
    const response = await transport.request(uri, request, shaka.net.NetworkingEngine.RequestType.SEGMENT).promise
    if (closed) throw new Error('SABR source was closed')
    return new Uint8Array(shaka.util.BufferUtils.toArrayBuffer(response.data))
  }

  function readInitialization(index) {
    if (!initializations.has(index)) {
      initializations.set(index, fetchBytes(`${resourceUrl(index)}&init`).catch(error => {
        initializations.delete(index)
        throw error
      }))
    }
    return initializations.get(index)
  }

  async function getReferences(index) {
    if (!indexes.has(index)) {
      const bytes = await readInitialization(index)
      const format = formats[index]
      const init = bytes.slice(format.initRange.start, format.initRange.end + 1)
      const cues = bytes.slice(format.indexRange.start, format.indexRange.end + 1)
      const uri = resourceUrl(index)
      const reference = new shaka.media.InitSegmentReference(() => [`${uri}&init`],
        format.initRange.start, format.initRange.end)
      const references = format.mimeType.startsWith('audio/webm') || format.mimeType.startsWith('video/webm')
        ? parseWebmSegmentIndex(cues, init, uri, reference, 0, 0, manifest.duration)
        : parseMp4SegmentIndex(cues, format.indexRange.start, uri, reference, 0, 0, manifest.duration)
      indexes.set(index, references)
    }
    return indexes.get(index)
  }

  const mpd = createAndroidSabrDashManifest(manifest, owner, audioOnly)
  return {
    source: `data:application/dash+xml;charset=utf-8,${encodeURIComponent(mpd)}`,
    mimeType: 'application/dash+xml',
    read: createAndroidSabrRangeReader({
      owner,
      formats,
      readInitialization,
      getReferences,
      readSegment: (_index, reference) => fetchBytes(reference.getUris()[0]),
    }),
    onBackoffRequested: transport.onBackoffRequested,
    onReloadOnce: transport.onReloadOnce,
    close() {
      closed = true
      transport.cleanup()
      indexes.clear()
      initializations.clear()
    },
  }
}
