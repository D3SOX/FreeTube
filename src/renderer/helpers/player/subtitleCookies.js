import { isYouTubeSubtitleUrl } from '../../../youtubeSubtitle.js'

/**
 * @param {string} url
 * @param {Record<string, unknown>} getters
 * @param {{ ytDlpGetSubtitle: (url: string) => Promise<string | { error: string } | null> } | null} [bridge]
 * @returns {Promise<string>}
 */
export async function getSubtitleRequestUrl(url, getters, bridge) {
  if (!(getters.getYtDlpPlaybackAlwaysUseCookies || getters.getYtDlpSubtitleUseCookies) ||
    !isYouTubeSubtitleUrl(url)) {
    return url
  }

  if (bridge === undefined) {
    bridge = process.env.IS_CAPACITOR
      ? (await import('../ytDlp')).ytDlp
      : globalThis.window?.ftElectron
  }
  if (!bridge) return url

  const result = await bridge.ytDlpGetSubtitle(url)
  if (result === null) return url
  if (typeof result !== 'string') throw new Error(result.error)
  const params = new URL(url).searchParams
  const mimeType = params.get('fmt') === 'srt' ? 'text/srt' : 'text/vtt'
  // The data URL hides the YouTube URL from Shaka's response filter, so apply
  // its automatic-caption positioning correction before handing over the text.
  const text = mimeType === 'text/vtt' && params.get('caps') === 'asr' && params.get('kind') === 'asr'
    ? result.replaceAll(/ align:start position:(?:10)?0%$/gm, '')
    : result
  return `data:${mimeType};charset=utf-8,${encodeURIComponent(text)}`
}
