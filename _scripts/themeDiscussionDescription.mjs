import { parser as htmlParser } from '@lezer/html'
import { GFM, parser as markdownParser } from '@lezer/markdown'

export const THEME_DESCRIPTION_LIMIT = 500
const parser = markdownParser.configure(GFM)
const ATOMIC_MARKDOWN = new Set([
  'Emphasis', 'StrongEmphasis', 'Strikethrough', 'Link', 'Image', 'Autolink',
  'URL', 'InlineCode', 'FencedCode', 'CodeBlock', 'HTMLBlock', 'HTMLTag',
  'CommentBlock', 'Comment', 'LinkReference',
])

/** Limit the app's localized description section without touching screenshots or JSON. */
export function limitThemeDescription(body) {
  const blocks = []
  for (let node = parser.parse(body).topNode.firstChild; node; node = node.nextSibling) blocks.push(node)
  const screenshots = blocks.find(node => node.name === 'CommentBlock' &&
    body.slice(node.from, node.to).startsWith('<!-- theme-screenshots:start -->'))
  const details = blocks.filter(node => node.name === 'HTMLBlock' &&
    /^<details\b/i.test(body.slice(node.from, node.to))).at(-1)
  const boundary = screenshots?.from ?? details?.from
  if (boundary === undefined) return body
  const headings = blocks.filter(node => node.name === 'ATXHeading2' && node.from < boundary)
  if (headings.length < 2) return body
  const start = headings[0].to
  const end = headings.at(-1).from
  const section = body.slice(start, end)
  // The app supplies an invisible instruction comment before the author's text.
  const prefix = section.match(/^(?:\s|<!--[\s\S]*?-->)+/)?.[0] ?? ''
  const description = section.slice(prefix.length).trimEnd()
  const characters = Array.from(description)
  if (characters.length <= THEME_DESCRIPTION_LIMIT) return body
  let cutoff = characters.slice(0, THEME_DESCRIPTION_LIMIT).join('').length

  // A partial link, fence, or HTML container could consume the sections below.
  // Keep complete constructs, shortening further when one crosses the limit.
  const html = Array(description.length).fill(' ')
  parser.parse(description).iterate({
    enter(node) {
      if (node.name === 'HTMLTag' || node.name === 'HTMLBlock') {
        for (let index = node.from; index < node.to; index++) html[index] = description[index]
      }
      if (ATOMIC_MARKDOWN.has(node.name) && node.from < cutoff && node.to > cutoff) {
        cutoff = node.from
        return false
      }
    },
  })
  htmlParser.parse(html.join('')).iterate({
    enter(node) {
      if (node.name === 'Element' && node.from < cutoff && node.to > cutoff) {
        cutoff = node.from
        return false
      }
    },
  })
  return body.slice(0, start) + prefix + description.slice(0, cutoff).trimEnd() +
    section.slice(prefix.length + description.length) + body.slice(end)
}
