import { registerPlugin } from '@capacitor/core'

export const ANDROID_MEDIA_SESSION_ACTIONS = [
  'play',
  'pause',
  'stop',
  'seekbackward',
  'seekforward',
  'seekto',
  'previoustrack',
  'nexttrack',
]

const SUPPORTED_ACTIONS = new Set(ANDROID_MEDIA_SESSION_ACTIONS)

const AndroidMediaSession = process.env.IS_CAPACITOR
  ? registerPlugin('AndroidMediaSession')
  : null

function finiteOr(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

/**
 * Converts the presented tab's browser media-session state into the small,
 * serializable payload understood by Android's foreground media service.
 */
export function createAndroidMediaSessionState({
  playbackState = 'none',
  metadata = null,
  positionState = null,
  actionHandlers = {},
  nativeOwner = null,
} = {}) {
  const duration = Math.max(0, finiteOr(positionState?.duration, 0))
  const position = Math.min(duration, Math.max(0, finiteOr(positionState?.position, 0)))
  const playbackRate = Math.max(0, finiteOr(positionState?.playbackRate, 1))

  return {
    ...(typeof nativeOwner === 'string' && nativeOwner ? { nativeOwner } : {}),
    playbackState: ['playing', 'paused'].includes(playbackState) ? playbackState : 'none',
    title: typeof metadata?.title === 'string' ? metadata.title : '',
    artist: typeof metadata?.artist === 'string' ? metadata.artist : '',
    artwork: typeof metadata?.artwork?.[0]?.src === 'string' ? metadata.artwork[0].src : '',
    duration,
    position,
    playbackRate,
    actions: Object.entries(actionHandlers)
      .filter(([action, handler]) => SUPPORTED_ACTIONS.has(action) && typeof handler === 'function')
      .map(([action]) => action),
  }
}

export function updateAndroidMediaSession(state) {
  if (!AndroidMediaSession) return

  const payload = createAndroidMediaSessionState(state)
  const operation = payload.playbackState === 'none'
    ? AndroidMediaSession.clear({ nativeOwner: payload.nativeOwner })
    : AndroidMediaSession.update({ state: payload })
  operation.catch(error => console.error('Failed to update Android media controls', error))
}

export async function addAndroidMediaSessionActionListener(listener) {
  if (!AndroidMediaSession) return () => {}
  const handle = await AndroidMediaSession.addListener('action', listener)
  return () => handle.remove()
}

export function shouldPauseAndroidPlaybackOnAppStateChange(isActive, continuePlayback) {
  return !isActive && !continuePlayback
}
