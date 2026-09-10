import { test, expect } from '../../helpers/app.mjs'

test.use({ seed: { settings: { fetchSubscriptionsAutomatically: false } } })

for (const scale of [1, 1.25]) {
  test(`connection banner pauses requests and confirms recovery at UI scale ${scale}`, async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 800 })
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
    await expect(banner).toHaveText('Connection lost. Trying to reconnect…')
    await expect(banner).toBeVisible()
    expect(requests).toBe(0)
    await expect(page.locator('.toast-slot:not(.persistent-slot)')).toHaveCount(0)
    const geometry = await banner.evaluate(element => {
      const rect = element.getBoundingClientRect()
      return { left: rect.left, right: rect.right, bottom: rect.bottom, width: window.innerWidth, height: window.innerHeight }
    })
    expect(geometry.left).toBeGreaterThanOrEqual(0)
    expect(geometry.right).toBeLessThanOrEqual(geometry.width)
    expect(geometry.bottom).toBeLessThan(geometry.height - 60)
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
