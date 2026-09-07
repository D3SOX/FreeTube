import { registerPlugin } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { normalizeYtDlpPlaybackCacheMaxEntrySize } from '../../ytDlpPlaybackCacheSettings'
import store from '../store/index'
import { getDownloadTemplateOptions } from './downloadTemplates'
import { normalizeAutomaticDownloadRule, parseAutomaticDownloadRules } from './automaticDownloadRules'
import { buildYtDlpDownloadArguments } from '../../ytDlpArguments'
import { PLAYBACK_INFO_OUTPUT_TEMPLATE, mapPlaybackFormat, mapPlaybackCaptions, toFiniteNumber, toNonEmptyString } from '../../ytDlpMetadata'
import { buildYtDlpStoryboardVtt } from '../../main/ytDlpStoryboard'
import { isYouTubeSubtitleUrl } from '../../youtubeSubtitle'

const native = process.env.IS_CAPACITOR ? registerPlugin('YtDlp') : null

function configuration() {
  const rules = {}
  let templates = []
  try {
    const parsed = JSON.parse(store.getters.getYtDlpDownloadTemplates || '[]')
    if (Array.isArray(parsed)) templates = parsed.filter(template => template && typeof template === 'object')
  } catch (error) { console.warn('Invalid download templates', error) }
  for (const [channelId, rawRule] of Object.entries(parseAutomaticDownloadRules(store.getters.getYtDlpAutomaticDownloadRules))) {
    if (!rawRule || typeof rawRule !== 'object') continue
    const rule = normalizeAutomaticDownloadRule(rawRule)
    const options = getDownloadTemplateOptions(rule.template, templates)
    if (options === null || !/^UC[\w-]{22}$/.test(channelId)) continue
    const payload = {
      ...options,
      ...rule,
      videoId: '___________',
      channelId,
      automatic: true,
      titleIncludes: rule.titleIncludes.split(',').map(term => term.trim()).filter(Boolean),
      titleExcludes: rule.titleExcludes.split(',').map(term => term.trim()).filter(Boolean)
    }
    try {
      rules[channelId] = { rule, payload, args: buildYtDlpDownloadArguments(payload, store.getters.getYtDlpDownloadCustomArgs).args }
    } catch (error) { console.warn('Invalid automatic download options', error) }
  }
  return {
    rules,
    concurrency: store.getters.getYtDlpMaxConcurrentDownloads,
    bandwidth: store.getters.getYtDlpDownloadBandwidthLimit,
    folder: store.getters.getYtDlpDownloadFolderPath,
    channel: store.getters.getYtDlpChannel,
    enabled: store.getters.getEnableDownloads,
  }
}

async function extract(args, useAuthentication = false) {
  const cookies = useAuthentication && store.getters.getYtDlpPlaybackAuthMode === 'file'
    ? store.getters.getYtDlpPlaybackCookiesPath
    : ''
  if (useAuthentication && !cookies) throw new Error('yt-dlp playback authentication is not configured')
  const { stdout } = await native.extract({ args, cookies })
  return JSON.parse(stdout)
}

function listen(event, callback) {
  const handle = native.addListener(event, callback)
  return () => { handle.then(listener => listener.remove()) }
}

let removeSettingsProgressListener = null

const android = {
  async ytDlpDownload(payload, retryDownloadId) {
    try {
      if (!store.getters.getEnableDownloads) return { error: 'downloads-disabled' }
      if (!payload.automatic) {
        const permission = await LocalNotifications.checkPermissions()
        if (permission.display === 'prompt' || permission.display === 'prompt-with-rationale') await LocalNotifications.requestPermissions()
      }
      const { args } = buildYtDlpDownloadArguments(payload, store.getters.getYtDlpDownloadCustomArgs)
      return await native.download({ payload, args, retryDownloadId, configuration: configuration() })
    } catch (error) {
      return { error: error.message }
    }
  },
  ytDlpCancelDownload: id => native.control({ id, action: 'cancel' }).then(result => result.ok),
  ytDlpControlDownload: (id, action, value) => native.control({ id, action, value }).then(result => result.ok),
  ytDlpQueueAction: action => native.queue({ action, configuration: configuration() }).then(result => result.ok),
  ytDlpListDownloads: () => native.list().then(result => result.downloads),
  ytDlpClearDownloads: ids => native.clear({ ids }).then(result => result.ok),
  ytDlpOpenDownload: id => native.open({ id }).then(result => result.ok),
  ytDlpRemoveDownload: id => native.remove({ id }).then(result => result.ok),
  handleYtDlpDownloadStatus: callback => listen('downloadStatus', callback),
  handleYtDlpDownloadsRemoved: callback => listen('downloadsRemoved', result => callback(result.ids)),
  ytDlpChooseDownloadFolder: () => native.chooseFolder().then(result => result.path),
  ytDlpChooseCookies: () => native.chooseCookies().then(result => result.path),
  ytDlpGetInfo: () => native.info(),
  ytDlpCheckBinaryUpdate: binary => native.checkUpdate({ binary, channel: configuration().channel }),
  ytDlpDownloadBinary: binary => native.update({ binary, channel: configuration().channel }),
  setYtDlpBinaryDownloadProgressListener(callback) {
    removeSettingsProgressListener?.()
    removeSettingsProgressListener = callback ? listen('binaryProgress', callback) : null
  },
  handleYtDlpBinaryDownloadProgress: callback => listen('binaryProgress', callback),
  addYtDlpBinaryDownloadProgressListener: callback => listen('binaryProgress', callback),
  addYtDlpBinaryUpdatedListener: callback => listen('binaryUpdated', callback),
  async ytDlpGetSubtitle(url) {
    if (!isYouTubeSubtitleUrl(url) || store.getters.getYtDlpPlaybackAuthMode !== 'file' ||
      !store.getters.getYtDlpPlaybackCookiesPath) return null
    try {
      const result = await native.subtitle({ url, cookies: store.getters.getYtDlpPlaybackCookiesPath })
      if (typeof result.text !== 'string') throw new Error('Invalid subtitle response')
      return result.text
    } catch {
      return { error: 'Unable to load subtitle with configured cookies' }
    }
  },
  async ytDlpGetPlaybackInfo(videoId, useDefaultClients = false, useAuthentication = false, includeSubtitles = true) {
    if (!/^[\w-]{11}$/.test(videoId)) return null
    try {
      const args = ['--no-playlist', '--no-warnings', '--no-progress', '--socket-timeout', '15', '--ignore-no-formats-error', '--format', 'sb0/sb1/sb2/sb3', '--print', PLAYBACK_INFO_OUTPUT_TEMPLATE]
      if (includeSubtitles) args.push('--write-auto-subs', '--sub-langs', 'all', '--sub-format', 'vtt')
      if (!useDefaultClients) args.push('--extractor-args', useAuthentication ? 'youtube:player_client=default,web_safari' : 'youtube:player_client=default,web_embedded,-android_vr')
      args.push(`https://www.youtube.com/watch?v=${videoId}`)
      const [info, binaries] = await Promise.all([extract(args, useAuthentication), native.info()])
      const formats = Array.isArray(info.formats) ? info.formats : []
      return {
        version: binaries.ytDlp.version,
        title: toNonEmptyString(info.title),
        isLive: !!info.is_live,
        liveStatus: toNonEmptyString(info.live_status),
        duration: toFiniteNumber(info.duration),
        hlsManifestUrl: toNonEmptyString(info.manifest_url) ?? formats.find(format => format.protocol === 'm3u8_native' && format.manifest_url)?.manifest_url ?? null,
        storyboardVtt: buildYtDlpStoryboardVtt([info.storyboard], toFiniteNumber(info.duration)),
        ...mapPlaybackCaptions(info.requested_subtitles),
        formats: formats.filter(format => format.protocol !== 'mhtml').map(mapPlaybackFormat),
      }
    } catch (error) {
      return { error: error.message }
    }
  },
  async ytDlpGetRecommendations(currentVideoId) {
    try {
      const info = await extract(['--flat-playlist', '--playlist-end', '30', '--dump-single-json', 'https://www.youtube.com/feed/recommended'], true)
      return (info.entries ?? []).filter(entry => /^[\w-]{11}$/.test(entry.id) && entry.id !== currentVideoId).map(entry => ({
        type: 'video',
        videoId: entry.id,
        title: entry.title || entry.id,
        author: entry.channel || entry.uploader || '',
        authorId: entry.channel_id || null,
        viewCount: entry.view_count ?? null,
        lengthSeconds: entry.duration ?? '',
        liveNow: entry.live_status === 'is_live',
        isUpcoming: entry.live_status === 'is_upcoming',
      }))
    } catch (error) { return { error: error.message } }
  },
  ytDlpPlaybackCacheGet: (videoId, cacheKey) => native.cache({ action: 'get', videoId, cacheKey }).then(result => result.entry ?? null),
  ytDlpPlaybackCacheSet: (videoId, cacheKey, expiryTime, source) => native.cache({ action: 'set', videoId, cacheKey, expiryTime, source, maxEntryBytes: normalizeYtDlpPlaybackCacheMaxEntrySize(store.getters.getYtDlpPlaybackCacheMaxEntrySize) * 1024 * 1024 }),
  ytDlpPlaybackCacheDelete: videoId => native.cache({ action: 'delete', videoId }),
  ytDlpPlaybackCacheClear: () => native.cache({ action: 'clear' }),
}

export function initializeAndroidYtDlp() {
  if (!native) return () => {}
  return store.watch(() => JSON.stringify(configuration()), value => {
    native.configure({ configuration: JSON.parse(value) }).catch(error => console.error('Could not configure Android downloads', error))
  }, { immediate: true })
}

export const ytDlp = process.env.IS_CAPACITOR ? android : window.ftElectron
