// Allow normal differences in encoder padding and duration rounding.
const DURATION_TOLERANCE_MS = 1000

/**
 * YouTube can serve different edits of a video across codecs. Only exclude
 * duration outliers when the audio agrees and a matching video is available.
 * @param {import('youtubei.js').Misc.Format[]} formats
 * @returns {import('youtubei.js').Misc.Format[]}
 */
export function getCompatibleAdaptiveFormats(formats) {
  const audioDurations = formats
    .filter(format => format.has_audio && !format.has_video)
    .map(format => format.approx_duration_ms)
  if (audioDurations.length === 0 || audioDurations.some(duration => !Number.isFinite(duration) || duration <= 0)) {
    return formats
  }

  if (Math.max(...audioDurations) - Math.min(...audioDurations) > DURATION_TOLERANCE_MS) {
    return formats
  }

  const matchesAudio = format => audioDurations.some(duration =>
    Math.abs(format.approx_duration_ms - duration) <= DURATION_TOLERANCE_MS)

  if (!formats.some(format => format.has_video && !format.has_audio && matchesAudio(format))) {
    return formats
  }

  return formats.filter(format => !format.has_video || format.has_audio ||
    !Number.isFinite(format.approx_duration_ms) || format.approx_duration_ms <= 0 || matchesAudio(format))
}
