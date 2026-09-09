import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const script = fileURLToPath(new URL('../../_scripts/testWindowsPortableTrace.ps1', import.meta.url))

function replayTrace(t, stress = false) {
  const result = spawnSync('pwsh', [
    '-NoProfile', '-File', script, ...(stress ? ['-Stress'] : [])
  ], {
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, DOTNET_GCHeapHardLimit: '0x6000000' }
  })
  if (result.error?.code === 'ENOENT' && process.platform !== 'win32') {
    t.skip('PowerShell is required to replay Windows portable traces')
    return
  }
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /Windows portable trace replay tests passed/)
}

test('portable trace replay detects registry and file writes and rejects broken XML', t => {
  replayTrace(t)
})

test('portable trace replay checks the final event without loading the entire trace into memory', t => {
  replayTrace(t, true)
})
