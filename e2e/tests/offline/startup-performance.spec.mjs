import { rm } from 'node:fs/promises'
import { test, expect, createUserDataDir, launchApp } from '../../helpers/app.mjs'

test('presents the selected tab before mounting a large restored background session', async () => {
  const tabs = Array.from({ length: 60 }, (_, index) => ({
    id: `startup-${index}`,
    url: 'app://bundle/index.html#/history',
    title: `History ${index}`,
    isUnloaded: index === 58
  }))
  const userDataDir = await createUserDataDir({
    settings: { startupBehavior: 'restoreTabLoadState' },
    tabSessions: [{ _id: 'startup-performance', value: { tabs, activeTabId: 'startup-59' } }]
  })
  let app
  try {
    app = await launchApp(userDataDir, [], {
      onPhase: async (phase, page) => {
        if (phase !== 'windowCreated') return
        const cdp = await page.context().newCDPSession(page)
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
        const observeMounts = () => {
          if (window.__startupMounts) return
          window.__startupMounts = []
          const observer = new MutationObserver(() => {
            for (const element of document.querySelectorAll('.tabContent > .routerView')) {
              const id = element.parentElement.dataset.tabId
              if (!window.__startupMounts.includes(id)) window.__startupMounts.push(id)
            }
          })
          observer.observe(document, { childList: true, subtree: true })
        }
        await page.addInitScript(observeMounts)
        await page.evaluate(observeMounts)
      }
    })
    await expect(app.page.locator('.tabContent[data-tab-id="startup-59"][aria-hidden="false"] .headingRow')).toBeVisible()
    expect(await app.page.evaluate(() => window.__startupMounts[0])).toBe('startup-59')
    await expect.poll(() => app.page.evaluate(async () => {
      const { tabs } = await window.ftElectron.tabs.getState()
      return tabs.filter(tab => tab.loadState === 'loaded').length
    }), { timeout: 30_000 }).toBe(59)
    expect(await app.page.evaluate(async () => {
      const { tabs } = await window.ftElectron.tabs.getState()
      return tabs.find(tab => tab.id === 'startup-58').loadState
    })).toBe('unloaded')
  } finally {
    await app?.electronApp.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})
