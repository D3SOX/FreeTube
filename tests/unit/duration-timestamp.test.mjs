import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

// Load the actual formatter without the renderer's router and native dependencies.
const source = await readFile(new URL('../../src/renderer/helpers/utils.js', import.meta.url), 'utf8')
const formatter = source.match(/export function formatDurationAsTimestamp\([^]*?\n\}/)[0].replace('export ', '')
const formatDurationAsTimestamp = vm.runInNewContext(`${formatter}\nformatDurationAsTimestamp`)

test('formats fractional history durations as whole-second timestamps', () => {
  const examples = [
    [4125.721, '1:08:45'],
    [153.839, '2:33'],
    [125.109, '2:05'],
    [116.889, '1:56'],
    [104.768, '1:44'],
  ]

  for (const [duration, expected] of examples) {
    assert.equal(formatDurationAsTimestamp(duration), expected)
  }
})

test('does not round fractional durations into the next second, minute, or hour', () => {
  for (const [duration, expected] of [
    [0.999, '0:00'],
    [9.999, '0:09'],
    [59.999, '0:59'],
    [60.001, '1:00'],
    [3599.999, '59:59'],
    [3600.001, '1:00:00'],
  ]) {
    assert.equal(formatDurationAsTimestamp(duration), expected)
  }
})

test('preserves whole-second timestamps and string labels', () => {
  for (const [duration, expected] of [
    [0, '0:00'],
    [5, '0:05'],
    [60, '1:00'],
    [3600, '1:00:00'],
    [3661, '1:01:01'],
    ['LIVE', 'LIVE'],
    ['UPCOMING', 'UPCOMING'],
    ['1:23', '1:23'],
    ['', ''],
  ]) {
    assert.equal(formatDurationAsTimestamp(duration), expected)
  }
})
