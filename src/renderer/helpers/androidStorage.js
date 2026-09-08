import { registerPlugin } from '@capacitor/core'
import { blobToDataUrl } from './fileData'

const AndroidStorage = process.env.IS_CAPACITOR ? registerPlugin('AndroidStorage') : null

export async function chooseAndroidDirectory() {
  const result = await AndroidStorage.chooseDirectory()
  return result.path
}

/**
 * @param {string} fileName
 * @param {string | Blob} content
 * @param {string} mimeType
 * @param {string} [directory] Persisted Android document-tree URI; otherwise prompts for a file.
 * @returns {Promise<boolean>}
 */
export async function saveAndroidFile(fileName, content, mimeType, directory) {
  const blob = typeof content === 'string' ? new Blob([content], { type: mimeType }) : content
  const dataUrl = await blobToDataUrl(blob)
  const result = await AndroidStorage.saveFile({ fileName, data: dataUrl.slice(dataUrl.indexOf(',') + 1), mimeType, directory })
  return result.saved === true
}

function storageBytes(value) {
  return Number.isFinite(value) && value >= 0 ? value : null
}

export async function getAndroidStorageUsage() {
  const result = await (AndroidStorage?.getUsage() ?? Promise.resolve({}))
  return {
    androidAppData: storageBytes(result.appDataBytes),
    androidCache: storageBytes(result.cacheBytes),
  }
}

export async function clearAndroidCache() {
  const result = await (AndroidStorage?.clearCache() ?? Promise.resolve({ cleared: false }))
  return result.cleared === true
}
