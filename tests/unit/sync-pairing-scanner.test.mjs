import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { compileScript, parse } from 'vue/compiler-sfc'

const { descriptor } = parse(await readFile(new URL('../../src/renderer/components/SyncSettings/SyncPairing.vue', import.meta.url), 'utf8'))
const source = compileScript(descriptor, { id: 'pairing-scanner-test' }).content
  .replace(/^import[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
  .replace('export default', 'const Pairing =')
  .replace("import('../../helpers/nativePairingScanner')", 'loadNativeScanner()')

function setup({ native = true } = {}) {
  let resolveScan
  let rejectScan
  let unmount
  let nativeLoads = 0
  let browserStarts = 0
  let browserStops = 0
  const parsedCodes = []
  const scan = new Promise((resolve, reject) => { resolveScan = resolve; rejectScan = reject })
  const ref = value => ({ value })
  const component = runInNewContext(source + '; Pairing', {
    process: { env: { IS_CAPACITOR: native } },
    FtButton: {}, FtFlexBox: {}, FtInput: {}, FtLoader: {}, FtPrompt: {},
    ref,
    computed: fn => ({ get value() { return fn() } }),
    useTemplateRef: () => ref({ focus() {} }),
    nextTick: async () => {},
    onBeforeUnmount: fn => { unmount = fn },
    useI18n: () => ({ locale: ref('en-US'), t: key => key }),
    getCurrentSyncServerDeviceInfo: async () => ({ name: '' }),
    store: { getters: {} },
    loadNativeScanner: async () => {
      nativeLoads++
      return { scanNativePairingCode: () => scan }
    },
    QrScanner: class {
      async start() { browserStarts++ }
      destroy() { browserStops++ }
    },
    parsePairingQrPayload: code => {
      parsedCodes.push(code)
      throw new Error('Invalid pairing code')
    },
    clearTimeout,
  })
  const state = component.setup({ serverUrl: 'https://sync.example.test' }, { expose() {}, emit() {} })
  return {
    state, resolveScan, rejectScan, parsedCodes,
    unmount: () => unmount(),
    counts: () => ({ nativeLoads, browserStarts, browserStops }),
  }
}

async function flush() {
  // Settle the lazy import, scan promise, and Vue nextTick continuations.
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

test('Capacitor uses native scanning and validates its result through the existing pairing flow', async () => {
  const f = setup()
  await f.state.openScanner()
  f.resolveScan('invalid-code')
  await flush()
  assert.deepEqual(f.counts(), { nativeLoads: 1, browserStarts: 0, browserStops: 0 })
  assert.deepEqual(f.parsedCodes, ['invalid-code'])
  assert.equal(f.state.approveError.value, 'Invalid pairing code')
})

test('native cancellation and denied camera access both leave text pairing available', async () => {
  for (const denied of [false, true]) {
    const f = setup()
    await f.state.openScanner()
    if (denied) f.rejectScan(new Error('Permission denied'))
    else f.resolveScan(null)
    await flush()
    assert.equal(f.state.approveStage.value, 'manual')
    assert.equal(f.state.approvePromptOpen.value, true)
    assert.equal(f.state.approveError.value, denied ? 'Settings.Sync Settings.Camera Unavailable' : '')
  }
})

test('closing, unmounting, or switching to text entry invalidates a pending native scan', async () => {
  for (const action of ['closeScanner', 'openManualEntry', 'unmount']) {
    for (const rejected of [false, true]) {
      const f = setup()
      await f.state.openScanner()
      await flush()
      if (action === 'unmount') f.unmount()
      else await f.state[action]()
      if (rejected) f.rejectScan(new Error('Camera failed'))
      else f.resolveScan('stale-code')
      await flush()
      assert.deepEqual(f.parsedCodes, [])
      assert.equal(f.state.approveError.value, '')
      if (action === 'openManualEntry') assert.equal(f.state.approveStage.value, 'manual')
      if (action === 'closeScanner') assert.equal(f.state.approvePromptOpen.value, false)
    }
  }
})

test('desktop and web retain the embedded scanner and stop it when pairing closes', async () => {
  const f = setup({ native: false })
  await f.state.openScanner()
  await flush()
  f.state.closeScanner()
  assert.deepEqual(f.counts(), { nativeLoads: 0, browserStarts: 1, browserStops: 1 })
})
