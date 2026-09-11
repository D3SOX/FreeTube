import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../../src/renderer/composables/useScrollClamp.js', import.meta.url), 'utf8')
const watcherSource = source.slice(source.indexOf('watch([scroller, content]'), source.indexOf('onBeforeUnmount(()'))

test('a superseded scroll-clamp watcher cannot install a stale observer', async () => {
  let watcher
  const updates = []
  const observers = []
  class ResizeObserver {
    constructor() { observers.push(this) }
    observe() {}
    disconnect() {}
  }
  new Function('watch', 'scroller', 'content', 'nextTick', 'ResizeObserver', 'clamp', `let observer\n${watcherSource}`)(
    (_refs, callback) => { watcher = callback },
    { value: {} },
    { value: {} },
    () => new Promise(resolve => updates.push(resolve)),
    ResizeObserver,
    () => {}
  )

  let cleanup
  const stale = watcher(null, null, callback => { cleanup = callback })
  cleanup()
  const current = watcher(null, null, () => {})
  updates.shift()()
  await stale
  assert.equal(observers.length, 0)
  updates.shift()()
  await current
  assert.equal(observers.length, 1)
})
