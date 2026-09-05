import { statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { repoRoot } from './app.mjs'

/**
 * A tiny, offline demo video (VP9 + Opus, 640x360, 30s) that stands in for
 * YouTube's media streams. It burns a timecode into the picture, so failure
 * screenshots show at a glance whether (and how far) playback progressed.
 */
export const DEMO_MEDIA_PATH = path.join(repoRoot, 'e2e', 'fixtures', 'media', 'demo.webm')
export const DEMO_MEDIA_MIME_TYPE = 'video/webm; codecs="vp9, opus"'
export const DEMO_MEDIA_DURATION_SECONDS = 30
/** Real streams always declare their size, and players rely on it. */
export const DEMO_MEDIA_LENGTH = statSync(DEMO_MEDIA_PATH).size

const POST_LIVE_VIDEO_PATH = path.join(repoRoot, 'e2e', 'fixtures', 'media', 'post-live-video.mp4.b64')
const POST_LIVE_AUDIO_PATH = path.join(repoRoot, 'e2e', 'fixtures', 'media', 'post-live-audio.m4a.b64')
export const POST_LIVE_VIDEO_URL = 'https://post-live-video.test/videoplayback?expire=4102444800'
export const POST_LIVE_AUDIO_URL = 'https://post-live-audio.test/videoplayback?expire=4102444800'

/**
 * Looks like a real progressive stream URL, so the app treats it the same way
 * and the route below can recognize it.
 */
export const DEMO_MEDIA_URL =
  'https://rr1---sn-opentubex-e2e.googlevideo.com/videoplayback?id=opentubex-e2e-demo&itag=43&mime=video%2Fwebm'

let demoMedia
let postLiveVideo
let postLiveAudio

function readDemoMedia() {
  demoMedia ??= readFile(DEMO_MEDIA_PATH)
  return demoMedia
}

function readPostLiveMedia(file) {
  return readFile(file, 'utf8').then(base64 => Buffer.from(base64.replaceAll('\n', ''), 'base64'))
}

/**
 * Serves one self-contained audio and video fragment for a mocked yt-dlp
 * Post-Live-DVR response. YouTube uses the same self-initializing fragmented
 * MP4 shape for every `sq` URL in these streams.
 * @param {import('@playwright/test').Page} page
 */
export async function routePostLiveMedia(page) {
  await page.route(/^https:\/\/post-live-(?:audio|video)\.test\/videoplayback/, async route => {
    const isVideo = route.request().url().startsWith('https://post-live-video.test/')
    const body = isVideo
      ? (postLiveVideo ??= readPostLiveMedia(POST_LIVE_VIDEO_PATH))
      : (postLiveAudio ??= readPostLiveMedia(POST_LIVE_AUDIO_PATH))

    return route.fulfill({
      status: 200,
      contentType: isVideo ? 'video/mp4' : 'audio/mp4',
      body: await body
    })
  })
}

/**
 * Builds a player response that YouTube would return for a playable video,
 * with a single progressive format pointing at the demo media. Without
 * adaptive formats the app falls back to its legacy (progressive) player
 * path, which needs neither a DASH manifest nor SABR.
 *
 * The metadata here is only a fallback: the accompanying `/next` response
 * (recorded fixtures) provides the title, channel and description the watch
 * page actually renders.
 *
 * @param {string} videoId
 * @param {object} [overrides] extra top-level fields, e.g. `playabilityStatus`
 */
export function demoPlayerResponse(videoId, overrides = {}) {
  const lengthSeconds = String(DEMO_MEDIA_DURATION_SECONDS)

  return {
    responseContext: {},
    playabilityStatus: {
      status: 'OK',
      playableInEmbed: true,
      miniplayer: { miniplayerRenderer: { playbackMode: 'PLAYBACK_MODE_ALLOW' } }
    },
    streamingData: {
      expiresInSeconds: '21540',
      formats: [{
        itag: 43,
        url: DEMO_MEDIA_URL,
        mimeType: DEMO_MEDIA_MIME_TYPE,
        bitrate: 200_000,
        width: 640,
        height: 360,
        lastModified: '1700000000000000',
        contentLength: String(DEMO_MEDIA_LENGTH),
        quality: 'medium',
        fps: 15,
        qualityLabel: '360p',
        projectionType: 'RECTANGULAR',
        audioQuality: 'AUDIO_QUALITY_LOW',
        approxDurationMs: String(DEMO_MEDIA_DURATION_SECONDS * 1000),
        audioSampleRate: '48000',
        audioChannels: 2
      }],
      // Deliberately empty: the app then uses the progressive format above.
      adaptiveFormats: []
    },
    playerConfig: { audioConfig: { loudnessDb: 0, perceptualLoudnessDb: 0 } },
    // Title, channel and view count are left out on purpose: the app prefers
    // these over the recorded `/next` response, which has the real ones.
    videoDetails: {
      videoId,
      lengthSeconds,
      isOwnerViewing: false,
      isCrawlable: true,
      thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, width: 480, height: 360 }] },
      allowRatings: true,
      isPrivate: false,
      isUnpluggedCorpus: false,
      isLiveContent: false
    },
    // No publish date on purpose: it would win over the recorded `/next`
    // response, which knows the real one.
    microformat: {
      playerMicroformatRenderer: {
        lengthSeconds,
        isFamilySafe: true,
        isUnlisted: false,
        category: 'People & Blogs'
      }
    },
    trackingParams: '',
    ...overrides
  }
}

/**
 * Answers requests for the demo stream with the local media file. Chromium
 * asks for byte ranges, so honour `Range` to keep seeking working.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Buffer} [mediaBody] optional sample media, served with the same byte-range handling
 */
export async function routeDemoMedia(page, mediaBody) {
  await page.route(/googlevideo\.com\/videoplayback/, async (route) => {
    const body = mediaBody ?? await readDemoMedia()
    const range = /bytes=(\d*)-(\d*)/.exec(route.request().headers().range ?? '')

    if (!range) {
      return route.fulfill({
        status: 200,
        contentType: 'video/webm',
        headers: { 'accept-ranges': 'bytes', 'content-length': String(body.length) },
        body
      })
    }

    // An empty first value makes it a suffix range ("the last N bytes"),
    // which players use to read the trailing metadata of a file. A suffix
    // longer than the file means all of it.
    const [, rawStart, rawEnd] = range
    const suffix = rawStart === ''
    const start = suffix ? Math.max(0, body.length - Number(rawEnd || 0)) : Number(rawStart)
    const end = suffix || rawEnd === ''
      ? body.length - 1
      : Math.min(Number(rawEnd), body.length - 1)

    // Past the end of the file, or a zero-length suffix.
    if (start > end) {
      return route.fulfill({
        status: 416,
        headers: { 'accept-ranges': 'bytes', 'content-range': `bytes */${body.length}` }
      })
    }

    return route.fulfill({
      status: 206,
      contentType: 'video/webm',
      headers: {
        'accept-ranges': 'bytes',
        'content-range': `bytes ${start}-${end}/${body.length}`,
        'content-length': String(end - start + 1)
      },
      body: body.subarray(start, end + 1)
    })
  })
}

/**
 * youtubei.js resolves the id of the player script (which deciphers stream
 * URLs) from the IFrame API. Pinning it to a fixed id keeps the follow-up
 * `/s/player/` request predictable for the fixture lookups.
 *
 * The body is matched with a regex on the other end, hence the escaping.
 *
 * @param {import('@playwright/test').Page} page
 */
export function routeIframeApi(page) {
  return page.route('https://www.youtube.com/iframe_api', (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: 'player\\/test-player\\/'
  }))
}

/**
 * The renderer scrapes the watch page HTML for the Innertube config and the
 * BotGuard challenge before it talks to Innertube at all, and throws when
 * either is missing (FreeTubeApp/FreeTube#9607), which leaves the watch page
 * without a player.
 *
 * Only those two are embedded here. The `/player` and `/next` responses may
 * also be inlined in the real page, but leaving them out keeps the demo player
 * response and the recorded fixtures authoritative, at the price of a console
 * warning the app already tolerates.
 *
 * @param {import('@playwright/test').Page} page
 */
export function routeWatchPageHtml(page) {
  const ytConfig = {
    INNERTUBE_API_KEY: 'e2e-innertube-api-key',
    INNERTUBE_API_VERSION: 'v1',
    INNERTUBE_CLIENT_NAME: 'WEB',
    INNERTUBE_CLIENT_VERSION: '2.20260101.00.00',
    PLAYER_JS_URL: '/s/player/test-player/player_ias.vflset/en_US/base.js',
    INNERTUBE_CONTEXT: {
      client: {
        hl: 'en',
        gl: 'US',
        clientName: 'WEB',
        clientVersion: '2.20260101.00.00',
        osName: 'Windows',
        osVersion: '10.0',
        platform: 'DESKTOP',
        deviceMake: '',
        deviceModel: '',
        browserName: 'Chrome',
        browserVersion: '140.0.0.0',
        originalUrl: 'https://www.youtube.com/',
        visitorData: 'e2e-visitor-data'
      },
      request: { useSsl: true },
      user: { lockedSafetyMode: false }
    }
  }

  // Only has to be parseable: the poToken it feeds into is stubbed out.
  const attestationData = {
    challenge: 'e2e-challenge',
    interpreterUrl: '//www.youtube.com/s/e2e/botguard.js'
  }

  // Matched with a regex on the other end, so it has to be one statement.
  const body = `<!DOCTYPE html><html><head><script>ytcfg.set(${JSON.stringify(ytConfig)});</script>` +
    `<script>window.ytAtN(${JSON.stringify(attestationData)})</script>` +
    '</head><body></body></html>'

  return page.route(/^https:\/\/www\.youtube\.com\/watch\?/, (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body
  }))
}

/**
 * Replaces the BotGuard-backed poToken generation, which would otherwise
 * need YouTube's attestation servers and fails the video load without them.
 *
 * @param {import('@playwright/test').ElectronApplication} electronApp
 */
export function stubPoToken(electronApp) {
  return electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('generate-po-token')
    ipcMain.handle('generate-po-token', () => 'test-po-token')
  })
}
