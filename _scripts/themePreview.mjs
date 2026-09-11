import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { marked } from 'marked'

import { normalizeCustomTheme } from '../src/customTheme.js'
import { removeExternalDiscussionLinks } from './themeDiscussionLinks.mjs'
import { limitThemeDescription, THEME_DESCRIPTION_LIMIT } from './themeDiscussionDescription.mjs'

export const PREVIEW_MARKER = '<!-- theme-preview -->'
const PREVIEW_END = '<!-- theme-preview:end -->'
export const SCREENSHOTS_START = '<!-- theme-screenshots:start -->'
export const SCREENSHOTS_END = '<!-- theme-screenshots:end -->'
export const PREVIEW_VIEWS = ['subscriptions', 'watch', 'settings']

/** Only inline JSON is accepted. Never fetch attachments or execute submitted code. */
export function previewRequest(discussion) {
  if (discussion?.category?.slug !== 'themes' || discussion.closed || discussion.locked) return null
  const { body, existingHash } = removeGeneratedPreview(discussion.body)
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
  let screenshotsStart
  let screenshotsEnd
  if (start !== -1 && end > start) {
    screenshotsStart = start + SCREENSHOTS_START.length
    screenshotsEnd = end
  } else {
    // Existing app-generated posts have localized headings and no markers.
    // The last H2 before the theme's details block is the screenshots section.
    const details = body.search(/<details\b/i)
    if (details === -1) return null
    const prefix = body.slice(0, details)
    const headings = [...prefix.matchAll(/^## [^\n]+\n/gm)]
    if (headings.length < 2) return null
    const heading = headings.at(-1)
    screenshotsStart = heading.index + heading[0].length
    screenshotsEnd = details
  }
  // Text, attachment links, and unfamiliar markup all count as supplied content.
  if (body.slice(screenshotsStart, screenshotsEnd).split(/<!--[\s\S]*?-->/g).some(text => text.trim())) return null
  const theme = normalizeCustomTheme(JSON.parse(themes[0]))
  const hash = createHash('sha256').update(JSON.stringify(theme)).digest('hex')
  return { theme, hash, body, screenshotsEnd, existingHash }
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
      discussion(number:$number) { id body closed locked author { login } category { slug } }
    }
  }`, { owner, name, number })
  return repo.discussion
}

export function moderateDiscussion(repository, number, query = graphql) {
  const discussion = loadDiscussion(repository, number, query)
  if (discussion?.category?.slug !== 'themes' || discussion.closed || discussion.locked) return null
  const withoutExternalLinks = removeExternalDiscussionLinks(discussion.body)
  const body = limitThemeDescription(withoutExternalLinks)
  if (body === discussion.body) return null
  // Best-effort guard: skip edits observed since the first read. GitHub has no
  // conditional updateDiscussion mutation, so a later edit can still race this write.
  const latest = loadDiscussion(repository, number, query)
  if (latest?.body !== discussion.body || latest.category?.slug !== 'themes' || latest.closed || latest.locked) return null
  query(`mutation($id:ID!, $body:String!) {
    updateDiscussion(input:{discussionId:$id, body:$body}) { discussion { id } }
  }`, { id: discussion.id, body })
  const mention = discussion.author?.login ? `@${discussion.author.login} ` : ''
  const changes = []
  if (withoutExternalLinks !== discussion.body) {
    changes.push('I removed external images and links. Please upload screenshots directly to GitHub and use GitHub-hosted links.')
  }
  if (body !== withoutExternalLinks) {
    changes.push(`I shortened the description to fit the ${THEME_DESCRIPTION_LIMIT}-character limit, including Markdown formatting. ` +
      'A final Markdown construct may be omitted to avoid cutting it in half.')
  }
  return {
    query: `mutation($id:ID!, $body:String!) {
      addDiscussionComment(input:{discussionId:$id, body:$body}) { comment { id } }
    }`,
    variables: {
      id: discussion.id,
      body: `${mention}${changes.join(' ')} The theme JSON was preserved.`,
    },
  }
}

export function renderPreviewImages(hash, urls) {
  const images = PREVIEW_VIEWS.map(view => `![${view[0].toUpperCase() + view.slice(1)}](${urls[view]})`).join('\n')
  const imagesHash = createHash('sha256').update(images).digest('hex')
  return [
    PREVIEW_MARKER,
    `<!-- theme-preview-hash:${hash} -->`,
    `<!-- theme-preview-images:${imagesHash} -->`,
    '',
    images,
    PREVIEW_END,
  ].join('\n')
}

function removeGeneratedPreview(original) {
  const start = original.indexOf(PREVIEW_MARKER)
  const endMarker = original.indexOf(PREVIEW_END, start)
  if (start < 0 || endMarker < start) return { body: original }
  const end = endMarker + PREVIEW_END.length
  const block = original.slice(start, end).replaceAll('\r\n', '\n')
  const hash = block.match(/<!-- theme-preview-hash:([a-f0-9]{64}) -->/)?.[1]
  const images = [...block.matchAll(/!\[[^\]]+\]\((https:\/\/github\.com\/user-attachments\/assets\/[a-zA-Z0-9-]+)\)/g)]
  const urls = Object.fromEntries(PREVIEW_VIEWS.map((view, index) => [view, images[index]?.[1]]))
  // Only manage a block whose contents are exactly what we generated. Preserve
  // user edits inside it, including additional screenshots or changed URLs.
  if (!hash || block !== renderPreviewImages(hash, urls)) return { body: original }
  return { body: original.slice(0, start) + original.slice(end), existingHash: hash }
}

export function publishPreview(request, urls, query = graphql) {
  // Preserve the latest description and JSON if the author edited the post
  // during capture. Added screenshots or a changed theme cancel publication.
  const discussion = loadDiscussion(request.repository, request.number, query)
  const current = previewRequest(discussion)
  if (!current || current.hash !== request.hash || current.existingHash === request.hash) return false
  const body = current.body.slice(0, current.screenshotsEnd).trimEnd() + '\n\n' +
    renderPreviewImages(request.hash, urls) + '\n\n' + current.body.slice(current.screenshotsEnd)
  query(`mutation($id:ID!, $body:String!) {
    updateDiscussion(input:{discussionId:$id, body:$body}) { discussion { id } }
  }`, { id: discussion.id, body })
  return true
}

export function uploadPreviewImage(repositoryId, file, runGh = gh) {
  // Use the same endpoint as gh's --attach flag. Discussion commands do not
  // expose that flag yet, so upload first and include its URL in the comment.
  const endpoint = new URL('https://uploads.github.com/user-attachments/assets')
  endpoint.searchParams.set('repository_id', repositoryId)
  endpoint.searchParams.set('name', path.basename(file))
  endpoint.searchParams.set('content_type', 'image/png')
  const { url } = JSON.parse(runGh([
    'api', endpoint.href, '--method', 'POST', '--input', file,
    '-H', 'Content-Type: application/octet-stream', '-H', 'Accept: application/vnd.github+json',
  ]))
  if (typeof url !== 'string' || !url.startsWith('https://github.com/user-attachments/assets/')) {
    throw new Error('GitHub did not return an attachment URL')
  }
  return url
}

async function main() {
  const [command, directory] = process.argv.slice(2)
  if (!directory) throw new Error('Usage: themePreview.mjs moderate|prepare|upload|publish DIRECTORY')
  const requestPath = path.join(directory, 'request.json')
  const urlsPath = path.join(directory, 'urls.json')
  if (command === 'moderate') {
    const notification = moderateDiscussion(process.env.GITHUB_REPOSITORY, Number(process.env.DISCUSSION_NUMBER))
    if (notification) {
      await mkdir(directory, { recursive: true })
      await writeFile(path.join(directory, 'moderation-comment.json'), JSON.stringify(notification))
    }
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `changed=${!!notification}\n`)
    console.log(notification ? 'Updated the discussion to meet the theme posting limits.' : 'No moderation changes needed.')
  } else if (command === 'prepare') {
    const repository = process.env.GITHUB_REPOSITORY
    const number = Number(process.env.DISCUSSION_NUMBER)
    const discussion = loadDiscussion(repository, number)
    const request = previewRequest(discussion)
    const enabled = !!request && request.existingHash !== request.hash
    if (enabled) {
      await mkdir(directory, { recursive: true })
      await writeFile(requestPath, JSON.stringify({ repository, number, theme: request.theme, hash: request.hash }))
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
    const repositoryId = gh(['api', `repos/${request.repository}`, '--jq', '.id'])
    const urls = {}
    for (const view of PREVIEW_VIEWS) {
      urls[view] = uploadPreviewImage(repositoryId, path.join(directory, `${view}.png`))
    }
    await writeFile(urlsPath, JSON.stringify(urls))
  } else if (command === 'publish') {
    const request = JSON.parse(await readFile(requestPath, 'utf8'))
    const urls = JSON.parse(await readFile(urlsPath, 'utf8'))
    console.log(publishPreview(request, urls) ? 'Published theme previews.' : 'Skipped unchanged or stale previews.')
  } else {
    throw new Error(`Unknown command: ${command}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
