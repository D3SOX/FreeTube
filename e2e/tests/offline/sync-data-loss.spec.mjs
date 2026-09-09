import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test, expect, goToSettingsSection, latestSettings, openNewWindowFromTabBar, setWindowSize, waitForAppReady } from '../../helpers/app.mjs'

const profiles = Array.from({ length: 16 }, (_, index) => ({
  _id: `profile-${index}`,
  name: index < 2 ? 'Music' : `Profile ${index} <test> ${'Long name '.repeat(8)}`,
  bgColor: '#000000',
  textColor: '#FFFFFF',
  subscriptions: []
}))

for (const lastUsedVersion of [null, '0.34.0']) {
  test.describe(`automatic sync notice with saved version ${lastUsedVersion}`, () => {
    test.use({
      showTutorial: Boolean(lastUsedVersion),
      seed: {
        settings: {
          lastUsedVersion,
          uiScale: 125,
          syncServerEnabled: true,
          syncServerToken: 'test-token',
          syncServerUrl: 'https://sync.example',
          syncServerAutoSync: false,
        }
      }
    })

    test('only existing users see the notice and dismissal survives reload', async ({ page }) => {
      const notification = page.locator('.toast', { hasText: 'An earlier version may have disabled it' })
      if (lastUsedVersion) {
        await expect(notification).toBeVisible()
        await expect(notification.getByRole('button')).toHaveCount(2)
        await page.reload()
        await waitForAppReady(page)
        await expect(notification).toBeVisible()
        await notification.getByRole('button', { name: 'Dismiss', exact: true }).click()
      }
      await expect(notification).toHaveCount(0)
      await page.reload()
      await waitForAppReady(page)
      await expect(notification).toHaveCount(0)
      const sync = await goToSettingsSection(page, 'sync')
      await expect(sync.getByRole('checkbox', { name: 'Sync automatically after changes and every five minutes', exact: true })).not.toBeChecked()
    })

    if (lastUsedVersion) {
      test('enables automatic sync from the notice and remembers the choice', async ({ page }) => {
        const notification = page.locator('.toast', { hasText: 'An earlier version may have disabled it' })
        await notification.getByRole('button', { name: 'Enable automatic sync', exact: true }).click()
        await expect(notification).toHaveCount(0)
        const sync = await goToSettingsSection(page, 'sync')
        await expect(sync.getByRole('checkbox', { name: 'Sync automatically after changes and every five minutes', exact: true })).toBeChecked()
        await page.reload()
        await waitForAppReady(page)
        await expect(notification).toHaveCount(0)
        const reloadedSync = await goToSettingsSection(page, 'sync')
        await expect(reloadedSync.getByRole('checkbox', { name: 'Sync automatically after changes and every five minutes', exact: true })).toBeChecked()
      })
    }
  })
}

for (const uiScale of [95, 125]) {
  test.describe(`destructive sync at ${uiScale}% UI scale`, () => {
    test.use({
      seed: {
        settings: {
          uiScale,
          syncServerEnabled: true,
          syncServerUrl: 'https://sync.example',
          syncServerUsername: 'test-user',
          syncServerToken: 'test-token',
          syncServerPrivacyMode: 'legacy',
          syncServerAutoSync: false,
          syncServerSyncSubscriptions: false,
          syncServerSyncPlaylists: false,
          syncServerSyncHistory: false,
          syncServerSyncProfiles: true,
          syncServerSnapshot: JSON.stringify({
            profiles: Object.fromEntries(profiles.map(profile => [profile._id, {
              remoteId: profile._id,
              metadata: { title: profile.name },
              channels: []
            }]))
          })
        },
        profiles: [{ _id: 'allChannels', name: 'All Channels', subscriptions: [] }, ...profiles]
      }
    })

    test('background sync warns outside Settings and opens sync settings from the notification', async ({ page }) => {
      await page.route('https://sync.example/**', route => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(route.request().url().endsWith('/health')
          ? { capabilities: { encrypted_sync: 0 } }
          : [])
      }))
      const sync = await goToSettingsSection(page, 'sync')
      const autoSync = sync.getByRole('checkbox', { name: 'Sync automatically after changes and every five minutes', exact: true })
      // Register lifecycle listeners after installing the mock server route.
      const enabled = sync.getByRole('checkbox', { name: 'Enable Sync', exact: true })
      await enabled.press('Space')
      await expect(enabled).not.toBeChecked()
      const initialized = page.waitForResponse('https://sync.example/health')
      await enabled.press('Space')
      await initialized
      await autoSync.press('Space')
      await expect(autoSync).toBeChecked()
      await page.keyboard.press('Escape')
      await expect(page.locator('.settingsWindow')).toBeHidden()
      await page.evaluate(() => window.dispatchEvent(new Event('online')))
      const notification = page.locator('.toast', { hasText: 'Sync stopped to prevent data loss.' })
      await expect(notification).toBeVisible()
      await expect(page.getByRole('dialog', { name: 'Confirm destructive sync?' })).toBeHidden()
      await notification.getByRole('button', { name: 'Sync', exact: true }).click()
      await expect(sync).toBeVisible()
      await expect(autoSync).not.toBeChecked()
      await sync.getByRole('button', { name: 'Sync now', exact: true }).click()
      await expect(page.getByRole('dialog', { name: 'Confirm destructive sync?' }).locator('.dataLossItems li')).toHaveCount(profiles.length)
    })

    test('lists affected profiles and keeps long deletion lists usable', async ({ app, page }, testInfo) => {
      await page.route('https://sync.example/**', route => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(route.request().url().endsWith('/health')
          ? { capabilities: { encrypted_sync: 0 } }
          : [])
      }))
      const sync = await goToSettingsSection(page, 'sync')
      await sync.getByRole('button', { name: 'Sync now', exact: true }).click()
      const warning = page.getByRole('dialog', { name: 'Confirm destructive sync?' })
      await expect(warning).toBeVisible()
      await expect(warning.locator('.dataLossItems li')).toHaveCount(profiles.length)
      for (const [index, profile] of profiles.entries()) {
        const item = warning.locator('.dataLossItems li').nth(index)
        await expect(item).toContainText(profile.name)
        await expect(item).toContainText(profile._id)
      }
      await expect(page.locator('.toast', { hasText: 'Sync stopped to prevent data loss.' })).toHaveCount(0)
      await warning.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(warning).toBeHidden()
      await expect(sync.getByRole('checkbox', { name: 'Sync automatically after changes and every five minutes', exact: true })).not.toBeChecked()

      await sync.getByRole('button', { name: 'Sync now', exact: true }).click()
      await expect(warning).toBeVisible()
      await setWindowSize(app, page, { width: 650, height: 650 })
      const scroller = warning.locator('.promptContentScroller')
      const header = warning.getByRole('heading')
      await expect(warning).toHaveCSS('transform', 'none')
      const headerTop = await header.evaluate(element => element.getBoundingClientRect().top)
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      expect(await header.evaluate(element => element.getBoundingClientRect().top)).toBeCloseTo(headerTop, 1)
      await expect(warning.getByRole('button', { name: 'Delete and continue' })).toBeInViewport()
      expect(await scroller.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      // Native capture includes the entire window at non-100% Electron zoom.
      const screenshot = await app.electronApp.evaluate(async ({ BrowserWindow }) => (
        (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')
      ))
      await testInfo.attach(`Destructive sync details at ${uiScale}%`, {
        body: Buffer.from(screenshot, 'base64'), contentType: 'image/png'
      })

      // Widening the dialog unwraps names and shortens its content.
      await setWindowSize(app, page, { width: 1200, height: 900 })
      await expect.poll(() => scroller.evaluate(element => {
        const content = element.firstElementChild
        const end = content.getBoundingClientRect().bottom - element.getBoundingClientRect().top + element.scrollTop
        return element.scrollTop <= Math.max(0, end - element.clientHeight) + 1
      })).toBe(true)
      const scrollbar = scroller.locator(':scope > .os-scrollbar-vertical')
      await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
      const handleRatio = await scrollbar.evaluate(element => {
        return element.querySelector('.os-scrollbar-handle').getBoundingClientRect().height /
          element.querySelector('.os-scrollbar-track').getBoundingClientRect().height
      })
      const viewportRatio = await scroller.evaluate(element => element.clientHeight / element.scrollHeight)
      expect(handleRatio).toBeCloseTo(viewportRatio, 1)

      await warning.getByRole('button', { name: 'Delete and continue' }).click()
      await expect(warning).toBeHidden()
      await expect.poll(async () => latestSettings(await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')).syncServerSnapshot)
        .toBe(JSON.stringify({ profiles: {} }))
    })
  })
}

test.describe('automatic sync recovery', () => {
  test.use({
    seed: {
      settings: {
        baseTheme: 'dark',
        uiScale: 100,
        currentLocale: 'en-US',
        syncServerEnabled: true,
        syncServerUrl: 'https://sync.example',
        syncServerUsername: 'example-user',
        syncServerToken: 'test-token',
        syncServerPrivacyMode: 'legacy',
        syncServerAutoSync: false,
        syncServerSyncSubscriptions: false,
        syncServerSyncPlaylists: false,
        syncServerSyncHistory: false,
        syncServerSyncProfiles: true,
        syncServerSnapshot: JSON.stringify({
          profiles: {
            music: { remoteId: 'music', metadata: { title: 'Music' }, channels: [] }
          }
        })
      },
      profiles: [
        { _id: 'allChannels', name: 'All Channels', subscriptions: [] },
        { _id: 'music', name: 'Music', bgColor: '#000000', textColor: '#FFFFFF', subscriptions: [] }
      ]
    }
  })

  test('shows a background window sync failure and its shortcut in the active window', async ({ app, page }) => {
    const activeWindow = await openNewWindowFromTabBar(app, page)
    await waitForAppReady(activeWindow)
    await page.route('https://sync.example/**', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(route.request().url().endsWith('/health')
        ? { capabilities: { encrypted_sync: 0 } }
        : [])
    }))
    // Only the originating window makes a sync request. The other window must
    // receive the notification through IPC, without retrying the failed sync.
    const sourceWindow = await app.electronApp.browserWindow(page)
    await sourceWindow.evaluate(window => window.hide())
    await expect.poll(() => sourceWindow.evaluate(window => window.isVisible())).toBe(false)
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('setSyncServerAutoSync', true)
    })
    const failure = await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      try {
        await store.dispatch('syncWithSyncServer')
        return null
      } catch (error) {
        return error.name
      }
    })
    expect(failure).toBe('SyncServerDataLossError')
    const notification = activeWindow.locator('.toast', { hasText: 'Sync stopped to prevent data loss.' })
    await expect(notification).toBeVisible()
    await notification.getByRole('button', { name: 'Sync', exact: true }).click()
    await expect(activeWindow.locator('.settingsWindow')).toBeVisible()
    await expect(activeWindow.locator('[data-section="sync"]').getByRole('button', { name: 'Sync now', exact: true })).toBeVisible()
    await expect(activeWindow.getByRole('checkbox', { name: 'Sync automatically after changes and every five minutes', exact: true })).not.toBeChecked()
    await expect(activeWindow.getByRole('dialog', { name: 'Confirm destructive sync?' })).toBeHidden()
  })

  test('resumes previously enabled automatic sync after confirmation across an app restart', async ({ app, page }, testInfo) => {
    async function mockServer(targetPage) {
      await targetPage.route('https://sync.example/**', route => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(route.request().url().endsWith('/health')
          ? { capabilities: { encrypted_sync: 0 } }
          : [])
      }))
    }
    await mockServer(page)
    const sync = await goToSettingsSection(page, 'sync')
    const enabled = sync.getByRole('checkbox', { name: 'Enable Sync', exact: true })
    await enabled.press('Space')
    const initialized = page.waitForResponse('https://sync.example/health')
    await enabled.press('Space')
    await initialized
    await sync.getByRole('checkbox', { name: 'Sync automatically after changes and every five minutes' }).press('Space')
    await page.keyboard.press('Escape')
    await expect(page.locator('.settingsWindow')).toBeHidden()
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    const notification = page.locator('.toast', { hasText: 'Sync stopped to prevent data loss.' })
    await expect(notification).toBeVisible()
    await notification.screenshot({ path: testInfo.outputPath('sync-notification.png') })

    const settingsFile = path.join(app.userDataDir, 'settings.db')
    await expect.poll(async () => latestSettings(await readFile(settingsFile, 'utf8')).syncServerResumeAutoSync).toBe(true)
    await app.relaunch()
    const restarted = app.page
    await mockServer(restarted)
    const restartedSync = await goToSettingsSection(restarted, 'sync')
    const autoSync = restartedSync.getByRole('checkbox', { name: 'Sync automatically after changes and every five minutes' })
    await expect(autoSync).not.toBeChecked()
    await restartedSync.getByRole('button', { name: 'Sync now', exact: true }).click()
    const warning = restarted.getByRole('dialog', { name: 'Confirm destructive sync?' })
    await expect(warning).toBeVisible()
    await expect(warning.locator('.dataLossItems')).toContainText('Music')
    await expect(warning).toHaveCSS('transform', 'none')
    await warning.screenshot({ path: testInfo.outputPath('sync-confirmation.png') })
    await warning.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(autoSync).not.toBeChecked()
    await restartedSync.getByRole('button', { name: 'Sync now', exact: true }).click()
    await warning.getByRole('button', { name: 'Delete and continue' }).click()
    await expect(autoSync).toBeChecked()
    await expect.poll(async () => latestSettings(await readFile(settingsFile, 'utf8')).syncServerResumeAutoSync).toBe(false)
  })
})
