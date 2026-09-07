import {
  ANDROID_MEDIA_SESSION_ACTIONS,
  updateAndroidMediaSession,
} from '../helpers/androidMediaSession.js'

const MEDIA_SESSION_ACTIONS = [
  ...ANDROID_MEDIA_SESSION_ACTIONS,
  'enterpictureinpicture'
]

const mediaByTabId = new Map()
let presentedTabId = null
let ownerTabId = null
let pictureInPictureTabId = null
let miniPlayerTabId = null
let playSequence = 0
let powerSaveBlocked = false
const ownershipListeners = new Map()
let notifiedOwnerTabId = null
let ownershipNotificationPending = false

function getEntry(tabId) {
  if (!tabId) {
    return null
  }

  let entry = mediaByTabId.get(tabId)
  if (!entry) {
    entry = {
      playbackState: 'none',
      lastPlayedAt: 0,
      metadata: null,
      nativeOwner: null,
      positionState: null,
      actionHandlerSources: new Map()
    }
    mediaByTabId.set(tabId, entry)
  }
  return entry
}

function chooseOwner() {
  if (process.env.IS_CAPACITOR) {
    if (miniPlayerTabId && mediaByTabId.has(miniPlayerTabId)) {
      return miniPlayerTabId
    }
    if (presentedTabId && mediaByTabId.has(presentedTabId)) return presentedTabId
    // Browsing a non-video tab hides the surface, but keeps native audio and
    // its buffer alive. Another video tab can still take over the single player.
    return mediaByTabId.get(ownerTabId)?.nativeOwner ? ownerTabId : null
  }

  if (pictureInPictureTabId && mediaByTabId.has(pictureInPictureTabId)) {
    return pictureInPictureTabId
  }

  const presented = mediaByTabId.get(presentedTabId)
  if (presented?.playbackState === 'playing') {
    return presentedTabId
  }

  let candidateId = null
  let candidateSequence = -1
  for (const [tabId, entry] of mediaByTabId) {
    if (entry.playbackState === 'playing' && entry.lastPlayedAt > candidateSequence) {
      candidateId = tabId
      candidateSequence = entry.lastPlayedAt
    }
  }

  if (candidateId) {
    return candidateId
  }

  if (presented?.metadata) {
    return presentedTabId
  }

  return ownerTabId && mediaByTabId.has(ownerTabId) ? ownerTabId : null
}

function getActionHandlers(entry) {
  const handlers = {}
  for (const sourceHandlers of entry?.actionHandlerSources.values() ?? []) {
    Object.assign(handlers, sourceHandlers)
  }
  return handlers
}

function applyOwner(playbackStartedTabId = null) {
  ownerTabId = chooseOwner()
  if (notifiedOwnerTabId !== ownerTabId && !ownershipNotificationPending) {
    ownershipNotificationPending = true
    queueMicrotask(() => {
      ownershipNotificationPending = false
      const selected = chooseOwner()
      if (notifiedOwnerTabId === selected) return
      notifiedOwnerTabId = selected
      for (const [tabId, listener] of ownershipListeners) listener(tabId === selected)
    })
  }
  const owner = mediaByTabId.get(ownerTabId)
  const actionHandlers = getActionHandlers(owner)

  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = owner?.playbackState ?? 'none'
    navigator.mediaSession.metadata = owner?.metadata ?? null

    for (const action of MEDIA_SESSION_ACTIONS) {
      try {
        navigator.mediaSession.setActionHandler(action, actionHandlers[action] ?? null)
      } catch {
        // The action is not supported on this platform.
      }
    }

    try {
      if (owner?.positionState) {
        navigator.mediaSession.setPositionState(owner.positionState)
      } else {
        navigator.mediaSession.setPositionState()
      }
    } catch {
      // Position state is optional and unsupported in some Chromium versions.
    }
  }

  updateAndroidMediaSession({
    playbackState: owner?.playbackState,
    metadata: owner?.metadata,
    positionState: owner?.positionState,
    actionHandlers,
    nativeOwner: owner?.nativeOwner,
  })

  globalThis.window?.ftElectron?.tabs?.setMediaSessionState?.({
    playbackState: owner?.playbackState ?? 'none',
    playbackStarted: ownerTabId === playbackStartedTabId && owner?.playbackState === 'playing',
    hasMetadata: owner?.metadata != null,
    actions: Object.keys(actionHandlers)
      .filter(action => typeof actionHandlers[action] === 'function')
  })
}

function applyPowerSaveState() {
  if (!process.env.IS_ELECTRON) {
    return
  }

  const shouldBlock = Array.from(mediaByTabId.values())
    .some(entry => entry.playbackState === 'playing')
  if (shouldBlock === powerSaveBlocked) {
    return
  }

  powerSaveBlocked = shouldBlock
  if (shouldBlock) {
    window.ftElectron?.startPowerSaveBlocker?.()
  } else {
    window.ftElectron?.stopPowerSaveBlocker?.()
  }
}

export const tabMediaCoordinator = {
  subscribeOwnership(tabId, listener) {
    getEntry(tabId)
    ownershipListeners.set(tabId, listener)
    listener(tabId === chooseOwner())
    return () => {
      if (ownershipListeners.get(tabId) === listener) ownershipListeners.delete(tabId)
    }
  },

  setNativeOwner(tabId, nativeOwner) {
    const entry = getEntry(tabId)
    if (!entry || entry.nativeOwner === nativeOwner) return
    if (nativeOwner && entry.playbackState === 'none') entry.playbackState = 'paused'
    if (!nativeOwner && entry.nativeOwner) entry.playbackState = 'none'
    entry.nativeOwner = nativeOwner
    applyOwner()
  },

  dispatchAction(action, details = {}) {
    if (!MEDIA_SESSION_ACTIONS.includes(action)) {
      return
    }

    const handler = getActionHandlers(mediaByTabId.get(ownerTabId))[action]
    if (typeof handler === 'function') {
      handler(details)
    }
  },

  pauseAll() {
    for (const entry of mediaByTabId.values()) {
      if (entry.playbackState !== 'playing') continue
      const pause = getActionHandlers(entry).pause
      if (typeof pause === 'function') pause()
    }
  },

  setPresented(tabId) {
    const outgoingTabId = presentedTabId
    presentedTabId = tabId

    if (process.env.IS_CAPACITOR && outgoingTabId && outgoingTabId !== tabId) {
      if (!mediaByTabId.get(ownerTabId)?.nativeOwner) ownerTabId = null
      queueMicrotask(() => {
        if (miniPlayerTabId !== outgoingTabId) {
          const outgoing = mediaByTabId.get(outgoingTabId)
          const pause = getActionHandlers(outgoing).pause
          if (!outgoing?.nativeOwner && outgoing?.playbackState === 'playing' && typeof pause === 'function') pause()
        }
        applyOwner()
      })
      return
    }

    applyOwner()
  },

  setMiniPlayer(tabId, active) {
    if (active) {
      if (!mediaByTabId.has(tabId)) return
      miniPlayerTabId = tabId
    } else if (miniPlayerTabId === tabId) {
      miniPlayerTabId = null
    }
    applyOwner()
  },

  setPictureInPicture(tabId, active) {
    if (active) {
      if (!mediaByTabId.has(tabId)) {
        return
      }
      pictureInPictureTabId = tabId
    } else if (pictureInPictureTabId === tabId) {
      pictureInPictureTabId = null
    }
    applyOwner()
  },

  setPlaybackState(tabId, playbackState) {
    const entry = getEntry(tabId)
    if (!entry) {
      return
    }

    entry.playbackState = playbackState
    if (playbackState === 'playing') {
      entry.lastPlayedAt = ++playSequence
    }
    applyOwner(playbackState === 'playing' ? tabId : null)
    applyPowerSaveState()
  },

  setMetadata(tabId, metadata) {
    if (!presentedTabId) {
      presentedTabId = tabId
    }
    const entry = getEntry(tabId)
    if (!entry) {
      return
    }

    entry.metadata = metadata
    applyOwner()
  },

  setPositionState(tabId, positionState, playbackState = null) {
    const entry = getEntry(tabId)
    if (!entry) {
      return
    }

    const playbackStarted = playbackState === 'playing' && entry.playbackState !== 'playing'
    const playbackChanged = playbackState !== null && entry.playbackState !== playbackState
    if (playbackState !== null) {
      entry.playbackState = playbackState
      if (playbackStarted) entry.lastPlayedAt = ++playSequence
    }
    entry.positionState = positionState
    if (ownerTabId === tabId || presentedTabId === tabId) {
      applyOwner(playbackStarted ? tabId : null)
    }
    if (playbackChanged) applyPowerSaveState()
  },

  setActionHandlers(tabId, source, actionHandlers) {
    const entry = getEntry(tabId)
    if (!entry) {
      return
    }

    if (actionHandlers == null && source && typeof source === 'object') {
      actionHandlers = source
      source = 'default'
    }

    if (typeof source !== 'string' || source.length === 0) {
      return
    }

    if (actionHandlers && Object.keys(actionHandlers).length > 0) {
      entry.actionHandlerSources.set(source, actionHandlers)
    } else {
      entry.actionHandlerSources.delete(source)
    }
    applyOwner()
  },

  unregister(tabId) {
    ownershipListeners.delete(tabId)
    mediaByTabId.delete(tabId)
    if (pictureInPictureTabId === tabId) {
      pictureInPictureTabId = null
    }
    if (miniPlayerTabId === tabId) {
      miniPlayerTabId = null
    }
    if (ownerTabId === tabId) {
      ownerTabId = null
    }
    if (presentedTabId === tabId) {
      presentedTabId = null
    }
    applyOwner()
    applyPowerSaveState()
  }
}

globalThis.window?.ftElectron?.tabs?.onMediaSessionAction?.((action) => {
  tabMediaCoordinator.dispatchAction(action)
})

export default tabMediaCoordinator
