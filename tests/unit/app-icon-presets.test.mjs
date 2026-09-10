import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import test from 'node:test'
import { APP_ICON_PRESETS } from '../../src/appIconPresets.js'

const root = new URL('../../', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')

test('every app icon preset has a unique launcher alias, translations and packaged artwork', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml')
  const aliases = [...manifest.matchAll(/<activity-alias\b[\s\S]*?<\/activity-alias>/g)].map(([alias]) => alias)
  assert.equal(aliases.length, APP_ICON_PRESETS.length)
  assert.equal(new Set(APP_ICON_PRESETS.map(({ id }) => id)).size, APP_ICON_PRESETS.length)
  assert.equal(aliases.filter(alias => alias.includes('android:enabled="true"')).length, 1)
  assert.doesNotMatch(manifest.match(/<activity\b[\s\S]*?<\/activity>/)[0], /android.intent.category.LAUNCHER/)
  for (const { id, translationKey, foreground, background } of APP_ICON_PRESETS) {
    const alias = aliases.find(alias => alias.includes(`org.opentubex.app.launcher.${id}"`))
    assert.ok(alias, id)
    assert.match(alias, /android:targetActivity=".LauncherActivity"/)
    for (const variant of ['main', 'dev', 'debug']) {
      const svg = read(`static/app-icons/${variant}/${id}.svg`)
      assert.match(svg, /<path /)
      assert.doesNotMatch(svg, /<image\b/, 'SVG image previews must be self-contained, including Dev/Nightly backgrounds')
      if (id === 'default') continue
      assert.match(svg, new RegExp(`fill="${foreground}"`))
      assert.match(svg, new RegExp(`fill="${background}"`))
      assert.ok(existsSync(new URL(`android/app/src/${variant}/res/drawable/ic_preset_${id.toLowerCase()}.xml`, root)))
    }
    if (id === 'default') continue
    assert.ok(translationKey, id)
    for (const version of [26, 33]) {
      const adaptive = read(`android/app/src/main/res/mipmap-anydpi-v${version}/ic_preset_${id.toLowerCase()}.xml`)
      assert.match(adaptive, /<adaptive-icon/)
      if (version === 33) assert.match(adaptive, /@drawable\/ic_preset_monochrome/)
    }
  }
})
