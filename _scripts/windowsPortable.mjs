import { fileURLToPath } from 'node:url'

export function withWindowsPortable (config) {
  return {
    ...config,
    files: [...(config.files ?? [])],
    extraFiles: [
      ...(config.extraFiles ?? []),
      {
        from: fileURLToPath(new URL('./windows-portable.marker', import.meta.url)),
        to: 'portable.marker'
      }
    ]
  }
}
