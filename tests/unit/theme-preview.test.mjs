import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_CUSTOM_THEME } from '../../src/customTheme.js'
import {
  findPreviewComment,
  PREVIEW_MARKER,
  previewRequest,
  publishPreview,
  renderPreviewComment,
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

const urls = Object.fromEntries(['subscriptions', 'watch', 'settings'].map(view => [view, `https://example.com/${view}.png`]))

function fakeApi(post, comments = []) {
  const mutations = []
  return {
    mutations,
    query(query, variables) {
      if (query.startsWith('mutation')) {
        mutations.push({ query, variables })
        return {}
      }
      if (query.includes('discussion(number:')) return { repository: { discussion: post } }
      return { node: { comments: { nodes: comments, pageInfo: { hasNextPage: false } } } }
    },
  }
}

test('publishes three images once, then skips duplicates', () => {
  const post = discussion()
  const request = { ...previewRequest(post), repository: 'OpenTubeX/OpenTubeX', number: 123 }
  const api = fakeApi(post)
  assert.equal(publishPreview(request, urls, api.query), true)
  assert.equal(api.mutations.length, 1)
  assert.match(api.mutations[0].query, /addDiscussionComment/)
  const body = api.mutations[0].variables.body
  assert.equal((body.match(/!\[/g) ?? []).length, 3)
  const duplicate = fakeApi(post, [{ id: 'C_1', body, author: { login: 'github-actions', __typename: 'Bot' } }])
  assert.equal(publishPreview(request, urls, duplicate.query), false)
  assert.equal(duplicate.mutations.length, 0)
})

test('refreshes the bot comment and does not edit a user comment with a copied marker', () => {
  const post = discussion()
  const request = { ...previewRequest(post), repository: 'OpenTubeX/OpenTubeX', number: 123 }
  const api = fakeApi(post, [
    { id: 'user', body: PREVIEW_MARKER, author: { login: 'someone' } },
    { id: 'bot', body: renderPreviewComment('old-hash', urls), author: { login: 'github-actions', __typename: 'Bot' } },
  ])
  assert.equal(publishPreview(request, urls, api.query), true)
  assert.match(api.mutations[0].query, /updateDiscussionComment/)
  assert.equal(api.mutations[0].variables.id, 'bot')
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

test('finds an existing bot comment beyond the first page', () => {
  const comment = { id: 'bot', body: PREVIEW_MARKER, author: { login: 'github-actions', __typename: 'Bot' } }
  const cursors = []
  const found = findPreviewComment('D_123', (_query, { after }) => {
    cursors.push(after)
    return { node: { comments: after
      ? { nodes: [comment], pageInfo: { hasNextPage: false } }
      : { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'next' } } } }
  })
  assert.deepEqual(found, comment)
  assert.deepEqual(cursors, [null, 'next'])
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
