import { test, expect, goTo, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({
  seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } },
})

test('default-speed button transitions do not query animations in JavaScript', async ({ page }) => {
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateReducedMotion', 'off')
  })
  const button = page.getByRole('button', { name: 'Expand side navigation', exact: true })
  await page.mouse.move(800, 500)
  await button.evaluate(element => {
    window.__buttonAnimationWork = { transitions: 0, queries: 0 }
    element.addEventListener('transitionrun', () => window.__buttonAnimationWork.transitions++)
    const original = element.getAnimations
    element.getAnimations = function (options) {
      window.__buttonAnimationWork.queries++
      return original.call(this, options)
    }
  })
  await button.hover()
  await expect.poll(() => page.evaluate(() => window.__buttonAnimationWork.transitions)).toBeGreaterThan(0)
  const metrics = await page.evaluate(() => window.__buttonAnimationWork)
  console.log('Default-speed button animation work:', metrics)
  expect(metrics.queries).toBe(0)
})

test.describe('history progress direction', () => {
  test.use({
    seed: {
      settings: { uiScale: 95, uiRoundness: 200 },
      history: Array.from({ length: 100 }, (_, index) => ({
        _id: String(index).padStart(11, '0'),
        videoId: String(index).padStart(11, '0'),
        title: `Progress video ${index}`,
        author: 'Performance fixture',
        authorId: 'UC0000000000000000000000',
        timeWatched: Date.now() - index * 1000,
        lengthSeconds: 120,
        watchProgress: 30,
        isWatched: false,
        type: 'video',
      })),
    },
  })

  test('mirrors progress without per-card JavaScript style reads', async ({ app, page }, testInfo) => {
    await page.evaluate(() => {
      const original = window.getComputedStyle
      window.__progressStyleReads = 0
      window.getComputedStyle = function (element, pseudo) {
        if (element.matches?.('svg.embeddedProgress')) window.__progressStyleReads++
        return original.call(this, element, pseudo)
      }
    })
    await goTo(page, 'history')
    const paths = page.locator('.watchedProgressBar .embeddedProgressPath')
    // Cards below the viewport are intentionally rendered lazily.
    await expect.poll(() => paths.count()).toBeGreaterThan(10)
    const path = paths.first()

    const progressStartsOn = async direction => {
      await expect.poll(() => path.evaluate(element => {
        const start = element.getPointAtLength(0).matrixTransform(element.getScreenCTM())
        const end = element.getPointAtLength(element.getTotalLength()).matrixTransform(element.getScreenCTM())
        return start.x < end.x ? 'left' : 'right'
      })).toBe(direction)
    }

    await progressStartsOn('left')
    const mountReads = await page.evaluate(() => window.__progressStyleReads)
    await page.evaluate(() => { document.body.dir = 'rtl' })
    await progressStartsOn('right')
    const directionReads = await page.evaluate(() => window.__progressStyleReads) - mountReads
    await testInfo.attach('progress JavaScript work', {
      body: JSON.stringify({ cards: await paths.count(), mountReads, directionReads }),
      contentType: 'application/json',
    })
    console.log('Progress style reads:', { mountReads, directionReads })
    expect.soft(mountReads).toBe(0)
    expect.soft(directionReads).toBe(0)

    await setWindowSize(app, page, { width: 900, height: 700 })
    await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))
    await progressStartsOn('right')
    await page.evaluate(() => { document.body.dir = 'ltr' })
    await progressStartsOn('left')
    await expect.poll(() => path.evaluate(element => {
      const svg = element.ownerSVGElement
      return Math.abs(svg.viewBox.baseVal.width - Number.parseFloat(getComputedStyle(svg).width))
    })).toBeLessThan(0.1)
  })
})

test('loop controls update on changes without polling an idle player', async ({ app, page }, testInfo) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  const buttons = page.locator('.ftVideoPlayer .loop-button')
  await expect(buttons.first()).toBeAttached()

  for (const enabled of [true, false]) {
    await video.evaluate((element, enabled) => { element.loop = enabled }, enabled)
    await expect.poll(() => buttons.evaluateAll((elements, enabled) => elements.every(element => (
      element.getAttribute('aria-pressed') === String(enabled)
    )), enabled)).toBe(true)
  }

  const metrics = await page.evaluate(async () => {
    const buttons = [...document.querySelectorAll('.ftVideoPlayer .loop-button')]
    const classes = new Set(buttons.map(button => button.classList))
    const original = DOMTokenList.prototype.toggle
    let visibilityChecks = 0
    DOMTokenList.prototype.toggle = function (...args) {
      if (classes.has(this)) visibilityChecks++
      return original.apply(this, args)
    }
    try {
      await new Promise(resolve => setTimeout(resolve, 1100))
      return { buttons: buttons.length, visibilityChecks }
    } finally {
      DOMTokenList.prototype.toggle = original
    }
  })
  await testInfo.attach('idle loop control work', {
    body: JSON.stringify(metrics), contentType: 'application/json',
  })
  console.log('Idle loop control work:', metrics)
  expect(metrics.visibilityChecks).toBe(0)
})
