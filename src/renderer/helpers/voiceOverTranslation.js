/** Requests translation using the platform's HTTP implementation. */
export async function requestVoiceOverTranslation(payload) {
  if (process.env.IS_ELECTRON) {
    return window.ftElectron.requestVoiceOverTranslation(payload)
  }
  if (process.env.IS_CAPACITOR) {
    const { requestCapacitorVoiceOverTranslation } = await import('./api/capacitor-voice-over.js')
    return requestCapacitorVoiceOverTranslation(payload)
  }
  throw new Error('Voice-over translation is unavailable on this platform')
}
