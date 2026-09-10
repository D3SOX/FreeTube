import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
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
  const buildEnd = workflow.indexOf('    - name: Upload Android', buildStart)
  const build = workflow.slice(buildStart, buildEnd)

  const packageVersionUpdate = build.indexOf("jq --arg version \"$version\" '.version = $version' package.json")
  const capacitorBuild = build.indexOf('pnpm run capacitor:sync:android')

  assert.notEqual(packageVersionUpdate, -1)
  assert.ok(packageVersionUpdate < capacitorBuild)
  assert.match(
    build,
    /gradlew --project-dir android :app:assembleNightly -PsplitApks\s+\\\s+-I \.\.\/tests\/android\/build-identity\.init\.gradle\s+verifyBuildIdentity/
  )
})

test('publishes all architecture APKs alongside the existing desktop artifacts', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'android-nightly-assets-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const version = '0.34.0-nightly-1234'
  const desktopName = `opentubex-${version}-amd64.AppImage`
  const desktop = join(directory, 'artifacts', desktopName)
  await mkdir(desktop, { recursive: true })
  await writeFile(join(desktop, 'app.AppImage'), 'desktop')
  const names = ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64', 'universal'].map(
    abi => `opentubex-${version}-android-${abi}.apk`
  )
  const workflow = load(await readFile('.github/workflows/build.yml', 'utf8'))
  const uploads = workflow.jobs.android.steps.filter(step => step.uses?.startsWith('actions/upload-artifact@'))
  assert.equal(uploads.length, names.length, 'Each APK must have its own artifact, with no report artifact')
  const uploadedNames = []
  for (const upload of uploads) {
    assert.equal(upload.with.archive, undefined, 'APK downloads must use the default ZIP artifact archive')
    assert.equal(upload.with['if-no-files-found'], 'error')
    const path = upload.with.path.replace('${{ steps.apk.outputs.version }}', version)
    const name = upload.with.name.replace('${{ steps.apk.outputs.version }}', version)
    assert.equal(path.split('/').pop(), name)
    uploadedNames.push(name)
    const artifact = join(directory, 'artifacts', name)
    await mkdir(artifact)
    await writeFile(join(artifact, name), name)
  }
  assert.deepEqual(uploadedNames.sort(), names.sort())
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
  await writeFile(join(desktop, 'unexpected.txt'), 'unexpected')
  const incomplete = run()
  assert.notEqual(incomplete.status, 0)
  assert.match(incomplete.stderr, /Expected one file/)
})

for (const file of ['build', 'release']) {
  test(`${file} workflow omits Android build summaries and shrinking report uploads`, async () => {
    const workflow = load(await readFile(`.github/workflows/${file}.yml`, 'utf8'))
    const steps = Object.values(workflow.jobs).flatMap(job => job.steps ?? [])
    const build = steps.find(step => step.name === 'Build signed Android APKs')
    assert.doesNotMatch(build.run, /GITHUB_STEP_SUMMARY/)
    const uploads = steps.filter(step => step.uses?.startsWith('actions/upload-artifact@'))
    assert.ok(uploads.every(step => !/shrinking|mapping/.test(`${step.with.name} ${step.with.path}`)))
  })
}

test('stable releases build both Android identities and sort between nightlies by version code', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'android-stable-promotion-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(join(directory, 'android'))
  await writeFile(join(directory, 'package.json'), JSON.stringify({ version: '0.35.0' }))
  const stubs = {
    git: '#!/bin/sh\necho 12345\n',
    pnpm: '#!/bin/sh\nexit 0\n',
    'android/gradlew': '#!/bin/sh\nprintf "%s|%s|%s\\n" "$*" "$ANDROID_VERSION_CODE" "$ANDROID_VERSION_NAME" >> gradle.log\n',
    python3: '#!/bin/sh\nprintf "%s\\n" "$*" >> packaging.log\n'
  }
  for (const [name, script] of Object.entries(stubs)) {
    await writeFile(join(directory, name), script)
    await chmod(join(directory, name), 0o755)
  }
  const workflow = load(await readFile('.github/workflows/release.yml', 'utf8'))
  const build = workflow.jobs.build.steps.find(step => step.name === 'Build signed Android APKs')
  const result = spawnSync('bash', ['-c', build.run], {
    cwd: directory,
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      ANDROID_RELEASE_KEYSTORE_BASE64: Buffer.from('fixture').toString('base64'),
      ANDROID_RELEASE_STORE_PASSWORD: 'fixture',
      ANDROID_RELEASE_KEYSTORE: join(directory, 'android/release.keystore')
    },
    encoding: 'utf8'
  })
  assert.equal(result.status, 0, result.stderr)
  const invocations = (await readFile(join(directory, 'gradle.log'), 'utf8')).trim().split('\n')
  const stableCode = Number(invocations[0].split('|')[1])
  for (const variant of ['Release', 'Nightly']) {
    const invocation = invocations.find(line => line.includes(`:app:assemble${variant}`))
    assert.ok(invocation, `Stable releases must build the ${variant} identity`)
    assert.ok(invocation.endsWith(`|${stableCode}|0.35.0`))
  }
  const packaging = await readFile(join(directory, 'packaging.log'), 'utf8')
  assert.match(packaging, /apk\/release android-apks --release/)
  assert.match(packaging, /apk\/nightly android-nightly-apks\n/)

  const nightlyWorkflow = load(await readFile('.github/workflows/build.yml', 'utf8'))
  const nightlyBuild = nightlyWorkflow.jobs.android.steps.find(step => step.name === 'Build signed Android APKs')
  for (const commitCount of [12345, 12346]) {
    await writeFile(join(directory, 'git'), `#!/bin/sh\necho ${commitCount}\n`)
    await writeFile(join(directory, 'gradle.log'), '')
    await writeFile(join(directory, 'package.json'), JSON.stringify({ version: '0.35.0' }))
    const nightly = spawnSync('bash', ['-c', nightlyBuild.run], {
      cwd: directory,
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        GITHUB_REF: 'refs/heads/development',
        GITHUB_RUN_NUMBER: '1234',
        GITHUB_OUTPUT: join(directory, 'output')
      },
      encoding: 'utf8'
    })
    assert.equal(nightly.status, 0, nightly.stderr)
    const nightlyCode = Number((await readFile(join(directory, 'gradle.log'), 'utf8')).split('|')[1])
    assert.ok(commitCount === 12345 ? nightlyCode < stableCode : nightlyCode > stableCode,
      'Stable promotion must update the same-commit nightly and accept the next nightly update')
  }
})

test('stable releases attach both Android identities with distinct filenames', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'android-release-assets-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const source = join(directory, 'android-apks')
  await mkdir(source)
  const nightlySource = join(directory, 'android-nightly-apks')
  await mkdir(nightlySource)
  const names = ['', '-arm64-v8a', '-armeabi-v7a', '-x86', '-x86_64'].map(
    suffix => `org.opentubex.app-0.34.0-alpha${suffix}.apk`
  )
  for (const name of names) await writeFile(join(source, name), name)
  const nightlyNames = ['universal', 'arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'].map(
    abi => `opentubex-0.34.0-android-${abi}.apk`
  )
  for (const name of nightlyNames) await writeFile(join(nightlySource, name), name)
  const workflow = load(await readFile('.github/workflows/release.yml', 'utf8'))
  const prepare = workflow.jobs.build.steps.find(step => step.name === 'Prepare release assets')
  const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', prepare.run], {
    cwd: directory,
    env: { ...process.env, RUNTIME: 'android', VERSION: '0.34.0' },
    encoding: 'utf8'
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual((await readdir(join(directory, 'release-assets'))).sort(), [...names, ...nightlyNames].sort())
  for (const name of [...names, ...nightlyNames]) {
    assert.equal(await readFile(join(directory, 'release-assets', name), 'utf8'), name)
  }
  const upload = workflow.jobs.build.steps.find(step => step.name === 'Upload release assets')
  assert.equal(upload.with.files, 'release-assets/*')
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

        assert.deepEqual(
          png.subarray(0, 8),
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        )
        assert.equal(png.readUInt32BE(16), size)
        assert.equal(png.readUInt32BE(20), size)
      }
    }
  })
}
