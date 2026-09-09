import { hasMoreInvidiousPlaylistPages, mergeInvidiousPlaylistVideos } from './api/invidious-playlists.js'

/** Fetch a fresh snapshot without exposing partially loaded pages to callers. */
export async function loadLocalPlaylistSnapshot(id, { getPlaylist, getContinuation, parseVideos, signal }) {
  signal?.throwIfAborted()
  let page = await getPlaylist(id)
  const title = page.info.title
  const description = page.info.description ?? ''
  const videos = []
  while (page) {
    signal?.throwIfAborted()
    videos.push(...parseVideos(page.items))
    if (!page.has_continuation) break
    page = await getContinuation(page)
    if (!page) throw new Error('Missing playlist continuation')
  }
  signal?.throwIfAborted()
  return { title, description, videos }
}

/** Invidious pages can overlap; preserve repeated videos at different positions. */
export async function loadInvidiousPlaylistSnapshot(id, { getPlaylist, signal }) {
  signal?.throwIfAborted()
  let page = await getPlaylist(id)
  const { title, description } = page
  let videos = page.videos
  let pageNumber = 1
  while (hasMoreInvidiousPlaylistPages(page.videoCount, pageNumber, videos.length, page.pageVideoCount)) {
    signal?.throwIfAborted()
    page = await getPlaylist(id, ++pageNumber)
    if (page.pageVideoCount === 0) throw new Error('Missing playlist continuation')
    videos = mergeInvidiousPlaylistVideos(videos, page.videos)
  }
  signal?.throwIfAborted()
  return { title, description, videos }
}
