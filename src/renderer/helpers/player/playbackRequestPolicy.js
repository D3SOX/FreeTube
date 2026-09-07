/** Applies the CDN request policy before Shaka sends a media segment. */
export function prepareGoogleVideoRequest(request, isSabrRequest, isCapacitor = Boolean(process.env.IS_CAPACITOR)) {
  const url = new URL(request.uris[0])
  // Invidious proxies do not support YouTube's range query parameter.
  if (isSabrRequest || !url.hostname.endsWith('.googlevideo.com') || url.pathname !== '/videoplayback') return

  if (!isCapacitor) {
    request.method = 'POST'
    request.body = new Uint8Array([0x78, 0]) // protobuf: { 15: 0 }, as sent by YouTube
    url.searchParams.set('alr', 'yes')
  }

  // Android's WebView applies a Range header again to the intercepted stream.
  // Use the CDN's query parameter so nonzero ranges are not sliced twice.
  const rangeHeader = Object.keys(request.headers).find(key => key.toLowerCase() === 'range')
  if (rangeHeader) {
    url.searchParams.set('range', request.headers[rangeHeader].split('=')[1])
    delete request.headers[rangeHeader]
  }
  request.uris[0] = url.toString()
}
