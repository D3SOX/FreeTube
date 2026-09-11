import assert from 'node:assert/strict'
import { test } from 'node:test'

import { removeExternalDiscussionLinks } from '../../_scripts/themeDiscussionLinks.mjs'

const upload = 'https://github.com/user-attachments/assets/example'

test('keeps GitHub uploads, repository links, and local anchors unchanged', () => {
  const body = `![Upload](${upload})\n[Repo](https://github.com/OpenTubeX/OpenTubeX)\n` +
    '[File](https://raw.githubusercontent.com/OpenTubeX/OpenTubeX/development/README.md)\n' +
    '[Docs](https://docs.github.com/en)\n[Section](#screenshots)\n' +
    '[Related discussion](1197) <a href="1197">Related discussion</a>'
  assert.equal(removeExternalDiscussionLinks(body), body)
})

test('removes external images and unwraps external links without changing their labels', () => {
  assert.equal(removeExternalDiscussionLinks('Before ![Screenshot](https://example.com/a.png) [**Help**](https://example.com) after.'),
    'Before  **Help** after.')
})

test('removes standalone URLs and URL-shaped labels that would become links again', () => {
  for (const link of ['https://example.com', 'www.example.com', '<https://example.com>', 'person@example.com', '[https://example.com](https://example.com)']) {
    assert.equal(removeExternalDiscussionLinks(`Before ${link} after.`), 'Before  after.')
  }
})

test('handles reference images and links while preserving valid definitions', () => {
  const body = `![Bad][image]\n[**Read**][external]\n[external]\n![Good][upload]\n\n` +
    `[image]: https://example.com/a.png\n[external]: https://example.com\n[upload]: ${upload}`
  assert.equal(removeExternalDiscussionLinks(body), `\n**Read**\nexternal\n![Good][upload]\n\n\n\n[upload]: ${upload}`)
})

test('preserves code, escaped markup, comments, and the theme JSON byte for byte', () => {
  const body = '\\![Image](https://example.com/a.png)\n\n' +
    '`![Image](https://example.com/a.png)`\n\n' +
    '<!-- <img src="https://example.com/a.png"> -->\n\n' +
    '<details>\n\n```json\n{"name":"https://example.com", "other":"<img src=evil>"}\n```\n\n</details>\n\n' +
    '    ![Image](https://example.com/a.png)\n'
  // Escaping only ! leaves an ordinary external Markdown link; its label stays.
  assert.equal(removeExternalDiscussionLinks(body), body.replace('\\![Image](https://example.com/a.png)', '\\!Image'))
})

test('edits nested and multiline markup using its original source positions', () => {
  assert.equal(removeExternalDiscussionLinks('> ![a\n> b](https://example.com)\n> Keep **this**.\n'), '> \n> Keep **this**.\n')
  assert.equal(removeExternalDiscussionLinks('- [a\n  b](https://example.com)\n'), '- a\n  b\n')
  assert.equal(removeExternalDiscussionLinks('> <img\n> src="https://example.com/a.png">\n> Keep.\n'), '> \n> Keep.\n')
})

test('removes external HTML image sources and link destinations, retaining other markup', () => {
  const body = `<picture><source srcset="${upload} 1x, https://example.com/a.png 2x">` +
    `<img src="${upload}" alt="Keep > this"></picture> ` +
    '<a class="help" href="https://example.com">Help</a> <img SRC=https://example.com/a.png>'
  assert.equal(removeExternalDiscussionLinks(body), `<picture><img src="${upload}" alt="Keep > this"></picture> ` +
    '<a class="help" >Help</a> ')
})

test('rejects misleading hosts, credentials, non-HTTPS destinations, and encoded external URLs', () => {
  for (const url of [
    'https://github.com.evil.test/a', 'https://github.com@evil.test/a',
    'https://evilgithubusercontent.com/a', '//evil.test/a',
    'http://github.com/a', 'javascript:alert(1)', 'data:image/png;base64,abc',
    'https://github.com&#64;evil.test/a',
    '/&sol;example.com/image.png', '/&bsol;example.com/image.png',
  ]) {
    assert.equal(removeExternalDiscussionLinks(`![Image](${url})`), '', url)
    assert.equal(removeExternalDiscussionLinks(`<img src="${url}">`), '', url)
  }
})

test('keeps nested allowed images when unwrapping an external link', () => {
  const body = `[![Image](${upload})](https://example.com)`
  assert.equal(removeExternalDiscussionLinks(body), `![Image](${upload})`)
})

test('recognizes HTML form-feed whitespace without changing surrounding text', () => {
  assert.equal(removeExternalDiscussionLinks('<img\fsrc="https://example.com/a">'), '')
  assert.equal(removeExternalDiscussionLinks('<a\fhref="https://example.com">Help</a>'), '<a\f>Help</a>')
})
