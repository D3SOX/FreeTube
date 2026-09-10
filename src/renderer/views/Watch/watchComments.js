/**
 * @param {{ isLive: boolean, isPremiere: boolean, hideComments: boolean, localFilePlayback?: boolean, channelId?: string }} state
 */
export function areCommentsAvailable({ isLive, isPremiere, hideComments, localFilePlayback, channelId }) {
  return (!isLive || isPremiere) && !hideComments && !(localFilePlayback && !channelId)
}
