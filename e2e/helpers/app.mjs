import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync } from 'node:zlib'

import { test as base, expect, _electron as electron } from '@playwright/test'

// This fixture also runs against candidate builds from the base checkout.
const INTERNET_CHECK_URL = 'https://connectivitycheck.grapheneos.network/generate_204'

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// Settings that keep tests deterministic and stop the app from phoning home
// for things unrelated to the functionality under test.
const BASE_SETTINGS = {
  backendPreference: 'local',
  backendFallback: false,
  checkForUpdates: false,
  checkForBlogPosts: false,
  externalLinkHandling: 'doNothing',
  confirmCloseApp: false,
  confirmCloseWindowWithMultipleTabs: false,
  useAITranslationCompletions: false,
  // Desktop-sized window so the responsive layout doesn't collapse into
  // its mobile variant (which hides the search bar, among other things).
  bounds: { x: 0, y: 0, width: 1600, height: 900, maximized: false }
}

/** Blocks unmocked services while keeping the fixture's internet check reachable. */
export function abortUnmockedRequest(route) {
  return route.request().url() === INTERNET_CHECK_URL
    ? route.fulfill({ status: 204 })
    : route.abort()
}

/**
 * Serializes documents in the newline-delimited JSON format used by nedb.
 *
 * @param {object[]} docs
 */
function toNedbFile(docs) {
  return docs.map((doc) => JSON.stringify(doc)).join('\n') + '\n'
}

export function latestSettings(contents) {
  return Object.fromEntries(contents.trim().split('\n')
    .map(line => JSON.parse(line))
    .filter(record => record._id && !record.$$deleted)
    .map(record => [record._id, record.value]))
}

export async function updateInputWithoutScrolling(input, value) {
  await input.evaluate((element, nextValue) => {
    element.value = nextValue
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

export async function expectScrollAtRenderedEnd(scroller) {
  await expect.poll(() => scroller.evaluate((element) => {
    const content = element.querySelector(':scope > div')
    const contentEnd = content.offsetTop + content.offsetHeight +
      Number.parseFloat(getComputedStyle(element).paddingBottom)
    const maximumScrollTop = Math.max(0, contentEnd - element.clientHeight)
    return Math.abs(element.scrollTop - maximumScrollTop)
  })).toBeLessThanOrEqual(1)
}

/**
 * Creates an isolated userData directory, optionally seeded with
 * settings and datastore documents.
 *
 * @param {object} [seed]
 * @param {boolean} [seed.freshProfile] leave the settings datastore absent for first-run tests
 * @param {Record<string, unknown>} [seed.settings] additional settings.db entries ({ settingId: value })
 * @param {object[]} [seed.history] history.db documents
 * @param {object[]} [seed.playlists] playlists.db documents
 * @param {object[]} [seed.profiles] profiles.db documents
 * @param {object[]} [seed.searchHistory] search-history.db documents
 * @param {object[]} [seed.subscriptionCache] subscription-cache.db documents
 * @param {object[]} [seed.tabSessions] tab-session.db documents
 * @param {object[]} [seed.watchStats] watch-stats.db documents
 * @param {object[]} [seed.downloads] persisted downloads
 */
export async function createUserDataDir(seed = {}) {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'opentubex-e2e-'))

  if (!seed.freshProfile) {
    const settings = { ...BASE_SETTINGS, ...seed.settings }
    const settingsDocs = Object.entries(settings).map(([_id, value]) => ({ _id, value }))
    await writeFile(path.join(userDataDir, 'settings.db'), toNedbFile(settingsDocs))
  }

  const seededStores = {
    history: seed.history,
    playlists: seed.playlists,
    profiles: seed.profiles,
    'search-history': seed.searchHistory,
    'subscription-cache': seed.subscriptionCache,
    'tab-session': seed.tabSessions,
    'watch-stats': seed.watchStats
  }
  for (const [store, docs] of Object.entries(seededStores)) {
    if (docs?.length) {
      await writeFile(path.join(userDataDir, `${store}.db`), toNedbFile(docs))
    }
  }
  if (seed.downloads?.length) {
    await writeFile(path.join(userDataDir, 'downloads.json'), JSON.stringify(seed.downloads))
  }

  return userDataDir
}

/**
 * Launches the packed app (dist/main.js) against the given userData directory.
 *
 * @param {string} userDataDir
 * @param {string[]} [extraArgs]
 * @param {object} [options]
 * @param {string} [options.appRoot] repository root containing dist-e2e
 * @param {string} [options.executablePath] Electron executable to launch
 * @param {(phase: 'electronConnected'|'windowCreated'|'routeCommitted'|'interactive', page?: import('@playwright/test').Page) => void|Promise<void>} [options.onPhase]
 */
export async function launchApp(userDataDir, extraArgs = [], options = {}) {
  const appRoot = options.appRoot ?? repoRoot
  // Force X11 so the app renders on the xvfb display instead of escaping
  // to the user's real Wayland session.
  const env = {
    ...process.env,
    OPENTUBEX_E2E_USER_DATA_DIR: userDataDir,
    ELECTRON_OZONE_PLATFORM_HINT: 'x11'
  }
  delete env.WAYLAND_DISPLAY
  // Cursor/agent shells may set this, which makes Electron act as Node and
  // reject Chromium launch flags used by Playwright.
  delete env.ELECTRON_RUN_AS_NODE

  // The E2E build lives in its own directory so a running `pnpm dev`
  // (which rebuilds dist/ in development mode) can't clobber it.
  const launchOptions = {
    args: [
      path.join(appRoot, 'dist-e2e', 'main.js'),
      ...extraArgs,
      '--ozone-platform=x11',
      '--mute-audio'
    ],
    cwd: appRoot,
    env
  }
  if (options.executablePath) {
    launchOptions.executablePath = options.executablePath
  }

  let electronApp
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      electronApp = await electron.launch(launchOptions)
      break
    } catch (error) {
      // Concurrent Linux launches can transiently fail with ETXTBSY, a
      // startup SIGTRAP, or no diagnostic beyond the launch failure.
      const message = String(error.message)
      const isTransient = ['ETXTBSY', 'SIGTRAP', 'Process failed to launch']
        .some(value => message.includes(value))
      if (!isTransient || attempt === 2) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1000))
    }
  }
  const notifyPhase = async (phase, page) => {
    try {
      await options.onPhase?.(phase, page)
    } catch (error) {
      await electronApp.close().catch(() => {})
      throw error
    }
  }
  // Tests control WAN reachability independently of the host running them.
  // Page routes can override these replies to exercise real offline recovery.
  await electronApp.context().route(INTERNET_CHECK_URL, route => route.fulfill({ status: 204 }))
  await notifyPhase('electronConnected')

  const page = await electronApp.firstWindow()
  await notifyPhase('windowCreated', page)

  // Fail fast if dist-e2e contains a development build (it would load the
  // dev server on localhost instead of the bundled files). A transient
  // chrome-error page can appear under heavy parallel load - reload once.
  // waitUntil: 'commit' — under heavy parallel load reaching the full 'load'
  // state can take longer than the timeout even though the right URL is
  // already committed; waitForAppReady below covers actual usability.
  try {
    await page.waitForURL(/^app:\/\/bundle/, { timeout: 15_000, waitUntil: 'commit' })
  } catch {
    if (page.url().startsWith('chrome-error://')) {
      await page.reload().catch(() => {})
    }
    try {
      await page.waitForURL(/^app:\/\/bundle/, { timeout: 15_000, waitUntil: 'commit' })
    } catch {
      const url = page.url()
      await electronApp.close().catch(() => {})
      throw new Error(
        `Unexpected app URL ${url}. ${path.join(appRoot, 'dist-e2e')} must contain a production build`
      )
    }
  }
  await notifyPhase('routeCommitted', page)

  // Safety guard: if the userData override ever stops working, abort
  // instead of silently running tests against the user's real profile.
  const actualUserData = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  if (actualUserData !== userDataDir) {
    await electronApp.close().catch(() => {})
    throw new Error(
      `E2E userData isolation failed: expected ${userDataDir}, got ${actualUserData}. ` +
      'Did you run "pnpm run test:e2e:pack" after changing src/main?'
    )
  }

  await waitForAppReady(page)
  await notifyPhase('interactive', page)

  return { electronApp, page }
}

/**
 * Waits until the renderer has booted far enough to interact with.
 */
export async function waitForAppReady(page) {
  // The top nav is rendered once Vue has mounted and the locale has loaded.
  await expect(page.locator('.topNav')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.tabBar')).toBeVisible()
  await expect(page.locator('#startup-splash')).toHaveCount(0)
}

/** Opens a new app window through the tab bar's empty-space context menu. */
export async function openNewWindowFromTabBar(app, page) {
  const newWindowPromise = app.electronApp.waitForEvent('window')
  await page.locator(sel.newTabButton).click({ button: 'right' })
  await page.getByRole('menuitem', { name: /^New [Ww]indow$/ }).click()
  return newWindowPromise
}

/**
 * Attaches a screenshot to the HTML report, so visual behaviour can be
 * reviewed there instead of only on failure. Never fails the test: a
 * screenshot that can't be taken (e.g. the window is already closing) is
 * not worth losing the result over.
 *
 * Prefer the `attachScreenshot` fixture below, which binds page and testInfo.
 *
 * @param {import('@playwright/test').TestInfo} testInfo
 * @param {import('@playwright/test').Page} page
 * @param {string} name shown as the attachment's title in the report
 */
export async function attachScreenshot(testInfo, page, name) {
  try {
    await testInfo.attach(name, { body: await page.screenshot(), contentType: 'image/png' })
  } catch {
    // ignored on purpose, see above
  }
}

/** The renderer's current viewport size. */
export function getViewport(page) {
  return page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: window.innerHeight
  }))
}

/**
 * Resizes the window and waits until the renderer has laid out at the new
 * size, then returns the resulting viewport.
 *
 * @param {import('@playwright/test').ElectronApplication} electronApp
 * @param {import('@playwright/test').Page} page
 * @param {{ width: number, height: number }} size
 */
export async function setWindowSize({ electronApp }, page, size) {
  const before = await getViewport(page)

  await electronApp.evaluate(({ BrowserWindow }, bounds) => {
    const browserWindow = BrowserWindow.getAllWindows()[0]
    browserWindow.setBounds({ ...browserWindow.getBounds(), ...bounds })
  }, size)

  await expect.poll(async () => {
    const viewport = await getViewport(page)
    return viewport.width !== before.width && viewport.height !== before.height
  }).toBe(true)

  return await getViewport(page)
}

/**
 * Toggles player fullscreen and waits for the Fullscreen API state.
 *
 * @param {import('@playwright/test').Page} page
 * @param {boolean} fullscreen
 */
export async function setPlayerFullscreen(page, fullscreen) {
  const player = page.locator('.ftVideoPlayer')
  const isFullscreen = await player.evaluate((element) => document.fullscreenElement === element)

  if (isFullscreen !== fullscreen) {
    await page.evaluate(() => document.activeElement?.blur())
    await page.keyboard.press('f')
  }

  await expect.poll(
    async () => player.evaluate((element) => document.fullscreenElement === element)
  ).toBe(fullscreen)
}

/**
 * Base test with an `app` fixture that provides a freshly launched,
 * isolated app instance per test.
 *
 * Customize seeding per test file with:
 *   test.use({ seed: { settings: { ... }, history: [ ... ] } })
 * Use `localeOverrides` to replace packaged locale messages without changing
 * the shared dist-e2e output.
 */
export const test = base.extend({
  seed: [{}, { option: true }],
  launchArgs: [[], { option: true }],
  showTutorial: [false, { option: true }],
  localeOverrides: [{}, { option: true }],

  app: async ({ seed, launchArgs, showTutorial, localeOverrides }, use, testInfo) => {
    const userDataDir = await createUserDataDir(seed)
    const hasLocaleOverrides = Object.keys(localeOverrides).length > 0
    const appRoot = hasLocaleOverrides
      ? await mkdtemp(path.join(tmpdir(), 'opentubex-e2e-app-'))
      : repoRoot

    if (hasLocaleOverrides) {
      await cp(path.join(repoRoot, 'dist-e2e'), path.join(appRoot, 'dist-e2e'), {
        recursive: true
      })
      for (const [localePath, messages] of Object.entries(localeOverrides)) {
        const outputPath = path.join(
          appRoot,
          'dist-e2e',
          'static',
          'locales',
          `${localePath}.json.br`
        )
        await writeFile(outputPath, brotliCompressSync(JSON.stringify(messages)))
      }
    }

    const { electronApp, page } = await launchApp(userDataDir, launchArgs, { appRoot })

    if (!showTutorial) {
      const tutorial = page.locator('.tutorialOverlay')
      await expect(tutorial).toBeVisible()
      await tutorial.locator('.tutorialActions').getByRole('button').last().click()
      await expect(tutorial).toBeHidden()
    }

    const relaunch = async () => {
      // Wait until the old process has fully exited, otherwise it still owns
      // the single-instance lock for this userData dir and the new instance
      // immediately exits again.
      const oldProcess = appHandle.electronApp.process()
      const exited = new Promise((resolve) => oldProcess.once('exit', resolve))
      await appHandle.electronApp.close()
      await exited
      const next = await launchApp(userDataDir, launchArgs, { appRoot })
      appHandle.electronApp = next.electronApp
      appHandle.page = next.page
      return next
    }

    const appHandle = { electronApp, page, userDataDir, relaunch }

    try {
      await use(appHandle)
    } finally {
      if (testInfo.status !== testInfo.expectedStatus) {
        await attachScreenshot(testInfo, appHandle.page, 'failure')
      }
      await appHandle.electronApp.close().catch(() => {})
      await rm(userDataDir, { recursive: true, force: true })
      if (hasLocaleOverrides) {
        await rm(appRoot, { recursive: true, force: true })
      }
    }
  },

  /**
   * Attaches a named screenshot of the app window to the report:
   *   await attachScreenshot('subscriptions feed')
   */
  attachScreenshot: async ({ app }, use, testInfo) => {
    await use((name) => attachScreenshot(testInfo, app.page, name))
  },

  // Convenience: `page` resolves to the app's window.
  page: async ({ app }, use) => {
    await use(app.page)
  }
})

export { expect }

/**
 * Navigates via the side nav. Some routes appear twice in the side nav
 * (regular entry + "more options" flyout), so this clicks the first one.
 */
export async function goTo(page, route) {
  if (route === 'downloads') {
    const headerButton = page.locator('.topNav .downloadsButton')
    if (await headerButton.isVisible()) {
      await headerButton.click()
    } else {
      await page.locator('.profileTrigger').click()
      await page.locator('.quickSettingsMenu .downloadsShortcut').click()
    }
    await expect(page.getByRole('dialog', { name: 'Downloads', exact: true })).toBeVisible()
    return
  }

  if (route === 'settings') {
    await page.locator('.profileTrigger').click()
    await expect(page.locator('.quickSettingsMenu')).toBeVisible()
    await page.locator('.allSettingsShortcut').click()
    await expect(page.locator('.settingsWindow')).toBeVisible()
    await expect(page.locator('.quickSettingsMenu')).toBeHidden()
    return
  }

  const visibleLink = () => page.locator(`${sel.sideNavLink(route)}:visible`).first()
  if (await visibleLink().count() === 0) {
    // Entry lives in the "More" flyout in the collapsed side nav.
    await page.locator('.sideNav .moreOptionNav').click()
  }
  await visibleLink().click()
  await expect(page).toHaveURL(new RegExp(`#/${route}`))
}

const SETTINGS_CATEGORY_BY_LEGACY_SECTION = {
  theme: 'appearance',
  player: 'playback',
  'caption-appearance': 'playback',
  channel: 'playback',
  subscription: 'subscriptions',
  distraction: 'focus',
  'parental-control': 'focus',
  'sponsor-block': 'add-ons',
  'return-youtube-dislike': 'add-ons',
  'external-player': 'advanced',
  'external-software': 'advanced',
  proxy: 'advanced',
  'context-menu-search': 'general',
  storage: 'data',
  experimental: 'advanced'
}

/** Opens Settings and selects one category in the two-column modal layout. */
export async function goToSettingsSection(page, section) {
  if (!await page.locator('.settingsWindow').isVisible()) {
    await goTo(page, 'settings')
  }
  const category = SETTINGS_CATEGORY_BY_LEGACY_SECTION[section] ?? section
  await page.locator(`.settingsMenu [data-section="${category}"]`).click()
  const content = page.locator(`.settingsContent > [data-section="${category}"]`)
  await expect(content).toBeVisible()
  if (category === 'data' && ['data', 'storage'].includes(section)) {
    const tab = section === 'data' ? 'data' : 'storage'
    const tabButton = content.locator(`[data-settings-tab="${tab}"]`)
    await tabButton.click()
    await expect(tabButton).toHaveAttribute('aria-selected', 'true')
  }
  return content
}

/**
 * Starts collecting the CSS animations that play from here on. The classes that
 * trigger them are cleared once they have run, so waiting on the class instead
 * would be a race.
 *
 * @param {import('@playwright/test').Page} page
 */
export function recordAnimations(page) {
  return page.evaluate(() => {
    window.__playedAnimations = []
    document.addEventListener('animationstart', (event) => {
      window.__playedAnimations.push(event.animationName)
    }, true)
  })
}

/**
 * Waits for an animation recorded by `recordAnimations` to have played. Scoped
 * styles suffix the keyframes name with a hash, hence the prefix match.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 */
export function expectAnimation(page, name) {
  return expect.poll(() => page.evaluate(
    (animationName) => (window.__playedAnimations ?? []).some(played => played.startsWith(animationName)),
    name
  )).toBe(true)
}

/** Common locators, kept in one place so selector changes only hit here. */
export const sel = {
  searchInput: '.topNav .searchInput input.ft-input',
  sideNavLink: (route) => `.sideNav a[href="#/${route}"]`,
  tabs: '.tabBar .tab',
  activeTab: '.tabBar .tab.active',
  newTabButton: '.tabBar .newTabButton',
  tabOrganizerButton: '.tabBar .tabOrganizerButton',
  // Keyboard accelerators (Alt+Arrow) are handled by the Electron menu and
  // don't fire from synthesized input, so tests click these buttons instead.
  backButton: '.topNav button[title^="Back"]',
  forwardButton: '.topNav button[title^="Forward"]',
  video: 'video'
}
