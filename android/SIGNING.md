# Android signing

Debug and optimized nightly APKs use `nightly.keystore`. Its credentials are public by design. Preview builds use separate application IDs so they cannot update the production `org.opentubex.app` package or access its private data. This key must never sign an APK offered as an official release.

| Build | Command from `android/` | Application ID | Launcher name |
| --- | --- | --- | --- |
| Local development | `./gradlew assembleDebug` | `org.opentubex.app.dev` | OpenTubeX Dev |
| Published preview | `./gradlew assembleNightly` | `org.opentubex.app.nightly` | OpenTubeX Nightly |

CI explicitly selects the nightly identity. Local builds default to Dev even when version environment variables are set, so F-Droid and Obtainium cannot replace a local test build with a published nightly. Dev uses a cyan flask badge; Nightly keeps its amber wrench. Both include monochrome themed icons. Local debug APKs are written to `app/build/outputs/apk/debug/app-debug.apk`; nightly APKs use `app/build/outputs/apk/nightly/`.

CI builds `:app:assembleNightly -PsplitApks` for previews and `:app:assembleRelease -PsplitApks` for official releases. Both enable code and resource shrinking and produce standalone ARM64, ARMv7, x86, x86_64 and universal APKs. They share the version code within each build, so switching between the universal APK and a compatible architecture APK preserves update compatibility. Local debug builds remain unoptimized and produce one APK.

`python3 _scripts/android_apks.py android/app/build/outputs/apk/nightly android-apks` validates the complete output set, stages the download filenames and prints a size breakdown. Use the `release` directory and `--release` for production. The existing universal release filename remains `org.opentubex.app-VERSION-alpha.apk`. CI rejects APKs over 65 MiB per architecture or 200 MiB universal; adjust these budgets deliberately when adding runtime dependencies.

Dev installs alongside Nightly and production with its own settings, subscriptions, history and files. The first Dev installation starts fresh; existing Nightly data stays in Nightly and is not copied automatically. Further Dev APKs update the Dev installation.

After syncing Capacitor, verify the package IDs, launcher names, instrumentation IDs and preview signing key from the repository root:

```sh
./android/gradlew -p android -I ../tests/android/build-identity.init.gradle verifyBuildIdentity
./android/gradlew -p android -I ../tests/android/build-identity.init.gradle verifyBuildIdentity -PtestBuildType=nightly
```

Launch a local build for Android user 0 with:

```sh
adb -s DEVICE_SERIAL shell am start --user 0 \
  -n org.opentubex.app.dev/org.opentubex.app.MainActivity
```

Release builds require the private OpenTubeX Android release key. Gradle refuses to run a release task unless both environment variables are present:

- `ANDROID_RELEASE_KEYSTORE`: absolute path to the private keystore
- `ANDROID_RELEASE_STORE_PASSWORD`: keystore password

The key alias is `opentubex-android-release`. The key password and keystore password are the same.

GitHub Actions stores the same material in these repository secrets:

- `ANDROID_RELEASE_KEYSTORE_BASE64`: base64-encoded keystore
- `ANDROID_RELEASE_KEYSTORE_PASSWORD`: keystore password

The private keystore and its password are permanent release assets. Losing either one prevents publishing updates that install over existing OpenTubeX Android releases. Keep at least two encrypted backups in separate locations and test recovery before the first public release.

APK signature fingerprints can be checked with:

```sh
keytool -printcert -jarfile app-release.apk
```
