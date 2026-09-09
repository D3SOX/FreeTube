import { net } from 'electron'
import { createVoiceOverTranslationClient } from '../voiceOverTranslation'

// Electron's network stack follows the app's proxy configuration.
export const requestVoiceOverTranslation = createVoiceOverTranslationClient(
  (input, init) => net.fetch(input, init)
)
