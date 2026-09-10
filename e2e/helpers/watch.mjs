import crypto from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'

import { abortUnmockedRequest, repoRoot } from './app.mjs'
import { fixtureKey, SHARED_PLAYER_SCRIPT } from './innertube.mjs'
import { demoPlayerResponse, routeDemoMedia, routeIframeApi, routeWatchPageHtml, stubPoToken } from './media.mjs'

const watchFixtures = path.join(repoRoot, 'e2e', 'fixtures', 'innertube', 'watch')
const sharedDir = path.join(repoRoot, 'e2e', 'fixtures', 'innertube', 'shared')

// Recordings are keyed per test title, so the responses one mocked watch page
// needs are spread over several directories: the page itself in one, the
// comment pages in the others. The keys are content hashes, so pooling them is
// safe - a key only ever matches the request it was recorded for.
const fixtureDirs = [
  path.join(watchFixtures, 'shows-video-metadata'),
  path.join(watchFixtures, 'comments-load-on-request'),
  path.join(watchFixtures, 'edited-comments-carry-the-edited-badge')
]

/** The history entry the fixtures below belong to. */
export const watchHistoryEntry = {
  _id: 'jNQXAC9IVRw',
  videoId: 'jNQXAC9IVRw',
  title: 'Player error test video',
  author: 'Test Channel',
  authorId: 'UC-test-channel-id',
  published: Date.now() - 86_400_000,
  description: '',
  viewCount: 1234,
  lengthSeconds: 600,
  watchProgress: 10,
  isWatched: false,
  timeWatched: Date.now(),
  isLive: false,
  type: 'video'
}

async function fixture(dir, name) {
  try {
    return gunzipSync(await readFile(path.join(dir, name)))
  } catch {
    return null
  }
}

function mutateFirstObject(body, mutate, errorMessage) {
  const response = JSON.parse(body)
  const pending = [response]
  let nextIndex = 0

  while (nextIndex < pending.length) {
    const value = pending[nextIndex++]
    if (!value || typeof value !== 'object') continue

    if (mutate(value)) {
      return Buffer.from(JSON.stringify(response))
    }

    pending.push(...Object.values(value))
  }

  throw new Error(errorMessage)
}

function addOwnerReplyMarker(body) {
  return mutateFirstObject(body, value => {
    const replies = value.commentThreadRenderer?.replies?.commentRepliesRenderer
    if (!replies) return false

    replies.viewRepliesCreatorThumbnail = {
      thumbnails: [{ url: 'https://images.test/channel-owner.png' }]
    }
    return true
  }, 'Unable to add an owner-reply marker to the comment fixture')
}

function markFirstReplyAsCreator(body) {
  return mutateFirstObject(body, value => {
    const payload = value.commentEntityPayload
    if (payload?.properties?.replyLevel > 0 && payload.author) {
      payload.author.isCreator = true
      return true
    }

    return false
  }, 'Unable to mark a reply as the video creator in the comment fixture')
}

function addCommentTimestamp(body) {
  return mutateFirstObject(body, value => {
    const payload = value.commentEntityPayload
    if (payload?.properties?.replyLevel === 0 && payload.properties.content?.content) {
      payload.properties.content.content += ' Start at 0:05.'
      return true
    }

    return false
  }, 'Unable to add a timestamp to the comment fixture')
}

function blankCommentLikeCount(body) {
  return mutateFirstObject(body, value => {
    const payload = value.commentEntityPayload
    if (payload?.properties?.content?.content === "We're so honored that the first ever YouTube video was filmed here!") {
      payload.toolbar.likeCountNotliked = ' '
      payload.toolbar.likeCountA11y = '0 likes'
      return true
    }

    return false
  }, 'Unable to blank the comment like count in the fixture')
}

/**
 * Serves the watch page for `jNQXAC9IVRw` from the committed Innertube
 * fixtures, without any network access.
 *
 * The recorded player responses are unusable (expired stream URLs, and CI
 * recordings are usually bot checks), so the player response is synthesized:
 * either playable — backed by the local demo video, see media.mjs — or
 * explicitly unplayable, which mounts the Watch view without a real player
 * emitting errors of its own.
 *
 * @param {import('./app.mjs').ElectronAppFixture} app
 * @param {import('@playwright/test').Page} page
 * @param {object} [options]
 * @param {boolean} [options.playable] serve the demo video instead of an error
 * @param {boolean} [options.captionTranslations] include a translatable caption and target languages
 * @param {string} [options.captionCueSettings] append WebVTT settings to the test caption cue
 * @param {string[]|null} [options.captionVideoIds] limit captions to these video IDs
 * @param {boolean} [options.ownerReply] mark the first reply thread as containing a video-owner reply
 * @param {boolean} [options.creatorReply] mark the first loaded reply as written by the video creator
 * @param {boolean} [options.commentTimestamp] add a timestamp to one top-level comment
 * @param {boolean} [options.blankCommentLikes] replace one comment's zero-like count with YouTube's whitespace representation
 */
export async function mockWatchPage(app, page, {
  playable = false,
  captionTranslations = false,
  captionCueSettings = '',
  captionVideoIds = null,
  ownerReply = false,
  creatorReply = false,
  commentTimestamp = false,
  blankCommentLikes = false
} = {}) {
  const counters = new Map()
  const includeCaptions = captionTranslations || captionCueSettings !== '' || captionVideoIds !== null

  await stubPoToken(app.electronApp)

  await page.route(/^https?:\/\//, abortUnmockedRequest)
  // A missing optional label is an HTTP 404, not a lost connection. Aborting
  // it would leave other SponsorBlock requests waiting for network recovery.
  await page.route('**/api/videoLabels/**', route => route.fulfill({ status: 404, body: '' }))
  await routeIframeApi(page)
  await routeWatchPageHtml(page)

  if (playable) {
    await routeDemoMedia(page)
  }

  if (includeCaptions) {
    await page.route('https://www.youtube.com/api/timedtext**', (route) => {
      const searchParams = new URL(route.request().url()).searchParams
      const format = searchParams.get('fmt')
      const body = format === 'srt'
        ? '1\n00:00:00,000 --> 00:00:05,000\nTranslated caption\n'
        : `WEBVTT\n\n00:00:00.000 --> 00:01:00.000 ${captionCueSettings}\nOriginal caption\n`
      const fulfill = () => route.fulfill({
        status: 200,
        contentType: format === 'srt' ? 'application/x-subrip' : 'text/vtt',
        body
      })
      return format === 'srt' && searchParams.get('tlang') === 'fr'
        ? new Promise(resolve => setTimeout(resolve, 250)).then(fulfill)
        : fulfill()
    })
  }

  await page.route(/^https?:\/\//, async (route, request) => {
    const url = request.url()

    if (url.includes('/img/desktop/unavailable/')) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: '' })
    }

    if (/\/s\/player\//.test(url) || /\/sw\.js_data/.test(url)) {
      const { pathname } = new URL(url)
      const name = `shared-${crypto.createHash('sha1').update(pathname).digest('hex').slice(0, 12)}.gz`
      const body = await fixture(sharedDir, name) ??
        (url.includes('/s/player/') ? await fixture(sharedDir, `${SHARED_PLAYER_SCRIPT}.gz`) : null)
      if (body) {
        return route.fulfill({
          status: 200,
          contentType: url.includes('/s/player/') ? 'text/javascript' : 'application/json',
          body
        })
      }
      return route.abort()
    }

    if (url.includes('/youtubei/v1/player')) {
      const videoId = JSON.parse(request.postData() ?? '{}').videoId ?? 'jNQXAC9IVRw'
      const json = demoPlayerResponse(videoId)

      if (includeCaptions && (captionVideoIds === null || captionVideoIds.includes(videoId))) {
        const displayNames = new Intl.DisplayNames(['en'], { type: 'language' })
        const languageCodes = [
          'af', 'sq', 'am', 'ar', 'hy', 'as', 'ay', 'az', 'eu', 'be',
          'bn', 'bs', 'bg', 'my', 'ca', 'ceb', 'zh', 'co', 'hr', 'cs',
          'da', 'nl', 'dz', 'en', 'eo', 'et', 'ee', 'fo', 'fj', 'fil',
          'fi', 'fr', 'de'
        ]
        json.captions = {
          playerCaptionsTracklistRenderer: {
            captionTracks: [{
              baseUrl: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en`,
              name: { simpleText: captionTranslations ? 'English (auto-generated)' : 'English' },
              vssId: captionTranslations ? 'a.en' : '.en',
              languageCode: 'en',
              ...(captionTranslations ? { kind: 'asr' } : {}),
              isTranslatable: true
            }],
            translationLanguages: captionTranslations
              ? languageCodes.map(languageCode => ({
                  languageCode,
                  languageName: { simpleText: displayNames.of(languageCode) ?? languageCode }
                }))
              : []
          }
        }
      }

      if (!playable) {
        json.playabilityStatus = { status: 'UNPLAYABLE', reason: 'Video unavailable' }
        delete json.streamingData
      }

      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) })
    }

    if (url.includes('/youtubei/v1/')) {
      const key = fixtureKey(url, request.postData())
      // Repeated identical requests (comment continuations) are served in the
      // order they were recorded.
      const index = counters.get(key) ?? 0
      counters.set(key, index + 1)

      let body = null
      for (const dir of fixtureDirs) {
        body = await fixture(dir, `${key}.${index}.json.gz`) ?? await fixture(dir, `${key}.0.json.gz`)
        if (body) break
      }

      if (!body) {
        const endpoint = key.replace(/-[0-9a-f]{12}$/, '')
        for (const dir of fixtureDirs) {
          const files = (await readdir(dir).catch(() => []))
            .filter((file) => file.startsWith(`${endpoint}-`))
          if (files.length > 0) {
            body = await fixture(dir, files[0])
            if (body) break
          }
        }
      }

      if (body) {
        if (ownerReply && body.includes('"replyLevel":0')) {
          body = addOwnerReplyMarker(body)
        }
        if (creatorReply && body.includes('"replyLevel":1')) {
          body = markFirstReplyAsCreator(body)
        }
        if (commentTimestamp && body.includes('commentEntityPayload')) {
          body = addCommentTimestamp(body)
        }
        if (blankCommentLikes && body.includes("We're so honored")) {
          body = blankCommentLikeCount(body)
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body })
      }
      console.warn(`[e2e] Missing watch page fixture: ${key}`)
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
    }

    return route.fallback()
  })
}

/** @see mockWatchPage */
export function mockUnplayableWatchPage(app, page) {
  return mockWatchPage(app, page, { playable: false })
}

/** @see mockWatchPage */
export function mockPlayableWatchPage(app, page, options = {}) {
  return mockWatchPage(app, page, { ...options, playable: true })
}

/**
 * Returns a handle to a mounted Watch view, so tests can drive its methods
 * directly instead of going through a real player. A tab ID selects the Watch
 * view when multiple logical tabs are mounted.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string|null} [tabId]
 */
export function watchViewHandle(page, tabId = null) {
  return page.evaluateHandle((targetTabId) => {
    const app = document.querySelector('#app')?.__vue_app__
    const find = (vnode) => {
      if (
        vnode?.component?.type?.name === 'Watch' &&
        (targetTabId === null || vnode.component.proxy?.tabId === targetTabId)
      ) {
        return vnode.component.proxy
      }
      if (vnode?.component?.subTree) {
        const match = find(vnode.component.subTree)
        if (match) return match
      }
      if (Array.isArray(vnode?.children)) {
        for (const child of vnode.children) {
          const match = find(child)
          if (match) return match
        }
      }
      return null
    }

    const watchView = find(app?._container?._vnode)
    if (!watchView) {
      throw new Error('Unable to access the watch view')
    }
    return watchView
  }, tabId)
}
