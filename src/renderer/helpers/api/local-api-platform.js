import { PlayerScriptEvaluator } from './player-script-evaluator.js'

const playerScriptEvaluator = new PlayerScriptEvaluator(() => new Worker(
  new URL('./player-script-worker.js', import.meta.url),
  { name: 'player-script-worker' }
))

/**
 * Interprets youtubei.js player code in a worker shared by Electron and Capacitor.
 * @param {{ output: string }} data
 * @returns {Promise<unknown>}
 */
export function evaluatePlayerScript(data) {
  return playerScriptEvaluator.evaluate(data.output)
}

/**
 * Generates a video-bound PO token through the isolated host implementation.
 * @param {string} videoId
 * @param {import('youtubei.js').Session['context']} context
 * @param {object} initialAttestationData
 * @param {object} ytConfig
 * @returns {Promise<string>}
 */
export async function generateContentPoToken(
  videoId,
  context,
  initialAttestationData,
  ytConfig
) {
  if (process.env.IS_ELECTRON) {
    return window.ftElectron.generatePoToken(
      videoId,
      JSON.stringify(context),
      JSON.stringify(initialAttestationData),
      JSON.stringify(ytConfig)
    )
  }

  if (process.env.IS_CAPACITOR) {
    const { generateCapacitorPoToken } = await import('./capacitor-po-token')
    return generateCapacitorPoToken(
      videoId,
      context,
      initialAttestationData,
      ytConfig
    )
  }

  throw new Error('PO token generation is unavailable on this platform')
}
