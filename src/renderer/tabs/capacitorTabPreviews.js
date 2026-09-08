import { Capacitor, registerPlugin } from '@capacitor/core'
import { Filesystem } from '@capacitor/filesystem'
import { shallowReactive, watch } from 'vue'
import { canCaptureCapacitorTab, createCapacitorPreviewCache } from './capacitorPreviewCache.js'

const Screenshot = registerPlugin('Screenshot')
const cache = createCapacitorPreviewCache(capturePage, shallowReactive(new Map()))
let captureCurrent = async () => {}

export function getCapacitorTabPreview(tab) {
  return cache.get(tab)
}

export async function captureBeforeTabOrganizer() {
  let timeout
  // A slow/failed native call must not prevent opening the organizer.
  await Promise.race([
    captureCurrent(),
    new Promise(resolve => { timeout = setTimeout(resolve, 250) })
  ])
  clearTimeout(timeout)
  cache.invalidate()
}

export function initializeCapacitorTabPreviews(store) {
  if (!process.env.IS_CAPACITOR || !Capacitor.isPluginAvailable('Screenshot')) return () => {}
  let timer
  const canCapture = () => canCaptureCapacitorTab(store.getters, document.visibilityState === 'visible') && !hasVisibleOverlay()
  captureCurrent = async () => {
    clearTimeout(timer)
    if (canCapture()) await cache.capture(store.getters.getPresentedTab)
  }
  const schedule = () => {
    cache.invalidate()
    clearTimeout(timer)
    timer = setTimeout(captureCurrent, 600)
  }
  const stop = watch(() => [
    store.getters.getShowTabPreviews,
    store.getters.isAnyPromptOpen,
    store.getters.getSettingsWindowOpen,
    store.getters.getSettingsWindowMorphing,
    store.getters.getActiveTabId,
    store.getters.getPresentedTabId,
    ...store.getters.getTabs.map(tab => `${tab.id}:${tab.route.fullPath}:${tab.isLoading}:${tab.refreshKey}:${tab.loadState}`)
  ], () => {
    if (!store.getters.getShowTabPreviews) cache.clear()
    cache.prune(store.getters.getTabs)
    schedule()
  }, { immediate: true, flush: 'sync' })
  document.addEventListener('scroll', schedule, true)
  document.addEventListener('visibilitychange', schedule)
  window.addEventListener('resize', schedule)
  return () => {
    stop()
    clearTimeout(timer)
    cache.clear()
    captureCurrent = async () => {}
    document.removeEventListener('scroll', schedule, true)
    document.removeEventListener('visibilitychange', schedule)
    window.removeEventListener('resize', schedule)
  }
}

function hasVisibleOverlay() {
  return [...document.querySelectorAll('[role="dialog"], [role="menu"], .settingsWindow')]
    .some(element => element.getBoundingClientRect().width > 0 && getComputedStyle(element).visibility !== 'hidden')
}

async function capturePage() {
  const width = window.innerWidth
  const height = window.innerHeight
  let top = 0
  for (const selector of ['.topNav', '.capacitorTabletTabBar']) {
    const rect = document.querySelector(selector)?.getBoundingClientRect()
    if (rect?.width > 0) top = Math.max(top, rect.bottom)
  }
  top = Math.max(0, Math.min(top, height))
  if (height <= top || width <= 0) return null
  const canvas = document.createElement('canvas')
  canvas.width = Math.min(640, width)
  const context = canvas.getContext('2d')
  // Crop the top of the visible content to the card's aspect ratio.
  const cropHeight = Math.min(height - top, width * 9 / 16)
  canvas.height = Math.round(canvas.width * cropHeight / width)
  const scaleX = canvas.width / width
  const scaleY = canvas.height / cropHeight
  const videos = [...document.querySelectorAll('.tabContent:not([inert]) video')]
    .map(video => ({ video, rect: video.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 0 && rect.height > 0 && rect.bottom > top && rect.top < top + cropHeight)
  const { uri } = await Screenshot.take()
  try {
    const screenshot = new Image()
    screenshot.src = Capacitor.convertFileSrc(uri)
    await screenshot.decode()
    if (hasVisibleOverlay()) return null
    context.drawImage(screenshot, 0, top * screenshot.height / height,
      screenshot.width, cropHeight * screenshot.height / height,
      0, 0, canvas.width, canvas.height)
    // Hardware video surfaces can be separate from the window buffer. Composite
    // readable frames; otherwise retain the card fallback.
    for (const { video, rect } of videos) {
      if (video.readyState < 2 || !video.videoWidth) return null
      const fit = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight)
      const frameWidth = video.videoWidth * fit
      const frameHeight = video.videoHeight * fit
      context.fillStyle = '#000'
      context.fillRect(rect.left * scaleX, (rect.top - top) * scaleY, rect.width * scaleX, rect.height * scaleY)
      context.drawImage(video,
        (rect.left + (rect.width - frameWidth) / 2) * scaleX,
        (rect.top - top + (rect.height - frameHeight) / 2) * scaleY,
        frameWidth * scaleX, frameHeight * scaleY)
    }
    return canvas.toDataURL('image/jpeg', 0.7)
  } finally {
    try {
      await Filesystem.deleteFile({ path: uri })
    } catch (error) {
      console.warn('Failed to delete temporary tab screenshot', error)
    }
  }
}
