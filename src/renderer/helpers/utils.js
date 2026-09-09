import { Browser } from '@capacitor/browser'
import { Clipboard } from '@capawesome/capacitor-clipboard'
import { Share } from '@capacitor/share'
import { nextTick } from 'vue'
import i18n from '../i18n/index'
import router from '../router/index'
import { getCapacitorTabService } from '../tabs/CapacitorTabService'
import { getTabNavigationService } from '../tabs/TabNavigationService'
import { UnsupportedPlayerActions } from '../../constants'
import { getSearchHistoryEntryKey } from '../../search-history'
import { getPreferredShortThumbnailUrl } from './player/shorts'
import { isRoundedNumber } from './viewCounts'
import { blobToDataUrl } from './fileData'
import { saveAndroidFile } from './androidStorage'

// allowed characters in channel handle: A-Z, a-z, 0-9, -, _, .
// https://support.google.com/youtube/answer/11585688#change_handle
export const CHANNEL_HANDLE_REGEX = /^@[\w.-]{3,30}$/

const PUBLISHED_TEXT_REGEX = /(\d+)\s?([a-z]+)/i

/**
 * @param {string} sortPreference
 * @returns {string[]}
 */
export function getIconForSortPreference(sortPreference) {
  switch (sortPreference) {
    case 'name_descending':
    case 'author_descending':
    case 'video_title_descending':
      // text descending
      return ['fas', 'sort-alpha-down-alt']
    case 'name_ascending':
    case 'author_ascending':
    case 'video_title_ascending':
      // text ascending
      return ['fas', 'sort-alpha-down']
    case 'latest_updated_first':
    case 'latest_created_first':
    case 'latest_played_first':
    case 'date_added_descending':
    case 'published_descending':
    case 'last':
    case 'newest':
    case 'popular':
    case 'custom':
      // quantity descending
      return ['fas', 'arrow-down-wide-short']
    case 'earliest_updated_first':
    case 'earliest_created_first':
    case 'earliest_played_first':
    case 'date_added_ascending':
    case 'published_ascending':
    case 'oldest':
    default:
      // quantity ascending
      return ['fas', 'arrow-down-short-wide']
  }
}

/**
 * @param {string} publishedText
 * @param {boolean} isLive
 * @param {boolean} isUpcoming
 * @param {Date|undefined} premiereDate
 */
export function calculatePublishedDate(publishedText, isLive = false, isUpcoming = false, premiereDate = undefined) {
  const now = Date.now()

  if (isLive) {
    return now
  } else if (isUpcoming) {
    if (premiereDate) {
      return premiereDate.getTime()
    } else {
      // should never happen but just to be sure that we always return a number
      return now
    }
  }

  if (!publishedText) {
    return undefined
  }

  const match = publishedText.match(PUBLISHED_TEXT_REGEX)

  const timeFrame = match[2]
  const timeAmount = parseInt(match[1])
  let timeSpan = null

  if (timeFrame.startsWith('second') || timeFrame === 's') {
    timeSpan = timeAmount * 1000
  } else if (timeFrame.startsWith('minute') || timeFrame === 'm') {
    timeSpan = timeAmount * 60000
  } else if (timeFrame.startsWith('hour') || timeFrame === 'h') {
    timeSpan = timeAmount * 3600000
  } else if (timeFrame.startsWith('day') || timeFrame === 'd') {
    timeSpan = timeAmount * 86400000
  } else if (timeFrame.startsWith('week') || timeFrame === 'w') {
    timeSpan = timeAmount * 604800000
  } else if (timeFrame.startsWith('month') || timeFrame === 'mo') {
    // 30 day month being used
    timeSpan = timeAmount * 2592000000
  } else if (timeFrame.startsWith('year') || timeFrame === 'y') {
    timeSpan = timeAmount * 31556952000
  }

  return now - timeSpan
}

/**
 * @param {import('youtubei.js/dist/src/parser/classes/PlayerStoryboardSpec').StoryboardData} storyboard
 * @param {number} videoLengthSeconds
 * @returns {string}
 */
export function buildVTTFileLocally(storyboard, videoLengthSeconds) {
  let vttString = 'WEBVTT\n\n'
  // how many images are in one image
  const numberOfSubImagesPerImage = storyboard.columns * storyboard.rows
  // the number of storyboard images
  const numberOfImages = Math.ceil(storyboard.thumbnail_count / numberOfSubImagesPerImage)
  let intervalInSeconds
  if (storyboard.interval > 0) {
    intervalInSeconds = storyboard.interval / 1000
  } else {
    intervalInSeconds = videoLengthSeconds / (numberOfImages * numberOfSubImagesPerImage)
  }
  let startHours = 0
  let startMinutes = 0
  let startSeconds = 0
  let endHours = 0
  let endMinutes = 0
  let endSeconds = intervalInSeconds
  for (let i = 0; i < numberOfImages; i++) {
    const currentUrl = storyboard.template_url.replace('$M.jpg', `${i}.jpg`)
    let xCoord = 0
    let yCoord = 0
    for (let j = 0; j < numberOfSubImagesPerImage; j++) {
      // add the timestamp information
      const paddedStartHours = startHours.toString().padStart(2, '0')
      const paddedStartMinutes = startMinutes.toString().padStart(2, '0')
      const paddedStartSeconds = startSeconds.toFixed(3).padStart(6, '0')
      const paddedEndHours = endHours.toString().padStart(2, '0')
      const paddedEndMinutes = endMinutes.toString().padStart(2, '0')
      const paddedEndSeconds = endSeconds.toFixed(3).padStart(6, '0')
      vttString += `${paddedStartHours}:${paddedStartMinutes}:${paddedStartSeconds} --> ${paddedEndHours}:${paddedEndMinutes}:${paddedEndSeconds}\n`
      // add the current image url as well as the x, y, width, height information
      vttString += `${currentUrl}#xywh=${xCoord},${yCoord},${storyboard.thumbnail_width},${storyboard.thumbnail_height}\n\n`
      // update the variables
      startHours = endHours
      startMinutes = endMinutes
      startSeconds = endSeconds
      endSeconds += intervalInSeconds
      if (endSeconds >= 60) {
        endSeconds -= 60
        endMinutes += 1
      }
      if (endMinutes >= 60) {
        endMinutes -= 60
        endHours += 1
      }
      // x coordinate can only be smaller than the width of one subimage * the number of subimages per row
      xCoord = (xCoord + storyboard.thumbnail_width) % (storyboard.thumbnail_width * storyboard.columns)
      // only if the x coordinate is , so in a new row, we have to update the y coordinate
      if (xCoord === 0) {
        yCoord += storyboard.thumbnail_height
      }
    }
  }
  return vttString
}

/**
 * @param {{ startSeconds: number, endSeconds: number, title: string }[]} chapters
 */
export function buildChaptersVttFile(chapters) {
  const blocks = ['WEBVTT']

  for (const chapter of chapters) {
    blocks.push(`\
${secondsToVttTimestamp(chapter.startSeconds)} --> ${secondsToVttTimestamp(chapter.endSeconds)}
${chapter.title.trim()}`)
  }

  return blocks.join('\n\n') + '\n'
}

/**
 * @param {number} seconds
 */
function secondsToVttTimestamp(seconds) {
  const formattedHours = Math.trunc(seconds / 3600).toFixed(0).padStart(2, '0')
  seconds %= 3600

  const formattedMinutes = Math.trunc(seconds / 60).toFixed(0).padStart(2, '0')
  seconds %= 60

  const formattedSeconds = seconds.toFixed(3).padStart(6, '0')

  return `${formattedHours}:${formattedMinutes}:${formattedSeconds}`
}

/**
 * Builds a medium-quality thumbnail URL for a video, honouring the current backend
 * and the user's thumbnail preference. Handy for toasts that reference a single
 * video by id. Returns null when thumbnails are hidden, so callers can omit the
 * image entirely rather than showing a meaningless placeholder.
 * @param {string} videoId
 * @param {'local' | 'invidious'} backendPreference
 * @param {string} currentInvidiousInstanceUrl
 * @param {'' | 'hidden' | 'start' | 'middle' | 'end'} thumbnailPreference
 * @param {boolean} portrait
 * @returns {string | null}
 */
export function getVideoThumbnailUrl(videoId, backendPreference, currentInvidiousInstanceUrl, thumbnailPreference = '', portrait = false) {
  if (thumbnailPreference === 'hidden') {
    return null
  }

  const baseUrl = backendPreference === 'invidious'
    ? currentInvidiousInstanceUrl
    : 'https://i.ytimg.com'

  switch (thumbnailPreference) {
    case 'start':
      return `${baseUrl}/vi/${videoId}/${portrait ? 'oar1' : 'mq1'}.jpg`
    case 'middle':
      return `${baseUrl}/vi/${videoId}/${portrait ? 'oar2' : 'mq2'}.jpg`
    case 'end':
      return `${baseUrl}/vi/${videoId}/${portrait ? 'oar3' : 'mq3'}.jpg`
    default:
      return `${baseUrl}/vi/${videoId}/${portrait ? 'oardefault' : 'mqdefault'}.jpg`
  }
}

/**
 * Resolves a Shorts thumbnail consistently for cards, navigation previews, and
 * the player poster. YouTube's selected portrait image wins for the default
 * preference; explicit frame preferences still use their generated URLs.
 * @param {{ videoId: string, thumbnailUrl?: string } | null | undefined} video
 * @param {'local' | 'invidious'} backendPreference
 * @param {string} currentInvidiousInstanceUrl
 * @param {'' | 'hidden' | 'start' | 'middle' | 'end'} thumbnailPreference
 * @returns {string | null}
 */
export function getShortThumbnailUrl(video, backendPreference, currentInvidiousInstanceUrl, thumbnailPreference = '') {
  if (!video?.videoId) {
    return null
  }

  const fallbackUrl = getVideoThumbnailUrl(
    video.videoId,
    backendPreference,
    currentInvidiousInstanceUrl,
    thumbnailPreference,
    true
  )

  return getPreferredShortThumbnailUrl(video, thumbnailPreference, fallbackUrl)
}

export const ToastEventBus = new EventTarget()

/** Icon shown on toasts that report a failure */
const ERROR_TOAST_ICON = ['fas', 'circle-exclamation']

/**
 * @typedef {object} ToastOptions
 * @property {string | (({elapsedMs: number, remainingMs: number}) => string)} message
 * @property {number} [time]
 * @property {Function} [action]
 * @property {{ label: string, action?: Function, primary?: boolean, icon?: [string, string] }[]} [buttons]
 * @property {boolean} [verticalButtons] whether buttons should be stacked vertically
 * @property {boolean} [dismissible] whether Escape and swipe gestures can dismiss the toast
 * @property {AbortSignal} [abortSignal]
 * @property {string} [image] optional image URL (e.g. a video thumbnail) shown alongside the message
 * @property {[string, string]} [icon] optional semantic icon (e.g. `['fas', 'trash']`) shown
 *   alongside the message, ignored when an image is given
 */

/**
 * @param {string | (({elapsedMs: number, remainingMs: number}) => string) | ToastOptions} message
 *   the message to display, or an options object for more control (e.g. to show an image or icon)
 * @param {number} time
 * @param {Function} action
 * @param {AbortSignal} abortSignal
 */
export function showToast(message, time = null, action = null, abortSignal = null) {
  let image = null
  let icon = null
  let buttons = []
  let verticalButtons = false
  let dismissible = true

  // Allow calling with a single options object while staying backwards compatible
  // with the positional (message, time, action, abortSignal) signature
  if (message !== null && typeof message === 'object') {
    ({ message, time = null, action = null, abortSignal = null, image = null, icon = null, buttons = [], verticalButtons = false, dismissible = true } = message)
  }

  // Sometimes caller just pass user setting based value in and it can be zero
  if (time === 0) {
    console.warn('showToast called with time: 0', { message, time, action, abortSignal })
    return
  }

  ToastEventBus.dispatchEvent(new CustomEvent('toast-open', {
    detail: {
      message,
      time,
      action,
      abortSignal,
      image,
      icon,
      buttons,
      verticalButtons,
      dismissible,
    }
  }))
}

/**
 * Shows a non-interactive toast in every tab.
 * @param {string} message
 * @param {number} time
 * @param {[string, string] | null} icon optional semantic icon shown alongside the message
 */
export function showToastOnAllTabs(message, time = null, icon = null) {
  if (process.env.IS_ELECTRON) {
    window.ftElectron.showToastOnAllTabs(message, time, icon)
  } else {
    showToast({ message, time, icon })
  }
}

/** @returns {Promise<string>} */
export async function readClipboard() {
  if (process.env.IS_ELECTRON) return window.ftElectron.readClipboard()
  if (process.env.IS_CAPACITOR) {
    try {
      const { type, value } = await Clipboard.read()
      if (type === 'HTML') {
        const template = document.createElement('template')
        template.innerHTML = value
        return template.content.textContent ?? ''
      }
      return type === 'TEXT' || type === 'URL' ? value : ''
    } catch (error) {
      if (error.code === 'EMPTY_CLIPBOARD') return ''
      throw error
    }
  }
  return navigator.clipboard.readText()
}

/**
 * This writes to the clipboard. If an error occurs during the copy,
 * a toast with the error is shown. If the copy is successful and
 * there is a success message, a toast with that message is shown.
 * @param {string|Blob} content the content to be copied to the clipboard (text or image Blob)
 * @param {object} [options] - Optional settings for the copy operation.
 * @param {null|string} options.messageOnSuccess the message to be displayed as a toast when the copy succeeds (optional)
 * @param {null|string} options.messageOnError the message to be displayed as a toast when the copy fails (optional)
 */
export async function copyToClipboard(content, { messageOnSuccess = null, messageOnError = null } = {}) {
  const useCapacitorClipboard = process.env.IS_CAPACITOR
  if (useCapacitorClipboard || (navigator.clipboard !== undefined && window.isSecureContext)) {
    try {
      if (useCapacitorClipboard) {
        if (content instanceof Blob) {
          await Clipboard.write({ image: await blobToDataUrl(content), label: 'OpenTubeX' })
        } else {
          await Clipboard.write({ text: content, label: 'OpenTubeX' })
        }
      } else if (content instanceof Blob) {
        await navigator.clipboard.write([
          new ClipboardItem({
            [content.type]: content
          })
        ])
      } else {
        await navigator.clipboard.writeText(content)
      }

      if (messageOnSuccess !== null) {
        showToast({ message: messageOnSuccess, icon: ['fas', 'copy'] })
      }
    } catch (error) {
      if (content instanceof Blob) {
        console.error(`Failed to data of type "${content.type}" to clipboard`, error)
      } else {
        console.error(`Failed to copy ${content} to clipboard`, error)
      }
      showToast({
        message: messageOnError !== null
          ? `${messageOnError}: ${error}`
          : `${i18n.global.t('Clipboard.Copy failed')}: ${error}`,
        time: 5000,
        icon: ERROR_TOAST_ICON,
      })
    }
  } else {
    showToast({
      message: i18n.global.t('Clipboard.Cannot access clipboard without a secure connection'),
      time: 5000,
      icon: ERROR_TOAST_ICON,
    })
  }
}

// API requests often fail together. Keep at most one error toast per lifetime.
let lastApiErrorToastAt = Number.NEGATIVE_INFINITY

/**
 * Shows an error toast for a failed request, which copies the error to the
 * clipboard when clicked.
 * @param {string} message the message describing what failed
 * @param {Error | string} error the error to report and make copyable
 * @param {(options: ToastOptions) => void} [show] toast function to use,
 *   e.g. the tab-scoped one from {@link import('../composables/useTabToast').useTabToast}
 */
export function showApiErrorToast(message, error, show = showToast) {
  const now = Date.now()
  if (now - lastApiErrorToastAt < 10000) return
  lastApiErrorToastAt = now
  show({
    message: `${message}: ${error}`,
    time: 10000,
    action: () => {
      copyToClipboard(error)
    },
    icon: ERROR_TOAST_ICON,
  })
}

/**
 * Opens a link in the default web browser or a new tab in the web builds
 * @param {string} url the URL to open
 */
export async function openExternalLink(url) {
  if (process.env.IS_CAPACITOR) {
    await Browser.open({ url })
    return
  }

  window.open(url, '_blank', 'noreferrer')
}

/**
 * Opens Android's native share picker for a public link.
 * @param {string} url the URL to share
 */
export async function shareLink(url) {
  try {
    await Share.share({ url })
  } catch (error) {
    // The Android plugin rejects when the user dismisses the picker.
    if (error.message === 'Share canceled') return
    showApiErrorToast(i18n.global.t('Share.Share failed'), error)
  }
}

/**
 * Opens an internal path in the same window, a new tab, or a new window.
 * Optionally with query params and setting the contents of the search bar in the new window.
 * @param {object} params
 * @param {string} params.path the internal path to open
 * @param {boolean} [params.doCreateNewWindow] set to true to open a new window (Shift+click)
 * @param {boolean} [params.doCreateNewTab] set to true to open in a new tab (Ctrl/Cmd+click or middle-click)
 * @param {boolean} [params.makeActive=true] set to false to open tab in background (only used when doCreateNewTab is true)
 * @param {string} [params.title] initial title for the destination
 * @param {object} [params.query] the query params to use (optional)
 * @param {string} [params.searchQueryText] the text to show in the search bar in the new window (optional)
 */
export function openInternalPath({ path, query = undefined, doCreateNewWindow = false, doCreateNewTab = false, makeActive = true, title = undefined, searchQueryText = null }) {
  if (process.env.IS_ELECTRON) {
    if (doCreateNewTab) {
      // Open in new tab
      let route = path
      if (route.startsWith('/')) {
        route = route.substring(1)
      }
      return window.ftElectron.tabs.create({
        route,
        query,
        title,
        makeActive,
        inheritColorFromOpener: true,
        openerTabId: getTabNavigationService().getPresentedTabId(),
        preloadInBackground: !makeActive && path.startsWith('/watch/')
      })
    } else if (doCreateNewWindow) {
      // Open in new window
      window.ftElectron.openInNewWindow(path, query, searchQueryText)
    } else {
      // Navigate in the presented logical tab.
      getTabNavigationService().pushPresented({
        path,
        query,
        state: title ? { tabTitle: title } : undefined
      })
    }
  } else if (process.env.IS_CAPACITOR) {
    if (doCreateNewTab || doCreateNewWindow) {
      return getCapacitorTabService().createTab({ path, query }, title, makeActive)
    }

    return getTabNavigationService().pushPresented({
      path,
      query,
      state: title ? { tabTitle: title } : undefined
    })
  } else {
    // The web build has no tabs or windows of its own, so a Ctrl/middle/Shift+click
    // is handed to the browser, pointed at this app's route for the destination
    // instead of the external URL the click started from.
    if (doCreateNewTab || doCreateNewWindow) {
      const { href } = router.resolve({ path, query })

      // `window.open` returns null when a popup blocker steps in,
      // navigating in place is better than doing nothing at all
      if (window.open(href, '_blank', doCreateNewWindow ? 'popup' : undefined) != null) {
        return
      }
    }

    router.push({
      path,
      query,
      state: title ? { tabTitle: title } : undefined
    })
  }
}

/**
 * @param {string} fileTypeDescription
 * @param {{[key: string]: string | string[]}} acceptedTypes
 * @param {string} [rememberDirectoryId]
 * @param {'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'} [startInDirectory]
 * @returns {Promise<{ content: string, filename: string } | null>}
 */
export async function readFileWithPicker(
  fileTypeDescription,
  acceptedTypes,
  rememberDirectoryId,
  startInDirectory
) {
  let file

  // Only supported in Electron and desktop Chromium browsers
  // https://developer.mozilla.org/en-US/docs/Web/API/Window/showOpenFilePicker#browser_compatibility
  // As we know it is supported in Electron, adding the build flag means we can skip the runtime check in Electron
  // and allow terser to remove the unused else block
  if (process.env.IS_ELECTRON || 'showOpenFilePicker' in window) {
    try {
      /** @type {FileSystemFileHandle[]} */
      const [handle] = await window.showOpenFilePicker({
        excludeAcceptAllOption: true,
        multiple: false,
        id: rememberDirectoryId,
        startIn: startInDirectory,
        types: [{
          description: fileTypeDescription,
          accept: acceptedTypes
        }],
      })

      file = await handle.getFile()
    } catch (error) {
      // user pressed cancel in the file picker
      if (error.name === 'AbortError') {
        return null
      }

      throw error
    }
  } else {
    /** @type {File|null} */
    const fallbackFile = await new Promise((resolve) => {
      const joinedExtensions = Object.values(acceptedTypes)
        .flat()
        .join(',')

      const fileInput = document.createElement('input')
      fileInput.type = 'file'
      fileInput.accept = joinedExtensions
      fileInput.onchange = () => {
        resolve(fileInput.files[0])
        fileInput.onchange = null
      }

      const listenForEnd = () => {
        // 1 second timeout on the response from the file picker to prevent awaiting forever
        setTimeout(() => {
          if (fileInput.files.length === 0 && typeof fileInput.onchange === 'function') {
            // if there are no files and the onchange has not been triggered, the file-picker was canceled
            resolve(null)
            fileInput.onchange = null
          }
        }, 1000)
      }
      window.addEventListener('focus', listenForEnd, { once: true })
      fileInput.click()
    })

    if (fallbackFile === null) {
      return null
    }

    file = fallbackFile
  }

  return {
    content: await file.text(),
    filename: file.name
  }
}

/**
 * @param {string} fileName
 * @param {string | Blob} content
 * @param {string} fileTypeDescription
 * @param {string} mimeType
 * @param {string} fileExtension
 * @param {string} [rememberDirectoryId]
 * @param {'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'} [startInDirectory]
 * @param {string} [defaultDirectory] Native directory selected in settings.
 * @returns {Promise<boolean>}
 */
export async function writeFileWithPicker(
  fileName,
  content,
  fileTypeDescription,
  mimeType,
  fileExtension,
  rememberDirectoryId,
  startInDirectory,
  defaultDirectory
) {
  if (process.env.IS_CAPACITOR) {
    return saveAndroidFile(fileName, content, mimeType, defaultDirectory)
  }
  // Only supported in Electron and desktop Chromium browsers
  // https://developer.mozilla.org/en-US/docs/Web/API/Window/showOpenFilePicker#browser_compatibility
  // As we know it is supported in Electron, adding the build flag means we can skip the runtime check in Electron
  // and allow terser to remove the unused else block
  if (process.env.IS_ELECTRON || 'showSaveFilePicker' in window) {
    let writableFileStream

    try {
      /** @type {FileSystemFileHandle} */
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        excludeAcceptAllOption: true,
        multiple: false,
        id: rememberDirectoryId,
        startIn: startInDirectory,
        types: [{
          description: fileTypeDescription,
          accept: {
            [mimeType]: [fileExtension]
          }
        }],
      })

      writableFileStream = await handle.createWritable()
      await writableFileStream.write(content)
    } catch (error) {
      // user pressed cancel in the file picker
      if (error.name === 'AbortError') {
        return false
      }

      throw error
    } finally {
      if (writableFileStream) {
        await writableFileStream.close()
      }
    }

    return true
  } else {
    if (typeof content === 'string') {
      content = new Blob([content], { type: mimeType })
    }

    const url = URL.createObjectURL(content)

    const downloadLink = document.createElement('a')
    downloadLink.download = encodeURIComponent(fileName)
    downloadLink.href = url
    downloadLink.click()

    // Small timeout to give the browser time to react to the click on the link
    setTimeout(() => {
      URL.revokeObjectURL(url)
    }, 1000)

    return true
  }
}

/**
 * This creates an absolute web url from a given path.
 * It will assume all given paths are relative to the current window location.
 * @param {string} path relative path to resource
 * @returns {string} absolute web path
 */
export function createWebURL(path) {
  const url = new URL(window.location.href)
  const { origin } = url
  let windowPath = url.pathname
  // Remove the html file name from the path
  if (windowPath.endsWith('.html')) {
    windowPath = windowPath.replace(/[^./]*\.html$/, '')
  }
  // Remove proceeding slash in given path if there is one
  if (path.startsWith('/')) {
    path = path.substring(1, path.length)
  }
  // Remove trailing slash if there is one
  if (windowPath.endsWith('/')) {
    windowPath = windowPath.substring(0, windowPath.length - 1)
  }
  return `${origin}${windowPath}/${path}`
}

/**
 * This formats the duration of a video in seconds into a user friendly timestamp.
 * It will return strings like LIVE or UPCOMING, without making any changes
 * @param {string|number} lengthSeconds the video duration in seconds or the strings LIVE or UPCOMING
 * @returns {string} timestamp or LIVE or UPCOMING
 */
export function formatDurationAsTimestamp(lengthSeconds) {
  if (typeof lengthSeconds === 'string') {
    return lengthSeconds
  }

  // Media durations can include milliseconds; timestamps display whole seconds.
  lengthSeconds = Math.floor(lengthSeconds)

  if (lengthSeconds === 0) {
    return '0:00'
  }

  let hours = 0

  if (lengthSeconds >= 3600) {
    hours = Math.floor(lengthSeconds / 3600)
    lengthSeconds = lengthSeconds - hours * 3600
  }

  let minutes = Math.floor(lengthSeconds / 60)
  if (minutes < 10 && hours > 0) {
    minutes = '0' + minutes
  }

  let seconds = lengthSeconds - minutes * 60
  if (seconds < 10) {
    seconds = '0' + seconds
  }

  let timestamp
  if (hours > 0) {
    timestamp = hours + ':' + minutes + ':' + seconds
  } else {
    timestamp = minutes + ':' + seconds
  }

  return timestamp
}

/**
 * @param {{prioritize? : string, time?: string, duration?: string, features: string[]}?} filtersA
 * @param {{prioritize? : string, time?: string, duration?: string, features: string[]}?} filtersB
 * @returns {boolean}
 */
export function searchFiltersMatch(filtersA, filtersB) {
  return getSearchHistoryEntryKey('', filtersA) === getSearchHistoryEntryKey('', filtersB)
}

/**
 * @param {string} filenameOriginal
 * @returns {string}
 */
export function replaceFilenameForbiddenChars(filenameOriginal) {
  let filenameNew = filenameOriginal
  let forbiddenChars = {}
  switch (process.platform) {
    case 'win32':
      forbiddenChars = {
        '<': '＜', // U+FF1C
        '>': '＞', // U+FF1E
        ':': '：', // U+FF1A
        '"': '＂', // U+FF02
        '/': '／', // U+FF0F
        '\\': '＼', // U+FF3C
        '|': '｜', // U+FF5C
        '?': '？', // U+FF1F
        '*': '＊' // U+FF0A
      }
      break
    case 'darwin':
      forbiddenChars = { '/': '／', ':': '：' }
      break
    case 'linux':
      forbiddenChars = { '/': '／' }
      break
    default:
      break
  }

  for (const forbiddenChar in forbiddenChars) {
    filenameNew = filenameNew.replaceAll(forbiddenChar, forbiddenChars[forbiddenChar])
  }
  return filenameNew
}

/**
 * @returns {Promise<string>}
 */
export async function getSystemLocale() {
  let locale
  if (process.env.IS_ELECTRON) {
    locale = await window.ftElectron.getSystemLocale()
  } else {
    if (navigator && navigator.language) {
      locale = navigator.language
    }
  }

  return locale || 'en-US'
}

export function extractNumberFromString(str) {
  if (typeof str === 'string') {
    return parseInt(str.replaceAll(/\D+/g, ''))
  } else {
    return NaN
  }
}

/**
 * @param {string} externalPlayer
 * @param {import('../../constants').UnsupportedPlayerAction} action
 */
export function showExternalPlayerUnsupportedActionToast(externalPlayer, action) {
  let actionString = ''

  switch (action) {
    case UnsupportedPlayerActions.STARTING_VIDEO_AT_OFFSET:
      actionString = i18n.global.t('Video.External Player.Unsupported Actions.starting video at offset')
      break
    case UnsupportedPlayerActions.PLAYBACK_RATE:
      actionString = i18n.global.t('Video.External Player.Unsupported Actions.setting a playback rate')
      break
    case UnsupportedPlayerActions.OPENING_PLAYLISTS:
      actionString = i18n.global.t('Video.External Player.Unsupported Actions.opening playlists')
      break
    case UnsupportedPlayerActions.PLAYLIST_SPECIFIC_VIDEO:
      actionString = i18n.global.t('Video.External Player.Unsupported Actions.opening specific video in a playlist (falling back to opening the video)')
      break
    case UnsupportedPlayerActions.PLAYLIST_REVERSE:
      actionString = i18n.global.t('Video.External Player.Unsupported Actions.reversing playlists')
      break
    case UnsupportedPlayerActions.PLAYLIST_SHUFFLE:
      actionString = i18n.global.t('Video.External Player.Unsupported Actions.shuffling playlists')
      break
    case UnsupportedPlayerActions.PLAYLIST_LOOP:
      actionString = i18n.global.t('Video.External Player.Unsupported Actions.looping playlists')
      break
  }

  const message = i18n.global.t('Video.External Player.UnsupportedActionTemplate', {
    externalPlayer, action: actionString
  })
  showToast(message)
}

export function getVideoParamsFromUrl(url) {
  /** @type {URL} */
  let urlObject
  const paramsObject = { videoId: null, timestamp: null, playlistId: null, commentId: null, isShort: false }
  try {
    urlObject = new URL(url)
  } catch {
    return paramsObject
  }

  function extractParams(videoId) {
    paramsObject.videoId = videoId
    paramsObject.commentId = urlObject.searchParams.get('lc')
    let timestamp = urlObject.searchParams.get('t')
    if (timestamp && (timestamp.includes('h') || timestamp.includes('m') || timestamp.includes('s'))) {
      const { seconds, minutes, hours } = timestamp.match(/(?:(?<hours>(\d+))h)?(?:(?<minutes>(\d+))m)?(?:(?<seconds>(\d+))s)?/).groups
      let time = 0

      if (seconds) {
        time += Number(seconds)
      }

      if (minutes) {
        time += 60 * Number(minutes)
      }

      if (hours) {
        time += 3600 * Number(hours)
      }

      timestamp = time
    }
    paramsObject.timestamp = timestamp
  }

  const extractors = [
    // anything with /watch?v=
    function () {
      if (urlObject.pathname === '/watch' && urlObject.searchParams.has('v')) {
        extractParams(urlObject.searchParams.get('v').slice(0, 11))
        paramsObject.playlistId = urlObject.searchParams.get('list')
        return paramsObject
      }
    },
    // youtu.be
    function () {
      if (urlObject.host === 'youtu.be' && /^\/[\w-]{11,}/.test(urlObject.pathname)) {
        extractParams(urlObject.pathname.slice(1, 12))
        paramsObject.playlistId = urlObject.searchParams.get('list')
        return paramsObject
      }
    },
    // youtube.com/embed
    function () {
      if (/^\/embed\/[\w-]+$/.test(urlObject.pathname)) {
        const urlTail = urlObject.pathname.replace('/embed/', '')
        if (urlTail === 'videoseries') {
          paramsObject.playlistId = urlObject.searchParams.get('list')
        } else {
          extractParams(urlTail)
        }
        return paramsObject
      }
    },
    // youtube.com/shorts
    function () {
      if (/^\/shorts\/[\w-]+$/.test(urlObject.pathname)) {
        extractParams(urlObject.pathname.replace('/shorts/', ''))
        paramsObject.isShort = true
        return paramsObject
      }
    },
    // youtube.com/live
    function () {
      if (/^\/live\/[\w-]+$/.test(urlObject.pathname)) {
        extractParams(urlObject.pathname.replace('/live/', ''))
        return paramsObject
      }
    },
    // cloudtube
    function () {
      if (/^cadence\.(gq|moe)$/.test(urlObject.host) && /^\/cloudtube\/video\/[\w-]+$/.test(urlObject.pathname)) {
        extractParams(urlObject.pathname.slice('/cloudtube/video/'.length))
        return paramsObject
      }
    }
  ]

  return extractors.reduce((a, c) => a || c(), null) || paramsObject
}

/**
 * This will match sequences of upper case characters and convert them into title cased words.
 * This will also match excessive strings of punctionation and convert them to one representative character
 * @param {string} title the title to process
 * @param {number} minUpperCase the minimum number of consecutive upper case characters to match
 * @returns {string} the title with upper case characters removed and punctuation normalized
 */
export function toDistractionFreeTitle(title, minUpperCase = 3) {
  const firstValidCharIndex = (word) => {
    const reg = /[\p{L}]/u
    return word.search(reg)
  }

  const capitalizedWord = (word) => {
    const chars = word.split('')
    const index = firstValidCharIndex(word)
    chars[index] = chars[index].toUpperCase()
    return chars.join('')
  }

  const reg = RegExp(`[\\p{Lu}|']{${minUpperCase},}`, 'ug')
  return title
    .replaceAll(/!{2,}/g, '!')
    .replaceAll(/[!?]{2,}/g, '?')
    .replace(reg, x => capitalizedWord(x.toLowerCase()))
}

/**
 * @param {number} number
 * @param {Intl.NumberFormatOptions?} options
 * @returns {string}
 */
export function formatNumber(number, options = undefined) {
  return Intl.NumberFormat([i18n.global.locale.value, 'en'], options).format(number)
}

/**
 * Formats a view count, using compact notation (e.g. 14K, 3.5M) when YouTube gave us
 * an already rounded number, as the trailing zeros just waste space in that case.
 * @param {number} viewCount
 * @param {boolean} shorten the user's "Shorten View Counts" setting
 * @returns {string}
 */
export function formatViewCount(viewCount, shorten) {
  return formatNumber(viewCount, shorten && isRoundedNumber(viewCount) ? { notation: 'compact' } : undefined)
}

export function getTodayDateStrLocalTimezone() {
  const timeNow = new Date()
  // `Date#getTimezoneOffset` returns the difference, in minutes
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/getTimezoneOffset
  const timeNowStr = new Date(timeNow.getTime() - (timeNow.getTimezoneOffset() * 60000)).toISOString()
  // `Date#toISOString` returns string with `T` as date/time separator (ISO 8601 format)
  // e.g. 2011-10-05T14:48:00.000Z
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toISOString
  return timeNowStr.split('T')[0]
}

// Constructing Intl formatters is expensive and some of them are used once per list item,
// so cache them per locale + options

/** @type {Map<string, Intl.RelativeTimeFormat>} */
const relativeTimeFormatCache = new Map()

/**
 * @param {string} locale
 * @param {Intl.RelativeTimeFormatOptions['numeric']} numeric
 * @returns {Intl.RelativeTimeFormat}
 */
export function getCachedRelativeTimeFormat(locale, numeric = 'always') {
  const key = `${locale}|${numeric}`
  let formatter = relativeTimeFormatCache.get(key)

  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat([locale, 'en'], { numeric })
    relativeTimeFormatCache.set(key, formatter)
  }

  return formatter
}

/**
 *
 * @param {number} date
 * @param {boolean} hideSeconds
 * @param {boolean} useThirtyDayMonths
 * @param {number} now
 * @returns {string}
 */
export function getRelativeTimeFromDate(date, hideSeconds = false, useThirtyDayMonths = true, now = Date.now()) {
  if (!date) {
    return ''
  }

  // Convert from ms to second
  // For easier code interpretation the value is made to be positive
  let timeDiffFromNow = ((now - date) / 1000)
  let timeUnit = 'second'

  if (timeDiffFromNow < 60 && hideSeconds) {
    return i18n.global.t('Moments Ago')
  }

  if (timeDiffFromNow >= 60) {
    timeDiffFromNow /= 60
    timeUnit = 'minute'
  }

  if (timeUnit === 'minute' && timeDiffFromNow >= 60) {
    timeDiffFromNow /= 60
    timeUnit = 'hour'
  }

  if (timeUnit === 'hour' && timeDiffFromNow >= 24) {
    timeDiffFromNow /= 24
    timeUnit = 'day'
  }

  const timeDiffFromNowDays = timeDiffFromNow
  if (timeUnit === 'day' && timeDiffFromNow >= 7) {
    timeDiffFromNow /= 7
    timeUnit = 'week'
  }

  /* Different months might have a different number of days.
    In some contexts, to ensure the display is fine, we use 31.
    In other contexts, like when working with calculatePublishedDate, we use 30. */
  const daysInMonth = useThirtyDayMonths ? 30 : 31
  if (timeUnit === 'week' && timeDiffFromNowDays >= daysInMonth) {
    timeDiffFromNow = timeDiffFromNowDays / daysInMonth
    timeUnit = 'month'
  }

  if (timeUnit === 'month' && timeDiffFromNow >= 12) {
    timeDiffFromNow /= 12
    timeUnit = 'year'
  }

  // Using `Math.ceil` so that -1.x days ago displayed as 1 day ago
  // Notice that the value is turned to negative to be displayed as "ago"
  return getCachedRelativeTimeFormat(i18n.global.locale.value).format(Math.ceil(-timeDiffFromNow), timeUnit)
}

/**
 * Escapes HTML tags to avoid XSS
 * @param {string} untrusted
 * @returns {string}
 */
export function escapeHTML(untrusted) {
  return untrusted.replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&apos;')
}

/**
 * Performs a deep copy of a javascript object
 * @template T
 * @param {T} obj
 * @returns {T}
 */
export function deepCopy(obj) {
  return JSON.parse(JSON.stringify(obj))
}

/**
 * Check if the `name` of the error is `TimeoutError` to know if the error was caused by a timeout or something else.
 * @param {number} timeoutMs
 * @param {RequestInfo|URL} input
 * @param {RequestInit?} init
 * @returns {Promise<Response>}
 */
export async function fetchWithTimeout(timeoutMs, input, init) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)

  if (typeof init !== 'undefined') {
    init.signal = timeoutSignal
  } else {
    init = {
      signal: timeoutSignal
    }
  }

  try {
    return await fetch(input, init)
  } catch (err) {
    if (err.name === 'AbortError' && timeoutSignal.aborted) {
      // According to the spec, fetch should use the original abort reason.
      // Unfortunately chromium browsers always throw an AbortError, even when it was caused by a TimeoutError,
      // so we need manually throw the original abort reason
      // https://bugs.chromium.org/p/chromium/issues/detail?id=1431720
      throw timeoutSignal.reason
    } else {
      throw err
    }
  }
}

/**
 * @param {KeyboardEvent} event
 * @param {HTMLInputElement} inputElement
 */
export function ctrlFHandler(event, inputElement) {
  switch (event.key) {
    case 'F':
    case 'f':
      if (((process.platform !== 'darwin' && event.ctrlKey) || (process.platform === 'darwin' && event.metaKey))) {
        nextTick(() => inputElement?.focus())
      }
  }
}

/**
 * @template T
 * @param {T[]} array
 * @returns {T}
 */
export function randomArrayItem(array) {
  return array[Math.floor(Math.random() * array.length)]
}

/**
 * @template T
 * @param {T[]} array
 * @param {T} entry
 */
export function removeFromArrayIfExists(array, entry) {
  const index = array.indexOf(entry)

  if (index !== -1) {
    array.splice(index, 1)
  }
}

/**
 * @param {string} text
 */
export function base64EncodeUtf8(text) {
  const bytes = new TextEncoder().encode(text)

  const binString = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join('')
  return btoa(binString)
}

/**
 * @overload
 * @param {string} channelId
 * @param {'videos' | 'live' | 'shorts'} type
 * @param {'newest' | 'popular'} sortBy
 * @returns {string}
 *
 * @overload
 * @param {string} channelId
 * @param {'all'} type
 * @returns {string}
 *
 * @param {string} channelId
 * @param {'all' | 'videos' | 'live' | 'shorts'} type
 * @param {('newest' | 'popular')?} [sortBy]
 * @returns {string}
 */

export function getChannelPlaylistId(channelId, type, sortBy) {
  switch (type) {
    case 'videos':
      if (sortBy === 'popular') {
        return channelId.replace(/^UC/, 'UULP')
      } else {
        return channelId.replace(/^UC/, 'UULF')
      }
    case 'live':
      if (sortBy === 'popular') {
        return channelId.replace(/^UC/, 'UUPV')
      } else {
        return channelId.replace(/^UC/, 'UULV')
      }
    case 'shorts':
      if (sortBy === 'popular') {
        return channelId.replace(/^UC/, 'UUPS')
      } else {
        return channelId.replace(/^UC/, 'UUSH')
      }
    case 'all':
      return channelId.replace(/^UC/, 'UU')
  }
}

function getIndividualLocalizedShortcut(shortcut) {
  switch (shortcut) {
    case 'alt':
      return i18n.global.t('Keys.alt')
    case 'ctrl':
      return i18n.global.t('Keys.ctrl')
    case 'control':
      return i18n.global.t('Keys.ctrl')
    case 'shift':
      return i18n.global.t('Keys.shift')
    case 'enter':
      return i18n.global.t('Keys.enter')
    case 'plus':
      return i18n.global.t('Keys.plus')
    case 'arrowleft':
      return i18n.global.t('Keys.arrowleft')
    case 'arrowright':
      return i18n.global.t('Keys.arrowright')
    case 'arrowup':
      return i18n.global.t('Keys.arrowup')
    case 'arrowdown':
      return i18n.global.t('Keys.arrowdown')
    default:
      return shortcut
  }
}

function getMacIconForShortcut(shortcut) {
  switch (shortcut) {
    case 'option':
    case 'alt':
      return '⌥'
    case 'cmd':
    case 'ctrl':
      return '⌘'
    case 'control':
      return '⌃'
    case 'shift':
      return '⇧'
    case 'enter':
      return '⌤'
    case 'plus':
      return '+'
    case 'arrowleft':
      return '←'
    case 'arrowright':
      return '→'
    case 'arrowup':
      return '↑'
    case 'arrowdown':
      return '↓'
    default:
      return shortcut
  }
}

/**
 * @param {string} shortcut
 * @returns {string} the localized and recombined shortcut
 */
export function getLocalizedShortcut(shortcut) {
  const shortcuts = shortcut.split('+')

  if (process.platform === 'darwin') {
    const shortcutsAsIcons = shortcuts.map(shortcut => getMacIconForShortcut(shortcut))
    return shortcutsAsIcons.join('')
  } else {
    const localizedShortcuts = shortcuts.map((shortcut) => getIndividualLocalizedShortcut(shortcut))
    const shortcutJoinOperator = i18n.global.t('shortcutJoinOperator')
    return localizedShortcuts.join(shortcutJoinOperator)
  }
}

/**
 * @param {string} actionTitle
 * @param {string} shortcut
 * @returns {string} the localized action title with keyboard shortcut
 */
export function addKeyboardShortcutToActionTitle(actionTitle, shortcut) {
  if (!shortcut) {
    return actionTitle
  }

  return i18n.global.t('KeyboardShortcutTemplate', {
    label: actionTitle,
    shortcut
  })
}

/**
 * @param {string} localizedActionTitle
 * @param {string|string[]} sometimesManyUnlocalizedShortcuts
 * @returns {string} the localized action title with keyboard shortcut
 */
export function localizeAndAddKeyboardShortcutToActionTitle(localizedActionTitle, sometimesManyUnlocalizedShortcuts) {
  let unlocalizedShortcuts = sometimesManyUnlocalizedShortcuts
  if (!Array.isArray(sometimesManyUnlocalizedShortcuts)) {
    unlocalizedShortcuts = [unlocalizedShortcuts]
  }
  const localizedShortcuts = unlocalizedShortcuts
    .filter(Boolean)
    .map((s) => getLocalizedShortcut(s))
  const shortcutLabelSeparator = i18n.global.t('shortcutLabelSeparator')
  return addKeyboardShortcutToActionTitle(localizedActionTitle, localizedShortcuts.join(shortcutLabelSeparator))
}

/**
 * @template {Function} T
 * @param {T} func
 * @param {number} wait
 * @returns {T & { cancel: () => void }}
 */
export function debounce(func, wait) {
  let timeout

  // Using a fully fledged function here instead of an arrow function
  // so that we can get `this` and pass it onto the original function.
  // Vue components using the options API use `this` alot.
  const debounced = function (...args) {
    const context = this

    clearTimeout(timeout)

    timeout = setTimeout(() => {
      timeout = null
      func.apply(context, args)
    }, wait)
  }

  debounced.cancel = () => {
    clearTimeout(timeout)
    timeout = null
  }

  return debounced
}

/**
 * @template {Function} T
 * @param {T} func
 * @param {number} wait
 * @returns {T}
 */
export function throttle(func, wait) {
  let isWaiting

  // Using a fully fledged function here instead of an arrow function
  // so that we can get `this` and pass it onto the original function.
  // Vue components using the options API use `this` alot.
  return function (...args) {
    const context = this
    if (!isWaiting) {
      func.apply(context, args)

      isWaiting = true
      setTimeout(() => {
        isWaiting = false
      }, wait)
    }
  }
}

// Every list item of every feed can add an entry, so the cache is capped and
// evicts the oldest titles first rather than growing for the whole session.
const OEMBED_TITLE_CACHE_LIMIT = 500
const oembedTitleCache = new Map()
const oembedTitleRequests = new Map()

/**
 * @param {string} videoId
 * @param {string} title
 */
function cacheOembedTitle(videoId, title) {
  if (oembedTitleCache.size >= OEMBED_TITLE_CACHE_LIMIT) {
    // Map iterates in insertion order, so the first key is the oldest one.
    oembedTitleCache.delete(oembedTitleCache.keys().next().value)
  }

  oembedTitleCache.set(videoId, title)
}

/**
 * @param {string} videoId
 * @returns {string | null}
 */
export function getCachedOembedTitle(videoId) {
  return oembedTitleCache.get(videoId) ?? null
}

/**
 * @param {string} videoId
 * @returns {Promise<string | null>}
 */
export async function getOembedTitle(videoId) {
  const cachedTitle = getCachedOembedTitle(videoId)
  if (cachedTitle !== null) {
    return cachedTitle
  }

  if (oembedTitleRequests.has(videoId)) {
    return oembedTitleRequests.get(videoId)
  }

  const request = (async () => {
    try {
      const oembedInfo = await (await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}`)).json()
      if (typeof oembedInfo.title === 'string' && oembedInfo.title.length > 0) {
        cacheOembedTitle(videoId, oembedInfo.title)
        return oembedInfo.title
      }
    } catch (error) {
      console.error(`Failed to fetch oEmbed info for ${videoId}: ${error}`)
    } finally {
      oembedTitleRequests.delete(videoId)
    }

    return null
  })()

  oembedTitleRequests.set(videoId, request)
  return request
}
