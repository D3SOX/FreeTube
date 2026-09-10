import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_ICON_PRESETS } from '../../src/appIconPresets.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const write = (path, content) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}
const namespace = 'http://schemas.android.com/apk/res/android'
const master = readFileSync(join(root, '_scripts/brand/icon-master.svg'), 'utf8')

for (const [source, suffix, artwork] of [
  ['main', '', 'master'], ['dev', '_dev', 'dev'], ['debug', '_nightly', 'nightly']
]) {
  const res = join(root, 'android/app/src', source, 'res')
  const monochrome = readFileSync(join(res, `drawable/ic_launcher${suffix}_monochrome.xml`), 'utf8')
  const previews = join(root, 'static/app-icons', source)
  write(join(res, 'values/app_icon_variant.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources><string name="app_icon_variant" translatable="false">${source}</string></resources>\n`)
  const defaultIcon = readFileSync(join(root, `_scripts/brand/icon-${artwork}.svg`), 'utf8')
    .replace(/<image\b[^>]+\/>/, master.replace(/<svg\b[^>]*>|<\/svg>/g, ''))
    .replace(/[ \t]+$/gm, '')
  write(join(previews, 'default.svg'), defaultIcon)
  for (const { id, foreground, background } of APP_ICON_PRESETS.slice(1)) {
    const resource = `ic_preset_${id.toLowerCase()}`
    const vector = monochrome.replace(/android:fillColor="[^"]+"/g, `android:fillColor="${foreground}"`)
    write(join(res, `drawable/${resource}.xml`), vector)
    if (source === 'main') {
      for (const version of [26, 33]) {
        write(join(res, `mipmap-anydpi-v${version}/${resource}.xml`), `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="${namespace}">
    <background android:drawable="@color/${resource}" />
    <foreground android:drawable="@drawable/${resource}" />
${version === 33 ? '    <monochrome android:drawable="@drawable/ic_preset_monochrome" />\n' : ''}</adaptive-icon>
`)
      }
    }
    // Use the exact Android geometry, including Dev/Nightly badges, in previews.
    const groups = [...vector.matchAll(/<group\b([\s\S]*?)>([\s\S]*?)<\/group>/g)].map(([, attributes, paths]) => {
      const attr = name => attributes.match(new RegExp(`android:${name}="([^"]+)"`))?.[1] ?? '0'
      const svgPaths = [...paths.matchAll(/android:pathData="([^"]+)"/g)]
        .map(([, d]) => `<path d="${d}"/>`).join('')
      return `<g transform="translate(${attr('translateX')} ${attr('translateY')}) scale(${attr('scaleX')} ${attr('scaleY')})">${svgPaths}</g>`
    }).join('')
    write(join(previews, `${id}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" rx="230.4" fill="${background}"/><g fill="${foreground}">${groups}</g></svg>\n`)
  }
  write(join(res, 'drawable/ic_preset_monochrome.xml'), monochrome)
}

write(join(root, 'android/app/src/main/res/values/app_icon_presets.xml'), `<?xml version="1.0" encoding="utf-8"?>
<resources>
${APP_ICON_PRESETS.slice(1).map(({ id, background }) => `    <color name="ic_preset_${id.toLowerCase()}">${background}</color>`).join('\n')}
</resources>
`)

const manifestPath = join(root, 'android/app/src/main/AndroidManifest.xml')
const aliases = APP_ICON_PRESETS.map(({ id }) => {
  const icon = id === 'default' ? 'ic_launcher' : `ic_preset_${id.toLowerCase()}`
  const round = id === 'default' ? 'ic_launcher_round' : icon
  return `        <activity-alias
            android:name="org.opentubex.app.launcher.${id}"
            android:targetActivity=".LauncherActivity"
            android:enabled="${id === 'default'}"
            android:exported="true"
            android:label="@string/app_name"
            android:icon="@mipmap/${icon}"
            android:roundIcon="@mipmap/${round}">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity-alias>`
}).join('\n\n')
const manifest = readFileSync(manifestPath, 'utf8')
write(manifestPath, manifest.replace(/ {8}<!-- App icon presets:start -->[\s\S]*? {8}<!-- App icon presets:end -->/,
  `        <!-- App icon presets:start -->\n${aliases}\n        <!-- App icon presets:end -->`))
