const TRANSLATION_AUDIO_HOST_PATTERNS = [
  /(^|\.)strm\.yandex\.net$/,
  /(^|\.)strm\.yandex\.ru$/,
  /^vtrans\.s3-private\.mds\.yandex\.net$/,
  /^storage\.yandexcloud\.net$/,
]

export function isAllowedTranslationAudioUrl(url) {
  return url.protocol === 'https:' &&
    TRANSLATION_AUDIO_HOST_PATTERNS.some(pattern => pattern.test(url.hostname))
}
