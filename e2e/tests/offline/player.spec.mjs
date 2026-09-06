import { goTo, sel, setPlayerFullscreen, setWindowSize, test, expect } from '../../helpers/app.mjs'
import {
  activeTab,
  expectDockedToBottomRight,
  findWatchComponent,
  openMockedVideo,
  waitForPlayback,
} from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

// These used to live in the network suite, where they only ran when YouTube
// served both the watch page and a media stream. Everything they need is the
// player actually playing something, so they run against the local demo
// video and recorded metadata instead.

// yt-dlp isn't installed in the test environment, so its extraction attempt
// only costs time and puts a fallback toast over the player. The migration
// marker stops the store from switching the engine back on launch.
const PLAYER_SEED = {
  videoPlaybackEngine: 'built-in',
  ytDlpPlaybackEngineDefaultMigration: true
}

test.use({ seed: { settings: PLAYER_SEED } })

/**
 * @param {{ app: import('../../helpers/app.mjs').ElectronAppFixture, page: import('@playwright/test').Page }} fixtures
 */
async function openDemoVideo({ app, page }) {
  await mockPlayableWatchPage(app, page)
  return await openMockedVideo(page)
}

/** Scrolls the player out of view, which docks it as the scroll mini player. */
function scrollBelowPlayer(player) {
  return player.evaluate(element => {
    const rect = element.getBoundingClientRect()
    window.scrollTo(0, window.scrollY + rect.bottom)
  })
}

async function openCrossTabMiniPlayerOverWatchTab({ app, page }) {
  await openDemoVideo({ app, page })
  const firstTab = page.locator('.tabBar .tab').first()
  const firstTabId = await page.locator(activeTab).getAttribute('data-tab-id')

  await page.locator('.tabBar .newTabButton').click()
  await openDemoVideo({ app, page })
  const secondTab = page.locator('.tabBar .tab').nth(1)
  const secondTabId = await page.locator(activeTab).getAttribute('data-tab-id')

  await firstTab.click()
  const firstPlayer = page.locator(`.ftVideoPlayer[data-tab-id="${firstTabId}"]`)
  const firstVideo = firstPlayer.locator('video')
  await firstVideo.evaluate(element => element.play())
  await expect.poll(() => firstVideo.evaluate(element => element.paused)).toBe(false)

  await secondTab.click()
  const activePlayer = page.locator(`.ftVideoPlayer[data-tab-id="${secondTabId}"]`)
  await expect(firstPlayer).toHaveClass(/scrollMiniPlayer/)
  await expect(activePlayer).not.toHaveClass(/scrollMiniPlayer/)

  return { activePlayer, firstPlayer, firstVideo }
}

async function expectNoScrollMiniPlayerActivation(page, player, trigger) {
  await player.evaluate(element => {
    window.scrollMiniPlayerActivationCount = 0
    window.scrollMiniPlayerActivationObserver = new MutationObserver(() => {
      if (element.classList.contains('scrollMiniPlayer')) {
        window.scrollMiniPlayerActivationCount++
      }
    })
    window.scrollMiniPlayerActivationObserver.observe(element, { attributeFilter: ['class'] })
  })

  await trigger()
  await page.waitForTimeout(350)

  const activationCount = await page.evaluate(() => {
    window.scrollMiniPlayerActivationObserver.disconnect()
    const count = window.scrollMiniPlayerActivationCount
    delete window.scrollMiniPlayerActivationObserver
    delete window.scrollMiniPlayerActivationCount
    return count
  })
  expect(activationCount).toBe(0)
  await expect(player).not.toHaveClass(/scrollMiniPlayer/)
}

/** Asserts that the overlay owns a point where it intersects the detached player. */
async function expectOverlayAbovePlayer(player, overlay) {
  await expect(overlay).toBeVisible()
  const playerElement = await player.elementHandle()
  expect(playerElement).not.toBeNull()

  const result = await overlay.evaluate((overlayElement, playerElement) => {
    const overlayRect = overlayElement.getBoundingClientRect()
    const playerRect = playerElement.getBoundingClientRect()
    const left = Math.max(overlayRect.left, playerRect.left)
    const right = Math.min(overlayRect.right, playerRect.right)
    const top = Math.max(overlayRect.top, playerRect.top)
    const bottom = Math.min(overlayRect.bottom, playerRect.bottom)

    if (right <= left || bottom <= top) {
      return { intersects: false, overlayIsTopmost: false }
    }

    const topmost = document.elementFromPoint((left + right) / 2, (top + bottom) / 2)
    return {
      intersects: true,
      overlayIsTopmost: topmost !== null && overlayElement.contains(topmost)
    }
  }, playerElement)

  await playerElement.dispose()
  expect(result.intersects).toBe(true)
  expect(result.overlayIsTopmost).toBe(true)
}

test('playback starts', async ({ app, page, attachScreenshot }) => {
  const video = await openDemoVideo({ app, page })

  await expect
    .poll(() => video.evaluate((element) => element.currentTime), { timeout: 30_000 })
    .toBeGreaterThan(1)

  await attachScreenshot('playing video')
})

test('shows the replay icon when playback ends before Shaka updates its play icon', async ({ app, page }) => {
  const video = await openDemoVideo({ app, page })
  const watchComponent = await page.evaluateHandle(findWatchComponent)
  const replayIconPath = await watchComponent.evaluate(component => {
    return component.refs.player.$.setupState.replayIcon
  })
  const playButtons = page.locator(`${activeTab} .shaka-play-button`)
  const readPlayControls = () => playButtons.evaluateAll(buttons => buttons.map(button => ({
    state: button.getAttribute('data-ft-play-pause-state'),
    path: button.querySelector(
      ':scope > .shaka-ui-icon:not(.ft-play-pause-morph-icon) > path'
    )?.getAttribute('d')
  })))

  await watchComponent.evaluate(async component => {
    await component.proxy.$store.dispatch('updateDisplayVideoPlayButton', true)
    await component.proxy.$nextTick()
  })
  await expect(playButtons).toHaveCount(2)
  const initialControls = await readPlayControls()
  const pauseIconPath = initialControls[0].path
  expect(pauseIconPath).toBeTruthy()
  expect(initialControls.map(control => control.path)).toEqual([pauseIconPath, pauseIconPath])
  await video.evaluate(element => element.pause())
  await expect.poll(async () => (await readPlayControls()).map(control => control.state))
    .toEqual(['play', 'play'])

  await video.evaluate(element => {
    Object.defineProperty(element, 'ended', { configurable: true, value: true })
    element.dispatchEvent(new Event('ended'))
  })

  await expect.poll(readPlayControls).toEqual([
    { state: 'replay', path: replayIconPath },
    { state: 'replay', path: replayIconPath }
  ])

  await video.evaluate(async element => {
    delete element.ended
    element.currentTime = 0
    await element.play()
  })
  await expect.poll(readPlayControls).toEqual([
    { state: 'pause', path: pauseIconPath },
    { state: 'pause', path: pauseIconPath }
  ])
  await watchComponent.dispose()
})

test('does not restore a consumed link timestamp after an app restart', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw&t=2')
  const timestampNavigation = page.waitForURL(/#\/watch\/jNQXAC9IVRw\?timestamp=2/)
  await page.locator(sel.searchInput).press('Enter')

  await timestampNavigation
  const video = await waitForPlayback(page)
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(2)
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw$/)
  await expect(page.locator('.tab.active .tabTitleText')).toHaveText('Me at the zoo')
  await expect(page).toHaveTitle('Me at the zoo - OpenTubeX')

  ;({ page } = await app.relaunch())
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw$/)
  await expect(page.locator('.tab.active .tabTitleText')).toHaveText('Me at the zoo')
  await expect(page).toHaveTitle('Me at the zoo - OpenTubeX')
})

test('a timestamped video stays paused when the window loses focus', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw&t=2')
  await page.locator(sel.searchInput).press('Enter')

  const video = await waitForPlayback(page)
  await video.evaluate(element => element.pause())
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(true)

  await app.electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].emit('blur')
  })
  await page.waitForTimeout(2000)

  expect(await video.evaluate(element => element.paused)).toBe(true)
})

test('a Short opened in a background tab never starts playback', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.evaluate(() => {
    window.__backgroundShortPlaybackEvents = []
    for (const type of ['play', 'playing']) {
      document.addEventListener(type, (event) => {
        const tabContent = event.target.closest('.tabContent')
        if (tabContent?.getAttribute('aria-hidden') === 'true') {
          window.__backgroundShortPlaybackEvents.push(type)
        }
      }, true)
    }
  })

  const backgroundTab = await page.evaluate(() => window.ftElectron.tabs.create({
    route: '/watch/background-short?short=true',
    title: 'Background Short',
    makeActive: false,
    preloadInBackground: true
  }))
  const backgroundVideo = page.locator(`.tabContent[data-tab-id="${backgroundTab.id}"] video`)

  await expect(backgroundVideo).toHaveCount(1, { timeout: 30_000 })
  await expect.poll(() => backgroundVideo.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2)
  await page.waitForTimeout(1000)

  expect(await page.evaluate(() => window.__backgroundShortPlaybackEvents)).toEqual([])
  expect(await backgroundVideo.evaluate(element => ({
    paused: element.paused,
    currentTime: element.currentTime
  }))).toEqual({ paused: true, currentTime: 0 })
})

test('hides configured paused interface elements until pointer activity', async ({ app, page }) => {
  const video = await openDemoVideo({ app, page })
  const watchComponent = await page.evaluateHandle(findWatchComponent)
  await watchComponent.evaluate(async (component) => {
    await Promise.all([
      component.proxy.$store.dispatch('updateShowPlayerControlsWhenPaused', false),
      component.proxy.$store.dispatch('updateShowVideoTitleWhenPaused', false),
      component.proxy.$store.dispatch('updateShowFullscreenActionsWhenPaused', false),
      component.proxy.$store.dispatch('updatePausedInterfaceHideDelay', 0.5),
    ])
    await component.proxy.$nextTick()
  })

  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  const title = player.locator('.playerFullscreenTitleOverlay')
  const actions = player.locator('.fullscreenActions')
  const controls = player.locator('.shaka-controls-button-panel')
  const seekBar = player.locator('.shaka-seek-bar-container')

  await page.locator('body').press('s')
  await expect(player).toHaveClass(/fullWindow/)
  await video.evaluate(element => element.pause())
  await expect(player).toHaveClass(/playerPaused/)
  await expect(title).toHaveCSS('opacity', '0')
  await expect(actions).toHaveCSS('opacity', '0')
  await expect(controls).toHaveCSS('opacity', '0')
  await expect(seekBar).toHaveCSS('opacity', '0')
  await expect(seekBar).toHaveCSS('pointer-events', 'none')

  const playerBounds = await player.boundingBox()
  await page.mouse.move(
    playerBounds.x + playerBounds.width / 2,
    playerBounds.y + playerBounds.height / 2
  )
  await expect(player).toHaveClass(/pausedInterfaceRevealed/)
  await expect(title).toHaveCSS('opacity', '1')
  await expect(actions).toHaveCSS('opacity', '1')
  await expect(seekBar).toHaveCSS('opacity', '1')

  await expect(player).not.toHaveClass(/pausedInterfaceRevealed/, { timeout: 1500 })
  await expect(title).toHaveCSS('opacity', '0')
  await expect(actions).toHaveCSS('opacity', '0')
  await expect(controls).toHaveCSS('opacity', '0')
  await expect(seekBar).toHaveCSS('opacity', '0')
  await watchComponent.dispose()
})

test('hides the tab play indicator while buffering', async ({ app, page, attachScreenshot }) => {
  const video = await openDemoVideo({ app, page })

  const tabBarTab = page.locator('.tabBar .tab.active')
  await expect(tabBarTab.locator('.playingIcon')).toBeVisible()
  await attachScreenshot('tab play indicator')

  await video.dispatchEvent('waiting')
  await expect(tabBarTab.locator('.playingIcon')).toHaveCount(0)
  await attachScreenshot('tab while buffering')

  await video.dispatchEvent('playing')
  await expect(tabBarTab.locator('.playingIcon')).toBeVisible()
})

// Regression: playback speed controls stopped working (1c958d468)
test('keyboard shortcuts change the playback rate', async ({ app, page, attachScreenshot }) => {
  const video = await openDemoVideo({ app, page })

  await page.locator('body').press('p')
  await expect.poll(() => video.evaluate((element) => element.playbackRate)).toBeGreaterThan(1)
  await attachScreenshot('playback rate raised')
  const raisedRate = await video.evaluate((element) => element.playbackRate)

  await page.locator('body').press('o')
  await expect.poll(() => video.evaluate((element) => element.playbackRate)).toBeLessThan(raisedRate)
  await attachScreenshot('playback rate lowered')
})

test('player shortcuts do not run while typing in a focused select', async ({ app, page }) => {
  const video = await openDemoVideo({ app, page })
  await goTo(page, 'settings')

  const region = page.getByRole('combobox', { name: 'Region for Trending' })
  await region.focus()
  await expect(region).toHaveAttribute('aria-expanded', 'false')
  await region.pressSequentially('kenya')
  await expect(region.locator('.selectedValue')).toHaveText('Kenya')
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)

  await region.click()
  await expect(region).toHaveAttribute('aria-expanded', 'true')

  await region.pressSequentially('kenya')

  await expect(region).toHaveAttribute('aria-activedescendant', /-option-\d+$/)
  const activeOptionId = await region.getAttribute('aria-activedescendant')
  await expect(page.locator(`#${activeOptionId}`)).toHaveText('Kenya')
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)
})

test('playback rate shortcuts use the normal rate while hold-to-double is active', async ({ app, page }) => {
  const video = await openDemoVideo({ app, page })

  await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(1)
  await page.keyboard.down('Space')
  try {
    await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(2)
    await page.locator('body').press('p')
    await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(1.25)
  } finally {
    await page.keyboard.up('Space')
  }
})

test('keeps video zoom within its tab', async ({ app, page, attachScreenshot }) => {
  const video = await openDemoVideo({ app, page })

  await page.locator('body').press('z')
  await expect(video).toHaveCSS('transform', 'matrix(1.25, 0, 0, 1.25, 0, 0)')
  await attachScreenshot('zoomed video')

  await page.locator('body').press('z')
  await expect(video).toHaveCSS('transform', 'matrix(1.5, 0, 0, 1.5, 0, 0)')

  // Recreating the player for another video in the same tab keeps that tab's
  // zoom level.
  const nextVideoInTab = await openMockedVideo(page, 'aqz-KE-bpKQ')
  await expect(nextVideoInTab).toHaveCSS('transform', 'matrix(1.5, 0, 0, 1.5, 0, 0)')

  // A new tab starts at the default zoom instead of inheriting another
  // player's level.
  await page.locator('.tabBar .newTabButton').click()
  await expect(page.locator('.tabBar .tab')).toHaveCount(2)
  const nextVideo = await openMockedVideo(page)
  await expect(nextVideo).toHaveCSS('transform', 'none')

  await page.locator('body').press('z')
  await expect(nextVideo).toHaveCSS('transform', 'matrix(1.25, 0, 0, 1.25, 0, 0)')

  const tabs = page.locator('.tabBar .tab')
  await tabs.first().click()
  await expect(page.locator(`${activeTab} video`)).toHaveCSS('transform', 'matrix(1.5, 0, 0, 1.5, 0, 0)')

  await tabs.last().click()
  await expect(page.locator(`${activeTab} video`)).toHaveCSS('transform', 'matrix(1.25, 0, 0, 1.25, 0, 0)')
})

test('smoothly transitions video zoom at fractional UI scale', async ({ app, page }) => {
  const video = await openDemoVideo({ app, page })
  await page.evaluate(() => window.ftElectron.setZoomFactor(0.95))

  await page.locator('body').press('z')
  const zoomTransition = await video.evaluateHandle((element) => {
    const transition = element.getAnimations().find(animation =>
      animation instanceof CSSTransition && animation.transitionProperty === 'transform'
    )

    if (!transition) {
      throw new Error('Video zoom transition not found')
    }

    transition.pause()
    return transition
  })

  expect(await zoomTransition.evaluate(transition => transition.effect.getTiming())).toMatchObject({
    duration: 200,
    easing: 'ease-out',
  })
  await zoomTransition.evaluate(transition => { transition.currentTime = 100 })
  const intermediateScale = await video.evaluate((element) => {
    return new DOMMatrix(getComputedStyle(element).transform).a
  })
  expect(intermediateScale).toBeGreaterThan(1)
  expect(intermediateScale).toBeLessThan(1.25)

  await zoomTransition.dispose()

  // A new choice replaces the in-flight transition and becomes its final state.
  await page.locator('body').press('z')
  await expect(video).toHaveCSS('transform', 'matrix(1.5, 0, 0, 1.5, 0, 0)')

  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return store.dispatch('updateReducedMotion', 'on')
  })
  await page.locator('body').press('Shift+Z')
  await page.locator('body').press('Shift+Z')
  await expect(video).toHaveCSS('transform', 'none')
  expect(await video.evaluate((element) => {
    return element.getAnimations().some(animation =>
      animation instanceof CSSTransition && animation.transitionProperty === 'transform'
    )
  })).toBe(false)
})

test('shift-dragging moves the visible part of a zoomed video', async ({ app, page, attachScreenshot }) => {
  const video = await openDemoVideo({ app, page })
  const readTranslation = () => video.evaluate((element) => {
    const { m41, m42 } = new DOMMatrix(getComputedStyle(element).transform)
    return { x: m41, y: m42 }
  })

  await page.locator('body').press('z')
  await page.locator('body').press('z')
  expect(await readTranslation()).toEqual({ x: 0, y: 0 })

  const box = await video.boundingBox()
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

  await page.keyboard.down('Shift')
  await page.mouse.move(center.x, center.y)
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  await expect(player).toHaveClass(/videoZoomPannable/)

  await page.mouse.down()
  await page.mouse.move(center.x - 120, center.y - 40, { steps: 4 })
  await expect(player).toHaveClass(/videoZoomPanning/)
  expect(await video.evaluate((element) => {
    return element.getAnimations().some(animation =>
      animation instanceof CSSTransition && animation.transitionProperty === 'transform'
    )
  })).toBe(false)
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await attachScreenshot('panned video')

  const panned = await readTranslation()
  expect(panned.x).toBeLessThan(0)
  expect(panned.y).toBeLessThan(0)

  // Panning must not double as a play/pause click
  expect(await video.evaluate((element) => element.paused)).toBe(false)

  // Turning the zoom off recenters the video
  await page.locator('body').press('Shift+Z')
  await page.locator('body').press('Shift+Z')
  await expect(video).toHaveCSS('transform', 'none')
})

test('pinch zoom starts over the paused player controls without toggling playback', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return store.dispatch('updateDisplayVideoPlayButton', true)
  })
  const video = await openMockedVideo(page)
  await page.evaluate(() => window.ftElectron.setZoomFactor(0.95))
  await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBeCloseTo(0.95, 2)
  await page.locator('.app').evaluate(element => element.classList.add('capacitorTabs'))

  for (let step = 0; step < 4; step++) await page.locator('body').press('z')
  await expect(video).toHaveCSS('transform', 'matrix(2, 0, 0, 2, 0, 0)')
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  await expect(player).toHaveCSS('touch-action', 'none')
  const zoomedBox = await video.boundingBox()
  await page.keyboard.down('Shift')
  await page.mouse.move(zoomedBox.x + zoomedBox.width / 2, zoomedBox.y + zoomedBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(zoomedBox.x + zoomedBox.width / 2 - 60, zoomedBox.y + zoomedBox.height / 2)
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await video.evaluate(element => element.pause())

  const playIcon = player.locator('.shaka-big-buttons-container .shaka-play-button path').first()
  await expect(playIcon).toBeVisible()
  const [iconBox, playerBox] = await Promise.all([
    playIcon.boundingBox(),
    player.boundingBox(),
  ])
  const first = {
    x: iconBox.x + iconBox.width / 2,
    y: iconBox.y + iconBox.height / 2,
  }
  const second = {
    x: Math.min(first.x + 70, playerBox.x + playerBox.width - 20),
    y: first.y,
  }
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, first)).toBe('path')

  const startGeometry = await video.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    const matrix = new DOMMatrix(getComputedStyle(element).transform)
    return {
      zoom: matrix.a,
      translation: { x: matrix.e, y: matrix.f },
      center: {
        x: bounds.left + bounds.width / 2 - matrix.e,
        y: bounds.top + bounds.height / 2 - matrix.f,
      },
    }
  })
  await player.evaluate(element => {
    const pointers = { start: new Map(), current: new Map(), pinchStart: null }
    globalThis.__playerPinchTestPointers = pointers
    element.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'touch') return
      const point = { x: event.clientX, y: event.clientY }
      pointers.start.set(event.pointerId, point)
      pointers.current.set(event.pointerId, point)
      if (pointers.current.size === 2) {
        pointers.pinchStart = [...pointers.current.values()]
      }
    }, true)
    element.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch') {
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      }
    }, true)
  })

  const session = await page.context().newCDPSession(page)
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ ...first, id: 1 }],
  })
  await page.waitForTimeout(200)
  const firstAtPinch = { x: first.x + 12, y: first.y, id: 1 }
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [firstAtPinch],
  })
  await page.waitForTimeout(80)
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [firstAtPinch, { ...second, id: 2 }],
  })
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: firstAtPinch.x - 50, y: firstAtPinch.y, id: 1 },
      { x: second.x + 50, y: second.y, id: 2 },
    ],
  })

  await expect.poll(() => video.evaluate(element => {
    return new DOMMatrix(getComputedStyle(element).transform).a
  })).toBeGreaterThan(startGeometry.zoom)
  const pinchTransform = await video.evaluate(element => {
    const { a: scale, e: x, f: y } = new DOMMatrix(getComputedStyle(element).transform)
    return { scale, x, y }
  })
  const pointerCoordinates = await page.evaluate(() => {
    const pointers = globalThis.__playerPinchTestPointers
    return {
      start: [...pointers.start.values()],
      current: [...pointers.current.values()],
      pinchStart: pointers.pinchStart,
    }
  })
  expect(pointerCoordinates.start).toHaveLength(2)
  expect(pointerCoordinates.current).toHaveLength(2)
  expect(pointerCoordinates.pinchStart).toHaveLength(2)
  const startFocal = {
    x: (pointerCoordinates.pinchStart[0].x + pointerCoordinates.pinchStart[1].x) / 2 - startGeometry.center.x,
    y: (pointerCoordinates.pinchStart[0].y + pointerCoordinates.pinchStart[1].y) / 2 - startGeometry.center.y,
  }
  const currentFocal = {
    x: (pointerCoordinates.current[0].x + pointerCoordinates.current[1].x) / 2 - startGeometry.center.x,
    y: (pointerCoordinates.current[0].y + pointerCoordinates.current[1].y) / 2 - startGeometry.center.y,
  }
  const content = {
    x: (startFocal.x - startGeometry.translation.x) / startGeometry.zoom,
    y: (startFocal.y - startGeometry.translation.y) / startGeometry.zoom,
  }
  expect(pinchTransform.scale).toBeGreaterThan(1)
  expect(pinchTransform.x).toBeCloseTo(currentFocal.x - pinchTransform.scale * content.x, 0)
  expect(pinchTransform.y).toBeCloseTo(currentFocal.y - pinchTransform.scale * content.y, 0)

  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await session.detach()

  const persistedTransform = await video.evaluate(element => {
    const { a: scale, e: x, f: y } = new DOMMatrix(getComputedStyle(element).transform)
    return { scale, x, y }
  })
  expect(persistedTransform.scale).toBeCloseTo(pinchTransform.scale, 4)
  expect(persistedTransform.x).toBeCloseTo(currentFocal.x - persistedTransform.scale * content.x, 0)
  expect(persistedTransform.y).toBeCloseTo(currentFocal.y - persistedTransform.scale * content.y, 0)
  await expect(player.locator('.video-zoom-button')).toHaveAttribute(
    'shaka-status',
    `${Math.round(persistedTransform.scale * 100)}%`
  )
  expect(await video.evaluate(element => element.paused)).toBe(true)

  await player.locator('.shaka-big-buttons-container .shaka-play-button').click()
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)
})

test('the overflow menu can turn the zoom off again', async ({ app, page, attachScreenshot }) => {
  const video = await openDemoVideo({ app, page })

  await page.locator('body').press('z')
  await expect(video).toHaveCSS('transform', 'matrix(1.25, 0, 0, 1.25, 0, 0)')

  // The control panel is hidden until the pointer is over the player
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  await player.hover()
  const moreOptions = player.getByRole('button', { name: 'More settings' })
  await expect(moreOptions).toBeVisible()
  await moreOptions.click()

  const overflowMenu = player.locator('.shaka-overflow-menu')
  await expect(overflowMenu).toHaveClass(/ft-menu-grid/)
  await expect(overflowMenu).toHaveCSS('display', 'grid')
  await expect(overflowMenu).toHaveCSS('overscroll-behavior', 'contain')
  await expect(overflowMenu.locator(':scope > .os-scrollbar-vertical')).toHaveCount(1)
  expect(await overflowMenu.locator(':scope > button').evaluateAll((buttons) => {
    return buttons.every((button) => getComputedStyle(button).flexDirection === 'column')
  })).toBe(true)
  const statusTypography = await overflowMenu.evaluate((menu) => {
    // The local fixture uses a legacy format, so reproduce Shaka's additional
    // wrapper around the standard resolution status in the live menu.
    const button = document.createElement('button')
    button.innerHTML = `
      <label class="shaka-overflow-button-label">
        <span><span class="shaka-current-selection-span">1080p60</span></span>
      </label>`
    menu.append(button)

    const resolutionStatus = button.querySelector('.shaka-current-selection-span')
    const playbackRateStatus = menu.querySelector(
      '.shaka-playbackrate-button .shaka-current-selection-span'
    )
    const typography = (element) => {
      const { color, fontSize, opacity } = getComputedStyle(element)
      return { color, fontSize, opacity }
    }
    const result = [typography(resolutionStatus), typography(playbackRateStatus)]
    button.remove()
    return result
  })
  expect(statusTypography[0]).toEqual(statusTypography[1])
  expect(statusTypography[0]).toMatchObject({ fontSize: '10px', opacity: '0.75' })
  const overflowMenuHeight = (await overflowMenu.boundingBox()).height

  await overflowMenu.getByRole('button', { name: 'Zoom' }).click()
  const zoomMenu = player.locator('.video-zoom-menu')
  await expect(zoomMenu).toHaveClass(/ft-menu-grid/)
  await expect(zoomMenu).toHaveCSS('flex-wrap', 'wrap')
  expect((await overflowMenu.boundingBox()).height).toBe(overflowMenuHeight)
  const zoomHeader = zoomMenu.locator('.shaka-back-to-overflow-button')
  const zoomHeaderTitle = zoomHeader.getByText('Zoom')
  const [headerBox, titleBox] = await Promise.all([
    zoomHeader.boundingBox(),
    zoomHeaderTitle.boundingBox(),
  ])
  expect(Math.abs(
    (headerBox.x + headerBox.width / 2) - (titleBox.x + titleBox.width / 2)
  )).toBeLessThanOrEqual(1)
  expect(await zoomMenu.evaluate((menu) => {
    // Caption tracks are not part of the local media fixture. Recreate its
    // Options action in another submenu to verify the shared grid geometry.
    const options = document.createElement('button')
    options.className = 'ft-caption-options-button'
    options.textContent = 'Options'
    menu.append(options)

    const header = menu.querySelector('.shaka-back-to-overflow-button')
    const headerBox = header.getBoundingClientRect()
    const optionsBox = options.getBoundingClientRect()
    options.remove()

    return Math.abs(
      (headerBox.top + headerBox.height / 2) - (optionsBox.top + optionsBox.height / 2)
    )
  })).toBeLessThanOrEqual(1)
  await attachScreenshot('zoom menu')

  await zoomMenu.getByRole('button', { name: 'Off' }).click()
  await expect(video).toHaveCSS('transform', 'none')

  // A narrow player folds Autoplay into the overflow menu.
  await player.evaluate(element => { element.style.width = '600px' })
  const autoplaySwitch = overflowMenu.locator('.autoplay-toggle > .ft-autoplay-switch')
  await moreOptions.click()
  await expect(autoplaySwitch).toBeVisible()
  await expect(autoplaySwitch).toHaveCSS('margin-right', '0px')

  const watchComponent = await page.evaluateHandle(findWatchComponent)
  await watchComponent.evaluate(async (component) => {
    await component.proxy.$store.dispatch('updateUsePlayerMenuGrid', false)
    await component.proxy.$nextTick()
  })
  await player.hover()
  await moreOptions.click()
  await expect(overflowMenu).not.toHaveClass(/ft-menu-grid/)
  await expect(overflowMenu.locator(':scope > .os-scrollbar-vertical')).toHaveCount(1)
  await expect(autoplaySwitch).toHaveCSS('margin-right', '14px')
  await watchComponent.dispose()
})

for (const uiScale of [100, 95]) {
  test.describe(`mobile player menus at ${uiScale}% UI scale`, () => {
    test.use({ seed: { settings: { ...PLAYER_SEED, uiScale } } })

    test('options and submenus stay above the center play button', async ({ app, page, attachScreenshot }) => {
      await mockPlayableWatchPage(app, page)
      await page.locator('.app').evaluate(element => {
        const applyMobileClass = () => element.classList.add('capacitorTabs')
        new MutationObserver(() => {
          if (!element.classList.contains('capacitorTabs')) applyMobileClass()
        }).observe(element, { attributeFilter: ['class'] })
        applyMobileClass()
      })
      const video = await openMockedVideo(page)
      await video.evaluate(element => element.pause())
      await setWindowSize(app, page, { width: 450, height: 850 })

      const player = page.locator(`${activeTab} .ftVideoPlayer`)
      const centerButton = player.locator('.shaka-big-buttons-container .shaka-play-button')
      await player.hover()
      await expect(centerButton).toBeVisible()
      await player.getByRole('button', { name: 'More settings' }).click()
      const menu = player.locator('.shaka-overflow-menu')
      await attachScreenshot('mobile options menu above center play button')
      await expectOverlayAbovePlayer(centerButton, menu)

      await menu.getByRole('button', { name: 'Zoom' }).click()
      const submenu = player.locator('.video-zoom-menu')
      await expectOverlayAbovePlayer(centerButton, submenu)
      await submenu.getByRole('button', { name: 'Off', exact: true }).click()
      await expect(submenu).toBeHidden()
      await expect(menu).toBeVisible()
      await player.getByRole('button', { name: 'More settings' }).click()
      await expect(menu).toBeHidden()
      await centerButton.click()
      await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)
    })
  })
}

test('mobile fullscreen keeps menus and SponsorBlock notices above the action dock', async ({ app, page }) => {
  await openDemoVideo({ app, page })
  await page.locator('.app').evaluate(element => element.classList.add('capacitorTabs'))

  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  const actions = player.locator('.fullscreenActions')
  await page.locator('body').press('s')
  await player.hover()
  await expect(actions).toBeVisible()

  await player.getByRole('button', { name: 'More settings' }).click()
  await player.locator('.shaka-overflow-menu').getByRole('button', { name: 'Zoom' }).click()
  await expect(player.locator('.video-zoom-menu')).toBeVisible()
  await expect(actions).toHaveCSS('opacity', '0')
  await expect(actions).toHaveCSS('pointer-events', 'none')

  const layers = await player.evaluate(element => {
    const notice = document.createElement('div')
    notice.className = 'skippedSegmentsWrapper'
    element.append(notice)
    const result = {
      actions: Number(getComputedStyle(element.querySelector('.fullscreenActions')).zIndex),
      notice: Number(getComputedStyle(notice).zIndex),
      controls: Number(getComputedStyle(element.querySelector('.shaka-controls-container')).zIndex),
    }
    notice.remove()
    return result
  })
  expect(layers.notice).toBeGreaterThan(layers.actions)
  expect(layers.controls).toBeGreaterThan(layers.notice)
})

/**
 * @param {{ app: import('../../helpers/app.mjs').ElectronAppFixture, page: import('@playwright/test').Page }} fixtures
 */
async function expectEllipsizedPlayerMenuLabelTitles({ app, page }) {
  await openDemoVideo({ app, page })

  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  await player.hover()
  await player.getByRole('button', { name: 'More settings' }).click()

  const overflowMenu = player.locator('.shaka-overflow-menu')
  const zoomButton = overflowMenu.getByRole('button', { name: 'Zoom' })
  const expectFullTextOnHover = async (label, fullText) => {
    const isOverflowing = () => label.evaluate((element) => {
      return element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth
    })

    await label.evaluate((element, text) => { element.textContent = text }, fullText)
    expect(await isOverflowing()).toBe(true)
    await expect(label).toHaveAttribute('title', fullText, { timeout: 1000 })
    await label.hover()

    await label.evaluate((element) => { element.textContent = 'Short label' })
    expect(await isOverflowing()).toBe(false)
    await expect(label).not.toHaveAttribute('title', { timeout: 1000 })
  }

  await expectFullTextOnHover(
    zoomButton.locator('.shaka-overflow-button-label > span').first(),
    'Zoom to a very long player menu option that cannot fit in its tile'
  )

  await zoomButton.click()
  await expectFullTextOnHover(
    player.locator('.video-zoom-menu > button:not(.shaka-back-to-overflow-button) > span').first(),
    'An unusually long submenu option like the descriptive audio tracks'
  )
}

test('ellipsized player menu labels expose their full text on hover', expectEllipsizedPlayerMenuLabelTitles)

test.describe('at 125% display scale', () => {
  test.use({ launchArgs: ['--force-device-scale-factor=1.25'] })

  test(
    'ellipsized player menu labels expose their full text on hover',
    expectEllipsizedPlayerMenuLabelTitles
  )
})

test('auto-translates captions into an arbitrary language', async ({ app, page, attachScreenshot }) => {
  await mockPlayableWatchPage(app, page, { captionTranslations: true })
  await openMockedVideo(page)

  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  await player.hover()
  const moreOptions = player.getByRole('button', { name: 'More settings' })
  await moreOptions.click()

  const overflowMenu = player.locator('.shaka-overflow-menu')
  await overflowMenu.getByRole('button', { name: 'Captions' }).click()
  await player.locator('.shaka-text-languages').getByRole('button', { name: 'Auto-translate' }).click()

  const translationMenu = player.locator('.ft-caption-translation-menu')
  const header = translationMenu.locator(':scope > .shaka-back-to-overflow-button')
  const translations = translationMenu.locator('.ft-caption-translation-options')
  await expect(translationMenu).toBeVisible()
  await expect(translations).toHaveClass(/ft-menu-grid/)
  await expect(translations.locator(':scope > .os-scrollbar-vertical')).toHaveCount(1)
  await expect(overflowMenu.locator(':scope > .os-scrollbar-vertical')).toHaveCSS('display', 'none')
  expect(await translations.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)

  const [headerBounds, translationsBounds, scrollbarBounds] = await Promise.all([
    header.boundingBox(),
    translations.boundingBox(),
    translations.locator(':scope > .os-scrollbar-vertical').boundingBox(),
  ])
  expect(translationsBounds.y).toBeGreaterThanOrEqual(headerBounds.y + headerBounds.height - 1)
  expect(scrollbarBounds.y).toBeGreaterThanOrEqual(translationsBounds.y - 1)

  await translations.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => translations.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await attachScreenshot('auto-translate language grid')

  const frenchResponse = page.waitForResponse(response => {
    const url = new URL(response.url())
    return url.pathname === '/api/timedtext' && url.searchParams.get('tlang') === 'fr'
  })
  await translations.getByRole('button', { name: 'French' }).click()
  await translations.getByRole('button', { name: 'German' }).click()
  await expect(player.locator('.shaka-text-languages')).toBeVisible()
  expect(await overflowMenu.evaluate(element => element.scrollTop)).toBe(0)
  await expect(player.locator('.shaka-text-languages')).toContainText('German')
  await frenchResponse
  await expect(player.locator('.shaka-text-languages')).toContainText('German')

  const watchComponent = await page.evaluateHandle(findWatchComponent)
  await watchComponent.evaluate(async (component) => {
    await component.proxy.$store.dispatch('updateUsePlayerMenuGrid', false)
    await component.proxy.$nextTick()
  })
  await page.keyboard.press('Escape')
  await player.hover()
  await moreOptions.click()
  await overflowMenu.getByRole('button', { name: 'Captions' }).click()
  await player.locator('.shaka-text-languages').getByRole('button', { name: 'Auto-translate' }).click()
  await expect(translations).not.toHaveClass(/ft-menu-grid/)
  const selectedTranslation = translations.getByRole('button', { name: 'German' })
  await expect(selectedTranslation).toHaveAttribute('aria-selected', 'true')
  await expect(selectedTranslation.locator('.shaka-chosen-item')).toHaveCount(2)

  const [listBounds, languageBounds] = await Promise.all([
    translations.boundingBox(),
    translations.getByRole('button', { name: 'Afrikaans' }).boundingBox(),
  ])
  expect(Math.abs(languageBounds.x - listBounds.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(languageBounds.width - listBounds.width)).toBeLessThanOrEqual(1)

  await header.click()
  const captionsMenu = player.locator('.shaka-text-languages')
  await captionsMenu.getByRole('button', { name: 'Off' }).click()
  await overflowMenu.getByRole('button', { name: 'Captions' }).click()
  await captionsMenu.getByRole('button', { name: 'Auto-translate' }).click()
  await expect(selectedTranslation).toHaveAttribute('aria-selected', 'false')
  await expect(selectedTranslation.locator('.shaka-chosen-item')).toHaveCount(0)

  await header.click()
  await captionsMenu.getByRole('button', { name: 'English (auto-generated)', exact: true }).click()
  await overflowMenu.getByRole('button', { name: 'Captions' }).click()
  await captionsMenu.getByRole('button', { name: 'Auto-translate' }).click()
  await expect(selectedTranslation).toHaveAttribute('aria-selected', 'false')
  await expect(selectedTranslation.locator('.shaka-chosen-item')).toHaveCount(0)

  const nextVideoId = 'aqz-KE-bpKQ'
  await openMockedVideo(page, nextVideoId)
  await player.hover()
  await moreOptions.click()
  await overflowMenu.getByRole('button', { name: 'Captions' }).click()
  await player.locator('.shaka-text-languages').getByRole('button', { name: 'Auto-translate' }).click()
  const nextVideoTranslationRequest = page.waitForRequest(request => {
    const url = new URL(request.url())
    return url.pathname === '/api/timedtext' &&
      url.searchParams.get('v') === nextVideoId &&
      url.searchParams.get('tlang') === 'de'
  })
  await translations.getByRole('button', { name: 'German' }).click()
  await nextVideoTranslationRequest
  await watchComponent.dispose()
})

test('video zoom can be disabled', async ({ app, page }) => {
  const video = await openDemoVideo({ app, page })

  await page.locator('body').press('z')
  await expect(video).toHaveCSS('transform', 'matrix(1.25, 0, 0, 1.25, 0, 0)')

  const watchComponent = await page.evaluateHandle(findWatchComponent)
  await watchComponent.evaluate(async (component) => {
    await component.proxy.$store.dispatch('updateEnableVideoZoom', false)
    await component.proxy.$nextTick()
  })
  await expect(video).toHaveCSS('transform', 'none')

  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  await player.hover()
  await player.getByRole('button', { name: 'More settings' }).click()
  await expect(player.locator('.shaka-overflow-menu').getByRole('button', { name: 'Zoom' }))
    .toHaveCount(0)

  await page.keyboard.press('Escape')
  await page.locator('body').press('z')
  await expect(video).toHaveCSS('transform', 'none')

  await watchComponent.evaluate(async (component) => {
    await component.proxy.$store.dispatch('updateEnableVideoZoom', true)
    await component.proxy.$nextTick()
  })
  await expect(video).toHaveCSS('transform', 'matrix(1.25, 0, 0, 1.25, 0, 0)')
  await watchComponent.dispose()
})

test('keeps the context menu open when the pointer leaves a playing video', async ({ app, page, attachScreenshot }) => {
  await openDemoVideo({ app, page })
  await page.locator('.ftVideoPlayer').click({ button: 'right' })

  const contextMenu = page.locator('.shaka-context-menu')
  await expect(contextMenu).toBeVisible()
  await attachScreenshot('player context menu')

  await page.mouse.move(0, 0)
  await page.waitForTimeout(3500)
  await expect(contextMenu).toBeVisible()
  await attachScreenshot('context menu after the pointer left')
})

test('scopes the mobile fullscreen swipe movement to the video in tablet layout', async ({ app, page }) => {
  const video = await openDemoVideo({ app, page })
  const appRoot = page.locator('.app')
  const player = page.locator(`${activeTab} .ftVideoPlayer`)

  await appRoot.evaluate(element => element.classList.add('capacitorTabs', 'capacitorTabletLayout'))
  await expect(appRoot).toHaveCSS('touch-action', 'auto')
  await expect(player).toHaveClass(/mobileFullscreenSwipeEnabled/)
  await expect(player).toHaveCSS('touch-action', 'none')

  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateEnableVideoZoom', false)
  })
  await expect(player).toHaveCSS('touch-action', 'pan-x')

  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateEnableMobileFullscreenSwipe', false)
  })
  await expect(player).not.toHaveClass(/mobileFullscreenSwipeEnabled/)
  await expect(player).toHaveCSS('touch-action', 'auto')

  await player.evaluate(element => {
    element.classList.add('mobileFullscreenSwiping')
    element.style.setProperty('--mobile-fullscreen-swipe-offset', '-42px')
  })
  await expect(video).toHaveCSS('translate', '0px -42px')
  await expect(player).toHaveCSS('transform', 'none')
})

test('uses mobile surface taps for controls and keeps an on-video play button', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const appRoot = page.locator('.app')
  await appRoot.evaluate(element => {
    const applyMobileClasses = () => {
      if (!element.classList.contains('capacitorTabs')) element.classList.add('capacitorTabs')
      if (!element.classList.contains('capacitorTabletLayout')) element.classList.add('capacitorTabletLayout')
    }
    new MutationObserver(applyMobileClasses).observe(element, { attributeFilter: ['class'] })
    applyMobileClasses()
  })
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateRememberVolume', false)
    await store.dispatch('updateDefaultVolume', 0.25)
  })
  const video = await openMockedVideo(page)
  await expect.poll(() => appRoot.evaluate(element => Math.abs(
    element.getBoundingClientRect().width - window.innerWidth
  ))).toBeLessThanOrEqual(1)
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  const surface = player.locator('.shaka-controls-container')
  const playButtons = player.locator('.shaka-play-button')

  await expect(playButtons).toHaveCount(1)
  await expect(player.locator('.shaka-controls-button-panel .shaka-pip-button')).toBeVisible()
  await expect(player.locator('.shaka-settings-menu .shaka-pip-button')).toHaveCount(0)
  await expect(player.locator('.shaka-mute-button, .shaka-volume-bar-container')).toHaveCount(0)
  await expect.poll(() => video.evaluate(element => ({ muted: element.muted, volume: element.volume })))
    .toEqual({ muted: false, volume: 1 })
  await video.evaluate(element => element.play())
  await surface.evaluate(element => element.setAttribute('shown', 'true'))

  let pointerId = 1
  const tapPlayer = async (relativeX = 0.5) => {
    const bounds = await player.boundingBox()
    if (!bounds) throw new Error('player is not visible')
    const clientX = bounds.x + bounds.width * relativeX
    const clientY = bounds.y + bounds.height * 0.42
    const currentPointerId = pointerId++

    await surface.dispatchEvent('pointerdown', {
      button: 0,
      clientX,
      clientY,
      isPrimary: true,
      pointerId: currentPointerId,
      pointerType: 'touch'
    })
    await surface.dispatchEvent('touchstart', {
      touches: [{ clientX, clientY, identifier: currentPointerId }]
    })
    await surface.dispatchEvent('pointerup', {
      button: 0,
      clientX,
      clientY,
      isPrimary: true,
      pointerId: currentPointerId,
      pointerType: 'touch'
    })

    return await surface.evaluate(element => !element.dispatchEvent(new TouchEvent('touchend', {
      bubbles: true,
      cancelable: true
    })))
  }

  expect(await tapPlayer()).toBe(true)
  await expect.poll(() => surface.getAttribute('shown'), { timeout: 500 }).toBeNull()
  expect(await video.evaluate(element => element.paused)).toBe(false)

  expect(await tapPlayer()).toBe(true)
  await expect(surface).toHaveAttribute('shown', 'true')
  await page.waitForTimeout(1000)
  await expect(surface).toHaveAttribute('shown', 'true')
  expect(await video.evaluate(element => element.paused)).toBe(false)
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull()

  await surface.evaluate(element => element.removeAttribute('shown'))
  await video.evaluate(element => element.pause())
  await expect(surface).toHaveAttribute('shown', 'true')
  expect(await tapPlayer()).toBe(true)
  await expect.poll(() => surface.getAttribute('shown'), { timeout: 500 }).toBeNull()
  expect(await video.evaluate(element => element.paused)).toBe(true)

  expect(await tapPlayer(0.85)).toBe(true)
  await expect(surface).toHaveAttribute('shown', 'true')
  await page.waitForTimeout(500)
  expect(await tapPlayer(0.85)).toBe(true)
  await expect.poll(() => surface.getAttribute('shown'), { timeout: 500 }).toBeNull()

  expect(await tapPlayer()).toBe(true)
  await expect(surface).toHaveAttribute('shown', 'true')

  await video.evaluate(element => {
    Object.defineProperty(element, 'ended', { configurable: true, value: true })
    element.dispatchEvent(new Event('ended'))
  })
  await expect(surface).toHaveAttribute('shown', 'true')
  expect(await tapPlayer()).toBe(true)
  await page.waitForTimeout(3500)
  await expect(surface).toHaveAttribute('shown', 'true')
  await expect(player.locator('.shaka-controls-button-panel')).toHaveCSS('opacity', '1')
  await expect(player.locator('.shaka-seek-bar-container')).toHaveCSS('opacity', '1')

  await player.evaluate(element => element.classList.add('fullWindow'))
  const mobileCenterButtonWidth = await playButtons.last().evaluate(element => (
    element.getBoundingClientRect().width
  ))
  expect(mobileCenterButtonWidth).toBeGreaterThanOrEqual(48)
  expect(mobileCenterButtonWidth).toBeLessThanOrEqual(64)
})

test('caps the optional desktop center play button on wide players', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateDisplayVideoPlayButton', true)
  })
  await openMockedVideo(page)

  const centerPlayButton = page.locator(
    `${activeTab} .ftVideoPlayer .shaka-big-buttons-container .shaka-play-button`
  )
  await expect(centerPlayButton).toBeVisible()
  const width = await centerPlayButton.evaluate(element => element.getBoundingClientRect().width)
  expect(width).toBeGreaterThanOrEqual(48)
  expect(width).toBeLessThanOrEqual(80)
})

test('handles mobile title taps before Shaka can toggle fullscreen in tablet layout', async ({ app, page }) => {
  await openDemoVideo({ app, page })
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  const title = player.locator('.playerFullscreenTitleOverlay')

  await page.locator('.app').evaluate(element => element.classList.add('capacitorTabs', 'capacitorTabletLayout'))
  await setPlayerFullscreen(page, true)

  let pointerId = 20
  const tapAt = async (clientX, clientY, targetSelector) => {
    return await page.evaluate(({ clientX, clientY, pointerId, targetSelector }) => {
      const target = targetSelector === null
        ? document.elementFromPoint(clientX, clientY)
        : document.querySelector(targetSelector)
      if (!(target instanceof Element)) throw new Error('touch target is not visible')

      for (const type of ['pointerdown', 'pointerup']) {
        target.dispatchEvent(new PointerEvent(type, {
          bubbles: true,
          button: 0,
          clientX,
          clientY,
          isPrimary: true,
          pointerId,
          pointerType: 'touch'
        }))
      }

      return !target.dispatchEvent(new TouchEvent('touchend', {
        bubbles: true,
        cancelable: true
      }))
    }, { clientX, clientY, pointerId: pointerId++, targetSelector })
  }

  const titleBounds = await title.boundingBox()
  if (!titleBounds) throw new Error('fullscreen title is not visible')
  const clientX = titleBounds.x + Math.min(titleBounds.width / 2, 120)
  const clientY = titleBounds.y + titleBounds.height / 2

  expect(await tapAt(clientX, clientY, '.playerFullscreenTitleOverlay')).toBe(true)
  await expect(player).toHaveClass(/fullscreenMetadataOpen/)
  await expect.poll(() => player.evaluate(element => document.fullscreenElement === element)).toBe(true)

  const watchComponent = await page.evaluateHandle(findWatchComponent)
  await watchComponent.evaluate(component => component.proxy.$refs.player.setFullscreenMetadata(false))
  await expect(player).not.toHaveClass(/fullscreenMetadataOpen/)

  expect(await tapAt(clientX, clientY, '.playerFullscreenTitleOverlay')).toBe(true)
  await page.waitForTimeout(80)
  expect(await tapAt(clientX, clientY, null)).toBe(true)
  await page.waitForTimeout(320)

  await expect.poll(() => player.evaluate(element => document.fullscreenElement === element)).toBe(true)
  await watchComponent.dispose()
})

test('animates the fullscreen title when the Android status-bar inset changes', async ({ app, page }) => {
  await openDemoVideo({ app, page })
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  const controls = player.locator('.shaka-controls-container')
  const title = player.locator('.playerFullscreenTitleOverlay')

  await page.locator('.app').evaluate(element => element.classList.add('capacitorTabs'))
  await setPlayerFullscreen(page, true)
  await player.evaluate(element => element.style.setProperty('--safe-area-inset-top', '32px'))
  await controls.evaluate(element => element.setAttribute('shown', 'true'))
  await expect(title).toBeVisible()
  await page.waitForTimeout(300)

  const shownTop = await title.evaluate(element => element.getBoundingClientRect().top)
  await player.evaluate(element => element.style.setProperty('--safe-area-inset-top', '0px'))
  await controls.evaluate(element => element.removeAttribute('shown'))
  const immediateTop = await title.evaluate(element => element.getBoundingClientRect().top)
  await page.waitForTimeout(75)
  const transitioningTop = await title.evaluate(element => element.getBoundingClientRect().top)
  await page.waitForTimeout(300)
  const hiddenTop = await title.evaluate(element => element.getBoundingClientRect().top)

  const totalMovement = Math.abs(hiddenTop - shownTop)
  expect(totalMovement).toBeGreaterThanOrEqual(30)
  expect(Math.abs(immediateTop - shownTop)).toBeLessThan(totalMovement * 0.25)
  expect(transitioningTop).toBeLessThan(shownTop)
  expect(transitioningTop).toBeGreaterThan(hiddenTop)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(() => title.evaluate(element => (
    getComputedStyle(element).transitionProperty.split(', ').includes('top')
  ))).toBe(false)
})

test.describe('scroll mini player', () => {
  test('keeps a phone mini player above the bottom navigation', async ({ app, page }) => {
    const video = await openDemoVideo({ app, page })
    await video.evaluate(element => element.pause())
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--safe-area-inset-bottom', '24px')
    })

    const player = page.locator('.ftVideoPlayer')
    await scrollBelowPlayer(player)
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await setWindowSize(app, page, { width: 480, height: 800 })
    await page.evaluate(() => {
      const app = document.querySelector('.app')
      app.classList.add('capacitorTabs', 'capacitorPhoneLayout')
      app.classList.remove('topTabs', 'bottomTabs', 'verticalTabs')
      document.querySelector('.tabBar')?.style.setProperty('display', 'none')
      window.dispatchEvent(new Event('resize'))
    })

    await expect(player).toHaveClass(/scrollMiniPlayer/)

    const expectBottomNavigationClearance = async () => {
      await expect.poll(async () => {
        const [playerBounds, navigationBounds] = await Promise.all([
          player.boundingBox(),
          page.locator('.sideNav').boundingBox()
        ])
        if (playerBounds == null || navigationBounds == null) {
          return Number.NEGATIVE_INFINITY
        }
        return navigationBounds.y - (playerBounds.y + playerBounds.height)
      }).toBeGreaterThanOrEqual(15)
    }

    await expectBottomNavigationClearance()

    const dragHandle = player.locator('.scrollMiniDragHandle')
    const dragStart = await dragHandle.boundingBox()
    if (!dragStart) throw new Error('scroll mini player drag handle is not visible')
    const dragX = dragStart.x + dragStart.width / 2
    const dragY = dragStart.y + dragStart.height / 2
    await dragHandle.dispatchEvent('pointerdown', {
      button: 0,
      clientX: dragX,
      clientY: dragY,
      pointerId: 1,
      pointerType: 'touch'
    })
    await page.evaluate(({ dragX }) => {
      for (const type of ['pointermove', 'pointerup']) {
        window.dispatchEvent(new PointerEvent(type, {
          bubbles: true,
          clientX: dragX,
          clientY: window.innerHeight,
          pointerId: 1,
          pointerType: 'touch'
        }))
      }
    }, { dragX })

    await expectBottomNavigationClearance()
  })

  test('animates into and out of the scroll mini player', async ({ app, page, attachScreenshot }) => {
    const video = await openDemoVideo({ app, page })
    await video.evaluate(element => element.pause())

    await page.evaluate(() => {
      document.documentElement.dataset.reducedMotion = 'no-preference'
      window.scrollMiniPlayerAnimations = []
      const nativeAnimate = Element.prototype.animate

      Element.prototype.animate = function (keyframes, options) {
        if (this.classList.contains('ftVideoPlayer')) {
          const style = getComputedStyle(this)
          window.scrollMiniPlayerAnimations.push({
            className: this.className,
            keyframes,
            options,
            position: style.position,
            zIndex: style.zIndex
          })
        }
        return nativeAnimate.call(this, keyframes, options)
      }
    })

    const player = page.locator('.ftVideoPlayer')
    await scrollBelowPlayer(player)
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await expect(player.locator('.scrollMiniScrollTop .ft-icon'))
      .toHaveAttribute('data-icon', 'angle-up')
    await expect.poll(() => page.evaluate(() => window.scrollMiniPlayerAnimations.length)).toBe(1)
    await attachScreenshot('scroll mini player')

    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(player).not.toHaveClass(/scrollMiniPlayer/)
    await expect.poll(() => page.evaluate(() => window.scrollMiniPlayerAnimations.length)).toBe(2)
    await attachScreenshot('back to the inline player')

    const animations = await page.evaluate(() => window.scrollMiniPlayerAnimations)
    for (const animation of animations) {
      expect(animation.options.duration).toBe(300)
      expect(animation.options.easing).toBe('cubic-bezier(0.4, 0, 0.2, 1)')
      expect(animation.keyframes[0].transform).toContain('translate(')
      expect(animation.keyframes[0].transform).toContain('scale(')
      expect(animation.keyframes[1].transform).toBe('none')
    }
    expect(animations[1].className).toContain('scrollMiniPlayerAnimating')
    expect(animations[1].position).toBe('relative')
    expect(animations[1].zIndex).toBe('150')
  })

  test('restores a phone mini player by tapping its tucked sliver', async ({ app, page }) => {
    const video = await openDemoVideo({ app, page })
    await video.evaluate(element => element.pause())

    const player = page.locator('.ftVideoPlayer')
    await scrollBelowPlayer(player)
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await setWindowSize(app, page, { width: 480, height: 800 })
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await expect(player).not.toHaveClass(/scrollMiniPlayerAnimating/)

    const dragHandle = player.locator('.scrollMiniDragHandle')
    const dragStart = await dragHandle.boundingBox()
    if (!dragStart) throw new Error('scroll mini player drag handle is not visible')
    const dragY = dragStart.y + dragStart.height / 2

    await dragHandle.dispatchEvent('pointerdown', {
      button: 0,
      clientX: dragStart.x + dragStart.width / 2,
      clientY: dragY,
      pointerId: 1,
      pointerType: 'touch'
    })
    await expect(page.locator('body')).toHaveClass(/scroll-mini-player-grabbing/)
    await page.evaluate(({ dragY }) => {
      window.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        clientX: 10,
        clientY: dragY,
        pointerId: 1,
        pointerType: 'touch'
      }))
      window.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        clientX: 10,
        clientY: dragY,
        pointerId: 1,
        pointerType: 'touch'
      }))
    }, { dragY })

    await expect(player).toHaveClass(/scrollMiniPlayerStashed/)
    await expect(player).not.toHaveClass(/scrollMiniPlayerAnimating/)
    await expect(player.locator('.scrollMiniPlayerControls button')).toHaveCount(1)
    await expect(player.locator('.scrollMiniPlayPause')).toHaveCount(0)
    await expect(player.locator('.scrollMiniPointerLayer')).toHaveCSS('pointer-events', 'auto')
    await expect(player.locator('video')).toHaveCSS('pointer-events', 'none')

    const visibleWidthBeforeResize = await player.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return Math.min(window.innerWidth, bounds.right) - Math.max(0, bounds.left)
    })
    await setWindowSize(app, page, { width: 420, height: 760 })
    await expect(player).toHaveClass(/scrollMiniPlayerStashed/)
    await expect.poll(async () => {
      const bounds = await player.boundingBox()
      if (!bounds) return Number.POSITIVE_INFINITY
      return Math.min(420, bounds.x + bounds.width) - Math.max(0, bounds.x)
    }).toBeCloseTo(visibleWidthBeforeResize, 0)

    const restoreLayer = player.locator('.scrollMiniPointerLayer')
    const restoreBounds = await restoreLayer.boundingBox()
    if (!restoreBounds) throw new Error('tucked scroll mini player restore target is not visible')
    const pausedBeforeRestore = await video.evaluate(element => element.paused)
    const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
    const restoreX = (
      Math.max(0, restoreBounds.x) +
      Math.min(viewport.width, restoreBounds.x + restoreBounds.width)
    ) / 2
    const restoreY = (
      Math.max(0, restoreBounds.y) +
      Math.min(viewport.height, restoreBounds.y + restoreBounds.height)
    ) / 2
    await expect.poll(() => page.evaluate(({ x, y }) => {
      return document.elementFromPoint(x, y)?.closest('.scrollMiniPointerLayer') != null
    }, { x: restoreX, y: restoreY })).toBe(true)

    await page.mouse.move(restoreX, restoreY)
    await page.mouse.down()

    await expect(player).not.toHaveClass(/scrollMiniPlayerStashed/)
    await page.mouse.up()
    await expect.poll(() => video.evaluate(element => element.paused)).toBe(pausedBeforeRestore)
  })

  test('does not replay the animation after switching tabs', async ({ app, page, attachScreenshot }) => {
    const video = await openDemoVideo({ app, page })
    await video.evaluate(element => element.pause())

    await page.evaluate(() => {
      document.documentElement.dataset.reducedMotion = 'no-preference'
      window.scrollMiniPlayerAnimationCount = 0
      const nativeAnimate = Element.prototype.animate

      Element.prototype.animate = function (keyframes, options) {
        if (this.classList.contains('ftVideoPlayer')) {
          window.scrollMiniPlayerAnimationCount++
        }
        return nativeAnimate.call(this, keyframes, options)
      }
    })

    const player = page.locator('.ftVideoPlayer')
    await scrollBelowPlayer(player)
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await expect.poll(() => page.evaluate(() => window.scrollMiniPlayerAnimationCount)).toBe(1)

    await page.locator('.tabBar .newTabButton').click()
    await expect(page.locator('.tabBar .tab')).toHaveCount(2)
    await expect(player).toBeHidden()
    await expect(player).not.toHaveClass(/scrollMiniPlayer/)
    await attachScreenshot('second tab open')
    const animationCountBeforeReturn = await page.evaluate(
      () => window.scrollMiniPlayerAnimationCount
    )
    await page.locator('.tabBar .tab').first().click()
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await attachScreenshot('back on the video tab')

    // The old behavior scheduled the restored entrance animation on the next
    // Vue tick, so wait past its duration before checking that none was added.
    await page.waitForTimeout(350)
    expect(await page.evaluate(() => window.scrollMiniPlayerAnimationCount))
      .toBe(animationCountBeforeReturn)
  })

  test.describe('on all tabs', () => {
    test.use({
      seed: {
        settings: {
          ...PLAYER_SEED,
          scrollMiniPlayerOnAllTabs: true,
          uiScale: 125
        }
      }
    })

    test('remembers separate mini player positions for scrolling and tab switches', async ({ app, page }) => {
      await openDemoVideo({ app, page })
      let player = page.locator('.ftVideoPlayer')
      const videoTab = page.locator('.tabBar .tab').first()
      const readPosition = () => player.evaluate(element => ({
        left: Number.parseFloat(element.style.left),
        top: Number.parseFloat(element.style.top)
      }))
      const dragTo = async (left, top) => {
        const position = await readPosition()
        await player.locator('.scrollMiniDragHandle').dispatchEvent('pointerdown', {
          button: 0, clientX: 0, clientY: 0, pointerId: 1
        })
        await page.evaluate(({ dx, dy }) => {
          for (const type of ['pointermove', 'pointerup']) {
            window.dispatchEvent(new PointerEvent(type, {
              clientX: dx, clientY: dy, pointerId: 1
            }))
          }
        }, { dx: left - position.left, dy: top - position.top })
        await expect.poll(async () => Math.abs((await readPosition()).top - top)).toBeLessThan(1)
      }

      await scrollBelowPlayer(player)
      await expect(player).toHaveClass(/scrollMiniPlayer/)
      await expect(player).not.toHaveClass(/scrollMiniPlayerAnimating/)
      await dragTo(16, 160)
      const scrollPosition = await readPosition()

      await page.locator('.tabBar .newTabButton').click()
      await expect(player.getByRole('button', { name: 'Hide mini player' })).toBeVisible()
      await expect.poll(readPosition).not.toEqual(scrollPosition)
      await dragTo(16, 260)
      const tabPosition = await readPosition()

      await videoTab.click()
      await expect.poll(readPosition).toEqual(scrollPosition)
      await page.locator('.tabBar .tab').nth(1).click()
      await expect.poll(readPosition).toEqual(tabPosition)

      // Both positions must survive restarting the app, not just remain in memory.
      await videoTab.click()
      await page.getByRole('link', { name: 'Go to Subscriptions', exact: true }).click()
      await expect(page).toHaveURL(/#\/subscriptions$/)
      ;({ page } = await app.relaunch())
      await openDemoVideo({ app, page })
      player = page.locator('.ftVideoPlayer')
      await scrollBelowPlayer(player)
      await expect.poll(readPosition).toEqual(scrollPosition)
      await page.locator('.tabBar .newTabButton').click()
      await expect.poll(readPosition).toEqual(tabPosition)
    })

    test('keeps the most recently left video visible across tabs', async ({ app, page, attachScreenshot }) => {
      const video = await openDemoVideo({ app, page })
      const playbackTimeBeforeSwitch = await video.evaluate(element => element.currentTime)

      const player = page.locator('.ftVideoPlayer')
      await page.locator('.tabBar .newTabButton').click()
      await expect(page.locator('.tabBar .tab')).toHaveCount(2)
      await expect(player).toBeVisible()
      await expect(player).toHaveClass(/scrollMiniPlayer/)
      const returnButton = player.locator('.scrollMiniScrollTop')
      await expect(returnButton).toHaveAttribute(
        'title',
        'Return to video tab'
      )
      await expect(returnButton).toHaveAttribute('tabindex', '0')
      await expect(returnButton.locator('.ft-icon'))
        .toHaveAttribute('data-icon', 'back-to-tab')
      const dismissButton = player.getByRole('button', { name: 'Hide mini player' })
      await expect(dismissButton).toBeVisible()
      expect(await dismissButton.evaluate(button => {
        return button.getBoundingClientRect().left >
          button.previousElementSibling.getBoundingClientRect().left
      })).toBe(true)
      const floatingVideo = player.locator('video')
      await expect.poll(() => floatingVideo.evaluate(element => element.currentTime))
        .toBeGreaterThan(playbackTimeBeforeSwitch)

      const playPauseButton = player.locator('.scrollMiniPlayPause')
      await playPauseButton.click()
      await expect.poll(() => floatingVideo.evaluate(element => element.paused)).toBe(true)
      await playPauseButton.click()
      await expect.poll(() => floatingVideo.evaluate(element => element.paused)).toBe(false)
      await attachScreenshot('mini player on another tab')

      await page.locator('.tabBar .newTabButton').click()
      await expect(page.locator('.tabBar .tab')).toHaveCount(3)
      await expect(player).toBeVisible()

      await player.locator('.scrollMiniScrollTop').click()
      await expect(page.locator(`${activeTab} .ftVideoPlayer`)).toBeVisible()
      await expect(player).not.toHaveClass(/scrollMiniPlayer/)
    })

    test('hides the detached mini player until its video tab is revisited', async ({ app, page }) => {
      await openDemoVideo({ app, page })
      const player = page.locator('.ftVideoPlayer')
      const video = player.locator('video')
      const playbackTimeBeforeSwitch = await video.evaluate(element => element.currentTime)
      const videoTab = page.locator('.tabBar .tab').first()

      await page.locator('.tabBar .newTabButton').click()
      await expect(player).toHaveClass(/scrollMiniPlayer/)
      await player.getByRole('button', { name: 'Hide mini player' }).click()

      await expect(player).toHaveCSS('opacity', '0')
      await expect(player).toHaveAttribute('aria-hidden', 'true')
      await expect(player).toHaveAttribute('inert', '')
      await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)
      await expect.poll(() => video.evaluate(element => element.currentTime))
        .toBeGreaterThan(playbackTimeBeforeSwitch)

      await page.locator('.tabBar .newTabButton').click()
      await expect(page.locator('.tabBar .tab')).toHaveCount(3)
      await expect(player).toHaveCSS('opacity', '0')

      await videoTab.click()
      await expect(player).toBeVisible()
      await expect(player).toHaveCSS('opacity', '1')
      await expect(player).not.toHaveAttribute('inert', '')
      await expect(player).not.toHaveClass(/scrollMiniPlayer/)
      await expect(player.getByRole('button', { name: 'Hide mini player' })).toHaveCount(0)

      await page.locator('.tabBar .tab').nth(1).click()
      await expect(player).toBeVisible()
      await expect(player).toHaveClass(/scrollMiniPlayer/)
      await expect(player.getByRole('button', { name: 'Hide mini player' })).toBeVisible()
    })

    test('does not show a second mini player after switching between watch tabs', async ({ app, page }) => {
      const { activePlayer } = await openCrossTabMiniPlayerOverWatchTab({ app, page })

      await expectNoScrollMiniPlayerActivation(
        page,
        activePlayer,
        () => scrollBelowPlayer(activePlayer)
      )
      await expect(page.locator('.ftVideoPlayer.scrollMiniPlayer')).toHaveCount(1)
    })

    test('allows the active tab mini player after the cross-tab video ends', async ({ app, page }) => {
      const { activePlayer, firstPlayer, firstVideo } = await openCrossTabMiniPlayerOverWatchTab({ app, page })

      await firstVideo.evaluate(element => {
        Object.defineProperty(element, 'ended', { configurable: true, value: true })
        element.dispatchEvent(new Event('ended'))
      })
      await expect(firstPlayer).not.toHaveClass(/scrollMiniPlayer/)

      await scrollBelowPlayer(activePlayer)

      await expect(activePlayer).toHaveClass(/scrollMiniPlayer/)
      await expect(page.locator('.ftVideoPlayer.scrollMiniPlayer')).toHaveCount(1)
    })

    test('does not show the cross-tab mini player for a paused video', async ({ app, page }) => {
      const video = await openDemoVideo({ app, page })
      await video.evaluate(element => element.pause())
      await expect.poll(() => video.evaluate(element => element.paused)).toBe(true)

      const player = page.locator('.ftVideoPlayer')
      await page.locator('.tabBar .newTabButton').click()

      await expect(player).toBeHidden()
      await expect(player).not.toHaveClass(/scrollMiniPlayer/)
    })

    test('removes the mini player when its source tab closes', async ({ app, page }) => {
      await openDemoVideo({ app, page })

      await page.locator('.tabBar .newTabButton').click()
      await expect(page.locator('.ftVideoPlayer')).toBeVisible()

      await page.locator('.tabBar .tab').first().locator('.closeButton').click()
      await expect(page.locator('.tabBar .tab')).toHaveCount(1)
      await expect(page.locator('.ftVideoPlayer')).toHaveCount(0)
    })

    test('keeps menus and utility windows above the mini player', async ({ app, page }) => {
      await openDemoVideo({ app, page })

      const player = page.locator('.ftVideoPlayer')
      await page.locator('.tabBar .newTabButton').click()
      await expect(player).toHaveClass(/scrollMiniPlayer/)

      await page.locator('.profileTrigger').click()
      const quickSettings = page.getByRole('dialog', { name: 'Quick settings' })
      await expectOverlayAbovePlayer(player, quickSettings)

      await quickSettings.getByRole('button', { name: 'All settings' }).click()
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
      await expectOverlayAbovePlayer(player, settings)
      await settings.getByRole('button', { name: 'Close', exact: true }).click()

      await page.locator('.profileTrigger').click()
      await page.getByRole('dialog', { name: 'Quick settings' })
        .getByRole('button', { name: 'Downloads' }).click()
      const downloads = page.getByRole('dialog', { name: 'Downloads', exact: true })
      await expectOverlayAbovePlayer(player, downloads)
    })

    test('hides an existing mini player when automatic PiP takes over tab changes', async ({ app, page }) => {
      await openDemoVideo({ app, page })

      const player = page.locator('.ftVideoPlayer')
      const video = player.locator('video')
      await page.locator('.tabBar .newTabButton').click()
      await expect(player).toHaveClass(/scrollMiniPlayer/)
      await video.evaluate(element => element.pause())
      await expect.poll(() => video.evaluate(element => element.paused)).toBe(true)

      await page.locator('.profileTrigger').click()
      await page.getByRole('dialog', { name: 'Quick settings' })
        .getByRole('button', { name: 'All settings' }).click()
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
      await settings.locator('.settingsMenu [data-section="playback"]').click()
      await settings.locator('.pure-checkbox label')
        .filter({ hasText: 'When switching tabs' }).click()

      await expect(settings.getByRole('checkbox', {
        name: 'When switching tabs',
        exact: true
      })).toBeChecked()
      await expect(player).toBeHidden()
      await expect(player).not.toHaveClass(/scrollMiniPlayer/)
    })

    test.describe('with automatic Picture-in-Picture', () => {
      test.use({
        seed: {
          settings: {
            ...PLAYER_SEED,
            autoPictureInPictureTriggers: ['tab'],
            scrollMiniPlayerOnAllTabs: true,
            uiScale: 125
          }
        }
      })

      test('uses PiP instead of the cross-tab mini player', async ({ app, page }) => {
        await openDemoVideo({ app, page })
        const player = page.locator('.ftVideoPlayer')
        const video = player.locator('video')

        await page.locator('.tabBar .newTabButton').click()
        await expect.poll(() => video.evaluate(
          element => document.pictureInPictureElement === element
        )).toBe(true)
        await expect(player).toBeHidden()
        await expect(player).not.toHaveClass(/scrollMiniPlayer/)

        // A later scroll update must not bring the in-app player back while
        // the same video is still presented by the native PiP window.
        await page.evaluate(() => window.dispatchEvent(new Event('scroll')))
        await expect(player).toBeHidden()
        await expect(player).not.toHaveClass(/scrollMiniPlayer/)

        await page.evaluate(() => document.exitPictureInPicture())
        await expect.poll(() => page.evaluate(
          () => document.pictureInPictureElement === null
        )).toBe(true)
      })

      test('does not fall back to the cross-tab mini player while paused', async ({ app, page }) => {
        const video = await openDemoVideo({ app, page })
        await video.evaluate(element => element.pause())
        await expect.poll(() => video.evaluate(element => element.paused)).toBe(true)

        const player = page.locator('.ftVideoPlayer')
        await page.locator('.tabBar .newTabButton').click()

        await expect.poll(() => page.evaluate(
          () => document.pictureInPictureElement === null
        )).toBe(true)
        await expect(player).toBeHidden()
        await expect(player).not.toHaveClass(/scrollMiniPlayer/)
      })
    })
  })

  test('scales the captions down with the scroll mini player', async ({ app, page, attachScreenshot }) => {
    const video = await openDemoVideo({ app, page })
    await video.evaluate(element => element.pause())

    const player = page.locator('.ftVideoPlayer')
    await player.evaluate(element => {
      if (element.querySelector('.shaka-text-container')) return

      const captions = document.createElement('div')
      captions.className = 'shaka-text-container'
      element.append(captions)
    })

    const captions = player.locator('.shaka-text-container')
    const getFontSize = () => captions.evaluate(element => {
      return Number.parseFloat(getComputedStyle(element).fontSize)
    })
    const inlineFontSize = await getFontSize()
    expect(inlineFontSize).toBe(20)

    await scrollBelowPlayer(player)
    await expect(player).toHaveClass(/scrollMiniPlayer/)

    // The mini player is only a couple of hundred pixels tall, so inline sized captions covered all of it.
    await expect.poll(getFontSize).toBeLessThan(inlineFontSize * 0.8)
    await attachScreenshot('mini player captions')

    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(player).not.toHaveClass(/scrollMiniPlayer/)
    await expect.poll(getFontSize).toBe(inlineFontSize)
  })

  test('keeps the mini player docked across window resizes', async ({ app, page, attachScreenshot }) => {
    await setWindowSize(app, page, { width: 1200, height: 850 })
    const video = await openDemoVideo({ app, page })
    await video.evaluate(element => element.pause())

    const player = page.locator('.ftVideoPlayer')

    // Docked bottom-right in the small window.
    await scrollBelowPlayer(player)
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await attachScreenshot('docked in the small window')

    // Growing the window used to leave the player where the old bottom edge
    // was, i.e. floating in the middle of the screen.
    const grown = await setWindowSize(app, page, { width: 1600, height: 1050 })
    await expectDockedToBottomRight(player, grown)
    await attachScreenshot('docked after growing the window')

    // ...and the stale position outlived a trip back to the inline player.
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(player).not.toHaveClass(/scrollMiniPlayer/)

    const shrunk = await setWindowSize(app, page, { width: 1300, height: 900 })
    await scrollBelowPlayer(player)
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await expectDockedToBottomRight(player, shrunk)
    await attachScreenshot('docked after shrinking the window')
  })

  test.describe('large captions', () => {
    test.use({
      seed: {
        settings: {
          ...PLAYER_SEED,
          defaultCaptionSettings: JSON.stringify({ fontScale: 4 })
        }
      }
    })

    test('keeps the captions inside the scroll mini player', async ({ app, page, attachScreenshot }) => {
      const video = await openDemoVideo({ app, page })
      await video.evaluate(element => element.pause())

      const player = page.locator('.ftVideoPlayer')
      await player.evaluate(element => {
        if (element.querySelector('.shaka-text-container')) return

        const captions = document.createElement('div')
        captions.className = 'shaka-text-container'
        const cue = document.createElement('div')
        const text = document.createElement('span')
        text.setAttribute('translate', 'no')
        text.textContent = 'a caption long enough to wrap over several lines in a small player, '
          .repeat(3)
        cue.append(text)
        captions.append(cue)
        element.append(captions)
      })

      await scrollBelowPlayer(player)
      await expect(player).toHaveClass(/scrollMiniPlayer/)

      // The maximum font size used to overflow the mini player in every direction.
      await expect.poll(() => player.evaluate(element => {
        const playerRect = element.getBoundingClientRect()
        const captionRect = element.querySelector('.shaka-text-container').getBoundingClientRect()

        return {
          top: captionRect.top >= playerRect.top,
          bottom: captionRect.bottom <= playerRect.bottom,
          left: captionRect.left >= playerRect.left,
          right: captionRect.right <= playerRect.right
        }
      })).toEqual({ top: true, bottom: true, left: true, right: true })
      await attachScreenshot('large captions in the mini player')
    })
  })
})

test.describe('skip silence shortcut', () => {
  test.use({
    seed: {
      settings: {
        ...PLAYER_SEED,
        keyboardShortcuts: JSON.stringify({
          VIDEO_PLAYER: {
            PLAYBACK: {
              TOGGLE_SKIP_SILENCE: 'h'
            }
          }
        })
      }
    }
  })

  test('shows an on-screen indicator when toggled', async ({ app, page, attachScreenshot }) => {
    await openDemoVideo({ app, page })

    const popup = page.locator(`${activeTab} .valueChangePopup`)
    const skipSilence = () => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.getters.getTabSkipSilence(store.getters.getActiveTabId)
    })

    await page.locator('body').press('h')
    await expect(popup).toBeVisible()
    await expect(popup).toHaveText(/On/)
    await expect(popup.locator('.valueChangeIcons .ft-icon')).toHaveCount(2)
    await expect(popup.locator('.valueChangeIcons .ft-icon').nth(0)).toHaveAttribute('data-icon', 'forward-step')
    await expect(popup.locator('.valueChangeIcons .ft-icon').nth(1)).toHaveAttribute('data-icon', 'volume-xmark')
    await expect.poll(skipSilence).toBe(true)
    await attachScreenshot('skip silence enabled')

    await page.locator('body').press('h')
    await expect(popup).toBeVisible()
    await expect(popup).toHaveText(/Off/)
    await expect.poll(skipSilence).toBe(false)
    await attachScreenshot('skip silence disabled')
  })

  test('keeps the setting within its tab', async ({ app, page }) => {
    await openDemoVideo({ app, page })

    const readSkipSilenceState = () => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return {
        activeTabId: store.getters.getActiveTabId,
        values: { ...store.state.tabs.skipSilenceByTabId }
      }
    })

    await page.locator('body').press('h')
    const firstTabId = (await readSkipSilenceState()).activeTabId
    await expect.poll(readSkipSilenceState).toMatchObject({
      values: { [firstTabId]: true }
    })

    await page.locator('.tabBar .newTabButton').click()
    await expect(page.locator('.tabBar .tab')).toHaveCount(2)
    await openMockedVideo(page)

    const secondTabId = (await readSkipSilenceState()).activeTabId
    expect(secondTabId).not.toBe(firstTabId)
    await expect.poll(readSkipSilenceState).toMatchObject({
      values: { [firstTabId]: true }
    })
    expect(await page.evaluate((tabId) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.getters.getTabSkipSilence(tabId)
    }, secondTabId)).toBe(false)

    await page.locator('body').press('h')
    await page.locator('body').press('h')
    await expect.poll(readSkipSilenceState).toMatchObject({
      values: {
        [firstTabId]: true,
        [secondTabId]: false
      }
    })
  })

  test('applies the default only to newly-created tabs', async ({ app, page }) => {
    await openDemoVideo({ app, page })

    const readSkipSilenceState = () => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return {
        activeTabId: store.getters.getActiveTabId,
        values: { ...store.state.tabs.skipSilenceByTabId }
      }
    })

    const firstTabId = (await readSkipSilenceState()).activeTabId
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateShowSkipSilenceButton', true)
      await store.dispatch('updateEnableSkipSilenceByDefault', true)
    })

    await expect.poll(readSkipSilenceState).toMatchObject({
      values: { [firstTabId]: false }
    })
    await page.locator('body').press('h')
    await expect.poll(readSkipSilenceState).toMatchObject({
      values: { [firstTabId]: true }
    })

    await page.locator('.tabBar .newTabButton').click()
    await expect(page.locator('.tabBar .tab')).toHaveCount(2)
    await openMockedVideo(page)

    const secondTabId = (await readSkipSilenceState()).activeTabId
    expect(secondTabId).not.toBe(firstTabId)
    await expect.poll(readSkipSilenceState).toMatchObject({
      values: {
        [firstTabId]: true,
        [secondTabId]: true
      }
    })

    await page.locator('body').press('h')
    await expect.poll(readSkipSilenceState).toMatchObject({
      values: {
        [firstTabId]: true,
        [secondTabId]: false
      }
    })
  })

  test('disables the setting for an unmounted player when the control is hidden', async ({ app, page }) => {
    await openDemoVideo({ app, page })

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateShowSkipSilenceButton', true)
    })
    await page.locator('body').press('h')

    await page.locator('.sideNav a[href="#/history"]').first().evaluate(link => link.click())
    await expect(page.locator(`${activeTab} .ftVideoPlayer`)).toHaveCount(0)
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateShowSkipSilenceButton', false)
    })

    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.getters.getTabSkipSilence(store.getters.getActiveTabId)
    })).toBe(false)
  })
})

test.describe('skip silence default', () => {
  test.use({
    seed: {
      settings: {
        ...PLAYER_SEED,
        showSkipSilenceButton: true,
        enableSkipSilenceByDefault: true
      }
    }
  })

  test('enables silence skipping in the initial tab', async ({ app, page }) => {
    await openDemoVideo({ app, page })

    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.getters.getTabSkipSilence(store.getters.getActiveTabId)
    })).toBe(true)
  })
})
