import { test, expect, sel } from '../../helpers/app.mjs'

test.describe('app launch', () => {
  test('boots to a usable window', async ({ page }) => {
    await expect(page.locator('.topNav')).toBeVisible()
    await expect(page.locator('.sideNav')).toBeVisible()
    await expect(page.locator(sel.searchInput)).toBeVisible()
  })

  test('starts with a single active tab', async ({ page }) => {
    await expect(page.locator(sel.tabs)).toHaveCount(1)
    await expect(page.locator(sel.activeTab)).toHaveCount(1)
  })

  test('renderer produces no page errors during startup', async ({ app }) => {
    const errors = []
    app.page.on('pageerror', (error) => errors.push(error.message))
    // Give the app a moment to finish async startup work.
    await app.page.waitForTimeout(3000)
    expect(errors).toEqual([])
  })

  test('loads the player-script evaluator from srcdoc', async ({ page }) => {
    const sigFrame = page.locator('#sigFrame')
    expect(await sigFrame.getAttribute('srcdoc')).toContain('<script>')
    await expect(sigFrame).not.toHaveAttribute('src', /^data:/)
    await expect(sigFrame).toHaveAttribute('sandbox', 'allow-scripts')

    const result = await page.evaluate(async () => {
      const iframe = document.getElementById('sigFrame')
      const id = 'e2e-sig-frame'

      return await new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          window.removeEventListener('message', listener)
          reject(new Error('The player-script evaluator did not respond'))
        }, 5000)
        const listener = (event) => {
          if (event.source !== iframe.contentWindow || typeof event.data !== 'string') return

          const message = JSON.parse(event.data)
          if (message.id !== id) return

          window.clearTimeout(timeout)
          window.removeEventListener('message', listener)
          resolve(message.result)
        }

        window.addEventListener('message', listener)
        iframe.contentWindow.postMessage(JSON.stringify({ id, code: 'return 6 * 7' }), '*')
      })
    })

    expect(result).toBe(42)
  })
})

test.describe('startup arguments', () => {
  test.use({ launchArgs: ['not-a-url.txt', '--unknown-option'] })

  test('ignores non-URL startup arguments', async ({ page }) => {
    await expect(page).toHaveURL(/#\/subscriptions/)
    await expect(page.locator(sel.tabs)).toHaveCount(1)
  })
})
