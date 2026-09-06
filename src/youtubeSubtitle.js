/**
 * Only YouTube's subtitle endpoint may use the configured playback cookies.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isYouTubeSubtitleUrl(value) {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'www.youtube.com' &&
      url.port === '' && url.username === '' && url.password === '' &&
      url.pathname === '/api/timedtext' && ['vtt', 'srt'].includes(url.searchParams.get('fmt'))
  } catch {
    return false
  }
}
