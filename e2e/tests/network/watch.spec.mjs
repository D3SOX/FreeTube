import { sel } from '../../helpers/app.mjs'
import { test, expect, setPlayerFullscreen } from '../../helpers/innertube.mjs'
import { findWatchComponent, openVideoOrSkip, waitForPlaybackOrSkip } from '../../helpers/player.mjs'

// "Me at the zoo" - the oldest video on YouTube, short and stable.
const VIDEO_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
const CAPTIONED_VIDEO = {
  id: 'Xf-uUy5pdUI',
  title: 'What’s It Like to Be Killed by Nature’s Most Brutal Predator',
  url: 'https://www.youtube.com/watch?v=Xf-uUy5pdUI'
}
const COMMENTS_DISABLED_VIDEO = {
  id: 'Mapn4dhcFlc',
  title: 'Public Works - How to turn your water on and off',
  url: 'https://www.youtube.com/watch?v=Mapn4dhcFlc'
}
const FULLSCREEN_PLAYLIST_ID = 'fullscreen-preview'
const FULLSCREEN_PLAYLIST = {
  _id: FULLSCREEN_PLAYLIST_ID,
  playlistName: 'Fullscreen preview',
  protected: false,
  description: '',
  videos: [{
    videoId: 'jNQXAC9IVRw',
    title: 'Me at the zoo',
    author: 'jawed',
    authorId: 'UC4QobU6STFB0P71PMvOGN5A',
    lengthSeconds: 19,
    type: 'video'
  }],
  createdAt: Date.now() - 86_400_000,
  lastUpdatedAt: Date.now() - 86_400_000
}

function longTranscript() {
  const timestamp = (seconds) => {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor(seconds % 3600 / 60)
    const remainingSeconds = seconds % 60
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}.000`
  }

  return `WEBVTT\n\n${Array.from({ length: 5000 }, (_, index) => (
    `${timestamp(index)} --> ${timestamp(index + 1)}\nTranscript line ${index}.`
  )).join('\n\n')}\n`
}

function openVideo(page, video = { id: 'jNQXAC9IVRw', title: 'Me at the zoo', url: VIDEO_URL }) {
  return openVideoOrSkip(test, page, video)
}

async function openCaptionedVideoOrSkip(page) {
  await page.locator(sel.searchInput).fill(CAPTIONED_VIDEO.url)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_VIDEO.id}`))

  const title = page.locator('.videoTitle')
  const errorMessage = page.locator('.errorMessage')
  try {
    await expect(title).toContainText(CAPTIONED_VIDEO.title, { timeout: 30_000 })
  } catch (error) {
    const unavailable = await errorMessage.isVisible() || (await title.textContent())?.trim() === ''
    test.skip(unavailable, 'captioned test video did not hydrate from the live API')
    throw error
  }
}

async function openFullscreenPlaylistVideo(page, { enableQuickBookmark = false } = {}) {
  await page.locator(sel.sideNavLink('userplaylists')).first().evaluate(element => element.click())
  await expect(page).toHaveURL(/#\/userplaylists/)
  await page.getByRole('link', { name: FULLSCREEN_PLAYLIST.playlistName }).first().click()
  await expect(page).toHaveURL(new RegExp(`#\\/playlist\\/${FULLSCREEN_PLAYLIST_ID}`))
  if (enableQuickBookmark) {
    const enableButton = page.getByTitle('Enable Quick Bookmark With This Playlist')
    if (await enableButton.isVisible()) {
      await enableButton.click()
    }
    await expect(page.getByTitle('Quick Bookmark Enabled')).toBeVisible()
  }
  await page.getByRole('link', { name: FULLSCREEN_PLAYLIST.videos[0].title }).first().click()
  await expect(page).toHaveURL(
    new RegExp(`#\\/watch\\/jNQXAC9IVRw\\?.*playlistId=${FULLSCREEN_PLAYLIST_ID}`)
  )
}

async function setWindowWidth(app, width) {
  await app.electronApp.evaluate(({ BrowserWindow }, targetWidth) => {
    const browserWindow = BrowserWindow.getAllWindows()[0]
    const bounds = browserWindow.getBounds()
    browserWindow.setBounds({ ...bounds, width: targetWidth })
  }, width)
}

function disableAutomaticPagination(page) {
  return page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setGeneralAutoLoadMorePaginatedItemsEnabled', false)
  })
}

test('theatre mode works until its responsive button cutoff', async ({ app, page }) => {
  await setWindowWidth(app, 1500)
  await page.locator(sel.searchInput).fill(VIDEO_URL)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.videoLayout')).toBeVisible()
  await page.evaluate(async () => {
    const app = document.querySelector('#app')?.__vue_app__
    const findWatchView = (vnode) => {
      if (vnode?.component?.type?.name === 'Watch') {
        return vnode.component.proxy
      }
      if (vnode?.component?.subTree) {
        const match = findWatchView(vnode.component.subTree)
        if (match) return match
      }
      if (Array.isArray(vnode?.children)) {
        for (const child of vnode.children) {
          const match = findWatchView(child)
          if (match) return match
        }
      }
      return null
    }
    const watchView = findWatchView(app?._container?._vnode)
    if (!watchView) throw new Error('Unable to access the watch view')

    watchView.videoLoadGeneration += 1
    watchView.errorMessage = null
    watchView.isUpcoming = false
    watchView.playabilityStatus = 'OK'
    watchView.showTranscript = true
    watchView.activeFormat = 'legacy'
    watchView.handlePlayerError = () => {}
    watchView.legacyFormats = [{
      itag: 18,
      qualityLabel: '360p',
      height: 360,
      width: 640,
      url: 'data:video/mp4;base64,'
    }]
    watchView.isLoading = false
    await watchView.$nextTick()
  })

  const layout = page.locator('.videoLayout')
  const theatreButton = page.locator('.theatre-button').first()
  const videoArea = page.locator('.videoArea')
  const sidebar = page.locator('.sidebarArea')
  await expect(theatreButton).toBeVisible()
  await expect.poll(async () => {
    const [videoBounds, sidebarBounds] = await Promise.all([
      videoArea.boundingBox(),
      sidebar.boundingBox()
    ])
    return sidebarBounds.x >= videoBounds.x + videoBounds.width - 1
  }).toBe(true)

  await theatreButton.evaluate(button => button.click())
  await expect(layout).toHaveClass(/useTheatreMode/)
  await expect.poll(async () => {
    const [videoBounds, sidebarBounds] = await Promise.all([
      videoArea.boundingBox(),
      sidebar.boundingBox()
    ])
    return sidebarBounds.y >= videoBounds.y + videoBounds.height - 1
  }).toBe(true)

  await theatreButton.evaluate(button => button.click())
  await expect(layout).not.toHaveClass(/useTheatreMode/)

  await setWindowWidth(app, 1200)
  await expect(theatreButton).toBeHidden()
  await expect(page.locator('.ftVideoPlayerHost')).toHaveClass(/theatreUnavailable/)

  await page.keyboard.press('t')
  await expect(layout).not.toHaveClass(/useTheatreMode/)
})

test.describe('background watch tab', () => {
  test.use({
    seed: {
      settings: {
        generalAutoLoadMorePaginatedItemsEnabled: true
      }
    }
  })

  test('auto-loads comments for a video opened in the background', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await page.evaluate((route) => window.ftElectron.tabs.create({
      route,
      makeActive: false
    }), '/watch/jNQXAC9IVRw')

    const backgroundTab = page.locator(sel.tabs).nth(1)
    const backgroundContent = page.locator('.tabContent[aria-hidden="true"]').nth(0)
    await expect(backgroundContent.locator('.videoTitle')).toContainText('Me at the zoo', { timeout: 30_000 })
    await expect(backgroundContent.locator('.commentsTitle')).toHaveCount(1, { timeout: 30_000 })
    await expect(backgroundContent.locator('.comment')).not.toHaveCount(0, { timeout: 30_000 })

    await backgroundTab.click()
    await expect(page.locator('.commentsTitle')).toBeVisible()
  })

  test('keeps reporting genuine loading after leaving a video tab', async ({ page }) => {
    await openVideo(page)

    const videoTab = page.locator(sel.tabs).first()
    await expect(videoTab).not.toHaveClass(/loading/)
    await videoTab.evaluate((tab) => {
      window.__videoTabShowedLoadingAfterDeactivation = false
      new MutationObserver(() => {
        if (tab.classList.contains('loading')) {
          window.__videoTabShowedLoadingAfterDeactivation = true
        }
      }).observe(tab, { attributes: true, attributeFilter: ['class'] })
    })

    await page.locator(sel.newTabButton).click()
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    const videoTabId = await videoTab.getAttribute('data-tab-id')
    await expect(page.locator(`.tabContent[data-tab-id="${videoTabId}"]`))
      .toHaveAttribute('aria-hidden', 'true')

    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await watchComponent.evaluate((component) => {
      window.setTimeout(() => {
        component.proxy.isLoading = true
      }, 250)
    })
    await expect.poll(() => watchComponent.evaluate(
      component => component.proxy.isLoading
    )).toBe(true)
    await watchComponent.dispose()

    expect(await page.evaluate(
      () => window.__videoTabShowedLoadingAfterDeactivation
    )).toBe(true)
    await expect(videoTab).toHaveClass(/loading/)

    await videoTab.click()
    await expect(videoTab).toHaveClass(/loading/)
    await expect(
      page.locator('.tabContent[aria-hidden="false"] [data-tab-loading-indicator]')
    ).toHaveCount(1)
  })

  test('keeps loading updates when tab activation is rejected', async ({ page }) => {
    await openVideo(page)

    const videoTab = page.locator(sel.tabs).first()
    await expect(videoTab).not.toHaveClass(/loading/)
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('activateTab', 'missing-tab')
    })

    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await watchComponent.evaluate((component) => {
      component.proxy.isLoading = true
    })
    await watchComponent.dispose()

    await expect(videoTab).toHaveClass(/loading/)
    await expect(
      page.locator('.tabContent[aria-hidden="false"] [data-tab-loading-indicator]')
    ).toHaveCount(1)
  })
})

test.describe('watch page metadata', () => {
  // The tab shows a play icon instead of the channel avatar while the video
  // plays, so keep this tab out of the playing state entirely.
  test.use({ seed: { settings: { autoplayVideos: false } } })

  test('shows video metadata', async ({ page }) => {
    await openVideo(page)
    await expect(page.getByText('jawed').first()).toBeVisible()
    await expect(page.locator(sel.activeTab).locator('.tabAvatar')).toBeVisible()
  })
})

test.describe('watch page', () => {
  test('shows a pasted comment link as the first unpinned highlighted comment', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    const commentId = 'UgxZaBRFEKqDUoZULy94AaABAg'
    await page.locator(sel.searchInput).fill(
      `${VIDEO_URL}&lc=${commentId}&pp=0gcJCSIANpG00pGi`
    )
    await page.locator(sel.searchInput).press('Enter')

    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/jNQXAC9IVRw\\?.*commentId=${commentId}`))
    const badge = page.getByText('Highlighted comment', { exact: true })
    await expect(badge).toBeVisible({ timeout: 60_000 })

    const highlightedThread = badge.locator('..')
    await expect.poll(async () => {
      return highlightedThread.evaluate((thread) => {
        const threads = [...thread.parentElement.children]
        const highlightedIndex = threads.indexOf(thread)
        const lastPinnedIndex = threads.findLastIndex(candidate => candidate.querySelector('.commentPinned'))
        const allPreviousThreadsArePinned = threads
          .slice(0, highlightedIndex)
          .every(candidate => candidate.querySelector('.commentPinned') !== null)
        return highlightedIndex >= 0 &&
          allPreviousThreadsArePinned &&
          highlightedIndex === lastPinnedIndex + 1
      })
    }).toBe(true)

    const replyId = 'UgzuC3zzpRZkjc5Qzsd4AaABAg.958xaQsh63D95AEkVnh_di'
    await page.locator(sel.searchInput).fill(
      `${VIDEO_URL}&lc=${replyId}`
    )
    await page.locator(sel.searchInput).press('Enter')

    await expect(page).toHaveURL(new RegExp(`commentId=${replyId.replace('.', '\\.')}`))
    const replyBadge = page.getByText('Highlighted reply', { exact: true })
    await expect(replyBadge).toBeVisible({ timeout: 60_000 })
  })

  test('fullscreen comments keep auto-loading while the sentinel stays visible', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'needs more comment pages than are recorded')
    await openVideo(page)
    await waitForPlaybackOrSkip(test, page)

    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    await setPlayerFullscreen(page, true)
    await page.locator('.fullscreenCommentsToggle').click({ force: true })

    const comments = page.locator('.fullscreenCommentsOverlay .commentsContentWrapper')
    const commentCards = page.locator('.fullscreenCommentsOverlay .comment')
    await expect(comments).toBeVisible()

    await page.addStyleTag({
      content: `
        .fullscreenCommentsOverlay .comment { display: none; }
        .fullscreenCommentsOverlay.open { inset-block-start: calc(100% - 306px) !important; }
      `
    })
    await page.route(/\/youtubei\/v1\/next/, async (route) => {
      await new Promise(resolve => setTimeout(resolve, 500))
      await route.continue()
    })
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setGeneralAutoLoadMorePaginatedItemsEnabled', true)
    })
    const initialCommentCount = await commentCards.count()
    await expect.poll(() => commentCards.count(), { timeout: 30_000 }).toBeGreaterThan(initialCommentCount)
    const repeatedLoadCount = await commentCards.count()
    await expect.poll(() => commentCards.count(), { timeout: 30_000 }).toBeGreaterThan(repeatedLoadCount)
  })

  test('keeps the thumbnail visible while switching formats', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'needs the adaptive formats of the real API')
    await openVideo(page)
    await waitForPlaybackOrSkip(test, page)

    const initialUrl = page.url()
    const player = page.locator('.ftVideoPlayer')
    const watchComponent = await page.evaluateHandle(findWatchComponent)
    const formats = await player.evaluate((element, watchComponent) => {
      const overlay = element.ui ?? element.querySelector('video')?.ui
      const shakaPlayer = overlay?.getControls().getPlayer()
      if (!watchComponent || !shakaPlayer) {
        throw new Error('Unable to access the mounted player')
      }

      window.__hasLoadedAtFormatUnload = []
      window.__blockNextFormatUnload = false
      window.__formatUnloadBlocked = false
      const unload = shakaPlayer.unload.bind(shakaPlayer)
      shakaPlayer.unload = async (...args) => {
        window.__hasLoadedAtFormatUnload.push(watchComponent.refs.player.hasLoaded)
        await unload(...args)

        if (window.__blockNextFormatUnload) {
          window.__blockNextFormatUnload = false
          await new Promise(resolve => {
            window.__finishFormatUnload = resolve
            window.__formatUnloadBlocked = true
          })
        }
      }

      const watchView = watchComponent.proxy
      const oldFormat = watchView.activeFormat
      const newFormat = oldFormat === 'audio' ? 'dash' : 'audio'
      watchView.handleFormatChange(newFormat)
      return { oldFormat, newFormat }
    }, watchComponent)

    await expect.poll(() => page.evaluate(() => window.__hasLoadedAtFormatUnload)).toEqual([false])
    await expect.poll(() => watchComponent.evaluate((component) => ({
      format: component.proxy.activeFormat,
      loaded: component.refs.player.hasLoaded
    }))).toEqual({ format: formats.newFormat, loaded: true })
    expect(page.url()).toBe(initialUrl)

    const playbackPosition = await player.locator('video').evaluate((element) => {
      if (element.paused) throw new Error('Expected playback before the rapid format switch')
      return element.currentTime
    })
    await page.evaluate(() => { window.__blockNextFormatUnload = true })
    await watchComponent.evaluate((component, format) => component.proxy.handleFormatChange(format), formats.oldFormat)
    await expect.poll(() => page.evaluate(() => window.__formatUnloadBlocked)).toBe(true)
    await expect(player.locator('video')).toHaveAttribute('poster', /\S+/)
    await watchComponent.evaluate((component, format) => component.proxy.handleFormatChange(format), formats.newFormat)
    await page.evaluate(() => window.__finishFormatUnload())
    await expect.poll(() => watchComponent.evaluate((component) => ({
      format: component.proxy.activeFormat,
      loaded: component.refs.player.hasLoaded,
      paused: component.refs.player.$el.querySelector('video').paused
    }))).toEqual({ format: formats.newFormat, loaded: true, paused: false })
    await expect.poll(() => player.locator('video').evaluate(element => element.currentTime))
      .toBeGreaterThanOrEqual(playbackPosition - 1)
    expect(page.url()).toBe(initialUrl)

    await watchComponent.dispose()
  })

  test('keeps audio-only playback at video size with the thumbnail visible', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'needs the adaptive formats of the real API')
    await openVideo(page)
    await waitForPlaybackOrSkip(test, page)

    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await page.evaluate((watchComponent) => {
      if (!watchComponent) throw new Error('Unable to access the watch view')
      watchComponent.proxy.handleFormatChange('audio')
    }, watchComponent)
    await watchComponent.dispose()

    const player = page.locator('.ftVideoPlayer')
    await expect(player).toHaveClass(/sixteenByNine/)
    await expect(player.locator('video')).toHaveAttribute('poster', /\S+/)
  })

  test('resets the transcript scroll position when searching', async ({ page }) => {
    let releaseGermanTranscript
    const germanTranscriptReady = new Promise(resolve => { releaseGermanTranscript = resolve })
    await page.route('https://example.test/transcript.vtt', route => route.fulfill({
      body: longTranscript(),
      contentType: 'text/vtt'
    }))
    await page.route('https://example.test/transcript-de.vtt', async (route) => {
      await germanTranscriptReady
      await route.fulfill({
        body: longTranscript(),
        contentType: 'text/vtt'
      })
    })
    await page.locator(sel.searchInput).fill(VIDEO_URL)
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
    await expect(page.locator('.videoLayout')).toBeVisible()

    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await watchComponent.evaluate(async (component) => {
      const watchView = component.proxy
      watchView.videoLoadGeneration += 1
      watchView.errorMessage = null
      watchView.isLive = false
      watchView.isUpcoming = false
      watchView.playabilityStatus = 'OK'
      watchView.captions = [{
        url: 'https://example.test/transcript.vtt',
        label: 'English',
        language: 'en'
      }, {
        url: 'https://example.test/transcript-de.vtt',
        label: 'German',
        language: 'de'
      }]
      watchView.showTranscript = true
      watchView.isLoading = false
      await watchView.$nextTick()
    })

    const transcriptSegments = page.locator('.transcriptSegments')
    await expect(page.locator('.transcriptSegment').first()).toBeVisible()
    expect(await transcriptSegments.evaluate(element => getComputedStyle(element).maskImage))
      .toContain('linear-gradient')
    await expect(transcriptSegments).not.toHaveClass(/transcriptFadeTop/)
    await expect(transcriptSegments).toHaveClass(/transcriptFadeBottom/)
    const transcriptActions = page.locator('.sidebarArea .transcriptActions')
    await expect(transcriptActions.locator('.iconButton')).toHaveCount(2)
    await expect(transcriptActions.locator('.btn')).toHaveCount(0)
    const copyButton = transcriptActions.getByRole('button', { name: 'Copy' })
    const saveButton = transcriptActions.getByRole('button', { name: 'Save' })
    const transcriptCard = page.locator('.sidebarArea .transcriptCard')
    await expect(transcriptCard.locator('.transcriptHeader')).toHaveCSS('margin-block-end', '16px')
    const searchButton = transcriptCard.getByRole('button', { name: 'Search transcript' })
    await expect(searchButton).toBeVisible()
    const languageButton = transcriptCard.getByRole('button', { name: 'Transcript language' })
    await expect(languageButton).toBeVisible()
    await expect(transcriptCard.getByPlaceholder('Search transcript')).toHaveCount(0)
    await languageButton.click()
    await transcriptCard.getByRole('button', { name: 'German' }).click()
    await expect(copyButton).toHaveAttribute('aria-disabled', 'true')
    await expect(saveButton).toHaveAttribute('aria-disabled', 'true')
    releaseGermanTranscript()
    await expect(page.locator('.transcriptSegment').first()).toBeVisible()
    await expect(copyButton).toHaveAttribute('aria-disabled', 'false')
    await expect(saveButton).toHaveAttribute('aria-disabled', 'false')
    await transcriptSegments.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => transcriptSegments.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await expect(transcriptSegments).toHaveClass(/transcriptFadeTop/)
    await expect(transcriptSegments).not.toHaveClass(/transcriptFadeBottom/)
    await searchButton.click()
    await transcriptCard.getByPlaceholder('Search transcript').fill('Transcript line 2500.')
    await expect(page.locator('.transcriptSegment')).toHaveCount(1)
    await expect.poll(() => transcriptSegments.evaluate(element => element.scrollTop)).toBe(0)
    await expect(transcriptSegments).not.toHaveClass(/transcriptFadeTop|transcriptFadeBottom/)

    await watchComponent.dispose()
  })

  test('long transcripts quickly align with the current cue', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await page.route(/\/api\/timedtext/, route => route.fulfill({
      body: longTranscript(),
      contentType: 'text/vtt'
    }))
    await openCaptionedVideoOrSkip(page)
    await waitForPlaybackOrSkip(test, page)

    const video = page.locator('video.player')
    const targetTime = await video.evaluate((element) => {
      element.pause()
      const time = Math.min(3600, Math.floor(element.duration / 2))
      element.currentTime = time
      element.dispatchEvent(new Event('timeupdate'))
      return time
    })
    expect(targetTime).toBeGreaterThan(100)
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(100)
    await page.evaluate(() => {
      const nativeScrollTo = Element.prototype.scrollTo
      window.transcriptScrollCalls = []
      Element.prototype.scrollTo = function (...args) {
        if (this.classList.contains('transcriptSegments')) {
          window.transcriptScrollCalls.push({
            behavior: args[0]?.behavior,
            distance: Math.abs(args[0]?.top - this.scrollTop),
            clientHeight: this.clientHeight
          })
        }
        return nativeScrollTo.apply(this, args)
      }
    })

    await page.getByRole('button', { name: 'Show transcript' }).click()
    const activeSegment = page.locator('.transcriptSegment[aria-current="true"]')
    await expect(activeSegment).toBeVisible({ timeout: 30_000 })
    expect(Number(await activeSegment.getAttribute('data-segment-index'))).toBeGreaterThan(100)
    await expect.poll(() => page.evaluate(() => window.transcriptScrollCalls[0])).toBeTruthy()
    const scrollCall = await page.evaluate(() => window.transcriptScrollCalls[0])
    expect(scrollCall.behavior).toBe('smooth')
    expect(scrollCall.distance).toBeLessThanOrEqual(scrollCall.clientHeight)
  })

  test('keeps the current chapter centered in the sidebar and fullscreen dock', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await openVideo(page)

    const video = await waitForPlaybackOrSkip(test, page)
    await video.evaluate(async element => {
      element.pause()
      element.currentTime = element.duration * 20.5 / 40
      if (element.seeking) {
        await new Promise(resolve => element.addEventListener('seeked', resolve, { once: true }))
      }
    })

    const currentChapterIndex = 20
    const chapterDuration = await video.evaluate(element => element.duration / 40)
    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await page.evaluate(async ({ component, chapterIndex, chapterDuration }) => {
      const watchView = component.proxy
      if (!watchView) {
        throw new Error('Unable to access the watch view')
      }

      watchView.videoChapters = Array.from({ length: 40 }, (_, index) => ({
        title: `Test chapter ${index + 1}`,
        timestamp: `${index}:00`,
        startSeconds: index * chapterDuration,
        endSeconds: (index + 1) * chapterDuration
      }))
      watchView.videoCurrentChapterIndex = chapterIndex
      watchView.showSidebarChapters = true
      await watchView.$nextTick()
    }, { component: watchComponent, chapterIndex: currentChapterIndex, chapterDuration })

    const panel = page.locator('.watchVideoChaptersPanel')
    await expect(panel).toBeVisible()
    await expect.poll(() => panel.evaluate((element) => {
      const container = element.querySelector('.chaptersWrapper')
      const currentChapter = container?.querySelector('.chapter.current')
      if (!container || !currentChapter) {
        return Number.POSITIVE_INFINITY
      }

      const containerBounds = container.getBoundingClientRect()
      const chapterBounds = currentChapter.getBoundingClientRect()
      const containerMid = containerBounds.top + containerBounds.height / 2
      const chapterMid = chapterBounds.top + chapterBounds.height / 2
      return Math.abs(containerMid - chapterMid)
    })).toBeLessThan(40)

    await panel.getByRole('button', { name: 'Close Chapters' }).click()
    await expect(panel).toHaveCount(0)

    await setPlayerFullscreen(page, true)
    await page.locator('.shaka-controls-button-panel .ft-chapters-button').click({ force: true })

    const overlay = page.locator('.chapterOverlay')
    await expect(overlay).toBeVisible()
    await expect.poll(() => overlay.evaluate((element) => {
      const container = element.querySelector('.chaptersWrapper')
      const currentChapter = container?.querySelector('.chapter.current')
      if (!container || !currentChapter) {
        return Number.POSITIVE_INFINITY
      }

      const containerBounds = container.getBoundingClientRect()
      const chapterBounds = currentChapter.getBoundingClientRect()
      const containerMid = containerBounds.top + containerBounds.height / 2
      const chapterMid = chapterBounds.top + chapterBounds.height / 2
      return Math.abs(containerMid - chapterMid)
    })).toBeLessThan(40)
  })

  test('comments load on request', async ({ app, page }) => {
    await disableAutomaticPagination(page)
    await openVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()

    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })
    expect(await page.locator('.comment').count()).toBeGreaterThan(0)

    const commentHeader = page.locator('.commentHeader')
    const commentTitle = commentHeader.locator('.commentsTitle')
    const commentActions = commentHeader.locator('.commentHeaderActions')
    const commentSort = commentActions.locator('.select')
    const reloadComments = commentActions.locator('.reloadComments')

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setTabBarPosition', 'left')
      store.commit('setVerticalTabBarWidth', 180)
    })
    await expect(page.locator('.app')).toHaveClass(/verticalTabs/)
    await setWindowWidth(app, 660)
    await expect.poll(async () => {
      const [
        tabBarBox,
        topNavBox,
        routeBox,
        sideNavBox,
        headerBox,
        titleBox,
        actionsBox,
        sortBox,
        reloadBox
      ] = await Promise.all([
        page.locator('.tabBar.vertical').boundingBox(),
        page.locator('.topNav').boundingBox(),
        page.locator('.app > .routerView').boundingBox(),
        page.locator('.sideNav').boundingBox(),
        commentHeader.boundingBox(),
        commentTitle.boundingBox(),
        commentActions.boundingBox(),
        commentSort.boundingBox(),
        reloadComments.boundingBox()
      ])
      const viewportWidth = await page.evaluate(() => window.innerWidth)
      return (
        topNavBox.x >= tabBarBox.x + tabBarBox.width - 1 &&
        topNavBox.x + topNavBox.width <= viewportWidth + 1 &&
        routeBox.x + routeBox.width <= viewportWidth + 1 &&
        sideNavBox.x >= tabBarBox.x + tabBarBox.width - 1 &&
        sideNavBox.x + sideNavBox.width <= viewportWidth + 1 &&
        actionsBox.y >= titleBox.y + titleBox.height &&
        Math.abs(actionsBox.width - headerBox.width) <= 1 &&
        sortBox.x >= headerBox.x &&
        reloadBox.x + reloadBox.width <= headerBox.x + headerBox.width
      )
    }).toBe(true)
    await reloadComments.click({ trial: true })

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setTabBarPosition', 'top')
    })
    await expect(page.locator('.app')).not.toHaveClass(/verticalTabs/)
    await expect.poll(async () => {
      const [topNavBox, routeBox, titleBox, actionsBox] = await Promise.all([
        page.locator('.topNav').boundingBox(),
        page.locator('.app > .routerView').boundingBox(),
        commentTitle.boundingBox(),
        commentActions.boundingBox()
      ])
      const viewportWidth = await page.evaluate(() => window.innerWidth)
      return (
        topNavBox.x <= 1 &&
        topNavBox.x + topNavBox.width <= viewportWidth + 1 &&
        routeBox.x + routeBox.width <= viewportWidth + 1 &&
        actionsBox.y < titleBox.y + titleBox.height
      )
    }).toBe(true)
    await setWindowWidth(app, 1600)

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setGeneralAutoLoadMorePaginatedItemsEnabled', true)
    })
    await expect(page.getByRole('status', { name: 'Load More Comments' })).toHaveCount(0)

    // Exercise reply loading and its continuation path, not only the initial
    // top-level comment batch (8bcf0b58d).
    const replyToggle = page.locator('.commentReplyRootToggle .commentReplyContinuationButton').first()
    await expect(replyToggle).toBeVisible()
    await replyToggle.click()
    const replies = page.locator('.commentReplyBranch')
    await expect(replies.first()).toBeVisible({ timeout: 30_000 })

    const showMoreReplies = page.locator(
      '.commentReplies > .commentReplyContinuation > .commentReplyContinuationButton:not([aria-expanded])'
    ).first()
    await expect(showMoreReplies).toBeVisible()
    const [continuationResponse] = await Promise.all([
      page.waitForResponse((response) => (
        response.request().method() === 'POST' &&
        response.url().includes('/youtubei/v1/next')
      )),
      showMoreReplies.click()
    ])
    expect(continuationResponse.ok()).toBe(true)
    await expect(replies.first()).toBeVisible()
  })

  test('reports comments as turned off instead of empty', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await openVideo(page, COMMENTS_DISABLED_VIDEO)

    const commentSection = page.locator('.commentsArea')
    await expect(commentSection.locator('.noCommentMsg')).toHaveText(
      'Comments are turned off',
      { timeout: 30_000 }
    )
    // Nothing to load, sort or reload, so those affordances stay hidden.
    await expect(commentSection.locator('.getCommentsTitle')).toHaveCount(0)
    await expect(commentSection.locator('.noCommentActions')).toHaveCount(0)
    await expect(commentSection.locator('.comment')).toHaveCount(0)

    // Losing the actions must not collapse the card into a cramped strip.
    const [messageBox, cardBox] = await Promise.all([
      commentSection.locator('.noCommentMsg').boundingBox(),
      commentSection.locator('.card').boundingBox()
    ])
    expect(cardBox.height).toBeGreaterThanOrEqual(messageBox.height + 40)
  })

  test('fullscreen comments dock preserves its active state and scroll position', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await openVideo(page)
    const video = await waitForPlaybackOrSkip(test, page)
    await video.evaluate(element => element.pause())

    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    await setPlayerFullscreen(page, true)
    await page.locator('.fullscreenCommentsToggle').evaluate(button => button.click())

    const comments = page.locator('.fullscreenCommentsOverlay .commentsContentWrapper')
    await expect(comments).toBeVisible()
    await expect.poll(async () => comments.evaluate((element) => element.scrollHeight)).toBeGreaterThan(500)
    await comments.evaluate((element) => { element.scrollTop = 300 })
    await expect.poll(async () => comments.evaluate((element) => element.scrollTop)).toBe(300)

    await page.locator('.fullscreenCommentHeader .fullscreenCommentAction').last().click()
    await expect(page.locator('.fullscreenCommentsOverlay.open')).toHaveCount(0)
    await page.locator('.fullscreenCommentsToggle').evaluate(button => button.click())
    await expect(comments).toBeVisible()
    await expect.poll(async () => comments.evaluate((element) => element.scrollTop)).toBe(300)

    await setPlayerFullscreen(page, false)
    await setPlayerFullscreen(page, true)
    await expect(page.locator('.fullscreenCommentsOverlay.open')).toBeVisible()
    await expect.poll(async () => comments.evaluate((element) => element.scrollTop)).toBe(300)
  })

  test('mutes SponsorBlock mute segments without skipping', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')

    let submittedBody = null
    await page.route('**/api/skipSegments/**', route => route.fulfill({
      body: JSON.stringify([{
        videoID: 'jNQXAC9IVRw',
        segments: [{
          UUID: 'mute-segment',
          actionType: 'mute',
          category: 'sponsor',
          description: '',
          locked: 0,
          segment: [2, 10],
          videoDuration: 19,
          votes: 1
        }]
      }]),
      contentType: 'application/json'
    }))
    await page.route('**/api/skipSegments', async route => {
      submittedBody = route.request().postDataJSON()
      await route.fulfill({
        body: JSON.stringify([{
          UUID: 'submitted-mute-segment',
          category: 'sponsor',
          segment: [11, 12]
        }]),
        contentType: 'application/json'
      })
    })
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setUseSponsorBlock', true)
      await store.dispatch('updateSponsorBlockEnableSubmission', true)
    })

    await openVideo(page)
    await waitForPlaybackOrSkip(test, page)

    const video = page.locator('.ftVideoPlayer video')
    await video.evaluate(element => {
      element.pause()
      element.muted = false
      element.currentTime = 3
      element.dispatchEvent(new Event('timeupdate'))
    })
    await expect(video).toHaveJSProperty('muted', true)
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeLessThan(10)

    const muteNotification = page.locator('.skippedSegment').filter({ hasText: 'Sponsor Muted' })
    await expect(muteNotification).toBeVisible()
    await expect(muteNotification.locator('.skippedSegmentTimer')).toHaveText('7s')
    await muteNotification.getByRole('button', { name: /Unmute/ }).click()
    await expect(video).toHaveJSProperty('muted', false)
    await expect(muteNotification).toBeVisible()
    await expect(muteNotification.getByRole('button', { name: /Mute/ })).toBeVisible()

    await video.evaluate(element => {
      element.currentTime = 4
      element.dispatchEvent(new Event('timeupdate'))
    })
    await expect(muteNotification).toBeVisible()
    await muteNotification.getByRole('button', { name: /Mute/ }).click()
    await expect(video).toHaveJSProperty('muted', true)

    await video.evaluate(element => {
      element.currentTime = 11
      element.dispatchEvent(new Event('timeupdate'))
    })
    await expect(video).toHaveJSProperty('muted', false)
    await expect(muteNotification).toHaveCount(0)

    await video.evaluate(element => {
      element.muted = true
      element.currentTime = 3
      element.dispatchEvent(new Event('timeupdate'))
    })
    await expect(muteNotification).toBeVisible()
    await muteNotification.getByRole('button', { name: /Unmute/ }).click()
    await expect(video).toHaveJSProperty('muted', false)
    await video.evaluate(element => {
      element.currentTime = 11
      element.dispatchEvent(new Event('timeupdate'))
    })
    await expect(video).toHaveJSProperty('muted', true)
    await video.evaluate(element => { element.muted = false })

    await video.evaluate(element => {
      element.pause()
      element.currentTime = 11
    })
    await page.locator('.sponsorblock-start-button').click({ force: true })
    await video.evaluate(element => { element.currentTime = 12 })
    await page.locator('.sponsorblock-end-button').click({ force: true })

    const submissionMenu = page.locator('.sponsorBlockSubmissionMenu')
    await submissionMenu.locator('select').nth(1).selectOption('mute')
    await submissionMenu.getByRole('button', { name: 'Preview' }).click()
    await video.evaluate(element => {
      element.currentTime = 11.5
      element.dispatchEvent(new Event('timeupdate'))
    })
    await expect(video).toHaveJSProperty('muted', true)
    await video.evaluate(element => {
      element.currentTime = 12.1
      element.dispatchEvent(new Event('timeupdate'))
    })
    await expect(video).toHaveJSProperty('muted', false)

    await submissionMenu.locator('.sponsorBlockSubmissionButton').click()
    await expect.poll(() => submittedBody).not.toBeNull()
    expect(submittedBody.segments).toEqual([{
      actionType: 'mute',
      category: 'sponsor',
      description: '',
      segment: [11, 12]
    }])
  })

  test('full-window and fullscreen modes show the title', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await page.route(/\/api\/timedtext/, route => route.fulfill({
      body: 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nTest transcript line.\n',
      contentType: 'text/vtt'
    }))
    await openCaptionedVideoOrSkip(page)
    await waitForPlaybackOrSkip(test, page)

    const title = page.locator('.playerFullscreenTitleOverlay')
    await page.keyboard.press('s')
    await expect(page.locator('.ftVideoPlayer')).toHaveClass(/fullWindow/)
    await expect(title).toBeVisible()
    await expect(title).toContainText(CAPTIONED_VIDEO.title)
    await page.keyboard.press('s')
    await expect(page.locator('.ftVideoPlayer')).not.toHaveClass(/fullWindow/)
    await expect(title).toBeHidden()

    await setPlayerFullscreen(page, true)
    const titleBounds = await title.boundingBox()
    const playerBounds = await page.locator('.ftVideoPlayer').boundingBox()
    const titleRight = titleBounds.x + titleBounds.width
    const besideTitleX = titleRight + (playerBounds.x + playerBounds.width - titleRight) / 2
    const titleCenterY = titleBounds.y + titleBounds.height / 2

    await page.mouse.dblclick(besideTitleX, titleCenterY)
    await expect.poll(
      async () => page.locator('.ftVideoPlayer').evaluate((element) => document.fullscreenElement === element)
    ).toBe(false)

    await setPlayerFullscreen(page, true)
    await page.mouse.move(titleBounds.x + titleBounds.width / 2, titleCenterY)
    await page.mouse.down({ clickCount: 1 })
    await page.mouse.up({ clickCount: 1 })
    await page.waitForTimeout(100)
    await page.mouse.down({ clickCount: 2 })
    await page.mouse.up({ clickCount: 2 })
    await expect.poll(
      async () => page.locator('.ftVideoPlayer').evaluate((element) => document.fullscreenElement === element)
    ).toBe(true)

    await title.click({ force: true })

    await expect(title).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('.fullscreenMetadataOverlay.open')).toBeVisible()
    await expect(page.locator('.fullscreenMetadataTarget .videoTitle')).toContainText(CAPTIONED_VIDEO.title)
    await expect(page.locator('.fullscreenMetadataTarget')).toHaveAttribute('data-overlayscrollbars-viewport')
    await expect(page.locator('.fullscreenMetadataOverlay .os-scrollbar-vertical')).toHaveCount(1)
    await expect(page.locator('.fullscreenMetadataTarget .descriptionScroll'))
      .not.toHaveAttribute('data-overlayscrollbars-viewport')
    await expect(page.locator('.fullscreenMetadataTarget .shareButton')).toHaveCount(0)
    await expect(page.locator('.fullscreenMetadataTarget .quickBookmarkVideoIcon')).toHaveCount(0)
    await expect(page.locator('.fullscreenMetadataTarget').getByRole('button', { name: 'Add to playlist' })).toHaveCount(0)
    await expect(page.locator('.fullscreenActions .fullscreenShareAction')).toHaveCount(1)
    await expect(page.locator('.fullscreenActions .fullscreenPlaylistAction')).toHaveCount(1)
    await expect(page.locator('.fullscreenActions .fullscreenQuickBookmarkAction')).toHaveCount(1)
    await expect(page.locator('.fullscreenActions .fullscreenTranscriptToggle')).toHaveCount(1)
    await expect(page.locator('.fullscreenMetadataTarget').getByRole('button', { name: 'Show transcript' })).toHaveCount(0)
    const dockDescription = page.locator('.fullscreenMetadataTarget .videoDescription')
    await expect(dockDescription).toHaveClass(/alwaysExpanded/)
    await expect(dockDescription).not.toHaveClass(/short/)
    await expect(dockDescription.locator('.descriptionStatus')).toHaveCount(0)
    await expect(page.locator('.infoArea .videoTitle')).toHaveCount(0)
    await expect(page.locator('.fullscreenMetadataHeader')).not.toHaveCSS('cursor', 'grab')
    const playerVideo = page.locator('.ftVideoPlayer video.player')
    const metadataDock = page.locator('.fullscreenMetadataOverlay.open')
    await expect.poll(async () => {
      const [currentVideoBounds, currentMetadataBounds] = await Promise.all([
        playerVideo.boundingBox(),
        metadataDock.boundingBox()
      ])
      return currentVideoBounds.x + currentVideoBounds.width - currentMetadataBounds.x
    }).toBeLessThanOrEqual(1)
    await page.locator('.ftVideoPlayer').evaluate((element) => {
      const annotations = document.createElement('div')
      annotations.className = 'videoAnnotations'
      annotations.dataset.testAnnotations = ''
      annotations.style.position = 'absolute'
      annotations.style.insetBlock = '0'
      annotations.style.insetInlineStart = '0'
      element.append(annotations)
    })
    const annotations = page.locator('[data-test-annotations]')
    await expect(annotations).toHaveCSS('transition-property', 'inset-inline-end')
    await expect(annotations).toHaveCSS('transition-duration', '0.25s')
    await expect.poll(async () => {
      const [videoBounds, annotationBounds] = await Promise.all([
        playerVideo.boundingBox(),
        annotations.boundingBox()
      ])
      return Math.abs(
        videoBounds.x + videoBounds.width - annotationBounds.x - annotationBounds.width
      )
    }).toBeLessThanOrEqual(1)
    await page.locator('.fullscreenActions').getByRole('button', { name: 'Show transcript' }).click()
    await expect(page.locator('.fullscreenTranscriptOverlay.open')).toBeVisible()
    await expect(page.locator('.fullscreenMetadataHeader')).toHaveCSS('cursor', 'grab')
    await expect(page.locator('.fullscreenTranscriptTarget .transcriptCard')).toBeVisible()
    await expect(page.locator('.fullscreenTranscriptTarget .transcriptSegment').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.fullscreenTranscriptTarget .transcriptSegments'))
      .toHaveAttribute('data-overlayscrollbars-viewport')
    await expect(page.locator('.fullscreenTranscriptTarget .transcriptActions .iconButton')).toHaveCount(2)

    const transcriptDock = page.locator('.fullscreenTranscriptOverlay.open')
    await expect.poll(async () => {
      const [metadataBox, transcriptBox] = await Promise.all([
        metadataDock.boundingBox(),
        transcriptDock.boundingBox()
      ])
      return Math.abs(metadataBox.height - transcriptBox.height)
    }).toBeLessThan(5)
    const [stackedMetadataBounds, transcriptBounds] = await Promise.all([
      metadataDock.boundingBox(),
      transcriptDock.boundingBox()
    ])
    const resizeHandle = metadataDock.locator('.fullscreenDockResizeHandle')
    const resizeHandleBounds = await resizeHandle.boundingBox()
    await page.mouse.move(
      resizeHandleBounds.x + resizeHandleBounds.width / 2,
      resizeHandleBounds.y + resizeHandleBounds.height / 2
    )
    await page.mouse.down()
    await page.locator('.ftVideoPlayer').evaluate(element => element.classList.add('no-cursor'))
    await expect(page.locator('.ftVideoPlayer')).toHaveCSS('cursor', 'row-resize')
    await expect(metadataDock).toHaveCSS('transition-duration', '0s')
    await page.mouse.move(resizeHandleBounds.x + resizeHandleBounds.width / 2, resizeHandleBounds.y + 100)
    await page.mouse.up()
    await page.locator('.ftVideoPlayer').evaluate(element => element.classList.remove('no-cursor'))
    await expect.poll(async () => (await metadataDock.boundingBox()).height)
      .toBeGreaterThan(stackedMetadataBounds.height + 60)
    await expect.poll(async () => (await transcriptDock.boundingBox()).height)
      .toBeLessThan(transcriptBounds.height - 60)

    const resizedMetadataHeight = (await metadataDock.boundingBox()).height
    await resizeHandle.press('ArrowUp')
    await expect.poll(async () => (await metadataDock.boundingBox()).height)
      .toBeLessThan(resizedMetadataHeight)

    const [currentHandleBounds, fullscreenPlayerBounds] = await Promise.all([
      resizeHandle.boundingBox(),
      page.locator('.ftVideoPlayer').boundingBox()
    ])
    await page.mouse.move(
      currentHandleBounds.x + currentHandleBounds.width / 2,
      currentHandleBounds.y + currentHandleBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(
      currentHandleBounds.x + currentHandleBounds.width / 2,
      fullscreenPlayerBounds.y + fullscreenPlayerBounds.height - 1
    )
    await page.mouse.up()
    await expect.poll(async () => (await transcriptDock.boundingBox()).height)
      .toBeGreaterThanOrEqual(360)

    const fullscreenPlayer = page.locator('.ftVideoPlayer')
    await fullscreenPlayer.evaluate(element => {
      Object.defineProperty(element, 'clientHeight', { configurable: true, value: 700 })
    })
    await expect.poll(async () => fullscreenPlayer.evaluate(element => element.clientHeight)).toBe(700)
    const denseStackMetadataHeight = (await metadataDock.boundingBox()).height
    const denseStackHandleBounds = await resizeHandle.boundingBox()
    await page.mouse.move(
      denseStackHandleBounds.x + denseStackHandleBounds.width / 2,
      denseStackHandleBounds.y + denseStackHandleBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(
      denseStackHandleBounds.x + denseStackHandleBounds.width / 2,
      denseStackHandleBounds.y + 60
    )
    await page.mouse.up()
    await expect.poll(async () => (await metadataDock.boundingBox()).height)
      .toBeGreaterThan(denseStackMetadataHeight + 20)
    await resizeHandle.dblclick({ force: true })
    await expect.poll(async () => {
      const [metadataBox, transcriptBox] = await Promise.all([
        metadataDock.boundingBox(),
        transcriptDock.boundingBox()
      ])
      return Math.abs(metadataBox.height - transcriptBox.height)
    }).toBeLessThan(5)
    await fullscreenPlayer.evaluate(element => { delete element.clientHeight })
    await expect.poll(async () => fullscreenPlayer.evaluate(element => element.clientHeight)).toBeGreaterThan(700)

    const metadataHeader = metadataDock.locator('.fullscreenMetadataHeader')
    const transcriptHeader = transcriptDock.locator('.transcriptHeader')
    const expandedMetadataHeight = (await metadataDock.boundingBox()).height
    await metadataHeader.dblclick({ position: { x: 30, y: 26 } })
    await expect.poll(async () => (await metadataDock.boundingBox()).height)
      .toBeGreaterThanOrEqual(60)
    await expect.poll(async () => (await metadataDock.boundingBox()).height)
      .toBeLessThan(61)
    await metadataHeader.dblclick({ position: { x: 30, y: 26 } })
    await expect.poll(async () => Math.abs((await metadataDock.boundingBox()).height - expandedMetadataHeight))
      .toBeLessThan(2)

    const [metadataHeaderBounds, transcriptHeaderBounds] = await Promise.all([
      metadataHeader.boundingBox(),
      transcriptHeader.boundingBox()
    ])
    await page.mouse.move(
      transcriptHeaderBounds.x + 30,
      transcriptHeaderBounds.y + transcriptHeaderBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(
      metadataHeaderBounds.x + 30,
      metadataHeaderBounds.y + 10,
      { steps: 5 }
    )
    await page.mouse.up()
    await expect.poll(async () => {
      const [metadataBox, transcriptBox] = await Promise.all([
        metadataDock.boundingBox(),
        transcriptDock.boundingBox()
      ])
      return transcriptBox.y < metadataBox.y
    }).toBe(true)

    const [reorderedMetadataBounds, reorderedTranscriptHeaderBounds] = await Promise.all([
      metadataDock.boundingBox(),
      transcriptHeader.boundingBox()
    ])
    await page.mouse.move(
      reorderedTranscriptHeaderBounds.x + 30,
      reorderedTranscriptHeaderBounds.y + reorderedTranscriptHeaderBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(
      reorderedMetadataBounds.x + 30,
      reorderedMetadataBounds.y + reorderedMetadataBounds.height - 10,
      { steps: 5 }
    )
    await page.mouse.up()
    await expect.poll(async () => {
      const [metadataBox, transcriptBox] = await Promise.all([
        metadataDock.boundingBox(),
        transcriptDock.boundingBox()
      ])
      return metadataBox.y < transcriptBox.y
    }).toBe(true)

    await page.getByRole('button', { name: 'Close transcript' }).click()
    await expect(page.locator('.fullscreenTranscriptOverlay.open')).toHaveCount(0)

    await setPlayerFullscreen(page, false)
    await expect(page.locator('.infoArea .videoTitle')).toBeVisible()
    const inlineDescription = page.locator('.infoArea .videoDescription')
    await expect(inlineDescription).not.toHaveClass(/alwaysExpanded/)
    await expect(inlineDescription.locator('.descriptionStatus')).not.toHaveCount(0)
    await setPlayerFullscreen(page, true)
    await expect(page.locator('.fullscreenMetadataOverlay.open')).toBeVisible()

    await page.getByRole('button', { name: 'Close video information' }).click()
    await expect(title).toHaveAttribute('aria-expanded', 'false')
  })

  test('full-window mode locks the page scroll position', async ({ page }) => {
    await openVideo(page)
    await expect(page.locator('.videoLayout')).toBeVisible()

    const scrollMetrics = await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateAlwaysShowScrollbars', true)
      await store.dispatch('updateUiScale', 95)
      const maxScrollTop = document.documentElement.scrollHeight - window.innerHeight
      const scrollTarget = Math.max(1, Math.min(300, Math.floor(maxScrollTop / 2)))
      window.scrollTo(0, scrollTarget)
      return { maxScrollTop, scrollTop: window.scrollY }
    })
    const { maxScrollTop, scrollTop } = scrollMetrics
    expect(scrollTop).toBeGreaterThan(0)
    expect(scrollTop).toBeLessThan(maxScrollTop)

    const body = page.locator('body')
    const bodyScrollbar = page.locator('body > .os-scrollbar-vertical')
    await expect(bodyScrollbar).toBeVisible()
    await page.keyboard.press('s')
    await expect(page.locator('.ftVideoPlayer')).toHaveClass(/fullWindow/)
    await expect(body).toHaveClass(/playerFullWindow/)
    await expect(bodyScrollbar).toBeHidden()

    await page.mouse.wheel(0, 600)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollTop)

    await page.keyboard.press('s')
    await expect(page.locator('.ftVideoPlayer')).not.toHaveClass(/fullWindow/)
    await expect(body).not.toHaveClass(/playerFullWindow/)
    await expect.poll(async () => (
      bodyScrollbar.evaluate((element) => getComputedStyle(element).display)
    )).not.toBe('none')
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollTop)
  })

  test('fullscreen player overlays appear above the action pill', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await openVideo(page)
    await waitForPlaybackOrSkip(test, page)

    await setPlayerFullscreen(page, true)
    const actions = page.locator('.fullscreenActions')
    const seekBar = page.locator('.shaka-seek-bar-container')
    const controls = page.locator('.shaka-controls-container')
    const fullscreenButton = page.locator('.shaka-fullscreen-button')
    const shareButton = actions.getByRole('button', { name: 'Share Video' })
    await actions.evaluate((element) => {
      const sponsorBlockNotice = element.cloneNode(false)
      sponsorBlockNotice.className = 'skippedSegmentsWrapper'
      element.parentElement.append(sponsorBlockNotice)
    })
    const sponsorBlockNotice = page.locator('.skippedSegmentsWrapper')

    await expect(actions).toBeVisible()
    await expect(actions).toHaveCSS('z-index', '2')
    await expect(sponsorBlockNotice).toHaveCSS('z-index', '3')
    await shareButton.click()
    await expect(actions.locator('.fullscreenShareAction .iconDropdown')).toBeVisible()
    await expect(actions).toHaveCSS('z-index', '5')
    await expect(sponsorBlockNotice).toHaveCSS('z-index', '3')
    await fullscreenButton.hover()
    await expect.poll(() => fullscreenButton.evaluate((element) => {
      const { content } = getComputedStyle(element, '::after')
      return content !== 'none' && content !== 'normal' && content !== ''
    })).toBe(true)
    await expect(actions).toHaveCSS('z-index', '5')
    await page.keyboard.press('Escape')
    await expect(actions.locator('.fullscreenShareAction .iconDropdown')).toHaveCount(0)
    await shareButton.hover()
    await expect(actions).toHaveCSS('z-index', '2')
    await actions.getByRole('button', { name: 'Add to playlist' }).click()
    await expect(actions.locator('.fullscreenPlaylistAction .iconDropdown')).toBeVisible()
    await expect(actions).toHaveCSS('z-index', '5')
    await expect(sponsorBlockNotice).toHaveCSS('z-index', '3')
    await page.keyboard.press('Escape')
    await expect(actions.locator('.fullscreenPlaylistAction .iconDropdown')).toHaveCount(0)
    await expect(actions).toHaveCSS('z-index', '2')
    await fullscreenButton.hover()
    // The Shaka tooltip is a hover-only ::after pseudo-element whose content is
    // pulled from the button's aria-label. Assert it actually renders (rather
    // than only checking the static capability class) so a tooltip
    // rendering/config regression fails the test; the z-index checks below then
    // confirm it sits above the action dock.
    await expect(actions).toHaveCSS('z-index', '0')
    await expect(sponsorBlockNotice).toHaveCSS('z-index', '3')
    const seekBarBounds = await seekBar.boundingBox()
    await page.mouse.move(
      seekBarBounds.x + (seekBarBounds.width / 2),
      seekBarBounds.y + (seekBarBounds.height / 2)
    )
    // End-screen annotations use z-index 2, so the controls stacking context
    // must rise above them for its seek preview to be visible.
    await expect(controls).toHaveCSS('z-index', '3')
    await expect(actions).toHaveCSS('z-index', '0')
    await expect(sponsorBlockNotice).toHaveCSS('z-index', '0')
  })

  test.describe('fullscreen captions', () => {
    test.use({
      seed: {
        settings: {
          defaultCaptionSettings: JSON.stringify({ fontScale: 1.5 })
        }
      }
    })
  })

  test.describe('fullscreen playlist dock', () => {
    test.use({
      seed: {
        settings: {
          uiRoundness: 200,
        },
        playlists: [FULLSCREEN_PLAYLIST],
        history: [{
          ...FULLSCREEN_PLAYLIST.videos[0],
          _id: 'jNQXAC9IVRw',
          watchProgress: 19,
          isWatched: true,
          timeWatched: Date.now(),
          isLive: false,
        }]
      }
    })

    test('shows the progress preview above the content viewport', async ({ page, innertube }) => {
      test.skip(innertube.replay, 'watch page hydration needs the real API')
      await openFullscreenPlaylistVideo(page)
      const video = await waitForPlaybackOrSkip(test, page)
      await video.evaluate(element => element.pause())
      await expect(page.locator('.watchVideoPlaylist.resizablePlaylist')).toBeVisible()

      await page.locator('.full-window-button').click({ force: true })
      await page.locator('.fullscreenPlaylistToggle').click({ force: true })

      const dock = page.locator('.fullscreenPlaylistOverlay.open')
      const content = dock.locator('.fullscreenPlaylistContent')
      const progress = dock.locator('.playlistProgressBarContainer')
      await expect(dock).toBeVisible()
      await progress.hover()
      const progressBox = await progress.boundingBox()
      await page.mouse.move(progressBox.x + 1, progressBox.y + (progressBox.height / 2))

      const preview = dock.locator('.previewTooltip')
      await expect(preview).toBeVisible()
      const contentBox = await content.boundingBox()
      const previewBox = await preview.boundingBox()
      expect(previewBox.y).toBeLessThan(contentBox.y)
      await expect(content).toHaveCSS('overflow', 'visible')
      await expect(content).toHaveAttribute('data-overlayscrollbars-viewport')

      for (const position of [0.25, 0.5, 0.75]) {
        await page.mouse.move(
          progressBox.x + (progressBox.width * position),
          progressBox.y + (progressBox.height / 2)
        )
        const box = await preview.boundingBox()
        expect(box.x).toBeGreaterThanOrEqual(contentBox.x - 1)
        expect(box.x + box.width).toBeLessThanOrEqual(contentBox.x + contentBox.width + 1)
      }

      await page.mouse.move(
        progressBox.x + progressBox.width - 1,
        progressBox.y + (progressBox.height / 2)
      )
      const rightEdgeBox = await preview.boundingBox()
      expect(rightEdgeBox.x + rightEdgeBox.width).toBeLessThanOrEqual(
        contentBox.x + contentBox.width + 1
      )
    })
  })

  test('full window playlist action shows its popover above the player', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await openVideo(page)
    const video = await waitForPlaybackOrSkip(test, page)
    await video.evaluate(element => element.pause())

    await page.locator('.full-window-button').click()
    await expect(page.locator('.ftVideoPlayer.fullWindow')).toBeVisible()
    await page.locator('.fullscreenPlaylistAction .iconButton').click()

    const popover = page.locator('.fullscreenPlaylistAction .iconDropdown')
    await expect(popover.locator('.dropdownHeader')).toBeVisible()
    await expect(popover.locator('.playlistRow').first()).toBeVisible()
    // Dismiss the popover before continuing
    await page.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)

    await page.locator('.fullscreenQuickBookmarkAction').click()
    const toastHolder = page.locator('.toast-holder')
    await expect(toastHolder.locator('.toast')).toBeVisible()
    expect(await toastHolder.evaluate(element => Number(getComputedStyle(element).zIndex))).toBeGreaterThan(1000)
  })

  // Regression: edited comments show their "(edited)" marker (929369543)
  test('edited comments carry the edited badge', async ({ page }) => {
    await disableAutomaticPagination(page)
    await openVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    // The comment ranking is not deterministic, so load a few batches and
    // only assert the badge when an edited comment actually shows up.
    const editedBadge = page.locator('.commentDate', { hasText: '(edited)' })
    for (let i = 0; i < 3 && (await editedBadge.count()) === 0; i++) {
      const showMore = page.locator('.getMoreComments')
      if (await showMore.count() === 0) { break }
      await showMore.scrollIntoViewIfNeeded()
      await showMore.click()
      await page.waitForTimeout(2000)
    }

    test.skip(await editedBadge.count() === 0, 'no edited comments in the loaded batches')
    await expect(editedBadge.first()).toBeVisible()
  })
})

test.describe('custom Shorts player', () => {
  const SHORTS_CHANNEL = 'UCshortsfeed000000000000'
  const FIRST_SHORT_THUMBNAIL = 'https://i.ytimg.com/vi/w1WKmSqwM8I/frame0.jpg?selected=1'
  const SECOND_SHORT_THUMBNAIL = 'https://i.ytimg.com/vi/RZ6PG5QATg4/frame0.jpg?selected=1'

  test.use({
    seed: {
      settings: {
        useCustomShortsPlayer: true,
        useSponsorBlock: true,
        fetchSubscriptionsAutomatically: false,
        playNextVideo: true,
        defaultInterval: 0
      },
      profiles: [{
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [{
          id: SHORTS_CHANNEL,
          name: 'Shorts Channel',
          thumbnail: ''
        }]
      }],
      subscriptionCache: [{
        _id: SHORTS_CHANNEL,
        shorts: [
          {
            type: 'video',
            videoId: 'w1WKmSqwM8I',
            title: 'First seeded Short',
            author: 'Shorts Channel',
            authorId: SHORTS_CHANNEL,
            published: 2,
            isShort: true,
            lengthSeconds: '',
            thumbnailUrl: FIRST_SHORT_THUMBNAIL
          },
          {
            type: 'video',
            videoId: 'RZ6PG5QATg4',
            title: 'Second seeded Short',
            author: 'Shorts Channel',
            authorId: SHORTS_CHANNEL,
            published: 1,
            isShort: true,
            lengthSeconds: '',
            thumbnailUrl: SECOND_SHORT_THUMBNAIL
          }
        ],
        shortsTimestamp: new Date().toISOString()
      }]
    }
  })

  test('pausing exposes loaded player state to the template', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'no recorded fixtures for this Short')
    await page.locator(sel.searchInput).fill('https://www.youtube.com/shorts/w1WKmSqwM8I')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/w1WKmSqwM8I\?short=true/)

    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    const errorMessage = page.locator('.errorMessage')
    await expect(player.or(errorMessage)).toBeVisible({ timeout: 30_000 })
    if (await errorMessage.isVisible()) {
      test.skip(true, `Shorts watch page unavailable from the live API: ${await errorMessage.textContent()}`)
    }

    const video = await waitForPlaybackOrSkip(test, page)
    await video.evaluate(element => element.pause())
    await expect(player).toHaveClass(/shortsPaused/)
  })

  test('hides Shorts controls on leave and keeps edge controls usable', async ({ page }) => {
    await page.locator(sel.searchInput).fill('https://www.youtube.com/shorts/w1WKmSqwM8I')
    await page.locator(sel.searchInput).press('Enter')

    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    const errorMessage = page.locator('.errorMessage')
    await expect(player.or(errorMessage)).toBeVisible({ timeout: 30_000 })
    if (await errorMessage.isVisible()) {
      test.skip(true, `Shorts watch page unavailable from the live API: ${await errorMessage.textContent()}`)
    }

    const video = player.locator('video')
    await video.evaluate(async element => {
      if (element.paused) await element.play()
    })
    const controls = player.locator('.shaka-controls-container')
    const topControls = player.locator('.shortsTopControls')
    const seekBar = player.locator('.shaka-seek-bar-container')
    const playerBounds = await player.boundingBox()

    await page.mouse.move(
      playerBounds.x + playerBounds.width / 2,
      playerBounds.y + playerBounds.height / 2
    )
    await expect(controls).toHaveAttribute('shown', 'true')
    await expect(topControls).toHaveCSS('opacity', '1')
    await page.mouse.move(0, 0)
    await expect(controls).not.toHaveAttribute('shown', 'true')
    await expect(topControls).toHaveCSS('opacity', '0')
    await expect(topControls).toHaveCSS('transition-duration', '0.6s, 0s')

    const hiddenSeekBarState = await player.evaluate(element => {
      const videoElement = element.querySelector('video')
      const seekInput = element.querySelector('.shaka-seek-bar')
      const seekRange = element.ui.getControls().getPlayer().seekRange()
      const currentTime = seekRange.start + (seekRange.end - seekRange.start) / 2
      seekInput.value = seekRange.start
      videoElement.currentTime = currentTime
      window.dispatchEvent(new Event('blur'))
      videoElement.dispatchEvent(new Event('timeupdate'))
      return { currentTime, seekValue: Number(seekInput.value) }
    })
    expect(hiddenSeekBarState.seekValue).toBeCloseTo(hiddenSeekBarState.currentTime, 3)

    const volumeSlider = player.locator('.shortsVolumeSlider')
    await video.evaluate(element => {
      element.muted = false
      element.volume = 0.37
    })
    await expect(volumeSlider).toHaveValue('37')

    await expect(seekBar).toHaveCSS('opacity', '1')
    await expect(seekBar).toHaveCSS('height', '3px')
    await expect(seekBar).toHaveCSS('bottom', '-2px')
    const seekBounds = await seekBar.boundingBox()
    expect(seekBounds.x).toBeGreaterThan(playerBounds.x)
    expect(seekBounds.x + seekBounds.width).toBeLessThan(playerBounds.x + playerBounds.width)
    expect(seekBounds.y + seekBounds.height)
      .toBeGreaterThan(playerBounds.y + playerBounds.height)

    const contextMenu = player.locator('.shaka-context-menu')
    await player.click({
      button: 'right',
      position: { x: playerBounds.width - 1, y: playerBounds.height - 1 }
    })
    await expect(contextMenu).toBeVisible()
    await expect.poll(async () => {
      const menu = await contextMenu.boundingBox()
      return {
        left: menu.x >= playerBounds.x + 7,
        right: menu.x + menu.width <= playerBounds.x + playerBounds.width - 7,
        top: menu.y >= playerBounds.y + 7,
        bottom: menu.y + menu.height <= playerBounds.y + playerBounds.height - 7,
      }
    }).toEqual({ left: true, right: true, top: true, bottom: true })

    await video.evaluate(element => {
      element.loop = false
      element.dispatchEvent(new Event('ended'))
    })
    const replayIcon = player.locator('.shortsReplayIcon')
    await expect(replayIcon).toBeVisible()
    await expect(replayIcon).toHaveAttribute('viewBox', '0 -960 960 960')
    expect((await replayIcon.locator('path').getAttribute('d')).length).toBeGreaterThan(20)
  })

  test('fullscreen Shorts controls follow the video hover area', async ({ app, page, innertube }) => {
    test.skip(innertube.replay, 'no recorded fixtures for this Short')
    await page.locator(sel.searchInput).fill('https://www.youtube.com/shorts/w1WKmSqwM8I')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/w1WKmSqwM8I\?short=true/)

    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    const errorMessage = page.locator('.errorMessage')
    let playerLoaded = false
    const settled = await expect.poll(async () => {
      playerLoaded = await player.isVisible().catch(() => false)
      return playerLoaded || await errorMessage.isVisible().catch(() => false) ? 'done' : 'waiting'
    }, { timeout: 30_000 }).toBe('done').then(() => true, () => false)
    test.skip(
      !settled || !playerLoaded,
      `Shorts watch page unavailable from the live API: ${(await errorMessage.textContent().catch(() => ''))?.trim() || 'unhydrated'}`
    )

    await waitForPlaybackOrSkip(test, page)
    await setPlayerFullscreen(page, true)

    const controls = player.locator('.shaka-controls-container')
    const topControls = player.locator('.shortsTopControls')
    const actionDock = player.locator('.fullscreenActions')
    const videoSpace = player.locator('.shortsFullscreenVideoSpace')
    const seekBar = player.locator('.shaka-seek-bar-container')
    const [playerBounds, videoBounds] = await Promise.all([
      player.boundingBox(),
      videoSpace.boundingBox(),
    ])
    expect(videoBounds.width).toBeGreaterThan(0)
    expect(videoBounds.x).toBeGreaterThan(playerBounds.x)

    await page.mouse.move(
      videoBounds.x + videoBounds.width / 2,
      videoBounds.y + videoBounds.height / 2
    )
    await expect(controls).toHaveAttribute('shown', 'true')
    await expect(topControls).toHaveCSS('opacity', '1')

    await player.evaluate(element => element.classList.add('no-cursor'))
    await page.mouse.move(playerBounds.x + 8, playerBounds.y + playerBounds.height / 2)
    await expect(player).not.toHaveClass(/no-cursor/)
    await expect(controls).not.toHaveAttribute('shown', 'true')
    await expect(topControls).toHaveCSS('transition-duration', '0.6s, 0s, 0.25s, 0.25s')
    await expect(topControls).toHaveCSS('opacity', '0')
    await expect(actionDock).toHaveCSS('opacity', '1')
    await expect(actionDock).toHaveCSS('pointer-events', 'auto')
    const seekBarBounds = await seekBar.boundingBox()
    expect(Math.abs(seekBarBounds.x - videoBounds.x)).toBeLessThan(2)
    expect(Math.abs(seekBarBounds.width - videoBounds.width)).toBeLessThan(2)

    await page.mouse.move(
      videoBounds.x + videoBounds.width / 2,
      videoBounds.y + videoBounds.height / 2
    )
    await expect(controls).toHaveAttribute('shown', 'true')
    await expect(topControls).toHaveCSS('opacity', '1')

    await setPlayerFullscreen(page, false)
    await setWindowWidth(app, 600)
    await page.keyboard.press('s')
    await expect(player).toHaveClass(/fullWindow/)
    await expect(player).toHaveCSS('width', '600px')
    const [narrowVideoBounds, narrowSeekBarBounds] = await Promise.all([
      videoSpace.boundingBox(),
      seekBar.boundingBox(),
    ])
    expect(Math.abs(narrowSeekBarBounds.x - narrowVideoBounds.x)).toBeLessThan(2)
    expect(Math.abs(narrowSeekBarBounds.width - narrowVideoBounds.width)).toBeLessThan(2)
  })

  test('preserves the tall aspect ratio of an explicit Shorts link', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'Shorts detection needs the real API')

    await page.evaluate(() => {
      window.__shortsSeekBarFlashedWhileLoading = false
      const observer = new MutationObserver(() => {
        if (document.querySelector('.ftVideoPlayer.shortsPlayer.shortsPaused')) {
          window.__shortsSeekBarFlashedWhileLoading = true
        }
      })
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ['class'],
        childList: true,
        subtree: true
      })
    })

    await page.locator(sel.searchInput).fill('https://www.youtube.com/shorts/w1WKmSqwM8I')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/w1WKmSqwM8I\?short=true/)

    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    const errorMessage = page.locator('.errorMessage')
    await expect(player.or(errorMessage)).toBeVisible({ timeout: 30_000 })

    if (await errorMessage.isVisible()) {
      test.skip(true, `Shorts watch page unavailable from the live API: ${await errorMessage.textContent()}`)
    }

    await expect(page.locator('.videoLayout')).toHaveClass(/shortsPlayerActive/)
    await expect(page.locator('.shortsExternalMetadata .shortsExternalTitle')).toBeVisible()
    await expect(page.locator('.shortsTopControls')).toBeVisible()
    await expect(page.locator('.shortsActionRail')).toBeVisible()
    await expect(page.locator('.shortsNavigation')).toBeVisible()
    await expect(page.locator('.infoArea')).toBeHidden()
    const video = player.locator('video')
    await expect(video).toHaveAttribute('loop', '')
    await expect(video).toHaveAttribute('poster', FIRST_SHORT_THUMBNAIL)
    await expect(video).toHaveCSS('object-fit', 'cover')
    await expect(player.locator('.shortsTopControl').first()).toHaveCSS(
      'backdrop-filter',
      /blur\(8px\)/
    )
    expect(await player.evaluate(element => {
      return element.ui.getConfiguration().doubleClickForFullscreen
    })).toBe(false)
    expect(await page.evaluate(() => window.__shortsSeekBarFlashedWhileLoading)).toBe(false)

    const seekBar = player.locator('.shaka-seek-bar-container')
    await video.evaluate(async element => {
      if (element.paused) await element.play()
    })
    await expect(player).not.toHaveClass(/shortsPaused/)
    await expect(seekBar).toHaveCSS('opacity', '1')
    await expect(seekBar).toHaveCSS('height', '3px')
    await expect(seekBar).toHaveCSS('bottom', '-2px')

    const [playerBounds, seekBarBounds] = await Promise.all([
      player.boundingBox(),
      seekBar.boundingBox(),
    ])
    expect(seekBarBounds.x).toBeGreaterThan(playerBounds.x)
    expect(seekBarBounds.x + seekBarBounds.width).toBeLessThan(playerBounds.x + playerBounds.width)
    expect(seekBarBounds.y + seekBarBounds.height)
      .toBeGreaterThan(playerBounds.y + playerBounds.height)

    const shakaControls = player.locator('.shaka-controls-container')
    const topControls = player.locator('.shortsTopControls')
    await page.mouse.move(
      playerBounds.x + playerBounds.width / 2,
      playerBounds.y + playerBounds.height / 2
    )
    await expect(shakaControls).toHaveAttribute('shown', 'true')
    await expect(topControls).toHaveCSS('opacity', '1')
    await expect(topControls).toHaveCSS('border-top-left-radius', /.+/)
    await page.mouse.move(0, 0)
    await expect(shakaControls).not.toHaveAttribute('shown', 'true')
    await expect(topControls).toHaveCSS('transition-duration', '0.6s, 0s')
    await expect(topControls).toHaveCSS('opacity', '0')

    await page.mouse.move(
      playerBounds.x + playerBounds.width / 2,
      playerBounds.y + playerBounds.height - 2
    )
    await expect(seekBar).toHaveCSS('opacity', '1')
    await page.mouse.move(
      playerBounds.x + playerBounds.width / 2,
      playerBounds.y + playerBounds.height / 2
    )
    await player.locator('.shortsTopControl').first().click()
    // Production regression: this class depends on hasLoaded being available
    // to the template after pausing, where Vue runtime warnings are stripped.
    await expect(player).toHaveClass(/shortsPaused/)
    await expect(seekBar).toHaveCSS('opacity', '1')

    const contextMenu = player.locator('.shaka-context-menu')
    await player.click({
      button: 'right',
      position: { x: playerBounds.width - 1, y: playerBounds.height - 1 }
    })
    await expect(contextMenu).toBeVisible()
    await expect.poll(async () => {
      const [container, menu] = await Promise.all([
        player.boundingBox(),
        contextMenu.boundingBox(),
      ])
      return {
        left: menu.x >= container.x + 7,
        right: menu.x + menu.width <= container.x + container.width - 7,
        top: menu.y >= container.y + 7,
        bottom: menu.y + menu.height <= container.y + container.height - 7,
      }
    }).toEqual({ left: true, right: true, top: true, bottom: true })
    await page.keyboard.press('Escape')

    const volumeControl = player.locator('.shortsVolumeControl')
    await expect(contextMenu).toBeHidden()
    await volumeControl.hover()
    await expect(volumeControl.locator('.shortsVolumeSlider')).toBeVisible()

    const moreOptions = player.getByRole('button', { name: 'More Options' })
    const overflowMenu = player.locator('.shaka-overflow-menu')
    await moreOptions.click()
    await expect(overflowMenu).toBeVisible()
    const [playerBox, menuBox] = await Promise.all([
      player.boundingBox(),
      overflowMenu.boundingBox(),
    ])
    expect(menuBox.y).toBeLessThan(playerBox.y + playerBox.height / 2)
    expect(menuBox.x).toBeGreaterThanOrEqual(playerBox.x)
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(playerBox.x + playerBox.width)

    const fullWindowMenuButton = overflowMenu.getByRole('button', {
      name: /Full window/i
    })
    await fullWindowMenuButton.click()
    await expect(player).toHaveClass(/fullWindow/)

    await moreOptions.click()
    const exitFullWindowMenuButton = overflowMenu.getByRole('button', {
      name: /Exit full window/i
    })
    await expect(exitFullWindowMenuButton).toBeVisible()
    await exitFullWindowMenuButton.click()
    await expect(player).not.toHaveClass(/fullWindow/)

    await moreOptions.dblclick()
    expect(await page.evaluate(() => document.fullscreenElement === null)).toBe(true)

    await moreOptions.click()
    const videoInfoMenuButton = overflowMenu.getByRole('button', {
      name: 'Video information'
    })
    await expect(videoInfoMenuButton).toBeVisible()
    await videoInfoMenuButton.evaluate(element => element.click())
    await expect(page.locator('.shortsAuxPanel')).toHaveClass(/shortsAuxPanelOpen/)
    await page.getByRole('button', { name: 'Close video information' }).evaluate(element => element.click())
    await expect(page.locator('.shortsAuxPanel')).not.toHaveClass(/shortsAuxPanelOpen/)

    await expect(page).toHaveURL(/#\/watch\/w1WKmSqwM8I\?short=true/)
    for (const label of ['Share Video', 'Add to Playlist']) {
      const action = page.locator('.shortsComponentAction').filter({ hasText: label })
      const actionButton = action.getByRole('button', { name: label })
      const idleBackground = await actionButton.evaluate(element => {
        return getComputedStyle(element).backgroundColor
      })

      await actionButton.evaluate(element => element.click())
      await expect(actionButton).toHaveAttribute('aria-expanded', 'true')
      await expect.poll(() => actionButton.evaluate(element => {
        return getComputedStyle(element).backgroundColor
      })).not.toBe(idleBackground)
      await actionButton.evaluate(element => element.click())
    }

    await expect(page).toHaveURL(/#\/watch\/w1WKmSqwM8I\?short=true/)
    const commentsButton = page.locator('.shortsCommentsAction').getByRole('button')
    await commentsButton.evaluate(element => element.click())
    await expect(commentsButton).toHaveAttribute('aria-pressed', 'true')
    await expect(commentsButton).toHaveAccessibleName('Hide Comments')
    await expect(page.locator('.shortsCommentsPanel')).toHaveClass(/shortsCommentsPanelOpen/)
    await commentsButton.evaluate(element => element.click())
    await expect(commentsButton).toHaveAttribute('aria-pressed', 'false')

    await expect(page).toHaveURL(/#\/watch\/w1WKmSqwM8I\?short=true/)
    const quickBookmark = page.locator('.shortsQuickBookmark')
    if (await quickBookmark.count()) {
      await quickBookmark.locator('.iconButton').evaluate(element => element.click())
      await expect(quickBookmark).toHaveClass(/shortsQuickBookmarked/)
    }

    const bounds = await player.boundingBox()
    expect(bounds.height).toBeGreaterThan(bounds.width)
  })

  test('keeps captions fixed when hover controls appear', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'Shorts detection needs the real API')

    await page.locator(sel.searchInput).fill('https://www.youtube.com/shorts/w1WKmSqwM8I')
    await page.locator(sel.searchInput).press('Enter')

    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    const errorMessage = page.locator('.errorMessage')
    await expect(player.or(errorMessage)).toBeVisible({ timeout: 30_000 })

    if (await errorMessage.isVisible()) {
      test.skip(true, `Shorts watch page unavailable from the live API: ${await errorMessage.textContent()}`)
    }

    await player.locator('video').evaluate(async element => {
      if (element.paused) await element.play()
    })
    await expect(player).not.toHaveClass(/shortsPaused/)

    const controls = player.locator('.shaka-controls-container')
    await player.evaluate(element => {
      if (element.querySelector('.shaka-text-container')) return

      const captions = document.createElement('div')
      captions.className = 'shaka-text-container'
      element.querySelector('.shaka-controls-container').after(captions)
    })
    const captions = player.locator('.shaka-text-container')
    await page.mouse.move(0, 0)
    await expect(controls).not.toHaveAttribute('shown', 'true')
    const captionsBottomWithoutHover = await captions.evaluate(element => {
      return getComputedStyle(element).bottom
    })
    expect(Number.parseFloat(captionsBottomWithoutHover)).toBeGreaterThan(0)

    const playerBounds = await player.boundingBox()
    await page.mouse.move(
      playerBounds.x + playerBounds.width / 2,
      playerBounds.y + playerBounds.height - 2
    )
    await expect(controls).toHaveAttribute('shown', 'true')
    await expect(captions).toHaveCSS('bottom', captionsBottomWithoutHover)
  })

  test('only exposes applicable controls and stays in the Shorts player', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'Shorts detection needs the real API')

    await page.locator(sel.searchInput).fill('https://www.youtube.com/shorts/w1WKmSqwM8I')
    await page.locator(sel.searchInput).press('Enter')

    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    const errorMessage = page.locator('.errorMessage')
    await expect(player.or(errorMessage)).toBeVisible({ timeout: 30_000 })

    if (await errorMessage.isVisible()) {
      test.skip(true, `Shorts watch page unavailable from the live API: ${await errorMessage.textContent()}`)
    }

    const playingVideo = await waitForPlaybackOrSkip(test, page)
    await playingVideo.evaluate(element => element.pause())
    const captionTrackCount = await player.evaluate(element => {
      return element.ui.getControls().getPlayer().getTextTracks().length
    })
    await expect(player.locator('.shortsCaptionsControl')).toHaveCount(captionTrackCount > 0 ? 1 : 0)

    const overflowMenu = player.locator('.shaka-overflow-menu')
    const menuButton = player.getByRole('button', { name: 'More Options' })
    const menuBounds = await menuButton.boundingBox()
    await page.mouse.move(menuBounds.x + menuBounds.width / 2, menuBounds.y + menuBounds.height / 2)
    await menuButton.evaluate(button => button.click())
    await expect(overflowMenu).toBeVisible()
    await expect(overflowMenu.getByRole('button', { name: /Autoplay/ })).toHaveCount(0)

    const video = player.locator('video')
    await expect.poll(() => video.evaluate(element => element.duration))
      .toBeGreaterThan(0)
    const duration = await video.evaluate(element => element.duration)
    await video.evaluate(async (element, scrubbedTo) => {
      element.pause()
      element.currentTime = scrubbedTo
      if (element.seeking) {
        await new Promise(resolve => element.addEventListener('seeked', resolve, { once: true }))
      }
    }, duration - 0.25)

    // Scrubbing to the end must not count as completing the Short.
    await expect.poll(() => page.evaluate((expectedDuration) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const entry = store.getters.getHistoryCacheById.w1WKmSqwM8I
      return {
        nearEnd: document.querySelector('.ftVideoPlayer.shortsPlayer video').currentTime >= expectedDuration - 0.5,
        full: entry?.watchProgress === entry?.lengthSeconds
      }
    }, duration)).toEqual({ nearEnd: true, full: false })

    await video.evaluate(async (element, playbackStart) => {
      element.currentTime = playbackStart
      if (element.seeking) {
        await new Promise(resolve => element.addEventListener('seeked', resolve, { once: true }))
      }
      await element.play()
    }, duration - 2)

    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const entry = store.getters.getHistoryCacheById.w1WKmSqwM8I
      return {
        watched: entry?.isWatched,
        fullProgress: entry?.watchProgress === entry?.lengthSeconds
      }
    })).toEqual({ watched: true, fullProgress: true })

    // Ticks from the next automatic loop must not replace completed progress
    // with a resume point near the beginning.
    await video.evaluate(element => {
      element.currentTime = 0.2
      element.dispatchEvent(new Event('timeupdate'))
      element.dispatchEvent(new Event('pause'))
    })
    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const entry = store.getters.getHistoryCacheById.w1WKmSqwM8I
      return entry.watchProgress === entry.lengthSeconds
    })).toBe(true)

    await video.evaluate(element => {
      element.loop = false
      element.dispatchEvent(new Event('ended'))
    })
    const replayIcon = player.locator('.shortsReplayIcon')
    await expect(replayIcon).toBeVisible()
    await expect(replayIcon).toHaveAttribute('viewBox', '0 -960 960 960')
    expect((await replayIcon.locator('path').getAttribute('d')).length).toBeGreaterThan(20)
    await page.waitForTimeout(500)

    await expect(page).toHaveURL(/#\/watch\/[^?]+\?[^#]*\bshort=true\b/)
    await expect(page.locator('.autoplayCountdownOverlay')).toHaveCount(0)
  })
})
