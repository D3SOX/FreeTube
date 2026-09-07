function xml(value) {
  return String(value).replaceAll(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character])
}

function byteRange(range) {
  if (!Number.isSafeInteger(range?.start) || !Number.isSafeInteger(range?.end) ||
    range.start < 0 || range.end < range.start) {
    throw new Error('Invalid SABR byte range')
  }
  return `${range.start}-${range.end}`
}

/**
 * Exposes SABR's existing init/index ranges to Media3's DASH extractor. Native
 * range requests are resolved to SABR segments without replacing the player.
 * @param {import('./SabrManifestParser').SabrManifest} manifest
 * @param {string} owner
 * @param {boolean} audioOnly
 * @returns {string}
 */
export function createAndroidSabrDashManifest(manifest, owner, audioOnly = false) {
  if (!/^[a-z0-9-]+$/.test(owner)) throw new Error('Invalid native playback owner')
  if (!Number.isFinite(manifest.duration) || manifest.duration <= 0) {
    throw new Error('Native SABR requires a finite positive duration')
  }
  const groups = new Map()
  manifest.formats.forEach((format, index) => {
    const [mimeType] = format.mimeType.split(';')
    if (audioOnly && mimeType.startsWith('video/')) return
    // This SABR variant is also excluded by the existing Shaka parser.
    if (format.xtags === 'CgcKAnZiEgEx') return
    const key = JSON.stringify([mimeType, format.language, format.label,
      format.isDrc, format.isVoiceBoost, format.isOriginal, format.isDescriptive])
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push({ format, index, mimeType })
  })

  const sets = [...groups.values()].map((formats, groupIndex) => {
    const { format: first, mimeType } = formats[0]
    const language = first.language ? ` lang="${xml(first.language)}"` : ''
    const label = first.label ? `<Label>${xml(first.label)}</Label>` : ''
    const role = first.isOriginal
      ? '<Role schemeIdUri="urn:mpeg:dash:role:2011" value="main"/>'
      : ''
    const representations = formats.map(({ format, index }) => {
      const codecs = format.mimeType.match(/codecs="?([^";]+)"?/)?.[1]
      if (!codecs) throw new Error('SABR format has no codec')
      const dimensions = format.width && format.height
        ? ` width="${xml(format.width)}" height="${xml(format.height)}" frameRate="${xml(format.frameRate ?? 30)}"`
        : ''
      const sampleRate = format.audioSampleRate ? ` audioSamplingRate="${xml(format.audioSampleRate)}"` : ''
      const channels = format.audioChannels
        ? `<AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="${xml(format.audioChannels)}"/>`
        : ''
      return `<Representation id="${index}" bandwidth="${xml(format.bitrate)}" codecs="${xml(codecs)}"${dimensions}${sampleRate}>` +
        `<BaseURL>otxsabr://${owner}/${index}</BaseURL>${channels}` +
        `<SegmentBase indexRange="${byteRange(format.indexRange)}" indexRangeExact="true">` +
        `<Initialization range="${byteRange(format.initRange)}"/></SegmentBase></Representation>`
    }).join('')
    return `<AdaptationSet id="${groupIndex}" mimeType="${xml(mimeType)}" segmentAlignment="true"${language}>` +
      `${label}${role}${representations}</AdaptationSet>`
  }).join('')

  return '<?xml version="1.0" encoding="UTF-8"?>' +
    '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" ' +
    `minBufferTime="PT1S" mediaPresentationDuration="PT${manifest.duration}S">` +
    `<Period duration="PT${manifest.duration}S">${sets}</Period></MPD>`
}
