package org.opentubex.app;

import android.content.Context;
import android.content.ContextWrapper;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import static org.junit.Assert.*;

public class YtDlpPlaybackCacheTest {
    private static final String VIDEO = "___________";

    private JSObject call(Context context, JSObject data) throws Exception {
        // Each request uses a new plugin, with no state retained from the writer.
        YtDlpPlugin plugin = new YtDlpPlugin();
        CompletableFuture<JSObject> response = new CompletableFuture<>();
        PluginCall call = new PluginCall(null, "YtDlp", "test", "cache", data) {
            @Override public void resolve(JSObject result) { response.complete(result); }
            @Override public void reject(String message) { response.completeExceptionally(new AssertionError(message)); }
        };
        var executor = YtDlpPlugin.class.getDeclaredField("executor");
        executor.setAccessible(true);
        try {
            plugin.cache(context, call);
            return response.get(5, TimeUnit.SECONDS);
        } finally { ((ExecutorService) executor.get(plugin)).shutdownNow(); }
    }

    private JSObject request(String action) {
        return new JSObject().put("action", action).put("videoId", VIDEO).put("cacheKey", "settings");
    }

    private Context isolatedContext(Context app, File root) {
        return new ContextWrapper(app) {
            @Override public File getDataDir() { return root; }
            @Override public File getCacheDir() { return new File(root, "cache"); }
            @Override public File getCodeCacheDir() { return new File(root, "code_cache"); }
            @Override public File getNoBackupFilesDir() { return new File(root, "no_backup"); }
        };
    }

    @Test public void playbackSurvivesPluginRestartAndAndroidCacheEviction() throws Exception {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File root = new File(app.getCacheDir(), "playback-test-" + UUID.randomUUID());
        Context context = isolatedContext(app, root);
        try {
            long expiry = System.currentTimeMillis() + 3600000;
            JSObject source = new JSObject().put("manifestSrc", "<MPD/>").put("isLive", false);
            call(context, request("set").put("expiryTime", expiry).put("source", source));
            assertEquals("<MPD/>", call(context, request("get")).getJSONObject("entry").getJSONObject("source").getString("manifestSrc"));

            // Android may reclaim cache files while the app is stopped.
            YtDlpFiles.deleteTree(context.getCacheDir());
            JSObject restored = call(context, request("get"));
            assertTrue("Playback cache was lost after Android cache eviction", restored.has("entry"));
            assertEquals(expiry, restored.getJSONObject("entry").getLong("expiryTime"));
            assertEquals("<MPD/>", restored.getJSONObject("entry").getJSONObject("source").getString("manifestSrc"));

            call(context, request("clear"));
            assertFalse(call(context, request("get")).has("entry"));
        } finally { YtDlpFiles.deleteTree(root); }
    }

    @Test public void existingCacheMovesToPersistentStorage() throws Exception {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File root = new File(app.getCacheDir(), "playback-test-" + UUID.randomUUID());
        Context context = isolatedContext(app, root);
        try {
            File oldDirectory = new File(context.getCacheDir(), "yt-dlp-playback");
            assertTrue(oldDirectory.mkdirs());
            JSObject entry = request("set").put("expiryTime", System.currentTimeMillis() + 3600000)
                .put("source", new JSObject().put("manifestSrc", "<MPD/>"));
            YtDlpFiles.write(new File(oldDirectory, VIDEO + ".json"), entry.toString().getBytes(StandardCharsets.UTF_8));
            assertTrue(call(context, request("get")).has("entry"));
            assertFalse("Old cache directory should be moved", oldDirectory.exists());
            YtDlpFiles.deleteTree(context.getCacheDir());
            assertTrue(call(context, request("get")).has("entry"));
            call(context, request("delete"));
            assertFalse(call(context, request("get")).has("entry"));
        } finally { YtDlpFiles.deleteTree(root); }
    }

    @Test public void storageSettingsMeasuresAndClearsPersistentPlaybackCache() throws Exception {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File root = new File(app.getCacheDir(), "playback-test-" + UUID.randomUUID());
        Context context = isolatedContext(app, root);
        try {
            call(context, request("set").put("expiryTime", System.currentTimeMillis() + 3600000)
                .put("source", new JSObject().put("manifestSrc", "<MPD/>")));
            File preferences = new File(context.getNoBackupFilesDir(), "preferences.json");
            YtDlpFiles.write(preferences, "{}".getBytes(StandardCharsets.UTF_8));

            AndroidStorage.Usage usage = AndroidStoragePlugin.getUsage(context);
            assertTrue("Storage Settings must count playback entries as clearable cache", usage.cacheBytes > 0);
            assertEquals(preferences.length(), usage.appDataBytes);
            assertTrue(AndroidStoragePlugin.clearCacheFiles(context));
            assertFalse("Clear Cache must remove persistent playback entries", call(context, request("get")).has("entry"));
            assertEquals(0, AndroidStoragePlugin.getUsage(context).cacheBytes);
            assertTrue("Clear Cache must preserve other app data", preferences.isFile());
        } finally { YtDlpFiles.deleteTree(root); }
    }

    @Test public void playbackSurvivesAppReplacement() throws Exception {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File root = new File(app.getNoBackupFilesDir(), "playback-replacement-test");
        File cache = new File(app.getCacheDir(), "playback-replacement-test");
        Context context = new ContextWrapper(app) {
            @Override public File getCacheDir() { return cache; }
            @Override public File getNoBackupFilesDir() { return root; }
        };
        // The default "both" checks persistence without replacing the APK.
        // See android/YTDLP.md for the separate seed -> install -r -> verify flow.
        String phase = InstrumentationRegistry.getArguments().getString("playbackCachePhase", "both");
        try {
            if (!phase.equals("verify")) {
                YtDlpFiles.deleteTree(root);
                YtDlpFiles.deleteTree(cache);
                call(context, request("set").put("expiryTime", System.currentTimeMillis() + 3600000)
                    .put("source", new JSObject().put("manifestSrc", "<MPD/>")));
            }
            if (!phase.equals("seed")) {
                assertEquals("<MPD/>", call(context, request("get")).getJSONObject("entry").getJSONObject("source").getString("manifestSrc"));
            }
        } finally {
            if (!phase.equals("seed")) {
                YtDlpFiles.deleteTree(root);
                YtDlpFiles.deleteTree(cache);
            }
        }
    }
}
