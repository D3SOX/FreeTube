import { test, expect, goTo, setWindowSize } from '../../helpers/app.mjs'

const now = Date.now()
const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'

const videos = Array.from({ length: 5 }, (_, index) => ({
  videoId: `video${String(index).padStart(6, '0')}`,
  title: `video ${String(index).padStart(3, '0')}`,
  author: 'Channel A',
  authorId: CHANNEL_ID,
  published: now - index * 3600000,
  viewCount: 1000,
  lengthSeconds: 120,
  liveNow: false,
  isUpcoming: false,
  type: 'video',
  // So that the header also carries the Mark all as seen button
  isNewInSubscriptionFeed: true
}))

test.use({
  seed: {
    settings: {
      fetchSubscriptionsAutomatically: false,
      hideSubscriptionsVideos: false,
      hideSubscriptionsShorts: false,
      showNewSubscriptionFeedIndicators: true,
      uiScale: 95
    },
    profiles: [
      {
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [{ id: CHANNEL_ID, name: 'Channel A', thumbnail: '' }]
      }
    ],
    subscriptionCache: [
      {
        _id: CHANNEL_ID,
        videos,
        videosTimestamp: new Date(now).toISOString()
      }
    ]
  }
})

// The bounds are set in the main process, while the header layout follows a
// ResizeObserver in the renderer, so the renderer has to catch up before the
// layout may be read back
async function setWindowWidth (app, page, width) {
  const previousWidth = await page.evaluate(() => window.innerWidth)

  await app.electronApp.evaluate(({ BrowserWindow }, targetWidth) => {
    const browserWindow = BrowserWindow.getAllWindows()[0]
    const bounds = browserWindow.getBounds()
    browserWindow.setBounds({ ...bounds, width: targetWidth })
  }, width)

  await page.waitForFunction(previous => window.innerWidth !== previous, previousWidth)

  // One frame for the ResizeObserver, one for the class it ends up setting
  await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  }))
}

function headerBoxes (page) {
  return page.evaluate(() => {
    const toBox = (selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect()
      return { start: rect.left, end: rect.right, top: rect.top, bottom: rect.bottom }
    }

    return {
      title: toBox('.pageTitle'),
      tabs: toBox('.tabs'),
      refreshWidget: toBox('.headerRefreshWidget'),
      header: toBox('.subscriptionsHeader')
    }
  })
}

test.describe('subscriptions header layout', () => {
  for (const uiScale of [100, 95]) {
    test(`keeps Mark all as seen beside the desktop feed tabs at ${uiScale}% scale`, async ({ app, page, attachScreenshot }) => {
      await app.electronApp.evaluate(({ BrowserWindow }, scale) => {
        BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(scale / 100)
      }, uiScale)
      await goTo(page, 'subscriptions')

      for (const tab of ['videos', 'all', 'tabbed', 'videos']) {
        if (tab === 'tabbed') {
          await page.getByRole('button', { name: 'Show tabbed view' }).click()
        } else {
          await page.locator(`[data-subscription-feed-tab="${tab}"]`).click()
        }
        await expect(page.locator('.subscriptionsHeader')).toHaveClass(/singleRow/)
        await expect(page.locator('.markAllSeenButton')).toBeVisible()

        await expect.poll(() => page.evaluate(() => {
          const tabs = document.querySelector('.tabs').getBoundingClientRect()
          const mark = document.querySelector('.markAllSeenButton').getBoundingClientRect()
          return mark.left - tabs.right
        })).toBeLessThanOrEqual(9)
        const layout = await page.evaluate(() => {
          const tabs = document.querySelector('.tabs').getBoundingClientRect()
          const mark = document.querySelector('.markAllSeenButton').getBoundingClientRect()
          const nextControl = document.querySelector('.headerViewToggle, .headerRefreshWidget').getBoundingClientRect()
          return {
            gap: mark.left - tabs.right,
            centerOffset: Math.abs((mark.top + mark.bottom - tabs.top - tabs.bottom) / 2),
            controlsGap: nextControl.left - mark.right
          }
        })
        expect(layout.gap).toBeGreaterThanOrEqual(0)
        expect(layout.centerOffset).toBeLessThanOrEqual(2)
        expect(layout.controlsGap).toBeGreaterThanOrEqual(0)
        await attachScreenshot(`desktop ${tab} feed action at ${uiScale}%`)
      }
    })
  }

  test('shows the New feed action and regular feed refresh status on mobile', async ({ app, page, attachScreenshot }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()
    await setWindowWidth(app, page, 375)

    const markAllSeen = page.getByRole('button', { name: 'Mark all as seen' })
    await expect(markAllSeen).toBeVisible()
    await expect(markAllSeen.locator('xpath=..')).toHaveClass(/headerActions/)

    const labelWidth = await markAllSeen.locator('.markAllSeenLabel').evaluate(element => {
      return element.getBoundingClientRect().width
    })
    expect(labelWidth).toBeGreaterThan(40)

    const sharesControlRow = await page.evaluate(() => {
      const markRect = document.querySelector('.markAllSeenButton').getBoundingClientRect()
      return ['.headerViewToggle', '.headerSortSelect'].some(selector => {
        const rect = document.querySelector(selector).getBoundingClientRect()
        return rect.top < markRect.bottom && rect.bottom > markRect.top
      })
    })
    expect(sharesControlRow).toBe(true)
    expect(await page.evaluate(() => {
      const markRect = document.querySelector('.markAllSeenButton').getBoundingClientRect()
      const refreshRect = document.querySelector('.refreshButton').getBoundingClientRect()
      return refreshRect.top < markRect.bottom && refreshRect.bottom > markRect.top
    })).toBe(true)
    await expect(page.locator('.headerRefreshWidget .lastRefreshTimestamp')).toHaveCount(0)
    await expect(page.locator('.headerRefreshWidget .nextAutoRefreshTimestamp')).toHaveCount(0)
    await attachScreenshot('portrait mobile New feed action')

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setSubscriptionFeedAutoRefreshInterval', String(60 * 60 * 1000))
      store.commit('setSubscriptionFeedNextAutoRefreshTimestamp', Date.now() + 60 * 60 * 1000)
    })
    await page.locator('[data-subscription-feed-tab="videos"]').click()

    await expect(page.getByText(/Videos feed last updated:/)).toBeVisible()
    await expect(page.getByText(/Next auto refresh:/)).toBeVisible()
    expect(await page.evaluate(() => {
      const markRect = document.querySelector('.markAllSeenButton').getBoundingClientRect()
      const refreshRect = document.querySelector('.refreshButton').getBoundingClientRect()
      return refreshRect.top < markRect.bottom && refreshRect.bottom > markRect.top
    })).toBe(true)
    await expect.poll(() => page.evaluate(() => {
      return document.documentElement.scrollWidth - document.documentElement.clientWidth
    })).toBeLessThanOrEqual(2)
    await attachScreenshot('portrait mobile subscription refresh status')

    await setWindowSize(app, page, { width: 640, height: 375 })
    await expect(markAllSeen.locator('.markAllSeenLabel')).toBeVisible()
    await expect(page.getByText(/Videos feed last updated:/)).toBeVisible()
    await expect(page.getByText(/Next auto refresh:/)).toBeVisible()
    await expect.poll(() => page.evaluate(() => {
      return document.documentElement.scrollWidth - document.documentElement.clientWidth
    })).toBeLessThanOrEqual(2)
    await attachScreenshot('landscape mobile subscription refresh status')

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateBaseTheme', 'black')
    })
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)')
    await expect(markAllSeen.locator('.markAllSeenLabel')).toBeVisible()
    await expect(page.getByText(/Next auto refresh:/)).toBeVisible()
    await attachScreenshot('dark landscape mobile subscription refresh status')
  })

  test('keeps the New feed sort control wide until its row needs to shrink', async ({ app, page, attachScreenshot }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()

    await setWindowWidth(app, page, 640)
    const roomySelectWidth = await page.locator('.headerSortSelect .select-text').evaluate(element => {
      return element.getBoundingClientRect().width
    })
    expect(roomySelectWidth).toBeGreaterThanOrEqual(210)

    await setWindowWidth(app, page, 340)

    const layout = await page.evaluate(() => {
      const toBox = element => {
        const rect = element.getBoundingClientRect()
        return { start: rect.left, end: rect.right, top: rect.top, bottom: rect.bottom }
      }
      const select = document.querySelector('.headerSortSelect .select-text')

      return {
        header: toBox(document.querySelector('.subscriptionsHeader')),
        viewToggle: toBox(document.querySelector('.headerViewToggle .iconButton')),
        select: toBox(select),
        label: toBox(document.querySelector('.headerSortSelect .select-label')),
        markAllSeen: toBox(document.querySelector('.markAllSeenButton')),
        refresh: toBox(document.querySelector('.headerRefreshWidget .refreshButton')),
        selectedText: select.textContent.trim()
      }
    })

    expect(layout.selectedText).toBe('Newest first')
    expect(layout.select.end - layout.select.start).toBeLessThan(roomySelectWidth)
    expect(layout.viewToggle.start).toBeGreaterThanOrEqual(layout.header.start)
    expect(layout.viewToggle.end).toBeLessThanOrEqual(layout.select.start)
    expect(layout.select.end).toBeLessThanOrEqual(layout.header.end)
    expect(layout.markAllSeen.end).toBeLessThanOrEqual(layout.header.end)
    expect(layout.refresh.start).toBeGreaterThanOrEqual(layout.header.start)
    expect(layout.refresh.end).toBeLessThanOrEqual(layout.header.end)
    expect(Math.abs(
      (layout.viewToggle.top + layout.viewToggle.bottom) / 2 -
      (layout.select.top + layout.select.bottom) / 2
    )).toBeLessThanOrEqual(1)
    expect(Math.abs(
      (layout.select.top + layout.select.bottom) / 2 -
      (layout.markAllSeen.top + layout.markAllSeen.bottom) / 2
    )).toBeLessThanOrEqual(1)
    expect(layout.label.top).toBeGreaterThanOrEqual(layout.select.top)
    expect(layout.label.bottom).toBeLessThanOrEqual(layout.select.bottom)
    await attachScreenshot('compact New feed header actions')
  })

  test('separates the main feed tabs from the centered New feed tabs', async ({ app, page, attachScreenshot }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()

    const combinedSeparatorTopMargin = () => page.evaluate(() => {
      const header = document.querySelector('.subscriptionsHeader')
      const mainTabs = [...header.querySelectorAll('[data-subscription-feed-tab]')]

      return header.getBoundingClientRect().bottom -
        Math.max(...mainTabs.map(tab => tab.getBoundingClientRect().bottom))
    })

    const separatorLayout = () => page.evaluate(() => {
      const header = document.querySelector('.subscriptionsHeader')
      const headerRow = header.querySelector('.headerRow')
      const mainTabs = [...header.querySelectorAll('[data-subscription-feed-tab]')]
      const newFeedTabs = [...header.querySelectorAll('[data-new-feed-tab]')]
      const headerRowRect = headerRow.getBoundingClientRect()
      const headerStyle = getComputedStyle(header)
      const headerRowStyle = getComputedStyle(headerRow)

      return {
        headerShadow: headerStyle.boxShadow,
        separatorWidth: Number.parseFloat(headerRowStyle.borderBottomWidth),
        separatorY: headerRowRect.bottom,
        separatorTopMargin: headerRowRect.bottom -
          Number.parseFloat(headerRowStyle.borderBottomWidth) -
          Math.max(...mainTabs.map(tab => tab.getBoundingClientRect().bottom)),
        mainTabsBottom: Math.max(...mainTabs.map(tab => tab.getBoundingClientRect().bottom)),
        newFeedTabsTop: Math.min(...newFeedTabs.map(tab => tab.getBoundingClientRect().top))
      }
    })

    for (const width of [1400, 700, 375]) {
      await setWindowWidth(app, page, width)
      if (await page.getByRole('button', { name: 'Show combined view' }).isVisible()) {
        await page.getByRole('button', { name: 'Show combined view' }).click()
      }
      const combinedTopMargin = await combinedSeparatorTopMargin()

      await page.getByRole('button', { name: 'Show tabbed view' }).click()
      const layout = await separatorLayout()

      expect(layout.headerShadow).toBe('none')
      expect(layout.separatorWidth).toBeGreaterThan(0)
      expect(layout.separatorWidth).toBeLessThanOrEqual(1.1)
      expect(Math.abs(layout.separatorTopMargin - combinedTopMargin)).toBeLessThanOrEqual(1)
      expect(layout.separatorY).toBeGreaterThanOrEqual(layout.mainTabsBottom)
      expect(layout.newFeedTabsTop).toBeGreaterThanOrEqual(layout.separatorY)
    }

    await attachScreenshot('New feed tabs separator')
  })

  test('puts the New feed controls below the main feed tabs at narrow widths', async ({ app, page, attachScreenshot }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()
    await page.getByRole('button', { name: 'Show tabbed view' }).click()

    const readLayout = () => page.evaluate(() => {
      const toBox = selector => {
        const rect = document.querySelector(selector).getBoundingClientRect()
        return { start: rect.left, end: rect.right, top: rect.top, bottom: rect.bottom }
      }

      return {
        row: toBox('.feedTabsControlsRow'),
        header: toBox('.subscriptionsHeader'),
        title: toBox('.pageTitle'),
        tabs: toBox('.tabs'),
        actions: toBox('.headerActions'),
        upperTabs: [...document.querySelectorAll('[data-subscription-feed-tab]')]
          .map(tab => {
            const rect = tab.getBoundingClientRect()
            return { start: rect.left, end: rect.right, top: rect.top }
          })
      }
    })

    const wideLayout = await readLayout()
    expect(wideLayout.actions.top).toBeLessThan(wideLayout.tabs.bottom)
    expect(wideLayout.tabs.top).toBeLessThan(wideLayout.actions.bottom)
    expect(Math.abs(wideLayout.row.end - wideLayout.actions.end)).toBeLessThanOrEqual(1)

    for (const width of [900, 680, 375, 340]) {
      await setWindowWidth(app, page, width)
      await expect(page.locator('.subscriptionsHeader')).not.toHaveClass(/singleRow/)

      const layout = await readLayout()

      expect(layout.tabs.top).toBeGreaterThanOrEqual(layout.title.bottom)
      expect(layout.actions.top - layout.tabs.bottom).toBeGreaterThanOrEqual(8)
      expect(Math.abs(layout.actions.start - layout.tabs.start)).toBeLessThanOrEqual(1)
      expect(layout.actions.start).toBeGreaterThanOrEqual(layout.header.start)
      expect(layout.actions.end).toBeLessThanOrEqual(layout.header.end)
      expect(Math.min(...layout.upperTabs.map(tab => tab.start))).toBeGreaterThanOrEqual(layout.header.start)
      expect(Math.max(...layout.upperTabs.map(tab => tab.end))).toBeLessThanOrEqual(layout.header.end)
      if (width >= 680) {
        expect(new Set(layout.upperTabs.map(tab => tab.top)).size).toBe(1)
      }
      await expect.poll(() => page.evaluate(() => {
        return document.documentElement.scrollWidth - document.documentElement.clientWidth
      })).toBeLessThanOrEqual(2)
    }

    await attachScreenshot('New feed controls below main tabs')
  })

  test('puts the tabs beside the title when they fit', async ({ page, attachScreenshot }) => {
    await goTo(page, 'subscriptions')

    await expect(page.locator('.subscriptionsHeader')).toHaveClass(/singleRow/)
    await attachScreenshot('single row header')

    const { title, tabs, refreshWidget } = await headerBoxes(page)

    // One line: the tabs follow the title and the refresh widget stays last
    expect(tabs.start).toBeGreaterThanOrEqual(title.end)
    expect(refreshWidget.start).toBeGreaterThanOrEqual(tabs.end)
    expect(tabs.top).toBeLessThan(title.bottom)
    expect(refreshWidget.top).toBeLessThan(tabs.bottom)
  })

  test('moves the controls below the tabs before the tabs wrap', async ({ app, page, attachScreenshot }) => {
    await goTo(page, 'subscriptions')
    await expect(page.locator('.subscriptionsHeader')).toHaveClass(/singleRow/)

    await setWindowWidth(app, page, 800)

    await expect(page.locator('.subscriptionsHeader')).not.toHaveClass(/singleRow/)
    await attachScreenshot('two row header')

    const { title, tabs, refreshWidget } = await headerBoxes(page)
    const tabRows = await page.locator('[data-subscription-feed-tab]').evaluateAll(tabs => {
      return new Set(tabs.map(tab => tab.getBoundingClientRect().top)).size
    })

    // The controls move down before taking enough space to wrap the tabs.
    expect(tabs.top).toBeGreaterThanOrEqual(title.bottom)
    expect(refreshWidget.top - tabs.bottom).toBeGreaterThanOrEqual(8)
    expect(tabRows).toBe(1)
  })

  test('merges the rows again when the window grows back', async ({ app, page, attachScreenshot }) => {
    await goTo(page, 'subscriptions')

    await setWindowWidth(app, page, 800)
    await expect(page.locator('.subscriptionsHeader')).not.toHaveClass(/singleRow/)

    await setWindowWidth(app, page, 1600)
    await expect(page.locator('.subscriptionsHeader')).toHaveClass(/singleRow/)

    // The layout has to settle instead of flipping between the two
    const heights = []
    for (let index = 0; index < 3; index++) {
      await page.waitForTimeout(150)
      heights.push(await page.evaluate(() => {
        return document.querySelector('.subscriptionsHeader').getBoundingClientRect().height
      }))
    }

    expect(new Set(heights).size).toBe(1)
    await expect(page.locator('.subscriptionsHeader')).toHaveClass(/singleRow/)
    await attachScreenshot('merged header after growing the window')
  })

  test('merges the rows when the Mark all as seen button is what did not fit', async ({ app, page }) => {
    await goTo(page, 'subscriptions')

    const header = page.locator('.subscriptionsHeader')
    const markAllSeen = page.locator('.markAllSeenButton')
    await expect(markAllSeen).toBeVisible()

    // Narrow the window step by step until the button is what pushes the tabs
    // onto their own line
    let width = 1920
    while (width > 900) {
      width -= 20
      await setWindowWidth(app, page, width)

      if (!await header.evaluate(element => element.classList.contains('singleRow'))) {
        break
      }
    }

    await expect(header).not.toHaveClass(/singleRow/)

    // Removing the button frees far more space than the last step took away, so
    // the tabs fit next to the title again. The button leaves without resizing
    // the tabs row, which keeps its full width while it has its own line.
    await markAllSeen.click()
    await expect(markAllSeen).toBeHidden()

    await expect(header).toHaveClass(/singleRow/)
  })

  test('stays split while the tabs themselves have to wrap', async ({ app, page, attachScreenshot }) => {
    await goTo(page, 'subscriptions')

    // Narrow enough that the tabs no longer fit on one line inside their own
    // row, so their rendered width is the shrunken one rather than the width
    // they would need. That must not be mistaken for fitting next to the title.
    await setWindowWidth(app, page, 500)

    const wrapped = await page.evaluate(() => {
      const tabs = [...document.querySelectorAll('[data-subscription-feed-tab]')]
      return new Set(tabs.map(tab => tab.getBoundingClientRect().top)).size > 1
    })
    expect(wrapped, 'the tabs are expected to wrap at this width').toBe(true)

    await expect(page.locator('.subscriptionsHeader')).not.toHaveClass(/singleRow/)
    await attachScreenshot('header with wrapped tabs')

    // A wrong measurement here would merge the rows, which widens the tabs and
    // makes the next measurement split them again
    for (let index = 0; index < 3; index++) {
      await page.waitForTimeout(150)
      await expect(page.locator('.subscriptionsHeader')).not.toHaveClass(/singleRow/)
    }
  })

  test('saves vertical space compared to the two line layout', async ({ app, page }) => {
    await goTo(page, 'subscriptions')

    const headerHeight = () => page.evaluate(() => {
      return document.querySelector('.subscriptionsHeader').getBoundingClientRect().height
    })

    const merged = await headerHeight()

    await setWindowWidth(app, page, 800)
    await expect(page.locator('.subscriptionsHeader')).not.toHaveClass(/singleRow/)

    expect(merged).toBeLessThan(await headerHeight())
  })
})
