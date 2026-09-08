const AUDIO = 1
const VIDEO = 2

function originalId(format, track) {
  return format ? `${format.itag}-${format.lastModified ?? '0'}-${format.xtags ?? ''}` : track.id
}

function audioRoles(format, track) {
  if (format?.isDrc) return ['drc']
  if (format?.isVoiceBoost) return ['voice-boost']
  if (format?.isAutoDubbed) return ['dubbed-auto']
  if (format?.isDubbed) return ['dubbed']
  if (format?.isDescriptive) return ['descriptive']
  if (format?.isSecondary) return ['secondary']
  return format?.isOriginal || (track.roleFlags & 1) ? ['main'] : []
}

// Keep the current codec where possible when changing resolution. The selected
// encode must represent its quality so manual selection and Auto stay in sync.
function videoQualities(tracks) {
  const codec = track => track.codecs?.split('.')[0]
  const activeCodec = codec(tracks.find(track => track.selected) ?? {})
  const qualities = new Map()
  for (const track of tracks) {
    const key = JSON.stringify([track.width, track.height, track.frameRate, track.hdr, track.roleFlags])
    const previous = qualities.get(key)
    if (!previous || track.selected || (!previous.selected && codec(track) === activeCodec && codec(previous) !== activeCodec)) {
      qualities.set(key, track)
    }
  }
  return [...qualities.values()].map(track => ({
    active: track.selected,
    bandwidth: track.bitrate,
    width: track.width,
    height: track.height,
    frameRate: track.frameRate,
    hdr: track.hdr,
    codecs: track.codecs,
    mimeType: track.mimeType,
    roles: [],
    nativeTrack: track,
  }))
}

/** Track descriptions consumed by the existing quality and language controls. */
export function androidPlaybackTracks(tracks, formats = []) {
  const audio = tracks.filter(track => track.type === AUDIO && track.supported).map(track => {
    const format = formats[Number(track.id)]
    const roles = audioRoles(format, track)
    return {
      id: `${track.group}:${track.index}`,
      active: track.selected,
      language: track.language || 'und',
      label: track.label,
      roles,
      audioRoles: roles,
      channelsCount: track.channels,
      audioSamplingRate: track.sampleRate,
      audioCodec: track.codecs,
      mimeType: track.mimeType,
      bandwidth: track.bitrate,
      audioBandwidth: track.bitrate,
      originalId: originalId(format, track),
      nativeTrack: track,
    }
  })
  const video = tracks.filter(track => track.type === VIDEO && track.supported)
  const variants = []
  for (const audioTrack of audio.length ? audio : [null]) {
    for (const videoTrack of video.length ? video : [null]) {
      if (!audioTrack && !videoTrack) continue
      const videoFormat = videoTrack ? formats[Number(videoTrack.id)] : null
      const videoBandwidth = videoTrack?.bitrate ?? 0
      variants.push({
        ...audioTrack,
        id: variants.length,
        type: 'variant',
        active: (!audioTrack || audioTrack.active) && (!videoTrack || videoTrack.selected),
        bandwidth: Math.max(0, audioTrack?.audioBandwidth ?? 0) + Math.max(0, videoBandwidth),
        audioBandwidth: audioTrack?.audioBandwidth ?? 0,
        audioRoles: audioTrack?.roles ?? [],
        videoBandwidth,
        width: videoTrack?.width,
        height: videoTrack?.height,
        frameRate: videoTrack?.frameRate,
        hdr: videoTrack?.hdr,
        videoCodec: videoTrack?.codecs,
        audioId: audioTrack?.id ?? null,
        videoId: videoTrack ? `${videoTrack.group}:${videoTrack.index}` : null,
        originalAudioId: audioTrack?.originalId ?? null,
        originalVideoId: videoTrack ? originalId(videoFormat, videoTrack) : null,
        nativeAudio: audioTrack?.nativeTrack ?? null,
        nativeVideo: videoTrack,
        primary: audioTrack?.roles.includes('main') ?? false,
      })
    }
  }
  return { audio, video: videoQualities(video), variants }
}
