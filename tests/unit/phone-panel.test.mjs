import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../../src/renderer/components/FtPhonePanel/FtPhonePanel.vue', import.meta.url), 'utf8')
const watcherSource = source.slice(source.indexOf('watch(() => props.open'), source.indexOf('</script>'))

for (const change of ['close', 'unmount']) {
  test(`panel scroll restoration stops after ${change} during the DOM update`, async () => {
    const props = { open: true }
    const scroller = { value: { scrollTop: 0 } }
    let watcher
    let restoreCalls = 0
    let finishUpdate
    const updated = new Promise(resolve => { finishUpdate = resolve })
    new Function('watch', 'props', 'scroller', 'nextTick', 'restoreOverlayScrollTop', 'clamp', 'readingPosition', watcherSource)(
      (_source, callback) => { watcher = callback }, props, scroller, () => updated,
      element => { element.scrollTop = 100; restoreCalls++ }, () => {}, 100
    )
    const restoring = watcher(true)
    if (change === 'unmount') scroller.value = null
    else props.open = false
    finishUpdate()
    await restoring
    assert.equal(restoreCalls, 0)
  })
}
