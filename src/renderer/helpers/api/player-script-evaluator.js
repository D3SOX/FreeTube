export class PlayerScriptEvaluator {
  /** @type {Worker | null} */
  worker = null
  nextId = 0
  /** @type {Map<number, {resolve: (value: unknown) => void, reject: (error: Error) => void, timer: ReturnType<typeof setTimeout>}>} */
  requests = new Map()

  /** @param {() => Worker} createWorker */
  constructor(createWorker) {
    this.createWorker = createWorker
  }

  /**
   * @param {string} code
   * @returns {Promise<unknown>}
   */
  evaluate(code) {
    return new Promise((resolve, reject) => {
      if (typeof code !== 'string') throw new TypeError('Player code must be a string')
      if (!this.worker) {
        const worker = this.createWorker()
        this.worker = worker
        worker.addEventListener('message', ({ data }) => {
          const request = this.requests.get(data?.id)
          if (worker !== this.worker || !request) return
          this.requests.delete(data.id)
          clearTimeout(request.timer)
          if (typeof data.error === 'string') request.reject(new Error(data.error))
          else request.resolve(data.result)
        })
        worker.addEventListener('error', () => this.fail(worker, new Error('The player-script worker failed')))
        worker.addEventListener('messageerror', () => this.fail(worker, new Error('Invalid player-script worker response')))
      }
      const worker = this.worker
      const id = ++this.nextId
      const timer = setTimeout(() => this.fail(worker, new Error('Player-script evaluation timed out')), 30_000)
      this.requests.set(id, { resolve, reject, timer })
      try {
        worker.postMessage({ id, code })
      } catch (error) {
        this.fail(worker, new Error(String(error)))
      }
    })
  }

  /**
   * @param {Worker} worker
   * @param {Error} error
   */
  fail(worker, error) {
    if (worker !== this.worker) return
    worker.terminate()
    this.worker = null
    for (const request of this.requests.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    this.requests.clear()
  }
}
