/** Shared screenshot/ambient input for browser and Android decoded video. */
export async function capturePlayerFrame(video, width, height) {
  if (!video.nativePlayback) return video
  const { dataUrl } = await video.nativePlayback.captureFrame({ width, height })
  const image = new Image()
  image.src = dataUrl
  await image.decode()
  return image
}
