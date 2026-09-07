import {
  CapacitorBarcodeScanner,
  CapacitorBarcodeScannerAndroidScanningLibrary,
  CapacitorBarcodeScannerCameraDirection,
  CapacitorBarcodeScannerScanOrientation,
  CapacitorBarcodeScannerTypeHint,
} from '@capacitor/barcode-scanner'

let scanning = false

export async function scanNativePairingCode({ instructions, cancelLabel, torchOnLabel, torchOffLabel }) {
  // Native scanning owns a separate screen and cannot be stopped from JS.
  // Keep ownership until it returns, including when the pairing view unmounts.
  if (scanning) throw new Error('A native pairing scan is already active')
  scanning = true
  try {
    const result = await CapacitorBarcodeScanner.scanBarcode({
      hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
      cameraDirection: CapacitorBarcodeScannerCameraDirection.BACK,
      scanOrientation: CapacitorBarcodeScannerScanOrientation.ADAPTIVE,
      scanInstructions: instructions,
      scanButton: false,
      cancelButtonAccessibilityLabel: cancelLabel,
      torchButtonOnAccessibilityLabel: torchOnLabel,
      torchButtonOffAccessibilityLabel: torchOffLabel,
      android: { scanningLibrary: CapacitorBarcodeScannerAndroidScanningLibrary.ZXING },
    })
    return result.ScanResult
  } catch (error) {
    if (error?.code === 'OS-PLUG-BARC-0006') return null
    throw error
  } finally {
    scanning = false
  }
}
