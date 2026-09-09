import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { ref, nextTick } from 'vue'

import {
  buildSubscriptionShortsFeed,
  getChannelShortsNavigationContext,
  getPreferredShortThumbnailUrl,
  getShortsCompletionState,
  getVideoAspectRatio,
  isYouTubeShort,
  parseLocalShortLinkedVideo,
  setChannelShortsNavigationContext,
} from '../../src/renderer/helpers/player/shorts.js'

const playerSource = await readFile(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
const handleLoadedSource = playerSource.slice(
  playerSource.indexOf('    async function handleLoaded() {'),
  playerSource.indexOf('    async function unloadForFormatSwitch() {')
)

for (const paused of [true, false]) {
  test(`Shorts controls reflect media paused=${paused} after loading without a playback event`, async () => {
    const shortsPaused = ref(false)
    const video = ref({ paused, duration: 30, videoWidth: 1080, videoHeight: 1920 })
    const handleLoaded = vm.runInNewContext(`${handleLoadedSource}\nhandleLoaded`, {
      shortsPaused,
      video,
      hasLoaded: ref(false),
      isLive: ref(false),
      hasMultipleAudioTracks: ref(false),
      togglePlaybackRate: null,
      restoreCaptionIndex: null,
      suppressInitialAutoplay: false,
      props: { shortsPlayer: true, format: 'dash', captions: [], chapters: [] },
      player: { isLive: () => false, getAudioTracks: () => [], getTextTracks: () => [] },
      process: { env: { SUPPORTS_LOCAL_API: false } },
      deduplicateAudioTracks: tracks => new Set(tracks),
      nextTick,
      emit() {},
      restorePendingPlaybackRate() {},
      rememberInlinePlayerLayoutHeight() {},
      loadChapterThumbnails() {},
      syncShortsCaptionsEnabled() {},
      refreshAbRepeatMarkers() {},
      applyPendingPresentationModes() {},
    })

    await handleLoaded()
    assert.equal(shortsPaused.value, paused, 'the play/pause control must match the loaded media')
    assert.equal(video.value.paused, paused, 'synchronizing the control must not start playback')
  })
}

test('only completes Shorts after continuous playback following a seek', () => {
  const seekToEnd = getShortsCompletionState({
    blockedBySeek: true,
    playbackAfterSeekSeconds: 0,
    elapsedSeconds: 59.75,
    currentSeconds: 59.75,
    durationSeconds: 60,
  })
  assert.deepEqual(seekToEnd, {
    blockedBySeek: true,
    playbackAfterSeekSeconds: 0,
    reachedEnd: false
  })

  const seekBackToStart = getShortsCompletionState({
    ...seekToEnd,
    elapsedSeconds: -59.75,
    currentSeconds: 0,
    durationSeconds: 60,
  })
  assert.equal(seekBackToStart.reachedEnd, false)

  const firstPlaybackTick = getShortsCompletionState({
    ...seekBackToStart,
    elapsedSeconds: 0.5,
    currentSeconds: 59,
    durationSeconds: 60,
  })
  const completed = getShortsCompletionState({
    ...firstPlaybackTick,
    elapsedSeconds: 0.5,
    currentSeconds: 59.5,
    durationSeconds: 60,
  })

  assert.deepEqual(completed, {
    blockedBySeek: false,
    playbackAfterSeekSeconds: 1,
    reachedEnd: true
  })
})

test('prefers YouTube selected Shorts thumbnails only for the default preference', () => {
  const video = {
    thumbnailUrl: 'https://i.ytimg.com/vi/short/frame0.jpg'
  }

  assert.equal(
    getPreferredShortThumbnailUrl(video, '', 'https://i.ytimg.com/vi/short/oardefault.jpg'),
    video.thumbnailUrl
  )
  assert.equal(
    getPreferredShortThumbnailUrl(video, 'middle', 'https://i.ytimg.com/vi/short/oar2.jpg'),
    'https://i.ytimg.com/vi/short/oar2.jpg'
  )
  assert.equal(getPreferredShortThumbnailUrl(video, 'hidden', null), null)
})

test('reads aspect ratios from local and Invidious formats', () => {
  assert.equal(getVideoAspectRatio([{ width: 1080, height: 1920 }]), 9 / 16)
  assert.equal(getVideoAspectRatio([{ size: '1080x1920' }]), 9 / 16)
  assert.equal(getVideoAspectRatio([{ audioQuality: 'AUDIO_QUALITY_MEDIUM' }]), null)
})

test('detects portrait Shorts up to three minutes long', () => {
  assert.equal(isYouTubeShort({
    duration: 180,
    formats: [{ width: 1080, height: 1920 }],
  }), true)
})

test('does not mistake landscape or long portrait videos for Shorts', () => {
  assert.equal(isYouTubeShort({
    duration: 60,
    formats: [{ width: 1920, height: 1080 }],
  }), false)
  assert.equal(isYouTubeShort({
    duration: 181,
    formats: [{ width: 1080, height: 1920 }],
  }), false)
})

test('does not infer a Short from ambiguous square watch-page media', () => {
  assert.equal(isYouTubeShort({
    duration: 120,
    formats: [{ width: 1080, height: 1080 }],
  }), false)
})

test('trusts an explicit non-Short classification over portrait dimensions', () => {
  assert.equal(isYouTubeShort({
    explicit: false,
    duration: 120,
    formats: [{ width: 1080, height: 1920 }],
  }), false)
})

test('trusts an explicit Shorts route without stream dimensions', () => {
  assert.equal(isYouTubeShort({ explicit: true }), true)
})

test('extracts a linked full video from Reel metadata', () => {
  const response = {
    data: {
      overlay: {
        reelPlayerOverlayRenderer: {
          playerOverlay: {
            reelPlayerOverlayViewModel: {
              metapanel: {
                reelMetapanelViewModel: {
                  metadataItems: [{
                    reelCarouselViewModel: {
                      buttonViewModels: [{
                        reelCarouselButtonViewModel: {
                          buttonViewModel: {
                            buttonViewModel: {
                              titleFormatted: { content: 'Related full video' },
                              onTap: {
                                innertubeCommand: {
                                  watchEndpoint: { videoId: 'linked-video' }
                                }
                              }
                            }
                          }
                        }
                      }]
                    }
                  }]
                }
              }
            }
          }
        }
      }
    }
  }

  assert.deepEqual(parseLocalShortLinkedVideo(response), {
    videoId: 'linked-video',
    title: 'Related full video',
  })
  assert.equal(parseLocalShortLinkedVideo({}), null)
})

test('builds a newest-first, filtered subscription Shorts feed', () => {
  const feed = buildSubscriptionShortsFeed({
    subscriptions: [
      { id: 'channel-a' },
      { id: 'channel-b' },
      { id: 'channel-c', feedTypes: ['videos'] }
    ],
    cache: {
      'channel-a': {
        videos: [
          { videoId: 'a-new', authorId: 'channel-a', published: 30 },
          { videoId: 'a-old', authorId: 'channel-a', published: 10 },
        ]
      },
      'channel-b': {
        videos: [
          { videoId: 'hidden', authorId: 'channel-b', published: 40 },
          { videoId: 'b', authorId: 'channel-b', published: 20 },
        ]
      },
      'channel-c': {
        videos: [
          { videoId: 'disabled-short', authorId: 'channel-c', published: 50 }
        ]
      }
    },
    isHidden: video => video.videoId === 'hidden',
    maxPerChannel: 1,
  })

  assert.deepEqual(feed.map(video => video.videoId), ['a-new', 'b'])
})

test('keeps an isolated Shorts navigation sequence for each channel', () => {
  setChannelShortsNavigationContext('channel-a', [
    { videoId: 'a-1' },
    { videoId: 'a-2' },
  ])
  setChannelShortsNavigationContext('channel-b', [{ videoId: 'b-1' }])

  assert.deepEqual(
    getChannelShortsNavigationContext('channel-a').map(video => video.videoId),
    ['a-1', 'a-2']
  )
  assert.deepEqual(
    getChannelShortsNavigationContext('channel-b').map(video => video.videoId),
    ['b-1']
  )
})
