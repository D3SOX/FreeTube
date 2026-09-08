import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_CUSTOM_THEME } from '../../src/customTheme.js'
import {
  PREVIEW_MARKER,
  moderateDiscussion,
  previewRequest,
  publishPreview,
  renderPreviewImages,
  SCREENSHOTS_START,
  SCREENSHOTS_END,
  uploadPreviewImage,
} from '../../_scripts/themePreview.mjs'

function discussion({ theme = DEFAULT_CUSTOM_THEME, screenshots = '', markers = true, fence = '```' } = {}) {
  return {
    id: 'D_123',
    category: { slug: 'themes' },
    closed: false,
    locked: false,
    body: [
      '## Beschreibung', '', 'A theme to share.', '', '## Bildschirmfotos', '',
      markers ? SCREENSHOTS_START : '', '<!-- Drag screenshots here. -->', screenshots,
      markers ? SCREENSHOTS_END : '', '', '<details>', '<summary>Theme JSON</summary>', '',
      `${fence}json`, JSON.stringify(theme, null, 2), fence, '', '</details>',
    ].join('\n'),
  }
}

test('accepts both localized old posts and marked templates, including CRLF', () => {
  for (const markers of [false, true]) {
    const post = discussion({ markers })
    post.body = post.body.replaceAll('\n', '\r\n')
    const request = previewRequest(post)
    assert.equal(request.theme.colors.background, DEFAULT_CUSTOM_THEME.colors.background)
    assert.match(request.hash, /^[a-f0-9]{64}$/)
  }
})

test('leaves supplied screenshots, links, text, and HTML alone', () => {
  for (const screenshots of [
    '![Screenshot](https://example.com/screen.png)',
    '<img src="https://example.com/screen.png">',
    '[Screenshot](https://example.com/screen.png)',
    'I will add screenshots later.',
    '![Preview][image]\n\n[image]: https://example.com/screen.png',
  ]) {
    assert.equal(previewRequest(discussion({ screenshots })), null)
    assert.equal(previewRequest(discussion({ screenshots, markers: false })), null)
  }
  const post = discussion()
  post.body = `![Screenshot](https://example.com/screen.png)\n\n${post.body}`
  assert.equal(previewRequest(post), null)
})

test('skips other categories, closed or locked discussions, missing themes, and multiple themes', () => {
  assert.equal(previewRequest({ ...discussion(), category: { slug: 'general' } }), null)
  assert.equal(previewRequest({ ...discussion(), closed: true }), null)
  assert.equal(previewRequest({ ...discussion(), locked: true }), null)
  assert.equal(previewRequest({ ...discussion(), body: 'No theme here' }), null)
  const post = discussion()
  post.body += `\n\n\`\`\`json\n${JSON.stringify(DEFAULT_CUSTOM_THEME)}\n\`\`\`\n`
  assert.equal(previewRequest(post), null)
})

test('validates theme data and rejects CSS payloads or malformed JSON', () => {
  const theme = structuredClone(DEFAULT_CUSTOM_THEME)
  theme.colors.background = 'url(https://example.com/track)'
  assert.throws(() => previewRequest(discussion({ theme })), /Invalid or missing custom theme color/)
  assert.throws(() => previewRequest(discussion({ theme: { colors: {} } })), /Invalid or missing/)
  const post = discussion()
  post.body = post.body.replace('"version": 2', '"version": invalid')
  assert.throws(() => previewRequest(post), SyntaxError)
})

test('preserves theme names containing backticks and HTML comments as data', () => {
  const theme = { ...DEFAULT_CUSTOM_THEME, name: '``` <!-- example --> $(uname)' }
  const request = previewRequest(discussion({ theme, fence: '````' }))
  assert.equal(request.theme.name, theme.name)
  const post = discussion({ theme })
  const reformatted = { ...post, body: post.body.replace('A theme to share.', 'Changed description.') }
  assert.equal(previewRequest(post).hash, previewRequest(reformatted).hash)
})

const urls = Object.fromEntries(['subscriptions', 'watch', 'settings'].map(view => [view, `https://github.com/user-attachments/assets/${view}-123`]))

function fakeApi(post) {
  const mutations = []
  return {
    mutations,
    query(query, variables) {
      if (query.startsWith('mutation')) {
        mutations.push({ query, variables })
        return {}
      }
      assert.ok(query.includes('discussion(number:'))
      return { repository: { discussion: post } }
    },
  }
}

test('removes external discussion links and prepares an author notification for the Actions bot', () => {
  const post = { ...discussion({ screenshots: '![Screenshot](https://example.com/a.png)' }), author: { login: 'theme-author' } }
  post.body = post.body.replace('A theme to share.', 'A [theme](https://example.com) to share.')
  const api = fakeApi(post)
  const notification = moderateDiscussion('OpenTubeX/OpenTubeX', 123, api.query)
  assert.equal(api.mutations.length, 1)
  assert.equal(api.mutations[0].variables.body, post.body
    .replace('![Screenshot](https://example.com/a.png)', '')
    .replace('[theme](https://example.com)', 'theme'))
  assert.equal(notification.variables.id, post.id)
  assert.match(notification.query, /addDiscussionComment/)
  assert.match(notification.variables.body, /@theme-author/)
  assert.match(notification.variables.body, /GitHub-hosted links/)
})

test('moderation leaves allowed discussions alone without notifying the author', () => {
  for (const post of [
    discussion({ screenshots: `![Image](${urls.watch})` }),
    { ...discussion({ screenshots: 'https://example.com' }), category: { slug: 'general' } },
    { ...discussion({ screenshots: 'https://example.com' }), closed: true },
    { ...discussion({ screenshots: 'https://example.com' }), locked: true },
    null,
  ]) {
    const api = fakeApi(post)
    assert.equal(moderateDiscussion('OpenTubeX/OpenTubeX', 123, api.query), null)
    assert.equal(api.mutations.length, 0)
  }
})

test('moderation does not overwrite an author edit made during the check', () => {
  const post = discussion({ screenshots: 'https://example.com' })
  let reads = 0
  const query = (query) => {
    assert.ok(!query.startsWith('mutation'))
    reads++
    return { repository: { discussion: reads === 1 ? post : { ...post, body: post.body + '\nNew text.' } } }
  }
  assert.equal(moderateDiscussion('OpenTubeX/OpenTubeX', 123, query), null)
  assert.equal(reads, 2)
})

test('fills the original screenshot section and preserves surrounding text and theme JSON', () => {
  for (const markers of [false, true]) {
    const post = discussion({ markers })
    const request = { ...previewRequest(post), repository: 'OpenTubeX/OpenTubeX', number: 123 }
    const api = fakeApi(post)
    assert.equal(publishPreview(request, urls, api.query), true)
    assert.equal(api.mutations.length, 1)
    assert.match(api.mutations[0].query, /updateDiscussion\(input:/)
    assert.equal(api.mutations[0].variables.id, post.id)
    const body = api.mutations[0].variables.body
    assert.equal((body.match(/!\[/g) ?? []).length, 3)
    assert.equal(body, post.body.slice(0, request.screenshotsEnd).trimEnd() + '\n\n' +
      renderPreviewImages(request.hash, urls) + '\n\n' + post.body.slice(request.screenshotsEnd))
    const duplicate = fakeApi({ ...post, body })
    assert.equal(publishPreview(request, urls, duplicate.query), false)
    assert.equal(duplicate.mutations.length, 0)
  }
})

test('refreshes generated previews after a theme edit and preserves the latest description', () => {
  const original = discussion()
  const first = previewRequest(original)
  const post = discussion({
    theme: { ...DEFAULT_CUSTOM_THEME, name: 'Changed theme' },
    screenshots: renderPreviewImages(first.hash, urls),
  })
  const request = { ...previewRequest(post), repository: 'OpenTubeX/OpenTubeX', number: 123 }
  post.body = post.body.replace('A theme to share.', 'An updated description.')
  const api = fakeApi(post)
  assert.equal(publishPreview(request, urls, api.query), true)
  const body = api.mutations[0].variables.body
  assert.ok(body.includes('An updated description.'))
  assert.equal(body.split(PREVIEW_MARKER).length, 2)
  assert.equal(previewRequest({ ...post, body }).existingHash, request.hash)
})

test('preserves user changes inside or alongside generated previews', () => {
  const original = previewRequest(discussion())
  const generated = renderPreviewImages(original.hash, urls)
  for (const screenshots of [
    generated + '\n![Mine](https://example.com/personal.png)',
    generated.replace(urls.watch, 'https://example.com/personal.png'),
    generated.replace(urls.watch, 'https://github.com/user-attachments/assets/user-upload'),
    generated.replace('![Watch]', 'My own caption\n![Watch]'),
  ]) {
    assert.equal(previewRequest(discussion({ screenshots })), null)
  }
})

test('rechecks category, theme, screenshots and lock state before posting', () => {
  const request = { ...previewRequest(discussion()), repository: 'OpenTubeX/OpenTubeX', number: 123 }
  for (const post of [
    discussion({ theme: { ...DEFAULT_CUSTOM_THEME, name: 'Changed theme' } }),
    discussion({ screenshots: '![My screenshot](https://example.com/image.png)' }),
    { ...discussion(), category: { slug: 'general' } },
    { ...discussion(), locked: true },
    null,
  ]) {
    const api = fakeApi(post)
    assert.equal(publishPreview(request, urls, api.query), false)
    assert.equal(api.mutations.length, 0)
  }
})

test('uploads a screenshot as a native attachment for the source repository', () => {
  const url = 'https://github.com/user-attachments/assets/example'
  const result = uploadPreviewImage('123', '/tmp/preview images/watch.png', args => {
    const endpoint = new URL(args[1])
    assert.equal(endpoint.origin, 'https://uploads.github.com')
    assert.equal(endpoint.pathname, '/user-attachments/assets')
    assert.equal(endpoint.searchParams.get('repository_id'), '123')
    assert.equal(endpoint.searchParams.get('name'), 'watch.png')
    assert.equal(endpoint.searchParams.get('content_type'), 'image/png')
    assert.deepEqual(args.slice(2), [
      '--method', 'POST', '--input', '/tmp/preview images/watch.png',
      '-H', 'Content-Type: application/octet-stream', '-H', 'Accept: application/vnd.github+json',
    ])
    return JSON.stringify({ url })
  })
  assert.equal(result, url)
})

test('rejects missing or unexpected attachment URLs and propagates upload failures', () => {
  for (const response of [{}, { url: 'https://example.com/image.png' }]) {
    assert.throws(() => uploadPreviewImage('123', '/tmp/watch.png', () => JSON.stringify(response)), /attachment URL/)
  }
  assert.throws(() => uploadPreviewImage('123', '/tmp/watch.png', () => { throw new Error('Forbidden') }), /Forbidden/)
})
