import assert from 'node:assert/strict'
import test from 'node:test'

import { syncAppStreamScreenshots } from '../../_scripts/syncAppStreamScreenshots.mjs'

const revision = '1234567890abcdef1234567890abcdef12345678'
const before = '<?xml version="1.0"?>\n<component>\n  <id>org.opentubex.OpenTubeX</id>\n  '
const after = '\n  <releases><release version="0.33.0-beta"/></releases>\n</component>\n'
const metainfo = `${before}<screenshots>
    <screenshot type="default">
      <image type="source" width="1882" height="1198">https://example.com/old.png</image>
    </screenshot>
  </screenshots>${after}`

test('replaces old package screenshots with all six committed README images', async () => {
  const updated = await syncAppStreamScreenshots(metainfo, revision)
  assert.ok(updated.startsWith(before))
  assert.ok(updated.endsWith(after))
  assert.doesNotMatch(updated, /example\.com|1882|1198/)
  assert.equal(updated.match(/<screenshot[ >]/g).length, 6)
  assert.equal(updated.match(/<screenshot type="default">/g).length, 1)
  assert.equal(updated.match(/width="1710" height="1026"/g).length, 6)
  for (const view of [1, 2, 3]) {
    for (const theme of ['dark', 'light']) {
      assert.ok(updated.includes(`https://raw.githubusercontent.com/OpenTubeX/OpenTubeX/${revision}/docs/screenshots/OpenTubeX${view}-${theme}.png`))
    }
  }
})

test('is idempotent and updates an existing gallery to a newer screenshot revision', async () => {
  const updated = await syncAppStreamScreenshots(metainfo, revision)
  assert.equal(await syncAppStreamScreenshots(updated, revision), updated)
  const nextRevision = 'abcdef1234567890abcdef1234567890abcdef12'
  const next = await syncAppStreamScreenshots(updated, nextRevision)
  assert.equal(next.split(nextRevision).length - 1, 6)
  assert.ok(!next.includes(revision))
})

test('rejects mutable refs and missing or ambiguous galleries', async () => {
  await assert.rejects(syncAppStreamScreenshots(metainfo, 'development'), /full Git commit SHA/)
  await assert.rejects(syncAppStreamScreenshots('<component/>', revision), /exactly one/)
  await assert.rejects(syncAppStreamScreenshots(metainfo + metainfo, revision), /exactly one/)
})
