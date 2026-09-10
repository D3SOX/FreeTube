import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'

import { test, expect, sel, goTo } from '../../helpers/app.mjs'

const SUBSCRIPTIONS_TAB_ID = 'e2e-subscriptions-tab'
const HISTORY_TAB_ID = 'e2e-history-tab'
const WATCH_TAB_ID = 'e2e-watch-tab'
const GROUP_ID = 'e2e-saved-group'
const STALE_WATCH_URL = 'app://bundle/index.html#/watch/jNQXAC9IVRw?oneTimeTimestamp=12&timestamp=34'

test.use({
  seed: {
    settings: {
      currentLocale: 'de-DE',
      rememberTabNavigationHistory: true,
      startupBehavior: 'restoreTabLoadState'
    },
    tabSessions: [
      {
        _id: 'e2e-window-session',
        value: {
          tabs: [
            {
              id: SUBSCRIPTIONS_TAB_ID,
              url: 'app://bundle/index.html#/subscriptions',
              title: 'Abos',
              isUnloaded: false
            },
            {
              id: HISTORY_TAB_ID,
              url: 'app://bundle/index.html#/history',
              title: 'Verlauf',
              isUnloaded: false,
              groupId: GROUP_ID
            },
            {
              id: WATCH_TAB_ID,
              url: STALE_WATCH_URL,
              title: 'Saved video',
              isUnloaded: true,
              groupId: GROUP_ID,
              history: [{
                route: {
                  path: '/watch/jNQXAC9IVRw',
                  query: { oneTimeTimestamp: '12', timestamp: '34' }
                },
                title: 'Saved video',
                scroll: { left: 0, top: 0 }
              }],
              historyIndex: 0
            }
          ],
          groups: [{
            id: GROUP_ID,
            name: 'Recherche',
            color: 'blue',
            isCollapsed: true
          }],
          activeTabId: HISTORY_TAB_ID,
          bounds: { x: 0, y: 0, width: 1600, height: 900, maximized: false }
        }
      }
    ]
  }
})

async function readSavedSession(userDataDir) {
  const contents = await readFile(path.join(userDataDir, 'tab-session.db'), 'utf8')
  const records = contents
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((record) => record._id === 'e2e-window-session' && record.value)

  return records.at(-1)?.value
}

test.describe('skip silence session restore', () => {
  const LEGACY_TAB_ID = 'e2e-legacy-skip-silence-tab'
  const SAVED_TAB_ID = 'e2e-saved-skip-silence-tab'

  test.use({
    seed: {
      settings: {
        startupBehavior: 'restoreTabLoadState',
        showSkipSilenceButton: true,
        enableSkipSilenceByDefault: true
      },
      tabSessions: [
        {
          _id: 'e2e-window-session',
          value: {
            tabs: [
              {
                id: LEGACY_TAB_ID,
                url: 'app://bundle/index.html#/history',
                title: 'Legacy tab',
                isUnloaded: true
              },
              {
                id: SAVED_TAB_ID,
                url: 'app://bundle/index.html#/subscriptions',
                title: 'Saved tab',
                skipSilence: true,
                isUnloaded: false
              }
            ],
            activeTabId: SAVED_TAB_ID,
            bounds: { x: 0, y: 0, width: 1600, height: 900, maximized: false }
          }
        }
      ]
    }
  })

  const readSkipSilenceByTabId = (page) => page.evaluate(async () => {
    const state = await window.ftElectron.tabs.getState()
    return Object.fromEntries(state.tabs.map(tab => [tab.id, tab.skipSilence]))
  })

  test('preserves each tab value across restarts without applying the new-tab default', async ({ app, page }) => {
    await expect.poll(() => readSkipSilenceByTabId(page)).toEqual({
      [LEGACY_TAB_ID]: false,
      [SAVED_TAB_ID]: true
    })

    await page.evaluate(async (tabId) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateTabSkipSilence', { tabId, value: false })
    }, SAVED_TAB_ID)
    await expect.poll(async () => {
      const session = await readSavedSession(app.userDataDir)
      return session?.tabs.find(tab => tab.id === SAVED_TAB_ID)?.skipSilence
    }).toBe(false)

    ;({ page } = await app.relaunch())
    await expect.poll(() => readSkipSilenceByTabId(page)).toEqual({
      [LEGACY_TAB_ID]: false,
      [SAVED_TAB_ID]: false
    })
  })
})

test('keeps an unconsumed link timestamp across an app restart', async ({ app, page }) => {
  await expect.poll(async () => {
    const session = await readSavedSession(app.userDataDir)
    const watchTab = session?.tabs.find((tab) => tab.id === WATCH_TAB_ID)
    return {
      url: watchTab?.url,
      historyQuery: watchTab?.history?.[0]?.route?.query
    }
  }).toEqual({
    url: 'app://bundle/index.html#/watch/jNQXAC9IVRw?timestamp=34',
    historyQuery: { timestamp: '34' }
  })

  ;({ page } = await app.relaunch())
  await expect.poll(async () => {
    const state = await page.evaluate(() => window.ftElectron.tabs.getState())
    return state.tabs.find((tab) => tab.id === WATCH_TAB_ID)?.url
  }).toBe('app://bundle/index.html#/watch/jNQXAC9IVRw?timestamp=34')
})

test('restores tab order, titles, active route, and saved load state across restarts', async ({ app, page }) => {
  const tabs = page.locator(sel.tabs)
  await expect(tabs).toHaveCount(1)
  await expect(tabs.nth(0)).toContainText('Abos')
  const collapsedGroup = page.getByRole('button', { name: 'Recherche ausklappen, 2 Tabs', exact: true })
  await expect(collapsedGroup).toHaveClass(/active/)
  await expect(tabs.nth(0)).not.toHaveClass(/unloaded/)
  await expect(page).toHaveURL(/#\/history/)
  await expect.poll(() => page.evaluate(async () => {
    const state = await window.ftElectron.tabs.getState()
    return state.groups
  })).toEqual([{ id: GROUP_ID, name: 'Recherche', color: 'blue', isCollapsed: true }])

  await tabs.nth(0).click()
  await expect(page).toHaveURL(/#\/subscriptions/)
  await expect(tabs.nth(0)).toHaveClass(/active/)
  await expect(tabs.nth(0)).toContainText('Abos')

  ;({ page } = await app.relaunch())
  const restoredTabs = page.locator(sel.tabs)
  await expect(restoredTabs).toHaveCount(1)
  await expect(restoredTabs.nth(0)).toHaveClass(/active/)
  await expect(restoredTabs.nth(0)).toContainText('Abos')
  await expect(restoredTabs.filter({ hasText: /Settings\.Settings|History\.History/ })).toHaveCount(0)
  await expect(page).toHaveURL(/#\/subscriptions/)
  const restoredCollapsedGroup = page.getByRole('button', { name: 'Recherche ausklappen, 2 Tabs', exact: true })
  await expect(restoredCollapsedGroup).not.toHaveClass(/active/)
  await expect.poll(() => page.evaluate(async (groupId) => {
    const state = await window.ftElectron.tabs.getState()
    return {
      groups: state.groups,
      groupedTabIds: state.tabs.filter(tab => tab.groupId === groupId).map(tab => tab.id)
    }
  }, GROUP_ID)).toEqual({
    groups: [{ id: GROUP_ID, name: 'Recherche', color: 'blue', isCollapsed: true }],
    groupedTabIds: [HISTORY_TAB_ID, WATCH_TAB_ID]
  })

  await restoredCollapsedGroup.click()
  await expect(restoredTabs).toHaveCount(3)
  await expect(restoredTabs.nth(1)).toContainText('Verlauf')
  await expect(restoredTabs.nth(2)).toContainText('Saved video')
  await expect(restoredTabs.nth(1)).not.toHaveClass(/unloaded/)
  await expect(restoredTabs.nth(2)).toHaveClass(/unloaded/)

  await goTo(page, 'history')
  await expect(restoredTabs.nth(0)).toHaveClass(/active/)
})

test.describe('active watch tab restore', () => {
  const watchRestoreSeed = {
    settings: {
      backendPreference: 'invidious',
      defaultInvidiousInstance: '',
      startupBehavior: 'loadLastActiveTab'
    },
    tabSessions: [
      {
        _id: 'e2e-window-session',
        value: {
          tabs: [
            {
              id: WATCH_TAB_ID,
              url: 'app://bundle/index.html#/watch/jNQXAC9IVRw',
              title: 'Saved video',
              isUnloaded: false
            }
          ],
          activeTabId: WATCH_TAB_ID,
          bounds: { x: 0, y: 0, width: 1600, height: 900, maximized: false }
        }
      }
    ]
  }
  const invidiousServer = createServer()

  test.use({
    seed: watchRestoreSeed
  })

  test.beforeAll(async () => {
    await new Promise(resolve => invidiousServer.listen(0, '127.0.0.1', resolve))
    const address = invidiousServer.address()
    watchRestoreSeed.settings.defaultInvidiousInstance = `http://127.0.0.1:${address.port}`
  })

  test.afterAll(async () => {
    invidiousServer.closeAllConnections()
    await new Promise(resolve => invidiousServer.close(resolve))
  })

  test('presents the video player skeleton during startup', async ({ page }) => {
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
    await expect(page.locator(
      '.tabContent[aria-hidden="false"] .videoPlayerPlaceholder.ft-shimmer'
    )).toBeVisible()
  })
})

test.describe('restored watch tab startup priority', () => {
  const ACTIVE_WATCH_TAB_ID = 'e2e-active-watch-tab'
  const BACKGROUND_WATCH_TAB_ID = 'e2e-background-watch-tab'
  const SUBSCRIPTIONS_TAB_ID = 'e2e-background-subscriptions-tab'
  const priorityRestoreSeed = {
    settings: {
      backendPreference: 'invidious',
      defaultInvidiousInstance: '',
      startupBehavior: 'loadAllTabs'
    },
    tabSessions: [
      {
        _id: 'e2e-window-session',
        value: {
          tabs: [
            {
              id: BACKGROUND_WATCH_TAB_ID,
              url: 'app://bundle/index.html#/watch/background-video',
              title: 'Background video',
              isUnloaded: false
            },
            {
              id: ACTIVE_WATCH_TAB_ID,
              url: 'app://bundle/index.html#/watch/active-video',
              title: 'Active video',
              isUnloaded: false
            },
            {
              id: SUBSCRIPTIONS_TAB_ID,
              url: 'app://bundle/index.html#/subscriptions',
              title: 'Subscriptions',
              isUnloaded: false
            }
          ],
          activeTabId: ACTIVE_WATCH_TAB_ID,
          bounds: { x: 0, y: 0, width: 1600, height: 900, maximized: false }
        }
      }
    ]
  }
  const invidiousServer = createServer()

  test.use({ seed: priorityRestoreSeed })

  test.beforeAll(async () => {
    await new Promise(resolve => invidiousServer.listen(0, '127.0.0.1', resolve))
    const address = invidiousServer.address()
    priorityRestoreSeed.settings.defaultInvidiousInstance = `http://127.0.0.1:${address.port}`
  })

  test.afterAll(async () => {
    invidiousServer.closeAllConnections()
    await new Promise(resolve => invidiousServer.close(resolve))
  })

  test('defers background watch tabs until the active watch load finishes', async ({ page }) => {
    const backgroundWatchTab = page.locator(`.tab[data-tab-id="${BACKGROUND_WATCH_TAB_ID}"]`)
    const subscriptionsTab = page.locator(`.tab[data-tab-id="${SUBSCRIPTIONS_TAB_ID}"]`)

    await expect(page.locator(sel.activeTab)).toHaveAttribute('data-tab-id', ACTIVE_WATCH_TAB_ID)
    await expect(backgroundWatchTab).toHaveClass(/unloaded/)
    await expect(subscriptionsTab).not.toHaveClass(/unloaded/)
    await page.evaluate(activeTabId => {
      window.ftElectron.tabs.setLoading(true, activeTabId)
    }, ACTIVE_WATCH_TAB_ID)
    await expect.poll(async () => {
      const state = await page.evaluate(() => window.ftElectron.tabs.getState())
      return state.tabs.find(tab => tab.id === ACTIVE_WATCH_TAB_ID)?.isLoading
    }).toBe(true)

    await page.evaluate(activeTabId => {
      window.ftElectron.tabs.setLoading(false, activeTabId)
    }, ACTIVE_WATCH_TAB_ID)

    await expect(backgroundWatchTab).not.toHaveClass(/unloaded/)
    await expect(page.locator(
      `.tabContent[data-tab-id="${BACKGROUND_WATCH_TAB_ID}"] [data-tab-loading-indicator]`
    )).toHaveCount(1)
    await expect.poll(async () => {
      const state = await page.evaluate(() => window.ftElectron.tabs.getState())
      return state.tabs.find(tab => tab.id === BACKGROUND_WATCH_TAB_ID)?.loadState
    }).not.toBe('unloaded')
  })

  test('releases background watch tabs when a loaded tab becomes active', async ({ page }) => {
    const backgroundWatchTab = page.locator(`.tab[data-tab-id="${BACKGROUND_WATCH_TAB_ID}"]`)
    const subscriptionsTab = page.locator(`.tab[data-tab-id="${SUBSCRIPTIONS_TAB_ID}"]`)

    await expect(backgroundWatchTab).toHaveClass(/unloaded/)
    await expect.poll(async () => {
      const state = await page.evaluate(() => window.ftElectron.tabs.getState())
      return state.tabs.find(tab => tab.id === SUBSCRIPTIONS_TAB_ID)?.loadState
    }).toBe('loaded')

    await subscriptionsTab.click()

    await expect(page.locator(sel.activeTab)).toHaveAttribute('data-tab-id', SUBSCRIPTIONS_TAB_ID)
    await expect(backgroundWatchTab).not.toHaveClass(/unloaded/)
  })

  test('releases background watch tabs when the priority mount fails', async ({ page }) => {
    const backgroundWatchTab = page.locator(`.tab[data-tab-id="${BACKGROUND_WATCH_TAB_ID}"]`)

    await expect(backgroundWatchTab).toHaveClass(/unloaded/)
    const mountRevision = await page.evaluate(async activeTabId => {
      const state = await window.ftElectron.tabs.getState()
      return state.tabs.find(tab => tab.id === activeTabId)?.mountRevision
    }, ACTIVE_WATCH_TAB_ID)

    await page.evaluate(({ activeTabId, mountRevision }) => {
      window.ftElectron.tabs.mountFailed(activeTabId, mountRevision)
    }, { activeTabId: ACTIVE_WATCH_TAB_ID, mountRevision })

    await expect(backgroundWatchTab).not.toHaveClass(/unloaded/)
  })
})

for (const existingLanding of [false, true]) {
  test.describe(`landing-page startup ${existingLanding ? 'reuses' : 'creates'} a tab`, () => {
    test.use({
      seed: {
        settings: { startupBehavior: 'loadLandingPage', landingPage: 'history' },
        tabSessions: [{
          _id: 'e2e-window-session',
          value: {
            tabs: [
              { id: WATCH_TAB_ID, url: 'app://bundle/index.html#/watch/jNQXAC9IVRw', title: 'Saved video', isUnloaded: false },
              ...(existingLanding ? [{ id: HISTORY_TAB_ID, url: 'app://bundle/index.html#/history', title: 'History', isUnloaded: true }] : [])
            ],
            activeTabId: WATCH_TAB_ID
          }
        }]
      }
    })

    test('loads only the landing page and keeps the previous tabs', async ({ page }) => {
      await expect(page).toHaveURL(/#\/history$/)
      await expect.poll(async () => page.evaluate(async () => {
        const state = await window.ftElectron.tabs.getState()
        return state.tabs.map(tab => ({ id: tab.id, isUnloaded: tab.isUnloaded, active: tab.id === state.activeTabId }))
      })).toEqual([
        { id: WATCH_TAB_ID, isUnloaded: true, active: false },
        { id: existingLanding ? HISTORY_TAB_ID : expect.any(String), isUnloaded: false, active: true }
      ])
      await expect(page.locator('.tabContent[aria-hidden="false"]')).toHaveCount(1)
      await expect(page.locator('.videoPlayerPlaceholder')).toHaveCount(0)
    })
  })
}
