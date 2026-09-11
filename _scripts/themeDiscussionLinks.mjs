import { parser as htmlParser } from '@lezer/html'
import { GFM, parser as markdownParser } from '@lezer/markdown'
import { decodeHTML } from 'entities'
import { marked } from 'marked'

const parser = markdownParser.configure(GFM)

function isGitHubUrl(value, relative = true) {
  const unescaped = decodeHTML(value.replace(/^<|>$/g, '')
    .replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1'))
  try {
    const url = new URL(!relative && unescaped.startsWith('www.') ? `https://${unescaped}` : unescaped,
      relative ? 'https://github.com/' : undefined)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (url.hostname === 'github.com' || url.hostname.endsWith('.github.com') ||
        url.hostname.endsWith('.githubusercontent.com'))
  } catch {
    return false
  }
}

function removeLinksOnce(body) {
  const tree = parser.parse(body)
  // Container prefixes are absent from rendered HTML. Mask them without moving
  // offsets, so multiline tags inside quotes and lists can be parsed as HTML.
  const logical = body.split('')
  tree.iterate({
    enter(node) {
      if (node.name === 'QuoteMark' || node.name === 'ListMark') {
        logical.fill(' ', node.from, node.to)
      }
    },
  })
  const source = logical.join('')
  const references = marked.lexer(body).links
  const edits = []
  const remove = node => edits.push({ from: node.from, to: node.to })
  const text = node => source.slice(node.from, node.to)

  function htmlEdits(node) {
    const html = text(node).replaceAll('\f', ' ')
    htmlParser.parse(html).iterate({
      enter(tag) {
        if (!['OpenTag', 'SelfClosingTag'].includes(tag.name)) return
        const tagName = tag.node.getChild('TagName')
        if (!tagName) return
        const name = html.slice(tagName.from, tagName.to).toLowerCase()
        for (const attr of tag.node.getChildren('Attribute')) {
          const key = attr.getChild('AttributeName')
          const value = attr.getChild('AttributeValue') ?? attr.getChild('UnquotedAttributeValue')
          if (!key || !value) continue
          const attribute = html.slice(key.from, key.to).toLowerCase()
          if (!['href', 'src', 'srcset', 'poster'].includes(attribute)) continue
          const raw = html.slice(value.from, value.to).replace(/^["']|["']$/g, '')
          const urls = attribute === 'srcset' ? raw.split(',').map(part => part.trim().split(/\s+/)[0]) : [raw]
          if (urls.every(url => isGitHubUrl(url))) continue
          // Keep link labels and surrounding HTML, but remove images entirely.
          const target = ['img', 'source'].includes(name) ? tag : attr
          edits.push({ from: node.from + target.from, to: node.from + target.to })
        }
        return false
      },
    })
  }

  tree.iterate({
    enter(cursor) {
      const node = cursor.node
      if (['FencedCode', 'CodeBlock', 'InlineCode', 'CommentBlock'].includes(node.name)) return false
      if (['HTMLTag', 'HTMLBlock'].includes(node.name)) {
        htmlEdits(node)
        return false
      }
      if (node.name === 'LinkReference') {
        const url = node.getChild('URL')
        if (url && !isGitHubUrl(text(url))) remove(node)
        return false
      }
      if (['Link', 'Image'].includes(node.name)) {
        const marks = node.getChildren('LinkMark')
        const url = node.getChild('URL')
        const label = node.getChild('LinkLabel')
        const reference = label && text(label) !== '[]' ? text(label).slice(1, -1) : source.slice(marks[0].to, marks[1].from)
        const destination = url ? text(url) : references[reference.trim().replace(/\s+/g, ' ').toLowerCase()]?.href
        if (destination !== undefined && !isGitHubUrl(destination)) {
          if (node.name === 'Image') {
            remove(node)
            return false
          }
          remove(marks[0])
          edits.push({ from: marks[1].from, to: node.to })
        }
        // Still visit images nested in link labels, but not their URL/title.
        return
      }
      if (node.name === 'Autolink') {
        if (!isGitHubUrl(text(node.getChild('URL')), false)) remove(node)
        return false
      }
      if (node.name === 'URL' && !['Link', 'Image', 'LinkReference'].includes(node.parent?.name)) {
        if (!isGitHubUrl(text(node), false)) remove(node)
      }
    },
  })

  // Merge overlapping removals, such as an image with both src and srcset.
  let result = ''
  let position = 0
  for (const edit of edits.sort((a, b) => a.from - b.from || b.to - a.to)) {
    if (edit.from > position) result += body.slice(position, edit.from)
    position = Math.max(position, edit.to)
  }
  return result + body.slice(position)
}

/** Remove active external links without reserializing Markdown or theme JSON. */
export function removeExternalDiscussionLinks(body) {
  // Unwrapping a link can expose a URL-shaped label as a new GFM autolink.
  // Every changed pass only deletes characters, so this always terminates.
  for (;;) {
    const cleaned = removeLinksOnce(body)
    if (cleaned === body) return body
    body = cleaned
  }
}
