import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const NOT_NOTEWORTHY_CATEGORY = 'Not noteworthy'
const RELEASE_NOTE_CATEGORIES = new Map([
  ['Highlights', '## Highlights'],
  ['More improvements', '## More improvements'],
  ['Fixed bugs', '## Fixed bugs'],
])
const RELEASE_NOTE_CATEGORY_MARKER = 'release-note-category'
const RELEASE_NOTE_MARKER = 'release-note'
const RELEASE_IMAGE_MARKER = 'release-note-image'
const MAX_IMAGE_HEIGHT = 300
const IMAGE_DOWNLOAD_TIMEOUT_MS = 30_000
const ALLOWED_IMAGE_HOSTS = new Set([
  'github.com',
  'private-user-images.githubusercontent.com',
  'raw.githubusercontent.com',
  'user-images.githubusercontent.com',
])
const ALLOWED_IMAGE_DOWNLOAD_HOSTS = new Set([
  ...ALLOWED_IMAGE_HOSTS,
  'github-production-user-asset-6210df.s3.amazonaws.com',
  'release-assets.githubusercontent.com',
])
const MERGED_PULL_REQUESTS_QUERY = `
query($owner: String!, $repo: String!, $base: String!, $endCursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequests(
      first: 100
      after: $endCursor
      states: MERGED
      baseRefName: $base
      orderBy: { field: CREATED_AT, direction: DESC }
    ) {
      nodes {
        body
        closingIssuesReferences(first: 100) {
          nodes { number }
        }
        mergeCommit { oid }
        mergedAt
        number
        title
        url
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}
`

function extractMarkedSection(body, marker) {
  const startMarker = `<!-- ${marker}:start -->`
  const endMarker = `<!-- ${marker}:end -->`
  const start = body.indexOf(startMarker)
  const end = body.indexOf(endMarker)

  if (start === -1 || end === -1 || end < start) { return null }

  return body.slice(start + startMarker.length, end).trim()
}

function decodeHtml(value) {
  const entities = {
    '#39': '\'',
    amp: '&',
    gt: '>',
    lt: '<',
    quot: '"',
  }

  return value.replaceAll(/&(#39|amp|gt|lt|quot);/g, (entity, name) => entities[name])
}

function extractHtmlAttribute(tag, attribute) {
  const match = tag.match(new RegExp(`(?:^|\\s)${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))
  return match?.[1] ?? match?.[2] ?? null
}

function parseThemedReleaseImage(picture) {
  const content = picture
    .replace(/^<picture\s*>/i, '')
    .replace(/<\/picture\s*>$/i, '')
  const tags = [...content.matchAll(/<source\b[^>]*>|<img\b[^>]*>/gi)]
  let end = 0

  for (const tag of tags) {
    if (content.slice(end, tag.index).trim()) {
      throw new Error('A themed release note image may contain only two <source> tags and one <img> tag.')
    }

    end = tag.index + tag[0].length
  }

  if (content.slice(end).trim()) {
    throw new Error('A themed release note image may contain only two <source> tags and one <img> tag.')
  }

  const sources = new Map()
  let fallback = null

  for (const tag of tags) {
    if (/^<img\b/i.test(tag[0])) {
      if (fallback) { throw new Error('A themed release note image must contain exactly one <img> tag.') }

      const url = extractHtmlAttribute(tag[0], 'src')

      if (!url) { throw new Error('A themed release note image is missing its fallback src attribute.') }

      fallback = {
        alt: decodeHtml(extractHtmlAttribute(tag[0], 'alt') ?? ''),
        url: decodeHtml(url),
      }
      continue
    }

    const media = extractHtmlAttribute(tag[0], 'media')
    const theme = media?.match(/^\(prefers-color-scheme:\s*(dark|light)\)$/i)?.[1].toLowerCase()
    const url = extractHtmlAttribute(tag[0], 'srcset')

    if (!theme || !url || sources.has(theme)) {
      throw new Error('A themed release note image needs one dark and one light <source> tag.')
    }

    sources.set(theme, decodeHtml(url))
  }

  if (!fallback || sources.size !== 2 || !sources.has('dark') || !sources.has('light')) {
    throw new Error('A themed release note image needs one dark source, one light source, and one fallback image.')
  }

  if (fallback.url !== sources.get('dark')) {
    throw new Error('A themed release note image must use the dark source as its fallback image.')
  }

  return {
    alt: fallback.alt,
    darkUrl: sources.get('dark'),
    lightUrl: sources.get('light'),
    url: fallback.url,
  }
}

export function parseReleaseImages(section) {
  if (!section) { return [] }

  const matches = [...section.matchAll(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)|<picture\s*>[\s\S]*?<\/picture\s*>|<img\b[^>]*>/gi)]
  let end = 0

  for (const match of matches) {
    if (section.slice(end, match.index).trim()) {
      throw new Error('Release note images must be Markdown images, <img> tags, or themed <picture> elements.')
    }

    end = match.index + match[0].length
  }

  if (section.slice(end).trim()) {
    throw new Error('Release note images must be Markdown images, <img> tags, or themed <picture> elements.')
  }

  const images = matches
    .map((match) => {
      if (match[1] !== undefined) {
        return {
          alt: match[1].trim(),
          url: match[2],
        }
      }

      if (/^<picture\b/i.test(match[0])) { return parseThemedReleaseImage(match[0]) }

      const url = extractHtmlAttribute(match[0], 'src')

      if (!url) { throw new Error('A release note image is missing its src attribute.') }

      return {
        alt: decodeHtml(extractHtmlAttribute(match[0], 'alt') ?? ''),
        url: decodeHtml(url),
      }
    })

  if (images.length === 0) {
    throw new Error('Release note images must be Markdown images, <img> tags, or themed <picture> elements.')
  }

  return images
}

function validateImageUrl(value, allowedHosts = ALLOWED_IMAGE_HOSTS) {
  let url

  try {
    url = new URL(value)
  } catch {
    throw new Error('The release note image has an invalid URL.')
  }

  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) { throw new Error('Release note images must be hosted by GitHub.') }

  return url
}

export function validateDownloadedImageUrl(value) {
  return validateImageUrl(value, ALLOWED_IMAGE_DOWNLOAD_HOSTS)
}

export function parseReleaseNote(body) {
  const note = extractMarkedSection(body, RELEASE_NOTE_MARKER)

  if (!note) { throw new Error('Fill in the release note section before merging this noteworthy PR.') }

  const images = parseReleaseNoteImages(body)

  for (const image of images) {
    validateImageUrl(image.url)
    if (image.lightUrl) { validateImageUrl(image.lightUrl) }
  }

  return { images, note }
}

function parseReleaseNoteImages(body) {
  const section = extractMarkedSection(body, RELEASE_IMAGE_MARKER)

  if (section === null) { throw new Error('Keep the release note images section in the pull request body.') }

  return parseReleaseImages(section)
}

export function parseReleaseNoteCategory(body) {
  const section = extractMarkedSection(body, RELEASE_NOTE_CATEGORY_MARKER)

  if (!section) { throw new Error('Select one release note category.') }

  const selected = [...section.matchAll(/^\s*-\s*\[[xX]\]\s+(.+?)\s*$/gm)]
    .map((match) => match[1])

  if (selected.length !== 1) { throw new Error('Select exactly one release note category.') }

  const category = selected[0]

  if (category !== NOT_NOTEWORTHY_CATEGORY && !RELEASE_NOTE_CATEGORIES.has(category)) {
    throw new Error(`Unknown release note category: ${category}.`)
  }

  return category
}

function parsePullRequestReleaseNote(body) {
  for (const marker of [RELEASE_NOTE_CATEGORY_MARKER, RELEASE_NOTE_MARKER, RELEASE_IMAGE_MARKER]) {
    if (extractMarkedSection(body, marker) === null) {
      throw new Error(`Keep the ${marker} markers in the pull request body.`)
    }
  }

  const category = parseReleaseNoteCategory(body)

  parseReleaseNoteImages(body)

  if (category === NOT_NOTEWORTHY_CATEGORY) { return { category } }

  return {
    category,
    ...parseReleaseNote(body),
  }
}

export function validatePullRequestEvent(event) {
  const pullRequest = event.pull_request

  if (!pullRequest) { throw new Error('The event does not contain a pull request.') }

  return parsePullRequestReleaseNote(pullRequest.body ?? '')
}

function readUInt24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16)
}

function probeJpeg(buffer) {
  let offset = 2

  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }

    const marker = buffer[offset + 1]
    const isStartOfFrame = [
      0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
      0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
    ].includes(marker)

    if (isStartOfFrame) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      }
    }

    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) {
      offset += 2
      continue
    }

    const length = buffer.readUInt16BE(offset + 2)

    if (length < 2) { break }

    offset += length + 2
  }

  return null
}

function probeWebp(buffer) {
  const type = buffer.toString('ascii', 12, 16)

  if (type === 'VP8X' && buffer.length >= 30) {
    return {
      height: readUInt24LE(buffer, 27) + 1,
      width: readUInt24LE(buffer, 24) + 1,
    }
  }

  if (type === 'VP8 ' && buffer.length >= 30) {
    return {
      height: buffer.readUInt16LE(28) & 0x3fff,
      width: buffer.readUInt16LE(26) & 0x3fff,
    }
  }

  if (type === 'VP8L' && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21)

    return {
      height: ((bits >> 14) & 0x3fff) + 1,
      width: (bits & 0x3fff) + 1,
    }
  }

  return null
}

export function probeImageSize(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from('\x89PNG\r\n\x1a\n', 'binary'))) {
    return {
      height: buffer.readUInt32BE(20),
      width: buffer.readUInt32BE(16),
    }
  }

  if (buffer.length >= 10 && ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) {
    return {
      height: buffer.readUInt16LE(8),
      width: buffer.readUInt16LE(6),
    }
  }

  if (buffer.length >= 12 && buffer[0] === 0xff && buffer[1] === 0xd8) { return probeJpeg(buffer) }

  if (
    buffer.length >= 30 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return probeWebp(buffer)
  }

  return null
}

async function downloadImage(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'image/*',
      'User-Agent': 'OpenTubeX-release-notes',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS),
  })

  if (!response.ok) { throw new Error(`Could not download release note image (${response.status}).`) }

  validateDownloadedImageUrl(response.url)

  return Buffer.from(await response.arrayBuffer())
}

function escapeHtmlAttribute(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export async function normalizeReleaseImage(image, fallbackAlt, loadImage = downloadImage) {
  const variants = [
    { theme: 'dark', url: validateImageUrl(image.url) },
    ...(image.lightUrl ? [{ theme: 'light', url: validateImageUrl(image.lightUrl) }] : []),
  ]
  const normalized = []

  for (const variant of variants) {
    const buffer = await loadImage(variant.url)
    const size = probeImageSize(buffer)

    if (!size) { throw new Error(`Could not determine the dimensions of ${variant.url}.`) }

    normalized.push({ ...variant, size })
  }

  const alt = image.alt || fallbackAlt
  const height = normalized.some(({ size }) => size.height > MAX_IMAGE_HEIGHT)
    ? ` height="${MAX_IMAGE_HEIGHT}"`
    : ''
  const darkUrl = escapeHtmlAttribute(normalized[0].url.href)

  if (normalized.length === 2) {
    const lightUrl = escapeHtmlAttribute(normalized[1].url.href)

    return `<picture>\n  <source media="(prefers-color-scheme: dark)" srcset="${darkUrl}">\n  <source media="(prefers-color-scheme: light)" srcset="${lightUrl}">\n  <img src="${darkUrl}" alt="${escapeHtmlAttribute(alt)}"${height}>\n</picture>`
  }

  return `<img src="${darkUrl}" alt="${escapeHtmlAttribute(alt)}"${height}>`
}

function gitIsAncestor(ancestor, descendant) {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
    stdio: 'ignore',
  })

  if (result.status === 0) { return true }

  if (result.status === 1) { return false }

  throw new Error(`Could not compare Git commits ${ancestor} and ${descendant}.`)
}

export function selectPullRequests(pullRequests, previousTag, target) {
  if (!gitIsAncestor(previousTag, target)) { throw new Error(`${previousTag} is not an ancestor of ${target}.`) }

  // API results can include merges made after checkout. Match against the fixed
  // release range without asking Git to resolve those newer commit objects.
  const commits = new Set(execFileSync('git', ['rev-list', `${previousTag}..${target}`], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  }).split('\n').filter(Boolean))

  return pullRequests
    .filter(({ mergeCommit }) => commits.has(mergeCommit?.oid))
    .sort((left, right) => left.mergedAt.localeCompare(right.mergedAt))
}

export function normalizePullRequestPages(pages) {
  return pages.flatMap((page) => page.data.repository.pullRequests.nodes)
}

export function listMergedPullRequests(repository, target) {
  const [owner, repo] = repository.split('/')

  if (!owner || !repo) { throw new Error(`Invalid GitHub repository: ${repository}.`) }

  const output = execFileSync('gh', [
    'api',
    'graphql',
    '--paginate',
    '--slurp',
    '-f',
    `query=${MERGED_PULL_REQUESTS_QUERY}`,
    '-F',
    `owner=${owner}`,
    '-F',
    `repo=${repo}`,
    '-F',
    `base=${target}`,
  ], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })

  return normalizePullRequestPages(JSON.parse(output))
}

function indentContinuationLines(value) {
  return value.split('\n').map((line, index) => index === 0 ? line : `  ${line}`).join('\n')
}

export async function renderReleaseNotes(pullRequests, {
  emptyMessage = null,
  loadImage = downloadImage,
  onImageError = null,
} = {}) {
  const sections = new Map([...RELEASE_NOTE_CATEGORIES.keys()].map((category) => [category, []]))

  for (const pullRequest of pullRequests) {
    const body = pullRequest.body ?? ''

    // Pull requests merged before categories were introduced have no marker and are not release-note candidates.
    if (extractMarkedSection(body, RELEASE_NOTE_CATEGORY_MARKER) === null) { continue }

    let parsed

    try {
      parsed = parsePullRequestReleaseNote(body)
    } catch (error) {
      throw new Error(`PR #${pullRequest.number}: ${error.message}`, { cause: error })
    }

    if (parsed.category === NOT_NOTEWORTHY_CATEGORY) { continue }

    const references = [
      ...(pullRequest.closingIssuesReferences?.nodes ?? []).map((issue) => issue.number),
      pullRequest.number,
    ].map((number) => `#${number}`).join(', ')
    let releaseNote = `- ${indentContinuationLines(parsed.note)} (${references})`

    for (const image of parsed.images) {
      try {
        releaseNote += `\n  ${indentContinuationLines(await normalizeReleaseImage(image, pullRequest.title, loadImage))}`
      } catch (error) {
        const imageError = new Error(`PR #${pullRequest.number}: ${error.message}`, { cause: error })

        if (onImageError) {
          onImageError(imageError)
          continue
        }

        throw imageError
      }
    }

    sections.get(parsed.category).push(releaseNote)
  }

  const renderedSections = [...RELEASE_NOTE_CATEGORIES]
    .filter(([category]) => sections.get(category).length > 0)
    .map(([category, heading]) => `${heading}\n\n${sections.get(category).join('\n')}`)

  if (renderedSections.length === 0) {
    if (emptyMessage !== null) { return `${emptyMessage}\n` }

    throw new Error('No noteworthy pull requests were found between the selected refs.')
  }

  return `${renderedSections.join('\n\n')}\n`
}

async function validateEvent(eventPath) {
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'))
  const releaseNote = validatePullRequestEvent(event)

  console.log(`Release note category is valid: ${releaseNote.category}.`)
}

async function generate(outputPath, options) {
  const repository = process.env.GITHUB_REPOSITORY
  const previousTag = process.env.PREVIOUS_TAG
  const targetBranch = process.env.TARGET_BRANCH
  const targetSha = process.env.TARGET_SHA

  if (!repository || !previousTag || !targetBranch || !targetSha) {
    throw new Error('GITHUB_REPOSITORY, PREVIOUS_TAG, TARGET_BRANCH, and TARGET_SHA are required.')
  }

  const pullRequests = listMergedPullRequests(repository, targetBranch)
  const selectedPullRequests = selectPullRequests(pullRequests, previousTag, targetSha)
  const releaseNotes = await renderReleaseNotes(selectedPullRequests, options)

  fs.writeFileSync(outputPath, releaseNotes)
  console.log(`Processed ${selectedPullRequests.length} pull requests and wrote ${outputPath}.`)
}

async function main() {
  const [command, argument] = process.argv.slice(2)

  if (command === 'validate-event' && argument) { return validateEvent(argument) }

  if (command === 'generate' && argument) { return generate(argument) }

  if (command === 'generate-nightly' && argument) {
    return generate(argument, {
      emptyMessage: 'No noteworthy changes since the latest stable release.',
      onImageError: (error) => console.warn(`${error.message} The image will be omitted from this nightly.`),
    })
  }

  throw new Error('Usage: releaseNotes.mjs <validate-event EVENT_PATH | generate OUTPUT_PATH | generate-nightly OUTPUT_PATH>')
}

const isMainModule = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMainModule) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
