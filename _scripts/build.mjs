import { Arch, build, Platform } from 'electron-builder'
import config from './ebuilder.config.mjs'
import { withWindowsPortable } from './windowsPortable.mjs'

const args = process.argv

let buildRequests
const platform = process.platform

if (platform === 'darwin') {
  let arch = Arch.x64

  if (args[2] === 'arm64') {
    arch = Arch.arm64
  }

  buildRequests = [{
    targets: Platform.MAC.createTarget(['DMG', 'zip', '7z'], arch),
    config
  }]
} else if (platform === 'win32') {
  let arch = Arch.x64

  if (args[2] === 'arm64') {
    arch = Arch.arm64
    buildRequests = [{
      targets: Platform.WINDOWS.createTarget(['nsis'], arch),
      config
    }]
  } else {
    buildRequests = [
      {
        targets: Platform.WINDOWS.createTarget(['nsis'], arch),
        config
      },
      {
        targets: Platform.WINDOWS.createTarget(['zip', '7z'], arch),
        config: withWindowsPortable(config)
      }
    ]
  }
} else if (platform === 'linux') {
  let arch = Arch.x64

  if (args[2] === 'arm64') {
    arch = Arch.arm64
  }

  if (args[2] === 'arm32') {
    arch = Arch.armv7l
  }

  buildRequests = [{
    targets: Platform.LINUX.createTarget(['deb', 'zip', '7z', 'rpm', 'AppImage', 'pacman'], arch),
    config
  }]
}

const outputs = []
for (const request of buildRequests) {
  outputs.push(...await build({ ...request, publish: 'never' }))
}
console.log(outputs)
