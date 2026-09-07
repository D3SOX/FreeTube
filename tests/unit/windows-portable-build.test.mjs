import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import test from 'node:test'
import { withWindowsPortable } from '../../_scripts/windowsPortable.mjs'

test('portable archives include scoped registry isolation without changing the installer', async () => {
  const installedConfig = { files: ['dist/**/*'] }
  const portableConfig = withWindowsPortable(installedConfig)

  assert.equal(installedConfig.extraFiles, undefined)
  assert.notEqual(portableConfig.files, installedConfig.files)
  assert.deepEqual(portableConfig.files, installedConfig.files)
  assert.deepEqual(portableConfig.extraFiles.map(file => file.to), [
    'version.dll', '.interposer/Config.yml', 'LANCommander.Interposer.LICENSE.txt', 'portable.marker'
  ])
  for (const file of portableConfig.extraFiles.filter(file => file.to !== 'version.dll')) {
    await access(file.from)
  }
})

test('portable packaging preserves existing extra files without changing the installer', () => {
  const installedConfig = {
    extraFiles: [{ from: 'shared.txt', to: 'shared.txt' }]
  }
  const portableConfig = withWindowsPortable(installedConfig)

  assert.deepEqual(portableConfig.extraFiles.map(file => file.to), [
    'shared.txt', 'version.dll', '.interposer/Config.yml',
    'LANCommander.Interposer.LICENSE.txt', 'portable.marker'
  ])
  assert.equal(installedConfig.extraFiles.length, 1)
  assert.equal(installedConfig.files, undefined)
})
