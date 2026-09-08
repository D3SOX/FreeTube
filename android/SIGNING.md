# Android signing

Debug and optimized nightly APKs use `nightly.keystore`. Its credentials are public by design, so both variants use the separate `org.opentubex.app.nightly` application ID. This prevents a publicly signed APK from updating the production `org.opentubex.app` package or accessing its private data. The nightly identity is for preview builds only and must never sign an APK offered as an official release.

CI builds `:app:assembleNightly -PsplitApks` for previews and `:app:assembleRelease -PsplitApks` for official releases. Both enable code and resource shrinking and produce standalone ARM64, ARMv7, x86, x86_64 and universal APKs. They share the version code within each build, so switching between the universal APK and a compatible architecture APK preserves update compatibility. Local debug builds remain unoptimized and produce one APK.

`python3 _scripts/android_apks.py android/app/build/outputs/apk/nightly android-apks` validates the complete output set, stages the download filenames and prints a size breakdown. Use the `release` directory and `--release` for production. The existing universal release filename remains `org.opentubex.app-VERSION-alpha.apk`. CI rejects APKs over 65 MiB per architecture or 200 MiB universal; adjust these budgets deliberately when adding runtime dependencies.

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
