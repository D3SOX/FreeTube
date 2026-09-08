import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location(
    "android_apks", Path(__file__).resolve().parents[2] / "_scripts/android_apks.py"
)
apks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(apks)


class ApkPackagingTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.source = Path(self.temp.name) / "source"
        self.output = Path(self.temp.name) / "output"
        self.source.mkdir()
        self.metadata = dict(applicationId="org.opentubex.app.nightly", elements=[])
        for abi in sorted(apks.ABIS | {"universal"}):
            name = f"app-{abi}-nightly.apk"
            self.metadata["elements"].append(dict(
                filters=[] if abi == "universal" else [dict(filterType="ABI", value=abi)],
                versionName="0.34.0-nightly-1234", outputFile=name,
            ))
            self.write_apk(name, apks.ABIS if abi == "universal" else {abi})
        self.write_metadata()

    def write_metadata(self):
        (self.source / "output-metadata.json").write_text(json.dumps(self.metadata))

    def write_apk(self, name, abis, build_only=False):
        runtime = io.BytesIO()
        with zipfile.ZipFile(runtime, "w") as archive:
            archive.writestr("usr/lib/runtime.so", b"fixture")
            if build_only:
                archive.writestr("usr/lib/quickjs/libquickjs.a", b"build-only")
        with zipfile.ZipFile(self.source / name, "w") as apk:
            apk.writestr("classes.dex", b"fixture")
            for abi in abis:
                for executable in ("python", "qjs", "ffmpeg", "ffprobe"):
                    apk.writestr(f"lib/{abi}/lib{executable}.so", b"fixture")
                for package in ("python", "ffmpeg"):
                    apk.writestr(f"lib/{abi}/lib{package}.zip.so", runtime.getvalue())

    def test_names_and_reports_all_nightly_apks(self):
        report = apks.prepare(self.source, self.output)
        self.assertEqual(len(list(self.output.glob("*.apk"))), 5)
        for abi in apks.ABIS | {"universal"}:
            self.assertIn(f"opentubex-0.34.0-nightly-1234-android-{abi}.apk", report)

    def test_preserves_universal_release_filename(self):
        self.metadata["applicationId"] = "org.opentubex.app"
        for element in self.metadata["elements"]:
            element["versionName"] = "0.34.0"
        self.write_metadata()
        apks.prepare(self.source, self.output, release=True)
        self.assertTrue((self.output / "org.opentubex.app-0.34.0-alpha.apk").exists())
        self.assertTrue((self.output / "org.opentubex.app-0.34.0-alpha-arm64-v8a.apk").exists())

    def test_rejects_incomplete_set_before_copying(self):
        self.metadata["elements"].pop()
        self.write_metadata()
        with self.assertRaisesRegex(ValueError, "Expected four"):
            apks.prepare(self.source, self.output)
        self.assertFalse(self.output.exists())

    def test_rejects_universal_payload_mislabeled_as_arm64(self):
        self.write_apk("app-arm64-v8a-nightly.apk", apks.ABIS)
        with self.assertRaisesRegex(ValueError, "expected architectures"):
            apks.prepare(self.source, self.output)

    def test_rejects_build_only_runtime_files(self):
        self.write_apk("app-arm64-v8a-nightly.apk", {"arm64-v8a"}, build_only=True)
        with self.assertRaisesRegex(ValueError, "build-only"):
            apks.prepare(self.source, self.output)

    def test_enforces_download_size_budget(self):
        with self.assertRaisesRegex(ValueError, "size budget"):
            apks.prepare(self.source, self.output, max_abi_mib=0.001)
        self.assertFalse(self.output.exists())

    def test_rejects_nightly_package_in_release_upload(self):
        with self.assertRaisesRegex(ValueError, "Expected package"):
            apks.prepare(self.source, self.output, release=True)

    def test_rejects_stale_output_files(self):
        self.output.mkdir()
        (self.output / "stale.apk").touch()
        with self.assertRaisesRegex(ValueError, "must be empty"):
            apks.prepare(self.source, self.output)


if __name__ == "__main__":
    unittest.main()
