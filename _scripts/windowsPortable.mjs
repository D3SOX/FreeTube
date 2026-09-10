import { getWindowsPortableExtraFiles } from './windowsInterposer.mjs'

export function withWindowsPortable (config) {
  return {
    ...config,
    files: [...(config.files ?? [])],
    extraFiles: [
      ...(config.extraFiles ?? []),
      ...getWindowsPortableExtraFiles('win32')
    ]
  }
}
