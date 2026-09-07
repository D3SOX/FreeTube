import assert from 'node:assert/strict'
import test from 'node:test'
import { CapacitorBarcodeScanner } from '@capacitor/barcode-scanner'

import { scanNativePairingCode } from '../../src/renderer/helpers/nativePairingScanner.js'

const labels = {
  instructions: 'Scan the pairing code',
  cancelLabel: 'Cancel',
  torchOnLabel: 'Turn flashlight off',
  torchOffLabel: 'Turn flashlight on',
}

test('native pairing scans QR codes with the rear camera and returns the code unchanged', async t => {
  const scan = t.mock.method(CapacitorBarcodeScanner, 'scanBarcode', async () => ({
    ScanResult: 'opentubex-pairing:encrypted-request', format: 0,
  }))

  assert.equal(await scanNativePairingCode(labels), 'opentubex-pairing:encrypted-request')
  assert.deepEqual(scan.mock.calls[0].arguments, [{
    hint: 0,
    cameraDirection: 1,
    scanOrientation: 3,
    scanInstructions: labels.instructions,
    scanButton: false,
    cancelButtonAccessibilityLabel: labels.cancelLabel,
    torchButtonOnAccessibilityLabel: labels.torchOnLabel,
    torchButtonOffAccessibilityLabel: labels.torchOffLabel,
    android: { scanningLibrary: 'zxing' },
  }])
})

test('native cancellation returns to manual entry without reporting a camera failure', async t => {
  t.mock.method(CapacitorBarcodeScanner, 'scanBarcode', async () => {
    throw Object.assign(new Error('Canceled'), { code: 'OS-PLUG-BARC-0006' })
  })
  assert.equal(await scanNativePairingCode(labels), null)
})

test('camera denial and scanner failures remain errors and release the scanner for retry', async t => {
  for (const code of ['OS-PLUG-BARC-0007', 'OS-PLUG-BARC-0004']) {
    const error = Object.assign(new Error('Camera unavailable'), { code })
    const scan = t.mock.method(CapacitorBarcodeScanner, 'scanBarcode', async () => { throw error })
    await assert.rejects(scanNativePairingCode(labels), error)
    scan.mock.restore()
  }
  t.mock.method(CapacitorBarcodeScanner, 'scanBarcode', async () => ({ ScanResult: 'retry', format: 0 }))
  assert.equal(await scanNativePairingCode(labels), 'retry')
})

test('a pending native scan keeps exclusive ownership until it returns', async t => {
  let complete
  const scan = t.mock.method(CapacitorBarcodeScanner, 'scanBarcode', () => new Promise(resolve => { complete = resolve }))
  const pending = scanNativePairingCode(labels)
  try {
    await assert.rejects(scanNativePairingCode(labels), /already active/)
    assert.equal(scan.mock.callCount(), 1)
  } finally {
    complete({ ScanResult: 'first', format: 0 })
  }
  assert.equal(await pending, 'first')
  const retry = scanNativePairingCode(labels)
  complete({ ScanResult: 'second', format: 0 })
  assert.equal(await retry, 'second')
})
