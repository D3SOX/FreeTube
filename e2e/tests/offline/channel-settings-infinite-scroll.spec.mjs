import { test, expect, goToSettingsSection, setWindowSize } from '../../helpers/app.mjs'

const subscriptions = Array.from({ length: 50 }, (_, index) => ({
  id: `UC${String(index).padStart(22, '0')}`,
  name: `Channel ${String(index).padStart(3, '0')}`,
  thumbnail: ''
}))

for (const uiScale of [95, 125]) {
  test.describe(`channel settings automatic loading at ${uiScale}% scale`, () => {
    test.use({
      seed: {
        settings: {
          currentLocale: 'en-US',
          uiScale,
          fetchSubscriptionsAutomatically: false,
          generalAutoLoadMorePaginatedItemsEnabled: true,
          channelPlaybackSpeeds: JSON.stringify(Object.fromEntries(subscriptions.map(channel => [channel.id, 1.25])))
        },
        profiles: [{ _id: 'allChannels', name: 'All Channels', subscriptions }]
      }
    })

    for (const list of [
      { section: 'subscription', button: 'Subscription settings', scroller: '.channelSettingsScroller', entry: '.channelSettings' },
      { section: 'playback', button: 'Manage Saved Channels (50)', scroller: '.channelListContainer', entry: '.channelEntry' }
    ]) {
      test(`${list.section} settings append channels when the bottom spinner enters view`, async ({ app, page, attachScreenshot }) => {
        await goToSettingsSection(page, list.section)
        await page.getByRole('button', { name: list.button, exact: true }).click()
        await setWindowSize(app, page, { width: 650, height: 700 })
        const scroller = page.locator(list.scroller)
        const entries = page.locator(list.entry)
        const loader = scroller.locator('.ft-auto-load-next-page-wrapper')
        const search = page.getByPlaceholder('Search channels', { exact: true })
        const searchTop = await search.evaluate(element => element.getBoundingClientRect().top)

        await expect(entries).toHaveCount(24)
        await expect(loader.getByRole('status', { name: 'Loading more' })).toHaveCount(1)
        await expect(page.getByRole('button', { name: 'Load more channels', exact: true })).toHaveCount(0)
        await expect(page.locator('.channelSettingsPagination')).toHaveCount(0)
        for (const count of [48, 50]) {
          await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
          await expect(entries).toHaveCount(count)
          await expect(entries.first()).toContainText('Channel 000')
          await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
          expect(await search.evaluate(element => element.getBoundingClientRect().top)).toBe(searchTop)
        }
        await expect(loader).toHaveCount(0)
        await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
        await search.fill('Channel 049')
        await expect(entries).toHaveCount(1)
        await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
        await search.fill('')
        await expect(entries).toHaveCount(24)
        await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
        await attachScreenshot(`${list.section} settings bottom loader at ${uiScale}%`)
      })
    }
  })
}
