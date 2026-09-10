package org.opentubex.app;

import static java.util.Arrays.asList;

import android.content.Context;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.provider.DocumentsContract;
import androidx.documentfile.provider.DocumentFile;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;

public class YtDlpDownloadsTest {
    @Test public void queueResumesPersistsExportsAndDeletesPlayableMedia() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Context test = InstrumentationRegistry.getInstrumentation().getContext();
        File state = new File(context.getCacheDir(), "yt-dlp-queue-" + UUID.randomUUID());
        state.mkdirs();
        YtDlpFiles.write(new File(state, "yt-dlp-downloads.json"), new JSONObject().put("counter", System.currentTimeMillis()).toString().getBytes(StandardCharsets.UTF_8));
        DocumentFile tree = tree(context);
        DocumentFile folder = tree.createDirectory(UUID.randomUUID().toString());
        assertNotNull(folder);
        String folderUri = DocumentsContract.buildTreeDocumentUri(InstrumentationRegistry.getInstrumentation().getContext().getPackageName() + ".documents", DocumentsContract.getDocumentId(folder.getUri())).toString();
        grant(context, Uri.parse(folderUri));
        YtDlpDownloads queue = new YtDlpDownloads(context, state, () -> {});
        Thread running = null;
        try (FixtureServer server = new FixtureServer(test)) {
            JSONObject config = new JSONObject().put("enabled", true).put("folder", folderUri).put("concurrency", 1);
            JSONObject payload = new JSONObject().put("mode", "video").put("videoId", "___________").put("title", "Queue test");
            JSONArray args = new JSONArray(asList("--output", "demo.%(ext)s", "--write-info-json", "--limit-rate", "20K", server.url()));
            long id = queue.add(payload, args, config, -1).getLong("id");
            long second = queue.add(payload, args, config, -1).getLong("id");
            assertEquals(asList(id), queue.claim());
            running = new Thread(() -> queue.run(id));
            running.start();
            long deadline = System.currentTimeMillis() + 15000;
            while (queue.list().getJSONObject(0).optDouble("percent") < 1 && running.isAlive() && System.currentTimeMillis() < deadline) Thread.sleep(50);
            assertTrue("Download failed before pause: " + queue.list(), running.isAlive());
            assertTrue(queue.control(id, "pause", 0));
            running.join(5000);
            assertFalse(running.isAlive());
            assertEquals("paused", queue.list().getJSONObject(0).getString("status"));
            assertTrue(queue.control(second, "cancel", 0));
            assertTrue(queue.control(id, "resume", 0));
            // Reconstruct ownership as after an Android process restart; the same partial file remains.
            YtDlpDownloads resumed = new YtDlpDownloads(context, state, () -> {});
            assertEquals(asList(id), resumed.claim());
            resumed.run(id);
            JSONObject completed = resumed.list().getJSONObject(0);
            assertEquals(completed.toString(), "completed", completed.getString("status"));
            assertTrue("Resume did not use the partial file", server.rangeRequests.get() > 0);
            assertEquals(1, completed.getJSONArray("files").length());
            Uri uri = Uri.parse(completed.getJSONArray("files").getJSONObject(0).getString("path"));
            assertEquals("Open the media rather than its JSON sidecar", uri, resumed.firstFile(id));
            MediaMetadataRetriever media = new MediaMetadataRetriever();
            try {
                media.setDataSource(context, uri);
                assertTrue(Long.parseLong(media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)) > 0);
            } finally { media.release(); }
            YtDlpDownloads persisted = new YtDlpDownloads(context, state, () -> {});
            assertEquals("available", persisted.list().getJSONObject(0).getString("availability"));
            assertEquals(2, folder.listFiles().length);
            assertTrue(persisted.remove(id));
            assertEquals(0, folder.listFiles().length);
            assertEquals(1, persisted.list().length());
        } finally {
            queue.cancelAll();
            if (running != null) { running.interrupt(); running.join(5000); }
            folder.delete();
            YtDlpFiles.deleteTree(state);
        }
    }

    @Test public void failedPlaylistExportsSuccessfulEntriesAndRetryDoesNotDuplicateThem() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File state = new File(context.getCacheDir(), "yt-dlp-partial-" + UUID.randomUUID());
        state.mkdirs();
        DocumentFile folder = tree(context).createDirectory(UUID.randomUUID().toString());
        assertNotNull(folder);
        String folderUri = DocumentsContract.buildTreeDocumentUri(InstrumentationRegistry.getInstrumentation().getContext().getPackageName() + ".documents", DocumentsContract.getDocumentId(folder.getUri())).toString();
        grant(context, Uri.parse(folderUri));
        YtDlpDownloads queue = new YtDlpDownloads(context, state, () -> {});
        try (FixtureServer server = new FixtureServer(InstrumentationRegistry.getInstrumentation().getContext())) {
            JSONObject config = new JSONObject().put("enabled", true).put("folder", folderUri);
            JSONObject payload = new JSONObject().put("mode", "video").put("videoId", "___________");
            JSONArray args = new JSONArray(asList("--output", "%(id)s.%(ext)s", server.url(), server.url().replace("demo.webm", "missing.webm")));
            long id = queue.add(payload, args, config, -1).getLong("id");
            assertEquals(asList(id), queue.claim());
            queue.run(id);
            JSONObject failed = queue.list().getJSONObject(0);
            assertEquals("failed", failed.getString("status"));
            assertEquals("Completed entries must remain playable after a playlist error", 1, failed.getJSONArray("files").length());
            assertNotNull(queue.firstFile(id));
            assertEquals(1, folder.listFiles().length);
            assertEquals(id, queue.add(payload, args, config, id).getLong("id"));
            assertEquals(asList(id), queue.claim());
            queue.run(id);
            assertEquals(1, queue.list().getJSONObject(0).getJSONArray("files").length());
            assertEquals("Retry must reuse exported entries", 1, folder.listFiles().length);
            long size = queue.list().getJSONObject(0).getLong("sizeBytes");
            assertTrue(folder.listFiles()[0].delete());
            assertEquals(id, queue.add(payload, args, config, id).getLong("id"));
            assertEquals(asList(id), queue.claim());
            queue.run(id);
            JSONObject replaced = queue.list().getJSONObject(0);
            assertEquals("Retry must replace a deleted export", "available", replaced.getString("availability"));
            assertEquals(1, replaced.getJSONArray("destinations").length());
            assertEquals(1, replaced.getJSONArray("files").length());
            assertEquals("Replacement must not double-count bytes", size, replaced.getLong("sizeBytes"));
            assertNotNull(queue.firstFile(id));
            assertTrue(queue.remove(id));
            assertEquals(0, folder.listFiles().length);
        } finally { queue.cancelAll(); folder.delete(); YtDlpFiles.deleteTree(state); }
    }

    @Test public void interruptedExportReusesItsAllocatedDocument() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File root = new File(context.getCacheDir(), "yt-dlp-export-" + UUID.randomUUID());
        root.mkdirs();
        File source = new File(root, "video.webm");
        byte[] content = new byte[1024];
        YtDlpFiles.write(source, content);
        DocumentFile tree = tree(context);
        DocumentFile folder = tree.createDirectory(UUID.randomUUID().toString());
        String folderUri = DocumentsContract.buildTreeDocumentUri(InstrumentationRegistry.getInstrumentation().getContext().getPackageName() + ".documents", DocumentsContract.getDocumentId(folder.getUri())).toString();
        grant(context, Uri.parse(folderUri));
        try {
            Uri existing = folder.createFile("video/webm", source.getName()).getUri();
            Uri result = YtDlpFiles.export(context, root, source, folderUri, existing.toString(), allocated -> assertEquals(existing, allocated));
            assertEquals(existing, result);
            assertEquals(1, folder.listFiles().length);
            try (InputStream input = context.getContentResolver().openInputStream(result)) { assertArrayEquals(content, YtDlpFiles.read(input, 2048)); }
        } finally { folder.delete(); YtDlpFiles.deleteTree(root); }
    }

    private static DocumentFile tree(Context context) throws Exception {
        Uri uri = DocumentsContract.buildTreeDocumentUri(InstrumentationRegistry.getInstrumentation().getContext().getPackageName() + ".documents", "root");
        grant(context, uri);
        return DocumentFile.fromTreeUri(context, uri);
    }

    static void grant(Context context, Uri uri) throws Exception {
        context.sendBroadcast(new android.content.Intent().setComponent(new android.content.ComponentName(InstrumentationRegistry.getInstrumentation().getContext().getPackageName(), YtDlpTestDocumentsProvider.GrantReceiver.class.getName()))
            .addFlags(android.content.Intent.FLAG_INCLUDE_STOPPED_PACKAGES).putExtra("uri", uri.toString()).putExtra("targetPackage", context.getPackageName()));
        long deadline = System.currentTimeMillis() + 5000;
        while (context.checkCallingOrSelfUriPermission(uri, android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION) != android.content.pm.PackageManager.PERMISSION_GRANTED && System.currentTimeMillis() < deadline) Thread.sleep(20);
        assertEquals("Test folder grant", android.content.pm.PackageManager.PERMISSION_GRANTED,
            context.checkCallingOrSelfUriPermission(uri, android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION));
    }

    private static final class FixtureServer implements AutoCloseable {
        final ServerSocket server = new ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"));
        final AtomicInteger rangeRequests = new AtomicInteger();
        final byte[] media;
        final Thread thread;
        FixtureServer(Context context) throws Exception {
            try (InputStream input = context.getAssets().open("demo.webm")) { media = YtDlpFiles.read(input, 1024 * 1024); }
            thread = new Thread(() -> {
                while (!server.isClosed()) {
                    try (Socket client = server.accept()) {
                        client.setSoTimeout(5000);
                        BufferedReader reader = new BufferedReader(new InputStreamReader(client.getInputStream(), StandardCharsets.US_ASCII));
                        String request = reader.readLine(), header;
                        int offset = 0;
                        while ((header = reader.readLine()) != null && !header.isEmpty()) {
                            if (header.toLowerCase().startsWith("range: bytes=")) {
                                offset = Integer.parseInt(header.substring(13).split("-")[0]);
                                rangeRequests.incrementAndGet();
                            }
                        }
                        if (request != null && request.contains("/missing.webm ")) {
                            client.getOutputStream().write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
                            continue;
                        }
                        String headers = "HTTP/1.1 " + (offset > 0 ? "206 Partial Content" : "200 OK") + "\r\nContent-Type: video/webm\r\nContent-Length: " + (media.length - offset) + "\r\nAccept-Ranges: bytes\r\nConnection: close\r\n";
                        if (offset > 0) headers += "Content-Range: bytes " + offset + "-" + (media.length - 1) + "/" + media.length + "\r\n";
                        client.getOutputStream().write((headers + "\r\n").getBytes(StandardCharsets.US_ASCII));
                        if (request != null && !request.startsWith("HEAD ")) client.getOutputStream().write(media, offset, media.length - offset);
                    } catch (IOException ignored) { }
                }
            });
            thread.start();
        }
        String url() { return "http://127.0.0.1:" + server.getLocalPort() + "/demo.webm"; }
        @Override public void close() throws Exception { server.close(); thread.join(5000); }
    }
}
