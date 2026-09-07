import assert from 'node:assert/strict'
import test from 'node:test'
import { downloadErrorMessage } from '../../src/renderer/helpers/downloadErrors.js'

test('Android export failures use the current locale instead of exposing a native error code', () => {
  const translations = {
    'Downloads.Export Failed': 'Die heruntergeladene Datei konnte nicht gespeichert werden.'
  }
  assert.equal(downloadErrorMessage('DOWNLOAD_EXPORT_FAILED', key => translations[key]), translations['Downloads.Export Failed'])
})

test('download errors retain third-party diagnostic details', () => {
  const error = 'ERROR: [youtube] This video is unavailable'
  assert.equal(downloadErrorMessage(error, () => assert.fail('Unexpected translation')), error)
})
