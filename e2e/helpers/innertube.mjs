import crypto from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync, gunzipSync } from 'node:zlib'

import { abortUnmockedRequest, test as baseAppTest, expect, setPlayerFullscreen } from './app.mjs'
import { demoPlayerResponse, routeDemoMedia, routeIframeApi, routeWatchPageHtml, stubPoToken } from './media.mjs'

const fixturesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'innertube')
// A 1x1 PNG used for channel avatars while external requests are blocked.
const AVATAR_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

// Request body fields that change between runs (session data, tokens,
// timestamps) and must not influence the fixture key.
const VOLATILE_BODY_KEYS = new Set([
  'context',
  'playbackContext',
  'serviceIntegrityDimensions',
  'attestationRequest',
  'botguardResponse'
])

/** The recorded player script, used whenever its id doesn't match. */
export const SHARED_PLAYER_SCRIPT = 'shared-99c4a5c04897'

// Non-Innertube resources youtubei.js needs to bootstrap a session and
// decipher stream URLs. Shared between tests, keyed by URL path.
const SHARED_RESOURCE_PATTERNS = [
  /\/s\/player\//,
  /\/sw\.js_data/
]

/**
 * Innertube `params` values are base64 protobufs that can contain a few
 * session-variable bytes (e.g. the channel tab probes). Reduce them to
 * their printable content (the stable discriminator, like "shorts") so
 * recorded and replayed requests produce the same fixture key.
 */
function normalizeParams(value) {
  if (typeof value !== 'string') {
    return value
  }
  try {
    const decoded = Buffer.from(decodeURIComponent(value), 'base64')
    const printable = decoded.toString('latin1').match(/[\x20-\x7e]{3,}/g)
    return printable ? printable.join('.') : value
  } catch {
    return value
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * Derives a stable fixture key from an Innertube request.
 * e.g. POST https://www.youtube.com/youtubei/v1/search -> "search-<hash>"
 */
export function fixtureKey(url, postData) {
  const endpoint = new URL(url).pathname.replace(/^.*\/youtubei\/v1\//, '').replaceAll('/', '_')

  let body = {}
  if (postData) {
    try {
      body = JSON.parse(postData)
    } catch {
      body = { raw: postData }
    }
  }
  const normalized = Object.fromEntries(
    Object.entries(body)
      .filter(([key]) => !VOLATILE_BODY_KEYS.has(key))
      .map(([key, value]) => [key, key === 'params' ? normalizeParams(value) : value])
  )
  const hash = crypto.createHash('sha1').update(stableStringify(normalized)).digest('hex').slice(0, 12)
  return `${endpoint}-${hash}`
}

function sharedResourceKey(url) {
  const { pathname } = new URL(url)
  const hash = crypto.createHash('sha1').update(pathname).digest('hex').slice(0, 12)
  return `shared-${hash}`
}

function isSharedResource(url) {
  return SHARED_RESOURCE_PATTERNS.some((pattern) => pattern.test(url))
}

function slugify(text) {
  return text.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '').slice(0, 80)
}

function fixtureDirFor(testInfo) {
  return path.join(fixturesRoot, slugify(path.basename(testInfo.file, '.spec.mjs')), slugify(testInfo.title))
}

async function readFixture(dir, name) {
  try {
    return gunzipSync(await readFile(path.join(dir, `${name}.gz`)))
  } catch {
    return null
  }
}

async function writeFixture(dir, name, body) {
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, `${name}.gz`), gzipSync(body))
}

/**
 * Sets up Innertube record/replay on the given page.
 *
 * Modes:
 * - passthrough (default): requests hit the real YouTube servers untouched.
 * - record (E2E_RECORD=1): real network, responses are saved as fixtures.
 * - replay (E2E_USE_FIXTURES=1, or automatically on Playwright retry):
 *   Innertube requests are answered from fixtures and all other external
 *   network is blocked, so the run is deterministic. Media streams are not
 *   recorded; instead the player response is replaced with one that points
 *   at the local demo video, so playback still works (see media.mjs).
 */
export async function setupInnertube(app, testInfo) {
  const page = app.page
  const record = !!process.env.E2E_RECORD
  const replay = !record && (!!process.env.E2E_USE_FIXTURES || testInfo.retry > 0)
  const fixtureDir = fixtureDirFor(testInfo)
  const sharedDir = path.join(fixturesRoot, 'shared')
  // Serves repeated identical requests (e.g. continuations) in recorded order.
  const counters = new Map()

  if (replay) {
    // Registered first = lowest priority: blocks all external requests
    // that the more specific routes below don't handle.
    await page.route(/^https?:\/\//, abortUnmockedRequest)

    // BotGuard can't run without YouTube's attestation servers, and the video
    // load aborts when the poToken is missing.
    await stubPoToken(app.electronApp)
    await routeIframeApi(page)
    await routeWatchPageHtml(page)
    await routeDemoMedia(page)
    await page.route(/^https:\/\/yt3\.(?:ggpht|googleusercontent)\.com\//, route => route.fulfill({
      contentType: 'image/png',
      body: AVATAR_PNG
    }))

    await page.route(/^https?:\/\//, async (route, request) => {
      const url = request.url()

      // The recorded player responses are useless on replay: their stream
      // URLs expire, and CI recordings are often bot checks to begin with.
      // The demo video keeps the watch page playable instead.
      if (url.includes('/youtubei/v1/player')) {
        const videoId = JSON.parse(request.postData() ?? '{}').videoId ?? 'e2e-demo'
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(demoPlayerResponse(videoId))
        })
      }

      if (isSharedResource(url)) {
        // The player script was recorded under the real player id, but
        // routeIframeApi pins it to a fixed one - fall back to the recorded
        // script, there is only ever one per recording.
        const body = await readFixture(sharedDir, sharedResourceKey(url)) ??
          (url.includes('/s/player/') ? await readFixture(sharedDir, SHARED_PLAYER_SCRIPT) : null)
        if (body) {
          const contentType = url.includes('/s/player/') ? 'text/javascript' : 'application/json'
          return route.fulfill({ status: 200, contentType, body })
        }
        return route.abort()
      }

      if (url.includes('/youtubei/v1/')) {
        const key = fixtureKey(url, request.postData())
        const index = counters.get(key) ?? 0
        counters.set(key, index + 1)

        for (const candidate of [`${key}.${index}.json`, `${key}.0.json`]) {
          const body = await readFixture(fixtureDir, candidate)
          if (body) {
            return route.fulfill({ status: 200, contentType: 'application/json', body })
          }
        }
        console.warn(`[e2e] Missing Innertube fixture: ${key} (${fixtureDir})`)
        return route.abort()
      }

      return route.fallback()
    })
  } else if (record) {
    await page.route(/^https?:\/\//, async (route, request) => {
      const url = request.url()
      // Player responses are never replayed (replay serves the demo video
      // instead), so there is no point in recording their expiring stream
      // URLs - or the bot checks CI runners usually get back.
      const recordable = (isSharedResource(url) || url.includes('/youtubei/v1/')) &&
        !url.includes('/youtubei/v1/player')
      if (!recordable) {
        return route.fallback()
      }

      // Recording must never fail the test itself: late background
      // requests can race test teardown, so tolerate disposed contexts.
      let response
      try {
        response = await route.fetch()
      } catch {
        return route.abort().catch(() => {})
      }
      let body = null
      if (response.ok()) {
        body = await response.body().catch(() => null)
      }
      await route.fulfill({ response }).catch(() => {})

      if (body) {
        if (isSharedResource(url)) {
          await writeFixture(sharedDir, sharedResourceKey(url), body)
        } else {
          const key = fixtureKey(url, request.postData())
          const index = counters.get(key) ?? 0
          counters.set(key, index + 1)
          await writeFixture(fixtureDir, `${key}.${index}.json`, body)
        }
      }
    })
  }

  // Playback works in every mode: live tests stream from YouTube, replay
  // plays the local demo video.
  return { record, replay }
}

/**
 * App test extended with an `innertube` fixture. Reference it in network
 * tests to get record/replay behaviour, and gate assertions that need data
 * only the live API has (or that has no fixtures) on `innertube.replay`.
 */
export const test = baseAppTest.extend({
  innertube: [async ({ app }, use, testInfo) => {
    const mode = await setupInnertube(app, testInfo)
    await use(mode)
  }, { auto: true }]
})

export { expect, setPlayerFullscreen }
