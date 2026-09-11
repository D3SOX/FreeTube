import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test, expect, goTo, goToSettingsSection, latestSettings } from '../../helpers/app.mjs'
import { createInternetProbe, INTERNET_CHECK_URL } from '../../../src/renderer/helpers/internetConnectivity.js'

test.use({ seed: { settings: { fetchSubscriptionsAutomatically: false } } })

test('internet probe works with browser web security enabled', async ({ app }) => {
  let probeRequests = 0
  await app.electronApp.context().route(INTERNET_CHECK_URL, route => {
    if (route.request().frame().url() === 'about:blank') probeRequests++
    return route.fulfill({ status: 204 })
  })
  const reachable = await app.electronApp.evaluate(async ({ BrowserWindow }, { probeSource, url }) => {
    // Explicitly enforce the fetch restrictions that also apply to WebView,
    // independently of the app window configuration.
    const window = new BrowserWindow({ show: false, webPreferences: { webSecurity: true } })
    try {
      await window.loadURL('about:blank')
      return await window.webContents.executeJavaScript(`
        const INTERNET_CHECK_URL = ${JSON.stringify(url)};
        (${probeSource})(fetch)(new AbortController().signal)
      `)
    } finally {
      window.destroy()
    }
  }, { probeSource: createInternetProbe.toString(), url: INTERNET_CHECK_URL })
  expect(reachable).toBe(true)
  expect(probeRequests).toBe(1)
})

for (const scale of [1, 1.25]) {
  test(`connection banner follows navbar coverage at UI scale ${scale}`, async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 800 })
    await page.evaluate(scale => window.ftElectron.setZoomFactor(scale), scale)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
      window.dispatchEvent(new Event('offline'))
    })
    const banner = page.locator('.connection-status-holder')
    await expect(banner).toBeVisible()
    const bottomGap = () => banner.evaluate(element => window.innerHeight - element.getBoundingClientRect().bottom)
    await expect.poll(bottomGap).toBeCloseTo(60, 0)
    await goTo(page, 'settings')
    await expect(page.locator('.settingsWindow')).toHaveClass(/maximized/)
    await expect.poll(bottomGap).toBeCloseTo(0, 0)
    await page.locator('.app').evaluate(element => element.classList.add('capacitorPhoneLayout'))
    await page.evaluate(() => document.documentElement.style.setProperty('--safe-area-inset-bottom', '24px'))
    await expect.poll(bottomGap).toBeCloseTo(24, 0)
    await page.locator('.settingsWindowHeader').getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.locator('.settingsWindow')).toBeHidden()
    await expect.poll(bottomGap).toBeCloseTo(84, 0)

    // The mobile sheet component is developed separately; exercise its DOM contract.
    await page.evaluate(() => {
      const sheet = document.createElement('dialog')
      sheet.className = 'mobileSheet'
      document.body.append(sheet)
    })
    const sheet = page.locator('dialog.mobileSheet')
    await expect.poll(bottomGap).toBeCloseTo(84, 0)
    await sheet.evaluate(element => element.show())
    await expect.poll(bottomGap).toBeCloseTo(24, 0)
    await sheet.evaluate(element => element.close())
    await expect.poll(bottomGap).toBeCloseTo(84, 0)
    await sheet.evaluate(element => element.remove())
  })

  test(`connection banner pauses requests and confirms recovery at UI scale ${scale}`, async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 800 })
    await page.locator('.app').evaluate(element => element.classList.add('capacitorPhoneLayout'))
    await page.evaluate(scale => window.ftElectron.setZoomFactor(scale), scale)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    let requests = 0
    await page.route('https://connection.example/**', route => {
      requests++
      return route.fulfill({ status: 200, body: 'restored', headers: { 'access-control-allow-origin': '*' } })
    })
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
      window.dispatchEvent(new Event('offline'))
      window.connectionTestRequests = Promise.all(Array.from({ length: 8 }, () => fetch('https://connection.example/status').then(response => response.text())))
    })
    const banner = page.locator('.connectionStatus')
    await expect(banner).toHaveText('Offline')
    await expect(banner).toBeVisible()
    expect(requests).toBe(0)
    await expect(page.locator('.toast-slot:not(.persistent-slot)')).toHaveCount(0)
    const geometry = await banner.evaluate(element => {
      const rect = element.getBoundingClientRect()
      return { left: rect.left, right: rect.right, bottom: rect.bottom, width: window.innerWidth, height: window.innerHeight }
    })
    expect(geometry.left).toBeGreaterThanOrEqual(0)
    expect(geometry.right).toBeLessThanOrEqual(geometry.width)
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.height - 60)
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
      window.dispatchEvent(new Event('online'))
    })
    expect(await page.evaluate(() => window.connectionTestRequests)).toEqual(Array(8).fill('restored'))
    expect(requests).toBe(8)
    await expect(banner).toHaveText('Back online')
    await expect(banner).toHaveCSS('background-color', 'rgb(33, 110, 57)')
    await expect(banner).toBeHidden({ timeout: 5000 })
  })
}

test('an unavailable service retries quietly while another service remains usable', async ({ page }) => {
  let failedRequests = 0
  await page.route('https://unavailable.example/**', route => {
    failedRequests++
    return route.abort('connectionrefused')
  })
  await page.route('https://connection.example/**', route => route.fulfill({ status: 200, body: 'working' }))
  await page.evaluate(() => {
    window.connectionTestController = new AbortController()
    window.connectionTestPending = fetch('https://unavailable.example/status', {
      signal: window.connectionTestController.signal
    }).catch(error => error.name)
  })
  try {
    await expect.poll(() => failedRequests).toBeGreaterThanOrEqual(2)
    expect(await page.evaluate(() => fetch('https://connection.example/status').then(response => response.text()))).toBe('working')
    await expect(page.locator('.connectionStatus')).toBeHidden()
    await expect(page.locator('.toast-slot:not(.persistent-slot)')).toHaveCount(0)
  } finally {
    await page.evaluate(async () => {
      window.connectionTestController.abort()
      await window.connectionTestPending
    })
  }
})

for (const position of ['bottom-center', 'top-right']) {
  test.describe(position, () => {
    test.use({ seed: { settings: { fetchSubscriptionsAutomatically: false, toastPosition: position } } })
    for (const scale of [1, 1.25]) {
      test(`offline status and wrapped toasts do not overlap at UI scale ${scale} at ${position}`, async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 800 })
        await page.evaluate(scale => {
          window.ftElectron.setZoomFactor(scale)
          document.querySelector('.app').classList.add('capacitorPhoneLayout')
          Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
          window.dispatchEvent(new Event('offline'))
          window.ftElectron.showToastOnAllTabs('A separate notification with enough text to wrap onto several lines on a small phone.', 30000, ['fas', 'check'])
        }, scale)
        await page.emulateMedia({ reducedMotion: 'reduce' })
        const banner = page.locator('.connectionStatus')
        const toast = page.locator('.toast', { hasText: 'A separate notification' })
        await expect(banner).toBeVisible()
        await expect(toast).toBeVisible()
        // Exercise a longer translated status and enlarged text as well as
        // the notification wrapping independently above or below it.
        await banner.evaluate(element => {
          element.textContent = 'இணைய இணைப்பு இல்லை'
          element.style.fontSize = '28px'
        })
        for (const viewport of [{ width: 375, height: 800 }, { width: 800, height: 375 }]) {
          await page.setViewportSize(viewport)
          await expect.poll(async () => {
            const status = await banner.boundingBox()
            const notification = await toast.boundingBox()
            return status.y - notification.y - notification.height
          }).toBeGreaterThanOrEqual(9)
          const bounds = await banner.boundingBox()
          const viewportWidth = await page.evaluate(() => window.innerWidth)
          expect(bounds.x).toBeCloseTo(0, 1)
          expect(bounds.width).toBeCloseTo(viewportWidth, 1)
        }
      })
    }
  })
}

test('connection status shares space with progress and follows toasts into fullscreen', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 480, height: 800 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => {
    window.ftElectron.setZoomFactor(1.25)
    document.querySelector('.app').classList.add('capacitorPhoneLayout')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    window.dispatchEvent(new Event('offline'))
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setProgressBarMessage', 'A separate operation in progress')
    store.commit('setProgressBarIcon', ['fas', 'download'])
    store.commit('setShowProgressBar', true)
    window.ftElectron.showToastOnAllTabs('A separate notification', 30000, ['fas', 'check'])
  })
  const banner = page.locator('.connectionStatus')
  const progress = page.getByTestId('progress-toast')
  const toast = page.locator('.toast', { hasText: 'A separate notification' })
  await expect(progress).toBeVisible()
  await expect.poll(async () => {
    const notification = await toast.boundingBox()
    const status = await banner.boundingBox()
    const operation = await progress.boundingBox()
    return Math.min(status.y - notification.y - notification.height, status.y - operation.y - operation.height)
  }).toBeGreaterThanOrEqual(9)
  await page.screenshot({ path: testInfo.outputPath('offline-toast-spacing.png') })
  await page.evaluate(() => document.querySelector('.app').requestFullscreen())
  await expect(progress).toBeHidden()
  await expect(page.locator(':fullscreen .connectionStatus')).toBeVisible()
  await expect.poll(async () => {
    const notification = await toast.boundingBox()
    const status = await banner.boundingBox()
    return status.y - notification.y - notification.height
  }).toBeGreaterThanOrEqual(9)
  await page.evaluate(() => document.exitFullscreen())
  await expect(progress).toBeVisible()
})

test('a connected router without internet pauses requests and recovers without an OS network event', async ({ page }) => {
  let reachable = false
  let requests = 0
  await page.route(INTERNET_CHECK_URL, route => reachable ? route.fulfill({ status: 204 }) : route.abort('internetdisconnected'))
  await page.route('https://wan.example/**', route => {
    requests++
    return reachable ? route.fulfill({ status: 200, body: 'recovered' }) : route.abort('internetdisconnected')
  })
  await page.evaluate(() => {
    window.wanRequest = fetch('https://wan.example/data').then(response => response.text())
  })
  const banner = page.locator('.connectionStatus')
  await expect(banner).toHaveText('Connection lost. Trying to reconnect…')
  expect(await page.evaluate(() => navigator.onLine)).toBe(true)
  expect(requests).toBe(1)
  await expect(page.locator('.toast-slot:not(.persistent-slot)')).toHaveCount(0)
  reachable = true
  expect(await page.evaluate(() => window.wanRequest)).toBe('recovered')
  await expect(banner).toHaveText('Back online')
  expect(requests).toBe(2)
})

test('startup recognises WAN loss and later recovery without an OS network event', async ({ page }) => {
  let reachable = false
  await page.route(INTERNET_CHECK_URL, route => reachable ? route.fulfill({ status: 204 }) : route.abort('internetdisconnected'))
  await page.reload()
  const banner = page.locator('.connectionStatus')
  await expect(banner).toHaveText('Connection lost. Trying to reconnect…')
  expect(await page.evaluate(() => navigator.onLine)).toBe(true)
  await expect(page.locator('.toast-slot:not(.persistent-slot)')).toHaveCount(0)
  reachable = true
  await expect(banner).toHaveText('Back online')
  await expect(banner).toBeHidden()
})

test.describe('internet check privacy setting', () => {
  test.use({ seed: { settings: { fetchSubscriptionsAutomatically: false, internetConnectivityChecks: false } } })

  test('opt-out persists, skips startup probes, and can be toggled without restarting', async ({ app, page }) => {
    let requests = 0
    await page.route(INTERNET_CHECK_URL, route => {
      requests++
      return route.fulfill({ status: 204 })
    })
    await page.reload()
    await goToSettingsSection(page, 'privacy')
    const toggle = page.getByRole('checkbox', { name: 'Internet connectivity checks' })
    const label = page.locator('label.switch-label').filter({ hasText: 'Internet connectivity checks' })
    await expect(toggle).not.toBeChecked()
    expect(requests).toBe(0)
    await label.click()
    await expect(toggle).toBeChecked()
    await expect.poll(() => requests).toBe(1)
    const saved = async () => latestSettings(await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')).internetConnectivityChecks
    await expect.poll(saved).toBe(true)
    await label.click()
    await expect(toggle).not.toBeChecked()
    await expect.poll(saved).toBe(false)
    await page.reload()
    await goToSettingsSection(page, 'privacy')
    await expect(toggle).not.toBeChecked()
    expect(requests).toBe(1)
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
      window.dispatchEvent(new Event('offline'))
    })
    await expect(page.locator('.connectionStatus')).toHaveText('Offline')
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
      window.dispatchEvent(new Event('online'))
    })
    await expect(page.locator('.connectionStatus')).toHaveText('Back online')
    expect(requests).toBe(1)
  })
})

test('only internet recovery animates the full-width banner and reduced motion is respected', async ({ page }) => {
  await page.route(INTERNET_CHECK_URL, route => route.abort('internetdisconnected'))
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    window.dispatchEvent(new Event('offline'))
  })
  const banner = page.locator('.connectionStatus')
  await expect(banner).toHaveText('Offline')
  await expect(banner).not.toHaveClass(/reconnecting/)
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    window.dispatchEvent(new Event('online'))
  })
  await expect(banner).toHaveClass(/reconnecting/)
  await expect.poll(() => banner.evaluate(element => getComputedStyle(element, '::after').animationName)).toMatch(/^connection-sweep/)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(() => banner.evaluate(element => getComputedStyle(element, '::after').animationName)).toBe('none')
})

test('the full-width banner clears navigation and notifications in narrow desktop windows', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 800 })
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    window.dispatchEvent(new Event('offline'))
    window.ftElectron.showToastOnAllTabs('A separate notification', 30000, ['fas', 'check'])
  })
  const banner = page.locator('.connectionStatus')
  const toast = page.locator('.toast', { hasText: 'A separate notification' })
  await expect(banner).toBeVisible()
  await expect(toast).toBeVisible()
  await expect.poll(async () => {
    const status = await banner.boundingBox()
    const navigation = await page.locator('.sideNav').boundingBox()
    const notification = await toast.boundingBox()
    return Math.min(navigation.y - status.y - status.height, status.y - notification.y - notification.height)
  }).toBeGreaterThanOrEqual(0)
})
