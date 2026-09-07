package org.opentubex.app;

import static java.util.Arrays.asList;

import android.content.Context;
import android.net.Uri;
import android.util.AtomicFile;
import android.util.Log;
import androidx.documentfile.provider.DocumentFile;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;
import java.util.regex.Pattern;

/** Native queue ownership keeps downloads independent of WebView and activity lifetime. */
final class YtDlpDownloads {
    private static YtDlpDownloads instance;
    private static final List<String> ACTIVE = asList("queued", "downloading", "processing", "paused", "pausing");
    private static final Pattern PROGRESS = Pattern.compile("^\\[download]\\s+(\\d+(?:\\.\\d+)?)%(?:.*?\\bat\\s+(\\S+))?(?:.*?\\bETA\\s+(\\S+))?");
    private final Context context;
    private final AtomicFile file;
    private final File staging;
    private final Runnable schedule;
    private final Map<Long, JSONObject> records = new LinkedHashMap<>();
    private final Set<Long> running = new HashSet<>();
    private final Map<Long, Thread> threads = new HashMap<>();
    private final List<Consumer<JSONObject>> listeners = new CopyOnWriteArrayList<>();
    private long counter;
    private boolean paused;
    private int concurrency = 2;
    private int bandwidth;
    private JSONObject configuration = new JSONObject();

    static synchronized YtDlpDownloads get(Context context) {
        Context application = context.getApplicationContext();
        if (instance == null) instance = new YtDlpDownloads(application, application.getNoBackupFilesDir(), () ->
            WorkManager.getInstance(application).enqueueUniqueWork("yt-dlp-downloads", ExistingWorkPolicy.APPEND_OR_REPLACE,
                new OneTimeWorkRequest.Builder(YtDlpDownloadWorker.class).build()));
        return instance;
    }

    YtDlpDownloads(Context context, File directory, Runnable schedule) {
        this.context = context;
        this.schedule = schedule;
        staging = new File(directory, "yt-dlp-downloads");
        file = new AtomicFile(new File(directory, "yt-dlp-downloads.json"));
        if (!file.getBaseFile().exists()) return;
        try (InputStream input = file.openRead()) {
            JSONObject saved = new JSONObject(new String(YtDlpFiles.read(input, 32 * 1024 * 1024), StandardCharsets.UTF_8));
            configuration = saved.optJSONObject("configuration");
            if (configuration == null) configuration = new JSONObject();
            counter = saved.optLong("counter");
            paused = saved.optBoolean("paused");
            concurrency = saved.optInt("concurrency", 2);
            bandwidth = saved.optInt("bandwidth");
            JSONArray list = saved.optJSONArray("records");
            if (list != null) for (int i = 0; i < list.length(); i++) {
                JSONObject record = list.getJSONObject(i);
                String status = record.optString("status");
                if (asList("downloading", "processing", "pausing").contains(status)) {
                    record.put("status", paused || status.equals("pausing") ? "paused" : "queued");
                }
                records.put(record.getLong("id"), record);
            }
        } catch (Exception error) {
            // Preserve corrupt history rather than silently replacing it with an empty queue.
            throw new IllegalStateException("Unable to read Android download history", error);
        }
    }

    synchronized void configure(JSONObject config) {
        configuration = config;
        concurrency = Math.max(1, Math.min(10, config.optInt("concurrency", 2)));
        bandwidth = Math.max(0, Math.min(10_000_000, config.optInt("bandwidth")));
        save();
    }

    synchronized void discover(String channelId, String feedType, JSONObject response) throws Exception {
        if (!configuration.optBoolean("enabled")) return;
        JSONObject rules = configuration.optJSONObject("rules");
        JSONObject entry = rules == null ? null : rules.optJSONObject(channelId);
        if (entry == null) return;
        JSONObject rule = entry.getJSONObject("rule");
        JSONArray videos = response.optJSONArray("videos");
        if (videos == null) return;
        for (int i = 0; i < videos.length(); i++) {
            JSONObject video = videos.optJSONObject(i);
            if (video == null || !YtDlpAutomaticDownloads.matches(video, feedType, rule, System.currentTimeMillis())) continue;
            JSONObject payload = new JSONObject(entry.getJSONObject("payload").toString());
            String videoId = video.getString("videoId");
            payload.put("videoId", videoId).put("title", video.optString("title", videoId));
            JSONArray thumbnails = video.optJSONArray("videoThumbnails");
            if (thumbnails != null && thumbnails.length() > 0) payload.put("thumbnail", thumbnails.getJSONObject(thumbnails.length() - 1).optString("url"));
            JSONArray args = new JSONArray();
            JSONArray template = entry.getJSONArray("args");
            for (int n = 0; n < template.length(); n++) {
                String arg = template.getString(n);
                args.put(arg.equals("https://www.youtube.com/watch?v=___________") ? "https://www.youtube.com/watch?v=" + videoId : arg);
            }
            add(payload, args, configuration, -1);
        }
    }

    void observe(Consumer<JSONObject> listener) { listeners.add(listener); }
    void unobserve(Consumer<JSONObject> listener) { listeners.remove(listener); }

    synchronized JSONObject add(JSONObject payload, JSONArray args, JSONObject config, long retryId) throws Exception {
        if (!config.optBoolean("enabled")) return new JSONObject().put("error", "downloads-disabled");
        String folder = config.optString("folder");
        if (!folder.startsWith("content://")) return new JSONObject().put("error", "download-folder-required");
        DocumentFile target = DocumentFile.fromTreeUri(context, Uri.parse(folder));
        if (target == null || !target.canWrite()) return new JSONObject().put("error", "download-folder-unavailable");
        YtDlpArguments.validate(args);
        if (payload.optBoolean("automatic")) {
            for (JSONObject record : records.values()) {
                if (record.optString("videoId").equals(payload.optString("videoId")) &&
                    !asList("failed", "cancelled").contains(record.optString("status"))) {
                    return new JSONObject().put("skipped", "already-downloaded");
                }
            }
        }
        configure(config);
        JSONObject previous = records.get(retryId);
        if (previous != null && (running.contains(retryId) || ACTIVE.contains(previous.optString("status")))) return new JSONObject().put("error", "download-active");
        long position = ++counter;
        long id = previous == null ? position : retryId;
        JSONObject record = previous == null ? new JSONObject() : previous;
        for (String key : asList("videoId", "playlistId", "playlistKey", "title", "thumbnail", "mode", "template")) record.put(key, payload.optString(key));
        record.put("id", id).put("retryPayload", new JSONObject(payload.toString())).put("automatic", payload.optBoolean("automatic"));
        record.put("args", args).put("folder", folder).put("status", paused ? "paused" : "queued");
        record.put("queuePosition", position).put("percent", 0).put("speed", JSONObject.NULL).put("eta", JSONObject.NULL);
        record.put("errorMessage", JSONObject.NULL).put("started", false);
        if (!record.has("destinations")) record.put("destinations", new JSONArray()).put("files", new JSONArray());
        records.put(id, record);
        publish(record);
        save();
        wake();
        return new JSONObject().put("id", id);
    }

    void wake() {
        schedule.run();
    }

    synchronized List<Long> claim() throws Exception {
        List<JSONObject> pending = records.values().stream()
            .filter(record -> record.optString("status").equals("queued") && !running.contains(record.optLong("id")))
            .sorted(Comparator.comparingLong(record -> record.optLong("queuePosition")))
            .collect(java.util.stream.Collectors.toList());
        List<Long> ids = new ArrayList<>();
        for (JSONObject record : pending) {
            if (running.size() >= concurrency) break;
            long id = record.getLong("id");
            running.add(id);
            record.put("status", "downloading").put("started", true);
            ids.add(id);
            publish(record);
        }
        save();
        return ids;
    }

    synchronized boolean hasRunning() { return !running.isEmpty(); }
    synchronized boolean hasQueued() { return records.values().stream().anyMatch(r -> r.optString("status").equals("queued")); }

    void run(long id) {
        JSONObject record;
        synchronized (this) {
            record = records.get(id);
            threads.put(id, Thread.currentThread());
        }
        File root = new File(staging, Long.toString(id));
        try {
            if (!isExecuting(id)) return;
            root.mkdirs();
            List<String> args = YtDlpArguments.validate(record.getJSONArray("args"));
            args.addAll(asList("--paths", root.getAbsolutePath(), "--paths", "temp:" + new File(root, "temp").getAbsolutePath(),
                "--newline", "--progress", "--no-simulate", "--print", "after_move:__OPENTUBEX_FILE__:%(id)s\t%(duration)s\t%(width)s\t%(height)s\t%(filepath)s"));
            synchronized (this) {
                if (bandwidth > 0) args.addAll(asList("--limit-rate", Math.max(1, bandwidth / concurrency) + "K"));
                long estimate = record.getJSONObject("retryPayload").optLong("estimatedSizeBytes");
                record.put("availableSpaceBytes", root.getUsableSpace());
                if (estimate > 0 && root.getUsableSpace() < estimate) throw new IOException("INSUFFICIENT_SPACE");
            }
            StringBuilder completedOutput = new StringBuilder();
            Exception downloadError = null;
            try {
                YtDlpRuntime.execute(context, args, "download-" + id, line -> {
                    if (line.startsWith("__OPENTUBEX_FILE__:")) completedOutput.append(line).append('\n');
                    progress(id, line);
                });
            } catch (Exception error) {
                downloadError = error;
            }
            if (!isExecuting(id) || Thread.currentThread().isInterrupted()) return;
            updateStatus(id, "processing", null);
            Map<String, JSONObject> metadata = new HashMap<>();
            for (String line : completedOutput.toString().split("\n")) {
                if (!line.startsWith("__OPENTUBEX_FILE__:")) continue;
                String[] fields = line.substring("__OPENTUBEX_FILE__:".length()).split("\t", 5);
                if (fields.length != 5) continue;
                JSONObject item = new JSONObject().put("videoId", fields[0]);
                String[] keys = {"duration", "width", "height"};
                for (int i = 0; i < keys.length; i++) {
                    try { item.put(keys[i], Double.parseDouble(fields[i + 1])); } catch (Exception ignored) { }
                }
                metadata.put(fields[4], item);
            }
            for (File completed : YtDlpFiles.completedFiles(root)) {
                if (!isExecuting(id)) return;
                String source = completed.getAbsolutePath();
                // A playlist can fail after other entries finish. Export those entries,
                // but leave unfinished format fragments and sidecars for the retry.
                if (downloadError != null && !metadata.containsKey(source)) continue;
                JSONObject exports;
                JSONObject exported;
                synchronized (this) {
                    exports = record.optJSONObject("exports");
                    if (exports == null) { exports = new JSONObject(); record.put("exports", exports); }
                    exported = exports.optJSONObject(source);
                    if (exported == null) { exported = new JSONObject(); exports.put(source, exported); }
                }
                if (exported.optBoolean("completed") && YtDlpFiles.exists(context, exported.optString("uri"))) continue;
                synchronized (this) {
                    if (exported.optBoolean("completed")) {
                        String missing = exported.getString("uri");
                        JSONArray destinations = record.getJSONArray("destinations");
                        JSONArray files = record.getJSONArray("files");
                        for (int i = destinations.length() - 1; i >= 0; i--) {
                            if (missing.equals(destinations.getString(i))) destinations.remove(i);
                        }
                        for (int i = files.length() - 1; i >= 0; i--) {
                            if (missing.equals(files.getJSONObject(i).optString("path"))) files.remove(i);
                        }
                        record.put("sizeBytes", record.optLong("sizeBytes") - exported.getLong("sizeBytes"));
                        if (missing.equals(record.optString("destination"))) {
                            record.put("destination", destinations.length() == 0 ? JSONObject.NULL : destinations.getString(destinations.length() - 1));
                        }
                        exported.put("completed", false);
                        save();
                    }
                }
                JSONObject destinationRecord = exported;
                Uri destination = YtDlpFiles.export(context, root, completed, record.getString("folder"), exported.optString("uri"), uri -> {
                    synchronized (this) {
                        try { destinationRecord.put("uri", uri.toString()); save(); }
                        catch (Exception error) { throw new IllegalStateException(error); }
                    }
                });
                synchronized (this) {
                    exported.put("completed", true).put("sizeBytes", completed.length());
                    record.getJSONArray("destinations").put(destination.toString());
                    record.put("destination", destination.toString());
                    record.put("sizeBytes", record.optLong("sizeBytes") + completed.length());
                    JSONObject item = metadata.get(completed.getAbsolutePath());
                    if (item != null) record.getJSONArray("files").put(item.put("path", destination.toString()).put("extension", completed.getName().substring(completed.getName().lastIndexOf('.') + 1)).put("available", true));
                    save();
                }
            }
            synchronized (this) {
                if (!isExecuting(id)) return;
                if (downloadError == null) {
                    record.put("percent", 100);
                    updateStatus(id, record.getJSONArray("destinations").length() > 0 ? "completed" : "skipped", null);
                } else {
                    updateStatus(id, "failed", downloadError.getMessage() == null ? downloadError.getClass().getSimpleName() : downloadError.getMessage());
                }
            }
            if (downloadError == null) YtDlpFiles.deleteTree(root);
        } catch (Exception error) {
            synchronized (this) {
                if (isExecuting(id)) updateStatus(id, "failed", error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage());
            }
        } finally {
            synchronized (this) {
                threads.remove(id);
                running.remove(id);
                notifyAll();
            }
        }
    }

    private synchronized boolean isExecuting(long id) {
        JSONObject record = records.get(id);
        return record != null && asList("downloading", "processing").contains(record.optString("status"));
    }

    private synchronized void progress(long id, String lines) {
        JSONObject record = records.get(id);
        if (!isExecuting(id)) return;
        try {
            for (String line : lines.split("\n")) {
                var match = PROGRESS.matcher(line);
                if (match.find()) {
                    record.put("percent", Double.parseDouble(match.group(1))).put("speed", match.group(2)).put("eta", match.group(3));
                    record.put("status", "downloading");
                } else if (line.startsWith("[Merger]") || line.startsWith("[ExtractAudio]")) record.put("status", "processing");
            }
            long now = System.currentTimeMillis();
            if (now - record.optLong("lastProgress") >= 500) {
                record.put("lastProgress", now);
                publish(record);
            }
        } catch (Exception error) { Log.w("OpenTubeXYtDlp", "Invalid download progress", error); }
    }

    private synchronized void updateStatus(long id, String status, String error) {
        try {
            JSONObject record = records.get(id);
            record.put("status", status).put("errorMessage", error == null ? JSONObject.NULL : error);
            publish(record);
            save();
        } catch (Exception exception) { throw new IllegalStateException(exception); }
    }

    synchronized boolean control(long id, String action, int direction) throws Exception {
        JSONObject record = records.get(id);
        if (record == null) return false;
        String status = record.optString("status");
        if ((action.equals("pause") || action.equals("cancel")) && ACTIVE.contains(status)) {
            updateStatus(id, action.equals("pause") ? "paused" : "cancelled", null);
            YtDlpRuntime.cancel(id);
            Thread thread = threads.get(id);
            if (thread != null) thread.interrupt();
        } else if (action.equals("resume") && status.equals("paused")) {
            updateStatus(id, "queued", null);
        } else if (action.equals("move") && asList("queued", "paused").contains(status) && Math.abs(direction) == 1) {
            List<JSONObject> peers = records.values().stream().filter(r -> asList("queued", "paused").contains(r.optString("status")))
                .sorted(Comparator.comparingLong(r -> r.optLong("queuePosition"))).collect(java.util.stream.Collectors.toList());
            int index = peers.indexOf(record) + direction;
            if (index < 0 || index >= peers.size()) return false;
            JSONObject other = peers.get(index);
            long position = record.optLong("queuePosition");
            record.put("queuePosition", other.optLong("queuePosition"));
            other.put("queuePosition", position);
            publish(other);
            publish(record);
        } else return false;
        save();
        if (action.equals("resume")) wake();
        return true;
    }

    synchronized boolean queue(String action, JSONObject config) throws Exception {
        configure(config);
        if (action.equals("pause-all")) {
            paused = true;
            for (long id : records.keySet()) if (ACTIVE.contains(records.get(id).optString("status"))) control(id, "pause", 0);
        } else if (action.equals("resume-all")) {
            paused = false;
            for (JSONObject record : records.values()) if (record.optString("status").equals("paused")) updateStatus(record.getLong("id"), "queued", null);
        } else if (action.equals("retry-all")) {
            for (JSONObject record : records.values()) if (record.optString("status").equals("failed")) updateStatus(record.getLong("id"), paused ? "paused" : "queued", null);
        } else if (!action.equals("refresh")) return false;
        save();
        if (hasQueued()) wake();
        return true;
    }

    synchronized void cancelAll() throws Exception {
        for (long id : new ArrayList<>(records.keySet())) control(id, "cancel", 0);
    }

    synchronized void stopRunning() {
        for (long id : new ArrayList<>(running)) {
            if (isExecuting(id)) updateStatus(id, "queued", null);
            YtDlpRuntime.cancel(id);
            Thread thread = threads.get(id);
            if (thread != null) thread.interrupt();
            else running.remove(id);
        }
    }

    synchronized JSONArray list() throws Exception {
        JSONArray result = new JSONArray();
        for (JSONObject record : records.values()) {
            JSONObject copy = snapshot(record);
            JSONArray destinations = copy.optJSONArray("destinations");
            int available = 0;
            for (int i = 0; i < destinations.length(); i++) if (YtDlpFiles.exists(context, destinations.getString(i))) available++;
            copy.put("availableDestinationCount", available).put("destinationCount", destinations.length());
            copy.put("availability", available == 0 ? "missing" : available == destinations.length() ? "available" : "partial");
            JSONArray files = copy.getJSONArray("files");
            for (int i = 0; i < files.length(); i++) {
                JSONObject item = files.getJSONObject(i);
                item.put("available", YtDlpFiles.exists(context, item.getString("path")));
            }
            result.put(copy);
        }
        return result;
    }

    synchronized JSONArray clear(JSONArray ids) throws Exception {
        JSONArray removed = new JSONArray();
        for (int i = 0; i < ids.length(); i++) {
            long id = ids.getLong(i);
            JSONObject record = records.get(id);
            if (record == null || ACTIVE.contains(record.optString("status")) || running.contains(id)) continue;
            records.remove(id);
            YtDlpFiles.deleteTree(new File(staging, Long.toString(id)));
            removed.put(id);
        }
        save();
        return removed;
    }

    synchronized Uri firstFile(long id) {
        JSONObject record = records.get(id);
        if (record == null) return null;
        JSONArray media = record.optJSONArray("files");
        for (int i = 0; media != null && i < media.length(); i++) {
            String path = media.optJSONObject(i).optString("path");
            if (YtDlpFiles.exists(context, path)) return Uri.parse(path);
        }
        JSONArray paths = record.optJSONArray("destinations");
        for (int i = 0; i < paths.length(); i++) if (YtDlpFiles.exists(context, paths.optString(i))) return Uri.parse(paths.optString(i));
        return null;
    }

    synchronized boolean remove(long id) throws Exception {
        JSONObject record = records.get(id);
        if (record == null || ACTIVE.contains(record.optString("status")) || running.contains(id)) return false;
        JSONArray paths = record.getJSONArray("destinations");
        for (int i = 0; i < paths.length(); i++) {
            DocumentFile document = DocumentFile.fromSingleUri(context, Uri.parse(paths.getString(i)));
            if (document != null && document.exists() && !document.delete()) return false;
        }
        clear(new JSONArray().put(id));
        return true;
    }

    private JSONObject snapshot(JSONObject record) throws Exception {
        JSONObject copy = new JSONObject(record.toString());
        for (String key : asList("args", "folder", "lastProgress", "exports")) copy.remove(key);
        return copy;
    }

    private void publish(JSONObject record) throws Exception {
        for (Consumer<JSONObject> listener : listeners) listener.accept(snapshot(record));
    }

    private synchronized void save() {
        FileOutputStream output = null;
        try {
            JSONObject saved = new JSONObject().put("counter", counter).put("paused", paused)
                .put("configuration", configuration).put("concurrency", concurrency).put("bandwidth", bandwidth).put("records", new JSONArray(records.values()));
            output = file.startWrite();
            output.write(saved.toString().getBytes(StandardCharsets.UTF_8));
            file.finishWrite(output);
        } catch (Exception error) {
            if (output != null) file.failWrite(output);
            throw new IllegalStateException("Unable to save Android download history", error);
        }
    }
}
