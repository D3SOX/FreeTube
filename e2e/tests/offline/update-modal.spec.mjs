import { readFileSync } from 'node:fs'

import { test, expect, goTo, waitForAppReady, setWindowSize } from '../../helpers/app.mjs'

const RELEASES_URL = /^https:\/\/api\.github\.com\/repos\/OpenTubeX\/OpenTubeX\/releases/
const COMMIT_HASH = '3904e64f503cde6be8793606a04ad69c5d57cef0'
const installedVersion = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')
).version
const [majorVersion, minorVersion] = installedVersion.split('.').map(Number)
const nextMinorVersion = `${majorVersion}.${minorVersion + 1}`
const newestUpdateVersion = `${nextMinorVersion}.1`
const olderUpdateVersion = `${nextMinorVersion}.0`

function release(name, tagName, body) {
  return { name, tag_name: tagName, body, draft: false, prerelease: false }
}

const NEWEST_NOTES = [
  '> [!WARNING]',
  '> Test alert.',
  '',
  `Automated development build from commit ${COMMIT_HASH}.`,
  '',
  '<details>',
  '<summary>Show changes</summary>',
  '',
  '- Fixed something (#499)',
  '',
  '</details>'
].join('\n')

/**
 * Serves the given releases to the in-app update check and restarts the
 * renderer so that it runs with the stub in place.
 */
async function showUpdateNotification(page, releases) {
  await page.route(RELEASES_URL, (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(releases)
  }))

  // The update check only runs at startup, so enable it and reload. The route
  // above stays installed across the reload, so no request ever leaves.
  await goTo(page, 'settings')
  const updateToggle = page.locator('.switch-ctn', { hasText: 'Check for Updates' })
  await updateToggle.locator('.switch-label').click()
  await expect(updateToggle.locator('input')).toBeChecked()
  await page.reload()
  await waitForAppReady(page)

  const notification = page.locator('.toast', { hasText: 'is now available' })
  await expect(notification).toBeVisible()
  return notification
}

async function showUpdatePrompt(page, releases) {
  const notification = await showUpdateNotification(page, releases)
  await notification.getByRole('button', { name: 'See changes and update' }).click()
  await expect(page.locator('.changeLogTitle')).toBeVisible()
}

for (const uiScale of [100, 95]) {
  test(`release-note scrollbar stays anchored during touch scrolling without scroll callbacks at ${uiScale}%`, async ({ app, page }) => {
    await showUpdatePrompt(page, [
      release(`OpenTubeX ${newestUpdateVersion}`, `v${newestUpdateVersion}-beta`,
        `<details open><summary>Show changes</summary>\n\n${Array.from({ length: 60 }, (_, index) => `- Release note ${index + 1}: scrolling through the latest improvements and fixes on a phone.`).join('\n')}\n\n</details>`)
    ])
    await page.evaluate(scale => window.ftElectron.setZoomFactor(scale / 100), uiScale)
    await setWindowSize(app, page, { width: 480, height: 800 })
    const scroller = page.locator('.changeLogText')
    const scrollbar = scroller.locator(':scope > .os-scrollbar-vertical')
    await expect(scrollbar).toBeAttached()
    // Touch scrolling can advance on the compositor before JS scroll listeners
    // run. Suppress those callbacks to check the scrollbar in that exact state.
    const resumeScrollEvents = await scroller.evaluateHandle(element => {
      const suppressScroll = event => {
        if (event.target === element) event.stopImmediatePropagation()
      }
      document.addEventListener('scroll', suppressScroll, { capture: true })
      return () => document.removeEventListener('scroll', suppressScroll, { capture: true })
    })
    // The dialog itself can still move during its opening animation. Compare
    // the track with its viewport in the same frame, not with the screen.
    const trackOffset = () => scroller.evaluate(element => {
      const track = element.querySelector(':scope > .os-scrollbar-vertical')
      return track.getBoundingClientRect().top - element.getBoundingClientRect().top
    })
    const initialOffset = await trackOffset()
    const box = await scroller.boundingBox()
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    const point = { x: box.x + box.width / 2, y: box.y + box.height - 30 }
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
    for (const distance of [30, 60, 90, 120, 150, 180]) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, y: point.y - distance }] })
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(50)
    await expect.poll(async () => Math.abs(await trackOffset() - initialOffset)).toBeLessThanOrEqual(1)
    await resumeScrollEvents.evaluate(resume => resume())
    await resumeScrollEvents.dispose()
    await session.detach()

    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(50)
    for (const size of [{ width: 481, height: 1000 }, { width: 1000, height: 900 }]) {
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await setWindowSize(app, page, size)
      await expect.poll(() => scroller.evaluate(element => {
        const content = element.firstElementChild
        const end = content.getBoundingClientRect().bottom - element.getBoundingClientRect().top +
          element.scrollTop - element.clientTop - element.clientHeight
        return Math.abs(element.scrollTop - Math.max(0, end))
      })).toBeLessThanOrEqual(1)
      await expect.poll(() => scrollbar.evaluate(element => {
        const track = element.querySelector('.os-scrollbar-track').getBoundingClientRect()
        const handle = element.querySelector('.os-scrollbar-handle').getBoundingClientRect()
        return Math.abs(handle.bottom - track.bottom)
      })).toBeLessThanOrEqual(1)
    }

    await scroller.locator('summary').evaluate(element => element.click())
    await expect.poll(() => scroller.evaluate(element => ({
      scrollTop: element.scrollTop,
      hasScrollbar: !element.querySelector('.os-scrollbar-vertical').classList.contains('os-scrollbar-unusable'),
      overflows: element.scrollHeight > element.clientHeight + 1,
    }))).toEqual({ scrollTop: 0, hasScrollbar: false, overflows: false })
  })
}

test('the update notification stays dismissed for the current app session', async ({ page }) => {
  const notification = await showUpdateNotification(page, [
    release(`OpenTubeX ${newestUpdateVersion}`, `v${newestUpdateVersion}-beta`, NEWEST_NOTES)
  ])

  await expect(notification).toHaveClass(/indefinite/)
  await expect(notification.locator('.timeout-indicator-track')).toHaveCount(0)
  const updateButton = notification.getByRole('button', { name: 'See changes and update' })
  const dismissButton = notification.getByRole('button', { name: 'Dismiss' })
  await expect(updateButton).toBeVisible()
  await expect(updateButton.locator('[data-icon="file-lines"]')).toBeVisible()
  await expect(dismissButton).toBeVisible()
  await expect(dismissButton.locator('[data-icon="xmark"]')).toBeVisible()
  expect(await notification.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)

  // Read both controls in the same frame while the toast animates into place.
  const [dismissBox, updateBox] = await notification.evaluate(element =>
    ['Dismiss', 'See changes and update'].map(label => {
      const button = Array.from(element.querySelectorAll('button')).find(button => button.textContent.trim() === label)
      return button.getBoundingClientRect().toJSON()
    })
  )
  expect(dismissBox).not.toBeNull()
  expect(updateBox).not.toBeNull()
  expect(Math.abs(dismissBox.x - updateBox.x)).toBeLessThanOrEqual(1)
  expect(dismissBox.y + dismissBox.height).toBeLessThanOrEqual(updateBox.y)
  expect(updateBox.y - dismissBox.y - dismissBox.height).toBeLessThanOrEqual(4.5)

  const toastRow = notification.locator('xpath=../..')
  await expect(toastRow).toHaveAttribute('data-dismissible', 'false')
  await toastRow.focus()
  await page.keyboard.press('Escape')
  await expect(toastRow).toHaveAttribute('data-removed', 'false')
  await expect(notification).toBeVisible()

  const notificationBox = await notification.boundingBox()
  expect(notificationBox).not.toBeNull()
  const swipeY = notificationBox.y + notificationBox.height / 2
  await page.mouse.move(notificationBox.x + notificationBox.width / 2, swipeY)
  await page.mouse.down()
  await page.mouse.move(notificationBox.x + notificationBox.width / 2 - 200, swipeY, { steps: 5 })
  await page.mouse.up()
  await expect(toastRow).toHaveAttribute('data-swipe-out', 'false')
  await expect(notification).toBeVisible()

  await page.getByRole('button', { name: 'New Tab' }).click()
  await expect(page.locator('.toast', { hasText: 'is now available' })).toHaveCount(1)

  await notification.getByRole('button', { name: 'Dismiss' }).click()
  await expect(notification).toHaveCount(0)

  await page.getByRole('button', { name: 'New Tab' }).click()
  await expect(page.locator('.toast', { hasText: 'is now available' })).toHaveCount(0)

  await page.reload()
  await waitForAppReady(page)
  await expect(page.locator('.toast', { hasText: 'is now available' })).toHaveCount(0)
})

test('closing the release notes restores the update notification', async ({ page }) => {
  await showUpdatePrompt(page, [
    release(`OpenTubeX ${newestUpdateVersion}`, `v${newestUpdateVersion}-beta`, NEWEST_NOTES)
  ])

  const notification = page.locator('.toast', { hasText: 'is now available' })
  await expect(notification).toHaveCount(0)

  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.locator('.changeLogTitle')).toHaveCount(0)
  await expect(notification).toBeVisible()
})

test('a single update shows its version once and renders the release notes', async ({ page, attachScreenshot }) => {
  await showUpdatePrompt(page, [
    release(`OpenTubeX ${newestUpdateVersion}`, `v${newestUpdateVersion}-beta`, NEWEST_NOTES)
  ])

  await expect(page.locator('.changeLogTitle')).toHaveText(`Update to OpenTubeX ${newestUpdateVersion}`)
  // The title already names the release, so the notes must not repeat it.
  await expect(page.locator('.changeLogText h2')).toHaveCount(0)

  await attachScreenshot('update prompt')

  const summary = page.locator('.changeLogText summary')
  const details = page.locator('.changeLogText details')
  await expect(summary).toBeVisible()
  // Collapsible sections start expanded, but can still be collapsed.
  await expect(details).toHaveAttribute('open', '')
  await expect(page.locator('.changeLogText details li')).toHaveText(/Fixed something/)
  await summary.click()
  await expect(details).not.toHaveAttribute('open', '')

  const commitLink = page.locator(`.changeLogText a[href$="${COMMIT_HASH}"]`)
  await expect(commitLink).toHaveText('3904e64')
  await expect(commitLink).toHaveAttribute(
    'href',
    `https://github.com/OpenTubeX/OpenTubeX/commit/${COMMIT_HASH}`
  )
})

test('skipped updates keep a heading per release', async ({ page, attachScreenshot }) => {
  await showUpdatePrompt(page, [
    release(`OpenTubeX ${newestUpdateVersion}`, `v${newestUpdateVersion}-beta`, 'Newest notes'),
    release(`OpenTubeX ${olderUpdateVersion}`, `v${olderUpdateVersion}-beta`, 'Older notes')
  ])

  await expect(page.locator('.changeLogTitle')).toHaveText(`Update to OpenTubeX ${newestUpdateVersion}`)
  await expect(page.locator('.changeLogText h2')).toHaveText([
    `OpenTubeX ${newestUpdateVersion}`,
    `OpenTubeX ${olderUpdateVersion}`
  ])
  await attachScreenshot('update prompt with skipped releases')
})

test('changelog images preserve their aspect ratio at phone and desktop widths', async ({ page }) => {
  const imageUrl = 'https://example.com/release-screenshot.svg'
  await page.route(imageUrl, route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="teal"/></svg>'
  }))
  const notes = [
    `<img src="${imageUrl}" alt="Height only" height="450">`,
    `<img src="${imageUrl}" alt="Both dimensions" width="800" height="450">`,
    `<img src="${imageUrl}" alt="Width only" width="800">`,
    `![Markdown image](${imageUrl})`
  ].join('\n\n')
  await showUpdatePrompt(page, [
    release(`OpenTubeX ${newestUpdateVersion}`, `v${newestUpdateVersion}-beta`, notes)
  ])

  const images = page.locator('.changeLogText img')
  await expect(images).toHaveCount(4)
  await images.evaluateAll(elements => Promise.all(elements.map(image => image.decode())))

  for (const scale of [1, 1.25]) {
    await page.evaluate(value => window.ftElectron.setZoomFactor(value), scale)
    for (const viewport of [{ width: 375, height: 800 }, { width: 800, height: 375 }, { width: 1280, height: 900 }]) {
      await page.setViewportSize(viewport)
      for (const image of await images.all()) {
        const dimensions = await image.evaluate(element => {
          const { width, height } = element.getBoundingClientRect()
          const container = element.closest('.changeLogText')
          const style = getComputedStyle(container)
          return {
            width,
            height,
            expectedHeight: width * element.naturalHeight / element.naturalWidth,
            availableWidth: container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
          }
        })
        const context = `${await image.getAttribute('alt')}, ${viewport.width}px, ${scale * 100}% scale`
        expect(dimensions.width, context).toBeGreaterThan(0)
        expect(dimensions.width, context).toBeLessThanOrEqual(dimensions.availableWidth + 1)
        expect.soft(Math.abs(dimensions.height - dimensions.expectedHeight), context).toBeLessThanOrEqual(1)
      }
    }
  }
})
