import { test, expect, goTo, sel, waitForAppReady } from '../../helpers/app.mjs'

const now = Date.now()
const HOUR = 3600000

const CHANNEL_A = 'UCaaaaaaaaaaaaaaaaaaaaaa'

function feedVideo (videoId, title, published, extra = {}) {
  return {
    videoId,
    title,
    author: 'Channel A',
    authorId: CHANNEL_A,
    published,
    viewCount: 1000,
    lengthSeconds: 120,
    liveNow: false,
    isUpcoming: false,
    type: 'video',
    ...extra
  }
}

const collaborators = [
  { id: CHANNEL_A, name: 'Channel A', thumbnail: '', subtitle: '' },
  { id: 'UCcccccccccccccccccccccc', name: 'Channel C', thumbnail: '', subtitle: '' },
  { id: 'UCdddddddddddddddddddddd', name: 'Channel D', thumbnail: '', subtitle: '' }
]

test.use({
  seed: {
    settings: {
      fetchSubscriptionsAutomatically: false
    },
    profiles: [
      {
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [
          { id: CHANNEL_A, name: 'Channel A', thumbnail: '' }
        ]
      }
    ],
    subscriptionCache: [
      {
        _id: CHANNEL_A,
        videos: [
          feedVideo('aaaaaaaaaa1', 'Collab video', now - 1 * HOUR, {
            author: 'Channel A and 2 more',
            hasCollaborators: true,
            collaborators
          }),
          ...Array.from({ length: 11 }, (_, i) =>
            feedVideo(`aaaaaaaaa${i.toString(16)}2`, `Filler video ${i}`, now - (i + 2) * HOUR)
          )
        ],
        videosTimestamp: new Date(now - 2 * HOUR).toISOString()
      }
    ]
  }
})

function defineCase () {
  test('opening the collaborators prompt keeps the sticky app header visible', async ({ page, attachScreenshot }) => {
    await goTo(page, 'subscriptions')

    await expect(page.getByText('Filler video 9')).toBeAttached()
    const rootOverflowBefore = await page.evaluate(() => {
      document.documentElement.style.overflow = 'auto'
      window.scrollTo(0, 300)
      return document.documentElement.style.overflow
    })
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)

    const topNav = page.locator('.topNav')
    const topBefore = await topNav.evaluate(element => element.getBoundingClientRect().top)
    await page.locator('.channelResolverButton').evaluate(element => element.click())
    await expect(page.locator('.prompt')).toBeVisible()

    await expect.poll(() => topNav.evaluate(element => element.getBoundingClientRect().top))
      .toBeCloseTo(topBefore, 0)
    await expect(topNav).toBeInViewport()
    await attachScreenshot('collaborators prompt over the scrolled feed')

    const scrollBefore = await page.evaluate(() => window.scrollY)
    await page.mouse.move(10, 200)
    await page.mouse.wheel(0, 500)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollBefore)

    await page.keyboard.press('Escape')
    await expect(page.locator('.prompt')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => document.documentElement.style.overflow))
      .toBe(rootOverflowBefore)
  })

  test('opening the collaborators prompt does not animate the feed behind it', async ({ page }) => {
    await goTo(page, 'subscriptions')

    await expect(page.getByText('Collab video')).toBeVisible()
    await expect(page.getByText('Filler video 9')).toBeAttached()

    // Let the feed's initial 300ms enter transition and grid sizing settle
    // before observing changes caused specifically by opening the prompt.
    await page.waitForTimeout(350)
    await expect(page.locator('.feed-enter-active, .feed-enter-from, .feed-move')).toHaveCount(0)

    // Watch for the TransitionGroup FLIP/enter classes appearing on any feed
    // item, and record item positions to detect layout shifts.
    await page.evaluate(() => {
      window.__animClasses = []
      window.__rectsBefore = [...document.querySelectorAll('.ft-list-video')]
        .map((el) => el.getBoundingClientRect().toJSON())

      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          const classList = mutation.target.classList
          for (const cls of ['feed-move', 'feed-enter-active', 'feed-enter-from']) {
            if (classList.contains(cls)) {
              window.__animClasses.push(cls)
            }
          }
        }
      })
      observer.observe(document.querySelector('.app'), {
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
      })
    })

    await page.click('.channelResolverButton')
    await expect(page.locator('.prompt')).toBeVisible()

    // Give any 300ms feed transition time to run.
    await page.waitForTimeout(600)

    const { animClasses, rectsBefore, rectsAfter } = await page.evaluate(() => ({
      animClasses: window.__animClasses,
      rectsBefore: window.__rectsBefore,
      rectsAfter: [...document.querySelectorAll('.ft-list-video')]
        .map((el) => el.getBoundingClientRect().toJSON())
    }))

    // Sub-pixel deltas from scrollbar-width compensation rounding are fine;
    // anything visible is not.
    const shifted = rectsBefore
      .map((rect, i) => {
        const after = rectsAfter[i] || rect

        return {
          i,
          dx: after.x - rect.x,
          dy: after.y - rect.y,
          dw: after.width - rect.width
        }
      })
      .filter(({ dx, dy, dw }) => Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5 || Math.abs(dw) > 0.5)

    expect(animClasses, 'feed transition classes fired while opening the prompt').toEqual([])
    expect(shifted, `items shifted: ${JSON.stringify(shifted.slice(0, 3))}`).toEqual([])
  })
}

test('middle-clicking a collaborator opens its channel in a background tab', async ({ page }) => {
  await goTo(page, 'subscriptions')

  await page.locator('.channelResolverButton').click()
  const prompt = page.locator('.prompt')
  await expect(prompt).toBeVisible()

  await prompt.getByRole('link', { name: 'Channel C' }).click({ button: 'middle' })

  await expect(page.locator(sel.tabs)).toHaveCount(2)
  await expect(page.locator(sel.tabs).first()).toHaveClass(/active/)
  await expect(prompt).toBeVisible()
  await expect(page).toHaveURL(/#\/subscriptions$/)
  await expect.poll(() => page.evaluate(async () => {
    const state = await window.ftElectron.tabs.getState()
    return state.tabs.find(tab => tab.id !== state.activeTabId)?.route.fullPath
  })).toBe('/channel/UCcccccccccccccccccccccc')
  await expect(page.locator(sel.tabs).nth(1)).toContainText('Channel C')
})

test('shift-middle-clicking a collaborator opens its channel in a new window', async ({ app, page }) => {
  await goTo(page, 'subscriptions')

  await page.locator('.channelResolverButton').click()
  const prompt = page.locator('.prompt')
  await expect(prompt).toBeVisible()

  const [newWindow] = await Promise.all([
    app.electronApp.waitForEvent('window'),
    prompt.getByRole('link', { name: 'Channel C' }).click({ button: 'middle', modifiers: ['Shift'] })
  ])
  await waitForAppReady(newWindow)

  await expect(newWindow).toHaveURL(/#\/channel\/UCcccccccccccccccccccccc$/)
  await expect(page).toHaveURL(/#\/subscriptions$/)
  await expect(prompt).toBeVisible()
})

test.describe('at 100% display scale', () => {
  defineCase()
})

// Fractional display scaling makes scrollbar-width measurements inexact,
// which must still not cause a visible feed animation.
test.describe('at 125% display scale', () => {
  test.use({ launchArgs: ['--force-device-scale-factor=1.25'] })
  defineCase()
})

test.describe('at 150% display scale', () => {
  test.use({ launchArgs: ['--force-device-scale-factor=1.5'] })
  defineCase()
})

test.describe('while collaborators are loading', () => {
  test.use({
    seed: {
      settings: {
        fetchSubscriptionsAutomatically: false
      },
      profiles: [
        {
          _id: 'allChannels',
          name: 'All Channels',
          bgColor: '#000000',
          textColor: '#FFFFFF',
          subscriptions: [
            { id: CHANNEL_A, name: 'Channel A', thumbnail: '' }
          ]
        }
      ],
      subscriptionCache: [
        {
          _id: CHANNEL_A,
          videos: [
            feedVideo('bbbbbbbbbb1', 'Uncached collab video', now - HOUR, {
              author: 'Channel A and others',
              hasCollaborators: true
            })
          ],
          videosTimestamp: new Date(now - 2 * HOUR).toISOString()
        }
      ]
    }
  })

  test('shows the loading cursor across the app', async ({ page, attachScreenshot }) => {
    let releaseRequests
    const requestsReleased = new Promise(resolve => {
      releaseRequests = resolve
    })
    await page.route(/^https?:\/\//, async route => {
      await requestsReleased
      // A terminal error finishes loading instead of waiting for network recovery.
      await route.fulfill({ status: 404, json: { error: 'Not found' } })
    })

    await goTo(page, 'subscriptions')
    await page.click('.channelResolverButton')

    await expect(page.locator('.channelResolverButton')).toBeDisabled()
    await page.locator('.topNav').hover()
    await expect(page.locator('.topNav')).toHaveCSS('cursor', 'wait')
    await attachScreenshot('loading collaborators')

    releaseRequests()
    await expect(page.locator('.channelResolverButton')).toBeEnabled()
    await expect(page.locator('.topNav')).not.toHaveCSS('cursor', 'wait')
  })
})
