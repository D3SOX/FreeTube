import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, goToSettingsSection, latestSettings } from '../../helpers/app.mjs'

async function openYtDlpStreamingSettings(page) {
  const section = await goToSettingsSection(page, 'playback')
  const heading = section.getByRole('heading', { name: 'yt-dlp Streaming', exact: true })
  const ytDlpSection = heading.locator('xpath=../..')
  return {
    section,
    heading,
    segmentSlider: ytDlpSection.getByRole('slider', { name: /Parallel Segment Loading/ }),
    toggle: ytDlpSection.getByRole('checkbox', { name: 'Preload Upcoming Videos' }),
    toggleLabel: ytDlpSection.locator('label.switch-label').filter({ hasText: 'Preload Upcoming Videos' }),
    countSlider: ytDlpSection.getByRole('slider', { name: /Upcoming Videos to Preload/ }),
    concurrencySlider: ytDlpSection.getByRole('slider', { name: /Concurrent Preloads/ })
  }
}

test.describe('yt-dlp playback preloading', () => {
  test.use({
    seed: {
      settings: { videoPlaybackEngine: 'built-in' }
    }
  })

  test('persists the switch, preload count, and concurrency', async ({ app }) => {
    const { section, heading, segmentSlider, toggle, toggleLabel, countSlider, concurrencySlider } = await openYtDlpStreamingSettings(app.page)

    await expect(heading).toBeVisible()
    const sectionHeadings = await section.getByRole('heading', { level: 3 }).allTextContents()
    expect(sectionHeadings.indexOf('yt-dlp Streaming')).toBe(sectionHeadings.indexOf('Captions') - 1)

    await expect(toggle).not.toBeChecked()
    await expect(toggle).toBeEnabled()
    await expect(segmentSlider).toBeEnabled()
    await expect(countSlider).toBeDisabled()
    await expect(countSlider).toHaveValue('2')
    await expect(countSlider).toHaveAttribute('min', '0')
    await expect(countSlider).toHaveAttribute('max', '10')
    await expect(concurrencySlider).toHaveValue('2')
    await expect(concurrencySlider).toHaveAttribute('min', '1')
    await expect(concurrencySlider).toHaveAttribute('max', '32')
    await expect(concurrencySlider).toBeDisabled()

    await toggleLabel.click()
    await expect(toggle).toBeChecked()
    await expect(countSlider).toBeEnabled()
    await expect(concurrencySlider).toBeEnabled()
    await countSlider.fill('0')
    await concurrencySlider.fill('32')

    await expect.poll(async () => {
      const settings = latestSettings(
        await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')
      )
      return {
        enabled: settings.ytDlpPreloadEnabled,
        count: settings.ytDlpPreloadCount,
        concurrency: settings.ytDlpPreloadConcurrency
      }
    }).toEqual({ enabled: true, count: 0, concurrency: 32 })

    const relaunched = await app.relaunch()
    const reloaded = await openYtDlpStreamingSettings(relaunched.page)
    await expect(reloaded.toggle).toBeChecked()
    await expect(reloaded.countSlider).toHaveValue('0')
    await expect(reloaded.concurrencySlider).toHaveValue('32')
  })
})
