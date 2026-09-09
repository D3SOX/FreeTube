import { registerPlugin } from '@capacitor/core'
import { createVoiceOverTranslationClient } from '../../../voiceOverTranslation.js'

const VoiceOverHttp = registerPlugin('VoiceOverHttp')

/**
 * VOT exchanges small protobuf messages. Keep their bytes intact across the
 * native bridge; translated audio itself streams through the native player.
 * @param {RequestInfo | URL} input
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
export async function capacitorVoiceOverFetch(input, init) {
  const request = new Request(input, init)
  const bytes = new Uint8Array(await request.arrayBuffer())
  let body = ''
  for (const byte of bytes) body += String.fromCharCode(byte)
  const result = await VoiceOverHttp.request({
    url: request.url,
    method: request.method,
    headers: Object.fromEntries(request.headers),
    body: btoa(body),
    headersOnly: request.headers.get('range') === 'bytes=0-0',
  })
  const data = Uint8Array.from(atob(result.body), character => character.charCodeAt(0))
  return new Response([204, 205, 304].includes(result.status) ? null : data, {
    status: result.status,
    headers: result.headers,
  })
}

export const requestCapacitorVoiceOverTranslation = createVoiceOverTranslationClient(capacitorVoiceOverFetch)
