import assert from 'node:assert/strict'
import test from 'node:test'

import { PlayerScriptEvaluator } from '../../src/renderer/helpers/api/player-script-evaluator.js'

class FakeWorker extends EventTarget {
  requests = []
  terminated = false
  postMessage(data) { this.requests.push(data) }
  terminate() { this.terminated = true }
  reply(data) { this.dispatchEvent(new MessageEvent('message', { data })) }
}

test('matches concurrent requests and rejects errors without losing other replies', async () => {
  const worker = new FakeWorker()
  const evaluator = new PlayerScriptEvaluator(() => worker)
  const first = evaluator.evaluate('return 1')
  const second = evaluator.evaluate('throw Error()')
  const rejection = assert.rejects(second, /bad player/)
  worker.reply(null)
  worker.reply({ id: 999, result: 'unrelated' })
  worker.reply({ id: worker.requests[1].id, error: 'bad player' })
  worker.reply({ id: worker.requests[0].id, result: 1 })
  assert.equal(await first, 1)
  await rejection
  assert.equal(evaluator.requests.size, 0)
})

for (const event of ['error', 'messageerror', 'timeout']) {
  test(`recovers after worker ${event} and rejects all pending requests`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const workers = []
    const evaluator = new PlayerScriptEvaluator(() => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    })
    const first = assert.rejects(evaluator.evaluate('one'))
    const second = assert.rejects(evaluator.evaluate('two'))
    if (event === 'timeout') t.mock.timers.tick(30_000)
    else workers[0].dispatchEvent(new Event(event))
    await Promise.all([first, second])
    assert.equal(workers[0].terminated, true)
    assert.equal(evaluator.requests.size, 0)
    const next = evaluator.evaluate('next')
    workers[0].reply({ id: workers[1].requests[0].id, result: 'stale' })
    workers[1].reply({ id: workers[1].requests[0].id, result: 'recovered' })
    assert.equal(await next, 'recovered')
  })
}
