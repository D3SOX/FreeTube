/** Build the same yt-dlp options for desktop and Android. */
const ID_REGEX = /^[\w-]{11}$/
const PLAYLIST_ID_REGEX = /^[\w-]{10,128}$/
const DOWNLOAD_TITLE_FILENAME_BYTE_LIMIT = 200
const QUALITY_REGEX = /^\d{3,4}$/
const VIDEO_FORMATS = ['mp4', 'mkv', 'webm']
const VIDEO_CODECS = ['h264', 'h265', 'vp9', 'av1']
const AUDIO_FORMATS = ['mp3', 'm4a', 'opus', 'flac']
const SUBTITLE_FORMATS = ['srt', 'vtt', 'ass', 'lrc']
const SPONSORBLOCK_CATEGORIES = ['sponsor', 'intro', 'outro', 'selfpromo', 'interaction', 'music_offtopic', 'preview', 'filler']
// Keeps local-playlist URLs comfortably below Windows' process command-line limit.
const MAX_LOCAL_PLAYLIST_VIDEOS = 500
const DENIED_CUSTOM_ARGS = [
  '--alias',
  '--config-location',
  '--config-locations',
  '--downloader',
  '--downloader-args',
  '--exec',
  '--exec-before-download',
  '--external-downloader',
  '--external-downloader-args',
  '--ffmpeg-location',
  '--plugin-dirs',
  '--remote-components'
]
const TIME_REGEX = /^(?:\d+:)?[0-5]?\d:[0-5]\d(?:\.\d+)?$/
const AUTOMATIC_NUMBER_LIMITS = Object.freeze({
  minDurationSeconds: 31_536_000,
  maxDurationSeconds: 31_536_000,
  minFileSizeMb: 1_000_000,
  maxFileSizeMb: 1_000_000,
  maxAgeDays: 36_500
})
function splitArguments(argsString) {
  const args = []
  const tokenRegex = /"([^"]*)"|'([^']*)'|(\S+)/g

  let match
  while ((match = tokenRegex.exec(argsString)) !== null) {
    args.push(match[1] ?? match[2] ?? match[3])
  }

  return args
}

function automaticNumber(value, maximum) {
  return Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= maximum
    ? Number(value)
    : null
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function automaticTitleRegex(includedTerms, excludedTerms) {
  if (includedTerms.length === 0 && excludedTerms.length === 0) {
    return null
  }

  const include = includedTerms.length === 0
    ? ''
    : `(?=.*(?:${includedTerms.map(escapeRegularExpression).join('|')}))`
  const exclude = excludedTerms.length === 0
    ? ''
    : `(?!.*(?:${excludedTerms.map(escapeRegularExpression).join('|')}))`
  return `(?i)^${include}${exclude}.*$`
}

export function buildYtDlpDownloadArguments(payload, globalArguments = '') {
  if (!payload || !['video', 'audio', 'subtitles', 'custom'].includes(payload.mode)) throw new Error('invalid-download')
  const videoIds = payload.videoIds ?? []
  if (!Array.isArray(videoIds) || videoIds.some(id => typeof id !== 'string' || !ID_REGEX.test(id))) throw new Error('invalid-video-ids')
  if (videoIds.length > MAX_LOCAL_PLAYLIST_VIDEOS) throw new Error('too-many-videos')
  const isRemotePlaylist = payload.isPlaylist === true && typeof payload.playlistId === 'string' && PLAYLIST_ID_REGEX.test(payload.playlistId)
  if (!isRemotePlaylist && !ID_REGEX.test(payload.videoId ?? '') && videoIds.length === 0) throw new Error('invalid-video-id')
  const subtitlesOnly = payload.mode === 'subtitles'
  const subtitleFormat = SUBTITLE_FORMATS.includes(payload.subtitleFormat) ? payload.subtitleFormat : ''
  const customArgs = splitArguments(payload.customArgs || '')
  const globalCustomArgs = splitArguments(globalArguments)
  if ([...globalCustomArgs, ...customArgs].some(arg => DENIED_CUSTOM_ARGS.includes(arg.split('=')[0]))) throw new Error('unsupported-custom-argument')
  const args = [...globalCustomArgs]
  if (!isRemotePlaylist) args.push('--no-playlist')
  let outputTemplate = typeof payload.filenameTemplate === 'string' && payload.filenameTemplate.trim() !== ''
    ? payload.filenameTemplate.trim()
    : '{title} [{id}].{ext}'
  const truncatesLongTitles = outputTemplate.includes('{title}')
  let localPlaylistTitle = typeof payload.title === 'string'
    ? payload.title.replaceAll(/[<>:"/\\|?*]/g, '_')
      .split('').map(character => {
        if (character.charCodeAt(0) < 32) return '_'
        return character
      }).join('')
      .replace(/[. ]+$/, '').slice(0, 120) || 'Playlist'
    : 'Playlist'
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(localPlaylistTitle)) {
    localPlaylistTitle = `_${localPlaylistTitle}`
  }
  localPlaylistTitle = localPlaylistTitle.replaceAll('%', '%%')
  const templateFields = {
    title: `%(title).${DOWNLOAD_TITLE_FILENAME_BYTE_LIMIT}B`,
    author: '%(uploader)s',
    upload_date: '%(upload_date)s',
    id: '%(id)s',
    playlist: isRemotePlaylist ? '%(playlist_title)s' : localPlaylistTitle,
    playlist_index: isRemotePlaylist ? '%(playlist_index)03d' : '%(autonumber)03d',
    ext: '%(ext)s'
  }
  for (const [field, replacement] of Object.entries(templateFields)) {
    outputTemplate = outputTemplate.replaceAll(`{${field}}`, replacement)
  }
  if (!outputTemplate.includes('%(ext)')) {
    outputTemplate += '.%(ext)s'
  }
  if (payload.isPlaylist === true && !outputTemplate.includes('%(playlist') && !outputTemplate.startsWith(`${localPlaylistTitle}/`)) {
    outputTemplate = isRemotePlaylist
      ? `%(playlist_title)s/%(playlist_index)03d - ${outputTemplate}`
      : `${localPlaylistTitle}/%(autonumber)03d - ${outputTemplate}`
  }
  args.push('--output', outputTemplate)

  switch (payload.mode) {
    case 'video': {
      const formatSorting = []
      if (typeof payload.quality === 'string' && QUALITY_REGEX.test(payload.quality)) {
        formatSorting.push(`res:${payload.quality}`)
      }
      if (typeof payload.videoCodec === 'string' && VIDEO_CODECS.includes(payload.videoCodec)) {
        formatSorting.push(`codec:${payload.videoCodec}`)
      }
      if (formatSorting.length > 0) {
        args.push('-S', formatSorting.join(','))
      }
      if (typeof payload.videoFormat === 'string' && VIDEO_FORMATS.includes(payload.videoFormat)) {
        args.push('--merge-output-format', payload.videoFormat, '--remux-video', payload.videoFormat)
      }
      break
    }
    case 'audio':
      args.push('--extract-audio')
      if (typeof payload.audioFormat === 'string' && AUDIO_FORMATS.includes(payload.audioFormat)) {
        args.push('--audio-format', payload.audioFormat)
      }
      break
    case 'subtitles':
      // `--print` turns on quiet mode, which hides the lines naming the written
      // subtitle files. Nothing else reports them, as only the media file yt-dlp
      // isn't downloading here would reach the `after_move` print below.
      args.push('--skip-download', '--no-quiet')
      break
    case 'custom':
      break
  }

  if (!subtitlesOnly && payload.splitChapters === true) {
    args.push('--split-chapters')
  }
  if (!subtitlesOnly && payload.removeSponsorblock === true) {
    const categories = Array.isArray(payload.sponsorBlockCategories)
      ? payload.sponsorBlockCategories.filter(category => SPONSORBLOCK_CATEGORIES.includes(category))
      : SPONSORBLOCK_CATEGORIES
    if (categories.length > 0) args.push('--sponsorblock-remove', categories.join(','))
  }
  if (subtitlesOnly || payload.includeSubtitles === true) {
    // YouTube advertises a machine translation of every subtitle track into every other
    // language, which multiplies a language selector like `de.*` into dozens of requests
    // and runs into its rate limiting. Custom arguments can override this again.
    args.push('--write-subs', '--write-auto-subs', '--extractor-args', 'youtube:skip=translated_subs')
    if (!subtitlesOnly && payload.embedSubtitles === true) {
      args.push('--embed-subs')
    }
    if (typeof payload.subtitleLanguages === 'string' && payload.subtitleLanguages.trim() !== '') {
      args.push('--sub-langs', payload.subtitleLanguages.trim())
    }
    if (subtitleFormat !== '') {
      // YouTube serves most formats itself, so prefer downloading the requested one directly.
      // The converter only runs once every track has downloaded, so it would otherwise leave
      // the original files behind whenever a download fails partway through.
      args.push('--sub-format', `${subtitleFormat}/best`, '--convert-subs', subtitleFormat)
    }
  }
  if (!subtitlesOnly && payload.embedThumbnail === true) {
    args.push('--embed-thumbnail')
  }
  if (!subtitlesOnly && payload.embedMetadata === true) {
    args.push('--embed-metadata', '--embed-chapters')
  }
  if (payload.automatic === true) {
    const minDurationSeconds = automaticNumber(payload.minDurationSeconds, AUTOMATIC_NUMBER_LIMITS.minDurationSeconds)
    const maxDurationSeconds = automaticNumber(payload.maxDurationSeconds, AUTOMATIC_NUMBER_LIMITS.maxDurationSeconds)
    const minFileSizeMb = automaticNumber(payload.minFileSizeMb, AUTOMATIC_NUMBER_LIMITS.minFileSizeMb)
    const maxFileSizeMb = automaticNumber(payload.maxFileSizeMb, AUTOMATIC_NUMBER_LIMITS.maxFileSizeMb)
    const maxAgeDays = automaticNumber(payload.maxAgeDays, AUTOMATIC_NUMBER_LIMITS.maxAgeDays)
    const titleRegex = automaticTitleRegex(
      Array.isArray(payload.titleIncludes) ? payload.titleIncludes : [],
      Array.isArray(payload.titleExcludes) ? payload.titleExcludes : []
    )
    const durationFilters = [
      `channel_id = ${payload.channelId}`,
      minDurationSeconds === null ? null : `duration >= ${minDurationSeconds}`,
      maxDurationSeconds === null ? null : `duration <= ${maxDurationSeconds}`
    ].filter(Boolean)

    if (durationFilters.length > 0) args.push('--match-filter', durationFilters.join(' & '))
    if (minFileSizeMb !== null) args.push('--min-filesize', `${minFileSizeMb}M`)
    if (maxFileSizeMb !== null) args.push('--max-filesize', `${maxFileSizeMb}M`)
    if (maxAgeDays !== null) args.push('--dateafter', `now-${Math.ceil(maxAgeDays)}days`)
    if (titleRegex !== null) args.push('--match-title', titleRegex)
    args.push('--no-overwrites')
  }
  const startTime = !subtitlesOnly && typeof payload.startTime === 'string' && TIME_REGEX.test(payload.startTime) ? payload.startTime : ''
  const endTime = !subtitlesOnly && typeof payload.endTime === 'string' && TIME_REGEX.test(payload.endTime) ? payload.endTime : ''
  if (startTime !== '' || endTime !== '') {
    args.push('--download-sections', `*${startTime || '0'}-${endTime || 'inf'}`, '--force-keyframes-at-cuts')
  }
  args.push(...customArgs)

  if (isRemotePlaylist) {
    args.push(`https://www.youtube.com/playlist?list=${payload.playlistId}`)
  } else if (videoIds.length > 0) {
    args.push(...videoIds.map(videoId => `https://www.youtube.com/watch?v=${videoId}`))
  } else {
    args.push(`https://www.youtube.com/watch?v=${payload.videoId}`)
  }

  return { args, truncatesLongTitles }
}
