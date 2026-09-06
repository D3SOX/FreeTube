/**
 * Translate application errors while preserving yt-dlp's diagnostic output.
 * @param {string} error
 * @param {(key: string) => string} translate
 * @returns {string}
 */
export function downloadErrorMessage(error, translate) {
  return error === 'DOWNLOAD_EXPORT_FAILED' ? translate('Downloads.Export Failed') : error
}
