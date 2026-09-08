package org.opentubex.app;

import static org.junit.Assert.*;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;
import android.view.KeyEvent;
import androidx.documentfile.provider.DocumentFile;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public class AndroidFileExportTest {
    @Test
    public void savesLargeScreenshotThroughDocumentPicker() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String[] exportsBefore = stagedExports();
        String filename = "screenshot-" + UUID.randomUUID() + ".png";
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitValue(scenario, "typeof window.Capacitor === 'object' && document.readyState === 'complete'", "true");
            // A video frame can easily exceed Android's activity-state transaction limit.
            evaluate(scenario, "window.exportResult=null;window.screenshotData=btoa('frame'.repeat(300000));" +
                "window.Capacitor.nativePromise('AndroidStorage','saveFile'," +
                "{fileName:'" + filename + "',mimeType:'image/png',data:window.screenshotData})" +
                ".then(function(result){window.exportResult=result;},function(error){window.exportResult={error:error.message};});");
            awaitPicker();
            // Leave time for the stopped activity's state to reach Android before saving.
            Thread.sleep(2000);
            clickPickerSave();
            awaitValue(scenario, "window.exportResult !== null", "true");
            JSONObject result = new JSONObject(new JSONArray("[" + evaluate(scenario, "JSON.stringify(window.exportResult)") + "]").getString(0));
            assertTrue(result.toString(), result.optBoolean("saved"));
            assertArrayEquals(exportsBefore, stagedExports());
            Uri uri = Uri.parse(result.getString("uri"));
            try {
                try (InputStream input = context.getContentResolver().openInputStream(uri)) {
                    assertArrayEquals("frame".repeat(300000).getBytes(StandardCharsets.UTF_8), YtDlpFiles.read(input, 2_000_000));
                }
            } finally {
                DocumentsContract.deleteDocument(context.getContentResolver(), uri);
            }
        }
    }

    private static void clickPickerSave() throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        do {
            android.view.accessibility.AccessibilityNodeInfo root = InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();
            if (root != null) {
                for (android.view.accessibility.AccessibilityNodeInfo node : root.findAccessibilityNodeInfosByText("Save")) {
                    if (node.isClickable() && node.isEnabled() && node.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK)) return;
                }
            }
            Thread.sleep(100);
        } while (System.nanoTime() < deadline);
        fail("Android's save button is available");
    }

    @Test
    public void overlappingPickersRejectWithoutLosingTheOriginalCallback() throws Exception {
        String[] exportsBefore = stagedExports();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitValue(scenario, "typeof window.Capacitor === 'object' && document.readyState === 'complete'", "true");
            for (String first : new String[]{"chooseDirectory", "saveFile"}) {
                for (String second : new String[]{"chooseDirectory", "saveFile"}) {
                    evaluate(scenario,
                        "window.firstPickerResult = null; window.secondPickerResult = null;" +
                        "window.Capacitor.nativePromise('AndroidStorage', '" + first + "'," +
                        "{fileName:'cancel.txt',data:'',mimeType:'text/plain'})" +
                        ".then(function(result){window.firstPickerResult=result;}," +
                        "function(error){window.firstPickerResult={error:error.message};});");
                    awaitPicker();
                    evaluate(scenario,
                        "window.Capacitor.nativePromise('AndroidStorage', '" + second + "'," +
                        "{fileName:'cancel.txt',data:'',mimeType:'text/plain'})" +
                        ".then(function(result){window.secondPickerResult=result;}," +
                        "function(error){window.secondPickerResult={error:error.message};});");
                    awaitValue(scenario, "window.secondPickerResult !== null", "true");
                    assertEquals("true", evaluate(scenario, "typeof window.secondPickerResult.error === 'string'"));
                    assertEquals("null", evaluate(scenario, "window.firstPickerResult"));
                    InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
                    awaitValue(scenario, "window.firstPickerResult !== null", "true");
                    assertEquals(first.equals("saveFile") ? "{\"saved\":false}" : "{}",
                        evaluate(scenario, "window.firstPickerResult"));
                    assertArrayEquals(exportsBefore, stagedExports());
                }
            }
        }
    }

    @Test
    public void exportsToSelectedFolderAndReportsMissingFoldersAndCancellation() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String authority = InstrumentationRegistry.getInstrumentation().getContext().getPackageName() + ".documents";
        Uri rootUri = DocumentsContract.buildTreeDocumentUri(authority, "root");
        grant(context, rootUri);
        DocumentFile folder = DocumentFile.fromTreeUri(context, rootUri).createDirectory(UUID.randomUUID().toString());
        assertNotNull(folder);
        Uri folderUri = DocumentsContract.buildTreeDocumentUri(authority, DocumentsContract.getDocumentId(folder.getUri()));
        grant(context, folderUri);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitValue(scenario, "typeof window.Capacitor === 'object' && document.readyState === 'complete'", "true");
            String[][] cases = {
                {"screenshot.png", "image/png", "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ZkAAAAASUVORK5CYII="},
                {"screenshot.jpg", "image/jpeg", Base64.encodeToString(new byte[]{(byte) 0xff, (byte) 0xd8, (byte) 0xff, (byte) 0xd9}, Base64.NO_WRAP)},
                {"screenshot.webp", "image/webp", Base64.encodeToString("RIFF WEBP".getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP)},
                {"theme.json", "application/json", encode("{\"name\":\"Grün 🎥\"}\n")},
                {"transcript.txt", "text/plain", encode("Grüße 日本語 🎥\n")},
                {"playlist.csv", "text/csv", encode("Video ID,Timestamp\nabc,2026\n")},
                {"profiles.db", "application/x-freetube-db", encode("{\"name\":\"Öffentlich\"}\n")},
                {"empty.txt", "text/plain", ""},
            };
            for (String[] entry : cases) {
                JSONObject options = new JSONObject().put("fileName", entry[0]).put("mimeType", entry[1])
                    .put("data", entry[2]).put("directory", folderUri.toString());
                JSONObject result = save(scenario, options);
                assertTrue(result.toString(), result.optBoolean("saved"));
                Uri uri = Uri.parse(result.getString("uri"));
                assertEquals(entry[0], DocumentFile.fromSingleUri(context, uri).getName());
                try (InputStream input = context.getContentResolver().openInputStream(uri)) {
                    assertArrayEquals(Base64.decode(entry[2], Base64.DEFAULT), YtDlpFiles.read(input, 4096));
                }
            }
            assertEquals(cases.length, folder.listFiles().length);

            // A second screenshot must not truncate an earlier file with the same name.
            JSONObject duplicate = save(scenario, new JSONObject().put("fileName", "screenshot.png")
                .put("mimeType", "image/png").put("data", cases[0][2]).put("directory", folderUri.toString()));
            assertTrue(duplicate.getBoolean("saved"));
            assertEquals(cases.length + 1, folder.listFiles().length);

            JSONObject invalid = save(scenario, new JSONObject().put("fileName", "../escape.txt")
                .put("data", encode("test")).put("directory", folderUri.toString()));
            assertTrue(invalid.has("error"));
            assertEquals(cases.length + 1, folder.listFiles().length);

            folder.delete();
            JSONObject missing = save(scenario, new JSONObject().put("fileName", "missing.txt")
                .put("data", encode("test")).put("directory", folderUri.toString()));
            assertTrue(missing.toString(), missing.has("error"));

            evaluate(scenario, "window.exportResult = null; window.Capacitor.nativePromise('AndroidStorage', 'saveFile'," +
                "{fileName:'cancel.txt',data:'dGVzdA==',mimeType:'text/plain'}).then(function(result){window.exportResult=result;}," +
                "function(error){window.exportResult={error:error.message};});");
            awaitPicker();
            InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
            awaitValue(scenario, "window.exportResult !== null", "true");
            assertEquals("false", evaluate(scenario, "window.exportResult.saved"));
        } finally {
            folder.delete();
        }
    }

    private static String encode(String value) {
        return Base64.encodeToString(value.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
    }

    private static String[] stagedExports() {
        String[] names = InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir()
            .list((directory, name) -> name.startsWith("export-") && name.endsWith(".tmp"));
        assertNotNull(names);
        Arrays.sort(names);
        return names;
    }

    private static JSONObject save(ActivityScenario<MainActivity> scenario, JSONObject options) throws Exception {
        evaluate(scenario, "window.exportResult=null;window.Capacitor.nativePromise('AndroidStorage','saveFile'," + options +
            ").then(function(result){window.exportResult=result;},function(error){window.exportResult={error:error.message};});");
        awaitValue(scenario, "window.exportResult !== null", "true");
        return new JSONObject(new JSONArray("[" + evaluate(scenario, "JSON.stringify(window.exportResult)") + "]").getString(0));
    }

    private static void awaitPicker() throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        do {
            android.view.accessibility.AccessibilityNodeInfo root = InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();
            if (root != null && root.getPackageName() != null && root.getPackageName().toString().contains("documentsui")) return;
            Thread.sleep(100);
        } while (System.nanoTime() < deadline);
        fail("Android's save dialog opens");
    }

    private static void grant(Context context, Uri uri) throws Exception {
        context.sendBroadcast(new Intent().setComponent(new ComponentName(
            InstrumentationRegistry.getInstrumentation().getContext().getPackageName(), YtDlpTestDocumentsProvider.GrantReceiver.class.getName()))
            .addFlags(Intent.FLAG_INCLUDE_STOPPED_PACKAGES).putExtra("uri", uri.toString()).putExtra("targetPackage", context.getPackageName()));
        long deadline = System.currentTimeMillis() + 5000;
        while (context.checkCallingOrSelfUriPermission(uri, Intent.FLAG_GRANT_WRITE_URI_PERMISSION) != PackageManager.PERMISSION_GRANTED && System.currentTimeMillis() < deadline) Thread.sleep(20);
        assertEquals(PackageManager.PERMISSION_GRANTED, context.checkCallingOrSelfUriPermission(uri, Intent.FLAG_GRANT_WRITE_URI_PERMISSION));
    }

    private static void awaitValue(ActivityScenario<MainActivity> scenario, String script, String expected) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
        String actual;
        do {
            actual = evaluate(scenario, script);
            if (expected.equals(actual)) return;
            Thread.sleep(100);
        } while (System.nanoTime() < deadline);
        assertEquals(expected, actual);
    }

    private static String evaluate(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        CountDownLatch evaluated = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(script, value -> {
            result.set(value);
            evaluated.countDown();
        }));
        assertTrue(evaluated.await(5, TimeUnit.SECONDS));
        return result.get();
    }
}
