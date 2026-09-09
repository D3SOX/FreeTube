import { test, expect, goToSettingsSection, setPlayerFullscreen } from '../../helpers/app.mjs'
import { sampleColors } from '../../helpers/colors.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

function contrastRatio(first, second) {
  const luminance = rgb => rgb.map(value => value / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0)
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

async function switchContrast(app, label, checked) {
  const height = await label.evaluate(element => element.getBoundingClientRect().height)
  // Sample the exposed half of the track, its adjacent background and the
  // thumb's center. Avoid rounded edges and the thumb's shadow.
  const trackX = checked ? 12 : 34
  const [track, surface, thumb] = await sampleColors(app, label, [
    [trackX, height / 2], [trackX, height / 2 - 15], [checked ? 30 : 15, height / 2]
  ])
  return { track, surface, thumb, trackRatio: contrastRatio(track, surface), thumbRatio: contrastRatio(thumb, track), thumbSurfaceRatio: contrastRatio(thumb, surface) }
}

async function controlContrast(app, control, kind) {
  const { page } = app
  await control.scrollIntoViewIfNeeded()
  const points = await control.evaluate((element, kind) => {
    const rect = element.getBoundingClientRect()
    const container = element.closest('.settingsWindow').getBoundingClientRect()
    const x = rect.left - container.left
    const y = rect.top - container.top + rect.height / 2
    // Locate the strongest edge pixel near the CSS boundary. Fractional zoom
    // can spread a one-pixel stroke across neighboring screenshot pixels.
    return kind === 'slider'
      ? [[x + rect.width * 0.85, y - 8], ...[-1, 0, 1].map(offset => [x + rect.width * 0.85, y + offset])]
      : [[x - 4, y], ...[-0.5, 0.5, 1.5].map(offset => [x + offset, y])]
  }, kind)
  const [surface, ...edge] = await sampleColors(app, page.locator('.settingsWindow'), points)
  return { surface, edge, ratio: Math.max(...edge.map(color => contrastRatio(color, surface))) }
}

for (const theme of ['openTubeXLight', 'openTubeXDark']) {
  for (const scale of [100, 125]) {
    test.describe(`${theme} comment contrast at ${scale}%`, () => {
      test.use({ seed: { settings: { baseTheme: theme, currentLocale: 'en-US', uiScale: scale } } })

      for (const fullscreen of [false, true]) {
        test(`comment thread lines and reply connectors remain visible in ${fullscreen ? 'fullscreen' : 'watch page'}`, async ({ app, page, attachScreenshot }) => {
          await mockPlayableWatchPage(app, page)
          await openMockedVideo(page)
          if (fullscreen) {
            await setPlayerFullscreen(page, true)
            await page.locator('.fullscreenCommentsToggle').click({ force: true })
            await expect(page.locator('.fullscreenCommentsOverlay.open')).toBeVisible()
          }
          const thread = page.locator('.commentThread').first()
          const connector = thread.locator('.commentReplyConnector').first()

          for (const [element, pseudo] of [[thread, '::before'], [connector, null]]) {
            if (!pseudo) {
              await thread.locator(':scope > .commentReplyRootToggle button').click()
            }
            await expect(element).toBeVisible()
            await page.mouse.move(0, 0)
            await element.scrollIntoViewIfNeeded()
            const points = await element.evaluate((element, pseudo) => {
              const style = getComputedStyle(element, pseudo)
              const x = pseudo ? parseFloat(style.insetInlineStart) : 0
              const y = pseudo ? parseFloat(style.insetBlockStart) + 10 : 3
              return [[x - 4, y], ...[-0.5, 0.5, 1.5].map(offset => [x + offset, y])]
            }, pseudo)
            const [surface, ...edge] = await sampleColors(app, element, points)
            const ratio = Math.max(...edge.map(color => contrastRatio(color, surface)))
            expect.soft(ratio, `${pseudo ? 'thread' : 'reply connector'} ${JSON.stringify({ surface, edge })}`).toBeGreaterThanOrEqual(3)
          }
          await attachScreenshot(`${theme} comment thread contrast at ${scale}% ${fullscreen ? 'fullscreen' : 'watch page'}`)
        })
      }
    })
  }
}

for (const theme of ['openTubeXLight', 'openTubeXDark']) {
  for (const scale of [100, 125]) {
    test.describe(`${theme} control contrast at ${scale}%`, () => {
      test.use({ seed: { settings: { baseTheme: theme, currentLocale: 'en-US', uiScale: scale } } })

      test('seekbar progress stays neutral and SponsorBlock categories remain visible', async ({ app, page }) => {
        await mockPlayableWatchPage(app, page)
        // An aborted label lookup would queue later SponsorBlock requests behind
        // network recovery. A 404 is the API's normal "no labels" response.
        await page.route('**/api/videoLabels/**', route => route.fulfill({ status: 404 }))
        const categories = ['sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'preview', 'hook', 'music_offtopic', 'filler', 'poi_highlight']
        await page.route('**/api/skipSegments/**', route => route.fulfill({
          json: [{
            videoID: 'jNQXAC9IVRw',
            segments: categories.map((category, index) => ({
              UUID: `seekbar-${category}`,
              category,
              actionType: category === 'poi_highlight' ? 'poi' : 'skip',
              segment: [index * 2 + 1, index * 2 + (category === 'poi_highlight' ? 1 : 2)],
              videoDuration: 30,
              votes: 1,
              locked: 0,
              description: ''
            }))
          }]
        }))
        await page.evaluate(() => {
          document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setUseSponsorBlock', true)
        })
        await openMockedVideo(page)
        const player = page.locator('.ftVideoPlayer')
        await player.locator('video').evaluate(video => {
          video.pause()
          video.currentTime = 24
          video.dispatchEvent(new Event('timeupdate'))
        })
        await player.hover()
        const bar = player.locator('.shaka-seek-bar-container')
        await expect(bar.locator('.sponsorBlockMarker')).toHaveCount(categories.length)
        await expect.poll(() => bar.locator('.shaka-seek-bar').inputValue()).toBe('24')
        const points = await bar.evaluate(element => {
          const rect = element.getBoundingClientRect()
          return [
            [rect.width * 0.75, rect.height / 2],
            [rect.width * 0.95, rect.height / 2],
            ...Array.from(element.querySelectorAll('.sponsorBlockMarker'), marker => {
              const bounds = marker.getBoundingClientRect()
              return [bounds.x - rect.x + bounds.width / 2, bounds.y - rect.y + bounds.height / 2]
            })
          ]
        })
        const [played, unplayed, ...markers] = await sampleColors(app, bar, points)
        expect(Math.max(...played) - Math.min(...played), `neutral progress: ${played}`).toBeLessThanOrEqual(2)
        expect(Math.min(...played), `soft white progress: ${played}`).toBeGreaterThanOrEqual(200)
        expect(Math.max(...played), `retain marker colors: ${played}`).toBeLessThanOrEqual(235)
        expect(Math.max(...played.map((value, index) => Math.abs(value - unplayed[index])))).toBeGreaterThanOrEqual(20)
        for (const [index, marker] of markers.entries()) {
          expect(Math.max(...marker.map((value, channel) => Math.abs(value - played[channel]))),
            `${categories[index]} marker: ${marker}, progress: ${played}`).toBeGreaterThanOrEqual(20)
        }
      })

      test('toggle track and thumb remain distinct in both states', async ({ app, page, attachScreenshot }) => {
        await goToSettingsSection(page, 'general')
        const toggle = page.getByRole('checkbox', { name: 'Keep relative timestamps updated' })
        for (const checked of [true, false]) {
          if (await toggle.isChecked() !== checked) await toggle.locator('..').locator('.switch-label').click()
          await expect(toggle).toBeChecked({ checked })
          const contrast = await switchContrast(app, toggle.locator('..').locator('.switch-label'), checked)
          // The thumb identifies the control with 3:1 contrast. The light track
          // uses a softer fill, but must not disappear into the page gradient.
          expect.soft(contrast.trackRatio, `track ${JSON.stringify(contrast)}`).toBeGreaterThanOrEqual(theme === 'openTubeXLight' ? 1.5 : 3)
          expect.soft(contrast.thumbSurfaceRatio, `thumb against background ${JSON.stringify(contrast)}`).toBeGreaterThanOrEqual(3)
          expect.soft(contrast.thumbRatio, `thumb ${JSON.stringify(contrast)}`).toBeGreaterThanOrEqual(3)
          await attachScreenshot(`${theme} toggle ${checked ? 'on' : 'off'} at ${scale}%`)
        }
        // Keyboard focus and toggling still work with the new control colors.
        await toggle.focus()
        await page.keyboard.press('Space')
        await expect(toggle).toBeChecked()
        await expect(toggle.locator('..').locator('.switch-label')).toHaveCSS('outline-style', 'solid')
        await attachScreenshot(`${theme} toggle contrast at ${scale}%`)
      })

      test('active settings-header icons remain visible', async ({ page }) => {
        await goToSettingsSection(page, 'general')
        for (const name of ['Highlight settings changed from defaults', 'Show performance impact indicators']) {
          const button = page.getByRole('button', { name, exact: true })
          if (await button.getAttribute('aria-pressed') !== 'true') await button.click()
          await expect(button).toHaveAttribute('aria-pressed', 'true')
          const colors = await button.evaluate(element => {
            const style = getComputedStyle(element)
            const rgb = color => color.match(/[\d.]+/g).slice(0, 3).map(Number)
            return { foreground: rgb(style.color), background: rgb(style.backgroundColor) }
          })
          expect.soft(contrastRatio(colors.foreground, colors.background), name).toBeGreaterThanOrEqual(3)
          await button.click()
          await expect(button).toHaveAttribute('aria-pressed', 'false')
        }
      })

      test('slider tracks and field boundaries remain visible', async ({ app, page, attachScreenshot }) => {
        await goToSettingsSection(page, 'theme')
        const slider = await controlContrast(app, page.getByRole('slider', { name: /UI Roundness/ }), 'slider')
        expect.soft(slider.ratio, `slider ${JSON.stringify(slider)}`).toBeGreaterThanOrEqual(3)
        const select = await controlContrast(app, page.getByRole('combobox', { name: /^Base theme/i }), 'field')
        expect.soft(select.ratio, `dropdown ${JSON.stringify(select)}`).toBeGreaterThanOrEqual(3)
        const icon = page.locator('.changedSettingIndicator').first()
        const iconColor = await icon.evaluate(element => getComputedStyle(element).color.match(/[\d.]+/g).slice(0, 3).map(Number))
        expect.soft(contrastRatio(iconColor, select.surface), `reset icon ${JSON.stringify({ iconColor, surface: select.surface })}`).toBeGreaterThanOrEqual(3)
        const search = await controlContrast(app, page.locator('.settingsSearch'), 'field')
        expect.soft(search.ratio, `search ${JSON.stringify(search)}`).toBeGreaterThanOrEqual(3)
        await expect(page.getByRole('combobox', { name: /Main color theme/i })).toBeDisabled()
        await attachScreenshot(`${theme} fields and sliders at ${scale}%`)
      })
    })
  }
}

for (const scale of [100, 125]) {
  test.describe(`hotPink contrast at ${scale}%`, () => {
    test.use({ seed: { settings: { baseTheme: 'hotPink', currentLocale: 'en-US', uiScale: scale } } })

    test('toggle thumbs remain distinct in both states', async ({ app, page }) => {
      await goToSettingsSection(page, 'general')
      const toggle = page.getByRole('checkbox', { name: 'Keep relative timestamps updated' })
      const tracks = []
      const thumbs = []
      for (const checked of [true, false]) {
        if (await toggle.isChecked() !== checked) await toggle.locator('..').locator('.switch-label').click()
        await expect(toggle).toBeChecked({ checked })
        const contrast = await switchContrast(app, toggle.locator('..').locator('.switch-label'), checked)
        tracks.push(contrast.track)
        thumbs.push(contrast.thumb)
        const label = toggle.locator('..').locator('.switch-label')
        const height = await label.evaluate(element => element.getBoundingClientRect().height)
        // The outline separates the white thumb from the light off track.
        // Sample its vertical edge where it crosses the track.
        const edge = await sampleColors(app, label, [-0.5, 0.5, 1.5].map(offset => [
          (checked ? 21 : 24) + offset, height / 2
        ]))
        const thumbRatio = Math.max(contrast.thumbRatio, ...edge.map(color => contrastRatio(color, contrast.track)))
        expect.soft(contrast.trackRatio, `track and background ${JSON.stringify(contrast)}`).toBeGreaterThanOrEqual(3)
        expect.soft(thumbRatio, `thumb boundary and track ${JSON.stringify({ contrast, edge })}`).toBeGreaterThanOrEqual(3)
        expect.soft(contrast.thumbSurfaceRatio, `thumb and background ${JSON.stringify(contrast)}`).toBeGreaterThanOrEqual(3)
      }
      expect(contrastRatio(...tracks), 'on and off tracks').toBeGreaterThanOrEqual(3)
      expect(thumbs[0], 'thumb color stays consistent').toEqual(thumbs[1])
    })

    test('settings category titles and descriptions remain readable in every state', async ({ page }) => {
      await goToSettingsSection(page, 'theme')
      const pageColors = await page.locator('body').evaluate(element => {
        const style = getComputedStyle(element)
        const rgb = color => color.match(/[\d.]+/g).slice(0, 3).map(Number)
        return { foreground: rgb(style.color), background: rgb(style.backgroundColor) }
      })
      expect.soft(contrastRatio(pageColors.foreground, pageColors.background), 'page text').toBeGreaterThanOrEqual(4.5)
      const category = page.locator('.settingsMenu .title[data-section="playback"]')
      const selected = page.locator('.settingsMenu .title.active')
      for (const state of ['normal', 'selected', 'hover', 'focus']) {
        const button = state === 'selected' ? selected : category
        if (state === 'hover') await button.hover()
        if (state === 'focus') {
          await page.mouse.move(0, 0)
          await page.keyboard.press('Tab')
          await button.focus()
        }
        const colors = await button.evaluate(element => {
          const rgb = color => color.match(/[\d.]+/g).slice(0, 3).map(Number)
          const style = getComputedStyle(element)
          const background = style.backgroundColor === 'rgba(0, 0, 0, 0)'
            ? getComputedStyle(element.closest('.settingsMenu')).backgroundColor
            : style.backgroundColor
          return {
            background: rgb(background),
            title: rgb(getComputedStyle(element.querySelector('.titleText')).color),
            description: rgb(getComputedStyle(element.querySelector('.titleDescription')).color)
          }
        })
        for (const part of ['title', 'description']) {
          expect.soft(contrastRatio(colors[part], colors.background), `${state} ${part} ${JSON.stringify(colors)}`).toBeGreaterThanOrEqual(4.5)
        }
      }
    })

    test('slider tracks and hovered header controls remain visible', async ({ app, page }) => {
      await goToSettingsSection(page, 'theme')
      const input = page.getByRole('slider', { name: /UI Roundness/ })
      const slider = await controlContrast(app, input, 'slider')
      expect.soft(slider.ratio, `slider ${JSON.stringify(slider)}`).toBeGreaterThanOrEqual(3)
      const points = await input.evaluate(element => {
        const rect = element.getBoundingClientRect()
        const fraction = (Number(element.value) - Number(element.min)) / (Number(element.max) - Number(element.min))
        return [[1 + fraction * (rect.width - 2), rect.height / 2], [rect.width * 0.85, rect.height / 2]]
      })
      const [thumb, track] = await sampleColors(app, input, points)
      expect.soft(contrastRatio(thumb, track), `slider thumb ${JSON.stringify({ thumb, track })}`).toBeGreaterThanOrEqual(3)
      const button = page.getByRole('button', { name: 'Show performance impact indicators', exact: true })
      if (await button.getAttribute('aria-pressed') === 'true') await button.click()
      await button.hover()
      const colors = await button.evaluate(element => {
        const style = getComputedStyle(element)
        const rgb = color => color.match(/[\d.]+/g).slice(0, 3).map(Number)
        return { foreground: rgb(style.color), background: rgb(style.backgroundColor) }
      })
      expect.soft(contrastRatio(colors.foreground, colors.background), `header hover ${JSON.stringify(colors)}`).toBeGreaterThanOrEqual(3)
    })
  })
}
