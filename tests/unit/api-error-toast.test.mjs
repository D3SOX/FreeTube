import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../../src/renderer/helpers/utils.js', import.meta.url), 'utf8')
const start = source.indexOf('export function showApiErrorToast(')
const end = source.indexOf('\n}\n', start) + 2
const showApiErrorToast = new Function('showToast', 'copyToClipboard', 'ERROR_TOAST_ICON', 'Date', `
  let lastApiErrorToastAt = Number.NEGATIVE_INFINITY;
  ${source.slice(start, end).replace('export ', '')}
  return showApiErrorToast;
`)

test('concurrent API failures across features produce one toast during its visible lifetime', () => {
  const toasts = []
  let now = 0
  const show = showApiErrorToast(toast => toasts.push(toast), () => {}, ['fas', 'circle-exclamation'], { now: () => now })
  for (let i = 0; i < 50; i++) show('API Error', new Error(`channel ${i}`))
  assert.equal(toasts.length, 1)
  now = 10000
  show('API Error', new Error('another operation failed'))
  assert.equal(toasts.length, 2)
})
