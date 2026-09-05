import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { marked } from 'marked'

import { normalizeCustomTheme } from '../src/customTheme.js'
import { selectReleaseTag } from './releaseNoteMedia.mjs'

export const PREVIEW_MARKER = '<!-- theme-preview -->'
export const SCREENSHOTS_START = '<!-- theme-screenshots:start -->'
export const SCREENSHOTS_END = '<!-- theme-screenshots:end -->'
export const PREVIEW_VIEWS = ['subscriptions', 'watch', 'settings']
const MEDIA_REPOSITORY = 'OpenTubeX/media'

/** Only inline JSON is accepted. Never fetch attachments or execute submitted code. */
export function previewRequest(discussion) {
  if (discussion?.category?.slug !== 'themes' || discussion.closed || discussion.locked) return null
  const body = discussion.body.replaceAll('\r\n', '\n')
  const tokens = marked.lexer(body)
  const themes = []
  let hasImage = false
  marked.walkTokens(tokens, token => {
    if (token.type === 'image' || (token.type === 'html' && token.text.split(/<!--[\s\S]*?-->/g)
      .some(text => /<(?:img|picture|video)\b/i.test(text)))) hasImage = true
    if (token.type === 'code' && token.lang?.toLowerCase() === 'json') themes.push(token.text)
  })
  if (hasImage || themes.length !== 1) return null

  const start = body.indexOf(SCREENSHOTS_START)
  const end = body.indexOf(SCREENSHOTS_END)
  let screenshots
  if (start !== -1 && end > start) {
    screenshots = body.slice(start + SCREENSHOTS_START.length, end)
  } else {
    // Existing app-generated posts have localized headings and no markers.
    // The last H2 before the theme's details block is the screenshots section.
    const details = body.search(/<details\b/i)
    if (details === -1) return null
    const prefix = body.slice(0, details)
    const headings = [...prefix.matchAll(/^## [^\n]+\n/gm)]
    if (headings.length < 2) return null
    const heading = headings.at(-1)
    screenshots = prefix.slice(heading.index + heading[0].length)
  }
  // Text, attachment links, and unfamiliar markup all count as supplied content.
  if (screenshots.split(/<!--[\s\S]*?-->/g).some(text => text.trim())) return null
  const theme = normalizeCustomTheme(JSON.parse(themes[0]))
  const hash = createHash('sha256').update(JSON.stringify(theme)).digest('hex')
  return { theme, hash }
}

function gh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 8 * 1024 * 1024 }).trim()
}

function graphql(query, variables) {
  const result = JSON.parse(gh(['api', 'graphql', '--input', '-'], JSON.stringify({ query, variables })))
  if (result.errors?.length) throw new Error(JSON.stringify(result.errors))
  return result.data
}

export function loadDiscussion(repository, number, query = graphql) {
  const [owner, name] = repository.split('/')
  if (!owner || !name || !Number.isSafeInteger(number) || number < 1) throw new Error('Invalid discussion')
  const { repository: repo } = query(`query($owner:String!, $name:String!, $number:Int!) {
    repository(owner:$owner, name:$name) {
      discussion(number:$number) { id body closed locked category { slug } }
    }
  }`, { owner, name, number })
  return repo.discussion
}

export function findPreviewComment(id, query = graphql) {
  let after = null
  do {
    const { node } = query(`query($id:ID!, $after:String) {
      node(id:$id) { ... on Discussion { comments(first:100, after:$after) {
        nodes { id body author { login __typename } }
        pageInfo { hasNextPage endCursor }
      } } }
    }`, { id, after })
    const { nodes, pageInfo } = node.comments
    const comment = nodes.find(item => item.author?.__typename === 'Bot' &&
      item.author.login === 'github-actions' && item.body.startsWith(PREVIEW_MARKER))
    if (comment) return comment
    after = pageInfo.hasNextPage ? pageInfo.endCursor : null
  } while (after)
  return null
}

export function renderPreviewComment(hash, urls) {
  return [
    PREVIEW_MARKER,
    `<!-- theme-preview-hash:${hash} -->`,
    'Three automatic theme previews, captured with an isolated profile and sample content. No personal subscriptions or history are used.',
    '',
    ...PREVIEW_VIEWS.map(view => `![${view[0].toUpperCase() + view.slice(1)}](${urls[view]})`),
    '',
    'Edit the theme JSON to refresh these previews. Add your own screenshots to the post to stop automatic updates.',
  ].join('\n')
}

export function publishPreview(request, urls, query = graphql) {
  // An author may have edited the theme or added screenshots during capture.
  const discussion = loadDiscussion(request.repository, request.number, query)
  const current = previewRequest(discussion)
  if (!current || current.hash !== request.hash) return false
  const comment = findPreviewComment(discussion.id, query)
  const body = renderPreviewComment(request.hash, urls)
  if (comment?.body.includes(`<!-- theme-preview-hash:${request.hash} -->`)) return false
  if (comment) {
    query(`mutation($id:ID!, $body:String!) {
      updateDiscussionComment(input:{commentId:$id, body:$body}) { comment { id } }
    }`, { id: comment.id, body })
  } else {
    query(`mutation($id:ID!, $body:String!) {
      addDiscussionComment(input:{discussionId:$id, body:$body}) { comment { id } }
    }`, { id: discussion.id, body })
  }
  return true
}

export function unusedPreviewViews(request, urls, query = graphql) {
  const discussion = loadDiscussion(request.repository, request.number, query)
  const comment = discussion && findPreviewComment(discussion.id, query)
  // Re-read after a failed mutation too: GitHub may have saved the comment
  // even if the runner did not receive its response.
  return PREVIEW_VIEWS.filter(view => !comment?.body.includes(urls[view]))
}

export function cleanupPreviewUploads({ tag, names }, runGh = gh) {
  const releaseId = runGh(['api', `repos/${MEDIA_REPOSITORY}/releases/tags/${tag}`, '--jq', '.id'])
  const pages = JSON.parse(runGh(['api', `repos/${MEDIA_REPOSITORY}/releases/${releaseId}/assets?per_page=100`, '--paginate', '--slurp']))
  for (const asset of pages.flat().filter(asset => names.includes(asset.name))) {
    runGh(['api', `repos/${MEDIA_REPOSITORY}/releases/assets/${asset.id}`, '--method', 'DELETE'])
  }
}

async function main() {
  const [command, directory] = process.argv.slice(2)
  if (!directory) throw new Error('Usage: themePreview.mjs prepare|upload|publish|check-cleanup|cleanup DIRECTORY')
  const requestPath = path.join(directory, 'request.json')
  const urlsPath = path.join(directory, 'urls.json')
  const uploadPath = path.join(directory, 'upload.json')
  const cleanupPath = path.join(directory, 'cleanup.json')
  if (command === 'prepare') {
    const repository = process.env.GITHUB_REPOSITORY
    const number = Number(process.env.DISCUSSION_NUMBER)
    const discussion = loadDiscussion(repository, number)
    const request = previewRequest(discussion)
    const comment = request && findPreviewComment(discussion.id)
    const enabled = !!request && !comment?.body.includes(`<!-- theme-preview-hash:${request.hash} -->`)
    if (enabled) {
      await mkdir(directory, { recursive: true })
      await writeFile(requestPath, JSON.stringify({ repository, number, ...request }))
      await writeFile(path.join(directory, 'theme.json'), JSON.stringify(request.theme))
    }
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `enabled=${enabled}\n`)
    console.log(enabled ? 'Theme needs previews.' : 'No previews needed.')
  } else if (command === 'upload') {
    const request = JSON.parse(await readFile(requestPath, 'utf8'))
    // Validate all captures before uploading any of them.
    for (const view of PREVIEW_VIEWS) {
      const bytes = await readFile(path.join(directory, `${view}.png`))
      if (!bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) || bytes.length > 10 * 1024 * 1024) {
        throw new Error(`Invalid ${view} screenshot`)
      }
    }
    const tag = selectReleaseTag(3)
    const urls = {}
    const files = []
    for (const view of PREVIEW_VIEWS) {
      const name = `theme-${request.number}-${request.hash}-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}-${view}.png`
      const destination = path.join(directory, name)
      await copyFile(path.join(directory, `${view}.png`), destination)
      files.push(destination)
      urls[view] = `https://github.com/${MEDIA_REPOSITORY}/releases/download/${tag}/${name}`
    }
    // Record intended assets first so partial uploads can also be cleaned up.
    await writeFile(uploadPath, JSON.stringify({ tag, names: files.map(file => path.basename(file)) }))
    await writeFile(urlsPath, JSON.stringify(urls))
    gh(['release', 'upload', tag, ...files, '--repo', MEDIA_REPOSITORY])
  } else if (command === 'publish') {
    const request = JSON.parse(await readFile(requestPath, 'utf8'))
    const urls = JSON.parse(await readFile(urlsPath, 'utf8'))
    const published = publishPreview(request, urls)
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `published=${published}\n`)
    console.log(published ? 'Published theme previews.' : 'Skipped unchanged or stale previews.')
  } else if (command === 'check-cleanup') {
    const upload = await readFile(uploadPath, 'utf8').catch(error => {
      if (error.code !== 'ENOENT') throw error
      return null
    })
    if (!upload) return
    const request = JSON.parse(await readFile(requestPath, 'utf8'))
    const urls = JSON.parse(await readFile(urlsPath, 'utf8'))
    const unused = unusedPreviewViews(request, urls)
    const { tag, names } = JSON.parse(upload)
    await writeFile(cleanupPath, JSON.stringify({ tag, names: names.filter((_, index) => unused.includes(PREVIEW_VIEWS[index])) }))
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `enabled=${unused.length > 0}\n`)
  } else if (command === 'cleanup') {
    cleanupPreviewUploads(JSON.parse(await readFile(cleanupPath, 'utf8')))
  } else {
    throw new Error(`Unknown command: ${command}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
