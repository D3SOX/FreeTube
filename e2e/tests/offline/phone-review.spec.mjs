import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

test.use({ seed: { settings: { animationSpeed: 25, videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

test('Escape closes a foreground prompt above a docked phone panel', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => vm.openPhonePanel('description'))
  await expect(page.locator('.dockedSheet[open]')).toBeVisible()
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('showSearchFilters'))
  const prompt = page.locator('.searchFiltersCard')
  await expect(prompt).toBeVisible()
  await prompt.press('Escape')
  await expect(prompt).toHaveCount(0)
  await expect(page.locator('.dockedSheet[open]')).toBeVisible()
})

test('docked phone panel animations respect the configured animation speed', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  const watch = await watchViewHandle(page)
  await watch.evaluate(async vm => {
    vm.openPhonePanel('description')
    await vm.$nextTick()
    await new Promise(resolve => requestAnimationFrame(resolve))
    const animation = document.querySelector('.dockedSheet[open]').getAnimations()[0]
    await animation.ready
    window.__panelOpeningRate = animation.playbackRate
  })
  expect(await page.evaluate(() => window.__panelOpeningRate)).toBe(0.25)
  const sheet = page.locator('.dockedSheet[open]')
  await sheet.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)))
  const header = await sheet.locator('.mobileSheetHeader').boundingBox()
  await page.mouse.move(20, header.y + 5)
  await page.mouse.down()
  await page.mouse.move(20, 5, { steps: 8 })
  await page.mouse.up()
  expect(await sheet.evaluate(async el => {
    const animation = el.getAnimations()[0]
    await animation.ready
    return animation.playbackRate
  })).toBe(0.25)
})
