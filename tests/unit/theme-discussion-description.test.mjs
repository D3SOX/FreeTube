import assert from 'node:assert/strict'
import { test } from 'node:test'

import { limitThemeDescription } from '../../_scripts/themeDiscussionDescription.mjs'

function post(description, { markers = true, newline = '\n' } = {}) {
  return ['## Beschreibung', '', description, '', '## Bildschirmfotos', '',
    markers ? '<!-- theme-screenshots:start -->' : '',
    '![Screenshot](https://github.com/user-attachments/assets/example)',
    markers ? '<!-- theme-screenshots:end -->' : '', '',
    '<details>', '<summary>Theme JSON</summary>', '', '```json',
    JSON.stringify({ name: 'A'.repeat(800) }), '```', '', '</details>',
  ].join('\n').replaceAll('\n', newline)
}

test('leaves descriptions at or below 500 characters unchanged', () => {
  for (const length of [0, 499, 500]) {
    const body = post('a'.repeat(length))
    assert.equal(limitThemeDescription(body), body)
  }
})

test('limits only the description, preserving uploaded screenshots and theme JSON', () => {
  for (const markers of [false, true]) {
    for (const newline of ['\n', '\r\n']) {
      assert.equal(limitThemeDescription(post('a'.repeat(501), { markers, newline })),
        post('a'.repeat(500), { markers, newline }))
    }
  }
})

test('counts Unicode characters without cutting a surrogate pair', () => {
  assert.equal(limitThemeDescription(post('🌈'.repeat(501))), post('🌈'.repeat(500)))
})

test('does not charge the generated description prompt against the limit', () => {
  const hint = '<!-- Describe the theme. -->\n\n'
  assert.equal(limitThemeDescription(post(hint + 'a'.repeat(501))), post(hint + 'a'.repeat(500)))
})

test('does not mistake headings inside code for the screenshots boundary', () => {
  const description = '```\n## Example\n```\n\n' + 'a'.repeat(501)
  assert.equal(limitThemeDescription(post(description)), post(description.slice(0, 500)))
})

test('omits a trailing Markdown construct if the limit would split it', () => {
  for (const suffix of [
    '**a long emphasis**', '`a long code span`',
    '[a link](https://github.com/OpenTubeX/OpenTubeX)',
    '\n\n```\nA long fenced example\n```',
    '<details>\n\nA long example\n\n</details>',
  ]) {
    assert.equal(limitThemeDescription(post('a'.repeat(490) + ' ' + suffix)), post('a'.repeat(490)))
  }
})

test('preserves bodies whose description section cannot be identified', () => {
  const body = 'Unstructured post\n' + 'a'.repeat(501)
  assert.equal(limitThemeDescription(body), body)
})

test('does not interpret HTML examples in code as containers around later text', () => {
  for (const example of ['`<div>`', '```html\n<div>\n```']) {
    const description = example + '\n\n' + 'a'.repeat(501)
    assert.equal(limitThemeDescription(post(description)), post(description.slice(0, 500)))
  }
})
