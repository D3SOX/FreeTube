import { customThemeContentHash, normalizeCustomTheme } from '../../customTheme.js'

export const THEME_DISCUSSIONS_URL = 'https://github.com/OpenTubeX/OpenTubeX/discussions/categories/themes'
const DISCUSSION_URL = /^https:\/\/github\.com\/OpenTubeX\/OpenTubeX\/discussions\/([1-9]\d*)$/

export function themeScreenshotUrl(source) {
  try {
    const url = new URL(source)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
    // Atom replaces attachments with expiring signed URLs. Use the original
    // public attachment so screenshots still load after browsing for a while.
    if (url.hostname === 'private-user-images.githubusercontent.com') {
      const id = url.pathname.match(/\/\d+-([\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})\.[a-z]+$/i)?.[1]
      return id ? `https://github.com/user-attachments/assets/${id}` : null
    }
    if ((url.hostname === 'github.com' && url.pathname.startsWith('/user-attachments/assets/')) ||
      ['user-images.githubusercontent.com', 'camo.githubusercontent.com'].includes(url.hostname)) {
      return url.href
    }
  } catch { }
  return null
}

export async function parseThemeFeed(source) {
  const feed = new DOMParser().parseFromString(source, 'application/xml')
  if (feed.querySelector('parsererror') || feed.documentElement.localName !== 'feed' ||
    feed.documentElement.namespaceURI !== 'http://www.w3.org/2005/Atom') {
    throw new Error('Invalid theme feed')
  }
  const entries = [...feed.querySelectorAll('entry')]
  const themes = []
  for (const entry of entries) {
    const url = entry.querySelector('link[rel="alternate"]')?.getAttribute('href')
    const number = url?.match(DISCUSSION_URL)?.[1]
    if (!number) continue
    // Template contents remain inert, including images, scripts and iframes.
    // Never attach the supplied HTML to the document.
    const template = document.createElement('template')
    template.innerHTML = entry.querySelector('content')?.textContent ?? ''
    const content = template.content
    const blocks = content.querySelectorAll('.highlight-source-json, pre > code.language-json')
    if (blocks.length !== 1) continue
    try {
      const block = blocks[0]
      const json = block.getAttribute('data-snippet-clipboard-copy-content') ?? block.textContent
      const submittedTheme = normalizeCustomTheme(JSON.parse(json))
      // Authors often export the same ID for different themes. Scope installs
      // to the discussion to preserve both posts and existing imported themes.
      const theme = normalizeCustomTheme({
        ...submittedTheme,
        id: `discussion-${number}`,
        discussionThemeHash: await customThemeContentHash(submittedTheme),
      })
      const screenshots = [...new Set([...content.querySelectorAll('img')]
        .map(img => themeScreenshotUrl(img.getAttribute('src'))).filter(Boolean))]
      const description = []
      let sibling = content.querySelector('h2')?.nextElementSibling
      while (sibling && !['H2', 'DETAILS'].includes(sibling.tagName)) {
        if (!sibling.querySelector('img, pre, script, style, iframe')) description.push(sibling.textContent.trim())
        sibling = sibling.nextElementSibling
      }
      themes.push({
        theme,
        url,
        title: entry.querySelector('title')?.textContent.trim() || theme.name,
        author: entry.querySelector('author > name')?.textContent.trim() || '',
        description: description.filter(Boolean).join('\n').slice(0, 1000),
        screenshots,
      })
    } catch {
      // One invalid or incompatible post must not hide the remaining themes.
    }
  }
  return { themes, hasMore: entries.length > 0 }
}

export async function loadThemeFeed(page, signal) {
  const url = `${THEME_DISCUSSIONS_URL}.atom?page=${page}`
  const options = { credentials: 'omit', referrerPolicy: 'no-referrer', signal }
  let response
  if (process.env.IS_CAPACITOR) {
    const { capacitorHttpFetch } = await import('./api/capacitor-http')
    response = await capacitorHttpFetch(url, options)
  } else {
    response = await fetch(url, options)
  }
  if (!response.ok) throw new Error(`Theme feed returned HTTP ${response.status}`)
  return parseThemeFeed(await response.text())
}
