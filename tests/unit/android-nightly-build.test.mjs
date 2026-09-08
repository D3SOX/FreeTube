import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { load } from 'js-yaml'

test('the Obtainium nightly link allows architecture APKs and the universal fallback', async () => {
  const readme = await readFile('README.md', 'utf8')
  const encoded = readme.match(/obtainium:\/\/app\/([^)]*)/)[1]
  const app = JSON.parse(decodeURIComponent(encoded))
  const settings = JSON.parse(app.additionalSettings)
  const filter = new RegExp(settings.apkFilterRegEx)

  assert.equal(app.id, 'org.opentubex.app.nightly')
  assert.equal(settings.includePrereleases, true)
  assert.equal(settings.fallbackToOlderReleases, true)
  assert.equal(settings.filterReleaseTitlesByRegEx, 'nightly')
  for (const abi of ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64', 'universal']) {
    assert.ok(filter.test(`opentubex-0.34.0-nightly-1234-android-${abi}.apk`), abi)
  }
  assert.ok(!filter.test('org.opentubex.app-0.34.0-alpha-arm64-v8a.apk'))
  assert.ok(!filter.test('opentubex-0.34.0-nightly-1234-android-arm64-v8a.apk.sha256'))
  assert.equal(settings.autoApkFilterByArch, true)
})

test('embeds the generated nightly version in the Android web bundle', async () => {
  const workflow = await readFile('.github/workflows/build.yml', 'utf8')
  const buildStart = workflow.indexOf('    - name: Build signed Android APKs')
  const buildEnd = workflow.indexOf('    - name: Upload Android APKs', buildStart)
  const build = workflow.slice(buildStart, buildEnd)

  const packageVersionUpdate = build.indexOf("jq --arg version \"$version\" '.version = $version' package.json")
  const capacitorBuild = build.indexOf('pnpm run capacitor:sync:android')

  assert.notEqual(packageVersionUpdate, -1)
  assert.ok(packageVersionUpdate < capacitorBuild)
  assert.match(build, /gradlew --project-dir android :app:assembleNightly -PsplitApks/)
})

test('publishes all architecture APKs alongside the existing desktop artifacts', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'android-nightly-assets-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const androidName = 'opentubex-0.34.0-nightly-1234-android-apks'
  const desktopName = 'opentubex-0.34.0-nightly-1234-amd64.AppImage'
  const android = join(directory, 'artifacts', androidName)
  const desktop = join(directory, 'artifacts', desktopName)
  await mkdir(android, { recursive: true })
  await mkdir(desktop)
  const names = ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64', 'universal'].map(
    abi => `opentubex-0.34.0-nightly-1234-android-${abi}.apk`
  )
  for (const name of names) await writeFile(join(android, name), name)
  await writeFile(join(desktop, 'app.AppImage'), 'desktop')
  const workflow = load(await readFile('.github/workflows/build.yml', 'utf8'))
  const prepare = workflow.jobs['publish-nightly'].steps.find(step => step.name === 'Prepare release assets')
  const run = () => spawnSync('bash', ['-e', '-o', 'pipefail', '-c', prepare.run], {
    cwd: directory,
    encoding: 'utf8'
  })
  const result = run()
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual((await readdir(join(directory, 'release-assets'))).sort(), [...names, desktopName].sort())
  for (const name of names) {
    assert.equal(await readFile(join(directory, 'release-assets', name), 'utf8'), name)
  }

  await rm(join(directory, 'release-assets'), { recursive: true })
  await rm(join(android, names[0]))
  const incomplete = run()
  assert.notEqual(incomplete.status, 0)
  assert.match(incomplete.stderr, /Expected five Android APKs/)
})

for (const [channel, resourceDir, badge] of [['nightly', 'debug', 'wrench'], ['dev', 'dev', 'flask']]) {
  test(`gives Android ${channel} builds their ${badge} launcher icon`, async () => {
    const icon = await readFile(
      `android/app/src/${resourceDir}/res/drawable/ic_launcher_${channel}_foreground.xml`,
      'utf8'
    )

    assert.ok(icon.includes(badge))

    for (const api of [26, 33]) {
      for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
        const adaptiveIcon = await readFile(
          `android/app/src/${resourceDir}/res/mipmap-anydpi-v${api}/${name}`,
          'utf8'
        )

        assert.ok(adaptiveIcon.includes(`@drawable/ic_launcher_${channel}_foreground`))
        if (api === 33) {
          assert.ok(adaptiveIcon.includes(`@drawable/ic_launcher_${channel}_monochrome`))
        }
      }
    }

    for (const [density, size] of Object.entries({
      mdpi: 48,
      hdpi: 72,
      xhdpi: 96,
      xxhdpi: 144,
      xxxhdpi: 192
    })) {
      for (const name of ['ic_launcher.png', 'ic_launcher_round.png']) {
        const png = await readFile(
          `android/app/src/${resourceDir}/res/mipmap-${density}/${name}`
        )

        assert.equal(png.subarray(1, 4).toString(), 'PNG')
        assert.equal(png.readUInt32BE(16), size)
        assert.equal(png.readUInt32BE(20), size)
      }
    }
  })
}
