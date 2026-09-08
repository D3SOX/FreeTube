import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test, expect, sel } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchHistoryEntry } from '../../helpers/watch.mjs'

test.use({
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
      defaultVideoFormat: 'legacy',
      rememberHistory: true,
      watchedProgressSavingMode: 'auto',
      useSponsorBlock: false,
    },
    history: [{ ...watchHistoryEntry, watchProgress: 10, lengthSeconds: 19 }],
  },
})

async function savedProgress(app) {
  const contents = await readFile(path.join(app.userDataDir, 'history.db'), 'utf8')
  return contents.trim().split('\n').map(line => JSON.parse(line))
    .filter(record => record.videoId === 'jNQXAC9IVRw').at(-1)?.watchProgress
}

for (const phase of ['metadata pending', 'media pending', 'first loaded data']) {
  test(`preserves the resume position when leaving with ${phase}`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.locator(sel.sideNavLink('history')).first().evaluate(element => element.click())
    await expect(page).toHaveURL(/#\/history/)
    let release
    const pending = new Promise(resolve => { release = resolve })
    let reached
    const requested = new Promise(resolve => { reached = resolve })
    if (phase !== 'first loaded data') {
      await page.route(phase === 'metadata pending' ? '**/youtubei/v1/player**' : /googlevideo\.com\/videoplayback/, async route => {
        reached()
        await pending
        await route.fallback()
      })
    } else {
      await page.evaluate(backSelector => {
        document.addEventListener('loadeddata', () => {
          document.querySelector(backSelector).click()
        }, { capture: true, once: true })
      }, sel.backButton)
    }

    try {
      await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
      await page.locator(sel.searchInput).press('Enter')
      if (phase !== 'first loaded data') {
        await requested
        await page.locator(sel.backButton).click()
        release()
      }
      await expect(page).toHaveURL(/#\/history/)
      release()
      expect(await savedProgress(app)).toBeGreaterThanOrEqual(10)
      await page.reload()
      await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible()
      expect(await savedProgress(app)).toBeGreaterThanOrEqual(10)
    } finally {
      release()
    }
  })
}

for (const position of [0, 12]) {
  test(`saves a deliberate seek to ${position} seconds after resuming`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.locator(sel.sideNavLink('history')).first().evaluate(element => element.click())
    await expect(page).toHaveURL(/#\/history/)
    const video = await openMockedVideo(page)
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThanOrEqual(10)
    await video.evaluate((element, seconds) => {
      element.pause()
      return new Promise(resolve => {
        element.addEventListener('seeked', resolve, { once: true })
        element.currentTime = seconds
      })
    }, position)
    await page.locator(sel.backButton).click()
    await expect(page).toHaveURL(/#\/history/)
    await expect.poll(() => savedProgress(app)).toBe(position)
  })
}
