import { readFile } from 'node:fs/promises'
import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { findWatchComponent, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

const helperRoot = new URL('../../../src/renderer/helpers/player/', import.meta.url)
// Exercise the native screen's actual renderer layout with the real Watch page.
// Native decoding and Android touch routing have separate device tests.
const inlineHelper = async name => (await readFile(new URL(name, helperRoot), 'utf8'))
  .replace(/^import .*\n/gm, '').replace(/^export function /gm, 'function ')
const screenSource = await inlineHelper('androidNativeScreen.js')
const overrideSource = await inlineHelper('overrideShakaMethods.js')
const mediaElementSource = await inlineHelper('androidMediaElement.js')
const screenCss = await readFile(new URL('androidNativeScreen.css', helperRoot), 'utf8')

test.use({ seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true, useQuickPlaybackSpeedBar: true } } })

async function openNativeScreen(page, fullscreen = true) {
  await page.addStyleTag({ content: screenCss })
  await page.addScriptTag({ content: `{const requestAnimationFrame = callback => window.requestAnimationFrame(time => { if (!window.holdNativeLayout) callback(time) });${overrideSource}\n${screenSource}\nwindow.createNativeScreenTest = createAndroidNativeScreen}` })
  await page.evaluate(fullscreen => {
    const createScreen = window.createNativeScreenTest
    const element = document.querySelector('.ftVideoPlayer video')
    element.pause()
    // Android delegates rotation to its native screen instead of browser fullscreen.
    element.ui.configure({ enableFullscreenOnRotation: false })
    window.nativeFrameCaptureCalls = 0
    const controller = { async show() {}, async hide() {}, async layout(value) { window.nativeLayoutTest = { ...window.nativeLayoutTest, ...value } }, async captureFrame() { window.nativeFrameCaptureCalls++; return { dataUrl: '' } } }
    window.nativeScreenTestController = controller
    const screen = createScreen({
      element,
      container: element.closest('.ftVideoPlayer'),
      getController: () => controller,
      getLocale: () => 'en-US',
      isFullscreenOnRotationEnabled: () => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getEnterFullscreenOnDisplayRotate,
      onError: error => { throw error },
    })
    screen.bindControls(element.ui.getControls())
    window.nativeScreenTest = screen
    return fullscreen ? screen.show() : screen.attach()
  }, fullscreen)
}

async function enableMobileInput(page) {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => 5 })
    const app = document.querySelector('.app')
    const keepMobile = () => { if (!app.classList.contains('capacitorTabs')) app.classList.add('capacitorTabs') }
    new MutationObserver(keepMobile).observe(app, { attributeFilter: ['class'] })
    keepMobile()
  })
}

for (const uiScale of [100, 125]) {
  test.describe(`native loading layout at ${uiScale}%`, () => {
    test.use({ seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true, uiScale } } })
    test('keeps the stream placeholder at the loading skeleton height', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await enableMobileInput(page)
      await openMockedVideo(page)
      await setWindowSize(app, page, { width: 480, height: 850 })
      const watch = await page.evaluateHandle(findWatchComponent)
      await watch.evaluate(async instance => {
        await instance.refs.player.destroyPlayer()
        instance.proxy.ytDlpStreamsPending = true
        instance.proxy.isLoading = true
      })
      const placeholder = page.locator('.videoPlayerPlaceholder')
      const skeleton = await placeholder.boundingBox()
      await watch.evaluate(instance => {
        instance.proxy.thumbnail = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"/>')
        instance.proxy.isLoading = false
      })
      await expect(page.locator('.streamPlaceholder')).toBeVisible()
      await page.locator('.streamPlaceholder img').evaluate(image => image.decode())
      expect((await placeholder.boundingBox()).height).toBeCloseTo(skeleton.height, 0)
    })
    test('places playback OSDs near the top inline and below the fullscreen title', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await enableMobileInput(page)
      await openMockedVideo(page)
      await setWindowSize(app, page, { width: 480, height: 850 })
      await openNativeScreen(page, false)
      const watch = await page.evaluateHandle(findWatchComponent)
      await watch.evaluate(instance => {
        instance.refs.player.$.setupState.showValueChangePopup = true
        instance.refs.player.$.setupState.valueChangeMessage = '2x'
      })
      const osd = page.locator('.valueChangePopup')
      await expect(osd).toBeVisible()
      const offset = () => osd.evaluate(element => element.getBoundingClientRect().top - element.closest('.ftVideoPlayer').getBoundingClientRect().top)
      expect(await offset()).toBeGreaterThanOrEqual(16)
      expect(await offset()).toBeLessThanOrEqual(32)
      await page.evaluate(() => window.nativeScreenTest.show())
      expect(await offset()).toBeCloseTo(56, 0)
      // Brightness/volume labels must fit the OSD, including long translations.
      for (const message of ['Brightness: 23%', 'Lautstärke: 100%', 'Helligkeit: 100%']) {
        await watch.evaluate((instance, message) => {
          instance.refs.player.$.setupState.valueChangeMessage = message
          instance.refs.player.$.setupState.valueChangeIcons = ['sun']
        }, message)
        await expect(osd.locator('.valueChangeText')).toHaveText(message)
        const geometry = await osd.evaluate(element => {
          const box = element.getBoundingClientRect()
          const message = element.lastElementChild
          const range = document.createRange()
          range.selectNodeContents(message)
          const text = range.getBoundingClientRect()
          return { text: message.textContent, left: text.left - box.left, right: box.right - text.right, bottom: box.bottom - text.bottom }
        })
        expect(geometry.text).toBe(message)
        expect(geometry.left).toBeGreaterThanOrEqual(0)
        expect(geometry.right).toBeGreaterThanOrEqual(0)
        expect(geometry.bottom).toBeGreaterThanOrEqual(0)
      }
      await page.evaluate(() => window.nativeScreenTest.destroy())
    })
    test('keeps the player height stable through metadata, poster removal and native frames', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await enableMobileInput(page)
      const video = await openMockedVideo(page)
      await setWindowSize(app, page, { width: 480, height: 850 })
      await video.evaluate(element => element.ui.getControls().getPlayer().unload())
      await page.addScriptTag({ content: `{${mediaElementSource};window.attachNativeMediaTest=attachAndroidMediaElement}` })
      await video.evaluate(element => {
        window.nativeMediaTest = window.attachNativeMediaTest(element, { command: async () => {}, load: async () => {}, onError: error => { throw error } })
      })
      await openNativeScreen(page, false)
      const player = page.locator('.ftVideoPlayer')
      const initial = await player.boundingBox()
      const heights = [initial.height]
      for (const stage of ['metadata', 'poster-removed', 'native-frame']) {
        await video.evaluate((element, stage) => {
          if (stage === 'metadata') {
            window.nativeMediaTest.update({ ready: true, width: 1920, height: 1080, duration: 60, position: 0, paused: true })
          } else if (stage === 'poster-removed') {
            element.removeAttribute('poster')
            element.dispatchEvent(new Event('playing'))
          } else {
            element.poster = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"/>')
          }
        }, stage)
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        heights.push((await player.boundingBox()).height)
      }
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1)
      expect(heights.at(-1)).toBeCloseTo(initial.width * 9 / 16, 0)
      await page.evaluate(() => { window.nativeScreenTest.destroy(); window.nativeMediaTest.detach() })
    })
  })
}

test('inline playback presents the native surface without copying frames through posters', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await openNativeScreen(page, false)
  await video.evaluate(element => element.play())
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(0.25)
  expect(await page.evaluate(() => window.nativeFrameCaptureCalls)).toBe(0)
  await page.evaluate(() => window.nativeScreenTest.destroy())
})

test('SABR and preroll countdown rings cover native transport buttons', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await openNativeScreen(page, false)
  await page.evaluate(() => {
    // Both native source timers use this shared ring. Supply the notice without
    // requiring a remote SABR server to request backoff during an offline test.
    const overlay = document.createElement('div')
    overlay.className = 'countdownOverlay'
    const ring = document.createElement('div')
    ring.className = 'countdownProgress'
    ring.textContent = '1.2s'
    const player = document.querySelector('.ftVideoPlayer')
    for (const attribute of player.getAttributeNames().filter(name => name.startsWith('data-v-'))) {
      overlay.setAttribute(attribute, '')
      ring.setAttribute(attribute, '')
    }
    overlay.append(ring)
    player.append(overlay)
  })
  const ring = page.locator('.countdownProgress')
  await expect(ring).toBeVisible()
  for (const fullscreen of [false, true]) {
    if (fullscreen) await page.evaluate(() => window.nativeScreenTest.show())
    const bounds = await ring.boundingBox()
    expect(bounds.width).toBeGreaterThan(90)
    expect(bounds.height).toBeGreaterThan(90)
    await expect.poll(() => page.evaluate(({ x, y, width, height }) => window.nativeLayoutTest.menus.some(menu =>
      menu.x <= x + 1 && menu.y <= y + 1 && menu.x + menu.width >= x + width - 1 && menu.y + menu.height >= y + height - 1
    ), bounds)).toBe(true)
    expect(await page.evaluate(() => window.nativeLayoutTest.overlayActive)).toBe(false)
    expect(await page.evaluate(() => window.nativeLayoutTest.menus.some(menu => menu.pageScroll))).toBe(!fullscreen)
  }
  await page.evaluate(() => window.nativeScreenTest.destroy())
})

for (const uiScale of [100, 125]) {
  test.describe(`inline native surface at ${uiScale}%`, () => {
    test.use({ seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true, uiScale, ambientMode: false } } })
    for (const trigger of ['widening the panel', 'removing chapters', 'shortening titles', 'removing thumbnails']) {
      test(`clamps chapter scrolling after ${trigger}`, async ({ app, page }) => {
        await mockPlayableWatchPage(app, page)
        await openMockedVideo(page)
        const watch = await page.evaluateHandle(findWatchComponent)
        await watch.evaluate(component => {
          component.proxy.videoChapters = Array.from({ length: 24 }, (_, index) => ({
            title: `Chapter ${index} with a long title for responsive wrapping`,
            timestamp: `${index}:00`,
            startSeconds: index * 30
          }))
          component.proxy.showSidebarChapters = true
        })
        const chapters = page.locator('.watchVideoChaptersPanel .chaptersWrapper')
        await expect(chapters).toBeAttached()
        await chapters.evaluate(element => { element.style.width = '160px' })
        await expect.poll(() => chapters.evaluate(element => element.scrollHeight)).toBeGreaterThan(1000)
        await chapters.evaluate(element => { element.scrollTop = element.scrollHeight })
        await expect.poll(() => chapters.evaluate(element => element.scrollTop)).toBeGreaterThan(500)
        if (trigger === 'widening the panel') {
          await chapters.evaluate(element => { element.style.width = '440px' })
        } else {
          await watch.evaluate((component, trigger) => {
            if (trigger === 'removing thumbnails') {
              component.proxy.thumbnail = ''
              component.proxy.videoChapterThumbnails = []
              return
            }
            component.proxy.videoChapters = trigger === 'removing chapters'
              ? component.proxy.videoChapters.slice(0, 4)
              : component.proxy.videoChapters.map(chapter => ({ ...chapter, title: 'Intro' }))
          }, trigger)
        }
        await expect.poll(() => chapters.evaluate(element => {
          const rows = element.querySelectorAll('.chapter')
          const viewport = element.getBoundingClientRect()
          const last = rows[rows.length - 1].getBoundingClientRect()
          const scale = viewport.height / element.clientHeight
          const contentEnd = element.scrollTop + (last.bottom - viewport.top) / scale
          return element.scrollTop - Math.max(0, contentEnd - element.clientHeight)
        })).toBeLessThanOrEqual(1)
        await expect.poll(() => chapters.evaluate(element => {
          const last = [...element.querySelectorAll('.chapter')].at(-1).getBoundingClientRect()
          const viewport = element.getBoundingClientRect()
          return element.scrollHeight - element.scrollTop - (last.bottom - viewport.top) / (viewport.height / element.clientHeight)
        })).toBeLessThanOrEqual(1)
      })
    }
    test('lets Android animate mini-player entry and return without competing browser transforms', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      await openNativeScreen(page, false)
      await page.evaluate(() => {
        window.nativeMotionCalls = []
        window.nativeScreenTestController.layout = async value => {
          window.nativeMotionCalls.push(value)
          if (value.transition) await new Promise(resolve => { window.finishNativeMotion = resolve })
        }
      })
      const player = page.locator('.ftVideoPlayer')
      for (const entering of [true, false]) {
        await player.evaluate((element, entering) => window.scrollTo(0, entering ? window.scrollY + element.getBoundingClientRect().bottom : 0), entering)
        await expect(player).toHaveAttribute('data-native-player-transition', '')
        expect(await player.evaluate(element => element.getAnimations().filter(animation => animation.effect.getKeyframes().some(keyframe => keyframe.transform)).length)).toBe(0)
        await expect.poll(() => page.evaluate(() => window.nativeMotionCalls.filter(call => call.transition).length)).toBe(entering ? 1 : 2)
        await expect(page.locator('.shaka-controls-container')).toBeHidden()
        await page.evaluate(() => window.finishNativeMotion())
        await expect(player).not.toHaveAttribute('data-native-player-transition')
        await expect(player).not.toHaveClass(/scrollMiniPlayerAnimating/)
      }
      expect(await page.evaluate(() => window.nativeMotionCalls.filter(call => call.endTransition).length)).toBe(2)
      await page.evaluate(() => window.nativeScreenTest.destroy())
    })
    test('keeps page content behind the native scroll mini player', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      await openNativeScreen(page, false)
      const player = page.locator('.ftVideoPlayer')
      await player.evaluate(element => window.scrollTo(0, window.scrollY + element.getBoundingClientRect().bottom))
      await expect(player).toHaveClass(/scrollMiniPlayer/)
      await expect(player).not.toHaveClass(/scrollMiniPlayerAnimating/)
      // The Android template teleports native mini players into this layer.
      // This Electron fixture supplies only the native screen adapter.
      await player.evaluate(element => document.querySelector('#cross-tab-mini-player-layer').append(element))
      const bounds = await player.boundingBox()
      await page.evaluate(bounds => {
        // A page element that would normally sit behind the floating player.
        const marker = document.createElement('div')
        Object.assign(marker.style, {
          position: 'fixed',
          left: `${bounds.x}px`,
          top: `${bounds.y}px`,
          width: `${bounds.width}px`,
          height: `${bounds.height}px`,
          background: 'red'
        })
        document.querySelector('.watchVideoInfo').append(marker)
        document.querySelector('.scrollMiniPlayerControls').style.visibility = 'hidden'
      }, bounds)
      // Playwright's viewport screenshot clips zoomed Electron windows. Capture
      // the compositor directly so fractional UI scales sample the real pixels.
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } })
      const { data } = await cdp.send('Page.captureScreenshot')
      await cdp.send('Emulation.setDefaultBackgroundColorOverride')
      await cdp.detach()
      const screenshot = Buffer.from(data, 'base64')
      const pixel = await page.evaluate(async ({ imageData, bounds }) => {
        const image = new Image()
        image.src = `data:image/png;base64,${imageData}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width; canvas.height = image.height
        const context = canvas.getContext('2d')
        context.drawImage(image, 0, 0)
        const scale = image.width / innerWidth
        return [...context.getImageData(Math.floor((bounds.x + bounds.width / 2) * scale),
          Math.floor((bounds.y + bounds.height / 2) * scale), 1, 1).data]
      }, { imageData: screenshot.toString('base64'), bounds })
      expect(pixel[3], 'Page content must not paint inside the native video window').toBe(0)
      await page.evaluate(() => window.nativeScreenTest.destroy())
    })
    test('inline video transparency scrolls with the page before a bridge update', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      await setWindowSize(app, page, { width: 480, height: 850 })
      await page.evaluate(() => window.scrollTo(0, 80))
      await openNativeScreen(page, false)
      const player = page.locator('.ftVideoPlayer')
      await player.evaluate(element => { element.querySelector('.shaka-controls-container').style.visibility = 'hidden' })
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      await page.evaluate(() => { window.holdNativeLayout = true; window.scrollTo(0, 0) })
      const bounds = await player.boundingBox()
      const screenshot = await page.screenshot({ omitBackground: true })
      const alpha = await page.evaluate(async ({ data, bounds }) => {
        const image = new Image()
        image.src = `data:image/png;base64,${data}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width; canvas.height = image.height
        const context = canvas.getContext('2d')
        context.drawImage(image, 0, 0)
        const scale = image.width / innerWidth
        return context.getImageData(Math.floor((bounds.x + bounds.width / 2) * scale),
          Math.floor((bounds.y + bounds.height - 12) * scale), 1, 1).data[3]
      }, { data: screenshot.toString('base64'), bounds })
      expect(alpha, 'The native video opening must move with page scrolling, even while JS geometry is delayed').toBe(0)
      await page.evaluate(() => window.nativeScreenTest.destroy())
    })
    test('scroll handoff refreshes the mini-player clip before restoring shared controls', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      await openNativeScreen(page, false)
      await page.evaluate(() => { document.querySelector('.watchVideoInfo').style.minHeight = '2500px' })
      const player = page.locator('.ftVideoPlayer')
      await player.evaluate(element => window.scrollTo(0, window.scrollY + element.getBoundingClientRect().bottom + 200))
      await expect(player).toHaveClass(/scrollMiniPlayer/)
      await expect(player).not.toHaveClass(/scrollMiniPlayerAnimating/)
      await player.evaluate(element => document.querySelector('#cross-tab-mini-player-layer').append(element))
      await expect(page.locator('[data-native-player-backdrop]')).toBeAttached()
      await expect.poll(() => page.evaluate(() => window.nativeLayoutTest.miniPlayer)).toBe(true)
      const result = await page.evaluate(() => {
        window.nativeScreenTest.action('scroll-start')
        const player = document.querySelector('.ftVideoPlayer')
        const hidden = getComputedStyle(player.querySelector('.scrollMiniPlayerControls')).visibility
        window.scrollBy(0, 180)
        const calls = []
        window.nativeScreenTestController.layout = async value => calls.push(value)
        window.nativeScreenTest.action('scroll-end')
        const content = document.querySelector('[data-native-player-backdrop]')
        const clip = getComputedStyle(content).clipPath.match(/path\(evenodd, "(.+)"\)/)[1]
        const bounds = player.getBoundingClientRect()
        const origin = content.getBoundingClientRect()
        const context = document.createElement('canvas').getContext('2d')
        return {
          hidden,
          restored: getComputedStyle(player.querySelector('.scrollMiniPlayerControls')).visibility,
          occluded: context.isPointInPath(new Path2D(clip), bounds.x + bounds.width / 2 - origin.x,
            bounds.y + bounds.height / 2 - origin.y, 'evenodd'),
          refreshedBeforeHandoff: calls[0].miniPlayer && calls[1].endScroll,
        }
      })
      expect(result).toEqual({ hidden: 'hidden', restored: 'visible', occluded: false, refreshedBeforeHandoff: true })
      await page.evaluate(() => window.nativeScreenTest.destroy())
    })
    test('keeps a transparent rounded video window and an opaque themed page', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      await openNativeScreen(page, false)
      const player = page.locator('.ftVideoPlayer')
      await player.evaluate(element => {
        element.style.borderRadius = '24px'
        element.querySelector('.shaka-controls-container').style.visibility = 'hidden'
        for (const canvas of element.closest('.ftVideoPlayerHost').querySelectorAll('.ambientCanvas, .ambientLayoutCanvas')) {
          canvas.style.display = 'block'
          canvas.getContext('2d').fillStyle = 'red'
          canvas.getContext('2d').fillRect(0, 0, canvas.width, canvas.height)
        }
      })
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.body, '::before').clipPath)).toContain('path(')
      const bounds = await player.boundingBox()
      const screenshot = await page.screenshot({ omitBackground: true })
      const pixels = await page.evaluate(async ({ imageData, bounds }) => {
        const image = new Image()
        image.src = `data:image/png;base64,${imageData}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width; canvas.height = image.height
        const context = canvas.getContext('2d')
        context.drawImage(image, 0, 0)
        const scale = image.width / innerWidth
        const sample = (x, y) => [...context.getImageData(Math.floor(x * scale), Math.floor(y * scale), 1, 1).data]
        return {
          center: sample(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
          corner: sample(bounds.x + 1, bounds.y + 1),
          outside: sample(bounds.x + bounds.width / 2, Math.max(0, bounds.y - 10)),
        }
      }, { imageData: screenshot.toString('base64'), bounds })
      expect(pixels.center[3]).toBe(0)
      expect(pixels.corner[3]).toBe(255)
      expect(pixels.outside[3]).toBe(255)
      await page.evaluate(() => window.nativeScreenTest.destroy())
      await expect(page.locator('html')).not.toHaveClass(/nativePlaybackInline/)
    })
  })
}

test('closing an inactive player cannot remove the active inline surface window', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await openNativeScreen(page, false)
  await expect(page.locator('html')).toHaveClass(/nativePlaybackInline/)
  const clip = await page.evaluate(() => document.documentElement.style.getPropertyValue('--native-inline-background-clip'))
  await page.evaluate(() => {
    const container = document.createElement('div')
    const element = document.createElement('video')
    container.append(element)
    const inactive = window.createNativeScreenTest({ element, container, getController: () => null, getLocale: () => 'en-US', onError: error => { throw error } })
    inactive.reset()
    inactive.destroy()
  })
  await expect(page.locator('html')).toHaveClass(/nativePlaybackInline/)
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--native-inline-background-clip'))).toBe(clip)
  await page.evaluate(() => window.nativeScreenTest.destroy())
})

test('global Quick Settings clips native controls wherever its menu overlaps inline video', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await setWindowSize(app, page, { width: 760, height: 850 })
  await openNativeScreen(page, false)
  await video.evaluate(element => element.ui.getControls().showUI())
  await page.locator('.profileTrigger').click()
  const menu = page.locator('.quickSettingsMenu')
  await expect(menu).toBeVisible()
  await expect.poll(async () => {
    const bounds = await menu.boundingBox()
    return page.evaluate(bounds => window.nativeLayoutTest.menus.some(menu =>
      Math.abs(menu.x - bounds.x) < 1 && Math.abs(menu.y - bounds.y) < 1 &&
      Math.abs(menu.width - bounds.width) < 1 && Math.abs(menu.height - bounds.height) < 1), bounds)
  }).toBe(true)
  await page.locator('.profileTrigger').click()
  await expect(menu).not.toBeVisible()
  await expect.poll(() => page.evaluate(() => window.nativeLayoutTest.overlayActive)).toBe(false)
  await page.evaluate(() => window.nativeScreenTest.destroy())
})

test('touch controls do not retain a mouse tooltip after hiding and showing the player', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await enableMobileInput(page)
  await openMockedVideo(page)
  await openNativeScreen(page)
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true)
  const settings = page.locator('.shaka-overflow-menu-button')
  await settings.click()
  await page.evaluate(() => document.querySelector('.ftVideoPlayer video').ui.getControls().hideSettingsMenus())
  const surface = page.locator('.shaka-controls-container')
  // Mobile surface taps suppress synthetic mouse events. The browser can keep
  // the cog's old :hover state even after controls hide and appear again.
  for (const pointerId of [41, 42]) {
    const pointer = { pointerId, pointerType: 'touch', isPrimary: true, button: 0, clientX: 400, clientY: 150 }
    await surface.dispatchEvent('pointerdown', pointer)
    await surface.dispatchEvent('pointerup', pointer)
    await surface.dispatchEvent('touchend', { touches: [] })
  }
  await expect(surface).toHaveAttribute('shown', 'true')
  await expect.poll(() => settings.evaluate(element => getComputedStyle(element, '::after').content)).toBe('none')
  await page.keyboard.press('Tab')
  await settings.focus()
  await expect.poll(() => settings.evaluate(element => getComputedStyle(element, '::after').content)).not.toBe('none')
  await page.evaluate(() => window.nativeScreenTest.destroy())
})

for (const paused of [true, false]) {
  test(`mobile speed hold preserves hidden controls while ${paused ? 'paused' : 'playing'}`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await enableMobileInput(page)
    const video = await openMockedVideo(page)
    await openNativeScreen(page)
    if (!paused) await video.evaluate(element => element.play())
    await video.evaluate(element => {
      const controls = element.ui.getControls()
      controls.getConfig().showUIOnPaused = false
      controls.hideUI()
    })
    const surface = page.locator('.shaka-controls-container')
    await expect(surface).not.toHaveAttribute('shown')
    const pointer = { pointerId: 31, pointerType: 'touch', isPrimary: true, button: 0, clientX: 300, clientY: 150 }
    await surface.dispatchEvent('pointerdown', pointer)
    await surface.evaluate(element => {
      const event = new MouseEvent('mousemove', { bubbles: true })
      Object.defineProperty(event, 'sourceCapabilities', { value: { firesTouchEvents: true } })
      element.dispatchEvent(event)
    })
    try {
      await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(2)
      await expect(page.locator('.valueChangePopup')).toContainText('2x')
      expect(await surface.evaluate(element => element.hasAttribute('shown'))).toBe(false)
    } finally {
      await surface.dispatchEvent('pointerup', pointer)
      await surface.dispatchEvent('touchend', { touches: [] })
    }
    await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(1)
    await expect(surface).not.toHaveAttribute('shown')
    await page.evaluate(() => window.nativeScreenTest.destroy())
  })
}

test('mobile hold doubles speed without a context menu and restores playback on release', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await enableMobileInput(page)
  const video = await openMockedVideo(page)
  await openNativeScreen(page)
  await video.evaluate(element => { element.playbackRate = 1.5 })
  const surface = page.locator('.shaka-controls-container')
  const pointer = { pointerId: 21, pointerType: 'touch', isPrimary: true, button: 0, clientX: 300, clientY: 150 }
  await surface.dispatchEvent('pointerdown', pointer)
  try {
    await expect.poll(() => video.evaluate(element => element.playbackRate), { timeout: 1500 }).toBe(3)
    expect(await surface.evaluate(element => !element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))).toBe(true)
    await expect(page.locator('.shaka-context-menu')).not.toBeVisible()
  } finally {
    await surface.dispatchEvent('pointerup', pointer)
  }
  await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(1.5)
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(true)
  // A swipe must cancel a pending hold, and an interrupted active hold must
  // restore the original speed and paused state.
  await surface.dispatchEvent('pointerdown', pointer)
  await surface.dispatchEvent('pointermove', { ...pointer, clientX: pointer.clientX + 30 })
  await page.waitForTimeout(750)
  expect(await video.evaluate(element => element.playbackRate)).toBe(1.5)
  await surface.dispatchEvent('pointerup', pointer)
  await surface.dispatchEvent('pointerdown', pointer)
  await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(3)
  await surface.dispatchEvent('pointercancel', pointer)
  await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(1.5)
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(true)
  await page.evaluate(() => window.nativeScreenTest.destroy())
})

test('SponsorBlock touch actions do not reveal hidden player controls', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await enableMobileInput(page)
  await openMockedVideo(page)
  await openNativeScreen(page)
  await page.locator('.ftVideoPlayer video').evaluate(async element => { element.loop = true; await element.play() })
  const watch = await page.evaluateHandle(findWatchComponent)
  await watch.evaluate(component => {
    const element = document.querySelector('.ftVideoPlayer')
    component.refs.player.$.setupState.promptSponsorBlockSegments = [{ uuid: 'touch-notice', translatedCategory: 'Sponsor', color: '#00ff00', segment: [0, 20] }]
    const controls = element.querySelector('video').ui.getControls()
    controls.getConfig().showUIOnPaused = false
    controls.hideUI()
  })
  const controls = page.locator('.shaka-controls-container')
  const notice = page.locator('.skippedSegmentsWrapper')
  await expect(notice).toBeVisible()
  await expect.poll(() => notice.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return window.nativeLayoutTest.menus.some(menu => Math.abs(menu.x - bounds.x) < 1 && Math.abs(menu.y - bounds.y) < 1)
  }), { timeout: 1500 }).toBe(true)
  await expect(controls).not.toHaveAttribute('shown')
  await notice.dispatchEvent('touchmove', { touches: [{ identifier: 1, clientX: 500, clientY: 350 }] })
  await notice.dispatchEvent('touchend', { touches: [] })
  await notice.dispatchEvent('mousemove')
  await page.waitForTimeout(150)
  await expect(controls).not.toHaveAttribute('shown')
  const close = notice.locator('.closeSkippedSegmentButton')
  await close.dispatchEvent('touchend', { touches: [] })
  await close.click()
  await expect(notice).not.toBeVisible()
  await expect(controls).not.toHaveAttribute('shown')
  await page.evaluate(() => window.nativeScreenTest.destroy())
})

test('native player initially attaches inline and enters fullscreen only on request', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await openNativeScreen(page, false)
  const player = page.locator('.ftVideoPlayer')
  await expect(player).toHaveAttribute('data-native-player-controls')
  await expect(player).not.toHaveAttribute('data-native-player-screen')
  await player.locator('.shaka-fullscreen-button').click()
  await expect(player).toHaveAttribute('data-native-player-screen')
  await page.evaluate(() => window.nativeScreenTest.destroy())
})

test('native fullscreen dock stays tappable after hovering a toolbar button', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await page.locator('.app').evaluate(element => element.classList.add('capacitorTabs'))
  await openNativeScreen(page)
  await page.locator('.shaka-overflow-menu-button').hover()
  expect(await page.locator('.fullscreenActions').evaluate(dock => [...dock.querySelectorAll('button')].every(button => {
    const r = button.getBoundingClientRect()
    return !r.width || button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
  }))).toBe(true)
  await page.evaluate(() => window.nativeScreenTest.destroy())
})

test('native dock follows hidden controls after opening a panel by touch', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await page.locator('.app').evaluate(element => element.classList.add('capacitorTabs'))
  await openNativeScreen(page)
  const button = page.locator('.fullscreenCommentsToggle')
  await button.click()
  await expect(button).toBeFocused()
  await expect(page.locator('.ftVideoPlayer')).toHaveClass(/fullscreenCommentsOpen/)
  await page.evaluate(() => {
    const controls = document.querySelector('.ftVideoPlayer video').ui.getControls()
    controls.getConfig().showUIOnPaused = false
    controls.hideUI()
  })
  await expect(page.locator('.shaka-controls-container')).not.toHaveAttribute('shown')
  const dock = page.locator('.fullscreenActions')
  await expect(dock).toHaveCSS('opacity', '0')
  await expect(dock).toHaveCSS('pointer-events', 'none')
  await page.evaluate(() => {
    const controls = document.querySelector('.ftVideoPlayer video').ui.getControls()
    controls.getConfig().fadeDelay = 60
    controls.showUI()
  })
  await expect(dock).toHaveCSS('opacity', '1')
  await page.evaluate(() => window.nativeScreenTest.destroy())
})

for (const scale of [1, 1.25]) {
  test(`native toolbar moves optional controls to settings and back at scale ${scale}`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    await page.evaluate(scale => window.ftElectron.setZoomFactor(scale), scale)
    await openNativeScreen(page)
    await video.evaluate(async element => {
      const player = element.ui.getControls().getPlayer()
      const url = URL.createObjectURL(new Blob(['WEBVTT\n\n00:00:00.000 --> 00:00:20.000\nTest caption\n'], { type: 'text/vtt' }))
      try {
        await player.addTextTrackAsync(url, 'en', 'subtitles', 'text/vtt', undefined, 'Test captions')
      } finally {
        URL.revokeObjectURL(url)
      }
      // Use the Android toolbar arrangement in Electron, keeping the actual
      // adaptive layout observer and controls. Android PiP execution is tested
      // on-device; its menu copy here only exercises responsive visibility.
      const panel = document.querySelector('.shaka-controls-button-panel')
      const pip = panel.querySelector('.shaka-pip-button')
      pip.classList.remove('shaka-hidden')
      document.querySelector('.shaka-overflow-menu').append(pip.cloneNode(true))
      for (const child of [...panel.children]) {
        if (!child.matches('.ft-time-display-group, .shaka-current-time, .shaka-spacer, .ft-quick-playback-rate-bar, .caption-toggle-button, .shaka-pip-button, .shaka-overflow-menu-button, .shaka-fullscreen-button')) child.remove()
      }
      panel.style.width = '700px'
    })
    const panel = page.locator('.shaka-controls-button-panel')
    const pip = panel.locator('.shaka-pip-button')
    const captions = panel.locator('.caption-toggle-button')
    const menuPip = page.locator('.shaka-overflow-menu .shaka-pip-button')
    await page.locator('.shaka-overflow-menu-button').click()
    await expect(pip).toBeVisible()
    await expect(captions).toBeVisible()
    await panel.evaluate(element => { element.style.width = '260px' })
    await expect(pip).not.toBeVisible()
    await expect(captions).not.toBeVisible()
    await expect(menuPip).toBeVisible()
    await expect(page.locator('.shaka-overflow-menu .shaka-caption-button')).toBeVisible()
    await page.evaluate(() => document.querySelector('.ftVideoPlayer video').ui.getControls().hideSettingsMenus())
    await page.locator('.shaka-overflow-menu-button').click()
    await panel.evaluate(element => { element.style.width = '700px' })
    await expect(pip).toBeVisible()
    await expect(captions).toBeVisible()
    await expect(menuPip).not.toBeVisible()
    await page.evaluate(() => window.nativeScreenTest.destroy())
  })
}

for (const scale of [1, 1.25]) {
  test(`resolution badge stays inside its grid tile at scale ${scale}`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await page.evaluate(scale => window.ftElectron.setZoomFactor(scale), scale)
    await openNativeScreen(page)
    await page.evaluate(() => {
      document.querySelector('.ftVideoPlayer video').ui.configure({ overflowMenuButtons: ['quality', 'playback_rate', 'captions'] })
      document.querySelector('.shaka-resolution-button').classList.remove('shaka-hidden')
    })
    await page.locator('.shaka-overflow-menu-button').click()
    const quality = page.locator('.shaka-overflow-menu .shaka-resolution-button')
    await quality.evaluate(button => {
      button.closest('.shaka-overflow-menu').classList.add('ft-menu-grid')
      button.style.inlineSize = '94px'
      button.style.boxSizing = 'border-box'
      button.querySelector('.shaka-current-selection-span').textContent = '1080p (12.7 Mbps)'
      const mark = button.querySelector('.shaka-current-quality-mark')
      mark.textContent = 'HD'
      mark.style.display = ''
      button.classList.remove('shaka-hidden')
    })
    await expect(quality).toBeVisible()
    expect(await quality.evaluate(button => {
      const badge = button.querySelector('.shaka-current-quality-mark')
      const r = badge.getBoundingClientRect()
      for (let e = badge.parentElement; e && button.contains(e); e = e.parentElement) {
        const bounds = e.getBoundingClientRect()
        if (r.left < bounds.left - 0.5 || r.top < bounds.top - 0.5 || r.right > bounds.right + 0.5 || r.bottom > bounds.bottom + 0.5) return false
      }
      return true
    })).toBe(true)
    await page.evaluate(() => window.nativeScreenTest.destroy())
  })
}

for (const scale of [1, 1.25]) {
  test(`resolution submenu badges stay beside multiline labels at scale ${scale}`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await page.evaluate(scale => window.ftElectron.setZoomFactor(scale), scale)
    await enableMobileInput(page)
    await openNativeScreen(page)
    await page.evaluate(() => {
      const video = document.querySelector('.ftVideoPlayer video')
      const player = video.ui.getControls().getPlayer()
      player.getVideoTracks = () => [
        { active: true, width: 3840, height: 2160, bandwidth: 11700000, codecs: 'vp09', roles: [] },
        { active: false, width: 3840, height: 2160, bandwidth: 5200000, codecs: 'av01', roles: [] },
        { active: false, width: 1920, height: 1080, bandwidth: 1400000, codecs: 'vp09', roles: [] },
      ]
      video.ui.configure({ overflowMenuButtons: ['quality'], showVideoCodec: true })
    })
    await page.locator('.shaka-overflow-menu-button').click()
    await page.locator('.shaka-resolution-button').click()
    const choices = page.locator('.shaka-resolutions .explicit-resolution')
    await expect(choices).toHaveCount(3)
    for (const choice of await choices.all()) {
      expect(await choice.evaluate(button => {
        const label = button.querySelector('span').getBoundingClientRect()
        const badge = button.querySelector('.shaka-quality-mark').getBoundingClientRect()
        const tile = button.getBoundingClientRect()
        return badge.left >= label.right && badge.right <= tile.right - 2 &&
          badge.top >= tile.top && badge.bottom <= tile.bottom &&
          badge.top < label.bottom && badge.bottom > label.top
      })).toBe(true)
    }
    await page.evaluate(() => window.nativeScreenTest.destroy())
  })
}

for (const scale of [1, 1.25]) {
  test(`native fullscreen information scrolls its content without scrolling Watch at scale ${scale}`, async ({ app, page }) => {
    await setWindowSize(app, page, { width: 1200, height: 700 })
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await page.evaluate(scale => window.ftElectron.setZoomFactor(scale), scale)
    await openNativeScreen(page)
    await page.locator('.playerFullscreenTitleOverlay').click()
    const target = page.locator('.fullscreenMetadataTarget')
    const description = target.locator('.description')
    await description.evaluate(element => { element.textContent = 'Description line\n'.repeat(100) })
    await target.evaluate(element => { element.scrollTop = 0 })
    await target.hover()
    await page.waitForTimeout(500)
    const header = page.locator('.fullscreenMetadataHeader')
    const headerBefore = await header.boundingBox()
    const title = target.locator('.videoTitle')
    const titleBefore = await title.boundingBox()
    await target.hover()
    await page.mouse.wheel(0, 240)
    await expect.poll(() => title.boundingBox().then(bounds => bounds.y)).toBeLessThan(titleBefore.y - 50)
    expect((await header.boundingBox()).y).toBeCloseTo(headerBefore.y, 0)

    await target.evaluate(element => { element.scrollTop = element.scrollHeight })
    const pageTop = await page.evaluate(() => document.scrollingElement.scrollTop)
    await target.hover()
    await page.mouse.wheel(0, 700)
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => document.scrollingElement.scrollTop)).toBe(pageTop)

    // A short panel must neither retain an obsolete offset nor pass swipes
    // through to the hidden Watch page. Reopening also starts at the top.
    await description.evaluate(element => { element.textContent = 'Short description' })
    await expect.poll(() => target.evaluate(element => element.scrollTop <= Math.max(0, element.scrollHeight - element.clientHeight) + 1)).toBe(true)
    await target.hover()
    await page.mouse.wheel(0, 700)
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => document.scrollingElement.scrollTop)).toBe(pageTop)
    await page.locator('.fullscreenMetadataClose').click()
    await page.locator('.playerFullscreenTitleOverlay').click()
    await expect.poll(() => target.evaluate(element => element.scrollTop)).toBe(0)
    await page.evaluate(() => window.nativeScreenTest.destroy())
  })
}

test('native fullscreen retains interactive A-B repeat markers on the seek timeline', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await openNativeScreen(page)
  await video.evaluate(element => { element.currentTime = 2 })
  await page.locator('.shaka-overflow-menu-button').click()
  await page.getByRole('button', { name: /^Set repeat start/ }).click()
  await page.evaluate(() => document.querySelector('.ftVideoPlayer video').ui.getControls().hideSettingsMenus())
  const marker = page.locator('.abRepeatMarkerA')
  await expect(marker).toBeVisible()
  const before = await marker.getAttribute('aria-label')
  const bounds = await marker.boundingBox()
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width / 2 + 60, bounds.y + bounds.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(marker).not.toHaveAttribute('aria-label', before)
  await page.locator('.shaka-overflow-menu-button').click()
  await expect(page.locator('.shaka-seek-bar-container')).toBeVisible()
  await expect(marker).toBeVisible()
  await page.getByRole('button', { name: 'Playback speed', exact: true }).click()
  await expect(page.locator('.shaka-seek-bar-container')).toBeVisible()
  await page.evaluate(() => document.querySelector('.ftVideoPlayer video').ui.getControls().hideSettingsMenus())
  await expect(marker).toBeVisible()
  await page.evaluate(() => window.nativeScreenTest.destroy())
})

test('inline player uses native transport controls and follows scroll and menu geometry', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await openNativeScreen(page)
  await page.locator('.shaka-fullscreen-button').click()
  const player = page.locator('.ftVideoPlayer')
  await expect(player).not.toHaveAttribute('data-native-player-screen')
  await expect(player).toHaveAttribute('data-native-player-controls')
  await expect(player.locator('.shaka-big-buttons-container')).not.toBeVisible()
  await player.evaluate(element => element.querySelector('video').ui.getControls().showUI())
  await expect.poll(() => page.evaluate(() => window.nativeLayoutTest.controlsVisible)).toBe(true)
  await player.locator('.shaka-overflow-menu-button').click()
  await expect.poll(() => page.evaluate(() => window.nativeLayoutTest.menus.length)).toBeGreaterThan(0)
  await expect.poll(() => page.evaluate(() => window.nativeLayoutTest.controlsVisible)).toBe(true)
  await page.evaluate(() => document.querySelector('.ftVideoPlayer video').ui.getControls().hideSettingsMenus())
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await expect.poll(() => page.evaluate(() => window.nativeLayoutTest.controlsVisible)).toBe(false)
  await page.evaluate(() => window.scrollTo(0, 0))
  await player.evaluate(element => element.querySelector('video').ui.getControls().showUI())
  await expect.poll(() => page.evaluate(() => window.nativeLayoutTest.controlsVisible)).toBe(true)
  await page.evaluate(() => window.nativeScreenTest.destroy())
})

test('inline native settings receive taps above the expanded seek touch target', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await page.locator('.app').evaluate(element => element.classList.add('capacitorTabs'))
  await openNativeScreen(page, false)
  await page.locator('.ftVideoPlayer').evaluate(element => {
    element.style.width = '460px'
    element.style.height = '260px'
  })
  await page.locator('.shaka-overflow-menu-button').click()
  expect(await page.evaluate(() => {
    const menu = document.querySelector('.shaka-overflow-menu:not(.shaka-hidden)')
    const bounds = menu.getBoundingClientRect()
    const seek = document.querySelector('.shaka-seek-bar').getBoundingClientRect()
    const x = Math.min(bounds.right, seek.right) - 20
    const y = Math.min(bounds.bottom, seek.bottom) - 2
    return y >= Math.max(bounds.top, seek.top) && menu.contains(document.elementFromPoint(x, y))
  })).toBe(true)
  await page.evaluate(() => window.nativeScreenTest.destroy())
})

test('native screen retains caption and quick speed controls beneath settings', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await openNativeScreen(page)
  await video.evaluate(async element => {
    const player = element.ui.getControls().getPlayer()
    const url = URL.createObjectURL(new Blob(['WEBVTT\n\n00:00:00.000 --> 00:00:20.000\nTest caption\n'], { type: 'text/vtt' }))
    try {
      await player.addTextTrackAsync(url, 'en', 'subtitles', 'text/vtt', undefined, 'Test captions')
    } finally {
      URL.revokeObjectURL(url)
    }
  })
  await expect(page.locator('.shaka-controls-button-panel')).toBeVisible()
  await expect(page.locator('.ft-quick-playback-rate-bar')).toBeVisible()
  const captions = page.locator('.caption-toggle-button')
  await expect(captions).toBeVisible()
  await captions.click()
  await expect(captions).toHaveAttribute('aria-pressed', 'true')
  await captions.click()
  await expect(captions).toHaveAttribute('aria-pressed', 'false')
  await page.locator('.ft-quick-playback-rate-bar').getByRole('button', { name: '1.5x', exact: true }).click()
  await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(1.5)
  await expect(page.locator('.shaka-fullscreen-button')).toBeVisible()
  await page.locator('.shaka-overflow-menu-button').click()
  await expect(page.locator('.shaka-controls-button-panel')).toBeVisible()
  await expect(page.locator('.shaka-seek-bar-container')).toBeVisible()
  expect(await page.evaluate(() => {
    const menu = document.querySelector('.shaka-overflow-menu:not(.shaka-hidden)')
    const menuBounds = menu.getBoundingClientRect()
    const seek = document.querySelector('.shaka-seek-bar-container').getBoundingClientRect()
    const x = Math.max(menuBounds.left, seek.left) + 10
    const y = Math.min(menuBounds.bottom, seek.bottom) - 2
    return y >= Math.max(menuBounds.top, seek.top) && menu.contains(document.elementFromPoint(x, y))
  })).toBe(true)
  await page.getByRole('button', { name: 'Playback speed', exact: true }).click()
  await expect(page.locator('.shaka-controls-button-panel')).toBeVisible()
  await page.evaluate(() => window.nativeScreenTest.destroy())
})

for (const scale of [1, 1.25]) {
  test(`Android chapter title moves between toolbar and menu as space changes at scale ${scale}`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await setWindowSize(app, page, { width: 480, height: 800 })
    await enableMobileInput(page)
    await page.evaluate(scale => window.ftElectron.setZoomFactor(scale), scale)
    const watch = await page.evaluateHandle(findWatchComponent)
    await watch.evaluate(instance => {
      instance.proxy.videoChapters = [
        { title: 'Opening', startSeconds: 0, endSeconds: 5 },
        { title: 'Next chapter', startSeconds: 5, endSeconds: 30 },
      ]
    })
    await openNativeScreen(page)
    const toolbar = page.locator('.shaka-controls-button-panel')
    await toolbar.evaluate(element => { element.style.width = '1000px' })
    const chapter = toolbar.locator('.ft-chapters-button')
    await expect(chapter).toBeVisible()
    await expect(chapter.locator('.ft-chapters-current-title')).toHaveText('Opening')
    await page.evaluate(() => { document.querySelector('.ftVideoPlayer video').currentTime = 7 })
    await expect(chapter.locator('.ft-chapters-current-title')).toHaveText('Next chapter')
    await chapter.click()
    await expect(page.locator('.chapterOverlay')).toBeVisible()
    await page.locator('.chapterOverlayClose').click()
    await toolbar.evaluate(element => { element.style.width = '260px' })
    await expect(chapter).not.toBeVisible()
    await page.evaluate(() => document.querySelector('.shaka-overflow-menu-button').click())
    const menuChapter = page.locator('.shaka-overflow-menu .ft-chapters-button')
    await expect(menuChapter).toBeVisible()
    await toolbar.evaluate(element => { element.style.width = '1000px' })
    await expect(chapter).toBeVisible()
    await expect(menuChapter).not.toBeVisible()
    await page.evaluate(() => window.nativeScreenTest.destroy())
  })
}

for (const scale of [1, 1.25]) {
  test(`native fullscreen ambient glow stays outside the video at scale ${scale}`, async ({ app, page }) => {
    await setWindowSize(app, page, { width: 1200, height: 800 })
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    await page.evaluate(scale => window.ftElectron.setZoomFactor(scale), scale)
    await video.evaluate(element => {
      Object.defineProperty(element, 'videoWidth', { configurable: true, value: 640 })
      Object.defineProperty(element, 'videoHeight', { configurable: true, value: 480 })
    })
    await openNativeScreen(page)
    await page.evaluate(() => {
      // Blue stands in for the native surface below the transparent WebView.
      document.querySelector('.ftVideoPlayer').style.setProperty('background', 'rgb(0, 0, 255)', 'important')
      const canvas = document.querySelector('.ambientFullscreenCanvas')
      canvas.style.setProperty('display', 'block', 'important')
      canvas.style.setProperty('opacity', '1', 'important')
      const context = canvas.getContext('2d')
      context.fillStyle = 'red'
      context.fillRect(0, 0, canvas.width, canvas.height)
      const controls = document.querySelector('.ftVideoPlayer video').ui.getControls()
      controls.getConfig().showUIOnPaused = false
      controls.hideUI()
    })
    for (const [width, height] of [[1100, 750], [1000, 700]]) {
      await setWindowSize(app, page, { width, height })
      await page.waitForTimeout(300)
      const bounds = await video.boundingBox()
      const sample = async x => {
        const png = await page.screenshot({ clip: { x, y: bounds.y + bounds.height / 2, width: 1, height: 1 } })
        return page.evaluate(async data => {
          const image = new Image()
          image.src = `data:image/png;base64,${data}`
          await image.decode()
          const canvas = document.createElement('canvas')
          canvas.width = canvas.height = 1
          const context = canvas.getContext('2d')
          context.drawImage(image, 0, 0)
          return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
        }, png.toString('base64'))
      }
      // The image stays blue; pillarboxes glow red.
      expect(await sample(bounds.x + bounds.width / 2)).toEqual([0, 0, 255])
      expect((await sample(bounds.x + 10))[0]).toBeGreaterThan(100)
    }
    await page.evaluate(() => window.nativeScreenTest.destroy())
  })
}

for (const scale of [1, 1.25]) {
  test(`upward swipes from Android toolbar buttons enter fullscreen without activating them at scale ${scale}`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    await enableMobileInput(page)
    await page.evaluate(scale => window.ftElectron.setZoomFactor(scale), scale)
    await openNativeScreen(page, false)
    const cdp = await page.context().newCDPSession(page)
    try {
      for (const selector of ['.shaka-overflow-menu-button', '.ft-quick-playback-rate-button[data-rate="1.5"]']) {
        await expect(page.locator('.ftVideoPlayer')).not.toHaveClass(/presentationModeChanging/)
        await video.evaluate(element => element.ui.getControls().showUI())
        const button = page.locator(selector)
        const bounds = await button.boundingBox()
        const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
        // Model a 200ms swipe. Back-to-back CDP moves at fractional zoom can
        // leave Chromium suppressing the next stationary tap's generated click.
        for (let distance = 12; distance <= 96; distance += 12) {
          await page.waitForTimeout(25)
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, y: point.y - distance }] })
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await expect(page.locator('.ftVideoPlayer')).toHaveAttribute('data-native-player-screen', '')
        await expect(page.locator('.shaka-overflow-menu')).not.toBeVisible()
        expect(await video.evaluate(element => element.playbackRate)).toBe(1)
        expect(await video.evaluate(element => element.paused)).toBe(true)
        await page.evaluate(() => window.nativeScreenTest.hide())
      }
      // A stationary touch still opens settings normally.
      await expect(page.locator('.ftVideoPlayer')).not.toHaveClass(/presentationModeChanging/)
      await video.evaluate(element => element.ui.getControls().showUI())
      const bounds = await page.locator('.shaka-overflow-menu-button').boundingBox()
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect(page.locator('.shaka-overflow-menu')).toBeVisible()
      await expect(page.locator('.ftVideoPlayer')).not.toHaveAttribute('data-native-player-screen')
    } finally {
      await cdp.detach()
      await page.evaluate(() => window.nativeScreenTest.destroy())
    }
  })
}

for (const fullscreen of [false, true]) {
  for (const paused of [false, true]) {
    test(`two side taps seek with hidden and visible controls while ${paused ? 'paused' : 'playing'} ${fullscreen ? 'fullscreen' : 'inline'}`, async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await enableMobileInput(page)
      const video = await openMockedVideo(page)
      await openNativeScreen(page, fullscreen)
      // Playwright's viewport screenshot clips zoomed Electron windows. Capture
      // the compositor directly so fractional UI scales sample the real pixels.
      const cdp = await page.context().newCDPSession(page)
      try {
        for (const shown of [false, true]) {
          for (const direction of [-1, 1]) {
            await video.evaluate(async (element, { paused, shown }) => {
              element.currentTime = element.duration / 2
              if (!paused) await element.play()
              const controls = element.ui.getControls()
              controls.getConfig().tapSeekDistance = 2
              controls.getConfig().showUIOnPaused = shown
              // Exclude ordinary control timeout from this gesture-visibility check.
              controls.getConfig().fadeDelay = shown ? 60 : 0
              if (shown) controls.showUI()
              else controls.hideUI()
            }, { paused, shown })
            const controls = page.locator('.shaka-controls-container')
            await expect.poll(() => controls.evaluate(element => element.hasAttribute('shown'))).toBe(shown)
            const bounds = await page.locator('.ftVideoPlayer').boundingBox()
            const point = { x: bounds.x + bounds.width * (direction < 0 ? 0.15 : 0.85), y: bounds.y + bounds.height * 0.5 }
            const before = await video.evaluate(element => element.currentTime)
            for (let tap = 0; tap < 2; tap++) {
              await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
              await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
              if (tap === 0) await page.waitForTimeout(150)
            }
            const feedback = page.locator(direction < 0 ? '.shaka-rewind-container' : '.shaka-fast-forward-container')
            await expect(feedback).toHaveCSS('opacity', '1')
            await expect(feedback.locator('span')).toHaveText(`${direction * 2}s`)
            await expect(page.locator('.valueChangePopup')).not.toBeVisible()
            // Check the seek before normal playback consumes its backward jump.
            const delta = await video.evaluate(element => element.currentTime) - before
            expect(delta * direction).toBeGreaterThan(1)
            expect(delta * direction).toBeLessThan(3.5)
            // Still wait past the single-tap timeout to catch delayed UI toggles.
            await page.waitForTimeout(650)
            expect(await video.evaluate(element => element.paused)).toBe(paused)
            expect(await controls.evaluate(element => element.hasAttribute('shown'))).toBe(shown)
          }
        }
      } finally {
        await cdp.detach()
        await page.evaluate(() => window.nativeScreenTest.destroy())
      }
    })
  }
}

test('mobile side taps distinguish single taps, repeated seeks, opposite sides and menus', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await enableMobileInput(page)
  const video = await openMockedVideo(page)
  await openNativeScreen(page)
  const cdp = await page.context().newCDPSession(page)
  const controls = page.locator('.shaka-controls-container')
  const bounds = await page.locator('.ftVideoPlayer').boundingBox()
  const tap = async fraction => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bounds.x + bounds.width * fraction, y: bounds.y + bounds.height * 0.5 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  try {
    const start = await video.evaluate(element => {
      element.currentTime = element.duration / 2
      const controls = element.ui.getControls()
      controls.getConfig().tapSeekDistance = 1
      controls.getConfig().showUIOnPaused = false
      controls.getConfig().fadeDelay = 0
      controls.hideUI()
      return element.currentTime
    })
    await expect(controls).not.toHaveAttribute('shown')
    await tap(0.85)
    await page.waitForTimeout(280)
    await tap(0.85)
    expect(await video.evaluate(element => element.currentTime)).toBeCloseTo(start + 1, 1)
    await page.waitForTimeout(100)
    await tap(0.85)
    expect(await video.evaluate(element => element.currentTime)).toBeCloseTo(start + 2, 1)
    await page.waitForTimeout(400)
    await expect(controls).not.toHaveAttribute('shown')

    // A lone side tap toggles the controls once its double-tap window ends.
    await tap(0.15)
    await expect(controls).toHaveAttribute('shown', 'true')
    await page.waitForTimeout(400)
    await tap(0.15)
    await expect(controls).not.toHaveAttribute('shown')
    expect(await video.evaluate(element => element.currentTime)).toBeCloseTo(start + 2, 1)

    // A tap on each side is not a double tap in either direction.
    await tap(0.15)
    await page.waitForTimeout(100)
    await tap(0.85)
    await expect(controls).toHaveAttribute('shown', 'true')
    expect(await video.evaluate(element => element.currentTime)).toBeCloseTo(start + 2, 1)
    await page.locator('.shaka-overflow-menu-button').click()
    await tap(0.15)
    await expect(page.locator('.shaka-overflow-menu')).not.toBeVisible()
    await expect(controls).toHaveAttribute('shown', 'true')
    expect(await video.evaluate(element => element.currentTime)).toBeCloseTo(start + 2, 1)
  } finally {
    await cdp.detach()
    await page.evaluate(() => window.nativeScreenTest.destroy())
  }
})

test('double taps on invisible seek feedback text and icons still seek', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await enableMobileInput(page)
  const video = await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 850 })
  await openNativeScreen(page, false)
  const cdp = await page.context().newCDPSession(page)
  try {
    for (const [selector, direction] of [['.shaka-rewind-container span', -1], ['.shaka-fast-forward-container svg', 1]]) {
      const start = await video.evaluate(element => {
        element.currentTime = element.duration / 2
        const controls = element.ui.getControls()
        controls.getConfig().tapSeekDistance = 2
        controls.getConfig().showUIOnPaused = false
        controls.getConfig().fadeDelay = 0
        controls.hideUI()
        return element.currentTime
      })
      const controls = page.locator('.shaka-controls-container')
      await expect(controls).not.toHaveAttribute('shown')
      const bounds = await page.locator(selector).first().boundingBox()
      const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      for (let tap = 0; tap < 2; tap++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        if (tap === 0) await page.waitForTimeout(150)
      }
      await page.waitForTimeout(650)
      expect(await video.evaluate(element => element.currentTime)).toBeCloseTo(start + direction * 2, 1)
      await expect(controls).not.toHaveAttribute('shown')
    }
  } finally {
    await cdp.detach()
    await page.evaluate(() => window.nativeScreenTest.destroy())
  }
})

test('native fullscreen stays available when the WebView has no browser fullscreen support', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.evaluate(() => Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false }))
  const video = await openMockedVideo(page)
  const button = page.locator('.shaka-fullscreen-button')
  await expect(button).toBeHidden()
  await openNativeScreen(page, false)
  try {
    // The app binds native controls before applying its UI configuration.
    await video.evaluate(element => element.ui.configure({ tapSeekDistance: 5 }))
    for (const event of ['loadedmetadata', 'loadeddata']) {
      await video.evaluate((element, event) => {
        element.dispatchEvent(new Event(event))
        element.ui.getControls().showUI()
      }, event)
      await expect(button).toBeVisible()
      await button.click()
      await expect(page.locator('.ftVideoPlayer')).toHaveAttribute('data-native-player-screen')
      await button.click()
      await expect(page.locator('.ftVideoPlayer')).not.toHaveAttribute('data-native-player-screen')
    }
  } finally {
    await page.evaluate(() => window.nativeScreenTest.destroy())
  }
  expect(await video.evaluate(element => element.ui.getControls().isFullScreenSupported())).toBe(false)
})

test('native rotation returns to inline portrait and keeps the fullscreen button usable', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await enableMobileInput(page)
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateEnterFullscreenOnDisplayRotate', true))
  await openNativeScreen(page, false)
  await page.evaluate(() => {
    window.nativeOrientationTest = 'portrait-primary'
    Object.defineProperty(screen.orientation, 'type', { configurable: true, get: () => window.nativeOrientationTest })
    window.browserFullscreenCallsTest = []
    document.querySelector('.ftVideoPlayer').requestFullscreen = async () => { window.browserFullscreenCallsTest.push('enter') }
    document.exitFullscreen = async () => { window.browserFullscreenCallsTest.push('exit') }
  })
  const rotate = type => page.evaluate(type => {
    window.nativeOrientationTest = type
    screen.orientation.dispatchEvent(new Event('change'))
  }, type)
  const player = page.locator('.ftVideoPlayer')
  try {
    for (let cycle = 0; cycle < 2; cycle++) {
      await rotate('landscape-primary')
      await expect(player).toHaveAttribute('data-native-player-screen', '', { timeout: 1500 })
      expect(await page.evaluate(() => window.nativeScreenTest.isFullscreenFromRotation())).toBe(true)
      await rotate('portrait-primary')
      await expect(player).not.toHaveAttribute('data-native-player-screen')
      await video.evaluate(element => element.ui.getControls().showUI())
      await player.locator('.shaka-fullscreen-button').click()
      await expect(player).toHaveAttribute('data-native-player-screen')
      expect(await page.evaluate(() => window.nativeScreenTest.isFullscreenFromRotation())).toBe(false)
      await player.locator('.shaka-fullscreen-button').click()
      await expect(player).not.toHaveAttribute('data-native-player-screen')
      // Reconfiguring another setting must preserve the rotation preference.
      await video.evaluate(element => element.ui.configure({ tapSeekDistance: 5 }))
    }
    expect(await page.evaluate(() => window.browserFullscreenCallsTest)).toEqual([])
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateEnterFullscreenOnDisplayRotate', false))
    await rotate('landscape-primary')
    await page.waitForTimeout(200)
    await expect(player).not.toHaveAttribute('data-native-player-screen')
    expect(await video.evaluate(element => element.paused)).toBe(true)
  } finally {
    await page.evaluate(() => window.nativeScreenTest.destroy())
  }
})

for (const uiScale of [100, 125]) {
  test.describe(`fullscreen page hiding at ${uiScale}%`, () => {
    test.use({ seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true, uiScale } } })
    test('hides transitioning page buttons on the first fullscreen frame', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      await openNativeScreen(page, false)
      const subscribe = page.locator('.subscribeButton').first()
      // The shared button's transition: all animates inherited visibility too.
      const button = await subscribe.elementHandle()
      expect(await button.evaluate(element => element.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }))).toBe(true)
      const visible = await page.evaluate(async () => {
        const info = document.querySelector('.subscribeButton').closest('.watchVideoInfo')
        window.fullscreenPageBranch = info
        window.fullscreenPageBranchHeight = info.getBoundingClientRect().height
        window.nativeScreenTestController.show = () => new Promise(resolve => { window.finishFullscreenEntry = resolve })
        window.fullscreenEntry = window.nativeScreenTest.show()
        await new Promise(requestAnimationFrame)
        return document.querySelector('.subscribeButton').checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })
      })
      expect(visible, 'The first fullscreen frame must not contain Subscribe while its visibility transition runs').toBe(false)
      await page.evaluate(async () => { window.finishFullscreenEntry(); await window.fullscreenEntry })
      await expect(page.locator('[data-native-player-screen]')).toBeVisible()
      expect(await page.evaluate(() => window.fullscreenPageBranch.getBoundingClientRect().height)).toBeCloseTo(await page.evaluate(() => window.fullscreenPageBranchHeight), 0)
      await page.evaluate(() => window.nativeScreenTest.hide())
      await expect(subscribe).toBeVisible()
      await page.evaluate(() => window.nativeScreenTest.destroy())
    })
  })
}

test('desktop playback does not load Android document compositing styles', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const nativeStyles = await page.evaluate(() => [...document.styleSheets].some(sheet =>
    [...sheet.cssRules].some(rule => /\.nativePlayback(?:Inline|Screen)\b/.test(rule.cssText))
  ))
  expect(nativeStyles).toBe(false)
})
