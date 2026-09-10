import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { cloneDefaultCustomTheme } from '../../../src/customTheme.js'
import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'

test.use({ seed: { settings: { generalAutoLoadMorePaginatedItemsEnabled: false } } })

const feedUrl = 'https://github.com/OpenTubeX/OpenTubeX/discussions/categories/themes.atom*'
const screenshot = 'https://github.com/user-attachments/assets/5724b7e8-f82e-4107-835b-a16d12afd0b5'
const secondScreenshot = 'https://github.com/user-attachments/assets/214fe15d-e6c8-40c0-8e83-c45223bede64'
const oldRevision = '2026-09-08T07:00:00.000Z'
const newRevision = '2026-09-08T08:00:00.000Z'

function escape(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function entry(number, { updated = oldRevision, color = '#121212', invalid = false, extra = '', images = [screenshot, secondScreenshot], description = number % 2 === 0 ? 'A longer description with additional details about the colors and the appearance of this community theme, taking several lines in a narrow card.' : 'A community theme.' } = {}) {
  const theme = cloneDefaultCustomTheme()
  theme.id = 'shared-export-id'
  theme.name = `Community theme ${number}`
  theme.colors.background = color
  const body = `<h2>Description</h2><p>${escape(description)}</p><h2>Screenshots</h2>
    ${images.map(src => `<img src="${src}">`).join('')}${extra}
    <details><summary>Theme JSON</summary><div class="highlight highlight-source-json"
      data-snippet-clipboard-copy-content="${escape(invalid ? '{}' : JSON.stringify(theme))}"><pre>highlighted code</pre></div></details>`
  return `<entry><link rel="alternate" href="https://github.com/OpenTubeX/OpenTubeX/discussions/${number}"/>
    <title>${escape(theme.name)}</title><author><name>ThemeAuthor</name></author>
    <updated>${updated}</updated><content type="html">${escape(body)}</content></entry>`
}

function feed(entries) {
  return `<feed xmlns="http://www.w3.org/2005/Atom">${entries.join('')}</feed>`
}

async function mockScreenshots(page) {
  await page.route('https://github.com/user-attachments/assets/*', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#202830"/></svg>'
  }))
}

async function openDiscovery(page) {
  const appearance = await goToSettingsSection(page, 'appearance')
  await appearance.getByRole('button', { name: 'Discover themes', exact: true }).click()
  await expect(page.locator('.themeDiscovery')).toBeVisible()
  return page.locator('.themeDiscovery')
}

async function expectActionsSideBySide(gallery) {
  await expect.poll(() => gallery.locator('.themeActions').evaluateAll(rows => rows.every(row => {
    const [install, github] = [...row.children].map(button => button.getBoundingClientRect())
    const bounds = row.getBoundingClientRect()
    const card = row.closest('article')
    const details = row.parentElement
    const bottom = card.getBoundingClientRect().bottom -
      Number.parseFloat(getComputedStyle(card).borderBottomWidth) -
      Number.parseFloat(getComputedStyle(details).paddingBottom)
    return Math.abs(install.top - github.top) <= 1 &&
      install.right <= github.left && github.right <= bounds.right + 1 &&
      Math.abs(bounds.bottom - bottom) <= 1
  }))).toBe(true)
}

async function savedThemes(app) {
  const directory = path.join(app.userDataDir, 'themes')
  const files = (await readdir(directory)).filter(file => file.endsWith('.json'))
  return Promise.all(files.map(async file => JSON.parse(await readFile(path.join(directory, file), 'utf8'))))
}

test('discovers, installs, persists and updates themes without overwriting local edits on refresh', async ({ page, app }) => {
  let revision = oldRevision
  let requests = 0
  const unsafeRequests = []
  page.on('request', request => {
    if (request.url().includes('tracker.invalid')) unsafeRequests.push(request.url())
  })
  await mockScreenshots(page)
  const routeFeed = async target => target.route(feedUrl, route => {
    requests++
    const secondPage = new URL(route.request().url()).searchParams.get('page') === '2'
    return route.fulfill({
      contentType: 'application/atom+xml',
      body: feed(secondPage
        ? []
        : [
            entry(1197, { updated: revision, color: revision === oldRevision ? '#121212' : '#112233', extra: '<img src="https://tracker.invalid/pixel"><script>window.themeScriptExecuted = true</script><iframe src="https://tracker.invalid/frame"></iframe>' }),
            entry(1196), entry(1000, { invalid: true })
          ])
    })
  })
  await routeFeed(page)
  const appearance = await goToSettingsSection(page, 'appearance')
  expect(requests).toBe(0)
  await appearance.getByRole('button', { name: 'Discover themes', exact: true }).click()
  const gallery = page.locator('.themeDiscovery')
  await expect(gallery.locator('article')).toHaveCount(2)
  await expect(gallery.locator('.discoveryToolbar').getByRole('button', { name: 'View on GitHub' })).toHaveCount(0)
  const refresh = gallery.getByRole('button', { name: 'Refresh', exact: true })
  await expect(refresh).toHaveText('')
  const [toolbarBounds, refreshBounds] = await Promise.all([
    gallery.locator('.discoveryToolbar').boundingBox(), refresh.boundingBox()
  ])
  expect(refreshBounds.x).toBeGreaterThan(toolbarBounds.x + toolbarBounds.width / 2)
  await expect(gallery.locator('article').first().locator('[data-prefix="fab"][data-icon="github"]')).toHaveCount(1)
  await expectActionsSideBySide(gallery)
  const first = gallery.locator('article').first()
  await expect(first.locator('.themePreview img')).toHaveAttribute('src', screenshot)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await first.locator('.themePreview img').evaluate(image => {
    window.themeFadeObserved = false
    image.addEventListener('transitionrun', event => {
      if (event.propertyName === 'opacity') window.themeFadeObserved = true
    })
  })
  await first.getByRole('button', { name: 'Community theme 1197 (2)', exact: true }).click()
  await expect(first.locator('.themePreview img')).toHaveAttribute('src', secondScreenshot)
  expect(await page.evaluate(() => window.themeFadeObserved)).toBe(true)
  const selectedNumber = first.getByRole('button', { name: 'Community theme 1197 (2)', exact: true })
  await selectedNumber.hover()
  await expect.poll(() => selectedNumber.evaluate(button => getComputedStyle(button).backgroundColor)).toMatch(/^oklab/)
  await expect(selectedNumber).toHaveAttribute('aria-pressed', 'true')
  const profile = first.getByRole('link', { name: '@ThemeAuthor', exact: true })
  await expect(profile).toHaveAttribute('href', 'https://github.com/ThemeAuthor')
  await page.evaluate(() => {
    window.open = url => { window.openedThemeLink = url; return null }
  })
  await profile.click()
  expect(await page.evaluate(() => window.openedThemeLink)).toBe('https://github.com/ThemeAuthor')
  const screenshotButton = first.locator('.themePreview button')
  await screenshotButton.click()
  const viewer = page.getByRole('dialog', { name: 'Community theme 1197', exact: true })
  await expect(viewer).toBeVisible()
  await expect(viewer.locator('img')).toHaveAttribute('src', secondScreenshot)
  const close = viewer.getByRole('button', { name: 'Close', exact: true })
  await expect(close).toHaveText('')
  // Read both edges in the same frame while the prompt's entry animation scales it.
  expect(await close.evaluate(button => {
    const headerBounds = button.closest('.screenshotHeader').getBoundingClientRect()
    const closeBounds = button.getBoundingClientRect()
    return Math.abs(closeBounds.right - headerBounds.right)
  })).toBeLessThanOrEqual(1)
  await viewer.getByRole('button', { name: 'Previous', exact: true }).click()
  await expect(viewer.locator('img')).toHaveAttribute('src', screenshot)
  await expect(viewer.locator('.screenshotNavigation')).toContainText('1 / 2')
  await viewer.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(viewer.locator('img')).toHaveAttribute('src', secondScreenshot)
  await viewer.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(viewer.locator('img')).toHaveAttribute('src', screenshot)
  await expect(viewer.locator('.screenshotNavigation')).toContainText('1 / 2')
  const [thumbnailBounds, fullBounds] = await Promise.all([
    first.locator('.themePreview img').boundingBox(), viewer.locator('img').boundingBox()
  ])
  expect(fullBounds.width).toBeGreaterThan(thumbnailBounds.width)
  await page.keyboard.press('Escape')
  await expect(viewer).toHaveCount(0)
  await expect(gallery).toBeVisible()
  await expect(screenshotButton).toBeFocused()
  await screenshotButton.click()
  await viewer.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(viewer).toHaveCount(0)
  await expect(first.getByText('A community theme.', { exact: true })).toBeVisible()
  expect(unsafeRequests).toEqual([])
  expect(await page.evaluate(() => window.themeScriptExecuted)).toBeUndefined()

  await first.getByRole('button', { name: 'Install and apply', exact: true }).click()
  await expect(first.getByRole('button', { name: 'Applied', exact: true })).toBeDisabled()
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(18, 18, 18)')
  await gallery.locator('article').nth(1).getByRole('button', { name: 'Install and apply', exact: true }).click()
  await expect.poll(async () => (await savedThemes(app)).length).toBe(2)
  expect((await savedThemes(app)).map(theme => theme.id).sort()).toEqual(['discussion-1196', 'discussion-1197'])
  const initialHash = (await savedThemes(app)).find(theme => theme.id === 'discussion-1197').discussionThemeHash

  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const theme = (await window.ftElectron.loadCustomTheme()).find(theme => theme.id === 'discussion-1197')
    theme.colors.background = '#abcdef'
    const themes = await window.ftElectron.saveCustomTheme(theme)
    await store.dispatch('updateCustomThemes', themes)
  })
  await gallery.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(first.getByRole('button', { name: 'Apply theme', exact: true })).toBeVisible()
  await first.getByRole('button', { name: 'Apply theme', exact: true }).click()
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(171, 205, 239)')

  revision = newRevision
  const relaunched = await app.relaunch()
  page = relaunched.page
  await mockScreenshots(page)
  await routeFeed(page)
  const reopened = await openDiscovery(page)
  const updatedCard = reopened.locator('article').first()
  await expect(updatedCard.getByRole('button', { name: 'Update and apply', exact: true })).toBeVisible()
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(171, 205, 239)')
  await updatedCard.getByRole('button', { name: 'Update and apply', exact: true }).click()
  await expect(updatedCard.getByRole('button', { name: 'Applied', exact: true })).toBeDisabled()
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(17, 34, 51)')
  const saved = await savedThemes(app)
  expect(saved).toHaveLength(2)
  expect(saved.find(theme => theme.id === 'discussion-1197').discussionThemeHash).toMatch(/^[\da-f]{64}$/)
  expect(saved.find(theme => theme.id === 'discussion-1197').discussionThemeHash).not.toBe(initialHash)
})

test('retries failures, paginates, skips invalid posts and handles empty feeds', async ({ page }) => {
  let fail = true
  let empty = false
  const pages = []
  await mockScreenshots(page)
  await page.route(feedUrl, route => {
    const number = Number(new URL(route.request().url()).searchParams.get('page'))
    pages.push(number)
    return route.fulfill({ status: fail ? 503 : 200, contentType: 'application/atom+xml', body: feed(empty || number > 2 ? [] : [entry(number, { invalid: number === 1 })]) })
  })
  const gallery = await openDiscovery(page)
  await expect(gallery.getByRole('alert')).toHaveText('Could not load themes. Try refreshing.')
  await expect(gallery.getByRole('alert')).toHaveCSS('text-align', 'center')
  fail = false
  await gallery.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(gallery.getByText('No installable themes found.')).toBeVisible()
  await expect(gallery.getByText('No installable themes found.')).toHaveCSS('text-align', 'center')
  const [loadMoreBounds, scrollerBounds] = await Promise.all([
    gallery.getByRole('button', { name: 'Load more', exact: true }).boundingBox(),
    gallery.locator('.discoveryScroller').boundingBox()
  ])
  expect(Math.abs(loadMoreBounds.x + loadMoreBounds.width / 2 - scrollerBounds.x - scrollerBounds.width / 2)).toBeLessThanOrEqual(1)
  await gallery.getByRole('button', { name: 'Load more', exact: true }).click()
  await expect(gallery.locator('article')).toHaveCount(1)
  await gallery.getByRole('button', { name: 'Load more', exact: true }).click()
  await expect(gallery.getByRole('button', { name: 'Load more', exact: true })).toHaveCount(0)
  expect(pages).toEqual([1, 1, 2, 3])
  fail = true
  await gallery.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(gallery.getByRole('alert')).toBeVisible()
  await expect(gallery.locator('article')).toHaveCount(1)
  fail = false
  empty = true
  await gallery.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(gallery.getByText('No installable themes found.')).toBeVisible()
  await expect(gallery.locator('article')).toHaveCount(0)
})

for (const scale of [85, 110]) {
  test(`clamps the gallery after refresh and resize at ${scale}% scale`, async ({ page, app }) => {
    let count = 10
    await mockScreenshots(page)
    await page.route(feedUrl, route => route.fulfill({ contentType: 'application/atom+xml', body: feed(new URL(route.request().url()).searchParams.get('page') === '1' ? Array.from({ length: count }, (_, i) => entry(i + 1)) : []) }))
    await page.evaluate(async value => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateUiScale', value)
    }, scale)
    const gallery = await openDiscovery(page)
    await expect(gallery.locator('article')).toHaveCount(10)
    await expectActionsSideBySide(gallery)
    await gallery.locator('.themePreview button').first().click()
    const viewer = page.getByRole('dialog', { name: 'Community theme 1', exact: true })
    await expect(viewer).toBeVisible()
    expect(await viewer.locator('img').evaluate(image => {
      const bounds = image.getBoundingClientRect()
      return bounds.top >= 0 && bounds.left >= 0 &&
        bounds.bottom <= window.innerHeight + 1 && bounds.right <= window.innerWidth + 1
    })).toBe(true)
    await viewer.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(viewer).toHaveCount(0)
    const scroller = gallery.locator('.discoveryScroller')
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await gallery.getByRole('button', { name: 'Load more', exact: true }).evaluate(element => element.click())
    await expect(gallery.getByRole('button', { name: 'Load more', exact: true })).toHaveCount(0)
    await expect.poll(() => scroller.evaluate(element => Math.abs(element.scrollTop - Math.max(0, element.scrollHeight - element.clientHeight)))).toBeLessThanOrEqual(1)
    await expect(scroller.locator('.os-scrollbar-vertical')).not.toHaveClass(/os-scrollbar-unusable/)
    await app.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setBounds({ width: 1900, height: 1200 })
    })
    await expect.poll(() => scroller.evaluate(element => Math.abs(element.scrollTop - Math.max(0, element.scrollHeight - element.clientHeight)))).toBeLessThanOrEqual(1)
    count = 0
    // DOM activation preserves the obsolete bottom offset until the response.
    await gallery.getByRole('button', { name: 'Refresh', exact: true }).evaluate(element => element.click())
    await expect(gallery.locator('article')).toHaveCount(0)
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
    await expect(scroller.locator('.os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
    const toolbar = await gallery.locator('.discoveryToolbar').boundingBox()
    const viewport = await scroller.boundingBox()
    expect(viewport.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height - 1)
  })
}

test('automatically loads more at the bottom with a spinner and stops retrying on errors', async ({ page }) => {
  await mockScreenshots(page)
  const requests = []
  let finishSecondPage
  const secondPage = new Promise(resolve => { finishSecondPage = resolve })
  await page.route(feedUrl, async route => {
    const number = Number(new URL(route.request().url()).searchParams.get('page'))
    requests.push(number)
    if (number === 2) await secondPage
    await route.fulfill({
      status: number > 2 ? 503 : 200,
      contentType: 'application/atom+xml',
      body: feed(number === 1 ? Array.from({ length: 9 }, (_, i) => entry(i + 1)) : [entry(10)])
    })
  })
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateGeneralAutoLoadMorePaginatedItemsEnabled', true)
  })
  const gallery = await openDiscovery(page)
  await expect(gallery.locator('article')).toHaveCount(9)
  expect(requests).toEqual([1])
  await expect(gallery.getByRole('button', { name: 'Load more', exact: true })).toHaveCount(0)
  const scroller = gallery.locator('.discoveryScroller')
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect(gallery.locator('.spinnerContainer')).toBeVisible()
  expect(requests).toEqual([1, 2])
  finishSecondPage()
  await expect(gallery.locator('article')).toHaveCount(10)
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect(gallery.getByRole('alert')).toBeVisible()
  await expect(gallery.getByRole('button', { name: 'Load more', exact: true })).toBeVisible()
  expect(requests).toEqual([1, 2, 3])
  await expect(gallery.locator('.themeAutoLoadSentinel')).toHaveCount(0)
  await expect(gallery.locator('.spinnerContainer')).toHaveCount(0)
})

test('reloads the feed when an already-open gallery is remounted', async ({ page }) => {
  await mockScreenshots(page)
  let requests = 0
  await page.route(feedUrl, route => {
    requests++
    return route.fulfill({ contentType: 'application/atom+xml', body: feed([entry(1)]) })
  })
  const gallery = await openDiscovery(page)
  await expect(gallery.locator('article')).toHaveCount(1)
  expect(requests).toBe(1)
  await page.evaluate(() => {
    // A hot reload replaces the child while its parent's open state survives.
    function find(vnode) {
      if (vnode?.component?.type?.__name === 'ThemeDiscovery') return vnode.component
      const nested = vnode?.component?.subTree && find(vnode.component.subTree)
      if (nested) return nested
      for (const child of Array.isArray(vnode?.children) ? vnode.children : []) {
        const match = find(child)
        if (match) return match
      }
      return null
    }
    const component = find(document.querySelector('#app').__vue_app__._container._vnode)
    if (!component) throw new Error('Theme discovery component not found')
    component.vnode.key = 'before-remount'
    component.parent.proxy.$forceUpdate()
  })
  await expect(gallery).toBeVisible()
  await expect.poll(() => requests, { timeout: 2000 }).toBe(2)
  await expect(gallery.locator('article')).toHaveCount(1)
  await expect(gallery.getByText('No installable themes found.')).toHaveCount(0)
})

test('only offers updates for changes to the theme JSON', async ({ page, app }) => {
  await mockScreenshots(page)
  const options = { updated: oldRevision, description: 'Original description' }
  await page.route(feedUrl, route => route.fulfill({
    contentType: 'application/atom+xml', body: feed([entry(1197, options)])
  }))
  const gallery = await openDiscovery(page)
  const card = gallery.locator('article')
  await card.getByRole('button', { name: 'Install and apply', exact: true }).click()
  await expect(card.getByRole('button', { name: 'Applied', exact: true })).toBeDisabled()

  options.updated = newRevision
  options.description = 'Revised description'
  options.images = [secondScreenshot]
  await gallery.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(card.getByText('Revised description', { exact: true })).toBeVisible()
  await expect(card.locator('.themePreview img')).toHaveAttribute('src', secondScreenshot)
  await expect(card.getByRole('button', { name: 'Applied', exact: true })).toBeDisabled()
  await expect(card.getByRole('button', { name: 'Update and apply', exact: true })).toHaveCount(0)

  // Actual theme edits must be detected even if the discussion timestamp stays the same.
  options.color = '#112233'
  await gallery.getByRole('button', { name: 'Refresh', exact: true }).click()
  await card.getByRole('button', { name: 'Update and apply', exact: true }).click()
  await expect(card.getByRole('button', { name: 'Applied', exact: true })).toBeDisabled()
  expect((await savedThemes(app))[0].colors.background).toBe('#112233')
  await gallery.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(gallery.getByRole('button', { name: 'Refresh', exact: true })).toHaveAttribute('aria-disabled', 'false')
  await expect(card.getByRole('button', { name: 'Update and apply', exact: true })).toHaveCount(0)
})

for (const fullPreview of [false, true]) {
  test(`keeps the selected screenshot after an outgoing image fails (${fullPreview ? 'full preview' : 'gallery'})`, async ({ page }) => {
    await mockScreenshots(page)
    await page.route(feedUrl, route => route.fulfill({ contentType: 'application/atom+xml', body: feed([entry(1)]) }))
    const gallery = await openDiscovery(page)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    if (fullPreview) await gallery.locator('.themePreview button').click()
    const container = fullPreview ? page.getByRole('dialog', { name: 'Community theme 1', exact: true }) : gallery
    await expect(container.locator('img')).toHaveAttribute('src', screenshot)
    await container.evaluate((element, full) => {
      const outgoing = element.querySelector('img')
      outgoing.addEventListener('transitionrun', () => outgoing.dispatchEvent(new Event('error')), { once: true })
      const next = full
        ? element.querySelector('.screenshotNavigation button:last-child')
        : element.querySelector('.screenshotChoices button:last-child')
      next.click()
    }, fullPreview)
    await expect(container.locator('img')).toHaveAttribute('src', secondScreenshot)
    await expect(container.locator('img')).toBeVisible()
    await expect.poll(() => container.locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
  })
}
