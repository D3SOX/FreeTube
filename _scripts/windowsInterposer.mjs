import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const WINDOWS_INTERPOSER_VERSION = '1.1.0'
export const WINDOWS_INTERPOSER_COMMIT = '374aa10a904532acc7bb72f656cea1dcf1eefa14'
export const WINDOWS_INTERPOSER_PATCH_SHA256 = '48a9c0ac85cdda21be249d8b5f6f16608f4dcefdffef4f5e8938ee5a4c95eba2'

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)
const sourceDirectory = path.join(
  repositoryRoot,
  '_scripts',
  'windows-interposer'
)
// Keep the checkout short enough for Windows build tools without long-path support.
const cacheKey = sha256(Buffer.concat([
  Buffer.from(WINDOWS_INTERPOSER_COMMIT + WINDOWS_INTERPOSER_PATCH_SHA256),
  ...['registry.cpp', 'registry.h'].map(name => readFileSync(path.join(sourceDirectory, name)))
])).slice(0, 24)
const cacheDirectory = path.join(
  repositoryRoot,
  '.cache',
  'windows-interposer',
  cacheKey
)
const preparedProxyPath = path.join(cacheDirectory, 'version.dll')
const checkoutDirectory = path.join(cacheDirectory, 'source')
const patchPath = path.join(sourceDirectory, 'native-registry.patch')
const interposerRepository = 'https://github.com/LANCommander/LANCommander.Interposer.git'
const dosHeaderSignature = 0x5A4D
const peHeaderOffsetPosition = 0x3C
const peHeaderSignature = 0x00004550
const peSignatureSize = 4
const coffHeaderSize = 20
const coffOptionalHeaderSizeOffset = 16
const coffCharacteristicsOffset = 18
const pe32PlusMinimumHeaderSize = 112
const pe32PlusMagic = 0x20B
const windowsX64Machine = 0x8664
const imageFileDll = 0x2000

function sha256 (contents) {
  return createHash('sha256').update(contents).digest('hex')
}

function assertSha256 (contents, expected, name) {
  const actual = sha256(contents)
  if (actual !== expected) {
    throw new Error(`${name} has SHA-256 ${actual}; expected ${expected}`)
  }
}

export function verifyWindowsX64Dll (contents) {
  if (contents.length < 0x40 || contents.readUInt16LE(0) !== dosHeaderSignature) {
    throw new Error('LANCommander Interposer is not a Windows PE file')
  }

  const peHeaderOffset = contents.readUInt32LE(peHeaderOffsetPosition)
  const coffHeaderOffset = peHeaderOffset + peSignatureSize
  if (coffHeaderOffset + coffHeaderSize > contents.length ||
      contents.readUInt32LE(peHeaderOffset) !== peHeaderSignature) {
    throw new Error('LANCommander Interposer has an invalid PE header')
  }
  if (contents.readUInt16LE(coffHeaderOffset) !== windowsX64Machine) {
    throw new Error('LANCommander Interposer is not an x64 DLL')
  }
  const characteristics = contents.readUInt16LE(
    coffHeaderOffset + coffCharacteristicsOffset
  )
  if ((characteristics & imageFileDll) === 0) {
    throw new Error('LANCommander Interposer is not a DLL')
  }
  const optionalHeaderOffset = coffHeaderOffset + coffHeaderSize
  const optionalHeaderSize = contents.readUInt16LE(coffHeaderOffset + coffOptionalHeaderSizeOffset)
  if (optionalHeaderSize < pe32PlusMinimumHeaderSize ||
      optionalHeaderOffset + optionalHeaderSize > contents.length ||
      contents.readUInt16LE(optionalHeaderOffset) !== pe32PlusMagic) {
    throw new Error('LANCommander Interposer has an invalid PE32+ optional header')
  }
}

function runBuildCommand (command, args, cwd = repositoryRoot) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.status !== 0) {
    const reason = result.error?.message ?? `exit code ${result.status}`
    throw new Error(`Could not build LANCommander Interposer with ${command}: ${reason}`)
  }
}

function readCommandOutput (command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    const reason = result.error?.message ?? result.stderr?.trim() ?? `exit code ${result.status}`
    throw new Error(`Could not inspect LANCommander Interposer with ${command}: ${reason}`)
  }
  return result.stdout.trim()
}

async function buildWindowsInterposer () {
  const patch = Buffer.from((await readFile(patchPath, 'utf8')).replaceAll('\r\n', '\n'))
  assertSha256(patch, WINDOWS_INTERPOSER_PATCH_SHA256, 'OpenTubeX Interposer patch')
  const normalizedPatchPath = path.join(cacheDirectory, 'native-registry.patch')
  await writeFile(normalizedPatchPath, patch)

  await rm(checkoutDirectory, { recursive: true, force: true })
  runBuildCommand('git', [
    'clone', '--branch', `v${WINDOWS_INTERPOSER_VERSION}`, '--depth', '1',
    '--single-branch', interposerRepository, checkoutDirectory
  ])

  const commit = readCommandOutput('git', ['rev-parse', 'HEAD'], checkoutDirectory)
  if (commit !== WINDOWS_INTERPOSER_COMMIT) {
    throw new Error(`LANCommander Interposer resolved to ${commit}; expected ${WINDOWS_INTERPOSER_COMMIT}`)
  }
  runBuildCommand('git', ['apply', '--check', normalizedPatchPath], checkoutDirectory)
  runBuildCommand('git', ['apply', normalizedPatchPath], checkoutDirectory)
  await copyFile(path.join(sourceDirectory, 'registry.cpp'), path.join(checkoutDirectory, 'LANCommander.Interposer/dll/src/registry.cpp'))
  await copyFile(path.join(sourceDirectory, 'registry.h'), path.join(checkoutDirectory, 'LANCommander.Interposer/dll/src/registry.h'))

  const dependenciesDirectory = path.join(checkoutDirectory, 'vcpkg_installed')
  runBuildCommand('vcpkg', [
    'install', '--triplet', 'x64-windows-static-md',
    '--overlay-triplets', path.join(checkoutDirectory, 'triplets'),
    '--x-install-root', dependenciesDirectory
  ], checkoutDirectory)
  runBuildCommand('msbuild', [
    'LANCommander.Interposer.slnx',
    '/t:LANCommander_Interposer',
    '/p:Configuration=Release',
    '/p:Platform=x64'
  ], checkoutDirectory)

  const builtProxyPath = path.join(
    checkoutDirectory,
    'Release',
    'Injector',
    'x64',
    'LANCommander.Interposer.dll'
  )
  const builtProxy = await readFile(builtProxyPath)
  verifyWindowsX64Dll(builtProxy)
  const temporaryProxyPath = `${preparedProxyPath}.tmp`
  await copyFile(builtProxyPath, temporaryProxyPath)
  await rm(preparedProxyPath, { force: true })
  await rename(temporaryProxyPath, preparedProxyPath)
}

export async function prepareWindowsInterposer (platform = process.platform) {
  if (platform !== 'win32') return

  await mkdir(cacheDirectory, { recursive: true })
  if (existsSync(preparedProxyPath)) {
    const preparedProxy = await readFile(preparedProxyPath)
    verifyWindowsX64Dll(preparedProxy)
    return
  }
  await buildWindowsInterposer()
}

export function getWindowsPortableExtraFiles (
  platform = process.platform,
  architecture = 'x64'
) {
  if (platform !== 'win32') return []
  if (architecture !== 'x64') {
    throw new Error(`LANCommander Interposer does not support Windows ${architecture}`)
  }

  return [
    { from: preparedProxyPath, to: 'version.dll' },
    { from: path.join(sourceDirectory, 'Config.yml'), to: '.interposer/Config.yml' },
    { from: path.join(sourceDirectory, 'LICENSE.txt'), to: 'LANCommander.Interposer.LICENSE.txt' },
    { from: path.join(repositoryRoot, '_scripts/windows-portable.marker'), to: 'portable.marker' }
  ]
}
