import { isAllowedTranslationAudioUrl } from './voiceOverTranslationUrls.js'

const MAX_VIDEO_DURATION_SECONDS = 4 * 60 * 60
const MAX_AUDIO_REDIRECTS = 5
const RESPONSE_LANGUAGES = new Set(['ru', 'en', 'kk'])
const YOUTUBE_VIDEO_ID_PATTERN = /^[\w-]{11}$/
export function createVoiceOverTranslationClient(fetchFn) {
  let clientPromise

  function getClient() {
    clientPromise ??= import('@vot.js/core').then(({ default: VOTClient }) => {
      return new VOTClient({
        fetchFn: (input, init) => fetchFn(input, { ...init, credentials: 'omit' })
      })
    })

    return clientPromise
  }

  async function validateTranslationAudioUrl(rawUrl) {
    let audioUrl = new URL(rawUrl)

    for (let redirectCount = 0; redirectCount <= MAX_AUDIO_REDIRECTS; redirectCount++) {
      if (!isAllowedTranslationAudioUrl(audioUrl)) {
        throw new Error(`Voice-over service returned an untrusted audio URL: ${audioUrl.hostname}`)
      }

      const response = await fetchFn(audioUrl.href, {
        credentials: 'omit',
        headers: { Range: 'bytes=0-0' },
        redirect: 'manual'
      })

      if (response.status < 300 || response.status >= 400) {
        await response.body?.cancel()

        if (!response.ok) {
          throw new Error(`Voice-over audio URL returned status ${response.status}`)
        }

        return audioUrl
      }

      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location) {
        throw new Error('Voice-over audio redirect did not include a destination')
      }

      audioUrl = new URL(location, audioUrl)
    }

    throw new Error('Voice-over audio redirected too many times')
  }

  /**
   * Request a translated audio track from the unofficial Yandex VOT API.
   *
   * @param {unknown} payload
   * @returns {Promise<{ translated: boolean, url?: string, remainingTime: number, status: number }>}
   */
  async function requestVoiceOverTranslation(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new TypeError('Invalid voice-over translation request')
    }

    const { videoId, duration, responseLanguage } = payload

    if (typeof videoId !== 'string' || !YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) {
      throw new TypeError('Invalid YouTube video ID')
    }

    if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_VIDEO_DURATION_SECONDS) {
      throw new RangeError('Voice-over translation only supports videos up to four hours long')
    }

    if (!RESPONSE_LANGUAGES.has(responseLanguage)) {
      throw new RangeError('Unsupported voice-over translation language')
    }

    const client = await getClient()
    const result = await client.translateVideo({
      videoData: {
        url: `https://youtu.be/${videoId}`,
        videoId,
        host: 'youtube',
        duration
      },
      requestLang: 'auto',
      responseLang: responseLanguage
    })

    if (result.translated) {
      const translationUrl = await validateTranslationAudioUrl(result.url)

      return {
        translated: true,
        url: translationUrl.href,
        remainingTime: result.remainingTime,
        status: result.status
      }
    }

    return {
      translated: false,
      remainingTime: result.remainingTime,
      status: result.status
    }
  }

  return requestVoiceOverTranslation
}
