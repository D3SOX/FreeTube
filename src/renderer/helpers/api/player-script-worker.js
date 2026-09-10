import { evaluatePlayerCode } from './player-script-runtime.js'

// A dedicated worker receives messages only through its owner's Worker object.
// The interpreted code has no access to this worker or its message channel.
self.addEventListener('message', async ({ data }) => {
  if (!data || !Number.isSafeInteger(data.id) || typeof data.code !== 'string') return
  try {
    self.postMessage({ id: data.id, result: await evaluatePlayerCode(data.code) })
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error) })
  }
})
