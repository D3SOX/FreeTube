package org.opentubex.app;

import static java.util.Arrays.asList;

import android.app.Activity;
import android.content.Intent;
import android.content.Context;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.*;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.yausername.youtubedl_android.YoutubeDL;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

@CapacitorPlugin(name = "YtDlp")
public final class YtDlpPlugin extends Plugin {
    private final ExecutorService executor = Executors.newFixedThreadPool(3);
    private final Consumer<JSONObject> listener = record -> {
        try { notifyListeners("downloadStatus", JSObject.fromJSONObject(record)); }
        catch (Exception error) { android.util.Log.w("OpenTubeXYtDlp", "Unable to deliver download status", error); }
    };
    private YtDlpDownloads downloads;
    private volatile String version;
    private String ffmpegVersion;
    private String ffprobeVersion;
    static final Object PLAYBACK_CACHE_LOCK = new Object();

    @Override public void load() {
        downloads = YtDlpDownloads.get(getContext());
        downloads.observe(listener);
        if (downloads.hasQueued()) downloads.wake();
    }

    @Override protected void handleOnDestroy() {
        downloads.unobserve(listener);
        executor.shutdownNow();
    }

    private interface Operation { JSONObject run() throws Exception; }
    private void run(PluginCall call, Operation operation) {
        executor.submit(() -> {
            try { call.resolve(JSObject.fromJSONObject(operation.run())); }
            catch (Exception error) {
                Throwable cause = error.getCause() == null ? error : error.getCause();
                call.reject(cause.getMessage() == null ? cause.getClass().getSimpleName() : cause.getMessage());
            }
        });
    }

    @PluginMethod public void configure(PluginCall call) {
        run(call, () -> {
            downloads.configure(call.getObject("configuration"));
            return new JSONObject();
        });
    }
    @PluginMethod public void download(PluginCall call) {
        run(call, () -> downloads.add(call.getObject("payload"), call.getArray("args"), call.getObject("configuration"), call.getData().optLong("retryDownloadId", -1L)));
    }
    @PluginMethod public void list(PluginCall call) { run(call, () -> new JSONObject().put("downloads", downloads.list())); }
    @PluginMethod public void control(PluginCall call) {
        run(call, () -> new JSONObject().put("ok", downloads.control(call.getData().optLong("id", -1L), call.getString("action", ""), call.getInt("value", 0))));
    }
    @PluginMethod public void queue(PluginCall call) {
        run(call, () -> new JSONObject().put("ok", downloads.queue(call.getString("action", ""), call.getObject("configuration"))));
    }
    @PluginMethod public void clear(PluginCall call) {
        run(call, () -> {
            JSONArray ids = downloads.clear(call.getArray("ids"));
            notifyListeners("downloadsRemoved", new JSObject().put("ids", ids));
            return new JSONObject().put("ok", true);
        });
    }
    @PluginMethod public void remove(PluginCall call) {
        run(call, () -> {
            long id = call.getData().optLong("id", -1L);
            boolean ok = downloads.remove(id);
            if (ok) notifyListeners("downloadsRemoved", new JSObject().put("ids", new JSONArray().put(id)));
            return new JSONObject().put("ok", ok);
        });
    }
    @PluginMethod public void open(PluginCall call) {
        open(getContext(), call);
    }

    void open(Context context, PluginCall call) {
        run(call, () -> {
            Uri uri = downloads.firstFile(call.getData().optLong("id", -1L));
            if (uri == null) return new JSONObject().put("ok", false);
            Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, context.getContentResolver().getType(uri))
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            return new JSONObject().put("ok", true);
        });
    }
    @PluginMethod public void chooseCookies(PluginCall call) {
        startActivityForResult(call, new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE), "cookiesChosen");
    }
    @ActivityCallback private void cookiesChosen(PluginCall call, ActivityResult result) {
        if (call == null) return;
        run(call, () -> {
            if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) return new JSONObject();
            Uri uri = result.getData().getData();
            if (uri == null) return new JSONObject();
            File cookies = new File(getContext().getNoBackupFilesDir(), "yt-dlp-cookies.txt");
            try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
                if (input == null) throw new IOException("Unable to read cookies");
                byte[] data = YtDlpFiles.read(input, 2 * 1024 * 1024);
                if (data.length > 2 * 1024 * 1024) throw new IOException("Cookie file is too large");
                YtDlpFiles.write(cookies, data);
            }
            return new JSONObject().put("path", cookies.getAbsolutePath());
        });
    }
    @PluginMethod public void extract(PluginCall call) {
        run(call, () -> {
            List<String> args = YtDlpArguments.validate(call.getArray("args"));
            String cookies = call.getString("cookies", "");
            if (!cookies.isEmpty()) {
                File allowed = new File(getContext().getNoBackupFilesDir(), "yt-dlp-cookies.txt");
                if (!cookies.equals(allowed.getAbsolutePath()) || !allowed.isFile()) throw new IOException("Cookie file is unavailable");
                args.addAll(asList("--cookies", cookies));
            }
            args.add("--simulate");
            return new JSONObject().put("stdout", YtDlpRuntime.extract(getContext(), args));
        });
    }
    @PluginMethod public void subtitle(PluginCall call) {
        run(call, () -> {
            try {
                return new JSONObject().put("text", YtDlpSubtitle.download(getContext(), call.getString("url", ""), call.getString("cookies", "")));
            } catch (Exception error) {
                // Runtime failures may contain signed subtitle URLs or cookie details.
                return new JSONObject().put("error", "Unable to load subtitle with configured cookies");
            }
        });
    }
    private synchronized JSONObject infoResult() throws Exception {
        YtDlpRuntime.initialize(getContext());
        if (version == null) version = YtDlpRuntime.extract(getContext(), asList("--version"));
        if (ffmpegVersion == null) ffmpegVersion = YtDlpRuntime.ffmpegVersion(getContext(), "ffmpeg");
        if (ffprobeVersion == null) ffprobeVersion = YtDlpRuntime.ffmpegVersion(getContext(), "ffprobe");
        JSONObject binary = new JSONObject().put("source", "managed").put("available", true).put("path", "");
        return new JSONObject().put("ytDlp", new JSONObject(binary.toString()).put("version", version).put("supportedBrowsers", new JSONArray()))
            .put("ffmpeg", new JSONObject(binary.toString()).put("version", ffmpegVersion))
            .put("ffprobe", new JSONObject(binary.toString()).put("version", ffprobeVersion));
    }
    @PluginMethod public void info(PluginCall call) { run(call, this::infoResult); }

    private static String repository(String channel) {
        return "nightly".equals(channel) ? "yt-dlp/yt-dlp-nightly-builds" : "master".equals(channel) ? "yt-dlp/yt-dlp-master-builds" : "yt-dlp/yt-dlp";
    }
    @PluginMethod public void checkUpdate(PluginCall call) {
        run(call, () -> {
            if (!"yt-dlp".equals(call.getString("binary"))) return new JSONObject().put("available", false);
            HttpURLConnection connection = (HttpURLConnection) new URL("https://api.github.com/repos/" + repository(call.getString("channel")) + "/releases/latest").openConnection();
            connection.setConnectTimeout(15_000); connection.setReadTimeout(15_000);
            try (InputStream input = connection.getInputStream()) {
                JSONObject release = new JSONObject(new String(YtDlpFiles.read(input, 32 * 1024 * 1024), StandardCharsets.UTF_8));
                infoResult();
                return new JSONObject().put("available", !release.getString("tag_name").equals(version));
            } finally { connection.disconnect(); }
        });
    }
    @PluginMethod public void update(PluginCall call) {
        run(call, () -> {
            String binary = call.getString("binary");
            if (!"yt-dlp".equals(binary)) return new JSONObject().put("error", "FFmpeg is updated with the Android app");
            notifyListeners("binaryProgress", new JSObject().put("binary", binary).put("percent", JSONObject.NULL).put("inProgress", true));
            try {
            YtDlpRuntime.initialize(getContext());
            YoutubeDL.UpdateStatus status = YtDlpRuntime.update(getContext(), "https://api.github.com/repos/" + repository(call.getString("channel")) + "/releases/latest");
            version = null;
            JSONObject result = infoResult();
            notifyListeners("binaryProgress", new JSObject().put("binary", binary).put("percent", 100).put("inProgress", false));
            notifyListeners("binaryUpdated", new JSObject().put("binary", binary));
            return new JSONObject().put("updated", status == YoutubeDL.UpdateStatus.DONE).put("version", result.getJSONObject("ytDlp").getString("version"));
            } finally { notifyListeners("binaryProgress", new JSObject().put("binary", binary).put("percent", 100).put("inProgress", false)); }
        });
    }
    @PluginMethod public void cache(PluginCall call) {
        cache(getContext(), call);
    }

    static File playbackCacheDirectory(Context context) {
        return new File(context.getNoBackupFilesDir(), "yt-dlp-playback");
    }

    void cache(Context context, PluginCall call) {
        run(call, () -> {
            synchronized (PLAYBACK_CACHE_LOCK) {
            // Keep signed playback URLs across restarts and APK replacements,
            // outside Android's reclaimable cache and device backups.
            File directory = playbackCacheDirectory(context);
            if (!directory.exists()) {
                File previousDirectory = new File(context.getCacheDir(), "yt-dlp-playback");
                directory.getParentFile().mkdirs();
                if (previousDirectory.isDirectory() && !previousDirectory.renameTo(directory)) {
                    throw new IOException("Unable to preserve the existing playback cache");
                }
            }
            directory.mkdirs();
            String action = call.getString("action", "");
            if (action.equals("clear")) { YtDlpFiles.deleteTree(directory); return new JSONObject(); }
            String videoId = call.getString("videoId", "");
            if (!videoId.matches("[\\w-]{11}")) throw new IllegalArgumentException("Invalid video ID");
            File file = new File(directory, videoId + ".json");
            if (action.equals("delete")) file.delete();
            if (action.equals("set")) {
                JSONObject data = call.getData();
                byte[] content = data.toString().getBytes(StandardCharsets.UTF_8);
                int limit = Math.max(0, Math.min(16 * 1024 * 1024, call.getInt("maxEntryBytes", 5 * 1024 * 1024)));
                if (content.length <= limit) {
                    YtDlpFiles.write(file, content);
                    File[] entries = directory.listFiles();
                    if (entries != null && entries.length > 128) {
                        Arrays.sort(entries, Comparator.comparingLong(File::lastModified));
                        for (int i = 0; i < entries.length - 128; i++) entries[i].delete();
                    }
                } else file.delete();
            }
            if (action.equals("get") && file.isFile()) {
                JSONObject data = new JSONObject(new String(YtDlpFiles.readFile(file), StandardCharsets.UTF_8));
                if (data.optLong("expiryTime") > System.currentTimeMillis() && data.optString("cacheKey").equals(call.getString("cacheKey"))) return new JSONObject().put("entry", data);
                file.delete();
            }
            return new JSONObject();
            }
        });
    }
}
