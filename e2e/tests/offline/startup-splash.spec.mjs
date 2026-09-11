import { readFile, readdir } from 'node:fs/promises'
import { test, expect, goToSettingsSection, latestSettings } from '../../helpers/app.mjs'
import path from 'node:path'

for (const [theme, background, zoom] of [
  ['dark', 'rgb(15, 15, 15)', 1.25],
  ['light', 'rgb(241, 241, 241)', 0.8],
  ['openTubeXDark', 'rgb(11, 20, 22)', 1.25],
  ['openTubeXLight', 'rgb(232, 242, 240)', 0.8],
  ['hotPink', 'rgb(255, 0, 138)', 1],
  ['pastelPink', 'rgb(255, 234, 221)', 1],
]) {
  test.describe(`startup splash in ${theme} mode`, () => {
    test.use({ seed: { settings: { baseTheme: theme, currentLocale: 'de-DE', landingPage: 'history', uiScale: zoom * 100 } } })

    test('paints before the renderer and reveals the first presented tab', async ({ page, app }, testInfo) => {
      await expect(page.locator('#startup-splash')).toHaveCount(0)
      await page.evaluate(factor => window.ftElectron.setZoomFactor(factor), zoom)
      let releaseRenderer
      const rendererGate = new Promise(resolve => { releaseRenderer = resolve })
      await page.route('**/renderer.js', async route => {
        await rendererGate
        await route.continue()
      })
      try {
        await page.reload({ waitUntil: 'commit' })
        await expect(page.locator('#startup-splash')).toBeVisible()
        await expect(page.locator('.topNav')).toHaveCount(0)
        await expect(page.locator('#app')).toHaveAttribute('inert', '')
        expect(await page.locator('.startupCurtain').first().evaluate(element => getComputedStyle(element).backgroundColor)).toBe(background)
        await expect(page.locator('.startupLabel')).toHaveText('Wird geladen…')
        const geometry = await page.locator('#startup-splash').evaluate(element => {
          const bounds = element.getBoundingClientRect()
          const logo = element.querySelector('.startupLogo').getBoundingClientRect()
          const animation = element.querySelector('.startupProgress').getAnimations()[0]
          return {
            width: bounds.width,
            height: bounds.height,
            viewportWidth: innerWidth,
            viewportHeight: innerHeight,
            logoX: logo.x + logo.width / 2,
            logoY: logo.y + logo.height / 2,
            easing: animation.effect.getTiming().easing
          }
        })
        expect(Math.abs(geometry.width - geometry.viewportWidth)).toBeLessThanOrEqual(1)
        expect(Math.abs(geometry.height - geometry.viewportHeight)).toBeLessThanOrEqual(1)
        expect(Math.abs(geometry.logoX - geometry.width / 2)).toBeLessThan(1)
        expect(Math.abs(geometry.logoY - geometry.height / 2)).toBeLessThan(1)
        expect(geometry.easing).toBe('linear')
        await testInfo.attach(`${theme}-startup`, { body: await page.screenshot(), contentType: 'image/png' })
        await page.evaluate(() => {
          window.__startupReveal = null
          window.__startupColors = []
          window.__startupPalettes = []
          const sampleColors = () => {
            const curtain = document.querySelector('.startupCurtain')
            if (!curtain) return
            window.__startupColors.push(getComputedStyle(curtain).backgroundColor)
            window.__startupPalettes.push(JSON.stringify({
              folds: getComputedStyle(curtain).backgroundImage,
              label: getComputedStyle(document.querySelector('.startupLabel')).color,
              progress: getComputedStyle(document.querySelector('.startupProgress')).backgroundImage
            }))
            requestAnimationFrame(sampleColors)
          }
          sampleColors()
          const splash = document.getElementById('startup-splash')
          new MutationObserver(() => {
            if (splash.dataset.revealing && !window.__startupReveal) {
              const canvas = splash.querySelector('.startupFabric')
              window.__startupReveal = {
                presented: !!document.querySelector('.tabContent[aria-hidden="false"] > .routerView'),
                painted: !canvas.hidden && canvas.getContext('2d').getImageData(1, 1, 1, 1).data[3] > 0,
                started: performance.now()
              }
            }
            if (!splash.isConnected && window.__startupReveal) {
              window.__startupReveal.duration = performance.now() - window.__startupReveal.started
            }
          }).observe(document.body, { attributes: true, childList: true, subtree: true })
        })
        releaseRenderer()
        await expect(page.locator('#startup-splash')).toHaveCount(0)
        await expect(page.locator('#app')).not.toHaveAttribute('inert')
        await expect(page.locator('.topNav')).toBeVisible()
        const reveal = await page.evaluate(() => window.__startupReveal)
        expect(await page.evaluate(() => [...new Set(window.__startupColors)])).toEqual([background])
        expect(await page.evaluate(() => new Set(window.__startupPalettes).size)).toBe(1)
        expect(reveal.presented).toBe(true)
        expect(reveal.painted).toBe(true)
        expect(reveal.duration).toBeLessThan(850)
        expect(await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true)
      } finally {
        releaseRenderer()
        await page.unrouteAll({ behavior: 'wait' })
      }
    })
  })
}

test('reduced motion skips the curtain animation and releases the app', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => {
    window.__startupCanvasDraws = 0
    const drawImage = CanvasRenderingContext2D.prototype.drawImage
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (this.canvas.classList.contains('startupFabric')) window.__startupCanvasDraws++
      return drawImage.apply(this, args)
    }
  })
  await page.reload()
  await expect(page.locator('.topNav')).toBeVisible()
  await expect(page.locator('#startup-splash')).toHaveCount(0)
  await expect(page.locator('#app')).not.toHaveAttribute('inert')
  expect(await page.evaluate(() => window.__startupCanvasDraws)).toBe(0)
})

test('shows a new window before its renderer loads and respects hiding during startup', async ({ app, page }) => {
  let releaseRenderer
  const gate = new Promise(resolve => { releaseRenderer = resolve })
  const context = app.electronApp.context()
  await context.route('**/renderer.js', async route => {
    await gate
    await route.continue()
  })
  try {
    const created = app.electronApp.waitForEvent('window')
    await page.evaluate(() => window.ftElectron.openInNewWindow('/history'))
    const nextPage = await created
    await expect(nextPage.locator('#startup-splash')).toBeVisible()
    await expect(nextPage.locator('.topNav')).toHaveCount(0)
    const browserWindow = await app.electronApp.browserWindow(nextPage)
    await expect.poll(() => browserWindow.evaluate(window => window.isVisible())).toBe(true)
    await browserWindow.evaluate(window => window.hide())
    releaseRenderer()
    await nextPage.waitForLoadState('load')
    await expect(nextPage.locator('.topNav')).toBeVisible()
    await expect(nextPage.locator('#startup-splash')).toHaveCount(0)
    expect(await browserWindow.evaluate(window => window.isVisible())).toBe(false)
  } finally {
    releaseRenderer()
    await context.unrouteAll({ behavior: 'wait' })
  }
})

test.describe('startup splash with a system-selected OpenTubeX theme', () => {
  test.use({
    seed: {
      settings: {
        baseTheme: 'system', systemDarkTheme: 'openTubeXDark', systemLightTheme: 'openTubeXLight', landingPage: 'history'
      }
    }
  })

  for (const [mode, background] of [['dark', 'rgb(11, 20, 22)'], ['light', 'rgb(232, 242, 240)']]) {
    test(`uses the resolved ${mode} theme before loading the renderer`, async ({ page, app }) => {
      await app.electronApp.evaluate(({ nativeTheme }, source) => { nativeTheme.themeSource = source }, mode)
      let releaseRenderer
      const gate = new Promise(resolve => { releaseRenderer = resolve })
      const context = app.electronApp.context()
      await context.route('**/renderer.js', async route => {
        await gate
        await route.continue()
      })
      try {
        const created = app.electronApp.waitForEvent('window')
        await page.evaluate(() => window.ftElectron.openInNewWindow('/history'))
        const nextPage = await created
        await expect(nextPage.locator('#startup-splash')).toBeVisible()
        expect(await nextPage.locator('.startupCurtain').first().evaluate(element => getComputedStyle(element).backgroundColor))
          .toBe(background)
        releaseRenderer()
        await expect(nextPage.locator('#startup-splash')).toHaveCount(0)
      } finally {
        releaseRenderer()
        await context.unrouteAll({ behavior: 'wait' })
      }
    })
  }
})

test.describe('slow initial route', () => {
  test.use({ seed: { settings: { landingPage: 'history' } } })

  for (const outcome of ['loads', 'fails', 'stalls']) {
    test(outcome === 'stalls'
      ? 'releases the app when the initial route chunk stalls'
      : `keeps the splash closed until the initial route chunk ${outcome}`, async ({ page }) => {
      const dist = new URL('../../../dist-e2e/', import.meta.url)
      const chunks = await Promise.all((await readdir(dist)).filter(name => /^\d+\.js$/.test(name)).map(async name => ({
        name, source: await readFile(new URL(name, dist), 'utf8')
      })))
      const historyChunk = chunks.find(({ source }) => source.includes('History.Mark All As Watched'))?.name
      expect(historyChunk).toBeTruthy()
      let releaseChunks
      const gate = new Promise(resolve => { releaseChunks = resolve })
      await page.route(`**/${historyChunk}`, async route => {
        await gate
        if (outcome === 'fails') await route.abort('failed')
        else await route.continue()
      })
      try {
        await page.reload({ waitUntil: 'commit' })
        await expect(page.locator('.topNav')).toBeVisible()
        await expect(page.locator('.tabContent [data-tab-loading-indicator]').first()).toBeAttached()
        // Outlast the full reveal to distinguish real route readiness from the
        // container's earlier mount acknowledgement.
        await page.waitForTimeout(850)
        await expect(page.locator('#startup-splash')).toBeVisible()
        await expect(page.locator('#startup-splash')).not.toHaveAttribute('data-revealing')
        if (outcome !== 'stalls') releaseChunks()
        await expect(page.locator('#startup-splash')).toHaveCount(0, { timeout: 8000 })
        await expect(page.locator('#app')).not.toHaveAttribute('inert')
        releaseChunks()
        if (outcome !== 'fails') await expect(page.locator('.tabContent[aria-hidden="false"] > .routerView')).toBeVisible()
      } finally {
        releaseChunks()
        await page.unrouteAll({ behavior: 'wait' })
      }
    })
  }
})

test('distraction-free switch disables the early splash in new windows and can restore it', async ({ page, app }, testInfo) => {
  const settings = await goToSettingsSection(page, 'focus')
  const toggle = settings.getByRole('checkbox', { name: /^Hide Startup Splash/ })
  await expect(toggle).not.toBeChecked()

  for (const hidden of [true, false]) {
    await settings.locator('label.switch-label').filter({ hasText: 'Hide Startup Splash' }).click()
    await expect(toggle).toBeChecked({ checked: hidden })
    await expect.poll(async () => latestSettings(
      await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')
    ).hideStartupSplash).toBe(hidden)
    if (hidden) {
      for (const colorScheme of ['dark', 'light']) {
        await page.emulateMedia({ colorScheme })
        await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${colorScheme}\\b`))
        await testInfo.attach(`hide-startup-splash-setting-${colorScheme}`, {
          body: await settings.locator('.switchColumnGrid').first().screenshot(), contentType: 'image/png'
        })
      }
    }

    let releaseRenderer
    const gate = new Promise(resolve => { releaseRenderer = resolve })
    const context = app.electronApp.context()
    await context.route('**/renderer.js', async route => {
      await gate
      await route.continue()
    })
    try {
      const created = app.electronApp.waitForEvent('window')
      await page.evaluate(() => window.ftElectron.openInNewWindow('/history'))
      const nextPage = await created
      const browserWindow = await app.electronApp.browserWindow(nextPage)
      await expect.poll(() => browserWindow.evaluate(window => window.isVisible())).toBe(true)
      await expect(nextPage.locator('.topNav')).toHaveCount(0)
      if (hidden) {
        await expect(nextPage.locator('#startup-splash')).toHaveCount(0)
        await expect(nextPage.locator('#app')).not.toHaveAttribute('inert')
      } else {
        await expect(nextPage.locator('#startup-splash')).toBeVisible()
        await expect(nextPage.locator('#app')).toHaveAttribute('inert', '')
      }
      releaseRenderer()
      await expect(nextPage.locator('.topNav')).toBeVisible()
      await expect(nextPage.locator('#startup-splash')).toHaveCount(0)
      await expect(nextPage.locator('#app')).not.toHaveAttribute('inert')
      await browserWindow.evaluate(window => window.destroy())
    } finally {
      releaseRenderer()
      await context.unrouteAll({ behavior: 'wait' })
    }
  }
})
