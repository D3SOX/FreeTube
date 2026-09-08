import { getLocalPlaylist, parseLocalPlaylistVideos } from './local'
import { invidiousGetPlaylistInfo } from './invidious'
import { loadInvidiousPlaylistSnapshot, loadLocalPlaylistSnapshot } from '../playlist-snapshot'

export async function getPlaylistSnapshot(id, { backend, fallback, signal }) {
  const loadLocal = () => loadLocalPlaylistSnapshot(id, {
    getPlaylist: getLocalPlaylist,
    // A snapshot must fail on an empty/invalid continuation instead of silently
    // accepting the partial result used by the browsing view.
    getContinuation: playlist => playlist.getContinuation(),
    parseVideos: parseLocalPlaylistVideos,
    signal,
  })
  const loadInvidious = () => loadInvidiousPlaylistSnapshot(id, {
    getPlaylist: invidiousGetPlaylistInfo,
    signal,
  })
  const useLocal = process.env.SUPPORTS_LOCAL_API && backend !== 'invidious'
  try {
    return await (useLocal ? loadLocal() : loadInvidious())
  } catch (error) {
    signal?.throwIfAborted()
    if (!fallback || (!useLocal && !process.env.SUPPORTS_LOCAL_API)) throw error
    // Restart from page one on the other backend, without mixing snapshots.
    return await (useLocal ? loadInvidious() : loadLocal())
  }
}
