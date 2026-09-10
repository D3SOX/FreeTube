package org.opentubex.app;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import androidx.documentfile.provider.DocumentFile;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class YtDlpOpenDownloadTest {
    @Test public void opensExistingDownloadWithJsonIntegerId() throws Exception {
        checkOpen(1);
    }

    @Test public void opensExistingDownloadWithJsonLongId() throws Exception {
        checkOpen(2147483648L);
    }

    private void checkOpen(long id) throws Exception {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Uri tree = DocumentsContract.buildTreeDocumentUri(
            InstrumentationRegistry.getInstrumentation().getContext().getPackageName() + ".documents", "root");
        YtDlpDownloadsTest.grant(app, tree);
        DocumentFile document = DocumentFile.fromTreeUri(app, tree).createFile("video/webm", UUID.randomUUID() + ".webm");
        assertNotNull(document);
        File state = new File(app.getCacheDir(), "open-download-" + UUID.randomUUID());
        assertTrue(state.mkdirs());
        YtDlpPlugin plugin = new YtDlpPlugin();
        var executor = YtDlpPlugin.class.getDeclaredField("executor");
        executor.setAccessible(true);
        try {
            JSONObject record = new JSONObject().put("id", id).put("status", "completed")
                .put("destinations", new JSONArray().put(document.getUri().toString()))
                .put("files", new JSONArray().put(new JSONObject().put("path", document.getUri().toString())));
            YtDlpFiles.write(new File(state, "yt-dlp-downloads.json"),
                new JSONObject().put("counter", id).put("records", new JSONArray().put(record)).toString().getBytes(StandardCharsets.UTF_8));
            YtDlpDownloads downloads = new YtDlpDownloads(app, state, () -> {});
            assertEquals(document.getUri(), downloads.firstFile(id));
            var field = YtDlpPlugin.class.getDeclaredField("downloads");
            field.setAccessible(true);
            field.set(plugin, downloads);
            CompletableFuture<Intent> launched = new CompletableFuture<>();
            Context context = new ContextWrapper(app) {
                @Override public void startActivity(Intent intent) { launched.complete(intent); }
            };

            assertTrue("Existing download was reported as missing", open(plugin, context, id).getBoolean("ok"));
            Intent intent = launched.get(5, TimeUnit.SECONDS);
            assertEquals(Intent.ACTION_VIEW, intent.getAction());
            assertEquals(document.getUri(), intent.getData());
            assertEquals("video/webm", intent.getType());
            assertTrue((intent.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0);

            assertTrue(document.delete());
            assertFalse("Deleted files must still be reported as missing", open(plugin, context, id).getBoolean("ok"));
            assertFalse(open(plugin, context, id + 1).getBoolean("ok"));

            JSObject retry = new JSObject().put("retryDownloadId", id)
                .put("payload", new JSObject().put("videoId", "___________").put("mode", "video"))
                .put("args", new JSONArray().put("https://www.youtube.com/watch?v=___________"))
                .put("configuration", new JSObject().put("enabled", true).put("folder", tree.toString()));
            assertEquals("Retry must reuse the existing record", id, call(plugin::download, retry).getLong("id"));
            assertEquals(1, downloads.list().length());
            assertTrue("Pause must find the download", call(plugin::control,
                new JSObject().put("id", id).put("action", "pause")).getBoolean("ok"));
            assertTrue("Cancel must find the download", call(plugin::control,
                new JSObject().put("id", id).put("action", "cancel")).getBoolean("ok"));
            assertTrue("Remove must find the download", call(plugin::remove, new JSObject().put("id", id)).getBoolean("ok"));
            assertEquals(0, downloads.list().length());
        } finally {
            ((ExecutorService) executor.get(plugin)).shutdownNow();
            document.delete();
            YtDlpFiles.deleteTree(state);
        }
    }

    private JSObject open(YtDlpPlugin plugin, Context context, long id) throws Exception {
        return call(call -> plugin.open(context, call), new JSObject().put("id", id));
    }

    private JSObject call(Consumer<PluginCall> invoke, JSObject data) throws Exception {
        CompletableFuture<JSObject> response = new CompletableFuture<>();
        // Parse the wire JSON just as Capacitor does; small numbers become Integer.
        PluginCall call = new PluginCall(null, "YtDlp", "test", "test", new JSObject(data.toString())) {
            @Override public void resolve(JSObject result) { response.complete(result); }
            @Override public void reject(String message) { response.completeExceptionally(new AssertionError(message)); }
        };
        invoke.accept(call);
        return response.get(5, TimeUnit.SECONDS);
    }
}
